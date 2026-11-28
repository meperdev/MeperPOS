import { Prisma, PrismaClient } from '@prisma/client';
import {
  applyCleanup,
  cleanupScopedWhere,
  disableDeleteTriggers,
  enableDeleteTriggers,
  listScopedTables,
  loadCleanupSnapshot,
  loadTriggerAudit,
} from './org-cleanup.database';
import {
  DELETE_BLOCKING_TRIGGERS,
  ORG_CLEANUP_STEPS,
  planCleanup,
  planDigest,
  protectedNameList,
} from './org-cleanup.plan';

/**
 * Production-shaped end-to-end cleanup (odd/tasks/test-accounts-reset.md, L5).
 *
 * One database, five organizations and two SuperAdmins, built to mirror what
 * production actually holds: four targets (Test Org, Tu estilo, a
 * Mercado-Central-shaped one and a Cosméticos-Aurora-shaped one) and the
 * protected «Motors Club», which keeps trading during the run. The test goes
 * through the same entry the CLI uses (`loadCleanupSnapshot` → `planCleanup` →
 * `applyCleanup`) and proves that a real cleanup leaves Motors Club
 * byte-identical while every target table is empty.
 *
 * Grew out of the verifier's attempt to run this shape by hand: the fixtures
 * here satisfy every CHECK and trigger of the payroll, POS-loan and
 * inventory-loan foundations, including the append-only history tables.
 *
 * Runs as a NON-SUPERUSER table owner (Supabase shape) against a disposable
 * database with `prisma migrate deploy` applied. Setup is the same as
 * `org-cleanup.postgres.spec.ts`; see its header for the exact roles/commands.
 */
jest.setTimeout(180_000);

const databaseUrl = process.env.ORG_CLEANUP_PG_URL;

function parseDisposableUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('ORG_CLEANUP_PG_URL must be a postgresql:// URL');
  }
  if (!url.port) {
    throw new Error('ORG_CLEANUP_PG_URL must carry an explicit port');
  }
  if (url.port === '5432') {
    throw new Error('ORG_CLEANUP_PG_URL must not use port 5432');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('ORG_CLEANUP_PG_URL must name a database');
  if (database === 'inventario_db') {
    throw new Error('ORG_CLEANUP_PG_URL must not target inventario_db');
  }
  const host = url.hostname;
  const loopback =
    host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const privateRange =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    (() => {
      const match = /^172\.(\d{1,3})\./.exec(host);
      return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
    })();
  if (!loopback && !privateRange) {
    throw new Error(
      `ORG_CLEANUP_PG_URL host "${host}" is not a local or private address`,
    );
  }
  return url;
}

interface OrgFixture {
  readonly id: string;
  readonly name: string;
  readonly locationId: string;
  readonly warehouseId: string;
  readonly categoryId: string;
  readonly productIds: string[];
  readonly customerId: string;
  readonly adminUserId: string;
  readonly cashierUserIds: string[];
}

interface ProductionWorld {
  readonly testOrg: OrgFixture;
  readonly tuEstilo: OrgFixture;
  readonly mercado: OrgFixture;
  readonly cosmeticos: OrgFixture;
  readonly motors: OrgFixture;
  readonly superAdminToDelete: { id: string; email: string };
  readonly superAdminKept: { id: string; email: string };
  readonly memberEmails: string[];
  readonly allOrgIds: string[];
}

const PASSWORD = '$2b$10$fixture-only-not-a-real-hash';

