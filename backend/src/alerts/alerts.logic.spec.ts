import { OrgRole } from '@prisma/client';
import {
  alertVisibility,
  buildAlerts,
  effectiveRoles,
  fingerprint,
} from './alerts.logic';
import type { AlertSignals } from './alerts.types';

const NOW = new Date('2026-11-14T15:00:00.000Z');

const signals = (over: Partial<AlertSignals> = {}): AlertSignals => ({
  role: OrgRole.ADMIN,
  now: NOW,
  organization: { status: 'ACTIVE', trialEndsAt: null },
  limits: [],
  lowStock: [],
  overdueLoans: [],
  overdueTasks: [],
  ...over,
});

describe('alerts.logic — role hierarchy', () => {
  it('mirrors the route guard inheritance and never grants INVENTORY_USER', () => {
    expect(effectiveRoles('OWNER')).toEqual([
      'OWNER',
      'ADMIN',
      'MEMBER',
      'CASHIER',
    ]);
    expect(effectiveRoles('ADMIN')).toEqual(['ADMIN', 'MEMBER', 'CASHIER']);
    expect(effectiveRoles('MEMBER')).toEqual(['MEMBER', 'CASHIER']);
    expect(effectiveRoles('CASHIER')).toEqual(['CASHIER']);
    expect(effectiveRoles('INVENTORY_USER')).toEqual(['INVENTORY_USER']);
    expect(effectiveRoles('SUPER_ADMIN')).toEqual(['SUPER_ADMIN']);
  });

  it('gives each role the categories it is allowed to see', () => {
    expect(alertVisibility('ADMIN')).toEqual({
      billing: true,
      stock: true,
      operations: true,
    });
    expect(alertVisibility('OWNER')).toEqual({
      billing: true,
      stock: true,
      operations: true,
    });
    expect(alertVisibility('MEMBER')).toEqual({
      billing: false,
      stock: false,
      operations: true,
    });
    expect(alertVisibility('CASHIER')).toEqual({
      billing: false,
      stock: false,
      operations: true,
    });
    expect(alertVisibility('INVENTORY_USER')).toEqual({
      billing: false,
      stock: true,
      operations: true,
    });
  });
});

describe('alerts.logic — stock', () => {
  it('flags a depleted product as critical and counts it', () => {
    const [alert] = buildAlerts(
      signals({
        lowStock: [
          { id: 'p1', stock: 0, minStock: 5 },
          { id: 'p2', stock: 3, minStock: 5 },
        ],
      }),
    );

    expect(alert).toMatchObject({
      id: 'stock:depleted',
      category: 'stock',
      severity: 'critical',
      title: '1 producto agotado',
      detail: '2 productos por debajo del mínimo.',
      href: '/inventory?filter=lowStock',
    });
  });

  it('keeps a non-zero low product as a warning', () => {
    const [alert] = buildAlerts(
      signals({ lowStock: [{ id: 'p1', stock: 3, minStock: 5 }] }),
    );

    expect(alert).toMatchObject({
      id: 'stock:low',
      severity: 'warning',
      title: 'Stock bajo',
      detail: '1 producto por debajo del mínimo.',
    });
  });

  it('hides stock from a role without the inventory capability', () => {
    const alerts = buildAlerts(
      signals({
        role: OrgRole.MEMBER,
        lowStock: [{ id: 'p1', stock: 3, minStock: 5 }],
      }),
    );

    expect(alerts).toEqual([]);
  });

  it('keeps the revision stable when only the order changes, and changes it when a product moves', () => {
    const first = buildAlerts(
      signals({
        lowStock: [
          { id: 'p1', stock: 1, minStock: 5 },
          { id: 'p2', stock: 2, minStock: 5 },
        ],
      }),
    )[0];
    const reordered = buildAlerts(
      signals({
        lowStock: [
          { id: 'p2', stock: 2, minStock: 5 },
          { id: 'p1', stock: 1, minStock: 5 },
        ],
      }),
    )[0];
    const changed = buildAlerts(
      signals({
        lowStock: [
          { id: 'p1', stock: 1, minStock: 5 },
          { id: 'p2', stock: 2, minStock: 5 },
          { id: 'p3', stock: 0, minStock: 5 },
        ],
      }),
    )[0];

    expect(reordered.revision).toBe(first.revision);
    expect(changed.revision).not.toBe(first.revision);
  });

  it('renders an id that a new low product can reuse with a different revision', () => {
    const before = buildAlerts(
      signals({ lowStock: [{ id: 'p1', stock: 3, minStock: 5 }] }),
    )[0];
    const after = buildAlerts(
      signals({
        lowStock: [
          { id: 'p1', stock: 3, minStock: 5 },
          { id: 'p2', stock: 3, minStock: 5 },
        ],
      }),
    )[0];

    expect(after.id).toBe(before.id);
    expect(after.revision).not.toBe(before.revision);
  });
});

