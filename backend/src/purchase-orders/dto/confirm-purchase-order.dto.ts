import { ApiProperty } from '@nestjs/swagger';
import { IsExpectedDeliveryDate } from './expected-delivery-date.decorator';

export class ConfirmPurchaseOrderDto {
  @ApiProperty({
    required: false,
    example: '2026-11-25',
    description:
      'Calendar day the supplier is expected to deliver (YYYY-MM-DD).',
  })
  @IsExpectedDeliveryDate()
  expectedDeliveryDate?: string;
}
