// ghost.js: grid argmax (the ideal spot) and the heatmap field.
import { test, assert, approx } from './harness.js';
import { makeFrame, posOf } from './fixtures.js';
import { buildContext } from '../js/engine/context.js';
import { mirrorPlayerId, mirrorRole } from '../js/engine/roles.js';
import { evaluate } from '../js/engine/score.js';
import { computeGhost, GHOST_DEFAULTS } from '../js/engine/ghost.js';
import { RULES } from '../js/engine/rules/index.js';
import offside from '../js/engine/rules/offside.js';
import width from '../js/engine/rules/width.js';
import pin from '../js/engine/rules/pin.js';
import laneOpen from '../js/engine/rules/lane-open.js';
import supportDistance from '../js/engine/rules/support-distance.js';
import occupancy from '../js/engine/rules/occupancy.js';
import betweenLines from '../js/engine/rules/between-lines.js';
import spacing from '../js/engine/rules/spacing.js';

const ATTACKING = [offside, width, pin, laneOpen, supportDistance, occupancy, betweenLines, spacing];
const IN_POSSESSION = ['LB', 'LCB', 'RCB', 'RB', 'DM', 'LCM', 'RCM', 'LW', 'RW', 'ST'];
const at = (x, y) => ({ x, y });
const ctxOf = (frame, scene, id) => buildContext(frame, { learnerId: id, base: posOf(scene, id) });

/** Left/right mirror of a frame: y -> 68 - y, roles and ids swap sides. */
function mirrorFrame(f) {
  return {
    ...f,
    ball: { x: f.ball.x, y: 68 - f.ball.y },
    carrierId: f.carrierId ? mirrorPlayerId(f.carrierId) : null,
    players: f.players.map((p) => ({ ...p, id: mirrorPlayerId(p.id), role: mirrorRole(p.role), y: 68 - p.y })),
    tags: { ...f.tags },
  };
}

// Spots at least `min` metres from both the ghost and the base (on the pitch), 16 bearings x 3 radii.
function farSpots(ghost, base, min = 20) {
  const out = [];
  for (let k = 0; k < 16; k++) {
    for (const r of [min, min + 5, min + 10]) {
      const a = (k * Math.PI) / 8;
      const p = at(ghost.x + r * Math.cos(a), ghost.y + r * Math.sin(a));
      if (p.x < 0 || p.x > 105 || p.y < 0 || p.y > 68) continue;
      if (Math.hypot(p.x - base.x, p.y - base.y) < min) continue;
      out.push(p);
    }
  }
  return out;
}

test('ghost scores >= 90 for every in-possession role (attacking rules and full registry)', () => {
  const frame = makeFrame('ipBuildUp');
  for (const rules of [ATTACKING, RULES]) {
    for (const role of IN_POSSESSION) {
      const ctx = ctxOf(frame, 'ipBuildUp', `us-${role}`);
      const g = computeGhost(ctx, { rules });
      assert.ok(g.score >= 90, `${role} ghost ${JSON.stringify(g.spot)} scored ${g.score} (${rules.length} rules)`);
      assert.equal(g.score, evaluate(ctx, g.spot, { rules }).score, 'score is evaluate() at the ghost');
      assert.equal(g.result.score, g.score);
      assert.ok(Math.hypot(g.spot.x - ctx.learner.base.x, g.spot.y - ctx.learner.base.y) <= GHOST_DEFAULTS.radius + 1e-9);
    }
  }
});

test('ghost scores >= 90 out of possession under the attacking rules (spacing only applies)', () => {
  const frame = makeFrame('oopMidBlock');
  for (const role of IN_POSSESSION) {
    const g = computeGhost(ctxOf(frame, 'oopMidBlock', `us-${role}`), { rules: ATTACKING });
    assert.ok(g.score >= 90, `${role}: ${g.score}`);
  }
});

test('a spot 20 m away (from the ghost and the base) scores <= 40', () => {
  const frame = makeFrame('ipBuildUp');
  for (const role of IN_POSSESSION.filter((r) => r !== 'LCB')) { // LCB carries the ball
    const ctx = ctxOf(frame, 'ipBuildUp', `us-${role}`);
    const g = computeGhost(ctx);
    const spots = farSpots(g.spot, ctx.learner.base);
    assert.ok(spots.length >= 10, `${role}: ${spots.length} far spots`);
    for (const p of spots) {
      const s = evaluate(ctx, p).score;
      assert.ok(s <= 40, `${role} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) scored ${s}`);
    }
  }
});

test('the ghost finds the principled spot: the #9 pushes onto the last line', () => {
  const ctx = ctxOf(makeFrame('ipBuildUp'), 'ipBuildUp', 'us-ST'); // base x 68, their line x 73
  const g = computeGhost(ctx);
  assert.ok(g.spot.x >= 71 && g.spot.x <= 73, `ghost x ${g.spot.x}`);
  assert.ok(g.score > evaluate(ctx, ctx.learner.base).score);
});

