// Player mode's judgement: the right AREA, not an exact point. The owner's play-test (2026-09-29) found the kids'
// drills far too strict on where a player had to stand to be "right": 3 m off the best spot earned 3 stars in 40 % of
// directions, and kids start about 15 m away on a phone board of about 5 px/m (a fingertip covers about 9 m). Coach mode
// keeps score.js evaluate(), ghost.js and explain.js exactly as they are; this module only reads them.
// Contract: docs/ARCHITECTURE.md §5.18.
//
// DISTANCE is the area's job; RELATIONSHIPS (which side, which order, which line) are the key constraints'.
//   kidArea(ctx, opts)              once per rep (or Match day sample): an axis-aligned ellipse round the best spot, its
//                                   semi-axes the rep's zone tolerance (toleranceFor(role, answer.tol)) clamped to
//                                   [floor, ceil] and scaled by the stage (a phone draws the full match smaller); the
//                                   2-star band grow2 m wider, the 1-star band grow1 m; toward the start each band is cut
//                                   at capFrac of the start-to-best distance (it never reaches the start)
//   kidStars(ctx, spot, area)       per spot (a few µs): 3 stars only in the green (band 3); outside it never fewer than
//                                   Coach mode's stars, up to Great; standing still (stillRadius of the start) 0; then capped
//                                   by the worst key broken at the spot (relationship): hard keyCap, the lesson lessonCap,
//                                   a line that is not the lesson softCap
//   kidOutline(ctx, area, opts)     the drawn green zone: the first exit of kidStars >= min along rays from the best spot
//                                   (star-shaped; it never straddles a key line, since it is traced on the stars)
//   kidNearest(ctx, area, spot)     the nearest point of the green (the reveal's arrow ends there)
//   relationship(ctx, spot, r, area, isLesson)   the key a rule's result breaks at the spot: { key, level } | null
//   bandOf(area, spot)              the band (0-3) the geometry alone gives
//   kidLive(ctx, spot, opts)        Match day's heat: the best of the areas round the last liveMemory s of best spots
//                                   (the Live ghost jumps), never colder than Coach mode's heat, capped by the keys now
//   kidRunStars(hotShare)           a Match day run's stars from the share of its scored time that was Hot
//
// PURE: no DOM, no clock, no randomness.

import { dist, projectOnSegment } from './geometry.js';
import { onPitch } from './pitch.js';
import { evaluate, toleranceFor } from './score.js';
import { RULES_BY_ID } from './rules/index.js';
import { goalSideRef } from './rules/goal-side.js';
import { OFFSIDE_DEFAULTS } from './rules/offside.js';
import { PRESS_DEFAULTS } from './rules/press.js';

