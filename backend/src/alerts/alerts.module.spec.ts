import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { CacheModule } from '../common/cache.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AlertsModule } from './alerts.module';
import { StockAlertsScheduler } from './stock-alerts.scheduler';
import { StockAlertsService } from './stock-alerts.service';

/**
 * Wiring is behavior here: a scan service the container never resolves is dead
 * code, and the only symptom is silence. These assertions are the regression the
 * split commits produced once.
 */
describe('AlertsModule low-stock scan wiring', () => {
  it('is registered in the application module', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    ) as unknown[];

    expect(imports).toContain(AlertsModule);
  });

  it('registers the scan service, its scheduler and the WhatsApp port module', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AlertsModule,
    ) as unknown[];
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AlertsModule,
    ) as unknown[];

    expect(providers).toEqual(
      expect.arrayContaining([StockAlertsService, StockAlertsScheduler]),
    );
    expect(imports).toContain(WhatsAppModule);
  });

  it('resolves the scheduler through the Nest container', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule, PrismaModule, AlertsModule],
    }).compile();

    const scheduler = moduleRef.get(StockAlertsScheduler);
    expect(scheduler).toBeInstanceOf(StockAlertsScheduler);

    moduleRef.close();
  });
});
