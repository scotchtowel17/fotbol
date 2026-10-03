// Scene placement: all 22 players for one ball position and possession state.
// Contract: docs/ARCHITECTURE.md §5.2. Rationale: docs/RESEARCH.md §5.2 (layer A), §8 F3, F4, D1.
//
// Order: formation targets (with possession offset and phase shape) → overrides → carrier →
// goal-side settle → presser → onside clamp → separation. Overrides and the carrier are never moved
// once placed. The learner
// gets its formation spot (kept onside) unless overridden, is never made carrier or presser, and
// is never moved by separation. The presser resists separation in proportion to how hard it presses.
//
// For a static scene (Explore mode) the automatic press is a continuous function of the ball:
// it ramps in over `pressHandover` and fades over `pressFade`, so dragging the ball never makes a
// presser jump. The timeline instead commits to autoRoles() decisions at key times (see timeline.js).

import { dist, dot, sub, norm, clamp, lerp, nearest, median } from './geometry.js';
import { OWN_GOAL, OPP_GOAL, HALF_X, LENGTH, MID_Y, LANE_EDGES, clampToPitch } from './pitch.js';
import { ROLES, ROLE_INFO, playerId } from './roles.js';
import { teamTargets } from './formation.js';
import { engageBias, pressLean, flankShare, wingDepth } from './context.js';

export const SCENE_DEFAULTS = Object.freeze({
  carrierOffset: 0.8, // [D] carrier stands this far behind the ball, towards its own goal
  pressDistance: 2.5, // [D] presser's distance from the ball on the ball → own-goal-centre line (D1: 1.5-3 m)
  pressRadius: 14, // [D] the nearest defender presses fully when its formation spot is this close to the ball
  pressFade: 6, // [D] ...and not at all beyond pressRadius + pressFade (linear in between)
  pressHandover: 3, // [D] press ramps in as the nearest defender's lead over the next grows 0 → this; 0 = hard switch
  pressPastWeight: 2, // [D] each metre a defender's spot is past the ball (the ball has gone by them) counts as this many extra metres
  pressZoneFree: 8, // [D] playback (rankFrom): a defender ranks on where he stands while his formation spot ranks within this of the ball...
  pressZoneWeight: 1, // [D] ...and each metre beyond it counts this much extra (D7: the ball has left his zone, so he hands it over)
  pressFbEngage: 10, // [D] R2/U5: the ball-side full-back ranks this much nearer with the ball wide in the defending team's half (CONTEXT_DEFAULTS.fbEngage)
  pressFbEngageFrom: 45, // [D] ...fully with the ball at or behind this x (own frame)... (CONTEXT_DEFAULTS.fbEngageFrom)
  pressFbEngageTo: 55, // [D] ...fading out by this x (CONTEXT_DEFAULTS.fbEngageTo)
  pressAim: 25, // [D] D2/R5: in the attacking team's half the presser stands this many degrees inside the ball → own-goal line (PRESS_DEFAULTS.centralAim)...
  pressLeanCentre: 2, // [D] ...fading in from this far off y = 34 to the half-space (PRESS_DEFAULTS.leanCentre)...
  pressLeanFrom: 45, // [D] ...and with the ball's x (the defending team's frame) from here... (PRESS_DEFAULTS.leanFrom)
  pressLeanTo: 55, // [D] ...to here (PRESS_DEFAULTS.leanTo): context.js pressLean()
  onsideMargin: 0.5, // [D] attackers stay this far onside of the offside line
  settleReach: 6, // [D] D5/R4: out of possession an #8 stays goal-side of any opponent within this of his spot (a winger of the full-back on his flank)...
  settleFade: 4, // [D] ...fading out over this many metres beyond it (so an opponent coming near never makes him jump)
  settleMargin: 1, // [D] ...by this many metres
  minSeparation: 2, // [D] auto-placed players are pushed apart to at least this distance
  separationPasses: 8, // [D] relaxation passes for the separation step
  separationBias: 0.5, // [D] m: overlapping players are split along the pitch (opponents: each towards their own goal)
  separationSoft: 0.5, // [D] m: a pair whose biased offset is shorter than this is only partly separated, so placement stays continuous as players cross
  autoCarrier: true, // defaults for the autoFrame() flags of the same name (a scenario's params may set them)
  autoPress: true,
  onsideClamp: true,
  settle: true, // the goal-side settle step (params only; false leaves #8s and wingers at their table spots)
  // In possession the formation table knows nothing of who is on the ball or of an authored run, so two steps read them:
  flankShare: true, // B6 (params only): a full-back in his winger's wing lane, level or overlapping, sends the winger inside...
  shareReach: 12, // [D] ...with the full-back within this many metres of him along the pitch... (= CONTEXT_DEFAULTS.shareReach)
  shareFade: 4, // [D] ...fading out over this many more... (= CONTEXT_DEFAULTS.shareFade)
  shareBehind: 3, // [D] ...and no more than this far behind him (= CONTEXT_DEFAULTS.shareBehind)...
  shareBehindFade: 6, // [D] ...fading out over this many metres more (= CONTEXT_DEFAULTS.shareBehindFade)
  halfSpace: true, // P1 (params only): our ball-side full-back on the ball in a wing lane, from the middle third on, sends
  //                  the ball-side #8 into the half-space between their lines (layer A puts him wide, behind the ball)
  halfSpaceFrom: 35, // [D] ...from this far up the pitch (the team's own frame; fading in over 5 m)...
  halfSpaceAhead: 3, // [D] ...at least this far ahead of the ball and short of their back line
  wingFade: 3, // [D] a player or the ball counts as in the wing lane fully this far inside its edge, fading to 0 at the edge (= CONTEXT_DEFAULTS.wingFade)
  salida: true, // B9/B5 (params only): the #6 dropped between centre-backs who have split wide sends the full-backs high...
  salidaSplit: 18, // [D] ...centre-backs at least this far apart (fading in over salidaFade)...
  salidaFade: 4, // [D]
  salidaLevel: 2, // [D] ...the #6 no more than this ahead of the deeper centre-back (fading out over 2 m more), between them...
  salidaPush: 14, // [D] ...and each full-back at least this far ahead of the deeper centre-back (m2-10: past their winger, short of their midfield)
  halfSpaceInset: 4, // [D] B6/P1: the half-space spot is this far inside the wing lane's edge (y 17.84 / 50.16)
});

