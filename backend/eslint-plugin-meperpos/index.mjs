/**
 * Local ESLint plugin for the MeperPOS backend.
 *
 * Rules here encode bugs and footguns this repository has already paid for,
 * pushed up the trust stack from prose (AGENTS.md) into static analysis. It is
 * imported by relative path from eslint.config.mjs, so it is never published.
 * Every rule ships with RuleTester tests in ./tests (`npm run test:eslint-plugin`)
 * and an entry in docs/bug-rules/ (see docs/bug-rule-log.md).
 */
import requireOrganizationGuard from './rules/require-organization-guard.mjs';
import requireStringLengthBound from './rules/require-string-length-bound.mjs';

const plugin = {
  meta: { name: 'eslint-plugin-meperpos' },
  rules: {
    'require-organization-guard': requireOrganizationGuard,
    'require-string-length-bound': requireStringLengthBound,
  },
};

export default plugin;
