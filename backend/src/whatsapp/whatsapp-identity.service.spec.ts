import { Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import {
  generateLinkCode,
  hashLinkCode,
  LINK_CHALLENGE_TTL_MS,
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  normaliseLinkCode,
  WhatsAppIdentityService,
} from './whatsapp-identity.service';

/**
 * The code generator must come from the OS CSPRNG. Replacing only that member
 * keeps `createHash` real, and lets the spec observe the draw without ever
 * producing a predictable code.
 */
jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});

interface ChallengeRow {
  id: string;
  codeHash: string;
  userId: string;
  organizationId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

interface IdentityRow {
  id: string;
  phone: string;
  userId: string;
  organizationId: string | null;
  status: 'PENDING' | 'VERIFIED' | 'REVOKED';
  verifiedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

interface Store {
  challenges: ChallengeRow[];
  identities: IdentityRow[];
}

/** The row-level predicates this service actually writes, and nothing more. */
function matches(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date) {
      return value instanceof Date && value.getTime() === condition.getTime();
    }
    if (typeof condition === 'object' && condition !== null) {
      const filter = condition as { not?: unknown; gt?: unknown };
      if ('not' in filter) return value !== filter.not;
      if ('gt' in filter) {
        return (
          value instanceof Date &&
          value.getTime() > (filter.gt as Date).getTime()
        );
      }
      throw new Error(`unsupported filter on ${key}`);
    }
    return value === condition;
  });
}

/**
 * A faithful Prisma stand-in: one in-memory table pair, the exact filters the
 * service writes, and a transaction that restores its snapshot when the callback
 * throws. Rows are copied with a spread rather than `structuredClone`, which
 * rebuilds `Date` in the host realm and would defeat `instanceof Date`.
 */
