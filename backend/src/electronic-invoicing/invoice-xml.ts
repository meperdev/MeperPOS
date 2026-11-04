/**
 * UBL 2.1 `Invoice` serializer for Colombian DIAN electronic invoicing.
 *
 * `buildInvoiceXml` is a pure function: no I/O, no network, no clock, no
 * randomness. The same input always yields byte-identical output, which is what
 * makes the CUFE reproducible and the document diffable.
 *
 * The document is structurally UBL-valid and validates against
 * `UBL-Invoice-2.1.xsd`, but it is NOT submittable to DIAN: the XADES-EPES
 * `ds:Signature` is always absent, and the `ext:UBLExtensions` block
 * (`sts:DianExtensions`) is emitted only when the caller opts in through
 * `dianExtensions`. That is deliberate — the signature belongs to a unit that
 * needs the signing certificate, and emitting an unsigned stub would produce a
 * document that looks signed but is not. Do not "fix" this by adding a
 * placeholder.
 *
 * An opt-in document is still one `ext:UBLExtension` node short of what DIAN
 * asks for: FAC01 requires a second node carrying `ds:Signature`. See
 * `dian-extensions.ts` for the extension rules and for the list of annex rows
 * that are recorded rather than enforced.
 *
 * Element order follows `InvoiceType` in UBL-Invoice-2.1.xsd, an `xs:sequence`:
 * one element out of place makes the whole document invalid. Only these are
 * emitted, in this relative order:
 *
 *   ext:UBLExtensions (opt-in), cbc:UBLVersionID, cbc:CustomizationID,
 *   cbc:ProfileID, cbc:ProfileExecutionID, cbc:ID, cbc:UUID, cbc:IssueDate,
 *   cbc:IssueTime, cbc:InvoiceTypeCode, cbc:DocumentCurrencyCode,
 *   cbc:LineCountNumeric, cac:AccountingSupplierParty,
 *   cac:AccountingCustomerParty, cac:TaxTotal, cac:LegalMonetaryTotal,
 *   cac:InvoiceLine+
 *
 * DIAN literals come from Anexo Tecnico v1.9 (Resolucion 000165/2023), section
 * 6.1, table rows FAD01-FAD04. Section 11.2.2 fixes the CUFE location:
 * `/Invoice/cbc:UUID`.
 *
 * ## Tax schemes
 *
 * A line that carries a persisted `SaleItem.taxCode` emits that code's DIAN tax
 * scheme in its own `cac:TaxTotal` (`01` IVA, `04` INC, `03` ICA, mapped by the
 * single `dianTributeCode` table in `common/utils/tax.util.ts`). A line without a
 * code keeps scheme `01`, which is what this module emitted before tax codes
 * existed and what a pre-feature sale (spec S7) still means.
 *
 * The invoice-level `cac:TaxTotal` carries one `cac:TaxSubtotal` per persisted
 * code, in first-appearance order, each with the `TaxableAmount` and
 * `TaxAmount` summed from the lines in that code's group. That is the only
 * arithmetic this module performs on money, and it is done in integer cents.
 * The sale-level tax the caller passes is compared against that sum and any
 * disagreement throws: a document whose header contradicts its own subtotals is
 * worse than no document, because the CUFE is built from the same lines.
 *
 * `LegalMonetaryTotal/TaxExclusiveAmount` repeats the line extension total and
 * `TaxInclusiveAmount` repeats the payable amount, because allowances, charges
 * and prepayments are out of scope.
 *
 * ## Other stated assumptions
 *
 * - Identifications are NITs (DIAN scheme "31"), since only digits are allowed.
 * - Quantities are whole units (`unitCode="94"`, UN/ECE Rec 20 "unit"), because
 *   MeperPOS sells integer quantities.
 * - `DianInvoiceLine.id` must be the line's 1-based position; a mismatch is a
 *   caller bug and throws instead of emitting a self-inconsistent document.
 */

