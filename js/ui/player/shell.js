// Player mode's frame (docs/KID_REDESIGN.md §1, §2, §4.2): the minimal top bar (your token in your kit with your shirt
// number and nickname, a level ring with the rank word, the card, and the settings cog with its small sheet: Sound,
// Theme, "Coach or parent? Open Coach mode"), which header each route shows, the Player-styled "coming soon" and
// "couldn't start" cards, and the icons the Player screens share.
//
//   kidFigure({ role, number, palette, crop, height }) → <svg>: the kid's own tabletop figure (js/ui/figures.js) in their
//     kit, with their number and the look YOU have on the pitch (kidLook: figureLook of 'us-' + role); crop 'full' (the
//     card, the kit locker, the kick-off shirts) or 'bust' (head and shoulders: the top bar)
//   chromeFor(route) → 'coach' | 'player' | 'none'      route = main.js resolveRoute() output
//     'coach'  the Coach header (index.html .app-header, with "Back to Player mode")
//     'player' this top bar (home, card)
//     'none'   no header: the kick-off screens and the play screens (play, pass, match day) fill the screen and bring
//              their own way out (R7: during Watch and Decide only the pitch, YOU and one line are visible)
//   topBarModel({ rewards, profile, settings }) → { number, nickname, level, rank, rankId, progress, role, look }     (pure)
//   createPlayerShell(app, { bar }) → { setChrome(chrome), refresh(), openSettings(), closeSettings(), destroy() }
//   playerIcon(name, { size, className }) → <svg>     levelRing(level, progress, { size }) → <svg>
//   soonCard(route), failedCard(route, err)
//
// Nothing runs at import time; STRINGS holds every visible word (tests/copy.test.js).

import { el, svg, segmented, toggleSwitch, announce } from '../components.js';
import { levelFor, normalizeRewards, paletteById } from '../../rewards.js';
import { ROLE_INFO, LEARNABLE_ROLES } from '../../engine/roles.js';
import { loadRewards, onRewards, shirtNumber } from '../rewards-store.js';
import { drawFigure, figureLook, FIGURE } from '../figures.js';
import { loadProfile, onProfile } from './road.js';

export const STRINGS = Object.freeze({
  home: 'Home',
  card: 'Your card',
  settings: 'Settings',
  close: 'Close',
  sound: 'Sound',
  theme: 'Theme',
  themes: Object.freeze({ auto: 'Auto', light: 'Light', dark: 'Dark' }),
  coachAsk: 'Coach or parent?',
  openCoach: 'Open Coach mode',
  coachOn: 'Coach mode is on.',
  level: (n, rank) => `Level ${n}. ${rank}.`,
  me: (name, number) => [name, number ? `Number ${number}` : ''].filter(Boolean).join('. '),
  soonTitle: 'Coming soon',
  soonText: 'This part is not ready yet.',
  failTitle: 'This did not load',
  failText: 'Try again, or go back home.',
  tryAgain: 'Try again',
  titles: Object.freeze({ home: 'fotbol', kickoff: 'Kick-off', play: 'Play', pass: "Who's open?", matchday: 'Match day', card: 'Your card' }),
});

/** Which header a route shows (see the file comment). */
export function chromeFor(route) {
  if (route?.kind !== 'player') return 'coach';
  return ['kickoff', 'play', 'pass', 'matchday'].includes(route.module) ? 'none' : 'player';
}

/** The page title of a Player route. */
export const playerTitle = (module) => (module === 'home' ? STRINGS.titles.home : `${STRINGS.titles[module] ?? STRINGS.titles.home} · fotbol`);

/**
 * What the top bar shows (pure): your figure (your position's look, your shirt number: the kit's, else your
 * position's), nickname, level and rank.
 */
