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
  @Matches(/^\d+(?:\.\d{1,2})?$/)
  amount: string;
}
