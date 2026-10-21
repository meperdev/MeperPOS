import {
  deriveInventoryLoanQuantities,
  planInventoryLoanClose,
  InventoryLoanCounts,
  transitionInventoryLoanItem,
  validateInventoryLoanCounts,
} from './inventory-loan.invariants';

const initial: InventoryLoanCounts = {
  quantity: 10,
  deliveredQuantity: 0,
  returnedQuantity: 0,
  cancelledQuantity: 0,
};

describe('inventory loan close plan', () => {
  const returned = { ...initial, deliveredQuantity: 3, returnedQuantity: 3 };

  it('releases the undelivered remainder after a partial returned delivery', () => {
    expect(planInventoryLoanClose([returned])).toEqual([
      {
        counts: { ...returned, cancelledQuantity: 7 },
        reservedRemaining: 0,
        outstanding: 0,
        releaseQuantity: 7,
      },
    ]);
  });

  it('rejects outstanding units anywhere in the loan', () => {
    expect(() =>
      planInventoryLoanClose([returned, { ...initial, deliveredQuantity: 1 }]),
    ).toThrow();
  });

  it('rejects zero activity at aggregate level, even with all reservations released', () => {
    expect(() => planInventoryLoanClose([initial])).toThrow();
    expect(() =>
      planInventoryLoanClose([{ ...initial, cancelledQuantity: 10 }, initial]),
    ).toThrow();
  });

  it.each([
    { ...initial, deliveredQuantity: 10, returnedQuantity: 10 },
    { ...returned, cancelledQuantity: 7 },
  ])('accepts fully returned or already released allocations: %p', (counts) => {
    expect(planInventoryLoanClose([counts])).toEqual([
      { counts, reservedRemaining: 0, outstanding: 0, releaseQuantity: 0 },
    ]);
  });

  it('releases only the remainder, preserving prior cancellations and all deliveries', () => {
    const counts = { ...returned, cancelledQuantity: 2 };
    const [result] = planInventoryLoanClose([counts]);
    expect(result.releaseQuantity).toBe(5);
    expect(result.counts).toEqual({ ...counts, cancelledQuantity: 7 });
  });

  it.each([undefined, null, {}, [], [undefined], [null], [{}], new Array(1)])(
    'rejects malformed or empty aggregate input: %p',
    (items) => {
      expect(() =>
        planInventoryLoanClose(items as InventoryLoanCounts[]),
      ).toThrow();
    },
  );

  it.each([
    'quantity',
    'deliveredQuantity',
    'returnedQuantity',
    'cancelledQuantity',
  ])('validates every item %s before proposing release', (field) => {
    for (const invalid of [
      -1,
      0.5,
      NaN,
      Infinity,
      2147483648,
      Number.MAX_SAFE_INTEGER,
      '1',
      true,
      null,
      undefined,
    ]) {
      expect(() =>
        planInventoryLoanClose([returned, { ...initial, [field]: invalid }]),
      ).toThrow();
    }
  });

  it.each([
    { ...initial, quantity: 0 },
    { ...initial, returnedQuantity: 1 },
    { ...initial, deliveredQuantity: 11 },
    { ...returned, cancelledQuantity: 8 },
    {
      ...initial,
      deliveredQuantity: 2147483647,
      cancelledQuantity: 2147483647,
    },
  ])('rejects inconsistent or overflowing allocations: %p', (counts) => {
    expect(() => planInventoryLoanClose([returned, counts])).toThrow();
  });

  it('accepts Prisma Int limits per item without summing aggregate quantities', () => {
    const untouched = { ...initial, quantity: 2147483647 };
    const complete = {
      ...untouched,
      deliveredQuantity: 2147483647,
      returnedQuantity: 2147483647,
    };
    const partial = {
      ...untouched,
      deliveredQuantity: 1,
      returnedQuantity: 1,
      cancelledQuantity: 1,
    };
    const plan = planInventoryLoanClose([complete, partial, untouched]);
    expect(plan.map((item) => item.releaseQuantity)).toEqual([
      0, 2147483645, 2147483647,
    ]);
    expect(plan.map((item) => item.counts.cancelledQuantity)).toEqual([
      0, 2147483646, 2147483647,
    ]);
    for (const item of plan) {
      expect(item.reservedRemaining).toBe(0);
      expect(item.outstanding).toBe(0);
      expect(() => validateInventoryLoanCounts(item.counts)).not.toThrow();
    }
  });

  it('uses frozen fixtures without mutation and returns fresh independent results', () => {
    const untouched = Object.freeze({ ...initial });
    const delivered = Object.freeze({ ...returned });
    const items = Object.freeze([untouched, delivered]);
    const first = planInventoryLoanClose(items);
    const second = planInventoryLoanClose(items);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0].counts).not.toBe(untouched);
    expect(first[1].counts).not.toBe(delivered);
    first[0].counts.cancelledQuantity = 0;
    expect(second[0].counts.cancelledQuantity).toBe(10);
    expect(items).toEqual([initial, returned]);
    expect(() => planInventoryLoanClose(Object.freeze([untouched]))).toThrow();
    expect(untouched).toEqual(initial);
  });

  it('allows untouched items when another item has a returned delivery', () => {
    const plan = planInventoryLoanClose([initial, returned]);
    expect(plan.map((item) => item.releaseQuantity)).toEqual([10, 7]);
    expect(plan[0].counts).toEqual({ ...initial, cancelledQuantity: 10 });
  });
});

