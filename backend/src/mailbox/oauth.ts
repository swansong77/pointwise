import { createHash, randomBytes } from 'crypto';
import { decryptSecret, encryptSecret } from '../common/crypto';

/**
 * OAuth 2.0 authorization-code flow for Gmail and Microsoft Graph mail (read-only). Endpoints, scopes and
 * parameters are the ones documented by Google and Microsoft (docs/email-ingestion-research.md, retrieved
 * 2026-11-25). The app owner supplies a client id and secret from their own free Google Cloud / Microsoft Entra
 * app registration; nothing is shared with PointWise or any third party.
 */
export type OAuthKind = 'GMAIL' | 'GRAPH';

export interface OAuthProvider {
  kind: OAuthKind;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string | null;
  scopes: string[];
  /** extra authorization parameters */
  extra: Record<string, string>;
  pkce: boolean;
  clientIdEnv: string;
  clientSecretEnv: string;
}

export const PROVIDERS: Record<OAuthKind, OAuthProvider> = {
  GMAIL: {
    kind: 'GMAIL',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    // gmail.readonly is the narrowest scope that allows sender search (q) and fetching the raw message
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'openid', 'email'],
    // offline_access is requested with access_type; consent is forced so a refresh token is always returned
    extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    pkce: false,
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
  },
  GRAPH: {
    kind: 'GRAPH',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    revokeUrl: null, // Microsoft has no token revocation endpoint for this flow: the user revokes at account.microsoft.com
    scopes: ['offline_access', 'Mail.Read', 'User.Read'],
    extra: { response_mode: 'query' },
    pkce: true, // recommended for all application types
    clientIdEnv: 'MICROSOFT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_OAUTH_CLIENT_SECRET',
  },
};

export const KIND_PATH: Record<string, OAuthKind> = { google: 'GMAIL', microsoft: 'GRAPH' };

export function credentialsFor(kind: OAuthKind, env = process.env): { clientId: string; clientSecret: string } | null {
  const p = PROVIDERS[kind];
  const clientId = env[p.clientIdEnv]?.trim();
  const clientSecret = env[p.clientSecretEnv]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function redirectUri(env = process.env): string {
  return `${(env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/v1/mailboxes/oauth/callback`;
}

// ───────────── state (signed, expiring, bound to the user) ─────────────

export interface StatePayload {
  userId: string;
  kind: OAuthKind;
  /** PKCE verifier, when used */
  verifier?: string;
  exp: number;
}

export const STATE_TTL_MS = 10 * 60_000;

/** The state is encrypted and authenticated (AES-GCM), so it cannot be forged, read or reused for another user. */
export function sealState(p: Omit<StatePayload, 'exp'>, now = Date.now()): string {
  return encryptSecret(JSON.stringify({ ...p, exp: now + STATE_TTL_MS }));
}

export function openState(token: string, now = Date.now()): StatePayload | null {
  try {
    const p = JSON.parse(decryptSecret(token)) as StatePayload;
    if (!p.userId || !PROVIDERS[p.kind] || typeof p.exp !== 'number' || p.exp < now) return null;
    return p;
  } catch {
    return null;
  }
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const newVerifier = () => b64url(randomBytes(48));
export const challengeFor = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

export function buildAuthUrl(kind: OAuthKind, clientId: string, state: string, verifier?: string, env = process.env): string {
  const p = PROVIDERS[kind];
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: p.scopes.join(' '),
    state,
    ...p.extra,
  });
  if (p.pkce && verifier) {
    q.set('code_challenge', challengeFor(verifier));
    q.set('code_challenge_method', 'S256');
  }
  return `${p.authUrl}?${q.toString()}`;
}

// ───────────── token requests ─────────────

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

async function tokenRequest(kind: OAuthKind, params: Record<string, string>, f: FetchLike): Promise<Tokens> {
  const res = await f(PROVIDERS[kind].tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    // invalid_grant = the user revoked access or the refresh token expired (Google "Testing" mode: 7 days)
    throw new OAuthError(body.error === 'invalid_grant' ? 'Access was revoked or expired — connect the mailbox again' : `Sign-in failed (${body.error ?? res.status})`, body.error === 'invalid_grant');
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null, expiresIn: body.expires_in ?? 3600 };
}

export class OAuthError extends Error {
  constructor(message: string, readonly needsReconnect = false) {
    super(message);
  }
}

export function exchangeCode(kind: OAuthKind, code: string, creds: { clientId: string; clientSecret: string }, verifier: string | undefined, f: FetchLike, env = process.env): Promise<Tokens> {
  return tokenRequest(
    kind,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(env),
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      ...(PROVIDERS[kind].pkce && verifier ? { code_verifier: verifier } : {}),
    },
    f,
  );
}

export function refreshAccess(kind: OAuthKind, refreshToken: string, creds: { clientId: string; clientSecret: string }, f: FetchLike): Promise<Tokens> {
  return tokenRequest(kind, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: creds.clientId, client_secret: creds.clientSecret }, f);
}

export async function revokeToken(kind: OAuthKind, token: string, f: FetchLike): Promise<void> {
  const url = PROVIDERS[kind].revokeUrl;
  if (!url) return;
  await f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() }).catch(() => undefined);
}
