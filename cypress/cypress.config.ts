import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_baseUrl ?? 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    video: false,
    screenshotsFolder: 'cypress/results/screenshots',
    defaultCommandTimeout: 10000,
    retries: { runMode: 1, openMode: 0 },
  },
  reporter: 'junit',
  reporterOptions: { mochaFile: 'cypress/results/junit-[hash].xml' },
});
