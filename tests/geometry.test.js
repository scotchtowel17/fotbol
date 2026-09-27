import { test, assert, approx } from './harness.js';
import { angleBetween, barycentric, band, projectOnSegment, median, rotate } from '../js/engine/geometry.js';
import { laneOf, thirdOf, mirrorPoint, inOwnBox, POSTS } from '../js/engine/pitch.js';

test('barycentric weights reproduce the point', () => {
  const a = { x: 0, y: 0 }, b = { x: 10, y: 0 }, c = { x: 0, y: 10 };
  const p = { x: 2, y: 3 };
  const [w1, w2, w3] = barycentric(p, a, b, c);
  approx(w1 + w2 + w3, 1);
  approx(w1 * a.x + w2 * b.x + w3 * c.x, p.x);
  approx(w1 * a.y + w2 * b.y + w3 * c.y, p.y);
});

test('band is 1 inside, linear falloff outside', () => {
  assert.equal(band(5, 3, 6), 1);
  approx(band(7.5, 3, 6, 3), 0.5);
  assert.equal(band(20, 3, 6, 3), 0);
});

test('angleBetween and rotate', () => {
  approx(angleBetween({ x: 1, y: 0 }, { x: 0, y: 1 }), 90);
  const r = rotate({ x: 1, y: 0 }, 90);
  approx(r.x, 0); approx(r.y, 1);
});

test('projectOnSegment clamps t', () => {
  const r = projectOnSegment({ x: 20, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.equal(r.t, 1);
  approx(r.dist, Math.hypot(10, 5));
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('pitch lanes, thirds, mirror, box', () => {
  assert.equal(laneOf(5), 0);
  assert.equal(laneOf(34), 2);
  assert.equal(laneOf(67), 4);
  assert.equal(thirdOf(10), 0);
  assert.equal(thirdOf(80), 2);
  assert.deepEqual(mirrorPoint({ x: 10, y: 20 }), { x: 95, y: 48 });
  assert.ok(inOwnBox({ x: 10, y: 34 }));
  assert.ok(!inOwnBox({ x: 20, y: 34 }));
  approx(POSTS.top, 30.34);
});
