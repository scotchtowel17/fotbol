#!/usr/bin/env node
// Coach-facing sanity report: does the engine's answer make tactical sense?
//
//   node scripts/sanity.mjs [situation-id ...] [--kid] > docs/sanity-output.txt
//
// For every canonical situation (tests/situations.js) it draws the 22 auto-placed players, then
// for every learnable role prints: the base (the role's usual spot for this ball), the ghost (the
// engine's best spot within 15 m), the ghost's score and the learner's duty, the three rules that
// weigh most at the ghost, and the feedback for a deliberately bad spot 8 m from the ghost (the
// worst of 16 directions). Canonical frame: we attack left to right, y = 0 is our left touchline.

import { readFile } from 'node:fs/promises';
import { createFormation } from '../js/engine/formation.js';
import { autoFrame } from '../js/engine/scene.js';
import { analyseScene, judgeSpot } from '../js/engine/analyse.js';
import { evaluate } from '../js/engine/score.js';
import { phraseMove } from '../js/engine/explain.js';
import { nameOf } from '../js/engine/rules/_util.js';
import { LEARNABLE_ROLES, ROLE_INFO, playerId } from '../js/engine/roles.js';
import { onPitch } from '../js/engine/pitch.js';
import { SITUATIONS, sceneOptions } from '../tests/situations.js';
import { renderAscii } from './lib/ascii.mjs';

export const SANITY_DEFAULTS = Object.freeze({
  badDistance: 8, // [D] metres from the ghost for the deliberately bad spot
  badDirections: 16, // [D] directions tried; the lowest-scoring on-pitch spot is shown
  topRules: 3, // [D] rules listed per role (largest weight first)
});

const args = process.argv.slice(2);
const wording = args.includes('--kid') ? 'kid' : 'standard';
const only = args.filter((a) => !a.startsWith('--'));
const read = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8'));

const table = await read('data/formations/helios-433.json');
const principles = Object.fromEntries((await read('data/principles.json')).principles.map((p) => [p.id, p]));
const F = createFormation(table);
const formations = { us: F, them: F };

const f1 = (v) => v.toFixed(1);
const pt = (p) => `(${f1(p.x).padStart(5)}, ${f1(p.y).padStart(4)})`;
const POSSESSION = { us: 'we have the ball', them: 'they have the ball', none: 'loose ball' };

function badSpot(scene) {
  const { badDistance: r, badDirections: n } = SANITY_DEFAULTS;
  let worst = null;
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    const p = { x: scene.ghost.spot.x + r * Math.cos(a), y: scene.ghost.spot.y + r * Math.sin(a) };
    if (!onPitch(p)) continue;
    const e = evaluate(scene.ctx, p);
    if (!worst || e.raw < worst.raw) worst = { ...e, spot: p };
  }
  return worst;
}

const out = [];
const say = (s = '') => out.push(s);

say('fotbol engine sanity report');
say(`Formation: ${F.name}. Wording: ${wording}. Scores are 0-100 (S >= 90, A >= 80, B >= 70, C >= 60, D >= 50, F < 50).`);
say('Frame: we attack left to right (x = 0 is our goal line), y = 0 is our left touchline (top row).');
say('Base = where the role usually stands for this ball; ghost = the engine\'s best spot within 15 m of it.');
say('Rules at the ghost: id s x weight (s = 1 is fully satisfied).');
say('Regenerate with: node scripts/sanity.mjs > docs/sanity-output.txt');

for (const situation of SITUATIONS) {
  if (only.length && !only.includes(situation.id)) continue;
  // The picture: everybody auto-placed, nobody held back as the learner.
  const { learnerId: _none, ...opts0 } = sceneOptions(situation, null, formations);
  const frame = autoFrame(opts0);
  const carrier = frame.players.find((p) => p.id === frame.carrierId);
  say();
  say('='.repeat(79));
  say(`${situation.title} [${situation.id}]`);
  say(situation.note);
  say(`Ball ${pt(situation.ball)}, ${POSSESSION[situation.possession]}${carrier ? `, on the ball: ${nameOf(carrier).replace(/^your /, 'our ')}` : ''}.`);
  say('='.repeat(79));
  say(renderAscii(frame, { legend: false }));

  for (const role of LEARNABLE_ROLES) {
    const id = playerId('us', role);
    const scene = analyseScene(sceneOptions(situation, id, formations));
    const { ctx, ghost, base } = scene;
    const g = ghost.result;
    const move = phraseMove(base, ghost.spot) || 'stay put';
    say();
    say(`${ROLE_INFO[role].label} [${role}]  duty: ${ctx.duty}  block: ${ctx.blockHeight}${ctx.markTarget ? `  marks: ${nameOf(ctx.markTarget, ctx)}` : ''}`);
    say(`  base  ${pt(base)}   ghost ${pt(ghost.spot)}  score ${ghost.score} (${g.grade})   base -> ghost: ${move}`);
    const top = [...g.rules].sort((a, b) => b.weight - a.weight || a.s - b.s).slice(0, SANITY_DEFAULTS.topRules);
    say(`  rules at the ghost: ${top.length ? top.map((r) => `${r.id} ${r.s.toFixed(2)} x ${r.weight}`).join(', ') : '(none apply)'}`);
    const bad = badSpot(scene);
    if (!bad) continue;
    const { feedback } = judgeSpot(scene, bad.spot, { wording, principles });
    say(`  8 m off at ${pt(bad.spot)}: ${feedback.score} (${feedback.grade}) ${feedback.headline}`);
    for (const r of feedback.reasons) say(`    - [${r.principleId} ${r.name}] ${r.text}${r.critical ? ' (critical)' : ''}`);
    if (feedback.fix) say(`    Fix: ${feedback.fix.text}`);
    if (feedback.cue) say(`    Cue: ${feedback.cue.text}`);
  }
}

process.stdout.write(`${out.join('\n')}\n`);
