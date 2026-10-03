// Scenario playback: the frame of a ball-scripted scenario at time t.
// Contract: docs/ARCHITECTURE.md §5.3. Rationale: docs/RESEARCH.md §9.4 (format), §5.7 (live mode).
//
// Authors script the ball; the engine places everyone else with autoFrame(). Tracks:
//   ball, overrides      linear between keys, held before the first and after the last key
//   possession           step function; before the first key, the first key's team
//   carrier              step function; before the first key the carrier is automatic;
//                        null = ball in flight (no carrier, no press); an id = that player on the ball
//   tags                 step function, merged cumulatively into frame.tags
// frameAt() is a pure function of t (scrubbing and replay give identical frames).
// Playback moves through discrete states (possession, carrier, presser). They are decided at t = 0
// and at every key time: automatic carriers and pressers (autoRoles) are committed to until the
// next key, so the press is never handed over mid-carry. A change of state never teleports anyone:
// each player's gap between where they were and where the new state wants them closes linearly,
// over possessionBlend (or carrierBlend) seconds, or longer so that nobody recovers faster than
// recoverSpeed. The goal-side settle and the separation of autoFrame() are added last, averaged
// over adjustWindow seconds (adjustCells), so they never snap either.

import { lerp, clamp } from './geometry.js';
import { MID_Y, HALF_X, clampToPitch } from './pitch.js';
import { ROLES, playerId } from './roles.js';
import { teamTargets } from './formation.js';
import { autoFrame, autoRoles } from './scene.js';

export const TIMELINE_DEFAULTS = Object.freeze({
  reactionLag: 0.3, // [D] s: auto players react to where the ball was this long ago
  shapeWindow: 1.0, // [D] s: ...averaged over this window, so a pass shifts the shape gradually rather than at ball speed
  runSpeed: 7, // [D] m/s: an auto player follows his own formation target no faster than this (runTargets), so after a
  //             long pass the team shifts at a run instead of at 15-25 m/s (targets move up to 1.6 m per metre of ball)
  runStep: 0.05, // [D] s: the grid that run is integrated on
  possessionBlend: 1.0, // [D] s: minimum time for the shape change after a turnover
  carrierBlend: 0.5, // [D] s: minimum time for passer, receiver and presser to re-position after a carrier or presser change
  pressCommit: 0.5, // [D] at a key time the automatic presser is committed to (pressing fully until the next key) if its range weight is at least this
  recoverSpeed: 6, // [D] m/s: blends last long enough that closing a gap never needs more than this
  maxBlend: 4, // [D] s: ...but never longer than this
  eventGrace: 0.7, // [S] s: live mode ignores this long after each ball event (0.7 s reaction time, RESEARCH 5.7/5.8)
  sampleHz: 10, // [D] live-mode scoring rate (RESEARCH 5.7)
  ballBackWindow: 1.0, // [D] s: look-back window for deriving tags.ballMovingBack
  ballBackDist: 3, // [D] m: ball travel towards the possessing team's own goal that counts as "moving back"
  eventAhead: 1.0, // [D] s: an event this soon after t (by the team on the ball) is derived as tags.nextEvent / nextEventIn,
  //                  so a rule can judge the moment the ball is about to be played (offside at a pass, F4)
  adjustStep: 0.1, // [D] s: the goal-side settle and the separation (scene.js) are sampled on this grid...
  adjustWindow: 0.5, // [D] s: ...and averaged over this window centred on t, so they never snap (a change of d metres
  //                     takes the window: an auto player is no longer flung 3-4 m in 0.1 s as two players cross); 0 = off
});

const MOMENT_POSSESSION = Object.freeze({ in_possession: 'us', out_of_possession: 'them' });
const CENTRE_SPOT = Object.freeze({ x: HALF_X, y: MID_Y });

/**
 * Linear interpolation over `[{t, x, y}]` keys sorted by t, held at both ends.
 * @returns {{x:number,y:number}|null} null when there are no keys
 */
