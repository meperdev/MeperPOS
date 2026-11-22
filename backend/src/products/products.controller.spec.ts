import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { ProductsController } from './products.controller';

describe('ProductsController — promotion write authorization', () => {
  const serviceMock = {
    create: jest.fn(),
    update: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    searchProducts: jest.fn(),
    quickSearch: jest.fn(),
    remove: jest.fn(),
    deactivate: jest.fn(),
    reactivate: jest.fn(),
    getLowStockProducts: jest.fn(),
    uploadImage: jest.fn(),
    uploadProductImage: jest.fn(),
  };

  const createContext = (
    handler: (...args: unknown[]) => unknown,
    role: OrgRole,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => ProductsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restricts product writes (create/update) to ADMIN and MEMBER', () => {
    const controller = new ProductsController(serviceMock as never);

    expect(Reflect.getMetadata(ROLES_KEY, controller.create)).toEqual([
      OrgRole.ADMIN,
      OrgRole.MEMBER,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.update)).toEqual([
      OrgRole.ADMIN,
      OrgRole.MEMBER,
    ]);
  });

  it('denies CASHIER a promotion write through PUT /products/:id (403)', () => {
    const controller = new ProductsController(serviceMock as never);
    const guard = new RolesGuard(new Reflector());

    expect(() =>
      guard.canActivate(createContext(controller.update, OrgRole.CASHIER)),
    ).toThrow(ForbiddenException);
    expect(serviceMock.update).not.toHaveBeenCalled();
  });

  it('allows MEMBER through RolesGuard on product update', () => {
    const controller = new ProductsController(serviceMock as never);
    const guard = new RolesGuard(new Reflector());

    expect(
      guard.canActivate(createContext(controller.update, OrgRole.MEMBER)),
    ).toBe(true);
  });
});

describe('ProductsController — findAll additive params (D5)', () => {
  const serviceMock = { findAll: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards the optional service filter without changing organization scope', () => {
    const controller = new ProductsController(serviceMock as never);
    Reflect.apply(controller.findAll, controller, [{ organizationId: 'org-1' }, 2, 6, undefined, undefined, 'active', undefined, undefined, 'SERVICE']);
    expect(serviceMock.findAll).toHaveBeenCalledWith('org-1', 2, 6, undefined, undefined, 'active', false, undefined, 'SERVICE', undefined, false);
  });

  it('preserves omitted vs empty IDs and forwards availability', () => {
    const controller = new ProductsController(serviceMock as never);
    const id = '00000000-0000-4000-8000-000000000001';
    controller.findAll({ organizationId: 'org-1' } as never, 2, 3, 'repair', undefined, 'active', undefined, 'name', undefined, `${id},${id}`, true);
    expect(serviceMock.findAll).toHaveBeenLastCalledWith('org-1', 2, 3, 'repair', undefined, 'active', false, 'name', undefined, [id, id], true);
    controller.findAll({ organizationId: 'org-1' } as never, 1, 3, undefined, undefined, 'active', undefined, undefined, undefined, '');
    expect(serviceMock.findAll.mock.calls[1][9]).toEqual([]);
    expect(() => Reflect.apply(controller.findAll, controller, [{ organizationId: 'org-1' }, 1, 3, undefined, undefined, 'active', undefined, undefined, undefined, ['bad']])).toThrow();
  });

  it('rejects malformed availability at the query boundary and accepts omission', async () => {
    const metadata = Reflect.getMetadata('__routeArguments__', ProductsController, 'findAll');
    const query: { data?: string; pipes: { transform: (value: unknown, metadata: unknown) => unknown }[] }[] = Object.values(metadata);
    const pipe = query.find((entry) => entry.data === 'available')?.pipes[0];
    await expect(Promise.resolve(pipe!.transform('yes', { type: 'query' }))).rejects.toThrow();
    await expect(Promise.resolve(pipe!.transform('true', { type: 'query' }))).resolves.toBe(true);
    await expect(Promise.resolve(pipe!.transform(undefined, { type: 'query' }))).resolves.toBeUndefined();
  });

  it('validates type at the query boundary and accepts omission', async () => {
    const metadata = Reflect.getMetadata('__routeArguments__', ProductsController, 'findAll');
    const query: { data?: string; pipes: { transform: (value: unknown, metadata: unknown) => unknown }[] }[] = Object.values(metadata);
    const pipe = query.find((entry) => entry.data === 'type')?.pipes[0];
    expect(pipe).toBeDefined();
    await expect(Promise.resolve(pipe!.transform('OTHER', { type: 'query' }))).rejects.toThrow();
    await expect(Promise.resolve(pipe!.transform(undefined, { type: 'query' }))).resolves.toBeUndefined();
    await expect(Promise.resolve(pipe!.transform('SERVICE', { type: 'query' }))).resolves.toBe('SERVICE');
  });

  it('forwards lowStock and orderBy query params to the service', () => {
    const controller = new ProductsController(serviceMock as never);
    const user = { userId: 'u1', organizationId: 'org-1', role: OrgRole.ADMIN };

    controller.findAll(
      user as never,
      1,
      10,
      undefined,
      undefined,
      'active',
      'true',
      'name',
    );

    expect(serviceMock.findAll).toHaveBeenCalledWith(
      'org-1',
      1,
      10,
      undefined,
      undefined,
      'active',
      true,
      'name',
      undefined,
      undefined,
      false,
    );
  });

  it('treats any lowStock value other than "true" as absent', () => {
    const controller = new ProductsController(serviceMock as never);
    const user = { userId: 'u1', organizationId: 'org-1', role: OrgRole.ADMIN };

    controller.findAll(
      user as never,
      1,
      10,
      undefined,
      undefined,
      'active',
      'false',
      undefined,
    );

    expect(serviceMock.findAll).toHaveBeenCalledWith(
      'org-1',
      1,
      10,
      undefined,
      undefined,
      'active',
      false,
      undefined,
      undefined,
      undefined,
      false,
    );
  });
});

