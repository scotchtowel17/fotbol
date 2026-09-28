// The authored drills (data/scenarios/*.json, listed in data/scenarios/index.json): every scenario and
// its left/right mirror is a good drill under the engine (scripts/check-scenarios.mjs checkScenario's
// gates), the primary principle's rule is actually met at the answer, the drill judges a spot exactly
// as `npm run check` keys it, the learner-facing text follows the copy rules, and the curriculum lists
// exactly the indexed scenarios.
import { test, assert, loadJSON } from './harness.js';
import { checkScenario, CHECK_DEFAULTS } from '../scripts/check-scenarios.mjs';
import { createFormation } from '../js/engine/formation.js';
import { mirrorScenario, normalizeScenario, learnerId } from '../js/engine/scenario.js';
import { frameAt } from '../js/engine/timeline.js';
import { judgeSpot } from '../js/engine/analyse.js';
import { buildContext } from '../js/engine/context.js';
import { computeGhost } from '../js/engine/ghost.js';
import { toleranceFor } from '../js/engine/score.js';
import { RULES_BY_ID } from '../js/engine/rules/index.js';
import { dist } from '../js/engine/geometry.js';
import { WIDTH } from '../js/engine/pitch.js';

const principlesData = await loadJSON('data/principles.json');
const byId = Object.fromEntries(principlesData.principles.map((p) => [p.id, p]));
const curriculum = await loadJSON('data/curriculum.json');
const index = (await loadJSON('data/scenarios/index.json')).scenarios;
const F = createFormation(await loadJSON('data/formations/helios-433.json'));
const formations = { us: F, them: F };
const scenarios = await Promise.all(index.map(async (e) => ({ entry: e, raw: await loadJSON(`data/scenarios/${e.file}`) })));

const RULE_OK = 0.9; // the primary principle's rule at the answer (below this the lesson is only partly keyed)
const KID_WORDS = 15; // ARCHITECTURE §5.5 text rules
// Screen or side directions: scenarios are mirrored left↔right and the pitch can be drawn either way.
const SIDE_WORDS = /\b(on|to|the|your|their|our|from)\s+(left|right)\b|\b(left|right)[-\s](back|wing|winger|side|flank|touchline|channel|half|foot|footed|centre|center|of)\b|\b(up|down)\s+the\s+screen\b|\b(leftwards?|rightwards?)\b/i;
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

const cases = [];
for (const { entry, raw } of scenarios) {
  for (const mirror of [false, true]) {
    const s = mirror ? mirrorScenario(normalizeScenario(raw)) : raw;
    cases.push({ entry, raw, mirror, label: `${raw.id}${mirror ? ' (mirrored)' : ''}`, r: checkScenario(s, { principles: principlesData, formations }) });
  }
}

test('scenarios: the index lists every scenario file there is (build-index), and there are drills in every module', () => {
  assert.ok(index.length >= 30, `only ${index.length} scenarios indexed`);
  for (const m of curriculum.modules.filter((x) => x.kind === 'drills')) {
    assert.ok(index.some((e) => e.module === m.id), `${m.id} has no scenarios`);
  }
});

test('scenarios: every scenario and its mirror is valid and passes the drill-quality gates (S ghost, not trivial, no misconception at the answer)', () => {
  for (const c of cases) {
    assert.deepEqual(c.r.errors, [], `${c.label}: invalid`);
    assert.deepEqual(c.r.problems, [], `${c.label}: ${c.r.problems.join('; ')}`);
    assert.ok(c.r.ghost.score >= CHECK_DEFAULTS.minGhostScore, `${c.label}: ghost ${c.r.ghost.score}`);
    if (c.r.scenario.answer.hold !== true) {
      assert.ok(c.r.moved >= CHECK_DEFAULTS.minMove, `${c.label}: answer ${c.r.moved.toFixed(1)} m from the start`);
      assert.ok(c.r.startScore < CHECK_DEFAULTS.maxStartScore, `${c.label}: standing still at the start scores ${c.r.startScore}`);
    }
  }
});

