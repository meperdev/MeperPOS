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
import type { PayrollOutflowFact } from './payroll-obligation-completion';

export type PayrollObligationPaymentStatus = 'pending' | 'completed';

export interface PayrollObligationSummary {
  total: string;
  paid: string;
  balance: string;
  status: PayrollObligationPaymentStatus;
}

// One stored cash outflow as the projection returns it. The same shape carries an
// own installment outflow and a referenced source outflow, because referenced
// cash is real cash of another payment, not a new movement.
export interface PayrollCashOutflowFacts {
  id: string;
  amount: Prisma.Decimal | string;
  date: Date | string;
  method: PaymentMethod;
}

// One reference row of a replacement payment: the amount snapshot it stores and
// the live source installment it points at (L327, L338).
export interface PayrollInstallmentReferenceFacts {
  amount: Prisma.Decimal | string;
  sourceInstallment: { outflow: PayrollCashOutflowFacts };
}

// The persisted facts the projection already returns. Amounts stay decimal
// values (never JS numbers) so no rounding can happen before the summary.
export interface PayrollObligationSummaryFacts {
  kind: PayrollObligationKind;
  status: PayrollObligationStatus;
  periodAmount: Prisma.Decimal | string | null;
  installments: readonly { outflow: PayrollCashOutflowFacts }[];
  shiftMemberships: readonly { shift: { amount: Prisma.Decimal | string } }[];
  // Installments of a completed payment this one counts as already paid.
  references?: readonly PayrollInstallmentReferenceFacts[];
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
export function payrollMoneyCents(value: Prisma.Decimal | string): bigint {
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

export function payrollMoneyText(cents: bigint): string {
  if (cents < 0n) throw new Error('Invalid monetary amount');
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

const METHOD_NAMES: ReadonlySet<string> = new Set(Object.values(PaymentMethod));

// These facts carry stored `@db.Date` values, so only the stored day is used. A
// full timestamp - as JSON fixtures and mocks produce - is reduced to its UTC
// date part instead of shifting the day by a local offset.
function dateText(value: Date | string): string {
  const day = (
    value instanceof Date ? value.toISOString() : String(value)
  ).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid outflow date');
  return day;
}

function isMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && METHOD_NAMES.has(value);
}

/**
 * The real cash facts a payment's completion accounts for, in one place.
 *
 * Own installments contribute the outflow they store. A reference-based
 * replacement contributes the referenced source installment's own outflow, which
 * already exists as that payment's cash: nothing here creates, copies or invents
 * an outflow. The stored snapshot must equal the live source amount, because the
 * reference is only defensible as evidence of exactly that cash, and the same
 * outflow may never be counted twice - not as an own installment plus a
 * reference, and not through two references.
 *
 * Callers use this for the completion-expense facts, so an expense that mirrors
 * payroll cash keeps the original dates, methods and identities of referenced
 * installments instead of the day the replacement was registered.
 */
export function payrollObligationCashOutflowFacts(facts: {
  installments: PayrollObligationSummaryFacts['installments'];
  references?: PayrollObligationSummaryFacts['references'];
}): PayrollOutflowFact[] {
  const counted = new Set<string>();
  const result: PayrollOutflowFact[] = [];
  const count = (outflow: PayrollCashOutflowFacts): void => {
    if (typeof outflow?.id !== 'string' || !outflow.id.trim())
      throw new Error('Invalid outflow identity');
    if (!isMethod(outflow.method)) throw new Error('Invalid outflow method');
    if (counted.has(outflow.id)) throw new Error('Abono contado dos veces');
    counted.add(outflow.id);
    result.push({
      id: outflow.id,
      amount: payrollMoneyText(payrollMoneyCents(outflow.amount)),
      date: dateText(outflow.date),
      method: outflow.method,
    });
  };
  for (const { outflow } of facts.installments) count(outflow);
  for (const reference of facts.references ?? [])
    count(referencedOutflow(reference));
  return result;
}

// A reference is only defensible as evidence of exactly the cash it snapshotted:
// the stored amount must still equal the live source outflow amount.
function referencedOutflow(
  reference: PayrollInstallmentReferenceFacts,
): PayrollCashOutflowFacts {
  const outflow = reference?.sourceInstallment?.outflow;
  if (!outflow) throw new Error('Referencia de abono inconsistente');
  if (payrollMoneyCents(reference.amount) !== payrollMoneyCents(outflow.amount))
    throw new Error('Referencia de abono inconsistente');
  return outflow;
}

/**
 * Cash a replacement payment already counts as paid through referenced
 * installments (L327, L338), in exact cents.
 *
 * The writers that receive the remaining balance of a replacement need this
 * figure to know how much is still payable, so a payment can reach its corrected
 * total without a second outflow existing for the referenced cash. It applies the
 * same fail-closed rules as `payrollObligationCashOutflowFacts`: a snapshot that
 * disagrees with the live source amount, or the same real outflow counted twice,
 * is refused instead of being summed.
 */
export function payrollObligationReferencedCashCents(facts: {
  references?: PayrollObligationSummaryFacts['references'];
}): bigint {
  const counted = new Set<string>();
  let cents = 0n;
  for (const reference of facts.references ?? []) {
    const outflow = referencedOutflow(reference);
    if (typeof outflow.id !== 'string' || !outflow.id.trim())
      throw new Error('Invalid outflow identity');
    if (counted.has(outflow.id)) throw new Error('Abono contado dos veces');
    counted.add(outflow.id);
    cents += payrollMoneyCents(reference.amount);
  }
  return cents;
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
 * amount, or the stored amounts of the shifts the group owns), the real cash
 * outflows of its installments and the source installments a reference-based
 * replacement counts as already paid. Referenced cash is real cash of the
 * completed payment, so it is paid without any new outflow existing here.
 * Nothing is recomputed from catalog or shift defaults, and nothing is written.
 */
export function summarizePayrollObligation(
  facts: PayrollObligationSummaryFacts,
): PayrollObligationSummary {
  let totalCents: bigint;
  if (facts.kind === PayrollObligationKind.FIXED_PERIOD) {
    if (facts.periodAmount === null || facts.periodAmount === undefined)
      throw new Error('Missing obligation total');
    totalCents = payrollMoneyCents(facts.periodAmount);
  } else if (facts.kind === PayrollObligationKind.SHIFT_GROUP) {
    // A group stores no amount of its own; its total is the stored value of the
    // shifts it owns. Shift amounts are immutable once created, so this total is
    // a fact and not a recomputation of editable data.
    if (!facts.shiftMemberships.length) throw new Error('Group has no shifts');
    totalCents = 0n;
    for (const { shift } of facts.shiftMemberships)
      totalCents += payrollMoneyCents(shift.amount);
  } else throw new Error('Invalid obligation kind');

  // One installment row per outflow and per obligation is a database invariant,
  // and a correction updates the outflow in place, so summing the current
  // outflow amounts counts every real cash movement exactly once. Referenced
  // cash is counted once too, through the outflow it already belongs to.
  let paidCents = 0n;
  for (const outflow of payrollObligationCashOutflowFacts(facts))
    paidCents += payrollMoneyCents(outflow.amount);
  if (paidCents > totalCents)
    throw new Error('Paid amount exceeds obligation total');

  const completed = paidCents === totalCents;
  // The persisted status is a stored fact too; if it disagrees with the cash the
  // row is inconsistent and no balance may be invented for it.
  if (completed !== (facts.status === PayrollObligationStatus.COMPLETED))
    throw new Error('Obligation status inconsistent');

  return {
    total: payrollMoneyText(totalCents),
    paid: payrollMoneyText(paidCents),
    balance: payrollMoneyText(totalCents - paidCents),
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
  // Installments of a completed payment this one counts as already paid, with
  // the real source cash they belong to. Nothing here creates a new outflow.
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
  installmentReferences: {
    id: string;
    sourceInstallmentId: string;
    amount: Prisma.Decimal;
    createdAt: Date;
    sourceInstallment: {
      id: string;
      obligationId: string;
      outflow: {
        id: string;
        amount: Prisma.Decimal;
        date: Date;
        method: PaymentMethod;
      };
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
      return summarizePayrollObligation({
        ...obligation,
        // The projection names the relation; the facts name what it means: the
        // payments this one counts as already paid.
        references: obligation.installmentReferences,
      });
    } catch {
      throw new ConflictException('Saldo de pago inconsistente');
    }
  }
}
