import type { PrismaService } from '../prisma/prisma.service';
import {
  boundedLimit,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  SUPERVISION_DEFAULT_LIMIT,
  SUPERVISION_MAX_LIMIT,
  WhatsAppSupervisionService,
} from './whatsapp-supervision.service';

const ORGANIZATION_ID = 'org-1';
const FOREIGN_ORGANIZATION_ID = 'org-2';
const CONNECTION_ID = 'connection-1';

type Direction = 'INBOUND' | 'OUTBOUND';
type State = 'AUTOMATED' | 'HUMAN' | 'SUSPENDED';
type ContactKind = 'CLIENT' | 'INTERNAL' | 'UNKNOWN';

interface ConversationRow {
  id: string;
  connectionId: string;
  organizationId: string | null;
  contactPhone: string;
  contactKind: ContactKind;
  state: State;
  customerId: string | null;
  firstInboundAt: Date | null;
  firstResponseAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
}

interface MessageRow {
  id: string;
  conversationId: string;
  direction: Direction;
  source: string;
  body: string | null;
  sentAt: Date;
}

const at = (iso: string) => new Date(iso);

/** A body marker that must never leave `history()`. */
const BODY = 'cuerpo reservado del cliente';

function conversation(overrides: Partial<ConversationRow> & { id: string }) {
  return {
    connectionId: CONNECTION_ID,
    organizationId: ORGANIZATION_ID,
    contactPhone: '573001112233',
    contactKind: 'CLIENT' as ContactKind,
    state: 'AUTOMATED' as State,
    customerId: null,
    firstInboundAt: null,
    firstResponseAt: null,
    lastMessageAt: null,
    createdAt: at('2026-03-01T00:00:00.000Z'),
    ...overrides,
  };
}

function message(
  id: string,
  conversationId: string,
  direction: Direction,
  sentAt: Date,
  body: string | null = BODY,
): MessageRow {
  return {
    id,
    conversationId,
    direction,
    source: 'app',
    body,
    sentAt,
  };
}

const newestFirst = (a: MessageRow, b: MessageRow) =>
  b.sentAt.getTime() - a.sentAt.getTime() || b.id.localeCompare(a.id);

const oldestFirst = (a: MessageRow, b: MessageRow) =>
  a.sentAt.getTime() - b.sentAt.getTime() || a.id.localeCompare(b.id);

/**
 * A tiny in-memory Prisma, shaped by the arguments the service actually passes.
 * It answers `where` clauses faithfully for the organization filter, so an
 * organization-scoping assertion is a real one and not an assumption.
 */
