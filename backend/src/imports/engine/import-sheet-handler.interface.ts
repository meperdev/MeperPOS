import type { OrgRole } from '@prisma/client';
import type { SheetColumnDetectionResult } from '../helpers/column-detector';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PlanLimitService } from '../../plan-limits/plan-limits.service';

/**
 * Identifies one of the four importable entity sheets processed by the
 * multi-sheet importer.
 */
export type SheetId = 'productos' | 'clientes' | 'proveedores' | 'usuarios';

/**
 * Lifecycle sub-status of a single sheet inside an import job.
 *
 * `REJECTED` is used when a sheet fails a hard, sheet-level check (e.g. a
 * missing required column or a plan-limit breach) while sibling sheets keep
 * processing.
 */
export type SheetStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'FAILED';

/**
 * A raw worksheet row: its 1-based row index plus its key-value cells
 * (normalized column header -> raw cell value).
 */
export interface ParsedFileRow {
  rowIndex: number;
  rawData: Record<string, string>;
}

/** A per-row validation failure surfaced to the import report. */
export interface RowError {
  errorCode: string;
  message: string;
  field?: string;
  mappedData: Record<string, unknown>;
}

/** A reported row error carrying its originating sheet and retry state. */
export interface ImportRowError extends RowError {
  rowIndex: number;
  sheetId: SheetId;
  editableFields: string[];
  retried: boolean;
  retriedSuccess?: boolean;
}

/** Per-sheet counters and sub-status tracked on an import job. */
export interface ImportSheetStatus {
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
  rowErrors?: Array<Record<string, unknown>>;
}

/** Runtime context handed to a handler while processing a sheet row. */
export interface SheetRowContext {
  organizationId: string;
  userId: string;
  /** Role of the importing user; the users sheet passes it to UsersService. */
  actorRole?: OrgRole | 'SUPER_ADMIN';
  prisma: PrismaService;
  planLimits: PlanLimitService;
  existingKeys: Set<string>;
}

/** Result of {@link ImportSheetHandler.validateRow}. */
export type ValidationResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: RowError };

/**
 * A per-entity sheet importer: column detection, per-row validation and row
 * creation, all scoped to the JWT organization.
 */
export interface ImportSheetHandler {
  sheetId: SheetId;
  requiredFields: string[];
  editableFields: string[];
  detectColumns(headers: string[]): SheetColumnDetectionResult;
  validateRow(row: ParsedFileRow, ctx: SheetRowContext): ValidationResult;
  createRow(data: Record<string, unknown>, ctx: SheetRowContext): Promise<void>;
}