export function topBarModel({ rewards, profile, settings } = {}) {
  const s = normalizeRewards(rewards);
  const l = levelFor(s.xp);
  const role = profile?.role ?? settings?.role ?? null;
  return {
    number: shirtNumber(s, ROLE_INFO[role]?.num ?? null),
    nickname: s.kit.nickname || '',
    level: l.level,
    rank: l.rank.name,
    rankId: l.rank.id,
    progress: Math.max(0, Math.min(1, Number(l.progress) || 0)),
    role: LEARNABLE_ROLES.includes(role) ? role : null,
    look: kidLook(role),
    palette: kitPalette(s),
  };
}

/** The kit a rewards state wears ({ shirt, edge, ink }: js/rewards.js paletteById; the classic kit when none). */
export function kitPalette(rewards) {
  const p = paletteById(normalizeRewards(rewards).kit.palette);
  return p ? { shirt: p.shirt, edge: p.edge, ink: p.ink } : null;
}

// ---------------------------------------------------------------- the kid's own figure (docs/PROGRESSIVE_FIELD.md §5)

/** The position whose look a kid without one takes (a midfielder, the group most kids pick first). */
const LOOK_ROLE = 'LCM';

/**
 * The kid's own look (pure): the skin, hair and hair style YOU have on the pitch in your position (js/ui/figures.js
 * figureLook of 'us-' + role, as the board draws YOU), so the figure in the top bar is the one you play.
 */
export const kidLook = (role) => figureLook(`us-${LEARNABLE_ROLES.includes(role) ? role : LOOK_ROLE}`, 'us');

/** The base disc the kid's figure stands on, in figure units: about its shoulders wide (as board.js baseScale draws a
 *  figure's base: FIGURE.shoulders x figureBase), never a plate. */
export const KID_BASE_R = Math.round(((FIGURE.shoulders ?? 1.2) * 1.1) / 2 * 100) / 100;

/** The window onto a figure (its units: FIGURE's, feet at 0): the whole figure on its base, or head and shoulders. */
export const KID_FIGURE_CROPS = Object.freeze({
  full: Object.freeze({ x: -0.96, y: -2.64, width: 1.92, height: 2.64 + KID_BASE_R + 0.1 }),
  bust: Object.freeze({ x: -0.9, y: -2.6, width: 1.8, height: 1.78 }),
});

/**
 * The kid's own tabletop figure as an <svg> (decorative: the element around it names it): your look (kidLook), your
 * shirt number, and your kit: `palette` ({ shirt, edge, ink }: a kit being tried on in the kit locker), else the kit you
 * wear app-wide (css/figures.css takes --kit-us*, which js/ui/rewards-store.js applyKit sets).
 * @param {{ role?: string|null, number?: number|string|null, palette?: { shirt, edge, ink }|null, crop?: 'full'|'bust',
 *   height?: number, className?: string }} [opts]  height: CSS px
 * @returns {SVGSVGElement}
 */
export function kidFigure({ role = null, number = null, palette = null, crop = 'full', height = 40, className = '' } = {}) {
  const box = KID_FIGURE_CROPS[crop] ?? KID_FIGURE_CROPS.full;
  const node = svg('svg', {
    class: `pm-fig pm-fig--${crop === 'bust' ? 'bust' : 'full'} ${className}`.trim(), viewBox: `${box.x} ${box.y} ${box.width} ${box.height}`,
    width: Math.round((height * box.width) / box.height), height, 'aria-hidden': 'true', focusable: 'false',
  });
  const kit = palette ? { shirt: palette.shirt, edge: palette.edge, ink: palette.ink, shorts: palette.edge } : {};
  const fig = drawFigure(node, { ...kidLook(role), ...kit, number: number ?? null, facing: 1, base: false });
  if (crop !== 'bust') { // its own base, shoulder-wide (css/figures.css .fig-base: the kit's colours), under the feet
    const base = svg('circle', { class: 'fig-base', r: KID_BASE_R });
    fig.insertBefore(base, fig.firstChild);
  }
  return node;
}

// ---------------------------------------------------------------- icons (24 x 24, stroke: currentColor)

