// Procedural continuous play for Live mode, and an incremental playback cursor.
// Contract: docs/ARCHITECTURE.md §5.3 (scenario format, frameAt semantics). Rationale: docs/RESEARCH.md
// §5.7 (live scoring at 10 Hz with a reaction grace), §7.3 (Live as the capstone), §9.2 item 8.
//
// generateSequence() writes an ordinary ball-scripted scenario (the same format as data/scenarios):
// the team on the ball circulates it with passes (12-20 m/s) between auto-placed teammates, short
// carries (4-7 m/s), the odd switch of play, and 2-4 turnovers (an interception or a tackle and a loose
// ball), so both in- and out-of-possession positioning are tested. Every receiver and ball-winner is a
// real player id standing where autoFrame() puts him at that moment; the learner never has the ball.
// Each pass is chosen on the frame the viewer will see (the playback so far: blends, committed pressers,
// settle and separation) with passing.js rateOptions() and a softmax over its utility, so play never goes
// through a defender standing in the lane (docs/research/passing.md §5.4).
// It is PURE and deterministic: a seeded PRNG (mulberry32), no Math.random, no clock.
//
// createPlayback() is the incremental twin of timeline.frameAt(): the same states, decisions and
// blends, but each state change is computed once, when playback first reaches it, and remembered.
// frameAt() re-derives the whole history on every call (O(keys) autoFrame calls, several ms on a 45 s
// sequence); the cursor costs about one autoFrame per call, which keeps Live at 60 fps. With a fixed
// learner spot it returns exactly what timeline.frameAt() returns (tests/sequence.test.js holds them
// equal); with a moving learner each state change uses the learner's spot at the moment it happened.

import { clamp, dist, pointSegmentDistance, projectionParam } from './geometry.js';
import { LENGTH, WIDTH, MID_Y } from './pitch.js';
import { LEARNABLE_ROLES, playerId } from './roles.js';
import { autoFrame, autoRoles } from './scene.js';
import { TIMELINE_DEFAULTS, interpKeys, ballAt, meanBallAt, possessionAt, carrierAt, ballEvents, adjustCells, applyAdjustments, adjustmentOf, overridesAt, tagsAt } from './timeline.js';
import { rateOptions, swapTeams } from './passing.js';

export const SEQUENCE_DEFAULTS = Object.freeze({
  duration: 45, // [S] seconds of play (RESEARCH 9.2 item 8: 30-60 s)
  minDuration: 10, // [D] shortest sequence generateSequence() will write
  maxDuration: 120, // [D] longest
  passSpeed: Object.freeze([12, 20]), // [D] m/s, ground passes; longer passes are struck harder
  passRange: Object.freeze([7, 36]), // [D] m, usual pass length
  passPreferred: 16, // [D] m, most common pass length...
  passSpread: 12, // [D] m ...and how quickly other lengths fall off
  forwardBias: 0.8, // [D] extra weight for a pass that gains ground (per 20 m gained)
  switchChance: 0.12, // [D] chance that a pass is a switch of play
  switchRange: Object.freeze([24, 46]), // [D] m, switch length
  switchLateral: 20, // [D] m, a switch must move the ball at least this far across
  passTemperature: 0.004, // [D] softmax temperature over rateOptions' utility U (goals; 0.004 = 4 score points): an
  //                          option 10 points worse is picked about 12x less often; one that would be cut out never
  //                          (with no safe pass the carrier runs with the ball; boxed in, the least bad pass is played)
  carryChance: 0.35, // [D] chance the carrier runs with the ball before passing
  carrySpeed: Object.freeze([4, 7]), // [D] m/s
  carryTime: Object.freeze([0.8, 2.2]), // [D] s per carry key (ROADMAP: presses are re-decided at keys, so key a carry every 1-3 s)
  carryAngle: 55, // [D] degrees either side of straight ahead
  holdTime: Object.freeze([0.35, 0.9]), // [D] s: first touch and look up before the next action
  turnovers: Object.freeze([2, 4]), // [S] possession changes per sequence (task spec: both moments are tested)
  spellJitter: 0.25, // [D] turnover times vary by this share of a possession spell
  interceptChance: 0.6, // [D] share of turnovers that are interceptions (the rest are tackles)
  interceptReach: 4, // [D] m: an opponent this close to the pass line can cut it out
  interceptAt: Object.freeze([0.25, 0.85]), // [D] where along the pass he can reach it
  tackleReach: 6, // [D] m: a tackle needs an opponent this close to the carrier
  looseDistance: Object.freeze([2.5, 5]), // [D] m the ball runs loose after a tackle
  looseSpeed: Object.freeze([4, 8]), // [D] m/s
  margin: Object.freeze({ x: 8, y: 2.5 }), // [D] m: the ball stays this far inside the goal lines / touchlines
  attackLimit: 86, // [D] carries stop this deep in the opponents' half (their frame: 105 - this)
  recycleFrom: 76, // [D] beyond this the team recycles more than it goes forward (no finishing in v1)
  tRound: 1e3, // times are rounded to 1 ms...
  pRound: 1e2, // ...and positions to 1 cm, so the JSON is compact and exactly reproducible
  principles: Object.freeze(['F2', 'F1', 'F3']), // [D] what a live sequence tests: shift with the ball, the ball decides your job, push up and drop
});

