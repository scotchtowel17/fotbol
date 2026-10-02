// js/engine/passdrill.js: generated "Who's open?" drills, their gates, the mirror and pass moments; and the Live
// pass choice in js/engine/sequence.js, which now rates passes on the frame the viewer sees (research/passing.md §5.4).
import { test, assert, approx, loadJSON, timed, isNode, PERF_SLACK } from './harness.js';
import {
  PASSDRILL_DEFAULTS, PASS_LESSONS, PASS_YIELD, generatePassDrill, generatePassSet, checkPassDrill, validatePassDrill, passDrillGates,
  passDrillFrame, passDrillPlayback, passDrillRating, mirrorPassDrill, forwardSlot, passLessons, passDrillPicture,
  similarPassDrills, canGeneratePass,
} from '../js/engine/passdrill.js';
import { gradePass, explainPass, rateOptions, swapTeams, markedBy, PASS_DEFAULTS } from '../js/engine/passing.js';
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
const bestRole = (d) => d.rating.best.targetId.replace(/^us-/, '');

/**
 * Milliseconds of CPU per call: in Node this process's CPU time (process.cpuUsage), which other test files running side
 * by side (npm test) do not inflate as they do the wall clock; in the browser the wall clock (harness.js timed). The
 * median of `runs` runs, so a speed test catches an order-of-magnitude slowdown and does not flake under load.
 */
function cpuTimed(fn, { warmup = 1, runs = 3 } = {}) {
  if (!isNode || typeof process.cpuUsage !== 'function') return timed(fn, { warmup, runs });
  for (let i = 0; i < warmup; i++) fn();
  const ts = [];
  for (let r = 0; r < runs; r++) {
    const c0 = process.cpuUsage();
    fn();
    const c = process.cpuUsage(c0);
    ts.push((c.user + c.system) / 1000);
  }
  return { median: [...ts].sort((a, b) => a - b)[Math.floor(ts.length / 2)], runs: ts };
}

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

test('forward bias: 3 of any 5 consecutive seeds want a forward best; a set holds 3 where the position has them, and varied bests', () => {
  for (let s = -7; s < 20; s++) {
    const n = [0, 1, 2, 3, 4].filter((k) => forwardSlot(s + k)).length;
    assert.equal(n, 3, `seeds ${s}..${s + 4}`);
  }
  for (const [role, principles] of [['LCM', []], ['LB', ['PA3', 'PA4']], ['LCB', ['PA2', 'PA5']], ['DM', ['PA6', 'PA8']]]) {
    const set = generatePassSet({ seed: 21, count: 5, role, principles, formations, catalogue });
    assert.equal(set.length, 5, `${role} ${principles}: a full set`);
    assert.equal(new Set(set.map((d) => d.id)).size, 5, 'no repeats');
    const fwd = set.filter((d) => isForward(d.rating.best)).length;
    assert.ok(fwd >= 3, `${role} ${principles}: ${fwd} of 5 forward`);
    if (principles.length) for (const d of set) assert.ok(principles.includes(d.principles[0]), `${d.id}: teaches ${d.principles[0]}`);
  }
  // A winger's forward pass is nearly always to the #9, and a set stars him at most twice (maxSameBest): so it holds two
  // forward bests and three other passes, not three passes to the #9.
  const w = generatePassSet({ seed: 21, count: 5, role: 'RW', formations, catalogue });
  assert.equal(w.length, 5);
  assert.ok(w.filter((d) => bestRole(d) === 'ST').length <= 2, w.map(bestRole).join(' '));
  // Keeping the ball (PA13) is never forced forward.
  const keep = generatePassSet({ seed: 3, count: 3, role: 'LW', principles: ['PA13'], formations, catalogue });
  assert.ok(keep.length >= 2 && keep.every((d) => d.principles[0] === 'PA13' && d.rating.best.tags.some((t) => t.tag === 'keep-it')));
});

