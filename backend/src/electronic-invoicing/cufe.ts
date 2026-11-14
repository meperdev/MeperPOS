import { createHash } from 'node:crypto';

/**
 * CUFE (Codigo Unico de Factura Electronica) as defined by DIAN Annex 1.9
 * section 11.2: the SHA-384 of `NumFac + FecFac + HorFac + ValFac + CodImp1 +
 * ValImp1 + CodImp2 + ValImp2 + CodImp3 + ValImp3 + ValTot + NitOFE + NumAdq +
 * ClTec + TipoAmbie`, with no separators.
 *
 * This is an isolated primitive. It does not issue, sign or transmit documents,
 * and it is not wired to sales.
 *
 * Inputs must already be formatted as the annex publishes them: monetary values
 * are decimal strings with exactly two truncated decimals, identification
 * numbers carry no punctuation or check digit, `issueDate` is `yyyy-MM-dd` and
 * `issueTime` is `hh:mm:ss` followed by a UTC offset.
 *
 * Every one of the 15 concatenated fields is validated, because `Array#join`
 * coerces `null`/`undefined` to an empty string: an unvalidated field would
 * silently produce a plausible hash over the wrong bytes instead of failing.
 * Any format rule beyond the annex example is conservative and stays pending
 * until the fiscal requirements are confirmed (spec S6).
 */
export interface CufeInput {
  invoiceNumber: string;
  issueDate: string;
  issueTime: string;
  taxableAmount: string;
  vatAmount: string;
  consumptionTaxAmount: string;
  icaAmount: string;
  totalAmount: string;
  issuerTaxId: string;
  buyerId: string;
  technicalKey: string;
  environment: '1' | '2';
}

/** Whitespace would change the hashed bytes unnoticed. */
const WHITESPACE = /\s/;
const MONETARY_AMOUNT = /^[0-9]+\.[0-9]{2}$/;
const IDENTIFICATION = /^[0-9]+$/;
const CALENDAR_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const CLOCK_TIME =
  /^([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])[+-]([01][0-9]|2[0-3]):([0-5][0-9])$/;
const TECHNICAL_KEY = /^[A-Za-z0-9]+$/;

/** Control characters would likewise change the hashed bytes unnoticed. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function requireText(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid CUFE ${field}: expected a non-empty string`);
  }
  if (WHITESPACE.test(value) || hasControlCharacter(value)) {
    throw new Error(
      `Invalid CUFE ${field}: whitespace and control characters are not allowed`,
    );
  }
  return value;
}

function requireAmount(value: unknown): string {
  if (typeof value !== 'string' || !MONETARY_AMOUNT.test(value)) {
    throw new Error('Invalid CUFE monetary amount');
  }
  return value;
}

function requireIdentification(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFICATION.test(value)) {
    throw new Error('Invalid CUFE identifier');
  }
  return value;
}

function requireCalendarDate(value: unknown): string {
  const text = requireText('issueDate', value);
  const match = CALENDAR_DATE.exec(text);
  if (!match) {
    throw new Error('Invalid CUFE issueDate: expected yyyy-MM-dd');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isCalendarDay =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isCalendarDay) {
    throw new Error('Invalid CUFE issueDate: not a calendar day');
  }
  return text;
}

function requireClockTime(value: unknown): string {
  const text = requireText('issueTime', value);
  if (!CLOCK_TIME.test(text)) {
    throw new Error(
      'Invalid CUFE issueTime: expected hh:mm:ss followed by a UTC offset',
    );
  }
  return text;
}

function requireTechnicalKey(value: unknown): string {
  const text = requireText('technicalKey', value);
  if (!TECHNICAL_KEY.test(text)) {
    throw new Error(
      'Invalid CUFE technicalKey: expected alphanumeric characters only',
    );
  }
  return text;
}

function requireEnvironment(value: unknown): '1' | '2' {
  if (value !== '1' && value !== '2') {
    throw new Error(
      'Invalid CUFE environment: expected "1" (production) or "2" (test)',
    );
  }
  return value;
}

export function computeCufe(input: CufeInput): string {
  const value = [
    requireText('invoiceNumber', input.invoiceNumber),
    requireCalendarDate(input.issueDate),
    requireClockTime(input.issueTime),
    requireAmount(input.taxableAmount),
    '01',
    requireAmount(input.vatAmount),
    '04',
    requireAmount(input.consumptionTaxAmount),
    '03',
    requireAmount(input.icaAmount),
    requireAmount(input.totalAmount),
    requireIdentification(input.issuerTaxId),
    requireIdentification(input.buyerId),
    requireTechnicalKey(input.technicalKey),
    requireEnvironment(input.environment),
  ].join('');

  return createHash('sha384').update(value, 'utf8').digest('hex');
}
