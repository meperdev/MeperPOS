import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, Product, ProductType, PromotionType } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
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
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { resolveEffectiveTaxRate } from '../common/utils/tax.util';
import { computeSkipTake } from '../common/utils/pagination';
import { PlanLimitService } from '../plan-limits/plan-limits.service';

export interface PromoPricingProduct {
  salePrice: Prisma.Decimal | number;
  promotionType?: PromotionType | null;
  promotionValue?: Prisma.Decimal | number | null;
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
        type: resolvedType,
        stock: resolvedStock,
        tracksStock: resolvedTracksStock,
      },
      include: { category: true },
    });

    this.planLimitService.invalidateCache('products', organizationId);

    const initialMovement = resolveInitialStockMovement(product, product.stock);

    if (initialMovement) {
      await this.createInventoryMovement(
        product.id,
        initialMovement.type,
        0,
        initialMovement.quantity,
        'Initial stock',
        userId,
        organizationId,
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
  ) {
    if (
      ids !== undefined &&
      (!Array.isArray(ids) ||
        ids.some((id) => typeof id !== 'string' || !isUUID(id)))
    ) {
      throw new BadRequestException('ids must contain UUID product IDs');
    }
    const { skip, take } = computeSkipTake(page, limit);

    const where: Record<string, unknown> = {
      ...(organizationId ? { organizationId } : {}),
    };

    if (status === 'active') {
      where.active = true;
    }

    if (status === 'inactive') {
      where.active = false;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' as const } },
        { sku: { contains: search, mode: 'insensitive' as const } },
        { barcode: { contains: search, mode: 'insensitive' as const } },
      ];
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (type) where.type = type;

    if (lowStock) {
      // Field reference: stock <= minStock is evaluated in the database, so
      // low-stock pages stay coherent without loading every product first.
      where.stock = { lte: this.prisma.product.fields.minStock };
      // A service is never low on stock, and neither is untracked merchandise, so
      // neither can belong on this page.
      if (type) where.AND = [{ type: ProductType.PRODUCT }];
      else where.type = ProductType.PRODUCT;
      where.tracksStock = true;
    }

    // Explicit [] is restrictive, unlike an omitted filter. Never truncate IDs:
    // pagination bounds returned rows, not the favorite collection's reachability.
    if (ids !== undefined) where.id = { in: [...new Set(ids)] };
    if (available) {
      const eligibility = {
        OR: [
          { type: ProductType.SERVICE },
          { tracksStock: false },
          { stock: { gt: this.prisma.product.fields.reservedStock } },
        ],
      };
      where.AND = [...((where.AND as unknown[]) ?? []), eligibility];
    }

    // 'name' keeps the inventory list's alphabetical presentation coherent
    // across page boundaries; 'createdAt' (default) preserves the legacy order.
    const orderByClause =
      orderBy === 'name'
        ? { name: 'asc' as const }
        : { createdAt: 'desc' as const };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        include: { category: true },
        orderBy: orderByClause,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products.map((p) => this.enrichProduct(p)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
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
      updateProductDto.stock ?? previousStock,
    );

    assertReservationCompatible(existingProduct, {
      ...effectiveSubject,
      stock: newStock,
      active: updateProductDto.active ?? existingProduct.active,
    });

    // Apply the same opt-in tax invariant as create: `taxable=true` requires a
    // positive rate; `taxable=false` forces the stored rate back to 0.
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
          ? { taxable: false, taxRate: 0 }
          : {};

    assertValidPromotion(
      updateProductDto.promotionType,
      updateProductDto.promotionValue,
      Number(updateProductDto.salePrice ?? existingProduct.salePrice),
    );

    const changesEligibility =
      effectiveType !== existingProduct.type ||
      effectiveTracksStock !== existingProduct.tracksStock;

    // Reuse the existing write path without changing ordinary-edit atomicity.
    const writeProduct = async (client: Prisma.TransactionClient) => {
      const updateResult = await client.product.updateMany({
        where: {
          id,
          organizationId,
          version: existingProduct.version,
          reservedStock: existingProduct.reservedStock,
          active: true,
        },
        data: {
          ...updateProductDto,
          ...taxData,
          stock: newStock,
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
          client.inventoryMovement,
        );
      }

      return product;
    };

    const product = changesEligibility
      ? await this.prisma.$transaction(
          async (tx) => {
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
            return writeProduct(tx);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
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
  ) {
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

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      salePrice: p.salePrice,
      stock: p.stock,
      availableStock: availableStock(p),
      taxable: p.taxable,
      taxRate: p.taxRate,
      effectiveTaxRate: resolveEffectiveTaxRate(p, p.category),
      minStock: p.minStock,
      type: p.type,
      tracksStock: p.tracksStock,
      isLowStock: isLowStock(p, p.stock, p.minStock),
      category: p.category,
      imageUrl: p.imageUrl,
      promotionType: p.promotionType,
      promotionValue: p.promotionValue,
      effectiveSalePrice: computeEffectiveSalePrice(p),
    }));
  }

  async quickSearch(code: string, organizationId: string | undefined) {
    const normalizedCode = code.trim();

    if (!normalizedCode) {
      return null;
    }

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

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      salePrice: product.salePrice,
      stock: product.stock,
      availableStock: availableStock(product),
      taxable: product.taxable,
      taxRate: product.taxRate,
      effectiveTaxRate: resolveEffectiveTaxRate(product, product.category),
      minStock: product.minStock,
      type: product.type,
      tracksStock: product.tracksStock,
      isLowStock: isLowStock(product, product.stock, product.minStock),
      category: product.category,
      imageUrl: product.imageUrl,
      promotionType: product.promotionType,
      promotionValue: product.promotionValue,
      effectiveSalePrice: computeEffectiveSalePrice(product),
    };
  }

  /**
   * Enriches a product with effective tax rate information.
   *
   * Uses the shared `resolveEffectiveTaxRate(product, category)` so the
   * read-time value agrees with sale-time resolution (opt-in precedence:
   * product.taxable → category.taxable → 0).
   */
  private enrichWithEffectiveTax<
    T extends {
      taxable: boolean;
      taxRate: Prisma.Decimal | number;
      category?: {
        taxable: boolean;
        defaultTaxRate: Prisma.Decimal | null;
      } | null;
    },
  >(product: T): T & { effectiveTaxRate: number } {
    return {
      ...product,
      effectiveTaxRate: resolveEffectiveTaxRate(product, product.category),
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
   * The single response shape for a persisted product row: promo-aware price, effective
   * tax rate, physical low-stock flag and reservation-aware availability. Every read that
   * returns whole product rows (create,
   * findAll, findOne, update) goes through here, so a new derived field cannot reach only
   * some of the endpoints and leave the client to guess.
   */
  private enrichProduct<
    T extends PromoPricingProduct &
      AvailabilitySubject & {
        taxable: boolean;
        taxRate: Prisma.Decimal | number;
        stock: number;
        minStock: number;
        category?: {
          taxable: boolean;
          defaultTaxRate: Prisma.Decimal | null;
        } | null;
      },
  >(product: T) {
    return {
      ...this.enrichWithLowStock(
        this.enrichWithEffectiveTax(this.enrichWithPromo(product)),
      ),
      availableStock: availableStock(product),
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
