// Celebrations and the reward visuals (ARCHITECTURE §5.13). Visual first: stars, a big "+70 XP", icons,
// a level number and a bar; words are few and short. All the rewards presentation lives here, so the look
// can be restyled in one place:
//
//   app.celebrate = createCelebrations(app);
//   app.celebrate.show(gained, { grade });                  // a floating card (one at a time, queued)
//   app.celebrate.show(gained, { grade, host: slotEl });    // the same row drawn in place (the drill reveal)
//   app.celebrate.show(gained, { host: slotEl, quiet: true }); // redrawn in place, no sounds or burst (a re-render)
//   app.celebrate.show(gained, { card: false });            // sounds, burst and level-up only (the view shows the rest)
//
// One celebration per event: the star row (the stars pop in one at a time, with a tick each), the XP, a short
// "New best!", and one short chip per badge or sticker. An S grade or a level-up adds a confetti burst. A
// level-up then opens the level-up screen: the new level, big, the rank, and one button (with a new kit:
// "Try it on" → #/trophies/kit/<kit>, which tries it on). Only that screen ever blocks play. Reduced motion
// (the device setting or settings.reducedMotion) drops every animation and the confetti; sounds follow
// settings.sound (js/ui/sound.js).
//
// Pure helpers (celebrationModel, soundPlan, levelUpModel, levelModel, pillModel, starSlots, confettiPieces)
// are exported for tests/celebrate.test.js; nothing touches the DOM at import time.
//
// Player mode (docs/KID_REDESIGN.md §4.3, §4.5, R29) has its own, quieter rules, used by js/ui/player/*:
//   - every rep gets a short acknowledgement that is over in under 0.6 s: the stars pop, a tick each
//     (PLAYER_CELEBRATE, playerStarPlan);
//   - confetti and the fanfare only for a real milestone (the first 3 stars of a set, a level up, a gold sticker),
//     and at most once per set: createBurstBudget() is the set's allowance, playerMilestone() names the milestone;
//   - confettiBurst(app, { anchor }) is the burst itself (none under reduced motion).
// Coach mode keeps createCelebrations() exactly as before.

import { el, svg, button, icon, openModal } from './components.js';
import { BADGES_BY_ID, levelFor, normalizeRewards, paletteById } from '../rewards.js';
import { ROLE_INFO } from '../engine/roles.js';
import { cleanGains, mergeGains, shirtNumber, totalStars } from './rewards-store.js';
import { principleLabel, pickText } from './reveal.js';
import { youTag } from './board.js';

export const CELEBRATE_DEFAULTS = Object.freeze({
  showMs: 3500, // [D] a floating celebration stays this long (paused while hovered or focused)
  starDelayMs: 250, // [D] the first star pops after this...
  starStepMs: 220, // [D] ...and each next one this much later (one tick each)
  cheerAtMs: 120, // [D] the crowd swell of an S starts just after the ding
  levelUpDelayMs: 1100, // [D] the level-up screen opens once the stars and the XP have shown
  confettiPieces: 70, // [D]
  confettiMs: 1500, // [D] longest flight of a piece
  maxChips: 4, // [D] badge and sticker chips on one celebration; the rest is a "+N" chip (the trophy room has them all)
});

/** Player mode's per-rep acknowledgement (R29: under 0.6 s): the stars pop one after another, a tick each. */
export const PLAYER_CELEBRATE = Object.freeze({
  starDelayMs: 40, // [D] the first star pops this soon after the reveal...
  starStepMs: 150, // [D] ...each next one this much later...
  popMs: 240, // [D] ...and each pop lasts this long, so 3 stars are done in 40 + 2 x 150 + 240 = 580 ms
  ackMaxMs: 600, // [S] R29: a good rep's acknowledgement is shorter than 0.6 s
  burstsPerSet: 1, // [S] R29: a big celebration at most once a set
});

/** When each star of a Player-mode reveal pops and ticks (ms from the reveal). */
export function playerStarPlan(stars, P = PLAYER_CELEBRATE) {
  const n = Math.max(0, Math.min(3, Math.round(Number(stars)) || 0));
  return Array.from({ length: n }, (_, i) => ({ name: 'star', at: P.starDelayMs + i * P.starStepMs, index: i }));
}

