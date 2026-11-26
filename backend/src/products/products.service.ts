import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import {
  LocationType,
  Prisma,
  Product,
  ProductType,
  PromotionType,
} from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import {
  availableStock,
  type AvailabilitySubject,
  isLowStock,
  normalizeStock,
  resolveInitialStockMovement,
  resolveStockDeltaMovement,
  tracksStock,
  type StockSubject,
} from './product-type.logic';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { StockAdjustmentDto } from './dto/stock-adjustment.dto';
import {
  applySiteStockDelta,
  resolveDefaultSiteWithin,
} from '../inventory/site-stock';
import { resolveWritableSiteWithin } from '../locations/authorized-site';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  DianTaxCode,
  resolveEffectiveTaxCode,
  resolveEffectiveTaxRate,
} from '../common/utils/tax.util';
import { computeSkipTake } from '../common/utils/pagination';
import { PlanLimitService } from '../plan-limits/plan-limits.service';

/**
 * Why a per-site adjustment is refused by the ledger itself (T22): the move
 * would leave that site's stock below the units already reserved there, or
 * take units it does not hold. The aggregate is never the answer to that
 * question, which is why the site row refuses it.
 */
export const SITE_ADJUSTMENT_REFUSED =
  'La sede no puede absorber el ajuste: quedaría por debajo de lo reservado o sin existencias';

/** A stock edit is meaningless for an item whose units are not counted. */
export const SITE_ADJUSTMENT_NEEDS_TRACKED_PRODUCT =
  'Solo los productos que manejan inventario pueden ajustar existencias por sede';

/** A movement without a motive is not history, it is noise. */
export const SITE_ADJUSTMENT_REASON_REQUIRED =
  'El motivo del ajuste es obligatorio';

/** Nothing to correct. */
export const SITE_ADJUSTMENT_EMPTY = 'El ajuste debe mover al menos una unidad';

/** Two writers crossed; the caller retries with the fresh balance. */
export const SITE_ADJUSTMENT_CONFLICT =
  'Las existencias cambiaron mientras ajustabas: vuelve a intentarlo';

/**
 * An absolute stock edit in an organization that holds more than one site: the
 * aggregate cannot say where the units should land, so the user adjusts per
 * site instead (T22, replacing an edit that sent the whole delta to the
 * principal site and failed when the stock sat elsewhere).
 */
export const MULTI_SITE_STOCK_EDIT_REFUSED =
  'Esta organización tiene más de una sede: ajusta las existencias por sede en lugar de editar el stock total';

/** One readable site, as the location directory describes it. */
export interface ReadableSite {
  id: string;
  name: string;
  type: LocationType;
  isDefault: boolean;
}

/** What one product holds at one site (T22). */
export interface SiteStockBreakdown {
  /** The site key. Named `locationId` so it matches every other site payload. */
  locationId: string;
  name: string;
  type: LocationType;
  isDefault: boolean;
  stock: number;
  reservedStock: number;
  availableStock: number;
}

export interface PromoPricingProduct {
  salePrice: Prisma.Decimal | number;
  promotionType?: PromotionType | null;
  promotionValue?: Prisma.Decimal | number | null;
}

/** One site the caller is allowed to read, inside the caller's organization. */
interface SiteScope {
  locationId: string;
  organizationId: string;
}

/** The balance a product holds at one site. */
interface SiteStockProjection {
  stock: number;
  reservedStock: number;
}

/**
 * Derives the effective sale price for a product from its optional promotion:
 *
 *   PERCENTAGE   → salePrice * (1 - promotionValue / 100)
 *   FIXED_PRICE  → promotionValue
 *   no promotion → null
 *
 * Computed in `number` (never float-chained Decimals) and rounded half-up to
 * two decimals, consistent with the DECIMAL(10,2) columns.
 */
export function computeEffectiveSalePrice(
  product: PromoPricingProduct,
): number | null {
  const { salePrice, promotionType, promotionValue } = product;

  if (!promotionType || promotionValue == null) {
    return null;
  }

  const listPrice = Number(salePrice);
  const value = Number(promotionValue);

  let raw: number;
  if (promotionType === PromotionType.PERCENTAGE) {
    raw = listPrice * (1 - value / 100);
  } else {
    raw = value;
  }

  return Math.round((raw + Number.EPSILON) * 100) / 100;
}

/**
 * Cross-field promotion invariants, mirroring the taxable/taxRate precedent:
 *
 *   - PERCENTAGE  → 0 < promotionValue <= 100
 *   - FIXED_PRICE → 0 < promotionValue < salePrice
 *   - both fields null (or omitted) → no-op / explicit clearing
 *   - partial writes (one field without the other) are rejected
 *
 * Shape validation lives in the DTO; this guards the business rules that need
 * context (the effective sale price) the DTO cannot see.
 */