export const KID_DEFAULTS = Object.freeze({
  // The area (distance): an ellipse round the best spot, sized from the rep's zone tolerance.
  mult: 1, // [D] the 3-star semi-axes = the zone tolerance (tx along x, ty across y) x this...
  floor: 3.5, // [D] ...at least this many metres (3 m off is inside, with room left for the lines)...
  ceil: 5, // [D] ...and at most this many
  stageScale: Object.freeze({ small: 1, medium: 1.1, full: 1.2 }), // [D] the area x this per stage: a phone draws the full
  //   match at about 5 px/m (a fingertip about 9 m), a small game at 12-15 px/m (PROGRESSIVE_FIELD §5)
  grow2: 2, // [D] m the 2-star band adds round the 3-star area (both axes)
  grow1: 4, // [D] m the 1-star band adds
  capFrac: Object.freeze({ 3: 0.45, 2: 0.5, 1: 0.55 }), // [D] toward the start each band reaches at most this share of the
  //   best-to-start distance (the green 45 %): the area never reaches the start, so standing still stays wrong
  stillRadius: 2, // [S] = SPOT_DEFAULTS.stillRadius (tested equal): this close to the start is standing still (0 stars)
  edge: 1e-9, // [D] m of slack on an ellipse or cap edge, so a spot and its mirror image land in the same band
  // The stars.
  starAt: Object.freeze([55, 75, 90]), // [S] = rewards.js REWARDS_DEFAULTS.starAt (tested equal): Coach mode's score for 1, 2, 3 stars
  coachLift: true, // [D] outside the green, Coach mode's score can LIFT the band's stars...
  coachLiftTo: 2, // [D] ...up to this many, never to 3 (3 stars only in the green: "Anywhere in the green is right", and only there)
  keyCap: 1, // [D] stars at most past a hard key: offside at a pass, keeping an attacker onside, the wrong side of your man
  //              or of the ball you press, any other critical rule
  lessonCap: 1, // [D] stars at most when the rep's own lesson is clearly failed (its rule's line, the drill's misconception)
  softCap: 2, // [D] stars at most past a line that is not the lesson (offside with no pass on, covering level, crossed, dropped)
  // Relationships (key constraints); distance is never a key.
  offsideMargin: OFFSIDE_DEFAULTS.margin, // [S] = OFFSIDE_DEFAULTS.margin: level is onside
  offsidePrinciples: Object.freeze(['F4', 'B2', 'P5']), // [S] = CAST_DEFAULTS.offsidePrinciples (tested equal): lessons about the line...
  offsideRules: Object.freeze(['offside', 'pin']), // [D] ...and the rules of a lesson about it: past the line is that lesson failed
  goalSideMargin: 0, // [D] m the wrong side of your man before it counts (level is fine)
  pressPast: 0, // [D] m: a presser this far past the ball (away from our goal) is on the wrong side of it. 0: level with
  //                 the ball or behind it, as the press rule's own 'wrong-side' and goalSideMargin, so the green never
  //                 reaches round the carrier's goal-side line (at 0.5 m it did)
  pressAngleKey: 0.25, // [D] a D2 lesson: the press rule's credit at the press distance in the spot's direction below this is
  //                      the wrong way round (it shows the carrier inside); too far round is a smaller mistake
  pressRef: (PRESS_DEFAULTS.distMin + PRESS_DEFAULTS.distMax) / 2, // [S] = PRESS_DEFAULTS: where that angle is judged (2.25 m)
  angleFrom: 1, // [D] m: nearer the ball or the man than this, the angle is not judged (the rules fade it there too)
  markAngleKey: 0.25, // [D] a D5 lesson: the goal-side rule's credit at the marking distance in the spot's direction below
  //                     this is not between the man and our goal
  coverLevel: 0.5, // [D] m: a cover less than this behind the presser is level with him (not covering)
  coverOutside: 1, // [D] m: a cover this far on the outside of an off-centre presser covers the wrong side
  screenLevel: 1, // [D] m: a #6 less than this above the back line has dropped into it
  crossedKey: 1, // [D] m (as compact words it, rounded): over a line-mate by this much has swapped sides
  levelPast: 2, // [D] m outside the level line's band (LEVEL_LINE_DEFAULTS tol 2: 4 m off the line; a covering drop's band
  //                   reaches coverDrop deep): clearly out of line, in a lesson about the line
  betweenKey: 1.5, // [D] m outside their lines (between-lines' band), in a lesson about it
  laneKey: 1, // [D] m: an opponent this close to the pass line blocks it (lane-open), in a lesson about it
  widthKey: 5, // [D] m inside the width rule's band (width), in a lesson about it
  boxKey: 3, // [D] m outside the box zone (box-fill), in a lesson about it
  // The drawn zone (kidOutline).
  outline: Object.freeze({ min: 3, rays: 48, maxR: 14, step: 0.5, tol: 0.1 }), // [D] rays from the best spot, m
  // Match day (kidLive).
  liveMemory: 1, // [D] s: the best spots of the last second count (the Live ghost moves 2 m or more in a tenth of a
  //                second one sample in ten; the UI keeps liveMemory x sampleHz of them)
  liveCoachFloor: Object.freeze({ hot: 70, warm: 50 }), // [S] = MATCHDAY_DEFAULTS hotAt / warmAt (tested equal): never colder than today
  liveRunStars: Object.freeze({ 3: 0.75, 2: 0.5, 1: 0.3 }), // [D] a run's stars from its share of scored time Hot
});
/** The design's name for the same object. */

/** The glow level for 0-3 stars (board.js setAid's levelAt: KID_LEVELS[kidStars(...).stars]). */
export const KID_LEVELS = Object.freeze(['cold', 'cool', 'warm', 'hot']);
/** The one word for 0-3 stars (= rewards.js STAR_WORDS, tested equal). */
export const KID_WORDS = Object.freeze(['Not yet', 'Close', 'Great', 'Spot on']);
/** kidStars' reason when no key capped the stars: the band the spot is in (0-3). */
const BAND_REASONS = Object.freeze(['far', 'close', 'near', 'area']);

