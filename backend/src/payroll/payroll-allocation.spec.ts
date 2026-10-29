import {
  allocateShiftInstallment,
  appendShifts,
  allocatePeriodInstallment,
  ShiftGroup,
} from './payroll-allocation';

const group = (): ShiftGroup => ({
  status: 'pending',
  shifts: [
    { id: 'b', date: '2026-03-02', amount: '20.10' },
    { id: 'a', date: '2026-03-01', amount: '10.20' },
  ],
  allocations: [{ shiftId: 'a', amount: '3.10' }],
});

describe('payroll allocation', () => {
  it('allocates oldest outstanding shifts exactly without changing earlier allocations or inputs', () => {
    const input = group();
    const before = JSON.stringify(input);
    const result = allocateShiftInstallment(input, '10.25');
    expect(result.newAllocations).toEqual([
      { shiftId: 'a', amount: '7.10' },
      { shiftId: 'b', amount: '3.15' },
    ]);
    expect(result.allocations).toEqual([
      ...input.allocations,
      ...result.newAllocations,
    ]);
    expect(result.shifts).toEqual([
      {
        id: 'a',
        date: '2026-03-01',
        amount: '10.20',
        paid: '10.20',
        balance: '0.00',
      },
      {
        id: 'b',
        date: '2026-03-02',
        amount: '20.10',
        paid: '3.15',
        balance: '16.95',
      },
    ]);
    expect(result).toMatchObject({
      total: '30.30',
      paid: '13.35',
      balance: '16.95',
      status: 'pending',
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('completes exactly and rejects overpayment and further changes', () => {
    const completed = allocateShiftInstallment(group(), '27.20');
    expect(completed).toMatchObject({ status: 'completed', balance: '0.00' });
    expect(() => allocateShiftInstallment(group(), '27.21')).toThrow();
    expect(() =>
      allocateShiftInstallment({ ...group(), status: 'completed' }, '1'),
    ).toThrow();
    expect(() =>
      appendShifts({ ...group(), status: 'completed' }, [
        { id: 'c', date: '2026-03-03', amount: '1' },
      ]),
    ).toThrow();
  });

  it('appends only later shifts without redistributing previous installments', () => {
    const input = group();
    const before = JSON.stringify(input);
    const result = appendShifts(input, [
      { id: 'c', date: '2026-03-04', amount: '0.09' },
    ]);
    expect(result).toMatchObject({
      total: '30.39',
      paid: '3.10',
      balance: '27.29',
      allocations: input.allocations,
    });
    expect(result.shifts[0]).toMatchObject({
      id: 'a',
      paid: '3.10',
      balance: '7.10',
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(() =>
      appendShifts(input, [{ id: 'c', date: '2026-03-02', amount: '1' }]),
    ).toThrow();
    expect(() =>
      appendShifts(input, [{ id: 'a', date: '2026-03-03', amount: '1' }]),
    ).toThrow();
  });

  it('rejects invalid money, dates, duplicate shifts and inconsistent allocations', () => {
    for (const amount of ['0', '-1', '0.001', '1e2', 'NaN', '99999999999.00']) {
      expect(() => allocateShiftInstallment(group(), amount)).toThrow();
    }
    expect(() =>
      allocateShiftInstallment(group(), 0.1 as unknown as string),
    ).toThrow();
    expect(() =>
      allocateShiftInstallment(
        { ...group(), allocations: [{ shiftId: 'a', amount: '10.21' }] },
        '1',
      ),
    ).toThrow();
    expect(() =>
      allocateShiftInstallment(
        { ...group(), allocations: [{ shiftId: 'missing', amount: '1' }] },
        '1',
      ),
    ).toThrow();
    expect(() =>
      allocateShiftInstallment(
        { ...group(), shifts: [{ id: 'a', date: '2026-02-30', amount: '1' }] },
        '1',
      ),
    ).toThrow();
    expect(() =>
      allocateShiftInstallment(
        { ...group(), shifts: [group().shifts[0], group().shifts[0]] },
        '1',
      ),
    ).toThrow();
  });

  it('retains historical allocations even when they favored a later shift', () => {
    const input = {
      ...group(),
      allocations: [{ shiftId: 'b', amount: '5.00' }],
    };
    const result = allocateShiftInstallment(input, '1.00');
    expect(result.allocations).toEqual([
      { shiftId: 'b', amount: '5.00' },
      { shiftId: 'a', amount: '1.00' },
    ]);
    expect(result).toMatchObject({ paid: '6.00', balance: '24.30' });
  });

  it('enforces exact storage boundaries and calendar dates', () => {
    const input: ShiftGroup = {
      status: 'pending',
      shifts: [{ id: 'a', date: '2024-02-29', amount: '9999999999.99' }],
      allocations: [],
    };
    expect(allocateShiftInstallment(input, '0.01').balance).toBe(
      '9999999999.98',
    );
    expect(
      appendShifts(input, [{ id: 'b', date: '2024-03-01', amount: '0.01' }]),
    ).toMatchObject({ total: '10000000000.00', balance: '10000000000.00' });
    expect(() =>
      allocateShiftInstallment(
        { ...input, shifts: [{ id: 'a', date: '2023-02-29', amount: '1' }] },
        '1',
      ),
    ).toThrow();
    expect(() =>
      allocatePeriodInstallment(
        { status: 'pending', total: '1', paid: '2' },
        '1',
      ),
    ).toThrow();
  });

  it('handles totals and accumulated payments above the individual limit', () => {
    const input: ShiftGroup = {
      status: 'pending',
      shifts: [
        { id: 'a', date: '2024-01-01', amount: '9999999999.99' },
        { id: 'b', date: '2024-01-02', amount: '9999999999.99' },
      ],
      allocations: [{ shiftId: 'a', amount: '9999999999.99' }],
    };
    const before = JSON.stringify(input);
    const initial = allocateShiftInstallment(
      { ...input, allocations: [] },
      '0.01',
    );
    expect(initial).toMatchObject({
      total: '19999999999.98',
      paid: '0.01',
      balance: '19999999999.97',
      newAllocations: [{ shiftId: 'a', amount: '0.01' }],
    });
    const result = allocateShiftInstallment(input, '0.01');
    expect(result).toMatchObject({
      total: '19999999999.98',
      paid: '10000000000.00',
      balance: '9999999999.98',
      newAllocations: [{ shiftId: 'b', amount: '0.01' }],
    });
    expect(JSON.stringify(input)).toBe(before);
    const completed = allocateShiftInstallment(
      { ...input, allocations: result.allocations },
      '9999999999.98',
    );
    expect(completed).toMatchObject({
      status: 'completed',
      paid: '19999999999.98',
      balance: '0.00',
    });
    expect(() => allocateShiftInstallment(input, '10000000000.00')).toThrow();
  });

  it('rejects zero-value shifts both initially and when appended', () => {
    const zeroShift = { id: 'c', date: '2026-03-03', amount: '0.00' };
    expect(() => appendShifts(group(), [zeroShift])).toThrow();
    expect(() =>
      allocateShiftInstallment(
        { ...group(), shifts: [...group().shifts, zeroShift] },
        '1',
      ),
    ).toThrow();
  });

  it('handles a manually entered fixed-period obligation without deriving salary', () => {
    expect(
      allocatePeriodInstallment(
        { status: 'pending', total: '100.01', paid: '40.02' },
        '59.99',
      ),
    ).toEqual({
      status: 'completed',
      total: '100.01',
      paid: '100.01',
      balance: '0.00',
    });
    expect(
      allocatePeriodInstallment(
        { status: 'pending', total: '100.01', paid: '0' },
        '0.01',
      ),
    ).toEqual({
      status: 'pending',
      total: '100.01',
      paid: '0.01',
      balance: '100.00',
    });
    expect(() =>
      allocatePeriodInstallment(
        { status: 'pending', total: '1', paid: '0' },
        '1.01',
      ),
    ).toThrow();
    expect(() =>
      allocatePeriodInstallment(
        { status: 'completed', total: '1', paid: '1' },
        '0.01',
      ),
    ).toThrow();
  });
});
