import { Prisma } from '@prisma/client';
import { Readable, Transform, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { BackupCryptoError, DecryptStream, EncryptStream, passphraseProblem } from '../../../src/domain/backup-crypto';
import { backupFileName, BackupHeader, BackupManifest, carriedEnv, DigestBook, headerLine, headerProblem, manifestLine, manifestProblems, parseLine, rowLine, safeBackupName, toPrune } from '../../../src/domain/backup-format';
import { ModelMeta } from '../../../src/domain/data-registry';
import { decodeRow, decodeValue, encodeRow, encodeValue } from '../../../src/domain/data-serialize';

const PASS = 'correct horse battery staple';

const collect = async (src: Readable, ...ts: Transform[]): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(c: Buffer, _e, cb) {
      chunks.push(c);
      cb();
    },
  });
  await pipeline([src, ...ts, sink] as never);
  return Buffer.concat(chunks);
};
const encrypt = (data: Buffer | string, pass = PASS) => collect(Readable.from([Buffer.from(data)]), new EncryptStream(pass, 10));
const decrypt = (file: Buffer, pass = PASS) => collect(Readable.from([file]), new DecryptStream(pass));

describe('backup encryption stream', () => {
  it('round-trips small, empty and multi-frame data', async () => {
    for (const size of [0, 1, 64 * 1024, 64 * 1024 + 1, 300_000]) {
      const data = Buffer.alloc(size, 7);
      const file = await encrypt(data);
      expect(file.subarray(0, 4).toString()).toBe('PWBK');
      expect((await decrypt(file)).equals(data)).toBe(true);
    }
  });

  it('works when the file arrives in tiny pieces', async () => {
    const data = Buffer.from('x'.repeat(200_000));
    const file = await encrypt(data);
    const pieces: Buffer[] = [];
    for (let i = 0; i < file.length; i += 977) pieces.push(file.subarray(i, i + 977));
    const out = await collect(Readable.from(pieces), new DecryptStream(PASS));
    expect(out.equals(data)).toBe(true);
  });

  it('does not contain the plaintext and differs every time (random salt and nonces)', async () => {
    const a = await encrypt('secret-value-12345');
    expect(a.toString('latin1')).not.toContain('secret-value');
    expect((await encrypt('secret-value-12345')).equals(a)).toBe(false);
  });

  it('refuses a wrong passphrase', async () => {
    const file = await encrypt('hello');
    await expect(decrypt(file, 'another passphrase here')).rejects.toThrow(/passphrase is wrong/);
  });

  it('detects a changed byte, removed frames, reordered frames, truncation and trailing data', async () => {
    const data = Buffer.alloc(200_000, 3);
    const file = await encrypt(data);
    const flipped = Buffer.from(file);
    flipped[flipped.length - 40] ^= 1;
    await expect(decrypt(flipped)).rejects.toThrow(BackupCryptoError);
    await expect(decrypt(file.subarray(0, file.length - 10))).rejects.toThrow(/incomplete|damaged|passphrase/);
    await expect(decrypt(Buffer.concat([file, Buffer.from('extra')]))).rejects.toThrow(/extra data|damaged/);
    // drop the last frame: the rest verifies as "not last" and the file ends early
    const head = 22;
    const lens: number[] = [];
    for (let o = head; o < file.length; ) { const l = file.readUInt32BE(o); lens.push(4 + l); o += 4 + l; }
    expect(lens.length).toBeGreaterThan(2);
    const withoutLast = file.subarray(0, file.length - lens[lens.length - 1]);
    await expect(decrypt(withoutLast)).rejects.toThrow(/incomplete/);
    // swap the first two frames
    const f0 = file.subarray(head, head + lens[0]);
    const f1 = file.subarray(head + lens[0], head + lens[0] + lens[1]);
    const rest = file.subarray(head + lens[0] + lens[1]);
    await expect(decrypt(Buffer.concat([file.subarray(0, head), f1, f0, rest]))).rejects.toThrow(BackupCryptoError);
  });

  it('refuses files that are not backups or are from another version', async () => {
    await expect(decrypt(Buffer.from('this is not a backup file at all, sorry'))).rejects.toThrow(/not a PointWise backup/);
    const file = await encrypt('x');
    const v = Buffer.from(file);
    v[4] = 9;
    await expect(decrypt(v)).rejects.toThrow(/Unsupported backup file version/);
    const c = Buffer.from(file);
    c[5] = 40;
    await expect(decrypt(c)).rejects.toThrow(/header is damaged/);
    await expect(decrypt(Buffer.from('PW'))).rejects.toThrow(/not a PointWise backup/);
  });

  it('checks the passphrase before use', () => {
    expect(passphraseProblem(undefined)).toMatch(/at least 12/);
    expect(passphraseProblem('short')).toMatch(/at least 12/);
    expect(passphraseProblem('aaaaaaaaaaaaaaaa')).toMatch(/repeated/);
    expect(passphraseProblem(PASS)).toBeNull();
    expect(() => new EncryptStream('short')).toThrow(/at least 12/);
  });
});

