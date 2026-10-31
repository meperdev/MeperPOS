import { Injectable, Logger } from '@nestjs/common';
import type {
  Prisma,
  WhatsAppConnection,
  WhatsAppContactKind,
  WhatsAppMessageDirection,
} from '@prisma/client';

/**
 * The only fields of a provider message this stage reads. The webhook fills this
 * object field by field, so the provider payload itself never travels further.
 */
export interface WhatsAppEventPayload {
  from?: unknown;
  fromMe?: unknown;
  source?: unknown;
  body?: unknown;
  timestamp?: unknown;
}

/** One authenticated commercial event, already deduplicated by its envelope id. */
export interface WhatsAppEvent {
  providerMessageId: string;
  payload: WhatsAppEventPayload;
}

/**
 * The provider message is already stored. Thrown so the surrounding transaction
 * rolls back: the receipt must not be committed for work that was not done.
 */
export class DuplicateWhatsAppMessageError extends Error {
  constructor() {
    super('duplicate whatsapp message');
  }
}

/** The provider chat-id families this stage can distinguish. */
export type WhatsAppContactJidKind = 'phone' | 'lid' | 'group' | 'unknown';

/** A provider chat id reduced to what the row needs to store. */
export interface WhatsAppContactJid {
  /** The raw id exactly as received, trimmed; never rewritten. */
  jid: string;
  /** Digits from the local part; empty for an id that carries none. */
  digits: string;
  kind: WhatsAppContactJidKind;
}

const PHONE_SUFFIXES = ['@c.us', '@s.whatsapp.net'];

/**
 * Parse the provider's chat id without losing what kind of chat it is. A phone
 * (`@c.us`, `@s.whatsapp.net` or a bare number) is the only kind that can be
 * matched against a stored phone; `@lid` is an opaque privacy identifier, a
 * group (`@g.us`) is not a conversation with one person, and everything else is
 * unknown. An id with no digits is always unknown, whatever its suffix says.
 */
export function parseContactJid(from: unknown): WhatsAppContactJid | null {
  if (typeof from !== 'string') return null;
  const jid = from.trim();
  if (jid.length === 0) return null;

  const separator = jid.indexOf('@');
  const local = separator === -1 ? jid : jid.slice(0, separator);
  const suffix = separator === -1 ? '' : jid.slice(separator).toLowerCase();
  const digits = local.replace(/\D/g, '');

  if (digits.length === 0) return { jid, digits, kind: 'unknown' };
  if (suffix === '' || PHONE_SUFFIXES.includes(suffix)) {
    return { jid, digits, kind: 'phone' };
  }
  if (suffix === '@lid') return { jid, digits, kind: 'lid' };
  if (suffix === '@g.us') return { jid, digits, kind: 'group' };
  return { jid, digits, kind: 'unknown' };
}

/**
 * Reduce a JID to the digits an existing phone-keyed column stores. Kept for the
 * callers that only need that reduction (administrative identity and delivery);
 * ingestion uses `parseContactJid` so a LID is never mistaken for a phone.
 * Groups and unknown families still yield null, exactly as before.
 */
export function normaliseContactPhone(from: unknown): string | null {
  const parsed = parseContactJid(from);
  if (!parsed) return null;
  if (parsed.kind !== 'phone' && parsed.kind !== 'lid') return null;
  return parsed.digits;
}

/** Matches the column width the migration declares for a text body. */
export const MAX_BODY_LENGTH = 4096;

const EPOCH_SECONDS = 1000;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'P2002';

/** The provider reports seconds; anything unusable falls back to the receipt time. */
function resolveSentAt(timestamp: unknown): Date {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return new Date();
  }
  if (timestamp <= 0) return new Date();
  return new Date(Math.trunc(timestamp) * EPOCH_SECONDS);
}

function resolveBody(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  return body.trim().slice(0, MAX_BODY_LENGTH);
}

/**
 * Records a commercial conversation event. Everything here runs on the caller's
 * transaction client so the ordinary event receipt and this record commit or
 * roll back together. Nothing is sent: this stage records and classifies.
 */
@Injectable()
export class WhatsAppIngestionService {
  private readonly logger = new Logger(WhatsAppIngestionService.name);

