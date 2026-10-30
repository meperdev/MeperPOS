import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ExpensePaymentStatus, PaymentMethod, Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import {
  formatDateInBogota,
  parseBogotaMonthRange,
} from '../common/utils/bogota-date';
import {
  PayrollCompletionExpenseWriteInput,
  writePayrollCompletionExpense,
} from './payroll-completed-expense-writer';
import type { PayrollObligationCompletionFacts } from './payroll-obligation-completion';

const actor = {
  userId: 'user-1',
  organizationId: 'org-1',
  role: 'OWNER',
} as RequestUser;

const category = {
  organizationId: 'org-1',
  groupId: 'group-1',
  labelId: 'label-1',
};

// The approved explicit limit error of an expense-enabled completed payment.
const LIMIT_ERROR =
  'El gasto de nómina supera $9.999.999.999,99; el pago no se puede completar con gasto';

const outflow = (
  id: string,
  amount: string,
  date = '2024-03-01',
  method: PaymentMethod = PaymentMethod.CASH,
) => ({ id, amount, date, method });

const facts = (
  overrides: Partial<PayrollObligationCompletionFacts> = {},
): PayrollObligationCompletionFacts => ({
  total: '2000.00',
  outflows: [outflow('outflow-1', '2000.00')],
  expenseChoice: true,
  completionDate: '2024-03-31',
  ...overrides,
});

// A completed obligation whose single real outflow covers the whole total.
const completed = (
  total: string,
  overrides: Partial<PayrollObligationCompletionFacts> = {},
) => facts({ total, outflows: [outflow('outflow-1', total)], ...overrides });

const input = (
  overrides: Partial<PayrollCompletionExpenseWriteInput> = {},
): PayrollCompletionExpenseWriteInput => ({
  organizationId: 'org-1',
  employeeId: 'employee-1',
  obligationId: 'obligation-1',
  actor,
  category,
  facts: facts(),
  ...overrides,
});

type PaymentCreate = {
  amount: Prisma.Decimal;
  method: PaymentMethod;
  date: Date;
};
type ExpenseCreate = {
  date: Date;
  total: Prisma.Decimal;
  payments: { create: PaymentCreate[] };
};

