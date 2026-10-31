import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PayrollObligationKind,
  PayrollObligationStatus,
  Prisma,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePayrollReplacementPaymentDto } from './dto/create-payroll-replacement-payment.dto';
import {
  payrollMoneyCents,
  payrollMoneyText,
  summarizePayrollObligation,
} from './payroll-obligations.service';
import { throwPayrollTransactionError } from './payroll-transaction-error';

const INVALID_INPUT = 'Datos de pago de reemplazo inválidos';
const INCONSISTENT_HISTORY = 'Historial del pago de origen inconsistente';

const money = (value: Prisma.Decimal, cents: bigint): Prisma.Decimal => {
  if (!value.isFinite() || !value.gt(0) || value.decimalPlaces() > 2)
    throw new ConflictException(INCONSISTENT_HISTORY);
  return new Prisma.Decimal(payrollMoneyText(cents));
};

/**
 * Creates a replacement payment for an already COMPLETED payroll payment (S6, S7;
 * L327 "Referenciarlos sin cobrar de nuevo"; L338 option A).
 *
 * A completed payment is never edited: its cash, allocations, revisions and its
 * linked expense stay exactly as recorded. Instead this writer registers a NEW
 * pending fixed-period payment for the same employee that REFERENCES the valid
 * installments of the completed one. Their cash is real cash that was already
 * paid, so it counts as paid on the new payment without any new cash outflow
 * being created, while the installments the caller does not reference - the
 * mistaken registrations - become the outstanding balance the caller still has to
 * pay. The corrected total is therefore the source total: referenced cash plus
 * remaining balance.
 *
 * The amount is never a client input. It is read from the locked source outflows,
 * and the request may only name the source payment and which of its installments
 * are valid; every other field stays server-owned.
 *
 * Lock order, shared with the other payroll writers so no cycle can form:
 * `Employee` -> source `PayrollObligation` -> the referenced `PayrollCashOutflow`
 * rows in a deterministic (sorted id) order. Holding the source payment lock and
 * the source cash locks is what makes the "already referenced" check safe: two
 * concurrent replacements that tried to count the same real cash serialize here.
 *
 * What this writer does NOT do: no refund, no reimbursement, no group correction,
 * no expense write, no status transition of the source payment, no editing of any
 * source row. `PayrollInstallmentReference` is append-only evidence for exactly
 * that reason. The per-payment expense choice (S5) is stored on the new payment
 * but never acted on here: the completion transaction of that payment reads it
 * back and writes the expense there, so no expense exists before completion.
 * Real PostgreSQL locking, rollback and race behavior are proven by mocked tests
 * only.
 */
