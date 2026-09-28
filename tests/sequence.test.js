// js/engine/sequence.js: the Live-mode sequence generator and the incremental playback cursor.
import { test, assert, loadJSON } from './harness.js';
import {
  generateSequence, createPlayback, graceEvents, hashSeed, mulberry32, createRng, SEQUENCE_DEFAULTS,
} from '../js/engine/sequence.js';
import { createFormation } from '../js/engine/formation.js';
import { validateScenario, normalizeScenario, learnerId as learnerIdOf } from '../js/engine/scenario.js';
import { frameAt, learnerBaseAt, possessionAt, carrierAt } from '../js/engine/timeline.js';
import { parsePlayerId, LEARNABLE_ROLES } from '../js/engine/roles.js';
import { onPitch } from '../js/engine/pitch.js';

const table = await loadJSON('data/formations/helios-433.json');
const principles = await loadJSON('data/principles.json');
const example = await loadJSON('data/scenarios/_example.json');
const F = createFormation(table);
const formations = { us: F, them: F };

const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const roleFor = (seed) => LEARNABLE_ROLES[seed % LEARNABLE_ROLES.length];
const cache = new Map();
const gen = (seed, extra = {}) => {
  const key = JSON.stringify([seed, extra]);
  if (!cache.has(key)) cache.set(key, generateSequence({ seed, role: roleFor(seed), formations, ...extra }));
  return cache.get(key);
};
const segSpeed = (a, b) => Math.hypot(b.x - a.x, b.y - a.y) / (b.t - a.t);

test('seeded randomness: mulberry32 and hashSeed are deterministic, and strings hash stably', () => {
  const a = mulberry32(42), b = mulberry32(42);
  const xs = Array.from({ length: 5 }, () => a());
  assert.deepEqual(Array.from({ length: 5 }, () => b()), xs);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(Array.from({ length: 5 }, mulberry32(43)), xs);
  assert.equal(hashSeed(7), 7);
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
  const r = createRng('x');
  for (let i = 0; i < 50; i++) {
    const n = r.int(2, 4);
    assert.ok(n >= 2 && n <= 4 && Number.isInteger(n));
  }
  assert.equal(r.weighted([0, 0, 0]), -1);
  assert.equal(r.weighted([0, 5, 0]), 1);
});

test('generateSequence is deterministic: the same seed gives an identical scenario, another seed a different one', () => {
  const a = generateSequence({ seed: 99, role: 'LB', formations });
  const b = generateSequence({ seed: 99, role: 'LB', formations });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notDeepEqual(generateSequence({ seed: 100, role: 'LB', formations }).timeline.ball, a.timeline.ball);
  const s = generateSequence({ seed: 'Kick Off!', role: 'ST', formations });
  assert.deepEqual(s, generateSequence({ seed: 'Kick Off!', role: 'ST', formations }));
  assert.equal(s.id, 'live-kick-off');
  assert.equal(s.source.seed, 'Kick Off!');
});

test('every generated sequence is a valid scenario (many seeds, every role)', () => {
  for (const seed of SEEDS) {
    const s = gen(seed);
    assert.deepEqual(validateScenario(s, { principles }), [], `seed ${seed}`);
    assert.equal(s.module, 'live');
    assert.equal(s.learner.role, roleFor(seed));
    assert.equal(s.timeline.duration, SEQUENCE_DEFAULTS.duration);
    const last = s.timeline.ball[s.timeline.ball.length - 1];
    assert.equal(last.t, s.timeline.duration, 'the ball is keyed up to the end');
  }
  for (const d of [20, 60]) assert.deepEqual(validateScenario(generateSequence({ seed: 5, role: 'DM', formations, duration: d }), { principles }), []);
  assert.throws(() => generateSequence({ seed: 1, role: 'GK', formations }));
  assert.throws(() => generateSequence({ seed: 1, role: 'DM' }));
});

