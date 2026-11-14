/**
 * `sts:DianExtensions`: the DIAN-specific extension block of a UBL invoice.
 *
 * This module owns the *rules* of that block — the values the annex fixes as
 * literals, the ranges it constrains, and the two values DIAN derives from
 * others (the software security code and the QR code URL). It emits no XML:
 * `invoice-xml.ts` renders the resolved structure through its single escape
 * funnel, so there is exactly one place where a value becomes markup.
 *
 * Source: Anexo Tecnico de Factura Electronica de Venta v1.9, Resolucion
 * 000165 (01/NOV/2023). Every rule below cites its row: the definition tables
 * on pages 21-27 (FAB01-FAB36), the validation-rule tables on pages 375-381,
 * and sections 11.7.1 (QR URL) and 11.8 (software security code).
 *
 * ## This block does not make a document submittable
 *
 * FAC01 requires the document to declare at least two `ext:UBLExtension`
 * nodes: one holding `sts:DianExtensions` and one holding `ds:Signature`. This
 * module emits the first and deliberately not the second, so the block is
 * *one node short* of what DIAN expects, and it is emitted only when the caller
 * opts in. Signing belongs to a unit that has the certificate; a placeholder
 * would produce a document that looks signed and is not.
 *
 * ## What is deliberately not enforced
 *
 * These are recorded instead of guessed, because the annex does not determine
 * them (see the unit's report for the wider list):
 *
 * - FAB22b ("DV del NIT del Prestador de Servicios no esta correctamente
 *   calculado"): the annex requires a *correct* check digit but never publishes
 *   the check-digit algorithm, so the digit is validated for shape only.
 * - FAB14-FAB17 and every other literal is emitted from one constant, so they
 *   cannot drift; nothing here verifies them against DIAN at runtime.
 * - FAD05b/c/d compare `/Invoice/cbc:ID` against `sts:From`/`sts:To`. Because
 *   `cbc:ID` also carries the prefix while the bounds are bare numbers, the
 *   comparison the annex writes is not mechanically determined, so range
 *   containment is left to DIAN's validation instead of being reimplemented.
 * - FAB27 gives the security code a size of 48, yet section 11.8 defines it as
 *   SHA-384, whose hexadecimal form is 96 characters. The section that defines
 *   the value wins; no length is asserted, and the conflict is reported rather
 *   than smoothed over.
 */

import { createHash } from 'node:crypto';

/** Anexo 1.9 table 1 (page 16): namespace of the `ext` prefix. */
export const EXT_NAMESPACE =
  'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';

/** Anexo 1.9 table 1 (page 16): namespace of the `sts` prefix, verbatim. */
export const STS_NAMESPACE = 'dian:gov:co:facturaelectronica:Structures-2-1';

/** FAB14: `cbc:IdentificationCode` must read "CO". */
export const DIAN_SOURCE_COUNTRY_CODE = 'CO';

/** FAB15: `@listAgencyID` must read "6". */
export const DIAN_SOURCE_LIST_AGENCY_ID = '6';

/** FAB16: `@listAgencyName` must read this literal. */
export const DIAN_SOURCE_LIST_AGENCY_NAME =
  'United Nations Economic Commission for Europe';

/** FAB17: `@listSchemeURI` must read this literal. */
export const DIAN_SOURCE_LIST_SCHEME_URI =
  'urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1';

/** FAB20, FAB25, FAB28, FAB32: every agency id must read "195". */
export const DIAN_AGENCY_ID = '195';

/** FAB21, FAB26, FAB29, FAB33: every agency name must read this literal. */
export const DIAN_AGENCY_NAME =
  'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)';

/** FAB35: the identification scheme of a NIT. */
export const DIAN_NIT_SCHEME = '31';

/** FAB31: `sts:AuthorizationProviderID` is the NIT of the DIAN itself. */
export const DIAN_AUTHORIZATION_PROVIDER_ID = '800197268';

