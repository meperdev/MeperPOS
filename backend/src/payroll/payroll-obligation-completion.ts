import { PaymentMethod } from '@prisma/client';
import { payrollExpenseIntent } from './payroll-expense-intent';

// Pure, unwired completion planner. It classifies already-established payroll
// facts (obligation total, real cash outflows, optional corrections and the
// stored per-payment expense choice) and proposes the expense facts a caller
// could persist later. It never writes, never resolves an unknown expense
// choice as "no expense", never rounds, and never decides a product policy:
// capping payroll, splitting an expense or completing without one stay caller
// decisions. Expense payments are candidates only; avoiding double cash
// counting against existing cash-flow reports remains a caller precondition.
export type PayrollCompletionMethod = PaymentMethod;

export interface PayrollOutflowFact {
  id: string;
  amount: string;
  date: string;
  method: PayrollCompletionMethod;
}

export interface PayrollCashCorrection {
  outflowId: string;
  amount: string;
}

export interface PayrollObligationCompletionFacts {
  total: string;
  outflows: PayrollOutflowFact[];
  corrections?: PayrollCashCorrection[];
  // null means the stored choice is not established; it is never read as false.
  expenseChoice: boolean | null;
  completionDate: string;
  selectedExpenseDate?: string | null;
}

export interface PayrollExpensePayment {
  outflowId: string;
  amount: string;
  date: string;
  method: PayrollCompletionMethod;
}

export type PayrollExpenseDecision =
  | { kind: 'disabled' }
  | { kind: 'unknown_choice' }
  | { kind: 'awaiting_completion' }
  | {
      kind: 'create';
      date: string;
      total: string;
      payments: PayrollExpensePayment[];
    }
  | {
      // Existing Expense.total and ExpensePayment.amount are Decimal(12,2);
      // this decision reports that boundary and leaves remediation to the caller.
      kind: 'unrepresentable';
      date: string;
      total: string;
      payments: PayrollExpensePayment[];
    };

export interface PayrollCompletionOutflow {
  id: string;
  amount: string;
  date: string;
  method: PayrollCompletionMethod;
  corrected: boolean;
}

export interface PayrollObligationCompletionPlan {
  status: 'pending' | 'completed';
  total: string;
  paid: string;
  balance: string;
  outflows: PayrollCompletionOutflow[];
  expense: PayrollExpenseDecision;
}

// PostgreSQL NUMERIC input bounds (131072 integer digits) plus two fractional
// digits. Payroll cash amounts use unconstrained NUMERIC, not Decimal(12,2).
const MAX_INTEGER_DIGITS = 131072;
const MAX_MONEY_LENGTH = MAX_INTEGER_DIGITS + 3;
// Existing Expense.total and ExpensePayment.amount storage boundary.
const EXPENSE_MAX_CENTS = 999999999999n;

const METHOD_NAMES: ReadonlySet<string> = new Set(Object.values(PaymentMethod));

// Money is exact by construction: decimal strings become integer cents as
// BigInt, so no Decimal precision setting or rounding can affect a total.
function centsOf(value: string): bigint {
  if (typeof value !== 'string') throw new Error('Invalid monetary amount');
  // Bound the input before splitting or matching it: no work on oversized input.
  if (value.length > MAX_MONEY_LENGTH)
    throw new Error('Monetary amount out of range');
  const parts = value.split('.');
  if (parts.length > 2) throw new Error('Invalid monetary amount');
  const integer = parts[0];
  const fraction = parts[1];
  if (!integer || !/^\d+$/.test(integer))
    throw new Error('Invalid monetary amount');
  if (integer.length > MAX_INTEGER_DIGITS)
    throw new Error('Monetary amount out of range');
  if (fraction !== undefined && !/^\d{1,2}$/.test(fraction))
    throw new Error('Invalid monetary amount');
  const cents = BigInt(integer + (fraction ?? '').padEnd(2, '0'));
  if (cents <= 0n) throw new Error('Monetary amount out of range');
  return cents;
}

function moneyText(cents: bigint): string {
  // Unreachable through the public contract today: total and paid are positive
  // and an overpayment is rejected before formatting, so every rendered value is
  // non-negative. Guard anyway, so a future reordering cannot emit "-12.34" as
  // if it were a payable amount.
  if (cents < 0n) throw new Error('Invalid monetary amount');
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `${cents / 100n}.${fraction}`;
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
  );
}

type VerifiedOutflow = {
  id: string;
  cents: bigint;
  date: string;
  method: PayrollCompletionMethod;
};

