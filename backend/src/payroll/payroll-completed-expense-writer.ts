import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ExpensePaymentStatus, PaymentMethod, Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PayrollExpenseCategoryIdentity } from './payroll-expense-category.service';
import {
  planPayrollObligationCompletion,
  type PayrollObligationCompletionFacts,
} from './payroll-obligation-completion';

/**
 * Unwired transaction-client-level expense foundation for an already completed
 * payroll obligation (S5, S8).
 *
 * The caller owns one **real** transaction that it already opened, and every lock
 * inside it. On entry that transaction must hold the obligation row locked and
 * still `PENDING`, and must supply the intended post-operation facts of the
 * completion it is about to persist (total, real cash outflows, corrections,
 * stored expense choice and dates). The caller then atomically persists the
 * transition (installments/cash and the obligation status) in the same
 * transaction.
 *
 * This function cannot enforce transaction reality, persisted database state, row
 * ownership or the truth of the caller-provided cash facts. It only sees the
 * client and the facts it is handed, so every guarantee below is a precondition,
 * not a check. Requirements it cannot verify:
 * - `tx` is the caller's existing transaction client. This function never opens a
 *   transaction, never retries and never swallows an error;
 * - `facts` describes the proposed post-operation state, so the planner can
 *   classify completion before the caller commits (the facts are unverifiable here);
 * - when the stored choice enables an expense, the caller supplies the
 *   tenant-scoped category identity it resolved earlier. That resolver
 *   (`PayrollExpenseCategoryService.resolve()`) owns its **own** transaction and
 *   releases the `Organization` lock before this call, so no organization lock is
 *   held here and this unit must not be described as running under it. Payroll row
 *   locks are also not taken or validated here: a concurrent taxonomy deactivation
 *   is only detected if it commits before the category read below.
 *
 * Order of decisions, which is part of the contract:
 * 1. structural ids; 2. matching-tenant OWNER/ADMIN authorization, enforced before
 * any outcome is returned; 3. the planner decision, so a disabled, unknown or
 * still-pending payment needs no expense category and neither reads nor writes
 * one; 4. an unrepresentable (> Decimal(12,2)) expense, which fails immediately
 * with the approved explicit limit error **before any read or write**; 5. for a
 * representable expense, verified replay of an existing link, which takes the
 * shared tenant-scoped `Expense ... FOR UPDATE` lock before it reads that
 * expense; 6. category identity, bound/active category and the expense writes.
 * A first creation needs no pre-lock: this transaction creates that expense row,
 * so nothing else can have reached it yet.
 *
 * The replay lock is the wiring gate verified on the expense API: `update`,
 * `addPayment` and `remove` take the same tenant-scoped `Expense ... FOR UPDATE`
 * lock before their own payroll-link check. Without taking it here first, this unit
 * could verify a linked expense from facts a concurrent expense mutation has
 * already changed, or attach a link to an expense it never proved. Exactly one
 * lock is taken, in the caller's transaction: no payroll, obligation or cash row
 * is locked here, and a missing locked row fails closed with ConflictException
 * before any write.
 *
 * Fail-closed precedence of step 4: no category, link or persisted-expense state
 * can mask the limit error, and an over-limit selected expense can never complete
 * silently. Because `Expense.total` is `Decimal(12,2)`, an over-limit plan can
 * never be a validly linked expense, so skipping the replay check for it cannot
 * hide an already verified expense.
 *
 * Replay is fail-closed and is never decided by link identity alone. A persisted
 * link only reports `already_linked` when its expense is active, tenant-scoped and
 * matches the exact planned total, expense date and payment facts (amount, date
 * and method as a multiset with multiplicity). Any other linked state throws
 * ConflictException without writing, so nothing is replaced or invented. Replay
 * deliberately does not depend on the current taxonomy: an association that was
 * removed or deactivated later never invalidates an already linked payment.
 *
 * Effects, and only these: one `Expense`, one `ExpensePayment` per real outflow
 * fact, one actor-attributed `EXPENSE_CREATED` audit row (same action, resource
 * and metadata shape as `ExpensesService`) and the immutable
 * `PayrollObligationExpense` link, all inside `tx`. It never creates a
 * `PayrollCashOutflow` and never updates the obligation. Audit failures propagate
 * unchanged; mocked tests cannot prove the resulting rollback.
 *
 * HARD GATE before wiring (not solved here, do not claim otherwise): the replay
 * now locks the linked expense, but this unit still reads the category without a
 * lock, so a concurrent taxonomy deactivation can land between that read and
 * these writes; a first completion can also race another writer on the same
 * obligation, and a first write is not guarded against a concurrent expense
 * mutation because the row does not exist yet. Resolving those races needs a
 * transaction-scoped category design (the current resolver's separate transaction
 * cannot be used atomically), a consistent lock protocol agreed with every payroll
 * and expense writer, P2028-style lock-wait/conflict mapping and real
 * PostgreSQL/concurrency proof. Mocks here prove ordering only: they cannot prove
 * that PostgreSQL blocks, that the lock is the same one, or that anything rolls
 * back. Duplicate-key errors are propagated, never retried, so a lost race
 * surfaces as a failure instead of a false success.
 *
 * Reporting is not integrated: cash-flow reports currently count
 * `ExpensePayment` and ignore `PayrollCashOutflow`, so creating these payments
 * without a report change would double count payroll cash. This unit therefore
 * must stay unwired until reports explicitly exclude linked expense payments and
 * include payroll outflows even when the expense is disabled.
 */
