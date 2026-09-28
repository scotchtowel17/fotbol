// js/ui/session.js: the pure session, selection and persistence helpers shared by Drill, Live and Progress.
import { test, assert, loadJSON } from './harness.js';
import {
  SESSION_DEFAULTS, STORE_KEYS, normalizeSkills, loadSkills, saveSkills, loadHistory, appendHistory,
  dayKey, dayDiff, emptyStreak, updateStreak, currentDayStreak, loadStreak, loadLive, recordLiveBest,
  parseDrillRoute, playAs, candidatesFor, pickScenario, moduleProgress, autoModule, weakestPrinciple,
  inRegion, misconceptionAt, wordingOf, longestRun, summarizeSession, summarizeLive, levelFor, roleAbilities,
  learningCurve, parseProgressFile, exportFileName, orientationFor, IMPORT_KEYS, RESET_KEYS, liveHash, drillSessionKey,
  resumableSession,
} from '../js/ui/session.js';
import { createStore } from '../js/store.js';
import { createSkills, update, mastery } from '../js/engine/elo.js';
import { mirrorScenario } from '../js/engine/scenario.js';

const curriculum = await loadJSON('data/curriculum.json');
const example = await loadJSON('data/scenarios/_example.json');

function memStore() {
  const m = new Map();
  const backend = {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
  return createStore(() => backend);
}

const INDEX = [
  { id: 'm1-cover-lcb', module: 'M1', principles: ['D3', 'R1'], role: 'LCB', difficulty: 0, title: 'Cover' },
  { id: 'm1-press-rb', module: 'M1', principles: ['D1'], role: 'RB', difficulty: -1, title: 'Press' },
  { id: 'm1-balance-lb', module: 'M1', principles: ['D4'], role: 'LB', difficulty: 0.5, title: 'Balance' },
  { id: 'm1-screen-dm', module: 'M1', principles: ['R3', 'D5'], role: 'DM', title: 'Screen' },
  { id: 'm2-width-lw', module: 'M2', principles: ['B1'], role: 'LW', title: 'Width' },
  { id: 'm2-support-rcm', module: 'M2', principles: ['B4', 'B3'], role: 'RCM', title: 'Support' },
  { id: 'm3-line-rcb', module: 'M3', principles: ['U4'], role: 'RCB', title: 'Line' },
  { bogus: true },
];

test('skills: load a fresh learner from an empty or damaged store, round-trip through the store', () => {
  const store = memStore();
  assert.deepEqual(loadSkills(store), createSkills());
  store.set(STORE_KEYS.skills, 'garbage');
  assert.deepEqual(loadSkills(store), createSkills());
  store.set(STORE_KEYS.skills, { theta: { global: 0.4 }, counts: { global: 3 } });
  const partial = loadSkills(store);
  assert.equal(partial.theta.global, 0.4);
  assert.deepEqual(partial.theta.byPrinciple, {});
  assert.deepEqual(partial.recent, []);
  const s = update(createSkills(), { itemId: 'a', principles: ['D3'], role: 'LCB', score01: 0.9 });
  assert.equal(saveSkills(store, s), true);
  assert.deepEqual(loadSkills(store), s);
  assert.deepEqual(normalizeSkills(null), createSkills());
});

test('history: appended newest last and capped at 500', () => {
  const store = memStore();
  assert.deepEqual(loadHistory(store), []);
  for (let i = 0; i < SESSION_DEFAULTS.historyMax + 20; i++) appendHistory(store, { t: i, mode: 'drill', score: i % 100 });
  const h = loadHistory(store);
  assert.equal(h.length, SESSION_DEFAULTS.historyMax);
  assert.equal(h[0].t, 20, 'the oldest are dropped');
  assert.equal(h[h.length - 1].t, SESSION_DEFAULTS.historyMax + 19);
  store.set(STORE_KEYS.history, [{ score: 5 }, null, 'x', { score: 'no' }]);
  assert.deepEqual(loadHistory(store), [{ score: 5 }], 'bad entries are dropped');
});

test('streaks: days in a row, a missed day resets, reps at grade B or better', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dayDiff('2026-02-28', '2026-03-01'), 1);
  assert.equal(dayDiff('2026-01-01', '2026-01-01'), 0);
  let s = emptyStreak();
  s = updateStreak(s, { day: '2026-03-01', score: 80 });
  assert.deepEqual(s, { day: { current: 1, best: 1, last: '2026-03-01' }, reps: { current: 1, best: 1 } });
  s = updateStreak(s, { day: '2026-03-01', score: 72 });
  assert.equal(s.day.current, 1, 'same day');
  assert.equal(s.reps.current, 2);
  s = updateStreak(s, { day: '2026-03-02', score: 40 });
  assert.equal(s.day.current, 2, 'next day');
  assert.equal(s.reps.current, 0, 'a miss ends the rep streak');
  assert.equal(s.reps.best, 2);
  s = updateStreak(s, { day: '2026-03-02', score: 95, rep: false });
  assert.equal(s.reps.current, 0, 'a live run does not touch the rep streak');
  assert.equal(currentDayStreak(s, '2026-03-03'), 2, 'still alive the next day');
  assert.equal(currentDayStreak(s, '2026-03-04'), 0, 'gone after a missed day');
  s = updateStreak(s, { day: '2026-03-05', score: 90 });
  assert.deepEqual(s.day, { current: 1, best: 2, last: '2026-03-05' });
  assert.deepEqual(updateStreak(s, { day: '2026-03-04', score: 90 }).day.last, '2026-03-05', 'a clock that went back keeps the last day');
  const store = memStore();
  store.set(STORE_KEYS.streak, { day: { current: 'x' } });
  assert.deepEqual(loadStreak(store), emptyStreak());
});

