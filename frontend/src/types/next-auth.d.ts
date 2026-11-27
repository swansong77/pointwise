import 'next-auth';
import 'next-auth/jwt';

export interface SessionMember {
  profileId: string;
  nickname: string;
  visibility: 'OWN' | 'HOUSEHOLD';
  household: string;
}

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    error?: string;
    user: { id: string; email: string; name: string | null; role: 'USER' | 'ADMIN'; member?: SessionMember };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: 'USER' | 'ADMIN';
    member?: SessionMember;
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    error?: string;
  }
}
