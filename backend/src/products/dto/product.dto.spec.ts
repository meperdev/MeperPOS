import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto, UpdateProductDto } from './product.dto';

describe('Product promotion DTO shape', () => {
  const baseCreate = {
    name: 'Test Product',
    sku: 'SKU-001',
    costPrice: 100,
    salePrice: 19900,
    stock: 10,
    minStock: 5,
    categoryId: '123e4567-e89b-12d3-a456-426614174000',
  };

  it('accepts a valid promotion payload', async () => {
    const dto = plainToInstance(CreateProductDto, {
      ...baseCreate,
      promotionType: 'PERCENTAGE',
      promotionValue: 15,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects a non-number promotionValue', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      promotionValue: 'half-price',
    });

    const errors = await validate(dto);

    const valueErrors = errors.find((e) => e.property === 'promotionValue');
    expect(valueErrors).toBeDefined();
    expect(valueErrors!.constraints).toHaveProperty('isNumber');
  });

  it('rejects a negative promotionValue', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      promotionValue: -5,
    });

    const errors = await validate(dto);

    const valueErrors = errors.find((e) => e.property === 'promotionValue');
    expect(valueErrors).toBeDefined();
    expect(valueErrors!.constraints).toHaveProperty('min');
  });

  it('rejects an unknown promotionType', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      promotionType: 'BUY_ONE_GET_ONE',
    });

    const errors = await validate(dto);

    const typeErrors = errors.find((e) => e.property === 'promotionType');
    expect(typeErrors).toBeDefined();
    expect(typeErrors!.constraints).toHaveProperty('isEnum');
  });

  it('lets an explicit null pass for clearing the promotion', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      promotionType: null,
      promotionValue: null,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.promotionType).toBeNull();
    expect(dto.promotionValue).toBeNull();
  });
});

describe('Product tax code DTO shape', () => {
  const baseCreate = {
    name: 'Test Product',
    sku: 'SKU-001',
    costPrice: 100,
    salePrice: 19900,
    stock: 10,
    minStock: 5,
    categoryId: '123e4567-e89b-12d3-a456-426614174000',
  };

  it('rejects a tax code when taxable is false', async () => {
    const dto = plainToInstance(CreateProductDto, {
      ...baseCreate,
      taxable: false,
      taxCode: 'IVA',
    });

    const errors = await validate(dto);

    const codeErrors = errors.find((e) => e.property === 'taxCode');
    expect(codeErrors).toBeDefined();
    expect(codeErrors!.constraints).toHaveProperty('taxCodeRequiresTaxable');
  });

  it('rejects a tax code on an update that declares taxable false', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      taxable: false,
      taxCode: 'ICA',
    });

    const errors = await validate(dto);

    const codeErrors = errors.find((e) => e.property === 'taxCode');
    expect(codeErrors).toBeDefined();
    expect(codeErrors!.constraints).toHaveProperty('taxCodeRequiresTaxable');
  });

  it('accepts a taxable product that omits the code (resolves to IVA)', async () => {
    const dto = plainToInstance(CreateProductDto, {
      ...baseCreate,
      taxable: true,
      taxRate: 19,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts an explicit code on a taxable product', async () => {
    const dto = plainToInstance(CreateProductDto, {
      ...baseCreate,
      taxable: true,
      taxRate: 8,
      taxCode: 'INC',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.taxCode).toBe('INC');
  });

  it('rejects an unknown tax code', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      taxable: true,
      taxCode: 'IVA19',
    });

    const errors = await validate(dto);

    const codeErrors = errors.find((e) => e.property === 'taxCode');
    expect(codeErrors).toBeDefined();
    expect(codeErrors!.constraints).toHaveProperty('isEnum');
  });

  it('lets an explicit null pass for clearing the code', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      taxable: true,
      taxCode: null,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.taxCode).toBeNull();
  });
});

// Explorer F28: stock is counted in whole units (Product.stock/minStock and
// InventoryMovement quantities are Int), so a fractional value must be refused
// at the boundary instead of reaching Prisma or being silently truncated.
describe('Product stock DTO shape', () => {
  const baseCreate = {
    name: 'Test Product',
    sku: 'SKU-001',
    costPrice: 100,
    salePrice: 19900,
    stock: 10,
    minStock: 5,
    categoryId: '123e4567-e89b-12d3-a456-426614174000',
  };

  it.each(['stock', 'minStock'] as const)(
    'rejects a fractional %s on create',
    async (field) => {
      const dto = plainToInstance(CreateProductDto, {
        ...baseCreate,
        [field]: 2.5,
      });

      const errors = await validate(dto);

      const fieldErrors = errors.find((e) => e.property === field);
      expect(fieldErrors).toBeDefined();
      expect(fieldErrors!.constraints).toHaveProperty('isInt');
    },
  );

  it.each(['stock', 'minStock'] as const)(
    'rejects a fractional %s on update',
    async (field) => {
      const dto = plainToInstance(UpdateProductDto, { [field]: 2.5 });

      const errors = await validate(dto);

      const fieldErrors = errors.find((e) => e.property === field);
      expect(fieldErrors).toBeDefined();
      expect(fieldErrors!.constraints).toHaveProperty('isInt');
    },
  );

  it.each([
    [0, 0],
    [7, 3],
  ])(
    'accepts integer stock %i and minStock %i on create and update',
    async (stock, minStock) => {
      const created = plainToInstance(CreateProductDto, {
        ...baseCreate,
        stock,
        minStock,
      });
      const updated = plainToInstance(UpdateProductDto, { stock, minStock });

      expect(await validate(created)).toHaveLength(0);
      expect(await validate(updated)).toHaveLength(0);
      expect(created.stock).toBe(stock);
      expect(updated.minStock).toBe(minStock);
    },
  );

  it('still rejects negative integer stock', async () => {
    const dto = plainToInstance(UpdateProductDto, { stock: -1 });

    const errors = await validate(dto);

    const fieldErrors = errors.find((e) => e.property === 'stock');
    expect(fieldErrors).toBeDefined();
    expect(fieldErrors!.constraints).toHaveProperty('min');
  });

  it('keeps decimal prices valid', async () => {
    const dto = plainToInstance(CreateProductDto, {
      ...baseCreate,
      costPrice: 99.5,
      salePrice: 149.99,
      taxRate: 8.5,
    });

    expect(await validate(dto)).toHaveLength(0);
  });
});
