import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM for secrets at rest (bank access tokens). The key is derived from TOKEN_ENC_KEY
 * (≥ 32 chars) via SHA-256. Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>.
 */
function key(secret = process.env.TOKEN_ENC_KEY): Buffer {
  if (!secret || secret.length < 32) throw new Error('TOKEN_ENC_KEY must be set (≥ 32 characters)');
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string, secret?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(secret), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(token: string, secret?: string): string {
  const [v, iv, tag, ct] = token.split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Unsupported ciphertext');
  const d = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
