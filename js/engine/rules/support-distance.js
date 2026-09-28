// B4 Support distance depends on pressure, B3 options at different angles.
// Carrier pressed (opponent within ~3 m) or facing their own goal: the players near the
// ball (base within 15 m) come short, 5-10 m; the rest hold. Carrier free: players within
// 25 m stay 12-25 m away. Either way, don't stand on the same line from the ball as
// another supporter (keep >= 30 degrees between support lines). With the ball wide in the
// final third the #9 and the far winger attack the box instead (R5, P10: box-fill.js
// boxRunner()), so the rule fades out for them.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §5.5, §8.2 (B3, B4).

import { band, dist, rotate } from '../geometry.js';
import { perContext, paramsFor, notApplicable, nameOf } from './_util.js';
import { boxRunner } from './box-fill.js';

export const SUPPORT_DISTANCE_DEFAULTS = Object.freeze({
  weight: 2, // [D] RESEARCH 5.6
  applyRadius: 25, // [D] B4: players whose base is within this of the ball...
  applyRadiusPressured: 15, // [D] ...or within this when the carrier is pressed (the near players come short; the rest hold)
  pressured: Object.freeze({ lo: 5, hi: 10 }), // [D] B4: come short when the carrier is pressed or facing their own goal
  open: Object.freeze({ lo: 12, hi: 25 }), // [D] B4: stay away when the carrier has time
  soft: 4, // [D] distance ramp
  minAngle: 30, // [D] B3: degrees between your support line and any other supporter's
  angleSoft: 15, // [D] angle ramp
  angleShare: 0.35, // [D] share of s from the angle check (the rest is distance)
  angleFadeIn: 4, // [D] metres from the ball over which the angle check fades in (angles are unstable at the ball)
  supporterRadius: 30, // [D] teammates this close to the ball count as other supporters
});

const RAD = 180 / Math.PI;

const prep = perContext((ctx) => {
  if (ctx.moment !== 'in_possession' || ctx.duty === 'first-attacker' || ctx.learner.family === 'GK') return null;
  const D = paramsFor(ctx, 'support-distance', SUPPORT_DISTANCE_DEFAULTS);
  const { ball } = ctx;
  const pressured = ctx.pressureOnBall || ctx.carrierFacing === 'backward';
  if (dist(ctx.learner.base, ball) > (pressured ? D.applyRadiusPressured : D.applyRadius)) return null;
  const w = D.weight * (1 - boxRunner(ctx));
  if (!(w > 0)) return null;
  // Unit vectors from the ball to the other supporters.
  const mates = [];
  for (const q of ctx.teammates) {
    if (q.role === 'GK' || q.id === ctx.carrier?.id) continue;
    const d = dist(q, ball);
    if (d > 0.5 && d <= D.supporterRadius) mates.push({ ux: (q.x - ball.x) / d, uy: (q.y - ball.y) / d, id: q.id, name: nameOf(q, ctx) });
  }
  return { D, w, pressured, ...(pressured ? D.pressured : D.open), mates };
});

const m = (v) => Math.max(1, Math.round(v));

export default {
  id: 'support-distance',
  principles: ['B4', 'B3'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,

  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const { D, lo, hi } = p;
    const vx = spot.x - ctx.ball.x, vy = spot.y - ctx.ball.y;
    const d = Math.hypot(vx, vy);
    const sD = band(d, lo, hi, D.soft);

    let angle = 180, mate = null, cross = 0;
    if (d > 1e-6) {
      for (const q of p.mates) {
        const c = (vx * q.ux + vy * q.uy) / d;
        const a = Math.acos(c > 1 ? 1 : c < -1 ? -1 : c) * RAD;
        if (a < angle) { angle = a; mate = q; cross = q.ux * vy - q.uy * vx; }
      }
    }
    const sA = 1 - (1 - band(angle, D.minAngle, 180, D.angleSoft)) * Math.min(1, d / D.angleFadeIn);
    const part = sD <= sA ? 'distance' : 'angle';

    let target;
    if (part === 'distance' && sD < 1 && d > 1e-6) {
      const k = (d < lo ? lo : hi) / d;
      target = { x: ctx.ball.x + vx * k, y: ctx.ball.y + vy * k };
    } else if (part === 'angle' && sA < 1) {
      const r = rotate({ x: vx, y: vy }, (cross >= 0 ? 1 : -1) * (D.minAngle - angle));
      target = { x: ctx.ball.x + r.x, y: ctx.ball.y + r.y };
    }
    return {
      s: (1 - D.angleShare) * sD + D.angleShare * sA,
      target,
      vars: { d, lo, hi, pressured: p.pressured, angle, minAngle: D.minAngle, part, mateId: mate?.id ?? null, mate: mate?.name ?? 'a teammate' },
    };
  },

  text: {
    standard: {
      name: 'Support distance',
      ok: (v) => (v.pressured
        ? 'You are close enough to give the pressed carrier a short option.'
        : 'You support from a good distance without crowding the carrier.'),
      fail: (v) => {
        if (v.part === 'angle') return `You are on the same line from the ball as ${v.mate}, so find a new angle to give the carrier a second option.`;
        if (v.d < v.lo) return `You are crowding the carrier, so move ${m(v.lo - v.d)} m further away to give a freer option.`;
        return v.pressured
          ? `The carrier is under pressure, so come ${m(v.d - v.hi)} m closer to give a short option.`
          : `You are too far away to help, so come ${m(v.d - v.hi)} m closer to the carrier.`;
      },
      cue: () => 'How much pressure is the carrier under, and how close should you be?',
    },
    kid: {
      name: 'Be a passing option',
      ok: (v) => (v.pressured ? 'Nice, you came close to help!' : 'You are a good distance from the ball!'),
      fail: (v) => {
        if (v.part === 'angle') return 'Find your own angle, not in line with a teammate.';
        if (v.d < v.lo) return `Move ${m(v.lo - v.d)} m away to give the passer more room.`;
        return v.pressured
          ? `The passer is in trouble, so come ${m(v.d - v.hi)} m closer.`
          : `Come ${m(v.d - v.hi)} m closer so the passer can reach you.`;
      },
      cue: () => 'Is the passer in trouble, or do they have time?',
    },
  },

  cue(ctx) {
    return ctx.carrier ? { type: 'player', id: ctx.carrier.id } : { type: 'point', x: ctx.ball.x, y: ctx.ball.y };
  },
};
