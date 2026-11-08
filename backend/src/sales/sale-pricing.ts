import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { OrgRole, type Category, type Product } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import {
  type DianTaxCode,
  resolveEffectiveTaxCode,
  resolveEffectiveTaxRate,
} from '../common/utils/tax.util';
import { computeEffectiveSalePrice } from '../products/products.service';
import type { SaleItemDto } from './dto/sales.dto';

export type SalePricingProduct = Pick<
  Product,
  | 'id'
  | 'name'
  | 'type'
  | 'tracksStock'
  | 'costPrice'
  | 'salePrice'
  | 'promotionType'
  | 'promotionValue'
  | 'taxable'
  | 'taxRate'
  | 'taxCode'
> & {
  category: Pick<
    Category,
    'taxable' | 'defaultTaxRate' | 'defaultTaxCode'
  > | null;
};

/** Shared POS permission; overrides never grant catalog editing rights. */
export function canOverrideSalePrice(user: RequestUser | undefined): boolean {
  if (!user) return false;
  if (user.isSuperAdmin || user.role === 'SUPER_ADMIN') return true;
  return (
    user.role === OrgRole.ADMIN ||
    user.role === OrgRole.OWNER ||
    user.role === OrgRole.CASHIER
  );
}

/** Server-resolved POS pricing; override permission stays with the caller. */
export function resolveSaleItemPricing(
  product: SalePricingProduct,
  item: Pick<SaleItemDto, 'quantity' | 'unitPrice' | 'discountAmount'>,
  canOverride: boolean,
) {
  const serverUnitPrice = Number(
    computeEffectiveSalePrice(product) ?? product.salePrice,
  );
  const requestedUnitPrice =
    item.unitPrice === undefined || item.unitPrice === null
      ? null
      : Number(item.unitPrice);

  // Service callers may bypass the DTO's nonnegative-price validation.
  if (requestedUnitPrice !== null && requestedUnitPrice < 0) {
    throw new BadRequestException(
      `Unit price for product ${product.name} cannot be negative`,
    );
  }

  // Preserve the existing tolerance for round-tripped DECIMAL(10,2) prices.
  const isOverride =
    requestedUnitPrice !== null &&
    Math.abs(requestedUnitPrice - serverUnitPrice) > 0.01;
  if (isOverride && !canOverride) {
    throw new ForbiddenException(
      `Only an ADMIN, OWNER, SUPER_ADMIN or CASHIER may override the unit price of ${product.name}`,
    );
  }
  const unitPrice = isOverride ? requestedUnitPrice : serverUnitPrice;
  const override = isOverride
    ? {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        serverUnitPrice,
        overriddenUnitPrice: unitPrice,
      }
    : undefined;

  const grossSubtotal = unitPrice * item.quantity;
  const itemDiscount = Math.max(0, item.discountAmount || 0);
  if (itemDiscount > grossSubtotal) {
    throw new BadRequestException(
      `Item discount for product ${product.name} cannot exceed item subtotal`,
    );
  }

  const itemSubtotal = grossSubtotal - itemDiscount;
  const effectiveTaxRate = resolveEffectiveTaxRate(product, product.category);
  // Resolved from the same product/category as the rate, by the same util, so
  // the persisted code and the persisted rate can never describe two different
  // taxes. `null` means "no tax", never "unknown tax".
  const effectiveTaxCode = resolveEffectiveTaxCode(product, product.category);
  const itemTax = itemSubtotal * (effectiveTaxRate / 100);
  const itemTotal = itemSubtotal + itemTax;
  return {
    pricedItem: {
      productId: product.id,
      productType: product.type,
      productTracksStock: product.tracksStock,
      quantity: item.quantity,
      unitPrice,
      costPriceSnapshot: product.costPrice,
      taxRate: effectiveTaxRate,
      taxCode: effectiveTaxCode,
      discountAmount: itemDiscount,
      subtotal: itemSubtotal,
      total: itemTotal,
    },
    // Return the original tax, not total minus subtotal (float cancellation).
    taxAmount: itemTax,
    override,
  };
}

