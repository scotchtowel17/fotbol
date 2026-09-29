// The progressive field: which players a rep shows and scores at each stage (a small game, a bigger game, the full
// match), and the gate that keeps a staged rep the same lesson as the full game.
// Spec: docs/PROGRESSIVE_FIELD.md §1-§3. Contract: docs/ARCHITECTURE.md §5.17.
//
// A staged rep is played and judged on a REDUCED frame (reduceFrame) that holds only its cast: hidden players are not
// drawn and not scored, so every star, ring and sentence depends only on players the kid can see. The playback itself
// is the full game's (the cast moves exactly as in the 22-player clip); only the judging frame is reduced.
//
//   castFor(frame, opts)             the cast of a stage: the learner, the players on the ball in the clip, the players
//                                    the drill scripts or names, the duties (who presses, who you mark), the offside-line
//                                    setters when the lesson needs them, the players the lesson is about, then the nearest
//                                    players (both teams kept in the game), capped by the stage
//   reduceFrame(frame, ids)          the frame with only the cast; castLabel(ids) "3 v 2"; clipIdsOf(item) who has the ball;
//                                    keepIdsOf(item, frame) who the drill scripts or names
//   stageSpotDrill / stagePassDrill  a rep at a stage, or null when the gate fails even after growing the cast; a pass
//                                    rep's smaller games take the most compact cast that passes (castExtent: the camera
//                                    zooms in on it, so the figures are big)
//   bestStage(item, wanted, opts)    the wanted stage, else the next bigger one that passes (the full match always does)
//   lessonOf(principles, result, catalogue)   the rule a staged rep is held to (also Player mode's lesson keys, kidscore.js)
//   stagesOf(item, opts)             every stage at once (npm run check's report)
//
// PURE and deterministic: no DOM, no clock, no randomness.

import { dist } from './geometry.js';
import { segDist } from './rules/_util.js';
import { HALF_X, LENGTH } from './pitch.js';
import { ROLE_INFO, BACK_LINE, MIDFIELD, FORWARDS, mirrorPlayerId } from './roles.js';
import { frameAt, learnerBaseAt, timing, interpKeys } from './timeline.js';
import { normalizeScenario, learnerId as learnerIdOf } from './scenario.js';
import { buildContext, CONTEXT_DEFAULTS } from './context.js';
import { computeGhost } from './ghost.js';
import { evaluate, toleranceFor } from './score.js';
import { EXPLAIN_DEFAULTS } from './explain.js';
import { RULES, RULES_BY_ID } from './rules/index.js';
import { rateOptions, gradePass, PASS_DEFAULTS } from './passing.js';
import { passDrillFrame, passDrillRating, passLessons } from './passdrill.js';
import { optionsByReceiver, passTargets, PASS_TARGET_DEFAULTS } from './passtargets.js';
import { kidArea, kidStars } from './kidscore.js';

/** The stages, smallest first: a small game (3-6 players), a bigger game (6-12), the full match (all 22). */
export const STAGES = Object.freeze(['small', 'medium', 'full']);

export const CAST_DEFAULTS = Object.freeze({
  small: Object.freeze({ min: 3, max: 6 }), // [D] §1: 2 v 1, 2 v 2, 3 v 2 ...
  medium: Object.freeze({ min: 6, max: 12 }), // [D] §1: 5 v 4, 6 v 6 ...
  mediumFrom: 7, // [D] a bigger game holds at least this many players: more than any small game (small.max + 1), so "Now 4 v 3!" is bigger
  sameAnswer: 4, // [D] m: a staged ghost this close to the full game's ghost is the same answer
  minGhostScore: 90, // [S] = CHECK_DEFAULTS.minGhostScore (RESEARCH 9.5: the best spot scores S; tested equal)
  stillMax: 70, // [D] = CHECK_DEFAULTS.maxStartScore: standing still at the start scores below this (tested equal)
  minRuleWeight: 2, // [D] = SPOT_DEFAULTS.minRuleWeight: the lesson's rule weighs at least this at the staged ghost...
  minRuleScore: 0.9, // [D] = SPOT_DEFAULTS.minRuleScore: ...and scores at least this there (tested equal)
  maxGap: 2, // [D] filling a cast keeps |ours - theirs| within this (both teams stay in the game)
  cueReach: 0.5, // [D] m: a line, point or segment end a rule cues names the players this close to it
  receiveReach: 1.5, // [D] m: a scripted (override) player this close to the ball at a ball key receives it (in the clip)
  laneReach: 3, // [D] m: attacking, an opponent this close to the lane from the ball to your spot is in the lesson (lane-open, B3)
  minOurs: 2, // [D] a spot rep's cast holds the learner and at least one teammate
  decisiveAt: 0.5, // [D] a player whose absence alone moves the full game's answer this share of sameAnswer, or uses up this
  //                  share of the margin standing still has below stillMax, is one the lesson needs (decisiveIds)
  lineLevel: 0.3, // [D] m = OFFSIDE_DEFAULTS.margin: a defender this close to level with the second-last player sets the line as well as the keeper
  offsidePrinciples: Object.freeze(['F4', 'B2', 'P5']), // §1: lessons about the offside line...
  offsideRules: Object.freeze(['offside', 'pin', 'keeps-onside']), // ...and the rules that judge it (weighted 2+: involved)
  namedPlural: 2, // [D] a plural name in the drill's own words ("your defenders") shows this many of them
  minOptions: 3, // [D] §1 pass reps: 3-5 teammates to pass to (the ones a tap can pick: passTargets)...
  maxOptions: 5, // [D]
  passMargin: 8, // [D] = PASSDRILL_DEFAULTS.margin: the best is "clearly ahead" of every other receiver by this (tested equal)
  passMediumFrom: 8, // [D] a pass rep's bigger game starts growing at this many players (5 v 3), so it is bigger than the small one
  farPass: PASS_TARGET_DEFAULTS.farPass, // [S] = passtargets.js (and pass.js PASS_DEFAULTS.farPass; play-test): a teammate further than this (m) from the ball is no
  //              target unless the pass is really on; the keeper neither (tested equal)
  passNoRise: 2, // [D] pass reps: a receiver the full game grades below 3 stars (at most this many) never earns 3 at a stage
  // A pass rep's smaller games prefer a compact cast: a camera fits the cast on both axes, and on a phone held upright a
  // cast spread across the pitch (a decoy at each touchline) drew its figures no bigger than the full match's
  // (the whole-pitch 5 px/m and 40 px figures; they grow only past about 9 px/m, board.js figureScale).
  passBox: Object.freeze({ along: 36, across: 22 }), // [D] m: the box a compact cast fits (its players and the ball at the
  //   freeze, along x the pitch's length, across y): about a phone held upright's board (359 x 570 CSS px, less the camera's
  //   pads and headroom) at 13 px/m, where figures stand about 55 px tall; castExtent's `over` is how far a cast spills over it
  passBoxSlack: 0.05, // [D] casts whose spill over passBox is within this are as compact as each other (the plain order's then)
  passSearch: 40, // [D] the small game's compact search judges at most this many casts (the most compact first)
  passCompact: true, // [D] false: a pass rep's smaller game is the relevance order's first cast that passes, as before (reports, tests)
  praiseDepth: 3, // [D] spot reps: the praise at the answer is the full game's, this deep: the line (1) and the Why? sheet's two more
  //                 (js/ui/player/play.js pickLine and whyFor: the rules met at explain's praiseAt, the drill's own ideas first)
});

const P_OF = (params) => (params ? { ...CAST_DEFAULTS, ...params } : CAST_DEFAULTS);
const capOf = (stage, P) => (stage === 'small' || stage === 'medium' ? P[stage] : null);
const UNIT_ROLES = Object.freeze({ CB: BACK_LINE, FB: BACK_LINE, DM: MIDFIELD, CM: MIDFIELD, W: FORWARDS, ST: FORWARDS });
const BAD_LABELS = new Set(['risky', 'cut-out', 'offside', 'danger']); // a pass you should not pick: the choice is real
const familyOf = (p) => ROLE_INFO[p?.role]?.family ?? null;
/** a < b, NaN-safe: a NaN or missing value never passes a gate (every comparison below is written so NaN fails). */
const atLeast = (v, min) => v >= min; // false for NaN
const below = (v, max) => v < max; // false for NaN

// ---------------------------------------------------------------- frames and labels

/**
 * The frame with only `ids` in it: the ball, possession and tags kept, the carrier kept only when in the cast.
 * @param {import('./types.js').Frame} frame
 * @param {Iterable<string>} ids  a Set or an array of player ids (a single id string is refused: it would read as characters)
 * @returns {import('./types.js').Frame}
 */
export function reduceFrame(frame, ids) {
  if (typeof ids === 'string' || ids == null || typeof ids[Symbol.iterator] !== 'function') throw new TypeError('reduceFrame: ids must be a Set or an array of player ids');
  const keep = ids instanceof Set ? ids : new Set(ids);
  return {
    ...frame,
    ball: frame.ball ? { ...frame.ball } : frame.ball,
    players: frame.players.filter((p) => keep.has(p.id)),
    carrierId: frame.carrierId && keep.has(frame.carrierId) ? frame.carrierId : null,
    tags: { ...frame.tags },
  };
}

/** "3 v 2": ours v theirs among `ids` (a goalkeeper counts only when in the cast); the full match is "11 v 11". */
export function castLabel(ids, stage) {
  let ours = 0, theirs = 0;
  for (const id of ids) {
    if (id.startsWith('us-')) ours++;
    else if (id.startsWith('them-')) theirs++;
  }
  return { label: stage === 'full' ? '11 v 11' : `${ours} v ${theirs}`, ours, theirs };
}

// ---------------------------------------------------------------- who the clip and the drill's words are about

/**
 * Every player who has the ball during a rep's clip: the timeline's carriers (a pass drill's carrier too), the scripted
 * (override) players who meet the ball at a ball key (they receive it), and, when the timeline starts without a carrier
 * key, whoever the playback puts on it at t = 0 (formations needed for that one).
 * @param {object} item  a scenario or a pass drill
 * @param {{ formations?: object, params?: object }} [opts]
 * @returns {string[]}
 */
