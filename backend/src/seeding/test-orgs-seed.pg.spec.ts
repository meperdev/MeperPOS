import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { checkDisposableDatabaseUrl } from './disposable-database';
import {
  buildTestOrgsSeedPlan,
  type TestOrgPlan,
  type TestOrgsSeedPlan,
} from './test-orgs-seed.plan';

/**
 * The writer proof: it runs the real CLI twice against a migrated, disposable
 * PostgreSQL database and checks what landed.
 *
 * Skipped unless `SEED_TEST_ORGS_PG_URL` names a dedicated database. A URL that
 * points at `inventario_db` or at port 5432 is refused loudly instead of
 * silently skipped, because a misconfigured run would otherwise write test
 * organizations into the development server.
 *
 * Each run creates its own database on the supplied server, so the spec can be
 * re-run without a manual cleanup.
 */

const RAW_URL = process.env.SEED_TEST_ORGS_PG_URL?.trim();
const TARGET = RAW_URL ? checkDisposableDatabaseUrl(RAW_URL) : null;

if (TARGET && !TARGET.ok) {
  throw new Error(
    `SEED_TEST_ORGS_PG_URL refused: ${TARGET.reason}. Point it at a disposable PostgreSQL container.`,
  );
}

const describeWithDatabase = TARGET?.ok ? describe : describe.skip;

jest.setTimeout(600_000);

const backendRoot = path.resolve(__dirname, '../..');
const cli = path.join(backendRoot, 'prisma', 'seed-test-orgs.ts');
const tsNode = path.join(backendRoot, 'node_modules', '.bin', 'ts-node');
const prismaBin = path.join(backendRoot, 'node_modules', '.bin', 'prisma');

