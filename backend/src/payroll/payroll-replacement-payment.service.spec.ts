import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  PayrollObligationKind,
  PayrollObligationStatus,
  Prisma,
} from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { PayrollReplacementPaymentService } from './payroll-replacement-payment.service';

const organizationId = 'org-a';
const employeeId = 'emp-a';
const sourceObligationId = 'obligation-source';
const targetObligationId = 'obligation-new';

function owner(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    userId: 'user-a',
    email: 'a@example.com',
    role: 'OWNER',
    isSuperAdmin: false,
    tokenVersion: 0,
    orgStatus: 'ACTIVE',
    organizationId,
    ...overrides,
  } as RequestUser;
}

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

function installment(
  id: string,
  outflowId: string,
  amount: string,
  day: string,
  method: 'CASH' | 'CARD' | 'TRANSFER',
  sharedInstallments = 1,
) {
  return {
    id,
    obligationId: sourceObligationId,
    outflowId,
    organizationId,
    employeeId,
    outflow: {
      id: outflowId,
      organizationId,
      employeeId,
      amount: new Prisma.Decimal(amount),
      date: date(day),
      method,
      _count: { installments: sharedInstallments },
    },
  };
}

function sourceRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: sourceObligationId,
    organizationId,
    employeeId,
    kind: PayrollObligationKind.FIXED_PERIOD,
    status: PayrollObligationStatus.COMPLETED,
    periodAmount: new Prisma.Decimal('1000000.00'),
    periodStart: date('2026-10-01'),
    periodEnd: date('2026-10-31'),
    installments: [
      installment(
        'installment-1',
        'outflow-1',
        '400000.00',
        '2026-10-15',
        'CASH',
      ),
      installment(
        'installment-2',
        'outflow-2',
        '600000.00',
        '2026-10-31',
        'TRANSFER',
      ),
    ],
    shiftMemberships: [],
    // References the source itself already counts (a replacement can itself be
    // the source of a later replacement).
    installmentReferences: [],
    ...overrides,
  };
}

type TxOptions = {
  employees?: { id: string }[];
  sourceLocks?: { id: string }[];
  cash?: string[];
  preLock?: Record<string, unknown> | null;
  source?: Record<string, unknown> | null;
  existingReferences?: Record<string, unknown>[];
};

// The interactive transaction is mocked: the payroll lock order and the exact
// payloads are asserted, no database is involved.
function buildTx(options: TxOptions = {}) {
  const table = (strings: TemplateStringsArray) => {
    const text = strings.join('$');
    if (text.includes('FROM "Employee"')) return 'Employee';
    if (text.includes('FROM "PayrollObligation"')) return 'PayrollObligation';
    if (text.includes('FROM "PayrollCashOutflow"')) return 'PayrollCashOutflow';
    return 'unknown';
  };
  const queryRaw = jest.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      switch (table(strings)) {
        case 'Employee':
          return Promise.resolve(options.employees ?? [{ id: employeeId }]);
        case 'PayrollObligation':
          return Promise.resolve(
            options.sourceLocks ?? [{ id: sourceObligationId }],
          );
        case 'PayrollCashOutflow':
          return Promise.resolve(
            (options.cash ?? ['outflow-1', 'outflow-2']).includes(
              values[0] as string,
            )
              ? [{ id: values[0] as string }]
              : [],
          );
        default:
          return Promise.resolve([]);
      }
    },
  );

  const obligationFindFirst = jest
    .fn()
    .mockResolvedValueOnce(
      options.preLock === undefined
        ? sourceRow({
            installments: [
              { id: 'installment-1', outflowId: 'outflow-1' },
              { id: 'installment-2', outflowId: 'outflow-2' },
            ],
          })
        : options.preLock,
    )
    .mockResolvedValueOnce(
      options.source === undefined ? sourceRow() : options.source,
    );
  const referenceFindMany = jest
    .fn()
    .mockResolvedValue(options.existingReferences ?? []);
  const obligationCreate = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: targetObligationId, ...args.data }),
  );
  const referenceCreateMany = jest.fn((args: { data: unknown[] }) =>
    Promise.resolve({ count: args.data.length }),
  );

  const tx = {
    $queryRaw: queryRaw,
    payrollObligation: {
      findFirst: obligationFindFirst,
      create: obligationCreate,
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    payrollObligationExpense: { create: jest.fn() },
    payrollInstallment: { update: jest.fn(), updateMany: jest.fn() },
    payrollInstallmentReference: {
      findMany: referenceFindMany,
      createMany: referenceCreateMany,
      create: jest.fn(),
    },
    payrollCashOutflow: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    expense: { create: jest.fn() },
    expensePayment: { createMany: jest.fn() },
  };
  return {
    tx,
    queryRaw,
    obligationFindFirst,
    referenceFindMany,
    obligationCreate,
    referenceCreateMany,
  };
}