test('live bests: per role, assisted runs never count', () => {
  const store = memStore();
  let live = loadLive(store);
  assert.deepEqual(live, { best: {} });
  let r = recordLiveBest(live, { role: 'LB', score: 71, grade: 'B', seed: 'abc', at: 1 });
  assert.equal(r.isBest, true);
  r = recordLiveBest(r.live, { role: 'LB', score: 65, grade: 'C', seed: 'd', at: 2 });
  assert.equal(r.isBest, false);
  assert.equal(r.live.best.LB.score, 71);
  r = recordLiveBest(r.live, { role: 'LB', score: 99, grade: 'S', seed: 'e', at: 3, assisted: true });
  assert.equal(r.isBest, false);
  r = recordLiveBest(r.live, { role: 'ST', score: 50, grade: 'D', seed: 4, at: 4 });
  assert.deepEqual(Object.keys(r.live.best).sort(), ['LB', 'ST']);
  assert.equal(r.live.best.ST.seed, '4');
});

test('drill routes', () => {
  assert.deepEqual(parseDrillRoute([]), { kind: 'auto' });
  assert.deepEqual(parseDrillRoute(['m2']), { kind: 'module', id: 'M2' });
  assert.deepEqual(parseDrillRoute(['p', 'd3']), { kind: 'principle', id: 'D3' });
  assert.deepEqual(parseDrillRoute(['s', 'm1-cover-lcb']), { kind: 'scenario', id: 'm1-cover-lcb' });
  assert.deepEqual(parseDrillRoute(['p']), { kind: 'auto' }, 'a half link still starts a drill');
  assert.deepEqual(parseDrillRoute(['nonsense', 'x']), { kind: 'auto' });
});

test('playAs: same role as authored, the mirror across the pitch, nothing for another family', () => {
  assert.deepEqual(playAs('LCB', 'LCB'), { mirror: false, role: 'LCB' });
  assert.deepEqual(playAs('RB', 'LB'), { mirror: true, role: 'LB' });
  assert.deepEqual(playAs('LW', 'RW'), { mirror: true, role: 'RW' });
  assert.deepEqual(playAs('RCM', 'LCM'), { mirror: true, role: 'LCM' });
  assert.deepEqual(playAs('DM', 'DM'), { mirror: false, role: 'DM' });
  assert.equal(playAs('DM', 'LCM'), null);
  assert.equal(playAs('LB', 'LCB'), null);
  assert.equal(playAs('nope', 'LB'), null);
  // A mirrored scenario really is the chosen role.
  assert.equal(mirrorScenario({ ...example, learner: { role: 'RCB' } }).learner.role, 'LCB');
});

