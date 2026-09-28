import { test, assert, approx, loadJSON } from './harness.js';
import {
  frameAt, learnerBaseAt, ballAt, meanBallAt, possessionAt, carrierAt, ballEvents, timing, inGrace, sampleTimes, interpKeys,
  TIMELINE_DEFAULTS,
} from '../js/engine/timeline.js';
import { SCENE_DEFAULTS } from '../js/engine/scene.js';
import { createFormation, teamTargets } from '../js/engine/formation.js';
import { dist } from '../js/engine/geometry.js';

const F = createFormation();
const formations = { us: F, them: F };
const pos = (frame, id) => { const p = frame.players.find((q) => q.id === id); return { x: p.x, y: p.y }; };

/** Their #8 carries, passes; our RB intercepts at t = 3 and carries on. */
const S = Object.freeze({
  id: 'timeline-fixture',
  title: 'Timeline fixture',
  moment: 'defensive_transition',
  principles: ['D1'],
  learner: { role: 'LCB' },
  timeline: {
    duration: 6,
    freezeAt: 4,
    ball: [{ t: 0, x: 50, y: 34, event: 'carry' }, { t: 2, x: 30, y: 34, event: 'pass' }, { t: 4, x: 30, y: 54 }],
    possession: [{ t: 0, team: 'them' }, { t: 3, team: 'us' }],
    carrier: [{ t: 0, id: 'them-LCM' }, { t: 2, id: null }, { t: 3, id: 'us-RB' }],
    players: { auto: true, overrides: [{ id: 'them-ST', keys: [{ t: 0, x: 40, y: 30 }, { t: 2, x: 30, y: 40 }] }] },
    tags: [{ t: 0, carrierFacing: 'forward' }, { t: 2, event: 'pass' }, { t: 3, carrierFacing: 'backward' }],
  },
});

test('ball: linear between keys, held before the first and after the last', () => {
  assert.deepEqual(frameAt(S, 1, { formations }).ball, { x: 40, y: 34 });
  assert.deepEqual(frameAt(S, 3, { formations }).ball, { x: 30, y: 44 });
  assert.deepEqual(ballAt(S, -1), { x: 50, y: 34 });
  assert.deepEqual(ballAt(S, 10), { x: 30, y: 54 });
  assert.equal(interpKeys([], 1), null);
});

test('meanBallAt is the exact average of the ball path over a window', () => {
  approx(meanBallAt(S, 0, 2).x, 40); // linear 50 → 30
  const m = meanBallAt(S, 1, 3); // 1 s from 40 → 30 (mean 35), 1 s from (30,34) → (30,44) (mean y 39)
  approx(m.x, (35 + 30) / 2);
  approx(m.y, (34 + 39) / 2);
  assert.deepEqual(meanBallAt(S, 2, 2), ballAt(S, 2));
});

test('possession, carrier and tags are step functions', () => {
  assert.equal(possessionAt(S, -1), 'them');
  assert.equal(frameAt(S, 2.99, { formations }).possession, 'them');
  assert.equal(frameAt(S, 3, { formations }).possession, 'us');
  assert.equal(frameAt(S, 1, { formations }).carrierId, 'them-LCM');
  assert.equal(frameAt(S, 2.5, { formations }).carrierId, null, 'ball in flight');
  assert.equal(frameAt(S, 3.5, { formations }).carrierId, 'us-RB');
  assert.equal(carrierAt({ timeline: { carrier: [{ t: 1, id: 'them-ST' }] } }, 0.5), undefined, 'automatic before the first key');

  assert.deepEqual(frameAt(S, 1, { formations }).tags, { carrierFacing: 'forward' });
  assert.deepEqual(frameAt(S, 2.5, { formations }).tags, { carrierFacing: 'forward', event: 'pass' });
  assert.deepEqual(frameAt(S, 3.5, { formations }).tags, { carrierFacing: 'backward', event: 'pass' });
  const constant = { ...S, phase: 'mid_block', timeline: { ...S.timeline, tags: { pressureOnBall: true } } };
  assert.deepEqual(frameAt(constant, 1, { formations }).tags, { pressureOnBall: true, phase: 'mid_block' });
});