/** How long a Player-mode rep acknowledgement lasts (ms): the last star's pop ends then (0 for no stars). */
export function playerAckMs(stars, P = PLAYER_CELEBRATE) {
  const plan = playerStarPlan(stars, P);
  return plan.length ? plan.at(-1).at + P.popMs : 0;
}

/**
 * A set's allowance of big celebrations (confetti and a fanfare): `take()` says yes at most `n` times.
 * One budget per set, shared by the reveal and Full time.
 */
export function createBurstBudget(n = PLAYER_CELEBRATE.burstsPerSet) {
  let left = Math.max(0, Math.round(Number(n)) || 0);
  return {
    take() { if (left <= 0) return false; left--; return true; },
    get left() { return left; },
  };
}

/**
 * The milestone a Player-mode moment celebrates, if any (pure): 'level-up' | 'gold' (a gold sticker) |
 * 'three-stars' (the set's first 3-star rep) | null. Everything else gets the short acknowledgement only.
 * @param {{ stars?: number, firstThreeOfSet?: boolean, gained?: object }} m
 */
export function playerMilestone({ stars = 0, firstThreeOfSet = false, gained = null } = {}) {
  const g = cleanGains(gained);
  if (g.levelUp) return 'level-up';
  if (g.cards.some((c) => c.tier === 3)) return 'gold';
  if (stars >= 3 && firstThreeOfSet) return 'three-stars';
  return null;
}

export const RANK_ICONS = Object.freeze({ rookie: '🌱', academy: '⚽', 'first-team': '👕', captain: '🧢', legend: '🏆' });
export const rankIcon = (rank) => RANK_ICONS[rank?.id ?? rank] ?? '⭐';
export const TIER_ICONS = Object.freeze({ 1: '🥉', 2: '🥈', 3: '🥇' });
export const CONFETTI_COLORS = Object.freeze(['#2fd07f', '#ffc53d', '#5fe2ff', '#ff70b3', '#ffa91a', '#9d8cff']);

const COPY = {
  standard: {
    xp: (n) => `+${n} XP`,
    xpSr: (n) => `Plus ${n} XP.`,
    starsSr: (n) => `${n} of 3 stars.`,
    repHeadline: [null, null, null, null], // the stars say it
    eventHeadline: null,
    improved: 'You improved!',
    newBest: 'New best!',
    badge: (name) => `Badge unlocked: ${name}`,
    newCard: (label) => `New sticker: ${label}`,
    upCard: (tier) => `Sticker upgraded to ${tier}`,
    tiers: { 1: 'bronze', 2: 'silver', 3: 'gold' },
    more: (n) => `+${n} more`,
    card: 'Rewards',
    dismiss: 'Dismiss',
    levelUp: 'Level up!',
    lv: (n) => `Lv ${n}`,
    newRank: 'New rank!',
    newKit: 'New kit!',
    tryKit: 'Try it on',
    carryOn: 'Keep going',
    levelSr: (n, rank, kit) => `Level ${n}. Rank: ${rank}.${kit ? ` New kit: ${kit}.` : ''}`,
    levelBar: (n, rank, xp, next) => `Level ${n}, ${rank}: ${xp} of ${next} XP`,
    pill: (n, rank) => `Level ${n}, ${rank}. Trophies`,
    stars: (n) => `${n} ${n === 1 ? 'star' : 'stars'}`,
    trophies: 'Trophies',
    sessionXp: 'XP this session',
    sessionStars: (n, max) => `${n} of ${max} stars this session`,
    player: 'Your player card',
  },
  kid: {
    xp: (n) => `+${n} XP`,
    xpSr: (n) => `Plus ${n} XP!`,
    starsSr: (n) => `${n} of 3 stars.`,
    repHeadline: ['Good try!', 'Nice one!', 'Great job!', 'Brilliant!'],
    eventHeadline: 'Great job!',
    improved: 'You improved!',
    newBest: 'New best!',
    badge: (name) => `New badge: ${name}!`,
    newCard: (label) => `New sticker: ${label}!`,
    upCard: (tier) => `Your sticker is ${tier} now!`,
    tiers: { 1: 'bronze', 2: 'silver', 3: 'gold' },
    more: (n) => `+${n} more`,
    card: 'Rewards',
    dismiss: 'Close',
    levelUp: 'Level up!',
    lv: (n) => `Lv ${n}`,
    newRank: 'New rank!',
    newKit: 'New kit!',
    tryKit: 'Try it on',
    carryOn: 'Keep playing',
    levelSr: (n, rank, kit) => `Level ${n}! You are ${rank}.${kit ? ` New kit: ${kit}.` : ''}`,
    levelBar: (n, rank, xp, next) => `Level ${n}, ${rank}: ${xp} of ${next} XP`,
    pill: (n, rank) => `Level ${n}, ${rank}. Trophies`,
    stars: (n) => `${n} ${n === 1 ? 'star' : 'stars'}`,
    trophies: 'Trophies',
    sessionXp: 'XP this time',
    sessionStars: (n, max) => `${n} of ${max} stars this time`,
    player: 'Your player card',
  },
};