function buildService(tx: unknown) {
  const transaction = jest.fn((run: (client: unknown) => Promise<unknown>) =>
    run(tx),
  );
  const prisma = { $transaction: transaction } as unknown as PrismaService;
  return { service: new PayrollReplacementPaymentService(prisma), transaction };
}

const validBody = {
  employeeId,
  sourceObligationId,
  installmentIds: ['installment-1'],
};

function create(
  body: unknown = validBody,
  options: TxOptions = {},
  actor: RequestUser | undefined = owner(),
  org: string | undefined = organizationId,
) {
  const built = buildTx(options);
  const { service, transaction } = buildService(built.tx);
  const result = {
    ...built,
    service,
    transaction,
    run: service.create(body, org, actor),
  };
  return result;
}

describe('PayrollReplacementPaymentService authorization and input', () => {
  it('refuses a caller without the payroll role or a matching tenant', async () => {
    for (const [org, actor] of [
      [undefined, owner()],
      ['', owner()],
      [organizationId, undefined],
      ['org-b', owner()],
      [organizationId, owner({ role: 'MEMBER' })],
      [organizationId, owner({ role: 'CASHIER' })],
      [organizationId, owner({ role: 'SUPER_ADMIN' as never })],
    ] as const) {
      const { service, transaction } = buildService(buildTx().tx);
      await expect(
        service.create(validBody, org, actor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction).not.toHaveBeenCalled();
    }
  });

  it('rejects a malformed body before opening a transaction', async () => {
    const malformed: unknown[] = [
      null,
      'text',
      [],
      { ...validBody, installmentIds: 'installment-1' },
      { ...validBody, installmentIds: [] },
      { ...validBody, installmentIds: [42] },
      { ...validBody, installmentIds: ['installment-1', 7] },
      // The amount and the corrected total are server-owned, never client input.
      { ...validBody, amount: '600000.00' },
      { ...validBody, periodAmount: '1000000.00' },
      { ...validBody, organizationId: 'org-b' },
      // Duplicates would count the same cash twice.
      {
        ...validBody,
        installmentIds: ['installment-1', 'installment-1'],
      },
      // A period is either explicit as a whole or derived as a whole.
      { ...validBody, periodStart: '2026-10-01' },
      { ...validBody, periodEnd: '2026-10-31' },
      {
        ...validBody,
        periodStart: '2026-10-31',
        periodEnd: '2026-10-01',
      },
      {
        ...validBody,
        periodStart: '2026-02-30',
        periodEnd: '2026-03-01',
      },
      { ...validBody, installmentIds: ['   '] },
    ];
    for (const body of malformed) {
      const { service, transaction } = buildService(buildTx().tx);
      await expect(
        service.create(body, organizationId, owner()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    }
  });
});

describe('PayrollReplacementPaymentService rejection paths', () => {
  it('refuses a source payment that is still pending', async () => {
    const { run, tx, obligationCreate, referenceCreateMany } = create(
      validBody,
      {
        source: sourceRow({
          status: PayrollObligationStatus.PENDING,
          periodAmount: new Prisma.Decimal('1000000.00'),
        }),
      },
    );
    await expect(run).rejects.toBeInstanceOf(ConflictException);
    await expect(run).rejects.toThrow(
      'Solo un pago completado puede reemplazarse',
    );
    expect(obligationCreate).not.toHaveBeenCalled();
    expect(referenceCreateMany).not.toHaveBeenCalled();
    expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
  });

  it('refuses an installment that does not belong to the source payment', async () => {
    const { run, tx, obligationCreate, referenceCreateMany } = create(
      { ...validBody, installmentIds: ['installment-foreign'] },
      {},
    );
    await expect(run).rejects.toBeInstanceOf(NotFoundException);
    expect(obligationCreate).not.toHaveBeenCalled();
    expect(referenceCreateMany).not.toHaveBeenCalled();
    expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
  });

  it('refuses a source installment that is already referenced', async () => {
    const {
      run,
      tx,
      obligationCreate,
      referenceCreateMany,
      referenceFindMany,
    } = create(validBody, {
      existingReferences: [{ id: 'reference-old' }],
    });
    await expect(run).rejects.toBeInstanceOf(ConflictException);
    await expect(run).rejects.toThrow('El abono ya fue referenciado');
    // The lookup is tenant-, employee- and source-scoped.
    expect(referenceFindMany).toHaveBeenCalledWith({
      where: {
        organizationId,
        employeeId,
        sourceInstallmentId: { in: ['installment-1'] },
      },
      select: { id: true },
    });
    expect(obligationCreate).not.toHaveBeenCalled();
    expect(referenceCreateMany).not.toHaveBeenCalled();
    expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
  });

  it('refuses a shared cash outflow as the source of a reference', async () => {
    const { run, tx, obligationCreate, referenceCreateMany } = create(
      validBody,
      {
        source: sourceRow({
          installments: [
            installment(
              'installment-1',
              'outflow-1',
              '400000.00',
              '2026-10-15',
              'CASH',
              2,
            ),
            installment(
              'installment-2',
              'outflow-2',
              '600000.00',
              '2026-10-31',
              'TRANSFER',
            ),
          ],
        }),
      },
    );
    await expect(run).rejects.toBeInstanceOf(ConflictException);
    await expect(run).rejects.toThrow('Movimiento compartido no referenciable');
    expect(obligationCreate).not.toHaveBeenCalled();
    expect(referenceCreateMany).not.toHaveBeenCalled();
    expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
  });

  it('refuses a selection that would leave nothing to pay', async () => {
    const { run, tx, obligationCreate, referenceCreateMany } = create({
      ...validBody,
      installmentIds: ['installment-1', 'installment-2'],
    });
    await expect(run).rejects.toBeInstanceOf(ConflictException);
    await expect(run).rejects.toThrow(
      'Los abonos referenciados cubren el pago completo',
    );
    expect(obligationCreate).not.toHaveBeenCalled();
    expect(referenceCreateMany).not.toHaveBeenCalled();
    expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
  });

  it('refuses a source whose stored cash disagrees with its own total', async () => {
    const { run, obligationCreate, referenceCreateMany } = create(validBody, {
      source: sourceRow({
        periodAmount: new Prisma.Decimal('999999.00'),
      }),
    });
    await expect(run).rejects.toBeInstanceOf(ConflictException);
    await expect(run).rejects.toThrow(
      'Historial del pago de origen inconsistente',
    );
    expect(obligationCreate).not.toHaveBeenCalled();
    expect(referenceCreateMany).not.toHaveBeenCalled();
  });

  it('fails closed when the locked cash row is not visible to this tenant', async () => {
    const { run, obligationCreate, referenceCreateMany } = create(validBody, {
      cash: [],
    });
    await expect(run).rejects.toBeInstanceOf(ConflictException);
    expect(obligationCreate).not.toHaveBeenCalled();
    expect(referenceCreateMany).not.toHaveBeenCalled();
  });

  it('refuses a missing employee or source payment before any write', async () => {
    const noEmployee = create(validBody, { employees: [] });
    await expect(noEmployee.run).rejects.toBeInstanceOf(NotFoundException);
    expect(noEmployee.obligationCreate).not.toHaveBeenCalled();

    const noSource = create(validBody, {
      sourceLocks: [],
      preLock: null,
    });
    await expect(noSource.run).rejects.toBeInstanceOf(NotFoundException);
    expect(noSource.obligationCreate).not.toHaveBeenCalled();
  });
});

describe('PayrollReplacementPaymentService replacement creation', () => {
  it('creates a pending fixed-period payment counting the referenced cash as paid', async () => {
    const {
      run,
      tx,
      obligationCreate,
      referenceCreateMany,
      queryRaw,
      obligationFindFirst,
    } = create();
    const result = await run;

    // Payroll lock order: employee, then the source obligation, then the source
    // cash rows. No other row is locked.
    expect(
      queryRaw.mock.calls.map((call) => {
        const text = call[0].join('$');
        if (text.includes('FROM "Employee"')) return 'Employee';
        if (text.includes('FROM "PayrollObligation"'))
          return 'PayrollObligation';
        if (text.includes('FROM "PayrollCashOutflow"'))
          return 'PayrollCashOutflow';
        return 'unknown';
      }),
    ).toEqual(['Employee', 'PayrollObligation', 'PayrollCashOutflow']);
    expect(obligationFindFirst).toHaveBeenCalledTimes(2);

    // The corrected total stays the source total: referenced cash plus what the
    // caller still has to pay (S4/S7).
    expect(obligationCreate).toHaveBeenCalledTimes(1);
    expect(obligationCreate).toHaveBeenCalledWith({
      data: {
        organizationId,
        employeeId,
        kind: PayrollObligationKind.FIXED_PERIOD,
        status: PayrollObligationStatus.PENDING,
        periodStart: date('2026-10-01'),
        periodEnd: date('2026-10-31'),
        periodAmount: new Prisma.Decimal('1000000.00'),
        expenseEnabled: null,
        selectedExpenseDate: null,
      },
    });

    expect(referenceCreateMany).toHaveBeenCalledTimes(1);
    expect(referenceCreateMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId,
          employeeId,
          targetObligationId,
          sourceObligationId,
          sourceInstallmentId: 'installment-1',
          amount: new Prisma.Decimal('400000.00'),
        },
      ],
    });

    // Referenced cash is already in the source outflow: no new outflow, no
    // expense, and the original payment is never updated.
    expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
    expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
    expect(tx.payrollObligation.update).not.toHaveBeenCalled();
    expect(tx.payrollInstallment.updateMany).not.toHaveBeenCalled();
    expect(tx.payrollInstallment.update).not.toHaveBeenCalled();
    expect(tx.expense.create).not.toHaveBeenCalled();
    expect(tx.expensePayment.createMany).not.toHaveBeenCalled();

    expect(result).toEqual({
      obligation: {
        id: targetObligationId,
        organizationId,
        employeeId,
        kind: PayrollObligationKind.FIXED_PERIOD,
        status: PayrollObligationStatus.PENDING,
        periodStart: date('2026-10-01'),
        periodEnd: date('2026-10-31'),
        periodAmount: new Prisma.Decimal('1000000.00'),
        expenseEnabled: null,
        selectedExpenseDate: null,
      },
      references: [
        {
          organizationId,
          employeeId,
          targetObligationId,
          sourceObligationId,
          sourceInstallmentId: 'installment-1',
          amount: new Prisma.Decimal('400000.00'),
        },
      ],
      paid: '400000.00',
      balance: '600000.00',
      status: PayrollObligationStatus.PENDING,
    });
  });

  it('locks the referenced cash rows in a deterministic order', async () => {
    const { run, queryRaw } = create(
      {
        ...validBody,
        installmentIds: ['installment-2', 'installment-1'],
      },
      {
        source: sourceRow({
          periodAmount: new Prisma.Decimal('1500000.00'),
          installments: [
            installment(
              'installment-1',
              'outflow-2',
              '400000.00',
              '2026-10-15',
              'CASH',
            ),
            installment(
              'installment-2',
              'outflow-1',
              '600000.00',
              '2026-10-31',
              'TRANSFER',
            ),
            installment(
              'installment-3',
              'outflow-3',
              '500000.00',
              '2026-11-15',
              'CASH',
            ),
          ],
        }),
        cash: ['outflow-1', 'outflow-2', 'outflow-3'],
      },
    );
    await run;
    const cashLocks = queryRaw.mock.calls
      .filter((call) => call[0].join('$').includes('FROM "PayrollCashOutflow"'))
      .map((call) => call[1]);
    // Sorted by outflow id, never by request order.
    expect(cashLocks).toEqual(['outflow-1', 'outflow-2']);
  });

  it('keeps every referenced amount exact and summed without rounding', async () => {
    const { run, referenceCreateMany } = create({
      ...validBody,
      installmentIds: ['installment-2'],
    });
    const result = await run;
    expect(referenceCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sourceInstallmentId: 'installment-2',
          amount: new Prisma.Decimal('600000.00'),
        }),
      ],
    });
    expect(result).toEqual(
      expect.objectContaining({ paid: '600000.00', balance: '400000.00' }),
    );
  });

  it('derives the period from the source period dates when omitted', async () => {
    const { run, obligationCreate } = create({
      ...validBody,
      installmentIds: ['installment-1'],
    });
    await run;
    expect(obligationCreate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        periodStart: date('2026-10-01'),
        periodEnd: date('2026-10-31'),
      }),
    );
  });

  it('derives the period from the validated shift dates of a grouped source', async () => {
    const { run, obligationCreate } = create(
      { ...validBody, installmentIds: ['installment-1'] },
      {
        preLock: sourceRow({
          installments: [{ id: 'installment-1', outflowId: 'outflow-1' }],
        }),
        source: sourceRow({
          kind: PayrollObligationKind.SHIFT_GROUP,
          periodAmount: null,
          periodStart: null,
          periodEnd: null,
          installments: [
            installment(
              'installment-1',
              'outflow-1',
              '300000.00',
              '2026-10-05',
              'CASH',
            ),
            installment(
              'installment-2',
              'outflow-2',
              '200000.00',
              '2026-10-20',
              'CASH',
            ),
          ],
          shiftMemberships: [
            {
              id: 'membership-b',
              shiftId: 'shift-b',
              releasedAt: null,
              shift: {
                id: 'shift-b',
                date: date('2026-10-20'),
                kind: 'FULL_DAY',
                amount: new Prisma.Decimal('200000.00'),
              },
            },
            {
              id: 'membership-a',
              shiftId: 'shift-a',
              releasedAt: null,
              shift: {
                id: 'shift-a',
                date: date('2026-10-05'),
                kind: 'FULL_DAY',
                amount: new Prisma.Decimal('300000.00'),
              },
            },
          ],
        }),
      },
    );
    const result = await run;
    expect(obligationCreate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        periodStart: date('2026-10-05'),
        periodEnd: date('2026-10-20'),
        periodAmount: new Prisma.Decimal('500000.00'),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ paid: '300000.00', balance: '200000.00' }),
    );
  });

  it('uses explicit dates instead of the derived ones', async () => {
    const { run, obligationCreate } = create({
      ...validBody,
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
    });
    await run;
    expect(obligationCreate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        periodStart: date('2026-11-01'),
        periodEnd: date('2026-11-30'),
      }),
    );
  });

  it('counts references a replacement source already carries', async () => {
    // The source is itself a replacement that completed: its own referenced cash
    // is part of its paid total, so the chain stays consistent.
    const { run, obligationCreate } = create(
      { ...validBody, installmentIds: ['installment-2'] },
      {
        source: sourceRow({
          periodAmount: new Prisma.Decimal('1000000.00'),
          installments: [
            installment(
              'installment-2',
              'outflow-2',
              '600000.00',
              '2026-10-31',
              'TRANSFER',
            ),
          ],
          installmentReferences: [
            {
              amount: new Prisma.Decimal('400000.00'),
              sourceInstallment: {
                outflow: {
                  id: 'outflow-1',
                  amount: new Prisma.Decimal('400000.00'),
                  date: date('2026-10-15'),
                  method: 'CASH',
                },
              },
            },
          ],
        }),
        preLock: sourceRow({
          installments: [{ id: 'installment-2', outflowId: 'outflow-2' }],
        }),
      },
    );
    const result = await run;
    expect(obligationCreate).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({ paid: '600000.00', balance: '400000.00' }),
    );
  });
});
