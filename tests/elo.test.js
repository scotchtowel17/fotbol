import { test, assert, approx } from './harness.js';
import {
  createSkills, predict, update, mastery, kFactor, principleTheta, ELO_DEFAULTS,
} from '../js/engine/elo.js';

// The adaptive-selection half (pickNext, ability, targetFor, the per-item difficulty ladder and the
// recent list) was removed by the 2026-10-01 audit; Drill ordering is js/ui/session.js pickScenario,
// tested in tests/session.test.js. These tests cover the mastery half that stayed.

const logit = (p) => Math.log(p / (1 - p));
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
const rep = (score01, extra = {}) => ({ principles: ['D3', 'U4'], role: 'LCB', score01, ...extra });

test('predict is the logistic of theta - d', () => {
  assert.equal(predict(0, 0), 0.5);
  approx(predict(1, 0), 1 / (1 + Math.exp(-1)));
  assert.ok(predict(2, 0) > predict(1, 0) && predict(1, 1) === 0.5);
});

test('a good rep raises the learner; a bad rep lowers them; the prediction itself changes nothing', () => {
  const s0 = createSkills();
  const up = update(s0, rep(1));
  assert.ok(up.theta.global > 0 && up.theta.byPrinciple.D3 > 0 && up.theta.byRole.LCB > 0);
  approx(up.theta.global, 0.5, 1e-12, 'K = 1 on the first attempt: 1 * (1 - 0.5)');
  const down = update(s0, rep(0));
  assert.ok(down.theta.global < 0 && down.theta.byPrinciple.D3 < 0);
  // Partial credit equal to the prediction changes nothing.
  const same = update(s0, rep(0.5));
  assert.equal(same.theta.global, 0);
});

test('secondary principles move half as far; counts are recorded; no item ladder or recent list remains', () => {
  const s = update(createSkills(), rep(1));
  approx(s.theta.byPrinciple.U4, ELO_DEFAULTS.secondaryWeight * s.theta.byPrinciple.D3, 1e-12);
  assert.deepEqual(s.counts, { global: 1, byPrinciple: { D3: 1, U4: 1 }, byRole: { LCB: 1 } });
  assert.ok(!('items' in s) && !('recent' in s), 'the adaptive half leaves no fields behind');
});

test('update is immutable', () => {
  const s0 = deepFreeze(update(createSkills(), rep(0.7)));
  const before = JSON.stringify(s0);
  const s1 = update(s0, rep(0.2)); // would throw in strict mode if it wrote to s0
  assert.equal(JSON.stringify(s0), before);
  assert.notEqual(s1, s0);
});

test('K decays with attempts: a / (1 + b n), floored at kMin', () => {
  assert.equal(kFactor(0), 1);
  approx(kFactor(20), 0.5);
  assert.equal(kFactor(10000), ELO_DEFAULTS.kMin);
  // Same skill, same score: the experienced learner moves half as far.
  const fresh = createSkills();
  const seasoned = { ...createSkills(), counts: { global: 20, byPrinciple: { D3: 20 }, byRole: { LCB: 20 } } };
  const dFresh = update(fresh, rep(1, { principles: ['D3'] })).theta.byPrinciple.D3;
  const dSeasoned = update(seasoned, rep(1, { principles: ['D3'] })).theta.byPrinciple.D3;
  approx(dSeasoned / dFresh, 0.5, 1e-12);
  assert.throws(() => update(fresh, { score01: NaN }));
});

test('mastery stars follow predicted success on a d = 0 item, after 3 attempts', () => {
  const withTheta = (p, n) => ({ ...createSkills(), theta: { global: 0, byPrinciple: { D3: logit(p) }, byRole: {} }, counts: { global: n, byPrinciple: { D3: n }, byRole: {} } });
  assert.equal(mastery(withTheta(0.55, 5), 'D3'), 0);
  assert.equal(mastery(withTheta(0.65, 5), 'D3'), 1);
  assert.equal(mastery(withTheta(0.75, 5), 'D3'), 2);
  assert.equal(mastery(withTheta(0.85, 5), 'D3'), 3);
  assert.equal(mastery(withTheta(0.95, 2), 'D3'), 0, 'not before 3 attempts');
  assert.equal(mastery(createSkills(), 'D3'), 0);

  // Consistent success earns stars; consistent failure does not.
  let good = createSkills(), bad = createSkills();
  for (let i = 0; i < 12; i++) {
    good = update(good, rep(0.95, { principles: ['D3'] }));
    bad = update(bad, rep(0.2, { principles: ['D3'] }));
  }
  assert.equal(mastery(good, 'D3'), 3);
  assert.equal(mastery(bad, 'D3'), 0);
  // A principle never practised reads as the global skill.
  assert.equal(principleTheta({ theta: { global: 0.5, byPrinciple: {} } }, 'U1'), 0.5);
});

test('corrupted progress (non-numeric skills or counts) is sanitised, never concatenated or thrown on', () => {
  // A hand-edited file: a string theta would make update() join strings ("0.30.2...").
  const bad = { theta: { global: '0.3', byPrinciple: { D3: 'x', U4: null }, byRole: { LCB: NaN } }, counts: { global: '5', byPrinciple: { D3: -1 } }, items: { a: { d: 'hard', n: 2 } }, recent: [1, 'b'] };
  const up = update(bad, rep(1));
  assert.equal(typeof up.theta.global, 'number');
  approx(up.theta.global, 0.5, 1e-12, 'a bad global skill reads as 0 (then one K = 1 step)');
  assert.ok(Number.isFinite(up.theta.byPrinciple.D3) && Number.isFinite(up.theta.byRole.LCB));
  assert.equal(up.counts.global, 1);
  assert.ok(!('items' in up) && !('recent' in up), 'a stored adaptive ladder is dropped');
  assert.equal(mastery({ counts: { byPrinciple: { D3: 'many' } }, theta: { byPrinciple: { D3: 5 } } }, 'D3'), 0);
});
