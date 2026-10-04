// Pass options for the player on the ball: rate every pass, star the best, grade the learner's choice
// and say why in football words. Contract: docs/ARCHITECTURE.md §5.14. Rationale and every formula:
// docs/research/passing.md §4 (the prototype there ran against this engine); RESEARCH §5.8.
//
// Each option (a pass to a teammate's feet, or into the space ahead of a runner) gets
//   safety   pSafe = pExec x pLane x pWin
//              pLane  no defender cuts it out before the receiver meets it: Spearman time to intercept
//                     plus a body block for a defender within reach of the line (the B3 geometry)
//              pExec  a youth player can play it that far accurately
//              pWin   into space: our runner wins the race to the ball (soft pitch control); to feet: 1
//   reward   our own licence-free value surface V at the target, raised by the receiver's free run and the
//            opponents the pass takes out (Impect's "bypassed" test), lowered by pressure on the receiver
//   utility  U (in goals): the chance we keep it x what it is worth, minus each way of losing it x what
//            losing it there costs (Spearman 2017 Eq. 11 with more outcomes)
//   worth    U less a youth risk premium for a pass that is not safe (riskWorth): what the rating ranks by
//   score    100 - (worth_best - worth) / pointValue, then floored for a safe pass and capped for a red or critical one
// Static frames only (no velocities, no body shape). PURE: no DOM, no clock, no randomness.
// Canonical frame: we attack +x; rate THEIR passes on swapTeams(frame).

import { dist, median, clamp } from './geometry.js';
import { LENGTH, WIDTH, MID_Y, POSTS, PENALTY_AREA, HALF_X, ZONE_14, clampToPitch } from './pitch.js';
import { ROLE_INFO, MIDFIELD, BACK_LINE, FORWARDS } from './roles.js';
import { nameOf, cap } from './rules/_util.js';
import { gradeOf } from './score.js';

export const PASS_DEFAULTS = Object.freeze({
  // Ball and players: Spearman et al. 2017 via the LaurieOnTracking defaults [S]. Frames are static (no velocities).
  ballSpeed: 15, // [S] m/s, an average ground pass
  reactionTime: 0.7, // [S] s before a defender reacts to the pass
  maxSpeed: 5, // [S] m/s
  sigma: 0.45, // [S] s, spread of the arrival time (logistic)
  receiverReaction: 0.3, // [D] s: the receiver knows the pass is coming and steps to meet it
  softTau: 0.33, // [M] s, soft pitch-control temperature (RESEARCH 5.8)
  keeperWeight: 3, // [S] the keeper's control rate x3 (LaurieOnTracking lambda_gk)
  // A marker tracking the runner (race into space, PA8): he moves when the runner moves, not when the pass is played.
  // Without this a centre-back level with our #9 and 2 m from him lost the race to a ball behind the #9 7 times in 10
  // (reaction 0.7 s against the runner's 0.3 s), so a ball into space behind a tightly marked #9 was starred.
  markReaction: 0.3, // [D] s (= receiverReaction): a tracking marker reacts with the runner
  markReach: 3, // [D] m: an opponent this close to the runner tracks him fully...
  markFade: 2, // [D] m ...fading to not at all this much further away
  markBehind: 1, // [D] m: ...when level with the runner or goal-side of him on his run (at most this far behind him)...
  markBehindFade: 2, // [D] m ...fading to not at all this much further behind (a runner who is past him is away)
  // Body block: a defender on or next to the line stops the ball (the lane-open geometry, B3).
  blockReach: 1.0, // [D] m: full block within this of the line...
  blockSoft: 1.5, // [D] m ...fading to none this much further out
  blockMax: 0.9, // [D] a curled or lifted ball beats some blocks
  skip: 1, // [D] m: the passer's own first metre
  shield: 1, // [D] m: the receiver owns the last metre
  runBehind: 3, // [D] a defender past the receiver's last metre (level with him, or behind) blocks as if this many times further
  step: 1, // [D] m between samples along the pass
  keeperMargin: 2, // [D] m: the keeper intercepts only inside his box plus this
  // Execution: a youth ground pass gets less accurate with length (logistic in metres).
  execHalf: 50, // [D] m: 50 % accurate at this length (25 m 0.96, 40 m 0.78)
  execWidth: 8, // [D] m
  // Pressure on the receiver: Andrienko et al. 2017 / Herold et al. 2022 (databallpy) [S]
  dFront: 9, // [S] m, reach of a defender between the receiver and the goal
  dBack: 3, // [S] m, ... of one behind the receiver
  pressureExp: 1.75, // [S]
  loseAtFullPressure: 0.3, // [D] chance to lose it right after receiving at pressure 1
  pressureFree: 0.15, // [D] below this the receiver is free (PA3)
  pressureHigh: 0.6, // [D] at or above this the receiver is under pressure (PA3, PA9)
  // Free run after receiving (PA9)
  roomCap: 8, // [D] m
  roomCone: 45, // [D] degrees either side of the line to goal
  roomMargin: 3, // [D] m kept from the first defender in the cone
  canTurnRoom: 6, // [D] m of room...
  canTurnPressure: 0.3, // [D] ...and pressure below this = the receiver can turn
  // Value (ours, licence-free): V(p) = min(vMax, vA (theta / pi)^vK + vB exp(-d / vL))
  vA: 3, // [D] shaped like published xT/EPV surfaces (low to halfway, steep and central near goal), not fitted
  vK: 1.8, // [D]
  vB: 0.17, // [D]
  vL: 15, // [D] m
  vMax: 0.5, // [D]
  bypassBonus: 0.003, // [D] value per opponent the pass takes out (a teaching prior)
  possessionCost: 0.02, // [D] losing the ball always costs this (about V at halfway)
  transitionFactor: 1.5, // [D] their counter after a turnover is worth more than their settled ball there
  // Space targets ahead of runners (PA8)
  leads: Object.freeze([6, 12]), // [D] m ahead of the runner, straight on or toward goal
  maxSpaceTargets: 3, // [D]
  spaceBehind: 5, // [D] m: runners at most this far behind the ball get a space target
  // Labels and scores
  green: 0.8, // [D] pSafe at or above this (and a receiver not under pressure): good
  red: 0.5, // [D] pSafe below this: cut out
  pointValue: 0.001, // [D] U per score point: 1 point = 0.1 % of a goal
  // [D] points: a risky (amber) pass is ranked and scored this much below its expected utility (worth = U - riskWorth
  // x pointValue, up to twice that as its safety falls to `red`; a cut-out pass twice), so a risky pass is starred
  // only when it is worth clearly more than the best safe one: play forward when it is safe, keep the ball when it is not
  // (PA2-PA5, PA13; research §6.8: "Risky, but worth it" where the reward is big, in front of their goal). A teaching
  // prior for 11-year-olds, measured on generated drills (tests/passdrill.test.js "who's open"): 20 to 40 star the same.
  riskWorth: 20,
  // [D] a good (green) pass never scores below this: you kept the ball with a pass to a teammate in space. 75 = two stars
  // ("Great", starsForScore): at 60 a safe pass to a free #8 earned one star ("Close") whenever the best was a risky
  // ball to the #9 (the Player-mode review); a safe-but-slow one is held below it (tooSafeCap).
  safeFloor: 75,
  redCap: 45, // [D] a cut-out pass scores at most this
  criticalCap: 30, // [D] offside, or across the front of our own goal
  bestMargin: 5, // [D] points: a good pass this close to the best also grades as the best
  notBestCap: 89, // [D] anything else grades below S...
  riskyCap: 74, // [D] ...and a risky (amber) pass that is not the best at most one star, "Close": the label says Risky!
  tooSafeCap: 74, // [D] a safe square or back pass while a good forward pass was on (PA2): one star, "Close"...
  tooSafeGap: 15, // [D] ...when it is more than this many points below the best (the forward pass is clearly better). At
  //                 bestMargin (5) a free #8 beside you was "too safe" 6-10 points below the best in 6 of 10 cases
  forwardWindow: 10, // [D] points: a good forward pass within this of the best counts as "on" (PA2, PA13)...
  fwdOnPressure: 0.3, // [D] ...when its receiver is not marked (pressure below this = canTurnPressure): a safe pass to a free #6
  //                     is not "too safe" next to a forward ball to a #9 with a centre-back 3 m goal-side of him (PA3)
  squareBand: 3, // [D] m: |dx| within this = square
  blockerMin: 0.05, // [D] an option names its likeliest interceptor only from this pInt
  blockerTag: 0.3, // [D] pInt from which the interceptor is the option's problem (PA4)
  beatenBelow: 0.6, // [D] pWin below this: their player gets to the space first (PA8)
  tooLongBelow: 0.85, // [D] pExec below this (about 34 m): a long pass (PA12)
  lineMargin: 1, // [D] m past a line to count as through it (PA5)
  switchLateral: 25, // [D] m across into the far half to count as a switch (PA6, B8)
  switchWide: 6, // [D] m: the target at least this far from the middle
  switchBack: 15, // [D] m: a switch may go this far back at most
  ownGoalZone: Object.freeze({ x1: 30, y0: 18, y1: 50 }), // [D] PA10: the area in front of our goal
  ownGoalReach: 5, // [D] m: the target within this beyond the zone's front
  ownGoalLateral: 15, // [D] m across...
  ownGoalRatio: 1.5, // [D] ...and mostly sideways (|dy| > this x |dx|)...
  ownGoalSafe: 0.9, // [D] ...with a lane below this safety
  cutBackFrom: 88, // [D] the ball at least this far up the pitch...
  cutBackWide: 12, // [D] ...and this far from the middle...
  cutBackMinX: 80, // [D] ...pulled back to a target beyond this x...
  cutBackCentre: 14, // [D] ...within this of the middle (PA11)
  aimRadius: 6, // [D] m: the nearest marker within this sets the far-foot aim (PA7)...
  aimOffset: 0.75, // [D] ...this far from the receiver, away from the marker
  offside: true, // IFAB Law 11; false for a throw-in, goal kick or corner (no offside from those restarts)
});

