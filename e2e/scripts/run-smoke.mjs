#!/usr/bin/env node
/**
 * One-command smoke run (e2e/README.md): start the isolated stack
 * (scripts/stack.mjs), run Playwright, then stop the app processes and the
 * Playwright Postgres (never the dev one).
 *
 * The stack's environment variables (SMOKE_DATABASE_URL, SMOKE_*_PORT,
 * SMOKE_EXTERNAL_DB, SMOKE_KEEP_DB, SMOKE_SKIP_BUILD) are documented in
 * scripts/stack.mjs. Extra arguments are passed to `playwright test`.
 */

import { spawnSync } from "node:child_process";
import { createStack, e2eDir } from "./stack.mjs";

const playwrightArgs = process.argv.slice(2);
const stack = createStack({ label: "smoke" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stack.down();
    process.exit(130);
  });
}

async function main() {
  const { frontendUrl } = await stack.up();

  // 6. Playwright.
  const result = spawnSync("npx", ["playwright", "test", ...playwrightArgs], {
    cwd: e2eDir,
    stdio: "inherit",
    env: { ...process.env, SMOKE_BASE_URL: frontendUrl },
  });
  return result.status ?? 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error(`[smoke] ${error.message}`);
  exitCode = 1;
} finally {
  stack.down();
}
process.exit(exitCode);
