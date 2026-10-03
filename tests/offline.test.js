// Offline play: sw.js (the service worker), offline.json (what it caches on install, from scripts/build-offline.mjs)
// and its registration (js/main.js registerOffline).
import { test, assert, isNode, loadJSON } from './harness.js';
import { offlineList, serializeOffline, OFFLINE_ROOTS } from '../scripts/build-offline.mjs';
import { registerOffline } from '../js/main.js';

test('offline: the list keeps the app files only, sorted, once each', () => {
  const list = offlineList(['tests/a.test.js', 'js/main.js', 'css/app.css', 'index.html', 'docs/ROADMAP.md', 'js/main.js', 'js/.DS_Store', 'scripts/x.mjs', 'manifest.webmanifest', 'vendor/delaunator/LICENSE']);
  assert.deepEqual(list, ['css/app.css', 'index.html', 'js/main.js', 'manifest.webmanifest', 'vendor/delaunator/LICENSE']);
  assert.match(serializeOffline(list), /"generated": "by scripts\/build-offline\.mjs"/);
});

test('offline: offline.json lists every app file (npm run offline; npm run check fails when it is stale)', async () => {
  const { files } = await loadJSON('offline.json');
  for (const f of ['index.html', 'manifest.webmanifest', 'js/main.js', 'data/principles.json', 'data/scenarios/index.json', 'assets/favicon.svg']) assert.ok(files.includes(f), f);
  assert.ok(files.every((f) => f === 'index.html' || f === 'manifest.webmanifest' || OFFLINE_ROOTS.some((r) => f.startsWith(`${r}/`))), 'only app files');
  if (!isNode) return; // the rest reads the file system
  const { run } = await import('../scripts/build-offline.mjs');
  const lines = [];
  assert.equal(await run({ check: true, log: (s) => lines.push(s) }), 0, lines.join('\n'));
});

test('offline: the service worker answers same-origin GETs network first and falls back to its cache', async () => {
  // Run sw.js against a fake worker scope: fetch fails (offline), the cache has the page.
  const listeners = {};
  const store = new Map();
  const cache = { put: async (k, v) => { store.set(String(k.url ?? k), v); }, match: async (k) => store.get(String(k.url ?? k)) ?? null };
  const scope = {
    location: { origin: 'https://example.org' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  };
  const env = { caches: { open: async () => cache, keys: async () => ['fotbol-v0', 'fotbol-v1'], delete: async (k) => { store.delete(`deleted:${k}`); } } };
  let online = true;
  const fetchFake = async (req) => {
    if (!online) throw new Error('offline');
    const url = String(req.url ?? req);
    return { ok: true, type: 'basic', url, clone() { return this; }, json: async () => ({ files: ['js/main.js'] }) };
  };
  const src = isNode
    ? await (await import('node:fs/promises')).readFile(new URL('../sw.js', import.meta.url), 'utf8')
    : await (await fetch(new URL('../sw.js', import.meta.url))).text();
  new Function('self', 'caches', 'fetch', src)(scope, env.caches, fetchFake);
  assert.deepEqual(Object.keys(listeners).sort(), ['activate', 'fetch', 'install']);
  let installed;
  listeners.install({ waitUntil: (p) => { installed = p; } });
  await installed;
  assert.ok(store.has('./') && store.has('js/main.js'), 'install stores the page and the listed files');
  const respond = async (url, mode = 'no-cors') => {
    let out;
    listeners.fetch({ request: { method: 'GET', url, mode }, respondWith: (p) => { out = p; } });
    return out;
  };
  assert.equal((await respond('https://example.org/js/x.js')).url, 'https://example.org/js/x.js', 'online: the network');
  assert.ok(store.has('https://example.org/js/x.js'), '...and stored');
  online = false;
  assert.equal((await respond('https://example.org/js/x.js')).url, 'https://example.org/js/x.js', 'offline: the stored copy');
  assert.equal(await respond('https://cdn.example.com/x.js'), undefined, 'another origin is left to the browser');
});

test('offline: the worker is registered over http(s) only, and ?nosw turns it off', () => {
  const calls = [];
  const nav = { serviceWorker: { register: (u) => { calls.push(u); return Promise.resolve(); } } };
  assert.equal(registerOffline(nav, { protocol: 'https:', search: '' }), true);
  assert.deepEqual(calls, ['sw.js']);
  assert.equal(registerOffline(nav, { protocol: 'file:', search: '' }), false);
  assert.equal(registerOffline(nav, { protocol: 'http:', search: '?nosw' }), false);
  assert.equal(registerOffline({}, { protocol: 'https:', search: '' }), false, 'no service workers in this browser');
});
