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
//     disagreement": the engine moved an answer the coach keyed, so review it);
//   - Player mode's right area (js/engine/kidscore.js, the full match): standing still earns no stars
//     (unless answer.hold) and the best spot 3 stars. The staged games hold the same two (cast.js gate).
// In authored mode the engine's own best spot is printed for coach review (not a failure).
// The progressive field (docs/PROGRESSIVE_FIELD.md §1, §3; js/engine/cast.js): which stages each drill and its mirror
// pass (a small game, a bigger game; the full match always does), with their casts ("3 v 2"). A drill (or its mirror)
// with neither a small nor a medium stage fails, as does a staged cast that hides a player the drill scripts or names, or a
// primary idea whose rules are not met at the answer, unless the scenario says why: "stages": { "note": "..." } (a
// malformed "stages" block always fails). Each drill's line also says which idea the smaller games are held to.
// Authored pass drills (kind 'pass') get the pass gates instead (checkPass: js/engine/passdrill.js checkPassDrill on the
// drill and its mirror, a clear best, enough choices, a decoy, realistic speeds), plus: the drill's first idea is one
// its scene teaches (passLessons), and a small or medium stage for the drill and its mirror unless "stages" says why.
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
import { stagesOf, lessonOf } from '../js/engine/cast.js';
import { checkPassDrill, mirrorPassDrill } from '../js/engine/passdrill.js';
import { kidArea, kidStars, kidOutline } from '../js/engine/kidscore.js';
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
 *   ideal: { spot: object, score: number, distance: number, disagree: boolean } | null, misconceptions: string[],
 *   kid: { area: object, start: number, best: number }, problems: string[] }}
 *   scenario is the normalised copy; t its freezeAt (the duration when not authored); engineGhost the ghost searched round the
 *   base (= ghost in engine mode); start the learner's playback spot, moved the ghost's distance from it and startScore what
 *   standing still there scores (judged as the drill judges it); misconceptions the ids whose region holds the ghost; kid
 *   Player mode's right area round the ghost (kidscore.js kidArea, the full match) and its stars standing still and at the
 *   ghost; problems the failed drill-quality gates (empty = a good drill)
 */
export function checkScenario(raw, { principles, formations }) {
  // (principles: the catalogue, for validation and each idea's rules: the lesson Player mode's keys read.)
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
  const hold = s.answer.hold === true;
  const area = kidArea(ctx, { best: ghost.spot, centre, tol, start, hold, stage: 'full', lesson: lessonOf(s.principles, ghost.result, principles), misconceptions: s.misconceptions });
  const kid = { area, start: kidStars(ctx, start, area).stars, best: kidStars(ctx, ghost.spot, area).stars };
  if (!hold && kid.start !== 0) problems.push(`standing still earns ${kid.start} stars in Player mode (not 0): the right area reaches the start`);
  if (kid.best !== 3) problems.push(`the best spot earns ${kid.best} stars in Player mode (not 3)`);
  return { errors: [], scenario: s, t, frame, base, ctx, ghost, engineGhost, start, moved, startScore, ideal, misconceptions, kid, problems };
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
 *   why: { small: string[], medium: string[] }, lesson: string, keep: string[], note: string|null,
 *   kid: { small, medium, full }, kidMirror: { small, medium, full }, problems: string[] }}
 *   stages / mirror: each passing stage's cast label ("3 v 2"), null when it fails; why: the last reasons the drill's
 *   small and medium casts failed the gate (for the report); lesson: the idea and rules the gate holds ("R3 screen x 1+",
 *   "U1 compact (T3 has no rule)"); keep: the players the drill scripts or names (always shown); kid: per stage of the
 *   drill, Player mode's { start, best, green } (stars standing still and at the best spot, the green's mean radius in m:
 *   kidscore.js kidOutline), null for a stage it does not pass (the staged gate holds start 0 and best 3); kidMirror: the
 *   same for the mirror. Problems also: the mirror's full match where standing still earns a star or the best spot fewer
 *   than 3 (checkScenario says so for the drill itself)
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
  // Player mode's right area per stage (the smaller games' gate holds start 0 and best 3; the full match always plays,
  // so its stars are checked here for the mirror and in checkScenario for the drill).
  const kidOf = (r) => Object.fromEntries(['small', 'medium', 'full'].map((k) => {
    if (!r[k]) return [k, null];
    const green = kidOutline(r[k].ctx, r[k].area);
    return [k, { start: r[k].gates.kidStart, best: r[k].gates.kidBest, green: green.reduce((a, q) => a + q.r, 0) / green.length }];
  }));
  const kid = kidOf(own), kidMirror = kidOf(mirrored);
  const hold = normalizeScenario(raw).answer?.hold === true;
  if (!hold && kidMirror.full.start !== 0) problems.push(`its mirror's standing still earns ${kidMirror.full.start} stars in Player mode (not 0): the right area reaches the start`);
  if (kidMirror.full.best !== 3) problems.push(`its mirror's best spot earns ${kidMirror.full.best} stars in Player mode (not 3)`);
  return { stages, mirror, why, lesson, keep: [...(own.full.keep ?? [])], note, kid, kidMirror, problems };
}

