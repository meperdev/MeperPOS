import {
  BillingStatus,
  CustomerSegment,
  EmployeeRemunerationModality,
  EmployeeShiftKind,
  ExpensePaymentStatus,
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
  SupplierAccountType,
  TaskEventType,
  TaskStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as fs from 'node:fs';
import { BCRYPT_ROUNDS } from '../src/common/constants/security.constants';
import { DEFAULT_EXPENSE_TAXONOMY } from '../src/expenses/default-expense-categories';
import {
  buildSandboxSeedPlan,
  summarizeSandboxPlan,
  type SandboxSeedPlan,
  type SandboxUserKey,
} from '../src/seeding/sandbox-seed.plan';

/**
 * Production sandbox seed CLI.
 *
 * Creates ONE sandbox organization with representative data for every module so
 * a demo or a product walkthrough has something to show. It never touches any
 * other organization and never updates existing rows: every section is
 * create-if-missing, so a second run only tops up what is absent.
 *
 * Safety contract:
 *  - DRY RUN IS THE DEFAULT. Only the exact `--apply` flag writes.
 *  - Outside development/test it refuses unless SEED_ALLOW_NON_DEV=true and an
 *    explicit SEED_SANDBOX_SLUG is set; there is no production default slug.
 *  - `--apply` requires SEED_DEMO_PASSWORD (12+ characters). The password is
 *    hashed with the shared cost factor and never printed.
 *  - All writes of one run happen inside ONE transaction. A failure leaves no
 *    half-seeded organization behind.
 *
 * The dataset itself lives in ../src/seeding/sandbox-seed.plan.ts, so it can be
 * tested without a database; this file only reads the environment, resolves
 * identifiers and writes the plan.
 */

const prisma = new PrismaClient();
const LOG_PREFIX = '[seed-sandbox]';

interface CliOptions {
  apply: boolean;
  slug: string;
  organizationName: string;
  ownerEmail: string;
  ownerName: string;
  staffEmailDomain: string;
  password: string | null;
}

interface WrittenCounts {
  organization: number;
  users: number;
  categories: number;
  products: number;
  customers: number;
  suppliers: number;
  purchaseOrders: number;
  inventoryMovements: number;
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

function emptyCounts(): WrittenCounts {
  return {
    organization: 0,
    users: 0,
    categories: 0,
    products: 0,
    customers: 0,
    suppliers: 0,
    purchaseOrders: 0,
    inventoryMovements: 0,
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

/**
 * Reads the demo password from the environment or from a file, never both.
 * The file path follows the provisioning rule: a regular file no other account
 * can read, so the plaintext never has to live in the process environment.
 */
function readDemoPassword(): string | null {
  const direct = process.env.SEED_DEMO_PASSWORD;
  const rawPath = process.env.SEED_DEMO_PASSWORD_FILE?.trim();

  if (direct && rawPath) {
    fail(
      'set only one of SEED_DEMO_PASSWORD and SEED_DEMO_PASSWORD_FILE, never both.',
    );
  }
  if (!direct && !rawPath) return null;

  if (!rawPath) return direct ?? null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(rawPath);
  } catch {
    fail(
      `SEED_DEMO_PASSWORD_FILE "${rawPath}" does not exist or cannot be read.`,
    );
  }
  if (!stat.isFile()) {
    fail(`SEED_DEMO_PASSWORD_FILE "${rawPath}" is not a regular file.`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fail(
      `SEED_DEMO_PASSWORD_FILE "${rawPath}" is readable by other accounts; chmod 600 it first.`,
    );
  }

  return fs.readFileSync(rawPath, 'utf8').replace(/\r?\n$/, '');
}

function readOptions(): CliOptions {
  const nodeEnv = process.env.NODE_ENV;
  const isDevOrTest = nodeEnv === 'development' || nodeEnv === 'test';
  const allowNonDev = process.env.SEED_ALLOW_NON_DEV === 'true';
  const apply = process.argv.includes('--apply');

  if (!isDevOrTest && !allowNonDev) {
    fail(
      `NODE_ENV is "${nodeEnv ?? 'undefined'}", so this seed needs SEED_ALLOW_NON_DEV=true.`,
    );
  }

  const configuredSlug = process.env.SEED_SANDBOX_SLUG?.trim();
  if (!isDevOrTest && !configuredSlug) {
    fail(
      'SEED_SANDBOX_SLUG is required outside development; refusing to guess a production organization.',
    );
  }

  const slug = configuredSlug || 'sandbox-demo';
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) {
    fail(
      `slug "${slug}" must be lowercase letters, numbers and dashes (2-61 characters).`,
    );
  }

  const staffEmailDomain =
    process.env.SEED_SANDBOX_EMAIL_DOMAIN?.trim() || `${slug}.demo`;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(staffEmailDomain)) {
    fail(
      `SEED_SANDBOX_EMAIL_DOMAIN "${staffEmailDomain}" is not a valid domain.`,
    );
  }

  const ownerEmail =
    process.env.SEED_OWNER_EMAIL?.trim().toLowerCase() ||
    `owner@${staffEmailDomain}`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    fail(`SEED_OWNER_EMAIL "${ownerEmail}" is not a valid email.`);
  }

  const password = readDemoPassword();
  if (apply && (!password || password.length < 12)) {
    fail(
      'SEED_DEMO_PASSWORD or SEED_DEMO_PASSWORD_FILE is required for --apply and must have at least 12 characters.',
    );
  }
  if (password && password !== password.trim()) {
    fail('the demo password must not start or end with whitespace.');
  }

  return {
    apply,
    slug,
    organizationName:
      process.env.SEED_SANDBOX_NAME?.trim() || 'Mercado Central Sandbox',
    ownerEmail,
    ownerName: process.env.SEED_OWNER_NAME?.trim() || 'Santiago Villabona',
    staffEmailDomain,
    password,
  };
}

function buildPlan(options: CliOptions): SandboxSeedPlan {
  return buildSandboxSeedPlan({
    organizationName: options.organizationName,
    organizationSlug: options.slug,
    ownerName: options.ownerName,
    ownerEmail: options.ownerEmail,
    staffEmailDomain: options.staffEmailDomain,
  });
}

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

// ─── Section writers ───────────────────────────────────────────────────────

async function ensureOrganization(
  tx: Prisma.TransactionClient,
  plan: SandboxSeedPlan,
  counts: WrittenCounts,
): Promise<{ organizationId: string; created: boolean }> {
  const existing = await tx.organization.findUnique({
    where: { slug: plan.organization.slug },
    select: { id: true },
  });

  let organizationId: string;
  let created = false;

  if (existing) {
    organizationId = existing.id;
  } else {
    const organization = await tx.organization.create({
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
        settings: plan.organization.settings,
        locations: { create: { name: 'Sede principal', isDefault: true } },
      },
      select: { id: true },
    });
    organizationId = organization.id;
    created = true;
    counts.organization = 1;
  }

  const currentYear = new Date().getFullYear();
  for (const sequence of plan.organization.sequences) {
    const found = await tx.organizationSequence.findFirst({
      where: {
        organizationId,
        type: sequence.type,
        year: currentYear,
      },
      select: { id: true },
    });
    if (!found) {
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
  }

  const existingDefault = await tx.cashRegister.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });

  for (const name of plan.organization.cashRegisters) {
    const found = await tx.cashRegister.findFirst({
      where: { organizationId, name },
      select: { id: true },
    });
    if (!found) {
      await tx.cashRegister.create({
        data: {
          organizationId,
          name,
          isDefault:
            name === plan.organization.cashRegisters[0] && !existingDefault,
        },
      });
    }
  }

  return { organizationId, created };
}

