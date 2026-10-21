import 'reflect-metadata';
import {
  ForbiddenException,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { InventoryLoanStatus, OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CounterpartyType } from './dto/create-loan.dto';
import { CreateInventoryLoanDto } from './dto/create-inventory-loan.dto';
import {
  InventoryLoanOperationDto,
  InventoryLoanTerminalDto,
} from './dto/inventory-loan-operation.dto';
import {
  InventoryLoanHistoryQueryDto,
  QueryInventoryLoansDto,
} from './dto/query-inventory-loans.dto';
import { InventoryLoansController } from './inventory-loans.controller';
import type { InventoryLoansService } from './inventory-loans.service';

const id = '00000000-0000-4000-8000-000000000001';
const actor: RequestUser = {
  userId: '00000000-0000-4000-8000-000000000002',
  organizationId: '00000000-0000-4000-8000-000000000003',
  email: 'operator@example.invalid',
  role: OrgRole.ADMIN,
  tokenVersion: 1,
  isSuperAdmin: false,
};
const create = {
  requestKey: ' create-key ',
  counterpartyType: CounterpartyType.CUSTOMER,
  counterpartyId: id,
  items: [{ productId: id, quantity: 2 }],
};
const operation = {
  requestKey: ' operation-key ',
  items: [{ itemId: id, quantity: 1 }],
};
const terminal = { requestKey: ' terminal-key ' };
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});
function validate<T>(
  value: unknown,
  metatype: new () => T,
  type: 'body' | 'query' = 'body',
): Promise<T> {
  return pipe.transform(value, { type, metatype });
}
type ServiceMethod =
  | 'create'
  | 'deliver'
  | 'returnItems'
  | 'cancel'
  | 'close'
  | 'findAll'
  | 'findOne'
  | 'history';
function serviceMock<K extends ServiceMethod>(method: K) {
  // Opaque sentinels test forwarding, not the immutable projection schema.
  const result = { sentinel: method };
  return jest
    .fn<
      ReturnType<InventoryLoansService[K]>,
      Parameters<InventoryLoansService[K]>
    >()
    .mockImplementation(
      () => Promise.resolve(result) as ReturnType<InventoryLoansService[K]>,
    );
}
const service: jest.Mocked<Pick<InventoryLoansService, ServiceMethod>> = {
  create: serviceMock('create'),
  deliver: serviceMock('deliver'),
  returnItems: serviceMock('returnItems'),
  cancel: serviceMock('cancel'),
  close: serviceMock('close'),
  findAll: serviceMock('findAll'),
  findOne: serviceMock('findOne'),
  history: serviceMock('history'),
};
const controller = new InventoryLoansController(
  service as unknown as InventoryLoansService,
);
const methods = [
  'create',
  'deliver',
  'returnItems',
  'cancel',
  'close',
  'findAll',
  'findOne',
  'getHistory',
] as const;

// Direct calls/reflection do not prove runtime guards, HTTP CSRF, or tenancy.
// Forwarding expectations intentionally fail against the Stage A scaffold.
describe('Prepared inventory loan forwarding', () => {
  beforeEach(() => jest.clearAllMocks());
  it.each(methods)(
    'forwards %s arguments and preserves service results',
    async (method) => {
      const body = await validate(create, CreateInventoryLoanDto);
      const items = await validate(operation, InventoryLoanOperationDto);
      const end = await validate(terminal, InventoryLoanTerminalDto);
      const query = await validate(
        { page: '2', limit: '10', status: 'OPEN' },
        QueryInventoryLoansDto,
        'query',
      );
      const history = await validate(
        { page: '2' },
        InventoryLoanHistoryQueryDto,
        'query',
      );
      expect(body.requestKey).toBe('create-key');
      expect(items.requestKey).toBe('operation-key');
      expect(end.requestKey).toBe('terminal-key');
      expect(query.page).toBe(2);
      const cases = {
        create: {
          call: () => controller.create(body, actor),
          mock: service.create,
          args: [body, actor],
        },
        deliver: {
          call: () => controller.deliver(id, items, actor),
          mock: service.deliver,
          args: [id, items, actor],
        },
        returnItems: {
          call: () => controller.returnItems(id, items, actor),
          mock: service.returnItems,
          args: [id, items, actor],
        },
        cancel: {
          call: () => controller.cancel(id, end, actor),
          mock: service.cancel,
          args: [id, end, actor],
        },
        close: {
          call: () => controller.close(id, end, actor),
          mock: service.close,
          args: [id, end, actor],
        },
        findAll: {
          call: () => controller.findAll(query, actor),
          mock: service.findAll,
          args: [query, actor.organizationId],
        },
        findOne: {
          call: () => controller.findOne(id, actor),
          mock: service.findOne,
          args: [id, actor.organizationId],
        },
        getHistory: {
          call: () => controller.getHistory(id, history, actor),
          mock: service.history,
          args: [id, history, actor.organizationId],
        },
      };
      const entry = cases[method];
      const result = await entry.call();
      expect(entry.mock).toHaveBeenCalledTimes(1);
      expect(entry.mock).toHaveBeenCalledWith(...entry.args);
      expect(result).toBe(await entry.mock.mock.results[0].value);
    },
  );
  it.each(['findAll', 'findOne', 'getHistory'] as const)(
    'rejects missing scope on %s before service access',
    async (method) => {
      const unscoped: RequestUser = {
        ...actor,
        organizationId: undefined,
        role: 'SUPER_ADMIN',
        isSuperAdmin: true,
      };
      const calls = {
        findAll: () => controller.findAll({}, unscoped),
        findOne: () => controller.findOne(id, unscoped),
        getHistory: () => controller.getHistory(id, {}, unscoped),
      };
      await expect(calls[method]()).rejects.toThrow(
        new ForbiddenException(
          'Organization scope required. Please select an organization or use an admin endpoint.',
        ),
      );
      for (const mock of Object.values(service))
        expect(mock).not.toHaveBeenCalled();
    },
  );
});