const W = (wording) => (wording === 'kid' ? 'kid' : 'standard');
/** The short labels of the reward visuals, in a wording (for views that show a level, stars or XP). */
export const rewardCopy = (wording) => COPY[W(wording)];

// ---------------------------------------------------------------- pure models

/** [true, true, false] for 2 of 3 stars. */
export function starSlots(n, max = 3) {
  const k = Math.max(0, Math.min(max, Math.round(Number(n)) || 0));
  return Array.from({ length: max }, (_, i) => i < k);
}

/**
 * What one celebration shows and says (pure).
 * @param {object} gained  applyEvent() gains (js/rewards.js), or merged ones (rewards-store.js mergeGains)
 * @param {{ wording?: string, grade?: string|null, principles?: object }} [opts]  principles: byId, for sticker names
 * @returns {{ xp: number, xpText: string, stars: number|null, headline: string|null, tag: string|null,
 *   chips: { kind: 'badge'|'card'|'more', icon: string, text: string, id?: string, tier?: number }[],
 *   levelUp: object|null, burst: boolean, grade: string|null, empty: boolean, sr: string, wording: string }}
 */
export function celebrationModel(gained, { wording = 'standard', grade = null, principles = {} } = {}) {
  const w = W(wording);
  const C = COPY[w];
  const g = cleanGains(gained);
  const stars = g.stars;
  const headline = stars !== null ? C.repHeadline[stars] : g.xp > 0 ? C.eventHeadline : null;
  const tag = g.improved ? C.improved : g.newBest && !g.firstTry ? C.newBest : null;
  const all = rewardChips(g, { wording: w, principles });
  const max = CELEBRATE_DEFAULTS.maxChips;
  const chips = all.length > max ? [...all.slice(0, max - 1), { kind: 'more', icon: '✨', text: C.more(all.length - max + 1) }] : all;
  const sr = [
    stars !== null ? C.starsSr(stars) : '',
    g.xp > 0 ? C.xpSr(g.xp) : '',
    headline ?? '', tag ?? '',
    ...all.map((c) => (c.kind === 'card' && c.text.indexOf(c.label) < 0 ? `${c.label}: ${c.text}.` : `${c.text}.`)),
  ].filter(Boolean).join(' ').replace(/([!.])\./g, '$1');
  return {
    xp: g.xp, xpText: C.xp(g.xp), stars, headline, tag, chips,
    levelUp: g.levelUp, burst: grade === 'S' || !!g.levelUp, grade: grade ?? null,
    empty: !(g.xp > 0 || stars !== null || all.length || g.levelUp),
    sr, wording: w,
  };
}

/**
 * One short chip per badge and sticker in some gains (≤ 6 words plus the icon): "Badge unlocked: Hat-trick",
 * "New sticker: Cover at an angle", "Sticker upgraded to silver" (the chip also shows the principle ID).
 */
export function rewardChips(gained, { wording = 'standard', principles = {} } = {}) {
  const w = W(wording);
  const C = COPY[w];
  const g = cleanGains(gained);
  const byId = principles?.byId ?? principles ?? {};
  return [
    ...g.badges.map((id) => ({ kind: 'badge', id, icon: BADGES_BY_ID[id].icon, text: C.badge(pickText(BADGES_BY_ID[id].name, w)) })),
    ...g.cards.map((c) => {
      const label = principleLabel(byId[c.id], w) || c.id;
      return { kind: 'card', id: c.id, tier: c.tier, icon: TIER_ICONS[c.tier], label, text: c.upgrade ? C.upCard(C.tiers[c.tier]) : C.newCard(label) };
    }),
  ];
}

