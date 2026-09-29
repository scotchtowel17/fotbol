// Shared helpers for the principle rules in js/engine/rules/ (layer B).
// Pure: no DOM, no I/O. Any rule file may import from here; keep the exports stable.
//
// Performance pattern: evaluate() runs ~700 times per ghost search, so each rule
// wraps its per-frame work (reference lines, labels, weight, target) in a
// perContext() prep function and keeps evaluate() to plain arithmetic.

import { median, mean } from '../geometry.js';
import { MID_Y, OWN_GOAL, laneOf } from '../pitch.js';
import { ROLE_INFO } from '../roles.js';

const RAD2DEG = 180 / Math.PI;
const NONE = Symbol('none');

/**
 * Memoise `fn(ctx)` once per context object (WeakMap, so contexts can still be collected).
 * `fn` may return null, which is cached too.
 * @template T
 * @param {(ctx: object) => (T|null|undefined)} fn
 * @returns {(ctx: object) => (T|null)}
 */
export function perContext(fn) {
  const cache = new WeakMap();
  return (ctx) => {
    let v = cache.get(ctx);
    if (v === undefined) {
      v = fn(ctx) ?? NONE;
      cache.set(ctx, v);
    }
    return v === NONE ? null : v;
  };
}

/**
 * A rule's defaults merged with any override passed as buildContext params
 * `{ rules: { [ruleId]: {...} } }` (for tuning and tests). Call it inside a prep function.
 */
export function paramsFor(ctx, id, defaults) {
  const o = ctx.params?.rules?.[id];
  return o ? { ...defaults, ...o } : defaults;
}

/** Result for a rule evaluated where it does not apply (its weight is 0). */
export const notApplicable = () => ({ s: 1, vars: {} });

/**
 * Asymmetric soft band: 1 inside [lo, hi], falling linearly to 0 at `softLo`
 * metres below lo and `softHi` metres above hi. `band()` from geometry.js is the
 * symmetric case.
 */
export function band2(v, lo, hi, softLo, softHi) {
  if (v < lo) return softLo > 0 ? Math.max(0, 1 - (lo - v) / softLo) : 0;
  if (v > hi) return softHi > 0 ? Math.max(0, 1 - (v - hi) / softHi) : 0;
  return 1;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Signed angle in degrees (-180, 180] from vector u to vector v; positive when cross(u, v) > 0. */
export const signedAngle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * RAD2DEG;

/** Distance from point p to segment a-b, without allocating. */
export function segDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - abx * t, py - ay - aby * t);
}

/** Whole metres for feedback text (never -0, never NaN). */
export const whole = (v) => Math.round(v) || 0;

/** Upper-case the first letter of a sentence fragment. */
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------------------
// Moments, duties and units

/** True when our team is defending (out of possession, or a loose ball). Matches buildContext's duties. */
export const defending = (ctx) => ctx.moment !== 'in_possession';

export const isLearner = (ctx, p) => !!p && p.id === ctx.learner.id;

/** Unit (line) each family belongs to out of possession. */
export const UNIT_OF_FAMILY = Object.freeze({ GK: 'gk', CB: 'back', FB: 'back', DM: 'mid', CM: 'mid', W: 'front', ST: 'front' });

export const unitOfRole = (role) => UNIT_OF_FAMILY[ROLE_INFO[role]?.family] ?? 'mid';

export const isBackLiner = (ctx) => ctx.learner.family === 'CB' || ctx.learner.family === 'FB';

/**
 * Our outfield teammates (frame positions, learner excluded) grouped by unit, without the
 * first defender, who has stepped out of his line to press. Also each unit's median and mean x.
 * @returns {{ back: object[], mid: object[], front: object[], x: {back:number, mid:number, front:number}, meanX: {back:number, mid:number, front:number} }}
 */
export const unitsOf = perContext((ctx) => {
  const fdId = ctx.firstDefender?.id;
  const u = { back: [], mid: [], front: [] };
  for (const p of ctx.teammates) {
    if (p.id === fdId) continue;
    const unit = unitOfRole(p.role);
    if (u[unit]) u[unit].push(p);
  }
  const xs = (a) => a.map((p) => p.x);
  return {
    ...u,
    x: { back: median(xs(u.back)), mid: median(xs(u.mid)), front: median(xs(u.front)) },
    meanX: { back: mean(xs(u.back)), mid: mean(xs(u.mid)), front: mean(xs(u.front)) },
  };
});

