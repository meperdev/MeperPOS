import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class DuplicatePurchaseOrderDto {
  @ApiProperty({
    required: false,
    description:
      'Supplier for the new draft. Defaults to the supplier of the repeated order.',
  })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
}
