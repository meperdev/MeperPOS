import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PlanLimitGuard } from './plan-limits.guard';
import type { PlanLimitService } from './plan-limits.service';

describe('PlanLimitGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const planLimitService = { checkLimit: jest.fn() };
  let guard: PlanLimitGuard;

  const createContext = (user?: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new PlanLimitGuard(
      reflector as unknown as Reflector,
      planLimitService as unknown as PlanLimitService,
    );
  });

  it('allows a route without a plan limit', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(
      guard.canActivate(createContext({ organizationId: 'org-1', role: 'ADMIN' })),
    ).resolves.toBe(true);
    expect(planLimitService.checkLimit).not.toHaveBeenCalled();
  });

  it('lets a SuperAdmin through without checking the limit', async () => {
    reflector.getAllAndOverride.mockReturnValue('users');

    await expect(
      guard.canActivate(createContext({ organizationId: 'org-1', isSuperAdmin: true })),
    ).resolves.toBe(true);
    expect(planLimitService.checkLimit).not.toHaveBeenCalled();
  });

  it('lets a user without an organization scope through', async () => {
    reflector.getAllAndOverride.mockReturnValue('users');

    await expect(
      guard.canActivate(createContext({ organizationId: undefined, role: 'ADMIN' })),
    ).resolves.toBe(true);
    expect(planLimitService.checkLimit).not.toHaveBeenCalled();
  });

  it('checks the limit of the current organization', async () => {
    reflector.getAllAndOverride.mockReturnValue('users');
    planLimitService.checkLimit.mockResolvedValue({
      allowed: true,
      current: 2,
      limit: 3,
    });

    await expect(
      guard.canActivate(createContext({ organizationId: 'org-1', role: 'ADMIN' })),
    ).resolves.toBe(true);
    expect(planLimitService.checkLimit).toHaveBeenCalledWith('users', 'org-1');
  });

  it('rejects with the limit payload when the plan is exceeded', async () => {
    reflector.getAllAndOverride.mockReturnValue('users');
    planLimitService.checkLimit.mockResolvedValue({
      allowed: false,
      current: 3,
      limit: 3,
    });

    const error = await guard
      .canActivate(createContext({ organizationId: 'org-1', role: 'ADMIN' }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      message: 'Plan limit exceeded for users',
      limit: 3,
      current: 3,
      exceeded: true,
      type: 'users',
    });
  });
});
