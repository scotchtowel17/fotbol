// js/engine/spotdrill.js: generated "Find your spot" drills in the authored scenario format (KID_REDESIGN §6.2).
// Every drill must pass npm run check's gates (scripts/check-scenarios.mjs checkScenario) exactly as an authored one.
import { test, assert, approx, loadJSON } from './harness.js';
import { SPOT_DEFAULTS, SPOT_PRINCIPLES, SPOT_WORDS, generateSpotDrill, checkSpotDrill } from '../js/engine/spotdrill.js';
import { checkScenario, CHECK_DEFAULTS } from '../scripts/check-scenarios.mjs';
import { createFormation } from '../js/engine/formation.js';
import { validateScenario, mirrorScenario, normalizeScenario } from '../js/engine/scenario.js';
import { frameAt } from '../js/engine/timeline.js';
import { SEQUENCE_DEFAULTS } from '../js/engine/sequence.js';
import { RULES_BY_ID } from '../js/engine/rules/index.js';
import { ROLE_INFO } from '../js/engine/roles.js';

const F = createFormation(await loadJSON('data/formations/helios-433.json'));
const formations = { us: F, them: F };
const catalogue = await loadJSON('data/principles.json');
const byId = Object.fromEntries(catalogue.principles.map((p) => [p.id, p]));
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
// tests/scenarios-content.test.js copy rules: scenarios are mirrored, so no side; players are "they".
const SIDE_WORDS = /\b(on|to|the|your|their|our|from)\s+(left|right)\b|\b(left|right)[-\s](back|wing|winger|side|flank|touchline|channel|half|foot|footed|centre|center|of)\b|\b(up|down)\s+the\s+screen\b|\b(leftwards?|rightwards?)\b/i;
const GENDER = /\b(he|his|him|himself|she|her|hers|herself)\b/i;

const cache = new Map();
const spot = (seed, role, principles) => {
  const key = JSON.stringify([seed, role, principles]);
  if (!cache.has(key)) cache.set(key, generateSpotDrill({ seed, role, principles, formations, catalogue }));
  return cache.get(key);
};
const SAMPLE = [[1, 'RB', ['D1', 'D2']], [2, 'LCB', ['D3', 'D4']], [3, 'LCB', ['D5', 'T3', 'U8']], [4, 'RB', ['B3', 'B4']], [5, 'LW', ['B1', 'B6', 'B2']],
  [6, 'ST', ['P2', 'P1', 'B5']], [7, 'LW', ['P10']], [8, 'LCB', ['U4', 'U3', 'R1']], [9, 'RCM', ['U2', 'U5', 'R2']], [10, 'DM', ['R3', 'U7', 'T2']], [11, 'ST', ['U6', 'U1']]];

test('the gates are npm run check\'s, and the speeds are Live\'s', () => {
  assert.equal(SPOT_DEFAULTS.minGhostScore, CHECK_DEFAULTS.minGhostScore);
  assert.equal(SPOT_DEFAULTS.minMove, CHECK_DEFAULTS.minMove);
  assert.equal(SPOT_DEFAULTS.maxStartScore, CHECK_DEFAULTS.maxStartScore);
  assert.deepEqual(SPOT_DEFAULTS.passSpeed, SEQUENCE_DEFAULTS.passSpeed);
  assert.deepEqual(SPOT_DEFAULTS.carrySpeed, SEQUENCE_DEFAULTS.carrySpeed);
  assert.ok(SPOT_DEFAULTS.afterDelay > 0.35, 'play after the freeze never reaches back into the frozen picture (timeline adjustWindow / 2 + adjustStep)');
  for (const [p, e] of Object.entries(SPOT_PRINCIPLES)) {
    assert.ok(byId[p], `${p} is a principle`);
    for (const r of e.rules) assert.ok(RULES_BY_ID[r].principles.includes(p), `${r} checks ${p}`);
    assert.ok(e.moments.length > 0 && e.moments.every((m) => m === 'us' || m === 'them'));
  }
});

test('generateSpotDrill is deterministic per seed', () => {
  const a = generateSpotDrill({ seed: 3, role: 'LB', principles: ['D1'], formations, catalogue });
  const b = generateSpotDrill({ seed: 3, role: 'LB', principles: ['D1'], formations, catalogue });
  assert.ok(a);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(generateSpotDrill({ seed: 40, role: 'LB', principles: ['D1'], formations, catalogue }).timeline), JSON.stringify(a.timeline));
  const s = generateSpotDrill({ seed: 'Kick Off', role: 'ST', principles: ['B2'], formations, catalogue });
  assert.ok(s && /^spot-st-kick-off/.test(s.id));
  assert.throws(() => generateSpotDrill({ seed: 1, role: 'GK', formations }));
});