(databaseUrl ? describe : describe.skip)(
  'organization cleanup, production shape (real PostgreSQL)',
  () => {
    const label = `org-cleanup-shape-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    let prisma: PrismaClient;
    let world: ProductionWorld;

    beforeAll(async () => {
      const url = parseDisposableUrl(databaseUrl!);
      prisma = new PrismaClient({ datasourceUrl: url.href });
      const [privileges] = await prisma.$queryRaw<{ superuser: boolean }[]>`
        SELECT rolsuper AS "superuser" FROM pg_roles WHERE rolname = current_user`;
      expect(privileges.superuser).toBe(false);
      world = await seedProductionWorld(prisma, label);
    });

    afterAll(async () => {
      if (!prisma) return;
      await tearDown(prisma, world);
      await prisma.$disconnect();
    });

    it('deletes the four production-shaped targets and leaves Motors Club byte-identical', async () => {
      const targetIds = [
        world.testOrg.id,
        world.tuEstilo.id,
        world.mercado.id,
        world.cosmeticos.id,
      ];
      const targetNames = [
        world.testOrg.name,
        world.tuEstilo.name,
        world.mercado.name,
        world.cosmeticos.name,
      ];

      const snapshot = await loadCleanupSnapshot(prisma, {
        orgIds: targetIds,
        deleteUserEmails: [world.superAdminToDelete.email],
      });
      const plan = planCleanup(
        {
          orgIds: targetIds,
          deleteUserEmails: [world.superAdminToDelete.email],
          apply: true,
          confirmation: targetNames.join(','),
          protectedNames: protectedNameList(undefined),
        },
        snapshot,
      );

      expect(plan.refusals).toEqual([]);
      expect(plan.confirmation).toBe(targetNames.join(','));
      expect(plan.deleteUsers.map((user) => user.email).sort()).toEqual(
        [...world.memberEmails, world.superAdminToDelete.email].sort(),
      );

      const protectedBefore = await fingerprint(prisma, world.motors.id);
      // The fingerprint must be able to see a change: the protected tenant is
      // not empty in any of these.
      expect(protectedBefore['Sale']).not.toBe('');
      expect(protectedBefore['MoneyLoanEvent']).not.toBe('');
      expect(protectedBefore['Product']).not.toBe('');
      expect(protectedBefore['#Product.stock']).not.toBe('');
      expect(protectedBefore['#ProductStock']).not.toBe('');
      const result = await applyCleanup(prisma, plan, {
        expectedDigest: planDigest(plan),
        request: {
          orgIds: targetIds,
          deleteUserEmails: [world.superAdminToDelete.email],
          apply: true,
          confirmation: targetNames.join(','),
          protectedNames: protectedNameList(undefined),
        },
      });
      const protectedAfter = await fingerprint(prisma, world.motors.id);

      // 1. Motors Club is byte-identical: every scoped table, plus the aggregate
      //    and per-site stock values the cleanup's deletes could disturb.
      expect(protectedBefore).toEqual(protectedAfter);
      expect(result.protectedOrgs.changed).toBe(false);
      expect(result.verification.triggers).toMatchObject({
        restored: true,
        offenders: [],
        checked: 16,
      });
      expect(result.verification.failures).toEqual([]);

      // 2. Zero rows for the targets in every table that carries an
      //    organizationId, discovered from the catalogue rather than a list.
      const scopedTables = (await listScopedTables(prisma)).sort();
      // Every table that carries an organizationId is part of the plan; the only
      // exception is the fiscal document table, which a target is refused for.
      const plannedTables = new Set(
        ORG_CLEANUP_STEPS.map((step) => step.table),
      );
      expect(scopedTables.filter((table) => !plannedTables.has(table))).toEqual(
        ['FiscalDocument'],
      );
      for (const table of scopedTables) {
        const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
          `SELECT count(*)::int AS "count" FROM "${table}" WHERE "organizationId" = ANY($1::text[])`,
          targetIds,
        );
        expect({ table, count: Number(rows[0]?.count ?? -1) }).toEqual({
          table,
          count: 0,
        });
      }
      expect(
        await prisma.organization.count({ where: { id: { in: targetIds } } }),
      ).toBe(0);

      // 3. Only the orphaned members and the requested SuperAdmin are gone; the
      //    other SuperAdmin and every Motors Club account survives.
      const survivorIds = [
        world.motors.adminUserId,
        ...world.motors.cashierUserIds,
        world.superAdminKept.id,
      ];
      const remainingUsers = await prisma.user.findMany({
        select: { id: true },
      });
      expect(remainingUsers.map((user) => user.id).sort()).toEqual(
        [...survivorIds].sort(),
      );
      expect(
        await prisma.user.count({
          where: { email: world.superAdminToDelete.email },
        }),
      ).toBe(0);

      // 4. Every history trigger is back on.
      const audit = await loadTriggerAudit(prisma);
      expect(audit.missing).toEqual([]);
      expect(audit.disabled).toEqual([]);
      expect(audit.unexpected).toEqual([]);
      expect(audit.unowned).toEqual([]);
      const byName = (
        left: { table: string; trigger: string },
        right: { table: string; trigger: string },
      ) =>
        `${left.table}.${left.trigger}`.localeCompare(
          `${right.table}.${right.trigger}`,
        );
      expect(
        audit.found
          .filter((trigger) =>
            DELETE_BLOCKING_TRIGGERS.some(
              (guard) =>
                guard.table === trigger.table &&
                guard.trigger === trigger.trigger,
            ),
          )
          .sort(byName),
      ).toEqual(
        DELETE_BLOCKING_TRIGGERS.map((guard) => ({
          table: guard.table,
          trigger: guard.trigger,
          enabled: true,
        })).sort(byName),
      );
    });
  },
);

// ─── Fingerprint ───────────────────────────────────────────────────────────

/**
 * md5 of every row of every table that carries an `organizationId`, for one
 * organization, plus the aggregate and per-site stock values. Two reads of an
 * untouched tenant produce the same map; one changed byte anywhere does not.
 */
async function fingerprint(
  prisma: PrismaClient,
  organizationId: string,
): Promise<Record<string, string>> {
  const tables = (await listScopedTables(prisma)).sort();
  const digest: Record<string, string> = {};
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe<{ digest: string }[]>(
      `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS "digest"
       FROM "${table}" x WHERE x."organizationId" = $1`,
      organizationId,
    );
    digest[table] = rows[0]?.digest ?? '';
  }
  const stock = await prisma.$queryRawUnsafe<{ digest: string }[]>(
    `SELECT md5(coalesce(string_agg(x."id" || ':' || x."stock" || ':' || x."reservedStock", ',' ORDER BY x."id"), '')) AS "digest"
     FROM "Product" x WHERE x."organizationId" = $1`,
    organizationId,
  );
  const siteStock = await prisma.$queryRawUnsafe<{ digest: string }[]>(
    `SELECT md5(coalesce(string_agg(x."productId" || ':' || x."locationId" || ':' || x."stock" || ':' || x."reservedStock", ',' ORDER BY x."productId", x."locationId"), '')) AS "digest"
     FROM "ProductStock" x WHERE x."organizationId" = $1`,
    organizationId,
  );
  digest['#Product.stock'] = stock[0]?.digest ?? '';
  digest['#ProductStock'] = siteStock[0]?.digest ?? '';
  return digest;
}

// ─── Fixture ───────────────────────────────────────────────────────────────

async function createUser(
  prisma: PrismaClient,
  label: string,
  key: string,
  options: { superAdmin?: boolean } = {},
): Promise<{ id: string; email: string }> {
  const email = `${label}-${key}@example.test`;
  const user = await prisma.user.create({
    data: {
      email,
      password: PASSWORD,
      name: key,
      isSuperAdmin: options.superAdmin ?? false,
    },
    select: { id: true, email: true },
  });
  return user;
}

async function createOrgBase(
  prisma: PrismaClient,
  label: string,
  name: string,
  withProducts: number,
  adminEmails: string[],
): Promise<OrgFixture> {
  const organization = await prisma.organization.create({
    data: {
      name,
      slug: `${label}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    },
    select: { id: true },
  });
  const location = await prisma.location.create({
    data: {
      organizationId: organization.id,
      name: 'Principal',
      isDefault: true,
    },
    select: { id: true },
  });
  const warehouse = await prisma.location.create({
    data: {
      organizationId: organization.id,
      name: 'Bodega',
      type: 'WAREHOUSE',
    },
    select: { id: true },
  });
  const category = await prisma.category.create({
    data: { organizationId: organization.id, name: 'General' },
    select: { id: true },
  });
  const productIds: string[] = [];
  for (let index = 0; index < withProducts; index += 1) {
    const product = await prisma.product.create({
      data: {
        organizationId: organization.id,
        categoryId: category.id,
        name: `Producto ${index + 1}`,
        sku: `${label}-${name.slice(0, 8)}-${index + 1}`,
        costPrice: '100.00',
        salePrice: '150.00',
        stock: 10,
        imageUrl:
          index === 0
            ? 'https://res.cloudinary.com/demo/image/upload/producto.png'
            : null,
      },
      select: { id: true },
    });
    productIds.push(product.id);
  }
  const customer = await prisma.customer.create({
    data: {
      organizationId: organization.id,
      name: 'Cliente',
      documentType: 'CC',
      documentNumber: `${label}-${name.slice(0, 8)}`,
    },
    select: { id: true },
  });
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 12);
  const admin = await createUser(prisma, label, `${key}-admin`);
  adminEmails.push(admin.email);
  await prisma.organizationUser.create({
    data: {
      organizationId: organization.id,
      userId: admin.id,
      role: 'ADMIN',
      isPrimaryOwner: true,
    },
  });
  return {
    id: organization.id,
    name,
    locationId: location.id,
    warehouseId: warehouse.id,
    categoryId: category.id,
    productIds,
    customerId: customer.id,
    adminUserId: admin.id,
    cashierUserIds: [],
  };
}

