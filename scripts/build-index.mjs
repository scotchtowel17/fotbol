#!/usr/bin/env node
// Build data/scenarios/index.json: the list of scenario files the app loads (js/data.js).
//
//   node scripts/build-index.mjs            validate every scenario and write the index
//   node scripts/build-index.mjs --check    exit 1 if index.json is missing or out of date (writes nothing)
//
// Scans data/scenarios/*.json, skipping index.json and files whose name starts with '_' (templates
// such as _example.json). Each file is checked with validateScenario() against data/principles.json;
// any invalid file or a scenario id used twice stops the build (exit 1, nothing written). The index
// is sorted by module, then file name, and keeps only what menus need before a scenario is loaded:
//   { version: 1, generated: 'by scripts/build-index.mjs',
//     scenarios: [ { id, file, title, module, moment, phase, principles, role, difficulty } ],
//     passes: [ { id, file, title, principles, role, difficulty } ] }
// Authored pass drills (kind 'pass': js/engine/passdrill.js) are validated with validatePassDrill() and listed apart,
// under `passes` (written only when there is one), so every reader of `scenarios` (the coach's menus, Player mode's
// "Find your spot" sets) keeps seeing spot drills only; the Road's pass sets read `passes` (js/ui/player/road.js).
// Warnings (a file name that differs from its id, a scenario its module does not list in
// data/curriculum.json) are printed but do not fail the build.
//
// The pure parts (scenarioFiles, indexEntry, buildIndex, serializeIndex, diffIndex) run in Node and
// the browser (tests/build-index.test.js); only run() touches the file system, via dynamic imports.

import { validateScenario } from '../js/engine/scenario.js';
import { validatePassDrill } from '../js/engine/passdrill.js';

export const INDEX_VERSION = 1;
export const INDEX_GENERATED = 'by scripts/build-index.mjs';
export const INDEX_FILE = 'index.json';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Natural order: 'M2' < 'M10', 'a-2' < 'a-10'. Deterministic (no locale). */
export function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const pa = String(a).match(re) ?? [], pb = String(b).match(re) ?? [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    const nx = /^\d/.test(x), ny = /^\d/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d;
      if (x.length !== y.length) return x.length - y.length; // '01' after '1'
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return pa.length - pb.length;
}

/** The scenario files to index from a directory listing: *.json, not index.json, not '_'-prefixed; sorted. */
export function scenarioFiles(names) {
  return [...names]
    .filter((f) => typeof f === 'string' && f.endsWith('.json') && f !== INDEX_FILE && !f.startsWith('_') && !f.startsWith('.'))
    .sort(naturalCompare);
}

/** One index row for a scenario read from `file`. Missing optional fields become null (difficulty 0). */
export function indexEntry(scenario, file) {
  const s = isObj(scenario) ? scenario : {};
  return {
    id: s.id ?? null,
    file,
    title: s.title ?? null,
    module: s.module ?? null,
    moment: s.moment ?? null,
    phase: s.phase ?? null,
    principles: Array.isArray(s.principles) ? [...s.principles] : [],
    role: s.learner?.role ?? null,
    difficulty: Number.isFinite(s.difficulty) ? s.difficulty : 0,
  };
}

/** One `passes` row for an authored pass drill read from `file`. */
export function passEntry(drill, file) {
  const s = isObj(drill) ? drill : {};
  return {
    id: s.id ?? null,
    file,
    title: s.title ?? null,
    principles: Array.isArray(s.principles) ? [...s.principles] : [],
    role: s.learner?.role ?? null,
    difficulty: Number.isFinite(s.difficulty) ? s.difficulty : 0,
  };
}

/** Sort rows by module (natural order; rows without a module last), then file name. */
export function sortEntries(rows) {
  return [...rows].sort((a, b) => {
    if (a.module !== b.module) {
      if (a.module == null) return 1;
      if (b.module == null) return -1;
      const d = naturalCompare(a.module, b.module);
      if (d) return d;
    }
    return naturalCompare(a.file, b.file);
  });
}

