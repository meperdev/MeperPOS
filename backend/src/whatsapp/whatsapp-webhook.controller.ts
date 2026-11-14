import {
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { deriveWebhookKey, verifyWahaSignature } from './waha-signature';
import { WhatsAppEventsService } from './whatsapp-events.service';
import type { WhatsAppEventPayload } from './whatsapp-ingestion.service';

export const WAHA_WEBHOOK_KEY = Symbol('WAHA_WEBHOOK_KEY');

const MAX_BODY_BYTES = 256 * 1024;
const SESSION_NAME = /^[A-Za-z0-9_-]{1,64}$/;

interface Envelope {
  session: string;
  event: string;
  providerEventId: string | null;
  payload: WhatsAppEventPayload;
}

/**
 * Read the routing envelope plus the five message fields ingestion reads, and
 * nothing else: the provider payload is never forwarded as a whole. The session
 * name is read before verification because it selects the key, but it is not
 * trusted until the HMAC over the exact bytes passes: a body naming another
 * session derives another key and fails. A missing id cannot be deduplicated
 * and is dropped without effect.
 */
function readEnvelope(body: Buffer): Envelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { session, event, payload } = parsed as {
    session?: unknown;
    event?: unknown;
    payload?: unknown;
  };
  if (typeof session !== 'string' || !SESSION_NAME.test(session)) return null;
  if (typeof event !== 'string' || event.length === 0) return null;
  const fields =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const id = fields.id;
  return {
    session,
    event,
    providerEventId: typeof id === 'string' && id !== '' ? id : null,
    payload: {
      from: fields.from,
      fromMe: fields.fromMe,
      source: fields.source,
      body: fields.body,
      timestamp: fields.timestamp,
    },
  };
}

@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  constructor(
    @Inject(WAHA_WEBHOOK_KEY) private readonly masterKey: string | undefined,
    private readonly events: WhatsAppEventsService,
  ) {}

  @Post()
  @HttpCode(204)
  async receive(@Req() request: RawBodyRequest<Request>): Promise<void> {
    if (request.path !== '/api/whatsapp/webhook') {
      throw new UnauthorizedException();
    }
    const body = request.rawBody;
    if (
      !Buffer.isBuffer(body) ||
      body.length === 0 ||
      body.length > MAX_BODY_BYTES
    ) {
      throw new UnauthorizedException();
    }
    const envelope = readEnvelope(body);
    if (!envelope) throw new UnauthorizedException();

    const key = deriveWebhookKey(this.masterKey, envelope.session);
    if (
      !verifyWahaSignature(
        body,
        key ?? undefined,
        request.headers['x-webhook-hmac'],
        request.headers['x-webhook-hmac-algorithm'],
      )
    ) {
      throw new UnauthorizedException();
    }

    if (!envelope.providerEventId) return;
    await this.events.handle(
      envelope.session,
      envelope.providerEventId,
      envelope.event,
      envelope.payload,
    );
  }
}
