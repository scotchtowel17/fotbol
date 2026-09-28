// App boot: settings, data, header, and the hash router. Contract: docs/ARCHITECTURE.md §5.9.
//
// Routes are '#/<mode>[/<arg>...]'. Each mode is js/ui/modes/<mode>.js exporting
//   mount(root, app, params) → void | unmount()
// and is loaded with a dynamic import(), so a mode that doesn't exist yet shows a
// friendly "coming soon" card instead of breaking the app.
//
// Pure helpers (parseHash, normalizeSettings, MODE_INFO, settingsLinks, isDevMode) are exported for
// tests; the app only boots when the page has a #app element.

import * as store from './store.js';
import { loadAppData } from './data.js';
import { createBoard } from './ui/board.js';
import { LEARNABLE_ROLES } from './engine/roles.js';
import { el, icon, notice, button, linkButton, segmented, toggleSwitch, announce } from './ui/components.js';
import { createCelebrations, renderPill } from './ui/celebrate.js';
import { createSound } from './ui/sound.js';
import { loadRewards, applyKit, onRewards, youLabel } from './ui/rewards-store.js';

/** Every route the app knows, with the copy used in nav, titles and "coming soon" cards. */
export const MODE_INFO = Object.freeze({
  home: { title: 'Home', blurb: 'Pick your position and start playing.' },
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

/** Modes in the main navigation, in order. */
export const NAV_MODES = Object.freeze(['learn', 'explore', 'drill', 'live', 'progress']);

export const SETTINGS_DEFAULTS = Object.freeze({
  wording: 'standard', // 'standard' | 'kid'
  theme: 'auto', // 'auto' | 'light' | 'dark'
  reducedMotion: false, // true forces reduced motion; false follows the system setting
  role: 'LCB', // chosen learner role (one of LEARNABLE_ROLES)
  sound: true, // sound effects (js/ui/sound.js): the whistle, star ticks, dings, the cheer and the level-up fanfare
});

const MODE_RE = /^[a-z][a-z0-9-]*$/;

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

/** Validate stored settings, keeping unknown keys other modes may have added. */
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...s,
    wording: s.wording === 'kid' ? 'kid' : 'standard',
    theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : SETTINGS_DEFAULTS.theme,
    reducedMotion: s.reducedMotion === true,
    role: LEARNABLE_ROLES.includes(s.role) ? s.role : SETTINGS_DEFAULTS.role,
    sound: s.sound !== false, // on unless switched off
  };
}

/** URL of a mode module. */
export const modeUrl = (mode) => new URL(`./ui/modes/${mode}.js`, import.meta.url).href;

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
});

// ---------------------------------------------------------------- browser-only below

function applySettings(s) {
  const d = document.documentElement.dataset;
  if (s.theme === 'auto') delete d.theme; else d.theme = s.theme;
  d.wording = s.wording;
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
      const next = normalizeSettings({ ...app.settings, ...patch });
      Object.assign(app.settings, next);
      store.set('settings', app.settings);
      applySettings(app.settings);
      for (const fn of listeners) {
        try { fn(app.settings, patch); } catch (err) { console.error(err); }
      }
      window.dispatchEvent(new CustomEvent('fotbol:settings', { detail: { settings: app.settings, patch } }));
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
    /** Extra: the current route. */
    route: { mode: 'home', params: [] },
  };
  applySettings(app.settings);
  // Extras (§5.13): sound effects, the celebrations, and the chosen kit on every board.
  app.sound = createSound({ enabled: () => app.settings.sound !== false });
  app.celebrate = createCelebrations(app);
  applyKit(loadRewards(app));
  return app;
}

// ---- header: nav state and the settings menu

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