/**
 * Validate scenarios and build the index.
 * @param {{ file: string, scenario?: object, error?: string }[]} items  one per file; `error` = the file could not be read or parsed
 * @param {{ principles?: object, curriculum?: object }} [opts]  principles: anything validateScenario accepts;
 *   curriculum: data/curriculum.json, for the "not listed in its module" warnings
 * @returns {{ index: { version: number, generated: string, scenarios: object[] }, errors: string[], warnings: string[] }}
 *   index lists the valid scenarios only; the build is good when errors is empty
 */
export function buildIndex(items, { principles, curriculum } = {}) {
  const errors = [], warnings = [], rows = [], passes = [];
  const byId = new Map(); // id → first file
  for (const { file, scenario, error } of items) {
    if (error) { errors.push(`${file}: ${error}`); continue; }
    const pass = scenario?.kind === 'pass';
    const problems = pass ? validatePassDrill(scenario, { principles }) : validateScenario(scenario, { principles });
    if (problems.length) {
      for (const p of problems) errors.push(`${file}: ${p}`);
      continue;
    }
    if (byId.has(scenario.id)) {
      errors.push(`${file}: id "${scenario.id}" is already used by ${byId.get(scenario.id)}`);
      continue;
    }
    byId.set(scenario.id, file);
    if (file !== `${scenario.id}.json`) warnings.push(`${file}: the file name does not match its id "${scenario.id}" (expected ${scenario.id}.json)`);
    if (pass) passes.push(passEntry(scenario, file));
    else rows.push(indexEntry(scenario, file));
  }

  const modules = Array.isArray(curriculum?.modules) ? curriculum.modules : null;
  if (modules) {
    const byModule = new Map(modules.map((m) => [m.id, m]));
    for (const r of rows) {
      const m = byModule.get(r.module);
      if (!r.module) warnings.push(`${r.file}: no module, so no curriculum module will offer it`);
      else if (!m) warnings.push(`${r.file}: module "${r.module}" is not in data/curriculum.json`);
      else if (!(m.scenarios ?? []).includes(r.id)) warnings.push(`${r.file}: ${r.module} does not list "${r.id}" in its scenarios (data/curriculum.json)`);
    }
    for (const m of modules) {
      for (const id of m.scenarios ?? []) {
        if (!byId.has(id)) warnings.push(`data/curriculum.json: ${m.id} lists "${id}", but no valid scenario has that id`);
      }
    }
  }

  const index = { version: INDEX_VERSION, generated: INDEX_GENERATED, scenarios: sortEntries(rows) };
  if (passes.length) index.passes = [...passes].sort((a, b) => naturalCompare(a.file, b.file));
  return { index, errors, warnings };
}

