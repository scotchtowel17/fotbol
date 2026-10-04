// Layer A: where each role normally stands for a given ball position.
// Contract: docs/ARCHITECTURE.md §5.1. Rationale: docs/RESEARCH.md §5.2.
//
// A formation table is a list of samples "ball here -> 11 players there" in the
// canonical frame (the team attacks +x). The sample ball points are Delaunay-
// triangulated (vendor/delaunator); a query ball is located in a triangle and every
// role is the barycentric blend of that triangle's three samples (the method of
// Akiyama and Noda 2008). Written from scratch: no librcsc/HELIOS code is used.
//
// Ball outside the triangulation hull (only possible with a table whose samples do
// not cover the pitch; the HELIOS hull does): the ball is projected to the NEAREST
// POINT ON THE HULL and interpolated along that hull edge, which keeps targets
// continuous (a nearest-sample fallback would make players jump).
//
// The table has one phase. teamTargets() adds the possession offset and then
// phaseShape(): a few principle-based adjustments (level line and compact lines out of
// possession, width and a spread build-up in possession) that stand in for authored
// in/out-of-possession tables until a coach provides them.

import Delaunator from '../../vendor/delaunator/index.js';
import { clamp, median } from './geometry.js';
import { LENGTH, WIDTH, HALF_X, MID_Y, LANE_EDGES, clampToPitch, mirrorPoint } from './pitch.js';
import { ROLES, ROLE_INFO, BACK_LINE, MIDFIELD, FORWARDS } from './roles.js';

/** @typedef {import('./types.js').Vec} Vec */

/**
 * @typedef {Object} FormationTable  data/formations/*.json (docs/ARCHITECTURE.md §5.1)
 * @property {string} id
 * @property {string} name
 * @property {string[]} [roles]  defaults to ROLES
 * @property {{ ball: Vec, pos: Object<string, Vec> }[]} samples  canonical frame, team attacks +x
 */

/**
 * @typedef {Object} Formation
 * @property {string} id
 * @property {string} name
 * @property {string[]} roles
 * @property {FormationTable['samples']} samples  as in the table; treat as read-only (build a new Formation after editing)
 * @property {Uint32Array} triangles  sample indices, 3 per triangle (empty for the linear fallback)
 * @property {Uint32Array} hull       sample indices of the convex hull, in order
 * @property {(ball: Vec) => Object<string, Vec>} positions  own frame; ball clamped to the pitch
 * @property {(ball: Vec) => { ball: Vec, samples: number[], weights: number[], inside: boolean }} locate
 *   which samples (and weights) drive the targets for this ball; `ball` is the point actually used
 */

export const POSSESSION_OFFSET = Object.freeze({ with: 6, without: -4 }); // [D] metres along the attacking direction, outfield only

export const FORMATION_DEFAULTS = Object.freeze({
  // [D] m (penalty-area depth): the possession offset fades linearly to 0 at the goal line it
  // pushes toward, so defenders are not pushed onto their own line nor attackers onto the
  // opponent's. Must exceed |offset| to keep the order of players in depth.
  offsetTaper: 16.5,
});

/**
 * Phase shape (see phaseShape): HELIOS has a single phase, so its shapes near our own goal are
 * box defence even when we have the ball, and its shapes near their goal are attacking shapes even
 * when we don't. These few principle-based adjustments stand in for the authored in-possession and
 * out-of-possession tables of the roadmap (RESEARCH 5.2), so that layer A agrees with the rules.
 */
