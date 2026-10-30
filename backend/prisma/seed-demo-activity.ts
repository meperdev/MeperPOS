import { PrismaClient, Prisma, SaleStatus } from '@prisma/client';
import { faker } from '@faker-js/faker';

/**
 * Fills the local demo organizations with roughly two and a half months of
 * activity (two complete calendar months plus the current one), so reports and
 * period comparisons have something to show.
 *
 * Safe to re-run: each day is topped up to its target instead of duplicated.
 */
const prisma = new PrismaClient();

const DEMO_SLUGS = ['cafeteria-demo', 'supermercado-demo'];
const TAX_RATE = 19;

function d(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Target sales per day: weekends softer, recent weeks slightly busier. */
function dailyTarget(date: Date, daysAgo: number): number {
  const weekday = date.getUTCDay();
  const weekendPenalty = weekday === 0 ? -2 : weekday === 6 ? -1 : 0;
  const growth = daysAgo < 30 ? 1 : 0;
  return Math.max(
    1,
    faker.number.int({ min: 3, max: 6 }) + weekendPenalty + growth,
  );
}

async function ensureExtraCustomers(organizationId: string): Promise<void> {
  const existing = await prisma.customer.findMany({
    where: { organizationId },
    select: { documentNumber: true },
  });
  if (existing.length >= 12) return;

  const taken = new Set(existing.map((customer) => customer.documentNumber));
  const needed = 12 - existing.length;

  for (let index = 0; index < needed; index++) {
    let documentNumber = faker.string.numeric(10);
    while (taken.has(documentNumber)) documentNumber = faker.string.numeric(10);
    taken.add(documentNumber);

    await prisma.customer.create({
      data: {
        organizationId,
        name: faker.person.fullName(),
        documentType: 'CC',
        documentNumber,
        email: faker.internet.email().toLowerCase(),
        phone: `3${faker.string.numeric(9)}`,
        address: faker.location.streetAddress(),
        segment: faker.helpers.arrayElement([
          'OCCASIONAL',
          'FREQUENT',
          'VIP',
        ] as const),
      },
    });
  }
}

async function seedOrganization(slug: string): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!organization) {
    console.log(`  ⚠️  ${slug}: no existe, saltando`);
    return;
  }

  await ensureExtraCustomers(organization.id);

  const [products, customers, memberships, lastSale] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId: organization.id, active: true },
      select: { id: true, salePrice: true, costPrice: true },
    }),
    prisma.customer.findMany({
      where: { organizationId: organization.id },
      select: { id: true },
    }),
    prisma.organizationUser.findMany({
      where: { organizationId: organization.id },
      select: { userId: true },
    }),
    prisma.sale.findFirst({
      where: { organizationId: organization.id },
      orderBy: { saleNumber: 'desc' },
      select: { saleNumber: true },
    }),
  ]);

  if (products.length === 0) {
    console.log(`  ⚠️  ${slug}: sin productos, saltando`);
    return;
  }

  const userIds = memberships.length
    ? memberships.map((membership) => membership.userId)
    : (await prisma.user.findMany({ select: { id: true }, take: 3 })).map(
        (user) => user.id,
      );

  const today = startOfDay(new Date());
  const windowStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1),
  );

  // Day-level idempotence: count what the window already holds.
  const existingSales = await prisma.sale.findMany({
    where: {
      organizationId: organization.id,
      createdAt: { gte: windowStart },
    },
    select: { createdAt: true },
  });
  const perDay = new Map<string, number>();
  for (const sale of existingSales) {
    const key = startOfDay(sale.createdAt).toISOString().slice(0, 10);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  let nextSaleNumber = (lastSale?.saleNumber ?? 0) + 1;
  let created = 0;

  for (let cursor = windowStart; cursor <= today; cursor = addDays(cursor, 1)) {
    const daysAgo = Math.round(
      (today.getTime() - cursor.getTime()) / 86_400_000,
    );
    const key = cursor.toISOString().slice(0, 10);
    const target = dailyTarget(cursor, daysAgo);
    const missing = Math.max(0, target - (perDay.get(key) ?? 0));

    for (let index = 0; index < missing; index++) {
      const itemCount = faker.number.int({ min: 1, max: 4 });
      const selected = faker.helpers.arrayElements(products, itemCount);

      let subtotal = d(0);
      const items = selected.map((product) => {
        const quantity = faker.number.int({ min: 1, max: 3 });
        const lineSubtotal = product.salePrice.mul(quantity);
        subtotal = subtotal.add(lineSubtotal);
        return {
          productId: product.id,
          quantity,
          unitPrice: product.salePrice,
          costPriceSnapshot: product.costPrice,
          taxRate: d(TAX_RATE),
          discountAmount: d(0),
          subtotal: lineSubtotal,
          total: lineSubtotal.mul(d(1 + TAX_RATE / 100)),
          organizationId: organization.id,
        };
      });

      const taxAmount = subtotal.mul(TAX_RATE).div(100);
      const total = subtotal.add(taxAmount);

      // Stores at 08:00–20:00 Bogotá (UTC-5) → 13:00–01:00 UTC.
      const hour = faker.number.int({ min: 8, max: 19 });
      const createdAt = new Date(
        Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth(),
          cursor.getUTCDate(),
          hour + 5,
          faker.number.int({ min: 0, max: 59 }),
        ),
      );
      if (createdAt.getTime() > Date.now()) continue;

      await prisma.sale.create({
        data: {
          organizationId: organization.id,
          saleNumber: nextSaleNumber++,
          customerId:
            faker.helpers.maybe(
              () => faker.helpers.arrayElement(customers).id,
              {
                probability: 0.7,
              },
            ) ?? undefined,
          subtotal,
          taxAmount,
          discountAmount: d(0),
          total,
          amountPaid: total,
          change: d(0),
          status: SaleStatus.COMPLETED,
          userId: faker.helpers.arrayElement(userIds),
          createdAt,
          items: { create: items },
          payments: {
            create: [
              {
                organizationId: organization.id,
                method: faker.helpers.arrayElement([
                  'CASH',
                  'CARD',
                  'TRANSFER',
                ] as const),
                amount: total,
                createdAt,
              },
            ],
          },
        },
      });
      created++;
    }
  }

  // La secuencia debe cubrir todo lo que este script inserto.
  await prisma.organizationSequence.updateMany({
    where: { organizationId: organization.id, type: "SALE" },
    data: { currentNumber: nextSaleNumber - 1 },
  });

  console.log(
    `  ✅ ${organization.name}: ${created} ventas nuevas (${windowStart.toISOString().slice(0, 10)} → ${today
      .toISOString()
      .slice(0, 10)})`,
  );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    console.error(
      `❌ Refusing to seed activity: NODE_ENV is "${process.env.NODE_ENV ?? 'undefined'}".`,
    );
    process.exit(1);
  }

  console.log('📈 Generating two months of demo activity...\n');
  for (const slug of DEMO_SLUGS) {
    await seedOrganization(slug);
  }
  console.log('\n✅ Activity seed completed.');
}

main()
  .catch((error) => {
    console.error('❌ Error seeding activity:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
