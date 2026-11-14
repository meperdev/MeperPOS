import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// Terminal operations accept only the retry key; no quantities or reason fields.
export class InventoryLoanTerminalDto {
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    typeof obj.requestKey === 'string' ? obj.requestKey.trim() : obj.requestKey,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  requestKey: string;
}

export class InventoryLoanOperationItemDto {
  @IsUUID()
  itemId: string;

  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.quantity)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity: number;
}

export class InventoryLoanOperationDto {
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    typeof obj.requestKey === 'string' ? obj.requestKey.trim() : obj.requestKey,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  requestKey: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InventoryLoanOperationItemDto)
  items: InventoryLoanOperationItemDto[];
}