export function interpKeys(keys, t) {
  if (!keys?.length) return null;
  const first = keys[0], last = keys[keys.length - 1];
  if (!(t > first.t)) return { x: first.x, y: first.y };
  if (t >= last.t) return { x: last.x, y: last.y };
  let i = 1;
  while (keys[i].t < t) i++;
  const a = keys[i - 1], b = keys[i];
  const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
}

/** Step function: the last key with key.t <= t, or undefined. */
export function stepKey(keys, t) {
  let hit;
  for (const k of keys ?? []) if (k.t <= t) hit = k;
  return hit;
}

/** Ball position at t (the centre spot if the scenario has no ball keys). */
export function ballAt(scenario, t) {
  return interpKeys(scenario.timeline?.ball, t) ?? { ...CENTRE_SPOT };
}

/** Exact mean of the (piecewise-linear) ball path over [a, b]; ballAt(b) when the window is empty. */
export function meanBallAt(scenario, a, b) {
  if (!(b > a)) return ballAt(scenario, b);
  const ts = [a, ...(scenario.timeline?.ball ?? []).map((k) => k.t).filter((t) => t > a && t < b), b];
  let sx = 0, sy = 0;
  let p = ballAt(scenario, a);
  for (let i = 1; i < ts.length; i++) {
    const q = ballAt(scenario, ts[i]), h = ts[i] - ts[i - 1];
    sx += ((p.x + q.x) / 2) * h;
    sy += ((p.y + q.y) / 2) * h;
    p = q;
  }
  return { x: sx / (b - a), y: sy / (b - a) };
}

// Run-limited formation targets: per ball-key array (WeakMap, so scenarios can be collected), one track per formation,
// parameter set, team and shape mode. A track keeps a copy of the keys it was built from: sequence.js writes keys while
// it plays (and tries one and takes it back), so a changed key drops only the samples that could have seen it.
const RUN_TRACKS = new WeakMap();
const FORMATION_IDS = new WeakMap();
let formationCount = 0;
const NO_KEYS = [];

function runTrack(keys, id, P) {
  let byId = RUN_TRACKS.get(keys);
  if (!byId) RUN_TRACKS.set(keys, (byId = new Map()));
  let tr = byId.get(id);
  if (!tr) byId.set(id, (tr = { keys: [], samples: [] }));
  let j = 0;
  const n = Math.min(keys.length, tr.keys.length);
  while (j < n && keys[j].t === tr.keys[j].t && keys[j].x === tr.keys[j].x && keys[j].y === tr.keys[j].y) j++;
  if (j < keys.length || j < tr.keys.length) {
    // Samples whose shape window ends at or before key j-1 never saw key j onward.
    const keep = j > 0 ? Math.floor((keys[j - 1].t + P.reactionLag) / P.runStep + 1e-9) + 1 : 0;
    if (tr.samples.length > keep) tr.samples.length = Math.max(0, keep);
    tr.keys = keys.map((k) => ({ t: k.t, x: k.x, y: k.y }));
  }
  return tr;
}

/** Each of `to`'s points moved from `from` by at most `max` metres (Float64Array [x0, y0, x1, y1, ...]). */
function stepTowards(from, to, max) {
  const out = new Float64Array(to.length);
  for (let i = 0; i < to.length; i += 2) {
    const dx = to[i] - from[i], dy = to[i + 1] - from[i + 1], d = Math.hypot(dx, dy);
    const u = d <= max ? 1 : max > 0 ? max / d : 0; // max can be a hair below 0 on the grid (floating point)
    out[i] = from[i] + dx * u;
    out[i + 1] = from[i + 1] + dy * u;
  }
  return out;
}