export type PricedSaleItem = ReturnType<
  typeof resolveSaleItemPricing
>['pricedItem'];

/** The per-line fiscal facts `SaleItem` stores, and nothing else. */
export interface PersistedLineTax {
  taxCode: DianTaxCode | null;
  taxAmount: number | null;
}

/**
 * The only place where a line becomes persisted fiscal facts.
 *
 * Invariant: a persisted `taxCode` iff the persisted `taxAmount` is greater than
 * zero. It is enforced here, once, so no caller can persist a code that no tax
 * justifies or a tax that carries no code:
 *
 *   - no tax (an untaxed line, or a taxed rate on a zero-subtotal line) → both
 *     NULL, because a code may never accompany a zero amount (T4a decision);
 *   - tax without a resolved code → throw, since guessing IVA is exactly the
 *     defect T4b removes;
 *   - tax with a code → both persisted.
 *
 * The amount is rounded to cents first, because that is what `DECIMAL(10,2)`
 * stores; deciding on the unrounded value could persist a code next to a 0.00
 * amount for a sub-cent tax.
 *
 * The rounding is the historical JS one, `Math.round(amount * 100) / 100`, and
 * deliberately not a decimal re-derivation. This helper is shared with the cash
 * sale path, whose tax is a JS float: `0.40499999999999997 * 100` is exactly
 * 40.5, so the established answer is 0.41, while `new Decimal(0.40499999999999997)`
 * re-reads the binary value as 0.40499999999999997 and would answer 0.40. The
 * financed path does not depend on this rounding: `reconcileLineTaxes` derives
 * its cents from exact `Decimal` values and only hands whole cents here.
 */
export function toPersistedLineTax(
  taxCode: DianTaxCode | null,
  taxAmount: number,
): PersistedLineTax {
  if (!Number.isFinite(taxAmount)) {
    throw new Error(
      `Invalid line tax amount: expected a finite number, received ${taxAmount}`,
    );
  }
  const persistedAmount = Math.round(taxAmount * 100) / 100;
  if (persistedAmount <= 0) {
    return { taxCode: null, taxAmount: null };
  }
  if (taxCode === null) {
    throw new Error(
      'Cannot persist a taxed sale line without a tax code: resolved a positive tax amount but no DIAN tax code',
    );
  }
  return { taxCode, taxAmount: persistedAmount };
}

/** One priced line's exact tax, before any rounding, as the sale froze it. */
export interface LineTaxBasis {
  /** The resolved catalog code, or null when the line carries no tribute. */
  taxCode: DianTaxCode | null;
  /** The exact tax of this line, unrounded and nonnegative. */
  taxAmount: number | Decimal;
}

/**
 * Distributes a fixed invoice tax across the lines of a sale, to the cent.
 *
 * A financed sale's payable is agreed before the sale exists, so the invoice tax
 * is fixed too: it is one rounding of the unrounded total, which is exactly what
 * this amount was before electronic invoicing. The lines cannot decide it (as
 * they do for a cash sale, where the payable follows their sum), so each line
 * carries its share of that tax instead. Rounding every line on its own does not
 * add up: three lines of 33.33 at 19% round to 6.33 each (18.99) while the
 * agreed tax is 19.00. The missing cent is placed on the lines with the largest
 * fractional part (largest remainder), which keeps every line within one cent of
 * its exact tax and makes the sum exact.
 *
 * Invariants, in order of importance:
 *
 *   - the sum of the returned amounts is exactly `invoiceTaxAmount`;
 *   - a line receives cents only when it has a catalog code, so a tribute can
 *     never be invented for an untaxed line;
 *   - a line that owes tax keeps a code: a taxed line whose share would be zero
 *     cents answers 409 instead of being relabelled as untaxed, because the DIAN
 *     semantics of a positive rate with no tribute are unproven (S6, L72);
 *   - `toPersistedLineTax` keeps the code-iff-amount rule for every line.
 *
 * Fails closed (409) when the tax cannot be distributed honestly: the amount is
 * not a finite, nonnegative whole number of cents, a line carries a fraction of
 * a cent without a code, a taxed line would lose its code, or there are too few
 * coded cents to absorb the remainder. Nothing here changes the payable, the
 * subtotal or the discount.
 */