function setup(
  seed: { conversations?: ConversationRow[]; messages?: MessageRow[] } = {},
) {
  const conversations = seed.conversations ?? [];
  const messages = seed.messages ?? [];

  for (const row of conversations) {
    row.lastMessageAt =
      row.lastMessageAt ??
      messages
        .filter((m) => m.conversationId === row.id)
        .sort(oldestFirst)
        .at(-1)?.sentAt ??
      null;
  }

  const latestMessageOf = (conversationId: string) =>
    messages
      .filter((m) => m.conversationId === conversationId)
      .sort(newestFirst)
      .slice(0, 1);

  const forbidden = (name: string) =>
    jest.fn(() => {
      throw new Error(`unexpected write: ${name}`);
    });

  const prisma = {
    whatsAppConversation: {
      groupBy: jest.fn(
        ({
          by,
          where,
        }: {
          by: string[];
          where: { organizationId: string };
        }) => {
          const key = by[0] as 'state' | 'contactKind';
          const counts = new Map<string, number>();
          for (const row of conversations) {
            if (row.organizationId !== where.organizationId) continue;
            const value = String(row[key]);
            counts.set(value, (counts.get(value) ?? 0) + 1);
          }
          return [...counts.entries()].map(([value, count]) => ({
            [key]: value,
            _count: { _all: count },
          }));
        },
      ),
      // Deliberately returns every column plus the latest message: the service
      // must select explicitly, so a body that arrives here still cannot leave.
      findMany: jest.fn(
        ({
          where,
          take,
        }: {
          where: { organizationId: string };
          take?: number;
        }) => {
          const rows = conversations
            .filter((row) => row.organizationId === where.organizationId)
            .sort(
              (a, b) =>
                (b.lastMessageAt?.getTime() ?? -Infinity) -
                  (a.lastMessageAt?.getTime() ?? -Infinity) ||
                a.id.localeCompare(b.id),
            );
          const limited = take === undefined ? rows : rows.slice(0, take);
          return limited.map((row) => ({
            ...row,
            messages: latestMessageOf(row.id),
          }));
        },
      ),
      findFirst: jest.fn(
        ({ where }: { where: { id: string; organizationId: string } }) =>
          conversations.find(
            (row) =>
              row.id === where.id &&
              row.organizationId === where.organizationId,
          ) ?? null,
      ),
      create: forbidden('whatsAppConversation.create'),
      update: forbidden('whatsAppConversation.update'),
      updateMany: forbidden('whatsAppConversation.updateMany'),
      delete: forbidden('whatsAppConversation.delete'),
      deleteMany: forbidden('whatsAppConversation.deleteMany'),
      count: forbidden('whatsAppConversation.count'),
      aggregate: forbidden('whatsAppConversation.aggregate'),
    },
    whatsAppMessage: {
      findMany: jest.fn(
        ({
          where,
          take,
        }: {
          where: { conversationId: string };
          take?: number;
        }) => {
          const rows = messages
            .filter((row) => row.conversationId === where.conversationId)
            .sort(newestFirst);
          return take === undefined ? rows : rows.slice(0, take);
        },
      ),
      create: forbidden('whatsAppMessage.create'),
      update: forbidden('whatsAppMessage.update'),
      updateMany: forbidden('whatsAppMessage.updateMany'),
      delete: forbidden('whatsAppMessage.delete'),
      deleteMany: forbidden('whatsAppMessage.deleteMany'),
      count: forbidden('whatsAppMessage.count'),
      aggregate: forbidden('whatsAppMessage.aggregate'),
    },
    $transaction: forbidden('$transaction'),
  };

  return {
    prisma,
    conversations,
    messages,
    service: new WhatsAppSupervisionService(prisma as unknown as PrismaService),
  };
}