/** When each sound of a celebration plays (ms from its start): a ding for A or S, a cheer for S, a tick per star. */
export function soundPlan(model, P = CELEBRATE_DEFAULTS) {
  const out = [];
  if (model?.grade === 'S' || model?.grade === 'A') out.push({ name: 'good', at: 0 });
  if (model?.grade === 'S') out.push({ name: 'cheer', at: P.cheerAtMs });
  for (let i = 0; i < (model?.stars ?? 0); i++) out.push({ name: 'star', at: P.starDelayMs + i * P.starStepMs, index: i });
  return out;
}

/** The level and rank of a rewards state, for bars, pills and cards. */
export function levelModel(state) {
  const l = levelFor(normalizeRewards(state).xp);
  return { level: l.level, rank: l.rank, icon: rankIcon(l.rank), xp: l.xp, levelXp: l.levelXp, nextXp: l.nextXp, progress: Math.max(0, Math.min(1, l.progress)) };
}

/** The header pill: "Lv 3" with the rank's icon. */
export function pillModel(state, wording = 'standard') {
  const C = COPY[W(wording)];
  const m = levelModel(state);
  return { text: C.lv(m.level), icon: m.icon, aria: C.pill(m.level, m.rank.name), level: m.level };
}

/**
 * The level-up screen (pure): the new level, the rank, and one button ("Try it on" when a kit was unlocked).
 * @param {{ from, to, rank, rankUp, unlocks }} levelUp
 */
export function levelUpModel(levelUp, { wording = 'standard' } = {}) {
  const C = COPY[W(wording)];
  const to = Number(levelUp?.to) || 1;
  const rank = levelUp?.rank ?? levelFor(0).rank;
  const kitId = (levelUp?.unlocks ?? []).at(-1) ?? null; // the newest kit, when two levels came at once
  const kit = kitId ? paletteById(kitId) : null;
  return {
    level: to, title: C.levelUp, rank: rank.name, icon: rankIcon(rank), rankUp: !!levelUp?.rankUp,
    ribbon: levelUp?.rankUp ? C.newRank : null, kit, kitText: kit ? C.newKit : null,
    button: kit ? C.tryKit : C.carryOn, action: kit ? 'kit' : 'close',
    sr: C.levelSr(to, rank.name, kit?.name ?? null),
  };
}

/**
 * Confetti pieces for one burst (pure: pass the random source). Each flies up and out from the origin, then
 * falls: dx, dy (px, dy < 0 is up), fall (px), spin (deg), size (px), a colour and a delay (ms).
 */
export function confettiPieces(n, rng = Math.random, colors = CONFETTI_COLORS) {
  const R = (a, b) => a + (b - a) * rng();
  return Array.from({ length: Math.max(0, Math.round(n) || 0) }, (_, i) => {
    const angle = (-90 + R(-70, 70)) * (Math.PI / 180);
    const speed = R(140, 330);
    return {
      dx: Math.round(Math.cos(angle) * speed), dy: Math.round(Math.sin(angle) * speed), fall: Math.round(R(160, 320)),
      spin: Math.round(R(360, 900) * (i % 2 ? 1 : -1)), size: Math.round(R(6, 11)), round: i % 3 === 0,
      color: colors[i % colors.length], delay: Math.round(R(0, 120)), duration: Math.round(R(900, CELEBRATE_DEFAULTS.confettiMs)),
    };
  });
}

// ---------------------------------------------------------------- DOM builders (the reward visuals)

const STAR_PATH = 'M12 2.8l2.75 5.9 6.45.7-4.8 4.4 1.33 6.35L12 16.9l-5.73 3.25L7.6 13.8 2.8 9.4l6.45-.7z';

/** A row of 3 stars, `n` lit; with `animate` the lit ones pop in, one at a time, over their empty outline. */
export function starRow(n, { animate = false, size = 28, label, P = CELEBRATE_DEFAULTS } = {}) {
  const slots = starSlots(n);
  const k = slots.filter(Boolean).length;
  const star = (cls, style) => svg('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false', class: cls, style }, [svg('path', { d: STAR_PATH })]);
  return el('span', { class: ['rw-stars', animate && 'is-animated'], role: 'img', 'aria-label': label ?? `${k} of 3 stars` },
    slots.map((on, i) => el('span', { class: 'rw-star-slot' }, [
      star('rw-star'),
      on ? star('rw-star is-on', { '--d': `${P.starDelayMs + i * P.starStepMs}ms` }) : null,
    ])));
}