export function reconcileLineTaxes(
  lines: ReadonlyArray<LineTaxBasis>,
  invoiceTaxAmount: number | Decimal,
): PersistedLineTax[] {
  // `Array.isArray` is avoided on purpose: it narrows a `readonly` array to
  // `any[]` and would silently untype every line below (same gotcha as
  // `fiscal-snapshot.ts`).
  if (!lines || lines.length === 0) {
    throw new ConflictException(
      'La cotización no tiene líneas para conciliar impuestos',
    );
  }
  const invoiceCents = exactCents(
    invoiceTaxAmount,
    'el impuesto de la factura',
  );
  if (!invoiceCents.equals(invoiceCents.toDecimalPlaces(0))) {
    throw new ConflictException(
      'La cotización no concilia impuestos al centavo para facturar electrónicamente',
    );
  }

  let remainderCents = invoiceCents;
  const share = lines.map((line, index) => {
    const exact = exactCents(
      line.taxAmount,
      `el impuesto de la línea ${index + 1}`,
    );
    const cents = exact.toDecimalPlaces(0, Decimal.ROUND_FLOOR);
    remainderCents = remainderCents.minus(cents);
    return {
      index,
      taxCode: line.taxCode,
      cents,
      fraction: exact.minus(cents),
    };
  });

  // A line that rounds up a fraction of a cent without a code cannot receive it
  // without inventing a tribute, so the invoice tax is unreachable: fail closed.
  const uncodeable = share.find(
    (line) => line.taxCode === null && line.fraction.gt(0),
  );
  if (uncodeable) {
    throw new ConflictException(
      'La cotización no concilia impuestos al centavo para facturar electrónicamente',
    );
  }
  // Largest remainder first, then the line's own order: deterministic, and the
  // same quote always allocates the same cents.
  const receivers = [...share]
    .filter((line) => line.fraction.gt(0))
    .sort((a, b) =>
      b.fraction.equals(a.fraction)
        ? a.index - b.index
        : b.fraction.comparedTo(a.fraction),
    );
  if (remainderCents.isNegative() || remainderCents.gt(receivers.length)) {
    throw new ConflictException(
      'La cotización no concilia impuestos al centavo para facturar electrónicamente',
    );
  }
  const extra = new Set(
    receivers.slice(0, remainderCents.toNumber()).map((line) => line.index),
  );

  return share.map((line) => {
    const cents = extra.has(line.index) ? line.cents.plus(1) : line.cents;
    // A line whose exact tax is positive owes a tribute. Giving it zero cents
    // would leave a positive rate with no code, a fiscal fact whose DIAN
    // meaning is not established here (S6), so the sale fails closed instead of
    // silently treating the line as untaxed.
    // A line whose exact tax is positive owes a tribute. Giving it zero cents
    // would leave a positive rate with no code, a fiscal fact whose DIAN
    // meaning is not established here (S6), so the sale fails closed instead of
    // silently treating the line as untaxed.
    if (cents.isZero() && line.fraction.gt(0)) {
      throw new ConflictException(
        'La cotización no permite conservar el código de impuesto de una línea con impuesto',
      );
    }
    return toPersistedLineTax(line.taxCode, cents.div(100).toNumber());
  });
}

/** Exact cents of a money value, refusing anything that is not nonnegative. */
function exactCents(value: number | Decimal, field: string): Decimal {
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    throw new ConflictException(`Importe de ${field} inválido`);
  }
  if (!amount.isFinite() || amount.isNegative()) {
    throw new ConflictException(`Importe inválido para ${field}`);
  }
  return amount.times(100);
}

/** The four invoice money facts a fiscal document records. */
export interface SaleMoneyFacts {
  lineExtensionAmount: number | Decimal | string;
  taxAmount: number | Decimal | string;
  discountAmount: number | Decimal | string;
  payableAmount: number | Decimal | string;
}

