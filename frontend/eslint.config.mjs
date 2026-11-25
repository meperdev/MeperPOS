import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import meperpos from "./eslint-plugin-meperpos/index.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Local rules that encode bugs this repo already paid for. Always errors:
  // they are never baselined (see docs/bug-rule-log.md).
  {
    plugins: { meperpos },
    rules: {
      "meperpos/no-raw-api-error-message": "error",
    },
  },
  // Lint baseline (trust stack Phase 1, see docs/bug-rule-log.md). When
  // `npm run lint:ci` became a blocking CI step these three files already
  // failed the React Compiler rules below (5 errors on master ca23465). Fixing
  // them changes render behavior, so here only they report as warnings; every
  // other file keeps them as errors. This block may only shrink: fix a file,
  // delete its line, run `npm run lint:ci`. Never add a file to it.
  {
    files: [
      "src/app/inventory/page.tsx",
      "src/app/pos/page.tsx",
      "src/components/ui/ImageUpload.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  {
    files: ["src/app/pos/page.tsx"],
    rules: { "react-hooks/refs": "warn" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
