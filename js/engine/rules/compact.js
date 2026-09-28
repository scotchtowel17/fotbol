// Compact (U1, U2), learner-level: keep the gap to the next line of the team
// under 15 m, and (back line and midfield) keep sensible gaps to the line-mates
// either side of you without crossing over them. A line-mate who has gone to press
// still closes his channel, so he counts as a neighbour. Not for the first defender,
// whose spot the press rule sets. The second defender's depth is the cover rule's (D3),
// but a back-liner who covers still keeps the gaps to his line-mates (U2), so covering
// never opens a hole in the back line (standing close to the presser he covers is not
// crowding); other covering players are not judged here.
// Team length and width are team-level checks and are not judged here.

import { perContext, paramsFor, notApplicable, defending, unitOfRole, unitsOf, nameOf, band2, whole } from './_util.js';

export const COMPACT_DEFAULTS = Object.freeze({
  weight: 2, // [S] RESEARCH 5.6
  lineGap: { back: [4, 15], mid: [4, 15], front: [2, 15] }, // [S] U1: ≤ 15 m to the next line; minimum depth [D]
  lineGapSoftLo: 3, // [D]
  lineGapSoftHi: 5, // [D]
  mateGapMin: 5, // [D] U2: closer than this and one attacker occupies you both
  mateGapNear: 12, // [D] U2: 8-12 m toward the ball
  mateGapFar: 15, // [D] U2 / RESEARCH 5.5: ≤ 15 m on the far side
  mateGapSoftLo: 3, // [D]
  mateGapSoftHi: 4, // [D]
});

// Which line each unit measures its vertical gap to, and which way "closer" is.
const NEXT_LINE = {
  back: { unit: 'mid', ahead: true, name: 'your midfield', kid: 'your midfielders' },
  mid: { unit: 'back', ahead: false, name: 'your back line', kid: 'your defenders' },
  front: { unit: 'mid', ahead: false, name: 'your midfield', kid: 'your midfielders' },
};

const prep = perContext((ctx) => {
  // The presser has left the lines; the second defender's depth is set by the cover rule (D3), and
  // only a covering back-liner keeps his horizontal gaps.
  if (!defending(ctx) || ctx.duty === 'first-defender') return null;
  const unit = unitOfRole(ctx.learner.role);
  const covering = ctx.duty === 'second-defender';
  if (covering && unit !== 'back') return null;
  const next = NEXT_LINE[unit];
  if (!next) return null;
  const D = paramsFor(ctx, 'compact', COMPACT_DEFAULTS);
  const units = unitsOf(ctx);
  const base = ctx.learner.base, ball = ctx.ball;
  // Vertical: gap measured so that positive = the normal order (the next line ahead of the back line, etc.).
  const lineX = units.x[next.unit];
  const vertical = Number.isFinite(lineX) && !covering ? { x: lineX, sign: next.ahead ? -1 : 1, range: D.lineGap[unit] } : null;
  // Horizontal (U2 is for the back line and midfield): the nearest line-mate either side of your base.
  // A line-mate who has gone to press still closes his channel, so he counts here (at the ball).
  let L = null, R = null;
  if (unit === 'back' || unit === 'mid') {
    const fd = ctx.firstDefender;
    const mates = fd && unitOfRole(fd.role) === unit ? [...units[unit], fd] : units[unit];
    for (const m of mates) {
      if (m.y <= base.y) { if (!L || m.y > L.y) L = m; }
      else if (!R || m.y < R.y) R = m;
    }
  }
  const hiL = ball.y < base.y ? D.mateGapNear : D.mateGapFar;
  const hiR = ball.y > base.y ? D.mateGapNear : D.mateGapFar;
  if (!vertical && !L && !R) return null;
  // Covering the presser means standing close to him (D3): no crowding check toward him, only the gap.
  const lo = (m) => (covering && m === ctx.firstDefender ? -Infinity : D.mateGapMin);
  return {
    D, w: D.weight, unit, next, vertical,
    L: L && { y: L.y, name: nameOf(L, ctx), hi: hiL, lo: lo(L) },
    R: R && { y: R.y, name: nameOf(R, ctx), hi: hiR, lo: lo(R) },
  };
});

