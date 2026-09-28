// js/engine/passdrill.js: generated "Who's open?" drills, their gates, the mirror and pass moments; and the Live
// pass choice in js/engine/sequence.js, which now rates passes on the frame the viewer sees (research/passing.md §5.4).
import { test, assert, approx, loadJSON, timed, PERF_SLACK } from './harness.js';
import {
  PASSDRILL_DEFAULTS, PASS_LESSONS, generatePassDrill, generatePassSet, checkPassDrill, validatePassDrill, passDrillGates,
  passDrillFrame, passDrillPlayback, passDrillRating, mirrorPassDrill, forwardSlot, passLessons, passMoments,
} from '../js/engine/passdrill.js';
import { gradePass, explainPass, rateOptions, swapTeams, PASS_DEFAULTS } from '../js/engine/passing.js';
import { createFormation } from '../js/engine/formation.js';
import { generateSequence, createPlayback } from '../js/engine/sequence.js';
import { timing, carrierAt, possessionAt } from '../js/engine/timeline.js';
import { mirrorPlayerId, LEARNABLE_ROLES } from '../js/engine/roles.js';

const F = createFormation(await loadJSON('data/formations/helios-433.json'));
const formations = { us: F, them: F };
const catalogue = await loadJSON('data/principles.json');
const byId = Object.fromEntries(catalogue.principles.map((p) => [p.id, p]));
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const isForward = (o) => o.direction === 'forward' || o.tags.some((t) => t.tag === 'switch');

const cache = new Map();
const drill = (seed, role, principles = []) => {
  const key = JSON.stringify([seed, role, principles]);
  if (!cache.has(key)) cache.set(key, generatePassDrill({ seed, role, principles, formations, catalogue }));
  return cache.get(key);
};
const SAMPLE = [[1, 'LCB'], [2, 'LB'], [3, 'DM'], [4, 'LCM'], [5, 'RW'], [6, 'ST'], [7, 'RCM'], [8, 'RB']];

test('generatePassDrill is deterministic per seed: the same inputs give an identical drill, another seed a different one', () => {
  const a = generatePassDrill({ seed: 11, role: 'LCM', formations, catalogue });
  const b = generatePassDrill({ seed: 11, role: 'LCM', formations, catalogue });
  assert.ok(a, 'a drill');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(generatePassDrill({ seed: 12, role: 'LCM', formations, catalogue }).timeline), JSON.stringify(a.timeline));
  assert.equal(a.source.seed, '11');
  assert.throws(() => generatePassDrill({ seed: 1, role: 'GK', formations }));
  assert.throws(() => generatePassDrill({ seed: 1, role: 'DM' }));
});

test('a pass drill: the documented shape, the learner on the ball at the freeze, simple words, the rating at the freeze', () => {
  for (const [seed, role] of SAMPLE) {
    const d = drill(seed, role);
    assert.ok(d, `${role} seed ${seed}: a drill`);
    const me = `us-${role}`;
    assert.equal(d.kind, 'pass');
    assert.equal(d.moment, 'in_possession');
    assert.deepEqual(d.learner, { role });
    assert.equal(d.carrierId, me);
    assert.equal(d.carrier, me);
    assert.match(d.id, /^pass-[a-z]+-[a-z0-9-]+$/);
    assert.equal(d.answer.mode, 'pass');
    assert.equal(d.answer.best, d.rating.best.id);
    assert.equal(d.source.kind, 'generated');
    assert.ok(d.principles.length >= 1 && d.principles.every((p) => byId[p]?.category === 'passing'), `${d.id}: ${d.principles}`);
    const { duration, freezeAt } = timing(d);
    assert.ok(freezeAt <= duration && freezeAt >= 1.5 && freezeAt <= 4, `${d.id}: freezes at ${freezeAt} s (2-3 s of build-up)`);
    assert.equal(carrierAt(d, freezeAt), me);
    assert.equal(carrierAt(d, 0) === me, false, 'someone else has it first');
    assert.equal(passDrillFrame(d, freezeAt, { formations }).carrierId, me);
    assert.deepEqual(validatePassDrill(d, { principles: catalogue }), [], d.id);
    for (const k of ['briefKid', 'questionKid', 'titleKid']) assert.ok(words(d[k]) <= 12, `${d.id}.${k}: "${d[k]}"`);
    assert.equal(d.titleKid, byId[d.principles[0]].kidName);
    assert.deepEqual(d.takeaway, byId[d.principles[0]].summary);
    // The stored rating is the one at the freeze (JSON-safe), so the UI can grade without recomputing.
    assert.equal(JSON.stringify(passDrillRating(d, { formations })), JSON.stringify(d.rating));
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(d))), JSON.stringify(d));
  }
});