function chipList(chips) {
  return el('ul', { class: 'rw-chips' }, chips.map((c, i) => el('li', { class: ['rw-chip', `rw-chip--${c.kind}`], style: { '--i': String(i) }, title: c.id ?? null }, [
    el('span', { class: 'rw-chip-icon', 'aria-hidden': 'true', text: c.icon }),
    c.kind === 'card' ? el('b', { class: 'rw-chip-id', text: c.id }) : null,
    el('span', { class: 'rw-chip-text', text: c.text }),
  ])));
}

/** One celebration drawn: the star row and "+70 XP", then a short headline, a tag and the chips. */
export function rewardRow(model, { animate = true, P = CELEBRATE_DEFAULTS } = {}) {
  const lit = model.stars ?? 0;
  const after = P.starDelayMs + lit * P.starStepMs; // the XP pops once the stars are in
  return el('div', { class: ['rw-row', animate && 'is-animated', model.wording === 'kid' && 'is-kid'], dataset: { grade: model.grade ?? '' } }, [
    el('div', { class: 'rw-row-main' }, [
      model.stars !== null ? starRow(model.stars, { animate, P }) : el('span', { class: 'rw-row-icon', 'aria-hidden': 'true', text: '✨' }),
      model.xp > 0 ? el('span', { class: 'rw-xp', style: { '--d': `${after}ms` }, text: model.xpText }) : null,
    ]),
    model.headline || model.tag ? el('p', { class: 'rw-row-words', style: { '--d': `${after + 120}ms` } }, [
      model.headline ? el('span', { class: 'rw-headline', text: model.headline }) : null,
      model.tag ? el('span', { class: 'rw-tag', text: model.tag }) : null,
    ]) : null,
    model.chips.length ? el('div', { class: 'rw-row-chips', style: { '--d': `${after + 240}ms` } }, [chipList(model.chips)]) : null,
  ]);
}

/**
 * A player token in a kit: the shirt colour, the number in the kit's ink and, optionally, the name tag the board
 * shows over the learner. No palette = the kit applied app-wide (the --kit-us custom properties).
 */
export function kitToken(palette, { number = null, label = null, size = 56, title = null } = {}) {
  const tag = label ? youTag(label) : null;
  const k = 4.2; // the board's tag is 2.1 m tall on a 1.8 m token; here the token has a radius of 9
  const tagW = tag ? tag.width * k : 0;
  const half = Math.max(11.5, tagW / 2 + 1);
  const top = tag ? -21 : -11.5;
  const vbW = half * 2, vbH = 11.5 - top;
  const num = number === null || number === undefined ? '' : String(number);
  return svg('svg', {
    class: 'rw-token', viewBox: `${-half} ${top} ${vbW} ${vbH}`, width: Math.round((size * vbW) / 23), height: Math.round((size * vbH) / 23),
    role: title ? 'img' : null, 'aria-label': title, 'aria-hidden': title ? null : 'true', focusable: 'false',
    style: palette ? { '--tk-shirt': palette.shirt, '--tk-edge': palette.edge, '--tk-ink': palette.ink } : null,
  }, [
    svg('circle', { class: 'rw-token-body', r: 9.5 }),
    num ? svg('text', { class: 'rw-token-num', 'text-anchor': 'middle', dy: '0.36em', 'font-size': num.length > 1 ? 8 : 9.5, text: num }) : null,
    tag ? svg('g', { class: 'rw-token-tag', transform: 'translate(0 -15.5)' }, [
      svg('rect', { x: -tagW / 2, y: -4.4, width: tagW, height: 8.8, rx: 4.4 }),
      svg('text', { 'text-anchor': 'middle', dy: '0.36em', text: tag.text }),
    ]) : null,
  ]);
}

/** The level bar: "Lv 3", the bar to the next level, and the XP. */
export function levelBar(state, { wording = 'standard', compact = false } = {}) {
  const C = COPY[W(wording)];
  const m = levelModel(state);
  return el('div', { class: ['rw-level', compact && 'rw-level--compact'], role: 'img', 'aria-label': C.levelBar(m.level, m.rank.name, m.xp, m.nextXp) }, [
    el('span', { class: 'rw-level-n', 'aria-hidden': 'true' }, [el('small', { text: 'Lv' }), String(m.level)]),
    el('span', { class: 'rw-level-bar', 'aria-hidden': 'true' }, [el('span', { style: { width: `${Math.round(m.progress * 100)}%` } })]),
    compact ? null : el('span', { class: 'rw-level-xp', 'aria-hidden': 'true', text: `${m.xp} / ${m.nextXp} XP` }),
  ]);
}

