// Keeper's angle and depth (G1): out of possession, stand on the line that splits the angle between the ball and your
// two posts, as far off your line as the ball's distance says (formation.js keeperSpot: about 4 m with the ball 30 m
// out, 11 m with it at halfway, the top of the box with it in their box). More than angleTol off that line while a
// shot is possible (the ball within shotRange of goal) is a critical fail: one side of the goal is open.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §5.5, §8.8 (G1).

import { band } from '../geometry.js';
import { OWN_GOAL } from '../pitch.js';
import { keeperSpot } from '../formation.js';
import { perContext, paramsFor, notApplicable, defending, whole } from './_util.js';

export const GK_ANGLE_DEPTH_DEFAULTS = Object.freeze({
  weight: 3, // [D] the keeper's whole positional job
  angleTol: 1, // [S] RESEARCH 5.5 / G1: within 1 m of the bisector
  angleSoft: 2, // [D]
  depthTol: 1.5, // [D] within this of the depth along the bisector
  depthSoft: 3, // [D]
  shotRange: 30, // [D] a shot is possible with the ball this close to the middle of our goal: off the angle is critical then
});

const prep = perContext((ctx) => {
  if (!defending(ctx) || ctx.learner.family !== 'GK') return null;
  const D = paramsFor(ctx, 'gk-angle-depth', GK_ANGLE_DEPTH_DEFAULTS);
  const k = keeperSpot(ctx.ball);
  const shot = Math.hypot(ctx.ball.x - OWN_GOAL.x, ctx.ball.y - OWN_GOAL.y) <= D.shotRange;
  return { D, w: D.weight, ...k, shot };
});

export default {
  id: 'gk-angle-depth',
  principles: ['G1'],
  critical: true,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const { D, on, dir } = p;
    const vx = spot.x - on.x, vy = spot.y - on.y;
    const off = Math.abs(dir.x * vy - dir.y * vx); // metres off the bisector
    const along = dir.x * vx + dir.y * vy; // metres out along it
    const sAngle = band(off, 0, D.angleTol, D.angleSoft);
    const sDepth = band(along, p.depth - D.depthTol, p.depth + D.depthTol, D.depthSoft);
    const s = sAngle * sDepth;
    const issue = s >= 0.999 ? 'ok' : sAngle <= sDepth ? 'angle' : along < p.depth ? 'deep' : 'high';
    return {
      s,
      critical: p.shot && off > D.angleTol,
      target: s < 0.999 ? { ...p.spot } : undefined,
      vars: { issue, by: Math.max(1, whole(Math.abs(along - p.depth))), want: whole(p.depth), off },
    };
  },
  text: {
    standard: {
      name: 'Make the goal small',
      ok: () => 'You split the angle between the ball and your posts, at the right distance off your line.',
      fail: (v) => ({
        angle: 'Move onto the line that splits the angle between the ball and your two posts, so neither side of the goal is open.',
        deep: `Come off your line about ${v.by} m, to around ${v.want} m out, so you narrow the angle and can sweep a ball in behind.`,
        high: `Drop back about ${v.by} m toward your goal, so a shot or a lob cannot go over you.`,
      })[v.issue] ?? 'Split the angle between the ball and your posts.',
      cue: () => 'Where is the middle of the angle between the ball and your two posts?',
    },
    kid: {
      name: 'Make the Goal Small',
      ok: () => 'Good, you are in the middle of the ball and your posts.',
      fail: (v) => ({
        angle: 'Stand in the middle, between the ball and your two posts.',
        deep: 'Come off your line a few steps.',
        high: 'Go back a few steps toward your goal.',
      })[v.issue] ?? 'Stand in the middle, between the ball and your two posts.',
      cue: () => 'Where is the middle of your goal from the ball?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    return p ? { type: 'segment', a: { ...p.on }, b: { x: ctx.ball.x, y: ctx.ball.y } } : null;
  },
};
