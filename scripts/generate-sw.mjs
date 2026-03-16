import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const NEXT_STATIC_DIR = path.join(ROOT, '.next', 'static');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SW_DEST = path.join(PUBLIC_DIR, 'sw.js');
const BUILD_ID_PATH = path.join(ROOT, '.next', 'BUILD_ID');

const PUBLIC_INCLUDE = [
  'offline.html',
  'manifest.json',
  'web-app-manifest-192x192.png',
  'web-app-manifest-512x512.png',
  'favicon.ico',
  'apple-icon.png',
  'icon0.svg',
  'icon1.png',
];

const PUBLIC_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico', '.css', '.js', '.woff', '.woff2', '.ttf', '.wav', '.mp3',
]);

const walk = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(fullPath);
      }
      return [fullPath];
    }),
  );
  return files.flat();
};

const asUrl = (filePath, prefixDir) => {
  const rel = path.relative(prefixDir, filePath).split(path.sep).join('/');
  if (prefixDir === NEXT_STATIC_DIR) {
    return `/_next/static/${rel}`;
  }
  return `/${rel}`;
};

const fileHash = async (filePath) => {
  const data = await fs.readFile(filePath);
  return crypto.createHash('md5').update(data).digest('hex');
};

const exists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const collectPublicEntries = async () => {
  const files = await walk(PUBLIC_DIR);
  const filtered = files.filter((filePath) => {
    const rel = path.relative(PUBLIC_DIR, filePath).split(path.sep).join('/');
    if (rel === 'sw.js') return false;
    if (PUBLIC_INCLUDE.includes(rel)) return true;
    return PUBLIC_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  });

  return Promise.all(
    filtered.map(async (filePath) => ({
      url: asUrl(filePath, PUBLIC_DIR),
      revision: await fileHash(filePath),
    })),
  );
};

const collectNextStaticEntries = async () => {
  if (!(await exists(NEXT_STATIC_DIR))) {
    throw new Error('Missing .next/static output. Run `next build` before generating the service worker.');
  }

  const files = await walk(NEXT_STATIC_DIR);
  return Promise.all(
    files
      .filter((filePath) => path.extname(filePath) !== '.map')
      .map(async (filePath) => ({
        url: asUrl(filePath, NEXT_STATIC_DIR),
        revision: await fileHash(filePath),
      })),
  );
};

const main = async () => {
  const [publicEntries, nextStaticEntries] = await Promise.all([
    collectPublicEntries(),
    collectNextStaticEntries(),
  ]);

  const buildId = (await exists(BUILD_ID_PATH))
    ? (await fs.readFile(BUILD_ID_PATH, 'utf8')).trim()
    : new Date().toISOString();

  const manifestEntries = [
    ...publicEntries,
    ...nextStaticEntries,
    { url: '/manifest.json', revision: buildId },
    { url: '/offline.html', revision: buildId },
    { url: '/apple-icon.png', revision: buildId },
    { url: '/favicon.ico', revision: buildId },
  ];

  const swSource = `/* eslint-disable */\nimportScripts('https://storage.googleapis.com/workbox-cdn/releases/7.1.0/workbox-sw.js');\n\nself.addEventListener('message', (event) => {\n  if (event.data?.type === 'SKIP_WAITING') {\n    self.skipWaiting();\n  }\n});\n\nworkbox.core.setCacheNameDetails({\n  prefix: 'misty',\n});\n\nworkbox.core.clientsClaim();\n\nworkbox.precaching.precacheAndRoute(${JSON.stringify(manifestEntries, null, 2)});\nworkbox.precaching.cleanupOutdatedCaches();\n\nworkbox.routing.registerRoute(\n  ({ request }) => request.mode === 'navigate',\n  new workbox.strategies.NetworkFirst({\n    cacheName: 'pages',\n    networkTimeoutSeconds: 5,\n    plugins: [new workbox.expiration.ExpirationPlugin({ maxEntries: 50 })],\n  }),\n);\n\nworkbox.routing.setCatchHandler(async ({ event }) => {\n  if (event.request.destination === 'document') {\n    return workbox.precaching.matchPrecache('/offline.html');\n  }\n  return Response.error();\n});\n\nworkbox.routing.registerRoute(\n  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/_next/static/'),\n  new workbox.strategies.CacheFirst({\n    cacheName: 'next-static-assets',\n    plugins: [\n      new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] }),\n      new workbox.expiration.ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }),\n    ],\n  }),\n);\n\nworkbox.routing.registerRoute(\n  ({ request, url }) =>\n    request.destination === 'style' ||\n    request.destination === 'script' ||\n    request.destination === 'image' ||\n    request.destination === 'font' ||\n    (url.origin === self.location.origin && /\\.(?:json|wav|mp3)$/i.test(url.pathname)),\n  new workbox.strategies.StaleWhileRevalidate({\n    cacheName: 'static-resources',\n    plugins: [new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] })],\n  }),\n);\n`;

  await fs.writeFile(SW_DEST, swSource, 'utf8');
  console.log(`Generated ${path.relative(ROOT, SW_DEST)} with ${manifestEntries.length} precache entries.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