import {
  type DianTaxCode,
  type DianTributeCode,
  dianTributeCode,
} from '../common/utils/tax.util';
import {
  DIAN_AGENCY_ID,
  DIAN_AGENCY_NAME,
  DIAN_AUTHORIZATION_PROVIDER_CHECK_DIGIT,
  DIAN_AUTHORIZATION_PROVIDER_ID,
  DIAN_NIT_SCHEME,
  DIAN_SOURCE_COUNTRY_CODE,
  DIAN_SOURCE_LIST_AGENCY_ID,
  DIAN_SOURCE_LIST_AGENCY_NAME,
  DIAN_SOURCE_LIST_SCHEME_URI,
  DianExtensionsInput,
  EXT_NAMESPACE,
  ResolvedDianExtensions,
  STS_NAMESPACE,
  resolveDianExtensions,
} from './dian-extensions';

export interface DianParty {
  /** Identification without punctuation and without the check digit. */
  taxId: string;
  name: string;
  /**
   * NIT check digit ("DV"). DIAN puts it in `@schemeID` on both
   * `PartyIdentification/cbc:ID` (annex row FAK64) and
   * `PartyTaxScheme/cbc:CompanyID` (row FAK24), while `@schemeName` carries the
   * document type (31 = NIT). Annex 1.9 marks it 1-5 characters, 0..1, and
   * requires it when the party is identified by NIT.
   */
  checkDigit?: string;
}

export interface DianInvoiceLine {
  /** 1-based line number; must equal the line's position in `lines`. */
  id: number;
  /** Integer quantity, greater than zero. */
  quantity: number;
  /** DIAN-formatted line subtotal before tax, e.g. "1500000.00". */
  lineExtensionAmount: string;
  /** DIAN-formatted unit price, e.g. "500000.00". */
  unitPrice: string;
  /** DIAN-formatted tax for this line, in the scheme named by `taxCode`. */
  taxAmount: string;
  /**
   * The persisted `SaleItem.taxCode`. Absent or null keeps scheme 01 (IVA),
   * which is this module's behaviour before tax codes existed.
   */
  taxCode?: DianTaxCode | null;
  description: string;
  sellerItemId?: string;
}

export interface DianInvoiceInput {
  /** NumFac: prefix concatenated with the consecutive, no separator. */
  invoiceNumber: string;
  /** 96 lowercase hex characters, as returned by `computeCufe`. */
  cufe: string;
  /** yyyy-MM-dd, Bogota calendar date. */
  issueDate: string;
  /** hh:mm:ss followed by a UTC offset, e.g. "10:53:10-05:00". */
  issueTime: string;
  /** "1" production, "2" test. */
  environment: '1' | '2';
  /** ISO 4217 code; defaults to "COP". */
  currency?: string;
  issuer: DianParty;
  buyer: DianParty;
  lines: DianInvoiceLine[];
  /** Invoice-level subtotal before tax. */
  lineExtensionAmount: string;
  /** Invoice-level IVA total. */
  taxAmount: string;
  /** Invoice-level total to pay. */
  payableAmount: string;
  /**
   * Opt-in `sts:DianExtensions` block. Absent means the document is emitted
   * exactly as before this block existed — byte for byte.
   */
  dianExtensions?: DianExtensionsInput;
}

/** Anexo Tecnico 1.9 section 6.1, rows FAD01-FAD04. */
const UBL_VERSION_ID = 'UBL 2.1';
/** "10" = Factura Electronica de Venta. */
const CUSTOMIZATION_ID = '10';
/** Accent kept exactly as the annex publishes it. */
const PROFILE_ID = 'DIAN 2.1: Factura Electrónica de Venta';
/** "01" = Factura Electronica de Venta. */
const INVOICE_TYPE_CODE = '01';
const CUFE_SCHEME_NAME = 'CUFE-SHA384';
const DEFAULT_CURRENCY = 'COP';
/** DIAN identification scheme 31 = NIT. */
const NIT_SCHEME = '31';
/** Appendix 1.9 states the check digit is 1-5 characters, `AN`. */
const CHECK_DIGIT = /^[0-9]{1,5}$/;
/** DIAN tax scheme 01 = IVA. */
const IVA_CODE = '01';
const IVA_NAME = 'IVA';

