// Level line (U4, R1): back-liners hold the height set by the centre-back nearest
// the ball. The one exception is the second defender's deliberate covering drop.

import { perContext, paramsFor, notApplicable, defending, isBackLiner, backLineRef, nameOf, band2, whole } from './_util.js';

export const LEVEL_LINE_DEFAULTS = Object.freeze({
  weight: 3, // [S] RESEARCH 5.6
  tol: 2, // [D] RESEARCH 5.5 / U4: within ±2 m of the line
  soft: 3, // [D] metres beyond tol where credit reaches 0
  coverDrop: 8, // [D] U4 exception: a covering second defender may sit this far behind the line
});

const prep = perContext((ctx) => {
  if (!defending(ctx) || !isBackLiner(ctx) || ctx.duty === 'first-defender') return null;
  const ref = backLineRef(ctx);
  if (!ref) return null;
  const D = paramsFor(ctx, 'level-line', LEVEL_LINE_DEFAULTS);
  const covering = ctx.duty === 'second-defender';
  return {
    D, w: D.weight, x: ref.x, lo: covering ? -D.coverDrop : -D.tol, hi: D.tol, covering,
    ref: ref.learnerSets || !ref.setter ? 'the rest of your back line' : nameOf(ref.setter, ctx),
  };
});

export default {
  id: 'level-line',
  principles: ['U4'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const dx = spot.x - p.x;
    const s = band2(dx, p.lo, p.hi, p.D.soft, p.D.soft);
    const issue = dx < p.lo ? 'deep' : dx > p.hi ? 'high' : 'ok';
    // A covering drop keeps its depth; everyone else should be on the line itself.
    const tx = p.covering ? p.x + Math.min(Math.max(dx, p.lo), p.hi) : p.x;
    return {
      s,
      target: { x: tx, y: spot.y },
      vars: { ref: p.ref, off: whole(Math.abs(dx)), covering: p.covering, issue },
    };
  },
  text: {
    standard: {
      name: 'Hold a level line',
      ok: (v) => `You hold the line level with ${v.ref}.`,
      fail: (v) => ({
        deep: v.covering
          ? `Step up toward ${v.ref}, because a covering drop of ${v.off} m leaves too much room between you and the line.`
          : `Step up ${v.off} m to get level with ${v.ref}, so the line stays flat.`,
        high: `Drop ${v.off} m to get level with ${v.ref}, or a ball over the top gets in behind you.`,
      })[v.issue] ?? `Get level with ${v.ref}.`,
      cue: () => 'Who is setting the height of your back line right now?',
    },
    kid: {
      name: 'Stay in line',
      ok: () => 'Good, you are in line with your other defenders.',
      fail: (v) => ({
        deep: 'Step up so you are in line with your other defenders.',
        high: 'Drop back so you are in line with your other defenders.',
      })[v.issue] ?? 'Stay in line with your other defenders.',
      cue: () => 'Where is the rest of your back line?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    return p ? { type: 'line-x', x: p.x } : null;
  },
};
