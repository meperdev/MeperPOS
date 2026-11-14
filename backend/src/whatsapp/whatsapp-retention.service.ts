import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rows one connection may lose per purge run, per phase.
 *
 * The first run after this feature ships has to delete everything the channel
 * ever stored, and an unbounded `DELETE` over months of history holds row locks
 * for as long as it takes. A fixed batch keeps each statement short: the next
 * daily run continues where this one stopped, and a thread that is still being
 * written to is never locked behind a table-wide sweep.
 */
export const RETENTION_MESSAGE_BATCH = 500;
export const RETENTION_CONVERSATION_BATCH = 200;

/** What one connection's purge did. */
export interface WhatsAppRetentionPurgeResult {
  connectionId: string;
  /** The policy that was applied, after the legacy-value floor. */
  retentionDays: number;
  messagesDeleted: number;
  conversationsDeleted: number;
  /**
   * True when the message batch was exhausted, i.e. this connection still has
   * expired messages waiting for the next run.
   */
  boundReached: boolean;
}

/** What a whole run did, across every connection. */
export interface WhatsAppRetentionRunResult {
  connectionsProcessed: number;
  /** Connections whose purge threw; the run continued past them. */
  connectionsFailed: number;
  messagesDeleted: number;
  conversationsDeleted: number;
  boundReached: boolean;
}

/**
 * Deletes expired conversation content according to each channel's policy.
 *
 * Semantics, in order — and the order is the contract:
 *
 *  1. **Cutoff.** `now - retentionDays` for the connection being purged. The
 *     policy lives on `WhatsAppConnection.retentionDays` (non-null, default 30),
 *     so the retention window is data, not deployment configuration. A value
 *     below one day (only reachable in a row written before the CHECK constraint
 *     existed) is treated as one day rather than as "delete everything".
 *  2. **Messages.** Everything strictly older than the cutoff goes, bounded by
 *     `RETENTION_MESSAGE_BATCH`. A message at exactly the cutoff survives: the
 *     policy is "keep N days", not "keep N days minus one millisecond".
 *  3. **Conversations.** A thread is removed only when it has no messages left
 *     *after* step 2 **and** its `lastMessageAt` (or `createdAt` when it never
 *     received a message) is older than the cutoff. That is what makes the phone
 *     die with the content: once the last message expires, the thread row — the
 *     only place `contactPhone` lives — expires with it.
 *  4. **Nothing else is touched.** No conversation that still holds a recent
 *     message is removed, so a thread that is alive keeps its phone, its state
 *     and its timing facts; only its expired messages are gone.
 *
 * The run is idempotent: a second run inside the same window finds no message and
 * no conversation to delete and issues no `DELETE` at all.
 *
 * Logging carries counts and fixed codes only — no phone, no body, no
 * conversation id, no connection id.
 */
