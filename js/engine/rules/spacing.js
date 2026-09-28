// F8 Keep sensible spacing: your nearest outfield teammate is 6-18 m away, so one
// opponent cannot mark two of you and you stay connected. Low weight.
// In possession the players whose job is to stretch the team (the width-holders, B1, and
// the #9 pinning their back line, B2) are only held to the minimum.
// Out of possession (and with a loose ball) only the maximum applies: "one opponent can mark
// you both" is an attacking idea, and defenders stand close to a teammate on purpose (the
// cover at D3 distance, a double-up on a winger, a compact bank, centre-backs packed in the
// six-yard box on a cross), while the compact rule keeps line-mates apart (U2). The first
// defender goes to the ball wherever the others are, so he is not judged here at all.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §5.2 (HELIOS shape), §8.1 (F8).

import { band } from '../geometry.js';
import { perContext, paramsFor, notApplicable, defending, nameOf } from './_util.js';

export const SPACING_DEFAULTS = Object.freeze({
  weight: 1, // [D] RESEARCH 5.6
  min: 6, // [M] HELIOS nearest-teammate p10 is 6.2 m (in possession only)
  max: 18, // [M] HELIOS p90 is 16.8 m
  soft: 4, // [D]
});

const prep = perContext((ctx) => {
  if (ctx.learner.family === 'GK') return null;
  const out = defending(ctx);
  if (out && ctx.duty === 'first-defender') return null;
  const D = paramsFor(ctx, 'spacing', SPACING_DEFAULTS);
  const mates = ctx.teammates.filter((q) => q.role !== 'GK').map((q) => ({ x: q.x, y: q.y, id: q.id, name: nameOf(q, ctx) }));
  const stretcher = ctx.moment === 'in_possession' && (ctx.widthHolder || ctx.learner.family === 'ST');
  return mates.length ? { D, w: D.weight, mates, min: out ? 0 : D.min, max: stretcher ? Infinity : D.max } : null;
});

/** Nearest outfield teammate to a point, and the distance. */
function nearestMate(p, at) {
  let best = null, d = Infinity;
  for (const q of p.mates) {
    const dd = Math.hypot(q.x - at.x, q.y - at.y);
    if (dd < d) { d = dd; best = q; }
  }
  return { mate: best, d };
}

const m = (v) => Math.max(1, Math.round(v));

export default {
  id: 'spacing',
  principles: ['F8'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,

  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const { D, min, max } = p;
    const { mate, d } = nearestMate(p, spot);
    const s = band(d, min, max, D.soft);
    let target;
    if (s < 1 && d > 1e-6) {
      const k = (d < min ? min : max) / d;
      target = { x: mate.x + (spot.x - mate.x) * k, y: mate.y + (spot.y - mate.y) * k };
    }
    return { s, target, vars: { d, min, max, mateId: mate.id, mate: mate.name } };
  },

  text: {
    standard: {
      name: 'Keep your spacing',
      ok: (v) => (v.min > 0 ? 'You keep a good distance from your nearest teammate.' : 'You stay close enough to your teammates to help them.'),
      fail: (v) => (v.d < v.min
        ? `You are only ${m(v.d)} m from ${v.mate}, so spread out so one opponent cannot mark you both.`
        : `You are ${m(v.d)} m from your nearest teammate, so close the gap to stay connected to the team.`),
      cue: () => 'How far are you from your nearest teammate?',
    },
    kid: {
      name: 'Spread out',
      ok: (v) => (v.min > 0 ? 'You have good spacing from your teammates!' : 'Good, you stay close to your team.'),
      fail: (v) => (v.d < v.min
        ? 'You are too close to a teammate, so spread out.'
        : 'You are too far from your team, so move closer.'),
      cue: () => 'How far away is your closest teammate?',
    },
  },

  /** Beat-1 highlight: the nearest outfield teammate to the judged spot (or your base). */
  cue(ctx, spot) {
    const p = prep(ctx);
    if (!p) return null;
    const { mate } = nearestMate(p, spot ?? ctx.learner.base);
    return { type: 'player', id: mate.id };
  },
};
