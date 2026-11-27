import {
  BillingStatus,
  CustomerSegment,
  EmployeeRemunerationModality,
  EmployeeShiftKind,
  ExpensePaymentStatus,
  InventoryLoanEventType,
  InventoryLoanStatus,
  LocationType,
  MoneyLoanEventType,
  MoneyLoanStatus,
  MonetaryLoanType,
  MovementType,
  OrgRole,
  OrgStatus,
  PaymentMethod,
  PayrollObligationKind,
  PayrollObligationStatus,
  PlanType,
  Prisma,
  PrismaClient,
  ProductType,
  PromotionType,
  PurchaseOrderStatus,
  SaleStatus,
  StockTransferStatus,
  SupplierAccountType,
  TaskEventType,
  TaskStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as fs from 'node:fs';
import { BCRYPT_ROUNDS } from '../src/common/constants/security.constants';
import { resolveSuperAdminPassword } from '../src/config/super-admin-credentials';
import { DEFAULT_EXPENSE_TAXONOMY } from '../src/expenses/default-expense-categories';
import { PLAN_LIMITS } from '../src/plan-limits/plan-limits.constants';
import { applySiteStockDelta } from '../src/inventory/site-stock';
import { buildPurchaseOrderSnapshot } from '../src/purchase-orders/document/purchase-order-document';
import { validatePurchaseOrderTemplate } from '../src/settings/validator';
import {
  buildTestOrgsSeedPlan,
  summarizeTestOrgsPlan,
  type TestOrgPlan,
  type TestOrgsSeedPlan,
  type TestOrgUserKey,
} from '../src/seeding/test-orgs-seed.plan';

/**
 * Central seed for the two test organizations («Prueba PRO», «Prueba BASIC»).
 *
 * It replaces the overlapping development seeds (`seed.ts`, `seed-org.ts`,
 * `seed-sandbox.ts`, `seed-demo-activity.ts`): one entry point, one plan, the
 * same two organizations locally and in production. The dataset lives in
 * ../src/seeding/test-orgs-seed.plan.ts so every invariant is tested without a
 * database; this file only reads the environment, proves the guards and writes.
 *
 * Safety contract:
 *  - DRY RUN IS THE DEFAULT. Only the exact `--apply` flag writes.
 *  - `--verify` is read-only: per-section counts and plan-limit usage.
 *  - Outside development it refuses unless SEED_ALLOW_NON_DEV=true.
 *  - `--apply` requires SEED_TEST_ORG_PASSWORD or SEED_TEST_ORG_PASSWORD_FILE
 *    (12+ characters, never printed) and, outside production, a
 *    SUPER_ADMIN_PASSWORD (10+, never printed) to bootstrap the local
 *    SuperAdmin. Production never creates or modifies a SuperAdmin.
 *  - Idempotency is keyed by slug: an existing organization whose primary owner
 *    is the seed's admin is skipped whole, and a slug that belongs to anything
 *    else makes the run refuse before the first write.
 *  - One transaction per organization. A failure leaves no half-seeded
 *    organization behind.
 */

const LOG_PREFIX = '[seed-test-orgs]';
const SEED_PASSWORD_ENV = 'SEED_TEST_ORG_PASSWORD';
const SEED_PASSWORD_FILE_ENV = 'SEED_TEST_ORG_PASSWORD_FILE';
const MIN_SEED_PASSWORD_LENGTH = 12;
const DEFAULT_SUPER_ADMIN_EMAIL = 'admin@sistema.com';
const SUPER_ADMIN_NAME = 'Super Administrador';

type Mode = 'dry-run' | 'apply' | 'verify';

interface CliOptions {
  mode: Mode;
  /** Plaintext seed password for the two ADMIN accounts. Never printed. */
  seedPassword: string | null;
  superAdminEmail: string;
  /** Plaintext SuperAdmin password, or null in production. Never printed. */
  superAdminPassword: string | null;
}

interface SectionCounts {
  locations: number;
  cashRegisters: number;
  users: number;
  categories: number;
  products: number;
  customers: number;
  suppliers: number;
  purchaseOrders: number;
  sentPurchaseOrders: number;
  inventoryMovements: number;
  stockTransfers: number;
  inventoryLoans: number;
  sales: number;
  expenses: number;
  employees: number;
  shifts: number;
  payrollObligations: number;
  payrollPayments: number;
  moneyLoans: number;
  loanEvents: number;
  tasks: number;
}

function emptyCounts(): SectionCounts {
  return {
    locations: 0,
    cashRegisters: 0,
    users: 0,
    categories: 0,
    products: 0,
    customers: 0,
    suppliers: 0,
    purchaseOrders: 0,
    sentPurchaseOrders: 0,
    inventoryMovements: 0,
    stockTransfers: 0,
    inventoryLoans: 0,
    sales: 0,
    expenses: 0,
    employees: 0,
    shifts: 0,
    payrollObligations: 0,
    payrollPayments: 0,
    moneyLoans: 0,
    loanEvents: 0,
    tasks: 0,
  };
}

function fail(message: string): never {
  console.error(`${LOG_PREFIX} refused: ${message}`);
  process.exit(1);
}

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`);
}

function warn(message: string): void {
  console.warn(`${LOG_PREFIX} ${message}`);
}

// ─── Guards ────────────────────────────────────────────────────────────────

/**
 * Reads the seed password from the environment or from a file, never both. The
 * file source follows the provisioning rule: a regular file no other account can
 * read, so the plaintext never has to live in the process environment.
 */
function readSeedPassword(): string | null {
  const direct = process.env[SEED_PASSWORD_ENV];
  const rawPath = process.env[SEED_PASSWORD_FILE_ENV]?.trim();

  if (direct && rawPath) {
    fail(
      `set only one of ${SEED_PASSWORD_ENV} and ${SEED_PASSWORD_FILE_ENV}, never both.`,
    );
  }
  if (!direct && !rawPath) return null;

  if (!rawPath) return direct ?? null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(rawPath);
  } catch {
    fail(
      `${SEED_PASSWORD_FILE_ENV} "${rawPath}" does not exist or cannot be read.`,
    );
  }
  if (!stat.isFile()) {
    fail(`${SEED_PASSWORD_FILE_ENV} "${rawPath}" is not a regular file.`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fail(
      `${SEED_PASSWORD_FILE_ENV} "${rawPath}" is readable by other accounts; chmod 600 it first.`,
    );
  }

  return fs.readFileSync(rawPath, 'utf8').replace(/\r?\n$/, '');
}

function readMode(): Mode {
  let apply = false;
  let verify = false;

  for (const argument of process.argv.slice(2)) {
    if (argument === '--apply') {
      apply = true;
    } else if (argument === '--verify') {
      verify = true;
    } else {
      fail(
        `unknown argument ${argument}. Supported flags: --apply, --verify (no flag is a dry run).`,
      );
    }
  }

  if (apply && verify) {
    fail('--apply and --verify cannot be combined.');
  }
  return apply ? 'apply' : verify ? 'verify' : 'dry-run';
}

function readOptions(): CliOptions {
  const mode = readMode();
  const nodeEnv = process.env.NODE_ENV;
  const allowNonDev = process.env.SEED_ALLOW_NON_DEV === 'true';
  const isProduction = nodeEnv === 'production';

  if (nodeEnv !== 'development' && !allowNonDev) {
    fail(
      `NODE_ENV is "${nodeEnv ?? 'undefined'}", so this seed needs SEED_ALLOW_NON_DEV=true.`,
    );
  }

  const seedPassword = mode === 'apply' ? readSeedPassword() : null;
  if (
    mode === 'apply' &&
    (!seedPassword || seedPassword.length < MIN_SEED_PASSWORD_LENGTH)
  ) {
    fail(
      `${SEED_PASSWORD_ENV} or ${SEED_PASSWORD_FILE_ENV} is required for --apply and must have at least ${MIN_SEED_PASSWORD_LENGTH} characters.`,
    );
  }
  if (seedPassword && seedPassword !== seedPassword.trim()) {
    fail('the seed password must not start or end with whitespace.');
  }

  const superAdminEmail = (
    process.env.SUPER_ADMIN_EMAIL?.trim() || DEFAULT_SUPER_ADMIN_EMAIL
  ).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(superAdminEmail)) {
    fail(`SUPER_ADMIN_EMAIL "${superAdminEmail}" is not a valid email.`);
  }

  let superAdminPassword: string | null = null;
  if (mode === 'apply' && !isProduction) {
    const resolved = resolveSuperAdminPassword(process.env);
    if (!resolved.ok) {
      fail(
        `SUPER_ADMIN_PASSWORD is required before writing outside production and must have at least 10 characters. ${resolved.reason ?? ''}`.trim(),
      );
    }
    superAdminPassword = resolved.password as string;
  }

  return { mode, seedPassword, superAdminEmail, superAdminPassword };
}

// ─── Order and date helpers ────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Date-only columns are written at UTC midnight, matching the services. */
function atUtcMidnight(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Accepts either a date-only string or a full ISO timestamp. */
function atUtcMidnightFromIso(value: string): Date {
  return atUtcMidnight(value.slice(0, 10));
}

// ─── Preflight (read-only, before any write) ───────────────────────────────

interface OrgTarget {
  plan: TestOrgPlan;
  existingOrganizationId: string | null;
}

/**
 * Refuses before the first write when a target slug or name already belongs to
 * something this seed did not create. Reads only the two planned identities.
 */
async function preflight(
  prisma: PrismaClient,
  plan: TestOrgsSeedPlan,
): Promise<OrgTarget[]> {
  const targets: OrgTarget[] = [];

  for (const row of plan.organizations) {
    const slug = row.organization.slug;
    const adminEmail = row.users[0]?.email;
    const existing = await prisma.organization.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        users: {
          where: { isPrimaryOwner: true },
          select: { user: { select: { email: true } } },
        },
      },
    });

    if (!existing) {
      const sameName = await prisma.organization.findFirst({
        where: { name: row.organization.name },
        select: { slug: true },
      });
      if (sameName) {
        fail(
          `the name "${row.organization.name}" already belongs to organization "${sameName.slug}", which this seed did not create. Refusing to touch it.`,
        );
      }
      targets.push({ plan: row, existingOrganizationId: null });
      continue;
    }

    if (existing.name !== row.organization.name) {
      fail(
        `the slug "${slug}" already belongs to organization "${existing.name}", which this seed did not create. Refusing to touch it.`,
      );
    }

    const owners = existing.users.map((membership) => membership.user.email);
    if (owners.length !== 1 || owners[0] !== adminEmail) {
      fail(
        `the organization "${slug}" exists with primary owner ${owners.join(', ') || '(none)'}, not ${adminEmail}. Refusing to adopt it.`,
      );
    }

    targets.push({ plan: row, existingOrganizationId: existing.id });
  }

  return targets;
}

// ─── Section writers ───────────────────────────────────────────────────────

interface OrgContext {
  organizationId: string;
  locationIds: Map<string, string>;
}

async function createOrganization(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  counts: SectionCounts,
): Promise<OrgContext> {
  const created = await tx.organization.create({
    data: {
      name: plan.organization.name,
      slug: plan.organization.slug,
      taxId: plan.organization.taxId,
      phone: plan.organization.phone,
      address: plan.organization.address,
      plan: plan.organization.plan as PlanType,
      status: plan.organization.status as OrgStatus,
      billingStatus: plan.organization.billingStatus as BillingStatus,
      active: true,
      settings: plan.organization.settings as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  const organizationId = created.id;

  const locationIds = new Map<string, string>();
  for (const location of plan.organization.locations) {
    const row = await tx.location.create({
      data: {
        organizationId,
        name: location.name,
        type: location.type as LocationType,
        isDefault: location.isDefault,
        address: location.address,
        phone: location.phone,
      },
      select: { id: true },
    });
    locationIds.set(location.name, row.id);
    counts.locations += 1;
  }
  if (!plan.organization.locations.some((location) => location.isDefault)) {
    throw new Error(
      `Plan for ${plan.organization.slug} has no default location`,
    );
  }

  const currentYear = new Date().getFullYear();
  for (const sequence of plan.organization.sequences) {
    await tx.organizationSequence.create({
      data: {
        organizationId,
        type: sequence.type,
        prefix: sequence.prefix,
        currentNumber: 0,
        year: currentYear,
      },
    });
  }

  for (const [index, name] of plan.organization.cashRegisters.entries()) {
    await tx.cashRegister.create({
      data: { organizationId, name, isDefault: index === 0 },
    });
    counts.cashRegisters += 1;
  }

  // The single ADMIN membership is created together with the user below.
  return { organizationId, locationIds };
}

async function ensureExpenseTaxonomy(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();

  for (const [groupName, labelNames] of Object.entries(
    DEFAULT_EXPENSE_TAXONOMY,
  )) {
    const group = await tx.expenseGroup.create({
      data: { organizationId, name: groupName },
      select: { id: true },
    });

    for (const labelName of labelNames) {
      const label = await tx.expenseLabel.create({
        data: { organizationId, groupId: group.id, name: labelName },
        select: { id: true },
      });
      labels.set(`${groupName}::${labelName}`, label.id);
    }
  }

  return labels;
}

async function createAdminMembership(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  passwordHash: string,
  counts: SectionCounts,
): Promise<Map<TestOrgUserKey, string>> {
  const userIds = new Map<TestOrgUserKey, string>();

  for (const userPlan of plan.users) {
    const user = await tx.user.create({
      data: {
        email: userPlan.email,
        name: userPlan.name,
        password: passwordHash,
        tokenVersion: 0,
      },
      select: { id: true },
    });
    counts.users += 1;

    await tx.organizationUser.create({
      data: {
        userId: user.id,
        organizationId,
        role: userPlan.role as OrgRole,
        isPrimaryOwner: userPlan.isPrimaryOwner,
      },
    });

    userIds.set(userPlan.key, user.id);
  }

  return userIds;
}

async function createCategories(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  counts: SectionCounts,
): Promise<Map<string, string>> {
  const categoryIds = new Map<string, string>();

  for (const category of plan.categories) {
    const row = await tx.category.create({
      data: {
        organizationId,
        name: category.name,
        description: category.description,
        taxable: category.taxable,
        defaultTaxRate: new Prisma.Decimal(category.defaultTaxRate),
      },
      select: { id: true },
    });
    categoryIds.set(category.name, row.id);
    counts.categories += 1;
  }

  return categoryIds;
}

interface ProductRow {
  id: string;
  stock: number;
  openingStock: number;
}

async function createProducts(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  categoryIds: Map<string, string>,
  counts: SectionCounts,
): Promise<Map<string, ProductRow>> {
  const products = new Map<string, ProductRow>();

  for (const product of plan.products) {
    const categoryId = categoryIds.get(product.categoryName);
    if (!categoryId) {
      throw new Error(`Unknown category ${product.categoryName}`);
    }

    const created = await tx.product.create({
      data: {
        organizationId,
        categoryId,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        description: product.description,
        type: product.type as ProductType,
        tracksStock: product.tracksStock,
        costPrice: new Prisma.Decimal(product.costPrice),
        salePrice: new Prisma.Decimal(product.salePrice),
        taxRate: new Prisma.Decimal(product.taxRate),
        taxable: product.taxable,
        stock: product.stock,
        minStock: product.minStock,
        promotionType: product.promotionType as PromotionType | null,
        promotionValue:
          product.promotionValue === null
            ? null
            : new Prisma.Decimal(product.promotionValue),
      },
      select: { id: true },
    });

    products.set(product.sku, {
      id: created.id,
      stock: product.stock,
      openingStock: product.openingStock,
    });
    counts.products += 1;
  }

  return products;
}

async function createCustomers(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  counts: SectionCounts,
): Promise<Map<string, string>> {
  const customerIds = new Map<string, string>();

  for (const customer of plan.customers) {
    const row = await tx.customer.create({
      data: {
        organizationId,
        name: customer.name,
        documentType: customer.documentType,
        documentNumber: customer.documentNumber,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        segment: customer.segment as CustomerSegment,
      },
      select: { id: true },
    });
    customerIds.set(customer.documentNumber, row.id);
    counts.customers += 1;
  }

  return customerIds;
}

async function createSuppliers(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  counts: SectionCounts,
): Promise<Map<string, string>> {
  const supplierIds = new Map<string, string>();

  for (const supplier of plan.suppliers) {
    const row = await tx.supplier.create({
      data: {
        organizationId,
        name: supplier.name,
        documentNumber: supplier.documentNumber,
        email: supplier.email,
        phone: supplier.phone,
        address: supplier.address,
        contactName: supplier.contactName,
        bank: supplier.bank,
        accountNumber: supplier.accountNumber,
        accountType: supplier.accountType as SupplierAccountType,
      },
      select: { id: true },
    });
    supplierIds.set(supplier.documentNumber, row.id);
    counts.suppliers += 1;
  }

  return supplierIds;
}

interface PurchaseOrderRow {
  id: string;
  orderNumber: number;
}

async function createPurchaseOrders(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  supplierIds: Map<string, string>,
  productIds: Map<string, ProductRow>,
  actorId: string,
  counts: SectionCounts,
): Promise<Map<string, PurchaseOrderRow>> {
  const orders = new Map<string, PurchaseOrderRow>();

  for (const [index, order] of plan.purchaseOrders.entries()) {
    const supplierId = supplierIds.get(order.supplierKey);
    if (!supplierId) throw new Error(`Unknown supplier ${order.supplierKey}`);

    const orderNumber = index + 1;
    const created = await tx.purchaseOrder.create({
      data: {
        organizationId,
        orderNumber,
        supplierId,
        createdById: actorId,
        status: order.status as PurchaseOrderStatus,
        subtotal: new Prisma.Decimal(order.subtotal),
        taxAmount: new Prisma.Decimal(order.taxAmount),
        total: new Prisma.Decimal(order.total),
        notes: order.notes,
        createdAt: new Date(order.createdAt),
        confirmedAt: order.confirmedAt ? new Date(order.confirmedAt) : null,
        receivedAt: order.receivedAt ? new Date(order.receivedAt) : null,
        items: {
          create: order.items.map((item) => {
            const product = productIds.get(item.sku);
            if (!product) throw new Error(`Unknown product ${item.sku}`);
            return {
              organizationId,
              productId: product.id,
              qtyOrdered: item.qtyOrdered,
              qtyReceived: item.qtyReceived,
              unitCost: new Prisma.Decimal(item.unitCost),
              taxRate: new Prisma.Decimal(item.taxRate),
              subtotal: new Prisma.Decimal(item.subtotal),
              taxAmount: new Prisma.Decimal(item.taxAmount),
            };
          }),
        },
      },
      select: { id: true, orderNumber: true },
    });
    orders.set(order.key, { id: created.id, orderNumber: created.orderNumber });
    counts.purchaseOrders += 1;
  }

  const sequence = await tx.organizationSequence.findFirst({
    where: { organizationId, type: 'PO' },
    select: { id: true },
  });
  if (sequence) {
    await tx.organizationSequence.update({
      where: { id: sequence.id },
      data: { currentNumber: plan.purchaseOrders.length },
    });
  }

  return orders;
}

/**
 * Freezes the sent document exactly the way `POST /api/purchase-orders/:id/send`
 * does: the same builder, over the order and settings slice the service reads.
 */
async function sendPlannedPurchaseOrders(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  orderRows: Map<string, PurchaseOrderRow>,
  counts: SectionCounts,
): Promise<void> {
  const sent = plan.purchaseOrders.filter((order) => order.sent !== null);
  if (sent.length === 0) return;

  const now = new Date();

  for (const orderPlan of sent) {
    const row = orderRows.get(orderPlan.key);
    if (!row) throw new Error(`Unknown purchase order ${orderPlan.key}`);

    const order = await tx.purchaseOrder.findFirstOrThrow({
      where: { id: row.id, organizationId },
      include: {
        supplier: true,
        createdBy: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    const snapshot = buildPurchaseOrderSnapshot(order, {
      organization: {
        name: plan.organization.name,
        logoUrl: null,
        taxId: plan.organization.taxId,
        phone: plan.organization.phone,
        address: plan.organization.address,
      },
      purchaseOrder: validatePurchaseOrderTemplate(
        plan.organization.settings as unknown as Record<string, unknown>,
      ),
    });

    const expectedDelivery =
      orderPlan.sent?.expectedDeliveryDaysAgo === null ||
      orderPlan.sent?.expectedDeliveryDaysAgo === undefined
        ? null
        : atUtcMidnight(
            addDays(now, -orderPlan.sent.expectedDeliveryDaysAgo)
              .toISOString()
              .slice(0, 10),
          );

    await tx.purchaseOrder.updateMany({
      where: { id: row.id, organizationId, sentAt: null },
      data: {
        sentAt: addDays(now, -(orderPlan.sent?.daysAgo ?? 0)),
        sentVia: 'PDF',
        expectedDeliveryDate: expectedDelivery,
        documentSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
    counts.sentPurchaseOrders += 1;
  }
}

async function createInventoryMovements(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  productIds: Map<string, ProductRow>,
  orderRows: Map<string, PurchaseOrderRow>,
  actorId: string,
  counts: SectionCounts,
): Promise<Map<string, number>> {
  const openingReason = 'Carga inicial de la organización de prueba';

  for (const product of plan.products) {
    if (product.type !== 'PRODUCT' || product.openingStock === 0) continue;
    const row = productIds.get(product.sku);
    if (!row) continue;

    await tx.inventoryMovement.create({
      data: {
        organizationId,
        productId: row.id,
        type: MovementType.ADJUSTMENT_IN,
        quantity: product.openingStock,
        previousStock: 0,
        newStock: product.openingStock,
        reason: openingReason,
        userId: actorId,
        createdAt: addDays(new Date(), -90),
      },
    });
    counts.inventoryMovements += 1;
  }

  const receivedOrders = plan.purchaseOrders
    .filter((order) => order.receivedAt !== null)
    .sort(
      (left, right) =>
        new Date(left.receivedAt as string).getTime() -
        new Date(right.receivedAt as string).getTime(),
    );

  const running = new Map<string, number>();
  for (const product of plan.products) {
    running.set(product.sku, product.openingStock);
  }

  for (const order of receivedOrders) {
    const row = orderRows.get(order.key);
    if (!row) continue;
    const reason = `OC-${row.orderNumber}`;

    for (const item of order.items) {
      if (item.qtyReceived <= 0) continue;
      const product = productIds.get(item.sku);
      if (!product) throw new Error(`Unknown product ${item.sku}`);

      const previousStock = running.get(item.sku) ?? 0;
      const newStock = previousStock + item.qtyReceived;

      await tx.inventoryMovement.create({
        data: {
          organizationId,
          productId: product.id,
          type: MovementType.PURCHASE,
          quantity: item.qtyReceived,
          previousStock,
          newStock,
          reason,
          userId: actorId,
          createdAt: order.receivedAt ? new Date(order.receivedAt) : new Date(),
        },
      });
      counts.inventoryMovements += 1;
      running.set(item.sku, newStock);
    }
  }

  for (const product of plan.products) {
    const finalStock = running.get(product.sku);
    if (finalStock !== product.stock) {
      throw new Error(
        `Inventory chain for ${product.sku} ends at ${finalStock}, expected ${product.stock}`,
      );
    }
  }

  return running;
}

/**
 * Writes the planned transfers as already received documents and moves the
 * stock between the two sites with the same helper the transfers service uses.
 * A received transfer nets to zero on the organization aggregate, so the
 * inventory chain above still ends at `Product.stock`.
 */
async function createStockTransfers(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  context: OrgContext,
  productIds: Map<string, ProductRow>,
  actorId: string,
  counts: SectionCounts,
): Promise<void> {
  if (plan.stockTransfers.length === 0) return;

  const now = new Date();

  for (const transfer of plan.stockTransfers) {
    const fromLocationId = context.locationIds.get(transfer.fromLocationName);
    const toLocationId = context.locationIds.get(transfer.toLocationName);
    if (!fromLocationId || !toLocationId) {
      throw new Error(`Unknown location in transfer ${transfer.key}`);
    }

    await tx.stockTransfer.create({
      data: {
        organizationId,
        number: transfer.number,
        fromLocationId,
        toLocationId,
        status: transfer.status as StockTransferStatus,
        notes: transfer.notes,
        createdById: actorId,
        createdAt: addDays(now, -transfer.createdDaysAgo),
        receivedAt:
          transfer.receivedDaysAgo === null
            ? null
            : addDays(now, -transfer.receivedDaysAgo),
        receivedById: transfer.receivedDaysAgo === null ? null : actorId,
        items: {
          create: transfer.items.map((item) => {
            const product = productIds.get(item.sku);
            if (!product) throw new Error(`Unknown product ${item.sku}`);
            return { productId: product.id, quantity: item.quantity };
          }),
        },
      },
    });
    counts.stockTransfers += 1;

    if (transfer.status !== 'RECEIVED') continue;

    for (const item of transfer.items) {
      const product = productIds.get(item.sku);
      if (!product) throw new Error(`Unknown product ${item.sku}`);
      const before = product.stock;
      const afterOut = before - item.quantity;

      const out = await applySiteStockDelta(tx, {
        organizationId,
        productId: product.id,
        locationId: fromLocationId,
        stockDelta: -item.quantity,
        reservedDelta: 0,
      });
      if (!out.applied) {
        throw new Error(
          `The source site cannot dispatch ${item.quantity} units of ${item.sku}`,
        );
      }
      await tx.inventoryMovement.create({
        data: {
          organizationId,
          productId: product.id,
          type: MovementType.TRANSFER_OUT,
          quantity: -item.quantity,
          previousStock: before,
          newStock: afterOut,
          reason: `TR-${transfer.number}`,
          userId: actorId,
          locationId: fromLocationId,
          createdAt: addDays(now, -transfer.createdDaysAgo),
        },
      });
      counts.inventoryMovements += 1;

      const inbound = await applySiteStockDelta(tx, {
        organizationId,
        productId: product.id,
        locationId: toLocationId,
        stockDelta: item.quantity,
        reservedDelta: 0,
      });
      if (!inbound.applied) {
        throw new Error(
          `The destination site cannot receive ${item.quantity} units of ${item.sku}`,
        );
      }
      await tx.inventoryMovement.create({
        data: {
          organizationId,
          productId: product.id,
          type: MovementType.TRANSFER_IN,
          quantity: item.quantity,
          previousStock: afterOut,
          newStock: before,
          reason: `TR-${transfer.number}`,
          userId: actorId,
          locationId: toLocationId,
          createdAt:
            transfer.receivedDaysAgo === null
              ? now
              : addDays(now, -transfer.receivedDaysAgo),
        },
      });
      counts.inventoryMovements += 1;
    }
  }

  const lastNumber = Math.max(
    ...plan.stockTransfers.map((transfer) => transfer.number),
  );
  const sequence = await tx.organizationSequence.findFirst({
    where: { organizationId, type: 'TRANSFER' },
    select: { id: true },
  });
  if (sequence) {
    await tx.organizationSequence.update({
      where: { id: sequence.id },
      data: { currentNumber: lastNumber },
    });
  }
}

async function createSales(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  userIds: Map<TestOrgUserKey, string>,
  customerIds: Map<string, string>,
  productIds: Map<string, ProductRow>,
  counts: SectionCounts,
): Promise<void> {
  for (const sale of plan.sales) {
    const userId = userIds.get(sale.userKey);
    if (!userId) throw new Error(`Unknown sale user ${sale.userKey}`);
    const customerId = sale.customerDocumentNumber
      ? customerIds.get(sale.customerDocumentNumber)
      : undefined;

    await tx.sale.create({
      data: {
        organizationId,
        saleNumber: sale.saleNumber,
        customerId: customerId ?? null,
        userId,
        status: sale.status as SaleStatus,
        subtotal: new Prisma.Decimal(sale.subtotal),
        taxAmount: new Prisma.Decimal(sale.taxAmount),
        discountAmount: new Prisma.Decimal(sale.discountAmount),
        total: new Prisma.Decimal(sale.total),
        amountPaid: new Prisma.Decimal(sale.amountPaid),
        change: new Prisma.Decimal(sale.change),
        createdAt: new Date(sale.createdAt),
        items: {
          create: sale.items.map((item) => {
            const product = productIds.get(item.sku);
            if (!product) throw new Error(`Unknown product ${item.sku}`);
            return {
              organizationId,
              productId: product.id,
              quantity: item.quantity,
              unitPrice: new Prisma.Decimal(item.unitPrice),
              costPriceSnapshot: new Prisma.Decimal(item.costPriceSnapshot),
              taxRate: new Prisma.Decimal(item.taxRate),
              discountAmount: new Prisma.Decimal(0),
              subtotal: new Prisma.Decimal(item.subtotal),
              total: new Prisma.Decimal(item.total),
            };
          }),
        },
        payments: {
          create: sale.payments.map((payment) => ({
            organizationId,
            method: payment.method as PaymentMethod,
            amount: new Prisma.Decimal(payment.amount),
            createdAt: new Date(sale.createdAt),
          })),
        },
      },
    });
    counts.sales += 1;
  }

  const sequence = await tx.organizationSequence.findFirst({
    where: { organizationId, type: 'SALE' },
    select: { id: true },
  });
  if (sequence) {
    await tx.organizationSequence.update({
      where: { id: sequence.id },
      data: { currentNumber: plan.sales.length },
    });
  }
}

async function createExpenses(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  labelIds: Map<string, string>,
  supplierIds: Map<string, string>,
  orderRows: Map<string, PurchaseOrderRow>,
  actorId: string,
  counts: SectionCounts,
): Promise<void> {
  for (const expense of plan.expenses) {
    const description = `[prueba] ${expense.description}`;

    const labelId = labelIds.get(`${expense.groupName}::${expense.labelName}`);
    if (!labelId) {
      throw new Error(
        `Unknown expense label ${expense.groupName}::${expense.labelName}`,
      );
    }
    const supplierId = expense.supplierKey
      ? supplierIds.get(expense.supplierKey)
      : undefined;
    if (expense.supplierKey && !supplierId) {
      throw new Error(`Unknown supplier ${expense.supplierKey}`);
    }
    const purchaseOrderId = expense.purchaseOrderKey
      ? orderRows.get(expense.purchaseOrderKey)?.id
      : undefined;
    if (expense.purchaseOrderKey && !purchaseOrderId) {
      throw new Error(`Unknown purchase order ${expense.purchaseOrderKey}`);
    }

    await tx.expense.create({
      data: {
        organizationId,
        labelId,
        supplierId: supplierId ?? null,
        purchaseOrderId: purchaseOrderId ?? null,
        description,
        date: addDays(new Date(), -expense.daysAgo),
        total: new Prisma.Decimal(expense.total),
        status: expense.status as ExpensePaymentStatus,
        createdById: actorId,
        payments: {
          create: expense.payments.map((payment) => ({
            organizationId,
            amount: new Prisma.Decimal(payment.amount),
            method: payment.method as PaymentMethod,
            date: addDays(new Date(), -payment.daysAgo),
          })),
        },
      },
    });
    counts.expenses += 1;
  }
}

async function createEmployees(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  counts: SectionCounts,
): Promise<Map<string, string>> {
  const employeeIds = new Map<string, string>();

  for (const employee of plan.employees) {
    const row = await tx.employee.create({
      data: {
        organizationId,
        name: employee.name,
        identification: employee.identification,
        phone: employee.phone,
        email: employee.email,
        address: employee.address,
        jobTitle: employee.jobTitle,
        startDate: atUtcMidnight(employee.startDate),
        remunerationModality:
          employee.remunerationModality as EmployeeRemunerationModality,
        referenceAmount:
          employee.referenceAmount === null
            ? null
            : new Prisma.Decimal(employee.referenceAmount),
        active: employee.active,
      },
      select: { id: true },
    });
    employeeIds.set(employee.key, row.id);
    counts.employees += 1;

    for (const shift of employee.shifts) {
      await tx.employeeShift.create({
        data: {
          organizationId,
          employeeId: row.id,
          date: atUtcMidnight(shift.date),
          kind: shift.kind as EmployeeShiftKind,
          amount: new Prisma.Decimal(shift.amount),
          observation: shift.observation,
        },
      });
      counts.shifts += 1;
    }
  }

  return employeeIds;
}

async function createPayroll(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  employeeIds: Map<string, string>,
  actorId: string,
  counts: SectionCounts,
): Promise<void> {
  for (const payroll of plan.payroll) {
    const employeeId = employeeIds.get(payroll.employeeKey);
    if (!employeeId) throw new Error(`Unknown employee ${payroll.employeeKey}`);

    if (payroll.kind === 'SHIFT_GROUP') {
      const shifts = await tx.employeeShift.findMany({
        where: {
          organizationId,
          employeeId,
          date: { in: payroll.shiftDates.map(atUtcMidnight) },
        },
        select: { id: true },
      });
      if (shifts.length !== payroll.shiftDates.length) {
        throw new Error(
          `Payroll ${payroll.key} could not resolve every shift of ${payroll.employeeKey}`,
        );
      }

      await tx.payrollObligation.create({
        data: {
          organizationId,
          employeeId,
          kind: PayrollObligationKind.SHIFT_GROUP,
          status: PayrollObligationStatus.PENDING,
          expenseEnabled: null,
          selectedExpenseDate: null,
          shiftMemberships: {
            create: shifts.map((shift) => ({
              shift: {
                connect: {
                  id_organizationId_employeeId: {
                    id: shift.id,
                    organizationId,
                    employeeId,
                  },
                },
              },
            })),
          },
        },
      });
      counts.payrollObligations += 1;
      continue;
    }

    if (
      payroll.periodStart === null ||
      payroll.periodEnd === null ||
      payroll.periodAmount === null
    ) {
      throw new Error(`Payroll ${payroll.key} is missing its period`);
    }

    const obligation = await tx.payrollObligation.create({
      data: {
        organizationId,
        employeeId,
        kind: PayrollObligationKind.FIXED_PERIOD,
        status: payroll.status as PayrollObligationStatus,
        version: payroll.version,
        periodStart: atUtcMidnight(payroll.periodStart),
        periodEnd: atUtcMidnight(payroll.periodEnd),
        periodAmount: new Prisma.Decimal(payroll.periodAmount),
        expenseEnabled: null,
        selectedExpenseDate: null,
      },
      select: { id: true },
    });
    counts.payrollObligations += 1;

    for (const payment of payroll.payments) {
      const outflow = await tx.payrollCashOutflow.create({
        data: {
          organizationId,
          employeeId,
          actorId,
          amount: new Prisma.Decimal(payment.amount),
          date: atUtcMidnight(payment.date),
          method: payment.method as PaymentMethod,
        },
        select: { id: true },
      });
      await tx.payrollInstallment.create({
        data: {
          organizationId,
          employeeId,
          obligationId: obligation.id,
          outflowId: outflow.id,
          sequence: null,
        },
      });
      counts.payrollPayments += 1;
    }
  }
}

async function createMoneyLoans(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  customerIds: Map<string, string>,
  supplierIds: Map<string, string>,
  userIds: Map<TestOrgUserKey, string>,
  actorId: string,
  counts: SectionCounts,
): Promise<void> {
  for (const loan of plan.moneyLoans) {
    let customerId: string | null = null;
    let supplierId: string | null = null;
    let employeeId: string | null = null;

    if (loan.counterparty.kind === 'customer') {
      customerId = customerIds.get(loan.counterparty.documentNumber) ?? null;
      if (!customerId) throw new Error('Unknown loan customer');
    } else if (loan.counterparty.kind === 'supplier') {
      supplierId = supplierIds.get(loan.counterparty.documentNumber) ?? null;
      if (!supplierId) throw new Error('Unknown loan supplier');
    } else {
      employeeId = userIds.get(loan.counterparty.userKey) ?? null;
      if (!employeeId) throw new Error('Unknown loan user');
    }

    const created = await tx.moneyLoan.create({
      data: {
        organizationId,
        type: loan.type as MonetaryLoanType,
        amount: new Prisma.Decimal(loan.amount),
        status: loan.status as MoneyLoanStatus,
        version: loan.version,
        issuedAt: atUtcMidnightFromIso(loan.issuedAt),
        dueAt: loan.dueAt === null ? null : atUtcMidnightFromIso(loan.dueAt),
        reason: loan.reason,
        customerId,
        supplierId,
        employeeId,
        createdById: actorId,
      },
      select: { id: true },
    });
    counts.moneyLoans += 1;

    for (const event of loan.events) {
      await tx.moneyLoanEvent.create({
        data: {
          loanId: created.id,
          organizationId,
          createdById: actorId,
          type: event.type as MoneyLoanEventType,
          amount:
            event.amount === null ? null : new Prisma.Decimal(event.amount),
          method: event.method as PaymentMethod | null,
          reversesId: null,
          reason: event.reason,
          requestKey: event.requestKey,
          requestPayload:
            event.requestPayload === null
              ? null
              : JSON.stringify({ ...event.requestPayload, actorId }),
          result:
            event.result === null
              ? Prisma.DbNull
              : { ...event.result, loanId: created.id },
          createdAt: new Date(event.createdAt),
        },
      });
      counts.loanEvents += 1;
    }
  }
}

async function createInventoryLoans(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  customerIds: Map<string, string>,
  productIds: Map<string, ProductRow>,
  actorId: string,
  counts: SectionCounts,
): Promise<void> {
  const now = new Date();

  for (const loan of plan.inventoryLoans) {
    const customerId = customerIds.get(loan.customerDocumentNumber);
    if (!customerId) {
      throw new Error(
        `Unknown inventory loan customer ${loan.customerDocumentNumber}`,
      );
    }

    const created = await tx.inventoryLoan.create({
      data: {
        organizationId,
        status: loan.status as InventoryLoanStatus,
        version: 0,
        customerId,
        createdById: actorId,
        createdAt: addDays(now, -loan.createdDaysAgo),
        items: {
          create: loan.items.map((item) => {
            const product = productIds.get(item.sku);
            if (!product) throw new Error(`Unknown product ${item.sku}`);
            // The loan relation carries `organizationId`, so a nested item
            // accepts only the product and the quantity.
            return { productId: product.id, quantity: item.quantity };
          }),
        },
      },
      select: { id: true },
    });
    counts.inventoryLoans += 1;

    for (const event of loan.events) {
      await tx.inventoryLoanEvent.create({
        data: {
          loanId: created.id,
          organizationId,
          type: event.type as InventoryLoanEventType,
          createdById: actorId,
          createdAt: addDays(now, -event.daysAgo),
        },
      });
    }
  }
}

async function createTasks(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
  actorId: string,
  counts: SectionCounts,
): Promise<void> {
  const now = new Date();

  for (const task of plan.tasks) {
    const firstEvent = task.events[0];
    const created = await tx.task.create({
      data: {
        organizationId,
        title: task.title,
        description: task.description,
        status: task.status as TaskStatus,
        createdById: actorId,
        assignedToId: actorId,
        dueDate: task.dueInDays === null ? null : addDays(now, task.dueInDays),
        createdAt: addDays(now, -firstEvent.daysAgo),
      },
      select: { id: true },
    });
    counts.tasks += 1;

    for (const event of task.events) {
      await tx.taskEvent.create({
        data: {
          organizationId,
          taskId: created.id,
          type: event.type as TaskEventType,
          fromStatus: event.fromStatus as TaskStatus | null,
          toStatus: event.toStatus as TaskStatus,
          note: event.note,
          createdById: actorId,
          createdAt: addDays(now, -event.daysAgo),
        },
      });
    }
  }
}

// ─── One organization, one transaction ─────────────────────────────────────

async function applyOrganization(
  prisma: PrismaClient,
  plan: TestOrgPlan,
  passwordHash: string,
): Promise<SectionCounts> {
  const counts = emptyCounts();

  await prisma.$transaction(
    async (tx) => {
      const context = await createOrganization(tx, plan, counts);
      const labelIds = await ensureExpenseTaxonomy(tx, context.organizationId);
      const userIds = await createAdminMembership(
        tx,
        plan,
        context.organizationId,
        passwordHash,
        counts,
      );
      const adminId = userIds.get('admin');
      if (!adminId) throw new Error('The ADMIN user was not created');

      const categoryIds = await createCategories(
        tx,
        plan,
        context.organizationId,
        counts,
      );
      const productIds = await createProducts(
        tx,
        plan,
        context.organizationId,
        categoryIds,
        counts,
      );
      const customerIds = await createCustomers(
        tx,
        plan,
        context.organizationId,
        counts,
      );
      const supplierIds = await createSuppliers(
        tx,
        plan,
        context.organizationId,
        counts,
      );
      const orderRows = await createPurchaseOrders(
        tx,
        plan,
        context.organizationId,
        supplierIds,
        productIds,
        adminId,
        counts,
      );
      await sendPlannedPurchaseOrders(
        tx,
        plan,
        context.organizationId,
        orderRows,
        counts,
      );
      await createInventoryMovements(
        tx,
        plan,
        context.organizationId,
        productIds,
        orderRows,
        adminId,
        counts,
      );
      await createStockTransfers(
        tx,
        plan,
        context.organizationId,
        context,
        productIds,
        adminId,
        counts,
      );
      await createSales(
        tx,
        plan,
        context.organizationId,
        userIds,
        customerIds,
        productIds,
        counts,
      );
      await createExpenses(
        tx,
        plan,
        context.organizationId,
        labelIds,
        supplierIds,
        orderRows,
        adminId,
        counts,
      );
      const employeeIds = await createEmployees(
        tx,
        plan,
        context.organizationId,
        counts,
      );
      await createPayroll(
        tx,
        plan,
        context.organizationId,
        employeeIds,
        adminId,
        counts,
      );
      await createMoneyLoans(
        tx,
        plan,
        context.organizationId,
        customerIds,
        supplierIds,
        userIds,
        adminId,
        counts,
      );
      await createInventoryLoans(
        tx,
        plan,
        context.organizationId,
        customerIds,
        productIds,
        adminId,
        counts,
      );
      await createTasks(tx, plan, context.organizationId, adminId, counts);

      // The site ledger is derived from the aggregates above; prove it before
      // committing so a wrong distribution never lands.
      await assertSiteLedger(tx, plan, context.organizationId);
    },
    { maxWait: 10_000, timeout: 300_000 },
  );

  return counts;
}

/** The triggers keep `Product.stock` equal to the sum of its site rows. */
async function assertSiteLedger(
  tx: Prisma.TransactionClient,
  plan: TestOrgPlan,
  organizationId: string,
): Promise<void> {
  const products = await tx.product.findMany({
    where: { organizationId },
    select: {
      sku: true,
      stock: true,
      locationStocks: { select: { stock: true } },
    },
  });

  for (const product of products) {
    const planned = plan.products.find((row) => row.sku === product.sku);
    if (!planned) continue;
    if (product.stock !== planned.stock) {
      throw new Error(
        `Product ${product.sku} ends at ${product.stock}, expected ${planned.stock}`,
      );
    }
    const siteTotal = product.locationStocks.reduce(
      (sum, row) => sum + row.stock,
      0,
    );
    if (siteTotal !== product.stock) {
      throw new Error(
        `Site ledger for ${product.sku} sums to ${siteTotal}, expected ${product.stock}`,
      );
    }
  }
}

// ─── SuperAdmin (never in production) ─────────────────────────────────────

async function ensureLocalSuperAdmin(
  prisma: PrismaClient,
  options: CliOptions,
): Promise<void> {
  if (options.mode === 'verify') return;

  if (process.env.NODE_ENV === 'production') {
    log('production target: the SuperAdmin is never created or modified here.');
    return;
  }

  const existing = await prisma.user.findUnique({
    where: { email: options.superAdminEmail },
    select: { id: true, isSuperAdmin: true },
  });

  if (existing) {
    if (!existing.isSuperAdmin) {
      fail(
        `${options.superAdminEmail} exists and is not a SuperAdmin. Choose another SUPER_ADMIN_EMAIL.`,
      );
    }
    log(
      `SuperAdmin ${options.superAdminEmail} already present; left untouched.`,
    );
    return;
  }

  const passwordHash = await bcrypt.hash(
    options.superAdminPassword as string,
    BCRYPT_ROUNDS,
  );
  await prisma.user.create({
    data: {
      email: options.superAdminEmail,
      name: SUPER_ADMIN_NAME,
      password: passwordHash,
      isSuperAdmin: true,
      tokenVersion: 0,
    },
  });
  log(
    `SuperAdmin ${options.superAdminEmail} created (password from SUPER_ADMIN_PASSWORD; never printed).`,
  );
}

// ─── Reporting ─────────────────────────────────────────────────────────────

function formatCounts(counts: SectionCounts): string {
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

async function describeTargets(
  prisma: PrismaClient,
  plan: TestOrgsSeedPlan,
): Promise<void> {
  for (const row of plan.organizations) {
    const existing = await prisma.organization.findUnique({
      where: { slug: row.organization.slug },
      select: {
        name: true,
        plan: true,
        users: {
          where: { isPrimaryOwner: true },
          select: { user: { select: { email: true } } },
        },
        _count: { select: { products: true, customers: true, sales: true } },
      },
    });

    if (!existing) {
      log(`target ${row.organization.slug}: missing; --apply would create it.`);
      continue;
    }

    const owner =
      existing.users.map((membership) => membership.user.email).join(', ') ||
      '(none)';
    log(
      `target ${row.organization.slug}: already present as "${existing.name}" (${existing.plan}), primary owner ${owner}, ` +
        `products=${existing._count.products}, customers=${existing._count.customers}, sales=${existing._count.sales}. ` +
        (owner === row.users[0]?.email
          ? '--apply would skip it.'
          : '--apply would refuse: this seed did not create it.'),
    );
  }
}

const LIMIT_TYPES = [
  'users',
  'products',
  'customers',
  'cashRegisters',
] as const;

async function verifyOrganization(
  prisma: PrismaClient,
  plan: TestOrgPlan,
): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { slug: plan.organization.slug },
    select: { id: true, name: true, plan: true },
  });

  if (!organization) {
    log(
      `${plan.organization.slug}: MISSING (expected "${plan.organization.name}")`,
    );
    return;
  }
  const organizationId = organization.id;

  const [
    users,
    categories,
    products,
    customers,
    suppliers,
    locations,
    cashRegisters,
    purchaseOrders,
    sentPurchaseOrders,
    sales,
    expenses,
    employees,
    shifts,
    payrollObligations,
    moneyLoans,
    inventoryLoans,
    stockTransfers,
    tasks,
    productStocks,
  ] = await Promise.all([
    prisma.organizationUser.count({ where: { organizationId } }),
    prisma.category.count({ where: { organizationId } }),
    prisma.product.count({ where: { organizationId, active: true } }),
    prisma.customer.count({ where: { organizationId, active: true } }),
    prisma.supplier.count({ where: { organizationId } }),
    prisma.location.count({ where: { organizationId } }),
    prisma.cashRegister.count({ where: { organizationId, active: true } }),
    prisma.purchaseOrder.count({ where: { organizationId } }),
    prisma.purchaseOrder.count({
      where: { organizationId, sentAt: { not: null } },
    }),
    prisma.sale.count({ where: { organizationId } }),
    prisma.expense.count({ where: { organizationId } }),
    prisma.employee.count({ where: { organizationId } }),
    prisma.employeeShift.count({ where: { organizationId } }),
    prisma.payrollObligation.count({ where: { organizationId } }),
    prisma.moneyLoan.count({ where: { organizationId } }),
    prisma.inventoryLoan.count({ where: { organizationId } }),
    prisma.stockTransfer.count({ where: { organizationId } }),
    prisma.task.count({ where: { organizationId } }),
    prisma.productStock.count({ where: { organizationId } }),
  ]);

  log(
    `${organization.name} (${plan.organization.slug}, plan ${organization.plan}):`,
  );
  const sections: [string, number][] = [
    ['locations', locations],
    ['product stock rows', productStocks],
    ['cash registers', cashRegisters],
    ['memberships', users],
    ['categories', categories],
    ['products', products],
    ['customers', customers],
    ['suppliers', suppliers],
    ['purchase orders', purchaseOrders],
    ['sent purchase orders', sentPurchaseOrders],
    ['sales', sales],
    ['expenses', expenses],
    ['employees', employees],
    ['employee shifts', shifts],
    ['payroll obligations', payrollObligations],
    ['money loans', moneyLoans],
    ['inventory loans', inventoryLoans],
    ['stock transfers', stockTransfers],
    ['tasks', tasks],
  ];
  for (const [label, value] of sections) {
    console.log(`  ${label}: ${value}`);
  }

  const limits = PLAN_LIMITS[organization.plan];
  const counts: Record<(typeof LIMIT_TYPES)[number], number> = {
    users,
    products,
    customers,
    cashRegisters,
  };
  const limitByType: Record<(typeof LIMIT_TYPES)[number], number> = {
    users: limits.maxUsers,
    products: limits.maxProducts,
    customers: limits.maxCustomers,
    cashRegisters: limits.maxCashRegisters,
  };
  for (const type of LIMIT_TYPES) {
    const limit = limitByType[type];
    const usage =
      limit === -1
        ? `${counts[type]} (sin límite)`
        : `${counts[type]}/${limit}`;
    console.log(`  plan limit ${type}: ${usage}`);
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const options = readOptions();
  const plan = buildTestOrgsSeedPlan();

  log(`test organizations seed plan (${options.mode})`);
  for (const line of summarizeTestOrgsPlan(plan)) {
    console.log(`  - ${line}`);
  }

  if (options.mode === 'dry-run') {
    if (process.env.DATABASE_URL) {
      const prisma = new PrismaClient();
      try {
        await describeTargets(prisma, plan);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(
          `could not inspect the targets (${message}); the dry run is unchanged.`,
        );
      } finally {
        await prisma.$disconnect();
      }
    } else {
      log('no DATABASE_URL set; skipping the target inspection.');
    }
    log(
      'dry run only: nothing was written. Re-run the same command with --apply to write.',
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    if (options.mode === 'verify') {
      for (const row of plan.organizations) {
        await verifyOrganization(prisma, row);
      }
      return;
    }

    log(
      'preflight: refusing if a target slug or name belongs to another organization...',
    );
    const targets = await preflight(prisma, plan);

    await ensureLocalSuperAdmin(prisma, options);

    const passwordHash = await bcrypt.hash(
      options.seedPassword as string,
      BCRYPT_ROUNDS,
    );

    let created = 0;
    let skipped = 0;

    for (const target of targets) {
      const slug = target.plan.organization.slug;
      if (target.existingOrganizationId) {
        skipped += 1;
        log(
          `${slug}: already present; skipped (nothing inside it was touched).`,
        );
        continue;
      }

      const counts = await applyOrganization(prisma, target.plan, passwordHash);
      created += 1;
      const written = formatCounts(counts);
      log(
        `${slug}: created${written ? ` — ${written}` : ''} (one transaction).`,
      );
    }

    log(
      `done: ${created} organization(s) created, ${skipped} already present. ` +
        'Log in with the ADMIN emails in the plan and the seed password you provided (never printed).',
    );
  } finally {
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${LOG_PREFIX} failed: ${message}`);
  process.exitCode = 1;
});
