import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class CancelPurchaseOrderDto {
  @ApiProperty({ example: 'Proveedor canceló el pedido' })
  @IsString()
  @MaxLength(500)
  @MinLength(3)
  reason: string;
}
