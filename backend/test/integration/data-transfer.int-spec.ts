import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createWriteStream, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { decryptSecret, encryptSecret } from '../../src/common/crypto';
import { BackupJobs } from '../../src/data/data.module';
import { BackupService } from '../../src/data/backup.service';
import { RestoreService } from '../../src/data/restore.service';
import { EncryptStream } from '../../src/domain/backup-crypto';
import { DigestBook, headerLine, manifestLine, rowLine } from '../../src/domain/backup-format';
import { api, bearer, createApp, login, register } from './helpers';
import { setMockOffers, defaultMockOffers, resetMock } from '../../src/offer-automation/mock-connector';

/**
 * Member data export and import, system backup and restore, maintenance mode and the migration checks.
 * Synthetic data only. Restores run against the real test database, including one under a DIFFERENT TOKEN_ENC_KEY.
 */
const V = '/api/v1';
const prisma = new PrismaClient();
const PASS = 'a-long-backup-passphrase-for-tests';
const MOCK_PASSWORD = 'mock-issuer-password-xyz';
const ORIGINAL_KEY = process.env.TOKEN_ENC_KEY!;
const OTHER_KEY = 'a-completely-different-encryption-key-0123456789';

let app: INestApplication;
let backups: BackupService;
let a: { token: string; userId: string; email: string };
let b: { token: string; userId: string; email: string };
let admin: { token: string; userId: string; email: string };
let cardA: string;
let bundleText = '';

const get = (path: string, t: string) => api(app).get(`${V}${path}`).set(bearer(t));
const post = (path: string, body: object, t: string) => api(app).post(`${V}${path}`).set(bearer(t)).send(body);
const upload = (path: string, t: string, content: Buffer | string, fields: Record<string, string> = {}) => {
  let r = api(app).post(`${V}${path}`).set(bearer(t));
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', Buffer.from(content), 'data.pointwise-data.json');
};
const rowCount = async (userId: string) => ({
  walletCards: await prisma.walletCard.count({ where: { wallet: { userId } } }),
  profiles: await prisma.profile.count({ where: { userId } }),
  transactions: await prisma.transaction.count({ where: { userId } }),
  loyalty: await prisma.loyaltyAccount.count({ where: { userId } }),
  offerItems: await prisma.offerSnapshotItem.count({ where: { userId } }),
  rules: await prisma.enrollmentRule.count({ where: { userId } }),
  pins: await prisma.categoryPin.count({ where: { userId } }),
  planned: await prisma.plannedPurchase.count({ where: { userId } }),
  userOffers: await prisma.userOffer.count({ where: { walletCard: { wallet: { userId } } } }),
  events: await prisma.offerEvent.count({ where: { userId } }),
});