function fakePrisma() {
  const store: Store = { challenges: [], identities: [] };
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${(sequence += 1)}`;
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const snapshot = (): Store => ({
    challenges: store.challenges.map((row) => ({ ...row })),
    identities: store.identities.map((row) => ({ ...row })),
  });

  const challenge = {
    create: jest.fn(
      async ({
        data,
      }: {
        data: Omit<ChallengeRow, 'id' | 'consumedAt' | 'createdAt'>;
      }) => {
        const row: ChallengeRow = {
          id: nextId('challenge'),
          consumedAt: null,
          createdAt: new Date(),
          ...data,
        };
        store.challenges.push(row);
        return row;
      },
    ),
    /**
     * Deliberately asynchronous before it matches and writes: two callers
     * interleave, then each applies the predicate and the write with no await in
     * between — the row-level atomicity of the real single UPDATE.
     */
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<ChallengeRow>;
      }) => {
        await tick();
        let count = 0;
        for (const row of store.challenges) {
          if (!matches(row as unknown as Record<string, unknown>, where)) {
            continue;
          }
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    ),
    findUnique: jest.fn(
      async ({ where }: { where: { codeHash: string } }) =>
        store.challenges.find((row) => row.codeHash === where.codeHash) ?? null,
    ),
  };

  const identity = {
    upsert: jest.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { phone: string };
        create: Partial<IdentityRow> & { phone: string };
        update: Partial<IdentityRow>;
      }) => {
        const existing = store.identities.find(
          (row) => row.phone === where.phone,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = {
          id: nextId('identity'),
          organizationId: null,
          status: 'PENDING',
          verifiedAt: null,
          revokedAt: null,
          createdAt: new Date(),
          ...create,
        } as IdentityRow;
        store.identities.push(row);
        return row;
      },
    ),
    findFirst: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        store.identities.find((row) =>
          matches(row as unknown as Record<string, unknown>, where),
        ) ?? null,
    ),
    findMany: jest.fn(
      async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => {
        const rows = store.identities
          .filter((row) =>
            matches(row as unknown as Record<string, unknown>, where),
          )
          .sort(
            (left, right) =>
              right.createdAt.getTime() - left.createdAt.getTime(),
          );
        if (!select) return rows;
        return rows.map((row) =>
          Object.fromEntries(
            Object.keys(select).map((key) => [
              key,
              (row as unknown as Record<string, unknown>)[key],
            ]),
          ),
        );
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<IdentityRow>;
      }) => {
        let count = 0;
        for (const row of store.identities) {
          if (!matches(row as unknown as Record<string, unknown>, where)) {
            continue;
          }
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    ),
  };

  const client = {
    whatsAppLinkChallenge: challenge,
    whatsAppIdentity: identity,
  };

  const prisma = {
    ...client,
    $transaction: jest.fn(
      async (
        run: (tx: typeof client) => Promise<unknown>,
      ): Promise<unknown> => {
        const before = snapshot();
        try {
          return await run(client);
        } catch (error) {
          store.challenges = before.challenges;
          store.identities = before.identities;
          throw error;
        }
      },
    ),
  };

  const service = new WhatsAppIdentityService(
    prisma as unknown as PrismaService,
  );
  return { prisma, client, store, service };
}

const PHONE = '573001112233';
const OTHER_PHONE = '573009998877';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('WhatsAppIdentityService', () => {
  describe('issueChallenge', () => {
    it('issues a ten character code from the unambiguous alphabet', async () => {
      const { service } = fakePrisma();

      const { code } = await service.issueChallenge('user-1', 'org-a');

      expect(code).toHaveLength(LINK_CODE_LENGTH);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
      // Nothing that survives a spoken or hand-typed round trip is confusable.
      expect(code).not.toMatch(/[0O1I]/);
      expect(LINK_CODE_ALPHABET).not.toMatch(/[0O1I]/);
      expect(LINK_CODE_ALPHABET).toHaveLength(32);
    });

    it('draws every character from the cryptographic source', async () => {
      const { randomInt } = jest.requireMock<{ randomInt: jest.Mock }>(
        'crypto',
      );
      const mathRandom = jest.spyOn(Math, 'random');
      const { service } = fakePrisma();
      randomInt.mockClear();
      try {
        await service.issueChallenge('user-1', 'org-a');

        expect(randomInt).toHaveBeenCalledTimes(LINK_CODE_LENGTH);
        for (const call of randomInt.mock.calls) {
          expect(call[0]).toBe(LINK_CODE_ALPHABET.length);
        }
        expect(mathRandom).not.toHaveBeenCalled();
      } finally {
        mathRandom.mockRestore();
      }
    });

    it('stores only the hash of the code', async () => {
      const { service, store } = fakePrisma();

      const { code } = await service.issueChallenge('user-1', 'org-a');

      expect(store.challenges).toHaveLength(1);
      expect(store.challenges[0].codeHash).toBe(sha256(code));
      // The plaintext code exists nowhere in the persisted state.
      expect(JSON.stringify(store)).not.toContain(code);
    });

    it('expires the code ten minutes after it is issued', async () => {
      const { service, store } = fakePrisma();

      const { expiresAt } = await service.issueChallenge('user-1', 'org-a');

      expect(store.challenges[0].expiresAt.getTime()).toBe(expiresAt.getTime());
      const remaining = expiresAt.getTime() - Date.now();
      expect(remaining).toBeGreaterThan(LINK_CHALLENGE_TTL_MS - 5_000);
      expect(remaining).toBeLessThanOrEqual(LINK_CHALLENGE_TTL_MS);
    });

    it('supersedes the previous unconsumed challenge of the same user', async () => {
      const { service, store } = fakePrisma();
      const first = await service.issueChallenge('user-1', 'org-a');
      const second = await service.issueChallenge('user-1', 'org-a');

      expect(store.challenges).toHaveLength(2);
      expect(store.challenges[0].consumedAt).toBeInstanceOf(Date);
      expect(store.challenges[1].consumedAt).toBeNull();
      await expect(service.consume(PHONE, first.code)).resolves.toBeNull();
      await expect(service.consume(PHONE, second.code)).resolves.not.toBeNull();
    });

    it('supersedes per user, leaving another user challenge alive', async () => {
      const { service } = fakePrisma();
      const mine = await service.issueChallenge('user-1', 'org-a');
      const theirs = await service.issueChallenge('user-2', 'org-a');

      await expect(
        service.consume(OTHER_PHONE, theirs.code),
      ).resolves.not.toBeNull();
      await expect(service.consume(PHONE, mine.code)).resolves.not.toBeNull();
    });
  });

  describe('consume', () => {
    it('binds the phone to the user who owns the challenge', async () => {
      const { service, store } = fakePrisma();
      const { code } = await service.issueChallenge('user-1', 'org-a');

      const identity = await service.consume(PHONE, code);

      expect(identity).toMatchObject({
        phone: PHONE,
        userId: 'user-1',
        organizationId: 'org-a',
        status: 'VERIFIED',
      });
      expect(identity?.verifiedAt).toBeInstanceOf(Date);
      expect(store.identities).toHaveLength(1);
    });

    it('claims with one conditional update before reading the challenge', async () => {
      const { service, client } = fakePrisma();
      const { code } = await service.issueChallenge('user-1', 'org-a');
      client.whatsAppLinkChallenge.updateMany.mockClear();
      client.whatsAppLinkChallenge.findUnique.mockClear();

      await service.consume(PHONE, code);

      // Single use rests on this one row lock, not on a read-then-write window.
      expect(client.whatsAppLinkChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          codeHash: hashLinkCode(code),
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { consumedAt: expect.any(Date) },
      });
      const claim =
        client.whatsAppLinkChallenge.updateMany.mock.invocationCallOrder[0];
      const read =
        client.whatsAppLinkChallenge.findUnique.mock.invocationCallOrder[0];
      expect(claim).toBeLessThan(read);
    });

    it('accepts a code typed with stray case and whitespace', async () => {
      const { service } = fakePrisma();
      const { code } = await service.issueChallenge('user-1', 'org-a');

      await expect(
        service.consume(PHONE, `  ${code.toLowerCase()}\n`),
      ).resolves.not.toBeNull();
      expect(normaliseLinkCode('  ab2cd\n')).toBe('AB2CD');
    });

    it('gives up when the claim no longer matches anything', async () => {
      const { client, service, store } = fakePrisma();
      const { code } = await service.issueChallenge('user-1', 'org-a');
      client.whatsAppLinkChallenge.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await expect(service.consume(PHONE, code)).resolves.toBeNull();
      expect(store.identities).toEqual([]);
    });

    it('refuses a code that has expired', async () => {
      const { service, store } = fakePrisma();
      const { code } = await service.issueChallenge('user-1', 'org-a');
      // The row the claim will look at is already past its expiry.
      store.challenges[0].expiresAt = new Date(Date.now() - 1_000);

      await expect(service.consume(PHONE, code)).resolves.toBeNull();
      expect(store.identities).toEqual([]);
    });

    it('refuses an unknown code without writing an identity', async () => {
      const { service, store } = fakePrisma();
      await service.issueChallenge('user-1', 'org-a');

      await expect(service.consume(PHONE, 'ABCDEFGHJK')).resolves.toBeNull();
      expect(store.identities).toEqual([]);
    });

    it('claims at most one of two concurrent consumptions', async () => {
      const { service, store, client } = fakePrisma();
      const { code } = await service.issueChallenge('user-1', 'org-a');
      client.whatsAppLinkChallenge.updateMany.mockClear();

      const [first, second] = await Promise.all([
        service.consume(PHONE, code),
        service.consume(PHONE, code),
      ]);

      expect([first, second].filter((result) => result !== null)).toHaveLength(
        1,
      );
      expect(store.identities).toHaveLength(1);
      expect(store.challenges[0].consumedAt).toBeInstanceOf(Date);
      // Two attempts, two claims: exactly one of them won.
      expect(client.whatsAppLinkChallenge.updateMany).toHaveBeenCalledTimes(2);
    });

    it('re-links a revoked phone and verifies it again', async () => {
      const { service, store } = fakePrisma();
      const first = await service.issueChallenge('user-1', 'org-a');
      const linked = await service.consume(PHONE, first.code);
      await service.revoke('user-1', 'org-a', linked!.id);
      expect(store.identities[0].status).toBe('REVOKED');

      const second = await service.issueChallenge('user-2', 'org-b');
      const relinked = await service.consume(PHONE, second.code);

      // One row per phone, rebound to whoever redeemed the new challenge.
      expect(store.identities).toHaveLength(1);
      expect(relinked?.id).toBe(linked?.id);
      expect(relinked).toMatchObject({
        phone: PHONE,
        userId: 'user-2',
        organizationId: 'org-b',
        status: 'VERIFIED',
        revokedAt: null,
      });
      expect(relinked?.verifiedAt).toBeInstanceOf(Date);
    });

    it('retries once when two live codes race for the same phone', async () => {
      const { service, client, store } = fakePrisma();
      // The losing upsert breaks the phone unique key and takes its claim back
      // with it, so the retry has to redeem the same challenge again.
      client.whatsAppIdentity.upsert.mockRejectedValueOnce({ code: 'P2002' });
      const { code } = await service.issueChallenge('user-1', 'org-a');

      const identity = await service.consume(PHONE, code);

      expect(identity).toMatchObject({ phone: PHONE, status: 'VERIFIED' });
      expect(store.identities).toHaveLength(1);
      expect(client.whatsAppIdentity.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('verify', () => {
    it('returns the verified identity that carries an organization', async () => {
      const { service } = fakePrisma();
      const { code } = await service.issueChallenge('user-1', 'org-a');
      await service.consume(PHONE, code);

      const identity = await service.verify(PHONE);

      expect(identity).toMatchObject({
        phone: PHONE,
        userId: 'user-1',
        organizationId: 'org-a',
        status: 'VERIFIED',
      });
    });

    it('returns null for pending, revoked and organization-less identities', async () => {
      const { service, store } = fakePrisma();
      store.identities.push(
        {
          id: 'i-pending',
          phone: PHONE,
          userId: 'user-1',
          organizationId: 'org-a',
          status: 'PENDING',
          verifiedAt: null,
          revokedAt: null,
          createdAt: new Date(),
        },
        {
          id: 'i-revoked',
          phone: OTHER_PHONE,
          userId: 'user-1',
          organizationId: 'org-a',
          status: 'REVOKED',
          verifiedAt: new Date(),
          revokedAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: 'i-scope-less',
          phone: '573005554433',
          userId: 'user-1',
          organizationId: null,
          status: 'VERIFIED',
          verifiedAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
        },
      );

      await expect(service.verify(PHONE)).resolves.toBeNull();
      await expect(service.verify(OTHER_PHONE)).resolves.toBeNull();
      await expect(service.verify('573005554433')).resolves.toBeNull();
      await expect(service.verify('573000000000')).resolves.toBeNull();
    });

    it('answers the administrative question only for a verified identity', async () => {
      const { service } = fakePrisma();
      const { code } = await service.issueChallenge('user-1', 'org-a');

      await expect(service.mayActAdministratively(PHONE)).resolves.toBe(false);
      await service.consume(PHONE, code);
      await expect(service.mayActAdministratively(PHONE)).resolves.toBe(true);

      const identity = await service.verify(PHONE);
      await service.revoke('user-1', 'org-a', identity!.id);
      await expect(service.mayActAdministratively(PHONE)).resolves.toBe(false);
    });
  });

  describe('list', () => {
    it('lists only the caller identities inside the caller organization', async () => {
      const { service, store } = fakePrisma();
      const first = await service.issueChallenge('user-1', 'org-a');
      await service.consume(PHONE, first.code);
      const other = await service.issueChallenge('user-2', 'org-a');
      await service.consume(OTHER_PHONE, other.code);

      const mine = await service.list('user-1', 'org-a');

      expect(mine).toHaveLength(1);
      expect(mine[0]).toEqual({
        id: store.identities[0].id,
        phone: PHONE,
        status: 'VERIFIED',
        verifiedAt: expect.any(Date),
        organizationId: 'org-a',
      });
      await expect(service.list('user-1', 'org-b')).resolves.toEqual([]);
    });
  });

  describe('revoke', () => {
    it('revokes an identity the caller owns inside its organization', async () => {
      const { service, store, client } = fakePrisma();
      const { code } = await service.issueChallenge('user-1', 'org-a');
      const identity = await service.consume(PHONE, code);
      client.whatsAppIdentity.updateMany.mockClear();

      await service.revoke('user-1', 'org-a', identity!.id);

      expect(client.whatsAppIdentity.updateMany).toHaveBeenCalledWith({
        where: {
          id: identity!.id,
          userId: 'user-1',
          organizationId: 'org-a',
          status: 'VERIFIED',
        },
        data: { status: 'REVOKED', revokedAt: expect.any(Date) },
      });
      expect(store.identities[0].status).toBe('REVOKED');
      expect(store.identities[0].revokedAt).toBeInstanceOf(Date);
    });

    it('refuses an identity owned by another user or another organization', async () => {
      const { service, store } = fakePrisma();
      const { code } = await service.issueChallenge('user-1', 'org-a');
      const identity = await service.consume(PHONE, code);

      await expect(
        service.revoke('user-2', 'org-a', identity!.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.revoke('user-1', 'org-b', identity!.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.revoke('user-1', 'org-a', 'identity-unknown'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(store.identities[0].status).toBe('VERIFIED');
      expect(store.identities[0].revokedAt).toBeNull();
    });
  });

  describe('logging', () => {
    it('never logs the code, its hash, the phone or the identity', async () => {
      const levels = ['log', 'warn', 'error', 'debug', 'verbose'] as const;
      const spies = levels.map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
      );
      try {
        const { service, store } = fakePrisma();
        const { code } = await service.issueChallenge('user-1', 'org-a');
        const identity = await service.consume(PHONE, code);
        // Rejections are the noisy path: a wrong, replayed or unknown code must
        // not write what was attempted either.
        await service.consume(PHONE, code);
        await service.consume(OTHER_PHONE, 'ABCDEFGHJK');

        const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));

        expect(logged).not.toContain(code);
        expect(logged).not.toContain(sha256(code));
        expect(logged).not.toContain(PHONE);
        expect(logged).not.toContain(OTHER_PHONE);
        expect(logged).not.toContain(identity!.id);
        expect(JSON.stringify(store)).not.toContain(code);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });

    it('generates different codes for different challenges', () => {
      const codes = new Set(
        Array.from({ length: 32 }, () => generateLinkCode()),
      );
      expect(codes.size).toBe(32);
    });
  });
});
