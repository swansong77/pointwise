/* Applies migrations and seeds the catalog + demo users into DATABASE_URL before integration tests. */
const { execSync } = require('child_process');
const path = require('path');

module.exports = async () => {
  const cwd = path.resolve(__dirname, '../..');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set for integration tests');
  const env = { ...process.env };
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'inherit' });
  const seed = require('fs').existsSync(path.join(cwd, 'dist/seed/seed.js'))
    ? 'node dist/seed/seed.js'
    : 'npx ts-node --transpile-only src/seed/seed.ts';
  execSync(seed, { cwd, env, stdio: 'inherit' });
  // catalog cards created by earlier test runs (research, admin, credit-report tests) are hidden so every
  // run ranks the same seeded catalog; the test database is disposable — never the app's
  if (!/\/[^/?]*_test(\?|$)/.test(process.env.DATABASE_URL)) throw new Error('integration tests must run on a test database');
  execSync(
    `npx prisma db execute --stdin --url "${process.env.DATABASE_URL}"`,
    { cwd, env, input: `UPDATE "CreditCard" SET "isActive" = false WHERE "ownerId" IS NULL AND "catalogSource" <> 'DEMO' AND "isActive";`, stdio: ['pipe', 'inherit', 'inherit'] },
  );
};
