import { OrgStatus, PrismaClient } from '@prisma/client';
import { TRIAL_DAYS } from '../src/common/constants/trial.constants';

/**
 * Gives every TRIAL organization without a deadline the window it should have
 * had when it was created. Dry run by default: pass --apply to write.
 *
 *   npm run backfill:trial-ends
 *   npm run backfill:trial-ends -- --apply
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const organizations = await prisma.organization.findMany({
    where: { status: OrgStatus.TRIAL, trialEndsAt: null },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const organization of organizations) {
    const deadline = new Date(
      organization.createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
    );

    console.log(
      `${apply ? 'SET' : 'DRY'} ${organization.name} (${organization.id}) -> ${deadline.toISOString()}`,
    );

    if (apply) {
      await prisma.organization.update({
        where: { id: organization.id },
        data: { trialEndsAt: deadline },
      });
    }
  }

  console.log(
    `${organizations.length} TRIAL organizations without a deadline${apply ? ' updated' : ' (dry run)'}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
