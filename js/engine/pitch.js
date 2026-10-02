// IFAB pitch constants and the canonical coordinate frame.
//
// CANONICAL FRAME (used by every module, data file and scenario):
//   - metres on a 105 x 68 pitch
//   - x = 0 is OUR goal line, x = 105 the opponent's; "us" (the learner's team) always attacks +x
//   - y = 0 is the top touchline = OUR team's LEFT side; y = 68 is our right side
//   - "goal-side" = smaller x; "inside" = closer to y = 34
// Rendering may rotate this frame (vertical pitch on phones); the engine never does.

import { clamp } from './geometry.js';

export const LENGTH = 105;
export const WIDTH = 68;
export const HALF_X = LENGTH / 2; // 52.5
export const MID_Y = WIDTH / 2; // 34

export const GOAL_WIDTH = 7.32;
export const GOAL_DEPTH = 2; // drawn net depth behind the line
export const PENALTY_AREA = { depth: 16.5, width: 40.32 }; // y 13.84..54.16
export const GOAL_AREA = { depth: 5.5, width: 18.32 }; // y 24.84..43.16
export const PENALTY_SPOT_DIST = 11;
export const CIRCLE_RADIUS = 9.15; // centre circle and penalty arc
export const CORNER_RADIUS = 1;

export const OWN_GOAL = Object.freeze({ x: 0, y: MID_Y });
export const OPP_GOAL = Object.freeze({ x: LENGTH, y: MID_Y });
export const POSTS = Object.freeze({ top: MID_Y - GOAL_WIDTH / 2, bottom: MID_Y + GOAL_WIDTH / 2 }); // 30.34, 37.66

/** Vertical lane edges (y), from our left touchline to our right. */
export const LANE_EDGES = Object.freeze([0, 13.84, 24.84, 43.16, 54.16, 68]);
export const LANE_NAMES = Object.freeze(['left wing', 'left half-space', 'centre', 'right half-space', 'right wing']);
/** Thirds along x from our goal: defensive < 35, middle 35..70, final > 70. */
export const THIRD_EDGES = Object.freeze([0, 35, 70, 105]);
export const THIRD_NAMES = Object.freeze(['defensive third', 'middle third', 'final third']);
/** Zone 14: central area just outside the opponent's box. */
export const ZONE_14 = Object.freeze({ x0: 75, x1: 88.5, y0: 24.84, y1: 43.16 });

/** Lane index 0..4 for a y coordinate. */
export function laneOf(y) {
  for (let i = 1; i < LANE_EDGES.length; i++) if (y < LANE_EDGES[i]) return i - 1;
  return LANE_EDGES.length - 2;
}

/** Third index 0..2 (from our goal) for an x coordinate. */
export function thirdOf(x) {
  return x < THIRD_EDGES[1] ? 0 : x < THIRD_EDGES[2] ? 1 : 2;
}

export const isWingLane = (y) => { const l = laneOf(y); return l === 0 || l === 4; };

/** True if p is inside our own penalty area. */
export const inOwnBox = (p) => p.x <= PENALTY_AREA.depth && Math.abs(p.y - MID_Y) <= PENALTY_AREA.width / 2;

/** Clamp a point onto the pitch (optionally with an inner margin in metres). */
export function clampToPitch(p, margin = 0) {
  return { x: clamp(p.x, margin, LENGTH - margin), y: clamp(p.y, margin, WIDTH - margin) };
}

export const onPitch = (p, slack = 0) => p.x >= -slack && p.x <= LENGTH + slack && p.y >= -slack && p.y <= WIDTH + slack;

/** Point reflection through the centre spot (swaps attacking direction AND sides). */
export const mirrorPoint = (p) => ({ x: LENGTH - p.x, y: WIDTH - p.y });
/** Reflection across the long axis only (left/right swap, x kept). Used to make left/right variants of scenarios. */
export const flipY = (p) => ({ x: p.x, y: WIDTH - p.y });

