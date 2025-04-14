import globals from "globals";
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  // 1. Global ignores
  {
    ignores: [
      'node_modules/',
      'dist/',
      'server/prisma/generated/',
      '**/*.d.ts', // Use **/* for global pattern
      '.eslintrc.cjs', // Ignore old config file
      'eslint.config.js', // Ignore this config file
      'discord_bot/',
    ],
  },

  // 2. Base configuration (eslint recommended)
  js.configs.recommended,

  // 3. Base configuration for TypeScript files
  {
    files: ["**/*.ts"], // Apply TS settings to all .ts files
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json', // Assuming a root tsconfig.json, adjust if needed
      },
      ecmaVersion: 2021,
      sourceType: "module", // Default to ES Modules
    },
    rules: {
      // Apply recommended TS rules (plugin: @typescript-eslint/recommended)
      ...tsPlugin.configs.recommended.rules,
      // Apply rules requiring type information if needed (adjust based on your tsconfig setup)
      // ...tsPlugin.configs['recommended-requiring-type-checking'].rules,

      // General rule overrides from the old config
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Common rules from overrides applied globally to TS files
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
    },
  },

  // 4. Client-specific configuration (src directory)
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser, // Add browser environment globals
      },
    },
    rules: {
      // Client-specific rules
      'no-console': 'warn', // Warn about console logs in client code
    },
  },

  // 5. Server-specific configuration (server directory)
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node, // Add Node.js environment globals
      },
    },
    rules: {
      // Server-specific rules
      'no-console': 'off', // Allow console logs in server code
    },
  },

  // 6. Configuration/Script files (JS, specific TS)
  {
    // Matches JS/CJS files and specific TS files often used for config/scripts
    files: ['*.js', '*.cjs', 'scripts/**/*.ts', 'server/utils/**/*.ts', 'server/index.ts'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs', // Assume CommonJS for these files
      globals: {
        ...globals.node, // Node.js environment globals
      },
    },
    rules: {
      // Rules specific to config/script files
      '@typescript-eslint/no-var-requires': 'off', // Allow require in CJS/JS files
      'no-console': 'off', // Allow console logs

      // Potentially relax strict TS rules for these files if needed
      // '@typescript-eslint/no-explicit-any': 'off',
      // '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];