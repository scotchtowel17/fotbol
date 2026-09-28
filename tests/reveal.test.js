// Pure helpers of the feedback panel (js/ui/reveal.js) and of the views built on it:
// Explore (js/ui/modes/explore.js), Learn (js/ui/modes/learn.js) and the home module cards
// (js/ui/modes/home.js). No DOM: everything here runs under node --test and in tests.html.

import { test, assert, loadJSON } from './harness.js';
import {
  hotCold, HOT_COLD_BANDS, gradeColor, GRADE_COLORS, GRADE_INK, pickText, topLine, revealModel, REVEAL_DEFAULTS,
  createLiveAnnouncer,
} from '../js/ui/reveal.js';
import { changeText, dutyInfo, whyTags, randomBall, roleFromParams, EXPLORE_DEFAULTS } from '../js/ui/modes/explore.js';
import {
  normalizeTutorialProgress, offsideLineOf, inTarget, taskSolved, playerAt, sortPrinciples, filterPrinciples,
  groupResources, principleProgress, isAvailable, CATEGORY_ORDER,
} from '../js/ui/modes/learn.js';
import { moduleStatuses, continueModule, moduleHref } from '../js/ui/modes/home.js';
import { GRADE_BANDS } from '../js/engine/score.js';
import { createSkills, update } from '../js/engine/elo.js';
import { RULES_BY_ID } from '../js/engine/rules/index.js';
import { LEARNABLE_ROLES } from '../js/engine/roles.js';
import { dist } from '../js/engine/geometry.js';

const [principleData, tutorial, resources, curriculum] = await Promise.all([
  loadJSON('data/principles.json'),
  loadJSON('data/tutorial.json'),
  loadJSON('data/resources.json'),
  loadJSON('data/curriculum.json'),
]);
const principles = principleData.principles;
const byId = Object.fromEntries(principles.map((p) => [p.id, p]));

// ---------------------------------------------------------------- reveal.js

test('reveal: hotCold follows the grade bands (S on fire, A-B hot, C-D warm, F cold)', () => {
  const minOf = Object.fromEntries(GRADE_BANDS);
  assert.equal(hotCold(100), 'on fire');
  assert.equal(hotCold(minOf.S), 'on fire');
  assert.equal(hotCold(minOf.S - 1), 'hot');
  assert.equal(hotCold(minOf.B), 'hot');
  assert.equal(hotCold(minOf.B - 1), 'warm');
  assert.equal(hotCold(minOf.D), 'warm');
  assert.equal(hotCold(minOf.D - 1), 'cold');
  assert.equal(hotCold(0), 'cold');
  for (const bad of [NaN, undefined, null, 'x', Infinity * 0]) assert.equal(hotCold(bad), 'cold', `hotCold(${bad})`);
  const mins = HOT_COLD_BANDS.map(([, m]) => m);
  assert.deepEqual(mins, [...mins].sort((a, b) => b - a), 'bands listed highest first');
});

