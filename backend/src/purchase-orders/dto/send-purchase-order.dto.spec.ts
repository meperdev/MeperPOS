import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmPurchaseOrderDto } from './confirm-purchase-order.dto';
import { SendPurchaseOrderDto } from './send-purchase-order.dto';

async function dateErrors(
  dtoClass: new () => object,
  expectedDeliveryDate?: unknown,
) {
  const dto = plainToInstance(dtoClass, { expectedDeliveryDate });
  return validate(dto);
}

function messages(errors: Awaited<ReturnType<typeof dateErrors>>) {
  return errors
    .flatMap((error) => Object.values(error.constraints ?? {}))
    .sort();
}

describe('SendPurchaseOrderDto expectedDeliveryDate', () => {
  it('is optional, so a send without a date keeps working', async () => {
    expect(await dateErrors(SendPurchaseOrderDto, undefined)).toHaveLength(0);
  });

  it('accepts a calendar day', async () => {
    expect(await dateErrors(SendPurchaseOrderDto, '2026-12-01')).toHaveLength(
      0,
    );
  });

  it.each([
    '2026-02-31',
    '25/11/2026',
    '2026-11',
    'hoy',
    '2026-11-25T10:00:00Z',
  ])('rejects %s', async (value) => {
    expect(
      (await dateErrors(SendPurchaseOrderDto, value)).length,
    ).toBeGreaterThan(0);
  });

  it('answers exactly what confirm answers, so both routes reject alike', async () => {
    for (const value of ['2026-02-31', 'hoy', '2026-11-25T10:00:00Z']) {
      expect(messages(await dateErrors(SendPurchaseOrderDto, value))).toEqual(
        messages(await dateErrors(ConfirmPurchaseOrderDto, value)),
      );
    }
  });
});