/** Player-mode stars from a 0-100 score (KID_REDESIGN §6.3; js/rewards.js starsForScore, held equal by a test). */
export const STAR_BANDS = Object.freeze([[3, 90], [2, 75], [1, 55]]); // [D]

/** @param {number} score 0..100 @returns {0|1|2|3} */
export function starsForScore(score) {
  for (const [stars, lo] of STAR_BANDS) if (score >= lo) return stars;
  return 0;
}

const logistic = (x) => 1 / (1 + Math.exp(-x));
const K_LOGIT = Math.PI / Math.sqrt(3); // a logistic with standard deviation sigma: x K / sigma
const merge = (params) => (params ? { ...PASS_DEFAULTS, ...params } : PASS_DEFAULTS);

// ---------------------------------------------------------------- the building blocks (exported for tests and overlays)

/** Angle (radians) the opponents' goal mouth subtends at p. */
export function goalAngle(p) {
  const dx = LENGTH - p.x;
  return Math.abs(Math.atan2(POSTS.bottom - p.y, dx) - Math.atan2(POSTS.top - p.y, dx));
}

/** Our value of having the ball at p (0..vMax): own box 0.004, halfway 0.016, zone 14 0.085, penalty spot 0.254. */
export function value(p, P = PASS_DEFAULTS) {
  const th = goalAngle(p) / Math.PI;
  const d = Math.hypot(LENGTH - p.x, MID_Y - p.y);
  return Math.min(P.vMax, P.vA * th ** P.vK + P.vB * Math.exp(-d / P.vL));
}

/** Their value of having the ball at p (they attack x = 0). */
export const valueOpp = (p, P = PASS_DEFAULTS) => value({ x: LENGTH - p.x, y: WIDTH - p.y }, P);

/** What losing the ball at p costs: always possessionCost, plus their counter from there. */
export const lossCost = (p, P = PASS_DEFAULTS) => P.possessionCost + P.transitionFactor * valueOpp(p, P);

/** Chance a youth ground pass of `len` metres is accurate enough (1 at 0 m, 0.5 at execHalf). */
export const execProb = (len, P = PASS_DEFAULTS) => logistic((P.execHalf - len) / P.execWidth) / logistic(P.execHalf / P.execWidth);

const arrival = (d, P, react = P.reactionTime) => react + d / P.maxSpeed;
const inTheirBox = (x, y, m) => x >= LENGTH - PENALTY_AREA.depth - m && Math.abs(y - MID_Y) <= PENALTY_AREA.width / 2 + m;

/**
 * How likely each opponent is to cut out a ground pass from `ball` to `target`, and the lane's safety.
 * The lane runs from `skip` past the ball to `shield` short of the target (the receiver owns the last metre).
 * Per defender: pRun (Spearman time to intercept, logistic in the best margin over samples every `step` m) and
 * pBlock (a body block, from his closest distance to the lane); pInt = 1 - (1 - pBlock)(1 - pRun); pLane =
 * product of (1 - pInt). The keeper counts only in his box.
 * To feet (a `receiver` given) the receiver steps toward the ball, so the race (pRun) is only run up to where
 * he meets it: a defender beyond the meeting point loses that race. The block still covers the whole lane: a
 * defender standing between the meeting point and the receiver is in the receiver's way, so he gets to the ball.
 * @returns {{ pLane:number, L:number, meet:number, per: {id, role, pInt, pRun, pBlock, margin, at: {x,y,a}, dmin}[], top: object|null }}
 *   per sorted by pInt (largest first); top = per[0]; `at` is where he cuts it out (his closest lane point for a block)
 */