function assertValidPromotion(
  promotionType: PromotionType | null | undefined,
  promotionValue: number | null | undefined,
  salePrice: number,
): void {
  const typeSent = promotionType !== undefined;
  const valueSent = promotionValue !== undefined;

  if (!typeSent && !valueSent) {
    return;
  }

  const clearing = promotionType === null && promotionValue === null;
  const fullySet = promotionType != null && promotionValue != null;

  if (!clearing && !fullySet) {
    throw new BadRequestException(
      'promotionType and promotionValue must be provided together (send both as null to clear the promotion)',
    );
  }

  if (!fullySet) {
    return;
  }

  const value = Number(promotionValue);

  if (promotionType === PromotionType.PERCENTAGE) {
    if (!(value > 0 && value <= 100)) {
      throw new BadRequestException(
        'promotionValue must be greater than 0 and at most 100 for PERCENTAGE promotions',
      );
    }
    return;
  }

  if (!(value > 0)) {
    throw new BadRequestException(
      'promotionValue must be greater than 0 for FIXED_PRICE promotions',
    );
  }

  if (!(value < salePrice)) {
    throw new BadRequestException(
      'promotionValue must be less than salePrice for FIXED_PRICE promotions',
    );
  }
}

// Missing/corrupt counters must not be interpreted as zero or silently repaired.
function assertReservationCompatible(
  existing: StockSubject & {
    stock: number;
    reservedStock: number;
    active: boolean;
  },
  next: StockSubject & { stock: number; active: boolean },
): void {
  const reserved = existing.reservedStock;
  if (
    !Number.isInteger(reserved) ||
    reserved < 0 ||
    reserved > existing.stock
  ) {
    throw new ConflictException(
      'El inventario reservado del producto es inconsistente',
    );
  }
  if (
    reserved > 0 &&
    (!existing.active ||
      !tracksStock(existing) ||
      !next.active ||
      !tracksStock(next) ||
      next.stock < reserved)
  ) {
    throw new ConflictException(
      'No se puede reducir el stock por debajo de lo reservado, desactivar, eliminar o dejar de controlar un producto con reservas pendientes',
    );
  }
}