beforeAll(async () => {
  process.env.BACKUP_DIR = mkdtempSync(join(tmpdir(), 'pw-backups-'));
  app = await createApp();
  backups = app.get(BackupService);
  a = await register(app);
  b = await register(app);
  const adm = await register(app);
  await prisma.user.update({ where: { id: adm.userId }, data: { role: 'ADMIN' } });
  admin = { ...adm, token: await login(app, adm.email, 'integration-pass-1') };

  // ---- a member with data in every area
  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
  cardA = (await post('/wallet/cards', { cardId: gold.id }, a.token).expect(201)).body.id;
  await post('/wallet/cards', { cardId: gold.id }, a.token).expect(201);
  const spouse = await prisma.profile.create({ data: { userId: a.userId, nickname: 'Spouse', relationship: 'SPOUSE', goals: ['TRAVEL'] } });
  await prisma.walletCard.update({ where: { id: cardA }, data: { lastFour: '4242', profileId: spouse.id } });
  const dining = await prisma.category.findFirstOrThrow({ where: { slug: { contains: 'din' } } });
  await prisma.categoryPin.create({ data: { userId: a.userId, walletCardId: cardA, categoryId: dining.id } });
  await prisma.spendProfileEntry.create({ data: { userId: a.userId, categoryId: dining.id, monthlyCents: 50_000 } });
  await prisma.plannedPurchase.create({ data: { userId: a.userId, merchantText: 'Hilton', amountCents: 80_000 } });
  await prisma.offerAlert.create({ data: { userId: a.userId, keywords: ['hotel'], issuerIds: [] } });
  for (let i = 0; i < 3; i++) await prisma.transaction.create({ data: { userId: a.userId, walletCardId: cardA, amountCents: 1000 + i, description: `Coffee ${i}`, externalId: i === 2 ? null : `ext-${i}` } });
  const lp = await prisma.loyaltyAccount.create({ data: { userId: a.userId, profileId: spouse.id, customName: 'My Miles', balance: 12_345, accountNumberEnc: encryptSecret('MEMBER-9999') } });
  await prisma.loyaltyEvent.create({ data: { userId: a.userId, accountId: lp.id, kind: 'EARN', balanceAfter: 12_345 } });
  await prisma.notificationPreference.upsert({ where: { userId: a.userId }, update: { emailDigest: false, expiringDays: 21 }, create: { userId: a.userId, emailDigest: false, expiringDays: 21 } });
  await prisma.aiSettings.upsert({ where: { userId: a.userId }, update: { consentedAt: new Date(), monthlyTokenBudget: 5000 }, create: { userId: a.userId, consentedAt: new Date(), monthlyTokenBudget: 5000 } });
  await prisma.bankConnection.create({ data: { userId: a.userId, provider: 'PLAID', itemId: `item-${Date.now()}`, accessTokenEnc: encryptSecret('plaid-access-token-1') } });
  await prisma.mailbox.create({ data: { userId: a.userId, label: 'Mail', kind: 'IMAP', username: 'someone@example.test', secretEnc: encryptSecret('imap-password-1') } });
  // offer automation: an account with a login, a synced inventory, a rule and a policy
  const issuer = await prisma.issuer.findFirstOrThrow();
  const acct = await post('/offer-automation/accounts', { issuerId: issuer.id, holderLabel: 'Alex Gold', connectorKind: 'MOCK', username: 'alex', password: MOCK_PASSWORD, automationOptIn: true, ackTermsRisk: true, walletCardIds: [cardA] }, a.token).expect(201);
  resetMock();
  setMockOffers('alex', defaultMockOffers(cardA), [{ cardKey: cardA, label: 'Card', lastFour: '4242' }]);
  await post('/offer-automation/sync', { accountId: acct.body.id, wait: true }, a.token).expect(201);
  await post('/offer-automation/rules', { label: 'No gambling', kind: 'NEVER', matcher: 'CATEGORY', matcherValue: 'gambling' }, a.token).expect(201);
  await api(app).put(`${V}/offer-automation/policy`).set(bearer(a.token)).send({ mode: 'AUTO', autoFilter: { categories: ['travel'] } }).expect(200);
  // a provider key the admin stored
  await prisma.aiProvider.updateMany({ data: { apiKeyEnc: encryptSecret('provider-key-1') }, where: { name: { not: '' } } });
});
afterAll(async () => {
  process.env.TOKEN_ENC_KEY = ORIGINAL_KEY;
  await app.close();
  await prisma.$disconnect();
});