/** The header's level pill, updated in place. */
export function renderPill(node, state, wording) {
  const m = pillModel(state, wording);
  const was = Number(node.dataset.level) || 0;
  node.setAttribute('aria-label', m.aria);
  node.replaceChildren(el('span', { class: 'rw-pill-in', 'aria-hidden': 'true' }, [
    el('span', { class: 'rw-pill-icon', text: m.icon }), el('span', { class: 'rw-pill-text', text: m.text }),
  ]));
  node.dataset.level = String(m.level);
  if (was && m.level > was) {
    node.classList.remove('is-bumped');
    void node.offsetWidth; // restart the bump
    node.classList.add('is-bumped');
  }
}

/**
 * The player card (home, trophy room): your token in your kit with your number, your nickname, the rank, the
 * level bar, your stars and a way to the trophy room.
 */
export function playerCard(app, state, { trophies = true } = {}) {
  const w = W(app?.settings?.wording);
  const C = COPY[w];
  const s = normalizeRewards(state);
  const m = levelModel(s);
  const name = s.kit.nickname;
  const stars = totalStars(s);
  return el('section', { class: 'rw-card', 'aria-label': C.player }, [
    el('div', { class: 'rw-card-token' }, [kitToken(null, { number: shirtNumber(s, ROLE_INFO[app?.settings?.role]?.num), size: 64 })]),
    el('div', { class: 'rw-card-main' }, [
      name ? el('p', { class: 'rw-card-name', text: name }) : null,
      el('p', { class: 'rw-card-rank' }, [el('span', { 'aria-hidden': 'true', text: m.icon }), ` ${m.rank.name}`]),
      levelBar(s, { wording: w }),
    ]),
    el('div', { class: 'rw-card-side' }, [
      el('p', { class: 'rw-card-stars' }, [starIcon(22), el('span', { 'aria-hidden': 'true', text: String(stars) }), el('span', { class: 'visually-hidden', text: C.stars(stars) })]),
      trophies ? el('a', { class: 'btn btn--primary rw-card-btn', href: '#/trophies' }, [icon('trophy'), el('span', { text: C.trophies })]) : null,
    ]),
  ]);
}

