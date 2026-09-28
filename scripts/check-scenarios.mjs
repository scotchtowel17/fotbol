#!/usr/bin/env node
// Validate every scenario and print the engine's answer at the freeze frame (npm run check).
//
//   node scripts/check-scenarios.mjs [file-or-id ...] [--ascii]
//
// For each data/scenarios/*.json (index.json excluded): validateScenario() against the principle
// catalogue, then the freeze frame (frameAt), the learner's base (learnerBaseAt), the ghost and its
// score, and warnings when the engine and the author disagree: the ghost more than
// CHECK_DEFAULTS.disagreeDistance from answer.ideal (RESEARCH 5.7 "key disagreement"), or inside a
// misconception region. Exits 1 if any scenario is invalid; disagreements are warnings only.

import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createFormation } from '../js/engine/formation.js';
import { validateScenario, normalizeScenario, learnerId as learnerIdOf } from '../js/engine/scenario.js';
import { frameAt, learnerBaseAt } from '../js/engine/timeline.js';
import { buildContext } from '../js/engine/context.js';
import { computeGhost } from '../js/engine/ghost.js';
import { evaluate, toleranceFor } from '../js/engine/score.js';
import { dist } from '../js/engine/geometry.js';
import { renderAscii } from './lib/ascii.mjs';

export const CHECK_DEFAULTS = Object.freeze({
  disagreeDistance: 5, // [S] RESEARCH 5.7: engine ghost more than this from the authored ideal = key disagreement
});

const root = new URL('../', import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));

const inRegion = (p, r) => {
  if (r.type === 'circle') return dist(p, r) <= r.r;
  if (r.type === 'rect') return p.x >= Math.min(r.x0, r.x1) && p.x <= Math.max(r.x0, r.x1) && p.y >= Math.min(r.y0, r.y1) && p.y <= Math.max(r.y0, r.y1);
  if (r.type === 'polygon') { // even-odd rule
    let inside = false;
    const pts = r.points ?? [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  return false;
};

/**
 * Validate one scenario and compute the engine's answer at its freeze frame.
 * @param {object} raw  scenario JSON as authored (optional fields may be missing)
 * @param {{ principles: object, formations: {us: object, them?: object} }} opts
 * @returns {{ errors: string[] } | { errors: [], scenario: object, t: number, frame: object, base: object, ctx: object,
 *   ghost: object, ideal: { spot: object, score: number, distance: number, disagree: boolean } | null, misconceptions: string[] }}
 *   scenario is the normalised copy; t its freezeAt (the duration when not authored); misconceptions the ids whose region holds the ghost
 */
export function checkScenario(raw, { principles, formations }) {
  const errors = validateScenario(raw, { principles });
  if (errors.length) return { errors };
  // Optional fields filled in: freezeAt defaults to the duration, an answer.override becomes ideal + tol.
  const s = normalizeScenario(raw);
  const t = s.timeline.freezeAt;
  const learnerId = learnerIdOf(s);
  const frame = frameAt(s, t, { formations });
  const base = learnerBaseAt(s, t, { formations });
  const ctx = buildContext(frame, { learnerId, base });
  const tol = toleranceFor(s.learner.role, s.answer.tol);
  const authored = s.answer.mode === 'authored';
  const centre = authored ? s.answer.ideal : base;
  const ghost = computeGhost(ctx, { base: centre, tol });
  let ideal = null;
  if (s.answer.ideal) {
    const distance = dist(ghost.spot, s.answer.ideal);
    ideal = { spot: s.answer.ideal, score: evaluate(ctx, s.answer.ideal, { center: centre, tol }).score, distance, disagree: !authored && distance > CHECK_DEFAULTS.disagreeDistance };
  }
  const misconceptions = s.misconceptions.filter((m) => inRegion(ghost.spot, m.region)).map((m) => m.id);
  return { errors: [], scenario: s, t, frame, base, ctx, ghost, ideal, misconceptions };
}

async function main() {
  const args = process.argv.slice(2);
  const ascii = args.includes('--ascii');
  const only = args.filter((a) => !a.startsWith('--')).map((a) => a.replace(/^.*\//, '').replace(/\.json$/, ''));
  const principles = await read('data/principles.json');
  const F = createFormation(await read('data/formations/helios-433.json'));
  const formations = { us: F, them: F };
  const files = (await readdir(new URL('data/scenarios/', root))).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  const pt = (p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;

  let invalid = 0, warnings = 0, checked = 0;
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    let raw;
    try { raw = await read(`data/scenarios/${file}`); } catch (err) { console.log(`✗ ${file}: not valid JSON (${err.message})`); invalid++; continue; }
    if (only.length && !only.includes(id) && !only.includes(raw.id)) continue;
    checked++;
    const r = checkScenario(raw, { principles, formations });
    if (r.errors.length) {
      invalid++;
      console.log(`✗ ${file} [${raw.id}]`);
      for (const e of r.errors) console.log(`    - ${e}`);
      continue;
    }
    const { scenario: s, t, ctx, base, ghost, ideal, frame } = r;
    console.log(`✓ ${file} [${s.id}] ${s.learner.role} at t = ${t} s: ${ctx.duty}; base ${pt(base)}; ghost ${pt(ghost.spot)} scores ${ghost.score}`);
    const top = [...ghost.result.rules].sort((a, b) => b.weight - a.weight).slice(0, 4).map((q) => `${q.id} ${q.s.toFixed(2)} x ${q.weight}`);
    console.log(`    rules at the ghost: ${top.join(', ') || '(none apply)'}`);
    if (ideal) {
      const line = `    authored ideal ${pt(ideal.spot)} scores ${ideal.score}; ghost is ${ideal.distance.toFixed(1)} m from it`;
      if (ideal.disagree) { warnings++; console.log(`${line}  ⚠ key disagreement (> ${CHECK_DEFAULTS.disagreeDistance} m): coach review`); } else console.log(line);
    }
    for (const m of r.misconceptions) { warnings++; console.log(`    ⚠ the ghost is inside misconception region "${m}"`); }
    if (ascii) {
      const learnerId = ctx.learner.id;
      console.log(renderAscii({ ...frame, players: frame.players.filter((p) => p.id !== learnerId) }, { marks: [{ ...ghost.spot, ch: '*', label: 'ghost' }, { ...base, ch: '+', label: 'base' }] }));
    }
  }

  console.log(`\n${checked} scenario(s) checked: ${invalid} invalid, ${warnings} warning(s).`);
  process.exitCode = invalid ? 1 : 0;
}

// Run as a script (npm run check); importing the module (tests) only defines checkScenario().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
