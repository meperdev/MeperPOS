import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanLimitService } from '../plan-limits/plan-limits.service';
import { ProductsService } from '../products/products.service';
import { CustomersService } from '../customers/customers.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { UsersService } from '../users/users.service';
import { normalizeHeader } from './helpers/column-detector';
import { normalizeLookupKey } from './helpers/row-validator';
import { SheetRegistry } from './engine/sheet-registry';
import { ProductHandler } from './engine/handlers/product.handler';
import { CustomerHandler } from './engine/handlers/customer.handler';
import { SupplierHandler } from './engine/handlers/supplier.handler';
import { UserHandler } from './engine/handlers/user.handler';
import { PUBLIC_IMPORT_MESSAGES } from '../common/errors/public-error.model';
import { recordProtectedDiagnostic } from '../common/errors/protected-diagnostics';
import type {
  ImportRowError,
  ImportSheetHandler,
  ParsedFileRow,
  RowError,
  SheetId,
  SheetRowContext,
  SheetStatus,
} from './engine/import-sheet-handler.interface';
import { hasEffectiveRole } from '../common/guards/role-hierarchy';

type MultiSheetJobStatus = 'PARSING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
type ImportEventType = 'SUCCESS' | 'ERROR' | 'WARNING' | 'INFO';

/** Retry input for the sheet-aware retry endpoint (PR4 wires the DTO). */
export interface SheetAwareRetryDto {
  rowIndex: number;
  sheetId: SheetId;
  correctedData: Record<string, unknown>;
}

interface ImportWarning {
  rowIndex: number;
  warningCode: string;
  message: string;
}

interface ImportEvent {
  type: ImportEventType;
  message: string;
  rowIndex: number;
  timestamp: Date;
}

interface ParsedWorkbookSheet {
  name: string;
  sheetId?: SheetId;
  headers: string[];
  rows: ParsedFileRow[];
}

interface SheetJobState {
  sheetId: SheetId;
  status: SheetStatus;
  totalRows: number;
  processedRows: number;
  imported: number;
  skipped: number;
  errors: number;
  warnings: number;
  missingRequiredFields?: string[];
  planLimitRejected?: boolean;
  planLimitMessage?: string;
  roleRejected?: boolean;
  roleRejectedMessage?: string;
  mapping: Record<string, string>;
  rowErrors: ImportRowError[];
}

interface MultiSheetJob {
  id: string;
  userId: string;
  organizationId: string;
  callerRole: OrgRole | 'SUPER_ADMIN' | undefined;
  status: MultiSheetJobStatus;
  fileName: string;
  totalRows: number;
  processedRows: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  warningCount: number;
  sheets: SheetJobState[];
  rowErrors: ImportRowError[];
  warnings: ImportWarning[];
  recentEvents: ImportEvent[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  handlers: SheetRegistry;
  parsedSheets: ParsedWorkbookSheet[];
  correlationId: string;
}

const SHEET_ORDER: SheetId[] = [
  'productos',
  'clientes',
  'proveedores',
  'usuarios',
];

const MAX_FILE_ROWS = 5000;
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_RECENT_EVENTS = 10;

@Injectable()
export class MultiSheetImportService implements OnModuleDestroy {
  private readonly jobs = new Map<string, MultiSheetJob>();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitService,
    private readonly productsService: ProductsService,
    private readonly customersService: CustomersService,
    private readonly suppliersService: SuppliersService,
    private readonly usersService: UsersService,
  ) {
    this.cleanupInterval = setInterval(
      () => this.cleanupExpiredJobs(),
      5 * 60 * 1000,
    );
    this.cleanupInterval.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Parses the uploaded workbook, resolves its sheets in the fixed order
   * (Productos -> Clientes -> Proveedores -> Usuarios), rejects any file with
   * no recognisable data and launches one in-memory job that processes each
   * sheet per-sheet, with per-row fault isolation.
   *
   * The caller's role travels on the job: the usuarios sheet is rejected
   * unless the caller may create users (ADMIN or SUPER_ADMIN).
   */
  async startFullImport(
    file: Express.Multer.File,
    userId: string,
    organizationId: string | undefined,
    callerRole: OrgRole | 'SUPER_ADMIN' | undefined,
    correlationId: string = randomUUID(),
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }

    this.validateIncomingFile(file);

    let parsedSheets: ParsedWorkbookSheet[];
    try {
      parsedSheets = await this.parseWorkbook(file.buffer);
    } catch (error) {
      recordProtectedDiagnostic(
        { boundary: 'multi-sheet-import-parser', requestId: correlationId },
        error,
      );
      throw new UnprocessableEntityException(PUBLIC_IMPORT_MESSAGES.PARSE_FAILED);
    }
    const recognized = parsedSheets.filter(
      (sheet): sheet is ParsedWorkbookSheet & { sheetId: SheetId } =>
        !!sheet.sheetId,
    );

    if (recognized.length === 0) {
      throw new UnprocessableEntityException(
        'El archivo no contiene hojas reconocidas para importar',
      );
    }

    const totalRows = recognized.reduce(
      (sum, sheet) => sum + sheet.rows.length,
      0,
    );
    if (totalRows === 0) {
      throw new UnprocessableEntityException(
        'El archivo no contiene filas para importar',
      );
    }

    const overLimit = recognized.find(
      (sheet) => sheet.rows.length > MAX_FILE_ROWS,
    );
    if (overLimit) {
      throw new BadRequestException(
        `La hoja ${overLimit.name} supera el maximo permitido de ${MAX_FILE_ROWS} filas`,
      );
    }

    const job = this.createJob(
      file,
      userId,
      organizationId,
      callerRole,
      parsedSheets,
      correlationId,
    );

    void this.processJob(job.id);

    return {
      jobId: job.id,
      totalRows: job.totalRows,
      sheets: job.sheets.map((sheet) => ({
        sheetId: sheet.sheetId,
        status: sheet.status,
        totalRows: sheet.totalRows,
      })),
    };
  }

