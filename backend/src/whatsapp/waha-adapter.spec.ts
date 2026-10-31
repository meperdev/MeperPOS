import { Logger } from '@nestjs/common';
import { WahaAdapter } from './waha-adapter';

describe('WahaAdapter', () => {
  const config = {
    baseUrl: 'http://waha:3000',
    apiKey: 'private-api-key',
    webhookUrl: 'https://example.test/api/whatsapp/webhook',
  };
  const webhookKey = 'private-webhook-key';
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });
  it.each(['baseUrl', 'apiKey', 'webhookUrl'] as const)(
    'fails closed without %s before sending any request',
    async (missing) => {
      global.fetch = jest.fn();
      const adapter = new WahaAdapter({ ...config, [missing]: '' });
      await expect(adapter.status('meper-abc')).rejects.toThrow();
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );
  it('sanitizes provider errors and never returns credentials', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('private-api-key private-webhook-key'));
    const adapter = new WahaAdapter(config);
    await expect(adapter.status('meper-abc')).rejects.toThrow(
      'WhatsApp provider unavailable',
    );
  });
  it('creates a tenant session with authenticated webhook before starting', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await new WahaAdapter(config).ensureStarted('meper-abc', webhookKey);
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls[1][0]).toBe('http://waha:3000/api/sessions/');
    expect(JSON.parse(calls[1][1].body)).toEqual({
      name: 'meper-abc',
      start: false,
      config: {
        webhooks: [
          {
            url: config.webhookUrl,
            events: ['message.any'],
            hmac: { key: webhookKey },
          },
        ],
      },
    });
    expect(calls[2][0]).toBe('http://waha:3000/api/sessions/meper-abc/start');
  });
  it.each([[404, 201, 200], [200, 200], [500], [404, 500], [200, 500]])(
    'cancels every connect response in sequence %s',
    async (...statuses: number[]) => {
      const cancels: jest.Mock[] = [];
      global.fetch = jest.fn();
      for (const status of statuses) {
        const cancel = jest.fn();
        cancels.push(cancel);
        const body = new ReadableStream<Uint8Array>({ cancel });
        (global.fetch as jest.Mock).mockResolvedValueOnce(
          new Response(body, { status }),
        );
      }
      const result = new WahaAdapter(config).ensureStarted(
        'meper-abc',
        webhookKey,
      );
      if (statuses.includes(500)) await expect(result).rejects.toThrow();
      else await expect(result).resolves.toBeUndefined();
      for (const cancel of cancels) expect(cancel).toHaveBeenCalledTimes(1);
    },
  );
  it('redacts a cancellation failure and still completes the request', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const body = new ReadableStream<Uint8Array>({
        cancel: () => Promise.reject(new Error('private-api-key secret-body')),
      });
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(new Response(body, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      await new WahaAdapter(config).ensureStarted('meper-abc', webhookKey);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(log).toHaveBeenCalledWith({
        event: 'waha_provider_failure',
        reason: 'cancel_failed',
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(
        /private-api-key|secret-body/,
      );
    } finally {
      log.mockRestore();
    }
  });
  it('does not wait for a stalled cancellation', async () => {
    const stalled = new ReadableStream<Uint8Array>({
      cancel: () => new Promise(() => undefined),
    });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(stalled, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(
      new WahaAdapter(config).ensureStarted('meper-abc', webhookKey),
    ).resolves.toBeUndefined();
  });
  it('rejects an oversized QR payload before reading more than the cap', async () => {
    const oversized = 'A'.repeat(1024 * 1024 + 4);
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ mimetype: 'image/png', data: oversized }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(new WahaAdapter(config).qr('meper-abc')).rejects.toThrow(
      'WhatsApp provider unavailable',
    );
  });
  it('handles a slow QR stream aborted by the request timeout', async () => {
    const abort = new AbortController();
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(abort.signal);
    try {
      global.fetch = jest
        .fn()
        .mockImplementation((_url, options: RequestInit) => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              options.signal?.addEventListener('abort', () =>
                controller.error(new Error('aborted')),
              );
            },
          });
          return Promise.resolve(
            new Response(body, {
              headers: { 'content-type': 'application/json' },
            }),
          );
        });
      const result = new WahaAdapter(config).qr('meper-abc');
      abort.abort();
      await expect(result).rejects.toThrow('WhatsApp provider unavailable');
      // The QR gets a longer budget than the default: WAHA spends the full 5 s
      // producing the image, which is what broke the deployed instance.
      expect(timeout).toHaveBeenCalledWith(20_000);
    } finally {
      timeout.mockRestore();
    }
  });
  it('returns QR image only and never returns provider metadata', async () => {
    const data = Buffer.from('fake-png').toString('base64');
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          mimetype: 'image/png',
          data: `data:image/png;base64,${data}`,
          engine: 'private-engine-metadata',
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(new WahaAdapter(config).qr('meper-abc')).resolves.toEqual({
      data,
    });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'http://waha:3000/api/meper-abc/auth/qr',
    );
  });
  it('keeps the short deadline for a status call', async () => {
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    try {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'WORKING' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await new WahaAdapter(config).status('meper-abc');
      expect(timeout).toHaveBeenCalledWith(5000);
    } finally {
      timeout.mockRestore();
    }
  });

  it('reports a never-created session as stopped instead of a provider fault', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(new WahaAdapter(config).status('meper-abc')).resolves.toEqual({
      status: 'STOPPED',
    });
  });

  it('rejects unexpected provider status instead of exposing arbitrary metadata', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'PRIVATE_API_KEY' }), {
        status: 200,
      }),
    );
    await expect(new WahaAdapter(config).status('meper-abc')).rejects.toThrow(
      'WhatsApp provider unavailable',
    );
  });
  it.each(['missing', 'lying'])(
    'rejects oversized chunked status with %s content length',
    async (lengthHeader) => {
      const headers =
        lengthHeader === 'lying' ? { 'content-length': '1' } : undefined;
      const chunk = new TextEncoder().encode(' '.repeat(40000));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.enqueue(new TextEncoder().encode('{"status":"WORKING"}'));
          controller.close();
        },
      });
      global.fetch = jest
        .fn()
        .mockResolvedValue(new Response(body, { status: 200, headers }));
      await expect(new WahaAdapter(config).status('meper-abc')).rejects.toThrow(
        'WhatsApp provider unavailable',
      );
    },
  );
  it('logs only a fixed reason for rejected provider responses', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      global.fetch = jest.fn().mockResolvedValue(
        new Response('private-api-key private-webhook-key secret-body', {
          status: 500,
        }),
      );
      await expect(new WahaAdapter(config).status('meper-abc')).rejects.toThrow(
        'WhatsApp provider unavailable',
      );
      expect(log).toHaveBeenCalledWith({
        event: 'waha_provider_failure',
        reason: 'provider_rejected',
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(
        /private-api-key|private-webhook-key|secret-body|meper-abc/,
      );
    } finally {
      log.mockRestore();
    }
  });
  it('logs a bounded diagnostic without provider errors, URLs, bodies or credentials', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      global.fetch = jest
        .fn()
        .mockRejectedValue(
          new Error(
            'private-api-key private-webhook-key https://example.test secret-body',
          ),
        );
      await expect(new WahaAdapter(config).status('meper-abc')).rejects.toThrow(
        'WhatsApp provider unavailable',
      );
      expect(log).toHaveBeenCalledWith({
        event: 'waha_provider_failure',
        reason: 'request_failed',
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(
        /private-api-key|private-webhook-key|https:|secret-body|meper-abc/,
      );
    } finally {
      log.mockRestore();
    }
  });
  it('uses API key and returns only status', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'WORKING',
          config: { secret: 'private-webhook-key' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const adapter = new WahaAdapter(config);
    await expect(adapter.status('meper-abc')).resolves.toEqual({
      status: 'WORKING',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://waha:3000/api/sessions/meper-abc',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Api-Key': 'private-api-key' }),
      }),
    );
  });
});
