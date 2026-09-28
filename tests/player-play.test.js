// Player mode, the play area (docs/KID_REDESIGN.md §4.1 step 3, §4.3, §4.5, §4.6, §5): the pure parts of
// js/ui/player/strings.js, play.js, reveal.js, fulltime.js and matchday.js, and the Player-mode rules in
// js/ui/celebrate.js and js/ui/sound.js. No DOM: everything here runs under node --test and in tests.html.

import { test, assert, loadJSON, isNode } from './harness.js';
import { STRINGS as SHARED, STAR_WORDS, ROLE_NAMES, roleName, starWord, roleCard } from '../js/ui/player/strings.js';
import {
  STRINGS as PLAY, PLAY_DEFAULTS, usableText, starsForScore, wordForStars, questionFor, briefFor, takeawayFor, pickLine, whyFor,
  keyPlayers, firstSetStep, setStep, createTally, tallyTry, tallyStars, missNote, repTitle, seedFor, recordIdOf, recordPolicy,
  repCard, ideasOf, praiseOf, bestMoveOf, cueMarker, repScene, revealFor, bestSpotMarker, lockAction, redirectTo,
} from '../js/ui/player/play.js';
import { STRINGS as REVEAL, REVEAL_DEFAULTS, whyModel, revealWordCount, burstFor, createPlayerReveal } from '../js/ui/player/reveal.js';
import {
  STRINGS as FULLTIME, FULLTIME_DEFAULTS, sentenceCase, addToday, minutesOn, breakDue, fullTimeModel, earnedItems, bestMoveName, TODAY_KEY,
} from '../js/ui/player/fulltime.js';
import { STRINGS as MATCHDAY, MATCHDAY_DEFAULTS, heatFor, bestHotStreak, hardestMoment } from '../js/ui/player/matchday.js';
import { PLAYER_CELEBRATE, playerStarPlan, playerAckMs, createBurstBudget, playerMilestone } from '../js/ui/celebrate.js';
import { SOUND_NAMES } from '../js/ui/sound.js';
import { ROLES } from '../js/engine/roles.js';
import { normalizeScenario } from '../js/engine/scenario.js';
import { createFormation } from '../js/engine/formation.js';
import { SPOT_WORDS } from '../js/engine/spotdrill.js';
import { levelFor, LEVEL_XP } from '../js/rewards.js';
import * as Road from '../js/ui/player/road.js';

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

/** Every string in a STRINGS table (templates called with sample values), for the copy rules below. */
function allStrings(table) {
  const out = [];
  const visit = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') {
      const n = v.length;
      for (const args of n === 0 ? [[]] : n === 1 ? [[3], [1], ['left back']] : [[2, 5], [0, 3]]) {
        try { const r = v(...args); if (typeof r === 'string') out.push(r); } catch { /* not a template */ }
      }
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(table);
  return out;
}