export const PLAYER_ICONS = Object.freeze({
  play: '<path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  card: '<rect x="5" y="2.8" width="14" height="18.4" rx="2.4"/><circle cx="12" cy="10" r="2.6"/><path d="M8.5 16.5h7"/>',
  cog: '<path d="M10.3 2.8h3.4l.5 2.5 1.8.8 2.1-1.4 2.4 2.4-1.4 2.1.8 1.8 2.5.5v3.4l-2.5.5-.8 1.8 1.4 2.1-2.4 2.4-2.1-1.4-1.8.8-.5 2.5h-3.4l-.5-2.5-1.8-.8-2.1 1.4-2.4-2.4 1.4-2.1-.8-1.8-2.5-.5v-3.4l2.5-.5.8-1.8-1.4-2.1 2.4-2.4 2.1 1.4 1.8-.8z"/><circle cx="12" cy="12" r="3.1"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9.5h11V10"/>',
  star: '<path d="M12 2.8l2.75 5.9 6.45.7-4.8 4.4 1.33 6.35L12 16.9l-5.73 3.25L7.6 13.8 2.8 9.4l6.45-.7z" fill="currentColor" stroke="none"/>',
  ball: '<circle cx="12" cy="12" r="8.5"/><path d="m12 8.2 3 2.2-1.1 3.6h-3.8L9 10.4z"/><path d="M12 3.5v4.7M20 10.4l-5 0M17 18.7l-3.1-4.7M7 18.7l3.1-4.7M4 10.4h5"/>',
  press: '<circle cx="17" cy="12" r="3.5"/><path d="M3 12h8.5M8.5 8.5 12 12l-3.5 3.5"/>',
  cover: '<circle cx="15.5" cy="7" r="3"/><circle cx="8" cy="16.5" r="3"/><path d="M13.6 9.4 10 14"/>',
  shield: '<path d="M12 3 19 6v5c0 5-3.3 8.2-7 10-3.7-1.8-7-5-7-10V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
  open: '<circle cx="12" cy="5.5" r="2.4"/><path d="M4.5 9.5 12 11l7.5-1.5M12 11v5M8.5 21l3.5-5 3.5 5"/>',
  wide: '<path d="M4 3.5v17M20 3.5v17"/><path d="M8 12h8.5M13.5 9 16.5 12l-3 3"/>',
  gap: '<path d="M3 6.5h18M3 17.5h18" stroke-dasharray="2.5 2.5"/><circle cx="12" cy="12" r="2.8"/>',
  cross: '<path d="M3.5 19C6 10 12 6.5 20 6.5"/><path d="M16.5 3.5 20 6.5l-3.5 3"/>',
  free: '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/>',
  forward: '<path d="M12 20.5V4.5M6 10.5l6-6 6 6"/>',
  switch: '<path d="M4 18c1.5-8.5 14.5-8.5 16 0"/><path d="M16.8 15.5 20 18l2-3.5"/>',
  safe: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v4.5H15"/>',
  line: '<path d="M3 12h18"/><circle cx="5.5" cy="12" r="1.8"/><circle cx="10" cy="12" r="1.8"/><circle cx="14.5" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>',
  slide: '<circle cx="6" cy="8" r="2"/><circle cx="12" cy="8" r="2"/><path d="M3 15.5h15M15 12.5l3 3-3 3"/>',
  middle: '<path d="M4 4v16M20 4v16"/><path d="M7.5 12h9M10 9l-2.5 3 2.5 3M14 9l2.5 3-2.5 3"/>',
  block: '<path d="M5 6h14M5 12h14M5 18h14"/>',
  pass: '<circle cx="5.5" cy="17" r="2.3"/><circle cx="18.5" cy="7" r="2.3"/><path d="M7.5 15.5l9-7" stroke-dasharray="2.4 2.2"/>',
  whistle: '<path d="M3.5 10.5h9a5 5 0 1 1-5 5v-1.5h-4z"/><path d="M12.5 10.5 15 6.5h4.5"/><circle cx="12.5" cy="15.5" r="1.3"/>',
  shirt: '<path d="M8.2 3.2 3.5 6l-1.7 5 3.4 1.3V21h13.6v-8.7l3.4-1.3-1.7-5-4.7-2.8c-.6 1.9-2.1 3-3.8 3s-3.2-1.1-3.8-3z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
});