/**
 * Height of our back line as the learner should read it (U4, R1): the x of the
 * centre-back nearest the ball who is not pressing. If the learner is that
 * centre-back, the median x of the other back-liners (they align to you).
 * Everyone at base; the first defender is ignored.
 * @returns {{ x:number, setter: object|null, learnerSets: boolean }|null} null if there is no back line: nobody but
 *   the first defender and the learner in it (only a reduced frame, js/engine/cast.js: a small game without the rest
 *   of the back line has no line to hold, and "in line with your other defenders" would name players nobody sees)
 */
export const backLineRef = perContext((ctx) => {
  const fdId = ctx.firstDefender?.id;
  const line = ctx.lines.ourBackLine.filter((p) => p.id !== fdId);
  if (!line.length) return null;
  let setter = null, best = Infinity;
  for (const p of line) {
    if (ROLE_INFO[p.role]?.family !== 'CB') continue;
    const d = Math.hypot(p.x - ctx.ball.x, p.y - ctx.ball.y);
    if (d < best) { best = d; setter = p; }
  }
  const learnerSets = isLearner(ctx, setter);
  if (setter && !learnerSets) return { x: setter.x, setter, learnerSets };
  const others = line.filter((p) => !isLearner(ctx, p));
  if (!others.length) return null;
  return { x: median(others.map((p) => p.x)), setter, learnerSets };
});

/**
 * Our offside line without the learner (IFAB Law 11; GK counts): the deepest and
 * second-deepest teammate x. An opponent in our half is offside if their x is below
 * min(second, ball.x).
 * @returns {{ last:number, second:number }}
 */
export const offsideLineWithoutLearner = perContext((ctx) => {
  const xs = ctx.teammates.map((p) => p.x).sort((a, b) => a - b);
  const last = xs[0] ?? 0;
  return { last, second: xs[1] ?? last };
});

/**
 * The opponent the #6 screens (R3): the non-GK, non-carrier opponent nearest our goal
 * among those in the three central lanes and goal-side of the ball. Falls back to
 * ctx.dangerousAttacker when it is goal-side of the ball; else null.
 */
export const centralThreat = perContext((ctx) => {
  let best = null, bd = Infinity;
  for (const o of ctx.opponents) {
    if (o.role === 'GK' || o === ctx.carrier || o.x >= ctx.ball.x - 1) continue;
    const lane = laneOf(o.y);
    if (lane === 0 || lane === 4) continue;
    const d = Math.hypot(o.x - OWN_GOAL.x, o.y - OWN_GOAL.y);
    if (d < bd) { bd = d; best = o; }
  }
  const da = ctx.dangerousAttacker;
  return best ?? (da && da.x < ctx.ball.x - 1 ? da : null);
});

/** True when the learner plays on the side away from the ball (ball side from ctx.ballSide). */
export const onFarSide = (ctx) => ctx.learner.side !== 'C' && ctx.ballSide !== 'C' && ctx.learner.side !== ctx.ballSide;

/** +1 if the ball is on our right half (y > 34), else -1. */
export const ballSign = (ctx) => (ctx.ball.y > MID_Y ? 1 : -1);

// ---------------------------------------------------------------------------
// Names for feedback text

const SIDE_WORD = { L: 'left', R: 'right' };
const KID_WORD = { GK: 'keeper', CB: 'defender', FB: 'defender', DM: 'midfielder', CM: 'midfielder', W: 'winger', ST: 'striker' };

/**
 * Football name for a player from the learner's point of view: 'their #9', 'their left winger',
 * 'your left-back', 'your centre-back partner' (when the learner is a CB), 'you', or 'the ball' for null.
 * Opponents' sides are their own ("their left winger" plays on our right).
 */
export function nameOf(p, ctx) {
  if (!p) return 'the ball';
  if (ctx && isLearner(ctx, p)) return 'you';
  const info = ROLE_INFO[p.role];
  const whose = p.team === 'us' ? 'your' : 'their';
  if (!info) return `${whose} ${p.team === 'us' ? 'teammate' : 'player'}`;
  const side = SIDE_WORD[info.side];
  switch (info.family) {
    case 'GK': return `${whose} keeper`;
    case 'CB':
      return p.team === 'us' && ctx?.learner.family === 'CB' ? 'your centre-back partner' : `${whose} ${side} centre-back`;
    case 'FB': return `${whose} ${side}-back`;
    case 'W': return `${whose} ${side} winger`;
    default: return `${whose} #${info.short}`;
  }
}

/** Kid-mode name: 'their striker', 'their winger', 'your teammate', 'you', 'the ball'. */
export function kidNameOf(p, ctx) {
  if (!p) return 'the ball';
  if (ctx && isLearner(ctx, p)) return 'you';
  if (p.team === 'us') return 'your teammate';
  return `their ${KID_WORD[ROLE_INFO[p.role]?.family] ?? 'player'}`;
}
