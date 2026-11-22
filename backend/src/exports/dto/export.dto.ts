import {
  IsEnum,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
  IsString,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger/dist/decorators';

export type ExportFormat = 'pdf' | 'excel' | 'csv';

export class ExportQueryDto {
  @ApiProperty({ enum: ['pdf', 'excel', 'csv'], example: 'pdf' })
  @IsEnum(['pdf', 'excel', 'csv'])
  format: ExportFormat;

  @ApiProperty({
    enum: ['sales', 'products', 'customers', 'inventory', 'expenses', 'economic'],
    example: 'sales',
  })
  @IsEnum(['sales', 'products', 'customers', 'inventory', 'expenses', 'economic'])
  type: 'sales' | 'products' | 'customers' | 'inventory' | 'expenses' | 'economic';

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @Transform(({ value }) => (value && value.trim() !== '' ? value : undefined))
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2024-01-31' })
  @IsOptional()
  @Transform(({ value }) => (value && value.trim() !== '' ? value : undefined))
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  limit?: number;
}

export class CsvExportDto {
  @ApiProperty({ example: ',' })
  @IsOptional()
  delimiter?: string;

  @ApiProperty({ example: 'utf-8' })
  @IsOptional()
  encoding?: string;

  @ApiProperty({ example: 'false' })
  @IsOptional()
  includeHeaders?: boolean;

  @ApiProperty({ example: 'true' })
  @IsOptional()
  bom?: boolean;
}

export class InventoryMovementsQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ example: 'uuid-product-id' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @IsNotEmpty()
  productId?: string;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @Transform(({ value }) => (value && value.trim() !== '' ? value : undefined))
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2024-01-31' })
  @IsOptional()
  @Transform(({ value }) => (value && value.trim() !== '' ? value : undefined))
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: ['json'], example: 'json' })
  @IsOptional()
  @IsEnum(['json'])
  format?: 'json';
}
