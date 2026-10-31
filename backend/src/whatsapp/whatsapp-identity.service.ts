import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { WhatsAppIdentity } from '@prisma/client';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A code the administrator has to read from the web app and type on a phone:
 * every character that survives that round trip is kept, and the four glyphs
 * that get confused (0/O, 1/I) are removed. 32 symbols is also a power of two,
 * so drawing one character costs no rejection sampling.
 */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LENGTH = 10;
export const LINK_CHALLENGE_TTL_MS = 10 * 60 * 1000;

/**
 * Draw a link code from the OS CSPRNG. `randomInt` is the cryptographic source
 * here: `Math.random` would let an observer predict a code that grants
 * administrative access. 32^10 ≈ 2^50 possible codes for a ten minute window.
 */
export function generateLinkCode(): string {
  let code = '';
  for (let index = 0; index < LINK_CODE_LENGTH; index += 1) {
    code += LINK_CODE_ALPHABET.charAt(randomInt(LINK_CODE_ALPHABET.length));
  }
  return code;
}

/**
 * Typing a code on a phone should not care about accidental case or whitespace
 * coming from the chat client. Normalising once, before hashing, is what makes
 * issue and consume agree on the same input.
 */
export function normaliseLinkCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Only the hash is ever persisted, chosen over bcrypt for a 10-minute secret. */
export function hashLinkCode(code: string): string {
  return createHash('sha256').update(normaliseLinkCode(code)).digest('hex');
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'P2002';

/** What a caller may know about its own identities; no user or org leakage. */
export interface WhatsAppIdentityView {
  id: string;
  phone: string;
  status: WhatsAppIdentity['status'];
  verifiedAt: Date | null;
  organizationId: string | null;
}

/**
 * Links a WhatsApp phone number to an authenticated MeperPOS user, and nothing
 * less: a phone number on its own grants nothing, and the link can only be
 * created by someone who already proved which user they are in the web app.
 *
 * The secret travels one way only. The code is returned once, in the HTTP
 * response to the authenticated owner; the database keeps a SHA-256 of it. No
 * method in this service logs the code, its hash, the phone, or the identity.
 */
@Injectable()
export class WhatsAppIdentityService {
  private readonly logger = new Logger(WhatsAppIdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issue a single-use code for the authenticated user. The plaintext exists in
   * this frame and in the response body; it is never written and never logged.
   */
  async issueChallenge(
    userId: string,
    organizationId: string,
  ): Promise<{ code: string; expiresAt: Date }> {
    const code = generateLinkCode();
    const codeHash = hashLinkCode(code);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // One live code per user: an older unconsumed challenge is retired in the
      // same transaction, so a code leaked earlier cannot be replayed after a
      // fresh one has been issued.
      await tx.whatsAppLinkChallenge.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: now },
      });

      const expiresAt = new Date(now.getTime() + LINK_CHALLENGE_TTL_MS);
      await tx.whatsAppLinkChallenge.create({
        data: { codeHash, userId, organizationId, expiresAt },
      });

      return { code, expiresAt };
    });
  }

  /**
   * Claim the challenge and bind its phone to the challenge's owner. An unknown,
   * expired, superseded or already consumed code all take the same path and
   * return the same null, so a sender cannot tell which one they got wrong.
   */
  async consume(phone: string, code: string): Promise<WhatsAppIdentity | null> {
    const codeHash = hashLinkCode(code);
    try {
      return await this.claim(codeHash, phone);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Two live codes for the same phone raced on the phone unique key: the
      // winner created the row, so the loser takes the update path. Retrying is
      // safe because losing rolled the claim back with the transaction.
      try {
        return await this.claim(codeHash, phone);
      } catch (retryError) {
        if (!isUniqueViolation(retryError)) throw retryError;
        this.logger.warn({
          event: 'whatsapp_identity',
          outcome: 'link_conflict',
        });
        return null;
      }
    }
  }

  private claim(
    codeHash: string,
    phone: string,
  ): Promise<WhatsAppIdentity | null> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Single use is enforced by the database, not by application code: this is
      // one UPDATE ... WHERE codeHash = ? AND consumedAt IS NULL AND
      // expiresAt > now. Postgres locks the matching row, so a concurrent
      // transaction waits, then re-checks the predicate against the committed
      // row, no longer matches, and reports count 0. There is no
      // read-then-write window here for two callers to slip through.
      const { count } = await tx.whatsAppLinkChallenge.updateMany({
        where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (count === 0) {
        this.logger.warn({
          event: 'whatsapp_identity',
          outcome: 'link_rejected',
        });
        return null;
      }

      const challenge = await tx.whatsAppLinkChallenge.findUnique({
        where: { codeHash },
        select: { userId: true, organizationId: true },
      });
      if (!challenge) return null;

      // The challenge decides who this phone becomes: it is bound to the user
      // who authenticated in the web app, never to whoever holds the phone. An
      // existing row is rebound in place, which is also what re-linking a
      // revoked number does.
      return tx.whatsAppIdentity.upsert({
        where: { phone },
        create: {
          phone,
          userId: challenge.userId,
          organizationId: challenge.organizationId,
          status: 'VERIFIED',
          verifiedAt: now,
        },
        update: {
          userId: challenge.userId,
          organizationId: challenge.organizationId,
          status: 'VERIFIED',
          verifiedAt: now,
          revokedAt: null,
        },
      });
    });
  }

  /**
   * The verified identity for a phone, only when it belongs to an organization
   * context. PENDING, REVOKED and organization-less rows answer null: an
   * administrative channel has to know whose data it may read, so an identity
   * without an organization is not usable here.
   */
  async verify(phone: string): Promise<WhatsAppIdentity | null> {
    return this.prisma.whatsAppIdentity.findFirst({
      where: { phone, status: 'VERIFIED', organizationId: { not: null } },
    });
  }

  /**
   * The gate's question: may this phone act administratively? Only through a
   * verified, organization-scoped identity. The eventual gate still has to check
   * the roles of `userId` inside `organizationId`; this only answers whether the
   * number is linked at all.
   */
  async mayActAdministratively(phone: string): Promise<boolean> {
    return (await this.verify(phone)) !== null;
  }

  /** The caller's own identities inside the caller's own organization. */
  list(
    userId: string,
    organizationId: string,
  ): Promise<WhatsAppIdentityView[]> {
    return this.prisma.whatsAppIdentity.findMany({
      where: { userId, organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phone: true,
        status: true,
        verifiedAt: true,
        organizationId: true,
      },
    });
  }

  /**
   * Revoke one of the caller's own links. The update is scoped by user and
   * organization as well as id, so a foreign identity id cannot be revoked and
   * an id that does not match anything is reported as not found.
   */
  async revoke(
    userId: string,
    organizationId: string,
    identityId: string,
  ): Promise<void> {
    const { count } = await this.prisma.whatsAppIdentity.updateMany({
      where: { id: identityId, userId, organizationId, status: 'VERIFIED' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('WhatsApp identity not found');
  }
}
