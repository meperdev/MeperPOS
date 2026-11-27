import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { OrganizationRequiredGuard } from './organization-required.guard';
import { OrgRole } from '@prisma/client';
import type { RequestUser } from '../interfaces/request-user.interface';

describe('OrganizationRequiredGuard', () => {
  let guard: OrganizationRequiredGuard;

  const createMockContext = (user?: RequestUser): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    guard = new OrganizationRequiredGuard();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('allows requests without a user (JwtAuthGuard handles auth)', () => {
    const context = createMockContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows users with a valid organizationId', () => {
    const user: RequestUser = {
      userId: 'user-1',
      email: 'admin@example.com',
      organizationId: 'org-1',
      role: OrgRole.ADMIN,
      tokenVersion: 1,
      isSuperAdmin: false,
    };
    const context = createMockContext(user);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows SuperAdmin with undefined organizationId', () => {
    const user: RequestUser = {
      userId: 'super-1',
      email: 'super@example.com',
      organizationId: undefined,
      role: 'SUPER_ADMIN',
      tokenVersion: 1,
      isSuperAdmin: true,
    };
    const context = createMockContext(user);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('blocks users with undefined organizationId', () => {
    const user = {
      userId: 'user-1',
      email: 'user@example.com',
      organizationId: undefined,
      role: OrgRole.CASHIER,
      tokenVersion: 1,
      isSuperAdmin: false,
    } as unknown as RequestUser;
    const context = createMockContext(user);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