const EPS = 1e-9;
// Depth of each role family: overlapping teammates are split with the more advanced role ahead.
const DEPTH = Object.freeze({ GK: 0, CB: 1, FB: 2, DM: 3, CM: 4, W: 5, ST: 6 });
const depth = (p) => DEPTH[ROLE_INFO[p.role]?.family] ?? 3;

/**
 * Place all 22 players for a ball position.
 *
 * @param {Object} opts
 * @param {{us: object, them?: object}} opts.formations  from createFormation(); `them` defaults to `us`
 * @param {{x:number,y:number}} opts.ball
 * @param {'us'|'them'|'none'} [opts.possession='none']  'none' = loose ball: no possession offset, carrier or press;
 *   both teams take their out-of-possession shape and both are kept onside
 * @param {string|null} [opts.carrierId]   explicit carrier, placed at the ball (unless it is the learner or overridden);
 *   ignored with possession 'none' (a loose ball has no carrier)
 * @param {string} [opts.learnerId]        never made carrier or presser, never moved by separation
 * @param {Object<string,{x:number,y:number}>} [opts.overrides]  fixed positions; win over everything
 * @param {boolean} [opts.autoCarrier=true] with no carrierId, the possession team's nearest non-learner outfielder takes the ball
 * @param {boolean} [opts.autoPress=true]  the defending outfielder nearest the ball presses, unless that is the learner or an
 *   override; a defender the ball has already gone past counts as further away (pressPastWeight)
 * @param {string|null} [opts.presserId]   undefined = automatic press; an id = that defender presses fully; null = nobody presses
 * @param {boolean} [opts.onsideClamp=true] attackers of the team in possession (both teams for a loose ball) are pulled back onside
 * @param {boolean} [opts.inFlight=false]  ball in flight: no auto carrier and no press (timeline sets this when the carrier is null)
 * @param {{x:number,y:number}} [opts.shapeBall]  ball the shape reacts to (default `ball`; the timeline passes a lagged, averaged ball).
 *   It drives the formation targets and who presses; the carrier, press spot and onside line use `ball`.
 * @param {Object<string,{x:number,y:number}>} [opts.rankFrom]  where the players actually are (playback: the frame at a key time).
 *   The automatic press then ranks each defender from here on `ball` (not his formation spot on the shape ball), plus
 *   pressZoneWeight per metre his formation spot ranks beyond pressZoneFree, so a defender the play has left behind is
 *   never sent to press past a teammate who is already goal-side, and one far out of his zone hands over.
 * @param {{us?: Object<string,{x:number,y:number}>, them?: Object<string,{x:number,y:number}>}} [opts.targets]  formation targets
 *   per team and role, used instead of teamTargets() on the shape ball (the timeline passes where the players have run
 *   to: timeline.js runTargets); everything after them (overrides, carrier, settle, press, onside, separation) is the same
 * @param {object} [opts.params]           overrides for SCENE_DEFAULTS; params.shape (an object) overrides SHAPE_DEFAULTS
 *   of the phase shape (formation.js) for both teams
 * @returns {import('./types.js').Frame}   t = 0, tags = {}
 */
