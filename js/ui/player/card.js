// '#/card[/<tab>]': Your card (docs/KID_REDESIGN.md §4.7). Tabs: Card · Stickers · Badges · Kit.
//
//   #/card            a player card: nickname, shirt number, kit, level ring, your Road stars per chapter
//                     (Defend / Help / Pass / Shape: chapterStars below), total stars, days played this week
//   #/card/stickers   the sticker album by chapter: bronze, silver or gold; a mystery silhouette links to its node
//   #/card/badges     every badge Player mode can earn: icon, short name, progress bar (Coach-only ones once earned)
//   #/card/kit        the kit locker: shirt colours (locked ones show their level), a big number grid, a nickname
//                     from the pick-list (js/rewards.js NICKNAMES); Save applies it app-wide (js/ui/rewards-store.js)
// One line says the stats never leave the device (R38).
//
// kitEditor() is shared with the kick-off's "Make it yours" (js/ui/player/kickoff.js). chapterStars(), stickerAlbum()
// and badgeList() are pure and tested (tests/player-shell.test.js). Nothing touches the DOM at import time.

import { el, announce, uid } from '../components.js';
import * as Rewards from '../../rewards.js';
import { ROLE_INFO } from '../../engine/roles.js';
import { loadRewards, saveRewards, onRewards, todayLocal, shirtNumber } from '../rewards-store.js';
import { kitToken } from '../celebrate.js';
import { loadProfile, onProfile, loadRoad, roadModel, nodeStars, STRINGS as ROAD_STRINGS, groupOfRole } from './road.js';
import { playerIcon, levelRing, kidFigure, kitPalette } from './shell.js';
import { weekCount } from './home.js';

export const CARD_TABS = Object.freeze(['card', 'stickers', 'badges', 'kit']);

/** 'YYYY-MM-DD' as a short local date ("27 Sep"); '' for anything else. (Moved from modes/trophies.js in the merge.) */
export function shortDay(day, locale) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try { return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }); } catch { return day; }
}

/** Fallback pick-list while js/rewards.js has no NICKNAMES (each at most 10 characters). */
const NICKNAMES_FALLBACK = Object.freeze(['Ace', 'Anchor', 'Blaze', 'Comet', 'Eagle', 'Flash', 'Maestro', 'Rocket', 'The Wall', 'Turbo']);

export const STRINGS = Object.freeze({
  title: 'Your card',
  tabs: Object.freeze({ card: 'Card', stickers: 'Stickers', badges: 'Badges', kit: 'Kit' }),
  privacy: 'Your stats stay on this device.',
  cardSr: 'Your player card',
  levelSr: (n) => `Level ${n}.`,
  numberSr: (n, position) => `Number ${n}. ${position}.`,
  skillSr: (name, n, max) => `${name}: ${n} of ${max} stars.`,
  starsSr: (n) => `${n} stars on your road.`,
  weekSr: (n, max) => `Days played this week: ${n} of ${max}.`,
  albumSr: (n, max) => `${n} of ${max} stickers.`,
  tiers: Object.freeze({ 1: 'Bronze', 2: 'Silver', 3: 'Gold' }),
  stickerSr: (name, tier) => `${name}. ${tier} sticker.`,
  mysterySr: (name) => `${name}. Not yours yet. Play it to get it.`,
  lockedStickerSr: (name) => `${name}. Locked.`,
  badgeDone: 'Got it',
  badgeDoneSr: (name, day) => (day ? `${name}. You got it on ${day}.` : `${name}. You got it.`),
  badgeSr: (name, n, max) => `${name}. ${n} of ${max}.`,
  shirt: 'Shirt',
  number: 'Number',
  nickname: 'Nickname',
  noNickname: 'None',
  lockedAt: (n) => `Level ${n}`,
  lockedSr: (name, n) => `${name}. Opens at level ${n}.`,
  save: 'Save',
  saved: 'Saved',
  savedSr: 'Your kit is saved.',
  you: 'YOU', // the tag over your figure in the kit locker when you have no nickname (as on the pitch)
});

// ---------------------------------------------------------------- pure models

