// The Road (js/ui/player/road.js, data/road.json): docs/KID_REDESIGN.md §3 and §8.1.
import { test, assert, loadJSON } from './harness.js';
import * as R from '../js/ui/player/road.js';

const rawRoad = await loadJSON('data/road.json');
const road = R.normalizeRoad(rawRoad);
const principlesFile = await loadJSON('data/principles.json');
const principleIds = new Set((principlesFile.principles ?? principlesFile).map((p) => p.id));
const index = (await loadJSON('data/scenarios/index.json')).scenarios;
const fileOf = Object.fromEntries(index.map((e) => [e.id, e.file ?? `${e.id}.json`]));
const scenarioCache = new Map();
/** The scenario files from disk (Node) or the server (tests.html), cached. */
const load = (id) => {
  if (!scenarioCache.has(id)) scenarioCache.set(id, loadJSON(`data/scenarios/${fileOf[id] ?? `${id}.json`}`));
  return scenarioCache.get(id);
};

/** An app with an in-memory store (and the road, as main.js sets app.data.road). */
function fakeApp(initial = {}, withRoad = road) {
  const mem = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    mem,
    data: { road: withRoad },
    store: {
      get: (k, fallback) => (mem.has(k) ? JSON.parse(mem.get(k)) : fallback),
      set: (k, v) => { mem.set(k, JSON.stringify(v)); return true; },
    },
  };
}
const withStars = (group, stars = {}, plays = {}) => ({
  ...R.pickGroup(null, group, road),
  road: Object.fromEntries([...new Set([...Object.keys(stars), ...Object.keys(plays)])].map((id) => [id, { stars: stars[id] ?? 0, plays: plays[id] ?? (stars[id] ? 1 : 0) }])),
});
/** A stand-in for js/engine/spotdrill.js generateSpotDrill: a minimal scenario per seed, recording its calls. */
function spotStub(calls = []) {
  return (opts) => {
    calls.push(opts);
    return { id: `gen-${opts.seed}`, title: 'Generated', timeline: { ball: [] }, learner: { role: opts.role }, principles: [...opts.principles], source: { kind: 'generated' } };
  };
}
function passStub(calls = []) {
  return (opts) => {
    calls.push(opts);
    return { id: `pass-${opts.seed}`, kind: 'pass', learner: { role: opts.role }, principles: [...opts.principles] };
  };
}
const ids = (reps) => reps.map((r) => r.scenario?.id ?? r.drill?.id);

// ---------------------------------------------------------------- the data file

const SPEC = {
  defend: ['Defend together', [['close-down', 'spot', ['D1', 'D2']], ['back-up', 'spot', ['D3', 'D4']], ['goal-side', 'spot', ['D5', 'T3', 'U8']], ['defend-match', 'mix', []]]],
  help: ['Help the ball', [['get-open', 'spot', ['B3', 'B4']], ['stay-wide', 'spot', ['B1', 'B6', 'B2']], ['between-lines', 'spot', ['P2', 'P1', 'B5']], ['crosses', 'spot', ['P10']], ['help-match', 'mix', []]]],
  passing: ['Pass it right', [['free-player', 'pass', ['PA3', 'PA4']], ['play-forward', 'pass', ['PA2', 'PA5']], ['free-side', 'pass', ['PA6', 'PA8']], ['safe-back', 'pass', ['PA10', 'PA13']], ['pass-match', 'mix', []]]],
  shape: ['Move as one', [['hold-line', 'spot', ['U4', 'U3', 'R1']], ['slide', 'spot', ['U2', 'U5', 'R2']], ['guard-middle', 'spot', ['R3', 'U7', 'T2']], ['high-mid-deep', 'spot', ['U6', 'U1']], ['shape-match', 'mix', []]]],
};

test('road: data/road.json has the spec\'s chapters, nodes, kinds and principles, in order', () => {
  assert.deepEqual(rawRoad.chapters.map((c) => c.id), Object.keys(SPEC));
  for (const c of rawRoad.chapters) {
    const [title, nodes] = SPEC[c.id];
    assert.equal(c.title, title, `${c.id} title`);
    assert.deepEqual(c.nodes.map((n) => [n.id, n.kind, n.principles ?? []]), nodes, `${c.id} nodes`);
    for (const n of c.nodes.filter((x) => x.kind === 'mix')) assert.equal(n.from, c.id, `${n.id} draws from its own chapter`);
  }
  assert.deepEqual(rawRoad.groups, { DEF: ['CB', 'FB'], MID: ['DM', 'CM'], WING: ['W'], STRIKER: ['ST'] });
  assert.deepEqual(rawRoad.defaultRoles, { DEF: 'LB', MID: 'LCM', WING: 'LW', STRIKER: 'ST' });
  assert.equal(rawRoad.matchday.unlockAfter, 'defend-match', 'Match day opens with chapter 1\'s Big Match');
  assert.equal(rawRoad.chapters.find((c) => c.id === 'passing').opensAfter, 'close-down', '"Pass it right" also opens after chapter 1\'s first node');
  assert.equal(rawRoad.chapters.find((c) => c.id === 'help').opensAfter, 'close-down', '"Help the ball" too: attackers get attacking plays early');
  assert.deepEqual(rawRoad.lead, { MID: 'help', WING: 'help', STRIKER: 'help' }, 'Next up leads with "Help the ball" for everyone but defenders');
  assert.deepEqual(road.lead, { DEF: null, MID: 'help', WING: 'help', STRIKER: 'help' });
  assert.equal(rawRoad.chapters[0].nodes.at(-1).title, 'Big Match');
  assert.deepEqual(road.chapters.map((c) => c.skill), ['Defend', 'Help', 'Pass', 'Shape'], 'the card\'s four skills');
});

test('road: titles are short and plain (4 words or fewer per node, no codes, no "kid")', () => {
  const titles = new Set();
  for (const c of rawRoad.chapters) {
    assert.ok(c.title.split(/\s+/).length <= 4, c.title);
    for (const n of c.nodes) {
      assert.ok(n.title && n.title.split(/\s+/).length <= 4, `${n.id}: "${n.title}" is over 4 words`);
      assert.ok(!titles.has(n.title), `${n.title} is used twice`);
      titles.add(n.title);
    }
  }
  for (const t of [...titles, ...rawRoad.chapters.map((c) => c.title)]) {
    assert.doesNotMatch(t, /\b[A-Z]{1,2}\d{1,2}\b/, `${t}: no principle codes`);
    assert.doesNotMatch(t, /\bkids?\b/i, t);
    assert.doesNotMatch(t, /!/, t);
  }
});

test('road: every principle is in data/principles.json (the pass ones once the engine adds PA1-PA15)', () => {
  const hasPass = [...principleIds].some((id) => /^PA\d+$/.test(id));
  for (const n of R.roadNodes(road).filter((x) => x.kind !== 'mix')) {
    for (const id of n.principles) {
      if (/^PA\d+$/.test(id) && !hasPass) continue;
      assert.ok(principleIds.has(id), `${n.id}: unknown principle ${id}`);
    }
  }
});

test('road: every spot node has authored drills on its principles (a set never needs the generator alone)', () => {
  for (const n of R.roadNodes(road).filter((x) => x.kind === 'spot')) {
    const hits = index.filter((e) => (e.principles ?? []).some((p) => n.principles.includes(p)));
    assert.ok(hits.length >= 1, `${n.id} has no authored scenario`);
  }
});

// ---------------------------------------------------------------- normalising

