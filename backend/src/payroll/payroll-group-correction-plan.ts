import {
  allocateShiftInstallment,
  type Allocation,
  type Shift,
} from './payroll-allocation';

export type CorrectionInstallment = {
  id: string;
  /** Persisted registration order; null means the historical order is unknown. */
  sequence: number | null;
  date: string;
  createdAt: Date;
  amount: string;
  allocations: Allocation[];
};

function cents(value: string): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 131075 ||
    !/^\d+(?:\.\d{1,2})?$/.test(value)
  )
    throw new Error('Invalid amount');
  const [whole, fractional = ''] = value.split('.');
  const result = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0'));
  if (result <= 0n) throw new Error('Invalid amount');
  return result;
}

/** Pure plan only: callers must lock and validate all persisted facts first. */
export function planGroupCorrection(input: {
  status: 'pending' | 'completed';
  shifts: Shift[];
  installments: CorrectionInstallment[];
  correctedInstallmentId: string;
  correctedAmount: string;
}): {
  replacements: { installmentId: string; allocations: Allocation[] }[];
  status: 'pending' | 'completed';
  total: string;
  paid: string;
  balance: string;
} {
  if (input.status !== 'pending') throw new Error('Group is not pending');
  const shiftBalances = new Map<string, bigint>();
  const shiftDates = new Set<string>();
  for (const shift of input.shifts) {
    const parsed = new Date(`${shift.date}T00:00:00.000Z`);
    if (
      !shift.id ||
      shiftBalances.has(shift.id) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(shift.date) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== shift.date ||
      shiftDates.has(shift.date)
    )
      throw new Error('Invalid shift');
    shiftDates.add(shift.date);
    shiftBalances.set(shift.id, cents(shift.amount));
  }
  if (!shiftBalances.size) throw new Error('Shifts required');
  const seenIds = new Set<string>();
  const seenSequences = new Set<number>();
  for (const installment of input.installments) {
    const date = new Date(`${installment.date}T00:00:00.000Z`);
    if (
      !installment.id ||
      seenIds.has(installment.id) ||
      installment.sequence === null ||
      !Number.isSafeInteger(installment.sequence) ||
      installment.sequence < 1 ||
      seenSequences.has(installment.sequence) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(installment.date) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== installment.date ||
      !(installment.createdAt instanceof Date) ||
      !Number.isFinite(installment.createdAt.getTime())
    )
      throw new Error('Invalid installment');
    seenIds.add(installment.id);
    seenSequences.add(installment.sequence);
    const expected = cents(installment.amount);
    const seenShifts = new Set<string>();
    let applied = 0n;
    for (const allocation of installment.allocations) {
      const remaining = shiftBalances.get(allocation.shiftId);
      if (remaining === undefined || seenShifts.has(allocation.shiftId))
        throw new Error('Invalid allocation');
      seenShifts.add(allocation.shiftId);
      const value = cents(allocation.amount);
      if (value > remaining) throw new Error('Shift overpaid');
      shiftBalances.set(allocation.shiftId, remaining - value);
      applied += value;
    }
    if (applied !== expected) throw new Error('Cash and allocations differ');
  }
  if (![...shiftBalances.values()].some((remaining) => remaining > 0n))
    throw new Error('Pending group already fully paid');
  if (!seenIds.has(input.correctedInstallmentId))
    throw new Error('Installment not found');
  const corrected = cents(input.correctedAmount);
  const original = input.installments.find(
    (item) => item.id === input.correctedInstallmentId,
  )!;
  if (corrected === cents(original.amount)) throw new Error('Amount unchanged');
  // Validation above rejects unknown sequence, so these assertions never invent
  // an ordering for legacy data whose registration order was not persisted.
  const ordered = [...input.installments].sort(
    (a, b) => a.sequence! - b.sequence!,
  );
  const pivot = ordered.findIndex(
    (item) => item.id === input.correctedInstallmentId,
  );
  const applied = ordered.slice(0, pivot).flatMap((item) => item.allocations);
  const planned = ordered.slice(pivot).map((item) => {
    const result = allocateShiftInstallment(
      { status: 'pending', shifts: input.shifts, allocations: applied },
      item.id === input.correctedInstallmentId
        ? input.correctedAmount
        : item.amount,
    );
    applied.push(...result.newAllocations);
    return { installmentId: item.id, result };
  });
  const final = planned[planned.length - 1].result;
  return {
    replacements: planned.map(({ installmentId, result }) => ({
      installmentId,
      allocations: result.newAllocations,
    })),
    status: final.status,
    total: final.total,
    paid: final.paid,
    balance: final.balance,
  };
}
