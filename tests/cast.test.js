// js/engine/cast.js: the progressive field (docs/PROGRESSIVE_FIELD.md §1, §3). A staged rep is played and judged on a
// reduced frame that holds only its cast, and a stage is used only when the gate says it teaches the same lesson as the
// full game: spot reps the same answer within 4 m (a 3-star answer in both games), an S-grade ghost, the lesson's rule
// active and met, the same praise and Why? at the answer, the same duty and mark, standing still below a B; pass reps
// the same best receiver, a real choice between the receivers a tap can pick, 3-5 of them, no pass a better one than in
// the full game. Every player the drill scripts or names, the duties and the ball's presser are always shown.
import { test, assert, loadJSON, timed, isNode, PERF_SLACK } from './harness.js';
import {
  STAGES, CAST_DEFAULTS, castFor, castLabel, castExtent, reduceFrame, clipIdsOf, keepIdsOf, kidTextsOf, stageSpotDrill, stagePassDrill, bestStage, stagesOf,
} from '../js/engine/cast.js';
import { CHECK_DEFAULTS, checkStages, stagesProblems } from '../scripts/check-scenarios.mjs';
import { SPOT_DEFAULTS, generateSpotDrill } from '../js/engine/spotdrill.js';
import { PASSDRILL_DEFAULTS, generatePassDrill, passDrillFrame, mirrorPassDrill } from '../js/engine/passdrill.js';
import { rateOptions, gradePass } from '../js/engine/passing.js';
import { OFFSIDE_DEFAULTS, offsideLineX } from '../js/engine/rules/offside.js';
import { offsideLineWithoutLearner } from '../js/engine/rules/_util.js';
import { createFormation } from '../js/engine/formation.js';
import { mirrorScenario, normalizeScenario, learnerId as learnerIdOf } from '../js/engine/scenario.js';
import { frameAt, learnerBaseAt, timing } from '../js/engine/timeline.js';
import { buildContext, CONTEXT_DEFAULTS } from '../js/engine/context.js';
import { computeGhost } from '../js/engine/ghost.js';
import { evaluate } from '../js/engine/score.js';
import { judgeSpot } from '../js/engine/analyse.js';
import { RULES_BY_ID } from '../js/engine/rules/index.js';
import { ROLE_INFO, mirrorPlayerId } from '../js/engine/roles.js';
import { dist } from '../js/engine/geometry.js';
import { HALF_X } from '../js/engine/pitch.js';
// The screens that play staged reps (read-only here): the engine's gate must grade as they do.
import { PASS_DEFAULTS as PASS_UI, optionsByReceiver, passTargets } from '../js/ui/player/pass.js';
import { revealFor } from '../js/ui/player/play.js';

const F = createFormation(await loadJSON('data/formations/helios-433.json'));
const formations = { us: F, them: F };
const catalogue = await loadJSON('data/principles.json');
const byId = Object.fromEntries(catalogue.principles.map((p) => [p.id, p]));
const index = (await loadJSON('data/scenarios/index.json')).scenarios;
const authored = await Promise.all(index.map((e) => loadJSON(`data/scenarios/${e.file}`)));
const P = CAST_DEFAULTS;
const BAD = new Set(['risky', 'cut-out', 'offside', 'danger']);
const familyOf = (id) => ROLE_INFO[id.replace(/^(us|them)-/, '')]?.family;

/** Every authored drill and its mirror, staged at every stage once. */
const spotCases = [];
for (const raw of authored) {
  for (const mirror of [false, true]) {
    const s = mirror ? mirrorScenario(normalizeScenario(raw)) : raw;
    spotCases.push({ label: `${raw.id}${mirror ? ' (mirrored)' : ''}`, s, mirror, st: stagesOf(s, { formations, principles: catalogue }) });
  }
}
/** A few generated spot drills (attacking and defending, lines and lanes) and pass drills, staged the same way. */
const GEN_SPOT = [[1, 'LW', ['F4']], [2, 'ST', ['B2']], [3, 'LCM', ['B3']], [1, 'LCB', ['U4']], [2, 'DM', ['R3']], [4, 'RB', ['D1']], [2, 'LCB', ['D4']], [2, 'LCB', ['D5']]];
for (const [seed, role, principles] of GEN_SPOT) {
  const s = generateSpotDrill({ seed, role, principles, formations, catalogue });
  if (s) spotCases.push({ label: s.id, s, st: stagesOf(s, { formations, principles: catalogue }) });
}
// The review's cases first: a far decoy (RW PA1) and a small game where every tap earned 3 stars (LB PA10).
const GEN_PASS = [[1, 'RW', ['PA1']], [3, 'LB', ['PA10']], [1, 'LCM', ['PA3']], [2, 'LW', ['PA5']], [3, 'LB', ['PA2']], [1, 'ST', ['PA8']], [2, 'LCB', ['PA13']], [3, 'DM', ['PA4']], [4, 'RW', ['PA9']], [1, 'ST', ['PA11']], [2, 'RB', ['PA1']]];
const passCases = [];
for (const [seed, role, principles] of GEN_PASS) {
  const d = generatePassDrill({ seed, role, principles, formations, catalogue, direction: 'any' });
  if (d) passCases.push({ label: d.id, d, st: stagesOf(d, { formations }) });
}
const staged = (cases) => cases.flatMap((c) => ['small', 'medium'].filter((k) => c.st[k]).map((k) => ({ ...c, stage: k, r: c.st[k] })));
const spotStaged = staged(spotCases), passStaged = staged(passCases);

/** The first authored drill's free frame at the freeze (22 players). */
const firstFrame = () => {
  const s = normalizeScenario(authored[0]);
  return frameAt(s, timing(s).freezeAt, { formations });
};

/** CPU milliseconds per call in Node (not inflated by test files running side by side), else wall clock. */
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

/** Offside as the rules judge it (a point past the line, the ball and halfway; level within lineLevel is onside). */
const offsideOf = (q, attacking, line, ball) => (attacking === 'us' ? q.x > Math.max(ball.x, line, HALF_X) + P.lineLevel : q.x < Math.min(ball.x, line, HALF_X) - P.lineLevel);

// ---------------------------------------------------------------- the contract