export function autoFrame(opts) {
  const S = setup(opts);
  const { P, ball, players, byId, pinned, overridden, mobility, carrier, attacking, defending } = S;

  // 3. Press: on the ball → own-goal-centre line, pressDistance from the ball.
  if (defending && S.autoPress && !S.inFlight && opts.presserId !== null) {
    let presser = null, w = 0;
    if (opts.presserId === undefined) {
      const d = decidePress(S);
      if (d) ({ p: presser, w } = d);
    } else {
      const p = byId.get(opts.presserId);
      if (p && p.team === defending && p.role !== 'GK' && p !== carrier && !pinned.has(p.id)) { presser = p; w = 1; }
    }
    if (presser) {
      const target = pressSpot(defending, ball, P);
      Object.assign(presser, clampToPitch({ x: lerp(presser.x, target.x, w), y: lerp(presser.y, target.y, w) }));
      mobility.set(presser.id, 1 - w);
    }
  }

  // 4. Onside clamp (IFAB: level is onside; no offside in your own half) for the team in possession,
  // or for both teams with a loose ball (whoever wins it must not have runners offside).
  let keepOnside = () => {};
  if (S.onsideClamp && (attacking || S.possession === 'none')) {
    const limits = {};
    for (const team of attacking ? [attacking] : ['us', 'them']) {
      const defXs = players.filter((p) => p.team !== team).map((p) => p.x);
      if (team === 'us') limits.us = Math.max(Math.max(ball.x, defXs.sort((a, b) => b - a)[1]) - P.onsideMargin, HALF_X);
      else limits.them = Math.min(Math.min(ball.x, defXs.sort((a, b) => a - b)[1]) + P.onsideMargin, HALF_X);
    }
    keepOnside = (p) => {
      if (p.team === 'us' ? p.x > limits.us : p.x < limits.them) p.x = limits[p.team];
    };
    for (const p of players) if (!overridden.has(p.id) && p !== carrier) keepOnside(p);
  }

  // 5. Separation (Jacobi-style, so the result does not depend on player order and mirrors exactly).
  separate(players, players.map((p) => mobility.get(p.id)), P, (p) => { Object.assign(p, clampToPitch(p)); keepOnside(p); });

  return { t: 0, ball: { x: ball.x, y: ball.y }, possession: S.possession, carrierId: carrier?.id ?? null, players, tags: {} };
}

