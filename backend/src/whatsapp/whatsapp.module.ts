import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { WhatsAppAdminService } from './whatsapp-admin.service';
import { WhatsAppCommercialController } from './whatsapp-commercial.controller';
import { WhatsAppDeliveryController } from './whatsapp-delivery.controller';
import { WhatsAppDeliveryScheduler } from './whatsapp-delivery.scheduler';
import { WhatsAppDeliveryService } from './whatsapp-delivery.service';
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
import { WHATSAPP_FILE_SENDER, WHATSAPP_PROVIDER } from './whatsapp-provider';
import { WahaAdapter } from './waha-adapter';

/**
 * One adapter shape exposed through two ports: the session lifecycle the web
 * controllers drive, and the document sending the delivery service needs. The
 * configuration is read when the provider is constructed, never at import time.
 */
const createWahaAdapter = () =>
  new WahaAdapter({
    baseUrl: process.env.WAHA_BASE_URL ?? '',
    apiKey: process.env.WAHA_API_KEY ?? '',
    webhookUrl: process.env.WAHA_WEBHOOK_URL ?? '',
  });

@Module({
  imports: [ReportsModule],
  controllers: [
    WhatsAppCommercialController,
    WhatsAppDeliveryController,
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
    WhatsAppDeliveryService,
    WhatsAppDeliveryScheduler,
    {
      provide: WAHA_WEBHOOK_KEY,
      useFactory: () => process.env.WAHA_WEBHOOK_HMAC_KEY,
    },
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: createWahaAdapter,
    },
    {
      provide: WHATSAPP_FILE_SENDER,
      useFactory: createWahaAdapter,
    },
  ],
})
export class WhatsAppModule {}