  getImportStatus(jobId: string, userId: string) {
    const job = this.getJobOrThrow(jobId, userId);
    return this.buildStatusResponse(job);
  }

  /** Sheet-aware retry: validates and creates a corrected row with the handler for its sheet. */
  async retryImportRow(
    jobId: string,
    userId: string,
    dto: SheetAwareRetryDto,
    callerRole: OrgRole | 'SUPER_ADMIN' | undefined,
  ) {
    // User creation is ADMIN-gated on every other surface; a
    // lower-privileged caller must not reach it through a retry either
    // (e.g. after a demotion between the import and the retry).
    if (
      dto.sheetId === 'usuarios' &&
      !this.canImportUsersSheet(callerRole)
    ) {
      throw new ForbiddenException('La hoja usuarios requiere rol ADMIN');
    }

    const job = this.getJobOrThrow(jobId, userId);
    const sheet = job.sheets.find((item) => item.sheetId === dto.sheetId);
    if (!sheet) {
      throw new NotFoundException('No se encontro la hoja indicada');
    }

    const unresolved = sheet.rowErrors.find(
      (error) =>
        error.rowIndex === dto.rowIndex &&
        !(error.retried === true && error.retriedSuccess === true),
    );
    if (!unresolved) {
      throw new NotFoundException(
        'No se encontro un error pendiente para la fila indicada',
      );
    }

    const handler = job.handlers.get(dto.sheetId);
    if (!handler) {
      throw new NotFoundException(
        'No se encontro el manejador para la hoja indicada',
      );
    }

    const merged = {
      ...unresolved.mappedData,
      ...this.sanitizeCorrectedData(dto.correctedData, handler.editableFields),
    };
    const rawData: Record<string, string> = {};
    for (const [field, header] of Object.entries(sheet.mapping)) {
      const value = merged[field];
      if (value !== undefined && value !== null) {
        rawData[header] = String(value);
      }
    }

    const row: ParsedFileRow = { rowIndex: dto.rowIndex, rawData };
    const existingKeys = await this.loadExistingKeys(
      dto.sheetId,
      job.organizationId,
    );
    const ctx: SheetRowContext = {
      organizationId: job.organizationId,
      userId: job.userId,
      actorRole: job.callerRole,
      prisma: this.prisma,
      planLimits: this.planLimits,
      existingKeys,
    };

    const result = handler.validateRow(row, ctx);
    if (!result.ok) {
      this.applyRetryFailure(unresolved, result.error);
      this.addEvent(job, 'ERROR', result.error.message, dto.rowIndex);
      return this.buildStatusResponse(job);
    }

    try {
      await handler.createRow(result.data, ctx);
      job.importedCount += 1;
      sheet.imported += 1;
      job.errorCount = Math.max(0, job.errorCount - 1);
      sheet.errors = Math.max(0, sheet.errors - 1);
      unresolved.retried = true;
      unresolved.retriedSuccess = true;
      unresolved.message = 'Fila corregida e importada correctamente';
      this.addEvent(
        job,
        'SUCCESS',
        'Fila reintentada e importada',
        dto.rowIndex,
      );
      return this.buildStatusResponse(job);
    } catch (error) {
      recordProtectedDiagnostic(
        { boundary: 'multi-sheet-import-retry', jobId: job.id, row: dto.rowIndex },
        error,
      );
      const mapped = this.mapCreationError(error, dto.rowIndex, result.data);
      this.applyRetryFailure(unresolved, mapped);
      this.addEvent(job, 'ERROR', mapped.message, dto.rowIndex);
      return this.buildStatusResponse(job);
    }
  }

