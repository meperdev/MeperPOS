import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import {
  RETENTION_CONVERSATION_BATCH,
  RETENTION_MESSAGE_BATCH,
  WhatsAppRetentionService,
} from './whatsapp-retention.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-03-10T03:00:00.000Z');
const CONNECTION_ID = 'connection-1';
const OTHER_CONNECTION_ID = 'connection-2';

/** The phone and the body a purge run must never put in a log line. */
const PHONE = '573001112233';
const BODY = 'mensaje privado del cliente';

interface ConnectionRow {
  id: string;
  retentionDays: number;
}

interface ConversationRow {
  id: string;
  connectionId: string;
  contactPhone: string;
  lastMessageAt: Date | null;
  createdAt: Date;
}

interface MessageRow {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  body: string | null;
  sentAt: Date;
}

const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

function conversation(
  overrides: Partial<ConversationRow> & { id: string },
): ConversationRow {
  return {
    connectionId: CONNECTION_ID,
    contactPhone: PHONE,
    lastMessageAt: null,
    createdAt: ago(60),
    ...overrides,
  };
}

function message(
  id: string,
  conversationId: string,
  sentAt: Date,
  body: string | null = BODY,
): MessageRow {
  return {
    id,
    conversationId,
    direction: 'INBOUND',
    body,
    sentAt,
  };
}

/**
 * An in-memory Prisma that honors the exact predicates the purge writes, so a
 * "recent message survived" assertion is the database answering and not a mock
 * agreeing with itself. Every call is asserted on its own in at least one test:
 * a fake that quietly widened a `where` would make the survival tests lie.
 */
function setup(
  seed: {
    connections?: ConnectionRow[];
    conversations?: ConversationRow[];
    messages?: MessageRow[];
  } = {},
  options: { failConnectionId?: string } = {},
) {
  const connections = (seed.connections ?? []).map((row) => ({ ...row }));
  const conversations = (seed.conversations ?? []).map((row) => ({ ...row }));
  const messages = (seed.messages ?? []).map((row) => ({ ...row }));

  const forbidden = (name: string) =>
    jest.fn(() => {
      throw new Error(`unexpected write: ${name}`);
    });

  const prisma = {
    whatsAppConnection: {
      findUnique: jest.fn(
        ({ where }: { where: { id: string } }) =>
          connections.find((row) => row.id === where.id) ?? null,
      ),
      findMany: jest.fn(() => connections.map((row) => ({ id: row.id }))),
      create: forbidden('whatsAppConnection.create'),
      update: forbidden('whatsAppConnection.update'),
      updateMany: forbidden('whatsAppConnection.updateMany'),
      delete: forbidden('whatsAppConnection.delete'),
      deleteMany: forbidden('whatsAppConnection.deleteMany'),
    },
    whatsAppMessage: {
      findMany: jest.fn(
        ({
          where,
          take,
        }: {
          where: {
            sentAt: { lt: Date };
            conversation: { connectionId: string };
          };
          take: number;
        }) => {
          if (where.conversation.connectionId === options.failConnectionId) {
            throw new Error('database is unreachable');
          }
          const byId = new Map(conversations.map((row) => [row.id, row]));
          return messages
            .filter((row) => {
              const owner = byId.get(row.conversationId);
              return (
                owner?.connectionId === where.conversation.connectionId &&
                row.sentAt.getTime() < where.sentAt.lt.getTime()
              );
            })
            .sort(
              (a, b) =>
                a.sentAt.getTime() - b.sentAt.getTime() ||
                a.id.localeCompare(b.id),
            )
            .slice(0, take)
            .map((row) => ({ id: row.id }));
        },
      ),
      deleteMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) => {
        const doomed = new Set(where.id.in);
        let count = 0;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (doomed.has(messages[index].id)) {
            messages.splice(index, 1);
            count += 1;
          }
        }
        return { count };
      }),
      create: forbidden('whatsAppMessage.create'),
      update: forbidden('whatsAppMessage.update'),
      updateMany: forbidden('whatsAppMessage.updateMany'),
      delete: forbidden('whatsAppMessage.delete'),
    },
    whatsAppConversation: {
      findMany: jest.fn(
        ({
          where,
          take,
        }: {
          where: {
            connectionId: string;
            messages: { none: Record<string, never> };
            OR: Array<
              | { lastMessageAt: { lt: Date } }
              | { lastMessageAt: null; createdAt: { lt: Date } }
            >;
          };
          take: number;
        }) => {
          const cutoff =
            'lastMessageAt' in where.OR[0] &&
            where.OR[0].lastMessageAt &&
            'lt' in where.OR[0].lastMessageAt
              ? where.OR[0].lastMessageAt.lt
              : (where.OR[1] as { createdAt: { lt: Date } }).createdAt.lt;

          return conversations
            .filter((row) => {
              if (row.connectionId !== where.connectionId) return false;
              if (messages.some((m) => m.conversationId === row.id))
                return false;
              const reference = row.lastMessageAt ?? row.createdAt;
              return reference.getTime() < cutoff.getTime();
            })
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, take)
            .map((row) => ({ id: row.id }));
        },
      ),
      deleteMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) => {
        const doomed = new Set(where.id.in);
        let count = 0;
        for (let index = conversations.length - 1; index >= 0; index -= 1) {
          if (doomed.has(conversations[index].id)) {
            const [removed] = conversations.splice(index, 1);
            // The schema cascades, so the fake does too.
            for (
              let messageIndex = messages.length - 1;
              messageIndex >= 0;
              messageIndex -= 1
            ) {
              if (messages[messageIndex].conversationId === removed.id) {
                messages.splice(messageIndex, 1);
              }
            }
            count += 1;
          }
        }
        return { count };
      }),
      create: forbidden('whatsAppConversation.create'),
      update: forbidden('whatsAppConversation.update'),
      updateMany: forbidden('whatsAppConversation.updateMany'),
      delete: forbidden('whatsAppConversation.delete'),
    },
    $transaction: forbidden('$transaction'),
  };

  return {
    prisma,
    connections,
    conversations,
    messages,
    service: new WhatsAppRetentionService(prisma as unknown as PrismaService),
  };
}

