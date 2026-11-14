import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  PayrollObligationKind,
  PayrollObligationStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  PayrollObligationsService,
  payrollObligationCashOutflowFacts,
  summarizePayrollObligation,
} from './payroll-obligations.service';

// These are mocked facts, not database rows: every amount is a decimal value as
// the projection returns it, so the arithmetic contract is what gets exercised.
let cashSequence = 0;
function cash(amount: string, day = '2026-01-15') {
  cashSequence += 1;
  return {
    outflow: {
      id: `outflow-${cashSequence}`,
      amount: new Prisma.Decimal(amount),
      date: new Date(`${day}T00:00:00.000Z`),
      method: PaymentMethod.CASH,
    },
  };
}

// One reference row of a replacement payment: the snapshot it stores plus the
// live facts of the source installment it points at.
let referenceSequence = 0;
function reference(amount: string, sourceAmount = amount, day = '2026-10-15') {
  referenceSequence += 1;
  return {
    amount: new Prisma.Decimal(amount),
    sourceInstallment: {
      outflow: {
        id: `source-outflow-${referenceSequence}`,
        amount: new Prisma.Decimal(sourceAmount),
        date: new Date(`${day}T00:00:00.000Z`),
        method: PaymentMethod.CASH,
      },
    },
  };
}

function shift(amount: string) {
  return { shift: { amount: new Prisma.Decimal(amount) } };
}

function periodFacts(
  overrides: Partial<Parameters<typeof summarizePayrollObligation>[0]> = {},
): Parameters<typeof summarizePayrollObligation>[0] {
  return {
    kind: PayrollObligationKind.FIXED_PERIOD,
    status: PayrollObligationStatus.PENDING,
    periodAmount: new Prisma.Decimal('1500000.00'),
    installments: [],
    shiftMemberships: [],
    references: [],
    ...overrides,
  };
}

const select = {
  id: true,
  employeeId: true,
  kind: true,
  status: true,
  version: true,
  periodStart: true,
  periodEnd: true,
  periodAmount: true,
  expenseEnabled: true,
  selectedExpenseDate: true,
  createdAt: true,
  updatedAt: true,
  installments: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      outflowId: true,
      createdAt: true,
      outflow: {
        select: {
          id: true,
          amount: true,
          date: true,
          method: true,
          createdAt: true,
        },
      },
      cashReturn: {
        select: {
          id: true,
          amount: true,
          returnDate: true,
          returnMethod: true,
        },
      },
    },
  },
  shiftMemberships: {
    orderBy: [{ shiftId: 'asc' }],
    select: {
      id: true,
      shiftId: true,
      releasedAt: true,
      shift: {
        select: { id: true, date: true, kind: true, amount: true },
      },
    },
  },
  installmentReferences: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      sourceInstallmentId: true,
      amount: true,
      createdAt: true,
      sourceInstallment: {
        select: {
          id: true,
          obligationId: true,
          outflow: {
            select: { id: true, amount: true, date: true, method: true },
          },
        },
      },
    },
  },
} as const;

function projectedRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'obligation-a',
    employeeId: 'emp-a',
    kind: PayrollObligationKind.FIXED_PERIOD,
    status: PayrollObligationStatus.PENDING,
    version: 1,
    periodStart: new Date('2026-01-01T00:00:00.000Z'),
    periodEnd: new Date('2026-01-31T00:00:00.000Z'),
    periodAmount: new Prisma.Decimal('1500000.00'),
    expenseEnabled: null,
    selectedExpenseDate: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    installments: [],
    shiftMemberships: [],
    installmentReferences: [],
    ...overrides,
  };
}

