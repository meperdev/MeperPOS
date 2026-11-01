import {
  DianExtensionsInput,
  DianNumberingRange,
  DianSoftware,
  buildQrCodeUrl,
  computeSoftwareSecurityCode,
  resolveDianExtensions,
} from './dian-extensions';

/** The CUFE published in Annex 1.9 section 11.2.1, reused as a valid fixture. */
const CUFE =
  '8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4';

const INVOICE_NUMBER = 'SETP990000001';
const ISSUE_DATE = '2019-01-16';

/** Synthetic numbering range. No value here comes from a real authorization. */
function numberingRange(
  overrides: Partial<DianNumberingRange> = {},
): DianNumberingRange {
  return {
    invoiceAuthorization: '12345678901234',
    startsOn: '2019-01-01',
    endsOn: '2019-12-31',
    prefix: 'SETP',
    from: '990000001',
    to: '990000999',
    ...overrides,
  };
}

/** Synthetic software credentials. No value here comes from the DIAN catalogue. */
function software(overrides: Partial<DianSoftware> = {}): DianSoftware {
  return {
    providerId: '900123456',
    providerCheckDigit: '7',
    softwareId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
    securityPin: '98765',
    ...overrides,
  };
}

function resolve(
  input: {
    numberingRange?: Partial<DianNumberingRange>;
    software?: Partial<DianSoftware>;
    invoiceNumber?: string;
    issueDate?: string;
    cufe?: string;
    environment?: '1' | '2';
  } = {},
) {
  const extensions: DianExtensionsInput = {
    numberingRange: numberingRange(input.numberingRange),
    software: software(input.software),
  };
  return resolveDianExtensions(extensions, {
    invoiceNumber: input.invoiceNumber ?? INVOICE_NUMBER,
    issueDate: input.issueDate ?? ISSUE_DATE,
    cufe: input.cufe ?? CUFE,
    environment: input.environment ?? '2',
  });
}

describe('computeSoftwareSecurityCode', () => {
  // Annex 1.9 section 11.8: SoftwareSecurityCode = SHA-384 (Id Software + Pin +
  // NroDocumentos), where NroDocumentos is the document `cbc:ID`.
  it('hashes software id, PIN and document number, in that order, as SHA-384', () => {
    expect(
      computeSoftwareSecurityCode(
        'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
        '98765',
        'SETP990000001',
      ),
    ).toBe(
      '52e3c61760ca1b978388c0e3013a1ce35a3705c9516d203505e86f2c24fa407124d8fd03a34291e1ec5d70b66c25071a',
    );
  });

  it('is 96 lowercase hex characters and moves with every input', () => {
    const base = computeSoftwareSecurityCode('SW1', '00000', 'FE1');

    expect(base).toMatch(/^[0-9a-f]{96}$/);
    expect(computeSoftwareSecurityCode('SW2', '00000', 'FE1')).not.toBe(base);
    expect(computeSoftwareSecurityCode('SW1', '00001', 'FE1')).not.toBe(base);
    expect(computeSoftwareSecurityCode('SW1', '00000', 'FE2')).not.toBe(base);
  });

  it('concatenates the three values with no separator, as the annex writes it', () => {
    // "SHA-384 (Id Software + Pin + NroDocumentos)" is a plain concatenation,
    // so these two seeds are the same string and must hash alike.
    expect(computeSoftwareSecurityCode('SW', '12', '3')).toBe(
      computeSoftwareSecurityCode('SW', '1', '23'),
    );
  });
});

describe('buildQrCodeUrl', () => {
  // Annex 1.9 section 11.7.1 publishes exactly two hosts; FAD07 fixes
  // "@schemeID 1 = Producción; 2 = Prueba", so the pairing is forced.
  it('uses the habilitación host in environment 2', () => {
    expect(buildQrCodeUrl('2', CUFE)).toBe(
      `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${CUFE}`,
    );
  });

  it('uses the production host in environment 1', () => {
    expect(buildQrCodeUrl('1', CUFE)).toBe(
      `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${CUFE}`,
    );
  });

  it('carries the document key verbatim, with no placeholder left behind', () => {
    const url = buildQrCodeUrl('2', CUFE);

    expect(url).toContain(CUFE);
    expect(url).not.toContain('CUFE');
  });
});

