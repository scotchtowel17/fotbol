// Player mode, the play area (docs/KID_REDESIGN.md §4.1 step 3, §4.3, §4.5, §4.6, §5): the pure parts of
// js/ui/player/strings.js, play.js, reveal.js, fulltime.js and matchday.js, and the Player-mode rules in
// js/ui/celebrate.js and js/ui/sound.js. No DOM: everything here runs under node --test and in tests.html, except
// the mount test at the end, which plays a whole set through play.js mount on a fake page (Node only).

import { test, assert, approx, loadJSON, isNode } from './harness.js';
import { STRINGS as SHARED, STAR_WORDS, ROLE_NAMES, roleName, starWord, roleCard } from '../js/ui/player/strings.js';
import {
  STRINGS as PLAY, PLAY_DEFAULTS, usableText, starsForScore, wordForStars, questionFor, briefFor, takeawayFor, pickLine, whyFor,
  keyPlayers, firstSetStep, setStep, createTally, tallyTry, tallyStars, missNote, repTitle, seedFor, recordIdOf, recordPolicy,
  repCard, ideasOf, praiseOf, bestMoveOf, cueMarker, repScene, revealFor, bestSpotMarker, lockAction, redirectTo,
  wantedStage, stagedScene, watchFrame, cameraRect, stageCamera, answerCamera, cardSpot,
  nameSpecific, ruleRefs, repSpeaker, repWords, mentionsSideline, touchlineBy, bestSpotPlace,
  kidScore, recordOf, repArea, areaOf, zoneOf, zoneMarker, insideOutline, nearestOnOutline, zoneArrowEnd, levelAt, revealNote, keyFix, keyCue, angleVars,
} from '../js/ui/player/play.js';
import { kidStars, KID_LEVELS, KID_DEFAULTS } from '../js/engine/kidscore.js';
import { STAGES, bestStage, reduceFrame } from '../js/engine/cast.js';
import { CAMERA_MIN, BOARD_DEFAULTS, shirtNumberOf } from '../js/ui/board.js';
import { buildContext } from '../js/engine/context.js';
import { judgeSpot } from '../js/engine/analyse.js';
import { RULES_BY_ID } from '../js/engine/rules/index.js';
import { frameAt, timing } from '../js/engine/timeline.js';
import { LENGTH, WIDTH } from '../js/engine/pitch.js';
import { mirrorScenario } from '../js/engine/scenario.js';
import { STRINGS as REVEAL, REVEAL_DEFAULTS, whyModel, revealWordCount, burstFor, createPlayerReveal } from '../js/ui/player/reveal.js';
import {
  STRINGS as FULLTIME, FULLTIME_DEFAULTS, sentenceCase, addToday, minutesOn, breakDue, fullTimeModel, earnedItems, bestMoveName, TODAY_KEY,
} from '../js/ui/player/fulltime.js';
import { STRINGS as MATCHDAY, MATCHDAY_DEFAULTS, heatFor, heatForStars, hotShare, runStars, hardestMoment } from '../js/ui/player/matchday.js';
import { PLAYER_CELEBRATE, playerStarPlan, playerAckMs, createBurstBudget, playerMilestone } from '../js/ui/celebrate.js';
import { SOUND_NAMES } from '../js/ui/sound.js';
import { ROLES } from '../js/engine/roles.js';
import { normalizeScenario } from '../js/engine/scenario.js';
import { createFormation } from '../js/engine/formation.js';
import { SPOT_WORDS } from '../js/engine/spotdrill.js';
import { levelFor, LEVEL_XP } from '../js/rewards.js';
import * as Road from '../js/ui/player/road.js';
import { fakePage, recordingBoard } from './player-mount.js';

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
  // With nothing that fits, the words point at the green (Player mode judges the right area, drawn green).
  assert.equal(pickLine({ feedback: { reasons: [], praise: [] }, stars: 3 }), PLAY.lineInGreen);
  assert.equal(pickLine({ feedback: { reasons: [], praise: [] }, stars: 2 }), PLAY.lineNear);
  assert.equal(pickLine({ feedback: { reasons: [{ text: 'Step back 4 m, level with their last defender.' }] }, stars: 0 }), PLAY.lineClose);
  // A key the spot broke (offside, the wrong side of your man...) is said first, at 2 stars and after a miss.
  const key = 'Step back so you are level with their last defender.';
  assert.equal(pickLine({ feedback, stars: 1, key, misconception: "Don't chase the ball." }), key, 'the key before the drill\'s note');
  assert.equal(pickLine({ feedback, stars: 2, key }), key);
  assert.equal(pickLine({ feedback, stars: 3, key }), 'Great, you are between your player and our goal.', 'never at 3 stars');
  assert.equal(pickLine({ feedback, stars: 1, key: 'Step back 3 m.' }), 'Get between their striker and our goal.', 'a key with metres is skipped');
  // Locked in where you started: say so (the arrow and the green show where to go; Why? has the fixes).
  assert.equal(pickLine({ feedback, stars: 0, still: true, key }), PLAY.lineStill);
  for (const s of [PLAY.lineInGreen, PLAY.lineNear, PLAY.lineClose, PLAY.lineStill, PLAY.greenIsRight, PLAY.missNote]) assert.ok(words(s) <= 14 && usableText(s), s);
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
  // The rep's move (the move the reveal praised: play.js bestMoveOf) wins over its idea's name; the first of the best;
  // always with a capital (the verifier saw "Best move: the ball has a clear path to you").
  const m = fullTimeModel({ reps: [
    { stars: 2, title: 'Close Them Down', move: 'Show them the sideline' },
    { stars: 3, title: 'Back Up Your Buddy', move: 'Get open' },
    { stars: 3, title: 'Later', move: 'Stay wide' },
  ] });
  assert.equal(m.best, 'Get open');
  assert.equal(FULLTIME.bestMove(m.best), 'Best move: Get open');
  assert.equal(bestMoveName({ stars: 3, move: 'you stayed onside.' }), 'You stayed onside.', 'a move from elsewhere gets its capital');
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

test('player play: Match day speaks the star words, never a number and never a Hot/Warm/Cold vocabulary (audit 2026-10-01)', () => {
  assert.equal(heatFor(95), 'hot');
  assert.equal(heatFor(70), 'hot');
  assert.equal(heatFor(69), 'warm');
  assert.equal(heatFor(50), 'warm');
  assert.equal(heatFor(49), 'cold');
  assert.equal(heatFor(null), 'cold');
  for (const k of ['hot', 'warm', 'cold']) assert.equal(MATCHDAY[k], undefined, 'no heat words on screen: the star words carry it');
  assert.ok(!('streak' in MATCHDAY), 'no "best hot streak": the run has stars and a hardest moment, nothing more');
  assert.equal(MATCHDAY.ringTip, 'Your ring turns green in the right area.');
  assert.equal(MATCHDAY_DEFAULTS.duration, 45);
});

test('player play: the hardest moment is the worst scored sample', () => {
  assert.deepEqual(hardestMoment({ worst: [{ t: 3, score: 40 }, { t: 9, score: 22 }, { t: 20, score: 35 }] }), { t: 9, score: 22 });
  assert.equal(hardestMoment({ worst: [] }), null);
  assert.equal(hardestMoment(null), null);
});