test('road: normalizeRoad drops junk, keeps order, and gives mix nodes their chapter\'s principles and rep kind', () => {
  const r = R.normalizeRoad({
    chapters: [
      { id: 'a', title: 'A', nodes: [{ id: 'n1', kind: 'spot', title: 'One', principles: ['D1', 'D1', 7] }, { id: 'n1' }, { id: 'Bad Id' }, { id: 'first' }, { id: 'm', kind: 'mix', title: 'Mix' }] },
      { id: 'b', title: 'B', nodes: [{ id: 'p1', kind: 'pass', principles: ['PA3'] }, { id: 'p2', kind: 'pass', principles: ['PA2'] }, { id: 'pm', kind: 'mix' }] },
      { id: 'empty', nodes: [] }, null, { id: 'c', nodes: [{ id: 'z', kind: 'weird' }] },
    ],
  });
  assert.deepEqual(r.chapters.map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(R.roadNodes(r).map((n) => n.id), ['n1', 'm', 'p1', 'p2', 'pm', 'z'], 'duplicates, bad ids and the reserved "first" dropped');
  assert.deepEqual(R.nodeById(r, 'n1').principles, ['D1']);
  assert.deepEqual(R.nodeById(r, 'm').principles, ['D1']);
  assert.equal(R.nodeById(r, 'm').repKind, 'spot');
  assert.deepEqual(R.nodeById(r, 'pm').principles, ['PA3', 'PA2']);
  assert.equal(R.nodeById(r, 'pm').repKind, 'pass');
  assert.equal(R.nodeById(r, 'z').kind, 'spot', 'an unknown kind plays as spot');
  assert.equal(R.nodeById(r, 'z').title, 'z');
  assert.deepEqual(R.normalizeRoad(null).chapters, []);
  assert.equal(R.normalizeRoad(null).matchday.unlockAfter, null);
  assert.deepEqual(R.normalizeRoad({ defaultRoles: { DEF: 'ST' } }).defaultRoles.DEF, 'LB', 'a default role outside its group is ignored');
  assert.deepEqual(R.normalizeRoad({ lead: { WING: 'nope', DEF: 'a' }, chapters: [{ id: 'a', nodes: [{ id: 'x' }] }] }).lead, { DEF: 'a', MID: null, WING: null, STRIKER: null }, 'a lead chapter must exist');
  assert.deepEqual(R.chapterOrder(road, 'WING').map((c) => c.id), ['help', 'defend', 'passing', 'shape']);
  assert.deepEqual(R.chapterOrder(road, 'DEF').map((c) => c.id), ['defend', 'help', 'passing', 'shape'], 'no lead: the Road\'s order');
  assert.deepEqual(R.chapterOrder(road, null).map((c) => c.id), ['defend', 'help', 'passing', 'shape']);
});

test('road: repKind and nodeHref send pass nodes (and their mix) to #/pass, the rest to #/play', () => {
  assert.equal(R.repKind(road, 'free-player'), 'pass');
  assert.equal(R.repKind(road, 'pass-match'), 'pass');
  assert.equal(R.repKind(road, 'defend-match'), 'spot');
  assert.equal(R.repKind(road, R.nodeById(road, 'crosses')), 'spot');
  assert.equal(R.nodeHref(road, 'safe-back'), '#/pass/safe-back');
  assert.equal(R.nodeHref(road, 'pass-match'), '#/pass/pass-match');
  assert.equal(R.nodeHref(road, 'back-up'), '#/play/back-up');
  assert.equal(R.nodeHref(road, 'nope'), '#/play');
  // A raw (unnormalised) mix node works too.
  assert.equal(R.repKind(rawRoad, rawRoad.chapters[2].nodes.at(-1)), 'pass');
  assert.deepEqual(R.nodeById(road, 'defend-match').principles, ['D1', 'D2', 'D3', 'D4', 'D5', 'T3', 'U8']);
  assert.equal(R.chapterOf(road, 'slide').id, 'shape');
  assert.equal(R.chapterOf(road, 'nope'), null);
});

// ---------------------------------------------------------------- the profile

test('road: normalizeProfile sanitises the stored profile; pickGroup sets the group, its starting role and onboarded', () => {
  assert.deepEqual(R.normalizeProfile(undefined), { version: 1, group: null, role: null, onboarded: false, road: {}, last: null });
  assert.deepEqual(R.normalizeProfile('junk'), R.createProfile());
  const p = R.normalizeProfile({ group: 'DEF', role: 'LCM', onboarded: true, road: { 'close-down': { stars: 7, plays: 2.4 }, 'back-up': { stars: -1, plays: 0 }, 'Bad Id': { stars: 3 }, first: { stars: 3, plays: 1 }, x: 'junk' } });
  assert.equal(p.role, 'LB', 'a role outside the group falls back to the group\'s starting role');
  assert.deepEqual(p.road, { 'close-down': { stars: 3, plays: 2 } }, 'stars clamp to 0-3; empty, bad and onboarding entries go');
  const q = R.normalizeProfile({ group: 'DEF', road: { 'back-up': { stars: 0, plays: 0, starts: 2 } }, last: { nodeId: 'back-up', ids: ['m1-02-d3-rcb', 7, 'x'] } });
  assert.deepEqual(q.road['back-up'], { stars: 0, plays: 0, starts: 2 }, 'a set begun and left is kept (its start counter)');
  assert.deepEqual(q.last, { nodeId: 'back-up', ids: ['m1-02-d3-rcb', 'x'] }, 'the last set\'s reps');
  assert.equal(R.normalizeProfile({ last: { nodeId: 'Bad Id', ids: [] } }).last, null);
  assert.equal(R.normalizeProfile({ onboarded: true }).onboarded, false, 'no group, not onboarded');
  assert.equal(R.normalizeProfile({ group: 'DEF', role: 'RCB' }).role, 'RCB', 'any role of the group is kept');
  for (const [g, role] of Object.entries(R.DEFAULT_ROLE)) {
    const q = R.pickGroup(null, g, road);
    assert.deepEqual([q.group, q.role, q.onboarded], [g, role, true]);
  }
  assert.equal(R.pickGroup({ group: 'DEF', role: 'RCB' }, 'DEF').role, 'RCB', 'the same group again keeps your role');
  assert.equal(R.pickGroup(null, 'KEEPER').group, null);
  assert.equal(R.groupOfRole('RB'), 'DEF');
  assert.equal(R.groupOfRole('DM'), 'MID');
  assert.equal(R.groupOfRole('GK'), null);
});

test('road: loadProfile and saveProfile use the store key "player"', () => {
  const app = fakeApp();
  assert.equal(R.loadProfile(app).onboarded, false);
  assert.equal(R.saveProfile(app, R.pickGroup(null, 'WING')), true);
  assert.ok(app.mem.has(R.PROFILE_KEY));
  assert.equal(R.PROFILE_KEY, 'player');
  assert.deepEqual([R.loadProfile(app).group, R.loadProfile(app).role], ['WING', 'LW']);
  assert.equal(R.loadProfile({ store: { get: () => { throw new Error('blocked'); } } }).group ?? null, null, 'a broken store is not fatal');
});

// ---------------------------------------------------------------- stars, unlocks, next up

test('road: setStarsFor averages the reps: 3 at 2.5, 2 at 1.8, 1 at 1, else 0', () => {
  assert.equal(R.setStarsFor([]), 0);
  assert.equal(R.setStarsFor([3, 3, 3, 2, 2]), 3); // 2.6
  assert.equal(R.setStarsFor([3, 2, 3, 2, 3]), 3); // 2.6
  assert.equal(R.setStarsFor([3, 3, 2, 2, 2]), 2); // 2.4
  assert.equal(R.setStarsFor([2, 2, 2, 1, 2]), 2); // 1.8 exactly
  assert.equal(R.setStarsFor([2, 2, 1, 1, 2]), 1); // 1.6
  assert.equal(R.setStarsFor([1, 1, 1, 1, 1]), 1);
  assert.equal(R.setStarsFor([0, 1, 0, 1, 2]), 0); // 0.8
  assert.equal(R.setStarsFor([9, 9]), 3, 'rep stars are capped at 3');
  assert.equal(R.setStarsFor(['x', null, 3]), 3, 'junk is ignored');
});

test('road: a node opens when the one before has a star or a finished set; "Help the ball" and "Pass it right" also open after chapter 1\'s first node', () => {
  const fresh = R.pickGroup(null, 'DEF');
  const open = (p) => R.roadNodes(road).filter((n) => R.isUnlocked(road, p, n.id)).map((n) => n.id);
  assert.deepEqual(open(fresh), ['close-down']);
  for (const g of R.GROUPS) assert.deepEqual(open(R.pickGroup(null, g)), ['close-down'], `${g}: everyone starts at Close Them Down`);
  assert.deepEqual(open(withStars('DEF', { 'close-down': 1 })), ['close-down', 'back-up', 'get-open', 'free-player'], 'defending stays open next to the others');
  assert.deepEqual(open(withStars('WING', { 'close-down': 1, 'get-open': 1 })), ['close-down', 'back-up', 'get-open', 'stay-wide', 'free-player']);
  assert.deepEqual(open(withStars('DEF', { 'close-down': 3, 'back-up': 2, 'goal-side': 1, 'defend-match': 1 })),
    ['close-down', 'back-up', 'goal-side', 'defend-match', 'get-open', 'free-player']);
  assert.ok(R.isUnlocked(road, withStars('DEF', { 'free-player': 1, 'play-forward': 1, 'free-side': 1, 'safe-back': 1, 'pass-match': 1 }), 'hold-line'), 'the chapter after "Pass it right" opens from its Match');
  assert.ok(R.isUnlocked(road, withStars('DEF', {}, { slide: 1 }), 'slide'), 'a node you have played stays open');
  assert.equal(R.isUnlocked(road, fresh, 'nope'), false);
  assert.ok(R.isUnlocked(road, withStars('DEF', { 'close-down': 0 }, { 'close-down': 3 }), 'back-up'), 'a finished set opens the next node, stars or not');
  assert.deepEqual(open(withStars('DEF', {}, { 'close-down': 1 })), ['close-down', 'back-up', 'get-open', 'free-player'],
    'a starless finished set opens the same doors a star does (stars stay the quality signal)');
});

test('road: next up: your group\'s lead chapter first, a never-played node before any replay, then weak nodes (under 2 stars)', () => {
  for (const g of R.GROUPS) assert.equal(R.nextNode(road, R.pickGroup(null, g)).id, 'close-down', `${g} starts at Close Them Down`);
  // Defenders: the Road's order.
  assert.equal(R.nextNode(road, withStars('DEF', { 'close-down': 1 })).id, 'back-up', 'a finished node moves Play forward: the fresh node, not a regrind');
  assert.equal(R.nextNode(road, withStars('DEF', {}, { 'close-down': 1 })).id, 'back-up', 'even with no stars at all: forward');
  assert.equal(R.nextNode(road, withStars('DEF', { 'close-down': 2 })).id, 'back-up', 'two stars: a 0-star node comes before replaying it');
  assert.equal(R.nextNode(road, withStars('DEF', { 'close-down': 2, 'back-up': 3 })).id, 'goal-side');
  assert.equal(R.nextNode(road, withStars('DEF', { 'close-down': 3, 'back-up': 3, 'goal-side': 3, 'defend-match': 3 })).id, 'get-open');
  // Everyone else: attacking plays early ("Help the ball" leads), defending stays open on the Road.
  for (const g of ['MID', 'WING', 'STRIKER']) {
    assert.equal(R.nextNode(road, withStars(g, { 'close-down': 1 })).id, 'get-open', `${g}: after Close Them Down, Get Open`);
    assert.equal(R.nextNode(road, withStars(g, { 'close-down': 1, 'get-open': 2 })).id, 'stay-wide', `${g}: the chapter goes on`);
  }
  // A winger's first plays are no longer all defending (the play-test: four defending nodes in a row).
  let wing = withStars('WING', {});
  const firstFour = [];
  for (let k = 0; k < 4; k++) {
    const n = R.nextNode(road, wing);
    firstFour.push(n.id);
    wing = { ...wing, road: { ...wing.road, [n.id]: { stars: 2, plays: 1 } } };
  }
  assert.deepEqual(firstFour, ['close-down', 'get-open', 'stay-wide', 'between-lines']);
  const helpDone = Object.fromEntries(['get-open', 'stay-wide', 'between-lines', 'crosses', 'help-match'].map((id) => [id, 2]));
  assert.equal(R.nextNode(road, withStars('WING', { 'close-down': 1, ...helpDone })).id, 'back-up', 'then on into defending: the fresh node, not a regrind of Close Them Down');
  assert.equal(R.nextNode(road, withStars('WING', { 'close-down': 2, ...helpDone })).id, 'back-up');
  const all = Object.fromEntries(R.roadNodes(road).map((n) => [n.id, 3]));
  assert.equal(R.nextNode(road, withStars('MID', all)).id, 'shape-match', 'everything at 3 stars: the last open node');
  const twos = Object.fromEntries(R.roadNodes(road).map((n) => [n.id, 2]));
  assert.equal(R.nextNode(road, withStars('DEF', twos)).id, 'close-down', 'everything at 2: the first under 3');
  assert.equal(R.nextNode(R.normalizeRoad(null), R.createProfile()), null);
});

test('road: Match day opens when chapter 1\'s Big Match has a star', () => {
  assert.equal(R.isMatchdayUnlocked(road, R.pickGroup(null, 'DEF')), false);
  assert.equal(R.isMatchdayUnlocked(road, withStars('DEF', { 'close-down': 3, 'back-up': 3, 'goal-side': 3 })), false);
  assert.equal(R.isMatchdayUnlocked(road, withStars('DEF', { 'defend-match': 1 })), true);
  assert.equal(R.isMatchdayUnlocked(R.normalizeRoad(null), withStars('DEF', { 'defend-match': 3 })), false);
});

test('road: roadModel marks stars, open nodes and the current one, with each node\'s address', () => {
  const m = R.roadModel(road, withStars('DEF', { 'close-down': 2 }));
  assert.deepEqual(m.map((c) => [c.id, c.unlocked, c.current]), [['defend', true, true], ['help', true, false], ['passing', true, false], ['shape', false, false]]);
  const cd = m[0].nodes[0];
  assert.deepEqual([cd.stars, cd.unlocked, cd.current, cd.href], [2, true, false, '#/play/close-down']);
  assert.equal(m[0].nodes[1].current, true, 'Back Up Your Buddy is next up (2 stars is good enough to move on)');
  assert.equal(m[2].nodes[0].href, '#/pass/free-player');
  assert.equal(m[0].stars, 2);
  assert.equal(m[0].maxStars, 12);
});

test('road: recordSet keeps the best node stars, counts the play, and reports what it opened', () => {
  const app = fakeApp({ player: R.pickGroup(null, 'DEF') });
  const first = R.recordSet(app, 'close-down', [2, 1, 1, 2, 1]); // 1.4 → 1
  assert.deepEqual([first.before, first.after, first.setStars, first.plays], [0, 1, 1, 1]);
  assert.deepEqual(first.unlocked, ['back-up', 'get-open', 'free-player']);
  assert.equal(first.matchday, false);
  const worse = R.recordSet(app, 'close-down', [0, 0, 0, 0, 0]);
  assert.deepEqual([worse.before, worse.after, worse.plays], [1, 1, 2], 'a worse set never takes stars away');
  assert.deepEqual(worse.unlocked, []);
  assert.deepEqual(R.loadProfile(app).road['close-down'], { stars: 1, plays: 2 });
  for (const id of ['back-up', 'goal-side']) R.recordSet(app, id, [3, 3, 3, 3, 3]);
  const big = R.recordSet(app, 'defend-match', [2, 2, 2, 2, 2]);
  assert.equal(big.matchday, true, 'Match day opens with the Big Match');
  assert.deepEqual(big.unlocked, [], 'Get Open was open already (after Close Them Down)');
  const onboarding = R.recordSet(app, R.FIRST_SET, [3, 3, 3]);
  assert.equal(onboarding.after, 0);
  assert.equal(R.loadProfile(app).road.first, undefined, 'the onboarding set is not a Road node');
  assert.equal(R.recordSet(app, 'not-a-node', [3]).plays, 0, 'unknown ids are not recorded while the road is loaded');
  assert.equal(R.recordSet(app, 'Bad Id!', [3]).after, 0);
  const offline = fakeApp({ player: R.pickGroup(null, 'DEF') }, R.normalizeRoad(null));
  assert.deepEqual(R.recordSet(offline, 'back-up', [3, 3, 3]).after, 3, 'a road that failed to load still records the set');
  assert.deepEqual(R.loadProfile(offline).road['back-up'], { stars: 3, plays: 1 });
});

// ---------------------------------------------------------------- building sets

test('road: a spot set is 5 reps, your group first, mirrored to your side, then generated for your position', async () => {
  const calls = [];
  const profile = R.pickGroup(null, 'DEF'); // LB
  const reps = await R.buildSet('close-down', { road, profile, index, load, seed: 11, generators: { spot: spotStub(calls) } });
  assert.equal(reps.length, 5);
  assert.ok(reps.every((r) => r.kind === 'spot' && r.scenario && r.nodeId === 'close-down'));
  // Both close-down drills in the defenders' group are right-back drills: played as a left back, mirrored.
  assert.deepEqual(ids(reps.slice(0, 2)).sort(), ['m1-05-d2-rb-m', 'm3-07-r2-rb-m']);
  assert.ok(reps.slice(0, 2).every((r) => r.mirrored && r.scenario.learner.role === 'LB'));
  assert.ok(reps.slice(2).every((r) => r.generated && r.scenario.learner.role === 'LB'), 'then generated drills for your position');
  assert.ok(calls.length >= 3 && calls.every((c) => c.role === 'LB' && c.principles.join() === 'D1,D2'));
  assert.equal(new Set(ids(reps)).size, 5, 'no drill twice');
});

test('road: sets are deterministic for a seed', async () => {
  const profile = withStars('MID', { 'close-down': 2 });
  const a = await R.buildSet('back-up', { road, profile, index, load, seed: 5, generators: { spot: spotStub() } });
  const b = await R.buildSet('back-up', { road, profile, index, load, seed: 5, generators: { spot: spotStub() } });
  assert.deepEqual(ids(a), ids(b));
  const pa = await R.buildSet('pass-match', { road, profile, index, load, seed: 5, generators: { pass: passStub() } });
  const pb = await R.buildSet('pass-match', { road, profile, index, load, seed: 5, generators: { pass: passStub() } });
  assert.deepEqual(ids(pa), ids(pb));
  const others = await Promise.all([1, 2, 3, 4].map((seed) => R.buildSet('pass-match', { road, profile, index, load, seed, generators: { pass: passStub() } })));
  assert.ok(others.some((o) => ids(o).join() !== ids(pa).join()), 'another seed gives another set');
});

test('road: a set starts with one recall rep from an earlier node you have played', async () => {
  const profile = withStars('DEF', { 'close-down': 1 });
  const reps = await R.buildSet('back-up', { road, profile, index, load, seed: 3, generators: null });
  assert.equal(reps.length, 5);
  assert.equal(reps[0].recall, true);
  assert.equal(reps[0].nodeId, 'close-down');
  assert.ok(reps[0].scenario.principles.some((p) => ['D1', 'D2'].includes(p)));
  assert.ok(reps.slice(1).every((r) => !r.recall && r.nodeId === 'back-up'));
  const fresh = await R.buildSet('close-down', { road, profile: R.pickGroup(null, 'DEF'), index, load, seed: 3, generators: null });
  assert.ok(fresh.every((r) => !r.recall), 'nothing played before: no recall rep');
  const mix = await R.buildSet('defend-match', { road, profile: withStars('DEF', { 'close-down': 3, 'back-up': 3, 'goal-side': 3 }), index, load, seed: 3, generators: null });
  assert.ok(mix.every((r) => !r.recall), 'a mix set is all recall already');
});

test('road: a mix set draws from its chapter\'s nodes in turn', async () => {
  const reps = await R.buildSet('defend-match', { road, profile: R.pickGroup(null, 'DEF'), index, load, seed: 9, generators: { spot: spotStub() } });
  assert.equal(reps.length, 5);
  const from = new Set(reps.map((r) => r.nodeId));
  assert.ok(from.size >= 3 && [...from].every((id) => ['close-down', 'back-up', 'goal-side'].includes(id)), [...from].join());
});

test('road: without a generator, a set is authored only (other positions, then the chapter\'s other ideas)', async () => {
  const reps = await R.buildSet('close-down', { road, profile: R.pickGroup(null, 'WING'), index, load, seed: 2, generators: null });
  assert.equal(reps.length, 5);
  assert.ok(reps.every((r) => r.scenario.timeline && !r.generated));
  const thin = await R.buildSet('crosses', { road, profile: R.pickGroup(null, 'DEF'), index, load, seed: 2, generators: null });
  assert.equal(thin.length, 5, 'one authored drill still makes a set');
  assert.ok(thin.some((r) => r.scenario.principles.includes('P10')), 'the node\'s own idea first');
  assert.ok(thin.some((r) => r.extra), 'then the chapter\'s other ideas');
  assert.ok(thin.every((r) => !r.twin && !r.repeat), 'before any drill comes back mirrored or twice');
  assert.equal(new Set(thin.map((r) => r.scenario.id.replace(/-m$/, ''))).size, 5);
  // A generator that fails or gives nothing is the same as none.
  const warn = console.warn;
  console.warn = () => {};
  try {
    const broken = await R.buildSet('close-down', { road, profile: R.pickGroup(null, 'WING'), index, load, seed: 2, generators: { spot: () => { throw new Error('boom'); } } });
    assert.deepEqual(ids(broken), ids(reps));
    const empty = await R.buildSet('close-down', { road, profile: R.pickGroup(null, 'WING'), index, load, seed: 2, generators: { spot: () => null } });
    assert.deepEqual(ids(empty), ids(reps));
  } finally { console.warn = warn; }
});

test('road: every spot and mix node builds 5 playable reps for every position group from authored drills alone', async () => {
  const warn = console.warn;
  try {
    for (const group of R.GROUPS) {
      for (const n of R.roadNodes(road).filter((x) => R.repKind(road, x) === 'spot')) {
        const reps = await R.buildSet(n, { road, profile: withStars(group, { 'close-down': 1 }), index, load, seed: 1, generators: null });
        assert.equal(reps.length, 5, `${group} ${n.id}`);
        for (const r of reps) assert.ok(r.scenario?.timeline && r.scenario?.learner?.role, `${group} ${n.id}: ${r.scenario?.id}`);
      }
    }
  } finally { console.warn = warn; }
});

test('road: a pass set is generated on the node\'s principles (authored pass drills first); none → an empty set', async () => {
  const calls = [];
  const profile = R.pickGroup(null, 'MID');
  const reps = await R.buildSet('free-player', { road, profile, index, load, seed: 4, generators: { pass: passStub(calls) } });
  assert.equal(reps.length, 5);
  assert.ok(reps.every((r) => r.kind === 'pass' && r.drill && r.nodeId === 'free-player'));
  assert.ok(calls.every((c) => c.role === 'LCM' && c.principles.join() === 'PA3,PA4'));
  const mix = await R.buildSet('pass-match', { road, profile, index, load, seed: 4, generators: { pass: passStub() } });
  assert.equal(new Set(mix.map((r) => r.nodeId)).size, 4, 'the pass Match takes each pass node in turn');
  assert.deepEqual(await R.buildSet('free-player', { road, profile, index, load, seed: 4, generators: null }), []);
  const withAuthored = [...index, { id: 'pa-demo', kind: 'pass', principles: ['PA4'], role: 'LCM' }];
  const authored = await R.buildSet('free-player', { road, profile, index: withAuthored, load: async (id) => (id === 'pa-demo' ? { id, kind: 'pass' } : load(id)), seed: 4, generators: { pass: passStub() } });
  assert.equal(authored[0].drill.id, 'pa-demo');
  assert.equal(authored.length, 5);
});

test('road: the generators get the catalogue; a pass set asks 3 of 5 for a forward best, from consecutive seeds', async () => {
  const spotCalls = [], passCalls = [];
  const catalogue = { list: principlesFile.principles, byId: Object.fromEntries(principlesFile.principles.map((p) => [p.id, p])) };
  const profile = R.pickGroup(null, 'WING');
  await R.buildSet('close-down', { road, profile, index, load, seed: 6, catalogue, generators: { spot: spotStub(spotCalls) } });
  assert.ok(spotCalls.length && spotCalls.every((c) => c.catalogue === catalogue));
  await R.buildSet('free-player', { road, profile, index, load, seed: 6, catalogue, generators: { pass: passStub(passCalls), forwardable: () => true } });
  assert.equal(passCalls.length, 5);
  assert.ok(passCalls.every((c) => c.catalogue === catalogue && c.role === 'LW'));
  const bySlot = [...passCalls].sort((a, b) => a.seed - b.seed);
  assert.deepEqual(bySlot.map((c) => c.direction), ['forward', 'any', 'forward', 'any', 'forward'], 'slots 1, 3 and 5 want a forward best');
  assert.deepEqual(bySlot.map((c) => c.seed - bySlot[0].seed), [0, 1, 2, 3, 4], 'consecutive integer seeds');
  assert.deepEqual(passCalls.map((c) => c.direction), ['forward', 'forward', 'forward', 'any', 'any'], 'the forward slots are filled first (a teammate lends a hand there first)');
  // Ideas no forward pass can teach for the position (Keep It Safe for a winger): no forward slots.
  const safe = [];
  await R.buildSet('safe-back', { road, profile, index, load, seed: 6, generators: { pass: passStub(safe), forwardable: () => false } });
  assert.ok(safe.every((c) => c.direction === 'any'));
  // The app's catalogue by default (main.js binds the app).
  R.bindRoad({ data: { road, principles: catalogue } });
  try {
    const bound = [];
    await R.buildSet('free-player', { road, profile, index, load, seed: 6, generators: { pass: passStub(bound) } });
    assert.ok(bound.every((c) => c.catalogue === catalogue));
  } finally { R.bindRoad(null); }
});

test('road: forwardPlan spreads the forward slots through the set', () => {
  assert.deepEqual([...R.forwardPlan([true, true, true, true, true])].sort(), [0, 2, 4]);
  assert.deepEqual([...R.forwardPlan([true, true, false, true, true])].sort(), [0, 3, 4]);
  assert.deepEqual([...R.forwardPlan([true, false, true, false, false])].sort(), [0, 2], 'as many as the ideas allow');
  assert.deepEqual([...R.forwardPlan([false, false, false, false, false])], []);
});

test('road: a generator that comes back empty is not asked again in that set; a teammate in your group plays the rep', async () => {
  const calls = [];
  // Full-backs never get this idea; the centre-backs do (passdrill.js: "free side" for full-backs 0 of 10).
  const gen = (o) => { calls.push(o); return o.role === 'LB' ? null : { id: `pass-${o.role}-${o.seed}`, kind: 'pass', learner: { role: o.role }, principles: [...o.principles] }; };
  const reps = await R.buildSet('free-side', { road, profile: R.pickGroup(null, 'DEF'), index, load, seed: 8, generators: { pass: gen, forwardable: () => true } });
  assert.equal(reps.length, 5);
  assert.ok(reps.every((r) => r.borrowed && r.drill.learner.role === 'LCB'), 'the centre-back on your side first');
  const lbAsks = calls.filter((c) => c.role === 'LB' && c.principles.join() === 'PA6,PA8');
  assert.equal(lbAsks.filter((c) => c.direction === 'forward').length, R.ROAD_DEFAULTS.generatorNulls, 'asked twice for a forward pass, then never again');
  assert.equal(lbAsks.filter((c) => c.direction === 'any').length, R.ROAD_DEFAULTS.generatorNulls);
  assert.ok(calls.filter((c) => c.role === 'LB').length <= 4 * R.ROAD_DEFAULTS.generatorNulls, 'and on the chapter\'s other ideas, twice each way');
  // A spot generator that never gives a drill is asked twice per set of ideas, not 15 times.
  const spotCalls = [];
  await R.buildSet('close-down', { road, profile: R.pickGroup(null, 'WING'), index, load, seed: 8, generators: { spot: (o) => { spotCalls.push(o); return null; } } });
  assert.ok(spotCalls.length <= 2 * R.ROAD_DEFAULTS.generatorNulls, `${spotCalls.length} calls`);
});

test('road: near-duplicates: the same position, ball and start (or best pass) look like the same rep', () => {
  const spot = (bx, by, sx, sy, role = 'LB') => ({ kind: 'spot', scenario: { learner: { role, start: { x: sx, y: sy } }, timeline: { freezeAt: 2, ball: [{ t: 0, x: 0, y: 0 }, { t: 2, x: bx, y: by }, { t: 4, x: 99, y: 60 }] } } });
  assert.deepEqual(R.ballAtFreeze(spot(40, 20, 0, 0).scenario), { x: 40, y: 20 });
  assert.deepEqual(R.ballAtFreeze({ timeline: { freezeAt: 1, ball: [{ t: 0, x: 0, y: 0 }, { t: 2, x: 10, y: 20 }] } }), { x: 5, y: 10 });
  const a = R.repPicture(spot(40, 20, 30, 10));
  assert.ok(R.nearDuplicate(a, R.repPicture(spot(43, 22, 31, 12))), 'ball and start within a few metres');
  assert.ok(!R.nearDuplicate(a, R.repPicture(spot(43, 22, 38, 18))), 'you start somewhere else');
  assert.ok(!R.nearDuplicate(a, R.repPicture(spot(52, 20, 30, 10))), 'the ball is somewhere else');
  assert.ok(!R.nearDuplicate(a, R.repPicture(spot(40, 20, 30, 10, 'LCB'))), 'another position');
  const pass = (x, y, best) => ({ kind: 'pass', drill: { learner: { role: 'LCM' }, rating: { ball: { x, y }, best: { targetId: best } } } });
  const p = R.repPicture(pass(50, 30, 'us-ST'));
  assert.ok(R.nearDuplicate(p, R.repPicture(pass(53, 32, 'us-ST'))), 'the same best pass from nearly the same place');
  assert.ok(!R.nearDuplicate(p, R.repPicture(pass(53, 32, 'us-LW'))), 'another best pass');
  assert.ok(R.nearDuplicate(p, R.repPicture(pass(51, 31, 'us-LW'))), 'received in almost the same place');
  assert.equal(R.repPicture({ kind: 'spot', scenario: { timeline: {} } }), null);
});

test('road: mirrored twins and repeats only when nothing else is left (a tiny index)', async () => {
  const one = index.filter((e) => e.id === 'm1-05-d2-rb');
  const tiny = await R.buildSet('close-down', { road, profile: R.pickGroup(null, 'DEF'), index: one, load, seed: 1, generators: null });
  assert.equal(tiny.length, 5);
  assert.equal(tiny[0].scenario.id, 'm1-05-d2-rb-m', 'played as a left back');
  assert.equal(tiny[1].twin, true);
  assert.equal(tiny[1].scenario.id, 'm1-05-d2-rb', 'its twin: the same drill on the other side');
  assert.ok(tiny.slice(2).every((r) => r.repeat));
});

test('road: the onboarding set is 3 easy reps for your group', async () => {
  for (const group of R.GROUPS) {
    const profile = R.pickGroup(null, group);
    const reps = await R.buildFirstSet({ road, profile, index, load, seed: 1, generators: null });
    assert.equal(reps.length, 3, group);
    const fams = road.groups[group];
    const families = { LB: 'FB', RB: 'FB', LCB: 'CB', RCB: 'CB', DM: 'DM', LCM: 'CM', RCM: 'CM', LW: 'W', RW: 'W', ST: 'ST' };
    assert.ok(reps.every((r) => fams.includes(families[r.scenario.learner.role])), `${group}: ${ids(reps)}`);
    assert.ok(reps.every((r) => r.nodeId === R.FIRST_SET));
  }
  const def = await R.buildFirstSet({ road, profile: R.pickGroup(null, 'DEF'), index, load, seed: 1, generators: null });
  assert.equal(def[0].scenario.learner.role, 'LB', 'your own position first');
});

test('road: the onboarding set plays small without costing you your position (easy drills in it that can be small first)', async () => {
  // A stand-in stager as cast.js measures the authored drills: a left back's easiest ones (m1-03, m3-02) need a bigger
  // game, and passing them over once gave a defender's first set all in the left centre-back's shoes.
  const noSmall = new Set(['m1-03-d4-lb', 'm3-02-u4-rb', 'm1-04-d5-rcb', 'm1-10-u8-lcb', 'm1-12-u8-rb', 'm3-06-u5-lcb', 'm3-10-u3-lcb']);
  const stager = (rep) => ({ small: !noSmall.has(String(rep.scenario.id).replace(/-m$/, '')), medium: true });
  const def = await R.buildFirstSet({ road, profile: R.pickGroup(null, 'DEF'), index, load, seed: 1, generators: null, stager });
  assert.deepEqual(def.map((r) => r.scenario.learner.role), ['LB', 'LB', 'LB'], `all in your position (${ids(def)})`);
  assert.ok(def.every((r) => !noSmall.has(r.scenario.id.replace(/-m$/, ''))), `all can be played small (${ids(def)})`);
  assert.ok(def.every((r) => r.stage === 'small'));
  const easy = new Map(index.map((e) => [e.id, e.difficulty ?? 0]));
  assert.ok(def.every((r) => easy.get(r.scenario.id.replace(/-m$/, '')) <= 0), 'still easy ones (difficulty 0 or less)');
  // Nothing in your position can be played small: your group's easy ones that can, before a bigger game.
  const all = (rep) => ({ small: rep.scenario.learner.role !== 'LB', medium: true });
  const other = await R.buildFirstSet({ road, profile: R.pickGroup(null, 'DEF'), index, load, seed: 1, generators: null, stager: all });
  assert.ok(other.every((r) => r.scenario.learner.role !== 'LB'), `the group's small ones (${ids(other)})`);
});

test('road: the seeded helpers are stable', () => {
  assert.equal(R.hash32('fotbol'), R.hash32('fotbol'));
  assert.notEqual(R.hash32('a'), R.hash32('b'));
  const a = R.seededRandom(7), b = R.seededRandom(7);
  const xs = Array.from({ length: 5 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('road: the module has its visible words in STRINGS', () => {
  assert.deepEqual(Object.keys(R.STRINGS.groups), R.GROUPS);
  assert.deepEqual(Object.values(R.STRINGS.groups), ['Defender', 'Midfielder', 'Winger', 'Striker']);
});

// ---------------------------------------------------------------- a set begun counts; the recall rep; varied, mostly your own position

test('road: a set counts when it begins: a reload or a quit in the middle deals fresh reps, never the same ones for XP', async () => {
  const app = fakeApp({ player: withStars('DEF', { 'close-down': 1 }) });
  const opts = () => ({ road, profile: R.loadProfile(app), index, load, seed: 17, generators: { spot: spotStub() }, app });
  const a = await R.buildSet('back-up', opts());
  assert.deepEqual(R.loadProfile(app).road['back-up'], { stars: 0, plays: 0, starts: 1 }, 'the start is counted before a rep is played');
  assert.deepEqual(R.loadProfile(app).last, { nodeId: 'back-up', ids: ids(a).map((id) => id.replace(/-m$/, '')) }, 'and the set is the last set');
  const b = await R.buildSet('back-up', opts()); // the page reloaded mid-set: the same node, the same caller seed
  assert.notDeepEqual(ids(b), ids(a), 'a new set, not the reps you have just seen');
  const base = (xs) => xs.map((id) => id.replace(/-m$/, ''));
  assert.deepEqual(base(ids(b)).filter((id) => base(ids(a)).includes(id)), [], 'none of them: the authored ones wait behind fresh content');
  assert.equal(R.nodeAttempt(R.loadProfile(app), 'back-up'), 2);
  // Finishing a set keeps the counter; an old profile (plays only) counts its plays.
  R.recordSet(app, 'back-up', [2, 2, 2, 2, 2]);
  assert.deepEqual(R.loadProfile(app).road['back-up'], { stars: 2, plays: 1, starts: 2 });
  assert.equal(R.nodeAttempt({ road: { x: { stars: 1, plays: 3 } } }, 'x'), 3);
  // Without the app nothing is counted (the sweeps, the tests): deterministic for a seed and a profile.
  const p = R.loadProfile(app);
  assert.deepEqual(ids(await R.buildSet('back-up', { road, profile: p, index, load, seed: 17, generators: { spot: spotStub() } })),
    ids(await R.buildSet('back-up', { road, profile: p, index, load, seed: 17, generators: { spot: spotStub() } })));
  assert.equal(R.nodeAttempt(R.loadProfile(app), 'back-up'), 2);
  assert.equal(R.startSet(app, R.FIRST_SET, a), -1, 'the onboarding set is not a Road node');
  assert.equal(R.startSet(app, 'nope', a), -1);
  assert.equal(R.startSet(app, 'goal-side', a), 0, 'a node\'s first set is attempt 0');
});

test('road: the onboarding set becomes the last set, so the first Road sets after it do not deal the tutorial again', async () => {
  // Play-test: a defender's and a striker's first Road set dealt 2 of the onboarding set's 3 drills straight back
  // (the worked example, whose answer the kid had just been shown, scored for real), and the next node's recall rep
  // was the tutorial's drill once more.
  for (const group of R.GROUPS) {
    const app = fakeApp({ [R.PROFILE_KEY]: R.pickGroup(null, group, road) });
    const first = await R.buildFirstSet({ road, profile: R.loadProfile(app), index, load, seed: 1, generators: { spot: spotStub() }, app });
    const tutorial = first.map((r) => r.scenario.id.replace(/-m$/, ''));
    const p = R.loadProfile(app);
    assert.deepEqual(p.last, { nodeId: R.FIRST_SET, ids: tutorial }, `${group}: the onboarding set is the last set`);
    assert.deepEqual(p.road, {}, `${group}: and nothing is counted on the Road`);
    const node = R.nextNode(road, p);
    const set = await R.buildSet(node, { road, profile: p, index, load, seed: 1, generators: { spot: spotStub() }, app });
    const again = set.map((r) => String(r.scenario?.id ?? r.drill?.id).replace(/-m$/, '')).filter((id) => tutorial.includes(id));
    assert.deepEqual(again, [], `${group}: ${node.id}'s first set deals the tutorial's drills again`);
    assert.equal(set.length, 5, `${group}: still a full set`);
    // The onboarding set's drills stay in the last set through that set, and leave it with the next.
    const kept = R.loadProfile(app).last;
    assert.equal(kept.nodeId, node.id);
    assert.ok(tutorial.every((id) => kept.ids.includes(id)), `${group}: carried through the first Road set (${kept.ids})`);
    assert.ok(kept.ids.length <= R.ROAD_DEFAULTS.lastIds);
    R.startSet(app, node.id, set);
    assert.ok(!tutorial.some((id) => R.loadProfile(app).last.ids.includes(id)), `${group}: only for one set`);
  }
  // A defender's close-down: the left back's own drills on its ideas are the tutorial's two, and a set with nothing
  // else of the left back's left takes the chapter's other ideas before them.
  const app = fakeApp({ [R.PROFILE_KEY]: R.pickGroup(null, 'DEF', road) });
  const first = await R.buildFirstSet({ road, profile: R.loadProfile(app), index, load, seed: 1, generators: null, app });
  const tutorial = first.map((r) => r.scenario.id.replace(/-m$/, ''));
  const set = await R.buildSet('close-down', { road, profile: R.loadProfile(app), index, load, seed: 1, generators: null });
  assert.equal(set.length, 5);
  assert.deepEqual(set.map((r) => r.scenario.id.replace(/-m$/, '')).filter((id) => tutorial.includes(id)), [], `no generator: ${ids(set)}`);
  // After a Road set the usual rule holds: the last set's drills come back only when nothing else is left.
  const plain = await R.buildSet('close-down', { road, profile: { ...R.loadProfile(app), last: { nodeId: 'back-up', ids: tutorial } }, index, load, seed: 1, generators: null });
  assert.equal(plain.length, 5);
  // The first set with no app: nothing saved (the sweeps, the tests).
  const bare = fakeApp({ [R.PROFILE_KEY]: R.pickGroup(null, 'MID', road) });
  await R.buildFirstSet({ road, profile: R.loadProfile(bare), index, load, seed: 1, generators: null });
  assert.equal(R.loadProfile(bare).last, null);
  assert.equal(R.startSet(bare, R.FIRST_SET, []), -1, 'an empty onboarding set: nothing to remember');
  assert.equal(R.loadProfile(bare).last, null);
});

test('road: the recall rep comes from another node you have played, never on this node\'s ideas, never a rep of your last set', async () => {
  // Played: close-down (D1, D2) and goal-side (D5, T3, U8); the last set was close-down.
  const base = withStars('DEF', { 'close-down': 2, 'back-up': 1, 'goal-side': 1 });
  const lastIds = ['m1-05-d2-rb', 'm3-07-r2-rb', 'gen-x'];
  const profile = { ...base, last: { nodeId: 'close-down', ids: lastIds } };
  const sources = R.recallSources(road, profile, R.nodeById(road, 'back-up')).map((n) => n.id);
  assert.deepEqual(sources, ['goal-side'], 'another node than the last set\'s when there is one');
  assert.deepEqual(R.recallSources(road, { ...profile, last: null }, R.nodeById(road, 'back-up')).map((n) => n.id), ['close-down', 'goal-side']);
  assert.deepEqual(R.recallSources(road, profile, R.nodeById(road, 'close-down')).map((n) => n.id), ['back-up', 'goal-side'], 'never the node you are on');
  for (let seed = 1; seed <= 6; seed++) {
    const reps = await R.buildSet('back-up', { road, profile, index, load, seed, generators: { spot: spotStub() } });
    const recall = reps.find((r) => r.recall);
    assert.ok(recall, `seed ${seed}: a recall rep`);
    assert.notEqual(recall.nodeId, 'back-up');
    assert.ok(!recall.scenario.principles.some((p) => ['D3', 'D4'].includes(p)), `seed ${seed}: ${recall.scenario.id} is about another idea`);
    assert.ok(!lastIds.includes(recall.scenario.id.replace(/-m$/, '')), `seed ${seed}: ${recall.scenario.id} was in the last set`);
  }
  // Only the last set's node played: a recall from it, but not one of its reps.
  const only = { ...withStars('DEF', { 'close-down': 1 }), last: { nodeId: 'close-down', ids: ['m1-05-d2-rb', 'm3-07-r2-rb'] } };
  const r = (await R.buildSet('back-up', { road, profile: only, index, load, seed: 2, generators: null })).find((x) => x.recall);
  assert.ok(r && !['m1-05-d2-rb', 'm3-07-r2-rb'].includes(r.scenario.id.replace(/-m$/, '')), r?.scenario.id);
});

test('road: a set holds one generated rep per engine template and per player on the ball ("Their winger has the ball" once)', async () => {
  const gen = (holder, template) => ({ kind: 'spot', scenario: { id: 'g', source: { kind: 'generated', template }, timeline: { freezeAt: 2, carrier: [{ t: 0, id: 'them-LB' }, { t: 1, id: null }, { t: 1.5, id: holder }, { t: 3, id: 'them-ST' }] } } });
  assert.equal(R.carrierAtFreeze(gen('them-RW').scenario), 'them-RW', 'the holder at the freeze, not after it');
  const tpl = (template, source) => ({ ...gen('them-RW', source).scenario, template });
  assert.deepEqual(R.repLooks({ kind: 'spot', scenario: tpl('them-pass') }), ['spot|template|them-pass', 'spot|carrier|them-RW'], "the engine's template id");
  assert.deepEqual(R.repLooks({ kind: 'spot', scenario: tpl('natural') }), ['spot|carrier|them-RW'], 'a plain scene is no template');
  assert.deepEqual(R.repLooks({ kind: 'pass', drill: { source: { kind: 'generated', template: 'switch' } } }), ['pass|template|switch'], 'a hand-shaped scene');
  assert.deepEqual(R.repLooks({ kind: 'pass', drill: { source: { kind: 'generated', template: 'marked' } } }), [], 'a varied random scene is no template');
  assert.deepEqual(R.repLooks({ kind: 'pass', drill: { template: 'switch-left', source: { kind: 'generated', template: 'switch' } } }), ['pass|template|switch-left']);
  assert.deepEqual(R.repLooks({ kind: 'pass', drill: { source: { kind: 'generated', template: null } } }), []);
  assert.deepEqual(R.repLooks({ kind: 'spot', scenario: { id: 'm1-01', timeline: { carrier: [{ t: 0, id: 'them-RW' }] } } }), [], 'authored reps are all different');
  // A generator whose scenes all have their winger on the ball: one generated rep, then other content.
  const holderStub = (o) => ({ id: `gen-${o.seed}`, title: 'Generated', timeline: { ball: [{ t: 0, x: (o.seed % 90) + 5, y: (o.seed % 60) + 4 }], freezeAt: 0, carrier: [{ t: 0, id: 'them-RW' }] }, learner: { role: o.role, start: { x: (o.seed * 7) % 100, y: (o.seed * 3) % 68 } }, principles: [...o.principles], source: { kind: 'generated' } });
  const reps = await R.buildSet('close-down', { road, profile: R.pickGroup(null, 'DEF'), index, load, seed: 5, generators: { spot: holderStub } });
  assert.equal(reps.length, 5);
  assert.equal(reps.filter((r) => r.generated).length, 1, `one rep with their winger on the ball (${ids(reps)})`);
});

test('road: a generated spot rep whose question the set asks already is worded another way (avoidTemplates), not dropped', async () => {
  // Like spotdrill.js: every drill fits these questions and asks the first one it is not told to avoid.
  const stub = (questions, calls = []) => (o) => {
    calls.push(o);
    const template = questions.find((q) => !(o.avoidTemplates ?? []).includes(q)) ?? questions[0];
    return { id: `gen-${o.seed}`, title: 'Generated', template, timeline: { ball: [] }, learner: { role: o.role }, principles: [...o.principles], source: { kind: 'generated' } };
  };
  const calls = [];
  const five = ['has-ball', 'has-ball-area', 'goes-to', 'wide', 'close'];
  const reps = await R.buildSet('close-down', { road, profile: R.pickGroup(null, 'DEF'), index: [], load, seed: 5, generators: { spot: stub(five, calls) } });
  assert.deepEqual(reps.map((r) => r.scenario.template), five, 'five drills, five questions');
  assert.equal(calls.length, 5, 'no drill thrown away for its question');
  assert.deepEqual(calls.map((c) => c.avoidTemplates ?? []), five.map((_, i) => five.slice(0, i)), 'each call is told the questions the set asks already');
  // A drill no other question fits is still turned away: one generated rep, then other content.
  const one = await R.buildSet('close-down', { road, profile: R.pickGroup(null, 'DEF'), index, load, seed: 5, generators: { spot: stub(['has-ball']) } });
  assert.equal(one.length, 5);
  assert.equal(one.filter((r) => r.generated).length, 1, ids(one).join());
});

test('road: a pass set lends at most 2 reps to a teammate (your group first); only a set that would run short lends more', async () => {
  // A left back cannot get "Find the Free Side"; the centre-backs can; any other idea works for the left back.
  const gen = (o) => (o.role === 'LB' && o.principles.join() === 'PA6,PA8' ? null
    : { id: `pass-${o.role}-${o.seed}-${o.principles.join('')}`, kind: 'pass', learner: { role: o.role }, principles: [...o.principles] });
  const reps = await R.buildSet('free-side', { road, profile: R.pickGroup(null, 'DEF'), index, load, seed: 8, generators: { pass: gen, forwardable: () => true } });
  assert.equal(reps.length, 5);
  const borrowed = reps.filter((r) => r.borrowed);
  assert.equal(borrowed.length, R.ROAD_DEFAULTS.maxBorrowed, `${borrowed.length} reps in another position`);
  assert.ok(borrowed.every((r) => r.drill.learner.role === 'LCB'), 'the centre-back on your side (your group) first');
  assert.ok(reps.filter((r) => !r.borrowed).every((r) => r.drill.learner.role === 'LB' && r.extra), 'the rest in your position, on the chapter\'s other ideas');
  // The engine says up front what it cannot make: those asks are never sent.
  const calls = [];
  const known = await R.buildSet('free-side', {
    road, profile: R.pickGroup(null, 'DEF'), index, load, seed: 8,
    generators: { pass: (o) => { calls.push(o); return gen(o); }, forwardable: () => true, canGenerate: (kind, role, ps, direction) => !(kind === 'pass' && role === 'LB' && ps.includes('PA6') && ['any', 'forward'].includes(direction)) },
  });
  assert.equal(known.length, 5);
  assert.equal(calls.filter((c) => c.role === 'LB' && c.principles.includes('PA6')).length, 0, 'no call known to fail');
  // A spot set: at most 2 reps in another position, unless nothing else is left.
  const spot = await R.buildSet('close-down', { road, profile: R.pickGroup(null, 'WING'), index, load, seed: 3, generators: { spot: spotStub() } });
  assert.ok(spot.filter((r) => r.scenario.learner.role !== 'LW').length <= R.ROAD_DEFAULTS.maxBorrowed, ids(spot).join());
  assert.ok(spot.filter((r) => r.borrowed).every((r) => r.scenario.learner.role !== 'LW'), 'borrowed reps are flagged');
});

test('road: the onboarding set leans on your group\'s lead chapter (attacking ideas for attackers)', async () => {
  const calls = [];
  await R.buildFirstSet({ road, profile: R.pickGroup(null, 'WING'), index: [], load, seed: 1, generators: { spot: spotStub(calls) } });
  const help = new Set(R.chapterOrder(road, 'WING')[0].nodes.flatMap((n) => n.principles));
  assert.ok(calls.length && calls.every((c) => c.principles.every((p) => help.has(p))), 'a winger\'s generated first plays are about helping the ball');
  const def = [];
  await R.buildFirstSet({ road, profile: R.pickGroup(null, 'DEF'), index: [], load, seed: 1, generators: { spot: spotStub(def) } });
  assert.ok(def.every((c) => c.principles.every((p) => ['D1', 'D2', 'D3', 'D4', 'D5', 'T3', 'U8'].includes(p))), 'a defender\'s are about defending');
});

// ---------------------------------------------------------------- stages: a small game → a bigger game → the full match

test('road: stagePlan builds each set up from the node\'s stars (PROGRESSIVE_FIELD §2); the first set is all small', () => {
  assert.deepEqual(R.stagePlan(0), ['small', 'small', 'small', 'medium', 'medium']);
  assert.deepEqual(R.stagePlan(1), ['small', 'small', 'medium', 'medium', 'full']);
  assert.deepEqual(R.stagePlan(2), ['small', 'medium', 'medium', 'full', 'full']);
  assert.deepEqual(R.stagePlan(3), ['medium', 'full', 'full', 'full', 'full']);
  assert.deepEqual(R.stagePlan(0, { first: true, count: 3 }), ['small', 'small', 'small'], '#/play/first');
  assert.deepEqual(R.stagePlan(R.QUICK_STARS), R.stagePlan(1), "the quick 'Who's open?' set: the 1-star plan");
  // Out of range, or not a number: clamped (none reads as 0 stars).
  assert.deepEqual(R.stagePlan(7), R.stagePlan(3));
  assert.deepEqual(R.stagePlan(-2), R.stagePlan(0));
  assert.deepEqual(R.stagePlan(null), R.stagePlan(0));
  assert.deepEqual(R.stagePlan('x'), R.stagePlan(0));
  // Another length takes the plan's steps in proportion, so it still builds up.
  assert.deepEqual(R.stagePlan(0, { count: 3 }), ['small', 'small', 'medium']);
  assert.deepEqual(R.stagePlan(3, { count: 3 }), ['medium', 'full', 'full']);
  assert.deepEqual(R.stagePlan(1, { count: 10 }), ['small', 'small', 'small', 'small', 'medium', 'medium', 'medium', 'medium', 'full', 'full']);
  assert.deepEqual(R.stagePlan(2, { count: 0 }), []);
  for (let s = 0; s <= 3; s++) {
    const p = R.stagePlan(s, { count: 8 });
    assert.ok(p.every((x, i) => i === 0 || R.STAGES.indexOf(x) >= R.STAGES.indexOf(p[i - 1])), `${s} stars: it only grows`);
  }
  assert.deepEqual([...R.STAGES], ['small', 'medium', 'full']);
});

test('road: a rep plays its planned stage, else the next bigger one it can (as cast.js bestStage)', () => {
  assert.equal(R.stageFor({ small: true, medium: true }, 'small'), 'small');
  assert.equal(R.stageFor({ small: false, medium: true }, 'small'), 'medium');
  assert.equal(R.stageFor({ small: false, medium: false }, 'small'), 'full');
  assert.equal(R.stageFor({ small: true, medium: false }, 'medium'), 'full', 'never smaller than planned');
  assert.equal(R.stageFor(null, 'small'), 'small', 'unknown: as planned');
  assert.equal(R.stageFor({ small: false }, 'full'), 'full');
  assert.equal(R.stageFor({}, 'huge'), 'full');
  assert.equal(R.stagePromotion({ small: false, medium: false }, 'small'), 2);
  assert.equal(R.stagePromotion({ small: false, medium: true }, 'medium'), 0);
  assert.equal(R.stagePromotion(null, 'x'), 0);
  const t = R.stageTally([{ stage: 'small', played: 'small' }, { stage: 'small', played: 'medium' }, { stage: 'medium', played: 'medium' }, { stage: 'full' }]);
  assert.deepEqual(t, { small: { wanted: 2, played: 1 }, medium: { wanted: 1, played: 1 }, full: { wanted: 1, played: 1 } });
});

test('road: assignStages plays the most reps at their planned stage, builds up, and keeps the built order when nothing is gained', () => {
  const S = { small: true, medium: true }, M = { small: false, medium: true }, F = { small: false, medium: false };
  const plan0 = R.stagePlan(0);
  // Nothing known (or everything fits): the order is kept (the recall rep stays first).
  assert.deepEqual(R.assignStages([null, null, null, null, null], plan0), [0, 1, 2, 3, 4]);
  assert.deepEqual(R.assignStages([S, S, S, S, S], plan0), [0, 1, 2, 3, 4]);
  // Two reps that cannot be played small move to the bigger-game slots; the small ones come forward in order.
  assert.deepEqual(R.assignStages([M, S, M, S, S], plan0), [1, 3, 4, 0, 2]);
  // A rep that can only be played in the full match goes last, never first: the set builds up.
  const order = R.assignStages([F, S, S, M, M], plan0);
  assert.deepEqual(order, [1, 2, 3, 4, 0]);
  const played = order.map((i, j) => R.stageFor([F, S, S, M, M][i], plan0[j]));
  assert.deepEqual(played, ['small', 'small', 'medium', 'medium', 'full']);
  // The 3-star plan needs one bigger game: a rep that can play it goes first.
  assert.deepEqual(R.assignStages([F, F, M, F, F], R.stagePlan(3)), [2, 0, 1, 3, 4]);
  // A long set: slot by slot, the first rep left that needs the fewest steps up.
  const long = R.assignStages([M, M, S, S, S, S, M, M, S, S], R.stagePlan(0, { count: 10 }));
  assert.deepEqual([...long].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(long.slice(0, 6), [2, 3, 4, 5, 8, 9], 'the small reps first');
  assert.deepEqual(R.assignStages([], []), []);
});

test('road: buildSet tags every rep with its slot\'s stage and puts the reps that can be played small in the small slots', async () => {
  // A stand-in stager: generated reps from even seeds can be played small, odd ones only in the bigger game.
  const small = (rep) => Number(String(rep.scenario?.id ?? rep.drill?.id).split('-').at(-1)) % 2 === 0;
  const stager = (rep) => ({ small: small(rep), medium: true });
  const profile = R.pickGroup(null, 'MID');
  const reps = await R.buildSet('free-player', { road, profile, index, load, seed: 4, generators: { pass: passStub(), forwardable: () => true }, stager });
  assert.deepEqual(reps.map((r) => r.stage), R.stagePlan(0));
  assert.ok(reps.slice(0, 3).every(small), `the small slots hold reps that can be played small (${ids(reps)})`);
  // Played at 3 stars: the 3-star plan.
  const later = await R.buildSet('free-player', { road, profile: withStars('MID', { 'free-player': 3 }), index, load, seed: 4, generators: { pass: passStub(), forwardable: () => true }, stager });
  assert.deepEqual(later.map((r) => r.stage), R.stagePlan(3));
  // The quick set: the 1-star plan; the onboarding set: all small.
  const quick = await R.buildQuickPassSet({ road, profile, seed: 2, generators: { pass: passStub(), forwardable: () => true }, stager });
  assert.deepEqual(quick.map((r) => r.stage), R.stagePlan(1));
  const first = await R.buildFirstSet({ road, profile, index, load, seed: 1, generators: null, stager: null });
  assert.deepEqual(first.map((r) => r.stage), ['small', 'small', 'small']);
  // No stager and no formations: the stages are still tagged, the order is the builder's.
  const plain = await R.buildSet('back-up', { road, profile: withStars('DEF', { 'close-down': 1 }), index, load, seed: 3, generators: null });
  assert.deepEqual(plain.map((r) => r.stage), R.stagePlan(0));
  assert.equal(plain[0].recall, true, 'the recall rep stays first');
});

test('road: while a set is short of reps that can be played small, the builder looks at a few more drills (and no more)', async () => {
  // Only seeds divisible by 5 give a drill that can be played small: the builder asks for more seeds, within its budget.
  const calls = [];
  const gen = passStub(calls);
  const stager = (rep) => ({ small: Number(String(rep.drill.id).split('-').at(-1)) % 5 === 0, medium: true });
  const plain = [];
  await R.buildSet('free-player', { road, profile: R.pickGroup(null, 'MID'), index, load, seed: 4, generators: { pass: passStub(plain), forwardable: () => true } });
  await R.buildSet('free-player', { road, profile: R.pickGroup(null, 'MID'), index, load, seed: 4, generators: { pass: gen, forwardable: () => true }, stager });
  assert.ok(calls.length > plain.length, `more drills looked at (${calls.length} calls, ${plain.length} without the plan)`);
  assert.ok(calls.length <= plain.length + R.ROAD_DEFAULTS.stageBudget, `at most stageBudget more (${calls.length})`);
  // Everything already fits: not one call more.
  const fits = [];
  await R.buildSet('free-player', { road, profile: R.pickGroup(null, 'MID'), index, load, seed: 4, generators: { pass: passStub(fits), forwardable: () => true }, stager: () => ({ small: true, medium: true }) });
  assert.equal(fits.length, plain.length);
});

test('road: with the real engine, buildSet stages each rep once and the screens reuse it (stagedRep)', async () => {
  const [{ createFormation }, cast] = await Promise.all([import('../js/engine/formation.js'), import('../js/engine/cast.js')]);
  const F = createFormation(await loadJSON('data/formations/helios-433.json'));
  const formations = { us: F, them: F };
  const reps = await R.buildSet('back-up', { road, profile: withStars('DEF', { 'close-down': 1 }), index, load, seed: 3, formations, catalogue: principlesFile, generators: null });
  assert.deepEqual([...R.STAGES], [...cast.STAGES], 'road.js keeps cast.js stages');
  for (const r of reps) {
    const staged = R.stagedRep(r, r.stage, { formations });
    assert.ok(staged && R.STAGES.indexOf(staged.stage) >= R.STAGES.indexOf(r.stage), `${r.scenario.id}: staged at ${r.stage} or bigger`);
    const fresh = cast.bestStage(r, r.stage, { formations, principles: principlesFile });
    assert.equal(staged.stage, fresh.stage, `${r.scenario.id}: as bestStage stages it`);
    assert.deepEqual(staged.cast.ids, fresh.cast.ids);
    assert.equal(staged.wanted, r.stage);
  }
  assert.ok(reps.slice(0, 3).some((r) => R.stagedRep(r, r.stage, { formations }).stage === 'small'), 'a small game among the first reps');
  assert.equal(R.stagedRep(reps[0], 'small', { formations: { us: F } }), null, 'other formations: not reused');
  assert.equal(R.stagedRep({ kind: 'spot', scenario: {} }, 'small'), null, 'never staged: null');
});
