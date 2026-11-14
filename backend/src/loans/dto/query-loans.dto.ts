import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { MonetaryLoanType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class QueryLoansDto {
  @ApiPropertyOptional({ enum: MonetaryLoanType })
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.type)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(MonetaryLoanType)
  type?: MonetaryLoanType;

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

  // Only AdminOrganizationInterceptor applies this selector for SUPER_ADMIN.
  // Ordinary operators always retain their authenticated organization scope.
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
