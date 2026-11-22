import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, ProductType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto, UpdateSaleDto } from './dto/sales.dto';
import type { Response } from 'express';
import {
  parseBogotaEndOfDay,
  parseBogotaStartOfDay,
} from '../common/utils/bogota-date';
import { CacheService } from '../common/services/cache.service';
import { SettingsService } from '../settings/settings.service';
import { computeSkipTake } from '../common/utils/pagination';
import {
  allocateSaleDiscount,
  canOverrideSalePrice,
  resolveSaleItemPricing,
  saleLinesReconcile,
  toPersistedLineTax,
  type PricedSaleItem,
} from './sale-pricing';
import { tracksStock } from '../products/product-type.logic';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { SequenceService } from '../common/sequences/sequence.service';
import { PLAN_LIMITS } from '../plan-limits/plan-limits.constants';
import { ReceiptsService } from '../receipts/receipts.service';
import { emitFiscalDocumentForSale } from '../electronic-invoicing/fiscal-emission';
import { voidSaleFiscalDocument } from '../electronic-invoicing/fiscal-document.service';
import { isElectronicInvoicingActive } from '../settings/schema';
import { resolveWritableSiteWithin } from '../locations/authorized-site';

/**
 * A POS-financed sale carries no cash/card rows, so the derived flag travels
 * with the payload instead of the relation: the UI renders it as its own
 * payment state ("Financiado") next to cash, card and mixed.
 */
function withFinancedFlag<
  T extends { posLoanSaleIntent?: { id: string } | null },
>(sale: T): Omit<T, 'posLoanSaleIntent'> & { financed: boolean } {
  const { posLoanSaleIntent, ...rest } = sale;
  return { ...rest, financed: Boolean(posLoanSaleIntent) };
}

/**
 * The idempotency key of `POST /api/sales` (SEC-014), stored the way the loans
 * module stores its own: only the SHA-256 of the normalized request reaches the
 * database. The actor is part of the hashed request, so one user's key can never
 * replay another user's sale even though the unique index is per organization.
 * The request key itself is part of the digest: two different keys with an
 * identical payload are two deliberate sales, not one replay.
 */
function saleRequestKeyHash(dto: CreateSaleDto, userId: string): string | null {
  if (!dto.requestKey) return null;
  const money = (value: number) => new Prisma.Decimal(value).toString();
  const items = Array.isArray(dto.items) ? dto.items : [];
  const payments = Array.isArray(dto.payments) ? dto.payments : [];
  const payload = {
    userId,
    requestKey: dto.requestKey,
    customerId: dto.customerId ?? null,
    discountAmount: money(dto.discountAmount ?? 0),
    items: items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice:
        item.unitPrice === undefined || item.unitPrice === null
          ? null
          : money(item.unitPrice),
      discountAmount: money(item.discountAmount ?? 0),
    })),
    payments: payments.map((payment) => ({
      method: payment.method,
      amount: money(payment.amount),
    })),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** PostgreSQL codes that mean the transaction lost a concurrency race. */
const SERIALIZATION_PG_CODES = ['40001', '40P01'];

/** Prisma codes that mean another transaction got there first. */
function isConcurrentSaleConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code === 'P2034' || error.code === 'P2002') {
    return true;
  }
  // The sequence's `SELECT ... FOR UPDATE` runs through `$queryRaw`, and Prisma
  // reports PostgreSQL's 40001 there as P2010 with the database code in `meta`
  // instead of P2034. This is the variant a concurrent point of sale actually
  // hits, so it must map to the same bounded retry.
  if (error.code === 'P2010') {
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
  return false;
}

/** Whether a unique violation is the sale idempotency index. */
function isRequestKeyCollision(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target : [target];
  return fields.some(
    (field) =>
      typeof field === 'string' &&
      field.toLowerCase().includes('requestkeyhash'),
  );
}

@Injectable()
export class SalesService {
  /** Prisma select for seller attribution on every sale query */
  private readonly sellerInclude = {
    user: { select: { id: true, name: true, email: true } },
  } as const;