/**
 * Formation targets as auto players run to them: each player follows his own target (formation.js teamTargets for the
 * shape ball, in the shape a possession gives his team) at no more than runSpeed m/s, integrated from t = 0 on a
 * runStep grid, so it is a pure, continuous function of t. Without it a 25 m pass moved the averaged ball at up to
 * 22 m/s, and touchline targets up to 1.6 m per metre of it. A player whose target moves slower than a run is exactly
 * on it. The learner's base is judged on the targets themselves (learnerBaseAt: where the role belongs once the shape
 * has shifted), so the run never moves a drill's answer zone. runSpeed 0 (generated drills, which land on a rated
 * still scene) = no run: undefined, and autoFrame computes the targets itself.
 * @param {object} scenario
 * @param {number} t
 * @param {{ formations: {us:object, them?:object}, possession: 'us'|'them'|'none', params?: object }} opts
 *   params: TIMELINE_DEFAULTS and SCENE params (params.shape as for autoFrame)
 * @returns {{ us: Object<string,{x:number,y:number}>, them: Object<string,{x:number,y:number}> }|undefined}
 */
export function runTargets(scenario, t, { formations, possession, params } = {}) {
  const P = params ?? TIMELINE_DEFAULTS;
  const v = P.runSpeed, h = P.runStep;
  if (!(v > 0 && h > 0) || scenario.timeline?.players?.auto === false) return undefined;
  const keys = scenario.timeline?.ball ?? NO_KEYS;
  const shapeAt = (at) => meanBallAt(scenario, at - P.reactionLag - P.shapeWindow, at - P.reactionLag);
  const attacking = possession === 'us' || possession === 'them';
  const shape = P.shape ?? true;
  const out = {};
  for (const team of ['us', 'them']) {
    const formation = team === 'us' ? formations.us : formations.them ?? formations.us;
    if (!FORMATION_IDS.has(formation)) FORMATION_IDS.set(formation, ++formationCount);
    const inPossession = possession === team;
    const opts = { inPossession, offset: attacking, shape };
    const id = `${FORMATION_IDS.get(formation)}|${team}|${inPossession}|${attacking}|${P.reactionLag}|${P.shapeWindow}|${v}|${h}|${typeof shape === 'object' ? JSON.stringify(shape) : shape}`;
    const tr = runTrack(keys, id, P);
    const targetAt = (at) => {
      const q = teamTargets(formation, team, shapeAt(at), opts);
      const a = new Float64Array(ROLES.length * 2);
      ROLES.forEach((role, i) => { a[2 * i] = q[role].x; a[2 * i + 1] = q[role].y; });
      return a;
    };
    const S = tr.samples;
    const k = t > 0 ? Math.floor(t / h + 1e-9) : 0;
    while (S.length <= k) {
      const i = S.length;
      S.push(i === 0 ? targetAt(0) : stepTowards(S[i - 1], targetAt(i * h), v * h));
    }
    const at = t > 0 && t - k * h > 0 ? stepTowards(S[k], targetAt(t), v * (t - k * h)) : t > 0 ? S[k] : targetAt(t);
    const roles = {};
    ROLES.forEach((role, i) => { roles[role] = { x: at[2 * i], y: at[2 * i + 1] }; });
    out[team] = roles;
  }
  return out;
}

/** Possession at t: step function over timeline.possession, else derived from `moment`, else 'none'. */
export function possessionAt(scenario, t) {
  const keys = scenario.timeline?.possession ?? [];
  const k = stepKey(keys, t) ?? keys[0];
  return k?.team ?? MOMENT_POSSESSION[scenario.moment] ?? 'none';
}

/** Carrier at t: undefined = automatic (before the first key), null = ball in flight, else a player id. */
export function carrierAt(scenario, t) {
  const k = stepKey(scenario.timeline?.carrier, t);
  return k === undefined ? undefined : k.id ?? null;
}

/**
 * Playback length and freeze time. duration defaults to the last key time; freezeAt defaults
 * to duration and is clamped into [0, duration].
 * @returns {{duration:number, freezeAt:number}}
 */
export function timing(scenario) {
  const tl = scenario.timeline ?? {};
  let duration = tl.duration;
  if (!(duration >= 0)) {
    const tags = Array.isArray(tl.tags) ? tl.tags : [];
    const keys = [tl.ball, tl.possession, tl.carrier, tags, ...(tl.players?.overrides ?? []).map((o) => o.keys)];
    duration = Math.max(0, ...keys.flatMap((ks) => (ks ?? []).map((k) => k.t)).filter(Number.isFinite));
  }
  return { duration, freezeAt: clamp(tl.freezeAt ?? duration, 0, duration) };
}