test('player play: Match day judges the right area: Hot at 3 stars, the run\'s stars from the time Hot, the hardest moment a Cold one', () => {
  assert.deepEqual([3, 2, 1, 0].map(heatForStars), ['hot', 'warm', 'cold', 'cold']);
  assert.equal(MATCHDAY_DEFAULTS.liveMemory, KID_DEFAULTS.liveMemory, 'the memory of best spots is the engine\'s');
  assert.equal(MATCHDAY_DEFAULTS.hotAt, KID_DEFAULTS.liveCoachFloor.hot, 'never colder than Coach mode\'s heat: the same bands');
  assert.equal(MATCHDAY_DEFAULTS.warmAt, KID_DEFAULTS.liveCoachFloor.warm);
  // A run: the share of scored time Hot (a reaction moment after a pass is not scored) gives its stars (75/50/30 %).
  const run = (hot, n = 100, extra = []) => [...Array.from({ length: n }, (_, i) => ({ t: i / 10, score: 60, stars: i < hot ? 3 : 1 })), ...extra];
  approx(hotShare(run(60)), 0.6, 1e-9);
  approx(hotShare(run(60, 100, [{ t: 11, score: 20, stars: 3, grace: true }])), 0.6, 1e-9, 'grace samples do not count');
  assert.deepEqual([80, 75, 60, 50, 40, 30, 10, 0].map((h) => runStars(run(h))), [3, 3, 2, 2, 1, 1, 0, 0]);
  assert.equal(runStars([]), 0);
  // Stars rule over the score: a 60 in the green is Hot, a 95 past a key line is not (hotShare reads stars first).
  approx(hotShare(Array.from({ length: 30 }, (_, i) => ({ t: i / 10, score: 60, stars: 3 }))), 1, 1e-9);
  approx(hotShare(Array.from({ length: 30 }, (_, i) => ({ t: i / 10, score: 95, stars: 1 }))), 0, 1e-9);
  // The hardest moment: the lowest-scoring of the worst moments the ring showed Cold (else the lowest).
  const worst = { worst: [{ t: 3, score: 40 }, { t: 9, score: 22 }, { t: 20, score: 35 }] };
  assert.deepEqual(hardestMoment(worst, [{ t: 3, stars: 1 }, { t: 9, stars: 2 }, { t: 20, stars: 0 }]), { t: 20, score: 35 }, 'the 22 was Warm');
  assert.deepEqual(hardestMoment(worst, [{ t: 3, stars: 3 }, { t: 9, stars: 2 }, { t: 20, stars: 2 }]), { t: 9, score: 22 }, 'none Cold: the lowest');
  assert.equal(MATCHDAY.lead, 'Keep moving. Stay in the right area.');
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
  const seen = { 3: 0, 2: 0, low: 0, still: 0, key: 0, angle: 0 };
  for (const s of drills) {
    const scene = repScene(s, { formations, catalogue });
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
        // Locked in where you started: it says so (Why? has the fixes, the drill's own idea first).
        if (r.still) { seen.still++; assert.equal(r.line, PLAY.lineStill, where); continue; }
        // A key the spot broke (a side, an order, a line) says its fix first, when it can be said.
        if (r.keyRule) {
          seen.key++;
          // A key about an angle (a D2 press shown the wrong way, a D5 mark not between) says which side, in the rule's
          // words where the key was judged, never "get closer" at YOUR distance.
          const v = angleVars(r.kid.keys[r.kid.broken.indexOf(r.keyRule)], r.keyRule, { ctx: scene.ctx, spot, area: r.area, rules: r.judgement.result.rules });
          if (v) {
            seen.angle++;
            assert.ok(!['far', 'close', 'loose', 'tight'].includes(v.issue), `${where}: the ${r.keyRule} key is about the side (${v.issue})`);
            const a = keyFix(r.keyRule, { rules: r.judgement.result.rules, who: r.who, spot, vars: v });
            if (a && usableText(a.text, PLAY_DEFAULTS.lineMaxWords)) assert.equal(r.line, a.text, `${where}: the ${r.keyRule} key's side first`);
            continue;
          }
          const k = (r.more.reasons ?? []).find((x) => x.ruleId === r.keyRule);
          const said = k ? r.who.rule(k.text, k.ruleId, r.judgement.result.rules, spot) : null;
          if (said && usableText(said, PLAY_DEFAULTS.lineMaxWords)) assert.equal(r.line, said, `${where}: the key's fix (${r.keyRule}) first`);
          continue;
        }
        // After a miss: the drill's note on your mistake, else a reason about the drill's own ideas when there is one.
        const about = (r.more.reasons ?? []).filter((x) => ideasOf(x).some((id) => own.includes(id)) && usableText(x.text, PLAY_DEFAULTS.lineMaxWords));
        // (Its words as shown: the player it means by number where the game shows two of the group, repSpeaker.)
        const said = about.map((x) => r.who.rule(x.text, x.ruleId, r.judgement.result.rules, spot)).filter((t) => usableText(t, PLAY_DEFAULTS.lineMaxWords));
        if (!r.misText && said.length) assert.equal(r.line, said[0], `${where}: the drill's own idea first`);
      }
    }
  }
  assert.ok(seen[3] > 20 && seen[2] > 5 && seen.low > 20 && seen.still > 20 && seen.key > 10 && seen.angle > 0, JSON.stringify(seen));
  // The play-test's cases.
  const m104 = authored.find((s) => s.id === 'm1-04-d5-rcb');
  const at = (s, spot) => revealFor(s, repScene(s, { formations, catalogue }), spot, { principles: byId });
  const still = at(m104, repScene(m104, { formations }).start);
  assert.equal(still.stars, 0, 'standing still is never right');
  assert.equal(still.line, PLAY.lineStill);
  assert.equal(still.why.reasons[0], 'Get between their striker and our goal.', 'm1-04 from the start: Why? says goal-side (D5) first, not the line of defenders');
  const m106 = authored.find((s) => s.id === 'm1-06-t3-rw');
  const g106 = repScene(m106, { formations }).ghost.spot;
  const missAt = { x: g106.x - 7, y: g106.y + 4 };
  const miss = at(m106, missAt);
  assert.ok(miss.stars <= 1, `${miss.stars} stars`);
  assert.notEqual(miss.line, 'Stay a little further in front of your midfielders.', '"Their defender runs past you": the goal-side fix, not the shape');
  assert.ok((miss.more.reasons ?? []).some((x) => miss.who.rule(x.text, x.ruleId, miss.judgement.result.rules, missAt) === miss.line && ideasOf(x).includes('D5')), miss.line);
  assert.equal(miss.line, 'Get closer to their number 3.', 'the full match shows four of their defenders: the one it means, by number');
  // 5 m off the same way is just outside the green now: Great, with the same fix (the old 1-star miss).
  const near = at(m106, { x: g106.x - 5, y: g106.y + 3 });
  assert.equal(near.stars, 2);
  assert.equal(near.line, 'Get closer to their number 3.');
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
  // "Best move" is the move the praise was for, the idea's simple name with a capital (the drill's own first), never
  // the praise line lower-cased ("the ball has a clear path to you" is not a move); a line whose idea has no name says
  // what you did as a sentence; one that says no move is not a best move.
  assert.equal(bestMoveOf({ praise, principles: ['D5'], byId }), 'Between them and goal');
  assert.equal(bestMoveOf({ praise, byId }), 'Stay in line', 'the heaviest praise: the line (U4)');
  const lane = praiseOf({ rules: [{ id: 'lane-open', weight: 3, s: 1, critical: false, vars: {} }] });
  assert.equal(lane[0].text, 'The ball has a clear path to you.');
  assert.equal(bestMoveOf({ praise: lane, principles: ['B3'], byId }), 'Get open');
  assert.equal(bestMoveOf({ praise: lane }), null, 'no idea named and not a move of yours: nothing');
  assert.equal(bestMoveOf({ praise: ['Good timing, you stayed onside.'] }), 'You stayed onside.');
  assert.equal(bestMoveOf({ praise: ['Good run, you are in a scoring spot for the cross.'] }), 'You are in a scoring spot for the cross.');
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

// ---------------------------------------------------------------- stages: a small game, a bigger game, the full match
// (The stage LINE on the role card went with the 2026-10-01 audit: the pitch shows how many players there are.)

test('player play: the stage each rep wants: the road\'s tag, else the plan\'s for its slot; the first set small, else the full match', () => {
  assert.equal(wantedStage({ stage: 'medium' }, 0, { plan: ['small'] }), 'medium', 'the road tagged it');
  assert.equal(wantedStage({ stage: 'giant' }, 0, { plan: ['small'] }), 'small', 'a bad tag: the plan');
  assert.equal(wantedStage(null, 1, { plan: ['small', 'full'] }), 'full');
  assert.equal(wantedStage(null, 3, { plan: ['small'], first: true }), 'small', '#/play/first: small x 3');
  assert.equal(wantedStage({}, 0), 'full', 'no tag and no plan: the full match, as before');
  const plan = typeof Road.stagePlan === 'function' ? Road.stagePlan(0, { first: true, count: 3 }) : ['small', 'small', 'small'];
  assert.deepEqual([0, 1, 2].map((i) => wantedStage(null, i, { plan, first: true })), ['small', 'small', 'small'], 'the onboarding set is small x 3');
});

test('player play: a small game\'s camera fits the points, never smaller than CAMERA_MIN, and stays on the pitch', () => {
  assert.equal(cameraRect([]), null);
  assert.equal(cameraRect([{ x: NaN, y: 3 }]), null);
  // A tight 2 v 1: grown about its middle to 24 x 16 m.
  const tiny = cameraRect([{ x: 50, y: 30 }, { x: 53, y: 33 }]);
  approx(tiny.x1 - tiny.x0, CAMERA_MIN.length, 0.011);
  approx(tiny.y1 - tiny.y0, CAMERA_MIN.width, 0.011);
  approx((tiny.x0 + tiny.x1) / 2, 51.5, 0.011);
  approx((tiny.y0 + tiny.y1) / 2, 31.5, 0.011);
  // In a corner: slid onto the pitch, still the minimum size.
  const corner = cameraRect([{ x: 103, y: 1 }, { x: 104, y: 2 }]);
  assert.deepEqual(corner, { x0: LENGTH - CAMERA_MIN.length, x1: LENGTH, y0: 0, y1: CAMERA_MIN.width });
  // A ball out of play counts at the touchline; a big game keeps its box.
  const big = cameraRect([{ x: 20, y: -4 }, { x: 70, y: 50 }]);
  assert.deepEqual(big, { x0: 20, x1: 70, y0: 0, y1: 50 });
  // Never bigger than the pitch.
  assert.deepEqual(cameraRect([{ x: -10, y: -10 }, { x: 200, y: 200 }]), { x0: 0, x1: LENGTH, y0: 0, y1: WIDTH });
  assert.deepEqual(cameraRect([{ x: 50, y: 30 }], { min: { length: 10, width: 6 } }), { x0: 45, x1: 55, y0: 27, y1: 33 });
});

/** The first authored drills that stage small (and one that stages medium), for the tests below. */
const stagedDrills = (() => {
  const out = { small: [], medium: [] };
  for (const s of authored) {
    if (out.small.length >= 3 && out.medium.length >= 1) break;
    const st = bestStage(s, 'small', { formations, principles: catalogue });
    if (st.stage === 'small' && out.small.length < 3) out.small.push({ s, st });
    else if (st.stage === 'medium' && out.medium.length < 1) out.medium.push({ s, st });
  }
  return out;
})();