async function createSale(
  prisma: PrismaClient,
  org: OrgFixture,
  saleNumber: number,
  userId: string,
): Promise<{ id: string }> {
  const productId = org.productIds[0];
  const sale = await prisma.sale.create({
    data: {
      organizationId: org.id,
      saleNumber,
      customerId: org.customerId,
      userId,
      subtotal: '100.00',
      taxAmount: '19.00',
      total: '119.00',
      amountPaid: '119.00',
      status: 'COMPLETED',
    },
    select: { id: true },
  });
  await prisma.saleItem.create({
    data: {
      organizationId: org.id,
      saleId: sale.id,
      productId,
      quantity: 1,
      unitPrice: '100.00',
      taxRate: '19.00',
      subtotal: '100.00',
      total: '119.00',
    },
  });
  await prisma.payment.create({
    data: {
      organizationId: org.id,
      saleId: sale.id,
      method: 'CASH',
      amount: '119.00',
    },
  });
  await prisma.saleOriginSite.create({
    data: {
      organizationId: org.id,
      saleId: sale.id,
      locationId: org.locationId,
    },
  });
  return sale;
}

async function createExpenseTaxonomy(
  prisma: PrismaClient,
  org: OrgFixture,
): Promise<{ labelId: string }> {
  const group = await prisma.expenseGroup.create({
    data: { organizationId: org.id, name: 'Operación' },
    select: { id: true },
  });
  const label = await prisma.expenseLabel.create({
    data: { organizationId: org.id, groupId: group.id, name: 'Nómina' },
    select: { id: true },
  });
  return { labelId: label.id };
}