test('cast: the stages and the gate numbers are the engine\'s own (npm run check, the spot generator, the pass drills, offside, pass.js)', () => {
  assert.deepEqual([...STAGES], ['small', 'medium', 'full']);
  assert.ok(Object.isFrozen(STAGES) && Object.isFrozen(CAST_DEFAULTS));
  assert.deepEqual({ ...P.small }, { min: 3, max: 6 });
  assert.deepEqual({ ...P.medium }, { min: 6, max: 12 });
  assert.equal(P.mediumFrom, P.small.max + 1, 'a bigger game is bigger than any small game');
  assert.equal(P.sameAnswer, 4);
  assert.equal(P.minGhostScore, CHECK_DEFAULTS.minGhostScore);
  assert.equal(P.stillMax, CHECK_DEFAULTS.maxStartScore);
  assert.equal(P.minRuleWeight, SPOT_DEFAULTS.minRuleWeight);
  assert.equal(P.minRuleScore, SPOT_DEFAULTS.minRuleScore);
  assert.equal(P.passMargin, PASSDRILL_DEFAULTS.margin);
  assert.equal(P.lineLevel, OFFSIDE_DEFAULTS.margin);
  assert.equal(P.farPass, PASS_UI.farPass, 'the gate counts the targets pass.js offers');
  assert.deepEqual([...P.offsidePrinciples], ['F4', 'B2', 'P5']);
  assert.deepEqual([P.minOptions, P.maxOptions], [3, 5]);
  assert.equal(P.praiseDepth, 3, 'the line and the Why? sheet\'s two more');
  // A pass rep's smaller games prefer a compact cast, in a box the shape of a phone held upright (longer along the pitch).
  assert.ok(Object.isFrozen(P.passBox) && P.passBox.along > P.passBox.across && P.passBox.across > 0);
  assert.ok(P.passBoxSlack > 0 && P.passBoxSlack < 0.25 && P.passSearch >= 10 && P.passCompact === true);
});

test('cast: castLabel counts ours v theirs (a keeper only when in the cast); the full match is "11 v 11"', () => {
  assert.deepEqual(castLabel(['us-LB', 'us-LCB', 'us-GK', 'them-ST', 'them-LW'], 'small'), { label: '3 v 2', ours: 3, theirs: 2 });
  assert.deepEqual(castLabel(['us-LB', 'them-ST'], 'small'), { label: '1 v 1', ours: 1, theirs: 1 });
  assert.equal(castLabel(firstFrame().players.map((p) => p.id), 'full').label, '11 v 11');
  for (const c of spotStaged) {
    const { ids, label, ours, theirs } = c.r.cast;
    assert.equal(ours, ids.filter((id) => id.startsWith('us-')).length, c.label);
    assert.equal(theirs, ids.filter((id) => id.startsWith('them-')).length, c.label);
    assert.equal(label, `${ours} v ${theirs}`, c.label);
  }
  for (const c of spotCases) assert.equal(c.st.full.cast.label, '11 v 11', c.label);
});

test('cast: reduceFrame keeps only the cast (in frame order), the ball, possession, tags and time, and the carrier only when in it', () => {
  const s = normalizeScenario(authored[0]);
  const frame = frameAt(s, timing(s).freezeAt, { formations });
  const before = JSON.stringify(frame);
  const carrier = frame.carrierId;
  const ids = [learnerIdOf(s), carrier, 'them-GK'];
  const r = reduceFrame(frame, ids);
  assert.deepEqual(r.players.map((p) => p.id), frame.players.filter((p) => ids.includes(p.id)).map((p) => p.id));
  assert.deepEqual(r.ball, frame.ball);
  assert.notEqual(r.ball, frame.ball, 'the ball is a copy');
  assert.equal(r.possession, frame.possession);
  assert.equal(r.t, frame.t);
  assert.deepEqual(r.tags, frame.tags);
  assert.equal(r.carrierId, carrier);
  const without = reduceFrame(frame, new Set([learnerIdOf(s), 'them-GK']));
  assert.equal(without.carrierId, null, 'a carrier left out of the cast is not on the ball');
  assert.equal(without.players.length, 2);
  assert.equal(JSON.stringify(frame), before, 'the frame is not changed');
  // The edges: a single id is not a list of ids (it would read as its characters); a frame with no ball keeps none.
  assert.throws(() => reduceFrame(frame, 'us-LB'), /ids/);
  assert.throws(() => reduceFrame(frame, null), /ids/);
  const { ball, ...noBall } = frame;
  assert.equal(reduceFrame(noBall, ids).ball, undefined, 'no ball in, no ball out (not {})');
});

test('cast: clipIdsOf names everyone on the ball in the clip (the timeline carriers; a pass drill\'s passer and the learner)', () => {
  for (const raw of authored) {
    const ids = clipIdsOf(raw, { formations });
    for (const k of raw.timeline.carrier ?? []) if (k.id) assert.ok(ids.includes(k.id), `${raw.id}: ${k.id}`);
  }
  // No carrier key at t = 0: whoever the playback puts on the ball then is in the clip.
  const s = normalizeScenario(authored[0]);
  const auto = { ...s, timeline: { ...s.timeline, carrier: s.timeline.carrier.filter((k) => k.t > 0) } };
  const at0 = frameAt(auto, 0, { formations }).carrierId;
  assert.ok(at0 && clipIdsOf(auto, { formations }).includes(at0), `automatic carrier ${at0}`);
  for (const c of passCases) {
    const ids = clipIdsOf(c.d, { formations });
    assert.ok(ids.includes(learnerIdOf(c.d)), `${c.label}: the learner receives`);
    for (const k of c.d.timeline.carrier) if (k.id) assert.ok(ids.includes(k.id), `${c.label}: ${k.id}`);
  }
});

test('cast: castFor puts the learner first, keeps the carrier, the clip and `keep`, both teams, the cap (past it only for the must), and is deterministic', () => {
  for (const raw of authored.slice(0, 12)) {
    const s = normalizeScenario(raw);
    const t = timing(s).freezeAt, learnerId = learnerIdOf(s);
    const frame = frameAt(s, t, { formations });
    const base = learnerBaseAt(s, t, { formations });
    const ghost = computeGhost(buildContext(frame, { learnerId, base }), { base }).spot;
    const clipIds = clipIdsOf(s, { formations });
    const keep = keepIdsOf(s, frame, { learnerId, base, clipIds }).ids;
    for (const stage of ['small', 'medium']) {
      const opts = { learnerId, base, ghost, principles: s.principles, stage, clipIds, keep };
      const c = castFor(frame, opts);
      assert.deepEqual(castFor(frame, opts), c, `${raw.id} ${stage}: deterministic`);
      assert.equal(c.ids[0], learnerId, `${raw.id}: the learner first`);
      assert.equal(new Set(c.ids).size, c.ids.length, `${raw.id}: no one twice`);
      for (const id of [frame.carrierId, ...clipIds, ...keep].filter(Boolean)) assert.ok(c.ids.includes(id), `${raw.id} ${stage}: ${id} is always in`);
      assert.ok(c.ours >= 1 && c.theirs >= 1, `${raw.id} ${stage}: both teams (${c.label})`);
      const least = stage === 'medium' ? P.mediumFrom : P[stage].min;
      assert.equal(c.fits, c.ids.length >= least && c.ids.length <= P[stage].max, `${raw.id} ${stage}: fits ${c.ids.length}`);
      const small = castFor(frame, { ...opts, size: 3 });
      assert.ok(small.ids.length >= 3, `${raw.id} ${stage} size 3: ${small.ids.length}`);
      if (small.ids.length > P[stage].max) assert.equal(small.fits, false, `${raw.id} ${stage}: over the cap only when the must needs it`);
    }
    const full = castFor(frame, { learnerId, stage: 'full' });
    assert.equal(full.ids.length, 22);
    assert.equal(full.label, '11 v 11');
  }
  assert.throws(() => castFor(firstFrame(), { learnerId: 'us-LCM', stage: 'huge' }), /unknown stage/);
});