/**
 * Ball events for live-mode reaction grace: ball keys with an `event`, plus tag keys with an
 * `event`, sorted by t (duplicates removed). An event marks the moment it happens (a 'pass' key
 * is where the ball is struck).
 * @returns {{t:number, event:string}[]}
 */
export function ballEvents(scenario) {
  const tl = scenario.timeline ?? {};
  const out = [];
  for (const k of tl.ball ?? []) if (k.event) out.push({ t: k.t, event: k.event });
  if (Array.isArray(tl.tags)) for (const k of tl.tags) if (k.event) out.push({ t: k.t, event: k.event });
  out.sort((a, b) => a.t - b.t);
  return out.filter((e, i) => i === 0 || e.t !== out[i - 1].t || e.event !== out[i - 1].event);
}

/** True if t falls within `grace` seconds after any event (live mode does not score these samples). */
export function inGrace(events, t, grace = TIMELINE_DEFAULTS.eventGrace) {
  return events.some((e) => t >= e.t && t < e.t + grace);
}

/**
 * Sample times for live-mode scoring: from, from + 1/hz, ... up to `to` (default: the whole scenario).
 * @returns {number[]}
 */
export function sampleTimes(scenario, { hz = TIMELINE_DEFAULTS.sampleHz, from = 0, to } = {}) {
  const end = to ?? timing(scenario).duration;
  const n = Math.floor((end - from) * hz + 1e-9);
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => from + i / hz);
}

/**
 * The frame of a scenario at time t.
 * - Auto players follow autoFrame(): the formation reacts to the ball's mean position over
 *   [t - reactionLag - shapeWindow, t - reactionLag], each player running to his target at no more than runSpeed
 *   (runTargets); the carrier, press spot and onside line use
 *   the ball at t. `players.auto: false` freezes the shape at its t = 0 position.
 * - Overrides (linear between keys) win over everything. The explicit carrier is placed at the ball.
 *   Automatic carriers (before the first carrier key) and pressers are decided at t = 0 and at every
 *   ball, possession and carrier key, and kept until the next one. At a key the press is ranked on
 *   where the players are at that moment (autoFrame's rankFrom), not on their formation spots, so
 *   after a turnover nobody is sent to press past a teammate who is already goal-side.
 * - frame.tags: the tag keys so far, merged; `phase` defaults to scenario.phase; `ballMovingBack`
 *   is derived from the last ballBackWindow seconds of ball movement unless a tag sets it; `nextEvent` and
 *   `nextEventIn` name the next event (not a carry) by the team on the ball within eventAhead seconds.
 * - `scenario.params` is merged over SCENE_DEFAULTS / TIMELINE_DEFAULTS (opts.params wins), and may
 *   also set autoPress, autoCarrier or onsideClamp.
 * - `learner.start` is for the UI: pass it as learnerSpot to pin the learner there.
 *
 * @param {object} scenario
 * @param {number} t  seconds
 * @param {{ formations: {us:object, them?:object}, learnerId?: string|null, learnerSpot?: {x:number,y:number}, params?: object }} opts
 *   learnerId defaults to the scenario's learner; null places everybody automatically
 * @returns {import('./types.js').Frame}
 */
export function frameAt(scenario, t, opts = {}) {
  const { f, state, P } = play(scenario, t, opts, false);
  return { t, ball: ballAt(scenario, t), possession: state.possession, carrierId: f.carrierId, players: f.players, tags: tagsAt(scenario, t, state.possession, P) };
}

/**
 * The settle and separation adjustments (autoFrame with them minus without them) are sampled every
 * adjustStep seconds, each sample holding for the adjustStep around it, and averaged over adjustWindow
 * seconds centred on t: a pure, continuous function of t that spreads any snap over the window. Returns
 * the grid samples [index i (time i x adjustStep), weight] the average at t uses (the weights sum to 1),
 * or [] when adjustStep or adjustWindow is 0 (then the adjustments are applied as they come).
 * @param {number} t
 * @param {{adjustStep:number, adjustWindow:number}} [P]
 * @returns {[number, number][]}
 */
