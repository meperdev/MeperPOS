/**
 * Jest suites never write to the local development database.
 *
 * `npm test` loads `.env.development`, whose DATABASE_URL names the developer's
 * own database. Integration suites that keep their rows as evidence (financed POS,
 * stock rehearsals) used to leave organizations such as "T4i active" there, so
 * the database people log into filled up with fixtures. The jest global setup
 * (`test/global-setup.ts`) moves such a URL to TEST_DATABASE on the same server,
 * the database CI already uses, and migrates it before any suite starts.
 */

/** The database `.env.development` points at and developers log into. */
export const DEVELOPMENT_DATABASE = 'inventario_db';

/** Where suites run instead: same server and credentials, the name CI uses. */
export const TEST_DATABASE = 'meperpos_test';

/**
 * The test-database URL for a URL that names the development database, or
 * `undefined` when the URL already points somewhere else (CI, a disposable
 * container) or cannot be read.
 */
export function redirectFromDevelopmentDatabase(
  url: string | undefined,
): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (database !== DEVELOPMENT_DATABASE) return undefined;
  parsed.pathname = `/${TEST_DATABASE}`;
  return parsed.toString();
}
