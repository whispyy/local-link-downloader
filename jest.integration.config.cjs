/** @type {import('jest').Config} */
module.exports = {
  displayName: 'integration',
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Only run files under tests/integration/
  testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],

  // ts-jest config: use the server tsconfig so paths resolve correctly
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
        // Disable type-checking during tests for speed; tsc --noEmit handles that
        diagnostics: false,
      },
    ],
  },

  // Allow importing .js extensions (used by server/index.ts → server/app.js)
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // Give real-network tests (D10) enough time
  testTimeout: 30_000,

  // Verbose output so each scenario is clearly visible
  verbose: true,
};