test('cast: castFor refuses a frame with no opponent or without the learner (a stage is a game: never "3 v 0")', () => {
  const frame = firstFrame();
  const learnerId = learnerIdOf(normalizeScenario(authored[0]));
  const ours = { ...frame, carrierId: null, players: frame.players.filter((p) => p.team === 'us') };
  assert.throws(() => castFor(ours, { learnerId, stage: 'small' }), /opponent/);
  const gone = { ...frame, players: frame.players.filter((p) => p.id !== learnerId) };
  assert.throws(() => castFor(gone, { learnerId, stage: 'small' }), /learner/);
  assert.throws(() => castFor(gone, { learnerId, stage: 'full' }), /learner/);
});

// ---------------------------------------------------------------- who is always shown

test('cast: every player the drill scripts or names is in every staged cast (the words and the runs are about players the kid can see)', () => {
  const NAMES = { striker: ['ST'], winger: ['W'], defender: ['CB', 'FB'], defenders: ['CB', 'FB'], midfielder: ['DM', 'CM'], midfielders: ['DM', 'CM'], 'full-back': ['FB'], 'centre-back': ['CB'], keeper: ['GK'] };
  let scripted = 0, named = 0;
  for (const c of spotStaged) {
    const s = normalizeScenario(c.s);
    const learnerId = learnerIdOf(s);
    for (const o of s.timeline.players.overrides) {
      if (o.id === learnerId) continue;
      scripted++;
      assert.ok(c.r.cast.ids.includes(o.id), `${c.label} ${c.stage} ${c.r.cast.label}: the scripted ${o.id} is hidden`);
    }
    for (const t of kidTextsOf(c.s)) {
      for (const m of t.toLowerCase().matchAll(/\b(their|your|our)\s+([a-z-]+)/g)) {
        const fams = NAMES[m[2]];
        if (!fams) continue;
        named++;
        const team = m[1] === 'their' ? 'them' : 'us';
        assert.ok(c.r.cast.ids.some((id) => id !== learnerId && id.startsWith(`${team}-`) && fams.includes(familyOf(id))), `${c.label} ${c.stage} ${c.r.cast.label}: "${m[0]}" but none is shown ("${t}")`);
      }
    }
    for (const id of c.r.keep) assert.ok(c.r.cast.ids.includes(id), `${c.label} ${c.stage}: keep ${id}`);
  }
  assert.ok(scripted >= 40 && named >= 30, `${scripted} scripted and ${named} named players checked`);
  // The review's cases: the overlapping full-back the words are about (m2-08), their striker (m3-06, m3-08).
  const at = (id, who) => spotCases.find((c) => c.label === id).st;
  for (const [id, who] of [['m2-08-b6-rw', 'us-RB'], ['m3-06-u5-lcb', 'them-ST'], ['m3-08-r3-dm', 'them-ST'], ['m3-11-r1-rcb', 'us-DM'], ['m2-05-b1-rb', 'us-RW']]) {
    const st = at(id);
    for (const k of ['small', 'medium']) if (st[k]) assert.ok(st[k].cast.ids.includes(who), `${id} ${k}: ${who}`);
  }
});

test('cast: an authored "stages": { "keep": [...] } is always shown, mirrored with the drill', () => {
  const raw = authored.find((a) => a.id === 'm1-01-d1-lcm');
  const kept = { ...JSON.parse(JSON.stringify(raw)), stages: { keep: ['us-RB'] } };
  const st = stagesOf(kept, { formations, principles: catalogue });
  assert.ok(st.small || st.medium, 'fixture: a smaller game');
  for (const k of ['small', 'medium']) if (st[k]) assert.ok(st[k].cast.ids.includes('us-RB'), `${k}: ${st[k].cast.ids.join(' ')}`);
  const m = stagesOf(mirrorScenario(normalizeScenario(kept)), { formations, principles: catalogue });
  for (const k of ['small', 'medium']) if (m[k]) assert.ok(m[k].cast.ids.includes('us-LB') && !m[k].cast.ids.includes('us-RB'), `mirrored ${k}: ${m[k].cast.ids.join(' ')}`);
  assert.deepEqual(keepIdsOf(kept, st.full.frame).authored, ['us-RB']);
});

test('cast: the duties are shown and kept: the first defender, the learner\'s mark, the ball\'s presser; the same duty, first defender and mark as the full game', () => {
  let marks = 0, pressers = 0;
  for (const c of spotStaged) {
    const F = c.st.full.ctx, S = c.r.ctx, ids = c.r.cast.ids;
    const who = (p) => p?.id ?? null;
    assert.equal(S.duty, F.duty, `${c.label} ${c.stage}: duty`);
    assert.equal(who(S.firstDefender), who(F.firstDefender), `${c.label} ${c.stage}: first defender`);
    assert.equal(who(S.markTarget), who(F.markTarget), `${c.label} ${c.stage}: mark`);
    assert.equal(S.pressureOnBall, F.pressureOnBall, `${c.label} ${c.stage}: pressure on the ball`);
    if (F.moment !== 'in_possession') {
      if (F.firstDefender) assert.ok(ids.includes(F.firstDefender.id), `${c.label} ${c.stage}: first defender ${F.firstDefender.id}`);
      if (F.markTarget) { marks++; assert.ok(ids.includes(F.markTarget.id), `${c.label} ${c.stage}: mark ${F.markTarget.id}`); }
    }
    const carrier = c.r.frame.players.find((p) => p.id === c.st.full.frame.carrierId);
    if (F.pressureOnBall && carrier) {
      pressers++;
      const reach = (p) => Math.min(dist(p, carrier), dist(p, c.st.full.frame.ball));
      const at = (p) => (p.id === c.r.learnerId ? { ...p, x: c.r.base.x, y: c.r.base.y } : p); // the context reads the learner at base
      const presser = c.st.full.frame.players.filter((p) => p.team !== carrier.team && p.role !== 'GK').map(at).sort((a, b) => reach(a) - reach(b))[0];
      assert.ok(ids.includes(presser.id), `${c.label} ${c.stage}: the presser ${presser.id}`);
      if (c.st.full.frame.tags?.pressureOnBall === undefined) assert.ok(reach(presser) <= CONTEXT_DEFAULTS.pressureRadius + 1e-9, `${c.label}: presser in reach`);
    }
  }
  assert.ok(marks >= 10 && pressers >= 10, `${marks} marks and ${pressers} pressers checked`);
});

