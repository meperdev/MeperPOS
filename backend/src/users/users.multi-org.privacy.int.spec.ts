import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../auth/auth.service';
import { setupTwoOrgFixture, type TwoOrgFixture } from '../testing/two-org-fixture';
import { UsersService } from './users.service';

/**
 * Multi-org privacy regression guard (spec 4.R1 + amendments 3 and 4).
 *
 * A user M who belongs to two organizations has ONE global identity: the
 * User row (name, email, password, active) is shared by every organization
 * they belong to. When org A's admin mutates M through the users boundary,
 * org B's view of M and M's login credentials change with it — the #47
 * accepted-risk bug. The conforming outcome (amendment 3) is DENIAL: the
 * admin's action is rejected with ForbiddenException and B's view plus M's
 * login state are untouched.
 *
 * Assertions are ordered DB-state-first so a regression fails with the
 * exact mutated value (e.g. Received: 'Mutated By Org A') instead of a
 * bare "promise resolved" message.
 */
describe('UsersService multi-org privacy — Integration (real DB)', () => {
  let fixture: TwoOrgFixture;
  let prisma: PrismaClient;
  let usersService: UsersService;
  let targetCounter = 0;
  const targetIds: string[] = [];

  const futureExpiry = () => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    return expiresAt;
  };

  /** Creates a target user with the given memberships and a known password. */
  const createTargetUser = async (organizations: string[], password: string) => {
    targetCounter += 1;
    const suffix = `${Date.now()}-${targetCounter}`;
    const user = await prisma.user.create({
      data: {
        email: `users-privacy-target-${suffix}@example.com`,
        password: await bcrypt.hash(password, 10),
        name: `Original Name ${suffix}`,
        active: true,
        tokenVersion: 0,
      },
    });
    await prisma.organizationUser.createMany({
      data: organizations.map((organizationId) => ({
        userId: user.id,
        organizationId,
        role: OrgRole.CASHIER,
      })),
    });
    targetIds.push(user.id);
    return user;
  };

  const createActiveRefreshToken = async (userId: string) =>
    prisma.refreshToken.create({
      data: {
        userId,
        token: `refresh-hash-${userId}`,
        organizationId: null,
        expiresAt: futureExpiry(),
      },
    });

  /** Records whether the admin action resolved or was rejected (and by what). */
  const outcomeOf = async (action: () => Promise<unknown>): Promise<string> => {
    try {
      await action();
      return 'resolved';
    } catch (error) {
      return `rejected:${(error as Error).constructor.name}`;
    }
  };

  beforeAll(async () => {
    fixture = await setupTwoOrgFixture('users-privacy');
    prisma = fixture.prisma;

    // Org A's acting admin. Org B has no admin here: the whole point is that
    // B's view of M must not change, so nobody acts on B's behalf.
    await prisma.organizationUser.create({
      data: {
        userId: fixture.userAId,
        organizationId: fixture.orgAId,
        role: OrgRole.ADMIN,
      },
    });

    const planLimitServiceStub = { invalidateCache: jest.fn() };
    const realAuthService = new AuthService(prisma, {} as JwtService);
    usersService = new UsersService(
      prisma as never,
      planLimitServiceStub as never,
      realAuthService,
    );
  });

  afterAll(async () => {
    await fixture.teardown(async () => {
      await prisma.refreshToken.deleteMany({
        where: { userId: { in: targetIds } },
      });
      await prisma.organizationUser.deleteMany({
        where: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
      });
      await prisma.user.deleteMany({ where: { id: { in: targetIds } } });
    });
  });

  describe('multi-org target — amendment 3 denial semantics', () => {
    it('denies name/email edits from org A and leaves B-side view and login state unchanged', async () => {
      const target = await createTargetUser(
        [fixture.orgAId, fixture.orgBId],
        'OriginalPass123',
      );

      const outcome = await outcomeOf(() =>
        usersService.update(
          fixture.userAId,
          target.id,
          { name: 'Mutated By Org A', email: `mutated-${target.id}@example.com` },
          fixture.orgAId, undefined,
        ),
      );

      // The global User row must be byte-identical to the pre-action state.
      const after = await prisma.user.findUnique({ where: { id: target.id } });
      expect(after?.name).toBe(target.name);
      expect(after?.email).toBe(target.email);
      expect(outcome).toBe(`rejected:${ForbiddenException.name}`);

      // Org B's view of M is unchanged.
      const orgBView = await prisma.user.findMany({
        where: { organizationUsers: { some: { organizationId: fixture.orgBId } } },
        select: { id: true, name: true, email: true, active: true },
      });
      const mInOrgB = orgBView.find((u) => u.id === target.id);
      expect(mInOrgB).toEqual({
        id: target.id,
        name: target.name,
        email: target.email,
        active: true,
      });

      // M's login state is unchanged: old password still valid.
      const reloaded = await prisma.user.findUnique({ where: { id: target.id } });
      expect(
        await bcrypt.compare('OriginalPass123', reloaded!.password),
      ).toBe(true);
    });

    it('denies password reset from org A and leaves M login state (password, tokenVersion, refresh tokens) unchanged', async () => {
      const target = await createTargetUser(
        [fixture.orgAId, fixture.orgBId],
        'OriginalPass123',
      );
      await createActiveRefreshToken(target.id);

      const outcome = await outcomeOf(() =>
        usersService.resetPassword(
          fixture.userAId,
          target.id,
          { newPassword: 'NewPass456!' },
          fixture.orgAId, undefined,
        ),
      );

      const after = await prisma.user.findUnique({ where: { id: target.id } });
      expect(await bcrypt.compare('OriginalPass123', after!.password)).toBe(
        true,
      );
      expect(after?.tokenVersion).toBe(0);

      // M's active refresh tokens must survive untouched.
      const tokens = await prisma.refreshToken.findMany({
        where: { userId: target.id },
      });
      expect(tokens).toHaveLength(1);
      expect(tokens[0].revokedAt).toBeNull();

      expect(outcome).toBe(`rejected:${ForbiddenException.name}`);
    });

    it('denies deactivation from org A and leaves M active for org B logins', async () => {
      const target = await createTargetUser(
        [fixture.orgAId, fixture.orgBId],
        'OriginalPass123',
      );

      const outcome = await outcomeOf(() =>
        usersService.toggleActive(fixture.userAId, target.id, fixture.orgAId, undefined),
      );

      const after = await prisma.user.findUnique({ where: { id: target.id } });
      expect(after?.active).toBe(true);

      // Deactivation is the login-killing mutation: org B must still see M active.
      const orgBView = await prisma.user.findMany({
        where: { organizationUsers: { some: { organizationId: fixture.orgBId } } },
        select: { id: true, active: true },
      });
      const mInOrgB = orgBView.find((u) => u.id === target.id);
      expect(mInOrgB).toEqual({ id: target.id, active: true });

      expect(outcome).toBe(`rejected:${ForbiddenException.name}`);
    });
  });

  describe('single-org target — admin flow survives (amendment 3 success path)', () => {
    it('allows org A admin to update a single-org user', async () => {
      const target = await createTargetUser([fixture.orgAId], 'SoloPass123');

      await usersService.update(
        fixture.userAId,
        target.id,
        { name: 'Renamed By Org A' },
        fixture.orgAId, undefined,
      );

      const after = await prisma.user.findUnique({ where: { id: target.id } });
      expect(after?.name).toBe('Renamed By Org A');
      expect(
        await bcrypt.compare('SoloPass123', after!.password),
      ).toBe(true);
    });

    it('allows org A admin to toggle a single-org user', async () => {
      const target = await createTargetUser([fixture.orgAId], 'SoloPass123');

      await usersService.toggleActive(fixture.userAId, target.id, fixture.orgAId, undefined);

      const after = await prisma.user.findUnique({ where: { id: target.id } });
      expect(after?.active).toBe(false);
    });

    it('resets a single-org user password AND revokes their tokens (credential hygiene)', async () => {
      const target = await createTargetUser([fixture.orgAId], 'SoloPass123');
      await createActiveRefreshToken(target.id);

      await usersService.resetPassword(
        fixture.userAId,
        target.id,
        { newPassword: 'NewPass456!' },
        fixture.orgAId, undefined,
      );

      const after = await prisma.user.findUnique({ where: { id: target.id } });
      expect(await bcrypt.compare('NewPass456!', after!.password)).toBe(true);

      // revocation is global, so it must only ever run behind the single-org
      // rule — here it is expected: the reset invalidates stolen sessions.
      expect(after?.tokenVersion).toBe(1);
      const tokens = await prisma.refreshToken.findMany({
        where: { userId: target.id },
      });
      expect(tokens).toHaveLength(1);
      expect(tokens[0].revokedAt).not.toBeNull();
    });
  });
});
