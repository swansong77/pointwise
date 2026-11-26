import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, chmodSync } from 'fs';
import { join } from 'path';
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { pipeline as pipelineCb } from 'stream';
import { createGzip, createGunzip } from 'zlib';
import { decryptSecret } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { BackupCryptoError, DecryptStream, EncryptStream, passphraseProblem } from '../domain/backup-crypto';
import { BackupHeader, BackupManifest, DigestBook, Line, backupFileName, carriedEnv, envLine, headerLine, headerProblem, manifestLine, manifestProblems, parseLine, rowLine, safeBackupName, toPrune } from '../domain/backup-format';
import { DATA_RULES, ModelMeta, SECRET_COLUMNS, idOf, insertOrder } from '../domain/data-registry';
import { encodeRow } from '../domain/data-serialize';

export interface CreateOptions {
  passphrase: string;
  includeEphemeral?: boolean;
  includeEnv?: boolean;
  /** file name prefix: pointwise (regular) or pre-restore (kept apart from the retention count) */
  prefix?: string;
}

export interface BackupInfo {
  name: string;
  bytes: number;
  modifiedAt: string;
}

export interface VerifyResult {
  ok: boolean;
  header: BackupHeader | null;
  manifest: BackupManifest | null;
  hasEnv: boolean;
  problems: string[];
  /** why it cannot be restored on this server (null when it can) */
  incompatible: string | null;
}

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);
const PAGE = 1000;

