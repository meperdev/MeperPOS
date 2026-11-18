import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmPurchaseOrderDto } from './confirm-purchase-order.dto';

async function dateErrors(expectedDeliveryDate?: unknown) {
  const dto = plainToInstance(ConfirmPurchaseOrderDto, {
    expectedDeliveryDate,
  });
  return validate(dto);
}

describe('ConfirmPurchaseOrderDto expectedDeliveryDate', () => {
  it('is optional, so a confirmation without a date keeps working', async () => {
    expect(await dateErrors(undefined)).toHaveLength(0);
  });

  it('accepts a calendar day', async () => {
    expect(await dateErrors('2026-11-25')).toHaveLength(0);
  });

  it.each([
    '2026-02-31',
    '25/11/2026',
    '2026-11',
    'hoy',
    '2026-11-25T10:00:00Z',
  ])('rejects %s', async (value) => {
    expect((await dateErrors(value)).length).toBeGreaterThan(0);
  });
});