function buildSettingsMenu(app, menu) {
  const persistent = store.isPersistent();
  menu.replaceChildren(...[
    el('h2', { class: 'menu-title', text: 'Settings' }),
    segmented({
      legend: 'Theme', value: app.settings.theme,
      options: [{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      onChange: (theme) => app.setSettings({ theme }),
    }),
    segmented({
      legend: 'Wording', value: app.settings.wording,
      options: [{ value: 'standard', label: 'Standard' }, { value: 'kid', label: 'Kid' }],
      onChange: (wording) => {
        app.setSettings({ wording });
        announce(wording === 'kid' ? 'Simpler words on.' : 'Standard wording on.');
      },
    }),
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

function wireHeader(app) {
  // The skip link targets #app, which the hash router would read as a route: focus main instead.
  document.getElementById('skip-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('app')?.focus();
  });

  const header = document.querySelector('.app-header');
  if (header) {
    wireLevelPill(app, header);
    const setH = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
    setH();
    if (typeof ResizeObserver === 'function') new ResizeObserver(setH).observe(header);
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
let current = { token: 0, unmount: null };

function comingSoon(mode) {
  const info = MODE_INFO[mode];
  return notice({
    title: info ? `${info.title} is coming soon` : 'Page not found',
    text: info ? info.blurb : `There is no "${mode}" page. Try one of the modes above.`,
    actions: [linkButton('Back to home', '#/home', { variant: 'primary', icon: 'arrow' })],
  });
}

function failed(mode, err) {
  return notice({
    tone: 'bad',
    title: `${MODE_INFO[mode]?.title ?? mode} couldn't start`,
    text: `Something went wrong while loading this page (${err?.message ?? err}). Details are in the browser console.`,
    // A dropped connection is the usual cause (a busy local server): a reload usually fixes it.
    actions: [button('Try again', { variant: 'primary', icon: 'arrow', onClick: () => location.reload() }), linkButton('Back to home', '#/home')],
  });
}

/**
 * Import a mode module, retrying once after a dropped connection (busy local servers drop requests
 * when a cold browser loads every module at once); the second try uses a fresh URL in case the
 * browser remembers the failed one. A real error (a syntax error, a missing file) still throws.
 */
async function importMode(mode) {
  try {
    return await import(modeUrl(mode));
  } catch (err) {
    await new Promise((r) => setTimeout(r, 400));
    try { return await import(modeUrl(mode)); } catch { /* try a fresh URL */ }
    try { return await import(`${modeUrl(mode)}?retry=${Date.now()}`); } catch { throw err; }
  }
}

async function moduleExists(mode) {
  try {
    const res = await fetch(modeUrl(mode), { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

async function route() {
  const app = appRef;
  const main = document.getElementById('app');
  const { mode, params } = parseHash(location.hash);
  const token = ++current.token;
  const first = token === 1;

  try { current.unmount?.(); } catch (err) { console.error('[fotbol] unmount failed', err); }
  current.unmount = null;
  app.route = { mode, params };
  updateNav(mode);
  document.title = mode === 'home' ? 'fotbol · learn where to stand' : `${MODE_INFO[mode]?.title ?? mode} · fotbol`;

  // Each mount gets its own view element, so a mount still running after a newer navigation writes into a detached node.
  const view = el('div', { class: `view view--${mode}` });
  main.replaceChildren(view);
  main.dataset.mode = mode;

  let mod;
  try {
    mod = await importMode(mode);
  } catch (err) {
    if (token !== current.token) return;
    const exists = await moduleExists(mode);
    if (token !== current.token) return;
    if (exists) console.error(`[fotbol] mode "${mode}" failed to load`, err);
    view.replaceChildren(exists ? failed(mode, err) : comingSoon(mode));
    return;
  }
  if (token !== current.token) return;
  if (typeof mod.mount !== 'function') {
    view.replaceChildren(comingSoon(mode));
    return;
  }
  try {
    const unmount = await mod.mount(view, app, params);
    if (token !== current.token) {
      if (typeof unmount === 'function') unmount();
      return;
    }
    current.unmount = typeof unmount === 'function' ? unmount : null;
  } catch (err) {
    console.error(`[fotbol] mode "${mode}" failed to mount`, err);
    if (token === current.token) view.replaceChildren(failed(mode, err));
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
  wireHeader(app);
  app.data = await loadAppData();
  window.addEventListener('hashchange', route);
  await route();
  if (new URLSearchParams(location.search).has('debug')) window.fotbol = app; // console access while developing
}

if (typeof document !== 'undefined' && document.getElementById('app')) boot();