export function laneRisk(ball, target, opponents, P = PASS_DEFAULTS, receiver = null) {
  const L = dist(ball, target);
  const ux = (target.x - ball.x) / (L || 1), uy = (target.y - ball.y) / (L || 1);
  const a0 = Math.min(P.skip, L / 2);
  const aEnd = Math.max(a0, L - P.shield);
  let a1 = aEnd;
  if (receiver) {
    // Where the receiver, stepping from the target toward the ball, meets it (closed form).
    const aMeet = ((P.receiverReaction + L / P.maxSpeed) * P.ballSpeed * P.maxSpeed) / (P.maxSpeed + P.ballSpeed);
    a1 = Math.max(a0, Math.min(aEnd, aMeet));
  }
  const n = Math.max(1, Math.ceil((a1 - a0) / P.step));
  const run = aEnd > a1 + 1e-9; // the receiver's run to the ball, from the meeting point back to his last metre
  const per = [];
  let pLane = 1;
  for (const o of opponents) {
    const gk = o.role === 'GK';
    let best = -Infinity, ax = 0, ay = 0, aa = 0, dmin = Infinity, cx = 0, cy = 0, ca = 0;
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      const sx = ball.x + ux * a, sy = ball.y + uy * a;
      if (gk && !inTheirBox(sx, sy, P.keeperMargin)) continue;
      const d = Math.hypot(sx - o.x, sy - o.y);
      if (d < dmin) { dmin = d; cx = sx; cy = sy; ca = a; }
      const m = a / P.ballSpeed - arrival(d, P);
      if (m > best) { best = m; ax = sx; ay = sy; aa = a; }
    }
    if (run) {
      // A defender standing in the receiver's run to the ball is in his way: he blocks it. Only one in front of the
      // receiver's last metre: one level with the receiver or behind him (beyond aEnd) is pressure, not a block, so
      // the distance past that end counts runBehind times over.
      const ox = o.x - ball.x, oy = o.y - ball.y;
      const along = ox * ux + oy * uy, perp = Math.abs(ox * uy - oy * ux);
      if (along >= a1) {
        const a = Math.min(along, aEnd), d = Math.hypot(perp, P.runBehind * Math.max(0, along - aEnd));
        const sx = ball.x + ux * a, sy = ball.y + uy * a;
        if (d < dmin && !(gk && !inTheirBox(sx, sy, P.keeperMargin))) { dmin = d; cx = sx; cy = sy; ca = a; }
      }
    }
    if (best === -Infinity && dmin === Infinity) continue;
    const pRun = best === -Infinity ? 0 : logistic((best * K_LOGIT) / P.sigma);
    const pBlock = P.blockMax * clamp(1 - (dmin - P.blockReach) / P.blockSoft, 0, 1);
    const pInt = 1 - (1 - pBlock) * (1 - pRun);
    const at = pBlock > pRun || best === -Infinity ? { x: cx, y: cy, a: ca } : { x: ax, y: ay, a: aa };
    per.push({ id: o.id, role: o.role, pInt, pRun, pBlock, margin: best, at, dmin });
    pLane *= 1 - pInt;
  }
  per.sort((a, b) => b.pInt - a.pInt);
  return { pLane, L, meet: a1, per, top: per[0] ?? null };
}

/**
 * Soft pitch control at p for a ball arriving after tBall s (RESEARCH 5.8 closed form): our runner's share
 * against every opponent (the keeper x keeperWeight, and only in his box). Our runner reacts in receiverReaction,
 * an opponent in reactionTime, except one tracking the runner (markedBy): he moves when the runner moves
 * (markReaction), so a marker level with the runner or goal-side of him contests the ball.
 * @returns {{ pWin:number, rival: object|null }}  rival: the opponent with the largest share
 */
export function raceAt(p, runner, opponents, tBall, P = PASS_DEFAULTS) {
  const w = (q, react) => Math.exp(-Math.max(tBall, arrival(dist(q, p), P, react)) / P.softTau);
  const wr = w(runner, P.receiverReaction);
  let wd = 0, rival = null, top = 0;
  const keeperIn = inTheirBox(p.x, p.y, P.keeperMargin);
  for (const o of opponents) {
    const gk = o.role === 'GK';
    if (gk && !keeperIn) continue;
    const react = gk ? P.reactionTime : P.reactionTime - markedBy(o, runner, p, P) * (P.reactionTime - P.markReaction);
    const wo = (gk ? P.keeperWeight : 1) * w(o, react);
    wd += wo;
    if (wo > top) { top = wo; rival = o; }
  }
  return { pWin: wr / (wr + wd), rival };
}

/**
 * How closely opponent `o` tracks a runner heading for p (0..1): fully within markReach of him (fading over markFade)
 * and level with him or goal-side of him on his run (at most markBehind behind him, fading over markBehindFade).
 */
export function markedBy(o, runner, p, P = PASS_DEFAULTS) {
  const dx = o.x - runner.x, dy = o.y - runner.y;
  const near = clamp(1 - (Math.hypot(dx, dy) - P.markReach) / P.markFade, 0, 1);
  if (!(near > 0)) return 0;
  const rl = Math.hypot(p.x - runner.x, p.y - runner.y);
  const behind = rl > 1e-9 ? -(dx * (p.x - runner.x) + dy * (p.y - runner.y)) / rl : 0; // metres behind the runner on his run
  return near * clamp(1 - (behind - P.markBehind) / P.markBehindFade, 0, 1);
}

/**
 * Pressure on a player at p attacking toward (105, 34): the Andrienko/Herold oval, dFront toward that goal
 * and dBack behind, (1 - d/L)^pressureExp per opponent (keepers excluded), summed and capped at 1.
 * @returns {{ pressure:number, presser: object|null }}
 */
export function pressureAt(p, opponents, P = PASS_DEFAULTS) {
  const gx = LENGTH - p.x, gy = MID_Y - p.y, gl = Math.hypot(gx, gy) || 1;
  let sum = 0, presser = null, top = 0;
  for (const o of opponents) {
    if (o.role === 'GK') continue;
    const ox = o.x - p.x, oy = o.y - p.y, d = Math.hypot(ox, oy);
    const z = (1 + (d > 0 ? (ox * gx + oy * gy) / (d * gl) : 1)) / 2;
    const Lz = P.dBack + ((P.dFront - P.dBack) * (z ** 3 + 0.3 * z)) / 1.3;
    if (d >= Lz) continue;
    const v = (1 - d / Lz) ** P.pressureExp;
    sum += v;
    if (v > top) { top = v; presser = o; }
  }
  return { pressure: Math.min(1, sum), presser };
}

/**
 * Metres a player at p can run toward the opponents' goal before the first defender in a ±roomCone cone
 * (less roomMargin), capped at roomCap. dir: the unit vector toward the goal centre.
 * @returns {{ room:number, dir: {x:number,y:number} }}
 */
export function roomAt(p, opponents, P = PASS_DEFAULTS) {
  const gx = LENGTH - p.x, gy = MID_Y - p.y, gl = Math.hypot(gx, gy) || 1;
  const cosCone = Math.cos((P.roomCone * Math.PI) / 180);
  let room = Math.min(P.roomCap, gl);
  for (const o of opponents) {
    const ox = o.x - p.x, oy = o.y - p.y, d = Math.hypot(ox, oy);
    if (d === 0) { room = 0; break; }
    if ((ox * gx + oy * gy) / (d * gl) >= cosCone) room = Math.min(room, Math.max(0, d - P.roomMargin));
  }
  return { room, dir: { x: gx / gl, y: gy / gl } };
}

