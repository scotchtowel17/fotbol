import { test, assert, isNode } from './harness.js';
import { parseHash, toHash, normalizeSettings, SETTINGS_DEFAULTS, MODE_INFO, NAV_MODES } from '../js/main.js';
import {
  normalizePrinciples, normalizeScenarioIndex, createScenarioStore, buildFormations, loadAppData, DATA_PATHS,
} from '../js/data.js';

// ---- router

test('app: parseHash routes #/<mode>/<args>, defaulting to home', () => {
  assert.deepEqual(parseHash(''), { mode: 'home', params: [] });
  assert.deepEqual(parseHash('#'), { mode: 'home', params: [] });
  assert.deepEqual(parseHash('#/'), { mode: 'home', params: [] });
  assert.deepEqual(parseHash('#/drill'), { mode: 'drill', params: [] });
  assert.deepEqual(parseHash('#/drill/d3-cover-lcb-001'), { mode: 'drill', params: ['d3-cover-lcb-001'] });
  assert.deepEqual(parseHash('#/Explore/a//b/'), { mode: 'explore', params: ['a', 'b'] }, 'mode is case-insensitive; empty segments dropped');
  assert.deepEqual(parseHash('#/learn/step%202'), { mode: 'learn', params: ['step 2'] }, 'params are URI-decoded');
  assert.deepEqual(parseHash('#author'), { mode: 'author', params: [] }, 'legacy #mode form');
});

test('app: parseHash never yields a mode that could escape js/ui/modes/', () => {
  for (const h of ['#/../main', '#/%2e%2e/x', '#/a.b', '#/1abc', '#/<script>', '#/drill%2F..']) {
    const { mode } = parseHash(h);
    assert.match(mode, /^[a-z][a-z0-9-]*$/, `${h} → ${mode}`);
  }
  assert.equal(parseHash('#/../main').mode, 'home');
});

test('app: toHash normalises navigation targets', () => {
  assert.equal(toHash('drill/x'), '#/drill/x');
  assert.equal(toHash('#/drill/x'), '#/drill/x');
  assert.equal(toHash('/live'), '#/live');
  assert.equal(toHash('#home'), '#/home');
});

test('app: every nav mode has title and blurb copy', () => {
  for (const m of [...NAV_MODES, 'home', 'dev']) {
    assert.ok(MODE_INFO[m]?.title, `${m} title`);
    assert.ok(MODE_INFO[m]?.blurb, `${m} blurb`);
  }
});

// ---- settings

test('app: normalizeSettings fills defaults and rejects bad values', () => {
  assert.deepEqual(normalizeSettings(undefined), { ...SETTINGS_DEFAULTS });
  assert.deepEqual(normalizeSettings('junk'), { ...SETTINGS_DEFAULTS });
  const s = normalizeSettings({ theme: 'neon', wording: 'kid', reducedMotion: 'yes', role: 'GK' });
  assert.equal(s.theme, 'auto');
  assert.equal(s.wording, 'kid');
  assert.equal(s.reducedMotion, false, 'only boolean true turns reduced motion on');
  assert.equal(s.role, SETTINGS_DEFAULTS.role, 'GK is not learnable in v1');
  assert.equal(normalizeSettings({ role: 'RW' }).role, 'RW');
  assert.equal(normalizeSettings({ speed: 1.25 }).speed, 1.25, 'unknown keys from other modes survive');
});

// ---- data loaders

test('data: principles normalise from array, {principles}, or an id-keyed object', () => {
  const a = normalizePrinciples([{ id: 'D1', name: 'Press' }, { name: 'no id' }, null]);
  assert.deepEqual(a.list.map((p) => p.id), ['D1']);
  assert.equal(a.byId.D1.name, 'Press');
  const b = normalizePrinciples({ version: 1, principles: [{ id: 'D3' }, { id: 'U4' }] });
  assert.deepEqual(Object.keys(b.byId), ['D3', 'U4']);
  const c = normalizePrinciples({ B1: { name: 'Width' } });
  assert.equal(c.byId.B1.id, 'B1');
  assert.deepEqual(normalizePrinciples(null), { list: [], byId: {} });
});

