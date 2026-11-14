import { ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryLoanStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { CounterpartyType } from './create-loan.dto';

// History advertises only pagination: its service does not apply list filters.
export class InventoryLoanHistoryQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class QueryInventoryLoansDto extends InventoryLoanHistoryQueryDto {
  @ApiPropertyOptional({ enum: InventoryLoanStatus })
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.status)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(InventoryLoanStatus)
  status?: InventoryLoanStatus;

  @ApiPropertyOptional({ enum: CounterpartyType })
  @Transform(
    ({ obj }: { obj: Record<string, unknown> }) => obj.counterpartyType,
  )
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(CounterpartyType)
  counterpartyType?: CounterpartyType;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.counterpartyId)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  counterpartyId?: string;
}
