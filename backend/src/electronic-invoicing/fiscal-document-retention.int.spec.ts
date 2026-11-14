/**
 * T4j [S6,S8] — fiscal retention and tenant isolation proved on PostgreSQL.
 *
 * These are the two guarantees the fiscal migration owns, and neither can be
 * proved against a mock: the database refuses to delete an organization or a
 * sale that still holds a fiscal document (`ON DELETE RESTRICT`), and the
 * composite `(saleId, organizationId)` foreign key refuses a document that
 * pairs one tenant's organization with another tenant's sale.
 *
 * The file deliberately depends on the fiscal schema only: it imports the
 * generated Prisma client and nothing else — no `AppModule`, no
 * `ElectronicInvoicingModule`, no `AdminService` — so it keeps proving the
 * database rule even when the module registration or the admin delete path
 * changes. Those live in `electronic-invoicing.module.spec.ts`.
 *
 * Bound to an explicitly provided isolated database. It creates uniquely named
 * rows and removes exactly those rows, children first; it never migrates,
 * resets or deletes anything wider, and it never sends, accepts or receives
 * anything from DIAN (spec S6):
 *
 *   DATABASE_URL=postgresql://... npx jest --runInBand \
 *     src/electronic-invoicing/fiscal-document-retention.int.spec.ts
 */
