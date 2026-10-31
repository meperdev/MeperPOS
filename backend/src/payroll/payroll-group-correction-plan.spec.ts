import {
  planGroupCorrection,
  type CorrectionInstallment,
} from './payroll-group-correction-plan';

const shifts = [
  { id: 's1', date: '2026-01-01', amount: '100.00' },
  { id: 's2', date: '2026-01-02', amount: '100.00' },
];
const installments: CorrectionInstallment[] = [
  {
    id: 'first',
    sequence: 1,
    date: '2026-02-01',
    createdAt: new Date('2026-02-01T12:00:00Z'),
    amount: '40.00',
    allocations: [{ shiftId: 's1', amount: '40.00' }],
  },
  {
    id: 'target',
    sequence: 2,
    date: '2026-02-02',
    createdAt: new Date('2026-02-02T12:00:00Z'),
    amount: '40.00',
    allocations: [{ shiftId: 's1', amount: '40.00' }],
  },
  {
    id: 'later',
    sequence: 3,
    date: '2026-02-03',
    createdAt: new Date('2026-02-03T12:00:00Z'),
    amount: '40.00',
    allocations: [
      { shiftId: 's1', amount: '20.00' },
      { shiftId: 's2', amount: '20.00' },
    ],
  },
];

describe('planGroupCorrection', () => {
  it('uses registration order when a later installment is backdated', () => {
    const recorded = installments.map((item, index) => ({
      ...item,
      sequence: index + 1,
      date: item.id === 'later' ? '2026-02-01' : item.date,
    }));
    expect(
      planGroupCorrection({
        status: 'pending',
        shifts,
        installments: recorded,
        correctedInstallmentId: 'target',
        correctedAmount: '20.00',
      }).replacements.map((entry) => entry.installmentId),
    ).toEqual(['target', 'later']);
  });

  it('preserves earlier applications and recalculates the target and later installments', () => {
    expect(
      planGroupCorrection({
        status: 'pending',
        shifts,
        installments,
        correctedInstallmentId: 'target',
        correctedAmount: '20.00',
      }).replacements,
    ).toEqual([
      {
        installmentId: 'target',
        allocations: [{ shiftId: 's1', amount: '20.00' }],
      },
      {
        installmentId: 'later',
        allocations: [{ shiftId: 's1', amount: '40.00' }],
      },
    ]);
    expect(installments[1].allocations).toEqual([
      { shiftId: 's1', amount: '40.00' },
    ]);
  });

  it('rejects a corrected amount that exceeds the total once later cash is included', () => {
    expect(() =>
      planGroupCorrection({
        status: 'pending',
        shifts,
        installments,
        correctedInstallmentId: 'target',
        correctedAmount: '130.00',
      }),
    ).toThrow();
  });

  it('uses registration sequence to order installments on the same date', () => {
    const sameDay: CorrectionInstallment[] = [
      {
        id: 'b',
        sequence: 2,
        date: '2026-02-01',
        createdAt: new Date('2026-02-01T12:00:00Z'),
        amount: '40.00',
        allocations: [{ shiftId: 's1', amount: '40.00' }],
      },
      {
        id: 'a',
        sequence: 1,
        date: '2026-02-01',
        createdAt: new Date('2026-02-01T12:00:00Z'),
        amount: '40.00',
        allocations: [{ shiftId: 's1', amount: '40.00' }],
      },
    ];
    expect(
      planGroupCorrection({
        status: 'pending',
        shifts,
        installments: sameDay,
        correctedInstallmentId: 'a',
        correctedAmount: '20.00',
      }).replacements,
    ).toEqual([
      { installmentId: 'a', allocations: [{ shiftId: 's1', amount: '20.00' }] },
      { installmentId: 'b', allocations: [{ shiftId: 's1', amount: '40.00' }] },
    ]);
  });

  it.each(['0', '-1', '1.001', 'bad'])(
    'rejects invalid corrected amount %s',
    (correctedAmount) => {
      expect(() =>
        planGroupCorrection({
          status: 'pending',
          shifts,
          installments,
          correctedInstallmentId: 'target',
          correctedAmount,
        }),
      ).toThrow();
    },
  );

  it.each([null, 1])(
    'rejects unknown or duplicate registration order %s',
    (sequence) => {
      const invalid = installments.map((item) =>
        item.id === 'target' ? { ...item, sequence } : item,
      );
      expect(() =>
        planGroupCorrection({
          status: 'pending',
          shifts,
          installments: invalid,
          correctedInstallmentId: 'target',
          correctedAmount: '20.00',
        }),
      ).toThrow();
    },
  );

  it('reports exact completion for the revised cash total', () => {
    const result = planGroupCorrection({
      status: 'pending',
      shifts,
      installments,
      correctedInstallmentId: 'target',
      correctedAmount: '120.00',
    });
    expect(result).toMatchObject({
      status: 'completed',
      total: '200.00',
      paid: '200.00',
      balance: '0.00',
    });
  });

  it('rejects an unchanged corrected amount', () => {
    expect(() =>
      planGroupCorrection({
        status: 'pending',
        shifts,
        installments,
        correctedInstallmentId: 'target',
        correctedAmount: '40.00',
      }),
    ).toThrow();
  });

  it('rejects a pending group whose historical cash already covers all shifts', () => {
    const fullyPaid: CorrectionInstallment[] = [
      {
        ...installments[0],
        amount: '100.00',
        allocations: [{ shiftId: 's1', amount: '100.00' }],
      },
      {
        ...installments[1],
        amount: '100.00',
        allocations: [{ shiftId: 's2', amount: '100.00' }],
      },
    ];
    expect(() =>
      planGroupCorrection({
        status: 'pending',
        shifts,
        installments: fullyPaid,
        correctedInstallmentId: 'target',
        correctedAmount: '50.00',
      }),
    ).toThrow();
  });

  it('rejects corrections to completed groups', () => {
    const request = {
      shifts,
      installments,
      status: 'completed' as const,
      correctedInstallmentId: 'target',
      correctedAmount: '20.00',
    };
    expect(() => planGroupCorrection(request)).toThrow();
  });

  it('rejects an unknown corrected installment', () => {
    expect(() =>
      planGroupCorrection({
        status: 'pending',
        shifts,
        installments,
        correctedInstallmentId: 'missing',
        correctedAmount: '20.00',
      }),
    ).toThrow();
  });

  it('rejects inconsistent historical cash instead of inventing an allocation', () => {
    const invalid = installments.map((item) =>
      item.id === 'first' ? { ...item, amount: '41.00' } : item,
    );
    expect(() =>
      planGroupCorrection({
        status: 'pending',
        shifts,
        installments: invalid,
        correctedInstallmentId: 'target',
        correctedAmount: '20.00',
      }),
    ).toThrow();
  });
});
