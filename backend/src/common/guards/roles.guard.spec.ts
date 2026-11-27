import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const createMockContext = (user?: {
    role?: OrgRole | 'SUPER_ADMIN';
    isSuperAdmin?: boolean;
  }): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          user: user ?? undefined,
        }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const context = createMockContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when user has required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OrgRole.ADMIN]);

    const context = createMockContext({ role: OrgRole.ADMIN });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user role does not match', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OrgRole.ADMIN]);

    const context = createMockContext({ role: OrgRole.CASHIER });
    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException('Access denied. Required roles: ADMIN'),
    );
  });

  it('should throw ForbiddenException when user has no role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OrgRole.ADMIN]);

    const context = createMockContext();
    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException('User role not found'),
    );
  });

  it('should allow access when user has one of multiple required roles', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([OrgRole.ADMIN, OrgRole.CASHIER]);

    const context = createMockContext({ role: OrgRole.CASHIER });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user role is not in required roles list', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([OrgRole.ADMIN, OrgRole.CASHIER]);

    const context = createMockContext({ role: OrgRole.INVENTORY_USER });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow access for SuperAdmin regardless of required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OrgRole.ADMIN]);

    const context = createMockContext({
      role: 'SUPER_ADMIN',
      isSuperAdmin: true,
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access for user with isSuperAdmin flag', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OrgRole.ADMIN]);

    const context = createMockContext({
      role: OrgRole.CASHIER,
      isSuperAdmin: true,
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow CASHIER when CASHIER is explicitly required', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([OrgRole.ADMIN, OrgRole.CASHIER]);

    const context = createMockContext({ role: OrgRole.CASHIER });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny CASHIER for ADMIN-only endpoints', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OrgRole.ADMIN]);

    const context = createMockContext({ role: OrgRole.CASHIER });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow ADMIN to inherit CASHIER-required access', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([OrgRole.CASHIER]);

    const context = createMockContext({ role: OrgRole.ADMIN });
    expect(guard.canActivate(context)).toBe(true);
  });
});