/** FAB34: "DV de DIAN 4". */
export const DIAN_AUTHORIZATION_PROVIDER_CHECK_DIGIT = '4';

/** Annex 1.9 section 11.7.1: the two hosts DIAN publishes for the QR URL. */
const QR_HOSTS: Record<'1' | '2', string> = {
  '1': 'https://catalogo-vpfe.dian.gov.co',
  '2': 'https://catalogo-vpfe-hab.dian.gov.co',
};

const QR_PATH = '/document/searchqr?documentkey=';

const AUTHORIZATION_NUMBER = /^[0-9]{14}$/;
const RANGE_BOUND = /^[0-9]{1,9}$/;
const PROVIDER_ID = /^[0-9]{3,15}$/;
const CHECK_DIGIT = /^[0-9]{1,5}$/;
const CALENDAR_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
/** FAD06: `/Invoice/cbc:UUID`, type EA, size 96, rendered as lowercase hex. */
const CUFE = /^[0-9a-f]{96}$/;
const MAX_PREFIX_LENGTH = 4;

/**
 * Software credentials, as registered in the DIAN catalogue. All four values
 * come from the issuer's own record: none is derivable by this module.
 */
export interface DianSoftware {
  /** NIT of the technology provider (FAB19), without punctuation or DV. */
  providerId: string;
  /** NIT check digit, reported in `@schemeID` (FAB22). */
  providerCheckDigit: string;
  /** Software identifier DIAN assigns on activation (FAB24). */
  softwareId: string;
  /**
   * Software PIN set when the software was activated (annex 11.8). A secret:
   * it is hashed into `sts:SoftwareSecurityCode` and never leaves this module.
   */
  securityPin: string;
}

/** The numbering authorization the invoice consumes (FAB04-FAB12). */
export interface DianNumberingRange {
  /** `sts:InvoiceAuthorization`: 14 digits (FAB05). */
  invoiceAuthorization: string;
  /** `cbc:StartDate` of the authorization period (FAB07). */
  startsOn: string;
  /** `cbc:EndDate` of the authorization period (FAB08). */
  endsOn: string;
  /** `sts:Prefix`: the branch code of this billing point (FAB10), 0-4 chars. */
  prefix?: string;
  /** `sts:From`: first number of the authorized range (FAB11). */
  from: string;
  /** `sts:To`: last number of the authorized range (FAB12). */
  to: string;
}

/** What the caller must supply to opt in to the extension block. */
export interface DianExtensionsInput {
  numberingRange: DianNumberingRange;
  software: DianSoftware;
}

/** The document facts the block is validated against and derived from. */
export interface DianExtensionContext {
  /** `/Invoice/cbc:ID`: prefix and consecutive, no separator (FAD05). */
  invoiceNumber: string;
  /** `/Invoice/cbc:IssueDate`: the document date the period is checked against. */
  issueDate: string;
  /** `/Invoice/cbc:UUID`: the document key the QR code points at (FAB36). */
  cufe: string;
  /** `/Invoice/cbc:ProfileExecutionID`: "1" production, "2" test. */
  environment: '1' | '2';
}

/** The block, resolved and validated, ready for `invoice-xml.ts` to render. */
export interface ResolvedDianExtensions {
  invoiceAuthorization: string;
  authorizationStartDate: string;
  authorizationEndDate: string;
  prefix?: string;
  from: string;
  to: string;
  providerId: string;
  providerCheckDigit: string;
  softwareId: string;
  softwareSecurityCode: string;
  qrCode: string;
}

/**
 * Annex 1.9 section 11.8:
 * `SoftwareSecurityCode := SHA-384 (Id Software + Pin + NroDocumentos)`, where
 * `NroDocumento` is the document `cbc:ID` (`||invoice||DebitNote||... - cbc:ID`).
 * The three values are concatenated with no separator, and the digest is
 * rendered as lowercase hex, the same representation the annex uses for the
 * CUFE.
 */
