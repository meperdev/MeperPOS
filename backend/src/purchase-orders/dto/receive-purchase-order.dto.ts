import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayUnique,
  IsInt,
  Min,
  IsUUID,
  IsString,
  IsNotEmpty,
  ValidateIf,
} from 'class-validator';

export class ReceivePurchaseOrderItemDto {
  @ApiProperty()
  @IsUUID()
  itemId: string;

  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(1)
  qtyReceivedNow: number;
}

export class ReceivePurchaseOrderDto {
  @ApiPropertyOptional({ description: 'Explicit destination for this receipt.' })
  @Transform(({ obj, key }) => obj[key], { toClassOnly: true })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  locationId?: string;

  @ApiProperty({ type: [ReceivePurchaseOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: ReceivePurchaseOrderItemDto) => item.itemId)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseOrderItemDto)
  items: ReceivePurchaseOrderItemDto[];
}