export function clipIdsOf(item, { formations, params } = {}) {
  const P = P_OF(params);
  const tl = item?.timeline ?? {};
  const ids = [];
  const add = (id) => { if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id); };
  const carriers = [...(tl.carrier ?? [])].sort((a, b) => a.t - b.t);
  for (const k of carriers) add(k?.id);
  if (item?.kind === 'pass') { add(item.carrierId); add(item.carrier); }
  for (const o of tl.players?.overrides ?? []) {
    const keys = [...(o.keys ?? [])].sort((a, b) => a.t - b.t);
    if ((tl.ball ?? []).some((b) => { const p = interpKeys(keys, b.t); return p && dist(p, b) <= P.receiveReach; })) add(o.id);
  }
  if (formations && !(carriers[0]?.t <= 0)) {
    const learnerId = item?.kind === 'pass' ? null : undefined;
    add(frameAt(item, 0, { formations, learnerId }).carrierId);
  }
  return ids;
}

/** The words that name a player in a drill's kid texts: team word → team, role word → families ('partner': the learner's). */
const NAME_TEAMS = Object.freeze({ their: 'them', your: 'us', our: 'us' });
const NAME_ROLES = Object.freeze({
  striker: ['ST'], strikers: ['ST'], '#9': ['ST'], winger: ['W'], wingers: ['W'],
  'full-back': ['FB'], 'full-backs': ['FB'], fullback: ['FB'], fullbacks: ['FB'],
  'centre-back': ['CB'], 'centre-backs': ['CB'], 'center-back': ['CB'], 'center-backs': ['CB'],
  defender: ['CB', 'FB'], defenders: ['CB', 'FB'], midfielder: ['DM', 'CM'], midfielders: ['DM', 'CM'], '#6': ['DM'], '#8': ['CM'],
  keeper: ['GK'], goalkeeper: ['GK'], partner: 'partner',
});
const kidText = (v) => (typeof v === 'string' ? v : typeof v?.kid === 'string' ? v.kid : typeof v?.standard === 'string' ? v.standard : '');

/**
 * The words a kid can read in a rep (as Player mode picks them: briefKid, questionKid, the takeaway, each misconception's
 * textKid, else its text).
 * @returns {string[]}
 */
export function kidTextsOf(item) {
  return [item?.briefKid, item?.questionKid, kidText(item?.takeaway), ...(item?.misconceptions ?? []).map((m) => (typeof m?.textKid === 'string' && m.textKid ? m.textKid : kidText(m?.text)))]
    .filter((t) => typeof t === 'string' && t.trim());
}

/**
 * The players a drill's own words name ("their striker", "your defenders", "your partner"): for each name, the players of
 * that team and role (the learner's partner: the teammate of the learner's family) nearest the learner's base, one for
 * a singular name and namedPlural for a plural one, counting those already in `have` (a scripted runner is the one the
 * words are about).
 * @param {string[]} texts
 * @param {import('./types.js').Frame} frame
 * @param {{ learnerId: string, base?: {x,y}, have?: string[] }} opts
 * @returns {string[]}
 */
