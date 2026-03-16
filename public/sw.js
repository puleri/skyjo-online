/* eslint-disable */
importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.1.0/workbox-sw.js');

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

workbox.core.setCacheNameDetails({
  prefix: 'misty',
});

workbox.core.clientsClaim();

workbox.precaching.precacheAndRoute([
  {
    "url": "/animations/selected.GIF",
    "revision": "328c32ba03f6b8c70bc31e0dd9c09adb"
  },
  {
    "url": "/cards/card-corners.png",
    "revision": "c23beec3b9f9feaf57dddfead220234e"
  },
  {
    "url": "/cards/mirror.png",
    "revision": "9a755202689f3d930deb8464d0b55f3b"
  },
  {
    "url": "/cards/mist.png",
    "revision": "9a34c81b84e2982e13e6da85bb62c019"
  },
  {
    "url": "/cards/push.png",
    "revision": "e28a9e275f0ef64cac6f17a0ce34f1cf"
  },
  {
    "url": "/cards/random.png",
    "revision": "29e3e0d12a21b81a90e22fd24fcee569"
  },
  {
    "url": "/cards/swap.png",
    "revision": "363dce695849645ac366400d28600ec5"
  },
  {
    "url": "/cards/wild.png",
    "revision": "688b694ff7b5aafad545a7d321fa4529"
  },
  {
    "url": "/eye-icon.png",
    "revision": "ce9186bee40944ab422abc28048b4735"
  },
  {
    "url": "/eye-icon.svg",
    "revision": "1ba08fccdd310f5a9a617a71c0a0e376"
  },
  {
    "url": "/fonts/Merriweather-Italic-VariableFont.ttf",
    "revision": "046282c1d64fc4576d994a1ce0d7f718"
  },
  {
    "url": "/fonts/Merriweather-VariableFont.ttf",
    "revision": "1219547d64ed4b83e6659960e5abff09"
  },
  {
    "url": "/glyphs/crystal.svg",
    "revision": "ba9efd188d0c136adb6635a0b19b6a37"
  },
  {
    "url": "/glyphs/eclipse.svg",
    "revision": "7d2d9045c5cf51519a4bbc41f09356fb"
  },
  {
    "url": "/glyphs/ember.svg",
    "revision": "83d9d934c4b864f7a45a03428091daf9"
  },
  {
    "url": "/glyphs/luna.svg",
    "revision": "bed9c8330043c5dc108ffdd9451da8e5"
  },
  {
    "url": "/glyphs/mountain.svg",
    "revision": "a981457f5aee4d14c032b4bc99d4e216"
  },
  {
    "url": "/glyphs/pinetree.svg",
    "revision": "8a6fa04a7ea0388b0b9499afd35175dc"
  },
  {
    "url": "/glyphs/player-glyph-platform.svg",
    "revision": "f6b82a093b09187d7007beee051a3279"
  },
  {
    "url": "/glyphs/stag.svg",
    "revision": "182e0ec89923460e8ff64077c51c450d"
  },
  {
    "url": "/glyphs/sun.svg",
    "revision": "8528029263df649be61e11d96693026d"
  },
  {
    "url": "/glyphs/tryph.svg",
    "revision": "42ab87f424019d20728be54820b2fd49"
  },
  {
    "url": "/glyphs/white-lotus.svg",
    "revision": "008e86cec2363e02e992db6d0f791f6f"
  },
  {
    "url": "/images/cardback-dark.png",
    "revision": "022b1fde95087656506470181ad416c0"
  },
  {
    "url": "/images/cardback.png",
    "revision": "ec73e514b0e67e9b42fd5dea6b5665b4"
  },
  {
    "url": "/images/misty-cardback-dark.png",
    "revision": "06ac452ea2357986771b4e8182c1711a"
  },
  {
    "url": "/images/misty-cardback.png",
    "revision": "41dec6cb70b198964efba9ca04e9c928"
  },
  {
    "url": "/images/misty-hero-banner-darkmode.png",
    "revision": "5529bdf08b2d7c06d46148a86975aee3"
  },
  {
    "url": "/images/misty-hero-banner.png",
    "revision": "37125e0c0064ba9e48f2d36df35e6bf7"
  },
  {
    "url": "/images/misty-lobby-bg-darkmode.png",
    "revision": "ece2c111c9f913f31b263aa0a05d0fdb"
  },
  {
    "url": "/images/misty-lobby-bg-snow-dark.png",
    "revision": "27186d3a3e2fb890ca0b7d462ebece6f"
  },
  {
    "url": "/images/misty-lobby-bg-snow.png",
    "revision": "d9a9aefeb62629fcdab5dcd2324aeec4"
  },
  {
    "url": "/images/misty-lobby-bg.png",
    "revision": "09e45f4d85c68dd02b55b4df7135d700"
  },
  {
    "url": "/images/skyjo-cardback-darkmode.png",
    "revision": "2ac63da6440322aaca9c2a3c24b4dcf6"
  },
  {
    "url": "/images/skyjo-cardback-wide-darkmode.png",
    "revision": "80c2b5d209f2bd4a0db8048fd6a5bda6"
  },
  {
    "url": "/images/skyjo-cardback-wide.png",
    "revision": "6e6db3921808c1bbe4761aaf6a8d3387"
  },
  {
    "url": "/images/skyjo-cardback.png",
    "revision": "4fd6552ce64a9bfb1f03553f0efbf4c2"
  },
  {
    "url": "/images/wide-dark.png",
    "revision": "0bc44ac7c0b4ed9f8eeae48ef3129de6"
  },
  {
    "url": "/images/wide.png",
    "revision": "d19569026d3157cc42511319054cc70a"
  },
  {
    "url": "/info-icon.png",
    "revision": "a7b8bed875b2b9681dbf28abd88d4619"
  },
  {
    "url": "/leaderboard-icon.png",
    "revision": "ecab29aa02e496907ef4e2f9f8605edf"
  },
  {
    "url": "/offline.html",
    "revision": "f2d21f82dac09c4a59da6234fcf6eae6"
  },
  {
    "url": "/person-icon.svg",
    "revision": "c0f2fc796721b52937be71ca2198e4c8"
  },
  {
    "url": "/question-mark-icon.png",
    "revision": "5c92c7e0981044394d70927086fd92e9"
  },
  {
    "url": "/question-mark-icon.svg",
    "revision": "e6a3f1d6572f3b05a06ea40306a88f31"
  },
  {
    "url": "/rules.png",
    "revision": "173788f1810e24bc6bf9e409196922e6"
  },
  {
    "url": "/settings-icon.png",
    "revision": "61bf1623418f90a047a68e3631076ed6"
  },
  {
    "url": "/settings-icon.svg",
    "revision": "daa0a1e9b4a61b77cda0c8c9c0ff7654"
  },
  {
    "url": "/slider-icon.png",
    "revision": "1d883fa2c7b2bb5fc091856bf2d2b605"
  },
  {
    "url": "/sounds/card-draw/discard-to-select.wav",
    "revision": "57d343686c41c42822c3e857db117e60"
  },
  {
    "url": "/sounds/card-draw/items/MIRROR/MIRROR-Finish.wav",
    "revision": "d1db1abedb0fbee61a342805d3e77e01"
  },
  {
    "url": "/sounds/card-draw/items/MIRROR/MIRROR-Impact.wav",
    "revision": "892180e4a2d95c96396d06f433a294fb"
  },
  {
    "url": "/sounds/card-draw/items/MIRROR/MIRROR-Loop.wav",
    "revision": "217391388fe558ff794f06d998d4dd3f"
  },
  {
    "url": "/sounds/card-draw/items/MIST/MIST-Finish.wav",
    "revision": "3fa4a8053ece529d61aadcb8d0f14783"
  },
  {
    "url": "/sounds/card-draw/items/MIST/MIST-Impact.wav",
    "revision": "b7fd0fce15b3f85aafce8ac462348339"
  },
  {
    "url": "/sounds/card-draw/items/MIST/MIST-Loop.wav",
    "revision": "61317b89a46b2f48c21fe4226a8b7657"
  },
  {
    "url": "/sounds/card-draw/items/PUSH/PUSH-Finish.wav",
    "revision": "c971ec84768c705185dd42542228550d"
  },
  {
    "url": "/sounds/card-draw/items/PUSH/PUSH-Impact.wav",
    "revision": "a796e9917e4b7bce0a26d76666f7ed6f"
  },
  {
    "url": "/sounds/card-draw/items/PUSH/PUSH-Loop.wav",
    "revision": "611205c4402f5d62d94e2f2422a283cc"
  },
  {
    "url": "/sounds/card-draw/items/SWAP/SWAP-Finish.wav",
    "revision": "a1041de597b0ea8167c50ba9e92514c3"
  },
  {
    "url": "/sounds/card-draw/items/SWAP/SWAP-Impact.wav",
    "revision": "548c9f8ee24edf16e067ca890f842f51"
  },
  {
    "url": "/sounds/card-draw/items/SWAP/SWAP-Loop.wav",
    "revision": "c36b2b234ad60c6a5ef5af912cc2c658"
  },
  {
    "url": "/sounds/card-draw/items/WILD/WILD-Finish.wav",
    "revision": "35fb84bd8f862c07f381142901a2f56d"
  },
  {
    "url": "/sounds/card-draw/items/WILD/WILD-Impact.wav",
    "revision": "206af3956016f342e0424a2f5eb8d7c8"
  },
  {
    "url": "/sounds/card-draw/items/WILD/WILD-Loop.wav",
    "revision": "fa8c6055487f6017b1fd8789d75cb820"
  },
  {
    "url": "/sounds/card-draw/minus-one.wav",
    "revision": "8bed63b51dcf32cf07054826a6849c1a"
  },
  {
    "url": "/sounds/card-draw/minus-two.wav",
    "revision": "aa2a8816ce2f6bf02e28aabfadacfded"
  },
  {
    "url": "/sounds/card-draw/mirror-item.wav",
    "revision": "5baa70deda506c8cffd4f31b410617a9"
  },
  {
    "url": "/sounds/card-draw/mist-item.wav",
    "revision": "67b5032b218e717212c30c6a7fc36e7b"
  },
  {
    "url": "/sounds/card-draw/one-nine.wav",
    "revision": "53db1432ab1901259405d80b9b950db2"
  },
  {
    "url": "/sounds/card-draw/reveal-trade.wav",
    "revision": "9462111819594c94eef2bbe90fbd0688"
  },
  {
    "url": "/sounds/card-draw/ten-eleven.wav",
    "revision": "ddb757b936dd70adb4b8af26172ba03e"
  },
  {
    "url": "/sounds/card-draw/thirteen.wav",
    "revision": "c29967b2d42a45281fccc0631288f1f0"
  },
  {
    "url": "/sounds/card-draw/twelve.wav",
    "revision": "492dd4f6a4007ba67510418b423047a3"
  },
  {
    "url": "/sounds/card-draw/wild-item.wav",
    "revision": "8f7360f2ff8428d6ae3eb573954c7103"
  },
  {
    "url": "/sounds/card-draw/zero.wav",
    "revision": "89eaed89903d6915764cb9517d6c7802"
  },
  {
    "url": "/sounds/notifications/clear-column.wav",
    "revision": "ccb0fbe631f88f8f21acf8e73f3189d5"
  },
  {
    "url": "/sounds/notifications/clear-row.wav",
    "revision": "698cbc72bce55d9c6b9e9b451e745f6a"
  },
  {
    "url": "/sounds/notifications/final-turn.wav",
    "revision": "36b3f2a8ed0d24f23b3e6959f6963d36"
  },
  {
    "url": "/sounds/notifications/hey-your-turn.wav",
    "revision": "58ca9219a42521f708c57aa98a4e8877"
  },
  {
    "url": "/sounds/notifications/your-turn.wav",
    "revision": "a55d4cdf5cd0d8a83b48aae00b70a325"
  },
  {
    "url": "/sounds/theme/main-theme-loop.wav",
    "revision": "948b4cdcedd75f9d225f62f0c0427e89"
  },
  {
    "url": "/sounds/theme/theme-reprised-quiet.wav",
    "revision": "4745223b048071c1e1d92f4a45bec0f2"
  },
  {
    "url": "/spike-icon.png",
    "revision": "321985d0d3eaac7a731ab4a6e6269dbd"
  },
  {
    "url": "/texture.png",
    "revision": "374f84c45761320c3b2750b669f7af22"
  },
  {
    "url": "/trade-icon.svg",
    "revision": "d1a7c42b338bb61bb483f32b090470a3"
  },
  {
    "url": "/web-app-manifest-192x192.png",
    "revision": "92b999ae261c9e61eb02a5638465d96e"
  },
  {
    "url": "/web-app-manifest-512x512.png",
    "revision": "7e276f2f23d732f52d1b97647dfd9ac4"
  },
  {
    "url": "/_next/static/PkfBdSgJp4Y-ryBuL93Of/_buildManifest.js",
    "revision": "2ec694eb52ae4f523f265a46bae4d768"
  },
  {
    "url": "/_next/static/PkfBdSgJp4Y-ryBuL93Of/_ssgManifest.js",
    "revision": "b404e23d62d95bafd03ad7747cc0e88b"
  },
  {
    "url": "/_next/static/chunks/23-f5839f97c5fba2a5.js",
    "revision": "4a2d7c3d59d9298d8e3dfdd6134a4eca"
  },
  {
    "url": "/_next/static/chunks/231-d03cde840713e8d2.js",
    "revision": "c770a9f4b0c4245cb72ee63bc0298a3a"
  },
  {
    "url": "/_next/static/chunks/286-ecb32eb4ef84f95a.js",
    "revision": "c0948f0b4ba18e3c3f41c7eda7e0d692"
  },
  {
    "url": "/_next/static/chunks/537-cafc6509d8ee59ed.js",
    "revision": "325e854410abb8df2daeb09c3ade4a5e"
  },
  {
    "url": "/_next/static/chunks/69806262-c226b48b0804116a.js",
    "revision": "bfaf12d920674be12cc983bccc4c3b80"
  },
  {
    "url": "/_next/static/chunks/app/_not-found/page-f20fd5474efc827e.js",
    "revision": "15fe196141ac6b2049eeba57fc2c8970"
  },
  {
    "url": "/_next/static/chunks/app/game/[gameId]/page-32b616951f06d318.js",
    "revision": "db82dbf8ee982d3a2d4d1ca046554bb7"
  },
  {
    "url": "/_next/static/chunks/app/game/page-ec6897f34a4caf90.js",
    "revision": "14f1b453bf5753f389f9aa4bc135e738"
  },
  {
    "url": "/_next/static/chunks/app/invite/[lobbyId]/page-f0cf4a377d6a14c1.js",
    "revision": "21a9bdb2455a562d8d0422e68218a9b4"
  },
  {
    "url": "/_next/static/chunks/app/layout-9491dab09f081696.js",
    "revision": "05eac7a1b6ead4a8b5a8cdf629bc7d54"
  },
  {
    "url": "/_next/static/chunks/app/lobby/[lobbyId]/page-c3dfaf39da64751c.js",
    "revision": "dd41db18bbda936ac3140ccea3eac68b"
  },
  {
    "url": "/_next/static/chunks/app/name-vote/layout-f197cd7bf35af86b.js",
    "revision": "968f9b1e20d78bc06a47f809d20fd6cc"
  },
  {
    "url": "/_next/static/chunks/app/name-vote/page-3bde451f82765edc.js",
    "revision": "6bb0e0ce3c738f25d1869f74b10df291"
  },
  {
    "url": "/_next/static/chunks/app/page-3c128bee9393824c.js",
    "revision": "e71495369d78cd86fbfc9338961c1952"
  },
  {
    "url": "/_next/static/chunks/app/rules/page-ae545c3af603e2d1.js",
    "revision": "4e81666a1cb94522afd676e252b0d051"
  },
  {
    "url": "/_next/static/chunks/bc9e92e6-5362d900ae73d962.js",
    "revision": "e8cac84d2465aeab66af76941fda798a"
  },
  {
    "url": "/_next/static/chunks/fd9d1056-b22a4229a17e004a.js",
    "revision": "89ef5cbeacece4bcb75bbefbaec33dc9"
  },
  {
    "url": "/_next/static/chunks/framework-aec844d2ccbe7592.js",
    "revision": "220b5e82844a0559b62bacc431397074"
  },
  {
    "url": "/_next/static/chunks/main-app-bbb5d7113deee4de.js",
    "revision": "944c5f04370a855d3a4f8cbdfe8baffa"
  },
  {
    "url": "/_next/static/chunks/main-db1c20b04a1e156b.js",
    "revision": "11c455364c9697149a9e6a53cdf9176e"
  },
  {
    "url": "/_next/static/chunks/pages/_app-6a626577ffa902a4.js",
    "revision": "21174aa8f99e95f6dad8d230d1d4cc6f"
  },
  {
    "url": "/_next/static/chunks/pages/_error-1be831200e60c5c0.js",
    "revision": "d1907c97ac44dcd3993a973e8487a623"
  },
  {
    "url": "/_next/static/chunks/polyfills-78c92fac7aa8fdd8.js",
    "revision": "79330112775102f91e1010318bae2bd3"
  },
  {
    "url": "/_next/static/chunks/webpack-91b2d14d0f678b80.js",
    "revision": "00a828b8766ba25b77e6f1de2589ab64"
  },
  {
    "url": "/_next/static/css/d6106640611465bb.css",
    "revision": "5f35e89a0432916287a4d650077bc053"
  },
  {
    "url": "/manifest.json",
    "revision": "PkfBdSgJp4Y-ryBuL93Of"
  },
  {
    "url": "/offline.html",
    "revision": "PkfBdSgJp4Y-ryBuL93Of"
  },
  {
    "url": "/apple-icon.png",
    "revision": "PkfBdSgJp4Y-ryBuL93Of"
  },
  {
    "url": "/favicon.ico",
    "revision": "PkfBdSgJp4Y-ryBuL93Of"
  }
]);
workbox.precaching.cleanupOutdatedCaches();

