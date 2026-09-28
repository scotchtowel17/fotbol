#!/usr/bin/env node
// Validate every scenario and print the engine's answer at the freeze frame (npm run check).
//
//   node scripts/check-scenarios.mjs [file-or-id ...] [--ascii]
//
// For each data/scenarios/*.json (index.json excluded): validateScenario() against the principle
// catalogue, then the freeze frame (frameAt), the learner's base (learnerBaseAt), the ghost and its
// score, and the drill-quality gates (CHECK_DEFAULTS), which fail the run:
//   - the ghost scores S (>= minGhostScore): a perfect answer must be able to get an S;
//   - the ghost is at least minMove from where the learner stands during playback (learner.start, or
//     their automatic spot at t = 0), unless answer.hold is true (a "hold your position" lesson,
//     documented in the scenario's notes): otherwise standing still passes;
//   - standing still at that start scores below maxStartScore (a B), unless answer.hold is true: an
//     answer far from the start is not enough if the start itself already earns an A;
//   - the ghost is outside every misconception region;
//   - engine mode: the ghost is within disagreeDistance of answer.ideal (RESEARCH 5.7 "key
//     disagreement": the engine moved an answer the coach keyed, so review it).
// In authored mode the engine's own best spot is printed for coach review (not a failure).
// Exits 1 if any scenario is invalid or fails a gate.
//
// checkScenario() is pure (Node and the browser): the file system is only touched in main().

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
  minGhostScore: 90, // [S] RESEARCH 9.5: the best spot must score S
  minMove: 5, // [D] metres: a drill whose answer is nearer than this to the start spot is trivial (standing still passes)
  maxStartScore: 70, // [D] standing still at the start must score below this (a B), or the drill teaches nothing
});

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

/** Where the learner stands during playback: learner.start, else their automatic spot at t = 0 (drill.js does the same). */
export function startSpot(s, { formations }) {
  if (s.learner?.start) return { x: s.learner.start.x, y: s.learner.start.y };
  const id = learnerIdOf(s);
  const me = frameAt(s, 0, { formations }).players.find((p) => p.id === id);
  return { x: me.x, y: me.y };
}

/**
 * Validate one scenario and compute the engine's answer at its freeze frame.
 * @param {object} raw  scenario JSON as authored (optional fields may be missing)
 * @param {{ principles: object, formations: {us: object, them?: object} }} opts
 * @returns {{ errors: string[] } | { errors: [], scenario: object, t: number, frame: object, base: object, ctx: object,
 *   ghost: object, engineGhost: object, start: object, moved: number, startScore: number,
 *   ideal: { spot: object, score: number, distance: number, disagree: boolean } | null, misconceptions: string[], problems: string[] }}
 *   scenario is the normalised copy; t its freezeAt (the duration when not authored); engineGhost the ghost searched round the
 *   base (= ghost in engine mode); start the learner's playback spot, moved the ghost's distance from it and startScore what
 *   standing still there scores (judged as the drill judges it); misconceptions the ids whose region holds the ghost; problems
 *   the failed drill-quality gates (empty = a good drill)
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
  const engineGhost = authored ? computeGhost(ctx, { base, tol }) : ghost;
  const C = CHECK_DEFAULTS;
  let ideal = null;
  if (s.answer.ideal) {
    const distance = dist(engineGhost.spot, s.answer.ideal);
    ideal = { spot: s.answer.ideal, score: evaluate(ctx, s.answer.ideal, { center: centre, tol }).score, distance, disagree: !authored && distance > C.disagreeDistance };
  }
  const misconceptions = s.misconceptions.filter((m) => inRegion(ghost.spot, m.region)).map((m) => m.id);
  const start = startSpot(s, { formations });
  const moved = dist(ghost.spot, start);
  const startScore = evaluate(ctx, start, { center: centre, tol }).score;
  const problems = [];
  if (ghost.score < C.minGhostScore) problems.push(`the best spot only scores ${ghost.score} (< ${C.minGhostScore}): a perfect answer cannot get an S`);
  if (moved < C.minMove && s.answer.hold !== true) problems.push(`the answer is only ${moved.toFixed(1)} m from the start spot (< ${C.minMove} m): standing still passes (set answer.hold for a "hold your position" lesson)`);
  if (startScore >= C.maxStartScore && s.answer.hold !== true) problems.push(`standing still at the start spot scores ${startScore} (>= ${C.maxStartScore}): the drill is passed without moving (start the learner somewhere worse, or set answer.hold for a "hold your position" lesson)`);
  for (const id of misconceptions) problems.push(`the best spot is inside misconception region "${id}"`);
  if (ideal?.disagree) problems.push(`key disagreement: the ghost is ${ideal.distance.toFixed(1)} m from answer.ideal (> ${C.disagreeDistance} m): coach review, then fix the engine or the ideal`);
  return { errors: [], scenario: s, t, frame, base, ctx, ghost, engineGhost, start, moved, startScore, ideal, misconceptions, problems };
}

async function main() {
  const { readFile, readdir } = await import('node:fs/promises');
  const root = new URL('../', import.meta.url);
  const read = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
  const args = process.argv.slice(2);
  const ascii = args.includes('--ascii');
  const only = args.filter((a) => !a.startsWith('--')).map((a) => a.replace(/^.*\//, '').replace(/\.json$/, ''));
  const principles = await read('data/principles.json');
  const F = createFormation(await read('data/formations/helios-433.json'));
  const formations = { us: F, them: F };
  const files = (await readdir(new URL('data/scenarios/', root))).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  const pt = (p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;

  let invalid = 0, failed = 0, checked = 0;
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
    const { scenario: s, t, ctx, base, ghost, engineGhost, ideal, frame, moved, startScore, problems } = r;
    if (problems.length) failed++;
    const hold = s.answer.hold === true ? ' (hold)' : '';
    console.log(`${problems.length ? '✗' : '✓'} ${file} [${s.id}] ${s.learner.role} at t = ${t} s: ${ctx.duty}; base ${pt(base)}; ghost ${pt(ghost.spot)} scores ${ghost.score}, ${moved.toFixed(1)} m from the start (which scores ${startScore})${hold}`);
    const top = [...ghost.result.rules].sort((a, b) => b.weight - a.weight).slice(0, 4).map((q) => `${q.id} ${q.s.toFixed(2)} x ${q.weight}`);
    console.log(`    rules at the ghost: ${top.join(', ') || '(none apply)'}`);
    if (ideal) {
      const whose = s.answer.mode === 'authored' ? `authored answer ${pt(ideal.spot)}; the engine's own best spot ${pt(engineGhost.spot)} (${engineGhost.score}) is` : `authored ideal ${pt(ideal.spot)} scores ${ideal.score}; ghost is`;
      console.log(`    ${whose} ${ideal.distance.toFixed(1)} m from it`);
    }
    for (const p of problems) console.log(`    ✗ ${p}`);
    if (ascii) {
      const learnerId = ctx.learner.id;
      console.log(renderAscii({ ...frame, players: frame.players.filter((p) => p.id !== learnerId) }, { marks: [{ ...ghost.spot, ch: '*', label: 'ghost' }, { ...base, ch: '+', label: 'base' }] }));
    }
  }

  console.log(`\n${checked} scenario(s) checked: ${invalid} invalid, ${failed} failing a drill-quality gate.`);
  process.exitCode = invalid || failed ? 1 : 0;
}

// Run as a script (npm run check); importing the module (tests, the browser) only defines the functions.
if (typeof process !== 'undefined' && process.versions?.node && process.argv?.[1]) {
  const { pathToFileURL } = await import('node:url');
  if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
}