// The writer receives the caller's transaction client, so the mock exposes
// `$transaction` only to prove it is never called: this unit must reuse the
// supplied client instead of opening a nested transaction. Mocks cannot prove
// rollback, foreign keys or PostgreSQL concurrency; they only prove which effects
// this unit requests and in which order it validates them.
function setup() {
  return {
    $transaction: jest.fn(),
    // Default: a linked expense row exists and is lockable.
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'expense-existing' }]),
    payrollCashOutflow: { create: jest.fn() },
    payrollExpenseCategory: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ labelId: 'label-1', groupId: 'group-1' }),
    },
    expenseLabel: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ active: true, group: { active: true } }),
    },
    payrollObligationExpense: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    expense: {
      create: jest.fn().mockResolvedValue({ id: 'expense-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

type StoredPayment = {
  organizationId: string;
  amount: string;
  method: PaymentMethod;
  date: string;
};

// A persisted expense that the replay path reads back from the caller's tx.
function storedExpense(
  overrides: {
    id?: string;
    active?: boolean;
    total?: string;
    date?: string;
    payments?: StoredPayment[];
  } = {},
) {
  const total = overrides.total ?? '2000.00';
  const payments: StoredPayment[] = overrides.payments ?? [
    {
      organizationId: 'org-1',
      amount: total,
      method: PaymentMethod.CASH,
      date: '2024-03-01',
    },
  ];
  return {
    id: overrides.id ?? 'expense-existing',
    active: overrides.active ?? true,
    total: new Prisma.Decimal(total),
    date: new Date(`${overrides.date ?? '2024-03-31'}T05:00:00.000Z`),
    payments: payments.map((payment) => ({
      organizationId: payment.organizationId,
      amount: new Prisma.Decimal(payment.amount),
      method: payment.method,
      date: new Date(`${payment.date}T05:00:00.000Z`),
    })),
  };
}

type Tx = ReturnType<typeof setup>;
const write = (
  tx: Tx,
  overrides: Partial<PayrollCompletionExpenseWriteInput> = {},
) =>
  writePayrollCompletionExpense(
    tx as unknown as Prisma.TransactionClient,
    input(overrides),
  );
const expenseData = (tx: Tx): ExpenseCreate =>
  tx.expense.create.mock.calls[0][0].data;
const paymentsData = (tx: Tx): PaymentCreate[] =>
  expenseData(tx).payments.create;
const amounts = (payments: PaymentCreate[]) =>
  payments.map((payment) => payment.amount.toFixed(2));
const days = (payments: PaymentCreate[]) =>
  payments.map((payment) => payment.date.toISOString());

describe('writePayrollCompletionExpense (mock transaction only)', () => {
  describe('approved rules for a completed obligation', () => {
    it('creates the expense, one payment per outflow and the immutable link in the caller transaction', async () => {
      const tx = setup();

      expect(await write(tx)).toEqual({
        kind: 'created',
        expenseId: 'expense-1',
        total: '2000.00',
        payments: 1,
      });
      expect(tx.expense.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          labelId: 'label-1',
          description: null,
          date: new Date('2024-03-31T05:00:00.000Z'),
          total: new Prisma.Decimal('2000.00'),
          status: ExpensePaymentStatus.PAID,
          createdById: 'user-1',
          payments: {
            create: [
              {
                organizationId: 'org-1',
                amount: new Prisma.Decimal('2000.00'),
                method: PaymentMethod.CASH,
                date: new Date('2024-03-01T05:00:00.000Z'),
              },
            ],
          },
        },
        select: { id: true },
      });
      expect(tx.payrollObligationExpense.create).toHaveBeenCalledWith({
        data: {
          obligationId: 'obligation-1',
          organizationId: 'org-1',
          employeeId: 'employee-1',
          expenseId: 'expense-1',
        },
      });
      expect(tx.$transaction).not.toHaveBeenCalled();
      expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
    });

    it('reads only the tenant-bound category identity', async () => {
      const tx = setup();
      await write(tx);
      expect(tx.payrollExpenseCategory.findUnique).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        select: { labelId: true, groupId: true },
      });
      expect(tx.expenseLabel.findUnique).toHaveBeenCalledWith({
        where: {
          id_groupId_organizationId: {
            id: 'label-1',
            groupId: 'group-1',
            organizationId: 'org-1',
          },
        },
        select: { active: true, group: { select: { active: true } } },
      });
    });

    it('keeps same-day outflows as distinct expense payments', async () => {
      const tx = setup();
      expect(
        await write(tx, {
          facts: facts({
            total: '30.00',
            outflows: [
              outflow('a', '10.00', '2024-03-05'),
              outflow('b', '20.00', '2024-03-05', PaymentMethod.TRANSFER),
            ],
          }),
        }),
      ).toMatchObject({ kind: 'created', total: '30.00', payments: 2 });
      expect(amounts(paymentsData(tx))).toEqual(['10.00', '20.00']);
      expect(paymentsData(tx).map((payment) => payment.method)).toEqual([
        'CASH',
        'TRANSFER',
      ]);
      expect(days(paymentsData(tx))).toEqual([
        '2024-03-05T05:00:00.000Z',
        '2024-03-05T05:00:00.000Z',
      ]);
    });

    it('preserves a corrected outflow amount without inventing a new cash row', async () => {
      const tx = setup();
      await write(tx, {
        facts: facts({
          outflows: [
            outflow('a', '500.00'),
            outflow('b', '1500.00', '2024-03-02', PaymentMethod.CARD),
          ],
          corrections: [{ outflowId: 'b', amount: '1500.00' }],
        }),
      });
      expect(amounts(paymentsData(tx))).toEqual(['500.00', '1500.00']);
      expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
    });
  });

  describe('representability boundary', () => {
    it('creates an expense exactly at 9999999999.99', async () => {
      const tx = setup();
      expect(
        await write(tx, { facts: completed('9999999999.99') }),
      ).toMatchObject({ kind: 'created', total: '9999999999.99' });
      expect(expenseData(tx).total.toFixed(2)).toBe('9999999999.99');
    });

    it('blocks an expense above the limit instead of capping, rounding or omitting it', async () => {
      const tx = setup();
      await expect(
        write(tx, { facts: completed('10000000000.00') }),
      ).rejects.toThrow(LIMIT_ERROR);
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expenseLabel.findUnique).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.findFirst).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    });

    it.each<[string, typeof category | undefined, (tx: Tx) => void]>([
      ['an absent category', undefined, () => undefined],
      ['an active category', category, () => undefined],
      [
        'a missing association',
        category,
        (tx) => tx.payrollExpenseCategory.findUnique.mockResolvedValue(null),
      ],
      [
        'an inactive category',
        category,
        (tx) =>
          tx.expenseLabel.findUnique.mockResolvedValue({
            active: false,
            group: { active: true },
          }),
      ],
    ])(
      'fails an over-limit expense with the explicit limit error before any read or write, given %s',
      async (_label, givenCategory, prepare) => {
        const tx = setup();
        prepare(tx);

        await expect(
          write(tx, {
            category: givenCategory,
            facts: completed('10000000000.00'),
          }),
        ).rejects.toThrow(LIMIT_ERROR);
        expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
        expect(tx.expenseLabel.findUnique).not.toHaveBeenCalled();
        expect(tx.payrollObligationExpense.findUnique).not.toHaveBeenCalled();
        expect(tx.expense.findFirst).not.toHaveBeenCalled();
        expect(tx.expense.create).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
        expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
      },
    );

    it('never applies the limit to payroll without an expense', async () => {
      const tx = setup();
      expect(
        await write(tx, {
          facts: completed('10000000000.00', { expenseChoice: false }),
        }),
      ).toEqual({ kind: 'disabled' });
      expect(tx.expense.create).not.toHaveBeenCalled();
    });
  });

  describe('no expense without an enabled, completed choice', () => {
    it.each<[boolean | null, string]>([
      [false, 'disabled'],
      [null, 'unknown_choice'],
    ])(
      'needs no expense category and writes nothing for the stored choice %p',
      async (choice, kind) => {
        const tx = setup();
        expect(
          await write(tx, {
            facts: facts({ expenseChoice: choice }),
            category: undefined,
          }),
        ).toEqual({ kind });
        expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
        expect(tx.expenseLabel.findUnique).not.toHaveBeenCalled();
        expect(tx.payrollObligationExpense.findUnique).not.toHaveBeenCalled();
        expect(tx.expense.create).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
        expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
      },
    );

    it('needs no expense category and writes nothing while the balance remains', async () => {
      const tx = setup();
      expect(
        await write(tx, {
          facts: facts({
            total: '5000.00',
            outflows: [outflow('a', '2000.00')],
          }),
          category: undefined,
        }),
      ).toEqual({ kind: 'awaiting_completion' });
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expenseLabel.findUnique).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    });
  });

  describe('payer actor and tenant', () => {
    it.each<[string, Partial<PayrollCompletionExpenseWriteInput>]>([
      ['another tenant', { actor: { ...actor, organizationId: 'org-2' } }],
      ['a member role', { actor: { ...actor, role: 'MEMBER' } }],
      ['no actor', { actor: undefined }],
    ])('refuses %s before reading or writing', async (_label, overrides) => {
      const tx = setup();
      await expect(write(tx, overrides)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
    });

    it.each<[string, Partial<PayrollObligationCompletionFacts>]>([
      ['a disabled expense choice', { expenseChoice: false }],
      ['an unknown expense choice', { expenseChoice: null }],
      ['an incomplete payment', { total: '5000.00' }],
    ])(
      'enforces matching-tenant OWNER/ADMIN even for %s',
      async (_label, overrides) => {
        const tx = setup();
        await expect(
          write(tx, {
            facts: facts(overrides),
            actor: { ...actor, organizationId: 'org-2' },
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          write(tx, {
            facts: facts(overrides),
            actor: { ...actor, role: 'MEMBER' },
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
        expect(tx.expense.create).not.toHaveBeenCalled();
      },
    );

    it('refuses a category identity from another tenant', async () => {
      const tx = setup();
      await expect(
        write(tx, { category: { ...category, organizationId: 'org-2' } }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.expense.create).not.toHaveBeenCalled();
    });
  });

  describe('bound and active category', () => {
    it('requires the category for a representable expense that will be written', async () => {
      const tx = setup();
      await expect(write(tx, { category: undefined })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expenseLabel.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
    });

    it('refuses a tenant without an assigned payroll category', async () => {
      const tx = setup();
      tx.payrollExpenseCategory.findUnique.mockResolvedValue(null);
      await expect(write(tx)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.expense.create).not.toHaveBeenCalled();
    });

    it('refuses a caller identity that is not the bound category', async () => {
      const tx = setup();
      tx.payrollExpenseCategory.findUnique.mockResolvedValue({
        labelId: 'label-2',
        groupId: 'group-1',
      });
      await expect(write(tx)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.expense.create).not.toHaveBeenCalled();
    });

    it.each<[string, unknown]>([
      ['a missing label', null],
      ['an inactive label', { active: false, group: { active: true } }],
      ['an inactive group', { active: true, group: { active: false } }],
    ])('refuses %s', async (_label, label) => {
      const tx = setup();
      tx.expenseLabel.findUnique.mockResolvedValue(label);
      await expect(write(tx)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.expense.create).not.toHaveBeenCalled();
    });
  });

  describe('Bogotá calendar-day timestamps', () => {
    it.each<[string, string]>([
      ['2024-01-01', '2024-01'],
      ['2024-12-31', '2024-12'],
      ['2024-03-01', '2024-03'],
    ])(
      'stores %p as the Bogotá start of that same calendar day',
      async (day, month) => {
        const tx = setup();
        await write(tx, {
          facts: facts({
            completionDate: day,
            outflows: [outflow('a', '2000.00', day)],
          }),
        });
        const expenseDate = expenseData(tx).date;
        const paymentDate = paymentsData(tx)[0].date;
        expect(expenseDate.toISOString()).toBe(`${day}T05:00:00.000Z`);
        expect(paymentDate.toISOString()).toBe(`${day}T05:00:00.000Z`);
        expect(formatDateInBogota(expenseDate)).toBe(day);
        expect(formatDateInBogota(paymentDate)).toBe(day);
        const range = parseBogotaMonthRange(month);
        expect(expenseDate.getTime()).toBeGreaterThanOrEqual(
          range.start.getTime(),
        );
        expect(expenseDate.getTime()).toBeLessThanOrEqual(range.end.getTime());
      },
    );

    it.each(['0001-01-01', '0099-12-31'])(
      'keeps the year %p instead of coercing it to the 1900s',
      async (day) => {
        const tx = setup();
        await write(tx, {
          facts: facts({
            completionDate: day,
            outflows: [outflow('a', '2000.00', day)],
          }),
        });
        expect(expenseData(tx).date.toISOString()).toBe(`${day}T05:00:00.000Z`);
        expect(days(paymentsData(tx))).toEqual([`${day}T05:00:00.000Z`]);
      },
    );
  });

  describe('verified replay of an existing link', () => {
    const linked = (tx: Tx) =>
      tx.payrollObligationExpense.findUnique.mockResolvedValue({
        expenseId: 'expense-existing',
      });
    const sameDayPayments = (count: number) =>
      storedExpense({
        total: '20.00',
        payments: Array.from({ length: count }, () => ({
          organizationId: 'org-1',
          amount: '10.00',
          method: PaymentMethod.CASH,
          date: '2024-03-05',
        })),
      });

    it('reuses the existing link without creating a second expense', async () => {
      const tx = setup();
      linked(tx);
      tx.expense.findFirst.mockResolvedValue(storedExpense());

      expect(await write(tx)).toEqual({
        kind: 'already_linked',
        expenseId: 'expense-existing',
      });
      expect(tx.payrollObligationExpense.findUnique).toHaveBeenCalledWith({
        where: {
          obligationId_organizationId_employeeId: {
            obligationId: 'obligation-1',
            organizationId: 'org-1',
            employeeId: 'employee-1',
          },
        },
        select: { expenseId: true },
      });
      // The persisted expense is read back inside the caller's tenant.
      expect(tx.expense.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'expense-existing', organizationId: 'org-1' },
        }),
      );
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    });

    it('replays even when the payroll category is now absent or inactive', async () => {
      const tx = setup();
      linked(tx);
      tx.expense.findFirst.mockResolvedValue(storedExpense());
      tx.payrollExpenseCategory.findUnique.mockResolvedValue(null);
      tx.expenseLabel.findUnique.mockResolvedValue({
        active: false,
        group: { active: false },
      });

      expect(await write(tx)).toEqual({
        kind: 'already_linked',
        expenseId: 'expense-existing',
      });
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expenseLabel.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    });

    it.each<[string, ReturnType<typeof storedExpense> | null]>([
      ['an inactive expense', storedExpense({ active: false })],
      ['an expense outside the tenant', null],
      ['a different total', storedExpense({ total: '1999.99' })],
      ['a different expense date', storedExpense({ date: '2024-04-01' })],
      [
        'a different payment date',
        storedExpense({
          payments: [
            {
              organizationId: 'org-1',
              amount: '2000.00',
              method: PaymentMethod.CASH,
              date: '2024-03-02',
            },
          ],
        }),
      ],
      [
        'a different payment method',
        storedExpense({
          payments: [
            {
              organizationId: 'org-1',
              amount: '2000.00',
              method: PaymentMethod.TRANSFER,
              date: '2024-03-01',
            },
          ],
        }),
      ],
      [
        'a payment from another tenant',
        storedExpense({
          payments: [
            {
              organizationId: 'org-2',
              amount: '2000.00',
              method: PaymentMethod.CASH,
              date: '2024-03-01',
            },
          ],
        }),
      ],
      [
        'an unexpected extra payment',
        storedExpense({
          payments: [
            {
              organizationId: 'org-1',
              amount: '2000.00',
              method: PaymentMethod.CASH,
              date: '2024-03-01',
            },
            {
              organizationId: 'org-1',
              amount: '2000.00',
              method: PaymentMethod.CASH,
              date: '2024-03-01',
            },
          ],
        }),
      ],
    ])('fails closed on %s', async (_label, expense) => {
      const tx = setup();
      linked(tx);
      tx.expense.findFirst.mockResolvedValue(expense);

      await expect(write(tx)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    });

    it('matches duplicate same-day payments with multiplicity on create and replay', async () => {
      const duplicated = facts({
        total: '20.00',
        outflows: [
          outflow('a', '10.00', '2024-03-05'),
          outflow('b', '10.00', '2024-03-05'),
        ],
      });
      const created = setup();
      await write(created, { facts: duplicated });
      expect(amounts(paymentsData(created))).toEqual(['10.00', '10.00']);

      const onePayment = setup();
      linked(onePayment);
      onePayment.expense.findFirst.mockResolvedValue(sameDayPayments(1));
      await expect(
        write(onePayment, { facts: duplicated }),
      ).rejects.toBeInstanceOf(ConflictException);

      const bothPayments = setup();
      linked(bothPayments);
      bothPayments.expense.findFirst.mockResolvedValue(sameDayPayments(2));
      expect(await write(bothPayments, { facts: duplicated })).toEqual({
        kind: 'already_linked',
        expenseId: 'expense-existing',
      });
    });
  });

  describe('category label row lock', () => {
    // The expense taxonomy API deactivates a label through a plain row update with
    // no surrounding transaction and no lock, so the writer takes the tenant label
    // row `FOR UPDATE` and only then re-reads its `active` flags. That serializes
    // the two taxonomy writers: a concurrent deactivation either waits for this
    // transaction or committed first and makes this call fail closed. Mocks prove
    // the order of the statements, not that PostgreSQL blocks.
    const labelLockParams = (tx: Tx) => tx.$queryRaw.mock.calls[0].slice(1);
    const lockSql = (tx: Tx) =>
      (tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    const INACTIVE_CATEGORY =
      'La categoría de gasto de nómina está inactiva o no pertenece a esta organización';

    it('locks the tenant label row before re-reading its active flags and writing', async () => {
      const tx = setup();
      const order: string[] = [];
      tx.payrollExpenseCategory.findUnique.mockImplementation(async () => {
        order.push('association');
        return { labelId: 'label-1', groupId: 'group-1' };
      });
      tx.$queryRaw.mockImplementation(async () => {
        order.push('lock-label');
        return [{ id: 'label-1' }];
      });
      tx.expenseLabel.findUnique.mockImplementation(async () => {
        order.push('read-label');
        return { active: true, group: { active: true } };
      });
      tx.expense.create.mockImplementation(async () => {
        order.push('create-expense');
        return { id: 'expense-1' };
      });

      expect(await write(tx)).toMatchObject({ kind: 'created' });
      expect(order).toEqual([
        'association',
        'lock-label',
        'read-label',
        'create-expense',
      ]);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(lockSql(tx)).toContain('FROM "ExpenseLabel"');
      expect(lockSql(tx)).toContain('FOR UPDATE');
      // Tenant identity and group identity travel in the same statement, so a
      // foreign or mismatched label can never be locked.
      expect(lockSql(tx)).toContain('"organizationId"');
      expect(lockSql(tx)).toContain('"groupId"');
      expect(labelLockParams(tx)).toEqual(['label-1', 'group-1', 'org-1']);
      expect(tx.$transaction).not.toHaveBeenCalled();
    });

    it('fails closed with the existing inactive-category conflict when the label row is not lockable', async () => {
      const tx = setup();
      tx.$queryRaw.mockResolvedValue([]);

      await expect(write(tx)).rejects.toThrow(INACTIVE_CATEGORY);
      await expect(write(tx)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.expenseLabel.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    });

    it('fails closed when the deactivation won the lock and the label is inactive after the lock', async () => {
      const tx = setup();
      // The lock succeeds, but the row it locked is already inactive: this is
      // exactly what the serialized deactivation looks like to the writer.
      tx.expenseLabel.findUnique.mockResolvedValue({
        active: false,
        group: { active: true },
      });

      await expect(write(tx)).rejects.toThrow(INACTIVE_CATEGORY);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(lockSql(tx)).toContain('FROM "ExpenseLabel"');
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    });

    it('takes no label lock when the choice writes no expense', async () => {
      const tx = setup();

      expect(
        await write(tx, {
          facts: facts({ expenseChoice: false }),
          category: undefined,
        }),
      ).toEqual({ kind: 'disabled' });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.expenseLabel.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
    });

    it('takes no label lock when it replays a verified link', async () => {
      const tx = setup();
      tx.payrollObligationExpense.findUnique.mockResolvedValue({
        expenseId: 'expense-existing',
      });
      tx.expense.findFirst.mockResolvedValue(storedExpense());

      expect(await write(tx)).toEqual({
        kind: 'already_linked',
        expenseId: 'expense-existing',
      });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(lockSql(tx)).toContain('FROM "Expense"');
      expect(lockSql(tx)).not.toContain('ExpenseLabel');
      expect(tx.expenseLabel.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('linked expense row lock', () => {
    // The expense API takes this same tenant-scoped `Expense ... FOR UPDATE` lock
    // before its own link check, so a replay must take it before reading the
    // expense it verifies and before any write.
    const lockSql = (tx: Tx) =>
      (tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');

    const isLinked = (tx: Tx) =>
      tx.payrollObligationExpense.findUnique.mockResolvedValue({
        expenseId: 'expense-existing',
      });

    it('locks the tenant expense row before reading the linked expense', async () => {
      const tx = setup();
      const order: string[] = [];
      tx.payrollObligationExpense.findUnique.mockImplementation(async () => {
        order.push('link');
        return { expenseId: 'expense-existing' };
      });
      tx.$queryRaw.mockImplementation(async () => {
        order.push('lock-expense');
        return [{ id: 'expense-existing' }];
      });
      tx.expense.findFirst.mockImplementation(async () => {
        order.push('read-expense');
        return storedExpense();
      });

      expect(await write(tx)).toEqual({
        kind: 'already_linked',
        expenseId: 'expense-existing',
      });
      expect(order).toEqual(['link', 'lock-expense', 'read-expense']);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(lockSql(tx)).toContain('FROM "Expense"');
      expect(lockSql(tx)).toContain('"organizationId"');
      expect(lockSql(tx)).toContain('FOR UPDATE');
      // One lock only: this unit takes no payroll or obligation lock.
      expect(lockSql(tx)).not.toMatch(/Payroll|Employee/);
      expect(tx.$transaction).not.toHaveBeenCalled();
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    });

    it('fails closed with a conflict and no writes when the linked row is not lockable', async () => {
      const tx = setup();
      isLinked(tx);
      tx.$queryRaw.mockResolvedValue([]);
      tx.expense.findFirst.mockResolvedValue(storedExpense());

      await expect(write(tx)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.expense.findFirst).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    });

    it('needs no pre-lock on the expense row for a first creation, which creates that row here', async () => {
      const tx = setup();

      expect(await write(tx)).toMatchObject({ kind: 'created' });
      // The only lock of a first creation is the category label lock.
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(lockSql(tx)).toContain('FROM "ExpenseLabel"');
      expect(lockSql(tx)).not.toContain('FROM "Expense"');
      expect(tx.expense.create).toHaveBeenCalledTimes(1);
      expect(tx.payrollObligationExpense.create).toHaveBeenCalledTimes(1);
    });

    it('takes no expense lock when the choice writes no expense', async () => {
      const tx = setup();

      expect(
        await write(tx, { facts: facts({ expenseChoice: false }) }),
      ).toEqual({ kind: 'disabled' });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('expense audit', () => {
    it('writes an actor-attributed EXPENSE_CREATED audit in the supplied transaction', async () => {
      const tx = setup();
      await write(tx);

      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          organizationId: 'org-1',
          action: 'EXPENSE_CREATED',
          resource: 'Expense',
          resourceId: 'expense-1',
          metadata: {
            summary: 'Salida creada por 2000',
            total: '2000',
            status: ExpensePaymentStatus.PAID,
            payments: [
              {
                amount: '2000',
                method: PaymentMethod.CASH,
                date: '2024-03-01',
              },
            ],
            timestamp: expect.any(String),
          },
        },
      });
      // The audit shares the caller's transaction and precedes the link write.
      expect(tx.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(
        tx.payrollObligationExpense.create.mock.invocationCallOrder[0],
      );
    });

    it('propagates an audit failure without writing the link', async () => {
      const tx = setup();
      const failure = new Error('audit failed');
      tx.auditLog.create.mockRejectedValue(failure);

      await expect(write(tx)).rejects.toBe(failure);
      expect(tx.expense.create).toHaveBeenCalledTimes(1);
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    });
  });

  describe('duplicates and failures', () => {
    it('propagates a planner rejection before any read or write', async () => {
      const tx = setup();
      await expect(
        write(tx, { facts: facts({ selectedExpenseDate: '2024-02-30' }) }),
      ).rejects.toThrow('Invalid expense date');
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
    });

    it('rejects malformed ids before any read or write', async () => {
      const tx = setup();
      await expect(write(tx, { employeeId: '' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
    });

    it('propagates an expense write failure without writing the link', async () => {
      const tx = setup();
      const failure = new Error('insert failed');
      tx.expense.create.mockRejectedValue(failure);
      await expect(write(tx)).rejects.toBe(failure);
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    });

    it('propagates a link write failure instead of retrying or swallowing it', async () => {
      const tx = setup();
      const failure = new Error('unique violation');
      tx.payrollObligationExpense.create.mockRejectedValue(failure);
      await expect(write(tx)).rejects.toBe(failure);
      expect(tx.expense.create).toHaveBeenCalledTimes(1);
    });
  });
});
