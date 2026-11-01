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
import {
  WHATSAPP_FILE_SENDER,
  WHATSAPP_PROVIDER,
  WHATSAPP_TEXT_SENDER,
} from './whatsapp-provider';
import {
  UnconfiguredWhatsAppModelProvider,
  WHATSAPP_MODEL_PROVIDER,
} from './whatsapp-intelligence-model';
import { WhatsAppRetentionScheduler } from './whatsapp-retention.scheduler';
import { WhatsAppRetentionService } from './whatsapp-retention.service';
import { WhatsAppSupervisionService } from './whatsapp-supervision.service';
import { WahaAdapter } from './waha-adapter';

/**
 * One adapter shape exposed through three ports: the session lifecycle the web
 * controllers drive, the document sending the delivery service needs, and the
 * plain-text delivery the administrative reply uses. The configuration is read
 * when the provider is constructed, never at import time.
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
    WhatsAppSupervisionService,
    WhatsAppAdminService,
    WhatsAppDeliveryService,
    WhatsAppDeliveryScheduler,
    WhatsAppRetentionService,
    WhatsAppRetentionScheduler,
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
    {
      provide: WHATSAPP_TEXT_SENDER,
      useFactory: createWahaAdapter,
    },
    {
      // No model provider is chosen yet: provider, model, privacy, budget and
      // where the text may be processed are still open decisions. This binding
      // reaches nothing and always refuses, so the administrative channel keeps
      // answering from its deterministic allowlist only. Replacing this one
      // provider is the single change that turns the model seam on.
      provide: WHATSAPP_MODEL_PROVIDER,
      useClass: UnconfiguredWhatsAppModelProvider,
    },
  ],
})
export class WhatsAppModule {}
