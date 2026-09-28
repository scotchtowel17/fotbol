// Adaptive skill model: Elo with partial credit (Pelánek 2016).
// Contract: docs/ARCHITECTURE.md §5.7. Rationale: docs/RESEARCH.md §7.4 (and §7.1 row 9, §7.3).
//
// Skills are logit-scale estimates: one overall (global), one per principle and one per role.
// Each scenario has a difficulty d on the same scale (its authored `difficulty` is the prior).
// Every rep updates each relevant skill against d with its own uncertainty-based K; an
// estimate that has never been updated reads as the global skill. All functions are pure and
// deterministic: update() returns a new object and never mutates its input.

import { clamp, mean } from './geometry.js';

export const ELO_DEFAULTS = Object.freeze({
  targetP: 0.75, // [S] target success rate once warmed up (Math Garden used 0.75; RESEARCH 7.1 row 9, 7.4)
  warmupTargetP: 0.85, // [S] easier target for a new learner "to hook" them (RESEARCH 7.1 row 9)
  warmupAttempts: 10, // [D] attempts before switching from warmupTargetP to targetP
  a: 1, // [S] K = a / (1 + b n), the uncertainty function (Pelánek 2016; RESEARCH 7.4)
  b: 0.05, // [S]
  kMin: 0.1, // [D] floor on K so skills keep tracking a learner who is still improving
  secondaryWeight: 0.5, // [D] update weight for a scenario's non-primary principles (the first listed is primary)
  masteryP: Object.freeze([0.6, 0.7, 0.8]), // [D] predicted success on a d = 0 item for 1, 2 and 3 stars
  masteryMinAttempts: 3, // [D] no stars before this many attempts on the principle
  recentAvoid: 3, // [D] pickNext() skips the last this-many distinct scenarios when it can
  recentMax: 20, // [D] length of the recent-scenarios list kept in Skills
});

/**
 * @typedef {Object} Skills
 * @property {{global:number, byPrinciple:Object<string,number>, byRole:Object<string,number>}} theta
 * @property {{global:number, byPrinciple:Object<string,number>, byRole:Object<string,number>}} counts  attempts
 * @property {Object<string,{d:number, n:number}>} items  per-scenario difficulty and attempts
 * @property {string[]} recent  distinct scenario ids, most recent last
 */

/** @returns {Skills} a fresh learner: every skill 0 (average), no attempts. */
export function createSkills() {
  return {
    theta: { global: 0, byPrinciple: {}, byRole: {} },
    counts: { global: 0, byPrinciple: {}, byRole: {} },
    items: {},
    recent: [],
  };
}

/** Predicted probability of success for skill theta on an item of difficulty d. */
export const predict = (theta, d) => 1 / (1 + Math.exp(-(theta - d)));

/** Update step size after n previous attempts: max(kMin, a / (1 + b n)). */
export function kFactor(n, params = {}) {
  const P = { ...ELO_DEFAULTS, ...params };
  return Math.max(P.kMin, P.a / (1 + P.b * n));
}

/** Skill estimate for a principle (the global skill until the principle has been practised). */
export const principleTheta = (skills, id) => skills.theta?.byPrinciple?.[id] ?? skills.theta?.global ?? 0;
/** Skill estimate for a role (the global skill until the role has been played). */
export const roleTheta = (skills, role) => skills.theta?.byRole?.[role] ?? skills.theta?.global ?? 0;

/**
 * The ability used to predict success on a scenario: the mean of the primary principle's and the
 * role's estimates (whichever are given), else the global skill.
 * @param {Skills} skills
 * @param {{principles?: string[], role?: string, learner?: {role: string}}} item  a scenario works too
 */
export function ability(skills, { principles = [], role, learner } = {}) {
  role ??= learner?.role;
  const parts = [];
  if (principles[0]) parts.push(principleTheta(skills, principles[0]));
  if (role) parts.push(roleTheta(skills, role));
  return parts.length ? mean(parts) : skills.theta?.global ?? 0;
}

/**
 * Record one rep. Partial credit: s = score01 in [0, 1] (the drill score / 100).
 *   theta_x += w K(n_x) (s - predict(theta_x, d))   for global, each principle (w = 1 primary, secondaryWeight others) and the role
 *   d       -= K(n_item) (s - predict(ability, d))
 * all against the item's difficulty before this rep.
 * @param {Skills} skills
 * @param {{ itemId: string, principles?: string[], role?: string, score01: number, prior?: number }} rep
 *   prior: the scenario's authored difficulty, used the first time the item is seen
 * @param {object} [params] overrides for ELO_DEFAULTS
 * @returns {Skills} a new object; `skills` is not modified
 */