describe('row encoding', () => {
  const f = (type: string, extra: Record<string, unknown> = {}) => ({ type, isRequired: true, ...extra });

  it('round-trips every scalar type', () => {
    const date = new Date('2026-11-26T12:34:56.789Z');
    expect(encodeValue(f('DateTime'), date)).toBe('2026-11-26T12:34:56.789Z');
    expect(decodeValue(f('DateTime'), '2026-11-26T12:34:56.789Z')).toEqual(date);
    expect(encodeValue(f('Decimal'), new Prisma.Decimal('12.50'))).toBe('12.5');
    expect(String(decodeValue(f('Decimal'), '12.5'))).toBe('12.5');
    expect(encodeValue(f('BigInt'), 9007199254740993n)).toBe('9007199254740993');
    expect(decodeValue(f('BigInt'), '9007199254740993')).toBe(9007199254740993n);
    expect(encodeValue(f('Bytes'), Buffer.from([1, 2, 3]))).toBe('AQID');
    expect([...(decodeValue(f('Bytes'), 'AQID') as Buffer)]).toEqual([1, 2, 3]);
    for (const [t, v] of [['String', 'a'], ['Int', 5], ['Float', 1.5], ['Boolean', false]] as const) {
      expect(encodeValue(f(t), v)).toBe(v);
      expect(decodeValue(f(t), v)).toBe(v);
    }
  });

  it('keeps SQL NULL, JSON null and values apart in Json columns', () => {
    expect(encodeValue(f('Json', { isRequired: false }), null)).toBeNull();
    expect(decodeValue(f('Json', { isRequired: false }), null)).toBe(Prisma.DbNull);
    expect(decodeValue(f('Json'), null)).toBe(Prisma.JsonNull);
    expect(encodeValue(f('Json'), Prisma.JsonNull)).toEqual({ $json: null });
    expect(decodeValue(f('Json'), { $json: null })).toBe(Prisma.JsonNull);
    expect(decodeValue(f('Json'), { a: [1, { b: 2 }] })).toEqual({ a: [1, { b: 2 }] });
    expect(encodeValue(f('Json'), { a: 1 })).toEqual({ a: 1 });
  });

  it('handles lists, nulls and bad dates', () => {
    expect(encodeValue(f('DateTime', { isList: true }), [new Date(0)])).toEqual(['1970-01-01T00:00:00.000Z']);
    expect(decodeValue(f('String', { isList: true }), ['a', 'b'])).toEqual(['a', 'b']);
    expect(encodeValue(f('String', { isRequired: false }), undefined)).toBeNull();
    expect(decodeValue(f('String', { isRequired: false }), null)).toBeNull();
    expect(decodeValue(f('String'), undefined)).toBeUndefined();
    expect(() => decodeValue(f('DateTime'), 'not a date')).toThrow(/invalid date/);
  });

  it('encodes and decodes whole rows, refuses unknown columns, and honours the allowed list', () => {
    const m: ModelMeta = { name: 'T', fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true, isRequired: true }, { name: 'at', kind: 'scalar', type: 'DateTime', isRequired: true }, { name: 'secret', kind: 'scalar', type: 'String', isRequired: false }, { name: 'rel', kind: 'object', type: 'Other' }] };
    const row = { id: 'a', at: new Date(0), secret: 's', rel: {} };
    expect(encodeRow(m, row)).toEqual({ id: 'a', at: '1970-01-01T00:00:00.000Z', secret: 's' });
    expect(encodeRow(m, row, ['id'])).toEqual({ id: 'a' });
    expect(decodeRow(m, { id: 'a', at: '1970-01-01T00:00:00.000Z', secret: 's' })).toEqual({ id: 'a', at: new Date(0), secret: 's' });
    expect(decodeRow(m, { id: 'a', secret: 's' }, ['id'])).toEqual({ id: 'a' });
    expect(() => decodeRow(m, { id: 'a', evil: 'x' })).toThrow(/no column "evil"/);
  });
});