/** The scheme label DIAN publishes beside each tribute code. */
const TAX_SCHEME_NAMES: Record<DianTaxCode, string> = {
  IVA: IVA_NAME,
  INC: 'INC',
  ICA: 'ICA',
};

interface TaxScheme {
  code: DianTributeCode;
  name: string;
}

/**
 * One tax scheme per catalog code, with the numeric code taken from the single
 * `dianTributeCode` mapping so this module cannot disagree with the CUFE.
 */
function taxScheme(code: DianTaxCode): TaxScheme {
  return { code: dianTributeCode(code), name: TAX_SCHEME_NAMES[code] };
}

/** What a line without a persisted code keeps emitting. */
const DEFAULT_TAX_SCHEME: TaxScheme = taxScheme('IVA');
/** UN/ECE Recommendation 20 "unit". */
const UNIT_CODE = '94';
const INDENT_UNIT = '  ';

const MONETARY_AMOUNT = /^[0-9]+\.[0-9]{2}$/;
const CUFE_VALUE = /^[0-9a-f]{96}$/;
const INVOICE_NUMBER = /^[A-Za-z0-9]+$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const TAX_ID = /^[0-9]+$/;
const CALENDAR_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const CLOCK_TIME =
  /^([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])[+-]([01][0-9]|2[0-3]):([0-5][0-9])$/;

function fail(field: string, expectation: string, received?: unknown): never {
  const shown = typeof received === 'string' ? `, received "${received}"` : '';
  throw new Error(
    `Invalid DIAN invoice field "${field}": ${expectation}${shown}`,
  );
}

function pad(depth: number): string {
  return INDENT_UNIT.repeat(depth);
}

/**
 * One escape funnel for every value this module emits, used for element text
 * and attribute values alike. `&` must be replaced first or the later
 * replacements would double-escape the ampersands they introduce.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Control characters are illegal in XML 1.0 and would also break the layout. */
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
    fail(field, 'expected a non-empty string', value);
  }
  if (hasControlCharacter(value)) {
    fail(field, 'control characters are not allowed', value);
  }
  if (value.trim().length !== value.length) {
    fail(field, 'leading or trailing whitespace is not allowed', value);
  }
  return value;
}

function requireAmount(field: string, value: unknown): string {
  if (typeof value !== 'string' || !MONETARY_AMOUNT.test(value)) {
    fail(
      field,
      'expected a decimal amount with exactly two decimals and no separators',
      value,
    );
  }
  return value;
}

function requireCufe(value: unknown): string {
  if (typeof value !== 'string' || !CUFE_VALUE.test(value)) {
    fail('cufe', 'expected 96 lowercase hexadecimal characters', value);
  }
  return value;
}

function requireInvoiceNumber(value: unknown): string {
  if (typeof value !== 'string' || !INVOICE_NUMBER.test(value)) {
    fail('invoiceNumber', 'expected alphanumeric characters only', value);
  }
  return value;
}

function requireCalendarDate(value: unknown): string {
  if (typeof value !== 'string') {
    fail('issueDate', 'expected yyyy-MM-dd', value);
  }
  const match = CALENDAR_DATE.exec(value);
  if (!match) {
    fail('issueDate', 'expected yyyy-MM-dd', value);
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
    fail('issueDate', 'expected a real calendar day', value);
  }
  return value;
}

function requireClockTime(value: unknown): string {
  if (typeof value !== 'string' || !CLOCK_TIME.test(value)) {
    fail(
      'issueTime',
      'expected hh:mm:ss followed by a UTC offset, e.g. 10:53:10-05:00',
      value,
    );
  }
  return value;
}

function requireEnvironment(value: unknown): '1' | '2' {
  if (value !== '1' && value !== '2') {
    fail('environment', 'expected "1" (production) or "2" (test)', value);
  }
  return value;
}

