// App boot: settings, data, the two modes' headers, and the hash router. Contracts: docs/ARCHITECTURE.md §5.9 and
// docs/KID_REDESIGN.md §1-§2 (Player mode).
//
// Two modes (settings.mode):
//   'player' (the default for everyone): the kid-first Player mode, js/ui/player/<name>.js, with the minimal top bar of
//            js/ui/player/shell.js. It always uses simple wording.
//   'coach':  the full app, js/ui/modes/<mode>.js, with the header in index.html. Its "More detail" switch
//            (settings.detail) picks detailed wording (on) or simple wording (off).
// settings.wording is the EFFECTIVE wording ('standard' | 'kid'), derived from the two (effectiveWording), so every module
// that reads app.settings.wording keeps working. The word "Kid" never shows in the UI.
//
// Routes are '#/<mode>[/<arg>...]' (resolveRoute):
//   Player  '#/' (Player home, or '#/kickoff' until a position is picked), '#/kickoff', '#/play', '#/pass',
//           '#/matchday', '#/card'                                        → js/ui/player/<name>.js
//   Coach   '#/coach' (Coach home; '#/' is Coach home in Coach mode), '#/drill', '#/explore', '#/learn', '#/live',
//           '#/progress', '#/author', '#/trophies', '#/credits', '#/dev'  → js/ui/modes/<mode>.js
// Every route works in both modes: a Coach route opened in Player mode shows the Coach header, whose "Back to Player
// mode" returns to '#/'. Each module exports mount(root, app, params) → void | unmount() and is loaded with a dynamic
// import(), so one that doesn't exist yet shows a friendly "coming soon" card instead of breaking the app.
//
// Pure helpers (parseHash, resolveRoute, normalizeSettings, mergeSettings, effectiveWording, MODE_INFO, settingsLinks,
// isDevMode) are exported for tests; the app only boots when the page has a #app element.

import * as store from './store.js';
import { loadAppData } from './data.js';
import { createBoard } from './ui/board.js';
import { LEARNABLE_ROLES } from './engine/roles.js';
import { el, icon, notice, button, linkButton, segmented, toggleSwitch, announce } from './ui/components.js';
import { createCelebrations, renderPill } from './ui/celebrate.js';
import { createSound } from './ui/sound.js';
import { loadRewards, applyKit, onRewards, youLabel } from './ui/rewards-store.js';
import { createPlayerShell, chromeFor, playerTitle, soonCard, failedCard } from './ui/player/shell.js';
import { loadProfile, loadRoad, bindRoad } from './ui/player/road.js';

/** Every Coach route, with the copy used in nav, titles and "coming soon" cards. */
export const MODE_INFO = Object.freeze({
  home: { title: 'Home', blurb: 'Pick your position and start playing.' },
  coach: { title: 'Coach home', blurb: 'Every mode, the path through the modules, and the position you play.' },
  learn: { title: 'Learn', icon: 'learn', blurb: 'A short guided tour of the pitch: thirds, lanes, goal-side and the offside line.' },
  explore: { title: 'Explore', icon: 'explore', blurb: 'Move the ball and watch where you should be change, with the reasons live.' },
  drill: { title: 'Drill', icon: 'drill', blurb: 'Watch the play, it freezes, you drag yourself to the right spot and see why.' },
  live: { title: 'Live', icon: 'live', blurb: 'Play runs on and you keep adjusting. Your score is how well you held your spot.' },
  progress: { title: 'Progress', icon: 'progress', blurb: 'Your stars for each principle, your history, and export or import of your progress.' },
  trophies: { title: 'Trophies', icon: 'trophy', blurb: 'Your level, badges, sticker album and kit.' },
  author: { title: 'Author', icon: 'code', blurb: 'Build a scenario, let the engine key it, and export the JSON.' },
  credits: { title: 'Credits', blurb: 'The data, libraries and sources fotbol is built on.' },
  dev: { title: 'Playground', icon: 'pitch', blurb: 'Developer playground for the engine: drag yourself or the ball and see the ghost, score and reasons live.' },
});

