// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'test/fixtures/**',
      'scripts/**',
      '.claude/**',
      '.agents/**',
      '.idea/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md hard rule 3: strict, no escape hatches. Unknown shapes are parsed, not cast.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Everything goes through Nest's Logger so redaction stays in one place.
      'no-console': 'error',
      // Module-level helpers are arrow functions assigned to const.
      'func-style': ['error', 'expression'],
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['src/common/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/providers/**', '**/pipeline/**', '**/chat/**'],
              allowTypeImports: true,
              message:
                'src/common may only type-import from feature layers; a value import inverts the layering.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/providers/**/*.ts', 'src/pipeline/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/chat/**'],
              allowTypeImports: true,
              message:
                'providers/pipeline may only type-import from chat; a value import inverts the layering.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/providers/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/chat/**', '**/pipeline/**'],
              allowTypeImports: true,
              message:
                'providers may only type-import from chat and pipeline; a value import inverts the layering.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.node,
    },
  },
  prettier,
);
