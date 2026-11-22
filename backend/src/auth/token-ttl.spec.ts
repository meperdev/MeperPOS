import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { OrgRole, OrgStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { ACCESS_TOKEN_TTL_MS } from './auth.constants';
import { ACCESS_TOKEN_COOKIE, buildAuthCookies } from './cookies.helper';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('bcryptjs');

/**
 * Access-token TTL contract (issue #48, spec 3.R1).
 *
 * Uses a REAL JwtService so the signed token's actual exp−iat is decoded and
 * asserted — not the literal passed to sign(). The ceiling is 30 minutes
 * (1800 seconds) per the spec; the exact value is a design decision (D1).
 */
describe('Access token TTL — 30-minute ceiling (spec 3.R1)', () => {
  let service: AuthService;
  let jwtService: JwtService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    organizationUser: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: JwtService,
          useValue: new JwtService({ secret: 'ttl-test-secret' }),
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /** Runs the single-organization login path and returns the issued pair. */
  async function loginSingleOrg(): Promise<{ accessToken: string }> {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'ttl@example.com',
      name: 'TTL User',
      password: 'hashed-password',
      tokenVersion: 0,
      active: true,
      isSuperAdmin: false,
    });
    mockPrisma.organizationUser.findMany.mockResolvedValue([
      {
        organizationId: 'org-1',
        role: OrgRole.ADMIN,
        organization: { status: OrgStatus.ACTIVE },
      },
    ]);
    mockPrisma.refreshToken.create.mockResolvedValue({});

    return service.login({
      email: 'ttl@example.com',
      password: 'password123',
    });
  }

  it('signs access tokens with exp−iat ≤ 1800 seconds (30-minute ceiling)', async () => {
    const result = await loginSingleOrg();

    const payload = jwtService.verify<{ exp: number; iat: number }>(
      result.accessToken,
    );

    expect(payload.exp - payload.iat).toBeLessThanOrEqual(1800);
  });

  it('couples the signed JWT lifetime to ACCESS_TOKEN_TTL_MS (drift fails CI)', async () => {
    const result = await loginSingleOrg();

    const payload = jwtService.verify<{ exp: number; iat: number }>(
      result.accessToken,
    );

    expect(payload.exp - payload.iat).toBe(ACCESS_TOKEN_TTL_MS / 1000);
  });

  it('couples the access_token cookie maxAge to ACCESS_TOKEN_TTL_MS (mirror contract)', () => {
    const access = buildAuthCookies({
      accessToken: 'access-jwt',
      refreshToken: 'raw-refresh',
    }).find((c) => c.name === ACCESS_TOKEN_COOKIE);

    expect(access?.options.maxAge).toBe(ACCESS_TOKEN_TTL_MS);
  });
});
