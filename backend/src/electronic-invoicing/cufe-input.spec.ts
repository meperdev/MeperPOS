import { computeCufe } from './cufe';
import {
  CufeSaleFacts,
  CufeSaleTaxLine,
  formatDianAmount,
  normalizeDianIdentification,
  resolveCufeInput,
} from './cufe-input';

describe('formatDianAmount', () => {
  it('truncates to two decimals without rounding and without separators', () => {
    expect(formatDianAmount('1500000')).toBe('1500000.00');
    expect(formatDianAmount('1500000.5')).toBe('1500000.50');
    expect(formatDianAmount('1500000.999')).toBe('1500000.99');
    expect(formatDianAmount('0.005')).toBe('0.00');
    expect(formatDianAmount('0')).toBe('0.00');
    expect(formatDianAmount('0012.30')).toBe('12.30');
  });

  it('rejects values that are not a plain non-negative decimal', () => {
    for (const value of [
      '',
      ' ',
      '1,000.00',
      '$1500',
      '-5.00',
      'abc',
      '1e3',
      '1.2.3',
      '.50',
      '5.',
      '5\n',
    ]) {
      expect(() => formatDianAmount(value)).toThrow();
    }
  });
});

describe('normalizeDianIdentification', () => {
  it('removes dots and spaces from an identification number', () => {
    expect(normalizeDianIdentification('800.199.436')).toBe('800199436');
    expect(normalizeDianIdentification(' 800199436 ')).toBe('800199436');
  });

  it('refuses to guess when a check digit is attached', () => {
    // "800.197.268-4" is a NIT plus its check digit. Stripping the dash would
    // silently hash 8001972684, which is not the NIT the annex asks for.
    expect(() => normalizeDianIdentification('800.197.268-4')).toThrow(
      /check digit/,
    );
  });

  it('rejects empty and non-digit identifications', () => {
    for (const value of ['', '   ', 'ABC', '800-199-436', '800 199 436X']) {
      expect(() => normalizeDianIdentification(value)).toThrow();
    }
  });
});

describe('resolveCufeInput', () => {
  const facts = {
    invoicePrefix: null as string | null,
    invoiceNumber: 323200000129,
    issuedAt: new Date('2019-01-16T15:53:10Z'),
    lineExtensionAmount: '1500000.00',
    // The sale-level tax. A pre-feature sale has no line-level amounts, so this
    // is the only value that can become ValImp1 for it.
    taxAmount: '285000.00',
    // The annex example has a single IVA bucket, so the persisted rows that
    // reproduce it are IVA lines summing to the published 285000.00.
    items: [{ taxCode: 'IVA', taxAmount: '285000.00' }] as CufeSaleTaxLine[],
    payableAmount: '1785000.00',
    issuerTaxId: '700.085.371',
    buyerTaxId: '800.199.436',
    technicalKey: '693ff6f2a553c3646a063436fd4dd9ded0311471',
    environment: '1' as const,
  };

  it('produces the CUFE published in Annex 1.9 section 11.2.1', () => {
    expect(computeCufe(resolveCufeInput(facts))).toBe(
      '8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4',
    );
  });

  it('concatenates prefix and consecutive with no separator', () => {
    expect(
      resolveCufeInput({
        ...facts,
        invoicePrefix: 'SETP',
        invoiceNumber: 990000001,
      }).invoiceNumber,
    ).toBe('SETP990000001');
    expect(
      resolveCufeInput({ ...facts, invoiceNumber: 990000001 }).invoiceNumber,
    ).toBe('990000001');
  });

  it('uses the Bogota calendar date and a -05:00 time regardless of UTC', () => {
    const crossingMidnight = resolveCufeInput({
      ...facts,
      issuedAt: new Date('2019-01-17T03:00:00Z'),
    });
    expect(crossingMidnight.issueDate).toBe('2019-01-16');
    expect(crossingMidnight.issueTime).toBe('22:00:00-05:00');

    const daytime = resolveCufeInput(facts);
    expect(daytime.issueDate).toBe('2019-01-16');
    expect(daytime.issueTime).toBe('10:53:10-05:00');
  });

  it('maps ValFac to the line extension total and ValTot to the payable amount', () => {
    const input = resolveCufeInput(facts);
    expect(input.taxableAmount).toBe('1500000.00');
    expect(input.totalAmount).toBe('1785000.00');
  });

  it('defaults to the test environment and rejects unknown ones', () => {
    const withoutEnvironment: CufeSaleFacts = {
      invoicePrefix: facts.invoicePrefix,
      invoiceNumber: facts.invoiceNumber,
      issuedAt: facts.issuedAt,
      lineExtensionAmount: facts.lineExtensionAmount,
      taxAmount: facts.taxAmount,
      items: facts.items,
      payableAmount: facts.payableAmount,
      issuerTaxId: facts.issuerTaxId,
      buyerTaxId: facts.buyerTaxId,
      technicalKey: facts.technicalKey,
    };
    expect(resolveCufeInput(withoutEnvironment).environment).toBe('2');
    expect(() =>
      resolveCufeInput({ ...facts, environment: '9' as '1' }),
    ).toThrow();
  });

  it('rejects a malformed issue instant instead of hashing a wrong date', () => {
    expect(() =>
      resolveCufeInput({ ...facts, issuedAt: new Date('nope') }),
    ).toThrow();
  });
});