function spyOnLogger() {
  const channels = ['log', 'error', 'warn', 'debug', 'verbose'] as const;
  return channels.map((channel) =>
    jest.spyOn(Logger.prototype, channel).mockImplementation(() => undefined),
  );
}

function stringified(loggerSpies: jest.SpyInstance[]): string {
  return loggerSpies.map((spy) => JSON.stringify(spy.mock.calls)).join(' ');
}

describe('WhatsAppRetentionService', () => {
  describe('purgeConnection', () => {
    it('deletes messages older than the cutoff and keeps the recent ones', async () => {
      const { service, messages } = setup({
        connections: [{ id: CONNECTION_ID, retentionDays: 30 }],
        conversations: [conversation({ id: 'c1' })],
        messages: [
          message('old-1', 'c1', ago(45)),
          message('old-2', 'c1', ago(31)),
          message('recent', 'c1', ago(2)),
        ],
      });

      const outcome = await service.purgeConnection(CONNECTION_ID, NOW);

      expect(outcome).toEqual({
        connectionId: CONNECTION_ID,
        retentionDays: 30,
        messagesDeleted: 2,
        conversationsDeleted: 0,
        boundReached: false,
      });
      expect(messages.map((row) => row.id)).toEqual(['recent']);
    });

    it('uses the connection retention policy rather than a fixed window', async () => {
      const { service, messages } = setup({
        connections: [{ id: CONNECTION_ID, retentionDays: 7 }],
        conversations: [conversation({ id: 'c1' })],
        messages: [
          message('ten-days', 'c1', ago(10)),
          message('two-days', 'c1', ago(2)),
        ],
      });

      await service.purgeConnection(CONNECTION_ID, NOW);

      expect(messages.map((row) => row.id)).toEqual(['two-days']);
    });

    it('keeps a message that is exactly at the cutoff', async () => {
      const cutoff = ago(30);
      const { service, messages } = setup({
        connections: [{ id: CONNECTION_ID, retentionDays: 30 }],
        conversations: [conversation({ id: 'c1' })],
        messages: [
          message('one-ms-too-old', 'c1', new Date(cutoff.getTime() - 1)),
          message('exactly-at-cutoff', 'c1', cutoff),
        ],
      });

      await service.purgeConnection(CONNECTION_ID, NOW);

      expect(messages.map((row) => row.id)).toEqual(['exactly-at-cutoff']);
    });

    it('treats a legacy retention value below one day as one day', async () => {
      const { service, messages } = setup({
        connections: [{ id: CONNECTION_ID, retentionDays: 0 }],
        conversations: [conversation({ id: 'c1' })],
        messages: [
          message('two-days', 'c1', ago(2)),
          message('one-hour', 'c1', new Date(NOW.getTime() - 60 * 60 * 1000)),
        ],
      });

      const outcome = await service.purgeConnection(CONNECTION_ID, NOW);

      expect(outcome?.retentionDays).toBe(1);
      expect(messages.map((row) => row.id)).toEqual(['one-hour']);
    });

    it('keeps a thread that still has recent content', async () => {
      const { service, conversations, messages } = setup({
        connections: [{ id: CONNECTION_ID, retentionDays: 30 }],
        conversations: [conversation({ id: 'c1' })],
        messages: [
          message('old', 'c1', ago(45)),
          message('recent', 'c1', ago(3)),
        ],
      });

      const outcome = await service.purgeConnection(CONNECTION_ID, NOW);

      expect(outcome).toEqual(
        expect.objectContaining({
          messagesDeleted: 1,
          conversationsDeleted: 0,
        }),
      );
      expect(conversations.map((row) => row.id)).toEqual(['c1']);
      expect(messages.map((row) => row.id)).toEqual(['recent']);
    });

    it('removes an old thread once its last message is gone, taking the phone with it', async () => {
      const { service, conversations, messages } = setup({
        connections: [{ id: CONNECTION_ID, retentionDays: 30 }],
        conversations: [
          conversation({
            id: 'gone',
            lastMessageAt: ago(45),
            createdAt: ago(90),
          }),
          // An empty thread that never got a message and predates the cutoff.
          conversation({
            id: 'never-used',
            lastMessageAt: null,
            createdAt: ago(60),
          }),
        ],
        messages: [message('old', 'gone', ago(45))],
      });

      const outcome = await service.purgeConnection(CONNECTION_ID, NOW);

      expect(outcome).toEqual(
        expect.objectContaining({
          messagesDeleted: 1,
          conversationsDeleted: 2,
        }),
      );
      expect(conversations).toEqual([]);
      expect(messages).toEqual([]);
    });

    it('keeps an empty thread that is newer than the cutoff', async () => {
      const { service, conversations } = setup({
        connections: [{ id: CONNECTION_ID, retentionDays: 30 }],
        conversations: [
          conversation({
            id: 'fresh',
            lastMessageAt: null,
            createdAt: ago(1),
          }),
        ],
      });

      const outcome = await service.purgeConnection(CONNECTION_ID, NOW);

      expect(outcome?.conversationsDeleted).toBe(0);
      expect(conversations.map((row) => row.id)).toEqual(['fresh']);
    });

    it('only reaches the conversations of its own connection', async () => {
      const { service, prisma, messages } = setup({
        connections: [
          { id: CONNECTION_ID, retentionDays: 30 },
          { id: OTHER_CONNECTION_ID, retentionDays: 30 },
        ],
        conversations: [
          conversation({ id: 'mine' }),
          conversation({ id: 'theirs', connectionId: OTHER_CONNECTION_ID }),
        ],
        messages: [
          message('mine-old', 'mine', ago(45)),
          message('theirs-old', 'theirs', ago(45)),
        ],
      });

      await service.purgeConnection(CONNECTION_ID, NOW);

      expect(prisma.whatsAppMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sentAt: { lt: ago(30) },
            conversation: { connectionId: CONNECTION_ID },
          },
        }),
      );
      expect(messages.map((row) => row.id)).toEqual(['theirs-old']);
    });

    it('bounds each run so a first purge cannot lock the table', async () => {
      const { service, messages } = setup({
        connections: [{ id: CONNECTION_ID, retentionDays: 30 }],
        conversations: [conversation({ id: 'c1' })],
        messages: Array.from(
          { length: RETENTION_MESSAGE_BATCH + 5 },
          (_, index) =>
            message(`m${String(index).padStart(4, '0')}`, 'c1', ago(31)),
        ),
      });

      const first = await service.purgeConnection(CONNECTION_ID, NOW);

      expect(first).toEqual(
        expect.objectContaining({
          messagesDeleted: RETENTION_MESSAGE_BATCH,
          boundReached: true,
        }),
      );
      expect(messages).toHaveLength(5);

      const second = await service.purgeConnection(CONNECTION_ID, NOW);

      expect(second).toEqual(
        expect.objectContaining({ messagesDeleted: 5, boundReached: false }),
      );
      expect(messages).toEqual([]);
    });

    it('bounds the conversation removals per run too', async () => {
      const { service, prisma, conversations } = setup({
        connections: [{ id: CONNECTION_ID, retentionDays: 30 }],
        conversations: Array.from(
          { length: RETENTION_CONVERSATION_BATCH + 2 },
          (_, index) =>
            conversation({
              id: `c${String(index).padStart(4, '0')}`,
              lastMessageAt: ago(40),
              createdAt: ago(80),
            }),
        ),
      });

      const outcome = await service.purgeConnection(CONNECTION_ID, NOW);

      expect(prisma.whatsAppConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: RETENTION_CONVERSATION_BATCH }),
      );
      expect(outcome?.conversationsDeleted).toBe(RETENTION_CONVERSATION_BATCH);
      expect(conversations).toHaveLength(2);
    });

    it('deletes nothing on a second run', async () => {
      const { service, prisma } = setup({
        connections: [{ id: CONNECTION_ID, retentionDays: 30 }],
        conversations: [
          conversation({
            id: 'c1',
            lastMessageAt: ago(45),
            createdAt: ago(90),
          }),
        ],
        messages: [
          message('old', 'c1', ago(45)),
          message('recent', 'c1', ago(2)),
        ],
      });

      await service.purgeConnection(CONNECTION_ID, NOW);
      prisma.whatsAppMessage.deleteMany.mockClear();
      prisma.whatsAppConversation.deleteMany.mockClear();

      const second = await service.purgeConnection(CONNECTION_ID, NOW);

      expect(second).toEqual({
        connectionId: CONNECTION_ID,
        retentionDays: 30,
        messagesDeleted: 0,
        conversationsDeleted: 0,
        boundReached: false,
      });
      // Nothing to delete means no delete statement at all.
      expect(prisma.whatsAppMessage.deleteMany).not.toHaveBeenCalled();
      expect(prisma.whatsAppConversation.deleteMany).not.toHaveBeenCalled();
    });

    it('reports an unknown connection as nothing to do', async () => {
      const { service, prisma } = setup();

      await expect(service.purgeConnection('missing', NOW)).resolves.toBeNull();
      expect(prisma.whatsAppMessage.findMany).not.toHaveBeenCalled();
    });

    it('never opens a transaction and never writes outside the two deletes', async () => {
      const { service, prisma } = setup({
        connections: [{ id: CONNECTION_ID, retentionDays: 30 }],
        conversations: [conversation({ id: 'c1' })],
        messages: [message('old', 'c1', ago(45))],
      });

      await service.purgeConnection(CONNECTION_ID, NOW);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      for (const method of [
        'create',
        'update',
        'updateMany',
        'delete',
      ] as const) {
        expect(prisma.whatsAppConnection[method]).not.toHaveBeenCalled();
        expect(prisma.whatsAppConversation[method]).not.toHaveBeenCalled();
        expect(prisma.whatsAppMessage[method]).not.toHaveBeenCalled();
      }
    });
  });

  describe('purgeAll', () => {
    it('purges every connection and reports the counts', async () => {
      const { service } = setup({
        connections: [
          { id: CONNECTION_ID, retentionDays: 30 },
          { id: OTHER_CONNECTION_ID, retentionDays: 30 },
        ],
        conversations: [
          conversation({ id: 'c1' }),
          conversation({ id: 'c2', connectionId: OTHER_CONNECTION_ID }),
        ],
        messages: [
          message('old-1', 'c1', ago(45)),
          message('keep-1', 'c1', ago(1)),
          message('old-2', 'c2', ago(45)),
        ],
      });

      const outcome = await service.purgeAll(NOW);

      expect(outcome).toEqual({
        connectionsProcessed: 2,
        connectionsFailed: 0,
        messagesDeleted: 2,
        // c2 had one expired message and nothing else, so the thread and its
        // phone go too; c1 keeps a recent message and therefore survives.
        conversationsDeleted: 1,
        boundReached: false,
      });
    });

    it('keeps going when one connection fails', async () => {
      const { service, messages } = setup(
        {
          connections: [
            { id: CONNECTION_ID, retentionDays: 30 },
            { id: OTHER_CONNECTION_ID, retentionDays: 30 },
          ],
          conversations: [
            conversation({ id: 'c1' }),
            conversation({ id: 'c2', connectionId: OTHER_CONNECTION_ID }),
          ],
          messages: [
            message('old-1', 'c1', ago(45)),
            message('old-2', 'c2', ago(45)),
          ],
        },
        { failConnectionId: CONNECTION_ID },
      );

      const outcome = await service.purgeAll(NOW);

      expect(outcome).toEqual(
        expect.objectContaining({
          connectionsProcessed: 1,
          connectionsFailed: 1,
          messagesDeleted: 1,
        }),
      );
      expect(messages.map((row) => row.id)).toEqual(['old-1']);
    });

    it('logs counts and fixed codes only', async () => {
      const loggerSpies = spyOnLogger();
      try {
        const { service } = setup({
          connections: [{ id: CONNECTION_ID, retentionDays: 30 }],
          conversations: [
            conversation({
              id: 'c1',
              contactPhone: PHONE,
              lastMessageAt: ago(45),
              createdAt: ago(90),
            }),
          ],
          messages: [message('old', 'c1', ago(45))],
        });

        await service.purgeAll(NOW);

        const logged = stringified(loggerSpies);
        expect(logged).toContain('whatsapp_retention');
        expect(logged).toContain('messagesDeleted');
        expect(logged).not.toContain(PHONE);
        expect(logged).not.toContain(BODY);
        // The connection id is not a phone, but it is an identifier all the same.
        expect(logged).not.toContain(CONNECTION_ID);
      } finally {
        loggerSpies.forEach((spy) => spy.mockRestore());
      }
    });

    it('logs a fixed failure code without the underlying message', async () => {
      const loggerSpies = spyOnLogger();
      try {
        const { service } = setup(
          {
            connections: [{ id: CONNECTION_ID, retentionDays: 30 }],
            conversations: [conversation({ id: 'c1' })],
          },
          { failConnectionId: CONNECTION_ID },
        );

        await service.purgeAll(NOW);

        const logged = stringified(loggerSpies);
        expect(logged).toContain('purge_failed');
        expect(logged).not.toContain('database is unreachable');
      } finally {
        loggerSpies.forEach((spy) => spy.mockRestore());
      }
    });
  });
});
