import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OrgRole } from '@prisma/client';
import { formatDateInBogota } from '../common/utils/bogota-date';
import { PrismaService } from '../prisma/prisma.service';
import { renderDailyReportPdf } from '../reports/daily-report.pdf';
import {
  DailyReportService,
  type DailyReport,
} from '../reports/daily-report.service';
import {
  INTELLIGENCE_SESSION,
  WhatsAppConnectionsService,
} from './whatsapp-connections.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';
import { normaliseContactPhone } from './whatsapp-ingestion.service';
import {
  WHATSAPP_FILE_SENDER,
  type WhatsAppFileSender,
} from './whatsapp-provider';

/**
 * Who may receive a report document. Duplicated from `WhatsAppAdminService` on
 * purpose: this service is injected *into* that one, so importing back would make
 * the two modules circular. The set is the same, and both are closed lists.
 */
const ADMINISTRATIVE_ROLES: readonly OrgRole[] = ['OWNER', 'ADMIN'];

/**
 * The only failure codes a delivery row may carry. The column is free text in the
 * schema, so this list is the contract: a provider body, an exception message, a
 * URL, a session name or a phone never reaches it. One attempt is made per claim
 * by design — WhatsApp 463 (cold contact) and 475 (message cap) are states to
 * wait out, not errors to hammer — so a FAILED row is retried by hand.
 */
export const WHATSAPP_DELIVERY_FAILURES = [
  /** No verified administrative identity to send the report to. */
  'no_recipient',
  /** The central connection serves more than one organization; never guessed. */
  'organization_ambiguous',
  /** `DailyReportService.generate` failed. */
  'report_failed',
  /** `renderDailyReportPdf` failed. */
  'render_failed',
  /** The provider refused the send (non-2xx, missing config, bad session). */
  'provider_rejected',
  /** Anything else the provider call threw. */
  'send_failed',
] as const;

export type WhatsAppDeliveryFailure =
  (typeof WHATSAPP_DELIVERY_FAILURES)[number];

/**
 * What happened to one delivery request. `already_attempted` and `no_identity`
 * are distinct on purpose: the caller must be able to tell "this day was already
 * claimed" apart from "nobody is allowed to receive it", without either of those
 * becoming an exception the scheduler or the webhook has to survive.
 */
export type WhatsAppDeliveryOutcome =
  | { status: 'sent'; providerMessageId: string | null }
  | { status: 'failed'; reason: WhatsAppDeliveryFailure }
  | { status: 'already_attempted' }
  | { status: 'no_identity' };

/**
 * An on-demand request, already authorized by the administrative gate: the
 * organization comes from the verified identity, and the phone is the sender's
 * own, because the answer goes back to the phone that asked.
 */
export interface WhatsAppDeliveryContext {
  organizationId: string;
  phone: string;
}

/**
 * The calendar day a delivery belongs to, as the UTC midnight that PostgreSQL
 * stores for a `date` column. Idempotent: a value already truncated stays put, so
 * the once-per-day claim cannot be defeated by passing an instant instead of a
 * day.
 */