test('data: scenario index accepts file names, ids and objects; dedupes; skips junk', () => {
  const idx = normalizeScenarioIndex({
    scenarios: [
      'd3-cover-lcb-001.json',
      'b1-width-lw-001',
      { id: 'u4-tuck-rb-001', title: 'Tuck in', module: 'M1' },
      { file: 'nested/x-001.json' },
      { id: 'd3-cover-lcb-001' },
      42, null, {},
    ],
  });
  assert.deepEqual(idx.map((m) => m.id), ['d3-cover-lcb-001', 'b1-width-lw-001', 'u4-tuck-rb-001', 'x-001']);
  assert.equal(idx[1].file, 'b1-width-lw-001.json');
  assert.equal(idx[2].file, 'u4-tuck-rb-001.json');
  assert.equal(idx[2].title, 'Tuck in', 'metadata is kept');
  assert.equal(idx[3].file, 'nested/x-001.json');
  assert.deepEqual(normalizeScenarioIndex(undefined), []);
});

test('data: scenario store loads by file, caches, and retries after a failure', async () => {
  const calls = [];
  let fail = true;
  const getJSON = async (path) => {
    calls.push(path);
    if (path.endsWith('flaky.json') && fail) throw new Error('HTTP 404');
    return { path };
  };
  const store = createScenarioStore(normalizeScenarioIndex([{ id: 'a', file: 'dir/a-file.json' }, 'flaky']), getJSON);
  const s1 = await store.load('a');
  const s2 = await store.load('a');
  assert.equal(s1, s2, 'same object from the cache');
  assert.deepEqual(calls, [`${DATA_PATHS.scenarioDir}dir/a-file.json`]);
  assert.equal(store.meta('a').file, 'dir/a-file.json');
  assert.equal(store.meta('zzz'), null);

  let err = null;
  try { await store.load('flaky'); } catch (e) { err = e; }
  assert.match(err?.message ?? '', /flaky/);
  fail = false;
  assert.deepEqual(await store.load('flaky'), { path: `${DATA_PATHS.scenarioDir}flaky.json` }, 'failure is not cached');
  await store.load('unlisted');
  assert.equal(calls.at(-1), `${DATA_PATHS.scenarioDir}unlisted.json`, 'unknown ids fall back to <id>.json');
});

test('data: buildFormations shares one table for both teams and degrades gracefully', () => {
  const made = [];
  const make = (t) => { made.push(t ?? null); return { id: t?.id ?? 'linear' }; };
  const f = buildFormations({ id: 'helios-433' }, make);
  assert.equal(f.us, f.them);
  assert.equal(f.us.id, 'helios-433');

  const warn = console.warn; console.warn = () => {};
  try {
    const fallback = buildFormations({ id: 'broken' }, (t) => { if (t) throw new Error('bad table'); return { id: 'linear' }; });
    assert.equal(fallback.us.id, 'linear', 'falls back to the table-less formation');
    assert.equal(buildFormations(null, () => { throw new Error('no engine'); }), null);
  } finally { console.warn = warn; }
});

test('data: loadAppData never rejects when every file is missing', async () => {
  const info = console.info, warn = console.warn;
  console.info = console.warn = () => {};
  try {
    const data = await loadAppData({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
    assert.deepEqual(data.principles, { list: [], byId: {} });
    assert.equal(data.curriculum, null);
    assert.equal(data.tutorial, null);
    assert.equal(data.resources, null);
    assert.deepEqual(data.scenarios.index, []);
    assert.ok(data.formations === null || (data.formations.us && data.formations.them));
  } finally { console.info = info; console.warn = warn; }
});

test('data: loadAppData reads the real data files (Node, from disk)', async () => {
  if (!isNode) return; // the browser path is the same code with the real fetch
  const { readFile } = await import('node:fs/promises');
  const diskFetch = async (url) => {
    try {
      const text = await readFile(new URL(url), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(text) };
    } catch {
      return { ok: false, status: 404, json: async () => null };
    }
  };
  const info = console.info; console.info = () => {};
  try {
    const data = await loadAppData({ fetchImpl: diskFetch });
    assert.ok(Array.isArray(data.principles.list));
    for (const p of data.principles.list) assert.equal(data.principles.byId[p.id], p);
    if (data.formations) {
      const pos = data.formations.us.positions({ x: 52.5, y: 34 });
      for (const role of ['GK', 'LCB', 'RCB', 'LB', 'RB', 'DM', 'LCM', 'RCM', 'LW', 'RW', 'ST']) {
        assert.ok(Number.isFinite(pos[role]?.x) && Number.isFinite(pos[role]?.y), `${role} has a position`);
      }
    }
  } finally { console.info = info; }
});
