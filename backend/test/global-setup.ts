import { execFileSync } from 'node:child_process';
import path from 'node:path';

import {
  DEVELOPMENT_DATABASE,
  TEST_DATABASE,
  redirectFromDevelopmentDatabase,
} from '../src/testing/test-database';

/**
 * Runs once before every jest run. When DATABASE_URL names the development
 * database, suites run on TEST_DATABASE instead (see src/testing/test-database.ts).
 * Workers start after this function returns, so they inherit the new URL.
 *
 * A failed migration does not stop the run: unit suites need no database, and
 * integration suites then fail on their own connection. The URL never falls
 * back to the development database.
 */
export default function globalSetup(): void {
  const redirected = redirectFromDevelopmentDatabase(process.env.DATABASE_URL);
  if (!redirected) return;

  process.env.DATABASE_URL = redirected;
  const backendRoot = path.resolve(__dirname, '..');
  try {
    execFileSync(
      path.join(backendRoot, 'node_modules', '.bin', 'prisma'),
      ['migrate', 'deploy'],
      {
        cwd: backendRoot,
        env: process.env,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    process.stdout.write(
      `\n[jest] DATABASE_URL named ${DEVELOPMENT_DATABASE}; suites run on ${TEST_DATABASE} (migrated).\n`,
    );
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr: unknown }).stderr ?? '').trim()
        : '';
    process.stderr.write(
      `\n[jest] DATABASE_URL named ${DEVELOPMENT_DATABASE}; suites run on ${TEST_DATABASE}, ` +
        `but migrating it failed, so integration suites will fail.\n${stderr.split('\n').slice(-3).join('\n')}\n`,
    );
  }
}