// ---------------------------------------------------------------- spot reps: the gate

test('cast: every authored drill and its mirror has a small or a medium stage, and npm run check finds no stage problem', () => {
  for (const raw of authored) {
    const r = checkStages(raw, { principles: catalogue, formations });
    assert.deepEqual(r.problems, [], raw.id);
    assert.ok(typeof r.lesson === 'string' && r.lesson, `${raw.id}: the lesson held is reported`);
  }
  for (const c of spotCases.filter((x) => authored.includes(x.s) || x.mirror)) assert.ok(c.st.small || c.st.medium, `${c.label}: no small or medium stage`);
  const n = spotCases.length;
  const small = spotCases.filter((c) => c.st.small).length;
  assert.ok(small >= n / 2, `only ${small} of ${n} drills have a small stage`);
});

test('cast: npm run check validates "stages" and fails an unmet primary idea unless a note says why', () => {
  assert.deepEqual(stagesProblems({}), []);
  assert.deepEqual(stagesProblems({ stages: { note: 'Needs the whole back four.', keep: ['us-LB', 'them-ST'] } }), []);
  assert.ok(stagesProblems({ stages: { note: 5 } }).some((p) => /note/.test(p)), 'a note that is not a string');
  assert.ok(stagesProblems({ stages: { note: '  ' } }).some((p) => /note/.test(p)), 'an empty note');
  assert.ok(stagesProblems({ stages: { keep: 'us-LB' } }).some((p) => /keep/.test(p)), 'keep not an array');
  assert.ok(stagesProblems({ stages: { keep: ['us-XX', 3] } }).length === 2, 'keep with ids that are not players');
  assert.ok(stagesProblems({ stages: { notes: 'typo' } }).some((p) => /notes/.test(p)), 'an unknown field');
  assert.ok(stagesProblems({ stages: [] }).length === 1, 'not an object');
  const raw = authored.find((a) => a.id === 'm1-01-d1-lcm');
  const bad = { ...JSON.parse(JSON.stringify(raw)), stages: { note: 7 } };
  assert.ok(checkStages(bad, { principles: catalogue, formations }).problems.some((p) => /note/.test(p)), 'npm run check fails a malformed note');
  // A defending drill whose first idea is an attacking one (B2: its rules never apply here): unmet, so it fails...
  const unmet = { ...JSON.parse(JSON.stringify(raw)), principles: ['B2', ...raw.principles] };
  const r = checkStages(unmet, { principles: catalogue, formations });
  assert.ok(r.problems.some((p) => /B2/.test(p) && /not met/.test(p)), r.problems.join('; '));
  // ...unless the scenario says why.
  assert.deepEqual(checkStages({ ...unmet, stages: { note: 'Taught by the clip, not by one rule.' } }, { principles: catalogue, formations }).problems, []);
});

test('cast: a staged spot rep shows 3-6 (small) or 7-12 (medium) players, both teams, the learner, everyone on the ball in the clip', () => {
  assert.ok(spotStaged.length >= 60, `${spotStaged.length} staged reps`);
  for (const c of spotStaged) {
    const { ids, ours, theirs } = c.r.cast;
    const cap = P[c.stage];
    const least = c.stage === 'medium' ? P.mediumFrom : cap.min;
    assert.ok(ids.length >= least && ids.length <= cap.max, `${c.label} ${c.stage}: ${ids.length} players`);
    assert.ok(theirs >= 1, `${c.label} ${c.stage}: no opponent`);
    assert.ok(ours >= P.minOurs, `${c.label} ${c.stage}: ${ours} of ours`);
    assert.ok(ids.includes(c.r.learnerId), `${c.label}: the learner`);
    for (const id of c.r.clipIds) assert.ok(ids.includes(id), `${c.label} ${c.stage}: ${id} has the ball in the clip`);
    const tl = normalizeScenario(c.s).timeline;
    for (const k of tl.carrier) if (k.id) assert.ok(ids.includes(k.id), `${c.label} ${c.stage}: carrier ${k.id}`);
    assert.deepEqual(c.r.frame.players.map((p) => p.id).sort(), [...ids].sort(), `${c.label}: the frame holds exactly the cast`);
    assert.equal(c.r.stage, c.stage);
  }
  for (const c of spotCases) assert.equal(c.st.full.cast.ids.length, 22);
});

test('cast: the bigger game is bigger than the small one (never the same cast twice: "Now 4 v 3!" means more players)', () => {
  for (const c of [...spotCases, ...passCases]) {
    const { small, medium } = c.st;
    if (medium) assert.ok(medium.cast.ids.length >= P.mediumFrom, `${c.label}: medium ${medium.cast.label}`);
    if (small && medium) {
      assert.ok(medium.cast.ids.length > small.cast.ids.length, `${c.label}: small ${small.cast.label}, medium ${medium.cast.label}`);
      assert.notDeepEqual([...medium.cast.ids].sort(), [...small.cast.ids].sort(), c.label);
    }
  }
  // The review's case: spot-dm-1-d3 had the same 4 v 2 at both sizes.
  const s = generateSpotDrill({ seed: 1, role: 'DM', principles: ['D3'], formations, catalogue });
  if (s) {
    const st = stagesOf(s, { formations, principles: catalogue });
    if (st.small && st.medium) assert.ok(st.medium.cast.ids.length > st.small.cast.ids.length, `${s.id}: ${st.small.cast.label} then ${st.medium.cast.label}`);
  }
});

