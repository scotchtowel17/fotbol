// Concentration (U7): with the ball in our defensive third, the players away from it protect the scoring area before
// any empty space out wide. The far winger comes in off the far wing lane; the far full-back stays within the width
// of the box; the #6 drops to the edge of the box on the ball side, in front of the defenders who guard the goal,
// blocking the pass inside and the cut-back. The press, the cover and the marks are other rules'; the far side's
// distances to the ball and its line-mates are tuck's (D4, U5); how far in front of the back line the #6 stands is
// the screen rule's (R3).
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §8.6 (U7).

import { band } from '../geometry.js';
import { MID_Y, LANE_EDGES, PENALTY_AREA, PENALTY_SPOT_DIST } from '../pitch.js';
import { perContext, paramsFor, notApplicable, defending, onFarSide, band2, clamp01 } from './_util.js';

export const CONCENTRATION_DEFAULTS = Object.freeze({
  weights: Object.freeze({ W: 2, FB: 2, DM: 2 }), // [D]
  thirdX: 35, // [D] the ball in our defensive third (x below this)...
  fade: 5, // [D] ...fading in over this many metres
  inside: 1, // [D] the far winger: at least this far inside the far wing lane's edge
  boxHalf: PENALTY_AREA.width / 2, // [S] the far full-back: within the box's width (20.16 m from the middle)
  edge: Object.freeze([PENALTY_AREA.depth, PENALTY_AREA.depth + 10]), // [D] the #6: from the edge of the box to 10 m in front of it (x)...
  ballSide: 4, // [D] ...on the ball side of the middle, or no more than this past it (y)
  soft: 3, // [D]
});


const prep = perContext((ctx) => {
  if (!defending(ctx) || ctx.duty === 'first-defender' || ctx.duty === 'second-defender') return null;
  const D = paramsFor(ctx, 'concentration', CONCENTRATION_DEFAULTS);
  const fam = ctx.learner.family;
  let w = D.weights[fam] ?? 0;
  if (!w) return null;
  const k = clamp01((D.thirdX - ctx.ball.x) / D.fade);
  if (!(k > 0)) return null;
  const b = ctx.ball;
  let job;
  if (fam === 'W' || fam === 'FB') {
    if (!onFarSide(ctx)) return null;
    job = fam === 'W' ? 'winger' : 'full-back';
  } else job = 'edge';
  w *= k;
  const farEdge = b.y > MID_Y ? LANE_EDGES[1] : LANE_EDGES[4]; // the far wing lane's inner edge
  return { D, w, job, farEdge, far: b.y > MID_Y ? -1 : 1 };
});

export default {
  id: 'concentration',
  principles: ['U7'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const { D } = p;
    let s, target;
    if (p.job === 'winger') {
      const inside = (p.farEdge - spot.y) * p.far; // > 0: inside the far wing lane's edge
      s = band2(inside, D.inside, Infinity, D.soft, 0);
      target = { x: spot.x, y: p.farEdge - p.far * D.inside };
    } else if (p.job === 'full-back') {
      s = band(Math.abs(spot.y - MID_Y), 0, D.boxHalf, D.soft);
      target = { x: spot.x, y: MID_Y + p.far * D.boxHalf };
    } else {
      // The ball side of the middle: toward the ball, up to the box's edge; ballSide metres past the middle at most.
      const toBall = -p.far; // +1: the ball is at larger y
      const v = (spot.y - MID_Y) * toBall; // > 0: on the ball side
      const sx = band(spot.x, D.edge[0], D.edge[1], D.soft);
      const sy = band(v, -D.ballSide, D.boxHalf, D.soft);
      s = sx * sy;
      target = { x: Math.min(Math.max(spot.x, D.edge[0]), D.edge[1]), y: MID_Y + toBall * Math.min(Math.max(v, -D.ballSide), D.boxHalf) };
    }
    return { s, target: s < 0.999 ? target : undefined, vars: { job: p.job, issue: s >= 0.999 ? 'ok' : 'wide' } };
  },
  text: {
    standard: {
      name: 'Protect the scoring area',
      ok: (v) => (v.job === 'edge' ? 'You dropped to the edge of the box on the ball side, blocking the pass inside and the cut-back.' : 'You came in to protect the space in front of our goal.'),
      fail: (v) => ({
        winger: 'Come in off the far touchline: with the ball near our goal, the space in front of it matters more than the space out wide.',
        'full-back': 'Tuck in to about the width of the box, because the danger is in front of our goal, not on the far touchline.',
        edge: 'Drop to the edge of our box on the ball side, in front of your defenders, to block the pass inside and the cut-back.',
      })[v.job],
      cue: () => 'Where is the most dangerous space when the ball is near our goal?',
    },
    kid: {
      name: 'Pack the Middle',
      ok: () => 'Good, you are guarding the space in front of our goal.',
      fail: (v) => (v.job === 'edge' ? 'Run back to the front of our box, on the ball side.' : 'Come in toward our goal, away from the sideline.'),
      cue: () => 'Where is the danger near our goal?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    if (!p) return null;
    return { type: 'point', x: PENALTY_SPOT_DIST, y: MID_Y };
  },
};
