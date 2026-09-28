// Rewards in the app (ARCHITECTURE §5.13): the pure rewards state (js/rewards.js) kept under the store key
// 'rewards', events awarded with the learner's local day, what they earn handed to the celebrations
// (app.celebrate, js/ui/celebrate.js), and the chosen kit applied app-wide as CSS custom properties.
//
//   award(app, { type: 'rep', scenarioId, role, grade, score })       → gained (saved, then celebrated)
//   award(app, event, { celebrate: false })                           → gained, shown later by the caller
//   loadRewards(app), saveRewards(app, state), refreshRewards(app)    (refresh after an import or a reset)
//   onRewards(fn) → unsubscribe                                       (the header pill, the home card)
//
// Everything that touches the store or the document goes through `app` or a guarded global, so the pure
// helpers (todayLocal, mergeGains, cleanGains, kitVars, youLabel, totalStars) run under node --test.

import { normalizeRewards, applyEvent, paletteById, baseScenarioId, rankFor, BADGES_BY_ID, KIT_PALETTES } from '../rewards.js';

export const REWARDS_KEY = 'rewards';
/** Window event fired whenever the stored rewards change (detail: { state }). */
export const REWARDS_EVENT = 'fotbol:rewards';
/** CSS custom properties the kit sets on the document; css/app.css holds the defaults (= the 'classic' palette). */
export const KIT_VARS = Object.freeze({ shirt: '--kit-us', edge: '--kit-us-edge', ink: '--kit-us-ink' });

