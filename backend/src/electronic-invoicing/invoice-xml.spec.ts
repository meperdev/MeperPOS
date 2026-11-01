import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DianInvoiceInput, buildInvoiceXml } from './invoice-xml';

/** The CUFE published in Annex 1.9 section 11.2.1, reused as a valid fixture. */
const CUFE =
  '8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4';

const XSD_PATH = '/tmp/dian_annex/ubl21/xsd/maindoc/UBL-Invoice-2.1.xsd';

function baseInput(
  overrides: Partial<DianInvoiceInput> = {},
): DianInvoiceInput {
  return {
    invoiceNumber: 'SETP990000001',
    cufe: CUFE,
    issueDate: '2019-01-16',
    issueTime: '10:53:10-05:00',
    environment: '2',
    issuer: { taxId: '700085371', name: 'Meper POS SAS' },
    buyer: { taxId: '800199436', name: 'Cliente de prueba SAS' },
    lines: [
      {
        id: 1,
        quantity: 2,
        lineExtensionAmount: '1000000.00',
        unitPrice: '500000.00',
        taxAmount: '190000.00',
        description: 'Camiseta',
        sellerItemId: 'SKU-1',
      },
      {
        id: 2,
        quantity: 1,
        lineExtensionAmount: '500000.00',
        unitPrice: '500000.00',
        taxAmount: '95000.00',
        description: 'Gorra',
      },
    ],
    lineExtensionAmount: '1500000.00',
    taxAmount: '285000.00',
    payableAmount: '1785000.00',
    ...overrides,
  };
}

/** Tags of the elements that open exactly at `depth` (2 spaces per level). */
function tagsAtDepth(xml: string, depth: number): string[] {
  const pad = '  '.repeat(depth);
  return xml
    .split('\n')
    .filter(
      (line) => line.startsWith(`${pad}<`) && !line.startsWith(`${pad}</`),
    )
    .map((line) => /^<([A-Za-z0-9:]+)/.exec(line.slice(pad.length))?.[1] ?? '');
}

/** Full source of every `tag` container opening at `depth`. */
function blocks(xml: string, tag: string, depth: number): string[] {
  const pad = '  '.repeat(depth);
  const lines = xml.split('\n');
  const found: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== `${pad}<${tag}>`) {
      continue;
    }
    let end = index;
    while (end < lines.length && lines[end] !== `${pad}</${tag}>`) {
      end += 1;
    }
    found.push(lines.slice(index, end + 1).join('\n'));
    index = end;
  }
  return found;
}

function block(
  xml: string,
  tag: string,
  depth: number,
  occurrence = 0,
): string {
  const found = blocks(xml, tag, depth);
  if (found.length <= occurrence) {
    throw new Error(`missing ${tag} at depth ${depth}`);
  }
  return found[occurrence];
}

/** Text of every `tag` element that opens exactly at `depth`. */
function valueAtDepth(xml: string, tag: string, depth: number): string[] {
  const pad = '  '.repeat(depth);
  return xml
    .split('\n')
    .filter(
      (line) =>
        line.startsWith(`${pad}<${tag}>`) || line.startsWith(`${pad}<${tag} `),
    )
    .map((line) =>
      line.slice(line.indexOf('>') + 1, line.lastIndexOf(`</${tag}>`)),
    );
}

function xmllintAvailable(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Writes `xml` to a throwaway file outside the repository and returns its path. */
function writeTemporaryXml(xml: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'meperpos-invoice-xml-'));
  const path = join(directory, 'invoice.xml');
  writeFileSync(path, xml, 'utf8');
  return path;
}