async function createEmployee(
  prisma: PrismaClient,
  org: OrgFixture,
  name: string,
): Promise<{ id: string }> {
  return prisma.employee.create({
    data: { organizationId: org.id, name },
    select: { id: true },
  });
}

/**
 * A payroll obligation with its grouped shift, one cash payment and its
 * mirrored expense link — the shape the payroll foundation accepts.
 */
async function createPayrollWithPayment(
  prisma: PrismaClient,
  org: OrgFixture,
  labelId: string,
): Promise<void> {
  const employee = await createEmployee(prisma, org, 'Empleado nómina');
  const shift = await prisma.employeeShift.create({
    data: {
      organizationId: org.id,
      employeeId: employee.id,
      date: new Date('2026-10-01T00:00:00.000Z'),
      kind: 'FULL_DAY',
      amount: '80.00',
    },
    select: { id: true },
  });
  const obligation = await prisma.payrollObligation.create({
    data: {
      organizationId: org.id,
      employeeId: employee.id,
      kind: 'SHIFT_GROUP',
      status: 'PENDING',
    },
    select: { id: true },
  });
  await prisma.payrollShiftMembership.create({
    data: {
      organizationId: org.id,
      employeeId: employee.id,
      shiftId: shift.id,
      obligationId: obligation.id,
    },
  });
  const outflow = await prisma.payrollCashOutflow.create({
    data: {
      organizationId: org.id,
      employeeId: employee.id,
      actorId: org.adminUserId,
      amount: '80.00',
      date: new Date('2026-10-02T00:00:00.000Z'),
      method: 'CASH',
    },
    select: { id: true },
  });
  await prisma.payrollInstallment.create({
    data: {
      organizationId: org.id,
      employeeId: employee.id,
      obligationId: obligation.id,
      outflowId: outflow.id,
      sequence: 1,
    },
  });
  const expense = await prisma.expense.create({
    data: {
      organizationId: org.id,
      labelId,
      date: new Date('2026-10-02T00:00:00.000Z'),
      total: '80.00',
      status: 'PAID',
      createdById: org.adminUserId,
    },
    select: { id: true },
  });
  await prisma.expensePayment.create({
    data: {
      organizationId: org.id,
      expenseId: expense.id,
      amount: '80.00',
      method: 'CASH',
      date: new Date('2026-10-02T00:00:00.000Z'),
    },
  });
  await prisma.payrollObligationExpense.create({
    data: {
      organizationId: org.id,
      employeeId: employee.id,
      obligationId: obligation.id,
      expenseId: expense.id,
    },
  });
}

