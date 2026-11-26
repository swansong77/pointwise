import { Injectable } from '@nestjs/common';
import { statfsSync, accessSync, constants } from 'fs';
import { decryptSecret } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { ENV_CARRY, ENV_REVIEW } from '../domain/backup-format';
import { SECRET_COLUMNS, foreignKeys } from '../domain/data-registry';
import { BackupService } from './backup.service';

export interface Check {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

export interface EnvRow {
  name: string;
  /** carry: copy the value to the new server (it can travel inside the encrypted migration bundle); review: set it for the new host */
  kind: 'carry' | 'review';
  state: 'set' | 'not set';
  /** the value, only for non-secret settings */
  value?: string;
  note: string;
}

const SECRET_NAMES = new Set(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'INTERNAL_API_SECRET', 'NEXTAUTH_SECRET', 'INBOUND_EMAIL_SECRET', 'VAPID_PRIVATE_KEY', 'DATABASE_URL', 'REDIS_URL', 'TOKEN_ENC_KEY', 'BACKUP_PASSPHRASE']);
const NOTES: Record<string, string> = {
  JWT_ACCESS_SECRET: 'Same value keeps everyone signed in; a new value signs everyone out.',
  JWT_REFRESH_SECRET: 'Same value keeps refresh sessions working.',
  INTERNAL_API_SECRET: 'Shared between the web app and the API; they must match.',
  NEXTAUTH_SECRET: 'Same value keeps browser sessions; a new value signs browsers out.',
  INBOUND_EMAIL_SECRET: 'The inbound mail provider sends this header; update the provider if it changes.',
  VAPID_PUBLIC_KEY: 'A new pair invalidates every push subscription.',
  VAPID_PRIVATE_KEY: 'A new pair invalidates every push subscription.',
  APP_URL: 'Links in emails and notifications.',
  NEXTAUTH_URL: 'The address of the web app.',
  CORS_ORIGINS: 'The address(es) the browser app is served from.',
  NEXT_PUBLIC_API_URL: 'Baked into the web app at build time; rebuild the web image.',
  API_INTERNAL_URL: 'How the web app reaches the API inside the network.',
  INBOUND_EMAIL_DOMAIN: 'Members forward alerts to an address on this domain; changing it breaks their forwarding.',
  INBOUND_AUTHSERV_ID: 'The mail provider id used to verify sender authentication.',
  PLAID_WEBHOOK_URL: 'Update the webhook in the bank-link provider after cutover.',
  GOOGLE_OAUTH_CLIENT_ID: 'Add the new redirect address in the Google console.',
  MICROSOFT_OAUTH_CLIENT_ID: 'Add the new redirect address in the Microsoft portal.',
  DATABASE_URL: 'Point at the new database.',
  REDIS_URL: 'Point at the new Redis.',
  TOKEN_ENC_KEY: 'May be different on the new server: backups re-encrypt secrets.',
  BACKUP_PASSPHRASE: 'Needed for the nightly backup on the new server.',
};