export const SHAPE_DEFAULTS = Object.freeze({
  // Out of possession
  levelBackLine: 0.8, // [D] U4: the back four close this share of the table's stagger (the rest is kept as texture)
  maxLineGap: 15, // [S] U1: back line at most this far behind the midfield line (median x of #6 and #8s); it steps up to close more...
  maxLineHeight: 52, // [S] ...but not past this x (U6, FIFA-HB: in a high block the centre-backs hold at x 45-52); the midfield drops back to it instead
  wingerInset: 10, // [D] R4: wingers stay at least this far in from their touchline, where they can get goal-side of the full-back
  tuckSideways: Object.freeze({ CM: 25, W: 38 }), // [D] D4: #8s and wingers at most this far sideways from the ball (TUCK_DEFAULTS.maxSideways; tested equal)
  stBeyondBall: 2, // [D] T3/U6: in a mid or low block the #9 stays at most this far beyond the ball, or beyond our midfield line if that is higher (a bypassed #9 recovers)...
  stBlockHigh: 45, // [D] ...fully once our back line is below this x (CONTEXT_DEFAULTS.blockHigh, tested equal: a high block presses instead)...
  stBlockFade: 5, // [D] ...fading in over this many metres below it
  // In possession
  wingerWidth: 4, // [D] B1/R4: wingers stand within this of their touchline (the width rule allows 5 m)
  crossX: 88, // [D] P10: with the ball in the far wing lane beyond this x, the far winger attacks the box instead
  crossFade: 8, // [D] ...fading in over this many metres before crossX
  cbSplit: 13, // [D] R1: in build-up the centre-backs split to at least this far either side of their mid-point (the half-spaces when central)
  fbWide: 26, // [D] B10/B1: ...and the full-backs to at least this far (the wing lanes)
  buildUpFrom: 35, // [D] build-up spread is full with the ball behind this x (our defensive third)...
  buildUpTo: 60, // [D] ...and gone once it passes this x (the table's own attacking shape takes over)
  // [D] B10/B2: in build-up the lines stagger: full-backs, #6, #8s and #9 at least this far up (own frame)
  buildUpDepth: Object.freeze({ FB: 18, DM: 21, CM: 28, ST: 48 }),
  // The keeper out of possession (G1): on the bisector of the ball-to-posts angle, this far off the goal line along
  // it for the ball this far from the middle of the goal (linear in between); in possession the table's spot
  keeper: true,
  keeperDepth: Object.freeze([[0, 1], [16.5, 2.5], [30, 4], [52, 11], [88, 16.5]]), // [S] KS-D: 27-32 m gives 3-5 m, halfway about 11 m, their box 16.5 m; [D] below 30 m
});

/** The goal line's posts (own frame: our goal at x 0). */
const POST_A = Object.freeze({ x: 0, y: MID_Y - 7.32 / 2 }), POST_B = Object.freeze({ x: 0, y: MID_Y + 7.32 / 2 });

/**
 * G1, the keeper's spot (own frame, our goal at x 0): on the line that bisects the angle between the ball and the two
 * posts, `depth` metres out from where that line meets the goal line, depth interpolated in SHAPE_DEFAULTS.keeperDepth
 * by the ball's distance from the middle of the goal. Shared by phaseShape (the auto keeper) and the gk-angle-depth
 * rule, so the keeper's base and the rule agree. Continuous in the ball.
 * @param {Vec} ball  own frame
 * @returns {{ spot: Vec, on: Vec, dir: Vec, depth: number }}  on: where the bisector meets the goal line; dir: unit, from there toward the ball
 */
export function keeperSpot(ball, P = SHAPE_DEFAULTS) {
  const b = { x: Math.max(ball.x, 0.5), y: ball.y };
  const ua = unit({ x: POST_A.x - b.x, y: POST_A.y - b.y }), ub = unit({ x: POST_B.x - b.x, y: POST_B.y - b.y });
  const bis = unit({ x: ua.x + ub.x, y: ua.y + ub.y }); // from the ball toward the goal
  const k = bis.x < -1e-9 ? -b.x / bis.x : 0;
  const on = { x: 0, y: clamp(b.y + bis.y * k, POST_A.y, POST_B.y) };
  const dir = unit({ x: b.x - on.x, y: b.y - on.y });
  const dBall = Math.hypot(b.x, b.y - MID_Y);
  const table = P.keeperDepth;
  let depth = table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) {
    if (dBall <= table[i][0]) { const [x0, y0] = table[i - 1], [x1, y1] = table[i]; depth = y0 + ((y1 - y0) * (dBall - x0)) / (x1 - x0); break; }
  }
  depth = Math.min(depth, Math.hypot(b.x - on.x, b.y - on.y) - 0.5); // never past the ball
  // A ball near the goal line out wide: the near post, never outside it.
  const spot = { x: Math.max(on.x + dir.x * depth, 0.5), y: clamp(on.y + dir.y * depth, POST_A.y - 0.5, POST_B.y + 0.5) };
  return { spot, on, dir, depth };
}

