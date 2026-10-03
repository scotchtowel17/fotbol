// Context builder: derives everything the principle rules need from a frame.
// Contract: docs/ARCHITECTURE.md §5.4. Rationale: docs/RESEARCH.md §5.4.
//
// Duties ("who should be doing what") are computed with the learner standing at
// their layer-A BASE position, not at the spot being judged. The learner's spot is
// then scored against that duty, which avoids circular scoring.

import { dist, median, clamp } from './geometry.js';
import { laneOf, thirdOf, isWingLane, OWN_GOAL, LENGTH, MID_Y, HALF_X, LANE_EDGES, mirrorPoint } from './pitch.js';
import { ROLE_INFO, BACK_LINE, MIDFIELD, parsePlayerId } from './roles.js';

export const CONTEXT_DEFAULTS = Object.freeze({
  pressureRadius: 3, // [D] an opponent this close to the carrier = pressure on the ball
  secondDefenderRadius: 15, // [D] max distance from the first defender to count as the covering 2nd defender
  coverUnitPenalty: 5, // [D] U5/R1: covering a back-liner who engages, a candidate from outside the back line ranks this many metres further away
  coverMidAhead: 5, // [D] U2/U4: a first defender from midfield or up front this far ahead of our back line is covered from midfield, never by a back-liner (who holds the line)
  centreOfPlayRadius: 12, // [D] 2nd attackers are within this of the ball (published 9.15 m is from 3v3 play)
  markRadius: 18, // [D] an opponent further than this from your base is not "yours" to mark
  handoverDepth: 5, // [D] D7: midfielders and forwards hand opponents within this of our back line's height (or deeper) to the back line
  backReach: 8, // [D] D7: ...and the back line leaves opponents more than this ahead of its height to the midfield
  midReach: 8, // [D] D7/U1: the #8s leave opponents more than this ahead of our midfield line to the forwards (a compact block does not chase them)
  markBehindBall: 2, // [D] U6: in a mid or low block, midfielders and forwards leave opponents more than this behind the ball (they can't receive a forward pass; the block blocks the central passes instead)
  coverReach: 4, // [D] D3/U5: an opponent this close to a covering back-liner is his to deal with, so nobody else is sent to mark him
  pastWeight: 2, // [D] F1/T3: ranking the first defender, each metre a player is past the ball (beyond it, seen from our goal) counts as this many extra metres; the same rule as autoFrame's press (SCENE_DEFAULTS.pressPastWeight)
  fbEngage: 10, // [D] R2/U5: with the ball wide in our half the ball-side full-back engages the winger: he ranks this many metres nearer the ball (SCENE_DEFAULTS.pressFbEngage)
  fbEngageFrom: 45, // [D] ...fully with the ball at or behind this x (own frame)...
  fbEngageTo: 55, // [D] ...fading out by this x (in their half the winger or #8 presses)
  blockHigh: 45, // [D] back-line x (in the defending team's own frame) at or above this = high block
  blockLow: 25, // [D] below this = low block
  shareReach: 12, // [D] B6: a full-back in his winger's wing lane within this many metres along the pitch of him... (SCENE_DEFAULTS.shareReach)
  shareFade: 4, // [D] ...fading out over this many more (SCENE_DEFAULTS.shareFade)...
  shareBehind: 3, // [D] ...and at most this far behind him holds the width for him (SCENE_DEFAULTS.shareBehind)...
  shareBehindFade: 6, // [D] ...fading out over this many metres more, so the winger drifts in as the full-back arrives (SCENE_DEFAULTS.shareBehindFade)
  wingFade: 3, // [D] a player counts as in a wing lane fully this far inside its edge, fading to 0 at the edge (SCENE_DEFAULTS.wingFade)
  delayReach: 25, // [D] T2: attackers and defenders within this of the ball (fading out over delayFade more)...
  delayFade: 5, // [D]
  delayGoalSide: 1, // [D] ...and at least this far goal-side of it (fading in over 2 m) are the numbers between the ball and goal
  offsideMarkMargin: 1, // [D] U4/F4: an opponent this far or more in an offside position (behind our second-last player and the ball, in our half) is nobody's mark: the line holds and leaves him offside
});