export interface PayrollCompletionExpenseWriteInput {
  organizationId: string;
  employeeId: string;
  obligationId: string;
  actor: RequestUser | undefined;
  /**
   * Already-resolved, tenant-scoped automatic category identity. Only required
   * when this call writes an expense (enabled choice on a completed payment).
   */
  category?: PayrollExpenseCategoryIdentity;
  facts: PayrollObligationCompletionFacts;
}

export type PayrollCompletionExpenseWriteOutcome =
  | { kind: 'disabled' }
  | { kind: 'unknown_choice' }
  | { kind: 'awaiting_completion' }
  | { kind: 'already_linked'; expenseId: string }
  | {
      kind: 'created';
      expenseId: string;
      total: string;
      payments: number;
    };

const INVALID_INPUT = 'Datos de gasto de nómina inválidos';
// Approved explicit error for an expense-enabled completed payment above
// Decimal(12,2). It is not a payroll cap.
const EXPENSE_LIMIT_MESSAGE =
  'El gasto de nómina supera $9.999.999.999,99; el pago no se puede completar con gasto';
// Bogotá is UTC-5 all year; local midnight is 05:00Z of the same calendar day.
const BOGOTA_UTC_OFFSET_HOURS = 5;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new BadRequestException(INVALID_INPUT);
  return value;
}

/**
 * Strict `YYYY-MM-DD` to the Bogotá start of that calendar day.
 *
 * Local variant of `parseBogotaStartOfDay`: that shared helper feeds `Date.UTC`,
 * which coerces years 0-99 to 1900-1999, and it does not reject impossible days.
 * `setUTCFullYear` keeps years 0001-0099 intact. The planner already refuses
 * invalid dates, so these checks are the write-boundary defense, not the first
 * line of validation.
 */
function bogotaDayStart(value: string): Date {
  if (typeof value !== 'string' || !DATE_ONLY.test(value))
    throw new BadRequestException(INVALID_INPUT);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1)
    throw new BadRequestException(INVALID_INPUT);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(BOGOTA_UTC_OFFSET_HOURS, 0, 0, 0);
  // A rolled-over date (2023-02-29 -> 2023-03-01) is not the requested day.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new BadRequestException(INVALID_INPUT);
  return date;
}

function requireCategoryIdentity(
  value: PayrollExpenseCategoryIdentity | undefined,
  organizationId: string,
): PayrollExpenseCategoryIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException(INVALID_INPUT);
  requireId(value.labelId);
  requireId(value.groupId);
  // A category identity resolved for another tenant is never trusted.
  if (value.organizationId !== organizationId)
    throw new ConflictException(
      'La categoría de gasto de nómina no pertenece a esta organización',
    );
  return value;
}

async function assertBoundCategory(
  tx: Prisma.TransactionClient,
  organizationId: string,
  category: PayrollExpenseCategoryIdentity,
): Promise<void> {
  // The stored association is the identity: names are mutable, so a renamed
  // category still resolves and a same-name label elsewhere is never used.
  const association = await tx.payrollExpenseCategory.findUnique({
    where: { organizationId },
    select: { labelId: true, groupId: true },
  });
  if (
    !association ||
    association.labelId !== category.labelId ||
    association.groupId !== category.groupId
  )
    throw new ConflictException(
      'La categoría de gasto de nómina no está asignada a esta organización',
    );

  const label = await tx.expenseLabel.findUnique({
    where: {
      id_groupId_organizationId: {
        id: category.labelId,
        groupId: category.groupId,
        organizationId,
      },
    },
    select: { active: true, group: { select: { active: true } } },
  });
  if (!label || !label.group || !label.active || !label.group.active)
    throw new ConflictException(
      'La categoría de gasto de nómina está inactiva o no pertenece a esta organización',
    );
}