/**
 * The learner's base: where the auto-placer would put the learner's role if it were an ordinary
 * player. It is the zone centre for scoring and the spot that duties are computed at
 * (docs/ARCHITECTURE.md §5.2, §5.4):
 *  - its formation spot (phase-shaped, kept onside), eased by separation like everyone else's;
 *  - out of possession, its press spot when its role is the automatic presser (pressing is the job);
 *    with a loose ball, when it is our automatic first defender (autoFrame presses nobody then, but
 *    the rules judge a loose ball as defended: the nearest player goes to win it);
 *  - in possession the learner never carries: if its role would be the automatic carrier, the
 *    teammate who takes the ball instead leaves his formation spot and the learner fills it
 *    (P6: when a teammate comes to the ball out of a zone, the nearest teammate fills that space).
 * An override for the learner (e.g. the learner's dragged spot) is ignored.
 * @param {Object} opts  as for autoFrame(), with learnerId
 * @returns {{x:number, y:number}}
 */
export function learnerBase(opts) {
  const id = opts.learnerId;
  if (!id) throw new TypeError('learnerBase: opts.learnerId is required');
  const { [id]: _mine, ...overrides } = opts.overrides ?? {};
  const free = autoFrame({ ...opts, learnerId: undefined, overrides });
  const me = free.players.find((p) => p.id === id);
  if (!me) throw new TypeError(`learnerBase: no player ${id}`);
  if ((opts.possession ?? 'none') === 'none') {
    const S = setup({ ...opts, learnerId: undefined, overrides });
    const d = (opts.autoPress ?? S.P.autoPress) && !S.inFlight ? decidePress({ ...S, defending: 'us' }) : null;
    if (d?.p.id === id) {
      const target = clampToPitch(pressSpot('us', S.ball, S.P));
      return { x: lerp(me.x, target.x, d.w), y: lerp(me.y, target.y, d.w) };
    }
  }
  if (free.carrierId !== id) return { x: me.x, y: me.y };
  const withLearner = autoFrame({ ...opts, overrides });
  const carrierId = withLearner.carrierId;
  if (!carrierId || carrierId === id) { // the scene names the learner as the carrier: its own spot
    const own = withLearner.players.find((p) => p.id === id);
    return { x: own.x, y: own.y };
  }
  const shape = autoFrame({ ...opts, overrides, carrierId: null, autoCarrier: false });
  const spot = shape.players.find((p) => p.id === carrierId);
  return { x: spot.x, y: spot.y };
}

/**
 * The automatic choices autoFrame() would make for these options, without placing anyone:
 * the carrier (explicit or automatic) and the presser with its press weight w in (0, 1].
 * The timeline commits to these at key times so that playback never hands the press over mid-carry.
 * @param {Object} opts  as for autoFrame()
 * @returns {{ carrierId: string|null, presser: {id: string, w: number}|null }}
 */
export function autoRoles(opts) {
  const S = setup(opts);
  const d = S.defending && S.autoPress && !S.inFlight ? decidePress(S) : null;
  return { carrierId: S.carrier?.id ?? null, presser: d ? { id: d.p.id, w: d.w } : null };
}

