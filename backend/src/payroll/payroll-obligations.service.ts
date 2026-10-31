import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  EmployeeShiftKind,
  PayrollObligationKind,
  PayrollObligationStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PayrollObligationPaymentStatus = 'pending' | 'completed';

export interface PayrollObligationSummary {
  total: string;
  paid: string;
  balance: string;
  status: PayrollObligationPaymentStatus;
}

// The persisted facts the projection already returns. Amounts stay decimal
// values (never JS numbers) so no rounding can happen before the summary.
export interface PayrollObligationSummaryFacts {
  kind: PayrollObligationKind;
  status: PayrollObligationStatus;
  periodAmount: Prisma.Decimal | string | null;
  installments: readonly { outflow: { amount: Prisma.Decimal | string } }[];
  shiftMemberships: readonly { shift: { amount: Prisma.Decimal | string } }[];
}

// PostgreSQL NUMERIC input bounds (131072 integer digits) plus two decimals.
// Bounded before any string work, like the existing payroll money helpers.
const MAX_INTEGER_DIGITS = 131072;
const MAX_MONEY_LENGTH = MAX_INTEGER_DIGITS + 3;

function decimalText(value: Prisma.Decimal | string): string {
  // toFixed() without a precision keeps every stored digit and never switches
  // to exponential notation, so large values stay comparable as text.
  return typeof value === 'string' ? value : value.toFixed();
}

// Money is exact by construction: decimal strings become integer cents as
// BigInt, so no Decimal precision setting, floating point value or rounding can
// move a cent. The payroll writers reject overpayment, so a stored history that
// breaks the invariant is refused instead of being reported as a number.
function centsOf(value: Prisma.Decimal | string): bigint {
  const text = decimalText(value);
  if (text.length > MAX_MONEY_LENGTH)
    throw new Error('Monetary amount out of range');
  const parts = text.split('.');
  if (parts.length > 2) throw new Error('Invalid monetary amount');
  const integer = parts[0];
  const fraction = parts[1];
  if (!integer || !/^\d+$/.test(integer))
    throw new Error('Invalid monetary amount');
  if (integer.length > MAX_INTEGER_DIGITS)
    throw new Error('Monetary amount out of range');
  // More than two decimals is a storage inconsistency: rounding it here would
  // invent a money value the client would then display as if it were stored.
  if (fraction !== undefined && !/^\d{1,2}$/.test(fraction))
    throw new Error('Invalid monetary amount');
  const cents = BigInt(integer + (fraction ?? '').padEnd(2, '0'));
  if (cents <= 0n) throw new Error('Monetary amount out of range');
  return cents;
}