/** Their lines (median x): front (their forwards), mid (#6 and #8s), back (back four), and secondLast (their offside line player). */
export function oppLines(frame) {
  const opp = frame.players.filter((p) => p.team === 'them');
  const xs = opp.map((p) => p.x).sort((a, b) => b - a);
  const at = (roles) => median(opp.filter((p) => roles.includes(p.role)).map((p) => p.x));
  return { front: at(FORWARDS), mid: at(MIDFIELD), back: at(BACK_LINE), secondLast: xs[1] ?? LENGTH };
}

/**
 * The same moment seen from the other team: rotated 180 degrees about the centre spot, teams swapped,
 * ids kept. Rate the opponents' passes with rateOptions(swapTeams(frame), theirCarrierId).
 */
export function swapTeams(frame) {
  const flip = (p) => ({ x: LENGTH - p.x, y: WIDTH - p.y });
  const team = { us: 'them', them: 'us', none: 'none' };
  return {
    ...frame,
    ball: flip(frame.ball),
    possession: team[frame.possession] ?? frame.possession,
    players: frame.players.map((p) => ({ ...p, team: team[p.team], ...flip(p) })),
  };
}

// ---------------------------------------------------------------- names

const KID_POSITION = Object.freeze({ GK: 'keeper', CB: 'defender', FB: 'defender', DM: 'midfielder', CM: 'midfielder', W: 'winger', ST: 'striker' });

/** Simple-wording name: 'your winger', 'their midfielder' (never a code or a side). */
export function kidName(p) {
  if (!p) return 'the ball';
  const whose = p.team === 'us' ? 'your' : 'their';
  return `${whose} ${KID_POSITION[ROLE_INFO[p.role]?.family] ?? (p.team === 'us' ? 'teammate' : 'player')}`;
}

// ---------------------------------------------------------------- rating

/**
 * Rate every pass option for the player on the ball.
 * @param {import('./types.js').Frame} frame  canonical frame; the carrier must be one of us
 * @param {string} [carrierId=frame.carrierId]
 * @param {object} [params]  PASS_DEFAULTS overrides
 * @returns {PassRating} {
 *   carrierId, ball, vBall, lines: { front, mid, back, secondLast }, offsideX,
 *   options: PassOption[] (score, then worth, descending), best: PassOption (= options[0]), fwdOn: boolean (a good forward
 *   pass to a receiver who is not marked, within forwardWindow of the best), params }
 * PassOption = { id ('us-LCM', or 'us-LW@space'), targetId, kind: 'feet'|'space', point, aim, receiverAt, len,
 *   direction: 'forward'|'square'|'back', pSafe, pLane, pExec, pWin,
 *   blocker: { id, pInt, at, via: 'block'|'run' } | null, receiverPressure, presserId, room, bypassed,
 *   lineBroken: 'front'|'mid'|'back'|null, offside, acrossOwnGoal, value, valueGain, U (expected utility, goals),
 *   worth (U less the risk premium: what options are ranked and scored by), score 0..100,
 *   colour: 'green'|'amber'|'red', label: 'best'|'good'|'risky'|'cut-out'|'offside'|'danger', critical,
 *   tags: [{ tag, principle, kind: 'problem'|'strength'|'direction', weight, who?, kidWho?, whoId?, n? }] }
 */