/**
 * T4b rule 4/5: the three DIAN tax totals come from the persisted SaleItem
 * rows, never from one sale-level amount booked as IVA.
 */
describe('resolveCufeInput persisted tax codes', () => {
  const facts = {
    invoicePrefix: null as string | null,
    invoiceNumber: 323200000129,
    issuedAt: new Date('2019-01-16T15:53:10Z'),
    lineExtensionAmount: '1500000.00',
    taxAmount: '285000.00',
    payableAmount: '1785000.00',
    issuerTaxId: '700.085.371',
    buyerTaxId: '800.199.436',
    technicalKey: '693ff6f2a553c3646a063436fd4dd9ded0311471',
    environment: '2' as const,
  };
  const withItems = (items: CufeSaleTaxLine[]) =>
    resolveCufeInput({ ...facts, items });

  it('books the whole sale-level tax as IVA for a pre-feature sale', () => {
    // Rows written before tax codes existed carry neither a code nor a line
    // amount, so the sale-level tax is the only truth left. Adding the zero
    // cents of those rows would silently drop the invoice's IVA total.
    const input = resolveCufeInput({
      ...facts,
      taxAmount: '285000.00',
      items: [
        { taxCode: null, taxAmount: null },
        { taxCode: null, taxAmount: null },
      ],
    });

    expect(input.vatAmount).toBe('285000.00');
    expect(input.consumptionTaxAmount).toBe('0.00');
    expect(input.icaAmount).toBe('0.00');
  });

  it('sums the persisted IVA lines into ValImp1', () => {
    const input = withItems([
      { taxCode: 'IVA', taxAmount: '190000.00' },
      { taxCode: 'IVA', taxAmount: '95000.00' },
    ]);
    expect(input.vatAmount).toBe('285000.00');
    expect(input.consumptionTaxAmount).toBe('0.00');
    expect(input.icaAmount).toBe('0.00');
  });

  it('routes persisted INC to ValImp2 and ICA to ValImp3', () => {
    const input = withItems([
      { taxCode: 'INC', taxAmount: '38000.00' },
      { taxCode: 'ICA', taxAmount: '1000.00' },
      { taxCode: 'IVA', taxAmount: '190000.00' },
      { taxCode: null, taxAmount: null },
    ]);
    expect(input.vatAmount).toBe('190000.00');
    expect(input.consumptionTaxAmount).toBe('38000.00');
    expect(input.icaAmount).toBe('1000.00');
  });

  it('keeps every tax as IVA when no persisted line carries a code', () => {
    // Pre-feature sale (spec S7): historical rows stay NULL and are never
    // reclassified, so the old IVA-only behaviour is preserved exactly.
    const input = withItems([
      { taxCode: null, taxAmount: '190000.00' },
      { taxCode: null, taxAmount: '95000.00' },
    ]);
    expect(input.vatAmount).toBe('285000.00');
    expect(input.consumptionTaxAmount).toBe('0.00');
    expect(input.icaAmount).toBe('0.00');
  });

  it('throws when a coded sale has a taxed line without a code', () => {
    // At least one code makes the persisted codes authoritative: guessing IVA
    // here is exactly the defect this rule removes.
    expect(() =>
      withItems([
        { taxCode: 'INC', taxAmount: '38000.00' },
        { taxCode: null, taxAmount: '190000.00' },
      ]),
    ).toThrow(/tax code/);
  });

  it('counts a coded line with no tax money as zero instead of failing', () => {
    // `DECIMAL(10,2)` rounds a sub-cent tax down to 0.00 while the code stays.
    // The code is a recorded fact, not a guess, so it contributes nothing and
    // the sale stays invoiceable.
    const input = withItems([
      { taxCode: 'INC', taxAmount: '0.00' },
      { taxCode: 'ICA', taxAmount: null },
      { taxCode: 'IVA', taxAmount: '190000.00' },
    ]);
    expect(input.consumptionTaxAmount).toBe('0.00');
    expect(input.icaAmount).toBe('0.00');
    expect(input.vatAmount).toBe('190000.00');
  });

  it('throws on a sale with no persisted line instead of hashing zero tax', () => {
    expect(() => withItems([])).toThrow(/at least one/);
  });

  it('truncates each persisted amount to cents before summing', () => {
    // Money never goes through Number: 0.999 and 0.005 contribute 0.99 + 0.00.
    const input = withItems([
      { taxCode: 'IVA', taxAmount: '0.999' },
      { taxCode: 'IVA', taxAmount: '0.005' },
    ]);
    expect(input.vatAmount).toBe('0.99');
  });

  it('rejects a persisted code that is not IVA, INC or ICA', () => {
    expect(() =>
      withItems([{ taxCode: 'RENTA' as never, taxAmount: '10.00' }]),
    ).toThrow(/tax code/);
  });

  it('rejects a persisted amount that is not a plain decimal', () => {
    expect(() =>
      withItems([{ taxCode: 'IVA', taxAmount: '1,900.00' }]),
    ).toThrow(/Invalid DIAN amount/);
  });
});
