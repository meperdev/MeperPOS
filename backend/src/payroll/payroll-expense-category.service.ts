import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

/** Fixed payroll expense category created automatically for each business. */
export const PAYROLL_EXPENSE_CATEGORY_NAME = 'Nómina';

export interface PayrollExpenseCategoryIdentity {
  organizationId: string;
  groupId: string;
  labelId: string;
}

interface AuditState {
  auditFailed: boolean;
}

interface AuditData {
  organizationId: string;
  actorId: string;
  action: string;
  resource: string;
  resourceId: string;
  metadata: Prisma.InputJsonObject;
}

interface AuthorizedCaller {
  organizationId: string;
  actorId: string;
}

// S5: owner/admin only, and only for the caller's own organization. Shared by both
// entry points so neither can bypass it; it runs before any read or write.
function authorizePayrollExpenseCategory(
  organizationId: string | undefined,
  actor: RequestUser | undefined,
): AuthorizedCaller {
  if (
    !organizationId ||
    !actor?.userId ||
    actor.organizationId !== organizationId ||
    !['OWNER', 'ADMIN'].includes(actor.role)
  )
    throw new ForbiddenException(
      'No tiene permiso para gestionar gastos de nómina',
    );
  return { organizationId, actorId: actor.userId };
}

// An audit failure is reported as itself; only transaction-level
// uniqueness/serialization conflicts become 409 and are never retried.
function rethrowCategoryError(state: AuditState, error: unknown): never {
  if (
    !state.auditFailed &&
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2002', 'P2034'].includes(error.code)
  )
    throw new ConflictException(
      'Conflicto al crear la categoría de gasto de nómina; reintente',
    );
  throw error;
}

/**
 * Resolves the single payroll expense category of a business on the client the
 * caller already owns (S5, S7, S8).
 *
 * Use this from a transaction that must create the category and a payroll effect
 * atomically: it never opens, retries or commits a transaction of its own, so the
 * caller's commit or rollback decides both, and a failure here rolls the whole
 * completion back. `PayrollExpenseCategoryService.resolve()` is the same logic in
 * its own transaction, for callers that have no transaction yet.
 *
 * It locks the `Organization` row first, then reads or creates the taxonomy and
 * the association. Because a completion calls it while already holding the
 * payroll row locks, see the lock-order contract on the service class below.
 *
 * Unwired in the module: there is no route of its own. The installment services
 * call it inside their completion transactions only when an expense will actually
 * be written. Mocked tests cannot prove PostgreSQL locking, rollback or
 * concurrency.
 */
export async function resolvePayrollExpenseCategoryWithin(
  tx: Prisma.TransactionClient,
  organizationId: string | undefined,
  actor: RequestUser | undefined,
): Promise<PayrollExpenseCategoryIdentity> {
  const caller = authorizePayrollExpenseCategory(organizationId, actor);
  const state: AuditState = { auditFailed: false };
  try {
    return await resolveLockedWithin(tx, caller, state);
  } catch (error) {
    rethrowCategoryError(state, error);
  }
}

// Serialize cooperating creators on the tenant row before any taxonomy read or
// write, so a concurrent first payment cannot duplicate the category. This is a
// PostgreSQL row lock; mocked tests do not prove it.
async function resolveLockedWithin(
  tx: Prisma.TransactionClient,
  caller: AuthorizedCaller,
  state: AuditState,
): Promise<PayrollExpenseCategoryIdentity> {
  const organizationId = caller.organizationId;
  const organizations = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
  if (!organizations.length)
    throw new NotFoundException('Organización no encontrada');

  const association = await tx.payrollExpenseCategory.findUnique({
    where: { organizationId },
  });

  if (association) return resolveExisting(tx, organizationId, association);

  return createCategory(tx, organizationId, caller.actorId, state);
}

