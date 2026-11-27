import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { ExpensesController } from './expenses.controller';

describe('ExpensesController', () => {
  const serviceMock = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    addPayment: jest.fn(),
    getMonthlySummary: jest.fn(),
    duplicate: jest.fn(),
    getHistory: jest.fn(),
    uploadReceipt: jest.fn(),
  };

  const adminUser: RequestUser = {
    userId: 'user-1',
    email: 'admin@example.com',
    organizationId: 'org-1',
    role: OrgRole.ADMIN,
    tokenVersion: 1,
    isSuperAdmin: false,
  };

  const createContext = (
    handler: (...args: unknown[]) => unknown,
    role: OrgRole,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => ExpensesController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires ADMIN on every handler', () => {
    const controller = new ExpensesController(serviceMock as never);
    const handlers = [
      controller.create,
      controller.findAll,
      controller.getMonthlySummary,
      controller.findOne,
      controller.update,
      controller.remove,
      controller.addPayment,
      controller.duplicate,
      controller.getHistory,
      controller.uploadReceipt,
    ];

    for (const handler of handlers) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([OrgRole.ADMIN]);
    }
  });

  it('denies CASHIER access through RolesGuard', () => {
    const controller = new ExpensesController(serviceMock as never);
    const guard = new RolesGuard(new Reflector());

    expect(() =>
      guard.canActivate(createContext(controller.findAll, OrgRole.CASHIER)),
    ).toThrow(ForbiddenException);
  });

  it('delegates CRUD with organizationId and userId from the token only', async () => {
    const controller = new ExpensesController(serviceMock as never);
    const body = {
      labelId: 'label-1',
      date: '2026-08-15',
      total: 500,
      payments: [{ amount: 500, method: 'CASH' as const, date: '2026-08-15' }],
    };
    const expense = { id: 'exp-1', organizationId: 'org-1' };

    serviceMock.create.mockResolvedValue(expense);
    serviceMock.findAll.mockResolvedValue({ data: [expense], meta: {} });
    serviceMock.findOne.mockResolvedValue(expense);
    serviceMock.update.mockResolvedValue(expense);
    serviceMock.remove.mockResolvedValue({ ...expense, active: false });

    await expect(controller.create(body, adminUser)).resolves.toEqual(expense);
    await expect(controller.findAll({}, adminUser)).resolves.toEqual({
      data: [expense],
      meta: {},
    });
    await expect(controller.findOne('exp-1', adminUser)).resolves.toEqual(
      expense,
    );
    await expect(controller.update('exp-1', body, adminUser)).resolves.toEqual(
      expense,
    );
    await expect(controller.remove('exp-1', adminUser)).resolves.toEqual({
      ...expense,
      active: false,
    });

    expect(serviceMock.create).toHaveBeenCalledWith(body, 'user-1', 'org-1');
    expect(serviceMock.findAll).toHaveBeenCalledWith({}, 'org-1');
    expect(serviceMock.findOne).toHaveBeenCalledWith('exp-1', 'org-1');
    expect(serviceMock.update).toHaveBeenCalledWith(
      'exp-1',
      body,
      'user-1',
      'org-1',
    );
    expect(serviceMock.remove).toHaveBeenCalledWith('exp-1', 'user-1', 'org-1');
  });

  it('delegates getMonthlySummary with month and organizationId from the token only', async () => {
    const controller = new ExpensesController(serviceMock as never);
    const summary = {
      month: '2026-08',
      total: 0,
      categories: [],
    };

    serviceMock.getMonthlySummary.mockResolvedValue(summary);

    await expect(
      controller.getMonthlySummary({ month: '2026-08' }, adminUser),
    ).resolves.toEqual(summary);

    expect(serviceMock.getMonthlySummary).toHaveBeenCalledWith(
      '2026-08',
      'org-1',
    );
  });

  it('delegates duplicate with expense id, userId and organizationId from the token only', async () => {
    const controller = new ExpensesController(serviceMock as never);
    const duplicated = { id: 'exp-2', organizationId: 'org-1', status: 'PAID' };

    serviceMock.duplicate.mockResolvedValue(duplicated);

    await expect(controller.duplicate('exp-1', adminUser)).resolves.toEqual(
      duplicated,
    );

    expect(serviceMock.duplicate).toHaveBeenCalledWith(
      'exp-1',
      'user-1',
      'org-1',
    );
  });

  it('delegates getHistory with expense id and organizationId from the token only', async () => {
    const controller = new ExpensesController(serviceMock as never);
    const entries = [{ id: 'a-1', action: 'EXPENSE_CREATED' }];

    serviceMock.getHistory.mockResolvedValue(entries);

    await expect(controller.getHistory('exp-1', adminUser)).resolves.toEqual(
      entries,
    );

    expect(serviceMock.getHistory).toHaveBeenCalledWith('exp-1', 'org-1');
  });

  it('delegates uploadReceipt with expense id, file, userId and organizationId from the token only', async () => {
    const controller = new ExpensesController(serviceMock as never);
    const file = {
      buffer: Buffer.from('fake'),
      originalname: 'receipt.jpg',
    } as unknown as Express.Multer.File;
    const updated = { id: 'exp-1', receiptUrl: 'https://cloud.example/r1.jpg' };

    serviceMock.uploadReceipt.mockResolvedValue(updated);

    await expect(
      controller.uploadReceipt('exp-1', adminUser, file),
    ).resolves.toEqual(updated);

    expect(serviceMock.uploadReceipt).toHaveBeenCalledWith(
      'exp-1',
      file,
      'user-1',
      'org-1',
    );
  });

  it('delegates addPayment with expense id, payment body, userId and organizationId from the token only', async () => {
    const controller = new ExpensesController(serviceMock as never);
    const payment = { amount: 100000, method: 'CASH' as const, date: '2026-08-20' };
    const expense = { id: 'exp-1', organizationId: 'org-1', status: 'PAID' };

    serviceMock.addPayment.mockResolvedValue(expense);

    await expect(
      controller.addPayment('exp-1', payment, adminUser),
    ).resolves.toEqual(expense);

    expect(serviceMock.addPayment).toHaveBeenCalledWith(
      'exp-1',
      payment,
      'user-1',
      'org-1',
    );
  });
});
