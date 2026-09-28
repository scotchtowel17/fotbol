// Heatmap field → image for the board. The ghost search (js/engine/ghost.js) returns
// field = { x0, y0, step, cols, rows, values: Float32Array (0..100, row-major, row = y) }.
// We paint one pixel per grid point onto a small canvas; the board places it as an SVG
// <image> in world coordinates (so pitch rotation just works) and lets the browser
// smooth it when scaling up.
//
// Colour: ONE hue, varying lightness and opacity (sequential, colour-blind safe),
// translucent so the grass and players stay readable.

import { clamp } from '../engine/geometry.js';

export const HEATMAP_DEFAULTS = Object.freeze({
  hue: 192, // [D] cyan: well away from grass green and from both kit colours
  saturation: 95, // [D] %
  lightLo: 45, // [D] % lightness at the weak end of the ramp
  lightHi: 88, // [D] % lightness at the best spot
  maxAlpha: 0.72, // [D] opacity at the best spot
  span: 35, // [D] score points below the field's max that still show (relative scaling)
  gamma: 1.3, // [D] > 1 keeps weak values faint
});

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/**
 * Colour for a normalised strength t in [0, 1].
 * @returns {[number, number, number, number]} r, g, b, a (0..255)
 */
export function heatColor(t, params = HEATMAP_DEFAULTS) {
  return colorOf(t, { ...HEATMAP_DEFAULTS, ...params });
}

function colorOf(t, P) {
  const u = clamp(t, 0, 1);
  if (!(u > 0)) return [0, 0, 0, 0];
  const [r, g, b] = hslToRgb(P.hue, P.saturation, P.lightLo + (P.lightHi - P.lightLo) * u);
  return [r, g, b, Math.round(255 * P.maxAlpha * u ** P.gamma)];
}

/**
 * Value range mapped onto the ramp: explicit { lo, hi } in params, else [max - span, max].
 * @returns {{ lo: number, hi: number }}
 */
export function fieldRange(field, params = HEATMAP_DEFAULTS) {
  const P = { ...HEATMAP_DEFAULTS, ...params };
  if (Number.isFinite(P.lo) && Number.isFinite(P.hi) && P.hi > P.lo) return { lo: P.lo, hi: P.hi };
  let max = -Infinity;
  for (const v of field.values) if (v > max) max = v;
  if (!Number.isFinite(max)) max = 0;
  return { lo: max - P.span, hi: max };
}

/**
 * RGBA pixels (one per grid point), row-major with row = y index, ready for ImageData.
 * @returns {Uint8ClampedArray} length cols * rows * 4
 */
export function fieldToPixels(field, params = HEATMAP_DEFAULTS) {
  const P = { ...HEATMAP_DEFAULTS, ...params };
  const { cols, rows, values } = field;
  const { lo, hi } = fieldRange(field, P);
  const span = hi - lo || 1;
  const out = new Uint8ClampedArray(cols * rows * 4);
  for (let i = 0; i < cols * rows; i++) {
    const v = values[i];
    const c = Number.isFinite(v) ? colorOf((v - lo) / span, P) : [0, 0, 0, 0];
    out.set(c, i * 4);
  }
  return out;
}

/**
 * World-space rectangle covered by the image: pixel centres sit on the grid points.
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function fieldBounds(field) {
  const { x0, y0, step, cols, rows } = field;
  return { x: x0 - step / 2, y: y0 - step / 2, width: cols * step, height: rows * step };
}

/** Paint the field onto a new cols x rows canvas (browser only). */
export function fieldToCanvas(field, params = HEATMAP_DEFAULTS, doc = globalThis.document) {
  const canvas = doc.createElement('canvas');
  canvas.width = field.cols;
  canvas.height = field.rows;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(fieldToPixels(field, params), field.cols, field.rows), 0, 0);
  return canvas;
}

/**
 * Everything the board needs for an SVG <image>: a PNG data URL plus world bounds.
 * @returns {{ href: string, x: number, y: number, width: number, height: number }}
 */
export function fieldImage(field, params = HEATMAP_DEFAULTS, doc = globalThis.document) {
  return { href: fieldToCanvas(field, params, doc).toDataURL('image/png'), ...fieldBounds(field) };
}
