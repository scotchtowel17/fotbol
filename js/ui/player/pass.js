// '#/pass' and '#/pass/<nodeId>': "Who's open?", the Player-mode passing set (docs/KID_REDESIGN.md §4.4).
//
//   #/pass            a quick set: PASS_DEFAULTS.reps generated pass drills for your position, mixed lessons (road.js buildQuickPassSet)
//   #/pass/<nodeId>   a Road pass node (road.js buildSet); a spot node sends you to #/play/<nodeId>
//
// One rep (about 15 s):
//   set      "You've got the ball" over the pitch; YOU is the carrier (spotlight: the ball, YOU, the teammates to pass to)
//   watch    2-3 s of build-up (passdrill.js passDrillPlayback: nobody held back, so YOU run onto the ball), then the
//            whistle and the freeze (passDrillFrame, the frame the engine rated)
//   choose   the teammates are big numbered targets: a first tap previews a dotted pass line, a second tap (or Pass) plays it
//   result   the ball travels: "Cut out!" (the defender who got it flashes, a groan), "Safe" (quiet), "Line broken!" (a lift)
//   reveal   every option labelled on the pitch with a shape and a colour (★ Best, ✓ Good, ! Risky, ✗ Cut out), the lanes
//            of your pass and the best pass, their blockers ringed; stars, a word and one line (createPlayerReveal);
//            Next / Why? / Try again (after 0-1 stars: the same freeze again, not recorded)
// Each first try updates Elo (score / 100 on the drill's pass principles), the history ({ mode: 'pass', choice, outcome })
// and the rewards (the rep, then a sticker for each principle whose mastery went up). At the end of the set: road.recordSet
// (Road nodes), then showFullTime (js/ui/player/fulltime.js).
//
// The other areas' modules with behaviour (engine passing.js / passdrill.js, road.js, reveal.js, fulltime.js) load when the
// screen opens, so this module imports in Node whatever state they are in (tests/copy.test.js reads STRINGS; only the
// shared words of ./strings.js are imported up front), and nothing touches document or window at import time. The pure
// helpers below (labels, outcomes, option order, the reveal's markers, the flight, the set) are tested in
// tests/player-pass.test.js.

import { el, button, icon, notice, linkButton, announce } from '../components.js';
import { timing } from '../../engine/timeline.js';
import { update as eloUpdate, mastery } from '../../engine/elo.js';
import { ROLE_INFO, LEARNABLE_ROLES, parsePlayerId, playerId } from '../../engine/roles.js';
import { dist, clamp, lerpPoint } from '../../engine/geometry.js';
import * as Rewards from '../../rewards.js';
import { award, loadRewards, refreshRewards, mergeGains, emptyGains } from '../rewards-store.js';
import * as S from '../session.js';
import { STRINGS as SHARED, starWord, roleCard } from './strings.js';

/** The ball's id in board spotlight lists (ARCHITECTURE §5.8 board.js BALL_ID; not imported, so the board loads with the stage). */
const BALL_ID = 'ball';

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
  focusPad: 3, // [D] metres kept in view beyond the play on a phone held upright (board.setFocus)
});

/**
 * Every word this screen shows (tests/copy.test.js checks them: word budgets, reading age, no codes). Words other
 * Player screens say too (Watch again, Home, Next...) come from js/ui/player/strings.js, so they always match.
 */
