import { FiscalDocumentStatus, Prisma } from '@prisma/client';
import {
  emitFiscalDocumentForSale,
  type SaleFiscalFacts,
} from './fiscal-emission';

/**
 * T4c + spec S9: the one write path that turns a registered sale into a local
 * fiscal document.
 *
 * Two rules are pinned here because both have already been violated once:
 *
 *   - Activation. «solo para quienes la tienen activa»: an organization that
 *     has not activated electronic invoicing gets no fiscal record at all, so
 *     the pilot cannot silently invoice the whole install base.
 *   - No issuance. The record is local and PENDING with no CUFE; nothing in
 *     this module derives a technical key (spec S6).
 */
describe('emitFiscalDocumentForSale', () => {
  const issuedAt = new Date('2026-11-04T15:20:31.000Z');

  const facts = (
    overrides: Partial<SaleFiscalFacts> = {},
  ): SaleFiscalFacts => ({
    organizationId: 'org-1',
    saleId: 'sale-1',
    saleNumber: 42,
    issuedAt,
    buyerTaxId: null,
    lineExtensionAmount: '100.00',
    taxAmount: '19.00',
    discountAmount: '0.00',
    payableAmount: '119.00',
    amountPaid: '119.00',
    change: null,
    lines: [
      {
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
    ...overrides,
  });

  const buildTx = () => ({
    organization: { findFirst: jest.fn() },
    fiscalDocument: {
      create: jest
        .fn<Promise<{ id: string }>, [{ data: Record<string, unknown> }]>()
        .mockResolvedValue({ id: 'fiscal-1' }),
    },
  });

  type Tx = ReturnType<typeof buildTx>;

  const activated = (tx: Tx) =>
    tx.organization.findFirst.mockResolvedValue({
      taxId: '900123456',
      settings: { electronicInvoicing: { enabled: true } },
    });

  const payload = (tx: Tx) => tx.fiscalDocument.create.mock.calls[0][0].data;

  it('writes a PENDING local document in the caller transaction when the organization is activated', async () => {
    const tx = buildTx();
    activated(tx);

    await emitFiscalDocumentForSale(tx as never, facts());

    expect(tx.fiscalDocument.create).toHaveBeenCalledTimes(1);
    expect(payload(tx)).toMatchObject({
      organizationId: 'org-1',
      saleId: 'sale-1',
      status: FiscalDocumentStatus.PENDING,
      issuedAt,
    });
  });

  it('snapshots the fiscal facts with the issuer NIT read from the organization', async () => {
    const tx = buildTx();
    activated(tx);

    await emitFiscalDocumentForSale(
      tx as never,
      facts({ buyerTaxId: '900.111.222-3', change: '1.00' }),
    );

    expect(payload(tx).snapshot).toMatchObject({
      version: 1,
      saleId: 'sale-1',
      saleNumber: 42,
      organizationId: 'org-1',
      issuedAt: '2026-11-04T15:20:31.000Z',
      currency: 'COP',
      issuerTaxId: '900123456',
      buyerTaxId: '900.111.222-3',
      payableAmount: '119.00',
      change: '1.00',
    });
  });

  // Spec S9, in the only shape that matters: no activation, no record. The
  // caller's sale is not an error and must not fail because of it.
  it('writes nothing when the organization has not activated electronic invoicing', async () => {
    const tx = buildTx();
    tx.organization.findFirst.mockResolvedValue({
      taxId: '900123456',
      settings: {},
    });

    await expect(emitFiscalDocumentForSale(tx as never, facts())).resolves.toBe(
      false,
    );
    expect(tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  it('writes nothing when the organization cannot be read', async () => {
    const tx = buildTx();
    tx.organization.findFirst.mockResolvedValue(null);

    await emitFiscalDocumentForSale(tx as never, facts());

    expect(tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  it('reads activation and the issuer NIT with one organization-scoped query', async () => {
    const tx = buildTx();
    activated(tx);

    await emitFiscalDocumentForSale(tx as never, facts());

    expect(tx.organization.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.organization.findFirst).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: { settings: true, taxId: true },
    });
  });

  it('never writes a CUFE or an invoice number: the technical key is not available (S6)', async () => {
    const tx = buildTx();
    activated(tx);

    await emitFiscalDocumentForSale(tx as never, facts());

    expect(payload(tx)).not.toHaveProperty('cufe');
    expect(payload(tx)).not.toHaveProperty('invoiceNumber');
    expect(payload(tx).snapshot).not.toHaveProperty('cufe');
  });

  it('persists the snapshot as JSON-safe data', async () => {
    const tx = buildTx();
    activated(tx);

    await emitFiscalDocumentForSale(tx as never, facts());

    const snapshot = payload(tx).snapshot as Prisma.InputJsonValue;
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot).not.toBeInstanceOf(Date);
  });
});
