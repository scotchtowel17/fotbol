// Drop and narrow (T2): while we recover (just lost the ball, or a recovery phase), the defenders who cannot pressure the
// ball do not chase it from behind: they get goal-side of it and narrow toward the middle, protecting the way to goal
// until help arrives. A defender with a man to mark only drops (where he marks is the recovery and goal-side rules'
// business). The first defender's part of T2 (backing off to 3-5 m when outnumbered) is the press rule's delay.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §8.4 (T2).

import { band } from '../geometry.js';
import { MID_Y } from '../pitch.js';
import { perContext, paramsFor, notApplicable, recovering, band2 } from './_util.js';
import { goalSideRef } from './goal-side.js';

export const DROP_NARROW_DEFAULTS = Object.freeze({
  weights: Object.freeze({ CB: 2, DM: 2, FB: 1.5 }), // [D] T2's families: the back line and the #6
  goalSide: 2, // [D] at least this far goal-side of the ball (x) for full credit...
  goalSideSoft: 3, // [D] ...falling to 0 this far short of it
  narrow: Object.freeze({ CB: 10, DM: 10, FB: 18 }), // [D] within this of the middle (y): the centre lane, a full-back the box's width
  narrowSoft: 4, // [D]
});

const prep = perContext((ctx) => {
  if (!recovering(ctx) || ctx.duty === 'first-defender') return null;
  const D = paramsFor(ctx, 'drop-narrow', DROP_NARROW_DEFAULTS);
  const fam = ctx.learner.family;
  const w0 = D.weights[fam] ?? 0;
  if (!w0) return null;
  return { D, w: w0, narrow: goalSideRef(ctx) ? Infinity : D.narrow[fam] }; // a marker only drops
});

export default {
  id: 'drop-narrow',
  principles: ['T2'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const { D } = p;
    const ahead = ctx.ball.x - spot.x; // > 0: goal-side of the ball
    const sDrop = band2(ahead, D.goalSide, Infinity, D.goalSideSoft, 0);
    const sNarrow = Number.isFinite(p.narrow) ? band(Math.abs(spot.y - MID_Y), 0, p.narrow, D.narrowSoft) : 1;
    const s = sDrop * sNarrow;
    const issue = s >= 0.999 ? 'ok' : sDrop <= sNarrow ? 'chasing' : 'wide';
    const ty = Number.isFinite(p.narrow) ? MID_Y + Math.sign(spot.y - MID_Y) * Math.min(Math.abs(spot.y - MID_Y), p.narrow) : spot.y;
    const target = { x: Math.min(spot.x, ctx.ball.x - D.goalSide), y: ty };
    return { s, target: s < 0.999 ? target : undefined, vars: { issue } };
  },
  text: {
    standard: {
      name: 'Drop and narrow',
      ok: () => 'You dropped goal-side of the ball and into the middle, so the counter is slowed down.',
      fail: (v) => (v.issue === 'chasing'
        ? "Don't chase the ball from behind: drop goal-side of it, toward our goal, until help arrives."
        : 'Narrow toward the middle, because while we get back the way to our goal is through the centre.'),
      cue: () => 'Can you still catch the ball, or should you get back between it and our goal?',
    },
    kid: {
      name: 'Slow Them Down',
      ok: () => 'Good, you got back and blocked the middle.',
      fail: (v) => (v.issue === 'chasing'
        ? "Don't chase from behind, run back toward our goal."
        : 'Move into the middle, in front of our goal.'),
      cue: () => 'Can you catch the ball, or should you run back?',
    },
  },
  cue(ctx) {
    return { type: 'line-x', x: ctx.ball.x };
  },
};
