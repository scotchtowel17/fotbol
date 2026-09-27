// Pure 2D geometry helpers. Points are plain {x, y} objects in metres.
// No DOM access: this module runs in the browser and under Node.

/** @typedef {{x:number, y:number}} Vec */

/** @returns {Vec} */
export const vec = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpPoint = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Unit vector; returns {0,0} for a zero vector. */
export function norm(a) {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Rotate a vector by `deg` degrees (counter-clockwise in a y-up frame). */
export function rotate(a, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Unsigned angle between two vectors in degrees, 0..180. Zero vectors give 0. */
export function angleBetween(u, v) {
  const lu = len(u), lv = len(v);
  if (lu === 0 || lv === 0) return 0;
  return (Math.acos(clamp(dot(u, v) / (lu * lv), -1, 1)) * 180) / Math.PI;
}

/**
 * Project p onto segment a-b.
 * @returns {{t:number, point:Vec, dist:number}} t is clamped to [0, 1].
 */
export function projectOnSegment(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : clamp(dot(sub(p, a), ab) / l2, 0, 1);
  const point = add(a, scale(ab, t));
  return { t, point, dist: dist(p, point) };
}

/** Unclamped projection parameter of p on the line a-b (0 at a, 1 at b). */
export function projectionParam(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  return l2 === 0 ? 0 : dot(sub(p, a), ab) / l2;
}

export const pointSegmentDistance = (p, a, b) => projectOnSegment(p, a, b).dist;

/**
 * Barycentric weights of p in triangle (a, b, c).
 * @returns {[number, number, number]} weights summing to 1 (NaN-free for degenerate triangles: returns [1,0,0]).
 */
export function barycentric(p, a, b, c) {
  const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(det) < 1e-12) return [1, 0, 0];
  const w1 = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det;
  const w2 = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det;
  return [w1, w2, 1 - w1 - w2];
}

/**
 * Soft band membership: 1 inside [lo, hi], falling linearly to 0 at `soft`
 * outside the band. Used by principle rules for tolerance checks.
 */
export function band(v, lo, hi, soft = 3) {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return soft <= 0 ? 0 : clamp(1 - d / soft, 0, 1);
}

/** 1 when v <= max, falling linearly to 0 at max + soft. */
export const atMost = (v, max, soft = 3) => band(v, -Infinity, max, soft);
/** 1 when v >= min, falling linearly to 0 at min - soft. */
export const atLeast = (v, min, soft = 3) => band(v, min, Infinity, soft);

/** Nearest item in `items` (objects with x, y) to point p, or null. */
export function nearest(p, items) {
  let best = null, bd = Infinity;
  for (const it of items) {
    const d = dist2(p, it);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

export function median(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);

/** Round to `dp` decimal places. */
export const round = (v, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;
