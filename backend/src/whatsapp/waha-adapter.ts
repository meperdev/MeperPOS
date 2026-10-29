import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { WhatsAppProvider } from './whatsapp-provider';

export interface WahaConfig {
  baseUrl: string;
  apiKey: string;
  webhookKey: string;
  webhookUrl: string;
}

type FailureReason =
  | 'missing_config'
  | 'request_failed'
  | 'provider_rejected'
  | 'invalid_response'
  | 'response_too_large';

class ResponseTooLarge extends Error {}

export class WahaAdapter implements WhatsAppProvider {
  private readonly logger = new Logger(WahaAdapter.name);

  constructor(private readonly config: WahaConfig) {}

  private failure(reason: FailureReason): ServiceUnavailableException {
    this.logger.warn({ event: 'waha_provider_failure', reason });
    return new ServiceUnavailableException('WhatsApp provider unavailable');
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
  ): Promise<Response> {
    const { baseUrl, apiKey, webhookKey, webhookUrl } = this.config;
    if (!baseUrl || !apiKey || !webhookKey || !webhookUrl)
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
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      return response;
    } catch {
      throw this.failure('request_failed');
    }
  }

  async connect(session: string): Promise<void> {
    const existing = await this.call(`/api/sessions/${session}`);
    this.discard(existing);
    if (existing.status === 404) {
      const created = await this.call('/api/sessions/', 'POST', {
        name: session,
        start: false,
        config: {
          webhooks: [
            {
              url: this.config.webhookUrl,
              events: ['message'],
              hmac: { key: this.config.webhookKey },
            },
          ],
        },
      });
      this.discard(created);
      if (!created.ok) throw this.failure('provider_rejected');
    } else if (!existing.ok) throw this.failure('provider_rejected');
    const started = await this.call(`/api/sessions/${session}/start`, 'POST');
    this.discard(started);
    if (!started.ok) throw this.failure('provider_rejected');
  }

  async status(session: string): Promise<{ status: string }> {
    const response = await this.call(`/api/sessions/${session}`);
    if (!response.ok) {
      this.discard(response);
      throw this.failure('provider_rejected');
    }
    try {
      const data: unknown = JSON.parse(
        (await this.readLimited(response, 64 * 1024)).toString('utf8'),
      );
      const status = (data as { status?: unknown })?.status;
      if (
        typeof status !== 'string' ||
        !['STOPPED', 'STARTING', 'SCAN_QR_CODE', 'WORKING', 'FAILED'].includes(
          status,
        )
      )
        throw new Error();
      return { status };
    } catch (error) {
      throw this.failure(
        error instanceof ResponseTooLarge
          ? 'response_too_large'
          : 'invalid_response',
      );
    }
  }

  async qr(session: string): Promise<{ data: string }> {
    const response = await this.call(
      `/api/${session}/auth/qr`,
      'GET',
      undefined,
      'image/png',
    );
    if (
      !response.ok ||
      !response.headers.get('content-type')?.startsWith('image/png') ||
      !response.body
    ) {
      this.discard(response);
      throw this.failure('provider_rejected');
    }
    try {
      return {
        data: (await this.readLimited(response, 1024 * 1024)).toString(
          'base64',
        ),
      };
    } catch (error) {
      throw this.failure(
        error instanceof ResponseTooLarge
          ? 'response_too_large'
          : 'invalid_response',
      );
    }
  }
}
