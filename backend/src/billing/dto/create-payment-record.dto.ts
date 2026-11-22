import {
  IsString,
  IsNumber,
  IsDateString,
  IsEnum,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { PaymentMethod, PaymentRecordStatus } from '@prisma/client';

export class CreatePaymentRecordDto {
  @IsString()
  @MaxLength(64)
  organizationId: string;

  @IsNumber()
  amount: number;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsDateString()
  @IsOptional()
  date?: string;

  @IsEnum(PaymentRecordStatus)
  @IsOptional()
  status?: PaymentRecordStatus;
}
