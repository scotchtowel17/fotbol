// Scoring: zone score (distance to the base or authored ideal) + weighted principle
// rules, capped when a critical rule is broken, then graded S-F.
// Contract: docs/ARCHITECTURE.md §5.6. Rationale: docs/RESEARCH.md §5.3 and §5.6.
//
//   S_rules = Σ w_r s_r / Σ w_r          (applicable rules only; 1 if none apply)
//   G       = 1 if S_zone >= 0.5, else fading linearly to RULES_GATE.floor (0.5) as S_zone -> 0
//   score   = round(100 (0.55 S_zone + 0.45 G S_rules)), capped at 59 on a critical fail, and at 69 when a
//             drill's own lesson rule is clearly missed (LESSON_CAP)
//
// The gate G is an addition to RESEARCH 5.6: most rules are local geometry (a clear
// lane, spacing, lanes and lines) that many far-away spots also satisfy, so without it
// a spot 20 m off could still collect 45+ points. Near the zone (S_zone >= 0.5, i.e.
// within about 2.2x the tolerance) the formula is exactly RESEARCH 5.6.

import { clamp, dist } from './geometry.js';
import { ROLE_INFO } from './roles.js';
import { RULES } from './rules/index.js';

/** Zone tolerance ellipse per role family: tx along the pitch (x), ty across it (y), metres. */
export const TOLERANCE = Object.freeze({
  CB: Object.freeze({ tx: 2.5, ty: 4 }), // [D] line height matters most
  FB: Object.freeze({ tx: 2.5, ty: 4 }), // [D]
  DM: Object.freeze({ tx: 4, ty: 4 }), // [D]
  CM: Object.freeze({ tx: 5, ty: 6 }), // [D] more freedom
  W: Object.freeze({ tx: 6, ty: 4 }), // [D] width matters
  ST: Object.freeze({ tx: 6, ty: 6 }), // [D]
  GK: Object.freeze({ tx: 1.5, ty: 1.5 }), // [D] v1.1
});

export const SCORE_WEIGHTS = Object.freeze({ zone: 0.55, rules: 0.45 }); // [D] RESEARCH 5.6
/** Rule credit fades once you are well outside your zone (see the header). */
export const RULES_GATE = Object.freeze({
  fullAt: 0.5, // [D] zone score at or above which rules earn full credit
  floor: 0.5, // [D] share of rule credit left at zone score 0 (20 m from the zone centre then scores <= 30 for every role)
});
export const CRITICAL_CAP = 59; // [D] a broken critical rule can never pass (C starts at 60)
/**
 * A drill's own lesson (frame.tags.lesson, its first principle: timeline.js) clearly missed caps the score: a rule of
 * that principle weighing at least minWeight that scores below `fail` holds the spot to `cap` (C), so a spot that
 * misses what the drill is about can never be graded A or S however close it is to the shape (m2-09: in front of their
 * midfield instead of between the lines scored 94; m2-07: in their #6's cover shadow 90). Static scenes have no lesson.
 */
export const LESSON_CAP = Object.freeze({ fail: 0.5, minWeight: 2, cap: 69 }); // [D]
/** Lower bounds of each grade; anything below the last is F. */
export const GRADE_BANDS = Object.freeze([['S', 90], ['A', 80], ['B', 70], ['C', 60], ['D', 50]]); // [D]

/**
 * Anisotropic zone score: 1 inside the tolerance ellipse, then exp(-0.5 (d_n - 1)^2),
 * which gives about half credit at 2.2x the tolerance.
 * @param {{x:number,y:number}} spot
 * @param {{x:number,y:number}} center
 * @param {{tx:number,ty:number}} tol
 * @returns {number} 0..1
 */
export function zoneScore(spot, center, tol) {
  const nx = (spot.x - center.x) / tol.tx, ny = (spot.y - center.y) / tol.ty;
  const dn = Math.sqrt(nx * nx + ny * ny);
  return dn <= 1 ? 1 : Math.exp(-0.5 * (dn - 1) ** 2);
}

/**
 * Zone tolerance for a role (or a family ID), with an optional per-scenario override.
 * @param {string} role   e.g. 'LCB' (or a family such as 'CB')
 * @param {{tx?:number, ty?:number}} [override]
 * @returns {{tx:number, ty:number}}
 */
export function toleranceFor(role, override) {
  const t = TOLERANCE[ROLE_INFO[role]?.family ?? role] ?? TOLERANCE.CM;
  return { tx: override?.tx ?? t.tx, ty: override?.ty ?? t.ty };
}

/**
 * @param {number} score 0..100
 * @returns {'S'|'A'|'B'|'C'|'D'|'F'}
 */
export function gradeOf(score) {
  for (const [g, lo] of GRADE_BANDS) if (score >= lo) return g;
  return 'F';
}

/** Rules that apply to this context, with their weights (weight(ctx) is called once), each marked if it is the lesson's. */
function applicable(ctx, rules) {
  const out = [];
  const lesson = ctx.frame?.tags?.lesson;
  for (const rule of rules) {
    const w = rule.weight(ctx);
    if (w > 0) out.push({ rule, w, lesson: !!lesson && w >= LESSON_CAP.minWeight && rule.principles.includes(lesson) });
  }
  return out;
}