const P_OF = (params) => (params ? { ...KID_DEFAULTS, ...params } : KID_DEFAULTS);
const starsOf = (score, P) => (Number.isFinite(score) ? P.starAt.filter((at) => score >= at).length : 0);
const capOfLevel = (level, P) => (level === 'soft' ? P.softCap : level === 'lesson' ? P.lessonCap : P.keyCap);

/** Circle, rect or polygon (even-odd), as npm run check judges misconception regions. */
function inRegion(r, p) {
  if (r?.type === 'circle') return Math.hypot(p.x - r.x, p.y - r.y) <= r.r;
  if (r?.type === 'rect') return p.x >= Math.min(r.x0, r.x1) && p.x <= Math.max(r.x0, r.x1) && p.y >= Math.min(r.y0, r.y1) && p.y <= Math.max(r.y0, r.y1);
  if (r?.type === 'polygon') {
    let inside = false;
    const q = r.points ?? [];
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      if ((q[i].y > p.y) !== (q[j].y > p.y) && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
    }
    return inside;
  }
  return false;
}

/**
 * The right area of a rep (Player mode), worked out once per rep or Match day sample.
 * @param {object} ctx  the rep's judging context at its stage (the staged ctx, or repScene's ctx)
 * @param {{ best: {x,y}, centre?: {x,y}, tol?: {tx,ty}, start?: {x,y}|null, hold?: boolean, stage?: 'small'|'medium'|'full',
 *           lesson?: { principle, rules }|null, misconceptions?: object[], params?: object }} opts
 *   best: the best spot (ghost.spot); centre, tol: the zone Coach mode judges (ghost.result.center / .tol: the base or
 *   answer.ideal, toleranceFor(role, answer.tol)), default the learner's base and role tolerance; start: where the
 *   learner stood (null in Live); hold: answer.hold (no start cap, no standing still); lesson: cast.js lessonOf's result
 *   (the staged rep's .lesson); misconceptions: scenario.misconceptions; params: KID_DEFAULTS overrides (shallow)
 * @returns {{ P, center, zone: { center, tol }, angle: 0, bands: { 3: {rx, ry}, 2: {rx, ry}, 1: {rx, ry} },
 *   cap: { u, D, max: { 3, 2, 1 } } | null, start, lesson, goalSide: { id, x, y, weight, sideOnly } | null, misconceptions, stage }}
 */
export function kidArea(ctx, { best, centre, tol, start = null, hold = false, stage = 'full', lesson = null, misconceptions = [], params } = {}) {
  if (!best || !Number.isFinite(best.x) || !Number.isFinite(best.y)) throw new TypeError('kidArea: best (the best spot) is required');
  const P = P_OF(params);
  const c = centre ?? ctx.learner.base;
  const t = tol ?? toleranceFor(ctx.learner.role);
  const k = P.stageScale[stage] ?? 1;
  const axis = (v) => Math.min(P.ceil, Math.max(P.floor, v * P.mult)) * k;
  const r3 = { rx: axis(t.tx), ry: axis(t.ty) };
  const bands = { 3: r3, 2: { rx: r3.rx + P.grow2, ry: r3.ry + P.grow2 }, 1: { rx: r3.rx + P.grow1, ry: r3.ry + P.grow1 } };
  let cap = null;
  const from = start && !hold ? { x: start.x, y: start.y } : null;
  if (from) {
    const D = dist(from, best);
    if (D > 1e-6) cap = { u: { x: (from.x - best.x) / D, y: (from.y - best.y) / D }, D, max: { 3: P.capFrac[3] * D, 2: P.capFrac[2] * D, 1: P.capFrac[1] * D } };
  }
  return {
    P, center: { x: best.x, y: best.y }, zone: { center: { x: c.x, y: c.y }, tol: { tx: t.tx, ty: t.ty } }, angle: 0, bands, cap, start: from,
    lesson: lesson?.rules?.length ? { principle: lesson.principle ?? null, rules: [...lesson.rules] } : null,
    goalSide: goalSideRef(ctx), misconceptions: [...(misconceptions ?? [])], stage,
  };
}

/**
 * The band (0-3) the spot's geometry gives: the smallest band ellipse that holds it and that the start cap allows.
 * @param {object} area  kidArea's
 * @param {{x:number,y:number}} spot
 * @returns {0|1|2|3}
 */
