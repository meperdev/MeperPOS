/**
 * The state machine of a sale's fiscal document, and the only code path allowed
 * to move one.
 *
 * A sale registers its document as PENDING inside the sale transaction
 * (`SalesService.create`). From there this service owns the whole lifecycle:
 *
 *   PENDING → SENT → {ACCEPTED, REJECTED}
 *   PENDING → VOIDED
 *   SENT    → VOIDED
 *
 * Everything else — including a same-state transition and any edge out of the
 * terminal states ACCEPTED, REJECTED and VOIDED — answers 409 Conflict and
 * leaves the row untouched (spec S8: an invalid transition is not silence).
 *
 * Two invariants hold on every path:
 *
 *   - Organization isolation. Every read and every write carries
 *     `organizationId`, and a document owned by another organization answers
 *     404 rather than 403, so its existence never leaks.
 *   - Snapshot immutability. A transition writes `status` and its timestamps
 *     only. `snapshot` is written once, by the sale transaction, and is never
 *     part of an update payload. That rule is enforced here, not by the
 *     database: no constraint prevents a direct SQL UPDATE from rewriting a
 *     snapshot, and no append-only audit trail of transitions exists yet.
 *
 * Preservation is enforced by the database too (T4h): both foreign keys of a
 * fiscal document are `ON DELETE RESTRICT`, so deleting its sale or its
 * organization is refused rather than allowed to cascade the record away.
 *
 * This service does not compute a CUFE and records no DIAN answer: the DIAN
 * technical key is not available (spec S6). `cufe` and `invoiceNumber` stay
 * NULL because no transport exists, and a caller that passes either is refused
 * rather than allowed to invent issuance facts; nothing here derives them.
 * It is registered in `ElectronicInvoicingModule` as an internal provider with
 * no controller, so no HTTP route exposes a transition.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FiscalDocumentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The complete transition table. Exported so a test can pin every edge instead
 * of the code being the only description of itself.
 */
export const FISCAL_DOCUMENT_TRANSITIONS: Readonly<
  Record<FiscalDocumentStatus, readonly FiscalDocumentStatus[]>
> = Object.freeze({
  [FiscalDocumentStatus.PENDING]: Object.freeze([
    FiscalDocumentStatus.SENT,
    FiscalDocumentStatus.VOIDED,
  ]),
  [FiscalDocumentStatus.SENT]: Object.freeze([
    FiscalDocumentStatus.ACCEPTED,
    FiscalDocumentStatus.REJECTED,
    FiscalDocumentStatus.VOIDED,
  ]),
  [FiscalDocumentStatus.ACCEPTED]: Object.freeze([]),
  [FiscalDocumentStatus.REJECTED]: Object.freeze([]),
  [FiscalDocumentStatus.VOIDED]: Object.freeze([]),
});

/** States with no outgoing edge: reaching one records `resolvedAt`. */
const TERMINAL_STATUSES: readonly FiscalDocumentStatus[] = Object.freeze([
  FiscalDocumentStatus.ACCEPTED,
  FiscalDocumentStatus.REJECTED,
  FiscalDocumentStatus.VOIDED,
]);

export interface FiscalDocumentTransitionDetails {
  /** Required when rejecting; refused on any other target. */
  rejectionReason?: string;
}

/**
 * The fields a transition may carry, and nothing else.
 *
 * Issuance facts (`cufe`, `invoiceNumber`) are deliberately absent: no
 * transport exists yet, so accepting them here would let a caller mint
 * arbitrary issuance data (spec S6). They stay NULL until a real transport
 * writes them, in its own change, with its own verification.
 */
const TRANSITION_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'rejectionReason',
]);

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new BadRequestException(`${field} cannot be blank`);
  }
  return trimmed;
}

/**
 * Voids the fiscal document of a cancelled sale, inside the sale transaction.
 *
 * The state machine is the same one the service exposes: only PENDING and SENT
 * have an edge to VOIDED. A document already ACCEPTED or REJECTED cannot be
 * voided here, and the cancellation is refused with 409 rather than leaving a
 * resolved document describing a sale that no longer exists (a credit note is
 * out of this task). A sale without a document — an organization that never
 * activated electronic invoicing — cancels exactly as before.
 */