describe('buildInvoiceXml header', () => {
  it('emits the DIAN literals in the XSD sequence order, and nothing else', () => {
    const xml = buildInvoiceXml(baseInput());

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"',
    );
    expect(xml).toContain(
      'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"',
    );
    expect(xml).toContain(
      'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"',
    );

    // This list is read straight from InvoiceType in UBL-Invoice-2.1.xsd, which
    // is an xs:sequence: any element out of order is an invalid document.
    expect(tagsAtDepth(xml, 1)).toEqual([
      'cbc:UBLVersionID',
      'cbc:CustomizationID',
      'cbc:ProfileID',
      'cbc:ProfileExecutionID',
      'cbc:ID',
      'cbc:UUID',
      'cbc:IssueDate',
      'cbc:IssueTime',
      'cbc:InvoiceTypeCode',
      'cbc:DocumentCurrencyCode',
      'cbc:LineCountNumeric',
      'cac:AccountingSupplierParty',
      'cac:AccountingCustomerParty',
      'cac:TaxTotal',
      'cac:LegalMonetaryTotal',
      'cac:InvoiceLine',
      'cac:InvoiceLine',
    ]);

    expect(valueAtDepth(xml, 'cbc:UBLVersionID', 1)).toEqual(['UBL 2.1']);
    expect(valueAtDepth(xml, 'cbc:CustomizationID', 1)).toEqual(['10']);
    expect(valueAtDepth(xml, 'cbc:ProfileID', 1)).toEqual([
      'DIAN 2.1: Factura Electrónica de Venta',
    ]);
    expect(valueAtDepth(xml, 'cbc:ProfileExecutionID', 1)).toEqual(['2']);
    expect(valueAtDepth(xml, 'cbc:ID', 1)).toEqual(['SETP990000001']);
    expect(valueAtDepth(xml, 'cbc:IssueDate', 1)).toEqual(['2019-01-16']);
    expect(valueAtDepth(xml, 'cbc:IssueTime', 1)).toEqual(['10:53:10-05:00']);
    expect(valueAtDepth(xml, 'cbc:InvoiceTypeCode', 1)).toEqual(['01']);
  });

  it('omits everything that is out of scope for an unsigned, unsubmitted document', () => {
    const xml = buildInvoiceXml(baseInput());

    expect(xml).not.toContain('UBLExtensions');
    expect(xml).not.toContain('DianExtensions');
    expect(xml).not.toContain('ds:Signature');
    expect(xml).not.toContain('cac:WithholdingTaxTotal');
    expect(xml).not.toContain('cac:AllowanceCharge');
    expect(xml).not.toContain('cac:PaymentMeans');
    expect(xml).not.toContain('cac:Delivery');
    expect(xml).not.toContain('cac:InvoicePeriod');
  });
});

describe('buildInvoiceXml CUFE placement', () => {
  it('carries the CUFE in cbc:UUID with schemeName CUFE-SHA384, once', () => {
    const xml = buildInvoiceXml(baseInput());

    expect(xml).toContain(
      `<cbc:UUID schemeName="CUFE-SHA384">${CUFE}</cbc:UUID>`,
    );
    expect(valueAtDepth(xml, 'cbc:UUID', 1)).toEqual([CUFE]);
    expect(xml.split('<cbc:UUID').length - 1).toBe(1);
  });
});

describe('buildInvoiceXml party identification', () => {
  // Annex 1.9 rows FAK24 and FAK64: on both `PartyTaxScheme/cbc:CompanyID` and
  // `PartyIdentification/cbc:ID`, `@schemeName` carries the document type (31 =
  // NIT) while `@schemeID` carries the NIT check digit ("DV del NIT"). Emitting
  // the type code in `@schemeID` declares a check digit of 31, which the XSD
  // cannot catch because both attributes are optional strings.
  it('carries the check digit in schemeID and the type code in schemeName', () => {
    const xml = buildInvoiceXml(
      baseInput({
        issuer: { taxId: '700085371', name: 'Meper POS SAS', checkDigit: '1' },
        buyer: {
          taxId: '800199436',
          name: 'Cliente de prueba SAS',
          checkDigit: '4',
        },
      }),
    );

    expect(xml).not.toContain('schemeID="31"');
    expect(xml).toContain(
      '<cbc:ID schemeName="31" schemeID="1">700085371</cbc:ID>',
    );
    expect(xml).toContain(
      '<cbc:ID schemeName="31" schemeID="4">800199436</cbc:ID>',
    );
    expect(xml).toContain(
      '<cbc:CompanyID schemeName="31" schemeID="1">700085371</cbc:CompanyID>',
    );
    expect(xml).toContain(
      '<cbc:CompanyID schemeName="31" schemeID="4">800199436</cbc:CompanyID>',
    );
  });

  it('omits schemeID entirely when no check digit is supplied', () => {
    const xml = buildInvoiceXml(baseInput());

    expect(xml).not.toContain('schemeID="31"');
    expect(xml).toContain('schemeName="31"');
  });
});

