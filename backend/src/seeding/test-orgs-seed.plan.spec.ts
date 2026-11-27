import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLAN_LIMITS } from '../plan-limits/plan-limits.constants';
import { CURRENCY, LOCALE } from '../common/constants/locale.constants';
import {
  assertTestOrgsPlan,
  buildTestOrgsSeedPlan,
  summarizeTestOrgsPlan,
  type TestOrgPlan,
  type TestOrgsSeedPlan,
} from './test-orgs-seed.plan';

const NOW = new Date('2026-11-06T18:00:00.000Z');

function buildPlan(): TestOrgsSeedPlan {
  return buildTestOrgsSeedPlan({ now: NOW });
}

function org(plan: TestOrgsSeedPlan, slug: string): TestOrgPlan {
  const found = plan.organizations.find(
    (candidate) => candidate.organization.slug === slug,
  );
  if (!found) throw new Error(`Missing organization ${slug}`);
  return found;
}

describe('test organizations seed plan', () => {
  it('creates exactly the two test organizations, PRO and BASIC', () => {
    const plan = buildPlan();

    expect(plan.organizations.map((row) => row.organization.slug)).toEqual([
      'prueba-pro',
      'prueba-basic',
    ]);
    expect(plan.organizations.map((row) => row.organization.name)).toEqual([
      'Prueba PRO',
      'Prueba BASIC',
    ]);
    expect(plan.organizations.map((row) => row.organization.plan)).toEqual([
      'PRO',
      'BASIC',
    ]);
    for (const row of plan.organizations) {
      expect(row.organization.status).toBe('ACTIVE');
      expect(row.organization.billingStatus).toBe('PAID');
    }
  });

  it('gives each organization exactly one ADMIN membership, the primary owner', () => {
    const plan = buildPlan();

    for (const row of plan.organizations) {
      expect(row.users).toHaveLength(1);
      expect(row.users[0]).toMatchObject({
        role: 'ADMIN',
        isPrimaryOwner: true,
      });
      expect(row.users.map((user) => user.role)).not.toContain('CASHIER');
      expect(row.users.map((user) => user.role)).not.toContain(
        'INVENTORY_USER',
      );
    }

    expect(org(plan, 'prueba-pro').users[0].email).toBe(
      'admin.pro@meperpos.test',
    );
    expect(org(plan, 'prueba-basic').users[0].email).toBe(
      'admin.basic@meperpos.test',
    );

    const emails = plan.organizations.flatMap((row) =>
      row.users.map((user) => user.email),
    );
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('keeps BASIC inside PLAN_LIMITS.BASIC', () => {
    const basic = org(buildPlan(), 'prueba-basic');
    const limits = PLAN_LIMITS.BASIC;

    expect(basic.users.length).toBeLessThanOrEqual(limits.maxUsers);
    expect(basic.products.length).toBeLessThanOrEqual(limits.maxProducts);
    expect(basic.customers.length).toBeLessThanOrEqual(limits.maxCustomers);
    expect(basic.organization.cashRegisters).toHaveLength(
      limits.maxCashRegisters,
    );
    expect(
      basic.products.filter((product) => product.type === 'PRODUCT').length,
    ).toBeLessThanOrEqual(limits.maxProducts);
  });

  it('gives PRO the full breadth: second site, site stock, transfer, loan, sent order', () => {
    const pro = org(buildPlan(), 'prueba-pro');

    expect(pro.organization.locations).toHaveLength(2);
    expect(
      pro.organization.locations.filter((location) => location.isDefault),
    ).toHaveLength(1);
    expect(pro.organization.locations[0]).toMatchObject({
      name: 'Sede principal',
      type: 'STORE',
      isDefault: true,
    });
    expect(pro.organization.locations[1]).toMatchObject({
      name: 'Sucursal Norte',
      type: 'WAREHOUSE',
      isDefault: false,
    });

    expect(pro.siteStock.length).toBeGreaterThan(0);
    const moved = new Map(
      pro.stockTransfers.flatMap((transfer) =>
        transfer.items.map(
          (item) => [item.sku, item.quantity] as [string, number],
        ),
      ),
    );
    for (const entry of pro.siteStock) {
      expect(entry.locationName).toBe('Sucursal Norte');
      expect(entry.quantity).toBe(moved.get(entry.sku));
    }

    expect(pro.stockTransfers).toHaveLength(1);
    expect(pro.stockTransfers[0].status).toBe('RECEIVED');
    expect(pro.stockTransfers[0].fromLocationName).toBe('Sede principal');
    expect(pro.stockTransfers[0].toLocationName).toBe('Sucursal Norte');
    expect(pro.stockTransfers[0].items.length).toBeGreaterThanOrEqual(2);

    expect(pro.inventoryLoans).toHaveLength(1);
    expect(pro.inventoryLoans[0].items.length).toBeGreaterThanOrEqual(1);
    expect(pro.inventoryLoans[0].events[0]).toMatchObject({
      type: 'CREATED',
    });

    const sent = pro.purchaseOrders.filter((order) => order.sent !== null);
    expect(sent).toHaveLength(1);
    expect(sent[0].status).not.toBe('DRAFT');
    expect(sent[0].sent?.daysAgo).toBeGreaterThan(0);

    expect(
      pro.organization.sequences.map((sequence) => sequence.type).sort(),
    ).toEqual(['PO', 'SALE', 'TRANSFER']);
  });

  it('writes organization settings the settings service reads', () => {
    const plan = buildPlan();

    for (const row of plan.organizations) {
      const settings = row.organization.settings;
      expect(Object.keys(settings).sort()).toEqual([
        'printFooter',
        'printHeader',
        'purchaseOrderTemplate',
      ]);
      expect(settings.printHeader).toBe(row.organization.name);
      expect(settings.purchaseOrderTemplate.terms.length).toBeGreaterThan(0);

      const sale = row.organization.sequences.find(
        (sequence) => sequence.type === 'SALE',
      );
      expect(sale?.prefix).toBeTruthy();
      // Currency, locale and timezone are application constants, not per-org
      // settings; the receipt prefix lives on the SALE sequence.
      expect(CURRENCY).toBe('COP');
      expect(LOCALE).toBe('es-CO');
    }
  });

  it('is deterministic for the same as-of date', () => {
    expect(buildPlan()).toEqual(buildPlan());
  });

  it('keeps BASIC smaller than PRO in every section it shares', () => {
    const plan = buildPlan();
    const pro = org(plan, 'prueba-pro');
    const basic = org(plan, 'prueba-basic');

    expect(basic.products.length).toBeLessThan(pro.products.length);
    expect(basic.customers.length).toBeLessThan(pro.customers.length);
    expect(basic.sales.length).toBeLessThan(pro.sales.length);
    expect(basic.expenses.length).toBeLessThan(pro.expenses.length);
    expect(basic.tasks.length).toBeLessThan(pro.tasks.length);
    // Payroll, loans and multi-site sections are PRO-only breadth.
    expect(basic.employees).toEqual([]);
    expect(basic.payroll).toEqual([]);
    expect(basic.moneyLoans).toEqual([]);
    expect(basic.inventoryLoans).toEqual([]);
    expect(basic.stockTransfers).toEqual([]);
    expect(basic.siteStock).toEqual([]);
    expect(basic.organization.locations).toHaveLength(1);
  });

  it('sorts every sale line and total, and never underpays', () => {
    const plan = buildPlan();

    for (const sale of plan.organizations.flatMap((row) => row.sales)) {
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

  it('numbers sales without gaps from 1 in each organization', () => {
    for (const row of buildPlan().organizations) {
      expect(row.sales[0].saleNumber).toBe(1);
      row.sales.forEach((sale, index) => {
        expect(sale.saleNumber).toBe(index + 1);
      });
    }
  });

  it('keeps purchase order status aligned with received quantities', () => {
    const byKey = new Map(
      org(buildPlan(), 'prueba-pro').purchaseOrders.map((order) => [
        order.key,
        order,
      ]),
    );

    expect(byKey.get('draft')?.status).toBe('DRAFT');
    expect(byKey.get('draft')?.sent).toBeNull();
    expect(byKey.get('received')?.status).toBe('RECEIVED');

    for (const order of org(buildPlan(), 'prueba-pro').purchaseOrders) {
      for (const item of order.items) {
        expect(item.qtyReceived).toBeGreaterThanOrEqual(0);
        expect(item.qtyReceived).toBeLessThanOrEqual(item.qtyOrdered);
      }
    }
  });

  it('opens every product at a non-negative stock before purchases', () => {
    for (const row of buildPlan().organizations) {
      for (const product of row.products) {
        expect(product.openingStock).toBeGreaterThanOrEqual(0);
        expect(product.stock).toBeGreaterThanOrEqual(product.openingStock);
      }
    }
  });

  it('keeps every loan history aligned with its final status', () => {
    const moneyLoans = buildPlan().organizations.flatMap(
      (row) => row.moneyLoans,
    );

    expect(moneyLoans.length).toBeGreaterThan(0);
    for (const loan of moneyLoans) {
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
    }
  });

  it('has at least two low-stock products in PRO so alerts have a source', () => {
    const lowStock = org(buildPlan(), 'prueba-pro').products.filter(
      (product) =>
        product.type === 'PRODUCT' && product.stock <= product.minStock,
    );

    expect(lowStock.length).toBeGreaterThanOrEqual(2);
  });

  it('summarizes both organizations with their section counts', () => {
    const lines = summarizeTestOrgsPlan(buildPlan());

    expect(lines.some((line) => line.includes('prueba-pro'))).toBe(true);
    expect(lines.some((line) => line.includes('prueba-basic'))).toBe(true);
    expect(lines.some((line) => line.includes('products'))).toBe(true);
  });

  it('rejects a BASIC plan over its product limit', () => {
    const broken = structuredClone(buildPlan());
    const basic = broken.organizations.find(
      (row) => row.organization.slug === 'prueba-basic',
    ) as TestOrgPlan;
    basic.products.push(
      ...Array.from({ length: PLAN_LIMITS.BASIC.maxProducts }, (_, index) => ({
        ...structuredClone(basic.products[0]),
        sku: `EXTRA-${index}`,
        barcode: `88000000${String(index).padStart(5, '0')}`,
      })),
    );

    expect(() => assertTestOrgsPlan(broken)).toThrow(/BASIC plan limit/);
  });

  it('rejects two primary owners inside one organization', () => {
    const broken = structuredClone(buildPlan());
    const pro = broken.organizations[0];
    pro.users.push({ ...pro.users[0], email: 'other@meperpos.test' });

    expect(() => assertTestOrgsPlan(broken)).toThrow(/primary owner/);
  });

  it('rejects a transfer between unknown locations', () => {
    const broken = structuredClone(buildPlan());
    broken.organizations[0].stockTransfers[0].toLocationName = 'Sede fantasma';

    expect(() => assertTestOrgsPlan(broken)).toThrow(/unknown location/);
  });

  it('rejects a site stock entry larger than the product stock', () => {
    const broken = structuredClone(buildPlan());
    broken.organizations[0].siteStock[0].quantity = 100_000;

    expect(() => assertTestOrgsPlan(broken)).toThrow(/[Ss]ite stock/);
  });

  it('rejects a duplicated slug across organizations', () => {
    const broken = structuredClone(buildPlan());
    broken.organizations[1].organization.slug =
      broken.organizations[0].organization.slug;

    expect(() => assertTestOrgsPlan(broken)).toThrow(/Duplicate organization/);
  });

  it('writes the test-org primary owner as ADMIN in the seed entry point', () => {
    const source = readFileSync(
      resolve(__dirname, '../../prisma', 'seed-test-orgs.ts'),
      'utf8',
    );

    expect(source).not.toContain('OrgRole.OWNER');
    expect(source).toContain('isPrimaryOwner');
  });

  it('replaces the superseded seeds with the single test-orgs entry point', () => {
    for (const removed of [
      'seed.ts',
      'seed-org.ts',
      'seed-sandbox.ts',
      'seed-demo-activity.ts',
    ]) {
      expect(existsSync(resolve(__dirname, '../../prisma', removed))).toBe(
        false,
      );
    }
    expect(existsSync(resolve(__dirname, '../../prisma', 'seed-e2e.ts'))).toBe(
      true,
    );
  });
});
