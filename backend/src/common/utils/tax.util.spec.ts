import {
  DianTaxCode,
  dianTributeCode,
  resolveEffectiveTaxCode,
  resolveEffectiveTaxRate,
} from './tax.util';
import { Decimal } from '@prisma/client/runtime/library';

describe('resolveEffectiveTaxRate(product, category)', () => {
  describe('product opted-in (taxable=true) takes precedence', () => {
    it('returns the product rate when both product and category are opted in', () => {
      const product = { taxable: true, taxRate: 5 };
      const category = { taxable: true, defaultTaxRate: 16 };
      expect(resolveEffectiveTaxRate(product, category)).toBe(5);
    });

    it('returns the product rate even when the category is opted in with a different rate', () => {
      const product = { taxable: true, taxRate: new Decimal('8.5') };
      const category = { taxable: true, defaultTaxRate: 16 };
      expect(resolveEffectiveTaxRate(product, category)).toBe(8.5);
    });
  });

  describe('category opted-in fallback', () => {
    it('returns the category defaultTaxRate when the product is not opted in', () => {
      const product = { taxable: false, taxRate: 0 };
      const category = { taxable: true, defaultTaxRate: 16 };
      expect(resolveEffectiveTaxRate(product, category)).toBe(16);
    });

    it('accepts a Decimal category rate', () => {
      const product = { taxable: false, taxRate: 0 };
      const category = { taxable: true, defaultTaxRate: new Decimal('10.5') };
      expect(resolveEffectiveTaxRate(product, category)).toBe(10.5);
    });
  });

  describe('no tax by default (opt-in only)', () => {
    it('returns 0 when neither product nor category is opted in', () => {
      const product = { taxable: false, taxRate: 0 };
      const category = { taxable: false, defaultTaxRate: 0 };
      expect(resolveEffectiveTaxRate(product, category)).toBe(0);
    });

    it('returns 0 when the category is opted in but has no rate', () => {
      const product = { taxable: false, taxRate: 0 };
      const category = { taxable: true, defaultTaxRate: null };
      expect(resolveEffectiveTaxRate(product, category)).toBe(0);
    });

    it('returns 0 when the category is null', () => {
      const product = { taxable: false, taxRate: 0 };
      expect(resolveEffectiveTaxRate(product, null)).toBe(0);
    });
  });

  describe('defensive: opted-in without a usable rate', () => {
    it('falls back to the category when the product is opted in but has no rate', () => {
      const product = { taxable: true, taxRate: null };
      const category = { taxable: true, defaultTaxRate: 16 };
      expect(resolveEffectiveTaxRate(product, category)).toBe(16);
    });

    it('returns 0 when the product is opted in with rate 0 and category is not opted in', () => {
      const product = { taxable: true, taxRate: 0 };
      const category = { taxable: false, defaultTaxRate: 0 };
      expect(resolveEffectiveTaxRate(product, category)).toBe(0);
    });
  });
});

describe('dianTributeCode(code)', () => {
  it('maps IVA to the DIAN tribute code 01', () => {
    expect(dianTributeCode(DianTaxCode.IVA)).toBe('01');
  });

  it('maps INC to the DIAN tribute code 04', () => {
    expect(dianTributeCode(DianTaxCode.INC)).toBe('04');
  });

  it('maps ICA to the DIAN tribute code 03', () => {
    expect(dianTributeCode(DianTaxCode.ICA)).toBe('03');
  });
});

describe('resolveEffectiveTaxCode(product, category)', () => {
  it('defaults a taxable product with no code to IVA', () => {
    const product = { taxable: true, taxRate: 19, taxCode: null };
    const category = { taxable: false, defaultTaxRate: null };

    expect(resolveEffectiveTaxCode(product, category)).toBe(DianTaxCode.IVA);
  });

  it('keeps an explicit product code over the category default', () => {
    const product = { taxable: true, taxRate: 8, taxCode: DianTaxCode.INC };
    const category = {
      taxable: true,
      defaultTaxRate: 16,
      defaultTaxCode: DianTaxCode.ICA,
    };

    expect(resolveEffectiveTaxCode(product, category)).toBe(DianTaxCode.INC);
  });

  it('falls back to the category default code when the product is not opted in', () => {
    const product = { taxable: false, taxRate: 0, taxCode: null };
    const category = {
      taxable: true,
      defaultTaxRate: 16,
      defaultTaxCode: DianTaxCode.ICA,
    };

    expect(resolveEffectiveTaxCode(product, category)).toBe(DianTaxCode.ICA);
  });

  it('defaults a taxable category with no code to IVA', () => {
    const product = { taxable: false, taxRate: 0, taxCode: null };
    const category = {
      taxable: true,
      defaultTaxRate: 16,
      defaultTaxCode: null,
    };

    expect(resolveEffectiveTaxCode(product, category)).toBe(DianTaxCode.IVA);
  });

  it('returns null when neither the product nor its category is taxable', () => {
    const product = { taxable: false, taxRate: 0, taxCode: null };
    const category = {
      taxable: false,
      defaultTaxRate: null,
      defaultTaxCode: null,
    };

    expect(resolveEffectiveTaxCode(product, category)).toBeNull();
  });

  it('returns null when the product carries a code but no tax is charged', () => {
    const product = { taxable: true, taxRate: 0, taxCode: DianTaxCode.ICA };

    expect(resolveEffectiveTaxCode(product, null)).toBeNull();
  });

  it('returns null for a non-taxable product whose category is not opted in', () => {
    const product = { taxable: false, taxRate: 0, taxCode: DianTaxCode.INC };
    const category = {
      taxable: false,
      defaultTaxRate: null,
      defaultTaxCode: null,
    };

    expect(resolveEffectiveTaxCode(product, category)).toBeNull();
  });
});