export function adjustCells(t, P = TIMELINE_DEFAULTS) {
  const h = P.adjustStep, W = P.adjustWindow;
  if (!(h > 0 && W > 0)) return [];
  const a = t - W / 2, b = t + W / 2;
  const out = [];
  for (let i = Math.floor(a / h - 0.5); (i - 0.5) * h < b; i++) {
    const lo = Math.max(a, (i - 0.5) * h), hi = Math.min(b, (i + 0.5) * h);
    if (hi > lo) out.push([i, (hi - lo) / W]);
  }
  return out;
}

/**
 * Add the averaged adjustments to a placed frame (mutates and returns it): `cells` from adjustCells(),
 * `adjustAt(i)` the per-player [dx, dy] of grid sample i. Shared with sequence.js createPlayback.
 */
export function applyAdjustments(f, cells, adjustAt) {
  if (!cells.length) return f;
  const dx = new Float64Array(f.players.length), dy = new Float64Array(f.players.length);
  for (const [i, w] of cells) {
    const d = adjustAt(i);
    for (let n = 0; n < d.length; n++) { dx[n] += w * d[n][0]; dy[n] += w * d[n][1]; }
  }
  f.players = f.players.map((p, n) => (dx[n] || dy[n] ? { ...p, ...clampToPitch({ x: p.x + dx[n], y: p.y + dy[n] }) } : p));
  return f;
}

/** Per-player [dx, dy] that settle and separation add to a bare placement (same players, same order). */
export function adjustmentOf(full, bare) {
  return full.players.map((p, n) => [p.x - bare.players[n].x, p.y - bare.players[n].y]);
}

/**
 * Playback up to t: the discrete states (possession, carrier, in-flight flag, presser), decided at t = 0
 * and at every ball, possession or carrier key, each from where the players are at that key (the previous
 * state's placement with what is left of its blend; the settle and separation, a metre or two, are left
 * out there so no decision waits on a later one), then the placement at t: the state's placement without
 * settle and separation, what is left of its blend, then the averaged settle and separation (adjustCells).
 * The average reaches up to adjustWindow / 2 ahead, so the states are decided that far ahead too.
 * `unblended`: the current state's placement at t without what is left of its blend and on the formation targets
 * themselves (not run-limited: runTargets); the states and the averaged settle and separation are exactly the blended
 * playback's.
 */
