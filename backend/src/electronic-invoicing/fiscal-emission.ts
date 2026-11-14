/**
 * The one write path that turns a registered sale into a local fiscal document.
 *
 * It runs inside the caller's sale transaction, for cash and financed sales
 * alike, so a persisted sale and its fiscal record are committed together or
 * not at all.
 *
 * Spec S9 — «solo para quienes la tienen activa»: the organization carries the
 * activation decision. An organization that never activated electronic
 * invoicing is not invoiced: this module writes nothing and the ordinary sale
 * proceeds untouched. Activation is read in the same transaction, so two sales
 * cannot disagree about it.
 *
 * Spec S6 — no issuance: the document is created locally as PENDING, with no
 * CUFE and no invoice number. The DIAN technical key is not available, and
 * nothing here invents one or contacts DIAN.
 */
import { Prisma } from '@prisma/client';
import { isElectronicInvoicingActive } from '../settings/schema';
import {
  buildFiscalSnapshot,
  type FiscalSnapshotLineInput,
  type SnapshotMoney,
} from './fiscal-snapshot';

/** The sale facts a fiscal document records, as the sale transaction persisted them. */
export interface SaleFiscalFacts {
  organizationId: string;
  saleId: string;
  saleNumber: number;
  /** The instant the sale was registered; the document is issued at that moment. */
  issuedAt: Date;
  /** Customer identification as it stood at registration, or null. */
  buyerTaxId: string | null;
  lineExtensionAmount: SnapshotMoney;
  taxAmount: SnapshotMoney;
  discountAmount: SnapshotMoney;
  payableAmount: SnapshotMoney;
  amountPaid: SnapshotMoney;
  change: SnapshotMoney | null;
  lines: readonly FiscalSnapshotLineInput[];
}

/**
 * Writes the PENDING fiscal document of a sale, or writes nothing when the
 * organization has not activated electronic invoicing.
 *
 * @returns `true` when a document was written, `false` when the organization is
 *          not activated (or no longer exists).
 */
export async function emitFiscalDocumentForSale(
  tx: Prisma.TransactionClient,
  facts: SaleFiscalFacts,
): Promise<boolean> {
  // One query carries both facts: whether to emit, and who the issuer is. It is
  // scoped by id, and the transaction keeps the answer consistent with the sale.
  // The activation flag is the backend-managed `settings.electronicInvoicing`
  // system key (spec S9), read defensively so a malformed blob cannot invoice.
  const organization = await tx.organization.findFirst({
    where: { id: facts.organizationId },
    select: { settings: true, taxId: true },
  });

  if (!organization || !isElectronicInvoicingActive(organization.settings)) {
    return false;
  }

  const snapshot = buildFiscalSnapshot({
    ...facts,
    issuerTaxId: organization.taxId,
  });

  await tx.fiscalDocument.create({
    data: {
      organizationId: facts.organizationId,
      saleId: facts.saleId,
      // Nothing has been sent: the state machine's first state.
      status: 'PENDING',
      issuedAt: facts.issuedAt,
      // SAFETY: `buildFiscalSnapshot` returns a plain, JSON-safe object
      // (strings, numbers, booleans, null and arrays); Prisma's
      // `InputJsonValue` is structurally wider than an interface, so the
      // compiler cannot prove it without an index signature.
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });

  return true;
}
