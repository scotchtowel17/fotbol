// Player mode: Full time, the end of a set (docs/KID_REDESIGN.md §4.5, §8.1). Shared by "Find your spot"
// (play.js), "Who's open?" (pass.js) and Match day (matchday.js).
//
//   Full time
//   ★★★ ★★☆ ★☆☆ ★★★ ★★☆      one small star row per rep, then the total
//   +40 XP  [=======>    ]     the XP bar sweeps from before to after (a level up fills it, says so, and starts again)
//   (node) ☆☆☆ → ★★☆           the Road node's stars before → after
//   [ New sticker: Back Up Your Buddy ]   each card, badge or kit earned, one at a time, big: "More" steps to the
//                                         next (never a second "Next" next to the main button); 3 at most, then
//                                         "+2 more on your card" (a link to #/card, where they all are)
//   Best move: Back up your buddy         only for a rep with 2 stars or more, naming the move you made best, with a
//                                         capital (the rep's `move`: the praised idea's simple name; else, as "Who's
//                                         open?" sends it, its idea's name)
//   Next time: bigger games               the node's stars rose, so its next set plays bigger games (a Road set's
//                                         stages follow the node's stars: docs/PROGRESSIVE_FIELD.md §2)
//   Good work today. Take a break?        after about 15 minutes of play today (R22)
//   [ Home ]  [ Play again ]              Home is the main button; Play again is neutral and never automatic
//
// Rewards were awarded rep by rep (celebrate: false); this screen shows them, and tells the header's level pill to
// catch up (refreshRewards). A level up or a gold sticker gets the confetti and the fanfare only if the set still has
// its one big celebration (js/ui/celebrate.js createBurstBudget: pass the reveal's budget in).
//
// Play time today is kept under the store key 'player:today' ({ day, ms }), so the break nudge works across sets.
// Nothing touches the DOM at import time (tests/copy.test.js imports STRINGS in Node).

import { el, button, svg, announce } from '../components.js';
import { levelFor, BADGES_BY_ID, paletteById } from '../../rewards.js';
import { cleanGains, refreshRewards, todayLocal } from '../rewards-store.js';
import { confettiBurst, createBurstBudget, reducedMotion, TIER_ICONS } from '../celebrate.js';
import { pickText, principleLabel } from '../reveal.js';
import { STRINGS as SHARED } from './strings.js';

export const FULLTIME_DEFAULTS = Object.freeze({
  breakAfterMin: 15, // [S] R22: after about 15 minutes of play in a day, suggest a break
  repMsGuess: 22000, // [D] a rep's play time when the caller does not say (a "Find your spot" rep is about 20 s)
  maxSetMs: 15 * 60 * 1000, // [D] one set never adds more than this (a tab left open is not play)
  rowStepMs: 90, // [D] the star rows appear this far apart...
  sweepMs: 700, // [D] ...and the XP bar sweeps this long (each leg of a level up)
  levelPauseMs: 500, // [D] a full bar holds this long before the new level shows
  maxItems: 3, // [D] rewards shown one by one at most (biggest first); the rest wait on the card screen (R29: no pile-up)
  bestMoveStars: 2, // [D] "Best move" names a rep with at least this many stars (a 1-star rep is not a best move)
});

/** The store key (under 'fotbol:') for today's play time. */
export const TODAY_KEY = 'player:today';

export const STRINGS = Object.freeze({
  fullTime: SHARED.fullTime,
  home: SHARED.home,
  playAgain: SHARED.playAgain,
  more: 'More',
  moreOnCard: (n) => `+${n} more on your card`,
  stars: SHARED.stars,
  starsTotal: (n) => `${n} ${n === 1 ? 'star' : 'stars'}`,
  xp: (n) => `+${n} XP`,
  level: (n) => `Level ${n}`,
  levelUp: 'Level up',
  newSticker: (name) => `New sticker: ${name}`,
  tierSticker: (tier, name) => `${['', 'Bronze', 'Silver', 'Gold'][tier] ?? 'New'} sticker: ${name}`,
  newBadge: (name) => `New badge: ${name}`,
  newKit: (name) => `New kit colour: ${name}`,
  bestMove: (name) => `Best move: ${name}`,
  takeBreak: 'Good work today. Take a break?',
  biggerNext: 'Next time: bigger games', // the node's stars rose: its next set plays bigger games (PROGRESSIVE_FIELD §2)
  nodeStars: (before, after) => `${after} of 3 stars here${after > before ? ', up from ' + before : ''}`,
  repRow: (i, n) => `Play ${i}: ${n} of 3 stars`,
  skill: 'a new skill',
});

