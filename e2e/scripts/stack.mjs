/**
 * The isolated MeperPOS stack shared by `npm run smoke` and `npm run explore`
 * (e2e/README.md):
 *
 *   1. start the dedicated Playwright Postgres (or use the CI service)
 *   2. wait until it accepts connections
 *   3. `prisma migrate deploy` + the deterministic smoke seed, against that DB only
 *   4. build and start backend + frontend on the smoke ports
 *   5. wait for both to answer
 *
 * and, on `down()`, stop the app processes and the Playwright Postgres (never
 * the dev one).
 *
 * Environment (all optional):
 *   SMOKE_DATABASE_URL   default postgresql://playwright:playwright@127.0.0.1:55433/meperpos_playwright
 *   SMOKE_BACKEND_PORT   default 3101
 *   SMOKE_FRONTEND_PORT  default 3100
 *   SMOKE_EXTERNAL_DB=1  the database is already running (CI service); do not
 *                        start or stop a container
 *   SMOKE_KEEP_DB=1      leave the Playwright container running afterwards
 *   SMOKE_SKIP_BUILD=1   reuse the previous smoke builds of backend/frontend
 */

import { spawn, spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { mkdirSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSmokeDatabase } from "./database-guard.mjs";

export const e2eDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(e2eDir, "..");
const backendDir = join(repoRoot, "backend");
const frontendDir = join(repoRoot, "frontend");
const composeFile = join(e2eDir, "docker-compose.yml");
const composeProject = "meperpos-playwright";

export const DEFAULT_DATABASE_URL =
  "postgresql://playwright:playwright@127.0.0.1:55433/meperpos_playwright";

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * @param {{ label?: string, logDir?: string, env?: NodeJS.ProcessEnv }} [options]
 */
export function createStack(options = {}) {
  const env = options.env ?? process.env;
  const label = options.label ?? "smoke";
  const logDir = options.logDir ?? join(e2eDir, "test-results", "smoke-logs");

  const databaseUrl = env.SMOKE_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const backendPort = Number(env.SMOKE_BACKEND_PORT ?? 3101);
  const frontendPort = Number(env.SMOKE_FRONTEND_PORT ?? 3100);
  const externalDb = env.SMOKE_EXTERNAL_DB === "1";
  const keepDb = env.SMOKE_KEEP_DB === "1";
  const skipBuild = env.SMOKE_SKIP_BUILD === "1";

  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const backendOrigin = `http://127.0.0.1:${backendPort}`;

  /** Children started by this run, stopped in reverse order on `down()`. */
  const children = [];
  let startedDb = false;
  let stopping = false;

  function log(message) {
    console.log(`[${label}] ${message}`);
  }

  /**
   * The environment every backend command gets. It is built explicitly, so a
   * developer's backend/.env (loaded by dotenv and ConfigModule, which never
   * override variables already set) cannot point any of them elsewhere. Both
   * URLs are pinned: prisma.config.ts reads DIRECT_URL for migrations.
   */
  function backendEnv() {
    return {
      ...env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
      PORT: String(backendPort),
      JWT_SECRET:
        env.SMOKE_JWT_SECRET ??
        "smoke-only-jwt-secret-0123456789abcdef0123456789",
      CORS_ORIGIN: [frontendUrl, `http://localhost:${frontendPort}`].join(","),
      // No outbound side effects from a smoke or explore run.
      STOCK_ALERTS_ENABLED: "false",
      REDIS_URL: "",
      WAHA_BASE_URL: "",
      WAHA_API_KEY: "",
      CLOUDINARY_CLOUD_NAME: "",
      CLOUDINARY_API_KEY: "",
      CLOUDINARY_API_SECRET: "",
      SUPER_ADMIN_PASSWORD: "",
    };
  }

  /**
   * The frontend talks to the API through its own origin (`/api` rewritten to
   * BACKEND_ORIGIN), the same shape as the deployed proxy. That keeps the auth
   * cookies first-party and the CSP `connect-src 'self'` satisfied on any port.
   */
  function frontendEnv() {
    return {
      ...env,
      NEXT_PUBLIC_API_URL: "/api",
      BACKEND_ORIGIN: backendOrigin,
      NEXT_TELEMETRY_DISABLED: "1",
    };
  }

  function run(command, args, runOptions) {
    log(`$ ${command} ${args.join(" ")}  (in ${runOptions.cwd})`);
    const result = spawnSync(command, args, { stdio: "inherit", ...runOptions });
    if (result.status !== 0) {
      throw new Error(
        `${command} ${args.join(" ")} failed with exit code ${result.status ?? result.signal}`,
      );
    }
  }

  function compose(args) {
    run("docker", ["compose", "-p", composeProject, "-f", composeFile, ...args], {
      cwd: e2eDir,
    });
  }

  function start(name, command, args, startOptions) {
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, `${name}.log`);
    const fd = openSync(logFile, "w");
    log(`starting ${name}: ${command} ${args.join(" ")}  (log: ${logFile})`);
    // Detached: the child leads its own process group, so stopping it also
    // stops whatever it spawned (next start forks a server process).
    const child = spawn(command, args, {
      ...startOptions,
      stdio: ["ignore", fd, fd],
      detached: true,
    });
    child.on("exit", (code, signal) => {
      if (!stopping) {
        log(`${name} exited early (code ${code ?? signal}); see ${logFile}`);
      }
    });
    children.push({ name, child });
    return child;
  }

  function stopChildren() {
    for (const { name, child } of children.reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      log(`stopping ${name}`);
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }

  async function assertPortFree(port) {
    await new Promise((done, fail) => {
      const server = createServer();
      server.once("error", () =>
        fail(
          new Error(
            `Port ${port} is already in use. Stop whatever listens there or set SMOKE_BACKEND_PORT / SMOKE_FRONTEND_PORT.`,
          ),
        ),
      );
      server.listen(port, "127.0.0.1", () => server.close(done));
    });
  }

  async function waitForTcp(host, port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const open = await new Promise((done) => {
        const socket = createConnection({ host, port });
        socket.once("connect", () => {
          socket.destroy();
          done(true);
        });
        socket.once("error", () => done(false));
      });
      if (open) return;
      await sleep(500);
    }
    throw new Error(`${host}:${port} did not accept connections in time`);
  }

  async function waitForHttp(name, url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { redirect: "manual" });
        if (response.status < 500) {
          log(`${name} is up (${url} -> ${response.status})`);
          return;
        }
      } catch {
        // Not listening yet.
      }
      await sleep(1000);
    }
    throw new Error(`${name} did not answer ${url} in time; see ${logDir}`);
  }

  /** Retries a command that only fails while Postgres is still booting. */
  async function runWithRetry(retryLabel, attempts, fn) {
    for (let attempt = 1; ; attempt++) {
      try {
        fn();
        return;
      } catch (error) {
        if (attempt >= attempts) throw error;
        log(`${retryLabel} failed (attempt ${attempt}/${attempts}); retrying`);
        await sleep(2000);
      }
    }
  }

  async function up() {
    assertSmokeDatabase(databaseUrl);
    const db = new URL(databaseUrl);
    log(`database: ${db.hostname}:${db.port}${db.pathname} (dedicated smoke DB)`);

    await assertPortFree(backendPort);
    await assertPortFree(frontendPort);

    // 1-2. Database. Recreated from scratch so every run sees the same data.
    if (!externalDb) {
      compose(["down", "--volumes", "--remove-orphans"]);
      startedDb = true;
      compose(["up", "--detach", "--wait"]);
    }
    await waitForTcp(db.hostname, Number(db.port), 60_000);

    // 3. Schema and seed, only against the guarded URL.
    const backend = backendEnv();
    await runWithRetry("prisma migrate deploy", 5, () =>
      run("npx", ["prisma", "migrate", "deploy"], { cwd: backendDir, env: backend }),
    );
    run("npx", ["ts-node", "prisma/seed-e2e.ts"], { cwd: backendDir, env: backend });

    // 4. Builds.
    if (!skipBuild) {
      run("npx", ["prisma", "generate"], { cwd: backendDir, env: backend });
      run("npx", ["nest", "build"], { cwd: backendDir, env: backend });
      run("npx", ["next", "build", "--webpack"], {
        cwd: frontendDir,
        env: frontendEnv(),
      });
    }

    start("backend", "node", ["dist/src/main.js"], { cwd: backendDir, env: backend });
    start(
      "frontend",
      "npx",
      ["next", "start", "-p", String(frontendPort), "-H", "127.0.0.1"],
      { cwd: frontendDir, env: frontendEnv() },
    );

    // 5. Health.
    await waitForHttp("backend", `${backendOrigin}/api/health`, 90_000);
    await waitForHttp("frontend", `${frontendUrl}/login`, 90_000);
    await waitForHttp("api proxy", `${frontendUrl}/api/health`, 30_000);

    return { frontendUrl, backendOrigin, logDir };
  }

  /** Idempotent: stops the app processes, then the smoke Postgres it started. */
  function down() {
    if (stopping) return;
    stopping = true;
    stopChildren();
    if (startedDb && !keepDb) {
      try {
        compose(["down", "--volumes", "--remove-orphans"]);
      } catch (error) {
        log(`could not stop the Playwright database: ${error.message}`);
      }
    }
  }

  return { up, down, log, frontendUrl, backendOrigin, logDir };
}
