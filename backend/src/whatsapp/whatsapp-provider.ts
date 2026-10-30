export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

/**
 * Provider session statuses. Mirrors WAHA's documented set, including the
 * passkey states that require an operator decision rather than a retry.
 */
export const WHATSAPP_SESSION_STATUSES = [
  'STOPPED',
  'STARTING',
  'SCAN_QR_CODE',
  'PASSKEY_REQUIRED',
  'PASSKEY_CONFIRMATION_REQUIRED',
  'WORKING',
  'FAILED',
] as const;

export type WhatsAppSessionStatus = (typeof WHATSAPP_SESSION_STATUSES)[number];

export function isWhatsAppSessionStatus(
  value: unknown,
): value is WhatsAppSessionStatus {
  return (
    typeof value === 'string' &&
    (WHATSAPP_SESSION_STATUSES as readonly string[]).includes(value)
  );
}

export interface WhatsAppProvider {
  /**
   * Create the session when missing and start it. Each session receives its own
   * derived webhook key, so one leaked key cannot forge another channel.
   */
  ensureStarted(session: string, webhookKey: string): Promise<void>;
  start(session: string): Promise<void>;
  stop(session: string): Promise<void>;
  restart(session: string): Promise<void>;
  /** Unlink the phone number while keeping the session record. */
  logout(session: string): Promise<void>;
  /** Remove the session and its stored credentials from the provider. */
  remove(session: string): Promise<void>;
  status(session: string): Promise<{ status: WhatsAppSessionStatus }>;
  /** Base64 PNG of the current linking QR code. */
  qr(session: string): Promise<{ data: string }>;
  /** Identity of the linked WhatsApp account, if the session is authenticated. */
  me(session: string): Promise<{ accountId: string | null }>;
}
