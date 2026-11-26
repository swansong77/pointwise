/** Integration tests: real PostgreSQL (DATABASE_URL) + full Nest app via supertest. */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testTimeout: 30000,
  globalSetup: '<rootDir>/test/integration/global-setup.js',
  setupFiles: ['<rootDir>/test/integration/env.js'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/worker.ts', '!src/seed/**'],
  coverageDirectory: 'coverage/integration',
  coverageReporters: ['text-summary', 'json-summary'],
};
