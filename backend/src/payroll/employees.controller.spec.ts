import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { EmployeeShiftKind, OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeeShiftsService } from './employee-shifts.service';
import { QueryEmployeesHttpDto } from './dto/query-employees.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});
const user: RequestUser = {
  userId: 'user-a',
  email: 'a@example.com',
  organizationId: 'org-a',
  role: OrgRole.ADMIN,
  tokenVersion: 0,
  isSuperAdmin: false,
};
const routes = [
  ['create', '', 1],
  ['findAll', '', 0],
  ['createShift', 'shifts', 1],
  ['findShift', 'shifts/:shiftId', 0],
  ['findShifts', ':id/shifts', 0],
  ['findOne', ':id', 0],
  ['update', ':id', 4],
  ['setActive', ':id/active', 4],
] as const;

async function validateBody(name: string, index: number, body: unknown) {
  const types = Reflect.getMetadata(
    'design:paramtypes',
    EmployeesController.prototype,
    name,
  ) as Array<new () => object>;
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    EmployeesController,
    name,
  ) as Record<
    string,
    {
      index: number;
      pipes: ValidationPipe[];
      factory?: (data: unknown, context: ExecutionContext) => unknown;
    }
  >;
  const entry = Object.entries(args).find(([, arg]) => arg.index === index);
  if (!entry) throw new Error('Body parameter missing');
  const [key, parameter] = entry;
  const type = key.includes('__customRouteArgs__') ? 'custom' : 'body';
  const metadata = { type, metatype: types[index] } as const;
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  } as unknown as ExecutionContext;
  const extracted = parameter.factory
    ? parameter.factory(undefined, context)
    : body;
  let value: unknown = await pipe.transform(extracted, metadata);
  for (const localPipe of parameter.pipes) {
    value = await localPipe.transform(value, metadata);
  }
  return value;
}