// ---------------------------------------------------------------- pure helpers

const clampStars = (n) => Math.max(0, Math.min(3, Math.round(Number(n)) || 0));

/** "Back Up Your Buddy" → "Back up your buddy" (capitalised words after the first go lower case; codes stay). */
export function sentenceCase(s) {
  const parts = String(s ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.map((w, i) => (i > 0 && /^[A-Z][a-z'’-]*$/.test(w) ? w.toLowerCase() : w)).join(' ');
}

/** Today's play time after adding `ms` (pure): a new day starts from zero. */
export function addToday(saved, { day, ms }) {
  const same = saved && typeof saved === 'object' && saved.day === day && Number.isFinite(saved.ms);
  const add = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return { day, ms: Math.round((same ? saved.ms : 0) + add) };
}

/** Minutes played on `day` (pure). */
export function minutesOn(saved, day) {
  return saved && typeof saved === 'object' && saved.day === day && Number.isFinite(saved.ms) ? saved.ms / 60000 : 0;
}

/** Add play time for today (store key 'player:today'). @returns {{ day: string, ms: number }} */
export function addPlayTime(app, ms, now = new Date()) {
  const day = todayLocal(now);
  const next = addToday(app?.store?.get?.(TODAY_KEY, null), { day, ms: Math.min(FULLTIME_DEFAULTS.maxSetMs, ms) });
  app?.store?.set?.(TODAY_KEY, next);
  return next;
}

/** Minutes played today. */
export const playMinutesToday = (app, now = new Date()) => minutesOn(app?.store?.get?.(TODAY_KEY, null), todayLocal(now));

/** Time for the "Take a break?" nudge? */
export const breakDue = (minutes, P = FULLTIME_DEFAULTS) => Number(minutes) >= P.breakAfterMin;

/**
 * The rewards to show one at a time, biggest first (pure): sticker cards (by tier), badges, then new kit colours.
 * @param {object} gained  merged gains of the set
 * @param {{ principles?: object }} [opts]  principles: byId, for the stickers' names (their kidName)
 * @returns {{ kind: 'card'|'badge'|'kit', icon: string, text: string, tier?: number, id: string }[]}
 */
export function earnedItems(gained, { principles = {} } = {}) {
  const g = cleanGains(gained);
  const byId = principles?.byId ?? principles ?? {};
  const cards = [...g.cards].sort((a, b) => b.tier - a.tier).map((c) => {
    const name = principleLabel(byId[c.id], 'kid') || STRINGS.skill;
    return { kind: 'card', id: c.id, tier: c.tier, icon: TIER_ICONS[c.tier] ?? '⭐', text: c.upgrade ? STRINGS.tierSticker(c.tier, name) : STRINGS.newSticker(name) };
  });
  const badges = g.badges.filter((id) => BADGES_BY_ID[id]).map((id) => ({ kind: 'badge', id, icon: BADGES_BY_ID[id].icon, text: STRINGS.newBadge(pickText(BADGES_BY_ID[id].name, 'kid')) }));
  const kits = (g.levelUp?.unlocks ?? []).map((id) => ({ kind: 'kit', id, icon: '👕', text: STRINGS.newKit(paletteById(id).name) }));
  return [...cards, ...badges, ...kits];
}

/** The first letter in capitals (pure): "Best move: Back up your buddy", never "Best move: back up your buddy". */
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * What a rep's "Best move" says (pure), always a move with a capital: its `move` (the move the reveal praised, as
 * play.js bestMoveOf names it: the idea's simple name, "Back up your buddy", or what you did, "You found your own
 * space."), else the name of its idea in sentence case ("Back up your buddy", as "Who's open?" sends it); `move: null`
 * means nothing to name (no praise on the rep).
 */
export function bestMoveName(rep) {
  if (rep?.move === null) return null;
  if (typeof rep?.move === 'string' && rep.move.trim()) return capital(rep.move.trim());
  return typeof rep?.title === 'string' && rep.title.trim() ? capital(sentenceCase(rep.title)) : null;
}

/**
 * Everything Full time shows, as plain data (pure). `best` is the best rep's move, from a rep with bestMoveStars (2)
 * or more (the first of the best); `items` are the rewards to show, maxItems (3) at most, biggest first, and
 * `moreItems` how many more wait on the card screen.
 * @param {{ reps?: { stars: number, title?: string, move?: string|null }[], xpBefore?: number, xpAfter?: number,
 *   gained?: object, nodeStars?: object|null, principles?: object }} opts
 * @returns {{ rows: number[], total: number, max: number, xpGain: number, before: object, after: object, levelUp: boolean,
 *   items: object[], moreItems: number, allItems: object[], best: string|null, nodeStars: { before: number, after: number }|null,
 *   bigger: boolean }}   bigger: the node's stars rose, so its next set plays bigger games ("Next time: bigger games")
 */
export function fullTimeModel({ reps = [], xpBefore, xpAfter, gained, nodeStars = null, principles = {} } = {}, P = FULLTIME_DEFAULTS) {
  const rows = (Array.isArray(reps) ? reps : []).map((r) => clampStars(r?.stars));
  const g = cleanGains(gained);
  const xb = Number.isFinite(xpBefore) ? xpBefore : 0;
  const xa = Number.isFinite(xpAfter) ? Math.max(xpAfter, xb) : xb + g.xp;
  const before = levelFor(xb), after = levelFor(xa);
  let best = null, bestStars = P.bestMoveStars - 1;
  (Array.isArray(reps) ? reps : []).forEach((r, i) => {
    const name = rows[i] > bestStars ? bestMoveName(r) : null;
    if (name) { bestStars = rows[i]; best = name; }
  });
  const ns = nodeStars && Number.isFinite(nodeStars.before) && Number.isFinite(nodeStars.after)
    ? { before: clampStars(nodeStars.before), after: clampStars(Math.max(nodeStars.after, nodeStars.before)) } : null;
  // A Road set's stages follow the node's stars (PROGRESSIVE_FIELD §2: more stars, bigger games), so stars that rose
  // mean bigger games next time.
  const bigger = !!ns && ns.after > ns.before;
  const allItems = earnedItems(g, { principles });
  const items = allItems.slice(0, Math.max(0, P.maxItems));
  return {
    rows, total: rows.reduce((a, b) => a + b, 0), max: rows.length * 3,
    xpGain: Math.max(0, Math.round(xa - xb)), before, after, levelUp: after.level > before.level || !!g.levelUp,
    items, moreItems: allItems.length - items.length, allItems, best, nodeStars: ns, bigger,
  };
}

// ---------------------------------------------------------------- DOM

const STAR_PATH = 'M12 2.8l2.75 5.9 6.45.7-4.8 4.4 1.33 6.35L12 16.9l-5.73 3.25L7.6 13.8 2.8 9.4l6.45-.7z';
const starSvg = () => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, [svg('path', { d: STAR_PATH })]);

/** A row of 3 small stars, n lit. */
function miniStars(n, { label, delay = 0, newFrom = null } = {}) {
  return el('span', { class: 'ft-stars', role: 'img', 'aria-label': label ?? STRINGS.stars(n), style: { '--d': `${delay}ms` } },
    [0, 1, 2].map((i) => el('span', { class: ['ft-star', i < n && 'is-on', newFrom !== null && i >= newFrom && i < n && 'is-new'] }, [starSvg()])));
}

/** The Road node in small: a circle with a ball, and its title. */
function miniNode(node) {
  return el('span', { class: 'ft-node-dot', 'aria-hidden': 'true' }, [
    svg('svg', { viewBox: '0 0 24 24', focusable: 'false' }, [
      svg('circle', { cx: 12, cy: 12, r: 8.5, class: 'ft-node-ball' }),
      svg('path', { class: 'ft-node-patch', d: 'M12 8.2l3.2 2.3-1.2 3.8h-4l-1.2-3.8z' }),
    ]),
    el('span', { class: 'visually-hidden', text: node?.title ?? '' }),
  ]);
}

/**
 * Show Full time in `root` (its content is replaced).
 * @param {HTMLElement} root
 * @param {object} app
 * @param {{ node?: object|null, reps: { stars: number, title?: string }[], xpBefore?: number, xpAfter?: number, gained?: object,
 *   nodeStars?: { before: number, after: number }|null, onHome?: Function, onAgain?: Function|null,
 *   title?: string, extra?: Node|Node[], homeLabel?: string, budget?: { take(): boolean }, playedMs?: number, now?: Date }} opts
 *   Extras (optional): title (default "Full time"), extra (nodes shown under the stars: Match day's streak and replay),
 *   homeLabel (the main button's words), onAgain: null hides Play again, budget (the set's big-celebration allowance,
 *   from the reveal), playedMs (this set's play time; default: a guess from the number of reps)
 * @returns {() => void} cleanup
 */
export function showFullTime(root, app, opts = {}) {
  const P = FULLTIME_DEFAULTS;
  const { node = null, onHome, onAgain, extra = null, homeLabel, budget = createBurstBudget(), now = new Date() } = opts;
  const principles = app?.data?.principles?.byId ?? {};
  const m = fullTimeModel({ ...opts, principles });
  const reduced = reducedMotion(app);
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

  // Play time today, and the break nudge.
  const played = Number.isFinite(opts.playedMs) ? opts.playedMs : m.rows.length * P.repMsGuess;
  addPlayTime(app, played, now);
  const nudge = breakDue(playMinutesToday(app, now), P);
  try { refreshRewards(app); } catch { /* the header catches up on the next change */ }

  const titleId = `ft-title-${Math.random().toString(36).slice(2, 7)}`;
  const heading = el('h1', { class: 'ft-title', id: titleId, tabindex: '-1', text: opts.title ?? STRINGS.fullTime });

  // Stars: one row per rep, then the total.
  const rows = el('ol', { class: 'ft-rows' }, m.rows.map((n, i) => el('li', {}, [miniStars(n, { label: STRINGS.repRow(i + 1, n), delay: reduced ? 0 : i * P.rowStepMs })])));
  const total = el('p', { class: 'ft-total' }, [el('span', { class: 'ft-total-star', 'aria-hidden': 'true' }, [starSvg()]), el('span', { text: STRINGS.starsTotal(m.total) })]);

  // XP: the gain, the level and the bar.
  const fill = el('span', { class: 'ft-bar-fill' });
  const levelText = el('span', { class: 'ft-level', text: STRINGS.level(m.before.level) });
  const levelUp = el('p', { class: 'ft-levelup', hidden: true }, [el('b', { text: STRINGS.levelUp })]);
  const xp = el('section', { class: 'ft-xp', 'aria-label': [m.xpGain > 0 ? STRINGS.xp(m.xpGain) : '', STRINGS.level(m.after.level)].filter(Boolean).join('. ') }, [
    el('div', { class: 'ft-xp-top', 'aria-hidden': 'true' }, [m.xpGain > 0 ? el('span', { class: 'ft-xp-gain', text: STRINGS.xp(m.xpGain) }) : null, levelText]),
    el('div', { class: 'ft-bar', 'aria-hidden': 'true' }, [fill]),
    levelUp,
  ]);

  // The Road node, before → after.
  const nodeRow = node && m.nodeStars ? el('section', { class: 'ft-node', 'aria-label': `${node.title ?? ''}: ${STRINGS.nodeStars(m.nodeStars.before, m.nodeStars.after)}` }, [
    miniNode(node),
    el('span', { class: 'ft-node-main', 'aria-hidden': 'true' }, [
      el('span', { class: 'ft-node-title', text: node.title ?? '' }),
      el('span', { class: 'ft-node-stars' }, [
        miniStars(m.nodeStars.before, { label: '' }),
        el('span', { class: 'ft-arrow', text: '→' }),
        miniStars(m.nodeStars.after, { label: '', newFrom: m.nodeStars.before }),
      ]),
    ]),
  ]) : null;

  // Earned rewards, one at a time, big: "More" steps to the next (3 at most); the last says how many more wait on
  // the card screen, with a way there.
  const items = m.items;
  const itemBox = items.length ? el('section', { class: 'ft-items', 'aria-live': 'polite' }) : null;
  let itemIndex = 0;
  function showItem() {
    if (!itemBox) return;
    const it = items[itemIndex];
    const more = itemIndex < items.length - 1;
    itemBox.replaceChildren(el('div', { class: ['ft-item', `ft-item--${it.kind}`, it.tier === 3 && 'is-gold'] }, [
      el('span', { class: 'ft-item-icon', 'aria-hidden': 'true', text: it.icon }),
      el('p', { class: 'ft-item-text', tabindex: '-1', text: it.text }),
      more ? button(STRINGS.more, { className: 'ft-item-more', icon: 'arrow', onClick: () => { itemIndex++; showItem(); itemBox.querySelector('.ft-item-text')?.focus({ preventScroll: true }); } }) : null,
      !more && m.moreItems > 0 ? el('a', { class: 'ft-item-card', href: '#/card', text: STRINGS.moreOnCard(m.moreItems) }) : null,
    ]));
  }

  const best = m.best ? el('p', { class: 'ft-best', text: STRINGS.bestMove(m.best) }) : null;
  const bigger = node && m.bigger ? el('p', { class: 'ft-next', text: STRINGS.biggerNext }) : null;
  const rest = nudge ? el('p', { class: 'ft-break', text: STRINGS.takeBreak }) : null;
  const home = button(homeLabel ?? STRINGS.home, { variant: 'primary', icon: 'arrow', className: 'ft-home', onClick: () => onHome?.() });
  const again = onAgain ? button(STRINGS.playAgain, { className: 'ft-again', onClick: () => onAgain() }) : null;

  const view = el('div', { class: ['ft', reduced && 'is-reduced'], role: 'region', 'aria-labelledby': titleId }, [
    el('div', { class: 'ft-card' }, [
      heading,
      el('section', { class: 'ft-tally' }, [rows, total]),
      ...[extra].flat().filter(Boolean),
      xp,
      nodeRow,
      bigger,
      itemBox,
      best,
      rest,
      el('div', { class: 'ft-actions' }, [home, again]),
    ]),
  ]);
  root.replaceChildren(view);
  showItem();

  // The XP sweep (a level up: fill, "Level up", then fill again from the start of the new level).
  const pct = (p) => `${Math.round(Math.max(0, Math.min(1, p)) * 1000) / 10}%`;
  const milestone = m.levelUp || m.allItems.some((it) => it.tier === 3);
  const celebrate = () => {
    if (!milestone) return;
    if (budget?.take?.()) {
      app?.sound?.play?.('levelup');
      confettiBurst(app, { anchor: m.levelUp ? levelUp : itemBox ?? heading });
    } else app?.sound?.play?.('good');
  };
  const showLevel = () => {
    levelText.textContent = STRINGS.level(m.after.level);
    if (m.levelUp) levelUp.hidden = false;
  };
  if (reduced) {
    fill.style.width = pct(m.after.progress);
    showLevel();
    celebrate();
  } else {
    fill.style.transition = 'none';
    fill.style.width = pct(m.before.progress);
    void fill.offsetWidth; // commit the start before the sweep
    fill.style.transition = `width ${P.sweepMs}ms cubic-bezier(0.3, 0.7, 0.3, 1)`;
    const start = m.rows.length * P.rowStepMs + 250;
    if (m.levelUp) {
      later(() => { fill.style.width = '100%'; }, start);
      later(() => {
        showLevel();
        celebrate();
        fill.style.transition = 'none';
        fill.style.width = '0%';
        void fill.offsetWidth;
        fill.style.transition = `width ${P.sweepMs}ms cubic-bezier(0.3, 0.7, 0.3, 1)`;
        fill.style.width = pct(m.after.progress);
      }, start + P.sweepMs + P.levelPauseMs);
    } else {
      later(() => { fill.style.width = pct(m.after.progress); }, start);
      if (milestone) later(celebrate, start + P.sweepMs);
    }
  }

  heading.focus({ preventScroll: true });
  announce([opts.title ?? STRINGS.fullTime, STRINGS.starsTotal(m.total), m.xpGain > 0 ? STRINGS.xp(m.xpGain) : '', m.levelUp ? `${STRINGS.levelUp}. ${STRINGS.level(m.after.level)}` : ''].filter(Boolean).join('. '));

  return () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    view.remove();
  };
}