test('candidatesFor: family match (mirrored across), module, principle and scenario filters', () => {
  const lb = candidatesFor({ index: INDEX, role: 'LB' });
  assert.deepEqual(lb.map((c) => [c.id, c.mirror, c.role]), [['m1-press-rb-m', true, 'LB'], ['m1-balance-lb', false, 'LB']]);
  assert.equal(lb[0].baseId, 'm1-press-rb');
  assert.equal(lb[0].difficulty, -1);
  const rcb = candidatesFor({ index: INDEX, role: 'RCB' });
  assert.deepEqual(rcb.map((c) => c.id), ['m1-cover-lcb-m', 'm3-line-rcb']);
  assert.deepEqual(candidatesFor({ index: INDEX, role: 'RCB', module: 'M3' }).map((c) => c.id), ['m3-line-rcb']);
  assert.deepEqual(candidatesFor({ index: INDEX, role: 'LCM', principle: 'B4' }).map((c) => c.id), ['m2-support-rcm-m']);
  assert.deepEqual(candidatesFor({ index: INDEX, role: 'LCB', scenarioId: 'm1-cover-lcb-m' }).map((c) => c.id), ['m1-cover-lcb']);
  assert.deepEqual(candidatesFor({ index: INDEX, role: 'ST' }), []);
  assert.equal(candidatesFor({ index: INDEX, role: 'ST', anyRole: true }).length, 7, 'the fallback: every scenario in its own role');
  assert.deepEqual(candidatesFor({ index: INDEX, role: 'ST', anyRole: true, module: 'M2' }).map((c) => c.role), ['LW', 'RCM']);
});

test('pickScenario: weakest principle first, not repeated within a session while others are left, deterministic', () => {
  const cands = candidatesFor({ index: INDEX, role: 'ST', anyRole: true, module: 'M1' });
  let skills = createSkills();
  // Items outside this pool, so elo's "avoid the last few seen" does not hide any candidate.
  skills = update(skills, { itemId: 'elsewhere-1', principles: ['D3'], role: 'LCB', score01: 1 });
  skills = update(skills, { itemId: 'elsewhere-2', principles: ['D1'], role: 'RB', score01: 0 });
  const first = pickScenario(skills, cands);
  assert.equal(first.baseId, 'm1-press-rb', 'D1 went badly: practise it');
  assert.equal(pickScenario(skills, cands), first, 'deterministic');
  const next = pickScenario(skills, cands, { exclude: ['m1-press-rb'] });
  assert.notEqual(next.baseId, 'm1-press-rb');
  const all = cands.map((c) => c.baseId);
  assert.ok(pickScenario(skills, cands, { exclude: all }), 'repeats rather than nothing once every one has been played');
  assert.equal(pickScenario(skills, []), null);
});

test('moduleProgress and autoModule: first unfinished module with drills for the role', () => {
  const mods = moduleProgress({ curriculum, index: INDEX, skills: createSkills(), role: 'LB' });
  assert.deepEqual(mods.map((m) => m.id), ['M1', 'M2', 'M3']);
  assert.equal(mods[0].playable, 2);
  assert.equal(mods[0].finished, false);
  assert.ok(mods[0].principles.find((p) => p.id === 'D3').hasDrills);
  assert.ok(!mods[0].principles.find((p) => p.id === 'T2').hasDrills);
  assert.equal(mods[0].maxStars, mods[0].principles.length * 3);
  assert.deepEqual(autoModule({ curriculum, index: INDEX, skills: createSkills(), role: 'LB' }), { id: 'M1', anyRole: false });
  assert.deepEqual(autoModule({ curriculum, index: INDEX, skills: createSkills(), role: 'LW' }), { id: 'M2', anyRole: false });
  assert.deepEqual(autoModule({ curriculum, index: INDEX, skills: createSkills(), role: 'ST' }), { id: 'M1', anyRole: true }, 'nothing for a #9: the first module, any role');
  // Finish M1 for a left-back: every M1 principle with a drill at 1 star or more.
  let skills = createSkills();
  for (let i = 0; i < 12; i++) {
    for (const [id, p] of [['m1-cover-lcb', 'D3'], ['m1-press-rb', 'D1'], ['m1-balance-lb', 'D4'], ['m1-screen-dm', 'R3'], ['m1-screen-dm', 'D5']]) {
      skills = update(skills, { itemId: id, principles: [p], role: 'LB', score01: 1 });
    }
  }
  const done = moduleProgress({ curriculum, index: INDEX, skills, role: 'LB' });
  assert.equal(done[0].finished, true);
  assert.equal(autoModule({ curriculum, index: INDEX, skills, role: 'LB' }).id, 'M1', 'nothing unfinished for a left-back: back to the first module with drills');
  assert.equal(autoModule({ curriculum, index: INDEX, skills, role: 'LW' }).id, 'M2');
  assert.deepEqual(autoModule({ curriculum: null, index: [], skills, role: 'LB' }), { id: null, anyRole: false });
});

