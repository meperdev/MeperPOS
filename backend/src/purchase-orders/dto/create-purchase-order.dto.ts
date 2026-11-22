import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsInt,
  Min,
  IsNumber,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreatePurchaseOrderItemDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(1)
  qtyOrdered: number;

  @ApiProperty({ example: 1500.0 })
  @IsNumber()
  @Min(0)
  unitCost: number;

  @ApiProperty({ example: 19, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty()
  @IsUUID()
  supplierId: string;

  @ApiProperty({ type: [CreatePurchaseOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  items: CreatePurchaseOrderItemDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
