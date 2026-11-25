import {
  PrismaClient,
  Prisma,
  OrgRole,
  PlanType,
  OrgStatus,
  BillingStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_EXPENSE_TAXONOMY } from '../src/expenses/default-expense-categories';

/**
 * Deterministic seed for the Playwright smoke suite (e2e/README.md).
 *
 * Everything here is fixed: no faker, no random barcodes, no clock-dependent
 * names. The smoke specs read these values from e2e/fixtures/seed.ts, so a
 * change here must be mirrored there.
 *
 * It only ever runs against the dedicated smoke database. The guard below
 * refuses any DATABASE_URL that is not `meperpos_playwright` on a port other
 * than 5432, so it cannot reach the developer database (`inventario_db` on
 * 5432) even when a backend/.env is present. The database must be fresh: the
 * orchestrator recreates it on every run.
 */

const E2E_DATABASE_NAME = 'meperpos_playwright';
const FORBIDDEN_PORT = '5432';

export const E2E_SEED = {
  organization: { name: 'Tienda Smoke E2E', slug: 'tienda-smoke-e2e' },
  owner: {
    email: 'owner@smoke-e2e.test',
    password: 'smoke-e2e-owner',
    name: 'Dueña Smoke',
  },
  category: 'Bebidas E2E',
  products: [
    {
      name: 'Café americano E2E',
      sku: 'E2E-CAFE-001',
      barcode: '7700000000011',
      costPrice: 2000,
      salePrice: 5000,
      stock: 1000,
      minStock: 5,
    },
    {
      name: 'Agua con gas E2E',
      sku: 'E2E-AGUA-002',
      barcode: '7700000000028',
      costPrice: 1500,
      salePrice: 3000,
      stock: 1000,
      minStock: 5,
    },
  ],
} as const;

function assertSmokeDatabase(rawUrl: string | undefined): void {
  if (!rawUrl) {
    throw new Error('DATABASE_URL is not set; refusing to seed.');
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL; refusing to seed.');
  }
  const database = url.pathname.replace(/^\//, '');
  const port = url.port || FORBIDDEN_PORT;
  if (database !== E2E_DATABASE_NAME || port === FORBIDDEN_PORT) {
    throw new Error(
      `Refusing to seed: the smoke seed only runs against database "${E2E_DATABASE_NAME}" on a port other than ${FORBIDDEN_PORT} (got database "${database}" on port ${port}).`,
    );
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is "production".');
  }
}

function d(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

async function seed(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.organization.findUnique({
    where: { slug: E2E_SEED.organization.slug },
  });
  if (existing) {
    throw new Error(
      'The smoke database is not fresh (the e2e organization already exists). Recreate it with `npm run db:reset` in e2e/.',
    );
  }

  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: E2E_SEED.organization.name,
        slug: E2E_SEED.organization.slug,
        plan: PlanType.PRO,
        status: OrgStatus.ACTIVE,
        billingStatus: BillingStatus.PAID,
        active: true,
        taxId: '900000001',
        phone: '3000000000',
        address: 'Calle 1 # 2-3',
        settings: {
          currency: 'COP',
          taxRate: 0,
          receiptPrefix: 'REC-',
          printHeader: E2E_SEED.organization.name,
          printFooter: 'Gracias por su compra',
        },
      },
    });

    const owner = await tx.user.create({
      data: {
        email: E2E_SEED.owner.email,
        password: await bcrypt.hash(E2E_SEED.owner.password, 10),
        name: E2E_SEED.owner.name,
        tokenVersion: 0,
      },
    });

    await tx.organizationUser.create({
      data: {
        organizationId: organization.id,
        userId: owner.id,
        role: OrgRole.OWNER,
        isPrimaryOwner: true,
      },
    });

    const currentYear = new Date().getFullYear();
    await tx.organizationSequence.createMany({
      data: [
        {
          organizationId: organization.id,
          type: 'SALE',
          prefix: 'REC',
          currentNumber: 0,
          year: currentYear,
        },
        {
          organizationId: organization.id,
          type: 'PO',
          prefix: 'OC',
          currentNumber: 0,
          year: currentYear,
        },
      ],
    });

    await tx.cashRegister.create({
      data: {
        organizationId: organization.id,
        name: 'Caja Principal',
        isDefault: true,
      },
    });

    for (const [groupName, labels] of Object.entries(
      DEFAULT_EXPENSE_TAXONOMY,
    )) {
      const group = await tx.expenseGroup.create({
        data: { name: groupName, organizationId: organization.id },
      });
      await tx.expenseLabel.createMany({
        data: labels.map((name) => ({
          name,
          groupId: group.id,
          organizationId: organization.id,
        })),
      });
    }

    const category = await tx.category.create({
      data: {
        name: E2E_SEED.category,
        active: true,
        taxable: false,
        organizationId: organization.id,
      },
    });

    // Untaxed on purpose: the charged total equals the sale price, so the
    // smoke assertions do not depend on tax rounding.
    for (const product of E2E_SEED.products) {
      await tx.product.create({
        data: {
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          costPrice: d(product.costPrice),
          salePrice: d(product.salePrice),
          taxRate: d(0),
          taxable: false,
          stock: product.stock,
          minStock: product.minStock,
          active: true,
          categoryId: category.id,
          organizationId: organization.id,
        },
      });
    }
  });
}

async function main(): Promise<void> {
  assertSmokeDatabase(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    await seed(prisma);
    console.log(
      `Smoke seed applied: organization "${E2E_SEED.organization.slug}", ${E2E_SEED.products.length} products, owner ${E2E_SEED.owner.email}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
