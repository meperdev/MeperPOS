import { ValidationPipe } from '@nestjs/common';
import { ReceivePurchaseOrderDto } from './receive-purchase-order.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const items = [
  { itemId: '88563200-1efe-4e97-a7c1-4932b8e9bd04', qtyReceivedNow: 1 },
];
const transform = (input: Record<string, unknown>) =>
  pipe.transform(
    { items, ...input },
    { type: 'body', metatype: ReceivePurchaseOrderDto },
  );

describe('purchase receipt destination input', () => {
  it('preserves omitted destinations and accepts the exact explicit site', async () => {
    await expect(transform({})).resolves.toMatchObject({ items });
    await expect(transform({ locationId: 'site-a' })).resolves.toMatchObject({
      items,
      locationId: 'site-a',
    });
  });

  it.each([
    [123, 'locationId must be a string'],
    [null, 'locationId must be a string'],
    ['', 'locationId should not be empty'],
  ])(
    'rejects explicitly invalid destination %p',
    async (locationId, message) => {
      await expect(transform({ locationId })).rejects.toMatchObject({
        status: 400,
        response: { message: expect.arrayContaining([message]) },
      });
    },
  );
});
