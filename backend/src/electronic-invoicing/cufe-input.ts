/**
 * Turns MeperPOS fiscal facts into the exact CUFE inputs the DIAN Annex 1.9
 * section 11.2 demands. Section 11.2.2 fixes the source of every value:
 *
 *   NumFac  /Invoice/cbc:ID                     prefix concatenated with the consecutive
 *   FecFac  /Invoice/cbc:IssueDate              Bogota calendar date
 *   HorFac  /Invoice/cbc:IssueTime              Bogota time including the GMT offset
 *   ValFac  LegalMonetaryTotal/LineExtensionAmount
 *   ValImp1 TaxTotal of scheme 01 (IVA)
 *   ValImp2 TaxTotal of scheme 04 (INC)
 *   ValImp3 TaxTotal of scheme 03 (ICA)
 *   ValTot  LegalMonetaryTotal/PayableAmount
 *   NitOFE  AccountingSupplierParty/.../CompanyID  without punctuation or check digit
 *   NumAdq  AccountingCustomerParty/.../CompanyID  without punctuation or check digit
 *   ClTec   from the numbering-range query (absent from the XML itself)
 *   TipoAmbiente /Invoice/cbc:ProfileExecutionID
 *
 * The caller supplies already-decided money as decimal strings, so no floating
 * point arithmetic ever touches a fiscal amount.
 *
 * The three tax totals are derived by summing the PERSISTED `SaleItem` rows,
 * routed by each row's `taxCode`, so the CUFE can never book a consumption tax
 * (INC) or an industry-and-commerce tax (ICA) as IVA. Null/mixed policy, pinned
 * by tests:
 *
 *   - every row's `taxCode` is null → a pre-feature sale (spec S7). Those rows
 *     were written before tax codes existed and store no line tax at all, so
 *     the sale-level `taxAmount` is the only truth left: the whole tax is
 *     booked as IVA exactly as before, and INC/ICA stay 0.00.
 *   - at least one row carries a code → the persisted codes are authoritative.
 *     Every taxed row must carry one, otherwise this throws instead of guessing
 *     a tribute code. A coded row whose amount is 0.00 (what `DECIMAL(10,2)`
 *     stores for a sub-cent tax) contributes nothing rather than failing.
 */
import { type DianTaxCode, dianTributeCode } from '../common/utils/tax.util';
import { CufeInput } from './cufe';

const BOGOTA_TIME_ZONE = 'America/Bogota';
/** Colombia has no daylight saving time, so the offset is constant. */
const BOGOTA_UTC_OFFSET = '-05:00';
const PLAIN_DECIMAL = /^([0-9]+)(?:\.([0-9]+))?$/;

export interface CufeSaleTaxLine {
  /** Persisted `SaleItem.taxCode`; null on a pre-feature sale or untaxed line. */
  taxCode: DianTaxCode | null;
  /**
   * Persisted `SaleItem.taxAmount` as a plain decimal string, or null when the
   * line carries no tax. The caller stringifies the Prisma `Decimal`; this
   * module never converts money through `Number`.
   */
  taxAmount: string | null;
}

export interface CufeSaleFacts {
  invoicePrefix: string | null;
  invoiceNumber: string | number;
  issuedAt: Date;
  /** Sale.subtotal: the sum of the line extension amounts, before taxes. */
  lineExtensionAmount: string;
  /**
   * Sale.taxAmount: the invoice-level tax. A line-level sum is NOT used here,
   * because it is zero for sales written before tax codes existed.
   */
  taxAmount: string;
  /** The sale's persisted `SaleItem` rows, the only source of the tax totals. */
  items: readonly CufeSaleTaxLine[];
  /** Sale.total: the amount the buyer actually pays. */
  payableAmount: string;
  issuerTaxId: string;
  buyerTaxId: string;
  technicalKey: string;
  environment?: '1' | '2';
}

/**
 * DIAN wants two truncated decimals, no thousands separators and no currency
 * symbol. Truncation is done on the decimal string, never through `Number`, so
 * 1500000.999 becomes 1500000.99 and never 1500001.00.
 */
export function formatDianAmount(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('Invalid DIAN amount: expected a decimal string');
  }
  const match = PLAIN_DECIMAL.exec(value);
  if (!match) {
    throw new Error(
      `Invalid DIAN amount: expected a plain non-negative decimal, received "${value}"`,
    );
  }
  const integerPart = match[1].replace(/^0+(?=\d)/, '');
  const decimals = (match[2] ?? '').padEnd(2, '0').slice(0, 2);
  return `${integerPart}.${decimals}`;
}

/**
 * DIAN wants the identification without punctuation and without the check
 * digit. A dash is how the check digit is normally attached ("800.197.268-4"),
 * so it is rejected instead of silently hashed: dropping the dash would yield
 * 8001972684, which the annex does not ask for. The check digit has to be
 * removed deliberately by the caller.
 */
export function normalizeDianIdentification(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('Invalid DIAN identification: expected a string');
  }
  const compacted = value.replace(/[.\s]/g, '');
  if (compacted.includes('-')) {
    throw new Error(
      'Invalid DIAN identification: remove the check digit before hashing',
    );
  }
  if (!/^[0-9]+$/.test(compacted)) {
    throw new Error(
      `Invalid DIAN identification: expected digits only, received "${value}"`,
    );
  }
  return compacted;
}