describe('resolveDianExtensions', () => {
  it('returns the numbering range and software values as given', () => {
    expect(resolve()).toEqual({
      invoiceAuthorization: '12345678901234',
      authorizationStartDate: '2019-01-01',
      authorizationEndDate: '2019-12-31',
      prefix: 'SETP',
      from: '990000001',
      to: '990000999',
      providerId: '900123456',
      providerCheckDigit: '7',
      softwareId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
      softwareSecurityCode:
        '52e3c61760ca1b978388c0e3013a1ce35a3705c9516d203505e86f2c24fa407124d8fd03a34291e1ec5d70b66c25071a',
      qrCode: `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${CUFE}`,
    });
  });

  it('never carries the software PIN out of the resolver', () => {
    expect(JSON.stringify(resolve())).not.toContain('98765');
  });
});

describe('resolveDianExtensions numbering range rules', () => {
  // FAB05: `sts:InvoiceAuthorization`, type EN, size 14.
  it('rejects an invoice authorization that is not exactly 14 digits', () => {
    for (const value of [
      '1234567890123',
      '123456789012345',
      '1234567890123A',
      '',
    ]) {
      expect(() =>
        resolve({ numberingRange: { invoiceAuthorization: value } }),
      ).toThrow(/numberingRange\.invoiceAuthorization/);
    }
  });

  // FAB07: StartDate must be earlier than or equal to the invoice IssueDate.
  it('rejects an authorization period that starts after the issue date', () => {
    expect(() =>
      resolve({ numberingRange: { startsOn: '2019-01-17' } }),
    ).toThrow(/numberingRange\.startsOn/);
    // The boundary is legal: FAB07 says "anterior o igual".
    expect(() =>
      resolve({ numberingRange: { startsOn: '2019-01-16' } }),
    ).not.toThrow();
  });

  // FAB08: EndDate must be later than or equal to the invoice IssueDate.
  it('rejects an authorization period that ends before the issue date', () => {
    expect(() => resolve({ numberingRange: { endsOn: '2019-01-15' } })).toThrow(
      /numberingRange\.endsOn/,
    );
    expect(() =>
      resolve({ numberingRange: { endsOn: '2019-01-16' } }),
    ).not.toThrow();
  });

  // FAB07/FAB08 are typed EF: a date in YYYY-MM-DD, not a timestamp.
  it('rejects authorization dates that are not real calendar days', () => {
    expect(() =>
      resolve({ numberingRange: { startsOn: '2019-02-30' } }),
    ).toThrow(/numberingRange\.startsOn/);
    expect(() => resolve({ numberingRange: { endsOn: '31/12/2019' } })).toThrow(
      /numberingRange\.endsOn/,
    );
  });

  // FAB10: `sts:Prefix`, type EA, size 0-4, optional.
  it('rejects a prefix longer than the four characters the annex allows', () => {
    expect(() => resolve({ numberingRange: { prefix: 'SETPX' } })).toThrow(
      /numberingRange\.prefix/,
    );
  });

  it('rejects a prefix the invoice number does not start with', () => {
    // FAD05: cbc:ID carries prefix + consecutive, so a prefix that is not a
    // prefix of the number describes a different billing point.
    expect(() => resolve({ numberingRange: { prefix: 'OTRO' } })).toThrow(
      /numberingRange\.prefix/,
    );
  });

  it('keeps the prefix optional', () => {
    const resolved = resolve({ numberingRange: { prefix: undefined } });

    expect(resolved.prefix).toBeUndefined();
    expect('prefix' in resolved).toBe(false);
  });

  it('rejects an empty prefix instead of emitting an empty element', () => {
    expect(() => resolve({ numberingRange: { prefix: '' } })).toThrow(
      /numberingRange\.prefix/,
    );
  });

  // FAB11 and FAB12 call these the "valor inicial" and "valor final" of one
  // authorized range, and FAD05d reads the range as the interval the document
  // number must fall in. An inverted pair therefore describes no interval.
  it('rejects an inverted numbering range', () => {
    expect(() =>
      resolve({ numberingRange: { from: '990000999', to: '990000001' } }),
    ).toThrow(/numberingRange/);
  });

  it('accepts a single-number range, where from equals to', () => {
    expect(() =>
      resolve({ numberingRange: { from: '990000001', to: '990000001' } }),
    ).not.toThrow();
  });

  it('compares range bounds as numbers, not as text', () => {
    // Text comparison puts "100" before "99"; the bounds are numbers.
    expect(() =>
      resolve({ numberingRange: { from: '99', to: '100' } }),
    ).not.toThrow();
    // Leading zeros are insignificant in a numeric field.
    expect(() =>
      resolve({ numberingRange: { from: '0990', to: '990' } }),
    ).not.toThrow();
    expect(() =>
      resolve({ numberingRange: { from: '0990', to: '98' } }),
    ).toThrow(/numberingRange/);
  });

  // FAB11 and FAB12: `sts:From` and `sts:To`, type EN, size 1-9.
  it('rejects a range bound that is not one to nine digits', () => {
    for (const value of ['', '1234567890', '99000000A', '99000000.1']) {
      expect(() => resolve({ numberingRange: { from: value } })).toThrow(
        /numberingRange\.from/,
      );
      expect(() => resolve({ numberingRange: { to: value } })).toThrow(
        /numberingRange\.to/,
      );
    }
  });
});