function requireCurrency(value: unknown): string {
  if (typeof value !== 'string' || !CURRENCY_CODE.test(value)) {
    fail('currency', 'expected a three-letter uppercase ISO 4217 code', value);
  }
  return value;
}

function requireTaxId(field: string, value: unknown): string {
  if (typeof value !== 'string' || !TAX_ID.test(value)) {
    fail(
      field,
      'expected digits only, without punctuation or check digit',
      value,
    );
  }
  return value;
}

function requireCheckDigit(field: string, value: unknown): string {
  if (typeof value !== 'string' || !CHECK_DIGIT.test(value)) {
    fail(field, 'expected 1-5 digits', value);
  }
  return value;
}

function requireParty(field: string, value: unknown): DianParty {
  if (typeof value !== 'object' || value === null) {
    fail(field, 'expected an object with taxId and name', value);
  }
  const party = value as Partial<DianParty>;
  const checkDigit =
    party.checkDigit === undefined
      ? undefined
      : requireCheckDigit(`${field}.checkDigit`, party.checkDigit);
  return {
    taxId: requireTaxId(`${field}.taxId`, party.taxId),
    name: requireText(`${field}.name`, party.name),
    // Never drop this field on the floor: a rebuilt party without it silently
    // emitted a document missing a check digit DIAN requires for NIT parties.
    ...(checkDigit === undefined ? {} : { checkDigit }),
  };
}

function requireTaxCode(field: string, value: unknown): DianTaxCode | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value !== 'IVA' && value !== 'INC' && value !== 'ICA') {
    fail(field, 'expected IVA, INC or ICA, or nothing at all', value);
  }
  return value;
}

function requireLine(
  field: string,
  value: unknown,
  index: number,
): DianInvoiceLine {
  if (typeof value !== 'object' || value === null) {
    fail(field, 'expected an object', value);
  }
  const line = value as Partial<DianInvoiceLine>;
  const lineExtensionAmount = requireAmount(
    `${field}.lineExtensionAmount`,
    line.lineExtensionAmount,
  );
  const unitPrice = requireAmount(`${field}.unitPrice`, line.unitPrice);
  const taxAmount = requireAmount(`${field}.taxAmount`, line.taxAmount);
  const taxCode = requireTaxCode(`${field}.taxCode`, line.taxCode);
  const description = requireText(`${field}.description`, line.description);

  if (
    typeof line.quantity !== 'number' ||
    !Number.isSafeInteger(line.quantity)
  ) {
    fail(`${field}.quantity`, 'expected an integer quantity', line.quantity);
  }
  if (line.quantity <= 0) {
    fail(
      `${field}.quantity`,
      'expected a quantity greater than zero',
      line.quantity,
    );
  }
  // Checked last so that a wrong amount is reported before a wrong id, and
  // asserted at all so the document cannot disagree with `LineCountNumeric`.
  if (line.id !== index + 1) {
    fail(
      `${field}.id`,
      `expected the 1-based line number ${index + 1}`,
      line.id,
    );
  }

  const sellerItemId =
    line.sellerItemId === undefined
      ? undefined
      : requireText(`${field}.sellerItemId`, line.sellerItemId);

  return {
    id: index + 1,
    quantity: line.quantity,
    lineExtensionAmount,
    unitPrice,
    taxAmount,
    taxCode,
    description,
    sellerItemId,
  };
}

function requireLines(value: unknown): DianInvoiceLine[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail('lines', 'expected at least one invoice line');
  }
  return value.map((line, index) =>
    requireLine(`lines[${index}]`, line, index),
  );
}

function element(depth: number, tag: string, value: string): string {
  return `${pad(depth)}<${tag}>${escapeXml(value)}</${tag}>`;
}

function attributeElement(
  depth: number,
  tag: string,
  attributes: Record<string, string>,
  value: string,
): string {
  const rendered = Object.entries(attributes)
    .map(([name, attributeValue]) => ` ${name}="${escapeXml(attributeValue)}"`)
    .join('');
  return `${pad(depth)}<${tag}${rendered}>${escapeXml(value)}</${tag}>`;
}

