// Block height (U6): in a mid or low block the team defends in two compact banks with its front players near halfway
// (mid) or in our half (low), blocking the central passes; a forward or #8 who stays high up the pitch past the ball
// leaves a gap behind him that one pass exploits. Out of possession in a mid or low block (context.js blockHeight),
// a winger, #8 or #9 who is not pressing stands no further forward than the ball plus `past`, or the block's front
// line (halfway plus `frontPast` in a mid block, `lowFront` in a low one), whichever is further forward. In a high
// block the front line presses up the pitch: the #9 and the wingers (the first defender too) stay within `highDrop`
// metres goal-side of the ball, not dropping off it (how they press is the press rule's).
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §8.6 (U6).

import { HALF_X } from '../pitch.js';
import { perContext, paramsFor, notApplicable, defending, band2, whole } from './_util.js';

export const BLOCK_HEIGHT_DEFAULTS = Object.freeze({
  weights: Object.freeze({ W: 2, CM: 1.5, ST: 1.5 }), // [D] the front players of the block
  past: Object.freeze({ W: 1, CM: 2, ST: 4 }), // [D] at most this far past the ball (the #9 stays a little higher, the outlet)...
  frontPast: 3, // [D] ...or, in a mid block, up to this far past halfway (U6: the front line near halfway)...
  lowFront: 40, // [D] ...or, in a low block, up to this x (our half)
  highDrop: 8, // [D] in a high block the #9 and the wingers stay within this far goal-side of the ball
  soft: 4, // [D]
});

const prep = perContext((ctx) => {
  if (!defending(ctx)) return null;
  const D = paramsFor(ctx, 'block-height', BLOCK_HEIGHT_DEFAULTS);
  const fam = ctx.learner.family;
  const w = D.weights[fam] ?? 0;
  if (!w) return null;
  if (ctx.blockHeight === 'high') {
    if (fam !== 'ST' && fam !== 'W') return null;
    return { D, w, x: ctx.ball.x - D.highDrop, block: 'high', high: true };
  }
  if (ctx.duty === 'first-defender') return null;
  const front = ctx.blockHeight === 'mid' ? HALF_X + D.frontPast : D.lowFront;
  return { D, w, x: Math.max(ctx.ball.x + D.past[fam], front), block: ctx.blockHeight, high: false };
});

export default {
  id: 'block-height',
  principles: ['U6'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    // mid/low: no further forward than p.x; high: no deeper than p.x
    const s = p.high ? band2(spot.x, p.x, Infinity, p.D.soft, 0) : band2(spot.x, -Infinity, p.x, 0, p.D.soft);
    const issue = s >= 0.999 ? 'ok' : p.high ? 'deep' : 'high';
    return { s, target: s < 0.999 ? { x: p.x, y: spot.y } : undefined, vars: { block: p.block, issue, by: Math.max(1, whole(Math.abs(spot.x - p.x))) } };
  },
  text: {
    standard: {
      name: 'Hold the block',
      ok: (v) => ({
        high: '', // the press says it (ARCHITECTURE §5.5: ok() may say nothing)
        mid: 'You hold the front of our mid block, level with the ball, so no pass goes in behind you.',
        low: 'You stay in our low block, in front of our midfield.',
      })[v.block],
      fail: (v) => (v.block === 'high'
        ? `Push up about ${v.by} m: in a high block the front line presses their defenders, so don't drop off the ball.`
        : `Come back about ${v.by} m: in a ${v.block} block you stay level with the ball or in front of our midfield, not high up the pitch with a gap behind you.`),
      cue: (v) => ({
        high: 'Where does our front line press from when we defend high?',
        mid: 'Where is the front of our block when we sit in midfield?',
        low: 'Where is the front of our block when we sit deep?',
      })[v.block],
    },
    kid: {
      name: 'High, Middle or Low',
      ok: (v) => (v.block === 'high' ? '' : 'Good, you stay with the team, level with the ball.'),
      fail: (v) => (v.block === 'high' ? 'Move forward, close to their defenders.' : 'Come back, level with the ball and close to your team.'),
      cue: () => 'Where is the front of our team now?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    return p ? { type: 'line-x', x: p.x } : null;
  },
};