test('player play: a staged rep is watched, frozen and judged on the reduced frame: only its cast is drawn or scored', () => {
  const cases = [...stagedDrills.small, ...stagedDrills.medium];
  assert.ok(stagedDrills.small.length >= 2, `${stagedDrills.small.length} authored drills staged small`);
  for (const { s, st } of cases) {
    const scene = stagedScene(s, st);
    const ids = new Set(st.cast.ids);
    const tag = `${s.id} (${st.stage}, ${st.cast.label})`;
    assert.equal(scene.stage, st.stage);
    assert.ok(scene.ids instanceof Set && scene.ids.size === ids.size, tag);
    // The freeze frame holds only the cast, YOU among them; its context names only players in it.
    assert.deepEqual(scene.freezeFrame.players.map((p) => p.id).sort(), [...ids].sort(), `${tag}: the freeze frame`);
    assert.ok(ids.has(scene.learnerId));
    for (const who of ['firstDefender', 'secondDefender', 'markTarget', 'dangerousAttacker']) {
      const id = scene.ctx[who]?.id;
      if (id && id !== scene.learnerId) assert.ok(ids.has(id), `${tag}: ${who} ${id} is in the cast`);
    }
    // The watch: every frame of the clip shows only the cast, YOU at your start.
    const { duration } = timing(s);
    for (let t = 0; t <= duration; t += 0.7) {
      const f = watchFrame(s, scene, t, scene.start, { formations });
      assert.ok(f.players.every((p) => ids.has(p.id)), `${tag} at ${t.toFixed(1)} s: only the cast`);
      const me = f.players.find((p) => p.id === scene.learnerId);
      assert.deepEqual({ x: me.x, y: me.y }, scene.start);
    }
    // Judging: the same as judging on the full freeze frame with everyone else taken off (nobody hidden is scored).
    const hand = reduceFrame(frameAt(s, timing(s).freezeAt, { formations }), ids);
    const ctx = buildContext(hand, { learnerId: scene.learnerId, base: scene.base });
    for (const spot of [scene.start, scene.ghost.spot, { x: scene.ghost.spot.x + 3, y: scene.ghost.spot.y - 2 }]) {
      const a = revealFor(s, scene, spot, { principles: byId });
      const b = judgeSpot({ ctx, ghost: scene.ghost }, spot, { wording: 'kid', principles: byId });
      assert.equal(a.judgement.result.score, b.result.score, `${tag}: the score at ${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}`);
      for (const cue of [a.judgement.feedback.cue?.highlight, a.cue?.highlight]) if (cue?.type === 'player') assert.ok(ids.has(cue.id), `${tag}: the cue ${cue.id} is in the cast`);
    }
    // The best spot is a 3-star answer, with the full game's line.
    const best = revealFor(s, scene, scene.ghost.spot, { principles: byId });
    assert.equal(best.stars, 3, `${tag}: the ghost earns 3 stars`);
  }
});

test('player play: whatever a staged rep says (the line, Why?, the cue), the groups it names are in the small or bigger game', () => {
  // PROGRESSIVE_FIELD §1: every sentence depends only on players the kid can see. Spots all round the answer (a miss
  // says more than a hit), every authored drill and its mirror at each smaller stage it can be played at. The level
  // line once fell back to YOUR own base when nobody else in the back line was in a small game, so "Move back, in line
  // with your other defenders" and a "Your defenders" line named defenders nobody could see (m1-02, m3-11).
  const BACK = ['LB', 'LCB', 'RCB', 'RB'], MID = ['DM', 'LCM', 'RCM'];
  const has = (ids, team, roles, not = []) => ids.some((i) => i.startsWith(`${team}-`) && roles.includes(i.split('-')[1]) && !not.includes(i));
  const GROUPS = [
    [/your other defenders|your defenders|your line of defenders|front of your defenders/i, (ids, skip) => has(ids, 'us', BACK, skip)],
    [/your midfielders/i, (ids, skip) => has(ids, 'us', MID, skip)],
    [/their midfielders/i, (ids) => has(ids, 'them', MID)],
    [/their defenders|their last defender/i, (ids) => has(ids, 'them', [...BACK, 'GK'])],
    [/their striker/i, (ids) => ids.includes('them-ST')],
  ];
  let reps = 0;
  for (const s of authored.flatMap((d) => [d, mirrorScenario(d)])) {
    for (const stage of ['small', 'medium']) {
      const st = bestStage(s, stage, { formations, principles: catalogue });
      if (st.stage !== stage) continue;
      reps++;
      const scene = stagedScene(s, st);
      const ids = st.cast.ids;
      const skip = [st.learnerId, st.ctx.firstDefender?.id].filter(Boolean); // "your other defenders": not you, not the presser
      const g = st.ghost.spot;
      const spots = [scene.start, g];
      for (const r of [4, 10]) for (let a = 0; a < 8; a++) spots.push({ x: Math.max(1, Math.min(104, g.x + r * Math.cos(a * Math.PI / 4))), y: Math.max(1, Math.min(67, g.y + r * Math.sin(a * Math.PI / 4))) });
      for (const spot of spots) {
        const rv = revealFor(s, scene, spot, { principles: byId });
        const cue = cueMarker(rv.cue, { rules: rv.judgement.result.rules, ball: scene.freezeFrame.ball }); // (the one the reveal draws)
        const texts = [rv.line, rv.why?.summary, ...(rv.why?.reasons ?? []), ...(rv.why?.praise ?? []), cue?.label].filter((t) => typeof t === 'string');
        const tag = `${s.id} ${st.stage} ${st.cast.label} at ${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}`;
        for (const t of texts) for (const [re, ok] of GROUPS) if (re.test(t)) assert.ok(ok(ids, skip), `${tag}: "${t}" names players the game does not show`);
        if (cue?.type === 'player') assert.ok(ids.includes(cue.id), `${tag}: the cue ring is on ${cue.id}, not shown`);
        if (cue?.type === 'line-x' && /defenders/i.test(cue.label ?? '')) {
          const xs = st.frame.players.filter((p) => !skip.includes(p.id) && p.id.startsWith('us-') && BACK.includes(p.role)).map((p) => p.x);
          assert.ok(xs.some((x) => Math.abs(x - cue.x) < 4), `${tag}: "${cue.label}" drawn at ${cue.x.toFixed(1)}, where no defender of yours stands`);
        }
      }
    }
  }
  assert.ok(reps >= 60, `${reps} staged reps checked`);
});

test('player play: the full match plays as before (the staged full scene judges like repScene), with no camera', () => {
  for (const s of authored.slice(0, 6)) {
    const st = bestStage(s, 'full', { formations, principles: catalogue });
    const scene = stagedScene(s, st);
    const old = repScene(s, { formations });
    assert.equal(scene.ids, null, `${s.id}: nobody left out`);
    assert.equal(scene.freezeFrame.players.length, 22);
    assert.equal(scene.freezeAt, old.freezeAt);
    assert.equal(scene.duration, old.duration);
    assert.deepEqual(scene.start, old.start);
    assert.deepEqual(scene.ghost.spot, old.ghost.spot, `${s.id}: the same best spot`);
    for (const spot of [old.start, old.ghost.spot, { x: old.ghost.spot.x - 4, y: old.ghost.spot.y + 2 }]) {
      const a = revealFor(s, scene, spot, { principles: byId }), b = revealFor(s, old, spot, { principles: byId });
      assert.equal(a.judgement.result.score, b.judgement.result.score, `${s.id}: the same score`);
      assert.equal(a.line, b.line, `${s.id}: the same line`);
    }
    assert.equal(stageCamera(s, scene, { formations }), null, `${s.id}: the full match keeps the focus crop and the spotlight`);
    assert.equal(watchFrame(s, scene, 0.5, scene.start, { formations }).players.length, 22);
  }
});

// ---------------------------------------------------------------- the right area (Player mode's judgement)

test('player play: the stars shown stand for a score in their band: Elo and the rewards follow the right area (kidScore, recordOf)', () => {
  for (let n = 0; n <= 3; n++) for (let x = 0; x <= 100; x += 1) assert.equal(starsForScore(kidScore(n, x)), n, `${n} stars, Coach mode ${x}`);
  assert.equal(kidScore(3, 80), 90, 'in the green, Coach mode\'s 80 counts as a 3-star 90');
  assert.equal(kidScore(3, 97), 97, 'a better spot keeps its score');
  assert.equal(kidScore(1, 80), 74, 'past a key line, Coach mode\'s 80 is held to 1 star');
  assert.equal(kidScore(0, 70), 54);
  assert.equal(kidScore(2, NaN), 75, 'no score: the bottom of the band');
  assert.equal(kidScore(9, 50), 90, 'stars clamped');
  const s = { id: 'm1-02-d3-lcb-m', mirrorOf: 'm1-02-d3-lcb', learner: { role: 'RCB' } };
  const r = recordOf(s, { stars: 3, judgement: { result: { score: 81, grade: 'A' } } });
  assert.deepEqual(r, { id: 'm1-02-d3-lcb', stars: 3, score: 90, score01: 0.9, event: { type: 'rep', scenarioId: 'm1-02-d3-lcb', role: 'RCB', score: 90, stars: 3 } });
  assert.ok(!('grade' in r.event), 'no grade: the kid never sees one');
  assert.equal(recordOf(s, { stars: 1, judgement: { result: { score: 92 } } }).score01, 0.74, 'Elo learns the 1 star the kid saw, not the 92');
});

test('player play: the green: a closed outline, the arrow after a miss ends just inside its nearest edge', () => {
  const sq = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }];
  assert.equal(insideOutline(sq, { x: 15, y: 15 }), true);
  assert.equal(insideOutline(sq, { x: 25, y: 15 }), false);
  assert.equal(insideOutline(sq.slice(0, 2), { x: 15, y: 10 }), false, 'no area');
  assert.deepEqual(nearestOnOutline(sq, { x: 30, y: 14 }), { x: 20, y: 14 });
  assert.deepEqual(nearestOnOutline(sq, { x: 5, y: 5 }), { x: 10, y: 10 });
  assert.equal(nearestOnOutline([], { x: 0, y: 0 }), null);
  const best = { x: 15, y: 15 };
  const end = zoneArrowEnd(sq, { x: 30, y: 15 }, best);
  approx(end.x, 20 - PLAY_DEFAULTS.zoneArrowIn, 1e-9, 'into the green, past its edge');
  approx(end.y, 15, 1e-9);
  assert.deepEqual(zoneArrowEnd(sq, { x: 12, y: 12 }, best), best, 'inside the drawn green (a key broke it): to the best spot');
  assert.deepEqual(zoneArrowEnd([], { x: 30, y: 15 }, best), best, 'no green: to the best spot');
  assert.deepEqual(zoneMarker(sq), { type: 'zone', points: sq, tone: 'good' });
  assert.equal(zoneMarker(sq.slice(0, 2)), null);
  assert.equal(zoneMarker(null), null);
});

test('player play: the set\'s first reveal says the green is the answer; practice says so first; "Hard one" still comes once', () => {
  let t = createTally(5);
  let r = revealNote(t, { stars: 0 });
  assert.equal(r.note, PLAY.greenIsRight, 'the first reveal: what the green is (even after a miss)');
  t = r.tally;
  r = revealNote(t, { stars: 3 });
  assert.equal(r.note, '');
  r = revealNote(r.tally, { stars: 1 });
  assert.equal(r.note, PLAY.missNote, 'the miss note waits for the next miss');
  assert.equal(revealNote(r.tally, { stars: 0 }).note, '', 'once a set');
  assert.equal(revealNote(createTally(5), { stars: 0, practice: true }).note, PLAY.practiceNote, 'Try again says it is practice');
  assert.equal(revealNote(createTally(5), { stars: 0, practice: true }).tally.greenTold, false, 'and keeps the green tip for a first try');
});