function verifyOutflows(value: unknown): VerifiedOutflow[] {
  if (!Array.isArray(value)) throw new Error('Invalid completion facts');
  const ids = new Set<string>();
  const verified: VerifiedOutflow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid outflow');
    const fact = raw as Partial<PayrollOutflowFact>;
    if (typeof fact.id !== 'string' || !fact.id.trim() || ids.has(fact.id))
      throw new Error('Invalid outflow');
    if (!isDateOnly(fact.date)) throw new Error('Invalid outflow');
    if (typeof fact.method !== 'string' || !METHOD_NAMES.has(fact.method))
      throw new Error('Invalid outflow');
    // Outflow amounts are facts, not candidates for a payroll cap.
    const cents = centsOf(fact.amount as string);
    ids.add(fact.id);
    verified.push({
      id: fact.id,
      cents,
      date: fact.date,
      method: fact.method,
    });
  }
  return verified;
}

function applyCorrections(
  outflows: VerifiedOutflow[],
  value: unknown,
): { effective: VerifiedOutflow[]; correctedIds: Set<string> } {
  if (value === undefined)
    return { effective: outflows, correctedIds: new Set() };
  if (!Array.isArray(value)) throw new Error('Invalid correction');
  const byId = new Map(outflows.map((outflow) => [outflow.id, outflow]));
  const correctedIds = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid correction');
    const correction = raw as Partial<PayrollCashCorrection>;
    const target =
      typeof correction.outflowId === 'string'
        ? byId.get(correction.outflowId)
        : undefined;
    // A correction is keyed by the stable outflow identity, never by date,
    // amount or position; ambiguous or foreign keys fail closed.
    if (!target || correctedIds.has(target.id))
      throw new Error('Invalid correction');
    const cents = centsOf(correction.amount as string);
    correctedIds.add(target.id);
    byId.set(target.id, { ...target, cents });
  }
  return {
    effective: outflows.map((outflow) => byId.get(outflow.id)!),
    correctedIds,
  };
}

function expenseDecision(
  choice: boolean | null,
  completed: boolean,
  facts: PayrollObligationCompletionFacts,
  effective: VerifiedOutflow[],
  paidCents: bigint,
): PayrollExpenseDecision {
  // Unknown is reported as unknown; it is never inferred to be false.
  if (choice === null) return { kind: 'unknown_choice' };
  if (choice === false) return { kind: 'disabled' };
  if (!completed) return { kind: 'awaiting_completion' };

  // The established intent decision owns the expense-date default and its
  // validation; only the represented amount is new here.
  const intent = payrollExpenseIntent({
    paymentComplete: true,
    expenseEnabled: true,
    completionDate: facts.completionDate,
    selectedExpenseDate: facts.selectedExpenseDate ?? undefined,
  });
  if (!intent) throw new Error('Invalid expense intent');
  const total = moneyText(paidCents);
  const payments: PayrollExpensePayment[] = effective.map((outflow) => ({
    outflowId: outflow.id,
    amount: moneyText(outflow.cents),
    date: outflow.date,
    method: outflow.method,
  }));
  // Payments are positive and sum to the total, so the aggregate boundary
  // alone decides whether both the expense and its payments fit Decimal(12,2).
  return paidCents <= EXPENSE_MAX_CENTS
    ? { kind: 'create', date: intent.expenseDate, total, payments }
    : { kind: 'unrepresentable', date: intent.expenseDate, total, payments };
}

export function planPayrollObligationCompletion(
  facts: PayrollObligationCompletionFacts,
): PayrollObligationCompletionPlan {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts))
    throw new Error('Invalid completion facts');
  if (
    !Object.prototype.hasOwnProperty.call(facts, 'expenseChoice') ||
    facts.expenseChoice === undefined
  )
    throw new Error('Invalid expense choice');
  const choice = facts.expenseChoice;
  if (choice !== null && typeof choice !== 'boolean')
    throw new Error('Invalid expense choice');

  const totalCents = centsOf(facts.total);
  const verified = verifyOutflows(facts.outflows);
  const { effective, correctedIds } = applyCorrections(
    verified,
    facts.corrections,
  );
  // Each validated outflow is counted once; same-date facts stay distinct.
  const paidCents = effective.reduce((sum, outflow) => sum + outflow.cents, 0n);
  // Existing payroll writers reject an installment that reaches or exceeds the
  // balance, so an overpayment is refused instead of being classified.
  if (paidCents > totalCents)
    throw new Error('Paid amount exceeds obligation total');
  const completed = paidCents === totalCents;

  return {
    status: completed ? 'completed' : 'pending',
    total: moneyText(totalCents),
    paid: moneyText(paidCents),
    balance: moneyText(totalCents - paidCents),
    outflows: effective.map((outflow) => ({
      id: outflow.id,
      amount: moneyText(outflow.cents),
      date: outflow.date,
      method: outflow.method,
      corrected: correctedIds.has(outflow.id),
    })),
    expense: expenseDecision(choice, completed, facts, effective, paidCents),
  };
}
