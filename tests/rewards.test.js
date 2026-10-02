// js/rewards.js: stars, XP, levels, badges, sticker cards, the kit and days played this week (KID_REDESIGN §6.3).
import { test, assert } from './harness.js';
import {
  REWARDS_DEFAULTS, LEVEL_XP, KIT_PALETTES, BADGES, BADGES_BY_ID, NICKNAMES, STAR_WORDS, GRADE_FLOOR, createRewards, normalizeRewards, applyEvent,
  levelFor, starsFor, starsForScore, wordForStars, repStars, baseScenarioId, setKit, kitOptions, badgeProgress, cleanNickname,
  pickNickname, cardTier, weekStart, weekDaysPlayed, stickerReps, stickerReady,
} from '../js/rewards.js';
import { award, loadRewards, mergeGains, emptyGains, earnsRewards } from '../js/ui/rewards-store.js';
import { appendHistory, loadSkills, saveSkills } from '../js/ui/session.js';
import { update as eloUpdate, mastery } from '../js/engine/elo.js';
import { GRADE_BANDS } from '../js/engine/score.js';

const DAY = '2026-09-27';
/** A rep as Player mode sends it: the score (its stars follow it). */
const rep = (score, scenarioId = 'm1-01-d1-lcm', role = 'LCB') => ({ type: 'rep', scenarioId, role, score });
/** A rep as Coach mode sends it: its grade and its score. */
const coachRep = (grade, score, scenarioId = 'm1-01-d1-lcm', role = 'LCB') => ({ type: 'rep', scenarioId, role, grade, score });
/** Apply a list of events in order; returns { state, gains }. */
function play(events, state = createRewards(), day = DAY) {
  const gains = [];
  for (const e of events) { const r = applyEvent(state, e, { day }); state = r.state; gains.push(r.gained); }
  return { state, gains };
}

test('rewards: stars follow the score (3 at 90, 2 at 75, 1 at 55), with one word each and never a grade', () => {
  assert.deepEqual([0, 54, 55, 74, 75, 89, 90, 100].map((s) => starsForScore(s)), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual(REWARDS_DEFAULTS.starAt, [55, 75, 90]);
  assert.equal(starsForScore('x'), 0);
  assert.equal(starsForScore(null), 0);
  assert.equal(starsForScore(80, { starAt: [50, 60, 80] }), 3, 'the thresholds are parameters');
  assert.deepEqual([0, 1, 2, 3].map(wordForStars), ['Not yet', 'Close', 'Great', 'Spot on']);
  assert.deepEqual(STAR_WORDS, ['Not yet', 'Close', 'Great', 'Spot on']);
  assert.equal(wordForStars(7), 'Spot on');
  assert.equal(wordForStars(-1), 'Not yet');
  assert.equal(wordForStars('junk'), 'Not yet');
  assert.deepEqual(['S', 'A', 'B', 'C', 'D', 'F'].map(starsFor), [3, 2, 1, 0, 0, 0], 'Coach mode grades, for events without a score');
});

test('rewards: a rep\'s stars are the ones it showed, else its score\'s, else its grade\'s', () => {
  assert.equal(repStars({ score: 77 }), 2);
  assert.equal(repStars({ score: 77, grade: 'B' }), 2, 'a Coach rep with a score: the score decides, as in Player mode');
  assert.equal(repStars({ grade: 'A' }), 2, 'a grade alone still works');
  assert.equal(repStars({ score: 40, stars: 1 }), 1, 'the stars the caller showed win');
  assert.equal(repStars({ score: 95, stars: 7 }), 3, 'bad stars are ignored');
  assert.equal(repStars({}), 0);
  const { state } = play([rep(62, 'm1-02-d3-lcb'), coachRep('A', 84, 'm1-02-d3-lcb-m')]);
  assert.deepEqual(Object.keys(state.best), ['m1-02-d3-lcb'], 'a mirrored drill shares its original\'s record');
  assert.equal(baseScenarioId('m1-02-d3-lcb-m'), 'm1-02-d3-lcb');
  assert.deepEqual(state.best['m1-02-d3-lcb'], { score: 84, stars: 2, low: 62, grade: 'A' });
});

test('rewards: XP comes from stars and improvement only (R28), never from taking part', () => {
  const X = REWARDS_DEFAULTS;
  assert.deepEqual(X.starXp, [0, 10, 20, 30]);
  const { gains, state } = play([rep(30, 'a'), rep(60, 'b'), rep(80, 'c'), rep(95, 'd'), rep(96, 'd')]);
  assert.equal(gains[0].xp, 0, 'no stars, no XP: not for the attempt');
  assert.deepEqual(gains[0].badges, [], 'and no badge for a first play (R28: nothing for taking part)');
  assert.equal(gains[1].xp, X.starXp[1]);
  assert.equal(gains[2].xp, X.starXp[2]);
  assert.equal(gains[3].xp, X.starXp[3] + X.firstThreeStarXp + BADGES_BY_ID['first-s'].xp, '3 stars, the first 3 stars on it, and the first-3-stars badge');
  assert.equal(gains[4].xp, X.starXp[3], 'the first-3-stars bonus is paid once per drill');
  assert.equal(state.xp, gains.reduce((a, g) => a + g.xp, 0));
  // Improving on a drill by improveMin points or more.
  const again = play([rep(40, 'x'), rep(60, 'x'), rep(62, 'x')]);
  assert.equal(again.gains[1].improved, true);
  assert.equal(again.gains[1].xp, X.starXp[1] + X.improveXp);
  assert.equal(again.gains[2].improved, false, '+2 is not an improvement');
  // Finishing a session, the tutorial and a Live run earn nothing by themselves.
  const none = play([{ type: 'session', stars: [0, 0, 1] }, { type: 'tutorial-complete' }, { type: 'live', average: 20 }]);
  assert.deepEqual(none.gains.map((g) => g.xp), [0, 0, 0]);
  assert.deepEqual(Object.keys(none.state.badges), [], 'the tutorial and a weak run earn nothing, not even a badge (R28)');
  // A Live run (Match day) earns by its stars alone: there is no badge for finishing or starring in one.
  assert.deepEqual([40, 60, 80, 95].map((average) => play([{ type: 'live', average }]).gains[0].xp), X.liveStarXp);
  // Days on their own never earn: five training days with 0-star plays, no XP and no badge.
  const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];
  let s = createRewards();
  for (const day of days) s = applyEvent(s, rep(10, day), { day }).state;
  assert.equal(s.xp, 0);
  assert.deepEqual(Object.keys(s.badges), [], 'showing up on days earns no badge (the Regular badge is gone)');
});