function moneyText(cents: bigint): string {
  if (cents < 0n) throw new Error('Invalid monetary amount');
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/**
 * Server-side paid total, balance and completion indicator of one obligation.
 *
 * The exported payroll-allocation helpers do not fit this read: they plan a new
 * installment (`allocatePeriodInstallment`, `allocateShiftInstallment`), require
 * the obligation to be pending and reject a completed or zero-paid history, and
 * the group summary they build is not exported. So the arithmetic here reuses
 * the exact-cents convention already established for payroll money in
 * `payroll-obligation-completion.ts` instead of Decimal summation.
 *
 * Inputs are persisted facts only: the obligation total (its stored period
 * amount, or the stored amounts of the shifts the group owns) and the real cash
 * outflows of its installments. Nothing is recomputed from catalog or shift
 * defaults, and nothing is written.
 */
export function summarizePayrollObligation(
  facts: PayrollObligationSummaryFacts,
): PayrollObligationSummary {
  let totalCents: bigint;
  if (facts.kind === PayrollObligationKind.FIXED_PERIOD) {
    if (facts.periodAmount === null || facts.periodAmount === undefined)
      throw new Error('Missing obligation total');
    totalCents = centsOf(facts.periodAmount);
  } else if (facts.kind === PayrollObligationKind.SHIFT_GROUP) {
    // A group stores no amount of its own; its total is the stored value of the
    // shifts it owns. Shift amounts are immutable once created, so this total is
    // a fact and not a recomputation of editable data.
    if (!facts.shiftMemberships.length) throw new Error('Group has no shifts');
    totalCents = 0n;
    for (const { shift } of facts.shiftMemberships)
      totalCents += centsOf(shift.amount);
  } else throw new Error('Invalid obligation kind');

  // One installment row per outflow and per obligation is a database invariant,
  // and a correction updates the outflow in place, so summing the current
  // outflow amounts counts every real cash movement exactly once.
  let paidCents = 0n;
  for (const { outflow } of facts.installments)
    paidCents += centsOf(outflow.amount);
  if (paidCents > totalCents)
    throw new Error('Paid amount exceeds obligation total');

  const completed = paidCents === totalCents;
  // The persisted status is a stored fact too; if it disagrees with the cash the
  // row is inconsistent and no balance may be invented for it.
  if (completed !== (facts.status === PayrollObligationStatus.COMPLETED))
    throw new Error('Obligation status inconsistent');

  return {
    total: moneyText(totalCents),
    paid: moneyText(paidCents),
    balance: moneyText(totalCents - paidCents),
    status: completed ? 'completed' : 'pending',
  };
}

// The projection the obligations route already returned. It is repeated here,
// unchanged, so existing response fields keep their exact shape and only the
// derived `summary` is added on top.
const payrollObligationSelect = {
  id: true,
  employeeId: true,
  kind: true,
  status: true,
  version: true,
  periodStart: true,
  periodEnd: true,
  periodAmount: true,
  // The stored per-payment expense decision, so a UI can show it.
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
      // A returned installment is shown as returned; the UI must not offer a
      // second return for the same real cash.
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
} satisfies Prisma.PayrollObligationSelect;

// Written out instead of inferred from the select: Prisma widens the `true`
// literals of a `satisfies` object, so an inferred payload would silently claim
// fields the query does not return.
type PayrollObligationProjection = {
  id: string;
  employeeId: string;
  kind: PayrollObligationKind;
  status: PayrollObligationStatus;
  version: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  periodAmount: Prisma.Decimal | null;
  expenseEnabled: boolean | null;
  selectedExpenseDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  installments: {
    id: string;
    outflowId: string;
    createdAt: Date;
    outflow: {
      id: string;
      amount: Prisma.Decimal;
      date: Date;
      method: PaymentMethod;
      createdAt: Date;
    };
    cashReturn: {
      id: string;
      amount: Prisma.Decimal;
      returnDate: Date;
      returnMethod: PaymentMethod;
    } | null;
  }[];
  shiftMemberships: {
    id: string;
    shiftId: string;
    releasedAt: Date | null;
    shift: {
      id: string;
      date: Date;
      kind: EmployeeShiftKind;
      amount: Prisma.Decimal;
    };
  }[];
};

/**
 * Read-only payroll read service.
 *
 * There is no writer here: no transaction, no lock beyond the ordinary SELECT,
 * no schema or expense change. The tenant is never taken from the request body
 * or query; the caller passes the authenticated organization only.
 */
@Injectable()
export class PayrollObligationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    organizationId: string | undefined,
    employeeId?: string,
  ): Promise<
    (PayrollObligationProjection & { summary: PayrollObligationSummary })[]
  > {
    if (!organizationId || !organizationId.trim())
      throw new ForbiddenException('No tiene permiso para gestionar nómina');
    const obligations = await this.prisma.payrollObligation.findMany({
      where: {
        organizationId,
        ...(employeeId ? { employeeId } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: payrollObligationSelect,
    });
    return obligations.map((obligation) => ({
      ...obligation,
      summary: this.summarize(obligation),
    }));
  }

  // Stored payroll history is expected to be consistent because every writer
  // rejects overpayment and only completes an exactly paid obligation. A row
  // that breaks that invariant fails closed as a conflict instead of returning
  // a made-up balance.
  private summarize(
    obligation: PayrollObligationProjection,
  ): PayrollObligationSummary {
    try {
      return summarizePayrollObligation(obligation);
    } catch {
      throw new ConflictException('Saldo de pago inconsistente');
    }
  }
}