async function ensureExpenseTaxonomy(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();

  for (const [groupName, labelNames] of Object.entries(
    DEFAULT_EXPENSE_TAXONOMY,
  )) {
    let group = await tx.expenseGroup.findUnique({
      where: { organizationId_name: { organizationId, name: groupName } },
      select: { id: true },
    });
    if (!group) {
      group = await tx.expenseGroup.create({
        data: { organizationId, name: groupName },
        select: { id: true },
      });
    }

    for (const labelName of labelNames) {
      let label = await tx.expenseLabel.findUnique({
        where: { groupId_name: { groupId: group.id, name: labelName } },
        select: { id: true },
      });
      if (!label) {
        label = await tx.expenseLabel.create({
          data: { organizationId, groupId: group.id, name: labelName },
          select: { id: true },
        });
      }
      labels.set(`${groupName}::${labelName}`, label.id);
    }
  }

  return labels;
}

async function ensureUsers(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  passwordHash: string | null,
  counts: WrittenCounts,
): Promise<Map<SandboxUserKey, string>> {
  const userIds = new Map<SandboxUserKey, string>();

  for (const userPlan of plan.users) {
    let user = await tx.user.findUnique({
      where: { email: userPlan.email },
      select: { id: true },
    });

    if (!user) {
      if (!passwordHash) {
        throw new Error(
          `Cannot create user ${userPlan.email} without SEED_DEMO_PASSWORD`,
        );
      }
      user = await tx.user.create({
        data: {
          email: userPlan.email,
          name: userPlan.name,
          password: passwordHash,
          tokenVersion: 0,
        },
        select: { id: true },
      });
      counts.users += 1;
    }

    const membership = await tx.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId,
        },
      },
      select: { id: true },
    });
    if (!membership) {
      await tx.organizationUser.create({
        data: {
          userId: user.id,
          organizationId,
          role: userPlan.role as OrgRole,
          isPrimaryOwner: userPlan.isPrimaryOwner,
        },
      });
    }

    userIds.set(userPlan.key, user.id);
  }

  return userIds;
}