describe('member data export', () => {
  it('contains the member\'s data and settings, and no secret, token or credential', async () => {
    const res = await get('/me/data-export', a.token).expect(200);
    expect(res.headers['content-disposition']).toMatch(/\.pointwise-data\.json/);
    bundleText = res.text;
    const bundle = JSON.parse(bundleText);
    expect(bundle.format).toBe('pointwise-user-data');
    for (const m of ['Profile', 'Wallet', 'WalletCard', 'Transaction', 'CategoryPin', 'SpendProfileEntry', 'PlannedPurchase', 'OfferAlert', 'LoyaltyAccount', 'LoyaltyEvent', 'NotificationPreference', 'AiSettings', 'OfferAccount', 'OfferSnapshotItem', 'EnrollmentRule', 'EnrollmentPolicy', 'OfferEvent']) expect(Object.keys(bundle.models)).toContain(m);
    expect(bundle.models.WalletCard).toHaveLength(2);
    expect(bundle.models.NotificationPreference[0].expiringDays).toBe(21);
    expect(bundle.models.EnrollmentPolicy[0].mode).toBe('AUTO');
    for (const bad of [MOCK_PASSWORD, 'MEMBER-9999', 'plaid-access-token-1', 'imap-password-1', 'passwordHash', 'accessTokenEnc', 'credentialEnc', 'secretEnc', 'sessionEnc', 'tokenHash', 'integration-pass-1', a.email]) expect(bundleText).not.toContain(bad);
    expect(bundle.models.AiSettings[0].consentedAt).toBeUndefined();
    expect(bundle.needsReconnect.map((r: { kind: string }) => r.kind)).toEqual(expect.arrayContaining(['bank', 'mailbox', 'offerLogin', 'aiConsent']));
    expect(Object.keys(bundle.catalog)).toEqual(expect.arrayContaining(['CreditCard', 'Issuer']));
    expect(Object.values(bundle.catalog.CreditCard)).toContainEqual({ slug: 'contoso-gold' });
    expect((await prisma.auditLog.count({ where: { actorId: a.userId, action: 'user.data-export' } }))).toBeGreaterThan(0);
  });

  it('can be gzip-compressed, needs a login, and never includes another member', async () => {
    const gz = await api(app).get(`${V}/me/data-export?gzip=true`).set(bearer(a.token)).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((gz.body as Buffer)[0]).toBe(0x1f);
    expect((await api(app).get(`${V}/me/data-export`)).status).toBe(401);
    const other = JSON.parse((await get('/me/data-export', b.token).expect(200)).text);
    expect(JSON.stringify(other)).not.toContain(a.userId);
    expect(Object.keys(other.models)).not.toContain('WalletCard');
  });
});