test('reveal: gradeColor gives each grade its own colour, readable with the badge ink', () => {
  const grades = ['S', 'A', 'B', 'C', 'D', 'F'];
  const colors = grades.map(gradeColor);
  assert.equal(new Set(colors).size, grades.length, 'distinct colours');
  for (const g of grades) assert.match(gradeColor(g), /^#[0-9a-f]{6}$/i);
  assert.equal(gradeColor('s'), GRADE_COLORS.S, 'case-insensitive');
  assert.equal(gradeColor('?'), gradeColor(undefined), 'unknown grades share a neutral fallback');
  assert.ok(!colors.includes(gradeColor('?')));
  // WCAG contrast of the dark badge ink on every grade colour (AA for normal text: 4.5).
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  for (const g of grades) {
    const ratio = (lum(gradeColor(g)) + 0.05) / (lum(GRADE_INK) + 0.05);
    assert.ok(ratio >= 4.5, `grade ${g}: contrast ${ratio.toFixed(2)}`);
  }
});

test('reveal: the live read-out never announces a grade the screen has already left', () => {
  // A fake clock: timers run when advance() passes their time.
  let now = 0, id = 0;
  const pending = new Map();
  const setTimer = (fn, ms) => { pending.set(++id, { fn, at: now + ms }); return id; };
  const clearTimer = (t) => { pending.delete(t); };
  const advance = (ms) => {
    now += ms;
    for (const [t, p] of [...pending].sort((a, b) => a[1].at - b[1].at)) if (p.at <= now) { pending.delete(t); p.fn(); }
  };
  const said = [];
  const a = createLiveAnnouncer({ delay: 900, say: (text) => said.push(text), setTimer, clearTimer });
  a.update('A', '85 A');
  advance(1100);
  assert.deepEqual(said, ['85 A'], 'a grade that held is read out');
  a.update('B', '75 B');
  advance(200);
  a.update('A', '84 A');
  advance(1100);
  assert.deepEqual(said, ['85 A'], 'A → B → A within the delay says nothing (not a stale "B")');
  a.update('B', '75 B');
  advance(500);
  a.update('B', '72 B');
  advance(450);
  assert.deepEqual(said, ['85 A', '72 B'], 'a grade that holds is read out with its newest score, timed from when it first showed');
  a.update('C', '65 C');
  advance(300);
  a.update('D', '55 D');
  advance(1000);
  assert.deepEqual(said.at(-1), '55 D', 'a quick C then D reads out only D');
  assert.equal(said.length, 3);
  a.reset();
  advance(2000);
  assert.equal(a.announced, null);
  assert.equal(pending.size, 0, 'reset cancels anything pending');
});

test('reveal: pickText and topLine', () => {
  assert.equal(pickText('plain', 'kid'), 'plain');
  assert.equal(pickText({ standard: 'S', kid: 'K' }, 'kid'), 'K');
  assert.equal(pickText({ standard: 'S', kid: 'K' }, 'standard'), 'S');
  assert.equal(pickText({ standard: 'S' }, 'kid'), 'S', 'kid falls back to standard');
  assert.equal(pickText(null), '');
  assert.equal(pickText(undefined, 'kid'), '');

  const fb = { headline: 'H', reasons: [{ text: 'R1' }, { text: 'R2' }], praise: ['P1'] };
  assert.equal(topLine(fb), 'R1');
  assert.equal(topLine({ ...fb, reasons: [] }), 'P1');
  assert.equal(topLine({ headline: 'H', reasons: [], praise: [] }), 'H');
  assert.equal(topLine({ ...fb, grade: 'S' }), 'P1', 'an S grade leads with praise');
  assert.equal(topLine({ ...fb, grade: 'S', praise: [] }), 'R1');
  assert.equal(topLine(null), '');
});

const judgement = {
  result: { score: 64, grade: 'C' },
  feedback: {
    score: 64, grade: 'C', headline: 'Close, but…',
    reasons: [
      { ruleId: 'cover', principleId: 'D3', name: 'Cover at an angle', text: 'Get goal-side of the presser.', severity: 0.6, critical: false },
      { ruleId: 'offside', principleId: 'F4', name: 'Stay onside', text: 'Step back onside.', severity: 1, critical: true },
      { ruleId: 'zone', principleId: 'ZZ', name: 'Mystery', text: 'Third reason.', severity: 0.2, critical: false },
    ],
    praise: ['Nice spacing.', 'Good width.', 'Third praise.'],
    fix: { text: 'Drop 3 m deeper.', dx: -3, dy: 0 },
    cue: { text: 'Where is the presser?', ruleId: 'cover', highlight: null },
  },
};

test('reveal: revealModel shows at most 2 reasons (kid: 1), with principle chips linking to the library', () => {
  const m = revealModel(judgement, { wording: 'standard', principles: byId });
  assert.equal(m.score, 64);
  assert.equal(m.grade, 'C');
  assert.equal(m.color, gradeColor('C'));
  assert.equal(m.heat, 'warm');
  assert.equal(m.headline, 'Close, but…');
  assert.equal(m.reasons.length, 2);
  assert.deepEqual(m.reasons.map((r) => r.principle.id), ['D3', 'F4']);
  assert.equal(m.reasons[0].principle.href, '#/learn/p/D3');
  assert.equal(m.reasons[0].principle.label, byId.D3.short, 'chip label is the principle short name');
  assert.equal(m.reasons[1].critical, true);
  assert.equal(m.fix, 'Drop 3 m deeper.');
  assert.equal(m.praise.length, REVEAL_DEFAULTS.maxPraise.standard);

  const kid = revealModel(judgement, { wording: 'kid', principles: { byId } });
  assert.equal(kid.reasons.length, 1, 'kid wording: one reason');
  assert.equal(kid.praise.length, REVEAL_DEFAULTS.maxPraise.kid);

  const off = revealModel(judgement, { principles: byId, principleLinks: false });
  assert.equal(off.reasons[0].principle.href, null, 'principleLinks: false gives plain tags');

  const unknown = revealModel({ ...judgement, feedback: { ...judgement.feedback, reasons: [judgement.feedback.reasons[2]] } }, { principles: byId });
  assert.equal(unknown.reasons[0].principle.label, 'Mystery', 'an unknown principle falls back to the reason name');

  const empty = revealModel(null);
  assert.equal(empty.score, 0);
  assert.deepEqual(empty.reasons, []);
});

// ---------------------------------------------------------------- explore.js

const DUTIES = ['first-defender', 'second-defender', 'third-defender', 'first-attacker', 'second-attacker', 'third-attacker'];

test('explore: every duty has a job label and a change line in both wordings', () => {
  for (const d of DUTIES) {
    for (const w of ['standard', 'kid']) {
      const info = dutyInfo(d, w);
      assert.ok(info?.job && info?.who && info?.change, `${d} ${w}`);
      assert.doesNotMatch(info.change, /\b(left|right|up|down)\b on the screen|\bscreen\b/i, `${d} ${w}: no screen directions`);
    }
    assert.notEqual(dutyInfo(d, 'kid').change, dutyInfo(d, 'standard').change, `${d}: kid wording differs`);
  }
  assert.equal(dutyInfo('nonsense'), null);
});

test('explore: changeText reports a new duty first, then a new player to pick up', () => {
  const third = { duty: 'third-defender', markId: 'them-ST' };
  assert.equal(changeText(null, third), '', 'first scene: nothing changed');
  assert.equal(changeText(third, { ...third, markName: 'their #9' }), '', 'same duty, same mark');
  assert.match(changeText(third, { duty: 'first-defender', markId: 'them-RW' }), /press/i);
  assert.equal(changeText(third, { duty: 'first-defender' }, 'kid'), dutyInfo('first-defender', 'kid').change);
  assert.match(changeText(third, { duty: 'third-defender', markId: 'them-LW', markName: 'their left winger' }), /their left winger/);
  assert.equal(changeText(third, { duty: 'third-defender', markId: null }), '', 'losing a mark is not news');
});

test('explore: whyTags lists applicable rules heaviest first with a tick, nearly or miss', () => {
  const rules = [
    { id: 'cover', principles: ['D3'], weight: 2, s: 0.95 },
    { id: 'compact', principles: ['U1', 'U2'], weight: 1, s: 0.7 },
    { id: 'goal-side', principles: ['D5'], weight: 3, s: 0.2 },
    { id: 'width', principles: ['B1'], weight: 0, s: 1 },
    { id: 'offside', principles: ['F4'], weight: 0.5, s: 0.95, critical: true },
  ];
  const tags = whyTags(rules);
  assert.deepEqual(tags.map((t) => t.id), ['goal-side', 'cover', 'compact', 'offside'], 'weight order, weight-0 rules dropped');
  assert.deepEqual(tags.map((t) => t.status), ['miss', 'ok', 'near', 'miss'], 'a critical rule is always a miss');
  assert.equal(tags[0].principleId, 'D5');
  assert.equal(tags[0].name, RULES_BY_ID['goal-side'].text.standard.name);
  assert.equal(whyTags(rules, { wording: 'kid' })[0].name, RULES_BY_ID['goal-side'].text.kid.name);
  assert.equal(whyTags(rules, { max: 2 }).length, 2);
  assert.deepEqual(whyTags(undefined), []);
});

test('explore: randomBall moves the ball far enough and stays in the area; roleFromParams', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const A = EXPLORE_DEFAULTS.newBallArea;
  let from = { x: 50, y: 34 };
  for (let i = 0; i < 50; i++) {
    const p = randomBall(from, rng);
    assert.ok(dist(p, from) >= EXPLORE_DEFAULTS.newBallMin - 0.5, `move ${i}: ${dist(p, from).toFixed(1)} m`);
    assert.ok(p.x >= A.x0 - 0.5 && p.x <= A.x1 + 0.5 && p.y >= A.y0 - 0.5 && p.y <= A.y1 + 0.5, `move ${i} in the area`);
    from = p;
  }
  assert.equal(roleFromParams(['lcb']), 'LCB');
  assert.equal(roleFromParams(['ST']), 'ST');
  assert.equal(roleFromParams(['GK']), null, 'the keeper is not learnable in v1');
  assert.equal(roleFromParams(['banana']), null);
  assert.equal(roleFromParams([]), null);
  for (const r of LEARNABLE_ROLES) assert.equal(roleFromParams([r.toLowerCase()]), r);
});

