import { ApiPropertyOptional } from '@nestjs/swagger';
import { ExpensePaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MaxLength,
} from 'class-validator';

export class QueryExpensesDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 10, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ example: '2026-08', pattern: '^\\d{4}-\\d{2}$' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'El formato del mes debe ser YYYY-MM',
  })
  month?: string;

  @ApiPropertyOptional({ example: 'uuid-label-id' })
  @IsOptional()
  @IsUUID()
  labelId?: string;

  @ApiPropertyOptional({ example: 'uuid-supplier-id' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ enum: ExpensePaymentStatus })
  @IsOptional()
  @IsEnum(ExpensePaymentStatus)
  status?: ExpensePaymentStatus;

  @ApiPropertyOptional({ example: 'arriendo' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
