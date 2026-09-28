// B5 Lanes and lines (positional play): at most 2 players in your vertical lane and at
// most 3 on your horizontal line (±2.5 m), you included. Only teammates at a similar
// height share "your" lane, so a centre-back and the #9 are not stacked. Every
// membership is soft (lane edges blend over a metre or two) so the score is smooth.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §5.5, §8.2 (B5).

import { band } from '../geometry.js';
import { LANE_EDGES, LANE_NAMES, laneOf } from '../pitch.js';
import { perContext, paramsFor, notApplicable } from './_util.js';

export const OCCUPANCY_DEFAULTS = Object.freeze({
  weight: 2, // [D] RESEARCH 5.6
  maxInLane: 2, // [S] B5: at most 2 players per vertical lane (you included)
  maxOnLine: 3, // [S] B5: at most 3 players on one horizontal line (you included)
  lineBand: 2.5, // [D] ±x that counts as "the same line"
  lineSoft: 1.5, // [D]
  laneWindow: 20, // [D] teammates within this x-distance share your lane
  laneWindowSoft: 5, // [D]
  laneEdgeSoft: 1.5, // [D] your lane membership blends across an edge over ±this
  perExtra: 0.5, // [D] s lost per extra player in your lane or on your line
});

const NLANES = LANE_EDGES.length - 1;

const prep = perContext((ctx) => {
  if (ctx.moment !== 'in_possession' || ctx.duty === 'first-attacker' || ctx.learner.family === 'GK') return null;
  const D = paramsFor(ctx, 'occupancy', OCCUPANCY_DEFAULTS);
  // Outfield teammates with their (fixed) lane index.
  const mates = ctx.teammates.filter((q) => q.role !== 'GK').map((q) => ({ x: q.x, id: q.id, lane: laneOf(q.y) }));
  return { D, w: D.weight, mates };
});

/** Soft weights of y over its own lane k and the two neighbours: [prev, self, next]. */
function laneWeights(y, k, r) {
  const lo = LANE_EDGES[k], hi = LANE_EDGES[k + 1];
  const prev = k > 0 && y - lo < r ? 0.5 * (1 - (y - lo) / r) : 0;
  const next = k < NLANES - 1 && hi - y < r ? 0.5 * (1 - (hi - y) / r) : 0;
  return [prev, 1 - prev - next, next];
}

function crowding(p, spot) {
  const D = p.D;
  const counts = [0, 0, 0, 0, 0];
  let onLine = 0;
  const k = laneOf(spot.y);
  for (const q of p.mates) {
    const dx = Math.abs(q.x - spot.x);
    counts[q.lane] += band(dx, 0, D.laneWindow, D.laneWindowSoft);
    onLine += band(dx, 0, D.lineBand, D.lineSoft);
  }
  const w = laneWeights(spot.y, k, D.laneEdgeSoft);
  const excess = (j) => (j < 0 || j >= NLANES ? 0 : Math.max(0, counts[j] + 1 - D.maxInLane));
  const laneEx = w[0] * excess(k - 1) + w[1] * excess(k) + w[2] * excess(k + 1);
  const lineEx = Math.max(0, onLine + 1 - D.maxOnLine);
  return { k, counts, onLine, laneEx, lineEx };
}

const plural = (n, one, many) => (n === 1 ? one : many);

export default {
  id: 'occupancy',
  principles: ['B5'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,

  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const c = crowding(p, spot);
    const sLane = Math.max(0, 1 - p.D.perExtra * c.laneEx);
    const sLine = Math.max(0, 1 - p.D.perExtra * c.lineEx);
    const part = sLane <= sLine ? 'lane' : 'line';

    let target;
    if (part === 'lane' && sLane < 1) {
      // Step into the less crowded neighbouring lane, 2 m past its edge.
      const lower = c.k > 0 ? c.counts[c.k - 1] : Infinity;
      const upper = c.k < NLANES - 1 ? c.counts[c.k + 1] : Infinity;
      target = { x: spot.x, y: lower <= upper ? LANE_EDGES[c.k] - 2 : LANE_EDGES[c.k + 1] + 2 };
    }
    return {
      s: Math.min(sLane, sLine),
      target,
      vars: { part, lane: LANE_NAMES[c.k], inLane: Math.round(c.counts[c.k]) + 1, onLine: Math.round(c.onLine) + 1 },
    };
  },

  text: {
    standard: {
      name: 'Lanes and lines',
      ok: () => 'You take your own lane and line, which adds a new passing angle.',
      fail: (v) => {
        if (v.part === 'line') {
          const n = Math.max(1, v.onLine - 1);
          return `You are flat on a line with ${n} ${plural(n, 'teammate', 'teammates')}, so step off it to open a diagonal pass.`;
        }
        const n = Math.max(1, v.inLane - 1);
        return `The ${v.lane} already has ${n} ${plural(n, 'teammate', 'teammates')} near you, so move into a free lane to offer a new option.`;
      },
      cue: () => 'Which lanes and lines already have a teammate in them?',
    },
    kid: {
      name: 'Find your own space',
      ok: () => 'Nice, you found your own space!',
      fail: (v) => (v.part === 'line'
        ? 'You are in a flat line with teammates, so step forward or back.'
        : 'Too many teammates are in your lane, so move to an empty one.'),
      cue: () => 'Where are your teammates standing?',
    },
  },

  /** Beat-1 highlight: the nearest teammate (in x) sharing your lane at the judged spot. */
  cue(ctx, spot) {
    const p = prep(ctx);
    if (!p) return null;
    const at = spot ?? ctx.learner.base;
    const k = laneOf(at.y);
    let best = null, bd = Infinity;
    for (const q of p.mates) {
      const d = Math.abs(q.x - at.x);
      if (q.lane === k && d < bd) { bd = d; best = q; }
    }
    return best ? { type: 'player', id: best.id } : null;
  },
};
