import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CounterpartyType } from './create-loan.dto';

export class InventoryLoanItemDto {
  @IsUUID()
  productId: string;

  // Retain raw JSON numbers even under implicit conversion in a future pipe.
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.quantity)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity: number;
}

export class CreateInventoryLoanDto {
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    typeof obj.requestKey === 'string' ? obj.requestKey.trim() : obj.requestKey,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  requestKey: string;

  @IsEnum(CounterpartyType)
  counterpartyType: CounterpartyType;

  @IsUUID()
  counterpartyId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InventoryLoanItemDto)
  items: InventoryLoanItemDto[];
}
