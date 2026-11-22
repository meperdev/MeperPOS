import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

// Only identity and the corrected amount: the grouped correction keeps the cash
// row's date and method, so neither can be changed through this route.
export class CorrectPayrollGroupInstallmentDto {
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

  @IsString()
  // Abuse cap only; the expense Decimal(12, 2) limit is enforced in the service, and period amounts may be larger.
  @MaxLength(40)
  @Matches(/^\d+(?:\.\d{1,2})?$/)
  amount: string;
}
