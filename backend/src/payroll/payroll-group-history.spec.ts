import { Prisma } from '@prisma/client';
import { validatePayrollGroupHistory } from './payroll-group-history';

const money = (value: string) => new Prisma.Decimal(value);
function fixture() {
  return {
    before: [
      { id: 'm1', shiftId: 's1' },
      { id: 'm2', shiftId: 's2' },
    ],
    obligationId: 'group',
    memberships: [
      {
        id: 'm1',
        shiftId: 's1',
        releasedAt: null as Date | null,
        shift: { id: 's1', amount: money('10') },
      },
      {
        id: 'm2',
        shiftId: 's2',
        releasedAt: null as Date | null,
        shift: { id: 's2', amount: money('20') },
      },
    ],
    allMemberships: [
      {
        id: 'm1',
        shiftId: 's1',
        obligationId: 'group',
        releasedAt: null as Date | null,
        allocations: [] as { id: string }[],
      },
      {
        id: 'm2',
        shiftId: 's2',
        obligationId: 'group',
        releasedAt: null as Date | null,
        allocations: [] as { id: string }[],
      },
    ],
    installments: [
      {
        outflowId: 'cash',
        outflow: {
          id: 'cash',
          amount: money('5'),
          _count: { installments: 1 },
        },
        allocations: [
          {
            membershipId: 'm1',
            amount: money('5'),
            voids: [] as { id: string }[],
          },
        ],
      },
    ],
  };
}

