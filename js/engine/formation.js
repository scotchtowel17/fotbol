// STUB (linear fallback only): the formation agent replaces this with Delaunay
// interpolation over data/formations/helios-433.json, keeping the same API.
// Contract: docs/ARCHITECTURE.md §5.1.

import { clamp } from './geometry.js';
import { LENGTH, WIDTH, HALF_X, MID_Y, clampToPitch, mirrorPoint } from './pitch.js';
import { ROLES, ROLE_INFO } from './roles.js';

export const POSSESSION_OFFSET = Object.freeze({ with: 6, without: -4 }); // [D] metres along attacking direction

// [M] regression on the HELIOS samples (RESEARCH 5.2). Intercepts are centre-origin; i_y is negated for left roles.
const LINEAR = {
  CB: { kx: 0.48, ky: 0.32, ix: -18.4, iy: 5.6 },
  FB: { kx: 0.56, ky: 0.31, ix: -15.4, iy: 15.8 },
  DM: { kx: 0.70, ky: 0.47, ix: -7.6, iy: 0 },
  CM: { kx: 0.80, ky: 0.40, ix: -1.0, iy: 10 },
  W: { kx: 0.72, ky: 0.25, ix: 10.7, iy: 21.2 },
  ST: { kx: 0.71, ky: 0.43, ix: 10.5, iy: 0 },
};

/** Linear fallback target for a role (own frame, team attacks +x). */
export function linearTarget(role, ball) {
  const { family, side } = ROLE_INFO[role];
  if (family === 'GK') return { x: clamp(4 + 0.12 * ball.x, 3, 20), y: MID_Y + 0.12 * (ball.y - MID_Y) };
  const c = LINEAR[family];
  const iy = side === 'L' ? -c.iy : side === 'R' ? c.iy : 0;
  return clampToPitch({ x: HALF_X + c.ix + c.kx * (ball.x - HALF_X), y: MID_Y + iy + c.ky * (ball.y - MID_Y) });
}

export function createFormation(table = { id: 'linear', name: 'Linear fallback', roles: ROLES, samples: [] }) {
  return {
    id: table.id,
    name: table.name,
    roles: table.roles ?? ROLES,
    samples: table.samples ?? [],
    triangles: new Uint32Array(0),
    positions(ball) {
      const b = { x: clamp(ball.x, 0, LENGTH), y: clamp(ball.y, 0, WIDTH) };
      return Object.fromEntries(ROLES.map((r) => [r, linearTarget(r, b)]));
    },
  };
}

export function teamTargets(formation, team, ball, { inPossession = false, offset = true } = {}) {
  const ownBall = team === 'us' ? ball : mirrorPoint(ball);
  const own = formation.positions(ownBall);
  const dx = offset ? (inPossession ? POSSESSION_OFFSET.with : POSSESSION_OFFSET.without) : 0;
  const out = {};
  for (const [role, p] of Object.entries(own)) {
    const q = role === 'GK' ? p : clampToPitch({ x: p.x + dx, y: p.y });
    out[role] = team === 'us' ? q : mirrorPoint(q);
  }
  return out;
}