export function rateOptions(frame, carrierId = frame.carrierId, params) {
  const P = merge(params);
  const carrier = frame.players.find((p) => p.id === carrierId);
  if (!carrier) throw new TypeError(`rateOptions: no carrier ${carrierId}`);
  if (carrier.team !== 'us') throw new TypeError('rateOptions: the carrier must be one of us (rate their passes on swapTeams(frame))');
  const ball = frame.ball;
  const mates = frame.players.filter((p) => p.team === 'us' && p.id !== carrierId);
  const opps = frame.players.filter((p) => p.team === 'them');
  const lines = oppLines(frame);
  const offsideX = Math.max(ball.x, lines.secondLast, HALF_X);
  const vBall = value(ball, P);
  const nameCtx = { learner: { id: carrierId, family: ROLE_INFO[carrier.role]?.family } };

  /** Everything about one target (internal: the public option is built by finish()). */
  const assess = (mate, point, kind) => {
    const lane = laneRisk(ball, point, opps, P, kind === 'feet' ? mate : null);
    const race = kind === 'space' ? raceAt(point, mate, opps, lane.L / P.ballSpeed, P) : { pWin: 1, rival: null };
    const pExec = execProb(lane.L, P);
    const pSafe = pExec * lane.pLane * race.pWin;
    const pr = pressureAt(point, opps, P);
    const rm = roomAt(point, opps, P);
    // Opponents taken out (Impect): nearer their goal than the ball before the pass, and not nearer than the target after.
    const dG = (q) => Math.hypot(LENGTH - q.x, MID_Y - q.y);
    const bypassed = opps.filter((o) => o.role !== 'GK' && dG(o) < dG(ball) && dG(o) >= dG(point)).length;
    const vRec = Math.max(value(point, P), value({ x: point.x + rm.dir.x * rm.room, y: point.y + rm.dir.y * rm.room }, P)) + P.bypassBonus * bypassed;
    const q = 1 - P.loseAtFullPressure * pr.pressure;
    const cT = lossCost(point, P), cB = lane.top ? lossCost(lane.top.at, P) : cT;
    const U = pExec * lane.pLane * race.pWin * (q * vRec - (1 - q) * cT) // completed: kept, or lost right after receiving
      - (1 - lane.pLane) * cB // cut out on the way
      - lane.pLane * (1 - pExec) * 0.5 * cT // misplaced: a loose ball near the target
      - pExec * lane.pLane * (1 - race.pWin) * cT; // beaten to a pass into space
    const dx = point.x - ball.x, dy = point.y - ball.y;
    const offside = P.offside && mate.x > offsideX + 1e-9; // F4: the receiver (or runner) is offside now
    const z = P.ownGoalZone;
    const acrossOwnGoal = ball.x < z.x1 && point.x < z.x1 + P.ownGoalReach && Math.abs(dy) >= P.ownGoalLateral &&
      Math.abs(dy) > P.ownGoalRatio * Math.abs(dx) && segmentHitsBox(ball, point, 0, z.x1, z.y0, z.y1) && lane.pLane < P.ownGoalSafe;
    const critical = offside || acrossOwnGoal;
    const colour = critical || pSafe < P.red ? 'red' : pSafe >= P.green && pr.pressure < P.pressureHigh ? 'green' : 'amber';
    const direction = dx > P.squareBand ? 'forward' : dx < -P.squareBand ? 'back' : 'square';
    // What the rating ranks and scores by (a runner's space target is picked by it too): U, less riskWorth points for a
    // risky pass, up to twice that as it nears a cut-out (and twice for one), so a risky pass has to be worth clearly
    // more than a safe one. Live (sequence.js) plays on U.
    const risk = colour === 'green' ? 0 : colour === 'red' ? 2 : 1 + clamp((P.green - pSafe) / (P.green - P.red), 0, 1);
    const worth = U - risk * P.riskWorth * P.pointValue;
    return { mate, point, kind, lane, race, pExec, pSafe, pr, rm, bypassed, vRec, U, worth, dx, dy, offside, acrossOwnGoal, critical, colour, direction };
  };

  const raw = [];
  for (const m of mates) raw.push(assess(m, { x: m.x, y: m.y }, 'feet'));
  if (!raw.length) throw new TypeError('rateOptions: nobody to pass to');
  const space = [];
  for (const m of mates) {
    if (m.role === 'GK' || ROLE_INFO[m.role]?.family === 'CB' || m.x < ball.x - P.spaceBehind || (P.offside && m.x > offsideX)) continue;
    let top = null;
    const gl = Math.hypot(LENGTH - m.x, MID_Y - m.y) || 1;
    for (const lead of P.leads) {
      for (const u of [{ x: 1, y: 0 }, { x: (LENGTH - m.x) / gl, y: (MID_Y - m.y) / gl }]) {
        const pt = { x: clamp(m.x + u.x * lead, 1, LENGTH - 1.5), y: clamp(m.y + u.y * lead, 1, WIDTH - 1) };
        const o = assess(m, pt, 'space');
        if (!top || o.worth > top.worth) top = o;
      }
    }
    if (top) space.push(top);
  }
  space.sort((a, b) => b.worth - a.worth);
  // A tie across the cut drops every tied target, so a frame and its mirror rate the same options (a symmetric frame's
  // left and right runners are worth the same, and which of them the sort put first must not decide).
  let cut = Math.min(P.maxSpaceTargets, space.length);
  if (cut < space.length && space[cut - 1].worth - space[cut].worth <= 1e-9) {
    const tie = space[cut].worth;
    while (cut > 0 && space[cut - 1].worth - tie <= 1e-9) cut--;
  }
  raw.push(...space.slice(0, cut));

  // Scores: the worth given up against the best option that can be starred (not critical, and not cut out while any
  // pass is not), on a fixed scale, then the category rules. So the starred pass always scores 100.
  const open = raw.filter((o) => !o.critical && o.colour !== 'red');
  const pool = open.length ? open : raw.filter((o) => !o.critical);
  const Wbest = Math.max(...(pool.length ? pool : raw).map((o) => o.worth));
  for (const o of raw) {
    let s = 100 - (Wbest - o.worth) / P.pointValue;
    if (o.colour === 'green') s = Math.max(s, P.safeFloor);
    if (o.colour === 'red') s = Math.min(s, P.redCap);
    if (o.critical) s = Math.min(s, P.criticalCap);
    o.score = Math.round(clamp(s, 0, 100));
  }
  raw.sort((a, b) => b.score - a.score || b.worth - a.worth);
  const bestScore = raw[0].score;
  const fwdOn = raw.some((o) => o.colour === 'green' && o.direction === 'forward' && o.pr.pressure < P.fwdOnPressure && o.score >= bestScore - P.forwardWindow);

  const finish = (o, isBest) => {
    const top = o.lane.top;
    const blocker = top && top.pInt >= P.blockerMin
      ? { id: top.id, pInt: top.pInt, at: { x: top.at.x, y: top.at.y }, via: top.pBlock >= top.pRun ? 'block' : 'run' } : null;
    const tags = tagsOf(o, { ball, lines, P, fwdOn, isBest, bestScore, nameCtx });
    const lineTag = tags.find((t) => LINE_TAGS[t.tag]);
    const label = o.critical ? (o.offside ? 'offside' : 'danger') : isBest ? 'best' : { green: 'good', amber: 'risky', red: 'cut-out' }[o.colour];
    return {
      id: o.kind === 'space' ? `${o.mate.id}@space` : o.mate.id,
      targetId: o.mate.id,
      kind: o.kind,
      point: { x: o.point.x, y: o.point.y },
      aim: aimFor(o, opps, P),
      receiverAt: { x: o.mate.x, y: o.mate.y },
      len: o.lane.L,
      direction: o.direction,
      pSafe: o.pSafe,
      pLane: o.lane.pLane,
      pExec: o.pExec,
      pWin: o.race.pWin,
      blocker,
      receiverPressure: o.pr.pressure,
      presserId: o.pr.presser?.id ?? null,
      room: o.rm.room,
      bypassed: o.bypassed,
      lineBroken: lineTag ? LINE_TAGS[lineTag.tag] : null,
      offside: o.offside,
      acrossOwnGoal: o.acrossOwnGoal,
      value: o.vRec,
      valueGain: o.vRec - vBall,
      U: o.U,
      worth: o.worth,
      score: o.score,
      colour: o.colour,
      label,
      critical: o.critical,
      tags,
    };
  };
  const options = raw.map((o, i) => finish(o, i === 0));
  return { carrierId, ball: { x: ball.x, y: ball.y }, vBall, lines, offsideX, options, best: options[0], fwdOn, params: P };
}

const LINE_TAGS = Object.freeze({ 'breaks-first-line': 'front', 'breaks-midfield-line': 'mid', 'in-behind': 'back' });

/** Far-foot aim (PA7): the receiver's feet, moved aimOffset away from the nearest marker within aimRadius. */
function aimFor(o, opps, P) {
  if (o.kind === 'space') return { x: o.point.x, y: o.point.y };
  let near = null, nd = P.aimRadius;
  for (const q of opps) {
    const d = dist(q, o.point);
    if (d < nd && d > 1e-9) { nd = d; near = q; }
  }
  if (!near) return { x: o.point.x, y: o.point.y };
  return clampToPitch({ x: o.point.x + ((o.point.x - near.x) / nd) * P.aimOffset, y: o.point.y + ((o.point.y - near.y) / nd) * P.aimOffset });
}

function segmentHitsBox(a, b, x0, x1, y0, y1) {
  for (let k = 0; k <= 20; k++) {
    const t = k / 20, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
  }
  return false;
}

