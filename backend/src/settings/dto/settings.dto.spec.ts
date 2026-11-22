import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  UpdateOrganizationNameDto,
} from './settings.dto';

/**
 * `PATCH /settings/organization` is the route the general settings page calls
 * to rename the business. Its cap must match the admin create/update
 * organization DTOs (`@MaxLength(100)`), so settings cannot bypass them and
 * print an unbounded name in the receipt header.
 *
 * The global `ValidationPipe` runs with `enableImplicitConversion`, so these
 * tests use the same option.
 */
function parse(body: Record<string, unknown>): UpdateOrganizationNameDto {
  return plainToInstance(UpdateOrganizationNameDto, body, {
    enableImplicitConversion: true,
  });
}

function constraintsOf(errors: ValidationError[], property: string): string[] {
  const found = errors.find((error) => error.property === property);
  return Object.keys(found?.constraints ?? {});
}

describe('UpdateOrganizationNameDto', () => {
  it('caps the name at the same 100 characters as the admin DTOs', () => {
    expect(ORGANIZATION_NAME_MAX_LENGTH).toBe(100);
  });

  it('accepts a normal short name', async () => {
    expect(await validate(parse({ name: 'Panadería Central' }))).toHaveLength(
      0,
    );
  });

  it('accepts a name of exactly 100 characters', async () => {
    expect(await validate(parse({ name: 'a'.repeat(100) }))).toHaveLength(0);
  });

  it('rejects a name of 101 characters', async () => {
    const errors = await validate(parse({ name: 'a'.repeat(101) }));

    expect(constraintsOf(errors, 'name')).toContain('maxLength');
  });

  it('rejects a name of 1000 characters', async () => {
    const errors = await validate(parse({ name: 'a'.repeat(1000) }));

    expect(constraintsOf(errors, 'name')).toContain('maxLength');
  });

  it('measures the trimmed name, as the service stores it', async () => {
    const dto = parse({ name: `  ${'a'.repeat(100)}  ` });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.name).toBe('a'.repeat(100));
  });

  it('rejects an empty name', async () => {
    const errors = await validate(parse({ name: '' }));

    expect(constraintsOf(errors, 'name')).toContain('isNotEmpty');
  });

  it('rejects a whitespace-only name', async () => {
    const errors = await validate(parse({ name: '   ' }));

    expect(constraintsOf(errors, 'name')).toContain('isNotEmpty');
  });

  it('rejects a missing or non-string name', async () => {
    expect(constraintsOf(await validate(parse({})), 'name')).toContain(
      'isString',
    );
    expect(
      constraintsOf(await validate(parse({ name: ['a'] })), 'name'),
    ).toContain('isString');
  });
});
