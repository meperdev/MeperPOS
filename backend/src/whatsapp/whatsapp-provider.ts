export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

/**
 * Outbound document delivery. Kept as its own port instead of growing the
 * session-lifecycle port above: every existing lifecycle double stays valid,
 * and a caller that only drives sessions cannot accidentally send a document.
 */
export const WHATSAPP_FILE_SENDER = Symbol('WHATSAPP_FILE_SENDER');

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

/**
 * One document to deliver. `base64` is the raw file payload without a `data:`
 * prefix, and `chatId` is the provider's own chat identifier for the recipient —
 * never a MeperPOS user, organization or phone field.
 */
export interface WhatsAppFileMessage {
  chatId: string;
  filename: string;
  mimetype: string;
  base64: string;
}

export interface WhatsAppFileSender {
  /**
   * Send one document into an existing chat. The provider message id is returned
   * when the provider reports one; a provider that answers without an id is not
   * a failure, because the document has already left.
   */
  sendFile(
    session: string,
    file: WhatsAppFileMessage,
  ): Promise<{ providerMessageId: string | null }>;
}
