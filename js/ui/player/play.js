// Player mode: "Find your spot" (docs/KID_REDESIGN.md §4.1 step 3, §4.3, §4.5).
//
//   #/play            the next node on the Road (road.js nextNode)
//   #/play/<nodeId>   that node (a locked or unknown node plays the next one instead: never a dead end)
//   #/play/first      the first set: 3 easy reps for your position. Rep 1 is a worked example (a hand drags YOU to
//                     the best spot, YOU snaps back, "Your turn"), rep 2 has the glow aid, rep 3 none. Then Full time,
//                     then #/kickoff/kit.
//
// A set is 5 reps from road.js buildSet (a 'pass' node goes to #/pass). One rep, about 20 s:
//   set     the role card over the pitch ("You're the left back"; "Now you're the striker" when the position is not
//           your own) while YOU pulses
//   watch   play runs to the freeze; YOU stand where you started (caught watching); only YOU, the ball and up to 4
//           key players are lit, the rest at 40 % (board.setSpotlight); the brief is the one line
//   freeze  the whistle; the question (12 words or fewer)
//   move    drag YOU, tap YOU then a spot, or just tap a spot; "Watch again"; the glow aid on early reps
//   lock    "Lock it" (or Enter); no confidence step. YOU picked up (a tap on YOU) but not moved: Lock it points to
//           the tip ("Tap where you want to go.") instead of locking the start
//   reveal  the best-spot ring and an arrow from your spot on the pitch, and at most one cue, labelled in plain words
//           (cueMarker); stars, one word and one line (js/ui/player/reveal.js); Next · Why? · Try again (0-1 stars:
//           the mirrored twin, "Same play, other side") · See what happens
// After a miss, once a set: "Hard one. Pros miss it too." (R20). Stars come from the score (rewards.js starsForScore);
// letters, "/100", codes and metres never show. The words match the stars (pickLine, whyFor): 3 stars get praise
// only, 2 stars one fix at most, and the drill's own ideas come before any other rule's.
//
// What a rep counts for is recordPolicy's call. A counted first try updates Elo, the history and the streaks exactly
// as a Coach-mode drill does (js/ui/modes/drill.js), awards the rep and any sticker its mastery earned (celebrate:
// false: Full time shows them) and may get the set's one big celebration. Try again is practice only, as in "Who's
// open?": nothing is recorded, it never celebrates, and the slot keeps the first try's stars (the tally, Full time,
// the Road), so copying the ring you were just shown is never worth more than getting it right first time.
// Worked-example and glow-aided reps teach; they skip Elo (and, in the first set, which is the tutorial, the XP too:
// R28). The set ends with road.recordSet and showFullTime. Leaving a set early (the X, Back, anything) keeps what was
// played (R37, ICO standard 5: quit at any time without losing progress): the Road records the reps locked in so far
// (their stars, as a shorter set) and the play time counts toward the break nudge; no "are you sure?" step.
//
// Pure helpers (exported for tests/player-play.test.js) come first; nothing touches the DOM at import time.

import { el, button, icon, notice, linkButton, announce } from '../components.js';
import { BALL_ID, project } from '../board.js';
import { frameAt, learnerBaseAt, timing } from '../../engine/timeline.js';
import { normalizeScenario, mirrorScenario, validateScenario, learnerId as learnerIdOf } from '../../engine/scenario.js';
import { buildContext } from '../../engine/context.js';
import { computeGhost } from '../../engine/ghost.js';
import { toleranceFor } from '../../engine/score.js';
import { judgeSpot } from '../../engine/analyse.js';
import { explain, EXPLAIN_DEFAULTS, ZONE_REASON } from '../../engine/explain.js';
import { RULES_BY_ID } from '../../engine/rules/index.js';
import { update as eloUpdate, mastery } from '../../engine/elo.js';
import { familyOf } from '../../engine/roles.js';
import { MID_Y, WIDTH } from '../../engine/pitch.js';
import { dist } from '../../engine/geometry.js';
import * as Rewards from '../../rewards.js';
import { award, loadRewards, mergeGains, emptyGains } from '../rewards-store.js';
import { reducedMotion } from '../celebrate.js';
import * as S from '../session.js';
import { createPlayerReveal } from './reveal.js';
import { showFullTime, addPlayTime } from './fulltime.js';
import { STRINGS as SHARED, roleCard, starWord } from './strings.js';