test('cast: the spot gate holds on the reduced frame (same answer, S ghost, the lesson\'s rule, the same praise and Why?, standing still below 70)', () => {
  let primaries = 0;
  for (const c of spotStaged) {
    const s = normalizeScenario(c.s);
    const t = timing(s).freezeAt, learnerId = learnerIdOf(s);
    const full = c.st.full;
    // Recomputed from scratch: the free frame at the freeze reduced to the cast, the base, the ghost round the centre.
    const frame = reduceFrame(frameAt(s, t, { formations }), c.r.cast.ids);
    const base = learnerBaseAt(s, t, { formations });
    const ctx = buildContext(frame, { learnerId, base });
    const ghost = computeGhost(ctx, { base: c.r.centre, tol: c.r.tol });
    assert.deepEqual(ghost.spot, c.r.ghost.spot, `${c.label} ${c.stage}: the ghost`);
    assert.ok(ghost.score >= CHECK_DEFAULTS.minGhostScore, `${c.label} ${c.stage}: the ghost scores ${ghost.score}`);
    assert.ok(dist(ghost.spot, full.ghost.spot) <= P.sameAnswer + 1e-9, `${c.label} ${c.stage}: ${dist(ghost.spot, full.ghost.spot).toFixed(1)} m from the full game's answer`);
    // The same answer both ways: the full game's best spot is a 3-star answer in the smaller game too.
    const across = evaluate(ctx, full.ghost.spot, { center: c.r.centre, tol: c.r.tol }).score;
    assert.ok(across >= P.minGhostScore, `${c.label} ${c.stage}: the full game's answer scores ${across} here`);
    const lesson = c.r.lesson;
    if (lesson) {
      const hit = ghost.result.rules.filter((q) => lesson.rules.includes(q.id) && q.weight >= lesson.minWeight && q.s >= P.minRuleScore);
      assert.ok(hit.length, `${c.label} ${c.stage}: ${lesson.principle}'s rule is not active and met at the ghost`);
      assert.ok(lesson.minWeight >= P.minRuleWeight || lesson.primary, `${c.label}: only the primary is held below weight ${P.minRuleWeight}`);
      // §1: the primary idea's rule is the one held whenever it has a rule met at the full game's answer.
      const primaryRules = byId[s.principles[0]]?.ruleIds ?? [];
      if (primaryRules.some((id) => full.ghost.result.rules.some((q) => q.id === id && q.weight > 0 && q.s >= P.minRuleScore))) {
        primaries++;
        assert.equal(lesson.principle, s.principles[0], `${c.label}: the primary principle's rule is the one held`);
        assert.equal(lesson.primary, true);
      } else assert.ok(!primaryRules.length || lesson.unmet, `${c.label}: a substitute lesson only for a primary with no rule (${s.principles[0]})`);
    }
    // The kid hears the same thing at the answer: the reveal's line, the Why? sheet's idea and its praise.
    const inFull = revealFor(s, { ctx: full.ctx, ghost: full.ghost }, full.ghost.spot, { principles: byId });
    const here = revealFor(s, { ctx: c.r.ctx, ghost: c.r.ghost }, c.r.ghost.spot, { principles: byId });
    assert.equal(here.stars, 3, `${c.label} ${c.stage}: the answer earns 3 stars`);
    assert.equal(here.line, inFull.line, `${c.label} ${c.stage}: the praise at the answer`);
    assert.equal(here.why.title, inFull.why.title, `${c.label} ${c.stage}: the Why? idea`);
    assert.deepEqual(here.why.praise, inFull.why.praise, `${c.label} ${c.stage}: the Why? praise`);
    const still = evaluate(ctx, c.r.start, { center: c.r.centre, tol: c.r.tol }).score;
    if (s.answer.hold !== true) assert.ok(still < CHECK_DEFAULTS.maxStartScore, `${c.label} ${c.stage}: standing still scores ${still}`);
    assert.equal(still, c.r.gates.startScore);
    // Drop-in for play.js: judging on the staged ctx and ghost scores the answer exactly as the ghost.
    assert.equal(judgeSpot({ ctx: c.r.ctx, ghost: c.r.ghost }, c.r.ghost.spot, { wording: 'kid', principles: byId }).result.score, c.r.ghost.score, c.label);
    assert.ok(c.r.gates.ok && c.r.gates.failed.length === 0 && c.r.gates.tries >= 1, c.label);
    for (const q of ctx.teammates.concat(ctx.opponents)) assert.ok(c.r.cast.ids.includes(q.id), `${c.label}: ${q.id} is judged but not shown`);
  }
  assert.ok(primaries >= 20, `${primaries} staged reps hold the primary idea's rule`);
  // The review's case: m3-08 (R3, its screen rule weighs 1 in the full game) is held to R3, not to D3 cover.
  const m308 = spotCases.find((c) => c.label === 'm3-08-r3-dm').st.full.lesson;
  assert.deepEqual([m308.principle, m308.primary, m308.minWeight], ['R3', true, 1]);
});

test('cast: the spot gate fails on NaN (a missing line or a bad number never passes a stage)', () => {
  const raw = spotCases.find((c) => c.st.small && c.s.answer?.hold !== true).s;
  for (const params of [{ minGhostScore: NaN }, { sameAnswer: NaN }, { stillMax: NaN }, { minRuleScore: NaN, minGhostScore: NaN }]) {
    const st = stagesOf(raw, { formations, principles: catalogue, params });
    assert.equal(st.small, null, JSON.stringify(Object.keys(params)));
    assert.equal(st.medium, null, JSON.stringify(Object.keys(params)));
    assert.equal(st.full.stage, 'full');
  }
});

test('cast: standing still must not pass a staged rep, unless the drill is an authored "hold" drill', () => {
  const raw = authored.find((a) => a.id === 'm1-01-d1-lcm') ?? authored[0];
  const st = stagesOf(raw, { formations, principles: catalogue });
  const near = { x: st.full.ghost.spot.x - 1, y: st.full.ghost.spot.y + 0.5 };
  const idle = stagesOf({ ...raw, learner: { ...raw.learner, start: near } }, { formations, principles: catalogue });
  assert.ok(idle.full.gates.startScore >= P.stillMax, `fixture: the start scores ${idle.full.gates.startScore}`);
  assert.equal(idle.small, null);
  assert.equal(idle.medium, null);
  const hold = stagesOf({ ...raw, learner: { ...raw.learner, start: near }, answer: { ...raw.answer, hold: true } }, { formations, principles: catalogue });
  assert.ok(hold.small || hold.medium, 'a hold drill stages');
  assert.equal((hold.small ?? hold.medium).gates.hold, true);
});

