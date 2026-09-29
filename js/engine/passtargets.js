// The passes a kid can pick in "Who's open?" (js/ui/player/pass.js), in one place: the staged game's gate
// (js/engine/cast.js) counts the same targets the screen offers, so both import these.
//
//   receiverOf(option)                         the teammate an option passes to ('us-LW@space' → 'us-LW')
//   optionsByReceiver(options, carrierId)      one option per teammate: a tap plays the better of feet and space
//   genuinelyOn(option)                        a pass that is really on: the best, or a good one that is not just too safe
//   passTargets(byReceiver, frame, carrierId)  the teammates a tap can pick: nobody further than farPass from the ball,
//                                              nor the keeper, unless that pass is really on
//
// PURE: no DOM, no clock, no randomness.

import { dist } from './geometry.js';

export const PASS_TARGET_DEFAULTS = Object.freeze({
  farPass: 45, // [S] play-test: a teammate further than this (m) from the ball is no target, unless the pass is really on
});

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
 * A pass that is really on: the best, or a good (safe) one that is not just the too-safe option when a better forward
 * pass was there (passing.js tags it 'too-safe').
 */
export const genuinelyOn = (o) => o?.label === 'best' || (o?.label === 'good' && !(o.tags ?? []).some((t) => t?.tag === 'too-safe'));

const posOf = (frame, id) => {
  const p = frame?.players?.find((q) => q.id === id);
  return p ? { x: p.x, y: p.y } : null;
};

/**
 * The teammates you may pass to (the targets, and the reveal's options): optionsByReceiver less anyone further than
 * farPass from the ball (the frame's ball, else the carrier) and the keeper, unless that pass is really on (genuinelyOn).
 * A crowded phone pitch keeps only the passes worth weighing.
 * @param {Map<string, object>} byReceiver  optionsByReceiver's map
 * @param {object} frame
 * @param {string|null} [carrierId]
 * @param {{ farPass: number }} [P]
 * @returns {Map<string, object>}
 */
export function passTargets(byReceiver, frame, carrierId = frame?.carrierId ?? null, P = PASS_TARGET_DEFAULTS) {
  const ball = frame?.ball ? { x: frame.ball.x, y: frame.ball.y } : posOf(frame, carrierId);
  const out = new Map();
  for (const [rid, o] of byReceiver ?? []) {
    const at = posOf(frame, rid);
    const far = !!(ball && at) && dist(ball, at) > P.farPass;
    if ((far || rid === 'us-GK') && !genuinelyOn(o)) continue;
    out.set(rid, o);
  }
  return out;
}