/** The reasons attached to one option (docs/research/passing.md §4.4), strongest first within each kind. */
function tagsOf(o, { ball, lines, P, fwdOn, isBest, bestScore, nameCtx }) {
  const t = [];
  const add = (tag, extra = {}) => t.push({ tag, principle: PASS_TAGS[tag].principles[0], kind: PASS_TAGS[tag].kind, weight: PASS_TAGS[tag].weight, ...extra });
  const who = (p) => (p ? { who: nameOf(p, nameCtx), kidWho: kidName(p), whoId: p.id } : {});
  const { dx, dy, point } = o;
  if (o.offside) add('offside');
  if (o.acrossOwnGoal) add('across-own-goal');
  const b = o.lane.top;
  if (b && b.pInt >= P.blockerTag) {
    const opp = { id: b.id, role: b.role, team: 'them' };
    add(b.pBlock >= b.pRun ? 'blocked' : 'reachable', { ...who(opp), weight: 2 + b.pInt });
  }
  if (o.kind === 'space' && o.race.pWin < P.beatenBelow && o.race.rival) add('beaten-to-it', who(o.race.rival));
  if (o.pExec < P.tooLongBelow) add('too-long');
  if (o.pr.pressure >= P.pressureHigh) add('under-pressure', { ...who(o.pr.presser), weight: 1 + o.pr.pressure });
  else if (o.pr.pressure < P.pressureFree && o.kind === 'feet') add('free');
  if (o.rm.room >= P.canTurnRoom && o.pr.pressure < P.canTurnPressure && dx > -P.squareBand) add('can-turn');
  const m = P.lineMargin;
  if (ball.x < lines.front - m && point.x > lines.front + m && !(point.x > lines.mid + m)) add('breaks-first-line', { n: o.bypassed });
  if (ball.x < lines.mid - m && point.x > lines.mid + m && !(point.x > lines.back + m)) add('breaks-midfield-line', { n: o.bypassed });
  if (point.x > lines.back + m && ball.x < lines.back) add('in-behind', { n: o.bypassed });
  if (Math.abs(dy) >= P.switchLateral && (point.y - MID_Y) * (ball.y - MID_Y) < 0 && Math.abs(point.y - MID_Y) >= P.switchWide && dx > -P.switchBack) add('switch');
  if (o.kind === 'space') add('into-space');
  if (point.x >= ZONE_14.x0 && point.x <= ZONE_14.x1 && point.y >= ZONE_14.y0 && point.y <= ZONE_14.y1) add('zone-14');
  if (ball.x > P.cutBackFrom && Math.abs(ball.y - MID_Y) > P.cutBackWide && point.x < ball.x && point.x > P.cutBackMinX && Math.abs(point.y - MID_Y) < P.cutBackCentre) add('cut-back');
  add(o.direction);
  // PA2 / PA13: a safe square or back pass while a good forward pass was on is too safe (gradePass caps it);
  // with nothing forward on, the best safe one is right.
  if (!isBest && fwdOn && o.colour === 'green' && o.direction !== 'forward' && !o.critical && bestScore - o.score > Math.max(P.bestMargin, P.tooSafeGap)) add('too-safe');
  if (isBest && o.colour === 'green' && o.direction !== 'forward' && !fwdOn) add('keep-it');
  const recv = { to: nameOf(o.mate, nameCtx), kidTo: kidName(o.mate) };
  for (const x of t) Object.assign(x, recv);
  return t;
}

// ---------------------------------------------------------------- tags and words

const capName = (v, key, fallback) => cap(v?.[key] || fallback);

/**
 * Every reason an option can carry: principle(s), kind (a problem, a strength, or only a direction), weight
 * (problems: severity; strengths: how much it says about the pass; blocked, reachable and under-pressure add
 * pInt or the pressure at run time), and one sentence per wording. Simple (kid) sentences are at most 12
 * words, name players by position words ("their midfielder") and never use codes; standard ones may use nameOf().
 * Text functions get the tag instance: { who, kidWho (the blocker, presser or rival), to, kidTo (the receiver), n }.
 */
export const PASS_TAGS = Object.freeze({
  offside: {
    principles: ['F4'], kind: 'problem', weight: 3,
    text: {
      standard: (v) => `${capName(v, 'to', 'your teammate')} is offside, so the pass would be given against you.`,
      kid: (v) => `${capName(v, 'kidTo', 'your teammate')} is offside there.`,
    },
  },
  'across-own-goal': {
    principles: ['PA10'], kind: 'problem', weight: 3,
    text: {
      standard: () => 'A pass across the front of your own goal gives them a chance if it is cut out.',
      kid: () => 'Never pass across the front of your own goal.',
    },
  },
  blocked: {
    principles: ['PA4'], kind: 'problem', weight: 2,
    text: {
      standard: (v) => `${capName(v, 'who', 'a defender')} is standing in the passing lane and would cut it out.`,
      kid: (v) => `${capName(v, 'kidWho', 'a defender')} is in the way.`,
    },
  },
  reachable: {
    principles: ['PA4', 'PA12'], kind: 'problem', weight: 2,
    text: {
      standard: (v) => `${capName(v, 'who', 'a defender')} can get across before the ball arrives.`,
      kid: (v) => `${capName(v, 'kidWho', 'a defender')} can get to the ball first.`,
    },
  },
  'beaten-to-it': {
    principles: ['PA8'], kind: 'problem', weight: 2,
    text: {
      standard: (v) => `${capName(v, 'who', 'a defender')} reaches that space before your runner.`,
      kid: (v) => `${capName(v, 'kidWho', 'a defender')} gets to that space first.`,
    },
  },
  'too-long': {
    principles: ['PA12'], kind: 'problem', weight: 1.5,
    text: {
      standard: () => 'A pass that long is hard to play accurately, so it needs a wide-open lane.',
      kid: () => 'That pass is long, so it is hard to play well.',
    },
  },
  'under-pressure': {
    principles: ['PA3', 'PA9'], kind: 'problem', weight: 1,
    text: {
      standard: (v) => `${capName(v, 'to', 'your teammate')} has ${v?.who || 'a defender'} tight on them and can't turn.`,
      kid: (v) => `${capName(v, 'kidWho', 'a defender')} is very close to ${v?.kidTo || 'your teammate'}.`,
    },
  },
  'too-safe': {
    principles: ['PA2'], kind: 'problem', weight: 0.5,
    text: {
      standard: () => 'It keeps the ball, but a safe forward pass was on.',
      kid: () => 'Safe, but a forward pass was on.',
    },
  },
  free: {
    principles: ['PA3'], kind: 'strength', weight: 1,
    text: {
      standard: (v) => `${capName(v, 'to', 'your teammate')} has time and space.`,
      kid: (v) => `${capName(v, 'kidTo', 'your teammate')} is free, with nobody close.`,
    },
  },
  'can-turn': {
    principles: ['PA9'], kind: 'strength', weight: 1,
    text: {
      standard: (v) => `${capName(v, 'to', 'your teammate')} can turn and run at their back line.`,
      kid: (v) => `${capName(v, 'kidTo', 'your teammate')} can turn and run at goal.`,
    },
  },
  'breaks-first-line': {
    principles: ['PA5'], kind: 'strength', weight: 2,
    text: {
      standard: (v) => `It gets past their front players${v?.n > 1 ? ` and takes ${v.n} opponents out of the game` : ''}.`,
      kid: () => 'It gets past their front players.',
    },
  },
  'breaks-midfield-line': {
    principles: ['PA5'], kind: 'strength', weight: 3,
    text: {
      standard: (v) => `It goes past their midfield${v?.n > 1 ? ` and takes ${v.n} opponents out of the game` : ''}.`,
      kid: () => 'It goes past their midfielders.',
    },
  },
  'in-behind': {
    principles: ['PA5'], kind: 'strength', weight: 3,
    text: {
      standard: (v) => `It gets in behind their back line${v?.n > 1 ? ` and takes ${v.n} opponents out of the game` : ''}.`,
      kid: () => 'It gets in behind their defenders.',
    },
  },
  switch: {
    principles: ['PA6'], kind: 'strength', weight: 2,
    text: {
      standard: () => 'Switching play moves the ball away from the crowd to the free side.',
      kid: () => 'It goes to the free side, away from the crowd.',
    },
  },
  'into-space': {
    // [D] 3.5: a pass into space always leads with the run (it outranks every line broken on the way)
    principles: ['PA8'], kind: 'strength', weight: 3.5,
    text: {
      standard: (v) => `A pass into space lets ${v?.to || 'your teammate'} run onto it.`,
      kid: (v) => `${capName(v, 'kidTo', 'your teammate')} can run onto it.`,
    },
  },
  'zone-14': {
    principles: ['PA11'], kind: 'strength', weight: 2,
    text: {
      standard: () => 'It finds a teammate in the most dangerous area, just in front of their box.',
      kid: () => 'It reaches the space just in front of their box.',
    },
  },
  'cut-back': {
    principles: ['PA11'], kind: 'strength', weight: 3,
    text: {
      standard: () => 'A pull-back from near the end line finds a teammate in front of goal.',
      kid: () => 'Pull it back to a teammate in front of goal.',
    },
  },
  'keep-it': {
    principles: ['PA13'], kind: 'strength', weight: 2,
    text: {
      standard: () => 'With nothing forward on, keeping the ball is right.',
      kid: () => 'Nothing forward? Keep the ball and look again.',
    },
  },
  forward: {
    principles: ['PA2'], kind: 'strength', weight: 1,
    text: {
      standard: () => 'It moves the ball forward safely.',
      kid: () => 'It moves the ball forward.',
    },
  },
  back: {
    principles: ['PA13'], kind: 'direction', weight: 0,
    text: { standard: () => 'It goes back.', kid: () => 'It goes back.' },
  },
  square: {
    principles: ['PA13'], kind: 'direction', weight: 0,
    text: { standard: () => 'It goes sideways.', kid: () => 'It goes sideways.' },
  },
});

