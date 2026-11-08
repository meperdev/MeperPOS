/**
 * The immutable fiscal snapshot of a sale.
 *
 * A sale registers one `FiscalDocument` whose `snapshot` column records the
 * fiscal facts as they were at sale registration: the invoice money, the
 * parties, and every line with the tax code and tax amount that was persisted
 * beside it. It is captured inside the sale transaction, so editing a product,
 * a category, a customer or the organization afterwards cannot rewrite what the
 * sale declared.
 *
 * It deliberately carries NO CUFE, because the DIAN technical key is not
 * available (spec S6): this module records the inputs a CUFE will later be
 * built from, never the hash itself. It also records no derived tax totals —
 * `cufe-input.ts` derives the three tribute totals from the lines, and a second
 * copy here could disagree with it.
 *
 * Money is normalized to the two decimals the `DECIMAL(10,2)` columns store,
 * through `Decimal`, so the snapshot never disagrees with the row it describes
 * by a floating-point cent.
 */
import { Decimal } from '@prisma/client/runtime/library';
import { DianTaxCode } from '../common/utils/tax.util';

/** Bumped only when the snapshot shape changes in a way readers must notice. */
export const FISCAL_SNAPSHOT_VERSION = 1;

/** The catalog tax codes a line may carry, structurally mirroring the enum. */
const TAX_CODES: readonly DianTaxCode[] = [
  DianTaxCode.IVA,
  DianTaxCode.INC,
  DianTaxCode.ICA,
];

/** A money value as Prisma hands it back (`Decimal`), or a plain value. */
export type SnapshotMoney = Decimal | number | string;

export interface FiscalSnapshotLineInput {
  productId: string;
  quantity: number;
  unitPrice: SnapshotMoney;
  discountAmount: SnapshotMoney;
  subtotal: SnapshotMoney;
  taxRate: SnapshotMoney;
  /** Persisted `SaleItem.taxCode`; null means the line carries no tax. */
  taxCode: DianTaxCode | null;
  /** Persisted `SaleItem.taxAmount`; null iff `taxCode` is null. */
  taxAmount: SnapshotMoney | null;
  total: SnapshotMoney;
}

export interface FiscalSnapshotInput {
  saleId: string;
  saleNumber: number;
  organizationId: string;
  issuedAt: Date;
  /** Organization NIT as it stood at sale registration, or null. */
  issuerTaxId: string | null;
  /** Customer identification as it stood at sale registration, or null. */
  buyerTaxId: string | null;
  lineExtensionAmount: SnapshotMoney;
  taxAmount: SnapshotMoney;
  discountAmount: SnapshotMoney;
  payableAmount: SnapshotMoney;
  amountPaid: SnapshotMoney;
  change: SnapshotMoney | null;
  lines: readonly FiscalSnapshotLineInput[];
}

export interface FiscalSnapshotLine {
  lineNumber: number;
  productId: string;
  quantity: number;
  unitPrice: string;
  discountAmount: string;
  subtotal: string;
  taxRate: string;
  taxCode: DianTaxCode | null;
  taxAmount: string | null;
  total: string;
}

export interface FiscalSnapshot {
  version: number;
  saleId: string;
  saleNumber: number;
  organizationId: string;
  issuedAt: string;
  currency: 'COP';
  issuerTaxId: string | null;
  buyerTaxId: string | null;
  lineExtensionAmount: string;
  taxAmount: string;
  discountAmount: string;
  payableAmount: string;
  amountPaid: string;
  change: string | null;
  lines: FiscalSnapshotLine[];
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid fiscal snapshot ${field}: expected a value`);
  }
  return value;
}

/** A blank optional fact is absent, never whitespace: it is not a NIT. */
function optionalIdentification(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid fiscal snapshot ${field}: expected text or null`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function money(value: SnapshotMoney | null | undefined, field: string): string {
  if (value === null || value === undefined) {
    throw new Error(`Invalid fiscal snapshot money: ${field} is missing`);
  }
  let amount: Decimal;
  try {
    amount = new Decimal(value as Decimal | number | string);
  } catch {
    throw new Error(
      `Invalid fiscal snapshot money: ${field} is not a decimal value`,
    );
  }
  if (!amount.isFinite()) {
    throw new Error(`Invalid fiscal snapshot money: ${field} is not finite`);
  }
  if (amount.isNegative()) {
    throw new Error(
      `Invalid fiscal snapshot money: ${field} cannot be negative`,
    );
  }
  return amount.toFixed(2);
}

function optionalMoney(
  value: SnapshotMoney | null | undefined,
  field: string,
): string | null {
  return value === null || value === undefined ? null : money(value, field);
}

function buildLine(
  line: FiscalSnapshotLineInput,
  lineNumber: number,
): FiscalSnapshotLine {
  const where = `line ${lineNumber}`;
  const productId = requireText(line.productId, `${where} product id`);
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
    throw new Error(
      `Invalid fiscal snapshot quantity: ${where} must be a positive integer`,
    );
  }

