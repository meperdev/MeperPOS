import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  IsOptional,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SaleItemDto } from '../../sales/dto/sales.dto';

// LoansService owns quantity validation and its public error for financed POS.
class PosLoanItemDto extends OmitType(SaleItemDto, ['quantity'] as const) {
  @ApiProperty({ example: 2, minimum: 1 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  quantity: number;
}

export class CreatePosLoanDto {
  @ApiPropertyOptional({
    description: 'Explicit origin site for the POS reservation.',
  })
  @Transform(({ obj, key }) => obj[key], { toClassOnly: true })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @MaxLength(64)
  @IsNotEmpty()
  locationId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  requestKey: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  issuedAt: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueAt?: string;

  @ApiProperty({ maxLength: 500 })
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    typeof obj.reason === 'string' ? obj.reason.trim() : obj.reason,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  discountAmount?: number;

  @ApiProperty({ type: [PosLoanItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosLoanItemDto)
  items: PosLoanItemDto[];
}