export function bandOf(area, spot) {
  const { center: c, bands, cap } = area;
  const e = area.P?.edge ?? KID_DEFAULTS.edge;
  const proj = cap ? (spot.x - c.x) * cap.u.x + (spot.y - c.y) * cap.u.y : -Infinity;
  for (const b of [3, 2, 1]) {
    const { rx, ry } = bands[b];
    if (Math.hypot((spot.x - c.x) / rx, (spot.y - c.y) / ry) <= 1 + e && !(cap && proj > cap.max[b] + e)) return b;
  }
  return 0;
}

/** The lesson is about the offside line (cast.js offsidePrinciples; the offside or pin rule). */
const offsideLesson = (area, P) => !!area.lesson && (P.offsidePrinciples.includes(area.lesson.principle) || area.lesson.rules.some((id) => P.offsideRules.includes(id)));

/**
 * The relationship a spot breaks for a rule that judges it (a side, an order, a line), or null. Distance is the area's
 * job; these are the mistakes no distance forgives. level 'hard' (keyCap): offside at a pass, keeping an attacker
 * onside, the wrong side of your man (goal-side margin below goalSideMargin; in our box its critical), pressing from
 * level with the ball or past it (press along below -pressPast), any other critical rule. 'lesson' (lessonCap): the
 * rep's own lesson clearly failed (its rule's line: offside or pin lesson past the line, D2 pressing the wrong way
 * round, D5 not between the man and goal, U4 out of line, P2 not between the lines, B3 lane blocked, B1 off the wing,
 * P10 out of the box zones, covering level or outside in a D3 lesson, crossed in U2, dropped in R3). 'soft' (softCap):
 * the same lines when they are not the lesson (offside with no pass on; covering level; crossed; dropped), so the green
 * never straddles them.
 * @param {object} ctx
 * @param {{x:number,y:number}} spot
 * @param {object} r  a RuleResult of evaluate() at the spot (weight > 0)
 * @param {object} area  kidArea's
 * @param {boolean} isLesson  the rule is one of the rep's lesson's rules
 * @returns {{ key: string, level: 'hard'|'lesson'|'soft' } | null}
 */
export function relationship(ctx, spot, r, area, isLesson) {
  const P = area.P ?? KID_DEFAULTS;
  const v = r.vars ?? {};
  const K = (key, level) => ({ key, level });
  const own = (key) => K(key, isLesson ? 'lesson' : 'soft');
  switch (r.id) {
    case 'offside':
      if (!(v.beyond > P.offsideMargin)) return null;
      return r.critical ? K('offside', 'hard') : isLesson || offsideLesson(area, P) ? K('offside', 'lesson') : K('offside', 'soft');
    case 'keeps-onside':
      return r.critical ? K('kept-onside', 'hard') : null;
    case 'goal-side': {
      if (r.critical || v.margin < -P.goalSideMargin) return K('wrong-side', 'hard');
      const g = area.goalSide;
      if (!isLesson || !g || !r.target) return null;
      // The angle alone: the rule at the spot's direction from the man, at the marking distance it wants.
      const d = dist(spot, g), want = dist(r.target, g);
      if (d < P.angleFrom) return null;
      const q = { x: g.x + ((spot.x - g.x) / d) * want, y: g.y + ((spot.y - g.y) / d) * want };
      return RULES_BY_ID['goal-side'].evaluate(ctx, q).s < P.markAngleKey ? K('not-between', 'lesson') : null;
    }
    case 'press': {
      if (v.along < -P.pressPast) return K('wrong-side', 'hard');
      if (!isLesson || area.lesson?.principle !== 'D2') return null;
      const ref = ctx.carrier ?? ctx.ball; // the press rule's reference (a loose ball is pressed where it lies)
      const d = dist(spot, ref);
      if (d < P.angleFrom) return null;
      const q = { x: ref.x + ((spot.x - ref.x) / d) * P.pressRef, y: ref.y + ((spot.y - ref.y) / d) * P.pressRef };
      const pr = RULES_BY_ID.press.evaluate(ctx, q);
      // Only the outside of the line is the D2 mistake (it shows the carrier inside, toward goal); too far round is smaller.
      return pr.s < P.pressAngleKey && pr.vars.issue !== 'too-round' ? K('wrong-way', 'lesson') : null;
    }
    case 'cover':
      if (v.depthRaw < P.coverLevel) return own('level');
      return v.insideRaw <= -P.coverOutside ? own('outside') : null;
    case 'compact':
      return v.issue === 'crossed' && v.gap >= P.crossedKey ? own('crossed') : null;
    case 'screen':
      return v.aheadRaw < P.screenLevel ? own('dropped') : null;
    case 'level-line':
      return isLesson && (v.dx < v.lo - P.levelPast || v.dx > v.hi + P.levelPast) ? K('out-of-line', 'lesson') : null;
    case 'between-lines':
      return isLesson && (v.x < v.lo - P.betweenKey || v.x > v.hi + P.betweenKey) ? K('not-between', 'lesson') : null;
    case 'lane-open':
      return isLesson && v.gap < P.laneKey ? K('blocked', 'lesson') : null;
    case 'width':
      return isLesson && v.d > v.max + P.widthKey ? K('narrow', 'lesson') : null;
    case 'box-fill':
      return isLesson && v.d > P.boxKey ? K('out-of-box', 'lesson') : null;
    default:
      return r.critical ? K('critical', 'hard') : null;
  }
}