export const STRINGS = Object.freeze({
  title: "Who's open?",
  loading: SHARED.loading,
  setCard: "You've got the ball",
  question: "Who's open? Tap the best pass.",
  pass: 'Pass',
  passTo: (n = 8) => `Pass to number ${n}`,
  number: (n = 8) => `Number ${n}`,
  teammate: (n = 8) => `Teammate, number ${n}`,
  watchAgain: SHARED.watchAgain,
  stop: SHARED.stop,
  repOf: (i = 1, n = 5) => `Pass ${i} of ${n}`,
  labels: Object.freeze({ best: 'Best', good: 'Good', risky: 'Risky', 'cut-out': 'Cut out', offside: 'Offside', danger: 'Danger' }),
  outcomes: Object.freeze({ 'cut-out': 'Cut out!', safe: 'Safe', 'line-broken': 'Line broken!', risky: 'Risky!', offside: 'Offside!', danger: 'Danger!' }),
  missNote: SHARED.missNote,
  lineGood: 'Good pass. It got to your teammate.',
  lineBad: 'Look for a teammate with nobody close.',
  whyTitle: 'Pass it right',
  whySummary: 'Pass to a teammate with nobody close and a clear path.',
  emptyTitle: 'No passes ready',
  emptyText: 'Try again in a moment.',
  soonTitle: 'Passing is coming soon',
  soonText: 'Go back home and play there for now.',
  back: 'Back home',
  again: SHARED.playAgain,
  next: SHARED.next,
  why: SHARED.why,
  retry: SHARED.tryAgain,
  stars: (n = 0) => SHARED.stars(n),
  doneTitle: SHARED.fullTime,
  doneStars: (n = 0, max = 15) => `${n} of ${max} stars`,
});

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
  offside: Object.freeze({ shape: '✗', tone: 'bad', line: 'dotted', rank: 4 }),
  danger: Object.freeze({ shape: '✗', tone: 'bad', line: 'dotted', rank: 5 }),
});

/** Board marker tones for the colour families (board.js has fix|cue|good|bad|info; css/pass.css turns warn amber). */
export const BOARD_TONES = Object.freeze({ good: 'good', warn: 'cue', bad: 'bad', info: 'info' });

/**
 * { key, shape, word, text: '★ Best', tone, line, rank, boardTone, cls } for an engine label (anything unknown reads as
 * risky). `cls` is the marker class list css/pass.css styles (colour family and line pattern).
 */