export default {
  id: 'compact',
  principles: ['U1', 'U2'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const D = p.D;
    let sV = 1, sL = 1, sR = 1, vGap = 0, gL = 0, gR = 0, tx = spot.x, ty = spot.y;
    if (p.vertical) {
      const v = p.vertical;
      vGap = (spot.x - v.x) * v.sign;
      sV = band2(vGap, v.range[0], v.range[1], D.lineGapSoftLo, D.lineGapSoftHi);
      tx = v.x + v.sign * Math.min(Math.max(vGap, v.range[0]), v.range[1]);
    }
    let yLo = -Infinity, yHi = Infinity;
    if (p.L) {
      gL = spot.y - p.L.y;
      sL = band2(gL, p.L.lo, p.L.hi, D.mateGapSoftLo, D.mateGapSoftHi);
      yLo = p.L.y + p.L.lo; yHi = p.L.y + p.L.hi;
    }
    if (p.R) {
      gR = p.R.y - spot.y;
      sR = band2(gR, p.R.lo, p.R.hi, D.mateGapSoftLo, D.mateGapSoftHi);
      yLo = Math.max(yLo, p.R.y - p.R.hi); yHi = Math.min(yHi, p.R.y - p.R.lo);
    }
    // If both gaps can't be closed (a line-mate has gone to press), close the ball-side one first (U2).
    ty = yLo <= yHi ? Math.min(Math.max(spot.y, yLo), yHi) : p.R.hi < p.L.hi ? p.R.y - p.R.hi : p.L.y + p.L.hi;
    const s = sV * sL * sR;
    const vars = { ref: p.next.name, refKid: p.next.kid, unit: p.unit, gap: 0, max: 0, issue: 'ok' };
    if (s < 0.999) {
      const worst = Math.min(sV, sL, sR);
      if (worst === sV) {
        vars.issue = vGap > p.vertical.range[1] ? 'far-line' : 'close-line';
        vars.gap = whole(Math.abs(vGap)); vars.max = p.vertical.range[1];
      } else {
        // A negative gap means you have crossed over that line-mate (U2: slide, don't cross): say that first.
        const crossedL = p.L && gL < 0 && sL < 0.999, crossedR = p.R && gR < 0 && sR < 0.999;
        const useL = crossedL || (!crossedR && worst === sL);
        const side = useL ? p.L : p.R, g = useL ? gL : gR;
        vars.issue = g > side.hi ? 'gap' : g < 0 ? 'crossed' : 'crowd';
        vars.ref = side.name; vars.refKid = 'your teammate';
        vars.gap = whole(Math.abs(g)); vars.max = side.hi;
      }
      vars.principle = vars.issue === 'far-line' || vars.issue === 'close-line' ? 'U1' : 'U2';
    }
    return { s, target: { x: tx, y: ty }, vars };
  },
  text: {
    standard: {
      name: 'Stay compact',
      ok: () => 'You keep the gaps around you small, so there is no space to play through.',
      fail: (v) => ({
        'far-line': `${v.unit === 'back' ? 'Push up' : 'Drop'} to close the ${v.gap} m gap to ${v.ref}, and keep it under ${v.max} m so nobody can receive between the lines.`,
        'close-line': `${v.unit === 'back' ? 'Drop off' : 'Step up off'} ${v.ref} a few metres, because two lines stacked flat are beaten by one pass.`,
        gap: `Slide across toward ${v.ref}, because a gap of ${v.gap} m is big enough for a pass to split you.`,
        crowd: `Give ${v.ref} more room, because ${v.gap} m apart one attacker can occupy you both.`,
        crossed: `Slide back beside ${v.ref} rather than across them, because crossing over leaves your own channel empty.`,
      })[v.issue] ?? 'Keep the gaps to your teammates small.',
      cue: () => 'Where is the biggest gap around you that a pass could go through?',
    },
    kid: {
      name: 'Stay close together',
      ok: () => 'Good, you are close to your teammates with no big gaps.',
      fail: (v) => ({
        'far-line': `Move closer to ${v.refKid}, the gap is too big.`,
        'close-line': v.unit === 'back' ? `Stay a little further behind ${v.refKid}.` : `Stay a little further in front of ${v.refKid}.`,
        gap: `Slide toward ${v.refKid}, there is a big gap between you.`,
        crowd: `Give ${v.refKid} a little more room.`,
        crossed: `Don't swap places with ${v.refKid}, stay next to them.`,
      })[v.issue] ?? 'Stay close to your teammates.',
      cue: () => 'Where is the biggest gap between you and your teammates?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    return p?.vertical ? { type: 'line-x', x: p.vertical.x } : null;
  },
};