test('rewards: every badge is for a skill: no badge for a first play or for finishing a Live run (R28)', () => {
  const zero = play([rep(10, 'a'), { type: 'live', average: 10 }, { type: 'session', stars: [0, 0, 0] }]);
  assert.deepEqual(Object.keys(zero.state.badges), [], 'taking part earns nothing');
  // Five badges, every one earned by stars (the 2026-10-01 audit cut the attendance, rank and restatement badges).
  assert.deepEqual(BADGES.map((b) => b.id), ['first-s', 'hat-trick', 'perfect-session', 'all-rounder', 'collector']);
  for (const b of BADGES) assert.doesNotMatch(`${b.name.kid} ${b.description.kid}`, /\b(?:finish|first play|boots|days?|rank|level)\b/i, `${b.id}: "${b.description.kid}"`);
});

test('rewards: level 2 comes within the first set, later levels cost more, kits unlock', () => {
  assert.deepEqual([...LEVEL_XP.slice(0, 5)], [0, 50, 250, 700, 1600], 'the retuned pace [D] (rewards.js)');
  assert.equal(levelFor(0).level, 1);
  const steps = LEVEL_XP.slice(1).map((x, i) => x - LEVEL_XP[i]);
  assert.ok(steps.every((d, i) => d > 0 && (i === 0 || d >= steps[i - 1])), `each level costs at least as much as the last: ${steps}`);
  // Five one-star plays (a weak first set) reach level 2; five 0-star plays do not.
  const weak = play(['a', 'b', 'c', 'd', 'e'].map((id) => rep(60, id)));
  assert.equal(levelFor(weak.state.xp).level, 2, `five 1-star plays: ${weak.state.xp} XP`);
  assert.ok(weak.gains.some((g) => g.levelUp?.to === 2));
  assert.equal(levelFor(play(['a', 'b', 'c', 'd', 'e'].map((id) => rep(20, id))).state.xp).level, 1);
  assert.ok(levelFor(play(['a', 'b'].map((id) => rep(95, id))).state.xp).level >= 2, 'two 3-star plays');
  assert.equal(levelFor(LEVEL_XP[2]).level, 3);
  assert.ok(LEVEL_XP[10] >= 100 * REWARDS_DEFAULTS.starXp[2], 'the top levels take many sets, not a few days');
  const beyond = levelFor(LEVEL_XP.at(-1) + 1);
  assert.equal(beyond.level, LEVEL_XP.length);
  assert.ok(levelFor(LEVEL_XP.at(-1) + 10000).level > LEVEL_XP.length, 'levels go on past the table');
  const l = levelFor((LEVEL_XP[2] + LEVEL_XP[3]) / 2);
  assert.ok(l.progress > 0 && l.progress < 1);
  // The first level-up unlocks the level-2 kit.
  const { gains, state } = play([rep(99, 'a'), rep(92, 'b')]);
  const up = gains.find((g) => g.levelUp)?.levelUp;
  assert.ok(up, 'levelled up');
  assert.ok(up.unlocks.includes('sky'));
  assert.ok(kitOptions(state).find((p) => p.id === 'sky').unlocked);
  assert.equal(kitOptions(createRewards()).find((p) => p.id === 'sky').unlocked, false);
});