  /** Presence of the POS loan intent is what marks a sale as financed. */
  private readonly financingInclude = {
    posLoanSaleIntent: { select: { id: true } },
  } as const;

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private settingsService: SettingsService,
    private sequenceService: SequenceService,
    private receiptsService: ReceiptsService,
  ) {}

  /**
   * Centralized role-aware scope filter for sale queries.
   * - ADMIN → sees all sales (no filter)
   * - CASHIER → own sales only (sale.userId = user.userId)
   * - Default (INVENTORY_USER / unknown) → own sales only (deny-by-default)
   */
  private buildScopeFilter(user: RequestUser): Record<string, unknown> {
    if (user.role === 'ADMIN') {
      return {};
    }
    // Deny-by-default: any non-ADMIN role sees only own sales
    return { userId: user.userId };
  }

  /**
   * Price overrides explicitly allow cashiers and managers, not MEMBER.
   * Missing principals are denied; this permission does not change role inheritance.
   */
  private canOverridePrice(user: RequestUser | undefined): boolean {
    return canOverrideSalePrice(user);
  }

  /**
   * Writes the audit trail for a single overridden sale line.
   *
   * Follows the `audit(...)` convention of `ExpenseTaxonomyService` (one
   * SCREAMING_SNAKE action, a `resource`/`resourceId` pair, and a JSON
   * `metadata` payload) with the actor on `userId` as `ExpensesService` does.
   * `AuditLog` has no dedicated price columns, so the original and overridden
   * prices live in `metadata` — the model can carry them without a migration.
   *
   * Called inside the sale transaction on purpose: an audit trail that can be
   * lost because a separate write failed is not an audit trail.
   */
  private async auditPriceOverride(
    tx: Prisma.TransactionClient,
    entry: {
      saleId: string;
      saleNumber: number;
      productId: string;
      productName: string;
      quantity: number;
      serverUnitPrice: number;
      overriddenUnitPrice: number;
      userId: string;
      organizationId: string;
      actorRole: string;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: entry.userId,
        action: 'SALE_PRICE_OVERRIDE',
        resource: 'Sale',
        resourceId: entry.saleId,
        organizationId: entry.organizationId,
        metadata: {
          summary: `Price override on sale #${entry.saleNumber}: ${entry.productName} charged at ${entry.overriddenUnitPrice} instead of ${entry.serverUnitPrice}`,
          saleId: entry.saleId,
          saleNumber: entry.saleNumber,
          productId: entry.productId,
          productName: entry.productName,
          quantity: entry.quantity,
          originalUnitPrice: entry.serverUnitPrice,
          overriddenUnitPrice: entry.overriddenUnitPrice,
          actorRole: entry.actorRole,
          timestamp: new Date().toISOString(),
        },
      },
    });
  }

  async create(
    createSaleDto: CreateSaleDto,
    userId: string,
    organizationId: string | undefined,
    user?: RequestUser,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const { customerId, items, discountAmount = 0, payments, locationId } =
      createSaleDto;

    if (items.length === 0) {
      throw new BadRequestException('Sale must have at least one item');
    }

    if (!payments || payments.length === 0) {
      throw new BadRequestException(
        'Sale must have at least one payment method',
      );
    }

    // SEC-014: the idempotency key is hashed from the normalized request. A
    // replay returns the sale it already registered, before pricing, numbering
    // or stock are touched.
    const requestKeyHash = saleRequestKeyHash(createSaleDto, userId);
    if (requestKeyHash) {
      const replayId = await this.findSaleIdByRequestKey(
        organizationId,
        requestKeyHash,
        locationId,
      );
      if (replayId) {
        return this.findOne(replayId, organizationId);
      }
    }

    let subtotal = 0;
    const pricedItems: PricedSaleItem[] = [];

    // Manager-approved price overrides awaiting their audit rows. Collected
    // here so the audit is written against the persisted sale, inside the same
    // transaction that writes it.
    const priceOverrides: Array<{
      productId: string;
      productName: string;
      quantity: number;
      serverUnitPrice: number;
      overriddenUnitPrice: number;
    }> = [];

    for (const item of items) {
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, organizationId },
        include: { category: true },
      });

      if (!product) {
        throw new NotFoundException(
          `Product with ID ${item.productId} not found`,
        );
      }

      if (!product.active) {
        throw new BadRequestException(`Product ${product.name} is not active`);
      }

      // Overrides authorize an audited POS price, not a catalog price edit.
      const { pricedItem, override } = resolveSaleItemPricing(
        product,
        item,
        this.canOverridePrice(user),
      );
      if (override) priceOverrides.push(override);
      subtotal += pricedItem.subtotal;
      pricedItems.push(pricedItem);
    }

    // SEC-015: the sale-wide discount is a pre-tax discount. It may never
    // exceed the gross subtotal, and it reduces each line's taxable base before
    // that line's tax is computed — the same peso of discount must not be taxed
    // differently depending on whether it was entered per item or per sale.
    //
    // The stored `subtotal` stays gross and the whole discount stays on the
    // header, which is what keeps the invoice identity
    // (`subtotal + tax − discount = total`) and the line sum true; the allocated
    // shares only move the taxable base. The subtotal is compared as the
    // DECIMAL(10,2) it will be stored as, so a float artifact (0.7 × 3 =
    // 2.0999999999999996) cannot reject a discount that equals it to the cent.
    const requestedDiscount = new Prisma.Decimal(discountAmount);
    const grossSubtotal = new Prisma.Decimal(subtotal).toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_HALF_UP,
    );
    if (requestedDiscount.gt(grossSubtotal)) {
      throw new BadRequestException(
        'El descuento no puede exceder el subtotal',
      );
    }
    const discountShares = allocateSaleDiscount(
      pricedItems.map((pricedItem) => pricedItem.subtotal),
      requestedDiscount,
    );

    // The fiscal facts are derived once, from each discounted line, and enforced
    // by `toPersistedLineTax`: a code iff the amount is greater than zero. The
    // rounded value is what gets persisted, so the rounded value is also what
    // accumulates: the CUFE and the invoice sum the persisted rows, and
    // `Sale.taxAmount` has to agree with them to the cent.
    let totalTax = 0;
    const saleItems = pricedItems.map((pricedItem, index) => {
      const taxableBase = new Prisma.Decimal(pricedItem.subtotal).minus(
        discountShares[index],
      );
      const persistedTax = toPersistedLineTax(
        pricedItem.taxCode,
        taxableBase.toNumber() * (pricedItem.taxRate / 100),
      );
      totalTax += persistedTax.taxAmount ?? 0;
      return {
        ...pricedItem,
        ...persistedTax,
        // The line already lost its share of the sale-wide discount from the
        // taxable base, so its total is that base plus the tax charged on it.
        total: taxableBase.toNumber() + (persistedTax.taxAmount ?? 0),
      };
    });

    // The sale's own money facts are the DECIMAL(10,2) values the columns store,
    // so the payable is derived from the stored subtotal: a float artifact of a
    // cent-exact discount (0.7 × 3) must not turn into a negative payable. The
    // arithmetic stays in `Decimal` so a sub-cent discount keeps its exact
    // payable (9.995), which activated organizations still refuse to invoice.
    const total = grossSubtotal
      .plus(new Prisma.Decimal(totalTax))
      .minus(requestedDiscount)
      .toNumber();

    if (total < 0) {
      throw new BadRequestException('Total cannot be negative');
    }

    const totalPaid = payments.reduce(
      (sum, payment) => sum + payment.amount,
      0,
    );

    if (totalPaid < total) {
      throw new BadRequestException(
        `Total paid (${totalPaid}) is less than total (${total})`,
      );
    }

    // An overpaid sale hands money back, and change only leaves the drawer as
    // cash: a card or a transfer can never return it. On a positive total every
    // tender must also be needed. A tender that can be dropped while the rest
    // covers the total would create an artificial overpayment (S3: cash 112.931 plus a
    // 100.000 transfer on a 112.931 total used to be accepted as a 212.931
    // payment). Change is the overpaid amount itself.
    //
    // Cents are the unit a sale can store. The POS total is a JS float while
    // each line tax is persisted rounded to cents, so a taxed price that is not
    // a multiple of 10 leaves the two a fraction of a cent apart (net 1006 at
    // 19% → 1197.1399999999999): without this rounding, paying that displayed
    // total by card was refused as a 2e-13 surplus, and paying it in cash
    // persisted a 2e-13 change that DECIMAL(10,2) stores as 0.00.
    const overpay = Math.round((totalPaid - total) * 100) / 100;
    if (overpay > 0) {
      if (!payments.some((p) => p.method === 'CASH')) {
        throw new BadRequestException(
          `Change (${overpay}) can only be handed back in cash: card and transfer payments never return change`,
        );
      }
      // With nothing to collect (SEC-015), only cash may be handed back.
      const unneeded = payments.find((p) =>
        total > 0 ? p.amount <= overpay : p.method !== 'CASH',
      );
      if (unneeded) {
        throw new BadRequestException(
          `Payment ${unneeded.method} (${unneeded.amount}) is not needed: the other payments already cover the total (${total})`,
        );
      }
    }

    const change = overpay > 0 ? overpay : null;

    // The buyer identification is a fiscal fact of the sale, captured now
    // because the customer row may be edited afterwards.
    let customerDocumentNumber: string | null = null;

    if (customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, organizationId },
      });
      if (!customer) {
        throw new NotFoundException('Customer not found');
      }
      customerDocumentNumber = customer.documentNumber;
    }

    const year = new Date().getFullYear();

    // The transaction is a unit: SEC-012 retries it whole. Everything that
    // identifies the sale (number, stock claim, fiscal document) is claimed
    // inside it, so a retry starts from a rolled-back state and re-reads them.
    const runSaleTransaction = () =>
      this.prisma.$transaction(
        async (tx) => {
          const origin = locationId === undefined
            ? undefined
            : await this.resolveSaleLocation(tx, user, userId, organizationId, locationId);
          if (origin) {
            // Global stock is safe for an explicit site only while this is the
            // sole principal site in the entire tenant, not just in the grant list.
            const sites = await tx.location.findMany({
              where: { organizationId },
              select: { id: true, isDefault: true },
              take: 2,
            });
            if (sites.length !== 1 || !sites[0].isDefault || sites[0].id !== origin.locationId) {
              throw new ConflictException(
                'El stock global solo permite ventas en la única sede principal',
              );
            }
          }
          const { number: saleNumber } = await this.sequenceService.nextNumber(
            tx,
            organizationId,
            'SALE',
            year,
          );

          const createdSale = await tx.sale.create({
            data: {
              saleNumber,
              customerId,
              subtotal,
              taxAmount: totalTax,
              discountAmount,
              total,
              amountPaid: totalPaid,
              change,
              status: 'COMPLETED',
              userId,
              organizationId,
              // SEC-014: the idempotency digest travels with the sale it
              // identifies, written in the same transaction.
              requestKeyHash,
            },
          });

          if (origin) {
            await tx.saleOriginSite.create({
              data: { saleId: createdSale.id, ...origin },
            });
          }

          for (const saleItem of saleItems) {
            await tx.saleItem.create({
              data: {
                saleId: createdSale.id,
                productId: saleItem.productId,
                quantity: saleItem.quantity,
                unitPrice: saleItem.unitPrice,
                costPriceSnapshot: saleItem.costPriceSnapshot,
                taxRate: saleItem.taxRate,
                // Persisted inside the sale transaction, beside the line they
                // belong to: the CUFE and the XML read these rows, never the
                // catalog, so a later product edit cannot rewrite history.
                taxCode: saleItem.taxCode,
                taxAmount: saleItem.taxAmount,
                discountAmount: saleItem.discountAmount,
                subtotal: saleItem.subtotal,
                total: saleItem.total,
                organizationId,
              },
            });

            // A service is sold labour, not merchandise: it has no stock to
            // guard, decrement or record. The flag travels with the computed
            // sale line, read from the product row that priced it.
            if (
              tracksStock({
                type: saleItem.productType,
                tracksStock: saleItem.productTracksStock,
              })
            ) {
              // Read inside the transaction, including repeated lines for the
              // same product: each decrement advances its version.
              const observed = await tx.product.findFirst({
                where: { id: saleItem.productId, organizationId },
                select: { stock: true, reservedStock: true, version: true },
              });
              if (
                !observed ||
                !Number.isInteger(observed.version) ||
                !Number.isInteger(observed.reservedStock) ||
                observed.reservedStock < 0 ||
                observed.stock - observed.reservedStock < saleItem.quantity
              ) {
                throw new ConflictException(
                  `Insufficient stock for product ${saleItem.productId}`,
                );
              }
              const updatedProduct = await tx.product.updateMany({
                where: {
                  id: saleItem.productId,
                  organizationId,
                  active: true,
                  type: ProductType.PRODUCT,
                  tracksStock: true,
                  version: observed.version,
                  reservedStock: observed.reservedStock,
                  stock: { gte: observed.reservedStock + saleItem.quantity },
                },
                data: {
                  stock: { decrement: saleItem.quantity },
                  version: { increment: 1 },
                },
              });

              if (updatedProduct.count === 0) {
                throw new ConflictException(
                  `Insufficient stock for product ${saleItem.productId}`,
                );
              }

              const productAfterUpdate = await tx.product.findFirst({
                where: { id: saleItem.productId, organizationId },
                select: { stock: true },
              });

              if (!productAfterUpdate) {
                throw new NotFoundException(
                  `Product with ID ${saleItem.productId} not found`,
                );
              }

              const newStock = productAfterUpdate.stock;
              const previousStock = newStock + saleItem.quantity;

              await tx.inventoryMovement.create({
                data: {
                  productId: saleItem.productId,
                  type: 'SALE' as const,
                  quantity: -saleItem.quantity,
                  previousStock,
                  newStock,
                  reason: `Sale #${saleNumber}`,
                  userId,
                  saleId: createdSale.id,
                  organizationId,
                  ...(origin ? { locationId: origin.locationId } : {}),
                },
              });
            }
          }

          // Every override leaves a trail, written in the same transaction as
          // the sale it explains: if the audit cannot be persisted, the sale
          // rolls back with it.
          for (const override of priceOverrides) {
            await this.auditPriceOverride(tx, {
              saleId: createdSale.id,
              saleNumber,
              userId,
              organizationId,
              actorRole: user?.role ?? 'UNKNOWN',
              ...override,
            });
          }

          for (const payment of payments) {
            await tx.payment.create({
              data: {
                saleId: createdSale.id,
                method: payment.method,
                amount: payment.amount,
                organizationId,
              },
            });
          }

          // Spec S8: an activated organization's sale is snapshotted with its
          // four money facts recorded separately, so they have to add up to the
          // cent. A sale-wide discount with a fraction of a cent can break that
          // (a 0.005 discount on a 10.00 sale is stored as 0.01 while the
          // payable keeps its own rounding), and recording a document that
          // contradicts itself is worse than refusing the sale. Spec S9: an
          // organization that has not activated electronic invoicing writes no
          // document and keeps its previous behaviour exactly, including such a
          // discount.
          const activation = await tx.organization.findFirst({
            where: { id: organizationId },
            select: { settings: true },
          });
          if (
            isElectronicInvoicingActive(activation?.settings) &&
            !saleLinesReconcile(saleItems, {
              lineExtensionAmount: subtotal,
              taxAmount: totalTax,
              discountAmount,
              payableAmount: total,
            })
          ) {
            throw new ConflictException(
              'La venta no concilia sus importes al centavo para facturar electrónicamente',
            );
          }
          // Spec S8: every activated organization's sale emits its fiscal
          // document at sale registration, inside this transaction, so a sale
          // can never exist without it and a document can never describe a sale
          // that rolled back. Spec S9: an organization that has not activated
          // electronic invoicing emits nothing and its sale proceeds unchanged.
          // No CUFE is computed here: the technical key is not available
          // (spec S6).
          await emitFiscalDocumentForSale(tx, {
            saleId: createdSale.id,
            saleNumber,
            organizationId,
            issuedAt: createdSale.createdAt,
            buyerTaxId: customerDocumentNumber,
            // The values this transaction persisted, not a re-derivation: the
            // snapshot has to describe the sale it belongs to.
            lineExtensionAmount: subtotal,
            taxAmount: totalTax,
            discountAmount,
            payableAmount: total,
            amountPaid: totalPaid,
            change,
            lines: saleItems.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountAmount: item.discountAmount,
              subtotal: item.subtotal,
              taxRate: item.taxRate,
              taxCode: item.taxCode,
              taxAmount: item.taxAmount,
              total: item.total,
            })),
          });

          return createdSale;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        },
      );

    // SEC-012: a serialization failure or a sale-number collision is a
    // legitimate conflict of the point of sale, never an internal error. The
    // whole transaction rolled back, so it is retried exactly once; a second
    // failure answers 409 instead of 500.
    for (let attempt = 0; ; attempt += 1) {
      try {
        const sale = await runSaleTransaction();

        this.cache.clear('dashboard:');

        return await this.findOne(sale.id, organizationId);
      } catch (error) {
        // A concurrent duplicate of this same request lost the unique race on
        // the idempotency index: the sale that already exists is the answer.
        if (requestKeyHash && isRequestKeyCollision(error)) {
          const replayId = await this.findSaleIdByRequestKey(
            organizationId,
            requestKeyHash,
            locationId,
          );
          if (replayId) {
            return this.findOne(replayId, organizationId);
          }
        }
        if (isConcurrentSaleConflict(error) && attempt === 0) {
          continue;
        }
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2028'
        ) {
          throw new ServiceUnavailableException('Intente nuevamente');
        }
        if (isConcurrentSaleConflict(error)) {
          throw new ConflictException(
            'La venta no pudo completarse por concurrencia, reintentá',
          );
        }
        throw error;
      }
    }
  }

  private resolveSaleLocation(
    tx: Prisma.TransactionClient,
    user: RequestUser | undefined,
    userId: string,
    organizationId: string,
    locationId: string,
  ) {
    if (user?.userId !== userId || user.organizationId !== organizationId) {
      throw new ForbiddenException('Organization scope required');
    }
    return resolveWritableSiteWithin(tx, user, locationId);
  }

  /** Replay legacy digests unchanged, but never switch an explicit origin. */
  private async findSaleIdByRequestKey(
    organizationId: string,
    requestKeyHash: string,
    locationId: string | undefined,
  ): Promise<string | null> {
    const where = { organizationId, requestKeyHash };
    if (locationId === undefined) {
      const sale = await this.prisma.sale.findFirst({ where, select: { id: true } });
      return sale?.id ?? null;
    }
    const sale = await this.prisma.sale.findFirst({
      where,
      select: { id: true, originSite: { select: { locationId: true } } },
    });
    if (sale && sale.originSite?.locationId !== locationId) {
      throw new ConflictException(
        'La solicitud ya corresponde a una venta con otra atribución de sede',
      );
    }
    return sale?.id ?? null;
  }

  async findAll(
    organizationId: string | undefined,
    page = 1,
    limit = 10,
    startDate?: string,
    endDate?: string,
    status?: string,
    search?: string,
    customerId?: string,
    user?: RequestUser,
  ) {
    const { skip, take } = computeSkipTake(page, limit);

    const where: Record<string, unknown> = {
      ...(organizationId ? { organizationId } : {}),
      ...(user ? this.buildScopeFilter(user) : {}),
    };

    if (status) {
      where.status = status as never;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (startDate || endDate) {
      const createdAtFilter: Record<string, Date> = {};

      const startDateFilter = parseBogotaStartOfDay(startDate);
      if (startDateFilter) {
        createdAtFilter.gte = startDateFilter;
      }

      const endDateFilter = parseBogotaEndOfDay(endDate);
      if (endDateFilter) {
        createdAtFilter.lte = endDateFilter;
      }

      where.createdAt = createdAtFilter;
    }

    const normalizedSearch = search?.trim();
    if (normalizedSearch) {
      const orFilters: Record<string, unknown>[] = [
        {
          customer: {
            is: {
              name: {
                contains: normalizedSearch,
                mode: 'insensitive' as const,
              },
            },
          },
        },
      ];

      const saleNumber = Number.parseInt(normalizedSearch, 10);
      if (!Number.isNaN(saleNumber)) {
        orFilters.push({ saleNumber });
      }

      where.OR = orFilters;
    }

    const [sales, total] = await Promise.all([
      this.prisma.sale.findMany({
        where: where as never,
        skip,
        take,
        include: {
          customer: true,
          items: {
            include: { product: true },
          },
          payments: true,
          ...this.financingInclude,
          ...this.sellerInclude,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.sale.count({ where: where as never }),
    ]);

    return {
      data: sales.map(withFinancedFlag),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(
    id: string,
    organizationId: string | undefined,
    user?: RequestUser,
  ) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
      include: {
        customer: true,
        items: {
          include: { product: true },
        },
        payments: true,
        ...this.financingInclude,
        ...this.sellerInclude,
      },
    });

    if (!sale) {
      throw new NotFoundException('Sale not found');
    }

    // Deny-by-default: if user context is provided, enforce scope
    if (user && user.role !== 'ADMIN' && sale.userId !== user.userId) {
      throw new ForbiddenException('You do not have access to this sale');
    }

    return withFinancedFlag(sale);
  }

  async findBySaleNumber(saleNumber: number, user?: RequestUser) {
    if (!user || !user.organizationId) {
      return null;
    }
    const sale = await this.prisma.sale.findUnique({
      where: {
        organizationId_saleNumber: {
          organizationId: user.organizationId,
          saleNumber,
        },
      },
      include: {
        customer: true,
        items: {
          include: { product: true },
        },
        payments: true,
        ...this.financingInclude,
        ...this.sellerInclude,
      },
    });

    if (!sale) {
      return null;
    }

    // Deny-by-default: if user context is provided, enforce scope
    if (user && user.role !== 'ADMIN' && sale.userId !== user.userId) {
      throw new ForbiddenException('You do not have access to this sale');
    }

    return withFinancedFlag(sale);
  }

  async update(
    id: string,
    updateSaleDto: UpdateSaleDto,
    userId: string,
    organizationId: string | undefined,
    user?: RequestUser,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const existingSale = await this.prisma.sale.findFirst({
      where: { id, organizationId },
      include: {
        items: true,
        ...(updateSaleDto.status === 'CANCELLED'
          ? { originSite: { select: { locationId: true } } }
          : {}),
      },
    });

    if (!existingSale) {
      throw new NotFoundException('Sale not found');
    }

    // Deny-by-default: non-ADMIN users can only update own sales
    if (user && user.role !== 'ADMIN' && existingSale.userId !== user.userId) {
      throw new ForbiddenException('You do not have access to this sale');
    }

    if (existingSale.status !== 'COMPLETED') {
      throw new BadRequestException('Only completed sales can be updated');
    }

    if (updateSaleDto.status === 'CANCELLED') {
      const intent = await this.prisma.posLoanSaleIntent.findFirst({
        where: { finalSaleId: existingSale.id, organizationId },
        select: { id: true },
      });
      if (intent) {
        throw new ConflictException(
          'No se puede cancelar ni devolver una venta vinculada a financiación',
        );
      }
    }

    if (updateSaleDto.status === 'CANCELLED') {
      const locationId = existingSale.originSite?.locationId;
      await this.prisma.$transaction(async (tx) => {
        if (locationId !== undefined) {
          await this.resolveSaleLocation(tx, user, userId, organizationId, locationId);
        }
        // Sale has no version column. Claim its expected state before effects;
        // a concurrent loser cannot restore inventory a second time.
        const claimed = await tx.sale.updateMany({
          where: { id, organizationId, status: 'COMPLETED' },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledById: userId,
            cancelReason: updateSaleDto.cancelReason ?? null,
          },
        });
        if (claimed.count === 0) {
          throw new BadRequestException('Only completed sales can be updated');
        }
        // Spec S8: cancelling the sale voids its pending document in the same
        // transaction. A document already resolved cannot be voided, and the
        // cancellation is refused instead of leaving the two records disagreeing.
        await voidSaleFiscalDocument(tx, {
          saleId: existingSale.id,
          organizationId: existingSale.organizationId,
        });
        for (const item of existingSale.items) {
          const product = await tx.product.findFirst({
            where: {
              id: item.productId,
              organizationId: existingSale.organizationId,
            },
          });

          if (product && tracksStock(product)) {
            if (
              !Number.isInteger(product.version) ||
              !Number.isInteger(product.reservedStock) ||
              product.reservedStock < 0 ||
              product.reservedStock > product.stock
            ) {
              throw new ConflictException(
                `Stock changed for product ${item.productId}`,
              );
            }
            const previousStock = product.stock;
            const newStock = previousStock + item.quantity;

            const restored = await tx.product.updateMany({
              where: {
                id: item.productId,
                organizationId,
                version: product.version,
                reservedStock: product.reservedStock,
              },
              data: {
                stock: { increment: item.quantity },
                version: { increment: 1 },
              },
            });
            if (restored.count === 0) {
              throw new ConflictException(
                `Stock changed for product ${item.productId}`,
              );
            }

            await tx.inventoryMovement.create({
              data: {
                productId: item.productId,
                type: 'RETURN' as const,
                quantity: item.quantity,
                previousStock,
                newStock,
                reason: `Sale #${existingSale.saleNumber} cancelled`,
                userId,
                saleId: existingSale.id,
                organizationId: existingSale.organizationId,
                ...(locationId === undefined ? {} : { locationId }),
              },
            });
          }
        }
      });

      return this.findOne(id, organizationId);
    }

    return this.findOne(id, organizationId);
  }

  /**
   * Force-closes an OPEN sale. Currently disabled because the application
   * does not support creating sales with status OPEN (all sales are created
   * as COMPLETED). This method is preserved for future use when open-sale
   * workflows are implemented.
   */
  async forceClose(
    id: string,
    organizationId: string | undefined,
    reason?: string,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    if (!['BASIC', 'PRO'].includes(organization.plan)) {
      throw new BadRequestException('Invalid organization plan');
    }

    if (!PLAN_LIMITS[organization.plan].hasForceClose) {
      throw new ForbiddenException('Force close is only available on PRO plan');
    }

    const sale = await this.prisma.sale.findFirst({
      where: { id, organizationId },
    });

    if (!sale) {
      throw new NotFoundException('Sale not found');
    }

    if ((sale.status as string) !== 'OPEN') {
      throw new BadRequestException('Only open sales can be force closed');
    }

    await this.prisma.sale.update({
      where: { id },
      data: {
        status: 'CLOSED' as never,
        ...(reason ? { cancelReason: reason } : {}),
      },
    });

    this.cache.clear('dashboard:');

    return this.findOne(id, organizationId);
  }

  /**
   * Generates the sale receipt PDF. Rendering lives in ReceiptsService
   * (data-in/Buffer-out); this method keeps HTTP response handling.
   */
  async generateReceipt(id: string, response: Response, user?: RequestUser) {
    const sale = await this.findOne(id, user?.organizationId, user);
    const settings = await this.settingsService.find(user?.organizationId);
    const pdf = await this.receiptsService.generateSaleReceiptPdf(
      sale,
      settings,
    );
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename=comprobante_${sale.saleNumber}.pdf`,
    );
    response.send(pdf);
  }
}
