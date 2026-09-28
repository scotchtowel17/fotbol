#!/usr/bin/env node
// Print both teams' layer-A targets (teamTargets) for a ball position and possession.
//
//   node scripts/shape.mjs <ballX> <ballY> <us|them|none> [formation.json]
//   node scripts/shape.mjs 70 20 us
//
// Canonical frame: us attack +x (left to right), y = 0 is our left touchline (top row).
// Possession 'none' (loose ball): no possession offset, out-of-possession phase shape for both (as autoFrame).
// Also prints a few shape measurements to sanity-check against RESEARCH 5.2
// (outfield length median 31 m, width median 46 m, #6 about 7 m ahead of the back line).

import { readFile } from 'node:fs/promises';
import { createFormation, teamTargets } from '../js/engine/formation.js';
import { ROLES, BACK_LINE, playerId } from '../js/engine/roles.js';
import { LENGTH, mirrorPoint } from '../js/engine/pitch.js';
import { median } from '../js/engine/geometry.js';
import { renderAscii } from './lib/ascii.mjs';

const [bx, by, poss = 'none', file = new URL('../data/formations/helios-433.json', import.meta.url)] = process.argv.slice(2);
const ball = { x: Number(bx), y: Number(by) };
if (!Number.isFinite(ball.x) || !Number.isFinite(ball.y) || !['us', 'them', 'none'].includes(poss)) {
  console.error('usage: node scripts/shape.mjs <ballX 0..105> <ballY 0..68> <us|them|none> [formation.json]');
  process.exit(2);
}

const formation = createFormation(JSON.parse(await readFile(file, 'utf8')));
// As autoFrame() places them: a loose ball has no possession offset but both teams take their out-of-possession shape.
const opts = (team) => (poss === 'none' ? { offset: false, shape: true } : { inPossession: poss === team });
const targets = { us: teamTargets(formation, 'us', ball, opts('us')), them: teamTargets(formation, 'them', ball, opts('them')) };
const players = ['us', 'them'].flatMap((team) => ROLES.map((role) => ({ id: playerId(team, role), team, role, ...targets[team][role] })));
const frame = { t: 0, ball, possession: poss, carrierId: null, players, tags: {} };

/** Shape numbers in the team's own frame (attacking +x). */
function shape(team) {
  const own = (p) => (team === 'us' ? p : mirrorPoint(p));
  const t = Object.fromEntries(ROLES.map((r) => [r, own(targets[team][r])]));
  const out = ROLES.filter((r) => r !== 'GK').map((r) => t[r]);
  const xs = out.map((p) => p.x), ys = out.map((p) => p.y);
  const backX = median(BACK_LINE.map((r) => t[r].x));
  return {
    length: Math.max(...xs) - Math.min(...xs),
    width: Math.max(...ys) - Math.min(...ys),
    backX,
    dmAhead: t.DM.x - backX,
    backSpread: Math.max(...BACK_LINE.map((r) => t[r].x)) - Math.min(...BACK_LINE.map((r) => t[r].x)),
  };
}

const offsetNote = poss === 'none' ? 'loose ball: no possession offset, both teams in their out-of-possession shape' : `${poss} in possession`;
console.log(`${formation.name}: ball (${ball.x}, ${ball.y}), ${offsetNote}`);
console.log(renderAscii(frame));
console.log('\nshape (own frame, outfield)   length  width  back-line x  #6 ahead  back-line depth spread');
for (const team of ['us', 'them']) {
  const s = shape(team);
  const f = (v) => v.toFixed(1).padStart(6);
  console.log(`${team.padEnd(30)}${f(s.length)} ${f(s.width)}  ${f(s.backX)}     ${f(s.dmAhead)}    ${f(s.backSpread)}`);
}
console.log(`(own frame: 'them' is mirrored so its back-line x is also measured from its own goal, 0..${LENGTH})`);
