module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    es2021: true, // Use modern ECMAScript features
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'server/prisma/generated/', // Ignore Prisma generated client
    '*.d.ts', // Ignore declaration files
    '.eslintrc.cjs', // Ignore this config file itself
    'discord_bot/', // Ignore the discord bot directory
  ],
  overrides: [
    {
      // Client-side specific configuration (src directory)
      files: ['src/**/*.ts'],
      env: {
        browser: true, // Add browser globals like `window`, `document`
      },
      rules: {
        // Add client-specific rules or overrides here if needed
        '@typescript-eslint/no-explicit-any': 'warn', // Allow 'any' but warn
        '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }], // Warn about unused vars
        'no-console': 'warn', // Warn about console logs in client code
      },
    },
    {
      // Server-side specific configuration (server directory)
      files: ['server/**/*.ts'],
      env: {
        node: true, // Add Node.js globals and Node.js scoping.
      },
      rules: {
        // Add server-specific rules or overrides here if needed
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
        'no-console': 'off', // Allow console logs in server code
      },
    },
    {
      // Configuration files (e.g., vite.config.js, scripts, server index)
      files: ['*.js', 'scripts/**/*.ts', 'server/utils/**/*.ts', 'server/index.ts'], // Added server/index.ts
      env: {
        node: true,
      },
      rules: {
        '@typescript-eslint/no-var-requires': 'off', // Allow require in JS/config files
        'no-console': 'off',
      }
    }
  ],
  rules: {
    // General rules applicable to both client and server
    '@typescript-eslint/explicit-module-boundary-types': 'off', // Optional: Disable if explicit return types are too verbose
    '@typescript-eslint/no-non-null-assertion': 'warn', // Warn about non-null assertions (!)
  },
};