  async ingest(
    tx: Prisma.TransactionClient,
    connection: Pick<WhatsAppConnection, 'id' | 'organizationId'>,
    event: WhatsAppEvent,
  ): Promise<void> {
    const sender = parseContactJid(event.payload.from);
    if (!sender || (sender.kind !== 'phone' && sender.kind !== 'lid')) {
      // A group, a broadcast list or an unusable id is not a conversation.
      // Non-conversational traffic is normally rejected before the transaction
      // in WhatsAppEventsService; this is the last line of defence.
      this.logger.warn({
        event: 'whatsapp_ingestion',
        outcome: 'unparseable_contact',
      });
      return;
    }

    // For a phone this is the number; for a LID it is the opaque identifier and
    // must never be compared with a stored phone.
    const contactPhone = sender.digits;
    const { contactKind, customerId } =
      sender.kind === 'phone'
        ? await this.resolveContact(tx, connection.organizationId, contactPhone)
        : // A LID is never a customer and never an internal contact.
          { contactKind: 'UNKNOWN' as const, customerId: null };

    const conversation = await tx.whatsAppConversation.upsert({
      where: {
        connectionId_contactPhone: {
          connectionId: connection.id,
          contactPhone,
        },
      },
      create: {
        connectionId: connection.id,
        organizationId: connection.organizationId,
        contactJid: sender.jid,
        contactPhone,
        contactKind,
        ...(customerId === null ? {} : { customerId }),
      },
      // Reconcile rows written before the raw id was stored.
      update: { contactJid: sender.jid },
    });

    const fromMe = event.payload.fromMe === true;
    const direction: WhatsAppMessageDirection = fromMe ? 'OUTBOUND' : 'INBOUND';
    // Only a message the provider reports as sent through its API is 'api';
    // everything else was typed on the phone.
    const source = event.payload.source === 'api' ? 'api' : 'app';
    const sentAt = resolveSentAt(event.payload.timestamp);

    try {
      await tx.whatsAppMessage.create({
        data: {
          conversationId: conversation.id,
          providerMessageId: event.providerMessageId,
          direction,
          source,
          body: resolveBody(event.payload.body),
          sentAt,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The only unique key this insert can break besides its own id is
      // conversationId+providerMessageId: this message is already stored.
      throw new DuplicateWhatsAppMessageError();
    }

    // Timing facts are derived from what is already stored plus this message, so
    // a replayed message cannot move them.
    const firstInboundAt =
      conversation.firstInboundAt ?? (direction === 'INBOUND' ? sentAt : null);
    const firstResponseAt =
      conversation.firstResponseAt ??
      (direction === 'OUTBOUND' &&
      firstInboundAt !== null &&
      sentAt.getTime() >= firstInboundAt.getTime()
        ? sentAt
        : null);

    await tx.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        firstInboundAt,
        firstResponseAt,
        lastMessageAt: sentAt,
        // A reply typed on the phone is human intervention; inbound messages
        // never change the state.
        ...(direction === 'OUTBOUND' && source === 'app'
          ? { state: 'HUMAN' as const }
          : {}),
      },
    });
  }

  /**
   * Internal first, then a known customer, then unknown. An internal number is
   * never treated as a client even when the same phone is also a customer.
   */
  private async resolveContact(
    tx: Prisma.TransactionClient,
    organizationId: string | null,
    contactPhone: string,
  ): Promise<{ contactKind: WhatsAppContactKind; customerId: string | null }> {
    if (!organizationId) {
      // A connection without an organization has nothing to classify against.
      return { contactKind: 'UNKNOWN', customerId: null };
    }

    const internal = await tx.whatsAppInternalContact.findFirst({
      where: { organizationId, phone: contactPhone },
      select: { id: true },
    });
    if (internal) return { contactKind: 'INTERNAL', customerId: null };

    const customer = await tx.customer.findFirst({
      where: { organizationId, phone: contactPhone },
      select: { id: true },
    });
    if (customer) return { contactKind: 'CLIENT', customerId: customer.id };

    return { contactKind: 'UNKNOWN', customerId: null };
  }
}
