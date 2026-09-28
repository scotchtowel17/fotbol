import { test, assert, isNode } from './harness.js';
import {
  parseHash, toHash, normalizeSettings, SETTINGS_DEFAULTS, MODE_INFO, NAV_MODES, settingsLinks, isDevMode,
  resolveRoute, mergeSettings, effectiveWording, routeUrl, PLAYER_ROUTES, SETTINGS_COPY,
} from '../js/main.js';
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

test('app: the learner\'s settings menu has no developer tools unless the address asks for them', () => {
  const plain = settingsLinks().map((l) => l.href);
  assert.deepEqual(plain, ['#/credits']);
  const dev = settingsLinks({ dev: true }).map((l) => l.href);
  assert.ok(dev.includes('#/dev') && dev.includes('tests.html'));
  assert.equal(isDevMode(''), false);
  assert.equal(isDevMode('?t=1'), false);
  assert.equal(isDevMode('?dev'), true);
  assert.equal(isDevMode('?debug&x=1'), true);
  assert.equal(isDevMode('?dev=1'), true);
});

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

test('app: sound effects are on by default; only false switches them off', () => {
  assert.equal(SETTINGS_DEFAULTS.sound, true);
  assert.equal(normalizeSettings({}).sound, true);
  assert.equal(normalizeSettings({ sound: false }).sound, false);
  assert.equal(normalizeSettings({ sound: 'off' }).sound, true, 'a damaged value keeps the default');
  assert.equal(normalizeSettings({ sound: true }).sound, true);
});

// ---- the two modes (docs/KID_REDESIGN.md §1-§2)

test('app: Player mode is the default for everyone, and it always uses simple wording', () => {
  assert.equal(SETTINGS_DEFAULTS.mode, 'player');
  assert.equal(normalizeSettings(undefined).mode, 'player');
  assert.equal(normalizeSettings(undefined).wording, 'kid');
  assert.equal(normalizeSettings({ mode: 'player', detail: true }).wording, 'kid', '"More detail" is a Coach mode setting');
  assert.equal(normalizeSettings({ mode: 'coach' }).wording, 'standard', 'Coach mode is detailed by default');
  assert.equal(normalizeSettings({ mode: 'coach', detail: false }).wording, 'kid', 'Coach mode with "More detail" off: simple words');
  assert.equal(normalizeSettings({ mode: 'robot' }).mode, 'player');
  assert.equal(effectiveWording({ mode: 'coach', detail: true }), 'standard');
  assert.equal(effectiveWording({}), 'kid');
});

test('app: settings saved before the two modes keep their wording choice as "More detail"', () => {
  const kid = normalizeSettings({ wording: 'kid', theme: 'dark' });
  assert.deepEqual([kid.mode, kid.detail, kid.wording, kid.theme], ['player', false, 'kid', 'dark']);
  const standard = normalizeSettings({ wording: 'standard' });
  assert.deepEqual([standard.mode, standard.detail, standard.wording], ['player', true, 'kid']);
  assert.equal(normalizeSettings({ ...standard, mode: 'coach' }).wording, 'standard', 'switching to Coach mode brings the detail back');
  assert.equal(normalizeSettings({ mode: 'coach', detail: false, wording: 'standard' }).wording, 'kid', 'detail wins over a stale wording');
});

test('app: mergeSettings turns a wording patch into "More detail" and re-derives the wording', () => {
  const player = normalizeSettings({});
  const coach = mergeSettings(player, { mode: 'coach' });
  assert.deepEqual([coach.mode, coach.wording], ['coach', 'standard']);
  const simple = mergeSettings(coach, { detail: false });
  assert.equal(simple.wording, 'kid');
  const legacy = mergeSettings(coach, { wording: 'kid' }); // an old progress file or an older module
  assert.deepEqual([legacy.detail, legacy.wording], [false, 'kid']);
  assert.equal(mergeSettings(legacy, { wording: 'standard' }).wording, 'standard');
  const back = mergeSettings(coach, { mode: 'player' });
  assert.deepEqual([back.mode, back.detail, back.wording], ['player', true, 'kid']);
  assert.equal(mergeSettings(player, { speed: 2 }).speed, 2, 'unknown keys survive');
  assert.equal(mergeSettings(player, null).mode, 'player');
});

test('app: the word "Kid" is gone from the settings; the wording switch is "More detail"', () => {
  assert.equal(SETTINGS_COPY.detail, 'More detail');
  assert.equal(SETTINGS_COPY.backToPlayer, 'Back to Player mode');
  for (const v of Object.values(SETTINGS_COPY)) assert.doesNotMatch(v, /\bkid/i, v);
});