describe('buildInvoiceXml totals', () => {
  it('reports exactly one invoice-level TaxTotal holding one IVA subtotal', () => {
    const xml = buildInvoiceXml(baseInput());

    expect(blocks(xml, 'cac:TaxTotal', 1)).toHaveLength(1);
    const taxTotal = block(xml, 'cac:TaxTotal', 1);
    expect(valueAtDepth(taxTotal, 'cbc:TaxAmount', 2)).toEqual(['285000.00']);

    const subtotals = blocks(taxTotal, 'cac:TaxSubtotal', 2);
    expect(subtotals).toHaveLength(1);
    expect(valueAtDepth(subtotals[0], 'cbc:TaxableAmount', 3)).toEqual([
      '1500000.00',
    ]);
    expect(valueAtDepth(subtotals[0], 'cbc:TaxAmount', 3)).toEqual([
      '285000.00',
    ]);

    const category = block(subtotals[0], 'cac:TaxCategory', 3);
    expect(valueAtDepth(category, 'cbc:ID', 4)).toEqual(['01']);
    expect(valueAtDepth(category, 'cbc:Name', 4)).toEqual(['IVA']);
    const scheme = block(category, 'cac:TaxScheme', 4);
    expect(valueAtDepth(scheme, 'cbc:ID', 5)).toEqual(['01']);
    expect(valueAtDepth(scheme, 'cbc:Name', 5)).toEqual(['IVA']);

    // INC (04) and ICA (03) must not be reported anywhere.
    expect(xml).not.toContain('INC');
    expect(xml).not.toContain('ICA');
    expect(xml).not.toMatch(/>(03|04)</);
  });

  it('writes the LegalMonetaryTotal amounts verbatim and in sequence', () => {
    const xml = buildInvoiceXml(baseInput());
    const total = block(xml, 'cac:LegalMonetaryTotal', 1);

    expect(tagsAtDepth(total, 2)).toEqual([
      'cbc:LineExtensionAmount',
      'cbc:TaxExclusiveAmount',
      'cbc:TaxInclusiveAmount',
      'cbc:PayableAmount',
    ]);
    expect(valueAtDepth(total, 'cbc:LineExtensionAmount', 2)).toEqual([
      '1500000.00',
    ]);
    expect(valueAtDepth(total, 'cbc:TaxExclusiveAmount', 2)).toEqual([
      '1500000.00',
    ]);
    expect(valueAtDepth(total, 'cbc:TaxInclusiveAmount', 2)).toEqual([
      '1785000.00',
    ]);
    expect(valueAtDepth(total, 'cbc:PayableAmount', 2)).toEqual(['1785000.00']);
    // udt:AmountType in UBL-UnqualifiedDataTypes-2.1.xsd makes currencyID
    // mandatory, so every amount must carry it.
    expect(total).toContain(
      '<cbc:LineExtensionAmount currencyID="COP">1500000.00</cbc:LineExtensionAmount>',
    );
    expect(total).toContain(
      '<cbc:PayableAmount currencyID="COP">1785000.00</cbc:PayableAmount>',
    );
  });
});

describe('buildInvoiceXml lines', () => {
  it('emits one InvoiceLine per input line with quantity and amounts', () => {
    const xml = buildInvoiceXml(baseInput());
    const lines = blocks(xml, 'cac:InvoiceLine', 1);

    expect(lines).toHaveLength(2);

    expect(valueAtDepth(lines[0], 'cbc:ID', 2)).toEqual(['1']);
    expect(valueAtDepth(lines[0], 'cbc:InvoicedQuantity', 2)).toEqual(['2']);
    expect(lines[0]).toContain('<cbc:InvoicedQuantity unitCode="94">2');
    expect(valueAtDepth(lines[0], 'cbc:LineExtensionAmount', 2)).toEqual([
      '1000000.00',
    ]);
    expect(valueAtDepth(lines[0], 'cbc:Description', 3)).toEqual(['Camiseta']);
    expect(valueAtDepth(lines[0], 'cbc:PriceAmount', 3)).toEqual(['500000.00']);

    const lineTaxTotal = block(lines[0], 'cac:TaxTotal', 2);
    expect(valueAtDepth(lineTaxTotal, 'cbc:TaxAmount', 3)).toEqual([
      '190000.00',
    ]);
    expect(valueAtDepth(lineTaxTotal, 'cbc:TaxableAmount', 4)).toEqual([
      '1000000.00',
    ]);

    expect(
      valueAtDepth(
        block(lines[0], 'cac:SellersItemIdentification', 3),
        'cbc:ID',
        4,
      ),
    ).toEqual(['SKU-1']);
    expect(lines[1]).not.toContain('SellersItemIdentification');

    expect(valueAtDepth(lines[1], 'cbc:ID', 2)).toEqual(['2']);
    expect(valueAtDepth(lines[1], 'cbc:LineExtensionAmount', 2)).toEqual([
      '500000.00',
    ]);
    expect(valueAtDepth(lines[1], 'cbc:Description', 3)).toEqual(['Gorra']);
  });

  it('reports the number of lines in cbc:LineCountNumeric', () => {
    const threeLines = baseInput({
      lines: [
        ...baseInput().lines,
        {
          id: 3,
          quantity: 4,
          lineExtensionAmount: '20000.00',
          unitPrice: '5000.00',
          taxAmount: '3800.00',
          description: 'Sticker',
        },
      ],
    });
    const xml = buildInvoiceXml(threeLines);

    expect(valueAtDepth(xml, 'cbc:LineCountNumeric', 1)).toEqual(['3']);
    expect(blocks(xml, 'cac:InvoiceLine', 1)).toHaveLength(3);
  });
});