interface PlannedPayment {
  amount: Prisma.Decimal;
  method: PaymentMethod;
  date: Date;
}

interface PlannedExpense {
  total: Prisma.Decimal;
  date: Date;
  payments: PlannedPayment[];
}

async function requireExpenseCategory(
  tx: Prisma.TransactionClient,
  category: PayrollExpenseCategoryIdentity | undefined,
  organizationId: string,
): Promise<PayrollExpenseCategoryIdentity> {
  const identity = requireCategoryIdentity(category, organizationId);
  await assertBoundCategory(tx, organizationId, identity);
  return identity;
}

// Amount, date and method are compared as a multiset with multiplicity: two real
// outflows paid the same day with the same method must stay two payments, and a
// stored row without a tenant match never satisfies a planned fact.
function samePaymentFacts(
  stored: {
    organizationId: string;
    amount: Prisma.Decimal;
    method: PaymentMethod;
    date: Date;
  }[],
  organizationId: string,
  planned: PlannedPayment[],
): boolean {
  if (stored.length !== planned.length) return false;
  const key = (
    tenantId: string,
    amount: Prisma.Decimal,
    method: PaymentMethod,
    date: Date,
  ) => `${tenantId}|${amount.toFixed(2)}|${date.getTime()}|${method}`;

  const remaining = new Map<string, number>();
  for (const payment of planned) {
    const paymentKey = key(
      organizationId,
      payment.amount,
      payment.method,
      payment.date,
    );
    remaining.set(paymentKey, (remaining.get(paymentKey) ?? 0) + 1);
  }
  for (const payment of stored) {
    if (payment.organizationId !== organizationId) return false;
    const paymentKey = key(
      payment.organizationId,
      payment.amount,
      payment.method,
      payment.date,
    );
    const count = remaining.get(paymentKey) ?? 0;
    if (count === 0) return false;
    remaining.set(paymentKey, count - 1);
  }
  return true;
}

/**
 * Takes the shared expense-writer lock on the linked expense row.
 *
 * This is the same tenant-scoped `Expense ... FOR UPDATE` statement the expense
 * mutation guard uses, so both writers serialize on one row before either decides
 * anything from it. An empty result means the link points at a row this tenant
 * cannot lock (deleted, reassigned or never visible to us), and fail-closed
 * precedence treats that as a conflict rather than as a replay or a first write.
 */