test("who's open (the Player-mode review): the best is a safe pass to whoever is open, never a ball behind a tightly marked runner", () => {
  // Before the fix, on this sample: 45 of 82 bests safe, 13 of them a ball into space behind a runner whose marker was
  // level with him or goal-side within 3 m; a winger's best the #9 13 times in 24 (direction 'any'); a safe pass to a
  // free teammate 2+ stars 77 times in 169; the most open teammate within 25 m 2+ stars 43 times in 74.
  const S = { n: 0, green: 0, contested: [], free: 0, free2: 0, notSlow: 0, notSlow2: 0, open: 0, open2: 0 };
  const wing = { n: 0, st: 0 };
  for (const role of ['LW', 'RW', 'LB', 'DM', 'LCM', 'ST', 'LCB']) {
    for (let seed = 301; seed <= 310; seed++) {
      if (role.endsWith('W')) {
        const a = generatePassDrill({ seed, role, direction: 'any', formations, catalogue });
        if (a) { wing.n++; if (a.rating.best.targetId === 'us-ST') wing.st++; }
      }
      const d = drill(seed, role);
      if (!d) continue;
      const r = d.rating;
      S.n++;
      if (r.best.colour === 'green') S.green++;
      const f = passDrillFrame(d, timing(d).freezeAt, { formations });
      const opp = f.players.filter((p) => p.team === 'them' && p.role !== 'GK');
      if (r.best.kind === 'space') {
        const runner = f.players.find((p) => p.id === r.best.targetId);
        if (opp.some((o) => markedBy(o, runner, r.best.point) >= 1)) S.contested.push(d.id);
      }
      for (const o of r.options) {
        if (o.kind !== 'feet' || o.colour !== 'green' || o.receiverPressure >= PASS_DEFAULTS.pressureFree || o.id === r.best.id) continue;
        const stars = gradePass(r, o.id).stars;
        S.free++;
        if (stars >= 2) S.free2++;
        if (!o.tags.some((t) => t.tag === 'too-safe')) { S.notSlow++; if (stars >= 2) S.notSlow2++; }
      }
      // The most open teammate within 25 m (the nearest opponent 5 m or more away, a clear lane).
      let open = null, gap = -1;
      for (const o of r.options) {
        if (o.kind !== 'feet' || o.len > 25 || o.targetId === 'us-GK' || o.pLane < 0.8) continue;
        const p = f.players.find((q) => q.id === o.targetId);
        const g = Math.min(...opp.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
        if (g > gap) { gap = g; open = o; }
      }
      if (open && gap >= 5) { S.open++; if (gradePass(r, open.id).stars >= 2) S.open2++; }
    }
  }
  const report = JSON.stringify({ ...S, contested: S.contested.length, wing });
  assert.ok(S.n >= 60, report);
  assert.deepEqual(S.contested, [], `a ball into space behind a tightly marked runner starred: ${S.contested}`);
  assert.ok(S.green / S.n >= 0.8, `safe bests: ${report}`);
  assert.equal(S.notSlow2, S.notSlow, `a safe pass to a free teammate earns 2 stars unless a clearly better forward pass was on: ${report}`);
  assert.ok(S.free2 / S.free >= 0.5, `free teammates: ${report}`);
  assert.ok(S.open2 / S.open >= 0.6, `the most open teammate: ${report}`);
  // A winger's best is the #9 only when he is the one who is open: at most 45 % (was 54 %). Forward-slot drills (3 of 5)
  // star him more, being a winger's one forward receiver; generatePassSet stars him at most twice a set.
  assert.ok(wing.n >= 16 && wing.st / wing.n <= 0.45, `winger bests to the #9: ${report}`);
});

test('generatePassSet: at most 2 drills star a pass to the same position, and no two look alike (two pull-backs from one corner)', () => {
  const sets = [['LB', []], ['LW', []], ['ST', ['PA3', 'PA4']], ['LCB', ['PA10', 'PA13']], ['LCM', ['PA2', 'PA5']]].map(([role, principles]) =>
    [role, principles, generatePassSet({ seed: 44, count: 5, role, principles, formations, catalogue })]);
  for (const [role, principles, set] of sets) {
    const where = `${role} ${principles}: ${set.map(bestRole).join(' ')}`;
    assert.ok(set.length >= 4, `${where}: ${set.length} drills`);
    const n = {};
    for (const d of set) n[bestRole(d).replace(/@.*$/, '')] = (n[bestRole(d).replace(/@.*$/, '')] ?? 0) + 1;
    assert.ok(Math.max(...Object.values(n)) <= PASSDRILL_DEFAULTS.maxSameBest, `${where}: the same best receiver too often`);
    for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) assert.ok(!similarPassDrills(set[i], set[j]), `${where}: ${set[i].id} and ${set[j].id} look alike`);
  }
  // What looks alike: the same position and the ball within nearBall, or the same best receiver and the ball within
  // nearSameBest (the review's two corner pull-backs in one set).
  const [, , lw] = sets[1];
  const a = lw[0], moved = (d, dx, dy, best) => ({ ...d, rating: { ...d.rating, ball: { x: d.rating.ball.x + dx, y: d.rating.ball.y + dy }, best: { ...d.rating.best, targetId: best ?? d.rating.best.targetId } } });
  assert.ok(similarPassDrills(a, moved(a, 2, 1, 'us-GK')), 'the ball 2 m away: the same picture whoever is best');
  assert.ok(similarPassDrills(a, moved(a, 10, 5)), 'the same best, the ball 11 m away: the same picture');
  assert.ok(!similarPassDrills(a, moved(a, 10, 5, 'us-GK')), 'another best, the ball 11 m away: a new picture');
  assert.ok(!similarPassDrills(a, { ...moved(a, 0, 0), learner: { role: 'RW' } }), 'another position');
  assert.deepEqual(Object.keys(passDrillPicture(a)).sort(), ['ball', 'best', 'kind', 'role', 'template']);
});

