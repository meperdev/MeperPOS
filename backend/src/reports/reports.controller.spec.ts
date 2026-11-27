import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { ReportsController } from './reports.controller';
import type { RequestUser } from '../common/interfaces/request-user.interface';

type DashboardResponse = {
  appliedRange: { timezone: string };
  comparisonRange: unknown;
};

const mockUser: RequestUser = {
  userId: 'user-1',
  email: 'test@example.com',
  organizationId: 'org-1',
  role: OrgRole.ADMIN,
  tokenVersion: 1,
  isSuperAdmin: false,
};

describe('ReportsController', () => {
  const reportsServiceMock = {
    getDashboardKPIs: jest.fn(),
    getUserPerformance: jest.fn(),
    getFinancialOverview: jest.fn(),
    getCashFlow: jest.fn(),
    getInventorySnapshot: jest.fn(),
  };
  // Every site-scoped route resolves its site through this one rule (404 for a
  // site the caller cannot read); the requests here carry no site.
  const locationsServiceMock = { findAccessible: jest.fn() };

  const createController = () =>
    new ReportsController(
      reportsServiceMock as never,
      locationsServiceMock as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createContext = (
    handler: (...args: unknown[]) => unknown,
    role: OrgRole,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => ReportsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    }) as unknown as ExecutionContext;

  it('restricts reports analytics to admins only', () => {
    const requiredRoles = Reflect.getMetadata(ROLES_KEY, ReportsController);

    expect(requiredRoles).toEqual([OrgRole.ADMIN]);
  });

  it('denies analytics access to unauthorized business roles', () => {
    const controller = createController();
    const guard = new RolesGuard(new Reflector());

    expect(() =>
      guard.canActivate(
        createContext(controller.getUserPerformance, OrgRole.CASHIER),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows SuperAdmin without an organization scope', () => {
    const guard = new OrganizationRequiredGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            userId: 'super-1',
            email: 'super@example.com',
            organizationId: undefined,
            role: 'SUPER_ADMIN',
            tokenVersion: 1,
            isSuperAdmin: true,
          } as RequestUser,
        }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => ReportsController,
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('forwards date filters to service and returns metadata-bearing response', async () => {
    const controller = createController();
    reportsServiceMock.getDashboardKPIs.mockResolvedValue({
      totalSales: 0,
      appliedRange: {
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        timezone: 'America/Bogota',
      },
      comparisonRange: {
        startDate: '2026-01-30',
        endDate: '2026-02-28',
        timezone: 'America/Bogota',
      },
    });

    const result = (await controller.getDashboard(
      mockUser,
      '2026-03-01',
      '2026-03-31',
    )) as DashboardResponse;

    expect(reportsServiceMock.getDashboardKPIs).toHaveBeenCalledWith(
      'org-1',
      '2026-03-01',
      '2026-03-31',
      undefined,
    );
    expect(result.appliedRange.timezone).toBe('America/Bogota');
    expect(result.comparisonRange).toBeDefined();
  });

  it('forwards organization scope to the financial endpoint', async () => {
    const controller = createController();
    reportsServiceMock.getFinancialOverview.mockResolvedValue({
      current: { netIncome: '0.00' },
    });

    await controller.getEconomic(mockUser, '2026-03-01', '2026-03-31');

    expect(reportsServiceMock.getFinancialOverview).toHaveBeenCalledWith(
      'org-1',
      '2026-03-01',
      '2026-03-31',
    );
  });

  it('forwards organization scope to cash and inventory contracts', async () => {
    const controller = createController();

    await controller.getCash(mockUser, '2026-03-01', '2026-03-31');
    await controller.getInventory(mockUser, '2026-03-01', '2026-03-31');

    expect(reportsServiceMock.getCashFlow).toHaveBeenCalledWith(
      'org-1',
      '2026-03-01',
      '2026-03-31',
    );
    expect(reportsServiceMock.getInventorySnapshot).toHaveBeenCalledWith(
      'org-1',
      '2026-03-01',
      '2026-03-31',
      undefined,
    );
  });

  it('parses compare and userIds before delegating user performance analytics', async () => {
    const controller = createController();
    reportsServiceMock.getUserPerformance.mockResolvedValue({
      data: [],
      appliedRange: {
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        timezone: 'America/Bogota',
      },
    });

    await controller.getUserPerformance(
      mockUser,
      '2026-03-01',
      '2026-03-31',
      'false',
      ' user-1, user-2 ,,user-1 ',
    );

    expect(reportsServiceMock.getUserPerformance).toHaveBeenCalledWith(
      'org-1',
      '2026-03-01',
      '2026-03-31',
      false,
      ['user-1', 'user-2'],
      undefined,
    );
  });
});
