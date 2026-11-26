import { decryptSecret, encryptSecret } from '../common/crypto';
import { Credentials, SessionBlob } from './connector';

/**
 * Encrypted storage for issuer logins, sessions and device-trust markers (AES-256-GCM, key from TOKEN_ENC_KEY).
 * Secrets are write-only through the API, are decrypted only for the length of one connector call, and never appear
 * in logs, audit rows, notifications or AI tools.
 */
export const sealCredentials = (c: Credentials): string => encryptSecret(JSON.stringify({ u: c.username, p: c.password }));

export function openCredentials(enc: string): Credentials {
  const j = JSON.parse(decryptSecret(enc)) as { u: string; p: string };
  return { username: j.u, password: j.p };
}

export const sealSession = (s: SessionBlob): string => encryptSecret(JSON.stringify(s));
export const openSession = (enc: string): SessionBlob => JSON.parse(decryptSecret(enc)) as SessionBlob;
export const sealText = (t: string): string => encryptSecret(t);
export const openText = (enc: string): string => decryptSecret(enc);

/** A non-secret hint for the UI: the first and last character of the username only. */
export function credentialHint(username: string): string {
  const u = username.trim();
  if (u.length <= 2) return '••';
  return `${u[0]}${'•'.repeat(Math.min(u.length - 2, 6))}${u[u.length - 1]}`;
}

const SENSITIVE_KEYS = /pass(word)?|secret|token|credential|session|cookie|otp|code|authorization|ssn/i;

/** Removes anything secret-looking from an object before it is logged or stored in an audit row. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
  return out as T;
}

/** True when the session blob is still usable (not expired, not waiting for MFA). */
export const sessionUsable = (s: SessionBlob | null, now: Date): boolean => !!s && !s.pendingMfa && new Date(s.expiresAt).getTime() > now.getTime() + 30_000;
