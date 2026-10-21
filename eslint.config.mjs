import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      // Prototype kept for reference only.
      'legacy/**',
      // ExtendScript is ES3 and has its own restrictions; linting it needs a dedicated config.
      'packages/panel/host/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Plain Node scripts (build tools, diagnostics) run outside the browser.
    files: ['scripts/**/*.mjs', 'packages/*/build.mjs', 'packages/*/test/**/*.mjs', 'vitest.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