function unit(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

/**
 * P10 fade for one side's winger: 1 when the width duty holds, falling to 0 as the ball enters the
 * crossing zone on the other wing (the far winger then attacks the box). `side` is 'L' or 'R'.
 * @param {Vec} ball  the team's own frame
 * @param {'L'|'R'} side
 * @param {object} [P]  SHAPE_DEFAULTS-like
 * @returns {number} 0..1
 */
export function widthDuty(ball, side, P = SHAPE_DEFAULTS) {
  const fx = clamp((ball.x - (P.crossX - P.crossFade)) / P.crossFade, 0, 1);
  const inner = side === 'L' ? LANE_EDGES[3] : WIDTH - LANE_EDGES[2]; // edge of the far half-space
  const outer = side === 'L' ? LANE_EDGES[4] : WIDTH - LANE_EDGES[1]; // edge of the far wing lane
  const far = side === 'L' ? ball.y : WIDTH - ball.y;
  const fy = clamp((far - inner) / (outer - inner), 0, 1);
  return 1 - fx * fy;
}

/**
 * Phase adjustments to one team's targets, in the team's own frame (attacking +x). Mutates and
 * returns `t`. Pure geometry of the team's own targets and the ball: continuous in the ball and
 * exactly left/right symmetric.
 *  - Out of possession: the keeper takes the G1 spot (keeperSpot: angle and depth); the back four level up (U4), then step up together if they are more than
 *    maxLineGap behind the midfield line (U1), never past maxLineHeight (a line above it drops to it,
 *    and the midfield drops back to the capped line instead); no midfielder more than maxLineGap
 *    ahead of the back line and no forward more than that ahead of the midfield line (U1, per
 *    player); in a mid or low block the #9 comes back to about the ball's height (T3);
 *    wingers come in off the touchline (R4), and the far #8 and winger tuck in toward the ball (D4).
 *  - In possession: wingers hold the width (B1, R4; P10 frees the far winger near the byline), and
 *    in build-up the centre-backs split into the half-spaces, the full-backs go wide, and the lines
 *    stagger in depth (full-backs, #6, #8s and #9 at least buildUpDepth up: R1, B10, B2).
 * @param {Object<string, Vec>} t  targets by role (own frame)
 * @param {Vec} ball  own frame
 * @param {{ inPossession?: boolean, params?: object, recover?: boolean }} [opts]
 *   recover: false = the #9 stays where he is out of possession (a loose ball: he is the outlet, T4)
 * @returns {Object<string, Vec>}
 */
export function phaseShape(t, ball, { inPossession = false, params, recover = true } = {}) {
  const P = params ? { ...SHAPE_DEFAULTS, ...params } : SHAPE_DEFAULTS;
  const back = BACK_LINE.filter((r) => t[r]);
  if (!inPossession && P.keeper && t.GK) t.GK = keeperSpot(ball, P).spot; // G1: angle and depth
  if (!inPossession) {
    if (!back.length) return t;
    const line = median(back.map((r) => t[r].x));
    for (const r of back) t[r] = { x: t[r].x + P.levelBackLine * (line - t[r].x), y: t[r].y };
    const mids = MIDFIELD.filter((r) => t[r]);
    const gap = mids.length ? median(mids.map((r) => t[r].x)) - median(back.map((r) => t[r].x)) : -Infinity;
    const lineX = median(back.map((r) => t[r].x));
    // Up to close the gap, but never past the height cap (a line the table puts above it drops to it).
    const shift = Math.min(Math.max(gap - P.maxLineGap, 0), P.maxLineHeight - lineX);
    if (shift !== 0) for (const r of back) t[r] = { x: t[r].x + shift, y: t[r].y };
    // A line that can go no higher: the midfield drops back to it instead.
    const down = gap - shift - P.maxLineGap;
    if (down > 0) for (const r of mids) t[r] = { x: t[r].x - down, y: t[r].y };
    // U1 holds for each player, not only for the line medians (the compact rule judges every player's
    // own gap): no #6 or #8 more than maxLineGap ahead of the back line, no forward more than that
    // ahead of the midfield line.
    const backX = lineX + shift;
    for (const r of mids) if (t[r].x > backX + P.maxLineGap) t[r] = { x: backX + P.maxLineGap, y: t[r].y };
    const midLine = mids.length ? median(mids.map((r) => t[r].x)) : Infinity;
    for (const r of FORWARDS) if (t[r] && t[r].x > midLine + P.maxLineGap) t[r] = { x: midLine + P.maxLineGap, y: t[r].y };
    // T3: in a mid or low block a #9 the ball has gone past recovers to about the ball's height
    // (U6: the first line sits near the ball, not behind it), but no deeper than just in front of
    // our midfield line (he stays the first line and the outlet, T4); a high block presses from where it is.
    const k = recover ? clamp((P.stBlockHigh - (lineX + shift)) / P.stBlockFade, 0, 1) : 0;
    const cap = Math.max(ball.x, midLine === Infinity ? -Infinity : midLine) + P.stBeyondBall;
    if (t.ST && k > 0 && t.ST.x > cap) t.ST = { x: t.ST.x - k * (t.ST.x - cap), y: t.ST.y };
    for (const r of ['LW', 'RW', 'LCM', 'RCM']) {
      const p = t[r];
      if (!p) continue;
      const fam = ROLE_INFO[r].family;
      let y = p.y;
      if (fam === 'W') y = clamp(y, P.wingerInset, WIDTH - P.wingerInset);
      const reach = P.tuckSideways[fam];
      if (reach != null) y = clamp(y, ball.y - reach, ball.y + reach);
      if (y !== p.y) t[r] = { x: p.x, y };
    }
    return t;
  }
  // Push a role out toward its own side until it is at least `half` from `centre` (weight w);
  // left-side roles only ever move left and right-side roles right.
  const widen = (r, centre, half, w) => {
    const p = t[r];
    if (!p || !(w > 0)) return;
    const side = ROLE_INFO[r].side === 'L' ? -1 : 1;
    const off = (p.y - (centre + side * half)) * side; // < 0: narrower than wanted
    if (off < 0) t[r] = { x: p.x, y: p.y - off * side * w };
  };
  for (const r of ['LW', 'RW']) widen(r, MID_Y, MID_Y - P.wingerWidth, widthDuty(ball, ROLE_INFO[r].side, P));
  // Build-up spread about the centre-backs' mid-point, so the ball-side shift of the table survives.
  const build = clamp((P.buildUpTo - ball.x) / (P.buildUpTo - P.buildUpFrom), 0, 1);
  const centre = t.LCB && t.RCB ? (t.LCB.y + t.RCB.y) / 2 : MID_Y;
  for (const r of ['LCB', 'RCB']) widen(r, centre, P.cbSplit, build);
  for (const r of ['LB', 'RB']) widen(r, centre, P.fbWide, build);
  // ...and the lines stagger in depth: full-backs high and wide (B10), the #6 ahead of the
  // centre-backs, the #8s ahead of him, the #9 up near their line (B2), instead of the table's box defence.
  if (build > 0) {
    for (const r in t) {
      const min = P.buildUpDepth[ROLE_INFO[r]?.family];
      if (min != null && t[r].x < min) t[r] = { x: t[r].x + build * (min - t[r].x), y: t[r].y };
    }
  }
  return t;
}

/** Linear fallback (RESEARCH 5.2): target = centre + i + k * (ball - centre); i_y is negated for left roles. */
export const LINEAR_DEFAULTS = Object.freeze({
  CB: Object.freeze({ kx: 0.48, ky: 0.32, ix: -18.4, iy: 5.6 }), // [M] regression on the HELIOS samples
  FB: Object.freeze({ kx: 0.56, ky: 0.31, ix: -15.4, iy: 15.8 }), // [M]
  DM: Object.freeze({ kx: 0.70, ky: 0.47, ix: -7.6, iy: 0 }), // [M]
  CM: Object.freeze({ kx: 0.80, ky: 0.40, ix: -1.0, iy: 10 }), // [M]
  W: Object.freeze({ kx: 0.72, ky: 0.25, ix: 10.7, iy: 21.2 }), // [M]
  ST: Object.freeze({ kx: 0.71, ky: 0.43, ix: 10.5, iy: 0 }), // [M]
  GK: Object.freeze({ x0: 4, kx: 0.12, ky: 0.12, xMin: 3, xMax: 20 }), // [D] HELIOS keeps its keeper fixed; this is a guess
});

const EPS = 1e-9; // barycentric slack: a ball on a triangle edge counts as inside

/**
 * Linear fallback target for a role (own frame, team attacks +x). Used by tests,
 * sanity checks and createFormation() without a table.
 * @param {string} role
 * @param {Vec} ball
 * @returns {Vec}
 */
export function linearTarget(role, ball) {
  const { family, side } = ROLE_INFO[role];
  if (family === 'GK') {
    const g = LINEAR_DEFAULTS.GK;
    return { x: clamp(g.x0 + g.kx * ball.x, g.xMin, g.xMax), y: MID_Y + g.ky * (ball.y - MID_Y) };
  }
  const c = LINEAR_DEFAULTS[family];
  const iy = side === 'L' ? -c.iy : side === 'R' ? c.iy : 0;
  return clampToPitch({ x: HALF_X + c.ix + c.kx * (ball.x - HALF_X), y: MID_Y + iy + c.ky * (ball.y - MID_Y) });
}

function linearFormation(table) {
  const roles = table?.roles ?? ROLES;
  return {
    id: table?.id ?? 'linear',
    name: table?.name ?? 'Linear fallback',
    roles,
    samples: [],
    triangles: new Uint32Array(0),
    hull: new Uint32Array(0),
    positions(ball) {
      const b = clampBall(ball);
      return Object.fromEntries(roles.map((r) => [r, linearTarget(r, b)]));
    },
    locate: (ball) => ({ ball: clampBall(ball), samples: [], weights: [], inside: false }),
  };
}

function clampBall(ball) {
  if (!Number.isFinite(ball?.x) || !Number.isFinite(ball?.y)) throw new TypeError(`formation: ball must have finite x, y (got ${JSON.stringify(ball)})`);
  return { x: clamp(ball.x, 0, LENGTH), y: clamp(ball.y, 0, WIDTH) };
}

/**
 * Build a Formation from a table. With no table (or no samples) this returns the
 * linear fallback, which is handy for tests.
 * @param {FormationTable} [table]
 * @returns {Formation}
 * @throws {Error} if a sample lacks a role or has a non-finite coordinate
 */
export function createFormation(table) {
  if (!table?.samples?.length) return linearFormation(table);
  const roles = table.roles ?? ROLES;
  const samples = table.samples;
  const n = samples.length, nr = roles.length, stride = 2 * nr;

  // Flat copies for speed: ball coordinates, and every sample's role positions.
  const coords = new Float64Array(2 * n);
  const P = new Float64Array(n * stride);
  samples.forEach((s, i) => {
    coords[2 * i] = s.ball?.x;
    coords[2 * i + 1] = s.ball?.y;
    roles.forEach((r, k) => {
      P[i * stride + 2 * k] = s.pos?.[r]?.x;
      P[i * stride + 2 * k + 1] = s.pos?.[r]?.y;
    });
  });
  const bad = [...coords, ...P].findIndex((v) => !Number.isFinite(v));
  if (bad >= 0) {
    const i = bad < coords.length ? bad >> 1 : Math.floor((bad - coords.length) / stride);
    throw new Error(`formation ${table.id}: sample ${i} has a missing role or non-finite coordinate`);
  }

  const d = new Delaunator(coords);
  const tri = d.triangles, half = d.halfedges, hull = d.hull;
  const nTri = tri.length / 3;

  // Scratch for the located samples and weights (positions() is hot: ~700 calls per ghost search).
  const I = new Uint32Array(3), W = new Float64Array(3);
  let last = 0; // cached triangle: consecutive queries are usually close

  // Barycentric weights of (bx, by) in triangle t, written to W; returns the index of the
  // most negative weight below -EPS, or -1 if the point is inside.
  function weigh(t, bx, by) {
    const i0 = tri[3 * t], i1 = tri[3 * t + 1], i2 = tri[3 * t + 2];
    const x0 = coords[2 * i0], y0 = coords[2 * i0 + 1];
    const x1 = coords[2 * i1], y1 = coords[2 * i1 + 1];
    const x2 = coords[2 * i2], y2 = coords[2 * i2 + 1];
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    W[0] = ((y1 - y2) * (bx - x2) + (x2 - x1) * (by - y2)) / det;
    W[1] = ((y2 - y0) * (bx - x2) + (x0 - x2) * (by - y2)) / det;
    W[2] = 1 - W[0] - W[1];
    I[0] = i0; I[1] = i1; I[2] = i2;
    let k = -1, min = -EPS;
    for (let j = 0; j < 3; j++) if (W[j] < min) { min = W[j]; k = j; }
    return k;
  }

  // Walk from the cached triangle toward the ball, always crossing the edge opposite the
  // most negative weight (a visibility walk, which terminates on a Delaunay mesh).
  // Returns true when a containing triangle is found; false when the ball is outside the hull.
  function walk(bx, by) {
    let t = last;
    for (let step = 0; step <= nTri; step++) {
      const k = weigh(t, bx, by);
      if (k < 0) { last = t; return true; }
      const e = half[3 * t + ((k + 1) % 3)]; // the edge opposite vertex k
      if (e < 0) return false; // beyond a hull edge
      t = Math.floor(e / 3);
    }
    for (t = 0; t < nTri; t++) if (weigh(t, bx, by) < 0) { last = t; return true; } // safety net
    return false;
  }

  // Nearest point on the hull; writes the two edge samples and weights to I/W. Returns the point.
  function projectToHull(bx, by) {
    let best = Infinity, px = bx, py = by;
    const h = hull.length;
    for (let j = 0; j < h; j++) {
      const a = hull[j], b = hull[(j + 1) % h];
      const ax = coords[2 * a], ay = coords[2 * a + 1];
      const dx = coords[2 * b] - ax, dy = coords[2 * b + 1] - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : clamp(((bx - ax) * dx + (by - ay) * dy) / l2, 0, 1);
      const qx = ax + t * dx, qy = ay + t * dy;
      const d2 = (bx - qx) ** 2 + (by - qy) ** 2;
      if (d2 < best) { best = d2; px = qx; py = qy; I[0] = a; I[1] = b; I[2] = b; W[0] = 1 - t; W[1] = t; W[2] = 0; }
    }
    return { x: px, y: py };
  }

  // Fill I/W for a (clamped) ball; returns { inside, point used }.
  function locateInto(b) {
    if (nTri > 0 && walk(b.x, b.y)) return { inside: true, used: b };
    return { inside: false, used: projectToHull(b.x, b.y) };
  }

  return {
    id: table.id,
    name: table.name,
    roles,
    samples,
    triangles: tri,
    hull,
    positions(ball) {
      locateInto(clampBall(ball));
      const a = I[0] * stride, b = I[1] * stride, c = I[2] * stride;
      const w0 = W[0], w1 = W[1], w2 = W[2];
      const out = {};
      for (let k = 0; k < nr; k++) {
        const o = 2 * k;
        out[roles[k]] = {
          x: w0 * P[a + o] + w1 * P[b + o] + w2 * P[c + o],
          y: w0 * P[a + o + 1] + w1 * P[b + o + 1] + w2 * P[c + o + 1],
        };
      }
      return out;
    },
    locate(ball) {
      const { inside, used } = locateInto(clampBall(ball));
      return { ball: used, samples: [...I], weights: [...W], inside };
    },
  };
}

/**
 * Formation targets for one team in the canonical frame (docs/ARCHITECTURE.md §5.1).
 * 'us' uses the table directly; 'them' mirrors it through the centre spot, so their
 * left back appears at large y. With a possession phase (offset on), the possession offset
 * moves outfield roles along the team's attacking direction (us +x, them -x), fading out
 * within `taper` metres of the goal line it pushes toward (the goalkeeper never moves with
 * it), and then phaseShape() adapts the single-phase table to that phase.
 * @param {Formation} formation
 * @param {'us'|'them'} team
 * @param {Vec} ball  canonical frame
 * @param {{ inPossession?: boolean, offset?: boolean, taper?: number, shape?: boolean|object }} [opts]
 *   inPossession: `team` has the ball; offset: false = no possession offset (loose ball, previews);
 *   shape: whether to apply phaseShape() for the inPossession phase (default: when the offset is on;
 *   an object overrides SHAPE_DEFAULTS)
 * @returns {Object<string, Vec>}  every target clamped to the pitch
 */
export function teamTargets(formation, team, ball, { inPossession = false, offset = true, taper = FORMATION_DEFAULTS.offsetTaper, shape = offset } = {}) {
  const b = team === 'us' ? ball : mirrorPoint(ball);
  const own = formation.positions(b);
  const dx = offset ? (inPossession ? POSSESSION_OFFSET.with : POSSESSION_OFFSET.without) : 0;
  const t = {};
  for (const role in own) {
    const p = own[role];
    const room = dx < 0 ? p.x : LENGTH - p.x; // distance to the goal line the offset pushes toward
    t[role] = role === 'GK' || dx === 0 ? p : { x: p.x + dx * clamp(room / taper, 0, 1), y: p.y };
  }
  // With a loose ball (no offset) the #9 does not recover: whoever wins it, he is the outlet (T4).
  if (shape) phaseShape(t, clampBall(b), { inPossession, params: typeof shape === 'object' ? shape : undefined, recover: offset });
  const out = {};
  for (const role in t) {
    const q = clampToPitch(t[role]);
    out[role] = team === 'us' ? q : mirrorPoint(q);
  }
  return out;
}
