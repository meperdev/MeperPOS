import { Injectable } from '@nestjs/common';
import type {
  WhatsAppContactKind,
  WhatsAppConversationState,
  WhatsAppMessageDirection,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Page size for the thread list when the caller does not ask for one. */
export const SUPERVISION_DEFAULT_LIMIT = 50;
/** Hard ceiling for the thread list: one answer has to fit in a chat bubble. */
export const SUPERVISION_MAX_LIMIT = 100;
/** Page size for a single thread's messages. */
export const HISTORY_DEFAULT_LIMIT = 30;
/** Hard ceiling for a single thread's messages. */
export const HISTORY_MAX_LIMIT = 100;

/**
 * Reduce an untrusted page size to something a single query can answer.
 *
 * Anything that is not a finite number, anything below one, and a `0` all mean
 * "use the default" rather than "return nothing": a caller that omits a limit and
 * a caller that sends garbage are the same caller. A finite value is floored and
 * then capped, so `1000` becomes the ceiling instead of an unbounded scan.
 */
export function boundedLimit(
  value: unknown,
  fallback: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const truncated = Math.floor(value);
  if (truncated < 1) return fallback;
  return Math.min(truncated, max);
}

/**
 * Aggregate view of one organization's commercial threads. Every field is a
 * count or a duration: no phone, no body, no customer, no document number.
 */
export interface WhatsAppSupervisionSummary {
  totalConversations: number;
  byState: Record<WhatsAppConversationState, number>;
  byContactKind: Record<WhatsAppContactKind, number>;
  /**
   * Threads whose last stored message is INBOUND, i.e. the customer wrote last
   * and nobody has answered in our record yet.
   */
  pendingAnswerCount: number;
  /**
   * First-response measure over the threads that have both facts. `medianMs` is
   * null when there is no sample, never `0`, because "no data" and "answered
   * instantly" are different answers.
   */
  firstResponse: { sampleCount: number; medianMs: number | null };
}

/** One supervised thread. The phone is the only identifier allowed here. */
export interface WhatsAppSupervisionConversation {
  conversationId: string;
  contactPhone: string;
  contactKind: WhatsAppContactKind;
  state: WhatsAppConversationState;
  customerId: string | null;
  lastMessageAt: Date | null;
  firstInboundAt: Date | null;
  firstResponseAt: Date | null;
}

/** The only shape that carries message text, and only for one owned thread. */
export interface WhatsAppSupervisionHistory {
  conversationId: string;
  messages: Array<{
    direction: WhatsAppMessageDirection;
    source: string;
    sentAt: Date;
    body: string | null;
  }>;
}

/** Middle value of a sorted numeric sample; null for an empty sample. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  // An even sample has no single middle value, so the median is the mean of the
  // two central ones. Rounded to whole milliseconds: this is a report figure.
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Read model for the commercial channel: what the administrative assistant may
 * say about the organization's conversations.
 *
 * Three invariants, and they are the whole point of this class:
 *
 *  - **Every query is organization-scoped.** `organizationId` is the first
 *    argument of every method and the first key of every `where`. There is no
 *    path that reads a conversation, a message or a count without it, and
 *    `history` additionally requires the conversation to belong to that
 *    organization before it reads a single message — a foreign conversation is
 *    answered as `null`, exactly like a conversation that does not exist, so the
 *    caller cannot tell the two apart.
 *  - **No bodies outside `history()`.** `summary` and `conversations` map their
 *    rows field by field into their own interfaces, so a column that the select
 *    happens to bring back still cannot travel. Message text is reachable only
 *    through the bounded, organization-checked history of one thread.
 *  - **Nothing is written.** This class only reads; the purge job is the only
 *    component that deletes anything, and it does not live here.
 *
 * The summary is computed from two `groupBy` counts plus one pass over the
 * threads that carry timing facts, because the median is not expressible in
 * Prisma's aggregate API and a raw percentile query would put SQL in the read
 * path. The pass reads two columns and one message direction per thread — the
 * cost is bounded by the organization's thread count, which is what the figure
 * is about.
 */
@Injectable()
export class WhatsAppSupervisionService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(organizationId: string): Promise<WhatsAppSupervisionSummary> {
    const [stateCounts, kindCounts, threads] = await Promise.all([
      this.prisma.whatsAppConversation.groupBy({
        by: ['state'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.prisma.whatsAppConversation.groupBy({
        by: ['contactKind'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.prisma.whatsAppConversation.findMany({
        where: { organizationId },
        select: {
          firstInboundAt: true,
          firstResponseAt: true,
          messages: {
            orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { direction: true },
          },
        },
      }),
    ]);

    const byState: Record<WhatsAppConversationState, number> = {
      AUTOMATED: 0,
      HUMAN: 0,
      SUSPENDED: 0,
    };
    for (const row of stateCounts) byState[row.state] = row._count._all;

    const byContactKind: Record<WhatsAppContactKind, number> = {
      CLIENT: 0,
      INTERNAL: 0,
      UNKNOWN: 0,
    };
    for (const row of kindCounts)
      byContactKind[row.contactKind] = row._count._all;

    let pendingAnswerCount = 0;
    const samples: number[] = [];
    for (const thread of threads) {
      // "Pending" is decided by the last message of the thread, never by the
      // presence of an unanswered inbound somewhere in its history: a thread
      // that was answered and then received one more message is pending, and one
      // that was answered last is not.
      if (thread.messages[0]?.direction === 'INBOUND') pendingAnswerCount += 1;

      if (thread.firstInboundAt && thread.firstResponseAt) {
        const elapsed =
          thread.firstResponseAt.getTime() - thread.firstInboundAt.getTime();
        // Only a non-negative interval is a sample. A negative one would mean the
        // reply was recorded before the message it answers, which is bad data,
        // not an instant response.
        if (elapsed >= 0) samples.push(elapsed);
      }
    }

    return {
      totalConversations: byState.AUTOMATED + byState.HUMAN + byState.SUSPENDED,
      byState,
      byContactKind,
      pendingAnswerCount,
      firstResponse: {
        sampleCount: samples.length,
        medianMs: medianOf(samples),
      },
    };
  }

  /**
   * The organization's threads, newest activity first. Threads that never
   * received a message sort last: an empty thread is not "recent" just because
   * its row was created late.
   */
  async conversations(
    organizationId: string,
    options: { limit?: number } = {},
  ): Promise<WhatsAppSupervisionConversation[]> {
    const take = boundedLimit(
      options?.limit,
      SUPERVISION_DEFAULT_LIMIT,
      SUPERVISION_MAX_LIMIT,
    );

    const rows = await this.prisma.whatsAppConversation.findMany({
      where: { organizationId },
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ],
      take,
      select: {
        id: true,
        contactPhone: true,
        contactKind: true,
        state: true,
        customerId: true,
        lastMessageAt: true,
        firstInboundAt: true,
        firstResponseAt: true,
      },
    });

    return rows.map((row) => ({
      conversationId: row.id,
      contactPhone: row.contactPhone,
      contactKind: row.contactKind,
      state: row.state,
      customerId: row.customerId,
      lastMessageAt: row.lastMessageAt,
      firstInboundAt: row.firstInboundAt,
      firstResponseAt: row.firstResponseAt,
    }));
  }

  /**
   * The last `limit` messages of one thread, oldest to newest inside that window
   * so the caller reads the conversation in order.
   *
   * The conversation is looked up by `id` *and* `organizationId` first; only if
   * that row exists does this read messages, and then only by the conversation id
   * it just proved. A thread from another organization is `null` — identical to a
   * thread that does not exist — and its messages are never read at all.
   */
  async history(
    organizationId: string,
    conversationId: string,
    limit: number = HISTORY_DEFAULT_LIMIT,
  ): Promise<WhatsAppSupervisionHistory | null> {
    if (!organizationId || !conversationId) return null;

    const conversation = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, organizationId },
      select: { id: true },
    });
    if (!conversation) return null;

    const take = boundedLimit(limit, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT);
    const rows = await this.prisma.whatsAppMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take,
      select: { direction: true, source: true, sentAt: true, body: true },
    });

    return {
      conversationId: conversation.id,
      messages: rows.reverse().map((row) => ({
        direction: row.direction,
        source: row.source,
        sentAt: row.sentAt,
        body: row.body,
      })),
    };
  }
}
