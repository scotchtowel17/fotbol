// js/engine/spotdrill.js: generated "Find your spot" drills in the authored scenario format (KID_REDESIGN §6.2).
// Every drill must pass npm run check's gates (scripts/check-scenarios.mjs checkScenario) exactly as an authored one.
import { test, assert, approx, loadJSON, timed, isNode, PERF_SLACK } from './harness.js';
import {
  SPOT_DEFAULTS, SPOT_PRINCIPLES, SPOT_WORDS, SPOT_YIELD, generateSpotDrill, checkSpotDrill, canGenerateSpot, allSpotTexts,
} from '../js/engine/spotdrill.js';
import { checkScenario, CHECK_DEFAULTS } from '../scripts/check-scenarios.mjs';
import { createFormation } from '../js/engine/formation.js';
import { validateScenario, mirrorScenario, normalizeScenario } from '../js/engine/scenario.js';
import { frameAt, carrierAt } from '../js/engine/timeline.js';
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

/** CPU milliseconds per call in Node (process.cpuUsage: not inflated by test files running side by side), else wall clock. */
function cpuTimed(fn, { warmup = 1, runs = 5 } = {}) {
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

// Reading age as tests/copy.test.js grades it (Flesch-Kincaid over the words, with the same football allow-list), so
// every question template is held to the Player-mode rules, not only the few drills the copy test generates.
const FOOTBALL_WORDS = new Set(['goalkeeper', 'keeper', 'defender', 'defending', 'midfielder', 'midfield', 'attacker', 'attacking', 'teammate', 'sideline',
  'offside', 'onside', 'striker', 'winger', 'penalty', 'halfway', 'opponent', 'football', 'forward', 'corner']);
function syllables(word) {
  let w = String(word).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]/g, '');
  if (!w) return 0;
  if (FOOTBALL_WORDS.has(w) || (w.endsWith('s') && FOOTBALL_WORDS.has(w.slice(0, -1)))) return 1;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, (w.match(/[aeiouy]{1,2}/g) ?? []).length);
}
const wordsOf = (t) => String(t).split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
const sentencesOf = (t) => String(t).split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter((x) => wordsOf(x).length);
function fkGrade(texts) {
  let W = 0, S = 0, Y = 0;
  for (const t of texts) {
    const ws = wordsOf(t);
    W += ws.length;
    S += sentencesOf(t).length;
    for (const w of ws) Y += w.split('-').reduce((a, q) => a + syllables(q), 0);
  }
  return W ? 0.39 * (W / S) + 11.8 * (Y / W) - 15.59 : 0;
}
const JARGON = /\b(?:press(?:es|ed|ing|er|ure)?|cover(?:s|ed|ing)?|mark(?:ing|ed|ers?)?|carriers?|support(?:s|ed|ing)?|switch(?:es|ed|ing)?|zones?|lanes?|half[- ]?spaces?|touchlines?|bylines?|flanks?|channels?|third|transitions?|turnovers?|deep(?:er)?|tuck(?:s|ed|ing)?|compact|kids?)\b|#\d|\b[A-Z]{1,2}\d{1,2}\b|\d/i;

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

test('the words: simple and short, no side and no he or she, the title and takeaway from the principle, a question template', () => {
  for (const [seed, role, principles] of SAMPLE) {
    const s = spot(seed, role, principles);
    for (const k of ['briefKid', 'questionKid', 'titleKid']) assert.ok(words(s[k]) <= 12, `${s.id}.${k}: "${s[k]}"`);
    // The question is the drill's template filled in with who has the ball at the freeze and where it is.
    assert.ok(SPOT_WORDS.templates[s.template], `${s.id}: template ${s.template}`);
    const t = s.timeline.freezeAt, ball = s.timeline.ball.findLast((k) => k.t <= t);
    assert.equal(s.questionKid, SPOT_WORDS.questionKid(carrierAt(s, t), s.template, ball.x), s.id);
    assert.equal(s.question, SPOT_WORDS.question(carrierAt(s, t), s.template, ball.x), s.id);
    assert.equal(s.titleKid, byId[s.principles[0]].kidName);
    assert.equal(s.title, byId[s.principles[0]].name);
    assert.deepEqual(s.takeaway, byId[s.principles[0]].summary);
    const texts = [s.title, s.titleKid, s.brief, s.briefKid, s.question, s.questionKid, s.takeaway.standard, s.takeaway.kid, ...s.misconceptions.flatMap((m) => [m.text, m.textKid])];
    for (const x of texts) {
      assert.doesNotMatch(x, SIDE_WORDS, `${s.id}: "${x}"`);
      assert.doesNotMatch(x, GENDER, `${s.id}: "${x}"`);
      assert.doesNotMatch(x, /\b[A-Z]{1,2}\d{1,2}\b/, `${s.id}: "${x}" has a code`);
    }
  }
  for (const t of [...Object.values(SPOT_WORDS.briefKid), SPOT_WORDS.stillTextKid]) assert.ok(words(t) <= 12, t);
});

