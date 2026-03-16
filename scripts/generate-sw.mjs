import path from 'node:path';
import { promises as fs } from 'node:fs';
import { generateSW } from 'workbox-build';

const ROOT = process.cwd();
const SW_DEST = path.join(ROOT, 'public', 'sw.js');
const NEXT_STATIC_DIR = path.join(ROOT, '.next', 'static');

const exists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const AUTH_OR_SESSION_PATHS = [
  /^\/api\/(?:auth|session)(?:\/|$)/,
  /^\/api\/.*(?:auth|session|csrf|token)(?:\/|$)/,
  /^\/(?:auth|session)(?:\/|$)/,
];

const main = async () => {
  if (!(await exists(NEXT_STATIC_DIR))) {
    throw new Error('Missing .next/static output. Run `next build` before generating the service worker.');
  }

  const { count, size, warnings } = await generateSW({
    globDirectory: ROOT,
    swDest: SW_DEST,
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: false,
    mode: 'production',
    navigateFallback: '/offline.html',
    navigateFallbackDenylist: [/^\/api\//],
    globPatterns: ['public/**/*.{html,js,css,png,svg,ico,webp,woff,woff2,ttf}', '.next/static/**/*.{js,css,woff2,png,svg,webp}'],
    globIgnores: ['**/sw.js', '**/*.map', '.next/cache/**/*'],
    modifyURLPrefix: {
      'public/': '/',
      '.next/static/': '/_next/static/',
    },
    runtimeCaching: [
      {
        urlPattern: ({ request, sameOrigin, url }) =>
          request.mode === 'navigate' &&
          request.method === 'GET' &&
          sameOrigin &&
          !AUTH_OR_SESSION_PATHS.some((pattern) => pattern.test(url.pathname)),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages',
          networkTimeoutSeconds: 5,
          expiration: {
            maxEntries: 50,
            maxAgeSeconds: 60 * 60 * 24 * 7,
          },
        },
      },
      {
        urlPattern: ({ request, sameOrigin, url }) =>
          request.method === 'GET' && sameOrigin && url.pathname.startsWith('/_next/static/'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'next-static-assets',
          cacheableResponse: {
            statuses: [0, 200],
          },
          expiration: {
            maxEntries: 300,
            maxAgeSeconds: 60 * 60 * 24 * 365,
          },
        },
      },
      {
        urlPattern: ({ request, sameOrigin }) => request.method === 'GET' && sameOrigin && request.destination === 'font',
        handler: 'CacheFirst',
        options: {
          cacheName: 'font-assets',
          cacheableResponse: {
            statuses: [0, 200],
          },
          expiration: {
            maxEntries: 50,
            maxAgeSeconds: 60 * 60 * 24 * 365,
          },
        },
      },
      {
        urlPattern: ({ request, sameOrigin }) => request.method === 'GET' && sameOrigin && request.destination === 'image',
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'image-assets',
          cacheableResponse: {
            statuses: [0, 200],
          },
          expiration: {
            maxEntries: 250,
            maxAgeSeconds: 60 * 60 * 24 * 30,
          },
        },
      },
    ],
  });

  if (warnings.length > 0) {
    warnings.forEach((warning) => console.warn(warning));
  }

  console.log(`Generated ${path.relative(ROOT, SW_DEST)} with ${count} precache entries (${size} bytes).`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
