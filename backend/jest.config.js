/** Unit tests: pure domain + services with mocked Prisma. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/ai/**/*.ts', 'src/**/*.service.ts', '!src/**/prisma.service.ts', '!src/jobs/mail.service.ts'],
  coverageDirectory: 'coverage/unit',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    './src/domain/': { lines: 95, branches: 90, functions: 95, statements: 95 },
  },
};
