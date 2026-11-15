import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  let service: CustomersService;
  const orgId = 'org-1';
  const prismaMock = {
    $transaction: jest.fn(),
    customerVehicle: { upsert: jest.fn(), updateMany: jest.fn() },
    customer: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const planLimitServiceMock = {
    invalidateCache: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => unknown) =>
        callback(prismaMock),
    );
    service = new CustomersService(
      prismaMock as never,
      planLimitServiceMock as never,
    );
  });

  describe('findAll', () => {
    it('filters by organizationId', async () => {
      prismaMock.customer.findMany.mockResolvedValue([]);
      prismaMock.customer.count.mockResolvedValue(0);

      const result = await service.findAll(orgId, 1, 10);

      expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: orgId,
            active: true,
          }),
        }),
      );
      expect(prismaMock.customer.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: orgId,
            active: true,
          }),
        }),
      );
      expect(result.data).toHaveLength(0);
    });

    it('includes search and segment filters', async () => {
      prismaMock.customer.findMany.mockResolvedValue([
        { id: 'c1', name: 'John', active: true },
      ]);
      prismaMock.customer.count.mockResolvedValue(1);

      const result = await service.findAll(orgId, 1, 10, 'john', 'VIP');

      expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: orgId,
            active: true,
            segment: 'VIP',
            OR: expect.any(Array),
          }),
        }),
      );
      expect(result.data).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('returns customer when found in organization', async () => {
      prismaMock.customer.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'John',
        active: true,
        sales: [],
      });

      const result = await service.findOne('c1', orgId);

      expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', organizationId: orgId },
        include: {
          sales: { include: { items: { include: { product: true } } } },
        },
      });
      expect(result.name).toBe('John');
    });

    it('throws NotFoundException when customer not in organization', async () => {
      prismaMock.customer.findFirst.mockResolvedValue(null);

      await expect(service.findOne('c-999', orgId)).rejects.toThrow(
        'Customer not found',
      );
    });
  });

  describe('findByDocumentNumber', () => {
    it('returns active customer scoped to organization', async () => {
      prismaMock.customer.findFirst.mockResolvedValue({
        id: 'c1',
        documentNumber: '123',
      });

      const result = await service.findByDocumentNumber('123', orgId);

      expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
        where: { documentNumber: '123', organizationId: orgId, active: true },
      });
      expect(result).toEqual(expect.objectContaining({ id: 'c1' }));
    });
  });

  describe('create', () => {
    it('creates customer scoped to organization', async () => {
      prismaMock.customer.findFirst.mockResolvedValue(null);
      prismaMock.customer.create.mockResolvedValue({
        id: 'c1',
        name: 'John',
        documentNumber: '123',
        active: true,
      });

      const dto = { name: 'John', documentType: 'CC', documentNumber: '123' };
      const result = await service.create(dto, orgId);

      expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
        where: { documentNumber: '123', organizationId: orgId },
      });
      expect(prismaMock.customer.create).toHaveBeenCalledWith({
        data: { ...dto, organizationId: orgId },
      });
      expect(result.name).toBe('John');
    });

    it('survives referencia and placaMoto into the create payload', async () => {
      prismaMock.customer.findFirst.mockResolvedValue(null);
      prismaMock.customer.create.mockResolvedValue({
        id: 'c1',
        name: 'John',
        documentType: 'CC',
        documentNumber: '123',
        referencia: 'Entrega en portería',
        placaMoto: 'ABC-123',
        active: true,
      });

      const dto = {
        name: 'John',
        documentType: 'CC',
        documentNumber: '123',
        referencia: 'Entrega en portería',
        placaMoto: 'ABC-123',
      };
      const result = await service.create(dto, orgId);

      expect(prismaMock.customer.create).toHaveBeenCalledWith({
        data: { ...dto, organizationId: orgId },
      });
      expect(result.referencia).toBe('Entrega en portería');
      expect(result.placaMoto).toBe('ABC-123');
    });

    it('throws ConflictException when document exists in organization', async () => {
      prismaMock.customer.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create(
          { name: 'John', documentType: 'CC', documentNumber: '123' },
          orgId,
        ),
      ).rejects.toThrow('Customer with this document number already exists');
    });
  });

  describe('update', () => {
    it('updates customer within organization', async () => {
      prismaMock.customer.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'John',
        documentNumber: '123',
        active: true,
      });
      prismaMock.customer.update.mockResolvedValue({
        id: 'c1',
        name: 'John Updated',
        documentNumber: '123',
        active: true,
      });

      const result = await service.update(
        'c1',
        { name: 'John Updated' },
        orgId,
      );

      expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', organizationId: orgId },
      });
      expect(prismaMock.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { name: 'John Updated' },
      });
      expect(result.name).toBe('John Updated');
    });

    it('throws NotFoundException when customer not in organization', async () => {
      prismaMock.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.update('c-999', { name: 'X' }, orgId),
      ).rejects.toThrow('Customer not found');
    });

    it('throws ConflictException when new document exists in organization', async () => {
      prismaMock.customer.findFirst
        .mockResolvedValueOnce({
          id: 'c1',
          documentNumber: '123',
          active: true,
        })
        .mockResolvedValueOnce({ id: 'other' });

      await expect(
        service.update('c1', { documentNumber: '456' }, orgId),
      ).rejects.toThrow('Document number already in use');
    });
  });

  describe('remove', () => {
    it('soft-deletes customer within organization', async () => {
      prismaMock.customer.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'John',
        sales: [],
      });
      prismaMock.customer.update.mockResolvedValue({
        id: 'c1',
        name: 'John',
        active: false,
      });

      const result = await service.remove('c1', orgId);

      expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', organizationId: orgId },
        include: { sales: true },
      });
      expect(prismaMock.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it('throws NotFoundException when customer not in organization', async () => {
      prismaMock.customer.findFirst.mockResolvedValue(null);

      await expect(service.remove('c-999', orgId)).rejects.toThrow(
        'Customer not found',
      );
    });

    it('throws ConflictException when customer has sales', async () => {
      prismaMock.customer.findFirst.mockResolvedValue({
        id: 'c1',
        sales: [{ id: 's1' }],
      });

      await expect(service.remove('c1', orgId)).rejects.toThrow(
        'Cannot delete customer with associated sales',
      );
    });
  });
});
