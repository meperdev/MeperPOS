import { defineConfig, devices } from "@playwright/test";
import { OWNER_STATE_FILE } from "./fixtures/paths";

/**
 * Smoke suite against a running MeperPOS stack (e2e/README.md).
 *
 * `npm run smoke` starts the isolated stack and sets SMOKE_BASE_URL; running
 * `npm run test:e2e:smoke` alone expects that stack to be up already.
 *
 * One worker, no retries: the tests share one seeded organization and one
 * rotating session, and a smoke test that only passes on retry is a flake to
 * fix, not to hide.
 */
const baseURL = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [
        ["list"],
        ["github"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ]
    : [
        ["list"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ],
  use: {
    baseURL,
    locale: "es-CO",
    timezoneId: "America/Bogota",
    // Desktop width: the POS cart panel and the sales table render at `lg`.
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: OWNER_STATE_FILE,
      },
    },
  ],
});