/** Lines for an option with no reason that fits (by colour), and the prefix for a risky best. */
export const PASS_FALLBACK = Object.freeze({
  safe: Object.freeze({ principle: 'PA13', standard: 'A safe pass that keeps the ball.', kid: 'A safe pass that keeps the ball.' }),
  risky: Object.freeze({ principle: 'PA4', standard: 'It could go wrong, so look for a safer pass.', kid: 'It could go wrong, so look for a safer pass.' }),
  'cut-out': Object.freeze({ principle: 'PA4', standard: 'Their defenders are likely to cut this pass out.', kid: 'Their players will probably cut it out.' }),
  riskyBest: Object.freeze({ standard: 'Risky, but worth it.', kid: 'Risky, but worth it.' }),
  // A good pass whose main reason is the same as the best's: say what made the best one better.
  safer: Object.freeze({ principle: 'PA4', standard: 'A good pass, but the best one was safer.', kid: 'Good, but the best pass was safer.' }),
  further: Object.freeze({ principle: 'PA2', standard: 'A good pass, but the best one gets the ball nearer their goal.', kid: 'Good, but the best pass gets closer to goal.' }),
  close: Object.freeze({ principle: 'PA2', standard: 'A good pass, and nearly as good as the best one.', kid: 'Good pass. The best one was just a bit better.' }),
});

/** The consequence shown as the ball travels (sounds never carry the meaning alone). */
export const PASS_HEADLINES = Object.freeze({
  kid: Object.freeze({ offside: 'Offside!', danger: 'Danger!', 'cut-out': 'Cut out!', risky: 'Risky!', 'line-broken': 'Line broken!', safe: 'Safe pass.' }),
  standard: Object.freeze({ offside: 'Offside.', danger: 'Dangerous pass.', 'cut-out': 'Cut out.', risky: 'Risky pass.', 'line-broken': 'Line broken.', safe: 'Pass completed.' }),
});

/** A short question pointing at what the pitch highlights for the option's main reason. */
export const PASS_CUES = Object.freeze({
  kid: Object.freeze({
    offside: 'Is your teammate past their last defender?', 'across-own-goal': 'What if it gets cut out here?', blocked: 'Is anyone in the path of the ball?',
    reachable: 'Who can get to the ball first?', 'beaten-to-it': 'Who gets to that space first?', 'too-long': 'How far is that pass?',
    'under-pressure': 'Is anyone very close to your teammate?', 'too-safe': 'Was a forward pass on?', line: 'Which of their players does it get past?',
    space: 'Where can your teammate run?', pass: 'Where does the pass go?',
  }),
  standard: Object.freeze({
    offside: 'Where is their offside line?', 'across-own-goal': 'What happens if this is cut out in front of your goal?', blocked: 'Is the passing lane clear?',
    reachable: 'Who reaches the pass first?', 'beaten-to-it': 'Who wins the race to that space?', 'too-long': 'How accurate can a pass that long be?',
    'under-pressure': 'How tightly is the receiver marked?', 'too-safe': 'Was a safe forward pass on?', line: 'Which line of theirs does it break?',
    space: 'Where is the space ahead of the runner?', pass: 'Where does the pass go?',
  }),
});

const wordingOf = (w) => (w === 'standard' ? 'standard' : 'kid');
const byWeight = (a, b) => b.weight - a.weight;

/** Find an option by id ('us-LCM', 'us-LW@space'); a bare player id finds the pass to feet. */
export function optionOf(rating, choiceId) {
  return rating?.options?.find((o) => o.id === choiceId) ?? null;
}

// ---------------------------------------------------------------- grading and explaining

/**
 * Grade the learner's choice. S: the best, a good option within bestMargin of it, or a coach-keyed `accept`
 * id; otherwise the option's score capped at notBestCap, a risky one at riskyCap, a safe-but-slow option (too-safe)
 * at tooSafeCap (any other good pass never drops below safeFloor), a cut-out one at redCap and a critical one at
 * criticalCap. So in stars: the best 3; a good pass 2 (a safe-but-slow one 1); a risky one at most 1; a cut-out 0.
 * We grade the decision, not a dice roll: the outcome is the most likely one.
 * @returns {{ score:number, grade:'S'|'A'|'B'|'C'|'D'|'F', stars:0|1|2|3, outcome:'completed'|'risky'|'cut-out'|'offside'|'danger',
 *             isBest:boolean, option: PassOption } | null}  null for an unknown choice
 */
export function gradePass(rating, choiceId, { accept = [] } = {}) {
  const o = optionOf(rating, choiceId);
  if (!o) return null;
  const P = rating.params ?? PASS_DEFAULTS;
  const best = rating.best;
  const isBest = o.id === best.id || accept.includes(o.id) || (o.colour === 'green' && best.score - o.score <= P.bestMargin);
  let score = o.score;
  if (isBest) score = Math.max(score, o.id === best.id ? score : best.score - P.bestMargin);
  else {
    score = Math.min(score, P.notBestCap);
    if (o.colour === 'amber') score = Math.min(score, P.riskyCap);
    if (o.tags.some((t) => t.tag === 'too-safe')) score = Math.min(score, P.tooSafeCap);
  }
  const outcome = o.offside ? 'offside' : o.critical ? 'danger' : o.colour === 'red' ? 'cut-out' : o.colour === 'amber' ? 'risky' : 'completed';
  return { score, grade: gradeOf(score), stars: starsForScore(score), outcome, isBest, option: o };
}

