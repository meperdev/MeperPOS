import { Module } from '@nestjs/common';
import { FiscalDocumentService } from './fiscal-document.service';

/**
 * Internal registration of the fiscal document state machine (spec S8).
 *
 * There is deliberately no controller and no route: nothing here sends a
 * document, and nothing records a DIAN answer. No transport exists yet (spec
 * S6), so exposing an HTTP transition would let a caller claim an acceptance
 * that never happened. `FiscalDocumentService` is exported for internal
 * callers, and `SalesService` writes the PENDING document itself inside its own
 * transaction; this module never creates one.
 */
@Module({
  providers: [FiscalDocumentService],
  exports: [FiscalDocumentService],
})
export class ElectronicInvoicingModule {}