function runRules(ctx, spot, active) {
  const results = [];
  let sw = 0, sws = 0, lessonMissed = false;
  for (const { rule, w, lesson } of active) {
    const r = rule.evaluate(ctx, spot);
    const s = clamp(Number.isFinite(r.s) ? r.s : 0, 0, 1);
    sw += w;
    sws += w * s;
    const missed = lesson && s < LESSON_CAP.fail;
    if (missed) lessonMissed = true;
    results.push({
      id: rule.id,
      principles: rule.principles,
      weight: w,
      s,
      critical: !!(rule.critical && r.critical),
      ...(missed ? { lesson: true } : {}),
      target: r.target,
      vars: r.vars ?? {},
    });
  }
  return { sRules: sw > 0 ? sws / sw : 1, results, lessonMissed };
}

/**
 * Evaluate every applicable rule at a spot.
 * @param {object} ctx   from buildContext()
 * @param {{x:number,y:number}} spot
 * @param {object[]} [rules]  defaults to the v1 registry
 * @returns {{ sRules:number, results: import('./types.js').RuleResult[] }}
 */
export function evaluateRules(ctx, spot, rules = RULES) {
  const { sRules, results } = runRules(ctx, spot, applicable(ctx, rules));
  return { sRules, results };
}

/**
 * Share of rule credit available at a given zone score (1 near the zone).
 * @param {number} sZone 0..1
 * @returns {number} RULES_GATE.floor..1
 */
export function rulesGate(sZone) {
  const { fullAt, floor } = RULES_GATE;
  return sZone >= fullAt ? 1 : floor + (1 - floor) * (sZone / fullAt);
}

function combine(sZone, sRules, critical, lessonMissed) {
  const raw = 100 * (SCORE_WEIGHTS.zone * sZone + SCORE_WEIGHTS.rules * rulesGate(sZone) * sRules);
  return Math.min(raw, critical ? CRITICAL_CAP : Infinity, lessonMissed ? LESSON_CAP.cap : Infinity);
}

/**
 * Full evaluation of a spot.
 * @param {object} ctx
 * @param {{x:number,y:number}} spot
 * @param {{ center?: {x:number,y:number}, tol?: {tx:number,ty:number}, rules?: object[] }} [opts]
 *   center defaults to the learner's base, tol to the role tolerance, rules to the v1 registry.
 * @returns {import('./types.js').EvalResult & { raw: number, gate: number, spot: {x:number,y:number} }}
 *   `raw` is the unrounded (capped) score, used for ranking by the ghost search;
 *   `gate` is rulesGate(sZone), the share of rule credit that counted.
 */
export function evaluate(ctx, spot, { center, tol, rules = RULES } = {}) {
  const c = center ?? ctx.learner.base;
  const t = tol ?? toleranceFor(ctx.learner.role);
  const sZone = zoneScore(spot, c, t);
  const { sRules, results, lessonMissed } = runRules(ctx, spot, applicable(ctx, rules));
  const critical = results.some((r) => r.critical);
  const raw = combine(sZone, sRules, critical, lessonMissed);
  const score = clamp(Math.round(raw), 0, 100);
  return {
    score, grade: gradeOf(score), sZone, sRules, gate: rulesGate(sZone), critical, lessonMissed, rules: results,
    distance: dist(spot, c), center: { x: c.x, y: c.y }, tol: { tx: t.tx, ty: t.ty }, raw, spot: { x: spot.x, y: spot.y },
  };
}

/**
 * A fast scorer for many spots against one context (ghost search, live mode at 10 Hz):
 * rule weights are resolved once and no per-rule result objects are kept.
 * @param {object} ctx
 * @param {{ center?: {x:number,y:number}, tol?: {tx:number,ty:number}, rules?: object[] }} [opts]
 * @returns {((spot: {x:number,y:number}) => number) & { upper: (spot) => number }} unrounded score 0..100 (critical cap
 *   applied); `upper(spot)` is the most that spot could score whatever the rules say (the zone term with every rule met)
 */
export function createScorer(ctx, { center, tol, rules = RULES } = {}) {
  const c = center ?? ctx.learner.base;
  const t = tol ?? toleranceFor(ctx.learner.role);
  const active = applicable(ctx, rules);
  let sw = 0;
  for (const a of active) sw += a.w;
  const scoreAt = (spot) => {
    let sws = 0, critical = false, lessonMissed = false;
    for (const { rule, w, lesson } of active) {
      const r = rule.evaluate(ctx, spot);
      const s = clamp(Number.isFinite(r.s) ? r.s : 0, 0, 1);
      sws += w * s;
      if (rule.critical && r.critical) critical = true;
      if (lesson && s < LESSON_CAP.fail) lessonMissed = true;
    }
    return combine(zoneScore(spot, c, t), sw > 0 ? sws / sw : 1, critical, lessonMissed);
  };
  // The most a spot could score (every rule met, no cap): the zone alone bounds it, so a search can skip the rules
  // where even this cannot beat what it has found (ghost.js with field: false).
  scoreAt.upper = (spot) => combine(zoneScore(spot, c, t), 1, false, false);
  return scoreAt;
}
