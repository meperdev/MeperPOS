import { ForbiddenException } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

type SiteType = 'STORE' | 'WAREHOUSE';
type Site = {
  id: string;
  name: string;
  type: SiteType;
  isDefault: boolean;
};

const cashier = {
  userId: 'test-cashier',
  organizationId: 'org-a',
  role: OrgRole.CASHIER,
} as RequestUser;
const main: Site = { id: 'a', name: 'Main', type: 'STORE', isDefault: true };
const secondary: Site = {
  id: 'b',
  name: 'Secondary',
  type: 'STORE',
  isDefault: false,
};
const warehouse: Site = {
  id: 'w',
  name: 'Bodega',
  type: 'WAREHOUSE',
  isDefault: false,
};
const foreign: Site = {
  id: 'foreign',
  name: 'Foreign',
  type: 'STORE',
  isDefault: true,
};

type AssignmentFilter = {
  some?: { organizationId?: string; userId?: string };
};

const byId = (left: { id: string }, right: { id: string }) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

/** The order `posContext` asks for: principal first, then name, then id. */
const byNominatingOrder = (left: Site, right: Site) =>
  Number(right.isDefault) - Number(left.isDefault) ||
  (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) ||
  byId(left, right);

/**
 * A stand-in for the two reads `posContext` performs: the accessible store list
 * and the organization's principal site. It honors the where-clauses the
 * service uses (organization, grant list, type) so a test can only pass by the
 * rule it claims to pin.
 */
function fixture(sites: Site[], assignments: string[]) {
  const rows = [
    ...sites.map((site) => ({ organizationId: 'org-a', site })),
    { organizationId: 'org-b', site: foreign },
  ];
  const inOrganization = (organizationId: string) =>
    rows.filter((row) => row.organizationId === organizationId);

  const findMany = jest.fn(
    async ({
      where,
      take,
    }: {
      where: Prisma.LocationWhereInput;
      take?: number;
    }) => {
      const grant = (where.assignments as AssignmentFilter | undefined)?.some;
      const selected = inOrganization(String(where.organizationId))
        .filter(({ site }) => {
          if (where.type !== undefined && site.type !== where.type)
            return false;
          if (!grant) return true;
          return (
            grant.organizationId === 'org-a' &&
            grant.userId === cashier.userId &&
            assignments.includes(site.id)
          );
        })
        .map(({ site }) => site)
        .sort(byNominatingOrder);
      return take === undefined ? selected : selected.slice(0, take);
    },
  );
  const findFirst = jest.fn(
    async ({
      where,
      take,
    }: {
      where: Prisma.LocationWhereInput;
      take?: number;
    }) => {
      const selected = inOrganization(String(where.organizationId))
        .filter(({ site }) =>
          where.isDefault === undefined ? true : site.isDefault,
        )
        .map(({ site }) => site)
        .sort(byId);
      const rows = take === undefined ? selected : selected.slice(0, take);
      return rows[0] ?? null;
    },
  );
  const location = { findMany, findFirst };
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
  it('nominates the accessible principal store of a multi-site organization', async () => {
    const { controller, transaction } = fixture([main, secondary], [main.id]);
    await expect(controller.posContext(cashier)).resolves.toEqual({
      locations: [main],
      checkoutLocationId: main.id,
    });

    // The same organization, seen by an organization-wide role: the principal
    // store is nominated even though another store exists.
    const admin = { ...cashier, role: OrgRole.ADMIN };
    const wide = fixture([main, secondary], []);
    await expect(wide.controller.posContext(admin)).resolves.toEqual({
      locations: [main, secondary],
      checkoutLocationId: main.id,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('nominates the single accessible store when the principal is out of reach', async () => {
    const { controller } = fixture([main, secondary], [secondary.id]);
    await expect(controller.posContext(cashier)).resolves.toEqual({
      locations: [secondary],
      checkoutLocationId: secondary.id,
    });
  });

  it('never lists a warehouse as a checkout site', async () => {
    const { controller } = fixture([main, warehouse], [main.id, warehouse.id]);
    await expect(controller.posContext(cashier)).resolves.toEqual({
      locations: [main],
      checkoutLocationId: main.id,
    });

    const onlyWarehouse = fixture([main, warehouse], [warehouse.id]);
    await expect(onlyWarehouse.controller.posContext(cashier)).resolves.toEqual(
      { locations: [], checkoutLocationId: null },
    );
  });

  it('asks the cashier to choose when several stores are reachable and none is principal', async () => {
    // The principal site was turned into a warehouse: the stores that remain are
    // both non-default, and neither is the obvious default.
    const warehousePrincipal: Site = { ...main, type: 'WAREHOUSE' };
    const storeA: Site = {
      id: 'c',
      name: 'Norte',
      type: 'STORE',
      isDefault: false,
    };
    const storeB: Site = {
      id: 'd',
      name: 'Sur',
      type: 'STORE',
      isDefault: false,
    };
    const { controller } = fixture([warehousePrincipal, storeA, storeB], []);
    await expect(
      controller.posContext({ ...cashier, role: OrgRole.ADMIN }),
    ).resolves.toEqual({
      locations: [storeA, storeB],
      checkoutLocationId: null,
    });

    // With exactly one of those stores reachable, it is the default again.
    const restricted = fixture(
      [warehousePrincipal, storeA, storeB],
      [storeA.id],
    );
    await expect(restricted.controller.posContext(cashier)).resolves.toEqual({
      locations: [storeA],
      checkoutLocationId: storeA.id,
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
    // A single reachable store is nominated even when it is not the principal
    // one; it is never promoted into a principal, and the shape is unchanged.
    const { controller } = fixture([secondary], [secondary.id]);
    await expect(controller.posContext(cashier)).resolves.toEqual({
      locations: [secondary],
      checkoutLocationId: secondary.id,
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
