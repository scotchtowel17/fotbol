// score.js: zone score, rule aggregation, the rules gate, critical cap, grades.
import { test, assert, approx } from './harness.js';
import { makeFrame, posOf } from './fixtures.js';
import { buildContext } from '../js/engine/context.js';
import {
  TOLERANCE, SCORE_WEIGHTS, CRITICAL_CAP, LESSON_CAP, RULES_GATE, zoneScore, toleranceFor, gradeOf,
  rulesGate, evaluateRules, evaluate, createScorer,
} from '../js/engine/score.js';

const at = (x, y) => ({ x, y });
const ctxFor = (scene, id, changes = {}) => buildContext(makeFrame(scene, changes), { learnerId: id, base: posOf(scene, id) });

/** A fake rule with a fixed weight and a fixed (or spot-dependent) score. */
const fake = (id, weight, s, extra = {}) => ({
  id, principles: [id.toUpperCase()], critical: false,
  weight: () => weight,
  evaluate: (ctx, spot) => ({ s: typeof s === 'function' ? s(spot) : s, vars: { id } }),
  text: { standard: { name: id, ok: () => '', fail: () => '', cue: () => '' }, kid: { name: id, ok: () => '', fail: () => '', cue: () => '' } },
  ...extra,
});

// ---------------------------------------------------------------- zone score

test('zoneScore: full marks inside the ellipse, including its edge', () => {
  const c = at(30, 30), tol = { tx: 2.5, ty: 4 };
  assert.equal(zoneScore(c, c, tol), 1);
  assert.equal(zoneScore(at(32.5, 30), c, tol), 1);
  assert.equal(zoneScore(at(30, 26), c, tol), 1);
  assert.equal(zoneScore(at(31.5, 32), c, tol), 1); // d_n = sqrt(0.36 + 0.25) < 1
  assert.ok(zoneScore(at(32.6, 30), c, tol) < 1);
});

test('zoneScore: about half credit at 2.2x the tolerance, along either axis', () => {
  const c = at(50, 34), tol = { tx: 5, ty: 6 };
  approx(zoneScore(at(50 + 2.2 * 5, 34), c, tol), Math.exp(-0.72), 1e-12);
  approx(zoneScore(at(50, 34 - 2.2 * 6), c, tol), 0.5, 0.02);
  approx(zoneScore(at(50 + 2 * 5, 34), c, tol), Math.exp(-0.5), 1e-12);
  approx(zoneScore(at(50 + 20, 34), c, tol), Math.exp(-4.5), 1e-12); // 4x the tolerance: about 1%
});

test('zoneScore is anisotropic: tx along the pitch, ty across it', () => {
  const c = at(30, 30), cb = TOLERANCE.CB; // 2.5 along, 4 across
  const along = zoneScore(at(35, 30), c, cb), across = zoneScore(at(30, 35), c, cb);
  assert.ok(along < across, `5 m along (${along}) should cost more than 5 m across (${across})`);
});

test('toleranceFor: role family, family id, overrides, fallback', () => {
  assert.deepEqual(toleranceFor('LCB'), { tx: 2.5, ty: 4 });
  assert.deepEqual(toleranceFor('RW'), { tx: 6, ty: 4 });
  assert.deepEqual(toleranceFor('ST'), { tx: 6, ty: 6 });
  assert.deepEqual(toleranceFor('W'), { tx: 6, ty: 4 });
  assert.deepEqual(toleranceFor('LCB', { ty: 3 }), { tx: 2.5, ty: 3 });
  assert.deepEqual(toleranceFor('DM', { tx: 2, ty: 2 }), { tx: 2, ty: 2 });
  assert.deepEqual(toleranceFor('nope'), { tx: TOLERANCE.CM.tx, ty: TOLERANCE.CM.ty });
  const t = toleranceFor('LCB');
  t.tx = 99;
  assert.equal(TOLERANCE.CB.tx, 2.5, 'returns a copy');
});

test('gradeOf boundaries', () => {
  const cases = [[100, 'S'], [90, 'S'], [89, 'A'], [80, 'A'], [79, 'B'], [70, 'B'], [69, 'C'], [60, 'C'], [59, 'D'], [50, 'D'], [49, 'F'], [0, 'F']];
  for (const [s, g] of cases) assert.equal(gradeOf(s), g, `score ${s}`);
});