describe('alerts.logic — billing and limits', () => {
  it('reports a suspended organization as critical', () => {
    const [alert] = buildAlerts(
      signals({ organization: { status: 'SUSPENDED', trialEndsAt: null } }),
    );

    expect(alert).toMatchObject({
      id: 'billing:suspended',
      severity: 'critical',
    });
  });

  it('counts the trial days left in America/Bogota arithmetic', () => {
    const [alert] = buildAlerts(
      signals({
        organization: {
          status: 'TRIAL',
          trialEndsAt: new Date('2026-11-16T15:00:00.000Z'),
        },
      }),
    );

    expect(alert).toMatchObject({
      id: 'billing:trial',
      severity: 'warning',
      title: 'Tu prueba termina en 2 días',
    });
  });

  it('separates at-limit from over-limit and skips unlimited plans', () => {
    const alerts = buildAlerts(
      signals({
        limits: [
          {
            type: 'users',
            current: 3,
            limit: 3,
            exceeded: true,
            warningAt: 2,
          },
          {
            type: 'products',
            current: 99,
            limit: 100,
            exceeded: false,
            warningAt: 80,
          },
          {
            type: 'customers',
            current: 60,
            limit: 50,
            exceeded: true,
            warningAt: 40,
          },
          {
            type: 'cashRegisters',
            current: 5,
            limit: -1,
            exceeded: false,
            warningAt: Number.POSITIVE_INFINITY,
          },
        ],
      }),
    );

    expect(alerts.map((alert) => alert.id)).toEqual([
      'limits:customers:exceeded',
      'limits:users:at-limit',
      'limits:products:near',
    ]);
  });

  it('does not show billing to a member', () => {
    const alerts = buildAlerts(
      signals({
        role: OrgRole.MEMBER,
        organization: { status: 'SUSPENDED', trialEndsAt: null },
        limits: [
          {
            type: 'users',
            current: 3,
            limit: 3,
            exceeded: true,
            warningAt: 2,
          },
        ],
      }),
    );

    expect(alerts).toEqual([]);
  });
});

describe('alerts.logic — operations', () => {
  it('summarizes overdue loans and tasks', () => {
    const alerts = buildAlerts(
      signals({
        role: OrgRole.CASHIER,
        overdueLoans: [
          { id: 'l1', dueAt: new Date('2026-11-01T00:00:00.000Z') },
          { id: 'l2', dueAt: new Date('2026-11-02T00:00:00.000Z') },
        ],
        overdueTasks: [{ id: 't1' }],
      }),
    );

    expect(alerts).toEqual([
      expect.objectContaining({
        id: 'loans:overdue',
        title: '2 préstamos vencidos',
        href: '/loans',
      }),
      expect.objectContaining({
        id: 'tasks:overdue',
        title: '1 tarea vencida',
        href: '/tasks',
      }),
    ]);
  });

  it('orders by severity and then by category', () => {
    const alerts = buildAlerts(
      signals({
        organization: { status: 'TRIAL', trialEndsAt: NOW },
        lowStock: [{ id: 'p1', stock: 0, minStock: 5 }],
        overdueTasks: [{ id: 't1' }],
      }),
    );

    expect(alerts.map((alert) => alert.category)).toEqual([
      'stock',
      'billing',
      'tasks',
    ]);
  });
});

describe('fingerprint', () => {
  it('is order independent and bounded', () => {
    expect(fingerprint(['b', 'a'])).toBe(fingerprint(['a', 'b']));
    expect(fingerprint(['a'])).toHaveLength(16);
  });
});
