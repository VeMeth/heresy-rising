/**
 * Flat ESLint config covering the plain-JS subprojects (bot-manager,
 * heresy-server, heresy-sim). heresy-client's .vue files are out of scope —
 * linting them needs eslint-plugin-vue/vue-eslint-parser, which this offline
 * environment cannot fetch; its plain .js files are still covered below.
 */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/_site/**',
      'heresy-sim/sim-results/**',
      'sim-results/**',
      'data/**',
      'test-results/**',
      'generated/**',
      'site/**',
      'heresy-client/src/**/*.vue',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': ['error', { allow: ['error', 'warn', 'info'] }],
    },
  },
  {
    // CLI tools whose actual output contract *is* stdout printing —
    // not debug logging residue.
    files: [
      'heresy-sim/src/index.js',
      'heresy-sim/src/runner.js',
      'heresy-sim/src/agent.js',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['heresy-client/src/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        navigator: 'readonly',
      },
    },
  },
  {
    files: ['**/test/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