test('player play: every staged rep\'s right area: the best spot is 3 stars, standing still 0, 3 m off 3 stars most ways; the green never reaches the start', () => {
  let n = 0, three = 0, reps = 0;
  for (const s of authored.flatMap((d) => [d, mirrorScenario(d)])) {
    for (const stage of STAGES) {
      const st = bestStage(s, stage, { formations, principles: catalogue });
      if (st.stage !== stage) continue;
      reps++;
      const scene = stagedScene(s, st);
      const tag = `${s.id} (${stage})`;
      assert.ok(scene.area && areaOf(s, scene) === scene.area, `${tag}: the scene has its area`);
      assert.equal(scene.area.stage, stage, `${tag}: judged at its stage`);
      const best = revealFor(s, scene, scene.ghost.spot, { principles: byId });
      assert.equal(best.stars, 3, `${tag}: the best spot`);
      assert.equal(levelAt(scene, scene.area, scene.ghost.spot), 'hot', `${tag}: the glow is hot there`);
      if (!s.answer?.hold) {
        const still = revealFor(s, scene, scene.start, { principles: byId });
        assert.equal(still.stars, 0, `${tag}: standing still`);
        assert.equal(still.line, PLAY.lineStill, `${tag}: it says so`);
        assert.equal(levelAt(scene, scene.area, scene.start), 'cold', `${tag}: the glow is cold at the start`);
      }
      const G = scene.ghost.spot;
      for (let k = 0; k < 16; k++) {
        const p = { x: G.x + 3 * Math.cos((k * Math.PI) / 8), y: G.y + 3 * Math.sin((k * Math.PI) / 8) };
        if (p.x < 0 || p.x > LENGTH || p.y < 0 || p.y > WIDTH) continue;
        n++;
        if (kidStars(scene.ctx, p, scene.area).stars === 3) three++;
      }
      if (stage !== 'full') continue; // (the green, traced, on the full match of each: the slowest part)
      const zone = zoneOf(s, scene);
      assert.ok(zone.length >= 24, `${tag}: a green to draw`);
      assert.equal(zoneOf(s, scene), zone, 'traced once');
      if (!s.answer?.hold) assert.ok(!insideOutline(zone, scene.start), `${tag}: the green never reaches YOUR start`);
      // What is drawn green is 3 stars (a vertex a hair inside, toward the best spot).
      for (const v of zone.filter((_, i) => i % 6 === 0)) {
        const d = Math.hypot(v.x - G.x, v.y - G.y);
        if (d < 0.3) continue;
        const q = { x: G.x + (v.x - G.x) * (d - 0.15) / d, y: G.y + (v.y - G.y) * (d - 0.15) / d };
        assert.equal(kidStars(scene.ctx, q, scene.area).stars, 3, `${tag}: drawn green at (${q.x.toFixed(1)}, ${q.y.toFixed(1)})`);
      }
    }
  }
  assert.ok(reps >= 150, `${reps} staged reps`);
  // The owner's play-test: 3 m off the best spot was 3 stars 40 % of the time; the right area forgives it (the rest
  // are key lines no distance forgives, and the start cap).
  assert.ok(three / n >= 0.75, `3 m off: 3 stars ${(100 * three / n).toFixed(1)} % of ${n}`);
});

test('player play: a key the spot broke says its fix first; its rule\'s own words when explain gave none (keyFix)', () => {
  const rules = [{ id: 'offside', weight: 3, s: 0.1, critical: false, vars: { line: 60, beyond: 2, pass: false, by: 'defender', nearLine: true } }];
  assert.deepEqual(keyFix('offside', { rules }), { ruleId: 'offside', principleId: 'F4', principles: ['F4'], text: 'Step back so you are level with their last defender.' });
  const reason = { ruleId: 'offside', principleId: 'F4', text: 'Stay level.' };
  assert.equal(keyFix('offside', { reasons: [reason], rules }), reason, 'explain\'s reason first');
  assert.equal(keyFix('nope', { rules }), null);
  // A key about an angle speaks the rule's words at that angle (angleVars), before explain's distance fix at YOUR spot.
  const press = [{ id: 'press', weight: 3, s: 0.2, critical: false, vars: { whoKid: 'their number 10', issue: 'far', principle: 'D1' } }];
  const far = { ruleId: 'press', principleId: 'D1', text: 'Get closer to their number 10, about two steps away.' };
  assert.equal(keyFix('press', { reasons: [far], rules: press }), far, 'no angle: the fix at YOUR spot');
  const side = keyFix('press', { reasons: [far], rules: press, vars: { whoKid: 'their number 10', issue: 'inside', principle: 'D2' } });
  assert.deepEqual([side.text, side.principleId], ['Come from the middle side of their number 10, so they have to go wide.', 'D2']);
  assert.equal(angleVars('wrong-side', 'press', { ctx: {}, spot: { x: 0, y: 0 } }), null, 'only the angle keys');
  assert.equal(angleVars('not-between', 'between-lines', { ctx: {}, spot: { x: 0, y: 0 } }), null);
});

test('player play: after a miss the one cue shows the key the spot broke (keyCue), else the rule the line talks about, else Coach mode\'s top cue; none at 3 stars', () => {
  const fallback = { text: 'Who is your player?', ruleId: 'compact', highlight: { type: 'line-x', x: 30 } };
  assert.equal(keyCue(null, { fallback }), fallback, 'no key: Coach mode\'s cue');
  assert.equal(keyCue('compact', { fallback }), fallback, 'the same rule: its own cue');
  assert.equal(keyCue('nope', { ctx: {}, fallback }), fallback, 'a rule with no cue');
  assert.equal(keyCue('goal-side', { fallback }), fallback, 'no context to ask');
  let keyed = 0, said = 0, other = 0;
  for (const s of authored.slice(0, 18)) {
    const scene = repScene(s, { formations, catalogue });
    const G = scene.ghost.spot;
    for (let k = 0; k < 16; k++) {
      for (const r of [2, 4, 6, 9]) {
        const spot = { x: Math.max(1, Math.min(104, G.x + r * Math.cos((k * Math.PI) / 8))), y: Math.max(1, Math.min(67, G.y + r * Math.sin((k * Math.PI) / 8))) };
        const rv = revealFor(s, scene, spot, { principles: byId });
        if (rv.stars >= 3) { assert.equal(rv.cue, null, `${s.id}: no cue in the green`); continue; }
        const at = `${s.id} at ${spot.x.toFixed(1)}, ${spot.y.toFixed(1)} ("${rv.line}")`;
        // The line's rule: the key's, else the reason's whose words are the line.
        if (rv.keyRule) assert.equal(rv.lineRule, rv.keyRule, at);
        else if (rv.lineRule) assert.ok((rv.more.reasons ?? []).some((x) => x.ruleId === rv.lineRule), `${at}: ${rv.lineRule} is a reason`);
        const own = rv.lineRule ? RULES_BY_ID[rv.lineRule]?.cue?.(scene.ctx, spot) : null;
        if (own) {
          if (rv.keyRule) keyed++; else said++;
          assert.equal(rv.cue?.ruleId, rv.lineRule, `${at}: the cue is the ${rv.lineRule} rule's, as the line`);
        } else { other++; assert.equal(rv.cue, rv.judgement.feedback.cue, at); }
      }
    }
  }
  assert.ok(keyed >= 20 && said >= 20 && other >= 5, `${keyed} key cues, ${said} of the line's rule, ${other} of Coach mode's`);
});

test('player play: a small game\'s camera is one rect for the whole clip: the cast, the ball, YOUR start and the best spot', () => {
  for (const { s, st } of [...stagedDrills.small, ...stagedDrills.medium]) {
    const scene = stagedScene(s, st);
    const rect = stageCamera(s, scene, { formations });
    const tag = `${s.id} (${st.stage})`;
    const inside = (p) => p.x >= rect.x0 - 1e-6 && p.x <= rect.x1 + 1e-6 && p.y >= rect.y0 - 1e-6 && p.y <= rect.y1 + 1e-6;
    assert.ok(rect.x1 - rect.x0 >= CAMERA_MIN.length - 0.02 && rect.y1 - rect.y0 >= CAMERA_MIN.width - 0.02, `${tag}: at least CAMERA_MIN`);
    assert.ok(rect.x0 >= 0 && rect.x1 <= LENGTH && rect.y0 >= 0 && rect.y1 <= WIDTH, `${tag}: on the pitch`);
    assert.ok(inside(scene.start) && inside(scene.ghost.spot), `${tag}: YOUR start and the best spot`);
    const { duration } = timing(s);
    for (let t = 0; t <= duration; t += 0.5) {
      const f = watchFrame(s, scene, t, scene.start, { formations });
      for (const p of f.players) if (p.id !== scene.learnerId) assert.ok(inside(p), `${tag} at ${t} s: ${p.id} in view`);
      if (f.ball) assert.ok(inside({ x: Math.max(0, Math.min(LENGTH, f.ball.x)), y: Math.max(0, Math.min(WIDTH, f.ball.y)) }), `${tag} at ${t} s: the ball in view`);
    }
    assert.ok((rect.x1 - rect.x0) * (rect.y1 - rect.y0) < 0.6 * LENGTH * WIDTH, `${tag}: a small part of the pitch (${(rect.x1 - rect.x0).toFixed(0)} x ${(rect.y1 - rect.y0).toFixed(0)} m)`);
  }
});

