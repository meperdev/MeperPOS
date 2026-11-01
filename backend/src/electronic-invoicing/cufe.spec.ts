import { computeCufe } from './cufe';

describe('computeCufe', () => {
  const example = {
    invoiceNumber: '323200000129',
    issueDate: '2019-01-16',
    issueTime: '10:53:10-05:00',
    taxableAmount: '1500000.00',
    vatAmount: '285000.00',
    consumptionTaxAmount: '0.00',
    icaAmount: '0.00',
    totalAmount: '1785000.00',
    issuerTaxId: '700085371',
    buyerId: '800199436',
    technicalKey: '693ff6f2a553c3646a063436fd4dd9ded0311471',
    environment: '1' as const,
  };

  it('matches the DIAN Annex 1.9 section 11.2.1 example', () => {
    expect(computeCufe(example)).toBe(
      '8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4',
    );
  });

  it('rejects malformed monetary strings in every monetary field', () => {
    const fields = [
      'taxableAmount',
      'vatAmount',
      'consumptionTaxAmount',
      'icaAmount',
      'totalAmount',
    ] as const;
    for (const field of fields) {
      for (const value of [
        '',
        '1',
        '1.2',
        '1.234',
        '1,000.00',
        '-1.00',
        '.00',
        '1.00\n',
      ]) {
        expect(() => computeCufe({ ...example, [field]: value })).toThrow();
      }
    }
  });

  it('rejects non-digit issuer and buyer identifiers', () => {
    for (const field of ['issuerTaxId', 'buyerId'] as const) {
      for (const value of ['', '123-4', '123.456', '123a', '123\n']) {
        expect(() => computeCufe({ ...example, [field]: value })).toThrow();
      }
    }
  });

  // Every one of the 15 concatenated fields must be a non-empty string. A null
  // or undefined field used to be coerced to '' by Array#join, producing a
  // plausible-looking but wrong CUFE with no error.
  it('rejects a null, undefined or empty value in any field', () => {
    const fields = Object.keys(example) as (keyof typeof example)[];
    for (const field of fields) {
      for (const value of [null, undefined, ''] as unknown[]) {
        expect(() =>
          computeCufe({ ...example, [field]: value } as typeof example),
        ).toThrow();
      }
    }
  });

  it('rejects whitespace and control characters in text fields', () => {
    for (const field of [
      'invoiceNumber',
      'issueDate',
      'issueTime',
      'technicalKey',
    ] as const) {
      for (const value of [
        ' has space',
        'tab\there',
        'line\nbreak',
        'nul\u0000byte',
        'carriage\rreturn',
      ]) {
        expect(() => computeCufe({ ...example, [field]: value })).toThrow();
      }
    }
  });

  it('accepts only a yyyy-MM-dd issue date that is a real calendar day', () => {
    expect(computeCufe({ ...example, issueDate: '2024-02-29' })).toMatch(
      /^[0-9a-f]{96}$/,
    );
    for (const value of [
      '16/01/2019',
      '2019-1-16',
      '20190116',
      '2019-13-01',
      '2019-02-30',
      '2019-00-10',
    ]) {
      expect(() => computeCufe({ ...example, issueDate: value })).toThrow();
    }
  });

  it('accepts only an hh:mm:ss with a UTC offset issue time', () => {
    for (const value of [
      '10:53',
      '10:53:10',
      '105310-05:00',
      '25:00:00-05:00',
    ]) {
      expect(() => computeCufe({ ...example, issueTime: value })).toThrow();
    }
    expect(computeCufe({ ...example, issueTime: '23:59:59-05:00' })).toMatch(
      /^[0-9a-f]{96}$/,
    );
  });

  it('accepts only an alphanumeric technical key', () => {
    expect(
      computeCufe({ ...example, technicalKey: 'ClaveTecnica123' }),
    ).toMatch(/^[0-9a-f]{96}$/);
    for (const value of [
      'key-with-dash',
      'key_underscore',
      'key.dot',
      'clave ñ',
    ]) {
      expect(() => computeCufe({ ...example, technicalKey: value })).toThrow();
    }
  });

  it('accepts only the production and test environment codes', () => {
    expect(computeCufe({ ...example, environment: '2' })).toMatch(
      /^[0-9a-f]{96}$/,
    );
    for (const value of ['0', '3', '9', '01', 'a']) {
      expect(() =>
        computeCufe({ ...example, environment: value as '1' }),
      ).toThrow();
    }
  });
});
