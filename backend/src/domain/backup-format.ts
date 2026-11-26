import { createHash } from 'crypto';

/**
 * The content of a backup, one JSON object per line (NDJSON), inside the encrypted and compressed file:
 *   {"t":"header", ...}            first: format, versions, what is included
 *   {"t":"row","m":"User","r":{}}  one per row, models in restore order
 *   {"t":"env","vars":{}}          optional: environment secrets the operator chose to carry over
 *   {"t":"manifest", ...}          last: per-model row counts and hashes, warnings
 * The manifest comes last because counts and hashes are only known once every row has been written.
 */
export const BACKUP_FORMAT = 'pointwise-backup';
export const BACKUP_VERSION = 1;

export interface BackupHeader {
  t: 'header';
  format: typeof BACKUP_FORMAT;
  version: number;
  appVersion: string;
  /** the newest applied database migration; a restore needs the target to be on the same one */
  migration: string;
  createdAt: string;
  includesEphemeral: boolean;
  includesEnv: boolean;
  models: string[];
}

export interface ModelDigest {
  count: number;
  sha256: string;
}

export interface BackupManifest {
  t: 'manifest';
  models: Record<string, ModelDigest>;
  totalRows: number;
  warnings: string[];
}

/** Counts and hashes the rows of each model as they are written or read. */
export class DigestBook {
  private readonly hashes = new Map<string, ReturnType<typeof createHash>>();
  private readonly counts = new Map<string, number>();

  add(model: string, line: string): void {
    let h = this.hashes.get(model);
    if (!h) {
      h = createHash('sha256');
      this.hashes.set(model, h);
    }
    h.update(line);
    h.update('\n');
    this.counts.set(model, (this.counts.get(model) ?? 0) + 1);
  }

  ensure(model: string): void {
    if (!this.hashes.has(model)) this.hashes.set(model, createHash('sha256'));
    if (!this.counts.has(model)) this.counts.set(model, 0);
  }

  result(): Record<string, ModelDigest> {
    const out: Record<string, ModelDigest> = {};
    for (const [m, h] of this.hashes) out[m] = { count: this.counts.get(m) ?? 0, sha256: h.copy().digest('hex') };
    return out;
  }
}

export const headerLine = (h: Omit<BackupHeader, 't' | 'format' | 'version'> & Partial<Pick<BackupHeader, 'version'>>): string => JSON.stringify({ t: 'header', format: BACKUP_FORMAT, version: h.version ?? BACKUP_VERSION, ...h });
export const rowLine = (model: string, row: unknown): string => JSON.stringify({ t: 'row', m: model, r: row });
export const manifestLine = (m: Omit<BackupManifest, 't'>): string => JSON.stringify({ t: 'manifest', ...m });
export const envLine = (vars: Record<string, string>): string => JSON.stringify({ t: 'env', vars });

export type Line = BackupHeader | { t: 'row'; m: string; r: Record<string, never> } | { t: 'env'; vars: Record<string, string> } | BackupManifest;

export function parseLine(raw: string): Line {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error('the backup contains a line that is not valid JSON');
  }
  const t = (v as { t?: string } | null)?.t;
  if (t !== 'header' && t !== 'row' && t !== 'env' && t !== 'manifest') throw new Error('the backup contains a line of an unknown kind');
  return v as Line;
}

/** Why a header cannot be restored on this server, or null when it can. */
export function headerProblem(h: BackupHeader, target: { migration: string; models: string[] }): string | null {
  if (h.format !== BACKUP_FORMAT) return 'This file is not a PointWise backup.';
  if (h.version > BACKUP_VERSION) return `This backup was written by a newer PointWise (format ${h.version}); upgrade this server first.`;
  if (h.migration !== target.migration) return `This backup is from database version ${h.migration}, and this server is on ${target.migration}. Run the same PointWise version that made the backup, restore, then upgrade.`;
  const missing = h.models.filter((m) => !target.models.includes(m));
  if (missing.length) return `This server does not know the model(s) ${missing.join(', ')}.`;
  return null;
}

/** Differences between what was counted while reading and what the manifest promises (empty when equal). */
export function manifestProblems(read: Record<string, ModelDigest>, manifest: BackupManifest, models: string[]): string[] {
  const out: string[] = [];
  for (const m of models) {
    const want = manifest.models[m];
    const got = read[m] ?? { count: 0, sha256: createHash('sha256').digest('hex') };
    if (!want) out.push(`${m} is missing from the manifest`);
    else if (want.count !== got.count) out.push(`${m}: the manifest says ${want.count} row(s), the file has ${got.count}`);
    else if (want.sha256 !== got.sha256) out.push(`${m}: the rows do not match their checksum`);
  }
  for (const m of Object.keys(manifest.models)) if (!models.includes(m)) out.push(`${m} is in the manifest but not in the header`);
  const total = Object.values(manifest.models).reduce((s, d) => s + d.count, 0);
  if (total !== manifest.totalRows) out.push(`the manifest total (${manifest.totalRows}) does not match its models (${total})`);
  return out;
}

/** Environment variables that may be carried in a migration bundle so sessions and push subscriptions survive. */
export const ENV_CARRY = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'INTERNAL_API_SECRET', 'NEXTAUTH_SECRET', 'INBOUND_EMAIL_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] as const;

/** Variables an operator must review on the new server (never carried, because the value depends on the new host). */
export const ENV_REVIEW = ['APP_URL', 'NEXTAUTH_URL', 'CORS_ORIGINS', 'NEXT_PUBLIC_API_URL', 'API_INTERNAL_URL', 'INBOUND_EMAIL_DOMAIN', 'INBOUND_AUTHSERV_ID', 'PLAID_WEBHOOK_URL', 'GOOGLE_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_ID', 'DATABASE_URL', 'REDIS_URL', 'TOKEN_ENC_KEY', 'BACKUP_PASSPHRASE'] as const;

/** The carried variables that are set in the given environment. */
export function carriedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ENV_CARRY) if (env[k]) out[k] = env[k]!;
  return out;
}

/** The backup file name for a moment in time. */
export const backupFileName = (at: Date, prefix = 'pointwise'): string => `${prefix}-${at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-')}.pwbackup`;

/** Names of the backup files to delete so only the newest `keep` remain. Names sort by time. */
export function toPrune(names: string[], keep: number, prefix = 'pointwise'): string[] {
  const mine = names.filter((n) => n.startsWith(`${prefix}-`) && n.endsWith('.pwbackup')).sort();
  return keep > 0 ? mine.slice(0, Math.max(0, mine.length - keep)) : [];
}

/** A file name from a request, safe to join to the backup folder (no path parts). */
export const safeBackupName = (n: string): string | null => (/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.pwbackup$/.test(n) && !n.includes('..') ? n : null);
