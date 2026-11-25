import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ProductSiteQueryDto,
  ProductSiteQueryPipe,
} from './product-site.query';

/**
 * T3f — the POS reads one site, and the site it asks for is a query value.
 *
 * The site is optional: without it every reader keeps answering with the
 * organization aggregate. When it is present the boundary accepts only the
 * string shape the site id has, so an oversized value never reaches the
 * authorization read.
 */
describe('ProductSiteQueryDto', () => {
  const errorsFor = (locationId: unknown) =>
    validate(plainToInstance(ProductSiteQueryDto, { locationId }));

  it('accepts an omitted site', async () => {
    await expect(errorsFor(undefined)).resolves.toEqual([]);
  });

  it('accepts a site id at the length bound', async () => {
    await expect(errorsFor('a'.repeat(64))).resolves.toEqual([]);
  });

  it('rejects a site id over the length bound', async () => {
    const errors = await errorsFor('a'.repeat(65));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('locationId');
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('rejects a non-string site', async () => {
    const errors = await errorsFor(42);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('locationId');
    expect(errors[0].constraints).toHaveProperty('isString');
  });
});

describe('ProductSiteQueryPipe', () => {
  const pipe = new ProductSiteQueryPipe();

  it('passes an omitted site through untouched', async () => {
    await expect(pipe.transform(undefined)).resolves.toBeUndefined();
  });

  it('passes a valid site id through', async () => {
    await expect(pipe.transform('0f7c4f4e-site')).resolves.toBe(
      '0f7c4f4e-site',
    );
  });

  it('rejects an oversized site with the canonical validation envelope', async () => {
    const failure = await pipe
      .transform('a'.repeat(65))
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BadRequestException);
    const exception = failure as BadRequestException;
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toMatchObject({
      code: 'VALIDATION_ERROR',
      error: 'Bad Request',
    });
    expect(exception.getResponse()).toHaveProperty('message');
  });
});