describe('backup format', () => {
  const header: BackupHeader = { t: 'header', format: 'pointwise-backup', version: 1, appVersion: '1', migration: '20261213000000_backup_migration', createdAt: '2026-11-26T00:00:00.000Z', includesEphemeral: false, includesEnv: false, models: ['A', 'B'] };

  it('writes and parses lines of every kind and rejects the rest', () => {
    expect(parseLine(headerLine({ appVersion: '1', migration: 'm', createdAt: 'x', includesEphemeral: true, includesEnv: false, models: [] })).t).toBe('header');
    expect(parseLine(rowLine('A', { id: 1 }))).toEqual({ t: 'row', m: 'A', r: { id: 1 } });
    expect(parseLine(manifestLine({ models: {}, totalRows: 0, warnings: [] })).t).toBe('manifest');
    expect(parseLine('{"t":"env","vars":{"A":"b"}}').t).toBe('env');
    expect(() => parseLine('not json')).toThrow(/not valid JSON/);
    expect(() => parseLine('{"t":"weird"}')).toThrow(/unknown kind/);
  });

  it('digests rows per model and detects any change, missing model, or wrong total', () => {
    const book = new DigestBook();
    book.add('A', rowLine('A', { id: 1 }));
    book.add('A', rowLine('A', { id: 2 }));
    book.ensure('B');
    const digests = book.result();
    expect(digests.A.count).toBe(2);
    expect(digests.B.count).toBe(0);
    const manifest: BackupManifest = { t: 'manifest', models: digests, totalRows: 2, warnings: [] };
    expect(manifestProblems(digests, manifest, ['A', 'B'])).toEqual([]);
    const other = new DigestBook();
    other.add('A', rowLine('A', { id: 1 }));
    other.add('A', rowLine('A', { id: 3 }));
    other.ensure('B');
    expect(manifestProblems(other.result(), manifest, ['A', 'B'])).toEqual(['A: the rows do not match their checksum']);
    const short = new DigestBook();
    short.add('A', rowLine('A', { id: 1 }));
    short.ensure('B');
    expect(manifestProblems(short.result(), manifest, ['A', 'B'])[0]).toMatch(/says 2 row\(s\), the file has 1/);
    expect(manifestProblems({}, manifest, ['A', 'B', 'C']).join('|')).toMatch(/C is missing from the manifest/);
    expect(manifestProblems(digests, { ...manifest, totalRows: 5 }, ['A', 'B']).join('|')).toMatch(/manifest total/);
    expect(manifestProblems(digests, manifest, ['A']).join('|')).toMatch(/B is in the manifest but not in the header/);
  });

  it('decides whether a header can be restored here', () => {
    const target = { migration: header.migration, models: ['A', 'B', 'C'] };
    expect(headerProblem(header, target)).toBeNull();
    expect(headerProblem({ ...header, migration: 'older' }, target)).toMatch(/database version older/);
    expect(headerProblem({ ...header, version: 9 }, target)).toMatch(/newer PointWise/);
    expect(headerProblem({ ...header, models: ['A', 'Z'] }, target)).toMatch(/does not know the model\(s\) Z/);
    expect(headerProblem({ ...header, format: 'other' as never }, target)).toMatch(/not a PointWise backup/);
  });

  it('carries only the listed environment secrets that are set', () => {
    expect(carriedEnv({ JWT_ACCESS_SECRET: 'a', TOKEN_ENC_KEY: 'never', APP_URL: 'x', VAPID_PRIVATE_KEY: 'v' })).toEqual({ JWT_ACCESS_SECRET: 'a', VAPID_PRIVATE_KEY: 'v' });
    expect(carriedEnv({})).toEqual({});
  });

  it('names backup files by time, prunes to the newest N, and only accepts safe names', () => {
    expect(backupFileName(new Date('2026-11-26T07:08:09.123Z'))).toBe('pointwise-20261126-070809.pwbackup');
    const names = ['pointwise-20261101-000000.pwbackup', 'pointwise-20261103-000000.pwbackup', 'pointwise-20261102-000000.pwbackup', 'other.txt', 'pre-restore-20261101-000000.pwbackup'];
    expect(toPrune(names, 2)).toEqual(['pointwise-20261101-000000.pwbackup']);
    expect(toPrune(names, 5)).toEqual([]);
    expect(toPrune(names, 0)).toEqual([]);
    expect(safeBackupName('pointwise-20261101-000000.pwbackup')).not.toBeNull();
    for (const bad of ['../x.pwbackup', 'a/b.pwbackup', 'x.txt', '.hidden.pwbackup', 'a..b.pwbackup', '']) expect(safeBackupName(bad)).toBeNull();
  });
});
