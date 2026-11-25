import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Trimmed so a padded note is stored once, without surrounding spaces. */
const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class StockTransferItemDto {
  @ApiProperty({ description: 'Tracked product to move' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 1, example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateStockTransferDto {
  @ApiProperty({ description: 'Site the stock leaves' })
  @IsUUID()
  fromLocationId!: string;

  @ApiProperty({ description: 'Site the stock travels to' })
  @IsUUID()
  toLocationId!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [StockTransferItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockTransferItemDto)
  items!: StockTransferItemDto[];
}
