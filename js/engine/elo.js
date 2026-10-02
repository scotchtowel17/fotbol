// Skill model: Elo with partial credit (Pelánek 2016), the mastery half only.
// Contract: docs/ARCHITECTURE.md §5.7. Rationale: docs/RESEARCH.md §7.4 (and §7.1 row 9, §7.3).
//
// Skills are logit-scale estimates: one overall (global), one per principle and one per role.
// Every rep updates each relevant skill with its own uncertainty-based K; an estimate that has
// never been updated reads as the global skill. All functions are pure and deterministic:
// update() returns a new object and never mutates its input.
//
// The adaptive-selection half (per-item difficulty ladder, ability, targetFor, pickNext, the
// recent list) was removed by the 2026-10-01 audit: its only consumer was Coach mode's Drill
// ordering, which now serves the weakest principle first (js/ui/session.js pickScenario).
// Player mode never used it. Reps are judged against an average item (d = 0).

import { clamp } from './geometry.js';

export const ELO_DEFAULTS = Object.freeze({
  a: 1, // [S] K = a / (1 + b n), the uncertainty function (Pelánek 2016; RESEARCH 7.4)
  b: 0.05, // [S]
  kMin: 0.1, // [D] floor on K so skills keep tracking a learner who is still improving
  secondaryWeight: 0.5, // [D] update weight for a scenario's non-primary principles (the first listed is primary)
  masteryP: Object.freeze([0.6, 0.7, 0.8]), // [D] predicted success on a d = 0 item for 1, 2 and 3 stars
  masteryMinAttempts: 3, // [D] no stars before this many attempts on the principle
});

/**
 * @typedef {Object} Skills
 * @property {{global:number, byPrinciple:Object<string,number>, byRole:Object<string,number>}} theta
 * @property {{global:number, byPrinciple:Object<string,number>, byRole:Object<string,number>}} counts  attempts
 */

/** @returns {Skills} a fresh learner: every skill 0 (average), no attempts. */
export function createSkills() {
  return {
    theta: { global: 0, byPrinciple: {}, byRole: {} },
    counts: { global: 0, byPrinciple: {}, byRole: {} },
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
 * Record one rep. Partial credit: s = score01 in [0, 1] (the drill score / 100).
 *   theta_x += w K(n_x) (s - predict(theta_x, 0))   for global, each principle (w = 1 primary, secondaryWeight others) and the role
 * @param {Skills} skills
 * @param {{ principles?: string[], role?: string, score01: number }} rep
 * @param {object} [params] overrides for ELO_DEFAULTS
 * @returns {Skills} a new object; `skills` is not modified
 */
export function update(skills, { principles = [], role, score01 }, params = {}) {
  if (!Number.isFinite(score01)) throw new TypeError(`elo.update: score01 must be a number, got ${score01}`);
  const P = { ...ELO_DEFAULTS, ...params };
  const S = withDefaults(skills);
  const s = clamp(score01, 0, 1);
  const step = (theta, n, w = 1) => theta + w * kFactor(n, P) * (s - predict(theta, 0));
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
  return { ...S, theta, counts };
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
 * a bad per-principle or per-role entry as never practised. A stored `items`/`recent` pair from the
 * removed adaptive half is dropped.
 */
function withDefaults(skills) {
  const { items: _items, recent: _recent, ...rest } = skills && typeof skills === 'object' ? skills : {};
  const t = skills?.theta, c = skills?.counts;
  return {
    ...rest,
    theta: { global: num(t?.global, 0), byPrinciple: cleanMap(t?.byPrinciple, (v) => num(v, null)), byRole: cleanMap(t?.byRole, (v) => num(v, null)) },
    counts: { global: count(c?.global) ?? 0, byPrinciple: cleanMap(c?.byPrinciple, count), byRole: cleanMap(c?.byRole, count) },
  };
}
