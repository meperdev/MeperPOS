import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from '../src/common/constants/security.constants';
import {
  MIN_SUPERADMIN_PASSWORD_LENGTH,
  normalizeSuperAdminEmail,
  planProvisioning,
} from '../src/provisioning/provisioning-plan';
import type { ProvisioningPlan } from '../src/provisioning/provisioning-plan';

/**
 * Production SuperAdmin provisioning CLI (issue #116 / AUDIT-FINDING-010,
 * criterion #2). Wired to the `provision:prod` npm script.
 *
 * Scope is deliberately one account and nothing else:
 *  - creates a single SuperAdmin from SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD, or
 *  - promotes an existing account only when SUPERADMIN_PROMOTE=true, or
 *  - resets the password of an existing SuperAdmin only when
 *    SUPERADMIN_RESET_PASSWORD=true, revoking its live sessions, or
 *  - does nothing when the account is already a SuperAdmin (idempotent).
 *
 * It never creates demo organizations, demo catalogs or demo users, never uses
 * faker, never prints the password, and exits non-zero on any refusal. The
 * organization itself is created separately through the SuperAdmin-only
 * POST /api/admin/organizations endpoint.
 *
 * The decision logic lives in ../src/provisioning/provisioning-plan.ts, so this
 * file only reads the environment, runs one database operation and reports it.
 */

const prisma = new PrismaClient();

const LOG_PREFIX = '[provision]';

async function findExistingUser(email: string) {
  if (!email) {
    return null;
  }

  // Case-insensitive on purpose: signup and the admin API store the address
  // exactly as typed, while provisioning normalizes to lowercase. An exact
  // match would miss an existing `Name@Example.com` account and create a
  // duplicate SuperAdmin instead of resetting the one the operator meant.
  const matches = await prisma.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, email: true, isSuperAdmin: true },
    take: 2,
  });

  // Email is unique only case-sensitively, so both rows can exist. Picking one
  // for a password change would be a guess; refuse and name them instead.
  if (matches.length > 1) {
    const found = matches.map((user) => user.email).join(', ');

    throw new Error(
      `more than one user matches ${email} ignoring case (${found}); pick the account to change by fixing the duplicate first`,
    );
  }

  return matches[0] ?? null;
}

async function execute(plan: ProvisioningPlan): Promise<number> {
  switch (plan.action) {
    case 'refuse': {
      console.error(`${LOG_PREFIX} refused (${plan.code}): ${plan.reason}`);
      return 1;
    }

    case 'noop': {
      console.log(
        `${LOG_PREFIX} noop: ${plan.email} is already a SuperAdmin (user ${plan.userId}). Nothing changed.`,
      );
      return 0;
    }

    case 'promote': {
      const promoted = await prisma.user.update({
        where: { id: plan.userId },
        data: { isSuperAdmin: true },
        select: { id: true, email: true },
      });

      console.log(
        `${LOG_PREFIX} promoted: existing user ${promoted.email} (${promoted.id}) is now a SuperAdmin. No password was changed.`,
      );
      return 0;
    }

    case 'create': {
      const name = process.env.SUPERADMIN_NAME?.trim() || 'Super Administrador';

      // Creating while other SuperAdmins exist is legitimate (rotation, a
      // separate owner account) but is also what happens when the operator
      // mistypes the address of the account whose password they lost. Naming
      // the existing accounts turns a silent second SuperAdmin into an
      // actionable message.
      const otherSuperAdmins = await prisma.user.findMany({
        where: { isSuperAdmin: true },
        select: { email: true },
        orderBy: { email: 'asc' },
      });

      if (otherSuperAdmins.length > 0) {
        const existingEmails = otherSuperAdmins
          .map((admin) => admin.email)
          .join(', ');

        console.warn(
          `${LOG_PREFIX} warning: ${otherSuperAdmins.length} SuperAdmin account(s) already exist: ${existingEmails}.`,
        );
        console.warn(
          `${LOG_PREFIX} this command is creating a NEW account; to replace the password of an existing one, run it again with its exact email in SUPERADMIN_EMAIL and SUPERADMIN_RESET_PASSWORD=true.`,
        );
      }

      // Hash with the shared cost factor; the plaintext never touches disk and
      // is never logged.
      const password = await bcrypt.hash(plan.password, BCRYPT_ROUNDS);

      const created = await prisma.user.create({
        data: {
          email: plan.email,
          name,
          password,
          isSuperAdmin: true,
          tokenVersion: 0,
        },
        select: { id: true, email: true },
      });

      console.log(
        `${LOG_PREFIX} created SuperAdmin ${created.email} (${created.id}) with a password of at least ${MIN_SUPERADMIN_PASSWORD_LENGTH} characters.`,
      );
      console.log(
        `${LOG_PREFIX} the password is intentionally not printed: retrieve it from the environment you set and store it in the team password manager.`,
      );
      return 0;
    }

    case 'reset-password': {
      // Hash with the shared cost factor; the plaintext never touches disk and
      // is never logged.
      const password = await bcrypt.hash(plan.password, BCRYPT_ROUNDS);

      const reset = await prisma.$transaction(async (tx) => {
        // Re-guarded on isSuperAdmin: the plan was computed from an earlier
        // read, and a lost password must never reset an ordinary account.
        const updated = await tx.user.updateMany({
          where: { id: plan.userId, isSuperAdmin: true },
          data: { password, tokenVersion: { increment: 1 } },
        });

        if (updated.count === 0) {
          return false;
        }

        // Mirrors AuthService.revokeUserTokens: the bumped tokenVersion kills
        // every access token, and revoking the stored refresh tokens kills the
        // sessions that could otherwise mint new ones.
        await tx.refreshToken.updateMany({
          where: { userId: plan.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        return true;
      });

      if (!reset) {
        console.error(
          `${LOG_PREFIX} refused (RESET_TARGET_NOT_SUPERADMIN): user ${plan.userId} is no longer a SuperAdmin. Nothing changed.`,
        );
        return 1;
      }

      console.log(
        `${LOG_PREFIX} reset: password replaced for SuperAdmin ${plan.email} (${plan.userId}); tokenVersion incremented and active refresh tokens revoked, so earlier sessions are signed out.`,
      );
      console.log(
        `${LOG_PREFIX} the password is intentionally not printed: retrieve it from the environment you set and store it in the team password manager.`,
      );
      return 0;
    }

    default: {
      const unexpected: never = plan;
      throw new Error(
        `unhandled provisioning action: ${JSON.stringify(unexpected)}`,
      );
    }
  }
}

async function run(): Promise<void> {
  try {
    const email = normalizeSuperAdminEmail(process.env.SUPERADMIN_EMAIL);

    const plan = planProvisioning({
      email,
      password: process.env.SUPERADMIN_PASSWORD,
      promoteExistingUser: process.env.SUPERADMIN_PROMOTE === 'true',
      resetPassword: process.env.SUPERADMIN_RESET_PASSWORD === 'true',
      existingUser: await findExistingUser(email),
    });

    process.exitCode = await execute(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void run();