/** A rough Flesch-Kincaid grade (vowel groups as syllables, a silent final e dropped). */
function fkGrade(text) {
  const ws = String(text).toLowerCase().match(/[a-z']+/g) ?? [];
  if (!ws.length) return 0;
  const sentences = Math.max(1, (String(text).match(/[.!?]+(\s|$)/g) ?? []).length);
  const syl = (w) => Math.max(1, (w.replace(/e$/, '').match(/[aeiouy]+/g) ?? []).length);
  const s = ws.reduce((a, w) => a + syl(w), 0);
  return 0.39 * (ws.length / sentences) + 11.8 * (s / ws.length) - 15.59;
}

const TABLES = { strings: SHARED, play: PLAY, reveal: REVEAL, fulltime: FULLTIME, matchday: MATCHDAY };
// Plain football words FK over-counts (the copy test has a similar allow-list).
const ALLOW = /\b(centre-back|midfielder|winger|striker|keeper|defender)\b/gi;

// ---------------------------------------------------------------- copy rules on every Player string this area owns

test('player play: every visible string is plain (no "kid", codes, grades, "/100", "!!!" or metres) and short', () => {
  for (const [name, table] of Object.entries(TABLES)) {
    for (const s of allStrings(table)) {
      assert.doesNotMatch(s, /\bkids?\b/i, `${name}: "${s}" says kid`);
      assert.doesNotMatch(s, /\b[A-Z]{1,2}\d{1,2}\b/, `${name}: "${s}" has a principle code`);
      assert.doesNotMatch(s, /\/\s?100|!!!/, `${name}: "${s}"`);
      assert.doesNotMatch(s, /\b\d+(\.\d+)?\s?m\b|\bmetres?\b/i, `${name}: "${s}" has metres`);
      assert.doesNotMatch(s, /\b(LCB|RCB|LB|RB|DM|LCM|RCM|LW|RW|ST|GK)\b/, `${name}: "${s}" has a role code`);
      assert.doesNotMatch(s, /\b(half-space|compact|goal-side|carrier|transition|principle|module|session|rep|zone|ghost|glow)\b/i, `${name}: "${s}" has jargon`);
      assert.ok(words(s) <= 14, `${name}: "${s}" is ${words(s)} words`);
      const plain = s.replace(ALLOW, 'player');
      if ((plain.match(/[a-z']+/gi) ?? []).length >= 4) assert.ok(fkGrade(plain) <= 4, `${name}: "${s}" reads at grade ${fkGrade(plain).toFixed(1)}`);
    }
  }
});

test('player play: the star words, role names and role card', () => {
  assert.deepEqual([...STAR_WORDS], ['Not yet', 'Close', 'Great', 'Spot on']);
  assert.equal(starWord(3), 'Spot on');
  assert.equal(starWord(0), 'Not yet');
  assert.equal(starWord(9), 'Spot on', 'clamped');
  assert.equal(starWord('x'), 'Not yet');
  for (const r of ROLES) assert.ok(ROLE_NAMES[r], `${r} has a plain name`);
  assert.equal(roleName('LB'), 'left back');
  assert.equal(roleName('nope'), 'player');
  assert.deepEqual(roleCard('LB', 'LB'), { text: "You're the left back", changed: false });
  assert.deepEqual(roleCard('ST', 'LB'), { text: "Now you're the striker", changed: true });
  assert.deepEqual(roleCard('RB', null), { text: "You're the right back", changed: false }, 'no profile yet: never "Now"');
  assert.ok(words(roleCard('DM', 'LB').text) <= 8);
});

// ---------------------------------------------------------------- stars, words, the question and the line

test('player play: stars come from the score (3 at 90, 2 at 75, 1 at 55), with one word each', () => {
  const cases = [[100, 3], [90, 3], [89, 2], [75, 2], [74, 1], [55, 1], [54, 0], [0, 0], [NaN, 0]];
  for (const [score, stars] of cases) assert.equal(starsForScore(score), stars, `${score}`);
  assert.deepEqual([0, 1, 2, 3].map(wordForStars), ['Not yet', 'Close', 'Great', 'Spot on']);
  assert.deepEqual([...PLAY_DEFAULTS.starsAt], [55, 75, 90]);
});

test('player play: Player text never shows metres, codes, grades or "/100"', () => {
  assert.equal(usableText('Get between your striker and our goal.'), true);
  assert.equal(usableText('Move 5 m forward, past their midfielders.'), false, 'metres');
  assert.equal(usableText('Stand 3m wider.'), false);
  assert.equal(usableText('Their #9 is yours.'), false, 'a shirt code');
  assert.equal(usableText('Cover like D3 says.'), false, 'a principle code');
  assert.equal(usableText('You got an F.'), false, 'a grade');
  assert.equal(usableText('A score of 90/100.'), false);
  assert.equal(usableText(''), false);
  assert.equal(usableText('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen'), false, 'too long');
});

test('player play: the question and the brief are the drill\'s simple ones when they fit (12 words), else a default', () => {
  assert.equal(questionFor({ questionKid: 'Your teammate is going to their winger. Where do you go?' }), 'Your teammate is going to their winger. Where do you go?');
  assert.equal(questionFor({ questionKid: 'Their #9 has the ball. Where?' }), PLAY.question);
  assert.equal(questionFor({}), PLAY.question);
  assert.equal(questionFor({ questionKid: 'a b c d e f g h i j k l m' }), PLAY.question, '13 words is too many');
  assert.ok(words(PLAY.question) <= 12);
  assert.equal(briefFor({ briefKid: 'Their midfielder is about to pass out wide.' }), 'Their midfielder is about to pass out wide.');
  assert.equal(briefFor({}), PLAY.watch);
});

test('player play: the reveal line is the top fix after a miss, the praise on a 3-star spot, 14 words at most', () => {
  const feedback = {
    reasons: [{ text: 'Move 7 m forward, past their midfielders.' }, { text: 'Get between their striker and our goal.' }],
    praise: ['Great, you are between your player and our goal.'],
  };
  assert.equal(pickLine({ feedback, stars: 1 }), 'Get between their striker and our goal.', 'the metres reason is skipped');
  assert.equal(pickLine({ feedback, stars: 1, misconception: "Don't chase the ball." }), "Don't chase the ball.", 'a miss you made names it');
  assert.equal(pickLine({ feedback, stars: 2, misconception: "Don't chase the ball." }), 'Get between their striker and our goal.', 'a near miss gets the fix');
  assert.equal(pickLine({ feedback, stars: 3 }), 'Great, you are between your player and our goal.');
  assert.equal(pickLine({ feedback: { reasons: [], praise: [] }, stars: 3 }), PLAY.lineBest);
  assert.equal(pickLine({ feedback: { reasons: [{ text: 'Step back 4 m, level with their last defender.' }] }, stars: 0 }), PLAY.lineFix);
  for (const s of [PLAY.lineBest, PLAY.lineFix, PLAY.missNote]) assert.ok(words(s) <= 14);
});

test('player play: the Why? sheet: the idea, its summary, 2 more reasons at most, what you did right, 60 words at most', () => {
  const principle = { id: 'D3', kidName: 'Back Up Your Buddy', summary: { kid: "Stand behind your teammate at a slant, ready if they're beaten." } };
  const why = whyFor({
    principle, line: 'Stand at an angle behind your teammate, not straight behind.',
    reasons: [{ text: 'Stand at an angle behind your teammate, not straight behind.' }, { text: 'Move closer to your teammate.' }, { text: 'Drop 5 m deeper.' }, { text: 'Stay in line with your other defenders.' }],
    praise: ['Good, you are in line with your other defenders.'],
  });
  assert.equal(why.title, 'Back Up Your Buddy');
  assert.match(why.summary, /slant/);
  assert.deepEqual(why.reasons, ['Move closer to your teammate.', 'Stay in line with your other defenders.'], 'not the line again, no metres');
  const m = whyModel(why);
  assert.ok(m.words <= REVEAL_DEFAULTS.whyMaxWords, `${m.words} words`);
  assert.ok(m.reasons.length <= 2 && m.praise.length <= 1);
  const long = whyModel({ title: 'Idea', summary: 'word '.repeat(40), reasons: ['one two three four five six seven eight nine ten', 'ten nine eight seven six five four three two one'], praise: ['a b c d e f g h'] });
  assert.ok(long.words <= 60, 'cut to fit: praise first, then reasons');
  assert.equal(long.praise.length, 0);
  assert.deepEqual(whyModel({ title: 'X', summary: 'Y', reasons: ['Same', 'Same', ''], praise: ['Same'] }).reasons, ['Same'], 'no repeats');
});

test('player play: before "Why?" a reveal shows 30 words at most', () => {
  const longest = revealWordCount({ word: 'Not yet', line: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen', note: PLAY.missNote, retry: true, replay: true });
  assert.ok(longest <= REVEAL_DEFAULTS.beforeWhyMaxWords, `${longest} words`);
});

// ---------------------------------------------------------------- the rep and the set

test('player play: the spotlight lights the carrier, the lesson\'s player and your mark: 4 at most, never YOU', () => {
  const scenario = { timeline: { carrier: [{ t: 0, id: 'them-LCM' }, { t: 1, id: null }, { t: 2.4, id: 'them-LW' }], players: { overrides: [{ id: 'them-LW' }, { id: 'them-ST' }] } } };
  const ids = keyPlayers({
    scenario, freezeFrame: { carrierId: 'them-LW' }, cue: { type: 'player', id: 'us-RB' },
    ctx: { markTarget: { id: 'them-ST' }, firstDefender: { id: 'us-RCB' }, dangerousAttacker: { id: 'them-RW' } }, learnerId: 'us-RCB',
  });
  assert.deepEqual(ids, ['them-LW', 'us-RB', 'them-ST', 'them-LCM']);
  assert.ok(!ids.includes('us-RCB'));
  assert.deepEqual(keyPlayers({}), []);
});

test('player play: the first set teaches (a worked example, then the glow) and only its last rep counts', () => {
  assert.deepEqual(firstSetStep(0), { example: true, aid: 'glow', counts: false });
  assert.deepEqual(firstSetStep(1), { example: false, aid: 'glow', counts: false });
  assert.deepEqual(firstSetStep(2), { example: false, aid: null, counts: true });
  assert.equal(setStep(0, { nodePlays: 0, nodeStars: 0 }).aid, 'glow', 'a new node: the glow on its first reps');
  assert.equal(setStep(PLAY_DEFAULTS.glowReps, { nodePlays: 0 }).aid, null, 'then none');
  assert.equal(setStep(0, { nodePlays: 1, nodeStars: 0 }).aid, null, 'played before: no aid');
  assert.equal(setStep(0, { nodePlays: 0, nodeStars: 1 }).aid, null);
  assert.equal(setStep(3).counts, true);
});

test('player play: the tally keeps each slot\'s first try (Try again never changes it); the miss note once a set', () => {
  let t = createTally(5);
  t = tallyTry(t, { slot: 0, stars: 1 });
  t = tallyTry(t, { slot: 0, stars: 3 });
  t = tallyTry(t, { slot: 1, stars: 2 });
  t = tallyTry(t, { slot: 1, stars: 0 });
  t = tallyTry(t, { slot: 9, stars: 3 });
  assert.deepEqual(t.slots, [1, 2, null, null, null], 'a copied retry is never worth more than the first try');
  assert.deepEqual(tallyStars(t), [1, 2], 'slots never played are left out');
  let m = missNote(t, 2);
  assert.equal(m.note, '', 'not a miss');
  m = missNote(m.tally, 1);
  assert.equal(m.note, 'Hard one. Pros miss it too.');
  assert.equal(missNote(m.tally, 0).note, '', 'once a set');
});

test('player play: names, seeds and the ids records are kept under', () => {
  const principles = { D3: { kidName: 'Back Up Your Buddy' } };
  assert.equal(repTitle({ principles: ['D3'] }, principles), 'Back Up Your Buddy');
  assert.equal(repTitle({ principles: ['X9'], titleKid: 'Help your friend' }, principles), 'Help your friend');
  assert.equal(seedFor('back-up', 2), seedFor('back-up', 2));
  assert.notEqual(seedFor('back-up', 2), seedFor('back-up', 3));
  assert.equal(recordIdOf({ id: 'm1-02-d3-rcb-m', mirrorOf: 'm1-02-d3-rcb' }), 'm1-02-d3-rcb');
  assert.equal(recordIdOf({ id: 'm1-02-d3-rcb-m' }), 'm1-02-d3-rcb');
  assert.equal(recordIdOf({ id: 'gen-123', source: { kind: 'generated' }, principles: ['D1'], learner: { role: 'LB' } }), 'gen-D1-FB', 'one record per idea and position family');
});

// ---------------------------------------------------------------- Full time

test('player play: Full time shows each rep\'s stars, the XP, a level up, the rewards (gold first, 3 at most) and the best move', () => {
  const m = fullTimeModel({
    reps: [{ stars: 1, title: 'Close Them Down' }, { stars: 3, title: 'Back Up Your Buddy' }, { stars: 3, title: 'Later' }, { stars: 9 }],
    xpBefore: LEVEL_XP[1] - 20, xpAfter: LEVEL_XP[1] + 30,
    gained: { xp: 50, badges: ['first-s'], cards: [{ id: 'D1', tier: 1, upgrade: false }, { id: 'D3', tier: 3, upgrade: true }], levelUp: { from: 1, to: 2, unlocks: ['sky'] } },
    nodeStars: { before: 1, after: 2 },
    principles: { D3: { kidName: 'Back Up Your Buddy' }, D1: { kidName: 'Close Them Down' } },
  });
  assert.deepEqual(m.rows, [1, 3, 3, 3]);
  assert.equal(m.total, 10);
  assert.equal(m.xpGain, 50);
  assert.equal(m.levelUp, true);
  assert.equal(m.after.level, levelFor(LEVEL_XP[1] + 30).level);
  assert.equal(m.best, 'Back up your buddy', 'the first of the best, in sentence case');
  assert.deepEqual(m.nodeStars, { before: 1, after: 2 });
  assert.equal(FULLTIME_DEFAULTS.maxItems, 3);
  assert.deepEqual(m.allItems.map((i) => i.kind), ['card', 'card', 'badge', 'kit'], 'biggest first');
  assert.deepEqual(m.items.map((i) => i.kind), ['card', 'card', 'badge'], 'shown one by one: 3 at most...');
  assert.equal(m.moreItems, 1, '...the rest wait on the card screen');
  assert.equal(FULLTIME.moreOnCard(m.moreItems), '+1 more on your card');
  assert.equal(m.items[0].text, 'Gold sticker: Back Up Your Buddy');
  assert.equal(m.items[1].text, 'New sticker: Close Them Down');
  assert.match(m.items[2].text, /^New badge: /);
  assert.match(m.allItems[3].text, /^New kit colour: /);
  const none = fullTimeModel({ reps: [{ stars: 0, title: 'X' }], xpBefore: 10, xpAfter: 10 });
  assert.equal(none.best, null, 'no star: no best move');
  assert.equal(none.levelUp, false);
  assert.equal(none.xpGain, 0);
  assert.equal(none.moreItems, 0);
  assert.equal(fullTimeModel({ reps: [], nodeStars: { before: 2, after: 1 } }).nodeStars.after, 2, 'node stars never go down');
  assert.deepEqual(earnedItems(null), []);
});

test('player play: Full time has one "Next" at most (the reward cards step with "More"); "Best move" only at 2 stars or more, naming what you did', () => {
  assert.notEqual(FULLTIME.more, SHARED.next, 'the reward card\'s button is not a second "Next"');
  assert.equal(FULLTIME.more, 'More');
  assert.equal(FULLTIME.next, undefined);
  assert.equal(FULLTIME_DEFAULTS.bestMoveStars, 2);
  // A 1-star rep is never the best move, whatever its title.
  assert.equal(fullTimeModel({ reps: [{ stars: 1, title: 'Close Them Down' }, { stars: 0, title: 'X' }] }).best, null);
  // The rep's move (what you did, from the reveal) wins over its idea's name; the first of the best.
  const m = fullTimeModel({ reps: [
    { stars: 2, title: 'Close Them Down', move: 'you got close from the middle side' },
    { stars: 3, title: 'Back Up Your Buddy', move: 'you are backing up your teammate at an angle' },
    { stars: 3, title: 'Later', move: 'you stayed wide' },
  ] });
  assert.equal(m.best, 'you are backing up your teammate at an angle');
  assert.equal(FULLTIME.bestMove(m.best), 'Best move: you are backing up your teammate at an angle');
  // move: null (a rep with nothing to praise) is never named; no move at all ("Who's open?") names its idea.
  assert.equal(fullTimeModel({ reps: [{ stars: 2, title: 'Close Them Down', move: null }] }).best, null);
  assert.equal(fullTimeModel({ reps: [{ stars: 2, title: 'Close Them Down', move: null }, { stars: 2, title: 'Find the Free Player' }] }).best, 'Find the free player');
  assert.equal(bestMoveName({ stars: 3, title: 'Hold the Line' }), 'Hold the line');
  assert.equal(bestMoveName({ title: '' }), null);
});

test('player play: play time adds up over the day (a new day starts again); the break nudge after 15 minutes', () => {
  assert.equal(TODAY_KEY, 'player:today');
  let s = addToday(null, { day: '2026-09-27', ms: 5 * 60000 });
  s = addToday(s, { day: '2026-09-27', ms: 11 * 60000 });
  assert.equal(minutesOn(s, '2026-09-27'), 16);
  assert.equal(breakDue(minutesOn(s, '2026-09-27')), true);
  assert.equal(minutesOn(s, '2026-09-28'), 0, 'another day');
  assert.deepEqual(addToday(s, { day: '2026-09-28', ms: 60000 }), { day: '2026-09-28', ms: 60000 });
  assert.equal(breakDue(14.9), false);
  assert.equal(FULLTIME_DEFAULTS.breakAfterMin, 15);
  assert.deepEqual(addToday('junk', { day: '2026-09-27', ms: -5 }), { day: '2026-09-27', ms: 0 });
  assert.equal(sentenceCase('Between Them and Goal'), 'Between them and goal');
  assert.equal(sentenceCase('Hold the Line'), 'Hold the line');
});

// ---------------------------------------------------------------- Match day

test('player play: Match day heat is Hot (70+), Warm (50+) or Cold, never a number', () => {
  assert.equal(heatFor(95), 'hot');
  assert.equal(heatFor(70), 'hot');
  assert.equal(heatFor(69), 'warm');
  assert.equal(heatFor(50), 'warm');
  assert.equal(heatFor(49), 'cold');
  assert.equal(heatFor(null), 'cold');
  for (const k of ['hot', 'warm', 'cold']) assert.ok(MATCHDAY[k] && !/\d/.test(MATCHDAY[k]));
  assert.equal(MATCHDAY_DEFAULTS.duration, 45);
});

test('player play: the best hot streak in seconds (a reaction moment after a pass never breaks it)', () => {
  const at = (t, score, grace = false) => ({ t, score, grace });
  const run = [];
  for (let i = 0; i < 30; i++) run.push(at(i / 10, 80)); // 3 s hot
  run.push(at(3.0, 60, true)); // a pass: not scored
  for (let i = 31; i < 60; i++) run.push(at(i / 10, 75)); // still hot: 6 s in all
  run.push(at(6.0, 40)); // cold: broken
  for (let i = 61; i < 81; i++) run.push(at(i / 10, 90)); // 2 s hot
  assert.equal(bestHotStreak(run), 6);
  assert.equal(bestHotStreak([]), 0);
  assert.equal(bestHotStreak([at(0, 30), at(0.1, 20)]), 0);
  assert.equal(bestHotStreak([at(1, 71)]), 0, 'one sample is a tenth of a second');
  assert.deepEqual(hardestMoment({ worst: [{ t: 3, score: 40 }, { t: 9, score: 22 }, { t: 20, score: 35 }] }), { t: 9, score: 22 });
  assert.equal(hardestMoment({ worst: [] }), null);
  assert.equal(hardestMoment(null), null);
});

// ---------------------------------------------------------------- celebrations and sound (Player-mode rules)

test('player play: a rep\'s stars pop and tick in under 0.6 s; a big celebration at most once a set', () => {
  assert.deepEqual(playerStarPlan(0), []);
  const plan = playerStarPlan(3);
  assert.deepEqual(plan.map((p) => p.index), [0, 1, 2]);
  assert.ok(plan.every((p, i) => i === 0 || p.at > plan[i - 1].at), 'one at a time');
  assert.ok(playerAckMs(3) < PLAYER_CELEBRATE.ackMaxMs, `${playerAckMs(3)} ms`);
  assert.equal(playerStarPlan(7).length, 3, 'clamped');
  const b = createBurstBudget();
  assert.equal(b.take(), true);
  assert.equal(b.take(), false, 'once a set');
  assert.equal(b.left, 0);
  assert.equal(createBurstBudget(0).take(), false);
  assert.equal(playerMilestone({ stars: 3, firstThreeOfSet: true }), 'three-stars');
  assert.equal(playerMilestone({ stars: 3, firstThreeOfSet: false }), null, 'a later 3-star gets the short acknowledgement');
  assert.equal(playerMilestone({ stars: 1, gained: { levelUp: { from: 1, to: 2 } } }), 'level-up');
  assert.equal(playerMilestone({ stars: 1, gained: { cards: [{ id: 'D3', tier: 3 }] } }), 'gold');
  assert.equal(playerMilestone({ stars: 2 }), null);
});

test('player play: the pass sounds exist (groan, lift) next to the others', () => {
  for (const name of ['whistle', 'star', 'cheer', 'levelup', 'groan', 'lift']) assert.ok(SOUND_NAMES.includes(name), name);
});

// ---------------------------------------------------------------- what a rep counts for, and what the reveal says

test('player play: Try again is practice only: no Elo, rewards, stickers, history or tally, and it never celebrates', () => {
  const firstTry = recordPolicy({ counts: true });
  assert.deepEqual(firstTry, { practice: false, elo: true, streak: true, rewards: true, mastery: true, history: true, tally: true, celebrate: true });
  const retry = recordPolicy({ counts: true, retry: true });
  assert.equal(retry.practice, true);
  for (const k of ['elo', 'streak', 'rewards', 'mastery', 'history', 'tally', 'celebrate']) assert.equal(retry[k], false, `a retry: no ${k}`);
  // The first set: the worked example and the glow rep teach (no Elo, no XP: R28); the example never celebrates.
  const example = recordPolicy({ counts: false, aided: true, example: true, firstSet: true });
  assert.deepEqual([example.elo, example.rewards, example.celebrate, example.history, example.tally], [false, false, false, false, true]);
  const taught = recordPolicy({ counts: false, aided: true, firstSet: true });
  assert.deepEqual([taught.elo, taught.rewards, taught.celebrate, taught.tally], [false, false, false, true]);
  // A normal set's glow reps count (rewards, a celebration) but do not teach the skill model.
  const glow = recordPolicy({ counts: true, aided: true });
  assert.deepEqual([glow.elo, glow.rewards, glow.mastery, glow.celebrate, glow.history], [false, true, true, true, true]);
  // Played through: a miss then a copied 3-star retry keeps the miss for the set.
  let t = createTally(2);
  for (const attempt of [{ stars: 0, retry: false }, { stars: 3, retry: true }]) {
    if (recordPolicy({ counts: true, retry: attempt.retry }).tally) t = tallyTry(t, { slot: 0, stars: attempt.stars });
  }
  assert.deepEqual(tallyStars(t), [0]);
  assert.ok(words(PLAY.practiceNote) <= 8);
});

test('player play: the reveal bursts only when told (a counted first try), once a set, never for practice or the worked example', () => {
  assert.equal(burstFor({ stars: 3, celebrate: true }), true);
  assert.equal(burstFor({ stars: 3 }), false, 'celebrate defaults to false');
  assert.equal(burstFor({ stars: 3, celebrate: 'yes' }), false, 'only true');
  assert.equal(burstFor({ stars: 2, celebrate: true }), false, 'a 3-star rep only');
  assert.equal(burstFor({ stars: 3, celebrate: true, celebrated: true }), false, 'once a set');
  // play.js passes recordPolicy's celebrate: practice and the example can never take the set's one burst.
  assert.equal(burstFor({ stars: 3, celebrate: recordPolicy({ counts: true, retry: true }).celebrate }), false);
  assert.equal(burstFor({ stars: 3, celebrate: recordPolicy({ counts: false, example: true, aided: true, firstSet: true }).celebrate }), false);
});

test('player play (browser): reveal.show bursts only with celebrate: true, and a 3-star practice rep does not use the set\'s burst up', async () => {
  if (isNode) return;
  const played = [];
  const app = { sound: { play: (name) => played.push(name) }, settings: {} };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const budget = createBurstBudget();
  const reveal = createPlayerReveal(host, { app, budget });
  try {
    reveal.show({ stars: 3, word: 'Spot on', line: 'Good.', onNext: () => {} }); // a practice retry: celebrate left out
    await new Promise((r) => setTimeout(r, REVEAL_DEFAULTS.cheerAtMs + 120));
    assert.equal(played.includes('cheer'), false, 'no cheer without celebrate');
    assert.equal(budget.left, 1, 'the set still has its burst');
    reveal.show({ stars: 3, word: 'Spot on', line: 'Good.', celebrate: true, onNext: () => {} });
    await new Promise((r) => setTimeout(r, REVEAL_DEFAULTS.cheerAtMs + 120));
    assert.equal(played.includes('cheer'), true, 'a counted 3-star first try gets it');
    assert.equal(budget.left, 0);
  } finally { reveal.destroy(); host.remove(); document.querySelectorAll('.cb-confetti').forEach((n) => n.remove()); }
});

test('player play (browser): "See what happens" gives focus back to the button that had it', async () => {
  if (isNode) return;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const reveal = createPlayerReveal(host, { app: { settings: {} } });
  try {
    reveal.show({ stars: 1, word: 'Close', line: 'Get closer to their striker.', onNext: () => {}, onReplay: () => {}, replayLabel: 'See what happens', why: { title: 'X', summary: 'Y' } });
    const replay = host.querySelector('.pr-replay');
    replay.focus();
    assert.equal(document.activeElement, replay);
    reveal.setBusy(true);
    assert.ok(replay.disabled, 'off while the play runs');
    reveal.setBusy(false);
    assert.equal(document.activeElement, replay, 'focus is back where it was');
  } finally { reveal.destroy(); host.remove(); }
});

test('player play: the retry card says "Same play, other side"; any other card names the position', () => {
  assert.deepEqual(repCard({ role: 'RW', profileRole: 'LW', retry: true }), { text: 'Same play, other side', changed: true });
  assert.deepEqual(repCard({ role: 'RW', profileRole: 'LW' }), roleCard('RW', 'LW'), 'a borrowed position: "Now you\'re the right winger"');
  assert.deepEqual(repCard({ role: 'LW', profileRole: 'LW' }), { text: "You're the left winger", changed: false });
});

test('player play: the article "A" is not a grade: "A cross is coming." keeps its question; grades and "/100" still never show', () => {
  assert.equal(usableText('A cross is coming. Where do you go?'), true);
  assert.equal(usableText('A pass across is your signal: sprint to the new player and get close.'), true);
  assert.equal(questionFor({ questionKid: 'A cross is coming from the other side. Where do you go?' }), 'A cross is coming from the other side. Where do you go?');
  for (const bad of ['You got an F.', 'Grade: A', 'That is an A on your card.', 'You got a B there.', 'An S!', 'Score: 80/100']) assert.equal(usableText(bad), false, bad);
});

// Real drills: the authored scenarios, the generated drills' words and each position's first set (road.js buildFirstSet).
const catalogue = await loadJSON('data/principles.json');
const byId = Object.fromEntries(catalogue.principles.map((p) => [p.id, p]));
const F = createFormation(await loadJSON('data/formations/helios-433.json'));
const formations = { us: F, them: F };
const scenarioIndex = (await loadJSON('data/scenarios/index.json')).scenarios;
const rawScenarios = await Promise.all(scenarioIndex.map((e) => loadJSON(`data/scenarios/${e.file ?? `${e.id}.json`}`)));
const authored = rawScenarios.map((raw) => normalizeScenario(raw)).filter((s) => s.kind !== 'pass');

test('player play: every authored drill\'s question, brief and takeaway survive as written (none falls back to the default)', () => {
  assert.ok(authored.length >= 30, `${authored.length} drills`);
  for (const s of authored) {
    if (typeof s.questionKid === 'string') assert.equal(questionFor(s), s.questionKid.trim(), `${s.id} questionKid`);
    if (typeof s.briefKid === 'string') assert.equal(briefFor(s), s.briefKid.trim(), `${s.id} briefKid`);
    const take = s.takeaway?.kid ?? (typeof s.takeaway === 'string' ? s.takeaway : null);
    if (typeof take === 'string') assert.equal(takeawayFor(s), take.trim(), `${s.id} takeaway`);
  }
  const asked = ['m1-10-u8-lcb', 'm1-12-u8-rb', 'm2-12-p10-lw'].map((id) => authored.find((s) => s.id === id));
  for (const s of asked) assert.match(questionFor(s), /^A cross is coming/, `${s.id}`);
  assert.match(takeawayFor(authored.find((s) => s.id === 'm1-08-d1-st')), /^A pass across/);
  // The generated drills' words (js/engine/spotdrill.js) too.
  for (const b of Object.values(SPOT_WORDS.briefKid)) assert.equal(briefFor({ briefKid: b }), b);
  for (const holder of ['them-LW', 'them-RCB', 'us-DM', 'them-ST']) {
    const q = SPOT_WORDS.questionKid(holder);
    assert.equal(questionFor({ questionKid: q }), q);
  }
  // The principles' summaries fit the Why? sheet.
  for (const p of catalogue.principles) if (typeof p.summary?.kid === 'string') assert.ok(usableText(p.summary.kid, PLAY_DEFAULTS.whyMaxWords), `${p.id} summary.kid`);
});

test('player play: the reveal\'s words match the stars: praise only at 3 stars, one fix at most at 2, the drill\'s own ideas first', async () => {
  // The first set of every position (as a new player gets it), then every authored drill.
  const load = async (id) => rawScenarios[scenarioIndex.findIndex((e) => e.id === id)];
  const road = Road.normalizeRoad(await loadJSON('data/road.json'));
  const drills = [];
  for (const group of Road.GROUPS) {
    const profile = Road.pickGroup(null, group, road);
    const reps = await Road.buildFirstSet({ road, profile, index: scenarioIndex, load, seed: seedFor(`first-${profile.role}`), formations, catalogue });
    for (const r of reps) if (r.kind === 'spot' && r.scenario) drills.push(normalizeScenario(r.scenario));
  }
  assert.ok(drills.length >= 8, `${drills.length} first-set drills`);
  drills.push(...authored);
  const offsets = [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [2.5, 2.5], [-3, 0], [0, 4], [-5, 3], [6, -2]];
  const seen = { 3: 0, 2: 0, low: 0 };
  for (const s of drills) {
    const scene = repScene(s, { formations });
    const own = s.principles ?? [];
    for (const spot of [...offsets.map(([dx, dy]) => ({ x: scene.ghost.spot.x + dx, y: scene.ghost.spot.y + dy })), scene.start]) {
      const r = revealFor(s, scene, spot, { principles: byId });
      const where = `${s.id} at (${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}), ${r.stars} stars: "${r.line}"`;
      const fixes = (r.more.reasons ?? []).map((x) => x.text);
      assert.ok(usableText(r.line, PLAY_DEFAULTS.lineMaxWords), where);
      if (r.stars >= 3) {
        seen[3]++;
        assert.deepEqual(r.why.reasons, [], `${where}: no fix on the Why? sheet after "Spot on"`);
        assert.ok(!fixes.includes(r.line), `${where}: the line is praise, not a fix`);
      } else if (r.stars === 2) {
        seen[2]++;
        const shown = [r.line, ...r.why.reasons].filter((t) => fixes.includes(t));
        assert.ok(shown.length <= 1, `${where}: ${shown.length} fixes`);
      } else {
        seen.low++;
        // After a miss: the drill's note on your mistake, else a reason about the drill's own ideas when there is one.
        const about = (r.more.reasons ?? []).filter((x) => ideasOf(x).some((id) => own.includes(id)) && usableText(x.text, PLAY_DEFAULTS.lineMaxWords));
        if (!r.misText && about.length) assert.equal(r.line, about[0].text, `${where}: the drill's own idea first`);
      }
    }
  }
  assert.ok(seen[3] > 20 && seen[2] > 5 && seen.low > 20, JSON.stringify(seen));
  // The play-test's cases.
  const m104 = authored.find((s) => s.id === 'm1-04-d5-rcb');
  const at = (s, spot) => revealFor(s, repScene(s, { formations }), spot, { principles: byId });
  assert.equal(at(m104, repScene(m104, { formations }).start).line, 'Get between their striker and our goal.', 'm1-04 from the start: goal-side (D5), not the line of defenders');
  const m106 = authored.find((s) => s.id === 'm1-06-t3-rw');
  const g106 = repScene(m106, { formations }).ghost.spot;
  const miss = at(m106, { x: g106.x - 5, y: g106.y + 3 });
  assert.ok(miss.stars <= 1);
  assert.notEqual(miss.line, 'Stay a little further in front of your midfielders.', '"Their defender runs past you": the goal-side fix, not the shape');
  assert.ok((miss.more.reasons ?? []).some((x) => x.text === miss.line && ideasOf(x).includes('D5')), miss.line);
});

test('player play: praise knows its idea; "Best move" says what you did; a miss\'s lesson can be the drill\'s takeaway', () => {
  const result = { rules: [
    { id: 'level-line', principles: ['U4'], weight: 3, s: 1, critical: false, vars: {} },
    { id: 'goal-side', principles: ['D5'], weight: 2, s: 0.95, critical: false, vars: {} },
    { id: 'press', principles: ['D1', 'D2'], weight: 2, s: 0.5, critical: false, vars: {} },
  ] };
  const praise = praiseOf(result);
  assert.deepEqual(praise.map((p) => p.ruleId), ['level-line', 'goal-side'], 'the heaviest first; not the failing rule');
  assert.deepEqual(praise[1].principles, ['D5']);
  assert.equal(pickLine({ praise, stars: 3, principles: ['D5'] }), praise[1].text, 'a drill about D5: its praise first');
  assert.equal(pickLine({ praise, stars: 3 }), praise[0].text);
  assert.equal(bestMoveOf({ praise, principles: ['D5'] }), 'you are between your player and our goal');
  assert.equal(bestMoveOf({ praise: ['Good timing, you stayed onside.'] }), 'you stayed onside');
  assert.equal(bestMoveOf({ praise: ['Good run, you are in a scoring spot for the cross.'] }), 'you are in a scoring spot for the cross');
  assert.equal(bestMoveOf({ praise: [] }), null);
  // A miss: the drill's own lesson (its takeaway) comes before a reason about another idea.
  const reasons = [{ ruleId: 'compact', principleId: 'U1', text: 'Stay a little further in front of your midfielders.' }];
  assert.equal(pickLine({ reasons, stars: 1, principles: ['T3', 'D5'], takeaway: 'We lose the ball? Sprint back toward our goal.' }), 'We lose the ball? Sprint back toward our goal.');
  assert.equal(pickLine({ reasons, stars: 2, principles: ['T3', 'D5'], takeaway: 'We lose the ball? Sprint back toward our goal.' }), reasons[0].text, 'a near miss: the one fix');
  // Why? follows the stars.
  const more = [{ ruleId: 'goal-side', principleId: 'D5', text: 'Get closer to their defender.' }, { ruleId: 'compact', principleId: 'U1', text: 'Move closer to your midfielders.' }];
  assert.deepEqual(whyFor({ reasons: more, praise: ['Good, you stayed wide.'], line: 'Good, you stayed wide.', stars: 3 }).reasons, []);
  assert.deepEqual(whyFor({ reasons: more, line: more[0].text, stars: 2 }).reasons, [], 'the line is the one fix');
  assert.deepEqual(whyFor({ reasons: more, line: PLAY.lineFix, stars: 2 }).reasons, [more[0].text], 'or one here');
  assert.deepEqual(whyFor({ reasons: [...more].reverse(), line: 'x', stars: 0, principles: ['D5'] }).reasons, [more[0].text, more[1].text], 'the drill\'s idea first');
  assert.deepEqual(ideasOf({ ruleId: 'press', principleId: 'D1' }), ['D1', 'D2']);
  assert.deepEqual(ideasOf({ ruleId: 'zone', principleId: 'F2' }), ['F2']);
});

test('player play: a cue line on the pitch always has its name ("Your defenders", "Pass to you"), or is not drawn', () => {
  const rules = [{ id: 'compact', vars: { unit: 'back' } }, { id: 'screen', vars: { whoKid: 'their striker' } }];
  assert.deepEqual(cueMarker({ ruleId: 'goal-side', highlight: { type: 'player', id: 'them-ST' } }), { type: 'player', id: 'them-ST', tone: 'cue', pulse: false });
  const line = cueMarker({ ruleId: 'compact', highlight: { type: 'line-x', x: 40 } }, { rules, ball: { x: 50, y: 60 } });
  assert.equal(line.label, 'Your midfielders');
  assert.equal(line.clear, 'you', 'never written over YOU');
  assert.equal(line.labelAt.x, 40);
  assert.ok(line.labelAt.y < 34, 'written on the side away from the ball');
  assert.equal(cueMarker({ ruleId: 'compact', highlight: { type: 'line-x', x: 40 } }, { rules: [{ id: 'compact', vars: { unit: 'mid' } }] }).label, 'Your defenders');
  assert.equal(cueMarker({ ruleId: 'screen', highlight: { type: 'segment', a: { x: 1, y: 1 }, b: { x: 2, y: 2 } } }, { rules }).label, 'Pass to their striker');
  assert.equal(cueMarker({ ruleId: 'lane-open', highlight: { type: 'segment', a: { x: 1, y: 1 }, b: { x: 2, y: 2 } } }).label, 'Pass to you');
  assert.equal(cueMarker({ ruleId: 'mystery', highlight: { type: 'segment', a: { x: 1, y: 1 }, b: { x: 2, y: 2 } } }), null, 'no words: not drawn');
  assert.equal(cueMarker(null), null);
  for (const s of Object.values(PLAY.cue)) if (typeof s === 'string') assert.ok(words(s) <= 4, s);
});

test('player play: "Best spot" is written on the side of the ring away from YOU (never over YOU or your name tag)', () => {
  const ring = { x: 30, y: 30 };
  // A phone held upright (vertical: forward is up the screen): YOU further forward = above the ring on screen.
  assert.equal(bestSpotMarker({ x: 40, y: 30 }, ring, { orientation: 'vertical', tokenScale: 1.3 }).below, true, 'YOU above: under the ring');
  assert.equal(bestSpotMarker({ x: 30, y: 20 }, ring, { orientation: 'vertical', tokenScale: 1.3 }).below, true, 'YOU level: under it (your tag is above you)');
  assert.equal(bestSpotMarker({ x: 20, y: 30 }, ring, { orientation: 'vertical', tokenScale: 1.3 }).below, false, 'YOU below: over it');
  // A wide screen (horizontal: our left touchline at the top).
  assert.equal(bestSpotMarker({ x: 30, y: 45 }, ring, { orientation: 'horizontal' }).below, false);
  assert.equal(bestSpotMarker({ x: 30, y: 15 }, ring, { orientation: 'horizontal' }).below, true);
  const m = bestSpotMarker({ x: 0, y: 0 }, ring);
  assert.deepEqual([m.type, m.text, m.tone, m.lift, m.at, m.clear], ['label', PLAY.bestSpot, 'good', 'token', ring, 'you']);
});

test('player play: Lock it with YOU picked up but never moved says the tip again instead of locking the start', () => {
  assert.equal(lockAction({ armed: true, moved: false }), 'nudge');
  assert.equal(lockAction({ armed: true, moved: true }), 'lock', 'moved, then picked up again: Lock it locks');
  assert.equal(lockAction({ armed: false, moved: false }), 'lock', 'YOU put down: staying where you are is an answer too');
  assert.equal(lockAction(), 'lock');
  assert.equal(PLAY.tapWhere, 'Tap where you want to go.');
});

test('player play: a pass node opened in "Find your spot" goes on to #/pass in place of its address (Back is never trapped)', () => {
  const calls = [];
  redirectTo({ navigate: (hash, opts) => calls.push([hash, opts]) }, '#/pass/free-player');
  assert.deepEqual(calls, [['#/pass/free-player', { replace: true }]]);
});