test('overrides interpolate linearly and win; the explicit carrier is placed at the ball', () => {
  assert.deepEqual(pos(frameAt(S, 1, { formations }), 'them-ST'), { x: 35, y: 35 });
  assert.deepEqual(pos(frameAt(S, 5, { formations }), 'them-ST'), { x: 30, y: 40 });
  const f = frameAt(S, 1, { formations });
  approx(dist(pos(f, 'them-LCM'), f.ball), SCENE_DEFAULTS.carrierOffset, 1e-9);
  const g = frameAt(S, 5.5, { formations }); // blend after the interception is over
  approx(dist(pos(g, 'us-RB'), g.ball), SCENE_DEFAULTS.carrierOffset, 1e-9);
});

test('in flight nobody carries or presses; the passer drifts back into shape', () => {
  const f = frameAt(S, 2.6, { formations });
  assert.equal(f.carrierId, null);
  const nearest = Math.min(...f.players.filter((p) => p.id !== 'them-ST').map((p) => dist(p, f.ball)));
  assert.ok(nearest > 2, `nobody glued to the ball in flight (${nearest.toFixed(2)} m)`);
});

test('learnerSpot pins the learner for the whole playback', () => {
  const spot = { x: 20, y: 25 };
  for (const t of [0, 1.5, 3.2, 5]) assert.deepEqual(pos(frameAt(S, t, { formations, learnerSpot: spot }), 'us-LCB'), spot);
  // Without it the learner follows its formation spot.
  assert.ok(dist(pos(frameAt(S, 0, { formations }), 'us-LCB'), pos(frameAt(S, 5, { formations }), 'us-LCB')) > 1);
});

test('auto players react to the lagged, averaged ball; scenario.params pass through', () => {
  const quiet = { ...S, params: { autoPress: false } };
  const gk = (t, ball, inPossession) => teamTargets(F, 'us', ball, { inPossession }).GK;
  // Defaults: mean ball over [t - lag - window, t - lag].
  const L = TIMELINE_DEFAULTS.reactionLag, W = TIMELINE_DEFAULTS.shapeWindow;
  assert.deepEqual(pos(frameAt(quiet, 1.5, { formations }), 'us-GK'), gk(1.5, meanBallAt(S, 1.5 - L - W, 1.5 - L), false));
  // Scenario params: no window → the ball at t - lag.
  const lagOnly = { ...quiet, params: { autoPress: false, shapeWindow: 0 } };
  assert.deepEqual(pos(frameAt(lagOnly, 1.5, { formations }), 'us-GK'), gk(1.5, ballAt(S, 1.5 - L), false));
  // Caller params win over scenario params.
  assert.deepEqual(pos(frameAt(lagOnly, 1.5, { formations, params: { reactionLag: 0 } }), 'us-GK'), gk(1.5, ballAt(S, 1.5), false));
  // players.auto = false freezes the shape.
  const frozen = { ...quiet, timeline: { ...S.timeline, players: { ...S.timeline.players, auto: false } } };
  assert.deepEqual(pos(frameAt(frozen, 1, { formations }), 'us-GK'), pos(frameAt(frozen, 2.5, { formations }), 'us-GK'));
});

/** They carry at 4 m/s, lose it to our #6 at t = 2, and we carry on at 4 m/s. */
const TURNOVER = {
  id: 'turnover-fixture',
  title: 'Turnover fixture',
  moment: 'attacking_transition',
  principles: ['T4'],
  learner: { role: 'LCM' },
  timeline: {
    duration: 5,
    ball: [{ t: 0, x: 52, y: 30 }, { t: 2, x: 44, y: 30 }, { t: 5, x: 56, y: 30 }],
    possession: [{ t: 0, team: 'them' }, { t: 2, team: 'us' }],
    carrier: [{ t: 0, id: 'them-RCM' }, { t: 2, id: 'us-DM' }],
  },
};