function container(depth: number, tag: string, children: string[]): string[] {
  return [`${pad(depth)}<${tag}>`, ...children, `${pad(depth)}</${tag}>`];
}

function nitElement(depth: number, tag: string, value: DianParty): string {
  // `schemeName` identifies the document type; `schemeID` is the check digit,
  // never the type code. Emitting the type code here would declare a check
  // digit of 31 and the XSD cannot catch it: both attributes are optional.
  const attributes: Record<string, string> = { schemeName: NIT_SCHEME };
  if (value.checkDigit !== undefined) {
    attributes.schemeID = value.checkDigit;
  }
  return attributeElement(depth, tag, attributes, value.taxId);
}

/**
 * `udt:AmountType` (UBL-UnqualifiedDataTypes-2.1.xsd) makes `currencyID`
 * mandatory, so every monetary amount carries it. The value is never re-derived
 * here, only repeated from `DianInvoiceInput.currency`.
 */
function amountElement(
  depth: number,
  tag: string,
  currency: string,
  value: string,
): string {
  return attributeElement(depth, tag, { currencyID: currency }, value);
}

/**
 * Both parties are rendered identically: DIAN wants the identification in
 * `PartyIdentification`, the legal name in `PartyTaxScheme/RegistrationName`
 * with the taxing scheme, and the name repeated in `PartyLegalEntity`.
 *
 * `branchCode` is the supplier's only: FAB10a requires `sts:Prefix` to equal
 * `PartyLegalEntity/CorporateRegistrationScheme/cbc:ID`, so the extension block
 * and this element are written from one value.
 */
function party(
  depth: number,
  tag: 'cac:AccountingSupplierParty' | 'cac:AccountingCustomerParty',
  value: DianParty,
  branchCode?: string,
): string[] {
  const legalEntity: string[] = [
    element(depth + 3, 'cbc:RegistrationName', value.name),
    nitElement(depth + 3, 'cbc:CompanyID', value),
  ];
  if (branchCode !== undefined) {
    legalEntity.push(
      ...container(depth + 3, 'cac:CorporateRegistrationScheme', [
        element(depth + 4, 'cbc:ID', branchCode),
      ]),
    );
  }

  return container(
    depth,
    tag,
    container(depth + 1, 'cac:Party', [
      ...container(depth + 2, 'cac:PartyIdentification', [
        nitElement(depth + 3, 'cbc:ID', value),
      ]),
      ...container(depth + 2, 'cac:PartyName', [
        element(depth + 3, 'cbc:Name', value.name),
      ]),
      ...container(depth + 2, 'cac:PartyTaxScheme', [
        element(depth + 3, 'cbc:RegistrationName', value.name),
        nitElement(depth + 3, 'cbc:CompanyID', value),
        ...container(depth + 3, 'cac:TaxScheme', [
          element(depth + 4, 'cbc:ID', IVA_CODE),
          element(depth + 4, 'cbc:Name', IVA_NAME),
        ]),
      ]),
      ...container(depth + 2, 'cac:PartyLegalEntity', legalEntity),
    ]),
  );
}

/**
 * One tax bucket. `taxable` is the amount this tax was computed on, which is the
 * line extension amount: no allowance or charge is emitted anywhere.
 */
function taxTotal(
  depth: number,
  currency: string,
  amount: string,
  taxable: string,
  scheme: TaxScheme = DEFAULT_TAX_SCHEME,
): string[] {
  return container(depth, 'cac:TaxTotal', [
    amountElement(depth + 1, 'cbc:TaxAmount', currency, amount),
    ...taxSubtotal(depth + 1, currency, taxable, amount, scheme),
  ]);
}

