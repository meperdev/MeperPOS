import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ProductStockAlertEventKind as EventKind,
  ProductStockAlertNotificationStatus as NotificationStatus,
  ProductStockAlertState as AlertState,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppConnectionsService } from '../whatsapp/whatsapp-connections.service';
import { chatIdFor } from '../whatsapp/whatsapp-delivery.service';
import {
  WHATSAPP_TEXT_SENDER,
  type WhatsAppTextSender,
} from '../whatsapp/whatsapp-provider';
import {
  decideEpisode,
  renderStockAlertMessage,
  type StockAlertFailure,
} from './stock-alerts.logic';
import { lowStockProductWhere, lowStockSweepWhere } from './low-stock.where';

/** What one scan changed. Used by the scheduler log and by the specs. */
export interface StockAlertScanSummary {
  opened: number;
  resolved: number;
  /** Episodes whose WhatsApp message was accepted by the provider. */
  notified: number;
  /** Episodes recorded with a fixed failure code. */
  failed: number;
}

const EMPTY_SUMMARY: StockAlertScanSummary = {
  opened: 0,
  resolved: 0,
  notified: 0,
  failed: 0,
};

/**
 * Owns the low-stock episodes and their out-of-app notification.
 *
 * The scan is the only writer. It reconciles the open episodes against the
 * catalog under the same rule every other stock surface uses, then notifies the
 * episodes that were never attempted. Three bounded guarantees hold:
 *
 *  - **One row per product.** `productId` is unique, so two scans cannot open two
 *    episodes for the same product.
 *  - **One attempt per episode.** A row is claimed (`PENDING -> SENDING`) before
 *    the provider is called; a second scan finds nothing to claim.
 *  - **No thrown provider failure.** A missing recipient or a provider error is
 *    recorded on the row with a fixed code; the scan never lets one tenant stop
 *    the others.
 */
@Injectable()
export class StockAlertsService {
  private readonly logger = new Logger(StockAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: WhatsAppConnectionsService,
    @Inject(WHATSAPP_TEXT_SENDER) private readonly sender: WhatsAppTextSender,
  ) {}

  /**
   * Reconciles every organization that either has an open episode or a product
   * at or below its minimum. One organization failing is logged and skipped: the
   * cron must never die on a single tenant.
   */
  async scanAll(now: Date = new Date()): Promise<StockAlertScanSummary> {
    let organizations: string[];
    try {
      organizations = await this.organizationsToScan();
    } catch (error) {
      this.logScan('scan_failed', error);
      return { ...EMPTY_SUMMARY };
    }

    const total: StockAlertScanSummary = { ...EMPTY_SUMMARY };
    for (const organizationId of organizations) {
      try {
        const summary = await this.scanOrganization(organizationId, now);
        total.opened += summary.opened;
        total.resolved += summary.resolved;
        total.notified += summary.notified;
        total.failed += summary.failed;
      } catch (error) {
        this.logScan('organization_failed', error, organizationId);
      }
    }
    return total;
  }

  /** Reconcile and notify one organization. Safe to call repeatedly. */
  async scanOrganization(
    organizationId: string,
    now: Date = new Date(),
  ): Promise<StockAlertScanSummary> {
    const summary: StockAlertScanSummary = { ...EMPTY_SUMMARY };

    const [lowProducts, existing] = await Promise.all([
      this.prisma.product.findMany({
        where: lowStockProductWhere(
          organizationId,
          this.prisma.product.fields.minStock,
        ),
        select: { id: true, stock: true, minStock: true },
      }),
      this.prisma.productStockAlert.findMany({
        where: { organizationId },
        select: { id: true, productId: true, state: true, episode: true },
      }),
    ]);

    const lowIds = new Set(lowProducts.map((product) => product.id));
    const byProduct = new Map(existing.map((row) => [row.productId, row]));

    for (const row of existing) {
      if (row.state !== AlertState.OPEN || lowIds.has(row.productId)) continue;
      const resolved = await this.prisma.productStockAlert.updateMany({
        where: { id: row.id, state: AlertState.OPEN },
        data: { state: AlertState.RESOLVED, resolvedAt: now },
      });
      if (resolved.count > 0) {
        await this.recordEvents([
          {
            organizationId,
            productId: row.productId,
            episode: row.episode,
            kind: EventKind.RESOLVED,
          },
        ]);
      }
      summary.resolved += resolved.count;
    }

    for (const product of lowProducts) {
      const current = byProduct.get(product.id) ?? null;
      const decision = decideEpisode(
        current ? { state: current.state, episode: current.episode } : null,
        true,
      );
      if (decision.action === 'open') {
        const created = await this.openEpisode(
          organizationId,
          product,
          now,
          decision.episode,
        );
        if (created) summary.opened += 1;
      } else if (decision.action === 'reopen' && current) {
        const reopened = await this.prisma.productStockAlert.updateMany({
          where: { id: current.id, state: AlertState.RESOLVED },
          data: {
            state: AlertState.OPEN,
            episode: { increment: 1 },
            openedAt: now,
            resolvedAt: null,
            stockAtOpen: product.stock,
            minStockAtOpen: product.minStock,
            notificationStatus: NotificationStatus.PENDING,
            notificationFailure: null,
            notificationAttempts: 0,
            notifiedAt: null,
          },
        });
        if (reopened.count > 0) {
          await this.recordEvents([
            {
              organizationId,
              productId: product.id,
              episode: current.episode + 1,
              kind: EventKind.OPENED,
            },
          ]);
          summary.opened += 1;
        }
      }
    }

    const notification = await this.notifyPending(organizationId);
    summary.notified = notification.notified;
    summary.failed = notification.failed;
    return summary;
  }

