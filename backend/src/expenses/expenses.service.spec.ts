import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDateInBogota } from '../common/utils/bogota-date';
import {
  ExpensesService,
  deriveExpensePaymentStatus,
} from './expenses.service';

describe('ExpensesService', () => {
  let service: ExpensesService;
  const orgId = 'org-1';
  const userId = 'user-1';

  const txMock = {
    $queryRaw: jest.fn(),
    expense: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    expensePayment: {
      create: jest.fn(),
    },
    payrollObligationExpense: {
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const prismaMock = {
    $transaction: jest.fn(),
    expense: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    expenseLabel: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    supplier: {
      findFirst: jest.fn(),
    },
    purchaseOrder: {
      findFirst: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
    },
  };

  const buildValidCreateDto = () => ({
    labelId: 'label-1',
    supplierId: 'sup-1',
    purchaseOrderId: 'po-1',
    description: 'Arriendo agosto',
    date: '2026-08-15',
    total: 500000,
    payments: [{ amount: 500000, method: 'CASH' as const, date: '2026-08-15' }],
  });

  const cloudinaryServiceMock = {
    uploadImage: jest.fn(),
    deleteImage: jest.fn(),
  };

  const buildReceiptFile = (): Express.Multer.File =>
    ({
      buffer: Buffer.from('fake-receipt'),
      originalname: 'receipt.jpg',
      mimetype: 'image/jpeg',
    }) as unknown as Express.Multer.File;

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof txMock) => unknown) => callback(txMock),
    );
    // Default transactional scaffolding for the payroll-owned expense guard:
    // the row lock succeeds and the expense is not linked to any obligation, so
    // the pre-existing unlinked expectations below stay unchanged.
    txMock.$queryRaw.mockResolvedValue([{ id: 'exp-1' }]);
    txMock.payrollObligationExpense.findFirst.mockResolvedValue(null);
    txMock.expense.findFirst.mockImplementation((args: unknown) =>
      prismaMock.expense.findFirst(args),
    );
    service = new ExpensesService(
      prismaMock as never,
      cloudinaryServiceMock as never,
    );
  });

  describe('deriveExpensePaymentStatus', () => {
    it('returns PAID when the payments sum equals the total', () => {
      expect(
        deriveExpensePaymentStatus(
          new Prisma.Decimal(500000),
          new Prisma.Decimal(500000),
        ),
      ).toBe('PAID');
    });

    it('returns PARTIAL when the payments sum is lower than the total', () => {
      expect(
        deriveExpensePaymentStatus(
          new Prisma.Decimal(500000),
          new Prisma.Decimal(200000),
        ),
      ).toBe('PARTIAL');
    });

    it('returns PAID when the payments sum covers the total exactly after multiple payments', () => {
      expect(
        deriveExpensePaymentStatus(
          new Prisma.Decimal(500000),
          new Prisma.Decimal(500000.01),
        ),
      ).toBe('PAID');
    });
  });

  describe('create', () => {
    it('creates a PAID expense when the first payment equals the total', async () => {
      prismaMock.expenseLabel.findFirst.mockResolvedValue({
        id: 'label-1',
        active: true,
        group: { organizationId: orgId, active: true },
      });
      prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prismaMock.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1' });
      txMock.expense.create.mockResolvedValue({ id: 'exp-1', status: 'PAID' });

      const result = await service.create(buildValidCreateDto(), userId, orgId);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      const createArgs = txMock.expense.create.mock.calls[0][0];
      expect(createArgs.data.status).toBe('PAID');
      expect(createArgs.data.total).toEqual(new Prisma.Decimal(500000));
      expect(createArgs.data.createdById).toBe(userId);
      expect(createArgs.data.organizationId).toBe(orgId);
      expect(createArgs.data.payments.create).toHaveLength(1);
      expect(createArgs.data.payments.create[0]).toMatchObject({
        amount: new Prisma.Decimal(500000),
        method: 'CASH' as const,
        date: new Date('2026-08-15'),
        organizationId: orgId,
      });
      expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
      const auditArgs = txMock.auditLog.create.mock.calls[0][0];
      expect(auditArgs.data).toMatchObject({
        userId,
        action: 'EXPENSE_CREATED',
        resource: 'Expense',
        resourceId: 'exp-1',
        organizationId: orgId,
      });
      expect(result).toEqual({ id: 'exp-1', status: 'PAID' });
    });

    it('creates a PARTIAL expense when the first payment is lower than the total', async () => {
      prismaMock.expenseLabel.findFirst.mockResolvedValue({
        id: 'label-1',
        active: true,
        group: { organizationId: orgId, active: true },
      });
      prismaMock.supplier.findFirst.mockResolvedValue(null);
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(null);
      txMock.expense.create.mockResolvedValue({
        id: 'exp-2',
        status: 'PARTIAL',
      });

      const result = await service.create(
        {
          ...buildValidCreateDto(),
          supplierId: undefined,
          purchaseOrderId: undefined,
          payments: [
            { amount: 200000, method: 'TRANSFER', date: '2026-08-15' },
          ],
        },
        userId,
        orgId,
      );

      expect(txMock.expense.create.mock.calls[0][0].data.status).toBe(
        'PARTIAL',
      );
      expect(result.status).toBe('PARTIAL');
    });

    it('rejects zero payments with 400 and never opens a transaction', async () => {
      prismaMock.expenseLabel.findFirst.mockResolvedValue({
        id: 'label-1',
        active: true,
        group: { organizationId: orgId, active: true },
      });
      prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prismaMock.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1' });

      await expect(
        service.create(
          { ...buildValidCreateDto(), payments: [] },
          userId,
          orgId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a payment that exceeds the total with 400', async () => {
      prismaMock.expenseLabel.findFirst.mockResolvedValue({
        id: 'label-1',
        active: true,
        group: { organizationId: orgId, active: true },
      });
      prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prismaMock.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1' });

      await expect(
        service.create(
          {
            ...buildValidCreateDto(),
            payments: [{ amount: 600000, method: 'CASH', date: '2026-08-15' }],
          },
          userId,
          orgId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a category that does not belong to the organization with 404', async () => {
      prismaMock.expenseLabel.findFirst.mockResolvedValue(null);

      await expect(
        service.create(buildValidCreateDto(), userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a supplier that does not belong to the organization with 404', async () => {
      prismaMock.expenseLabel.findFirst.mockResolvedValue({
        id: 'label-1',
        active: true,
        group: { organizationId: orgId, active: true },
      });
      prismaMock.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.create(buildValidCreateDto(), userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a purchase order that does not belong to the organization with 404', async () => {
      prismaMock.expenseLabel.findFirst.mockResolvedValue({
        id: 'label-1',
        active: true,
        group: { organizationId: orgId, active: true },
      });
      prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.create(buildValidCreateDto(), userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when organizationId is missing', async () => {
      await expect(
        service.create(buildValidCreateDto(), userId, undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('provides active report expenses with organization and event-date isolation', async () => {
      prismaMock.expense.findMany.mockResolvedValue([
        { total: new Prisma.Decimal('25.00'), purchaseOrderId: null },
      ]);

      const start = new Date('2026-08-01T05:00:00.000Z');
      const end = new Date('2026-08-31T04:59:59.999Z');
      const result = await service.findForReports(orgId, start, end);

      expect(prismaMock.expense.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: orgId,
          active: true,
          date: { gte: start, lte: end },
        },
        select: {
          total: true,
          purchaseOrderId: true,
          label: { select: { name: true, group: { select: { name: true } } } },
        },
      });
      expect(result).toEqual([
        { total: new Prisma.Decimal('25.00'), purchaseOrderId: null },
      ]);
    });

    it('paginates active org-scoped expenses with filters and related data', async () => {
      prismaMock.expense.findMany.mockResolvedValue([{ id: 'exp-1' }]);
      prismaMock.expense.count.mockResolvedValue(42);

      const result = await service.findAll(
        {
          page: 2,
          limit: 10,
          month: '2026-08',
          labelId: 'label-1',
          supplierId: 'sup-1',
          status: 'PARTIAL',
          search: 'arriendo',
        },
        orgId,
      );

      expect(prismaMock.expense.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: orgId,
          active: true,
          date: {
            gte: new Date('2026-08-01T05:00:00.000Z'),
            lte: new Date('2026-09-01T04:59:59.999Z'),
          },
          labelId: 'label-1',
          supplierId: 'sup-1',
          status: 'PARTIAL',
          description: { contains: 'arriendo', mode: 'insensitive' },
        },
        skip: 10,
        take: 10,
        orderBy: { date: 'desc' },
        include: {
          label: { include: { group: true } },
          supplier: true,
          payments: true,
        },
      });
      expect(prismaMock.expense.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ organizationId: orgId, active: true }),
      });
      expect(result).toEqual({
        data: [{ id: 'exp-1' }],
        meta: { total: 42, page: 2, limit: 10, totalPages: 5 },
      });
    });

    it('throws BadRequestException when organizationId is missing', async () => {
      await expect(service.findAll({}, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findOne', () => {
    it('returns the org-scoped expense with payments, category and supplier', async () => {
      prismaMock.expense.findFirst.mockResolvedValue({
        id: 'exp-1',
        organizationId: orgId,
      });

      const result = await service.findOne('exp-1', orgId);

      expect(prismaMock.expense.findFirst).toHaveBeenCalledWith({
        where: { id: 'exp-1', organizationId: orgId },
        include: {
          label: { include: { group: true } },
          supplier: true,
          purchaseOrder: true,
          payments: { orderBy: { date: 'asc' } },
        },
      });
      expect(result).toEqual({ id: 'exp-1', organizationId: orgId });
    });

    it('throws NotFoundException for unknown or cross-org ids', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(null);

      await expect(service.findOne('exp-x', orgId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const buildExisting = () => ({
      id: 'exp-1',
      organizationId: orgId,
      total: new Prisma.Decimal(500000),
      status: 'PAID',
      description: 'Arriendo agosto',
      date: new Date('2026-08-15T00:00:00.000Z'),
      payments: [{ id: 'pay-1', amount: new Prisma.Decimal(500000) }],
    });

    it('recomputes status to PARTIAL when the total grows beyond payments', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExisting());
      txMock.expense.update.mockResolvedValue({
        id: 'exp-1',
        status: 'PARTIAL',
        total: new Prisma.Decimal(800000),
        description: 'Arriendo agosto',
        date: new Date('2026-08-15T00:00:00.000Z'),
      });

      const result = await service.update(
        'exp-1',
        { total: 800000 },
        userId,
        orgId,
      );

      expect(txMock.expense.update).toHaveBeenCalledWith({
        where: { id: 'exp-1' },
        data: expect.objectContaining({ status: 'PARTIAL' }),
        include: {
          label: { include: { group: true } },
          supplier: true,
          payments: true,
        },
      });
      expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
      expect(txMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
        userId,
        action: 'EXPENSE_UPDATED',
        resource: 'Expense',
        resourceId: 'exp-1',
        organizationId: orgId,
      });
      expect(result).toEqual({
        id: 'exp-1',
        status: 'PARTIAL',
        total: new Prisma.Decimal(800000),
        description: 'Arriendo agosto',
        date: new Date('2026-08-15T00:00:00.000Z'),
      });
    });

    it('keeps PAID when the total shrinks to the payments sum', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExisting());
      txMock.expense.update.mockResolvedValue({
        id: 'exp-1',
        status: 'PAID',
        total: new Prisma.Decimal(500000),
        description: 'Arriendo agosto',
        date: new Date('2026-08-15T00:00:00.000Z'),
      });

      const result = await service.update(
        'exp-1',
        { total: 500000 },
        userId,
        orgId,
      );

      expect(txMock.expense.update.mock.calls[0][0].data.status).toBe('PAID');
      expect(result.status).toBe('PAID');
    });

    it('rejects a new total below the payments sum with 400', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExisting());

      await expect(
        service.update('exp-1', { total: 400000 }, userId, orgId),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a category that does not belong to the organization with 404', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExisting());
      prismaMock.expenseLabel.findFirst.mockResolvedValue(null);

      await expect(
        service.update('exp-1', { labelId: 'label-x' }, userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for unknown or cross-org ids', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(null);

      await expect(
        service.update('exp-x', { description: 'Nuevo' }, userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('clears supplier, purchase order and description links when null is passed', async () => {
      prismaMock.expense.findFirst.mockResolvedValue({
        ...buildExisting(),
        supplierId: 'sup-1',
        purchaseOrderId: 'po-1',
      });
      txMock.expense.update.mockResolvedValue({
        id: 'exp-1',
        status: 'PAID',
        total: new Prisma.Decimal(500000),
        description: null,
        supplierId: null,
        purchaseOrderId: null,
        date: new Date('2026-08-15T00:00:00.000Z'),
      });

      const result = await service.update(
        'exp-1',
        { supplierId: null, purchaseOrderId: null, description: null },
        userId,
        orgId,
      );

      expect(txMock.expense.update).toHaveBeenCalledWith({
        where: { id: 'exp-1' },
        data: expect.objectContaining({
          supplierId: null,
          purchaseOrderId: null,
          description: null,
        }),
        include: {
          label: { include: { group: true } },
          supplier: true,
          payments: true,
        },
      });
      expect(result).toMatchObject({
        supplierId: null,
        purchaseOrderId: null,
        description: null,
      });
    });
  });

  describe('addPayment', () => {
    const buildExisting = () => ({
      id: 'exp-1',
      organizationId: orgId,
      active: true,
      total: new Prisma.Decimal(500000),
      status: 'PARTIAL',
      payments: [
        { id: 'pay-1', amount: new Prisma.Decimal(300000) },
        { id: 'pay-2', amount: new Prisma.Decimal(100000) },
      ],
    });
    const buildPaymentDto = () => ({
      amount: 100000,
      method: 'CASH' as const,
      date: '2026-08-20',
    });

    it('transitions PARTIAL to PAID inside one transaction when the new payment covers the remaining total', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExisting());
      txMock.expensePayment.create.mockResolvedValue({ id: 'pay-3' });
      txMock.expense.update.mockResolvedValue({ id: 'exp-1', status: 'PAID' });

      const result = await service.addPayment(
        'exp-1',
        buildPaymentDto(),
        userId,
        orgId,
      );

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.expensePayment.create).toHaveBeenCalledWith({
        data: {
          expenseId: 'exp-1',
          organizationId: orgId,
          amount: new Prisma.Decimal(100000),
          method: 'CASH',
          date: new Date('2026-08-20'),
        },
      });
      expect(txMock.expense.update).toHaveBeenCalledWith({
        where: { id: 'exp-1' },
        data: { status: 'PAID' },
        include: {
          label: { include: { group: true } },
          supplier: true,
          payments: true,
        },
      });
      expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
      expect(txMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
        userId,
        action: 'EXPENSE_PAYMENT_ADDED',
        resource: 'Expense',
        resourceId: 'exp-1',
        organizationId: orgId,
      });
      expect(result).toEqual({ id: 'exp-1', status: 'PAID' });
    });

    it('keeps PARTIAL when the new payment still leaves a remainder', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExisting());
      txMock.expensePayment.create.mockResolvedValue({ id: 'pay-3' });
      txMock.expense.update.mockResolvedValue({
        id: 'exp-1',
        status: 'PARTIAL',
      });

      const result = await service.addPayment(
        'exp-1',
        { ...buildPaymentDto(), amount: 50000 },
        userId,
        orgId,
      );

      expect(txMock.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PARTIAL' } }),
      );
      expect(result.status).toBe('PARTIAL');
    });

    it('rejects a payment that would exceed the total with 400 and never opens a transaction', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExisting());

      await expect(
        service.addPayment(
          'exp-1',
          { ...buildPaymentDto(), amount: 150000 },
          userId,
          orgId,
        ),
      ).rejects.toThrow(
        'La suma de los pagos no puede superar el total de la salida',
      );

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown or cross-org expense ids', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(null);

      await expect(
        service.addPayment('exp-x', buildPaymentDto(), userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects payments on an inactive expense with 400 and never opens a transaction', async () => {
      prismaMock.expense.findFirst.mockResolvedValue({
        ...buildExisting(),
        active: false,
      });

      await expect(
        service.addPayment('exp-1', buildPaymentDto(), userId, orgId),
      ).rejects.toThrow('No se pueden registrar pagos en una salida eliminada');

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when organizationId is missing', async () => {
      await expect(
        service.addPayment('exp-1', buildPaymentDto(), userId, undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMonthlySummary', () => {
    it('returns the month total and nested group/label breakdown sorted by total desc', async () => {
      prismaMock.expense.groupBy.mockResolvedValue([
        { labelId: 'label-2', _sum: { total: new Prisma.Decimal(500000) } },
        { labelId: 'label-1', _sum: { total: new Prisma.Decimal(1000000) } },
      ]);
      prismaMock.expenseLabel.findMany.mockResolvedValue([
        {
          id: 'label-1',
          name: 'Arriendo',
          groupId: 'group-1',
          group: { id: 'group-1', name: 'Gastos del local' },
        },
        {
          id: 'label-2',
          name: 'Caja menor',
          groupId: 'group-2',
          group: { id: 'group-2', name: 'Caja menor' },
        },
      ]);

      const result = await service.getMonthlySummary('2026-08', orgId);

      expect(prismaMock.expense.groupBy).toHaveBeenCalledWith({
        by: ['labelId'],
        where: {
          organizationId: orgId,
          active: true,
          date: {
            gte: new Date('2026-08-01T05:00:00.000Z'),
            lte: new Date('2026-09-01T04:59:59.999Z'),
          },
        },
        _sum: { total: true },
      });
      expect(prismaMock.expenseLabel.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['label-2', 'label-1'] } },
        select: {
          id: true,
          name: true,
          groupId: true,
          group: { select: { id: true, name: true } },
        },
      });
      expect(result).toEqual({
        month: '2026-08',
        total: new Prisma.Decimal(1500000),
        groups: [
          {
            groupId: 'group-1',
            name: 'Gastos del local',
            total: new Prisma.Decimal(1000000),
            labels: [
              {
                labelId: 'label-1',
                name: 'Arriendo',
                total: new Prisma.Decimal(1000000),
              },
            ],
          },
          {
            groupId: 'group-2',
            name: 'Caja menor',
            total: new Prisma.Decimal(500000),
            labels: [
              {
                labelId: 'label-2',
                name: 'Caja menor',
                total: new Prisma.Decimal(500000),
              },
            ],
          },
        ],
      });
    });

    it('returns zeros for a month without expenses', async () => {
      prismaMock.expense.groupBy.mockResolvedValue([]);
      prismaMock.expenseLabel.findMany.mockResolvedValue([]);

      const result = await service.getMonthlySummary('2026-08', orgId);

      expect(result).toEqual({
        month: '2026-08',
        total: new Prisma.Decimal(0),
        groups: [],
      });
    });

    it('rejects malformed month strings with 400', async () => {
      await expect(service.getMonthlySummary('2026-8', orgId)).rejects.toThrow(
        BadRequestException,
      );

      expect(prismaMock.expense.groupBy).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when organizationId is missing', async () => {
      await expect(
        service.getMonthlySummary('2026-08', undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('duplicate', () => {
    const buildExisting = () => ({
      id: 'exp-1',
      organizationId: orgId,
      active: true,
      labelId: 'label-1',
      supplierId: 'sup-1',
      purchaseOrderId: 'po-1',
      description: 'Arriendo agosto',
      total: new Prisma.Decimal(500000),
      status: 'PARTIAL',
      payments: [
        {
          id: 'pay-1',
          amount: new Prisma.Decimal(300000),
          method: 'CASH',
          date: new Date('2026-08-05T00:00:00.000Z'),
        },
        {
          id: 'pay-2',
          amount: new Prisma.Decimal(200000),
          method: 'TRANSFER',
          date: new Date('2026-08-10T00:00:00.000Z'),
        },
      ],
    });

    it('copies fields and payments into a new expense dated today in Bogota inside one transaction', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExisting());
      txMock.expense.create.mockResolvedValue({
        id: 'exp-2',
        status: 'PAID',
      });

      const result = await service.duplicate('exp-1', userId, orgId);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      const createArgs = txMock.expense.create.mock.calls[0][0];
      expect(createArgs.data).toMatchObject({
        organizationId: orgId,
        labelId: 'label-1',
        supplierId: 'sup-1',
        purchaseOrderId: 'po-1',
        description: 'Arriendo agosto',
        total: new Prisma.Decimal(500000),
        status: 'PAID',
        createdById: userId,
        date: new Date(formatDateInBogota(new Date())),
      });
      expect(createArgs.data.payments.create).toEqual([
        {
          organizationId: orgId,
          amount: new Prisma.Decimal(300000),
          method: 'CASH',
          date: new Date('2026-08-05T00:00:00.000Z'),
        },
        {
          organizationId: orgId,
          amount: new Prisma.Decimal(200000),
          method: 'TRANSFER',
          date: new Date('2026-08-10T00:00:00.000Z'),
        },
      ]);
      expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
      expect(txMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
        userId,
        action: 'EXPENSE_DUPLICATED',
        resource: 'Expense',
        resourceId: 'exp-2',
        organizationId: orgId,
      });
      expect(txMock.auditLog.create.mock.calls[0][0].data.metadata).toEqual(
        expect.objectContaining({ originalId: 'exp-1' }),
      );
      expect(result).toEqual({ id: 'exp-2', status: 'PAID' });
    });

    it('derives the status from the copied payments sum', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExisting());
      txMock.expense.create.mockResolvedValue({
        id: 'exp-2',
        status: 'PAID',
      });

      const result = await service.duplicate('exp-1', userId, orgId);

      expect(txMock.expense.create.mock.calls[0][0].data.status).toBe('PAID');
      expect(result.status).toBe('PAID');
    });

    it('rejects duplicating an inactive expense with 400 and never opens a transaction', async () => {
      prismaMock.expense.findFirst.mockResolvedValue({
        ...buildExisting(),
        active: false,
      });

      await expect(service.duplicate('exp-1', userId, orgId)).rejects.toThrow(
        'No se puede duplicar una salida eliminada',
      );

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown or cross-org ids', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(null);

      await expect(service.duplicate('exp-x', userId, orgId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when organizationId is missing', async () => {
      await expect(
        service.duplicate('exp-1', userId, undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getHistory', () => {
    it('returns the org-scoped audit entries for the expense ordered ascending', async () => {
      prismaMock.expense.findFirst.mockResolvedValue({ id: 'exp-1' });
      prismaMock.auditLog.findMany.mockResolvedValue([
        { id: 'a-1', action: 'EXPENSE_CREATED' },
        { id: 'a-2', action: 'EXPENSE_UPDATED' },
      ]);

      const result = await service.getHistory('exp-1', orgId);

      expect(prismaMock.expense.findFirst).toHaveBeenCalledWith({
        where: { id: 'exp-1', organizationId: orgId },
        select: { id: true },
      });
      expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          resource: 'Expense',
          resourceId: 'exp-1',
          organizationId: orgId,
        },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { name: true, email: true } } },
      });
      expect(result).toEqual([
        { id: 'a-1', action: 'EXPENSE_CREATED' },
        { id: 'a-2', action: 'EXPENSE_UPDATED' },
      ]);
    });

    it('throws NotFoundException for unknown or cross-org expense ids without reading the audit log', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(null);

      await expect(service.getHistory('exp-x', orgId)).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when organizationId is missing', async () => {
      await expect(service.getHistory('exp-1', undefined)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('uploadReceipt', () => {
    it('uploads the file to the expense-receipts folder and persists the receipt URL with an audit entry in one transaction', async () => {
      prismaMock.expense.findFirst.mockResolvedValue({
        id: 'exp-1',
        createdById: userId,
        receiptUrl: null,
      });
      cloudinaryServiceMock.uploadImage.mockResolvedValue(
        'https://cloud.example/expense-receipts/r1.jpg',
      );
      txMock.expense.update.mockResolvedValue({
        id: 'exp-1',
        receiptUrl: 'https://cloud.example/expense-receipts/r1.jpg',
      });

      const result = await service.uploadReceipt(
        'exp-1',
        buildReceiptFile(),
        userId,
        orgId,
      );

      expect(cloudinaryServiceMock.uploadImage).toHaveBeenCalledWith(
        buildReceiptFile(),
        'expense-receipts',
      );
      expect(cloudinaryServiceMock.deleteImage).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.expense.update).toHaveBeenCalledWith({
        where: { id: 'exp-1' },
        data: { receiptUrl: 'https://cloud.example/expense-receipts/r1.jpg' },
        include: {
          label: { include: { group: true } },
          supplier: true,
          payments: true,
        },
      });
      expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
      expect(txMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
        userId,
        action: 'EXPENSE_RECEIPT_UPLOADED',
        resource: 'Expense',
        resourceId: 'exp-1',
        organizationId: orgId,
      });
      expect(result).toEqual({
        id: 'exp-1',
        receiptUrl: 'https://cloud.example/expense-receipts/r1.jpg',
      });
    });

    it('best-effort deletes the previous receipt when one exists', async () => {
      prismaMock.expense.findFirst.mockResolvedValue({
        id: 'exp-1',
        createdById: userId,
        receiptUrl: 'https://cloud.example/expense-receipts/old.jpg',
      });
      cloudinaryServiceMock.uploadImage.mockResolvedValue(
        'https://cloud.example/expense-receipts/new.jpg',
      );
      cloudinaryServiceMock.deleteImage.mockResolvedValue(undefined);
      txMock.expense.update.mockResolvedValue({
        id: 'exp-1',
        receiptUrl: 'https://cloud.example/expense-receipts/new.jpg',
      });

      await service.uploadReceipt('exp-1', buildReceiptFile(), userId, orgId);

      expect(cloudinaryServiceMock.deleteImage).toHaveBeenCalledWith(
        'https://cloud.example/expense-receipts/old.jpg',
      );
    });

    it('ignores a failed deletion of the previous receipt and still persists the new one', async () => {
      prismaMock.expense.findFirst.mockResolvedValue({
        id: 'exp-1',
        createdById: userId,
        receiptUrl: 'https://cloud.example/expense-receipts/old.jpg',
      });
      cloudinaryServiceMock.uploadImage.mockResolvedValue(
        'https://cloud.example/expense-receipts/new.jpg',
      );
      cloudinaryServiceMock.deleteImage.mockRejectedValue(
        new Error('cloud unreachable'),
      );
      txMock.expense.update.mockResolvedValue({
        id: 'exp-1',
        receiptUrl: 'https://cloud.example/expense-receipts/new.jpg',
      });

      const result = await service.uploadReceipt(
        'exp-1',
        buildReceiptFile(),
        userId,
        orgId,
      );

      expect(txMock.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            receiptUrl: 'https://cloud.example/expense-receipts/new.jpg',
          },
        }),
      );
      expect(result.receiptUrl).toBe(
        'https://cloud.example/expense-receipts/new.jpg',
      );
    });

    it('throws NotFoundException for unknown or cross-org expense ids without uploading', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(null);

      await expect(
        service.uploadReceipt('exp-x', buildReceiptFile(), userId, orgId),
      ).rejects.toThrow(NotFoundException);

      expect(cloudinaryServiceMock.uploadImage).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when organizationId is missing', async () => {
      await expect(
        service.uploadReceipt('exp-1', buildReceiptFile(), userId, undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('soft-deletes with active=false and writes an audit log in the same transaction', async () => {
      prismaMock.expense.findFirst.mockResolvedValue({
        id: 'exp-1',
        organizationId: orgId,
        total: new Prisma.Decimal(500000),
      });
      txMock.expense.update.mockResolvedValue({ id: 'exp-1', active: false });

      const result = await service.remove('exp-1', userId, orgId);

      expect(txMock.expense.update).toHaveBeenCalledWith({
        where: { id: 'exp-1' },
        data: { active: false },
      });
      expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
      expect(txMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
        userId,
        action: 'EXPENSE_DELETED',
        resource: 'Expense',
        resourceId: 'exp-1',
        organizationId: orgId,
      });
      expect(result).toEqual({ id: 'exp-1', active: false });
    });

    it('throws NotFoundException for unknown or cross-org ids', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(null);

      await expect(service.remove('exp-x', userId, orgId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('payroll-linked expense guard', () => {
    const linkRow = { obligationId: 'obl-1' };

    const buildExpense = (overrides: Record<string, unknown> = {}) => ({
      id: 'exp-1',
      organizationId: orgId,
      active: true,
      labelId: 'label-1',
      total: new Prisma.Decimal(500000),
      status: 'PARTIAL',
      description: 'Arriendo agosto',
      date: new Date('2026-08-15T00:00:00.000Z'),
      payments: [{ id: 'pay-1', amount: new Prisma.Decimal(200000) }],
      ...overrides,
    });

    const paymentDto = () => ({
      amount: 50000,
      method: 'CASH' as const,
      date: '2026-08-20',
    });

    const recordTransactionOrder = () => {
      const order: string[] = [];
      txMock.$queryRaw.mockImplementation(async () => {
        order.push('lock-expense');
        return [{ id: 'exp-1' }];
      });
      txMock.payrollObligationExpense.findFirst.mockImplementation(async () => {
        order.push('link');
        return null;
      });
      txMock.expense.findFirst.mockImplementation(async (args: unknown) => {
        order.push('reread');
        return prismaMock.expense.findFirst(args);
      });
      return order;
    };

    const lockSql = () => {
      const [call] = txMock.$queryRaw.mock.calls[0];
      return (call as TemplateStringsArray).join('?');
    };

    it('rejects update of a payroll-linked expense with 409 after the lock and link check, without writing', async () => {
      const order = recordTransactionOrder();
      txMock.payrollObligationExpense.findFirst.mockImplementation(async () => {
        order.push('link');
        return linkRow;
      });
      txMock.expense.update.mockImplementation(async () => {
        order.push('write');
        return buildExpense();
      });
      prismaMock.expense.findFirst.mockResolvedValue(buildExpense());

      await expect(
        service.update('exp-1', { description: 'Nuevo' }, userId, orgId),
      ).rejects.toThrow(ConflictException);

      expect(order).toEqual(['lock-expense', 'link']);
      expect(txMock.expense.update).not.toHaveBeenCalled();
      expect(txMock.auditLog.create).not.toHaveBeenCalled();
      expect(txMock.payrollObligationExpense.findFirst).toHaveBeenCalledWith({
        where: { expenseId: 'exp-1', organizationId: orgId },
        select: { obligationId: true },
      });
    });

    it('rejects addPayment on a payroll-linked expense with 409 before creating the payment', async () => {
      const order = recordTransactionOrder();
      txMock.payrollObligationExpense.findFirst.mockImplementation(async () => {
        order.push('link');
        return linkRow;
      });
      txMock.expensePayment.create.mockImplementation(async () => {
        order.push('write');
        return { id: 'pay-3' };
      });
      prismaMock.expense.findFirst.mockResolvedValue(buildExpense());

      await expect(
        service.addPayment('exp-1', paymentDto(), userId, orgId),
      ).rejects.toThrow(ConflictException);

      expect(order).toEqual(['lock-expense', 'link']);
      expect(txMock.expensePayment.create).not.toHaveBeenCalled();
      expect(txMock.auditLog.create).not.toHaveBeenCalled();
    });

    it('rejects remove of a payroll-linked expense with 409 before soft-deleting it', async () => {
      const order = recordTransactionOrder();
      txMock.payrollObligationExpense.findFirst.mockImplementation(async () => {
        order.push('link');
        return linkRow;
      });
      txMock.expense.update.mockImplementation(async () => {
        order.push('write');
        return buildExpense({ active: false });
      });
      prismaMock.expense.findFirst.mockResolvedValue(buildExpense());

      await expect(service.remove('exp-1', userId, orgId)).rejects.toThrow(
        ConflictException,
      );

      expect(order).toEqual(['lock-expense', 'link']);
      expect(txMock.expense.update).not.toHaveBeenCalled();
      expect(txMock.auditLog.create).not.toHaveBeenCalled();
    });

    it('keeps the unlinked update path writing after lock then link then a fresh reread', async () => {
      const order = recordTransactionOrder();
      txMock.expense.update.mockImplementation(async () => {
        order.push('write');
        return buildExpense();
      });
      prismaMock.expense.findFirst.mockResolvedValue(buildExpense());

      await service.update('exp-1', { description: 'Nuevo' }, userId, orgId);

      expect(order).toEqual(['lock-expense', 'link', 'reread', 'write']);
      expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
      expect(lockSql()).toContain('FROM "Expense"');
      expect(lockSql()).toContain('"organizationId"');
      expect(lockSql()).toContain('FOR UPDATE');
      // The expense unit never takes payroll or cash locks.
      expect(lockSql()).not.toMatch(/Payroll|Employee/);
      expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('decides the update from the post-lock reread instead of the pre-transaction facts', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExpense());
      txMock.expense.findFirst.mockResolvedValue(
        buildExpense({
          payments: [{ id: 'pay-1', amount: new Prisma.Decimal(500000) }],
        }),
      );

      await expect(
        service.update('exp-1', { total: 450000 }, userId, orgId),
      ).rejects.toThrow(
        'El nuevo total no puede ser menor que la suma de los pagos registrados',
      );

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.expense.findFirst).toHaveBeenCalledTimes(1);
      expect(txMock.expense.update).not.toHaveBeenCalled();
    });

    it('derives the update status from the post-lock payments, not from the pre-transaction sum', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExpense());
      txMock.expense.findFirst.mockResolvedValue(
        buildExpense({
          payments: [{ id: 'pay-1', amount: new Prisma.Decimal(500000) }],
        }),
      );
      txMock.expense.update.mockResolvedValue(buildExpense({ status: 'PAID' }));

      await service.update('exp-1', { description: 'Nuevo' }, userId, orgId);

      expect(txMock.expense.update.mock.calls[0][0].data.status).toBe('PAID');
      const auditArgs = txMock.auditLog.create.mock.calls[0][0];
      expect(auditArgs.data.metadata.after.status).toBe('PAID');
    });

    it('rejects a payment that only exceeds the total under the post-lock reread', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExpense());
      txMock.expense.findFirst.mockResolvedValue(
        buildExpense({
          payments: [{ id: 'pay-1', amount: new Prisma.Decimal(480000) }],
        }),
      );

      await expect(
        service.addPayment('exp-1', paymentDto(), userId, orgId),
      ).rejects.toThrow(
        'La suma de los pagos no puede superar el total de la salida',
      );

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.expensePayment.create).not.toHaveBeenCalled();
      expect(txMock.expense.update).not.toHaveBeenCalled();
    });

    it('derives the payment status from the post-lock payments and keeps the unlinked write', async () => {
      const order = recordTransactionOrder();
      prismaMock.expense.findFirst.mockResolvedValue(buildExpense());
      txMock.expense.findFirst.mockImplementation(async (args: unknown) => {
        order.push('reread');
        expect(args).toEqual({
          where: { id: 'exp-1', organizationId: orgId },
          include: { payments: true },
        });
        return buildExpense({
          payments: [{ id: 'pay-1', amount: new Prisma.Decimal(450000) }],
        });
      });
      txMock.expensePayment.create.mockImplementation(async () => {
        order.push('payment-write');
        return { id: 'pay-3' };
      });
      txMock.expense.update.mockImplementation(async () => {
        order.push('status-write');
        return buildExpense({ status: 'PAID' });
      });

      await service.addPayment('exp-1', paymentDto(), userId, orgId);

      expect(order).toEqual([
        'lock-expense',
        'link',
        'reread',
        'payment-write',
        'status-write',
      ]);
      expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
      expect(lockSql()).toContain('FOR UPDATE');
      expect(lockSql()).not.toMatch(/Payroll|Employee/);
      expect(txMock.expense.update.mock.calls[0][0].data).toEqual({
        status: 'PAID',
      });
      const auditArgs = txMock.auditLog.create.mock.calls[0][0];
      expect(auditArgs.data.metadata).toMatchObject({
        beforeStatus: 'PARTIAL',
        afterStatus: 'PAID',
      });
    });

    it('keeps the unlinked remove path soft-deleting after lock then link then reread', async () => {
      const order = recordTransactionOrder();
      prismaMock.expense.findFirst.mockResolvedValue(buildExpense());
      txMock.expense.update.mockImplementation(async () => {
        order.push('write');
        return buildExpense({ active: false });
      });

      await service.remove('exp-1', userId, orgId);

      expect(order).toEqual(['lock-expense', 'link', 'reread', 'write']);
      expect(txMock.expense.update).toHaveBeenCalledWith({
        where: { id: 'exp-1' },
        data: { active: false },
      });
      expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
      expect(lockSql()).not.toMatch(/Payroll|Employee/);
    });

    it('does not reject an expense whose payroll link belongs to another tenant', async () => {
      interface LinkQueryArgs {
        where: { expenseId: string; organizationId: string };
      }

      prismaMock.expense.findFirst.mockResolvedValue(
        buildExpense({ organizationId: 'org-2' }),
      );
      txMock.payrollObligationExpense.findFirst.mockImplementation(
        async (args: LinkQueryArgs) =>
          args.where.expenseId === 'exp-1' &&
          args.where.organizationId === orgId
            ? linkRow
            : null,
      );
      txMock.expense.update.mockResolvedValue(buildExpense());

      await service.update('exp-1', { description: 'Nuevo' }, userId, 'org-2');

      expect(txMock.payrollObligationExpense.findFirst).toHaveBeenCalledWith({
        where: { expenseId: 'exp-1', organizationId: 'org-2' },
        select: { obligationId: true },
      });
      expect(txMock.expense.update).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException without link or write when the tenant lock finds no expense row', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExpense());
      txMock.$queryRaw.mockResolvedValue([]);

      await expect(service.remove('exp-1', userId, orgId)).rejects.toThrow(
        NotFoundException,
      );

      expect(txMock.payrollObligationExpense.findFirst).not.toHaveBeenCalled();
      expect(txMock.expense.update).not.toHaveBeenCalled();
    });

    it('does not guard duplicate or receipt uploads in this unit', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(buildExpense());
      txMock.expense.create.mockResolvedValue({ id: 'exp-2', status: 'PAID' });

      await service.duplicate('exp-1', userId, orgId);

      expect(txMock.$queryRaw).not.toHaveBeenCalled();
      expect(txMock.payrollObligationExpense.findFirst).not.toHaveBeenCalled();
      expect(txMock.expense.create).toHaveBeenCalledTimes(1);
    });
  });
});