/** Steps 1-2 shared by autoFrame() and autoRoles(): formation targets, overrides, carrier. */
function setup(opts) {
  const { formations, ball, possession = 'none', carrierId = null, learnerId = null, overrides = {}, inFlight = false } = opts;
  if (!formations?.us) throw new TypeError('autoFrame: opts.formations.us is required');
  const P = { ...SCENE_DEFAULTS, ...opts.params };
  const attacking = possession === 'us' || possession === 'them' ? possession : null;
  const defending = attacking === 'us' ? 'them' : attacking === 'them' ? 'us' : null;
  const shapeBall = opts.shapeBall ?? ball;

  // 1. Formation targets and overrides.
  const players = [];
  const byId = new Map();
  for (const team of ['us', 'them']) {
    const formation = team === 'us' ? formations.us : formations.them ?? formations.us;
    // A loose ball: no possession offset, but both teams take their out-of-possession shape (the
    // rules judge a loose ball as defending).
    const targets = opts.targets?.[team] ?? teamTargets(formation, team, shapeBall, { inPossession: possession === team, offset: !!attacking, shape: P.shape ?? true });
    for (const role of ROLES) {
      const id = playerId(team, role);
      const p = overrides[id] ?? targets[role];
      const player = { id, team, role, x: p.x, y: p.y };
      players.push(player);
      byId.set(id, player);
    }
  }
  const overridden = new Set(Object.keys(overrides).filter((id) => byId.has(id)));
  const pinned = new Set(overridden); // never picked as carrier or presser
  if (learnerId) pinned.add(learnerId);
  const mobility = new Map(players.map((p) => [p.id, pinned.has(p.id) ? 0 : 1])); // 0 = separation never moves it

  // 2. Carrier: explicit, or the nearest eligible outfielder of the team in possession. A loose ball
  // (possession 'none') has no carrier, even if one is named (§5.2).
  let carrier = carrierId && attacking ? byId.get(carrierId) ?? null : null;
  if (!carrier && attacking && (opts.autoCarrier ?? P.autoCarrier) && !inFlight) {
    carrier = nearest(ball, players.filter((p) => p.team === attacking && p.role !== 'GK' && !pinned.has(p.id)));
  }
  if (carrier) {
    if (!pinned.has(carrier.id)) {
      const back = carrier.team === 'us' ? -P.carrierOffset : P.carrierOffset;
      Object.assign(carrier, clampToPitch({ x: ball.x + back, y: ball.y }));
    }
    mobility.set(carrier.id, 0);
  }

  // 2a. Flank sharing and the half-space (B6, P1) for the team in possession: the formation table knows nothing of
  // an authored overlap or of the full-back on the ball. Part of every auto player's spot (the learner's too).
  if (attacking) {
    shareFlanks(players, attacking, byId, overridden, carrier, ball, P);
    if (P.salida) salida(players, attacking, byId, overridden, carrier, P);
  }

  // 2b. Goal-side settle (D5, R4): the formation table knows nothing of the opponents, so out of
  // possession an #8 standing on the wrong side of an opponent near him, or a winger of the
  // full-back on his flank, drops goal-side of him. Part of every auto player's spot (the learner's too).
  if (P.settle) settle(players, attacking ? [defending] : ['us', 'them'], overridden, carrier, P);

  return {
    P, ball, shapeBall, possession, attacking, defending, inFlight, players, byId, pinned, overridden, mobility, carrier,
    rankFrom: opts.rankFrom ?? null,
    autoPress: opts.autoPress ?? P.autoPress,
    onsideClamp: opts.onsideClamp ?? P.onsideClamp,
  };
}

/**
 * Goal-side settle for the defending team(s) (own goal: x = 0 for 'us', x = 105 for 'them'): each
 * auto-placed #8 moves back to settleMargin goal-side of the opponents within settleReach of him
 * (their full-back on his flank, for a winger), with full effect up to settleReach and none beyond
 * settleReach + settleFade, so the placement stays continuous. Every move is computed from the
 * positions before the settle (with a loose ball both teams settle, independent of order). Only
 * depth changes. Mutates players.
 */
function settle(players, teams, overridden, carrier, P) {
  const moves = [];
  for (const p of players) {
    if (!teams.includes(p.team) || overridden.has(p.id) || p === carrier) continue;
    const fam = ROLE_INFO[p.role]?.family;
    if (fam !== 'CM' && fam !== 'W') continue;
    const sign = p.team === 'us' ? 1 : -1; // + = away from his own goal
    const flankFB = fam === 'W' ? (ROLE_INFO[p.role].side === 'L' ? 'RB' : 'LB') : null;
    let back = 0;
    for (const o of players) {
      if (o.team === p.team || o.role === 'GK' || o === carrier || (flankFB && o.role !== flankFB)) continue;
      const excess = sign * (p.x - o.x) + P.settleMargin; // > 0: not goal-side enough
      if (excess <= 0) continue;
      const w = clamp((P.settleReach + P.settleFade - dist(p, o)) / P.settleFade, 0, 1);
      back = Math.max(back, w * excess);
    }
    if (back > 0) moves.push([p, sign * back]);
  }
  for (const [p, dx] of moves) p.x = clamp(p.x - dx, 0, LENGTH);
}

/** The half-space spot's y on a side: halfSpaceInset inside the wing lane's edge. */
const halfSpaceY = (side, P) => (side === 'R' ? LANE_EDGES[4] - P.halfSpaceInset : LANE_EDGES[1] + P.halfSpaceInset);

