import { defineConfig } from "vitest/config";
import path from "node:path";
import { quarantineRegistry } from "./quarantine";

// Quarantined suites are governed by frontend/quarantine.ts — the exclude list
// is DERIVED from the registry so the config can never drift from it. Entries
// belong there only while genuinely broken; CI watchdog scripts/check-quarantine.mjs
// warns when a quarantined suite starts passing again so it can be restored.
const quarantinedFiles = quarantineRegistry.map((entry) => entry.file);

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    exclude: [
      ...quarantinedFiles,
      // ESLint plugin RuleTester suites run under node:test via
      // `npm run test:eslint-plugin`, not under Vitest.
      "eslint-plugin-meperpos/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
