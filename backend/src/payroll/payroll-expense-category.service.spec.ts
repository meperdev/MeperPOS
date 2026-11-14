import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import {
  PAYROLL_EXPENSE_CATEGORY_NAME,
  PayrollExpenseCategoryService,
  resolvePayrollExpenseCategoryWithin,
} from './payroll-expense-category.service';

const admin = {
  userId: 'actor',
  email: 'owner@example.com',
  organizationId: 'org',
  role: 'ADMIN',
  tokenVersion: 0,
  isSuperAdmin: false,
} as RequestUser;

interface SetupOptions {
  organizationRows?: { id: string }[];
  association?: { labelId: string; groupId: string } | null;
  group?: { id: string; active: boolean } | null;
  label?: { id: string; groupId: string; active: boolean } | null;
  existingGroup?: { id: string } | null;
}

// Mocked Prisma only: this suite does not exercise PostgreSQL row locks,
// transaction rollback, foreign keys or concurrent writers.
function setup(options: SetupOptions = {}) {
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue(options.organizationRows ?? [{ id: 'org' }]),
    payrollExpenseCategory: {
      findUnique: jest.fn().mockResolvedValue(options.association ?? null),
      create: jest.fn().mockResolvedValue({ organizationId: 'org' }),
    },
    expenseGroup: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.group === undefined
            ? { id: 'grp', active: true }
            : options.group,
        ),
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.existingGroup === undefined ? null : options.existingGroup,
        ),
      create: jest.fn().mockResolvedValue({ id: 'grp' }),
    },
    expenseLabel: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.label === undefined
            ? { id: 'lbl', groupId: 'grp', active: true }
            : options.label,
        ),
      // Labels are unique per group only, so the service must never run a
      // tenant-wide label-name gate.
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'lbl' }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit' }),
    },
  };
  const transaction = jest.fn(
    async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  );
  const service = new PayrollExpenseCategoryService({
    $transaction: transaction,
  } as unknown as PrismaService);
  return { service, tx, transaction };
}

const association = { labelId: 'label-id', groupId: 'group-id' };
const activeGroup = { id: 'group-id', active: true };
const activeLabel = { id: 'label-id', groupId: 'group-id', active: true };

