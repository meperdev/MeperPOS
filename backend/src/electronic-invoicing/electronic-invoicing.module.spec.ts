import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ElectronicInvoicingModule } from './electronic-invoicing.module';
import { FiscalDocumentService } from './fiscal-document.service';

/**
 * T4l: how the fiscal module is wired into the application, and what it
 * deliberately does not expose.
 *
 * Three things are pinned here, all with framework metadata and the Nest
 * container, so this file depends only on `AppModule`,
 * `ElectronicInvoicingModule`, `FiscalDocumentService` and the committed fiscal
 * schema: the module is imported by the application, it registers one provider,
 * exports it for internal callers and has no controller, and that provider
 * resolves through Nest.
 *
 * Nothing here sends, accepts or receives anything from DIAN (spec S6). The
 * database rules are proved by `fiscal-document-retention.int.spec.ts`, and the
 * admin delete path by `../admin/admin.fiscal-deletion.int.spec.ts`; neither
 * concern is re-checked here.
 */
describe('ElectronicInvoicingModule', () => {
  it('is registered in the application module', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    ) as unknown[];

    expect(imports).toContain(ElectronicInvoicingModule);
  });

  it('registers one provider, exported, with no controller', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ElectronicInvoicingModule),
    ).toEqual([FiscalDocumentService]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, ElectronicInvoicingModule),
    ).toEqual([FiscalDocumentService]);
    // No HTTP surface: with no transport, a route could only ever invent a DIAN
    // answer.
    expect(
      Reflect.getMetadata(
        MODULE_METADATA.CONTROLLERS,
        ElectronicInvoicingModule,
      ) ?? [],
    ).toEqual([]);
  });

  it('resolves the service through the Nest container', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ElectronicInvoicingModule],
    }).compile();

    expect(moduleRef.get(FiscalDocumentService)).toBeInstanceOf(
      FiscalDocumentService,
    );
    await moduleRef.close();
  });
});
