/**
 * Local ESLint plugin for the MeperPOS frontend.
 *
 * Rules here encode bugs and footguns this repository has already paid for,
 * pushed up the trust stack from prose (AGENTS.md) into static analysis. It is
 * imported by relative path from eslint.config.mjs, so it is never published.
 * Every rule ships with RuleTester tests in ./tests (`npm run test:eslint-plugin`)
 * and an entry in docs/bug-rules/ (see docs/bug-rule-log.md).
 */
import noRawApiErrorMessage from "./rules/no-raw-api-error-message.mjs";

const plugin = {
  meta: { name: "eslint-plugin-meperpos" },
  rules: {
    "no-raw-api-error-message": noRawApiErrorMessage,
  },
};

export default plugin;