/**
 * Whether a sale's money reconciles to the cent, as `DECIMAL(10,2)` stores it.
 *
 * The fiscal snapshot records the four amounts separately, so an invoice must
 * satisfy `lineExtensionAmount + taxAmount - discountAmount = payableAmount`
 * after the same two-decimal rounding the columns and the snapshot apply. A
 * sale-level discount with a fraction of a cent can break it (a 0.005 discount
 * on a 10.00 sale is stored as 0.01 while the payable keeps its own rounding),
 * and an activated organization must fail closed instead of recording a
 * document that contradicts its own lines. An unreadable amount is `false`:
 * this predicate only ever answers "safe to snapshot" or "not safe".
 */
export function saleMoneyReconciles(facts: SaleMoneyFacts): boolean {
  try {
    return centsOf(facts.lineExtensionAmount)
      .plus(centsOf(facts.taxAmount))
      .minus(centsOf(facts.discountAmount))
      .eq(centsOf(facts.payableAmount));
  } catch {
    return false;
  }
}

/** The persisted money of one sale line, as the columns store it. */
export interface SaleLineMoneyFacts {
  subtotal: number | Decimal | string;
  /** Absent on a line that carries no fiscal facts yet (inactive path). */
  taxAmount?: number | Decimal | string | null;
}

/**
 * Whether the invoice-level money also equals the sum of its own lines.
 *
 * `saleMoneyReconciles` answers for the four totals alone; a sale can satisfy it
 * and still contradict its lines, because each line and the header are rounded
 * independently. Two lines of 99.995 are stored as 100.00 each (200.00) while
 * the header subtotal of 199.99 keeps its own rounding, and the document would
 * then report a header its lines do not support. An activated organization fails
 * closed on that instead of freezing the contradiction. Unreadable facts are
 * `false`, like every other answer this module gives about money.
 */
export function saleLinesReconcile(
  lines: ReadonlyArray<SaleLineMoneyFacts>,
  facts: SaleMoneyFacts,
): boolean {
  if (!lines || lines.length === 0) {
    return false;
  }
  try {
    const lineSubtotals = lines.reduce(
      (sum, line) => sum.plus(centsOf(line.subtotal)),
      new Decimal(0),
    );
    const lineTaxes = lines.reduce(
      (sum, line) => sum.plus(centsOf(line.taxAmount ?? 0)),
      new Decimal(0),
    );
    return (
      saleMoneyReconciles(facts) &&
      lineSubtotals.eq(centsOf(facts.lineExtensionAmount)) &&
      lineTaxes.eq(centsOf(facts.taxAmount))
    );
  } catch {
    return false;
  }
}

/** A money fact as whole cents, rounded exactly as storage and the snapshot do. */
function centsOf(value: number | Decimal | string): Decimal {
  const amount = new Decimal(value);
  if (!amount.isFinite()) {
    throw new Error('Invalid sale money fact: expected a finite amount');
  }
  return amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).times(100);
}

/** In-memory value only: copies server-resolved prices, without sale activation. */
export function buildSaleQuote(
  rows: ReadonlyArray<
    Pick<
      PricedSaleItem,
      | 'productId'
      | 'quantity'
      | 'unitPrice'
      | 'discountAmount'
      | 'taxRate'
      | 'taxCode'
      | 'costPriceSnapshot'
    >
  >,
  agreedCustomerTotal: number,
) {
  const items = rows.map((row) =>
    Object.freeze({
      productId: row.productId,
      quantity: row.quantity,
      resolvedUnitPrice: row.unitPrice,
      discountAmount: row.discountAmount,
      taxRate: row.taxRate,
      // The code travels with the rate it was resolved under, so a financed
      // sale cannot be taxed at a rate whose code changed afterwards.
      taxCode: row.taxCode,
      costPriceSnapshot: row.costPriceSnapshot,
    }),
  );
  return Object.freeze({ items: Object.freeze(items), agreedCustomerTotal });
}
