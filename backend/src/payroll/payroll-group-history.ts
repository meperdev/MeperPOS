import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Partial validation only: the caller must supply a consistent post-lock snapshot,
// reject empty or duplicate shift IDs, and validate dates and per-shift overpayment
// separately. This function performs no reads or writes and does not implement
// correction or release semantics.
//
// Allocations are append-only evidence, so a corrected installment keeps the
// applications it replaced. An allocation with any void is superseded: it stays
// in history for audit but contributes nothing to the cash reconciliation nor to
// the effective plan handed to the allocator. Cash must therefore equal the sum
// of the *effective* applications of each installment. Anything that cannot be
// resolved into exactly one effective application per membership is rejected
// instead of being guessed, because a wrong interpretation moves money.
type Membership = {
  id: string;
  shiftId: string;
  releasedAt: Date | null;
  shift: { id: string; amount: Prisma.Decimal };
};
type History = {
  before: { id: string; shiftId: string }[];
  obligationId: string;
  memberships: Membership[];
  allMemberships: {
    id: string;
    shiftId: string;
    obligationId: string;
    releasedAt: Date | null;
    allocations: { id: string }[];
  }[];
  installments: {
    outflowId: string;
    outflow: {
      id: string;
      amount: Prisma.Decimal;
      _count: { installments: number };
    };
    allocations: {
      membershipId: string;
      amount: Prisma.Decimal;
      voids: unknown[];
    }[];
  }[];
};

// Bound persisted facts before conversion: an individual application cannot
// exceed a shift; a cash outflow cannot exceed every possible dated shift.
function cents(value: Prisma.Decimal, maximum: string): bigint {
  if (
    !value.isFinite() ||
    !value.gt(0) ||
    value.decimalPlaces() > 2 ||
    value.gt(maximum)
  )
    throw new ConflictException('Historial de abonos inconsistente');
  return BigInt(value.toFixed(2).replace('.', ''));
}

export function validatePayrollGroupHistory({
  before,
  obligationId,
  memberships,
  allMemberships,
  installments,
}: History): { shiftId: string; amount: string }[] {
  // A prior release is harmless only when it has no application facts.
  // Even a voided application does not establish what happened to cash.
  if (
    allMemberships.some(
      (m) => m.releasedAt !== null && m.allocations.length !== 0,
    )
  )
    throw new ConflictException('Historial de grupo inconsistente');
  const activeMemberships = allMemberships.filter((m) => m.releasedAt === null);
  const byId = new Map(memberships.map((m) => [m.id, m]));
  if (
    byId.size !== before.length ||
    memberships.length !== before.length ||
    activeMemberships.length !== before.length ||
    before.some((m) => byId.get(m.id)?.shiftId !== m.shiftId) ||
    activeMemberships.some(
      (m) =>
        m.obligationId !== obligationId ||
        byId.get(m.id)?.shiftId !== m.shiftId,
    ) ||
    memberships.some((m) => m.releasedAt !== null || m.shift.id !== m.shiftId)
  )
    throw new ConflictException('Historial de grupo inconsistente');

  for (const membership of memberships)
    cents(membership.shift.amount, '9999999999.99');
  const allocations: { shiftId: string; amount: string }[] = [];
  const cashIds = new Set<string>();
  for (const installment of installments) {
    if (
      cashIds.has(installment.outflowId) ||
      installment.outflow.id !== installment.outflowId ||
      installment.outflow._count.installments !== 1
    )
      throw new ConflictException('Abono compartido o inconsistente');
    cashIds.add(installment.outflowId);
    const cash = cents(installment.outflow.amount, '36520589999963479.41');
    let applied = 0n;
    // At most one effective application per membership: a correction voids the
    // replaced row and adds its successor in the same installment.
    const effectiveMemberships = new Set<string>();
    for (const allocation of installment.allocations) {
      const membership = byId.get(allocation.membershipId);
      // One allocation can be superseded once. Unknown targets and repeated voids
      // are ambiguous evidence, voided or not.
      if (!membership || allocation.voids.length > 1)
        throw new ConflictException('Aplicación inconsistente');
      // Superseded amounts are validated too, so corrupt evidence never passes as
      // history merely because it no longer counts.
      const amount = cents(allocation.amount, '9999999999.99');
      if (allocation.voids.length !== 0) continue;
      if (effectiveMemberships.has(allocation.membershipId))
        throw new ConflictException('Aplicación inconsistente');
      effectiveMemberships.add(allocation.membershipId);
      applied += amount;
      if (applied > cash)
        throw new ConflictException('Aplicación excede abono');
      allocations.push({
        shiftId: membership.shiftId,
        amount: allocation.amount.toFixed(2),
      });
    }
    if (cash !== applied)
      throw new ConflictException('Abono y aplicaciones no coinciden');
  }
  return allocations;
}
