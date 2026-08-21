import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'vendor/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.node,
        L: 'readonly',
        html2pdf: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['js/app.js'],
    rules: {
      'no-case-declarations': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'no-useless-escape': 'off',
      'preserve-caught-error': 'off'
    }
  },
];