test('rewards: badge conditions (in stars)', () => {
  const earned = (events) => Object.keys(play(events).state.badges);
  assert.ok(earned([rep(92)]).includes('first-s'));
  assert.ok(!earned([rep(89)]).includes('first-s'), '2 stars is not 3');
  assert.ok(earned([rep(92), rep(93, 'a'), rep(91, 'b')]).includes('hat-trick'));
  assert.ok(!earned([rep(92), rep(88, 'a'), rep(91, 'b')]).includes('hat-trick'), '2 stars breaks the 3-star run');
  const roles = ['LCB', 'LB', 'DM', 'RCM', 'LW', 'ST'];
  assert.ok(earned(roles.map((r, i) => rep(60, `s${i}`, r))).includes('all-rounder'), 'a star in every kind of position');
  assert.ok(!earned(roles.map((r, i) => rep(i === 5 ? 30 : 60, `s${i}`, r))).includes('all-rounder'), 'just playing a position is not enough');
  assert.ok(earned([{ type: 'session', stars: [1, 2, 3, 1, 2] }]).includes('perfect-session'));
  assert.ok(earned([{ type: 'session', grades: ['A', 'B', 'S', 'B', 'A', 'B'] }]).includes('perfect-session'), 'Coach mode sends grades');
  assert.ok(earned([{ type: 'session', scores: [60, 80, 95] }]).includes('perfect-session'));
  assert.ok(!earned([{ type: 'session', stars: [2, 0, 3] }]).includes('perfect-session'));
  assert.ok(!earned([{ type: 'session', stars: [3, 3] }]).includes('perfect-session'), 'too short');
  assert.deepEqual(earned([{ type: 'tutorial-complete' }]), [], 'the tutorial earns no badge');
  assert.deepEqual(earned([{ type: 'live', average: 95 }]), [], 'a Live run earns no badge');
  assert.deepEqual(earned(Array(5).fill({ type: 'explore-s' })), [], 'Explore earns no badge');
});

test('rewards: training days only add up (a missed day costs nothing)', () => {
  let state = createRewards();
  for (const day of ['2026-09-01', '2026-09-03', '2026-09-10', '2026-09-20']) state = applyEvent(state, rep(60, day), { day }).state;
  state = applyEvent(state, rep(60, 'z'), { day: '2026-10-02' }).state;
  assert.equal(Object.keys(state.days).length, 5, 'five distinct days, each kept');
  assert.ok(!('regular' in state.badges), 'and no badge for them: days are the week dots, not a prize');
});