/** An inline Player icon (decorative). Unknown names draw a ball. */
export function playerIcon(name, { size = 24, className = '' } = {}) {
  const node = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false', class: `pm-icon ${className}`.trim() });
  node.innerHTML = PLAYER_ICONS[name] ?? PLAYER_ICONS.ball;
  return node;
}

/** The level ring: the level number inside a ring filled to the progress toward the next level. */
export function levelRing(level, progress, { size = 44 } = {}) {
  const r = 18, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  return svg('svg', { class: 'pm-ring', viewBox: '0 0 44 44', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' }, [
    svg('circle', { class: 'pm-ring-track', cx: 22, cy: 22, r }),
    svg('circle', { class: 'pm-ring-fill', cx: 22, cy: 22, r, 'stroke-dasharray': `${(c * p).toFixed(2)} ${c.toFixed(2)}`, transform: 'rotate(-90 22 22)' }),
    svg('text', { class: 'pm-ring-n', x: 22, y: 22, 'text-anchor': 'middle', dy: '0.36em', text: String(level) }),
  ]);
}

// ---------------------------------------------------------------- friendly cards

/** A Player route whose module isn't there yet. */
export function soonCard() {
  return el('div', { class: 'pm-soon' }, [
    el('div', { class: 'pm-soon-in' }, [
      playerIcon('whistle', { size: 48, className: 'pm-soon-icon' }),
      el('h1', { class: 'pm-soon-title', text: STRINGS.soonTitle }),
      el('p', { text: STRINGS.soonText }),
      el('a', { class: 'pm-btn pm-btn--hot', href: '#/' }, [playerIcon('home'), el('span', { text: STRINGS.home })]),
    ]),
  ]);
}

/** A Player route whose module failed to start (details go to the console). */
export function failedCard() {
  return el('div', { class: 'pm-soon' }, [
    el('div', { class: 'pm-soon-in' }, [
      playerIcon('whistle', { size: 48, className: 'pm-soon-icon' }),
      el('h1', { class: 'pm-soon-title', text: STRINGS.failTitle }),
      el('p', { text: STRINGS.failText }),
      el('div', { class: 'pm-soon-actions' }, [
        el('button', { type: 'button', class: 'pm-btn pm-btn--hot', onclick: () => location.reload() }, [el('span', { text: STRINGS.tryAgain })]),
        el('a', { class: 'pm-btn', href: '#/' }, [playerIcon('home'), el('span', { text: STRINGS.home })]),
      ]),
    ]),
  ]);
}

// ---------------------------------------------------------------- the top bar (browser only)

/**
 * @param {object} app
 * @param {{ bar: HTMLElement }} opts  the <header id="player-bar"> from index.html
 */