/** Modes in the Coach header's navigation, in order. */
export const NAV_MODES = Object.freeze(['learn', 'explore', 'drill', 'live', 'progress']);

/** Player-mode routes (docs/KID_REDESIGN.md §2): js/ui/player/<name>.js. '#/' is the Player home in Player mode. */
export const PLAYER_ROUTES = Object.freeze(['kickoff', 'play', 'pass', 'matchday', 'card']);

export const SETTINGS_DEFAULTS = Object.freeze({
  wording: 'kid', // derived (effectiveWording): 'kid' = simple words, 'standard' = detailed; every mode reads this
  theme: 'auto', // 'auto' | 'light' | 'dark'
  reducedMotion: false, // true forces reduced motion; false follows the system setting
  role: 'LCB', // Coach mode's learner role (one of LEARNABLE_ROLES); Player mode keeps its own in the player profile
  sound: true, // sound effects (js/ui/sound.js): the whistle, star ticks, dings, the cheer and the level-up fanfare
  mode: 'player', // 'player' (the default for everyone) | 'coach'
  detail: true, // Coach mode's "More detail": on = detailed wording, off = simple wording (Player mode is always simple)
});

/** Copy of the settings the header menu shows (no "Kid" anywhere: the wording switch is "More detail"). */
export const SETTINGS_COPY = Object.freeze({
  detail: 'More detail',
  detailHint: 'Coach wording, with every reason. Off: simple words.',
  detailOn: 'More detail on.',
  detailOff: 'Simple words on.',
  backToPlayer: 'Back to Player mode',
  backShort: 'Player mode',
  playerOn: 'Player mode is on.',
});

const MODE_RE = /^[a-z][a-z0-9-]*$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * '#/drill/d3-cover-lcb-001' → { mode: 'drill', params: ['d3-cover-lcb-001'] }.
 * Empty or malformed hashes route home. '#drill' (no slash) is accepted too.
 * @returns {{ mode: string, params: string[] }}
 */
export function parseHash(hash = '') {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  const mode = (parts[0] ?? '').toLowerCase();
  if (!MODE_RE.test(mode)) return { mode: 'home', params: [] };
  return { mode, params: parts.slice(1) };
}