export const PLAY_DEFAULTS = Object.freeze({
  setReps: 5, // [S] §3: a set is 5 reps
  firstReps: 3, // [S] §4.1: the first set is 3 easy reps
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
  starsAt: Object.freeze([55, 75, 90]), // [S] §6.3 starsForScore: 1, 2 and 3 stars (used if rewards.js lacks it)
  whyMaxWords: 20, // [D] a reason, praise line or summary longer than this never goes on the Why? sheet
  moveMaxWords: 12, // [D] Full time's "Best move: ..." (2 words) stays within a 14-word line (R2)
  cueLabelSide: 6, // [D] metres in from the touchline away from the ball: where a cue line's label sits
});

export const STRINGS = Object.freeze({
  question: SHARED.question,
  watch: 'Watch the play.',
  lockIt: SHARED.lockIt,
  watchAgain: SHARED.watchAgain,
  tapHint: 'Drag YOU, or tap where you want to go.',
  armedHint: 'Now tap a spot.',
  tapWhere: 'Tap where you want to go.',
  keysHint: 'Arrow keys move YOU. Enter locks it.',
  watchThis: 'Watch this.',
  yourTurnHint: 'Your turn: drag YOU, or tap a spot.',
  ringIsBest: 'The ring is the best spot. Move YOU there.',
  glowHint: 'Your ring gets hot near the best spot.',
  otherSide: 'Same play, other side',
  practiceNote: 'Practice only. Your first try counts.',
  missNote: SHARED.missNote,
  lineBest: 'That is the best spot.',
  lineFix: 'Follow the arrow to the best spot.',
  bestSpot: SHARED.bestSpot,
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

/** Stars for a score (§6.3): rewards.js starsForScore when it exists, else 3 at 90, 2 at 75, 1 at 55. */
export function starsForScore(score) {
  if (typeof Rewards.starsForScore === 'function') {
    const n = Rewards.starsForScore(score);
    if (Number.isFinite(n)) return Math.max(0, Math.min(3, Math.round(n)));
  }
  const [one, two, three] = PLAY_DEFAULTS.starsAt;
  const s = Number(score);
  return !Number.isFinite(s) ? 0 : s >= three ? 3 : s >= two ? 2 : s >= one ? 1 : 0;
}

/** The word for 0-3 stars (§6.3): rewards.js wordForStars when it exists, else strings.js. */
export function wordForStars(stars) {
  if (typeof Rewards.wordForStars === 'function') {
    const w = Rewards.wordForStars(stars);
    if (typeof w === 'string' && w) return w;
  }
  return starWord(stars);
}

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
 * The reveal's one line (≤ 14 words, simple wording, no metres or codes), matched to the stars (R17, R19). `own` is the
 * drill's ideas (scenario.principles): a line about them comes before one about any other rule.
 *   3 stars   praise only, for what you got right ("That is the best spot." when none fits)
 *   2 stars   one fix: the top reason ("Follow the arrow to the best spot." when none fits)
 *   0-1 star  the drill's note on the mistake you made (its misconception), else the top reason about the drill's
 *             ideas, else the drill's own lesson (its takeaway), else any other reason
 * @param {{ feedback?: object, reasons?: object[], praise?: (string|object)[], misconception?: string|null, stars: number,
 *   principles?: string[], takeaway?: string }} m  feedback: judgeSpot's, in kid wording; reasons (default
 *   feedback.reasons): explain.js reasons, more than the one kid feedback keeps; praise (default feedback.praise):
 *   praiseOf, so a line can be matched to its idea
 */
export function pickLine({ feedback = null, reasons, praise, misconception = null, stars = 0, principles: own = [], takeaway = '' } = {}) {
  const ok = (s) => usableText(s, PLAY_DEFAULTS.lineMaxWords);
  const ideas = Array.isArray(own) ? own : [];
  if (stars >= 3) return drillFirst(praise ?? feedback?.praise ?? [], ideas).map(textOf).find(ok) ?? STRINGS.lineBest;
  const list = drillFirst(reasons ?? feedback?.reasons ?? [], ideas);
  const about = list.filter((r) => ideas.length && ideasOf(r).some((id) => ideas.includes(id))).map(textOf);
  const rest = list.map(textOf).filter((t) => !about.includes(t));
  const candidates = stars <= 1 ? [misconception, ...about, takeaway, ...rest] : [...about, ...rest];
  return candidates.find(ok) ?? STRINGS.lineFix;
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
  const all = drillFirst(reasons ?? [], ideas).map(textOf);
  const fixes = stars >= 3 ? 0 : stars === 2 ? (all.includes(line) ? 0 : 1) : 2;
  const more = all.filter((t) => ok(t) && t !== line).slice(0, fixes);
  const good = drillFirst(praise ?? [], ideas).map(textOf).filter((t) => ok(t) && t !== line).slice(0, 2);
  return { title, summary, reasons: more, praise: good };
}

/**
 * What you did best on a rep, for Full time's "Best move" (pure): the rep's praise, the drill's own ideas first, said as
 * what you did ("you stayed onside", not "Good timing, you stayed onside."); null with no praise that fits.
 * @param {{ praise?: (string|object)[], principles?: string[] }} m
 */
export function bestMoveOf({ praise = [], principles: own = [] } = {}) {
  const t = drillFirst(praise ?? [], Array.isArray(own) ? own : []).map(textOf).find((s) => usableText(s, PLAY_DEFAULTS.moveMaxWords));
  if (!t) return null;
  const s = t.trim().replace(/^(?:good|great|nice)(?:\s+[a-z]+)?,\s*/i, '').replace(/[.!]+$/, '');
  return s ? s[0].toLowerCase() + s.slice(1) : null;
}

/**
 * The cue at the reveal (R8: the words go on the pitch; 2 highlighted cues at most) as a Player-mode board marker
 * (pure): a ring round a player or a spot as it is; a line (the line of your defenders, a pass...) only with its
 * name in plain words ("Your defenders", "Pass to you"), written away from the ball; a line with no words is dropped,
 * since an unlabelled dashed line explains nothing.
 * @param {{ ruleId?: string, highlight?: object }|null} cue  judgeSpot's feedback.cue
 * @param {{ rules?: object[], ball?: {x:number,y:number}|null }} [opts]  rules: the evaluation's results (whose line it is)
 * @returns {object|null}
 */
export function cueMarker(cue, { rules = [], ball = null } = {}, P = PLAY_DEFAULTS) {
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
  if (!label) return null;
  const out = { ...hl, tone: 'cue', label, clear: 'you' };
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
export function setStep(i, { nodePlays = 0, nodeStars = 0 } = {}, P = PLAY_DEFAULTS) {
  const glow = nodePlays === 0 && nodeStars === 0 && i < P.glowReps;
  return { example: false, aid: glow ? 'glow' : null, counts: true };
}

/** The set's tally (pure): each slot keeps its first try's stars. Try again is practice (recordPolicy): it is never
 *  tallied, and a second try at a slot could not change it anyway. */
export const createTally = (n) => ({ slots: Array.from({ length: Math.max(0, n) }, () => null), missNoted: false });
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

/** A rep's name for Full time's "Best move": its main idea's simple name, else its simple title. */
export function repTitle(scenario, principles = {}) {
  const p = principles?.[scenario?.principles?.[0]];
  return (typeof p?.kidName === 'string' && p.kidName) || scenario?.titleKid || scenario?.title || '';
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

/**
 * The judging scene of a rep (pure; ARCHITECTURE §5.3): its timing, your start, the frame at the freeze with you at
 * the start, your base, the context and the best spot (the ghost).
 * @param {object} s  a normalised scenario
 * @param {{ formations: object }} opts
 */
export function repScene(s, { formations } = {}) {
  const { duration, freezeAt } = timing(s);
  const learnerId = learnerIdOf(s);
  const auto = frameAt(s, 0, { formations }).players.find((p) => p.id === learnerId);
  const start = s.learner.start ? { ...s.learner.start } : { x: auto.x, y: auto.y };
  const freezeFrame = frameAt(s, freezeAt, { formations });
  const base = learnerBaseAt(s, freezeAt, { formations });
  const ctx = buildContext({ ...freezeFrame, players: freezeFrame.players.map((p) => (p.id === learnerId ? { ...p, x: start.x, y: start.y } : p)) }, { learnerId, base });
  const authored = s.answer?.mode === 'authored' && s.answer.ideal;
  const ghost = computeGhost(ctx, { base: authored ? s.answer.ideal : base, tol: toleranceFor(s.learner.role, s.answer?.tol) });
  return { duration, freezeAt, learnerId, start, freezeFrame, base, ctx, ghost };
}

/**
 * Everything the reveal says about a spot (pure): the judgement, the stars, the line, the Why? sheet (its idea: the
 * one behind the line's reason, else the drill's own) and what you did best (Full time's "Best move").
 * @param {object} s  the scenario
 * @param {{ ctx: object, ghost: object }} scene  repScene's
 * @param {{x:number, y:number}} spot
 * @param {{ principles?: object }} [opts]  principles: data/principles.json by id
 */
export function revealFor(s, scene, spot, { principles = {} } = {}) {
  const judgement = judgeSpot({ ctx: scene.ctx, ghost: scene.ghost }, spot, { wording: 'kid', principles });
  const more = explain(judgement.result, scene.ctx, spot, { wording: 'kid', max: 3, principles, ghost: { spot: scene.ghost.spot, result: scene.ghost.result } });
  const stars = starsForScore(judgement.result.score);
  const mc = S.misconceptionAt(s, spot);
  const misText = mc ? S.wordingOf(mc.text, 'kid', mc.textKid) : null;
  const own = Array.isArray(s?.principles) ? s.principles : [];
  const reasons = more.reasons ?? [];
  const praise = praiseOf(judgement.result);
  const takeaway = takeawayFor(s);
  const line = pickLine({ reasons, praise, misconception: misText, stars, principles: own, takeaway });
  const source = reasons.find((r) => r.text === line);
  const drillIdea = principles[own[0]];
  const principle = principles[source?.principleId] ?? drillIdea;
  const why = whyFor({ principle, reasons, praise, line, stars, principles: own, takeaway: principle === drillIdea ? S.wordingOf(s?.takeaway, 'kid') : '' });
  const move = bestMoveOf({ praise, principles: own });
  return { judgement, more, stars, misId: mc?.id ?? null, misText, line, why, move };
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

const tryImport = async (url) => {
  try { return await import(url); } catch (err) { console.warn(`[fotbol] play: ${url} is not available`, err); return null; }
};

/** The Road (data/road.json): the app's copy, else road.js's loader, else the file. */
async function getRoad(app, roadMod) {
  if (app?.data?.road) return app.data.road;
  for (const fn of ['loadRoad', 'getRoad']) {
    if (typeof roadMod?.[fn] === 'function') {
      try { const r = await roadMod[fn](app); if (r) return r; } catch { /* next */ }
    }
  }
  try {
    const res = await fetch(new URL('../../../data/road.json', import.meta.url));
    if (res.ok) return await res.json();
  } catch { /* no road */ }
  return null;
}

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

  const roadMod = await tryImport('./road.js');
  const roadData = await getRoad(app, roadMod);
  if (!root.isConnected) return () => { alive = false; };
  let profile = null;
  try { profile = roadMod?.loadProfile?.(app) ?? null; } catch { profile = null; }
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
    let spot = list.filter((r) => r?.kind === 'spot' && r.scenario).map((r) => r.scenario);
    if (!spot.length) spot = await fallbackScenarios({ count: first ? 8 : count, principles: first ? null : node?.principles });
    const ready = spot.map(prepare).filter(Boolean);
    if (first) ready.sort((a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0));
    return ready.slice(0, count);
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
  const view = el('div', { class: 'pl', dataset: { phase: 'set' } }, [
    el('div', { class: 'pl-top' }, [els.quit, els.dots, els.where]),
    el('div', { class: 'pl-stage' }, [els.board, els.card]),
    el('div', { class: 'pl-dock' }, [els.line, els.tip, els.actions, els.reveal]),
  ]);
  root.replaceChildren(view);
  const kitNumber = loadRewards(app)?.kit?.number ?? null;
  const board = app.createBoard(els.board, { orientation: 'auto', labels: 'number', youNumber: Number.isInteger(kitNumber) ? kitNumber : null });
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
  let keysShown = false;
  let ftCleanup = null;

  const setPhase = (p) => { view.dataset.phase = p; if (rep) rep.phase = p; };
  const setActions = (...nodes) => put(els.actions, ...nodes);
  const setTip = (text) => { els.tip.textContent = text ?? ''; els.tip.hidden = !text; els.tip.classList.remove('is-nudged'); };
  const frameWithSpot = (frame, spot) => ({ ...frame, players: frame.players.map((p) => (p.id === rep.learnerId ? { ...p, x: spot.x, y: spot.y } : p)) });
  const pictureAt = (t, spot) => frameWithSpot(frameAt(rep.s, t, { formations }), spot);
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

  /** Everything the rep needs up front: timing, your start, the judging scene at the freeze (repScene), and what it
   *  counts for (recordPolicy). */
  function makeRep(s, { slot, plan, retry }) {
    const scene = repScene(s, { formations });
    const policy = recordPolicy({ counts: plan.counts, aided: !!plan.aid || !!plan.example, example: !!plan.example, retry, firstSet: first });
    const r = { s, slot, plan, retry, policy, ...scene, spot: { ...scene.start }, phase: 'set', t0: performance.now(), armed: false, moved: false };
    const cue = judgeSpot({ ctx: scene.ctx, ghost: scene.ghost }, scene.start, { wording: 'kid', principles }).feedback.cue?.highlight ?? null;
    r.key = keyPlayers({ scenario: s, freezeFrame: scene.freezeFrame, ctx: scene.ctx, cue, learnerId: scene.learnerId });
    r.focus = repFocus(r);
    return r;
  }

  // ---- one rep: resolves with 'next' or 'retry'
  function playRep(s, { slot, plan, retry = false }) {
    return new Promise((resolve) => {
      try { rep = makeRep(s, { slot, plan, retry }); } catch (err) {
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
      board.setFocus(rep.focus);
      board.setSpotlight([rep.learnerId, ...rep.key]);
      reveal.clear();
      renderDots(slot);
      showRoleCard();
    });
  }

  function showRoleCard() {
    setPhase('set');
    const card = repCard({ role: rep.s.learner.role, profileRole: myRole, retry: rep.retry });
    draw(pictureAt(0, rep.start));
    board.setMarkers([{ type: 'ring', id: rep.learnerId, tone: card.changed ? 'cue' : 'info', pulse: true }]);
    els.card.querySelector('.pl-card-text').textContent = card.text;
    els.card.hidden = false;
    els.card.classList.toggle('is-changed', card.changed);
    view.classList.toggle('is-role-change', card.changed);
    put(els.line);
    setTip('');
    setActions();
    announce(card.text);
    let gone = false;
    const go = () => { if (gone || !alive || rep?.phase !== 'set') return; gone = true; els.card.hidden = true; view.classList.remove('is-role-change'); showWatch(); };
    els.card.onclick = go;
    later(go, card.changed ? P.roleChangedMs : P.roleCardMs);
  }

  function showWatch({ keepSpot = false } = {}) {
    setPhase('watch');
    const saved = keepSpot ? { ...rep.spot } : null;
    board.disableDrag();
    board.setAid(null);
    board.setGhost(null);
    board.setMarkers([]);
    els.line.textContent = briefFor(rep.s);
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
    const q = questionFor(rep.s);
    els.line.textContent = q;
    announce(q);
    rep.spot = savedSpot ?? { ...rep.start };
    draw(frameWithSpot(rep.freezeFrame, rep.spot));
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

  /** The worked example's answer on the pitch (the ring, an arrow from your start and "Best spot"). */
  function showExampleAnswer() {
    board.setGhost(rep.ghost.spot);
    board.setMarkers([
      { type: 'arrow', from: rep.start, to: rep.ghost.spot, tone: 'fix' },
      bestSpotMarker(rep.start, rep.ghost.spot, board),
    ]);
  }

  /** YOU was moved in the worked example: its answer goes (the glow aid still says how close you are). */
  function copied() {
    if (!rep.plan.example || rep.copied) return;
    rep.copied = true;
    board.setGhost(null);
    board.setMarkers([]);
  }

  /** Decide: move YOU and lock it. `example`: the worked example's answer stays on the pitch until YOU is moved. */
  function showPlace({ turn = false, example = false } = {}) {
    setPhase('place');
    if (rep.plan.aid === 'glow') board.setAid({ kind: 'glow', target: rep.ghost.spot });
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
    const xs = spots.filter((p) => Number.isFinite(p?.x)).map((p) => p.x);
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
    rep.judged = revealFor(s, rep, rep.spot, { principles });
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
  function record({ judgement, misId }) {
    const s = rep.s, r = judgement.result, pol = rep.policy;
    const id = recordIdOf(s);
    try {
      if (pol.elo) {
        set.skills = eloUpdate(set.skills, { itemId: id, principles: s.principles, role: s.learner.role, score01: r.score / 100, prior: Number.isFinite(s.difficulty) ? s.difficulty : 0 });
        S.saveSkills(store, set.skills);
      }
      if (pol.streak && typeof S.updateStreak === 'function' && set.streak) {
        set.streak = S.updateStreak(set.streak, { day: S.dayKey(new Date()), score: r.score });
        S.saveStreak?.(store, set.streak);
      }
      if (pol.history) {
        S.appendHistory(store, {
          t: Date.now(), mode: 'drill', via: 'play', id: s.id, baseId: id, title: s.title ?? '', module: s.module ?? null,
          principles: s.principles ?? [], role: s.learner.role, score: r.score, grade: r.grade,
          dist: Math.round(dist(rep.spot, rep.ghost.spot) * 10) / 10, ms: Math.round(performance.now() - rep.t0), confidence: null,
          misconception: misId, mirrored: !!s.mirrorOf || /-m$/.test(String(s.id)), reasons: judgement.feedback.reasons.map((x) => x.ruleId),
          nodeId: first ? 'first' : node?.id ?? null, aid: rep.plan.example ? 'example' : rep.plan.aid ?? null,
        });
      }
    } catch (err) { console.warn('[fotbol] play: could not save the rep', err); }
    if (!pol.rewards) return; // the first set's taught reps are the tutorial: no XP (R28)
    let gained = award(app, { type: 'rep', scenarioId: id, role: s.learner.role, grade: r.grade, score: r.score, stars: starsForScore(r.score) }, { celebrate: false });
    for (const pid of pol.mastery ? s.principles ?? [] : []) {
      const m = mastery(set.skills, pid);
      const tier = typeof Rewards.cardTier === 'function' ? Rewards.cardTier(loadRewards(app), pid) : 0;
      if (m > tier) gained = mergeGains(gained, award(app, { type: 'mastery', principleId: pid, stars: m }, { celebrate: false }));
    }
    set.gained = mergeGains(set.gained, gained);
  }

  // ---- the reveal
  function drawAnswer() {
    const { judgement, stars } = rep.judged;
    draw(frameWithSpot(rep.freezeFrame, rep.spot));
    board.setGhost(rep.ghost.spot);
    const marks = [];
    const off = dist(rep.spot, rep.ghost.spot);
    if (off >= 1) marks.push({ type: 'arrow', from: rep.spot, to: rep.ghost.spot, tone: 'fix' });
    // The ring's label, unless YOU stand on the ring (YOUR tag is there, and the stars say it).
    if (off >= P.labelClear * board.tokenScale) marks.push(bestSpotMarker(rep.spot, rep.ghost.spot, board));
    // One cue after a miss, and only one the pitch can name (cueMarker: no unlabelled lines).
    const cue = stars < 3 ? cueMarker(judgement.feedback.cue, { rules: judgement.result.rules, ball: rep.freezeFrame.ball }) : null;
    if (cue) marks.push(cue);
    board.setMarkers(marks);
    if (cue?.type === 'player') board.setSpotlight([rep.learnerId, ...rep.key, cue.id]);
    keepInView(rep.spot, rep.ghost.spot);
  }

  function showReveal() {
    setPhase('reveal');
    const { stars, line, why } = rep.judged;
    const pol = rep.policy;
    drawAnswer();
    put(els.line);
    setTip('');
    setActions();
    // Try again says it is practice; a first try may get the once-a-set "Hard one" after a miss (R20).
    const miss = pol.practice ? { note: STRINGS.practiceNote, tally: set.tally } : missNote(set.tally, stars);
    set.tally = miss.tally;
    reveal.show({
      stars, word: wordForStars(stars), line, note: miss.note, why,
      celebrate: pol.celebrate, // the set's one big celebration: never practice or the worked example
      onNext: () => done('next'),
      onRetry: stars <= 1 && !rep.retry ? () => done('retry') : null,
      onReplay: () => seeWhatHappens(),
      replayLabel: STRINGS.seeWhat,
    });
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
      const plan = first ? firstSetStep(i) : setStep(i, { nodePlays, nodeStars: nodeStarsBefore });
      let s = reps[i];
      let action = await playRep(s, { slot: i, plan });
      if (alive && action === 'retry') {
        s = mirrorScenario(s);
        action = await playRep(s, { slot: i, plan: { ...plan, example: false }, retry: true });
      }
    }
    if (alive) finish();
  }

  let over = false; // Full time has shown, or the set was left and kept (keepPartial): record nothing twice
  /** Put the set on the Road (road.recordSet): the stars of the reps locked in (first tries). Not the first set. */
  function recordOnRoad() {
    const repStars = tallyStars(set.tally);
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