describe('payroll obligation summary', () => {
  it('reports the whole total as balance when nothing has been paid', () => {
    expect(summarizePayrollObligation(periodFacts())).toEqual({
      total: '1500000.00',
      paid: '0.00',
      balance: '1500000.00',
      status: 'pending',
    });
  });

  it('sums multiple installments into paid and reduces the balance', () => {
    expect(
      summarizePayrollObligation(
        periodFacts({
          installments: [cash('400000.00'), cash('300000.50')],
        }),
      ),
    ).toEqual({
      total: '1500000.00',
      paid: '700000.50',
      balance: '799999.50',
      status: 'pending',
    });
  });

  it('reports zero balance for a completed obligation', () => {
    expect(
      summarizePayrollObligation(
        periodFacts({
          status: PayrollObligationStatus.COMPLETED,
          periodAmount: new Prisma.Decimal('1000.00'),
          installments: [cash('600.00'), cash('400.00')],
        }),
      ),
    ).toEqual({
      total: '1000.00',
      paid: '1000.00',
      balance: '0.00',
      status: 'completed',
    });
  });

  it('keeps large amounts exact instead of using floating point', () => {
    // 90071992547409.99 is 9007199254740999 cents, past Number.MAX_SAFE_INTEGER.
    expect(
      summarizePayrollObligation(
        periodFacts({
          status: PayrollObligationStatus.COMPLETED,
          periodAmount: new Prisma.Decimal('90071992547409.99'),
          installments: [cash('45035996273704.99'), cash('45035996273705.00')],
        }),
      ),
    ).toEqual({
      total: '90071992547409.99',
      paid: '90071992547409.99',
      balance: '0.00',
      status: 'completed',
    });
    expect(
      summarizePayrollObligation(
        periodFacts({
          periodAmount: new Prisma.Decimal('90071992547409.99'),
          installments: [cash('0.01')],
        }),
      ),
    ).toEqual({
      total: '90071992547409.99',
      paid: '0.01',
      balance: '90071992547409.98',
      status: 'pending',
    });
  });

  it('sums the stored shift amounts of a shift-group obligation', () => {
    expect(
      summarizePayrollObligation(
        periodFacts({
          kind: PayrollObligationKind.SHIFT_GROUP,
          periodAmount: null,
          shiftMemberships: [shift('92045.00'), shift('100000.00')],
          installments: [cash('50000.00')],
        }),
      ),
    ).toEqual({
      total: '192045.00',
      paid: '50000.00',
      balance: '142045.00',
      status: 'pending',
    });
  });

  it('reports zero balance for a completed shift-group obligation', () => {
    expect(
      summarizePayrollObligation(
        periodFacts({
          kind: PayrollObligationKind.SHIFT_GROUP,
          status: PayrollObligationStatus.COMPLETED,
          periodAmount: null,
          shiftMemberships: [shift('92045.00'), shift('100000.00')],
          installments: [cash('150000.00'), cash('42045.00')],
        }),
      ),
    ).toEqual({
      total: '192045.00',
      paid: '192045.00',
      balance: '0.00',
      status: 'completed',
    });
  });

  it('fails closed when the stored status disagrees with the paid cash', () => {
    expect(() =>
      summarizePayrollObligation(
        periodFacts({ status: PayrollObligationStatus.COMPLETED }),
      ),
    ).toThrow('Obligation status inconsistent');
    expect(() =>
      summarizePayrollObligation(
        periodFacts({
          periodAmount: new Prisma.Decimal('1000.00'),
          installments: [cash('1000.00')],
        }),
      ),
    ).toThrow('Obligation status inconsistent');
  });

  it('fails closed on an overpaid obligation instead of reporting a negative balance', () => {
    expect(() =>
      summarizePayrollObligation(
        periodFacts({
          periodAmount: new Prisma.Decimal('100.00'),
          installments: [cash('100.01')],
        }),
      ),
    ).toThrow('Paid amount exceeds obligation total');
  });

  it('fails closed when a fixed period has no stored amount', () => {
    expect(() =>
      summarizePayrollObligation(periodFacts({ periodAmount: null })),
    ).toThrow('Missing obligation total');
  });

  it('fails closed on a shift group without shifts', () => {
    expect(() =>
      summarizePayrollObligation(
        periodFacts({
          kind: PayrollObligationKind.SHIFT_GROUP,
          periodAmount: null,
          shiftMemberships: [],
        }),
      ),
    ).toThrow('Group has no shifts');
  });

  it('never rounds a stored amount that has more than two decimals', () => {
    expect(() =>
      summarizePayrollObligation(
        periodFacts({ installments: [cash('100.005')] }),
      ),
    ).toThrow('Invalid monetary amount');
    expect(() =>
      summarizePayrollObligation(
        periodFacts({ periodAmount: new Prisma.Decimal('100.005') }),
      ),
    ).toThrow('Invalid monetary amount');
    expect(() =>
      summarizePayrollObligation(
        periodFacts({
          kind: PayrollObligationKind.SHIFT_GROUP,
          periodAmount: null,
          shiftMemberships: [shift('92045.001')],
        }),
      ),
    ).toThrow('Invalid monetary amount');
  });

  it('rejects an unknown obligation kind', () => {
    expect(() =>
      summarizePayrollObligation(
        periodFacts({
          kind: 'BONUS' as PayrollObligationKind,
        }),
      ),
    ).toThrow('Invalid obligation kind');
  });

  it('rejects an out-of-range stored amount without building a decimal', () => {
    expect(() =>
      summarizePayrollObligation(
        periodFacts({ periodAmount: '1'.repeat(131073) }),
      ),
    ).toThrow('Monetary amount out of range');
  });
});

