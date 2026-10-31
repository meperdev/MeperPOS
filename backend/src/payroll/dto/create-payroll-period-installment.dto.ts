import { PaymentMethod } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreatePayrollPeriodInstallmentDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  obligationId: string;

  @IsString()
  @Matches(/^\d+(?:\.\d{1,2})?$/)
  amount: string;

  @IsDateString({ strict: true })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  date: string;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;
}