describe('inventory loan pure accounting', () => {
  it('derives the initial reservation without a physical delivery', () => {
    expect(
      deriveInventoryLoanQuantities(Object.freeze({ ...initial })),
    ).toEqual({
      reservedRemaining: 10,
      outstanding: 0,
    });
  });

  it.each([undefined, null, {}, { quantity: 1 }])(
    'rejects missing counts: %p',
    (counts) => {
      expect(() =>
        validateInventoryLoanCounts(counts as InventoryLoanCounts),
      ).toThrow();
    },
  );

  it.each([
    'quantity',
    'deliveredQuantity',
    'returnedQuantity',
    'cancelledQuantity',
  ])('rejects invalid %s without coercion', (field) => {
    for (const invalid of [
      -1,
      0.5,
      NaN,
      Infinity,
      -Infinity,
      2147483648,
      Number.MAX_SAFE_INTEGER,
      '1',
      true,
      null,
      undefined,
    ]) {
      expect(() =>
        validateInventoryLoanCounts({ ...initial, [field]: invalid }),
      ).toThrow();
    }
  });

  it.each([
    { ...initial, quantity: 0 },
    { ...initial, returnedQuantity: 1 },
    { ...initial, deliveredQuantity: 11 },
    { ...initial, deliveredQuantity: 6, cancelledQuantity: 5 },
  ])('rejects inconsistent allocation: %p', (counts) => {
    expect(() => validateInventoryLoanCounts(counts)).toThrow();
  });

  it('derives remaining reservation independently of recorded returns', () => {
    expect(
      deriveInventoryLoanQuantities({
        ...initial,
        deliveredQuantity: 6,
        returnedQuantity: 2,
        cancelledQuantity: 1,
      }),
    ).toEqual({ reservedRemaining: 3, outstanding: 4 });
  });

  it('supports partial movements without mutating input', () => {
    const original = Object.freeze({ ...initial });
    const delivered = transitionInventoryLoanItem(original, 'DELIVERED', 6);
    expect(delivered).toEqual({
      counts: { ...initial, deliveredQuantity: 6 },
      stockDelta: -6,
      reservationDelta: -6,
    });
    const returned = transitionInventoryLoanItem(
      delivered.counts,
      'RETURNED',
      2,
    );
    expect(returned).toEqual({
      counts: { ...initial, deliveredQuantity: 6, returnedQuantity: 2 },
      stockDelta: 2,
      reservationDelta: 0,
    });
    const cancelled = transitionInventoryLoanItem(
      returned.counts,
      'CANCELLED',
      4,
    );
    expect(cancelled).toEqual({
      counts: { ...returned.counts, cancelledQuantity: 4 },
      stockDelta: 0,
      reservationDelta: -4,
    });
    expect(deriveInventoryLoanQuantities(cancelled.counts)).toEqual({
      reservedRemaining: 0,
      outstanding: 4,
    });
    expect(original).toEqual(initial);
    expect(delivered.counts.returnedQuantity).toBe(0);
    expect(returned.counts.cancelledQuantity).toBe(0);
  });

  it.each(['DELIVERED', 'RETURNED', 'CANCELLED'] as const)(
    'rejects invalid or excessive %s quantities',
    (movement) => {
      for (const quantity of [0, -1, 0.5, NaN, Infinity, 2147483648, 11]) {
        expect(() =>
          transitionInventoryLoanItem(initial, movement, quantity),
        ).toThrow();
      }
    },
  );

  it('rejects unknown movements and invalid input before arithmetic', () => {
    expect(() =>
      transitionInventoryLoanItem(initial, 'UNKNOWN' as 'DELIVERED', 1),
    ).toThrow();
    expect(() =>
      deriveInventoryLoanQuantities({ ...initial, returnedQuantity: 1 }),
    ).toThrow();
    expect(() =>
      transitionInventoryLoanItem({ ...initial, quantity: 0 }, 'DELIVERED', 1),
    ).toThrow();
  });

  it('accepts the Prisma Int boundary without overflowing allocation arithmetic', () => {
    const counts = { ...initial, quantity: 2147483647 };
    const delivered = transitionInventoryLoanItem(
      counts,
      'DELIVERED',
      2147483647,
    );
    const returned = transitionInventoryLoanItem(
      delivered.counts,
      'RETURNED',
      2147483647,
    );
    expect(deriveInventoryLoanQuantities(returned.counts)).toEqual({
      reservedRemaining: 0,
      outstanding: 0,
    });
    expect(returned.reservationDelta).toBe(0);
    expect(() =>
      transitionInventoryLoanItem(delivered.counts, 'DELIVERED', 1),
    ).toThrow();
    expect(() =>
      validateInventoryLoanCounts({
        ...counts,
        deliveredQuantity: 2147483647,
        cancelledQuantity: 2147483647,
      }),
    ).toThrow();
  });

  it('never re-reserves returned units or permits duplicate returns', () => {
    const delivered = transitionInventoryLoanItem(initial, 'DELIVERED', 10);
    const first = transitionInventoryLoanItem(delivered.counts, 'RETURNED', 3);
    const last = transitionInventoryLoanItem(first.counts, 'RETURNED', 7);
    expect(first.reservationDelta + last.reservationDelta).toBe(0);
    expect(first.stockDelta + last.stockDelta).toBe(10);
    expect(() =>
      transitionInventoryLoanItem(last.counts, 'RETURNED', 1),
    ).toThrow();
    expect(() =>
      transitionInventoryLoanItem(last.counts, 'DELIVERED', 1),
    ).toThrow();
    expect(() =>
      transitionInventoryLoanItem(last.counts, 'CANCELLED', 1),
    ).toThrow();
  });

  it('cancels only undelivered units, including the full integer boundary', () => {
    const counts = Object.freeze({ ...initial, quantity: 2147483647 });
    const cancelled = transitionInventoryLoanItem(
      counts,
      'CANCELLED',
      2147483647,
    );
    expect(cancelled.stockDelta).toBe(0);
    expect(cancelled.reservationDelta).toBe(-2147483647);
    expect(deriveInventoryLoanQuantities(cancelled.counts)).toEqual({
      reservedRemaining: 0,
      outstanding: 0,
    });
    expect(() =>
      transitionInventoryLoanItem(cancelled.counts, 'CANCELLED', 1),
    ).toThrow();
    expect(() =>
      transitionInventoryLoanItem(cancelled.counts, 'DELIVERED', 1),
    ).toThrow();
  });
});
