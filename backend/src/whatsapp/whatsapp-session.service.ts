import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { WAHA_WEBHOOK_KEY } from './whatsapp-webhook.controller';
import { commercialSessionName } from './whatsapp-connections.service';
import { WHATSAPP_PROVIDER } from './whatsapp-provider';
import type {
  WhatsAppProvider,
  WhatsAppSessionStatus,
} from './whatsapp-provider';
import { deriveWebhookKey } from './waha-signature';

@Injectable()
export class WhatsAppSessionService {
  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    @Inject(WAHA_WEBHOOK_KEY) private readonly masterKey: string | undefined,
  ) {}

  private session(organizationId: string | undefined): string {
    if (!organizationId) throw new ForbiddenException();
    return commercialSessionName(organizationId);
  }
  /**
   * Each organization's session is created with its own derived webhook key, so
   * a key leaked from one channel cannot sign events for another. Without the
   * master secret there is no key to derive, and starting the session unsigned
   * would leave its webhooks unverifiable: fail closed instead.
   */
  connect(organizationId: string | undefined): Promise<void> {
    const session = this.session(organizationId);
    const webhookKey = deriveWebhookKey(this.masterKey, session);
    if (!webhookKey) throw new ForbiddenException();
    return this.provider.ensureStarted(session, webhookKey);
  }
  status(
    organizationId: string | undefined,
  ): Promise<{ status: WhatsAppSessionStatus }> {
    return this.provider.status(this.session(organizationId));
  }
  qr(organizationId: string | undefined): Promise<{ data: string }> {
    return this.provider.qr(this.session(organizationId));
  }
}