/**
 * In possession (team `team`): B6, a full-back in his winger's wing lane, level with him or overlapping and within
 * shareReach, sends an auto-placed winger in from the wing lane to the half-space spot; P1, with the ball-side
 * full-back on the ball in a wing lane from halfSpaceFrom on, the ball-side #8 takes the half-space spot, between
 * their midfield and back lines, at least halfSpaceAhead ahead of the ball. Every weight fades (lane edges, reach,
 * the ball's height), so the placement stays continuous. Overrides and the carrier never move. Mutates players.
 */
const FLANK_IDS = Object.freeze({
  us: Object.freeze({ L: ['us-LB', 'us-LW', 'us-LCM'], R: ['us-RB', 'us-RW', 'us-RCM'] }),
  them: Object.freeze({ L: ['them-LB', 'them-LW', 'them-LCM'], R: ['them-RB', 'them-RW', 'them-RCM'] }),
});

function shareFlanks(players, team, byId, overridden, carrier, ball, P) {
  const fixed = (p) => !p || overridden.has(p.id) || p === carrier;
  for (const side of ['L', 'R']) {
    const [fbId, wId, cmId] = FLANK_IDS[team][side];
    const fb = byId.get(fbId), w = byId.get(wId);
    if (!fb || (wingDepth(fb, side, P) === 0 && carrier !== fb)) continue; // nothing on this flank for either step
    const hs = halfSpaceY(side, P);
    // B6: the winger comes inside when his full-back holds the wing (context.js flankShare, which buildContext also reads).
    if (P.flankShare && fb && !fixed(w)) {
      const k = flankShare(team, fb, w, side, P);
      const wider = side === 'R' ? w.y > hs : w.y < hs;
      if (k > 0 && wider) w.y = lerp(w.y, hs, k);
    }
    // P1: the ball-side #8 takes the half-space while his full-back has the ball out wide.
    const cm = byId.get(cmId);
    if (P.halfSpace && fb && carrier === fb && !fixed(cm)) {
      const up = team === 'us' ? ball.x : LENGTH - ball.x;
      const k = wingDepth(ball, side, P) * clamp((up - P.halfSpaceFrom) / 5, 0, 1);
      if (k > 0) {
        const opp = players.filter((q) => q.team !== team);
        const lineX = (roles) => median(opp.filter((q) => roles.includes(q.role)).map((q) => q.x));
        const mid = lineX(['DM', 'LCM', 'RCM']), back = lineX(['LB', 'LCB', 'RCB', 'RB']);
        // In the team's own frame (up the pitch): between their lines, at least halfSpaceAhead past the ball.
        const own = (x) => (team === 'us' ? x : LENGTH - x);
        const lo = up + P.halfSpaceAhead, hi = Math.max(lo, own(back) - 2);
        const want = clamp((own(mid) + own(back)) / 2, lo, hi);
        cm.x = lerp(cm.x, own(want), k);
        cm.y = lerp(cm.y, hs, k);
      }
    }
  }
}

/**
 * B9/B5 in build-up (team `team` in possession): when the #6 has dropped between centre-backs who have split wide (at
 * least salidaSplit apart, the #6 between them and no more than salidaLevel ahead of the deeper one), a back three
 * holds the ball and the auto-placed full-backs push up, at least salidaPush ahead of the deeper centre-back, keeping
 * their width (a centre-back carrying the ball out past the #6 is not a back three). Layer A keeps them flat with the centre-backs (its build-up depth floor). Every weight fades. Mutates players.
 */
