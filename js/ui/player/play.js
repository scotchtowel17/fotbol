// Player mode: "Find your spot" (docs/KID_REDESIGN.md §4.1 step 3, §4.3, §4.5).
//
//   #/play            the next node on the Road (road.js nextNode)
//   #/play/<nodeId>   that node (a locked or unknown node plays the next one instead: never a dead end)
//   #/play/first      the first set: 3 easy reps for your position. Rep 1 is a worked example (a hand drags YOU to
//                     the best spot, YOU snaps back, "Your turn"), rep 2 has the glow aid, rep 3 none. Then Full time,
//                     then #/kickoff/kit.
//
// A set is 5 reps from road.js buildSet (a 'pass' node goes to #/pass), each played as a small game, a bigger game or
// the full match (docs/PROGRESSIVE_FIELD.md §1-§5): the stage the rep wants is its slot's in the Road's plan (the first
// set: small x 3); cast.js bestStage stages it ahead of time (that stage, else the next bigger one that teaches the
// same lesson) and a staged rep is played, frozen, judged and revealed on REDUCED frames: players outside its cast are
// not drawn and not scored. A small or bigger game has a camera that fits the cast, the ball, YOUR start and the best
// spot for the whole clip (stageCamera: big figures, steady through the play, easing between reps), and at the whistle
// eases in on the freeze (answerCamera: where YOU decide and see the answer; "See what happens" plays on the clip's);
// YOU walked to its edge widen it, head and tag included (keepInView). The full match keeps the pitch-length crop and
// the spotlight. Try again keeps the first try's stage. The pitch has tabletop figures and the easy-to-see ball
// (board.js figures). One rep, about 20 s:
//   set     the role card over the pitch once the camera has landed, where it covers nobody (cardSpot: the top or
//           bottom, a band between the players, an edge; else least of YOU, the ball, the player on it, the rest)
//           ("You're the left back"; "Now you're the striker" when the position is not your own) with the stage in a
//           few words ("Small game: 3 v 2", "Bigger game: 6 v 5", "Full match"; the first rep of a bigger stage in the
//           set: "Now 6 v 5!") while YOU pulses
//   watch   play runs to the freeze; YOU stand where you started (caught watching); at the full match only YOU, the
//           ball and up to 4 key players are lit, the rest at 40 % (board.setSpotlight); the brief is the one line
//   freeze  the whistle; the question (12 words or fewer); a small or bigger game's camera eases in on the freeze
//           (and keeps the sideline in view when the words talk about it)
//   move    drag YOU, tap YOU then a spot, or just tap a spot; "Watch again"; the glow aid on early reps
//   lock    "Lock it" (or Enter); no confidence step. YOU picked up (a tap on YOU) but not moved: Lock it points to
//           the tip ("Tap where you want to go.") instead of locking the start
//   reveal  the best-spot ring and an arrow from your spot on the pitch, "Best spot" by the ring (or a callout with a
//           leader line when nowhere by it is clear: bestSpotPlace) on every reveal but a 3-star one with YOU on it,
//           and at most one cue, labelled in plain words (cueMarker); stars, one word and one line
//           (js/ui/player/reveal.js); Next · Why? · Try again (0-1 stars: the mirrored twin, "Same play, other side")
//           · See what happens
// Words that name a group ("their winger") name the player by shirt number when the game shows more than one of them
// ("their number 7": repSpeaker, from the rule or the words that say who is on the ball, never a guess); a line or a
// Why? sentence that cannot say whom it means is not shown (the next one says it), a question asks the default one.
// After a miss, once a set: "Hard one. Pros miss it too." (R20). Stars judge the right AREA, not one exact point
// (js/engine/kidscore.js: 3 anywhere in the green round the best spot, 2 just outside it, 0 where you started, at
// most 1 past a key line such as offside or the wrong side of your man); the reveal draws the green (the 3-star
// outline: zoneOf) with the best-spot ring inside it, and after a miss an arrow from YOU into its nearest edge; the
// set's first reveal says "Anywhere in the green is right." Coach mode keeps its strict 0-100 score. Letters, "/100",
// codes and metres never show. The words match the stars (pickLine, whyFor): 3 stars get praise only, 2 stars one fix
// at most (a key's first), and the drill's own ideas come before any other rule's.
//
// What a rep counts for is recordPolicy's call. A counted first try updates Elo, the history and the streaks exactly
// as a Coach-mode drill does (js/ui/modes/drill.js), awards the rep and any sticker its mastery earned (celebrate:
// false: Full time shows them) and may get the set's one big celebration. Try again is practice only, as in "Who's
// open?": nothing is recorded, it never celebrates, and the slot keeps the first try's stars (the tally, Full time,
// the Road), so copying the ring you were just shown is never worth more than getting it right first time.
// Everything a rep records follows the stars the kid saw (recordOf): award() gets those `stars`, and the score that
// stands for them is kidScore(stars, Coach score): Coach mode's score held inside the band of those stars (0-54, 55-74,
// 75-89, 90-100), so starsForScore(kidScore) always equals the stars shown; Elo learns score01 = kidScore / 100 and the
// streak that score. The history keeps Coach mode's strict score and grade beside the `stars` (stickers read them).
// Worked-example and glow-aided reps teach; they skip Elo (and, in the first set, which is the tutorial, the XP too:
// R28). The set ends with road.recordSet and showFullTime. Leaving a set early (the X, Back, anything) keeps what was
// played (R37, ICO standard 5: quit at any time without losing progress): the Road records the reps locked in so far
// (their stars, as a shorter set) and the play time counts toward the break nudge; no "are you sure?" step.
//
// Pure helpers (exported for tests/player-play.test.js) come first; nothing touches the DOM at import time.

import { el, button, icon, notice, linkButton, announce } from '../components.js';
import { BALL_ID, project, unproject, CAMERA_MIN, BOARD_DEFAULTS, shirtNumberOf } from '../board.js';
import { nameOf, kidNameOf } from '../../engine/rules/_util.js';
import { frameAt, learnerBaseAt, timing } from '../../engine/timeline.js';
import { bestStage, reduceFrame, STAGES, lessonOf } from '../../engine/cast.js';
import { kidArea, kidStars, kidOutline, KID_LEVELS, KID_DEFAULTS } from '../../engine/kidscore.js'; // Player mode's judgement: the right area
import { normalizeScenario, mirrorScenario, validateScenario, learnerId as learnerIdOf } from '../../engine/scenario.js';
import { buildContext } from '../../engine/context.js';
import { computeGhost } from '../../engine/ghost.js';
import { toleranceFor } from '../../engine/score.js';
import { judgeSpot } from '../../engine/analyse.js';
import { explain, EXPLAIN_DEFAULTS, ZONE_REASON } from '../../engine/explain.js';
import { RULES_BY_ID } from '../../engine/rules/index.js';
import { update as eloUpdate, mastery } from '../../engine/elo.js';
import { familyOf } from '../../engine/roles.js';
import { MID_Y, WIDTH, LENGTH } from '../../engine/pitch.js';
import { dist } from '../../engine/geometry.js';
import * as Rewards from '../../rewards.js';
import { award, loadRewards, mergeGains, emptyGains } from '../rewards-store.js';
import { reducedMotion } from '../celebrate.js';
import * as S from '../session.js';
import * as roadMod from './road.js';
import { createPlayerReveal } from './reveal.js';
import { showFullTime, addPlayTime, sentenceCase } from './fulltime.js';
import { STRINGS as SHARED, roleCard, starWord } from './strings.js';

export const PLAY_DEFAULTS = Object.freeze({
  setReps: 5, // [S] §3: a set is 5 reps
  firstReps: 3, // [S] §4.1: the first set is 3 easy reps
  starsAt: Rewards.REWARDS_DEFAULTS.starAt, // [S] = rewards.js starAt (one source: the duplicate table went with the 2026-10-01 audit); kidScore's band edges
  roleCardMs: 1300, // [S] §4.3 step 1: the role card shows for about 1 s...
  roleChangedMs: 2300, // [D] ...longer when the position changed ("Now you're the striker")
  exampleDelayMs: 700, // [D] the worked example's hand starts this long after the freeze
  glowReps: 2, // [D] the first time through a node, its first reps have the glow aid (faded after: R15)
  keyPlayers: 4, // [S] §4.3 step 2: up to 4 key players lit
  maxFrameDt: 1, // [D] s of play per animation frame at most: slow or throttled frames keep real time (a tab coming back
  //               from hidden restarts the clock instead, so it never jumps to the freeze)
  minContinuation: 0.5, // [D] s: a shorter continuation replays the lead-up instead
  replayLead: 3, // [D] s of lead-up replayed then
  replayHoldMs: 700, // [D] the last replay frame holds this long before the answer comes back
  focusStep: 0.5, // [D] s between the frames sampled for the pitch length a rep keeps in view on a phone
  labelClear: 3.5, // [D] metres (times the board's token scale): nearer than this to the ring, "Best spot" is not written over YOU
  labelBelow: 1, // [D] metres (times the token scale): YOU no lower than this below the ring on the screen: "Best spot" goes under it
  questionMaxWords: 12, // [S] R2
  briefMaxWords: 12, // [S] R2
  lineMaxWords: 14, // [S] R2
  maxRepMs: 3 * 60 * 1000, // [D] one rep counts at most this much play time (a tab left open is not play)
  whyMaxWords: 20, // [D] a reason, praise line or summary longer than this never goes on the Why? sheet
  whyBecauseMaxWords: 30, // [D] the principle's own why line (the longest today is 29 words); past this it stays off the sheet
  demoTitleMs: 2600, // [D] the lesson card (the idea's name and summary) before the demo clip; a tap goes sooner
  demoSlideMs: 950, // [D] YOU walks to the best spot in the demo over this long
  demoDwellMs: 3400, // [D] the because line holds before "Your turn" goes on its own; a tap goes sooner
  moveMaxWords: 12, // [D] Full time's "Best move: ..." (2 words) stays within a 14-word line (R2)
  cueLabelSide: 6, // [D] metres in from the touchline away from the ball: where a cue line's label sits
  cameraStep: 0.5, // [D] s between the frames sampled for a small or bigger game's camera (one rect for the whole clip)
  stageAheadMs: 700, // [D] the next rep is staged (cast.js bestStage: up to ~120 ms on a slow phone) this long after a reveal
  //                    shows, when its stars have popped; the set's first rep while the pitch is getting ready
  viewSlack: 1.5, // [D] metres: YOU (the figure and YOUR tag) moved this close to the edge of a small game's view widens the camera
  twinAheadMs: 150, // [D] after a miss (Try again offered: 0-1 stars, a quiet reveal) its twin is staged this soon after the reveal
  //                  shows, and kept staging when Try again comes first (a quick tap no longer waits for the staging)
  cardGapPx: 12, // [D] CSS px: the role card sits this far in from the top or bottom of the pitch...
  cardClearPx: 8, // [D] ...keeping this far off YOU, the ball and the other players (cardSpot)...
  cardWeights: Object.freeze({ you: 4, ball: 4, key: 1, other: 0.4 }), // [D] ...what covering each costs, per CSS px²: YOU
  //   (with your tag) and the ball most, then the player on the ball (key), then anyone else (a place covering nobody wins)
  cardSettleMs: 60, // [D] the role card waits this long after the camera has landed (and the board has its size) to be placed
  // "Best spot" on the ring (bestSpotPlace): the label's box, as pass.js measures its labels in Chrome [M], and where it goes
  labelEm: 0.66, // [M] = pass.js PASS_DEFAULTS.labelEm: a label's width per character, in its font size...
  labelAscent: 1, // [M] ...its drawn box above the baseline...
  labelDescent: 0.25, // [M] ...and below it
  labelFont: 1.5, // [S] css/app.css .mk-label: 1.5 x the board's label scale (--board-label-k), view metres
  labelGap: 0.35, // [D] type heights between the ring (or the end of its leader line) and the words
  calloutSteps: Object.freeze([1.4, 2.6, 4]), // [D] type heights from the ring's rim: where a callout's words may go...
  calloutDirs: 16, // [D] ...in this many directions round the ring
  labelCost: Object.freeze({ you: 12, ball: 6, other: 1, arrow: 0.5, outside: 8, far: 0.01 }), // [D] covering YOU and your tag
  //   (area, as a share of the label), the ball, another player, the arrow, the edge of the view; `far` per type height out
  labelOthersMax: 0.12, // [D] a place by the ring covering at most this share of other players still fits (else a callout)
  // The right area (js/engine/kidscore.js: Player mode judges the right AREA, not one exact point; Coach mode keeps its
  // strict 0-100 score). The reveal draws it as a soft green zone (the 3-star outline, kidOutline) round the best spot.
  zoneArrowIn: 0.75, // [D] metres: after a miss the arrow runs from YOU to the green's nearest edge and this far on into it
});

export const STRINGS = Object.freeze({
  question: SHARED.question,
  whereNow: 'Where now?', // a question that names its player by number and so runs past 12 words ends this way
  watch: 'Watch the play.',
  lockIt: SHARED.lockIt,
  watchAgain: SHARED.watchAgain,
  tapHint: 'Drag YOU, or tap where you want to go.',
  armedHint: 'Now tap a spot.',
  tapWhere: 'Tap where you want to go.',
  keysHint: 'Arrow keys move YOU. Enter locks it.',
  watchThis: 'Watch this.',
  yourTurnHint: 'Your turn: drag YOU, or tap a spot.',
  ringIsBest: 'Anywhere in the green is right. Move YOU there.',
  glowHint: 'Your ring turns green in the right area.',
  greenIsRight: SHARED.greenIsRight, // the tip on the set's first reveal: the green zone is the answer, not one exact spot
  otherSide: 'Same play, other side',
  practiceNote: 'Practice only. Your first try counts.',
  warmupNote: 'Warm-up. Stars count from the next play.',
  watchFirst: 'Watch first',
  yourTurn: 'Your turn',
  demoSr: (name = 'this idea') => `Watch first: ${name}. Watch YOU move to the best spot.`,
  missNote: SHARED.missNote,
  // The reveal's line when no reason or praise fits (pickLine), by stars
  lineInGreen: 'You found the right area.', // 3 stars
  lineNear: 'One more step into the green.', // 2 stars
  lineClose: 'The green shows where to be.', // 0-1 star
  lineStill: 'You stayed where you started. Move with the play.', // locked in at your start (0 stars)
  bestSpot: SHARED.bestSpot,
  // A player named by their shirt number when the game shows more than one of their group ("their number 7")
  theirNumber: (n) => `their number ${n}`,
  yourNumber: (n) => `your number ${n}`,
  // Far from your spot in a small or bigger game (the whole team's shape is not on show): Slide as a Team, in its words
  zoneLine: 'Slide with the ball, back to your own spot.',
  // The words on a cue line at the reveal (cueMarker): whose line it is, or which pass
  cue: Object.freeze({
    yourDefenders: 'Your defenders',
    yourMidfielders: 'Your midfielders',
    theirMidfielders: 'Their midfielders',
    theirLast: 'Their last defender',
    offside: 'Offside line',
    passToYou: 'Pass to you',
    passTo: (who) => `Pass to ${who}`,
    sideline: 'Sideline',
  }),
  seeWhat: SHARED.seeWhat,
  stop: SHARED.stop,
  playOf: (i, n) => `Play ${i} of ${n}`,
  loading: SHARED.loading,
  emptyTitle: 'No plays here yet',
  emptyText: 'Try the next one on the Road.',
  failedTitle: 'Something went wrong',
  failedText: 'Go home and try again.',
  home: SHARED.home,
  next: SHARED.next,
});

// ---------------------------------------------------------------- pure helpers

