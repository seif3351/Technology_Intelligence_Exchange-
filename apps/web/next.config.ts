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
        ],
      },
    ];
  },
};

export default config;