describe('WhatsAppSupervisionService', () => {
  describe('boundedLimit', () => {
    it('defaults, clamps and floors a caller-supplied limit', () => {
      expect(boundedLimit(undefined, 50, 100)).toBe(50);
      expect(boundedLimit(0, 50, 100)).toBe(50);
      expect(boundedLimit(-3, 50, 100)).toBe(50);
      expect(boundedLimit(Number.NaN, 50, 100)).toBe(50);
      expect(boundedLimit('25', 50, 100)).toBe(50);
      expect(boundedLimit(7.9, 50, 100)).toBe(7);
      expect(boundedLimit(1000, 50, 100)).toBe(100);
    });

    it('publishes the documented defaults and caps', () => {
      expect(SUPERVISION_DEFAULT_LIMIT).toBe(50);
      expect(SUPERVISION_MAX_LIMIT).toBe(100);
      expect(HISTORY_DEFAULT_LIMIT).toBe(30);
      expect(HISTORY_MAX_LIMIT).toBe(100);
    });
  });

  describe('summary', () => {
    it('counts conversations per state and per contact kind for one organization', async () => {
      const { service } = setup({
        conversations: [
          conversation({ id: 'c1', state: 'AUTOMATED', contactKind: 'CLIENT' }),
          conversation({ id: 'c2', state: 'HUMAN', contactKind: 'CLIENT' }),
          conversation({
            id: 'c3',
            state: 'SUSPENDED',
            contactKind: 'INTERNAL',
          }),
          conversation({
            id: 'c4',
            state: 'AUTOMATED',
            contactKind: 'UNKNOWN',
          }),
        ],
      });

      const summary = await service.summary(ORGANIZATION_ID);

      expect(summary.totalConversations).toBe(4);
      expect(summary.byState).toEqual({
        AUTOMATED: 2,
        HUMAN: 1,
        SUSPENDED: 1,
      });
      expect(summary.byContactKind).toEqual({
        CLIENT: 2,
        INTERNAL: 1,
        UNKNOWN: 1,
      });
    });

    it('returns zeroes and a null median for an organization with no traffic', async () => {
      const { service } = setup({
        conversations: [conversation({ id: 'c1' })],
      });

      await expect(service.summary(FOREIGN_ORGANIZATION_ID)).resolves.toEqual({
        totalConversations: 0,
        byState: { AUTOMATED: 0, HUMAN: 0, SUSPENDED: 0 },
        byContactKind: { CLIENT: 0, INTERNAL: 0, UNKNOWN: 0 },
        pendingAnswerCount: 0,
        firstResponse: { sampleCount: 0, medianMs: null },
      });
    });

    it('scopes every query by organization', async () => {
      const { service, prisma } = setup({
        conversations: [
          conversation({ id: 'mine' }),
          conversation({
            id: 'theirs',
            organizationId: FOREIGN_ORGANIZATION_ID,
          }),
        ],
      });

      const summary = await service.summary(ORGANIZATION_ID);

      expect(summary.totalConversations).toBe(1);
      for (const call of prisma.whatsAppConversation.groupBy.mock.calls) {
        expect(call[0].where).toEqual({ organizationId: ORGANIZATION_ID });
      }
      expect(
        prisma.whatsAppConversation.findMany.mock.calls.map(
          (call) => call[0].where,
        ),
      ).toEqual([{ organizationId: ORGANIZATION_ID }]);
    });

    it('counts a conversation as pending only when its last message is INBOUND', async () => {
      const { service } = setup({
        conversations: [
          // Last message inbound: waiting for us.
          conversation({ id: 'waiting' }),
          // Answered last: not pending.
          conversation({ id: 'answered' }),
          // Never written to: nothing to answer.
          conversation({ id: 'empty' }),
          // A late older inbound does not move the last message.
          conversation({ id: 'late' }),
        ],
        messages: [
          message('w1', 'waiting', 'OUTBOUND', at('2026-03-02T10:00:00.000Z')),
          message('w2', 'waiting', 'INBOUND', at('2026-03-02T11:00:00.000Z')),
          message('a1', 'answered', 'INBOUND', at('2026-03-02T10:00:00.000Z')),
          message('a2', 'answered', 'OUTBOUND', at('2026-03-02T12:00:00.000Z')),
          message('l1', 'late', 'INBOUND', at('2026-03-02T09:00:00.000Z')),
          message('l2', 'late', 'OUTBOUND', at('2026-03-02T13:00:00.000Z')),
        ],
      });

      const summary = await service.summary(ORGANIZATION_ID);

      expect(summary.pendingAnswerCount).toBe(1);
    });

    it('computes the median first-response time for an odd sample', async () => {
      const { service } = setup({
        conversations: [
          conversation({
            id: 'c1',
            firstInboundAt: at('2026-03-02T10:00:00.000Z'),
            firstResponseAt: at('2026-03-02T10:00:01.000Z'),
          }),
          conversation({
            id: 'c2',
            firstInboundAt: at('2026-03-02T10:00:00.000Z'),
            firstResponseAt: at('2026-03-02T10:00:03.000Z'),
          }),
          conversation({
            id: 'c3',
            firstInboundAt: at('2026-03-02T10:00:00.000Z'),
            firstResponseAt: at('2026-03-02T10:00:08.000Z'),
          }),
          // Half-measured conversations are not samples.
          conversation({
            id: 'c4',
            firstInboundAt: at('2026-03-02T10:00:00.000Z'),
          }),
          conversation({ id: 'c5' }),
        ],
      });

      const summary = await service.summary(ORGANIZATION_ID);

      expect(summary.firstResponse).toEqual({
        sampleCount: 3,
        medianMs: 3000,
      });
    });

    it('computes the median first-response time for an even sample', async () => {
      const { service } = setup({
        conversations: [
          conversation({
            id: 'c1',
            firstInboundAt: at('2026-03-02T10:00:00.000Z'),
            firstResponseAt: at('2026-03-02T10:00:01.000Z'),
          }),
          conversation({
            id: 'c2',
            firstInboundAt: at('2026-03-02T10:00:00.000Z'),
            firstResponseAt: at('2026-03-02T10:00:03.000Z'),
          }),
          conversation({
            id: 'c3',
            firstInboundAt: at('2026-03-02T10:00:00.000Z'),
            firstResponseAt: at('2026-03-02T10:00:08.000Z'),
          }),
          conversation({
            id: 'c4',
            firstInboundAt: at('2026-03-02T10:00:00.000Z'),
            firstResponseAt: at('2026-03-02T10:00:20.000Z'),
          }),
        ],
      });

      const summary = await service.summary(ORGANIZATION_ID);

      expect(summary.firstResponse).toEqual({
        sampleCount: 4,
        medianMs: 5500,
      });
    });

    it('never returns a body or a phone', async () => {
      const { service } = setup({
        conversations: [
          conversation({
            id: 'c1',
            contactPhone: '573009998877',
            firstInboundAt: at('2026-03-02T10:00:00.000Z'),
            firstResponseAt: at('2026-03-02T10:00:02.000Z'),
          }),
        ],
        messages: [
          message('m1', 'c1', 'INBOUND', at('2026-03-02T10:00:00.000Z')),
        ],
      });

      const payload = JSON.stringify(await service.summary(ORGANIZATION_ID));

      expect(payload).not.toContain(BODY);
      expect(payload).not.toContain('573009998877');
    });
  });

  describe('conversations', () => {
    it('lists the threads of one organization newest first with nulls last', async () => {
      const { service } = setup({
        conversations: [
          conversation({
            id: 'old',
            lastMessageAt: at('2026-03-02T10:00:00.000Z'),
          }),
          conversation({
            id: 'none',
            lastMessageAt: null,
            createdAt: at('2026-03-03T00:00:00.000Z'),
          }),
          conversation({
            id: 'new',
            lastMessageAt: at('2026-03-02T12:00:00.000Z'),
          }),
        ],
      });

      const rows = await service.conversations(ORGANIZATION_ID);

      expect(rows.map((row) => row.conversationId)).toEqual([
        'new',
        'old',
        'none',
      ]);
    });

    it('returns the supervision fields and nothing else', async () => {
      const { service } = setup({
        conversations: [
          conversation({
            id: 'c1',
            contactPhone: '573001112233',
            contactKind: 'CLIENT',
            state: 'HUMAN',
            customerId: 'customer-1',
            lastMessageAt: at('2026-03-02T12:00:00.000Z'),
            firstInboundAt: at('2026-03-02T11:00:00.000Z'),
            firstResponseAt: at('2026-03-02T11:00:02.000Z'),
          }),
        ],
        messages: [
          message('m1', 'c1', 'INBOUND', at('2026-03-02T12:00:00.000Z')),
        ],
      });

      const [row] = await service.conversations(ORGANIZATION_ID);

      expect(row).toEqual({
        conversationId: 'c1',
        contactPhone: '573001112233',
        contactKind: 'CLIENT',
        state: 'HUMAN',
        customerId: 'customer-1',
        lastMessageAt: at('2026-03-02T12:00:00.000Z'),
        firstInboundAt: at('2026-03-02T11:00:00.000Z'),
        firstResponseAt: at('2026-03-02T11:00:02.000Z'),
      });
      expect(JSON.stringify(row)).not.toContain(BODY);
    });

    it('never returns a conversation of another organization', async () => {
      const { service } = setup({
        conversations: [
          conversation({ id: 'mine' }),
          conversation({
            id: 'theirs',
            organizationId: FOREIGN_ORGANIZATION_ID,
            contactPhone: '573009998877',
          }),
        ],
      });

      const mine = await service.conversations(ORGANIZATION_ID);
      expect(mine.map((row) => row.conversationId)).toEqual(['mine']);
      expect(JSON.stringify(mine)).not.toContain('573009998877');

      // Each organization sees its own row and only its own row...
      expect(
        (await service.conversations(FOREIGN_ORGANIZATION_ID)).map(
          (row) => row.conversationId,
        ),
      ).toEqual(['theirs']);
      // ...and a third organization sees nothing at all.
      await expect(service.conversations('org-empty')).resolves.toEqual([]);
    });

    it('defaults to 50 and never exceeds 100', async () => {
      const { service } = setup({
        conversations: Array.from({ length: 120 }, (_, index) =>
          conversation({
            id: `c${index}`,
            lastMessageAt: at('2026-03-02T10:00:00.000Z'),
          }),
        ),
      });

      expect(await service.conversations(ORGANIZATION_ID)).toHaveLength(50);
      await service.conversations(ORGANIZATION_ID, { limit: 1000 });
      expect(
        await service.conversations(ORGANIZATION_ID, { limit: 1000 }),
      ).toHaveLength(100);
    });
  });

  describe('history', () => {
    const conversationRow = conversation({ id: 'c1' });

    it('returns the last messages of the thread in reading order, with bodies', async () => {
      const messages = Array.from({ length: 40 }, (_, index) =>
        message(
          `m${String(index).padStart(2, '0')}`,
          'c1',
          index % 2 === 0 ? 'INBOUND' : 'OUTBOUND',
          new Date(at('2026-03-02T10:00:00.000Z').getTime() + index * 1000),
        ),
      );
      const { service } = setup({
        conversations: [conversationRow],
        messages,
      });

      const history = await service.history(ORGANIZATION_ID, 'c1');

      expect(history?.messages).toHaveLength(HISTORY_DEFAULT_LIMIT);
      // The window is the tail, oldest to newest inside the window.
      expect(history?.messages[0].sentAt).toEqual(
        at('2026-03-02T10:00:10.000Z'),
      );
      expect(history?.messages.at(-1)?.sentAt).toEqual(
        at('2026-03-02T10:00:39.000Z'),
      );
      expect(history?.messages[0]).toEqual({
        direction: 'INBOUND',
        source: 'app',
        sentAt: at('2026-03-02T10:00:10.000Z'),
        body: BODY,
      });
    });

    it('reports a conversation of another organization as not found', async () => {
      const { service, prisma } = setup({
        conversations: [
          conversation({ id: 'mine' }),
          conversation({
            id: 'theirs',
            organizationId: FOREIGN_ORGANIZATION_ID,
          }),
        ],
        messages: [
          message('m1', 'theirs', 'INBOUND', at('2026-03-02T10:00:00.000Z')),
        ],
      });

      await expect(
        service.history(ORGANIZATION_ID, 'theirs'),
      ).resolves.toBeNull();
      await expect(service.history('org-empty', 'theirs')).resolves.toBeNull();
      // The owning organization is served, so the refusals above are scoping and
      // not a method that always answers null.
      expect(prisma.whatsAppMessage.findMany).not.toHaveBeenCalled();
      await expect(
        service.history(FOREIGN_ORGANIZATION_ID, 'theirs'),
      ).resolves.toEqual({
        conversationId: 'theirs',
        messages: [
          {
            direction: 'INBOUND',
            source: 'app',
            sentAt: at('2026-03-02T10:00:00.000Z'),
            body: BODY,
          },
        ],
      });
    });

    it('reports an unknown conversation as not found', async () => {
      const { service } = setup();

      await expect(
        service.history(ORGANIZATION_ID, 'does-not-exist'),
      ).resolves.toBeNull();
    });

    it('scopes the lookup by both conversation and organization', async () => {
      const { service, prisma } = setup({
        conversations: [conversationRow],
        messages: [
          message('m1', 'c1', 'INBOUND', at('2026-03-02T10:00:00.000Z')),
        ],
      });

      await service.history(ORGANIZATION_ID, 'c1');

      expect(prisma.whatsAppConversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1', organizationId: ORGANIZATION_ID },
        }),
      );
    });

    it('defaults to 30 and never exceeds 100', async () => {
      const messages = Array.from({ length: 150 }, (_, index) =>
        message(
          `m${String(index).padStart(3, '0')}`,
          'c1',
          'INBOUND',
          new Date(at('2026-03-02T10:00:00.000Z').getTime() + index * 1000),
        ),
      );
      const { service } = setup({
        conversations: [conversationRow],
        messages,
      });

      expect(await service.history(ORGANIZATION_ID, 'c1')).toHaveProperty(
        'messages.length',
        HISTORY_DEFAULT_LIMIT,
      );
      expect(await service.history(ORGANIZATION_ID, 'c1', 1000)).toHaveProperty(
        'messages.length',
        HISTORY_MAX_LIMIT,
      );
    });
  });

  describe('read-only', () => {
    it('never writes and never opens a transaction', async () => {
      const { service, prisma } = setup({
        conversations: [conversation({ id: 'c1' })],
        messages: [
          message('m1', 'c1', 'INBOUND', at('2026-03-02T10:00:00.000Z')),
        ],
      });

      await service.summary(ORGANIZATION_ID);
      await service.conversations(ORGANIZATION_ID);
      await service.history(ORGANIZATION_ID, 'c1');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      for (const model of [
        prisma.whatsAppConversation,
        prisma.whatsAppMessage,
      ]) {
        for (const method of [
          'create',
          'update',
          'updateMany',
          'delete',
          'deleteMany',
        ] as const) {
          expect(model[method]).not.toHaveBeenCalled();
        }
      }
    });
  });
});
