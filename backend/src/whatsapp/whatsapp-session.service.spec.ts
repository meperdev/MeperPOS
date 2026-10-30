import { ForbiddenException } from '@nestjs/common';
import { WhatsAppSessionService } from './whatsapp-session.service';
import type { WhatsAppProvider } from './whatsapp-provider';
import { deriveWebhookKey } from './waha-signature';

function fakeProvider(): WhatsAppProvider {
  return {
    ensureStarted: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    restart: jest.fn(),
    logout: jest.fn(),
    remove: jest.fn(),
    status: jest.fn(),
    qr: jest.fn(),
    me: jest.fn(),
  };
}

describe('WhatsAppSessionService', () => {
  const masterKey = 'master-webhook-key';
  it('uses a server-derived tenant session for all operations', async () => {
    const provider = fakeProvider();
    const service = new WhatsAppSessionService(provider, masterKey);
    await service.connect('org-a');
    await service.status('org-a');
    await service.qr('org-a');
    await service.qr('org-b');
    const a = (provider.ensureStarted as jest.Mock).mock.calls[0][0] as string;
    expect(a).toMatch(/^meper-commercial-[0-9a-f]{32}$/);
    expect(provider.status).toHaveBeenCalledWith(a);
    expect((provider.qr as jest.Mock).mock.calls[0][0]).toBe(a);
    expect((provider.qr as jest.Mock).mock.calls[1][0]).not.toBe(a);
  });
  it('starts the tenant session with a key derived from the master secret', async () => {
    const provider = fakeProvider();
    const service = new WhatsAppSessionService(provider, masterKey);
    await service.connect('org-a');
    const [session, webhookKey] = (provider.ensureStarted as jest.Mock).mock
      .calls[0] as [string, string];
    expect(webhookKey).toBe(deriveWebhookKey(masterKey, session));
    expect(webhookKey).not.toBe(masterKey);
    expect(webhookKey).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rejects absent organization', async () => {
    const provider = fakeProvider();
    const service = new WhatsAppSessionService(provider, masterKey);
    expect(() => service.qr('')).toThrow();
    expect(provider.qr).not.toHaveBeenCalled();
  });
  it('fails closed without the master key instead of starting an unverified session', () => {
    const provider = fakeProvider();
    const service = new WhatsAppSessionService(provider, undefined);
    expect(() => service.connect('org-a')).toThrow(ForbiddenException);
    expect(provider.ensureStarted).not.toHaveBeenCalled();
  });
});
