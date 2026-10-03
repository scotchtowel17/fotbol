// B1 Width: the designated width-holder (ctx.widthHolder: the winger by default, or
// whoever the scenario tags) stays within a few metres of their touchline. The
// far-side holder is judged more strictly: they must be wide for the switch, until
// the ball reaches the crossing zone on the other wing (P10: then they attack the box).
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §5.5, §8.2 (B1), §8.7 (R4).

import { band } from '../geometry.js';
import { WIDTH, MID_Y, LENGTH } from '../pitch.js';
import { widthDuty } from '../formation.js';
import { perContext, paramsFor, notApplicable } from './_util.js';

export const WIDTH_DEFAULTS = Object.freeze({
  weight: 3, // [D] RESEARCH 5.6
  maxFromLine: 5, // [D] B1: within 0-5 m of your touchline
  soft: 6, // [D] ramp when the ball is on your side or central
  softFar: 4, // [D] stricter when the ball is on the other side (the far winger holds the wing lane)
});

const prep = perContext((ctx) => {
  if (ctx.moment !== 'in_possession' || !ctx.widthHolder || ctx.duty === 'first-attacker' || ctx.learner.family === 'GK') return null;
  const D = paramsFor(ctx, 'width', WIDTH_DEFAULTS);
  const { side: s, base } = ctx.learner;
  const side = s === 'L' || s === 'R' ? s : base.y < MID_Y ? 'L' : 'R';
  const far = ctx.ballSide !== 'C' && ctx.ballSide !== side;
  // P10: with the ball in the far wing lane near the byline, the far winger attacks the box instead
  // (the same fade layer A uses, formation.js widthDuty()).
  const w = D.weight * widthDuty(ctx.ball, side);
  if (!(w > 0)) return null;
  return { D, w, side, far, soft: far ? D.softFar : D.soft, line: side === 'L' ? 0 : WIDTH };
});

const m = (v) => Math.max(1, Math.round(v));

export default {
  id: 'width',
  principles: ['B1', 'R4'], // R4: in possession the winger stays high and wide
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,

  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const max = p.D.maxFromLine;
    const d = p.side === 'L' ? spot.y : WIDTH - spot.y;
    const target = d > max ? { x: spot.x, y: p.side === 'L' ? max : WIDTH - max } : undefined;
    return { s: band(d, 0, max, p.soft), target, vars: { d, max, far: p.far, side: p.side } };
  },

  text: {
    standard: {
      name: 'Give width',
      ok: (v) => (v.far
        ? 'You hold the width on the far side, ready for a switch of play.'
        : 'You hold the width and stretch their back line.'),
      fail: (v) => (v.far
        ? `Stay wide on the far side: get ${m(v.d - v.max)} m closer to the touchline so a switch finds you in space.`
        : `Get ${m(v.d - v.max)} m wider, close to the touchline, to stretch their back line.`),
      cue: (v) => (v.far
        ? 'If the ball is switched to your side, who is out wide to receive it?'
        : 'Who is keeping the pitch wide on your side?'),
    },
    kid: {
      name: 'Stay wide',
      ok: () => 'Good, you stayed wide.',
      fail: () => 'Move wider, close to the sideline.',
      cue: () => 'Who is keeping our team wide on your side?',
    },
  },

  /** Beat-1 highlight: your touchline, alongside your base. */
  cue(ctx) {
    const p = prep(ctx);
    if (!p) return null;
    const x = ctx.learner.base.x;
    return { type: 'segment', a: { x: Math.max(0, x - 10), y: p.line }, b: { x: Math.min(LENGTH, x + 10), y: p.line } };
  },
};