// A reference-based replacement counts the valid installments of the completed
// source payment as its own paid cash without creating a new outflow (L327,
// L338). The total stays the corrected total, so referenced cash plus the amount
// still to pay always add up to it.
describe('payroll replacement references in the money summary', () => {
  it('counts referenced installments as paid cash and keeps the balance payable', () => {
    expect(
      summarizePayrollObligation(
        periodFacts({
          periodAmount: new Prisma.Decimal('1000000.00'),
          references: [reference('400000.00')],
        }),
      ),
    ).toEqual({
      total: '1000000.00',
      paid: '400000.00',
      balance: '600000.00',
      status: 'pending',
    });
  });

  it('sums referenced cash together with the replacement own installments', () => {
    expect(
      summarizePayrollObligation(
        periodFacts({
          periodAmount: new Prisma.Decimal('1000000.00'),
          references: [reference('400000.00')],
          installments: [cash('250000.50')],
        }),
      ),
    ).toEqual({
      total: '1000000.00',
      paid: '650000.50',
      balance: '349999.50',
      status: 'pending',
    });
  });

  it('completes when referenced cash plus own cash reaches the total', () => {
    expect(
      summarizePayrollObligation(
        periodFacts({
          status: PayrollObligationStatus.COMPLETED,
          periodAmount: new Prisma.Decimal('1000000.00'),
          references: [reference('400000.00')],
          installments: [cash('600000.00')],
        }),
      ),
    ).toEqual({
      total: '1000000.00',
      paid: '1000000.00',
      balance: '0.00',
      status: 'completed',
    });
  });

  it('fails closed when a reference snapshot disagrees with the live source cash', () => {
    expect(() =>
      summarizePayrollObligation(
        periodFacts({ references: [reference('400000.00', '300000.00')] }),
      ),
    ).toThrow('Referencia de abono inconsistente');
  });

  it('fails closed when the same real cash is counted twice', () => {
    const counted = cash('250000.00');
    expect(() =>
      summarizePayrollObligation(
        periodFacts({
          installments: [counted],
          references: [
            {
              amount: counted.outflow.amount,
              sourceInstallment: { outflow: counted.outflow },
            },
          ],
        }),
      ),
    ).toThrow('Abono contado dos veces');
  });

  it('fails closed when referenced cash overpays the replacement', () => {
    expect(() =>
      summarizePayrollObligation(
        periodFacts({
          periodAmount: new Prisma.Decimal('1000000.00'),
          references: [reference('400000.00')],
          installments: [cash('600000.01')],
        }),
      ),
    ).toThrow('Paid amount exceeds obligation total');
  });
});

