import { Injectable, Logger } from '@nestjs/common';
import type { OrgRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DailyReportService,
  type DailyReport,
} from '../reports/daily-report.service';
import { WhatsAppDeliveryService } from './whatsapp-delivery.service';
import { normaliseContactPhone } from './whatsapp-ingestion.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';

/**
 * Roles that may read administrative figures from a chat window. Anything else
 * a member of the organization might legitimately do in the web app (sell,
 * count stock, record an expense) grants nothing here: this channel answers
 * money and business-wide totals, so it needs the roles that already own them.
 */
const ADMINISTRATIVE_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>([
  'OWNER',
  'ADMIN',
]);

/**
 * The closed set of things this stage can answer. Matching is exact on the
 * normalised text, so no free-form instruction, no injected sentence and no
 * appended organization id can reach a query: a body that is not one of these
 * strings answers `unsupported`.
 */
const DAILY_SUMMARY_COMMANDS: ReadonlySet<string> = new Set([
  'resumen',
  'resumen del dia',
  'resumen de hoy',
  'cierre',
  'cierre del dia',
  'cierre de hoy',
  'reporte',
  'reporte del dia',
  'reporte diario',
  'reporte de hoy',
  'informe del dia',
]);

/**
 * The only commands that make this gate *send* something. Phrasing that already
 * means "give me the figures" (`reporte`, `cierre`, …) stays on the summary tool;
 * an administrator who wants the document asks for the document. Everything not
 * listed here is still `unsupported` and still sends nothing.
 */
const DAILY_PDF_COMMANDS: ReadonlySet<string> = new Set([
  'pdf',
  'reporte pdf',
  'pdf del reporte',
  'manda el reporte',
  'mandame el reporte',
  'envia el reporte',
  'manda el pdf',
]);

/**
 * Chat clients send whatever the sender's keyboard produced: `Resumen `,
 * `RESUMEN`, `resúmen del día`. Trimming, lowercasing, collapsing whitespace
 * and stripping diacritics lets the allowlist above stay ASCII and closed
 * without accepting a prefix or a substring.
 */
export function normaliseCommand(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const value = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return value.length > 0 ? value : null;
}

/**
 * What the gate concluded about the sender. `unlinked` and `forbidden` are
 * internal bookkeeping only.
 */
export type WhatsAppAdminAuthorization =
  | {
      status: 'authorized';
      userId: string;
      organizationId: string;
      role: OrgRole;
      /**
       * The sender's own number, reduced to digits. Carried on the context so the
       * only address an on-demand delivery can use is the phone that asked.
       */
      phone: string;
    }
  | { status: 'unlinked' }
  | { status: 'forbidden' };

/**
 * The only shape allowed to leave this service for a read tool. Every field is
 * an aggregate or a date: a caller in a future transport can render this on a
 * phone without ever holding a customer, a document number, a supplier name, a
 * product name, an address or a free-text description.
 */
export interface WhatsAppDailySummary {
  /** Business date the figures belong to, `YYYY-MM-DD` in America/Bogota. */
  reportDate: string;
  /** Instant the figures were cut at, ISO-8601. */
  cutoff: string;
  salesTotal: string;
  expenseTotal: string;
  salesCount: number;
  lowStockCount: number;
  pendingPurchaseOrderCount: number;
  loansDueCount: number;
}

/**
 * The gate's answer. `refused` carries a reason for internal accounting only:
 * see the class docblock — a transport must render every refusal identically.
 */
export type WhatsAppAdminAnswer =
  | {
      status: 'answered';
      tool: 'daily_summary';
      organizationId: string;
      summary: WhatsAppDailySummary;
    }
  | {
      status: 'delivered';
      tool: 'daily_report_pdf';
      organizationId: string;
      /** What the delivery attempt concluded; no provider text is included. */
      delivery: 'sent' | 'already_attempted' | 'failed' | 'no_identity';
    }
  | { status: 'refused'; reason: 'unlinked' | 'forbidden' | 'unavailable' }
  | { status: 'unsupported' };