test('weakestPrinciple', () => {
  let s = createSkills();
  assert.equal(weakestPrinciple(s, ['D3', 'D4']), 'D3', 'ties: list order');
  s = update(s, { itemId: 'a', principles: ['D3'], score01: 1 });
  assert.equal(weakestPrinciple(s, ['D3', 'D4']), 'D4');
  assert.equal(weakestPrinciple(s, []), null);
});

test('misconception regions: circle, rect, polygon', () => {
  assert.ok(inRegion({ x: 32, y: 38.5 }, { type: 'circle', x: 32, y: 38.5, r: 2 }));
  assert.ok(!inRegion({ x: 35, y: 38.5 }, { type: 'circle', x: 32, y: 38.5, r: 2 }));
  assert.ok(inRegion({ x: 30, y: 33 }, { type: 'rect', x0: 29.5, y0: 31, x1: 33, y1: 35.5 }));
  const tri = { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] };
  assert.ok(inRegion({ x: 2, y: 2 }, tri));
  assert.ok(!inRegion({ x: 8, y: 8 }, tri));
  assert.ok(!inRegion({ x: 1, y: 1 }, null));
  assert.equal(misconceptionAt(example, { x: 32, y: 38.5 }).id, 'ball-watching');
  assert.equal(misconceptionAt(example, { x: 27, y: 36 }), null);
  const m = mirrorScenario(example);
  assert.equal(misconceptionAt(m, { x: 32, y: 68 - 38.5 }).id, 'ball-watching', 'regions mirror with the scenario');
});

test('wordingOf: strings, {standard, kid} pairs, and a kid alternative', () => {
  assert.equal(wordingOf('Hi', 'kid'), 'Hi');
  assert.equal(wordingOf({ standard: 'A', kid: 'B' }, 'kid'), 'B');
  assert.equal(wordingOf({ standard: 'A' }, 'kid'), 'A');
  assert.equal(wordingOf('Long words', 'kid', 'Short'), 'Short');
  assert.equal(wordingOf(undefined), '');
});

test('summarizeSession: average, grade, best run, stars before and after, weakest principle', () => {
  const before = createSkills();
  let after = before;
  const reps = [
    { id: 'a', baseId: 'a', title: 'A', score: 92, grade: 'S', principles: ['D3'] },
    { id: 'b', baseId: 'b', title: 'B', score: 75, grade: 'B', principles: ['D3', 'D4'] },
    { id: 'c', baseId: 'c', title: 'C', score: 40, grade: 'F', principles: ['D4'] },
    { id: 'a', baseId: 'a', title: 'A', score: 95, grade: 'S', principles: ['D3'] },
  ];
  for (const r of reps) after = update(after, { itemId: r.baseId, principles: r.principles, score01: r.score / 100 });
  const s = summarizeSession({ reps, before, after });
  assert.equal(s.count, 4);
  assert.equal(s.average, 76);
  assert.equal(s.grade, 'B');
  assert.equal(s.best, 95);
  assert.equal(s.run, 2);
  assert.deepEqual(s.principles.map((p) => p.id), ['D3', 'D4']);
  const d3 = s.principles.find((p) => p.id === 'D3');
  assert.deepEqual(d3.stars, [0, mastery(after, 'D3')]);
  assert.ok(d3.delta > 0);
  assert.equal(s.weakest, 'D4');
  assert.deepEqual(s.improved, s.principles.filter((p) => p.stars[1] > p.stars[0]).map((p) => p.id));
  assert.equal(longestRun([70, 80, 10, 70, 70, 70]), 3);
  assert.equal(summarizeSession({ reps: [], before, after: before }).count, 0);
});

