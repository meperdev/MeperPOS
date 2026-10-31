import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  isWhatsAppSessionStatus,
  type WhatsAppFileMessage,
  type WhatsAppFileSender,
  type WhatsAppProvider,
  type WhatsAppSessionStatus,
} from './whatsapp-provider';

export interface WahaConfig {
  baseUrl: string;
  apiKey: string;
  webhookUrl: string;
}

type FailureReason =
  | 'missing_config'
  | 'invalid_session'
  | 'request_failed'
  | 'provider_rejected'
  | 'invalid_response'
  | 'response_too_large';

class ResponseTooLarge extends Error {}

/** Marks a body that arrived but could not be read as the documented shape. */
class InvalidResponse extends Error {}

/** Session names come from our own records; reject anything that could reshape a URL. */
const SESSION_NAME = /^[A-Za-z0-9_-]{1,64}$/;

const STATUS_LIMIT = 64 * 1024;
const ME_LIMIT = 16 * 1024;
const SEND_LIMIT = 16 * 1024;
const QR_JSON_LIMIT = 2 * 1024 * 1024;
const QR_BASE64_LIMIT = 1024 * 1024;
/** Default deadline for a provider call. */
const CALL_TIMEOUT_MS = 5_000;
/**
 * WAHA blocks while the engine produces the image and routinely uses the whole
 * default budget, so the QR gets its own, longer deadline. Measured against the
 * deployed instance: 4.993-5.000 s per request, which the old 5 s budget cut
 * exactly at the finish line.
 */