async function resolveExisting(
  tx: Prisma.TransactionClient,
  organizationId: string,
  association: { labelId: string; groupId: string },
): Promise<PayrollExpenseCategoryIdentity> {
  // Tenant identity is part of the composite key, so a label or group of
  // another organization resolves to nothing instead of being trusted.
  const [group, label] = await Promise.all([
    tx.expenseGroup.findUnique({
      where: {
        id_organizationId: {
          id: association.groupId,
          organizationId,
        },
      },
    }),
    tx.expenseLabel.findUnique({
      where: {
        id_groupId_organizationId: {
          id: association.labelId,
          groupId: association.groupId,
          organizationId,
        },
      },
    }),
  ]);

  if (!group || !label)
    throw new ConflictException(
      'La categoría de gasto de nómina no pertenece a esta organización',
    );
  if (!group.active || !label.active)
    throw new ConflictException(
      'La categoría de gasto de nómina está inactiva; requiere reactivación explícita',
    );

  return {
    organizationId,
    groupId: association.groupId,
    labelId: association.labelId,
  };
}

async function createCategory(
  tx: Prisma.TransactionClient,
  organizationId: string,
  actorId: string,
  state: AuditState,
): Promise<PayrollExpenseCategoryIdentity> {
  // Group names are unique per organization, so an existing "Nómina" group is
  // a collision that needs an explicit assignment. It is never reused or
  // reactivated, and this unit never edits unrelated taxonomy.
  const groupCollision = await tx.expenseGroup.findFirst({
    where: { organizationId, name: PAYROLL_EXPENSE_CATEGORY_NAME },
    select: { id: true },
  });
  if (groupCollision)
    throw new ConflictException(
      `Ya existe un grupo de gastos "${PAYROLL_EXPENSE_CATEGORY_NAME}"; requiere asignación explícita`,
    );

  const group = await tx.expenseGroup.create({
    data: { organizationId, name: PAYROLL_EXPENSE_CATEGORY_NAME },
    select: { id: true },
  });
  await auditCategory(tx, state, {
    organizationId,
    actorId,
    action: 'PAYROLL_EXPENSE_CATEGORY_GROUP_CREATED',
    // Same resource as ExpenseTaxonomyService.audit(), so taxonomy history stays
    // queryable by resource; the payroll-specific action keeps the two apart.
    resource: 'ExpenseTaxonomy',
    resourceId: group.id,
    metadata: { name: PAYROLL_EXPENSE_CATEGORY_NAME },
  });

  // The label lives in the new group, so it cannot collide with an unrelated
  // same-name label in another group; no tenant-wide label gate is needed.
  const label = await tx.expenseLabel.create({
    data: {
      organizationId,
      groupId: group.id,
      name: PAYROLL_EXPENSE_CATEGORY_NAME,
    },
    select: { id: true },
  });
  await auditCategory(tx, state, {
    organizationId,
    actorId,
    action: 'PAYROLL_EXPENSE_CATEGORY_LABEL_CREATED',
    resource: 'ExpenseTaxonomy',
    resourceId: label.id,
    metadata: { name: PAYROLL_EXPENSE_CATEGORY_NAME, groupId: group.id },
  });

  await tx.payrollExpenseCategory.create({
    data: { organizationId, groupId: group.id, labelId: label.id },
  });
  await auditCategory(tx, state, {
    organizationId,
    actorId,
    action: 'PAYROLL_EXPENSE_CATEGORY_ASSIGNED',
    resource: 'PayrollExpenseCategory',
    // The association's primary key is the organization id; the stable group
    // and label ids travel in the metadata.
    resourceId: organizationId,
    metadata: { groupId: group.id, labelId: label.id },
  });

  return { organizationId, groupId: group.id, labelId: label.id };
}

// Audits share the caller's transaction, so a failure aborts the creation and
// is rethrown unchanged instead of being reclassified as a conflict.
async function auditCategory(
  tx: Prisma.TransactionClient,
  state: AuditState,
  data: AuditData,
): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        userId: data.actorId,
        organizationId: data.organizationId,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        metadata: data.metadata,
      },
    });
  } catch (error) {
    state.auditFailed = true;
    throw error;
  }
}

