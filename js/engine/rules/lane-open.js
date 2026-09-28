// B3 Support: a supporting player needs a clear passing lane, i.e. no opponent within
// ~1.5 m of the line from the ball to them (a defender tight to the receiver also
// counts, since they can step in). v2 replaces this with a time-to-intercept lane
// probability (RESEARCH 5.8). With the ball wide in the final third the #9 and the far
// winger are box runners, not ground-pass options, and a centre-back beside them is
// normal (R5, P10: box-fill.js boxRunner()), so the rule fades out for them.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §5.5, §8.2 (B3), §8.3 (P2).

import { band, dist } from '../geometry.js';
import { perContext, paramsFor, notApplicable, nameOf } from './_util.js';
import { boxRunner } from './box-fill.js';

export const LANE_OPEN_DEFAULTS = Object.freeze({
  weight: 3, // [D] RESEARCH 5.6
  applyRadius: 35, // [D] only supporting players whose base is this close to the ball
  clear: 1.5, // [D] B3: no opponent within this distance of the pass line
  soft: 1.5, // [D] s reaches 0 when an opponent is this much closer than `clear`
  ballSkip: 1, // [D] ignore the first metre of the lane (the carrier's own space)
  maxShift: 8, // [D] cap on the suggested sideways slide (target)
});

const prep = perContext((ctx) => {
  if (ctx.moment !== 'in_possession' || ctx.duty === 'first-attacker' || ctx.learner.family === 'GK') return null;
  const D = paramsFor(ctx, 'lane-open', LANE_OPEN_DEFAULTS);
  if (dist(ctx.learner.base, ctx.ball) > D.applyRadius) return null;
  const w = D.weight * (1 - boxRunner(ctx));
  if (!(w > 0)) return null;
  const names = Object.fromEntries(ctx.opponents.map((o) => [o.id, nameOf(o, ctx)]));
  return { D, w, names };
});

/** Closest approach of any opponent to the lane ball → spot, skipping the first `skip` metres. */
function laneGap(ctx, spot, skipMax) {
  const bx = ctx.ball.x, by = ctx.ball.y;
  const L = Math.hypot(spot.x - bx, spot.y - by);
  if (L < 1e-6) return { gap: Infinity, blocker: null, along: 0, side: 0, L };
  const ux = (spot.x - bx) / L, uy = (spot.y - by) / L;
  const skip = Math.min(skipMax, L / 2);
  const ax = bx + ux * skip, ay = by + uy * skip, seg = L - skip;
  let gap = Infinity, blocker = null, along = 0, side = 0;
  for (const o of ctx.opponents) {
    const ox = o.x - ax, oy = o.y - ay;
    let t = ox * ux + oy * uy;
    t = t < 0 ? 0 : t > seg ? seg : t;
    const d = Math.hypot(ox - ux * t, oy - uy * t);
    if (d < gap) { gap = d; blocker = o; along = (t + skip) / L; side = ux * oy - uy * ox; }
  }
  return { gap, blocker, along, side, L };
}

export default {
  id: 'lane-open',
  principles: ['B3'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,

  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const D = p.D;
    const { gap, blocker, along, side, L } = laneGap(ctx, spot, D.ballSkip);
    const s = band(gap, D.clear, Infinity, D.soft);
    let target;
    if (s < 1 && blocker) {
      // Slide sideways, away from the blocker; a blocker near the ball needs a bigger slide.
      const nx = -(spot.y - ctx.ball.y) / L, ny = (spot.x - ctx.ball.x) / L; // left normal of the lane
      const away = side > 0 ? -1 : 1;
      const shift = Math.min(D.maxShift, (D.clear - gap + 0.5) / Math.max(along, 0.3));
      target = { x: spot.x + nx * away * shift, y: spot.y + ny * away * shift };
    }
    return {
      s,
      target,
      vars: { gap, blockerId: blocker?.id ?? null, blocker: (blocker && p.names[blocker.id]) || 'a defender' },
    };
  },

  text: {
    standard: {
      name: 'Open passing lane',
      ok: () => 'The passing lane from the ball to you is clear.',
      fail: (v) => `${v.blocker[0].toUpperCase()}${v.blocker.slice(1)} can cut out the pass to you, so step out of their cover shadow into a clear lane.`,
      cue: () => 'Could the ball reach you without an opponent cutting it out?',
    },
    kid: {
      name: 'Get open',
      ok: () => 'The ball has a clear path to you.',
      fail: () => 'Step away from the defender blocking the pass to you.',
      cue: () => 'Can the ball get to you, or is someone in the way?',
    },
  },

  /** Beat-1 highlight: the lane itself when the spot is known, otherwise the carrier. */
  cue(ctx, spot) {
    if (spot) return { type: 'segment', a: { x: ctx.ball.x, y: ctx.ball.y }, b: { x: spot.x, y: spot.y } };
    return ctx.carrier ? { type: 'player', id: ctx.carrier.id } : { type: 'point', x: ctx.ball.x, y: ctx.ball.y };
  },
};