test('player play: at the whistle a small game eases in on the freeze: its players, the ball, YOUR start and the best spot', () => {
  let tighter = 0;
  for (const { s, st } of [...stagedDrills.small, ...stagedDrills.medium]) {
    const scene = stagedScene(s, st);
    const clip = stageCamera(s, scene, { formations });
    const rect = answerCamera(scene);
    const tag = `${s.id} (${st.stage})`;
    const inside = (p, r = rect) => p.x >= r.x0 - 1e-6 && p.x <= r.x1 + 1e-6 && p.y >= r.y0 - 1e-6 && p.y <= r.y1 + 1e-6;
    const onPitch = (p) => ({ x: Math.max(0, Math.min(LENGTH, p.x)), y: Math.max(0, Math.min(WIDTH, p.y)) });
    assert.ok(inside(scene.start) && inside(scene.ghost.spot), `${tag}: YOUR start and the best spot`);
    for (const p of scene.freezeFrame.players) if (p.id !== scene.learnerId) assert.ok(inside(p), `${tag}: ${p.id} at the freeze`);
    assert.ok(inside(onPitch(scene.freezeFrame.ball)), `${tag}: the ball`);
    assert.ok(rect.x1 - rect.x0 >= CAMERA_MIN.length - 0.02 && rect.y1 - rect.y0 >= CAMERA_MIN.width - 0.02, `${tag}: at least CAMERA_MIN`);
    // Never more than the clip's camera shows (a part of the same points).
    assert.ok((rect.x1 - rect.x0) * (rect.y1 - rect.y0) <= (clip.x1 - clip.x0) * (clip.y1 - clip.y0) + 0.05, `${tag}: no wider than the clip's`);
    if ((rect.x1 - rect.x0) * (rect.y1 - rect.y0) < 0.9 * (clip.x1 - clip.x0) * (clip.y1 - clip.y0)) tighter++;
  }
  assert.ok(tighter >= 1, `${tighter} of the staged drills get closer at the whistle`);
  // The full match: no camera (the focus crop and the spotlight, as before).
  const full = stagedScene(authored[0], bestStage(authored[0], 'full', { formations, principles: catalogue }));
  assert.equal(answerCamera(full), null);
});

test('player play: the role card sits where it covers nobody: the top, the bottom, the middle, a band between, an edge; else least', () => {
  const stage = { top: 100, bottom: 600 };
  const box = (top, h = 60, left = 150, w = 40) => ({ left, right: left + w, top, bottom: top + h });
  const at = (...a) => cardSpot(...a).at;
  assert.deepEqual(cardSpot(stage, 120, []), { at: 'top', top: 12, side: 'center' }, 'nothing to keep off: the top');
  assert.equal(at(stage, 120, [box(130)]), 'bottom', 'YOU at the top: the bottom');
  assert.equal(at(stage, 120, [box(130), box(520)]), 'middle', 'YOU at the top and the ball at the bottom: the middle');
  assert.equal(at(stage, 120, [box(130, 60, 0, 20)], { left: 100, right: 300 }), 'top', 'beside the card, not under it');
  assert.equal(at(stage, 120, [null, box(130)]), 'bottom', 'a player not drawn is skipped');
  // Every player drawn counts, not only YOU and the ball (the verifier: the card over their defender on the ball).
  const you = { box: box(460), weight: PLAY_DEFAULTS.cardWeights.you }, ball = { box: box(330, 30), weight: PLAY_DEFAULTS.cardWeights.ball };
  const carrier = { box: box(120), weight: PLAY_DEFAULTS.cardWeights.key };
  const free = cardSpot(stage, 80, [you, ball, carrier]);
  assert.equal(free.at, 'free', 'the top has the player on the ball, the bottom YOU, the middle the ball: a band between');
  const c = PLAY_DEFAULTS.cardClearPx;
  assert.ok(free.top + 100 >= 180 + c - 1e-6 && free.top + 100 + 80 <= 330 - c + 1e-6, `the band clears them all (${free.top})`);
  // No band across the middle: the card slides to an edge where the play leaves a corner free.
  const col = (top) => ({ box: box(top, 90, 200, 60), weight: 1 });
  const edge = cardSpot(stage, 120, [col(110), col(230), col(350), col(470)], { left: 170, right: 330, room: { left: 0, right: 500 } });
  assert.notEqual(edge.side, 'center', 'a column of players down the middle: an edge');
  // Nowhere clear: least of YOU and the ball, then the player on the ball, then anyone else.
  const all = [{ box: box(100, 500, 0, 500), weight: PLAY_DEFAULTS.cardWeights.other }, { box: box(130), weight: PLAY_DEFAULTS.cardWeights.you }];
  assert.notEqual(at(stage, 120, all, { left: 100, right: 300 }), 'top', 'the crowd everywhere: off YOU');
  assert.ok(PLAY_DEFAULTS.cardWeights.you > PLAY_DEFAULTS.cardWeights.key && PLAY_DEFAULTS.cardWeights.key > PLAY_DEFAULTS.cardWeights.other);
  // The gap from the edge is single-sourced (play.js sets the card's --pl-card-gap from it).
  assert.equal(PLAY_DEFAULTS.cardGapPx, 12);
});

test('player play: Try again\'s twin is staged at the stage its first try was played at', () => {
  for (const { s, st } of stagedDrills.small) {
    const twin = bestStage(mirrorScenario(s), st.stage, { formations, principles: catalogue });
    assert.equal(twin.stage, st.stage, `${s.id}: the twin plays the same stage`);
    assert.equal(twin.cast.ids.length, st.cast.ids.length, `${s.id}: the same number of players`);
  }
});

test('player play: Full time says "Next time: bigger games" only when the node\'s stars rose', () => {
  assert.equal(FULLTIME.biggerNext, 'Next time: bigger games');
  assert.ok(words(FULLTIME.biggerNext) <= 8);
  const m = (nodeStars) => fullTimeModel({ reps: [{ stars: 2 }], xpBefore: 0, xpAfter: 20, nodeStars }).bigger;
  assert.equal(m({ before: 0, after: 1 }), true);
  assert.equal(m({ before: 2, after: 3 }), true);
  assert.equal(m({ before: 1, after: 1 }), false, 'the same stars: the same games');
  assert.equal(m({ before: 3, after: 3 }), false);
  assert.equal(m(null), false, 'no node (the first set, Match day)');
});

// ---------------------------------------------------------------- whom the words mean, the sideline, the shape

test('player play: a group on show more than once is named by shirt number, from what the words say (never a guess)', () => {
  const players = [
    { id: 'us-LB', team: 'us', role: 'LB' }, { id: 'us-LCB', team: 'us', role: 'LCB' }, { id: 'us-DM', team: 'us', role: 'DM' },
    { id: 'them-LW', team: 'them', role: 'LW' }, { id: 'them-RW', team: 'them', role: 'RW' }, { id: 'them-ST', team: 'them', role: 'ST' },
  ];
  const who = { players, learnerId: 'us-LB' };
  // One of the group on show: the words stay.
  assert.deepEqual(nameSpecific('Get between their striker and our goal.', who), { text: 'Get between their striker and our goal.', ok: true });
  // Two wingers: the rule's player (refs), by number; capitals kept; plurals are groups and stay.
  assert.deepEqual(nameSpecific('Get closer to their winger.', { ...who, refs: ['them-RW'] }), { text: 'Get closer to their number 7.', ok: true });
  assert.equal(nameSpecific('Their winger has the ball.', { ...who, holders: ['them-LW'] }).text, 'Their number 11 has the ball.');
  assert.equal(nameSpecific('Stay in line with your defenders.', who).text, 'Stay in line with your defenders.');
  // Who is on the ball only where the words say so: "has the ball", "goes to", "chasing"...; else the refs.
  assert.equal(nameSpecific('The ball goes to their winger.', { ...who, holders: ['them-RW'] }).text, 'The ball goes to their number 7.');
  assert.equal(nameSpecific('Their striker is chasing your teammate.', { ...who, holders: ['us-DM'] }).text, 'Their striker is chasing your number 6.');
  assert.deepEqual(nameSpecific('Their winger is free at the far post.', { ...who, holders: ['them-LW'] }), { text: 'Their winger is free at the far post.', ok: false }, 'not a ball phrase: the holder is not who it means');
  // A pool names only its one player of the group (two: not known).
  assert.equal(nameSpecific('Their winger is free at the far post.', { ...who, pools: [['them-RW', 'them-ST']] }).text, 'Their number 7 is free at the far post.');
  assert.equal(nameSpecific('Their winger is free.', { ...who, pools: [['them-RW', 'them-LW'], ['them-LW']] }).text, 'Their number 11 is free.', 'the first pool with exactly one');
  assert.equal(nameSpecific('Their winger is free.', { ...who, pools: [['them-RW', 'them-LW']] }).ok, false);
  // "your teammate" is anyone of ours but YOU; YOUR kit number swaps in as on the shirts (board.js shirtNumberOf).
  assert.equal(nameSpecific('Stand behind your teammate.', { ...who, refs: ['us-LCB'] }).text, 'Stand behind your number 4.');
  assert.equal(nameSpecific('Stand behind your teammate.', { ...who, refs: ['us-LCB'], youNumber: 4 }).text, 'Stand behind your number 3.', 'YOU wear 4: the left centre-back wears your 3');
  assert.equal(nameSpecific('They passed to their other winger.', { ...who, holders: ['them-LW'] }).text, 'They passed to their number 11.');
  assert.equal(PLAY.theirNumber(7), 'their number 7');
  assert.equal(PLAY.yourNumber(4), 'your number 4');
});