/**
 * Resolves the single payroll expense category of a business (S5).
 *
 * The category is stored as an explicit tenant-scoped association, so renames of
 * the group or label keep the identity stable: an existing association is always
 * resolved by its stored ids, never by name.
 *
 * Collision and inactive policy is intentionally fail-closed: a pre-existing
 * group named "Nómina" may belong to somebody else's intent, so it is neither
 * reused, renamed, moved nor reactivated. The same applies to an inactive
 * associated label/group. Labels are unique per group only, so a same-name label
 * in an unrelated group is not a conflict and is left untouched.
 *
 * Lock order, as established by this file plus the two completion services:
 *
 * 1. `PayrollPeriodInstallmentsService` / `PayrollGroupInstallmentsService` lock
 *    `Employee`, then `PayrollObligation`, then (group only) the ordered
 *    `EmployeeShift` rows, and insert the cash/installment/allocation facts.
 * 2. Only then, and only when the planner says an expense will be written, they
 *    call `resolvePayrollExpenseCategoryWithin`, which locks the tenant
 *    `Organization` row and then reads or creates the taxonomy.
 * 3. `writePayrollCompletionExpense` writes the `Expense`, `ExpensePayment`,
 *    `AuditLog` and `PayrollObligationExpense` rows. It takes the shared
 *    `Expense ... FOR UPDATE` lock only on the replay path, and a tenant-scoped
 *    `ExpenseLabel ... FOR UPDATE` lock on the bound category before re-reading its
 *    active flags on a first write, so a concurrent label deactivation either waits
 *    or is caught fail-closed.
 *
 * So this unit's order is payroll rows → Organization → taxonomy/Expense.
 *
 * Can that form a cycle with an existing writer, statically speaking (no
 * PostgreSQL proof exists)? No reverse-order writer was found:
 * - `Organization ... FOR UPDATE` appears only here; no other service locks the
 *   tenant row explicitly before payroll rows.
 * - Every payroll writer that inserts a row whose organization foreign key takes
 *   an implicit `FOR KEY SHARE` on `Organization` (periods, groups, installments,
 *   correction, shift-date correction) first takes the `Employee` row lock of the
 *   employee it operates on, and every later row lock it takes belongs to that
 *   same employee. Two writers of the same employee therefore serialize on the
 *   `Employee` lock before either can reach `Organization`, so the payroll rows
 *   this unit holds are never requested by a writer that already holds the tenant
 *   lock.
 * - The existing expense mutation guard takes `Expense ... FOR UPDATE` and then
 *   only reads the payroll link (a non-locking read); it never requests a payroll
 *   row lock and never locks `Organization`. It also fails closed on a
 *   payroll-linked expense, so the replay path here cannot wait for an expense row
 *   while that guard waits for the tenant row.
 * - Writes that only update `Organization` (settings, billing, admin) take no
 *   payroll locks.
 *
 * Residual risk, stated honestly: this is a static argument, not a lock trace.
 * Any future writer that locks `Organization` (or merely inserts a child row of it
 * for the same tenant) and afterwards locks an `Employee`/`PayrollObligation`/
 * `EmployeeShift` row would be a new AB-BA cycle against this unit; the payroll
 * functions that could race this completion must keep the employee-first order.
 * Real PostgreSQL lock-wait, deadlock and rollback behavior remain unverified, and
 * a lock-wait timeout (`P2028`) is not classified here.
 *
 * Also not solved: a concurrent taxonomy deactivation that commits after the
 * writer's label lock is released and its re-read has passed is no longer reachable
 * for the label itself, because that row is locked for the whole write. The
 * *group* row is still only re-read, not locked, so a concurrent group deactivation
 * keeps that smaller window. The expense taxonomy API takes no organization lock,
 * so taxonomy structure changes are not serialized with this category path.
 */
@Injectable()
export class PayrollExpenseCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ): Promise<PayrollExpenseCategoryIdentity> {
    // Authorize before opening a transaction, then reuse the transaction-scoped
    // implementation so both entry points share one policy.
    const caller = authorizePayrollExpenseCategory(organizationId, actor);
    const state: AuditState = { auditFailed: false };
    try {
      return await this.prisma.$transaction((tx) =>
        resolveLockedWithin(tx, caller, state),
      );
    } catch (error) {
      rethrowCategoryError(state, error);
    }
  }
}