describe('Strict inventory loan DTOs', () => {
  it.each([
    'userId',
    'organizationId',
    'reason',
    'tax',
    'money',
    'tracksStock',
  ])('rejects unknown body field %s', async (field) => {
    for (const [value, metatype] of [
      [create, CreateInventoryLoanDto],
      [operation, InventoryLoanOperationDto],
      [terminal, InventoryLoanTerminalDto],
    ] as const) {
      await expect(
        pipe.transform({ ...value, [field]: id }, { type: 'body', metatype }),
      ).rejects.toThrow();
    }
  });
  it.each(['1', 0, -1, 1.5, null, 2147483648])(
    'rejects raw invalid quantity %j',
    async (quantity) => {
      await expect(
        validate(
          { ...create, items: [{ productId: id, quantity }] },
          CreateInventoryLoanDto,
        ),
      ).rejects.toThrow();
      await expect(
        validate(
          { ...operation, items: [{ itemId: id, quantity }] },
          InventoryLoanOperationDto,
        ),
      ).rejects.toThrow();
    },
  );
  it.each(Object.values(InventoryLoanStatus))(
    'accepts status %s',
    async (status) => {
      await expect(
        validate({ status }, QueryInventoryLoansDto, 'query'),
      ).resolves.toMatchObject({ status });
    },
  );
  it.each(Object.values(CounterpartyType))(
    'accepts counterparty %s',
    async (counterpartyType) => {
      await expect(
        validate(
          { counterpartyType, counterpartyId: id },
          QueryInventoryLoansDto,
          'query',
        ),
      ).resolves.toMatchObject({ counterpartyType, counterpartyId: id });
    },
  );
  it.each([
    { status: 'OTHER' },
    { status: null },
    { status: true },
    { counterpartyType: 'OTHER' },
    { counterpartyType: null },
    { counterpartyId: 'invalid' },
    { counterpartyId: null },
    { page: 0 },
    { page: 1.5 },
    { page: 1000001 },
    { limit: 0 },
    { limit: 101 },
    { limit: 'invalid' },
    { organizationId: id },
    { userId: id },
    { unexpected: true },
  ])('rejects invalid list query %j', async (query) => {
    await expect(
      validate(query, QueryInventoryLoansDto, 'query'),
    ).rejects.toThrow();
  });
  it('retains optional pagination and leaves paired filters to the service', async () => {
    await expect(
      validate(
        { page: null, limit: null },
        InventoryLoanHistoryQueryDto,
        'query',
      ),
    ).resolves.toMatchObject({ page: null, limit: null });
    await expect(
      validate(
        { counterpartyType: 'CUSTOMER' },
        QueryInventoryLoansDto,
        'query',
      ),
    ).resolves.toMatchObject({ counterpartyType: 'CUSTOMER' });
  });
  it.each([
    { status: 'OPEN' },
    { counterpartyId: id },
    { organizationId: id },
    { page: 0 },
    { limit: 101 },
  ])('rejects unsupported history query %j', async (query) => {
    await expect(
      validate(query, InventoryLoanHistoryQueryDto, 'query'),
    ).rejects.toThrow();
  });
});

describe('Prepared inventory loan metadata', () => {
  it('uses the existing authentication and organization adapters', () => {
    expect(Reflect.getMetadata('path', InventoryLoansController)).toBe(
      'inventory-loans',
    );
    expect(Reflect.getMetadata('__guards__', InventoryLoansController)).toEqual(
      [JwtAuthGuard, RolesGuard, OrganizationRequiredGuard],
    );
    expect(
      Reflect.getMetadata('__interceptors__', InventoryLoansController),
    ).toEqual([AdminOrganizationInterceptor]);
  });
  it.each(methods)('restricts %s metadata to OWNER and ADMIN', (method) => {
    expect(
      Reflect.getMetadata('roles', InventoryLoansController.prototype[method]),
    ).toEqual([OrgRole.OWNER, OrgRole.ADMIN]);
  });
  it.each([
    'deliver',
    'returnItems',
    'cancel',
    'close',
    'findOne',
    'getHistory',
  ] as const)('attaches a UUID pipe to %s ID', (method) => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      InventoryLoansController,
      method,
    ) as Record<string, { data?: string; pipes: unknown[] }>;
    expect(
      Object.values(args)
        .filter((arg) => arg.data === 'id')
        .map((arg) => arg.pipes),
    ).toEqual([[ParseUUIDPipe]]);
  });
});