export function computeSoftwareSecurityCode(
  softwareId: string,
  securityPin: string,
  invoiceNumber: string,
): string {
  return createHash('sha384')
    .update(`${softwareId}${securityPin}${invoiceNumber}`, 'utf8')
    .digest('hex');
}

/**
 * Annex 1.9 section 11.7.1 publishes one host per environment, and row FAD07
 * fixes the environment codes (`1 = Produccion`, `2 = Prueba`), so the mapping
 * is forced. The document key replaces the `CUFE` placeholder with the value of
 * `/Invoice/cbc:UUID` (FAB36).
 */
export function buildQrCodeUrl(environment: '1' | '2', cufe: string): string {
  return `${QR_HOSTS[environment]}${QR_PATH}${cufe}`;
}

function fail(field: string, expectation: string, received?: unknown): never {
  const shown = typeof received === 'string' ? `, received "${received}"` : '';
  throw new Error(
    `Invalid DIAN extension field "${field}": ${expectation}${shown}`,
  );
}

/**
 * The software PIN is a secret (annex 11.8: "de circulacion restringida"), so a
 * rejection reports the field and the rule but never the value it carried.
 */
function failSecret(field: string, expectation: string): never {
  throw new Error(`Invalid DIAN extension field "${field}": ${expectation}`);
}

/** Control characters are illegal in XML 1.0 and would break the layout. */
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

function requireSecret(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    failSecret(field, 'expected a non-empty string');
  }
  if (hasControlCharacter(value) || value.trim().length !== value.length) {
    failSecret(
      field,
      'control characters and surrounding whitespace are not allowed',
    );
  }
  return value;
}

function requirePattern(
  field: string,
  value: unknown,
  pattern: RegExp,
  expectation: string,
): string {
  const text = requireText(field, value);
  if (!pattern.test(text)) {
    fail(field, expectation, text);
  }
  return text;
}

function requireCalendarDate(field: string, value: unknown): string {
  const text = requireText(field, value);
  const match = CALENDAR_DATE.exec(text);
  if (!match) {
    fail(field, 'expected a date in YYYY-MM-DD form', text);
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
    fail(field, 'expected a real calendar day', text);
  }
  return text;
}

/**
 * FAB10 makes `sts:Prefix` optional; FAD05 says `cbc:ID` carries prefix and
 * consecutive with no separator, and FAB10b ties the prefix to the authorized
 * numbering. A prefix the number does not start with therefore describes a
 * different billing point, and an empty element would say nothing at all.
 */
function requirePrefix(value: unknown, invoiceNumber: string): string {
  const prefix = requireText('numberingRange.prefix', value);
  if (prefix.length > MAX_PREFIX_LENGTH) {
    fail(
      'numberingRange.prefix',
      `expected at most ${MAX_PREFIX_LENGTH} characters`,
      prefix,
    );
  }
  if (!invoiceNumber.startsWith(prefix)) {
    fail(
      'numberingRange.prefix',
      'expected the invoice number to start with this prefix',
      prefix,
    );
  }
  return prefix;
}

function requireEnvironment(value: unknown): '1' | '2' {
  if (value !== '1' && value !== '2') {
    fail('environment', 'expected "1" (production) or "2" (test)', value);
  }
  return value;
}

/**
 * The compiler's guarantees stop at the call: a JSON body or a database row can
 * reach this module with a group missing. Naming the group is what keeps that
 * from surfacing as an opaque `TypeError` on the first property read.
 */
function requireObject<T>(field: string, value: unknown): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(field, 'expected an object');
  }
  return value as T;
}

/**
 * Compares two digit strings as numbers without going through `Number`, so no
 * bound is ever rounded or turned into a float, and treats leading zeros as the
 * difference they are not: "0990" and "990" are the same bound.
 */
