import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { WHATSAPP_PROVIDER } from './whatsapp-provider';
import type { WhatsAppProvider } from './whatsapp-provider';

@Injectable()
export class WhatsAppSessionService {
  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  private session(organizationId: string | undefined): string {
    if (!organizationId) throw new ForbiddenException();
    return `meper-${createHash('sha256').update(organizationId).digest('hex')}`;
  }
  connect(organizationId: string | undefined): Promise<void> {
    return this.provider.connect(this.session(organizationId));
  }
  status(organizationId: string | undefined): Promise<{ status: string }> {
    return this.provider.status(this.session(organizationId));
  }
  qr(organizationId: string | undefined): Promise<{ data: string }> {
    return this.provider.qr(this.session(organizationId));
  }
}