const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
const METRES = /\d\s?m\b|\bmetres?\b|\bmeters?\b/i;
const CODES = /\b[A-Z]{1,2}\d{1,2}\b|#\d/;
// A letter grade: a capital S, A, B, C, D or F standing alone and not starting a phrase ("You got an F.", "Grade: A"),
// or after "a" / "an" ("an A on it"). The article "A" ("A cross is coming.", "A pass across is your signal") is a
// capital letter followed by a lower-case word, so it is never a grade.
const GRADE = /\b[SABCDF]\b(?!['’]|\s+[a-z])|\ban? [SABCDF]\b|\/\s?100/;

/** Can this text be shown in Player mode as it is: a sentence of at most `max` words, with no metres, codes or grades? */
export function usableText(s, max = PLAY_DEFAULTS.lineMaxWords) {
  if (typeof s !== 'string' || !s.trim()) return false;
  return words(s) <= max && !METRES.test(s) && !CODES.test(s) && !GRADE.test(s);
}

/** Stars for a score (§6.3): rewards.js starsForScore (a static import: no fallback band table, audit 2026-10-01). */
export function starsForScore(score) {
  return Math.max(0, Math.min(3, Math.round(Rewards.starsForScore(score)) || 0));
}

/** The word for 0-3 stars (§6.3): rewards.js wordForStars. */
export const wordForStars = (stars) => Rewards.wordForStars(stars);

/** The question at the freeze: the scenario's simple one when it fits (≤ 12 words, no codes), else the default. */
export function questionFor(scenario) {
  const q = scenario?.questionKid;
  return usableText(q, PLAY_DEFAULTS.questionMaxWords) ? q.trim() : STRINGS.question;
}

/** The one line while the play runs: the scenario's simple brief when it fits, else "Watch the play." */
export function briefFor(scenario) {
  const b = scenario?.briefKid;
  return usableText(b, PLAY_DEFAULTS.briefMaxWords) ? b.trim() : STRINGS.watch;
}

/** The drill's own lesson in simple words (its takeaway), when it fits a line (≤ 14 words, no codes), else ''. */
export function takeawayFor(scenario) {
  const t = S.wordingOf(scenario?.takeaway, 'kid');
  return usableText(t, PLAY_DEFAULTS.lineMaxWords) ? t.trim() : '';
}

const textOf = (r) => (typeof r === 'string' ? r : typeof r?.text === 'string' ? r.text : '');

/** The ideas (principle ids) a reason or a praise line is about: its own, and every idea its rule checks. */
export function ideasOf(r) {
  if (!r || typeof r !== 'object') return [];
  const rule = r.ruleId === ZONE_REASON.id ? ZONE_REASON : RULES_BY_ID[r.ruleId];
  return [...new Set([r.principleId, ...(r.principles ?? []), ...(rule?.principles ?? [])].filter((id) => typeof id === 'string'))];
}

/** A list with the items about the drill's own ideas (`own`) first, each part in its old order (pure). */
function drillFirst(list, own = []) {
  const mine = (r) => own.length > 0 && ideasOf(r).some((id) => own.includes(id));
  return [...list.filter(mine), ...list.filter((r) => !mine(r))];
}

/**
 * The praise of a judged spot with the rule and ideas each line comes from (explain.js praise keeps only the words),
 * in explain.js order: the heaviest rule first. @returns {{ text: string, ruleId: string, principles: string[] }[]}
 */
export function praiseOf(result, P = EXPLAIN_DEFAULTS) {
  const sentence = (s) => (s ? s[0].toUpperCase() + s.slice(1) + (/[.!?…]$/.test(s) ? '' : '.') : '');
  return (result?.rules ?? [])
    .filter((r) => !r.critical && r.s >= P.praiseAt)
    .sort((a, b) => b.weight - a.weight || b.s - a.s)
    .map((r) => {
      let t = '';
      try { t = RULES_BY_ID[r.id]?.text?.kid?.ok?.(r.vars ?? {}) ?? ''; } catch { t = ''; }
      return { text: sentence(typeof t === 'string' ? t.trim() : ''), ruleId: r.id, principles: [...(r.principles ?? RULES_BY_ID[r.id]?.principles ?? [])] };
    })
    .filter((p) => p.text);
}

/**
 * The reveal's one line (≤ 14 words, simple wording, no metres or codes), matched to the stars (R17, R19) of Player
 * mode's right area (js/engine/kidscore.js kidStars). `own` is the drill's ideas (scenario.principles): a line about
 * them comes before one about any other rule. `key` is the fix of the key the spot broke (a side, an order or a line
 * no distance forgives: offside, the wrong side of your man, the lesson clearly failed: kidStars' reason), said first.
 *   3 stars   praise only, for what you got right ("You found the right area." when none fits)
 *   still     you locked in where you started: "You stayed where you started. Move with the play."
 *   2 stars   one fix: the key's, else the top reason about the drill's ideas, else any other ("One more step into the
 *             green." when none fits)
 *   0-1 star  the key's fix, else the drill's note on the mistake you made (its misconception), else the top reason
 *             about the drill's ideas, else the drill's own lesson (its takeaway), else any other reason ("The green
 *             shows where to be." when none fits)
 * @param {{ feedback?: object, reasons?: object[], praise?: (string|object)[], misconception?: string|null, stars: number,
 *   principles?: string[], takeaway?: string, key?: string|null, still?: boolean }} m  feedback: judgeSpot's, in kid
 *   wording; reasons (default feedback.reasons): explain.js reasons, more than the one kid feedback keeps; praise
 *   (default feedback.praise): praiseOf, so a line can be matched to its idea
 */
export function pickLine({ feedback = null, reasons, praise, misconception = null, stars = 0, principles: own = [], takeaway = '', key = null, still = false } = {}) {
  const ok = (s) => usableText(s, PLAY_DEFAULTS.lineMaxWords);
  const ideas = Array.isArray(own) ? own : [];
  if (stars >= 3) return drillFirst(praise ?? feedback?.praise ?? [], ideas).map(textOf).find(ok) ?? STRINGS.lineInGreen;
  if (still) return STRINGS.lineStill;
  const list = drillFirst(reasons ?? feedback?.reasons ?? [], ideas);
  const about = list.filter((r) => ideas.length && ideasOf(r).some((id) => ideas.includes(id))).map(textOf);
  const rest = list.map(textOf).filter((t) => !about.includes(t));
  const candidates = stars <= 1 ? [key, misconception, ...about, takeaway, ...rest] : [key, ...about, ...rest];
  return candidates.find(ok) ?? (stars >= 2 ? STRINGS.lineNear : STRINGS.lineClose);
}

/**
 * The Why? sheet (§4.3 step 7): the idea's simple name and summary, more reasons (never the line again) and what you
 * did right; reveal.js whyModel trims it to 60 words. The fixes follow the stars, as the line does: none at 3 stars
 * (praise only), one at 2 stars (the line, when the line is one; else one here), up to 2 more after a miss. The
 * drill's own ideas (`principles`) come first.
 * @param {{ principle?: object, reasons?: object[]|string[], praise?: (string|object)[], line?: string, takeaway?: string,
 *   stars?: number, principles?: string[] }} m
 */
export function whyFor({ principle = null, reasons = [], praise = [], line = '', takeaway = '', stars = 0, principles: own = [] } = {}) {
  const ok = (s) => usableText(s, PLAY_DEFAULTS.whyMaxWords);
  const ideas = Array.isArray(own) ? own : [];
  const title = (typeof principle?.kidName === 'string' && principle.kidName) || principle?.short || '';
  const summary = [typeof principle?.summary === 'string' ? principle.summary : principle?.summary?.kid, takeaway].find(ok) ?? '';
  // "A little more explanation" (the owner, 2026-10-01): the idea's own because line, from the principle catalogue.
  const because = [typeof principle?.why === 'string' ? principle.why : principle?.why?.kid]
    .find((s) => usableText(s, PLAY_DEFAULTS.whyBecauseMaxWords) && s !== summary) ?? '';
  const all = drillFirst(reasons ?? [], ideas).map(textOf);
  const fixes = stars >= 3 ? 0 : stars === 2 ? (all.includes(line) ? 0 : 1) : 2;
  const more = all.filter((t) => ok(t) && t !== line).slice(0, fixes);
  const good = drillFirst(praise ?? [], ideas).map(textOf).filter((t) => ok(t) && t !== line).slice(0, 2);
  return { title, summary, because, reasons: more, praise: good };
}

/**
 * What you did best on a rep, for Full time's "Best move" (pure): the move the rep's praise was for, the drill's own
 * ideas first, named as the idea's simple name in sentence case, the move itself ("Back up your buddy", "Stay onside":
 * data/principles.json kidName); a praise line whose idea has no name says what you did as a sentence of its own
 * ("You found your own space."). Never the praise line as it is, lower-cased ("the ball has a clear path to you" is
 * not a move); null with no praise that fits.
 * @param {{ praise?: (string|object)[], principles?: string[], byId?: object }} m  praise: praiseOf's (each line knows
 *   its ideas); principles: the drill's own ideas; byId: data/principles.json by id (the ideas' names)
 */
export function bestMoveOf({ praise = [], principles: own = [], byId = {} } = {}) {
  const ideas = Array.isArray(own) ? own : [];
  for (const p of drillFirst(praise ?? [], ideas)) {
    const its = ideasOf(p);
    const id = its.find((i) => ideas.includes(i) && typeof byId?.[i]?.kidName === 'string') ?? its.find((i) => typeof byId?.[i]?.kidName === 'string');
    const name = id ? sentenceCase(byId[id].kidName) : ''; // "Back Up Your Buddy" → "Back up your buddy"
    if (name && usableText(name, PLAY_DEFAULTS.moveMaxWords)) return name;
    // No name for its idea: what you did, as a sentence ("Good, you found your own space." → "You found your own space.").
    const t = textOf(p).trim().replace(/^(?:good|great|nice)(?:\s+[a-z]+)?,\s*/i, '');
    if (/^you\b/i.test(t) && usableText(t, PLAY_DEFAULTS.moveMaxWords)) return t[0].toUpperCase() + t.slice(1).replace(/[.!]*$/, '.');
  }
  return null;
}

/**
 * The cue at the reveal (R8: the words go on the pitch; 2 highlighted cues at most) as a Player-mode board marker
 * (pure): a ring round a player or a spot as it is; a line (the line of your defenders, a pass...) only with its
 * name in plain words ("Your defenders", "Pass to you"), written away from the ball; a line with no words is dropped,
 * since an unlabelled dashed line explains nothing.
 * @param {{ ruleId?: string, highlight?: object }|null} cue  judgeSpot's feedback.cue
 * @param {{ rules?: object[], ball?: {x:number,y:number}|null, name?: (text: string, ruleId: string) => string|null }} [opts]
 *   rules: the evaluation's results (whose line it is); name: the words with the player they are about named by shirt
 *   number where the game shows more than one of their group (a speaker's `rule`; null: no way to tell who: no label)
 * @returns {object|null}
 */
export function cueMarker(cue, { rules = [], ball = null, name = null } = {}, P = PLAY_DEFAULTS) {
  const hl = cue?.highlight;
  if (!hl || typeof hl !== 'object') return null;
  if (hl.type === 'player' || hl.type === 'point') return { ...hl, tone: 'cue', pulse: false };
  if (hl.type !== 'segment' && hl.type !== 'line-x') return null;
  const vars = (rules ?? []).find((r) => r?.id === cue.ruleId)?.vars ?? {};
  const C = STRINGS.cue;
  const line = hl.type === 'line-x';
  const label = {
    compact: vars.unit === 'mid' ? C.yourDefenders : C.yourMidfielders, // the next line back (a midfielder) or forward
    'level-line': C.yourDefenders,
    'keeps-onside': C.yourDefenders,
    'between-lines': C.theirMidfielders,
    pin: C.theirLast,
    offside: C.offside,
    screen: line ? C.yourDefenders : typeof vars.whoKid === 'string' && vars.whoKid ? C.passTo(vars.whoKid) : null,
    'lane-open': line ? null : C.passToYou,
    width: line ? null : C.sideline,
  }[cue.ruleId] ?? null;
  const named = label && typeof name === 'function' ? name(label, cue.ruleId) : label;
  if (!named) return null;
  const out = { ...hl, tone: 'cue', label: named, clear: 'you' };
  if (line && Number.isFinite(hl.x)) out.labelAt = { x: hl.x, y: Number.isFinite(ball?.y) && ball.y > MID_Y ? P.cueLabelSide : WIDTH - P.cueLabelSide };
  return out;
}

/**
 * "Best spot" on the ring (pure), on the side away from YOU, so the words never cover YOU or YOUR name tag (the tag
 * sits above YOU): under the ring when YOU stand above it on the screen or level with it, over it when YOU are lower;
 * where that side still covers YOU (YOU a little lower, to one side), the board writes it beside the ring (clear).
 * @param {{x:number,y:number}} you  YOUR spot
 * @param {{x:number,y:number}} ring  the best spot
 * @param {{ orientation?: 'horizontal'|'vertical', tokenScale?: number }} [board]
 */
export function bestSpotMarker(you, ring, { orientation = 'horizontal', tokenScale = 1 } = {}, P = PLAY_DEFAULTS) {
  const dy = project(you, orientation).y - project(ring, orientation).y; // > 0: YOU lower on the screen than the ring
  return { type: 'label', at: { x: ring.x, y: ring.y }, text: STRINGS.bestSpot, tone: 'good', lift: 'token', below: dy < P.labelBelow * (tokenScale || 1), clear: 'you' };
}

/**
 * Where "Best spot" goes (pure; view metres, as the board draws them: x across the screen, y down it). By the ring:
 * over it, under it, beside it or running off to one side, the place that covers least (labelCost: YOU and YOUR tag
 * most, then the ball, the other players, the arrow and the edge of the view), when that place covers neither YOU,
 * YOUR tag, the ball nor the edge, and at most labelOthersMax of the other players. Else ('callout') a short way off
 * (calloutSteps type heights out from the ring's rim, calloutDirs ways round, nearest first) with a leader line from
 * the rim to the words, wherever that covers least the same way (the line kept off YOU and YOUR tag too). A ring
 * right by YOU (a 1- or 2-star spot a step off) once had no words at all: the kid had to guess what it was.
 * The box of the words is measured as pass.js measures its labels (labelEm, labelAscent, labelDescent of `fs`).
 * @param {{ ring: {x:number,y:number}, r?: number, fs?: number, text?: string, you?: object[]|object|null,
 *   ball?: object|null, others?: object[], arrow?: { a: {x,y}, b: {x,y} }|null, view?: { x, y, width, height }|null }} o
 *   ring: the best spot; r: the ring's radius as drawn; fs: the words' font size; you: YOU and YOUR tag as drawn
 *   (board.drawnBox: { x0, x1, y0, y1 }); ball: the ball with its halo; others: the other players (base and figure);
 *   arrow: the arrow from YOU to the ring; view: the viewBox the camera lands on
 * @returns {{ kind: 'near'|'callout', side: string, box: object, at: {x:number,y:number}, from?: {x,y}, to?: {x,y},
 *   cost: number, clear: boolean }}  at: where to write the words (board.js drawLabel with no lift: centred, the
 *   baseline 0.8 over it); from, to: a callout's leader line (the ring's rim to the words); clear: it covers neither
 *   YOU, YOUR tag, the ball nor the edge
 */
export function bestSpotPlace({ ring, r = 2, fs = 1.5, text = STRINGS.bestSpot, you = [], ball = null, others = [], arrow = null, view = null } = {}, P = PLAY_DEFAULTS) {
  const fine = (b) => !!b && [b.x0, b.x1, b.y0, b.y1].every(Number.isFinite);
  const w = Math.max(1, [...String(text)].length) * P.labelEm * fs, h = (P.labelAscent + P.labelDescent) * fs, asc = P.labelAscent * fs;
  const area = w * h, g = P.labelGap * fs, C = P.labelCost;
  const yous = (Array.isArray(you) ? you : [you]).filter(fine);
  const rest = (others ?? []).filter(fine);
  const bl = fine(ball) ? ball : null;
  const vr = view && [view.x, view.y, view.width, view.height].every(Number.isFinite) ? { x0: view.x, x1: view.x + view.width, y0: view.y, y1: view.y + view.height } : null;
  const over = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  // A line as small boxes along it: the arrow (words across it hide where it points), a callout's own leader.
  const along = (a, b, t = 0.25) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(len / 0.6));
    return Array.from({ length: n + 1 }, (_, i) => { const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n; return { x0: x - t, x1: x + t, y0: y - t, y1: y + t }; });
  };
  const arrowBits = arrow && isPoint(arrow.a) && isPoint(arrow.b) ? along(arrow.a, arrow.b) : [];
  const judge = (b, extra = 0, leader = []) => {
    const onYou = (yous.reduce((a, q) => a + over(b, q), 0) + leader.reduce((a, s) => a + yous.reduce((c, q) => c + over(s, q), 0), 0)) / area;
    const onBall = bl ? over(b, bl) / area : 0;
    // (A leader line across another player's figure or the ball counts too: less than the words.)
    const onOthers = (rest.reduce((a, q) => a + over(b, q), 0) + leader.reduce((a, l) => a + rest.reduce((c, q) => c + over(l, q), 0) + (bl ? over(l, bl) : 0), 0)) / area;
    const onArrow = arrowBits.reduce((a, q) => a + over(b, q), 0) / area;
    const outside = vr ? Math.max(0, area - over(b, vr)) / area : 0;
    const clear = onYou <= 1e-9 && onBall <= 1e-9 && outside <= 1e-9;
    return { clear, onOthers, cost: C.you * onYou + C.ball * onBall + C.other * onOthers + C.arrow * onArrow + C.outside * outside + extra };
  };
  const at = (b) => ({ x: (b.x0 + b.x1) / 2, y: b.y0 + asc + 0.8 });
  const boxAt = (cx, cy) => ({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 });
  // By the ring (a little per place, for ties: over it, under it, beside it, then running off to one side).
  const run = Math.max(0, w / 2 - r); // running off to one side: the words start over the ring's edge
  const near = [
    ['above', boxAt(ring.x, ring.y - r - g - h / 2), 0], ['below', boxAt(ring.x, ring.y + r + g + h / 2), 0.002],
    ['right', boxAt(ring.x + r + g + w / 2, ring.y), 0.004], ['left', boxAt(ring.x - r - g - w / 2, ring.y), 0.004],
    ['above-right', boxAt(ring.x + run, ring.y - r - g - h / 2), 0.006], ['above-left', boxAt(ring.x - run, ring.y - r - g - h / 2), 0.006],
    ['below-right', boxAt(ring.x + run, ring.y + r + g + h / 2), 0.008], ['below-left', boxAt(ring.x - run, ring.y + r + g + h / 2), 0.008],
  ];
  let best = null, nearClear = null, all = null;
  for (const [side, b, tie] of near) {
    const j = judge(b, tie);
    const pick = { kind: 'near', side, box: b, at: at(b), cost: j.cost, clear: j.clear };
    if (!all || j.cost < all.cost - 1e-9) all = pick;
    if (j.clear && (!nearClear || j.cost < nearClear.cost - 1e-9)) nearClear = pick;
    if (j.clear && j.onOthers <= P.labelOthersMax + 1e-9 && (!best || j.cost < best.cost - 1e-9)) best = pick;
  }
  if (best) return best;
  // A callout: the words a short way off, a leader line from the ring's rim to them.
  let callout = null;
  for (const step of P.calloutSteps) {
    for (let i = 0; i < P.calloutDirs; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / P.calloutDirs; // straight up the screen first
      const ux = Math.cos(a), uy = Math.sin(a);
      // How far the box reaches from its middle along the way out (where the leader meets it).
      const reach = Math.min(Math.abs(ux) > 1e-9 ? w / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? h / 2 / Math.abs(uy) : Infinity);
      const d = r + step * fs + reach;
      const cx = ring.x + ux * d, cy = ring.y + uy * d;
      const b = boxAt(cx, cy);
      const from = { x: ring.x + ux * r, y: ring.y + uy * r }, to = { x: cx - ux * (reach + 0.15 * fs), y: cy - uy * (reach + 0.15 * fs) };
      const j = judge(b, 0.05 + C.far * step, along(from, to, 0.15));
      const pick = { kind: 'callout', side: `${Math.round((a * 180) / Math.PI + 90) % 360}`, box: b, at: at(b), from, to, cost: j.cost, clear: j.clear };
      if (j.clear && (!callout || j.cost < callout.cost - 1e-9)) callout = pick;
      if (!all || j.cost < all.cost - 1e-9) all = pick;
    }
  }
  // A place by the ring over more of another player than a callout would cover still wins when it covers less.
  if (nearClear && (!callout || nearClear.cost <= callout.cost + 1e-9)) return nearClear;
  return callout ?? all;
}

