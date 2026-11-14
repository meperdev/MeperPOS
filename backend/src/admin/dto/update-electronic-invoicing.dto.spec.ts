import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { UpdateElectronicInvoicingDto } from './update-electronic-invoicing.dto';

/**
 * The switch is narrow on purpose (spec S9): only the boolean the administrator
 * actually sent may decide whether an organization issues fiscal records.
 *
 * The global `ValidationPipe` in `app-configuration.ts` runs with
 * `enableImplicitConversion`, so these tests use the same option to prove the
 * DTO survives the wiring the server really has.
 */
function parse(body: Record<string, unknown>): UpdateElectronicInvoicingDto {
  return plainToInstance(UpdateElectronicInvoicingDto, body, {
    enableImplicitConversion: true,
  });
}

function constraintOf(errors: ValidationError[], property: string): string[] {
  const found = errors.find((error) => error.property === property);
  return Object.keys(found?.constraints ?? {});
}

describe('UpdateElectronicInvoicingDto', () => {
  it('accepts an explicit boolean in both directions', async () => {
    expect(await validate(parse({ enabled: true }))).toHaveLength(0);
    expect(await validate(parse({ enabled: false }))).toHaveLength(0);
  });

  it('requires the flag', async () => {
    const errors = await validate(parse({}));

    expect(constraintOf(errors, 'enabled')).toContain('isBoolean');
  });

  it('rejects the string "false" instead of coercing it to true', async () => {
    const dto = parse({ enabled: 'false' });
    const errors = await validate(dto);

    // Coercion would silently turn `"false"` — the most likely way a client
    // disables the flag — into `true`.
    expect(dto.enabled).toBe('false');
    expect(constraintOf(errors, 'enabled')).toContain('isBoolean');
  });

  it('rejects the string "true": activation needs a real JSON boolean', async () => {
    const errors = await validate(parse({ enabled: 'true' }));

    expect(constraintOf(errors, 'enabled')).toContain('isBoolean');
  });

  it('rejects numeric and null values', async () => {
    for (const value of [1, 0, null]) {
      const errors = await validate(parse({ enabled: value }));

      expect(constraintOf(errors, 'enabled')).toContain('isBoolean');
    }
  });
});