// ---------------------------------------------------------------- learn.js

test('learn: tutorial progress is cleaned against the current steps', () => {
  const steps = tutorial.steps;
  const ids = steps.map((s) => s.id);
  assert.deepEqual(normalizeTutorialProgress(null, steps), { completed: false, completedAt: null, done: [], step: 0 });
  const p = normalizeTutorialProgress({ done: [ids[1], 'gone', ids[1], ids[0]], step: 99, completedAt: 'x' }, steps);
  assert.deepEqual(p.done, [ids[1], ids[0]], 'unknown and duplicate steps dropped');
  assert.equal(p.step, 0, 'out-of-range step resets');
  assert.equal(p.completedAt, null, 'no completion time unless completed');
  const c = normalizeTutorialProgress({ completed: true, completedAt: '2026-09-27T10:00:00Z', done: ids, step: 3 }, steps);
  assert.equal(c.completed, true);
  assert.equal(c.step, 3);
  assert.equal(c.completedAt, '2026-09-27T10:00:00Z');
  assert.equal(normalizeTutorialProgress([1, 2], steps).done.length, 0, 'arrays are not progress');
});

test('learn: every tutorial task is solved at its target and not at its start', () => {
  for (const s of tutorial.steps) {
    const t = s.task;
    switch (t.type) {
      case 'observe':
        assert.equal(taskSolved(t, {}), false);
        assert.equal(taskSolved(t, { acknowledged: true }), true);
        break;
      case 'drag-ball':
        assert.equal(taskSolved(t, { ball: s.setup.ball }), false, `${s.id}: already solved at the start`);
        assert.equal(taskSolved(t, { ball: { x: t.to.x, y: t.to.y } }), true, `${s.id}: target centre`);
        break;
      case 'place':
        assert.equal(taskSolved(t, { spot: s.setup.learnerStart }), false, `${s.id}: already solved at the start`);
        assert.equal(taskSolved(t, { spot: { x: t.target.x + t.target.r * 0.9, y: t.target.y } }), true, `${s.id}: inside the ring`);
        assert.equal(taskSolved(t, { spot: { x: t.target.x + t.target.r * 1.1, y: t.target.y } }), false, `${s.id}: just outside`);
        break;
      case 'tap-player':
        assert.equal(taskSolved(t, { tapped: t.answer }), true);
        assert.equal(taskSolved(t, { tapped: 'us-GK' }), false);
        assert.equal(taskSolved(t, {}), false);
        break;
      default:
        assert.fail(`unknown task type ${t.type}`);
    }
  }
  assert.equal(taskSolved({ type: 'nonsense' }, {}), false);
  assert.equal(inTarget(null, { x: 0, y: 0, r: 1 }), false);
});