describe('member data import', () => {
  it('previews first and changes nothing', async () => {
    const r = await upload('/me/data-import', b.token, bundleText, { mode: 'merge' }).expect(201);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.created.WalletCard).toBe(2);
    expect(r.body.totals.created).toBeGreaterThan(20);
    expect(r.body.notRestored.map((n: { model: string }) => n.model)).toEqual(expect.arrayContaining(['BankConnection', 'Mailbox']));
    expect((await rowCount(b.userId)).walletCards).toBe(0);
  });

  it('merge creates the member\'s data with new ids, owned by the importer, relations intact', async () => {
    const r = await upload('/me/data-import', b.token, bundleText, { mode: 'merge', dryRun: 'false' }).expect(201);
    expect(r.body.dryRun).toBe(false);
    // settings that every account already has are overwritten by the file, not skipped
    expect(Object.keys(r.body.updated)).toEqual(expect.arrayContaining(['NotificationPreference']));
    const ca = await rowCount(a.userId);
    const cb = await rowCount(b.userId);
    expect(cb).toEqual(ca);
    expect(cb.walletCards).toBe(2);
    expect(cb.transactions).toBe(3);
    // new ids, not the originals
    const idsA = (await prisma.walletCard.findMany({ where: { wallet: { userId: a.userId } } })).map((w) => w.id);
    const cardsB = await prisma.walletCard.findMany({ where: { wallet: { userId: b.userId } }, orderBy: { id: 'asc' } });
    expect(cardsB.every((w) => !idsA.includes(w.id))).toBe(true);
    expect(cardsB.some((w) => w.lastFour === '4242')).toBe(true);
    // relations: the pin points at B's own card; the offer items at B's account and card; the rule at B's account
    const pin = await prisma.categoryPin.findFirstOrThrow({ where: { userId: b.userId } });
    expect(cardsB.map((w) => w.id)).toContain(pin.walletCardId);
    const acctB = await prisma.offerAccount.findFirstOrThrow({ where: { userId: b.userId } });
    expect(await prisma.offerSnapshotItem.count({ where: { accountId: acctB.id, userId: b.userId } })).toBe(3);
    const item = await prisma.offerSnapshotItem.findFirstOrThrow({ where: { accountId: acctB.id } });
    expect(cardsB.map((w) => w.id)).toContain(item.walletCardId);
    // the household member and the loyalty account follow the profile
    const spouseB = await prisma.profile.findFirstOrThrow({ where: { userId: b.userId, nickname: 'Spouse' } });
    expect((await prisma.loyaltyAccount.findFirstOrThrow({ where: { userId: b.userId } })).profileId).toBe(spouseB.id);
    expect((await prisma.walletCard.findFirstOrThrow({ where: { wallet: { userId: b.userId }, lastFour: '4242' } })).profileId).toBe(spouseB.id);
    // settings come back, except the AI consent; the offer account comes back without its login and switched off
    expect((await prisma.notificationPreference.findUniqueOrThrow({ where: { userId: b.userId } })).expiringDays).toBe(21);
    const ai = await prisma.aiSettings.findUniqueOrThrow({ where: { userId: b.userId } });
    expect([ai.monthlyTokenBudget, ai.consentedAt]).toEqual([5000, null]);
    expect([acctB.credentialEnc, acctB.automationOptIn, acctB.syncHealth]).toEqual([null, false, 'DISABLED']);
    expect((await prisma.enrollmentPolicy.findUniqueOrThrow({ where: { userId: b.userId } })).mode).toBe('AUTO');
    // what is not restored by design
    expect(await prisma.bankConnection.count({ where: { userId: b.userId } })).toBe(0);
    expect(await prisma.mailbox.count({ where: { userId: b.userId } })).toBe(0);
    expect(await prisma.loyaltyAccount.findFirstOrThrow({ where: { userId: b.userId } }).then((l) => l.accountNumberEnc)).toBeNull();
    // the exporter is untouched
    expect(await rowCount(a.userId)).toEqual(ca);
  });

  it('merging the same file again adds nothing', async () => {
    const before = await rowCount(b.userId);
    const r = await upload('/me/data-import', b.token, bundleText, { mode: 'merge', dryRun: 'false' }).expect(201);
    expect(r.body.totals.created).toBe(0);
    expect(r.body.totals.duplicates).toBeGreaterThan(20);
    expect(await rowCount(b.userId)).toEqual(before);
  });

  it('replace removes the member\'s own extra data first, keeps the account and plan, and restores the file', async () => {
    const extra = await prisma.walletCard.findFirstOrThrow({ where: { wallet: { userId: b.userId } } });
    await prisma.categoryPin.create({ data: { userId: b.userId, walletCardId: extra.id, categoryId: (await prisma.category.findFirstOrThrow({ where: { slug: { not: { contains: 'din' } } } })).id } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: b.userId } });
    const r = await upload('/me/data-import', b.token, bundleText, { mode: 'replace', dryRun: 'false' }).expect(201);
    expect(r.body.mode).toBe('replace');
    expect(await rowCount(b.userId)).toEqual(await rowCount(a.userId));
    const after = await prisma.user.findUniqueOrThrow({ where: { id: b.userId } });
    expect([after.email, after.passwordHash, after.role]).toEqual([user.email, user.passwordHash, user.role]);
    expect((await prisma.auditLog.count({ where: { actorId: b.userId, action: 'user.data-import' } }))).toBeGreaterThan(0);
  });

  it('a hostile file cannot write into another account, change the role or plant a credential', async () => {
    const c = await register(app);
    const bundle = JSON.parse(bundleText);
    for (const m of Object.keys(bundle.models)) for (const row of bundle.models[m]) {
      if ('userId' in row) row.userId = a.userId;
      if ('ownerId' in row) row.ownerId = a.userId;
      row.role = 'ADMIN';
      row.passwordHash = 'x';
      row.tokenHash = 'y';
    }
    for (const row of bundle.models.OfferAccount) Object.assign(row, { credentialEnc: encryptSecret('planted'), automationOptIn: true, syncHealth: 'HEALTHY' });
    bundle.models.WalletCard[0].walletId = (await prisma.wallet.findFirstOrThrow({ where: { userId: a.userId } })).id;
    const beforeA = await rowCount(a.userId);
    const r = await upload('/me/data-import', c.token, JSON.stringify(bundle), { mode: 'merge', dryRun: 'false' }).expect(201);
    expect(r.body.warnings.join(' ')).toMatch(/ignored/);
    expect(await rowCount(a.userId)).toEqual(beforeA);
    expect((await rowCount(c.userId)).walletCards).toBe(2);
    expect(await prisma.walletCard.count({ where: { wallet: { userId: c.userId } } })).toBe(2);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.userId } })).role).toBe('USER');
    const acct = await prisma.offerAccount.findFirstOrThrow({ where: { userId: c.userId } });
    expect([acct.credentialEnc, acct.automationOptIn, acct.syncHealth]).toEqual([null, false, 'DISABLED']);
    expect(await prisma.offerAccount.count({ where: { userId: a.userId } })).toBe(1);
  });

  it('rejects files that are not usable, from a newer version, or too large', async () => {
    const bad = async (content: Buffer | string, msg: RegExp) => expect((await upload('/me/data-import', b.token, content, { dryRun: 'false' })).body.message).toMatch(msg);
    await bad('not json at all', /not valid JSON/);
    await bad(JSON.stringify({ hello: 1 }), /not a PointWise data file/);
    await bad(JSON.stringify({ ...JSON.parse(bundleText), version: 99 }), /newer PointWise/);
    await bad(JSON.stringify({ ...JSON.parse(bundleText), models: [] }), /no data section/);
    await bad(JSON.stringify({ ...JSON.parse(bundleText), models: { WalletCard: 'x' } }), /not a list/);
    await bad(JSON.stringify({ ...JSON.parse(bundleText), models: { WalletCard: [5] } }), /not an object/);
    expect((await api(app).post(`${V}/me/data-import`).set(bearer(b.token)).send({})).status).toBe(400);
    expect((await upload('/me/data-import', b.token, bundleText, { mode: 'overwrite-everything' })).status).toBe(400);
    expect((await api(app).post(`${V}/me/data-import`).attach('file', Buffer.from('{}'), 'x.json')).status).toBe(401);
    const gz = await new Promise<Buffer>((res) => { const c: Buffer[] = []; const z = createGzip(); z.on('data', (d) => c.push(d)); z.on('end', () => res(Buffer.concat(c))); z.end(bundleText); });
    expect((await upload('/me/data-import', b.token, gz, { mode: 'merge' }).expect(201)).body.dryRun).toBe(true);
    expect((await upload('/me/data-import', b.token, Buffer.from([0x1f, 0x8b, 1, 2, 3]), { mode: 'merge' })).body.message).toMatch(/could not be unpacked/);
  });

  it('skips rows that point at a catalog item this server does not have, and says so', async () => {
    const c = await register(app);
    const bundle = JSON.parse(bundleText);
    const id = bundle.models.WalletCard[0].cardId;
    bundle.catalog.CreditCard[id] = { slug: 'no-such-card-here' };
    for (const w of bundle.models.WalletCard) w.cardId = id;
    const r = (await upload('/me/data-import', c.token, JSON.stringify(bundle), { mode: 'merge' }).expect(201)).body;
    expect(r.unmapped.WalletCard).toBe(2);
    expect(r.warnings.join(' ')).toMatch(/does not exist on this server/);
  });
});