/**
 * How far into its wing lane a point is on `side` ('L' | 'R'), as a weight: 0 at the lane edge (or inside it), 1 from
 * wingFade metres into the wing lane.
 */
export function wingDepth(p, side, P = CONTEXT_DEFAULTS) {
  const d = side === 'R' ? p.y - LANE_EDGES[4] : LANE_EDGES[1] - p.y;
  return clamp(d / P.wingFade, 0, 1);
}

/**
 * B6, one wide, one inside: how much a full-back holds his winger's wing lane (0..1): in it, within shareReach of
 * the winger along the pitch and level with or ahead of him (no more than shareBehind behind), every edge faded so a
 * placement that follows it stays continuous. Shared by scene.js (the winger comes inside) and buildContext (he is
 * then not the width-holder).
 * @param {'us'|'them'} team  the team in possession (which way is "ahead")
 * @param {{x:number,y:number}} fb  the full-back
 * @param {{x:number,y:number}} w   the winger on the same side
 * @param {'L'|'R'} side
 */
export function flankShare(team, fb, w, side, P = CONTEXT_DEFAULTS) {
  const sign = team === 'us' ? 1 : -1;
  const reach = clamp((P.shareReach + P.shareFade - Math.abs(fb.x - w.x)) / P.shareFade, 0, 1);
  const behind = sign * (w.x - fb.x); // > 0: the full-back is behind the winger
  const level = clamp((P.shareBehind + P.shareBehindFade - behind) / P.shareBehindFade, 0, 1);
  return wingDepth(fb, side, P) * reach * level;
}

/**
 * T2, delay when outnumbered: compares the attackers and the defenders between the ball and the defending team's goal
 * (within delayReach of the ball, at least delayGoalSide goal-side of it; goalkeepers and the carrier left out; every
 * count soft, so it is continuous). Returns how much the defending team is outnumbered there, 0..1: 1 with as many
 * attackers as defenders or more ("keep more defenders than attackers between the ball and goal"), 0 with one
 * defender more. The press rule backs the first defender off to delay (3-5 m) by this much while we recover.
 * @param {'us'|'them'} defending
 * @param {{x:number,y:number}} ball
 * @param {object[]} players  everyone (the learner where the duties are computed: at base)
 * @param {string|null} carrierId
 */
export function outnumbered(defending, ball, players, carrierId = null, P = CONTEXT_DEFAULTS) {
  const toGoal = defending === 'us' ? -1 : 1; // the defending team's goal is at x 0 for us
  let att = 0, def = 0;
  for (const p of players) {
    if (p.role === 'GK' || p.id === carrierId) continue;
    const near = clamp((P.delayReach + P.delayFade - dist(p, ball)) / P.delayFade, 0, 1);
    const ahead = (p.x - ball.x) * toGoal; // > 0: between the ball and the defending goal
    const k = near * clamp((ahead - P.delayGoalSide + 2) / 2, 0, 1);
    if (p.team === defending) def += k; else att += k;
  }
  return clamp(att - def + 1, 0, 1);
}

/** The block a scene's phase tag names (scenario.js PHASES), for a frame that shows no back line to measure it from. */
const PHASE_BLOCK = Object.freeze({ high_press: 'high', counter_press: 'high', mid_block: 'mid', low_block: 'low' });

const OPP_BACK = BACK_LINE;
const OPP_MID = MIDFIELD;

// Marking units out of possession: each unit shares out the opponents near it (D7 zonal
// hand-over), so two centre-backs never both "own" the same striker.
const MARK_UNIT = { CB: 'back', FB: 'back', DM: 'mid', CM: 'mid', W: 'front', ST: 'front' };