test('cast: the offside line judges everyone in the cast as the full game does (exact when the lesson is about it)', () => {
  let attacking = 0, defending = 0, judged = 0;
  for (const c of spotStaged) {
    const full = c.st.full;
    const heavy = (id) => (RULES_BY_ID[id].weight(full.ctx) >= P.minRuleWeight);
    // A lesson on the line: the staged line is the full game's (§1).
    if (full.ctx.moment === 'in_possession' && (heavy('offside') || heavy('pin') || normalizeScenario(c.s).principles.some((p) => P.offsidePrinciples.includes(p)))) {
      attacking++;
      assert.ok(Math.abs(offsideLineX(c.r.ctx) - offsideLineX(full.ctx)) <= P.lineLevel + 1e-9, `${c.label} ${c.stage}: their line ${offsideLineX(c.r.ctx)} vs ${offsideLineX(full.ctx)}`);
    }
    if (full.ctx.moment !== 'in_possession' && heavy('keeps-onside')) {
      defending++;
      const a = offsideLineWithoutLearner(c.r.ctx).second, b = offsideLineWithoutLearner(full.ctx).second;
      assert.ok(Math.abs(a - b) <= P.lineLevel + 1e-9, `${c.label} ${c.stage}: our line ${a} vs ${b}`);
    }
    // Any rep: every attacker in the cast (and the learner's answer and start, when attacking) is on the same side of
    // the line as in the full game, so a far keeper stays out only when no one's call changes.
    const f = c.r.frame, ball = f.ball;
    for (const [team, attackingTeam] of [['them', 'us'], ['us', 'them']]) {
      if (f.possession !== attackingTeam) continue;
      const lineIn = (ctx) => (team === 'them' ? ctx.lines.oppSecondLastX : offsideLineWithoutLearner(ctx).second);
      const points = f.players.filter((p) => p.team === attackingTeam && p.id !== f.carrierId && p.id !== c.r.learnerId);
      if (attackingTeam === 'us') points.push(c.r.ghost.spot, c.r.start);
      for (const q of points) {
        judged++;
        assert.equal(offsideOf(q, attackingTeam, lineIn(c.r.ctx), ball), offsideOf(q, attackingTeam, lineIn(full.ctx), ball), `${c.label} ${c.stage}: ${q.id ?? 'the learner'} changes sides of ${team === 'them' ? 'their' : 'our'} line`);
      }
    }
  }
  assert.ok(attacking >= 5 && judged >= 100, `${attacking} attacking lessons, ${judged} offside calls checked`);
  // Our line (keeps-onside, U4): their winger left standing offside behind our back line (a scripted spot).
  const raw = authored.find((a) => a.id === 'm1-02-d3-rcb');
  const trap = JSON.parse(JSON.stringify(raw));
  trap.timeline.players.overrides = [...trap.timeline.players.overrides, { id: 'them-RW', keys: [{ t: 0, x: 8.7, y: 4.4 }] }];
  const st = stagesOf(trap, { formations, principles: catalogue });
  assert.ok(RULES_BY_ID['keeps-onside'].weight(st.full.ctx) >= P.minRuleWeight, 'fixture: an attacker kept offside by our line');
  for (const stage of ['small', 'medium']) {
    if (!st[stage]) continue;
    defending++;
    const a = offsideLineWithoutLearner(st[stage].ctx).second, b = offsideLineWithoutLearner(st.full.ctx).second;
    assert.ok(Math.abs(a - b) <= P.lineLevel + 1e-9, `offside trap ${stage}: our line ${a} vs ${b} (${st[stage].cast.ids.join(' ')})`);
  }
  assert.ok(defending >= 1, `${defending} defending reps checked`);
  // castFor with an offside lesson: their line setters are in, whatever the size.
  const s = normalizeScenario(authored.find((a) => a.moment === 'in_possession'));
  const t = timing(s).freezeAt, learnerId = learnerIdOf(s);
  const frame = frameAt(s, t, { formations });
  const base = learnerBaseAt(s, t, { formations });
  const c = castFor(frame, { learnerId, base, ghost: base, principles: ['F4'], stage: 'small', size: 3 });
  const reduced = buildContext(reduceFrame(frame, c.ids), { learnerId, base });
  const whole = buildContext(frame, { learnerId, base });
  assert.ok(Math.abs(reduced.lines.oppSecondLastX - whole.lines.oppSecondLastX) <= P.lineLevel + 1e-9, `F4 small cast ${c.ids.join(' ')}`);
});

test('cast: a small game fits a small camera box: no far keeper or decoy, a player far from the play only when the lesson needs him', () => {
  const pointsOf = (r) => [...r.frame.players, r.frame.ball, ...(r.start ? [r.start] : []), ...(r.ghost ? [r.ghost.spot] : []), ...(r.rating ? [r.rating.best.point ?? r.frame.ball] : [])];
  const small = [...spotStaged, ...passStaged].filter((c) => c.stage === 'small');
  const sides = small.map((c) => {
    const pts = pointsOf(c.r), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }).sort((a, b) => a - b);
  assert.ok(sides[sides.length >> 1] <= 32, `the small game's fit box: median long side ${sides[sides.length >> 1].toFixed(0)} m`);
  const linesOf = (r, ids) => {
    const ctx = buildContext(reduceFrame(r.frame, ids), { learnerId: r.learnerId, base: r.base ?? r.frame.players.find((q) => q.id === r.learnerId) });
    return [ctx.lines.oppSecondLastX, offsideLineWithoutLearner(ctx).second];
  };
  let lonely = 0;
  for (const c of small) {
    const r = c.r, pts = pointsOf(r);
    const taps = r.kind === 'pass' ? passTargets(optionsByReceiver(r.rating.options, r.learnerId), r.frame, r.learnerId) : new Map();
    for (const p of r.frame.players) {
      if (Math.min(...pts.filter((q) => q !== p).map((q) => dist(p, q))) <= 25) continue;
      lonely++;
      const a = linesOf(r, r.cast.ids), b = linesOf(r, r.cast.ids.filter((id) => id !== p.id));
      const holdsLine = Math.abs(a[0] - b[0]) > P.lineLevel || Math.abs(a[1] - b[1]) > P.lineLevel;
      const why = p.id === r.learnerId || r.keep.includes(p.id) || r.clipIds.includes(p.id) || taps.has(p.id) || holdsLine
        || (r.kind === 'spot' && [r.ctx.firstDefender?.id, r.ctx.markTarget?.id].includes(p.id));
      assert.ok(why, `${c.label} ${r.cast.label}: ${p.id} is far from the play and holds no line, no pass and no part of the clip`);
    }
  }
  assert.ok(small.length >= 30, `${small.length} small games, ${lonely} players far from the play`);
});

test('cast: staging is deterministic and a mirrored drill stages with the mirrored players', () => {
  const pick = (st) => Object.fromEntries(STAGES.map((k) => [k, st[k] && { ids: st[k].cast.ids, ghost: st[k].ghost.spot, gates: st[k].gates }]));
  for (const c of spotCases.slice(0, 16)) assert.deepEqual(pick(stagesOf(c.s, { formations, principles: catalogue })), pick(c.st), c.label);
  let pairs = 0;
  for (let i = 0; i + 1 < spotCases.length && spotCases[i + 1].label.endsWith('(mirrored)'); i += 2) {
    const a = spotCases[i].st, b = spotCases[i + 1].st;
    for (const k of ['small', 'medium']) {
      assert.equal(!!a[k], !!b[k], `${spotCases[i].label} ${k}: staged on one side only`);
      if (!a[k]) continue;
      pairs++;
      assert.deepEqual(a[k].cast.ids.map(mirrorPlayerId).sort(), [...b[k].cast.ids].sort(), `${spotCases[i].label} ${k}: ${a[k].cast.ids.join(' ')} vs mirrored ${b[k].cast.ids.join(' ')}`);
    }
  }
  for (const c of passCases) {
    const m = stagesOf(mirrorPassDrill(c.d, { formations }), { formations });
    for (const k of ['small', 'medium']) {
      assert.equal(!!c.st[k], !!m[k], `${c.label} ${k}: staged on one side only`);
      if (c.st[k]) { pairs++; assert.deepEqual(c.st[k].cast.ids.map(mirrorPlayerId).sort(), [...m[k].cast.ids].sort(), `${c.label} ${k} mirrored`); }
    }
  }
  assert.ok(pairs >= 60, `${pairs} mirrored pairs`);
});

// ---------------------------------------------------------------- pass reps: the gate

