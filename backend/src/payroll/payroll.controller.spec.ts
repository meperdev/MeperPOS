import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { Test, TestingModule } from '@nestjs/testing';
import { OrgRole } from '@prisma/client';
import request from 'supertest';
import { configureApp, configureErrorHandling } from '../app-configuration';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { OrganizationStatusGuard } from '../common/guards/organization-status.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollExpenseCategoryService } from './payroll-expense-category.service';
import { PayrollGroupInstallmentsService } from './payroll-group-installments.service';
import { PayrollGroupsService } from './payroll-groups.service';
import { PayrollModule } from './payroll.module';
import { PayrollObligationsService } from './payroll-obligations.service';
import { PayrollPeriodInstallmentCorrectionService } from './payroll-period-installment-correction.service';
import { PayrollPeriodInstallmentsService } from './payroll-period-installments.service';
import { PayrollPeriodsService } from './payroll-periods.service';

const periods = { create: jest.fn() };
const groups = { create: jest.fn() };
const periodInstallments = { create: jest.fn() };
const groupInstallments = { create: jest.fn() };
const corrections = { correct: jest.fn() };
const prisma = {
  payrollObligation: { findMany: jest.fn() },
  $transaction: jest.fn(),
};

// Every route this controller may expose. Adding an expense/writer route must
// fail this table before it can reach production.
const routeCases = [
  {
    name: 'POST payroll/periods',
    method: 'post',
    path: '/api/payroll/periods',
    routePath: 'periods',
    invoke: periods.create,
    body: {
      employeeId: 'emp-a',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      periodAmount: '1500000.00',
      // The per-payment expense decision is forwarded to the service as sent.
      expenseEnabled: false,
      selectedExpenseDate: '2026-01-31',
    },
    invalid: {
      employeeId: 'emp-a',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      periodAmount: 1500000,
    },
  },
  {
    name: 'POST payroll/groups',
    method: 'post',
    path: '/api/payroll/groups',
    routePath: 'groups',
    invoke: groups.create,
    body: { employeeId: 'emp-a', shiftIds: ['shift-a', 'shift-b'] },
    invalid: { employeeId: 'emp-a', shiftIds: 'shift-a' },
  },
  {
    name: 'POST payroll/period-installments',
    method: 'post',
    path: '/api/payroll/period-installments',
    routePath: 'period-installments',
    invoke: periodInstallments.create,
    body: {
      employeeId: 'emp-a',
      obligationId: 'obligation-a',
      amount: '100.00',
      date: '2026-01-15',
      method: 'CASH',
    },
    invalid: {
      employeeId: 'emp-a',
      obligationId: 'obligation-a',
      amount: 100,
      date: '2026-01-15',
      method: 'CASH',
    },
  },
  {
    name: 'POST payroll/group-installments',
    method: 'post',
    path: '/api/payroll/group-installments',
    routePath: 'group-installments',
    invoke: groupInstallments.create,
    body: {
      employeeId: 'emp-a',
      obligationId: 'obligation-a',
      amount: '100.00',
      date: '2026-01-15',
      method: 'TRANSFER',
    },
    invalid: {
      employeeId: 'emp-a',
      obligationId: 'obligation-a',
      amount: 100,
      date: '2026-01-15',
      method: 'TRANSFER',
    },
  },
  {
    name: 'POST payroll/period-installments/correct',
    method: 'post',
    path: '/api/payroll/period-installments/correct',
    routePath: 'period-installments/correct',
    invoke: corrections.correct,
    body: {
      employeeId: 'emp-a',
      obligationId: 'obligation-a',
      installmentId: 'installment-a',
      amount: '120.00',
    },
    invalid: {
      employeeId: 'emp-a',
      obligationId: 'obligation-a',
      installmentId: 'installment-a',
      amount: 120,
    },
  },
] as const;

const forbiddenRoles = [
  OrgRole.MEMBER,
  OrgRole.CASHIER,
  OrgRole.INVENTORY_USER,
  'SUPER_ADMIN',
] as const;

const obligationSelect = {
  id: true,
  employeeId: true,
  kind: true,
  status: true,
  version: true,
  periodStart: true,
  periodEnd: true,
  periodAmount: true,
  expenseEnabled: true,
  selectedExpenseDate: true,
  createdAt: true,
  updatedAt: true,
  installments: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      outflowId: true,
      createdAt: true,
      outflow: {
        select: {
          id: true,
          amount: true,
          date: true,
          method: true,
          createdAt: true,
        },
      },
    },
  },
  shiftMemberships: {
    orderBy: [{ shiftId: 'asc' }],
    select: {
      id: true,
      shiftId: true,
      releasedAt: true,
      shift: {
        select: { id: true, date: true, kind: true, amount: true },
      },
    },
  },
} as const;

