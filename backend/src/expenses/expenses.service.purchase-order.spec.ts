import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpensesService } from './expenses.service';

/**
 * The purchase-order link is financial, not decorative: the reports exclude
 * every linked expense from operating expenses because it is merchandise cost.
 * These cases pin the coherence rules that keep that exclusion honest, and the
 * compatibility rule that keeps legacy rows editable.
 */
describe('ExpensesService purchase-order link', () => {
  const orgId = 'org-1';
  const userId = 'user-1';

  const txMock = {
    $queryRaw: jest.fn(),
    expense: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
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
    },
    expenseLabel: {
      findFirst: jest.fn(),
    },
    supplier: {
      findFirst: jest.fn(),
    },
    purchaseOrder: {
      findFirst: jest.fn(),
    },
  };

  const cloudinaryServiceMock = {
    uploadImage: jest.fn(),
    deleteImage: jest.fn(),
  };

  let service: ExpensesService;

  const buildCreateDto = (overrides: Record<string, unknown> = {}) => ({
    labelId: 'label-1',
    supplierId: 'sup-1',
    purchaseOrderId: 'po-1',
    date: '2026-11-14',
    total: 10000,
    payments: [{ amount: 10000, method: 'CASH' as const, date: '2026-11-14' }],
    ...overrides,
  });

  const buildOrder = (overrides: Record<string, unknown> = {}) => ({
    id: 'po-1',
    status: 'PENDING',
    supplierId: 'sup-1',
    ...overrides,
  });

  const buildExistingExpense = (overrides: Record<string, unknown> = {}) => ({
    id: 'exp-1',
    organizationId: orgId,
    supplierId: 'sup-1',
    purchaseOrderId: 'po-1',
    total: new Prisma.Decimal(10000),
    status: 'PAID',
    description: 'Mantenimiento',
    date: new Date('2026-11-14T00:00:00.000Z'),
    payments: [{ id: 'pay-1', amount: new Prisma.Decimal(10000) }],
    ...overrides,
  });

  const buildUpdatedExpense = () => ({
    id: 'exp-1',
    status: 'PAID',
    total: new Prisma.Decimal(10000),
    supplierId: 'sup-1',
    purchaseOrderId: 'po-1',
    description: 'Mantenimiento de equipos',
    date: new Date('2026-11-14T00:00:00.000Z'),
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof txMock) => unknown) => callback(txMock),
    );
    prismaMock.expenseLabel.findFirst.mockResolvedValue({
      id: 'label-1',
      active: true,
      group: { organizationId: orgId, active: true },
    });
    txMock.$queryRaw.mockResolvedValue([{ id: 'exp-1' }]);
    txMock.payrollObligationExpense.findFirst.mockResolvedValue(null);
    txMock.expense.findFirst.mockImplementation((args: unknown) =>
      prismaMock.expense.findFirst(args),
    );
    txMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    service = new ExpensesService(
      prismaMock as never,
      cloudinaryServiceMock as never,
    );
  });

  describe('create', () => {
    it('rejects an order that belongs to another supplier with 400 and opens no transaction', async () => {
      prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        buildOrder({ supplierId: 'sup-2' }),
      );

      await expect(
        service.create(buildCreateDto(), userId, orgId),
      ).rejects.toThrow(
        'La orden de compra pertenece a otro proveedor. Elige una orden del proveedor de este gasto',
      );

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(txMock.expense.create).not.toHaveBeenCalled();
    });

    it('rejects a DRAFT order with 400 and opens no transaction', async () => {
      prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        buildOrder({ status: 'DRAFT' }),
      );

      await expect(
        service.create(buildCreateDto(), userId, orgId),
      ).rejects.toThrow(
        'Solo puedes ligar una orden de compra pendiente, recibida parcialmente o recibida',
      );

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a CANCELLED order with 400 and opens no transaction', async () => {
      prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        buildOrder({ status: 'CANCELLED' }),
      );

      await expect(
        service.create(buildCreateDto(), userId, orgId),
      ).rejects.toThrow(
        'Solo puedes ligar una orden de compra pendiente, recibida parcialmente o recibida',
      );

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("adopts the order's supplier when the expense has none", async () => {
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        buildOrder({ supplierId: 'sup-9' }),
      );
      txMock.expense.create.mockResolvedValue({ id: 'exp-9', status: 'PAID' });

      await service.create(
        buildCreateDto({ supplierId: undefined }),
        userId,
        orgId,
      );

      expect(prismaMock.supplier.findFirst).not.toHaveBeenCalled();
      expect(txMock.expense.create.mock.calls[0][0].data).toMatchObject({
        supplierId: 'sup-9',
        purchaseOrderId: 'po-1',
      });
    });

    it('accepts a RECEIVED order of the same supplier', async () => {
      prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        buildOrder({ status: 'RECEIVED' }),
      );
      txMock.expense.create.mockResolvedValue({ id: 'exp-1', status: 'PAID' });

      await service.create(buildCreateDto(), userId, orgId);

      expect(txMock.expense.create).toHaveBeenCalledTimes(1);
    });

    it('keeps a create without an order unchanged', async () => {
      prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      txMock.expense.create.mockResolvedValue({ id: 'exp-1', status: 'PAID' });

      await service.create(
        buildCreateDto({ purchaseOrderId: undefined }),
        userId,
        orgId,
      );

      expect(prismaMock.purchaseOrder.findFirst).not.toHaveBeenCalled();
      expect(txMock.expense.create.mock.calls[0][0].data).toMatchObject({
        supplierId: 'sup-1',
        purchaseOrderId: null,
      });
    });
  });

  describe('update', () => {
    it('accepts an update that leaves the stored order and supplier untouched on a legacy mismatched row', async () => {
      // The stored link predates the rule: another supplier's order. The form
      // always sends both fields, so equality — not presence — decides.
      prismaMock.expense.findFirst.mockResolvedValue(
        buildExistingExpense({ supplierId: 'sup-1', purchaseOrderId: 'po-1' }),
      );
      prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      txMock.expense.update.mockResolvedValue(buildUpdatedExpense());

      const result = await service.update(
        'exp-1',
        {
          supplierId: 'sup-1',
          purchaseOrderId: 'po-1',
          description: 'Mantenimiento de equipos',
        },
        userId,
        orgId,
      );

      expect(prismaMock.purchaseOrder.findFirst).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'exp-1' });
    });

    it('rejects an update that changes the order to one of another supplier', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(
        buildExistingExpense({ supplierId: 'sup-1', purchaseOrderId: 'po-1' }),
      );
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        buildOrder({ id: 'po-2', supplierId: 'sup-2' }),
      );

      await expect(
        service.update('exp-1', { purchaseOrderId: 'po-2' }, userId, orgId),
      ).rejects.toThrow(
        'La orden de compra pertenece a otro proveedor. Elige una orden del proveedor de este gasto',
      );

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an update that changes the supplier of a linked order with 400', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(
        buildExistingExpense({ supplierId: 'sup-1', purchaseOrderId: 'po-1' }),
      );
      prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-2' });
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        buildOrder({ supplierId: 'sup-1' }),
      );

      await expect(
        service.update('exp-1', { supplierId: 'sup-2' }, userId, orgId),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an update that links a DRAFT order with 400', async () => {
      prismaMock.expense.findFirst.mockResolvedValue(
        buildExistingExpense({ supplierId: 'sup-1', purchaseOrderId: null }),
      );
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        buildOrder({ status: 'DRAFT' }),
      );

      await expect(
        service.update('exp-1', { purchaseOrderId: 'po-1' }, userId, orgId),
      ).rejects.toThrow(
        'Solo puedes ligar una orden de compra pendiente, recibida parcialmente o recibida',
      );

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
