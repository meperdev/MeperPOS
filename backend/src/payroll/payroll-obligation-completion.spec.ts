import { PaymentMethod } from '@prisma/client';
import {
  PayrollCashCorrection,
  PayrollObligationCompletionFacts,
  PayrollOutflowFact,
  planPayrollObligationCompletion,
} from './payroll-obligation-completion';

const outflow = (
  id: string,
  amount: string,
  date = '2024-03-01',
  method: PaymentMethod = PaymentMethod.CASH,
): PayrollOutflowFact => ({ id, amount, date, method });

const base: PayrollObligationCompletionFacts = {
  total: '5000.00',
  outflows: [outflow('outflow-1', '2000.00')],
  expenseChoice: false,
  completionDate: '2024-03-31',
};

const plan = (overrides: Partial<PayrollObligationCompletionFacts> = {}) =>
  planPayrollObligationCompletion({ ...base, ...overrides });

const expenseOf = (overrides: Partial<PayrollObligationCompletionFacts> = {}) =>
  plan({ expenseChoice: true, ...overrides }).expense;

const paymentsOf = (
  overrides: Partial<PayrollObligationCompletionFacts> = {},
) => {
  const expense = expenseOf(overrides);
  if (expense.kind !== 'create')
    throw new Error(`expected a created expense, received ${expense.kind}`);
  return expense.payments;
};