async function ensureCategories(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  counts: WrittenCounts,
): Promise<Map<string, string>> {
  const categoryIds = new Map<string, string>();

  for (const category of plan.categories) {
    let row = await tx.category.findUnique({
      where: {
        organizationId_name: {
          organizationId,
          name: category.name,
        },
      },
      select: { id: true },
    });
    if (!row) {
      row = await tx.category.create({
        data: {
          organizationId,
          name: category.name,
          description: category.description,
          taxable: category.taxable,
          defaultTaxRate: new Prisma.Decimal(category.defaultTaxRate),
        },
        select: { id: true },
      });
      counts.categories += 1;
    }
    categoryIds.set(category.name, row.id);
  }

  return categoryIds;
}

interface ProductRow {
  id: string;
  stock: number;
  openingStock: number;
  created: boolean;
}

async function ensureProducts(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  categoryIds: Map<string, string>,
  counts: WrittenCounts,
): Promise<Map<string, ProductRow>> {
  const products = new Map<string, ProductRow>();

  for (const product of plan.products) {
    const existing = await tx.product.findUnique({
      where: {
        organizationId_sku: { organizationId, sku: product.sku },
      },
      select: { id: true, stock: true },
    });

    if (existing) {
      products.set(product.sku, {
        id: existing.id,
        stock: existing.stock,
        openingStock: product.openingStock,
        created: false,
      });
      continue;
    }

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
      created: true,
    });
    counts.products += 1;
  }

  return products;
}