test('learn: offsideLineOf is their second-last player; playerAt picks the nearest within reach', () => {
  const frame = {
    players: [
      { id: 'them-GK', team: 'them', x: 100, y: 34 },
      { id: 'them-LCB', team: 'them', x: 72, y: 40 },
      { id: 'them-RCB', team: 'them', x: 74, y: 28 },
      { id: 'us-ST', team: 'us', x: 80, y: 34 },
    ],
  };
  assert.equal(offsideLineOf(frame), 74);
  assert.equal(offsideLineOf(frame, 'us'), null, 'one player cannot make a line');
  assert.equal(offsideLineOf({ players: [] }), null);
  assert.equal(playerAt(frame, { x: 79, y: 34 })?.id, 'us-ST');
  assert.equal(playerAt(frame, { x: 73, y: 30 })?.id, 'them-RCB');
  assert.equal(playerAt(frame, { x: 50, y: 10 }), null, 'nothing within reach');
});

test('learn: the library lists v1 principles first and filters by text, category, level, release and position', () => {
  const sorted = sortPrinciples(principles);
  assert.equal(sorted.length, principles.length);
  const firstLater = sorted.findIndex((p) => !isAvailable(p));
  assert.ok(firstLater > 0 && sorted.slice(firstLater).every((p) => !isAvailable(p)), 'every v1 principle comes first');
  const cats = sorted.slice(0, firstLater).map((p) => CATEGORY_ORDER.indexOf(p.category));
  assert.deepEqual(cats, [...cats].sort((a, b) => a - b), 'grouped by category order');
  assert.ok(principles.every((p) => CATEGORY_ORDER.includes(p.category)), 'every category has a place in the order');

  assert.equal(filterPrinciples(principles).length, principles.length);
  const cover = filterPrinciples(principles, { query: 'cover' });
  assert.equal(cover[0].id, 'D3', 'a name match ranks first');
  assert.ok(cover.every((p) => JSON.stringify(p).toLowerCase().includes('cover')));
  assert.deepEqual(filterPrinciples(principles, { query: 'OFFSIDE hard' }).map((p) => p.id), ['F4'], 'every word must match, case-insensitive');
  assert.ok(filterPrinciples(principles, { query: 'défender' }).length > 0, 'accents are ignored');
  assert.ok(filterPrinciples(principles, { category: 'role' }).every((p) => p.category === 'role'));
  assert.ok(filterPrinciples(principles, { level: '3' }).every((p) => p.level === 3));
  assert.ok(filterPrinciples(principles, { release: 'now' }).every(isAvailable));
  assert.ok(filterPrinciples(principles, { release: 'later' }).every((p) => !isAvailable(p)));
  const cb = filterPrinciples(principles, { family: 'CB' });
  assert.ok(cb.length > 0 && cb.every((p) => p.families.includes('CB')));
  assert.equal(filterPrinciples(principles, { query: 'zzzzqqq' }).length, 0);
});