describe('buildInvoiceXml currency', () => {
  it('defaults DocumentCurrencyCode to COP', () => {
    const xml = buildInvoiceXml(baseInput());

    expect(valueAtDepth(xml, 'cbc:DocumentCurrencyCode', 1)).toEqual(['COP']);
  });

  it('honours an explicit currency override', () => {
    const xml = buildInvoiceXml(baseInput({ currency: 'USD' }));

    expect(valueAtDepth(xml, 'cbc:DocumentCurrencyCode', 1)).toEqual(['USD']);
  });
});

describe('buildInvoiceXml text safety', () => {
  it('escapes & and < in a line description', () => {
    const input = baseInput();
    input.lines[0].description = 'Ropa & accesorios <talla L>';

    const xml = buildInvoiceXml(input);

    expect(xml).toContain(
      '<cbc:Description>Ropa &amp; accesorios &lt;talla L&gt;</cbc:Description>',
    );
    expect(xml).not.toContain('Ropa & accesorios <talla L>');
  });

  it('escapes the full set of XML metacharacters in a party name', () => {
    const input = baseInput();
    input.buyer.name = 'A & B <"distribuciones"> \'Ltda\'';

    const xml = buildInvoiceXml(input);

    expect(xml).toContain(
      'A &amp; B &lt;&quot;distribuciones&quot;&gt; &apos;Ltda&apos;',
    );
  });

  it('still produces well-formed XML when descriptions carry metacharacters', () => {
    if (!xmllintAvailable()) {
      console.warn(
        '[invoice-xml.spec] Skipping well-formedness check: xmllint is not installed.',
      );
      return;
    }
    const input = baseInput();
    input.lines[0].description = 'Ropa & accesorios <talla L> "premium"';
    input.issuer.name = 'Meper & Cía <SAS>';

    const path = writeTemporaryXml(buildInvoiceXml(input));
    expect(() =>
      execFileSync('xmllint', ['--noout', path], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});

describe('buildInvoiceXml rejections', () => {
  it('rejects a malformed monetary amount instead of emitting it', () => {
    expect(() =>
      buildInvoiceXml(baseInput({ payableAmount: '1785000' })),
    ).toThrow(/payableAmount/);
    expect(() =>
      buildInvoiceXml(baseInput({ taxAmount: '285000,00' })),
    ).toThrow(/taxAmount/);
    expect(() =>
      buildInvoiceXml(baseInput({ lineExtensionAmount: '-1.00' })),
    ).toThrow(/lineExtensionAmount/);
    expect(() =>
      buildInvoiceXml({
        ...baseInput(),
        lines: [{ ...baseInput().lines[0], unitPrice: '500000.5' }],
      }),
    ).toThrow(/lines\[0\]\.unitPrice/);
    expect(() =>
      buildInvoiceXml({
        ...baseInput(),
        lines: [{ ...baseInput().lines[1], taxAmount: 'NaN' }],
      }),
    ).toThrow(/lines\[0]\.taxAmount/);
  });

  it('rejects a CUFE that is not 96 lowercase hex characters', () => {
    expect(() =>
      buildInvoiceXml(baseInput({ cufe: CUFE.toUpperCase() })),
    ).toThrow(/cufe/);
    expect(() =>
      buildInvoiceXml(baseInput({ cufe: CUFE.slice(0, 95) })),
    ).toThrow(/cufe/);
  });

  it('rejects an environment outside "1" and "2"', () => {
    expect(() =>
      buildInvoiceXml(baseInput({ environment: '3' as unknown as '1' })),
    ).toThrow(/environment/);
  });

  it('rejects an invoiceNumber that is not alphanumeric', () => {
    expect(() =>
      buildInvoiceXml(baseInput({ invoiceNumber: 'SETP-99' })),
    ).toThrow(/invoiceNumber/);
    expect(() => buildInvoiceXml(baseInput({ invoiceNumber: '' }))).toThrow(
      /invoiceNumber/,
    );
  });

  it('rejects a date or time that does not match the DIAN format', () => {
    expect(() =>
      buildInvoiceXml(baseInput({ issueDate: '2019-02-30' })),
    ).toThrow(/issueDate/);
    expect(() =>
      buildInvoiceXml(baseInput({ issueDate: '16/01/2019' })),
    ).toThrow(/issueDate/);
    expect(() => buildInvoiceXml(baseInput({ issueTime: '10:53:10' }))).toThrow(
      /issueTime/,
    );
    expect(() =>
      buildInvoiceXml(baseInput({ issueTime: '25:00:00-05:00' })),
    ).toThrow(/issueTime/);
  });

  it('rejects tax ids that are not plain digits', () => {
    expect(() =>
      buildInvoiceXml({
        ...baseInput(),
        issuer: { taxId: '700.085.371', name: 'Meper POS SAS' },
      }),
    ).toThrow(/issuer\.taxId/);
    expect(() =>
      buildInvoiceXml({
        ...baseInput(),
        buyer: { taxId: '800199436-1', name: 'Cliente de prueba SAS' },
      }),
    ).toThrow(/buyer\.taxId/);
  });

  it('rejects a line whose id is not its 1-based position', () => {
    const input = baseInput();
    input.lines[1].id = 5;
    expect(() => buildInvoiceXml(input)).toThrow(/lines\[1\]\.id/);
  });

  it('rejects a non-positive or fractional quantity', () => {
    const zero = baseInput();
    zero.lines[0].quantity = 0;
    expect(() => buildInvoiceXml(zero)).toThrow(/lines\[0\]\.quantity/);

    const fractional = baseInput();
    fractional.lines[0].quantity = 1.5;
    expect(() => buildInvoiceXml(fractional)).toThrow(/lines\[0\]\.quantity/);
  });

  it('rejects an invoice without lines, since UBL requires at least one', () => {
    expect(() => buildInvoiceXml(baseInput({ lines: [] }))).toThrow(/lines/);
  });

  it('rejects a currency that is not a three-letter uppercase code', () => {
    expect(() => buildInvoiceXml(baseInput({ currency: 'cop' }))).toThrow(
      /currency/,
    );
  });
});

describe('buildInvoiceXml determinism', () => {
  it('returns byte-identical output for the same input', () => {
    const first = buildInvoiceXml(baseInput());
    const second = buildInvoiceXml(baseInput());

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.trimEnd().endsWith('</Invoice>')).toBe(true);
  });
});

/**
 * The strongest check: the document must validate against the official OASIS
 * UBL 2.1 Invoice schema. The schema tree is a machine-local fixture, so the
 * suite announces a skip loudly instead of passing silently when it is absent.
 */
const xsdAvailable = existsSync(XSD_PATH);
if (!xsdAvailable) {
  console.warn(
    `[invoice-xml.spec] Skipping XSD validation: schema fixture not found at ${XSD_PATH}`,
  );
}
const describeXsd = xsdAvailable ? describe : describe.skip;

describeXsd('buildInvoiceXml against UBL-Invoice-2.1.xsd', () => {
  it('validates the generated document with xmllint', () => {
    if (!xmllintAvailable()) {
      throw new Error(
        'xmllint is required to validate the generated invoice but is not installed',
      );
    }
    const path = writeTemporaryXml(buildInvoiceXml(baseInput()));

    expect(() =>
      execFileSync('xmllint', ['--noout', '--schema', XSD_PATH, path], {
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
