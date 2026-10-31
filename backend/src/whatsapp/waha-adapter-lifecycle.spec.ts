import { Logger } from '@nestjs/common';
import { WahaAdapter } from './waha-adapter';

const reportFile = {
  chatId: '573001112233@c.us',
  filename: 'reporte-diario-2026-03-03.pdf',
  mimetype: 'application/pdf',
  base64: 'JVBERi0xLjQKJSVFT0YK',
};

describe('WahaAdapter lifecycle', () => {
  const config = {
    baseUrl: 'http://waha:3000',
    apiKey: 'private-api-key',
    webhookUrl: 'https://example.test/api/whatsapp/webhook',
  };
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });
  const writes = ['start', 'stop', 'restart', 'logout', 'remove'] as const;

  it.each([
    ['start', 'start'],
    ['stop', 'stop'],
    ['restart', 'restart'],
  ] as const)('%s posts to the session %s endpoint', async (method, action) => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    await new WahaAdapter(config)[method]('meper-abc');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`http://waha:3000/api/sessions/meper-abc/${action}`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });
  it('logs out through the instance endpoint naming the session in the body', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    await new WahaAdapter(config).logout('meper-abc');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://waha:3000/api/sessions/logout');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'meper-abc' });
  });
  it('removes the session with DELETE on its own resource', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    await new WahaAdapter(config).remove('meper-abc');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://waha:3000/api/sessions/meper-abc');
    expect(init.method).toBe('DELETE');
  });
  it('returns only the linked account id', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '573001112233@c.us',
          pushName: 'private-profile-metadata',
        }),
        { status: 200 },
      ),
    );
    await expect(new WahaAdapter(config).me('meper-abc')).resolves.toEqual({
      accountId: '573001112233@c.us',
    });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'http://waha:3000/api/sessions/meper-abc/me',
    );
  });
  it('maps a missing provider account id to null', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: null }), { status: 200 }),
      );
    await expect(new WahaAdapter(config).me('meper-abc')).resolves.toEqual({
      accountId: null,
    });
  });
  it.each([
    'SCAN_QR_CODE',
    'PASSKEY_REQUIRED',
    'PASSKEY_CONFIRMATION_REQUIRED',
  ] as const)('accepts the %s status', async (status) => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status, config: {} }), { status: 200 }),
      );
    await expect(new WahaAdapter(config).status('meper-abc')).resolves.toEqual({
      status,
    });
  });
  it.each(writes)(
    'rejects a non-2xx %s and logs only a fixed reason',
    async (method) => {
      const log = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        global.fetch = jest.fn().mockResolvedValue(
          new Response('private-api-key private-webhook-key secret-body', {
            status: 500,
          }),
        );
        await expect(
          new WahaAdapter(config)[method]('meper-abc'),
        ).rejects.toThrow('WhatsApp provider unavailable');
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
    },
  );
  it.each(['meper/abc', '..', 'meper%2Fabc'])(
    'rejects the unsafe session name %s without any request',
    async (name) => {
      global.fetch = jest.fn();
      const adapter = new WahaAdapter(config);
      const attempts: Array<() => Promise<unknown>> = [
        () => adapter.start(name),
        () => adapter.stop(name),
        () => adapter.restart(name),
        () => adapter.logout(name),
        () => adapter.remove(name),
        () => adapter.status(name),
        () => adapter.qr(name),
        () => adapter.me(name),
        () => adapter.ensureStarted(name, 'private-webhook-key'),
        () => adapter.sendFile(name, reportFile),
      ];
      // The write methods reject synchronously, the read methods return a
      // rejected promise; both must fail before any request is attempted.
      const rejections = attempts.map((attempt) => {
        let result: Promise<unknown>;
        try {
          result = attempt();
        } catch (error) {
          result = Promise.reject(error as Error);
        }
        return expect(result).rejects.toThrow('WhatsApp provider unavailable');
      });
      await Promise.all(rejections);
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  describe('sendFile', () => {
    it('posts the document to the instance endpoint with the session in the body', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'wamid-1', body: 'ignored' }), {
          status: 200,
        }),
      );

      await expect(
        new WahaAdapter(config).sendFile('meper-intelligence', reportFile),
      ).resolves.toEqual({ providerMessageId: 'wamid-1' });

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe('http://waha:3000/api/sendFile');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        'X-Api-Key': 'private-api-key',
        'Content-Type': 'application/json',
      });
      // The session travels in the body, never the path, and the payload is the
      // documented `{ mimetype, filename, data }` document shape.
      expect(JSON.parse(init.body as string)).toEqual({
        session: 'meper-intelligence',
        chatId: '573001112233@c.us',
        file: {
          mimetype: 'application/pdf',
          filename: 'reporte-diario-2026-03-03.pdf',
          data: 'JVBERi0xLjQKJSVFT0YK',
        },
      });
      expect(url).not.toContain('meper-intelligence');
      expect(init.body as string).not.toContain('data:application/pdf');
    });

    it.each([
      ['an empty object', new Response(JSON.stringify({}), { status: 200 })],
      ['a non-JSON body', new Response('<html>sent</html>', { status: 200 })],
    ])(
      'reports a sent document without a message id for %s',
      async (_label, response) => {
        global.fetch = jest.fn().mockResolvedValue(response);

        await expect(
          new WahaAdapter(config).sendFile('meper-intelligence', reportFile),
        ).resolves.toEqual({ providerMessageId: null });
      },
    );

    it('rejects a non-2xx send and logs only a fixed reason', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        global.fetch = jest.fn().mockResolvedValue(
          new Response('private-api-key private-chat-id secret-body', {
            status: 500,
          }),
        );

        await expect(
          new WahaAdapter(config).sendFile('meper-intelligence', reportFile),
        ).rejects.toThrow('WhatsApp provider unavailable');
        expect(log).toHaveBeenCalledWith({
          event: 'waha_provider_failure',
          reason: 'provider_rejected',
        });
        expect(JSON.stringify(log.mock.calls)).not.toMatch(
          /private-api-key|private-chat-id|secret-body|meper-intelligence/,
        );
      } finally {
        log.mockRestore();
      }
    });
  });
});
