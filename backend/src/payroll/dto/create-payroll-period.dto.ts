import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
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

  // S5: the expense decision is per payment and has no default. Absent or null
  // stays unspecified, so the feature can never charge an expense nobody chose.
  @IsOptional()
  @IsBoolean()
  expenseEnabled?: boolean | null;

  // Optional date-only expense date; absent or null means "the completion day".
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  selectedExpenseDate?: string | null;
}
