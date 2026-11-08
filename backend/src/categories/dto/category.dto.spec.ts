import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';

describe('Category tax code DTO shape', () => {
  const baseCreate = { name: 'Bebidas' };

  it('rejects an unknown default tax code', async () => {
    const dto = plainToInstance(UpdateCategoryDto, {
      defaultTaxCode: 'IVA19',
    });

    const errors = await validate(dto);

    const codeErrors = errors.find((e) => e.property === 'defaultTaxCode');
    expect(codeErrors).toBeDefined();
    expect(codeErrors!.constraints).toHaveProperty('isEnum');
  });

  it('accepts a known default tax code on create', async () => {
    const dto = plainToInstance(CreateCategoryDto, {
      ...baseCreate,
      defaultTaxCode: 'IVA',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.defaultTaxCode).toBe('IVA');
  });

  it('lets an explicit null pass for clearing the default tax code', async () => {
    const dto = plainToInstance(UpdateCategoryDto, { defaultTaxCode: null });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.defaultTaxCode).toBeNull();
  });

  it('keeps the code optional', async () => {
    const dto = plainToInstance(CreateCategoryDto, baseCreate);

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.defaultTaxCode).toBeUndefined();
  });
});
