import type { NextAuthOptions } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import AppleProvider from 'next-auth/providers/apple';

const API = () => process.env.API_INTERNAL_URL || 'http://localhost:4000';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string | null; role: 'USER' | 'ADMIN' };
}

/** First IP from forwarding headers of the incoming browser request (set by the edge proxy). */
export function clientIpFrom(headers: Record<string, unknown> | undefined): string | undefined {
  const raw = headers?.['x-forwarded-for'] ?? headers?.['x-real-ip'];
  const first = typeof raw === 'string' ? raw.split(',')[0].trim() : undefined;
  return first && /^[0-9a-fA-F:.]{2,45}$/.test(first) ? first : undefined;
}

async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  // Server-to-server: identify as the trusted NextAuth server so the API rate-limits by the
  // end user's IP (x-client-ip) instead of this container's IP.
  const internal: Record<string, string> = process.env.INTERNAL_API_SECRET ? { 'x-internal-secret': process.env.INTERNAL_API_SECRET } : {};
  const res = await fetch(`${API()}/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...internal, ...headers },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

function fromPair(pair: TokenPair): JWT {
  return {
    sub: pair.user.id,
    email: pair.user.email,
    name: pair.user.name,
    role: pair.user.role,
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    // refresh 60s before expiry
    accessTokenExpires: Date.now() + (pair.expiresIn - 60) * 1000,
  };
}

/** Exchange the backend refresh token for a new pair (rotation). */
export async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const pair = await post<TokenPair>('/auth/refresh', { refreshToken: token.refreshToken });
    return { ...token, ...fromPair(pair), error: undefined };
  } catch {
    return { ...token, error: 'RefreshAccessTokenError' };
  }
}

const providers: NextAuthOptions['providers'] = [
  CredentialsProvider({
    id: 'credentials',
    name: 'Email',
    credentials: { email: { label: 'Email', type: 'email' }, password: { label: 'Password', type: 'password' } },
    async authorize(credentials, req) {
      if (!credentials?.email || !credentials.password) return null;
      const ip = clientIpFrom(req?.headers as Record<string, unknown> | undefined);
      try {
        const pair = await post<TokenPair>('/auth/login', { email: credentials.email, password: credentials.password }, ip ? { 'x-client-ip': ip } : {});
        return { id: pair.user.id, email: pair.user.email, name: pair.user.name, pair } as never;
      } catch {
        return null;
      }
    },
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }));
}
if (process.env.APPLE_ID && process.env.APPLE_SECRET) {
  providers.push(AppleProvider({ clientId: process.env.APPLE_ID, clientSecret: process.env.APPLE_SECRET }));
}

export const enabledOAuthProviders = () => ({
  google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  apple: !!(process.env.APPLE_ID && process.env.APPLE_SECRET),
});

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/login' },
  callbacks: {
    async jwt({ token, user, account }) {
      // Initial sign-in
      if (user && account) {
        if (account.provider === 'credentials') {
          return fromPair((user as unknown as { pair: TokenPair }).pair);
        }
        // OAuth: exchange the verified provider identity for backend tokens (server-to-server).
        const pair = await post<TokenPair>(
          '/auth/oauth',
          { provider: account.provider, providerAccountId: account.providerAccountId, email: user.email, name: user.name ?? undefined },
        );
        return fromPair(pair);
      }
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires) return token;
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      session.user = { id: token.sub as string, email: token.email ?? '', name: token.name ?? null, role: token.role ?? 'USER' };
      return session;
    },
  },
  events: {
    async signOut({ token }) {
      if (token?.refreshToken) await post('/auth/logout', { refreshToken: token.refreshToken }).catch(() => undefined);
    },
  },
};