// ---------------------------------------------------------------- who a sentence is about (by shirt number)

/** The kid words for a group of players ("their winger", "your teammate"), and the position families each takes in
 *  (null: any teammate). */
export const KID_GROUPS = Object.freeze({ defender: ['CB', 'FB'], midfielder: ['DM', 'CM'], winger: ['W'], striker: ['ST'], keeper: ['GK'], goalkeeper: ['GK'], teammate: null });
const GROUP_WORDS = /\b(their|your)\s+(other\s+)?(defender|midfielder|winger|striker|keeper|goalkeeper|teammate)\b(?![-\w])/gi;
// The words that say a player is on the ball: a name just before "has the ball", "runs", "passes", "is being chased"...,
// or just after "goes to", "passed it back to", "finds" (who gets it), "chasing", "going to", "close down" (whom you
// press: the player on the ball).
const HOLDS = /^\s+(?:has|had|gets|got|is on|(?:runs|ran|is running)\s+(?:with|at our goal|at goal|past)|is dribbling|dribbles|carries|passes|passed|plays|played|is about to|is looking to|wants to|keeps|turns|turned|beats|beat|wins|won|win|is being chased|is chased)\b/i;
const GETS = /(?:\b(?:goes|go|going|went|comes|came|passed|passes|pass|plays|played|runs|ran|run|running)\s+(?:it\s+)?(?:back\s+|wide\s+|across\s+|out\s+|on\s+|over\s+)?(?:to|at)|\bfinds|\bfound|\bchasing|\bchases|\bchase|\bclose|\bcloses|\bclosing|\bpress|\bpresses|\bpressing)\s+$/i;
const SIDELINE = /\b(?:sideline|touchline)s?\b/i;

/** Do these words talk about the sideline (so it must be in view)? */
export const mentionsSideline = (...texts) => texts.some((t) => typeof t === 'string' && SIDELINE.test(t));

/** The players drawn that a group's words could mean (pure; never YOU): "their winger" → their wingers on show. */
export function groupMembers(players, team, word, learnerId = null) {
  const fams = KID_GROUPS[String(word).toLowerCase()];
  return (players ?? []).filter((p) => p && p.id !== learnerId && p.team === team && (fams === null || fams?.includes(familyOf(p.role))));
}

/**
 * A sentence with the player it is about named by shirt number wherever the picture shows more than one of their
 * group (pure): "Get closer to their winger" with both wingers on show says "Get closer to their number 7"; a group
 * with one player on show keeps its words. Who it is about is known, never guessed: `holders`, the players on the ball
 * (the first of them in the group), wherever the words say the player is on it ("Their defender has the ball", "The
 * ball goes to ...", "... is being chased", "chasing their midfielder"); else `refs`, the players the words' rule is
 * about (ruleRefs: the first in the group); else `pools`, lists of players the words may be about (the drill's
 * scripted players, the players its own ideas are about), the first list with exactly one player of the group in it.
 * @param {string} text
 * @param {{ players?: object[], learnerId?: string|null, youNumber?: number|null, holders?: string[], refs?: string[],
 *   pools?: string[][] }} who  players: the frame as drawn (a small game's cast, or all 22); youNumber: YOUR kit number
 *   (board.js shirtNumberOf: the numbers on the shirts)
 * @returns {{ text: string, ok: boolean }}  ok: false when a group on show more than once could not be pinned to one
 *   player (the words cannot say whom they mean: the caller says something else)
 */
export function nameSpecific(text, { players = [], learnerId = null, youNumber = null, holders = [], refs = [], pools = [] } = {}) {
  if (typeof text !== 'string' || !text) return { text, ok: true };
  let ok = true;
  const out = text.replace(GROUP_WORDS, (m, whose, _other, word, at, all) => {
    const team = whose.toLowerCase() === 'their' ? 'them' : 'us';
    const group = groupMembers(players, team, word, learnerId);
    if (group.length <= 1) return m;
    const inGroup = (id) => typeof id === 'string' && group.some((p) => p.id === id);
    const onBall = HOLDS.test(all.slice(at + m.length)) || GETS.test(all.slice(0, at));
    const pool = (pools ?? []).map((ids) => [...new Set((ids ?? []).filter(inGroup))]).find((ids) => ids.length === 1);
    const id = (onBall ? (holders ?? []).find(inGroup) : null) ?? (refs ?? []).find(inGroup) ?? pool?.[0] ?? null;
    const n = id ? shirtNumberOf(id, { learnerId, youNumber }) : null;
    if (!Number.isInteger(n)) { ok = false; return m; }
    const said = team === 'them' ? STRINGS.theirNumber(n) : STRINGS.yourNumber(n);
    return whose[0] === 'T' || whose[0] === 'Y' ? said[0].toUpperCase() + said.slice(1) : said;
  });
  return { text: out, ok };
}

/**
 * The players a rule's words are about (pure; nameSpecific's refs), most certain first: the player each of its name
 * variables names (who/whoKid, mate/mateKid, ref/refKid), found by the rule's own full name for them (rules/_util.js
 * nameOf) when that is one player on the pitch, or the one its cue rings when that name fits two (their two #8s); then
 * the player its cue rings (rule.cue).
 * @param {string} ruleId
 * @param {{ rules?: object[], ctx?: object|null, spot?: {x,y}|null }} opts  rules: the evaluation's results (the vars)
 * @returns {string[]}
 */
export function ruleRefs(ruleId, { rules = [], ctx = null, spot = null } = {}) {
  const rule = RULES_BY_ID[ruleId];
  const vars = (rules ?? []).find((r) => r?.id === ruleId)?.vars ?? {};
  const players = ctx?.frame?.players ?? [];
  let cueId = null;
  try { const c = ctx ? rule?.cue?.(ctx, spot) : null; if (c?.type === 'player' && typeof c.id === 'string') cueId = c.id; } catch { cueId = null; }
  const out = [];
  for (const [full, kid] of [['who', 'whoKid'], ['mate', 'mateKid'], ['ref', 'refKid']]) {
    if (typeof vars[kid] !== 'string' || typeof vars[full] !== 'string') continue;
    const named = players.filter((p) => { try { return nameOf(p, ctx) === vars[full] && kidNameOf(p, ctx) !== 'you'; } catch { return false; } });
    const id = named.length === 1 ? named[0].id : named.some((p) => p.id === cueId) ? cueId : null;
    if (id && !out.includes(id)) out.push(id);
  }
  if (cueId && !out.includes(cueId)) out.push(cueId);
  return out;
}

/** The players who have the ball in the clip, in the order they get it (its carrier keys). */
const carriersOf = (s) => [...new Set([...(s?.timeline?.carrier ?? [])].filter((k) => typeof k?.id === 'string').sort((a, b) => a.t - b.t).map((k) => k.id))];

/**
 * How a rep says whom it means (pure): the players drawn at the freeze, and those its words are about (nameSpecific).
 *   rule(text, ruleId, rules?, spot?)  a rule's words (a reason, a praise line, a cue's name): the players the rule is
 *                                      about (ruleRefs)
 *   free(text, { holders? })           the drill's own words (the question, a mistake's note, its lesson; the brief):
 *                                      where they say a player is on the ball, the first of `holders` in the group
 *                                      (default: the one on it at the freeze, then the clip's others, the latest
 *                                      first); else the one player of that group the drill scripts (its timeline's
 *                                      overrides: the players it moves on purpose), else the one its own ideas are
 *                                      about at the best spot (`lesson`: the rules of its principles, ruleRefs)
 * Each gives the words, or null when they name a group on show more than once and cannot say whom they mean.
 * @param {object} s  the scenario
 * @param {{ freezeFrame: object, learnerId: string, ctx: object, ghost: { spot, result } }} scene  stagedScene's or repScene's
 * @param {{ youNumber?: number|null }} [opts]
 */
export function repSpeaker(s, scene, { youNumber = null } = {}) {
  const players = scene?.freezeFrame?.players ?? [];
  const learnerId = scene?.learnerId ?? null;
  const own = Array.isArray(s?.principles) ? s.principles : [];
  const best = scene?.ghost?.result?.rules ?? [];
  const lesson = [];
  for (const r of best) {
    const ideas = [...(r.principles ?? []), ...(RULES_BY_ID[r.id]?.principles ?? [])];
    if (!(r.weight > 0) || !ideas.some((i) => own.includes(i))) continue;
    for (const id of ruleRefs(r.id, { rules: best, ctx: scene.ctx, spot: scene.ghost?.spot })) if (!lesson.includes(id)) lesson.push(id);
  }
  const holder = scene?.freezeFrame?.carrierId ?? null;
  const clip = carriersOf(s);
  const scripted = [...new Set((s?.timeline?.players?.overrides ?? []).map((o) => o?.id).filter((id) => typeof id === 'string'))];
  const say = (text, who) => {
    const out = nameSpecific(text, { players, learnerId, youNumber, ...who });
    return out.ok ? out.text : null;
  };
  const atFreeze = [holder, ...[...clip].reverse()].filter(Boolean);
  return {
    lesson, holder, clip, scripted,
    rule: (text, ruleId, rules = best, spot = scene?.ghost?.spot ?? null) => say(text, { refs: ruleRefs(ruleId, { rules, ctx: scene?.ctx, spot }) }),
    free: (text, { holders = atFreeze } = {}) => say(text, { holders, pools: [scripted, lesson] }),
  };
}

/**
 * A rep's words before the answer (pure): the question at the freeze and the brief while the play runs, each with the
 * player it means named by shirt number where the game shows more than one of the group (repSpeaker free: the
 * question's player on the ball is the one on it at the freeze, else the clip's latest in the group; the brief tells
 * the play from its start: the clip's first in the group). A question the number takes past 12 words ends "Where
 * now?"; one that cannot say whom it means (or still does not fit) asks the default question ("Where do you go now?");
 * a brief that cannot say whom it means, or that its numbers take past 12 words, is shown as written (it is the play
 * in motion, while the player it means moves). `sideline`: the words talk about the sideline, so the camera keeps it
 * in view.
 * @returns {{ question: string, brief: string, sideline: boolean }}
 */
export function repWords(s, scene, { youNumber = null } = {}, P = PLAY_DEFAULTS) {
  const who = repSpeaker(s, scene, { youNumber });
  // A player's number is a word longer than their group ("Their number 4 has the ball near their goal."): past 12
  // words, the question at the end ("Where do you go?", "What do you do?") becomes "Where now?".
  const fit = (q) => (!q || usableText(q, P.questionMaxWords) ? q : q.replace(/([.!])\s+[^.!?]*\?$/, `$1 ${STRINGS.whereNow}`));
  const named = fit(who.free(questionFor(s)));
  const question = named && usableText(named, P.questionMaxWords) ? named : STRINGS.question;
  const told = briefFor(s);
  const brief = [who.free(told, { holders: who.clip.length ? who.clip : [who.holder] })].find((b) => b && usableText(b, P.briefMaxWords)) ?? told;
  return { question, brief, sideline: mentionsSideline(question, brief) };
}

/** The touchline nearest a point, level with it (pure): a camera that must show the sideline takes it in. */
export const touchlineBy = (p) => (isPoint(p) ? { x: Math.min(LENGTH, Math.max(0, p.x)), y: p.y > MID_Y ? WIDTH : 0 } : null);

/**
 * What a locked-in spot counts for (pure), so no rep is worth more than getting it right first time:
 *   practice   Try again (the mirrored twin): practice only, as in "Who's open?"; none of the below
 *   elo        the skill model learns from it: first tries without an aid
 *   streak, rewards, mastery   the streak, XP and badges (award), stickers: counted first tries (not the first set's
 *              taught reps: the tutorial earns nothing, R28)
 *   history    Coach mode's history: first tries, but not the first set's taught reps
 *   tally      its stars count for the set (the dots, Full time, road.recordSet): first tries
 *   celebrate  it may take the set's one big celebration: counted first tries, never the worked example
 * @param {{ counts?: boolean, aided?: boolean, example?: boolean, retry?: boolean, firstSet?: boolean }} rep
 */
export function recordPolicy({ counts = true, aided = false, example = false, retry = false, firstSet = false } = {}) {
  const first = !retry;
  const real = first && !!counts;
  return {
    practice: !first,
    elo: first && !aided && !example,
    streak: real,
    rewards: real,
    mastery: real,
    history: first && (!!counts || !firstSet),
    tally: first,
    celebrate: real && !example,
  };
}

/** What "Lock it" does (pure): with YOU picked up (a tap on YOU) but never moved, it says the tip again ('nudge':
 *  "Tap where you want to go.") instead of locking the start by mistake; otherwise it locks where YOU stand. */
export const lockAction = ({ armed = false, moved = false } = {}) => (armed && !moved ? 'nudge' : 'lock');

/** The role card of a rep (§4.3 step 1): Try again's mirrored twin says "Same play, other side"; else strings.js
 *  roleCard ("You're the left back", or "Now you're the striker" in a position not your own). */
export function repCard({ role, profileRole = null, retry = false } = {}) {
  return retry ? { text: STRINGS.otherSide, changed: true } : roleCard(role, profileRole);
}

/**
 * The players lit during Watch and Decide (§4.3 step 2): the ball carrier at the freeze, the player the lesson is about
 * (the cue of your start spot), your mark, the teammate on the ball's side of the play, the scripted players; never YOU
 * (always lit), at most `max`.
 */
export function keyPlayers({ scenario = null, freezeFrame = null, ctx = null, cue = null, learnerId = null, max = PLAY_DEFAULTS.keyPlayers } = {}) {
  const ids = [];
  const add = (id) => { if (typeof id === 'string' && id && id !== learnerId && id !== BALL_ID && !ids.includes(id)) ids.push(id); };
  add(freezeFrame?.carrierId);
  if (cue?.type === 'player') add(cue.id);
  add(ctx?.markTarget?.id);
  add(ctx?.firstDefender?.id);
  for (const k of scenario?.timeline?.carrier ?? []) add(k?.id);
  for (const o of scenario?.timeline?.players?.overrides ?? []) add(o?.id);
  add(ctx?.dangerousAttacker?.id);
  return ids.slice(0, Math.max(0, max));
}

/** The first set's plan for rep i (§4.1): rep 1 a worked example (with the glow), rep 2 the glow, rep 3 on its own. */
export function firstSetStep(i) {
  return { example: i === 0, aid: i <= 1 ? 'glow' : null, counts: i >= 2 };
}

/** A normal set's plan for rep i: the glow aid on the first reps the first time through a node, else nothing. */
export function setStep(i, { nodePlays = 0, nodeStars = 0, demo = false } = {}, P = PLAY_DEFAULTS) {
  const glow = nodePlays === 0 && nodeStars === 0 && i < P.glowReps;
  // The lesson demo (the owner, 2026-10-01: teach before testing): a node's first-ever set opens by SHOWING the idea
  // on the first rep (the clip, then YOU walks to the best spot by itself, with the idea's name, summary and because
  // line), and the kid then tries that same play as a disclosed, uncounted warm-up. Reps 2-5 are tested fresh.
  if (demo && i === 0) return { example: false, aid: glow ? 'glow' : null, counts: false, demo: true };
  return { example: false, aid: glow ? 'glow' : null, counts: true };
}