test('cast: the pass gate holds receiver by receiver, as pass.js plays a tap (3-5 targets, the same best receiver, a real choice, no pass better than in the full game)', () => {
  assert.ok(passCases.length >= 8, `${passCases.length} pass drills`);
  assert.ok(passStaged.length >= 8, `${passStaged.length} staged pass reps`);
  for (const c of passStaged) {
    const { r, d } = c;
    const learnerId = learnerIdOf(d);
    const ids = r.cast.ids;
    const cap = P[c.stage];
    assert.ok(ids.length >= cap.min && ids.length <= cap.max, `${c.label} ${c.stage}: ${ids.length} players`);
    assert.ok(r.cast.theirs >= 1, `${c.label}: no opponent`);
    for (const id of r.clipIds) assert.ok(ids.includes(id), `${c.label}: ${id} has the ball in the clip`);
    // Recomputed: the rating on the reduced freeze frame.
    const frame = reduceFrame(passDrillFrame(d, timing(d).freezeAt, { formations }), ids);
    const rating = rateOptions(frame, learnerId, d.params?.pass);
    assert.equal(rating.best.id, r.rating.best.id, `${c.label}: the staged rating`);
    // What the kid can tap, and what each tap earns, as pass.js does it.
    const taps = passTargets(optionsByReceiver(r.rating.options, learnerId), r.frame, learnerId);
    const fullTaps = passTargets(optionsByReceiver(d.rating.options, learnerId), c.st.full.frame, learnerId);
    const fullBy = optionsByReceiver(d.rating.options, learnerId);
    assert.ok(taps.size >= P.minOptions && taps.size <= P.maxOptions, `${c.label} ${c.stage}: ${taps.size} teammates to pass to`);
    assert.equal(r.gates.options, taps.size, c.label);
    for (const rid of taps.keys()) assert.ok(fullTaps.has(rid), `${c.label} ${c.stage}: ${rid} can be picked here but not in the full game`);
    const fullBest = d.rating.options.find((o) => o.id === d.answer.best) ?? d.rating.best;
    const bestRid = r.rating.best.targetId;
    assert.equal(bestRid, fullBest.targetId, `${c.label} ${c.stage}: the best receiver`);
    assert.ok(taps.has(bestRid), `${c.label}: the best receiver can be picked`);
    const asFull = d.rating.options.find((o) => o.id === r.rating.best.id);
    assert.ok(!asFull || !BAD.has(asFull.label), `${c.label} ${c.stage}: the best pass ${r.rating.best.id} is ${asFull?.label} in the full game`);
    const stars = (rating, o, accept) => gradePass(rating, o.id, { accept }).stars;
    const others = [...taps].filter(([rid]) => rid !== bestRid);
    const starsHere = others.map(([rid, o]) => [rid, stars(r.rating, o, r.answer.accept)]);
    assert.ok(starsHere.some(([, n]) => n < 3), `${c.label} ${c.stage}: every teammate you can pick earns 3 stars (${starsHere.join(' ')})`);
    for (const [rid, n] of starsHere) {
      const inFull = stars(d.rating, fullBy.get(rid), d.answer.accept ?? []);
      assert.ok(n < 3 || inFull === 3, `${c.label} ${c.stage}: ${rid} earns 3 stars here, ${inFull} in the full game`);
    }
    // A real choice between receivers: another receiver's pass is one you should not pick, or the best is clearly ahead.
    const PP = r.rating.params;
    const effective = (o) => (o.tags.some((q) => q.tag === 'too-safe') ? Math.min(o.score, PP.tooSafeCap) : o.score);
    const judged = others.map(([, o]) => o).filter((o) => !r.answer.accept.includes(o.id));
    const margin = r.rating.best.score - Math.max(0, ...judged.map(effective));
    assert.ok(judged.some((o) => BAD.has(o.label)) || margin >= P.passMargin, `${c.label} ${c.stage}: no real choice (margin ${margin})`);
    // Offside is called as in the full game for everyone you can pick.
    for (const [rid, o] of taps) assert.equal(!!o.offside, !!fullBy.get(rid).offside, `${c.label} ${c.stage}: ${rid} offside`);
    for (const o of r.rating.options) assert.ok(ids.includes(o.targetId), `${c.label}: ${o.targetId} is rated but not shown`);
    // No teammate far from the ball who cannot be picked (a decoy the camera would have to fit).
    for (const p of r.frame.players) if (p.team === 'us' && p.id !== learnerId && dist(p, r.frame.ball) > P.farPass) assert.ok(taps.has(p.id), `${c.label} ${c.stage}: ${p.id} is a far decoy`);
    // Drop-in for pass.js: the staged answer is the staged rating's best, graded three stars.
    assert.equal(r.answer.best, r.rating.best.id);
    assert.equal(gradePass(r.rating, r.answer.best, { accept: r.answer.accept }).stars, 3, c.label);
    assert.ok(r.gates.ok && ['wrong-option', 'clear-best'].includes(r.gates.choice), c.label);
  }
  for (const c of passCases) {
    assert.equal(c.st.full.cast.label, '11 v 11');
    assert.equal(c.st.full.rating, c.d.rating, `${c.label}: the full game keeps the drill's own rating`);
  }
});

test('cast: castExtent says how big a cast is drawn at the freeze (its players and the ball) and how far it spills over a box', () => {
  const frame = { ball: { x: 40, y: 30 }, players: [{ id: 'us-LCM', x: 40, y: 30 }, { id: 'us-ST', x: 70, y: 34 }, { id: 'us-LW', x: 55, y: 8 }, { id: 'them-DM', x: 45, y: 31 }] };
  const e = castExtent(frame, ['us-LCM', 'us-ST', 'them-DM']);
  assert.deepEqual({ along: e.along, across: e.across }, { along: 30, across: 4 });
  assert.equal(e.over, Math.max(4 / P.passBox.across, 30 / P.passBox.along), 'the longer side as a share of the box');
  const wide = castExtent(frame, new Set(['us-LCM', 'us-LW', 'them-DM']), { along: 30, across: 20 });
  assert.deepEqual(wide, { along: 15, across: 23, over: 23 / 20 }, 'a Set of ids, another box');
  assert.equal(castExtent({ ...frame, ball: { x: 10, y: 60 } }, ['us-LCM']).across, 30, 'the ball is drawn too');
  assert.deepEqual(castExtent({ players: [] }, []), { along: 0, across: 0, over: 0 });
  // Every staged pass rep reports it; the full match's is the whole game's.
  for (const c of passStaged) assert.deepEqual(c.r.gates.extent, castExtent(c.r.frame, c.r.cast.ids), c.label);
  for (const c of passCases) assert.ok(c.st.full.gates.extent.over >= Math.max(...passStaged.filter((x) => x.label === c.label).map((x) => x.r.gates.extent.over), 0), c.label);
});

