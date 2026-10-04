// Line height (U3): the back line steps up when the ball goes backward (or the carrier is pressed and facing his own
// goal), holds while the ball is under pressure, and drops when the carrier is free and facing forward. Where the line
// stands is set by the centre-back nearest the ball (level-line, U4), so this rule judges two things only: stepping
// up, you do not sit more than stepTol deeper than your place in the shape; dropping, you are at least dropDepth
// goal-side of a free carrier facing forward, so a ball in behind has room to be dealt with. Holding: nothing here.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §8.6 (U3).

import { perContext, paramsFor, notApplicable, defending, isBackLiner, nameOf, band2, whole } from './_util.js';

export const LINE_HEIGHT_DEFAULTS = Object.freeze({
  weights: Object.freeze({ CB: 2.5, FB: 1.5 }), // [D] the centre-backs set it; the full-backs follow (level-line)
  stepTol: 2, // [D] stepping up: no deeper than this behind your place in the shape
  dropDepth: 10, // [D] dropping: at least this far goal-side of the carrier (x)
  dropReach: 25, // [D] ...judged while the carrier is within this of your place (beyond it there is room anyway)
  soft: 3, // [D]
});

const prep = perContext((ctx) => {
  if (!defending(ctx) || !isBackLiner(ctx) || ctx.duty === 'first-defender' || ctx.duty === 'second-defender') return null;
  const D = paramsFor(ctx, 'line-height', LINE_HEIGHT_DEFAULTS);
  const w = D.weights[ctx.learner.family] ?? 0;
  if (!w) return null;
  const c = ctx.carrier;
  const back = ctx.frame?.tags?.ballMovingBack === true;
  if (back || (ctx.pressureOnBall && ctx.carrierFacing === 'backward')) {
    return { D, w, mode: 'step', x: ctx.learner.base.x - D.stepTol, why: back ? 'back' : 'pressed' };
  }
  if (c && c.team === 'them' && !ctx.pressureOnBall && ctx.carrierFacing === 'forward' && c.x - ctx.learner.base.x <= D.dropReach) {
    return { D, w, mode: 'drop', x: ctx.ball.x - D.dropDepth, who: nameOf(c, ctx) };
  }
  return null;
});

export default {
  id: 'line-height',
  principles: ['U3'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    // step: x at least p.x; drop: x at most p.x
    const s = p.mode === 'step' ? band2(spot.x, p.x, Infinity, p.D.soft, 0) : band2(spot.x, -Infinity, p.x, 0, p.D.soft);
    const off = p.mode === 'step' ? p.x - spot.x : spot.x - p.x;
    return {
      s,
      target: s < 0.999 ? { x: p.x, y: spot.y } : undefined,
      vars: { mode: p.mode, issue: s >= 0.999 ? 'ok' : p.mode === 'step' ? 'deep' : 'high', by: Math.max(1, whole(off)), who: p.who, why: p.why },
    };
  },
  text: {
    standard: {
      name: 'Step, hold or drop',
      ok: (v) => (v.mode === 'step' ? 'You stepped up with the line as the ball went back.' : 'You dropped off the free carrier, so there is room to deal with a ball in behind.'),
      fail: (v) => (v.mode === 'step'
        ? `Step up about ${v.by} m with the line, because ${v.why === 'back' ? 'the ball went backward' : 'the carrier is pressed and facing away'} and nobody can play in behind you now.`
        : `Drop about ${v.by} m, because ${v.who} is free and facing forward and can play the ball in behind you.`),
      cue: () => 'Is the player on the ball free to play it forward, or is he under pressure?',
    },
    kid: {
      name: 'Forward or Back',
      ok: (v) => (v.mode === 'step' ? 'Good, you moved forward when the ball went back.' : 'Good, you moved back when they could pass forward.'),
      fail: (v) => (v.mode === 'step' ? 'Move forward with your defenders, the ball went back.' : 'Move back, they are free to pass behind you.'),
      cue: () => 'Can the player with the ball pass forward?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    return p ? { type: 'line-x', x: p.x } : null;
  },
};