/** One `cac:TaxSubtotal` under a `cac:TaxTotal`. */
function taxSubtotal(
  depth: number,
  currency: string,
  taxable: string,
  amount: string,
  scheme: TaxScheme,
): string[] {
  return container(depth, 'cac:TaxSubtotal', [
    amountElement(depth + 1, 'cbc:TaxableAmount', currency, taxable),
    amountElement(depth + 1, 'cbc:TaxAmount', currency, amount),
    ...container(depth + 1, 'cac:TaxCategory', [
      element(depth + 2, 'cbc:ID', scheme.code),
      element(depth + 2, 'cbc:Name', scheme.name),
      ...container(depth + 2, 'cac:TaxScheme', [
        element(depth + 3, 'cbc:ID', scheme.code),
        element(depth + 3, 'cbc:Name', scheme.name),
      ]),
    ]),
  ]);
}

/** DIAN amounts are strict two-decimal strings, so they parse without floats. */
const AMOUNT_PATTERN = /^([0-9]+)\.([0-9]{2})$/;

function toCents(value: string): bigint {
  const match = AMOUNT_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid DIAN amount for a tax subtotal: ${value}`);
  }
  return BigInt(match[1]) * 100n + BigInt(match[2]);
}

function fromCents(cents: bigint): string {
  const units = cents / 100n;
  const decimals = cents % 100n;
  return `${units}.${String(decimals).padStart(2, '0')}`;
}

interface TaxBucket {
  scheme: TaxScheme;
  taxable: string;
  amount: string;
}

/**
 * Groups the lines by their persisted code, in first-appearance order, so the
 * invoice-level `cac:TaxTotal` stops contradicting its own lines: one subtotal
 * per tribute code. A line without a code counts as IVA, which is this
 * module's behaviour before tax codes existed.
 */
function invoiceTaxBuckets(lines: DianInvoiceLine[]): TaxBucket[] {
  const buckets: Array<{
    code: DianTaxCode;
    taxable: bigint;
    amount: bigint;
  }> = [];

  for (const line of lines) {
    const code: DianTaxCode = line.taxCode ?? 'IVA';
    const existing = buckets.find((bucket) => bucket.code === code);
    if (existing === undefined) {
      buckets.push({
        code,
        taxable: toCents(line.lineExtensionAmount),
        amount: toCents(line.taxAmount),
      });
      continue;
    }
    existing.taxable += toCents(line.lineExtensionAmount);
    existing.amount += toCents(line.taxAmount);
  }

  return buckets.map(({ code, taxable, amount }) => ({
    scheme: taxScheme(code),
    taxable: fromCents(taxable),
    amount: fromCents(amount),
  }));
}

function invoiceTaxTotal(
  depth: number,
  currency: string,
  amount: string,
  buckets: TaxBucket[],
): string[] {
  const declared = toCents(amount);
  const summed = buckets.reduce(
    (total, bucket) => total + toCents(bucket.amount),
    0n,
  );
  if (declared !== summed) {
    throw new Error(
      `Invalid invoice tax total: the sale reports ${fromCents(declared)} but its lines sum to ${fromCents(summed)}`,
    );
  }

  return container(depth, 'cac:TaxTotal', [
    amountElement(depth + 1, 'cbc:TaxAmount', currency, amount),
    ...buckets.flatMap((bucket) =>
      taxSubtotal(
        depth + 1,
        currency,
        bucket.taxable,
        bucket.amount,
        bucket.scheme,
      ),
    ),
  ]);
}

function legalMonetaryTotal(
  depth: number,
  currency: string,
  lineExtensionAmount: string,
  payableAmount: string,
): string[] {
  return container(depth, 'cac:LegalMonetaryTotal', [
    amountElement(
      depth + 1,
      'cbc:LineExtensionAmount',
      currency,
      lineExtensionAmount,
    ),
    // No allowances, charges or prepayments are emitted, so the exclusive total
    // is the line extension total and the inclusive total is the payable amount.
    amountElement(
      depth + 1,
      'cbc:TaxExclusiveAmount',
      currency,
      lineExtensionAmount,
    ),
    amountElement(depth + 1, 'cbc:TaxInclusiveAmount', currency, payableAmount),
    amountElement(depth + 1, 'cbc:PayableAmount', currency, payableAmount),
  ]);
}

function invoiceLine(
  depth: number,
  currency: string,
  line: DianInvoiceLine,
): string[] {
  const item: string[] = [
    element(depth + 2, 'cbc:Description', line.description),
  ];
  if (line.sellerItemId !== undefined) {
    item.push(
      ...container(depth + 2, 'cac:SellersItemIdentification', [
        element(depth + 3, 'cbc:ID', line.sellerItemId),
      ]),
    );
  }

  return container(depth, 'cac:InvoiceLine', [
    element(depth + 1, 'cbc:ID', String(line.id)),
    attributeElement(
      depth + 1,
      'cbc:InvoicedQuantity',
      { unitCode: UNIT_CODE },
      String(line.quantity),
    ),
    amountElement(
      depth + 1,
      'cbc:LineExtensionAmount',
      currency,
      line.lineExtensionAmount,
    ),
    ...taxTotal(
      depth + 1,
      currency,
      line.taxAmount,
      line.lineExtensionAmount,
      // A persisted code emits its own scheme; no code keeps 01.
      line.taxCode === null || line.taxCode === undefined
        ? DEFAULT_TAX_SCHEME
        : taxScheme(line.taxCode),
    ),
    ...container(depth + 1, 'cac:Item', item),
    ...container(depth + 1, 'cac:Price', [
      amountElement(depth + 2, 'cbc:PriceAmount', currency, line.unitPrice),
      attributeElement(
        depth + 2,
        'cbc:BaseQuantity',
        { unitCode: UNIT_CODE },
        '1',
      ),
    ]),
  ]);
}

/**
 * The `sts:DianExtensions` block, in the order of annex rows FAB04-FAB36.
 *
 * One `ext:UBLExtension` carries it, and nothing else: FAC01 wants a second
 * node for `ds:Signature`, which this module cannot produce. The prefix is
 * rendered only when the range has one, because FAB10 is optional while
 * FAB11/FAB12 are not.
 */
function dianExtensionsBlock(
  depth: number,
  extensions: ResolvedDianExtensions,
): string[] {
  const agency = {
    schemeAgencyID: DIAN_AGENCY_ID,
    schemeAgencyName: DIAN_AGENCY_NAME,
  };

  return container(depth, 'ext:UBLExtensions', [
    ...container(depth + 1, 'ext:UBLExtension', [
      ...container(depth + 2, 'ext:ExtensionContent', [
        ...container(depth + 3, 'sts:DianExtensions', [
          ...container(depth + 4, 'sts:InvoiceControl', [
            element(
              depth + 5,
              'sts:InvoiceAuthorization',
              extensions.invoiceAuthorization,
            ),
            ...container(depth + 5, 'sts:AuthorizationPeriod', [
              element(
                depth + 6,
                'cbc:StartDate',
                extensions.authorizationStartDate,
              ),
              element(
                depth + 6,
                'cbc:EndDate',
                extensions.authorizationEndDate,
              ),
            ]),
            ...container(depth + 5, 'sts:AuthorizedInvoices', [
              ...(extensions.prefix === undefined
                ? []
                : [element(depth + 6, 'sts:Prefix', extensions.prefix)]),
              element(depth + 6, 'sts:From', extensions.from),
              element(depth + 6, 'sts:To', extensions.to),
            ]),
          ]),
          ...container(depth + 4, 'sts:InvoiceSource', [
            attributeElement(
              depth + 5,
              'cbc:IdentificationCode',
              {
                listAgencyID: DIAN_SOURCE_LIST_AGENCY_ID,
                listAgencyName: DIAN_SOURCE_LIST_AGENCY_NAME,
                listSchemeURI: DIAN_SOURCE_LIST_SCHEME_URI,
              },
              DIAN_SOURCE_COUNTRY_CODE,
            ),
          ]),
          ...container(depth + 4, 'sts:SoftwareProvider', [
            attributeElement(
              depth + 5,
              'sts:ProviderID',
              {
                ...agency,
                schemeID: extensions.providerCheckDigit,
                schemeName: DIAN_NIT_SCHEME,
              },
              extensions.providerId,
            ),
            attributeElement(
              depth + 5,
              'sts:SoftwareID',
              agency,
              extensions.softwareId,
            ),
          ]),
          attributeElement(
            depth + 4,
            'sts:SoftwareSecurityCode',
            agency,
            extensions.softwareSecurityCode,
          ),
          ...container(depth + 4, 'sts:AuthorizationProvider', [
            attributeElement(
              depth + 5,
              'sts:AuthorizationProviderID',
              {
                ...agency,
                schemeID: DIAN_AUTHORIZATION_PROVIDER_CHECK_DIGIT,
                schemeName: DIAN_NIT_SCHEME,
              },
              DIAN_AUTHORIZATION_PROVIDER_ID,
            ),
          ]),
          element(depth + 4, 'sts:QRCode', extensions.qrCode),
        ]),
      ]),
    ]),
  ]);
}

export function buildInvoiceXml(input: DianInvoiceInput): string {
  const invoiceNumber = requireInvoiceNumber(input.invoiceNumber);
  const cufe = requireCufe(input.cufe);
  const issueDate = requireCalendarDate(input.issueDate);
  const issueTime = requireClockTime(input.issueTime);
  const environment = requireEnvironment(input.environment);
  const currency = requireCurrency(input.currency ?? DEFAULT_CURRENCY);
  const issuer = requireParty('issuer', input.issuer);
  const buyer = requireParty('buyer', input.buyer);
  const lines = requireLines(input.lines);
  const lineExtensionAmount = requireAmount(
    'lineExtensionAmount',
    input.lineExtensionAmount,
  );
  const taxAmount = requireAmount('taxAmount', input.taxAmount);
  const payableAmount = requireAmount('payableAmount', input.payableAmount);
  const extensions =
    input.dianExtensions === undefined
      ? undefined
      : resolveDianExtensions(input.dianExtensions, {
          invoiceNumber,
          issueDate,
          cufe,
          environment,
        });

  // The prefixes must be declared on the document header (annex table 1), and
  // they exist only when the block that uses them does.
  const rootTag = [
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"',
    `${pad(4)}xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"`,
    `${pad(4)}xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"`,
    ...(extensions === undefined
      ? []
      : [
          `${pad(4)}xmlns:ext="${EXT_NAMESPACE}"`,
          `${pad(4)}xmlns:sts="${STS_NAMESPACE}"`,
        ]),
  ];
  rootTag[rootTag.length - 1] = `${rootTag[rootTag.length - 1]}>`;

  const document = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    ...rootTag,
    ...(extensions === undefined ? [] : dianExtensionsBlock(1, extensions)),
    element(1, 'cbc:UBLVersionID', UBL_VERSION_ID),
    element(1, 'cbc:CustomizationID', CUSTOMIZATION_ID),
    element(1, 'cbc:ProfileID', PROFILE_ID),
    element(1, 'cbc:ProfileExecutionID', environment),
    element(1, 'cbc:ID', invoiceNumber),
    attributeElement(
      1,
      'cbc:UUID',
      { schemeID: environment, schemeName: CUFE_SCHEME_NAME },
      cufe,
    ),
    element(1, 'cbc:IssueDate', issueDate),
    element(1, 'cbc:IssueTime', issueTime),
    element(1, 'cbc:InvoiceTypeCode', INVOICE_TYPE_CODE),
    element(1, 'cbc:DocumentCurrencyCode', currency),
    element(1, 'cbc:LineCountNumeric', String(lines.length)),
    ...party(1, 'cac:AccountingSupplierParty', issuer, extensions?.prefix),
    ...party(1, 'cac:AccountingCustomerParty', buyer),
    ...invoiceTaxTotal(1, currency, taxAmount, invoiceTaxBuckets(lines)),
    ...legalMonetaryTotal(1, currency, lineExtensionAmount, payableAmount),
    ...lines.flatMap((line) => invoiceLine(1, currency, line)),
    '</Invoice>',
    '',
  ];

  return document.join('\n');
}