test('a generated drill is an authored-format scenario that passes npm run check\'s gates', () => {
  for (const [seed, role, principles] of SAMPLE) {
    const s = spot(seed, role, principles);
    assert.ok(s, `${role} ${principles} seed ${seed}: a drill`);
    assert.deepEqual(validateScenario(s, { principles: catalogue }), [], s.id);
    assert.equal(s.source.kind, 'generated');
    assert.equal(s.answer.mode, 'engine');
    assert.ok(principles.includes(s.principles[0]), `${s.id}: teaches ${s.principles[0]}`);
    const r = checkScenario(s, { principles: catalogue, formations });
    assert.deepEqual(r.problems, [], `${s.id}: ${r.problems.join('; ')}`);
    assert.ok(r.ghost.score >= 90 && r.moved >= 5 && r.startScore < 70, `${s.id}: ghost ${r.ghost.score}, moved ${r.moved.toFixed(1)}, start ${r.startScore}`);
    // One of the principles asked has a rule weighted 2+ and met at the answer: the primary one.
    const taught = r.ghost.result.rules.filter((q) => q.principles.includes(s.principles[0]) && q.weight >= SPOT_DEFAULTS.minRuleWeight && q.s >= SPOT_DEFAULTS.minRuleScore);
    assert.ok(taught.length, `${s.id}: ${s.principles[0]}'s rule at the answer`);
    // The learner's duty fits the moment: defending out of possession, supporting (never on the ball) in it.
    if (s.moment === 'out_of_possession') assert.match(r.ctx.duty, /defender$/, s.id);
    else assert.match(r.ctx.duty, /^(second|third)-attacker$/, s.id);
    // checkSpotDrill judges it the same way.
    const own = checkSpotDrill(s, { formations, principles: catalogue });
    assert.deepEqual(own.problems, []);
    assert.equal(own.startScore, r.startScore);
    assert.equal(own.ghost.score, r.ghost.score);
  }
});

test('the event: learner.start is the learner\'s own spot before it, the freeze comes 0.4-1 s after the ball arrives, speeds are real', () => {
  for (const [seed, role, principles] of SAMPLE) {
    const s = spot(seed, role, principles);
    const me = `us-${role}`;
    const p0 = frameAt(s, 0, { formations }).players.find((p) => p.id === me);
    approx(s.learner.start.x, p0.x, 0.051);
    approx(s.learner.start.y, p0.y, 0.051);
    const b = s.timeline.ball;
    const freeze = s.timeline.freezeAt;
    const arrive = b.filter((k) => k.t <= freeze).at(-1).t;
    assert.ok(freeze - arrive >= SPOT_DEFAULTS.freezeAfter[0] - 1e-9 && freeze - arrive <= SPOT_DEFAULTS.freezeAfter[1] + 1e-9, `${s.id}: ${(freeze - arrive).toFixed(2)} s after the ball arrives`);
    assert.ok(freeze >= 2.5, `${s.id}: ${freeze} s of play to watch`);
    assert.ok(s.timeline.duration > freeze + 1, 'play goes on after the freeze (See what happens)');
    for (let i = 0; i < b.length - 1; i++) {
      const v = Math.hypot(b[i + 1].x - b[i].x, b[i + 1].y - b[i].y) / (b[i + 1].t - b[i].t);
      if (b[i].event === 'pass') assert.ok(v >= 11.95 && v <= 20.05, `${s.id}: pass at ${v.toFixed(1)} m/s`);
      else assert.ok(v <= 7.05, `${s.id}: ${v.toFixed(1)} m/s`);
    }
    // The play after the freeze never changes the frozen picture.
    const cut = normalizeScenario(s);
    cut.timeline.ball = cut.timeline.ball.filter((k) => k.t <= freeze);
    cut.timeline.duration = freeze;
    const a = frameAt(s, freeze, { formations }), c = frameAt(cut, freeze, { formations });
    a.players.forEach((p, i) => { approx(p.x, c.players[i].x, 1e-9); approx(p.y, c.players[i].y, 1e-9); });
  }
});

