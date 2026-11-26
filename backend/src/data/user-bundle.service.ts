import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import { PrismaService } from '../common/prisma.service';
import { ALWAYS_DROP, CATALOG_KEYS, DATA_RULES, ModelMeta, columnsOf, foreignKeys, idOf, importableColumns, insertOrder, scopeWhere, userModels } from '../domain/data-registry';
import { Encoded, decodeRow, encodeRow } from '../domain/data-serialize';

export const BUNDLE_FORMAT = 'pointwise-user-data';
export const BUNDLE_VERSION = 1;
export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
export const MAX_BUNDLE_ROWS = 500_000;

type Row = Record<string, Encoded>;
type CatalogKey = Record<string, unknown>;

export interface UserBundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  appVersion: string;
  migration: string;
  exportedAt: string;
  user: { name: string | null; countryCode: string | null };
  models: Record<string, Row[]>;
  /** for every id of a catalog row the member's rows point at: how to find the same row on another server */
  catalog: Record<string, Record<string, CatalogKey>>;
  needsReconnect: Array<{ kind: string; count: number; note: string }>;
  counts: Record<string, number>;
}

export interface ImportReport {
  mode: 'merge' | 'replace';
  dryRun: boolean;
  created: Record<string, number>;
  /** settings that already existed and were overwritten by the file */
  updated: Record<string, number>;
  duplicates: Record<string, number>;
  unmapped: Record<string, number>;
  notRestored: Array<{ model: string; rows: number; why: string }>;
  warnings: string[];
  totals: { created: number; duplicates: number; unmapped: number };
}

