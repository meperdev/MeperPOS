import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { PrismaClient, OrgRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';

const prisma = new PrismaClient();

/**
 * SEC-001 regression (security audit, FASE 7):
 * an ADMIN must not be able to mint OWNER accounts nor reset the password of
 * an OWNER. Both were reproducible PoCs: POST /api/users {role:OWNER} as ADMIN
 * returned 201, and ADMIN_PASSWORD_RESET against an OWNER took over the
 * account. The service-level checks below must hold regardless of the
 * controller guards.
 */
describe('UsersService — privilege escalation guardrails (SEC-001)', () => {
  let usersService: UsersService;
  let orgId: string;
  let adminId: string;
  let ownerEmail: string;

  const adminActor = (role: OrgRole | 'SUPER_ADMIN', isSuperAdmin = false) =>
    ({
      userId: 'actor-not-persisted',
      email: 'actor@example.com',
      organizationId: orgId,
      role,
      tokenVersion: 0,
      isSuperAdmin,
    }) as unknown as RequestUser;

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

    const stamp = Date.now();
    orgId = `sec001-org-${stamp}`;
    await prisma.organization.create({
      data: { id: orgId, name: 'SEC001 Org', slug: `sec001-${stamp}` },
    });

    const admin = await prisma.user.create({
      data: {
        email: `sec001-admin-${stamp}@example.com`,
        password: await bcrypt.hash('Sec001-AdminPass-123!', 4),
        name: 'SEC001 Admin',
        tokenVersion: 0,
        organizationUsers: {
          create: { organizationId: orgId, role: OrgRole.ADMIN },
        },
      },
    });
    adminId = admin.id;

    // A real OWNER account the ADMIN must never be able to take over.
    const owner = await prisma.user.create({
      data: {
        email: `sec001-owner-${stamp}@example.com`,
        password: await bcrypt.hash('Sec001-OwnerPass-123!', 4),
        name: 'SEC001 Owner',
        tokenVersion: 0,
        organizationUsers: {
          create: { organizationId: orgId, role: OrgRole.OWNER },
        },
      },
    });
    ownerEmail = owner.email;
  }, 30000);

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { startsWith: 'sec001-admin-' } },
          { email: { startsWith: 'sec001-owner-' } },
          { email: { startsWith: 'sec001-minted-' } },
          { email: { startsWith: 'sec001-cashier-' } },
        ],
      },
      select: { id: true },
    });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  }, 30000);

  it('rejects an ADMIN creating an OWNER account with 403 and persists nothing', async () => {
    await expect(
      usersService.create(
        {
          email: 'sec001-minted-owner@example.com',
          password: 'Sec001-MintedPass-123!',
          name: 'Minted Owner',
          role: OrgRole.OWNER,
        },
        orgId,
        adminActor(OrgRole.ADMIN),
      ),
    ).rejects.toMatchObject({ status: 403 });

    const minted = await prisma.user.findUnique({
      where: { email: 'sec001-minted-owner@example.com' },
    });
    expect(minted).toBeNull();
  });

  it('rejects an ADMIN resetting the password of an OWNER with 403 and leaves the hash untouched', async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: ownerEmail },
    });

    await expect(
      usersService.resetPassword(
        adminId,
        owner.id,
        { newPassword: 'Hacked-Owner-Pw-999999' },
        orgId,
        adminActor(OrgRole.ADMIN),
      ),
    ).rejects.toMatchObject({ status: 403 });

    const after = await prisma.user.findUniqueOrThrow({
      where: { email: ownerEmail },
    });
    expect(after.password).toBe(owner.password);
  });

  it('still allows an ADMIN to create non-OWNER roles (positive control)', async () => {
    const created = await usersService.create(
      {
        email: 'sec001-cashier-1@example.com',
        password: 'Sec001-CashierPass-123!',
        name: 'Legit Cashier',
        role: OrgRole.CASHIER,
      },
      orgId,
      adminActor(OrgRole.ADMIN),
    );
    expect(created.email).toBe('sec001-cashier-1@example.com');
  });
});