test('player play: whatever a rep says (the question, the line, Why?, the cue), a group it names is one player on show, or is named by number', () => {
  // The verifier's finish: "Get closer to their winger" with both wingers on show, "Their defender has the ball" with
  // two defenders in a 2 v 2. Every authored drill and its mirror, at every stage it can be played at, spots all round
  // the answer. The brief (the play in motion) is named wherever its words say who: it keeps its words otherwise.
  const GROUP = /\b(their|your)\s+(?:other\s+)?(defender|midfielder|winger|striker|keeper|teammate)\b(?![-\w])/gi;
  const FAMS = { defender: ['CB', 'FB'], midfielder: ['DM', 'CM'], winger: ['W'], striker: ['ST'], keeper: ['GK'], teammate: null };
  const fam = (id) => ({ GK: 'GK', LCB: 'CB', RCB: 'CB', LB: 'FB', RB: 'FB', DM: 'DM', LCM: 'CM', RCM: 'CM', LW: 'W', RW: 'W', ST: 'ST' })[id.split('-')[1]];
  const many = (t, ids, me) => [...String(t).matchAll(GROUP)].filter((m) => {
    const team = m[1].toLowerCase() === 'their' ? 'them' : 'us', fs = FAMS[m[2].toLowerCase()];
    return ids.filter((id) => id !== me && id.startsWith(`${team}-`) && (!fs || fs.includes(fam(id)))).length > 1;
  }).map((m) => m[0]);
  const NUM = /\b(their|your) number (\d+)\b/gi;
  let reps = 0, named = 0, questions = 0, fallbacks = 0;
  for (const s of authored.flatMap((d) => [d, mirrorScenario(d)])) {
    for (const stage of STAGES) {
      const st = bestStage(s, stage, { formations, principles: catalogue });
      if (st.stage !== stage) continue;
      reps++;
      const scene = stagedScene(s, st);
      const ids = scene.freezeFrame.players.map((p) => p.id);
      const words = repWords(s, scene);
      assert.ok(usableText(words.question, PLAY_DEFAULTS.questionMaxWords) && usableText(words.brief, PLAY_DEFAULTS.briefMaxWords), `${s.id} ${stage}: "${words.question}" / "${words.brief}" within 12 words`);
      if (words.question !== questionFor(s)) questions++;
      if (words.question === PLAY.question && questionFor(s) !== PLAY.question) fallbacks++;
      const g = scene.ghost.spot;
      const spots = [scene.start, g];
      for (const r of [4, 10]) for (let a = 0; a < 8; a++) spots.push({ x: Math.max(1, Math.min(104, g.x + r * Math.cos(a * Math.PI / 4))), y: Math.max(1, Math.min(67, g.y + r * Math.sin(a * Math.PI / 4))) });
      const texts = [words.question];
      for (const spot of spots) {
        const rv = revealFor(s, scene, spot, { principles: byId });
        const rules = rv.judgement.result.rules;
        const cue = cueMarker(rv.cue, { rules, ball: scene.freezeFrame.ball, name: (t, id) => rv.who.rule(t, id, rules, spot) });
        texts.push(rv.line, ...(rv.why?.reasons ?? []), ...(rv.why?.praise ?? []), rv.why?.summary, cue?.label);
        assert.ok(usableText(rv.line, PLAY_DEFAULTS.lineMaxWords), `${s.id} ${stage}: "${rv.line}" fits`);
      }
      for (const t of texts.filter((x) => typeof x === 'string')) {
        assert.deepEqual(many(t, ids, scene.learnerId), [], `${s.id} ${stage} (${st.cast?.label ?? '11 v 11'}): "${t}" names a group the game shows more than once`);
        // A number named is a player on show, of that team.
        for (const m of t.matchAll(NUM)) {
          named++;
          const team = m[1].toLowerCase() === 'their' ? 'them' : 'us';
          assert.ok(ids.some((id) => id.startsWith(`${team}-`) && id !== scene.learnerId && shirtNumberOf(id, { learnerId: scene.learnerId }) === +m[2]), `${s.id} ${stage}: "${t}" names a number nobody on show wears`);
        }
      }
    }
  }
  assert.ok(reps >= 150 && named >= 50, `${reps} reps, ${named} numbers named`);
  assert.ok(questions >= 20, `${questions} questions name their player by number`);
  assert.ok(fallbacks <= 4, `${fallbacks} questions could not say whom they meant (the default question instead)`);
  // The verifier's two: m1-11 in a 2 v 2 names the defender on the ball; m1-05's full match, the winger.
  const m111 = authored.find((s) => s.id === 'm1-11-d2-rcm');
  const small = stagedScene(m111, bestStage(m111, 'small', { formations, principles: catalogue }));
  assert.equal(repWords(m111, small).question, `Their number ${shirtNumberOf(small.freezeFrame.carrierId)} has the ball by the sideline. Where now?`);
  // A number that takes the question past 12 words: its question at the end is "Where now?".
  const m202 = authored.find((s) => s.id === 'm2-02-b4-dm');
  const s202 = stagedScene(m202, bestStage(m202, 'small', { formations, principles: catalogue }));
  assert.match(repWords(m202, s202).question, /^Their striker is chasing your number \d+\. Where now\?$/);
  const m105 = authored.find((s) => s.id === 'm1-05-d2-rb');
  const full = stagedScene(m105, bestStage(m105, 'full', { formations, principles: catalogue }));
  assert.match(repWords(m105, full).question, /^Their number (7|11) has the ball, facing you\./);
});

test('player play: the rule behind the words says whom it means (ruleRefs): its name for the player, else its cue', () => {
  const s = authored.find((d) => d.id === 'm1-08-d1-st');
  const scene = stagedScene(s, bestStage(s, 'small', { formations, principles: catalogue }));
  const r = revealFor(s, scene, scene.start, { principles: byId });
  const rules = r.judgement.result.rules;
  // The press rule is about the player on the ball (its cue rings them; its words name them).
  assert.deepEqual(ruleRefs('press', { rules, ctx: scene.ctx, spot: scene.start }), [scene.ctx.carrier.id]);
  assert.deepEqual(ruleRefs('nope', { rules, ctx: scene.ctx }), []);
  const who = repSpeaker(s, scene);
  assert.equal(who.holder, scene.freezeFrame.carrierId);
  assert.ok(who.lesson.includes(scene.ctx.carrier.id), 'the drill\'s own idea (D1) is about the player on the ball');
  assert.equal(who.rule('Get closer to their defender.', 'press', rules, scene.start), `Get closer to their number ${shirtNumberOf(scene.ctx.carrier.id)}.`);
});

test('player play: words about the sideline keep it in view; a small game never talks about "the team\'s shape"', () => {
  assert.equal(mentionsSideline('Their defender has the ball by the sideline.'), true);
  assert.equal(mentionsSideline('Move wider, close to the touchline.', null), true);
  assert.equal(mentionsSideline('Get closer to their winger.'), false);
  assert.deepEqual(touchlineBy({ x: 40, y: 10 }), { x: 40, y: 0 });
  assert.deepEqual(touchlineBy({ x: 110, y: 50 }), { x: LENGTH, y: WIDTH });
  let sided = 0, zone = 0;
  for (const s of authored.flatMap((d) => [d, mirrorScenario(d)])) {
    for (const stage of ['small', 'medium']) {
      const st = bestStage(s, stage, { formations, principles: catalogue });
      if (st.stage !== stage) continue;
      const scene = stagedScene(s, st);
      const words = repWords(s, scene);
      if (words.sideline) {
        // The cameras play.js gives it (stageNow): the question's sideline, the one by the ball, in both.
        sided++;
        const side = touchlineBy(scene.freezeFrame.ball);
        for (const rect of [answerCamera(scene, { extra: [side] }), stageCamera(s, scene, { formations, extra: [side] })]) {
          assert.ok(side.y === 0 ? rect.y0 === 0 : rect.y1 === WIDTH, `${s.id} ${stage}: the sideline in view (${JSON.stringify(rect)})`);
        }
      }
      const g = scene.ghost.spot;
      for (const spot of [scene.start, { x: g.x - 12, y: g.y }, { x: g.x + 12, y: g.y }, { x: g.x, y: Math.min(66, g.y + 14) }, { x: g.x, y: Math.max(2, g.y - 14) }]) {
        const rv = revealFor(s, scene, spot, { principles: byId });
        for (const t of [rv.line, ...(rv.why?.reasons ?? [])]) assert.doesNotMatch(t, /team'?s shape/i, `${s.id} ${stage}: "${t}"`);
        if ([rv.line, ...(rv.why?.reasons ?? [])].includes(PLAY.zoneLine)) zone++;
      }
    }
  }
  assert.ok(sided >= 2, `${sided} staged reps whose words talk about the sideline`);
  assert.ok(zone >= 1, `${zone} small or bigger games say "${PLAY.zoneLine}" where the full match says "the team's shape"`);
  assert.ok(usableText(PLAY.zoneLine, PLAY_DEFAULTS.lineMaxWords));
  // The full match keeps its words (the shape is on show there).
  const m103 = authored.find((s) => s.id === 'm1-03-d4-lb');
  const full = stagedScene(m103, bestStage(m103, 'full', { formations, principles: catalogue }));
  const far = revealFor(m103, full, { x: full.ghost.spot.x + 25, y: full.ghost.spot.y }, { principles: byId });
  assert.ok(![far.line, ...far.why.reasons].includes(PLAY.zoneLine), 'the full match: not the small game\'s words');
});

test('player play: "Best spot" goes by the ring where it covers nobody, else a short callout with a line from the ring', () => {
  const fs = 1.5 * 1.4;
  const w = PLAY.bestSpot.length * PLAY_DEFAULTS.labelEm * fs, h = (PLAY_DEFAULTS.labelAscent + PLAY_DEFAULTS.labelDescent) * fs;
  const ring = { x: 30, y: 40 }, r = 2.5;
  const view = { x: 0, y: 0, width: 70, height: 100 };
  const over = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) > 0;
  // Nothing near: over the ring, centred; its words written where they were weighed (board.js drawLabel, no lift).
  const clear = bestSpotPlace({ ring, r, fs, view });
  assert.equal(clear.kind, 'near');
  assert.equal(clear.side, 'above');
  approx(clear.box.x1 - clear.box.x0, w);
  approx(clear.box.y1 - clear.box.y0, h);
  assert.ok(clear.box.y1 <= ring.y - r, 'over the ring, clear of it');
  approx(clear.at.y - 0.8 - PLAY_DEFAULTS.labelAscent * fs, clear.box.y0, 1e-9, 'the baseline where the box was measured');
  // YOU (a figure and your tag) just over the ring: under it.
  const youAbove = { x0: 27, x1: 33, y0: 28, y1: 37.2 };
  const under = bestSpotPlace({ ring, r, fs, view, you: [youAbove] });
  assert.equal(under.kind, 'near');
  assert.ok(!over(under.box, youAbove), `off YOU (${under.side})`);
  // YOU on one side of the ring and players round the rest of it (a 2-star spot a step away): a callout, off YOU.
  const youBeside = { x0: 22, x1: 29, y0: 30, y1: 44 };
  const crowd = [{ x0: 29, x1: 36, y0: 29, y1: 37 }, { x0: 26, x1: 40, y0: 43, y1: 51 }, { x0: 33, x1: 44, y0: 35, y1: 45 }];
  const call = bestSpotPlace({ ring, r, fs, view, you: [youBeside], others: crowd });
  assert.equal(call.kind, 'callout');
  assert.ok(call.clear && !over(call.box, youBeside), 'the callout covers neither YOU nor YOUR tag');
  assert.ok(Math.abs(Math.hypot(call.from.x - ring.x, call.from.y - ring.y) - r) < 1e-6, 'its line starts at the ring\'s rim');
  const toBox = Math.hypot(Math.max(call.box.x0 - call.to.x, 0, call.to.x - call.box.x1), Math.max(call.box.y0 - call.to.y, 0, call.to.y - call.box.y1));
  assert.ok(toBox < 0.5 * fs, 'and ends by the words');
  // Kept in view: a ring at the edge writes its words inward.
  const edge = bestSpotPlace({ ring: { x: 68, y: 2 }, r, fs, view });
  assert.ok(edge.box.x1 <= 70 + 1e-6 && edge.box.y0 >= -1e-6, `in view (${edge.kind} ${edge.side})`);
  // The ball and its halo count as much as a player, the arrow a little.
  const ball = { x0: 27, x1: 33, y0: 33, y1: 37 };
  assert.ok(!over(bestSpotPlace({ ring, r, fs, view, ball }).box, ball), 'off the ball');
});

