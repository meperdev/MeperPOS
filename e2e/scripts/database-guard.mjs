/**
 * The smoke stack may only ever touch its own database.
 *
 * The developer database is `inventario_db` on port 5432
 * (backend/docker-compose.yml), and backend/prisma.config.ts falls back to it
 * when DATABASE_URL is unset. Every command the orchestrator runs against a
 * database goes through this check first, so a missing or mistyped URL stops
 * the run instead of migrating or seeding the wrong instance.
 */

export const SMOKE_DATABASE_NAME = "meperpos_playwright";
export const FORBIDDEN_DATABASE_NAMES = ["inventario_db"];
export const FORBIDDEN_PORTS = ["5432"];
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]", "::1"];

/**
 * Returns null when the URL is safe for the smoke stack, or the reason it is
 * not. Safe means: a postgres URL on a loopback host, a port other than 5432,
 * and exactly the smoke database name.
 */
export function smokeDatabaseProblem(rawUrl) {
  if (!rawUrl || rawUrl.trim() === "") return "DATABASE_URL is empty";
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return "DATABASE_URL is not a valid URL";
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return `unexpected protocol "${url.protocol}"`;
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const port = url.port || "5432";
  if (FORBIDDEN_DATABASE_NAMES.includes(database)) {
    return `database "${database}" is the developer database`;
  }
  if (database !== SMOKE_DATABASE_NAME) {
    return `database must be "${SMOKE_DATABASE_NAME}", got "${database}"`;
  }
  if (FORBIDDEN_PORTS.includes(port)) {
    return `port ${port} belongs to the developer database`;
  }
  if (!LOOPBACK_HOSTS.includes(url.hostname)) {
    return `host "${url.hostname}" is not a loopback address`;
  }
  return null;
}

export function assertSmokeDatabase(rawUrl) {
  const problem = smokeDatabaseProblem(rawUrl);
  if (problem) {
    throw new Error(`Refusing to use the database: ${problem}.`);
  }
}