/** 'YYYY-MM-DD' of `now` in local time (the day the learner trained on, not UTC). */
export function todayLocal(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The stored rewards, sanitised (a blocked or damaged store reads as a fresh start). */
export const loadRewards = (app) => normalizeRewards(app?.store?.get?.(REWARDS_KEY, null));

/**
 * Store the rewards, apply the kit and tell listeners (unless `notify: false`: the caller tells them later with
 * refreshRewards). @returns {boolean} false if it could not be persisted
 */
export function saveRewards(app, state, { notify = true } = {}) {
  const s = normalizeRewards(state);
  const ok = !!app?.store?.set?.(REWARDS_KEY, s);
  applyKit(s);
  if (notify) emit(s);
  return ok;
}

/** Re-read the stored rewards (after an import or a reset): re-apply the kit and tell listeners. */
export function refreshRewards(app) {
  const s = loadRewards(app);
  applyKit(s);
  emit(s);
  return s;
}

/** Subscribe to rewards changes. @returns {() => void} unsubscribe */
export function onRewards(fn) {
  const handler = (e) => { try { fn(e.detail?.state); } catch (err) { console.error(err); } };
  globalThis.addEventListener?.(REWARDS_EVENT, handler);
  return () => globalThis.removeEventListener?.(REWARDS_EVENT, handler);
}

function emit(state) {
  try { globalThis.dispatchEvent?.(new CustomEvent(REWARDS_EVENT, { detail: { state } })); } catch { /* no DOM */ }
}

/**
 * Apply one rewards event with today's local date, save, and (unless `celebrate: false`) hand what it earned to
 * app.celebrate.show(). `celebrate: false` also holds back the change notice (the header's level pill) until the
 * caller shows the gains and calls refreshRewards(): a drill reveals a rep's rewards with beat 2, never before.
 * A failure here must never break a drill: it logs and returns empty gains.
 * @param {object} app
 * @param {object} event  see js/rewards.js applyEvent
 * @param {{ celebrate?: boolean, grade?: string|null, host?: Element|null, card?: boolean, now?: Date }} [opts]
 *   grade: for the burst and the sounds (a rep passes its own); host / card: where the celebration shows (celebrate.js)
 * @returns {object} gained (plus `firstTry` on a rep: the first attempt ever at that drill)
 */
export function award(app, event, { celebrate = true, grade = null, host = null, card = true, now = new Date() } = {}) {
  try {
    const before = loadRewards(app);
    const { state, gained } = applyEvent(before, event, { day: todayLocal(now) });
    if (event?.type === 'rep') gained.firstTry = !before.best[baseScenarioId(event.scenarioId)];
    saveRewards(app, state, { notify: celebrate });
    if (celebrate) app?.celebrate?.show?.(gained, { grade: grade ?? (event?.type === 'rep' ? event.grade : null), host, card });
    return gained;
  } catch (err) {
    console.error('[fotbol] rewards: could not award', event, err);
    return emptyGains();
  }
}

// ---------------------------------------------------------------- gains (pure)

/** What an event earns when it earns nothing (the applyEvent `gained` shape, plus firstTry). */
export const emptyGains = () => ({ xp: 0, stars: null, newBest: false, improved: false, firstTry: false, badges: [], cards: [], levelUp: null });

const PALETTE_IDS = new Set(KIT_PALETTES.map((p) => p.id));

function cleanLevelUp(u) {
  if (!u || typeof u !== 'object') return null;
  const from = Number(u.from), to = Number(u.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to <= from) return null;
  const rank = rankFor(to);
  return {
    from, to, rank,
    rankUp: u.rankUp === true || rankFor(from).id !== rank.id,
    unlocks: Array.isArray(u.unlocks) ? [...new Set(u.unlocks.filter((id) => PALETTE_IDS.has(id)))] : [],
  };
}

/** A gains object as stored in an unfinished drill session (anything malformed reads as nothing earned). */
export function cleanGains(raw) {
  const g = emptyGains();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return g;
  g.xp = Number.isFinite(raw.xp) && raw.xp > 0 ? Math.round(raw.xp) : 0;
  g.stars = Number.isInteger(raw.stars) && raw.stars >= 0 && raw.stars <= 3 ? raw.stars : null;
  g.newBest = raw.newBest === true;
  g.improved = raw.improved === true;
  g.firstTry = raw.firstTry === true;
  g.badges = Array.isArray(raw.badges) ? [...new Set(raw.badges.filter((id) => typeof id === 'string' && BADGES_BY_ID[id]))] : [];
  g.cards = Array.isArray(raw.cards)
    ? raw.cards.filter((c) => c && typeof c.id === 'string' && c.id && [1, 2, 3].includes(c.tier)).map((c) => ({ id: c.id, tier: c.tier, upgrade: c.upgrade === true }))
    : [];
  g.levelUp = cleanLevelUp(raw.levelUp);
  return g;
}

/**
 * Two gains as one: a rep and the sticker cards its mastery earned (celebrated together), or a whole drill
 * session. XP adds up; `stars` is the first one's that has stars (a rep's); a badge counts once; a card keeps
 * its highest tier and whether it was new at its first appearance; level-ups join (from the first, to the last).
 */
export function mergeGains(a, b) {
  const A = cleanGains(a), B = cleanGains(b);
  const cards = A.cards.map((c) => ({ ...c }));
  for (const c of B.cards) {
    const had = cards.find((x) => x.id === c.id);
    if (had) had.tier = Math.max(had.tier, c.tier);
    else cards.push({ ...c });
  }
  let levelUp = A.levelUp ?? B.levelUp;
  if (A.levelUp && B.levelUp) {
    const to = Math.max(A.levelUp.to, B.levelUp.to), from = Math.min(A.levelUp.from, B.levelUp.from);
    levelUp = cleanLevelUp({ from, to, rankUp: A.levelUp.rankUp || B.levelUp.rankUp, unlocks: [...A.levelUp.unlocks, ...B.levelUp.unlocks] });
  }
  return {
    xp: A.xp + B.xp,
    stars: A.stars ?? B.stars,
    newBest: A.newBest || B.newBest,
    improved: A.improved || B.improved,
    firstTry: A.firstTry || B.firstTry,
    badges: [...new Set([...A.badges, ...B.badges])],
    cards,
    levelUp,
  };
}

// ---------------------------------------------------------------- kit and card helpers (pure)

/** A palette's CSS custom properties. */
export const paletteVars = (p) => ({ [KIT_VARS.shirt]: p.shirt, [KIT_VARS.edge]: p.edge, [KIT_VARS.ink]: p.ink });

/** The chosen kit's CSS custom properties. */
export const kitVars = (state) => paletteVars(paletteById(normalizeRewards(state).kit.palette));

/**
 * Set the kit on the document. The stylesheet's defaults are the 'classic' palette, so classic clears the
 * inline values rather than repeating them.
 */
export function applyKit(state, root = globalThis.document?.documentElement) {
  if (!root?.style) return;
  const s = normalizeRewards(state);
  const vars = kitVars(s);
  for (const [k, v] of Object.entries(vars)) {
    if (s.kit.palette === 'classic') root.style.removeProperty(k);
    else root.style.setProperty(k, v);
  }
}

/** The tag over the learner on the board: the nickname when one is set, else 'YOU'. */
export const youLabel = (state) => normalizeRewards(state).kit.nickname || 'YOU';

/** The learner's shirt number: the kit's, else the role's. */
export const shirtNumber = (state, roleNum) => normalizeRewards(state).kit.number ?? roleNum ?? null;

/** Stars across every drill (the best per drill; a mirrored drill shares its original's). */
export function totalStars(state) {
  return Object.values(normalizeRewards(state).best).reduce((a, b) => a + (b.stars ?? 0), 0);
}
