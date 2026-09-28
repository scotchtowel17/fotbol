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
// recoverSpeed.

import { lerp, clamp } from './geometry.js';
import { MID_Y, HALF_X } from './pitch.js';
import { playerId } from './roles.js';
import { autoFrame, autoRoles } from './scene.js';

export const TIMELINE_DEFAULTS = Object.freeze({
  reactionLag: 0.3, // [D] s: auto players react to where the ball was this long ago
  shapeWindow: 1.0, // [D] s: ...averaged over this window, so a pass shifts the shape gradually rather than at ball speed
  possessionBlend: 1.0, // [D] s: minimum time for the shape change after a turnover
  carrierBlend: 0.5, // [D] s: minimum time for passer, receiver and presser to re-position after a carrier or presser change
  pressCommit: 0.5, // [D] at a key time the automatic presser is committed to (pressing fully until the next key) if its range weight is at least this
  recoverSpeed: 6, // [D] m/s: blends last long enough that closing a gap never needs more than this
  maxBlend: 4, // [D] s: ...but never longer than this
  eventGrace: 0.7, // [S] s: live mode ignores this long after each ball event (0.7 s reaction time, RESEARCH 5.7/5.8)
  sampleHz: 10, // [D] live-mode scoring rate (RESEARCH 5.7)
  ballBackWindow: 1.0, // [D] s: look-back window for deriving tags.ballMovingBack
  ballBackDist: 3, // [D] m: ball travel towards the possessing team's own goal that counts as "moving back"
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
 *   [t - reactionLag - shapeWindow, t - reactionLag]; the carrier, press spot and onside line use
 *   the ball at t. `players.auto: false` freezes the shape at its t = 0 position.
 * - Overrides (linear between keys) win over everything. The explicit carrier is placed at the ball.
 *   Automatic carriers (before the first carrier key) and pressers are decided at t = 0 and at every
 *   ball, possession and carrier key, and kept until the next one.
 * - frame.tags: the tag keys so far, merged; `phase` defaults to scenario.phase; `ballMovingBack`
 *   is derived from the last ballBackWindow seconds of ball movement unless a tag sets it.
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
  const tl = scenario.timeline ?? {};
  const P = { ...TIMELINE_DEFAULTS, ...scenario.params, ...opts.params };
  // learnerId: null = nobody is held back as the learner (every player auto-placed).
  const learnerId = opts.learnerId === null ? undefined : opts.learnerId ?? (scenario.learner?.role ? playerId('us', scenario.learner.role) : undefined);

  // Scene inputs at time `at` (everything but the discrete state).
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
  const segs = stateSegments(scenario, t, sceneAt, P);
  const k = segs.length - 1;

  // How state j places the players at time `at`.
  const raw = (j, at) => {
    const s = segs[j];
    return autoFrame({ ...sceneAt(at), possession: s.possession, carrierId: s.carrierId, autoCarrier: false, inFlight: s.inFlight, presserId: s.presserId });
  };
  // Blending: at a state change each player is offset from where the new state wants them by
  // (where they were) - (new target); that offset shrinks linearly to zero over
  // clamp(|offset| / recoverSpeed, blend, maxBlend) seconds.
  const place = (j, at) => {
    const f = raw(j, at);
    if (j === 0) return f;
    const seg = segs[j], dt = at - seg.t;
    const blend = seg.possession !== segs[j - 1].possession ? P.possessionBlend : P.carrierBlend;
    const longest = Math.max(blend, P.maxBlend);
    if (dt >= longest) return f;
    const was = place(j - 1, seg.t).players, wants = raw(j, seg.t).players;
    f.players = f.players.map((p, i) => {
      const ox = was[i].x - wants[i].x, oy = was[i].y - wants[i].y;
      const T = clamp(Math.hypot(ox, oy) / P.recoverSpeed, blend, longest);
      const left = T > 0 ? 1 - dt / T : 0;
      return left > 0 ? { ...p, x: p.x + left * ox, y: p.y + left * oy } : p;
    });
    return f;
  };

  const f = place(k, t);
  return { t, ball: ballAt(scenario, t), possession: segs[k].possession, carrierId: f.carrierId, players: f.players, tags: tagsAt(scenario, t, segs[k].possession, P) };
}

/**
 * The learner's base at time t: the zone centre and the spot duties are computed at when a drill
 * freezes there (docs/ARCHITECTURE.md §5.3; the playback twin of scene.js learnerBase()). It is the
 * learner role's spot in the same playback with nobody held back as the learner: its formation
 * spot, or its press spot when the playback commits it to press. If that playback would put the
 * learner's role on the ball, the role's own spot is used instead (authors choose the carriers).
 * @param {object} scenario
 * @param {number} t
 * @param {{ formations: {us:object, them?:object}, learnerId?: string, params?: object }} opts
 * @returns {{x:number, y:number}}
 */
export function learnerBaseAt(scenario, t, opts = {}) {
  const id = opts.learnerId ?? (scenario.learner?.role ? playerId('us', scenario.learner.role) : null);
  if (!id) throw new TypeError('learnerBaseAt: no learner (scenario.learner.role or opts.learnerId)');
  const { learnerSpot: _spot, ...rest } = opts;
  const free = frameAt(scenario, t, { ...rest, learnerId: null });
  let me = free.players.find((p) => p.id === id);
  if (free.carrierId === id) me = frameAt(scenario, t, { ...rest, learnerId: id }).players.find((p) => p.id === id);
  return { x: me.x, y: me.y };
}

/** Override positions at t (linear between keys), with the learner pinned to learnerSpot if given. */
function overridesAt(tl, t, learnerId, learnerSpot) {
  const out = {};
  for (const o of tl.players?.overrides ?? []) {
    const p = interpKeys(o.keys, t);
    if (p) out[o.id] = p;
  }
  if (learnerSpot && learnerId) out[learnerId] = { x: learnerSpot.x, y: learnerSpot.y };
  return out;
}

/**
 * Discrete playback states up to tMax, in time order: possession, carrier (explicit, or the automatic
 * one), in-flight flag and presser, decided at t = 0 and at every ball, possession or carrier key.
 * Consecutive identical states are merged; the first holds from the start of playback.
 */
function stateSegments(scenario, tMax, sceneAt, P) {
  const tl = scenario.timeline ?? {};
  const decide = (t) => {
    const possession = possessionAt(scenario, t), carrier = carrierAt(scenario, t), inFlight = carrier === null;
    // Hard switch: the lead-based handover only exists to keep a static scene smooth under a dragged ball.
    const roles = autoRoles({ ...sceneAt(t), possession, carrierId: carrier ?? null, inFlight, params: { ...P, pressHandover: 0 } });
    const presserId = roles.presser && roles.presser.w >= P.pressCommit ? roles.presser.id : null;
    return { t, possession, inFlight, carrierId: roles.carrierId, presserId };
  };
  const times = [...new Set([...(tl.ball ?? []), ...(tl.possession ?? []), ...(tl.carrier ?? [])].map((k) => k.t))]
    .filter((t) => t > 0 && t <= tMax)
    .sort((a, b) => a - b);
  const segs = [{ ...decide(0), t: -Infinity }];
  for (const t of times) {
    const s = decide(t), prev = segs[segs.length - 1];
    if (s.possession !== prev.possession || s.carrierId !== prev.carrierId || s.inFlight !== prev.inFlight || s.presserId !== prev.presserId) segs.push(s);
  }
  return segs;
}

/** Cumulative tags at t, plus scenario.phase and a derived ballMovingBack when not authored. */
function tagsAt(scenario, t, possession, P) {
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
  return tags;
}