/** The set's tally (pure): each slot keeps its first try's stars. Try again is practice (recordPolicy): it is never
 *  tallied, and a second try at a slot could not change it anyway. */
export const createTally = (n) => ({ slots: Array.from({ length: Math.max(0, n) }, () => null), missNoted: false, greenTold: false });
export function tallyTry(tally, { slot, stars }) {
  const slots = [...tally.slots];
  const s = Math.max(0, Math.min(3, Math.round(Number(stars)) || 0));
  if (slot >= 0 && slot < slots.length && slots[slot] === null) slots[slot] = s;
  return { ...tally, slots };
}
/** The stars of each played slot, for road.recordSet (a slot never played is left out). */
export const tallyStars = (tally) => tally.slots.filter((s) => s !== null);

/** "Hard one. Pros miss it too." after a miss (0-1 stars), once a set (R20). @returns {{ note: string, tally }} */
export function missNote(tally, stars) {
  if (stars > 1 || tally.missNoted) return { note: '', tally };
  return { note: STRINGS.missNote, tally: { ...tally, missNoted: true } };
}

/**
 * The reveal's note (pure): Try again says it is practice ("Practice only. Your first try counts."); else the set's
 * first reveal says what the green is ("Anywhere in the green is right."); else a first-set warm-up rep says its stars
 * are not counted yet ("Warm-up. Stars count from the next play.", the same honesty as Try again's note); else, after
 * a miss the kid actually played (not locked in at the start: that line already says what happened), once a set,
 * "Hard one. Pros miss it too." (missNote, R20: a miss on the first reveal keeps it for the next one).
 * @returns {{ note: string, tally }}
 */
export function revealNote(tally, { stars = 0, practice = false, warmup = false, still = false } = {}) {
  if (practice) return { note: STRINGS.practiceNote, tally };
  if (!tally.greenTold) return { note: STRINGS.greenIsRight, tally: { ...tally, greenTold: true } };
  if (warmup) return { note: STRINGS.warmupNote, tally };
  if (still) return { note: '', tally };
  return missNote(tally, stars);
}

/** A rep's name for Full time's "Best move": its main idea's simple name, else its simple title. */
export function repTitle(scenario, principles = {}) {
  const p = principles?.[scenario?.principles?.[0]];
  return (typeof p?.kidName === 'string' && p.kidName) || scenario?.titleKid || scenario?.title || '';
}

/**
 * What a first try records (pure), from the stars the kid was shown (Player mode's right area): the record id, those
 * stars, the score that stands for them (kidScore: Coach mode's score held in their band), Elo's score01 (that score /
 * 100: the skill model agrees with the stars) and the rewards event (`stars` as shown, `score` = kidScore, so XP, a
 * first 3 stars, improvement and comebacks all follow the stars; no grade: the kid never sees one).
 * @param {object} s  the scenario
 * @param {{ stars: number, judgement: { result: { score: number } } }} judged  revealFor's
 * @returns {{ id: string, stars: number, score: number, score01: number, event: object }}
 */
export function recordOf(s, judged) {
  const stars = Math.max(0, Math.min(3, Math.round(Number(judged?.stars)) || 0));
  const score = kidScore(stars, judged?.judgement?.result?.score);
  const id = recordIdOf(s);
  return { id, stars, score, score01: score / 100, event: { type: 'rep', scenarioId: id, role: s?.learner?.role, score, stars } };
}