async function createPayrollPending(
  prisma: PrismaClient,
  org: OrgFixture,
): Promise<void> {
  const employee = await createEmployee(prisma, org, 'Empleado pendiente');
  await prisma.payrollObligation.create({
    data: {
      organizationId: org.id,
      employeeId: employee.id,
      kind: 'SHIFT_GROUP',
      status: 'PENDING',
    },
  });
}

async function seedProductionWorld(
  prisma: PrismaClient,
  label: string,
): Promise<ProductionWorld> {
  const adminEmails: string[] = [];
  // ── Test Org: a member, products with images and sales ──────────────────
  const testOrg = await createOrgBase(
    prisma,
    label,
    'Test Org',
    3,
    adminEmails,
  );
  await createSale(prisma, testOrg, 1, testOrg.adminUserId);
  await createSale(prisma, testOrg, 2, testOrg.adminUserId);

  // ── Tu estilo: empty apart from its member ─────────────────────────────
  const tuEstilo = await createOrgBase(
    prisma,
    label,
    'Tu estilo',
    0,
    adminEmails,
  );

  // ── Mercado Central: every module the API delete cannot handle ─────────
  const mercado = await createOrgBase(
    prisma,
    label,
    'Mercado Central',
    2,
    adminEmails,
  );
  const cashiers: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const cashier = await createUser(
      prisma,
      label,
      `mercado-caja-${index + 1}`,
    );
    await prisma.organizationUser.create({
      data: {
        organizationId: mercado.id,
        userId: cashier.id,
        role: 'CASHIER',
      },
    });
    cashiers.push(cashier.id);
    adminEmails.push(cashier.email);
  }
  const mercadoWithStaff: OrgFixture = {
    ...mercado,
    cashierUserIds: cashiers,
  };
  const mercadoTaxonomy = await createExpenseTaxonomy(prisma, mercadoWithStaff);
  await createPayrollWithPayment(
    prisma,
    mercadoWithStaff,
    mercadoTaxonomy.labelId,
  );
  await createPayrollPending(prisma, mercadoWithStaff);

  // Money loan with its first event, plus the POS intent opened on it.
  const moneyLoan = await prisma.moneyLoan.create({
    data: {
      organizationId: mercado.id,
      amount: '200.00',
      issuedAt: new Date('2026-10-01T00:00:00.000Z'),
      reason: 'Préstamo de prueba',
      customerId: mercado.customerId,
      createdById: mercado.adminUserId,
    },
    select: { id: true },
  });
  await prisma.moneyLoanEvent.create({
    data: {
      organizationId: mercado.id,
      loanId: moneyLoan.id,
      type: 'CREATED',
      reason: 'Préstamo creado',
      createdById: mercado.adminUserId,
    },
  });
  await prisma.posLoanSaleIntent.create({
    data: {
      organizationId: mercado.id,
      loanId: moneyLoan.id,
      customerId: mercado.customerId,
    },
  });

  // Site stock on two sites, a transfer and a stock alert.
  await prisma.productStock.create({
    data: {
      organizationId: mercado.id,
      productId: mercado.productIds[0],
      locationId: mercado.warehouseId,
      stock: 4,
      reservedStock: 0,
    },
  });
  const transfer = await prisma.stockTransfer.create({
    data: {
      organizationId: mercado.id,
      number: 1,
      fromLocationId: mercado.locationId,
      toLocationId: mercado.warehouseId,
      createdById: mercado.adminUserId,
    },
    select: { id: true },
  });
  await prisma.stockTransferItem.create({
    data: {
      organizationId: mercado.id,
      transferId: transfer.id,
      productId: mercado.productIds[0],
      quantity: 1,
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      organizationId: mercado.id,
      productId: mercado.productIds[0],
      type: 'ADJUSTMENT_IN',
      quantity: 1,
      previousStock: 0,
      newStock: 1,
      reason: 'Carga inicial',
      userId: mercado.adminUserId,
      locationId: mercado.locationId,
    },
  });
  await prisma.productStockAlert.create({
    data: {
      organizationId: mercado.id,
      productId: mercado.productIds[1],
      state: 'OPEN',
      stockAtOpen: 1,
      minStockAtOpen: 3,
    },
  });
  await prisma.productStockAlertEvent.create({
    data: {
      organizationId: mercado.id,
      productId: mercado.productIds[1],
      episode: 1,
      kind: 'OPENED',
    },
  });

  // Inventory loan built through valid states: created, delivered on one item.
  const inventoryLoan = await prisma.inventoryLoan.create({
    data: {
      organizationId: mercado.id,
      customerId: mercado.customerId,
      createdById: mercado.adminUserId,
    },
    select: { id: true },
  });
  await prisma.inventoryLoanOperation.create({
    data: {
      organizationId: mercado.id,
      loanId: inventoryLoan.id,
      actorId: mercado.adminUserId,
      type: 'CREATE',
      requestKey: `${label}-inventory-create`,
      requestPayload: { fixture: true },
      resultSnapshot: { loanId: inventoryLoan.id },
    },
  });
  const inventoryItem = await prisma.inventoryLoanItem.create({
    data: {
      organizationId: mercado.id,
      loanId: inventoryLoan.id,
      productId: mercado.productIds[0],
      quantity: 3,
      deliveredQuantity: 2,
    },
    select: { id: true },
  });
  await prisma.inventoryLoanEvent.create({
    data: {
      organizationId: mercado.id,
      loanId: inventoryLoan.id,
      type: 'CREATED',
      createdById: mercado.adminUserId,
    },
  });
  await prisma.inventoryLoanEvent.create({
    data: {
      organizationId: mercado.id,
      loanId: inventoryLoan.id,
      itemId: inventoryItem.id,
      type: 'DELIVERED',
      quantity: 2,
      createdById: mercado.adminUserId,
    },
  });

  // Suppliers, a purchase order, a task, expenses and sales.
  const supplier = await prisma.supplier.create({
    data: {
      organizationId: mercado.id,
      name: 'Proveedor',
      documentNumber: `${label}-mercado-nit`,
    },
    select: { id: true },
  });
  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      organizationId: mercado.id,
      orderNumber: 1,
      supplierId: supplier.id,
      createdById: mercado.adminUserId,
      status: 'PENDING',
    },
    select: { id: true },
  });
  await prisma.purchaseOrderItem.create({
    data: {
      organizationId: mercado.id,
      purchaseOrderId: purchaseOrder.id,
      productId: mercado.productIds[0],
      qtyOrdered: 5,
      unitCost: '80.00',
      subtotal: '400.00',
    },
  });
  const task = await prisma.task.create({
    data: {
      organizationId: mercado.id,
      title: 'Revisar inventario',
      createdById: mercado.adminUserId,
      assignedToId: mercado.adminUserId,
    },
    select: { id: true },
  });
  await prisma.taskEvent.create({
    data: {
      organizationId: mercado.id,
      taskId: task.id,
      type: 'CREATED',
      toStatus: 'PENDING',
      createdById: mercado.adminUserId,
    },
  });
  const expense = await prisma.expense.create({
    data: {
      organizationId: mercado.id,
      labelId: mercadoTaxonomy.labelId,
      supplierId: supplier.id,
      date: new Date('2026-10-03T00:00:00.000Z'),
      total: '50.00',
      status: 'PAID',
      createdById: mercado.adminUserId,
    },
    select: { id: true },
  });
  await prisma.expensePayment.create({
    data: {
      organizationId: mercado.id,
      expenseId: expense.id,
      amount: '50.00',
      method: 'CASH',
      date: new Date('2026-10-03T00:00:00.000Z'),
    },
  });
  await createSale(prisma, mercadoWithStaff, 1, mercado.adminUserId);
  await createSale(prisma, mercadoWithStaff, 2, cashiers[0]);
  await prisma.whatsAppConnection.create({
    data: {
      organizationId: mercado.id,
      channel: 'COMMERCIAL',
      sessionName: `${label}-mercado`,
      status: 'WORKING',
    },
  });

  // ── Cosméticos Aurora: employees, payroll and money loans ──────────────
  const cosmeticos = await createOrgBase(
    prisma,
    label,
    'Cosméticos Aurora',
    1,
    adminEmails,
  );
  const cosmeticosTaxonomy = await createExpenseTaxonomy(prisma, cosmeticos);
  await createPayrollWithPayment(
    prisma,
    cosmeticos,
    cosmeticosTaxonomy.labelId,
  );
  await createPayrollPending(prisma, cosmeticos);
  for (const [index, amount] of ['120.00', '90.00'].entries()) {
    const loan = await prisma.moneyLoan.create({
      data: {
        organizationId: cosmeticos.id,
        amount,
        issuedAt: new Date('2026-10-04T00:00:00.000Z'),
        reason: `Préstamo ${index + 1}`,
        customerId: cosmeticos.customerId,
        createdById: cosmeticos.adminUserId,
      },
      select: { id: true },
    });
    await prisma.moneyLoanEvent.create({
      data: {
        organizationId: cosmeticos.id,
        loanId: loan.id,
        type: 'CREATED',
        reason: 'Préstamo creado',
        createdById: cosmeticos.adminUserId,
      },
    });
  }
  await createSale(prisma, cosmeticos, 1, cosmeticos.adminUserId);

  // ── Motors Club: protected, and it keeps trading during the run ────────
  const motors = await createOrgBase(
    prisma,
    label,
    'Motors Club',
    2,
    // Motors Club survives, so its accounts never enter the orphan expectation.
    [],
  );
  const motorsCashier = await createUser(prisma, label, 'motors-caja');
  await prisma.organizationUser.create({
    data: {
      organizationId: motors.id,
      userId: motorsCashier.id,
      role: 'CASHIER',
    },
  });
  await createEmployee(prisma, motors, 'Empleado Motors');
  await createSale(prisma, motors, 1, motors.adminUserId);
  await createSale(prisma, motors, 2, motorsCashier.id);
  const motorsLoan = await prisma.moneyLoan.create({
    data: {
      organizationId: motors.id,
      amount: '150.00',
      issuedAt: new Date('2026-09-01T00:00:00.000Z'),
      reason: 'Préstamo de Motors Club',
      customerId: motors.customerId,
      createdById: motors.adminUserId,
    },
    select: { id: true },
  });
  await prisma.moneyLoanEvent.create({
    data: {
      organizationId: motors.id,
      loanId: motorsLoan.id,
      type: 'CREATED',
      reason: 'Préstamo creado',
      createdById: motors.adminUserId,
    },
  });
  await prisma.whatsAppConnection.create({
    data: {
      organizationId: motors.id,
      channel: 'COMMERCIAL',
      sessionName: `${label}-motors`,
      status: 'STOPPED',
    },
  });
  const motorsFinal: OrgFixture = {
    ...motors,
    cashierUserIds: [motorsCashier.id],
  };

  // ── Two membership-less SuperAdmins ────────────────────────────────────
  const superAdminToDelete = await createUser(prisma, label, 'super-one', {
    superAdmin: true,
  });
  const superAdminKept = await createUser(prisma, label, 'super-two', {
    superAdmin: true,
  });

  return {
    testOrg,
    tuEstilo,
    mercado: mercadoWithStaff,
    cosmeticos,
    motors: motorsFinal,
    superAdminToDelete,
    superAdminKept,
    memberEmails: adminEmails,
    allOrgIds: [testOrg.id, tuEstilo.id, mercado.id, cosmeticos.id, motors.id],
  };
}

/**
 * Removes every fixture row. Uses the tool's own trigger mechanism and drops
 * the fixture organizations children-first; the disposable database is
 * discarded afterwards, so this only keeps repeat runs honest.
 */
async function tearDown(
  prisma: PrismaClient,
  world: ProductionWorld | undefined,
): Promise<void> {
  if (!world) return;
  const orgIds = world.allOrgIds;
  const userIds = [
    world.testOrg.adminUserId,
    world.tuEstilo.adminUserId,
    world.mercado.adminUserId,
    ...world.mercado.cashierUserIds,
    world.cosmeticos.adminUserId,
    world.motors.adminUserId,
    ...world.motors.cashierUserIds,
    world.superAdminToDelete.id,
    world.superAdminKept.id,
  ];

  await prisma.$transaction(
    async (tx) => {
      await disableDeleteTriggers(tx);
      for (const step of ORG_CLEANUP_STEPS) {
        await tx.$executeRaw(
          Prisma.sql`DELETE FROM ${Prisma.raw(`"${step.table}"`)} WHERE ${cleanupScopedWhere(step.scope, orgIds)}`,
        );
      }
      await enableDeleteTriggers(tx);
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}