  // The same invariant `toPersistedLineTax` enforces when the row is written: a
  // tax code iff a positive tax amount. A snapshot that broke it would later
  // let the CUFE book a tax with no tribute code, or a code with no money.
  const taxCode = line.taxCode;
  if (taxCode !== null) {
    if (!TAX_CODES.includes(taxCode)) {
      throw new Error(
        `Invalid fiscal snapshot tax code: ${where} carries an unknown code`,
      );
    }
    if (line.taxAmount === null || line.taxAmount === undefined) {
      throw new Error(
        `Invalid fiscal snapshot tax amount: ${where} carries a tax code but no tax amount`,
      );
    }
  } else if (line.taxAmount !== null && line.taxAmount !== undefined) {
    throw new Error(
      `Invalid fiscal snapshot tax code: ${where} carries a tax amount but no tax code`,
    );
  }

  return Object.freeze({
    lineNumber,
    productId,
    quantity: line.quantity,
    unitPrice: money(line.unitPrice, `${where} unit price`),
    discountAmount: money(line.discountAmount, `${where} discount`),
    subtotal: money(line.subtotal, `${where} subtotal`),
    taxRate: money(line.taxRate, `${where} tax rate`),
    taxCode,
    taxAmount: optionalMoney(line.taxAmount, `${where} tax amount`),
    total: money(line.total, `${where} total`),
  });
}

/**
 * Builds the frozen snapshot of the fiscal facts. Throws on any fact that
 * cannot be recorded honestly, so the caller's transaction rolls back instead
 * of persisting a sale whose fiscal document lies about it.
 */
export function buildFiscalSnapshot(
  input: FiscalSnapshotInput,
): FiscalSnapshot {
  const saleId = requireText(input.saleId, 'sale id');
  const organizationId = requireText(input.organizationId, 'organization id');
  if (!Number.isSafeInteger(input.saleNumber) || input.saleNumber < 1) {
    throw new Error(
      'Invalid fiscal snapshot sale number: expected a positive integer',
    );
  }
  if (
    !(input.issuedAt instanceof Date) ||
    Number.isNaN(input.issuedAt.getTime())
  ) {
    throw new Error(
      'Invalid fiscal snapshot issue instant: expected a valid Date',
    );
  }
  // `Array.isArray` is avoided on purpose: it narrows a `readonly` array to
  // `any[]` and would silently untype every line below (same gotcha as
  // `cufe-input.ts`).
  if (!input.lines || input.lines.length === 0) {
    throw new Error('Invalid fiscal snapshot: expected at least one sale line');
  }

  const lines = input.lines.map((line, index) => buildLine(line, index + 1));

  return Object.freeze({
    version: FISCAL_SNAPSHOT_VERSION,
    saleId,
    saleNumber: input.saleNumber,
    organizationId,
    issuedAt: input.issuedAt.toISOString(),
    currency: 'COP' as const,
    issuerTaxId: optionalIdentification(input.issuerTaxId, 'issuer tax id'),
    buyerTaxId: optionalIdentification(input.buyerTaxId, 'buyer tax id'),
    lineExtensionAmount: money(
      input.lineExtensionAmount,
      'line extension amount',
    ),
    taxAmount: money(input.taxAmount, 'invoice tax amount'),
    discountAmount: money(input.discountAmount, 'discount amount'),
    payableAmount: money(input.payableAmount, 'payable amount'),
    amountPaid: money(input.amountPaid, 'paid amount'),
    change: optionalMoney(input.change, 'change'),
    lines: Object.freeze(lines) as FiscalSnapshotLine[],
  });
}
