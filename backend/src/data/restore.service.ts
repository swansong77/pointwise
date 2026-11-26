import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { encryptSecret } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { BackupHeader, DigestBook, manifestProblems, parseLine, rowLine } from '../domain/backup-format';
import { DATA_RULES, ModelMeta, SECRET_COLUMNS, insertOrder } from '../domain/data-registry';
import { decodeRow } from '../domain/data-serialize';
import { BackupService, decryptedLines } from './backup.service';
import { MaintenanceService } from './maintenance.service';

export interface RestoreOptions {
  /** an absolute path or a name inside the backup folder */
  file: string;
  passphrase: string;
  /** keep maintenance mode on afterwards (the default is to turn it off so the new server opens) */
  keepMaintenance?: boolean;
  /** make a pre-restore backup of what is there now (default: yes, when anything is there) */
  preBackup?: boolean;
}

export interface RestoreResult {
  rows: number;
  models: number;
  millis: number;
  preBackup: string | null;
  env: Record<string, string> | null;
  warnings: string[];
}

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);
const BATCH = 500;

/**
 * Restores a backup into this database. It checks the whole file first (a wrong passphrase or damage is found before
 * anything is touched), makes a backup of what is there, then empties the tables and fills them in dependency order in
 * ONE transaction, re-encrypting secrets with this server's key. If any count or checksum differs, or any row is
 * refused, the whole restore is rolled back.
 */
@Injectable()
export class RestoreService {
  private readonly logger = new Logger(RestoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupService,
    private readonly maintenance: MaintenanceService,
  ) {}

  private resolve(file: string): string {
    return file.includes('/') ? file : this.backups.pathOf(file);
  }

  async restore(opts: RestoreOptions): Promise<RestoreResult> {
    const started = Date.now();
    const file = this.resolve(opts.file);
    const check = await this.backups.verifyFile(file, opts.passphrase);
    if (!check.ok || !check.header || !check.manifest) throw new BadRequestException(`The backup cannot be restored: ${check.problems.join('; ') || 'it is not valid'}`);
    if (check.incompatible) throw new BadRequestException(check.incompatible);

    const header = check.header;
    const metas = new Map(this.backups.models().map((m) => [m.name, m]));
    const { deferred } = insertOrder(this.backups.models());
    const hasData = (await this.prisma.user.count()) > 0;
    let preBackup: string | null = null;
    if (hasData && opts.preBackup !== false) preBackup = (await this.backups.create({ passphrase: opts.passphrase, includeEphemeral: true, prefix: 'pre-restore' })).name;

    const warnings: string[] = [...check.manifest.warnings];
    let env: Record<string, string> | null = null;
    let rows = 0;
    const book = new DigestBook();

    await this.prisma.$transaction(
      async (tx) => {
        const tables = this.backups.models().map((m) => `"${(m as unknown as { dbName?: string | null }).dbName ?? m.name}"`).join(', ');
        await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
        let current: string | null = null;
        let batch: Record<string, unknown>[] = [];
        let later: Array<{ id: unknown; field: string; value: unknown; idField: string }> = [];

        const flush = async () => {
          if (current && batch.length) {
            const delegate = (tx as unknown as Record<string, { createMany(a: unknown): Promise<unknown> }>)[delegateName(current)];
            await delegate.createMany({ data: batch });
            batch = [];
          }
        };
        const finishModel = async () => {
          await flush();
          if (current && later.length) {
            const delegate = (tx as unknown as Record<string, { update(a: unknown): Promise<unknown> }>)[delegateName(current)];
            for (const l of later) await delegate.update({ where: { [l.idField]: l.id }, data: { [l.field]: l.value } });
            later = [];
          }
        };

        let first = true;
        for await (const raw of decryptedLines(file, opts.passphrase)) {
          const line = parseLine(raw);
          if (first) {
            first = false;
            continue; // the header, already checked
          }
          if (line.t === 'env') {
            env = line.vars;
            continue;
          }
          if (line.t !== 'row') continue;
          const meta = metas.get(line.m) as ModelMeta;
          if (!meta) throw new BadRequestException(`The backup has a row for an unknown model ${line.m}`);
          if (line.m !== current) {
            await finishModel();
            current = line.m;
          }
          book.add(line.m, rowLine(line.m, line.r));
          const encoded = { ...(line.r as Record<string, never>) };
          for (const c of SECRET_COLUMNS[line.m] ?? []) if (typeof encoded[c] === 'string') encoded[c] = encryptSecret(encoded[c] as unknown as string) as never;
          const idField = meta.fields.find((f) => f.isId)!.name;
          const defers = deferred.filter((d) => d.model === line.m);
          const data = decodeRow(meta, encoded);
          for (const d of defers) {
            if (data[d.field] != null) later.push({ id: data[idField], field: d.field, value: data[d.field], idField });
            data[d.field] = null;
          }
          batch.push(data);
          rows++;
          if (batch.length >= BATCH) await flush();
        }
        await finishModel();

        // every model's rows must match what the manifest promised
        const problems = manifestProblems(book.result(), check.manifest!, header.models);
        if (problems.length) throw new BadRequestException(`The restore was rolled back: ${problems.join('; ')}`);
        for (const m of header.models) {
          const count = await (tx as unknown as Record<string, { count(): Promise<number> }>)[delegateName(m)].count();
          const want = check.manifest!.models[m].count;
          if (count !== want) throw new BadRequestException(`The restore was rolled back: ${m} has ${count} row(s) after the restore, the backup has ${want}`);
        }
        if (!opts.keepMaintenance) await tx.systemSetting.deleteMany({ where: { key: 'maintenance' } });
      },
      { timeout: 7_200_000, maxWait: 60_000 },
    );
    this.maintenance.forget();
    this.logger.log(`restored ${rows} rows from ${header.createdAt}`);
    return { rows, models: header.models.length, millis: Date.now() - started, preBackup, env, warnings };
  }
}

export type { BackupHeader };
