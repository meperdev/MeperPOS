import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Reference-based replacement of a completed payroll payment (S6, S7; L327
 * "Referenciarlos sin cobrar de nuevo"; L338 option A).
 *
 * The caller names the completed payment and the installments of it that are
 * valid. Those installments' cash is counted as already paid on the new payment
 * without a new cash outflow, so the amount is never an input: the server reads
 * it from the locked source outflows. Amounts, totals, the new payment's state
 * and the referenced cash identity all stay server-owned.
 *
 * The period is optional but must be stated as a whole: the writer derives it
 * from the source's shift dates (grouped payment) or from the source period
 * (fixed-period payment) when it is omitted.
 */
export class CreatePayrollReplacementPaymentDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  sourceObligationId: string;

  // Valid installments of the completed payment. Each one is counted once.
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Matches(/\S/, { each: true })
  @MaxLength(200, { each: true })
  installmentIds: string[];

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  periodStart?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  periodEnd?: string | null;
}