// ---------------------------------------------------------------- seeded randomness

/** 32-bit hash of a seed (number or string): numbers map to themselves (mod 2^32), strings by FNV-1a. */
export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.floor(Math.abs(seed)) >>> 0;
  const s = String(seed ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a small, fast 32-bit PRNG. @returns {() => number} uniform in [0, 1) */
export function mulberry32(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded random source with the helpers the generator needs. */
export function createRng(seed) {
  const next = mulberry32(hashSeed(seed));
  const rng = {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    /** Index chosen with probability proportional to weights (all ≤ 0 → -1). */
    weighted(weights) {
      const total = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0);
      if (!(total > 0)) return -1;
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        if (!(weights[i] > 0)) continue;
        r -= weights[i];
        if (r < 0) return i;
      }
      return weights.findLastIndex((w) => w > 0);
    },
  };
  return rng;
}

// ---------------------------------------------------------------- the generator

/**
 * Generate a continuous, ball-scripted sequence for Live mode.
 * @param {{ seed?: number|string, duration?: number, role?: string, formations: {us: object, them?: object}, params?: object }} opts
 *   role: the learner's role (never gets the ball); params: SEQUENCE_DEFAULTS overrides
 * @returns {object} a scenario (docs/ARCHITECTURE.md §5.3) that validateScenario() accepts, with
 *   id 'live-<seed>', module 'live', source.kind 'generated' and source.seed
 */