/** '#/drill/x', 'drill/x', '/drill/x' → '#/drill/x'. */
export function toHash(target = '') {
  const s = String(target).replace(/^#?\/?/, '');
  return `#/${s}`;
}

/**
 * Which module a parsed hash opens (pure).
 * @param {{ mode: string, params: string[] }} parsed  parseHash() output
 * @param {{ appMode?: 'player'|'coach', onboarded?: boolean }} [ctx]  onboarded: the player profile's (js/ui/player/road.js)
 * @returns {{ kind: 'player'|'coach', module: string, mode: string, params: string[], redirect?: string }}
 *   module: the file name under js/ui/player/ (kind 'player') or js/ui/modes/ (kind 'coach'); redirect: the address
 *   to show instead (replaceState), e.g. '#/kickoff' on a first open
 */
export function resolveRoute({ mode = 'home', params = [] } = {}, { appMode = 'player', onboarded = false } = {}) {
  if (mode === 'home') {
    if (appMode === 'coach') return { kind: 'coach', module: 'home', mode: 'home', params };
    if (!onboarded) return { kind: 'player', module: 'kickoff', mode: 'kickoff', params: [], redirect: '#/kickoff' };
    return { kind: 'player', module: 'home', mode: 'home', params };
  }
  if (mode === 'coach') return { kind: 'coach', module: 'home', mode: 'coach', params };
  if (PLAYER_ROUTES.includes(mode)) return { kind: 'player', module: mode, mode, params };
  return { kind: 'coach', module: mode, mode, params };
}

/** The wording every module reads: detailed only in Coach mode with "More detail" on. */
export const effectiveWording = ({ mode, detail } = {}) => (mode === 'coach' && detail !== false ? 'standard' : 'kid');

/** Validate stored settings, keeping unknown keys other modes may have added. */
export function normalizeSettings(raw) {
  const s = isObj(raw) ? raw : {};
  const mode = s.mode === 'coach' ? 'coach' : 'player';
  // Settings saved before the two modes kept the wording choice in `wording` ('kid' = simple words).
  const detail = typeof s.detail === 'boolean' ? s.detail : s.wording !== 'kid';
  return {
    ...s,
    wording: effectiveWording({ mode, detail }),
    theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : SETTINGS_DEFAULTS.theme,
    reducedMotion: s.reducedMotion === true,
    role: LEARNABLE_ROLES.includes(s.role) ? s.role : SETTINGS_DEFAULTS.role,
    sound: s.sound !== false, // on unless switched off
    mode,
    detail,
  };
}

/**
 * Settings after a patch (pure). A `wording` patch (an old progress file, an older module) sets "More detail":
 * 'standard' turns it on, 'kid' off; the wording itself is always derived.
 */
export function mergeSettings(current, patch) {
  const p = isObj(patch) ? { ...patch } : {};
  if ('wording' in p) {
    if (!('detail' in p)) p.detail = p.wording !== 'kid';
    delete p.wording;
  }
  return normalizeSettings({ ...(isObj(current) ? current : {}), ...p });
}

/** URL of a Coach mode module. */
export const modeUrl = (mode) => new URL(`./ui/modes/${mode}.js`, import.meta.url).href;
/** URL of a Player mode module. */
export const playerUrl = (name) => new URL(`./ui/player/${name}.js`, import.meta.url).href;
/** URL of the module a resolved route opens. */
export const routeUrl = (r) => (r?.kind === 'player' ? playerUrl(r.module) : modeUrl(r?.module ?? 'home'));

/** True when the address asks for contributor tools: '?dev' or '?debug' (e.g. index.html?dev#/drill). */
export function isDevMode(search = '') {
  try {
    const q = new URLSearchParams(search);
    return q.has('dev') || q.has('debug');
  } catch {
    return false;
  }
}

/**
 * Links at the foot of the settings menu. The engine playground and the test runner are contributor tools, so
 * a learner never lands in them by accident: they are listed only in dev mode (isDevMode) and stay reachable
 * by their URLs (#/dev, tests.html).
 * @returns {{ href: string, text: string }[]}
 */
export function settingsLinks({ dev = false } = {}) {
  return [
    { href: '#/credits', text: 'Credits' },
    ...(dev ? [{ href: '#/dev', text: 'Engine playground' }, { href: 'tests.html', text: 'Run tests' }] : []),
  ];
}

const EMPTY_DATA = Object.freeze({
  principles: { list: [], byId: {} },
  curriculum: null,
  tutorial: null,
  resources: null,
  formations: null,
  scenarios: { index: [], meta: () => null, load: (id) => Promise.reject(new Error(`scenario ${id}: data not loaded`)) },
  road: null,
});

// ---------------------------------------------------------------- browser-only below

function applySettings(s) {
  const d = document.documentElement.dataset;
  if (s.theme === 'auto') delete d.theme; else d.theme = s.theme;
  d.wording = s.wording;
  d.appMode = s.mode;
  if (s.reducedMotion) d.reducedMotion = 'true'; else delete d.reducedMotion;
}

function createApp() {
  const listeners = new Set();
  const app = {
    data: EMPTY_DATA,
    store,
    settings: normalizeSettings(store.get('settings')),
    /** Merge a patch into settings (in place, so held references stay current), persist, apply, notify. */
    setSettings(patch = {}) {
      const before = { ...app.settings };
      const next = mergeSettings(app.settings, patch);
      Object.assign(app.settings, next);
      store.set('settings', app.settings);
      applySettings(app.settings);
      // Listeners see what changed: the patch, plus the wording when a mode or "More detail" change moved it.
      const changed = { ...(isObj(patch) ? patch : {}) };
      for (const k of ['wording', 'mode', 'detail']) if (before[k] !== app.settings[k]) changed[k] = app.settings[k];
      for (const fn of listeners) {
        try { fn(app.settings, changed); } catch (err) { console.error(err); }
      }
      window.dispatchEvent(new CustomEvent('fotbol:settings', { detail: { settings: app.settings, patch: changed } }));
    },
    /** Extra (not in §5.9): subscribe to settings changes. @returns unsubscribe */
    onSettings(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    navigate(target) {
      const hash = toHash(target);
      if (location.hash === hash) route();
      else location.hash = hash;
    },
    /** board.js createBoard, with the learner's nickname (if set) as the tag over their token. */
    createBoard: (container, opts = {}) => createBoard(container, { youLabel: youLabel(loadRewards(app)), ...opts }),
    /** Extra: the current route ({ mode, params, kind: 'player'|'coach' }). */
    route: { mode: 'home', params: [], kind: 'player' },
  };
  applySettings(app.settings);
  // Extras (§5.13): sound effects, the celebrations, and the chosen kit on every board.
  app.sound = createSound({ enabled: () => app.settings.sound !== false });
  app.celebrate = createCelebrations(app);
  applyKit(loadRewards(app));
  return app;
}

// ---- the Coach header: nav state, "Back to Player mode" and the settings menu

function updateNav(mode) {
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === mode) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

/** The level pill ("Lv 3" and the rank's icon) before the settings button: a way into the trophy room (§5.13). */
function wireLevelPill(app, header) {
  const pill = el('a', { class: 'rw-pill', href: '#/trophies', 'data-nav': 'trophies' });
  header.insertBefore(pill, header.querySelector('.settings'));
  const update = (state) => renderPill(pill, state ?? loadRewards(app), app.settings.wording);
  update();
  onRewards(update);
  app.onSettings((_s, patch) => { if ('wording' in (patch ?? {})) update(); });
  // A drill holds the pill back until it reveals a rep (rewards-store.js award): leaving before that catches up here.
  window.addEventListener('hashchange', () => update());
}

/** "Back to Player mode": switches the mode (in Coach mode) and goes to the Player home. */
function wireBackToPlayer(app, header) {
  let link = document.getElementById('coach-back');
  if (!link) {
    link = el('a', { id: 'coach-back', class: 'btn btn--secondary coach-back', href: '#/', 'aria-label': SETTINGS_COPY.backToPlayer }, [
      el('span', { class: 'coach-back-long', text: SETTINGS_COPY.backToPlayer }),
      el('span', { class: 'coach-back-short', 'aria-hidden': 'true', text: SETTINGS_COPY.backShort }),
    ]);
    header.insertBefore(link, header.querySelector('.settings'));
  }
  link.addEventListener('click', (e) => {
    e.preventDefault();
    if (app.settings.mode !== 'player') {
      app.setSettings({ mode: 'player' });
      announce(SETTINGS_COPY.playerOn);
    }
    app.navigate('#/');
  });
}

function buildSettingsMenu(app, menu) {
  const persistent = store.isPersistent();
  const coach = app.settings.mode === 'coach';
  menu.replaceChildren(...[
    el('h2', { class: 'menu-title', text: 'Settings' }),
    segmented({
      legend: 'Theme', value: app.settings.theme,
      options: [{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      onChange: (theme) => app.setSettings({ theme }),
    }),
    // Player mode always uses simple words, so "More detail" is a Coach mode setting.
    coach ? toggleSwitch({
      label: SETTINGS_COPY.detail, checked: app.settings.detail !== false, hint: SETTINGS_COPY.detailHint,
      onChange: (detail) => {
        app.setSettings({ detail });
        announce(detail ? SETTINGS_COPY.detailOn : SETTINGS_COPY.detailOff);
      },
    }) : null,
    toggleSwitch({
      label: 'Reduce motion', checked: app.settings.reducedMotion,
      hint: 'When off, fotbol follows your device setting.',
      onChange: (reducedMotion) => app.setSettings({ reducedMotion }),
    }),
    toggleSwitch({
      label: 'Sound', checked: app.settings.sound !== false,
      hint: 'Whistle, dings and cheers.',
      onChange: (sound) => {
        app.setSettings({ sound });
        if (sound) app.sound?.play('good');
      },
    }),
    persistent ? null : el('p', { class: 'menu-note', text: 'This browser window cannot save progress (private mode or blocked storage). Settings last until you close it.' }),
    el('div', { class: 'menu-links' }, settingsLinks({ dev: isDevMode(location.search) }).map((l) => el('a', { href: l.href, text: l.text }))),
  ].filter(Boolean));
}

/** Keep --header-h at the height of the header on show (0 when a screen has none). */
function trackHeaderHeight() {
  const header = document.querySelector('.app-header');
  const bar = document.getElementById('player-bar');
  const set = () => {
    const chrome = document.documentElement.dataset.chrome;
    const h = chrome === 'coach' ? header?.offsetHeight ?? 0 : chrome === 'player' ? bar?.offsetHeight ?? 0 : 0;
    document.documentElement.style.setProperty('--header-h', `${h}px`);
  };
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(set);
    if (header) ro.observe(header);
    if (bar) ro.observe(bar);
  }
  return set;
}

function wireHeader(app) {
  // The skip link targets #app, which the hash router would read as a route: focus main instead.
  document.getElementById('skip-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('app')?.focus();
  });

  const header = document.querySelector('.app-header');
  if (header) {
    wireBackToPlayer(app, header);
    wireLevelPill(app, header);
  }

  const btn = document.getElementById('settings-toggle');
  const menu = document.getElementById('settings-menu');
  if (!btn || !menu) return;
  btn.replaceChildren(icon('settings'), el('span', { class: 'visually-hidden', text: 'Settings' }));

  const setOpen = (open, { focus = false } = {}) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      buildSettingsMenu(app, menu);
      (menu.querySelector('input:checked') ?? menu.querySelector('input'))?.focus();
    } else if (focus) btn.focus();
  };
  btn.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) setOpen(false, { focus: true }); });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  window.addEventListener('hashchange', () => { if (!menu.hidden) setOpen(false); });
  // Another view may change settings (e.g. the playground's theme button): rebuild an open menu.
  // (Skipped while focus is inside the menu: the change came from it, and rebuilding would drop focus.)
  app.onSettings(() => { if (!menu.hidden && !menu.contains(document.activeElement)) buildSettingsMenu(app, menu); });
}

