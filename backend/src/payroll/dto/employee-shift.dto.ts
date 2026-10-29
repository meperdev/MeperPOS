import { EmployeeShiftKind } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsDecimalAmount } from './decimal-amount.validator';

export class CreateEmployeeShiftDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  employeeId: string;

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @IsEnum(EmployeeShiftKind)
  kind: EmployeeShiftKind;

  @IsNumber()
  @IsDecimalAmount()
  @Min(0)
  @Max(9999999999.99)
  amount: number;

  @IsOptional()
  @IsString()
  observation?: string | null;
}