describe('employee controller boundary', () => {
  const employees = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    setActive: jest.fn(),
  };
  const shifts = { create: jest.fn(), findAll: jest.fn(), findOne: jest.fn() };
  const controller = new EmployeesController(
    employees as unknown as EmployeesService,
    shifts as unknown as EmployeeShiftsService,
  );
  beforeEach(() => jest.clearAllMocks());

  it.each(routes)(
    '%s has the route and guards with owner/admin authorization',
    (name, path, method) => {
      const handler = EmployeesController.prototype[name];
      expect(Reflect.getMetadata(PATH_METADATA, EmployeesController)).toBe(
        'employees',
      );
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path || '/');
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
      expect(Reflect.getMetadata(GUARDS_METADATA, EmployeesController)).toEqual(
        [JwtAuthGuard, RolesGuard, OrganizationRequiredGuard],
      );
      expect(
        new Reflector().getAllAndOverride(ROLES_KEY, [
          handler,
          EmployeesController,
        ]),
      ).toEqual([OrgRole.OWNER, OrgRole.ADMIN]);
      const guard = new RolesGuard(new Reflector());
      const context = (role: OrgRole) =>
        ({
          getHandler: () => handler,
          getClass: () => EmployeesController,
          switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
        }) as unknown as ExecutionContext;
      expect(guard.canActivate(context(OrgRole.OWNER))).toBe(true);
      expect(guard.canActivate(context(OrgRole.ADMIN))).toBe(true);
      for (const role of [
        OrgRole.MEMBER,
        OrgRole.CASHIER,
        OrgRole.INVENTORY_USER,
      ])
        expect(() => guard.canActivate(context(role))).toThrow();
    },
  );

  it.each(routes)(
    '%s resolves its actor from the authenticated request',
    (name) => {
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        EmployeesController,
        name,
      ) as Record<
        string,
        {
          index: number;
          factory?: (data: unknown, context: ExecutionContext) => unknown;
        }
      >;
      const count = (
        Reflect.getMetadata(
          'design:paramtypes',
          EmployeesController.prototype,
          name,
        ) as unknown[]
      ).length;
      const custom = Object.values(args).filter(
        (arg) => arg.index === count - 1 && typeof arg.factory === 'function',
      );
      expect(custom).toHaveLength(1);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ user, body: { organizationId: 'org-b' } }),
        }),
      } as unknown as ExecutionContext;
      expect(custom[0].factory?.(undefined, context)).toBe(user);
    },
  );

  it('organization guard rejects missing tenant for ordinary users', () => {
    const guard = new OrganizationRequiredGuard();
    const context = (actor: RequestUser) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user: actor }) }),
      }) as unknown as ExecutionContext;
    expect(guard.canActivate(context(user))).toBe(true);
    expect(() =>
      guard.canActivate(context({ ...user, organizationId: undefined })),
    ).toThrow();
  });

  it('forwards only the authenticated tenant and actor on every service operation', () => {
    const employee = { name: 'Ana' };
    const shift = {
      employeeId: 'emp',
      date: '2026-01-02',
      kind: EmployeeShiftKind.FULL_DAY,
      amount: 10,
    };
    controller.create(employee, user);
    controller.findAll({ active: false }, user);
    controller.findOne('emp', user);
    controller.update('emp', employee, user);
    controller.setActive('emp', { active: false }, user);
    controller.createShift(shift, user);
    controller.findShifts('emp', user);
    controller.findShift('shift', user);
    expect(employees.create).toHaveBeenCalledWith(employee, 'org-a', user);
    expect(employees.findAll).toHaveBeenCalledWith(
      { active: false },
      'org-a',
      user,
    );
    expect(employees.findOne).toHaveBeenCalledWith('emp', 'org-a', user);
    expect(employees.update).toHaveBeenCalledWith(
      'emp',
      employee,
      'org-a',
      user,
    );
    expect(employees.setActive).toHaveBeenCalledWith(
      'emp',
      false,
      'org-a',
      user,
    );
    expect(shifts.create).toHaveBeenCalledWith(shift, 'org-a', user);
    expect(shifts.findAll).toHaveBeenCalledWith('emp', 'org-a', user);
    expect(shifts.findOne).toHaveBeenCalledWith('shift', 'org-a', user);
  });

  it.each([
    ['true', true],
    ['false', false],
    [undefined, undefined],
  ])('converts query active %s', async (active, expected) => {
    const result = await pipe.transform(
      active === undefined ? {} : { active },
      { type: 'query', metatype: QueryEmployeesHttpDto },
    );
    expect(result.active).toBe(expected);
  });
  it.each(['', '0', '1', 'FALSE', 'yes', ['true', 'false'], null])(
    'rejects invalid query active %s',
    async (active) => {
      await expect(
        pipe.transform(
          { active },
          { type: 'query', metatype: QueryEmployeesHttpDto },
        ),
      ).rejects.toThrow();
    },
  );
  it('rejects unknown query keys', async () => {
    await expect(
      pipe.transform(
        { organizationId: 'org-b' },
        { type: 'query', metatype: QueryEmployeesHttpDto },
      ),
    ).rejects.toThrow();
  });

  it.each([
    ['create', 0, { name: '' }],
    ['create', 0, { name: 'Ana', organizationId: 'org-b' }],
    ['update', 1, { name: '' }],
    ['update', 1, { organizationId: 'org-b' }],
    ['setActive', 1, { active: 'false' }],
    ['setActive', 1, { active: false, organizationId: 'org-b' }],
    [
      'createShift',
      0,
      { employeeId: 'emp', date: 'invalid', kind: 'FULL_DAY', amount: 10 },
    ],
    [
      'createShift',
      0,
      {
        employeeId: 'emp',
        date: '2026-01-02',
        kind: 'FULL_DAY',
        amount: 10,
        organizationId: 'org-b',
      },
    ],
  ] as const)('rejects invalid %s body', async (name, index, body) => {
    await expect(validateBody(name, index, body)).rejects.toThrow();
  });

  it.each([
    ['create', 0, { name: 123 }],
    ...[
      'identification',
      'phone',
      'email',
      'address',
      'jobTitle',
      'startDate',
      'remunerationModality',
    ].map((field) => ['create', 0, { name: 'Ana', [field]: 123 }] as const),
    ['create', 0, { name: 'Ana', referenceAmount: true }],
    ['update', 1, { name: 123 }],
    ...[
      'identification',
      'phone',
      'email',
      'address',
      'jobTitle',
      'startDate',
      'remunerationModality',
    ].map((field) => ['update', 1, { [field]: 123 }] as const),
    ['update', 1, { referenceAmount: '12' }],
    ['setActive', 1, { active: 1 }],
    ...['employeeId', 'date', 'kind', 'observation'].map(
      (field) =>
        [
          'createShift',
          0,
          {
            employeeId: 'emp',
            date: '2026-01-02',
            kind: 'FULL_DAY',
            amount: 10,
            [field]: 123,
          },
        ] as const,
    ),
    [
      'createShift',
      0,
      { employeeId: 'emp', date: '2026-01-02', kind: 'FULL_DAY', amount: true },
    ],
  ] as const)('rejects original JSON type on %s', async (name, index, body) => {
    await expect(validateBody(name, index, body)).rejects.toThrow();
  });

  it.each([
    [
      'create',
      0,
      {
        name: 'Ana',
        identification: null,
        phone: null,
        email: null,
        address: null,
        jobTitle: null,
        startDate: null,
        remunerationModality: null,
        referenceAmount: null,
      },
    ],
    [
      'create',
      0,
      {
        name: 'Ana',
        identification: '123',
        phone: '123',
        email: 'ana@example.com',
        address: 'Calle 1',
        jobTitle: 'Vendedora',
        startDate: '2026-01-02',
        remunerationModality: 'BY_DAY',
        referenceAmount: 12.5,
      },
    ],
    ['update', 1, { phone: null, referenceAmount: 0 }],
    ['setActive', 1, { active: false }],
    [
      'createShift',
      0,
      {
        employeeId: 'emp',
        date: '2026-01-02',
        kind: 'FULL_DAY',
        amount: 10,
        observation: null,
      },
    ],
  ] as const)(
    'accepts valid original JSON body on %s',
    async (name, index, body) => {
      await expect(validateBody(name, index, body)).resolves.toMatchObject(
        body,
      );
    },
  );
});