export async function voidSaleFiscalDocument(
  tx: Prisma.TransactionClient,
  sale: { saleId: string; organizationId: string },
): Promise<void> {
  const current = await tx.fiscalDocument.findFirst({
    where: { saleId: sale.saleId, organizationId: sale.organizationId },
    select: { id: true, status: true },
  });
  if (!current) {
    return;
  }

  const allowed = FISCAL_DOCUMENT_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(FiscalDocumentStatus.VOIDED)) {
    throw new ConflictException(
      `Cannot cancel the sale: its fiscal document is ${current.status}`,
    );
  }

  const changed = await tx.fiscalDocument.updateMany({
    where: {
      id: current.id,
      organizationId: sale.organizationId,
      status: current.status,
    },
    data: {
      status: FiscalDocumentStatus.VOIDED,
      resolvedAt: new Date(),
    },
  });
  if (changed.count !== 1) {
    throw new ConflictException(
      'The fiscal document changed while the sale was being cancelled',
    );
  }
}

@Injectable()
export class FiscalDocumentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Reads the fiscal document of a sale, scoped to its organization. */
  async findBySaleId(saleId: string, organizationId: string) {
    return this.requireDocument({ saleId, organizationId });
  }

  /** Reads a fiscal document by id, scoped to its organization. */
  async findOne(id: string, organizationId: string) {
    return this.requireDocument({ id, organizationId });
  }

  /**
   * Moves a document to `target`, or answers 409 without writing anything.
   *
   * The legality check runs before the write, and the write itself is guarded
   * by the status that was read, so two concurrent transitions cannot both
   * succeed: the loser matches no row and gets the same 409.
   */
  async transition(
    id: string,
    organizationId: string,
    target: FiscalDocumentStatus,
    details: FiscalDocumentTransitionDetails = {},
  ) {
    const current = await this.prisma.fiscalDocument.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true },
    });
    if (!current) {
      // 404, never 403: another organization's document must not reveal that it
      // exists, and nothing has been written at this point.
      throw new NotFoundException('Fiscal document not found');
    }

    const allowed = FISCAL_DOCUMENT_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(target)) {
      throw new ConflictException(
        `Cannot move the fiscal document from ${current.status} to ${target}`,
      );
    }

    const data = this.buildTransitionData(target, details);
    const changed = await this.prisma.fiscalDocument.updateMany({
      where: { id, organizationId, status: current.status },
      data,
    });
    if (changed.count !== 1) {
      throw new ConflictException(
        'The fiscal document changed while it was being updated',
      );
    }

    return this.findOne(id, organizationId);
  }

  private async requireDocument(where: Prisma.FiscalDocumentWhereInput) {
    const document = await this.prisma.fiscalDocument.findFirst({ where });
    if (!document) {
      throw new NotFoundException('Fiscal document not found');
    }
    return document;
  }

  /**
   * Builds the update payload for one transition. It carries the status and the
   * timestamps of that transition — never `snapshot`, `issuedAt`, `saleId` or
   * `organizationId`, which are facts of the moment the sale was registered.
   */
  private buildTransitionData(
    target: FiscalDocumentStatus,
    details: FiscalDocumentTransitionDetails,
  ): Prisma.FiscalDocumentUpdateManyMutationInput {
    // Refuse unknown details explicitly instead of dropping them: a caller that
    // passes a CUFE or an invoice number must hear that this service never
    // records issuance facts it cannot verify.
    for (const key of Object.keys(details)) {
      if (!TRANSITION_DETAIL_KEYS.has(key)) {
        throw new BadRequestException(
          `${key} is not part of a fiscal document transition`,
        );
      }
    }

    if (details.rejectionReason !== undefined) {
      if (target !== FiscalDocumentStatus.REJECTED) {
        throw new BadRequestException(
          'A rejection reason is only recorded when the document is rejected',
        );
      }
    }

    const now = new Date();
    const data: Prisma.FiscalDocumentUpdateManyMutationInput = {
      status: target,
    };

    if (target === FiscalDocumentStatus.SENT) {
      data.sentAt = now;
    }

    if (target === FiscalDocumentStatus.REJECTED) {
      if (details.rejectionReason === undefined) {
        throw new BadRequestException(
          'A rejection reason is required when rejecting a fiscal document',
        );
      }
      data.rejectionReason = requireText(
        details.rejectionReason,
        'The rejection reason',
      );
    }

    if (TERMINAL_STATUSES.includes(target)) {
      data.resolvedAt = now;
    }

    return data;
  }
}
