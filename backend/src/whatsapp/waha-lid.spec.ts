import { WahaAdapter } from './waha-adapter';

describe('WAHA LID association', () => {
  const config = {
    baseUrl: 'http://waha:3000',
    apiKey: 'key',
    webhookUrl: 'http://api/webhook',
  };
  const original = global.fetch;
  const lid = '123456789012345@lid';
  afterEach(() => {
    global.fetch = original;
  });

  it('returns only the validated phone from an exact association', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ lid, pn: '573001112233@c.us' })),
      );
    await expect(
      new WahaAdapter(config).resolveLid('meper-intelligence', lid),
    ).resolves.toBe('573001112233');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://waha:3000/api/meper-intelligence/lids/123456789012345%40lid',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Api-Key': 'key' }),
        redirect: 'error',
      }),
    );
  });

  it.each([
    { lid: '999999999999999@lid', pn: '573001112233@c.us' },
    { lid, pn: '123@lid' },
    { lid, pn: '57-3001112233@c.us' },
    { lid, pn: '123@c.us' },
    { lid, pn: null },
    {},
  ])(
    'rejects missing, inconsistent, or malformed associations',
    async (body) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body)));
      await expect(
        new WahaAdapter(config).resolveLid('meper-intelligence', lid),
      ).rejects.toThrow();
    },
  );

  it('fails closed when the provider rejects the lookup', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    await expect(
      new WahaAdapter(config).resolveLid('meper-intelligence', lid),
    ).rejects.toThrow();
  });

  it('rejects malformed LIDs before making a request', async () => {
    global.fetch = jest.fn();
    await expect(
      new WahaAdapter(config).resolveLid('meper-intelligence', '../1@lid'),
    ).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