test('ties go to the base: a flat objective returns the base itself', () => {
  const ctx = ctxOf(makeFrame('ipBuildUp'), 'ipBuildUp', 'us-DM');
  const base = at(32.3, 31.7);
  const g = computeGhost(ctx, { base, rules: [] });
  assert.deepEqual(g.spot, base);
  assert.equal(g.score, 100);
});

test('field: square grid aligned on the base, row-major with rows along y', () => {
  const ctx = ctxOf(makeFrame('ipBuildUp'), 'ipBuildUp', 'us-LCM');
  const g = computeGhost(ctx, { radius: 10, step: 2 });
  const f = g.field;
  assert.ok(f.values instanceof Float32Array);
  assert.equal(f.values.length, f.cols * f.rows);
  assert.equal(f.cols, 11);
  assert.equal(f.rows, 11);
  assert.equal(f.step, 2);
  assert.deepEqual(at(f.x0, f.y0), at(46 - 10, 22 - 10));
  for (const v of f.values) assert.ok(v >= 0 && v <= 100);
  // Cell (c, r) is the unrounded score at (x0 + c step, y0 + r step).
  const c = 3, r = 7;
  approx(f.values[r * f.cols + c], evaluate(ctx, at(f.x0 + c * 2, f.y0 + r * 2)).raw, 1e-3);
  // The ghost cell holds the maximum over the search disc.
  let max = -Infinity;
  for (let rr = 0; rr < f.rows; rr++) {
    for (let cc = 0; cc < f.cols; cc++) {
      const x = f.x0 + cc * 2, y = f.y0 + rr * 2;
      if (Math.hypot(x - 46, y - 22) <= 10 + 1e-9) max = Math.max(max, f.values[rr * f.cols + cc]);
    }
  }
  const gc = Math.round((g.spot.x - f.x0) / 2), gr = Math.round((g.spot.y - f.y0) / 2);
  approx(f.values[gr * f.cols + gc], max, 1e-4);
});

test('field and candidates are cropped to the pitch near a corner', () => {
  const ctx = ctxOf(makeFrame('ipBuildUp'), 'ipBuildUp', 'us-LB');
  const g = computeGhost(ctx, { base: at(1.5, 2) });
  const f = g.field;
  assert.ok(f.x0 >= 0 && f.y0 >= 0);
  assert.ok(f.x0 + (f.cols - 1) * f.step <= 105 && f.y0 + (f.rows - 1) * f.step <= 68);
  assert.equal(f.cols, 16 + 1); // x from 0.5 to 16.5
  assert.equal(f.rows, 17 + 1); // y from 0 to 17
  assert.ok(g.spot.x >= 0 && g.spot.y >= 0);
  // A base off the pitch is clamped onto it first.
  const h = computeGhost(ctx, { base: at(-3, 70), rules: [] });
  assert.deepEqual(h.spot, at(0, 68));
});

test('mirror symmetry: a left/right mirrored scene gives a mirrored ghost', () => {
  const frame = makeFrame('ipBuildUp');
  const mirrored = mirrorFrame(frame);
  for (const role of ['LB', 'DM', 'LCM', 'LW', 'ST']) {
    const id = `us-${role}`, mid = mirrorPlayerId(id);
    const base = posOf('ipBuildUp', id);
    const g = computeGhost(buildContext(frame, { learnerId: id, base }));
    const gm = computeGhost(buildContext(mirrored, { learnerId: mid, base: at(base.x, 68 - base.y) }));
    assert.ok(Math.hypot(gm.spot.x - g.spot.x, gm.spot.y - (68 - g.spot.y)) <= 0.5,
      `${role}: ${JSON.stringify(g.spot)} vs mirrored ${JSON.stringify(gm.spot)}`);
    assert.equal(gm.score, g.score);
  }
});

test('performance: a full search stays under 30 ms with 16 applicable rules', () => {
  // Every attacking rule twice, all forced to apply: an upper bound on the v1 rule load.
  const heavy = [...ATTACKING, ...ATTACKING].map((r) => ({ ...r, weight: () => 1 }));
  const frame = makeFrame('ipBuildUp', { ball: at(45, 30), carrierId: 'us-DM', move: { 'us-DM': at(45, 30) } });
  const ctx = ctxOf(frame, 'ipBuildUp', 'us-LCM');
  const oop = ctxOf(makeFrame('oopMidBlock'), 'oopMidBlock', 'us-DM');
  const time = (fn) => {
    fn(); fn(); // warm up
    const ts = [];
    for (let i = 0; i < 7; i++) { const t0 = performance.now(); fn(); ts.push(performance.now() - t0); }
    return ts.sort((a, b) => a - b)[3];
  };
  const tHeavy = time(() => computeGhost(ctx, { rules: heavy }));
  const tRegistry = time(() => computeGhost(oop));
  assert.ok(tHeavy < 30, `16 forced rules: median ${tHeavy.toFixed(1)} ms`);
  assert.ok(tRegistry < 30, `registry, #6 out of possession: median ${tRegistry.toFixed(1)} ms`);
});