function play(scenario, t, opts, unblended) {
  const tl = scenario.timeline ?? {};
  const P = { ...TIMELINE_DEFAULTS, ...scenario.params, ...opts.params };
  // learnerId: null = nobody is held back as the learner (every player auto-placed).
  const learnerId = opts.learnerId === null ? undefined : opts.learnerId ?? (scenario.learner?.role ? playerId('us', scenario.learner.role) : undefined);

  // Scene inputs at time `at` (everything but the discrete state and the run-limited targets).
  const sceneAt = (at) => {
    const lagged = tl.players?.auto === false ? 0 : at - P.reactionLag;
    return {
      formations: opts.formations,
      ball: ballAt(scenario, at),
      shapeBall: meanBallAt(scenario, lagged - P.shapeWindow, lagged),
      learnerId,
      overrides: overridesAt(tl, at, learnerId, opts.learnerSpot),
      params: P,
    };
  };
  // The state at a key time; `players` (where everyone is then) ranks the automatic press.
  const decide = (at, players) => {
    const possession = possessionAt(scenario, at), carrier = carrierAt(scenario, at), inFlight = carrier === null;
    const rankFrom = players ? Object.fromEntries(players.map((p) => [p.id, { x: p.x, y: p.y }])) : undefined;
    // Hard switch: the lead-based handover only exists to keep a static scene smooth under a dragged ball.
    const targets = runTargets(scenario, at, { formations: opts.formations, possession, params: P });
    const roles = autoRoles({ ...sceneAt(at), targets, possession, carrierId: carrier ?? null, inFlight, rankFrom, params: { ...P, pressHandover: 0 } });
    const presserId = roles.presser && roles.presser.w >= P.pressCommit ? roles.presser.id : null;
    return { t: at, possession, inFlight, carrierId: roles.carrierId, presserId };
  };

  const segs = [];
  const cells = adjustCells(t, P);
  const smooth = P.adjustStep > 0 && P.adjustWindow > 0;
  const bareP = smooth ? { ...P, settle: false, separationPasses: 0 } : P;
  // How state j places the players at time `at` (with `params`: bareP leaves settle and separation out).
  // `settled`: the targets themselves, not where the auto players have run to (the learner's base: see learnerBaseAt).
  const frameOf = (j, at, params, settled) => {
    const s = segs[j];
    const targets = settled ? undefined : runTargets(scenario, at, { formations: opts.formations, possession: s.possession, params: P });
    return autoFrame({ ...sceneAt(at), targets, params, possession: s.possession, carrierId: s.carrierId, autoCarrier: false, inFlight: s.inFlight, presserId: s.presserId });
  };
  const raw = (j, at, settled) => frameOf(j, at, bareP, settled);
  const stateAt = (at) => {
    let j = segs.length - 1;
    while (j > 0 && segs[j].t > at) j--;
    return j;
  };
  // Blending: at a state change each player is offset from where the new state wants them by
  // (where they were) - (new target); that offset shrinks linearly to zero over
  // clamp(|offset| / recoverSpeed, blend, maxBlend) seconds. The offsets are worked out once per state.
  const starts = new Map();
  const place = (j, at) => {
    const f = raw(j, at);
    if (j === 0) return f;
    const seg = segs[j], dt = at - seg.t;
    const blend = seg.possession !== segs[j - 1].possession ? P.possessionBlend : P.carrierBlend;
    const longest = Math.max(blend, P.maxBlend);
    if (dt >= longest) return f;
    if (!starts.has(j)) starts.set(j, { was: place(j - 1, seg.t).players, wants: raw(j, seg.t).players });
    const { was, wants } = starts.get(j);
    f.players = f.players.map((p, i) => {
      const ox = was[i].x - wants[i].x, oy = was[i].y - wants[i].y;
      const T = clamp(Math.hypot(ox, oy) / P.recoverSpeed, blend, longest);
      const left = T > 0 ? 1 - dt / T : 0;
      return left > 0 ? { ...p, x: p.x + left * ox, y: p.y + left * oy } : p;
    });
    return f;
  };
  // Settle and separation at grid sample i, in the state that holds then.
  const grid = new Map();
  const adjustAt = (i) => {
    if (!grid.has(i)) {
      const g = i * P.adjustStep, j = stateAt(g);
      grid.set(i, adjustmentOf(frameOf(j, g, P), frameOf(j, g, bareP)));
    }
    return grid.get(i);
  };

  // Consecutive identical states are merged; the first holds from the start of playback.
  segs.push({ ...decide(0, null), t: -Infinity });
  for (const kt of keyTimes(scenario, smooth ? t + P.adjustWindow / 2 + P.adjustStep : t)) {
    const s = decide(kt, place(segs.length - 1, kt).players), prev = segs[segs.length - 1];
    if (s.possession !== prev.possession || s.carrierId !== prev.carrierId || s.inFlight !== prev.inFlight || s.presserId !== prev.presserId) segs.push(s);
  }
  const k = stateAt(t);
  return { f: applyAdjustments(unblended ? raw(k, t, true) : place(k, t), cells, adjustAt), state: segs[k], P };
}

/** Times after 0 and up to tMax at which the playback state is decided: every ball, possession and carrier key. */
function keyTimes(scenario, tMax) {
  const tl = scenario.timeline ?? {};
  return [...new Set([...(tl.ball ?? []), ...(tl.possession ?? []), ...(tl.carrier ?? [])].map((k) => k.t))]
    .filter((t) => t > 0 && t <= tMax)
    .sort((a, b) => a - b);
}

