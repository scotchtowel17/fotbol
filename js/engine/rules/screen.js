// Screen (R3): out of possession the #6 sits 5-10 m in front of the back line,
// in the centre lane, in the passing line from the ball to the most dangerous central
// attacker (within shadowDist of it: close enough to block the pass). When the whole
// block has slid toward the ball, "the centre lane" slides with the centre-backs (at
// most to the half-space: R3).

import { band, clamp, mean } from '../geometry.js';
import { LANE_EDGES, MID_Y } from '../pitch.js';
import { ROLE_INFO } from '../roles.js';
import { perContext, paramsFor, notApplicable, defending, unitsOf, centralThreat, nameOf, kidNameOf, band2, segDist, whole } from './_util.js';

export const SCREEN_DEFAULTS = Object.freeze({
  weight: 3, // [S] RESEARCH 5.6
  secondDefenderWeight: 1, // [D] a covering #6 is judged mainly by the cover rule
  ahead: [5, 10], // [M] R3: 5-10 m ahead of the back-line mean x (HELIOS median 7.3 m)
  aheadSoftLo: 3, // [D]
  aheadSoftHi: 5, // [D] Appendix A: tolerance allows up to 15 m
  laneSoft: 11, // [D] credit reaches 0 at the outer edge of the half-space (R3)
  laneSoftCovering: 20, // [D] a covering #6 may be pulled wider
  shadowDist: 1.5, // [D] within this of the ball-to-attacker line the pass is blocked (RESEARCH 5.8 cover shadow: 1.5 m;
  //                    5.5's 3 m let a #6 2.7 m off the line count as "in the passing line" while the pass went by)
  shadowSoft: 2.5, // [D] ...credit reaches 0 this far beyond it (4 m off the line)
  laneShiftMax: 11, // [D] R3: the screening lane follows the centre-backs' mid-point sideways by at most this (the half-space width)
});

const prep = perContext((ctx) => {
  if (!defending(ctx) || ctx.learner.family !== 'DM' || ctx.duty === 'first-defender') return null;
  const D = paramsFor(ctx, 'screen', SCREEN_DEFAULTS);
  const backX = unitsOf(ctx).meanX.back;
  if (!Number.isFinite(backX)) return null;
  const cbs = ctx.lines.ourBackLine.filter((p) => ROLE_INFO[p.role]?.family === 'CB');
  const shift = cbs.length ? clamp(mean(cbs.map((p) => p.y)) - MID_Y, -D.laneShiftMax, D.laneShiftMax) : 0;
  const CENTRE_LO = LANE_EDGES[2] + shift, CENTRE_HI = LANE_EDGES[3] + shift;
  const covering = ctx.duty === 'second-defender';
  const laneSoft = covering ? D.laneSoftCovering : D.laneSoft;
  const A = centralThreat(ctx);
  const b = ctx.ball;
  const wantX = backX + (D.ahead[0] + D.ahead[1]) / 2;
  // The lane to block: from the ball to the attacker, continued on to our back line (the ball
  // in behind him). Judged only if it crosses the screening depth somewhere a #6 can reach
  // from the middle; a lane that runs down the wing is for others.
  let lane = null;
  if (A && b.x > wantX) {
    let ex = A.x, ey = A.y;
    if (A.x > backX) {
      const t = (b.x - backX) / (b.x - A.x);
      ex = b.x + (A.x - b.x) * t;
      ey = b.y + (A.y - b.y) * t;
    }
    const tw = Math.min(Math.max((b.x - wantX) / (b.x - ex), 0), 1);
    const px = b.x + (ex - b.x) * tw, py = b.y + (ey - b.y) * tw;
    if (band(py, CENTRE_LO, CENTRE_HI, laneSoft) >= 0.5) lane = { ex, ey, px, py };
  }
  let tx = wantX, ty = Math.min(Math.max(b.y, CENTRE_LO), CENTRE_HI);
  if (lane) {
    // On the lane at the ideal depth, nudged back toward the centre lane while staying within shadowDist of it.
    tx = lane.px;
    const inside = Math.min(Math.max(lane.py, CENTRE_LO), CENTRE_HI) - lane.py;
    ty = lane.py + Math.min(Math.max(inside, -D.shadowDist), D.shadowDist);
  }
  return {
    D, w: covering ? D.secondDefenderWeight : D.weight, backX, covering, laneSoft, lo: CENTRE_LO, hi: CENTRE_HI,
    lane, bx: b.x, by: b.y, tx, ty,
    who: lane ? nameOf(A, ctx) : 'their forwards', whoKid: lane ? kidNameOf(A, ctx) : 'their forwards',
  };
});

export default {
  id: 'screen',
  principles: ['R3'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const D = p.D;
    const ahead = spot.x - p.backX;
    const sA = band2(ahead, D.ahead[0], D.ahead[1], D.aheadSoftLo, D.aheadSoftHi);
    const sL = band(spot.y, p.lo, p.hi, p.laneSoft);
    const off = p.lane ? segDist(spot.x, spot.y, p.bx, p.by, p.lane.ex, p.lane.ey) : 0;
    const sS = p.lane ? band2(off, -Infinity, D.shadowDist, 0, D.shadowSoft) : 1;
    const s = sA * sL * sS;
    let issue = 'ok';
    if (s < 0.999) {
      const worst = Math.min(sA, sL, sS);
      issue = worst === sA ? (ahead < D.ahead[0] ? 'deep' : 'high') : worst === sL ? 'wide' : 'lane';
    }
    return {
      s,
      target: { x: p.tx, y: p.ty },
      vars: { who: p.who, whoKid: p.whoKid, ahead: whole(ahead), off: whole(off), issue },
    };
  },
  text: {
    standard: {
      name: 'Screen the back line',
      ok: (v) => `You screen your back line from the middle, in the way of the pass into ${v.who}.`,
      fail: (v) => ({
        deep: 'Step up to about 7 m in front of your centre-backs, so you screen them instead of joining them.',
        high: 'Drop closer to your centre-backs, about 7 m in front of them, so no pass can be played into the space behind you.',
        wide: "Come back inside, because the #6 guards the middle and the wide areas belong to others.",
        lane: `Step into the passing line from the ball to ${v.who} so the pass into them is blocked.`,
      })[v.issue] ?? 'Sit in front of your centre-backs in the middle.',
      cue: () => 'Which pass would hurt your centre-backs most right now?',
    },
    kid: {
      name: 'Protect the middle',
      ok: () => 'Good, you are guarding the middle in front of your defenders.',
      fail: (v) => ({
        deep: 'Move forward a little, you are too close to your defenders.',
        high: 'Move back, to just in front of your defenders.',
        wide: 'Come back to the middle of the pitch.',
        lane: `Stand in the path between the ball and ${v.whoKid}.`,
      })[v.issue] ?? 'Stay in the middle, just in front of your defenders.',
      cue: () => 'Which pass would hurt us most right now?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    if (!p) return null;
    return p.lane
      ? { type: 'segment', a: { x: p.bx, y: p.by }, b: { x: p.lane.ex, y: p.lane.ey } }
      : { type: 'line-x', x: p.backX };
  },
};
