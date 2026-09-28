import { test, assert, approx } from './harness.js';
import {
  createSkills, predict, update, mastery, pickNext, kFactor, ability, targetFor, principleTheta, ELO_DEFAULTS,
} from '../js/engine/elo.js';

const logit = (p) => Math.log(p / (1 - p));
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
const rep = (itemId, score01, extra = {}) => ({ itemId, principles: ['D3', 'U4'], role: 'LCB', score01, ...extra });

test('predict is the logistic of theta - d', () => {
  assert.equal(predict(0, 0), 0.5);
  approx(predict(1, 0), 1 / (1 + Math.exp(-1)));
  assert.ok(predict(2, 0) > predict(1, 0) && predict(1, 1) === 0.5);
});

test('a good rep raises the learner and lowers the item; a bad rep does the opposite', () => {
  const s0 = createSkills();
  const up = update(s0, rep('a', 1));
  assert.ok(up.theta.global > 0 && up.theta.byPrinciple.D3 > 0 && up.theta.byRole.LCB > 0);
  assert.ok(up.items.a.d < 0, 'the item looked easier than expected');
  approx(up.theta.global, 0.5, 1e-12, 'K = 1 on the first attempt: 1 * (1 - 0.5)');
  const down = update(s0, rep('a', 0));
  assert.ok(down.theta.global < 0 && down.theta.byPrinciple.D3 < 0 && down.items.a.d > 0);
  // Partial credit equal to the prediction changes nothing.
  const same = update(s0, rep('a', 0.5));
  assert.equal(same.theta.global, 0);
  assert.equal(same.items.a.d, 0);
});

test('secondary principles move half as far; counts and recent are recorded', () => {
  const s = update(createSkills(), rep('a', 1));
  approx(s.theta.byPrinciple.U4, ELO_DEFAULTS.secondaryWeight * s.theta.byPrinciple.D3, 1e-12);
  assert.deepEqual(s.counts, { global: 1, byPrinciple: { D3: 1, U4: 1 }, byRole: { LCB: 1 } });
  assert.deepEqual(s.items.a.n, 1);
  assert.deepEqual(s.recent, ['a']);
  const s2 = update(update(s, rep('b', 1)), rep('a', 1));
  assert.deepEqual(s2.recent, ['b', 'a'], 'distinct ids, most recent last');
});

test('the authored difficulty is the prior for an unseen item', () => {
  const s = update(createSkills(), rep('hard', 1, { prior: 2 }));
  approx(s.items.hard.d, 2 - (1 - predict(0, 2)), 1e-12, 'starts from the prior, then moves by K (s - P)');
  approx(s.theta.global, 1 - predict(0, 2), 1e-12, 'big gain for beating a hard item');
  assert.ok(update(createSkills(), rep('easy', 1, { prior: -2 })).theta.global < s.theta.global, 'small gain for an easy one');
});

test('update is immutable', () => {
  const s0 = deepFreeze(update(createSkills(), rep('a', 0.7)));
  const before = JSON.stringify(s0);
  const s1 = update(s0, rep('b', 0.2)); // would throw in strict mode if it wrote to s0
  assert.equal(JSON.stringify(s0), before);
  assert.notEqual(s1, s0);
});

test('K decays with attempts: a / (1 + b n), floored at kMin', () => {
  assert.equal(kFactor(0), 1);
  approx(kFactor(20), 0.5);
  assert.equal(kFactor(10000), ELO_DEFAULTS.kMin);
  // Same skill, same item, same score: the experienced learner moves half as far.
  const fresh = createSkills();
  const seasoned = { ...createSkills(), counts: { global: 20, byPrinciple: { D3: 20 }, byRole: { LCB: 20 } } };
  const dFresh = update(fresh, rep('a', 1, { principles: ['D3'] })).theta.byPrinciple.D3;
  const dSeasoned = update(seasoned, rep('a', 1, { principles: ['D3'] })).theta.byPrinciple.D3;
  approx(dSeasoned / dFresh, 0.5, 1e-12);
  assert.throws(() => update(fresh, { itemId: 'a', score01: NaN }));
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
    good = update(good, rep(`g${i % 4}`, 0.95, { principles: ['D3'] }));
    bad = update(bad, rep(`b${i % 4}`, 0.2, { principles: ['D3'] }));
  }
  assert.equal(mastery(good, 'D3'), 3);
  assert.equal(mastery(bad, 'D3'), 0);
});