/**
 * Player mode's stars for a spot: 3 only in the green (band 3); outside it the band, lifted to Coach mode's stars up to
 * coachLiftTo; standing still (within stillRadius of the start, not a hold drill) 0; then capped by the worst key the
 * spot breaks (relationship; a drill's misconception region is a lesson key).
 * @param {object} ctx
 * @param {{x:number,y:number}} spot
 * @param {object} area  kidArea's
 * @returns {{ stars: 0|1|2|3, word: string, band: 0|1|2|3, inArea: boolean, broken: string[], keys: string[],
 *   levels: ('hard'|'lesson'|'soft')[], reason: string, coach: object }}
 *   broken: the rule ids (or 'misconception', 'start') whose keys the spot breaks, keys and levels beside them;
 *   reason: 'area' | 'near' | 'close' | 'far' (the band), 'coach' (Coach mode's stars lifted it), 'start' (stood still),
 *   or the rule id (or 'misconception') whose key capped the stars; coach: evaluate() at the spot, unchanged
 */
export function kidStars(ctx, spot, area) {
  const P = area.P ?? KID_DEFAULTS;
  const coach = evaluate(ctx, spot, { center: area.zone.center, tol: area.zone.tol });
  const band = bandOf(area, spot);
  if (area.start && dist(spot, area.start) <= P.stillRadius) {
    return { stars: 0, word: KID_WORDS[0], band, inArea: false, broken: ['start'], keys: ['stood-still'], levels: ['hard'], reason: 'start', coach };
  }
  let stars = band === 3 ? 3 : P.coachLift ? Math.max(band, Math.min(starsOf(coach.score, P), P.coachLiftTo)) : band;
  let reason = band >= stars ? BAND_REASONS[band] : 'coach';
  const broken = [], keys = [], levels = [];
  const lessonIds = area.lesson?.rules ?? [];
  for (const r of coach.rules) {
    if (!(r.weight > 0)) continue;
    const k = relationship(ctx, spot, r, area, lessonIds.includes(r.id));
    if (k) { broken.push(r.id); keys.push(k.key); levels.push(k.level); }
  }
  if ((area.misconceptions ?? []).some((m) => inRegion(m.region, spot))) { broken.push('misconception'); keys.push('misconception'); levels.push('lesson'); }
  let cap = 3, at = -1;
  levels.forEach((l, i) => { const c = capOfLevel(l, P); if (c < cap) { cap = c; at = i; } });
  if (stars > cap) { stars = cap; reason = broken[at]; }
  return { stars, word: KID_WORDS[stars], band, inArea: stars === 3, broken, keys, levels, reason, coach };
}

/**
 * The drawn zone: where kidStars gives `min` stars or more, traced by `rays` rays from the best spot (the first exit along
 * each, found every `step` m and then halved to `tol` m; off the pitch counts as out). Star-shaped by construction: a
 * spot the trace cannot see (an island past a gap) is left out of the drawing, and it never straddles a key line.
 * @param {object} ctx
 * @param {object} area  kidArea's
 * @param {{ min?: number, rays?: number, maxR?: number, step?: number, tol?: number }} [opts]  default KID_DEFAULTS.outline
 * @returns {{x:number, y:number, r:number}[]}  one vertex per ray, in order round the best spot (r: its distance)
 */
