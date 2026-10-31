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

/** JIDs the provider uses for a person; anything else is not a contact. */
const KNOWN_SUFFIXES = ['@c.us', '@s.whatsapp.net', '@lid'];

/** Matches the column width the migration declares for a text body. */
export const MAX_BODY_LENGTH = 4096;

const EPOCH_SECONDS = 1000;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'P2002';

/**
 * Reduce a provider JID to the digits we can compare against a stored phone.
 * A group, a broadcast list or anything without digits cannot be a contact and
 * yields null so the event is ignored instead of becoming a bogus conversation.
 */
export function normaliseContactPhone(from: unknown): string | null {
  if (typeof from !== 'string') return null;
  const value = from.trim();
  if (value.length === 0) return null;

  const separator = value.indexOf('@');
  const local = separator === -1 ? value : value.slice(0, separator);
  if (
    separator !== -1 &&
    !KNOWN_SUFFIXES.includes(value.slice(separator).toLowerCase())
  ) {
    return null;
  }

  const digits = local.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

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
    const contactPhone = normaliseContactPhone(event.payload.from);
    if (!contactPhone) {
      // No phone, no conversation: an unusable sender is not a contact.
      this.logger.warn({
        event: 'whatsapp_ingestion',
        outcome: 'unparseable_contact',
      });
      return;
    }

    const { contactKind, customerId } = await this.resolveContact(
      tx,
      connection.organizationId,
      contactPhone,
    );

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
        contactPhone,
        contactKind,
        ...(customerId === null ? {} : { customerId }),
      },
      update: {},
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