describe('PayrollExpenseCategoryService', () => {
  it('names the automatically created category Nómina', () => {
    expect(PAYROLL_EXPENSE_CATEGORY_NAME).toBe('Nómina');
  });

  it.each([
    ['a missing actor', undefined],
    ['an actor without a user', { ...admin, userId: '' }],
    [
      'an actor from another organization',
      { ...admin, organizationId: 'org-2' },
    ],
    [
      'an actor without an organization',
      { ...admin, organizationId: undefined },
    ],
    ['a MEMBER actor', { ...admin, role: 'MEMBER' }],
    ['a CASHIER actor', { ...admin, role: 'CASHIER' }],
    ['an INVENTORY_USER actor', { ...admin, role: 'INVENTORY_USER' }],
  ])('rejects %s before opening a transaction', async (_case, actor) => {
    const { service, transaction } = setup();
    await expect(
      service.resolve('org', actor as RequestUser | undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a missing organization before opening a transaction', async () => {
    const { service, transaction } = setup();
    await expect(service.resolve(undefined, admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    'lets %s resolve and locks the organization row before the association',
    async (role) => {
      const { service, tx } = setup({
        association,
        group: activeGroup,
        label: activeLabel,
      });
      await service.resolve('org', { ...admin, role } as RequestUser);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const [sql, ...values] = tx.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(sql.join('?')).toMatch(
        /FROM "Organization"[\s\S]*"id" = \?[\s\S]*FOR UPDATE/,
      );
      expect(values).toEqual(['org']);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.payrollExpenseCategory.findUnique.mock.invocationCallOrder[0],
      );
    },
  );

  it('rejects an unknown organization without writing taxonomy or audit', async () => {
    const { service, tx } = setup({ organizationRows: [] });
    await expect(service.resolve('org', admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
    expect(tx.expenseGroup.findFirst).not.toHaveBeenCalled();
    expect(tx.expenseGroup.create).not.toHaveBeenCalled();
    expect(tx.expenseLabel.create).not.toHaveBeenCalled();
    expect(tx.payrollExpenseCategory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('resolves an existing association by its stored stable ids, never by name', async () => {
    const { service, tx } = setup({
      association,
      group: activeGroup,
      label: activeLabel,
    });
    await expect(service.resolve('org', admin)).resolves.toEqual({
      organizationId: 'org',
      groupId: 'group-id',
      labelId: 'label-id',
    });
    expect(tx.payrollExpenseCategory.findUnique).toHaveBeenCalledWith({
      where: { organizationId: 'org' },
    });
    expect(tx.expenseGroup.findUnique).toHaveBeenCalledWith({
      where: { id_organizationId: { id: 'group-id', organizationId: 'org' } },
    });
    expect(tx.expenseLabel.findUnique).toHaveBeenCalledWith({
      where: {
        id_groupId_organizationId: {
          id: 'label-id',
          groupId: 'group-id',
          organizationId: 'org',
        },
      },
    });
    expect(tx.expenseGroup.findFirst).not.toHaveBeenCalled();
    expect(tx.expenseLabel.findFirst).not.toHaveBeenCalled();
    expect(tx.expenseGroup.create).not.toHaveBeenCalled();
    expect(tx.expenseLabel.create).not.toHaveBeenCalled();
    expect(tx.payrollExpenseCategory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('is idempotent once the association exists', async () => {
    const { service, tx } = setup({
      association,
      group: activeGroup,
      label: activeLabel,
    });
    const first = await service.resolve('org', admin);
    await expect(service.resolve('org', admin)).resolves.toEqual(first);
    expect(tx.payrollExpenseCategory.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.expenseGroup.create).not.toHaveBeenCalled();
    expect(tx.expenseLabel.create).not.toHaveBeenCalled();
    expect(tx.payrollExpenseCategory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['group is inactive', { group: { id: 'group-id', active: false } }],
    ['label is inactive', { label: { ...activeLabel, active: false } }],
    ['group is not in the tenant', { group: null }],
    ['label is not in the tenant', { label: null }],
  ])(
    'fails closed without reactivating when the associated %s',
    async (_case, overrides) => {
      const { service, tx } = setup({
        association,
        group: activeGroup,
        label: activeLabel,
        ...overrides,
      });
      await expect(service.resolve('org', admin)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.expenseGroup.create).not.toHaveBeenCalled();
      expect(tx.expenseLabel.create).not.toHaveBeenCalled();
      expect(tx.payrollExpenseCategory.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('creates its own group and label, then the association, with actor-attributed audit rows', async () => {
    const { service, tx, transaction } = setup({
      association: null,
      existingGroup: null,
    });
    await expect(service.resolve('org', admin)).resolves.toEqual({
      organizationId: 'org',
      groupId: 'grp',
      labelId: 'lbl',
    });
    expect(tx.expenseGroup.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org',
        name: PAYROLL_EXPENSE_CATEGORY_NAME,
      },
      select: { id: true },
    });
    expect(tx.expenseLabel.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org',
        groupId: 'grp',
        name: PAYROLL_EXPENSE_CATEGORY_NAME,
      },
      select: { id: true },
    });
    expect(tx.payrollExpenseCategory.create).toHaveBeenCalledWith({
      data: { organizationId: 'org', groupId: 'grp', labelId: 'lbl' },
    });
    expect(tx.auditLog.create).toHaveBeenNthCalledWith(1, {
      data: {
        userId: 'actor',
        organizationId: 'org',
        action: 'PAYROLL_EXPENSE_CATEGORY_GROUP_CREATED',
        resource: 'ExpenseTaxonomy',
        resourceId: 'grp',
        metadata: { name: PAYROLL_EXPENSE_CATEGORY_NAME },
      },
    });
    expect(tx.auditLog.create).toHaveBeenNthCalledWith(2, {
      data: {
        userId: 'actor',
        organizationId: 'org',
        action: 'PAYROLL_EXPENSE_CATEGORY_LABEL_CREATED',
        resource: 'ExpenseTaxonomy',
        resourceId: 'lbl',
        metadata: { name: PAYROLL_EXPENSE_CATEGORY_NAME, groupId: 'grp' },
      },
    });
    expect(tx.auditLog.create).toHaveBeenNthCalledWith(3, {
      data: {
        userId: 'actor',
        organizationId: 'org',
        action: 'PAYROLL_EXPENSE_CATEGORY_ASSIGNED',
        resource: 'PayrollExpenseCategory',
        // The association's primary key is the organization id; the new stable
        // category ids travel in the metadata.
        resourceId: 'org',
        metadata: { groupId: 'grp', labelId: 'lbl' },
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(3);
    expect(transaction).toHaveBeenCalledTimes(1);
    const order = [
      tx.expenseGroup.create.mock.invocationCallOrder[0],
      tx.auditLog.create.mock.invocationCallOrder[0],
      tx.expenseLabel.create.mock.invocationCallOrder[0],
      tx.auditLog.create.mock.invocationCallOrder[1],
      tx.payrollExpenseCategory.create.mock.invocationCallOrder[0],
      tx.auditLog.create.mock.invocationCallOrder[2],
    ];
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it('gates on a same-name group inside the tenant without reusing or reactivating it', async () => {
    const { service, tx } = setup({
      association: null,
      existingGroup: { id: 'legacy-group' },
    });
    await expect(service.resolve('org', admin)).rejects.toThrow(/Nómina/);
    await expect(service.resolve('org', admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.expenseGroup.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org', name: PAYROLL_EXPENSE_CATEGORY_NAME },
      select: { id: true },
    });
    expect(tx.expenseGroup.create).not.toHaveBeenCalled();
    expect(tx.expenseLabel.create).not.toHaveBeenCalled();
    expect(tx.payrollExpenseCategory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('creates its own label even when another group already uses that name', async () => {
    const { service, tx } = setup({ association: null, existingGroup: null });
    await expect(service.resolve('org', admin)).resolves.toEqual({
      organizationId: 'org',
      groupId: 'grp',
      labelId: 'lbl',
    });
    // Labels are unique per group, so an existing label of the same name in an
    // unrelated group is neither a conflict nor something to reassign.
    expect(tx.expenseLabel.findFirst).not.toHaveBeenCalled();
    expect(tx.expenseLabel.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org',
        groupId: 'grp',
        name: PAYROLL_EXPENSE_CATEGORY_NAME,
      },
      select: { id: true },
    });
  });

  it('reuses the existing taxonomy audit resource for group and label, keeping distinct actions', async () => {
    const { service, tx } = setup({ association: null, existingGroup: null });
    await service.resolve('org', admin);
    // ExpenseTaxonomyService.audit() writes resource 'ExpenseTaxonomy' with the
    // created entity id as resourceId; payroll keeps that resource so existing
    // taxonomy history stays queryable, and adds its own distinct actions.
    expect(
      tx.auditLog.create.mock.calls.map(([argument]) => [
        (argument as { data: { resource: string; action: string } }).data
          .resource,
        (argument as { data: { resource: string; action: string } }).data
          .action,
      ]),
    ).toEqual([
      ['ExpenseTaxonomy', 'PAYROLL_EXPENSE_CATEGORY_GROUP_CREATED'],
      ['ExpenseTaxonomy', 'PAYROLL_EXPENSE_CATEGORY_LABEL_CREATED'],
      ['PayrollExpenseCategory', 'PAYROLL_EXPENSE_CATEGORY_ASSIGNED'],
    ]);
  });

  it('maps a unique conflict to a conflict error without retrying', async () => {
    const { service, transaction } = setup();
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('race', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(service.resolve('org', admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('maps a write conflict to a conflict error without retrying', async () => {
    const { service, transaction } = setup();
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('race', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    await expect(service.resolve('org', admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2, 3] as const)(
    'propagates an audit failure on write %s instead of mapping it',
    async (auditWrite) => {
      const { service, tx } = setup({
        association: null,
        existingGroup: null,
      });
      const failure = new Prisma.PrismaClientKnownRequestError('audit', {
        code: 'P2002',
        clientVersion: 'test',
      });
      for (let write = 1; write < auditWrite; write++)
        tx.auditLog.create.mockResolvedValueOnce({ id: `audit-${write}` });
      tx.auditLog.create.mockRejectedValueOnce(failure);

      await expect(service.resolve('org', admin)).rejects.toBe(failure);
      // The mock has no rollback: it only proves the error surfaces unchanged
      // and that nothing runs after the failing audit write.
      if (auditWrite < 3)
        expect(tx.payrollExpenseCategory.create).not.toHaveBeenCalled();
      else expect(tx.auditLog.create).toHaveBeenCalledTimes(3);
    },
  );

  it('lets unrelated failures propagate instead of masking them as conflicts', async () => {
    const { service, transaction } = setup();
    const failure = new Error('conexión perdida');
    transaction.mockRejectedValueOnce(failure);
    await expect(service.resolve('org', admin)).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

// The transaction-scoped entry point exists so a payroll completion can resolve
// the category inside the transaction that already holds its payroll locks. These
// mocks prove ordering and that no nested transaction is opened; they cannot prove
// PostgreSQL locking or rollback.
describe('transaction-scoped category resolution', () => {
  it.each([
    ['a missing actor', undefined],
    ['an actor without a user', { ...admin, userId: '' }],
    [
      'an actor from another organization',
      { ...admin, organizationId: 'org-2' },
    ],
    ['a MEMBER actor', { ...admin, role: 'MEMBER' }],
    ['a CASHIER actor', { ...admin, role: 'CASHIER' }],
    ['an INVENTORY_USER actor', { ...admin, role: 'INVENTORY_USER' }],
  ])(
    'rejects %s before touching the caller transaction',
    async (_case, who) => {
      const { tx } = setup();
      await expect(
        resolvePayrollExpenseCategoryWithin(
          tx as unknown as Prisma.TransactionClient,
          'org',
          who as RequestUser | undefined,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing organization before touching the caller transaction', async () => {
    const { tx } = setup();
    await expect(
      resolvePayrollExpenseCategoryWithin(
        tx as unknown as Prisma.TransactionClient,
        undefined,
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('locks the organization row in the caller transaction without opening another one', async () => {
    const { tx, transaction } = setup({
      association,
      group: activeGroup,
      label: activeLabel,
    });
    await expect(
      resolvePayrollExpenseCategoryWithin(
        tx as unknown as Prisma.TransactionClient,
        'org',
        admin,
      ),
    ).resolves.toEqual({
      organizationId: 'org',
      groupId: 'group-id',
      labelId: 'label-id',
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toMatch(
      /FROM "Organization"[\s\S]*FOR UPDATE/,
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.payrollExpenseCategory.findUnique.mock.invocationCallOrder[0],
    );
  });

  it('creates the missing category inside the caller transaction', async () => {
    const { tx, transaction } = setup({
      organizationRows: [{ id: 'org' }],
      association: null,
      existingGroup: null,
    });
    await expect(
      resolvePayrollExpenseCategoryWithin(
        tx as unknown as Prisma.TransactionClient,
        'org',
        admin,
      ),
    ).resolves.toEqual({
      organizationId: 'org',
      groupId: 'grp',
      labelId: 'lbl',
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(tx.payrollExpenseCategory.create).toHaveBeenCalledWith({
      data: { organizationId: 'org', groupId: 'grp', labelId: 'lbl' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(3);
  });

  it('rejects an unknown organization without writing taxonomy', async () => {
    const { tx } = setup({ organizationRows: [] });
    await expect(
      resolvePayrollExpenseCategoryWithin(
        tx as unknown as Prisma.TransactionClient,
        'org',
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.expenseGroup.create).not.toHaveBeenCalled();
    expect(tx.expenseLabel.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['P2002', 'P2034'])(
    'maps a %s conflict from the caller transaction without retrying',
    async (code) => {
      const { tx } = setup({ association: null, existingGroup: null });
      tx.payrollExpenseCategory.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('race', {
          code,
          clientVersion: 'test',
        }),
      );
      await expect(
        resolvePayrollExpenseCategoryWithin(
          tx as unknown as Prisma.TransactionClient,
          'org',
          admin,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.payrollExpenseCategory.create).toHaveBeenCalledTimes(1);
    },
  );

  it('propagates an audit failure from the caller transaction unchanged', async () => {
    const { tx } = setup({ association: null, existingGroup: null });
    const failure = new Prisma.PrismaClientKnownRequestError('audit', {
      code: 'P2002',
      clientVersion: 'test',
    });
    tx.auditLog.create.mockRejectedValueOnce(failure);
    await expect(
      resolvePayrollExpenseCategoryWithin(
        tx as unknown as Prisma.TransactionClient,
        'org',
        admin,
      ),
    ).rejects.toBe(failure);
    expect(tx.expenseLabel.create).not.toHaveBeenCalled();
  });
});