/**
 * Build the per-frame context the rules read.
 * @param {import('./types.js').Frame} frame
 * @param {{ learnerId: string, base?: {x:number,y:number}, params?: object }} opts
 *   base: the learner's layer-A target; defaults to the learner's position in the frame.
 *   params: overrides for CONTEXT_DEFAULTS; `params.rules[ruleId]` overrides a rule's defaults.
 * @returns {object} Ctx (docs/ARCHITECTURE.md §5.4, plus usAtBase, secondDefender,
 *   lines.ourMidLineX and lines.oppLastX)
 */
export function buildContext(frame, { learnerId, base, params = {} }) {
  const P = { ...CONTEXT_DEFAULTS, ...params };
  const { role } = parsePlayerId(learnerId);
  const info = ROLE_INFO[role] ?? { family: 'CM', side: 'C' };
  const learnerPlayer = frame.players.find((p) => p.id === learnerId);
  const baseSpot = base ?? (learnerPlayer ? { x: learnerPlayer.x, y: learnerPlayer.y } : { x: 30, y: 34 });
  const learnerAtBase = { id: learnerId, team: 'us', role, x: baseSpot.x, y: baseSpot.y };

  const teammates = frame.players.filter((p) => p.team === 'us' && p.id !== learnerId);
  const opponents = frame.players.filter((p) => p.team === 'them');
  const usAtBase = [...teammates, learnerAtBase];
  const ball = frame.ball;
  const carrier = frame.carrierId ? frame.players.find((p) => p.id === frame.carrierId) ?? null : null;
  const moment = frame.possession === 'us' ? 'in_possession' : frame.possession === 'them' ? 'out_of_possession' : 'loose';

  // Pressure on the ball: explicit tag wins; otherwise any outfield opponent of the carrier within
  // pressureRadius of the carrier or the ball (autoFrame's presser stands pressDistance from the
  // ball, which with the carrier's offset behind it can be just over pressureRadius from the carrier).
  let pressureOnBall = frame.tags?.pressureOnBall;
  if (pressureOnBall === undefined) {
    if (carrier) {
      const pressers = carrier.team === 'us' ? opponents : usAtBase;
      pressureOnBall = pressers.some((p) => p.role !== 'GK' && Math.min(dist(p, carrier), dist(p, ball)) <= P.pressureRadius);
    } else pressureOnBall = false;
  }

  // Lines.
  const ourBackLine = usAtBase.filter((p) => BACK_LINE.includes(p.role));
  const ourBackLineX = median(ourBackLine.map((p) => p.x));
  const oppXsDesc = opponents.map((p) => p.x).sort((a, b) => b - a);
  const oppSecondLastX = oppXsDesc.length > 1 ? oppXsDesc[1] : LENGTH;
  const oppLastX = oppXsDesc[0] ?? LENGTH;
  const oppBackLineX = median(opponents.filter((p) => OPP_BACK.includes(p.role)).map((p) => p.x));
  const oppMidLineX = median(opponents.filter((p) => OPP_MID.includes(p.role)).map((p) => p.x));
  const ourMidLineX = median(usAtBase.filter((p) => MIDFIELD.includes(p.role)).map((p) => p.x));

  // Block height of the team out of possession, measured in its own frame. A loose ball counts as us defending.
  const defendingUs = moment !== 'in_possession';
  const backX = defendingUs ? ourBackLineX : LENGTH - oppBackLineX;
  // A smaller game (cast.js) may show none of that back line: the block the scene is tagged with (its phase) then, else mid.
  const blockHeight = !Number.isFinite(backX) ? PHASE_BLOCK[frame.tags?.phase] ?? 'mid'
    : backX >= P.blockHigh ? 'high' : backX < P.blockLow ? 'low' : 'mid';

  // Duties.
  const outfieldUs = usAtBase.filter((p) => p.role !== 'GK');
  let duty, firstDefender = null, secondDefender = null;
  if (defendingUs) {
    // Nearest to the ball, counting metres past the ball extra: a goal-side teammate takes the ball
    // on rather than a player the ball has already gone by (who recovers instead, T3).
    // The ball-side full-back ranks nearer with the ball wide in our half (R2, U5: he engages the
    // winger and a centre-back covers); scene.js ranks its automatic presser the same way.
    const gl = dist(OWN_GOAL, ball) || 1, gx = (OWN_GOAL.x - ball.x) / gl, gy = (OWN_GOAL.y - ball.y) / gl;
    const fb = engageBias('us', ball, P);
    const reach = (p) => dist(p, ball) + P.pastWeight * Math.max(0, -((p.x - ball.x) * gx + (p.y - ball.y) * gy)) - (p.role === fb.role ? fb.bias : 0);
    const byBall = [...outfieldUs].sort((a, b) => reach(a) - reach(b));
    firstDefender = byBall[0] ?? null;
    if (firstDefender) {
      // The cover player sits behind the presser (goal-side of them, not merely of the ball), and
      // comes from the right unit: a back-liner who engages is covered from the back line (U5: the
      // near centre-back covers the full-back; R1: the partner covers); a midfielder or forward who
      // steps out well ahead of our back line is covered from midfield or not at all, because a
      // back-liner who left the line to cover him would open a gap in it (U2, U4).
      const unitOf = (p) => MARK_UNIT[ROLE_INFO[p.role]?.family];
      const fdBack = unitOf(firstDefender) === 'back';
      const holdLine = !fdBack && firstDefender.x >= ourBackLineX + P.coverMidAhead;
      const cost = (p) => dist(p, firstDefender) + (fdBack && unitOf(p) !== 'back' ? P.coverUnitPenalty : 0);
      const coverCandidates = outfieldUs
        .filter((p) => p !== firstDefender && p.x < Math.min(ball.x, firstDefender.x) - 1 && dist(p, firstDefender) <= P.secondDefenderRadius)
        .filter((p) => !(holdLine && unitOf(p) === 'back'))
        .sort((a, b) => cost(a) - cost(b));
      secondDefender = coverCandidates[0] ?? null;
    }
    duty = firstDefender === learnerAtBase ? 'first-defender'
      : secondDefender === learnerAtBase ? 'second-defender' : 'third-defender';
  } else {
    duty = carrier?.id === learnerId ? 'first-attacker'
      : dist(learnerAtBase, ball) <= P.centreOfPlayRadius ? 'second-attacker' : 'third-attacker';
  }

  // Who is "yours": the first defender owns the carrier; the second defender covers and marks
  // nobody, but an opponent right beside a covering back-liner (coverReach) is his, so nobody else
  // is sent to him. Everyone else is paired with at most one opponent and vice versa: wingers take
  // only the full-back on their flank (R4) and full-backs start with the winger on theirs (R2);
  // then the back line and midfield share out the remaining opponents nearest them, and then the
  // striker (greedy, within markRadius). Zonal hand-over (D7): the back line leaves opponents more
  // than backReach ahead of it to the midfield, midfielders and the striker leave opponents already
  // at the back line's height to the back line, the #6 (who screens, R3) only takes opponents
  // between our lines (and within the back line's reach only if no back-liner can), and the #8s
  // none more than midReach ahead of our midfield line (U1: the block stays compact). In a mid or
  // low block, midfielders and the striker leave opponents behind the ball alone (U6: block the
  // central passes, let them play at the back).
  let markTarget = null;
  if (duty === 'first-defender') markTarget = carrier;
  else if (duty === 'third-defender') {
    const markers = outfieldUs.filter((p) => p !== firstDefender && p !== secondDefender);
    // A back-liner who covers stays in or near the line, so an opponent beside him is his to deal with.
    const coverer = secondDefender && MARK_UNIT[ROLE_INFO[secondDefender.role]?.family] === 'back' ? secondDefender : null;
    // U4: an attacker standing offside (behind our second-last player, with the learner at base, and
    // behind the ball, in our half) is left there: dropping to mark him would play him onside.
    const usXs = usAtBase.map((p) => p.x).sort((a, b) => a - b);
    const ourSecondLastX = usXs.length > 1 ? usXs[1] : 0;
    const offsideAt = Math.min(ourSecondLastX, ball.x, HALF_X) - P.offsideMarkMargin;
    const targets = opponents.filter((o) => o.role !== 'GK' && o !== carrier && !(coverer && dist(o, coverer) <= P.coverReach) && !(o.x < offsideAt));
    const bands = {
      backMax: ourBackLineX + P.backReach, fwdMin: ourBackLineX + P.handoverDepth, dmMax: ourMidLineX, cmMax: ourMidLineX + P.midReach,
      fwdMax: blockHeight === 'high' ? Infinity : ball.x + P.markBehindBall,
    };
    const marks = assignMarks(markers, targets, bands, P.markRadius);
    markTarget = marks.get(learnerAtBase) ?? null;
  }

  // The opponent most threatening to our goal (excluding the carrier and their keeper).
  let dangerousAttacker = null;
  {
    let best = Infinity;
    for (const o of opponents) {
      if (o.role === 'GK' || o === carrier) continue;
      const d = dist(o, OWN_GOAL);
      if (d < best) { best = d; dangerousAttacker = o; }
    }
  }

  const lane = laneOf(ball.y);
  // Width: the tagged holders, else the wingers, except a winger whose full-back holds his wing lane (B6: flankShare).
  const widthHolders = frame.tags?.widthHolders;
  let widthHolder = moment === 'in_possession' && (Array.isArray(widthHolders) ? widthHolders.includes(role) : info.family === 'W');
  if (widthHolder && !Array.isArray(widthHolders) && (info.side === 'L' || info.side === 'R')) {
    const fb = teammates.find((p) => p.role === info.side + 'B');
    if (fb && flankShare('us', fb, learnerAtBase, info.side, P) >= 0.5) widthHolder = false;
  }

  return {
    frame,
    params: P,
    learner: { id: learnerId, team: 'us', role, family: info.family, side: info.side, base: baseSpot },
    moment,
    ball,
    carrier,
    carrierFacing: frame.tags?.carrierFacing ?? 'forward',
    pressureOnBall: !!pressureOnBall,
    ballZone: { third: thirdOf(ball.x), lane, wing: isWingLane(ball.y) },
    ballSide: lane <= 1 ? 'L' : lane >= 3 ? 'R' : 'C',
    teammates,
    usAtBase,
    opponents,
    lines: { ourBackLine, ourBackLineX, ourMidLineX, oppSecondLastX, oppLastX, oppBackLineX, oppMidLineX },
    blockHeight,
    duty,
    firstDefender,
    secondDefender,
    markTarget,
    dangerousAttacker,
    widthHolder,
  };
}

