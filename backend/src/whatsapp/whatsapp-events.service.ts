import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  WhatsAppAdminService,
  renderAdminReply,
} from './whatsapp-admin.service';
import {
  INTELLIGENCE_SESSION,
  WhatsAppConnectionsService,
} from './whatsapp-connections.service';
import { chatIdFor } from './whatsapp-delivery.service';
import {
  DuplicateWhatsAppMessageError,
  parseContactJid,
  WhatsAppIngestionService,
  type WhatsAppEventPayload,
} from './whatsapp-ingestion.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';
import {
  WHATSAPP_TEXT_SENDER,
  type WhatsAppTextSender,
} from './whatsapp-provider';

export type WhatsAppRoute = 'commercial' | 'intelligence';

export type WhatsAppDispatch =
  | { status: 'unknown_session' }
  | { status: 'unsupported_event' }
  | { status: 'ignored_non_conversational' }
  /**
   * The central channel received a chat it cannot identify as a telephone
   * number (WAHA's opaque `@lid` privacy identifier). Nothing was linked, read,
   * stored or sent: the digits of a LID are not a phone number and must never
   * be compared with one.
   */
  | { status: 'ignored_unverified_sender' }
  | { status: 'duplicate'; route: WhatsAppRoute }
  | {
      status: 'recorded';
      route: WhatsAppRoute;
      /** Present only when an inbound message redeemed a linking code. */
      identity?: 'linked';
      /**
       * Present only when an inbound text message on the central channel went
       * through the administrative gate: `answered` when a read-only tool
       * produced a figure, `refused` for every other outcome. This reports what
       * the gate resolved, not whether a text reply reached the phone: at most
       * one send is attempted after the receipt, with no delivery confirmation.
       */
      admin?: 'answered' | 'refused';
    };

/**
 * Events this stage understands. `message.any` reports every message creation,
 * including the replies an employee sends by hand from the phone.
 */
const SUPPORTED_EVENTS = new Set(['message.any']);

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'P2002';

@Injectable()
export class WhatsAppEventsService {
  private readonly logger = new Logger(WhatsAppEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: WhatsAppConnectionsService,
    private readonly ingestion: WhatsAppIngestionService,
    private readonly identity: WhatsAppIdentityService,
    private readonly admin: WhatsAppAdminService,
    @Inject(WHATSAPP_TEXT_SENDER)
    private readonly textSender: WhatsAppTextSender,
  ) {}