export function reportDayOf(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

/** Today's report day in America/Bogota, computed from an arbitrary instant. */
export function bogotaReportDay(instant: Date): Date {
  return new Date(`${formatDateInBogota(instant)}T00:00:00.000Z`);
}

/** WAHA addresses one person as `<digits>@c.us`; never a JID taken from a body. */
export function chatIdFor(phone: unknown): string | null {
  const digits = normaliseContactPhone(phone);
  return digits ? `${digits}@c.us` : null;
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'P2002';

type ScheduledTarget =
  | { status: 'resolved'; organizationId: string; phone: string }
  | {
      status: 'unresolved';
      reason: 'no_recipient' | 'organization_ambiguous';
    };

/**
 * Delivers the daily report PDF over the central INTELLIGENCE session.
 *
 * Three rules hold for every method here:
 *
 *  - **The destination is derived, never supplied by a wire message.** A
 *    scheduled delivery goes to a verified administrative identity of the
 *    connection's organization; an on-demand delivery goes back to the phone that
 *    asked and only when that phone is a verified identity *in its own
 *    organization*. No chat id, session name, organization or filename from an
 *    inbound payload is ever used as an address.
 *  - **One attempt.** The row is claimed before the provider is called. After a
 *    claim there is no automatic retry in this service or in the scheduler.
 *  - **Nothing provider-shaped leaves.** A failure is recorded as one of the fixed
 *    codes above and logged as `{ event, outcome, reason }`; the provider's body,
 *    URL, session name, credential, the recipient's phone and the report figures
 *    are never logged and never rethrown with their original message for the
 *    other side to read.
 */
@Injectable()
export class WhatsAppDeliveryService {
  private readonly logger = new Logger(WhatsAppDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: WhatsAppConnectionsService,
    private readonly identity: WhatsAppIdentityService,
    private readonly reports: DailyReportService,
    @Inject(WHATSAPP_FILE_SENDER) private readonly sender: WhatsAppFileSender,
  ) {}

  /**
   * Send the scheduled report for one connection and one calendar day.
   *
   * The claim *is* the insert. A partial unique index on
   * `(connectionId, kind, reportDate) WHERE kind = 'SCHEDULED'` lets exactly one
   * caller create today's SCHEDULED row; a second cron firing, the bootstrap
   * catch-up racing the cron, or a manual call all lose with P2002 and answer
   * `already_attempted` without touching the provider. The same index is
   * deliberately partial, so on-demand reports never collide with each other.
   */
  async scheduled(
    connectionId: string,
    reportDate: Date,
  ): Promise<WhatsAppDeliveryOutcome> {
    const day = reportDayOf(reportDate);
    const claim = await this.claim(connectionId, 'SCHEDULED', day);
    if (!claim) {
      this.logger.warn({
        event: 'whatsapp_delivery',
        outcome: 'already_attempted',
      });
      return { status: 'already_attempted' };
    }

    const connection = await this.prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
      select: { organizationId: true },
    });
    const target = await this.scheduledTarget(
      connection?.organizationId ?? null,
    );

    if (target.status === 'unresolved') {
      await this.recordFailure(claim.id, target.reason);
      return target.reason === 'no_recipient'
        ? { status: 'no_identity' }
        : { status: 'failed', reason: target.reason };
    }

    return this.deliver(claim.id, target.organizationId, target.phone, day);
  }

  /**
   * Send the report PDF on demand, back to the caller's own phone.
   *
   * The identity is re-verified here rather than trusted from the gate's context,
   * and it must belong to the context's organization: a phone that is verified
   * somewhere else is not a recipient for this organization's figures. No
   * identity is an outcome, never an exception, because the gate answers a chat
   * message and a throw would turn into a webhook error the provider redelivers.
   */
  async onDemand(
    context: WhatsAppDeliveryContext,
  ): Promise<WhatsAppDeliveryOutcome> {
    const phone = normaliseContactPhone(context?.phone);
    const verified = phone ? await this.identity.verify(phone) : null;
    if (
      !phone ||
      !verified?.organizationId ||
      verified.organizationId !== context.organizationId
    ) {
      this.logger.warn({
        event: 'whatsapp_delivery',
        outcome: 'no_identity',
      });
      return { status: 'no_identity' };
    }

    const connection = await this.connections.getOrCreateIntelligence();
    const day = bogotaReportDay(new Date());
    const row = await this.prisma.whatsAppDelivery.create({
      data: {
        connectionId: connection.id,
        kind: 'ON_DEMAND',
        reportDate: day,
      },
      select: { id: true },
    });

    return this.deliver(row.id, verified.organizationId, phone, day);
  }

  /** Read-only: the scheduler asks whether today's scheduled row already exists. */
  findScheduled(connectionId: string, reportDate: Date) {
    return this.prisma.whatsAppDelivery.findFirst({
      where: {
        connectionId,
        kind: 'SCHEDULED',
        reportDate: reportDayOf(reportDate),
      },
      select: { id: true, status: true },
    });
  }

  /** Insert the attempt row; a lost race on the partial unique index is `null`. */
  private async claim(
    connectionId: string,
    kind: 'SCHEDULED' | 'ON_DEMAND',
    day: Date,
  ): Promise<{ id: string } | null> {
    try {
      return await this.prisma.whatsAppDelivery.create({
        data: { connectionId, kind, reportDate: day },
        select: { id: true },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return null;
    }
  }

  /**
   * Who receives the scheduled report.
   *
   * A connection that belongs to an organization answers for that organization
   * alone. The central connection has no organization of its own, so the
   * organization is the one the deployment's verified administrative identities
   * point at — and only when exactly one does. With two or more, choosing would
   * send one tenant's figures to another tenant's administrator, so the day is
   * recorded as `organization_ambiguous` instead of guessed; per-organization
   * scheduling is the design that has to arrive before the central connection can
   * serve more than one tenant.
   *
   * Within the organization, the recipient is the oldest verified identity whose
   * user holds OWNER or ADMIN there. A verified CASHIER identity is not an
   * administrative recipient, and an identity from another organization never
   * appears in this list.
   */
  private async scheduledTarget(
    connectionOrganizationId: string | null,
  ): Promise<ScheduledTarget> {
    const administrators = await this.administrativeIdentities(
      connectionOrganizationId,
    );

    if (connectionOrganizationId) {
      const recipient = administrators[0];
      if (!recipient) return { status: 'unresolved', reason: 'no_recipient' };
      return {
        status: 'resolved',
        organizationId: connectionOrganizationId,
        phone: recipient.phone,
      };
    }

    const organizations = new Set(
      administrators.map((row) => row.organizationId),
    );
    if (organizations.size === 0)
      return { status: 'unresolved', reason: 'no_recipient' };
    if (organizations.size > 1)
      return { status: 'unresolved', reason: 'organization_ambiguous' };

    const recipient = administrators[0];
    return {
      status: 'resolved',
      organizationId: recipient.organizationId,
      phone: recipient.phone,
    };
  }

  /**
   * Verified identities whose user is an OWNER or ADMIN of that identity's own
   * organization, oldest verification first. `organizationId === null` means "any
   * organization", used only to count how many organizations the central
   * connection would be speaking for.
   */
  private async administrativeIdentities(
    organizationId: string | null,
  ): Promise<Array<{ phone: string; organizationId: string }>> {
    const identities = await this.prisma.whatsAppIdentity.findMany({
      where: {
        status: 'VERIFIED',
        ...(organizationId
          ? { organizationId }
          : { organizationId: { not: null } }),
      },
      orderBy: [{ verifiedAt: 'asc' }, { id: 'asc' }],
      select: { phone: true, userId: true, organizationId: true },
    });
    if (identities.length === 0) return [];

    // The role is read for each identity's own user *in that identity's own
    // organization*; a person who owns another organization grants nothing here.
    const memberships = await this.prisma.organizationUser.findMany({
      where: {
        userId: { in: [...new Set(identities.map((row) => row.userId))] },
        role: { in: [...ADMINISTRATIVE_ROLES] },
      },
      select: { userId: true, organizationId: true },
    });
    const administrative = new Set(
      memberships.map((row) => `${row.organizationId}:${row.userId}`),
    );

    const recipients: Array<{ phone: string; organizationId: string }> = [];
    for (const row of identities) {
      if (!row.organizationId) continue;
      if (administrative.has(`${row.organizationId}:${row.userId}`))
        recipients.push({
          phone: row.phone,
          organizationId: row.organizationId,
        });
    }
    return recipients;
  }

  /** Build, render and send the document, then finalize the claimed row. */
  private async deliver(
    deliveryId: string,
    organizationId: string,
    phone: string,
    day: Date,
  ): Promise<WhatsAppDeliveryOutcome> {
    let report: DailyReport;
    try {
      report = await this.reports.generate(organizationId);
    } catch {
      return this.recordFailure(deliveryId, 'report_failed');
    }

    let pdf: Buffer;
    try {
      pdf = renderDailyReportPdf(report);
    } catch {
      return this.recordFailure(deliveryId, 'render_failed');
    }

    const chatId = chatIdFor(phone);
    if (!chatId) return this.recordFailure(deliveryId, 'no_recipient');

    let providerMessageId: string | null;
    try {
      ({ providerMessageId } = await this.sender.sendFile(
        INTELLIGENCE_SESSION,
        {
          chatId,
          filename: `reporte-diario-${day.toISOString().slice(0, 10)}.pdf`,
          mimetype: 'application/pdf',
          base64: pdf.toString('base64'),
        },
      ));
    } catch (error) {
      // A provider rejection and an unexpected transport error are both fixed
      // codes; the exception itself is dropped here so no provider text can travel
      // further than this frame.
      return this.recordFailure(
        deliveryId,
        error instanceof ServiceUnavailableException
          ? 'provider_rejected'
          : 'send_failed',
      );
    }

    await this.prisma.whatsAppDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'SENT',
        attempts: { increment: 1 },
        sentAt: new Date(),
        providerMessageId,
        failureReason: null,
      },
    });
    this.logger.log({ event: 'whatsapp_delivery', outcome: 'sent' });
    return { status: 'sent', providerMessageId };
  }

  /** Record the fixed failure code and answer it as an outcome. */
  private async recordFailure(
    deliveryId: string,
    reason: WhatsAppDeliveryFailure,
  ): Promise<WhatsAppDeliveryOutcome> {
    this.logger.warn({
      event: 'whatsapp_delivery',
      outcome: 'failed',
      reason,
    });
    await this.prisma.whatsAppDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'FAILED',
        failureReason: reason,
        attempts: { increment: 1 },
      },
    });
    return { status: 'failed', reason };
  }
}