// The completion expense mirrors real cash dates and methods. Referenced cash is
// real cash of the source payment, so it is listed with its own identity and
// date; nothing here invents an outflow for it.
describe('payroll completion cash facts with references', () => {
  it('lists the real cash identities of own and referenced installments', () => {
    const own = cash('600000.00', '2026-10-31');
    const referenced = reference('400000.00', '400000.00', '2026-10-15');
    const facts = periodFacts({
      periodAmount: new Prisma.Decimal('1000000.00'),
      installments: [own],
      references: [referenced],
    });
    expect(payrollObligationCashOutflowFacts(facts)).toEqual([
      {
        id: own.outflow.id,
        amount: '600000.00',
        date: '2026-10-31',
        method: PaymentMethod.CASH,
      },
      {
        id: referenced.sourceInstallment.outflow.id,
        amount: '400000.00',
        date: '2026-10-15',
        method: PaymentMethod.CASH,
      },
    ]);
  });

  it('invents no outflow: the facts sum to the paid cash of the summary', () => {
    const facts = periodFacts({
      periodAmount: new Prisma.Decimal('2000000.00'),
      installments: [cash('600000.00')],
      references: [reference('400000.00')],
    });
    const paid = payrollObligationCashOutflowFacts(facts).reduce(
      (sum, fact) => sum.plus(new Prisma.Decimal(fact.amount)),
      new Prisma.Decimal(0),
    );
    expect(paid.toFixed(2)).toBe(
      summarizePayrollObligation(facts).paid.toString(),
    );
    // No fact exists for the reference itself: each fact is a stored outflow.
    expect(payrollObligationCashOutflowFacts(facts)).toHaveLength(2);
  });

  it('fails closed on a reference that disagrees with the live source cash', () => {
    expect(() =>
      payrollObligationCashOutflowFacts(
        periodFacts({ references: [reference('400000.00', '300000.00')] }),
      ),
    ).toThrow('Referencia de abono inconsistente');
  });
});

describe('PayrollObligationsService', () => {
  const prisma = {
    payrollObligation: { findMany: jest.fn() },
  };
  const service = new PayrollObligationsService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('lists the authenticated tenant obligations only', async () => {
    prisma.payrollObligation.findMany.mockResolvedValue([projectedRow()]);
    const result = await service.findAll('org-a');
    expect(prisma.payrollObligation.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select,
    });
    expect(prisma.payrollObligation.findMany).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

  it('narrows to one employee inside the authenticated tenant', async () => {
    prisma.payrollObligation.findMany.mockResolvedValue([]);
    await service.findAll('org-a', 'emp-a');
    expect(prisma.payrollObligation.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a', employeeId: 'emp-a' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select,
    });
  });

  it('rejects a request without a tenant before reading any payroll row', async () => {
    await expect(service.findAll(undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.findAll('')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.payrollObligation.findMany).not.toHaveBeenCalled();
  });

  it('keeps every projected field and appends the server-side summary', async () => {
    const row = projectedRow({
      installments: [
        {
          id: 'installment-a',
          outflowId: 'outflow-a',
          createdAt: new Date('2026-01-15T00:00:00.000Z'),
          outflow: {
            id: 'outflow-a',
            amount: new Prisma.Decimal('500000.00'),
            date: new Date('2026-01-15T00:00:00.000Z'),
            method: 'CASH',
            createdAt: new Date('2026-01-15T00:00:00.000Z'),
          },
        },
      ],
    });
    prisma.payrollObligation.findMany.mockResolvedValue([row]);
    const [result] = await service.findAll('org-a');
    expect(result).toEqual({
      ...row,
      summary: {
        total: '1500000.00',
        paid: '500000.00',
        balance: '1000000.00',
        status: 'pending',
      },
    });
  });

  it('projects referenced installments and counts their cash in the summary', async () => {
    const row = projectedRow({
      periodAmount: new Prisma.Decimal('1000000.00'),
      installmentReferences: [
        {
          id: 'reference-a',
          sourceInstallmentId: 'installment-source',
          amount: new Prisma.Decimal('400000.00'),
          createdAt: new Date('2026-11-02T00:00:00.000Z'),
          sourceInstallment: {
            id: 'installment-source',
            obligationId: 'obligation-source',
            outflow: {
              id: 'outflow-source',
              amount: new Prisma.Decimal('400000.00'),
              date: new Date('2026-10-15T00:00:00.000Z'),
              method: PaymentMethod.CASH,
            },
          },
        },
      ],
    });
    prisma.payrollObligation.findMany.mockResolvedValue([row]);
    const [result] = await service.findAll('org-a');
    // The reference is projected as stored evidence, and its cash is paid.
    expect(result.installmentReferences).toEqual(row.installmentReferences);
    expect(result.summary).toEqual({
      total: '1000000.00',
      paid: '400000.00',
      balance: '600000.00',
      status: 'pending',
    });
  });

  it('maps inconsistent stored facts to a conflict instead of a money value', async () => {
    prisma.payrollObligation.findMany.mockResolvedValue([
      projectedRow({
        periodAmount: new Prisma.Decimal('100.00'),
        installments: [cash('200.00')],
      }),
    ]);
    await expect(service.findAll('org-a')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
