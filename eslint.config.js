const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['coverage/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest }
    },
    rules: {
      'no-console': 'off', // Allow console in server applications
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'preserve-caught-error': 'off', // Upstream errors are rewritten so they can't carry a URL with its API token
      'prefer-const': 'error',
      'no-var': 'error',
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
      'comma-dangle': ['error', 'never'],
      'eol-last': 'error',
      'no-trailing-spaces': 'error',
      indent: ['error', 2, { SwitchCase: 0 }],
      'max-len': ['warn', { code: 120 }]
    }
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser }
    }
  }
];
