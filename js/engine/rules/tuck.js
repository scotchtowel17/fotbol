// Tuck (D4, U5): with the ball in a wing lane, the far side narrows toward it.
// Far full-back: 8-15 m outside the far centre-back. Far centre-back: within about
// 12 m of the near one (or central if the near one has gone to the ball).
// Far #8 / winger: not too far sideways from the ball.

import { MID_Y } from '../pitch.js';
import { perContext, paramsFor, notApplicable, defending, onFarSide, ballSign, nameOf, kidNameOf, band2, whole } from './_util.js';

export const TUCK_DEFAULTS = Object.freeze({
  weights: { CB: 2, FB: 2, CM: 1.5, W: 1.5 }, // [S] back line 2 (RESEARCH 5.6); #8 and winger [D]
  fbGap: [8, 15], // [D] U5/R2: far FB 10-15 m outside the far CB (8 allows a flatter crescent)
  cbGap: [5, 12], // [D] U5/R1: far CB within about 12 m of the near CB
  centreGap: [-6, 4], // [D] far CB's distance outward from y = 34 when the near CB is the presser
  maxSideways: { CM: 25, W: 38 }, // [D] D4: ~25 m sideways from the ball; a far winger may hold the far half-space
  softIn: 3, // [D] metres too narrow where credit reaches 0
  softOut: 4, // [D] metres too wide where credit reaches 0
  softSideways: 6, // [D]
});

const prep = perContext((ctx) => {
  if (!defending(ctx) || !ctx.ballZone.wing || ctx.duty === 'first-defender' || !onFarSide(ctx)) return null;
  const D = paramsFor(ctx, 'tuck', TUCK_DEFAULTS);
  const fam = ctx.learner.family;
  const w = D.weights[fam] ?? 0;
  if (!w) return null;
  const out = -ballSign(ctx); // y direction away from the ball
  const find = (role) => ctx.teammates.find((t) => t.role === role) ?? null;
  const side = ctx.learner.side;
  let mode, ref = null, refY, lo, hi, soft = D.softIn;
  if (fam === 'FB') {
    ref = find(side + 'CB');
    if (!ref) return null;
    mode = 'partner'; refY = ref.y; [lo, hi] = D.fbGap;
  } else if (fam === 'CB') {
    ref = find((side === 'L' ? 'R' : 'L') + 'CB');
    if (!ref) return null;
    if (ref.id === ctx.firstDefender?.id) { mode = 'centre'; refY = MID_Y; [lo, hi] = D.centreGap; }
    else { mode = 'partner'; refY = ref.y; [lo, hi] = D.cbGap; }
  } else {
    // #8 / winger: sideways distance from the ball, measured outward from it.
    mode = 'ball'; refY = ctx.ball.y; lo = -Infinity; hi = D.maxSideways[fam] ?? 25; soft = D.softSideways;
  }
  const softHi = mode === 'ball' ? D.softSideways : D.softOut;
  const want = mode === 'ball' ? hi : mode === 'centre' ? 0 : (lo + hi) / 2;
  return {
    D, w, mode, out, refY, lo, hi, softLo: soft, softHi, want,
    ref: mode === 'ball' ? 'the ball' : nameOf(ref, ctx),
    refKid: mode === 'ball' ? 'the ball' : kidNameOf(ref, ctx),
    refId: ref?.id ?? null,
  };
});

export default {
  id: 'tuck',
  principles: ['D4', 'U5'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const gap = (spot.y - p.refY) * p.out; // how far outward (away from the ball) of the reference you are
    const s = band2(gap, p.lo, p.hi, p.softLo, p.softHi);
    const issue = gap > p.hi ? 'wide' : gap < p.lo ? 'narrow' : 'ok';
    const ty = p.refY + p.out * (issue === 'ok' ? gap : p.mode === 'ball' ? p.hi : p.want);
    return {
      s,
      target: { x: spot.x, y: ty },
      vars: { ref: p.ref, refKid: p.refKid, mode: p.mode, gap: whole(gap), want: whole(p.want), issue },
    };
  },
  text: {
    standard: {
      name: 'Tuck in on the far side',
      ok: () => 'You have tucked in toward the ball side, so the middle stays closed.',
      fail: (v) => {
        if (v.mode === 'ball') return `Tuck in toward the ball, because ${v.gap} m away from it you can't help close the middle.`;
        if (v.mode === 'centre') {
          return v.issue === 'wide'
            ? `Tuck into the middle, because ${v.ref} has gone to the ball and someone must guard the centre.`
            : `Don't follow the ball so far across, because ${v.ref} has gone to it and the centre needs you.`;
        }
        return v.issue === 'wide'
          ? `Tuck in to about ${v.want} m from ${v.ref}, because with the ball on the far wing the space out wide can wait.`
          : `Hold a little more width, about ${v.want} m from ${v.ref}, so the gap outside you doesn't open up.`;
      },
      cue: () => 'With the ball on the far wing, which part of your side of the pitch still needs guarding?',
    },
    kid: {
      name: 'Squeeze in',
      ok: () => 'Nice, you moved in toward the ball side.',
      fail: (v) => {
        if (v.mode === 'centre') return v.issue === 'narrow' ? 'Stay in the middle, your partner has gone to the ball.' : 'Move into the middle, your partner has gone to the ball.';
        return v.issue === 'narrow' ? 'Stay a little wider so there is no big hole beside you.' : 'Move in toward the middle, the ball is on the other side.';
      },
      cue: () => 'With the ball on the other wing, do you need to be so wide?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    if (!p) return null;
    return p.refId ? { type: 'player', id: p.refId } : { type: 'point', x: ctx.ball.x, y: ctx.ball.y };
  },
};
