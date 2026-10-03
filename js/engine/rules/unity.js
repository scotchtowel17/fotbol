// Offensive unity (B12): as the ball goes forward the back line and the #6 go with it, so the team stays connected
// and a lost ball is not played straight through an empty midfield. In possession, from the middle third on, stay
// within `maxGap` metres of our front line (the median of the wingers and the #9). How far forward is enough is the
// shape's (the zone); rest defence (P13: who stays back) is v2.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §8.2 (B12).

import { median } from '../geometry.js';
import { perContext, paramsFor, notApplicable, band2, clamp01, whole } from './_util.js';

export const UNITY_DEFAULTS = Object.freeze({
  weights: Object.freeze({ CB: 2, FB: 1.5, DM: 1.5 }), // [D] B12's families
  maxGap: 45, // [D] B12: the back line 35-45 m from the front line in possession
  soft: 6, // [D]
  fromX: 35, // [D] from the middle third on (the ball's x)...
  fade: 5, // [D] ...fading in over this many metres
});

const prep = perContext((ctx) => {
  if (ctx.moment !== 'in_possession' || ctx.duty === 'first-attacker') return null;
  const D = paramsFor(ctx, 'unity', UNITY_DEFAULTS);
  const w0 = D.weights[ctx.learner.family] ?? 0;
  if (!w0) return null;
  const k = clamp01((ctx.ball.x - D.fromX) / D.fade);
  if (!(k > 0)) return null;
  const front = ctx.teammates.filter((q) => q.role === 'LW' || q.role === 'ST' || q.role === 'RW');
  if (!front.length) return null;
  return { D, w: w0 * k, frontX: median(front.map((q) => q.x)) };
});

export default {
  id: 'unity',
  principles: ['B12'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const gap = p.frontX - spot.x;
    const s = band2(gap, -Infinity, p.D.maxGap, 0, p.D.soft);
    return { s, target: s < 0.999 ? { x: p.frontX - p.D.maxGap, y: spot.y } : undefined, vars: { gap: whole(gap), max: p.D.maxGap, issue: s >= 0.999 ? 'ok' : 'deep' } };
  },
  text: {
    standard: {
      name: 'Move up with the attack',
      ok: () => 'You moved up with the attack, so the team stays connected.',
      fail: (v) => `Push up: you are ${v.gap} m behind our front line, so a lost ball would go straight through the gap; stay within about ${v.max} m.`,
      cue: () => 'How far are you from our front players?',
    },
    kid: {
      name: 'Defenders Move Up Too',
      ok: () => 'Good, you moved forward with the team.',
      fail: () => 'Move forward with your team.',
      cue: () => 'Are you close enough to your teammates in front?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    return p ? { type: 'line-x', x: p.frontX - p.D.maxGap } : null;
  },
};
