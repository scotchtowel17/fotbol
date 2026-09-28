import { test, assert } from './harness.js';
import {
  REWARDS_DEFAULTS, LEVEL_XP, KIT_PALETTES, BADGES, createRewards, normalizeRewards, applyEvent, levelFor,
  starsFor, baseScenarioId, setKit, kitOptions, badgeProgress, cleanNickname, cardTier,
} from '../js/rewards.js';

const DAY = '2026-09-27';
const rep = (grade, score, scenarioId = 'm1-01-d1-lcm', role = 'LCB') => ({ type: 'rep', scenarioId, role, grade, score });
/** Apply a list of events in order; returns { state, gains }. */
function play(events, state = createRewards(), day = DAY) {
  const gains = [];
  for (const e of events) { const r = applyEvent(state, e, { day }); state = r.state; gains.push(r.gained); }
  return { state, gains };
}

test('rewards: stars follow grades and mirrored drills share a record', () => {
  assert.deepEqual(['S', 'A', 'B', 'C', 'D', 'F'].map(starsFor), [3, 2, 1, 0, 0, 0]);
  assert.equal(baseScenarioId('m1-02-d3-lcb-m'), 'm1-02-d3-lcb');
  const { state } = play([rep('C', 62, 'm1-02-d3-lcb'), rep('A', 84, 'm1-02-d3-lcb-m')]);
  assert.deepEqual(Object.keys(state.best), ['m1-02-d3-lcb']);
  assert.equal(state.best['m1-02-d3-lcb'].stars, 2);
});

test('rewards: every attempt earns XP; improving and a first 3 stars earn more', () => {
  const X = REWARDS_DEFAULTS;
  const { gains } = play([rep('F', 20), rep('C', 64), rep('S', 95), rep('S', 96)]);
  assert.ok(gains[0].xp >= X.xpByGrade.F, 'even an F earns something');
  assert.ok(gains[1].improved, '+44 counts as improving');
  assert.ok(gains[2].xp >= X.xpByGrade.S + X.improveXp + X.firstThreeStarXp);
  assert.equal(gains[3].improved, false, '+1 is not an improvement');
  assert.ok(gains[3].xp < gains[2].xp, 'the first 3 stars bonus is paid once');
  assert.equal(gains[2].stars, 3);
});

test('rewards: levels, ranks and kit unlocks', () => {
  assert.equal(levelFor(0).level, 1);
  assert.equal(levelFor(0).rank.id, 'rookie');
  assert.equal(levelFor(LEVEL_XP[2]).level, 3);
  assert.equal(levelFor(LEVEL_XP[2]).rank.id, 'academy');
  assert.equal(levelFor(LEVEL_XP.at(-1) + 4000).level, LEVEL_XP.length + 2);
  const l = levelFor(175);
  assert.ok(l.progress > 0 && l.progress < 1);
  // A big Live run from level 1 levels up and unlocks the level-2 kit.
  const { gains, state } = play([rep('S', 99), { type: 'live', average: 90 }]);
  const up = gains.find((g) => g.levelUp)?.levelUp;
  assert.ok(up, 'levelled up');
  assert.ok(up.unlocks.includes('sky'));
  assert.ok(kitOptions(state).find((p) => p.id === 'sky').unlocked);
  assert.equal(kitOptions(createRewards()).find((p) => p.id === 'sky').unlocked, false);
});

test('rewards: badge conditions', () => {
  const earned = (events) => Object.keys(play(events).state.badges);
  assert.ok(earned([rep('B', 72)]).includes('first-rep'));
  assert.ok(earned([rep('S', 92)]).includes('first-s'));
  assert.ok(earned([rep('S', 92), rep('S', 93, 'a'), rep('S', 91, 'b')]).includes('hat-trick'));
  assert.ok(!earned([rep('S', 92), rep('A', 88, 'a'), rep('S', 91, 'b')]).includes('hat-trick'), 'an A breaks the S run');
  assert.ok(earned(['a', 'b', 'c', 'd', 'e'].map((id) => rep('B', 75, id))).includes('on-a-roll'));
  assert.ok(earned([rep('D', 55, 'x'), rep('A', 85, 'x')]).includes('comeback'));
  assert.ok(!earned([rep('C', 65, 'x'), rep('A', 85, 'x')]).includes('comeback'), 'C is not a comeback start');
  const roles = ['LCB', 'LB', 'DM', 'RCM', 'LW', 'ST'];
  assert.ok(earned(roles.map((r, i) => rep('C', 60, `s${i}`, r))).includes('all-rounder'));
  assert.ok(earned([{ type: 'session', grades: ['A', 'B', 'S', 'B', 'A', 'B'] }]).includes('perfect-session'));
  assert.ok(!earned([{ type: 'session', grades: ['A', 'C', 'S'] }]).includes('perfect-session'));
  assert.ok(earned([{ type: 'live', average: 81 }]).includes('live-star'));
  assert.ok(!earned([{ type: 'live', average: 60 }]).includes('live-star'));
  assert.ok(earned([{ type: 'tutorial-complete' }]).includes('first-steps'));
  assert.ok(earned(Array(5).fill({ type: 'explore-s' })).includes('explorer'));
});

test('rewards: training days only add up (a missed day costs nothing)', () => {
  let state = createRewards();
  for (const day of ['2026-09-01', '2026-09-03', '2026-09-10', '2026-09-20']) state = applyEvent(state, rep('C', 60, day), { day }).state;
  assert.ok(!state.badges.regular);
  state = applyEvent(state, rep('C', 60, 'z'), { day: '2026-10-02' }).state;
  assert.ok(state.badges.regular, 'fifth distinct day');
});

