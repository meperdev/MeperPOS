import {
  pairCentralSession,
  readLinkConfig,
  type PairingChannel,
  type PairingClock,
} from './whatsapp-link';
import type { WhatsAppSessionStatus } from './whatsapp-provider';

/**
 * A channel double that reports the statuses in order and counts how often each
 * provider call happened, so the test asserts the pairing contract rather than
 * the loop's internals.
 */
function channelReturning(statuses: WhatsAppSessionStatus[]) {
  let index = 0;
  const next = () => statuses[Math.min(index++, statuses.length - 1)];
  const calls = { connect: 0, status: 0, qr: 0 };
  const channel: PairingChannel = {
    connect: jest.fn(() => {
      calls.connect += 1;
      return Promise.resolve({ status: statuses[0] });
    }),
    status: jest.fn(() => {
      calls.status += 1;
      return Promise.resolve({ status: next() });
    }),
    qr: jest.fn(() => {
      calls.qr += 1;
      return Promise.resolve({ data: `qr-${calls.qr}` });
    }),
  };
  return { channel, calls };
}

/** A clock that never really waits: virtual time advances on every sleep. */
function virtualClock(
  stepMs = 1_000,
): PairingClock & { elapsed: () => number } {
  let current = 0;
  return {
    now: () => current,
    sleep: (ms: number) => {
      current += Math.max(ms, stepMs);
      return Promise.resolve();
    },
    elapsed: () => current,
  };
}

const CONFIG_ENV = {
  WAHA_BASE_URL: 'https://waha.example.test',
  WAHA_API_KEY: 'api-key',
  WAHA_WEBHOOK_URL: 'https://meper.example.test/api/whatsapp/webhook',
  WAHA_WEBHOOK_HMAC_KEY: 'master-secret',
};

describe('readLinkConfig', () => {
  it('names every missing variable instead of failing later at the provider', () => {
    const result = readLinkConfig({ WAHA_API_KEY: 'api-key' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.missing).toEqual([
      'WAHA_BASE_URL',
      'WAHA_WEBHOOK_URL',
      'WAHA_WEBHOOK_HMAC_KEY',
    ]);
  });

  it('accepts a complete environment without reading any MeperPOS credential', () => {
    const result = readLinkConfig(CONFIG_ENV);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.config.baseUrl).toBe('https://waha.example.test');
    expect(result.config.webhookHmacKey).toBe('master-secret');
  });
});

describe('pairCentralSession', () => {
  it('does not request a QR when the phone is already linked', async () => {
    const { channel, calls } = channelReturning(['WORKING']);
    const onQr = jest.fn();

    const result = await pairCentralSession(channel, {
      clock: virtualClock(),
      onQr,
    });

    expect(result).toEqual({ ok: true, status: 'WORKING' });
    expect(onQr).not.toHaveBeenCalled();
    expect(calls.qr).toBe(0);
  });

  it('hands the QR to the operator and finishes when the phone links', async () => {
    const { channel } = channelReturning([
      'STARTING',
      'SCAN_QR_CODE',
      'WORKING',
    ]);
    const onQr = jest.fn();

    const result = await pairCentralSession(channel, {
      clock: virtualClock(),
      onQr,
    });

    expect(result).toEqual({ ok: true, status: 'WORKING' });
    expect(onQr).toHaveBeenCalledTimes(1);
    expect(onQr).toHaveBeenCalledWith('qr-1');
  });

  it('rewrites the QR only when the provider rotates it', async () => {
    const { channel } = channelReturning([
      'SCAN_QR_CODE',
      'SCAN_QR_CODE',
      'SCAN_QR_CODE',
      'WORKING',
    ]);
    const written: string[] = [];

    await pairCentralSession(channel, {
      clock: virtualClock(),
      onQr: (data) => {
        written.push(data);
      },
    });

    expect(written).toEqual(['qr-1', 'qr-2', 'qr-3']);
  });

  it('stops with a timeout instead of looping forever when nobody scans', async () => {
    const { channel, calls } = channelReturning(['SCAN_QR_CODE']);
    const onQr = jest.fn();

    const result = await pairCentralSession(channel, {
      clock: virtualClock(),
      onQr,
      maxWaitMs: 5_000,
      intervalMs: 1_000,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'timeout',
      status: 'SCAN_QR_CODE',
    });
    expect(calls.qr).toBeGreaterThan(0);
  });

  it('reports a failed session instead of retrying it', async () => {
    const { channel, calls } = channelReturning(['STARTING', 'FAILED']);

    const result = await pairCentralSession(channel, {
      clock: virtualClock(),
      onQr: jest.fn(),
    });

    expect(result).toEqual({ ok: false, reason: 'failed', status: 'FAILED' });
    expect(calls.qr).toBe(0);
  });

  it('reports a passkey challenge as an operator decision, not a retry', async () => {
    const { channel } = channelReturning(['PASSKEY_REQUIRED']);

    const result = await pairCentralSession(channel, {
      clock: virtualClock(),
      onQr: jest.fn(),
    });

    expect(result).toEqual({
      ok: false,
      reason: 'passkey',
      status: 'PASSKEY_REQUIRED',
    });
  });
});
