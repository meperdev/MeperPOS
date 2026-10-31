import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppConnectionsService } from './whatsapp-connections.service';
import {
  DuplicateWhatsAppMessageError,
  WhatsAppIngestionService,
  type WhatsAppEventPayload,
} from './whatsapp-ingestion.service';

export type WhatsAppRoute = 'commercial' | 'intelligence';

export type WhatsAppDispatch =
  | { status: 'unknown_session' }
  | { status: 'unsupported_event' }
  | { status: 'duplicate'; route: WhatsAppRoute }
  | { status: 'recorded'; route: WhatsAppRoute };

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
  ) {}

  /**
   * Resolve the channel from the persisted connection, never from the session
   * name alone, then deduplicate durably before anything acts on the event.
   * A commercial event is recorded in the same transaction as its receipt, so a
   * crash cannot leave it marked processed with nothing stored; the central
   * channel has no handler yet and only spends its deduplication row.
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
      return { status: 'recorded', route };
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
}
