import {
  bogotaToday,
  isPurchaseOrderOverdue,
  toCalendarDay,
} from './purchase-order-status';

const iso = (date: Date) => date.toISOString();

describe('overdue rule', () => {
  it('bogotaToday reads the Bogotá calendar day across the UTC boundary', () => {
    expect(iso(bogotaToday(new Date('2026-11-19T03:00:00.000Z')))).toBe(
      '2026-11-18T00:00:00.000Z',
    );
    expect(iso(bogotaToday(new Date('2026-11-19T04:59:59.000Z')))).toBe(
      '2026-11-18T00:00:00.000Z',
    );
    expect(iso(bogotaToday(new Date('2026-11-19T05:00:00.000Z')))).toBe(
      '2026-11-19T00:00:00.000Z',
    );
    expect(iso(bogotaToday(new Date('2026-11-19T23:30:00.000Z')))).toBe(
      '2026-11-19T00:00:00.000Z',
    );
  });

  it('a day due today is not overdue, the next day it is', () => {
    const due = toCalendarDay('2026-11-25');
    expect(
      isPurchaseOrderOverdue(
        { status: 'PENDING', expectedDeliveryDate: due },
        bogotaToday(new Date('2026-11-25T15:00:00.000Z')),
      ),
    ).toBe(false);
    expect(
      isPurchaseOrderOverdue(
        { status: 'PENDING', expectedDeliveryDate: due },
        bogotaToday(new Date('2026-11-26T15:00:00.000Z')),
      ),
    ).toBe(true);
    // 23:30 on Nov 25 in Bogotá is still Nov 25.
    expect(
      isPurchaseOrderOverdue(
        { status: 'PENDING', expectedDeliveryDate: due },
        bogotaToday(new Date('2026-11-26T04:30:00.000Z')),
      ),
    ).toBe(false);
  });

  it('only open orders can be overdue', () => {
    const due = toCalendarDay('2020-01-10');
    const today = bogotaToday(new Date('2026-11-18T12:00:00.000Z'));
    for (const status of ['DRAFT', 'RECEIVED', 'CANCELLED']) {
      expect(
        isPurchaseOrderOverdue({ status, expectedDeliveryDate: due }, today),
      ).toBe(false);
    }
    for (const status of ['PENDING', 'PARTIAL_RECEIVED']) {
      expect(
        isPurchaseOrderOverdue({ status, expectedDeliveryDate: due }, today),
      ).toBe(true);
    }
    expect(
      isPurchaseOrderOverdue(
        { status: 'PENDING', expectedDeliveryDate: null },
        today,
      ),
    ).toBe(false);
    expect(isPurchaseOrderOverdue({ status: 'PENDING' }, today)).toBe(false);
  });

  it('toCalendarDay keeps the day for both accepted shapes', () => {
    expect(iso(toCalendarDay('2026-11-25'))).toBe('2026-11-25T00:00:00.000Z');
    expect(iso(toCalendarDay('2026-11-25T00:00:00.000Z'))).toBe(
      '2026-11-25T00:00:00.000Z',
    );
    expect(iso(toCalendarDay('2026-01-01'))).toBe('2026-01-01T00:00:00.000Z');
  });
});