/** A single filled star icon (decorative). */
export function starIcon(size = 18) {
  return svg('svg', { class: 'rw-star is-on', viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' }, [svg('path', { d: STAR_PATH })]);
}

/**
 * The drill summary's rewards: the XP this session (big), the stars won, the level bar and one chip per
 * badge or sticker earned.
 */
export function sessionCard({ gained, stars = 0, maxStars = 0, state }, { wording = 'standard', principles = {} } = {}) {
  const w = W(wording);
  const C = COPY[w];
  const g = cleanGains(gained);
  const chips = rewardChips(g, { wording: w, principles }); // all of them: the session is the place to see what you won
  return el('section', { class: 'rw-session card', 'aria-label': C.sessionXp }, [
    el('div', { class: 'rw-session-top' }, [
      el('p', { class: 'rw-session-xp' }, [
        el('span', { class: 'rw-session-xp-n', text: `+${g.xp}` }), el('span', { class: 'rw-session-xp-unit', text: 'XP' }),
        el('span', { class: 'visually-hidden', text: ` ${C.sessionXp}` }),
      ]),
      el('p', { class: 'rw-session-stars' }, [
        starIcon(26), el('span', { 'aria-hidden': 'true', text: String(stars) }), el('small', { 'aria-hidden': 'true', text: `/${maxStars}` }),
        el('span', { class: 'visually-hidden', text: C.sessionStars(stars, maxStars) }),
      ]),
    ]),
    levelBar(state, { wording: w }),
    chips.length ? chipList(chips) : null,
    el('a', { class: 'rw-session-link', href: '#/trophies' }, [icon('trophy', { size: 18 }), el('span', { text: C.trophies })]),
  ]);
}

function levelUpView(m) {
  return el('div', { class: 'cb-lu' }, [
    el('div', { class: 'cb-lu-num', 'aria-hidden': 'true' }, [el('small', { text: 'Lv' }), el('b', { text: String(m.level) })]),
    el('p', { class: 'cb-lu-rank', 'aria-hidden': 'true' }, [el('span', { class: 'cb-lu-rank-icon', text: m.icon }), el('span', { text: m.rank })]),
    m.ribbon ? el('p', { class: 'cb-lu-ribbon', 'aria-hidden': 'true', text: m.ribbon }) : null,
    m.kit ? el('p', { class: 'cb-lu-kit', 'aria-hidden': 'true' }, [kitToken(m.kit, { size: 40 }), el('span', { text: m.kitText })]) : null,
    el('p', { class: 'visually-hidden', text: m.sr }),
  ]);
}

// ---------------------------------------------------------------- the app-wide instance

export function reducedMotion(app) {
  if (app?.settings?.reducedMotion) return true;
  if (globalThis.document?.documentElement?.dataset?.reducedMotion === 'true') return true;
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * A short confetti burst of DOM pieces (Web Animations) from `anchor` (an element; default: high in the middle of
 * the screen), drawn into `host` (default: the body). None under reduced motion. The layer removes itself.
 * @returns {{ layer: HTMLElement, stop(): void }|null}
 */
export function confettiBurst(app, { anchor = null, host = globalThis.document?.body, pieces = CELEBRATE_DEFAULTS.confettiPieces } = {}) {
  if (reducedMotion(app) || !host || typeof host.animate !== 'function') return null;
  const P = CELEBRATE_DEFAULTS;
  const layer = el('div', { class: 'cb-confetti', 'aria-hidden': 'true' });
  host.append(layer);
  const r = anchor?.getBoundingClientRect?.();
  const vw = globalThis.innerWidth || 800, vh = globalThis.innerHeight || 600;
  const ox = r?.width ? r.left + Math.min(r.width / 2, 120) : vw / 2;
  const oy = r?.height ? r.top + Math.min(r.height / 2, 40) : vh * 0.3;
  for (const p of confettiPieces(pieces)) {
    const piece = el('i', { class: p.round ? 'is-round' : null, style: { left: `${ox}px`, top: `${oy}px`, width: `${p.size}px`, height: `${p.round ? p.size : Math.round(p.size * 1.6)}px`, background: p.color } });
    layer.append(piece);
    piece.animate([
      { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${Math.round(p.dx * 0.7)}px, ${p.dy}px) rotate(${Math.round(p.spin * 0.5)}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${p.dx}px, ${p.dy + p.fall}px) rotate(${p.spin}deg)`, opacity: 0 },
    ], { duration: p.duration, delay: p.delay, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'both' });
  }
  const timer = setTimeout(() => layer.remove(), P.confettiMs + 300);
  return { layer, stop() { clearTimeout(timer); layer.remove(); } };
}

/**
 * @param {object} app  settings (wording, reducedMotion), data.principles, sound (js/ui/sound.js), navigate()
 * @returns {{ show(gained: object, opts?: { grade?: string|null, host?: Element|null, card?: boolean, quiet?: boolean }): void, destroy(): void }}
 */
export function createCelebrations(app) {
  const P = CELEBRATE_DEFAULTS;
  const doc = globalThis.document;
  if (!doc?.body) return { show() {}, destroy() {} };
  const wording = () => W(app?.settings?.wording);
  const principles = () => app?.data?.principles?.byId ?? {};

  const live = el('div', { class: 'visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const stack = el('div', { class: 'cb-stack' });
  const root = el('div', { class: 'cb' }, [stack, live]);
  doc.body.append(root);

  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const queue = []; // floating celebrations waiting their turn
  const levelUps = []; // level-up screens waiting
  let card = null; // the floating card on screen: { node, timer, remaining, since, hover, focus }
  let modal = null;

  function say(text) {
    if (!text) return;
    live.textContent = '';
    later(() => { live.textContent = text; }, 40);
  }

  /** Sounds, the burst and the level-up screen of one celebration. */
  function effects(model, { anchor = null, announce = true } = {}) {
    if (announce) say(model.sr);
    for (const s of soundPlan(model, P)) later(() => app?.sound?.play?.(s.name, s), s.at);
    if (model.burst && !model.levelUp) later(() => confetti(anchor), 80);
    if (model.levelUp) {
      levelUps.push(model.levelUp);
      later(openLevelUp, P.levelUpDelayMs);
    }
  }

  function show(gained, { grade = null, host = null, card: floating = true, quiet = false } = {}) {
    let model;
    try {
      model = celebrationModel(gained, { wording: wording(), grade, principles: principles() });
      if (model.empty) return;
      if (host) {
        host.replaceChildren(rewardRow(model, { animate: !quiet && !reducedMotion(app), P }));
        // quiet: the same row redrawn (new wording), no sounds or burst again. Inside a live region (the reveal)
        // the row is read out with it, so there is no second announcement.
        if (!quiet) effects(model, { anchor: host, announce: !host.closest?.('[aria-live]:not([aria-live="off"])') });
      } else if (floating) {
        queue.push(model);
        pump();
      } else effects(model, { anchor: null, announce: true });
    } catch (err) {
      console.error('[fotbol] celebrate: could not show', err);
    }
  }

  // ---- the floating card: one at a time, auto-dismissed, paused while hovered or focused
  function pump() {
    if (card || modal || !queue.length) return;
    const model = queue.shift();
    const node = el('div', { class: ['cb-card', model.wording === 'kid' && 'is-kid'], role: 'group', 'aria-label': COPY[model.wording].card }, [
      rewardRow(model, { animate: !reducedMotion(app), P }),
      button(COPY[model.wording].dismiss, { iconOnly: true, icon: 'close', variant: 'ghost', className: 'cb-close', onClick: () => dismiss(c) }),
    ]);
    const c = { node, timer: 0, remaining: P.showMs, since: 0, hover: false, focus: false };
    node.addEventListener('mouseenter', () => { c.hover = true; hold(c); });
    node.addEventListener('mouseleave', () => { c.hover = false; run(c); });
    node.addEventListener('focusin', () => { c.focus = true; hold(c); });
    node.addEventListener('focusout', (e) => { if (!node.contains(e.relatedTarget)) { c.focus = false; run(c); } });
    card = c;
    stack.append(node);
    run(c);
    effects(model, { anchor: node, announce: true });
  }
  function run(c) {
    if (card !== c || c.timer || c.hover || c.focus || modal) return;
    c.since = Date.now();
    c.timer = setTimeout(() => dismiss(c), Math.max(600, c.remaining));
  }
  function hold(c) {
    if (!c?.timer) return;
    clearTimeout(c.timer);
    c.timer = 0;
    c.remaining -= Date.now() - c.since;
  }
  function dismiss(c) {
    if (!c || card !== c) return;
    clearTimeout(c.timer);
    const hadFocus = c.node.contains(doc.activeElement);
    card = null;
    c.node.classList.add('is-leaving');
    later(() => c.node.remove(), 220);
    if (hadFocus) doc.getElementById('app')?.focus({ preventScroll: true });
    later(pump, 260);
  }

  // ---- the level-up screen (the one thing that blocks play)
  function openLevelUp() {
    if (modal || !levelUps.length) return;
    const u = levelUps.splice(0).reduce((a, b) => mergeGains({ levelUp: a }, { levelUp: b }).levelUp);
    const m = levelUpModel(u, { wording: wording() });
    const prev = doc.activeElement;
    if (card) hold(card);
    let go = null;
    modal = openModal({
      title: m.title,
      className: m.rankUp ? 'cb-levelup is-rank-up' : 'cb-levelup',
      content: levelUpView(m),
      actions: (close) => [go = button(m.button, {
        variant: 'primary', icon: 'arrow', className: 'cb-lu-go',
        onClick: () => { close(m.action); if (m.action === 'kit') app?.navigate?.(`#/trophies/kit/${m.kit.id}`); },
      })],
      onClose: (value) => {
        modal = null;
        if (value !== 'kit' && value !== 'route' && prev?.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
        if (card) run(card);
        if (levelUps.length) later(openLevelUp, 300);
        else later(pump, 200);
      },
    });
    go?.focus({ preventScroll: true });
    app?.sound?.play?.('levelup');
    later(() => confetti(null, modal?.el), 60);
  }

  // ---- confetti: a short burst of DOM pieces (Web Animations); none under reduced motion
  function confetti(anchor, host = doc.body) {
    confettiBurst(app, { anchor, host, pieces: P.confettiPieces });
  }

  return {
    show,
    destroy() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (card) clearTimeout(card.timer);
      modal?.close('route');
      root.remove();
    },
  };
}