test('rewards: days played this week count the Monday-to-Sunday week, only fill up, and start again on Monday', () => {
  assert.equal(weekStart('2026-09-27'), '2026-09-21', 'a Sunday belongs to the week that began on Monday');
  assert.equal(weekStart('2026-09-21'), '2026-09-21');
  assert.equal(weekStart('2026-09-28'), '2026-09-28');
  assert.equal(weekStart('2027-01-01'), '2026-12-28', 'across a new year');
  assert.equal(weekStart('2026-03-30'), '2026-03-30', 'across a clock change (dates, not times)');
  for (const bad of ['2026-02-31', 'yesterday', '', null, undefined, 20260927]) assert.equal(weekStart(bad), null, String(bad));
  let s = createRewards();
  assert.equal(weekDaysPlayed(s, '2026-09-23'), 0);
  const counts = [];
  for (const day of ['2026-09-21', '2026-09-21', '2026-09-23', '2026-09-26', '2026-09-27']) {
    s = applyEvent(s, rep(20, day), { day }).state; // even a 0-star play is a day played
    counts.push(weekDaysPlayed(s, day));
  }
  assert.deepEqual(counts, [1, 1, 2, 3, 4], 'one per day, never down within the week');
  assert.equal(weekDaysPlayed(s, '2026-09-24'), 4, 'the same week, whatever the day');
  assert.equal(weekDaysPlayed(s, '2026-09-28'), 0, 'Monday starts a new week: nothing to lose, nothing broken');
  s = applyEvent(s, { type: 'explore-s' }, { day: '2026-09-29' }).state;
  assert.equal(weekDaysPlayed(s, '2026-09-29'), 1, 'any training counts');
  assert.equal(weekDaysPlayed(s, 'junk'), 0);
  assert.equal(weekDaysPlayed(null, '2026-09-29'), 0);
  assert.equal(weekDaysPlayed({ days: { '2026-09-29': true, nonsense: true, '2026-09-30': false } }, '2026-09-29'), 1);
  const all = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`2026-10-${String(5 + i).padStart(2, '0')}`, true]));
  assert.equal(weekDaysPlayed({ days: all }, '2026-10-07'), 7, 'at most 7');
});

test('rewards: Explore XP is capped per day, but finds still count', () => {
  const { state, gains } = play(Array(8).fill({ type: 'explore-s' }));
  assert.equal(gains.filter((g) => g.xp >= REWARDS_DEFAULTS.exploreXp).length >= REWARDS_DEFAULTS.exploreXpPerDay, true);
  assert.equal(gains.at(-1).xp, 0, 'past the daily cap');
  const next = applyEvent(state, { type: 'explore-s' }, { day: '2026-09-28' });
  assert.equal(next.gained.xp, REWARDS_DEFAULTS.exploreXp, 'a new day resets the cap');
});

test('rewards: sticker cards upgrade bronze → silver → gold, never down', () => {
  let { state, gains } = play([{ type: 'mastery', principleId: 'D3', stars: 1 }, { type: 'mastery', principleId: 'D3', stars: 3 }, { type: 'mastery', principleId: 'D3', stars: 2 }]);
  assert.deepEqual(gains.map((g) => g.cards.length), [1, 1, 0]);
  assert.equal(gains[1].cards[0].upgrade, true);
  assert.equal(gains[0].xp, REWARDS_DEFAULTS.cardXp, 'a sticker card earns XP');
  assert.equal(cardTier(state, 'D3'), 3);
  ({ state } = play(['D1', 'D2', 'D4', 'D5', 'U1', 'U2', 'U3', 'U4', 'B1'].map((principleId) => ({ type: 'mastery', principleId, stars: 1 })), state));
  assert.ok(state.badges.collector, '10 cards');
});

test('rewards: immutable updates and determinism', () => {
  const s0 = createRewards();
  const snapshot = JSON.stringify(s0);
  const a = applyEvent(s0, rep(85), { day: DAY });
  const b = applyEvent(s0, rep(85), { day: DAY });
  assert.equal(JSON.stringify(s0), snapshot, 'input not mutated');
  assert.deepEqual(a, b);
  assert.deepEqual(applyEvent(s0, { type: 'nonsense' }).gained.xp, 0);
});