test('pickNext: weakest principle first, then predicted success closest to the target', () => {
  const skills = {
    ...createSkills(),
    theta: { global: 0.5, byPrinciple: { D1: 1.5, D3: -0.5 }, byRole: {} },
    counts: { global: 30, byPrinciple: { D1: 10, D3: 10 }, byRole: {} },
  };
  const cands = [
    { id: 'd1-easy', principles: ['D1'], learner: { role: 'LCB' }, difficulty: -2 },
    { id: 'd3-hard', principles: ['D3'], learner: { role: 'LCB' }, difficulty: 2 },
    { id: 'd3-fit', principles: ['D3'], learner: { role: 'LCB' }, difficulty: -1 },
    { id: 'd3-easy', principles: ['D3'], learner: { role: 'LCB' }, difficulty: -3 },
  ];
  assert.equal(targetFor(skills), ELO_DEFAULTS.targetP);
  // ability = mean(D3 -0.5, role → global 0.5) = 0; P(d = -1) = 0.73 is closest to 0.75.
  approx(ability(skills, cands[2]), 0);
  assert.equal(pickNext(skills, cands).id, 'd3-fit');
  // A calibrated item difficulty overrides the authored one.
  const calibrated = { ...skills, items: { 'd3-easy': { d: -1.1, n: 5 }, 'd3-fit': { d: 1, n: 5 } } };
  assert.equal(pickNext(calibrated, cands).id, 'd3-easy');
  // A principle never practised reads as the global skill (0.5), stronger than D3 (-0.5).
  assert.equal(pickNext(skills, [cands[0], { id: 'u1', principles: ['U1'] }, cands[1]]).id, 'd3-hard');
  assert.equal(principleTheta(skills, 'U1'), 0.5);
  assert.equal(pickNext(skills, []), null);
});

test('pickNext avoids the last 3 scenarios, relaxing only when it has to', () => {
  const cands = ['a', 'b', 'c', 'd'].map((id) => ({ id, principles: ['D3'], difficulty: 0 }));
  let s = createSkills();
  for (const id of ['a', 'b', 'c']) s = update(s, { itemId: id, principles: ['D3'], score01: 0.9 });
  assert.equal(pickNext(s, cands).id, 'd');
  // Only recently seen candidates: skip the most recent ones first.
  assert.equal(pickNext(s, cands.slice(0, 3)).id, 'a');
  assert.equal(pickNext(s, cands.slice(1, 3)).id, 'b');
  assert.equal(pickNext(s, [cands[2]]).id, 'c');
});

test('warm-up aims easier (0.85), then settles at 0.75; choices are deterministic', () => {
  const cands = [{ id: 'p75', principles: ['D3'], difficulty: -logit(0.75) }, { id: 'p85', principles: ['D3'], difficulty: -logit(0.85) }];
  const fresh = createSkills();
  assert.equal(targetFor(fresh), ELO_DEFAULTS.warmupTargetP);
  assert.equal(pickNext(fresh, cands).id, 'p85');
  const warm = { ...createSkills(), counts: { global: ELO_DEFAULTS.warmupAttempts, byPrinciple: {}, byRole: {} } };
  assert.equal(pickNext(warm, cands).id, 'p75');
  assert.equal(pickNext(warm, cands), pickNext(warm, cands));
  // Older saved progress without `recent` still works.
  const legacy = { theta: { global: 0, byPrinciple: {}, byRole: {} }, counts: { global: 0, byPrinciple: {}, byRole: {} }, items: {} };
  assert.deepEqual(update(legacy, { itemId: 'x', score01: 1 }).recent, ['x']);
});

test('corrupted progress (non-numeric skills, counts or items) is sanitised, never concatenated or thrown on', () => {
  const cands = [
    { id: 'a', principles: ['D3'], learner: { role: 'LCB' } },
    { id: 'b', principles: ['U4'], learner: { role: 'LCB' } },
  ];
  // A hand-edited file: a string theta would make update() join strings ("0.30.2...").
  const bad = { theta: { global: '0.3', byPrinciple: { D3: 'x', U4: null }, byRole: { LCB: NaN } }, counts: { global: '5', byPrinciple: { D3: -1 } }, items: { a: { d: 'hard', n: 2 } }, recent: [1, 'b'] };
  const up = update(bad, rep('a', 1));
  assert.equal(typeof up.theta.global, 'number');
  approx(up.theta.global, 0.5, 1e-12, 'a bad global skill reads as 0 (then one K = 1 step)');
  assert.ok(Number.isFinite(up.theta.byPrinciple.D3) && Number.isFinite(up.theta.byRole.LCB));
  assert.equal(up.counts.global, 1);
  assert.deepEqual(up.items.a, { d: up.items.a.d, n: 1 }, 'a bad item restarts from the prior');
  assert.ok(Number.isFinite(up.items.a.d));
  assert.deepEqual(up.recent, ['b', 'a']);
  // pickNext never throws on such a file and still returns a candidate.
  assert.doesNotThrow(() => pickNext({ theta: { global: 'n/a' } }, cands));
  assert.ok(cands.includes(pickNext({ theta: { global: 'n/a' } }, cands)));
  assert.ok(cands.includes(pickNext({ theta: { global: 0, byPrinciple: { D3: 'x', U4: 'y' } } }, cands)));
  assert.equal(mastery({ counts: { byPrinciple: { D3: 'many' } }, theta: { byPrinciple: { D3: 5 } } }, 'D3'), 0);
  assert.equal(targetFor({ counts: { global: 'lots' } }), ELO_DEFAULTS.warmupTargetP);
});
