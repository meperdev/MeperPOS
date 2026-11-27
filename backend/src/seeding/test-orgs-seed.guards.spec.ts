import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkDisposableDatabaseUrl } from './disposable-database';

/**
 * The guards are the only thing standing between a mistyped command and a
 * production database, so they are exercised as a real process instead of a
 * mock. Every probe below exits before the CLI opens a database connection,
 * which is why none of them passes DATABASE_URL.
 */
const backendRoot = path.resolve(__dirname, '../..');
const cli = path.join(backendRoot, 'prisma', 'seed-test-orgs.ts');
const tsNode = path.join(backendRoot, 'node_modules', '.bin', 'ts-node');

const SECRET = 'Clave-De-Prueba-2026';

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(overrides: NodeJS.ProcessEnv, args: string[] = []): RunResult {
  try {
    const stdout = execFileSync(tsNode, [cli, ...args], {
      cwd: backendRoot,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? '',
        ...overrides,
      },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

describe('test organizations seed CLI guards', () => {
  it('refuses production without SEED_ALLOW_NON_DEV', () => {
    const result = run({ NODE_ENV: 'production' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SEED_ALLOW_NON_DEV=true');
  });

  it('refuses an unknown argument instead of ignoring the typo', () => {
    const result = run(
      { NODE_ENV: 'development', SEED_TEST_ORG_PASSWORD: SECRET },
      ['--aply'],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown argument --aply');
  });

  it('refuses --apply together with --verify', () => {
    const result = run(
      {
        NODE_ENV: 'development',
        SEED_TEST_ORG_PASSWORD: SECRET,
      },
      ['--apply', '--verify'],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--apply and --verify cannot be combined');
  });

  it('requires a 12+ character password for --apply', () => {
    const missing = run({ NODE_ENV: 'development' }, ['--apply']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('at least 12 characters');

    const short = run(
      { NODE_ENV: 'development', SEED_TEST_ORG_PASSWORD: 'corta' },
      ['--apply'],
    );
    expect(short.status).toBe(1);
    expect(short.stderr).toContain('at least 12 characters');
  });

  it('refuses to read the password from two sources at once', () => {
    const file = path.join(os.tmpdir(), `seed-test-orgs-pw-${process.pid}`);
    fs.writeFileSync(file, SECRET);
    fs.chmodSync(file, 0o600);

    try {
      const result = run(
        {
          NODE_ENV: 'development',
          SEED_TEST_ORG_PASSWORD: SECRET,
          SEED_TEST_ORG_PASSWORD_FILE: file,
        },
        ['--apply'],
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('never both');
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('rejects a group- or world-readable password file', () => {
    if (process.platform === 'win32') return;

    const file = path.join(
      os.tmpdir(),
      `seed-test-orgs-pw-open-${process.pid}`,
    );
    fs.writeFileSync(file, SECRET);
    fs.chmodSync(file, 0o644);

    try {
      const result = run(
        {
          NODE_ENV: 'development',
          SEED_TEST_ORG_PASSWORD_FILE: file,
        },
        ['--apply'],
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('readable by other accounts');
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('refuses a password with surrounding whitespace', () => {
    const result = run(
      {
        NODE_ENV: 'development',
        SEED_TEST_ORG_PASSWORD: ` ${SECRET} `,
        SUPER_ADMIN_PASSWORD: SECRET,
      },
      ['--apply'],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('whitespace');
  });

  it('writes nothing by default and prints both organizations', () => {
    const result = run({ NODE_ENV: 'development' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('dry run');
    expect(result.stdout).toContain('Prueba PRO');
    expect(result.stdout).toContain('Prueba BASIC');
    expect(result.stdout).toContain('--apply');
  });

  it('never prints the seed password', () => {
    const result = run({
      NODE_ENV: 'development',
      SEED_TEST_ORG_PASSWORD: SECRET,
      SUPER_ADMIN_PASSWORD: SECRET,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(SECRET);
    expect(result.stderr).not.toContain(SECRET);
  });

  it('requires SUPER_ADMIN_PASSWORD outside production before writing', () => {
    const result = run(
      { NODE_ENV: 'development', SEED_TEST_ORG_PASSWORD: SECRET },
      ['--apply'],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SUPER_ADMIN_PASSWORD');
    expect(result.stderr).toContain('at least 10 characters');
  });
});

describe('disposable database guard', () => {
  it('refuses an empty URL', () => {
    expect(checkDisposableDatabaseUrl(undefined).ok).toBe(false);
    expect(checkDisposableDatabaseUrl('').ok).toBe(false);
  });

  it('refuses the development database', () => {
    const result = checkDisposableDatabaseUrl(
      'postgresql://admin:admin123@localhost:5435/inventario_db',
    );
    expect(result.ok).toBe(false);
  });

  it('refuses the shared development port', () => {
    const result = checkDisposableDatabaseUrl(
      'postgresql://postgres@127.0.0.1:5432/tos',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('5432');
  });

  it('accepts a disposable container URL', () => {
    const result = checkDisposableDatabaseUrl(
      'postgresql://postgres@127.0.0.1:55441/tos',
    );
    expect(result).toEqual({ ok: true, database: 'tos' });
  });
});
