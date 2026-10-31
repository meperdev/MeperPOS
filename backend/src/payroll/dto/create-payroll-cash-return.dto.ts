import { PaymentMethod } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * A real full reimbursement of one already-paid installment (S7/S8).
 *
 * The actor states only the two facts the approved decisions leave to a human:
 * the day the money actually came back (L325) and the real method it came back by
 * (L330). The returned amount is NOT an input: one return covers exactly one
 * complete installment (L329), so the writer takes the amount from the locked cash
 * outflow instead of trusting a client-supplied number.
 */
export class CreatePayrollCashReturnDto {
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
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  installmentId: string;

  @IsDateString({ strict: true })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  returnDate: string;

  @IsEnum(PaymentMethod)
  returnMethod: PaymentMethod;
}