test('generatePassDrill avoid and unlike: a set builder can ask for another best receiver and a new picture', () => {
  // A full-back's plain best is the winger down the line 3 times in 4: avoiding him marks him out of the picture.
  let n = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const d = generatePassDrill({ seed, role: 'LB', avoid: ['LW'], formations, catalogue });
    if (!d) continue;
    n++;
    assert.notEqual(bestRole(d).replace(/@.*$/, ''), 'LW', d.id);
    assert.match(d.id, /-x-lw(-a\d+)?$/);
    assert.deepEqual(d.source.avoid, ['LW']);
    assert.deepEqual(checkPassDrill(d, { formations }).problems, [], d.id);
  }
  assert.ok(n >= 4, `${n} of 6 seeds`);
  // unlike: never the same picture as a drill already in the set; a skipped scene is only skipped (the id says the attempt).
  const first = drill(4, 'LCM');
  const other = generatePassDrill({ seed: 4, role: 'LCM', unlike: [first], formations, catalogue });
  assert.ok(other && !similarPassDrills(first, other) && other.id !== first.id, other?.id);
  assert.equal(other.id, `pass-lcm-4-a${other.source.attempt}`);
});

test('canGeneratePass: the measured cells a set builder can skip (full-backs get no "free side" drill), fast', () => {
  assert.equal(canGeneratePass('LB', ['PA6', 'PA8']), false);
  assert.equal(canGeneratePass('FB', 'PA6'), false);
  assert.equal(canGeneratePass('RB', ['PA3', 'PA4']), true);
  assert.equal(canGeneratePass('DM', []), true, 'any lesson');
  assert.equal(canGeneratePass('LCM', ['PA7', 'PA14']), false, 'v2 principles');
  assert.equal(canGeneratePass('LW', ['PA13'], { direction: 'forward' }), false, 'keeping the ball is never a forward pass');
  assert.equal(canGeneratePass('LW', ['PA13'], { direction: 'any' }), true);
  // Every cell is measured, and every principle a drill can teach (but PA1, every drill's watch) has a row.
  for (const p of Object.keys(PASS_LESSONS).filter((q) => q !== 'PA1')) {
    for (const fam of ['CB', 'FB', 'DM', 'CM', 'W', 'ST']) {
      const y = PASS_YIELD[p]?.[fam];
      assert.ok(Array.isArray(y) && y.length === 2 && y.every((v) => v >= 0 && v <= 1), `${p} ${fam}`);
    }
  }
  // A cell it says no to comes back null at once; tried anyway (fastFail false), it still gives nothing (spot checks;
  // the zeros were measured on 32 seeds each, docs/ARCHITECTURE.md §5.14).
  const t = cpuTimed(() => generatePassDrill({ seed: 1, role: 'LB', principles: ['PA6', 'PA8'], formations, catalogue }), { warmup: 0, runs: 3 });
  assert.equal(generatePassDrill({ seed: 1, role: 'LB', principles: ['PA6', 'PA8'], formations, catalogue }), null);
  assert.ok(t.median < 5 * PERF_SLACK, `${t.median.toFixed(1)} ms`);
  for (const [role, p, direction] of [['RB', 'PA6', 'any'], ['LW', 'PA10', 'any'], ['ST', 'PA13', 'forward']]) {
    assert.equal(generatePassDrill({ seed: 2, role, principles: [p], direction, formations, catalogue, params: { fastFail: false } }), null, `${role} ${p} ${direction}`);
  }
  // ...and a cell it says yes to gives drills.
  for (const [role, p] of [['LCB', 'PA10'], ['LCM', 'PA3'], ['ST', 'PA4']]) {
    assert.ok([1, 2, 3].some((seed) => generatePassDrill({ seed, role, principles: [p], formations, catalogue })), `${role} ${p}`);
  }
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

test('speed: five accepted drills in well under 300 ms of CPU, and a varied set of five in well under 2 s (Node)', () => {
  const five = (role) => {
    let n = 0;
    for (let seed = 101; n < 5 && seed < 130; seed++) if (generatePassDrill({ seed, role, formations, catalogue })) n++;
    return n;
  };
  for (const role of ['LCM', 'LB', 'RW']) {
    assert.equal(five(role), 5);
    // 50-200 ms of CPU on a laptop (cpuTimed: CPU time, so files running side by side do not make it flake).
    const ms = cpuTimed(() => five(role), { warmup: 0, runs: 3 }).median;
    assert.ok(ms < 300 * PERF_SLACK, `${role}: ${ms.toFixed(0)} ms of CPU for 5 drills`);
  }
  // A set keeps its bests varied (no receiver more than twice, no two alike), so it tries more scenes: 100-900 ms.
  const ms = cpuTimed(() => generatePassSet({ seed: 101, count: 5, role: 'LB', formations, catalogue }), { warmup: 0, runs: 1 }).median;
  assert.ok(ms < 2000 * PERF_SLACK, `${ms.toFixed(0)} ms of CPU for a set of 5`);
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


test('Live (sequence.js): passes are chosen on the frame the viewer sees, so almost none would be cut out', () => {
  // research/passing.md §5.4: before the fix, 55 of 213 of our passes graded F on the rendered frame (47 body blocks).
  const count = { us: { n: 0, cut: 0, good: 0, blockedNear: 0 }, them: { n: 0, cut: 0, good: 0, blockedNear: 0 } };
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
      if (g.outcome === 'cut-out') c.cut++;
      if (g.score >= 80) c.good++;
      if (g.option.blocker?.via === 'block' && g.option.blocker.pInt >= 0.5) c.blockedNear++;
    }
  }
  for (const team of ['us', 'them']) {
    const c = count[team];
    assert.ok(c.n >= 60, `${team}: ${c.n} passes`);
    assert.ok(c.cut / c.n <= 0.05, `${team}: ${c.cut} of ${c.n} passes would be cut out`);
    assert.ok(c.good / c.n >= 0.7, `${team}: only ${c.good} of ${c.n} passes grade A or S`);
    assert.ok(c.blockedNear / c.n <= 0.03, `${team}: ${c.blockedNear} passes through a defender standing in the lane`);
  }
  assert.equal(PASS_DEFAULTS.red, 0.5, 'the Live choice never plays a pass rated below this');
});