function namedIds(texts, frame, { learnerId, base, have = [] }, P) {
  const me = frame.players.find((p) => p.id === learnerId);
  const anchor = base ?? me ?? frame.ball;
  const out = [];
  const seen = new Set();
  for (const t of texts) {
    for (const m of String(t).toLowerCase().matchAll(/\b(their|your|our)\s+(#\d|[a-z]+(?:-[a-z]+)?)/g)) {
      const team = NAME_TEAMS[m[1]], word = m[2], fams = NAME_ROLES[word];
      if (!fams) continue;
      const key = `${team}:${word}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const want = fams === 'partner' ? [familyOf(me)] : fams;
      const n = word.endsWith('s') ? P.namedPlural : 1;
      const pool = frame.players.filter((p) => p.team === team && p.id !== learnerId && want.includes(familyOf(p)));
      let got = pool.filter((p) => have.includes(p.id) || out.includes(p.id)).length;
      for (const p of pool.filter((q) => !have.includes(q.id) && !out.includes(q.id)).sort(closer(anchor, frame.ball))) {
        if (got >= n) break;
        out.push(p.id);
        got++;
      }
    }
  }
  return out;
}

/**
 * The players a drill scripts or names, who are always in its cast (§1: every sentence depends only on players the kid
 * can see): its scripted (override) players, its authored `"stages": { "keep": [ids] }` (mirrored with the drill), and
 * the players its own words name (namedIds).
 * @param {object} item  a scenario or a pass drill
 * @param {import('./types.js').Frame} frame  the full frame at the freeze
 * @param {{ learnerId?: string, base?: {x,y}, clipIds?: string[], params?: object }} [opts]  clipIds: the players on the
 *   ball in the clip (clipIdsOf; always shown, so a name they answer to needs no one else)
 * @returns {{ ids: string[], scripted: string[], authored: string[], named: string[] }}
 */
export function keepIdsOf(item, frame, { learnerId = learnerIdOf(item), base, clipIds = [], params } = {}) {
  const P = P_OF(params);
  const inFrame = new Set(frame.players.map((p) => p.id));
  const scripted = [...new Set((item?.timeline?.players?.overrides ?? []).map((o) => o?.id).filter((id) => typeof id === 'string' && id !== learnerId && inFrame.has(id)))];
  const mirrored = typeof item?.mirrorOf === 'string';
  const authored = (Array.isArray(item?.stages?.keep) ? item.stages.keep : [])
    .filter((id) => typeof id === 'string').map((id) => (mirrored ? mirrorPlayerId(id) : id)).filter((id) => id !== learnerId && inFrame.has(id));
  const named = namedIds(kidTextsOf(item), frame, { learnerId, base, have: [...clipIds, frame.carrierId, ...scripted, ...authored] }, P);
  return { ids: [...new Set([...scripted, ...authored, ...named])], scripted, authored, named };
}

// ---------------------------------------------------------------- relevance

/** Sort nearest `q` first; ties by distance to `r` (mirror-invariant, unlike frame order). */
const closer = (q, r = q) => (a, b) => dist(a, q) - dist(b, q) || (r ? dist(a, r) - dist(b, r) : 0);

/** Players a rule's cue names: the player, or the players standing on its line (x), at its point or a segment's ends. */
function cueIds(cue, players, P, g, ball) {
  if (!cue) return [];
  if (cue.type === 'player') return cue.id ? [cue.id] : [];
  const near = (q) => players.filter((p) => Math.hypot(p.x - q.x, p.y - q.y) <= P.cueReach).sort(closer(g, ball)).map((p) => p.id);
  // A line across the pitch can name players far apart (both full-backs): nearest the answer first, so a mirrored drill
  // names the mirrored players (frame order would not).
  if (cue.type === 'line-x') return Number.isFinite(cue.x) ? players.filter((p) => Math.abs(p.x - cue.x) <= P.cueReach).sort(closer(g, ball)).map((p) => p.id) : [];
  if (cue.type === 'point') return near(cue);
  if (cue.type === 'segment') return [...near(cue.a), ...near(cue.b)];
  return [];
}

/**
 * The players who set a team's offside line (IFAB Law 11: the second-last player, the keeper counting), so that the line
 * on a reduced frame is the full game's: the second-last player and one at least as deep (the last, usually the keeper;
 * a defender level with the second-last within lineLevel does as well and keeps a far keeper out of a small game).
 * Ours are counted without the learner (the rules read our line without the learner, who is judged wherever they stand).
 */
function lineSetters(frame, team, learnerId, P) {
  const depth = (p) => (team === 'them' ? p.x : -p.x); // larger = deeper (nearer their own goal line)
  const ball = frame.ball;
  const own = frame.players.filter((p) => p.team === team && p.id !== learnerId).sort((a, b) => depth(b) - depth(a) || dist(a, ball) - dist(b, ball));
  if (own.length < 2) return own.map((p) => p.id);
  const second = own[1];
  const level = own.slice(2).find((p) => p.role !== 'GK' && depth(second) - depth(p) <= P.lineLevel);
  return [second.id, (level ?? own[0]).id];
}

/**
 * The pairs of players who can hold a team's offside line in a reduced frame, best first: the exact pair when a defender
 * is level with the second-last (lineSetters), else the second-last with each of the next deepest outfield players
 * (the line then sits a little higher, which is fine when nobody in the cast is judged differently: linesNeeded), and
 * last the exact pair (the second-last and the keeper), which always holds the full game's line.
 */
function setterOptions(frame, team, learnerId, P) {
  const exact = lineSetters(frame, team, learnerId, P);
  const depth = (p) => (team === 'them' ? p.x : -p.x);
  const ball = frame.ball;
  const own = frame.players.filter((p) => p.team === team && p.id !== learnerId).sort((a, b) => depth(b) - depth(a) || dist(a, ball) - dist(b, ball));
  if (own.length < 3 || exact[1] !== own[0].id) return [exact];
  return [...own.slice(2).filter((p) => p.role !== 'GK').slice(0, 3).map((p) => [own[1].id, p.id]), exact];
}

/** The x of a team's offside line among `players` (their second-last player; ours without the learner), as the rules read it. */
function lineOf(players, team, learnerId) {
  if (team === 'them') {
    const xs = players.filter((p) => p.team === 'them').map((p) => p.x).sort((a, b) => b - a);
    return xs.length > 1 ? xs[1] : LENGTH;
  }
  const xs = players.filter((p) => p.team === 'us' && p.id !== learnerId).map((p) => p.x).sort((a, b) => a - b);
  return xs[1] ?? xs[0] ?? 0;
}

/**
 * Whose offside line matters for the cast (§1): an attacker of the team on the ball ahead of the ball past halfway. The
 * line's setters are needed only when leaving them out would move the line past someone who is judged against it: an
 * attacker in the cast (a receiver), or the learner's answer or start, who would change sides of the line (offside ↔
 * onside). Otherwise the reduced line judges everyone in the cast exactly as the full one, and a far keeper stays out
 * (the camera fits the cast, so figures are big).
 */
function linesNeeded(frame, ids, byId, { learnerId, learnerAt, start }, P) {
  const need = new Set();
  const ball = frame.ball;
  const cast = ids.map((id) => byId.get(id)).filter(Boolean);
  for (const team of ['them', 'us']) {
    const attacking = team === 'them' ? 'us' : 'them';
    if (frame.possession !== attacking) continue;
    const ahead = (q) => (attacking === 'us' ? q.x > Math.max(ball.x, HALF_X) : q.x < Math.min(ball.x, HALF_X));
    const judged = cast.filter((p) => p.team === attacking && p.id !== frame.carrierId && p.id !== learnerId);
    const me = byId.get(learnerId);
    if (me?.team === attacking && me.id !== frame.carrierId) judged.push(...[learnerAt ?? me, start].filter(Boolean));
    if (!judged.some(ahead)) continue;
    const full = lineOf(frame.players, team, learnerId), reduced = lineOf(cast, team, learnerId);
    if (Math.abs(full - reduced) <= P.lineLevel) continue;
    const off = (q, line) => (attacking === 'us' ? q.x > Math.max(ball.x, line, HALF_X) + P.lineLevel : q.x < Math.min(ball.x, line, HALF_X) - P.lineLevel);
    const lo = Math.min(full, reduced) - P.lineLevel, hi = Math.max(full, reduced) + P.lineLevel;
    if (judged.some((q) => off(q, full) !== off(q, reduced) || (q.x >= lo && q.x <= hi))) need.add(team);
  }
  return need;
}

/**
 * The players the full game's answer depends on, most decisive first: leave each one out (the must aside) and see how
 * far the best spot moves (as a share of sameAnswer) and how much of the margin standing still has below stillMax it
 * uses up; decisiveAt or more (either) is decisive. It finds the players a lesson needs together (a line of three
 * forwards that crowds a spot: take any one away and the answer moves), which distance alone misses. About 20 ghost
 * searches, so a stage asks for it only when the plain relevance order fails the gate.
 */
function decisiveIds(frame, { learnerId, base, centre, tol, start, skip, ghost, still }, P) {
  const judge = (players) => {
    const ctx = buildContext({ ...frame, players }, { learnerId, base });
    return { spot: computeGhost(ctx, { base: centre, tol }).spot, still: evaluate(ctx, start, { center: centre, tol }).score };
  };
  const all = ghost && Number.isFinite(still) ? { spot: ghost, still } : judge(frame.players);
  const margin = Math.max(1, P.stillMax - all.still);
  const out = [];
  frame.players.forEach((p, i) => {
    if (skip.has(p.id)) return;
    const r = judge(frame.players.filter((q) => q !== p));
    const impact = Math.max(dist(r.spot, all.spot) / P.sameAnswer, Math.abs(r.still - all.still) / margin);
    if (impact >= P.decisiveAt) out.push({ id: p.id, impact, d: dist(p, frame.ball), i });
  });
  return out.sort((a, b) => b.impact - a.impact || a.d - b.d || a.i - b.i).map((e) => e.id);
}

/**
 * The players who make standing still at the start score below stillMax again, greedily from the cast `ids`: each step
 * adds the player whose presence lowers the start's score most (ties: nearest the start), until it is below stillMax
 * (then the picks, in order) or no one lowers it further or the cap is reached (then none). One score at one spot per
 * candidate, so cheap next to a ghost search.
 * @returns {string[]}
 */
function stillIds(prep, ids, cap, P) {
  const { frame, learnerId, base, centre, tol, start } = prep;
  const cur = [...ids], out = [];
  const scoreOf = (list) => evaluate(buildContext(reduceFrame(frame, list), { learnerId, base }), start, { center: centre, tol }).score;
  let now = scoreOf(cur);
  while (!below(now, P.stillMax) && cur.length < cap.max) {
    let pick = null;
    for (const p of frame.players) {
      if (cur.includes(p.id)) continue;
      const s = scoreOf([...cur, p.id]);
      if (!pick || s < pick.s || (s === pick.s && dist(p, start) < dist(pick.p, start))) pick = { p, s };
    }
    if (!pick || !(pick.s < now)) break;
    cur.push(pick.p.id);
    out.push(pick.p.id);
    now = pick.s;
  }
  return below(now, P.stillMax) ? out : [];
}

/**
 * Who presses the ball (the carrier's nearest outfield opponent), when the ball is under pressure (the frame's tag, else
 * one within the context's pressureRadius): without him a staged rep would judge "pressure on the ball" on nobody.
 */
function presserOf(frame, pressured, { learnerId, base } = {}) {
  const carrier = frame.carrierId ? frame.players.find((p) => p.id === frame.carrierId) : null;
  if (!carrier) return null;
  const reach = (p) => Math.min(dist(p, carrier), dist(p, frame.ball));
  // As the context reads it: the learner counts at their base (and is always shown anyway).
  const at = (p) => (p.id === learnerId && base ? { ...p, x: base.x, y: base.y } : p);
  const near = frame.players.filter((p) => p.team !== carrier.team && p.role !== 'GK').map(at).sort((a, b) => reach(a) - reach(b) || dist(a, frame.ball) - dist(b, frame.ball))[0] ?? null;
  const tag = frame.tags?.pressureOnBall;
  const on = pressured ?? (tag !== undefined ? !!tag : !!near && reach(near) <= CONTEXT_DEFAULTS.pressureRadius);
  return on ? near?.id ?? null : null;
}

/** One option per teammate, as a tap plays it (passtargets.js optionsByReceiver: the better of feet and space). */
const receiversOf = (options = [], carrierId = null) => optionsByReceiver(options, carrierId);

/**
 * The receivers a kid can tap (passtargets.js passTargets, as pass.js offers them): every receiver less anyone further
 * than farPass from the ball and the keeper, unless that pass is really on. @returns {Map<string, object>} receiver id →
 * the option a tap plays
 */
const targetsOf = (byReceiver, frame, P) => passTargets(byReceiver, frame, frame?.carrierId ?? null, P);

/**
 * The relevance order of a stage's cast, as four lists: `must` (always in: the learner, everyone on the ball in the clip,
 * the players the drill scripts or names (`keep`), and the duties: defending, the context's first defender and the
 * learner's mark; the presser on the ball) and `lines` (the offside-line setters when the lesson involves the line), always
 * in; `core` (the players the lesson is about, most relevant first) and `fill` (everyone else, nearest first). Spot
 * reps: when the plain order failed, first the players the full game's answer depends on (`decisive`); then, defending,
 * the context's second defender and the dangerous attacker; attacking, the opponents in the lanes from the ball to the
 * learner's base and ghost and the ones nearest the ghost, the base and the ball; the teammate nearest the ghost; the
 * players the rules weighted 2+ cue at the ghost; defending, the opponents nearest the ghost and the base; in the bigger
 * game the learner's unit. Pass reps: receiver by receiver (the best, the passer's guards, the decoys, the rest: only
 * receivers a tap can pick), each with the defenders who block or press a pass to them, and the defender nearest the
 * ball. The fill is by distance to the ghost (or the best pass's target), the ball and the learner's start.
 */
function castOrder(frame, opts, P) {
  const { learnerId, stage, clipIds = [], keep = [], principles = [], rating = null } = opts;
  const byId = new Map(frame.players.map((p) => [p.id, p]));
  const must = [], lines = [], core = [];
  const inAny = new Set();
  const addTo = (list) => (id) => { if (typeof id === 'string' && byId.has(id) && !inAny.has(id)) { inAny.add(id); list.push(id); } };
  const addMust = addTo(must), addLine = addTo(lines), addCore = addTo(core);
  addMust(learnerId);
  addMust(frame.carrierId);
  for (const id of clipIds) addMust(id);
  for (const id of keep) addMust(id);
  const me = byId.get(learnerId);
  const base = opts.base ?? me ?? frame.ball;
  const start = opts.start ?? me ?? base;
  let target, setters = new Set(), learnerAt = null, lead = 0;
  const units = []; // pass reps: each receiver a tap can pick (not the best) with the defenders on his pass (compactSearch)
  let bestUnit = [];

  if (rating) {
    // A pass rep, receiver by receiver, each with the defenders who block or press any pass to them (without them a
    // pass would look better than it is): the best receiver, the teammates already in (the passer), the defender on the
    // ball, the decoys (a receiver whose pass you should not pick, the most tempting first), then everyone else. Only
    // receivers a tap can pick (targetsOf): a far decoy would stretch the camera and count as an option no one can take.
    addMust(presserOf(frame));
    const options = rating.options ?? [];
    const best = rating.best ?? options[0];
    target = best?.point ?? frame.ball;
    const byReceiver = new Map();
    for (const o of options) if (o.targetId && o.targetId !== learnerId) (byReceiver.get(o.targetId) ?? byReceiver.set(o.targetId, []).get(o.targetId)).push(o);
    const taps = targetsOf(receiversOf(options, learnerId), frame, P);
    const defendersOf = (id) => (byReceiver.get(id) ?? []).flatMap((o) => [o.blocker?.id, o.presserId]).filter((x) => typeof x === 'string' && byId.has(x));
    const receiver = (id) => {
      if (byId.has(id) && id !== best?.targetId && !units.some((u) => u[0] === id)) units.push([...new Set([id, ...defendersOf(id)])]);
      addCore(id);
      for (const d of defendersOf(id)) addCore(d);
    };
    const guards = (id) => { for (const d of defendersOf(id)) addCore(d); };
    if (best) {
      receiver(best.targetId);
      bestUnit = [...new Set([best.targetId, ...defendersOf(best.targetId)])].filter((id) => byId.has(id));
    }
    lead = core.length; // the best receiver and the defenders on his pass: compactOrder keeps them first
    for (const id of must) guards(id);
    addCore(frame.players.filter((p) => p.team === 'them').sort(closer(frame.ball, target))[0]?.id);
    const rest = [...byReceiver.keys()].filter((id) => id !== best?.targetId && taps.has(id));
    for (const id of rest) if (BAD_LABELS.has(taps.get(id)?.label)) receiver(id);
    for (const id of rest) receiver(id);
    // (The offside line: a receiver in the cast ahead of the ball past halfway brings in its setters, pickCast.)
  } else {
    const ctx = opts.ctx ?? buildContext(frame, { learnerId, base });
    const g = opts.ghost?.spot ?? opts.ghost ?? base;
    target = g;
    learnerAt = g;
    const defending = ctx.moment !== 'in_possession';
    // The duties the judging reads (§1: every star and sentence on players the kid can see): who presses the ball, who
    // you mark, and the pressure on the ball itself.
    if (defending) { addMust(ctx.firstDefender?.id); addMust(ctx.markTarget?.id); }
    addMust(presserOf(frame, ctx.pressureOnBall, { learnerId, base }));
    const opps = frame.players.filter((p) => p.team === 'them');
    const mates = frame.players.filter((p) => p.team === 'us' && p.id !== learnerId);
    const nearest = (list, q) => [...list].sort(closer(q, frame.ball))[0] ?? null;
    const nearestTo = (q) => nearest(opps, q);
    // When the plain order failed the gate: first the players the full game's answer depends on (decisiveIds).
    for (const id of opts.decisive ?? []) addCore(id);
    if (defending) {
      // Defending: the rest of the context's duties (who covers, who is most dangerous).
      for (const p of [ctx.secondDefender, ctx.dangerousAttacker]) addCore(p?.id);
    } else {
      // Attacking: the opponents in the passing lanes from the ball to your spot, then the ones nearest your spot and
      // the ball (who marks you, who presses the ball).
      const lanes = [[frame.ball, base], [frame.ball, g]];
      opps.map((p) => ({ p, d: Math.min(...lanes.map(([a, b]) => segDist(p.x, p.y, a.x, a.y, b.x, b.y))) })).filter((e) => e.d <= P.laneReach)
        .sort((a, b) => a.d - b.d || dist(a.p, g) - dist(b.p, g)).forEach((e) => addCore(e.p.id));
      addCore(nearestTo(g)?.id);
      addCore(nearestTo(base)?.id);
      addCore(nearestTo(frame.ball)?.id);
    }
    // The teammate nearest your answer (spacing, and the line-mate you stay compact with).
    addCore(nearest(mates, g)?.id);
    // The offside line (§1): a lesson on it (F4, B2, P5) or a rule on it weighted 2+ brings in the players who set it,
    // theirs when we have the ball (offside, pin), ours when we defend (keeps-onside).
    const heavy = RULES.filter((r) => r.weight(ctx) >= P.minRuleWeight).sort((a, b) => b.weight(ctx) - a.weight(ctx));
    if (principles.some((p) => P.offsidePrinciples.includes(p)) || heavy.some((r) => P.offsideRules.includes(r.id))) setters.add(defending ? 'us' : 'them');
    // The players the heavy rules point at from the ghost (rule.cue: the presser you cover, the runner you track, the
    // line you hold), heaviest rule first.
    for (const r of heavy) if (typeof r.cue === 'function') for (const id of cueIds(r.cue(ctx, g), frame.players, P, g, frame.ball)) addCore(id);
    if (defending) { addCore(nearestTo(g)?.id); addCore(nearestTo(base)?.id); }
  }
  if (stage === 'medium' && !rating) {
    const unit = UNIT_ROLES[ROLE_INFO[me?.role]?.family] ?? [];
    frame.players.filter((p) => p.team === 'us' && p.id !== learnerId && unit.includes(p.role))
      .sort(closer(base, frame.ball)).forEach((p) => addCore(p.id));
  }
  // The offside-line setters are in as surely as the must (§1), never swapped out to even the teams.
  for (const team of setters) {
    for (const id of lineSetters(frame, team, learnerId, P)) {
      if (must.includes(id) || lines.includes(id)) continue;
      const i = core.indexOf(id);
      if (i >= 0) core.splice(i, 1);
      inAny.delete(id);
      addLine(id);
    }
  }
  const reach = (p) => Math.min(dist(p, target), dist(p, frame.ball), dist(p, start));
  const fill = frame.players.filter((p) => !inAny.has(p.id)).map((p, i) => ({ id: p.id, d: reach(p), b: dist(p, frame.ball), i }))
    .sort((a, b) => a.d - b.d || a.b - b.b || a.i - b.i).map((e) => e.id);
  return { byId, must, lines, core, fill, learnerId, learnerAt, start: opts.start ?? null, lead, units, bestUnit };
}

/**
 * Pick `size` players from a relevance order: every `must`, then the core in order, then the fill nearest first. Both
 * teams stay in the game: at least `theirs.min` of theirs and `ours.min` of ours (the most relevant, in place of the last
 * picks), our side at most `ours.max` (pass reps: the learner plus 3-5 teammates), the fill keeping |ours - theirs|
 * within maxGap, and a cast still more lopsided than that evened up by growing it up to `cap`. When an attacker in the
 * cast stands ahead of the ball past halfway and the reduced line would judge someone differently (linesNeeded), the
 * defending team's offside-line setters come in right after the must (§1).
 */
function pickCast(frame, order, size, P, { ours = { min: 1, max: Infinity }, theirs = { min: 1 }, cap = size, gap = P.maxGap } = {}) {
  const teamOf = (id) => order.byId.get(id).team;
  const mins = { us: ours.min, them: theirs.min };
  const pick = (lines) => {
    const sel = [], n = { us: 0, them: 0 }, taken = new Set();
    const put = (id) => { sel.push(id); taken.add(id); n[teamOf(id)]++; };
    const fits = (id) => !(teamOf(id) === 'us' && n.us >= ours.max);
    for (const id of [...order.must, ...lines]) if (!taken.has(id)) put(id);
    const fixed = sel.length; // the must and the line setters: never swapped out
    // The core in order, but a player who would leave the teams more than maxGap apart waits while the other team has
    // a player further down the core (the game stays a game: 3 v 2, 6 v 5, not 2 v 7).
    const queue = order.core.filter((id) => !taken.has(id));
    while (sel.length < size && queue.length) {
      const even = (id) => Math.abs(n.us - n.them + (teamOf(id) === 'us' ? 1 : -1)) <= gap;
      let i = queue.findIndex((id) => fits(id) && even(id));
      if (i < 0) i = queue.findIndex(fits);
      if (i < 0) break;
      put(queue.splice(i, 1)[0]);
    }
    const ranked = [...order.core, ...order.fill];
    for (const team of ['them', 'us']) {
      while (n[team] < mins[team]) {
        const id = ranked.find((x) => !taken.has(x) && teamOf(x) === team && fits(x));
        if (!id) break;
        if (sel.length >= size) {
          // make room: the last pick (never the must or a line setter) of the other team that it can spare; else grow (up to the cap)
          let i = sel.length - 1;
          while (i >= fixed && !(teamOf(sel[i]) !== team && n[teamOf(sel[i])] > mins[teamOf(sel[i])])) i--;
          if (i >= fixed) {
            const [out] = sel.splice(i, 1);
            taken.delete(out);
            n[teamOf(out)]--;
          } else if (sel.length >= cap) break;
        }
        put(id);
      }
    }
    const pool = order.fill.filter((id) => !taken.has(id));
    const take = (want, strict) => {
      let i = want ? pool.findIndex((id) => teamOf(id) === want && fits(id)) : -1;
      if (i < 0 && !strict) i = pool.findIndex(fits);
      if (i < 0) return false;
      put(pool.splice(i, 1)[0]);
      return true;
    };
    while (sel.length < size) {
      const d = n.us - n.them;
      if (!take(d >= gap ? 'them' : d <= -gap ? 'us' : null, false)) break;
    }
    while (sel.length < cap && Math.abs(n.us - n.them) > gap) {
      if (!take(n.us > n.them ? 'them' : 'us', true)) break;
    }
    return sel;
  };
  let sel = pick(order.lines);
  // An attacker in the cast ahead of the ball past halfway whom the reduced line would judge differently: the defending
  // team's line setters come in too (§1), the nearest pair that judges everyone in the cast as the full game does (a far
  // keeper only when nothing else holds the line), and the exact pair if the cast they leave still needs it.
  const need = linesNeeded(frame, sel, order.byId, order, P);
  if (!need.size) return sel;
  const fresh = (ids) => ids.filter((id) => !order.lines.includes(id) && !order.must.includes(id));
  const extra = [];
  for (const team of need) {
    const options = setterOptions(frame, team, order.learnerId, P);
    extra.push(...(options.find((pair) => !linesNeeded(frame, [...new Set([...sel, ...pair])], order.byId, order, P).has(team)) ?? options.at(-1)));
  }
  let missing = fresh(extra);
  if (!missing.some((id) => !sel.includes(id))) return sel;
  sel = pick([...order.lines, ...missing]);
  const still = linesNeeded(frame, sel, order.byId, order, P);
  if (still.size) {
    missing = fresh([...new Set([...missing, ...[...still].flatMap((team) => lineSetters(frame, team, order.learnerId, P))])]);
    sel = pick([...order.lines, ...missing]);
  }
  return sel;
}

/** The frame a cast is picked from must hold the learner and an opponent (a stage is a game: never "3 v 0"). */
function checkFrame(frame, learnerId, who) {
  if (!frame?.players?.some((p) => p.id === learnerId)) throw new TypeError(`${who}: the learner ${learnerId} is not in the frame`);
  if (!frame.players.some((p) => p.team === 'them')) throw new TypeError(`${who}: the frame has no opponent`);
}

/**
 * The players to show and score for a stage, most relevant first (§3): the learner; the ball carrier and `clipIds`; the
 * players the drill scripts or names (`keep`: keepIdsOf); the duties (defending, the context's first defender and the
 * learner's mark; the presser on the ball); the offside-line setters when the lesson involves the line (principles
 * F4/B2/P5, the offside, pin or keeps-onside rule weighted 2+, or an attacker in the cast ahead of the ball past halfway
 * whom the reduced line would judge differently) — these are always in, even past the cap (then `fits` is false); then
 * the players the lesson is about (castOrder: the context's second defender and the dangerous attacker when we defend;
 * the opponents in the passing lanes and nearest the ghost and the ball when we attack; the teammate nearest the ghost;
 * the players the rules weighted 2+ cue at the ghost; in the bigger game the learner's unit); then the nearest players to
 * the ghost, the ball and the learner's start, keeping both teams in the game (at least one of theirs, a teammate beside
 * the learner, |ours - theirs| within maxGap). `full` is everyone. It is the first cast a stage tries: stageSpotDrill /
 * stagePassDrill grow it until the gate passes. Throws when the frame has no opponent or the learner is not in it.
 * @param {import('./types.js').Frame} frame  the full frame at the freeze (22 players)
 * @param {{ learnerId: string, base?: {x,y}, ghost?: {x,y}|{spot:{x,y}}, principles?: string[], stage: 'small'|'medium'|'full',
 *   clipIds?: string[], keep?: string[], params?: object, start?: {x,y}, size?: number, ctx?: object, rating?: object,
 *   decisive?: string[] }} opts
 *   base: the learner's base (context duties); ghost: the full game's best spot; principles: the rep's ideas; keep: the
 *   players the drill scripts or names (always in); start: where the learner starts (default: their spot in `frame`);
 *   size: how many to pick (default: the small game its minimum, the bigger game the must and the lesson's players, at
 *   least mediumFrom, within the stage's cap); ctx: the full frame's context when already built; rating: a pass rep's
 *   rating at the freeze (the cast is then ranked receiver by receiver, and our side holds the learner plus minOptions
 *   to maxOptions teammates); decisive: players the answer depends on, ranked first (the stages pass them when the plain
 *   order fails); params: CAST_DEFAULTS overrides
 * @returns {{ ids: string[], label: string, ours: number, theirs: number, fits: boolean }}
 */
export function castFor(frame, opts = {}) {
  const P = P_OF(opts.params);
  const { stage } = opts;
  checkFrame(frame, opts.learnerId, 'castFor');
  if (stage === 'full') return { ids: frame.players.map((p) => p.id), ...castLabel(frame.players.map((p) => p.id), 'full'), fits: true };
  const cap = capOf(stage, P);
  if (!cap) throw new TypeError(`castFor: unknown stage ${stage}`);
  const order = castOrder(frame, opts, P);
  const size = Number.isFinite(opts.size) ? opts.size : defaultSize(order, cap, stage, P);
  const ids = pickCast(frame, order, Math.min(size, cap.max), P, teamsOf(opts.rating, cap, P));
  return { ids, ...castLabel(ids, stage), fits: ids.length <= cap.max && ids.length >= minOf(stage, cap, P) };
}

/** The fewest players a stage shows: the small game its minimum, the bigger game more than any small game (mediumFrom). */
const minOf = (stage, cap, P) => (stage === 'medium' ? Math.max(cap.min, P.mediumFrom) : cap.min);
/** Where a stage's cast starts growing: the small game from its minimum (the smallest cast that teaches the lesson wins),
 *  a bigger game from the must and the lesson's players (the learner's unit and the play around the ball). */
const defaultSize = (order, cap, stage, P) => (stage === 'small' ? cap.min : Math.max(minOf(stage, cap, P), Math.min(cap.max, order.must.length + order.lines.length + order.core.length)));
/** A stage's team limits for pickCast: pass reps show the learner and 3-5 teammates, spot reps a teammate at least. */
const teamsOf = (rating, cap, P) => ({
  ours: rating ? { min: 1 + P.minOptions, max: 1 + P.maxOptions } : { min: P.minOurs, max: Infinity },
  theirs: { min: 1 },
  cap: cap.max,
});

/**
 * Grow a stage's cast until the gate passes (§1): from `from` (default: the stage's starting size) up to its cap, one
 * player at a time (the next most relevant), first keeping the teams within maxGap of each other, then (only if that
 * never passes) by relevance alone (a lesson that needs our whole front line against their back four: 8 v 4). Each cast
 * is tried once. With `prefer`, the first passing cast that also meets it wins, else the first passing cast.
 * @returns {{ ids: string[], g: object, tries: number } | null}
 */
function grow(frame, order, stage, cap, limits, P, gate, trace, seen = new Set(), { from, prefer } = {}) {
  let tries = seen.size, fallback = null;
  const least = minOf(stage, cap, P);
  for (const gap of [P.maxGap, Infinity]) {
    for (let size = from ?? defaultSize(order, cap, stage, P); size <= cap.max; size++) {
      const ids = pickCast(frame, order, size, P, { ...limits, gap });
      const key = ids.join(',');
      if (seen.has(key)) continue;
      if (ids.length > cap.max) {
        // The must and the offside line setters it brings in (linesNeeded) overflow the stage: traced once.
        seen.add(key);
        trace?.push({ stage, size: ids.length, ids, failed: [`the cast needs ${ids.length} players with the offside line (> ${cap.max})`] });
        continue;
      }
      if (ids.length < least || !ids.some((id) => id.startsWith('them-'))) continue;
      seen.add(key);
      tries++;
      const g = gate(ids);
      trace?.push({ stage, size: ids.length, ids, failed: g.failed });
      if (!g.ok) continue;
      if (!prefer || prefer(g)) return { ids, g, tries };
      fallback ??= { ids, g };
    }
  }
  return fallback ? { ...fallback, tries } : null;
}

/** The stage's must (and offside-line setters) alone overflow its cap: no cast of this size can hold them (traced). */
function overflows(order, stage, cap, trace) {
  if (order.must.length + order.lines.length <= cap.max) return false;
  const ids = [...order.must, ...order.lines];
  trace?.push({ stage, size: ids.length, ids, failed: [`the clip, the players the drill scripts or names, the duties and the offside line need ${ids.length} players (> ${cap.max})`] });
  return true;
}

// ---------------------------------------------------------------- spot reps

/** The rule ids of a principle: the catalogue's ruleIds, else the rule registry's. */
function ruleIdsOf(principle, catalogue) {
  const list = Array.isArray(catalogue) ? catalogue : catalogue?.list ?? catalogue?.principles ?? (catalogue?.byId ? Object.values(catalogue.byId) : null);
  const entry = list?.find?.((q) => q?.id === principle) ?? catalogue?.byId?.[principle] ?? (catalogue && !list ? catalogue[principle] : null);
  if (Array.isArray(entry?.ruleIds)) return entry.ruleIds.filter((id) => RULES_BY_ID[id]);
  return RULES.filter((r) => r.principles.includes(principle)).map((r) => r.id);
}

/**
 * The rule the gate holds a staged rep to (§1 "the rep's primary principle's rule is weighted 2+ with s 0.9+ at the
 * ghost"): the primary principle's rules, weighted `minRuleWeight`+ at the staged ghost when one of them is weighted 2+
 * and met (0.9+) at the full game's ghost; when the primary's rule is met there but weighs less (R3's screen x 1), at
 * least that weight (the staged game keeps it as active as the full game). A primary with no rule in the catalogue
 * (T2, T3, U3, U6, U7, U8, R1, R2, B6 and P1 are taught by the scene, not by one rule) cannot be held by a rule: then the
 * drill's next idea that has a rule met at the full game's ghost, else the heaviest rule met there (primary false). A
 * primary whose rules are not met at all at the full game's answer is `unmet` (npm run check reports it). null: nothing
 * to hold. Every staged rep is also held to the full game's praise at the answer (praiseOf), so the kid hears the same
 * lesson whichever rule is held. Player mode's right area (kidscore.js kidArea's `lesson`) reads the same lesson for its
 * lesson keys: play.js takes it from the staged rep (`.lesson`), or calls this for a rep it judges on the full game.
 * @param {string[]} principles  the drill's principles (first = primary)
 * @param {object} result  evaluate() at the full game's best spot (ghost.result)
 * @param {object} [catalogue]  data/principles.json (any form validateScenario accepts); default: the rule registry
 * @param {object} [P]  CAST_DEFAULTS (or overrides)
 * @returns {null | { principle, rules, primary: boolean, minWeight: number, unmet?: true }}
 */
export function lessonOf(principles, result, catalogue, P = CAST_DEFAULTS) {
  const met = (r, w) => atLeast(r.weight, w) && atLeast(r.s, P.minRuleScore);
  const [primary] = principles ?? [];
  let unmet = false;
  if (primary) {
    const ids = ruleIdsOf(primary, catalogue);
    if (ids.length) {
      if (result.rules.some((r) => ids.includes(r.id) && met(r, P.minRuleWeight))) return { principle: primary, rules: ids, primary: true, minWeight: P.minRuleWeight };
      const light = result.rules.filter((r) => ids.includes(r.id) && r.weight > 0 && atLeast(r.s, P.minRuleScore)).sort((a, b) => b.weight - a.weight)[0];
      if (light) return { principle: primary, rules: ids, primary: true, minWeight: light.weight };
      unmet = true;
    }
  }
  for (const p of (principles ?? []).slice(1)) {
    const ids = ruleIdsOf(p, catalogue);
    if (ids.length && result.rules.some((r) => ids.includes(r.id) && met(r, P.minRuleWeight))) return { principle: p, rules: ids, primary: false, minWeight: P.minRuleWeight, ...(unmet ? { unmet } : {}) };
  }
  const top = result.rules.filter((r) => met(r, P.minRuleWeight)).sort((a, b) => b.weight - a.weight || b.s - a.s)[0];
  return top ? { principle: top.principles[0], rules: [top.id], primary: false, minWeight: P.minRuleWeight, ...(unmet ? { unmet } : {}) } : null;
}

/**
 * The rules whose praise the kid hears at a 3-star answer (js/ui/player/play.js praiseOf, pickLine and whyFor: the rules
 * met at explain's praiseAt with a kid sentence, heaviest first, the drill's own ideas first): the first `depth` of them,
 * space-separated (the line, then the Why? sheet's praise). null: no praise (the stock line).
 */
function praiseRuleOf(result, own = [], depth = 1) {
  const said = (r) => { try { return !!String(RULES_BY_ID[r.id]?.text?.kid?.ok?.(r.vars ?? {}) ?? '').trim(); } catch { return false; } };
  const list = (result?.rules ?? []).filter((r) => !r.critical && atLeast(r.s, EXPLAIN_DEFAULTS.praiseAt) && said(r)).sort((a, b) => b.weight - a.weight || b.s - a.s);
  const mine = (r) => own.length > 0 && [...(r.principles ?? []), ...(RULES_BY_ID[r.id]?.principles ?? [])].some((id) => own.includes(id));
  const ordered = [...list.filter(mine), ...list.filter((r) => !mine(r))].map((r) => r.id);
  return depth === 1 ? ordered[0] ?? null : ordered.slice(0, depth).join(' ') || null;
}

/** The full game's judging scene of a spot rep (ARCHITECTURE §5.3 "Judging a drill"), shared by every stage. */
function prepareSpot(scenario, { formations, principles: catalogue, params } = {}) {
  if (!formations?.us) throw new TypeError('stageSpotDrill: formations.us is required');
  const P = P_OF(params);
  const s = normalizeScenario(scenario);
  const { freezeAt: t } = timing(s);
  const learnerId = learnerIdOf(s);
  const frame = frameAt(s, t, { formations });
  checkFrame(frame, learnerId, 'stageSpotDrill');
  const base = learnerBaseAt(s, t, { formations });
  const ctx = buildContext(frame, { learnerId, base });
  const tol = toleranceFor(s.learner.role, s.answer?.tol);
  const centre = s.answer?.mode === 'authored' && s.answer.ideal ? { x: s.answer.ideal.x, y: s.answer.ideal.y } : base;
  const ghost = computeGhost(ctx, { base: centre, tol });
  const start = s.learner.start
    ? { x: s.learner.start.x, y: s.learner.start.y }
    : (({ x, y }) => ({ x, y }))(frameAt(s, 0, { formations }).players.find((p) => p.id === learnerId));
  const clipIds = clipIdsOf(s, { formations, params });
  const keep = keepIdsOf(s, frame, { learnerId, base, clipIds, params });
  const lesson = lessonOf(s.principles, ghost.result, catalogue, P);
  const praise = praiseRuleOf(ghost.result, s.principles, P.praiseDepth);
  const hold = s.answer?.hold === true;
  const still = evaluate(ctx, start, { center: centre, tol }).score;
  return { P, s, t, learnerId, frame, base, ctx, tol, centre, ghost, start, clipIds, keep, lesson, praise, hold, still, decisive: null };
}

/**
 * Player mode's right area of a staged rep (kidscore.js kidArea, round its best spot on its reduced frame) and the stars
 * it gives standing still and the best spot: { area, start, best } (a hold drill has no start cap: its start is not gated).
 */
function kidOf(prep, ctx, best, stage) {
  const area = kidArea(ctx, { best, centre: prep.centre, tol: prep.tol, start: prep.start, hold: prep.hold, stage, lesson: prep.lesson, misconceptions: prep.s.misconceptions });
  return { area, start: kidStars(ctx, prep.start, area).stars, best: kidStars(ctx, best, area).stars };
}

/**
 * The gate on one cast (§1, spot reps): on the reduced frame at the freeze, the learner has the full game's duty, first
 * defender and mark; the lesson's rule weighs its minWeight+ and scores 0.9+ at the ghost; standing still at the start
 * scores below stillMax (unless the drill is an authored "hold" drill); the ghost scores S and is within sameAnswer of
 * the full game's, and the full game's answer scores S here too (a 3-star answer in both games); and the kid is praised
 * at the answer for the same rules as in the full game (praiseDepth deep: the reveal's line and the Why? sheet); and in
 * Player mode's right area (kidscore.js, round the staged best spot) standing still earns no stars (unless a hold drill)
 * and the best spot 3. The cheap checks come first (a failed try skips the ghost). Every comparison fails on NaN.
 */
function spotGate(prep, ids, stage) {
  const { P, learnerId, base, centre, tol, lesson } = prep;
  const frame = reduceFrame(prep.frame, ids);
  const ctx = buildContext(frame, { learnerId, base });
  const failed = [];
  const out = { ok: false, ghostScore: null, sameAnswer: null, rule: null, startScore: null, hold: prep.hold, fullAnswerScore: null, praise: null, kidStart: null, kidBest: null, failed, frame, ctx, ghost: null, area: null };
  // The learner's job is the full game's: the same duty, the same first defender and the same player to mark.
  const who = (p) => p?.id ?? null;
  const job = [['duty', ctx.duty, prep.ctx.duty], ['first defender', who(ctx.firstDefender), who(prep.ctx.firstDefender)], ['mark', who(ctx.markTarget), who(prep.ctx.markTarget)]]
    .filter(([, a, b]) => a !== b);
  if (job.length) {
    failed.push(`the learner's ${job.map(([k, a, b]) => `${k} is ${a ?? 'nobody'} here, ${b ?? 'nobody'} in the full game`).join('; ')}`);
    return out;
  }
  if (lesson && !lesson.rules.some((id) => atLeast(RULES_BY_ID[id].weight(ctx), lesson.minWeight))) {
    failed.push(`no rule of ${lesson.principle} (${lesson.rules.join(', ')}) weighs ${lesson.minWeight}+`);
    return out;
  }
  out.startScore = evaluate(ctx, prep.start, { center: centre, tol }).score;
  if (!prep.hold && !below(out.startScore, P.stillMax)) {
    failed.push(`standing still scores ${out.startScore} (not below ${P.stillMax})`);
    return out;
  }
  const ghost = computeGhost(ctx, { base: centre, tol });
  out.ghost = ghost;
  out.ghostScore = ghost.score;
  out.sameAnswer = Math.round(dist(ghost.spot, prep.ghost.spot) * 100) / 100;
  if (lesson) {
    const r = ghost.result.rules.filter((q) => lesson.rules.includes(q.id)).sort((a, b) => b.weight * b.s - a.weight * a.s)[0];
    out.rule = r ? { id: r.id, principle: lesson.principle, weight: r.weight, s: Math.round(r.s * 1000) / 1000 } : null;
    if (!r || !atLeast(r.weight, lesson.minWeight) || !atLeast(r.s, P.minRuleScore)) failed.push(`${lesson.principle}'s rule is not met at the ghost (${r ? `${r.id} ${r.s.toFixed(2)} x ${r.weight}` : 'none applies'})`);
  }
  if (!atLeast(ghost.score, P.minGhostScore)) failed.push(`the best spot scores ${ghost.score} (< ${P.minGhostScore})`);
  if (!(out.sameAnswer <= P.sameAnswer)) failed.push(`the best spot is ${out.sameAnswer.toFixed(1)} m from the full game's (> ${P.sameAnswer} m)`);
  out.fullAnswerScore = evaluate(ctx, prep.ghost.spot, { center: centre, tol }).score;
  if (!atLeast(out.fullAnswerScore, P.minGhostScore)) failed.push(`the full game's best spot scores ${out.fullAnswerScore} here (< ${P.minGhostScore})`);
  out.praise = praiseRuleOf(ghost.result, prep.s.principles, P.praiseDepth);
  if (out.praise !== prep.praise) failed.push(`the answer is praised for ${out.praise ?? 'nothing'} here, ${prep.praise ?? 'nothing'} in the full game`);
  const kid = kidOf(prep, ctx, ghost.spot, stage);
  out.area = kid.area; out.kidStart = kid.start; out.kidBest = kid.best;
  if (!prep.hold && kid.start !== 0) failed.push(`standing still earns ${kid.start} stars in Player mode (not 0)`);
  if (kid.best !== 3) failed.push(`the best spot earns ${kid.best} stars in Player mode (not 3)`);
  out.ok = !failed.length;
  return out;
}

/** The staged result of a prepared spot rep, or null (the cast grows one player at a time up to the stage's cap). */
function stageSpot(prep, stage, trace) {
  const { P, s, t, learnerId, base, tol, centre, start, clipIds } = prep;
  const shared = { kind: 'spot', base, tol, centre, t, start, learnerId, clipIds, keep: [...prep.keep.ids], lesson: prep.lesson, hold: prep.hold,
    misconceptions: s.misconceptions ?? [], fullGhost: { spot: { ...prep.ghost.spot }, score: prep.ghost.score } };
  if (stage === 'full') {
    // The full match always passes; Player mode's stars at the start and the best spot are reported (npm run check fails
    // an authored drill on them, spotdrill.js a generated one).
    const ids = prep.frame.players.map((p) => p.id);
    const r = prep.ghost.result.rules.filter((q) => prep.lesson?.rules.includes(q.id)).sort((a, b) => b.weight * b.s - a.weight * a.s)[0];
    const kid = kidOf(prep, prep.ctx, prep.ghost.spot, 'full');
    const gates = { ok: true, ghostScore: prep.ghost.score, sameAnswer: 0, startScore: prep.still, hold: prep.hold, fullAnswerScore: prep.ghost.score, praise: prep.praise,
      kidStart: kid.start, kidBest: kid.best, tries: 0, failed: [],
      rule: r ? { id: r.id, principle: prep.lesson.principle, weight: r.weight, s: Math.round(r.s * 1000) / 1000 } : null };
    return { stage, cast: { ids, ...castLabel(ids, 'full') }, ghost: prep.ghost, gates, frame: prep.frame, ctx: prep.ctx, area: kid.area, ...shared };
  }
  const cap = capOf(stage, P);
  if (!cap) throw new TypeError(`stageSpotDrill: unknown stage ${stage}`);
  const orderOf = (decisive) => castOrder(prep.frame, { learnerId, base, ghost: prep.ghost.spot, principles: s.principles, stage, clipIds, keep: prep.keep.ids, start, ctx: prep.ctx, decisive }, P);
  const order = orderOf([]);
  if (overflows(order, stage, cap, trace)) return null;
  const seen = new Set();
  const limits = teamsOf(null, cap, P);
  let found = grow(prep.frame, order, stage, cap, limits, P, (ids) => spotGate(prep, ids, stage), trace, seen);
  if (!found) {
    // The plain order failed: rank first the players the full game's answer depends on, and grow again.
    prep.decisive ??= decisiveIds(prep.frame, { learnerId, base, centre, tol, start, skip: new Set(order.must), ghost: prep.ghost.spot, still: prep.still }, P);
    // (From the stage's fewest players: the decisive players first may teach it in a smaller cast than the plain order;
    // with none, the plain order again from there, since a bigger game starts growing at its lesson's players.)
    found = grow(prep.frame, orderOf(prep.decisive), stage, cap, limits, P, (ids) => spotGate(prep, ids, stage), trace, seen, { from: minOf(stage, cap, P) });
  }
  if (!found && !prep.hold) {
    // Still failing: standing still may look fine in a smaller game (the teammates whose line or spacing the start
    // spoils are hidden). Rank first the players who bring it back below stillMax, and grow once more.
    const fix = stillIds(prep, [...order.must, ...order.lines], cap, P);
    if (fix.length) found = grow(prep.frame, orderOf([...fix, ...(prep.decisive ?? [])]), stage, cap, limits, P, (ids) => spotGate(prep, ids, stage), trace, seen, { from: minOf(stage, cap, P) });
  }
  if (!found) return null;
  const { ids, g, tries } = found;
  const gates = { ok: true, ghostScore: g.ghostScore, sameAnswer: g.sameAnswer, rule: g.rule, startScore: g.startScore, hold: g.hold, fullAnswerScore: g.fullAnswerScore, praise: g.praise,
    kidStart: g.kidStart, kidBest: g.kidBest, tries, failed: [] };
  return { stage, cast: { ids, ...castLabel(ids, stage) }, ghost: g.ghost, gates, frame: g.frame, ctx: g.ctx, area: g.area, ...shared };
}

/**
 * A "Find your spot" rep at a stage, judged on its reduced frame; null when this stage cannot teach it (the gate
 * failed even after growing the cast to the stage's cap). `full` always passes (the full game as today).
 * @param {object} scenario  an authored or generated scenario (normalised or not; mirror it first for the other side)
 * @param {'small'|'medium'|'full'} stage
 * @param {{ formations: {us:object, them?:object}, principles?: object, params?: object, trace?: object[] }} opts
 *   principles: the catalogue (data/principles.json, any form validateScenario accepts) for each idea's ruleIds (default:
 *   the rule registry's); params: CAST_DEFAULTS overrides; trace: collects { stage, size, ids, failed } for every cast tried
 * @returns {null | { stage, kind: 'spot', cast: { ids, label, ours, theirs }, ghost, base, tol, centre, gates, frame, ctx,
 *   t, start, learnerId, clipIds, keep, lesson: { principle, rules, primary, minWeight, unmet? } | null, hold, misconceptions,
 *   area, fullGhost: { spot, score } }}
 *   ghost: computeGhost on the reduced frame (round `centre`: the base, or answer.ideal in authored mode); frame and ctx:
 *   the reduced freeze frame and its context (drop-in for play.js repScene's freezeFrame and ctx: judgeSpot({ ctx, ghost },
 *   spot) judges on the cast only); keep: the players the drill scripts or names (always in the cast); gates: { ok,
 *   ghostScore, sameAnswer (m from the full game's ghost), rule: { id, principle, weight, s } | null, startScore, hold,
 *   fullAnswerScore (the full game's best spot, scored here), praise (the rules praised at the answer, space-separated: the line and the Why?),
 *   kidStart, kidBest (Player mode's stars standing still and at the best spot: 0 and 3 for a staged game; reported for the full match), tries, failed: [] };
 *   lesson: the rule the gate holds (lessonOf); hold: answer.hold; misconceptions: the scenario's; area: Player mode's right
 *   area round the staged best spot (kidscore.js kidArea with the defaults, this stage's scale)
 */
export function stageSpotDrill(scenario, stage, opts = {}) {
  return stageSpot(prepareSpot(scenario, opts), stage, opts.trace);
}

// ---------------------------------------------------------------- pass reps

/** The full game's scene of a pass rep: the freeze frame (nobody held back), the rating, the clip, what each tap earns. */
function preparePass(drill, { formations, params } = {}) {
  if (!formations?.us) throw new TypeError('stagePassDrill: formations.us is required');
  const P = P_OF(params);
  const { freezeAt: t } = timing(drill);
  const learnerId = learnerIdOf(drill);
  const frame = passDrillFrame(drill, t, { formations });
  checkFrame(frame, learnerId, 'stagePassDrill');
  const rating = drill.rating?.best ? drill.rating : passDrillRating(drill, { formations });
  const clipIds = clipIdsOf(drill, { formations, params });
  const keep = keepIdsOf(drill, frame, { learnerId, clipIds, params });
  const best = rating.options.find((o) => o.id === drill.answer?.best) ?? rating.best;
  // The drill's lesson (its first idea) when the full game's rating teaches it: a staged cast that keeps it is preferred.
  const lesson = drill.principles?.find((p) => passLessons(rating, [p]).length) === drill.principles?.[0] ? drill.principles[0] : null;
  // What a tap on each receiver earns in the full game (a staged game never makes a lesser pass a 3-star one).
  const accept = drill.answer?.accept ?? [];
  const fullTaps = receiversOf(rating.options, learnerId);
  const fullStars = new Map([...fullTaps].map(([rid, o]) => [rid, gradePass(rating, o.id, { accept })?.stars ?? 0]));
  const fullTargets = targetsOf(fullTaps, frame, P);
  return { P, drill, t, learnerId, frame, rating, clipIds, keep, best, lesson, fullTaps, fullStars, fullTargets, passParams: drill.params?.pass };
}

/** The drill's accepted answers that the staged rating still offers, to a receiver in the cast. */
const acceptIn = (drill, rating, ids) => (drill.answer?.accept ?? []).filter((id) => rating.options.some((o) => o.id === id) && ids.includes(id.replace(/@.*$/, '')));

/**
 * The gate on one cast (§1, pass reps), judged receiver by receiver as a tap plays it (pass.js optionsByReceiver and
 * passTargets): 3-5 receivers a tap can pick, all of them ones the full game offers too; the best receiver is the full
 * game's, and its pass is not one the full game rates risky, cut out, offside or dangerous; a real choice: another
 * receiver's pass is risky, cut out, offside or dangerous, or the best leads every other receiver by passMargin, and at
 * least one other receiver earns less than 3 stars; no receiver earns 3 stars here whom the full game grades passNoRise
 * stars or fewer; and every receiver's offside call is the full game's.
 */
function passGate(prep, ids) {
  const { P, learnerId } = prep;
  const frame = reduceFrame(prep.frame, ids);
  const failed = [];
  const out = { ok: false, best: null, fullBest: prep.best.id, choice: null, margin: null, options: 0, targets: [], lesson: null, failed, frame, rating: null };
  let rating;
  try { rating = rateOptions(frame, learnerId, prep.passParams); } catch (err) { failed.push(err.message); return out; }
  out.rating = rating;
  out.best = rating.best.id;
  const taps = targetsOf(receiversOf(rating.options, learnerId), frame, P);
  out.options = taps.size;
  out.targets = [...taps.keys()];
  if (!(taps.size >= P.minOptions && taps.size <= P.maxOptions)) failed.push(`${taps.size} teammates to pass to (not ${P.minOptions}-${P.maxOptions})`);
  const extra = out.targets.filter((rid) => !prep.fullTargets.has(rid));
  if (extra.length) failed.push(`${extra.join(', ')} can be picked here but not in the full game`);
  const bestRid = rating.best.targetId;
  if (bestRid !== prep.best.targetId) failed.push(`the best pass goes to ${bestRid}, not ${prep.best.targetId}`);
  const asFull = prep.rating.options.find((o) => o.id === rating.best.id);
  if (asFull && BAD_LABELS.has(asFull.label)) failed.push(`the best pass here (${rating.best.id}) is ${asFull.label} in the full game`);
  const accept = acceptIn(prep.drill, rating, ids);
  const PP = rating.params ?? PASS_DEFAULTS;
  const effective = (o) => (o.tags.some((q) => q.tag === 'too-safe') ? Math.min(o.score, PP.tooSafeCap) : o.score);
  const others = [...taps].filter(([rid]) => rid !== bestRid);
  const judged = others.map(([, o]) => o).filter((o) => !accept.includes(o.id));
  out.margin = rating.best.score - Math.max(0, ...judged.map(effective));
  out.choice = judged.some((o) => BAD_LABELS.has(o.label)) ? 'wrong-option' : out.margin >= P.passMargin ? 'clear-best' : null;
  if (!out.choice) failed.push(`no real choice: every other receiver's pass is good and the best leads by ${out.margin} (< ${P.passMargin})`);
  const stars = new Map(others.map(([rid, o]) => [rid, gradePass(rating, o.id, { accept })?.stars ?? 0]));
  if (others.length && ![...stars.values()].some((n) => n < 3)) failed.push('every teammate you can pick earns 3 stars');
  const rise = [...stars].filter(([rid, n]) => n === 3 && (prep.fullStars.get(rid) ?? 0) <= P.passNoRise).map(([rid]) => `${rid} (${prep.fullStars.get(rid) ?? 0} in the full game)`);
  if (rise.length) failed.push(`3 stars here for ${rise.join(', ')}`);
  const flips = [...taps].filter(([rid, o]) => prep.fullTaps.has(rid) && !!prep.fullTaps.get(rid).offside !== !!o.offside).map(([rid]) => rid);
  if (flips.length) failed.push(`offside is called differently for ${flips.join(', ')}`);
  out.lesson = prep.lesson ? passLessons(rating, [prep.lesson]).length > 0 : null;
  out.ok = !failed.length;
  return out;
}

// ---- a compact cast (a pass rep's smaller games: the camera fits the cast, so the figures are big)

/** The drawn extent of some points (metres, along x and across y) and how far it spills over `box`. */
function extentOf(points, box) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  if (!(x1 >= x0)) return { along: 0, across: 0, over: 0 };
  const along = x1 - x0, across = y1 - y0;
  return { along, across, over: Math.max(across / box.across, along / box.along) };
}

/**
 * How big a cast is drawn at the freeze: the players `ids` in `frame` and the ball (what "Who's open?"'s choice frames,
 * pass.js chooseCamera), along the pitch (x) and across it (y), in metres, and how far that spills over `box`:
 * over = max(across / box.across, along / box.along), 1 or less when it fits. The camera fits the cast on both axes, so
 * the smaller `over`, the closer it zooms in and the bigger the figures (a phone held upright: CAST_DEFAULTS.passBox).
 * @param {import('./types.js').Frame} frame
 * @param {Iterable<string>} ids
 * @param {{ along: number, across: number }} [box]
 * @returns {{ along: number, across: number, over: number }}
 */
export function castExtent(frame, ids, box = CAST_DEFAULTS.passBox) {
  const keep = ids instanceof Set ? ids : new Set(ids);
  return extentOf([...(frame?.players ?? []).filter((p) => keep.has(p.id)), frame?.ball], box);
}

/**
 * The compact order of a pass rep's cast: the must, the line setters and the best receiver with the defenders on his
 * pass first, as castOrder has them; then everyone else by how far each alone would spread those past passBox (not at
 * all first), ties in castOrder's order (the most relevant of the players who fit first: the tempting decoy nearby, not
 * the one at the far touchline).
 */
function compactOrder(frame, order, P) {
  const pos = (id) => order.byId.get(id);
  const anchor = [...order.must, ...order.lines, ...order.core.slice(0, order.lead)].map(pos);
  anchor.push(frame.ball);
  const base = extentOf(anchor, P.passBox).over;
  const rank = (ids) => ids.map((id, i) => ({ id, i, s: Math.max(0, extentOf([...anchor, pos(id)], P.passBox).over - base) }))
    .sort((a, b) => a.s - b.s || a.i - b.i).map((e) => e.id);
  return { ...order, core: [...order.core.slice(0, order.lead), ...rank(order.core.slice(order.lead))], fill: rank(order.fill) };
}

/** The cast with the offside-line setters it needs (pickCast's rule: the nearest pair that judges everyone in it as the full game does). */
function withLineSetters(frame, ids, order, P) {
  const need = linesNeeded(frame, ids, order.byId, order, P);
  if (!need.size) return ids;
  const extra = [];
  for (const team of need) {
    const options = setterOptions(frame, team, order.learnerId, P);
    extra.push(...(options.find((pair) => !linesNeeded(frame, [...new Set([...ids, ...pair])], order.byId, order, P).has(team)) ?? options.at(-1)));
  }
  const out = [...new Set([...ids, ...extra])];
  const still = linesNeeded(frame, out, order.byId, order, P);
  return still.size ? [...new Set([...out, ...[...still].flatMap((team) => lineSetters(frame, team, order.learnerId, P))])] : out;
}

/**
 * The small game's compact search (pass reps): the must, the line setters and the best receiver with the defenders on
 * his pass, plus any of the other receivers a tap can pick (each with the defenders on his pass) and of the defenders
 * nearest the ball (as many as the stage holds): every such cast within the stage with the learner and 3-5 teammates and
 * an opponent (the offside setters added as pickCast adds them), judged most compact first (castExtent, in steps of
 * passBoxSlack), then teams within maxGap, fewer players, the more relevant (castOrder's order). The first that passes
 * the gate and teaches the drill's lesson wins, else the first that passes; at most passSearch casts are judged. A
 * teammate it adds is one the kid can pick in it (never a decoy nobody can take).
 * @returns {{ ids: string[], g: object } | null}
 */
function compactSearch(prep, order, stage, cap, P, gate, trace) {
  const { frame } = prep;
  const fixed = [...new Set([...order.must, ...order.lines, ...order.bestUnit])];
  if (fixed.length > cap.max) return null;
  const inFixed = new Set(fixed);
  const aim = prep.best?.point ?? frame.ball;
  const near = frame.players.filter((p) => p.team === 'them' && !inFixed.has(p.id)).sort(closer(frame.ball, aim)).slice(0, cap.max).map((p) => [p.id]);
  const units = [...order.units.map((u) => u.filter((id) => !inFixed.has(id))).filter((u) => u.length), ...near];
  const relevance = new Map([...order.must, ...order.lines, ...order.core, ...order.fill].map((id, i) => [id, i]));
  const byRelevance = (a, b) => (relevance.get(a) ?? Infinity) - (relevance.get(b) ?? Infinity);
  const teamOf = (id) => order.byId.get(id)?.team;
  const casts = [], tried = new Set(), seen = new Set();
  const consider = (base, rel) => {
    const was = [...base].sort().join(',');
    if (tried.has(was)) return;
    tried.add(was);
    const ids = withLineSetters(frame, base, order, P).sort(byRelevance);
    const key = [...ids].sort().join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const ours = ids.filter((id) => teamOf(id) === 'us').length, theirs = ids.filter((id) => teamOf(id) === 'them').length;
    if (ids.length < cap.min || ids.length > cap.max || ours < 1 + P.minOptions || ours > 1 + P.maxOptions || theirs < 1) return;
    const step = Math.floor(castExtent(frame, ids, P.passBox).over / P.passBoxSlack + 1e-9);
    casts.push({ ids, key, step, lopsided: Math.abs(ours - theirs) > P.maxGap ? 1 : 0, rel });
  };
  const walk = (from, ids, rel) => {
    for (let j = from; j < units.length; j++) {
      const next = [...new Set([...ids, ...units[j]])];
      if (next.length === ids.length || next.length > cap.max) continue; // adds nobody (reached the other way), or too many
      consider(next, rel + j);
      walk(j + 1, next, rel + j);
    }
  };
  consider(fixed, 0);
  walk(0, fixed, 0);
  casts.sort((a, b) => a.step - b.step || a.lopsided - b.lopsided || a.ids.length - b.ids.length || a.rel - b.rel || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let fallback = null;
  for (const c of casts.slice(0, P.passSearch)) {
    const g = gate(c.ids);
    trace?.push({ stage, size: c.ids.length, ids: c.ids, failed: g.failed });
    if (!g.ok || !c.ids.every((id) => inFixed.has(id) || teamOf(id) !== 'us' || g.targets.includes(id))) continue;
    if (g.lesson !== false) return { ids: c.ids, g };
    fallback ??= { ids: c.ids, g };
  }
  return fallback;
}

/**
 * The cast a pass rep's smaller game plays, from the ones found (the plain relevance order's, the compact order's and the
 * compact search's, in that order): those that teach the drill's lesson when any does, then the most compact (castExtent
 * over passBox), the earlier one within passBoxSlack of it.
 */
function mostCompact(found, frame, P) {
  const list = found.filter(Boolean).map((r) => ({ ...r, over: castExtent(frame, r.ids, P.passBox).over }));
  const pool = list.some((r) => r.g.lesson !== false) ? list.filter((r) => r.g.lesson !== false) : list;
  const least = Math.min(...pool.map((r) => r.over));
  return pool.find((r) => r.over <= least + P.passBoxSlack) ?? null;
}

/**
 * The staged result of a prepared pass rep, or null. A smaller game takes, among the casts that pass the gate (the
 * plain relevance order's first, the compact order's first and, in the small game, the compact search's), the one that
 * teaches the drill's lesson and is drawn most compact (mostCompact): the camera fits the cast, so on a phone a cast
 * across the whole pitch drew its figures no bigger than the full match's. Every cast is judged once (`tries`).
 */
function stagePass(prep, stage, trace) {
  const { P, drill, t, learnerId, clipIds } = prep;
  const shared = { kind: 'pass', t, learnerId, clipIds, keep: [...prep.keep.ids], fullBest: prep.best.id };
  if (stage === 'full') {
    const ids = prep.frame.players.map((p) => p.id);
    const gates = { ok: true, best: prep.best.id, fullBest: prep.best.id, choice: null, margin: null, options: prep.fullTargets.size, targets: [...prep.fullTargets.keys()], lesson: prep.lesson ? true : null, tries: 0, failed: [], extent: castExtent(prep.frame, ids, P.passBox) };
    return { stage, cast: { ids, ...castLabel(ids, 'full') }, rating: prep.rating, answer: { best: drill.answer?.best ?? prep.rating.best.id, accept: drill.answer?.accept ?? [] }, gates, frame: prep.frame, ...shared };
  }
  const cap = capOf(stage, P);
  if (!cap) throw new TypeError(`stagePassDrill: unknown stage ${stage}`);
  const order = castOrder(prep.frame, { learnerId, stage, clipIds, keep: prep.keep.ids, rating: prep.rating }, P);
  if (overflows(order, stage, cap, trace)) return null;
  const from = stage === 'medium' ? Math.max(minOf(stage, cap, P), Math.min(cap.max, P.passMediumFrom)) : cap.min;
  // Every cast is judged once, whichever way it was reached (and traced once).
  const judged = new Map(), traced = new Set();
  const keyOf = (ids) => [...ids].sort().join(',');
  const gate = (ids) => { const k = keyOf(ids); if (!judged.has(k)) judged.set(k, passGate(prep, ids)); return judged.get(k); };
  const log = trace && { push: (e) => { const k = keyOf(e.ids ?? []); if (!traced.has(k)) { traced.add(k); trace.push(e); } } };
  const limits = teamsOf(prep.rating, cap, P);
  const teaches = (g) => g.lesson !== false;
  const plain = grow(prep.frame, order, stage, cap, limits, P, gate, log, new Set(), { from, prefer: teaches });
  const compact = P.passCompact ? grow(prep.frame, compactOrder(prep.frame, order, P), stage, cap, limits, P, gate, log, new Set(), { from, prefer: teaches }) : null;
  const search = P.passCompact && stage === 'small' ? compactSearch(prep, order, stage, cap, P, gate, log) : null;
  const found = mostCompact([plain, compact, search], prep.frame, P);
  if (!found) return null;
  const { ids, g } = found;
  const gates = { ok: true, best: g.best, fullBest: g.fullBest, choice: g.choice, margin: g.margin, options: g.options, targets: g.targets, lesson: g.lesson, tries: judged.size, failed: [], extent: castExtent(prep.frame, ids, P.passBox) };
  return { stage, cast: { ids, ...castLabel(ids, stage) }, rating: g.rating, answer: { best: g.rating.best.id, accept: acceptIn(drill, g.rating, ids) }, gates, frame: g.frame, ...shared };
}

/**
 * A "Who's open?" rep at a stage, rated on its reduced frame; null when this stage cannot teach it. `full` always passes
 * (the drill's own rating and answer).
 * @param {object} drill  a pass drill (passdrill.js; mirror it with mirrorPassDrill first for the other side)
 * @param {'small'|'medium'|'full'} stage
 * @param {{ formations: {us:object, them?:object}, params?: object, trace?: object[] }} opts
 * @returns {null | { stage, kind: 'pass', cast: { ids, label, ours, theirs }, rating, answer: { best, accept }, gates,
 *   frame, t, learnerId, clipIds, keep, fullBest }}
 *   rating: rateOptions on the reduced freeze frame (drop-in for drill.rating: gradePass(rating, choiceId, { accept:
 *   answer.accept }) and explainPass(rating, choiceId, { accept: answer.accept, focus: drill.principles })); answer.best:
 *   that rating's best option id (the same receiver as the full game's); gates: { ok, best, fullBest, choice:
 *   'wrong-option'|'clear-best'|null, margin, options (receivers a tap can pick), targets (their ids), lesson, tries, failed: [] }
 */
export function stagePassDrill(drill, stage, opts = {}) {
  return stagePass(preparePass(drill, opts), stage, opts.trace);
}

// ---------------------------------------------------------------- the stage a rep is played at

/**
 * The staged result at `wanted`, or at the next bigger stage that passes; never null (the full match always passes).
 * The full game's scene is worked out once for all the stages tried. A missing or unknown `wanted` asks for the full match.
 * @param {object} item  a scenario, a pass drill (kind 'pass'), or a Road rep ({ kind: 'spot', scenario } | { kind: 'pass', drill })
 * @param {'small'|'medium'|'full'} wanted
 * @param {{ formations, principles?, params?, trace? }} opts  as stageSpotDrill / stagePassDrill
 * @returns {object} stageSpotDrill's or stagePassDrill's result, plus `wanted` (the stage asked for)
 */
export function bestStage(item, wanted, opts = {}) {
  const thing = item?.scenario ?? item?.drill ?? item;
  const isPass = thing?.kind === 'pass' || thing?.answer?.mode === 'pass';
  const from = STAGES.includes(wanted) ? STAGES.indexOf(wanted) : STAGES.length - 1;
  const prep = isPass ? preparePass(thing, opts) : prepareSpot(thing, opts);
  const run = isPass ? stagePass : stageSpot;
  for (const stage of STAGES.slice(from)) {
    const r = run(prep, stage, opts.trace);
    if (r) return { ...r, wanted: STAGES[from] };
  }
  return null; // unreachable: the full match always passes
}

/**
 * Every stage of a rep at once (the full game's scene worked out once): { small, medium, full }, each the staged result or
 * null (full never is). For reports and checks (npm run check prints which stages each authored drill passes).
 * @param {object} item  as bestStage
 * @param {{ formations, principles?, params?, trace? }} opts
 * @returns {{ small: object|null, medium: object|null, full: object }}
 */
export function stagesOf(item, opts = {}) {
  const thing = item?.scenario ?? item?.drill ?? item;
  const isPass = thing?.kind === 'pass' || thing?.answer?.mode === 'pass';
  const prep = isPass ? preparePass(thing, opts) : prepareSpot(thing, opts);
  const run = isPass ? stagePass : stageSpot;
  return Object.fromEntries(STAGES.map((stage) => [stage, run(prep, stage, opts.trace)]));
}