/**
 * The learner's base at time t: the zone centre and the spot duties are computed at when a drill
 * freezes there (docs/ARCHITECTURE.md §5.3; the playback twin of scene.js learnerBase()). It is the
 * learner role's spot in the same playback with nobody held back as the learner: its formation
 * spot, or its press spot when the playback commits it to press. It is where the CURRENT state
 * wants the role (the blends are off, and it stands on its formation target, not run-limited): the
 * blend and the run only exist so auto players never teleport or fly, and a learner must not be
 * judged against an auto player still half-way through a recovery run, a press or a shift after a
 * long pass. The states themselves are the blended playback's (so who presses is decided from where
 * the players really are, as in the frame). If that playback would put the learner's role on the
 * ball, the role's own spot is used instead (authors choose the carriers). Other players in the
 * frame keep their blended positions.
 * @param {object} scenario
 * @param {number} t
 * @param {{ formations: {us:object, them?:object}, learnerId?: string, params?: object }} opts
 * @returns {{x:number, y:number}}
 */
export function learnerBaseAt(scenario, t, opts = {}) {
  const id = opts.learnerId ?? (scenario.learner?.role ? playerId('us', scenario.learner.role) : null);
  if (!id) throw new TypeError('learnerBaseAt: no learner (scenario.learner.role or opts.learnerId)');
  const { learnerSpot: _spot, ...rest } = opts;
  const free = play(scenario, t, { ...rest, learnerId: null }, true).f;
  let me = free.players.find((p) => p.id === id);
  if (free.carrierId === id) me = play(scenario, t, { ...rest, learnerId: id }, true).f.players.find((p) => p.id === id);
  return { x: me.x, y: me.y };
}

/** Override positions at t (linear between keys), with the learner pinned to learnerSpot if given. */
export function overridesAt(tl, t, learnerId, learnerSpot) {
  const out = {};
  for (const o of tl.players?.overrides ?? []) {
    const p = interpKeys(o.keys, t);
    if (p) out[o.id] = p;
  }
  if (learnerSpot && learnerId) out[learnerId] = { x: learnerSpot.x, y: learnerSpot.y };
  return out;
}

/** Cumulative tags at t, plus scenario.phase and the derived ballMovingBack, nextEvent and nextEventIn when not authored. */
export function tagsAt(scenario, t, possession, P) {
  const src = scenario.timeline?.tags;
  const keys = Array.isArray(src) ? src : src && typeof src === 'object' ? [{ ...src, t: -Infinity }] : [];
  const tags = {};
  for (const k of keys) {
    if (!(k.t <= t)) continue;
    const { t: _t, ...rest } = k;
    Object.assign(tags, rest);
  }
  if (tags.phase === undefined && scenario.phase) tags.phase = scenario.phase;
  if (tags.ballMovingBack === undefined && (possession === 'us' || possession === 'them')) {
    const dx = ballAt(scenario, t).x - ballAt(scenario, t - P.ballBackWindow).x;
    if ((possession === 'us' ? -dx : dx) >= P.ballBackDist) tags.ballMovingBack = true;
  }
  if (tags.nextEvent === undefined && P.eventAhead > 0 && (possession === 'us' || possession === 'them')) {
    const next = nextEventAfter(scenario, t, possession, P.eventAhead);
    if (next) { tags.nextEvent = next.event; tags.nextEventIn = Math.round((next.t - t) * 1000) / 1000; }
  }
  return tags;
}

/**
 * The first ball or tag event (not a carry) strictly after t and within `ahead` seconds, played while
 * `possession` still has the ball (a turnover first means the event is the other team's). A ball-key
 * 'pass' or 'cross' is the moment the ball is struck, so a drill frozen just before it is judged as the
 * pass is played (the offside rule reads it: F4).
 * @returns {{t:number, event:string}|null}
 */
export function nextEventAfter(scenario, t, possession, ahead = TIMELINE_DEFAULTS.eventAhead) {
  for (const e of ballEvents(scenario)) {
    if (!(e.t > t) || e.event === 'carry') continue;
    if (e.t - t > ahead + 1e-9) return null;
    return possessionAt(scenario, e.t - 1e-6) === possession ? e : null;
  }
  return null;
}