/**
 * Road stars per chapter for the card (its `skill`: Defend, Help, Pass, Shape): the chapter's node stars and their
 * ceiling, nothing else. These replaced the 0-99 FC-style ratings (audit 2026-10-01): a number out of 99 is the
 * score out of 100 the kid-mode rules ban, and a new player read "45" four times. Stars the kid has actually earned
 * say the same thing honestly.
 * @returns {{ id: string, label: string, stars: number, max: number }[]}
 */
export function chapterStars({ road, profile } = {}) {
  return (road?.chapters ?? []).map((c) => {
    const nodes = c.nodes ?? [];
    return { id: c.id, label: c.skill ?? c.title, stars: nodes.reduce((a, n) => a + nodeStars(profile, n.id), 0), max: 3 * nodes.length };
  });
}

/** The card's metal by level (the thresholds the old ranks drew): bronze to 2, silver to 4, gold to 10, then legend. */
export function cardMetal(level) {
  const n = Number(level) || 1;
  return n >= 11 ? 'legend' : n >= 5 ? 'gold' : n >= 3 ? 'silver' : 'bronze';
}

/**
 * The sticker album: one sticker per principle of each Road node (each principle once), by chapter. Its tier is its
 * sticker card's (js/rewards.js cardTier: 1 bronze, 2 silver, 3 gold), which only mastery earns (the idea's recent
 * plays average 2 stars or more: rewards.js stickerReady), never a node's stars alone (a 1-star node is not mastery);
 * 0 = not collected yet (a mystery silhouette that links to its node when the node is open).
 * @returns {{ chapters: { id, title, stickers: { id, name, tier, nodeId, href, unlocked }[] }[], collected, total,
 *   tiers: { 1: number, 2: number, 3: number } }}
 */
export function stickerAlbum({ road, profile, rewards, principles } = {}) {
  const byId = principles?.byId ?? principles ?? {};
  const seen = new Set();
  const tiers = { 1: 0, 2: 0, 3: 0 };
  const chapters = roadModel(road, profile).map((c) => ({
    id: c.id,
    title: c.title,
    stickers: c.nodes.filter((n) => n.kind !== 'mix').flatMap((n) => (n.principles ?? []).filter((id) => !seen.has(id) && seen.add(id)).map((id) => {
      const tier = Math.max(0, Math.min(3, Math.round(Number(Rewards.cardTier?.(rewards, id)) || 0)));
      if (tier) tiers[tier]++;
      const kid = byId[id]?.kidName;
      return { id, name: typeof kid === 'string' && kid ? kid : n.title, tier, nodeId: n.id, href: n.href, unlocked: n.unlocked };
    })),
  })).filter((c) => c.stickers.length);
  const all = chapters.flatMap((c) => c.stickers);
  return { chapters, collected: all.filter((s) => s.tier > 0).length, total: all.length, tiers };
}

