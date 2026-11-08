import { Decimal } from '@prisma/client/runtime/library';

/**
 * The catalog tribute codes MeperPOS can attach to an item, mirroring
 * `enum DianTaxCode` in `prisma/schema.prisma` (the column is the authoritative
 * storage). Declared here so this pure util, its consumers and its tests do not
 * depend on the generated Prisma client; the two memberships are structurally
 * identical string literals, so values cross the boundary unchanged.
 */
export const DianTaxCode = {
  IVA: 'IVA',
  INC: 'INC',
  ICA: 'ICA',
} as const;

export type DianTaxCode = (typeof DianTaxCode)[keyof typeof DianTaxCode];

export interface TaxableProduct {
  taxable: boolean;
  taxRate?: number | Decimal | null;
  taxCode?: DianTaxCode | null;
}

export interface TaxableCategory {
  taxable: boolean;
  defaultTaxRate?: number | Decimal | null;
  defaultTaxCode?: DianTaxCode | null;
}

/** DIAN tribute code as published in the invoice (`cbc:TaxScheme/cbc:ID`). */
export type DianTributeCode = '01' | '03' | '04';

/**
 * The one and only mapping from MeperPOS' catalog enum to the DIAN tribute
 * codes. IVA is 01, INC is 04 and ICA is 03; the CUFE composition and the UBL
 * generator both consume this table, so a second copy would be a second truth.
 */
const DIAN_TRIBUTE_CODES: Record<DianTaxCode, DianTributeCode> = {
  [DianTaxCode.IVA]: '01',
  [DianTaxCode.INC]: '04',
  [DianTaxCode.ICA]: '03',
};

/**
 * Translates a catalog tax code into the numeric DIAN tribute code.
 *
 * @param code - the catalog enum value
 * @returns    - '01' (IVA), '04' (INC) or '03' (ICA)
 */
export function dianTributeCode(code: DianTaxCode): DianTributeCode {
  return DIAN_TRIBUTE_CODES[code];
}

interface ResolvedTax {
  rate: number;
  code: DianTaxCode;
}

/**
 * Resolves the opt-in tax source exactly once, so the rate and the code can
 * never disagree: whichever side supplies the rate also supplies the code.
 *
 *   1. Product opted-in (`taxable=true`) with a usable rate → product code
 *   2. Category opted-in (`taxable=true`) with a usable rate → category code
 *   3. Otherwise → no tax at all
 *
 * A taxable source without a stored code resolves to IVA, which is what every
 * taxed catalog row means today, so the resolution is byte-identical to the
 * pre-`taxCode` behaviour. No code is ever invented for an untaxed row: a rate
 * of 0 means no tax, therefore no code.
 */
function resolveTax(
  product: TaxableProduct,
  category?: TaxableCategory | null,
): ResolvedTax | null {
  if (product.taxable) {
    const rate = toNumber(product.taxRate);
    if (rate > 0) {
      return { rate, code: product.taxCode ?? DianTaxCode.IVA };
    }
  }

  if (category?.taxable) {
    const rate = toNumber(category.defaultTaxRate);
    if (rate > 0) {
      return { rate, code: category.defaultTaxCode ?? DianTaxCode.IVA };
    }
  }

  return null;
}

/**
 * Resolves the effective tax rate for a product using opt-in precedence:
 *
 *   1. Product opted-in (`taxable=true`) with a usable rate → product rate
 *   2. Category opted-in (`taxable=true`) with a usable rate → category rate
 *   3. Otherwise → 0 (no tax by default)
 *
 * Tax is opt-in only. There is no global rate and no magic-number fallback.
 *
 * @param product  - the product (needs `taxable` + `taxRate`)
 * @param category - the product's category (needs `taxable` + `defaultTaxRate`)
 * @returns        - the effective tax rate as a number
 */
export function resolveEffectiveTaxRate(
  product: TaxableProduct,
  category?: TaxableCategory | null,
): number {
  return resolveTax(product, category)?.rate ?? 0;
}

/**
 * Resolves the effective tax code that goes with `resolveEffectiveTaxRate`:
 * the same opt-in precedence, the same source, and IVA when the taxable source
 * carries no explicit code. `null` means "no tax", never "unknown tax".
 *
 * @param product  - the product (needs `taxable` + `taxCode`)
 * @param category - the product's category (needs `taxable` + `defaultTaxCode`)
 * @returns        - the effective catalog tax code, or null when untaxed
 */
export function resolveEffectiveTaxCode(
  product: TaxableProduct,
  category?: TaxableCategory | null,
): DianTaxCode | null {
  return resolveTax(product, category)?.code ?? null;
}

/**
 * Safely converts a Decimal or number to a plain JS number.
 * Returns 0 for null/undefined — an opted-in entity without a rate is
 * treated as "no rate".
 */
function toNumber(value: number | Decimal | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}
