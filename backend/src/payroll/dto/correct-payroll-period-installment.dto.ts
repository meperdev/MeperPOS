import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CorrectPayrollPeriodInstallmentDto {
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
