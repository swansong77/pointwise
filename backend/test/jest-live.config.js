/** Opt-in live provider smoke tests (LIVE_AI_SMOKE=1). Never part of CI or `npm test`. */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/live/**/*.live-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testTimeout: 60000,
};