  /**
   * Resolve the channel from the persisted connection, never from the session
   * name alone, then deduplicate durably before anything acts on the event.
   * A commercial event is recorded in the same transaction as its receipt, so a
   * crash cannot leave it marked processed with nothing stored; the central
   * channel spends its receipt first and then, for a message the administrator
   * sends from her own phone, attempts the administrative link and, when the
   * sender is an authorized administrator, at most one deterministic text reply.
   * The central channel only ever acts on a real phone JID: an opaque `@lid` is
   * refused before the receipt, because it is not a number and must not be
   * matched against one.
   */
  async handle(
    sessionName: string,
    providerEventId: string,
    eventType: string,
    payload: WhatsAppEventPayload,
  ): Promise<WhatsAppDispatch> {
    const connection = await this.connections.findBySessionName(sessionName);
    if (!connection) {
      this.logger.warn({ event: 'whatsapp_event', outcome: 'unknown_session' });
      return { status: 'unknown_session' };
    }

    const route: WhatsAppRoute =
      connection.channel === 'COMMERCIAL' ? 'commercial' : 'intelligence';

    if (!SUPPORTED_EVENTS.has(eventType)) {
      return { status: 'unsupported_event' };
    }

    // A group chat or an id we cannot classify is not a conversation with one
    // person. This check sits before both the receipt and the transaction on
    // purpose: group traffic must not fill the deduplication table, must not
    // create a conversation, and is never logged with its identifier.
    const sender = parseContactJid(payload.from);
    if (!sender || (sender.kind !== 'phone' && sender.kind !== 'lid')) {
      this.logger.warn({
        event: 'whatsapp_event',
        outcome: 'ignored_non_conversational',
      });
      return { status: 'ignored_non_conversational' };
    }

    // The central channel acts on *who the sender is*: it links an identity to
    // the sender's number and then reads that identity's organization. WAHA also
    // reports a privacy identifier (`@lid`) whose digits are opaque — they are
    // not a telephone number and can coincide with a verified phone, so treating
    // one as a number would let an unrelated sender inherit that identity. Until
    // a trustworthy LID-to-phone mapping exists, an opaque sender is refused
    // here, before the receipt: it cannot link, cannot reach the administrative
    // gate, cannot cause a read and cannot receive text or a document. The
    // commercial channel is untouched, because it stores a LID as its own
    // opaque conversation key and never matches it against a phone.
    if (route === 'intelligence' && sender.kind !== 'phone') {
      this.logger.warn({
        event: 'whatsapp_event',
        outcome: 'unverified_sender',
      });
      return { status: 'ignored_unverified_sender' };
    }

    if (route === 'intelligence') {
      try {
        await this.prisma.whatsAppProcessedEvent.create({
          data: {
            connectionId: connection.id,
            providerEventId,
            eventType,
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        this.logger.warn({ event: 'whatsapp_event', outcome: 'duplicate' });
        return { status: 'duplicate', route };
      }
      // The receipt is committed, so this event is spent: nothing below can
      // cause a redelivery and nothing below is retried.
      if (await this.linkIdentity(payload)) {
        return { status: 'recorded', route, identity: 'linked' };
      }

      const admin = await this.answerAdministrativeQuery(payload);
      return admin
        ? { status: 'recorded', route, admin }
        : { status: 'recorded', route };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.whatsAppProcessedEvent.create({
          data: {
            connectionId: connection.id,
            providerEventId,
            eventType,
          },
        });
        await this.ingestion.ingest(tx, connection, {
          providerMessageId: providerEventId,
          payload,
        });
      });
    } catch (error) {
      if (error instanceof DuplicateWhatsAppMessageError) {
        // The transaction rolled back, so nothing was recorded for this receipt.
        this.logger.warn({
          event: 'whatsapp_event',
          outcome: 'duplicate_message',
        });
        return { status: 'duplicate', route };
      }
      if (!isUniqueViolation(error)) throw error;
      this.logger.warn({ event: 'whatsapp_event', outcome: 'duplicate' });
      return { status: 'duplicate', route };
    }

    return { status: 'recorded', route };
  }

  /**
   * The text an inbound message carries, with the sender reduced to the digits
   * the identity table stores. Everything the central channel does with a body
   * starts from this one boundary, so linking and the administrative gate can
   * never disagree about what counts as an inbound text message.
   *
   * Only a phone JID produces a number here. The route gate above already
   * refuses an opaque `@lid` before it can reach this method, and repeating the
   * rule here is what keeps the two from ever drifting apart: a LID's digits are
   * an opaque identifier, so a caller must not be able to hand them to the
   * identity table or to the administrative gate as if they were a phone.
   */
  private inboundText(
    payload: WhatsAppEventPayload,
  ): { phone: string; text: string } | null {
    // `fromMe` is the same boundary ingestion uses: only an inbound message can
    // carry a code or a question, so our own outbound traffic can never link a
    // number and can never be treated as an instruction.
    if (payload.fromMe === true) return null;
    if (typeof payload.body !== 'string') return null;
    const text = payload.body.trim();
    if (text.length === 0) return null;
    const sender = parseContactJid(payload.from);
    if (!sender || sender.kind !== 'phone') return null;
    return { phone: sender.digits, text };
  }

  /**
   * Administrative linking happens only on the central channel, only for a
   * message the administrator sent from her own phone, and only when the body is
   * text that could be a code. A phone on its own links nothing: the code has to
   * match an unconsumed challenge issued to an authenticated user.
   */
  private async linkIdentity(payload: WhatsAppEventPayload): Promise<boolean> {
    const inbound = this.inboundText(payload);
    if (!inbound) return false;

    try {
      return (
        (await this.identity.consume(inbound.phone, inbound.text)) !== null
      );
    } catch (error) {
      // The event itself was recorded; a linking failure must not turn it into an
      // error the provider redelivers forever. Nothing about the code, its hash,
      // the phone or the identity reaches the log.
      this.logger.warn({
        event: 'whatsapp_identity',
        outcome: 'link_error',
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return false;
    }
  }

  /**
   * The administrative gate: identify the sender, then answer one message from
   * the closed read-only allowlist. It runs only for an inbound text message on
   * the central channel that did not just link an identity, and it can only
   * read: `WhatsAppAdminService` reaches no mutation.
   *
   * Delivery is bound to the same gate. Only an authorized sender receives the
   * rendered reply, and only at the sender's own verified number: an `unlinked`
   * or `forbidden` phone gets silence, because any text back would confirm that
   * the number is registered. The answer resolves the query and the reply sends
   * its text; the PDF command is not rendered at all, so the document flow stays
   * its single side effect.
   *
   * Nothing this method does may fail the webhook. The receipt is already
   * committed, so an error escaping here would ask the provider to redeliver an
   * event that is already marked processed. A failed query is reported as a
   * refusal, and a failed send is logged and left alone: there is exactly one
   * attempt after the claim, so a crash between receipt and send loses the reply
   * rather than duplicating it. This is at most once, never exactly once. The
   * warning and the send log carry no phone, no body and no figure.
   */
  private async answerAdministrativeQuery(
    payload: WhatsAppEventPayload,
  ): Promise<'answered' | 'refused' | null> {
    const inbound = this.inboundText(payload);
    if (!inbound) return null;

    try {
      const context = await this.admin.authorize(inbound.phone);
      const answer = await this.admin.answer(context, inbound.text);
      if (context.status === 'authorized') {
        const reply = renderAdminReply(answer);
        if (reply) await this.deliverReply(context.phone, reply);
      }
      return answer.status === 'answered' ? 'answered' : 'refused';
    } catch (error) {
      this.logger.warn({
        event: 'whatsapp_admin',
        outcome: 'gate_error',
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return 'refused';
    }
  }

  /**
   * One best-effort text send to the sender's own number.
   *
   * The destination is derived from the verified phone, never from the message
   * body, and the session is the fixed central one. A provider refusal or an
   * unexpected transport error is a warning with a fixed outcome and the error
   * name only; it never becomes an exception, because the event receipt is
   * already spent and a retry would duplicate a message that may have left.
   */
  private async deliverReply(phone: string, text: string): Promise<void> {
    const chatId = chatIdFor(phone);
    if (!chatId) return;
    try {
      await this.textSender.sendText(INTELLIGENCE_SESSION, { chatId, text });
      this.logger.log({ event: 'whatsapp_admin', outcome: 'reply_sent' });
    } catch (error) {
      this.logger.warn({
        event: 'whatsapp_admin',
        outcome: 'reply_failed',
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}