// ---------------------------------------------------------------- rules

test('evaluateRules: weighted mean over applicable rules only', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  const { sRules, results } = evaluateRules(ctx, at(32, 32), [fake('a', 2, 0.5), fake('b', 0, 0), fake('c', 1, 1)]);
  approx(sRules, (2 * 0.5 + 1) / 3, 1e-12);
  assert.deepEqual(results.map((r) => r.id), ['a', 'c'], 'weight-0 rules are omitted');
  assert.deepEqual(results[0], { id: 'a', principles: ['A'], weight: 2, s: 0.5, critical: false, target: undefined, vars: { id: 'a' } });
});

test('evaluateRules: no applicable rules gives sRules = 1; s is clamped', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  assert.equal(evaluateRules(ctx, at(32, 32), [fake('z', 0, 0)]).sRules, 1);
  assert.equal(evaluateRules(ctx, at(32, 32), []).results.length, 0);
  const r = evaluateRules(ctx, at(32, 32), [fake('hi', 1, 1.7), fake('nan', 1, NaN)]);
  assert.deepEqual(r.results.map((x) => x.s), [1, 0]);
});

// ---------------------------------------------------------------- evaluate

test('evaluate: RESEARCH 5.6 combination near the zone; defaults to base and role tolerance', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  const rules = [fake('a', 3, 0.6), fake('b', 1, 1)];
  const r = evaluate(ctx, at(32, 32), { rules });
  const sRules = (3 * 0.6 + 1) / 4;
  assert.equal(r.sZone, 1);
  approx(r.sRules, sRules, 1e-12);
  assert.equal(r.gate, 1);
  assert.equal(r.score, Math.round(100 * (SCORE_WEIGHTS.zone + SCORE_WEIGHTS.rules * sRules)));
  assert.ok(Number.isInteger(r.score));
  assert.equal(r.grade, gradeOf(r.score));
  assert.deepEqual(r.center, posOf('ipBuildUp', 'us-DM'));
  assert.deepEqual(r.tol, toleranceFor('DM'));
  assert.equal(r.distance, 0);
  assert.equal(r.critical, false);
  // 5 m along x for a #6 (tx 4): d_n = 1.25, still well inside the ungated region.
  const off = evaluate(ctx, at(37, 32), { rules });
  assert.equal(off.gate, 1);
  approx(off.raw, 100 * (SCORE_WEIGHTS.zone * off.sZone + SCORE_WEIGHTS.rules * sRules), 1e-9);
  assert.equal(off.distance, 5);
});

test('rulesGate: full credit near the zone, fading to the floor far away', () => {
  assert.equal(rulesGate(1), 1);
  assert.equal(rulesGate(RULES_GATE.fullAt), 1);
  approx(rulesGate(0), RULES_GATE.floor, 1e-12);
  const mid = rulesGate(RULES_GATE.fullAt / 2);
  approx(mid, (1 + RULES_GATE.floor) / 2, 1e-12);
});

test('evaluate: a spot 20 m from the zone centre scores <= 40 even when every rule passes', () => {
  const ctx = ctxFor('ipBuildUp', 'us-ST'); // ST has the widest tolerance (6 x 6)
  const base = posOf('ipBuildUp', 'us-ST');
  const perfect = [fake('p', 3, 1)];
  for (const [dx, dy] of [[-20, 0], [0, 20], [0, -20], [-14.1, 14.1]]) {
    const r = evaluate(ctx, at(base.x + dx, base.y + dy), { rules: perfect });
    assert.ok(r.score <= 40, `(${dx}, ${dy}) scored ${r.score}`);
  }
});

test('evaluate: overrides for center, tolerance and the rule set', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  const r = evaluate(ctx, at(40, 32), { center: at(40, 32), tol: { tx: 1, ty: 1 }, rules: [] });
  assert.equal(r.score, 100);
  assert.equal(r.sRules, 1);
  assert.deepEqual(r.rules, []);
  assert.deepEqual(r.tol, { tx: 1, ty: 1 });
});

