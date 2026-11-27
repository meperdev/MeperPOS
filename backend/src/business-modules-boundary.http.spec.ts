import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import request from 'supertest';
import { configureApp, configureErrorHandling } from './app-configuration';
import { JwtStrategy } from './auth/jwt.strategy';
import { AdminBusinessModulesController } from './business-modules/admin-business-modules.controller';
import { BusinessModulesController } from './business-modules/business-modules.controller';
import { BusinessModulesService } from './business-modules/business-modules.service';
import { OrganizationRequiredGuard } from './common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from './common/interceptors/admin-organization.interceptor';
import { CustomerPlateInterceptor } from './customers/customer-plate.interceptor';
import { CustomerVehiclesController } from './customers/customer-vehicles.controller';
import { CustomerVehiclesService } from './customers/customer-vehicles.service';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { PlanLimitService } from './plan-limits/plan-limits.service';
import { PrismaService } from './prisma/prisma.service';

/**
 * T9: durable port of the independently executed S1-S6 module boundary probes.
 *
 * Boots the real controllers with the production validation/error wiring, the
 * real JwtStrategy and signed tokens, and an in-memory Prisma fixture: no
 * database, no live server and no real organization mutation. The probes cover
 * malformed raw flags in both states, persisted role denial, default/tenant/
 * unknown-organization reads, both legacy-plate sync directions, disabled
 * module reads and writes, multi-vehicle preservation, clear-without-deletion
 * and the bulk catalog projection.
 */
const SECRET = 'public-fixture-independent-module-boundary';
const VEHICLES = {
  id: 'vehicles',
  name: 'Vehículos',
  description: 'Placas, modelos y vehículos asociados a cada cliente.',
};

type HttpMethod = 'get' | 'post' | 'put' | 'patch';
type DisabledRequest = [HttpMethod, string, Record<string, unknown>?];

interface UserRow {
  id: string;
  active: boolean;
  tokenVersion: number;
  isSuperAdmin: boolean;
}

interface MembershipWhere {
  userId: string;
  organizationId?: string;
}

interface MembershipRow extends MembershipWhere {
  role: string;
}

interface OrganizationRow {
  id: string;
  status: string;
}

interface ModuleRow {
  organizationId: string;
  module: string;
  enabled: boolean;
}

interface ModuleIdentity {
  organizationId: string;
  module: string;
}

interface ModuleFindUniqueArgs {
  where: { organizationId_module: ModuleIdentity };
}

interface ModuleFindManyArgs {
  where: OrganizationScope;
}

type OrganizationScope =
  | { organizationId: string }
  | { organizationId: { in: string[] } };

interface ModuleUpsertArgs {
  where: { organizationId_module: ModuleIdentity };
  create: ModuleRow;
  update: { enabled: boolean };
}

interface CustomerRow {
  id: string;
  organizationId: string;
  active: boolean;
  placaMoto: string | null;
}

interface CustomerWhere {
  id?: string;
  organizationId?: string;
  active?: boolean;
  documentNumber?: string;
}

interface CustomerFindArgs {
  where: CustomerWhere;
  include?: unknown;
  select?: unknown;
}

interface CustomerWriteArgs {
  where: CustomerWhere;
  data: object;
}

interface VehicleRow {
  id: string;
  organizationId: string;
  customerId: string;
  legacyCustomerId: string | null;
  plate: string;
  model: string | null;
}

interface VehicleWhere {
  id?: string;
  organizationId?: string;
  customerId?: string;
  legacyCustomerId?: string | null;
}

interface VehicleFindArgs {
  where: VehicleWhere;
  orderBy?: unknown;
}

interface VehicleChange {
  plate?: string;
  model?: string | null;
  legacyCustomerId?: string | null;
}

interface VehicleUpdateArgs {
  where: VehicleWhere;
  data: VehicleChange;
}

interface VehicleCreateData {
  organizationId: string;
  customerId: string;
  plate: string;
  model?: string | null;
}

interface VehicleUpsertCreate {
  organizationId: string;
  customerId: string;
  legacyCustomerId: string;
  plate: string;
  model?: string | null;
}

interface VehicleUpsertArgs {
  where: VehicleWhere;
  create: VehicleUpsertCreate;
  update: VehicleChange;
}

interface RowCount {
  count: number;
}

interface FixtureState {
  flags: ModuleRow[];
  customers: CustomerRow[];
  vehicles: VehicleRow[];
}