describe('system backup and restore', () => {
  it('only administrators can use the backup routes', async () => {
    expect((await get('/admin/backups', a.token)).status).toBe(403);
    expect((await api(app).get(`${V}/admin/backups`)).status).toBe(401);
    expect((await post('/admin/backups', { passphrase: PASS }, a.token)).status).toBe(403);
    expect((await post('/admin/backups', { passphrase: 'short' }, admin.token)).status).toBe(400);
  });

  let file = '';
  it('writes an encrypted backup, verifies it, and audits both', async () => {
    const r = await post('/admin/backups', { passphrase: PASS, includeEnv: true }, admin.token).expect(201);
    file = r.body.name;
    expect(r.body.rows).toBeGreaterThan(500);
    expect(existsSync(join(process.env.BACKUP_DIR!, file))).toBe(true);
    const raw = readFileSync(join(process.env.BACKUP_DIR!, file));
    for (const secret of [a.email, MOCK_PASSWORD, 'plaid-access-token-1', 'provider-key-1', 'contoso']) expect(raw.toString('latin1')).not.toContain(secret);
    const v = await post(`/admin/backups/${file}/verify`, { passphrase: PASS }, admin.token).expect(201);
    expect(v.body).toMatchObject({ ok: true, problems: [], incompatible: null, hasEnv: true });
    expect(v.body.rows).toBe(r.body.rows);
    expect((await prisma.auditLog.count({ where: { actorId: admin.userId, action: 'backup.create', entityId: file } }))).toBe(1);
    const list = (await get('/admin/backups', admin.token).expect(200)).body;
    expect(list.files.map((f: { name: string }) => f.name)).toContain(file);
    expect(list.migration).toMatch(/^\d{14}_/);
    const dl = await api(app).get(`${V}/admin/backups/${file}/download`).set(bearer(admin.token)).expect(200);
    expect(dl.headers['content-disposition']).toContain(file);
  });

  it('refuses a wrong passphrase, a changed file, a bad name and a missing file', async () => {
    expect((await post(`/admin/backups/${file}/verify`, { passphrase: 'not the right one at all' }, admin.token).expect(201)).body.problems.join(' ')).toMatch(/passphrase is wrong/);
    const tampered = Buffer.from(readFileSync(join(process.env.BACKUP_DIR!, file)));
    tampered[tampered.length - 30] ^= 1;
    writeFileSync(join(process.env.BACKUP_DIR!, 'uploaded-1.pwbackup'), tampered);
    expect((await post('/admin/backups/uploaded-1.pwbackup/verify', { passphrase: PASS }, admin.token).expect(201)).body.ok).toBe(false);
    expect((await post('/admin/backups/..%2Fetc%2Fpasswd/verify', { passphrase: PASS }, admin.token)).status).toBe(400);
    expect((await post('/admin/backups/nothere.pwbackup/verify', { passphrase: PASS }, admin.token)).status).toBe(404);
    const before = await prisma.user.count();
    const bad = await post(`/admin/backups/${file}/restore`, { passphrase: 'not the right one at all', confirm: 'RESTORE' }, admin.token);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/cannot be restored/);
    expect(await prisma.user.count()).toBe(before);
    expect((await post(`/admin/backups/${file}/restore`, { passphrase: PASS, confirm: 'yes' }, admin.token)).status).toBe(400);
  });

  it('refuses a backup from a different database version', async () => {
    const spy = jest.spyOn(backups, 'migration').mockResolvedValue('20990101000000_future');
    const r = await post(`/admin/backups/${file}/restore`, { passphrase: PASS, confirm: 'RESTORE' }, admin.token);
    spy.mockRestore();
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/database version/);
  });

  it('rolls everything back when a backup has a row the schema refuses', async () => {
    const book = new DigestBook();
    const lines = [headerLine({ appVersion: '1', migration: await backups.migration(), createdAt: new Date().toISOString(), includesEphemeral: false, includesEnv: false, models: ['SystemSetting'] })];
    const bad = rowLine('SystemSetting', { key: 'x', value: 1, updatedAt: '2026-01-01T00:00:00.000Z', nonsense: true });
    book.add('SystemSetting', bad);
    lines.push(bad, manifestLine({ models: book.result(), totalRows: 1, warnings: [] }));
    const path = join(process.env.BACKUP_DIR!, 'uploaded-2.pwbackup');
    await pipeline(Readable.from(lines.map((l) => l + '\n')), createGzip(), new EncryptStream(PASS), createWriteStream(path));
    const users = await prisma.user.count();
    const r = await post('/admin/backups/uploaded-2.pwbackup/restore', { passphrase: PASS, confirm: 'RESTORE' }, admin.token);
    expect(r.status).toBe(500 === r.status ? 500 : r.status);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.user.count()).toBe(users);
    expect(await prisma.walletCard.count({ where: { wallet: { userId: a.userId } } })).toBe(2);
  });

  it('restores the exact state after changes, under a DIFFERENT TOKEN_ENC_KEY, and every secret still works', async () => {
    const counts = { users: await prisma.user.count(), cards: await prisma.walletCard.count(), tx: await prisma.transaction.count(), items: await prisma.offerSnapshotItem.count() };
    // change things after the backup
    await prisma.transaction.deleteMany({ where: { userId: a.userId } });
    await prisma.user.update({ where: { id: a.userId }, data: { name: 'Changed After Backup' } });
    await prisma.walletCard.deleteMany({ where: { wallet: { userId: b.userId } } });
    await post('/admin/maintenance', { on: true, reason: 'restoring' }, admin.token).expect(201);
    process.env.TOKEN_ENC_KEY = OTHER_KEY; // the new server has another key
    const r = await post(`/admin/backups/${file}/restore`, { passphrase: PASS, confirm: 'RESTORE' }, admin.token).expect(201);
    expect(r.body.rows).toBeGreaterThan(500);
    expect(r.body.preBackup).toMatch(/^pre-restore-/);
    expect(r.body.carriedEnv).toEqual(expect.arrayContaining(['JWT_ACCESS_SECRET']));
    expect({ users: await prisma.user.count(), cards: await prisma.walletCard.count(), tx: await prisma.transaction.count(), items: await prisma.offerSnapshotItem.count() }).toEqual(counts);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.userId } })).name).toBe('Test');
    // secrets were re-encrypted with the NEW key: they decrypt now and would not under the old one
    const bank = await prisma.bankConnection.findFirstOrThrow({ where: { userId: a.userId } });
    expect(decryptSecret(bank.accessTokenEnc)).toBe('plaid-access-token-1');
    expect(decryptSecret((await prisma.mailbox.findFirstOrThrow({ where: { userId: a.userId } })).secretEnc)).toBe('imap-password-1');
    expect(decryptSecret((await prisma.loyaltyAccount.findFirstOrThrow({ where: { userId: a.userId } })).accountNumberEnc!)).toBe('MEMBER-9999');
    expect(decryptSecret((await prisma.offerAccount.findFirstOrThrow({ where: { userId: a.userId } })).credentialEnc!)).toContain('alex');
    expect(decryptSecret((await prisma.aiProvider.findFirstOrThrow({ where: { apiKeyEnc: { not: null } } })).apiKeyEnc!)).toBe('provider-key-1');
    expect(() => decryptSecret(bank.accessTokenEnc, ORIGINAL_KEY)).toThrow();
    // the migration checks agree
    const verified = (await get('/admin/migration/verify', admin.token).expect(200)).body as Array<{ id: string; status: string }>;
    expect(verified.every((c) => c.status !== 'fail')).toBe(true);
    expect(verified.map((c) => c.id)).toEqual(expect.arrayContaining(['fk', 'admin', 'secret-BankConnection-accessTokenEnc']));
    // maintenance mode was part of the old state and is off again; members can use the system
    expect((await get('/admin/maintenance', admin.token).expect(200)).body.on).toBe(false);
    expect((await get('/wallet/cards', a.token)).status).toBe(200);
    // back to the original key and state for the rest of the test run
    process.env.TOKEN_ENC_KEY = ORIGINAL_KEY;
    await post(`/admin/backups/${file}/restore`, { passphrase: PASS, confirm: 'RESTORE' }, admin.token).expect(201);
    expect(decryptSecret((await prisma.bankConnection.findFirstOrThrow({ where: { userId: a.userId } })).accessTokenEnc)).toBe('plaid-access-token-1');
  });

  it('a restored member can still sign in and see their data', async () => {
    const t = await login(app, a.email, 'integration-pass-1');
    expect((await get('/wallet/cards', t).expect(200)).body).toHaveLength(2);
  });

  it('keeps the newest backups, deletes one on request, and runs the nightly job only when configured', async () => {
    const dir = process.env.BACKUP_DIR!;
    for (const n of ['pointwise-20200101-000000.pwbackup', 'pointwise-20200102-000000.pwbackup', 'pointwise-20200103-000000.pwbackup']) writeFileSync(join(dir, n), 'x');
    const gone = backups.prune(2);
    expect(gone).toContain('pointwise-20200101-000000.pwbackup');
    expect(existsSync(join(dir, 'pointwise-20200101-000000.pwbackup'))).toBe(false);
    const jobs = app.get(BackupJobs);
    const old = process.env.BACKUP_PASSPHRASE;
    delete process.env.BACKUP_PASSPHRASE;
    expect(await jobs.nightly(new Date())).toBe(0);
    process.env.BACKUP_PASSPHRASE = PASS;
    process.env.BACKUP_KEEP = '50';
    expect(await jobs.nightly(new Date())).toBe(1);
    expect((await prisma.auditLog.count({ where: { action: 'backup.nightly' } }))).toBeGreaterThan(0);
    process.env.BACKUP_PASSPHRASE = 'short';
    expect(await jobs.nightly(new Date())).toBe(0);
    expect(await prisma.notification.count({ where: { userId: admin.userId, type: 'BACKUP_FAILED' } })).toBeGreaterThan(0);
    if (old === undefined) delete process.env.BACKUP_PASSPHRASE;
    else process.env.BACKUP_PASSPHRASE = old;
    await api(app).delete(`${V}/admin/backups/uploaded-1.pwbackup`).set(bearer(admin.token)).expect(204);
    expect(existsSync(join(dir, 'uploaded-1.pwbackup'))).toBe(false);
    expect((await api(app).delete(`${V}/admin/backups/uploaded-1.pwbackup`).set(bearer(admin.token))).status).toBe(404);
  });

  it('accepts an uploaded backup file (for moving one in from another server)', async () => {
    const name = backups.list().find((f) => f.name.startsWith('pointwise-2026') || f.name.startsWith('pointwise-'))!.name;
    const r = await api(app).post(`${V}/admin/backups/upload`).set(bearer(admin.token)).attach('file', readFileSync(join(process.env.BACKUP_DIR!, name)), 'moved.pwbackup').expect(201);
    expect(r.body.name).toMatch(/^uploaded-\d+\.pwbackup$/);
    expect((await post(`/admin/backups/${r.body.name}/verify`, { passphrase: PASS }, admin.token).expect(201)).body.problems).toEqual([]);
    expect((await api(app).post(`${V}/admin/backups/upload`).set(bearer(admin.token))).status).toBe(400);
  });
});