export function generateSequence({ seed = 1, duration, role = 'DM', formations, params } = {}) {
  if (!formations?.us) throw new TypeError('generateSequence: formations.us is required');
  if (!LEARNABLE_ROLES.includes(role)) throw new TypeError(`generateSequence: role ${role} is not a learnable role`);
  const P = { ...SEQUENCE_DEFAULTS, ...params };
  const T = TIMELINE_DEFAULTS;
  const D = clamp(Number.isFinite(duration) ? duration : P.duration, P.minDuration, P.maxDuration);
  const rng = createRng(seed);
  const learner = playerId('us', role);
  const rt = (t) => Math.round(t * P.tRound) / P.tRound;
  const rp = (p) => ({ x: Math.round(p.x * P.pRound) / P.pRound, y: Math.round(p.y * P.pRound) / P.pRound });
  const inBounds = (p) => rp({ x: clamp(p.x, P.margin.x, LENGTH - P.margin.x), y: clamp(p.y, P.margin.y, WIDTH - P.margin.y) });
  const dirOf = (team) => (team === 'us' ? 1 : -1);
  const other = (team) => (team === 'us' ? 'them' : 'us');
  /** How far up the pitch a point is for `team` (0 = own goal line, 105 = the opponents'). */
  const upPitch = (p, team) => (team === 'us' ? p.x : LENGTH - p.x);

  const ball = [], possession = [], carrier = [];
  const partial = { timeline: { ball, possession, carrier } }; // what has been written so far (for ballAt / meanBallAt)
  const view = writingPlayback(partial, formations); // the free playback of what has been written: what the viewer sees
  const shapeAt = (t) => meanBallAt(partial, t - T.reactionLag - T.shapeWindow, t - T.reactionLag);
  const eligible = (p, team) => p.team === team && p.role !== 'GK' && p.id !== learner;

  /** The scene at a key time t (the last key written): everyone where autoFrame puts them. */
  const sceneAt = (t, pos, team, carrierId) => autoFrame({
    formations, ball: pos, shapeBall: shapeAt(t), possession: team, carrierId, learnerId: learner, autoCarrier: false,
  });
  /** Where `id` stands at time ta with the ball in flight from `from` (key at t0) to `to`. */
  const inFlightSpot = (id, team, from, t0, to, ta) => {
    ball.push({ t: ta, x: to.x, y: to.y });
    const shapeBall = shapeAt(ta);
    ball.pop();
    const f = autoFrame({ formations, ball: to, shapeBall, possession: team, carrierId: null, inFlight: true, learnerId: learner, autoCarrier: false });
    return f.players.find((p) => p.id === id);
  };
  const passSpeed = (d) => clamp(P.passSpeed[0] + (P.passSpeed[1] - P.passSpeed[0]) * clamp((d - 6) / 34, 0, 1) + rng.range(-1, 1), P.passSpeed[0] + 0.3, P.passSpeed[1] - 0.3);

  /** Write a ball key at t (merging with a key already at t). */
  const ballKey = (t, p, event) => {
    const last = ball[ball.length - 1];
    if (last && Math.abs(last.t - t) < 1e-9) {
      if (event) last.event = event;
      return;
    }
    ball.push(event ? { t, x: p.x, y: p.y, event } : { t, x: p.x, y: p.y });
  };
  const carrierKey = (t, id) => carrier.push({ t, id });
  const possessionKey = (t, team) => possession.push({ t, team });

  // ---- possession spells: turnover times spread over the sequence
  const nTurn = rng.int(P.turnovers[0], P.turnovers[1]);
  const spell = D / (nTurn + 1);
  const turnAt = Array.from({ length: nTurn }, (_, i) => spell * (i + 1) + rng.range(-P.spellJitter, P.spellJitter) * spell);

  // ---- kick-off state: a team on the ball in its own half or midfield
  let team = rng.chance(0.5) ? 'us' : 'them';
  const startUp = rng.range(28, 55);
  let pos = inBounds({ x: team === 'us' ? startUp : LENGTH - startUp, y: rng.range(14, WIDTH - 14) });
  let t = 0;
  ballKey(0, pos);
  possessionKey(0, team);
  {
    const f = autoFrame({ formations, ball: pos, possession: team, learnerId: learner });
    carrierKey(0, f.carrierId && f.carrierId !== learner ? f.carrierId : nearestId(f.players.filter((p) => eligible(p, team)), pos));
  }
  let carrierId = carrier[0].id;
  let turnIdx = 0;
  let afterCarry = false;

  const pass = (t0, frame, { forTurnover = false } = {}) => {
    const dir = dirOf(team);
    const mates = frame.players.filter((p) => eligible(p, team) && p.id !== carrierId);
    const deep = upPitch(pos, team) > P.recycleFrom;
    // A real pass is rated on the frame the viewer sees (a turnover pass is meant to be cut out).
    const rated = forTurnover ? null : ratePasses(view.frameBefore(t0), carrierId, team);
    const tryPick = (isSwitch) => {
      const cands = mates.map((c) => {
        const o = rated?.get(c.id);
        const at = o?.receiverAt ?? c; // where the viewer sees him
        const d = dist(pos, at), gain = (at.x - pos.x) * dir, lat = Math.abs(at.y - pos.y);
        if (d < P.passRange[0] || (rated && !o)) return null;
        if (d > (isSwitch ? P.switchRange[1] : P.passRange[1])) return null;
        if (isSwitch && (lat < P.switchLateral || d < P.switchRange[0])) return null;
        let w = Math.exp(-(((d - P.passPreferred) / P.passSpread) ** 2));
        const g = clamp(gain / 20, -0.6, 1);
        w *= 1 + (deep ? -0.3 : P.forwardBias) * g;
        if (isSwitch) w *= 1 + lat / 20;
        if (upPitch(c, team) > P.attackLimit + 4) w *= 0.2;
        return { w: Math.max(0, w), o };
      });
      if (rated) {
        // Softmax over the utility; never a pass that would be cut out (with none safe, carry instead).
        const live = cands.filter(Boolean);
        const top = Math.max(...live.map((q) => q.o.U));
        for (const q of live) q.w *= q.o.colour === 'red' ? 0 : Math.exp((q.o.U - top) / P.passTemperature);
      }
      const i = rng.weighted(cands.map((q) => q?.w ?? 0));
      return i >= 0 ? mates[i] : null;
    };
    const receiver = (rng.chance(P.switchChance) && tryPick(true)) || tryPick(false);
    if (!receiver) return false;

    // Aim where the receiver will be when the ball arrives (two refinements of his in-flight spot).
    let target = inBounds(receiver);
    let v = passSpeed(dist(pos, target));
    for (let k = 0; k < 2; k++) {
      const ta = t0 + dist(pos, target) / v;
      const q = inFlightSpot(receiver.id, team, pos, t0, target, ta);
      if (q) target = inBounds(q);
      v = passSpeed(dist(pos, target));
    }
    const d = dist(pos, target);
    if (d < 3) return false;

    if (forTurnover) {
      // Cut out: the opponent nearest the pass line within reach, where he meets it.
      let best = null;
      for (const o of frame.players) {
        if (o.team === team || o.role === 'GK' || o.id === learner) continue;
        const u = projectionParam(o, pos, target);
        if (u < P.interceptAt[0] || u > P.interceptAt[1]) continue;
        const reach = pointSegmentDistance(o, pos, target);
        if (reach <= P.interceptReach && (!best || reach < best.reach)) best = { o, u, reach };
      }
      if (!best) return false;
      let point = inBounds({ x: pos.x + best.u * (target.x - pos.x), y: pos.y + best.u * (target.y - pos.y) });
      const ti0 = t0 + dist(pos, point) / v;
      const q = inFlightSpot(best.o.id, team, pos, t0, point, ti0);
      if (q) { // he moves across to meet it: re-project his in-flight spot on the line
        const u = clamp(projectionParam(q, pos, target), P.interceptAt[0], P.interceptAt[1]);
        point = inBounds({ x: pos.x + u * (target.x - pos.x), y: pos.y + u * (target.y - pos.y) });
      }
      const ti = rt(t0 + dist(pos, point) / v);
      if (!(ti > t0 + 0.15)) return false;
      ballKey(t0, pos, 'pass');
      carrierKey(t0, null);
      ballKey(ti, point);
      team = other(team);
      possessionKey(ti, team);
      carrierKey(ti, best.o.id);
      carrierId = best.o.id;
      pos = point;
      t = ti;
      return true;
    }

    const ta = rt(t0 + d / v);
    ballKey(t0, pos, 'pass');
    carrierKey(t0, null);
    ballKey(ta, target);
    carrierKey(ta, receiver.id);
    carrierId = receiver.id;
    pos = target;
    t = ta;
    return true;
  };

  const carry = (t0, continuing = false) => {
    const dir = dirOf(team);
    // Straight ahead, turned away from a near touchline; stops short of the opponents' box.
    const wide = (pos.y - MID_Y) / MID_Y; // -1 our left touchline .. 1 our right
    const angle = ((rng.range(-P.carryAngle, P.carryAngle) - 25 * wide * dir) * Math.PI) / 180;
    const speed = rng.range(P.carrySpeed[0], P.carrySpeed[1]);
    let dur = rng.range(P.carryTime[0], P.carryTime[1]);
    const step = { x: dir * Math.cos(angle), y: dir * Math.sin(angle) };
    const limit = team === 'us' ? P.attackLimit : LENGTH - P.attackLimit;
    const room = team === 'us' ? limit - pos.x : pos.x - limit;
    if (step.x * dir > 0 && room < speed * dur * step.x * dir) dur = Math.max(0, room / (speed * Math.abs(step.x)));
    if (dur < 0.5) return false;
    let end = inBounds({ x: pos.x + step.x * speed * dur, y: pos.y + step.y * speed * dur });
    const len = dist(pos, end);
    if (len < speed * 0.5) return false;
    const t1 = rt(t0 + len / speed);
    ballKey(t0, pos, continuing ? undefined : 'carry');
    ballKey(t1, end);
    pos = end;
    t = t1;
    return true;
  };

  const tackle = (t0, frame) => {
    const nearOpp = frame.players.filter((p) => p.team !== team && p.role !== 'GK' && p.id !== learner && dist(p, pos) <= P.tackleReach);
    if (!nearOpp.length) return false;
    const tackler = nearOpp.reduce((a, b) => (dist(b, pos) < dist(a, pos) ? b : a));
    const winner = other(team);
    const wdir = dirOf(winner);
    const angle = (rng.range(-60, 60) * Math.PI) / 180;
    const len = rng.range(P.looseDistance[0], P.looseDistance[1]);
    const loose = inBounds({ x: pos.x + wdir * Math.cos(angle) * len, y: pos.y + Math.sin(angle) * len });
    const t1 = rt(t0 + Math.max(dist(pos, loose), 1) / rng.range(P.looseSpeed[0], P.looseSpeed[1]));
    ballKey(t0, pos);
    possessionKey(t0, 'none');
    carrierKey(t0, null);
    ballKey(t1, loose);
    // Whoever of the winning side stands nearest the loose ball when it stops.
    const f = autoFrame({ formations, ball: loose, shapeBall: shapeAt(t1), possession: 'none', learnerId: learner });
    const id = nearestId(f.players.filter((p) => eligible(p, winner)), loose) ?? tackler.id;
    possessionKey(t1, winner);
    carrierKey(t1, id);
    team = winner;
    carrierId = id;
    pos = loose;
    t = t1;
    return true;
  };

  // ---- play on: first touch, then carry or pass; a scheduled turnover takes the next action
  let guard = 0;
  while (t < D && guard++ < 500) {
    const hold = afterCarry ? (rng.chance(0.5) ? 0 : rng.range(0.15, 0.4)) : rng.range(P.holdTime[0], P.holdTime[1]);
    const t0 = rt(t + hold);
    const frame = sceneAt(t0, pos, team, carrierId);
    const wasCarry = afterCarry;
    afterCarry = false;
    if (turnIdx < nTurn && t0 >= turnAt[turnIdx]) {
      const done = (rng.chance(P.interceptChance) && pass(t0, frame, { forTurnover: true })) || tackle(t0, frame) || pass(t0, frame, { forTurnover: true });
      if (done) { turnIdx++; continue; }
    }
    if (!wasCarry && rng.chance(P.carryChance) && carry(t0)) { afterCarry = true; continue; }
    if (wasCarry && rng.chance(0.3) && carry(t0, true)) { afterCarry = true; continue; }
    if (pass(t0, frame)) continue;
    if (carry(t0, wasCarry)) { afterCarry = true; continue; }
    // Boxed in: the least bad pass on the frame the viewer sees (else to the nearest teammate), whatever the lane.
    const mates = frame.players.filter((p) => eligible(p, team) && p.id !== carrierId);
    const rated = ratePasses(view.frameBefore(t0), carrierId, team);
    const ranked = rated ? mates.filter((m) => rated.has(m.id)).sort((a, b) => rated.get(b.id).U - rated.get(a.id).U) : [];
    const id = ranked[0]?.id ?? nearestId(mates, pos);
    const q = mates.find((p) => p.id === id);
    const target = inBounds(q);
    const d = Math.max(dist(pos, target), 3);
    const ta = rt(t0 + d / passSpeed(d));
    ballKey(t0, pos, 'pass');
    carrierKey(t0, null);
    ballKey(ta, target);
    carrierKey(ta, id);
    carrierId = id;
    pos = target;
    t = ta;
  }

  // ---- cut to the duration (the ball interpolated at D; later keys dropped)
  const end = interpKeys(ball, D);
  const keep = (keys) => keys.filter((k) => k.t <= D + 1e-9);
  const ballOut = keep(ball);
  if (!ballOut.length || ballOut[ballOut.length - 1].t < D - 1e-9) ballOut.push({ t: D, ...rp(end) });
  const possOut = keep(possession), carrierOut = keep(carrier);
  const lastTeam = possOut[possOut.length - 1].team;
  const moment = lastTeam === 'us' ? 'in_possession' : lastTeam === 'them' ? 'out_of_possession' : 'defensive_transition';

  const seedText = String(seed);
  return {
    id: `live-${seedText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'seed'}`,
    title: 'Live sequence',
    brief: 'Play runs on: keep moving to where you should be.',
    module: 'live',
    moment,
    phase: 'open_play',
    principles: [...P.principles],
    learner: { role },
    timeline: {
      duration: D,
      ball: ballOut,
      possession: possOut,
      carrier: carrierOut,
      players: { auto: true, overrides: [] },
      tags: [],
    },
    answer: { mode: 'engine' },
    misconceptions: [],
    difficulty: 0,
    params: {},
    source: { kind: 'generated', generator: 'fotbol sequence v1', seed: seedText, license: 'MIT', author: 'fotbol' },
  };
}