interface PrismaFixture {
  user: {
    findUnique: (args: { where: { id: string } }) => Promise<UserRow>;
  };
  organizationUser: {
    findFirst: (args: { where: MembershipWhere }) => Promise<MembershipRow>;
  };
  organization: {
    findUnique: (args: {
      where: { id: string };
      select?: { status: boolean };
    }) => Promise<OrganizationRow | null>;
  };
  organizationModule: {
    findUnique: (args: ModuleFindUniqueArgs) => Promise<ModuleRow | null>;
    findMany: jest.Mock<Promise<ModuleRow[]>, [ModuleFindManyArgs]>;
    upsert: (args: ModuleUpsertArgs) => Promise<void>;
  };
  customer: {
    findFirst: (args: CustomerFindArgs) => Promise<CustomerRow | null>;
    update: (args: CustomerWriteArgs) => Promise<CustomerRow>;
    updateMany: (args: CustomerWriteArgs) => Promise<RowCount>;
  };
  customerVehicle: {
    findMany: (args: VehicleFindArgs) => Promise<VehicleRow[]>;
    findFirst: (args: VehicleFindArgs) => Promise<VehicleRow | null>;
    create: (args: { data: VehicleCreateData }) => Promise<VehicleRow>;
    updateMany: (args: VehicleUpdateArgs) => Promise<RowCount>;
    upsert: (args: VehicleUpsertArgs) => Promise<VehicleRow>;
  };
  $transaction: <T>(
    callback: (tx: PrismaFixture) => Promise<T>,
    options?: unknown,
  ) => Promise<T>;
}

/** The error envelope produced by the production HttpExceptionFilter. */
interface PublicErrorResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: unknown;
}

