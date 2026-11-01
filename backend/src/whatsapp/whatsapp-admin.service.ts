import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OrgRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DailyReportService,
  type DailyReport,
} from '../reports/daily-report.service';
import { WhatsAppDeliveryService } from './whatsapp-delivery.service';
import { normaliseContactPhone } from './whatsapp-ingestion.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';
import {
  WHATSAPP_MODEL_PROVIDER,
  buildModelRequest,
  parseModelIntent,
  type WhatsAppModelIntent,
  type WhatsAppModelProvider,
  type WhatsAppModelResult,
} from './whatsapp-intelligence-model';
import {
  WhatsAppSupervisionService,
  type WhatsAppSupervisionSummary,
} from './whatsapp-supervision.service';

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
 * Phrasing that asks how the commercial channel is doing. The answer is the
 * aggregate supervision read model and nothing else: counts per state and per
 * contact kind, how many threads are waiting for an answer, and the median
 * first-response time. No phone, no body, no customer, no document number.
 *
 * Closed like the other lists, and exact after normalisation, so "atencion"
 * reaches the tool while "atencion del cliente 573001112233" does not.
 */
const SUPERVISION_COMMANDS: ReadonlySet<string> = new Set([
  'atencion',
  'conversaciones',
  'como va la atencion',
  'como va la atencion hoy',
  'estado de las conversaciones',
  'supervision',
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
      /**
       * Whether this organization may receive the on-demand document. A suspended
       * organization keeps read access in the web app and loses its writes, and
       * the document is the only write this channel can cause.
       */
      deliveryAllowed: boolean;
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
  | {
      status: 'answered';
      tool: 'supervision_summary';
      organizationId: string;
      /** Counts and one duration: the shape is defined by the read model. */
      supervision: WhatsAppSupervisionSummary;
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

const REPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A non-negative whole count, or null when the value cannot be trusted. */
function countText(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * Colombian peso formatting for a decimal string: `1234.56` becomes
 * `$1.234,56`. Deliberately pure and locale-independent so the same figure
 * always renders the same text on every host and in every test run.
 */
function copText(value: string): string {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = fraction.padEnd(2, '0').slice(0, 2);
  return `${negative ? '-' : ''}$${grouped},${cents}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Median duration in a chat-legible unit; `null` means there is no sample. */
function durationText(medianMs: number | null): string {
  if (medianMs === null) return 'sin datos';
  if (medianMs < 1000) return `${medianMs} ms`;
  const seconds = medianMs / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1).replace('.', ',')} s`;
}

const UNSUPPORTED_REPLY =
  'No entiendo ese comando. Escribe «resumen» para las cifras del día, «atencion» para las conversaciones o «pdf» para el reporte.';
const UNAVAILABLE_REPLY =
  'No pude obtener la información en este momento. Intenta de nuevo en unos minutos.';

function dailySummaryReply(summary: WhatsAppDailySummary): string | null {
  if (!summary || !REPORT_DATE_PATTERN.test(summary.reportDate ?? ''))
    return null;
  const salesTotal = amountText(summary.salesTotal);
  const expenseTotal = amountText(summary.expenseTotal);
  const salesCount = countText(summary.salesCount);
  const lowStockCount = countText(summary.lowStockCount);
  const pendingPurchaseOrderCount = countText(
    summary.pendingPurchaseOrderCount,
  );
  const loansDueCount = countText(summary.loansDueCount);
  if (
    !salesTotal ||
    !expenseTotal ||
    salesCount === null ||
    lowStockCount === null ||
    pendingPurchaseOrderCount === null ||
    loansDueCount === null
  )
    return null;

  return [
    `Resumen del día ${summary.reportDate}`,
    `Ventas: ${copText(salesTotal)} (${plural(salesCount, 'venta', 'ventas')})`,
    `Gastos: ${copText(expenseTotal)}`,
    `Stock bajo: ${plural(lowStockCount, 'producto', 'productos')}`,
    `Compras pendientes: ${plural(pendingPurchaseOrderCount, 'orden', 'órdenes')}`,
    `Préstamos por vencer: ${loansDueCount}`,
  ].join('\n');
}

function supervisionReply(
  supervision: WhatsAppSupervisionSummary,
): string | null {
  if (!supervision) return null;
  const total = countText(supervision.totalConversations);
  const automated = countText(supervision.byState?.AUTOMATED);
  const human = countText(supervision.byState?.HUMAN);
  const suspended = countText(supervision.byState?.SUSPENDED);
  const clients = countText(supervision.byContactKind?.CLIENT);
  const internal = countText(supervision.byContactKind?.INTERNAL);
  const unknown = countText(supervision.byContactKind?.UNKNOWN);
  const pending = countText(supervision.pendingAnswerCount);
  const median = supervision.firstResponse?.medianMs ?? null;
  if (
    total === null ||
    automated === null ||
    human === null ||
    suspended === null ||
    clients === null ||
    internal === null ||
    unknown === null ||
    pending === null ||
    (median !== null && (!Number.isFinite(median) || median < 0))
  )
    return null;

  return [
    'Atención de las conversaciones',
    `Total: ${total}`,
    `Automáticas: ${automated}`,
    `Humanas: ${human}`,
    `Suspendidas: ${suspended}`,
    `Clientes: ${clients}`,
    `Internos: ${internal}`,
    `Desconocidos: ${unknown}`,
    `Esperando respuesta: ${pending}`,
    `Primera respuesta (mediana): ${durationText(median)}`,
  ].join('\n');
}

/**
 * Render the deterministic chat reply for one gate answer, or `null` when the
 * answer must not produce a text message.
 *
 * The two silent outcomes are decisions, not omissions:
 *  - an `unlinked` or `forbidden` refusal is never answered, because any reply
 *    would confirm to a stranger that this number is in service and could be used
 *    to enumerate registered phones;
 *  - a `delivered` PDF answer is silent because the document flow already sends
 *    its own message, and adding a text would duplicate the side effect.
 *
 * Only aggregates and dates are rendered. Every figure comes from the reduced
 * shapes above, so no customer, document, supplier, product, phone or free-text
 * description can reach the message even if the report had one.
 */
export function renderAdminReply(answer: WhatsAppAdminAnswer): string | null {
  if (answer.status === 'answered') {
    return answer.tool === 'daily_summary'
      ? dailySummaryReply(answer.summary)
      : supervisionReply(answer.supervision);
  }
  if (answer.status === 'unsupported') return UNSUPPORTED_REPLY;
  if (answer.status === 'refused') {
    return answer.reason === 'unavailable' ? UNAVAILABLE_REPLY : null;
  }
  return null;
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
 *  - **The allowlists are closed, and only one entry writes.** Two tools read:
 *    the daily summary over `DailyReportService` and the supervision summary over
 *    `WhatsAppSupervisionService` (aggregate counts and one median). This class
 *    itself queries `whatsAppIdentity.findFirst` and `organizationUser.findFirst`
 *    and nothing else. The report-PDF command is the single exception, and the
 *    only write it can reach is a `WhatsAppDelivery` row created by
 *    `WhatsAppDeliveryService` — a row whose recipient is the sender's own
 *    verified phone, never an address taken from the message. No other command
 *    sends anything, and no command can edit a sale, a product, an expense or a
 *    membership.
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
    private readonly supervision: WhatsAppSupervisionService,
    @Inject(WHATSAPP_MODEL_PROVIDER)
    private readonly model: WhatsAppModelProvider,
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

    // Being linked and being an administrator of that organization is not enough:
    // the account and the business have to be live. The web app refuses a
    // deactivated user at login and blocks writes for a suspended organization, so
    // this channel honours the same state — otherwise a phone that was never
    // unlinked keeps reading the business' figures after the account was switched
    // off, which is exactly the access an operator believes they revoked.
    const actor = await this.prisma.user.findFirst({
      where: { id: identity.userId, active: true },
      select: { id: true },
    });
    if (!actor) {
      this.logger.warn({ event: 'whatsapp_admin', outcome: 'inactive_user' });
      return { status: 'forbidden' };
    }

    const organization = await this.prisma.organization.findFirst({
      where: { id: identity.organizationId, active: true },
      select: { status: true },
    });
    if (!organization) {
      this.logger.warn({
        event: 'whatsapp_admin',
        outcome: 'inactive_organization',
      });
      return { status: 'forbidden' };
    }

    return {
      status: 'authorized',
      userId: identity.userId,
      organizationId: identity.organizationId,
      role: membership.role,
      phone: contactPhone,
      // Read tools stay available for a suspended organization, mirroring the web
      // guard's GET/HEAD allowance; the document, which is this channel's only
      // write, does not.
      deliveryAllowed: organization.status !== 'SUSPENDED',
    };
  }

  /**
   * Answer one message. `context` is what `authorize` returned, so this method
   * cannot be reached with an organization that did not come from a verified
   * identity, and the only address a delivery can use is `context.phone` — the
   * sender's own verified number. Everything outside the three closed allowlists
   * is `unsupported` without touching the reports, supervision or delivery
   * services at all.
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

    if (SUPERVISION_COMMANDS.has(command)) {
      return this.supervisionAnswer(context);
    }

    if (!DAILY_SUMMARY_COMMANDS.has(command)) {
      return this.interpretWithModel(context, command);
    }

    return this.dailySummaryAnswer(context);
  }

  /**
   * The model seam, reached only for a text the deterministic allowlist did not
   * recognise. It can narrow nothing and widen nothing: the model picks one of
   * the closed read tools, this side validates the answer, and the tool then runs
   * with the organization from the verified identity — never from the model.
   *
   * While no provider is chosen the shipped binding answers `unavailable`, and
   * this method returns exactly the `unsupported` answer the gate gave before the
   * seam existed: an unrecognised command is still answered with the same
   * sentence and still reads nothing. `unavailable` deliberately does not become
   * a refusal message here, because no administrator should be told that an
   * integration she never configured failed.
   *
   * A provider that throws is a warning with a fixed outcome and an
   * `unsupported` answer: the webhook receipt for this message is already spent,
   * so nothing may propagate and nothing is retried.
   */
  private async interpretWithModel(
    context: Extract<WhatsAppAdminAuthorization, { status: 'authorized' }>,
    command: string,
  ): Promise<WhatsAppAdminAnswer> {
    const request = buildModelRequest(command);
    if (!request) return { status: 'unsupported' };

    let result: WhatsAppModelResult;
    try {
      result = await this.model.interpret(request);
    } catch {
      this.logger.warn({
        event: 'whatsapp_admin',
        outcome: 'model_failed',
        // A fixed marker, never `error.name`: this error comes from an untrusted
        // provider, and a name it controls could carry the administrator's text or
        // an arbitrary length into a log line.
        reason: 'provider_error',
      });
      return { status: 'unsupported' };
    }

    if (result.status !== 'intent') return { status: 'unsupported' };

    // The answer is validated again here, on this side of the boundary: a
    // provider is untrusted output and its intent is never taken on trust.
    const intent: WhatsAppModelIntent | null = parseModelIntent(result.intent);
    if (!intent) return { status: 'unsupported' };

    return intent.tool === 'daily_summary'
      ? this.dailySummaryAnswer(context)
      : this.supervisionAnswer(context);
  }

  /** The daily summary tool, shared by the allowlist and the model seam. */
  private async dailySummaryAnswer(
    context: Extract<WhatsAppAdminAuthorization, { status: 'authorized' }>,
  ): Promise<WhatsAppAdminAnswer> {
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
   * The supervision tool: the aggregate read model of this organization's
   * commercial threads. The organization comes from the verified identity, never
   * from the message, so a text that names another organization cannot widen the
   * answer. Nothing identifiable can travel because the read model has no field
   * for a phone, a body or a customer: the reduction happens before this method
   * sees the data, not here.
   */
  private async supervisionAnswer(
    context: Extract<WhatsAppAdminAuthorization, { status: 'authorized' }>,
  ): Promise<WhatsAppAdminAnswer> {
    try {
      const supervision = await this.supervision.summary(
        context.organizationId,
      );
      return {
        status: 'answered',
        tool: 'supervision_summary',
        organizationId: context.organizationId,
        supervision,
      };
    } catch (error) {
      this.logger.warn({
        event: 'whatsapp_admin',
        outcome: 'supervision_failed',
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return { status: 'refused', reason: 'unavailable' };
    }
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
    if (!context.deliveryAllowed) {
      // Silent, like every other refusal: the sender already knows who she is, but
      // a reply would still confirm to a stranger that this number is in service.
      this.logger.warn({
        event: 'whatsapp_admin',
        outcome: 'delivery_blocked',
      });
      return { status: 'refused', reason: 'forbidden' };
    }

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
