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
// The progressive field (docs/PROGRESSIVE_FIELD.md §1, §3; js/engine/cast.js): which stages each drill and its mirror
// pass (a small game, a bigger game; the full match always does), with their casts ("3 v 2"). A drill (or its mirror)
// with neither a small nor a medium stage fails, as does a staged cast that hides a player the drill scripts or names, or a
// primary idea whose rules are not met at the answer, unless the scenario says why: "stages": { "note": "..." } (a
// malformed "stages" block always fails). Each drill's line also says which idea the smaller games are held to.
// Exits 1 if any scenario is invalid, fails a gate, or has a stage problem.
//
// checkScenario() is pure (Node and the browser): the file system is only touched in main().

import { createFormation } from '../js/engine/formation.js';
import { validateScenario, normalizeScenario, mirrorScenario, stagesErrors, learnerId as learnerIdOf } from '../js/engine/scenario.js';
import { frameAt, learnerBaseAt } from '../js/engine/timeline.js';
import { buildContext } from '../js/engine/context.js';
import { computeGhost } from '../js/engine/ghost.js';
import { evaluate, toleranceFor } from '../js/engine/score.js';
import { dist } from '../js/engine/geometry.js';
import { stagesOf } from '../js/engine/cast.js';
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

/**
 * The problems with a scenario's optional `"stages"` block (docs/PROGRESSIVE_FIELD.md §3, js/engine/cast.js keepIdsOf):
 * an object with `note`, a non-empty string (why the drill has no small or medium stage, or hides a player its words
 * name), and `keep`, an array of player ids the cast always shows (mirrored with the drill). One definition:
 * js/engine/scenario.js stagesErrors, which validateScenario reports too (so #/author catches the same problems).
 * @returns {string[]}
 */
export function stagesProblems(raw) {
  return stagesErrors(raw?.stages);
}

/**
 * Which stages of the progressive field a scenario and its mirror pass (js/engine/cast.js stagesOf): a small game and a
 * bigger game (the full match always passes), the lesson the gate holds them to, and the problems that fail the run:
 * a malformed `"stages"` block; a drill (or its mirror) with neither a small nor a medium stage; a staged cast that hides
 * a player the drill scripts or names (keepIdsOf: never, by construction; checked all the same); a primary idea whose
 * rules are not met at the full game's answer (the gate then holds another idea) — the last three unless the scenario
 * says why in `"stages": { "note": "..." }` (docs/PROGRESSIVE_FIELD.md §3).
 * @param {object} raw  scenario JSON as authored (valid: run checkScenario first)
 * @param {{ principles: object, formations: {us: object, them?: object} }} opts
 * @returns {{ stages: { small: string|null, medium: string|null }, mirror: { small: string|null, medium: string|null },
 *   why: { small: string[], medium: string[] }, lesson: string, keep: string[], note: string|null, problems: string[] }}
 *   stages / mirror: each passing stage's cast label ("3 v 2"), null when it fails; why: the last reasons the drill's
 *   small and medium casts failed the gate (for the report); lesson: the idea and rules the gate holds ("R3 screen x 1+",
 *   "U1 compact (T3 has no rule)"); keep: the players the drill scripts or names (always shown)
 */
export function checkStages(raw, { principles, formations }) {
  const problems = stagesProblems(raw);
  const note = typeof raw.stages?.note === 'string' && raw.stages.note.trim() ? raw.stages.note.trim() : null;
  const run = (item, trace) => stagesOf(item, { formations, principles, trace });
  const labels = (r) => ({ small: r.small?.cast.label ?? null, medium: r.medium?.cast.label ?? null });
  const trace = [];
  const own = run(raw, trace), mirrored = run(mirrorScenario(normalizeScenario(raw)));
  const stages = labels(own), mirror = labels(mirrored);
  const last = (stage) => trace.filter((t) => t.stage === stage && t.failed.length).at(-1)?.failed ?? [];
  const why = { small: stages.small ? [] : last('small'), medium: stages.medium ? [] : last('medium') };
  const l = own.full.lesson;
  const primary = normalizeScenario(raw).principles[0];
  const lesson = !l ? 'no rule met at the answer (the praise and the answer only)'
    : `${l.principle} ${l.rules.join(', ')} x ${l.minWeight}+${l.primary ? '' : ` (${primary ?? 'the drill'} ${l.unmet ? 'is not met at the answer' : primary ? 'has no rule' : 'has no idea'})`}`;
  if (!note) {
    for (const [who, st] of [['the drill', stages], ['its mirror', mirror]]) {
      if (!st.small && !st.medium) problems.push(`${who} has no small or medium stage (the full match only): make the lesson work in a smaller game, or say why in "stages": { "note": "..." }`);
    }
    for (const [who, r] of [['the drill', own], ['its mirror', mirrored]]) {
      for (const k of ['small', 'medium']) {
        const hidden = (r.full.keep ?? []).filter((id) => r[k] && !r[k].cast.ids.includes(id));
        if (hidden.length) problems.push(`${who}'s ${k} game hides ${hidden.join(', ')}, whom the drill scripts or names: show them, or say why in "stages": { "note": "..." }`);
      }
    }
    if (l?.unmet) problems.push(`the primary idea ${primary}'s rules are not met at the answer, so the smaller games hold ${l.principle} instead: fix the drill, or say why in "stages": { "note": "..." }`);
  }
  return { stages, mirror, why, lesson, keep: [...(own.full.keep ?? [])], note, problems };
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

  let invalid = 0, failed = 0, checked = 0, unstaged = 0;
  const tally = { n: 0, small: 0, medium: 0, mSmall: 0, mMedium: 0 };
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
    const st = checkStages(raw, { principles, formations });
    const say = (x) => ['small', 'medium'].map((k) => (x[k] ? `${k} ${x[k]}` : `${k} ✗`)).join(' · ');
    console.log(`    stages: ${say(st.stages)} · full 11 v 11 (mirror: ${say(st.mirror)}); held to ${st.lesson}${st.keep.length ? `; always shown: ${st.keep.join(' ')}` : ''}${st.note ? `; note: ${st.note}` : ''}`);
    for (const k of ['small', 'medium']) if (st.why[k].length) console.log(`      ${k} fails: ${st.why[k].join('; ')}`);
    for (const p of st.problems) console.log(`    ✗ ${p}`);
    if (st.problems.length) unstaged++;
    tally.small += !!st.stages.small; tally.medium += !!st.stages.medium; tally.mSmall += !!st.mirror.small; tally.mMedium += !!st.mirror.medium; tally.n++;
    if (ascii) {
      const learnerId = ctx.learner.id;
      console.log(renderAscii({ ...frame, players: frame.players.filter((p) => p.id !== learnerId) }, { marks: [{ ...ghost.spot, ch: '*', label: 'ghost' }, { ...base, ch: '+', label: 'base' }] }));
    }
  }

  console.log(`\n${checked} scenario(s) checked: ${invalid} invalid, ${failed} failing a drill-quality gate, ${unstaged} with a stage problem (no small or medium stage, a hidden player, an unmet primary idea, a malformed "stages").`);
  console.log(`stages (drills / mirrors): small ${tally.small}/${tally.n} / ${tally.mSmall}/${tally.n}, medium ${tally.medium}/${tally.n} / ${tally.mMedium}/${tally.n}, full ${tally.n}/${tally.n}`);
  process.exitCode = invalid || failed || unstaged ? 1 : 0;
}

// Run as a script (npm run check); importing the module (tests, the browser) only defines the functions.
if (typeof process !== 'undefined' && process.versions?.node && process.argv?.[1]) {
  const { pathToFileURL } = await import('node:url');
  if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
}