// ---- router

let appRef = null;
let shell = null;
let headerHeight = () => {};
let current = { token: 0, unmount: null };

function comingSoon(r) {
  if (r.kind === 'player') return soonCard(r);
  const info = MODE_INFO[r.mode];
  return notice({
    title: info ? `${info.title} is coming soon` : 'Page not found',
    text: info ? info.blurb : `There is no "${r.mode}" page. Try one of the modes above.`,
    actions: [linkButton('Back to home', '#/coach', { variant: 'primary', icon: 'arrow' })],
  });
}

function failed(r, err) {
  if (r.kind === 'player') return failedCard(r, err);
  return notice({
    tone: 'bad',
    title: `${MODE_INFO[r.mode]?.title ?? r.mode} couldn't start`,
    text: `Something went wrong while loading this page (${err?.message ?? err}). Details are in the browser console.`,
    // A dropped connection is the usual cause (a busy local server): a reload usually fixes it.
    actions: [button('Try again', { variant: 'primary', icon: 'arrow', onClick: () => location.reload() }), linkButton('Back to home', '#/coach')],
  });
}

/**
 * Import a module, retrying once after a dropped connection (busy local servers drop requests when a cold
 * browser loads every module at once); the second try uses a fresh URL in case the browser remembers the
 * failed one. A real error (a syntax error, a missing file) still throws.
 */