function nearestId(players, p) {
  let best = null, bd = Infinity;
  for (const q of players) {
    const d = dist(q, p);
    if (d < bd) { bd = d; best = q.id; }
  }
  return best;
}

/** Pass options of the carrier in a frame (their passes rated on the swapped frame): feet options by receiver id. */
function ratePasses(frame, carrierId, team) {
  if (frame.carrierId !== carrierId) return null;
  const rating = rateOptions(team === 'us' ? frame : swapTeams(frame), carrierId);
  return new Map(rating.options.filter((o) => o.kind === 'feet').map((o) => [o.targetId, o]));
}

/**
 * The free playback (nobody held back) of a sequence while generateSequence() is still writing it: what the viewer
 * will see. Keys are only ever written at or after the time being decided, so every state decided at a key before
 * that time is final and is kept (createPlayback's states, blends and press commitments, computed once).
 * frameBefore(t) is the frame just before t, before any key at t: the placement of the state then, what is left of
 * its blend, and the settle and separation as they are at t (not averaged over adjustWindow: a few centimetres).
 */
function writingPlayback(scenario, formations) {
  const P = TIMELINE_DEFAULTS;
  const bareP = { ...P, settle: false, separationPasses: 0 };
  const tl = scenario.timeline;
  const sceneAt = (at) => ({
    formations, ball: ballAt(scenario, at), shapeBall: meanBallAt(scenario, at - P.reactionLag - P.shapeWindow, at - P.reactionLag), overrides: {},
  });
  const decide = (t, players) => {
    const possession = possessionAt(scenario, t), c = carrierAt(scenario, t), inFlight = c === null;
    const rankFrom = players ? Object.fromEntries(players.map((p) => [p.id, { x: p.x, y: p.y }])) : undefined;
    const roles = autoRoles({ ...sceneAt(t), possession, carrierId: c ?? null, inFlight, rankFrom, params: { ...P, pressHandover: 0 } });
    const presserId = roles.presser && roles.presser.w >= P.pressCommit ? roles.presser.id : null;
    return { t, possession, inFlight, carrierId: roles.carrierId, presserId };
  };
  const raw = (s, at, params) => autoFrame({ ...sceneAt(at), params, possession: s.possession, carrierId: s.carrierId, autoCarrier: false, inFlight: s.inFlight, presserId: s.presserId });
  const segs = [];
  let last = 0; // key times up to this are decided
  const place = (s, at, params) => {
    const f = raw(s, at, params);
    if (!s.off || at - s.t >= s.longest) return f;
    const dt = at - s.t;
    f.players = f.players.map((p, i) => {
      const o = s.off[i], left = o.T > 0 ? 1 - dt / o.T : 0;
      return left > 0 ? { ...p, x: p.x + left * o.ox, y: p.y + left * o.oy } : p;
    });
    return f;
  };
  return {
    frameBefore(t) {
      if (!segs.length) segs.push({ ...decide(0, null), t: -Infinity });
      const keys = [...new Set([...tl.ball, ...tl.possession, ...tl.carrier].map((k) => k.t))].filter((k) => k > last && k < t).sort((a, b) => a - b);
      for (const kt of keys) {
        const prev = segs[segs.length - 1];
        const was = place(prev, kt, bareP).players;
        const s = decide(kt, was);
        last = kt;
        if (s.possession === prev.possession && s.carrierId === prev.carrierId && s.inFlight === prev.inFlight && s.presserId === prev.presserId) continue;
        const blend = s.possession !== prev.possession ? P.possessionBlend : P.carrierBlend;
        const longest = Math.max(blend, P.maxBlend);
        const wants = raw(s, kt, bareP).players;
        const off = was.map((w, i) => {
          const ox = w.x - wants[i].x, oy = w.y - wants[i].y;
          return { ox, oy, T: clamp(Math.hypot(ox, oy) / P.recoverSpeed, blend, longest) };
        });
        segs.push({ ...s, blend, longest, off });
      }
      const s = segs[segs.length - 1];
      const f = place(s, t, P);
      return { t, ball: ballAt(scenario, t), possession: s.possession, carrierId: f.carrierId, players: f.players, tags: {} };
    },
  };
}