@Injectable()
export class PayrollReplacementPaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: unknown,
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ) {
    // S5/S7: only the owner or an admin of this tenant may move payroll money, and
    // the actor must be a member of the same tenant that owns the records.
    if (
      !organizationId ||
      !actor?.userId ||
      actor.organizationId !== organizationId ||
      !['OWNER', 'ADMIN'].includes(actor.role)
    )
      throw new ForbiddenException('No tiene permiso para gestionar nómina');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException(INVALID_INPUT);
    const dto = plainToInstance(CreatePayrollReplacementPaymentDto, input);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length
    )
      throw new BadRequestException(INVALID_INPUT);
    // Counting the same installment twice is a client error, not a server rule to
    // repair silently.
    if (new Set(dto.installmentIds).size !== dto.installmentIds.length)
      throw new BadRequestException(INVALID_INPUT);
    const explicitStart = dto.periodStart ?? null;
    const explicitEnd = dto.periodEnd ?? null;
    // A period is either stated as a whole or derived as a whole.
    if ((explicitStart === null) !== (explicitEnd === null))
      throw new BadRequestException(INVALID_INPUT);
    if (explicitStart && explicitEnd && explicitStart > explicitEnd)
      throw new BadRequestException(INVALID_INPUT);
    const installmentIds = [...dto.installmentIds].sort();

    const transaction = this.prisma.$transaction(async (tx) => {
      // Payroll lock order step 1: employee. Inactive employees keep their
      // history, so replacing a completed payment is still reachable for them.
      const employees = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Employee" WHERE "id" = ${dto.employeeId}
        AND "organizationId" = ${organizationId} FOR UPDATE`;
      if (!employees.length)
        throw new NotFoundException('Empleado no encontrado');

      // Step 2: the source payment, which is never modified by this writer.
      const sourceLocks = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "PayrollObligation" WHERE "id" = ${dto.sourceObligationId}
        AND "organizationId" = ${organizationId} AND "employeeId" = ${dto.employeeId} FOR UPDATE`;
      if (!sourceLocks.length)
        throw new NotFoundException('Pago de origen no encontrado');

      // Only used to locate the cash rows that have to be locked; nothing read
      // here is trusted after the locks are taken.
      const located = await tx.payrollObligation.findFirst({
        where: {
          id: dto.sourceObligationId,
          organizationId,
          employeeId: dto.employeeId,
        },
        select: {
          id: true,
          installments: { select: { id: true, outflowId: true } },
        },
      });
      if (!located) throw new NotFoundException('Pago de origen no encontrado');
      const cashIds = new Set<string>();
      for (const installmentId of installmentIds) {
        const found = located.installments.find(
          (item) => item.id === installmentId,
        );
        // A foreign installment - another payment's, another tenant's or one that
        // does not exist - is refused instead of being counted.
        if (!found)
          throw new NotFoundException('Abono de origen no encontrado');
        cashIds.add(found.outflowId);
      }

      // Step 3: the referenced cash rows, always in the same order so two
      // replacements sharing cash wait for each other deterministically.
      for (const outflowId of [...cashIds].sort()) {
        const lockedCash = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "PayrollCashOutflow" WHERE "id" = ${outflowId}
          AND "organizationId" = ${organizationId} AND "employeeId" = ${dto.employeeId} FOR UPDATE`;
        if (!lockedCash.length)
          throw new ConflictException('Movimiento no disponible');
      }

      // Re-read under every lock: the payment, its installments, its references
      // and the shift dates its period may be derived from.
      const source = await tx.payrollObligation.findFirst({
        where: {
          id: dto.sourceObligationId,
          organizationId,
          employeeId: dto.employeeId,
        },
        include: {
          installments: {
            include: {
              outflow: {
                include: { _count: { select: { installments: true } } },
              },
            },
          },
          shiftMemberships: {
            include: {
              shift: { select: { id: true, date: true, amount: true } },
            },
          },
          installmentReferences: {
            select: {
              amount: true,
              sourceInstallment: {
                select: {
                  outflow: {
                    select: {
                      id: true,
                      amount: true,
                      date: true,
                      method: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!source) throw new NotFoundException('Pago de origen no encontrado');
      if (source.status !== PayrollObligationStatus.COMPLETED)
        throw new ConflictException(
          'Solo un pago completado puede reemplazarse',
        );
      if (
        source.organizationId !== organizationId ||
        source.employeeId !== dto.employeeId
      )
        throw new ConflictException(INCONSISTENT_HISTORY);

      // The corrected total is the source total, recomputed from stored facts by
      // the same exact-cents summary the obligations route uses. A completed
      // payment whose cash disagrees with its own stored total or status is
      // corrupt history and no replacement may be derived from it.
      let total: string;
      try {
        total = summarizePayrollObligation({
          kind: source.kind,
          status: source.status,
          periodAmount: source.periodAmount,
          installments: source.installments,
          shiftMemberships: source.shiftMemberships,
          // A replacement can itself complete and later be the source of another
          // replacement, so its own referenced cash stays part of its paid total.
          references: source.installmentReferences,
        }).total;
      } catch {
        throw new ConflictException(INCONSISTENT_HISTORY);
      }
      const totalCents = payrollMoneyCents(total);

      // The same real cash may only be counted once, by any replacement. This read
      // runs under the source payment and cash locks taken above.
      const alreadyReferenced = await tx.payrollInstallmentReference.findMany({
        where: {
          organizationId,
          employeeId: dto.employeeId,
          sourceInstallmentId: { in: installmentIds },
        },
        select: { id: true },
      });
      if (alreadyReferenced.length)
        throw new ConflictException('El abono ya fue referenciado');

      let referencedCents = 0n;
      const references: Omit<
        Prisma.PayrollInstallmentReferenceCreateManyInput,
        'targetObligationId'
      >[] = [];
      for (const installmentId of installmentIds) {
        const installment = source.installments.find(
          (item) => item.id === installmentId,
        );
        if (!installment) throw new ConflictException(INCONSISTENT_HISTORY);
        // The referenced installment must still be the cash it was located as,
        // and that cash must belong to exactly this one installment: a shared
        // outflow would let one real payment be counted from two payments.
        if (
          installment.obligationId !== source.id ||
          installment.outflow.id !== installment.outflowId ||
          installment.outflow.organizationId !== organizationId ||
          installment.outflow.employeeId !== dto.employeeId
        )
          throw new ConflictException(INCONSISTENT_HISTORY);
        if (installment.outflow._count.installments !== 1)
          throw new ConflictException('Movimiento compartido no referenciable');
        if (
          !installment.outflow.amount.isFinite() ||
          !installment.outflow.amount.gt(0) ||
          installment.outflow.amount.decimalPlaces() > 2
        )
          throw new ConflictException(INCONSISTENT_HISTORY);
        const cents = payrollMoneyCents(installment.outflow.amount);
        referencedCents += cents;
        references.push({
          organizationId,
          employeeId: dto.employeeId,
          sourceObligationId: source.id,
          sourceInstallmentId: installment.id,
          // Snapshot of the referenced cash as read under the locks, so later
          // evidence never depends on re-reading the source payment.
          amount: money(installment.outflow.amount, cents),
        });
      }

      // Referenced cash plus what still has to be paid is the corrected total.
      // Referencing everything would describe a payment that is already complete,
      // so it is not a replacement; it is refused instead of created incomplete.
      if (referencedCents >= totalCents)
        throw new ConflictException(
          'Los abonos referenciados cubren el pago completo',
        );

      // The new period: explicit dates win; otherwise a grouped payment keeps the
      // dates of the shifts it pays and a fixed-period payment keeps its period.
      let periodStart: Date;
      let periodEnd: Date;
      if (explicitStart && explicitEnd) {
        periodStart = new Date(`${explicitStart}T00:00:00.000Z`);
        periodEnd = new Date(`${explicitEnd}T00:00:00.000Z`);
      } else if (source.kind === PayrollObligationKind.SHIFT_GROUP) {
        const days = source.shiftMemberships
          .map(({ shift }) => shift.date)
          .sort((left, right) => left.getTime() - right.getTime());
        if (!days.length) throw new ConflictException(INCONSISTENT_HISTORY);
        periodStart = days[0];
        periodEnd = days[days.length - 1];
      } else if (source.periodStart && source.periodEnd) {
        periodStart = source.periodStart;
        periodEnd = source.periodEnd;
      } else throw new ConflictException('El pago de origen no tiene fechas');

      const obligation = await tx.payrollObligation.create({
        data: {
          organizationId,
          employeeId: dto.employeeId,
          kind: PayrollObligationKind.FIXED_PERIOD,
          status: PayrollObligationStatus.PENDING,
          periodStart,
          periodEnd,
          // The corrected total: referenced cash plus the remaining balance.
          periodAmount: new Prisma.Decimal(total),
          // S5: the expense decision is per payment, so a replacement carries its
          // own choice and never inherits the source one. `?? null` keeps an
          // omitted choice unspecified while an explicit false stays false; the
          // completion transaction of this same row reads it back to decide
          // whether to write the expense.
          expenseEnabled: dto.expenseEnabled ?? null,
          selectedExpenseDate: dto.selectedExpenseDate
            ? new Date(`${dto.selectedExpenseDate}T00:00:00.000Z`)
            : null,
        },
      });

      const referenceData = references.map((reference) => ({
        ...reference,
        targetObligationId: obligation.id,
      }));
      const written = await tx.payrollInstallmentReference.createMany({
        data: referenceData,
      });
      if (written.count !== referenceData.length)
        throw new ConflictException('No se registraron las referencias');

      // No other write: the source payment, its outflows, its allocations, its
      // revisions and its linked expense are untouched, and no new cash outflow
      // exists for the referenced money.
      return {
        obligation,
        references: referenceData,
        paid: payrollMoneyText(referencedCents),
        balance: payrollMoneyText(totalCents - referencedCents),
        status: PayrollObligationStatus.PENDING,
      };
    });
    return transaction.catch(throwPayrollTransactionError);
  }
}
