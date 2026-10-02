// '#/pass' and '#/pass/<nodeId>': "Who's open?", the Player-mode passing set (docs/KID_REDESIGN.md §4.4).
//
//   #/pass            a quick set: PASS_DEFAULTS.reps generated pass drills for your position on the free-player idea
//                     mixed with playing forward (road.js buildQuickPassSet, data/road.json `quickPass`)
//   #/pass/<nodeId>   a Road pass node (road.js buildSet, which counts the set as begun: a reload deals new reps); a
//                     spot node sends you to #/play/<nodeId> before any set is built, replacing this address (Back
//                     never lands on the redirect again)
//
// One rep (about 15 s), played at its stage (docs/PROGRESSIVE_FIELD.md: road.js tags each rep with the stage its slot
// wants, cast.js bestStage stages it there or, when that stage cannot teach it, bigger):
//   set      the card: the game's size ("Small game: 3 v 2", "Now 6 v 5!" the first time the set grows, "Full match")
//            and "You've got the ball", once the camera has landed, at the top or bottom of the pitch, off YOU (and
//            YOUR tag), the ball, the teammates to pass to and every other player drawn (cardSpot); YOU is the
//            carrier. A small or bigger game shows only its cast (cast.js reduceFrame) and
//            the camera fits it through the build-up (board.setCamera: repCamera), so the figures are big; the full
//            match crops a phone's pitch to the play and spotlights the ball, YOU and the teammates to pass to
//   watch    2-3 s of build-up (passdrill.js passDrillPlayback: nobody held back, so YOU run onto the ball), then the
//            whistle and the freeze (the staged frame, which the staged rating rated)
//   choose   "Pick the best pass." A small or bigger game's camera eases in on the freeze (chooseCamera: its players
//            and the ball; "Watch again" eases back out). The teammates a tap can pick (the staged gate's targets:
//            nobody far away, nor the keeper, unless that pass is really on) are big numbered targets: a first tap
//            previews a dotted pass line, a second tap (or Pass) plays it
//   result   the ball travels (the camera widens to follow a pass into space off the view: flightCamera): "Cut out!"
//            (the defender who got it flashes, a groan), "Safe" (quiet), "Line broken!" (a lift)
//   reveal   the camera eases onto the play (revealCamera: the ball, the labelled players, the lanes of your pass and the
//            best one and whoever is in their way; a small game's whole cast) and labels Best, your pick and up to two
//            others with a shape and a colour (★ Best, ✓ Good, ! Risky, ✗ Cut out), each label on the side of its player
//            where nobody stands; the lanes of your pass and the best pass, their blockers ringed; stars, a word and one
//            line (createPlayerReveal; a safe pass that was not the best names the better one: "Safe. Your striker's run
//            was on."); Next / Why? / Try again (after 0-1 stars: the same freeze at the same stage, not recorded, never a
//            celebration)
// Every star, label and sentence comes from the staged rating (hidden players are not drawn and not scored).
// Each first try updates Elo (score / 100 on the drill's pass principles), the history ({ mode: 'pass', choice, outcome,
// stars }) and the rewards (the rep, then a sticker for each principle whose mastery went up: rewards-store.js gives it
// only when the idea's recent plays average 2 stars). At the end of the set: the set's stars as a rewards session ("Perfect
// set"), road.recordSet (Road nodes), then showFullTime (js/ui/player/fulltime.js).
//
// Every module is a static import (the audit of 2026-10-01 removed the dynamic loadDeps and its degraded fallbacks:
// main.js lazy-loads this whole module per route, so the load moment is the same and a missing file now surfaces as
// main.js's Try-again card instead of a silently degraded screen); nothing touches document or window at import time.
// The pure helpers below (labels, outcomes, option order, the reveal's markers and words, the flight, the set) are
// tested in tests/player-pass.test.js.

import { el, button, icon, notice, linkButton, announce } from '../components.js';
import { timing } from '../../engine/timeline.js';
import { update as eloUpdate, mastery } from '../../engine/elo.js';
import { ROLE_INFO, LEARNABLE_ROLES, parsePlayerId, playerId } from '../../engine/roles.js';
import { dist, clamp, lerpPoint } from '../../engine/geometry.js';
import { LENGTH, WIDTH } from '../../engine/pitch.js';
import * as Rewards from '../../rewards.js';
import { award, loadRewards, refreshRewards, mergeGains, emptyGains } from '../rewards-store.js';
import * as S from '../session.js';
import * as SharedWords from './strings.js';
import { receiverOf, optionsByReceiver, genuinelyOn, passTargets as targetsFor, PASS_TARGET_DEFAULTS } from '../../engine/passtargets.js';
import { FIGURE } from '../figures.js';
// Who a sentence is about, by shirt number, as "Find your spot" says it ("your number 8": play.js nameSpecific).
import { nameSpecific, groupMembers, KID_GROUPS } from './play.js';
import * as passing from '../../engine/passing.js';
import * as passdrill from '../../engine/passdrill.js';
import * as castMod from '../../engine/cast.js';
import * as boardMod from '../board.js';
import * as roadMod from './road.js';
import { createPlayerReveal } from './reveal.js';
import { showFullTime } from './fulltime.js';

const { STRINGS: SHARED, starWord, roleCard } = SharedWords;

// The teammates a tap can pick, from one place (js/engine/passtargets.js; the staged game's gate, cast.js, counts the same).
export { receiverOf, optionsByReceiver, genuinelyOn };

/** The ball's id in board spotlight lists (ARCHITECTURE §5.8 board.js BALL_ID; not imported, so the board loads with the stage). */
const BALL_ID = 'ball';
/** A token's radius at life size, metres (board.js BOARD_DEFAULTS.tokenRadius; tested equal): a figure stands FIGURE.height of them tall. */
export const TOKEN_RADIUS = 1.8;

export const PASS_DEFAULTS = Object.freeze({
  reps: 5, // [S] KID_REDESIGN §3: a set is 5 reps
  watch: 2.5, // [S] §4.4: 2-3 s of build-up play before the freeze
  setCardMs: 1300, // [D] the "You've got the ball" card holds this long (a tap skips it)...
  roleChangedMs: 2300, // [D] ...longer when you play another position ("Now you're the left centre-back", as play.js)
  ballSpeed: 15, // [S] research/passing.md §4.3 ballSpeed, m/s: the pass travels at match speed...
  flightMin: 0.55, // [D] ...but takes at least this long (s), so a short pass can be followed...
  flightMax: 1.3, // [D] ...and at most this long
  holdMs: 1100, // [D] the outcome word holds this long before the reveal
  retryMaxStars: 1, // [S] §4.3 / §4.4: Try again only after 0-1 stars
  genTries: 3, // [D] seeds tried for each generated rep a set still lacks (each tries many scenes itself) before giving up on it
  lineWords: 14, // [S] §0 rule 3: the reveal line is at most 14 words
  focusPad: 3, // [D] metres kept in view beyond the play on a phone held upright (board.setFocus, the full match)
  farPass: PASS_TARGET_DEFAULTS.farPass, // [S] play-test: a teammate further than this (m) from the ball is no target, unless the pass is really on
  revealOthers: 2, // [S] play-test: the reveal labels Best, your pick and up to this many others (a crowded phone pitch)
  labelEm: 0.66, // [M] a label's width per character, in its font size (the ★/✓ shape, a space, the word): 0.59-0.69 in Chrome
  labelAscent: 1, // [M] a label's drawn box above its baseline, in its font size (0.93-0.98 in Chrome, with the ★ ✓ ✗ shapes)...
  labelDescent: 0.25, // [M] ...and below it (0.20-0.23)
  labelGap: 2.3, // [D] m: a token's drawn radius, when the board does not say (labelSide: a label clears it)
  labelAcross: 3, // [D] m: the reveal's camera keeps this much room either side of a labelled player (a label is wider than a figure)
  // labelSpot (figures): what a place for a label costs. Covering a player, the ball or YOUR tag (area, as a share of the
  // label; YOU twice), another label, the edge of the view; another player's figure within labelClear (type heights) of
  // it as close as its own ("stray"), another player's feet nearer it than its own ("feet"), in type heights. [M] tuned on
  // 655 labels of generated drills at every stage and phone scale: another player's base nearer than its own 3-10 % of
  // labels (the head-lift placement: 26-31 %), none on another label at the full match.
  labelCost: Object.freeze({
    cover: 10, labels: 50, outside: 6, stray: 3, feet: 2,
    // [D] a little per place, for ties: over the head, under the feet, running off to one side, then beside the figure
    sides: Object.freeze({ above: 0, below: 0.02, 'above-right': 0.04, 'above-left': 0.04, 'below-right': 0.06, 'below-left': 0.06, right: 0.08, left: 0.08 }),
  }),
  labelClear: 0.6, // [D] type heights: a player this close to a label, as close as its own, makes it anybody's
  interceptSize: 2.2, // [D] = css/pass.css .ps-intercept (tested): the ✗ where a lane is cut out, in type metres (x the board's label scale)
  revealFull: Object.freeze({ length: 50, width: 34 }), // [D] m: the full match's reveal shows at least this much pitch (along x
  //                                                       across), so the play keeps its context and 22 figures never crowd
  cameraMin: Object.freeze({ length: 24, width: 16 }), // [D] = board.js CAMERA_MIN (tested equal): the choice's camera frames at least this
  cardGapPx: 12, // [D] = play.js PLAY_DEFAULTS.cardGapPx: the card sits this far in from the top or bottom of the pitch...
  cardClearPx: 8, // [D] = play.js PLAY_DEFAULTS.cardClearPx: ...keeping this far off YOU, the ball and the teammates (cardSpot)...
  cardWeights: Object.freeze({ you: 4, ball: 4, target: 1, other: 0.4 }), // [D] ...what covering each costs, per CSS px²: YOU (with
  //   your tag) and the ball most, a teammate you can pass to, then every other player drawn (= play.js's `other`; 0.15
  //   once let a card sit over most of an opponent at rest); a place covering none of them wins outright
  cardSettleMs: 60, // [D] = play.js PLAY_DEFAULTS.cardSettleMs: the card waits this long after the camera has landed (and the
  //   board has its size) to be placed and shown: placed while the camera eased in, it was drawn over YOU mid-ease
  revealSettleMs: 120, // [D] the reveal's labels are placed again this long after the camera has landed and the figures the
  //   declutter moves have slid there (board.js declutterEaseMs), where the board draws everyone
});
const P0 = PASS_DEFAULTS;

/**
 * Every word this screen shows (tests/copy.test.js checks them: word budgets, reading age, no codes). Words other
 * Player screens say too (Watch again, Home, Next...) come from js/ui/player/strings.js, so they always match.
 */
export const STRINGS = Object.freeze({
  title: "Who's open?",
  loading: SHARED.loading,
  setCard: "You've got the ball",
  question: 'Pick the best pass.',
  pass: 'Pass',
  passTo: (n = 8) => `Pass to number ${n}`,
  number: (n = 8) => `Number ${n}`,
  teammate: (n = 8) => `Teammate, number ${n}`,
  watchAgain: SHARED.watchAgain,
  stop: SHARED.stop,
  repOf: (i = 1, n = 5) => `Pass ${i} of ${n}`,
  labels: Object.freeze({ best: 'Best', good: 'Good', risky: 'Risky', 'cut-out': 'Cut out' }),
  outcomes: Object.freeze({ 'cut-out': 'Cut out!', safe: 'Safe', 'line-broken': 'Line broken!', risky: 'Risky!', offside: 'Offside!' }),
  missNote: SHARED.missNote,
  lineGood: 'Good pass. It got to your teammate.',
  lineBad: 'Look for a teammate with nobody close.',
  // A safe pass that was not the best: "Safe." and the better pass, named (betterLine; who = "your striker").
  safe: 'Safe.',
  better: Object.freeze({
    run: (who = 'your teammate') => `${cap(who)}'s run was on.`,
    free: (who = 'your teammate') => `${cap(who)} was free, with nobody close.`,
    turn: (who = 'your teammate') => `${cap(who)} could turn and run at goal.`,
    front: (who = 'your teammate') => `${cap(who)} was past their front players.`,
    mid: (who = 'your teammate') => `${cap(who)} was past their midfielders.`,
    behind: (who = 'your teammate') => `${cap(who)} was in behind their defenders.`,
    far: (who = 'your teammate') => `${cap(who)} was free on the far side.`,
    box: (who = 'your teammate') => `${cap(who)} was free in front of their box.`,
    goal: (who = 'your teammate') => `${cap(who)} was free in front of goal.`,
    forward: (who = 'your teammate') => `${cap(who)} was open for a forward pass.`,
    other: (who = 'your teammate') => `${cap(who)} was the better pass.`,
  }),
  whyTitle: 'Pass it right',
  whySummary: 'Pass to a teammate with nobody close and a clear path.',
  emptyTitle: 'No passes ready',
  emptyText: 'Try again in a moment.',
  back: 'Back home',
  again: SHARED.playAgain,
  next: SHARED.next,
  why: SHARED.why,
  retry: SHARED.tryAgain,
  stars: (n = 0) => SHARED.stars(n),
});

