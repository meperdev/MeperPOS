/**
 * T4l [S6,S8] — the admin organization-delete path against a fiscal document.
 *
 * `AdminService.deleteOrganization` reads a fiscal-document count and turns the
 * database's refusal into an answer the caller can act on. Only a real
 * PostgreSQL run proves that: the count is an optimization, the `ON DELETE
 * RESTRICT` constraint is the rule, and a mocked error can never show that the
 * rule survives a stale read.
 *
 * This file therefore owns the three AdminService deletion tests and their
 * fixtures, and nothing else. The database rules on their own (both foreign keys
 * and the composite tenant key) live in
 * `electronic-invoicing/fiscal-document-retention.int.spec.ts`, and the module
 * wiring lives in `electronic-invoicing/electronic-invoicing.module.spec.ts`,
 * so a change to any one of those three concerns has its own reviewable file.
 *
 * Bound to an explicitly provided isolated database. It creates uniquely named
 * rows and removes exactly those rows, children first; it never migrates,
 * resets or deletes anything wider, and it never sends, accepts or receives
 * anything from DIAN (spec S6):
 *
 *   DATABASE_URL=postgresql://... npx jest --runInBand \
 *     src/admin/admin.fiscal-deletion.int.spec.ts
 */
import { ConflictException } from '@nestjs/common';
import { PlanType, PrismaClient } from '@prisma/client';
import { AdminService } from './admin.service';

const databaseUrl = process.env.DATABASE_URL;

describe('admin organization deletion and fiscal documents (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const createdOrganizationIds: string[] = [];
  const createdSaleIds: string[] = [];
  const createdFiscalDocumentIds: string[] = [];
  const label = `t4l-${Date.now()}`;
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
        name: 'T4l User',
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
        name: `T4l ${suffix}`,
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

  const adminService = () =>
    new AdminService(prisma as never, {} as never, {} as never);

  it('lets the admin path delete an organization that holds only sales', async () => {
    const { organization, sale } =
      await givenOrganizationWithSale('permitted-service');

    await expect(
      adminService().deleteOrganization(organization.id, {
        confirmOrganizationName: organization.name,
      }),
    ).resolves.toEqual({ success: true });

    await expect(
      prisma.organization.findUnique({ where: { id: organization.id } }),
    ).resolves.toBeNull();
    // The sale is not a fiscal record; it stays cascaded with its organization.
    await expect(prisma.sale.count({ where: { id: sale.id } })).resolves.toBe(
      0,
    );
  });

  it('answers a conflict, with the count, instead of a database error', async () => {
    const { organization, sale } =
      await givenOrganizationWithSale('blocked-service');
    const document = await givenFiscalDocument(organization.id, sale.id);

    const refusal: unknown = await adminService()
      .deleteOrganization(organization.id, {
        confirmOrganizationName: organization.name,
      })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).message).toContain(
      '1 fiscal document',
    );
    await expect(
      prisma.fiscalDocument.count({ where: { id: document.id } }),
    ).resolves.toBe(1);
  });

  it('still answers a conflict when the count went stale before the delete', async () => {
    const { organization, sale } = await givenOrganizationWithSale('stale');
    const document = await givenFiscalDocument(organization.id, sale.id);

    // The service read zero fiscal documents — a sale registered its own
    // document in between. The database is the last word, and its refusal must
    // still reach the caller as a conflict.
    const staleCountPrisma = {
      organization: {
        findUnique: prisma.organization.findUnique.bind(prisma.organization),
        delete: prisma.organization.delete.bind(prisma.organization),
      },
      fiscalDocument: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new AdminService(
      staleCountPrisma as never,
      {} as never,
      {} as never,
    );

    const refusal: unknown = await service
      .deleteOrganization(organization.id, {
        confirmOrganizationName: organization.name,
      })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ConflictException);
    await expect(
      prisma.fiscalDocument.count({ where: { id: document.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma.organization.count({ where: { id: organization.id } }),
    ).resolves.toBe(1);
  });
});