test('cast: a pass rep\'s smaller game is the most compact cast that passes: never a stage lost, never the lesson, never wider than the relevance order\'s', (t) => {
  // Play-test (the verifier, a 375 x 812 phone): "Who's open?" small games almost never zoomed in: the relevance order's
  // first cast that passed often had a decoy at each touchline, so the camera fitted the whole width and the figures
  // were drawn as small as the full match's. The same gate, the compact cast (passCompact: false is the old order alone).
  const cases = [...passCases, ...passCases.map((c) => ({ label: `${c.label} (mirrored)`, d: mirrorPassDrill(c.d, { formations }) }))];
  let n = 0, tighter = 0;
  const overs = { compact: [], plain: [] };
  for (const c of cases) {
    const st = c.st ?? stagesOf(c.d, { formations });
    const old = stagesOf(c.d, { formations, params: { passCompact: false } });
    for (const k of ['small', 'medium']) {
      if (old[k]) assert.ok(st[k], `${c.label} ${k}: the old order staged it, the compact choice must too`);
      if (!st[k]) continue;
      n++;
      const r = st[k];
      assert.ok(r.gates.ok && r.cast.ids.length >= P[k].min && r.cast.ids.length <= P[k].max, `${c.label} ${k}`);
      assert.equal(r.gates.extent.over, castExtent(r.frame, r.cast.ids).over);
      if (!old[k]) continue;
      if (old[k].gates.lesson !== false) assert.notEqual(r.gates.lesson, false, `${c.label} ${k}: the old cast taught the drill's lesson, so must this one`);
      if (r.gates.lesson !== false && old[k].gates.lesson !== false) {
        assert.ok(r.gates.extent.over <= old[k].gates.extent.over + P.passBoxSlack + 1e-9, `${c.label} ${k}: ${r.cast.label} spills ${r.gates.extent.over.toFixed(2)}, wider than the old ${old[k].gates.extent.over.toFixed(2)}`);
      }
      if (r.gates.extent.over < old[k].gates.extent.over - P.passBoxSlack) tighter++;
      if (k === 'small') { overs.compact.push(r.gates.extent.over); overs.plain.push(old[k].gates.extent.over); }
    }
  }
  const med = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
  t?.diagnostic?.(`${n} staged pass reps, ${tighter} more compact than the old order's; small games' spill over the box, median ${med(overs.compact).toFixed(2)} (old ${med(overs.plain).toFixed(2)})`);
  assert.ok(n >= 16 && tighter >= 3, `${n} staged, ${tighter} tighter`);
  assert.ok(med(overs.compact) < med(overs.plain), 'the small games are drawn more compact');
  // Each cast is judged (and traced) once, however many ways the search reached it.
  const trace = [];
  const r = stagePassDrill(passCases[0].d, 'small', { formations, trace });
  const keys = trace.map((e) => [...e.ids].sort().join(','));
  assert.equal(new Set(keys).size, keys.length, 'no cast traced twice');
  if (r) assert.ok(r.gates.tries >= 1 && r.gates.tries <= keys.length, `${r.gates.tries} casts judged, ${keys.length} traced`);
});

// ---------------------------------------------------------------- the stage a rep is played at

test('cast: bestStage plays the wanted stage, else the next bigger one that passes, never a smaller one; the full match always passes', () => {
  const fallback = spotCases.find((c) => !c.st.small && c.st.medium);
  const smallOk = spotCases.find((c) => c.st.small);
  assert.ok(fallback && smallOk, 'fixtures: a drill with no small stage and one with');
  const a = bestStage(fallback.s, 'small', { formations, principles: catalogue });
  assert.equal(a.stage, 'medium');
  assert.equal(a.wanted, 'small');
  assert.deepEqual(a.cast.ids, fallback.st.medium.cast.ids);
  const b = bestStage(smallOk.s, 'small', { formations, principles: catalogue });
  assert.equal(b.stage, 'small');
  assert.deepEqual(b.cast.ids, smallOk.st.small.cast.ids);
  assert.equal(bestStage(smallOk.s, 'medium', { formations, principles: catalogue }).stage, smallOk.st.medium ? 'medium' : 'full', 'never smaller than wanted');
  const full = bestStage(smallOk.s, 'full', { formations, principles: catalogue });
  assert.equal(full.stage, 'full');
  assert.equal(full.cast.ids.length, 22);
  assert.equal(bestStage(smallOk.s, undefined, { formations }).stage, 'full', 'no stage asked: the full match');
  // A gate nothing smaller can pass (params): the full match, never null.
  const trace = [];
  const none = bestStage(smallOk.s, 'small', { formations, principles: catalogue, params: { sameAnswer: -1 }, trace });
  assert.equal(none.stage, 'full');
  assert.ok(trace.length >= 2 && trace.every((x) => x.failed.length), 'every cast tried is traced with why it failed');
  assert.equal(stageSpotDrill(smallOk.s, 'small', { formations, params: { sameAnswer: -1 } }), null, 'a stage that cannot teach it is null');
  // Road reps work as they come.
  assert.equal(bestStage({ kind: 'spot', scenario: smallOk.s }, 'small', { formations, principles: catalogue }).stage, 'small');
  const pc = passCases.find((c) => c.st.small) ?? passCases[0];
  const pr = bestStage({ kind: 'pass', drill: pc.d }, 'small', { formations });
  assert.equal(pr.kind, 'pass');
  assert.equal(pr.stage, pc.st.small ? 'small' : pc.st.medium ? 'medium' : 'full');
  assert.deepEqual(bestStage(pc.d, 'small', { formations }).cast, pr.cast);
  assert.equal(stagePassDrill(pc.d, 'full', { formations }).cast.label, '11 v 11');
  assert.throws(() => stageSpotDrill(smallOk.s, 'huge', { formations }), /unknown stage/);
  assert.throws(() => stageSpotDrill(smallOk.s, 'small', {}), /formations/);
});

test('cast: five reps stage in well under 300 ms (bestStage, the 0-star plan, fallbacks and the slow cases included)', () => {
  const byTries = [...spotCases].sort((x, y) => (y.st.medium?.gates.tries ?? 0) - (x.st.medium?.gates.tries ?? 0));
  const reps = [byTries[0], byTries[1], spotCases.find((c) => !c.st.small && c.st.medium), spotCases[0], spotCases[1]].map((c) => c.s);
  const plan = ['small', 'small', 'small', 'medium', 'medium'];
  const { median } = cpuTimed(() => reps.forEach((s, i) => bestStage(s, plan[i], { formations, principles: catalogue })));
  assert.ok(median < 300 * PERF_SLACK, `${median.toFixed(0)} ms for five reps`);
  const pass = passCases.slice(0, 5).map((c) => c.d);
  const p = cpuTimed(() => pass.forEach((d, i) => bestStage(d, plan[i], { formations })));
  assert.ok(p.median < 100 * PERF_SLACK, `${p.median.toFixed(0)} ms for five pass reps`);
});