async function ensureCustomers(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  counts: WrittenCounts,
): Promise<Map<string, string>> {
  const customerIds = new Map<string, string>();

  for (const customer of plan.customers) {
    let row = await tx.customer.findUnique({
      where: {
        organizationId_documentNumber: {
          organizationId,
          documentNumber: customer.documentNumber,
        },
      },
      select: { id: true },
    });
    if (!row) {
      row = await tx.customer.create({
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
      counts.customers += 1;
    }
    customerIds.set(customer.documentNumber, row.id);
  }

  return customerIds;
}

async function ensureSuppliers(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  counts: WrittenCounts,
): Promise<Map<string, string>> {
  const supplierIds = new Map<string, string>();

  for (const supplier of plan.suppliers) {
    let row = await tx.supplier.findUnique({
      where: {
        organizationId_documentNumber: {
          organizationId,
          documentNumber: supplier.documentNumber,
        },
      },
      select: { id: true },
    });
    if (!row) {
      row = await tx.supplier.create({
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
      counts.suppliers += 1;
    }
    supplierIds.set(supplier.documentNumber, row.id);
  }

  return supplierIds;
}

interface PurchaseOrderRow {
  id: string;
  orderNumber: number;
  created: boolean;
}

async function ensurePurchaseOrders(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  supplierIds: Map<string, string>,
  productIds: Map<string, ProductRow>,
  createdById: string,
  counts: WrittenCounts,
): Promise<Map<string, PurchaseOrderRow>> {
  const orders = new Map<string, PurchaseOrderRow>();

  for (const order of plan.purchaseOrders) {
    const existing = await tx.purchaseOrder.findFirst({
      where: { organizationId, notes: order.notes },
      select: { id: true, orderNumber: true },
    });
    if (existing) {
      orders.set(order.key, {
        id: existing.id,
        orderNumber: existing.orderNumber,
        created: false,
      });
      continue;
    }

    const supplierId = supplierIds.get(order.supplierKey);
    if (!supplierId) throw new Error(`Unknown supplier ${order.supplierKey}`);

    const highest = await tx.purchaseOrder.aggregate({
      where: { organizationId },
      _max: { orderNumber: true },
    });
    const orderNumber = (highest._max.orderNumber ?? 0) + 1;

    const created = await tx.purchaseOrder.create({
      data: {
        organizationId,
        orderNumber,
        supplierId,
        createdById,
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

    orders.set(order.key, {
      id: created.id,
      orderNumber: created.orderNumber,
      created: true,
    });
    counts.purchaseOrders += 1;
  }

  return orders;
}

async function ensureInventoryMovements(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  productIds: Map<string, ProductRow>,
  orderRows: Map<string, PurchaseOrderRow>,
  createdById: string,
  counts: WrittenCounts,
): Promise<void> {
  const openingReason = 'Carga inicial sandbox';

  // One opening movement per product created by this seed, ending exactly where
  // the first seeded purchase starts.
  for (const product of plan.products) {
    if (product.type !== 'PRODUCT' || product.openingStock === 0) continue;
    const row = productIds.get(product.sku);
    if (!row?.created) continue;

    const already = await tx.inventoryMovement.findFirst({
      where: {
        organizationId,
        productId: row.id,
        reason: openingReason,
      },
      select: { id: true },
    });
    if (already) continue;

    await tx.inventoryMovement.create({
      data: {
        organizationId,
        productId: row.id,
        type: MovementType.ADJUSTMENT_IN,
        quantity: product.openingStock,
        previousStock: 0,
        newStock: product.openingStock,
        reason: openingReason,
        userId: createdById,
        createdAt: addDays(new Date(), -90),
      },
    });
    counts.inventoryMovements += 1;
  }

  // Received purchase lines, in chronological order, so previousStock/newStock
  // chain from the opening stock to the product's current stock.
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

      const already = await tx.inventoryMovement.findFirst({
        where: { organizationId, productId: product.id, reason },
        select: { id: true },
      });
      if (!already) {
        await tx.inventoryMovement.create({
          data: {
            organizationId,
            productId: product.id,
            type: MovementType.PURCHASE,
            quantity: item.qtyReceived,
            previousStock,
            newStock,
            reason,
            userId: createdById,
            createdAt: order.receivedAt
              ? new Date(order.receivedAt)
              : new Date(),
          },
        });
        counts.inventoryMovements += 1;
      }
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
}

async function ensureSales(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  userIds: Map<SandboxUserKey, string>,
  customerIds: Map<string, string>,
  productIds: Map<string, ProductRow>,
  counts: WrittenCounts,
): Promise<boolean> {
  const existingSales = await tx.sale.count({ where: { organizationId } });
  if (existingSales > 0) {
    return false;
  }

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

  const currentYear = new Date().getFullYear();
  await tx.organizationSequence.updateMany({
    where: { organizationId, type: 'SALE', year: currentYear },
    data: { currentNumber: plan.sales.length },
  });

  return true;
}

async function ensureExpenses(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  labelIds: Map<string, string>,
  supplierIds: Map<string, string>,
  orderRows: Map<string, PurchaseOrderRow>,
  createdById: string,
  counts: WrittenCounts,
): Promise<void> {
  for (const expense of plan.expenses) {
    const description = `[sandbox] ${expense.description}`;
    const existing = await tx.expense.findFirst({
      where: { organizationId, description },
      select: { id: true },
    });
    if (existing) continue;

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

    const date = addDays(new Date(), -expense.daysAgo);
    await tx.expense.create({
      data: {
        organizationId,
        labelId,
        supplierId: supplierId ?? null,
        purchaseOrderId: purchaseOrderId ?? null,
        description,
        date,
        total: new Prisma.Decimal(expense.total),
        status: expense.status as ExpensePaymentStatus,
        createdById,
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

async function ensureEmployees(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  counts: WrittenCounts,
): Promise<Map<string, string>> {
  const employeeIds = new Map<string, string>();

  for (const employee of plan.employees) {
    let row = await tx.employee.findFirst({
      where: {
        organizationId,
        identification: employee.identification,
      },
      select: { id: true },
    });
    if (!row) {
      row = await tx.employee.create({
        data: {
          organizationId,
          name: employee.name,
          identification: employee.identification,
          phone: employee.phone,
          email: employee.email,
          address: employee.address,
          jobTitle: employee.jobTitle,
          startDate:
            employee.startDate === null
              ? null
              : atUtcMidnight(employee.startDate),
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
      counts.employees += 1;
    }
    employeeIds.set(employee.key, row.id);

    for (const shift of employee.shifts) {
      const existingShift = await tx.employeeShift.findUnique({
        where: {
          organizationId_employeeId_date: {
            organizationId,
            employeeId: row.id,
            date: atUtcMidnight(shift.date),
          },
        },
        select: { id: true },
      });
      if (existingShift) continue;

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

async function ensurePayroll(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  employeeIds: Map<string, string>,
  actorId: string,
  counts: WrittenCounts,
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
        select: { id: true, date: true },
      });
      if (shifts.length !== payroll.shiftDates.length) {
        throw new Error(
          `Payroll ${payroll.key} could not resolve every shift of ${payroll.employeeKey}`,
        );
      }

      const linked = await tx.payrollShiftMembership.findFirst({
        where: {
          organizationId,
          employeeId,
          shiftId: { in: shifts.map((shift) => shift.id) },
          releasedAt: null,
        },
        select: { id: true },
      });
      if (linked) continue;

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

    const existing = await tx.payrollObligation.findFirst({
      where: {
        organizationId,
        employeeId,
        kind: PayrollObligationKind.FIXED_PERIOD,
        periodStart: atUtcMidnight(payroll.periodStart),
      },
      select: { id: true },
    });
    if (existing) continue;

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

async function ensureMoneyLoans(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  customerIds: Map<string, string>,
  supplierIds: Map<string, string>,
  userIds: Map<SandboxUserKey, string>,
  actorId: string,
  counts: WrittenCounts,
): Promise<void> {
  for (const loan of plan.moneyLoans) {
    const existing = await tx.moneyLoan.findFirst({
      where: { organizationId, reason: loan.reason },
      select: { id: true },
    });
    if (existing) continue;

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
              : JSON.stringify({
                  ...event.requestPayload,
                  actorId,
                }),
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

async function ensureTasks(
  tx: Prisma.TransactionClient,
  organizationId: string,
  plan: SandboxSeedPlan,
  userIds: Map<SandboxUserKey, string>,
  actorId: string,
  counts: WrittenCounts,
): Promise<void> {
  const now = new Date();

  for (const task of plan.tasks) {
    const existing = await tx.task.findFirst({
      where: { organizationId, title: task.title },
      select: { id: true },
    });
    if (existing) continue;

    const assignedToId = userIds.get(task.assignedTo);
    if (!assignedToId)
      throw new Error(`Unknown task assignee ${task.assignedTo}`);

    const firstEvent = task.events[0];
    const createdAt = addDays(now, -firstEvent.daysAgo);

    const created = await tx.task.create({
      data: {
        organizationId,
        title: task.title,
        description: task.description,
        status: task.status as TaskStatus,
        createdById: actorId,
        assignedToId,
        dueDate: task.dueInDays === null ? null : addDays(now, task.dueInDays),
        createdAt,
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

async function applyPlan(
  plan: SandboxSeedPlan,
  options: CliOptions,
): Promise<WrittenCounts> {
  const counts = emptyCounts();
  const passwordHash = await bcrypt.hash(
    options.password as string,
    BCRYPT_ROUNDS,
  );

  await prisma.$transaction(
    async (tx) => {
      const { organizationId } = await ensureOrganization(tx, plan, counts);
      const labelIds = await ensureExpenseTaxonomy(tx, organizationId);
      const userIds = await ensureUsers(
        tx,
        organizationId,
        plan,
        passwordHash,
        counts,
      );
      const ownerId = userIds.get('owner');
      if (!ownerId) throw new Error('Owner user was not resolved');

      const categoryIds = await ensureCategories(
        tx,
        organizationId,
        plan,
        counts,
      );
      const productIds = await ensureProducts(
        tx,
        organizationId,
        plan,
        categoryIds,
        counts,
      );
      const customerIds = await ensureCustomers(
        tx,
        organizationId,
        plan,
        counts,
      );
      const supplierIds = await ensureSuppliers(
        tx,
        organizationId,
        plan,
        counts,
      );
      const orderRows = await ensurePurchaseOrders(
        tx,
        organizationId,
        plan,
        supplierIds,
        productIds,
        ownerId,
        counts,
      );
      await ensureInventoryMovements(
        tx,
        organizationId,
        plan,
        productIds,
        orderRows,
        ownerId,
        counts,
      );
      const salesWritten = await ensureSales(
        tx,
        organizationId,
        plan,
        userIds,
        customerIds,
        productIds,
        counts,
      );
      await ensureExpenses(
        tx,
        organizationId,
        plan,
        labelIds,
        supplierIds,
        orderRows,
        ownerId,
        counts,
      );
      const employeeIds = await ensureEmployees(
        tx,
        organizationId,
        plan,
        counts,
      );
      await ensurePayroll(
        tx,
        organizationId,
        plan,
        employeeIds,
        ownerId,
        counts,
      );
      await ensureMoneyLoans(
        tx,
        organizationId,
        plan,
        customerIds,
        supplierIds,
        userIds,
        ownerId,
        counts,
      );
      await ensureTasks(tx, organizationId, plan, userIds, ownerId, counts);

      if (!salesWritten) {
        console.warn(
          `${LOG_PREFIX} organization already had sales; the activity block was skipped.`,
        );
      }
    },
    { maxWait: 10_000, timeout: 300_000 },
  );

  return counts;
}

async function describeTarget(slug: string): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      plan: true,
      status: true,
      createdAt: true,
      _count: {
        select: {
          products: true,
          customers: true,
          sales: true,
          employees: true,
          moneyLoans: true,
        },
      },
    },
  });

  if (!organization) {
    console.log(
      `${LOG_PREFIX} target organization "${slug}" does not exist yet; --apply would create it.`,
    );
    return;
  }

  console.log(
    `${LOG_PREFIX} target organization "${organization.name}" (${slug}) already exists: ` +
      `products=${organization._count.products}, customers=${organization._count.customers}, ` +
      `sales=${organization._count.sales}, employees=${organization._count.employees}, ` +
      `moneyLoans=${organization._count.moneyLoans}. --apply would only add what is missing.`,
  );
}

async function run(): Promise<void> {
  const options = readOptions();
  const plan = buildPlan(options);

  console.log(`${LOG_PREFIX} sandbox seed plan`);
  for (const line of summarizeSandboxPlan(plan)) {
    console.log(`  - ${line}`);
  }
  console.log(
    `${LOG_PREFIX} target owner: ${options.ownerEmail}; staff domain: ${options.staffEmailDomain}`,
  );

  await describeTarget(options.slug);

  if (!options.apply) {
    console.log(
      `${LOG_PREFIX} dry run only. Re-run the same command with --apply to write.`,
    );
    return;
  }

  console.log(`${LOG_PREFIX} applying inside one transaction...`);
  const counts = await applyPlan(plan, options);

  const written = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');

  console.log(
    written
      ? `${LOG_PREFIX} applied: ${written}`
      : `${LOG_PREFIX} applied: nothing new; the organization was already seeded.`,
  );
  console.log(
    `${LOG_PREFIX} login with ${options.ownerEmail} and the SEED_DEMO_PASSWORD you provided.`,
  );
}

void run()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