/** A deterministic seed for a node's nth play. */
export function seedFor(key, n = 0) {
  let h = 2166136261;
  for (const c of `${key}:${n}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The scenario id Elo and the rewards keep a record under: the original of a mirror; one per idea and position family
 *  for generated drills (each generated drill is new, so a record per drill would only grow). */
export function recordIdOf(s) {
  if (s?.source?.kind === 'generated') return `gen-${s.principles?.[0] ?? 'x'}-${familyOf(s.learner?.role) ?? 'x'}`;
  return String(s?.mirrorOf ?? s?.id ?? '').replace(/-m$/, '');
}

// ---------------------------------------------------------------- the right area (Player mode's judgement)

/**
 * The score (0-100) that stands for a Player-mode judgement (pure): Coach mode's score at the spot, held inside the
 * band of the stars the kid was shown (rewards.js starsForScore: 0 below 55, 1 at 55-74, 2 at 75-89, 3 at 90+; starsAt),
 * so starsForScore(kidScore(n, x)) is n for every score x. A spot in the green (3 stars) Coach mode scores 80 counts as
 * 90; a spot past a key line (1 star) that Coach mode scores 80 counts as 74. This is what Elo learns from (score01 =
 * kidScore / 100: the skill model agrees with the stars) and what the rewards see (award's `score`, beside `stars`;
 * Match day's run: its average held in the band of the run's stars), so every star, XP and sticker follows the right
 * area, while Coach mode's own records (the history's score and grade, Live's best) keep the strict score.
 * @param {number} stars  0-3, as shown
 * @param {number} [coachScore]  evaluate()'s score at the spot (none: the bottom of the band)
 */
export function kidScore(stars, coachScore, P = PLAY_DEFAULTS) {
  const n = Math.max(0, Math.min(3, Math.round(Number(stars)) || 0));
  const [one, two, three] = P.starsAt;
  const lo = [0, one, two, three][n], hi = [one - 1, two - 1, three - 1, 100][n];
  const s = Number(coachScore);
  return Math.round(Math.min(hi, Math.max(lo, Number.isFinite(s) ? s : lo)));
}

/** The rep's lesson for the right area (cast.js lessonOf, as a staged rep carries it: its primary idea's rules), or
 *  null (the lesson's keys are then left out: only the hard ones and the lines that are not the lesson count). */
function lessonFor(s, result, catalogue) {
  try { return result ? lessonOf(s?.principles ?? [], result, catalogue ?? undefined) ?? null : null; } catch { return null; }
}

/**
 * A rep's right area (pure; js/engine/kidscore.js kidArea): round the best spot, as big as the position's zone
 * tolerance allows at the rep's stage, never reaching toward YOUR start (standing still is never right), with the
 * rep's lesson and the drill's misconceptions as its keys.
 * @param {object} s  the scenario
 * @param {{ ctx, ghost: { spot, result }, start, stage?, lesson?, base }} scene  stagedScene's or repScene's
 */
export function repArea(s, scene) {
  return kidArea(scene.ctx, {
    best: scene.ghost.spot,
    centre: scene.ghost.result?.center ?? scene.base,
    tol: scene.ghost.result?.tol ?? toleranceFor(s?.learner?.role, s?.answer?.tol),
    start: scene.start ?? null, hold: s?.answer?.hold === true, stage: STAGES.includes(scene.stage) ? scene.stage : 'full',
    lesson: scene.lesson ?? null, misconceptions: Array.isArray(s?.misconceptions) ? s.misconceptions : [],
  });
}

const AREAS = new WeakMap(); // scene → its right area (a scene built without one: repArea once)
/** A scene's right area: its own (stagedScene, repScene), else repArea once per scene. */
export function areaOf(s, scene) {
  if (scene?.area) return scene.area;
  if (!AREAS.has(scene)) AREAS.set(scene, repArea(s, scene));
  return AREAS.get(scene);
}

const OUTLINES = new WeakMap(); // area → its drawn green (kidOutline: about 1.4 ms, once per rep)
/** The green the reveal draws: where the right area gives 3 stars (kidOutline, traced round the best spot). */
export function zoneOf(s, scene) {
  const area = areaOf(s, scene);
  if (!OUTLINES.has(area)) {
    let pts = [];
    try { pts = kidOutline(scene.ctx, area) ?? []; } catch (err) { console.warn('[fotbol] play: the right area could not be traced', err); pts = []; }
    OUTLINES.set(area, pts.filter(isPoint).map((p) => ({ x: p.x, y: p.y })));
  }
  return OUTLINES.get(area);
}

/** The green as a board marker (board.js 'zone': css/play.css .mk-zone), or null with fewer than 3 points. */
export const zoneMarker = (points) => ((points ?? []).filter(isPoint).length >= 3 ? { type: 'zone', points: points.filter(isPoint).map((p) => ({ x: p.x, y: p.y })), tone: 'good' } : null);

/** Is a point inside a closed outline (pure; even-odd)? */
export function insideOutline(points, p) {
  const q = (points ?? []).filter(isPoint);
  if (q.length < 3 || !isPoint(p)) return false;
  let c = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const a = q[i], b = q[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** The nearest point of a closed outline to a spot (pure), or null with fewer than 2 points. */
export function nearestOnOutline(points, spot) {
  const q = (points ?? []).filter(isPoint);
  if (q.length < 2 || !isPoint(spot)) return null;
  let best = null, bd = Infinity;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L > 0 ? Math.max(0, Math.min(1, ((spot.x - a.x) * dx + (spot.y - a.y) * dy) / L)) : 0;
    const p = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(p.x - spot.x, p.y - spot.y);
    if (d < bd - 1e-12) { bd = d; best = p; }
  }
  return best;
}

/**
 * Where the arrow after a miss ends (pure): at the green's nearest edge to YOU, then `zoneArrowIn` on toward the best
 * spot (so it points into the green, never at one exact point); the best spot itself when YOU stand inside the drawn
 * green (a key broke it there) or there is no green to point to.
 */
export function zoneArrowEnd(points, spot, best, P = PLAY_DEFAULTS) {
  if (!isPoint(best)) return null;
  if (insideOutline(points, spot)) return { x: best.x, y: best.y };
  const e = nearestOnOutline(points, spot);
  if (!e) return { x: best.x, y: best.y };
  const d = Math.hypot(best.x - e.x, best.y - e.y);
  const k = d > 1e-9 ? Math.min(P.zoneArrowIn, d) / d : 0;
  return { x: e.x + (best.x - e.x) * k, y: e.y + (best.y - e.y) * k };
}

/** The glow's level at a spot (pure): KID_LEVELS by the right area's stars there ('hot' in the green). */
export function levelAt(scene, area, p) {
  return KID_LEVELS[Math.max(0, Math.min(3, kidStars(scene.ctx, p, area).stars))];
}

/**
 * The judging scene of a rep (pure; ARCHITECTURE §5.3): its timing, your start, the frame at the freeze with you at
 * the start, your base, the context, the best spot (the ghost), the rep's lesson (cast.js lessonOf, with `catalogue`:
 * data/principles.json) and its right area at the full match (repArea).
 * @param {object} s  a normalised scenario
 * @param {{ formations: object, catalogue?: object }} opts
 */
export function repScene(s, { formations, catalogue = null } = {}) {
  const { duration, freezeAt } = timing(s);
  const learnerId = learnerIdOf(s);
  const auto = frameAt(s, 0, { formations }).players.find((p) => p.id === learnerId);
  const start = s.learner.start ? { ...s.learner.start } : { x: auto.x, y: auto.y };
  const freezeFrame = frameAt(s, freezeAt, { formations });
  const base = learnerBaseAt(s, freezeAt, { formations });
  const ctx = buildContext({ ...freezeFrame, players: freezeFrame.players.map((p) => (p.id === learnerId ? { ...p, x: start.x, y: start.y } : p)) }, { learnerId, base });
  const authored = s.answer?.mode === 'authored' && s.answer.ideal;
  const ghost = computeGhost(ctx, { base: authored ? s.answer.ideal : base, tol: toleranceFor(s.learner.role, s.answer?.tol) });
  const scene = { duration, freezeAt, learnerId, start, freezeFrame, base, ctx, ghost, lesson: lessonFor(s, ghost.result, catalogue), hold: s.answer?.hold === true };
  scene.area = repArea(s, scene);
  return scene;
}

/**
 * Everything the reveal says about a spot (pure): the judgement, the stars, the line, the Why? sheet (its idea: the
 * one behind the line's reason, else the drill's own) and what you did best (Full time's "Best move").
 * The stars are Player mode's: the right area (js/engine/kidscore.js kidStars on the scene's area: 3 anywhere in the
 * green, 2 just outside it, never fewer outside it than Coach mode's score gives up to 2, 0 where YOU started, and at
 * most 1 past a key line: offside at a pass, the wrong side of your man or of the ball, the lesson clearly failed);
 * `judgement` keeps Coach mode's strict evaluation (its score, grade and reasons) for the records and the words.
 * @param {object} s  the scenario
 * @param {{ ctx: object, ghost: object, area?: object }} scene  stagedScene's or repScene's (area: its right area)
 * @param {{x:number, y:number}} spot
 * Every sentence names the player it means by shirt number where the game shows more than one of their group
 * (repSpeaker: "Get closer to their number 7"); one that cannot say whom it means is left out (the next one says it).
 * In a small or bigger game "your spot in the team's shape" (a shape not on show) is said in Slide as a Team's words
 * (STRINGS.zoneLine).
 * @param {{ principles?: object, youNumber?: number|null }} [opts]  principles: data/principles.json by id; youNumber:
 *   YOUR kit number (the shirts' numbers)
 * @returns {{ judgement, more, stars, misId, misText, line, why, move, who, kid, area, still, keyRule, lineRule, cue }}  who: the
 *   rep's repSpeaker (the cue's name); kid: kidStars' result; area: the right area; still: locked in where YOU started;
 *   keyRule: the rule of the key that capped the stars (its fix is the line), or null; lineRule: the rule the line is
 *   about (the key's, or the reason's the line says), or null; cue: the one cue after a miss (keyCue: the key's, else
 *   the line's rule's, so the pitch shows what the line talks about, else judgeSpot's), null at 3 stars
 */
export function revealFor(s, scene, spot, { principles = {}, youNumber = null } = {}) {
  const judgement = judgeSpot({ ctx: scene.ctx, ghost: scene.ghost }, spot, { wording: 'kid', principles });
  const more = explain(judgement.result, scene.ctx, spot, { wording: 'kid', max: 3, principles, ghost: { spot: scene.ghost.spot, result: scene.ghost.result } });
  // Player mode's stars: the right area (js/engine/kidscore.js), not Coach mode's exact point (judgement.result.score).
  const area = areaOf(s, scene);
  const kid = kidStars(scene.ctx, spot, area);
  const stars = kid.stars;
  const still = stars === 0 && (kid.reason === 'start' || (kid.keys ?? []).includes('stood-still'));
  const who = repSpeaker(s, scene, { youNumber });
  const rules = judgement.result.rules;
  const staged = !!scene?.ids;
  const sayRule = (r) => (r.ruleId === ZONE_REASON.id && staged ? STRINGS.zoneLine : who.rule(r.text, r.ruleId, rules, spot));
  const mc = S.misconceptionAt(s, spot);
  const misText = mc ? who.free(S.wordingOf(mc.text, 'kid', mc.textKid)) : null;
  const own = Array.isArray(s?.principles) ? s.principles : [];
  const reasons = (more.reasons ?? []).map((r) => ({ ...r, text: sayRule(r) })).filter((r) => r.text);
  const praise = praiseOf(judgement.result).map((p) => ({ ...p, text: who.rule(p.text, p.ruleId, rules, spot) })).filter((p) => p.text);
  const takeaway = who.free(takeawayFor(s)) ?? '';
  // The key the spot broke (a side, an order or a line no distance forgives): its fix is said first (a key about an
  // angle in the rule's words at that angle: angleVars).
  const keyRule = stars < 3 && RULES_BY_ID[kid.reason] ? kid.reason : null;
  const keyName = keyRule ? kid.keys?.[kid.broken?.indexOf(keyRule)] ?? null : null;
  const key = keyRule ? keyFix(keyRule, { reasons, rules, who, spot, vars: angleVars(keyName, keyRule, { ctx: scene.ctx, spot, area, rules }) }) : null;
  const line = pickLine({ reasons, praise, misconception: misText, stars, principles: own, takeaway, key: key?.text ?? null, still });
  const source = reasons.find((r) => r.text === line) ?? (key?.text === line ? key : undefined);
  const drillIdea = principles[own[0]];
  const idea = principles[source?.principleId] ?? drillIdea;
  // The idea's summary about this play: its player by number too (the line's rule's, else the drill's), or none.
  const sum = typeof idea?.summary === 'string' ? idea.summary : idea?.summary?.kid;
  const summary = typeof sum === 'string' ? (source ? who.rule(sum, source.ruleId, rules, spot) : null) ?? who.free(sum) : null;
  const principle = idea ? { ...idea, summary: summary ?? '' } : idea;
  // (The key's fix is a fix like explain's reasons: a 2-star line that is the key's gets no second fix on Why?.)
  const fixes = key && !reasons.some((r) => r.text === key.text) ? [key, ...reasons] : reasons;
  const why = whyFor({ principle, reasons: fixes, praise, line, stars, principles: own, takeaway: idea === drillIdea ? who.free(S.wordingOf(s?.takeaway, 'kid')) ?? '' : '' });
  const move = bestMoveOf({ praise, principles: own, byId: principles });
  // The one cue after a miss: the broken key's (the offside line, the player you mark), else the rule the line talks
  // about (a line about their striker rings their striker, not the line of your defenders), else Coach mode's top one.
  const lineRule = keyRule ?? (typeof source?.ruleId === 'string' ? source.ruleId : null);
  const cue = stars < 3 ? keyCue(lineRule, { ctx: scene.ctx, spot, fallback: judgement.feedback.cue }) : null;
  return { judgement, more, stars, misId: mc?.id ?? null, misText, line, why, move, who, kid, area, still, keyRule, lineRule, cue };
}

/**
 * The cue a reveal draws after a miss (pure; cueMarker draws it): the rule of the key the spot broke (or of the reason
 * the line says), highlighted as that rule highlights it (rule.cue: the offside line, the player you mark, the ball you
 * press), so the one cue shows the relationship the line talks about; else `fallback` (judgeSpot's feedback.cue: Coach
 * mode's top failing rule).
 * @param {string|null} ruleId  revealFor's lineRule (its keyRule, else the line's rule)
 * @param {{ ctx?: object, spot?: {x:number,y:number}, fallback?: object|null }} [opts]
 * @returns {{ text: string, ruleId: string, highlight: object }|object|null}
 */
export function keyCue(ruleId, { ctx = null, spot = null, fallback = null } = {}) {
  if (!ruleId || fallback?.ruleId === ruleId) return fallback;
  let highlight = null;
  try { highlight = ctx ? RULES_BY_ID[ruleId]?.cue?.(ctx, spot) ?? null : null; } catch { highlight = null; }
  return highlight && typeof highlight === 'object' ? { text: '', ruleId, highlight } : fallback;
}

/**
 * The fix for a key the spot broke (pure): with `vars` (a key about an angle: angleVars) the rule's own simple fix at
 * that angle (its `text.kid.fail`: "Come from the middle side of their number 10, so they have to go wide." rather
 * than "Get closer" at YOUR distance); else explain's reason for that rule when it gave one, else the rule's own fix
 * at the spot; each with the player it means by number (repSpeaker), or null.
 * @param {string} ruleId
 * @param {{ reasons?: object[], rules?: object[], who?: object|null, spot?: {x,y}|null, vars?: object|null }} [opts]
 * @returns {{ ruleId: string, principleId: string|null, principles: string[], text: string }|null}
 */
export function keyFix(ruleId, { reasons = [], rules = [], who = null, spot = null, vars = null } = {}) {
  const r = vars ? null : reasons.find((x) => x.ruleId === ruleId);
  if (r?.text) return r;
  const rule = RULES_BY_ID[ruleId];
  const v = vars ?? (rules ?? []).find((x) => x.id === ruleId)?.vars ?? {};
  let t = '';
  try { t = rule?.text?.kid?.fail?.(v) ?? ''; } catch { t = ''; }
  t = typeof t === 'string' ? t.trim() : '';
  if (!t) return vars ? keyFix(ruleId, { reasons, rules, who, spot }) : null;
  t = t[0].toUpperCase() + t.slice(1) + (/[.!?…]$/.test(t) ? '' : '.');
  const said = who ? who.rule(t, ruleId, rules, spot) : t;
  const idea = typeof v.principle === 'string' && rule?.principles?.includes(v.principle) ? v.principle : rule?.principles?.[0] ?? null;
  if (!said) return vars ? keyFix(ruleId, { reasons, rules, who, spot }) : null;
  return { ruleId, principleId: idea, principles: [...(rule?.principles ?? [])], text: said };
}

/**
 * A key about an angle, judged where kidscore.js judges it (pure): the rule's vars there, so its words say which side,
 * not how far. 'wrong-way' (a D2 press lesson: the carrier shown inside) is the press rule pressRef from the carrier
 * (or the loose ball) in YOUR direction; 'not-between' of goal-side (a D5 lesson) is the goal-side rule at its marking
 * distance from the man in YOUR direction. null for any other key (its words are the rule's at YOUR spot).
 * @param {string|null} key  kidStars' key for the rule (kid.keys beside kid.broken)
 * @param {string} ruleId
 * @param {{ ctx: object, spot: {x,y}, area?: object, rules?: object[] }} at  area: the right area (its P and goalSide)
 * @returns {object|null}
 */
export function angleVars(key, ruleId, { ctx, spot, area = null, rules = [] } = {}) {
  const P = area?.P ?? KID_DEFAULTS;
  const at = (ref, len) => { const d = dist(spot, ref); return d > P.angleFrom ? { x: ref.x + ((spot.x - ref.x) / d) * len, y: ref.y + ((spot.y - ref.y) / d) * len } : null; };
  try {
    if (key === 'wrong-way' && ruleId === 'press') {
      const q = at(ctx.carrier ?? ctx.ball, P.pressRef);
      return q ? RULES_BY_ID.press.evaluate(ctx, q)?.vars ?? null : null;
    }
    if (key === 'not-between' && ruleId === 'goal-side') {
      const g = area?.goalSide, r = (rules ?? []).find((x) => x.id === 'goal-side');
      const q = g && r?.target ? at(g, dist(r.target, g)) : null;
      return q ? RULES_BY_ID['goal-side'].evaluate(ctx, q)?.vars ?? null : null;
    }
  } catch { /* the words at YOUR spot instead */ }
  return null;
}

// ---------------------------------------------------------------- stages: a small game, a bigger game, the full match

/**
 * The stage a rep of the set wants (docs/PROGRESSIVE_FIELD.md §2, pure): its own (road.js buildSet tags each rep with
 * its slot's), else the stage plan's for slot `i` (road.js stagePlan), else a small game in the first set and the full
 * match anywhere else.
 * @param {{ stage?: string }|null} rep
 * @param {number} i  the rep's slot
 * @param {{ plan?: string[]|null, first?: boolean }} [opts]
 * @returns {'small'|'medium'|'full'}
 */
export function wantedStage(rep, i, { plan = null, first = false } = {}) {
  if (STAGES.includes(rep?.stage)) return rep.stage;
  if (Array.isArray(plan) && STAGES.includes(plan[i])) return plan[i];
  return first ? 'small' : 'full';
}

/**
 * A staged rep's judging scene (pure; drop-in for repScene): the freeze frame is the REDUCED frame (only the cast:
 * hidden players are not drawn and not scored), with its context and the best spot searched on it (cast.js bestStage),
 * so every star, ring and sentence depends only on players the kid can see. `ids` is the cast (null at the full
 * match: nobody is left out), for watchFrame. `lesson` (cast.js's, the rule the gate holds), `hold` and `area` (the
 * right area at the stage: repArea) are Player mode's judgement's.
 * @param {object} s  the normalised scenario the rep plays
 * @param {object} staged  cast.js bestStage's result for it
 */
export function stagedScene(s, staged) {
  const { duration } = timing(s);
  const full = staged.stage === 'full';
  const scene = {
    duration, freezeAt: staged.t, learnerId: staged.learnerId, start: { x: staged.start.x, y: staged.start.y },
    freezeFrame: staged.frame, base: staged.base, ctx: staged.ctx, ghost: staged.ghost,
    stage: staged.stage, cast: staged.cast, ids: full ? null : new Set(staged.cast.ids),
    lesson: staged.lesson ?? null, hold: s?.answer?.hold === true,
  };
  // The right area at this stage (a small game's a little smaller: kidArea's stageScale): the one cast.js gated the
  // stage on (standing still 0 stars, the best spot 3), else worked out here.
  scene.area = staged.area ?? repArea(s, scene);
  return scene;
}

/** A frame with the learner's token moved to `spot` (pure). */
const withSpot = (frame, learnerId, spot) => ({ ...frame, players: frame.players.map((p) => (p.id === learnerId ? { ...p, x: spot.x, y: spot.y } : p)) });

/**
 * What the pitch shows at time t of a rep (pure): the full clip's frame (the cast moves exactly as in the 22-player
 * game), reduced to the cast in a small or bigger game (ids; null: everyone), with YOU at `spot`.
 * @param {object} s  the scenario
 * @param {{ learnerId: string, ids: Set<string>|null }} scene  stagedScene's (or repScene's: everyone)
 */
export function watchFrame(s, scene, t, spot, { formations } = {}) {
  const f = frameAt(s, t, { formations });
  return withSpot(scene.ids ? reduceFrame(f, scene.ids) : f, scene.learnerId, spot);
}

const isPoint = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);

/**
 * The world rect a camera fits round some points (pure; board.setCamera): their box, grown about its middle to at least
 * `min` (CAMERA_MIN: metres along × across the pitch) and slid onto the pitch (a point off it, a ball out of play,
 * counts at the touchline). null with no point. Rounded outward to 0.01.
 * @param {{x:number, y:number}[]} points
 * @returns {{ x0: number, x1: number, y0: number, y1: number } | null}
 */
export function cameraRect(points, { min = CAMERA_MIN } = {}) {
  const ps = (points ?? []).filter(isPoint).map((p) => ({ x: Math.min(LENGTH, Math.max(0, p.x)), y: Math.min(WIDTH, Math.max(0, p.y)) }));
  if (!ps.length) return null;
  const axis = (vals, least, span) => {
    let a = Math.min(...vals), b = Math.max(...vals);
    const len = Math.min(span, Math.max(b - a, least));
    const mid = (a + b) / 2;
    a = Math.max(0, Math.min(span - len, mid - len / 2));
    // Rounded outward, so every point stays inside.
    return [Math.max(0, Math.floor(a * 100 + 1e-9) / 100), Math.min(span, Math.ceil((a + len) * 100 - 1e-9) / 100)];
  };
  const [x0, x1] = axis(ps.map((p) => p.x), min.length, LENGTH);
  const [y0, y1] = axis(ps.map((p) => p.y), min.width, WIDTH);
  return { x0, x1, y0, y1 };
}

/**
 * The camera of a small or bigger game (pure; PROGRESSIVE_FIELD §4-§5): one rect for the whole clip (steady through
 * the rep, "See what happens" included), fitting every cast player and the ball on a frame every `step` s from the
 * start to the end of the clip, YOUR start and the best spot (YOU are drawn at your start, then where you put
 * yourself, never where the playback holds you); at least CAMERA_MIN, on the pitch (cameraRect). null at the full
 * match: the focus crop and the spotlight, as before.
 * `extra`: more points to keep in view (the sideline, when the rep's words talk about it: touchlineBy).
 * @param {object} s  the scenario
 * @param {{ ids: Set<string>|null, learnerId: string, start: {x,y}, ghost: { spot: {x,y} }, duration: number }} scene
 */
export function stageCamera(s, scene, { formations, step = PLAY_DEFAULTS.cameraStep, min = CAMERA_MIN, extra = [] } = {}) {
  if (!scene?.ids) return null;
  const pts = [scene.start, scene.ghost?.spot, ...(extra ?? [])];
  const end = Number.isFinite(scene.duration) ? scene.duration : timing(s).duration;
  for (let t = 0; t < end + step - 1e-9; t += step) {
    const f = frameAt(s, Math.min(t, end), { formations });
    if (isPoint(f.ball)) pts.push(f.ball);
    for (const p of f.players) if (p.id !== scene.learnerId && scene.ids.has(p.id)) pts.push(p);
  }
  return cameraRect(pts, { min });
}

/**
 * The camera once the whistle has gone (pure; a small or bigger game): the players and the ball at the freeze, YOUR
 * start and the best spot, at least CAMERA_MIN, on the pitch (cameraRect). The clip's camera (stageCamera) has to take
 * in everywhere the play went, so a play across the pitch (a switch, a pass back and on) showed the freeze no bigger
 * than the full match; at the whistle the board eases in to this one, where the kid decides and sees the answer.
 * Never bigger than the clip's (it fits a part of the same points, `extra` too). null at the full match.
 * @param {{ ids: Set<string>|null, learnerId: string, start: {x,y}, ghost: { spot: {x,y} }, freezeFrame: object }} scene
 */
export function answerCamera(scene, { min = CAMERA_MIN, extra = [] } = {}) {
  if (!scene?.ids) return null;
  const pts = [scene.start, scene.ghost?.spot, scene.freezeFrame?.ball, ...(extra ?? [])];
  for (const p of scene.freezeFrame?.players ?? []) if (p.id !== scene.learnerId) pts.push(p);
  return cameraRect(pts, { min });
}

/**
 * Where the role card goes over the pitch (pure; CSS px; as pass.js cardSpot, with play's weights): 'top', 'bottom'
 * or 'middle' of the stage, the first of them that covers nobody in `avoid` (YOU with YOUR tag, the ball and every
 * other player drawn, where the board will draw them once its camera lands: board.clientBox); else ('free') the middle
 * of the tallest band between them that covers nobody (a game spread over the pitch has one); else the place whose
 * cover costs least (each box's overlap, within cardClearPx of it, times its weight: cardWeights: YOU and the ball most,
 * then the player on the ball, then anyone else), the named places first on a tie. Given the room across the stage
 * (`room`), the card may also slide to the left or right edge (cardGapPx in), where the play leaves a corner free: the
 * named places centred, then at an edge, then the bands the same way. The card once kept off YOU and the ball only,
 * and sat over the ball carrier and the players the question was about (the verifier: a desktop small game's card
 * right over their defender on the ball, a bigger game's over four players).
 * @param {{ top: number, bottom: number }} stage  the pitch's box on the screen
 * @param {number} height  the card's height
 * @param {({ box?: { left, right, top, bottom }, weight?: number } | { left, right, top, bottom } | null)[]} avoid  a
 *   box with its weight, or a bare box (weight 1)
 * @param {{ left?: number, right?: number, room?: { left: number, right: number } | null }} [across]  left, right: the
 *   card's box across the screen, centred (default: all of it); room: the stage's (default: none, the card stays centred)
 * @returns {{ at: 'top'|'bottom'|'middle'|'free', top: number, side: 'center'|'left'|'right' }}  top: the card's top edge,
 *   from the stage's (css/play.css places a 'free' card there: --pl-card-top); side: centred, or at the left or right edge
 */
export function cardSpot(stage, height, avoid = [], { left = -Infinity, right = Infinity, room = null } = {}, P = PLAY_DEFAULTS) {
  const fine = (b) => b && [b.left, b.right, b.top, b.bottom].every(Number.isFinite);
  const items = (avoid ?? []).map((a) => (fine(a?.box) ? { b: a.box, w: Number.isFinite(a.weight) ? a.weight : 1 } : fine(a) ? { b: a, w: 1 } : null))
    .filter((a) => a && a.w > 0);
  const h = Math.max(0, height || 0), g = P.cardGapPx, c = P.cardClearPx;
  const lo = stage.top + g, hi = Math.max(lo, stage.bottom - g - h);
  const named = { top: lo, bottom: hi, middle: (stage.top + stage.bottom) / 2 - h / 2 };
  // Across: centred; then, with room, slid to either edge (only when that moves it).
  const xs = [{ side: 'center', l: left, r: right }];
  const w = right - left;
  if (Number.isFinite(w) && Number.isFinite(room?.left) && Number.isFinite(room?.right)) {
    const l = room.left + g, r = room.right - g;
    if (l + w <= r) {
      if (l < left - 1) xs.push({ side: 'left', l, r: l + w });
      if (r > right + 1) xs.push({ side: 'right', l: r - w, r });
    }
  }
  const cost = (y, x) => items.reduce((a, { b, w: k }) => a + k * Math.max(0, Math.min(x.r, b.right + c) - Math.max(x.l, b.left - c)) * Math.max(0, Math.min(y + h, b.bottom + c) - Math.max(y, b.top - c)), 0);
  const out = (at, y, x) => ({ at, top: y - stage.top, side: x.side });
  let best = null;
  const weigh = (at, y, x) => {
    const a = cost(y, x);
    if (!best || a < best.a - 1e-6) best = { at, y, x, a };
    return a;
  };
  for (const x of xs) for (const k of ['top', 'bottom', 'middle']) if (weigh(k, named[k], x) <= 1e-6) return out(k, named[k], x);
  for (const x of xs) {
    // A band between the players: every place from the top to the bottom, 4 px apart; the middle of the tallest run
    // that covers nobody (centred first, then at either edge).
    let run = null, tallest = null;
    for (let y = lo; y <= hi + 1e-9; y += 4) {
      if (weigh('free', y, x) <= 1e-6) {
        run = run ? { from: run.from, to: y } : { from: y, to: y };
        if (!tallest || run.to - run.from > tallest.to - tallest.from) tallest = { ...run };
      } else run = null;
    }
    if (tallest) return out('free', (tallest.from + tallest.to) / 2, x);
  }
  // Nowhere clear: the cheapest place (centred and a named one on a tie).
  return out(best.at, best.y, best.x);
}

/**
 * Go to `hash` instead of this address, so Back skips it (a redirect between set kinds): app.navigate's replace
 * option (js/main.js), with the address swapped first for a navigate without it (it then routes the address it finds).
 */
export function redirectTo(app, hash) {
  try { history.replaceState(history.state, '', hash); } catch { /* the address stays; navigate still routes */ }
  app.navigate(hash, { replace: true });
}

// ---------------------------------------------------------------- the app (browser only below)

const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

/** The Road (data/road.json): the app's copy, else road.js's loader (the three-tier fallback went with the audit). */
const getRoad = async (app, roadMod) => app?.data?.road ?? roadMod.loadRoad(app);

const roadNodesOf = (road) => (road?.chapters ?? []).flatMap((c) => c.nodes ?? []);

/** Mode contract (ARCHITECTURE §5.9). @returns {Promise<() => void>} unmount */
export async function mount(root, app, params = []) {
  const P = PLAY_DEFAULTS;
  const first = String(params[0] ?? '').toLowerCase() === 'first';
  const formations = app.data?.formations;
  const principles = app.data?.principles?.byId ?? {};
  const store = app.store;
  let alive = true;
  const cleanups = [];
  root.classList.add('pl-view');
  root.replaceChildren(el('div', { class: 'pl-loading', role: 'status' }, [el('p', { text: STRINGS.loading })]));

  const roadData = await getRoad(app, roadMod);
  if (!root.isConnected) return () => { alive = false; };
  const profile = roadMod.loadProfile(app);
  const myRole = profile?.role ?? app.settings?.role ?? 'LB';

  // ---- what to play
  let node = null;
  const want = !first && params[0] ? String(params[0]) : null;
  if (want && roadData) {
    try { node = roadMod?.nodeById?.(roadData, want) ?? roadNodesOf(roadData).find((n) => n.id === want) ?? null; } catch { node = null; }
    let open = true;
    try { open = node && typeof roadMod?.isUnlocked === 'function' ? roadMod.isUnlocked(roadData, profile, node.id) : !!node; } catch { open = !!node; }
    if (!open) node = null;
  }
  if (!node && roadData) {
    try { node = roadMod?.nextNode?.(roadData, profile) ?? null; } catch { node = null; }
    if (!node) node = roadNodesOf(roadData)[0] ?? null;
    if (!first && want && node) { try { history.replaceState(null, '', `#/play/${encodeURIComponent(node.id)}`); } catch { /* keep */ } }
  }
  let kind = node?.kind ?? 'spot';
  try { if (node && typeof roadMod?.repKind === 'function') kind = roadMod.repKind(roadData, node); } catch { /* the node's own kind */ }
  // A "Who's open?" node plays in #/pass: this address is replaced, so Back goes where you came from (never back here).
  if (!first && kind === 'pass') { redirectTo(app, `#/pass/${encodeURIComponent(node.id)}`); return () => { alive = false; }; }

  const nodeRec = node ? profile?.road?.[node.id] ?? {} : {};
  const nodePlays = Number(nodeRec.plays) || 0;
  const nodeStarsBefore = Number(nodeRec.stars) || 0;
  // The lesson demo runs once per node: its very first set (nothing played, no stars), lesson nodes only (never a
  // match, never the onboarding set, which has its own worked example).
  const demoFirst = !first && !!node && node.kind !== 'match' && nodePlays === 0 && nodeStarsBefore === 0;
  const count = first ? P.firstReps : P.setReps;

  let reps = [];
  try { reps = await buildReps(); } catch (err) { console.error('[fotbol] play: could not build the set', err); reps = []; }
  if (!alive || !root.isConnected) return () => { alive = false; };
  if (!reps.length) {
    root.replaceChildren(notice({ title: STRINGS.emptyTitle, text: STRINGS.emptyText, actions: [linkButton(STRINGS.home, '#/', { variant: 'primary', icon: 'arrow' })] }));
    return () => { alive = false; };
  }

  /** The set's reps: road.js buildSet (spot reps only here); the first set takes the easiest few. */
  async function buildReps() {
    const seed = first ? seedFor(`first-${myRole}`) : seedFor(node?.id ?? 'play', nodePlays);
    const ctx = {
      road: roadData, profile, index: app.data?.scenarios?.index ?? [], scenarios: app.data?.scenarios,
      catalogue: app.data?.principles, // data/principles.json: the generated drills' names and takeaways
      rewards: loadRewards(app), skills: S.loadSkills(store), seed, formations, app, first,
    };
    let list = [];
    try {
      if (first && typeof roadMod?.buildFirstSet === 'function') list = (await roadMod.buildFirstSet({ ...ctx, count })) ?? [];
      else if (node && typeof roadMod?.buildSet === 'function') list = (await roadMod.buildSet(node, ctx)) ?? [];
    } catch (err) { console.warn('[fotbol] play: road.js could not build the set', err); list = []; }
    // Each rep keeps the road's rep (`src`: the stage it wants, and the stages its builder worked out, road.js stagedRep).
    let items = list.filter((r) => r?.kind === 'spot' && r.scenario).map((r) => ({ raw: r.scenario, src: r }));
    if (!items.length) items = (await fallbackScenarios({ count: first ? 8 : count, principles: first ? null : node?.principles })).map((raw) => ({ raw, src: null }));
    const ready = items.map((it) => ({ ...it, s: prepare(it.raw) })).filter((it) => it.s);
    if (first) ready.sort((a, b) => (a.s.difficulty ?? 0) - (b.s.difficulty ?? 0));
    let chosen = ready.slice(0, count);
    // A demoed set teaches the NODE's own idea first: the demo rep (slot 0) must be one of the node's principles, so
    // the recall rep that usually opens a set slides to second (the kid came to learn the new idea, not the recalled one).
    if (demoFirst && node?.principles?.length) {
      const own = chosen.findIndex((it) => (it.s.principles ?? []).some((id) => node.principles.includes(id)));
      if (own > 0) chosen = [chosen[own], ...chosen.slice(0, own), ...chosen.slice(own + 1)];
    }
    // The stage each slot wants (PROGRESSIVE_FIELD §2): the road's tag, else its plan for the node's stars before the set.
    let plan = null;
    try { plan = typeof roadMod?.stagePlan === 'function' ? roadMod.stagePlan(nodeStarsBefore, { first, count: chosen.length }) : null; } catch { plan = null; }
    return chosen.map((it, i) => ({ s: it.s, src: it.src, stage: wantedStage(it.src, i, { plan, first }) }));
  }

  /** Without road.js (or with no set from it): authored drills for your position, easiest first, mirrored to your side. */
  async function fallbackScenarios({ count: n, principles: want = null }) {
    let refs = S.candidatesFor({ index: app.data?.scenarios?.index ?? [], role: myRole });
    if (!refs.length) refs = S.candidatesFor({ index: app.data?.scenarios?.index ?? [], role: myRole, anyRole: true });
    if (want?.length) {
      const hit = refs.filter((r) => (r.principles ?? []).some((p) => want.includes(p)));
      if (hit.length) refs = hit;
    }
    refs = [...refs].sort((a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0)).slice(0, n);
    const out = [];
    for (const ref of refs) {
      try {
        const raw = await app.data.scenarios.load(ref.file ?? ref.baseId);
        const s = normalizeScenario(raw);
        out.push(ref.mirror ? mirrorScenario(s) : s);
      } catch (err) { console.warn('[fotbol] play: could not load', ref.baseId, err); }
    }
    return out;
  }

  /** A scenario ready to play (normalised and valid), or null. */
  function prepare(raw) {
    try {
      const s = normalizeScenario(raw);
      const errors = validateScenario(s, { principles });
      if (errors.length) { console.warn(`[fotbol] play: ${s.id} is not valid`, errors); return null; }
      return s;
    } catch (err) {
      console.warn('[fotbol] play: bad scenario', err);
      return null;
    }
  }

  // ---- the stage
  const els = {};
  els.quit = el('a', { class: 'btn btn--ghost btn--icon pl-quit', href: '#/', 'aria-label': STRINGS.stop, title: STRINGS.stop }, [icon('close')]);
  els.dots = el('ol', { class: 'pl-dots', 'aria-hidden': 'true' }, reps.map(() => el('li')));
  els.where = el('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  els.board = el('div', { class: 'pl-board' });
  els.card = el('div', { class: 'pl-card', hidden: true }, [el('p', { class: 'pl-card-text' })]);
  els.line = el('p', { class: 'pl-line' });
  els.tip = el('p', { class: 'pl-tip', hidden: true });
  els.actions = el('div', { class: 'pl-actions' });
  els.reveal = el('div', { class: 'pl-reveal' });
  els.stage = el('div', { class: 'pl-stage' }, [els.board, els.card]);
  els.card.style.setProperty('--pl-card-gap', `${P.cardGapPx}px`); // (cardSpot's gap: the CSS places the card there)
  const view = el('div', { class: 'pl', dataset: { phase: 'set' } }, [
    el('div', { class: 'pl-top' }, [els.quit, els.dots, els.where]),
    els.stage,
    el('div', { class: 'pl-dock' }, [els.line, els.tip, els.actions, els.reveal]),
  ]);
  root.replaceChildren(view);
  const kitNumber = loadRewards(app)?.kit?.number ?? null;
  const youNumber = Number.isInteger(kitNumber) ? kitNumber : null; // YOUR shirt (the words name players by the numbers shown)
  // Player mode's pitch: tabletop figures and the easy-to-see ball (PROGRESSIVE_FIELD §4).
  const board = app.createBoard(els.board, { orientation: 'auto', labels: 'number', youNumber, figures: true });
  board.setOverlays({ thirds: false, lanes: false, zone14: false, offsideLine: null, backLine: null });
  const reveal = createPlayerReveal(els.reveal, { app });

  const set = {
    tally: createTally(reps.length), results: [], gained: emptyGains(), skills: S.loadSkills(store), streak: S.loadStreak?.(store),
    xpBefore: loadRewards(app).xp ?? 0, playedMs: 0, tapHintShown: false, glowHintShown: false,
  };
  let rep = null; // the rep on the pitch
  let raf = 0;
  const clock = { restart: null }; // playRange's clock (visibilitychange restarts it)
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms); timers.add(t); return t; };
  const stopPlayback = () => { cancelAnimationFrame(raf); raf = 0; };
  const stopAll = () => { stopPlayback(); for (const t of timers) clearTimeout(t); timers.clear(); };
  // Staging ahead that outlives the rep's own timers (stopAll): cleared only when the set goes (unmount).
  const aheadTimers = new Set();
  const aheadSoon = (fn, ms) => { const t = setTimeout(() => { aheadTimers.delete(t); if (alive) fn(); }, ms); aheadTimers.add(t); };
  cleanups.push(() => { for (const t of aheadTimers) clearTimeout(t); aheadTimers.clear(); });
  let keysShown = false;
  let ftCleanup = null;

  // The camera: board.setCamera, noting when an ease that starts now will land (the role card waits for it, and the
  // reveal's "Best spot" is placed again there: until then the board tells where it draws everyone in the view it is
  // leaving, or, easing back to no camera, the view drawn now).
  let camLands = 0;
  const moveCamera = (rect) => {
    const was = board.camera;
    const had = !!board.viewBox;
    board.setCamera(rect);
    const same = rect && was ? ['x0', 'x1', 'y0', 'y1'].every((k) => Math.abs(rect[k] - was[k]) < 1e-9) : !rect && !was;
    if (!same && had && !reducedMotion(app)) camLands = performance.now() + (Number(BOARD_DEFAULTS.cameraMs) || 450);
  };
  const landsIn = () => Math.max(0, camLands - performance.now());

  const setPhase = (p) => { view.dataset.phase = p; if (rep) rep.phase = p; };
  const setActions = (...nodes) => put(els.actions, ...nodes);
  const setTip = (text) => { els.tip.textContent = text ?? ''; els.tip.hidden = !text; els.tip.classList.remove('is-nudged'); };
  const frameWithSpot = (frame, spot) => withSpot(frame, rep.learnerId, spot);
  // The clip as the rep plays it: the full game's movement, only the cast drawn in a small or bigger game (watchFrame).
  const pictureAt = (t, spot) => watchFrame(rep.s, rep, t, spot, { formations });
  const draw = (frame) => board.render(frame, { learnerId: rep.learnerId, labels: 'number' });

  function renderDots(i) {
    [...els.dots.children].forEach((li, k) => {
      const done = set.tally.slots[k];
      li.className = [k === i ? 'is-current' : '', done !== null && k !== i ? 'is-done' : ''].filter(Boolean).join(' ');
      li.dataset.stars = done === null ? '' : String(done);
    });
    els.where.textContent = STRINGS.playOf(i + 1, reps.length);
  }

  /** Play [from, to] with the learner shown at `spot`; onEnd at `to`. */
  function playRange({ from, to, spot, onEnd }) {
    stopPlayback();
    let t = from, last = null;
    clock.restart = () => { last = null; }; // back from a hidden tab: carry on from where the play stopped
    const step = (now) => {
      if (!alive || !rep) return;
      if (last !== null) t = Math.min(to, t + Math.min(P.maxFrameDt, (now - last) / 1000));
      last = now;
      draw(pictureAt(t, spot));
      if (t >= to - 1e-9) { raf = 0; onEnd?.(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  /** The pitch length this rep needs in view on a phone held upright (drill.js repFocus). */
  function repFocus(r) {
    const xs = [r.start.x, r.base.x, r.ghost.spot.x];
    for (let t = 0; t < r.duration + P.focusStep; t += P.focusStep) {
      const f = frameAt(r.s, Math.min(t, r.duration), { formations });
      xs.push(f.ball.x);
      for (const p of f.players) if (p.role !== 'GK') xs.push(p.x);
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs) };
  }

  // ---- stages (PROGRESSIVE_FIELD §1, §5): each rep is staged ahead of time (cast.js bestStage takes up to ~120 ms on
  // a slow phone): the set's first while the pitch gets ready, each next one (and a Try again twin) while the reveal
  // before it is up (stageAhead), else when it is needed.
  const ahead = new Map(); // slot, or 'twin<slot>' → { s, scene, camera }
  /** A rep staged at `wanted` (road.js stagedRep: its set's builder staged it already; else cast.js bestStage), its
   *  judging scene (stagedScene) and its camera (stageCamera: none at the full match). A rep the engine cannot stage
   *  plays the full match as before (repScene). */
  function stageNow(s, src, wanted) {
    let st = null;
    try { st = src && typeof roadMod?.stagedRep === 'function' ? roadMod.stagedRep(src, wanted, { formations }) : null; } catch { st = null; }
    if (!st) {
      try { st = bestStage(s, wanted, { formations, principles: app.data?.principles }); } catch (err) {
        console.warn(`[fotbol] play: ${s?.id} could not be staged; it plays the full match`, err);
        st = null;
      }
    }
    const scene = st ? stagedScene(s, st) : { ...repScene(s, { formations, catalogue: app.data?.principles }), stage: 'full', cast: null, ids: null };
    // Its words (the player they mean by number: repWords); words about the sideline keep it in view (the one by the
    // ball: a small game's camera once showed "has the ball by the sideline" with no sideline in sight).
    let words = null;
    try { words = repWords(s, scene, { youNumber }); } catch (err) { console.warn(`[fotbol] play: ${s?.id}: its words`, err); words = null; }
    words ??= { question: questionFor(s), brief: briefFor(s), sideline: mentionsSideline(questionFor(s), briefFor(s)) };
    const extra = words.sideline ? [touchlineBy(scene.freezeFrame?.ball)].filter(Boolean) : [];
    return { s, scene, words, camera: stageCamera(s, scene, { formations, extra }), answer: answerCamera(scene, { extra }) };
  }
  const stagedAt = (key, make) => { if (!ahead.has(key)) ahead.set(key, make()); return ahead.get(key); };
  /** Rep i, staged at its slot's stage. */
  const repAt = (i) => stagedAt(i, () => stageNow(reps[i].s, reps[i].src, reps[i].stage));
  /** Rep i's Try again (its mirrored twin), staged at the stage its first try was played at (§2: Try again keeps it). */
  const twinAt = (i) => stagedAt(`twin${i}`, () => stageNow(mirrorScenario(reps[i].s), null, ahead.get(i)?.scene.stage ?? reps[i].stage));
  /**
   * Stage what may come next while this rep's reveal is up: this one's twin when Try again is offered (twinAheadMs: a
   * miss's reveal is quiet, and a quick tap on Try again should not wait for it; its timer outlives the reveal, so a
   * tap before it finds the staging on its way, not cancelled), and the next rep once the stars have popped
   * (stageAheadMs; road.js staged it already, so a quick Next costs little).
   */
  function stageAhead(slot, { twin = false } = {}) {
    if (twin) {
      aheadSoon(() => {
        if (over || (rep && rep.slot !== slot)) return; // moved on without it
        try { twinAt(slot); } catch (err) { console.warn('[fotbol] play: could not stage the twin ahead', err); }
      }, P.twinAheadMs);
    }
    later(() => {
      try { if (slot + 1 < reps.length) repAt(slot + 1); } catch (err) { console.warn('[fotbol] play: could not stage ahead', err); }
    }, P.stageAheadMs);
  }

  /** Everything the rep needs up front: timing, your start, the judging scene at the freeze (a staged rep's reduced
   *  frame: stagedScene), its camera or pitch length, its key players, and what it counts for (recordPolicy). */
  function makeRep(s, { slot, plan, retry, prep }) {
    const { scene, camera, answer, words } = prep;
    const policy = recordPolicy({ counts: plan.counts, aided: !!plan.aid || !!plan.example, example: !!plan.example, retry, firstSet: first });
    // camera: the clip's (the play as it runs); answerCam: the whistle's (the freeze, where YOU decide and see the
    // answer: answerCamera), widened if YOU go to its edge (keepInView).
    const r = {
      s, slot, plan, retry, policy, ...scene, camera, answerCam: camera ? answer ?? camera : null, spot: { ...scene.start }, phase: 'set', t0: performance.now(), armed: false, moved: false,
      words: words ?? { question: questionFor(s), brief: briefFor(s), sideline: false },
    };
    if (camera) {
      // A small or bigger game: the camera fits the cast (the figures are big), nobody is dimmed (§5: the spotlight is
      // the full match's).
      r.key = [];
    } else {
      const cue = judgeSpot({ ctx: scene.ctx, ghost: scene.ghost }, scene.start, { wording: 'kid', principles }).feedback.cue?.highlight ?? null;
      r.key = keyPlayers({ scenario: s, freezeFrame: scene.freezeFrame, ctx: scene.ctx, cue, learnerId: scene.learnerId });
      r.focus = repFocus(r);
    }
    return r;
  }

  // ---- one rep: resolves with 'next' or 'retry'
  function playRep(s, { slot, plan, retry = false, prep }) {
    return new Promise((resolve) => {
      try { rep = makeRep(s, { slot, plan, retry, prep: prep() }); } catch (err) {
        console.warn(`[fotbol] play: ${s?.id} could not be set up, skipped`, err); // a broken drill never stops the set
        resolve('skip');
        return;
      }
      rep.resolve = resolve;
      board.disableDrag();
      board.setAid(null);
      board.setGhost(null);
      board.setZone(null);
      board.setHeatmap(null);
      board.setMarkers([]);
      if (rep.camera) {
        // Steady through the rep; the board eases there from the last rep's view (at once under reduced motion).
        moveCamera(rep.camera);
        board.setSpotlight(null);
      } else {
        board.setFocus(rep.focus);
        moveCamera(null);
        board.setSpotlight([rep.learnerId, ...rep.key]);
      }
      reveal.clear();
      renderDots(slot);
      if (rep.plan.demo && !retry && !rep.demoDone) showDemo(); else showRoleCard();
    });
  }

  /**
   * The lesson demo (the owner, 2026-10-01): the idea's card (kid name and summary), the clip to the freeze, then the
   * answer SHOWN: the green and the Best spot appear and YOU walks there by itself, with the idea's because line.
   * "Your turn" (or a wait) hands the same play over as the warm-up. Every step advances on its own; a tap goes sooner.
   */
  function showDemo() {
    setPhase('demo');
    const idea = principles[rep.s.principles?.[0]] ?? null;
    const name = (typeof idea?.kidName === 'string' && idea.kidName) || repTitle(rep.s, principles);
    const summaryOf = (v) => (typeof v === 'string' ? v : v?.kid);
    put(els.line);
    els.line.textContent = name;
    setTip(summaryOf(idea?.summary) ?? '');
    draw(pictureAt(0, rep.start));
    board.setMarkers([]);
    const r0 = rep;
    const go = () => { if (alive && rep === r0 && rep.phase === 'demo') showWatch(); };
    setActions(button(STRINGS.watchFirst, { variant: 'primary', icon: 'play', className: 'pl-main', onClick: go }));
    announce(STRINGS.demoSr(name));
    later(go, P.demoTitleMs);
  }

  /** The demo's answer: the worked example's green, arrow and "Best spot", then YOU walks to the ring. */
  function showDemoAnswer() {
    setPhase('demo-answer');
    const r0 = rep;
    const idea = principles[rep.s.principles?.[0]] ?? null;
    const because = [typeof idea?.why === 'string' ? idea.why : idea?.why?.kid]
      .find((t) => usableText(t, PLAY_DEFAULTS.whyBecauseMaxWords)) ?? '';
    showExampleAnswer();
    els.line.textContent = because || rep.words.question;
    setTip('');
    setActions();
    const settle = () => {
      if (!alive || rep !== r0 || rep.phase !== 'demo-answer') return;
      const turn = () => {
        if (!alive || rep !== r0 || rep.phase !== 'demo-answer') return;
        rep.demoDone = true;
        rep.plan = { ...rep.plan, example: true }; // the answer stays to copy, exactly as the worked example leaves it
        rep.spot = { ...rep.start };
        draw(frameWithSpot(rep.freezeFrame, rep.spot));
        els.line.textContent = rep.words.question;
        showPlace({ example: true, turn: true });
      };
      setActions(
        button(STRINGS.watchAgain, { icon: 'play', className: 'pl-again', onClick: () => { if (rep === r0) { rep.spot = { ...rep.start }; showWatch(); } } }),
        button(STRINGS.yourTurn, { variant: 'primary', icon: 'check', className: 'pl-main', onClick: turn }),
      );
      announce([because, STRINGS.yourTurn].filter(Boolean).join('. '));
      later(turn, P.demoDwellMs);
    };
    // YOU walks to the best spot (a jump under reduced motion).
    if (reducedMotion(app)) {
      rep.spot = { ...rep.ghost.spot };
      draw(frameWithSpot(rep.freezeFrame, rep.spot));
      settle();
      return;
    }
    const from = { ...rep.start }, to = rep.ghost.spot, t0 = performance.now();
    const stepFrame = () => {
      if (!alive || rep !== r0 || rep.phase !== 'demo-answer') return;
      const u = Math.min(1, (performance.now() - t0) / P.demoSlideMs);
      const e = u * u * (3 - 2 * u); // ease in and out
      rep.spot = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      draw(frameWithSpot(rep.freezeFrame, rep.spot));
      if (u < 1) requestAnimationFrame(stepFrame); else settle();
    };
    later(() => requestAnimationFrame(stepFrame), landsIn() + P.cardSettleMs);
  }

  /**
   * The role card (§4.3 step 1), placed off YOU, the ball and the other players (placeCard) once the camera has landed
   * and the dock has its set height: until then the board draws everyone on the way there, and a card placed for where
   * they land covered YOU or the ball for a quarter of a second mid-ease (the verifier). It then shows for its usual
   * time (roleCardMs; roleChangedMs for a changed position). The card names the role only: the stage line ("Small
   * game: 3 v 2") went with the 2026-10-01 audit, since the pitch already shows how many players there are.
   */
  function showRoleCard() {
    setPhase('set');
    const card = repCard({ role: rep.s.learner.role, profileRole: myRole, retry: rep.retry });
    // The dock first (the pitch takes the room it leaves), then the picture.
    put(els.line);
    setTip('');
    setActions();
    draw(pictureAt(0, rep.start));
    board.setMarkers([{ type: 'ring', id: rep.learnerId, tone: card.changed ? 'cue' : 'info', pulse: true }]);
    els.card.hidden = true;
    els.card.querySelector('.pl-card-text').textContent = card.text;
    els.card.classList.toggle('is-changed', card.changed);
    els.card.dataset.stage = rep.stage;
    view.classList.toggle('is-role-change', card.changed);
    announce(card.text);
    const r0 = rep;
    const wait = landsIn() + P.cardSettleMs;
    later(() => {
      if (rep !== r0 || rep.phase !== 'set') return;
      els.card.hidden = false;
      placeCard();
    }, wait);
    let gone = false;
    const go = () => { if (gone || !alive || rep !== r0 || rep.phase !== 'set') return; gone = true; els.card.hidden = true; view.classList.remove('is-role-change'); showWatch(); };
    els.card.onclick = go;
    later(go, wait + (card.changed ? P.roleChangedMs : P.roleCardMs));
  }

  /**
   * The role card where it covers nobody (cardSpot, with where the board draws everyone: board.clientBox): the top or
   * the bottom of the pitch, the middle, a band between the players, the same at the left or right edge; else where it
   * covers least of YOU, the ball, the player on it, then anyone else (cardWeights).
   */
  function placeCard() {
    let spot = { at: 'middle', side: 'center', top: 0 };
    try {
      const W = P.cardWeights;
      const frame = pictureAt(0, rep.start);
      const key = new Set([frame.carrierId, rep.freezeFrame?.carrierId].filter(Boolean));
      const box = (id, weight) => ({ box: board.clientBox?.(id) ?? null, weight });
      const avoid = [
        box(rep.learnerId, W.you), box(BALL_ID, W.ball),
        ...frame.players.filter((p) => p.id !== rep.learnerId).map((p) => box(p.id, key.has(p.id) ? W.key : W.other)),
      ];
      const st = els.stage.getBoundingClientRect();
      // Measured centred (css/play.css: a card slid to an edge keeps that width, --pl-card-w, so it covers what was weighed).
      els.card.dataset.side = 'center';
      els.card.style.removeProperty('--pl-card-w');
      const w = els.card.offsetWidth || 0, cx = st.left + st.width / 2;
      spot = cardSpot({ top: st.top, bottom: st.bottom }, els.card.offsetHeight, avoid, w ? { left: cx - w / 2, right: cx + w / 2, room: { left: st.left, right: st.right } } : {});
      els.card.style.setProperty('--pl-card-top', `${Math.round(spot.top)}px`); // (a 'free' card's place)
      if (spot.side !== 'center') {
        // Its width as laid out, to the fraction (offsetWidth rounds, and a pixel either way can move a line break).
        const used = typeof getComputedStyle === 'function' ? Number.parseFloat(getComputedStyle(els.card).width) : NaN;
        els.card.style.setProperty('--pl-card-w', `${Number.isFinite(used) && used > 0 ? used : w + 1}px`);
      }
    } catch { spot = { at: 'middle', side: 'center', top: 0 }; }
    els.card.dataset.at = spot.at;
    els.card.dataset.side = spot.side ?? 'center';
  }

  function showWatch({ keepSpot = false } = {}) {
    setPhase('watch');
    // The clip's camera (after "Watch again", back from the whistle's).
    if (rep.camera) moveCamera(rep.camera);
    const saved = keepSpot ? { ...rep.spot } : null;
    board.disableDrag();
    board.setAid(null);
    board.setGhost(null);
    board.setMarkers([]);
    els.line.textContent = rep.words.brief;
    setTip('');
    setActions();
    playRange({
      from: 0, to: rep.freezeAt, spot: rep.start,
      onEnd: () => {
        app.sound?.play('whistle'); // the referee's whistle: play freezes here
        showFreeze(saved);
      },
    });
  }

  function showFreeze(savedSpot = null) {
    setPhase('freeze');
    const q = rep.words.question; // (the player it means by number where the game shows two of the group: repWords)
    els.line.textContent = q;
    announce(q);
    rep.spot = savedSpot ?? { ...rep.start };
    draw(frameWithSpot(rep.freezeFrame, rep.spot));
    // At the whistle a small or bigger game eases in on the freeze (answerCamera): the figures YOU decide among are big.
    if (rep.answerCam) moveCamera(rep.answerCam);
    if (rep.plan.demo && !rep.demoDone) {
      showDemoAnswer();
      return;
    }
    if (rep.plan.example && !rep.exampled) {
      rep.exampled = true;
      showExample();
      return;
    }
    // Back from "Watch again" in the worked example before YOU was moved: its answer is still there to copy.
    showPlace({ example: !!rep.plan.example && !rep.copied });
  }

  /**
   * The worked example (first set, rep 1): the hand drags YOU to the best spot and YOU snaps back, then "Your turn".
   * The answer stays to copy (R15: see it, then do it): the ring, an arrow from YOU and "Best spot" stay on the pitch
   * until YOU has been moved. Under reduced motion there is no hand: the same answer shows at once, and YOU can be
   * moved at once (no extra tap: the first drag still comes 2 taps after the first open).
   */
  function showExample() {
    setPhase('example');
    setTip(STRINGS.watchThis);
    setActions();
    if (reducedMotion(app)) { showPlace({ example: true }); return; }
    later(async () => {
      await board.showHintHand({ from: rep.start, to: rep.ghost.spot });
      if (!alive || rep?.phase !== 'example') return;
      showPlace({ example: true, turn: true });
    }, P.exampleDelayMs);
  }

  /** The worked example's answer on the pitch: the green (anywhere in it is right) with the ring inside it, an arrow
   *  from your start to the ring (where the hand took YOU) and "Best spot". */
  function showExampleAnswer() {
    board.setGhost(rep.ghost.spot);
    const zone = repZone();
    keepInView(...zone); // (a small game's camera takes in the whole green)
    const marks = () => [zoneMarker(zone), { type: 'arrow', from: rep.start, to: rep.ghost.spot, tone: 'fix' }, ...bestSpotMarks(rep.start, { arrow: true })].filter(Boolean);
    board.setMarkers(marks());
    // Placed again where the camera lands (the words' size and everyone's place are the landed view's).
    const r0 = rep;
    if (landsIn() > 0) later(() => { if (rep === r0 && rep.plan.example && !rep.copied && ['example', 'place'].includes(rep.phase)) board.setMarkers(marks()); }, landsIn() + P.cardSettleMs);
  }

  /**
   * "Best spot" by the ring as markers (bestSpotPlace, with what the board draws where its camera lands: YOU and YOUR
   * tag, the ball, the other players, the view): the words by the ring where they cover nobody, else a short callout
   * with a leader line from the ring. Before the board has a view (nothing measured yet): bestSpotMarker's place.
   * @param {{x:number,y:number}} you  where YOU stand
   * @param {{ arrow?: boolean, to?: {x:number,y:number}|null }} [opts]  arrow: an arrow runs from YOU to `to` (default the
   *   ring; after a miss, into the green: zoneArrowEnd), and the words keep off it
   */
  function bestSpotMarks(you, { arrow = false, to = null } = {}) {
    const o = board.orientation;
    const view = board.targetViewBox ?? board.viewBox;
    if (!view) return [bestSpotMarker(you, rep.ghost.spot, board)];
    const k = Number.parseFloat(board.el?.style?.getPropertyValue?.('--board-label-k')) || 1;
    const t = Number(board.tokenScale) || 1;
    const ring = project(rep.ghost.spot, o);
    const drawn = (id) => board.drawnBox?.(id, { landed: true }) ?? null;
    const place = bestSpotPlace({
      ring, r: (BOARD_DEFAULTS.tokenRadius + 0.5) * t, fs: P.labelFont * k, text: STRINGS.bestSpot,
      you: [drawn(rep.learnerId)], ball: drawn(BALL_ID),
      others: (rep.freezeFrame?.players ?? []).filter((p) => p.id !== rep.learnerId).map((p) => drawn(p.id)),
      arrow: arrow && dist(you, to ?? rep.ghost.spot) >= 0.5 ? { a: project(you, o), b: to ? project(to, o) : ring } : null, view,
    });
    const label = { type: 'label', at: unproject(place.at, o), text: STRINGS.bestSpot, tone: 'good', lift: 0, cls: 'pl-best' };
    if (place.kind !== 'callout') return [label];
    return [{ type: 'segment', a: unproject(place.from, o), b: unproject(place.to, o), tone: 'good', dashed: false, cls: 'pl-best-line' }, { ...label, cls: 'pl-best is-callout' }];
  }

  /** YOU was moved in the worked example: its answer goes (the glow aid still says how close you are). */
  function copied() {
    if (!rep.plan.example || rep.copied) return;
    rep.copied = true;
    board.setGhost(null);
    board.setMarkers([]);
  }

  /** The rep's green (zoneOf: where the right area gives 3 stars), traced once. */
  function repZone() {
    try { return zoneOf(rep.s, rep); } catch (err) { console.warn('[fotbol] play: no green for this play', err); return []; }
  }

  /** Decide: move YOU and lock it. `example`: the worked example's answer stays on the pitch until YOU is moved. */
  function showPlace({ turn = false, example = false } = {}) {
    setPhase('place');
    // The glow: hot anywhere in the right area (its 3 stars), warm just outside it, cool further, cold elsewhere and
    // where YOU started (levelAt: the reveal's own stars at YOUR spot).
    if (rep.plan.aid === 'glow') {
      const r0 = rep, area = areaOf(rep.s, rep);
      board.setAid({ kind: 'glow', target: rep.ghost.spot, levelAt: (p) => (rep === r0 ? levelAt(r0, area, p) : null) });
    }
    if (example) showExampleAnswer();
    setTip(turn ? placeTip({ turn }) : example ? STRINGS.ringIsBest : placeTip());
    if (example) set.tapHintShown = true;
    const lock = button(STRINGS.lockIt, { variant: 'primary', icon: 'check', className: 'pl-main pl-lock', onClick: lockIn });
    setActions(button(STRINGS.watchAgain, { icon: 'play', className: 'pl-again', onClick: () => showWatch({ keepSpot: true }) }), lock);
    board.enableDrag({
      ids: [rep.learnerId], tapToMove: rep.learnerId,
      onMove: (_id, p) => { if (rep?.phase !== 'place') return; rep.spot = { x: p.x, y: p.y }; draw(frameWithSpot(rep.freezeFrame, rep.spot)); },
      onEnd: (_id, p) => {
        if (rep?.phase !== 'place') return;
        rep.moved = true;
        copied();
        rep.spot = { x: p.x, y: p.y };
        draw(frameWithSpot(rep.freezeFrame, rep.spot));
        keepInView(rep.spot);
        // Done with once you moved.
        if ([STRINGS.armedHint, STRINGS.ringIsBest, STRINGS.tapWhere].includes(els.tip.textContent)) setTip('');
      },
      onArm: (id) => {
        if (!rep) return;
        rep.armed = !!id; // always in step with the board (disableDrag puts YOU down whatever the phase)
        if (rep.phase !== 'place') return;
        if (id) setTip(STRINGS.armedHint);
        else if ([STRINGS.armedHint, STRINGS.tapWhere].includes(els.tip.textContent)) setTip('');
      },
    });
    const token = board.el.querySelector(`.token[data-id="${rep.learnerId}"]`);
    if (lastKey && token) token.focus({ preventScroll: true }); else lock.focus({ preventScroll: true });
  }

  /** Say a tip again with a short pulse (under reduced motion the words just show), and read it out. */
  function nudgeTip(text) {
    setTip(text);
    els.tip.classList.remove('is-nudged');
    void els.tip.offsetWidth; // restart the pulse
    els.tip.classList.add('is-nudged');
    announce(text);
  }

  /** One short tip at most while you decide (R7, R14): "Your turn" after the worked example, the glow the first time it
   *  is on, how to move on the set's first rep, the keys once a key was pressed. */
  function placeTip({ turn = false } = {}) {
    if (turn) { set.tapHintShown = true; return STRINGS.yourTurnHint; }
    if (rep.plan.aid === 'glow' && !set.glowHintShown) { set.glowHintShown = true; return STRINGS.glowHint; }
    if (!set.tapHintShown) { set.tapHintShown = true; return STRINGS.tapHint; }
    return keysShown ? STRINGS.keysHint : '';
  }

  function keepInView(...spots) {
    const pts = spots.filter(isPoint);
    if (rep.answerCam) {
      // A small or bigger game: the camera stays put (it already fits YOUR start and the best spot) unless what is drawn
      // for YOU (the figure standing up the screen and YOUR tag over it: board.drawnBox), or a spot, went to the edge
      // of the view or past it (a drag near the top, the arrow keys): then it widens to take YOU in, head and tag too
      // (the board keeps room over the top of its rect for a figure and its tag). Checked where the camera lands.
      const vb = board.targetViewBox ?? board.viewBox, m = P.viewSlack;
      const boxes = pts.map((p) => { const v = project(p, board.orientation); return { x0: v.x, x1: v.x, y0: v.y, y1: v.y }; });
      const you = board.drawnBox?.(rep.learnerId, { landed: true });
      if (you) boxes.push(you);
      const out = !!vb && boxes.some((b) => b.x0 < vb.x + m || b.x1 > vb.x + vb.width - m || b.y0 < vb.y + m || b.y1 > vb.y + vb.height - m);
      if (out) {
        const next = cameraRect([{ x: rep.answerCam.x0, y: rep.answerCam.y0 }, { x: rep.answerCam.x1, y: rep.answerCam.y1 }, ...pts]);
        if (next && ['x0', 'x1', 'y0', 'y1'].some((k) => next[k] !== rep.answerCam[k])) {
          rep.answerCam = next;
          moveCamera(rep.answerCam);
        }
      }
      return;
    }
    const xs = pts.map((p) => p.x);
    board.setFocus({ x0: Math.min(rep.focus.x0, ...xs), x1: Math.max(rep.focus.x1, ...xs) });
  }

  // ---- lock in, judge, record
  function lockIn() {
    if (rep?.phase !== 'place') return;
    // YOU is picked up but was never moved: the tap on the pitch is still to come, so say so (never lock the start by
    // mistake; Lock it with YOU put down still locks where you stand).
    if (lockAction(rep) === 'nudge') { nudgeTip(STRINGS.tapWhere); return; }
    setPhase('judged');
    board.disableDrag();
    board.setAid(null);
    const s = rep.s;
    rep.judged = revealFor(s, rep, rep.spot, { principles, youNumber });
    const { stars, move } = rep.judged;
    // Try again is practice: nothing is recorded and the slot keeps the first try (recordPolicy).
    if (!rep.policy.practice) record(rep.judged);
    if (rep.policy.tally) {
      set.tally = tallyTry(set.tally, { slot: rep.slot, stars });
      // move: what you did best (Full time's "Best move"); none to name below 3 stars without praise, and never the
      // worked example (its answer was shown)
      set.results[rep.slot] ??= { stars, title: repTitle(s, principles), move: rep.plan.example ? null : move ?? (stars >= 3 ? undefined : null) };
    }
    showReveal();
  }

  /** Elo, streaks and history exactly as a drill rep (drill.js lockIn), then the rep's rewards (drill.js rewardRep),
   *  each as far as the rep's recordPolicy allows. */
  function record(judged) {
    const { judgement, misId } = judged;
    const s = rep.s, r = judgement.result, pol = rep.policy;
    const { id, stars, score, score01, event } = recordOf(s, judged);
    try {
      if (pol.elo) {
        set.skills = eloUpdate(set.skills, { principles: s.principles, role: s.learner.role, score01 });
        S.saveSkills(store, set.skills);
      }
      if (pol.streak && typeof S.updateStreak === 'function' && set.streak) {
        set.streak = S.updateStreak(set.streak, { day: S.dayKey(new Date()), score });
        S.saveStreak?.(store, set.streak);
      }
      if (pol.history) {
        // Coach mode's history keeps the strict score and grade; `stars` are the ones the kid saw (stickers read them).
        S.appendHistory(store, {
          t: Date.now(), mode: 'drill', via: 'play', id: s.id, baseId: id, title: s.title ?? '', module: s.module ?? null,
          principles: s.principles ?? [], role: s.learner.role, score: r.score, grade: r.grade, stars,
          dist: Math.round(dist(rep.spot, rep.ghost.spot) * 10) / 10, ms: Math.round(performance.now() - rep.t0), confidence: null,
          misconception: misId, mirrored: !!s.mirrorOf || /-m$/.test(String(s.id)), reasons: judgement.feedback.reasons.map((x) => x.ruleId),
          nodeId: first ? 'first' : node?.id ?? null, aid: rep.plan.example ? 'example' : rep.plan.aid ?? null,
        });
      }
    } catch (err) { console.warn('[fotbol] play: could not save the rep', err); }
    if (!pol.rewards) return; // the first set's taught reps are the tutorial: no XP (R28)
    let gained = award(app, event, { celebrate: false });
    for (const pid of pol.mastery ? s.principles ?? [] : []) {
      const m = mastery(set.skills, pid);
      const tier = typeof Rewards.cardTier === 'function' ? Rewards.cardTier(loadRewards(app), pid) : 0;
      if (m > tier) gained = mergeGains(gained, award(app, { type: 'mastery', principleId: pid, stars: m }, { celebrate: false }));
    }
    set.gained = mergeGains(set.gained, gained);
  }

  // ---- the reveal
  /**
   * The answer's markers: the right area as a soft green zone (zoneOf: anywhere in it is 3 stars) with the best-spot
   * ring inside it (setGhost); in the green (3 stars) nothing more: no arrow, no words. After a miss: an arrow from
   * YOUR spot into the green's nearest edge (zoneArrowEnd), "Best spot" by the ring (bestSpotMarks: by the ring, or a
   * callout when nowhere by it is clear), and one cue the pitch can name (cueMarker: no unlabelled lines; its player by
   * number where the game shows two of the group). The zone and the ring count as the answer (R8: 2 cues at most).
   */
  function answerMarks() {
    const { judgement, stars, who } = rep.judged;
    const zone = repZone();
    const marks = [zoneMarker(zone)].filter(Boolean);
    if (stars < 3) {
      const to = zoneArrowEnd(zone, rep.spot, rep.ghost.spot);
      const arrow = !!to && dist(rep.spot, to) >= 0.5;
      if (arrow) marks.push({ type: 'arrow', from: rep.spot, to, tone: 'fix' });
      marks.push(...bestSpotMarks(rep.spot, { arrow, to }));
    }
    const rules = judgement.result.rules;
    const cue = stars < 3 ? cueMarker(rep.judged.cue ?? judgement.feedback.cue, { rules, ball: rep.freezeFrame.ball, name: (t, id) => (who ? who.rule(t, id, rules, rep.spot) : t) }) : null;
    if (cue) marks.push(cue);
    return { marks, cue, zone };
  }

  function drawAnswer() {
    const { line, why } = rep.judged;
    draw(frameWithSpot(rep.freezeFrame, rep.spot));
    board.setGhost(rep.ghost.spot);
    if (rep.answerCam) moveCamera(rep.answerCam); // (back from "See what happens", which plays on the clip's camera)
    // Words about the sideline keep it in view (the one by the best spot), as the question's did.
    // One answerMarks() for the cue and zone (the extra marker set that was built and thrown away here went with the
    // 2026-10-01 audit); the markers place once now and once more when the camera has landed and the reveal has its
    // height (the words' size and everyone's place are the landed view's).
    const { cue, zone } = answerMarks();
    const side = mentionsSideline(line, why?.summary, ...(why?.reasons ?? []), cue?.label) ? touchlineBy(rep.ghost.spot) : null;
    keepInView(rep.spot, rep.ghost.spot, side, ...zone); // (the whole green in view)
    const place = () => board.setMarkers(answerMarks().marks);
    place(); // placed for the view keepInView may have widened
    if (cue?.type === 'player' && !rep.camera) board.setSpotlight([rep.learnerId, ...rep.key, cue.id]);
    const r0 = rep, ph = rep.phase;
    if (landsIn() > 0) later(() => { if (rep === r0 && rep.phase === ph) place(); }, landsIn() + P.cardSettleMs);
  }

  function showReveal() {
    setPhase('reveal');
    const { stars, line, why } = rep.judged;
    const pol = rep.policy;
    put(els.line);
    setTip('');
    setActions();
    // Try again says it is practice; the set's first reveal says the green is the answer; a warm-up rep says its
    // stars are not counted yet; a first try the kid actually played may get the once-a-set "Hard one" after a miss
    // (R20; never for locking in at the start, where the line already says what happened).
    const miss = revealNote(set.tally, { stars, practice: pol.practice, warmup: !pol.practice && !pol.rewards, still: rep.judged.still });
    set.tally = miss.tally;
    const retry = stars <= 1 && !rep.retry;
    stageAhead(rep.slot, { twin: retry }); // the next rep (and a Try again twin) while the reveal is up
    reveal.show({
      stars, word: wordForStars(stars), line, note: miss.note, why,
      celebrate: pol.celebrate, // the set's one big celebration: never practice or the worked example
      onNext: () => done('next'),
      onRetry: retry ? () => done('retry') : null,
      onReplay: () => seeWhatHappens(),
      replayLabel: STRINGS.seeWhat,
    });
    // The answer on the pitch once the dock has the reveal in it (the pitch takes the room it leaves).
    drawAnswer();
  }

  function done(action) {
    if (!rep || rep.phase !== 'reveal') return;
    set.playedMs += Math.min(P.maxRepMs, performance.now() - rep.t0);
    stopAll();
    const resolve = rep.resolve;
    rep.phase = 'done';
    resolve?.(action);
  }

  /** "See what happens": the play runs on from the freeze with you where you stood; the best-spot ring stays. */
  function seeWhatHappens() {
    if (rep?.phase !== 'reveal') return;
    setPhase('replay');
    reveal.setBusy(true);
    board.setMarkers([]);
    board.setGhost(rep.ghost.spot);
    if (rep.camera) moveCamera(rep.camera); // the play runs on: the clip's camera takes in where it goes
    const more = rep.duration - rep.freezeAt >= P.minContinuation;
    const from = more ? rep.freezeAt : Math.max(0, rep.freezeAt - P.replayLead);
    const to = more ? rep.duration : rep.freezeAt;
    playRange({
      from, to, spot: rep.spot,
      onEnd: () => later(() => {
        if (rep?.phase !== 'replay') return;
        setPhase('reveal');
        drawAnswer();
        reveal.setBusy(false);
      }, P.replayHoldMs),
    });
  }

  // ---- the set
  async function runSet() {
    for (let i = 0; i < reps.length && alive; i++) {
      const plan = first ? firstSetStep(i) : setStep(i, { nodePlays, nodeStars: nodeStarsBefore, demo: demoFirst });
      let action = await playRep(reps[i].s, { slot: i, plan, prep: () => repAt(i) });
      if (alive && action === 'retry') {
        // Try again: the mirrored twin, at the stage the first try was played at (twinAt).
        let twin = null;
        try { twin = twinAt(i); } catch (err) { console.warn('[fotbol] play: the twin could not be set up, skipped', err); }
        if (twin) action = await playRep(twin.s, { slot: i, plan: { ...plan, example: false }, retry: true, prep: () => twin });
      }
    }
    if (alive) finish();
  }

  let over = false; // Full time has shown, or the set was left and kept (keepPartial): record nothing twice
  /** Put the set on the Road (road.recordSet): the stars of the reps locked in (first tries). Not the first set. */
  function recordOnRoad() {
    // The demo slot's warm-up is practice: its star never reaches the node's record (the kid just watched the answer).
    const repStars = set.tally.slots.filter((st, i) => st !== null && !(demoFirst && i === 0));
    if (first || !node || !repStars.length || typeof roadMod?.recordSet !== 'function') return null;
    try { return roadMod.recordSet(app, node.id, repStars); } catch (err) { console.warn('[fotbol] play: could not record the set', err); return null; }
  }

  /** Leaving before Full time keeps what was played (R37, ICO standard 5): the reps locked in so far go on the Road as
   *  a shorter set, and the play time counts toward the break nudge (R22). Nothing asks "are you sure?". */
  function keepPartial() {
    if (over) return;
    over = true;
    const inRep = rep && rep.phase !== 'done' ? Math.min(P.maxRepMs, performance.now() - rep.t0) : 0;
    recordOnRoad();
    try { addPlayTime(app, set.playedMs + inRep); } catch { /* the nudge waits for the next set */ }
  }

  function finish() {
    stopAll();
    over = true;
    // The set's first tries as a rewards session, as "Who's open?" sends it: a star on every play is "Perfect set" (a
    // skill, no XP). Not the first set: the tutorial earns nothing (R28).
    const repStars = tallyStars(set.tally);
    if (!first && repStars.length) {
      try { set.gained = mergeGains(set.gained, award(app, { type: 'session', stars: repStars }, { celebrate: false })); } catch (err) { console.warn('[fotbol] play: could not reward the set', err); }
    }
    const nodeStars = recordOnRoad();
    teardownStage();
    const again = node ? `#/play/${encodeURIComponent(node.id)}` : '#/play';
    ftCleanup = showFullTime(root, app, {
      node: first ? null : node,
      reps: set.results.filter(Boolean),
      xpBefore: set.xpBefore, xpAfter: loadRewards(app).xp ?? set.xpBefore,
      gained: set.gained, nodeStars, budget: reveal.budget, playedMs: set.playedMs,
      homeLabel: first ? STRINGS.next : undefined,
      onHome: () => app.navigate(first ? '#/kickoff/kit' : '#/'),
      onAgain: first ? null : () => app.navigate(again),
    });
  }

  let stageUp = true;
  function teardownStage() {
    if (!stageUp) return;
    stageUp = false;
    stopAll();
    reveal.destroy();
    board.destroy();
  }

  // ---- keys: Enter locks in (unless a control has focus); the keyboard tip only after a key press
  let lastKey = false;
  const onKey = (e) => {
    lastKey = true;
    if (!rep || e.defaultPrevented) return;
    if (!keysShown && rep.phase === 'place' && /^Arrow|^Tab$/.test(e.key)) {
      keysShown = true;
      setTip(STRINGS.keysHint);
    }
    if (e.key !== 'Enter' || rep.phase !== 'place') return;
    if (e.target?.closest?.('button, a, input, select, textarea, summary, [contenteditable]')) return;
    e.preventDefault();
    lockIn();
  };
  const onPointer = () => { lastKey = false; };
  document.addEventListener('keydown', onKey);
  const onVisible = () => { if (!document.hidden) clock.restart?.(); };
  document.addEventListener('visibilitychange', onVisible);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisible));
  document.addEventListener('pointerdown', onPointer, true);
  cleanups.push(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer, true); });

  runSet().catch((err) => {
    console.error('[fotbol] play: the set stopped', err);
    if (!alive) return;
    teardownStage();
    root.replaceChildren(notice({ title: STRINGS.failedTitle, text: STRINGS.failedText, actions: [linkButton(STRINGS.home, '#/', { variant: 'primary', icon: 'arrow' })] }));
  });

  return () => {
    alive = false;
    try { keepPartial(); } catch (err) { console.warn('[fotbol] play: could not keep the set', err); }
    stopAll();
    for (const fn of cleanups) { try { fn(); } catch { /* gone */ } }
    try { ftCleanup?.(); } catch { /* gone */ }
    teardownStage();
  };
}