test('ball speeds are realistic: passes 12-20 m/s, carries 4-7 m/s, nothing faster than a pass', () => {
  let passes = 0, carries = 0;
  for (const seed of SEEDS) {
    const b = gen(seed).timeline.ball;
    for (let i = 0; i < b.length - 1; i++) {
      const v = segSpeed(b[i], b[i + 1]);
      assert.ok(v <= SEQUENCE_DEFAULTS.passSpeed[1] + 1e-6, `seed ${seed} key ${i}: ${v.toFixed(2)} m/s`);
      if (b[i].event === 'pass') {
        passes++;
        assert.ok(v >= SEQUENCE_DEFAULTS.passSpeed[0] - 0.05, `seed ${seed} pass at ${b[i].t}: ${v.toFixed(2)} m/s`);
      }
      if (b[i].event === 'carry') {
        carries++;
        assert.ok(v >= SEQUENCE_DEFAULTS.carrySpeed[0] - 0.05 && v <= SEQUENCE_DEFAULTS.carrySpeed[1] + 0.05, `seed ${seed} carry at ${b[i].t}: ${v.toFixed(2)} m/s`);
      }
    }
    assert.ok(b.every((k) => onPitch(k)), 'the ball stays on the pitch');
  }
  assert.ok(passes / SEEDS.length >= 8, `about a pass every 3 s (${(passes / SEEDS.length).toFixed(1)} per sequence)`);
  assert.ok(carries > 0, 'some carries');
});

test('2-4 turnovers per sequence, both teams have the ball, and carriers are real outfield players of the team on the ball', () => {
  let switches = 0, intercepts = 0, tackles = 0;
  for (const seed of SEEDS) {
    const s = gen(seed);
    const learner = learnerIdOf(s);
    const poss = s.timeline.possession;
    const teams = poss.map((k) => k.team).filter((t) => t !== 'none');
    const turns = teams.filter((t, i) => i > 0 && t !== teams[i - 1]).length;
    assert.ok(turns >= 2 && turns <= 4, `seed ${seed}: ${turns} turnovers`);
    assert.ok(teams.includes('us') && teams.includes('them'), `seed ${seed}: both teams attack and defend`);
    intercepts += poss.filter((k, i) => i > 0 && k.team !== 'none' && poss[i - 1].team !== 'none' && k.team !== poss[i - 1].team).length;
    tackles += poss.filter((k) => k.team === 'none').length;
    for (const k of s.timeline.carrier) {
      if (k.id === null) continue;
      const { team, role } = parsePlayerId(k.id);
      assert.notEqual(k.id, learner, 'the learner never has the ball');
      assert.notEqual(role, 'GK');
      assert.equal(team, possessionAt(s, k.t), `seed ${seed} t ${k.t}: ${k.id} has the ball for the team in possession`);
    }
    // A switch of play: a pass that moves the ball 20 m or more across.
    const b = s.timeline.ball;
    for (let i = 0; i < b.length - 1; i++) if (b[i].event === 'pass' && Math.abs(b[i + 1].y - b[i].y) >= 20) switches++;
  }
  assert.ok(intercepts > 0 && tackles > 0, `both kinds of turnover (${intercepts} interceptions, ${tackles} tackles)`);
  assert.ok(switches > 0, 'some switches of play');
});