describe('maintenance mode and migration checks', () => {
  it('blocks members and visitors with a clear 503, but lets administrators, health checks and sign-in through', async () => {
    await post('/admin/maintenance', { on: true, reason: 'moving servers' }, admin.token).expect(201);
    const m = await get('/wallet/cards', a.token);
    expect(m.status).toBe(503);
    expect(m.body.message).toMatch(/moving servers/);
    expect((await api(app).get(`${V}/issuers`)).status).toBe(503);
    expect((await get('/admin/backups', admin.token)).status).toBe(200);
    expect((await api(app).get('/health')).status).toBe(200);
    await api(app).post(`${V}/auth/login`).send({ email: a.email, password: 'integration-pass-1' }).expect(200);
    await post('/admin/maintenance', { on: false }, admin.token).expect(201);
    expect((await get('/wallet/cards', a.token)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { actorId: admin.userId, action: { in: ['maintenance.on', 'maintenance.off'] } } })).toBeGreaterThanOrEqual(2);
  });

  it('the preflight and the environment manifest report facts and never show a secret', async () => {
    const pre = (await get('/admin/migration/preflight', admin.token).expect(200)).body as Array<{ id: string; status: string; detail: string }>;
    expect(pre.map((c) => c.id)).toEqual(expect.arrayContaining(['db', 'migration', 'empty', 'key', 'disk']));
    expect(pre.find((c) => c.id === 'db')!.status).toBe('ok');
    expect(pre.find((c) => c.id === 'empty')!.status).toBe('warn');
    const env = await get('/admin/migration/env', admin.token).expect(200);
    const text = JSON.stringify(env.body);
    for (const secret of [process.env.TOKEN_ENC_KEY!, process.env.JWT_ACCESS_SECRET ?? 'x-not-set-x', process.env.DATABASE_URL ?? 'x-not-set-x']) expect(text).not.toContain(secret);
    expect(env.body.find((e: { name: string }) => e.name === 'JWT_ACCESS_SECRET')).toMatchObject({ kind: 'carry' });
    expect(env.body.find((e: { name: string }) => e.name === 'APP_URL')).toMatchObject({ kind: 'review' });
  });
});
