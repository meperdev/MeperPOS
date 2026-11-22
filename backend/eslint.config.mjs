// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import meperpos from './eslint-plugin-meperpos/index.mjs';
import { prettierBaseline } from './eslint.baseline.mjs';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'eslint.baseline.mjs',
      'eslint-plugin-meperpos/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/unbound-method': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  // Local rules that encode bugs this repo already paid for. Always errors:
  // they are never baselined (see docs/bug-rule-log.md).
  {
    plugins: { meperpos },
    rules: {
      'meperpos/require-organization-guard': 'error',
    },
  },
  // Frozen formatting baseline: these pre-existing files report prettier as a
  // warning so `npm run lint:ci` can block. The list only shrinks.
  {
    files: prettierBaseline,
    rules: {
      'prettier/prettier': ['warn', { endOfLine: 'auto' }],
    },
  },
);