test('summarizeLive: time-averaged score over scored samples, worst moments spread out, recovery time', () => {
  const samples = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 10;
    let score = 85;
    if (t >= 2 && t < 3) score = 30; // a bad patch after the pass at 2 s
    if (t >= 6 && t < 6.5) score = 50;
    samples.push({ t, score, grace: t >= 2 && t < 2.7 });
  }
  const events = [{ t: 2, event: 'pass' }, { t: 5, event: 'pass' }];
  const r = summarizeLive(samples, events);
  assert.equal(r.total, 101);
  assert.equal(r.scored, 94);
  const expected = Math.round(samples.filter((s) => !s.grace).reduce((a, s) => a + s.score, 0) / 94);
  assert.equal(r.average, expected);
  assert.equal(r.worst.length, 3);
  assert.ok(r.worst.every((w, i) => i === 0 || w.t - r.worst[i - 1].t >= SESSION_DEFAULTS.liveWorstGap), 'spread out');
  assert.ok(r.worst.some((w) => w.score === 30) && r.worst.some((w) => w.score === 50));
  assert.equal(r.recovery, 1, 'one second to recover after the first pass; the second never pulled you out of position');
  assert.ok(r.onSpot > 0.8);
  assert.deepEqual(summarizeLive([], []).average, 0);
  const allGood = summarizeLive(samples.map((s) => ({ ...s, score: 95 })), events);
  assert.deepEqual(allGood.worst, [], 'an S moment is never one of your toughest');
});

test('levelFor, roleAbilities and learningCurve', () => {
  assert.equal(levelFor(createSkills()).level, 0);
  let s = createSkills();
  for (let i = 0; i < 15; i++) s = update(s, { itemId: `i${i}`, principles: ['D3'], role: 'LB', score01: 1 });
  const lv = levelFor(s);
  assert.ok(lv.level >= 3, `a strong start levels up (${lv.level} ${lv.name})`);
  assert.ok(lv.level <= 1 + Math.floor(15 / SESSION_DEFAULTS.levelEvery), 'but a level also needs practice behind it');
  assert.ok(lv.next >= 0 && lv.next <= 1);
  let lucky = createSkills();
  for (let i = 0; i < 3; i++) lucky = update(lucky, { itemId: `l${i}`, principles: ['D3'], score01: 1 });
  assert.equal(levelFor(lucky).level, 1, 'three lucky reps are still level 1');
  assert.equal(typeof levelFor(s, 'kid').name, 'string');
  s = update(s, { itemId: 'x', principles: ['D1'], role: 'ST', score01: 0.2 });
  assert.deepEqual(roleAbilities(s).map((r) => r.role), ['LB', 'ST']);
  const hist = [...Array.from({ length: 40 }, (_, i) => ({ mode: 'drill', score: i })), { mode: 'live', score: 99 }];
  const c = learningCurve(hist);
  assert.equal(c.scores.length, SESSION_DEFAULTS.curveLength);
  assert.equal(c.scores[c.scores.length - 1], 39);
  assert.equal(c.rolling.length, c.scores.length);
  assert.equal(c.rolling[c.rolling.length - 1], 37);
});