class DryRunDone extends Error {
  constructor(readonly report: ImportReport) {
    super('dry run');
  }
}

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);
const del = (tx: Prisma.TransactionClient | PrismaService, model: string) =>
  (tx as unknown as Record<string, { findMany(a: unknown): Promise<Record<string, unknown>[]>; findFirst(a: unknown): Promise<Record<string, unknown> | null>; create(a: unknown): Promise<Record<string, unknown>>; createMany(a: unknown): Promise<unknown>; deleteMany(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> }>)[delegateName(model)];

const NOT_RESTORED_WHY: Record<string, string> = {
  User: 'your account (email, password, role) is not changed by an import',
  Subscription: 'your plan is not changed by an import',
  BankConnection: 'bank links must be reconnected',
  Mailbox: 'connected mailboxes must be reconnected',
};

/** Builds a member's data bundle and applies one to an account. Secrets and credentials never travel in a bundle. */
@Injectable()
export class UserBundleService {
  constructor(private readonly prisma: PrismaService) {}

  private metas(): Map<string, ModelMeta> {
    return new Map((Prisma.dmmf.datamodel.models as unknown as ModelMeta[]).map((m) => [m.name, m]));
  }

  private async migration(): Promise<string> {
    const r = await this.prisma.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`;
    return r[0]?.migration_name ?? 'none';
  }

  // ───────────── export

  /** Every row of the member that the registry says belongs to them, as a bundle. */
  async build(userId: string): Promise<UserBundle> {
    const metas = this.metas();
    const all = [...metas.values()];
    const order = insertOrder(all, DATA_RULES).order;
    const exported = userModels(order);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, countryCode: true } });
    const bundle: UserBundle = { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, appVersion: process.env.APP_VERSION ?? '0.1.0', migration: await this.migration(), exportedAt: new Date().toISOString(), user: { name: user.name ?? null, countryCode: user.countryCode ?? null }, models: {}, catalog: {}, needsReconnect: [], counts: {} };
    const rowsByModel = new Map<string, Record<string, unknown>[]>();
    for (const model of exported) {
      const meta = metas.get(model)!;
      const rule = DATA_RULES[model];
      const rows = await del(this.prisma, model).findMany({ where: scopeWhere(rule.scope!, userId) });
      if (!rows.length) continue;
      const cols = importableColumns(meta);
      const pk = idOf(meta);
      const keep = cols.includes(pk) ? cols : [pk, ...cols];
      bundle.models[model] = rows.map((r) => encodeRow(meta, r, keep));
      bundle.counts[model] = rows.length;
      rowsByModel.set(model, rows);
    }
    // ids the member's rows point at that are not the member's own rows are catalog rows: record how to find them again
    const wanted = new Map<string, Set<string>>();
    for (const [model, rows] of rowsByModel) {
      for (const fk of this.refsOf(metas.get(model)!)) {
        if (fk.target === 'User') continue;
        const own = new Set((rowsByModel.get(fk.target) ?? []).map((r) => String(r[idOf(metas.get(fk.target)!)])));
        for (const r of rows) {
          const v = r[fk.field];
          if (typeof v === 'string' && !own.has(v)) (wanted.get(fk.target) ?? wanted.set(fk.target, new Set()).get(fk.target)!).add(v);
        }
      }
    }
    for (const [target, ids] of wanted) {
      if (!CATALOG_KEYS[target]) continue;
      bundle.catalog[target] = {};
      for (const id of ids) {
        const key = await this.catalogKey(target, id, metas);
        if (key) bundle.catalog[target][id] = key;
      }
    }
    bundle.needsReconnect = await this.reconnectList(userId);
    return bundle;
  }

  /** Declared foreign keys plus the registry's extra reference columns. */
  private refsOf(meta: ModelMeta): Array<{ field: string; target: string; optional: boolean }> {
    const list = foreignKeys(meta);
    for (const [field, target] of Object.entries(DATA_RULES[meta.name]?.refs ?? {})) if (!list.some((l) => l.field === field)) list.push({ field, target, optional: true });
    return list;
  }

  /** How to find a catalog row again: its natural key, with references inside it replaced by their own natural keys. */
  private async catalogKey(model: string, id: string, metas: Map<string, ModelMeta>, depth = 0): Promise<CatalogKey | null> {
    if (depth > 3) return null;
    const meta = metas.get(model)!;
    const row = await del(this.prisma, model).findFirst({ where: { id } });
    if (!row) return null;
    const out: CatalogKey = {};
    for (const col of CATALOG_KEYS[model]) {
      const fk = foreignKeys(meta).find((f) => f.field === col);
      if (fk && CATALOG_KEYS[fk.target]) {
        const v = row[col];
        out[col] = typeof v === 'string' ? await this.catalogKey(fk.target, v, metas, depth + 1) : null;
      } else out[col] = row[col] instanceof Date ? (row[col] as Date).toISOString() : row[col];
    }
    return out;
  }

  private async reconnectList(userId: string): Promise<UserBundle['needsReconnect']> {
    const n = async (p: Promise<number>) => p;
    const out: UserBundle['needsReconnect'] = [];
    const add = (kind: string, count: number, note: string) => count && out.push({ kind, count, note });
    add('bank', await n(this.prisma.bankConnection.count({ where: { userId } })), 'Reconnect each bank link in Import.');
    add('mailbox', await n(this.prisma.mailbox.count({ where: { userId } })), 'Reconnect each mailbox in Settings.');
    add('offerLogin', await n(this.prisma.offerAccount.count({ where: { userId, credentialEnc: { not: null } } })), 'Offer accounts come back without their login; enter it again and turn server-side login on if you want it.');
    add('extensionToken', await n(this.prisma.personalAccessToken.count({ where: { userId, revokedAt: null } })), 'Create new extension and assistant tokens.');
    add('forwardingAddress', await n(this.prisma.emailInbox.count({ where: { userId } })), 'Your forwarding address is created again for this server.');
    add('aiConsent', await n(this.prisma.aiSettings.count({ where: { userId, consentedAt: { not: null } } })), 'Confirm your AI consent again before using the assistant.');
    return out;
  }

  /** The bundle as the file a member downloads (gzip when asked). */
  toFile(b: UserBundle, gzip = false): Buffer {
    const json = Buffer.from(JSON.stringify(b));
    return gzip ? gzipSync(json) : json;
  }

  // ───────────── import

  /** Parses and checks an uploaded file. Throws a clear message for anything that is not a usable bundle. */
  parse(file: Buffer): UserBundle {
    if (file.length > MAX_BUNDLE_BYTES) throw new BadRequestException(`The file is larger than ${MAX_BUNDLE_BYTES / 1_048_576} MB.`);
    let text: string;
    try {
      text = (file[0] === 0x1f && file[1] === 0x8b ? gunzipSync(file, { maxOutputLength: MAX_BUNDLE_BYTES * 4 }) : file).toString('utf8');
    } catch {
      throw new BadRequestException('The file could not be unpacked.');
    }
    let b: UserBundle;
    try {
      b = JSON.parse(text) as UserBundle;
    } catch {
      throw new BadRequestException('The file is not valid JSON.');
    }
    if (!b || typeof b !== 'object' || b.format !== BUNDLE_FORMAT) throw new BadRequestException('This is not a PointWise data file.');
    if (typeof b.version !== 'number' || b.version > BUNDLE_VERSION) throw new BadRequestException('This file was written by a newer PointWise. Upgrade this server first.');
    if (!b.models || typeof b.models !== 'object' || Array.isArray(b.models)) throw new BadRequestException('The file has no data section.');
    let rows = 0;
    for (const [m, list] of Object.entries(b.models)) {
      if (!Array.isArray(list)) throw new BadRequestException(`${m} is not a list.`);
      rows += list.length;
      for (const r of list) if (!r || typeof r !== 'object' || Array.isArray(r)) throw new BadRequestException(`${m} has a row that is not an object.`);
    }
    if (rows > MAX_BUNDLE_ROWS) throw new BadRequestException(`The file has more than ${MAX_BUNDLE_ROWS} rows.`);
    b.catalog = b.catalog && typeof b.catalog === 'object' ? b.catalog : {};
    return b;
  }

  /** Looks a catalog row up on this server from the key written at export time. */
  private async resolveCatalog(tx: Prisma.TransactionClient, model: string, key: CatalogKey, cache: Map<string, string | null>, metas: Map<string, ModelMeta>): Promise<string | null> {
    const ck = `${model}:${JSON.stringify(key)}`;
    if (cache.has(ck)) return cache.get(ck)!;
    const meta = metas.get(model);
    if (!meta || !CATALOG_KEYS[model]) return null;
    const where: Record<string, unknown> = {};
    for (const col of CATALOG_KEYS[model]) {
      const fk = foreignKeys(meta).find((f) => f.field === col);
      const v = key[col];
      if (fk && CATALOG_KEYS[fk.target]) {
        if (v === null || v === undefined) where[col] = null;
        else {
          const id = await this.resolveCatalog(tx, fk.target, v as CatalogKey, cache, metas);
          if (!id) {
            cache.set(ck, null);
            return null;
          }
          where[col] = id;
        }
      } else {
        const colMeta = meta.fields.find((f) => f.name === col);
        where[col] = colMeta?.type === 'DateTime' && typeof v === 'string' ? new Date(v) : (v ?? null);
      }
    }
    // a member's own cards and offers are created by the import itself; only shared catalog rows are looked up
    if (meta.fields.some((f) => f.name === 'ownerId')) where.ownerId = null;
    if (meta.fields.some((f) => f.name === 'createdById') && model === 'Offer') where.createdById = null;
    const found = await del(tx, model).findFirst({ where });
    const id = found ? String(found[idOf(meta)]) : null;
    cache.set(ck, id);
    return id;
  }

  /**
   * Applies a bundle to the member's account in one transaction. `merge` adds what is missing (matched by natural key, or by
   * content); `replace` first removes the member's own data (never the account, plan or credentials). `dryRun` does everything and
   * rolls back, so the report shows exactly what a real import would do.
   */
  async apply(userId: string, bundle: UserBundle, mode: 'merge' | 'replace', dryRun: boolean): Promise<ImportReport> {
    const metas = this.metas();
    const order = insertOrder([...metas.values()], DATA_RULES).order;
    const exported = userModels(order);
    const report: ImportReport = { mode, dryRun, created: {}, updated: {}, duplicates: {}, unmapped: {}, notRestored: [], warnings: [], totals: { created: 0, duplicates: 0, unmapped: 0 } };
    const known = new Set(exported);
    for (const m of Object.keys(bundle.models)) if (!known.has(m)) report.warnings.push(`${m} is not a data type this server knows and was ignored`);

    try {
      await this.prisma.$transaction(
        async (tx) => {
          if (mode === 'replace') {
            for (const model of [...exported].reverse()) {
              const rule = DATA_RULES[model];
              if (rule.importable === false || model === 'Wallet') continue;
              await del(tx, model).deleteMany({ where: scopeWhere(rule.scope!, userId) });
            }
            if (bundle.user) await tx.user.update({ where: { id: userId }, data: { ...(bundle.user.name !== null ? { name: bundle.user.name } : {}), ...(bundle.user.countryCode ? { countryCode: bundle.user.countryCode } : {}) } });
          }
          const idMap = new Map<string, Map<string, string>>();
          const cache = new Map<string, string | null>();
          for (const model of exported) {
            const rows = bundle.models[model];
            if (!rows?.length) continue;
            const rule = DATA_RULES[model];
            const meta = metas.get(model)!;
            if (rule.importable === false) {
              report.notRestored.push({ model, rows: rows.length, why: NOT_RESTORED_WHY[model] ?? 'needs a reconnect' });
              continue;
            }
            const result = await this.importModel(tx, userId, model, meta, rows, mode, idMap, cache, metas, bundle, report);
            report.created[model] = result.created;
            if (result.updated) report.updated[model] = result.updated;
            if (result.duplicates) report.duplicates[model] = result.duplicates;
            if (result.unmapped) report.unmapped[model] = result.unmapped;
          }
          for (const k of ['created', 'duplicates', 'unmapped'] as const) report.totals[k] = Object.values(report[k]).reduce((s, n) => s + n, 0);
          if (dryRun) throw new DryRunDone(report);
        },
        { timeout: 600_000, maxWait: 30_000 },
      );
    } catch (e) {
      if (e instanceof DryRunDone) return e.report;
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(`The import was rolled back: ${e instanceof Error ? e.message.split('\n').slice(-2).join(' ').slice(0, 300) : 'unknown error'}`);
    }
    return report;
  }

  private async importModel(
    tx: Prisma.TransactionClient,
    userId: string,
    model: string,
    meta: ModelMeta,
    rows: Row[],
    mode: 'merge' | 'replace',
    idMap: Map<string, Map<string, string>>,
    cache: Map<string, string | null>,
    metas: Map<string, ModelMeta>,
    bundle: UserBundle,
    report: ImportReport,
  ): Promise<{ created: number; updated: number; duplicates: number; unmapped: number }> {
    const rule = DATA_RULES[model];
    const cols = new Set(importableColumns(meta));
    const colMeta = new Map(columnsOf(meta).map((c) => [c.name, c]));
    const pk = idOf(meta);
    const refs = this.refsOf(meta);
    const own = rule.scope!.split('.').length === 1 ? rule.scope! : null; // userId / ownerId / createdById / id
    const map = idMap.get(model) ?? idMap.set(model, new Map()).get(model)!;
    let created = 0;
    let updated = 0;
    let duplicates = 0;
    let unmapped = 0;
    let unknown = 0;
    // rows that were there before this import: only these can make an incoming row a duplicate (two identical rows in one file are both kept)
    const before = new Set<string>();
    if (mode === 'merge' || model === 'Wallet') for (const r of await del(tx, model).findMany({ where: scopeWhere(rule.scope!, userId) })) before.add(String(r[pk]));

    for (const raw of rows) {
      const oldId = typeof raw[pk] === 'string' ? (raw[pk] as string) : undefined;
      const data: Record<string, Encoded> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (k === pk) continue;
        if (!colMeta.has(k)) {
          unknown++;
          continue;
        }
        if (cols.has(k)) data[k] = v;
      }
      // ownership always belongs to the member doing the import
      if (own && own !== 'id' && colMeta.has(own)) data[own] = userId;
      for (const [k, v] of Object.entries(rule.force ?? {})) data[k] = v as Encoded;

      // references: other rows of the bundle, the member, or catalog rows found on this server
      let drop = false;
      for (const r of refs) {
        if (r.field === own || !(r.field in data) || data[r.field] === null) continue;
        const v = data[r.field] as string;
        let target: string | null = null;
        if (r.target === 'User') target = userId;
        else {
          target = idMap.get(r.target)?.get(v) ?? null;
          if (!target && bundle.catalog?.[r.target]?.[v]) target = await this.resolveCatalog(tx, r.target, bundle.catalog[r.target][v], cache, metas);
        }
        if (target) data[r.field] = target;
        else if (r.optional) data[r.field] = null;
        else drop = true;
      }
      if (drop) {
        unmapped++;
        continue;
      }
      if (model === 'CreditCard' && typeof data.slug === 'string') {
        const taken = await tx.creditCard.findUnique({ where: { slug: data.slug }, select: { id: true, ownerId: true } });
        if (taken && taken.ownerId !== userId) data.slug = `${data.slug}-${randomUUID().slice(0, 6)}`;
      }

      // already there? (a merge adds only what is missing)
      if (before.size) {
        const existing = await del(tx, model).findFirst({ where: { AND: [this.sameRow(meta, rule.natural, data, colMeta), { [pk]: { in: [...before] } }] } });
        if (existing) {
          if (oldId) map.set(oldId, String(existing[pk]));
          if (rule.singleton) {
            // settings: the file wins, so a new account takes on the settings of the old one
            const { [pk]: _pk, ...rest } = decodeRow(meta, { ...data, [pk]: String(existing[pk]) });
            if (own && own !== 'id') delete rest[own];
            await del(tx, model).update({ where: { [pk]: existing[pk] }, data: rest });
            updated++;
          } else duplicates++;
          continue;
        }
      }
      const newId = pk === 'userId' ? userId : randomUUID();
      const payload = decodeRow(meta, { ...data, [pk]: newId });
      try {
        await del(tx, model).create({ data: payload });
      } catch (e) {
        throw new BadRequestException(`${model} could not be imported: ${e instanceof Error ? e.message.split('\n').slice(-2).join(' ').slice(0, 200) : 'refused'}`);
      }
      if (oldId) map.set(oldId, newId);
      created++;
    }
    if (unknown) report.warnings.push(`${model}: ${unknown} column value(s) from a different version were ignored`);
    if (unmapped) report.warnings.push(`${model}: ${unmapped} row(s) were skipped because the card, merchant or other shared item they refer to does not exist on this server`);
    return { created, updated, duplicates, unmapped };
  }

  /** A where clause that finds the same row in the member's data: by natural key when the model has one, else by every plain column. */
  private sameRow(meta: ModelMeta, natural: string[] | undefined, data: Record<string, Encoded>, colMeta: Map<string, { name: string; type: string; isList?: boolean; kind: string }>): Record<string, unknown> {
    // a natural key with an empty part (a card without a last four, a transaction without an external id) cannot identify a row; compare every plain column instead
    const usable = natural?.length && natural.every((n) => data[n] !== undefined && data[n] !== null);
    const names = usable ? natural! : [...colMeta.keys()].filter((c) => !['createdAt', 'updatedAt', 'addedAt'].includes(c) && colMeta.get(c)!.type !== 'Json' && c !== idOf(meta));
    const where: Record<string, unknown> = {};
    for (const n of names) {
      const c = colMeta.get(n);
      if (!c || !(n in data)) continue;
      const v = data[n];
      const decoded = decodeRow(meta, { [n]: v } as Record<string, Encoded>)[n];
      where[n] = c.isList ? { equals: decoded } : decoded === undefined ? null : decoded;
    }
    return where;
  }
}

export { ALWAYS_DROP };