test('checkScenario: a start that already scores a B or better fails the gates, unless the lesson is to hold your position', async () => {
  const ex = await loadJSON('data/scenarios/_example.json');
  const first = checkScenario(ex, { principles: principlesData, formations });
  assert.deepEqual(first.problems, [], '_example is a good drill');
  assert.ok(first.startScore < CHECK_DEFAULTS.maxStartScore);
  // Start the learner right next to the answer, where standing still already scores well.
  const near = { x: first.ghost.spot.x - 1, y: first.ghost.spot.y + 0.5 };
  const idle = checkScenario({ ...ex, learner: { ...ex.learner, start: near } }, { principles: principlesData, formations });
  assert.ok(idle.startScore >= CHECK_DEFAULTS.maxStartScore, `fixture: the start scores ${idle.startScore}`);
  assert.ok(idle.problems.some((p) => /standing still at the start spot scores/.test(p)), idle.problems.join('; '));
  const hold = checkScenario({ ...ex, learner: { ...ex.learner, start: near }, answer: { ...ex.answer, hold: true } }, { principles: principlesData, formations });
  assert.ok(!hold.problems.some((p) => /standing still/.test(p)), 'answer.hold: holding your position is the lesson');
});

test('scenarios: where the primary principle has a rule, that rule applies at the answer and is met there', () => {
  for (const c of cases) {
    const primary = c.raw.principles[0];
    const ids = byId[primary]?.ruleIds ?? [];
    if (!ids.length) continue; // judged by the zone and the other rules (ROADMAP: no rule yet)
    const applied = c.r.ghost.result.rules.filter((q) => ids.includes(q.id));
    assert.ok(applied.length, `${c.label}: no rule of ${primary} (${ids.join(', ')}) applies at the freeze (duty ${c.r.ctx.duty})`);
    const best = Math.max(...applied.map((q) => q.s));
    assert.ok(best >= RULE_OK, `${c.label}: ${primary}'s rule scores ${best.toFixed(2)} at the answer`);
  }
});

test('scenarios: a mirrored scenario has the mirrored answer', () => {
  for (let i = 0; i < cases.length; i += 2) {
    const a = cases[i].r, b = cases[i + 1].r;
    assert.equal(a.ctx.duty, b.ctx.duty, `${cases[i].label}: duty`);
    assert.ok(Math.abs(a.ghost.score - b.ghost.score) <= 1, `${cases[i].label}: ghost ${a.ghost.score} vs mirrored ${b.ghost.score}`);
    assert.ok(dist(a.ghost.spot, { x: b.ghost.spot.x, y: WIDTH - b.ghost.spot.y }) <= 0.6, `${cases[i].label}: mirrored ghost`);
  }
});

test('scenarios: the drill judges a spot on the keyed frame, so standing on the answer scores the answer (wherever you start)', () => {
  for (const c of cases) {
    const { scenario: s, t, base, ghost } = c.r;
    const id = learnerId(s);
    // drill.js judge(): the free playback's frame with the learner's token moved to the spot, the base
    // from learnerBaseAt, then context, ghost (round the base or the authored ideal) and judgeSpot.
    const free = frameAt(s, t, { formations });
    const judge = (spot) => {
      const frame = { ...free, players: free.players.map((p) => (p.id === id ? { ...p, x: spot.x, y: spot.y } : p)) };
      const ctx = buildContext(frame, { learnerId: id, base });
      const tol = toleranceFor(s.learner.role, s.answer.tol);
      const g = computeGhost(ctx, { base: s.answer.mode === 'authored' ? s.answer.ideal : base, tol });
      return { g, judged: judgeSpot({ ctx, ghost: g }, spot, { wording: 'standard', principles: byId }) };
    };
    const fromStart = judge(c.r.start);
    assert.ok(dist(fromStart.g.spot, ghost.spot) < 1e-9, `${c.label}: the ghost shown after starting at the start spot moved`);
    assert.equal(fromStart.judged.result.score, c.r.startScore, `${c.label}: the drill and npm run check score the start alike`);
    assert.ok(fromStart.judged.result.score < CHECK_DEFAULTS.maxStartScore || s.answer.hold === true, `${c.label}: standing at the start scores ${fromStart.judged.result.score}`);
    const onAnswer = judge(fromStart.g.spot);
    assert.equal(onAnswer.judged.result.score, ghost.score, `${c.label}: standing on the answer scores ${onAnswer.judged.result.score}, the ghost ${ghost.score}`);
    // Standing on the answer leaves nothing to fix: no reason (a trade-off the answer makes is not one) and no cue.
    const fb = onAnswer.judged.feedback;
    assert.deepEqual(fb.reasons.map((r) => r.text), [], `${c.label}: reasons on the answer`);
    assert.equal(fb.cue, null, `${c.label}: cue on the answer: ${fb.cue?.text}`);
  }
});

