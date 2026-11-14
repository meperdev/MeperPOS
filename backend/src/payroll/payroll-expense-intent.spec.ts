import {
  payrollExpenseIntent,
  PayrollExpenseFacts,
} from './payroll-expense-intent';

describe('payrollExpenseIntent', () => {
  const facts: PayrollExpenseFacts = {
    paymentComplete: true,
    expenseEnabled: true,
    completionDate: '2024-03-01',
  };

  it.each([
    [false, false],
    [false, true],
    [true, false],
  ])(
    'does not create an intent when complete=%s and enabled=%s',
    (paymentComplete, expenseEnabled) => {
      expect(
        payrollExpenseIntent({ ...facts, paymentComplete, expenseEnabled }),
      ).toBeNull();
    },
  );

  it('defaults to the completion date for an enabled completed payment', () => {
    expect(payrollExpenseIntent(facts)).toEqual({ expenseDate: '2024-03-01' });
  });

  it('uses the selected expense date instead of the completion date', () => {
    expect(
      payrollExpenseIntent({ ...facts, selectedExpenseDate: '2024-02-29' }),
    ).toEqual({
      expenseDate: '2024-02-29',
    });
  });

  it.each([
    '2023-02-29',
    '2024-04-31',
    '2024-13-01',
    '2024-1-01',
    '2024-03-01T00:00:00Z',
    '',
    '0000-01-01',
  ])('rejects invalid effective date %s', (date) => {
    expect(() =>
      payrollExpenseIntent({ ...facts, completionDate: date }),
    ).toThrow();
    expect(() =>
      payrollExpenseIntent({ ...facts, selectedExpenseDate: date }),
    ).toThrow();
  });

  it('does not require dates when no intent is produced', () => {
    expect(
      payrollExpenseIntent({
        ...facts,
        paymentComplete: false,
        completionDate: '',
        selectedExpenseDate: '',
      }),
    ).toBeNull();
  });
});