// ---------------------------------------------------------------- live-mode helpers

/**
 * Moments the learner needs reaction time after (RESEARCH 5.7: ignore 0.7 s after each ball event):
 * every ball event except the start of a carry (the ball keeps rolling at the carrier's feet), plus
 * every change of possession (a turnover flips everyone's job).
 * @returns {{t:number, event:string}[]} sorted by t
 */
export function graceEvents(scenario) {
  const out = ballEvents(scenario).filter((e) => e.event !== 'carry');
  let prev = null;
  for (const k of scenario.timeline?.possession ?? []) {
    if (prev !== null && k.team !== prev) out.push({ t: k.t, event: 'turnover' });
    prev = k.team;
  }
  out.sort((a, b) => a.t - b.t);
  return out.filter((e, i) => i === 0 || e.t !== out[i - 1].t || e.event !== out[i - 1].event);
}

// ---------------------------------------------------------------- incremental playback

/**
 * Incremental playback of a scenario: frameAt(t, learnerSpot) returns what timeline.frameAt(scenario,
 * t, { formations, learnerId, learnerSpot, params }) returns for a fixed learnerSpot, at about the cost
 * of one autoFrame() call. Each state change (possession, carrier, in-flight, presser, decided at key
 * times as in timeline.js, the press ranked on where the players are at the key) is computed the first
 * time playback reaches it, with the learner spot of that call, and kept; later calls (also for
 * earlier times) reuse it.
 * @param {object} scenario
 * @param {{ formations: {us:object, them?:object}, learnerId?: string|null, params?: object }} opts
 *   learnerId: default the scenario's learner; null = everybody auto-placed (the learner's base, as in learnerBaseAt)
 * @returns {{ frameAt: (t:number, learnerSpot?: {x:number,y:number}) => object, states: () => object[] }}
 */