test('every question and brief a generated drill can ask meets the Player-mode copy rules (tests/copy.test.js budgets, reading age)', () => {
  const kid = allSpotTexts('kid');
  assert.ok(kid.filter((e) => e.key.startsWith("question:")).length >= 60, `${kid.length} texts`);
  for (const { key, text } of kid) {
    assert.ok(wordsOf(text).length <= 12, `${key}: "${text}" is ${wordsOf(text).length} words`);
    assert.doesNotMatch(text, SIDE_WORDS, `${key}: "${text}"`);
    assert.doesNotMatch(text, GENDER, `${key}: "${text}"`);
    assert.doesNotMatch(text, JARGON, `${key}: "${text}"`);
    for (const x of sentencesOf(text)) if (wordsOf(x).length >= 6) assert.ok(fkGrade([x]) <= 8, `${key}: "${x}" reads at grade ${fkGrade([x]).toFixed(1)}`);
  }
  assert.ok(fkGrade(kid.map((e) => e.text)) <= 4, `all together read at grade ${fkGrade(kid.map((e) => e.text)).toFixed(1)}`);
  for (const { text } of allSpotTexts('standard')) assert.ok(/[.?]$/.test(text) && !GENDER.test(text) && !SIDE_WORDS.test(text), text);
});

test('the question varies (the Player-mode review: 40 winger drills in a row asked "Their defender has the ball. Where do you go?")', () => {
  const seen = {};
  let n = 0;
  for (let k = 1; k <= 20; k++) {
    const s = generateSpotDrill({ seed: 7919 * k, role: 'LW', principles: ['D1', 'D2'], formations, catalogue });
    if (!s) continue;
    n++;
    seen[s.template] = (seen[s.template] ?? 0) + 1;
    seen[s.questionKid] = (seen[s.questionKid] ?? 0) + 1;
  }
  const templates = Object.keys(seen).filter((k) => SPOT_WORDS.templates[k]);
  const questions = Object.keys(seen).filter((k) => !SPOT_WORDS.templates[k]);
  assert.ok(n >= 18, `${n} drills`);
  assert.ok(templates.length >= 4 && Math.max(...templates.map((k) => seen[k])) <= n / 2, JSON.stringify(seen));
  assert.ok(questions.length >= 5, `${questions.length} different questions`);
  // A set builder can ask for another template: the same drill, another question, when another one fits.
  const a = generateSpotDrill({ seed: 7919, role: 'LW', principles: ['D1', 'D2'], formations, catalogue });
  const b = generateSpotDrill({ seed: 7919, role: 'LW', principles: ['D1', 'D2'], formations, catalogue, avoidTemplates: [a.template] });
  assert.deepEqual(b.timeline, a.timeline);
  assert.notEqual(b.template, a.template);
  assert.notEqual(b.questionKid, a.questionKid);
});

test('the player the question names is on the ball at the freeze and standing, never a loose ball (many seeds and positions)', () => {
  // Before: the ball 3-15 m from "their defender" at the freeze in 10-21 of 40 drills per cell, him still running at 6 m/s.
  const cells = [['LW', ['D1', 'D2']], ['LB', ['D3', 'D4']], ['ST', ['D1', 'D2']], ['RW', ['B1', 'B2', 'B6', 'P10']], ['RCB', ['D5']], ['LCM', ['B3', 'B4']], ['DM', ['R3']], ['RB', ['U4']]];
  let n = 0;
  for (const [role, principles] of cells) {
    for (let k = 1; k <= 6; k++) {
      const s = generateSpotDrill({ seed: 104729 * k, role, principles, formations, catalogue });
      if (!s) continue;
      n++;
      const t = s.timeline.freezeAt, id = carrierAt(s, t);
      const f = frameAt(s, t, { formations }), q = frameAt(s, t - 0.2, { formations }).players.find((p) => p.id === id);
      const p = f.players.find((x) => x.id === id);
      assert.ok(Math.hypot(p.x - f.ball.x, p.y - f.ball.y) <= SPOT_DEFAULTS.carrierGap, `${s.id}: ${id} is ${Math.hypot(p.x - f.ball.x, p.y - f.ball.y).toFixed(1)} m from the ball`);
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) / 0.2 <= SPOT_DEFAULTS.carrierSpeed, `${s.id}: ${id} still running`);
      assert.match(s.questionKid, new RegExp(`${id.startsWith('us') ? '[Yy]our' : '[Tt]heir'} `), `${s.id}: the question names the team on the ball`);
    }
  }
  assert.ok(n >= 40, `${n} drills`);
  // The gate: the same drill with the ball given to a teammate who is 20 m away is caught.
  const s = generateSpotDrill({ seed: 104729, role: 'LW', principles: ['D1', 'D2'], formations, catalogue });
  const t = s.timeline.freezeAt, holder = carrierAt(s, t);
  const far = frameAt(s, t, { formations }).players.filter((p) => p.team === holder.slice(0, holder.indexOf('-')) && p.id !== holder && p.role !== 'GK')
    .sort((a, b) => Math.hypot(b.x - s.timeline.ball[2].x, b.y - s.timeline.ball[2].y) - Math.hypot(a.x - s.timeline.ball[2].x, a.y - s.timeline.ball[2].y))[0];
  const bad = { ...s, timeline: { ...s.timeline, carrier: s.timeline.carrier.map((k) => (k.id === holder ? { ...k, id: far.id } : k)) } };
  const r = checkSpotDrill(bad, { formations, principles: catalogue });
  assert.ok(r.problems.some((x) => /from the ball at the freeze|still running/.test(x)), r.problems.join('; '));
});

