import 'reflect-metadata';
import { firstValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient, PlanType, OrgRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { AUDIT_ACTION_KEY } from '../common/decorators/audit.decorator';

const prisma = new PrismaClient();

// Audit parity contract: the expected row fields below are the PRE-migration
// manual `auditLog.create` values that users.service.resetPassword used to
// write (userId, action, resource, resourceId, metadata summary/targets).
// The spec proves the route produces ONE row with IDENTICAL values when the
// audit write moves to AuditInterceptor + attachAuditContext.
describe('UsersService.resetPassword — Integration (audit parity)', () => {
  let usersService: UsersService;
  let auditInterceptor: AuditInterceptor;
  let orgId: string;
  let adminId: string;
  let target1Id: string;
  let target2Id: string;
  let target1Email: string;
  let target2Email: string;

  const runResetPasswordThroughInterceptor = async (
    targetUserId: string,
    targetEmail: string,
  ) => {
    const dto = { newPassword: 'NuevaClaveSegura123' };

    const request = {
      method: 'POST',
      url: `/api/users/${targetUserId}/reset-password`,
      headers: { 'user-agent': 'jest-audit-parity' },
      ip: '127.0.0.1',
      params: { id: targetUserId },
      body: dto,
      user: {
        userId: adminId,
        email: 'admin-audit@example.com',
        role: 'ADMIN',
        organizationId: orgId,
      },
    };

    const handler = () => undefined;
    Reflect.defineMetadata(AUDIT_ACTION_KEY, 'ADMIN_PASSWORD_RESET', handler);

    class UsersRouteFixture {}

    const executionContext = {
      getHandler: () => handler,
      getClass: () => UsersRouteFixture,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    const serviceResult = await usersService.resetPassword(
      adminId,
      targetUserId,
      dto,
      orgId,
      undefined,
    );

    const next: CallHandler = { handle: () => of(serviceResult) };

    await firstValueFrom(auditInterceptor.intercept(executionContext, next));

    return { serviceResult, targetEmail };
  };

  const waitForStableAuditRows = async (
    where: Prisma.AuditLogWhereInput = {
      organizationId: orgId,
      action: 'ADMIN_PASSWORD_RESET',
    },
  ) => {
    // The interceptor writes the audit row post-response (fire-and-forget
    // promise after the observable emits), so poll until the row count is
    // stable across two consecutive polls.
    const fetchRows = () =>
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'asc' },
      });

    let previous = await fetchRows();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const current = await fetchRows();
      if (current.length === previous.length) {
        return current;
      }
      previous = current;
    }
    return previous;
  };

  beforeAll(async () => {
    const planLimitServiceStub = { invalidateCache: jest.fn() };
    const authServiceStub = {
      revokeUserTokens: jest.fn().mockResolvedValue({ id: 'stub' }),
    };
    usersService = new UsersService(
      prisma as never,
      planLimitServiceStub as never,
      authServiceStub as never,
    );
    auditInterceptor = new AuditInterceptor(prisma as never, new Reflector());

    const suffix = Date.now();
    const org = await prisma.organization.create({
      data: {
        name: 'Users INT Audit Org',
        slug: `users-int-audit-${suffix}`,
        plan: PlanType.BASIC,
        active: true,
      },
    });
    orgId = org.id;

    const admin = await prisma.user.create({
      data: {
        email: `users-int-audit-admin-${suffix}@example.com`,
        password: 'hash',
        name: 'Admin User',
        tokenVersion: 0,
      },
    });
    adminId = admin.id;

    target1Email = `users-int-audit-target1-${suffix}@example.com`;
    target2Email = `users-int-audit-target2-${suffix}@example.com`;

    const target1 = await prisma.user.create({
      data: {
        email: target1Email,
        password: 'old-hash',
        name: 'Target One',
        tokenVersion: 0,
      },
    });
    target1Id = target1.id;

    const target2 = await prisma.user.create({
      data: {
        email: target2Email,
        password: 'old-hash',
        name: 'Target Two',
        tokenVersion: 0,
      },
    });
    target2Id = target2.id;

    await prisma.organizationUser.createMany({
      data: [
        { userId: adminId, organizationId: orgId, role: OrgRole.ADMIN },
        { userId: target1Id, organizationId: orgId, role: OrgRole.CASHIER },
        { userId: target2Id, organizationId: orgId, role: OrgRole.CASHIER },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [adminId, target1Id, target2Id] } },
    });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('produces exactly one audit row identical to the pre-migration manual contract', async () => {
    const { serviceResult } = await runResetPasswordThroughInterceptor(
      target1Id,
      target1Email,
    );

    // The HTTP contract of the route is unchanged.
    expect(serviceResult).toEqual({
      message: 'Contraseña restablecida exitosamente',
    });

    // The business op itself still rotates the password.
    const resetUser = await prisma.user.findUnique({
      where: { id: target1Id },
    });
    expect(resetUser?.password).not.toBe('old-hash');
    expect(
      await bcrypt.compare('NuevaClaveSegura123', resetUser!.password),
    ).toBe(true);

    const rows = await waitForStableAuditRows();

    // Parity requires the route to produce EXACTLY ONE audit row. Before the
    // migration, wiring the interceptor onto the route duplicates the manual
    // service write with a fallback-context row.
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.userId).toBe(adminId);
    expect(row.organizationId).toBe(orgId);
    expect(row.action).toBe('ADMIN_PASSWORD_RESET');
    expect(row.resource).toBe('User');
    expect(row.resourceId).toBe(target1Id);

    const metadata = row.metadata as Record<string, unknown>;
    expect(metadata.summary).toBe(
      `Reset password for user Target One (${target1Email})`,
    );
    expect(metadata.targetUserId).toBe(target1Id);
    expect(metadata.targetUserEmail).toBe(target1Email);
    expect(metadata.targetUserName).toBe('Target One');
    expect(typeof metadata.timestamp).toBe('string');
  });

  it('derives the audit identity from the actual target user, not from the route URL', async () => {
    await runResetPasswordThroughInterceptor(target2Id, target2Email);

    const rows = await waitForStableAuditRows({
      organizationId: orgId,
      action: 'ADMIN_PASSWORD_RESET',
      resourceId: target2Id,
    });

    // One contract row for this reset — not a manual row plus an
    // interceptor fallback row.
    expect(rows).toHaveLength(1);

    expect(rows[0].resource).toBe('User');

    const metadata = rows[0].metadata as Record<string, unknown>;
    expect(metadata.targetUserId).toBe(target2Id);
    expect(metadata.targetUserEmail).toBe(target2Email);
    expect(metadata.targetUserName).toBe('Target Two');
  });
});
