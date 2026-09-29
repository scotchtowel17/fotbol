// Goal-side (D5): stand between your opponent and the middle of our goal, leaning
// toward the ball, tight when they are near the ball or our goal and looser when
// play is far away (the line and zonal rules take over there). Critical when the
// opponent is inside our box and you are not goal-side of them. A full-back who covers
// (second defender) marks nobody, but must never end up on the wrong side of the winger
// on his flank (R2, D5): for him only the side is judged, at a lower weight. The first defender
// is judged here only with the carrier in our box, and only on the side, which keeps the in-box
// critical: elsewhere the press rule owns his distance, angle and side (including the curved run
// onto the carrier's inside, D2), so the same "get goal-side" is never said twice.

import { band } from '../geometry.js';
import { OWN_GOAL, inOwnBox } from '../pitch.js';
import { perContext, paramsFor, notApplicable, defending, nameOf, kidNameOf, band2, clamp01, signedAngle, whole } from './_util.js';

export const GOAL_SIDE_DEFAULTS = Object.freeze({
  weights: { CB: 3, FB: 3, DM: 2, CM: 2, W: 1.5, ST: 0 }, // [S] RESEARCH 5.6 back line 3, #6 2; CM/W [D]; the #9 doesn't track (5.6)
  firstDefenderWeight: 1, // [D] with the carrier in our box: only the side, so the in-box critical stays live (press judges the rest)
  coverSideWeight: 1.5, // [D] R2: a covering full-back stays goal-side of the winger on his flank (only the side is judged)
  sideMargin: 0.5, // [D] metres nearer our goal than the opponent for full credit
  sideSoft: 2, // [D] level with them (0 m) scores 0.75; 1.5 m the wrong side scores 0
  angleBall: 35, // [D] RESEARCH 5.5: up to 35° off the opponent-to-goal line on the ball side
  angleFar: 20, // [D] D5 leans toward the ball, so less is allowed on the other side
  angleLoose: 15, // [D] extra degrees allowed when the opponent is far from the ball
  angleSoft: 25, // [D]
  distMin: 1, // [D] D5: 1-3 m from them
  distMax: 3, // [D]
  distMaxBox: 2, // [D] D5 "tighter nearer goal": the limit at the penalty spot
  distSoft: 3, // [D]
  tightBall: 12, // [D] opponent within this of the ball: full marking distance applies
  looseBall: 30, // [D] opponent this far from the ball: loosest angle
  looseRate: 0.75, // [D] extra metres of marking distance per metre the opponent is beyond tightBall from the ball
  looseSoftRate: 0.5, // [D] the falloff widens by this share of the extra distance, so far-off marks stay forgiving
  distMaxLoose: 15, // [D] cap on that loose marking distance
  behindBall: 10, // [D] an opponent level with or behind the ball can't take a forward pass: count them this much further from it
  behindBallRamp: 5, // [D] metres behind the ball over which that allowance builds up
  nearGoal: 11, // [D] opponent this close to our goal: distMaxBox applies...
  farGoal: 30, // [D] ...relaxing fully by this distance
  ballShift: 1.5, // [D] D5: target shifted 1-2 m toward the ball
  ballOnLine: 1, // [D] ball within this of the opponent-to-goal line has no "ball side"
});

const prep = perContext((ctx) => {
  if (!defending(ctx)) return null;
  const D = paramsFor(ctx, 'goal-side', GOAL_SIDE_DEFAULTS);
  let A = ctx.markTarget, sideOnly = false;
  if (!A && ctx.duty === 'second-defender' && ctx.learner.family === 'FB') {
    // The covering full-back's reference: their winger on his flank (their right-sided roles play on our left).
    const role = (ctx.learner.side === 'L' ? 'R' : 'L') + 'W';
    const base = ctx.learner.base;
    A = ctx.opponents.find((o) => o.role === role && Math.hypot(o.x - base.x, o.y - base.y) <= ctx.params.markRadius) ?? null;
    sideOnly = !!A;
  }
  if (!A) return null;
  const first = ctx.duty === 'first-defender';
  if (first && !inOwnBox(A)) return null; // the press rule judges the first defender (D1, D2)
  if (first) sideOnly = true; // in our box: the side, and the critical
  const w = first ? D.firstDefenderWeight : sideOnly ? D.coverSideWeight : D.weights[ctx.learner.family] ?? 0;
  if (!w) return null;
  const gx = OWN_GOAL.x - A.x, gy = OWN_GOAL.y - A.y;
  const la = Math.hypot(gx, gy) || 1e-6;
  const ux = gx / la, uy = gy / la;
  const b = ctx.ball;
  const cr = ux * (b.y - A.y) - uy * (b.x - A.x); // signed distance of the ball from the opponent-to-goal line
  const ballSide = Math.abs(cr) < D.ballOnLine ? 0 : Math.sign(cr); // 0: ball on the line (or at their feet)
  const dBall = Math.hypot(b.x - A.x, b.y - A.y) + D.behindBall * clamp01((A.x - b.x) / D.behindBallRamp);
  const loose = clamp01((dBall - D.tightBall) / (D.looseBall - D.tightBall));
  const goalF = clamp01((la - D.nearGoal) / (D.farGoal - D.nearGoal));
  const hiLoose = Math.min(D.distMax + Math.max(0, dBall - D.tightBall) * D.looseRate, D.distMaxLoose);
  const hi = D.distMaxBox + (hiLoose - D.distMaxBox) * goalF;
  const lo = Math.min(D.distMin, hi);
  const distSoft = D.distSoft + Math.max(0, hi - D.distMax) * D.looseSoftRate;
  // Target: on the opponent-to-goal line at the learner's natural distance, leaning toward the ball.
  const baseDist = Math.hypot(ctx.learner.base.x - A.x, ctx.learner.base.y - A.y);
  const angBall = D.angleBall + D.angleLoose * loose, angFar = D.angleFar + D.angleLoose * loose;
  let along = Math.min(Math.max(baseDist, (D.distMin + D.distMax) / 2), hi);
  let shift = Math.min(D.ballShift * (1 - loose), along * Math.tan((0.8 * angBall * Math.PI) / 180)) * ballSide;
  const len = Math.hypot(along, shift);
  if (len > hi) { along *= hi / len; shift *= hi / len; } // keep the shifted target inside the distance band
  return {
    D, w, sideOnly, aid: A.id, ax: A.x, ay: A.y, ux, uy, la, ballSide, lo, hi, distSoft, angBall, angFar,
    inBox: inOwnBox(A),
    tx: A.x + ux * along - uy * shift, ty: A.y + uy * along + ux * shift,
    want: whole(Math.hypot(along, shift)), who: nameOf(A, ctx), whoKid: kidNameOf(A, ctx),
  };
});

