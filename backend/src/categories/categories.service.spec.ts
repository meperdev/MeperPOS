import { CategoriesService } from './categories.service';
import { Decimal } from '@prisma/client/runtime/library';

describe('CategoriesService', () => {
  let service: CategoriesService;
  const orgId = 'org-1';
  const prismaMock = {
    category: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CategoriesService(prismaMock as never);
  });

  describe('findAll', () => {
    it('filters by organizationId and returns productCount', async () => {
      prismaMock.category.findMany.mockResolvedValue([
        {
          id: 'cat-zero',
          name: 'Sin productos',
          description: null,
          defaultTaxRate: new Decimal('19.50'),
          active: true,
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          updatedAt: new Date('2026-03-01T00:00:00.000Z'),
          _count: { products: 0 },
        },
        {
          id: 'cat-two',
          name: 'Con productos',
          description: null,
          defaultTaxRate: null,
          active: true,
          createdAt: new Date('2026-03-02T00:00:00.000Z'),
          updatedAt: new Date('2026-03-02T00:00:00.000Z'),
          _count: { products: 2 },
        },
      ]);
      prismaMock.category.count.mockResolvedValue(2);

      const result = await service.findAll(orgId, 1, 10);

      expect(prismaMock.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: orgId,
            active: true,
          }),
        }),
      );
      expect(prismaMock.category.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: orgId,
            active: true,
          }),
        }),
      );
      expect(result.data).toHaveLength(2);
      expect(result.data[0].productCount).toBe(0);
      expect(result.data[0].defaultTaxRate).toBe(19.5);
      expect(result.data[1].productCount).toBe(2);
      expect(result.data[1].defaultTaxRate).toBeNull();
    });

    it('includes search filter when provided', async () => {
      prismaMock.category.findMany.mockResolvedValue([]);
      prismaMock.category.count.mockResolvedValue(0);

      await service.findAll(orgId, 1, 10, 'electronics');

      expect(prismaMock.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: orgId,
            active: true,
            OR: expect.any(Array),
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns category when found in organization', async () => {
      prismaMock.category.findFirst.mockResolvedValue({
        id: 'cat-3',
        name: 'Ferretera',
        description: null,
        defaultTaxRate: new Decimal('7.75'),
        active: true,
        products: [],
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      });

      const result = await service.findOne('cat-3', orgId);

      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'cat-3', organizationId: orgId },
        include: { products: true },
      });
      expect(result.defaultTaxRate).toBe(7.75);
    });

    it('throws NotFoundException when category not in organization', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(service.findOne('cat-999', orgId)).rejects.toThrow(
        'Category not found',
      );
    });
  });

  describe('create', () => {
    it('creates category scoped to organization', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);
      prismaMock.category.create.mockResolvedValue({
        id: 'cat-2',
        name: 'Accesorios',
        description: null,
        defaultTaxRate: new Decimal('16.25'),
        active: true,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      });

      const result = await service.create(
        { name: 'Accesorios', defaultTaxRate: 16.25 },
        orgId,
      );

      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { name: 'Accesorios', organizationId: orgId },
      });
      expect(prismaMock.category.create).toHaveBeenCalledWith({
        data: {
          name: 'Accesorios',
          defaultTaxRate: 16.25,
          organizationId: orgId,
        },
      });
      expect(result.defaultTaxRate).toBe(16.25);
    });

    it('throws ConflictException when name exists in organization', async () => {
      prismaMock.category.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.create({ name: 'Existing' }, orgId)).rejects.toThrow(
        'Category already exists',
      );
    });
  });

  describe('update', () => {
    it('updates category within organization', async () => {
      prismaMock.category.findFirst.mockResolvedValue({
        id: 'cat-1',
        name: 'Electrnica',
        active: true,
      });
      prismaMock.category.update.mockResolvedValue({
        id: 'cat-1',
        name: 'Electrnica',
        description: null,
        defaultTaxRate: null,
        active: true,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      });

      const result = await service.update(
        'cat-1',
        { defaultTaxRate: null },
        orgId,
      );

      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'cat-1', organizationId: orgId },
      });
      expect(prismaMock.category.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cat-1' },
          data: { defaultTaxRate: null },
        }),
      );
      expect(result.defaultTaxRate).toBeNull();
    });

    it('throws NotFoundException when category not in organization', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(
        service.update('cat-999', { name: 'X' }, orgId),
      ).rejects.toThrow('Category not found');
    });

    it('throws ConflictException when new name exists in organization', async () => {
      prismaMock.category.findFirst
        .mockResolvedValueOnce({ id: 'cat-1', name: 'Old', active: true })
        .mockResolvedValueOnce({ id: 'other' });

      await expect(
        service.update('cat-1', { name: 'New' }, orgId),
      ).rejects.toThrow('Category name already exists');
    });
  });

  describe('remove', () => {
    it('soft-deletes category within organization', async () => {
      prismaMock.category.findFirst.mockResolvedValue({
        id: 'cat-1',
        name: 'X',
        active: true,
        products: [],
      });
      prismaMock.category.update.mockResolvedValue({
        id: 'cat-1',
        name: 'X',
        active: false,
      });

      const result = await service.remove('cat-1', orgId);

      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'cat-1', organizationId: orgId },
        include: { products: true },
      });
      expect(prismaMock.category.update).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it('throws NotFoundException when category not in organization', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(service.remove('cat-999', orgId)).rejects.toThrow(
        'Category not found',
      );
    });

    it('throws ConflictException when category has products', async () => {
      prismaMock.category.findFirst.mockResolvedValue({
        id: 'cat-1',
        products: [{ id: 'p1' }],
      });

      await expect(service.remove('cat-1', orgId)).rejects.toThrow(
        'Cannot delete category with associated products',
      );
    });
  });

  // Regression guards, not behavioural RED: the DTO shape and the invariant live
  // elsewhere; these pin that the fiscal default survives the write and the
  // serializer, so a future refactor cannot silently drop the column.
  describe('fiscal default tax code', () => {
    it('forwards the default tax code on create', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);
      prismaMock.category.create.mockResolvedValue({
        id: 'cat-1',
        name: 'Bebidas',
        description: null,
        defaultTaxRate: null,
        defaultTaxCode: 'IVA',
        active: true,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      });

      const result = await service.create(
        { name: 'Bebidas', defaultTaxCode: 'IVA' },
        orgId,
      );

      expect(prismaMock.category.create).toHaveBeenCalledWith({
        data: { name: 'Bebidas', defaultTaxCode: 'IVA', organizationId: orgId },
      });
      expect(result.defaultTaxCode).toBe('IVA');
    });

    it('keeps a null default tax code on read', async () => {
      prismaMock.category.findFirst.mockResolvedValue({
        id: 'cat-1',
        name: 'Bebidas',
        description: null,
        defaultTaxRate: null,
        defaultTaxCode: null,
        active: true,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        products: [],
      });

      const result = await service.findOne('cat-1', orgId);

      expect(result.defaultTaxCode).toBeNull();
    });
  });
});