  private createJob(
    file: Express.Multer.File,
    userId: string,
    organizationId: string,
    callerRole: OrgRole | 'SUPER_ADMIN' | undefined,
    parsedSheets: ParsedWorkbookSheet[],
    correlationId: string,
  ): MultiSheetJob {
    const sheets: SheetJobState[] = SHEET_ORDER.filter((sheetId) =>
      parsedSheets.some((sheet) => sheet.sheetId === sheetId),
    ).map((sheetId) => {
      const parsed = parsedSheets.find((sheet) => sheet.sheetId === sheetId)!;
      return {
        sheetId,
        status: 'PENDING',
        totalRows: parsed.rows.length,
        processedRows: 0,
        imported: 0,
        skipped: 0,
        errors: 0,
        warnings: 0,
        mapping: {},
        rowErrors: [],
      };
    });

    const job: MultiSheetJob = {
      id: randomUUID(),
      userId,
      organizationId,
      callerRole,
      status: 'PARSING',
      fileName: file.originalname,
      totalRows: sheets.reduce((sum, sheet) => sum + sheet.totalRows, 0),
      processedRows: 0,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      warningCount: 0,
      sheets,
      rowErrors: [],
      warnings: [],
      recentEvents: [],
      startedAt: new Date(),
      handlers: this.buildRegistry(),
      parsedSheets,
      correlationId,
    };

    this.jobs.set(job.id, job);
    this.addEvent(job, 'INFO', 'Archivo recibido. Iniciando procesamiento', 1);
    return job;
  }