const pick = (v) => (v && typeof v === 'object' ? String(v.kid ?? v.standard ?? '') : String(v ?? ''));

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** The badges for the grid: icon, short name, progress (js/rewards.js badgeProgress): all five, every one earnable in
 *  Player mode (the coachOnly badges went with the 2026-10-01 audit's badge cut). */
export function badgeList(rewardsState) {
  let list = [];
  try { list = Rewards.badgeProgress(rewardsState); } catch { list = []; }
  return list.map((b) => ({
    id: b.id, icon: b.icon, name: pick(b.name), description: pick(b.description), earned: !!b.earned,
    current: b.current ?? 0, goal: b.goal ?? 1, progress: clamp01(b.progress), day: rewardsState?.badges?.[b.id]?.day ?? null,
  }));
}

/** The pick-list of nicknames (js/rewards.js NICKNAMES, else a short fallback). */
export function nicknameList() {
  const list = Array.isArray(Rewards.NICKNAMES) ? Rewards.NICKNAMES : NICKNAMES_FALLBACK;
  return list.map((n) => (typeof n === 'string' ? n : n?.name ?? n?.text ?? '')).filter(Boolean);
}

// ---------------------------------------------------------------- the kit editor (shared with the kick-off)

/**
 * Kit colours, a big shirt-number grid and a nickname from the pick-list, with a live preview. Save stores it through
 * js/rewards.js setKit (so only unlocked colours and listed nicknames are kept) and applies it app-wide.
 * @param {object} app
 * @param {{ showLocked?: boolean, saveLabel?: string, onSaved?: (state) => void, actions?: Node[] }} [opts]
 *   showLocked: list locked colours with the level that opens them (the card's Kit tab) or only unlocked ones (the kick-off)
 * @returns {HTMLElement}
 */
export function kitEditor(app, { showLocked = true, saveLabel = STRINGS.save, onSaved, actions = [] } = {}) {
  const state = loadRewards(app);
  const profile = loadProfile(app);
  const roleNum = ROLE_INFO[profile.role ?? app.settings?.role]?.num ?? null;
  const draft = { palette: state.kit.palette, number: state.kit.number ?? null, nickname: state.kit.nickname ?? '' };
  const options = Rewards.kitOptions(state).filter((p) => showLocked || p.unlocked);
  const preview = el('div', { class: 'pm-kit-preview', 'aria-hidden': 'true' });
  const status = el('p', { class: 'pm-kit-saved', role: 'status' });
  // You in the kit you are trying on: your own figure (the look you have on the pitch), your number, your tag.
  const role = profile.role ?? app.settings?.role ?? null;
  const drawPreview = () => {
    preview.replaceChildren(
      el('span', { class: 'pm-kit-tag', text: draft.nickname || STRINGS.you }),
      kidFigure({ role, number: draft.number ?? roleNum, palette: Rewards.paletteById(draft.palette), height: 150, className: 'pm-kit-fig' }),
    );
  };
  const touched = () => { status.textContent = ''; drawPreview(); };

  const radios = (name, legend, items, cls) => {
    const id = uid('pm-kit');
    return el('fieldset', { class: ['pm-kit-set', cls] }, [
      el('legend', { class: 'pm-kit-legend', id, text: legend }),
      el('div', { class: `${cls}-grid` }, items),
    ]);
  };
  const group = uid('pm-kit-group');

  const swatches = radios(`${group}-shirt`, STRINGS.shirt, options.map((p) => el('label', { class: ['pm-swatch', !p.unlocked && 'is-locked'], title: p.unlocked ? p.name : STRINGS.lockedSr(p.name, p.level) }, [
    el('input', {
      type: 'radio', name: `${group}-shirt`, value: p.id, checked: p.id === draft.palette, disabled: !p.unlocked,
      'aria-label': p.unlocked ? p.name : STRINGS.lockedSr(p.name, p.level),
      onchange: (e) => { if (e.target.checked) { draft.palette = p.id; touched(); } },
    }),
    el('span', { class: 'pm-swatch-box', 'aria-hidden': 'true' }, [
      kitToken(p, { size: 44 }),
      p.unlocked ? null : el('span', { class: 'pm-swatch-lock' }, [playerIcon('lock', { size: 14 }), STRINGS.lockedAt(p.level)]),
    ]),
  ])), 'pm-swatches');

  const current = draft.number ?? roleNum;
  const numbers = radios(`${group}-num`, STRINGS.number, Array.from({ length: 99 }, (_, i) => i + 1).map((n) => el('label', { class: 'pm-num' }, [
    el('input', {
      type: 'radio', name: `${group}-num`, value: String(n), checked: n === current,
      onchange: (e) => { if (e.target.checked) { draft.number = n; touched(); } },
    }),
    el('span', { text: String(n) }),
  ])), 'pm-nums');

  const nicks = radios(`${group}-nick`, STRINGS.nickname, ['', ...nicknameList()].map((n) => el('label', { class: 'pm-nick' }, [
    el('input', {
      type: 'radio', name: `${group}-nick`, value: n, checked: n === (draft.nickname || ''),
      onchange: (e) => { if (e.target.checked) { draft.nickname = n; touched(); } },
    }),
    el('span', { text: n || STRINGS.noNickname }),
  ])), 'pm-nicks');

  const save = el('button', {
    type: 'button', class: 'pm-btn pm-btn--hot pm-kit-save',
    onclick: () => {
      const next = Rewards.setKit(loadRewards(app), { palette: draft.palette, number: draft.number, nickname: draft.nickname });
      saveRewards(app, next);
      Object.assign(draft, next.kit);
      status.replaceChildren(playerIcon('check', { size: 18 }), STRINGS.saved);
      announce(STRINGS.savedSr);
      drawPreview();
      onSaved?.(next);
    },
  }, [playerIcon('check'), el('span', { text: saveLabel })]);

  drawPreview();
  return el('div', { class: 'pm-kit' }, [
    preview,
    el('div', { class: 'pm-kit-form' }, [swatches, numbers, nicks]),
    el('div', { class: 'pm-kit-actions' }, [save, ...actions, status]),
  ]);
}

// ---------------------------------------------------------------- the view (browser only)

function starsIcons(n, size = 14) {
  return el('span', { class: 'pm-stars', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => playerIcon('star', { size, className: i < n ? 'is-on' : 'is-off' })));
}

function tabsNav(tab, base = '#/card') {
  const icons = { card: 'card', stickers: 'star', badges: 'trophy', kit: 'shirt' };
  return el('nav', { class: 'pm-tabs', 'aria-label': STRINGS.title }, CARD_TABS.map((t) => el('a', {
    class: 'pm-tab', href: t === 'card' ? base : `${base}/${t}`, 'aria-current': t === tab ? 'page' : null,
  }, [playerIcon(icons[t], { size: 20 }), el('span', { text: STRINGS.tabs[t] })])));
}

function cardView(app, road) {
  const state = loadRewards(app);
  const profile = loadProfile(app);
  const lvl = Rewards.levelFor(state.xp);
  const role = profile.role ?? app.settings?.role;
  const number = shirtNumber(state, ROLE_INFO[role]?.num ?? null);
  const group = profile.group ?? groupOfRole(role);
  const position = ROAD_STRINGS.groups[group] ?? '';
  const skills = chapterStars({ road, profile });
  const stars = (road?.chapters ?? []).flatMap((c) => c.nodes).reduce((a, n) => a + nodeStars(profile, n.id), 0);
  const days = weekCount(state, todayLocal());
  return el('div', { class: 'pm-card-tab' }, [
    el('article', { class: ['pm-fc', `metal-${cardMetal(lvl.level)}`], 'aria-label': STRINGS.cardSr }, [
      el('div', { class: 'pm-fc-top' }, [
        el('p', { class: 'pm-fc-num', role: 'img', 'aria-label': STRINGS.numberSr(number ?? '', position) }, [
          el('b', { 'aria-hidden': 'true', text: number ?? '' }),
          el('span', { 'aria-hidden': 'true', text: position }),
        ]),
        el('p', { class: 'pm-fc-level', role: 'img', 'aria-label': STRINGS.levelSr(lvl.level) }, [
          levelRing(lvl.level, lvl.progress, { size: 52 }),
        ]),
      ]),
      el('div', { class: 'pm-fc-token', 'aria-hidden': 'true' }, [kidFigure({ role, number, palette: kitPalette(state), height: 136, className: 'pm-fc-fig' })]),
      state.kit.nickname ? el('p', { class: 'pm-fc-name', text: state.kit.nickname }) : null,
      el('ul', { class: 'pm-fc-skills' }, skills.map((s) => el('li', { class: 'pm-fc-skill', 'aria-label': STRINGS.skillSr(s.label, s.stars, s.max) }, [
        el('b', { 'aria-hidden': 'true' }, [playerIcon('star', { size: 14, className: 'is-on' }), ` ${s.stars}/${s.max}`]),
        el('span', { 'aria-hidden': 'true', text: s.label }),
      ]))),
      el('div', { class: 'pm-fc-foot' }, [
        el('p', { class: 'pm-fc-stars', role: 'img', 'aria-label': STRINGS.starsSr(stars) }, [playerIcon('star', { size: 20, className: 'is-on' }), el('b', { 'aria-hidden': 'true', text: String(stars) })]),
        el('p', { class: 'pm-fc-week', role: 'img', 'aria-label': STRINGS.weekSr(days, 7) }, [
          el('span', { class: 'pm-dots', 'aria-hidden': 'true' }, Array.from({ length: 7 }, (_, i) => el('span', { class: ['pm-dot', i < days && 'is-on'] }))),
        ]),
      ]),
    ]),
  ]);
}

function stickersView(app, road) {
  const album = stickerAlbum({ road, profile: loadProfile(app), rewards: loadRewards(app), principles: app.data?.principles });
  return el('div', { class: 'pm-album' }, [
    el('p', { class: 'pm-album-count', role: 'img', 'aria-label': STRINGS.albumSr(album.collected, album.total) }, [
      playerIcon('star', { size: 20, className: 'is-on' }), el('b', { 'aria-hidden': 'true', text: String(album.collected) }), el('span', { 'aria-hidden': 'true', text: ` / ${album.total}` }),
    ]),
    ...album.chapters.map((c) => el('section', { class: 'pm-album-chapter', 'aria-labelledby': `pm-al-${c.id}` }, [
      el('h2', { class: 'pm-h2', id: `pm-al-${c.id}`, text: c.title }),
      el('ul', { class: 'pm-stickers' }, c.stickers.map((s) => el('li', {}, [s.tier
        ? el('a', { class: ['pm-sticker', `tier-${s.tier}`], href: s.href, 'aria-label': STRINGS.stickerSr(s.name, STRINGS.tiers[s.tier]) }, [
          starsIcons(s.tier, 12),
          el('span', { class: 'pm-sticker-name', 'aria-hidden': 'true', text: s.name }),
        ])
        : s.unlocked
          ? el('a', { class: 'pm-sticker is-mystery', href: s.href, 'aria-label': STRINGS.mysterySr(s.name) }, [el('span', { class: 'pm-sticker-q', 'aria-hidden': 'true', text: '?' })])
          : el('span', { class: 'pm-sticker is-mystery is-locked', role: 'img', 'aria-label': STRINGS.lockedStickerSr(s.name) }, [playerIcon('lock', { size: 20 })]),
      ]))),
    ])),
  ]);
}

function badgesView(app) {
  return el('ul', { class: 'pm-badges' }, badgeList(loadRewards(app)).map((b) => {
    const when = b.earned ? shortDay(b.day) : '';
    return el('li', {
      class: ['pm-badge', b.earned ? 'is-earned' : 'is-locked'], title: b.description,
      'aria-label': b.earned ? STRINGS.badgeDoneSr(b.name, when) : STRINGS.badgeSr(b.name, b.current, b.goal),
    }, [
      el('span', { class: 'pm-badge-icon', 'aria-hidden': 'true', text: b.icon }),
      el('b', { class: 'pm-badge-name', 'aria-hidden': 'true', text: b.name }),
      el('span', { class: 'pm-badge-bar', 'aria-hidden': 'true' }, [el('span', { style: { width: `${Math.round(b.progress * 100)}%` } })]),
      el('small', { class: 'pm-badge-count', 'aria-hidden': 'true', text: b.earned ? STRINGS.badgeDone : `${b.current}/${b.goal}` }),
    ]);
  }));
}

/** The old trophy-room tab names, mapped onto the card's (the two rooms merged, audit 2026-10-01). */
const TAB_ALIASES = Object.freeze({ overview: 'card', album: 'stickers' });

/** Mode contract (ARCHITECTURE §5.9); serves '#/card' and '#/trophies' alike (modes/trophies.js delegates here). */
export async function mount(root, app, params = []) {
  const base = app?.route?.mode === 'trophies' ? '#/trophies' : '#/card';
  const want = String(params[0] ?? '').toLowerCase();
  const tab = CARD_TABS.includes(TAB_ALIASES[want] ?? want) ? (TAB_ALIASES[want] ?? want) : 'card';
  const road = await loadRoad(app);
  let alive = true;
  const draw = () => {
    if (!alive) return;
    const body = tab === 'stickers' ? stickersView(app, road) : tab === 'badges' ? badgesView(app) : tab === 'kit' ? kitEditor(app, { showLocked: true }) : cardView(app, road);
    root.replaceChildren(el('div', { class: 'pm-page pm-cardpage' }, [
      el('h1', { class: 'visually-hidden', text: STRINGS.title }),
      tabsNav(tab, base),
      el('div', { class: 'pm-tab-body' }, [body]),
      el('p', { class: 'pm-privacy' }, [playerIcon('lock', { size: 16 }), STRINGS.privacy]),
    ]));
  };
  draw();
  // The kit tab keeps its own draft on screen (Save redraws what changed); the others follow the stored state.
  const offRewards = onRewards(() => { if (tab !== 'kit') draw(); });
  const offProfile = onProfile(() => { if (tab !== 'kit') draw(); });
  return () => { alive = false; offRewards(); offProfile(); };
}
