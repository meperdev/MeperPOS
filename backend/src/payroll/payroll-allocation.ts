import { Prisma } from '@prisma/client';

type Status = 'pending' | 'completed';
export type Shift = { id: string; date: string; amount: string };
export type Allocation = { shiftId: string; amount: string };
export type ShiftGroup = {
  status: Status;
  shifts: Shift[];
  allocations: Allocation[];
};
type ShiftBalance = Shift & { paid: string; balance: string };
type GroupBalance = {
  status: Status;
  shifts: ShiftBalance[];
  allocations: Allocation[];
  total: string;
  paid: string;
  balance: string;
};
type Period = { status: Status; total: string; paid: string };

// Match the existing payroll shift Decimal(12,2) storage boundary. Strings
// only: accepting JS numbers would silently accept already-rounded values.
const max = new Prisma.Decimal('9999999999.99');
const zero = new Prisma.Decimal(0);
function money(value: string, positive = false): Prisma.Decimal {
  if (typeof value !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value))
    throw new Error('Invalid monetary amount');
  const result = new Prisma.Decimal(value);
  if (result.gt(max) || (positive && result.isZero()))
    throw new Error('Monetary amount out of range');
  return result;
}
function text(value: Prisma.Decimal): string {
  return value.toFixed(2);
}
function pending(status: Status): void {
  if (status !== 'pending') throw new Error('Group or period is not pending');
}
function validDate(date: string): boolean {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return false;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
  );
}

// Existing allocations are facts, not a history to recompute. Only the new
// installment is distributed; caller owns installment identity and persistence.
function summarize(group: ShiftGroup): GroupBalance {
  pending(group.status);
  const ids = new Set<string>();
  const dates = new Set<string>();
  const paidById = new Map<string, Prisma.Decimal>();
  let total = zero;
  for (const shift of group.shifts) {
    if (
      typeof shift.id !== 'string' ||
      !shift.id.trim() ||
      ids.has(shift.id) ||
      !validDate(shift.date) ||
      dates.has(shift.date)
    )
      throw new Error('Invalid or duplicate shift');
    ids.add(shift.id);
    dates.add(shift.date);
    total = total.plus(money(shift.amount, true));
    paidById.set(shift.id, zero);
  }
  for (const allocation of group.allocations) {
    const previous = paidById.get(allocation.shiftId);
    if (!previous) throw new Error('Allocation references an unselected shift');
    paidById.set(
      allocation.shiftId,
      previous.plus(money(allocation.amount, true)),
    );
  }
  let paid = zero;
  const shifts = [...group.shifts]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((shift) => {
      const amount = money(shift.amount);
      const shiftPaid = paidById.get(shift.id)!;
      if (shiftPaid.gt(amount)) throw new Error('Shift overpaid');
      paid = paid.plus(shiftPaid);
      return {
        ...shift,
        amount: text(amount),
        paid: text(shiftPaid),
        balance: text(amount.minus(shiftPaid)),
      };
    });
  return {
    status: 'pending',
    shifts,
    allocations: group.allocations.map((a) => ({ ...a })),
    total: text(total),
    paid: text(paid),
    balance: text(total.minus(paid)),
  };
}

export function allocateShiftInstallment(
  group: ShiftGroup,
  amount: string,
): GroupBalance & { newAllocations: Allocation[] } {
  const summary = summarize(group);
  let remaining = money(amount, true);
  if (remaining.gt(new Prisma.Decimal(summary.balance)))
    throw new Error('Installment exceeds balance');
  const newAllocations: Allocation[] = [];
  for (const shift of summary.shifts) {
    const balance = money(shift.balance);
    const allocated = Prisma.Decimal.min(remaining, balance);
    if (allocated.gt(zero)) {
      newAllocations.push({ shiftId: shift.id, amount: text(allocated) });
      remaining = remaining.minus(allocated);
    }
  }
  const updated = summarize({
    ...group,
    allocations: [...group.allocations, ...newAllocations],
  });
  return {
    ...updated,
    status: new Prisma.Decimal(updated.balance).isZero()
      ? 'completed'
      : 'pending',
    newAllocations,
  };
}

export function appendShifts(group: ShiftGroup, shifts: Shift[]): GroupBalance {
  const current = summarize(group);
  if (shifts.length === 0 || current.shifts.length === 0)
    throw new Error('Shifts required');
  const lastDate = current.shifts[current.shifts.length - 1].date;
  if (shifts.some((shift) => !validDate(shift.date) || shift.date <= lastDate))
    throw new Error('Appended shifts must be later');
  return summarize({ ...group, shifts: [...group.shifts, ...shifts] });
}

export function allocatePeriodInstallment(
  period: Period,
  amount: string,
): Period & { balance: string } {
  pending(period.status);
  const total = money(period.total, true);
  const paid = money(period.paid);
  const installment = money(amount, true);
  if (paid.gte(total) || installment.gt(total.minus(paid)))
    throw new Error('Installment exceeds balance');
  const nextPaid = paid.plus(installment);
  const balance = total.minus(nextPaid);
  return {
    status: balance.isZero() ? 'completed' : 'pending',
    total: text(total),
    paid: text(nextPaid),
    balance: text(balance),
  };
}