  private async processJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    try {
      job.status = 'PROCESSING';

      for (const sheetId of SHEET_ORDER) {
        const parsed = job.parsedSheets.find(
          (item) => item.sheetId === sheetId,
        );
        if (!parsed) {
          continue;
        }
        await this.processSheet(job, sheetId, parsed);
      }

      job.status = 'COMPLETED';
      job.completedAt = new Date();
      this.addEvent(job, 'INFO', 'Importacion finalizada', 1);
    } catch (error) {
      recordProtectedDiagnostic(
        { boundary: 'multi-sheet-import-job', jobId: job.id },
        error,
      );
      job.status = 'FAILED';
      job.completedAt = new Date();
      job.error = PUBLIC_IMPORT_MESSAGES.JOB_FAILED;
      this.addEvent(job, 'ERROR', PUBLIC_IMPORT_MESSAGES.JOB_FAILED, 1);
    }
  }

  /**
   * Roles allowed to import the usuarios sheet. Mirrors POST /api/users
   * (@Roles(OrgRole.ADMIN), the top organization role, and SUPER_ADMIN
   * bypassing) so the import cannot become a user-creation bypass for
   * CASHIER/INVENTORY_USER callers. An unknown/missing role fails closed.
   */
  private canImportUsersSheet(
    role: OrgRole | 'SUPER_ADMIN' | undefined,
  ): boolean {
    if (role === undefined) return false;
    return role === 'SUPER_ADMIN' || hasEffectiveRole(role, OrgRole.ADMIN);
  }

  private async processSheet(
    job: MultiSheetJob,
    sheetId: SheetId,
    parsed: ParsedWorkbookSheet,
  ) {
    const sheet = job.sheets.find((item) => item.sheetId === sheetId);
    const handler = job.handlers.get(sheetId);
    if (!sheet || !handler) {
      return;
    }

    // Role gate (before any data work): a caller who cannot create users
    // through POST /api/users cannot create them through the import either.
    // The sheet is rejected and its sibling sheets keep processing.
    if (sheetId === 'usuarios' && !this.canImportUsersSheet(job.callerRole)) {
      sheet.status = 'REJECTED';
      sheet.roleRejected = true;
      sheet.roleRejectedMessage = 'La hoja usuarios requiere rol ADMIN';
      this.addEvent(
        job,
        'WARNING',
        'Hoja usuarios rechazada por permisos (requiere rol ADMIN)',
        1,
      );
      return;
    }

    const detection = handler.detectColumns(parsed.headers);
    if (detection.missingRequiredFields.length > 0) {
      sheet.status = 'REJECTED';
      sheet.missingRequiredFields = detection.missingRequiredFields;
      this.addEvent(
        job,
        'WARNING',
        `Hoja ${sheetId} rechazada por columnas faltantes`,
        1,
      );
      return;
    }
    sheet.mapping = detection.mapping;

    if (sheetId === 'usuarios' || sheetId === 'clientes') {
      const limitType = sheetId === 'usuarios' ? 'users' : 'customers';
      const limitStatus = await this.planLimits.getLimitStatus(
        limitType,
        job.organizationId,
      );

      if (
        limitStatus.limit !== -1 &&
        limitStatus.current + parsed.rows.length > limitStatus.limit
      ) {
        sheet.status = 'REJECTED';
        sheet.planLimitRejected = true;
        sheet.planLimitMessage = `Supera el limite del plan (${limitStatus.current}/${limitStatus.limit})`;
        this.addEvent(
          job,
          'WARNING',
          `Hoja ${sheetId} rechazada por limite de plan`,
          1,
        );
        return;
      }
    }

    sheet.status = 'PROCESSING';
    const existingKeys = await this.loadExistingKeys(
      sheetId,
      job.organizationId,
    );
    const ctx: SheetRowContext = {
      organizationId: job.organizationId,
      userId: job.userId,
      actorRole: job.callerRole,
      prisma: this.prisma,
      planLimits: this.planLimits,
      existingKeys,
    };

    for (const row of parsed.rows) {
      sheet.processedRows += 1;
      job.processedRows += 1;
      await this.processRow(job, sheet, handler, row, ctx);
    }

    sheet.status = 'COMPLETED';
    this.addEvent(job, 'INFO', `Hoja ${sheetId} procesada`, 1);

    if (sheetId === 'usuarios' || sheetId === 'clientes') {
      const limitType = sheetId === 'usuarios' ? 'users' : 'customers';
      this.planLimits.invalidateCache(limitType, job.organizationId);
    }
  }

  private async processRow(
    job: MultiSheetJob,
    sheet: SheetJobState,
    handler: ImportSheetHandler,
    row: ParsedFileRow,
    ctx: SheetRowContext,
  ) {
    const result = handler.validateRow(row, ctx);
    if (!result.ok) {
      this.addRowError(job, sheet, handler, row, result.error);
      return;
    }

    try {
      await handler.createRow(result.data, ctx);
      job.importedCount += 1;
      sheet.imported += 1;
      this.addEvent(
        job,
        'SUCCESS',
        `Fila ${row.rowIndex} importada`,
        row.rowIndex,
      );
    } catch (error) {
      recordProtectedDiagnostic(
        { boundary: 'multi-sheet-import-row', jobId: job.id, row: row.rowIndex },
        error,
      );
      const mapped = this.mapCreationError(error, row.rowIndex, result.data);
      this.addRowError(job, sheet, handler, row, mapped);
    }
  }

  private addRowError(
    job: MultiSheetJob,
    sheet: SheetJobState,
    handler: ImportSheetHandler,
    row: ParsedFileRow,
    error: RowError,
  ) {
    sheet.errors += 1;
    job.errorCount += 1;
    const importRowError: ImportRowError = {
      rowIndex: row.rowIndex,
      sheetId: sheet.sheetId,
      errorCode: error.errorCode,
      message: error.message,
      field: error.field,
      mappedData: error.mappedData,
      editableFields: handler.editableFields,
      retried: false,
    };
    sheet.rowErrors.push(importRowError);
    job.rowErrors.push(importRowError);
    this.addEvent(job, 'ERROR', error.message, row.rowIndex);
  }

  private applyRetryFailure(unresolved: ImportRowError, error: RowError) {
    unresolved.retried = true;
    unresolved.retriedSuccess = false;
    unresolved.errorCode = error.errorCode;
    unresolved.message = error.message;
    unresolved.field = error.field;
    unresolved.mappedData = error.mappedData;
  }

  private mapCreationError(
    error: unknown,
    rowIndex: number,
    mappedData: Record<string, unknown>,
  ): RowError {
    if (error instanceof ConflictException) {
      const message = String(error.message ?? '').toLowerCase();
      if (message.includes('sku')) {
        return {
          errorCode: 'DUPLICATE_SKU',
          message: 'SKU ya existe en la base de datos',
          field: 'sku',
          mappedData,
        };
      }
      if (message.includes('barcode')) {
        return {
          errorCode: 'DUPLICATE_BARCODE',
          message: 'Codigo de barras ya existe en la base de datos',
          field: 'barcode',
          mappedData,
        };
      }
      if (message.includes('document')) {
        return {
          errorCode: 'DUPLICATE_DOCUMENT',
          message: 'Ya existe un registro con ese numero de documento',
          field: 'documentNumber',
          mappedData,
        };
      }
      if (message.includes('email')) {
        return {
          errorCode: 'DUPLICATE_EMAIL',
          message: 'Ya existe un usuario con ese correo',
          field: 'email',
          mappedData,
        };
      }
    }

    return {
      errorCode: 'IMPORT_ROW_FAILED',
      message: PUBLIC_IMPORT_MESSAGES.ROW_FAILED,
      mappedData,
    };
  }

  private sanitizeCorrectedData(
    data: Record<string, unknown>,
    editableFields: string[],
  ): Record<string, unknown> {
    const allowed = new Set(editableFields);
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (allowed.has(key)) {
        output[key] = value;
      }
    }
    return output;
  }

  private buildRegistry(): SheetRegistry {
    return new SheetRegistry([
      new ProductHandler(this.productsService),
      new CustomerHandler(this.customersService),
      new SupplierHandler(this.suppliersService),
      new UserHandler(this.usersService),
    ]);
  }

  private buildStatusResponse(job: MultiSheetJob) {
    return {
      jobId: job.id,
      status: job.status,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      importedCount: job.importedCount,
      skippedCount: job.skippedCount,
      errorCount: job.errorCount,
      warningCount: job.warningCount,
      sheets: job.sheets.map((sheet) => ({
        sheetId: sheet.sheetId,
        status: sheet.status,
        totalRows: sheet.totalRows,
        processedRows: sheet.processedRows,
        imported: sheet.imported,
        skipped: sheet.skipped,
        errors: sheet.errors,
        warnings: sheet.warnings,
        missingRequiredFields: sheet.missingRequiredFields,
        planLimitRejected: sheet.planLimitRejected,
        planLimitMessage: sheet.planLimitMessage,
        roleRejected: sheet.roleRejected,
        roleRejectedMessage: sheet.roleRejectedMessage,
        rowErrors: sheet.rowErrors.map((error) => this.toPublicRowError(job, error)),
      })),
      errors: job.rowErrors.map((error) => this.toPublicRowError(job, error)),
      warnings: job.warnings.map((warning) => ({
        row: warning.rowIndex,
        code: warning.warningCode,
        message: warning.message,
        correlationId: job.correlationId,
      })),
      recentEvents: job.recentEvents.map((event) => ({
        type: event.type,
        row: event.rowIndex,
        code: event.type === 'ERROR' ? 'IMPORT_ROW_FAILED' : event.type,
        message:
          event.type === 'ERROR'
            ? event.message
            : event.type === 'SUCCESS'
              ? 'Import row processed'
              : event.type === 'WARNING'
                ? 'Import warning'
                : event.message === 'Importacion finalizada'
                  ? 'Import completed'
                  : 'Import processing started',
        correlationId: job.correlationId,
      })),
      correlationId: job.correlationId,
      progress:
        job.totalRows > 0
          ? Math.min(100, Math.round((job.processedRows / job.totalRows) * 100))
          : 0,
    };
  }

  private toPublicRowError(job: MultiSheetJob, error: ImportRowError) {
    return {
      row: error.rowIndex,
      sheetId: error.sheetId,
      code: error.errorCode,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
      correlationId: job.correlationId,
      editableFields: error.editableFields,
      retried: error.retried,
      ...(error.retriedSuccess !== undefined
        ? { retriedSuccess: error.retriedSuccess }
        : {}),
    };
  }

  private getJobOrThrow(jobId: string, userId: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException('No se encontro la importacion solicitada');
    }
    if (job.userId !== userId) {
      // Same response as a nonexistent job: a foreign id must not confirm
      // existence (url-identifier-policy §5).
      throw new NotFoundException('No se encontro la importacion solicitada');
    }
    return job;
  }

  private cleanupExpiredJobs() {
    const now = Date.now();
    for (const [jobId, job] of this.jobs.entries()) {
      const referenceTime =
        job.completedAt?.getTime() ?? job.startedAt.getTime();
      if (now - referenceTime > JOB_TTL_MS) {
        this.jobs.delete(jobId);
      }
    }
  }

  private async loadExistingKeys(
    sheetId: SheetId,
    organizationId: string,
  ): Promise<Set<string>> {
    let keys: string[] = [];

    switch (sheetId) {
      case 'productos': {
        const products = await this.prisma.product.findMany({
          where: { organizationId },
          select: { sku: true },
        });
        keys = products
          .map((product) => normalizeLookupKey(product.sku))
          .filter(Boolean);
        break;
      }
      case 'clientes': {
        const customers = await this.prisma.customer.findMany({
          where: { organizationId },
          select: { documentNumber: true },
        });
        keys = customers
          .map((customer) => normalizeLookupKey(customer.documentNumber))
          .filter(Boolean);
        break;
      }
      case 'proveedores': {
        const suppliers = await this.prisma.supplier.findMany({
          where: { organizationId },
          select: { documentNumber: true },
        });
        keys = suppliers
          .map((supplier) => normalizeLookupKey(supplier.documentNumber))
          .filter(Boolean);
        break;
      }
      case 'usuarios': {
        const memberships = await this.prisma.organizationUser.findMany({
          where: { organizationId },
          select: { user: { select: { email: true } } },
        });
        keys = memberships
          .map((membership) => normalizeLookupKey(membership.user.email))
          .filter(Boolean);
        break;
      }
    }

    return new Set(keys);
  }

  private validateIncomingFile(file: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw new BadRequestException('Archivo no recibido o invalido');
    }

    const lowerName = file.originalname.toLowerCase();
    if (!lowerName.endsWith('.xlsx')) {
      throw new BadRequestException(
        'Formato no soportado. Usa un archivo .xlsx',
      );
    }
  }

  private async parseWorkbook(buffer: Buffer): Promise<ParsedWorkbookSheet[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    if (workbook.worksheets.length === 0) {
      throw new UnprocessableEntityException(
        'El archivo Excel no contiene hojas',
      );
    }

    const sheets: ParsedWorkbookSheet[] = [];

    for (const worksheet of workbook.worksheets) {
      const headerRow = worksheet.getRow(1);
      const maxColumns = Math.max(headerRow.cellCount, worksheet.columnCount);

      if (maxColumns === 0) {
        throw new UnprocessableEntityException(
          'No se detectaron columnas en el archivo',
        );
      }

      const headers: string[] = [];
      for (let i = 1; i <= maxColumns; i += 1) {
        headers.push(this.cellValueToString(headerRow.getCell(i).value));
      }

      const rows: ParsedFileRow[] = [];
      for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
        const row = worksheet.getRow(rowIndex);
        const rawData: Record<string, string> = {};
        let hasValues = false;

        headers.forEach((header, headerIndex) => {
          if (!header) {
            return;
          }
          const value = this.cellValueToString(
            row.getCell(headerIndex + 1).value,
          );
          rawData[header] = value;
          if (value.length > 0) {
            hasValues = true;
          }
        });

        if (hasValues) {
          rows.push({ rowIndex, rawData });
        }
      }

      sheets.push({
        name: worksheet.name,
        sheetId: this.resolveSheetId(worksheet.name),
        headers,
        rows,
      });
    }

    return sheets;
  }

  private resolveSheetId(name: string): SheetId | undefined {
    const normalized = normalizeHeader(name);
    return SHEET_ORDER.find((sheetId) => sheetId === normalized);
  }

  private addEvent(
    job: MultiSheetJob,
    type: ImportEventType,
    message: string,
    rowIndex: number,
  ) {
    job.recentEvents.push({
      type,
      message,
      rowIndex,
      timestamp: new Date(),
    });
    if (job.recentEvents.length > MAX_RECENT_EVENTS) {
      job.recentEvents.shift();
    }
  }

  private cellValueToString(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (typeof value === 'object') {
      if ('text' in value && typeof value.text === 'string') {
        return value.text.trim();
      }
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText
          .map((entry) => entry?.text ?? '')
          .join('')
          .trim();
      }
      if ('result' in value) {
        return this.cellValueToString(value.result as ExcelJS.CellValue);
      }
    }
    return String(value).trim();
  }
}
