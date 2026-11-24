import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSaleDto, UpdateSaleDto } from './sales.dto';

/**
 * The HTTP contract of the sales DTOs. SEC-013 removed `RETURNED_PARTIAL` from
 * the update contract until a partial return restocks inventory and records its
 * movement, and SEC-014 added the optional idempotency key to the create
 * contract. The global ValidationPipe answers 400 for any constraint violated
 * here, so these assertions are the request-level behaviour.
 */
describe('sales DTO contract', () => {
  const validItems = [{ productId: 'prod-1', quantity: 1 }];
  const validPayments = [{ method: 'CASH', amount: 1000 }];

  describe('UpdateSaleDto (SEC-013)', () => {
    it.each(['COMPLETED', 'CANCELLED'] as const)(
      'accepts the supported status %s',
      async (status) => {
        const dto = plainToInstance(UpdateSaleDto, { status });

        await expect(validate(dto)).resolves.toHaveLength(0);
        expect(dto.status).toBe(status);
      },
    );

    it('rejects RETURNED_PARTIAL until a partial return is a real return', async () => {
      const dto = plainToInstance(UpdateSaleDto, {
        status: 'RETURNED_PARTIAL',
      });

      const errors = await validate(dto);

      const statusErrors = errors.find((error) => error.property === 'status');
      expect(statusErrors).toBeDefined();
      expect(statusErrors!.constraints).toHaveProperty('isEnum');
    });

    it('still accepts a cancel reason without a status', async () => {
      const dto = plainToInstance(UpdateSaleDto, {
        cancelReason: 'Cliente arrepentido',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
    });
  });

  describe('SaleItemDto quantity', () => {
    // The same pipe `configureErrorHandling` installs on the running server, so
    // implicit conversion and whitelisting behave as in production.
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const create = (quantity: unknown) =>
      pipe.transform(
        {
          items: [{ productId: 'prod-1', quantity }],
          payments: validPayments,
        },
        { type: 'body', metatype: CreateSaleDto },
      );

    it.each([1.5, 2.7, '2.7'])(
      'rejects the fractional quantity %j',
      async (quantity) => {
        await expect(create(quantity)).rejects.toThrow(BadRequestException);
      },
    );

    it.each([0, 2147483648])(
      'rejects the out-of-range quantity %s',
      async (quantity) => {
        await expect(create(quantity)).rejects.toThrow(BadRequestException);
      },
    );

    it.each([
      [1, 1],
      [2, 2],
      ['2', 2],
      [2147483647, 2147483647],
    ])('accepts the integer quantity %j', async (quantity, expected) => {
      const dto = await create(quantity);

      expect(dto.items[0].quantity).toBe(expected);
    });
  });

  describe('CreateSaleDto requestKey (SEC-014)', () => {
    const withKey = (requestKey: unknown) =>
      plainToInstance(CreateSaleDto, {
        items: validItems,
        payments: validPayments,
        requestKey,
      });

    it.each([8, 128])('accepts a %i-character request key', async (length) => {
      const dto = withKey('k'.repeat(length));

      await expect(validate(dto)).resolves.toHaveLength(0);
      expect(dto.requestKey).toBe('k'.repeat(length));
    });

    it.each([7, 129])('rejects a %i-character request key', async (length) => {
      const errors = await validate(withKey('k'.repeat(length)));

      const keyErrors = errors.find((error) => error.property === 'requestKey');
      expect(keyErrors).toBeDefined();
      expect(
        keyErrors!.constraints?.minLength ?? keyErrors!.constraints?.maxLength,
      ).toBeDefined();
    });

    it('rejects a request key that is not a string', async () => {
      const errors = await validate(withKey(12345678));

      const keyErrors = errors.find((error) => error.property === 'requestKey');
      expect(keyErrors).toBeDefined();
      expect(keyErrors!.constraints).toHaveProperty('isString');
    });

    it('keeps the request key optional', async () => {
      const dto = plainToInstance(CreateSaleDto, {
        items: validItems,
        payments: validPayments,
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
      expect(dto.requestKey).toBeUndefined();
    });
  });
});