function maxStep(s, from, to, dt, params) {
  let prev = frameAt(s, from, { formations, params }), worst = { d: 0 };
  for (let t = from + dt; t <= to + 1e-9; t += dt) {
    const f = frameAt(s, t, { formations, params });
    f.players.forEach((p, i) => { const d = dist(p, prev.players[i]); if (d > worst.d) worst = { d, id: p.id, t }; });
    prev = f;
  }
  return worst;
}

test('turnover: everyone moves smoothly (< 1.5 m per 0.1 s), no teleporting', () => {
  const w = maxStep(TURNOVER, 1, 5, 0.05);
  assert.ok(w.d < 0.75, `${w.id} moved ${w.d.toFixed(2)} m in 0.05 s at t = ${w.t.toFixed(2)}`);
  // Without blending the same scenario does teleport players, so the blend is doing the work.
  const hard = maxStep(TURNOVER, 1, 5, 0.05, { possessionBlend: 0, carrierBlend: 0, recoverSpeed: 1e9 });
  assert.ok(hard.d > 3, `expected a jump without blending, got ${hard.d.toFixed(2)} m`);
});

test('turnover: continuous at the switch and equal to the new state once the blend is over', () => {
  const tk = 2;
  const before = frameAt(TURNOVER, tk - 1e-6, { formations }), at = frameAt(TURNOVER, tk, { formations });
  at.players.forEach((p, i) => assert.ok(dist(p, before.players[i]) < 1e-3, `${p.id} continuous at the turnover`));
  const hard = { possessionBlend: 0, carrierBlend: 0, recoverSpeed: 1e9 };
  const t = tk + TIMELINE_DEFAULTS.maxBlend;
  assert.deepEqual(frameAt(TURNOVER, t, { formations }).players, frameAt(TURNOVER, t, { formations, params: hard }).players);
  // Mid-blend the defending shape is between the two states.
  const mid = pos(frameAt(TURNOVER, tk + 0.5, { formations }), 'us-LB').x;
  const old = pos(frameAt(TURNOVER, tk + 0.5, { formations, params: { ...hard } }), 'us-LB').x;
  assert.ok(mid < old - 1, 'our LB is still pushing up after we win the ball');
});

test('the automatic presser is committed to until the next key, then re-decided', () => {
  // Their #9 carries from (70, 40) to (30, 40). The press is decided at t = 0 (and at each ball key).
  const run = {
    id: 'press-fixture', title: 'Press fixture', moment: 'out_of_possession', principles: ['D1'], learner: { role: 'LB' },
    timeline: { duration: 6, ball: [{ t: 0, x: 70, y: 40 }, { t: 6, x: 30, y: 40 }], possession: [{ t: 0, team: 'them' }], carrier: [{ t: 0, id: 'them-ST' }] },
  };
  const presserAt = (s, t) => {
    const f = frameAt(s, t, { formations });
    return f.players.filter((p) => p.team === 'us' && Math.abs(dist(p, f.ball) - SCENE_DEFAULTS.pressDistance) < 1e-6).map((p) => p.id);
  };
  // The #9 is left where the table puts him (no T3 recovery to the ball), so the ball really goes past him.
  run.params = { shape: { stBeyondBall: Infinity } };
  for (const t of [0, 2, 4, 6]) assert.deepEqual(presserAt(run, t), ['us-ST'], `same presser at t = ${t}`);
  // With a ball key at t = 3 the decision is refreshed: the ball has gone past our #9, so our #8 takes over (blended).
  const keyed = { ...run, timeline: { ...run.timeline, ball: [{ t: 0, x: 70, y: 40 }, { t: 3, x: 50, y: 40 }, { t: 6, x: 30, y: 40 }] } };
  assert.deepEqual(presserAt(keyed, 2.9), ['us-ST']);
  assert.deepEqual(presserAt(keyed, 3.3), [], 'handing over');
  assert.deepEqual(presserAt(keyed, 6), ['us-RCM']);
  const w = maxStep(keyed, 0, 6, 0.05);
  assert.ok(w.d < 0.75, `${w.id} moved ${w.d.toFixed(2)} m in 0.05 s at t = ${w.t.toFixed(2)}`);
});

