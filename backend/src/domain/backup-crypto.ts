import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { Transform, TransformCallback } from 'stream';

/**
 * Passphrase encryption for backup files, as a stream so a large database never has to fit in memory.
 *
 * File layout: magic "PWBK", version byte, scrypt cost (log2 N), 16-byte salt, then frames. A frame is
 * [length uint32][iv 12][tag 16][ciphertext]. The key comes from scrypt over the passphrase. Every frame is authenticated
 * together with the header, its position and whether it is the last frame, so reordering, removing, duplicating or
 * cutting off frames is detected, and so is a wrong passphrase.
 */
export const MAGIC = Buffer.from('PWBK');
export const VERSION = 1;
export const SALT_LEN = 16;
export const HEADER_LEN = MAGIC.length + 1 + 1 + SALT_LEN;
export const CHUNK = 64 * 1024;
export const MIN_PASSPHRASE = 12;
const DEFAULT_LOG2_N = 15;

export class BackupCryptoError extends Error {}

export function passphraseProblem(p: string | undefined): string | null {
  if (!p || p.length < MIN_PASSPHRASE) return `The passphrase must be at least ${MIN_PASSPHRASE} characters.`;
  if (/^(.)\1+$/.test(p)) return 'The passphrase must not be one repeated character.';
  return null;
}

const deriveKey = (passphrase: string, salt: Buffer, log2N: number): Buffer => scryptSync(passphrase, salt, 32, { N: 2 ** log2N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });

const aad = (header: Buffer, index: number, last: boolean): Buffer => {
  const tail = Buffer.alloc(9);
  tail.writeBigUInt64BE(BigInt(index), 0);
  tail.writeUInt8(last ? 1 : 0, 8);
  return Buffer.concat([header, tail]);
};

/** Encrypts everything written to it. The first chunk out is the file header. */
export class EncryptStream extends Transform {
  private readonly key: Buffer;
  private readonly header: Buffer;
  private pending: Buffer = Buffer.alloc(0);
  private index = 0;
  private wroteHeader = false;

  constructor(passphrase: string, log2N = DEFAULT_LOG2_N) {
    super();
    const problem = passphraseProblem(passphrase);
    if (problem) throw new BackupCryptoError(problem);
    const salt = randomBytes(SALT_LEN);
    this.header = Buffer.concat([MAGIC, Buffer.from([VERSION, log2N]), salt]);
    this.key = deriveKey(passphrase, salt, log2N);
  }

  private frame(plain: Buffer, last: boolean): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(aad(this.header, this.index++, last));
    const ct = Buffer.concat([c.update(plain), c.final()]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(12 + 16 + ct.length);
    return Buffer.concat([len, iv, c.getAuthTag(), ct]);
  }

  private head(): Buffer[] {
    if (this.wroteHeader) return [];
    this.wroteHeader = true;
    return [this.header];
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.pending = Buffer.concat([this.pending, chunk]);
    const out = this.head();
    while (this.pending.length > CHUNK) {
      out.push(this.frame(this.pending.subarray(0, CHUNK), false));
      this.pending = this.pending.subarray(CHUNK);
    }
    cb(null, out.length ? Buffer.concat(out) : undefined);
  }

  _flush(cb: TransformCallback) {
    cb(null, Buffer.concat([...this.head(), this.frame(this.pending, true)]));
  }
}

/** Decrypts a file written by EncryptStream. Fails on a wrong passphrase, any change, or a file that stops early. */
export class DecryptStream extends Transform {
  private buf: Buffer = Buffer.alloc(0);
  private header: Buffer | null = null;
  private key: Buffer | null = null;
  private index = 0;
  private sawLast = false;

  constructor(private readonly passphrase: string) {
    super();
  }

  private readHeader(): boolean {
    if (this.header) return true;
    if (this.buf.length < HEADER_LEN) return false;
    const head = this.buf.subarray(0, HEADER_LEN);
    if (!timingSafeEqual(head.subarray(0, MAGIC.length), MAGIC)) throw new BackupCryptoError('This is not a PointWise backup file.');
    if (head[MAGIC.length] !== VERSION) throw new BackupCryptoError(`Unsupported backup file version ${head[MAGIC.length]}.`);
    const log2N = head[MAGIC.length + 1];
    if (log2N < 10 || log2N > 20) throw new BackupCryptoError('The backup file header is damaged.');
    this.header = Buffer.from(head);
    this.key = deriveKey(this.passphrase, head.subarray(MAGIC.length + 2), log2N);
    this.buf = this.buf.subarray(HEADER_LEN);
    return true;
  }

  private open(body: Buffer, last: boolean): Buffer {
    const iv = body.subarray(0, 12);
    const tag = body.subarray(12, 28);
    const d = createDecipheriv('aes-256-gcm', this.key!, iv);
    d.setAAD(aad(this.header!, this.index++, last));
    d.setAuthTag(tag);
    try {
      return Buffer.concat([d.update(body.subarray(28)), d.final()]);
    } catch {
      throw new BackupCryptoError('The passphrase is wrong, or the backup file is damaged or has been changed.');
    }
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    try {
      if (this.sawLast) throw new BackupCryptoError('The backup file has extra data after its end.');
      this.buf = Buffer.concat([this.buf, chunk]);
      if (!this.readHeader()) return cb();
      const out: Buffer[] = [];
      for (;;) {
        if (this.buf.length < 4) break;
        const len = this.buf.readUInt32BE(0);
        if (len < 28 || len > CHUNK + 64) throw new BackupCryptoError('The backup file is damaged.');
        if (this.buf.length < 4 + len) break;
        const body = this.buf.subarray(4, 4 + len);
        this.buf = this.buf.subarray(4 + len);
        // a frame is the last one when nothing follows it; try that reading first only when the file ends here
        out.push(this.openFrame(body));
        if (this.sawLast) break;
      }
      if (this.sawLast && this.buf.length) throw new BackupCryptoError('The backup file has extra data after its end.');
      cb(null, out.length ? Buffer.concat(out) : undefined);
    } catch (e) {
      cb(e as Error);
    }
  }

  /** A frame is "last" if it only verifies as last; frames are tried as not-last first (the common case). */
  private openFrame(body: Buffer): Buffer {
    const idx = this.index;
    try {
      return this.open(body, false);
    } catch {
      this.index = idx;
      const plain = this.open(body, true);
      this.sawLast = true;
      return plain;
    }
  }

  _flush(cb: TransformCallback) {
    if (!this.header) return cb(new BackupCryptoError('This is not a PointWise backup file.'));
    if (!this.sawLast || this.buf.length) return cb(new BackupCryptoError('The backup file is incomplete (it ends too early).'));
    cb();
  }
}
