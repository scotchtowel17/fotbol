// Recovery run (T3, R4): when we have just lost the ball (or the scene is tagged a recovery), get back goal-side of
// your man, running toward our goal rather than the ball. A winger gets goal-side of the full-back on his flank (R4).
// The reference is the goal-side rule's (goalSideRef: your mark; a covering full-back's winger), so the two agree on
// whom you defend; while this rule applies the goal-side rule judges only your angle and distance, and the side is
// judged here, firmly: more than `criticalBehind` metres the wrong side of your man while he runs at our goal is a
// critical fail (a recovery run that never got back). The first defender is the press rule's (he presses the ball),
// and the #9 does not track back (goal-side weight 0, RESEARCH 5.6).
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §8 (T3, R4).

import { OWN_GOAL } from '../pitch.js';
import { perContext, paramsFor, notApplicable, recovering, nameOf, kidNameOf, band2, whole } from './_util.js';
import { goalSideRef } from './goal-side.js';

export const RECOVERY_DEFAULTS = Object.freeze({
  weights: Object.freeze({ CB: 2, FB: 3, DM: 2.5, CM: 2.5, W: 3, ST: 0 }), // [D] R4: the winger's own duty weighs most
  sideMargin: 1.5, // [D] metres nearer our goal than your man for full credit: a recovery gets properly goal-side
  sideSoft: 2.5, // [D] credit falls to 0 this far short of sideMargin (level with him scores 0.4)
  criticalBehind: 1, // [D] more than this many metres the wrong side of him is a critical fail
});

const prep = perContext((ctx) => {
  if (!recovering(ctx) || ctx.duty === 'first-defender') return null;
  const D = paramsFor(ctx, 'recovery', RECOVERY_DEFAULTS);
  const w = D.weights[ctx.learner.family] ?? 0;
  if (!(w > 0)) return null;
  const ref = goalSideRef(ctx);
  if (!ref) return null;
  const A = ctx.opponents.find((o) => o.id === ref.id);
  if (!A) return null;
  const la = Math.hypot(A.x - OWN_GOAL.x, A.y - OWN_GOAL.y);
  // Target: sideMargin + 1 m goal-side of him on his line to the middle of our goal.
  const back = D.sideMargin + 1;
  const ux = (OWN_GOAL.x - A.x) / (la || 1), uy = (OWN_GOAL.y - A.y) / (la || 1);
  return { D, w, A, la, tx: A.x + ux * back, ty: A.y + uy * back, who: nameOf(A, ctx), whoKid: kidNameOf(A, ctx) };
});

export default {
  id: 'recovery',
  principles: ['T3', 'R4'],
  critical: true,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const margin = p.la - Math.hypot(spot.x - OWN_GOAL.x, spot.y - OWN_GOAL.y); // > 0: nearer our goal than him
    const s = band2(margin, p.D.sideMargin, Infinity, p.D.sideSoft, 0);
    return {
      s,
      critical: margin < -p.D.criticalBehind,
      target: { x: p.tx, y: p.ty },
      vars: {
        who: p.who, whoKid: p.whoKid, margin, behind: whole(Math.max(0, -margin)),
        issue: s >= 0.999 ? 'ok' : margin < 0 ? 'wrong-side' : 'level',
        principle: ctx.learner.family === 'W' ? 'R4' : 'T3',
      },
    };
  },
  text: {
    standard: {
      name: 'Recovery run',
      ok: (v) => `You got back goal-side of ${v.who}.`,
      fail: (v) => (v.issue === 'wrong-side'
        ? `Sprint back toward our goal, not toward the ball, until you are goal-side of ${v.who}.`
        : `Keep running back so you are clearly goal-side of ${v.who}, not level with them.`),
      cue: (v) => `Who is running at our goal past you, and which way is our goal?`,
    },
    kid: {
      name: 'Race back',
      ok: () => 'Great run back, you beat your player home.',
      fail: (v) => (v.issue === 'wrong-side'
        ? `Run back toward our goal until you are past ${v.whoKid}.`
        : `Keep running back, a little past ${v.whoKid}.`),
      cue: () => 'Who is running at our goal?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    return p ? { type: 'player', id: p.A.id } : null;
  },
};