test('a principle without a rule, or a rule that never judges the position, cannot be keyed by the engine: null (fast)', () => {
  const none = [['LCB', ['T3']], ['LCB', ['U8']], ['LCB', ['B6', 'P1']], ['LCB', ['U3', 'R1']], ['LCB', ['PA5']], ['LW', ['R3']], ['DM', ['U4']], ['LB', ['P10']], ['CB', ['F8']]];
  for (const [role, p] of none) {
    assert.equal(canGenerateSpot(role, p), false, `${role} ${p}`);
    if (role !== 'CB') assert.equal(generateSpotDrill({ seed: 1, role, principles: p, formations }), null, `${role} ${p}`);
  }
  const ms = cpuTimed(() => { for (const [role, p] of none) if (role !== 'CB') generateSpotDrill({ seed: 1, role, principles: p, formations }); }, { runs: 5 }).median;
  assert.ok(ms < 50 * PERF_SLACK, `${ms.toFixed(1)} ms of CPU`);
  // canGenerateSpot: a role or a family, one principle or a list (any of them), the measured table SPOT_YIELD.
  assert.equal(canGenerateSpot('DM', ['R3', 'U7', 'T2']), true);
  assert.equal(canGenerateSpot('W', 'B1'), true);
  assert.equal(canGenerateSpot('ST', ['B1']), false, 'width is the wingers\'');
  assert.equal(canGenerateSpot('LCB', []), true, 'any idea');
  for (const p of Object.keys(SPOT_PRINCIPLES)) {
    for (const fam of ['CB', 'FB', 'DM', 'CM', 'W', 'ST']) assert.ok(SPOT_YIELD[p]?.[fam] >= 0 && SPOT_YIELD[p][fam] <= 1, `${p} ${fam}`);
  }
  // A cell measured at 0 still gives nothing when tried anyway (spot checks; the zeros were measured on 32 seeds each).
  for (const [role, p] of [['LW', 'R3'], ['RB', 'D3'], ['ST', 'U4']]) {
    assert.equal(generateSpotDrill({ seed: 5, role, principles: [p], formations, params: { fastFail: false, maxAttempts: 10 } }), null, `${role} ${p}`);
  }
});

test('the mirror of a generated drill is a good drill too (the engine is left/right symmetric)', () => {
  for (const [seed, role, principles] of SAMPLE.slice(0, 6)) {
    const m = mirrorScenario(spot(seed, role, principles));
    const r = checkScenario(m, { principles: catalogue, formations });
    assert.deepEqual(r.problems, [], `${m.id}: ${r.problems.join('; ')}`);
  }
});

test('yield: the principles with a rule generate for the positions that rule judges (KID_REDESIGN §6.2)', () => {
  // Reliable (role family, principles) pairs: most seeds give a drill within maxAttempts (SPOT_YIELD, docs/ARCHITECTURE.md §5.15:
  // most cells where the rule judges the position give a drill for 63-100 % of seeds).
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
  let made = 0, tries = 0;
  const c0 = isNode ? process.cpuUsage() : null, t0 = performance.now();
  for (const [role, principles] of RELIABLE) {
    let ok = 0;
    for (const seed of [1000, 2000, 3000]) {
      const d = generateSpotDrill({ seed, role, principles, formations, catalogue });
      tries++;
      if (d) { ok++; made++; assert.ok(principles.includes(d.principles[0])); }
    }
    assert.ok(ok >= 2, `${role} ${principles}: ${ok} of 3 seeds gave a drill`);
  }
  // CPU time in Node (not inflated by other test files running side by side): an average over 72 calls, 5-30 ms each.
  const c = c0 ? process.cpuUsage(c0) : null;
  const per = (c ? (c.user + c.system) / 1000 : performance.now() - t0) / tries;
  assert.ok(per < 250 * PERF_SLACK, `${per.toFixed(0)} ms per drill`);
  assert.ok(made / tries >= 0.9, `${made} of ${tries}`);
  // And what cannot be generated: a rule that never judges that position gives nothing (the screen is the #6's).
  assert.equal(generateSpotDrill({ seed: 1, role: 'LW', principles: ['R3'], formations, params: { maxAttempts: 8 } }), null);
  assert.equal(ROLE_INFO.DM.family, 'DM');
});
