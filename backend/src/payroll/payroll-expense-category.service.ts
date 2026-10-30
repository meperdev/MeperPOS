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
 * Lock ordering (unproven, no PostgreSQL evidence): `resolve()` owns its own
 * transaction and takes only the `Organization` row lock, so two cooperating
 * resolutions of the same tenant serialize on that row and cannot deadlock each
 * other. The risk is a different writer that locks the organization row and then
 * a payroll row (employee, obligation or shift) in one transaction: if a caller
 * already holds those payroll row locks and then calls `resolve()`, the two paths
 * acquire the same locks in opposite order. Callers must therefore run
 * `resolve()` before acquiring payroll locks
 * (employee → obligation → sorted shifts).
 *
 * An atomic integration that needs this category and a payment together is not
 * possible with the current split: it would have to merge both flows into a
 * single transaction client, acquire the organization lock ahead of the employee
 * lock, and coordinate every relevant writer. The existing employee-first payroll
 * services implement no such protocol, so this remains required design work and
 * not an established global order.
 *
 * Unwired: no expense creation, payment completion, route or module registration.
 * Mocked tests cannot prove PostgreSQL locking, rollback or concurrency.
 */
@Injectable()
export class PayrollExpenseCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ): Promise<PayrollExpenseCategoryIdentity> {
    // Owner/admin only, and only for the caller's own organization (S5).
    if (
      !organizationId ||
      !actor?.userId ||
      actor.organizationId !== organizationId ||
      !['OWNER', 'ADMIN'].includes(actor.role)
    )
      throw new ForbiddenException(
        'No tiene permiso para gestionar gastos de nómina',
      );

    const state: AuditState = { auditFailed: false };
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize cooperating creators on the tenant row before any taxonomy
        // read or write, so a concurrent first payment cannot duplicate the
        // category. This is a PostgreSQL row lock; mocked tests do not prove it.
        const organizations = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
        if (!organizations.length)
          throw new NotFoundException('Organización no encontrada');

        const association = await tx.payrollExpenseCategory.findUnique({
          where: { organizationId },
        });

        if (association) return this.existing(tx, organizationId, association);

        return this.create(tx, organizationId, actor.userId, state);
      });
    } catch (error) {
      // An audit failure is reported as itself; only transaction-level
      // uniqueness/serialization conflicts become 409 and are never retried.
      if (state.auditFailed) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException(
          'Conflicto al crear la categoría de gasto de nómina; reintente',
        );
      throw error;
    }
  }

  private async existing(
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

  private async create(
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
    await this.audit(tx, state, {
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
    await this.audit(tx, state, {
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
    await this.audit(tx, state, {
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
  private async audit(
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
}