/**
 * R2/U5: with the ball wide in the defending team's own half, its ball-side full-back engages the
 * winger instead of the nearer #8, so he ranks `bias` metres nearer the ball when the first
 * defender (context) or the automatic presser (scene.js) is chosen. The bias fades in across the
 * half-space into the wing lane and out between fbEngageFrom and fbEngageTo (own frame), so the
 * choice stays continuous in the ball. Shared by buildContext() and autoFrame().
 * @param {'us'|'them'} team  the defending team
 * @param {{x:number,y:number}} ball  canonical frame
 * @param {{fbEngage:number, fbEngageFrom:number, fbEngageTo:number}} P
 * @returns {{ role: 'LB'|'RB', bias: number }}
 */
export function engageBias(team, ball, P) {
  const own = team === 'us' ? ball : mirrorPoint(ball);
  const wide = clamp((Math.abs(own.y - MID_Y) - (LANE_EDGES[3] - MID_Y)) / (LANE_EDGES[4] - LANE_EDGES[3]), 0, 1);
  const deep = clamp((P.fbEngageTo - own.x) / (P.fbEngageTo - P.fbEngageFrom), 0, 1);
  return { role: own.y < MID_Y ? 'LB' : 'RB', bias: P.fbEngage * wide * deep };
}

/**
 * D2/R5 (and the D9 curved run): in the opponents' half the first defender presses from the inside of
 * the ball-to-goal line, shutting the pass inside (centre-back to centre-back, or to their #6) and
 * showing the carrier wide; near the middle of the pitch there is no inside, and in the defending team's
 * own half the press stays on the line to goal (D1). Returns how much of that lean applies, 0..1: the
 * side factor fades in from leanCentre metres off the middle to the inner edge of the half-space, the
 * height factor from leanFrom to leanTo (the defending team's own frame), so it is continuous in the ball.
 * Shared by scene.js (where the automatic presser stands) and the press rule (what it rewards).
 * @param {'us'|'them'} team  the defending team
 * @param {{x:number,y:number}} ball  canonical frame (the carrier, or the ball)
 * @param {{leanCentre:number, leanFrom:number, leanTo:number}} P
 * @returns {number} 0..1
 */