export function update(skills, { itemId, principles = [], role, score01, prior = 0 }, params = {}) {
  if (typeof itemId !== 'string' || !itemId) throw new TypeError('elo.update: itemId is required');
  if (!Number.isFinite(score01)) throw new TypeError(`elo.update: score01 must be a number, got ${score01}`);
  const P = { ...ELO_DEFAULTS, ...params };
  const S = withDefaults(skills);
  const s = clamp(score01, 0, 1);
  const item = S.items[itemId] ?? { d: prior, n: 0 };
  const d = item.d;
  const step = (theta, n, w = 1) => theta + w * kFactor(n, P) * (s - predict(theta, d));
  const ids = [...new Set(principles)];

  const theta = { global: step(S.theta.global, S.counts.global), byPrinciple: { ...S.theta.byPrinciple }, byRole: { ...S.theta.byRole } };
  const counts = { global: S.counts.global + 1, byPrinciple: { ...S.counts.byPrinciple }, byRole: { ...S.counts.byRole } };
  ids.forEach((id, i) => {
    const n = S.counts.byPrinciple[id] ?? 0;
    theta.byPrinciple[id] = step(principleTheta(S, id), n, i === 0 ? 1 : P.secondaryWeight);
    counts.byPrinciple[id] = n + 1;
  });
  if (role) {
    const n = S.counts.byRole[role] ?? 0;
    theta.byRole[role] = step(roleTheta(S, role), n);
    counts.byRole[role] = n + 1;
  }

  const pItem = predict(ability(S, { principles: ids, role }), d);
  const items = { ...S.items, [itemId]: { d: d - kFactor(item.n, P) * (s - pItem), n: item.n + 1 } };
  const recent = [...S.recent.filter((id) => id !== itemId), itemId].slice(-P.recentMax);
  return { ...S, theta, counts, items, recent };
}

/**
 * Mastery stars for a principle: 0 before masteryMinAttempts attempts, then 1/2/3 when the
 * predicted success on an average (d = 0) item reaches masteryP[0/1/2].
 * @returns {0|1|2|3}
 */
export function mastery(skills, principleId, params = {}) {
  const P = { ...ELO_DEFAULTS, ...params };
  const S = withDefaults(skills);
  if ((S.counts.byPrinciple[principleId] ?? 0) < P.masteryMinAttempts) return 0;
  const p = predict(principleTheta(S, principleId), 0);
  return /** @type {0|1|2|3} */ (P.masteryP.filter((th) => p >= th).length);
}

/** Target success probability for the next item: warmupTargetP for a new learner, then targetP. */
export function targetFor(skills, params = {}) {
  const P = { ...ELO_DEFAULTS, ...params };
  return withDefaults(skills).counts.global < P.warmupAttempts ? P.warmupTargetP : P.targetP;
}

/**
 * Choose the next scenario from `candidates` (scenario objects or index entries with `id`,
 * `principles`, `learner.role` or `role`, and optional `difficulty`):
 *   1. skip the last `recentAvoid` distinct scenarios seen (relaxing this if nothing is left);
 *   2. keep the candidates whose primary principle is the weakest (lowest estimate; ties: fewer
 *      attempts, then candidate order);
 *   3. among those, pick the one whose predicted success is closest to targetFor(skills).
 * Deterministic: remaining ties go to the earlier candidate.
 * @returns {object|null} one of `candidates`, or null if there are none
 */
export function pickNext(skills, candidates, params = {}) {
  const P = { ...ELO_DEFAULTS, ...params };
  if (!candidates?.length) return null;
  const S = withDefaults(skills);
  let pool = candidates;
  for (let avoid = P.recentAvoid; avoid > 0; avoid--) {
    const recent = new Set(S.recent.slice(-avoid));
    const left = candidates.filter((c) => !recent.has(c.id));
    if (left.length) { pool = left; break; }
  }

  const info = pool.map((c) => {
    const d = S.items[c.id]?.d ?? num(c.difficulty, 0);
    return { c, primary: c.principles?.[0] ?? null, p: predict(ability(S, c), d) };
  });

  let weakest, wTheta = Infinity, wN = Infinity;
  for (const x of info) {
    const theta = x.primary ? principleTheta(S, x.primary) : S.theta.global;
    const n = x.primary ? S.counts.byPrinciple[x.primary] ?? 0 : Infinity;
    if (theta < wTheta || (theta === wTheta && n < wN)) { weakest = x.primary; wTheta = theta; wN = n; }
  }

  const target = targetFor(S, P);
  let best = null;
  for (const x of info) {
    if (x.primary !== weakest) continue;
    if (!best || Math.abs(x.p - target) < Math.abs(best.p - target)) best = x;
  }
  return (best ?? info[0]).c;
}

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
/** A map keeping only the entries whose value `keep` accepts (non-null). */
function cleanMap(m, keep) {
  const out = {};
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    for (const [k, v] of Object.entries(m)) { const c = keep(v); if (c !== null) out[k] = c; }
  }
  return out;
}

/**
 * Fill any missing fields (e.g. progress saved by an older version) without mutating, and drop
 * anything that is not a finite number where one is expected (a hand-edited or corrupted progress
 * file must not turn skills into strings or NaN): a bad global skill or count reads as its default,
 * a bad per-principle, per-role or per-item entry as never practised.
 */
function withDefaults(skills) {
  const t = skills?.theta, c = skills?.counts;
  return {
    ...skills,
    theta: { global: num(t?.global, 0), byPrinciple: cleanMap(t?.byPrinciple, (v) => num(v, null)), byRole: cleanMap(t?.byRole, (v) => num(v, null)) },
    counts: { global: count(c?.global) ?? 0, byPrinciple: cleanMap(c?.byPrinciple, count), byRole: cleanMap(c?.byRole, count) },
    items: cleanMap(skills?.items, (v) => (num(v?.d, null) !== null && count(v?.n) !== null ? { d: v.d, n: v.n } : null)),
    recent: Array.isArray(skills?.recent) ? skills.recent.filter((id) => typeof id === 'string') : [],
  };
}