@Injectable()
export class WhatsAppRetentionService {
  private readonly logger = new Logger(WhatsAppRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Purge every connection. Never throws: one failure does not stop the rest. */
  async purgeAll(now: Date = new Date()): Promise<WhatsAppRetentionRunResult> {
    const connections = await this.prisma.whatsAppConnection.findMany({
      select: { id: true },
    });

    const totals: WhatsAppRetentionRunResult = {
      connectionsProcessed: 0,
      connectionsFailed: 0,
      messagesDeleted: 0,
      conversationsDeleted: 0,
      boundReached: false,
    };

    for (const connection of connections) {
      try {
        const outcome = await this.purgeConnection(connection.id, now);
        if (!outcome) {
          totals.connectionsFailed += 1;
          continue;
        }

        totals.connectionsProcessed += 1;
        totals.messagesDeleted += outcome.messagesDeleted;
        totals.conversationsDeleted += outcome.conversationsDeleted;
        totals.boundReached = totals.boundReached || outcome.boundReached;

        this.logger.log({
          event: 'whatsapp_retention',
          outcome: 'connection_purged',
          retentionDays: outcome.retentionDays,
          messagesDeleted: outcome.messagesDeleted,
          conversationsDeleted: outcome.conversationsDeleted,
          boundReached: outcome.boundReached,
        });
      } catch (error) {
        totals.connectionsFailed += 1;
        // A fixed code and the error's class name: an exception message can
        // carry a query, a parameter or a DSN.
        this.logger.error({
          event: 'whatsapp_retention',
          outcome: 'purge_failed',
          reason: error instanceof Error ? error.name : 'unknown',
        });
      }
    }

    this.logger.log({
      event: 'whatsapp_retention',
      outcome: 'run_completed',
      connectionsProcessed: totals.connectionsProcessed,
      connectionsFailed: totals.connectionsFailed,
      messagesDeleted: totals.messagesDeleted,
      conversationsDeleted: totals.conversationsDeleted,
      boundReached: totals.boundReached,
    });

    return totals;
  }

  /**
   * Purge one connection. Returns `null` when the connection no longer exists,
   * which is a race with a deletion, not an error worth failing a run over.
   * `now` is a parameter so a spec can place the purge at a fixed instant.
   */
  async purgeConnection(
    connectionId: string,
    now: Date = new Date(),
  ): Promise<WhatsAppRetentionPurgeResult | null> {
    const connection = await this.prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
      select: { id: true, retentionDays: true },
    });
    if (!connection) {
      this.logger.warn({
        event: 'whatsapp_retention',
        outcome: 'connection_missing',
      });
      return null;
    }

    const retentionDays = Math.max(
      1,
      Math.trunc(
        Number.isFinite(connection.retentionDays)
          ? connection.retentionDays
          : 1,
      ),
    );
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

    const messagesDeleted = await this.deleteExpiredMessages(
      connection.id,
      cutoff,
    );

    // Only now, with the messages of this run already gone, is "has no messages"
    // a statement about what is left rather than about what was never written.
    const conversationsDeleted = await this.deleteEmptyConversations(
      connection.id,
      cutoff,
    );

    return {
      connectionId: connection.id,
      retentionDays,
      messagesDeleted: messagesDeleted.count,
      conversationsDeleted: conversationsDeleted.count,
      boundReached: messagesDeleted.boundReached,
    };
  }

  /**
   * Select then delete, oldest first, up to one batch. `deleteMany` has no
   * `take`, so the bound has to be decided before the delete runs; selecting the
   * ids is also what keeps the statement's `WHERE` to a known list instead of a
   * predicate that re-scans the table under lock.
   */
  private async deleteExpiredMessages(
    connectionId: string,
    cutoff: Date,
  ): Promise<{ count: number; boundReached: boolean }> {
    const expired = await this.prisma.whatsAppMessage.findMany({
      where: {
        sentAt: { lt: cutoff },
        conversation: { connectionId },
      },
      select: { id: true },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
      take: RETENTION_MESSAGE_BATCH,
    });

    if (expired.length === 0) return { count: 0, boundReached: false };

    const { count } = await this.prisma.whatsAppMessage.deleteMany({
      where: { id: { in: expired.map((row) => row.id) } },
    });

    return { count, boundReached: expired.length === RETENTION_MESSAGE_BATCH };
  }

  /**
   * Threads that are now empty and whose own timestamp is past the cutoff.
   *
   * `messages: { none: {} }` is evaluated after the message delete above, and the
   * `lastMessageAt`/`createdAt` branch keeps a thread created yesterday but never
   * used from being swept away before its policy window has passed.
   */
  private async deleteEmptyConversations(
    connectionId: string,
    cutoff: Date,
  ): Promise<{ count: number }> {
    const empty = await this.prisma.whatsAppConversation.findMany({
      where: {
        connectionId,
        messages: { none: {} },
        OR: [
          { lastMessageAt: { lt: cutoff } },
          { lastMessageAt: null, createdAt: { lt: cutoff } },
        ],
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: RETENTION_CONVERSATION_BATCH,
    });

    if (empty.length === 0) return { count: 0 };

    return this.prisma.whatsAppConversation.deleteMany({
      where: { id: { in: empty.map((row) => row.id) } },
    });
  }
}