describe('T9 independent public capability interactions S1-S6', () => {
  let app: INestApplication;
  let prisma: PrismaFixture;
  let modules: BusinessModulesService;
  let state: FixtureState;
  let writes = 0;

  // Prisma omits undefined update values; class-transformer DTOs expose
  // optional keys as undefined, so the fixture filters them the same way.
  const defined = (data: object): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );
  const match = (row: object, where: object): boolean =>
    Object.entries(where).every(
      ([key, value]) => (row as Record<string, unknown>)[key] === value,
    );

  const jwt = new JwtService({ secret: SECRET });
  const token = (role: string, organizationId = 'a') =>
    jwt.sign({ sub: role, role, organizationId, tokenVersion: 0 });

  const http = (
    method: HttpMethod,
    path: string,
    body?: Record<string, unknown>,
    role = 'ADMIN',
    organizationId = 'a',
  ) => {
    const pending = request(app.getHttpServer());
    const call = pending[method](`/api/${path}`);
    const authorized = call.set(
      'Authorization',
      `Bearer ${token(role, organizationId)}`,
    );
    return body === undefined ? authorized : authorized.send(body);
  };

  const flag = (
    enabled: boolean,
    organizationId = 'a',
    moduleId = 'vehicles',
  ) =>
    http(
      'patch',
      `admin/organizations/${organizationId}/modules/${moduleId}`,
      { enabled },
      'SUPER_ADMIN',
    );

  const snapshot = () =>
    createHash('sha256')
      .update(JSON.stringify({ state, writes }))
      .digest('hex');

  const expectPublicError = (
    response: PublicErrorResponse,
    status: number,
    code: string,
    message: string,
  ) => {
    expect(response.status).toBe(status);
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.body).toEqual({
      code,
      message,
      requestId: response.headers['x-request-id'],
    });
  };

  beforeAll(async () => {
    prisma = {
      user: {
        findUnique: async ({ where }) => ({
          id: where.id,
          active: true,
          tokenVersion: 0,
          isSuperAdmin: where.id === 'SUPER_ADMIN',
        }),
      },
      organizationUser: {
        findFirst: async ({ where }) => ({ ...where, role: where.userId }),
      },
      organization: {
        findUnique: async ({ where }) =>
          ['a', 'b'].includes(where.id)
            ? { id: where.id, status: 'ACTIVE' }
            : null,
      },
      organizationModule: {
        findUnique: async ({ where }) =>
          state.flags.find((row) => match(row, where.organizationId_module)) ??
          null,
        findMany: jest.fn(async ({ where }: ModuleFindManyArgs) => {
          const scope = where.organizationId;
          return state.flags.filter((row) =>
            typeof scope === 'string'
              ? row.organizationId === scope
              : scope.in.includes(row.organizationId),
          );
        }),
        upsert: async ({ create, update }) => {
          writes += 1;
          const existing = state.flags.find(
            (row) =>
              row.organizationId === create.organizationId &&
              row.module === create.module,
          );
          if (existing) Object.assign(existing, update);
          else state.flags.push({ ...create });
        },
      },
      customer: {
        findFirst: async ({ where }) =>
          state.customers.find((row) => match(row, where)) ?? null,
        update: async ({ where, data }) => {
          writes += 1;
          const customer = state.customers.find((row) => match(row, where));
          if (!customer) throw new Error('fixture: customer not found');
          Object.assign(customer, defined(data));
          return { ...customer };
        },
        updateMany: async ({ where, data }) => {
          writes += 1;
          const customers = state.customers.filter((row) => match(row, where));
          for (const customer of customers)
            Object.assign(customer, defined(data));
          return { count: customers.length };
        },
      },
      customerVehicle: {
        findMany: async ({ where }) =>
          state.vehicles
            .filter((row) => match(row, where))
            .map((row) => ({ ...row })),
        findFirst: async ({ where }) =>
          state.vehicles.find((row) => match(row, where)) ?? null,
        create: async ({ data }) => {
          writes += 1;
          const created: VehicleRow = {
            id: `v${state.vehicles.length}`,
            legacyCustomerId: null,
            model: null,
            organizationId: data.organizationId,
            customerId: data.customerId,
            plate: data.plate,
            ...(data.model === undefined ? {} : { model: data.model }),
          };
          state.vehicles.push(created);
          return { ...created };
        },
        updateMany: async ({ where, data }) => {
          writes += 1;
          const vehicles = state.vehicles.filter((row) => match(row, where));
          for (const vehicle of vehicles) Object.assign(vehicle, defined(data));
          return { count: vehicles.length };
        },
        upsert: async ({ where, create, update }) => {
          writes += 1;
          const existing = state.vehicles.find((row) => match(row, where));
          if (existing) {
            Object.assign(existing, update);
            return { ...existing };
          }
          const created: VehicleRow = {
            id: `v${state.vehicles.length}`,
            organizationId: create.organizationId,
            customerId: create.customerId,
            legacyCustomerId: create.legacyCustomerId,
            plate: create.plate,
            model: create.model ?? null,
          };
          state.vehicles.push(created);
          return { ...created };
        },
      },
      $transaction: async (callback) => callback(prisma),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        AdminBusinessModulesController,
        BusinessModulesController,
        CustomerVehiclesController,
        CustomersController,
      ],
      providers: [
        BusinessModulesService,
        CustomerVehiclesService,
        CustomersService,
        CustomerPlateInterceptor,
        JwtStrategy,
        OrganizationRequiredGuard,
        AdminOrganizationInterceptor,
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_SECRET: SECRET }),
        },
        { provide: PrismaService, useValue: prisma },
        {
          provide: PlanLimitService,
          useValue: {
            checkLimit: async () => ({ allowed: true }),
            invalidateCache: () => undefined,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    configureErrorHandling(app);
    await app.init();
    modules = moduleRef.get(BusinessModulesService);
  });

  beforeEach(() => {
    writes = 0;
    state = {
      flags: [],
      customers: [
        { id: 'c', organizationId: 'a', active: true, placaMoto: ' OLD ' },
        { id: 'd', organizationId: 'b', active: true, placaMoto: 'B' },
      ],
      vehicles: [
        {
          id: 'old',
          organizationId: 'a',
          customerId: 'c',
          legacyCustomerId: 'c',
          plate: ' OLD ',
          model: null,
        },
      ],
    };
    prisma.organizationModule.findMany.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('S1/S3 rejects malformed raw flags in both states without writes or changed reads', async () => {
    const malformedFlags: Record<string, unknown>[] = [
      {},
      { enabled: ' false ' },
      { enabled: 'FALSE' },
      { enabled: 0 },
      { enabled: -1 },
      { enabled: null },
      { enabled: {} },
      { enabled: [false] },
    ];
    for (const initial of [false, true]) {
      await flag(initial);
      for (const payload of malformedFlags) {
        const before = await http('get', 'business-modules');
        const hash = snapshot();
        const rejected = await http(
          'patch',
          'admin/organizations/a/modules/vehicles',
          payload,
          'SUPER_ADMIN',
        );
        expectPublicError(
          rejected,
          400,
          'VALIDATION_ERROR',
          'enabled: enabled must be a boolean value',
        );
        expect(snapshot()).toBe(hash);
        const after = await http('get', 'business-modules');
        expect(after.text).toBe(before.text);
      }
    }
  });

  it.each(['ADMIN', 'CASHIER', 'INVENTORY_USER'])(
    'S3 denies %s with unchanged public state',
    async (role) => {
      const hash = snapshot();
      const before = await http('get', 'business-modules');
      expectPublicError(
        await http(
          'patch',
          'admin/organizations/a/modules/vehicles',
          { enabled: false },
          role,
        ),
        403,
        'FORBIDDEN',
        'Access denied. Required roles: SUPER_ADMIN',
      );
      expect(snapshot()).toBe(hash);
      const after = await http('get', 'business-modules');
      expect(after.text).toBe(before.text);
    },
  );

  it('S1/S6 defaults enabled, isolates tenants, rejects unknown module and missing organization', async () => {
    expect((await http('get', 'business-modules')).body).toEqual([
      { ...VEHICLES, enabled: true },
    ]);
    expect((await flag(false)).body).toEqual({
      ...VEHICLES,
      enabled: false,
    });
    expect(
      (await http('get', 'business-modules', undefined, 'ADMIN', 'b')).body,
    ).toEqual([{ ...VEHICLES, enabled: true }]);

    const hash = snapshot();
    expectPublicError(
      await flag(false, 'a', 'payroll'),
      400,
      'BAD_REQUEST',
      'Unknown module: payroll',
    );
    expect(snapshot()).toBe(hash);
    expectPublicError(
      await flag(false, 'missing'),
      404,
      'NOT_FOUND',
      'Organization not found',
    );
    expect(snapshot()).toBe(hash);

    expect((await flag(true)).body).toEqual({
      ...VEHICLES,
      enabled: true,
    });
  });

  it('S2/S4/S5 preserves multiple vehicles across disable/re-enable and synchronizes only linked legacy plate', async () => {
    let response = await http('post', 'customers/c/vehicles', {
      plate: 'SECOND',
      model: 'Moto 2026',
    });
    expect(response.status).toBe(201);

    response = await http('patch', 'customers/c/vehicles/old', {
      plate: 'NEW',
      model: 'Road',
    });
    expect(response.status).toBe(200);
    expect((await http('get', 'customers/c')).body.placaMoto).toBe('NEW');

    response = await http('put', 'customers/c', { placaMoto: ' NEXT ' });
    expect(response.status).toBe(200);
    const before = await http('get', 'customers/c/vehicles');
    expect(before.body.map((vehicle: VehicleRow) => vehicle.plate)).toEqual([
      ' NEXT ',
      'SECOND',
    ]);

    await flag(false);
    expect((await http('get', 'customers/c')).body.placaMoto).toBeNull();

    const disabledRequests: DisabledRequest[] = [
      ['get', 'customers/c/vehicles'],
      ['post', 'customers/c/vehicles', { plate: 'DENIED' }],
      ['put', 'customers/c', { placaMoto: '' }],
    ];
    for (const [method, path, body] of disabledRequests) {
      const hash = snapshot();
      expectPublicError(
        await http(method, path, body),
        403,
        'FORBIDDEN',
        'Vehicles module is disabled',
      );
      expect(snapshot()).toBe(hash);
    }

    await flag(true);
    const reenabled = await http('get', 'customers/c/vehicles');
    expect(reenabled.text).toBe(before.text);
    expect((await http('get', 'customers/c')).body.placaMoto).toBe(' NEXT ');

    expect((await http('put', 'customers/c', { placaMoto: '' })).status).toBe(
      200,
    );
    const after = await http('get', 'customers/c/vehicles');
    expect(after.body).toHaveLength(2);
    expect(after.body[0]).toMatchObject({
      plate: ' NEXT ',
      legacyCustomerId: null,
    });
  });

  it('S2/S4 rejects a sibling tenant customer before vehicle access', async () => {
    const hash = snapshot();
    expectPublicError(
      await http('post', 'customers/d/vehicles', { plate: 'X' }),
      404,
      'NOT_FOUND',
      'Customer not found',
    );
    expect(snapshot()).toBe(hash);
  });

  it('S6 projects only real modules using one bulk query and no query for empty input', async () => {
    state.flags.push(
      { organizationId: 'a', module: 'retired', enabled: false },
      { organizationId: 'b', module: 'vehicles', enabled: false },
    );

    expect([...(await modules.enabledModulesByOrganization([]))]).toEqual([]);
    expect(prisma.organizationModule.findMany).not.toHaveBeenCalled();

    expect([
      ...(await modules.enabledModulesByOrganization(['a', 'b', 'a'])),
    ]).toEqual([
      ['a', ['vehicles']],
      ['b', []],
    ]);
    expect(prisma.organizationModule.findMany).toHaveBeenCalledTimes(1);
  });
});
