import { WhatsAppSessionService } from './whatsapp-session.service';
import type { WhatsAppProvider } from './whatsapp-provider';

describe('WhatsAppSessionService', () => {
  it('uses a server-derived tenant session for all operations', async () => {
    const provider: WhatsAppProvider = {
      connect: jest.fn(),
      status: jest.fn(),
      qr: jest.fn(),
    };
    const service = new WhatsAppSessionService(provider);
    await service.connect('org-a');
    await service.status('org-a');
    await service.qr('org-a');
    await service.qr('org-b');
    const a = (provider.connect as jest.Mock).mock.calls[0][0] as string;
    expect(a).toMatch(/^meper-[0-9a-f]{64}$/);
    expect(provider.status).toHaveBeenCalledWith(a);
    expect((provider.qr as jest.Mock).mock.calls[0][0]).toBe(a);
    expect((provider.qr as jest.Mock).mock.calls[1][0]).not.toBe(a);
  });
  it('rejects absent organization', async () => {
    const provider: WhatsAppProvider = {
      connect: jest.fn(),
      status: jest.fn(),
      qr: jest.fn(),
    };
    const service = new WhatsAppSessionService(provider);
    expect(() => service.qr('')).toThrow();
    expect(provider.qr).not.toHaveBeenCalled();
  });
});
