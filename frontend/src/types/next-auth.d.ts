import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    error?: string;
    user: { id: string; email: string; name: string | null; role: 'USER' | 'ADMIN' };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: 'USER' | 'ADMIN';
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    error?: string;
  }
}
