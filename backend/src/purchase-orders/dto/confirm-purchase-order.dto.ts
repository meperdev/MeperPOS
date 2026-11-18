import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, Matches } from 'class-validator';

export class ConfirmPurchaseOrderDto {
  @ApiProperty({
    required: false,
    example: '2026-11-25',
    description:
      'Calendar day the supplier is expected to deliver (YYYY-MM-DD).',
  })
  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'La fecha de entrega esperada no es una fecha válida' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de entrega esperada debe tener el formato AAAA-MM-DD',
  })
  expectedDeliveryDate?: string;
}
