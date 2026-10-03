// Half-space (P1): with our full-back (or another teammate) on the ball out wide from the middle third on, the
// ball-side #8 stands in the ball-side half-space, the channel between their full-back and centre-back, not out in the
// wing lane beside the ball and not in the middle with the #9. The height (between their lines) is the between-lines
// rule's (P2), so this rule judges only the channel. scene.js places the ball-side #8 there when his full-back has the
// ball (shareFlanks), so the learner's base and the ghost agree with it.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §8.3 (P1).

import { band } from '../geometry.js';
import { LANE_EDGES } from '../pitch.js';
import { wingDepth } from '../context.js';
import { perContext, paramsFor, notApplicable, nameOf, clamp01 } from './_util.js';

export const HALF_SPACE_DEFAULTS = Object.freeze({
  weight: 2.5, // [D] P1 is the ball-side #8's job in this moment
  from: 35, // [D] from the middle third on (the ball's x), fading in over `fade` metres
  fade: 5, // [D]
  inset: 1, // [D] stay this far inside each edge of the half-space for full credit
  soft: 3, // [D] credit falls to 0 this far outside it
});

const prep = perContext((ctx) => {
  if (ctx.moment !== 'in_possession' || ctx.duty === 'first-attacker' || ctx.learner.family !== 'CM') return null;
  const side = ctx.learner.side;
  if (side !== 'L' && side !== 'R') return null;
  const c = ctx.carrier;
  if (!c || c.team !== 'us' || c.id === ctx.learner.id) return null;
  const D = paramsFor(ctx, 'half-space', HALF_SPACE_DEFAULTS);
  // The ball out wide on your side, carried by a teammate out there, from the middle third on.
  const w = D.weight * Math.min(wingDepth(ctx.ball, side), wingDepth(c, side)) * clamp01((ctx.ball.x - D.from) / D.fade);
  if (!(w > 0)) return null;
  const lo = side === 'R' ? LANE_EDGES[3] : LANE_EDGES[1], hi = side === 'R' ? LANE_EDGES[4] : LANE_EDGES[2];
  return { D, w, side, lo, hi, who: nameOf(c, ctx) };
});

export default {
  id: 'half-space',
  principles: ['P1'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const { D, lo, hi, side } = p;
    const s = band(spot.y, lo + D.inset, hi - D.inset, D.soft);
    const wideSide = side === 'R' ? spot.y > hi - D.inset : spot.y < lo + D.inset;
    const issue = s >= 0.999 ? 'ok' : wideSide ? 'wide' : 'central';
    const y = Math.min(Math.max(spot.y, lo + D.inset), hi - D.inset);
    return { s, target: issue === 'ok' ? undefined : { x: spot.x, y }, vars: { issue, who: p.who } };
  },
  text: {
    standard: {
      name: 'Take the half-space',
      ok: () => 'You are in the channel between their full-back and centre-back, where neither can mark you easily.',
      fail: (v) => (v.issue === 'wide'
        ? `Come in off the wing into the channel between their full-back and centre-back, so ${v.who} can play the ball inside you.`
        : `Move across toward the ball into the channel between their full-back and centre-back, out of the middle.`),
      cue: () => 'Where is the gap between their full-back and their centre-back?',
    },
    kid: {
      name: 'Hard to Mark',
      ok: () => 'Good, you are in the gap between their defenders.',
      fail: (v) => (v.issue === 'wide'
        ? 'Come in from the sideline, into the gap between their defenders.'
        : 'Move toward the ball, into the gap between their defenders.'),
      cue: () => 'Where is the gap between their defenders?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    if (!p) return null;
    const y = (p.lo + p.hi) / 2, x = ctx.learner.base.x;
    return { type: 'segment', a: { x: x - 8, y }, b: { x: x + 8, y } };
  },
};
