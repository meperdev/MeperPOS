import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  MaxLength,
} from 'class-validator';

/** The four importable entity sheets processed by the multi-sheet importer. */
export const IMPORT_SHEET_IDS = [
  'productos',
  'clientes',
  'proveedores',
  'usuarios',
] as const;

export type ImportSheetId = (typeof IMPORT_SHEET_IDS)[number];

/** Per-sheet lifecycle sub-status used inside a job's per-sheet breakdown. */
export const IMPORT_SHEET_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
  'FAILED',
] as const;

export type ImportSheetStatus = (typeof IMPORT_SHEET_STATUSES)[number];

/** Overall import job lifecycle status. */
export const IMPORT_JOB_STATUSES = [
  'PARSING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;

export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export class RetryImportRowDto {
  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(2)
  rowIndex: number;

  @ApiPropertyOptional({
    enum: IMPORT_SHEET_IDS,
    description:
      'Sheet the failed row belongs to. Product-only retries default to "productos".',
  })
  @IsOptional()
  @IsIn(IMPORT_SHEET_IDS)
  sheetId?: ImportSheetId;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: {
      name: 'Coca Cola 400ml',
      sku: 'BEB-001',
      salePrice: 4800,
      stock: 25,
      category: 'Bebidas',
    },
  })
  @IsObject()
  correctedData: Record<string, unknown>;
}

/** A reported row error carrying its originating sheet and retry state. */
export class ImportRowErrorDto {
  @ApiProperty({ example: 5 })
  @IsInt()
  row: number;

  @ApiProperty({ enum: IMPORT_SHEET_IDS })
  @IsIn(IMPORT_SHEET_IDS)
  sheetId: ImportSheetId;

  @ApiProperty({ example: 'INVALID_PRICE' })
  @IsString()
  @MaxLength(64)
  code: string;

  @ApiProperty({ example: 'Precio de venta invalido' })
  @IsString()
  @MaxLength(1000)
  message: string;

  @ApiPropertyOptional({ example: 'salePrice' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  field?: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  editableFields: string[];

  @ApiProperty({ example: false })
  @IsOptional()
  @IsBoolean()
  retried: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  retriedSuccess?: boolean;

  @ApiProperty({ example: 'request-id' })
  @IsString()
  @MaxLength(128)
  correlationId: string;
}

/** Per-sheet counters and sub-status returned in a job's per-sheet breakdown. */
export class ImportSheetStatusDto {
  @ApiProperty({ enum: IMPORT_SHEET_IDS })
  @IsIn(IMPORT_SHEET_IDS)
  sheetId: ImportSheetId;

  @ApiProperty({ enum: IMPORT_SHEET_STATUSES })
  @IsIn(IMPORT_SHEET_STATUSES)
  status: ImportSheetStatus;

  @ApiProperty({ example: 10 })
  @IsInt()
  totalRows: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  processedRows: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  imported: number;

  @ApiProperty({ example: 0 })
  @IsInt()
  skipped: number;

  @ApiProperty({ example: 0 })
  @IsInt()
  errors: number;

  @ApiProperty({ example: 0 })
  @IsInt()
  warnings: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  missingRequiredFields?: string[];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  planLimitRejected?: boolean;

  @ApiPropertyOptional({ example: 'Supera el limite del plan' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  planLimitMessage?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'True when the sheet was rejected by the caller role gate.',
  })
  @IsOptional()
  @IsBoolean()
  roleRejected?: boolean;

  @ApiPropertyOptional({ example: 'La hoja usuarios requiere rol ADMIN' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  roleRejectedMessage?: string;

  @ApiProperty({ type: [ImportRowErrorDto] })
  @ValidateNested({ each: true })
  @Type(() => ImportRowErrorDto)
  rowErrors: ImportRowErrorDto[];
}

/** Shape of the multi-entity import job status / per-sheet breakdown. */
export class ImportJobStatusResponseDto {
  @ApiProperty({ example: 'a1b2c3d4' })
  @IsString()
  @MaxLength(64)
  jobId: string;

  @ApiProperty({ enum: IMPORT_JOB_STATUSES })
  @IsIn(IMPORT_JOB_STATUSES)
  status: ImportJobStatus;

  @ApiProperty({ example: 10 })
  @IsNumber()
  totalRows: number;

  @ApiProperty({ example: 10 })
  @IsNumber()
  processedRows: number;

  @ApiProperty({ example: 10 })
  @IsNumber()
  importedCount: number;

  @ApiProperty({ example: 0 })
  @IsNumber()
  skippedCount: number;

  @ApiProperty({ example: 0 })
  @IsNumber()
  errorCount: number;

  @ApiProperty({ example: 0 })
  @IsNumber()
  warningCount: number;

  @ApiProperty({ type: [ImportSheetStatusDto] })
  @ValidateNested({ each: true })
  @Type(() => ImportSheetStatusDto)
  sheets: ImportSheetStatusDto[] = [];

  @ApiProperty({ type: [ImportRowErrorDto] })
  @ValidateNested({ each: true })
  @Type(() => ImportRowErrorDto)
  errors: ImportRowErrorDto[] = [];
}