const AUTH_OR_SESSION_PATHS = [
  /^\/api\/(?:auth|session)(?:\/|$)/,
  /^\/(?:auth|session)(?:\/|$)/,
];

const isSensitivePath = (pathname) => AUTH_OR_SESSION_PATHS.some((pattern) => pattern.test(pathname));

const isRuntimeCacheableGet = ({ request, url }) =>
  request.method === 'GET' &&
  url.origin === self.location.origin &&
  !isSensitivePath(url.pathname);

workbox.routing.registerRoute(
  ({ request, url }) => request.mode === 'navigate' && isRuntimeCacheableGet({ request, url }),
  new workbox.strategies.NetworkFirst({
    cacheName: 'pages',
    networkTimeoutSeconds: 5,
    plugins: [new workbox.expiration.ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 })],
  }),
);

workbox.routing.setCatchHandler(async ({ event }) => {
  if (event.request.mode === 'navigate') {
    return workbox.precaching.matchPrecache('/offline.html');
  }
  return Response.error();
});

workbox.routing.registerRoute(
  ({ request, url }) =>
    isRuntimeCacheableGet({ request, url }) &&
    url.pathname.startsWith('/_next/static/'),
  new workbox.strategies.CacheFirst({
    cacheName: 'next-static-assets',
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] }),
      new workbox.expiration.ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);

workbox.routing.registerRoute(
  ({ request, url }) =>
    isRuntimeCacheableGet({ request, url }) &&
    request.destination === 'font',
  new workbox.strategies.CacheFirst({
    cacheName: 'font-assets',
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] }),
      new workbox.expiration.ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);

workbox.routing.registerRoute(
  ({ request, url }) =>
    isRuntimeCacheableGet({ request, url }) &&
    request.destination === 'image',
  new workbox.strategies.StaleWhileRevalidate({
    cacheName: 'image-assets',
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] }),
      new workbox.expiration.ExpirationPlugin({ maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);
