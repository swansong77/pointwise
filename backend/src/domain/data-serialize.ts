import { Prisma } from '@prisma/client';
import { FieldMeta, ModelMeta, columnsOf } from './data-registry';

/**
 * Row encoding for backups and exports: a row read from Prisma becomes plain JSON, and JSON becomes a value Prisma accepts
 * on write. Types that JSON cannot carry are written as strings (DateTime ISO, Decimal, BigInt) or base64 (Bytes).
 * A nullable Json column holding SQL NULL is kept apart from a JSON null.
 */
export type Encoded = string | number | boolean | null | Encoded[] | { [k: string]: Encoded };
export const NULL_JSON = { $json: null } as const;

export function encodeValue(f: Pick<FieldMeta, 'type' | 'isList' | 'isRequired'>, v: unknown): Encoded {
  if (v === null || v === undefined) return null;
  if (f.isList && Array.isArray(v)) return v.map((x) => encodeValue({ ...f, isList: false }, x));
  switch (f.type) {
    case 'DateTime':
      return (v as Date).toISOString();
    case 'Decimal':
      return String(v);
    case 'BigInt':
      return String(v);
    case 'Bytes':
      return Buffer.from(v as Uint8Array).toString('base64');
    case 'Json':
      return v === Prisma.JsonNull ? (NULL_JSON as unknown as Encoded) : (v as Encoded);
    default:
      return v as Encoded;
  }
}

export function decodeValue(f: Pick<FieldMeta, 'type' | 'isList' | 'isRequired'>, v: Encoded | undefined): unknown {
  if (v === undefined) return undefined;
  if (v === null) return f.type === 'Json' ? (f.isRequired ? Prisma.JsonNull : Prisma.DbNull) : null;
  if (f.isList && Array.isArray(v)) return v.map((x) => decodeValue({ ...f, isList: false }, x));
  switch (f.type) {
    case 'DateTime': {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) throw new Error(`invalid date "${String(v).slice(0, 40)}"`);
      return d;
    }
    case 'Decimal':
      return new Prisma.Decimal(String(v));
    case 'BigInt':
      return BigInt(String(v));
    case 'Bytes':
      return Buffer.from(String(v), 'base64');
    case 'Json':
      return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && '$json' in v && (v as { $json: unknown }).$json === null ? Prisma.JsonNull : v;
    default:
      return v;
  }
}

/** A whole row to JSON. Only the columns named are written. */
export function encodeRow(m: ModelMeta, row: Record<string, unknown>, only?: string[]): Record<string, Encoded> {
  const out: Record<string, Encoded> = {};
  for (const c of columnsOf(m)) if (!only || only.includes(c.name)) out[c.name] = encodeValue(c, row[c.name]);
  return out;
}

/** JSON back to a Prisma create payload. Columns the schema does not have are rejected (never silently written). */
export function decodeRow(m: ModelMeta, row: Record<string, Encoded>, allowed?: string[]): Record<string, unknown> {
  const cols = new Map(columnsOf(m).map((c) => [c.name, c]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const c = cols.get(k);
    if (!c) throw new Error(`${m.name} has no column "${k}"`);
    if (allowed && !allowed.includes(k)) continue;
    out[k] = decodeValue(c, v);
  }
  return out;
}

/** Stable JSON for hashing: keys in schema order are already stable, so this is the compact form. */
export const lineOf = (value: unknown): string => JSON.stringify(value);
