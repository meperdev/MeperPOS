import {
  assertSandboxPlan,
  buildSandboxSeedPlan,
  summarizeSandboxPlan,
  type SandboxSeedPlan,
} from './sandbox-seed.plan';

const NOW = new Date('2026-11-06T18:00:00.000Z');

function buildPlan(
  overrides: Partial<Parameters<typeof buildSandboxSeedPlan>[0]> = {},
): SandboxSeedPlan {
  return buildSandboxSeedPlan({
    organizationName: 'Mercado Central Sandbox',
    organizationSlug: 'sandbox-demo',
    ownerName: 'Santiago Villabona',
    ownerEmail: 'owner@sandbox-demo.demo',
    staffEmailDomain: 'sandbox-demo.demo',
    now: NOW,
    ...overrides,
  });
}

describe('sandbox seed plan', () => {
  it('builds a dataset for every requested module', () => {
    const plan = buildPlan();

    expect(plan.users).toHaveLength(5);
    expect(plan.categories).toHaveLength(6);
    expect(plan.products.length).toBeGreaterThanOrEqual(25);
    expect(plan.customers).toHaveLength(10);
    expect(plan.suppliers).toHaveLength(4);
    expect(plan.purchaseOrders).toHaveLength(4);
    expect(plan.sales.length).toBeGreaterThan(150);
    expect(plan.expenses).toHaveLength(8);
    expect(plan.employees).toHaveLength(6);
    expect(plan.payroll).toHaveLength(5);
    expect(plan.moneyLoans).toHaveLength(5);
    expect(plan.tasks).toHaveLength(5);
    expect(summarizeSandboxPlan(plan)).toHaveLength(15);
  });

  it('is deterministic for the same as-of date', () => {
    expect(buildPlan()).toEqual(buildPlan());
  });

  it('sorts every sale line and total, and never underpays', () => {
    const plan = buildPlan();

    for (const sale of plan.sales) {
      const subtotal = sale.items.reduce((sum, item) => sum + item.subtotal, 0);
      const taxed = sale.items.reduce(
        (sum, item) => sum + (item.total - item.subtotal),
        0,
      );
      expect(Number(subtotal.toFixed(2))).toBe(sale.subtotal);
      expect(Number(taxed.toFixed(2))).toBe(sale.taxAmount);
      expect(Number((sale.subtotal + sale.taxAmount).toFixed(2))).toBe(
        sale.total,
      );
      expect(sale.amountPaid).toBeGreaterThanOrEqual(sale.total);
      expect(Number((sale.amountPaid - sale.total).toFixed(2))).toBe(
        sale.change,
      );
      expect(
        Number(
          sale.payments
            .reduce((sum, payment) => sum + payment.amount, 0)
            .toFixed(2),
        ),
      ).toBe(sale.amountPaid);
    }
  });

  it('numbers sales without gaps from 1', () => {
    const plan = buildPlan();
    expect(plan.sales[0].saleNumber).toBe(1);
    plan.sales.forEach((sale, index) => {
      expect(sale.saleNumber).toBe(index + 1);
    });
  });

  it('keeps purchase order status aligned with received quantities', () => {
    const plan = buildPlan();
    const byKey = new Map(
      plan.purchaseOrders.map((order) => [order.key, order]),
    );

    expect(byKey.get('draft')?.status).toBe('DRAFT');
    expect(byKey.get('draft')?.receivedAt).toBeNull();
    expect(byKey.get('pending')?.status).toBe('PENDING');
    expect(byKey.get('partial')?.status).toBe('PARTIAL_RECEIVED');
    expect(byKey.get('received')?.status).toBe('RECEIVED');

    for (const order of plan.purchaseOrders) {
      for (const item of order.items) {
        expect(item.qtyReceived).toBeGreaterThanOrEqual(0);
        expect(item.qtyReceived).toBeLessThanOrEqual(item.qtyOrdered);
      }
    }

    const received = byKey.get('received');
    expect(
      received?.items.every((item) => item.qtyReceived === item.qtyOrdered),
    ).toBe(true);
  });

  it('opens every product at a non-negative stock before purchases', () => {
    const plan = buildPlan();

    for (const product of plan.products) {
      expect(product.openingStock).toBeGreaterThanOrEqual(0);
      expect(product.stock).toBeGreaterThanOrEqual(product.openingStock);
    }
  });

  it('assigns each shift to at most one payroll group', () => {
    const plan = buildPlan();
    const seen = new Set<string>();

    for (const payroll of plan.payroll) {
      for (const date of payroll.shiftDates) {
        const identity = `${payroll.employeeKey}:${date}`;
        expect(seen.has(identity)).toBe(false);
        seen.add(identity);
      }
    }
  });

  it('keeps payroll status aligned with its cash', () => {
    const plan = buildPlan();

    for (const payroll of plan.payroll) {
      const paid = payroll.payments.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );
      expect(Number(paid.toFixed(2))).toBeLessThanOrEqual(payroll.total);

      if (payroll.status === 'COMPLETED') {
        expect(Number(paid.toFixed(2))).toBe(payroll.total);
      } else {
        expect(paid).toBeLessThan(payroll.total);
      }
    }

    expect(
      plan.payroll.filter((payroll) => payroll.kind === 'SHIFT_GROUP'),
    ).toHaveLength(3);
    expect(
      plan.payroll.filter((payroll) => payroll.kind === 'FIXED_PERIOD'),
    ).toHaveLength(2);
  });

  it('keeps every loan history aligned with its final status', () => {
    const plan = buildPlan();

    for (const loan of plan.moneyLoans) {
      const collected = loan.events
        .filter((event) => event.type === 'COLLECTED')
        .reduce((sum, event) => sum + (event.amount ?? 0), 0);
      const balance = Number((loan.amount - collected).toFixed(2));

      if (loan.status === 'CLOSED') {
        expect(balance).toBe(0);
        expect(loan.events.some((event) => event.type === 'CLOSED')).toBe(true);
      } else {
        expect(balance).toBeGreaterThan(0);
        expect(loan.events.some((event) => event.type === 'CLOSED')).toBe(
          false,
        );
      }

      const requestKeys = loan.events
        .map((event) => event.requestKey)
        .filter((key): key is string => key !== null);
      expect(new Set(requestKeys).size).toBe(requestKeys.length);
    }

    expect(
      plan.moneyLoans.filter((loan) => loan.type === 'SERVICE'),
    ).toHaveLength(1);
    expect(
      plan.moneyLoans.filter((loan) => loan.status === 'CLOSED'),
    ).toHaveLength(1);
  });

  it('derives expense status from the payment sum', () => {
    const plan = buildPlan();

    for (const expense of plan.expenses) {
      const paid = expense.payments.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );
      if (expense.status === 'PAID') {
        expect(Number(paid.toFixed(2))).toBe(expense.total);
      } else {
        expect(paid).toBeGreaterThan(0);
        expect(paid).toBeLessThan(expense.total);
      }
    }

    expect(
      plan.expenses.filter((expense) => expense.status === 'PARTIAL'),
    ).toHaveLength(1);
  });

  it('has two services and at least two products at or below minimum stock', () => {
    const plan = buildPlan();
    const services = plan.products.filter(
      (product) => product.type === 'SERVICE',
    );
    const lowStock = plan.products.filter(
      (product) =>
        product.type === 'PRODUCT' && product.stock <= product.minStock,
    );

    expect(services).toHaveLength(2);
    expect(lowStock.length).toBeGreaterThanOrEqual(2);
    expect(services.every((product) => !product.tracksStock)).toBe(true);
  });

  it('rejects an inconsistent plan', () => {
    const broken = structuredClone(buildPlan());
    broken.sales[0].total = broken.sales[0].total + 1;

    expect(() => assertSandboxPlan(broken)).toThrow(/total does not add up/);
  });

  it('rejects two loans with the same key', () => {
    const broken = structuredClone(buildPlan());
    broken.moneyLoans[1].key = broken.moneyLoans[0].key;

    expect(() => assertSandboxPlan(broken)).toThrow(/Duplicate loan key/);
  });

  it('uses the configured staff domain for demo users and employees', () => {
    const plan = buildPlan({
      organizationSlug: 'otra-sandbox',
      staffEmailDomain: 'otra-sandbox.demo',
    });

    expect(plan.users.map((user) => user.email)).toEqual(
      expect.arrayContaining([
        'owner@sandbox-demo.demo',
        'admin@otra-sandbox.demo',
        'cajero@otra-sandbox.demo',
        'inventario@otra-sandbox.demo',
        'miembro@otra-sandbox.demo',
      ]),
    );
    expect(
      plan.employees.every((employee) =>
        employee.email.endsWith('@otra-sandbox.demo'),
      ),
    ).toBe(true);
  });
});
