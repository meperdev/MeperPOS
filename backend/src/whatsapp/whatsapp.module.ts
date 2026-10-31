import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import {
  WhatsAppWebhookController,
  WAHA_WEBHOOK_KEY,
} from './whatsapp-webhook.controller';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { WHATSAPP_PROVIDER } from './whatsapp-provider';
import { WahaAdapter } from './waha-adapter';

@Module({
  controllers: [WhatsAppController, WhatsAppWebhookController],
  providers: [
    WhatsAppSessionService,
    {
      provide: WAHA_WEBHOOK_KEY,
      useFactory: () => process.env.WAHA_WEBHOOK_HMAC_KEY,
    },
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: () =>
        new WahaAdapter({
          baseUrl: process.env.WAHA_BASE_URL ?? '',
          apiKey: process.env.WAHA_API_KEY ?? '',
          webhookKey: process.env.WAHA_WEBHOOK_HMAC_KEY ?? '',
          webhookUrl: process.env.WAHA_WEBHOOK_URL ?? '',
        }),
    },
  ],
})
export class WhatsAppModule {}