describe('validatePayrollGroupHistory (pure snapshot validation)', () => {
  it('returns existing applications unchanged without modifying its input', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    expect(validatePayrollGroupHistory(input)).toEqual([
      { shiftId: 's1', amount: '5.00' },
    ]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('accepts a prior released membership without applications', () => {
    const input = fixture();
    input.allMemberships.push({
      id: 'old',
      shiftId: 's1',
      obligationId: 'old',
      releasedAt: new Date(),
      allocations: [],
    });
    expect(validatePayrollGroupHistory(input)).toEqual([
      { shiftId: 's1', amount: '5.00' },
    ]);
  });
  it('rejects a released membership even when its evidence is voided', () => {
    const input = fixture();
    const voided = { id: 'a', voids: [{ id: 'v' }] };
    input.allMemberships.push({
      id: 'old',
      shiftId: 's1',
      obligationId: 'old',
      releasedAt: new Date(),
      allocations: [voided],
    });
    expect(() => validatePayrollGroupHistory(input)).toThrow(
      'Historial de grupo inconsistente',
    );
  });
  it.each([
    'current-release',
    'duplicate-active',
    'foreign-active',
    'changed',
    'different-shift',
  ] as const)('rejects inconsistent membership snapshot: %s', (kind) => {
    const input = fixture();
    if (kind === 'current-release')
      input.memberships[0].releasedAt = new Date();
    if (kind === 'duplicate-active')
      input.allMemberships.push({
        ...input.allMemberships[0],
        id: 'duplicate',
      });
    if (kind === 'foreign-active')
      input.allMemberships[0].obligationId = 'other';
    if (kind === 'changed') input.before[0].shiftId = 'other';
    if (kind === 'different-shift') input.memberships[0].shift.id = 'other';
    expect(() => validatePayrollGroupHistory(input)).toThrow(
      'Historial de grupo inconsistente',
    );
  });
  it.each(['0', '-1', '1.001', '10000000000', 'NaN'])(
    'rejects invalid shift amount %s',
    (amount) => {
      const input = fixture();
      input.memberships[0].shift.amount = money(amount);
      expect(() => validatePayrollGroupHistory(input)).toThrow(
        'Historial de abonos inconsistente',
      );
    },
  );
  it.each(['shared', 'duplicate', 'identity'] as const)(
    'rejects %s cash identity',
    (kind) => {
      const input = fixture();
      if (kind === 'shared')
        input.installments[0].outflow._count.installments = 2;
      if (kind === 'identity') input.installments[0].outflow.id = 'different';
      if (kind === 'duplicate') input.installments.push(input.installments[0]);
      expect(() => validatePayrollGroupHistory(input)).toThrow(
        'Abono compartido o inconsistente',
      );
    },
  );
  it.each(['unknown', 'duplicate'] as const)(
    'rejects %s application',
    (kind) => {
      const input = fixture();
      const allocation = input.installments[0].allocations[0];
      if (kind === 'unknown') allocation.membershipId = 'unknown';
      if (kind === 'duplicate') {
        input.installments[0].outflow.amount = money('10');
        input.installments[0].allocations.push({ ...allocation });
      }
      expect(() => validatePayrollGroupHistory(input)).toThrow(
        'Aplicación inconsistente',
      );
    },
  );
  it('accounts for a superseded allocation through its successor', () => {
    const input = fixture();
    input.installments[0].outflow.amount = money('10');
    input.installments[0].allocations = [
      { membershipId: 'm1', amount: money('4'), voids: [{ id: 'v1' }] },
      { membershipId: 'm1', amount: money('10'), voids: [] },
    ];
    expect(validatePayrollGroupHistory(input)).toEqual([
      { shiftId: 's1', amount: '10.00' },
    ]);
  });
  it('accepts allocations superseded more than once', () => {
    const input = fixture();
    input.installments[0].allocations = [
      { membershipId: 'm1', amount: money('1'), voids: [{ id: 'v1' }] },
      { membershipId: 'm1', amount: money('2'), voids: [{ id: 'v2' }] },
      { membershipId: 'm1', amount: money('5'), voids: [] },
    ];
    expect(validatePayrollGroupHistory(input)).toEqual([
      { shiftId: 's1', amount: '5.00' },
    ]);
  });
  it('excludes a superseded shift from the effective plan', () => {
    const input = fixture();
    input.installments[0].outflow.amount = money('4');
    input.installments[0].allocations = [
      { membershipId: 'm1', amount: money('1'), voids: [{ id: 'v' }] },
      { membershipId: 'm2', amount: money('4'), voids: [] },
    ];
    expect(validatePayrollGroupHistory(input)).toEqual([
      { shiftId: 's2', amount: '4.00' },
    ]);
  });
  it('keeps superseded evidence isolated per installment', () => {
    const input = fixture();
    input.installments.push({
      outflowId: 'cash2',
      outflow: {
        id: 'cash2',
        amount: money('15'),
        _count: { installments: 1 },
      },
      allocations: [
        { membershipId: 'm2', amount: money('7'), voids: [{ id: 'v' }] },
        { membershipId: 'm2', amount: money('15'), voids: [] },
      ],
    });
    expect(validatePayrollGroupHistory(input)).toEqual([
      { shiftId: 's1', amount: '5.00' },
      { shiftId: 's2', amount: '15.00' },
    ]);
  });
  it('rejects a fully superseded installment against its cash', () => {
    const input = fixture();
    input.installments[0].allocations[0].voids.push({ id: 'v' });
    expect(() => validatePayrollGroupHistory(input)).toThrow(
      'Abono y aplicaciones no coinciden',
    );
  });
  it('rejects ambiguous superseded evidence', () => {
    const input = fixture();
    const allocation = input.installments[0].allocations[0];
    allocation.voids.push({ id: 'v1' }, { id: 'v2' });
    expect(() => validatePayrollGroupHistory(input)).toThrow(
      'Aplicación inconsistente',
    );
  });
  it('rejects a superseded allocation for an unknown membership', () => {
    const input = fixture();
    const allocation = input.installments[0].allocations[0];
    allocation.membershipId = 'unknown';
    allocation.voids.push({ id: 'v' });
    expect(() => validatePayrollGroupHistory(input)).toThrow(
      'Aplicación inconsistente',
    );
  });
  it.each(['0', '-1', '1.001', '10000000000', 'NaN'])(
    'rejects invalid superseded application amount %s',
    (amount) => {
      const input = fixture();
      const allocation = input.installments[0].allocations[0];
      allocation.amount = money(amount);
      allocation.voids.push({ id: 'v' });
      expect(() => validatePayrollGroupHistory(input)).toThrow(
        'Historial de abonos inconsistente',
      );
    },
  );
  it('rejects a duplicated effective application beside superseded ones', () => {
    const input = fixture();
    input.installments[0].outflow.amount = money('6');
    input.installments[0].allocations = [
      { membershipId: 'm1', amount: money('2'), voids: [{ id: 'v' }] },
      { membershipId: 'm1', amount: money('3'), voids: [] },
      { membershipId: 'm1', amount: money('3'), voids: [] },
    ];
    expect(() => validatePayrollGroupHistory(input)).toThrow(
      'Aplicación inconsistente',
    );
  });
  it('does not mutate superseded evidence', () => {
    const input = fixture();
    input.installments[0].outflow.amount = money('5');
    input.installments[0].allocations = [
      { membershipId: 'm1', amount: money('4'), voids: [{ id: 'v' }] },
      { membershipId: 'm1', amount: money('5'), voids: [] },
    ];
    const before = JSON.stringify(input);
    validatePayrollGroupHistory(input);
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each([
    ['4', 'Aplicación excede abono'],
    ['6', 'Abono y aplicaciones no coinciden'],
  ])('rejects mismatch against cash %s', (cash, message) => {
    const input = fixture();
    input.installments[0].outflow.amount = money(cash);
    expect(() => validatePayrollGroupHistory(input)).toThrow(message);
  });
  it('preserves check precedence for released history before shared cash', () => {
    const input = fixture();
    input.allMemberships.push({
      id: 'old',
      shiftId: 's1',
      obligationId: 'old',
      releasedAt: new Date(),
      allocations: [{ id: 'a' }],
    });
    input.installments[0].outflow._count.installments = 2;
    expect(() => validatePayrollGroupHistory(input)).toThrow(
      'Historial de grupo inconsistente',
    );
  });
});