test('scenarios: learner text is present in both wordings, short for kids, never names a side, and never assumes a gender', () => {
  for (const { raw } of scenarios) {
    const id = raw.id;
    assert.ok(typeof raw.brief === 'string' && raw.brief.trim(), `${id}: brief`);
    assert.ok(typeof raw.question === 'string' && raw.question.trim(), `${id}: question`);
    assert.ok(raw.takeaway && typeof raw.takeaway.standard === 'string' && typeof raw.takeaway.kid === 'string', `${id}: takeaway { standard, kid }`);
    assert.ok(words(raw.takeaway.kid) <= KID_WORDS, `${id}: takeaway.kid has ${words(raw.takeaway.kid)} words`);
    for (const k of ['briefKid', 'questionKid']) if (raw[k] !== undefined) assert.ok(words(raw[k]) <= KID_WORDS, `${id}: ${k} has ${words(raw[k])} words`);
    assert.ok(raw.misconceptions.length >= 1, `${id}: at least one misconception`);
    const texts = [raw.title, raw.brief, raw.briefKid, raw.question, raw.questionKid, raw.takeaway.standard, raw.takeaway.kid];
    for (const m of raw.misconceptions) {
      assert.ok(typeof m.text === 'string' && m.text.trim(), `${id}/${m.id}: text`);
      assert.ok(typeof m.textKid === 'string' && m.textKid.trim(), `${id}/${m.id}: textKid`);
      assert.ok(words(m.textKid) <= KID_WORDS, `${id}/${m.id}: textKid has ${words(m.textKid)} words`);
      texts.push(m.text, m.textKid);
    }
    for (const t of texts.filter(Boolean)) {
      assert.doesNotMatch(t, SIDE_WORDS, `${id}: "${t}" names a side (scenarios are mirrored)`);
      assert.doesNotMatch(t, /\b(he|his|him|himself|she|her|hers|herself)\b/i, `${id}: "${t}" (players are "they": the copy is for every player)`);
    }
  }
});

test('scenarios: principles exist, the primary one is v1, and their rules are registered', () => {
  for (const { raw } of scenarios) {
    for (const pid of raw.principles) {
      assert.ok(byId[pid], `${raw.id}: unknown principle ${pid}`);
      if (pid === raw.principles[0]) assert.equal(byId[pid].release, 'v1', `${raw.id}: the primary principle ${pid} is not a v1 principle`);
      for (const rid of byId[pid].ruleIds ?? []) assert.ok(RULES_BY_ID[rid], `${pid}: rule ${rid}`);
    }
  }
});

test('curriculum: each drill module lists exactly its indexed scenarios, each once', () => {
  const byModule = new Map();
  for (const e of index) byModule.set(e.module, [...(byModule.get(e.module) ?? []), e.id]);
  for (const m of curriculum.modules) {
    const want = m.kind === 'drills' ? byModule.get(m.id) ?? [] : [];
    assert.deepEqual([...m.scenarios].sort(), [...want].sort(), `${m.id}: data/curriculum.json scenarios vs data/scenarios/index.json (run node scripts/build-index.mjs, then update the module)`);
  }
  for (const e of index) assert.ok(curriculum.modules.some((m) => m.id === e.module), `${e.id}: module ${e.module} is not in the curriculum`);
});

test('curriculum: every drill module offers drills to each role family it lists', () => {
  const fam = { LCB: 'CB', RCB: 'CB', LB: 'FB', RB: 'FB', DM: 'DM', LCM: 'CM', RCM: 'CM', LW: 'W', RW: 'W', ST: 'ST' };
  for (const m of curriculum.modules.filter((x) => x.kind === 'drills')) {
    const have = new Set(index.filter((e) => e.module === m.id).map((e) => fam[e.role]));
    for (const f of m.roles) assert.ok(have.has(f), `${m.id} lists ${f} but has no ${f} scenario`);
    for (const f of have) assert.ok(m.roles.includes(f), `${m.id} has a ${f} scenario but does not list ${f} in roles`);
  }
});