export function createPlayerShell(app, { bar } = {}) {
  if (!bar) return { setChrome() {}, refresh() {}, openSettings() {}, closeSettings() {}, destroy() {} };
  const doc = bar.ownerDocument;
  let chrome = null;
  let sheet = null; // the open settings sheet: { node, button }

  const inner = el('div', { class: 'pm-bar-in' });
  bar.replaceChildren(inner);

  const cog = el('button', {
    type: 'button', class: 'pm-icon-btn pm-cog', 'aria-label': STRINGS.settings, title: STRINGS.settings,
    'aria-expanded': 'false', 'aria-controls': 'pm-sheet',
    onclick: () => (sheet ? closeSettings() : openSettings()),
  }, [playerIcon('cog')]);

  function refresh() {
    if (chrome !== 'player') return;
    const m = topBarModel({ rewards: loadRewards(app), profile: loadProfile(app), settings: app.settings });
    inner.replaceChildren(
      el('a', { class: 'pm-me', href: '#/', 'aria-label': [STRINGS.home, STRINGS.me(m.nickname, m.number)].filter(Boolean).join('. ') }, [
        el('span', { class: 'pm-me-token' }, [kidFigure({ role: m.role, number: m.number, palette: m.palette, crop: 'bust', height: 40 })]),
        m.nickname ? el('span', { class: 'pm-me-name', text: m.nickname }) : null,
      ]),
      el('p', { class: 'pm-level', role: 'img', 'aria-label': STRINGS.level(m.level, m.rank) }, [
        levelRing(m.level, m.progress, { size: 40 }),
        el('span', { class: 'pm-rank', 'aria-hidden': 'true', text: m.rank }),
      ]),
      el('a', { class: 'pm-icon-btn pm-card-link', href: '#/card', 'aria-label': STRINGS.card, title: STRINGS.card }, [playerIcon('card')]),
      cog,
    );
    if (app.route?.mode === 'card') inner.querySelector('.pm-card-link')?.setAttribute('aria-current', 'page');
  }

  function setChrome(next) {
    chrome = next;
    doc.documentElement.dataset.chrome = next;
    if (next !== 'player') closeSettings();
    if (next === 'player') refresh();
  }

  // ---- the settings sheet: Sound, Theme, and the way into Coach mode
  function buildSheet() {
    const node = el('div', { class: 'pm-sheet', id: 'pm-sheet', role: 'dialog', 'aria-label': STRINGS.settings }, [
      el('div', { class: 'pm-sheet-head' }, [
        el('h2', { class: 'pm-sheet-title', text: STRINGS.settings }),
        el('button', { type: 'button', class: 'pm-icon-btn', 'aria-label': STRINGS.close, title: STRINGS.close, onclick: () => closeSettings({ focus: true }) }, [playerIcon('close')]),
      ]),
      toggleSwitch({
        label: STRINGS.sound, checked: app.settings.sound !== false,
        onChange: (sound) => { app.setSettings({ sound }); if (sound) app.sound?.play?.('good'); },
      }),
      segmented({
        legend: STRINGS.theme, value: app.settings.theme,
        options: ['auto', 'light', 'dark'].map((v) => ({ value: v, label: STRINGS.themes[v] })),
        onChange: (theme) => app.setSettings({ theme }),
      }),
      el('div', { class: 'pm-sheet-coach' }, [
        el('p', { class: 'pm-sheet-ask', text: STRINGS.coachAsk }),
        el('button', {
          type: 'button', class: 'pm-btn pm-sheet-coach-btn',
          onclick: () => {
            closeSettings();
            app.setSettings({ mode: 'coach' });
            announce(STRINGS.coachOn);
            app.navigate('#/coach');
          },
        }, [el('span', { text: STRINGS.openCoach })]),
      ]),
    ]);
    return node;
  }

  function openSettings() {
    if (sheet || chrome !== 'player') return;
    const node = buildSheet();
    bar.append(node);
    sheet = { node };
    cog.setAttribute('aria-expanded', 'true');
    (node.querySelector('input') ?? node.querySelector('button'))?.focus();
  }

  function closeSettings({ focus = false } = {}) {
    if (!sheet) return;
    sheet.node.remove();
    sheet = null;
    cog.setAttribute('aria-expanded', 'false');
    if (focus) cog.focus();
  }

  const onKey = (e) => { if (e.key === 'Escape' && sheet) closeSettings({ focus: true }); };
  const onDown = (e) => { if (sheet && !sheet.node.contains(e.target) && !cog.contains(e.target)) closeSettings(); };
  const onHash = () => closeSettings();
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('pointerdown', onDown);
  globalThis.addEventListener?.('hashchange', onHash);
  const offRewards = onRewards(() => refresh());
  const offProfile = onProfile(() => refresh());
  const offSettings = app.onSettings?.((_s, patch) => {
    if (patch && ('role' in patch || 'wording' in patch)) refresh();
  });

  return {
    setChrome,
    refresh,
    openSettings,
    closeSettings,
    get chrome() { return chrome; },
    destroy() {
      closeSettings();
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('pointerdown', onDown);
      globalThis.removeEventListener?.('hashchange', onHash);
      offRewards(); offProfile(); offSettings?.();
      bar.replaceChildren();
    },
  };
}