/** Streaming reader of the lines inside an encrypted backup file. Errors in any stage surface where it is iterated. */
export async function* decryptedLines(file: string, passphrase: string): AsyncGenerator<string> {
  const out = new PassThrough();
  out.setEncoding('utf8');
  pipelineCb(createReadStream(file), new DecryptStream(passphrase), createGunzip(), out, (err) => {
    if (err) out.destroy(err);
  });
  let buf = '';
  for await (const chunk of out as AsyncIterable<string>) {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ───────────── schema facts

  models(): ModelMeta[] {
    return Prisma.dmmf.datamodel.models as unknown as ModelMeta[];
  }

  order(): string[] {
    return insertOrder(this.models()).order;
  }

  /** The newest finished database migration: the "schema version" a backup is tied to. */
  async migration(): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`;
    return rows[0]?.migration_name ?? 'none';
  }

  appVersion(): string {
    return process.env.APP_VERSION ?? '0.1.0';
  }

  // ───────────── files

  dir(): string {
    const d = process.env.BACKUP_DIR || '/var/backups/pointwise';
    if (!existsSync(d)) mkdirSync(d, { recursive: true, mode: 0o700 });
    return d;
  }

  list(): BackupInfo[] {
    const d = this.dir();
    return readdirSync(d)
      .filter((n) => safeBackupName(n))
      .map((name) => {
        const st = statSync(join(d, name));
        return { name, bytes: st.size, modifiedAt: st.mtime.toISOString() };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  pathOf(name: string): string {
    const safe = safeBackupName(name);
    if (!safe) throw new BadRequestException('That is not a valid backup file name.');
    const p = join(this.dir(), safe);
    if (!existsSync(p)) throw new NotFoundException('Backup not found');
    return p;
  }

  remove(name: string): void {
    unlinkSync(this.pathOf(name));
  }

  /** Keeps the newest `keep` regular backups and deletes the rest. */
  prune(keep: number): string[] {
    const gone = toPrune(this.list().map((b) => b.name), keep);
    for (const n of gone) unlinkSync(join(this.dir(), n));
    return gone;
  }

  // ───────────── create

  private async *lines(tx: Prisma.TransactionClient, opts: CreateOptions, book: DigestBook, warnings: string[]): AsyncGenerator<string> {
    const order = this.order().filter((m) => opts.includeEphemeral || DATA_RULES[m]?.cls !== 'EPHEMERAL');
    const metas = new Map(this.models().map((m) => [m.name, m]));
    const header: BackupHeader = JSON.parse(headerLine({ appVersion: this.appVersion(), migration: await this.migration(), createdAt: new Date().toISOString(), includesEphemeral: !!opts.includeEphemeral, includesEnv: !!opts.includeEnv, models: order }));
    yield JSON.stringify(header) + '\n';
    for (const model of order) {
      book.ensure(model);
      const meta = metas.get(model)!;
      const id = idOf(meta);
      const secrets = SECRET_COLUMNS[model] ?? [];
      const delegate = (tx as unknown as Record<string, { findMany(a: unknown): Promise<Record<string, unknown>[]> }>)[delegateName(model)];
      let cursor: unknown = undefined;
      for (;;) {
        const rows = await delegate.findMany({ take: PAGE, orderBy: { [id]: 'asc' }, ...(cursor !== undefined ? { skip: 1, cursor: { [id]: cursor } } : {}) });
        for (const row of rows) {
          const enc = encodeRow(meta, row);
          for (const c of secrets) {
            const v = enc[c];
            if (typeof v === 'string') {
              try {
                enc[c] = decryptSecret(v);
              } catch {
                enc[c] = null;
                warnings.push(`${model}.${c} of ${String(row[id])} could not be decrypted with this server's key and was left out`);
              }
            }
          }
          const line = rowLine(model, enc);
          book.add(model, line);
          yield line + '\n';
        }
        if (rows.length < PAGE) break;
        cursor = rows[rows.length - 1][id];
      }
    }
    if (opts.includeEnv) yield envLine(carriedEnv(process.env)) + '\n';
    yield manifestLine({ models: book.result(), totalRows: Object.values(book.result()).reduce((s, d) => s + d.count, 0), warnings: warnings.slice(0, 50) }) + '\n';
  }

  /** Writes a consistent snapshot of the whole database to an encrypted file in the backup folder. */
  async create(opts: CreateOptions): Promise<{ name: string; bytes: number; manifest: BackupManifest }> {
    const problem = passphraseProblem(opts.passphrase);
    if (problem) throw new BadRequestException(problem);
    const name = backupFileName(new Date(), opts.prefix ?? 'pointwise');
    const final = join(this.dir(), name);
    const partial = `${final}.partial`;
    const book = new DigestBook();
    const warnings: string[] = [];
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await pipeline(Readable.from(this.lines(tx, opts, book, warnings)), createGzip(), new EncryptStream(opts.passphrase), createWriteStream(partial, { mode: 0o600 }));
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 3_600_000, maxWait: 60_000 },
      );
      renameSync(partial, final);
      chmodSync(final, 0o600);
    } catch (e) {
      if (existsSync(partial)) unlinkSync(partial);
      throw e;
    }
    const digests = book.result();
    const manifest: BackupManifest = { t: 'manifest', models: digests, totalRows: Object.values(digests).reduce((s, d) => s + d.count, 0), warnings };
    this.logger.log(`backup ${name}: ${manifest.totalRows} rows`);
    return { name, bytes: statSync(final).size, manifest };
  }

  // ───────────── verify

  /** Reads the whole file, checking every frame, every row's checksum and the manifest, without touching the database. */
  async verifyFile(file: string, passphrase: string): Promise<VerifyResult> {
    const result: VerifyResult = { ok: false, header: null, manifest: null, hasEnv: false, problems: [], incompatible: null };
    const book = new DigestBook();
    let first = true;
    try {
      for await (const raw of decryptedLines(file, passphrase)) {
        const line: Line = parseLine(raw);
        if (first) {
          if (line.t !== 'header') throw new Error('the backup does not start with a header');
          result.header = line;
          line.models.forEach((m) => book.ensure(m));
          first = false;
        } else if (line.t === 'row') {
          if (!result.header!.models.includes(line.m)) result.problems.push(`a row of ${line.m} appears but ${line.m} is not in the header`);
          else book.add(line.m, rowLine(line.m, line.r));
        } else if (line.t === 'env') result.hasEnv = true;
        else if (line.t === 'manifest') result.manifest = line;
      }
    } catch (e) {
      result.problems.push(e instanceof BackupCryptoError || e instanceof Error ? e.message : String(e));
      return result;
    }
    if (!result.header) result.problems.push('the backup is empty');
    else if (!result.manifest) result.problems.push('the backup has no manifest (it was cut short)');
    else result.problems.push(...manifestProblems(book.result(), result.manifest, result.header.models));
    if (result.header) result.incompatible = headerProblem(result.header, { migration: await this.migration(), models: this.models().map((m) => m.name) });
    result.ok = result.problems.length === 0;
    return result;
  }
}
