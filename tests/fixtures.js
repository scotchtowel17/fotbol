// Hand-placed 22-player scenes for unit tests (canonical frame: we attack +x,
// y = 0 is our left touchline; "them" attack -x and their LEFT side is our large y).
// Tests may add their own scenes; keep these stable because many tests share them.

import { ROLES, playerId } from '../js/engine/roles.js';

/** Out of possession, mid-block. Their left #8 carries the ball in midfield on OUR right side. */
const OOP_MID_BLOCK = {
  ball: { x: 58, y: 44 },
  possession: 'them',
  carrierId: 'them-LCM',
  tags: { carrierFacing: 'forward' },
  us: {
    GK: { x: 6, y: 34 }, LB: { x: 29, y: 17 }, LCB: { x: 28, y: 29 }, RCB: { x: 28, y: 40 }, RB: { x: 30, y: 52 },
    DM: { x: 36, y: 38 }, LCM: { x: 44, y: 30 }, RCM: { x: 48, y: 44 },
    LW: { x: 52, y: 20 }, ST: { x: 58, y: 33 }, RW: { x: 54, y: 55 },
  },
  them: {
    GK: { x: 98, y: 34 }, LB: { x: 64, y: 60 }, LCB: { x: 74, y: 44 }, RCB: { x: 74, y: 24 }, RB: { x: 64, y: 8 },
    DM: { x: 66, y: 34 }, LCM: { x: 58.5, y: 44.5 }, RCM: { x: 54, y: 24 },
    LW: { x: 40, y: 58 }, ST: { x: 36, y: 38 }, RW: { x: 40, y: 12 },
  },
};

/** In possession, build-up. Our left centre-back has the ball; they sit in a mid-block. */
const IP_BUILD_UP = {
  ball: { x: 22, y: 26 },
  possession: 'us',
  carrierId: 'us-LCB',
  tags: { carrierFacing: 'forward' },
  us: {
    GK: { x: 5, y: 34 }, LCB: { x: 22, y: 26 }, RCB: { x: 20, y: 44 }, LB: { x: 32, y: 5 }, RB: { x: 34, y: 63 },
    DM: { x: 32, y: 32 }, LCM: { x: 46, y: 22 }, RCM: { x: 47, y: 44 },
    LW: { x: 62, y: 4 }, ST: { x: 68, y: 34 }, RW: { x: 62, y: 64 },
  },
  them: {
    GK: { x: 100, y: 34 }, LB: { x: 73, y: 52 }, LCB: { x: 72, y: 40 }, RCB: { x: 72, y: 28 }, RB: { x: 73, y: 16 },
    DM: { x: 62, y: 34 }, LCM: { x: 54, y: 42 }, RCM: { x: 54, y: 26 },
    LW: { x: 45, y: 50 }, ST: { x: 34, y: 30 }, RW: { x: 44, y: 16 },
  },
};

export const SCENES = Object.freeze({ oopMidBlock: OOP_MID_BLOCK, ipBuildUp: IP_BUILD_UP });

/**
 * Build a Frame from a scene name or scene object.
 * @param {string|object} scene
 * @param {{ move?: Object<string,{x:number,y:number}>, ball?: {x:number,y:number}, possession?: string, carrierId?: string|null, tags?: object }} [changes]
 *   `move` repositions players by id ('us-LCB').
 */
export function makeFrame(scene, changes = {}) {
  const s = typeof scene === 'string' ? SCENES[scene] : scene;
  const players = [];
  for (const team of ['us', 'them']) {
    for (const role of ROLES) {
      const id = playerId(team, role);
      const p = changes.move?.[id] ?? s[team][role];
      players.push({ id, team, role, x: p.x, y: p.y });
    }
  }
  return {
    t: 0,
    ball: { ...(changes.ball ?? s.ball) },
    possession: changes.possession ?? s.possession,
    carrierId: changes.carrierId !== undefined ? changes.carrierId : s.carrierId,
    players,
    tags: { ...s.tags, ...(changes.tags ?? {}) },
  };
}

/** Position of a player id in a scene (handy as a layer-A base stand-in). */
export function posOf(scene, id) {
  const s = typeof scene === 'string' ? SCENES[scene] : scene;
  const [team, role] = [id.slice(0, id.indexOf('-')), id.slice(id.indexOf('-') + 1)];
  return { ...s[team][role] };
}
