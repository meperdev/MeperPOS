import {
  IsDateString,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreatePayrollPeriodDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  employeeId: string;

  @IsDateString({ strict: true })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  periodStart: string;

  @IsDateString({ strict: true })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  periodEnd: string;

  // Strings preserve the caller's exact decimal value and match allocation input.
  @IsString()
  @Matches(/^\d+(?:\.\d{1,2})?$/)
  periodAmount: string;
}
