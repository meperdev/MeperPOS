export interface PayrollExpenseFacts {
  paymentComplete: boolean;
  expenseEnabled: boolean;
  completionDate: string;
  selectedExpenseDate?: string;
}

export interface PayrollExpenseIntent {
  expenseDate: string;
}

// The caller supplies completion and authorization facts; this function verifies neither.
export function payrollExpenseIntent(
  facts: PayrollExpenseFacts,
): PayrollExpenseIntent | null {
  if (!facts.paymentComplete || !facts.expenseEnabled) return null;

  const expenseDate = facts.selectedExpenseDate ?? facts.completionDate;
  if (!isDateOnly(expenseDate)) throw new Error('Invalid expense date');
  return { expenseDate };
}

function isDateOnly(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === 0 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}