test('learn: resources are grouped start-here first, in display order, losing nothing', () => {
  const groups = groupResources(resources);
  assert.equal(groups[0].group, 'start-here');
  const order = ['start-here', 'beginner', 'intermediate', 'advanced', 'video'];
  assert.deepEqual(groups.map((g) => g.group), order.filter((g) => groups.some((x) => x.group === g)));
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), resources.length);
  assert.ok(groups.every((g) => g.items.length > 0));
  assert.deepEqual(groupResources(null), []);
  assert.equal(groupResources([{ group: 'odd', title: 'x' }])[0].group, 'other', 'unknown groups are kept at the end');
});

test('learn: principleProgress reads stars from skills and never throws', () => {
  assert.deepEqual(principleProgress(null, 'D3'), { stars: 0, count: 0 });
  assert.deepEqual(principleProgress({ garbage: true }, 'D3'), { stars: 0, count: 0 });
  let skills = createSkills();
  for (let i = 0; i < 4; i++) skills = update(skills, { itemId: `s${i}`, principles: ['D3'], role: 'LCB', score01: 1 });
  const p = principleProgress(skills, 'D3');
  assert.equal(p.count, 4);
  assert.ok(p.stars >= 1, `stars ${p.stars}`);
  assert.equal(principleProgress(skills, 'D4').stars, 0);
});

// ---------------------------------------------------------------- home.js

test('home: module status follows the tutorial and mastery stars; locked modules still link', () => {
  const tut = (done) => normalizeTutorialProgress({ completed: done, done: done ? tutorial.steps.map((s) => s.id) : [] }, tutorial.steps);
  const fresh = moduleStatuses(curriculum, { tutorial: tut(false), tutorialSteps: tutorial.steps.length });
  assert.deepEqual(fresh.map((m) => m.id), curriculum.modules.map((m) => m.id));
  assert.equal(fresh[0].unlocked, true);
  assert.equal(fresh[0].finished, false);
  assert.equal(fresh[1].unlocked, false);
  assert.equal(fresh[1].recommend.id, 'M0');
  assert.equal(continueModule(fresh).id, 'M0');
  assert.equal(moduleHref(fresh[0]), '#/learn');
  assert.equal(moduleHref(fresh[1]), '#/drill/M1');
  assert.equal(fresh[1].maxStars, curriculum.modules[1].principles.length * 3);

  const afterTutorial = moduleStatuses(curriculum, { tutorial: tut(true), tutorialSteps: tutorial.steps.length });
  assert.equal(afterTutorial[0].finished, true);
  assert.equal(afterTutorial[0].stepsDone, tutorial.steps.length);
  assert.equal(afterTutorial[1].unlocked, true);
  assert.equal(afterTutorial[2].unlocked, false);
  assert.equal(continueModule(afterTutorial).id, 'M1');

  // Every M1 principle at moduleUnlockStars or more finishes M1 and opens M2.
  let skills = createSkills();
  for (const id of curriculum.modules[1].principles) {
    for (let i = 0; i < 4; i++) skills = update(skills, { itemId: `${id}-${i}`, principles: [id], score01: 1 });
  }
  const s = moduleStatuses(curriculum, { skills, tutorial: tut(true), tutorialSteps: tutorial.steps.length });
  assert.equal(s[1].finished, true);
  assert.ok(s[1].stars >= curriculum.modules[1].principles.length * curriculum.moduleUnlockStars);
  assert.equal(s[2].unlocked, true);
  assert.equal(continueModule(s).id, 'M2');
  assert.deepEqual(moduleStatuses(null), []);
  assert.equal(continueModule([]), null);
});