function salida(players, team, byId, overridden, carrier, P) {
  const ids = team === 'us' ? ['us-LCB', 'us-RCB', 'us-DM', 'us-LB', 'us-RB'] : ['them-LCB', 'them-RCB', 'them-DM', 'them-LB', 'them-RB'];
  const [l, r, dm] = ids.slice(0, 3).map((id) => byId.get(id));
  if (!l || !r || !dm) return;
  const own = (x) => (team === 'us' ? x : LENGTH - x); // up the pitch, in the team's own frame
  const lo = Math.min(l.y, r.y), hi = Math.max(l.y, r.y);
  const split = clamp((hi - lo - P.salidaSplit) / P.salidaFade + 1, 0, 1);
  // Level with the deeper centre-back: a centre-back carrying the ball out past the #6 is not a back three.
  const deep = Math.min(own(l.x), own(r.x));
  const level = clamp((deep + P.salidaLevel + 2 - own(dm.x)) / 2, 0, 1);
  const between = clamp((Math.min(dm.y - lo, hi - dm.y)) / 2, 0, 1);
  const k = split * level * between;
  if (!(k > 0)) return;
  const want = deep + P.salidaPush;
  for (const id of ids.slice(3)) {
    const fb = byId.get(id);
    if (!fb || overridden.has(id) || fb === carrier || own(fb.x) >= want) continue;
    const x = lerp(own(fb.x), want, k);
    fb.x = team === 'us' ? x : LENGTH - x;
  }
}

/**
 * Where a presser stands (D1, D2): pressDistance from the ball, goal-side, on the ball → own-goal line
 * turned pressAim x pressLean() degrees toward the middle of the pitch (in the attacking team's half a
 * carrier off the middle is pressed from the inside; the same lean as the press rule). Not clamped.
 */
function pressSpot(defending, ball, P) {
  const g = norm(sub(defending === 'us' ? OWN_GOAL : OPP_GOAL, ball));
  const lean = pressLean(defending, ball, { leanCentre: P.pressLeanCentre, leanFrom: P.pressLeanFrom, leanTo: P.pressLeanTo });
  // Turn toward y = 34: counter-clockwise (x → y) turns a goalward vector toward smaller y when it points to -x.
  const a = ((lean * P.pressAim * Math.PI) / 180) * (ball.y >= MID_Y ? 1 : -1) * (g.x <= 0 ? 1 : -1);
  const c = Math.cos(a), s = Math.sin(a);
  const dx = g.x * c - g.y * s, dy = g.x * s + g.y * c;
  return { x: ball.x + dx * P.pressDistance, y: ball.y + dy * P.pressDistance };
}

/**
 * The automatic press: the defending outfielder nearest the ball, unless that is the learner (who
 * must decide) or an override (the author decided). "Nearest" counts each metre a spot is past the
 * ball as pressPastWeight metres, so a goal-side defender takes over from one the ball has gone by,
 * and, with the ball wide in the defending team's half, the ball-side full-back as pressFbEngage
 * metres nearer (R2, U5: he engages the winger; context.js engageBias(), the same ranking
 * buildContext() uses for the first defender). A static scene ranks the formation spots on the
 * shape ball. In playback (rankFrom) it ranks where each defender actually is on the ball itself, so
 * one the play has left behind is never sent back past the carrier while a teammate is goal-side;
 * and a defender whose formation spot (on the shape ball) ranks more than pressZoneFree from it
 * counts pressZoneWeight metres extra per metre beyond, so the press stays with the unit whose zone
 * the ball is in (a #9 on a switch across their back line, R5) and one who has followed the ball
 * out of his zone hands it over (D7). The weight ramps with the lead over the next defender
 * (pressHandover) and fades beyond pressRadius (pressFade).
 * @returns {{p: object, w: number}|null}
 */
function decidePress({ P, ball, shapeBall, players, pinned, carrier, defending, rankFrom }) {
  const goal = defending === 'us' ? OWN_GOAL : OPP_GOAL;
  const b = rankFrom ? ball : shapeBall;
  const fb = engageBias(defending, b, { fbEngage: P.pressFbEngage, fbEngageFrom: P.pressFbEngageFrom, fbEngageTo: P.pressFbEngageTo });
  const g = norm(sub(goal, b)), gShape = norm(sub(goal, shapeBall));
  const rank = (q, at, dir) => dist(q, at) + P.pressPastWeight * Math.max(0, -dot(sub(q, at), dir));
  const reach = (p) => {
    const at = rankFrom?.[p.id];
    const r = at ? rank(at, b, g) + P.pressZoneWeight * Math.max(0, rank(p, shapeBall, gShape) - P.pressZoneFree) : rank(p, b, g);
    return r - (p.role === fb.role ? fb.bias : 0);
  };
  const ranked = players
    .filter((p) => p.team === defending && p.role !== 'GK' && p !== carrier)
    .map((p) => ({ p, d: reach(p) }))
    .sort((a, b) => a.d - b.d); // stable: ties keep role order
  const [first, second] = ranked;
  if (!first || pinned.has(first.p.id)) return null;
  const lead = second ? second.d - first.d : Infinity;
  let w = P.pressHandover > 0 ? clamp(lead / P.pressHandover, 0, 1) : 1;
  if (first.d > P.pressRadius) w *= P.pressFade > 0 ? clamp(1 - (first.d - P.pressRadius) / P.pressFade, 0, 1) : 0;
  return w > 0 ? { p: first.p, w } : null;
}

