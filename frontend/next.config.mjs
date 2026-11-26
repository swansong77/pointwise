/** @type {import('next').NextConfig} */
const apiInternal = process.env.API_INTERNAL_URL || 'http://localhost:4000';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Plaid Link (bank connections) is the only third-party script; it is loaded on demand when a user connects a bank
      "script-src 'self' 'unsafe-inline' https://cdn.plaid.com" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' https://production.plaid.com https://sandbox.plaid.com",
      'frame-src https://cdn.plaid.com',
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://accounts.google.com https://appleid.apple.com",
    ].join('; '),
  },
];

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // statement uploads: the API proxy defaults to 10 MB per request (the app also sends big drops in batches)
  experimental: { middlewareClientMaxBodySize: '64mb' },
  // Same-origin API proxy: the browser calls /api/v1/*; Next forwards to the NestJS service.
  async rewrites() {
    return [
      // The internal OAuth exchange is server-to-server only and is NOT proxied for browsers.
      { source: '/api/v1/:path((?!auth/oauth).*)', destination: `${apiInternal}/api/v1/:path` },
      { source: '/api/docs', destination: `${apiInternal}/api/docs` },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
