import { NextResponse } from 'next/server';
import { withAuth } from 'next-auth/middleware';

/** Route protection: all app pages need a session; /admin additionally needs ADMIN. A household member's own sign-in only gets /my. */
export default withAuth(
  function middleware(req) {
    const t = req.nextauth.token;
    const path = req.nextUrl.pathname;
    if (t?.member && path !== '/my' && !path.startsWith('/my/')) return NextResponse.redirect(new URL('/my', req.url));
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        if (!token || token.error === 'RefreshAccessTokenError') return false;
        if (req.nextUrl.pathname.startsWith('/admin')) return token.role === 'ADMIN';
        return true;
      },
    },
    pages: { signIn: '/login' },
  },
);

export const config = {
  matcher: [
    '/my/:path*',
    '/my',
    '/dashboard/:path*',
    '/cashback/:path*',
    '/wallet/:path*',
    '/offers/:path*',
    '/nearby/:path*',
    '/merchants/:path*',
    '/categories/:path*',
    '/calculator/:path*',
    '/notifications/:path*',
    '/settings/:path*',
    '/admin/:path*',
    '/portfolio/:path*',
    '/benefits/:path*',
    '/spending/:path*',
    '/five24/:path*',
    '/household/:path*',
    '/import/:path*',
    '/assistant/:path*',
    '/next-card/:path*',
    '/travel/:path*',
    '/loyalty/:path*',
    '/brands',
  ],
};
