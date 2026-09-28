import { test, assert, approx } from './harness.js';
import { heatColor, fieldToPixels, fieldBounds, fieldRange, HEATMAP_DEFAULTS } from '../js/ui/heatmap.js';

/** Hue in degrees of an sRGB triple (NaN for greys). */
function hueOf([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return NaN;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('heatmap: the ramp is a single hue whose lightness and opacity rise with strength', () => {
  const ts = [0.1, 0.3, 0.5, 0.7, 0.9, 1];
  const cs = ts.map((t) => heatColor(t));
  for (const c of cs) approx(hueOf(c), HEATMAP_DEFAULTS.hue, 4, `hue ${hueOf(c)} drifts from ${HEATMAP_DEFAULTS.hue}`);
  for (let i = 1; i < cs.length; i++) {
    assert.ok(cs[i][3] > cs[i - 1][3], 'alpha increases');
    assert.ok(luma(cs[i]) > luma(cs[i - 1]), 'lightness increases (readable without colour vision)');
  }
  assert.equal(cs.at(-1)[3], Math.round(255 * HEATMAP_DEFAULTS.maxAlpha), 'best spot stays translucent');
});

test('heatmap: zero, negative and NaN strengths are fully transparent', () => {
  assert.deepEqual(heatColor(0), [0, 0, 0, 0]);
  assert.deepEqual(heatColor(-2), [0, 0, 0, 0]);
  assert.deepEqual(heatColor(NaN), [0, 0, 0, 0]);
  assert.deepEqual(heatColor(5), heatColor(1), 'clamped above 1');
});

test('heatmap: relative range shows the top `span` points below the max; explicit lo/hi wins', () => {
  const field = { x0: 0, y0: 0, step: 1, cols: 3, rows: 1, values: Float32Array.from([10, 60, 90]) };
  assert.deepEqual(fieldRange(field), { lo: 90 - HEATMAP_DEFAULTS.span, hi: 90 });
  assert.deepEqual(fieldRange(field, { lo: 0, hi: 100 }), { lo: 0, hi: 100 });
});

test('heatmap: pixels are row-major with row = y, one per grid point', () => {
  // 3 cols x 2 rows; the best value sits at column 2, row 1.
  const values = Float32Array.from([0, 0, 0, 0, 50, 100]);
  const field = { x0: 10, y0: 20, step: 2, cols: 3, rows: 2, values };
  const px = fieldToPixels(field, { span: 100 });
  assert.equal(px.length, 3 * 2 * 4);
  const alphaAt = (c, r) => px[(r * 3 + c) * 4 + 3];
  assert.equal(alphaAt(0, 0), 0);
  assert.ok(alphaAt(2, 1) > alphaAt(1, 1), 'the max pixel is at (col 2, row 1)');
  assert.ok(alphaAt(1, 1) > 0);
});

test('heatmap: image bounds put pixel centres on the grid points', () => {
  const b = fieldBounds({ x0: 10, y0: 20, step: 2, cols: 3, rows: 2 });
  assert.deepEqual(b, { x: 9, y: 19, width: 6, height: 4 });
  // centre of the last pixel column = x + width - step/2 = the last grid x
  approx(b.x + b.width - 1, 10 + 2 * 2);
  approx(b.y + b.height - 1, 20 + 1 * 2);
});