function compareNumericStrings(left: string, right: string): number {
  const a = left.replace(/^0+(?=.)/, '');
  const b = right.replace(/^0+(?=.)/, '');
  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function resolveDianExtensions(
  input: DianExtensionsInput,
  context: DianExtensionContext,
): ResolvedDianExtensions {
  const extensions = requireObject<DianExtensionsInput>(
    'dianExtensions',
    input,
  );
  const range = requireObject<DianNumberingRange>(
    'numberingRange',
    extensions.numberingRange,
  );
  const software = requireObject<DianSoftware>('software', extensions.software);
  const environment = requireEnvironment(context.environment);
  const cufe = requirePattern(
    'cufe',
    context.cufe,
    CUFE,
    'expected 96 lowercase hexadecimal characters',
  );
  // The document number is not emitted from here, so its UBL rules stay with
  // `buildInvoiceXml`; what this module needs is a value to hash and a prefix
  // to match.
  const invoiceNumber = requireText('invoiceNumber', context.invoiceNumber);

  // FAB05: `sts:InvoiceAuthorization`, type EN, size 14.
  const invoiceAuthorization = requirePattern(
    'numberingRange.invoiceAuthorization',
    range.invoiceAuthorization,
    AUTHORIZATION_NUMBER,
    'expected exactly 14 digits',
  );

  // FAB07 and FAB08: the period must contain the invoice issue date.
  const issueDate = requireCalendarDate('issueDate', context.issueDate);
  const authorizationStartDate = requireCalendarDate(
    'numberingRange.startsOn',
    range.startsOn,
  );
  if (authorizationStartDate > issueDate) {
    fail(
      'numberingRange.startsOn',
      'expected a date earlier than or equal to the invoice issue date',
      authorizationStartDate,
    );
  }
  const authorizationEndDate = requireCalendarDate(
    'numberingRange.endsOn',
    range.endsOn,
  );
  if (authorizationEndDate < issueDate) {
    fail(
      'numberingRange.endsOn',
      'expected a date later than or equal to the invoice issue date',
      authorizationEndDate,
    );
  }

  // FAB11 and FAB12: `sts:From` and `sts:To`, type EN, size 1-9.
  const from = requirePattern(
    'numberingRange.from',
    range.from,
    RANGE_BOUND,
    'expected one to nine digits',
  );
  const to = requirePattern(
    'numberingRange.to',
    range.to,
    RANGE_BOUND,
    'expected one to nine digits',
  );
  // FAB11 and FAB12 call these the "valor inicial" and the "valor final" of one
  // authorized range, and FAD05d reads the range as the interval the document
  // number must fall in: an inverted pair describes no interval, while a single
  // number is a range of one.
  if (compareNumericStrings(from, to) > 0) {
    fail(
      'numberingRange',
      'expected `to` to be greater than or equal to `from`',
      to,
    );
  }

  // FAB19: `sts:ProviderID`, type EN, size 3-15.
  const providerId = requirePattern(
    'software.providerId',
    software.providerId,
    PROVIDER_ID,
    'expected three to fifteen digits',
  );

  // FAB22: the NIT check digit is reported in `@schemeID`.
  const providerCheckDigit = requirePattern(
    'software.providerCheckDigit',
    software.providerCheckDigit,
    CHECK_DIGIT,
    'expected one to five digits',
  );

  // FAB24: `sts:softwareID` is mandatory.
  const softwareId = requireText('software.softwareId', software.softwareId);
  const securityPin = requireSecret(
    'software.securityPin',
    software.securityPin,
  );

  const prefix =
    range.prefix === undefined
      ? undefined
      : requirePrefix(range.prefix, invoiceNumber);

  return {
    invoiceAuthorization,
    authorizationStartDate,
    authorizationEndDate,
    ...(prefix === undefined ? {} : { prefix }),
    from,
    to,
    providerId,
    providerCheckDigit,
    softwareId,
    softwareSecurityCode: computeSoftwareSecurityCode(
      softwareId,
      securityPin,
      invoiceNumber,
    ),
    qrCode: buildQrCodeUrl(environment, cufe),
  };
}
