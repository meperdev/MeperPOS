import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class LoanOperationDto {
  @ApiProperty({
    description: 'Stable retry key, scoped to this loan',
    maxLength: 100,
  })
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.requestKey)
  @IsString()
  @Matches(/\S/)
  @MinLength(1)
  @MaxLength(100)
  requestKey: string;
}

export class CollectLoanDto extends LoanOperationDto {
  @ApiProperty({ minimum: 0.01, maximum: 99999999.99, example: 40.25 })
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.amount)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  amount: number;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;
}

export class ReasonLoanDto extends LoanOperationDto {
  @ApiProperty({ maxLength: 500, example: 'Corrección de abono' })
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    typeof obj.reason === 'string' ? obj.reason.trim() : obj.reason,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}

export class ReverseLoanDto extends ReasonLoanDto {}