export function kidOutline(ctx, area, opts = {}) {
  const { min, rays, maxR, step, tol } = { ...(area.P ?? KID_DEFAULTS).outline, ...opts };
  const c = area.center, pts = [];
  const ok = (p) => onPitch(p) && kidStars(ctx, p, area).stars >= min;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * 2 * Math.PI, ux = Math.cos(a), uy = Math.sin(a);
    let lo = 0, hi = null;
    for (let r = step; r <= maxR + 1e-9; r += step) {
      if (ok({ x: c.x + ux * r, y: c.y + uy * r })) lo = r; else { hi = r; break; }
    }
    if (hi !== null) while (hi - lo > tol) { const m = (lo + hi) / 2; if (ok({ x: c.x + ux * m, y: c.y + uy * m })) lo = m; else hi = m; }
    pts.push({ x: c.x + ux * lo, y: c.y + uy * lo, r: lo });
  }
  return pts;
}

/**
 * The nearest point of the green to a spot (the reveal's arrow from YOU ends there): the spot itself when it has 3 stars,
 * else the nearest point on the outline (kidOutline, or the one passed in).
 * @param {object} ctx
 * @param {object} area
 * @param {{x:number,y:number}} spot
 * @param {{ outline?: {x:number,y:number}[] }} [opts]
 * @returns {{x:number, y:number}}
 */
export function kidNearest(ctx, area, spot, { outline } = {}) {
  if (kidStars(ctx, spot, area).stars >= 3) return { x: spot.x, y: spot.y };
  const pts = outline ?? kidOutline(ctx, area);
  let best = null, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const { point, dist: d } = projectOnSegment(spot, pts[i], pts[(i + 1) % pts.length]);
    if (d < bd) { bd = d; best = point; }
  }
  return best ? { x: best.x, y: best.y } : { x: area.center.x, y: area.center.y };
}

/**
 * Match day's heat at a spot: the best stars of the areas round the recent best spots (the Live ghost jumps, so the last
 * liveMemory s count), never colder than Coach mode's heat (score liveCoachFloor.hot → 3, .warm → 2), and never past the
 * cap of a key broken at the spot now.
 * @param {object} ctx  the sample's context
 * @param {{x:number,y:number}} spot  where YOU are now
 * @param {{ recent?: {x,y}[], centre?: {x,y}, tol?: {tx,ty}, coachScore?: number, stage?: string, params?: object }} opts
 *   recent: the best spots of the last liveMemory s, oldest first (default: the centre); centre, tol: the zone (the base);
 *   coachScore: Coach mode's score at the spot (default: evaluate() at it)
 * @returns {{ stars: 0|1|2|3, heat: 'hot'|'warm'|'cold', keys: string[], levels: string[], reason: string, coach: object, best: {x,y} }}
 *   best: the recent best spot whose area gave the stars (the hardest moment's replay draws its zone)
 */
export function kidLive(ctx, spot, { recent, centre, tol, coachScore, stage = 'full', params } = {}) {
  const P = P_OF(params);
  const c = centre ?? ctx.learner.base;
  const t = tol ?? toleranceFor(ctx.learner.role);
  const ghosts = recent?.length ? recent : [c];
  let top = null;
  for (let i = ghosts.length - 1; i >= 0; i--) { // the newest first
    const g = ghosts[i];
    const k = kidStars(ctx, spot, kidArea(ctx, { best: g, centre: c, tol: t, stage, params }));
    if (!top || k.stars > top.k.stars) top = { k, g };
    if (top.k.stars >= 3) break;
  }
  const { k, g } = top;
  const capNow = k.levels.reduce((m, l) => Math.min(m, capOfLevel(l, P)), 3);
  const score = Number.isFinite(coachScore) ? coachScore : k.coach.score;
  const floor = score >= P.liveCoachFloor.hot ? 3 : score >= P.liveCoachFloor.warm ? 2 : 0;
  const stars = Math.min(capNow, Math.max(k.stars, floor));
  const reason = stars > k.stars ? 'coach' : k.reason;
  return { stars, heat: stars >= 3 ? 'hot' : stars === 2 ? 'warm' : 'cold', keys: k.keys, levels: k.levels, reason, coach: k.coach, best: { x: g.x, y: g.y } };
}

/**
 * A Match day run's stars from the share of its scored time that was Hot (kidLive heat 'hot'): liveRunStars.
 * @param {number} hotShare  0..1
 * @param {object} [params]  KID_DEFAULTS overrides
 * @returns {0|1|2|3}
 */
export function kidRunStars(hotShare, params) {
  const P = P_OF(params);
  if (!Number.isFinite(hotShare)) return 0;
  for (const s of [3, 2, 1]) if (hotShare >= P.liveRunStars[s]) return s;
  return 0;
}