test('rewards: normalizeRewards survives junk, keeps valid data and reads records from before stars followed scores', () => {
  assert.deepEqual(normalizeRewards(null), createRewards());
  assert.deepEqual(normalizeRewards('x'), createRewards());
  const s = normalizeRewards({
    xp: '350', best: { a: { score: 90, grade: 'S' }, b: { grade: 'Z' }, c: { score: 64 }, d: { score: 'lots' }, old: { score: 84, grade: 'A', stars: 2, worst: 'D' } },
    badges: { 'first-s': {}, fake: {} }, cards: { D3: { tier: 2 }, D1: { tier: 0 } }, counters: { reps: 'lots' }, families: { CB: true, XX: true },
    days: { '2026-09-27': true, yesterday: true }, kit: { palette: 'legend', number: 200, nickname: '<b>Leo</b>!!' },
  });
  assert.equal(s.xp, 350);
  assert.deepEqual(Object.keys(s.best), ['a', 'c', 'old']);
  assert.deepEqual(s.best.a, { score: 90, stars: 3, low: 90, grade: 'S' });
  assert.deepEqual(s.best.c, { score: 64, stars: 1, low: 64 }, 'a Player-mode record has no grade');
  assert.deepEqual(s.best.old, { score: 84, stars: 2, low: 50, grade: 'A' }, 'the worst grade becomes the lowest score');
  assert.deepEqual(Object.keys(s.badges), ['first-s']);
  // Badges the 2026-10-01 audit cut (ranks, attendance, Live, Explore, gold) are unknown ids now and drop away.
  const old = normalizeRewards({ version: 2, badges: { 'first-rep': { day: '2026-09-20' }, regular: {}, captain: {}, 'first-s': {} } });
  assert.deepEqual(Object.keys(old.badges), ['first-s']);
  assert.deepEqual(normalizeRewards(old), old, 'stable on a round trip');
  assert.deepEqual(Object.keys(s.cards), ['D3']);
  assert.equal(s.counters.reps, 0);
  assert.deepEqual(Object.keys(s.families), ['CB']);
  assert.deepEqual(Object.keys(s.days), ['2026-09-27']);
  assert.equal(s.kit.palette, 'classic', 'locked palette refused');
  assert.equal(s.kit.number, null);
  assert.equal(s.kit.nickname, '', 'a typed name is not a nickname from the list');
  assert.equal(normalizeRewards({ kit: { nickname: 'rocket' } }).kit.nickname, 'Rocket');
  assert.equal(normalizeRewards(normalizeRewards({ best: { a: { score: 70, grade: 'B' } } })).best.a.stars, 1, 'stable on a round trip');
  assert.deepEqual(GRADE_FLOOR, { ...Object.fromEntries(GRADE_BANDS), F: 0 }, 'the grade floors are js/engine/score.js GRADE_BANDS');
});

test('rewards: nicknames come from a pick-list of about 30 football nicknames', () => {
  assert.ok(NICKNAMES.length >= 25 && NICKNAMES.length <= 40, `${NICKNAMES.length} nicknames`);
  assert.equal(new Set(NICKNAMES.map((n) => n.toLowerCase())).size, NICKNAMES.length, 'no repeats');
  for (const n of ['Rocket', 'The Wall', 'Maestro', 'Flash']) assert.ok(NICKNAMES.includes(n), n);
  for (const n of NICKNAMES) {
    assert.equal(cleanNickname(n), n, `${n} is already clean`);
    assert.ok(n.length <= REWARDS_DEFAULTS.nicknameMax, `${n} fits the tag over YOU`);
    assert.equal(pickNickname(n.toUpperCase()), n);
  }
  assert.equal(pickNickname('Mia'), '');
  assert.equal(pickNickname('  the   wall '), 'The Wall');
  assert.equal(pickNickname(null), '');
});

test('rewards: kit changes respect unlocks and take nicknames from the list only', () => {
  let s = createRewards();
  assert.equal(setKit(s, { palette: 'gold' }).kit.palette, 'classic', 'gold is locked at level 1');
  s = { ...s, xp: LEVEL_XP[9] };
  const kit = setKit(s, { palette: 'gold', number: 10, nickname: 'maestro' }).kit;
  assert.deepEqual(kit, { palette: 'gold', number: 10, nickname: 'Maestro' });
  assert.equal(setKit(s, { number: 10 }).kit.number, 10);
  assert.equal(setKit(s, { number: 0 }).kit.number, null);
  assert.equal(setKit(s, { nickname: 'Mia' }).kit.nickname, '', 'a real name is refused');
  assert.equal(setKit(setKit(s, { nickname: 'Rocket' }), { number: 7 }).kit.nickname, 'Rocket', 'kept when other things change');
  assert.equal(cleanNickname('José Luis-O\'Neil the Third'), 'José Luis');
  assert.equal(cleanNickname('a<script>'), 'ascript');
});