const QR_TIMEOUT_MS = 20_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export class WahaAdapter implements WhatsAppProvider, WhatsAppFileSender {
  private readonly logger = new Logger(WahaAdapter.name);

  constructor(private readonly config: WahaConfig) {}

  private failure(reason: FailureReason): ServiceUnavailableException {
    this.logger.warn({ event: 'waha_provider_failure', reason });
    return new ServiceUnavailableException('WhatsApp provider unavailable');
  }

  private sessionPath(session: string, suffix = ''): string {
    if (!SESSION_NAME.test(session)) throw this.failure('invalid_session');
    return `/api/sessions/${session}${suffix}`;
  }

  private discard(response: Response): void {
    if (response.body) {
      void response.body.cancel().catch(() => {
        this.logger.warn({
          event: 'waha_provider_failure',
          reason: 'cancel_failed',
        });
      });
    }
  }

  private async readLimited(
    response: Response,
    limit: number,
  ): Promise<Buffer> {
    if (!response.body) throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) return Buffer.concat(chunks, length);
      length += item.value.length;
      if (length > limit) {
        void reader.cancel().catch(() => undefined);
        throw new ResponseTooLarge();
      }
      chunks.push(item.value);
    }
  }

  private async call(
    path: string,
    method = 'GET',
    body?: unknown,
    accept = 'application/json',
    timeoutMs = CALL_TIMEOUT_MS,
  ): Promise<Response> {
    const { baseUrl, apiKey, webhookUrl } = this.config;
    if (!baseUrl || !apiKey || !webhookUrl)
      throw this.failure('missing_config');
    try {
      const base = new URL(baseUrl);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash
      )
        throw new Error();
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          'X-Api-Key': apiKey,
          Accept: accept,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
      return response;
    } catch {
      throw this.failure('request_failed');
    }
  }

  /** Issue an authenticated write and drop the body without reading it. */
  private async act(
    path: string,
    method = 'POST',
    body?: unknown,
  ): Promise<void> {
    const response = await this.call(path, method, body);
    this.discard(response);
    if (!response.ok) throw this.failure('provider_rejected');
  }

  private async readJson(response: Response, limit: number): Promise<unknown> {
    const text = (await this.readLimited(response, limit)).toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      throw new InvalidResponse();
    }
  }

  async ensureStarted(session: string, webhookKey: string): Promise<void> {
    if (!webhookKey) throw this.failure('missing_config');
    const path = this.sessionPath(session);
    const existing = await this.call(path);
    this.discard(existing);
    if (existing.status === 404) {
      const created = await this.call('/api/sessions/', 'POST', {
        name: session,
        start: false,
        config: {
          webhooks: [
            {
              url: this.config.webhookUrl,
              // `message.any` also reports messages an employee sends by hand
              // from the phone, which `message` alone does not.
              events: ['message.any'],
              hmac: { key: webhookKey },
            },
          ],
        },
      });
      this.discard(created);
      if (!created.ok) throw this.failure('provider_rejected');
    } else if (!existing.ok) throw this.failure('provider_rejected');
    await this.start(session);
  }

  start(session: string): Promise<void> {
    return this.act(this.sessionPath(session, '/start'));
  }

  stop(session: string): Promise<void> {
    return this.act(this.sessionPath(session, '/stop'));
  }

  restart(session: string): Promise<void> {
    return this.act(this.sessionPath(session, '/restart'));
  }

  logout(session: string): Promise<void> {
    this.sessionPath(session);
    return this.act('/api/sessions/logout', 'POST', { name: session });
  }

  remove(session: string): Promise<void> {
    return this.act(this.sessionPath(session), 'DELETE');
  }

  async status(session: string): Promise<{ status: WhatsAppSessionStatus }> {
    const response = await this.call(this.sessionPath(session));
    if (response.status === 404) {
      // The session was never created on the provider. That is the initial
      // state of a channel, not a provider fault: report nothing running so a
      // freshly opened screen can offer the connect action.
      this.discard(response);
      return { status: 'STOPPED' };
    }
    if (!response.ok) {
      this.discard(response);
      throw this.failure('provider_rejected');
    }
    try {
      const data = await this.readJson(response, STATUS_LIMIT);
      const status = (data as { status?: unknown })?.status;
      if (!isWhatsAppSessionStatus(status)) throw new Error();
      return { status };
    } catch (error) {
      throw this.failure(
        error instanceof ResponseTooLarge
          ? 'response_too_large'
          : 'invalid_response',
      );
    }
  }

  /**
   * WAHA's sessions page documents `POST /api/{session}/auth/qr` in its feature
   * table but shows `GET` with `Accept: application/json` returning
   * `{ mimetype, data }` in the detailed section. GET plus JSON is the form the
   * installed version must confirm; a mismatch surfaces as a provider failure.
   */
  async qr(session: string): Promise<{ data: string }> {
    if (!SESSION_NAME.test(session)) throw this.failure('invalid_session');
    const response = await this.call(
      `/api/${session}/auth/qr`,
      'GET',
      undefined,
      'application/json',
      QR_TIMEOUT_MS,
    );
    if (!response.ok) {
      this.discard(response);
      throw this.failure('provider_rejected');
    }
    try {
      const parsed = await this.readJson(response, QR_JSON_LIMIT);
      const raw = (parsed as { data?: unknown })?.data;
      if (typeof raw !== 'string') throw new Error();
      const data = raw.replace(/^data:[^;,]*;base64,/, '');
      if (!BASE64.test(data) || data.length > QR_BASE64_LIMIT)
        throw new Error();
      return { data };
    } catch (error) {
      throw this.failure(
        error instanceof ResponseTooLarge
          ? 'response_too_large'
          : 'invalid_response',
      );
    }
  }

  async me(session: string): Promise<{ accountId: string | null }> {
    const response = await this.call(this.sessionPath(session, '/me'));
    if (!response.ok) {
      this.discard(response);
      throw this.failure('provider_rejected');
    }
    try {
      const parsed = await this.readJson(response, ME_LIMIT);
      const id = (parsed as { id?: unknown })?.id;
      if (id === null || id === undefined) return { accountId: null };
      if (typeof id !== 'string') throw new Error();
      return { accountId: id };
    } catch (error) {
      throw this.failure(
        error instanceof ResponseTooLarge
          ? 'response_too_large'
          : 'invalid_response',
      );
    }
  }

  /**
   * Deliver one document into an existing chat.
   *
   * WAHA documents `POST /api/sendFile` with the session named in the body and
   * the payload as `{ session, chatId, file: { mimetype, filename, data } }`,
   * where `data` is raw base64 without a `data:` prefix. Those four field names,
   * the instance-level path (not `/api/{session}/...`) and reading the message id
   * from the `id` property are the parts most likely to differ in the installed
   * WAHA version; a mismatch surfaces as `503 WhatsApp provider unavailable`
   * instead of a silent drop.
   *
   * A non-2xx response is `provider_rejected` and its body is discarded unread,
   * so no provider text, URL, session name or credential can reach a caller or a
   * log line. A 2xx whose body cannot be read is still a delivered document: the
   * message id is reported as absent rather than turned into a failure the
   * caller would retry.
   */
  async sendFile(
    session: string,
    file: WhatsAppFileMessage,
  ): Promise<{ providerMessageId: string | null }> {
    if (!SESSION_NAME.test(session)) throw this.failure('invalid_session');
    const response = await this.call('/api/sendFile', 'POST', {
      session,
      chatId: file.chatId,
      file: {
        mimetype: file.mimetype,
        filename: file.filename,
        data: file.base64,
      },
    });
    if (!response.ok) {
      this.discard(response);
      throw this.failure('provider_rejected');
    }
    try {
      const parsed = await this.readJson(response, SEND_LIMIT);
      const id = (parsed as { id?: unknown })?.id;
      return { providerMessageId: typeof id === 'string' && id ? id : null };
    } catch {
      return { providerMessageId: null };
    }
  }
}