/** A figure, and nothing that could be a name: a signed decimal with 0-2 places. */
const AMOUNT_PATTERN = /^-?\d+(?:\.\d{1,2})?$/;

function amountText(value: unknown): string | null {
  return typeof value === 'string' && AMOUNT_PATTERN.test(value) ? value : null;
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Administrative gate for the central INTELLIGENCE channel: the first stage of the
 * administrative assistant.
 *
 * Authorization order — the organization is never an input, only a result:
 *  1. the sender is reduced to the digits the identity table stores; a JID that
 *     yields no digits is `unlinked`;
 *  2. `WhatsAppIdentityService.verify` supplies the identity, which already
 *     requires status VERIFIED and a non-null organization. PENDING, REVOKED,
 *     organization-less and unknown phones all stop here as `unlinked`;
 *  3. the role comes from `OrganizationUser` for that identity's `userId` in
 *     that identity's `organizationId` — one row, no fallback, no "any
 *     organization this user belongs to";
 *  4. OWNER and ADMIN are `authorized`; anything else, including a membership
 *     that does not exist, is `forbidden`.
 *
 * Two invariants hold for every method here:
 *  - **The allowlist is closed, and only one entry writes.** The summary tool is
 *    a pure read: this class queries `whatsAppIdentity.findFirst` and
 *    `organizationUser.findFirst` and nothing else. The report-PDF command is the
 *    single exception, and the only write it can reach is a `WhatsAppDelivery`
 *    row created by `WhatsAppDeliveryService` — a row whose recipient is the
 *    sender's own verified phone, never an address taken from the message. No
 *    other command sends anything, and no command can edit a sale, a product, an
 *    expense or a membership.
 *  - **Nothing identifiable is logged.** No method logs the phone, the message
 *    body, the identity, a customer, a document number or a figure. The only
 *    log lines are identifier-free outcome markers.
 *
 * Refusal reasons are indistinguishable by design. `unlinked` (this phone was
 * never linked), `forbidden` (linked, but the person behind it is not an
 * administrator) and `unavailable` (authorized, but the report could not be
 * built) must all reach the sender as one and the same message. Distinguishing
 * them in a reply would confirm to any stranger who guesses the number whether
 * a given phone is registered in MeperPOS, which is exactly the enumeration
 * oracle this gate exists to deny. The distinction lives in `reason` for
 * internal accounting and logs only, and any future transport must collapse it.
 * Every refusal is therefore decided before the allowlist is consulted, which is
 * also what keeps the PDF command unreachable for a stranger.
 */
@Injectable()
export class WhatsAppAdminService {
  private readonly logger = new Logger(WhatsAppAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: WhatsAppIdentityService,
    private readonly reports: DailyReportService,
    private readonly delivery: WhatsAppDeliveryService,
  ) {}

  /**
   * Resolve the sender of a message on the central channel. The phone is the
   * only input: an organization can never be supplied by the caller, so a
   * message that names a different organization cannot widen this answer.
   */
  async authorize(phone: string): Promise<WhatsAppAdminAuthorization> {
    const contactPhone = normaliseContactPhone(phone);
    if (!contactPhone) return { status: 'unlinked' };

    // Verified and organization-scoped; every other identity state is null.
    const identity = await this.identity.verify(contactPhone);
    if (!identity?.organizationId) {
      this.logger.warn({ event: 'whatsapp_admin', outcome: 'unlinked' });
      return { status: 'unlinked' };
    }

    // The role is read for this user in this organization only. A user who is
    // OWNER somewhere else is a stranger here.
    const membership = await this.prisma.organizationUser.findFirst({
      where: {
        userId: identity.userId,
        organizationId: identity.organizationId,
      },
      select: { role: true },
    });

    if (!membership || !ADMINISTRATIVE_ROLES.has(membership.role)) {
      this.logger.warn({ event: 'whatsapp_admin', outcome: 'forbidden' });
      return { status: 'forbidden' };
    }

    return {
      status: 'authorized',
      userId: identity.userId,
      organizationId: identity.organizationId,
      role: membership.role,
      phone: contactPhone,
    };
  }

  /**
   * Answer one message. `context` is what `authorize` returned, so this method
   * cannot be reached with an organization that did not come from a verified
   * identity, and the only address a delivery can use is `context.phone` — the
   * sender's own verified number. Everything outside the two closed allowlists is
   * `unsupported` without touching the reports or delivery services at all.
   */
  async answer(
    context: WhatsAppAdminAuthorization,
    text: unknown,
  ): Promise<WhatsAppAdminAnswer> {
    if (context.status !== 'authorized') {
      // authorize already recorded which refusal this is.
      return { status: 'refused', reason: context.status };
    }

    const command = normaliseCommand(text);
    if (!command) return { status: 'unsupported' };

    if (DAILY_PDF_COMMANDS.has(command)) {
      return this.sendDailyReportPdf(context);
    }

    if (!DAILY_SUMMARY_COMMANDS.has(command)) {
      return { status: 'unsupported' };
    }

    const summary = await this.dailySummary(context.organizationId);
    if (!summary) return { status: 'refused', reason: 'unavailable' };

    return {
      status: 'answered',
      tool: 'daily_summary',
      organizationId: context.organizationId,
      summary,
    };
  }

  /**
   * The one command that sends a document: the report PDF, on demand, back to the
   * administrator who asked. The outcome is reported as a flag so the transport
   * can say whether the document left; a delivery failure is not a gate failure
   * and never becomes an exception, because the webhook receipt for this message
   * is already spent.
   */
  private async sendDailyReportPdf(
    context: Extract<WhatsAppAdminAuthorization, { status: 'authorized' }>,
  ): Promise<WhatsAppAdminAnswer> {
    try {
      const outcome = await this.delivery.onDemand({
        organizationId: context.organizationId,
        phone: context.phone,
      });
      return {
        status: 'delivered',
        tool: 'daily_report_pdf',
        organizationId: context.organizationId,
        delivery:
          outcome.status === 'sent'
            ? 'sent'
            : outcome.status === 'failed'
              ? 'failed'
              : outcome.status,
      };
    } catch (error) {
      this.logger.warn({
        event: 'whatsapp_admin',
        outcome: 'delivery_failed',
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return { status: 'refused', reason: 'unavailable' };
    }
  }

  /**
   * The daily summary tool: the figures the web report already computes,
   * reduced here to aggregates. The report document itself is never returned or
   * forwarded — it carries customer names, document numbers, supplier and
   * product names and free-text descriptions, and none of that survives this
   * reduction. A report whose totals are not plain decimal strings is refused
   * instead of guessed at.
   */
  private async dailySummary(
    organizationId: string,
  ): Promise<WhatsAppDailySummary | null> {
    let report: DailyReport;
    try {
      report = await this.reports.generate(organizationId);
    } catch (error) {
      // A report failure is a refusal, not a webhook error: the provider must
      // not be invited to redeliver a message whose receipt is already spent.
      this.logger.warn({
        event: 'whatsapp_admin',
        outcome: 'report_failed',
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    }

    const salesTotal = amountText(report?.salesTotal);
    const expenseTotal = amountText(report?.expenseTotal);
    if (!salesTotal || !expenseTotal) return null;
    if (typeof report.date !== 'string' || report.date.length === 0)
      return null;

    return {
      reportDate: report.date,
      cutoff: new Date(report.cutoff).toISOString(),
      salesTotal,
      expenseTotal,
      salesCount: countOf(report.sales),
      lowStockCount: countOf(report.lowStock),
      pendingPurchaseOrderCount: countOf(report.purchaseOrders),
      loansDueCount: countOf(report.loans),
    };
  }
}