export function pressLean(team, ball, P) {
  const own = team === 'us' ? ball : mirrorPoint(ball);
  const side = clamp((Math.abs(own.y - MID_Y) - P.leanCentre) / (MID_Y - LANE_EDGES[2] - P.leanCentre), 0, 1);
  const high = clamp((own.x - P.leanFrom) / (P.leanTo - P.leanFrom), 0, 1);
  return side * high;
}

/**
 * Pair our third defenders with opponents one-to-one (see buildContext). `bands` holds the x
 * limits of each unit's zone: backMax (back line), fwdMin and fwdMax (midfield and striker: fwdMax
 * is just behind the ball in a mid or low block, where only a high press marks players behind the
 * ball, U6), dmMax (#6) and cmMax (#8s). Returns Map<ourPlayer, opponent>.
 */
function assignMarks(markers, targets, { backMax, fwdMin, fwdMax, dmMax, cmMax }, radius) {
  const marks = new Map();
  const taken = new Set();
  const familyOf = (p) => ROLE_INFO[p.role]?.family;
  const inZone = (m, o) => {
    const f = familyOf(m);
    if (f === 'CB' || f === 'FB') return o.x <= backMax;
    if (o.x > fwdMax) return false;
    return o.x >= fwdMin && o.x <= (f === 'DM' ? dmMax : f === 'CM' ? cmMax : Infinity);
  };
  // The #6 screens (R3): an opponent still within the back line's reach is the back line's first,
  // so the #6's pairs there rank after every other pair (he takes him only if nobody else can).
  const rank = (m, o, d) => d + (familyOf(m) === 'DM' && o.x <= backMax ? radius : 0);
  // Flank duels first: our winger takes their full-back on his flank (R4) and our full-back their
  // winger (R2), whatever their height. Their right-sided roles play on our left.
  for (const p of markers) {
    const f = familyOf(p);
    if (f !== 'W' && f !== 'FB') continue;
    const side = ROLE_INFO[p.role].side === 'L' ? 'R' : 'L';
    const o = targets.find((q) => q.role === side + (f === 'W' ? 'B' : 'W'));
    if (o && !taken.has(o) && dist(o, p) <= radius) { marks.set(p, o); taken.add(o); }
  }
  // Then the back line, the #6 and the #8s together, nearest pairs first (an opponent where two
  // zones overlap goes to whoever is nearer: hand-over, D7), then the striker.
  for (const families of [['CB', 'FB', 'DM', 'CM'], ['ST']]) {
    const pairs = [];
    for (const m of markers) {
      if (!families.includes(familyOf(m)) || marks.has(m)) continue;
      for (const o of targets) {
        if (taken.has(o) || !inZone(m, o)) continue;
        const d = dist(m, o);
        if (d <= radius) pairs.push({ d: rank(m, o, d), m, o });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    for (const { m, o } of pairs) {
      if (marks.has(m) || taken.has(o)) continue;
      marks.set(m, o);
      taken.add(o);
    }
  }
  return marks;
}
