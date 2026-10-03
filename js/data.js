// Browser-side data loaders: fetch same-origin JSON and hand plain objects to the engine.
// Contract: docs/ARCHITECTURE.md §5.9 (app.data). Every loader tolerates a missing or
// broken file (returns a fallback and logs once), so the app boots while content is WIP.
// The normalise* helpers are pure and tested in Node.

import { createFormation } from './engine/formation.js';

/** Repo-relative paths of every data file the app reads. */
export const DATA_PATHS = Object.freeze({
  principles: 'data/principles.json',
  curriculum: 'data/curriculum.json',
  tutorial: 'data/tutorial.json',
  resources: 'data/resources.json',
  formation: 'data/formations/helios-433.json',
  scenarioIndex: 'data/scenarios/index.json',
  scenarioDir: 'data/scenarios/',
});

/** Repo root, resolved from this file so the page location never matters. */
const ROOT = new URL('../', import.meta.url);

/** Absolute URL for a repo-relative path. */
export const dataUrl = (path) => new URL(path, ROOT).href;

/**
 * Fetch JSON. Returns `fallback` (and warns once) on a network error, non-2xx status or bad JSON.
 * @param {string} path repo-relative
 * @param {{ fallback?: any, fetchImpl?: typeof fetch, quiet?: boolean, retries?: number }} [opts]
 *   retries: extra tries after a network error (a dropped connection), 300 ms apart; HTTP errors are not retried
 */
export async function fetchJSON(path, { fallback = null, fetchImpl = globalThis.fetch, quiet = false, retries = 1 } = {}) {
  try {
    let res;
    for (let attempt = 0; ; attempt++) {
      try { res = await fetchImpl(dataUrl(path)); break; } catch (err) {
        // A dropped connection (not an HTTP error): try again once before falling back.
        if (attempt >= retries) throw err;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (!quiet) console.info(`[fotbol] ${path} not loaded (${err.message}); using a fallback.`);
    return fallback;
  }
}

/**
 * Principle catalogue → { list, byId }. Accepts an array, { principles: [...] } or an id-keyed object.
 * @returns {{ list: object[], byId: Object<string, object> }}
 */
export function normalizePrinciples(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && Array.isArray(raw.principles)) list = raw.principles;
  else if (raw && typeof raw === 'object') list = Object.entries(raw).map(([id, p]) => ({ id, ...p }));
  list = list.filter((p) => p && typeof p.id === 'string');
  return { list, byId: Object.fromEntries(list.map((p) => [p.id, p])) };
}

/**
 * Scenario index → ScenarioMeta[] ({ id, file, ...rest }). Accepts an array or { scenarios: [...] };
 * entries may be file names ('d3-cover-lcb-001.json'), ids, or objects with at least `id` or `file`.
 */
export function normalizeScenarioIndex(raw) {
  const entries = Array.isArray(raw) ? raw : Array.isArray(raw?.scenarios) ? raw.scenarios : [];
  const out = [];
  const seen = new Set();
  for (const e of entries) {
    let meta;
    if (typeof e === 'string') {
      const file = e.endsWith('.json') ? e : `${e}.json`;
      meta = { id: file.replace(/^.*\//, '').replace(/\.json$/, ''), file };
    } else if (e && typeof e === 'object' && (e.id || e.file)) {
      const file = e.file ?? `${e.id}.json`;
      meta = { ...e, id: e.id ?? file.replace(/^.*\//, '').replace(/\.json$/, ''), file };
    } else continue;
    if (seen.has(meta.id)) continue;
    seen.add(meta.id);
    out.push(meta);
  }
  return out;
}

/**
 * The authored pass drills of the index (its `passes` list, scripts/build-index.mjs) → ScenarioMeta[] with kind 'pass'.
 * They are kept apart from `scenarios`, so the coach's menus and the spot-drill readers never see one; the Road's pass
 * sets read them (js/ui/player/road.js).
 */
export function normalizePassIndex(raw) {
  return normalizeScenarioIndex(Array.isArray(raw?.passes) ? raw.passes : []).map((m) => ({ ...m, kind: 'pass' }));
}

/**
 * Scenario access with a per-id promise cache. load() rejects (and forgets the id) on failure.
 * @param {object[]} index normalised ScenarioMeta[] (spot drills)
 * @param {(path: string) => Promise<any>} getJSON rejects on failure
 * @param {object[]} [passIndex] normalizePassIndex(): authored pass drills, loadable by id like the scenarios
 */
export function createScenarioStore(index, getJSON, passIndex = []) {
  const byId = new Map([...passIndex, ...index].map((m) => [m.id, m]));
  const cache = new Map();
  return {
    index,
    passIndex,
    meta: (id) => byId.get(id) ?? null,
    load(id) {
      if (!cache.has(id)) {
        const file = byId.get(id)?.file ?? `${id}.json`;
        const p = getJSON(DATA_PATHS.scenarioDir + file).catch((err) => {
          cache.delete(id);
          throw new Error(`scenario ${id}: ${err.message}`);
        });
        cache.set(id, p);
      }
      return cache.get(id);
    },
  };
}

/** Strict fetch (rejects on failure), for scenario loads the caller must handle. */
async function fetchJSONStrict(path, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(dataUrl(path));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Formations for both teams from one table (v1: helios-433 for us and them, mirrored by teamTargets).
 * Falls back to createFormation() with no table (linear fallback) when the table is missing,
 * and to null if the engine cannot build either.
 */
export function buildFormations(table, make = createFormation) {
  try {
    const f = table ? make(table) : make();
    return { us: f, them: f };
  } catch (err) {
    console.warn('[fotbol] formation build failed:', err);
    if (table) return buildFormations(null, make);
    return null;
  }
}

/**
 * Load everything app.data needs. Never rejects.
 * @returns {Promise<{ principles, curriculum, tutorial, resources, formations, scenarios }>}
 */
export async function loadAppData({ fetchImpl = globalThis.fetch } = {}) {
  const get = (path, fallback = null) => fetchJSON(path, { fallback, fetchImpl });
  const [principles, curriculum, tutorial, resources, formationTable, scenarioIndex] = await Promise.all([
    get(DATA_PATHS.principles),
    get(DATA_PATHS.curriculum),
    get(DATA_PATHS.tutorial),
    get(DATA_PATHS.resources),
    get(DATA_PATHS.formation),
    get(DATA_PATHS.scenarioIndex, []),
  ]);
  return {
    principles: normalizePrinciples(principles),
    curriculum,
    tutorial,
    resources,
    formations: buildFormations(formationTable),
    scenarios: createScenarioStore(normalizeScenarioIndex(scenarioIndex), (path) => fetchJSONStrict(path, fetchImpl), normalizePassIndex(scenarioIndex)),
  };
}