async function importModule(url) {
  try {
    return await import(url);
  } catch (err) {
    await new Promise((r) => setTimeout(r, 400));
    try { return await import(url); } catch { /* try a fresh URL */ }
    try { return await import(`${url}?retry=${Date.now()}`); } catch { throw err; }
  }
}

async function moduleExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

function titleFor(r) {
  if (r.kind === 'player') return playerTitle(r.module);
  if (r.module === 'home') return 'fotbol · learn where to stand';
  return `${MODE_INFO[r.mode]?.title ?? r.mode} · fotbol`;
}

async function route() {
  const app = appRef;
  const main = document.getElementById('app');
  const r = resolveRoute(parseHash(location.hash), { appMode: app.settings.mode, onboarded: loadProfile(app).onboarded });
  if (r.redirect && location.hash !== r.redirect) {
    try { history.replaceState(history.state, '', r.redirect); } catch { /* the address stays; the view is right */ }
  }
  const token = ++current.token;
  const first = token === 1;

  try { current.unmount?.(); } catch (err) { console.error('[fotbol] unmount failed', err); }
  current.unmount = null;
  app.route = { mode: r.mode, params: r.params, kind: r.kind };
  shell?.setChrome(chromeFor(r));
  headerHeight();
  updateNav(r.kind === 'coach' ? r.mode : null);
  document.title = titleFor(r);

  // Each mount gets its own view element, so a mount still running after a newer navigation writes into a detached node.
  const view = el('div', { class: r.kind === 'player' ? ['view', 'view--player', `view--${r.module}`] : ['view', `view--${r.mode}`] });
  main.replaceChildren(view);
  main.dataset.mode = r.mode;
  main.dataset.kind = r.kind;

  const url = routeUrl(r);
  let mod;
  try {
    mod = await importModule(url);
  } catch (err) {
    if (token !== current.token) return;
    const exists = await moduleExists(url);
    if (token !== current.token) return;
    if (exists) console.error(`[fotbol] "${r.mode}" failed to load`, err);
    view.replaceChildren(exists ? failed(r, err) : comingSoon(r));
    return;
  }
  if (token !== current.token) return;
  if (typeof mod.mount !== 'function') {
    view.replaceChildren(comingSoon(r));
    return;
  }
  try {
    const unmount = await mod.mount(view, app, r.params);
    if (token !== current.token) {
      if (typeof unmount === 'function') unmount();
      return;
    }
    current.unmount = typeof unmount === 'function' ? unmount : null;
  } catch (err) {
    console.error(`[fotbol] "${r.mode}" failed to mount`, err);
    if (token === current.token) view.replaceChildren(failed(r, err));
    return;
  }
  if (!first) {
    window.scrollTo(0, 0);
    if (!main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }
}

async function boot() {
  const app = createApp();
  appRef = app;
  bindRoad(app);
  wireHeader(app);
  shell = createPlayerShell(app, { bar: document.getElementById('player-bar') });
  app.shell = shell; // extra: the Player top bar (setChrome, refresh, openSettings, closeSettings)
  headerHeight = trackHeaderHeight();
  // The Road is Player mode's map (data/road.json); it loads with the rest of the data.
  const [data, road] = await Promise.all([loadAppData(), loadRoad(null)]);
  app.data = data;
  app.data.road = road;
  window.addEventListener('hashchange', route);
  await route();
  if (new URLSearchParams(location.search).has('debug')) window.fotbol = app; // console access while developing
}

if (typeof document !== 'undefined' && document.getElementById('app')) boot();