function bogotaParts(date: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

function requireValidDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('Invalid DIAN issue instant: expected a valid Date');
  }
  return value;
}

/** The three DIAN tribute codes, as narrowable keys. */
type TributeCode = ReturnType<typeof dianTributeCode>;

const TAX_CODES: readonly DianTaxCode[] = ['IVA', 'INC', 'ICA'];

/**
 * Integer cents, so money is added without ever going through floating point.
 * The amount is truncated to two decimals first, exactly as the annex asks.
 */
function toCents(value: string): bigint {
  const [units, decimals] = formatDianAmount(value).split('.');
  return BigInt(units) * 100n + BigInt(decimals);
}

function fromCents(cents: bigint): string {
  const units = cents / 100n;
  const decimals = cents % 100n;
  return `${units}.${String(decimals).padStart(2, '0')}`;
}

function requireTaxCode(value: unknown, line: number): DianTaxCode | null {
  if (value === null) {
    return null;
  }
  if (!TAX_CODES.includes(value as DianTaxCode)) {
    throw new Error(
      `Invalid CUFE tax lines: line ${line + 1} carries an unknown tax code`,
    );
  }
  return value as DianTaxCode;
}

/**
 * Sums the persisted tax rows into the three DIAN buckets. See the module
 * comment for the null/mixed policy that decides between the two modes.
 */
function persistedTaxTotals(
  items: readonly CufeSaleTaxLine[],
  saleTaxAmount: string,
): Record<TributeCode, bigint> {
  // `Array.isArray` is avoided on purpose: it narrows a `readonly` array to
  // `any[]` and would silently untype every element below.
  if (!items || items.length === 0) {
    throw new Error(
      'Invalid CUFE tax lines: expected at least one persisted sale line',
    );
  }

  const totals: Record<TributeCode, bigint> = { '01': 0n, '04': 0n, '03': 0n };
  const hasPersistedCode = items.some((item) => item.taxCode != null);

  // Pre-feature sale (S7): no row carries a code and no row stores a line
  // amount, so summing the rows would report 0.00 and silently erase the
  // invoice's tax. The sale-level amount is booked as IVA, as before.
  if (!hasPersistedCode) {
    totals['01'] = toCents(saleTaxAmount);
    return totals;
  }

  items.forEach((item, index) => {
    const code = requireTaxCode(item.taxCode, index);
    const cents =
      item.taxAmount === null || item.taxAmount === undefined
        ? 0n
        : toCents(item.taxAmount);

    // Pre-feature sale: no row carries a code, so nothing is reclassified and
    // the whole tax is reported as IVA, exactly as before tax codes existed.
    if (!hasPersistedCode) {
      totals['01'] += cents;
      return;
    }

    if (code === null) {
      if (cents > 0n) {
        throw new Error(
          `Invalid CUFE tax lines: line ${index + 1} is taxed but carries no tax code`,
        );
      }
      return;
    }

    // A code with no money is a recorded fact, not a guess: `DECIMAL(10,2)` can
    // round a sub-cent tax down to 0.00 while the code stays. It contributes
    // nothing, and failing here would make such a sale impossible to invoice.
    totals[dianTributeCode(code)] += cents;
  });

  return totals;
}

function buildInvoiceNumber(
  prefix: string | null,
  consecutive: string | number,
): string {
  if (typeof consecutive === 'number') {
    if (!Number.isSafeInteger(consecutive) || consecutive < 0) {
      throw new Error(
        'Invalid DIAN invoice number: expected a non-negative integer',
      );
    }
  } else if (!/^[0-9]+$/.test(consecutive)) {
    throw new Error('Invalid DIAN invoice number: expected digits only');
  }
  const digits = String(consecutive);
  if (prefix === null) {
    return digits;
  }
  if (!/^[A-Za-z0-9]+$/.test(prefix)) {
    throw new Error(
      'Invalid DIAN invoice prefix: expected alphanumeric characters',
    );
  }
  return `${prefix}${digits}`;
}

export function resolveCufeInput(facts: CufeSaleFacts): CufeInput {
  const issuedAt = requireValidDate(facts.issuedAt);
  const parts = bogotaParts(issuedAt);
  const taxes = persistedTaxTotals(facts.items, facts.taxAmount);
  // Default to the test environment: no production issuance until the fiscal
  // requirements are confirmed (spec S6). Reject anything else here, where the
  // mistake is made, instead of deferring it to the hash step.
  const environment = facts.environment ?? '2';
  if (environment !== '1' && environment !== '2') {
    throw new Error(
      'Invalid DIAN environment: expected "1" (production) or "2" (test)',
    );
  }

  return {
    invoiceNumber: buildInvoiceNumber(facts.invoicePrefix, facts.invoiceNumber),
    issueDate: `${parts.year}-${parts.month}-${parts.day}`,
    issueTime: `${parts.hour}:${parts.minute}:${parts.second}${BOGOTA_UTC_OFFSET}`,
    taxableAmount: formatDianAmount(facts.lineExtensionAmount),
    vatAmount: fromCents(taxes['01']),
    consumptionTaxAmount: fromCents(taxes['04']),
    icaAmount: fromCents(taxes['03']),
    totalAmount: formatDianAmount(facts.payableAmount),
    issuerTaxId: normalizeDianIdentification(facts.issuerTaxId),
    buyerId: normalizeDianIdentification(facts.buyerTaxId),
    technicalKey: facts.technicalKey,
    environment,
  };
}