type PayrollControllerClass = {
  name: string;
  prototype: Record<string, object>;
};

function payrollControllerClass() {
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    PayrollModule,
  ) as PayrollControllerClass[];
  return controllers.find(
    (controller) => controller.name === 'PayrollController',
  );
}

describe('payroll HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PayrollModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PayrollPeriodsService)
      .useValue(periods)
      .overrideProvider(PayrollGroupsService)
      .useValue(groups)
      .overrideProvider(PayrollPeriodInstallmentsService)
      .useValue(periodInstallments)
      .overrideProvider(PayrollGroupInstallmentsService)
      .useValue(groupInstallments)
      .overrideProvider(PayrollPeriodInstallmentCorrectionService)
      .useValue(corrections)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          const role = req.headers['x-test-role'];
          if (!role) throw new UnauthorizedException();
          req.user = {
            userId: 'user-a',
            email: 'a@example.com',
            role,
            isSuperAdmin: role === 'SUPER_ADMIN',
            tokenVersion: 0,
            orgStatus: req.headers['x-test-status'] || 'ACTIVE',
            organizationId:
              req.headers['x-test-org'] === 'none' ? undefined : 'org-a',
          };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    configureErrorHandling(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const post = (
    path: string,
    body: unknown,
    role: string = OrgRole.OWNER,
    org?: string,
  ) => {
    const call = request(app.getHttpServer())
      .post(path)
      .set('x-test-role', role);
    if (org) call.set('x-test-org', org);
    return call.send(body as object);
  };
  const get = (path: string, role: string = OrgRole.OWNER, org?: string) => {
    const call = request(app.getHttpServer())
      .get(path)
      .set('x-test-role', role);
    if (org) call.set('x-test-org', org);
    return call;
  };

  it('registers every payroll route under the authenticated payroll controller', () => {
    const Controller = payrollControllerClass();
    expect(Controller).toBeDefined();
    expect(Reflect.getMetadata(PATH_METADATA, Controller!)).toBe('payroll');
    expect(Reflect.getMetadata(GUARDS_METADATA, Controller!)).toEqual([
      JwtAuthGuard,
      OrganizationStatusGuard,
      RolesGuard,
      OrganizationRequiredGuard,
    ]);
    const handlers = Object.getOwnPropertyNames(Controller!.prototype)
      .filter(
        (name) =>
          name !== 'constructor' &&
          Reflect.getMetadata(PATH_METADATA, Controller!.prototype[name]) !==
            undefined,
      )
      .map((name) => ({
        name,
        path: Reflect.getMetadata(
          PATH_METADATA,
          Controller!.prototype[name],
        ) as string,
      }));
    expect(handlers.map(({ path }) => path).sort()).toEqual(
      [...routeCases.map(({ routePath }) => routePath), 'obligations'].sort(),
    );
    for (const { path } of handlers)
      expect(path).not.toMatch(/expense|complete|category/i);
    for (const { routePath, method } of routeCases) {
      const handler =
        Controller!.prototype[
          handlers.find(({ path }) => path === routePath)!.name
        ];
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
        method === 'post' ? 1 : 0,
      );
    }
    expect(Reflect.getMetadata(ROLES_KEY, Controller!)).toEqual([
      OrgRole.OWNER,
      OrgRole.ADMIN,
    ]);
  });

  it('denies MEMBER, CASHIER, INVENTORY_USER and SUPER_ADMIN on every route', async () => {
    for (const role of forbiddenRoles) {
      for (const { path, body, invoke, routePath } of routeCases) {
        await post(path, body, role).expect(403);
        expect(invoke).not.toHaveBeenCalled();
        expect(routePath).toBeTruthy();
      }
      await get('/api/payroll/obligations?employeeId=emp-a', role).expect(403);
      expect(prisma.payrollObligation.findMany).not.toHaveBeenCalled();
    }
  });

  it('requires an organization for every route and never accepts it from the body', async () => {
    for (const { path, body, invoke } of routeCases) {
      await post(path, body, OrgRole.OWNER, 'none').expect(403);
      expect(invoke).not.toHaveBeenCalled();
    }
    await get(
      '/api/payroll/obligations?employeeId=emp-a',
      OrgRole.OWNER,
      'none',
    ).expect(403);
    expect(prisma.payrollObligation.findMany).not.toHaveBeenCalled();

    for (const { path, body, invoke } of routeCases) {
      await post(path, { ...body, organizationId: 'org-b' }).expect(400);
      expect(invoke).not.toHaveBeenCalled();
      await post(path, { ...body, unexpectedField: true }).expect(400);
      expect(invoke).not.toHaveBeenCalled();
    }
  });

  it.each(routeCases)(
    'delegates $name to the authenticated tenant and actor',
    async ({ path, body, invoke }) => {
      invoke.mockResolvedValue({ id: 'result' });
      const response = await post(path, body).expect(201);
      expect(response.body).toEqual({ id: 'result' });
      expect(invoke).toHaveBeenCalledTimes(1);
      const [dto, organizationId, actor] = invoke.mock.calls[0];
      expect(dto).toEqual(body);
      expect(organizationId).toBe('org-a');
      expect(actor).toEqual(
        expect.objectContaining({
          userId: 'user-a',
          organizationId: 'org-a',
          role: OrgRole.OWNER,
        }),
      );
    },
  );

  it.each(routeCases)(
    'rejects malformed $name payloads before any service call',
    async ({ path, invalid, invoke }) => {
      await post(path, invalid).expect(400);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid expense choice before any service call', async () => {
    const periodBody = routeCases[0].body;
    const groupBody = routeCases[1].body;
    for (const bad of [
      { expenseEnabled: 'true' },
      { expenseEnabled: 1 },
      { selectedExpenseDate: '2026-02-30' },
      { selectedExpenseDate: '2026-01-31T00:00:00Z' },
      { selectedExpenseDate: 20260131 },
    ]) {
      await post('/api/payroll/periods', { ...periodBody, ...bad }).expect(400);
      await post('/api/payroll/groups', { ...groupBody, ...bad }).expect(400);
      expect(periods.create).not.toHaveBeenCalled();
      expect(groups.create).not.toHaveBeenCalled();
    }
  });

  it('lists obligations for the authenticated tenant only', async () => {
    const rows = [
      {
        id: 'obligation-a',
        employeeId: 'emp-a',
        kind: 'FIXED_PERIOD',
        status: 'PENDING',
        version: 2,
        periodAmount: '1500000',
        expenseEnabled: true,
        selectedExpenseDate: '2026-01-31T00:00:00.000Z',
        installments: [
          {
            id: 'installment-a',
            outflowId: 'outflow-a',
            outflow: { id: 'outflow-a', amount: '100', method: 'CASH' },
          },
        ],
        shiftMemberships: [],
      },
    ];
    prisma.payrollObligation.findMany.mockResolvedValue(rows);
    const response = await get(
      '/api/payroll/obligations?employeeId=emp-a',
    ).expect(200);
    // Every field the route returned before is still returned unchanged; the
    // paid/balance/completion numbers are added by the server, never the client.
    expect(response.body).toEqual(
      rows.map((row) => ({
        ...row,
        summary: {
          total: '1500000.00',
          paid: '100.00',
          balance: '1499900.00',
          status: 'pending',
        },
      })),
    );
    expect(prisma.payrollObligation.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a', employeeId: 'emp-a' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: obligationSelect,
    });

    await get('/api/payroll/obligations').expect(200);
    expect(prisma.payrollObligation.findMany).toHaveBeenLastCalledWith({
      where: { organizationId: 'org-a' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: obligationSelect,
    });
  });

  it('rejects unknown obligation filters and never echoes another tenant id', async () => {
    await get('/api/payroll/obligations?organizationId=org-b').expect(400);
    await get('/api/payroll/obligations?employeeId=emp-a&tenant=org-b').expect(
      400,
    );
    expect(prisma.payrollObligation.findMany).not.toHaveBeenCalled();
  });

  it('exposes no payroll expense route', async () => {
    await post('/api/payroll/expenses', {}).expect(404);
  });
});

describe('payroll module wiring', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PayrollModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
  });

  it('registers the payroll controller and transaction services', () => {
    expect(payrollControllerClass()).toBeDefined();
    const providers = (
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PayrollModule) as unknown[]
    ).filter((provider) => typeof provider === 'function');
    for (const service of [
      PayrollPeriodsService,
      PayrollGroupsService,
      PayrollPeriodInstallmentsService,
      PayrollGroupInstallmentsService,
      PayrollPeriodInstallmentCorrectionService,
      PayrollObligationsService,
    ]) {
      expect(providers).toContain(service);
      expect(moduleRef.get(service)).toBeInstanceOf(service);
    }
  });

  it('keeps the payroll expense foundation unwired', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      PayrollModule,
    ) as unknown[];
    expect(providers).not.toContain(PayrollExpenseCategoryService);
    expect(() => moduleRef.get(PayrollExpenseCategoryService)).toThrow();
  });
});