async function lockLinkedExpense(
  tx: Prisma.TransactionClient,
  organizationId: string,
  expenseId: string,
): Promise<void> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Expense"
      WHERE "id" = ${expenseId} AND "organizationId" = ${organizationId}
      FOR UPDATE`;
  if (locked.length === 0)
    throw new ConflictException(
      'El gasto vinculado ya no está disponible; requiere revisión manual',
    );
}

/**
 * Verified replay of an existing obligation/expense link.
 *
 * Returns the linked expense id only when the persisted expense is active,
 * tenant-scoped and identical to the exact planned total, expense date and
 * payment facts. The linked row is locked with the shared expense-writer lock
 * before it is read. Anything else fails closed with ConflictException: a replay
 * must never report success for an expense this unit cannot prove, and it never
 * replaces, repairs or substitutes the stored expense.
 *
 * It intentionally does not read the expense taxonomy, so a category that was
 * deactivated or unassigned after the original write cannot invalidate history.
 */
async function verifyLinkedExpense(
  tx: Prisma.TransactionClient,
  organizationId: string,
  employeeId: string,
  obligationId: string,
  planned: PlannedExpense,
): Promise<string | null> {
  const link = await tx.payrollObligationExpense.findUnique({
    where: {
      obligationId_organizationId_employeeId: {
        obligationId,
        organizationId,
        employeeId,
      },
    },
    select: { expenseId: true },
  });
  if (!link) return null;

  // Lock before reading: the expense API holds this row lock while it decides its
  // own mutations, so reading without it could verify facts that writer is about
  // to change. The lock precedes the first expense read and any write.
  await lockLinkedExpense(tx, organizationId, link.expenseId);

  const stored = await tx.expense.findFirst({
    where: { id: link.expenseId, organizationId },
    select: {
      id: true,
      active: true,
      total: true,
      date: true,
      payments: {
        select: {
          organizationId: true,
          amount: true,
          method: true,
          date: true,
        },
      },
    },
  });
  if (
    !stored ||
    !stored.active ||
    !stored.total.equals(planned.total) ||
    stored.date.getTime() !== planned.date.getTime() ||
    !samePaymentFacts(stored.payments, organizationId, planned.payments)
  )
    throw new ConflictException(
      'El gasto vinculado no coincide con el pago de nómina; requiere revisión manual',
    );

  return stored.id;
}

export async function writePayrollCompletionExpense(
  tx: Prisma.TransactionClient,
  input: PayrollCompletionExpenseWriteInput,
): Promise<PayrollCompletionExpenseWriteOutcome> {
  if (!tx || !input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException(INVALID_INPUT);
  const organizationId = requireId(input.organizationId);
  const employeeId = requireId(input.employeeId);
  const obligationId = requireId(input.obligationId);

  // S5: only the business owner or an administrator of that same tenant, checked
  // before any outcome is returned so "no expense" is an authorized answer too.
  const actor = input.actor;
  if (
    !actor?.userId ||
    actor.organizationId !== organizationId ||
    !['OWNER', 'ADMIN'].includes(actor.role)
  )
    throw new ForbiddenException(
      'No tiene permiso para gestionar gastos de nómina',
    );

  // The planner owns completion, choice and representability. It reports an
  // unstated choice as unknown, and it never rounds or caps payroll.
  const { expense } = planPayrollObligationCompletion(input.facts);
  if (expense.kind !== 'create' && expense.kind !== 'unrepresentable')
    return { kind: expense.kind };

  // Approved decision, applied before any read or write: an expense-enabled
  // completed payment above Decimal(12,2) fails with this explicit error. It is
  // neither a payroll cap nor a reason to omit, split or round the expense, and no
  // category, link or persisted-expense state can mask it. Such a plan can never
  // be a validly linked expense, since Expense.total is Decimal(12,2), so skipping
  // the replay check here cannot hide an already verified expense.
  if (expense.kind === 'unrepresentable')
    throw new BadRequestException(EXPENSE_LIMIT_MESSAGE);

  // Planned facts are the single basis for both a first write and a replay check.
  const planned: PlannedExpense = {
    total: new Prisma.Decimal(expense.total),
    date: bogotaDayStart(expense.date),
    payments: expense.payments.map((payment) => ({
      amount: new Prisma.Decimal(payment.amount),
      method: payment.method,
      date: bogotaDayStart(payment.date),
    })),
  };

  // Replay before any taxonomy read: an existing link is verified against the
  // persisted expense, so a category that was renamed, deactivated or unassigned
  // after the original write never blocks an already linked payment.
  const replayed = await verifyLinkedExpense(
    tx,
    organizationId,
    employeeId,
    obligationId,
    planned,
  );
  if (replayed) return { kind: 'already_linked', expenseId: replayed };

  // Only a first write needs the resolved, bound and active tenant category.
  const category = await requireExpenseCategory(
    tx,
    input.category,
    organizationId,
  );

  const payments = planned.payments.map((payment) => ({
    organizationId,
    ...payment,
  }));
  const total = planned.total;

  // The expense must describe real cash only, and its status must be truthful:
  // the planner creates an expense only from positive outflows that exactly cover
  // the total, so the expense is fully paid. This guard keeps that contract
  // explicit instead of assuming it.
  const paid = payments.reduce(
    (sum, payment) => sum.plus(payment.amount),
    new Prisma.Decimal(0),
  );
  if (!paid.equals(total))
    throw new BadRequestException(
      'Los pagos del gasto no coinciden con el total de nómina',
    );

  const created = await tx.expense.create({
    data: {
      organizationId,
      labelId: category.labelId,
      // No payroll description is approved yet; nothing is invented here.
      description: null,
      date: planned.date,
      total,
      status: ExpensePaymentStatus.PAID,
      createdById: actor.userId,
      payments: { create: payments },
    },
    select: { id: true },
  });

  // Same actor-attributed audit convention as `ExpensesService.create`, written in
  // the caller's transaction. A failure propagates unchanged and is never
  // reclassified; only a real transaction rollback, which these mocks cannot
  // prove, undoes the expense above.
  await tx.auditLog.create({
    data: {
      userId: actor.userId,
      organizationId,
      action: 'EXPENSE_CREATED',
      resource: 'Expense',
      resourceId: created.id,
      metadata: {
        summary: `Salida creada por ${total.toString()}`,
        total: total.toString(),
        status: ExpensePaymentStatus.PAID,
        payments: expense.payments.map((payment) => ({
          amount: new Prisma.Decimal(payment.amount).toString(),
          method: payment.method,
          date: payment.date,
        })),
        timestamp: new Date().toISOString(),
      },
    },
  });

  await tx.payrollObligationExpense.create({
    data: {
      obligationId,
      organizationId,
      employeeId,
      expenseId: created.id,
    },
  });

  return {
    kind: 'created',
    expenseId: created.id,
    total: expense.total,
    payments: payments.length,
  };
}