test('the example scenario plays back smoothly and freezes on the intended picture', async () => {
  const ex = await loadJSON('data/scenarios/_example.json');
  const w = maxStep(ex, 0, timing(ex).duration, 0.05);
  // The shape follows a passed ball (13.5 m in 1 s) and our #9, recovering to the ball's height (T3),
  // tracks it 1:1 while the carrier change blends in: about 16 m/s at most, never a jump.
  assert.ok(w.d < 0.9, `${w.id} moved ${w.d.toFixed(2)} m in 0.05 s at t = ${w.t.toFixed(2)}`);
  const f = frameAt(ex, timing(ex).freezeAt, { formations });
  assert.equal(f.players.length, 22);
  assert.equal(f.carrierId, 'them-ST');
  assert.equal(f.possession, 'them');
  assert.deepEqual(frameAt(ex, 3.3, { formations }), frameAt(ex, 3.3, { formations }), 'deterministic');
});

test('ballEvents merges ball-key and tag events, sorted and de-duplicated', () => {
  assert.deepEqual(ballEvents(S), [{ t: 0, event: 'carry' }, { t: 2, event: 'pass' }]);
  const events = [{ t: 2, event: 'pass' }];
  assert.ok(inGrace(events, 2.5));
  assert.ok(!inGrace(events, 2 + TIMELINE_DEFAULTS.eventGrace));
  assert.ok(!inGrace(events, 1.9));
});

test('timing, sampleTimes and a derived ballMovingBack tag', () => {
  assert.deepEqual(timing(S), { duration: 6, freezeAt: 4 });
  assert.deepEqual(timing({ timeline: { ball: [{ t: 0, x: 1, y: 1 }, { t: 3.5, x: 2, y: 2 }] } }), { duration: 3.5, freezeAt: 3.5 });
  assert.equal(timing({ timeline: { duration: 2, freezeAt: 9 } }).freezeAt, 2);
  const ts = sampleTimes(S);
  assert.equal(ts.length, 61);
  assert.equal(ts[0], 0);
  approx(ts.at(-1), 6);

  // Their ball goes back towards their own goal (+x) by 6 m in a second.
  const back = { ...S, timeline: { ...S.timeline, ball: [{ t: 0, x: 60, y: 30 }, { t: 1, x: 66, y: 30 }], carrier: [], tags: [] } };
  assert.equal(frameAt(back, 1, { formations }).tags.ballMovingBack, true);
  assert.equal(frameAt(back, 0.2, { formations }).tags.ballMovingBack, undefined, 'not far enough yet');
  const authored = { ...back, timeline: { ...back.timeline, tags: [{ t: 0, ballMovingBack: false }] } };
  assert.equal(frameAt(authored, 1, { formations }).tags.ballMovingBack, false, 'an authored tag wins');
});

test('learnerBaseAt: the learner role as an auto player would stand (formation spot or press), never the dragged spot', () => {
  // t = 1: their #8 carries at (40, 34); our LCB is an ordinary third defender.
  const base = learnerBaseAt(S, 1, { formations });
  assert.deepEqual(base, pos(frameAt(S, 1, { formations }), 'us-LCB'), 'the formation spot the learner playback uses');
  assert.deepEqual(learnerBaseAt(S, 1, { formations, learnerSpot: { x: 5, y: 5 } }), base, 'the dragged spot is ignored');
  // learnerId: null places everyone automatically; the learner's own playback holds the learner back.
  const free = frameAt(S, 1, { formations, learnerId: null });
  assert.equal(free.players.length, 22);
  // Whoever presses in the free playback: as the learner, that role's base is the press spot.
  const presser = free.players.filter((p) => p.team === 'us' && p.role !== 'GK').sort((a, b) => dist(a, free.ball) - dist(b, free.ball))[0];
  const asLearner = learnerBaseAt(S, 1, { formations, learnerId: presser.id });
  assert.deepEqual(asLearner, pos(free, presser.id));
  assert.ok(dist(asLearner, free.ball) < dist(pos(frameAt(S, 1, { formations, learnerId: presser.id }), presser.id), free.ball), 'nearer the ball than its formation spot');
  assert.throws(() => learnerBaseAt({ ...S, learner: undefined }, 1, { formations }), TypeError);
});