test('player play: Full time\'s "Best move" is a move with a capital, from what the reveal praised', () => {
  const s = authored.find((d) => d.id === 'm1-07-d3-dm');
  const scene = repScene(s, { formations });
  const best = revealFor(s, scene, scene.ghost.spot, { principles: byId });
  assert.equal(best.stars, 3);
  assert.equal(best.move, 'Back up your buddy', 'the drill\'s idea (D3), by its simple name');
  const m = fullTimeModel({ reps: [{ stars: 3, title: repTitle(s, byId), move: best.move }] });
  assert.equal(FULLTIME.bestMove(m.best), 'Best move: Back up your buddy');
  // Every authored drill's best spot: a move with a capital, never a lower-cased praise line.
  for (const d of authored) {
    const sc = repScene(d, { formations });
    const rv = revealFor(d, sc, sc.ghost.spot, { principles: byId });
    if (rv.move === null) continue;
    assert.match(rv.move, /^[A-Z]/, `${d.id}: "${rv.move}"`);
    assert.ok(usableText(rv.move, PLAY_DEFAULTS.moveMaxWords), `${d.id}: "${rv.move}"`);
    assert.doesNotMatch(rv.move, /^The ball\b|^Good\b/, `${d.id}: "${rv.move}" is a move`);
  }
});

// ---------------------------------------------------------------- mount: a whole set on a fake page (Node)

// The fake page and the recording board are shared with the pass mount test (tests/player-mount.js).

test('player play: mounted, a whole set draws, freezes, judges and replays only each rep\'s cast; Try again plays its twin at the same stage', async () => {
  if (!isNode) return; // (the browser has a real page: this drives play.js mount on a fake one)
  const page = fakePage();
  const { normalizePrinciples, normalizeScenarioIndex, createScenarioStore } = await import('../js/data.js');
  const { mount } = await import('../js/ui/player/play.js');
  const mem = new Map();
  const store = { get: (k, f = null) => (mem.has(k) ? JSON.parse(mem.get(k)) : f), set: (k, v) => { mem.set(k, JSON.stringify(v)); return true; }, remove: (k) => mem.delete(k) };
  // A defender who has played "Close Them Down" once, 1 star: the plan is small, small, bigger, bigger, full.
  store.set('player', { version: 1, group: 'DEF', role: 'LB', onboarded: true, road: { 'close-down': { stars: 1, plays: 1 } } });
  const roadData = Road.normalizeRoad(await loadJSON('data/road.json'));
  const root = page.doc.createElement('div');
  page.doc.body.append(root);
  const phaseOf = () => root.querySelector('.pl')?.dataset.phase ?? null;
  const cardOf = () => `${root.querySelector('.pl-card-text')?.textContent ?? ''}|${root.querySelector('.pl-card')?.dataset.stage ?? ''}`;
  let board = null, ghostAt = null;
  const app = {
    data: {
      formations, principles: normalizePrinciples(catalogue), road: roadData,
      scenarios: createScenarioStore(normalizeScenarioIndex(scenarioIndex), (path) => loadJSON(path)),
    },
    store, settings: { mode: 'player', sound: false }, sound: { play() {} }, celebrate: { show() {} }, navigate() {},
    createBoard: () => {
      board = recordingBoard(page, phaseOf, cardOf);
      board.setGhost = (p) => { ghostAt = p ? { x: p.x, y: p.y } : null; }; // (the best-spot ring: where the green is round)
      return board;
    },
  };
  const warn = console.warn, info = console.info;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  console.info = () => {};
  let unmount = null;
  try {
    mount(root, app, ['close-down']).then((u) => { unmount = u; });
    assert.ok(await page.clock.until(() => unmount !== null && !!board), 'the set is built and on the pitch');
    const click = (sel) => { const b = root.querySelector(sel); assert.ok(b, `${sel} is there`); b.click(); };
    const handled = new Map();
    let reveals = 0, replays = 0, retries = 0;
    // When the role card shows (every step of the clock), and what each reveal first draws (its stars and markers).
    const cardShows = [], answers = [];
    let cardOn = false;
    const step0 = page.clock.step;
    page.clock.step = async (dt) => {
      await step0(dt);
      const c = root.querySelector('.pl-card');
      const on = !!c && !c.hidden;
      if (on && !cardOn) cardShows.push({ t: page.clock.now, card: cardOf() });
      cardOn = on;
    };
    for (let guard = 0; guard < 40; guard++) {
      const ok = await page.clock.until(() => root.querySelector('.ft') || phaseOf() === 'place' || (phaseOf() === 'reveal' && !root.querySelector('.pr.is-busy')));
      assert.ok(ok, `the set moves on (phase ${phaseOf()})`);
      if (root.querySelector('.ft')) break;
      if (phaseOf() === 'place') { click('.pl-lock'); await page.clock.step(); continue; }
      // The reveal: "See what happens" once, then Try again when it is offered (not on a twin), then Next.
      const slot = [...root.querySelectorAll('.pl-dots li')].findIndex((li) => li.classList.contains('is-current'));
      const key = `${slot}:${root.querySelector('.pr-note')?.textContent === PLAY.practiceNote ? 'twin' : 'first'}`;
      const h = handled.get(key) ?? {};
      handled.set(key, h);
      if (!h.seen) {
        h.seen = true; reveals++;
        answers.push({ stars: STAR_WORDS.indexOf(root.querySelector('.pr-word')?.textContent ?? ''), marks: board.log.markers.at(-1)?.list ?? [], ghost: ghostAt, note: root.querySelector('.pr-note')?.textContent ?? '' });
      }
      if (!h.replayed) { h.replayed = true; replays++; click('.pr-replay'); await page.clock.until(() => phaseOf() === 'replay'); continue; }
      if (!h.retried && root.querySelector('.pr-retry')) { h.retried = true; retries++; click('.pr-retry'); await page.clock.until(() => phaseOf() === 'set'); continue; }
      click('.pr-next');
      await page.clock.step();
    }
    assert.ok(root.querySelector('.ft'), 'Full time');
    assert.ok(reveals >= 5 && replays >= 5, `${reveals} reveals, ${replays} replays`);
    assert.ok(retries >= 1, `${retries} Try again (a lock at the start misses)`);
    // The role card shows once the camera has landed (placed then: before, it covered YOU or the ball mid-ease).
    assert.equal(cardShows.length, reveals, 'a role card for every rep played');
    const moves = board.log.camera.filter((c, i, all) => i === 0 || JSON.stringify(c.r) !== JSON.stringify(all[i - 1].r));
    for (const show of cardShows) {
      const last = moves.filter((c) => c.t <= show.t).at(-1);
      if (last) assert.ok(show.t >= last.t + BOARD_DEFAULTS.cameraMs, `"${show.card}" at ${show.t} ms, the camera moved at ${last.t} ms: not before it lands`);
    }
    // Every reveal but a 3-star one labels the ring "Best spot".
    assert.ok(answers.some((a) => a.stars >= 0 && a.stars < 3), 'a miss among the reveals');
    for (const [i, a] of answers.entries()) {
      assert.ok(a.stars >= 0, `reveal ${i + 1}: its word`);
      const label = a.marks.find((m) => m.type === 'label' && m.text === PLAY.bestSpot);
      if (a.stars < 3) assert.ok(label, `reveal ${i + 1} (${a.stars} stars): "Best spot" on the ring`);
      // The right area: every reveal draws the green round the best-spot ring; after a miss the arrow points into it.
      const zone = a.marks.find((m) => m.type === 'zone');
      assert.ok(zone && zone.points.length >= 24 && a.ghost && insideOutline(zone.points, a.ghost), `reveal ${i + 1}: the green, with the best spot inside it`);
      const arrow = a.marks.find((m) => m.type === 'arrow');
      if (a.stars < 3 && arrow) {
        const edge = nearestOnOutline(zone.points, arrow.to);
        assert.ok(insideOutline(zone.points, arrow.to) && Math.hypot(edge.x - arrow.to.x, edge.y - arrow.to.y) <= PLAY_DEFAULTS.zoneArrowIn + 0.01, `reveal ${i + 1}: the arrow ends just inside the green's edge`);
      }
      if (a.stars === 3) assert.ok(!arrow && !label, `reveal ${i + 1}: in the green nothing more (no arrow, no words)`);
    }
    // Locked in at the start (this test never moves YOU): 0 stars every time, and the set's first reveal says what the green is.
    assert.ok(answers.every((a) => a.stars === 0), `standing still is never right: ${answers.map((a) => a.stars).join(', ')}`);
    assert.equal(answers[0].note, PLAY.greenIsRight);

    // One segment of renders per rep played (a first try or its twin), from its role card to the next.
    const segs = [];
    for (const r of board.log.renders) {
      if (r.ph === 'set' && (!segs.length || segs.at(-1).at(-1).ph !== 'set')) segs.push([]);
      segs.at(-1)?.push(r);
    }
    assert.equal(segs.length, reveals, 'a role card for every rep');
    const stageOf = (card) => (/\|full$/.test(card) ? 'full' : /\|small$/.test(card) ? 'small' : /\|medium$/.test(card) ? 'medium' : null);
    const played = [];
    for (const [i, seg] of segs.entries()) {
      // The card as the watch began (the role card's words are written just after its first frame is drawn).
      const card = seg.find((r) => r.ph === 'watch')?.card ?? seg.at(-1).card;
      const ids = seg[0].ids.join(',');
      const phases = new Set(seg.map((r) => r.ph));
      for (const want of ['set', 'watch', 'freeze', 'reveal', 'replay']) assert.ok(phases.has(want), `rep ${i + 1}: drawn in ${want} (${[...phases].join(', ')})`);
      // Every picture of the rep, the watch, the freeze, the answer and "See what happens", shows the same players.
      for (const r of seg) assert.equal(r.ids.join(','), ids, `rep ${i + 1} (${card}): the ${r.ph} draws only the cast (${r.ids.length} players, not ${seg[0].ids.length})`);
      assert.ok(seg.every((r) => r.learner && seg[0].ids.includes(r.learner)), `rep ${i + 1}: YOU are in it`);
      const n = seg[0].ids.length;
      const stage = stageOf(card);
      assert.ok(stage, `rep ${i + 1}: the card carries the stage (${card})`);
      if (stage === 'full') assert.equal(n, 22, `rep ${i + 1}: the full match`);
      else assert.ok(stage === 'small' ? n >= 3 && n <= 6 : n >= 6 && n <= 12, `rep ${i + 1}: ${n} players in a ${stage} game`);
      played.push({ card, stage, n, twin: /Same play, other side/.test(card), ids: seg[0].ids });
    }
    // Try again's twin: the same stage and the same number of players as its first try.
    for (const [i, p] of played.entries()) {
      if (!p.twin) continue;
      const firstTry = played[i - 1];
      assert.ok(firstTry && !firstTry.twin, 'a twin follows its first try');
      assert.equal(p.stage, firstTry.stage, `the twin plays the first try's stage (${firstTry.card} → ${p.card})`);
      assert.equal(p.n, firstTry.n, 'with as many players');
    }
    assert.ok(played.some((p) => p.stage === 'small') && played.some((p) => p.stage !== 'small'), `small and bigger games: ${played.map((p) => p.stage).join(', ')}`);
    // Markers, the drag and the spotlight name only players the rep shows; a small or bigger game has a camera and
    // no spotlight, the full match the spotlight and no camera.
    const everyone = new Set(played.flatMap((p) => p.ids));
    for (const m of board.log.markers) for (const id of m.ids) assert.ok(everyone.has(id), `a marker on ${id}, who is never drawn`);
    for (const d of board.log.drag) assert.equal(d.ids.length, 1, 'only YOU can be moved');
    for (const s of board.log.spot) for (const id of s.ids ?? []) assert.ok(everyone.has(id), `the spotlight on ${id}`);
    assert.ok(board.log.camera.some((c) => c.r) && board.log.camera.some((c) => c.ph === 'freeze' && c.r), 'the camera fits a small game, and eases in at the whistle');
    assert.ok(warnings.every((w) => !/could not|not valid|stopped/.test(w)), `no failures: ${warnings.join(' / ')}`);
  } finally {
    console.warn = warn;
    console.info = info;
    try { unmount?.(); } catch { /* gone */ }
    page.restore();
  }
});