/**
 * Push players apart until no pair is closer than P.minSeparation (or passes run out).
 * mobility[i] in [0, 1]: a pair's push is shared as m_i / max(m_i + m_j, 1), which splits it
 * evenly between two free players, gives all of it to a free player next to a fixed one, and
 * varies continuously in between (a presser easing into its press is not suddenly immovable).
 *
 * Continuity: each pair's push direction and target are fixed once, from the positions BEFORE
 * separation. Re-reading the direction from positions an earlier pass has moved would amplify a
 * near-zero direction pass after pass into a flip, so a 1 cm ball move could swap two crossing
 * players by metres. The target is a signed gap along that direction; a pair whose biased offset u
 * is shorter than separationSoft only closes the share |u| / separationSoft of the way from its
 * starting gap to minSeparation, so the push fades out (instead of flipping) as the two cross.
 */
function separate(players, mobility, P, constrain) {
  const n = players.length;
  const min = P.minSeparation;
  const ox = players.map((p) => p.x), oy = players.map((p) => p.y);
  const pairs = new Map(); // i * n + j → { ux, uy, gap }, fixed when the pair first overlaps
  const pairOf = (i, j) => {
    const a = players[i], b = players[j];
    // Direction a → b, biased along the pitch: opponents each towards their own goal (an
    // overlapping marker ends up goal-side of their man), teammates with the more advanced role
    // ahead. The bias is left/right symmetric, so mirrored scenes separate identically.
    const toward = a.team === 'us' ? P.separationBias : -P.separationBias;
    const rx = ox[j] - ox[i], ry = oy[j] - oy[i];
    const ux = rx + (a.team !== b.team ? toward : Math.sign(depth(b) - depth(a)) * toward), uy = ry;
    const l = Math.hypot(ux, uy);
    if (l <= EPS) return { ux: 0, uy: 0, gap: -Infinity };
    const share = P.separationSoft > 0 ? Math.min(1, l / P.separationSoft) : 1;
    const s0 = (rx * ux + ry * uy) / l; // starting gap along the push direction (< 0: on the other side)
    return { ux: ux / l, uy: uy / l, gap: s0 + share * (min - s0) };
  };
  for (let pass = 0; pass < P.separationPasses; pass++) {
    const dx = new Float64Array(n), dy = new Float64Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const mi = mobility[i], mj = mobility[j];
        if (mi <= 0 && mj <= 0) continue;
        const a = players[i], b = players[j];
        const d = dist(a, b);
        if (d >= min) continue;
        let q = pairs.get(i * n + j);
        if (!q) pairs.set(i * n + j, (q = pairOf(i, j)));
        const s = (b.x - a.x) * q.ux + (b.y - a.y) * q.uy;
        if (s >= q.gap) continue;
        // Both terms vanish at their limit (d = min, s = gap), so the push never switches on or off abruptly.
        const k = Math.min(q.gap - s, min - d) / Math.max(mi + mj, 1);
        dx[i] -= q.ux * k * mi; dy[i] -= q.uy * k * mi;
        dx[j] += q.ux * k * mj; dy[j] += q.uy * k * mj;
        any = true;
      }
    }
    if (!any) return;
    for (let i = 0; i < n; i++) {
      if (dx[i] === 0 && dy[i] === 0) continue;
      players[i].x += dx[i];
      players[i].y += dy[i];
      constrain(players[i]);
    }
  }
}
