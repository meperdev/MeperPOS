import { ForbiddenException } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

type Site = { id: string; name: string; isDefault: boolean };

const cashier = {
  userId: 'test-cashier',
  organizationId: 'org-a',
  role: OrgRole.CASHIER,
} as RequestUser;
const main = { id: 'a', name: 'Main', isDefault: true };
const secondary = { id: 'b', name: 'Secondary', isDefault: false };

type AssignmentFilter = {
  some?: { organizationId?: string; userId?: string };
};

function fixture(sites: Site[], assignments: string[]) {
  const findMany = jest.fn(
    async ({
      where,
      take,
    }: {
      where: Prisma.LocationWhereInput;
      take?: number;
    }) => {
      const organizations = [
        ...sites.map((site) => ({ organizationId: 'org-a', site })),
        { organizationId: 'org-b', site: { ...main, id: 'foreign' } },
      ];
      const selected = organizations
        .filter((row) => row.organizationId === where.organizationId)
        .filter(({ site }) => {
          if (!where.assignments) return true;
          const grant = (where.assignments as AssignmentFilter).some;
          return (
            grant?.organizationId === 'org-a' &&
            grant.userId === cashier.userId &&
            assignments.includes(site.id)
          );
        })
        .map(({ site }) => site);
      return take === undefined ? selected : selected.slice(0, take);
    },
  );
  const location = { findMany };
  const transaction = jest.fn(
    async (
      read: (tx: { location: typeof location }) => unknown,
      _options?: { isolationLevel?: string },
    ) => read({ location }),
  );
  const service = new LocationsService({
    location,
    $transaction: transaction,
  } as unknown as PrismaService);
  return { controller: new LocationsController(service), transaction };
}

describe('POS location context', () => {
  it('allows global-stock checkout at the accessible sole default location', async () => {
    const { controller, transaction } = fixture([main], [main.id]);
    await expect(controller.posContext(cashier)).resolves.toEqual({
      locations: [main],
      checkoutLocationId: main.id,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('does not mistake one assigned location for the organization having one location', async () => {
    const { controller } = fixture([main, secondary], [main.id]);
    await expect(controller.posContext(cashier)).resolves.toEqual({
      locations: [main],
      checkoutLocationId: null,
    });
  });

  it('does not grant an unassigned cashier access to the sole default location', async () => {
    const { controller } = fixture([main], []);
    await expect(controller.posContext(cashier)).resolves.toEqual({
      locations: [],
      checkoutLocationId: null,
    });
  });

  it('does not infer a checkout location from one non-default location', async () => {
    const { controller } = fixture([secondary], [secondary.id]);
    await expect(controller.posContext(cashier)).resolves.toEqual({
      locations: [secondary],
      checkoutLocationId: null,
    });
  });

  it('rejects requests without an organization before reading location data', async () => {
    const { controller, transaction } = fixture([main], [main.id]);
    await expect(
      controller.posContext({ ...cashier, organizationId: undefined }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('requires an organization even for a SUPER_ADMIN context', async () => {
    const { controller, transaction } = fixture([main], [main.id]);
    await expect(
      controller.posContext({
        ...cashier,
        organizationId: undefined,
        role: 'SUPER_ADMIN',
        isSuperAdmin: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('keeps the existing location list contract for a restricted cashier', async () => {
    const { controller } = fixture([main, secondary], [secondary.id]);
    await expect(controller.list(cashier)).resolves.toEqual([secondary]);
  });
});
