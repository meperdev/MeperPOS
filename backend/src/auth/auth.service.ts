import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BCRYPT_ROUNDS } from '../common/constants/security.constants';
import {
  LoginDto,
  RegisterDto,
  UpdateProfileDto,
  ChangePasswordDto,
} from './dto/auth.dto';
import { OrgRole, OrgStatus, Prisma } from '@prisma/client';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_REUSE_GRACE_MS,
} from './auth.constants';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, name } = registerDto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...result } = user;
    return result;
  }

  async login(loginDto: LoginDto, ipAddress?: string, userAgent?: string) {
    const { email, password, organizationId } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // SuperAdmin bypass
    if (user.isSuperAdmin) {
      return this.generateTokenPair(
        user,
        { organizationId: null, role: 'SUPER_ADMIN' as const },
        ipAddress,
        userAgent,
      );
    }

    // If organizationId is explicitly provided, validate membership directly
    if (organizationId) {
      const orgUser = await this.prisma.organizationUser.findFirst({
        where: {
          userId: user.id,
          organizationId,
        },
      });

      if (!orgUser) {
        throw new UnauthorizedException('Organization membership not found');
      }

      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { status: true },
      });

      if (org?.status === OrgStatus.SUSPENDED) {
        throw new UnauthorizedException('Organization is suspended');
      }

      return this.generateTokenPair(user, orgUser, ipAddress, userAgent);
    }

    // No organizationId provided — count user's organizations
    const userOrgs = await this.prisma.organizationUser.findMany({
      where: { userId: user.id },
      orderBy: { joinedAt: 'asc' },
      include: {
        organization: {
          select: { id: true, name: true, plan: true, status: true },
        },
      },
    });

    if (userOrgs.length === 0) {
      throw new UnauthorizedException('User has no organizations');
    }

    if (userOrgs.length === 1) {
      const orgUser = userOrgs[0];

      if (orgUser.organization.status === OrgStatus.SUSPENDED) {
        throw new UnauthorizedException('Organization is suspended');
      }

      return this.generateTokenPair(
        user,
        {
          organizationId: orgUser.organizationId,
          role: orgUser.role,
          isPrimaryOwner: orgUser.isPrimaryOwner,
        },
        ipAddress,
        userAgent,
      );
    }

    // 2+ organizations — require selection
    const preAuthToken = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        type: 'pre-auth',
      },
      { expiresIn: '5m' },
    );

    return {
      requiresOrganizationSelection: true,
      preAuthToken,
      organizations: userOrgs.map((uo) => ({
        id: uo.organizationId,
        name: uo.organization.name,
        role: uo.role,
        plan: uo.organization.plan,
      })),
    };
  }

  async selectOrganization(preAuthToken: string, organizationId: string) {
    let payload: { sub: string; email: string; type: string };

    try {
      payload = this.jwtService.verify(preAuthToken);
    } catch {
      throw new UnauthorizedException('Invalid pre-authentication token');
    }

    if (payload.type !== 'pre-auth') {
      throw new UnauthorizedException('Invalid pre-authentication token');
    }

    const userId = payload.sub;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const orgUser = await this.prisma.organizationUser.findFirst({
      where: {
        userId,
        organizationId,
      },
    });

    if (!orgUser) {
      throw new UnauthorizedException('Organization membership not found');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { status: true, name: true, plan: true },
    });

    if (!org) {
      throw new UnauthorizedException('Organization not found');
    }

    if (org.status === OrgStatus.SUSPENDED) {
      throw new ForbiddenException('Organization is suspended');
    }

    return this.generateTokenPair(user, orgUser);
  }

  private async generateTokenPair(
    user: {
      id: string;
      email: string;
      name: string;
      tokenVersion: number;
    },
    orgUser: {
      organizationId: string | null;
      role: OrgRole | 'SUPER_ADMIN';
      /** The membership's flag; absent (SUPER_ADMIN, no membership) is false. */
      isPrimaryOwner?: boolean;
    },
    ipAddress?: string,
    userAgent?: string,
  ) {
    const payload = {
      sub: user.id,
      email: user.email,
      organizationId: orgUser.organizationId,
      role: orgUser.role,
      tokenVersion: user.tokenVersion,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(rawRefreshToken)
      .digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshTokenHash,
        organizationId: orgUser.organizationId,
        expiresAt,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });

    // The browser needs the organization facts the bell, the billing banner and
    // the status interceptor read. Only `/auth/profile` used to return them, so a
    // fresh login or an organization switch left the client without an
    // organization until a full reload.
    const organization = orgUser.organizationId
      ? await this.prisma.organization.findUnique({
          where: { id: orgUser.organizationId },
          select: {
            id: true,
            plan: true,
            status: true,
            trialEndsAt: true,
            billingStatus: true,
          },
        })
      : null;

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        organizationId: orgUser.organizationId,
        role: orgUser.role,
        isPrimaryOwner: orgUser.isPrimaryOwner === true,
        organization,
      },
    };
  }

  async refresh(rawRefreshToken: string) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawRefreshToken)
      .digest('hex');

    const refreshToken = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (refreshToken.revokedAt) {
      // Concurrent-tab reuse grace (design D3.2): tabs sharing a session may
      // present a token another tab's rotation just revoked. While a NEWER
      // active row for the same user was created within the grace window,
      // rotate from that row instead of killing the tab with 401. Beyond the
      // window this is a genuine reuse signal.
      //
      // SEC-005: the grace applies ONLY to revocations caused by rotation.
      // A token revoked by logout or by a global revocation is an explicit
      // session end: replaying it must never mint a new session, even while
      // another active row of the same user is still fresh.
      if (refreshToken.revocationCause !== 'rotated') {
        throw new UnauthorizedException('Refresh token revoked');
      }

      const replacement = await this.prisma.refreshToken.findFirst({
        where: {
          userId: refreshToken.userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          createdAt: { gte: new Date(Date.now() - REFRESH_REUSE_GRACE_MS) },
        },
        include: { user: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!replacement) {
        throw new UnauthorizedException('Refresh token revoked');
      }

      return this.rotateActiveRow(replacement);
    }

    if (refreshToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (!refreshToken.user.active) {
      throw new UnauthorizedException('User inactive');
    }

    return this.rotateActiveRow(refreshToken);
  }

  /**
   * Revokes the given (active) refresh-token row and issues a fresh pair from
   * it — the shared rotation path for both a normally presented token and a
   * grace-window replacement row.
   */
  private async rotateActiveRow(
    refreshToken: Prisma.RefreshTokenGetPayload<{ include: { user: true } }>,
  ) {
    if (!refreshToken.user.active) {
      throw new UnauthorizedException('User inactive');
    }

    // SuperAdmin bypass
    if (refreshToken.user.isSuperAdmin) {
      // Revocar token anterior
      await this.prisma.refreshToken.update({
        where: { id: refreshToken.id },
        data: { revokedAt: new Date(), revocationCause: 'rotated' },
      });

      return this.generateTokenPair(refreshToken.user, {
        organizationId: null,
        role: 'SUPER_ADMIN' as const,
      });
    }

    // Resolve the org context from the token row (design D3.1): rows issued
    // after the org-binding migration carry the session's selected org, so a
    // refresh cannot silently flip a multi-org user back to their first-joined
    // organization. Legacy/null rows fall back to first-joined membership.
    const orgUser =
      refreshToken.organizationId !== null
        ? await this.prisma.organizationUser.findFirst({
            where: {
              userId: refreshToken.user.id,
              organizationId: refreshToken.organizationId,
            },
          })
        : await this.prisma.organizationUser.findFirst({
            where: { userId: refreshToken.user.id },
            orderBy: { joinedAt: 'asc' },
          });

    if (!orgUser) {
      throw new UnauthorizedException(
        refreshToken.organizationId !== null
          ? 'Organization membership not found'
          : 'User has no organizations',
      );
    }

    // Revalidate organization status for the resolved org
    const org = await this.prisma.organization.findUnique({
      where: { id: orgUser.organizationId },
      select: { status: true },
    });

    if (org?.status === OrgStatus.SUSPENDED) {
      throw new UnauthorizedException('Organization is suspended');
    }

    // Revocar token anterior
    await this.prisma.refreshToken.update({
      where: { id: refreshToken.id },
      data: { revokedAt: new Date(), revocationCause: 'rotated' },
    });

    return this.generateTokenPair(refreshToken.user, orgUser);
  }

  /**
   * Revokes a single refresh token by its raw value (used by POST /auth/logout).
   * Idempotent: unknown or already-revoked tokens resolve without error so
   * logout never fails for the client.
   */
  async logout(rawRefreshToken?: string | null): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    const tokenHash = crypto
      .createHash('sha256')
      .update(rawRefreshToken)
      .digest('hex');

    await this.prisma.refreshToken.updateMany({
      where: { token: tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revocationCause: 'logout' },
    });
  }

  async revokeUserTokens(userId: string) {
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revocationCause: 'revoke-all' },
    });

    return updatedUser;
  }

  async validateUser(userId: string, organizationId: string | null) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...result } = user;

    if (user.isSuperAdmin) {
      return {
        ...result,
        role: 'SUPER_ADMIN',
        isSuperAdmin: true,
        isPrimaryOwner: false,
      };
    }

    if (!organizationId) {
      throw new UnauthorizedException('Organization membership not found');
    }

    const orgUser = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: {
        organization: {
          select: {
            id: true,
            plan: true,
            status: true,
            trialEndsAt: true,
            billingStatus: true,
          },
        },
      },
    });

    if (!orgUser) {
      throw new UnauthorizedException('Organization membership not found');
    }

    // S9: the role column only holds current enum values, so no legacy mapping
    // is needed — every membership already reads as ADMIN, CASHIER or
    // INVENTORY_USER.
    const role = orgUser.role;

    return {
      ...result,
      role,
      organizationId: orgUser.organizationId,
      organization: orgUser.organization,
      isSuperAdmin: false,
      // Only the primary owner may create admins; the team screen reads this.
      isPrimaryOwner: orgUser.isPrimaryOwner,
    };
  }

  async revokeOrganizationTokens(organizationId: string) {
    // Revocar tokens de todos los usuarios de la organización
    const orgUsers = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });

    const userIds = orgUsers.map((ou) => ou.userId);

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId: { in: userIds }, revokedAt: null },
        data: { revokedAt: new Date(), revocationCause: 'revoke-all' },
      }),
      this.prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    const { name, email } = updateProfileDto;

    if (email) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          email,
          NOT: { id: userId },
        },
      });

      if (existingUser) {
        throw new ConflictException('Email already in use');
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name }),
        ...(email && { email }),
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...result } = user;
    return result;
  }

  /**
   * Changes the password and revokes EVERY existing session (tokenVersion
   * bump + refresh-token revocation), then re-issues a token pair for the
   * calling session only — the same guarantee as the admin reset flow, so
   * a stolen refresh token cannot outlive the old password. The session
   * context (org/role) is only used to decide which pair to re-issue; the
   * membership is re-derived from the database, never from the claim.
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
    session?: { organizationId: string | null; role?: OrgRole | 'SUPER_ADMIN' },
    ipAddress?: string,
    userAgent?: string,
  ) {
    const { currentPassword, newPassword } = changePasswordDto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );

    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Kill every session (not just this one): revokeUserTokens bumps the
    // tokenVersion — invalidating all outstanding access JWTs — and revokes
    // every active refresh row. Its return value carries the bumped
    // tokenVersion, which is exactly what the re-issued pair needs.
    const updatedUser = await this.revokeUserTokens(userId);

    // Re-issue the caller's own session so the legitimate user stays signed
    // in while every other session dies (same pattern as login/selectOrg).
    if (updatedUser.isSuperAdmin || session?.role === 'SUPER_ADMIN') {
      const superAdminPair = await this.generateTokenPair(
        updatedUser,
        { organizationId: null, role: 'SUPER_ADMIN' as const },
        ipAddress,
        userAgent,
      );
      return { ...superAdminPair, message: 'Password changed successfully' };
    }

    if (session?.organizationId) {
      // DB truth, not the claim: the caller must still be a member of the
      // organization for its org/role pair to be embedded in the new token.
      const orgUser = await this.prisma.organizationUser.findFirst({
        where: {
          userId,
          organizationId: session.organizationId,
        },
      });

      if (orgUser) {
        const orgPair = await this.generateTokenPair(
          updatedUser,
          {
            organizationId: orgUser.organizationId,
            role: orgUser.role,
            isPrimaryOwner: orgUser.isPrimaryOwner,
          },
          ipAddress,
          userAgent,
        );
        return { ...orgPair, message: 'Password changed successfully' };
      }
    }

    // No org context to re-issue for (or the membership no longer exists):
    // return without tokens; the client re-authenticates on the next 401.
    return { message: 'Password changed successfully' };
  }

  async getUserOrganizations(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const userOrgs = await this.prisma.organizationUser.findMany({
      where: { userId },
      orderBy: { joinedAt: 'asc' },
      include: { organization: true },
    });

    return {
      organizations: userOrgs.map((uo) => ({
        id: uo.organizationId,
        name: uo.organization.name,
        role: uo.role,
        plan: uo.organization.plan,
        status: uo.organization.status,
      })),
    };
  }

  async selectOrg(userId: string, organizationId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const orgUser = await this.prisma.organizationUser.findFirst({
      where: {
        userId,
        organizationId,
      },
    });

    if (!orgUser) {
      throw new UnauthorizedException('Organization membership not found');
    }

    // Check organization status
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { status: true },
    });

    if (org?.status === OrgStatus.SUSPENDED) {
      throw new UnauthorizedException('Organization is suspended');
    }

    const updatedUser = await this.revokeUserTokens(userId);

    return this.generateTokenPair(updatedUser, orgUser);
  }
}