test('checkPassDrill: generated drills and their mirrors pass the gates (clear best, not cut out, real choices, a decoy)', () => {
  for (const [seed, role] of SAMPLE) {
    const d = drill(seed, role);
    const r = checkPassDrill(d, { formations, principles: catalogue });
    assert.deepEqual(r.errors, [], d.id);
    assert.deepEqual(r.problems, [], `${d.id}: ${r.problems.join('; ')}`);
    assert.ok(r.margin >= PASSDRILL_DEFAULTS.margin && r.choices >= PASSDRILL_DEFAULTS.minChoices && r.decoys >= 1);
    assert.notEqual(r.best.colour, 'red');
    const scores = new Set(r.rating.options.map((o) => o.score));
    assert.ok(scores.size >= 3, `${d.id}: not all options equal`);
  }
});

test('validatePassDrill and the gates catch a bad drill', () => {
  const d = drill(4, 'LCM');
  const other = JSON.parse(JSON.stringify(d));
  other.timeline.carrier = other.timeline.carrier.map((k) => (k.id === d.carrierId ? { ...k, id: 'us-RCM' } : k));
  assert.ok(validatePassDrill(other).some((e) => /must have the ball at the freeze/.test(e)));
  assert.ok(validatePassDrill({ ...d, kind: 'drill' }).some((e) => /kind/.test(e)));
  assert.ok(validatePassDrill({ ...d, answer: { mode: 'pass', best: 'them-ST' } }).some((e) => /option id/.test(e)));
  assert.ok(validatePassDrill({ ...d, principles: ['PA99'] }, { principles: catalogue }).some((e) => /PA99/.test(e)));
  // Two options with the same score: no clear best. The best cut out: a problem.
  const r = JSON.parse(JSON.stringify(d.rating));
  r.options.find((o) => o.id !== r.best.id && !o.tags.some((t) => t.tag === 'too-safe')).score = r.best.score;
  assert.ok(passDrillGates(r).problems.some((p) => /no clear best/.test(p)));
  // A safe-but-slow option competes at its graded cap (tooSafeCap), not its raw score (PA2).
  const slow = JSON.parse(JSON.stringify(d.rating));
  const tooSafe = slow.options.find((o) => o.id !== slow.best.id && o.tags.some((t) => t.tag === 'too-safe'));
  if (tooSafe) {
    tooSafe.score = slow.best.score;
    assert.ok(!passDrillGates(slow).problems.some((p) => /no clear best/.test(p)));
  }
  r.options[0].colour = 'red';
  r.best = r.options[0];
  assert.ok(passDrillGates(r).problems.some((p) => /cut out/.test(p)));
  // A coach's key that disagrees with the engine.
  const worst = d.rating.options[d.rating.options.length - 1].id;
  assert.ok(checkPassDrill({ ...d, answer: { ...d.answer, best: worst } }, { formations, mirror: false }).problems.some((p) => /key disagreement/.test(p)));
});

test('forward bias: 3 of any 5 consecutive seeds want a forward best, and a set of 5 has at least 3 forward bests', () => {
  for (let s = -7; s < 20; s++) {
    const n = [0, 1, 2, 3, 4].filter((k) => forwardSlot(s + k)).length;
    assert.equal(n, 3, `seeds ${s}..${s + 4}`);
  }
  for (const [role, principles] of [['LCM', []], ['LB', ['PA3', 'PA4']], ['LCB', ['PA2', 'PA5']], ['RW', ['PA6', 'PA8']]]) {
    const set = generatePassSet({ seed: 21, count: 5, role, principles, formations, catalogue });
    assert.equal(set.length, 5, `${role} ${principles}: a full set`);
    assert.equal(new Set(set.map((d) => d.id)).size, 5, 'no repeats');
    const fwd = set.filter((d) => isForward(d.rating.best)).length;
    assert.ok(fwd >= 3, `${role} ${principles}: ${fwd} of 5 forward`);
    if (principles.length) for (const d of set) assert.ok(principles.includes(d.principles[0]), `${d.id}: teaches ${d.principles[0]}`);
  }
  // Keeping the ball (PA13) is never forced forward.
  const keep = generatePassSet({ seed: 3, count: 3, role: 'LW', principles: ['PA13'], formations, catalogue });
  assert.ok(keep.length >= 2 && keep.every((d) => d.principles[0] === 'PA13' && d.rating.best.tags.some((t) => t.tag === 'keep-it')));
});

test('principles: drills teach what was asked (the switch and own-goal templates), v2 principles give null', () => {
  const sw = drill(2, 'LCB', ['PA6']);
  assert.ok(sw, 'a switch drill for a centre-back');
  assert.equal(sw.principles[0], 'PA6');
  assert.ok(sw.rating.best.tags.some((t) => t.tag === 'switch'));
  assert.equal(sw.source.template, 'switch');
  const own = drill(3, 'RCB', ['PA10']);
  assert.ok(own, 'an own-goal drill for a centre-back');
  assert.ok(own.rating.options.some((o) => o.label === 'danger' && o.acrossOwnGoal));
  const space = drill(4, 'LW', ['PA8']);
  assert.ok(space && space.rating.best.kind === 'space' && space.answer.space);
  assert.equal(generatePassDrill({ seed: 1, role: 'LCM', principles: ['PA7', 'PA14'], formations }), null);
  for (const d of [sw, own, space]) assert.deepEqual(passLessons(d.rating, [d.principles[0]]), [d.principles[0]]);
  // The reveal line leads with the drill's lesson when the best pass teaches it.
  const e = explainPass(sw.rating, sw.rating.best.id, { focus: sw.principles });
  assert.equal(e.yours.principleId, 'PA6');
  assert.ok(Object.keys(PASS_LESSONS).every((p) => /^PA\d+$/.test(p) && byId[p]));
});

