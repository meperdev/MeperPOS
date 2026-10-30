import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { WhatsAppAdminService } from './whatsapp-admin.service';
import { WhatsAppCommercialController } from './whatsapp-commercial.controller';
import { WhatsAppIdentityController } from './whatsapp-identity.controller';
import { WhatsAppIntelligenceController } from './whatsapp-intelligence.controller';
import {
  WhatsAppWebhookController,
  WAHA_WEBHOOK_KEY,
} from './whatsapp-webhook.controller';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { WhatsAppConnectionsService } from './whatsapp-connections.service';
import { WhatsAppEventsService } from './whatsapp-events.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';
import { WhatsAppIngestionService } from './whatsapp-ingestion.service';
import { WHATSAPP_PROVIDER } from './whatsapp-provider';
import { WahaAdapter } from './waha-adapter';

@Module({
  imports: [ReportsModule],
  controllers: [
    WhatsAppCommercialController,
    WhatsAppIdentityController,
    WhatsAppIntelligenceController,
    WhatsAppWebhookController,
  ],
  providers: [
    WhatsAppSessionService,
    WhatsAppConnectionsService,
    WhatsAppEventsService,
    WhatsAppIdentityService,
    WhatsAppIngestionService,
    WhatsAppAdminService,
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
          webhookUrl: process.env.WAHA_WEBHOOK_URL ?? '',
        }),
    },
  ],
})
export class WhatsAppModule {}