/**
 * The sentence for one option: why it is best (asBest), or its main problem, or its main strength. focus: principle
 * ids to lead with when the option has a strength that teaches one (a drill's principles).
 */
function lineFor(o, wording, asBest, focus) {
  const problems = o.tags.filter((t) => t.kind === 'problem').sort(byWeight);
  const strengths = o.tags.filter((t) => t.kind === 'strength').sort(byWeight);
  const neg = problems[0];
  const pos = (focus?.length && strengths.find((t) => focus.includes(t.principle))) || strengths[0];
  const say = (t) => ({ text: PASS_TAGS[t.tag].text[wording](t), principleId: t.principle, tag: t.tag });
  const fallback = (key) => ({ text: PASS_FALLBACK[key][wording], principleId: PASS_FALLBACK[key].principle, tag: key });
  if (asBest) {
    const main = pos ? say(pos) : fallback(o.colour === 'green' ? 'safe' : 'risky');
    if (o.colour === 'amber' && pos) main.text = `${PASS_FALLBACK.riskyBest[wording]} ${main.text}`;
    return main;
  }
  if (o.colour === 'green') {
    const tooSafe = problems.find((t) => t.tag === 'too-safe');
    if (tooSafe) return say(tooSafe);
    const t = !neg || neg.weight < 1.5 ? pos ?? neg : neg;
    return t ? say(t) : fallback('safe');
  }
  return neg ? say(neg) : fallback(o.colour === 'red' ? 'cut-out' : 'risky');
}

/** What the pitch should highlight for an option's main reason (a rule-cue object, docs/ARCHITECTURE.md §5.5). */
function cueFor(o, rating, wording, main) {
  const tag = o.tags.find((t) => t.tag === main.tag);
  const seg = { type: 'segment', a: { ...rating.ball }, b: { ...o.point } };
  let key = 'pass', highlight = seg;
  switch (main.tag) {
    case 'blocked': case 'reachable':
      key = main.tag;
      highlight = o.blocker ? { type: 'player', id: o.blocker.id } : seg;
      break;
    case 'beaten-to-it': case 'under-pressure':
      key = main.tag;
      highlight = tag?.whoId ? { type: 'player', id: tag.whoId } : seg;
      break;
    case 'offside':
      key = 'offside';
      highlight = { type: 'line-x', x: rating.offsideX };
      break;
    case 'across-own-goal': case 'too-long':
      key = main.tag;
      break;
    case 'too-safe':
      key = 'too-safe';
      highlight = { type: 'segment', a: { ...rating.ball }, b: { ...rating.best.point } };
      break;
    case 'breaks-first-line': case 'breaks-midfield-line': case 'in-behind':
      key = 'line';
      highlight = { type: 'line-x', x: rating.lines[LINE_TAGS[main.tag]] };
      break;
    case 'into-space':
      key = 'space';
      highlight = { type: 'segment', a: { ...o.receiverAt }, b: { ...o.point } };
      break;
    default:
  }
  return { text: PASS_CUES[wording][key], highlight, principleId: main.principleId };
}

/**
 * Explain the learner's choice: the consequence, one line on the choice (why it is best, or what is
 * wrong with it), one on the best when the choice was not as good, up to two more reasons, and a cue.
 * Simple (kid) wording keeps every line to 14 words or fewer and names players by position words.
 * @param {PassRating} rating
 * @param {string} choiceId
 * @param {{ wording?: 'kid'|'standard', accept?: string[], focus?: string[] }} [opts]  wording: 'kid' (Player mode) by
 *   default; accept: coach-keyed ids that also count as best; focus: principle ids (a drill's `principles`) the best's
 *   line should lead with when one of its reasons teaches them
 * @returns {{ headline:string, line:string, yours:{text, principleId, tag}, best:{text, principleId, tag, id}|null,
 *             more:{text, principleId, tag}[], cue:{text, highlight, principleId}, grade: ReturnType<typeof gradePass> } | null}
 */
export function explainPass(rating, choiceId, { wording = 'kid', accept = [], focus = [] } = {}) {
  const w = wordingOf(wording);
  const g = gradePass(rating, choiceId, { accept });
  if (!g) return null;
  const o = g.option;
  let yours = lineFor(o, w, g.isBest, focus);
  const best = g.isBest ? null : { ...lineFor(rating.best, w, true, focus), id: rating.best.id };
  if (best && best.tag === yours.tag && o.colour !== 'red') {
    // The same reason as the best's: say what made the best one better instead of repeating it.
    const b = rating.best;
    const key = b.pSafe - o.pSafe >= 0.05 ? 'safer' : b.value - o.value > 0.002 ? 'further' : 'close';
    yours = { text: PASS_FALLBACK[key][w], principleId: PASS_FALLBACK[key].principle, tag: key };
  }
  const key = g.outcome === 'completed' ? (o.lineBroken ? 'line-broken' : 'safe') : g.outcome;
  const pool = o.tags.filter((t) => t.tag !== yours.tag && t.kind !== 'direction' && (g.isBest ? t.kind === 'strength' : true));
  const more = pool.sort((a, b) => (a.kind === b.kind ? byWeight(a, b) : a.kind === 'problem' ? -1 : 1)).slice(0, 2)
    .map((t) => ({ text: PASS_TAGS[t.tag].text[w](t), principleId: t.principle, tag: t.tag }));
  return { headline: PASS_HEADLINES[w][key], line: yours.text, yours, best, more, cue: cueFor(o, rating, w, yours), grade: g };
}

/**
 * Every sentence the pass reveal can show in one wording, with sample names filled in (for the copy
 * checks in CI): tag sentences, fallbacks, headlines and cues.
 * @returns {{ key:string, text:string }[]}
 */
export function allPassTexts(wording = 'kid') {
  const w = wordingOf(wording);
  const samples = [
    { who: 'their #6', kidWho: 'their midfielder', to: 'your left winger', kidTo: 'your winger', n: 3 },
    { who: 'their right centre-back', kidWho: 'their defender', to: 'your #9', kidTo: 'your striker', n: 1 },
    {},
  ];
  const out = [];
  for (const [tag, def] of Object.entries(PASS_TAGS)) {
    for (const v of samples) {
      out.push({ key: `tag:${tag}`, text: def.text[w](v) });
      // A risky best leads with "Risky, but worth it." before its strength.
      if (def.kind === 'strength') out.push({ key: `risky-best:${tag}`, text: `${PASS_FALLBACK.riskyBest[w]} ${def.text[w](v)}` });
    }
  }
  for (const [k, v] of Object.entries(PASS_FALLBACK)) out.push({ key: `fallback:${k}`, text: v[w] });
  for (const [k, v] of Object.entries(PASS_HEADLINES[w])) out.push({ key: `headline:${k}`, text: v });
  for (const [k, v] of Object.entries(PASS_CUES[w])) out.push({ key: `cue:${k}`, text: v });
  const seen = new Set();
  return out.filter((e) => !seen.has(`${e.key}|${e.text}`) && seen.add(`${e.key}|${e.text}`));
}
