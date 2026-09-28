// P2 Receive between the lines: once the ball is being progressed, the #8s and an
// inverted winger stand between the opponent midfield line and their back line, at
// least 3 m from the nearest opponent. Only while the ball is still behind their
// midfield line (once it is past it there is no "between" left to receive in), and not
// with the ball in a crossing position, where their midfield has dropped into the box and
// the #8s fill the box instead (P4, P10: box-fill.js).
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §5.5, §8.3 (P1, P2).

import { band } from '../geometry.js';
import { perContext, paramsFor, notApplicable, nameOf, clamp01 } from './_util.js';
import { crossing } from './box-fill.js';

export const BETWEEN_LINES_DEFAULTS = Object.freeze({
  weight: 2, // [D] RESEARCH 5.6
  progressionX: 35, // [D] "in progression": the ball is in the middle third or beyond
  minGap: 4, // [D] their lines must be at least this far apart to leave a "between"
  inset: 1, // [D] stay this far inside each of their lines
  soft: 4, // [D] height ramp
  minFree: 3, // [D] P2: at least this far from the nearest opponent
  freeSoft: 2, // [D]
  pastMidFade: 3, // [D] the rule fades out as the ball comes within this of their midfield line (and is off once level with it)
});

const prep = perContext((ctx) => {
  if (ctx.moment !== 'in_possession' || ctx.duty === 'first-attacker') return null;
  // #8s always; a winger only when someone else holds the width (an inverted winger).
  const { family } = ctx.learner;
  if (!(family === 'CM' || (family === 'W' && !ctx.widthHolder))) return null;
  const D = paramsFor(ctx, 'between-lines', BETWEEN_LINES_DEFAULTS);
  const { oppMidLineX: mid, oppBackLineX: back } = ctx.lines;
  if (ctx.ball.x < D.progressionX || !Number.isFinite(mid) || !Number.isFinite(back) || back - mid < D.minGap) return null;
  const w = D.weight * clamp01((mid - ctx.ball.x) / D.pastMidFade) * (1 - crossing(ctx.ball));
  if (!(w > 0)) return null;
  const lo = mid + D.inset;
  const names = Object.fromEntries(ctx.opponents.map((o) => [o.id, nameOf(o, ctx)]));
  return { D, w, lo, hi: Math.max(lo, back - D.inset), names };
});

const m = (v) => Math.max(1, Math.round(v));

export default {
  id: 'between-lines',
  principles: ['P2'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,

  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const { D, lo, hi } = p;
    const sX = band(spot.x, lo, hi, D.soft);
    let dOpp = Infinity, opp = null;
    for (const o of ctx.opponents) {
      const d = Math.hypot(o.x - spot.x, o.y - spot.y);
      if (d < dOpp) { dOpp = d; opp = o; }
    }
    const sFree = band(dOpp, D.minFree, Infinity, D.freeSoft);
    const part = sX <= sFree ? 'height' : 'free';

    let target;
    if (part === 'height' && sX < 1) target = { x: spot.x < lo ? lo : hi, y: spot.y };
    else if (part === 'free' && sFree < 1 && dOpp > 1e-6) {
      const k = D.minFree / dOpp;
      target = { x: opp.x + (spot.x - opp.x) * k, y: opp.y + (spot.y - opp.y) * k };
    }
    return {
      s: sX * sFree,
      target,
      vars: {
        part, lo, hi, x: spot.x,
        where: spot.x < lo ? 'deep' : spot.x > hi ? 'high' : 'in',
        dOpp, minFree: D.minFree,
        oppId: opp?.id ?? null, opp: (opp && p.names[opp.id]) || 'an opponent',
      },
    };
  },

  text: {
    standard: {
      name: 'Between the lines',
      ok: () => 'You are free between their midfield and back line, ready to receive and turn.',
      fail: (v) => {
        if (v.part === 'free') return `${v.opp[0].toUpperCase()}${v.opp.slice(1)} is only ${m(v.dOpp)} m from you, so find a pocket at least ${v.minFree} m from the nearest opponent.`;
        return v.where === 'deep'
          ? `Push up ${m(v.lo - v.x)} m beyond their midfield line so you can receive between the lines.`
          : `Drop ${m(v.x - v.hi)} m off their back line into the gap in front of it.`;
      },
      cue: () => 'Where is the gap between their midfield and their back line?',
    },
    kid: {
      name: 'Find the gap',
      ok: () => 'You found the gap between their lines!',
      fail: (v) => {
        if (v.part === 'free') return 'Move away from the nearest defender into free space.';
        return v.where === 'deep'
          ? `Move ${m(v.lo - v.x)} m forward, past their midfielders.`
          : `Come ${m(v.x - v.hi)} m back, in front of their defenders.`;
      },
      cue: () => 'Where is the space between their midfielders and defenders?',
    },
  },

  cue(ctx) {
    return { type: 'line-x', x: ctx.lines.oppMidLineX };
  },
};