const SEED_PASSWORD = 'Clave-De-Prueba-2026';
const SUPER_ADMIN_PASSWORD = 'SuperAdmin-De-Prueba-2026';

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(databaseUrl: string, args: string[] = []): RunResult {
  try {
    const stdout = execFileSync(tsNode, [cli, ...args], {
      cwd: backendRoot,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? '',
        NODE_ENV: 'development',
        DATABASE_URL: databaseUrl,
        SEED_TEST_ORG_PASSWORD: SEED_PASSWORD,
        SUPER_ADMIN_PASSWORD,
      },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 300_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/** One `key=value` block per organization, as the CLI reports it. */
function parseAppliedCounts(stdout: string): Map<string, Map<string, number>> {
  const bySlug = new Map<string, Map<string, number>>();

  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\S+ (prueba-[a-z]+): created — (.*)$/.exec(line.trim());
    if (!match) continue;
    const counts = new Map<string, number>();
    for (const pair of match[2].split(',')) {
      const [key, raw] = pair.trim().split('=');
      if (!key || raw === undefined) continue;
      // The last pair of the line carries the transaction note after the value.
      const value = raw.replace(/(?<=\d)[^0-9].*$/, '');
      counts.set(key, Number(value));
    }
    bySlug.set(match[1], counts);
  }

  return bySlug;
}

function orgBySlug(plan: TestOrgsSeedPlan, slug: string): TestOrgPlan {
  const found = plan.organizations.find(
    (row) => row.organization.slug === slug,
  );
  if (!found) throw new Error(`Missing planned organization ${slug}`);
  return found;
}

describeWithDatabase('test organizations seed writer (PostgreSQL)', () => {
  const plan = buildTestOrgsSeedPlan();
  const pro = orgBySlug(plan, 'prueba-pro');
  const basic = orgBySlug(plan, 'prueba-basic');

  const databaseName = `tos_seed_${process.pid}_${Date.now()}`;
  // Built in beforeAll, never at collection time: Jest runs the body of a
  // skipped describe to collect its tests, and without SEED_TEST_ORGS_PG_URL
  // (CI) parsing it here would fail the whole suite instead of skipping it.
  let serverUrl: URL;
  let databaseUrl: string;

  let prisma: PrismaClient;

  beforeAll(async () => {
    serverUrl = new URL(RAW_URL as string);
    const url = new URL(serverUrl.toString());
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();

    const maintenance = new PrismaClient({
      datasources: { db: { url: serverUrl.toString() } },
    });
    try {
      await maintenance.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    } finally {
      await maintenance.$disconnect();
    }

    execFileSync(
      prismaBin,
      ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      {
        cwd: backendRoot,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          DATABASE_URL: databaseUrl,
        },
        stdio: 'pipe',
        timeout: 300_000,
      },
    );

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();

    const maintenance = new PrismaClient({
      datasources: { db: { url: serverUrl.toString() } },
    });
    try {
      await maintenance.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
    } finally {
      await maintenance.$disconnect();
    }
  });

  it('refuses a foreign organization holding the prueba-pro slug, writing nothing', async () => {
    const foreignUser = await prisma.user.create({
      data: {
        email: 'foreign@example.test',
        name: 'Foreign Owner',
        password: 'x',
      },
    });
    const foreignOrg = await prisma.organization.create({
      data: {
        name: 'Prueba PRO',
        slug: 'prueba-pro',
        plan: 'PRO',
        status: 'ACTIVE',
        billingStatus: 'PAID',
      },
    });
    await prisma.organizationUser.create({
      data: {
        userId: foreignUser.id,
        organizationId: foreignOrg.id,
        role: 'ADMIN',
        isPrimaryOwner: true,
      },
    });

    const result = runCli(databaseUrl, ['--apply']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to adopt it');
    // The preflight refuses before the first write: the other target was not
    // created either.
    expect(
      await prisma.organization.count({ where: { slug: 'prueba-basic' } }),
    ).toBe(0);

    // Leave the disposable database in a state where the seed may run.
    await prisma.organization.delete({ where: { id: foreignOrg.id } });
  });

  it('creates both organizations and leaves an unrelated organization untouched', async () => {
    const probeOrg = await prisma.organization.create({
      data: {
        name: 'Organización ajena',
        slug: 'org-ajena',
        plan: 'PRO',
        status: 'ACTIVE',
        billingStatus: 'PAID',
        locations: { create: { name: 'Sede principal', isDefault: true } },
      },
    });
    const probeCategory = await prisma.category.create({
      data: {
        organizationId: probeOrg.id,
        name: 'Bebidas',
        taxable: true,
        defaultTaxRate: 19,
      },
    });
    const probeProduct = await prisma.product.create({
      data: {
        organizationId: probeOrg.id,
        categoryId: probeCategory.id,
        name: 'Agua ajena',
        sku: 'AJENA-001',
        costPrice: 100,
        salePrice: 200,
        taxRate: 19,
        stock: 5,
        minStock: 1,
      },
    });

    const result = runCli(databaseUrl, ['--apply']);
    expect(result.status).toBe(0);

    for (const row of plan.organizations) {
      const organization = await prisma.organization.findUnique({
        where: { slug: row.organization.slug },
        select: {
          name: true,
          plan: true,
          users: {
            select: {
              role: true,
              isPrimaryOwner: true,
              user: { select: { email: true } },
            },
          },
        },
      });
      expect(organization).toEqual({
        name: row.organization.name,
        plan: row.organization.plan,
        users: [
          {
            role: 'ADMIN',
            isPrimaryOwner: true,
            user: { email: row.users[0].email },
          },
        ],
      });
    }

    // The writer's own counts must match the database, section by section.
    const applied = parseAppliedCounts(result.stdout);
    const expectations: [string, string, number][] = [
      ['prueba-pro', 'categories', pro.categories.length],
      ['prueba-pro', 'products', pro.products.length],
      ['prueba-pro', 'customers', pro.customers.length],
      ['prueba-pro', 'suppliers', pro.suppliers.length],
      ['prueba-pro', 'purchaseOrders', pro.purchaseOrders.length],
      ['prueba-pro', 'stockTransfers', pro.stockTransfers.length],
      ['prueba-pro', 'inventoryLoans', pro.inventoryLoans.length],
      ['prueba-pro', 'employees', pro.employees.length],
      ['prueba-pro', 'moneyLoans', pro.moneyLoans.length],
      ['prueba-pro', 'tasks', pro.tasks.length],
      ['prueba-pro', 'locations', pro.organization.locations.length],
      ['prueba-basic', 'categories', basic.categories.length],
      ['prueba-basic', 'products', basic.products.length],
      ['prueba-basic', 'customers', basic.customers.length],
      ['prueba-basic', 'purchaseOrders', basic.purchaseOrders.length],
      ['prueba-basic', 'stockTransfers', 0],
      ['prueba-basic', 'employees', 0],
      ['prueba-basic', 'cashRegisters', 1],
    ];
    for (const [slug, section, expected] of expectations) {
      expect({
        slug,
        section,
        count: applied.get(slug)?.get(section) ?? 0,
      }).toEqual({ slug, section, count: expected });
    }

    // Plan-limit ceilings hold on the written rows, not only on the plan.
    const basicOrg = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'prueba-basic' },
      select: { id: true },
    });
    expect(
      await prisma.product.count({
        where: { organizationId: basicOrg.id, active: true },
      }),
    ).toBeLessThanOrEqual(100);
    expect(
      await prisma.customer.count({
        where: { organizationId: basicOrg.id, active: true },
      }),
    ).toBeLessThanOrEqual(50);
    expect(
      await prisma.cashRegister.count({
        where: { organizationId: basicOrg.id, active: true },
      }),
    ).toBe(1);

    // Exactly one sent purchase order, with the frozen document snapshot.
    const proOrg = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'prueba-pro' },
      select: { id: true },
    });
    const sent = await prisma.purchaseOrder.findMany({
      where: { organizationId: proOrg.id, sentAt: { not: null } },
      select: { documentSnapshot: true, sentAt: true },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].documentSnapshot).toMatchObject({
      version: 1,
      business: { name: 'Prueba PRO' },
      supplier: { documentNumber: '900765432-2' },
      preparedBy: 'Administrador Prueba PRO',
      template: { paymentTerms: 'Pago a 30 días' },
    });

    // The per-site ledger and the received transfer.
    const siteRows = await prisma.productStock.findMany({
      where: {
        organizationId: proOrg.id,
        location: { name: 'Sucursal Norte' },
      },
      select: {
        stock: true,
        product: { select: { sku: true, stock: true } },
      },
      orderBy: { product: { sku: 'asc' } },
    });
    expect(siteRows.map((row) => row.product.sku)).toEqual([
      'ASE-002',
      'BEB-001',
    ]);
    for (const row of siteRows) {
      const planned = pro.products.find(
        (product) => product.sku === row.product.sku,
      );
      expect(row.product.stock).toBe(planned?.stock);
    }

    // The triggers keep every aggregate equal to the sum of its site rows.
    const ledger = await prisma.productStock.findMany({
      where: { organizationId: proOrg.id },
      select: {
        stock: true,
        product: { select: { sku: true, stock: true } },
      },
    });
    const siteSum = new Map<string, number>();
    for (const row of ledger) {
      siteSum.set(
        row.product.sku,
        (siteSum.get(row.product.sku) ?? 0) + row.stock,
      );
    }
    for (const row of ledger) {
      expect(siteSum.get(row.product.sku)).toBe(row.product.stock);
    }

    const transfers = await prisma.stockTransfer.findMany({
      where: { organizationId: proOrg.id },
      select: { status: true, items: { select: { id: true } } },
    });
    expect(transfers).toHaveLength(1);
    expect(transfers[0].status).toBe('RECEIVED');
    expect(transfers[0].items).toHaveLength(pro.stockTransfers[0].items.length);

    expect(
      await prisma.inventoryLoan.count({
        where: { organizationId: proOrg.id },
      }),
    ).toBe(1);

    expect(
      await prisma.user.count({
        where: { email: 'admin@sistema.com', isSuperAdmin: true },
      }),
    ).toBe(1);

    const unrelated = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'org-ajena' },
      select: {
        name: true,
        _count: { select: { products: true } },
        products: { where: { id: probeProduct.id }, select: { stock: true } },
      },
    });
    expect(unrelated).toEqual({
      name: 'Organización ajena',
      _count: { products: 1 },
      products: [{ stock: 5 }],
    });
  });

  it('skips both organizations on a second run without changing a row', async () => {
    const snapshot = async () => ({
      products: await prisma.product.count(),
      sales: await prisma.sale.count(),
      movements: await prisma.inventoryMovement.count(),
      productStock: await prisma.productStock.count(),
      users: await prisma.user.count(),
    });
    const before = await snapshot();

    const result = runCli(databaseUrl, ['--apply']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('already present');
    expect(result.stdout).toContain(
      '0 organization(s) created, 2 already present',
    );

    expect(await snapshot()).toEqual(before);
  });

  it('reports per-section counts and plan-limit usage in --verify mode', () => {
    const result = runCli(databaseUrl, ['--verify']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Prueba PRO (prueba-pro, plan PRO)');
    expect(result.stdout).toContain('Prueba BASIC (prueba-basic, plan BASIC)');
    expect(result.stdout).toContain('sent purchase orders: 1');
    expect(result.stdout).toContain('plan limit products: 12/100');
    expect(result.stdout).toContain('plan limit cashRegisters: 1/1');
    expect(result.stdout).toContain('plan limit users: 1/3');
    expect(result.stdout).toContain('plan limit products: 26 (sin límite)');
  });
});
