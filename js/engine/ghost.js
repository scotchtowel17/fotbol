// Layer C: the ghost (best spot near the base position) and the heatmap field, both
// from one grid of full-score evaluations.
// Contract: docs/ARCHITECTURE.md §5.6. Rationale: docs/RESEARCH.md §5.7.
//
// The grid is aligned on the base (so the base itself is always a candidate) and
// cropped to the pitch. Every cell of the square fills the heatmap; the argmax only
// considers cells within `radius` of the base (about 700 on a 1 m grid). Ranking uses
// the unrounded score; ties go to the candidate nearest the base.

import { clampToPitch, LENGTH, WIDTH, MID_Y } from './pitch.js';
import { createScorer, evaluate, toleranceFor } from './score.js';

export const GHOST_DEFAULTS = Object.freeze({
  radius: 15, // [D] RESEARCH 5.7: search within 15 m of the layer-A target
  step: 1, // [D] grid spacing, metres
  tieEps: 1e-9, // scores closer than this count as equal
});

/**
 * @param {object} ctx  from buildContext()
 * @param {{ base?: {x:number,y:number}, tol?: {tx:number,ty:number}, radius?: number, step?: number, rules?: object[] }} [opts]
 *   base defaults to ctx.learner.base and is also the zone centre; tol to the role
 *   tolerance; rules to the v1 registry.
 * @returns {{ spot: {x:number,y:number}, score: number,
 *             field: { x0:number, y0:number, step:number, cols:number, rows:number, values: Float32Array },
 *             result: object }}
 *   `score` is the integer score at the ghost; `field.values` holds unrounded scores
 *   (0..100), row-major with rows along y; `result` is evaluate() at the ghost.
 */
export function computeGhost(ctx, { base, tol, radius = GHOST_DEFAULTS.radius, step = GHOST_DEFAULTS.step, rules } = {}) {
  const b = clampToPitch(base ?? ctx.learner.base);
  const t = tol ?? toleranceFor(ctx.learner.role);
  const scoreAt = createScorer(ctx, { center: b, tol: t, rules });

  const n = Math.floor(radius / step + 1e-9);
  const iMin = Math.max(-n, Math.ceil(-b.x / step - 1e-9)), iMax = Math.min(n, Math.floor((LENGTH - b.x) / step + 1e-9));
  const jMin = Math.max(-n, Math.ceil(-b.y / step - 1e-9)), jMax = Math.min(n, Math.floor((WIDTH - b.y) / step + 1e-9));
  const cols = iMax - iMin + 1, rows = jMax - jMin + 1;
  const values = new Float32Array(cols * rows);
  const r2 = radius * radius + 1e-9;

  // Ties: nearest the base, then the more central (|y - 34| smaller), then the deeper.
  // Both secondary keys survive a left/right mirror, so mirrored scenes get mirrored ghosts.
  const eps = GHOST_DEFAULTS.tieEps;
  let best = -Infinity, bestD2 = Infinity, bx = b.x, by = b.y;
  const p = { x: 0, y: 0 };
  for (let r = 0; r < rows; r++) {
    const dy = (jMin + r) * step;
    p.y = b.y + dy;
    for (let c = 0; c < cols; c++) {
      const dx = (iMin + c) * step;
      p.x = b.x + dx;
      const v = scoreAt(p);
      values[r * cols + c] = v;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      let better = v > best + eps;
      if (!better && v >= best - eps) {
        if (d2 < bestD2 - eps) better = true;
        else if (d2 <= bestD2 + eps) {
          const inside = Math.abs(p.y - MID_Y) - Math.abs(by - MID_Y);
          better = inside < -eps || (inside <= eps && p.x < bx);
        }
      }
      if (better) { best = v; bestD2 = d2; bx = p.x; by = p.y; }
    }
  }

  const spot = { x: bx, y: by };
  const result = evaluate(ctx, spot, { center: b, tol: t, rules });
  return {
    spot,
    score: result.score,
    field: { x0: b.x + iMin * step, y0: b.y + jMin * step, step, cols, rows, values },
    result,
  };
}
