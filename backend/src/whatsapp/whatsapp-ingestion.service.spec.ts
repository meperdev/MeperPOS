import type { Prisma } from '@prisma/client';
import {
  DuplicateWhatsAppMessageError,
  MAX_BODY_LENGTH,
  WhatsAppIngestionService,
  type WhatsAppEvent,
  type WhatsAppEventPayload,
} from './whatsapp-ingestion.service';

const CONNECTION = { id: 'conn-1', organizationId: 'org-1' };
const SENT_AT_SECONDS = 1_700_000_000;
const SENT_AT = new Date(SENT_AT_SECONDS * 1000);
const EARLIER = new Date(1_699_999_000_000);

function event(
  payload: WhatsAppEventPayload = {},
  providerMessageId = 'msg-1',
): WhatsAppEvent {
  return {
    providerMessageId,
    payload: {
      from: '573001112233@c.us',
      fromMe: false,
      source: 'app',
      body: 'hola',
      timestamp: SENT_AT_SECONDS,
      ...payload,
    },
  };
}

interface ConversationRow {
  id: string;
  firstInboundAt: Date | null;
  firstResponseAt: Date | null;
  state: string;
}

function setup(conversation: Partial<ConversationRow> = {}) {
  const row: ConversationRow = {
    id: 'conv-1',
    firstInboundAt: null,
    firstResponseAt: null,
    state: 'AUTOMATED',
    ...conversation,
  };
  const tx = {
    whatsAppInternalContact: { findFirst: jest.fn().mockResolvedValue(null) },
    customer: { findFirst: jest.fn().mockResolvedValue(null) },
    whatsAppConversation: {
      upsert: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue({}),
    },
    whatsAppMessage: { create: jest.fn().mockResolvedValue({ id: 'm-1' }) },
  };
  const service = new WhatsAppIngestionService();
  const ingest = (e: WhatsAppEvent = event()) =>
    service.ingest(tx as unknown as Prisma.TransactionClient, CONNECTION, e);
  const conversationCreated = () =>
    tx.whatsAppConversation.upsert.mock.calls[0][0] as {
      where: unknown;
      create: Record<string, unknown>;
      update: unknown;
    };
  const messageCreated = () =>
    tx.whatsAppMessage.create.mock.calls[0][0].data as Record<string, unknown>;
  const conversationUpdated = () =>
    tx.whatsAppConversation.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
  return {
    tx,
    ingest,
    conversationCreated,
    messageCreated,
    conversationUpdated,
  };
}

