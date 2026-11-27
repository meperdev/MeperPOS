import 'reflect-metadata';
import { PrismaClient, OrgRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';

const prisma = new PrismaClient();

/**
 * SEC-001 regression (security audit, FASE 7), restated for phase 2 (S8 b, c).
 *
 * The OWNER role is retired: nobody can assign it, and ADMIN — the top role —
 * can only be created by the organization's primary owner (`isPrimaryOwner`)
 * or a SUPER_ADMIN. The old OWNER-target protections now protect the primary
 * owner's account: an ADMIN who is not the primary owner can neither mint an
 * ADMIN nor reset the primary owner's password. The service-level checks below
 * must hold regardless of the controller guards, which is why they are proven
 * against a real database instead of mocks.
 */
describe('UsersService — privilege escalation guardrails (SEC-001, S8 b/c)', () => {
  let usersService: UsersService;
  let orgId: string;
  let adminId: string;
  let primaryOwnerId: string;
  let memberId: string;
  let primaryOwnerEmail: string;
  const stamp = Date.now();
  const mintedEmail = `sec001-minted-admin-${stamp}@example.com`;

  const actorOf = (
    userId: string,
    role: OrgRole | 'SUPER_ADMIN',
    isSuperAdmin = false,
  ) =>
    ({
      userId,
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
          create: {
            organizationId: orgId,
            role: OrgRole.ADMIN,
            isPrimaryOwner: false,
          },
        },
      },
    });
    adminId = admin.id;

    // The primary owner is an ADMIN now; ownership rides the flag.
    const owner = await prisma.user.create({
      data: {
        email: `sec001-owner-${stamp}@example.com`,
        password: await bcrypt.hash('Sec001-OwnerPass-123!', 4),
        name: 'SEC001 Owner',
        tokenVersion: 0,
        organizationUsers: {
          create: {
            organizationId: orgId,
            role: OrgRole.ADMIN,
            isPrimaryOwner: true,
          },
        },
      },
    });
    primaryOwnerId = owner.id;
    primaryOwnerEmail = owner.email;

    const member = await prisma.user.create({
      data: {
        email: `sec001-member-${stamp}@example.com`,
        password: await bcrypt.hash('Sec001-MemberPass-123!', 4),
        name: 'SEC001 Member',
        tokenVersion: 0,
        organizationUsers: {
          create: { organizationId: orgId, role: OrgRole.CASHIER },
        },
      },
    });
    memberId = member.id;
  }, 30000);

  afterAll(async () => {
    // Only this run's fixtures: every address it creates ends with the stamp,
    // so a shared database keeps everyone else's accounts and sessions.
    const users = await prisma.user.findMany({
      where: {
        email: { startsWith: 'sec001-', endsWith: `-${stamp}@example.com` },
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

  it('rejects an ADMIN creating an ADMIN with 403 and persists nothing', async () => {
    await expect(
      usersService.create(
        {
          email: mintedEmail,
          password: 'Sec001-MintedPass-123!',
          name: 'Minted Admin',
          role: OrgRole.ADMIN,
        },
        orgId,
        actorOf(adminId, OrgRole.ADMIN),
      ),
    ).rejects.toMatchObject({ status: 403 });

    expect(
      await prisma.user.findUnique({ where: { email: mintedEmail } }),
    ).toBeNull();
  });

  it('rejects assigning the retired OWNER role with 403 and persists nothing', async () => {
    const ownerEmail = `sec001-minted-owner-${stamp}@example.com`;

    await expect(
      usersService.create(
        {
          email: ownerEmail,
          password: 'Sec001-MintedPass-123!',
          name: 'Minted Owner',
          role: OrgRole.OWNER,
        },
        orgId,
        actorOf(primaryOwnerId, OrgRole.ADMIN),
      ),
    ).rejects.toMatchObject({ status: 403 });

    expect(
      await prisma.user.findUnique({ where: { email: ownerEmail } }),
    ).toBeNull();
  });

  it('rejects an ADMIN resetting the primary owner password with 403 and leaves the hash untouched', async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: primaryOwnerId },
    });

    await expect(
      usersService.resetPassword(
        adminId,
        primaryOwnerId,
        { newPassword: 'Hacked-Owner-Pw-999999' },
        orgId,
        actorOf(adminId, OrgRole.ADMIN),
      ),
    ).rejects.toMatchObject({ status: 403 });

    const after = await prisma.user.findUniqueOrThrow({
      where: { email: primaryOwnerEmail },
    });
    expect(after.password).toBe(owner.password);
  });

  it('rejects an ADMIN editing or deactivating the primary owner with 403 and leaves the row untouched', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: primaryOwnerId },
    });

    await expect(
      usersService.update(
        adminId,
        primaryOwnerId,
        { email: `sec001-hijacked-${Date.now()}@example.com` },
        orgId,
        actorOf(adminId, OrgRole.ADMIN),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      usersService.toggleActive(
        adminId,
        primaryOwnerId,
        orgId,
        actorOf(adminId, OrgRole.ADMIN),
      ),
    ).rejects.toMatchObject({ status: 403 });

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: primaryOwnerId },
    });
    expect(after.email).toBe(before.email);
    expect(after.active).toBe(true);
  });

  it('lets the primary owner create an ADMIN', async () => {
    const created = await usersService.create(
      {
        email: mintedEmail,
        password: 'Sec001-MintedPass-123!',
        name: 'Minted Admin',
        role: OrgRole.ADMIN,
      },
      orgId,
      actorOf(primaryOwnerId, OrgRole.ADMIN),
    );

    expect(created.email).toBe(mintedEmail);
    const membership = await prisma.organizationUser.findFirstOrThrow({
      where: { userId: created.id, organizationId: orgId },
      select: { role: true, isPrimaryOwner: true },
    });
    expect(membership).toEqual({
      role: OrgRole.ADMIN,
      isPrimaryOwner: false,
    });
  });

  it('still allows an ADMIN to create non-ADMIN roles (positive control)', async () => {
    const created = await usersService.create(
      {
        email: `sec001-cashier-${stamp}@example.com`,
        password: 'Sec001-CashierPass-123!',
        name: 'Legit Cashier',
        role: OrgRole.CASHIER,
      },
      orgId,
      actorOf(adminId, OrgRole.ADMIN),
    );
    expect(created.email).toBe(`sec001-cashier-${stamp}@example.com`);
  });

  it('still allows an ADMIN to reset a member password', async () => {
    await expect(
      usersService.resetPassword(
        adminId,
        memberId,
        { newPassword: 'Member-New-Pw-123456' },
        orgId,
        actorOf(adminId, OrgRole.ADMIN),
      ),
    ).resolves.toMatchObject({
      message: 'Contraseña restablecida exitosamente',
    });
  });

  it('lets the primary owner reset the primary owner password', async () => {
    await expect(
      usersService.resetPassword(
        primaryOwnerId,
        primaryOwnerId,
        { newPassword: 'Owner-New-Pw-123456' },
        orgId,
        actorOf(primaryOwnerId, OrgRole.ADMIN),
      ),
    ).resolves.toMatchObject({
      message: 'Contraseña restablecida exitosamente',
    });
  });
});
