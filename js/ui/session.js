// Shared session, selection and persistence helpers for Drill, Live and Progress.
// Contract: docs/ARCHITECTURE.md §5.7 (elo), §5.9 (app, store). Rationale: docs/RESEARCH.md §7.1-7.5
// (the learning loop, sessions, Elo with partial credit, measuring learning), §5.7 (live scoring).
//
// Everything here is PURE (no DOM, no clock): the caller passes the store (app.store or any object
// with get/set), the time (`now`, ms) and the calendar day. So it all runs under node --test
// (tests/session.test.js). Stored keys, all under the store's 'fotbol:' prefix:
//   skills   elo.createSkills() shape        (Elo per principle, per role, per scenario)
//   history  HistoryEntry[] (newest last, capped at SESSION_DEFAULTS.historyMax)
//   streak   { day: { current, best, last, days }, reps: { current, best } }
//            day = days played this week (R35; KID_REDESIGN §6.3), not a streak that can break: days holds the distinct
//            training days of the Monday-to-Sunday week of `last`, current = how many (0-7), best = the most in one week.
//            It only fills up within a week and starts again on Monday. loadStreak() also folds in the rewards'
//            training days, so Coach mode shows the same count as Player mode (rewards.js weekDaysPlayed).
//   live     { best: { [role]: { score, grade, seed, at } } }
// A reset and an import also cover 'tutorial', 'explore' and 'rewards' (RESET_KEYS, IMPORT_KEYS).

import { createSkills, mastery, principleTheta, roleTheta, predict, ELO_DEFAULTS } from '../engine/elo.js';
import { gradeOf } from '../engine/score.js';
import { ROLE_INFO, LEARNABLE_ROLES, familyOf, sideOf, mirrorRole } from '../engine/roles.js';
import { dist } from '../engine/geometry.js';
import { normalizeRewards, weekStart } from '../rewards.js';

export const SESSION_DEFAULTS = Object.freeze({
  reps: 6, // [S] task spec: a drill session is 6 reps, then a summary
  historyMax: 500, // [S] task spec: the history is capped at 500 entries
  goodScore: 70, // [D] a rep at or above this (grade B) keeps the rep streak going
  curveLength: 30, // [D] recent drill scores on the learning-curve sparkline
  curveWindow: 5, // [D] rolling-average window on that sparkline
  liveWorst: 3, // [S] RESEARCH 9.2 item 8: the 3 worst moments to replay
  liveWorstGap: 3, // [D] s: two "worst moments" are at least this far apart
  liveWorstBelow: 90, // [D] a moment scoring S is never shown as one of your toughest
  liveRecoverAt: 70, // [D] score that counts as back in position after a ball event (RESEARCH 5.7 recovery time)
  liveRecoverMax: 5, // [D] s: an event not recovered from within this is counted at this
  levelP: Object.freeze([0.3, 0.95]), // [D] predicted success on an average item mapped onto levels 1..LEVELS.length
  levelEvery: 4, // [D] ...but each level also takes this many more reps (three lucky reps are not level 6)
  resumeMaxMs: 6 * 60 * 60 * 1000, // [D] an unfinished drill session can be carried on for this long (6 hours)
});

export const STORE_KEYS = Object.freeze({ skills: 'skills', history: 'history', streak: 'streak', live: 'live' });
/** Keys a progress reset clears (settings stay). */
export const PROGRESS_KEYS = Object.freeze(Object.values(STORE_KEYS));
/** Keys "Reset progress" clears: the progress keys plus the tutorial and Explore records (learn.js, explore.js),
 *  the rewards (XP, badges, stickers, kit: ui/rewards-store.js) and Player mode's profile (its position and its Road
 *  stars: ui/player/road.js, key 'player'; after a reset the next open starts at the kick-off). Settings, the
 *  author's scenario draft ('author:draft') and today's play time ('player:today') are kept. */
export const RESET_KEYS = Object.freeze([...PROGRESS_KEYS, 'tutorial', 'explore', 'rewards', 'player']);
/** Keys a progress import replaces (the same set): a file never overwrites settings or a scenario draft
 *  (parseProgressFile hands the file's settings back separately, for the learner to opt in). */
export const IMPORT_KEYS = RESET_KEYS;