  /** Every organization with an open episode or a product at its minimum. */
  private async organizationsToScan(): Promise<string[]> {
    const [low, open] = await Promise.all([
      this.prisma.product.findMany({
        where: lowStockSweepWhere(this.prisma.product.fields.minStock),
        select: { organizationId: true },
        distinct: ['organizationId'],
      }),
      this.prisma.productStockAlert.findMany({
        where: { state: AlertState.OPEN },
        select: { organizationId: true },
        distinct: ['organizationId'],
      }),
    ]);
    return [
      ...new Set([
        ...low.map((row) => row.organizationId),
        ...open.map((row) => row.organizationId),
      ]),
    ];
  }

  /**
   * Creates the first episode of a product. A concurrent scan that won the
   * unique key is not an error: its row is the episode.
   */
  private async openEpisode(
    organizationId: string,
    product: { id: string; stock: number; minStock: number },
    now: Date,
    episode: number,
  ): Promise<boolean> {
    try {
      await this.prisma.productStockAlert.create({
        data: {
          organizationId,
          productId: product.id,
          episode,
          state: AlertState.OPEN,
          stockAtOpen: product.stock,
          minStockAtOpen: product.minStock,
          openedAt: now,
        },
      });
      await this.recordEvents([
        {
          organizationId,
          productId: product.id,
          episode,
          kind: EventKind.OPENED,
        },
      ]);
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /**
   * Sends one message for the episodes that were never attempted, then records
   * the outcome on each claimed row. The claim is per row, so two concurrent
   * scans cannot both send for the same episode.
   */
  private async notifyPending(
    organizationId: string,
  ): Promise<{ notified: number; failed: number }> {
    const pending = await this.prisma.productStockAlert.findMany({
      where: {
        organizationId,
        state: AlertState.OPEN,
        notificationStatus: NotificationStatus.PENDING,
      },
      select: { id: true, productId: true, episode: true },
    });
    if (pending.length === 0) return { notified: 0, failed: 0 };

    const claimed: Array<{ id: string; productId: string; episode: number }> =
      [];
    for (const row of pending) {
      const claim = await this.prisma.productStockAlert.updateMany({
        where: {
          id: row.id,
          notificationStatus: NotificationStatus.PENDING,
        },
        data: {
          notificationStatus: NotificationStatus.SENDING,
          notificationAttempts: { increment: 1 },
        },
      });
      if (claim.count === 1) claimed.push(row);
    }
    if (claimed.length === 0) return { notified: 0, failed: 0 };

    const ids = claimed.map((row) => row.id);
    const history = (
      kind: EventKind,
      failureReason: StockAlertFailure | null = null,
    ) =>
      claimed.map((row) => ({
        organizationId,
        productId: row.productId,
        episode: row.episode,
        kind,
        failureReason,
      }));

    const products = await this.prisma.product.findMany({
      where: { id: { in: claimed.map((row) => row.productId) } },
      select: { id: true, name: true, sku: true, stock: true, minStock: true },
    });
    const byId = new Map(products.map((product) => [product.id, product]));

    const recipient = await this.administrativeRecipient(organizationId);
    const chatId = recipient ? chatIdFor(recipient) : null;
    if (!chatId) {
      await this.finish(ids, NotificationStatus.SKIPPED, 'no_recipient');
      await this.recordEvents(history(EventKind.SKIPPED, 'no_recipient'));
      this.logger.warn({
        event: 'stock_alert',
        outcome: 'skipped',
        reason: 'no_recipient',
      });
      return { notified: 0, failed: claimed.length };
    }

    const text = renderStockAlertMessage(
      claimed.map((row) => {
        const product = byId.get(row.productId);
        return {
          name: product?.name ?? 'Producto',
          sku: product?.sku ?? '',
          stock: product?.stock ?? 0,
          minStock: product?.minStock ?? 0,
        };
      }),
      claimed.length,
    );

    try {
      const connection = await this.connections.getOrCreateIntelligence();
      await this.sender.sendText(connection.sessionName, { chatId, text });
    } catch (error) {
      const reason: StockAlertFailure =
        error instanceof ServiceUnavailableException
          ? 'provider_rejected'
          : 'send_failed';
      await this.finish(ids, NotificationStatus.FAILED, reason);
      await this.recordEvents(history(EventKind.FAILED, reason));
      this.logger.warn({ event: 'stock_alert', outcome: 'failed', reason });
      return { notified: 0, failed: claimed.length };
    }

    // The provider accepted the message. Bookkeeping is auxiliary and runs
    // outside the send's verdict: a failing status or history write must neither
    // turn a delivered alert into a recorded failure nor abort the rest of the
    // organization's episodes. A failure here leaves the rows as they were and
    // only shortens the history.
    try {
      await this.finish(ids, NotificationStatus.SENT, null, new Date());
      await this.recordEvents(history(EventKind.NOTIFIED));
    } catch (error) {
      this.logger.warn({
        event: 'stock_alert',
        outcome: 'bookkeeping_failed',
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
    this.logger.log({
      event: 'stock_alert',
      outcome: 'sent',
      episodes: claimed.length,
    });
    return { notified: claimed.length, failed: 0 };
  }

  /**
   * Appends immutable history rows. Nothing here updates an existing event, which
   * is what keeps an earlier episode's record alive after a re-crossing.
   */
  private async recordEvents(
    events: Array<{
      organizationId: string;
      productId: string;
      episode: number;
      kind: EventKind;
      failureReason?: StockAlertFailure | null;
    }>,
  ): Promise<void> {
    if (events.length === 0) return;
    await this.prisma.productStockAlertEvent.createMany({
      data: events.map((event) => ({
        organizationId: event.organizationId,
        productId: event.productId,
        episode: event.episode,
        kind: event.kind,
        failureReason: event.failureReason ?? null,
      })),
    });
  }

  private finish(
    ids: string[],
    status: NotificationStatus,
    failure: StockAlertFailure | null,
    notifiedAt: Date | null = null,
  ) {
    return this.prisma.productStockAlert.updateMany({
      where: {
        id: { in: ids },
        notificationStatus: NotificationStatus.SENDING,
      },
      data: {
        notificationStatus: status,
        notificationFailure: failure,
        ...(notifiedAt ? { notifiedAt } : {}),
      },
    });
  }

  /**
   * The oldest verified identity whose user holds OWNER or ADMIN in this exact
   * organization — the same policy the daily report uses, so one organization's
   * stock never travels to another organization's administrator.
   */
  private async administrativeRecipient(
    organizationId: string,
  ): Promise<string | null> {
    const identities = await this.prisma.whatsAppIdentity.findMany({
      where: { organizationId, status: 'VERIFIED' },
      orderBy: [{ verifiedAt: 'asc' }, { id: 'asc' }],
      select: { phone: true, userId: true },
    });
    if (identities.length === 0) return null;

    const administrators = await this.prisma.organizationUser.findMany({
      where: {
        organizationId,
        userId: { in: [...new Set(identities.map((row) => row.userId))] },
        role: { in: ['OWNER', 'ADMIN'] },
      },
      select: { userId: true },
    });
    const allowed = new Set(administrators.map((row) => row.userId));
    return identities.find((row) => allowed.has(row.userId))?.phone ?? null;
  }


  private logScan(
    outcome: string,
    error: unknown,
    organizationId?: string,
  ): void {
    this.logger.error({
      event: 'stock_alert',
      outcome,
      ...(organizationId ? { organizationId } : {}),
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'P2002';
