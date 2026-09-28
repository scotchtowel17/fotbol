// Player mode, the play area (docs/KID_REDESIGN.md §4.1 step 3, §4.3, §4.5, §4.6, §5): the pure parts of
// js/ui/player/strings.js, play.js, reveal.js, fulltime.js and matchday.js, and the Player-mode rules in
// js/ui/celebrate.js and js/ui/sound.js. No DOM: everything here runs under node --test and in tests.html.

import { test, assert } from './harness.js';
import { STRINGS as SHARED, STAR_WORDS, ROLE_NAMES, roleName, starWord, roleCard } from '../js/ui/player/strings.js';
import {
  STRINGS as PLAY, PLAY_DEFAULTS, usableText, starsForScore, wordForStars, questionFor, briefFor, pickLine, whyFor, keyPlayers,
  firstSetStep, setStep, createTally, tallyTry, tallyStars, missNote, repTitle, seedFor, recordIdOf,
} from '../js/ui/player/play.js';
import { STRINGS as REVEAL, REVEAL_DEFAULTS, whyModel, revealWordCount } from '../js/ui/player/reveal.js';
import {
  STRINGS as FULLTIME, FULLTIME_DEFAULTS, sentenceCase, addToday, minutesOn, breakDue, fullTimeModel, earnedItems, TODAY_KEY,
} from '../js/ui/player/fulltime.js';
import { STRINGS as MATCHDAY, MATCHDAY_DEFAULTS, heatFor, bestHotStreak, hardestMoment } from '../js/ui/player/matchday.js';
import { PLAYER_CELEBRATE, playerStarPlan, playerAckMs, createBurstBudget, playerMilestone } from '../js/ui/celebrate.js';
import { SOUND_NAMES } from '../js/ui/sound.js';
import { ROLES } from '../js/engine/roles.js';
import { levelFor, LEVEL_XP } from '../js/rewards.js';

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

test('player play: the tally keeps each slot\'s best stars (Try again can only raise it); the miss note once a set', () => {
  let t = createTally(5);
  t = tallyTry(t, { slot: 0, stars: 1 });
  t = tallyTry(t, { slot: 0, stars: 3 });
  t = tallyTry(t, { slot: 1, stars: 2 });
  t = tallyTry(t, { slot: 1, stars: 0 });
  t = tallyTry(t, { slot: 9, stars: 3 });
  assert.deepEqual(t.slots, [3, 2, null, null, null]);
  assert.deepEqual(tallyStars(t), [3, 2], 'slots never played are left out');
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

test('player play: Full time shows each rep\'s stars, the XP, a level up, the rewards (gold first) and the best move', () => {
  const m = fullTimeModel({
    reps: [{ stars: 1, title: 'Close Them Down' }, { stars: 3, title: 'Back Up Your Buddy' }, { stars: 3, title: 'Later' }, { stars: 9 }],
    xpBefore: LEVEL_XP[1] - 20, xpAfter: LEVEL_XP[1] + 30,
    gained: { xp: 50, badges: ['first-rep'], cards: [{ id: 'D1', tier: 1, upgrade: false }, { id: 'D3', tier: 3, upgrade: true }], levelUp: { from: 1, to: 2, unlocks: ['sky'] } },
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
  assert.deepEqual(m.items.map((i) => i.kind), ['card', 'card', 'badge', 'kit']);
  assert.equal(m.items[0].text, 'Gold sticker: Back Up Your Buddy');
  assert.equal(m.items[1].text, 'New sticker: Close Them Down');
  assert.match(m.items[2].text, /^New badge: /);
  assert.match(m.items[3].text, /^New kit colour: /);
  const none = fullTimeModel({ reps: [{ stars: 0, title: 'X' }], xpBefore: 10, xpAfter: 10 });
  assert.equal(none.best, null, 'no star: no best move');
  assert.equal(none.levelUp, false);
  assert.equal(none.xpGain, 0);
  assert.equal(fullTimeModel({ reps: [], nodeStars: { before: 2, after: 1 } }).nodeStars.after, 2, 'node stars never go down');
  assert.deepEqual(earnedItems(null), []);
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
