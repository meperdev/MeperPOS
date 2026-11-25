import {
  ForbiddenException,
  NotFoundException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SalesController } from './sales.controller';
import type { RequestUser } from '../common/interfaces/request-user.interface';

describe('SalesController', () => {
  const salesServiceMock = {
    create: jest.fn(),
    findAll: jest.fn(),
    findBySaleNumber: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    forceClose: jest.fn(),
    generateReceipt: jest.fn(),
  };

  const locationsServiceMock = {
    findAccessible: jest.fn(),
  };

  const cashierUser: RequestUser = {
    userId: 'cashier-1',
    email: 'cashier@example.com',
    organizationId: 'org-1',
    role: OrgRole.CASHIER,
    tokenVersion: 1,
    isSuperAdmin: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createContext = (
    handler: (...args: unknown[]) => unknown,
    role: OrgRole,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => SalesController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    }) as unknown as ExecutionContext;

  it('allows CASHIER to create sales', () => {
    const requiredRoles = Reflect.getMetadata(
      ROLES_KEY,
      SalesController.prototype.create,
    );
    expect(requiredRoles).toContain(OrgRole.CASHIER);
  });

  it('allows CASHIER to list sales', () => {
    const requiredRoles = Reflect.getMetadata(
      ROLES_KEY,
      SalesController.prototype.findAll,
    );
    expect(requiredRoles).toContain(OrgRole.CASHIER);
  });

  it('allows CASHIER to find a sale by number', () => {
    const requiredRoles = Reflect.getMetadata(
      ROLES_KEY,
      SalesController.prototype.findBySaleNumber,
    );
    expect(requiredRoles).toContain(OrgRole.CASHIER);
  });

  it('allows CASHIER to get a sale by id', () => {
    const requiredRoles = Reflect.getMetadata(
      ROLES_KEY,
      SalesController.prototype.findOne,
    );
    expect(requiredRoles).toContain(OrgRole.CASHIER);
  });

  it('allows CASHIER to generate a receipt', () => {
    const requiredRoles = Reflect.getMetadata(
      ROLES_KEY,
      SalesController.prototype.generateReceipt,
    );
    expect(requiredRoles).toContain(OrgRole.CASHIER);
  });

  it('denies CASHIER access to update sales', () => {
    const controller = new SalesController(
      salesServiceMock as never,
      locationsServiceMock as never,
    );
    const guard = new RolesGuard(new Reflector());

    expect(() =>
      guard.canActivate(createContext(controller.update, OrgRole.CASHIER)),
    ).toThrow(ForbiddenException);
  });

  it('denies CASHIER access to force-close sales', () => {
    const controller = new SalesController(
      salesServiceMock as never,
      locationsServiceMock as never,
    );
    const guard = new RolesGuard(new Reflector());

    expect(() =>
      guard.canActivate(createContext(controller.forceClose, OrgRole.CASHIER)),
    ).toThrow(ForbiddenException);
  });

  it('delegates sale creation with cashier identity and organization', async () => {
    const controller = new SalesController(
      salesServiceMock as never,
      locationsServiceMock as never,
    );
    const createSaleDto = {
      customerId: 'customer-1',
      items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
      discountAmount: 0,
      payments: [{ method: 'CASH' as const, amount: 1000 }],
    };
    const expected = { id: 'sale-1', saleNumber: 42 };

    salesServiceMock.create.mockResolvedValue(expected);

    const result = await controller.create(createSaleDto, cashierUser);

    expect(result).toEqual(expected);
    // The role must reach the service: SalesService needs it to authorize a
    // price override, so it is threaded as the acting principal.
    expect(salesServiceMock.create).toHaveBeenCalledWith(
      createSaleDto,
      'cashier-1',
      'org-1',
      cashierUser,
    );
  });

  it('authorizes the optional site filter through the shared site-access rule', async () => {
    const controller = new SalesController(
      salesServiceMock as never,
      locationsServiceMock as never,
    );
    locationsServiceMock.findAccessible.mockResolvedValue({
      id: 'site-1',
      name: 'Sucursal Norte',
      type: 'STORE',
      isDefault: false,
      address: null,
      phone: null,
    });
    salesServiceMock.findAll.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
    });

    await controller.findAll(cashierUser, { locationId: 'site-1' });

    expect(locationsServiceMock.findAccessible).toHaveBeenCalledWith(
      cashierUser,
      'site-1',
    );
    expect(salesServiceMock.findAll).toHaveBeenCalledWith(
      'org-1',
      1,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      cashierUser,
      'site-1',
    );
  });

  it('refuses a site the caller cannot read without listing any sales', async () => {
    const controller = new SalesController(
      salesServiceMock as never,
      locationsServiceMock as never,
    );
    locationsServiceMock.findAccessible.mockRejectedValue(
      new NotFoundException('Location not found'),
    );

    await expect(
      controller.findAll(cashierUser, { locationId: 'foreign-site' }),
    ).rejects.toThrow('Location not found');
    expect(salesServiceMock.findAll).not.toHaveBeenCalled();
  });
});