test('rewards: Explore XP is capped per day, but finds still count', () => {
  const { state, gains } = play(Array(8).fill({ type: 'explore-s' }));
  assert.equal(gains.filter((g) => g.xp >= REWARDS_DEFAULTS.exploreXp).length >= REWARDS_DEFAULTS.exploreXpPerDay, true);
  assert.equal(gains.at(-1).xp, 0, 'past the daily cap');
  assert.equal(state.counters.exploreS, 8);
  const next = applyEvent(state, { type: 'explore-s' }, { day: '2026-09-28' });
  assert.equal(next.gained.xp, REWARDS_DEFAULTS.exploreXp, 'a new day resets the cap');
});

test('rewards: sticker cards upgrade bronze → silver → gold, never down', () => {
  let { state, gains } = play([{ type: 'mastery', principleId: 'D3', stars: 1 }, { type: 'mastery', principleId: 'D3', stars: 3 }, { type: 'mastery', principleId: 'D3', stars: 2 }]);
  assert.deepEqual(gains.map((g) => g.cards.length), [1, 1, 0]);
  assert.equal(gains[1].cards[0].upgrade, true);
  assert.equal(cardTier(state, 'D3'), 3);
  assert.ok(state.badges['gold-card']);
  ({ state } = play(['D1', 'D2', 'D4', 'D5', 'U1', 'U2', 'U3', 'U4', 'B1'].map((principleId) => ({ type: 'mastery', principleId, stars: 1 })), state));
  assert.ok(state.badges.collector, '10 cards');
});

test('rewards: immutable updates and determinism', () => {
  const s0 = createRewards();
  const snapshot = JSON.stringify(s0);
  const a = applyEvent(s0, rep('A', 85), { day: DAY });
  const b = applyEvent(s0, rep('A', 85), { day: DAY });
  assert.equal(JSON.stringify(s0), snapshot, 'input not mutated');
  assert.deepEqual(a, b);
  assert.deepEqual(applyEvent(s0, { type: 'nonsense' }).gained.xp, 0);
});

test('rewards: normalizeRewards survives junk and keeps valid data', () => {
  assert.deepEqual(normalizeRewards(null), createRewards());
  assert.deepEqual(normalizeRewards('x'), createRewards());
  const s = normalizeRewards({
    xp: '350', best: { a: { score: 90, grade: 'S' }, b: { grade: 'Z' } }, badges: { 'first-s': {}, fake: {} },
    cards: { D3: { tier: 2 }, D1: { tier: 0 } }, counters: { reps: 'lots' }, families: { CB: true, XX: true },
    days: { '2026-09-27': true, yesterday: true }, kit: { palette: 'legend', number: 200, nickname: '<b>Leo</b>!!' },
  });
  assert.equal(s.xp, 350);
  assert.deepEqual(Object.keys(s.best), ['a']);
  assert.deepEqual(Object.keys(s.badges), ['first-s']);
  assert.deepEqual(Object.keys(s.cards), ['D3']);
  assert.equal(s.counters.reps, 0);
  assert.deepEqual(Object.keys(s.families), ['CB']);
  assert.deepEqual(Object.keys(s.days), ['2026-09-27']);
  assert.equal(s.kit.palette, 'classic', 'locked palette refused');
  assert.equal(s.kit.number, null);
  assert.equal(s.kit.nickname, 'bLeob');
});

test('rewards: kit changes respect unlocks and clean nicknames', () => {
  let s = createRewards();
  assert.equal(setKit(s, { palette: 'gold' }).kit.palette, 'classic', 'gold is locked at level 1');
  s = { ...s, xp: LEVEL_XP[9] };
  assert.equal(setKit(s, { palette: 'gold', number: 10, nickname: '  Mia  ' }).kit.palette, 'gold');
  assert.equal(setKit(s, { number: 10 }).kit.number, 10);
  assert.equal(setKit(s, { number: 0 }).kit.number, null);
  assert.equal(cleanNickname('José Luis-O\'Neil the Third'), "José Luis");
  assert.equal(cleanNickname('a<script>'), 'ascript');
});

test('rewards: badge progress for the trophy room', () => {
  const { state } = play([rep('B', 72, 'a'), rep('B', 72, 'b'), rep('S', 95, 'c')]);
  const p = Object.fromEntries(badgeProgress(state).map((b) => [b.id, b]));
  assert.equal(p['first-rep'].earned, true);
  assert.equal(p['on-a-roll'].current, 3);
  assert.equal(p['on-a-roll'].goal, 5);
  assert.ok(Math.abs(p['on-a-roll'].progress - 0.6) < 1e-9);
  assert.equal(BADGES.length, badgeProgress(createRewards()).length);
});

// WCAG relative luminance and contrast, for the kit colour checks.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const THEM = '#27307c'; // css/app.css --kit-them

test('rewards: every kit stays colour-blind safe against the opponents and readable', () => {
  const levels = KIT_PALETTES.map((p) => p.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b), 'palettes unlock in order');
  assert.equal(KIT_PALETTES[0].level, 1);
  for (const p of KIT_PALETTES) {
    assert.ok(contrast(p.shirt, THEM) >= 7, `${p.id} shirt vs their kit: ${contrast(p.shirt, THEM).toFixed(1)}`);
    assert.ok(contrast(p.shirt, p.ink) >= 7, `${p.id} number ink: ${contrast(p.shirt, p.ink).toFixed(1)}`);
  }
});