/**
 * The first set's worked example mounted on a fake page (Node): the green round the ring, the glow told by the right
 * area, then YOU put 3 m off the best spot the way the green reaches furthest and locked in. `reduced`: under reduced
 * motion there is no hand, and the tip says the green is right at once.
 */
async function workedExample({ reduced = false } = {}) {
  const page = fakePage();
  const { normalizePrinciples, normalizeScenarioIndex, createScenarioStore } = await import('../js/data.js');
  const { mount } = await import('../js/ui/player/play.js');
  const mem = new Map();
  const store = { get: (k, f = null) => (mem.has(k) ? JSON.parse(mem.get(k)) : f), set: (k, v) => { mem.set(k, JSON.stringify(v)); return true; }, remove: (k) => mem.delete(k) };
  store.set('player', { version: 1, group: 'MID', role: 'LCM', onboarded: true, road: {} });
  const roadData = Road.normalizeRoad(await loadJSON('data/road.json'));
  const root = page.doc.createElement('div');
  page.doc.body.append(root);
  const phaseOf = () => root.querySelector('.pl')?.dataset.phase ?? null;
  let board = null, ghostAt = null, drag = null, aid = null, hand = 0;
  const app = {
    data: {
      formations, principles: normalizePrinciples(catalogue), road: roadData,
      scenarios: createScenarioStore(normalizeScenarioIndex(scenarioIndex), (path) => loadJSON(path)),
    },
    store, settings: { mode: 'player', sound: false, reducedMotion: reduced }, sound: { play() {} }, celebrate: { show() {} }, navigate() {},
    createBoard: () => {
      board = recordingBoard(page, phaseOf);
      board.setGhost = (p) => { ghostAt = p ? { x: p.x, y: p.y } : null; };
      const en = board.enableDrag;
      board.enableDrag = (o) => { drag = o; en(o); };
      board.setAid = (a) => { aid = a; };
      board.showHintHand = () => { hand++; return Promise.resolve(); };
      return board;
    },
  };
  const warn = console.warn, info = console.info;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  console.info = () => {};
  let unmount = null;
  try {
    mount(root, app, ['first']).then((u) => { unmount = u; });
    assert.ok(await page.clock.until(() => unmount !== null && phaseOf() === 'place'), 'the worked example reaches the place');
    // The worked example: the green round the ring and an arrow from YOUR start to it; after the hand "Your turn", with
    // no hand (reduced motion) "Anywhere in the green is right. Move YOU there."
    assert.equal(hand, reduced ? 0 : 1, 'the hand drags YOU once (none under reduced motion)');
    const shown = board.log.markers.at(-1)?.list ?? [];
    const zone = shown.find((m) => m.type === 'zone');
    assert.ok(zone && ghostAt && insideOutline(zone.points, ghostAt), 'the worked example draws the green with the ring inside');
    assert.ok(shown.some((m) => m.type === 'arrow'), 'and the arrow');
    assert.equal(root.querySelector('.pl-tip')?.textContent, reduced ? PLAY.ringIsBest : PLAY.yourTurnHint);
    // The glow (the first set's aid) is told its level by the right area: hot on the ring, cold where YOU started.
    const learner = board.log.renders.at(-1).learner;
    const start = board.log.renders.at(-1).at[learner];
    assert.equal(aid?.kind, 'glow');
    assert.equal(typeof aid.levelAt, 'function');
    assert.equal(aid.levelAt(ghostAt), 'hot');
    assert.equal(aid.levelAt(start), 'cold');
    // YOU 3 m from the best spot, the way the green reaches furthest (inside it), then Lock it.
    const far = zone.points.map((v) => ({ v, d: Math.hypot(v.x - ghostAt.x, v.y - ghostAt.y) })).sort((a, b) => b.d - a.d)[0];
    assert.ok(far.d >= 3.3, `the green reaches ${far.d.toFixed(1)} m from the best spot`);
    const spot = { x: ghostAt.x + ((far.v.x - ghostAt.x) * 3) / far.d, y: ghostAt.y + ((far.v.y - ghostAt.y) * 3) / far.d };
    assert.ok(insideOutline(zone.points, spot));
    drag.onEnd(learner, spot);
    await page.clock.step();
    assert.equal((board.log.markers.at(-1)?.list ?? []).length, 0, 'moved: the worked example\'s answer goes');
    assert.equal(aid.levelAt(spot), 'hot', 'the glow is hot there');
    root.querySelector('.pl-lock').click();
    assert.ok(await page.clock.until(() => phaseOf() === 'reveal' && !!root.querySelector('.pr-word')), 'the reveal');
    await page.clock.until(() => false, { maxMs: 400 }); // (the markers placed again once the camera has landed)
    assert.equal(root.querySelector('.pr-word').textContent, 'Spot on', `3 m off, in the green: ${root.querySelector('.pr-line')?.textContent}`);
    const marks = board.log.markers.at(-1)?.list ?? [];
    const green = marks.find((m) => m.type === 'zone');
    assert.ok(green && insideOutline(green.points, spot) && insideOutline(green.points, ghostAt), 'the green is drawn, YOU and the ring in it');
    assert.ok(!marks.some((m) => m.type === 'arrow'), 'no arrow in the green');
    assert.ok(!marks.some((m) => m.type === 'label' && m.text === PLAY.bestSpot), 'no "Best spot" words: the stars say it');
    assert.equal(root.querySelector('.pr-note')?.textContent, PLAY.greenIsRight, 'the set\'s first reveal: "Anywhere in the green is right."');
    assert.ok(warnings.every((w) => !/could not|not valid|stopped|no green/.test(w)), `no failures: ${warnings.join(' / ')}`);
  } finally {
    console.warn = warn;
    console.info = info;
    try { unmount?.(); } catch { /* gone */ }
    page.restore();
  }
}

test('player play: mounted, the worked example shows the green, and YOU placed 3 m off the best spot inside it gets 3 stars and the green', async () => {
  if (!isNode) return; // (a fake page in Node, as above)
  await workedExample();
});

test('player play: mounted under reduced motion, the worked example has no hand and says the green is right at once', async () => {
  if (!isNode) return;
  await workedExample({ reduced: true });
});