test('parseProgressFile: accepts an export, rejects anything else with a reason', () => {
  const store = memStore();
  store.set('skills', update(createSkills(), { itemId: 'a', principles: ['D3'], score01: 1 }));
  store.set('history', [{ mode: 'drill', score: 70 }]);
  store.set('settings', { wording: 'kid' });
  const ok = parseProgressFile(JSON.stringify(store.exportAll()));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.keys.sort(), ['fotbol:history', 'fotbol:skills'], 'settings are not imported with the progress');
  assert.deepEqual(ok.settings, { wording: 'kid' }, 'the file\'s settings come back separately (opt in)');
  assert.deepEqual(ok.summary, { reps: 1, principles: 1 });
  const target = memStore();
  target.importAll(ok.data);
  assert.deepEqual(target.get('history'), [{ mode: 'drill', score: 70 }]);
  assert.equal(parseProgressFile(JSON.stringify({ app: 'fotbol', data: store.exportAll() })).ok, true, 'wrapped form');
  for (const bad of ['{nope', '[]', '{"other": 1}', JSON.stringify({ 'fotbol:skills': 'x' }), JSON.stringify({ 'fotbol:history': {} })]) {
    const r = parseProgressFile(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(exportFileName('2026-09-27'), 'fotbol-progress-2026-09-27.json');
});

test('orientationFor: an upright phone gets the vertical pitch, everything else lets the board decide', () => {
  assert.equal(orientationFor(375, 812), 'vertical');
  assert.equal(orientationFor(812, 375), 'auto');
  assert.equal(orientationFor(1280, 800), 'auto');
  assert.equal(orientationFor(700, 1000), 'auto', 'a tablet decides by its box');
  assert.equal(orientationFor(0, 0), 'auto');
});

test('session: a rep pool never repeats a scenario while other ones are fresh (own role first, then other roles)', async () => {
  const { repPool, extraCandidates } = await import('../js/ui/session.js');
  const own = candidatesFor({ index: INDEX, role: 'LCB', module: 'M1' });
  const any = candidatesFor({ index: INDEX, role: 'LCB', module: 'M1', anyRole: true });
  const extra = extraCandidates(own, any);
  assert.ok(extra.every((c) => c.extra && !own.some((o) => o.baseId === c.baseId)), 'extras are other scenarios, flagged');
  assert.deepEqual(repPool(own, extra, []).map((c) => c.baseId), own.map((c) => c.baseId), 'own role first');
  const allOwn = own.map((c) => c.baseId);
  if (extra.length) assert.deepEqual(repPool(own, extra, allOwn).map((c) => c.baseId), extra.map((c) => c.baseId), 'then the others');
  const everything = [...allOwn, ...extra.map((c) => c.baseId)];
  assert.deepEqual(repPool(own, extra, everything), own, 'only then repeats of your own');
  assert.deepEqual(repPool([], extra, []), extra);
});

test('import: a progress file never overwrites this browser\'s settings or scenario draft', () => {
  // Browser A exports its progress, settings and an old author draft...
  const a = memStore();
  a.set('history', [{ mode: 'drill', score: 70 }]);
  a.set('tutorial', { completed: true, done: [], step: 0 });
  a.set('author:draft', { id: 'old-draft-from-A' });
  a.set('settings', { theme: 'dark', role: 'ST' });
  // ...browser B has unsaved scenario work and its own settings.
  const b = memStore();
  b.set('author:draft', { id: 'my-unfinished-scenario-on-B' });
  b.set('settings', { theme: 'light', role: 'LB' });
  b.set('explore', { found: 3 });
  const parsed = parseProgressFile(JSON.stringify({ app: 'fotbol', data: a.exportAll() }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.keys.sort(), ['fotbol:history', 'fotbol:tutorial']);
  assert.ok(!('fotbol:author:draft' in parsed.data) && !('fotbol:settings' in parsed.data));
  assert.deepEqual(parsed.settings, { theme: 'dark', role: 'ST' });
  // What progress.js does on "Import": clear the progress keys, then write the file's.
  for (const k of IMPORT_KEYS) b.remove(k);
  b.importAll(parsed.data);
  assert.deepEqual(b.get('author:draft'), { id: 'my-unfinished-scenario-on-B' }, 'the draft survives');
  assert.deepEqual(b.get('settings'), { theme: 'light', role: 'LB' }, 'the settings survive');
  assert.deepEqual(b.get('history'), [{ mode: 'drill', score: 70 }]);
  assert.equal(b.get('explore'), null, 'the progress is replaced as a whole');
  assert.deepEqual([...IMPORT_KEYS].sort(), [...RESET_KEYS].sort(), 'import replaces exactly what a reset clears');
  const onlySettings = parseProgressFile(JSON.stringify({ 'fotbol:settings': { theme: 'dark' }, 'fotbol:author:draft': {} }));
  assert.equal(onlySettings.ok, false, 'a file with no progress in it is refused');
  const badLive = parseProgressFile(JSON.stringify({ 'fotbol:live': 'junk' }));
  assert.equal(badLive.ok, false);
});

test('import: damaged live bests and skills never show as undefined or NaN, and a junk best can be beaten', () => {
  const store = memStore();
  const parsed = parseProgressFile(JSON.stringify({ 'fotbol:live': { best: { LCB: 'junk', LB: { score: 'x' }, ST: { score: 80, grade: 'A', seed: 'q', at: 1, length: 60 } } } }));
  assert.equal(parsed.ok, true);
  store.importAll(parsed.data);
  const live = loadLive(store);
  assert.deepEqual(Object.keys(live.best), ['ST'], 'unreadable bests are dropped');
  assert.equal(live.best.ST.length, 60);
  for (const role of ['LCB', 'LB']) {
    const r = recordLiveBest(live, { role, score: 95, grade: 'S', seed: 'x', at: 2, length: 45 });
    assert.equal(r.isBest, true, `${role}: a real score beats a junk best`);
    assert.equal(r.live.best[role].length, 45, 'the sequence length is kept with the best');
  }
  assert.equal(recordLiveBest({ best: { LB: 'junk' } }, { role: 'LB', score: 40, grade: 'F', seed: 's', at: 1 }).isBest, true);
  // Skills: strings where numbers belong read as never practised.
  const skills = normalizeSkills({ theta: { global: 'x', byRole: { LCB: 'abc', LB: 0.4 }, byPrinciple: { D3: null } }, counts: { global: '7', byRole: { LCB: '5', LB: 3 } }, items: { a: { d: 'x', n: 1 }, b: { d: 0.2, n: 2 } } });
  assert.equal(skills.theta.global, 0);
  assert.deepEqual(skills.theta.byRole, { LB: 0.4 });
  assert.deepEqual(skills.theta.byPrinciple, {});
  assert.equal(skills.counts.global, 0);
  assert.deepEqual(skills.counts.byRole, { LB: 3 });
  assert.deepEqual(Object.keys(skills.items), ['b']);
  const roles = roleAbilities(skills);
  assert.deepEqual(roles.map((r) => r.role), ['LB']);
  assert.ok(roles.every((r) => Number.isFinite(r.p) && Number.isFinite(r.attempts)), 'no NaN on the Progress page');
});

test('import: rewards travel with the progress, sanitised on the way in; a reset clears them', async () => {
  const { createRewards, applyEvent, LEVEL_XP } = await import('../js/rewards.js');
  assert.ok(RESET_KEYS.includes('rewards') && IMPORT_KEYS.includes('rewards'), 'rewards are progress');
  let rewards = createRewards();
  rewards = applyEvent(rewards, { type: 'rep', scenarioId: 'm1-01-d1-lcm', role: 'LCM', grade: 'S', score: 95 }, { day: '2026-09-27' }).state;
  const a = memStore();
  a.set('rewards', { ...rewards, kit: { palette: 'gold', number: 7, nickname: '<b>Mia</b>' } });
  a.set('history', [{ mode: 'drill', score: 95 }]);
  const parsed = parseProgressFile(JSON.stringify({ app: 'fotbol', data: a.exportAll() }));
  assert.equal(parsed.ok, true);
  assert.ok(parsed.keys.includes('fotbol:rewards'));
  const r = parsed.data['fotbol:rewards'];
  assert.equal(r.xp, rewards.xp);
  assert.equal(r.kit.palette, 'classic', 'a kit this level has not unlocked is refused');
  assert.equal(r.kit.number, 7);
  assert.equal(r.kit.nickname, 'bMiab', 'the nickname is cleaned');
  assert.ok(r.badges['first-s']);
  const b = memStore();
  for (const k of IMPORT_KEYS) b.remove(k);
  b.importAll(parsed.data);
  assert.equal(b.get('rewards').xp, rewards.xp);
  // A damaged rewards entry reads as a fresh start; it never makes the file fail.
  const junk = parseProgressFile(JSON.stringify({ 'fotbol:rewards': 'junk', 'fotbol:history': [] }));
  assert.equal(junk.ok, true);
  assert.deepEqual(junk.data['fotbol:rewards'], createRewards());
  const unlocked = parseProgressFile(JSON.stringify({ 'fotbol:rewards': { xp: LEVEL_XP[9], kit: { palette: 'gold' } } }));
  assert.equal(unlocked.data['fotbol:rewards'].kit.palette, 'gold', 'an unlocked kit is kept');
  // Reset: what progress.js does.
  for (const k of RESET_KEYS) b.remove(k);
  assert.equal(b.get('rewards'), null);
});

test('drill resume: a rep keeps its kid title through a saved session and the summary', () => {
  const key = drillSessionKey({ kind: 'module', module: 'M1' }, 'LCB');
  const reps = [{ id: 's1', baseId: 's1', title: 'Cover your partner', titleKid: 'Help your friend', score: 80, grade: 'A', principles: ['D3'] }];
  const r = resumableSession({ key, reps, played: ['s1'], before: createSkills(), repsTotal: 6, at: 1000 }, { key, now: 2000 });
  assert.equal(r.reps[0].titleKid, 'Help your friend');
  assert.equal(summarizeSession({ reps: r.reps, before: createSkills(), after: createSkills() }).reps[0].titleKid, 'Help your friend');
  const plain = resumableSession({ key, reps: [{ ...reps[0], titleKid: 42 }], played: ['s1'], before: createSkills(), repsTotal: 6, at: 1000 }, { key, now: 2000 });
  assert.equal('titleKid' in plain.reps[0], false, 'a bad kid title is dropped');
});

test('live: the address of a sequence carries its length', () => {
  assert.equal(liveHash('abc', 60), '#/live/abc/60');
  assert.equal(liveHash('abc', 45), '#/live/abc/45');
  assert.equal(liveHash('abc'), '#/live/abc', 'an old best without a length links to the seed alone');
  assert.equal(liveHash('k0q', 'x'), '#/live/k0q');
});

test('drill resume: an unfinished session of the same practice can be carried on, for a while', () => {
  const plan = { kind: 'module', module: 'M3' };
  const key = drillSessionKey(plan, 'LCB');
  assert.notEqual(key, drillSessionKey(plan, 'RB'), 'another position is another session');
  assert.notEqual(key, drillSessionKey({ kind: 'module', module: 'M1' }, 'LCB'));
  assert.notEqual(drillSessionKey({ kind: 'principle', principle: 'D3' }, 'LCB'), drillSessionKey({ kind: 'principle', principle: 'D4' }, 'LCB'));
  const rep = (i, score = 80) => ({ id: `s${i}`, baseId: `s${i}`, title: `S${i}`, score, grade: 'A', principles: ['U3'] });
  const saved = { key, reps: [rep(1), rep(2)], played: ['s1', 's2', 's3'], before: createSkills(), repsTotal: 6, at: 1000 };
  const now = 1000 + 60 * 1000;
  const r = resumableSession(saved, { key, now });
  assert.ok(r, 'carried on');
  assert.equal(r.reps.length, 2);
  assert.deepEqual(r.played, ['s1', 's2', 's3']);
  assert.equal(r.repsTotal, 6);
  assert.equal(resumableSession(saved, { key: drillSessionKey(plan, 'RB'), now }), null, 'not in another position');
  assert.equal(resumableSession(saved, { key, now: 1000 + SESSION_DEFAULTS.resumeMaxMs + 1 }), null, 'not once it is stale');
  assert.equal(resumableSession({ ...saved, reps: [] }, { key, now }), null, 'nothing played: start fresh');
  assert.equal(resumableSession({ ...saved, reps: [1, 2, 3, 4, 5, 6].map((i) => rep(i)) }, { key, now }), null, 'a finished session is not resumed');
  assert.equal(resumableSession({ ...saved, reps: [rep(1), { baseId: 's2', score: 'x', grade: 'A' }] }, { key, now }).reps.length, 1, 'damaged reps are dropped');
  assert.equal(resumableSession(null, { key, now }), null);
  assert.equal(resumableSession('junk', { key, now }), null);
});