function assertNoReservationInput(dto: object): void {
  if ('reservedStock' in dto) {
    throw new BadRequestException(
      'El inventario reservado no se puede modificar desde productos',
    );
  }
}

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
    private planLimitService: PlanLimitService,
  ) {}

  async create(
    createProductDto: CreateProductDto,
    userId: string,
    organizationId: string | undefined,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    assertNoReservationInput(createProductDto);
    const {
      sku,
      barcode: rawBarcode,
      categoryId,
      taxRate,
      taxable,
      taxCode,
      type: rawType,
      stock,
      tracksStock: rawTracksStock,
      ...rest
    } = createProductDto;
    // Normalize empty barcode to null so PostgreSQL unique constraint ignores it
    const barcode = rawBarcode?.trim() || null;

    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, organizationId },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (sku) {
      const existingSku = await this.prisma.product.findUnique({
        where: { organizationId_sku: { organizationId, sku } },
      });
      if (existingSku) {
        throw new ConflictException('SKU already exists');
      }
    }

    if (barcode) {
      const existingBarcode = await this.prisma.product.findUnique({
        where: { organizationId_barcode: { organizationId, barcode } },
      });
      if (existingBarcode) {
        throw new ConflictException('Barcode already exists');
      }
    }

    // Tax is opt-in: a taxable product must carry a positive rate; otherwise
    // the rate is forced to 0 and the effective rate is resolved at read time
    // (product.taxable → category.taxable → 0).
    const resolvedTaxable = taxable ?? false;
    let resolvedTaxRate: number;
    if (resolvedTaxable) {
      if (taxRate == null || Number(taxRate) <= 0) {
        throw new BadRequestException(
          'Taxable products require a tax rate greater than 0',
        );
      }
      resolvedTaxRate = Number(taxRate);
    } else {
      resolvedTaxRate = 0;
    }
    // Same precedent, second field: a tribute code may only exist on a taxable
    // product. A taxable product may omit it and resolve to IVA at read time.
    if (!resolvedTaxable && taxCode != null) {
      throw new BadRequestException(
        'taxCode cannot be set when taxable is false',
      );
    }

    // A service carries no stock. Whatever the payload asked for is normalised away
    // rather than stored, so neither the inventory valuation nor the kárdex can be
    // inflated by an invented number.
    const resolvedType = rawType ?? ProductType.PRODUCT;
    // The invariant is enforced here, at the write boundary, so no invalid combination can ever
    // be stored: a service is never tracked, whatever the payload says. An absent flag means
    // tracked, matching the column default.
    const resolvedTracksStock =
      resolvedType === ProductType.SERVICE ? false : (rawTracksStock ?? true);
    const resolvedSubject = {
      type: resolvedType,
      tracksStock: resolvedTracksStock,
    };
    const resolvedStock = normalizeStock(resolvedSubject, stock);

    assertValidPromotion(
      createProductDto.promotionType,
      createProductDto.promotionValue,
      Number(createProductDto.salePrice),
    );

    const product = await this.prisma.product.create({
      data: {
        ...rest,
        sku,
        barcode,
        categoryId,
        organizationId,
        taxable: resolvedTaxable,
        taxRate: resolvedTaxRate,
        taxCode: resolvedTaxable ? (taxCode ?? null) : null,
        type: resolvedType,
        stock: resolvedStock,
        tracksStock: resolvedTracksStock,
      },
      include: { category: true },
    });

    this.planLimitService.invalidateCache('products', organizationId);

    const initialMovement = resolveInitialStockMovement(product, product.stock);

    if (initialMovement) {
      // The insert opened the default-site row through the database trigger, so
      // the movement that explains the opening balance belongs to that site.
      const siteId = await resolveDefaultSiteWithin(
        this.prisma,
        organizationId,
      );
      await this.createInventoryMovement(
        product.id,
        initialMovement.type,
        0,
        initialMovement.quantity,
        'Initial stock',
        userId,
        organizationId,
        undefined,
        siteId,
      );
    }

    return this.enrichProduct(product);
  }

  async findAll(
    organizationId: string | undefined,
    page = 1,
    limit = 10,
    search?: string,
    categoryId?: string,
    status: 'active' | 'inactive' | 'all' = 'active',
    lowStock?: boolean,
    orderBy: 'name' | 'createdAt' = 'createdAt',
    type?: ProductType,
    ids?: string[],
    available = false,
    locationId?: string,
    carriedAtSite?: boolean,
  ) {
    if (
      ids !== undefined &&
      (!Array.isArray(ids) ||
        ids.some((id) => typeof id !== 'string' || !isUUID(id)))
    ) {
      throw new BadRequestException('ids must contain UUID product IDs');
    }
    const { skip, take } = computeSkipTake(page, limit);
    const site = this.siteScope(locationId, organizationId);
    // The assortment switch only has a meaning inside a site view: there is no
    // "products this organization carries", the aggregate is the whole catalog.
    if (carriedAtSite !== undefined && !site) {
      throw new BadRequestException('carriedAtSite requires a locationId');
    }

    const baseWhere: Record<string, unknown> = {
      ...(organizationId ? { organizationId } : {}),
    };

    if (status === 'active') {
      baseWhere.active = true;
    }

    if (status === 'inactive') {
      baseWhere.active = false;
    }

    if (search) {
      baseWhere.OR = [
        { name: { contains: search, mode: 'insensitive' as const } },
        { sku: { contains: search, mode: 'insensitive' as const } },
        { barcode: { contains: search, mode: 'insensitive' as const } },
      ];
    }

    if (categoryId) {
      baseWhere.categoryId = categoryId;
    }

    if (type) baseWhere.type = type;

    // Explicit [] is restrictive, unlike an omitted filter. Never truncate IDs:
    // pagination bounds returned rows, not the favorite collection's reachability.
    if (ids !== undefined) baseWhere.id = { in: [...new Set(ids)] };
    if (carriedAtSite && site) {
      baseWhere.AND = [
        ...((baseWhere.AND as unknown[]) ?? []),
        this.siteAssortment(site),
      ];
    }
    if (available) {
      const eligibility = site
        ? this.siteAvailability(site)
        : {
            OR: [
              { type: ProductType.SERVICE },
              { tracksStock: false },
              { stock: { gt: this.prisma.product.fields.reservedStock } },
            ],
          };
      baseWhere.AND = [...((baseWhere.AND as unknown[]) ?? []), eligibility];
    }

    const where = lowStock
      ? this.withLowStockFilter(baseWhere, type)
      : baseWhere;

    // 'name' keeps the inventory list's alphabetical presentation coherent
    // across page boundaries; 'createdAt' (default) preserves the legacy order.
    const orderByClause =
      orderBy === 'name'
        ? { name: 'asc' as const }
        : { createdAt: 'desc' as const };

    const [products, total, unfilteredLowStockTotal] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        include: { category: true },
        orderBy: orderByClause,
      }),
      this.prisma.product.count({ where }),
      // The inventory badge must answer "how many are low on stock" for the whole
      // catalog under the active search/category/status filters, not just for the
      // slice this page returned. When the list is already the low-stock set,
      // `total` is that answer and a second identical COUNT would buy nothing.
      lowStock
        ? Promise.resolve(null)
        : this.prisma.product.count({
            where: this.withLowStockFilter(baseWhere, type),
          }),
    ]);
    const lowStockCount = unfilteredLowStockTotal ?? total;

    // A requested site projects its own balance onto every row; `isLowStock`
    // and `minStock` stay organization-level.
    const balances = await this.readSiteBalances(
      site,
      products.map(({ id }) => id),
    );

    return {
      data: products.map((p) => this.enrichProduct(p, balances.get(p.id))),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        lowStockCount,
      },
    };
  }

  /**
   * The single low-stock predicate for every Prisma read. The filter that builds a
   * low-stock page and the independent COUNT that feeds the inventory badge go through
   * here, so the number on the badge and the list it opens cannot drift apart.
   *
   * `stock <= minStock` is a field reference evaluated in the database: pagination stays
   * coherent without loading every product. A service is never low on stock, and neither
   * is untracked merchandise, so both are excluded; a service type filter therefore
   * intersects to an empty set instead of returning merchandise.
   */
  private withLowStockFilter(
    baseWhere: Record<string, unknown>,
    type: ProductType | undefined,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = {
      ...baseWhere,
      stock: { lte: this.prisma.product.fields.minStock },
      tracksStock: true,
    };
    if (type) {
      // Keep the intersection clause first, matching the order callers relied on.
      where.AND = [
        { type: ProductType.PRODUCT },
        ...((baseWhere.AND as unknown[]) ?? []),
      ];
    } else {
      where.type = ProductType.PRODUCT;
    }
    return where;
  }

  /**
   * The site a read was scoped to, always inside the caller's organization.
   *
   * The controller has already authorized the site through the shared location
   * read; the tenant here keeps the balance query from ever leaving it, and a
   * site read without an organization is refused instead of silently answering
   * for every tenant.
   */
  private siteScope(
    locationId: string | undefined,
    organizationId: string | undefined,
  ): SiteScope | undefined {
    if (!locationId) {
      return undefined;
    }
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    return { locationId, organizationId };
  }

  /**
   * The `available` rule at one site: a tracked product is available there while
   * its site balance keeps free units (`stock - reservedStock > 0`). A product
   * with no row at that site has none, and services and untracked merchandise
   * stay available everywhere because stock never governs them.
   */
  private siteAvailability(site: SiteScope): Record<string, unknown> {
    return {
      OR: [
        { type: ProductType.SERVICE },
        { tracksStock: false },
        {
          locationStocks: {
            some: {
              locationId: site.locationId,
              organizationId: site.organizationId,
              stock: { gt: this.prisma.productStock.fields.reservedStock },
            },
          },
        },
      ],
    };
  }

  /**
   * The assortment rule of a site view (T25): the products that site actually
   * carries.
   *
   * A site carries a tracked product while it holds a balance row for it —
   * opened at the default site when the product is created, and at any other
   * site by the first receipt, transfer or adjustment. The row outlives the
   * units, so a product that sold out stays in the assortment at zero instead
   * of disappearing. Services and uncounted merchandise are never carried: no
   * site holds their units, so they stay in "Todas las sedes" only.
   */
  private siteAssortment(site: SiteScope): Record<string, unknown> {
    return {
      tracksStock: true,
      locationStocks: {
        some: {
          locationId: site.locationId,
          organizationId: site.organizationId,
        },
      },
    };
  }

  /**
   * The balance every returned product holds at the requested site. A product
   * without a row there simply has no entry: the projection reads it as zero,
   * which is what "no stock at this site" means. One extra indexed read keeps
   * the product query itself unchanged.
   */
  private async readSiteBalances(
    site: SiteScope | undefined,
    productIds: string[],
  ): Promise<Map<string, SiteStockProjection>> {
    if (!site || productIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.productStock.findMany({
      where: {
        organizationId: site.organizationId,
        locationId: site.locationId,
        productId: { in: productIds },
      },
      select: { productId: true, stock: true, reservedStock: true },
    });

    return new Map(
      rows.map(({ productId, stock, reservedStock }) => [
        productId,
        { stock, reservedStock },
      ]),
    );
  }

  async findOne(id: string, organizationId: string | undefined) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        ...(organizationId ? { organizationId } : {}),
        active: true,
      },
      include: { category: true, movements: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.enrichProduct(product);
  }

  /**
   * The product's balance at every site the caller may read (T22).
   *
   * The readable set is the caller's, resolved by the location directory before
   * this read: an owner or administrator reaches every site of the
   * organization, an operational membership only the sites an administrator
   * assigned, and no assignments means no sites. A site without a
   * `ProductStock` row holds zero units — the row is opened by the first
   * receipt, not by the product's existence — so the breakdown always answers
   * for every visible site instead of hiding the empty ones.
   */
  async stockBySite(
    id: string,
    organizationId: string | undefined,
    sites: ReadableSite[],
  ): Promise<SiteStockBreakdown[]> {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }

    const product = await this.prisma.product.findFirst({
      where: { id, organizationId, active: true },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    if (sites.length === 0) return [];

    const rows = await this.prisma.productStock.findMany({
      where: {
        organizationId,
        productId: id,
        locationId: { in: sites.map(({ id: siteId }) => siteId) },
      },
      select: { locationId: true, stock: true, reservedStock: true },
    });
    const balances = new Map(rows.map((row) => [row.locationId, row]));

    return sites.map((site) => {
      const balance = balances.get(site.id);
      const stock = balance?.stock ?? 0;
      const reservedStock = balance?.reservedStock ?? 0;
      return {
        locationId: site.id,
        name: site.name,
        type: site.type,
        isDefault: site.isDefault,
        stock,
        reservedStock,
        availableStock: stock - reservedStock,
      };
    });
  }

  /**
   * Moves one site's balance and records why (T22).
   *
   * The write order is the one every site writer takes: the site row first (its
   * trigger keeps `Product` the organization aggregate), then the product's
   * optimistic version guard, so a concurrent edit still loses with the same
   * 409 it has always answered and rolls the delta back with the transaction.
   * The site is authorized inside this transaction — never from a read the
   * caller did earlier — and the ledger, not the aggregate, decides whether the
   * move is allowed to leave reservations uncovered.
   */
  async adjustSiteStock(
    id: string,
    input: StockAdjustmentDto,
    actor: RequestUser,
  ): Promise<{
    product: ReturnType<ProductsService['enrichProduct']>;
    site: SiteStockBreakdown;
  }> {
    const organizationId = actor.organizationId;
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const reason = input.reason?.trim() ?? '';
    if (!reason) {
      throw new BadRequestException(SITE_ADJUSTMENT_REASON_REQUIRED);
    }
    if (!Number.isInteger(input.quantity) || input.quantity === 0) {
      throw new BadRequestException(SITE_ADJUSTMENT_EMPTY);
    }

    const existingProduct = await this.prisma.product.findFirst({
      where: { id, organizationId, active: true },
      select: { id: true, tracksStock: true },
    });
    if (!existingProduct) {
      throw new NotFoundException('Product not found');
    }
    if (!existingProduct.tracksStock) {
      throw new BadRequestException(SITE_ADJUSTMENT_NEEDS_TRACKED_PRODUCT);
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Site authorization and its row lock come before the aggregate: the
          // delta's trigger is what writes `Product`, so the lock order is
          // ProductStock → Product, as in every other site writer.
          const site = await resolveWritableSiteWithin(
            tx,
            actor,
            input.locationId,
          );
          const applied = await applySiteStockDelta(tx, {
            organizationId: site.organizationId,
            productId: id,
            locationId: site.locationId,
            stockDelta: input.quantity,
            reservedDelta: 0,
          });
          if (!applied.applied) {
            throw new ConflictException(SITE_ADJUSTMENT_REFUSED);
          }

          // The adjustment is a delta, so the site row's own CAS is what keeps
          // the quantity right; requiring the version read before the
          // transaction would refuse every adjustment that overlaps a sale,
          // which bumps it too. The bump re-pins an active, counted product.
          const versionBump = await tx.product.updateMany({
            where: {
              id,
              organizationId,
              active: true,
              tracksStock: true,
            },
            data: { version: { increment: 1 } },
          });
          if (versionBump.count === 0) {
            throw new ConflictException('Product was modified by another user');
          }

          const [product, location, balance] = await Promise.all([
            tx.product.findFirst({
              where: { id, organizationId },
              include: { category: true },
            }),
            tx.location.findFirstOrThrow({
              where: { id: site.locationId, organizationId },
              select: { id: true, name: true, type: true, isDefault: true },
            }),
            tx.productStock.findUniqueOrThrow({
              where: {
                productId_locationId: {
                  productId: id,
                  locationId: site.locationId,
                },
              },
              select: { stock: true, reservedStock: true },
            }),
          ]);
          if (!product) {
            throw new NotFoundException('Product not found');
          }

          // The movement explains the organization aggregate the trigger moved,
          // exactly like the sale and receipt writers do, and names the site the
          // units actually entered or left.
          await this.createInventoryMovement(
            id,
            input.quantity > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
            product.stock - input.quantity,
            product.stock,
            reason,
            actor.userId,
            organizationId,
            undefined,
            site.locationId,
            tx.inventoryMovement,
          );

          return {
            product: this.enrichProduct(product),
            site: {
              locationId: location.id,
              name: location.name,
              type: location.type,
              isDefault: location.isDefault,
              stock: balance.stock,
              reservedStock: balance.reservedStock,
              availableStock: balance.stock - balance.reservedStock,
            },
          };
        },
        // Two adjustments on the same product (or a sale) must not interleave
        // their site rows and the version guard.
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isSerializationFailure(error)) {
        throw new ConflictException(SITE_ADJUSTMENT_CONFLICT);
      }
      throw error;
    }
  }

  async update(
    id: string,
    updateProductDto: UpdateProductDto,
    userId: string,
    organizationId: string | undefined,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    assertNoReservationInput(updateProductDto);
    const {
      taxCode: requestedTaxCode,
      stock: requestedStock,
      ...updateFields
    } = updateProductDto;
    const existingProduct = await this.prisma.product.findFirst({
      where: { id, organizationId, active: true },
    });

    if (!existingProduct) {
      throw new NotFoundException('Product not found');
    }

    if (updateProductDto.categoryId !== undefined) {
      const category = await this.prisma.category.findFirst({
        where: { id: updateProductDto.categoryId, organizationId },
      });
      if (!category) {
        throw new NotFoundException('Category not found');
      }
    }

    if (updateProductDto.sku && updateProductDto.sku !== existingProduct.sku) {
      const existingSku = await this.prisma.product.findUnique({
        where: {
          organizationId_sku: {
            organizationId,
            sku: updateProductDto.sku,
          },
        },
      });
      if (existingSku) {
        throw new ConflictException('SKU already exists');
      }
    }

    // Normalize empty barcode to null before comparing or saving
    const normalizedBarcode = updateProductDto.barcode?.trim() || null;

    if (normalizedBarcode && normalizedBarcode !== existingProduct.barcode) {
      const existingBarcode = await this.prisma.product.findUnique({
        where: {
          organizationId_barcode: {
            organizationId,
            barcode: normalizedBarcode,
          },
        },
      });
      if (existingBarcode) {
        throw new ConflictException('Barcode already exists');
      }
    }

    const previousStock = existingProduct.stock;
    // A service never carries stock, so editing one, or converting a stocked product
    // into one, always lands on zero instead of storing the invented number. The
    // resulting subject reads the row's flag, because this write cannot change it
    // yet: the effective state keeps whatever tracksStock the row declares.
    const effectiveType = updateProductDto.type ?? existingProduct.type;
    // Same invariant as create, applied to the resulting state: a service is never tracked. When
    // the caller says nothing the row keeps what it had, which is why converting a service back
    // into merchandise requires declaring tracksStock: true explicitly.
    const effectiveTracksStock =
      effectiveType === ProductType.SERVICE
        ? false
        : (updateProductDto.tracksStock ?? existingProduct.tracksStock);
    const effectiveSubject = {
      type: effectiveType,
      tracksStock: effectiveTracksStock,
    };
    const newStock = normalizeStock(
      effectiveSubject,
      requestedStock ?? previousStock,
    );

    assertReservationCompatible(existingProduct, {
      ...effectiveSubject,
      stock: newStock,
      active: updateProductDto.active ?? existingProduct.active,
    });

    // T22: an organization with more than one site cannot take an absolute
    // stock number — the aggregate does not say which site holds the units, and
    // sending the whole delta to the principal site failed whenever the stock
    // sat elsewhere. Ask for a per-site adjustment instead. A single-site
    // organization keeps the edit (a delta at its only site) exactly as it was,
    // and so does a product that stops being counted: `stock: 0` there is the
    // consequence of the type change, not a stock edit.
    if (
      requestedStock !== undefined &&
      newStock !== previousStock &&
      effectiveTracksStock
    ) {
      const siteCount = await this.prisma.location.count({
        where: { organizationId },
      });
      if (siteCount > 1) {
        throw new ConflictException(MULTI_SITE_STOCK_EDIT_REFUSED);
      }
    }

    // Apply the same opt-in tax invariant as create: `taxable=true` requires a
    // positive rate; `taxable=false` forces the stored rate back to 0 and clears
    // the tribute code. Keeping a code on a non-taxable product is rejected,
    // exactly like a rate would be meaningless there.
    const resultingTaxable =
      updateProductDto.taxable ?? existingProduct.taxable;
    if (!resultingTaxable && requestedTaxCode != null) {
      throw new BadRequestException(
        'taxCode cannot be set when taxable is false',
      );
    }
    const taxData =
      updateProductDto.taxable === true
        ? (() => {
            const rate = updateProductDto.taxRate ?? existingProduct.taxRate;
            if (rate == null || Number(rate) <= 0) {
              throw new BadRequestException(
                'Taxable products require a tax rate greater than 0',
              );
            }
            return { taxable: true, taxRate: Number(rate) };
          })()
        : updateProductDto.taxable === false
          ? { taxable: false, taxRate: 0, taxCode: null }
          : {};
    // Omitted means "leave whatever the row already stores"; an explicit null
    // is a request to clear the code.
    const taxCodeData =
      requestedTaxCode === undefined ? {} : { taxCode: requestedTaxCode };

    assertValidPromotion(
      updateProductDto.promotionType,
      updateProductDto.promotionValue,
      Number(updateProductDto.salePrice ?? existingProduct.salePrice),
    );

    const changesEligibility =
      effectiveType !== existingProduct.type ||
      effectiveTracksStock !== existingProduct.tracksStock;
    // `Product.stock` is the organization-wide aggregate now; the per-site
    // ledger is the source of truth, so an edit becomes a signed delta at the
    // tenant default site instead of an absolute write.
    const stockDelta = newStock - previousStock;

    // Reuse the existing write path without changing ordinary-edit atomicity.
    const writeProduct = async (client: Prisma.TransactionClient) => {
      // Lock order: the default-site row first, the aggregate second, because
      // the site delta's trigger is what updates "Product" — the same order
      // every other site writer takes. The version compare-and-swap below keeps
      // its exact contract: it still refuses a concurrent edit, and losing it
      // rolls the delta back with the transaction.
      let siteId: string | undefined;
      if (stockDelta !== 0) {
        siteId = await resolveDefaultSiteWithin(client, organizationId);
        const applied = await applySiteStockDelta(client, {
          organizationId,
          productId: id,
          locationId: siteId,
          stockDelta,
          reservedDelta: 0,
        });
        if (!applied.applied) {
          throw new ConflictException(
            'La sede principal no puede absorber el ajuste de stock: quedaría por debajo de lo reservado o sin existencias',
          );
        }
      }

      const updateResult = await client.product.updateMany({
        where: {
          id,
          organizationId,
          version: existingProduct.version,
          reservedStock: existingProduct.reservedStock,
          active: true,
        },
        data: {
          ...updateFields,
          ...taxData,
          ...taxCodeData,
          tracksStock: effectiveTracksStock,
          barcode: normalizedBarcode,
          version: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Product was modified by another user');
      }

      const product = await client.product.findFirst({
        where: { id, organizationId, active: updateProductDto.active ?? true },
        include: { category: true },
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      // Preserve conversion movements using whichever side tracked stock.
      const movementBasis = tracksStock(existingProduct)
        ? existingProduct
        : effectiveSubject;
      const movementType = resolveStockDeltaMovement(
        movementBasis,
        previousStock,
        newStock,
      );

      if (movementType) {
        await this.createInventoryMovement(
          id,
          movementType,
          previousStock,
          newStock,
          'Stock adjustment',
          userId,
          organizationId,
          undefined,
          siteId,
          client.inventoryMovement,
        );
      }

      return product;
    };

    const product =
      changesEligibility || stockDelta !== 0
        ? await this.prisma.$transaction(
            async (tx) => {
              if (changesEligibility) {
                const outstanding = await tx.inventoryLoanItem.findFirst({
                  where: {
                    organizationId,
                    productId: id,
                    deliveredQuantity: {
                      gt: tx.inventoryLoanItem.fields.returnedQuantity,
                    },
                  },
                });
                if (outstanding) {
                  throw new ConflictException(
                    'No se puede cambiar el tipo o seguimiento de inventario mientras hay unidades prestadas pendientes de devolución',
                  );
                }
              }
              return writeProduct(tx);
            },
            changesEligibility
              ? {
                  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                }
              : undefined,
          )
        : await writeProduct(this.prisma);

    return this.enrichProduct(product);
  }

  async deactivate(id: string, organizationId: string | undefined) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId, active: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    assertReservationCompatible(product, { ...product, active: false });
    try {
      return await this.prisma.product.update({
        where: {
          id,
          organizationId,
          active: true,
          version: product.version,
          reservedStock: product.reservedStock,
        },
        data: { active: false, version: { increment: 1 } },
        include: { category: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException('Product was modified by another user');
      }
      throw error;
    }
  }

  async remove(id: string, organizationId: string | undefined) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    assertReservationCompatible(product, { ...product, active: false });
    try {
      return await this.prisma.product.delete({
        where: {
          id,
          organizationId,
          active: product.active,
          version: product.version,
          reservedStock: product.reservedStock,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException('Product was modified by another user');
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'No se puede eliminar definitivamente un producto con ventas o movimientos de inventario asociados',
        );
      }
      throw error;
    }
  }

  async getLowStockProducts(organizationId: string | undefined) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const products = await this.prisma.$queryRaw<
      (Product & { categoryName: string | null })[]
    >`
      SELECT p.*, c.name as "categoryName"
      FROM "Product" p
      LEFT JOIN "Category" c ON p."categoryId" = c.id
      WHERE p.active = true AND p."organizationId" = ${organizationId} AND p.stock <= p."minStock" AND p."type" = 'PRODUCT' AND p."tracksStock" = true
      ORDER BY p.stock ASC
    `;
    return products.map((product) => ({
      ...product,
      availableStock: availableStock(product),
    }));
  }

  async searchProducts(
    query: string,
    limit = 20,
    organizationId: string | undefined,
    locationId?: string,
  ) {
    const site = this.siteScope(locationId, organizationId);
    const products = await this.prisma.product.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        active: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' as const } },
          { sku: { contains: query, mode: 'insensitive' as const } },
          { barcode: { contains: query, mode: 'insensitive' as const } },
        ],
      },
      take: limit,
      include: { category: true },
    });

    const balances = await this.readSiteBalances(
      site,
      products.map(({ id }) => id),
    );

    return products.map((p) =>
      this.projectProductSummary(p, balances.get(p.id)),
    );
  }

  async quickSearch(
    code: string,
    organizationId: string | undefined,
    locationId?: string,
  ) {
    const normalizedCode = code.trim();

    if (!normalizedCode) {
      return null;
    }

    const site = this.siteScope(locationId, organizationId);
    const product = await this.prisma.product.findFirst({
      where: {
        ...(organizationId ? { organizationId } : {}),
        active: true,
        OR: [
          {
            barcode: { equals: normalizedCode, mode: 'insensitive' as const },
          },
          { sku: { equals: normalizedCode, mode: 'insensitive' as const } },
        ],
      },
      include: { category: true },
    });

    if (!product) {
      return null;
    }

    const balances = await this.readSiteBalances(site, [product.id]);

    return this.projectProductSummary(product, balances.get(product.id));
  }

  /**
   * Enriches a product with effective tax information.
   *
   * Uses the shared `resolveEffectiveTaxRate(product, category)` and
   * `resolveEffectiveTaxCode(product, category)` so the read-time values agree
   * with sale-time resolution (opt-in precedence: product.taxable →
   * category.taxable → no tax), and a taxable row without a stored code reads
   * as IVA.
   */
  private enrichWithEffectiveTax<
    T extends {
      taxable: boolean;
      taxRate: Prisma.Decimal | number;
      taxCode?: DianTaxCode | null;
      category?: {
        taxable: boolean;
        defaultTaxRate: Prisma.Decimal | null;
        defaultTaxCode?: DianTaxCode | null;
      } | null;
    },
  >(
    product: T,
  ): T & {
    effectiveTaxRate: number;
    effectiveTaxCode: DianTaxCode | null;
  } {
    return {
      ...product,
      effectiveTaxRate: resolveEffectiveTaxRate(product, product.category),
      effectiveTaxCode: resolveEffectiveTaxCode(product, product.category),
    };
  }

  /**
   * Enriches a product with the promotion-aware effective sale price so every
   * pricing read carries the same backend-computed value (null = no promo).
   */
  private enrichWithPromo<T extends PromoPricingProduct>(
    product: T,
  ): T & { effectiveSalePrice: number | null } {
    return {
      ...product,
      effectiveSalePrice: computeEffectiveSalePrice(product),
    };
  }

  /**
   * Enriches a product with the low-stock flag, so every product the API hands the client
   * already answers the question. The flag is computed from the single stock rule in
   * `product-type.logic`: an untracked item is never low on stock whatever its stored
   * numbers say. Clients must render this field rather than re-deriving the rule, which is
   * how an untracked product used to be badged "low on stock" by three separate call sites.
   */
  private enrichWithLowStock<
    T extends StockSubject & { stock: number; minStock: number },
  >(product: T): T & { isLowStock: boolean } {
    return {
      ...product,
      isLowStock: isLowStock(product, product.stock, product.minStock),
    };
  }

  /**
   * The stock figures a read projects: the requested site's balance when a site
   * was asked for, the organization aggregate otherwise.
   */
  private availabilitySubject<T extends AvailabilitySubject>(
    product: T,
    site: SiteStockProjection | undefined,
  ): AvailabilitySubject {
    return site
      ? {
          type: product.type,
          tracksStock: product.tracksStock,
          stock: site.stock,
          reservedStock: site.reservedStock,
        }
      : product;
  }

  /**
   * The single response shape for a persisted product row: promo-aware price, effective
   * tax rate + resolved tax code, physical low-stock flag and reservation-aware availability. Every read that
   * returns whole product rows (create,
   * findAll, findOne, update) goes through here, so a new derived field cannot reach only
   * some of the endpoints and leave the client to guess.
   *
   * `site` is the balance the caller asked to read (T3f, the POS catalogue): the
   * projected `stock`, `reservedStock` and `availableStock` become that site's,
   * while `isLowStock` and `minStock` stay organization-level, exactly like the
   * reports and alerts that still read the aggregate.
   */
  private enrichProduct<
    T extends PromoPricingProduct &
      AvailabilitySubject & {
        taxable: boolean;
        taxRate: Prisma.Decimal | number;
        taxCode?: DianTaxCode | null;
        stock: number;
        minStock: number;
        category?: {
          taxable: boolean;
          defaultTaxRate: Prisma.Decimal | null;
          defaultTaxCode?: DianTaxCode | null;
        } | null;
      },
  >(product: T, site?: SiteStockProjection) {
    const enriched = this.enrichWithLowStock(
      this.enrichWithEffectiveTax(this.enrichWithPromo(product)),
    );

    return {
      ...enriched,
      // The aggregate the row carries is replaced, not merged: a site read must
      // never leak another site's units.
      ...(site ? { stock: site.stock, reservedStock: site.reservedStock } : {}),
      availableStock: availableStock(this.availabilitySubject(product, site)),
    };
  }

  /**
   * The catalogue summary the POS search endpoints return: every derived field
   * comes from {@link enrichProduct}, narrowed to the fields those endpoints
   * have always exposed. A site projection therefore moves the numbers and
   * never the payload shape.
   */
  private projectProductSummary(
    product: Prisma.ProductGetPayload<{ include: { category: true } }>,
    site?: SiteStockProjection,
  ) {
    const enriched = this.enrichProduct(product, site);

    return {
      id: enriched.id,
      name: enriched.name,
      sku: enriched.sku,
      barcode: enriched.barcode,
      salePrice: enriched.salePrice,
      stock: enriched.stock,
      availableStock: enriched.availableStock,
      taxable: enriched.taxable,
      taxRate: enriched.taxRate,
      taxCode: enriched.taxCode,
      effectiveTaxRate: enriched.effectiveTaxRate,
      effectiveTaxCode: enriched.effectiveTaxCode,
      minStock: enriched.minStock,
      type: enriched.type,
      tracksStock: enriched.tracksStock,
      isLowStock: enriched.isLowStock,
      category: enriched.category,
      imageUrl: enriched.imageUrl,
      promotionType: enriched.promotionType,
      promotionValue: enriched.promotionValue,
      effectiveSalePrice: enriched.effectiveSalePrice,
    };
  }

  private async createInventoryMovement(
    productId: string,
    type:
      | 'PURCHASE'
      | 'SALE'
      | 'ADJUSTMENT_IN'
      | 'ADJUSTMENT_OUT'
      | 'DAMAGE'
      | 'RETURN',
    previousStock: number,
    newStock: number,
    reason: string,
    userId: string,
    organizationId: string,
    saleId?: string,
    locationId?: string,
    movementDelegate = this.prisma.inventoryMovement,
  ) {
    await movementDelegate.create({
      data: {
        productId,
        type,
        quantity: newStock - previousStock,
        previousStock,
        newStock,
        reason,
        userId,
        organizationId,
        saleId,
        ...(locationId ? { locationId } : {}),
      },
    });
  }

  async uploadImage(file: Express.Multer.File) {
    const imageUrl = await this.cloudinaryService.uploadImage(file, 'products');
    return { imageUrl };
  }

  async uploadProductImage(
    productId: string,
    file: Express.Multer.File,
    organizationId: string | undefined,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const imageUrl = await this.cloudinaryService.uploadImage(file, 'products');

    if (product.imageUrl) {
      try {
        const publicId = this.cloudinaryService.extractPublicId(
          product.imageUrl,
        );
        await this.cloudinaryService.deleteImage(publicId);
      } catch (error) {
        console.error('Error deleting old image:', error);
      }
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id: productId },
      data: { imageUrl },
      include: { category: true },
    });

    return updatedProduct;
  }

  async reactivate(id: string, organizationId: string | undefined) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId },
      include: { category: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.active) {
      return product;
    }

    return this.prisma.product.update({
      where: { id },
      data: { active: true },
      include: { category: true },
    });
  }
}

/** PostgreSQL codes that mean another transaction won the same race. */
const SERIALIZATION_PG_CODES = ['40001', '40P01'];

/**
 * A site adjustment runs Serializable; Prisma reports the loser as `P2034`,
 * and a raw locking read reports the same PostgreSQL code as `P2010`. Both are
 * the same fact — someone else moved first — and neither retries itself.
 */
function isSerializationFailure(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010') return false;
  const databaseCode = (error.meta as { code?: unknown } | undefined)?.code;
  if (
    typeof databaseCode === 'string' &&
    SERIALIZATION_PG_CODES.includes(databaseCode)
  ) {
    return true;
  }
  return SERIALIZATION_PG_CODES.some((code) =>
    error.message.includes(`Code: \`${code}\``),
  );
}