test('speed: five accepted drills in well under 300 ms (Node)', () => {
  for (const role of ['LCM', 'LB', 'RW']) {
    assert.equal(generatePassSet({ seed: 101, count: 5, role, formations, catalogue }).length, 5);
    // 50-90 ms on a laptop: the median of 3 runs (harness.js timed) stays well under the bound on a busy machine.
    const ms = timed(() => generatePassSet({ seed: 101, count: 5, role, formations, catalogue }), { warmup: 0, runs: 3 }).median;
    assert.ok(ms < 300 * PERF_SLACK, `${role}: ${ms.toFixed(0)} ms for 5 drills`);
  }
});

test('playback: the lead-in plays with frameAt (nobody held back), the incremental playback agrees, the mirror mirrors', () => {
  const d = drill(4, 'LCM');
  const t0 = passDrillFrame(d, 0, { formations });
  assert.equal(t0.carrierId, d.timeline.carrier[0].id, 'the passer has it first');
  const pb = passDrillPlayback(d, { formations });
  for (const t of [0, 0.4, d.timeline.carrier[1].t + 0.2, d.timeline.freezeAt]) {
    const a = pb.frameAt(t), b = passDrillFrame(d, t, { formations });
    a.players.forEach((p, i) => { approx(p.x, b.players[i].x, 1e-9); approx(p.y, b.players[i].y, 1e-9); });
  }
  const m = mirrorPassDrill(d, { formations });
  assert.equal(m.id, `${d.id}-m`);
  assert.equal(m.carrierId, mirrorPlayerId(d.carrierId));
  assert.equal(m.answer.best, d.answer.best.replace(/^[^@]+/, (p) => mirrorPlayerId(p)));
  assert.equal(m.rating.best.id, m.answer.best, 'the mirrored rating stars the mirrored best');
  assert.equal(m.rating.best.score, d.rating.best.score);
  assert.deepEqual(mirrorPassDrill(m, { formations }).timeline, d.timeline, 'mirroring twice gives the drill back');
});

test('passMoments: our receptions in a Live sequence, rated a moment after the touch', () => {
  const s = generateSequence({ seed: 4, role: 'DM', formations });
  const moments = passMoments(s, { formations });
  assert.ok(moments.length >= 3, `${moments.length} moments`);
  for (const m of moments) {
    assert.ok(m.carrierId.startsWith('us-') && m.carrierId !== 'us-DM', m.carrierId);
    assert.ok(m.t > 0 && m.t <= s.timeline.duration);
    assert.equal(m.rating.carrierId, m.carrierId);
    assert.ok(m.rating.options.length >= 10);
  }
});

test('Live (sequence.js): passes are chosen on the frame the viewer sees, so almost none would be cut out', () => {
  // research/passing.md §5.4: before the fix, 55 of 213 of our passes graded F on the rendered frame (47 body blocks).
  const count = { us: { n: 0, F: 0, good: 0, blockedNear: 0 }, them: { n: 0, F: 0, good: 0, blockedNear: 0 } };
  for (let seed = 1; seed <= 12; seed++) {
    const s = generateSequence({ seed, role: LEARNABLE_ROLES[seed % LEARNABLE_ROLES.length], formations });
    const pb = createPlayback(s, { formations, learnerId: null });
    for (const k of s.timeline.ball.filter((b) => b.event === 'pass')) {
      const t = k.t - 1e-3;
      const team = possessionAt(s, t), passer = carrierAt(s, t);
      const next = s.timeline.carrier.find((c) => c.t > k.t && c.id);
      if (!passer || !next || !next.id.startsWith(`${team}-`)) continue; // a turnover is meant to be cut out
      const frame = pb.frameAt(t);
      if (frame.carrierId !== passer) continue;
      const g = gradePass(rateOptions(team === 'us' ? frame : swapTeams(frame), passer), next.id);
      const c = count[team];
      c.n++;
      if (g.grade === 'F') c.F++;
      if (g.score >= 80) c.good++;
      if (g.option.blocker?.via === 'block' && g.option.blocker.pInt >= 0.5) c.blockedNear++;
    }
  }
  for (const team of ['us', 'them']) {
    const c = count[team];
    assert.ok(c.n >= 60, `${team}: ${c.n} passes`);
    assert.ok(c.F / c.n <= 0.05, `${team}: ${c.F} of ${c.n} passes would be cut out`);
    assert.ok(c.good / c.n >= 0.7, `${team}: only ${c.good} of ${c.n} passes grade A or S`);
    assert.ok(c.blockedNear / c.n <= 0.03, `${team}: ${c.blockedNear} passes through a defender standing in the lane`);
  }
  assert.equal(PASS_DEFAULTS.red, 0.5, 'the Live choice never plays a pass rated below this');
});