test('receivers are where autoFrame puts them: the ball arrives at the player who takes it', () => {
  const gaps = [];
  for (const seed of SEEDS.slice(0, 8)) {
    const s = gen(seed);
    const car = s.timeline.carrier;
    for (let i = 1; i < car.length; i++) {
      if (!car[i].id || car[i - 1].id !== null) continue;
      const f = frameAt(s, car[i].t - 1e-3, { formations });
      const p = f.players.find((q) => q.id === car[i].id);
      gaps.push(Math.hypot(p.x - f.ball.x, p.y - f.ball.y));
    }
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  assert.ok(median < 2, `median gap between receiver and ball on arrival ${median.toFixed(2)} m`);
  assert.ok(gaps[Math.floor(gaps.length * 0.9)] < 6, `90th percentile ${gaps[Math.floor(gaps.length * 0.9)].toFixed(2)} m`);
});

test('graceEvents: passes and turnovers, not carries, sorted', () => {
  const s = gen(3);
  const ev = graceEvents(s);
  assert.ok(ev.length > 5);
  assert.ok(ev.every((e, i) => i === 0 || e.t >= ev[i - 1].t));
  assert.ok(!ev.some((e) => e.event === 'carry'));
  assert.ok(ev.some((e) => e.event === 'turnover'));
  assert.ok(ev.some((e) => e.event === 'pass'));
  const ex = graceEvents(example);
  assert.deepEqual(ex.map((e) => e.event), ['pass'], 'the example scenario: one pass (its carries are skipped)');
});

const maxGap = (a, b) => Math.max(...a.players.map((p, i) => Math.hypot(p.x - b.players[i].x, p.y - b.players[i].y)));
const sameFrame = (a, b, msg) => {
  assert.ok(maxGap(a, b) < 1e-9, `${msg}: players differ by ${maxGap(a, b)}`);
  assert.deepEqual(a.ball, b.ball, msg);
  assert.equal(a.possession, b.possession, msg);
  assert.equal(a.carrierId, b.carrierId, msg);
  assert.deepEqual(a.tags, b.tags, msg);
};

test('createPlayback returns exactly what timeline.frameAt returns (fixed learner spot)', () => {
  const s = gen(7);
  const pb = createPlayback(s, { formations });
  const spot = { x: 40, y: 30 };
  const pbSpot = createPlayback(s, { formations });
  const free = createPlayback(s, { formations, learnerId: null });
  const times = [0, 0.05, 1.3, 2.71, 5, 9.99, 13.4, 17.2, 22.25, 30, 36.6, 41.1, 44.95, 45];
  for (const t of times) {
    sameFrame(pb.frameAt(t), frameAt(s, t, { formations }), `t ${t}`);
    sameFrame(pbSpot.frameAt(t, spot), frameAt(s, t, { formations, learnerSpot: spot }), `t ${t} with a learner spot`);
    sameFrame(free.frameAt(t), frameAt(s, t, { formations, learnerId: null }), `t ${t} everybody auto`);
  }
  // Going back in time reuses the decided states.
  sameFrame(pb.frameAt(3.3), frameAt(s, 3.3, { formations }), 'back to 3.3 s');
  // The learner's base is the learner role's spot in the free playback.
  const id = learnerIdOf(s);
  for (const t of [4, 20, 40]) {
    const me = free.frameAt(t).players.find((p) => p.id === id);
    const base = learnerBaseAt(s, t, { formations });
    assert.ok(Math.hypot(me.x - base.x, me.y - base.y) < 1e-9, `base at ${t}`);
  }
  // Authored scenarios too (overrides, tags, an automatic carrier before the first key).
  const ex = normalizeScenario(example);
  const pe = createPlayback(ex, { formations });
  for (const t of [0, 0.5, 1, 1.7, 2, 2.4, 3, 4.2, 5.5, 6]) sameFrame(pe.frameAt(t), frameAt(ex, t, { formations }), `example t ${t}`);
  assert.ok(pb.states().length > 10, 'states are kept');
});

test('createPlayback is cheap enough for 60 fps (a 45 s sequence, every frame)', () => {
  const s = gen(11);
  const pb = createPlayback(s, { formations });
  const t0 = performance.now();
  let n = 0;
  for (let t = 0; t <= s.timeline.duration; t += 1 / 60) { pb.frameAt(t, { x: 35, y: 30 }); n++; }
  const per = (performance.now() - t0) / n;
  assert.ok(per < 2, `${per.toFixed(3)} ms per frame`);
});

test('live sampling: carrierAt and possessionAt agree with the playback at every 10 Hz sample', () => {
  const s = gen(13);
  const pb = createPlayback(s, { formations, learnerId: null });
  for (let t = 0; t <= s.timeline.duration; t += 0.1) {
    const f = pb.frameAt(t);
    assert.equal(f.possession, possessionAt(s, t));
    const c = carrierAt(s, t);
    if (c) assert.equal(f.carrierId, c);
  }
});
