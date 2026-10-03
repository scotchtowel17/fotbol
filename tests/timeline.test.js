import { test, assert, approx, loadJSON } from './harness.js';
import {
  frameAt, learnerBaseAt, ballAt, meanBallAt, runTargets, possessionAt, nextEventAfter, carrierAt, ballEvents, timing, inGrace, sampleTimes, interpKeys, adjustCells,
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

  assert.deepEqual(frameAt(S, 0.5, { formations }).tags, { carrierFacing: 'forward' });
  assert.deepEqual(frameAt(S, 1, { formations }).tags, { carrierFacing: 'forward', nextEvent: 'pass', nextEventIn: 1 }, 'the pass is 1 s away');
  assert.deepEqual(frameAt(S, 2.5, { formations }).tags, { carrierFacing: 'forward', event: 'pass' });
  assert.deepEqual(frameAt(S, 3.5, { formations }).tags, { carrierFacing: 'backward', event: 'pass' });
  const constant = { ...S, phase: 'mid_block', timeline: { ...S.timeline, tags: { pressureOnBall: true } } };
  assert.deepEqual(frameAt(constant, 0.5, { formations }).tags, { pressureOnBall: true, phase: 'mid_block' });
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
  const quiet = { ...S, params: { autoPress: false, runSpeed: 0 } }; // the speed limit has its own test
  const gk = (t, ball, inPossession) => teamTargets(F, 'us', ball, { inPossession }).GK;
  // Defaults: mean ball over [t - lag - window, t - lag].
  const L = TIMELINE_DEFAULTS.reactionLag, W = TIMELINE_DEFAULTS.shapeWindow;
  assert.deepEqual(pos(frameAt(quiet, 1.5, { formations }), 'us-GK'), gk(1.5, meanBallAt(S, 1.5 - L - W, 1.5 - L), false));
  // Scenario params: no window → the ball at t - lag.
  const lagOnly = { ...quiet, params: { autoPress: false, shapeWindow: 0, runSpeed: 0 } };
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

test('settle and separation are averaged over adjustWindow, so no auto player is flung across the pitch', async () => {
  // With the HELIOS table, separation used to swing our #6 round a crossing opponent at 34 m/s (0.34 m in 0.01 s).
  const H = createFormation(await loadJSON('data/formations/helios-433.json'));
  const hf = { us: H, them: H };
  const peak = (params, from, to) => {
    let prev = null, worst = { v: 0 };
    for (let k = Math.round(from * 100); k <= Math.round(to * 100); k++) {
      const f = frameAt(S, k / 100, { formations: hf, params });
      if (prev) f.players.forEach((p, i) => { const v = dist(p, prev.players[i]) * 100; if (v > worst.v) worst = { v, id: p.id, t: k / 100 }; });
      prev = f;
    }
    return worst;
  };
  const snap = peak({ adjustWindow: 0 }, 0.5, 1.2);
  assert.ok(snap.v > 30, `fixture: without the averaging ${snap.id} snaps at ${snap.v.toFixed(1)} m/s`);
  const smooth = peak({}, 0, timing(S).duration);
  assert.ok(smooth.v < 22, `${smooth.id} moves ${smooth.v.toFixed(1)} m/s at t = ${smooth.t}`);
  // The averaging is a pure function of t: a later call for the same t gives the same frame.
  const again = frameAt(S, 0.83, { formations: hf }).players;
  frameAt(S, 0.83, { formations: hf }).players.forEach((p, i) => assert.ok(dist(p, again[i]) < 1e-9, p.id));
  // Its cells cover the window centred on t with weights summing to 1, and none when it is off.
  const cells = adjustCells(2.37);
  approx(cells.reduce((a, [, w]) => a + w, 0), 1, 1e-12);
  assert.ok(cells.every(([i]) => Math.abs(i * TIMELINE_DEFAULTS.adjustStep - 2.37) <= TIMELINE_DEFAULTS.adjustWindow / 2 + TIMELINE_DEFAULTS.adjustStep / 2 + 1e-9));
  assert.deepEqual(adjustCells(2.37, { ...TIMELINE_DEFAULTS, adjustWindow: 0 }), []);
});

test('a counter-attack: the press goes to the #8 already goal-side, and the #9 the play left behind never runs back past the carrier', async () => {
  // Ranked on formation spots, our #9 (whose spot is near the ball but who is 6 m up the pitch at the turnover)
  // used to be sent to press and sprinted 22 m in 2 s past the dribbler. At a key the press is ranked on where
  // the players are, so the #8 who is goal-side of the break takes it.
  const H = createFormation(await loadJSON('data/formations/helios-433.json'));
  const hf = { us: H, them: H };
  const COUNTER = {
    id: 'counter-fixture', title: 'Counter fixture', moment: 'defensive_transition', principles: ['T2'], learner: { role: 'DM' },
    timeline: {
      duration: 5.5,
      ball: [{ t: 0, x: 64, y: 45, event: 'carry' }, { t: 0.9, x: 66.5, y: 46.5, event: 'pass' }, { t: 1.2, x: 70.5, y: 48, event: 'carry' },
        { t: 2, x: 66, y: 46 }, { t: 2.8, x: 61, y: 44 }, { t: 3.4, x: 57, y: 42.5 }, { t: 5.5, x: 45, y: 38 }],
      possession: [{ t: 0, team: 'us' }, { t: 1.2, team: 'them' }],
      carrier: [{ t: 0, id: 'us-RCM' }, { t: 0.9, id: null }, { t: 1.2, id: 'them-LCM' }],
      players: {
        auto: true,
        overrides: [{ id: 'them-LCM', keys: [{ t: 0, x: 72, y: 47 }, { t: 0.9, x: 71.3, y: 47.8 }, { t: 1.2, x: 71.2, y: 48.1 }, { t: 2, x: 66.7, y: 46.1 },
          { t: 2.8, x: 61.7, y: 44.1 }, { t: 3.4, x: 57.7, y: 42.6 }, { t: 5.5, x: 45.7, y: 38.1 }] }],
      },
    },
  };
  for (const learnerId of [undefined, null]) { // the drill's playback (the #6 held back) and the free one (the learner's base)
    for (let t = 1.2; t <= 5.5 + 1e-9; t += 0.1) {
      const f = frameAt(COUNTER, t, { formations: hf, learnerId });
      const c = pos(f, 'them-LCM');
      assert.ok(pos(f, 'us-ST').x > c.x + 2, `t = ${t.toFixed(1)}: the #9 stays behind the play (${(pos(f, 'us-ST').x - c.x).toFixed(1)} m)`);
      for (const p of f.players.filter((q) => q.team === 'us' && Math.abs(dist(q, f.ball) - SCENE_DEFAULTS.pressDistance) < 1e-6)) {
        assert.ok(p.x < c.x, `t = ${t.toFixed(1)}: ${p.id} presses from the goal side`);
      }
    }
    const f = frameAt(COUNTER, 3.4, { formations: hf, learnerId });
    approx(dist(pos(f, 'us-RCM'), f.ball), SCENE_DEFAULTS.pressDistance, 1e-9, 'our #8 presses the break');
  }
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

test('tags.nextEvent: the next event by the team on the ball within eventAhead s (offside judges a pass about to be played)', () => {
  const cross = {
    ...S,
    timeline: {
      ...S.timeline,
      ball: [{ t: 0, x: 80, y: 60, event: 'carry' }, { t: 2, x: 90, y: 60, event: 'cross' }, { t: 3, x: 97, y: 30 }],
      possession: [{ t: 0, team: 'us' }, { t: 2.5, team: 'them' }],
      carrier: [{ t: 0, id: 'us-RW' }, { t: 2, id: null }],
      tags: [],
    },
  };
  assert.equal(frameAt(cross, 0.5, { formations }).tags.nextEvent, undefined, 'too far ahead');
  const soon = frameAt(cross, 1.4, { formations }).tags;
  assert.equal(soon.nextEvent, 'cross');
  assert.equal(soon.nextEventIn, 0.6);
  assert.equal(frameAt(cross, 2, { formations }).tags.nextEvent, undefined, 'strictly after t');
  assert.equal(nextEventAfter(cross, 1.4, 'them'), null, 'the cross is ours, not theirs');
  const lost = { ...cross, timeline: { ...cross.timeline, possession: [{ t: 0, team: 'us' }, { t: 1.8, team: 'them' }] } };
  assert.equal(frameAt(lost, 1.4, { formations }).tags.nextEvent, undefined, 'a turnover first: the event is not ours');
  const authored = { ...cross, timeline: { ...cross.timeline, tags: [{ t: 0, nextEvent: 'pass', nextEventIn: 0.2 }] } };
  assert.equal(frameAt(authored, 1.4, { formations }).tags.nextEvent, 'pass', 'an authored tag wins');
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

test('runTargets: every auto player runs to his formation target at no more than runSpeed m/s, a pure function of t', () => {
  // A 30 m pass in 1 s: the averaged ball moves at up to 30 m/s, and the formation targets with it.
  const pass = { ...S, timeline: { ...S.timeline, ball: [{ t: 0, x: 70, y: 34 }, { t: 1, x: 70, y: 34, event: 'pass' }, { t: 2, x: 40, y: 34 }, { t: 6, x: 40, y: 34 }], possession: [{ t: 0, team: 'them' }], carrier: [], overrides: [] } };
  const P = TIMELINE_DEFAULTS, dt = 0.05, opts = { formations, possession: 'them' };
  const target = (t) => teamTargets(F, 'us', meanBallAt(pass, t - P.reactionLag - P.shapeWindow, t - P.reactionLag), { inPossession: false, offset: true });
  let fastest = 0, fastestTarget = 0, prev = runTargets(pass, 0, opts), prevT = target(0);
  for (let t = dt; t <= 6 + 1e-9; t += dt) {
    const r = runTargets(pass, t, opts), q = target(t);
    for (const role of Object.keys(q)) {
      fastest = Math.max(fastest, dist(r.us[role], prev.us[role]) / dt);
      fastestTarget = Math.max(fastestTarget, dist(q[role], prevT[role]) / dt);
    }
    prev = r; prevT = q;
  }
  assert.ok(fastestTarget > 12, `the targets themselves fly (${fastestTarget.toFixed(1)} m/s)`);
  assert.ok(fastest <= P.runSpeed + 1e-6, `fastest ${fastest}`);
  const lag = Math.max(...Object.keys(target(2.3)).map((role) => dist(runTargets(pass, 2.3, opts).us[role], target(2.3)[role])));
  assert.ok(lag > 2, 'someone is still on the way after the pass...');
  for (const role of Object.keys(target(6))) assert.ok(dist(runTargets(pass, 6, opts).us[role], target(6)[role]) < 1e-9, '...and everyone is there once the ball is still');
  // A pure function of t: the same at any time whatever was asked before, and the run can be switched off.
  const fresh = { ...pass, timeline: { ...pass.timeline, ball: pass.timeline.ball.map((k) => ({ ...k })) } };
  assert.deepEqual(runTargets(fresh, 2.71, opts), runTargets(pass, 2.71, opts));
  assert.equal(runTargets(pass, 2.3, { ...opts, params: { ...P, runSpeed: 0 } }), undefined);
  // A key written later (as sequence.js writes a run) is seen; samples before it are kept.
  const growing = { timeline: { ball: [{ t: 0, x: 50, y: 34 }, { t: 1, x: 50, y: 34 }] } };
  const before = runTargets(growing, 1.2, opts);
  growing.timeline.ball.push({ t: 2, x: 20, y: 34 });
  assert.deepEqual(runTargets(growing, 1.2, opts), before, 'the new key is after the window at 1.2 s');
  assert.notDeepEqual(runTargets(growing, 3, opts), before, 'the new key moves the targets later');
  growing.timeline.ball.pop();
  assert.deepEqual(runTargets(growing, 3, opts), before, 'taken back');
  // The learner's base is judged on the targets themselves; the frame's auto players are still running.
  const id = 'us-LCB';
  const settled = pos(frameAt(pass, 2.3, { formations, learnerId: null, params: { runSpeed: 0 } }), id);
  assert.ok(dist(learnerBaseAt(pass, 2.3, { formations, learnerId: id }), settled) < 1e-9);
  const running = pass.timeline.ball.length && Object.keys(target(2.3)).filter((role) => dist(runTargets(pass, 2.3, opts).us[role], target(2.3)[role]) > 1);
  assert.ok(running.length > 0, `some auto players are still on the way: ${running}`);
});

test('learnerBaseAt: right after a state change the base is where the new state wants the role, not the blended auto player', () => {
  // t = 3.2: our RB has just intercepted (possession change at t = 3), so every auto player is still blending.
  const t = 3.2;
  const unblended = { possessionBlend: 0, carrierBlend: 0, maxBlend: 0, runSpeed: 0 };
  for (const role of ['LCB', 'DM', 'ST']) {
    const id = `us-${role}`;
    const want = pos(frameAt(S, t, { formations, learnerId: null, params: unblended }), id);
    const blended = pos(frameAt(S, t, { formations, learnerId: null }), id);
    assert.deepEqual(learnerBaseAt(S, t, { formations, learnerId: id }), want, role);
    if (role === 'ST') assert.ok(dist(want, blended) > 0.5, 'the fixture really is mid-blend');
  }
});