/** Level names by ability (standard / kid wording), lowest first. */
export const LEVELS = Object.freeze({
  standard: Object.freeze(['Newcomer', 'Trialist', 'Squad player', 'Rotation player', 'Regular', 'Starter', 'Key player', 'Vice-captain', 'Captain', 'Legend']),
  kid: Object.freeze(['Rookie', 'Learner', 'Team player', 'Getting good', 'Regular', 'Starter', 'Star player', 'Vice-captain', 'Captain', 'Legend']),
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
/** A map keeping only the entries `keep` accepts (non-null); anything but a plain object reads as empty. */
function cleanMap(m, keep) {
  const out = {};
  if (isObj(m)) for (const [k, v] of Object.entries(m)) { const c = keep(v); if (c !== null) out[k] = c; }
  return out;
}

// ---------------------------------------------------------------- persistence

/**
 * A skills object in the elo.createSkills() shape; anything unreadable starts afresh. Like elo.js, every skill
 * and count must be a finite number (a hand-edited or damaged progress file must not turn them into strings
 * or NaN): a bad global value reads as its default, a bad per-principle or per-role entry as never practised.
 * A stored `items`/`recent` pair from the removed adaptive half (audit 2026-10-01) is dropped.
 */
export function normalizeSkills(raw) {
  if (!isObj(raw) || !isObj(raw.theta) || !isObj(raw.counts)) return createSkills();
  const base = createSkills();
  const { items: _items, recent: _recent, ...rest } = raw;
  const t = raw.theta, c = raw.counts;
  return {
    ...base,
    ...rest,
    theta: { ...base.theta, global: num(t.global, base.theta.global), byPrinciple: cleanMap(t.byPrinciple, finite), byRole: cleanMap(t.byRole, finite) },
    counts: { ...base.counts, global: count(c.global) ?? base.counts.global, byPrinciple: cleanMap(c.byPrinciple, count), byRole: cleanMap(c.byRole, count) },
  };
}

export const loadSkills = (store) => normalizeSkills(store?.get?.(STORE_KEYS.skills, null));
/** @returns {boolean} false if it could not be persisted */
export const saveSkills = (store, skills) => !!store?.set?.(STORE_KEYS.skills, skills);

/** The rep history, oldest first (bad entries dropped). */
export function loadHistory(store) {
  const h = store?.get?.(STORE_KEYS.history, []);
  return Array.isArray(h) ? h.filter((e) => isObj(e) && Number.isFinite(e.score)) : [];
}

/**
 * Append one entry and persist, keeping the newest `max`.
 * @returns {object[]} the new history
 */
export function appendHistory(store, entry, { max = SESSION_DEFAULTS.historyMax } = {}) {
  const next = [...loadHistory(store), entry].slice(-max);
  store?.set?.(STORE_KEYS.history, next);
  return next;
}

/** 'YYYY-MM-DD' of a Date in local time. */
export function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days from day key a to day key b (b later = positive); NaN for bad keys. */
export function dayDiff(a, b) {
  const parse = (k) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k ?? ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  };
  return Math.round((parse(b) - parse(a)) / 86400000);
}

export function emptyStreak() {
  return { day: { current: 0, best: 0, last: null, days: [] }, reps: { current: 0, best: 0 } };
}

/**
 * A stored streak record, cleaned. An old record (a day streak, from before days played this week) keeps its last
 * training day as this week's first; its "best" counted days in a row, which is not comparable, so it starts again.
 */
export function normalizeStreak(raw) {
  const e = emptyStreak();
  if (!isObj(raw)) return e;
  const last = weekStart(raw.day?.last) ? raw.day.last : null;
  const week = last ? weekStart(last) : null;
  const stored = Array.isArray(raw.day?.days) ? raw.day.days : null;
  const days = week ? [...new Set([...(stored ?? []), last])].filter((d) => weekStart(d) === week).sort() : [];
  const best = stored ? Math.min(7, Math.max(0, Math.round(num(raw.day?.best)))) : 0;
  return {
    day: { current: days.length, best: Math.max(best, days.length), last, days },
    reps: { current: num(raw.reps?.current), best: num(raw.reps?.best) },
  };
}

/**
 * The week record with one more training day: a day of the same week joins it, a later week starts afresh, a day of
 * an earlier week (a clock that went back) changes nothing. Never goes down within a week.
 */
function withDay(rec, day) {
  const week = weekStart(day);
  if (!week) return rec;
  const current = rec.last ? weekStart(rec.last) : null;
  let days, last;
  if (current === week) { days = [...new Set([...rec.days, day])].sort(); last = day > rec.last ? day : rec.last; }
  else if (!current || week > current) { days = [day]; last = day; }
  else return rec;
  return { current: days.length, best: Math.max(rec.best, days.length), last, days };
}

/**
 * The stored streaks, with the rewards' training days (the 'rewards' key, js/rewards.js state.days) folded in: any
 * training (a drill, Live, Explore, Player mode) counts toward the week, and `best` is the most days in any one week.
 */
export function loadStreak(store) {
  const s = normalizeStreak(store?.get?.(STORE_KEYS.streak, null));
  const days = Object.keys(normalizeRewards(store?.get?.('rewards', null)).days).sort();
  let rec = s.day;
  for (const d of days) rec = withDay(rec, d);
  const perWeek = new Map();
  for (const d of days) perWeek.set(weekStart(d), (perWeek.get(weekStart(d)) ?? 0) + 1);
  return { ...s, day: { ...rec, best: Math.max(rec.best, ...perWeek.values()) } };
}
export const saveStreak = (store, streak) => !!store?.set?.(STORE_KEYS.streak, streak);

/**
 * Update the record for one rep or run (pure). Days played this week: the day joins its week (R35: it only fills up;
 * a new week starts again at 1, and nothing is ever "broken"). Rep streak (drill reps only, pass score): +1 at or
 * above goodScore, else back to 0.
 * @param {object} streak
 * @param {{ day: string, score?: number, rep?: boolean }} r  rep: false for a live run (days only)
 */
export function updateStreak(streak, { day, score, rep = true }, P = SESSION_DEFAULTS) {
  const s = normalizeStreak(streak);
  const out = { day: withDay(s.day, day), reps: { ...s.reps } };
  if (rep && Number.isFinite(score)) {
    out.reps.current = score >= P.goodScore ? s.reps.current + 1 : 0;
    out.reps.best = Math.max(s.reps.best, out.reps.current);
  }
  return out;
}

/**
 * Days played this week as it stands on `today` (R35): the training days of today's Monday-to-Sunday week, 0-7; 0 once
 * a new week has begun. The same count as Player mode's (rewards.js weekDaysPlayed) for a record from loadStreak().
 */
export function weekDays(streak, today) {
  const s = normalizeStreak(streak);
  const week = weekStart(today);
  return week ? s.day.days.filter((d) => weekStart(d) === week).length : 0;
}

/**
 * The old name of weekDays(), kept for the Drill summary and the Progress page: what they show is now days played this
 * week (it no longer drops to 0 after a missed day). Their labels should say "this week", not "in a row".
 */
export const currentDayStreak = weekDays;

/** A live best as stored, or null when it is unreadable (it must have a finite score and a grade). */
function cleanLiveBest(b) {
  if (!isObj(b) || finite(b.score) === null || typeof b.grade !== 'string' || !b.grade) return null;
  const out = { score: b.score, grade: b.grade, seed: typeof b.seed === 'string' || typeof b.seed === 'number' ? String(b.seed) : '', at: finite(b.at) };
  if (Number.isInteger(b.length) && b.length > 0) out.length = b.length;
  return out;
}

/** Live bests by role; an unreadable entry (a damaged or hand-edited import) is dropped, so it can be beaten again. */
export function loadLive(store) {
  const raw = store?.get?.(STORE_KEYS.live, null);
  return { best: cleanMap(raw?.best, cleanLiveBest) };
}

/**
 * Record a live run's result; returns { live, isBest } (does not persist: saveLive does).
 * Assisted runs (the ghost on) never count as a personal best. `length` is the sequence length in seconds
 * (the seed alone does not fix the sequence: #/live/<seed>/<length> replays it).
 */
export function recordLiveBest(live, { role, score, grade, seed, at, assisted = false, length }) {
  const best = cleanMap(live?.best, cleanLiveBest);
  const prev = best[role];
  const isBest = !assisted && Number.isFinite(score) && (!prev || score > prev.score);
  if (isBest) best[role] = { score, grade, seed: String(seed), at, ...(Number.isInteger(length) && length > 0 ? { length } : {}) };
  return { live: { best }, isBest };
}

/** The address that replays a live sequence: its seed and, when known, its length in seconds. */
export const liveHash = (seed, length) => `#/live/${encodeURIComponent(String(seed ?? ''))}${Number.isInteger(length) && length > 0 ? `/${length}` : ''}`;
export const saveLive = (store, live) => !!store?.set?.(STORE_KEYS.live, live);

// ---------------------------------------------------------------- routes and selection

/**
 * Drill route params → what to practise.
 *   []            → { kind: 'auto' }            first unfinished module
 *   ['M1']        → { kind: 'module', id: 'M1' }
 *   ['p', 'D3']   → { kind: 'principle', id: 'D3' }
 *   ['s', 'id']   → { kind: 'scenario', id }
 * Anything else reads as auto (the drill never dead-ends on a bad link).
 */
export function parseDrillRoute(params = []) {
  const [a, b] = params.map((p) => String(p ?? '').trim());
  if (!a) return { kind: 'auto' };
  if (/^m\d+$/i.test(a)) return { kind: 'module', id: a.toUpperCase() };
  if ((a === 'p' || a === 'principle') && b) return { kind: 'principle', id: b.toUpperCase() };
  if ((a === 's' || a === 'scenario') && b) return { kind: 'scenario', id: b };
  return { kind: 'auto' };
}

/** The authored learner role of an index entry or scenario. */
export const authoredRole = (entry) => entry?.role ?? entry?.learner?.role ?? null;

/**
 * How a scenario is played by a learner who chose `role`: as authored when it is the same role (or a
 * central one), mirrored left↔right when it is the same family on the other side (LB playing an RB
 * scenario), null when the family differs.
 * @returns {{ mirror: boolean, role: string }|null}
 */
export function playAs(entryRole, role) {
  if (!ROLE_INFO[entryRole] || !ROLE_INFO[role]) return null;
  if (familyOf(entryRole) !== familyOf(role)) return null;
  const mirror = sideOf(entryRole) !== sideOf(role) && sideOf(entryRole) !== 'C' && mirrorRole(entryRole) === role;
  return { mirror, role: mirror ? mirrorRole(entryRole) : entryRole };
}

/**
 * Scenario refs a learner can play: family match with the chosen role (the mirrored variant when the
 * side differs), filtered by module, principle or one scenario id.
 * @param {{ index: object[], role: string, module?: string, principle?: string, scenarioId?: string, anyRole?: boolean }} q
 *   anyRole: every scenario in its authored role (the fallback when nothing matches the chosen role)
 * @returns {{ id: string, baseId: string, mirror: boolean, role: string, authoredRole: string, principles: string[],
 *             module: string|null, difficulty: number, title: string }[]}
 *   id is the played id ('<baseId>-m' when mirrored); Elo keys items by baseId
 */
export function candidatesFor({ index = [], role, module, principle, scenarioId, anyRole = false } = {}) {
  const out = [];
  const wantId = scenarioId ? String(scenarioId).replace(/-m$/, '') : null;
  for (const e of index) {
    if (!isObj(e) || typeof e.id !== 'string') continue;
    if (wantId && e.id !== wantId) continue;
    if (module && e.module !== module) continue;
    const principles = Array.isArray(e.principles) ? e.principles : [];
    if (principle && !principles.includes(principle)) continue;
    const r = authoredRole(e);
    const how = anyRole ? (ROLE_INFO[r] ? { mirror: false, role: r } : null) : playAs(r, role);
    if (!how) continue;
    out.push({
      id: how.mirror ? `${e.id}-m` : e.id,
      baseId: e.id,
      mirror: how.mirror,
      role: how.role,
      authoredRole: r,
      principles,
      module: e.module ?? null,
      difficulty: num(e.difficulty, 0),
      title: typeof e.title === 'string' ? e.title : e.id,
    });
  }
  return out;
}

/**
 * Next scenario: the weakest primary principle first (weakestPrinciple; ties go to fewer attempts, then
 * candidate order), preferring ones not yet played this session. The 75 %-success targeting that used to
 * order the pool (elo.pickNext, the adaptive half) went with the 2026-10-01 audit.
 * @param {object} skills
 * @param {object[]} candidates  from candidatesFor()
 * @param {{ exclude?: string[] }} [opts]  baseIds already played this session
 * @returns {object|null} one of candidates
 */
export function pickScenario(skills, candidates, { exclude = [] } = {}) {
  if (!candidates?.length) return null;
  const played = new Set(exclude);
  const fresh = candidates.filter((c) => !played.has(c.baseId));
  const pool = fresh.length ? fresh : candidates;
  const weakest = weakestPrinciple(skills, pool.map((c) => c.principles?.[0]).filter(Boolean));
  return pool.find((c) => c.principles?.[0] === weakest) ?? pool[0];
}

/**
 * The pool the next rep is picked from: scenarios in your role not played this session first; when
 * those run out, the extras (the same module or principle in other roles, played as authored) not
 * played yet; only then repeats of your own. So a short list for one role never repeats a scenario
 * while its answer is still fresh.
 * @param {object[]} own     candidatesFor() in the learner's role family
 * @param {object[]} extra   candidatesFor(..., anyRole: true) minus `own`
 * @param {string[]} played  baseIds played this session
 * @returns {object[]}
 */
export function repPool(own = [], extra = [], played = []) {
  const seen = new Set(played);
  const fresh = (list) => list.filter((c) => !seen.has(c.baseId));
  const a = fresh(own);
  if (a.length) return a;
  const b = fresh(extra);
  if (b.length) return b;
  return own.length ? own : extra;
}

/** Other-role candidates to top a plan up with (anyRole candidates whose scenario is not already in `own`). */
export function extraCandidates(own = [], anyRole = []) {
  const ids = new Set(own.map((c) => c.baseId));
  return anyRole.filter((c) => !ids.has(c.baseId)).map((c) => ({ ...c, extra: true }));
}

/** The key an unfinished drill session is kept under: the same practice (module, principle or scenario link) in the same role. */
export function drillSessionKey(plan, role) {
  const what = plan?.kind === 'principle' ? plan.principle : plan?.kind === 'scenario' ? plan.first : plan?.module;
  return `${plan?.kind ?? 'auto'}:${what ?? ''}:${role ?? ''}`;
}

/**
 * A saved drill session that can be carried on (leave for Progress mid-session, come back, carry on): the
 * same key, some reps played but not all, saved at most resumeMaxMs ago. Pure: `now` is passed in.
 * @param {object} saved  { key, reps: [{ id, baseId, title, score, grade, principles }], played: baseId[], before: skills, repsTotal, at }
 * @returns {{ key, reps, played, before, repsTotal, at }|null}  a cleaned copy, or null
 */
export function resumableSession(saved, { key, now }, P = SESSION_DEFAULTS) {
  if (!isObj(saved) || saved.key !== key) return null;
  const at = finite(saved.at);
  if (at === null || !(now - at >= 0 && now - at <= P.resumeMaxMs)) return null;
  const repsTotal = Number.isInteger(saved.repsTotal) && saved.repsTotal > 0 ? saved.repsTotal : P.reps;
  const reps = (Array.isArray(saved.reps) ? saved.reps : [])
    .filter((r) => isObj(r) && typeof r.baseId === 'string' && finite(r.score) !== null && typeof r.grade === 'string')
    .map((r) => ({
      id: String(r.id ?? r.baseId), baseId: r.baseId, title: String(r.title ?? r.baseId), score: r.score, grade: r.grade,
      principles: Array.isArray(r.principles) ? r.principles.filter((id) => typeof id === 'string') : [],
      ...(typeof r.titleKid === 'string' && r.titleKid ? { titleKid: r.titleKid } : {}),
    }));
  if (!reps.length || reps.length >= repsTotal) return null;
  const played = Array.isArray(saved.played) ? saved.played.filter((id) => typeof id === 'string') : reps.map((r) => r.baseId);
  return { key, reps, played, before: normalizeSkills(saved.before), repsTotal, at };
}

/** Drill modules of the curriculum (kind 'drills'), in order. */
export const drillModules = (curriculum) => (curriculum?.modules ?? []).filter((m) => m?.kind === 'drills');

/**
 * Progress through each drill module: stars per principle (elo.mastery), whether the chosen role has
 * drills there, and whether it is finished (every principle that has a drill at moduleUnlockStars or more).
 * @returns {{ id, title, subtitle, principles: { id, stars, attempts, hasDrills }[], stars, maxStars, finished,
 *             playable: number, started: boolean }[]}
 */
export function moduleProgress({ curriculum, index = [], skills, role }) {
  const S = normalizeSkills(skills);
  const need = num(curriculum?.moduleUnlockStars, 1);
  return drillModules(curriculum).map((m) => {
    const inModule = index.filter((e) => e?.module === m.id);
    const principles = (m.principles ?? []).map((id) => ({
      id,
      stars: mastery(S, id),
      attempts: S.counts.byPrinciple[id] ?? 0,
      hasDrills: inModule.some((e) => e.principles?.includes(id)),
    }));
    const taught = principles.filter((p) => p.hasDrills);
    const stars = principles.reduce((a, p) => a + p.stars, 0);
    return {
      id: m.id,
      title: m.title ?? m.id,
      subtitle: m.subtitle ?? '',
      principles,
      stars,
      maxStars: principles.length * 3,
      finished: taught.length > 0 && taught.every((p) => p.stars >= need),
      playable: role ? candidatesFor({ index, role, module: m.id }).length : inModule.length,
      started: principles.some((p) => p.attempts > 0),
    };
  });
}

/**
 * The module a plain '#/drill' starts: the first unfinished one with drills for the role, else the
 * first with any drills for the role, else the first with any drills at all (played in their own
 * roles), else the first module.
 * @returns {{ id: string|null, anyRole: boolean }}
 */
export function autoModule({ curriculum, index = [], skills, role }) {
  const mods = moduleProgress({ curriculum, index, skills, role });
  const pick = mods.find((m) => m.playable && !m.finished) ?? mods.find((m) => m.playable);
  if (pick) return { id: pick.id, anyRole: false };
  const any = mods.find((m) => index.some((e) => e?.module === m.id));
  return { id: any?.id ?? mods[0]?.id ?? null, anyRole: !!any };
}

/** The weakest of these principles by Elo (ties: fewer attempts, then list order). */
export function weakestPrinciple(skills, ids = []) {
  const S = normalizeSkills(skills);
  let best = null, bt = Infinity, bn = Infinity;
  for (const id of ids) {
    const t = principleTheta(S, id), n = S.counts.byPrinciple[id] ?? 0;
    if (t < bt || (t === bt && n < bn)) { best = id; bt = t; bn = n; }
  }
  return best;
}

/**
 * Board orientation for a play mode from the WINDOW size (not the board's box): a phone held upright
 * gets the vertical pitch whatever the bottom sheet's height does to the box, so the pitch never flips
 * between phases; everything else lets the board decide ('auto').
 * @returns {'vertical'|'auto'}
 */
export function orientationFor(width, height) {
  return width > 0 && height > width ? 'vertical' : 'auto';
}

// ---------------------------------------------------------------- scenario helpers

/** True if spot p is inside a misconception region (circle | rect | polygon; even-odd rule). */
export function inRegion(p, r) {
  if (!isObj(r) || !p) return false;
  if (r.type === 'circle') return dist(p, r) <= r.r;
  if (r.type === 'rect') return p.x >= Math.min(r.x0, r.x1) && p.x <= Math.max(r.x0, r.x1) && p.y >= Math.min(r.y0, r.y1) && p.y <= Math.max(r.y0, r.y1);
  if (r.type === 'polygon') {
    let inside = false;
    const pts = r.points ?? [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  return false;
}

/** The first misconception whose region holds the spot, or null. */
export function misconceptionAt(scenario, spot) {
  return (scenario?.misconceptions ?? []).find((m) => inRegion(spot, m?.region)) ?? null;
}

/** A string, a { standard, kid } pair, or a string plus a `<field>Kid` sibling, in the wording asked for. */
export function wordingOf(v, wording = 'standard', kidAlt) {
  if (wording === 'kid' && typeof kidAlt === 'string' && kidAlt) return kidAlt;
  if (typeof v === 'string') return v;
  if (isObj(v)) return String((wording === 'kid' ? v.kid : v.standard) ?? v.standard ?? v.kid ?? '');
  return '';
}

// ---------------------------------------------------------------- summaries

/** Length of the longest run of scores at or above `at`. */
export function longestRun(scores, at = SESSION_DEFAULTS.goodScore) {
  let run = 0, best = 0;
  for (const s of scores) { run = s >= at ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}

/**
 * A drill session's summary.
 * @param {{ reps: { id, baseId, title, score, grade, principles }[], before: object, after: object }} s
 *   before/after: skills at the start and end of the session
 * @returns {{ count, average, grade, best, run, reps, principles: { id, before, after, delta, stars: [number, number] }[],
 *             improved: string[], weakest: string|null }}
 */
export function summarizeSession({ reps = [], before, after }) {
  const scores = reps.map((r) => r.score).filter(Number.isFinite);
  const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const B = normalizeSkills(before), A = normalizeSkills(after);
  const ids = [...new Set(reps.flatMap((r) => r.principles ?? []))];
  const principles = ids.map((id) => {
    const tb = principleTheta(B, id), ta = principleTheta(A, id);
    return { id, before: tb, after: ta, delta: ta - tb, stars: [mastery(B, id), mastery(A, id)] };
  });
  return {
    count: scores.length,
    average,
    grade: gradeOf(average),
    best: scores.length ? Math.max(...scores) : 0,
    run: longestRun(scores),
    reps: reps.map((r) => ({ id: r.id, baseId: r.baseId, title: r.title, score: r.score, grade: r.grade, ...(r.titleKid ? { titleKid: r.titleKid } : {}) })),
    principles,
    improved: principles.filter((p) => p.stars[1] > p.stars[0]).map((p) => p.id),
    weakest: weakestPrinciple(A, ids),
  };
}

/**
 * A live run's result from its 10 Hz samples (RESEARCH 5.7).
 * @param {{ t: number, score: number|null, grace?: boolean }[]} samples  score null or grace true = not scored
 * @param {{ t: number }[]} [events]  ball events (for recovery time)
 * @returns {{ average: number, grade: string, scored: number, total: number, worst: { t: number, score: number }[],
 *             recovery: number|null, onSpot: number }}
 *   average: time-averaged score over scored samples; worst: the lowest samples at least liveWorstGap apart;
 *   recovery: mean seconds to get back to liveRecoverAt after each event you were out of position for;
 *   onSpot: share of scored samples at A or better (0..1)
 */
export function summarizeLive(samples = [], events = [], P = SESSION_DEFAULTS) {
  const scored = samples.filter((s) => !s.grace && Number.isFinite(s.score));
  const average = scored.length ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length) : 0;
  const worst = [];
  for (const s of [...scored].sort((a, b) => a.score - b.score || a.t - b.t)) {
    if (worst.length >= P.liveWorst || s.score >= P.liveWorstBelow) break;
    if (worst.every((w) => Math.abs(w.t - s.t) >= P.liveWorstGap)) worst.push({ t: s.t, score: s.score });
  }
  worst.sort((a, b) => a.t - b.t);
  const valid = samples.filter((s) => Number.isFinite(s.score));
  const recoveries = [];
  for (const e of events) {
    const after = valid.filter((s) => s.t >= e.t && s.t <= e.t + P.liveRecoverMax);
    if (!after.length || after[0].score >= P.liveRecoverAt) continue; // never out of position
    const back = after.find((s) => s.score >= P.liveRecoverAt);
    recoveries.push(back ? back.t - e.t : P.liveRecoverMax);
  }
  return {
    average,
    grade: gradeOf(average),
    scored: scored.length,
    total: samples.length,
    worst,
    recovery: recoveries.length ? Math.round((recoveries.reduce((a, b) => a + b, 0) / recoveries.length) * 10) / 10 : null,
    onSpot: scored.length ? scored.filter((s) => s.score >= 80).length / scored.length : 0,
  };
}

/**
 * Overall level from the global skill: predicted success on an average item mapped onto LEVELS, capped
 * at 1 + floor(attempts / levelEvery) so a level also needs practice behind it.
 * @returns {{ level: number, name: string, p: number, attempts: number, next: number }}  level 0 before any
 *   attempt; next: 0..1 progress toward the next level
 */
export function levelFor(skills, wording = 'standard', P = SESSION_DEFAULTS) {
  const S = normalizeSkills(skills);
  const names = LEVELS[wording === 'kid' ? 'kid' : 'standard'];
  const attempts = num(S.counts.global);
  const p = predict(num(S.theta.global), 0);
  if (!attempts) return { level: 0, name: names[0], p, attempts, next: 0 };
  const [lo, hi] = P.levelP;
  const byAbility = ((p - lo) / (hi - lo)) * names.length; // continuous, 0-based
  const byPractice = attempts / P.levelEvery;
  const raw = Math.max(0, Math.min(byAbility, byPractice));
  const level = Math.max(1, Math.min(names.length, 1 + Math.floor(raw)));
  const next = level >= names.length ? 1 : Math.max(0, Math.min(1, raw - (level - 1)));
  return { level, name: names[level - 1], p, attempts, next };
}

/** Per-role ability: predicted success on an average item for each role played (most played first). */
export function roleAbilities(skills) {
  const S = normalizeSkills(skills);
  return LEARNABLE_ROLES.filter((r) => (S.counts.byRole[r] ?? 0) > 0)
    .map((r) => ({ role: r, p: predict(roleTheta(S, r), 0), attempts: S.counts.byRole[r] }))
    .sort((a, b) => b.attempts - a.attempts);
}

/** Recent drill scores and their rolling mean, oldest first, for the learning-curve sparkline. */
export function learningCurve(history, P = SESSION_DEFAULTS) {
  const scores = history.filter((h) => h.mode === 'drill' && Number.isFinite(h.score)).slice(-P.curveLength).map((h) => h.score);
  const rolling = scores.map((_, i) => {
    const w = scores.slice(Math.max(0, i - P.curveWindow + 1), i + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  return { scores, rolling };
}

// ---------------------------------------------------------------- import / export

/** File name for a progress export. */
export const exportFileName = (day) => `fotbol-progress-${day}.json`;

/**
 * Check a progress file before importing it. Accepts what store.exportAll() writes ('fotbol:'-prefixed
 * keys), optionally wrapped as { app: 'fotbol', data: {...} }. Only the progress keys (IMPORT_KEYS) are
 * imported: an export also carries the sender's settings and scenario draft, and neither may overwrite this
 * browser's. The file's settings come back as `settings` so the import dialog can offer them (opt in).
 * @param {string} text  the file's contents
 * @returns {{ ok: true, data: object, keys: string[], settings: object|null, summary: { reps: number, principles: number } }
 *   | { ok: false, error: string }}  data: only the 'fotbol:<IMPORT_KEYS>' entries; keys: theirs
 */
export function parseProgressFile(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'This file is not valid JSON.' }; }
  const data = isObj(raw) && raw.app === 'fotbol' && isObj(raw.data) ? raw.data : raw;
  if (!isObj(data)) return { ok: false, error: 'This file does not look like a fotbol progress file.' };
  const keys = IMPORT_KEYS.map((k) => `fotbol:${k}`).filter((k) => data[k] !== undefined);
  if (!keys.length) return { ok: false, error: 'This file has no fotbol progress in it.' };
  const skills = data[`fotbol:${STORE_KEYS.skills}`];
  if (skills !== undefined && !(isObj(skills) && isObj(skills.theta) && isObj(skills.counts))) {
    return { ok: false, error: 'The skills in this file are damaged, so it was not imported.' };
  }
  const history = data[`fotbol:${STORE_KEYS.history}`];
  if (history !== undefined && !Array.isArray(history)) return { ok: false, error: 'The history in this file is damaged, so it was not imported.' };
  const live = data[`fotbol:${STORE_KEYS.live}`];
  if (live !== undefined && !(isObj(live) && (live.best === undefined || isObj(live.best)))) {
    return { ok: false, error: 'The live scores in this file are damaged, so it was not imported.' };
  }
  const clean = Object.fromEntries(keys.map((k) => [k, data[k]]));
  // Rewards are sanitised on the way in (js/rewards.js normalizeRewards): a damaged entry reads as a fresh start,
  // never as a reason to refuse the file (a locked kit or a bad nickname is simply dropped).
  if (clean['fotbol:rewards'] !== undefined) clean['fotbol:rewards'] = normalizeRewards(clean['fotbol:rewards']);
  const settings = isObj(data['fotbol:settings']) ? data['fotbol:settings'] : null;
  return {
    ok: true,
    data: clean,
    keys,
    settings,
    summary: {
      reps: Array.isArray(history) ? history.length : 0,
      principles: isObj(skills?.counts?.byPrinciple) ? Object.keys(skills.counts.byPrinciple).length : 0,
    },
  };
}

/** The target success rate the next pick aims at (for copy such as "about 3 in 4"). */
export const targetRate = () => ELO_DEFAULTS.targetP;
