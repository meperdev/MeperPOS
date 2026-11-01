import { computeCufe } from './cufe';
import {
  CufeSaleFacts,
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
    taxAmount: '285000.00',
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

  it('books the whole tax as IVA and zeroes the other two tax codes', () => {
    const input = resolveCufeInput(facts);
    expect(input.vatAmount).toBe('285000.00');
    expect(input.consumptionTaxAmount).toBe('0.00');
    expect(input.icaAmount).toBe('0.00');
  });

  it('defaults to the test environment and rejects unknown ones', () => {
    const withoutEnvironment: CufeSaleFacts = {
      invoicePrefix: facts.invoicePrefix,
      invoiceNumber: facts.invoiceNumber,
      issuedAt: facts.issuedAt,
      lineExtensionAmount: facts.lineExtensionAmount,
      taxAmount: facts.taxAmount,
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