/** One-line JSON with a space after ':' and ',' (arrays stay tight: ["D3", "U4"]). */
function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (isObj(v)) {
    const parts = Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

/** The index as file text: pretty at the top, one scenario per line (small diffs), trailing newline. */
export function serializeIndex(index) {
  const list = (rows) => (rows.length ? `[\n${rows.map((r) => `    ${inline(r)}`).join(',\n')}\n  ]` : '[]');
  const passes = index.passes?.length ? `,\n  "passes": ${list(index.passes)}` : '';
  return `{\n  "version": ${JSON.stringify(index.version)},\n  "generated": ${JSON.stringify(index.generated)},\n  "scenarios": ${list(index.scenarios ?? [])}${passes}\n}\n`;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What differs between the index on disk and the one the scenarios produce (formatting is ignored).
 * @param {object|null} current  parsed index.json (null = missing)
 * @param {object} expected      buildIndex().index
 * @returns {string[]} empty = up to date
 */
export function diffIndex(current, expected) {
  if (!isObj(current)) return ['index.json is missing or is not a JSON object'];
  const out = [];
  if (current.version !== expected.version) out.push(`version is ${JSON.stringify(current.version)}, expected ${expected.version}`);
  if (current.generated !== expected.generated) out.push('the "generated" note differs');
  const cur = Array.isArray(current.scenarios) ? current.scenarios : [];
  const curById = new Map(cur.map((r) => [r?.id, r]));
  const expById = new Map(expected.scenarios.map((r) => [r.id, r]));
  for (const r of expected.scenarios) {
    if (!curById.has(r.id)) out.push(`missing: ${r.id} (${r.file})`);
    else if (!same(curById.get(r.id), r)) out.push(`out of date: ${r.id}`);
  }
  for (const r of cur) if (!expById.has(r?.id)) out.push(`no longer a valid scenario file: ${r?.id ?? JSON.stringify(r)}`);
  if (!out.length && !same(cur.map((r) => r.id), expected.scenarios.map((r) => r.id))) out.push('the order differs (module, then file name)');
  const curPass = Array.isArray(current.passes) ? current.passes : [];
  const expPass = expected.passes ?? [];
  if (!same(curPass, expPass)) {
    const ids = (rows) => rows.map((r) => r?.id).join(', ') || 'none';
    out.push(`passes (authored pass drills) differ: listed ${ids(curPass)}; expected ${ids(expPass)}${same(curPass.map((r) => r?.id), expPass.map((r) => r.id)) ? ' (a row is out of date)' : ''}`);
  }
  return out;
}

/**
 * The command: read, validate, then write or check. Node only.
 * @param {{ dir?: URL|string, principles?: object, curriculum?: object|null, check?: boolean,
 *           log?: (s: string) => void, warn?: (s: string) => void }} [opts]
 *   dir: the scenario folder (default data/scenarios/); principles and curriculum default to the repo's files
 * @returns {Promise<number>} exit code: 0 ok, 1 invalid scenarios or (with check) an out-of-date index
 */
export async function run({ dir, principles, curriculum, check = false, log = console.log, warn = console.warn } = {}) {
  const { readFile, readdir, writeFile } = await import('node:fs/promises');
  const root = new URL('../', import.meta.url);
  const folder = dir ? new URL(String(dir).endsWith('/') ? String(dir) : `${dir}/`, root) : new URL('data/scenarios/', root);
  const readJSON = async (url) => JSON.parse(await readFile(url, 'utf8'));
  principles ??= await readJSON(new URL('data/principles.json', root));
  if (curriculum === undefined) curriculum = await readJSON(new URL('data/curriculum.json', root)).catch(() => null);

  const files = scenarioFiles(await readdir(folder));
  const items = [];
  for (const file of files) {
    try {
      items.push({ file, scenario: await readJSON(new URL(file, folder)) });
    } catch (err) {
      items.push({ file, error: `not valid JSON (${err.message})` });
    }
  }
  const { index, errors, warnings } = buildIndex(items, { principles, curriculum });
  for (const w of warnings) warn(`⚠ ${w}`);
  if (errors.length) {
    log(`✗ ${errors.length} problem(s); ${INDEX_FILE} not ${check ? 'checked' : 'written'}:`);
    for (const e of errors) log(`    - ${e}`);
    return 1;
  }

  const target = new URL(INDEX_FILE, folder);
  const text = serializeIndex(index);
  const counts = [...Object.entries(Object.groupBy?.(index.scenarios, (r) => r.module ?? 'no module') ?? {}).map(([m, rs]) => `${m}: ${rs.length}`),
    ...(index.passes?.length ? [`pass drills: ${index.passes.length}`] : [])].join(', ');
  if (check) {
    let current = null;
    try { current = await readJSON(target); } catch { /* missing or broken: reported below */ }
    const diff = diffIndex(current, index);
    if (diff.length) {
      log(`✗ ${INDEX_FILE} is out of date. Run: node scripts/build-index.mjs`);
      for (const d of diff) log(`    - ${d}`);
      return 1;
    }
    log(`✓ ${INDEX_FILE} is up to date (${index.scenarios.length} scenario(s)${counts ? `; ${counts}` : ''}).`);
    return 0;
  }
  let before = null;
  try { before = await readFile(target, 'utf8'); } catch { /* new file */ }
  if (before === text) log(`✓ ${INDEX_FILE} already up to date (${index.scenarios.length} scenario(s)${counts ? `; ${counts}` : ''}).`);
  else {
    await writeFile(target, text);
    log(`✓ Wrote ${INDEX_FILE}: ${index.scenarios.length} scenario(s)${counts ? ` (${counts})` : ''}.`);
  }
  return 0;
}

// Run as a script; importing the module (tests, browser) only defines the functions above.
if (typeof process !== 'undefined' && process.versions?.node && process.argv?.[1]) {
  const { pathToFileURL } = await import('node:url');
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await run({ check: process.argv.slice(2).includes('--check') });
  }
}
