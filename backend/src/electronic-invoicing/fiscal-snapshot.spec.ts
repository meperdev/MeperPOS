import { Prisma } from '@prisma/client';
import {
  FISCAL_SNAPSHOT_VERSION,
  buildFiscalSnapshot,
  type FiscalSnapshotInput,
} from './fiscal-snapshot';

/**
 * T4c: the fiscal snapshot is the immutable record of the facts a CUFE will
 * later be built from. It is taken inside the sale transaction, so a later
 * product, category, customer or organization edit must never be able to
 * rewrite what the sale registered. It carries no CUFE: the technical key is
 * not available (spec S6).
 */
describe('buildFiscalSnapshot', () => {
  const issuedAt = new Date('2026-11-04T15:20:31.000Z');

  const line = (
    overrides: Partial<FiscalSnapshotInput['lines'][number]> = {},
  ): FiscalSnapshotInput['lines'][number] => ({
    productId: 'prod-1',
    quantity: 1,
    unitPrice: new Prisma.Decimal('100.00'),
    discountAmount: new Prisma.Decimal('0.00'),
    subtotal: new Prisma.Decimal('100.00'),
    taxRate: new Prisma.Decimal('19.00'),
    taxCode: 'IVA',
    taxAmount: new Prisma.Decimal('19.00'),
    total: new Prisma.Decimal('119.00'),
    ...overrides,
  });

  const input = (
    overrides: Partial<FiscalSnapshotInput> = {},
  ): FiscalSnapshotInput => ({
    saleId: 'sale-new',
    saleNumber: 77,
    organizationId: 'org-1',
    issuedAt,
    issuerTaxId: '900123456',
    buyerTaxId: null,
    lineExtensionAmount: new Prisma.Decimal('100.00'),
    taxAmount: new Prisma.Decimal('19.00'),
    discountAmount: new Prisma.Decimal('0.00'),
    payableAmount: new Prisma.Decimal('119.00'),
    amountPaid: new Prisma.Decimal('119.00'),
    change: null,
    lines: [line()],
    ...overrides,
  });

  it('records the sale identity, the issue instant and the invoice money', () => {
    const snapshot = buildFiscalSnapshot(input());

    expect(snapshot).toEqual({
      version: FISCAL_SNAPSHOT_VERSION,
      saleId: 'sale-new',
      saleNumber: 77,
      organizationId: 'org-1',
      issuedAt: '2026-11-04T15:20:31.000Z',
      currency: 'COP',
      issuerTaxId: '900123456',
      buyerTaxId: null,
      lineExtensionAmount: '100.00',
      taxAmount: '19.00',
      discountAmount: '0.00',
      payableAmount: '119.00',
      amountPaid: '119.00',
      change: null,
      lines: [
        {
          lineNumber: 1,
          productId: 'prod-1',
          quantity: 1,
          unitPrice: '100.00',
          discountAmount: '0.00',
          subtotal: '100.00',
          taxRate: '19.00',
          taxCode: 'IVA',
          taxAmount: '19.00',
          total: '119.00',
        },
      ],
    });
  });

  it('records the persisted tax code and amount of every line', () => {
    const snapshot = buildFiscalSnapshot(
      input({
        lines: [
          line(),
          line({
            productId: 'prod-2',
            taxCode: 'INC',
            taxAmount: new Prisma.Decimal('8.00'),
            total: new Prisma.Decimal('108.00'),
          }),
        ],
        taxAmount: new Prisma.Decimal('27.00'),
        payableAmount: new Prisma.Decimal('227.00'),
        amountPaid: new Prisma.Decimal('227.00'),
      }),
    );

    expect(snapshot.lines.map((row) => [row.lineNumber, row.taxCode])).toEqual([
      [1, 'IVA'],
      [2, 'INC'],
    ]);
    expect(snapshot.lines[1].taxAmount).toBe('8.00');
  });

  it('keeps an untaxed line untaxed: no code and no amount', () => {
    const snapshot = buildFiscalSnapshot(
      input({
        lines: [
          line({
            taxCode: null,
            taxAmount: null,
            taxRate: new Prisma.Decimal('0.00'),
            total: new Prisma.Decimal('100.00'),
          }),
        ],
        taxAmount: new Prisma.Decimal('0.00'),
        payableAmount: new Prisma.Decimal('100.00'),
        amountPaid: new Prisma.Decimal('100.00'),
      }),
    );

    expect(snapshot.lines[0].taxCode).toBeNull();
    expect(snapshot.lines[0].taxAmount).toBeNull();
  });

  it('refuses a taxed line that carries no tax code', () => {
    expect(() =>
      buildFiscalSnapshot(
        input({ lines: [line({ taxCode: null, taxAmount: '19.00' })] }),
      ),
    ).toThrow(/tax code/i);
  });

  it('refuses a coded line that carries no tax amount', () => {
    expect(() =>
      buildFiscalSnapshot(
        input({ lines: [line({ taxCode: 'IVA', taxAmount: null })] }),
      ),
    ).toThrow(/tax amount/i);
  });

  it('refuses an unknown tax code instead of snapshotting it', () => {
    expect(() =>
      buildFiscalSnapshot(
        input({ lines: [line({ taxCode: 'UNKNOWN' as never })] }),
      ),
    ).toThrow(/tax code/i);
  });

  it('refuses a sale with no lines', () => {
    expect(() => buildFiscalSnapshot(input({ lines: [] }))).toThrow(/line/i);
  });

  it('refuses a missing sale or organization identity', () => {
    expect(() => buildFiscalSnapshot(input({ saleId: '  ' }))).toThrow(/sale/i);
    expect(() => buildFiscalSnapshot(input({ organizationId: '' }))).toThrow(
      /organization/i,
    );
  });

  it('refuses a sale number that is not a positive integer', () => {
    expect(() => buildFiscalSnapshot(input({ saleNumber: 0 }))).toThrow(
      /sale number/i,
    );
    expect(() => buildFiscalSnapshot(input({ saleNumber: 1.5 }))).toThrow(
      /sale number/i,
    );
  });

  it('refuses an invalid issue instant', () => {
    expect(() =>
      buildFiscalSnapshot(input({ issuedAt: new Date('nope') })),
    ).toThrow(/issue/i);
  });

  it('refuses a malformed or negative money value', () => {
    expect(() =>
      buildFiscalSnapshot(input({ payableAmount: 'not-money' })),
    ).toThrow(/money/i);
    expect(() =>
      buildFiscalSnapshot(input({ taxAmount: -1 as never })),
    ).toThrow(/money/i);
  });

  it('rounds money to the two decimals the column stores, never through float error', () => {
    const snapshot = buildFiscalSnapshot(
      input({ payableAmount: new Prisma.Decimal('119.005') }),
    );

    expect(snapshot.payableAmount).toBe('119.01');
  });

  it('normalizes a blank identification to null instead of snapshotting whitespace', () => {
    const snapshot = buildFiscalSnapshot(
      input({ issuerTaxId: '   ', buyerTaxId: ' 900.111.222-3 ' }),
    );

    expect(snapshot.issuerTaxId).toBeNull();
    expect(snapshot.buyerTaxId).toBe('900.111.222-3');
  });

  it('carries no CUFE: the technical key is not available (S6)', () => {
    const snapshot = buildFiscalSnapshot(input());

    expect(Object.keys(snapshot)).not.toContain('cufe');
    expect(Object.keys(snapshot)).not.toContain('technicalKey');
  });

  it('is deeply frozen so no later code path can rewrite it', () => {
    const snapshot = buildFiscalSnapshot(input());

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.lines)).toBe(true);
    expect(Object.isFrozen(snapshot.lines[0])).toBe(true);
    // Strict mode turns the write attempt into a TypeError instead of a silent
    // no-op, which is the stronger guarantee: no caller can rewrite a
    // registered fiscal fact even by accident.
    expect(() => {
      snapshot.payableAmount = '0.00';
    }).toThrow(TypeError);
    expect(() => {
      snapshot.lines[0].taxAmount = '0.00';
    }).toThrow(TypeError);
    expect(() => {
      snapshot.lines.push(snapshot.lines[0]);
    }).toThrow(TypeError);
    expect(snapshot.payableAmount).toBe('119.00');
    expect(snapshot.lines[0].taxAmount).toBe('19.00');
    expect(snapshot.lines).toHaveLength(1);
  });

  it('does not share mutable state with its input', () => {
    const lines = [line()];
    const snapshot = buildFiscalSnapshot(input({ lines }));

    expect(snapshot.lines).not.toBe(lines);
    expect(snapshot.lines[0]).not.toBe(lines[0]);
  });
});