test('the words: simple and short, no side and no he or she, the title and takeaway from the principle', () => {
  for (const [seed, role, principles] of SAMPLE) {
    const s = spot(seed, role, principles);
    for (const k of ['briefKid', 'questionKid', 'titleKid']) assert.ok(words(s[k]) <= 12, `${s.id}.${k}: "${s[k]}"`);
    assert.match(s.questionKid, /^(Their|Your) (keeper|defender|midfielder|winger|striker) has the ball\. Where do you go\?$/);
    assert.equal(s.titleKid, byId[s.principles[0]].kidName);
    assert.equal(s.title, byId[s.principles[0]].name);
    assert.deepEqual(s.takeaway, byId[s.principles[0]].summary);
    const texts = [s.title, s.titleKid, s.brief, s.briefKid, s.question, s.questionKid, s.takeaway.standard, s.takeaway.kid, ...s.misconceptions.flatMap((m) => [m.text, m.textKid])];
    for (const t of texts) {
      assert.doesNotMatch(t, SIDE_WORDS, `${s.id}: "${t}"`);
      assert.doesNotMatch(t, GENDER, `${s.id}: "${t}"`);
      assert.doesNotMatch(t, /\b[A-Z]{1,2}\d{1,2}\b/, `${s.id}: "${t}" has a code`);
    }
  }
  for (const t of [...Object.values(SPOT_WORDS.briefKid), SPOT_WORDS.stillTextKid]) assert.ok(words(t) <= 12, t);
});

test('a principle without a rule cannot be keyed by the engine: null (fast)', () => {
  const t0 = performance.now();
  for (const p of [['T3'], ['U8'], ['B6', 'P1'], ['U3', 'R1'], ['PA5']]) assert.equal(generateSpotDrill({ seed: 1, role: 'LCB', principles: p, formations }), null, String(p));
  assert.ok(performance.now() - t0 < 50);
});

test('the mirror of a generated drill is a good drill too (the engine is left/right symmetric)', () => {
  for (const [seed, role, principles] of SAMPLE.slice(0, 6)) {
    const m = mirrorScenario(spot(seed, role, principles));
    const r = checkScenario(m, { principles: catalogue, formations });
    assert.deepEqual(r.problems, [], `${m.id}: ${r.problems.join('; ')}`);
  }
});

test('yield: the principles with a rule generate for the positions that rule judges (KID_REDESIGN §6.2)', () => {
  // Reliable (role family, principles) pairs: most seeds give a drill within maxAttempts. Measured per try (docs/ARCHITECTURE.md
  // §5.15): press 17-86 %, cover and tuck 11-25 %, marking 13-35 %, support 13-43 %, width and pin 9-17 %, between the lines
  // 9-46 %, crosses 43 % (wingers), the line 22-75 % (back four), slide and compact 14-75 %, screen 75 % (the #6).
  const RELIABLE = [
    ['LB', ['D1', 'D2']], ['LCM', ['D1', 'D2']], ['RW', ['D1', 'D2']], ['ST', ['D1', 'D2']],
    ['RCB', ['D3', 'D4']], ['LB', ['D3', 'D4']], ['DM', ['D3', 'D4']],
    ['LCB', ['D5']], ['RCM', ['D5']],
    ['RCB', ['B3', 'B4']], ['LB', ['B3', 'B4']], ['ST', ['B3', 'B4']],
    ['LW', ['B1', 'B2']], ['ST', ['B1', 'B2']],
    ['RB', ['P2', 'B5']], ['ST', ['P2', 'B5']],
    ['RW', ['P10']],
    ['RCB', ['U4']], ['LB', ['U4']],
    ['DM', ['U2', 'U5']], ['LW', ['U2', 'U5']],
    ['DM', ['R3']],
    ['LCB', ['U1']], ['RCM', ['U1']],
  ];
  const t0 = performance.now();
  let made = 0, tries = 0;
  for (const [role, principles] of RELIABLE) {
    let ok = 0;
    for (const seed of [1000, 2000, 3000]) {
      const d = generateSpotDrill({ seed, role, principles, formations, catalogue });
      tries++;
      if (d) { ok++; made++; assert.ok(principles.includes(d.principles[0])); }
    }
    assert.ok(ok >= 2, `${role} ${principles}: ${ok} of 3 seeds gave a drill`);
  }
  const per = (performance.now() - t0) / tries;
  assert.ok(per < 250, `${per.toFixed(0)} ms per drill`);
  assert.ok(made / tries >= 0.9, `${made} of ${tries}`);
  // And what cannot be generated: a rule that never judges that position gives nothing (the screen is the #6's).
  assert.equal(generateSpotDrill({ seed: 1, role: 'LW', principles: ['R3'], formations, params: { maxAttempts: 8 } }), null);
  assert.equal(ROLE_INFO.DM.family, 'DM');
});
