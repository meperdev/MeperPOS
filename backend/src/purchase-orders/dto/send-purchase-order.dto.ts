import { ApiProperty } from '@nestjs/swagger';
import { IsExpectedDeliveryDate } from './expected-delivery-date.decorator';

/**
 * Body of the first send. Every field is optional: a send with no date keeps
 * whatever the confirmation stored, which is what older callers expect.
 */
export class SendPurchaseOrderDto {
  @ApiProperty({
    required: false,
    example: '2026-12-01',
    description:
      'Calendar day the supplier is expected to deliver (YYYY-MM-DD). Only applied on the first send, before the document is frozen.',
  })
  @IsExpectedDeliveryDate()
  expectedDeliveryDate?: string;
}