test('rewards: badge progress for the trophy room', () => {
  const { state } = play([rep(72, 'a'), rep(72, 'b'), rep(95, 'c')]);
  const p = Object.fromEntries(badgeProgress(state).map((b) => [b.id, b]));
  assert.equal(p['first-s'].earned, true);
  assert.deepEqual([p['hat-trick'].earned, p['hat-trick'].current, p['hat-trick'].goal], [false, 1, 3], 'Hat-trick: 1 of 3');
  assert.ok(Math.abs(p['hat-trick'].progress - 1 / 3) < 1e-9);
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

// ---------------------------------------------------------------- stickers mean mastery; only Player mode earns

/** An app with an in-memory store, in Player mode unless told otherwise (js/ui/rewards-store.js award). */
function memApp(mode = 'player') {
  const mem = new Map();
  return {
    settings: { mode },
    store: { get: (k, fallback) => (mem.has(k) ? JSON.parse(mem.get(k)) : fallback), set: (k, v) => { mem.set(k, JSON.stringify(v)); return true; } },
  };
}
const played = (stars, principles = ['PA8'], extra = {}) => ({ mode: 'pass', principles, score: [40, 62, 82, 95][stars], ...extra });

test('rewards: a sticker card needs the idea\'s recent plays to average 2 stars (stickerReps, stickerReady)', () => {
  const P = REWARDS_DEFAULTS;
  assert.deepEqual([P.stickerWindow, P.stickerMinReps, P.stickerStars], [5, 3, 2]);
  // Ten passes on "Lead the Runner" at about 1 star: plenty of Elo credit, no sticker.
  const weak = Array.from({ length: 10 }, (_, i) => played(i % 5 === 0 ? 0 : 1));
  assert.equal(stickerReady(weak, 'PA8'), false);
  assert.deepEqual(stickerReps(weak, 'PA8'), [0, 1, 1, 1, 1], 'the last five, oldest first');
  const good = [...weak, played(3), played(2), played(2), played(3), played(2)];
  assert.equal(stickerReady(good, 'PA8'), true, 'the last five average 2.4');
  assert.equal(stickerReady([played(3), played(3)], 'PA8'), false, 'two plays are not enough');
  assert.equal(stickerReady([played(3), played(3), played(1)], 'PA8'), true, '7 stars in 3 plays');
  // What counts: Player-mode plays of the idea with no help; a play's own stars win over its score.
  const mixed = [
    played(3, ['PA8'], { aid: 'glow' }), // a helped play
    { mode: 'drill', principles: ['PA8'], score: 95 }, // a Coach-mode drill
    { mode: 'live', principles: ['PA8'], score: 95 }, // a Match day run
    played(3, ['PA3']), // another idea
    { mode: 'drill', via: 'play', principles: ['D1', 'PA8'], score: 95 }, // a "Find your spot" play listing it
    played(0, ['PA8'], { stars: 2 }), // the stars it showed
    null, 'junk',
  ];
  assert.deepEqual(stickerReps(mixed, 'PA8'), [3, 2]);
  assert.deepEqual(stickerReps(null, 'PA8'), []);
  assert.deepEqual(stickerReps(mixed, ''), []);
});

test('rewards: award() gives a sticker only when the recent plays show mastery; the callers do not change', () => {
  const app = memApp();
  for (const s of [1, 1, 0, 1, 1, 1, 1, 0, 1, 1]) appendHistory(app.store, played(s));
  const no = award(app, { type: 'mastery', principleId: 'PA8', stars: 1 }, { celebrate: false });
  assert.deepEqual(no.cards, [], '10 plays at 0.8 stars: no sticker');
  assert.equal(no.xp, 0);
  assert.equal(cardTier(loadRewards(app), 'PA8'), 0);
  for (const s of [3, 2, 3]) appendHistory(app.store, played(s));
  const yes = award(app, { type: 'mastery', principleId: 'PA8', stars: 2 }, { celebrate: false });
  assert.deepEqual(yes.cards, [{ id: 'PA8', tier: 2, upgrade: false }], 'the last five average 2: a silver sticker');
  assert.equal(yes.xp, REWARDS_DEFAULTS.cardXp);
  // An upgrade waits the same way.
  for (const s of [0, 0, 1]) appendHistory(app.store, played(s));
  assert.deepEqual(award(app, { type: 'mastery', principleId: 'PA8', stars: 3 }, { celebrate: false }).cards, [], 'slipped back: no gold yet');
  assert.equal(cardTier(loadRewards(app), 'PA8'), 2, 'and nothing taken away');
  // Other events are not gated.
  assert.equal(award(app, { type: 'rep', scenarioId: 'gen-PA8-W', role: 'LW', score: 95, stars: 3 }, { celebrate: false }).stars, 3);
});

test('rewards: Coach mode never earns rewards (it shares the player\'s store); Player mode does', () => {
  const coach = memApp('coach');
  for (let i = 0; i < 5; i++) appendHistory(coach.store, played(3));
  assert.equal(earnsRewards(coach), false);
  assert.equal(earnsRewards(memApp()), true);
  assert.equal(earnsRewards({}), true, 'no settings: Player mode, the default');
  for (const e of [
    { type: 'rep', scenarioId: 'm1-01-d1-lcm', role: 'LCM', grade: 'S', score: 95 },
    { type: 'mastery', principleId: 'PA8', stars: 3 },
    { type: 'session', grades: ['S', 'S', 'S'] },
    { type: 'live', average: 95 },
    { type: 'explore-s' },
    { type: 'tutorial-complete' },
  ]) {
    assert.deepEqual(award(coach, e), emptyGains(), `${e.type}: nothing earned`);
  }
  assert.deepEqual(coach.store.get('rewards', null), null, 'nothing saved: the player\'s card is untouched');
  const player = memApp();
  assert.equal(award(player, { type: 'rep', scenarioId: 'a', role: 'LCM', score: 95 }, { celebrate: false }).xp > 0, true);
});

test('rewards: the pace: a weak first set reaches level 2, a strong first session ends at level 3, six strong sets stay below First Team', () => {
  // Sets played as Player mode records them (play.js / pass.js): the history, the Elo (not on helped plays), the
  // rep, then a sticker for each idea whose Elo mastery passes its card (award() gates it on the history).
  const SCORE = [40, 62, 82, 95];
  function playSets(sets, { first = 3 } = {}) {
    const app = memApp();
    const one = ({ id, principles, stars, aided = false, counts = true }) => {
      let skills = loadSkills(app.store);
      if (!aided) { skills = eloUpdate(skills, { itemId: id, principles, role: 'LW', score01: SCORE[stars] / 100 }); saveSkills(app.store, skills); }
      if (!counts) return;
      appendHistory(app.store, { mode: 'drill', via: 'play', id, principles, role: 'LW', score: SCORE[stars], aid: aided ? 'glow' : null });
      let g = award(app, { type: 'rep', scenarioId: id, role: 'LW', score: SCORE[stars], stars }, { celebrate: false });
      for (const p of principles) {
        const m = mastery(skills, p);
        if (m > cardTier(loadRewards(app), p)) g = mergeGains(g, award(app, { type: 'mastery', principleId: p, stars: m }, { celebrate: false }));
      }
    };
    // The kick-off set: a worked example and a helped play (taught: no XP), then one on your own.
    for (let i = 0; i < 3; i++) one({ id: `first-${i}`, principles: ['D1'], stars: first, aided: i < 2, counts: i === 2 });
    const ideas = [['D1', 'D2'], ['B3', 'B4'], ['B1', 'B2'], ['D3', 'D4'], ['P2', 'B5'], ['PA3', 'PA4']];
    sets.forEach((stars, k) => {
      const ps = ideas[k % ideas.length];
      stars.forEach((s, i) => one({ id: i < 2 ? `node${k}-${i}` : `gen-${ps[i % 2]}-W`, principles: [ps[i % 2], ps[(i + 1) % 2]], stars: s, aided: i < 2 }));
    });
    return levelFor(loadRewards(app).xp);
  }
  const strong = [3, 3, 2, 3, 3];
  assert.equal(playSets([[1, 1, 1, 1, 1]], { first: 1 }).level, 2, 'five 1-star plays: level 2');
  const firstSession = playSets([strong, strong]);
  assert.equal(firstSession.level, 3, `a strong first session: level 3 (${firstSession.xp} XP), never 4`);
  const six = playSets(Array(6).fill(strong));
  assert.ok(six.level < 5, `six strong sets: level ${six.level} (${six.xp} XP), below First Team`);
  assert.ok(six.level >= 3);
});