export function createPlayback(scenario, opts = {}) {
  const tl = scenario.timeline ?? {};
  const P = { ...TIMELINE_DEFAULTS, ...scenario.params, ...opts.params };
  const learnerId = opts.learnerId === null ? undefined : opts.learnerId ?? (scenario.learner?.role ? playerId('us', scenario.learner.role) : undefined);
  const frozen = tl.players?.auto === false;
  const smooth = P.adjustStep > 0 && P.adjustWindow > 0;
  const bareP = smooth ? { ...P, settle: false, separationPasses: 0 } : P;
  const ahead = smooth ? P.adjustWindow / 2 + P.adjustStep : 0; // the averaged settle and separation look this far ahead

  const sceneAt = (at, spot) => {
    const lagged = frozen ? 0 : at - P.reactionLag;
    return {
      formations: opts.formations,
      ball: ballAt(scenario, at),
      shapeBall: meanBallAt(scenario, lagged - P.shapeWindow, lagged),
      learnerId,
      overrides: overridesAt(tl, at, learnerId, spot),
      params: P,
    };
  };
  // `players`: where everyone is at the key (the automatic press ranks on it, as in timeline.js).
  const decide = (t, spot, players) => {
    const possession = possessionAt(scenario, t), c = carrierAt(scenario, t), inFlight = c === null;
    const rankFrom = players ? Object.fromEntries(players.map((p) => [p.id, { x: p.x, y: p.y }])) : undefined;
    const roles = autoRoles({ ...sceneAt(t, spot), possession, carrierId: c ?? null, inFlight, rankFrom, params: { ...P, pressHandover: 0 } });
    const presserId = roles.presser && roles.presser.w >= P.pressCommit ? roles.presser.id : null;
    return { t, possession, inFlight, carrierId: roles.carrierId, presserId };
  };
  const frameOf = (s, at, spot, params) => autoFrame({ ...sceneAt(at, spot), params, possession: s.possession, carrierId: s.carrierId, autoCarrier: false, inFlight: s.inFlight, presserId: s.presserId });
  const raw = (s, at, spot) => frameOf(s, at, spot, bareP);

  const keyTimes = [...new Set([...(tl.ball ?? []), ...(tl.possession ?? []), ...(tl.carrier ?? [])].map((k) => k.t))]
    .filter((t) => t > 0)
    .sort((a, b) => a - b);
  let nextKey = 0;
  /** states: { t, possession, inFlight, carrierId, presserId, blend?, longest?, off?: {ox, oy, T}[] } */
  const segs = [];
  const stateAt = (at) => {
    let k = segs.length - 1;
    while (k > 0 && segs[k].t > at) k--; // an earlier time: the state that held then
    return k;
  };

  /** Placed players of state j at time `at` (bare placement plus what is left of its blend). */
  function place(j, at, spot) {
    const s = segs[j];
    const f = raw(s, at, spot);
    if (j === 0 || !s.off) return f;
    const dt = at - s.t;
    if (dt >= s.longest) return f;
    f.players = f.players.map((p, i) => {
      const o = s.off[i];
      const left = o.T > 0 ? 1 - dt / o.T : 0;
      return left > 0 ? { ...p, x: p.x + left * o.ox, y: p.y + left * o.oy } : p;
    });
    return f;
  }

  function advance(t, spot) {
    if (!segs.length) segs.push({ ...decide(0, spot, null), t: -Infinity });
    while (nextKey < keyTimes.length && keyTimes[nextKey] <= t) {
      const kt = keyTimes[nextKey++];
      const was = place(segs.length - 1, kt, spot).players;
      const s = decide(kt, spot, was), prev = segs[segs.length - 1];
      if (s.possession === prev.possession && s.carrierId === prev.carrierId && s.inFlight === prev.inFlight && s.presserId === prev.presserId) continue;
      const blend = s.possession !== prev.possession ? P.possessionBlend : P.carrierBlend;
      const longest = Math.max(blend, P.maxBlend);
      const wants = raw(s, kt, spot).players;
      const off = was.map((w, i) => {
        const ox = w.x - wants[i].x, oy = w.y - wants[i].y;
        return { ox, oy, T: clamp(Math.hypot(ox, oy) / P.recoverSpeed, blend, longest) };
      });
      segs.push({ ...s, blend, longest, off });
    }
  }

  // Settle and separation at grid sample i (timeline.js adjustCells), computed once, with the learner spot
  // of the call that first needs it.
  const grid = new Map();
  const adjustAt = (i, spot) => {
    if (!grid.has(i)) {
      const g = i * P.adjustStep, s = segs[stateAt(g)];
      grid.set(i, adjustmentOf(frameOf(s, g, spot, P), frameOf(s, g, spot, bareP)));
    }
    return grid.get(i);
  };

  function frameAt(t, learnerSpot) {
    advance(t + ahead, learnerSpot);
    const k = stateAt(t);
    const f = applyAdjustments(place(k, t, learnerSpot), adjustCells(t, P), (i) => adjustAt(i, learnerSpot));
    return { t, ball: ballAt(scenario, t), possession: segs[k].possession, carrierId: f.carrierId, players: f.players, tags: tagsAt(scenario, t, segs[k].possession, P) };
  }

  return {
    frameAt,
    /** The states decided so far (for tests and debugging). */
    states: () => segs.map(({ off: _off, ...s }) => ({ ...s })),
  };
}

// overridesAt and tagsAt are imported from timeline.js (the byte-for-byte twins here went with the 2026-10-01 audit).
