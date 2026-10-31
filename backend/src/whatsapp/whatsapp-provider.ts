export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

export interface WhatsAppProvider {
  connect(session: string): Promise<void>;
  status(session: string): Promise<{ status: string }>;
  qr(session: string): Promise<{ data: string }>;
}