describe('ProductsController — CASHIER search access (registered contract)', () => {
  const serviceMock = {
    searchProducts: jest.fn(),
    quickSearch: jest.fn(),
  };

  const createContext = (
    handler: (...args: unknown[]) => unknown,
    role: OrgRole,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => ProductsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks search with roles [ADMIN, MEMBER, CASHIER] on the registered controller', () => {
    const controller = new ProductsController(serviceMock as never);

    expect(Reflect.getMetadata(ROLES_KEY, controller.search)).toEqual([
      OrgRole.ADMIN,
      OrgRole.MEMBER,
      OrgRole.CASHIER,
    ]);
  });

  it('marks quick-search with roles [ADMIN, MEMBER, CASHIER] on the registered controller', () => {
    const controller = new ProductsController(serviceMock as never);

    expect(Reflect.getMetadata(ROLES_KEY, controller.quickSearch)).toEqual([
      OrgRole.ADMIN,
      OrgRole.MEMBER,
      OrgRole.CASHIER,
    ]);
  });

  it('lets a CASHIER through RolesGuard on search', () => {
    const controller = new ProductsController(serviceMock as never);
    const guard = new RolesGuard(new Reflector());

    expect(guard.canActivate(createContext(controller.search, OrgRole.CASHIER))).toBe(
      true,
    );
  });

  it('lets a CASHIER through RolesGuard on quick-search', () => {
    const controller = new ProductsController(serviceMock as never);
    const guard = new RolesGuard(new Reflector());

    expect(
      guard.canActivate(createContext(controller.quickSearch, OrgRole.CASHIER)),
    ).toBe(true);
  });

  it('denies INVENTORY_USER through RolesGuard on quick-search (403)', () => {
    const controller = new ProductsController(serviceMock as never);
    const guard = new RolesGuard(new Reflector());

    expect(() =>
      guard.canActivate(
        createContext(controller.quickSearch, OrgRole.INVENTORY_USER),
      ),
    ).toThrow(ForbiddenException);
  });

  it('returns the service result unwrapped for quick-search (flat, no success/data)', async () => {
    const controller = new ProductsController(serviceMock as never);
    const user = {
      userId: 'u1',
      organizationId: 'org-1',
      role: OrgRole.CASHIER,
    };
    const enriched = {
      id: 'prod-1',
      name: 'Promo Donut',
      promotionType: 'PERCENTAGE',
      promotionValue: 20,
      effectiveSalePrice: 8000,
    };
    serviceMock.quickSearch.mockResolvedValue(enriched);

    const result = await controller.quickSearch(user as never, '7701234567890');

    expect(serviceMock.quickSearch).toHaveBeenCalledWith(
      '7701234567890',
      'org-1',
    );
    expect(result).toEqual(enriched);
    expect((result as Record<string, unknown>).success).toBeUndefined();
    expect((result as Record<string, unknown>).data).toBeUndefined();
  });

  it('returns the service array unwrapped for search (flat, no success/data)', async () => {
    const controller = new ProductsController(serviceMock as never);
    const user = {
      userId: 'u1',
      organizationId: 'org-1',
      role: OrgRole.CASHIER,
    };
    const enriched = [
      {
        id: 'prod-1',
        name: 'Promo Donut',
        promotionType: 'PERCENTAGE',
        promotionValue: 20,
        effectiveSalePrice: 8000,
      },
    ];
    serviceMock.searchProducts.mockResolvedValue(enriched);

    const result = await controller.search(user as never, 'donut', 20);

    expect(serviceMock.searchProducts).toHaveBeenCalledWith(
      'donut',
      20,
      'org-1',
    );
    expect(result).toEqual(enriched);
    expect(Array.isArray(result)).toBe(true);
    expect((result as Record<string, unknown>).success).toBeUndefined();
  });
});