/**
 * The opponent this rule judges you against (your mark; a covering full-back's winger on his flank; the carrier in our
 * box for the first defender), or null when the rule does not apply: { id, x, y, weight, sideOnly }. Player mode's right
 * area (kidscore.js) reads it for "the wrong side of your man", so the reference is worked out here only.
 * @param {object} ctx  from buildContext()
 * @returns {{ id: string, x: number, y: number, weight: number, sideOnly: boolean } | null}
 */
export function goalSideRef(ctx) {
  const p = prep(ctx);
  return p ? { id: p.aid, x: p.ax, y: p.ay, weight: p.w, sideOnly: p.sideOnly } : null;
}

export default {
  id: 'goal-side',
  principles: ['D5'],
  critical: true,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const D = p.D;
    const vx = spot.x - p.ax, vy = spot.y - p.ay;
    const dv = Math.hypot(vx, vy);
    const margin = p.la - Math.hypot(spot.x - OWN_GOAL.x, spot.y - OWN_GOAL.y); // > 0: nearer our goal than them
    const sSide = band2(margin, D.sideMargin, Infinity, D.sideSoft, 0);
    let psi = dv < 1e-6 ? 0 : signedAngle(p.ux, p.uy, vx, vy);
    psi = p.ballSide ? psi * p.ballSide : Math.abs(psi); // + = toward the ball side
    // Fade the angle in over the first metre so there is no cliff when passing right over them.
    const sAng = 1 - (1 - band2(psi, -p.angFar, p.angBall, D.angleSoft, D.angleSoft)) * Math.min(dv / D.distMin, 1);
    const sDist = band(dv, p.lo, p.hi, p.distSoft);
    const s = p.sideOnly ? sSide : sSide * sAng * sDist;
    let issue = 'ok';
    if (s < 0.999) {
      if (p.sideOnly || margin < 0 || sSide <= Math.min(sAng, sDist)) issue = 'wrong-side';
      else if (sAng <= sDist) issue = 'angle';
      else issue = dv > p.hi ? 'loose' : 'tight';
    }
    return {
      s,
      critical: p.inBox && margin < 0,
      target: { x: p.tx, y: p.ty },
      // margin (unrounded): m nearer our goal than them (< 0: the wrong side); kidscore.js reads it (never the score)
      vars: { who: p.who, whoKid: p.whoKid, dist: whole(dv), want: p.want, inBox: p.inBox, issue, margin },
    };
  },
  text: {
    standard: {
      name: 'Get goal-side',
      ok: (v) => `You are goal-side of ${v.who}, between them and the middle of our goal.`,
      fail: (v) => ({
        'wrong-side': v.inBox
          ? `Get goal-side of ${v.who} now, because in our box the wrong side gives them a free shot.`
          : `Get goal-side of ${v.who} so you are between them and the middle of our goal.`,
        angle: `Get onto the line between ${v.who} and the middle of our goal, leaning a little toward the ball.`,
        loose: `Tighten up to about ${v.want} m from ${v.who}, because at ${v.dist} m they can receive and turn.`,
        tight: `Give ${v.who} a metre more room so they can't spin round you.`,
      })[v.issue] ?? `Stay goal-side of ${v.who}.`,
      cue: (v) => `Where is ${v.who}, and which side of them is our goal?`,
    },
    kid: {
      name: 'Between them and goal',
      ok: () => 'Good, you are between your player and our goal.',
      fail: (v) => ({
        'wrong-side': `Get between ${v.whoKid} and our goal.`,
        angle: `Stand on the line from ${v.whoKid} to the middle of our goal.`,
        loose: `Get closer to ${v.whoKid}.`,
        tight: `Take a small step back from ${v.whoKid}.`,
      })[v.issue] ?? `Stay between ${v.whoKid} and our goal.`,
      cue: () => 'Who is your player, and where is our goal?',
    },
  },
  cue(ctx) {
    const id = ctx.markTarget?.id ?? prep(ctx)?.aid;
    return id ? { type: 'player', id } : null;
  },
};