export function labelStyle(label) {
  const key = Object.hasOwn(LABELS, label) ? label : 'risky';
  const L = LABELS[key];
  const word = STRINGS.labels[key];
  return { key, ...L, word, text: `${L.shape} ${word}`, boardTone: BOARD_TONES[L.tone], cls: `ps-mk ps-mk--${L.tone} ps-line--${L.line}` };
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
 *   cut out → "Cut out!" + groan (the blocker flashes) · offside → "Offside!" + the whistle · danger (across our goal)
 *   → "Danger!" (or "Cut out!" when it would be) · risky → "Risky!" · completed past a line → "Line broken!" + a lift ·
 *   completed → "Safe" (quiet)
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
  if (key === 'danger') return out('danger', '✗', 'bad', null);
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

/** The teammate an option passes to: 'us-LW' for both 'us-LW' (to feet) and 'us-LW@space' (into space ahead). */
export function receiverOf(option) {
  if (!option) return null;
  if (typeof option.targetId === 'string' && option.targetId) return option.targetId;
  const id = String(option.id ?? '');
  const at = id.indexOf('@');
  return (at >= 0 ? id.slice(0, at) : id) || null;
}

const better = (a, b) => {
  const sa = Number.isFinite(a?.score) ? a.score : -Infinity, sb = Number.isFinite(b?.score) ? b.score : -Infinity;
  if (sa !== sb) return sa > sb;
  return a?.kind === 'feet' && b?.kind !== 'feet'; // a tie: to feet (what the tap looks like)
};

/**
 * One option per teammate: a tap on a teammate plays the better of the pass to their feet and the pass into space ahead
 * of them (the kid picks the player; the engine plays the pass the way that works best). The carrier is never an option.
 * @returns {Map<string, object>} receiver id → option
 */
export function optionsByReceiver(options = [], carrierId = null) {
  const map = new Map();
  for (const o of options ?? []) {
    const r = receiverOf(o);
    if (!r || r === carrierId || !r.startsWith('us-')) continue;
    const had = map.get(r);
    if (!had || better(o, had)) map.set(r, o);
  }
  return map;
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

/** The x of one of the rating's lines ({ front, mid, back, secondLast }: numbers or { x }); 'offside': rating.offsideX. */
const lineX = (rating, key) => {
  const v = key === 'offside' && Number.isFinite(rating?.offsideX) ? rating.offsideX : rating?.lines?.[key === 'offside' ? 'secondLast' : key];
  return Number.isFinite(v) ? v : Number.isFinite(v?.x) ? v.x : null;
};

/**
 * The reveal on the pitch (§4.4 step 5), as board markers (board.js setMarkers; `cls` is for css/pass.css):
 *   - every teammate option labelled just above the player with its shape and word (★ Best, ✓ Good, ! Risky,
 *     ✗ Cut out, ✗ Offside, ✗ Danger) in its colour (lift 'token': it clears the token at any board size);
 *   - the lanes of your pass and the best pass (solid good, dashed risky, dotted cut out), a space pass with the run;
 *   - the defender who blocks either lane ringed, with ✗ where the ball would be cut out;
 *   - the offside line after an offside pass, the line your pass broke after "Line broken!".
 * @param {{ rating, frame, carrierId, choiceId? }} opts
 */
export function revealMarkers({ rating, frame, carrierId, choiceId = null } = {}) {
  const markers = [];
  const byReceiver = optionsByReceiver(rating?.options, carrierId);
  const ball = ballOf(frame, carrierId);
  const chosen = choiceId ? (rating?.options ?? []).find((o) => o.id === choiceId) ?? null : null;
  const best = rating?.best ?? rankOptions(rating?.options ?? [])[0] ?? null;
  const keyOptions = [chosen, best && best.id !== chosen?.id ? best : null].filter(Boolean);
  const bad = labelStyle('cut-out');

  // Lanes first (under the labels).
  for (const o of keyOptions) {
    const L = labelStyle(o.label);
    const aim = aimOf(o, frame);
    if (!ball || !aim) continue;
    markers.push({ type: 'segment', a: ball, b: aim, tone: L.boardTone, dashed: L.line !== 'solid', cls: `${L.cls} ps-lane`, style: L.line, lane: true, optionId: o.id });
    const from = posOf(frame, receiverOf(o));
    if (o.kind === 'space' && from && dist(from, aim) >= 1) markers.push({ type: 'arrow', from, to: aim, tone: L.boardTone, cls: `${L.cls} ps-run`, run: true, optionId: o.id });
    if (o.blocker?.id && o.label !== 'best' && o.label !== 'good') {
      markers.push({ type: 'ring', id: o.blocker.id, tone: bad.boardTone, pulse: false, cls: 'ps-mk ps-mk--bad ps-blocker', blocker: true });
      const cut = o.blocker.at && (o.label === 'cut-out' || o.label === 'danger') ? o.blocker.at : null;
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
  // A label over every teammate option.
  for (const [rid, o] of byReceiver) {
    const at = posOf(frame, rid);
    if (!at) continue;
    const L = labelStyle(o.label);
    markers.push({ type: 'label', at, text: L.text, tone: L.boardTone, lift: 'token', cls: `${L.cls} ps-opt ps-opt--${L.key}${o.id === choiceId ? ' is-yours' : ''}`, optionId: o.id, receiverId: rid, label: L.key });
  }
  return markers;
}

/** The dotted preview line from the ball to a teammate (§4.4 step 3): it points at the player, never at the engine's aim. */
export function previewMarkers({ frame, carrierId, receiverId }) {
  const a = ballOf(frame, carrierId), b = posOf(frame, receiverId);
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

// ---------------------------------------------------------------- words (pure)

const wordCount = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
const textOf = (v) => (typeof v === 'string' ? v : typeof v?.text === 'string' ? v.text : '');

/**
 * The reveal's one line (≤ 14 words, §0 rule 3) from explainPass in simple wording: about your pass (why it was the
 * best, or its main problem or strength), else the best pass's reason, else a plain fallback. Never the headline:
 * that is the consequence ("Cut out!"), already on the pitch.
 */
export function pickLine(explain, { good = false } = {}, P = PASS_DEFAULTS) {
  for (const s of [textOf(explain?.line), textOf(explain?.yours), textOf(explain?.best)]) {
    if (s && wordCount(s) <= P.lineWords) return s;
  }
  return good ? STRINGS.lineGood : STRINGS.lineBad;
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

/** A rep's title for Full time ("Best move: ..."): the drill's simple title, else its first principle's name. */
export function repTitle(drill, principles = {}) {
  if (typeof drill?.titleKid === 'string' && drill.titleKid) return drill.titleKid;
  const p = principles?.[drill?.principles?.[0]];
  return (typeof p?.kidName === 'string' && p.kidName) || STRINGS.title;
}

/**
 * The question at the freeze (≤ 12 words): "Who's open? Tap the best pass." (it says how to answer, too); an authored
 * drill's own simple question when it has one.
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
export function historyEntry({ t, drill, role, option, graded, bestId = null, ms = null, nodeId = null }) {
  return {
    t, mode: 'pass', id: drill?.id ?? null, title: drill?.title ?? drill?.titleKid ?? STRINGS.title,
    principles: [...(drill?.principles ?? [])], role, score: graded?.score ?? 0, grade: graded?.grade ?? null,
    choice: option?.id ?? null, outcome: outcomeKey(option, graded), best: bestId, ms, nodeId,
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
 *   A Road node: road.buildSet's pass reps; a node that gives only spot reps → { redirect: '#/play/<id>' }.
 *   No node (the quick set): road.buildQuickPassSet, mixed lessons built as a Road pass set is (a forward best in 3 of
 *   5 against the "always pass back" trap, research/passing.md §6.4; no two reps that look the same); without it, the
 *   engine's generatePassSet.
 * Either way a set still short of `count` is topped up with generatePassDrill (on the node's principles).
 * @param {{ node?, road?, profile?, role, seed, formations, catalogue?, index?, rewards?, skills?, count? }} ctx
 * @param {{ buildSet?, buildQuickPassSet?, generatePassSet?, generatePassDrill?, warn? }} deps  warn: where failures are logged (console.warn)
 * @returns {Promise<{ reps: { kind: 'pass', drill }[], redirect?: string }>}
 */
export async function assembleSet(ctx, deps = {}) {
  const count = ctx.count ?? PASS_DEFAULTS.reps;
  const warn = deps.warn ?? console.warn;
  let reps = [];
  if (ctx.node && typeof deps.buildSet === 'function') {
    let built = [];
    try {
      built = await deps.buildSet(ctx.node, {
        road: ctx.road, profile: ctx.profile, index: ctx.index ?? [], rewards: ctx.rewards, skills: ctx.skills, seed: ctx.seed, formations: ctx.formations,
        catalogue: ctx.catalogue, // data/principles.json: the generated drills' names and takeaways
      });
    } catch (err) { warn('[fotbol] pass: buildSet failed', err); }
    built = Array.isArray(built) ? built : [];
    reps = built.filter((r) => r?.kind === 'pass' && r.drill);
    if (!reps.length && built.some((r) => r?.kind === 'spot')) return { reps: [], redirect: `#/play/${encodeURIComponent(ctx.node.id)}` };
  } else if (!ctx.node && typeof deps.buildQuickPassSet === 'function') {
    try {
      const built = await deps.buildQuickPassSet({ road: ctx.road, profile: ctx.profile, seed: ctx.seed ?? 1, count, formations: ctx.formations, catalogue: ctx.catalogue });
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
  return { reps: reps.slice(0, count) };
}

// ---------------------------------------------------------------- the app (browser only below)

const tryImport = async (url) => {
  try { return await import(url); } catch (err) { console.warn(`[fotbol] pass: ${url} is not available`, err); return null; }
};

/** The other areas' modules (engine, shell, play), loaded when the screen opens. */
async function loadDeps() {
  const [passing, passdrill, road, reveal, fulltime] = await Promise.all([
    tryImport('../../engine/passing.js'), tryImport('../../engine/passdrill.js'), tryImport('./road.js'), tryImport('./reveal.js'), tryImport('./fulltime.js'),
  ]);
  return { passing, passdrill, road, reveal, fulltime };
}

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

/** Mode contract (ARCHITECTURE §5.9). @returns {Promise<() => void>} unmount */
export async function mount(root, app, params = []) {
  const P = PASS_DEFAULTS;
  let alive = true;
  const cleanups = [];
  root.classList.add('ps-view');
  root.replaceChildren(el('div', { class: 'ps-loading', role: 'status' }, [el('p', { text: STRINGS.loading })]));

  const deps = await loadDeps();
  if (!root.isConnected) return () => {}; // a newer route took over while this one loaded
  const passing = deps.passing, passdrill = deps.passdrill;
  if (typeof passing?.gradePass !== 'function' || typeof passing?.explainPass !== 'function' || typeof passdrill?.generatePassDrill !== 'function'
    || typeof passdrill?.passDrillFrame !== 'function' || typeof passdrill?.passDrillPlayback !== 'function') {
    root.replaceChildren(notice({ title: STRINGS.soonTitle, text: STRINGS.soonText, actions: [linkButton(STRINGS.back, '#/', { variant: 'primary', icon: 'arrow' })] }));
    return () => { alive = false; };
  }

  const formations = app.data?.formations;
  const principles = app.data?.principles?.byId ?? {};
  const nodeId = params[0] ?? null;
  const roadMod = deps.road;
  const roadData = nodeId ? await getRoad(app, roadMod) : null;
  let node = null;
  if (nodeId && roadData) {
    try { node = roadMod?.nodeById?.(roadData, nodeId) ?? null; } catch { node = null; }
    if (!node) node = (roadData.chapters ?? []).flatMap((c) => c.nodes ?? []).find((n) => n.id === nodeId) ?? null;
  }
  let profile = null;
  try { profile = roadMod?.loadProfile?.(app) ?? null; } catch { profile = null; }
  // A locked node (opened by its address) is not played or recorded, as in play.js.
  if (node) {
    try { if (typeof roadMod?.isUnlocked === 'function' && !roadMod.isUnlocked(roadData, profile, node.id)) node = null; } catch { /* keep it */ }
  }
  // A bad or locked node id never dead-ends: it plays a quick set, and the address says so.
  if (nodeId && !node) { try { history.replaceState(null, '', '#/pass'); } catch { /* keep the address */ } }
  const role = roleFor(profile);
  const plays = node ? profile?.road?.[node.id]?.plays ?? 0 : 0;
  const seed = node ? nodeSeed(node.id, plays) : (Date.now() % 2147483647) >>> 0;

  await new Promise((r) => setTimeout(r, 30)); // let "Getting the pitch ready" paint: generating a set takes a moment
  const { reps, redirect } = await assembleSet(
    {
      node, road: roadData, profile, role, seed, formations, catalogue: app.data?.principles, index: app.data?.scenarios?.index ?? [],
      rewards: loadRewards(app), skills: S.loadSkills(app.store),
    },
    { buildSet: roadMod?.buildSet, buildQuickPassSet: roadMod?.buildQuickPassSet, generatePassSet: passdrill.generatePassSet, generatePassDrill: passdrill.generatePassDrill },
  );
  if (!root.isConnected) return () => {};
  if (redirect) { app.navigate(redirect); return () => { alive = false; }; }
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
  const board = app.createBoard(els.board, { orientation: 'auto', labels: 'number', youNumber: Number.isInteger(kitNumber) ? kitNumber : null });
  const reveal = typeof deps.reveal?.createPlayerReveal === 'function' ? deps.reveal.createPlayerReveal(els.reveal, { app }) : fallbackReveal(els.reveal);
  cleanups.push(() => { try { reveal.destroy?.(); } catch { /* gone */ } }, () => { try { board.destroy(); } catch { /* gone */ } });

  const set = {
    reps, results: [], gained: emptyGains(), xpBefore: loadRewards(app).xp ?? 0, skills: S.loadSkills(app.store), streak: S.loadStreak?.(app.store),
    index: 0, startedAt: performance.now(), missNoted: false,
  };
  let rep = null;
  let raf = 0, backstop = 0, timer = 0;

  const stopAnim = () => {
    cancelAnimationFrame(raf); raf = 0;
    clearTimeout(backstop); backstop = 0;
    clearTimeout(timer); timer = 0;
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
  const draw = (frame) => board.render(frame, { learnerId: rep.carrierId, labels: 'number' });
  const setMarkers = (m) => board.setMarkers(m);

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
  function showCard(text) { els.cardText.textContent = text; els.card.hidden = false; }
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
  const enableTargets = (ids, { onTap, onPreview }) => board.enableTargets({ ids, onTap, onPreview, labelFor: (id) => STRINGS.teammate(shirtOf(id) ?? '') });

  // ---- one rep
  function startRep(i) {
    stopAnim();
    clearTargets();
    reveal.clear?.();
    hideBanner();
    set.index = i;
    const { drill } = set.reps[i];
    const { freezeAt } = timing(drill);
    const from = Math.max(0, freezeAt - P.watch);
    // Played and judged as the engine checked it (passdrill.js): nobody held back (timeline.js frameAt's default holds
    // the learner, who would never reach the ball), YOU on the ball at the freeze; graded on the drill's own rating.
    let at, freeze, rating;
    try {
      const playback = passdrill.passDrillPlayback(drill, { formations });
      at = (t) => playback.frameAt(t);
      freeze = passdrill.passDrillFrame(drill, freezeAt, { formations });
      rep = { drill, carrierId: carrierOf(drill, freeze), accept: drill.answer?.accept ?? [], focus: [...(drill.principles ?? [])] };
      rating = drill.rating?.options?.length ? drill.rating : passdrill.passDrillRating(drill, { formations });
    } catch (err) {
      console.warn('[fotbol] pass: could not rate', drill?.id, err);
      return nextRep();
    }
    const byReceiver = optionsByReceiver(rating?.options, rep.carrierId);
    const targets = orderTargets([...byReceiver.keys()], freeze);
    if (!targets.length) return nextRep();
    Object.assign(rep, { at, from, freezeAt, freeze, rating, byReceiver, targets, preview: null, tries: 0, first: null, decisionStart: 0 });
    const sample = [];
    for (let t = from; t < freezeAt; t += 0.5) sample.push(at(t));
    sample.push(freeze);
    try { board.setFocus?.(repFocus(sample, rating)); } catch { /* optional */ }
    renderDots();
    showSet();
  }

  function nextRep() {
    if (set.index + 1 < set.reps.length) startRep(set.index + 1);
    else finish();
  }

  function showSet() {
    dockMode('set');
    setMarkers([]);
    draw(rep.at(rep.from));
    spotlight([BALL_ID, rep.carrierId, ...rep.targets]);
    // A rep played as a teammate in your group (road.js: a full-back's "free side" is a centre-back's) says so.
    const card = roleCard(roleOfDrill(rep.drill), role);
    const text = card.changed ? card.text : STRINGS.setCard;
    showCard(text);
    els.card.classList.toggle('is-changed', card.changed);
    announce(text);
    setLine('');
    setActions();
    const go = () => { if (rep && view.dataset.phase === 'set') showWatch(); };
    els.card.onclick = go;
    later(card.changed ? P.roleChangedMs : P.setCardMs, go);
  }

  function showWatch() {
    dockMode('watch');
    hideCard();
    clearTargets();
    setMarkers([]);
    hideBanner();
    setLine(briefOf(rep.drill)); // the one line while the play runs (R7): "The ball is coming to you. Look around."
    setActions();
    spotlight([BALL_ID, rep.carrierId, ...rep.targets]);
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
    draw(rep.freeze);
    setMarkers([]);
    rep.preview = null;
    if (!rep.decisionStart) rep.decisionStart = performance.now();
    const question = questionOf(rep.drill);
    setLine(question);
    els.passBtn = button(STRINGS.pass, { variant: 'primary', icon: 'arrow', className: 'ps-pass', disabled: true, onClick: () => { if (rep?.preview) play(rep.preview); } });
    setActions(button(STRINGS.watchAgain, { icon: 'play', className: 'ps-again', onClick: () => showWatch() }), els.passBtn);
    enableTargets(rep.targets, { onPreview, onTap: (id) => play(id) });
    announce(question);
    // Focus lost with the old buttons (Try again, Watch again): the first target, so a keyboard carries on from there.
    if (!view.contains(document.activeElement)) els.board.querySelector('.board-target')?.focus({ preventScroll: true });
  }

  function onPreview(id) {
    if (view.dataset.phase !== 'choose') return;
    rep.preview = id && rep.byReceiver.has(id) ? id : null;
    setMarkers(rep.preview ? previewMarkers({ frame: rep.freeze, carrierId: rep.carrierId, receiverId: rep.preview }) : []);
    if (!els.passBtn) return;
    els.passBtn.disabled = !rep.preview;
    if (rep.preview) els.passBtn.setAttribute('aria-label', STRINGS.passTo(shirtOf(rep.preview) ?? '')); else els.passBtn.removeAttribute('aria-label');
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
    draw(rep.freeze); // back to the moment of the decision: every option, labelled
    drawReveal();
    const isBest = !!a.graded?.isBest || a.option.label === 'best';
    const line = pickLine(a.explain, { good: isBest || a.option.label === 'good' });
    const why = whyFor({ explain: a.explain, principles, drill: rep.drill, isBest, option: a.option, line });
    // After a first miss in the set, once: high standards plus belief (R20).
    const note = a === rep.first && a.stars === 0 && !set.missNoted ? STRINGS.missNote : '';
    if (note) set.missNoted = true;
    // The pitch's labels, for a screen reader.
    els.list.replaceChildren(...rankOptions([...rep.byReceiver.values()]).map((o) => el('li', { text: `${STRINGS.number(shirtOf(receiverOf(o)) ?? '')}: ${labelStyle(o.label).word}` })));
    const last = set.index + 1 >= set.reps.length;
    reveal.show({
      stars: a.stars, word: wordFor(a.stars), line,
      why: { title: why.title, summary: why.summary, reasons: why.reasons, praise: why.praise }, note,
      onNext: () => (last ? finish() : nextRep()),
      onRetry: a.stars <= P.retryMaxStars ? () => retry() : undefined,
    });
    refreshRewards(app); // the header catches up now (the award held it back until the reveal)
  }

  function drawReveal() {
    if (!rep?.last) return;
    setMarkers(revealMarkers({ rating: rep.rating, frame: rep.freeze, carrierId: rep.carrierId, choiceId: rep.last.option.id }));
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
      set.skills = eloUpdate(set.skills, { itemId: passRecordId(drill), principles: drill.principles ?? [], role, score01: score / 100, prior: Number.isFinite(drill.difficulty) ? drill.difficulty : 0 });
      S.saveSkills(app.store, set.skills);
      if (typeof S.updateStreak === 'function' && set.streak) {
        set.streak = S.updateStreak(set.streak, { day: S.dayKey(new Date()), score });
        S.saveStreak?.(app.store, set.streak);
      }
      S.appendHistory(app.store, historyEntry({ t: Date.now(), drill, role, option: a.option, graded: a.graded, bestId: rep.rating?.best?.id ?? null, ms: a.ms, nodeId: node?.id ?? null }));
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
    if (typeof deps.fulltime?.showFullTime === 'function') {
      try { ftCleanup = deps.fulltime.showFullTime(root, app, opts); return; } catch (err) { console.error('[fotbol] pass: full time failed', err); }
    }
    root.replaceChildren(fallbackFullTime(opts));
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

/** A plain reveal with the createPlayerReveal contract (docs/KID_REDESIGN.md §8.1). */
function fallbackReveal(container) {
  const clear = () => container.replaceChildren();
  return {
    show({ stars = 0, word = '', line = '', why = null, onNext, onRetry }) {
      const whyBox = el('div', { class: 'ps-fb-why', hidden: true }, [
        why?.title ? el('p', { class: 'ps-fb-why-title', text: why.title }) : null,
        why?.summary ? el('p', { text: why.summary }) : null,
        ...(why?.reasons ?? []).map((r) => el('p', { text: r })),
        ...(why?.praise ?? []).map((r) => el('p', { text: r })),
      ]);
      container.replaceChildren(el('div', { class: 'ps-fb-reveal' }, [
        el('p', { class: 'ps-fb-stars' }, [el('span', { 'aria-hidden': 'true', text: '★'.repeat(stars) + '☆'.repeat(3 - stars) }), el('span', { class: 'visually-hidden', text: STRINGS.stars(stars) })]),
        el('p', { class: 'ps-fb-word', text: word }),
        el('p', { class: 'ps-fb-line', text: line }),
        whyBox,
        el('div', { class: 'ps-fb-actions' }, [
          button(STRINGS.next, { variant: 'primary', icon: 'arrow', onClick: () => onNext?.() }),
          button(STRINGS.why, { onClick: () => { whyBox.hidden = !whyBox.hidden; } }),
          onRetry ? button(STRINGS.retry, { onClick: () => onRetry() }) : null,
        ]),
      ]));
      container.querySelector('.btn--primary')?.focus({ preventScroll: true });
    },
    clear,
    destroy: clear,
  };
}

/** A plain Full time with the showFullTime options. */
function fallbackFullTime({ reps = [], onHome, onAgain }) {
  const stars = reps.reduce((a, r) => a + (r.stars ?? 0), 0);
  return el('div', { class: 'ps-fb-full' }, [
    el('h1', { text: STRINGS.doneTitle }),
    el('p', { class: 'ps-fb-stars', text: STRINGS.doneStars(stars, reps.length * 3) }),
    el('div', { class: 'ps-fb-actions' }, [
      button(STRINGS.back, { variant: 'primary', icon: 'arrow', onClick: () => onHome?.() }),
      button(STRINGS.again, { onClick: () => onAgain?.() }),
    ]),
  ]);
}