test('app: resolveRoute sends "#/" to the Player home (the kick-off on a first open) or, in Coach mode, the Coach home', () => {
  const player = { appMode: 'player', onboarded: true };
  assert.deepEqual(resolveRoute(parseHash('#/'), player), { kind: 'player', module: 'home', mode: 'home', params: [] });
  assert.deepEqual(resolveRoute(parseHash('#/home'), player).module, 'home');
  assert.deepEqual(resolveRoute(parseHash('#/'), { appMode: 'player', onboarded: false }), { kind: 'player', module: 'kickoff', mode: 'kickoff', params: [], redirect: '#/kickoff' });
  assert.deepEqual(resolveRoute(parseHash('#/'), { appMode: 'coach', onboarded: false }), { kind: 'coach', module: 'home', mode: 'home', params: [] });
  assert.deepEqual(resolveRoute(parseHash('#/coach'), player), { kind: 'coach', module: 'home', mode: 'coach', params: [] }, 'Coach home works in Player mode too');
  assert.deepEqual(resolveRoute(parseHash('#/'), {}).module, 'kickoff', 'no context: Player mode, not onboarded');
});

test('app: Player routes load js/ui/player/<name>.js and every Coach route keeps working in both modes', () => {
  assert.deepEqual([...PLAYER_ROUTES], ['kickoff', 'play', 'pass', 'matchday', 'card']);
  for (const appMode of ['player', 'coach']) {
    for (const name of PLAYER_ROUTES) {
      const r = resolveRoute(parseHash(`#/${name}/x`), { appMode, onboarded: true });
      assert.deepEqual([r.kind, r.module, r.params], ['player', name, ['x']], `${appMode} #/${name}`);
      assert.match(routeUrl(r), new RegExp(`/js/ui/player/${name}\\.js$`));
    }
    for (const mode of ['drill', 'explore', 'learn', 'live', 'progress', 'author', 'trophies', 'credits', 'dev']) {
      const r = resolveRoute(parseHash(`#/${mode}/a`), { appMode, onboarded: false });
      assert.deepEqual([r.kind, r.module, r.params], ['coach', mode, ['a']], `${appMode} #/${mode}`);
      assert.match(routeUrl(r), new RegExp(`/js/ui/modes/${mode}\\.js$`));
    }
  }
  assert.match(routeUrl(resolveRoute(parseHash('#/coach'))), /\/js\/ui\/modes\/home\.js$/);
  assert.ok(MODE_INFO.coach?.title && MODE_INFO.coach?.blurb);
});

test('app: the trophy room is a known route', () => {
  assert.deepEqual(parseHash('#/trophies/kit/sky'), { mode: 'trophies', params: ['kit', 'sky'] });
  assert.ok(MODE_INFO.trophies?.title && MODE_INFO.trophies?.blurb);
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

// ---- components (browser only: they build DOM)

test('app (browser): a dialog closes when the route changes, so it can never be confirmed over another page', async () => {
  if (isNode) return;
  const { openModal } = await import('../js/ui/components.js');
  let closedWith = null;
  const m = openModal({ title: 'Reset all progress?', content: 'Test', onClose: (v) => { closedWith = v; } });
  assert.ok(m.el.isConnected, 'open');
  const closed = new Promise((r) => { m.el.addEventListener('close', r, { once: true }); setTimeout(r, 2000); }); // the close event is queued
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await closed;
  assert.equal(closedWith, 'route');
  assert.equal(m.el.isConnected, false, 'removed');
  m.close('again'); // closing twice is harmless
  assert.equal(closedWith, 'route');
});

test('app (browser): a collapsed bottom sheet opens when keyboard focus moves below the fold, and closes when it leaves', async () => {
  if (isNode) return;
  const { stageLayout, el } = await import('../js/ui/components.js');
  const host = el('div', { style: 'position:fixed;left:0;top:0;width:360px;height:640px;opacity:0;pointer-events:none' });
  document.body.append(host);
  try {
    const layout = stageLayout(host, { label: 'Test' });
    const inActions = el('button', { type: 'button', text: 'Lock in' });
    const below = el('a', { href: '#/drill/M1', text: 'M1' });
    layout.panel.actions.append(inActions);
    layout.panel.body.append(below);
    const narrow = matchMedia('(max-width: 899.98px)').matches;
    const expanded = () => layout.panel.root.classList.contains('is-expanded');
    below.focus();
    assert.equal(expanded(), narrow, narrow ? 'a phone-width window opens the sheet' : 'a wide window has no sheet to open');
    inActions.focus();
    assert.equal(expanded(), false, 'focus back in the always-visible part closes it again');
    layout.expand();
    below.focus();
    inActions.focus();
    assert.equal(expanded(), true, 'a sheet the learner opened stays open');
    layout.destroy();
  } finally {
    host.remove();
  }
});
