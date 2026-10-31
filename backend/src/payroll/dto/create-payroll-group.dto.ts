import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreatePayrollGroupDto {
  @IsString()
  @Matches(/\S/)
  employeeId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/\S/, { each: true })
  shiftIds: string[];

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
