import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The guards are the only thing standing between a mistyped command and a
 * production database, so they are exercised as a real process instead of a
 * mock. Every probe below exits before the CLI opens a database connection.
 */
const backendRoot = path.resolve(__dirname, '../..');
const cli = path.join(backendRoot, 'prisma', 'seed-sandbox.ts');
const tsNode = path.join(backendRoot, 'node_modules', '.bin', 'ts-node');

function run(
  overrides: NodeJS.ProcessEnv,
  args: string[] = [],
): { status: number; stderr: string } {
  try {
    execFileSync(tsNode, [cli, ...args], {
      cwd: backendRoot,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? '',
        ...overrides,
      },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 60_000,
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { status: failure.status ?? -1, stderr: failure.stderr ?? '' };
  }
}

describe('sandbox seed CLI guards', () => {
  it('refuses production without SEED_ALLOW_NON_DEV', () => {
    const result = run({ NODE_ENV: 'production' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SEED_ALLOW_NON_DEV=true');
  });

  it('requires an explicit slug outside development', () => {
    const result = run({
      NODE_ENV: 'production',
      SEED_ALLOW_NON_DEV: 'true',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SEED_SANDBOX_SLUG is required');
  });

  it('requires a 12+ character password for --apply', () => {
    const result = run(
      { NODE_ENV: 'development', SEED_SANDBOX_SLUG: 'sandbox-probe' },
      ['--apply'],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('at least 12 characters');
  });

  it('rejects a group- or world-readable password file', () => {
    if (process.platform === 'win32') return;

    const file = path.join(os.tmpdir(), `sandbox-pw-${process.pid}`);
    fs.writeFileSync(file, 'abcdefghijk\n');
    fs.chmodSync(file, 0o644);

    try {
      const result = run(
        {
          NODE_ENV: 'development',
          SEED_SANDBOX_SLUG: 'sandbox-probe',
          SEED_DEMO_PASSWORD_FILE: file,
        },
        ['--apply'],
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('readable by other accounts');
    } finally {
      fs.unlinkSync(file);
    }
  });
});
