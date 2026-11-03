import type { NextConfig } from 'next';

// `npm run build:pages` sets STATIC_EXPORT=1: a fully static site for GitHub Pages (served from
// /<repo>/), where the demo search runs in the browser and the API routes (route.ts) are left out.
const staticExport = process.env.STATIC_EXPORT === '1';
const basePath = staticExport ? (process.env.PAGES_BASE_PATH ?? '') : '';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  // Partial prerendering (Cache Components) needs a server; static export renders everything at build.
  ...(staticExport ? {} : { cacheComponents: true, partialPrefetching: true }),
  poweredByHeader: false,
  env: { NEXT_PUBLIC_STATIC_EXPORT: staticExport ? '1' : '0' },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  ...(staticExport
    ? {
        output: 'export' as const,
        basePath,
        trailingSlash: true,
        // Pages are .tsx; API route handlers (route.ts) need a server and are excluded.
        pageExtensions: ['tsx'],
      }
    : {
        async headers() {
          return [{ source: '/:path*', headers: securityHeaders }];
        },
      }),
};

export default nextConfig;