/** 'your striker' → 'Your striker' (a template's name at the start of a sentence). */
function cap(s) {
  const t = String(s ?? '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

// ---------------------------------------------------------------- labels and outcomes (pure)

/**
 * How each engine label shows on the pitch: a shape AND a colour (never colour alone), a word, a colour family
 * (`tone`: good | warn | bad) and the lane style (solid, dashed or dotted: the pattern carries the meaning too).
 * `rank` orders the reveal list.
 */
export const LABELS = Object.freeze({
  best: Object.freeze({ shape: '★', tone: 'good', line: 'solid', rank: 0 }),
  good: Object.freeze({ shape: '✓', tone: 'good', line: 'solid', rank: 1 }),
  risky: Object.freeze({ shape: '!', tone: 'warn', line: 'dashed', rank: 2 }),
  'cut-out': Object.freeze({ shape: '✗', tone: 'bad', line: 'dotted', rank: 3 }),
});
/** The engine's critical labels (passing.js: 'offside', 'danger') SHOWN as the fourth word, Cut out: the kid reads
 *  four option words, never six (audit 2026-10-01). The engine label stays on the option: the outcome still blows the
 *  whistle and draws the line for an offside pass. Ranked after a plain cut-out. */
const DISPLAY_LABEL = Object.freeze({ offside: 'cut-out', danger: 'cut-out' });
const LABEL_RANK = Object.freeze({ offside: 4, danger: 5 });

/** Board marker tones for the colour families (board.js has fix|cue|good|bad|info; css/pass.css turns warn amber). */
export const BOARD_TONES = Object.freeze({ good: 'good', warn: 'cue', bad: 'bad', info: 'info' });

/**
 * { key, shape, word, text: '★ Best', tone, line, rank, boardTone, cls } for an engine label (anything unknown reads as
 * risky). `cls` is the marker class list css/pass.css styles (colour family and line pattern).
 */
export function labelStyle(label) {
  const shown = DISPLAY_LABEL[label] ?? label;
  const key = Object.hasOwn(LABELS, shown) ? shown : 'risky';
  const L = LABELS[key];
  const word = STRINGS.labels[key];
  const rank = LABEL_RANK[label] ?? L.rank;
  return { key, ...L, rank, word, text: `${L.shape} ${word}`, boardTone: BOARD_TONES[L.tone], cls: `ps-mk ps-mk--${L.tone} ps-line--${L.line}` };
}

/** The outcome of a pass as graded: gradePass's outcome, else read from the option's label. */
export function outcomeKey(option, graded) {
  const o = graded?.outcome;
  if (['completed', 'risky', 'cut-out', 'offside', 'danger'].includes(o)) return o;
  const l = option?.label;
  return l === 'cut-out' || l === 'offside' || l === 'danger' || l === 'risky' ? l : 'completed';
}

/**
 * What the kid sees and hears after the pass (§4.4 step 4): the kind, the big word, a shape and tone (never meaning
 * by sound alone), the sound, whether the ball is cut out on its way (and by whom) and whether a line was broken.
 *   cut out → "Cut out!" + groan (the blocker flashes) · offside → "Offside!" + the whistle · danger (across our
 *   goal) → "Cut out!" (the fourth word; the blocker flashes when it would be cut) · risky → "Risky!" · completed
 *   past a line → "Line broken!" + a lift · completed → "Safe" (quiet)
 */
export function passOutcome(option, graded) {
  const key = outcomeKey(option, graded);
  const blocker = option?.blocker?.id ? option.blocker : null;
  // We grade the decision, not a dice roll (research/passing.md §6.6): the ball is cut out when that is the likely end.
  const intercepted = !!blocker && (key === 'cut-out' || (key === 'danger' && Number.isFinite(option?.pSafe) && option.pSafe < 0.5));
  const out = (kind, shape, tone, sound) => ({ kind, text: STRINGS.outcomes[kind], shape, tone, sound, intercepted, blockerId: intercepted ? blocker.id : null });
  if (intercepted) return out('cut-out', '✗', 'bad', 'groan');
  if (key === 'cut-out') return out('cut-out', '✗', 'bad', 'groan');
  if (key === 'offside') return out('offside', '✗', 'bad', 'whistle');
  if (key === 'danger') return out('cut-out', '✗', 'bad', null); // across our goal: shown with the fourth word
  if (key === 'risky') return out('risky', '!', 'warn', null);
  if (option?.lineBroken) return out('line-broken', '✓', 'good', 'lift');
  return out('safe', '✓', 'good', null);
}

/** 0-3 stars for a graded pass: gradePass's own, else rewards.js starsForScore, else the §6.3 bands. */
export function starsOf(graded, R = Rewards) {
  if (Number.isInteger(graded?.stars) && graded.stars >= 0 && graded.stars <= 3) return graded.stars;
  const score = Number(graded?.score);
  if (!Number.isFinite(score)) return 0;
  if (typeof R?.starsForScore === 'function') return R.starsForScore(score);
  return score >= 90 ? 3 : score >= 75 ? 2 : score >= 55 ? 1 : 0; // [S] KID_REDESIGN §6.3
}

/** The one word for a star count (Spot on / Great / Close / Not yet): rewards.js wordForStars, else strings.js. */
export function wordFor(stars, R = Rewards) {
  if (typeof R?.wordForStars === 'function') {
    const w = R.wordForStars(stars);
    if (typeof w === 'string' && w) return w;
  }
  return starWord(stars);
}

// ---------------------------------------------------------------- options (pure)

/**
 * The teammates you may pass to (the targets, and the reveal's options): optionsByReceiver less anyone further than
 * farPass from the ball and the keeper, unless that pass is really on (genuinelyOn). A crowded phone pitch keeps only
 * the passes worth weighing. (js/engine/passtargets.js passTargets, with this screen's farPass.)
 * @param {Map<string, object>} byReceiver  optionsByReceiver's map
 * @returns {Map<string, object>}
 */
export function passTargets(byReceiver, frame, carrierId = frame?.carrierId ?? null, P = PASS_DEFAULTS) {
  return targetsFor(byReceiver, frame, carrierId, P);
}

/**
 * The options the reveal labels (a crowded phone pitch labels no more): the best, your pick, and up to revealOthers
 * others, nearest the ball first (the ones you most likely weighed), one of another colour family than those two
 * first (a good pass beside a trap, say).
 * @returns {Set<string>} receiver ids
 */
export function revealPicks(options, { frame, carrierId, choiceId = null, bestId = null } = {}, P = PASS_DEFAULTS) {
  const ball = ballOf(frame, carrierId);
  const list = [...(options instanceof Map ? options.entries() : [])];
  const out = new Set();
  for (const [rid, o] of list) if (o.id === bestId || o.id === choiceId || o.label === 'best') out.add(rid);
  const toneOf = (o) => labelStyle(o.label).tone;
  const tones = new Set(list.filter(([rid]) => out.has(rid)).map(([, o]) => toneOf(o)));
  const rest = list.filter(([rid]) => !out.has(rid)).map(([rid, o]) => ({ rid, o, d: ball && posOf(frame, rid) ? dist(ball, posOf(frame, rid)) : Infinity }))
    .sort((a, b) => a.d - b.d || (a.rid < b.rid ? -1 : 1));
  const picked = [];
  for (const r of rest) if (picked.length < P.revealOthers && !tones.has(toneOf(r.o)) && !picked.some((q) => toneOf(q.o) === toneOf(r.o))) picked.push(r);
  for (const r of rest) if (picked.length < P.revealOthers && !picked.includes(r)) picked.push(r);
  for (const r of picked) out.add(r.rid);
  return out;
}

/**
 * With discs (a board without figures; with figures the reveal uses labelSpot, which also weighs whose label it looks):
 * which side of its player a label goes (above or below, as the screen shows it), so it covers no other player: the
 * side whose box touches fewer players (and earlier labels), above on a tie. The label is text 1.6 m × k tall
 * (css/pass.css, board.js --board-label-k) and as wide as its characters, written where board.js drawLabel puts it
 * (its baseline lift + 0.8 m above the point, or liftBelow + 0.5 m + 1.1 k below it). A player is a circle of radius
 * `pad`, and with figures (`body`: the figure's height in metres) also the upright figure standing up the screen from
 * it, so a label never lands on another player's head; the labelled player's own figure is cleared by the lift.
 * @param {{ at: {x,y}, text: string, frame, orientation?: 'vertical'|'horizontal', k?: number, lift?: number,
 *   liftBelow?: number, pad?: number, body?: number, taken?: object[], skip?: string[] }} o  taken: boxes of labels
 *   placed before this one (avoided too); the chosen box is added to it. skip: players not to count (the one labelled)
 * @returns {'above'|'below'}
 */
export function labelSide({ at, text = '', frame, orientation = 'horizontal', k = 1, lift = 2.4, liftBelow = lift, pad = P0.labelGap, body = 0, taken = [], skip = [] } = {}, P = PASS_DEFAULTS) {
  const h = 1.6 * k, w = Math.max(1, [...String(text)].length) * P.labelEm * h;
  // How far from the point the text reaches, on each side (metres, away from the point): its descent to its cap height.
  const reach = { above: [lift + 0.8 - 0.25 * h, lift + 0.8 + 0.8 * h], below: [liftBelow + 0.5 + 1.1 * k - 0.8 * h, liftBelow + 0.5 + 1.1 * k + 0.25 * h] };
  // The box in world metres. The vertical board runs world x up the screen (view y = LENGTH - x) and world y across it;
  // the horizontal board draws world y down the screen.
  const box = (side) => {
    const [n, f] = reach[side];
    const s = side === 'above' ? 1 : -1;
    if (orientation === 'vertical') {
      const x0 = at.x + s * n, x1 = at.x + s * f;
      return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: at.y - w / 2, y1: at.y + w / 2 };
    }
    const y0 = at.y - s * n, y1 = at.y - s * f;
    return { x0: at.x - w / 2, x1: at.x + w / 2, y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
  };
  // A player's footprint: the disc, and a figure standing up the screen from it (vertical: +x; horizontal: -y).
  const up = Math.max(pad, Number(body) || 0);
  const footprint = (p) => (orientation === 'vertical'
    ? { x0: p.x - pad, x1: p.x + up, y0: p.y - pad, y1: p.y + pad }
    : { x0: p.x - pad, x1: p.x + pad, y0: p.y - up, y1: p.y + pad });
  const meets = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
  const hits = (b) => (frame?.players ?? []).filter((p) => !skip.includes(p.id) && meets(footprint(p), b)).length
    + taken.filter((t) => t.x0 < b.x1 && t.x1 > b.x0 && t.y0 < b.y1 && t.y1 > b.y0).length;
  const above = box('above'), below = box('below');
  const side = hits(below) < hits(above) ? 'below' : 'above';
  taken.push(side === 'above' ? above : below);
  return side;
}

/** World → the board's view (metres; board.js project): the vertical board runs world x up the screen. */
const toView = (p, orientation) => (orientation === 'vertical' ? { x: p.y, y: LENGTH - p.x } : { x: p.x, y: p.y });
const toWorld = (v, orientation) => (orientation === 'vertical' ? { x: LENGTH - v.y, y: v.x } : { x: v.x, y: v.y });
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/**
 * Where a reveal label goes round its player when the board draws figures, as the screen shows it: over the head,
 * under the base (either centred or running off to one side), or beside the figure (level with the shirt), whichever
 *   1. covers least of the other players (the base and the figure standing up the screen from it), the ball, YOU and
 *      YOUR tag (twice as much) and the labels placed before it (never one), and stays in view;
 *   2. is its own player's: no other player (base and figure) is about as close to it (within labelClear type heights
 *      of its own), so a kid can tell whose label it is (review: with tall figures a label lifted over the head, or
 *      moved a figure's height away by the board, sat nearer another player, most often an opponent, for a third of
 *      the labels);
 *   3. is nearer its own player's feet than anyone else's (where a player stands: the base, which the reveal rings);
 *   4. over the head, then under the feet, then running off to one side, then beside, on a tie (labelCost).
 * The label is written centred on the box chosen (the marker's `at`, with no lift: board.js drawLabel's 'above'), just
 * there: the board's own search off YOU and YOUR tag (clear: 'you') knows nothing of the other labels (review: it put a
 * "✓ Good" across a "✗ Cut out"), so the reveal asks for it only when a label cannot keep off YOU (onYou), and with no
 * lift its nudge stays beside the player instead of a figure's height away. `tagBox`: YOUR tag as drawn (view metres;
 * mount reads it off the board), else about where it goes over YOUR head.
 * Text box: `size` × k m type (css/pass.css: 1.6, Best and yours 1.85), labelAscent of it above the baseline and
 * labelDescent below, labelEm of it wide per character; board.js writes the baseline 0.8 m above the point it is given.
 * @param {{ at: {x,y}, text: string, size?: number, frame, orientation?, k?: number, body: number, pad: number,
 *   half?: number, gap?: number, ball?: {x,y}|null, ballR?: number, youId?: string|null, view?: {x,y,width,height}|null,
 *   taken?: object[], skip?: string[] }} o  body: the figure's height, pad: the drawn base's radius, half: the figure's
 *   half width (metres); ball, ballR: where the ball is drawn and how far round it to keep clear; view: the board's
 *   viewBox (view metres); taken: earlier labels' boxes (the chosen one is added); skip: the labelled player
 * @returns {{ side: string, at: {x,y}, box: {x0,x1,y0,y1}, stray: boolean, onYou: boolean }}  side: 'above' | 'below' |
 *   'right' | 'left' | 'above-right' | 'above-left' | 'below-right' | 'below-left' (over or under the figure, running off
 *   to that side); at: world metres; box: view metres; stray: another player is still about as close to it as its own
 *   (nowhere better); onYou: it still touches YOU or YOUR tag (nowhere better: the board may nudge it, clear: 'you')
 */
export function labelSpot({ at, text = '', size = 1.6, frame, orientation = 'horizontal', k = 1, body, pad, half = pad, gap = 0.45, ball = null, ballR = 0, youId = null, tagBox = null, view = null, taken = [], skip = [] } = {}, P = PASS_DEFAULTS) {
  const fs = size * k, asc = P.labelAscent * fs, h = (P.labelAscent + P.labelDescent) * fs, w = Math.max(1, [...String(text)].length) * P.labelEm * fs;
  // A player as board.js drawLabel weighs one (otherBoxes, youBoxes): its base, a little wider than drawn, and the
  // figure standing up the screen from it. The labelled player's own counts there too, so a label keeps `gap` off it.
  const t = pad / TOKEN_RADIUS, r = (TOKEN_RADIUS + 0.3) * t, ry = (TOKEN_RADIUS + 0.75) * t;
  const hw = Math.max(half, r), top = Math.max(body, r);
  const b = toView(at, orientation);
  const others = (frame?.players ?? []).filter((p) => !skip.includes(p.id)).map((p) => ({ id: p.id, v: toView(p, orientation) }));
  const fp = (v, rr = r) => ({ x0: v.x - Math.max(half, rr), x1: v.x + Math.max(half, rr), y0: v.y - Math.max(body, rr), y1: v.y + rr });
  const you = others.find((p) => p.id === youId) ?? null;
  // YOUR tag where the board drew it (tagBox, view metres), else about where it goes: over the head.
  const tag = tagBox && Number.isFinite(tagBox.x0) ? tagBox
    : you ? { x0: you.v.x - 1.4 * fs, x1: you.v.x + 1.4 * fs, y0: you.v.y - top - 1.5 * fs, y1: you.v.y - top } : null;
  const bv = ball ? toView(ball, orientation) : null;
  const ballBox = bv ? { x0: bv.x - ballR, x1: bv.x + ballR, y0: bv.y - ballR, y1: bv.y + ballR } : null;
  const vr = view && Number.isFinite(view.width) ? { x0: view.x, x1: view.x + view.width, y0: view.y, y1: view.y + view.height } : null;
  // How far a label box is from a player (0 when it covers them).
  const apart = (a, f) => Math.hypot(Math.max(0, f.x0 - a.x1, a.x0 - f.x1), Math.max(0, f.y0 - a.y1, a.y0 - f.y1));
  const inView = (x0) => (vr && vr.x1 - vr.x0 > w + 0.8 ? Math.min(vr.x1 - 0.4 - w, Math.max(vr.x0 + 0.4, x0)) : x0); // board.js keepInView
  const box = (x0, y0) => ({ x0, x1: x0 + w, y0, y1: y0 + h });
  const over = b.y - top - gap - h, under = b.y + r + gap, mid = b.y - 0.55 * top - h / 2; // beside: level with the shirt
  const spots = [
    ['above', box(inView(b.x - w / 2), over)], ['below', box(inView(b.x - w / 2), under)],
    ['right', box(b.x + hw + gap, mid)], ['left', box(b.x - hw - gap - w, mid)],
    // Over or under the figure, running off to one side (the shape end over the head or under the feet).
    ['above-right', box(inView(b.x - hw), over)], ['above-left', box(inView(b.x + hw - w), over)],
    ['below-right', box(inView(b.x - hw), under)], ['below-left', box(inView(b.x + hw - w), under)],
  ];
  const own = fp(b), area = w * h, C = P.labelCost;
  let best = null;
  for (const [side, bx] of spots) {
    let cover = 0, near = Infinity, nearBase = Infinity;
    for (const p of others) {
      const f = p === you ? fp(p.v, ry) : fp(p.v);
      cover += (p === you ? 2 : 1) * overlap(bx, f);
      near = Math.min(near, apart(bx, f));
      nearBase = Math.min(nearBase, apart(bx, { x0: p.v.x, x1: p.v.x, y0: p.v.y, y1: p.v.y }));
    }
    if (tag) cover += 2 * overlap(bx, tag);
    if (ballBox) cover += overlap(bx, ballBox);
    const labels = taken.reduce((a, q) => a + overlap(bx, q), 0);
    const outside = vr ? area - overlap(bx, vr) : 0;
    // Whose label is it? Another player as close to it as its own (within `clear` of it) makes it anybody's.
    // And whose feet is it nearer (where a player stands: the base, ringed)?
    const mine = apart(bx, own), clear = P.labelClear * fs;
    const stray = Math.max(0, mine + clear - near) / fs;
    const feet = Math.max(0, apart(bx, { x0: b.x, x1: b.x, y0: b.y, y1: b.y }) - nearBase) / fs;
    const score = (C.cover * cover + C.labels * labels + C.outside * outside) / area + C.stray * stray + C.feet * feet + C.sides[side];
    if (!best || score < best.score - 1e-9) best = { side, box: bx, score, stray: near < mine + clear };
  }
  taken.push(best.box);
  const anchor = { x: (best.box.x0 + best.box.x1) / 2, y: best.box.y0 + asc + 0.8 };
  const onYou = !!you && (overlap(best.box, fp(you.v, ry)) > 0 || (tag ? overlap(best.box, tag) > 0 : false));
  return { side: best.side, at: toWorld(anchor, orientation), box: best.box, stray: best.stray, onYou };
}

/**
 * The tap targets in a steady order (keyboard focus and the screen-reader list): from our goal forward, then across.
 * Ids with no position in the frame go last, by id.
 */
export function orderTargets(ids = [], frame = null) {
  const pos = new Map((frame?.players ?? []).map((p) => [p.id, p]));
  return [...ids].sort((a, b) => {
    const pa = pos.get(a), pb = pos.get(b);
    if (pa && pb) return pa.x - pb.x || pa.y - pb.y || (a < b ? -1 : a > b ? 1 : 0);
    if (pa || pb) return pa ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Options for the reveal list: ★ Best first, then Good, Risky, Cut out...; within a label the higher score first. */
export function rankOptions(options = []) {
  return [...options].sort((a, b) => labelStyle(a.label).rank - labelStyle(b.label).rank || (b.score ?? 0) - (a.score ?? 0));
}

/** A teammate's shirt number (KID_REDESIGN §5: GK 1, RB 2, LB 3, LCB 4, RCB 5, DM 6, RW 7, LCM 8, ST 9, RCM 10, LW 11). */
export function shirtOf(id) {
  if (typeof id !== 'string' || !id.includes('-')) return null;
  return ROLE_INFO[parsePlayerId(id).role]?.num ?? null;
}

/** The carrier (YOU) of a pass drill. */
export function carrierOf(drill, frame = null) {
  const c = drill?.carrierId ?? drill?.carrier;
  if (typeof c === 'string' && c) return c;
  if (c && typeof c.id === 'string') return c.id;
  if (drill?.learner?.role) return playerId('us', drill.learner.role);
  return frame?.carrierId ?? null;
}

/** The role of the carrier (Elo, rewards, the history). */
export const roleOfDrill = (drill) => drill?.learner?.role ?? (carrierOf(drill) ? parsePlayerId(carrierOf(drill)).role : null);

// ---------------------------------------------------------------- the pitch (pure)

const posOf = (frame, id) => {
  const p = frame?.players?.find((q) => q.id === id);
  return p ? { x: p.x, y: p.y } : null;
};

/** Where the ball starts: the frame's ball, else the carrier. */
const ballOf = (frame, carrierId) => (frame?.ball ? { x: frame.ball.x, y: frame.ball.y } : posOf(frame, carrierId));

/** Where a pass is aimed: the option's point (a space pass), else the receiver. */
export function aimOf(option, frame) {
  if (option?.point && Number.isFinite(option.point.x)) return { x: option.point.x, y: option.point.y };
  return posOf(frame, receiverOf(option));
}

/** A point `drawnAt` gives for `id`, or null (none given, or not a point). */
const drawnOf = (drawnAt, id) => {
  let p = null;
  try { p = typeof drawnAt === 'function' ? drawnAt(id) : null; } catch { p = null; }
  return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? { x: p.x, y: p.y } : null;
};

/**
 * The frame as the board draws it (pure): every player where `drawnAt` says (board.js drawnAt: the declutter draws a
 * figure up to 1 m off its spot so no head or number is hidden), else at its spot. The same frame without drawnAt.
 */
export function drawnFrame(frame, drawnAt = null) {
  if (typeof drawnAt !== 'function' || !frame?.players) return frame;
  return { ...frame, players: frame.players.map((p) => { const d = drawnOf(drawnAt, p.id); return d ? { ...p, x: d.x, y: d.y } : p; }) };
}

/** Where the ball is drawn (a carried ball at the carrier's feet: board.js carryBall), else where it is (ballOf). */
const drawnBall = (frame, carrierId, drawnAt = null) => drawnOf(drawnAt, BALL_ID) ?? ballOf(frame, carrierId);

/**
 * A point near the lane `from` (a → b) at the same place along the lane `to` (its ends as drawn): as far along it and
 * as far to its side (the ✗ where a pass is cut out stays on the lane the kid sees). The point itself when either lane
 * has no length.
 */
function alongLane(p, [a0, b0], [a1, b1]) {
  if (![p, a0, b0, a1, b1].every((q) => Number.isFinite(q?.x) && Number.isFinite(q?.y))) return p;
  if (a0.x === a1.x && a0.y === a1.y && b0.x === b1.x && b0.y === b1.y) return { x: p.x, y: p.y }; // (drawn where it is)
  const L0 = dist(a0, b0), L1 = dist(a1, b1);
  if (!(L0 > 1e-6) || !(L1 > 1e-6)) return p;
  const dx = (b0.x - a0.x) / L0, dy = (b0.y - a0.y) / L0;
  const u = ((p.x - a0.x) * dx + (p.y - a0.y) * dy) / L0; // how far along (0 at the ball, 1 at the aim)
  const side = dx * (p.y - a0.y) - dy * (p.x - a0.x); // how far to its left (metres)
  const ex = (b1.x - a1.x) / L1, ey = (b1.y - a1.y) / L1;
  return { x: a1.x + u * (b1.x - a1.x) - side * ey, y: a1.y + u * (b1.y - a1.y) + side * ex };
}

/** The x of one of the rating's lines ({ front, mid, back, secondLast }: numbers or { x }); 'offside': rating.offsideX. */
const lineX = (rating, key) => {
  const v = key === 'offside' && Number.isFinite(rating?.offsideX) ? rating.offsideX : rating?.lines?.[key === 'offside' ? 'secondLast' : key];
  return Number.isFinite(v) ? v : Number.isFinite(v?.x) ? v.x : null;
};

/**
 * The reveal on the pitch (§4.4 step 5), as board markers (board.js setMarkers; `cls` is for css/pass.css):
 *   - the options labelled with their shape and word (★ Best, ✓ Good, ! Risky, ✗ Cut out, ✗ Offside, ✗ Danger) in
 *     their colour: every teammate, or those `labels` names (revealPicks: Best, yours and two others). With figures
 *     (`body`) each goes over the head, under the base or beside the figure, wherever it covers least and is nearer
 *     its own player than anyone else (labelSpot; `at` is then the label's own point, written with no lift); with
 *     discs just above or below the player (lift 'token': it clears the token at any board size; labelSide: the side
 *     where it covers nobody);
 *   - the lanes of your pass and the best pass (solid good, dashed risky, dotted cut out), a space pass with the run;
 *   - the defender who blocks either lane ringed, with ✗ where the ball would be cut out;
 *   - the offside line after an offside pass, the line your pass broke after "Line broken!".
 * Everything is drawn where the board draws the players (`drawnAt`: board.js drawnAt, where its declutter moved a
 * figure, up to 1 m off its spot, and the carried ball at the carrier's feet), so a label, a lane's end and a run meet
 * the figure the kid sees; its spot (the engine's) is used for anyone the board does not say.
 * @param {{ rating, frame, carrierId, choiceId?, targets?: Map, labels?: Set<string>, orientation?, k?, lift?, pad?, body?,
 *   half?, ballK?, tagBox?, view?, drawnAt?: (id: string) => ({x,y}|null) }} opts  targets: the options on show
 *   (passTargets; default every teammate's); drawnAt: where the board draws a player or the ball ('ball'); the rest:
 *   the board's layout (mount's layout(): labelSide's with discs, labelSpot's with figures)
 */
export function revealMarkers({ rating, frame, carrierId, choiceId = null, targets = null, labels = null, orientation = 'horizontal', k = 1, lift, liftBelow, pad, body, half, ballK = 1, tagBox = null, view = null, drawnAt = null } = {}) {
  const markers = [];
  const byReceiver = targets instanceof Map ? targets : optionsByReceiver(rating?.options, carrierId);
  // The picture as drawn: each player where the board draws it (its spot if the board does not say), the ball too.
  const seen = drawnFrame(frame, drawnAt);
  const ball = drawnBall(frame, carrierId, drawnAt);
  const chosen = choiceId ? (rating?.options ?? []).find((o) => o.id === choiceId) ?? null : null;
  const best = rating?.best ?? rankOptions(rating?.options ?? [])[0] ?? null;
  const keyOptions = [chosen, best && best.id !== chosen?.id ? best : null].filter(Boolean);
  const bad = labelStyle('cut-out');

  // Lanes first (under the labels): from the ball as drawn to the receiver as drawn (a pass into space: to the space,
  // with the run from the receiver as drawn).
  const ball0 = ballOf(frame, carrierId);
  for (const o of keyOptions) {
    const L = labelStyle(o.label);
    const aim = o.kind === 'space' ? aimOf(o, frame) : posOf(seen, receiverOf(o)) ?? aimOf(o, frame);
    if (!ball || !aim) continue;
    markers.push({ type: 'segment', a: ball, b: aim, tone: L.boardTone, dashed: L.line !== 'solid', cls: `${L.cls} ps-lane`, style: L.line, lane: true, optionId: o.id });
    const from = posOf(seen, receiverOf(o));
    if (o.kind === 'space' && from && dist(from, aim) >= 1) markers.push({ type: 'arrow', from, to: aim, tone: L.boardTone, cls: `${L.cls} ps-run`, run: true, optionId: o.id });
    if (o.blocker?.id && o.label !== 'best' && o.label !== 'good') {
      markers.push({ type: 'ring', id: o.blocker.id, tone: bad.boardTone, pulse: false, cls: 'ps-mk ps-mk--bad ps-blocker', blocker: true });
      // Where it is cut out: the same place along the lane as drawn (the lane moved with the ball and the receiver).
      const cut = o.blocker.at && (o.label === 'cut-out' || o.label === 'danger') ? alongLane(o.blocker.at, [ball0, aimOf(o, frame)], [ball, aim]) : null;
      if (cut) markers.push({ type: 'label', at: { x: cut.x, y: cut.y }, text: '✗', tone: bad.boardTone, lift: -0.7, cls: 'ps-mk ps-mk--bad ps-intercept', intercept: true });
    }
  }
  // Lines: offside, or the line your pass broke.
  if (chosen?.label === 'offside') {
    const x = lineX(rating, 'offside');
    if (x !== null) markers.push({ type: 'line-x', x, tone: bad.boardTone, dashed: true, cls: 'ps-mk ps-mk--bad ps-xline', line: 'offside' });
  } else if (chosen?.lineBroken && (chosen.label === 'best' || chosen.label === 'good')) {
    const x = lineX(rating, chosen.lineBroken);
    if (x !== null) markers.push({ type: 'line-x', x, tone: 'good', dashed: true, cls: 'ps-mk ps-mk--good ps-xline', line: chosen.lineBroken });
  }
  // A label by each option on show (the best and yours first, so theirs get the clear side), off the other players.
  const taken = [];
  const shown = [...byReceiver].filter(([rid]) => !labels || labels.has(rid))
    .sort(([, a], [, b]) => Number(b.label === 'best' || b.id === choiceId) - Number(a.label === 'best' || a.id === choiceId));
  const num = (v) => (Number.isFinite(v) ? v : undefined);
  const figures = num(body) !== undefined && num(pad) !== undefined;
  // With figures, the ✗ where a lane is cut out is a label the others keep off (labelSpot's `taken`, as board.js writes
  // it: the baseline 0.8 m over its point less its lift; css/pass.css .ps-intercept type): a "✗ Cut out" once sat on it.
  if (figures) {
    for (const m of markers) {
      if (!m.intercept) continue;
      const v = toView(m.at, orientation), fs = P0.interceptSize * (num(k) ?? 1), w = P0.labelEm * fs, base = v.y - m.lift - 0.8;
      taken.push({ x0: v.x - w / 2, x1: v.x + w / 2, y0: base - P0.labelAscent * fs, y1: base + P0.labelDescent * fs });
    }
  }
  // Figures: the ball is drawn at YOUR feet on the side you face (board.js carriedBall), inside its halo at the top of
  // its pulse; keep a label clear of it (of either side of YOUR feet when the board does not say where it drew it).
  const carried = frame?.carrierId && frame.carrierId === carrierId && !drawnOf(drawnAt, BALL_ID);
  const t = figures ? pad / TOKEN_RADIUS : 1;
  const ballR = (1.16 * 1.55 * 0.8 + 0.25) * (num(ballK) ?? 1) + (carried ? 0.55 * TOKEN_RADIUS * t + 0.75 * 0.8 * (num(ballK) ?? 1) : 0);
  for (const [rid, o] of shown) {
    const at = posOf(seen, rid);
    if (!at) continue;
    const L = labelStyle(o.label);
    const cls = `${L.cls} ps-opt ps-opt--${L.key}${o.id === choiceId ? ' is-yours' : ''}`;
    const tag = { optionId: o.id, receiverId: rid, label: L.key };
    if (figures) {
      // The player's base ringed in the label's colour and line (solid, dashed, dotted: as the lanes), so a label is
      // tied to its player however crowded the picture (review: a third of the labels had another player nearer).
      markers.push({ type: 'ring', id: rid, r: TOKEN_RADIUS + 0.55, tone: L.boardTone, pulse: false, cls: `${L.cls} ps-owner`, owner: true, optionId: o.id });
      // Beside its own player, never nearer another if it can be helped (labelSpot); written centred there (no lift).
      const size = L.key === 'best' || o.id === choiceId ? 1.85 : 1.6; // css/pass.css .ps-opt--best, .is-yours
      const spot = labelSpot({ at, text: L.text, size, frame: seen, orientation, k, body, pad, half: num(half) ?? pad, ball, ballR, youId: carrierId, tagBox, view, taken, skip: [rid] });
      markers.push({ type: 'label', at: spot.at, text: L.text, tone: L.boardTone, lift: 0, ...(spot.onYou ? { clear: 'you' } : {}), side: spot.side, cls, ...tag });
      continue;
    }
    const side = labelSide({ at, text: L.text, frame: seen, orientation, k, taken, skip: [rid], ...(num(lift) !== undefined ? { lift } : {}), ...(num(liftBelow) !== undefined ? { liftBelow } : {}), ...(num(pad) !== undefined ? { pad } : {}) });
    // Discs: the label clears the token (board.js 'token'), above or below it.
    markers.push({ type: 'label', at, text: L.text, tone: L.boardTone, lift: 'token', clear: 'you', ...(side === 'below' ? { below: true } : {}), cls, ...tag });
  }
  return markers;
}

/** The world rect round some points ({ x0, x1, y0, y1 }, metres), or null for none. */
function rectOf(points) {
  const ps = points.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (!ps.length) return null;
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * The camera of a small or bigger game (board.setCamera fits it on both axes, so the figures are big; docs/
 * PROGRESSIVE_FIELD.md §1): every player of the cast through the build-up and at the freeze, the ball's path, and the
 * spaces the passes on show aim at. It frames the watch and the choice. The full match has none (null: a phone's
 * length crop, board.setFocus with repFocus, and the spotlight).
 * @param {object[]} frames  the build-up and the freeze, reduced to the cast (cast.js reduceFrame)
 * @param {object|null} rating  the staged rating
 * @param {{ stage?: 'small'|'medium'|'full', targets?: Map|Set|null }} [opts]  targets: the receivers a tap can pick
 * @returns {{ x0, x1, y0, y1 } | null}
 */
export function repCamera(frames = [], rating = null, { stage = 'full', targets = null } = {}) {
  if (stage !== 'small' && stage !== 'medium') return null;
  const pts = [];
  for (const f of frames) {
    if (f?.ball) pts.push(f.ball);
    for (const p of f?.players ?? []) pts.push(p);
  }
  for (const o of rating?.options ?? []) {
    if (targets && !targets.has(receiverOf(o))) continue;
    if (o.point && Number.isFinite(o.point.x)) pts.push(o.point);
  }
  return rectOf(pts);
}

/**
 * The reveal's camera (board.setCamera eases there; at once under reduced motion): the ball, the players labelled (the
 * best, your pick and the others on show, labelAcross metres either side for their labels), the spaces your pass and
 * the best one aim at and the defenders in their way; in a small or bigger game the whole cast too (every player on
 * the pitch is there for a reason); the full match at least revealFull of pitch round that. null: nothing to frame.
 * Each label keeps off YOU and your tag (labelSpot; board.js clear: 'you' for one with nowhere else to go).
 * @param {{ rating, frame, carrierId, labels?: Set<string>, choiceId?, stage?: string }} o
 * @returns {{ x0, x1, y0, y1 } | null}
 */
export function revealCamera({ rating, frame, carrierId, labels = null, choiceId = null, stage = 'full' } = {}, P = PASS_DEFAULTS) {
  const pts = [];
  const ball = ballOf(frame, carrierId);
  if (ball) pts.push(ball);
  if (stage === 'small' || stage === 'medium') for (const p of frame?.players ?? []) pts.push(p);
  const bestId = rating?.best?.id ?? null;
  for (const o of rating?.options ?? []) {
    const rid = receiverOf(o);
    if (!rid?.startsWith('us-')) continue;
    const key = o.id === choiceId || o.id === bestId || o.label === 'best';
    if (!key && !(labels && labels.has(rid))) continue;
    const r = posOf(frame, rid);
    if (r) pts.push({ x: r.x - P.labelAcross, y: r.y - P.labelAcross }, { x: r.x + P.labelAcross, y: r.y + P.labelAcross });
    if (!key) continue;
    const aim = aimOf(o, frame);
    if (aim) pts.push(aim);
    const b = o.blocker?.id ? posOf(frame, o.blocker.id) : null;
    if (b) pts.push(b);
    if (o.blocker?.at) pts.push(o.blocker.at);
  }
  if (pts.length < 2) return null;
  const r = rectOf(pts);
  if (stage === 'small' || stage === 'medium') return r;
  // The full match: at least revealFull of pitch round the play (grown about its middle).
  const grow = (a, b, min) => { const c = (a + b) / 2, h = Math.max(b - a, min) / 2; return [c - h, c + h]; };
  const [x0, x1] = grow(r.x0, r.x1, P.revealFull.length), [y0, y1] = grow(r.y0, r.y1, P.revealFull.width);
  return { x0, x1, y0, y1 };
}

const isPoint = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);

/**
 * The world rect round some points on the pitch (pure; as play.js cameraRect): a point off it (a ball out of play)
 * counts at the touchline; grown about its middle to at least `min` (metres along × across) and slid onto the pitch;
 * rounded outward to 0.01, so every point stays inside. null with no point.
 */
function pitchRect(points, min) {
  const ps = (points ?? []).filter(isPoint).map((p) => ({ x: clamp(p.x, 0, LENGTH), y: clamp(p.y, 0, WIDTH) }));
  if (!ps.length) return null;
  const axis = (vals, least, span) => {
    const a = Math.min(...vals), b = Math.max(...vals);
    const len = Math.min(span, Math.max(b - a, least));
    const lo = Math.max(0, Math.min(span - len, (a + b) / 2 - len / 2));
    return [Math.max(0, Math.floor(lo * 100 + 1e-9) / 100), Math.min(span, Math.ceil((lo + len) * 100 - 1e-9) / 100)];
  };
  const [x0, x1] = axis(ps.map((p) => p.x), min?.length ?? 0, LENGTH);
  const [y0, y1] = axis(ps.map((p) => p.y), min?.width ?? 0, WIDTH);
  return { x0, x1, y0, y1 };
}

/**
 * The camera once the whistle has gone, in a small or bigger game (pure; board.setCamera eases there; as play.js
 * answerCamera): the players at the freeze (the cast), the ball and the teammates a tap can pick, at least `min`
 * (board.js CAMERA_MIN), on the pitch. The build-up's camera (repCamera) takes in everywhere the play went and the
 * spaces the passes aim at, so on a phone held upright the decision was drawn little bigger than the whole pitch; the
 * choice needs its players big. A pass into space further on widens it as the ball goes (flightCamera), and the reveal
 * frames the lanes (revealCamera). A part of repCamera's points, so never bigger than it (unless that is under `min`).
 * null at the full match (the length crop and the spotlight, as before).
 * @param {object} freeze  the staged freeze frame (cast.js reduceFrame)
 * @param {{ stage?: string, targets?: Map|Set|string[]|null, min?: { length: number, width: number } }} [opts]
 * @returns {{ x0, x1, y0, y1 } | null}
 */
export function chooseCamera(freeze, { stage = 'full', targets = null, min = P0.cameraMin } = {}) {
  if (stage !== 'small' && stage !== 'medium') return null;
  const ids = targets instanceof Map ? [...targets.keys()] : targets ? [...targets] : [];
  const pts = [freeze?.ball, ...(freeze?.players ?? []), ...ids.map((id) => posOf(freeze, id))];
  return pitchRect(pts, min);
}

/**
 * The camera while the pass travels (pure): `cam` (the choice's), grown to take in where the ball goes and where the
 * players it moves go (a space pass's runner, the defender who cuts it out), so a pass into space beyond the view is
 * never lost off its edge. The same object when all of it is in view already; null for no camera (the full match).
 * @param {{ x0, x1, y0, y1 } | null} cam
 * @param {{ to: {x,y}, movers?: { to: {x,y} }[] }} flight  passFlight's
 */
export function flightCamera(cam, flight) {
  if (!cam) return null;
  const pts = [flight?.to, ...(flight?.movers ?? []).map((m) => m?.to)].filter(isPoint)
    .map((p) => ({ x: clamp(p.x, 0, LENGTH), y: clamp(p.y, 0, WIDTH) }));
  if (pts.every((p) => p.x >= cam.x0 && p.x <= cam.x1 && p.y >= cam.y0 && p.y <= cam.y1)) return cam;
  return rectOf([{ x: cam.x0, y: cam.y0 }, { x: cam.x1, y: cam.y1 }, ...pts]);
}

// cardSpot is play.js's (the 44-line twin here went with the 2026-10-01 audit; the card tunables match).
export { cardSpot } from './play.js';

/**
 * The dotted preview line from the ball to a teammate (§4.4 step 3): it points at the player, never at the engine's aim;
 * from the ball and to the player as the board draws them (`drawnAt`, as revealMarkers).
 */
export function previewMarkers({ frame, carrierId, receiverId, drawnAt = null }) {
  const a = drawnBall(frame, carrierId, drawnAt), b = drawnOf(drawnAt, receiverId) ?? posOf(frame, receiverId);
  if (!a || !b) return [];
  return [{ type: 'segment', a, b, tone: 'info', dashed: true, cls: 'ps-mk ps-preview', style: 'dotted', preview: true }];
}

/** The defender who cut the pass out, flashing (a pulse; a steady ring under reduced motion). */
export const flashMarkers = (blockerId) => (blockerId ? [{ type: 'ring', id: blockerId, tone: 'bad', pulse: true, cls: 'ps-mk ps-mk--bad ps-flash' }] : []);

/**
 * The pass on its way (§4.4 step 4): the ball from the carrier to the aim, or to the defender who cuts it out; a space
 * pass's runner meets it; an intercepting defender steps to it.
 * @returns {{ from, to, duration, receiverId, blockerId, movers: [{ id, from, to }] }}
 */
export function passFlight(frame, option, outcome, P = PASS_DEFAULTS) {
  const carrierId = frame?.carrierId ?? null;
  const from = ballOf(frame, carrierId) ?? { x: 0, y: 0 };
  const receiverId = receiverOf(option);
  const aim = aimOf(option, frame) ?? from;
  const movers = [];
  let to = aim;
  if (outcome?.intercepted && option?.blocker?.at) {
    to = { x: option.blocker.at.x, y: option.blocker.at.y };
    const b = posOf(frame, option.blocker.id);
    if (b) movers.push({ id: option.blocker.id, from: b, to });
  } else if (option?.kind === 'space') {
    const r = posOf(frame, receiverId);
    if (r) movers.push({ id: receiverId, from: r, to: aim });
  }
  const duration = clamp(dist(from, to) / P.ballSpeed, P.flightMin, P.flightMax);
  return { from, to, duration, receiverId, blockerId: outcome?.intercepted ? option.blocker.id : null, movers };
}

/** The frame `u` (0..1) of the way through a flight: the ball in the air (no carrier) until it arrives. */
export function flightFrame(frame, flight, u) {
  const k = clamp(u, 0, 1);
  const movers = new Map(flight.movers.map((m) => [m.id, m]));
  const arrived = k >= 1;
  return {
    ...frame,
    ball: lerpPoint(flight.from, flight.to, k),
    carrierId: arrived ? (flight.blockerId ?? flight.receiverId ?? null) : null,
    players: frame.players.map((p) => {
      const m = movers.get(p.id);
      return m ? { ...p, ...lerpPoint(m.from, m.to, k) } : p;
    }),
  };
}

/**
 * The pitch length a rep needs in view on a phone held upright (board.setFocus): the ball's play, YOU and every teammate
 * you can pass to, the keeper too (a target off the screen is no choice at all), and every space the engine aims at.
 */
export function repFocus(frames = [], rating = null, P = PASS_DEFAULTS) {
  const xs = [];
  for (const f of frames) {
    if (f?.ball) xs.push(f.ball.x);
    const c = f?.carrierId ? posOf(f, f.carrierId) : null;
    if (c) xs.push(c.x);
  }
  const last = frames.at(-1);
  for (const o of rating?.options ?? []) {
    const rid = receiverOf(o);
    if (!rid?.startsWith('us-')) continue;
    const r = posOf(last, rid);
    if (r) xs.push(r.x);
    if (o.point && Number.isFinite(o.point.x)) xs.push(o.point.x);
  }
  if (!xs.length) return null;
  return { x0: Math.min(...xs) - P.focusPad, x1: Math.max(...xs) + P.focusPad };
}

/**
 * A rep's scene as the screen plays it (pure; the engine's modules passed in): the build-up, the freeze, the rating the
 * choice is graded and explained on, the accepted answers and the teammates a tap can pick. Always as the engine
 * checked the drill (passdrill.js: nobody held back, so YOU run onto the ball and have it at the freeze). A small or
 * bigger game (a staged rep, cast.js bestStage) plays the same clip with only its cast (reduceFrame) and is judged on
 * the staged rating and answer; its targets are exactly the ones its gate counted (gates.targets). The full match (or
 * no staging) is the drill's own.
 * @param {object} drill
 * @param {object|null} staged  cast.js bestStage's result for the rep, or null
 * @param {{ formations, passdrill: { passDrillPlayback, passDrillFrame, passDrillRating }, reduceFrame?: Function }} deps
 * @returns {{ at: (t) => Frame, freeze, rating, carrierId, accept: string[], stage: string, cast: { ids?, ours, theirs },
 *   byReceiver: Map<string, object>, targets: string[] }}
 */
export function passScene(drill, staged, { formations, passdrill, reduceFrame } = {}) {
  const { freezeAt } = timing(drill);
  const small = !!staged && staged.stage !== 'full' && typeof reduceFrame === 'function' && Array.isArray(staged.cast?.ids);
  const ids = small ? staged.cast.ids : null;
  const playback = passdrill.passDrillPlayback(drill, { formations });
  const at = ids ? (t) => reduceFrame(playback.frameAt(t), ids) : (t) => playback.frameAt(t);
  const freeze = ids ? staged.frame : passdrill.passDrillFrame(drill, freezeAt, { formations });
  const own = drill.rating?.options?.length ? drill.rating : null;
  const rating = ids ? staged.rating : own ?? passdrill.passDrillRating(drill, { formations });
  const carrierId = carrierOf(drill, freeze);
  let byReceiver = passTargets(optionsByReceiver(rating?.options, carrierId), freeze, carrierId);
  const gate = ids ? staged.gates?.targets : null;
  if (Array.isArray(gate) && gate.length) byReceiver = new Map([...byReceiver].filter(([rid]) => gate.includes(rid)));
  return {
    at, freeze, rating, carrierId,
    accept: (ids ? staged.answer?.accept : null) ?? drill.answer?.accept ?? [],
    stage: ids ? staged.stage : 'full',
    cast: ids ? staged.cast : { ours: 11, theirs: 11 },
    byReceiver, targets: orderTargets([...byReceiver.keys()], freeze),
  };
}

// ---------------------------------------------------------------- words (pure)

const wordCount = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
const textOf = (v) => (typeof v === 'string' ? v : typeof v?.text === 'string' ? v.text : '');

/**
 * The reveal's one line (≤ 14 words, §0 rule 3) from explainPass in simple wording: about your pass (why it was the
 * best, or its main problem or strength), else the best pass's reason, else a plain fallback. Never the headline:
 * that is the consequence ("Cut out!"), already on the pitch. `say` names whom the fallback means ("It got to your
 * number 8": passSpeaker, bound to your pass's receiver); the explanation's own lines come named (nameExplain).
 */
export function pickLine(explain, { good = false, say = null } = {}, P = PASS_DEFAULTS) {
  for (const s of [textOf(explain?.line), textOf(explain?.yours), textOf(explain?.best)]) {
    if (s && wordCount(s) <= P.lineWords) return s;
  }
  if (!good) return STRINGS.lineBad;
  const named = typeof say === 'function' ? say(STRINGS.lineGood) : null;
  return named && wordCount(named) <= P.lineWords ? named : STRINGS.lineGood;
}

// ---------------------------------------------------------------- who the words mean (pure)

/** The kid words for a group ("their midfielders") in the plural, and "their players" / "their front players". */
const PLURAL_WORDS = new RegExp(`\\b(their|your)\\s+(front\\s+)?(${[...Object.keys(KID_GROUPS), 'player'].join('|')})s\\b(?![-\\w])`, 'gi');
/** A group in the singular ("your midfielder"; play.js nameSpecific names these). */
const GROUP_WORD = new RegExp(`\\b(their|your)\\s+(?:other\\s+)?(${Object.keys(KID_GROUPS).join('|')})\\b(?![-\\w])`, 'gi');

/**
 * The players a sentence about `option` means (play.js nameSpecific's refs), most certain first: the one its reason
 * names (`tag`'s instance: the defender in the way, the one close to the receiver, the one who gets to the space first:
 * whoId), then the receiver (who "your striker" is in "Your striker can run onto it.").
 * @param {object|null} option  a rated option
 * @param {string|null} [tag]  the reason the sentence says (explainPass's `tag`)
 * @returns {string[]}
 */
export function refsOf(option, tag = null) {
  const t = tag ? (option?.tags ?? []).find((x) => x?.tag === tag) : null;
  return [...new Set([t?.whoId, receiverOf(option)].filter((id) => typeof id === 'string' && id))];
}

/**
 * How the reveal says whom it means (pure; as "Find your spot" says it: play.js nameSpecific): a function (text, refs)
 * → the text with every group the picture shows more than once named by the shirt number of the one it means ("Your
 * midfielder was free" with two of your midfielders drawn: "Your number 8 was free"; refs: refsOf, the player each
 * line is about), a plural group shown only once said in the singular ("It goes past their midfielder."), or null when
 * it names a group nobody drawn is in, or cannot say which one it means (the caller says something else). Numbers are
 * the shirts as drawn (board.js shirtNumberOf: YOUR kit number swapped in).
 * @param {{ frame: object, carrierId?: string|null, youNumber?: number|null }} o  frame: the picture drawn (a small
 *   game's cast, or all 22)
 * @returns {(text: string, refs?: string[]) => string|null}
 */
export function passSpeaker({ frame, carrierId = frame?.carrierId ?? null, youNumber = null } = {}) {
  const players = frame?.players ?? [];
  const inGroup = (whose, word, front = false) => {
    const team = String(whose).toLowerCase() === 'their' ? 'them' : 'us';
    if (front) return [...groupMembers(players, team, 'winger', carrierId), ...groupMembers(players, team, 'striker', carrierId)];
    return groupMembers(players, team, String(word).toLowerCase() === 'player' ? 'teammate' : word, carrierId); // (teammate: anyone of that team)
  };
  return (text, refs = []) => {
    if (typeof text !== 'string' || !text) return null;
    let nobody = false;
    const one = text.replace(PLURAL_WORDS, (m, whose, front, word) => {
      const n = inGroup(whose, word, !!front).length;
      if (!n) nobody = true;
      return n === 1 ? m.slice(0, -1) : m; // "their midfielders" → "their midfielder"
    });
    for (const m of one.matchAll(GROUP_WORD)) if (!inGroup(m[1], m[2]).length) nobody = true;
    if (nobody) return null;
    const out = nameSpecific(one, { players, learnerId: carrierId, youNumber, refs });
    return out.ok ? out.text : null;
  };
}

/**
 * explainPass's words with the players they mean named (pure; `say`: passSpeaker's): your pass's lines (`line`, `yours`,
 * `more`) are about the option you picked, `best` about the best one, each named from the player its reason names, then
 * its receiver (refsOf). A line that cannot say whom it means is left empty (pickLine and whyFor pass over it).
 */
export function nameExplain(explain, { rating, option, say } = {}) {
  if (!explain || typeof say !== 'function') return explain;
  const bestOption = (rating?.options ?? []).find((o) => o.id === explain.best?.id) ?? rating?.best ?? null;
  const put = (e, o) => (e && typeof e.text === 'string' ? { ...e, text: say(e.text, refsOf(o, e.tag)) ?? '' } : e);
  const yours = put(explain.yours, option);
  const line = typeof explain.line !== 'string' ? explain.line
    : explain.line === explain.yours?.text ? yours.text : say(explain.line, refsOf(option)) ?? '';
  return { ...explain, line, yours, best: put(explain.best, bestOption), more: (explain.more ?? []).map((m) => put(m, option)) };
}

/** The best pass's main reason (explainPass best.tag) → how STRINGS.better names it. */
const BETTER = Object.freeze({
  'into-space': 'run', free: 'free', 'can-turn': 'turn', 'breaks-first-line': 'front', 'breaks-midfield-line': 'mid',
  'in-behind': 'behind', switch: 'far', 'zone-14': 'box', 'cut-back': 'goal', forward: 'forward',
});

/**
 * After a safe pass that was not the best (a good one, not within reach of the best): "Safe." and the better pass,
 * named in simple words from explainPass's `best` (its reason) and the rating (who it goes to): "Safe. Your striker's
 * run was on."; by shirt number when the picture shows more of that group (`say`: passSpeaker, "Safe. Your number 9's
 * run was on."). null otherwise, when it would pass the 14-word budget or cannot say whom it means.
 * @param {{ explain, rating, option, graded?, say? }} o
 */
export function betterLine({ explain, rating, option, graded = null, say = null } = {}, P = PASS_DEFAULTS) {
  const best = explain?.best;
  if (!best || option?.label !== 'good' || graded?.isBest) return null;
  const bo = (rating?.options ?? []).find((o) => o.id === best.id) ?? rating?.best ?? null;
  if (!bo || bo.id === option.id) return null;
  const who = (bo.tags ?? []).find((t) => typeof t?.kidTo === 'string' && t.kidTo)?.kidTo ?? 'your teammate';
  const said = `${STRINGS.safe} ${STRINGS.better[BETTER[best.tag] ?? 'other'](who)}`;
  const text = typeof say === 'function' ? say(said, refsOf(bo)) : said;
  return text && wordCount(text) <= P.lineWords ? text : null;
}

/**
 * The "Why?" sheet (§4.3 step 7; reveal.js keeps it to 60 words): the idea's name and one-line summary in simple
 * wording (the rep's lesson, drill.principles, when the explanation is about it: a "Find the Free Player" rep missed
 * through a blocked lane says "Pick a Clear Path"; else the best pass's idea after a miss, yours after the best), then
 *   a miss: the best pass's reason, then more about yours (explainPass `more`, problems first);
 *   the best (or a good pass): what else you got right (the strengths among `more`).
 * `option` (the rated option) tells a strength from a problem by its tags; the line on the card is never repeated.
 */
export function whyFor({ explain, principles = {}, drill = null, isBest = false, option = null, line = '' } = {}) {
  const yours = explain?.yours ?? null, best = explain?.best ?? null;
  const explained = [yours?.principleId, best?.principleId, ...(explain?.more ?? []).map((m) => m?.principleId)].filter(Boolean);
  const lesson = (drill?.principles ?? []).find((p) => explained.includes(p)) ?? null;
  const pid = lesson ?? (isBest ? yours?.principleId ?? best?.principleId : best?.principleId ?? yours?.principleId) ?? drill?.principles?.[0] ?? null;
  const byId = principles?.byId ?? principles ?? {};
  const kid = (p) => (typeof p?.summary === 'string' ? p.summary : p?.summary?.kid) || '';
  // The idea from the catalogue; else the drill's own lesson (the generator names it); else a plain one.
  const p = pid ? byId[pid] : null;
  const own = typeof drill?.titleKid === 'string' && drill.titleKid ? { kidName: drill.titleKid, summary: drill.takeaway?.kid ?? '' } : null;
  const idea = typeof p?.kidName === 'string' && p.kidName ? p : own;
  const title = idea?.kidName || STRINGS.whyTitle;
  const summary = idea ? kid(idea) : STRINGS.whySummary;
  const kinds = new Map((option?.tags ?? []).map((t) => [t.tag, t.kind]));
  const more = (explain?.more ?? []).filter((m) => textOf(m));
  const fresh = (list) => [...new Set(list.map(textOf).filter((t) => t && t !== line))];
  const good = isBest || option?.label === 'good';
  const reasons = isBest ? [] : fresh([best, ...more.filter((m) => kinds.get(m.tag) !== 'strength')]).slice(0, 2);
  const praise = good ? fresh(more.filter((m) => kinds.get(m.tag) === 'strength')).slice(0, isBest ? 2 : 1) : [];
  return { title, summary, reasons, praise, principleId: pid };
}

/**
 * The reveal's words (pure): the line (a safe pass that was not the best names the better one: betterLine; else
 * pickLine) and the Why? sheet (whyFor), every sentence saying whom it means in the picture drawn (`frame`: passSpeaker,
 * nameExplain: "your number 8" where two of your midfielders are drawn; "their midfielder" where only one is).
 * @param {{ explain, rating, option, graded?, frame, carrierId?, youNumber?, principles?, drill? }} o
 * @returns {{ line: string, why: ReturnType<typeof whyFor>, isBest: boolean }}
 */
export function revealWords({ explain, rating, option, graded = null, frame, carrierId = frame?.carrierId ?? null, youNumber = null, principles = {}, drill = null } = {}) {
  const say = passSpeaker({ frame, carrierId, youNumber });
  const named = nameExplain(explain, { rating, option, say });
  const isBest = !!graded?.isBest || option?.label === 'best';
  const line = betterLine({ explain: named, rating, option, graded, say })
    ?? pickLine(named, { good: isBest || option?.label === 'good', say: (text) => say(text, refsOf(option)) });
  const why = whyFor({ explain: named, principles, drill, isBest, option, line });
  return { line, why, isBest };
}

/** A rep's title for Full time ("Best move: ..."): the drill's simple title, else its first principle's name. */
export function repTitle(drill, principles = {}) {
  if (typeof drill?.titleKid === 'string' && drill.titleKid) return drill.titleKid;
  const p = principles?.[drill?.principles?.[0]];
  return (typeof p?.kidName === 'string' && p.kidName) || STRINGS.title;
}

/**
 * The question at the freeze (≤ 12 words): "Pick the best pass." (the task, not "who's open?": the best pass is not
 * always to the teammate with the most room); an authored drill's own simple question when it has one.
 */
export function questionOf(drill) {
  const q = drill?.questionKid;
  const authored = drill?.source?.kind !== 'generated';
  return authored && typeof q === 'string' && q.trim() && wordCount(q) <= 12 ? q : STRINGS.question;
}

/** The line while the play runs (≤ 12 words): the drill's simple brief ("The ball is coming to you. Look around."). */
export function briefOf(drill) {
  const b = drill?.briefKid;
  return typeof b === 'string' && b.trim() && wordCount(b) <= 12 ? b : '';
}

/** The history entry of a pass rep (ARCHITECTURE §5.12 plus research/passing.md §4.5: mode, choice, outcome; nodeId as play.js). */
export function historyEntry({ t, drill, role, option, graded, bestId = null, ms = null, nodeId = null, stars = null }) {
  return {
    t, mode: 'pass', id: drill?.id ?? null, title: drill?.title ?? drill?.titleKid ?? STRINGS.title,
    principles: [...(drill?.principles ?? [])], role, score: graded?.score ?? 0, grade: graded?.grade ?? null,
    choice: option?.id ?? null, outcome: outcomeKey(option, graded), best: bestId, ms, nodeId,
    ...(Number.isInteger(stars) && stars >= 0 && stars <= 3 ? { stars } : {}), // the stars it showed (rewards.js stickerReps)
  };
}

/**
 * The id Elo and the rewards keep a pass rep's record under (as play.js recordIdOf): an authored drill's own id; one
 * per lesson and position family for generated drills ('gen-PA5-FB'), since each generated drill is new and a record
 * per drill would only grow (and "beat your best" means that lesson in that position).
 */
export function passRecordId(drill) {
  if (drill?.source?.kind === 'generated' || /^pass-/.test(String(drill?.id ?? ''))) {
    const role = roleOfDrill(drill);
    return `gen-${drill?.principles?.[0] ?? 'PA'}-${ROLE_INFO[role]?.family ?? 'x'}`;
  }
  return String(drill?.id ?? '');
}

// ---------------------------------------------------------------- the set (pure, deps passed in)

/** A small stable hash of a string (seeds per Road node). */
export function hashString(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** The seed of the n-th play of a Road node (the same set for the same play; a new set each time). */
export const nodeSeed = (nodeId, plays = 0) => (hashString(nodeId) + 7919 * (Number(plays) || 0)) >>> 0;

/** The role each position group starts in (KID_REDESIGN §3; road.js DEFAULT_ROLE). */
const GROUP_ROLE = Object.freeze({ DEF: 'LB', MID: 'LCM', WING: 'LW', STRIKER: 'ST' });

/** Your position for passing, as the Road picks it (road.js): the profile's role, else its group's, else a midfielder. */
export function roleFor(profile) {
  if (LEARNABLE_ROLES.includes(profile?.role)) return profile.role;
  return GROUP_ROLE[profile?.group] ?? GROUP_ROLE.MID;
}

const yieldToPage = () => new Promise((r) => setTimeout(r, 0));

/**
 * `count` generated pass drills for `role` (distinct ids, none of `skip`), trying seeds seed, seed + 1, ...
 * (generatePassDrill returns null when a seed fails its quality gates). `principles` focuses them (a Road node);
 * none = mixed. `catalogue` (data/principles.json) gives the drills their names. Yields to the page between reps.
 * @returns {Promise<{ kind: 'pass', drill }[]>}
 */
export async function generateReps({
  generate, seed = 1, role, principles, formations, catalogue, count = PASS_DEFAULTS.reps, tries = PASS_DEFAULTS.genTries,
  skip = [], pause = yieldToPage, warn = console.warn,
} = {}) {
  const out = [], ids = new Set(skip);
  if (typeof generate !== 'function') return out;
  let s = seed >>> 0;
  for (let rep = 0; rep < count; rep++) {
    for (let k = 0; k < tries; k++, s = (s + 1) >>> 0) {
      let drill = null;
      try { drill = generate({ seed: s, role, principles: principles?.length ? [...principles] : [], formations, catalogue }); } catch (err) { warn?.('[fotbol] pass: drill generation failed', err); }
      if (drill && drill.id && !ids.has(drill.id)) { ids.add(drill.id); out.push({ kind: 'pass', drill }); s = (s + 1) >>> 0; break; }
    }
    await pause?.();
  }
  return out;
}

/**
 * The reps of a set.
 *   A Road node: road.buildSet's pass reps (given the app, road.js counts the set as begun); a spot node (repKind, asked
 *   first, so no set is built for it) or one that gives only spot reps → { redirect: '#/play/<id>' }.
 *   No node (the quick set): road.buildQuickPassSet, the free-player idea mixed with playing forward, built as a Road
 *   pass set is (a forward best in 3 of 5 against the "always pass back" trap, research/passing.md §6.4; no two reps
 *   that look the same); without it, the engine's generatePassSet.
 * Either way a set still short of `count` is topped up with generatePassDrill (on the node's principles).
 * Every rep carries the stage its slot wants (road.js tags its own; a rep without one, from the engine's set or a top-up,
 * takes its slot's in road.js stagePlan: the node's stars before the set, or the 1-star plan for the quick set).
 * @param {{ node?, road?, profile?, role, seed, formations, catalogue?, index?, rewards?, skills?, count?, app?, stars? }} ctx
 *   stars: the node's stars before the set
 * @param {{ buildSet?, buildQuickPassSet?, generatePassSet?, generatePassDrill?, repKind?, stagePlan?, warn? }} deps  warn: where failures are logged (console.warn)
 * @returns {Promise<{ reps: { kind: 'pass', drill, stage? }[], redirect?: string }>}
 */
export async function assembleSet(ctx, deps = {}) {
  const count = ctx.count ?? PASS_DEFAULTS.reps;
  const warn = deps.warn ?? console.warn;
  const toPlay = ctx.node ? `#/play/${encodeURIComponent(ctx.node.id)}` : null;
  if (ctx.node && typeof deps.repKind === 'function') {
    let kind = null;
    try { kind = deps.repKind(ctx.road, ctx.node); } catch { kind = null; }
    if (kind === 'spot') return { reps: [], redirect: toPlay };
  }
  let reps = [];
  if (ctx.node && typeof deps.buildSet === 'function') {
    let built = [];
    try {
      built = await deps.buildSet(ctx.node, {
        road: ctx.road, profile: ctx.profile, index: ctx.index ?? [], rewards: ctx.rewards, skills: ctx.skills, seed: ctx.seed, formations: ctx.formations,
        catalogue: ctx.catalogue, // data/principles.json: the generated drills' names and takeaways
        ...(ctx.app ? { app: ctx.app } : {}), // the set counts as begun (road.js startSet): a reload deals new reps
      });
    } catch (err) { warn('[fotbol] pass: buildSet failed', err); }
    built = Array.isArray(built) ? built : [];
    reps = built.filter((r) => r?.kind === 'pass' && r.drill);
    if (!reps.length && built.some((r) => r?.kind === 'spot')) return { reps: [], redirect: toPlay };
  } else if (!ctx.node && typeof deps.buildQuickPassSet === 'function') {
    try {
      const built = await deps.buildQuickPassSet({ road: ctx.road, profile: ctx.profile, seed: ctx.seed ?? 1, count, formations: ctx.formations, catalogue: ctx.catalogue });
      // (no app: the quick set is dealt from the clock, fresh every time, and is no Road node to count)
      reps = (Array.isArray(built) ? built : []).filter((r) => r?.kind === 'pass' && r.drill?.id);
    } catch (err) { warn('[fotbol] pass: buildQuickPassSet failed', err); }
  } else if (!ctx.node && typeof deps.generatePassSet === 'function') {
    try {
      const drills = deps.generatePassSet({ seed: ctx.seed ?? 1, count, role: ctx.role, formations: ctx.formations, catalogue: ctx.catalogue });
      reps = (Array.isArray(drills) ? drills : []).filter((d) => d?.id).map((drill) => ({ kind: 'pass', drill }));
    } catch (err) { warn('[fotbol] pass: generatePassSet failed', err); }
  }
  if (reps.length < count) {
    const more = await generateReps({
      generate: deps.generatePassDrill, seed: (ctx.seed ?? 1) + 101 * (reps.length + 1), role: ctx.role, formations: ctx.formations,
      catalogue: ctx.catalogue, principles: ctx.node?.principles, count: count - reps.length, skip: reps.map((r) => r.drill.id), warn,
    });
    reps = [...reps, ...more];
  }
  reps = reps.slice(0, count);
  let plan = null;
  try { plan = typeof deps.stagePlan === 'function' ? deps.stagePlan(ctx.node ? ctx.stars ?? 0 : QUICK_STARS, { count: reps.length }) : null; } catch { plan = null; }
  return { reps: reps.map((r, i) => (r.stage || !plan?.[i] ? r : { ...r, stage: plan[i] })) };
}

/** The quick set's stars for the stage plan (road.js QUICK_STARS: the 1-star plan, docs/PROGRESSIVE_FIELD.md §2). */
const QUICK_STARS = 1;

// ---------------------------------------------------------------- the app (browser only below)

/** The Road (data/road.json): the app's copy, else road.js's loader (the three-tier fallback went with the audit). */
const getRoad = async (app) => app?.data?.road ?? roadMod.loadRoad(app);

/** Mode contract (ARCHITECTURE §5.9). @returns {Promise<() => void>} unmount */
export async function mount(root, app, params = []) {
  const P = PASS_DEFAULTS;
  let alive = true;
  const cleanups = [];
  root.classList.add('ps-view');
  root.replaceChildren(el('div', { class: 'ps-loading', role: 'status' }, [el('p', { text: STRINGS.loading })]));

  const formations = app.data?.formations;
  const principles = app.data?.principles?.byId ?? {};
  const nodeId = params[0] ?? null;
  // The Road: a node's set, and the quick set's lessons (road.quickPass; without it, road.js falls back to the app it
  // was bound to, else any lesson).
  const roadData = await getRoad(app);
  let node = null;
  if (nodeId && roadData) {
    node = roadMod.nodeById(roadData, nodeId);
    if (!node) node = (roadData.chapters ?? []).flatMap((c) => c.nodes ?? []).find((n) => n.id === nodeId) ?? null;
  }
  const profile = roadMod.loadProfile(app);
  // A locked node (opened by its address) is not played or recorded, as in play.js.
  if (node && !roadMod.isUnlocked(roadData, profile, node.id)) node = null;
  // A bad or locked node id never dead-ends: it plays a quick set, and the address says so.
  if (nodeId && !node) { try { history.replaceState(null, '', '#/pass'); } catch { /* keep the address */ } }
  const role = roleFor(profile);
  // A spot node plays in #/play: go there before any set is built, replacing this address (Back skips it).
  const spotNode = !!node && roadMod.repKind(roadData, node) === 'spot';
  if (spotNode) { app.navigate(`#/play/${encodeURIComponent(node.id)}`, { replace: true }); return () => { alive = false; }; }
  // A node's n-th set (its start counter: road.js counts a set when it begins, so a reload deals new reps).
  const attempt = node ? roadMod.nodeAttempt(profile, node.id) : 0;
  const seed = node ? nodeSeed(node.id, attempt) : (Date.now() % 2147483647) >>> 0;
  // The node's stars before the set: its stage plan (docs/PROGRESSIVE_FIELD.md §2; road.js tags its reps with it).
  const nodeStarsBefore = node ? roadMod.nodeStars(profile, node.id) : 0;

  await new Promise((r) => setTimeout(r, 30)); // let "Getting the pitch ready" paint: generating a set takes a moment
  const { reps, redirect } = await assembleSet(
    {
      node, road: roadData, profile, role, seed, formations, catalogue: app.data?.principles, index: app.data?.scenarios?.index ?? [],
      rewards: loadRewards(app), skills: S.loadSkills(app.store), app, stars: nodeStarsBefore,
    },
    {
      buildSet: roadMod.buildSet, buildQuickPassSet: roadMod.buildQuickPassSet, repKind: roadMod.repKind, stagePlan: roadMod.stagePlan,
      generatePassSet: passdrill.generatePassSet, generatePassDrill: passdrill.generatePassDrill,
    },
  );
  if (!root.isConnected) return () => {};
  if (redirect) { app.navigate(redirect, { replace: true }); return () => { alive = false; }; }
  if (!reps.length) {
    root.replaceChildren(notice({ title: STRINGS.emptyTitle, text: STRINGS.emptyText, actions: [linkButton(STRINGS.back, '#/', { variant: 'primary', icon: 'arrow' })] }));
    return () => { alive = false; };
  }

  // ---- the stage
  const els = {};
  els.dots = el('ol', { class: 'ps-dots', 'aria-hidden': 'true' });
  els.where = el('span', { class: 'visually-hidden' });
  els.exit = el('a', { class: 'btn btn--ghost btn--icon ps-exit', href: '#/', 'aria-label': STRINGS.stop, title: STRINGS.stop }, [icon('close')]);
  els.board = el('div', { class: 'ps-board' });
  els.cardText = el('p', { class: 'ps-card-text' });
  els.card = el('div', { class: 'ps-card', hidden: true }, [els.cardText]);
  els.card.style.setProperty('--ps-card-gap', `${P.cardGapPx}px`); // (cardSpot's gap: css/pass.css places the card there)
  els.bannerShape = el('span', { class: 'ps-banner-shape', 'aria-hidden': 'true' });
  els.bannerText = el('span', { class: 'ps-banner-text' });
  els.banner = el('div', { class: 'ps-banner', hidden: true }, [els.bannerShape, els.bannerText]);
  els.line = el('p', { class: 'ps-line' });
  els.actions = el('div', { class: 'ps-actions' });
  els.reveal = el('div', { class: 'ps-reveal' });
  els.list = el('ul', { class: 'visually-hidden ps-sr-list' });
  els.stage = el('div', { class: 'ps-stage' }, [els.board, els.card, els.banner]);
  const view = el('div', { class: 'ps' }, [
    el('div', { class: 'ps-bar' }, [els.exit, els.dots, els.where]),
    els.stage,
    el('div', { class: 'ps-dock' }, [els.line, els.actions, els.reveal, els.list]),
  ]);
  root.replaceChildren(view);

  const kitNumber = loadRewards(app)?.kit?.number ?? null; // YOUR shirt shows your kit number (as in play.js)
  const youNumber = Number.isInteger(kitNumber) ? kitNumber : null;
  // Tabletop figures and the big ball (docs/PROGRESSIVE_FIELD.md §4; Coach mode keeps its discs).
  const board = app.createBoard(els.board, { orientation: 'auto', labels: 'number', youNumber, figures: true });
  /** A teammate's number as the board draws it (board.js shirtNumberOf: YOUR kit number swapped in), else §5's. */
  const numberOf = (id) => {
    const n = boardMod.shirtNumberOf(id, { learnerId: rep?.carrierId ?? null, youNumber });
    if (n !== null && n !== undefined) return n;
    return shirtOf(id);
  };
  const reveal = createPlayerReveal(els.reveal, { app });
  cleanups.push(() => { try { reveal.destroy?.(); } catch { /* gone */ } }, () => { try { board.destroy(); } catch { /* gone */ } });

  const set = {
    reps, results: [], gained: emptyGains(), xpBefore: loadRewards(app).xp ?? 0, skills: S.loadSkills(app.store), streak: S.loadStreak?.(app.store),
    index: 0, startedAt: performance.now(), missNoted: false,
  };
  let rep = null;
  let raf = 0, backstop = 0, timer = 0, cardTimer = 0;

  const stopAnim = () => {
    cancelAnimationFrame(raf); raf = 0;
    clearTimeout(backstop); backstop = 0;
    clearTimeout(timer); timer = 0;
    clearTimeout(cardTimer); cardTimer = 0;
  };
  /** Run onFrame(u) for u 0 → 1 over `seconds` on animation frames, then onDone. A timer backs it up: a hidden tab
   *  pauses animation frames, and a rep must never stall there. */
  function animate(seconds, onFrame, onDone) {
    stopAnim();
    const ms = Math.max(0, seconds * 1000);
    const t0 = performance.now();
    let done = false;
    const finish = () => {
      if (done || !alive) return;
      done = true;
      cancelAnimationFrame(raf); raf = 0;
      clearTimeout(backstop); backstop = 0;
      onFrame(1);
      onDone?.();
    };
    const step = (now) => {
      if (done || !alive) return;
      const u = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
      onFrame(u);
      if (u >= 1) finish(); else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    backstop = setTimeout(finish, ms + 400);
  }
  const later = (ms, fn) => { clearTimeout(timer); timer = setTimeout(() => { if (alive) fn(); }, ms); };

  const spotlight = (ids) => board.setSpotlight(ids);
  /** Reduced motion (the setting or the device's; as celebrate.js reducedMotion, which this module does not load). */
  const reduced = () => {
    if (app.settings?.reducedMotion || document.documentElement?.dataset?.reducedMotion === 'true') return true;
    try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  };
  const draw = (frame) => board.render(frame, { learnerId: rep.carrierId, labels: 'number' });
  const setMarkers = (m) => board.setMarkers(m);
  /** Where the board draws a player or the ball now (board.js drawnAt: a figure the declutter moved, a carried ball at
   *  the feet), or null: the reveal's labels and lanes and the preview line meet the figures as drawn. */
  const drawnAt = (id) => { try { return board.drawnAt?.(id) ?? null; } catch { return null; } };

  // The camera: board.setCamera, noting when an ease that starts now will land (as play.js moveCamera): the set card
  // waits for it, and the reveal's labels are placed again then (until it lands the board tells where it draws everyone
  // in the view it is leaving, and draws them on the way there).
  let camLands = 0;
  const cameraMs = () => Number(boardMod.BOARD_DEFAULTS.cameraMs) || 450;
  const moveCamera = (rect) => {
    const was = board.camera ?? null;
    const had = !!board.viewBox;
    try { board.setCamera?.(rect); } catch { return; }
    const same = rect && was ? ['x0', 'x1', 'y0', 'y1'].every((key) => Math.abs(rect[key] - was[key]) < 1e-9) : !rect && !was;
    if (!same && had && !reduced()) camLands = performance.now() + cameraMs();
  };
  const landsIn = () => Math.max(0, camLands - performance.now());

  function renderDots() {
    const i = Math.min(set.index, set.reps.length - 1);
    els.dots.replaceChildren(...set.reps.map((_, k) => {
      const r = set.results[k];
      return el('li', { class: ['ps-dot', r && 'is-done', k === i && !r && 'is-current'], dataset: r ? { stars: String(r.stars) } : {} });
    }));
    els.where.textContent = STRINGS.repOf(i + 1, set.reps.length);
  }
  const setActions = (...nodes) => els.actions.replaceChildren(...nodes.filter(Boolean));
  const setLine = (text) => { els.line.textContent = text ?? ''; els.line.hidden = !text; };
  function showCard(text, stage = '') {
    els.cardText.textContent = text;
    els.card.dataset.stage = stage || ''; // not shown: the staging checks in the mount tests read it
    els.card.hidden = false;
  }
  const hideCard = () => { els.card.hidden = true; };
  function showBanner(o) {
    els.banner.dataset.tone = o.tone;
    els.bannerShape.textContent = o.shape;
    els.bannerText.textContent = o.text;
    els.banner.hidden = false;
  }
  const hideBanner = () => { els.banner.hidden = true; };
  function dockMode(mode) { view.dataset.phase = mode; }

  const clearTargets = () => board.disableTargets();
  /** The teammates as big numbered tap targets (board.js): a first tap previews, a second tap confirms. */
  const enableTargets = (ids, { onTap, onPreview }) => board.enableTargets({ ids, onTap, onPreview, labelFor: (id) => STRINGS.teammate(numberOf(id) ?? '') });
  /** The board's layout for placing labels: its orientation and label scale; with discs (labelSide) the lift that
   *  clears a token and its radius; with figures (labelSpot) the drawn base's radius, the figure's height and half
   *  width, the ball's scale and the viewBox shown now. */
  const layout = () => {
    const k = Number.parseFloat(board.el?.style?.getPropertyValue?.('--board-label-k')) || 1;
    const t = Number(board.tokenScale) || 1;
    const orientation = board.el?.dataset?.orientation === 'vertical' ? 'vertical' : 'horizontal';
    const fk = Number(board.figureScale);
    if (!board.figures || !(fk > 0)) return { orientation, k, lift: 2.4 * t, pad: 1.8 * t };
    const body = FIGURE.height * TOKEN_RADIUS * fk; // how tall a figure stands, in metres (board.js: FIGURE.height x tokenRadius x figureScale)
    const half = FIGURE.halfWidth * TOKEN_RADIUS * fk; // its half width, arms out
    const vb = board.viewBox ?? null; // what the board shows now (view metres): a label stays inside it
    return { orientation, k, pad: TOKEN_RADIUS * t, body, half, ballK: Number(board.ballScale) || 1, view: vb, tagBox: drawnTag() };
  };
  /** YOUR tag as the board drew it, in its view metres (the labels' layer), or null (not drawn, or no layout yet). */
  const drawnTag = () => {
    try {
      const tag = board.el?.querySelector?.('.token.is-learner .token-you');
      const m = board.el?.querySelector?.('.board-marker-labels')?.getScreenCTM?.()?.inverse?.();
      const r = tag?.getBoundingClientRect?.();
      if (!m || !(r?.width > 0) || typeof DOMPoint !== 'function') return null;
      const a = new DOMPoint(r.left, r.top).matrixTransform(m), b = new DOMPoint(r.right, r.bottom).matrixTransform(m);
      return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
    } catch { return null; }
  };

  // ---- one rep
  /**
   * A rep at its stage (docs/PROGRESSIVE_FIELD.md): the stage its slot wants (rep.stage), else the next bigger one that
   * can teach it (cast.js bestStage; road.js staged it while building the set: stagedRep). null: the full game as the
   * drill has it (the engine's cast.js is missing, or staging failed).
   */
  function stageOf(r) {
    if (!r || r.staged !== undefined) return r?.staged ?? null;
    const wanted = r.stage ?? 'full';
    let st = null;
    try { st = roadMod?.stagedRep?.(r, wanted, { formations }) ?? null; } catch { st = null; }
    if (!st) {
      try { st = castMod.bestStage(r, wanted, { formations, principles: app.data?.principles }); } catch (err) { console.warn('[fotbol] pass: could not stage', r.drill?.id, err); }
    }
    r.staged = st ?? null;
    return r.staged;
  }

  function startRep(i) {
    stopAnim();
    clearTargets();
    reveal.clear?.();
    hideBanner();
    set.index = i;
    const { drill } = set.reps[i];
    const { freezeAt } = timing(drill);
    const from = Math.max(0, freezeAt - P.watch);
    // Played as the engine checked it, at the rep's stage (passScene: a small or bigger game shows and judges only its cast).
    let scene;
    try {
      scene = passScene(drill, stageOf(set.reps[i]), { formations, passdrill, reduceFrame: castMod.reduceFrame });
    } catch (err) {
      console.warn('[fotbol] pass: could not rate', drill?.id, err);
      return nextRep();
    }
    const { at, freeze, rating, byReceiver, targets } = scene;
    rep = { drill, carrierId: scene.carrierId, accept: scene.accept, focus: [...(drill.principles ?? [])], stage: scene.stage, cast: scene.cast };
    if (!targets.length) return nextRep();
    const sample = [];
    for (let t = from; t < freezeAt; t += 0.5) sample.push(at(t));
    sample.push(freeze);
    const onShow = { ...rating, options: (rating?.options ?? []).filter((o) => byReceiver.has(receiverOf(o))) };
    Object.assign(rep, {
      at, from, freezeAt, freeze, rating, byReceiver, targets, preview: null, tries: 0, first: null, decisionStart: 0,
      view: repFocus(sample, onShow), camera: repCamera(sample, onShow, { stage: rep.stage, targets: byReceiver }),
      // At the whistle a small or bigger game eases in on the freeze (chooseCamera: the players you choose among, big).
      chooseCam: chooseCamera(freeze, { stage: rep.stage, targets: byReceiver }),
    });
    renderDots();
    showSet();
  }

  /** The rep's view: a small or bigger game's camera (its cast, big: the build-up's, or `cam`, the choice's), else the
   *  full match's length crop on a phone. */
  function frameRep(cam = null) {
    try { board.setFocus?.(rep.view); } catch { /* optional */ } // (a camera wins over it; it also has the board measure its pitch again)
    moveCamera(rep.camera ? cam ?? rep.camera : null);
  }
  /** Who is lit while the play runs: the full match spotlights the ball, YOU and the teammates to pass to; a smaller
   *  game shows only players who matter already. */
  const lit = () => (rep.stage === 'full' ? [BALL_ID, rep.carrierId, ...rep.targets] : null);
  function nextRep() {
    if (set.index + 1 < set.reps.length) startRep(set.index + 1);
    else finish();
  }

  function showSet() {
    dockMode('set');
    setLine('');
    setActions();
    setMarkers([]);
    hideCard();
    // The rep's view, framed once the dock has its set height: the board measures the pitch it has now, so it knows
    // where it will draw everyone (the card's place). Not earlier: the reveal's taller dock was still there, and the
    // card went by a pitch that then grew.
    frameRep();
    rep.setFrame = rep.at(rep.from);
    draw(rep.setFrame);
    spotlight(lit());
    // A rep played as a teammate in your group (road.js: a full-back's "free side" is a centre-back's) says so.
    // (The stage line, "Small game: 3 v 2", went with the 2026-10-01 audit: the pitch shows how many players there are.)
    const card = roleCard(roleOfDrill(rep.drill), role);
    const text = card.changed ? card.text : STRINGS.setCard;
    const r0 = rep;
    // The card waits for the camera to land (easing in on a small game from the reveal before, or back out to the full
    // match's length crop) and the board to have its size, as play.js's role card: until then the board draws everyone
    // on the way there, and a card placed for where they land was drawn over YOU, YOUR tag or the ball mid-ease. Then it
    // shows for its usual time.
    const wait = landsIn() + P.cardSettleMs;
    cardTimer = setTimeout(() => {
      if (!alive || rep !== r0 || view.dataset.phase !== 'set') return;
      showCard(text, rep.stage);
      els.card.classList.toggle('is-changed', card.changed);
      placeCard();
    }, wait);
    announce(text);
    const go = () => { if (rep && view.dataset.phase === 'set') showWatch(); };
    els.card.onclick = go;
    later(wait + (card.changed ? P.roleChangedMs : P.setCardMs), go);
  }

  /**
   * The set card at the top or bottom of the pitch, off YOU (with YOUR tag), the ball and every other player drawn
   * (cardSpot, weighed: cardWeights; where the board draws them now the camera has landed: board.clientBox); the middle
   * only when all of them are clear there, else a band between them that is; none clear in the middle of the screen,
   * the same slid to the left or right edge; else where it covers least.
   */
  function placeCard() {
    let at = 'middle', side = 'center';
    try {
      const W = P.cardWeights;
      const box = (id, weight) => ({ box: board.clientBox?.(id) ?? null, weight });
      const others = (rep.setFrame ?? rep.freeze)?.players?.map((p) => p.id).filter((id) => id !== rep.carrierId && !rep.byReceiver.has(id)) ?? [];
      const avoid = [box(rep.carrierId, W.you), box(BALL_ID, W.ball), ...rep.targets.map((id) => box(id, W.target)), ...others.map((id) => box(id, W.other))];
      const st = els.stage.getBoundingClientRect();
      // Measured centred (css/pass.css: a card slid to an edge keeps that width, --ps-card-w, so it covers what was weighed).
      els.card.dataset.side = 'center';
      els.card.style.removeProperty('--ps-card-w');
      const w = els.card.offsetWidth || 0, cx = st.left + st.width / 2;
      const spot = cardSpot({ top: st.top, bottom: st.bottom }, els.card.offsetHeight, avoid, w ? { left: cx - w / 2, right: cx + w / 2, room: { left: st.left, right: st.right } } : {});
      at = spot.at;
      side = spot.side ?? 'center';
      els.card.style.setProperty('--ps-card-top', `${Math.round(spot.top)}px`); // (a 'free' card's place)
      if (side !== 'center') {
        // Its width as laid out, to the fraction (offsetWidth rounds, and a pixel either way can move a line break).
        const used = typeof getComputedStyle === 'function' ? Number.parseFloat(getComputedStyle(els.card).width) : NaN;
        els.card.style.setProperty('--ps-card-w', `${Number.isFinite(used) && used > 0 ? used : w + 1}px`);
      }
    } catch { at = 'middle'; side = 'center'; }
    els.card.dataset.at = at;
    els.card.dataset.side = side;
  }

  function showWatch() {
    dockMode('watch');
    hideCard();
    clearTargets();
    setMarkers([]);
    hideBanner();
    setLine(briefOf(rep.drill)); // the one line while the play runs (R7): "The ball is coming to you. Look around."
    setActions();
    frameRep(); // the build-up's camera (back from the choice's after "Watch again")
    spotlight(lit());
    const span = rep.freezeAt - rep.from;
    animate(span, (u) => draw(rep.at(rep.from + span * u)), () => {
      app.sound?.play('whistle'); // the referee's whistle: play freezes here
      showChoose();
    });
  }

  function showChoose() {
    dockMode('choose');
    stopAnim();
    hideCard();
    hideBanner();
    reveal.clear?.();
    els.list.replaceChildren();
    spotlight(null); // the whole picture for the decision: who is open depends on where they are
    rep.preview = null;
    if (!rep.decisionStart) rep.decisionStart = performance.now();
    const question = questionOf(rep.drill);
    setLine(question);
    els.passBtn = button(STRINGS.pass, { variant: 'primary', icon: 'arrow', className: 'ps-pass', disabled: true, onClick: () => { if (rep?.preview) play(rep.preview); } });
    setActions(button(STRINGS.watchAgain, { icon: 'play', className: 'ps-again', onClick: () => showWatch() }), els.passBtn);
    // A small or bigger game eases in on the freeze (chooseCamera; back there from the reveal's on Try again), framed
    // for the pitch the dock leaves now; the full match keeps its length crop.
    frameRep(rep.chooseCam);
    draw(rep.freeze);
    setMarkers([]);
    enableTargets(rep.targets, { onPreview, onTap: (id) => play(id) });
    announce(question);
    // Focus lost with the old buttons (Try again, Watch again): the first target, so a keyboard carries on from there.
    if (!view.contains(document.activeElement)) els.board.querySelector('.board-target')?.focus({ preventScroll: true });
  }

  function onPreview(id) {
    if (view.dataset.phase !== 'choose') return;
    rep.preview = id && rep.byReceiver.has(id) ? id : null;
    setMarkers(rep.preview ? previewMarkers({ frame: rep.freeze, carrierId: rep.carrierId, receiverId: rep.preview, drawnAt }) : []);
    if (!els.passBtn) return;
    els.passBtn.disabled = !rep.preview;
    if (rep.preview) els.passBtn.setAttribute('aria-label', STRINGS.passTo(numberOf(rep.preview) ?? '')); else els.passBtn.removeAttribute('aria-label');
  }

  function play(receiverId) {
    if (view.dataset.phase !== 'choose' || !rep) return;
    const option = rep.byReceiver.get(receiverId);
    if (!option) return;
    clearTargets();
    dockMode('result');
    setActions();
    setLine('');
    const ms = Math.round(performance.now() - rep.decisionStart);
    let graded;
    try { graded = passing.gradePass(rep.rating, option.id, { accept: rep.accept }); } catch (err) { console.warn('[fotbol] pass: could not grade', err); }
    graded ??= { score: option.score ?? 0 };
    const outcome = passOutcome(option, graded);
    let explain = null;
    try { explain = passing.explainPass(rep.rating, option.id, { wording: 'kid', accept: rep.accept, focus: rep.focus }) ?? null; } catch (err) { console.warn('[fotbol] pass: could not explain', err); }
    const stars = starsOf(graded);
    const attempt = { option, graded, outcome, explain, stars, ms };
    rep.tries += 1;
    if (!rep.first) { rep.first = attempt; record(attempt); }
    rep.last = attempt;
    // The ball travels.
    const flight = passFlight(rep.freeze, option, outcome);
    setMarkers([]);
    // A pass into space beyond the choice's view: the camera widens as the ball goes (flightCamera; the same rect, no move, otherwise).
    if (rep.chooseCam) frameRep(flightCamera(rep.chooseCam, flight));
    animate(flight.duration, (u) => draw(flightFrame(rep.freeze, flight, u)), () => {
      showBanner(outcome);
      announce(outcome.text);
      if (outcome.sound) app.sound?.play(outcome.sound);
      setMarkers(flashMarkers(outcome.blockerId));
      later(P.holdMs, () => showReveal());
    });
  }

  function showReveal() {
    dockMode('reveal');
    stopAnim();
    hideBanner();
    const a = rep.last;
    draw(rep.freeze); // back to the moment of the decision: the best, your pick and two others, labelled
    rep.picks = revealPicks(rep.byReceiver, { frame: rep.freeze, carrierId: rep.carrierId, choiceId: a.option.id, bestId: rep.rating?.best?.id ?? null });
    // A safe pass that was not the best names the better one ("Safe. Your striker's run was on."); a group the picture
    // shows more than once is named by shirt number ("your number 8"), one shown once in the singular (revealWords).
    const { line, why } = revealWords({
      explain: a.explain, rating: rep.rating, option: a.option, graded: a.graded, frame: rep.freeze, carrierId: rep.carrierId, youNumber, principles, drill: rep.drill,
    });
    // After a first miss in the set, once: high standards plus belief (R20).
    const note = a === rep.first && a.stars === 0 && !set.missNoted ? STRINGS.missNote : '';
    if (note) set.missNoted = true;
    // The pitch's labels, for a screen reader.
    els.list.replaceChildren(...rankOptions([...rep.byReceiver.values()]).filter((o) => rep.picks.has(receiverOf(o))).map((o) => el('li', { text: `${STRINGS.number(numberOf(receiverOf(o)) ?? '')}: ${labelStyle(o.label).word}` })));
    const last = set.index + 1 >= set.reps.length;
    reveal.show({
      stars: a.stars, word: wordFor(a.stars), line,
      why: { title: why.title, summary: why.summary, reasons: why.reasons, praise: why.praise }, note,
      onNext: () => (last ? finish() : nextRep()),
      onRetry: a.stars <= P.retryMaxStars ? () => retry() : undefined,
      celebrate: a === rep.first, // the set's one big celebration: a first try only, never practice
    });
    drawReveal(); // after the card: the dock has its height, so the camera fits the stage that is left
    refreshRewards(app); // the header catches up now (the award held it back until the reveal)
    // Stage the next rep while this one is read (road.js has usually done it already: then this is free).
    const nx = set.reps[set.index + 1];
    if (nx && nx.staged === undefined) setTimeout(() => { if (alive) stageOf(nx); }, 60);
  }

  function drawReveal() {
    if (!rep?.last) return;
    const choiceId = rep.last.option.id;
    rep.picks ??= revealPicks(rep.byReceiver, { frame: rep.freeze, carrierId: rep.carrierId, choiceId, bestId: rep.rating?.best?.id ?? null });
    // The camera eases onto the play the reveal talks about (revealCamera; at once under reduced motion), then the labels
    // go where they cover nobody: placed now, and again once the camera has landed (its scale decides the label sizes)
    // and the figures the declutter moves have slid to where they are drawn: labels and lanes meet the figures as drawn
    // (drawnAt).
    const area = { rating: rep.rating, frame: rep.freeze, carrierId: rep.carrierId, labels: rep.picks, choiceId, stage: rep.stage };
    const cam = revealCamera(area);
    if (cam) moveCamera(cam);
    const place = () => setMarkers(revealMarkers({ ...area, targets: rep.byReceiver, ...layout(), drawnAt }));
    place();
    const r0 = rep;
    const slide = Number(boardMod.BOARD_DEFAULTS.declutterEaseMs) || 250; // (a figure moved clear of another slides there)
    later(Math.max(landsIn(), slide) + P.revealSettleMs, () => { if (rep === r0 && view.dataset.phase === 'reveal') place(); });
  }

  /** Try again: the same freeze, the same choices; practice only (the first try is what counts). */
  function retry() {
    reveal.clear?.();
    showChoose();
  }

  // ---- records (first tries only): Elo, the streaks and the history as a drill rep (drill.js lockIn), then the rewards
  function record(a) {
    const drill = rep.drill;
    const role = roleOfDrill(drill);
    const score = Number.isFinite(a.graded?.score) ? a.graded.score : 0;
    const grade = a.graded?.grade ?? null;
    try {
      set.skills = eloUpdate(set.skills, { principles: drill.principles ?? [], role, score01: score / 100 });
      S.saveSkills(app.store, set.skills);
      if (typeof S.updateStreak === 'function' && set.streak) {
        set.streak = S.updateStreak(set.streak, { day: S.dayKey(new Date()), score });
        S.saveStreak?.(app.store, set.streak);
      }
      S.appendHistory(app.store, historyEntry({ t: Date.now(), drill, role, option: a.option, graded: a.graded, bestId: rep.rating?.best?.id ?? null, ms: a.ms, nodeId: node?.id ?? null, stars: a.stars }));
    } catch (err) { console.warn('[fotbol] pass: could not save the rep', err); }
    // The stars the reveal shows are the stars the rewards count (rewards.js repStars).
    let gained = award(app, { type: 'rep', scenarioId: passRecordId(drill), role, grade, score, stars: a.stars }, { celebrate: false });
    for (const id of drill.principles ?? []) {
      const stars = mastery(set.skills, id);
      const tier = typeof Rewards.cardTier === 'function' ? Rewards.cardTier(loadRewards(app), id) : 0;
      if (stars > tier) gained = mergeGains(gained, award(app, { type: 'mastery', principleId: id, stars }, { celebrate: false }));
    }
    set.gained = mergeGains(set.gained, gained);
    set.results[set.index] = { stars: a.stars, title: repTitle(drill, principles), score, id: drill.id };
  }

  // ---- full time
  let ftCleanup = null;
  async function finish() {
    stopAnim();
    clearTargets();
    const results = set.results.filter(Boolean);
    const repStars = results.map((r) => r.stars);
    // The set's first tries as a rewards session: a star on every play is "Perfect set" (a skill, never for finishing).
    if (repStars.length) set.gained = mergeGains(set.gained, award(app, { type: 'session', stars: repStars }, { celebrate: false }));
    let nodeStars = null;
    if (node && typeof roadMod?.recordSet === 'function') {
      try { nodeStars = roadMod.recordSet(app, node.id, repStars); } catch (err) { console.warn('[fotbol] pass: could not record the set', err); }
    }
    const again = node ? `#/pass/${encodeURIComponent(node.id)}` : '#/pass';
    const opts = {
      node, reps: results.map((r) => ({ stars: r.stars, title: r.title })), xpBefore: set.xpBefore, xpAfter: loadRewards(app).xp ?? 0,
      gained: set.gained, nodeStars, onHome: () => app.navigate('#/'), onAgain: () => app.navigate(again),
      budget: reveal.budget, playedMs: performance.now() - set.startedAt, // the set's one big celebration; play time today (R22)
    };
    teardownStage();
    ftCleanup = showFullTime(root, app, opts);
  }

  let stageUp = true;
  function teardownStage() {
    if (!stageUp) return;
    stageUp = false;
    stopAnim();
    for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* gone */ } }
    root.replaceChildren();
  }

  // ---- keys: Enter plays the previewed pass (unless a control has focus), Escape clears it
  const onKey = (e) => {
    if (view.dataset.phase !== 'choose' || e.defaultPrevented) return;
    if (e.key === 'Escape' && rep?.preview) { board.previewTarget?.(null); onPreview(null); return; }
    if (e.key !== 'Enter' || !rep?.preview) return;
    if (e.target?.closest?.('button, a, input, select, textarea, [role="button"], [contenteditable]')) return;
    e.preventDefault();
    play(rep.preview);
  };
  document.addEventListener('keydown', onKey);
  const offKeys = () => document.removeEventListener('keydown', onKey);

  startRep(0);

  return () => {
    alive = false;
    offKeys();
    stopAnim();
    try { ftCleanup?.(); } catch { /* gone */ }
    teardownStage();
  };
}


// ---------------------------------------------------------------- fallbacks (when the play area's screens are missing)