/**
 * Check an authored pass drill (kind 'pass'): checkPassDrill (format, gates, speeds, the mirror), the first idea taught
 * by the scene, and its progressive-field stages and its mirror's.
 * @param {object} raw  the drill as authored
 * @param {{ principles: object, formations: {us: object, them?: object} }} opts
 * @returns {{ errors: string[] } | { errors: [], t: number, best: object, margin: number, choices: number, decoys: number,
 *   lessons: string[], stages: { small: string|null, medium: string|null }, mirror: { small: string|null, medium: string|null },
 *   note: string|null, problems: string[] }}  stages / mirror: each passing stage's cast label ("4 v 2"), null when it fails
 */
export function checkPass(raw, { principles, formations }) {
  const c = checkPassDrill(raw, { formations, principles });
  if (c.errors?.length) return { errors: c.errors };
  const problems = [...c.problems];
  const primary = raw.principles?.[0];
  if (primary && !c.lessons.includes(primary)) problems.push(`the first idea ${primary} is not one this scene teaches (it teaches ${c.lessons.join(', ') || 'nothing'})`);
  const labels = (r) => ({ small: r.small?.cast.label ?? null, medium: r.medium?.cast.label ?? null });
  const stages = labels(stagesOf(raw, { formations, principles }));
  const mirror = labels(stagesOf(mirrorPassDrill(raw, { formations }), { formations, principles }));
  const stageErrors = stagesProblems(raw);
  problems.push(...stageErrors);
  const note = typeof raw.stages?.note === 'string' && raw.stages.note.trim() ? raw.stages.note.trim() : null;
  if (!note) {
    for (const [who, st] of [['the drill', stages], ['its mirror', mirror]]) {
      if (!st.small && !st.medium) problems.push(`${who} has no small or medium stage (the full match only): say why in "stages": { "note": "..." }`);
    }
  }
  return { errors: [], t: raw.timeline?.freezeAt ?? raw.timeline?.duration, best: c.best, margin: c.margin, choices: c.choices, decoys: c.decoys, lessons: c.lessons, stages, mirror, note, problems };
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

  let invalid = 0, failed = 0, checked = 0, unstaged = 0, passes = 0;
  const tally = { n: 0, small: 0, medium: 0, mSmall: 0, mMedium: 0 };
  const kids = { reps: 0, best: 0, moving: 0, still: 0, greens: { small: [], medium: [], full: [] } }; // Player mode, every staged rep
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    let raw;
    try { raw = await read(`data/scenarios/${file}`); } catch (err) { console.log(`✗ ${file}: not valid JSON (${err.message})`); invalid++; continue; }
    if (only.length && !only.includes(id) && !only.includes(raw.id)) continue;
    if (raw?.kind === 'pass') {
      const r = checkPass(raw, { principles, formations });
      passes++;
      if (r.errors.length) {
        invalid++;
        console.log(`✗ ${file} [${raw.id}] (pass drill)`);
        for (const e of r.errors) console.log(`    - ${e}`);
        continue;
      }
      if (r.problems.length) failed++;
      const b = r.best;
      console.log(`${r.problems.length ? '✗' : '✓'} ${file} [${raw.id}] ${raw.learner.role} pass drill at t = ${r.t} s: best ${b.id} (${b.score}, ${b.colour}), ${r.margin} points clear, ${r.choices} passes not cut out, ${r.decoys} decoy(s); the scene teaches ${r.lessons.join(', ')}`);
      const say = (x) => ['small', 'medium'].map((k) => (x[k] ? `${k} ${x[k]}` : `${k} ✗`)).join(' · ');
      console.log(`    stages: ${say(r.stages)} · full 11 v 11 (mirror: ${say(r.mirror)})${r.note ? `; note: ${r.note}` : ''}`);
      for (const p of r.problems) console.log(`    ✗ ${p}`);
      continue;
    }
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
    const kidSay = (x) => ['small', 'medium', 'full'].filter((k) => x[k]).map((k) => `${k} ${x[k].start}/${x[k].best}★ green ${x[k].green.toFixed(1)} m`).join(' · ');
    console.log(`    player mode (standing still / best spot, the green's mean radius): ${kidSay(st.kid)} (mirror: ${kidSay(st.kidMirror)})${hold ? ' (hold: standing still is not judged)' : ''}`);
    for (const x of [st.kid, st.kidMirror]) for (const k of ['small', 'medium', 'full']) {
      if (!x[k]) continue;
      kids.reps++; kids.best += x[k].best === 3; kids.greens[k].push(x[k].green);
      if (!hold) { kids.moving++; kids.still += x[k].start === 0; }
    }
    for (const k of ['small', 'medium']) if (st.why[k].length) console.log(`      ${k} fails: ${st.why[k].join('; ')}`);
    for (const p of st.problems) console.log(`    ✗ ${p}`);
    if (st.problems.length) unstaged++;
    tally.small += !!st.stages.small; tally.medium += !!st.stages.medium; tally.mSmall += !!st.mirror.small; tally.mMedium += !!st.mirror.medium; tally.n++;
    if (ascii) {
      const learnerId = ctx.learner.id;
      console.log(renderAscii({ ...frame, players: frame.players.filter((p) => p.id !== learnerId) }, { marks: [{ ...ghost.spot, ch: '*', label: 'ghost' }, { ...base, ch: '+', label: 'base' }] }));
    }
  }

  console.log(`\n${checked} scenario(s) and ${passes} authored pass drill(s) checked: ${invalid} invalid, ${failed} failing a drill-quality gate, ${unstaged} with a stage problem (no small or medium stage, a hidden player, an unmet primary idea, a malformed "stages").`);
  console.log(`stages (drills / mirrors): small ${tally.small}/${tally.n} / ${tally.mSmall}/${tally.n}, medium ${tally.medium}/${tally.n} / ${tally.mMedium}/${tally.n}, full ${tally.n}/${tally.n}`);
  const median = (xs) => { const q = [...xs].sort((a, b) => a - b); return q.length ? q[Math.floor(q.length / 2)].toFixed(1) : '-'; };
  console.log(`player mode (js/engine/kidscore.js, drills and mirrors at every stage they play): the best spot 3★ in ${kids.best}/${kids.reps} reps, standing still 0★ in ${kids.still}/${kids.moving} (hold drills not judged); the green's mean radius, median: small ${median(kids.greens.small)} m, medium ${median(kids.greens.medium)} m, full ${median(kids.greens.full)} m`);
  process.exitCode = invalid || failed || unstaged ? 1 : 0;
}

// Run as a script (npm run check); importing the module (tests, the browser) only defines the functions.
if (typeof process !== 'undefined' && process.versions?.node && process.argv?.[1]) {
  const { pathToFileURL } = await import('node:url');
  if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
}