describe('WhatsAppIngestionService', () => {
  describe('contact classification', () => {
    it('classifies an internal number as INTERNAL and never as a client', async () => {
      const { tx, ingest, conversationCreated } = setup();
      tx.whatsAppInternalContact.findFirst.mockResolvedValue({
        id: 'internal-1',
      });

      await ingest();

      const { create } = conversationCreated();
      expect(create).toMatchObject({ contactKind: 'INTERNAL' });
      expect(create).not.toHaveProperty('customerId');
      expect(tx.customer.findFirst).not.toHaveBeenCalled();
    });

    it('decides internal before customer, so an internal number is never a client', async () => {
      const { tx, ingest, conversationCreated } = setup();
      tx.whatsAppInternalContact.findFirst.mockResolvedValue({
        id: 'internal-1',
      });
      tx.customer.findFirst.mockResolvedValue({ id: 'customer-1' });

      await ingest();

      expect(conversationCreated().create.contactKind).toBe('INTERNAL');
      expect(tx.customer.findFirst).not.toHaveBeenCalled();
    });

    it('classifies a known customer as CLIENT and links its id', async () => {
      const { tx, ingest, conversationCreated } = setup();
      tx.customer.findFirst.mockResolvedValue({ id: 'customer-1' });

      await ingest();

      expect(conversationCreated().create).toMatchObject({
        contactKind: 'CLIENT',
        customerId: 'customer-1',
      });
      expect(tx.customer.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', phone: '573001112233' },
        select: { id: true },
      });
    });

    it('classifies an unknown phone as UNKNOWN without inventing a customer', async () => {
      const { ingest, conversationCreated } = setup();

      await ingest();

      const { create } = conversationCreated();
      expect(create).toMatchObject({ contactKind: 'UNKNOWN' });
      expect(create).not.toHaveProperty('customerId');
    });

    it('keeps the conversation keyed by connection and contact', async () => {
      const { ingest, conversationCreated } = setup();

      await ingest();

      const { where, create } = conversationCreated();
      expect(where).toEqual({
        connectionId_contactPhone: {
          connectionId: 'conn-1',
          contactPhone: '573001112233',
        },
      });
      expect(create).toMatchObject({
        connectionId: 'conn-1',
        organizationId: 'org-1',
        contactPhone: '573001112233',
      });
    });

    it.each([
      ['+57 300 111 2233@s.whatsapp.net', '573001112233'],
      ['573001112233@lid', '573001112233'],
      ['573001112233', '573001112233'],
    ])('normalises %s to digits only', async (from, expected) => {
      const { ingest, conversationCreated } = setup();

      await ingest(event({ from }));

      expect(conversationCreated().create.contactPhone).toBe(expected);
    });
  });

  describe('message recording', () => {
    it('records an inbound message with the provider timestamp', async () => {
      const { ingest, messageCreated } = setup();

      await ingest();

      expect(messageCreated()).toMatchObject({
        conversationId: 'conv-1',
        providerMessageId: 'msg-1',
        direction: 'INBOUND',
        sentAt: SENT_AT,
      });
    });

    it('uses OUTBOUND only when the provider reports fromMe true', async () => {
      const outbound = setup();
      await outbound.ingest(event({ fromMe: true }));
      expect(outbound.messageCreated().direction).toBe('OUTBOUND');

      const notBoolean = setup();
      await notBoolean.ingest(event({ fromMe: 'true' }));
      expect(notBoolean.messageCreated().direction).toBe('INBOUND');
    });

    it.each([
      ['api', 'api'],
      ['app', 'app'],
      [undefined, 'app'],
      ['web', 'app'],
    ])('stores source %s as %s', async (source, expected) => {
      const { ingest, messageCreated } = setup();

      await ingest(event({ source }));

      expect(messageCreated().source).toBe(expected);
    });

    it('caps a long body and keeps this boundary visible', async () => {
      const { ingest, messageCreated } = setup();

      await ingest(event({ body: 'x'.repeat(MAX_BODY_LENGTH + 100) }));

      expect((messageCreated().body as string).length).toBe(MAX_BODY_LENGTH);
    });

    it('trims the body', async () => {
      const { ingest, messageCreated } = setup();

      await ingest(event({ body: '   hola   ' }));

      expect(messageCreated().body).toBe('hola');
    });

    it.each([[42], [null], [undefined], [{ text: 'hola' }], [['hola']]])(
      'stores a non-string body (%s) as null',
      async (body) => {
        const { ingest, messageCreated } = setup();

        await ingest(event({ body }));

        expect(messageCreated().body).toBeNull();
      },
    );

    it('falls back to the current time when the timestamp is unusable', async () => {
      jest.useFakeTimers().setSystemTime(SENT_AT);
      try {
        const { ingest, messageCreated } = setup();

        await ingest(event({ timestamp: 'ayer' }));

        expect((messageCreated().sentAt as Date).getTime()).toBe(
          SENT_AT.getTime(),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('timing facts and state', () => {
    it('sets firstInboundAt on the first inbound and stays AUTOMATED', async () => {
      const { ingest, conversationUpdated } = setup();

      await ingest();

      const update = conversationUpdated();
      expect(update.firstInboundAt).toEqual(SENT_AT);
      expect(update.firstResponseAt).toBeNull();
      expect(update.lastMessageAt).toEqual(SENT_AT);
      expect(update).not.toHaveProperty('state');
    });

    it('keeps the existing firstInboundAt instead of moving it', async () => {
      const { ingest, conversationUpdated } = setup({
        firstInboundAt: EARLIER,
      });

      await ingest();

      expect(conversationUpdated().firstInboundAt).toEqual(EARLIER);
    });

    it('sets firstResponseAt for an api reply after the first inbound, never HUMAN', async () => {
      const { ingest, conversationUpdated } = setup({
        firstInboundAt: EARLIER,
      });

      await ingest(event({ fromMe: true, source: 'api' }));

      const update = conversationUpdated();
      expect(update.firstResponseAt).toEqual(SENT_AT);
      expect(update.lastMessageAt).toEqual(SENT_AT);
      expect(update).not.toHaveProperty('state');
    });

    it('does not answer before the client has written', async () => {
      const { ingest, conversationUpdated } = setup();

      await ingest(event({ fromMe: true, source: 'api' }));

      expect(conversationUpdated().firstResponseAt).toBeNull();
    });

    it('ignores a reply that was sent before the first inbound', async () => {
      const { ingest, conversationUpdated } = setup({
        firstInboundAt: new Date(SENT_AT.getTime() + 60_000),
      });

      await ingest(event({ fromMe: true, source: 'api' }));

      expect(conversationUpdated().firstResponseAt).toBeNull();
    });

    it('keeps firstResponseAt once it is set', async () => {
      const { ingest, conversationUpdated } = setup({
        firstInboundAt: EARLIER,
        firstResponseAt: EARLIER,
      });

      await ingest(event({ fromMe: true, source: 'api' }));

      expect(conversationUpdated().firstResponseAt).toEqual(EARLIER);
    });

    it('moves the conversation to HUMAN when the reply came from the phone', async () => {
      const { ingest, conversationUpdated } = setup({
        firstInboundAt: EARLIER,
      });

      await ingest(event({ fromMe: true, source: 'app' }));

      expect(conversationUpdated().state).toBe('HUMAN');
    });

    it('never changes the state on an inbound message', async () => {
      const { ingest, conversationUpdated } = setup({ state: 'HUMAN' });

      await ingest(event({ fromMe: false }));

      expect(conversationUpdated()).not.toHaveProperty('state');
    });
  });

  describe('rejected events', () => {
    it('records nothing for a message that is already stored', async () => {
      const { tx, ingest } = setup();
      const duplicate = Object.assign(new Error('unique'), { code: 'P2002' });
      tx.whatsAppMessage.create.mockRejectedValue(duplicate);

      await expect(ingest()).rejects.toBeInstanceOf(
        DuplicateWhatsAppMessageError,
      );
      expect(tx.whatsAppConversation.update).not.toHaveBeenCalled();
    });

    it('surfaces a storage failure that is not a duplicate', async () => {
      const { tx, ingest } = setup();
      tx.whatsAppMessage.create.mockRejectedValue(new Error('connection lost'));

      await expect(ingest()).rejects.toThrow('connection lost');
      expect(tx.whatsAppConversation.update).not.toHaveBeenCalled();
    });

    it.each([
      [undefined],
      [null],
      [''],
      ['   '],
      [42],
      ['@c.us'],
      ['120363000000000000@g.us'],
      ['status@broadcast'],
    ])('persists nothing for an unparseable sender (%s)', async (from) => {
      const { tx, ingest } = setup();

      await expect(ingest(event({ from }))).resolves.toBeUndefined();

      expect(tx.whatsAppInternalContact.findFirst).not.toHaveBeenCalled();
      expect(tx.customer.findFirst).not.toHaveBeenCalled();
      expect(tx.whatsAppConversation.upsert).not.toHaveBeenCalled();
      expect(tx.whatsAppMessage.create).not.toHaveBeenCalled();
      expect(tx.whatsAppConversation.update).not.toHaveBeenCalled();
    });
  });
});
