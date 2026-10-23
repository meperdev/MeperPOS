import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { MonetaryLoanType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export enum CounterpartyType {
  CUSTOMER = 'CUSTOMER',
  SUPPLIER = 'SUPPLIER',
  EMPLOYEE = 'EMPLOYEE',
}

export class CreateLoanDto {
  @ApiPropertyOptional({
    enum: MonetaryLoanType,
    default: MonetaryLoanType.MONEY,
  })
  // Only omission defaults; preserve raw input under global implicit conversion.
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.type)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(MonetaryLoanType)
  type?: MonetaryLoanType;

  @ApiProperty({ example: 120.25, minimum: 0.01, maximum: 99999999.99 })
  // Keep the raw JSON number: global implicit conversion must not coerce money.
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.amount)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  amount: number;

  @ApiProperty({ example: '2026-10-09', format: 'date' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  issuedAt: string;

  @ApiPropertyOptional({ example: '2026-11-09', format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueAt?: string;

  @ApiProperty({ example: 'Anticipo acordado', maxLength: 500 })
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    typeof obj.reason === 'string' ? obj.reason.trim() : obj.reason,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;

  @ApiProperty({ enum: CounterpartyType })
  @IsEnum(CounterpartyType)
  counterpartyType: CounterpartyType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  counterpartyId: string;
}
