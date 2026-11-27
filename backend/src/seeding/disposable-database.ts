/**
 * Test-only guard for the database the PostgreSQL spec of the test-orgs seed
 * runs against.
 *
 * The seed creates organizations with real data, so an integration spec must
 * never point at `inventario_db` or at the shared development server on port
 * 5432. The helper is pure so the guard itself is unit-tested, and it is used
 * only by the spec: the CLI must keep working against the real production URL,
 * which does live on 5432.
 */

export interface DisposableTargetRefusal {
  ok: false;
  reason: string;
}

export interface DisposableTargetAcceptance {
  ok: true;
  database: string;
}

export type DisposableTargetCheck =
  | DisposableTargetRefusal
  | DisposableTargetAcceptance;

const FORBIDDEN_DATABASES = new Set(['inventario_db']);
const FORBIDDEN_PORT = '5432';

/** Refuses anything that is not a dedicated, disposable test database. */
export function checkDisposableDatabaseUrl(
  rawUrl: string | undefined | null,
): DisposableTargetCheck {
  const value = (rawUrl ?? '').trim();
  if (value.length === 0) {
    return { ok: false, reason: 'the database URL is empty' };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'the database URL cannot be parsed' };
  }

  const database = parsed.pathname.replace(/^\//, '');
  if (database.length === 0) {
    return { ok: false, reason: 'the database URL names no database' };
  }

  if (FORBIDDEN_DATABASES.has(database)) {
    return {
      ok: false,
      reason: `"${database}" is the development database and is never a test target`,
    };
  }

  if (parsed.port === FORBIDDEN_PORT) {
    return {
      ok: false,
      reason: `port ${FORBIDDEN_PORT} is the shared development server; point the spec at a disposable container`,
    };
  }

  return { ok: true, database };
}