import { PlanType, Prisma, PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL;

describe('fiscal document retention and tenant isolation (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const createdOrganizationIds: string[] = [];
  const createdSaleIds: string[] = [];
  const createdFiscalDocumentIds: string[] = [];
  const label = `t4j-${Date.now()}`;
  let userId: string;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error(
        'This suite needs DATABASE_URL pointing at a freshly migrated isolated database',
      );
    }
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    // The migrated schema still carries `Sale.userId` as NOT NULL, so the sale a
    // fiscal document points at needs an author even though the datamodel marks
    // the column optional.
    const user = await prisma.user.create({
      data: {
        email: `${label}@example.com`,
        password: 'hash',
        name: 'T4j User',
        tokenVersion: 0,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Unique rows only, removed children-first; the constraint under test would
    // otherwise refuse the organization cleanup as well.
    await prisma.fiscalDocument.deleteMany({
      where: { id: { in: createdFiscalDocumentIds } },
    });
    await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
    await prisma.organization.deleteMany({
      where: { id: { in: createdOrganizationIds } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  /** An organization plus the sale a fiscal document would point at. */
  async function givenOrganizationWithSale(suffix: string) {
    const organization = await prisma.organization.create({
      data: {
        name: `T4j ${suffix}`,
        slug: `${label}-${suffix}`,
        plan: PlanType.BASIC,
        active: true,
      },
    });
    createdOrganizationIds.push(organization.id);

    const sale = await prisma.sale.create({
      data: {
        organizationId: organization.id,
        userId,
        saleNumber: 1,
        subtotal: 1000,
        taxAmount: 190,
        total: 1190,
        amountPaid: 1190,
        change: 0,
      },
    });
    createdSaleIds.push(sale.id);

    return { organization, sale };
  }

  async function givenFiscalDocument(organizationId: string, saleId: string) {
    const document = await prisma.fiscalDocument.create({
      data: {
        organizationId,
        saleId,
        status: 'PENDING',
        issuedAt: new Date(),
        snapshot: { version: 1, saleId },
      },
    });
    createdFiscalDocumentIds.push(document.id);
    return document;
  }

  /** The P2003 a refused write produces, with its violated constraint named. */
  async function refusedByDatabase(
    operation: Promise<unknown>,
  ): Promise<Prisma.PrismaClientKnownRequestError> {
    const outcome: unknown = await operation.catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const prismaError = outcome as Prisma.PrismaClientKnownRequestError;
    expect(prismaError.code).toBe('P2003');
    return prismaError;
  }

  it('deletes a sale that registered no fiscal document', async () => {
    const { organization, sale } =
      await givenOrganizationWithSale('sale-permitted');

    await expect(
      prisma.sale.delete({ where: { id: sale.id } }),
    ).resolves.toMatchObject({ id: sale.id });

    await expect(prisma.sale.count({ where: { id: sale.id } })).resolves.toBe(
      0,
    );
    // Only the sale is gone; its organization is untouched.
    await expect(
      prisma.organization.count({ where: { id: organization.id } }),
    ).resolves.toBe(1);
  });

  it('refuses at the database to delete a sale that holds a fiscal document', async () => {
    const { organization, sale } =
      await givenOrganizationWithSale('sale-blocked');
    const document = await givenFiscalDocument(organization.id, sale.id);

    const prismaError = await refusedByDatabase(
      prisma.sale.delete({ where: { id: sale.id } }),
    );

    // The sale-side constraint, not the organization one: a direct sale delete
    // is refused by the database itself.
    expect(prismaError.meta?.constraint).toBe(
      'FiscalDocument_saleId_organizationId_fkey',
    );
    await expect(prisma.sale.count({ where: { id: sale.id } })).resolves.toBe(
      1,
    );
    await expect(
      prisma.fiscalDocument.count({ where: { id: document.id } }),
    ).resolves.toBe(1);
  });

  it('deletes a document-free sale while a sibling sale keeps its document', async () => {
    const { organization, sale } = await givenOrganizationWithSale('sibling');
    const document = await givenFiscalDocument(organization.id, sale.id);
    const sibling = await prisma.sale.create({
      data: {
        organizationId: organization.id,
        userId,
        saleNumber: 2,
        subtotal: 1,
        taxAmount: 0,
        total: 1,
        amountPaid: 1,
      },
    });
    createdSaleIds.push(sibling.id);

    await expect(
      prisma.sale.delete({ where: { id: sibling.id } }),
    ).resolves.toMatchObject({ id: sibling.id });
    // The preserved document belongs to the other sale and is still there.
    await expect(
      prisma.fiscalDocument.count({ where: { id: document.id } }),
    ).resolves.toBe(1);
  });

  it('rejects a fiscal document that pairs an organization with another organization sale', async () => {
    const orgA = await givenOrganizationWithSale('tenant-a');
    const orgB = await givenOrganizationWithSale('tenant-b');

    const prismaError = await refusedByDatabase(
      prisma.fiscalDocument.create({
        data: {
          organizationId: orgA.organization.id,
          saleId: orgB.sale.id,
          issuedAt: new Date(),
          snapshot: { version: 1 },
        },
      }),
    );

    // The composite foreign key is what keeps the tenant pair honest; the
    // organization exists and the sale exists, but they are not the same tenant.
    expect(prismaError.meta?.constraint).toBe(
      'FiscalDocument_saleId_organizationId_fkey',
    );
    await expect(
      prisma.fiscalDocument.count({ where: { saleId: orgB.sale.id } }),
    ).resolves.toBe(0);
  });

  it('deletes an organization that registered no fiscal document', async () => {
    const { organization } = await givenOrganizationWithSale('permitted');

    await expect(
      prisma.organization.delete({ where: { id: organization.id } }),
    ).resolves.toMatchObject({ id: organization.id });

    await expect(
      prisma.organization.findUnique({ where: { id: organization.id } }),
    ).resolves.toBeNull();
  });

  it('refuses at the database to delete an organization that holds a fiscal document', async () => {
    const { organization, sale } = await givenOrganizationWithSale('blocked');
    const document = await givenFiscalDocument(organization.id, sale.id);

    const refusal: unknown = await prisma.organization
      .delete({ where: { id: organization.id } })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const prismaError = refusal as Prisma.PrismaClientKnownRequestError;
    expect(prismaError.code).toBe('P2003');
    // The constraint the admin path translates; this is the real shape Prisma 6
    // reports, so the unit test's mocked error is not invented.
    expect(prismaError.meta?.constraint).toBe(
      'FiscalDocument_organizationId_fkey',
    );

    // Nothing was deleted: the sale and its fiscal record are still readable.
    await expect(
      prisma.organization.count({ where: { id: organization.id } }),
    ).resolves.toBe(1);
    await expect(prisma.sale.count({ where: { id: sale.id } })).resolves.toBe(
      1,
    );
    await expect(
      prisma.fiscalDocument.count({ where: { id: document.id } }),
    ).resolves.toBe(1);
  });
});
