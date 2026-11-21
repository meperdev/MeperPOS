import { applyDecorators } from '@nestjs/common';
import { IsDateString, IsOptional, Matches } from 'class-validator';

/**
 * Optional `YYYY-MM-DD` calendar day, the only shape a purchase order's expected
 * delivery date accepts. Confirm and send share it so the same bad input gets
 * the same message on either route.
 */
export function IsExpectedDeliveryDate(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    IsDateString(
      { strict: true },
      { message: 'La fecha de entrega esperada no es una fecha válida' },
    ),
    Matches(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'La fecha de entrega esperada debe tener el formato AAAA-MM-DD',
    }),
  );
}
