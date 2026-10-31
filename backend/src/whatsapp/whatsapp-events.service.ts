import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppAdminService } from './whatsapp-admin.service';
import { WhatsAppConnectionsService } from './whatsapp-connections.service';
import {
  DuplicateWhatsAppMessageError,
  normaliseContactPhone,
  WhatsAppIngestionService,
  type WhatsAppEventPayload,
} from './whatsapp-ingestion.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';

export type WhatsAppRoute = 'commercial' | 'intelligence';

export type WhatsAppDispatch =
  | { status: 'unknown_session' }
  | { status: 'unsupported_event' }
  | { status: 'duplicate'; route: WhatsAppRoute }
  | {
      status: 'recorded';
      route: WhatsAppRoute;
      /** Present only when an inbound message redeemed a linking code. */
      identity?: 'linked';
      /**
       * Present only when an inbound text message on the central channel went
       * through the administrative gate: `answered` when a read-only tool
       * produced a figure, `refused` for every other outcome.
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
  ) {}

  /**
   * Resolve the channel from the persisted connection, never from the session
   * name alone, then deduplicate durably before anything acts on the event.
   * A commercial event is recorded in the same transaction as its receipt, so a
   * crash cannot leave it marked processed with nothing stored; the central
   * channel spends its receipt first and then, for a message the administrator
   * sends from her own phone, attempts the administrative link.
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
    const phone = normaliseContactPhone(payload.from);
    if (!phone) return null;
    return { phone, text };
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
   * read: `WhatsAppAdminService` reaches no mutation, and no answer is delivered
   * here — this resolves the answer, a later transport sends it.
   *
   * Nothing this method does may fail the webhook. The receipt is already
   * committed, so an error escaping here would ask the provider to redeliver an
   * event that is already marked processed; a failure is therefore reported as
   * a refusal, which is also exactly what an unauthorized sender gets. The
   * warning carries no phone, no body and no figure.
   */
  private async answerAdministrativeQuery(
    payload: WhatsAppEventPayload,
  ): Promise<'answered' | 'refused' | null> {
    const inbound = this.inboundText(payload);
    if (!inbound) return null;

    try {
      const context = await this.admin.authorize(inbound.phone);
      const answer = await this.admin.answer(context, inbound.text);
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
}