/** Checks before and after moving to another server. Reports facts; it changes nothing. */
@Injectable()
export class MigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupService,
  ) {}

  /** What the operator should check on the TARGET server before restoring. */
  async preflight(env: NodeJS.ProcessEnv = process.env): Promise<Check[]> {
    const checks: Check[] = [];
    const add = (id: string, label: string, status: Check['status'], detail: string) => checks.push({ id, label, status, detail });
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      add('db', 'Database reachable', 'ok', 'Connected.');
    } catch (e) {
      add('db', 'Database reachable', 'fail', e instanceof Error ? e.message.slice(0, 160) : 'Cannot connect.');
      return checks;
    }
    const migration = await this.backups.migration();
    add('migration', 'Database schema version', migration === 'none' ? 'fail' : 'ok', migration === 'none' ? 'No migrations are applied. Run the same PointWise version as the source and let it migrate first.' : `Latest applied migration: ${migration}.`);
    const users = await this.prisma.user.count();
    add('empty', 'Database is empty', users === 0 ? 'ok' : 'warn', users === 0 ? 'No members yet.' : `${users} member(s) exist; a restore replaces everything and makes a pre-restore backup first.`);
    const key = env.TOKEN_ENC_KEY ?? '';
    add('key', 'TOKEN_ENC_KEY', key.length >= 32 ? 'ok' : 'fail', key.length >= 32 ? 'Set (at least 32 characters).' : 'Set TOKEN_ENC_KEY to at least 32 characters.');
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      const v = env[k] ?? '';
      add(k.toLowerCase(), k, v.length >= 32 && !/change-me/i.test(v) ? 'ok' : 'warn', v.length >= 32 && !/change-me/i.test(v) ? 'Set.' : 'Missing, short or still the sample value.');
    }
    try {
      const dir = this.backups.dir();
      accessSync(dir, constants.W_OK);
      const fs = statfsSync(dir);
      const freeMb = Math.floor((fs.bavail * fs.bsize) / 1_048_576);
      add('disk', 'Backup folder writable with space', freeMb > 500 ? 'ok' : 'warn', `${dir}: ${freeMb} MB free.`);
    } catch (e) {
      add('disk', 'Backup folder writable with space', 'fail', e instanceof Error ? e.message.slice(0, 160) : 'Not writable.');
    }
    add('seed', 'Demo members are off', env.SEED_DEMO_USERS === 'false' ? 'ok' : 'warn', env.SEED_DEMO_USERS === 'false' ? 'SEED_DEMO_USERS=false.' : 'Set SEED_DEMO_USERS=false on a production server so demo accounts are not created.');
    return checks;
  }

  /** The environment on THIS server, split into what to carry and what to set for the new host. Secrets are never shown. */
  envManifest(env: NodeJS.ProcessEnv = process.env): EnvRow[] {
    const row = (name: string, kind: EnvRow['kind']): EnvRow => ({ name, kind, state: env[name] ? 'set' : 'not set', ...(SECRET_NAMES.has(name) || !env[name] ? {} : { value: env[name] }), note: NOTES[name] ?? '' });
    return [...ENV_CARRY.map((n) => row(n, 'carry')), ...ENV_REVIEW.map((n) => row(n, 'review'))];
  }

  /** After a restore: every foreign key points at a row, every secret kind decrypts, an administrator exists. */
  async verifyRestored(): Promise<Check[]> {
    const checks: Check[] = [];
    const models = this.backups.models();
    const names = new Set(models.map((m) => m.name));
    const orphans: string[] = [];
    for (const m of models) {
      for (const fk of foreignKeys(m)) {
        if (!names.has(fk.target)) continue;
        const parent = models.find((x) => x.name === fk.target)!;
        const pid = parent.fields.find((f) => f.isId)!.name;
        const q = `SELECT count(*)::int AS n FROM "${m.name}" c LEFT JOIN "${fk.target}" p ON c."${fk.field}" = p."${pid}" WHERE c."${fk.field}" IS NOT NULL AND p."${pid}" IS NULL`;
        const [r] = await this.prisma.$queryRawUnsafe<Array<{ n: number }>>(q);
        if (r.n > 0) orphans.push(`${m.name}.${fk.field} (${r.n})`);
      }
    }
    checks.push({ id: 'fk', label: 'Every reference points at a row', status: orphans.length ? 'fail' : 'ok', detail: orphans.length ? `Dangling: ${orphans.join(', ')}` : 'No dangling references.' });
    for (const [model, cols] of Object.entries(SECRET_COLUMNS)) {
      for (const c of cols) {
        const rows = await this.prisma.$queryRawUnsafe<Array<{ v: string }>>(`SELECT "${c}" AS v FROM "${model}" WHERE "${c}" IS NOT NULL LIMIT 1`);
        if (!rows.length) {
          checks.push({ id: `secret-${model}-${c}`, label: `${model}.${c} decrypts`, status: 'ok', detail: 'No rows to check.' });
          continue;
        }
        try {
          decryptSecret(rows[0].v);
          checks.push({ id: `secret-${model}-${c}`, label: `${model}.${c} decrypts`, status: 'ok', detail: 'A sample decrypted with this server\'s key.' });
        } catch {
          checks.push({ id: `secret-${model}-${c}`, label: `${model}.${c} decrypts`, status: 'fail', detail: 'A sample did not decrypt with this server\'s TOKEN_ENC_KEY.' });
        }
      }
    }
    const admins = await this.prisma.user.count({ where: { role: 'ADMIN' } });
    checks.push({ id: 'admin', label: 'An administrator exists', status: admins ? 'ok' : 'warn', detail: admins ? `${admins} administrator(s).` : 'No administrator account. Create one before opening the server.' });
    return checks;
  }
}