describe('planPayrollObligationCompletion', () => {
  describe('monetary input', () => {
    it.each<[string, string]>([
      ['abc', 'Invalid monetary amount'],
      ['', 'Invalid monetary amount'],
      ['10.', 'Invalid monetary amount'],
      ['-1.00', 'Invalid monetary amount'],
      ['1e3', 'Invalid monetary amount'],
      ['1.234', 'Invalid monetary amount'],
      ['0', 'Monetary amount out of range'],
      ['0.00', 'Monetary amount out of range'],
      ['9'.repeat(131073) + '.55', 'Monetary amount out of range'],
      ['1'.repeat(131073), 'Monetary amount out of range'],
    ])(
      'rejects %p as "%s" on totals, outflows and corrections',
      (value, message) => {
        const surfaces = [
          () => plan({ total: value }),
          () => plan({ outflows: [outflow('a', value)] }),
          () =>
            plan({
              outflows: [outflow('a', '10.00')],
              corrections: [{ outflowId: 'a', amount: value }],
            }),
        ];
        for (const surface of surfaces) expect(surface).toThrow(message);
      },
    );

    it('rejects a non-string total', () => {
      expect(() => plan({ total: 1 as unknown as string })).toThrow(
        'Invalid monetary amount',
      );
    });

    it('handles the largest accepted input string exactly', () => {
      const huge = `${'9'.repeat(131072)}.55`;
      expect(
        plan({ total: huge, outflows: [outflow('a', huge)] }),
      ).toMatchObject({
        status: 'completed',
        total: huge,
        paid: huge,
        balance: '0.00',
      });
    });

    it('rejects a malformed outflow fact', () => {
      for (const date of ['2023-02-29', '2024-03-01T00:00:00Z']) {
        expect(() => plan({ outflows: [outflow('a', '10.00', date)] })).toThrow(
          'Invalid outflow',
        );
      }
      expect(() =>
        plan({
          outflows: [
            outflow('a', '10.00', '2024-03-01', 'BITCOIN' as PaymentMethod),
          ],
        }),
      ).toThrow('Invalid outflow');
    });

    it('rejects blank or duplicated outflow identities', () => {
      expect(() => plan({ outflows: [outflow('  ', '10.00')] })).toThrow(
        'Invalid outflow',
      );
      expect(() =>
        plan({
          outflows: [
            outflow('a', '10.00'),
            outflow('a', '20.00', '2024-03-02'),
          ],
        }),
      ).toThrow('Invalid outflow');
    });
  });

  describe('exact arithmetic and completion', () => {
    it.each<
      [string, string[], 'pending' | 'completed', string, string, string]
    >([
      ['0.10', ['0.03', '0.03', '0.03'], 'pending', '0.10', '0.09', '0.01'],
      ['0.30', ['0.10', '0.20'], 'completed', '0.30', '0.30', '0.00'],
      ['5000', ['2500.5'], 'pending', '5000.00', '2500.50', '2499.50'],
    ])(
      'totals %p from %p without drift',
      (total, amounts, status, expectedTotal, paid, balance) => {
        expect(
          plan({
            total,
            outflows: amounts.map((amount, index) =>
              outflow(`o${index}`, amount),
            ),
          }),
        ).toMatchObject({ status, total: expectedTotal, paid, balance });
      },
    );

    it('rejects an overpayment like the existing payroll writers', () => {
      expect(() =>
        plan({ total: '80.00', outflows: [outflow('a', '100.00')] }),
      ).toThrow('Paid amount exceeds obligation total');
    });
  });

  describe('fact collections', () => {
    it('treats an empty outflow list as nothing paid yet', () => {
      expect(plan({ outflows: [] })).toMatchObject({
        status: 'pending',
        total: '5000.00',
        paid: '0.00',
        balance: '5000.00',
        outflows: [],
        expense: { kind: 'disabled' },
      });
    });

    it.each([undefined, null, 'outflows', {}, 7])(
      'rejects a missing or malformed outflow collection %p',
      (outflows) => {
        expect(() =>
          plan({ outflows: outflows as unknown as PayrollOutflowFact[] }),
        ).toThrow('Invalid completion facts');
      },
    );

    it.each([null, 'corrections', {}, 7])(
      'rejects a malformed correction collection %p',
      (corrections) => {
        expect(() =>
          plan({
            outflows: [outflow('a', '10.00')],
            corrections: corrections as unknown as PayrollCashCorrection[],
          }),
        ).toThrow('Invalid correction');
      },
    );
  });

  describe('cash identity', () => {
    it('keeps distinct same-date outflows as separate cash facts', () => {
      const result = plan({
        total: '30.00',
        outflows: [
          outflow('a', '10.00', '2024-03-05'),
          outflow('b', '20.00', '2024-03-05'),
        ],
      });
      expect(result.outflows).toEqual([
        {
          id: 'a',
          amount: '10.00',
          date: '2024-03-05',
          method: PaymentMethod.CASH,
          corrected: false,
        },
        {
          id: 'b',
          amount: '20.00',
          date: '2024-03-05',
          method: PaymentMethod.CASH,
          corrected: false,
        },
      ]);
      expect(result).toMatchObject({ status: 'completed', paid: '30.00' });
    });

    it('never dedupes equal-valued outflows', () => {
      expect(
        paymentsOf({
          total: '20.00',
          outflows: [outflow('a', '10.00'), outflow('b', '10.00')],
        }).map((payment) => payment.outflowId),
      ).toEqual(['a', 'b']);
    });

    it('preserves caller order', () => {
      expect(
        plan({
          outflows: [
            outflow('later', '10.00', '2024-03-10'),
            outflow('earlier', '20.00', '2024-03-01'),
          ],
        }).outflows.map((item) => item.id),
      ).toEqual(['later', 'earlier']);
    });
  });

  describe('corrections', () => {
    const sameDate = [
      outflow('a', '10.00', '2024-03-05'),
      outflow('b', '10.00', '2024-03-05'),
    ];

    it('replaces only the identified outflow', () => {
      const result = plan({
        total: '30.00',
        outflows: sameDate,
        corrections: [{ outflowId: 'b', amount: '20.00' }],
      });
      expect(result).toMatchObject({ status: 'completed', paid: '30.00' });
      expect(
        result.outflows.map(({ id, amount, corrected }) => ({
          id,
          amount,
          corrected,
        })),
      ).toEqual([
        { id: 'a', amount: '10.00', corrected: false },
        { id: 'b', amount: '20.00', corrected: true },
      ]);
    });

    it('rejects a correction that pushes cash past the total', () => {
      expect(() =>
        plan({
          total: '30.00',
          outflows: sameDate,
          corrections: [{ outflowId: 'b', amount: '30.00' }],
        }),
      ).toThrow('Paid amount exceeds obligation total');
    });

    it('applies downward corrections without mutating its inputs', () => {
      const outflows = sameDate.map((item) => ({ ...item }));
      const corrections = [{ outflowId: 'a', amount: '5.00' }];
      expect(plan({ total: '30.00', outflows, corrections })).toMatchObject({
        status: 'pending',
        paid: '15.00',
      });
      expect(outflows[0].amount).toBe('10.00');
      expect(corrections[0].amount).toBe('5.00');
    });

    it('rejects foreign or ambiguous correction keys', () => {
      expect(() =>
        plan({
          outflows: sameDate,
          corrections: [{ outflowId: 'missing', amount: '20.00' }],
        }),
      ).toThrow('Invalid correction');
      expect(() =>
        plan({
          outflows: sameDate,
          corrections: [
            { outflowId: 'a', amount: '20.00' },
            { outflowId: 'a', amount: '30.00' },
          ],
        }),
      ).toThrow('Invalid correction');
    });
  });

  describe('expense choice', () => {
    it.each([undefined, 'true'])(
      'rejects an unstated or non-boolean choice %p',
      (choice) => {
        expect(() =>
          plan({ expenseChoice: choice as unknown as boolean }),
        ).toThrow('Invalid expense choice');
      },
    );

    it.each(['5000.00', '2000.00'])(
      'reports an unknown choice as unknown, never as disabled (total %p)',
      (total) => {
        expect(plan({ total, expenseChoice: null }).expense).toEqual({
          kind: 'unknown_choice',
        });
      },
    );

    it('reports a disabled pending choice as disabled, not awaiting completion', () => {
      expect(plan({ expenseChoice: false }).expense).toEqual({
        kind: 'disabled',
      });
    });

    it('reports a disabled choice after completion without validating dates', () => {
      expect(
        plan({
          total: '2000.00',
          expenseChoice: false,
          completionDate: '2024-02-30',
          selectedExpenseDate: 'not-a-date',
        }).expense,
      ).toEqual({ kind: 'disabled' });
    });

    it('waits for completion before planning an enabled expense', () => {
      expect(
        plan({
          expenseChoice: true,
          completionDate: '',
          selectedExpenseDate: '',
        }).expense,
      ).toEqual({ kind: 'awaiting_completion' });
    });

    it('makes no representability claim for an unknown choice', () => {
      expect(
        plan({ total: '10000000000.00', expenseChoice: null }).expense,
      ).toEqual({ kind: 'unknown_choice' });
    });
  });

  describe('candidate expense', () => {
    it('defaults the expense date to the completion date', () => {
      expect(expenseOf({ total: '2000.00' })).toEqual({
        kind: 'create',
        date: '2024-03-31',
        total: '2000.00',
        payments: [
          {
            outflowId: 'outflow-1',
            amount: '2000.00',
            date: '2024-03-01',
            method: PaymentMethod.CASH,
          },
        ],
      });
    });

    it.each<[string | null, string]>([
      ['2024-04-15', '2024-04-15'],
      [null, '2024-03-31'],
    ])('uses %p as the expense date', (selected, expected) => {
      expect(
        expenseOf({ total: '2000.00', selectedExpenseDate: selected }),
      ).toMatchObject({ date: expected });
    });

    it.each(['2023-02-29', '2024-04-31', ''])(
      'rejects the invalid effective expense date %p',
      (selected) => {
        expect(() =>
          expenseOf({ total: '2000.00', selectedExpenseDate: selected }),
        ).toThrow('Invalid expense date');
      },
    );

    it('mirrors every outflow date, method and corrected amount', () => {
      expect(
        expenseOf({
          total: '100.00',
          outflows: [
            outflow('a', '40.00', '2024-02-01'),
            outflow('b', '60.00', '2024-03-02', PaymentMethod.TRANSFER),
          ],
        }),
      ).toEqual({
        kind: 'create',
        date: '2024-03-31',
        total: '100.00',
        payments: [
          {
            outflowId: 'a',
            amount: '40.00',
            date: '2024-02-01',
            method: PaymentMethod.CASH,
          },
          {
            outflowId: 'b',
            amount: '60.00',
            date: '2024-03-02',
            method: PaymentMethod.TRANSFER,
          },
        ],
      });
      expect(
        paymentsOf({
          total: '30.00',
          outflows: [
            outflow('a', '10.00', '2024-03-05'),
            outflow('b', '10.00', '2024-03-05'),
          ],
          corrections: [{ outflowId: 'b', amount: '20.00' }],
        }).map((payment) => payment.amount),
      ).toEqual(['10.00', '20.00']);
    });
  });

  describe('Decimal(12,2) representability', () => {
    it('creates an expense exactly at the boundary', () => {
      expect(
        expenseOf({
          total: '9999999999.99',
          outflows: [outflow('a', '9999999999.99')],
        }),
      ).toMatchObject({ kind: 'create', total: '9999999999.99' });
    });

    it.each<[string, string[]]>([
      ['10000000000.00', ['10000000000.00']],
      ['12000000000.00', ['6000000000.00', '6000000000.00']],
    ])('reports %p as unrepresentable without rounding', (total, amounts) => {
      expect(
        expenseOf({
          total,
          outflows: amounts.map((amount, index) =>
            outflow(`o${index}`, amount),
          ),
        }),
      ).toEqual({
        kind: 'unrepresentable',
        date: '2024-03-31',
        total,
        payments: amounts.map((amount, index) => ({
          outflowId: `o${index}`,
          amount,
          date: '2024-03-01',
          method: PaymentMethod.CASH,
        })),
      });
    });

    it('keeps an unrepresentable payroll total classified and intact', () => {
      expect(
        plan({
          total: '999999999999.00',
          outflows: [outflow('a', '999999999999.00')],
        }),
      ).toMatchObject({
        status: 'completed',
        total: '999999999999.00',
        paid: '999999999999.00',
        balance: '0.00',
      });
    });
  });
});