describe('resolveDianExtensions software rules', () => {
  // FAB19: `sts:ProviderID`, type EN, size 3-15.
  it('rejects a provider NIT that is not three to fifteen digits', () => {
    for (const value of ['12', '1234567890123456', '90012345A', '']) {
      expect(() => resolve({ software: { providerId: value } })).toThrow(
        /software\.providerId/,
      );
    }
  });

  // FAB22: the NIT check digit is reported in @schemeID.
  it('rejects a provider check digit that is not numeric', () => {
    for (const value of ['', 'K', '7 ']) {
      expect(() =>
        resolve({ software: { providerCheckDigit: value } }),
      ).toThrow(/software\.providerCheckDigit/);
    }
  });

  // FAB24: `sts:softwareID` is mandatory.
  it('rejects a missing software id', () => {
    expect(() => resolve({ software: { softwareId: '' } })).toThrow(
      /software\.softwareId/,
    );
  });

  it('rejects software text that XML cannot carry', () => {
    expect(() => resolve({ software: { softwareId: 'SW\u0001' } })).toThrow(
      /software\.softwareId/,
    );
    expect(() => resolve({ software: { softwareId: ' SW ' } })).toThrow(
      /software\.softwareId/,
    );
  });

  it('rejects a missing software PIN', () => {
    expect(() => resolve({ software: { securityPin: '' } })).toThrow(
      /software\.securityPin/,
    );
  });

  it('never echoes the PIN in a rejection message', () => {
    let message = '';
    try {
      resolve({ software: { securityPin: 'secret\u0000pin' } });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('software.securityPin');
    expect(message).not.toContain('secret');
  });
});

describe('resolveDianExtensions document context rules', () => {
  // FAD07 fixes the environment codes and 11.7.1 one host each: an unknown code
  // has no host and would otherwise be rendered as the literal "undefined".
  it('rejects an environment outside "1" and "2"', () => {
    expect(() => resolve({ environment: '3' as unknown as '1' | '2' })).toThrow(
      /environment/,
    );
  });

  // FAB36 points the QR code at the value of /Invoice/cbc:UUID.
  it('rejects a missing document key', () => {
    expect(() => resolve({ cufe: '' })).toThrow(/cufe/);
  });

  it('rejects a document key that is not a CUFE', () => {
    // /Invoice/cbc:UUID is 96 lowercase hex characters (FAD06). The QR code
    // must not point somewhere DIAN cannot resolve.
    expect(() => resolve({ cufe: 'no-es-un-cufe' })).toThrow(/cufe/);
    expect(() => resolve({ cufe: CUFE.toUpperCase() })).toThrow(/cufe/);
  });
});

/**
 * Data that reaches this module may be a JSON body or a database row, so the
 * compiler's guarantees are not enough: a missing group must be named, not
 * dereferenced into an opaque `TypeError`.
 */
describe('resolveDianExtensions malformed input', () => {
  const context = {
    invoiceNumber: INVOICE_NUMBER,
    issueDate: ISSUE_DATE,
    cufe: CUFE,
    environment: '2' as const,
  };

  it('names a missing numbering range instead of dereferencing it', () => {
    const incomplete = {
      software: software(),
    } as unknown as DianExtensionsInput;

    expect(() => resolveDianExtensions(incomplete, context)).toThrow(
      /^Invalid DIAN extension field "numberingRange"/,
    );
  });

  it('names a missing software group instead of dereferencing it', () => {
    const incomplete = {
      numberingRange: numberingRange(),
    } as unknown as DianExtensionsInput;

    expect(() => resolveDianExtensions(incomplete, context)).toThrow(
      /^Invalid DIAN extension field "software"/,
    );
  });

  it('names a missing block instead of dereferencing it', () => {
    expect(() =>
      resolveDianExtensions(
        undefined as unknown as DianExtensionsInput,
        context,
      ),
    ).toThrow(/^Invalid DIAN extension field "dianExtensions"/);
  });

  it('never leaks the PIN when another part of the input is malformed', () => {
    let message = '';
    try {
      resolveDianExtensions(
        {
          software: software({ securityPin: 'P@ss98765' }),
        } as unknown as DianExtensionsInput,
        context,
      );
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/numberingRange/);
    expect(message).not.toContain('P@ss98765');
  });
});