test('critical cap: a broken critical rule caps the score at 59', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  const crit = fake('crit', 1, 1, { critical: true, evaluate: () => ({ s: 1, critical: true, vars: {} }) });
  const r = evaluate(ctx, at(32, 32), { rules: [crit] });
  assert.equal(r.critical, true);
  assert.equal(r.score, CRITICAL_CAP);
  assert.equal(r.grade, 'D');
  // A rule not marked critical cannot cap, whatever it returns.
  const rogue = fake('rogue', 1, 1, { evaluate: () => ({ s: 1, critical: true, vars: {} }) });
  const r2 = evaluate(ctx, at(32, 32), { rules: [rogue] });
  assert.equal(r2.critical, false);
  assert.equal(r2.score, 100);
});

test('critical cap with the real offside rule: offside at the pass is never a pass mark', () => {
  const lw = posOf('ipBuildUp', 'us-LW');
  const spot = at(76, lw.y);            // 3 m past their last defender (x = 73)
  const opts = { center: spot };        // even if the zone centre were right there
  const atPass = evaluate(ctxFor('ipBuildUp', 'us-LW', { tags: { event: 'pass' } }), spot, opts);
  assert.equal(atPass.critical, true);
  assert.ok(atPass.score <= CRITICAL_CAP, `scored ${atPass.score}`);
  const noPass = evaluate(ctxFor('ipBuildUp', 'us-LW'), spot, opts);
  assert.equal(noPass.critical, false);
  assert.ok(noPass.score > atPass.score);
  assert.equal(noPass.rules.find((r) => r.id === 'offside').s, 0);
});

test('createScorer matches evaluate().raw', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LCM', { tags: { event: 'pass' } });
  const score = createScorer(ctx);
  for (const p of [at(46, 22), at(30, 30), at(60, 10), at(80, 22), at(45, 45)]) {
    approx(score(p), evaluate(ctx, p).raw, 1e-9, `at (${p.x}, ${p.y})`);
  }
});

test('score is always an integer in 0..100', () => {
  const ctx = ctxFor('ipBuildUp', 'us-RCM');
  for (let x = 0; x <= 105; x += 15) {
    for (let y = 0; y <= 68; y += 17) {
      const { score } = evaluate(ctx, at(x, y));
      assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `(${x}, ${y}) -> ${score}`);
    }
  }
});

test('lesson cap: a drill\'s own lesson rule clearly missed holds the spot to a C; other rules and static scenes are not capped', () => {
  const rules = [fake('lane', 2, (spot) => (spot.x > 40 ? 1 : 0.2)), fake('width', 3, 1), fake('spacing', 1, 0)]; // principles LANE, WIDTH, SPACING
  const id = 'us-LW';
  const base = posOf('ipBuildUp', id);
  const withLesson = (lesson) => buildContext(makeFrame('ipBuildUp', { tags: { lesson } }), { learnerId: id, base });
  const spot = at(base.x - 1, base.y); // close to the base: a high score but for the lesson
  const missedSpot = at(39, base.y);
  const ctx = withLesson('LANE');
  const ok = evaluate(ctx, spot, { rules, center: at(39.5, base.y) });
  const missed = evaluate(ctx, missedSpot, { rules, center: at(39.5, base.y) });
  assert.equal(ok.lessonMissed, false);
  assert.equal(missed.lessonMissed, true);
  assert.ok(missed.raw <= LESSON_CAP.cap + 1e-9, `capped: ${missed.raw}`);
  assert.equal(missed.rules.find((r) => r.id === 'lane').lesson, true, 'the result says which rule was the lesson missed');
  // The same spot without the lesson tag (Explore, Live) is not capped; nor when the failing rule is too light.
  const free = evaluate(withLesson(undefined), missedSpot, { rules, center: at(39.5, base.y) });
  assert.equal(free.lessonMissed, false);
  assert.ok(free.raw > LESSON_CAP.cap, `uncapped: ${free.raw}`);
  assert.equal(evaluate(withLesson('SPACING'), missedSpot, { rules, center: at(39.5, base.y) }).lessonMissed, false, 'spacing weighs 1');
  // The fast scorer agrees with evaluate().
  approx(createScorer(ctx, { rules, center: at(39.5, base.y) })(missedSpot), missed.raw, 1e-9);
});
