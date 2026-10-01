import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ['@atx/contracts', '@atx/domain', '@atx/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  // Project conventions live in the repository-root CLAUDE.md.
  agentRules: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-Frame-Options', value: 'DENY' },
          ...(process.env.NODE_ENV === 'production' &&
          (process.env.PUBLIC_WEB_URL ?? '').startsWith('https://')
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
        ],
      },
    ];
  },
};

export default config;
