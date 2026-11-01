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
 * Known limitation, pending confirmation (spec S6): MeperPOS stores one
 * `taxAmount` per sale and one `taxRate` per product, with no tax code. The
 * whole tax is therefore reported as IVA (01) and INC/ICA as 0.00. A sale that
 * mixed IVA with INC would produce a CUFE that does not match its own XML.
 */
import { CufeInput } from './cufe';

const BOGOTA_TIME_ZONE = 'America/Bogota';
/** Colombia has no daylight saving time, so the offset is constant. */
const BOGOTA_UTC_OFFSET = '-05:00';
const PLAIN_DECIMAL = /^([0-9]+)(?:\.([0-9]+))?$/;

export interface CufeSaleFacts {
  invoicePrefix: string | null;
  invoiceNumber: string | number;
  issuedAt: Date;
  /** Sale.subtotal: the sum of the line extension amounts, before taxes. */
  lineExtensionAmount: string;
  /** Sale.taxAmount: booked as IVA (01) until a tax code exists. */
  taxAmount: string;
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
    vatAmount: formatDianAmount(facts.taxAmount),
    consumptionTaxAmount: '0.00',
    icaAmount: '0.00',
    totalAmount: formatDianAmount(facts.payableAmount),
    issuerTaxId: normalizeDianIdentification(facts.issuerTaxId),
    buyerId: normalizeDianIdentification(facts.buyerTaxId),
    technicalKey: facts.technicalKey,
    environment,
  };
}
