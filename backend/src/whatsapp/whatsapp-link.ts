import type { WhatsAppSessionStatus } from './whatsapp-provider';

/**
 * Pairing the central `meper-intelligence` session is an operator act, not a
 * user flow: one physical phone is scanned once, and every MeperPOS surface
 * after that only observes the channel. The orchestration therefore lives here,
 * outside any controller, so an operations command can drive it without a
 * MeperPOS login while the platform console reuses the very same rules.
 *
 * The module owns three decisions and nothing else: which environment is
 * required, when to ask the provider for a fresh QR, and when to stop waiting.
 * The provider, the database and the clock are injected, so the loop is
 * deterministic under test.
 */

/**
 * The complete environment the pairing path needs. None of these is a MeperPOS
 * credential: pairing must work with the provider's own configuration.
 */
export const WAHA_LINK_ENV_KEYS = [
  'WAHA_BASE_URL',
  'WAHA_API_KEY',
  'WAHA_WEBHOOK_URL',
  'WAHA_WEBHOOK_HMAC_KEY',
] as const;

export type LinkConfigKey = (typeof WAHA_LINK_ENV_KEYS)[number];

export interface LinkConfig {
  baseUrl: string;
  apiKey: string;
  webhookUrl: string;
  webhookHmacKey: string;
}

export type LinkConfigResult =
  | { ok: true; config: LinkConfig }
  | { ok: false; missing: LinkConfigKey[] };

/** Read the provider configuration, naming every gap instead of failing later. */
export function readLinkConfig(
  env: Record<string, string | undefined>,
): LinkConfigResult {
  const missing = WAHA_LINK_ENV_KEYS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: {
      baseUrl: env.WAHA_BASE_URL!.trim(),
      apiKey: env.WAHA_API_KEY!.trim(),
      webhookUrl: env.WAHA_WEBHOOK_URL!.trim(),
      webhookHmacKey: env.WAHA_WEBHOOK_HMAC_KEY!.trim(),
    },
  };
}

/**
 * The channel as the pairing loop sees it. Deliberately narrow: a caller cannot
 * name a session here, because the session name is derived by the channel
 * implementation from the persisted channel type.
 */
export interface PairingChannel {
  connect(): Promise<{ status: WhatsAppSessionStatus }>;
  status(): Promise<{ status: WhatsAppSessionStatus }>;
  qr(): Promise<{ data: string }>;
}

export interface PairingClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface PairingOptions {
  clock: PairingClock;
  /** Receives the base64 PNG payload; the caller decides where it lands. */
  onQr: (data: string) => Promise<void> | void;
  onStatus?: (status: WhatsAppSessionStatus) => void;
  /** Total budget for the QR to be scanned. Defaults to three minutes. */
  maxWaitMs?: number;
  /** Delay between provider status reads. Defaults to three seconds. */
  intervalMs?: number;
}

export type PairingResult =
  | { ok: true; status: 'WORKING' }
  | {
      ok: false;
      reason: 'failed' | 'passkey' | 'timeout';
      status: WhatsAppSessionStatus;
    };

const DEFAULT_MAX_WAIT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 3_000;

/**
 * A passkey challenge and a failed session are operator decisions: retrying them
 * burns the budget without any chance of success, so they end the attempt at once.
 */
function terminalReason(
  status: WhatsAppSessionStatus,
): 'failed' | 'passkey' | null {
  switch (status) {
    case 'FAILED':
    case 'STOPPED':
      return 'failed';
    case 'PASSKEY_REQUIRED':
    case 'PASSKEY_CONFIRMATION_REQUIRED':
      return 'passkey';
    default:
      return null;
  }
}

/**
 * Start the session, hand the QR to the operator when the provider asks for one,
 * and resolve once the phone reports a working session. Bounded in time and in
 * provider calls: an unattended command must never wait forever.
 */
export async function pairCentralSession(
  channel: PairingChannel,
  options: PairingOptions,
): Promise<PairingResult> {
  const { clock, onQr, onStatus } = options;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  const started = await channel.connect();
  onStatus?.(started.status);
  if (started.status === 'WORKING') return { ok: true, status: 'WORKING' };
  const startedReason = terminalReason(started.status);
  if (startedReason) {
    return { ok: false, reason: startedReason, status: started.status };
  }

  const deadline = clock.now() + maxWaitMs;
  let lastQr: string | null = null;

  while (clock.now() < deadline) {
    const { status } = await channel.status();
    onStatus?.(status);

    if (status === 'WORKING') return { ok: true, status: 'WORKING' };
    const reason = terminalReason(status);
    if (reason) return { ok: false, reason, status };

    if (status === 'SCAN_QR_CODE') {
      // WAHA rotates the image while it waits, so a changed payload is a real
      // update for the operator; an unchanged one is not worth rewriting.
      const { data } = await channel.qr();
      if (data && data !== lastQr) {
        lastQr = data;
        await onQr(data);
      }
    }

    await clock.sleep(intervalMs);
  }

  return { ok: false, reason: 'timeout', status: 'SCAN_QR_CODE' };
}
