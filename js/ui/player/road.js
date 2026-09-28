// The Road (docs/KID_REDESIGN.md §3 and §8.1): Player mode's path of chapters and nodes (data/road.json), the player
// profile (store key 'player'), and the set builder that turns a node into its 5 reps.
//
//   loadRoad(app?) → Promise<road>          normalizeRoad(raw) → road      (main.js loads it once into app.data.road)
//   loadProfile(app) → profile              saveProfile(app, profile)      normalizeProfile(raw), pickGroup(profile, group)
//   roadNodes(road), nodeById(road, id), chapterOf(road, id), nodeStars(profile, id), roadModel(road, profile)
//   isUnlocked(road, profile, id), nextNode(road, profile), isMatchdayUnlocked(road, profile)
//   repKind(road, node) → 'spot' | 'pass'   nodeHref(road, node) → '#/play/<id>' | '#/pass/<id>'
//   buildSet(node, { road, profile, index, load, rewards, skills, seed, formations, generators }) → Promise<rep[]>
//     rep = { kind: 'spot', scenario, mirrored, nodeId, recall?, generated?, twin?, repeat? } | { kind: 'pass', drill, nodeId }
//   buildFirstSet({ profile, index, load, seed, formations, generators }) → Promise<rep[]>   the onboarding set (§4.1), optional
//   setStarsFor(repStars) → 0..3            recordSet(app, nodeId, repStars) → { before, after, setStars, plays, unlocked, matchday }
//
// Profile: { version, group: 'DEF'|'MID'|'WING'|'STRIKER'|null, role, onboarded, road: { [nodeId]: { stars: 0..3, plays } } }.
// `onboarded` turns true when the player picks a position on the kick-off screen: from then on '#/' is the Player home.
//
// Sets (§3): a spot node gives 5 reps: first 1 recall rep from an earlier node you have played (R23), then authored
// scenarios whose principles meet the node's, in your position group first (mirrored when the side differs, so a left
// back plays a right-back drill as a left back), then generated drills for your position (js/engine/spotdrill.js), then
// authored ones for other positions; still short, the mirrored twins of the set's authored reps, then repeats. A pass node
// gives authored pass drills (index entries with kind 'pass') and generated ones (js/engine/passdrill.js) on its
// principles. A mix node takes its chapter's nodes in turn. Deterministic for a seed (with the same index, profile and
// rewards). The generators are imported lazily; a missing or failing one leaves the set to authored content.
//
// Pure except: loadProfile/saveProfile/recordSet (the store, through `app`), loadRoad (fetch), and buildSet's defaults
// (bindRoad(app): the app's scenario loader, formations and road; else a same-origin fetch). Nothing here touches the
// document or window at import time (tests/road.test.js and tests/copy.test.js import it in Node).

import { LEARNABLE_ROLES, familyOf, sideOf, mirrorRole } from '../../engine/roles.js';
import { mirrorScenario } from '../../engine/scenario.js';

export const ROAD_DEFAULTS = Object.freeze({
  reps: 5, // [S] §3: a set is 5 reps
  firstReps: 3, // [S] §4.1: the onboarding set ('#/play/first') is 3 easy reps
  recall: 1, // [S] §3 and R23: one recall rep from an earlier node you have played, first in the set
  unlockStars: 1, // [S] §3: a node opens when the one before it has at least this many stars
  starBands: Object.freeze([Object.freeze([2.5, 3]), Object.freeze([1.8, 2]), Object.freeze([1, 1])]), // [S] §3: set average → node stars
  maxStars: 3, // [S]
  generatorTries: 3, // [D] generator calls per missing rep (each with its own seed) before moving on
});

/** Store key of the player profile (js/store.js adds the 'fotbol:' prefix). */
export const PROFILE_KEY = 'player';
/** Window event fired when the profile is saved (detail: { profile }); the top bar listens. */
export const PROFILE_EVENT = 'fotbol:player';
/** '#/play/first': the onboarding set. It is not a Road node and is never recorded on the Road. */
export const FIRST_SET = 'first';
export const GROUPS = Object.freeze(['DEF', 'MID', 'WING', 'STRIKER']);
/** Role families per position group (data/road.json `groups`; this copy is the fallback). */
export const GROUP_FAMILIES = Object.freeze({
  DEF: Object.freeze(['CB', 'FB']), MID: Object.freeze(['DM', 'CM']), WING: Object.freeze(['W']), STRIKER: Object.freeze(['ST']),
});
/** The role each group starts in (§3). */
export const DEFAULT_ROLE = Object.freeze({ DEF: 'LB', MID: 'LCM', WING: 'LW', STRIKER: 'ST' });

/** Every visible word this module owns (tests/copy.test.js): the position groups. */
export const STRINGS = Object.freeze({
  groups: Object.freeze({ DEF: 'Defender', MID: 'Midfielder', WING: 'Winger', STRIKER: 'Striker' }),
});

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KINDS = ['spot', 'pass', 'mix'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const strings = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))] : []);
const int = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : lo);
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };

// ---------------------------------------------------------------- seeded randomness (pure)

/** FNV-1a: a string (or anything) → uint32. */
export function hash32(value) {
  const s = String(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32 seeded from hash32(seed): () → [0, 1). */
export function seededRandom(seed) {
  let a = hash32(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- the road (pure)

/**
 * data/road.json → the road the helpers use: bad chapters and nodes dropped, ids unique, every node tagged with its
 * `chapter`, and every mix node given its source chapter's principles and the kind of rep it plays (`repKind`).
 */
export function normalizeRoad(raw) {
  const r = isObj(raw) ? raw : {};
  const groups = {};
  for (const g of GROUPS) {
    const fams = strings(r.groups?.[g]);
    groups[g] = Object.freeze(fams.length ? fams : [...GROUP_FAMILIES[g]]);
  }
  const defaultRoles = {};
  for (const g of GROUPS) {
    const role = r.defaultRoles?.[g];
    defaultRoles[g] = LEARNABLE_ROLES.includes(role) && groups[g].includes(familyOf(role)) ? role : DEFAULT_ROLE[g];
  }
  const seen = new Set();
  const chapters = [];
  for (const c of Array.isArray(r.chapters) ? r.chapters : []) {
    if (!isObj(c) || !ID_RE.test(str(c.id)) || chapters.some((x) => x.id === c.id)) continue;
    const nodes = [];
    for (const n of Array.isArray(c.nodes) ? c.nodes : []) {
      const id = str(n?.id);
      if (!isObj(n) || !ID_RE.test(id) || seen.has(id) || id === FIRST_SET) continue;
      seen.add(id);
      const kind = KINDS.includes(n.kind) ? n.kind : 'spot';
      nodes.push({ id, kind, title: str(n.title) || id, icon: str(n.icon) || 'ball', principles: strings(n.principles), from: kind === 'mix' ? str(n.from) || c.id : null, chapter: c.id });
    }
    if (nodes.length) chapters.push({ id: c.id, title: str(c.title) || c.id, skill: str(c.skill) || str(c.title) || c.id, icon: str(c.icon) || 'ball', opensAfter: str(c.opensAfter) || null, nodes });
  }
  for (const c of chapters) {
    for (const n of c.nodes) {
      if (n.kind !== 'mix') { n.repKind = n.kind; continue; }
      const src = chapters.find((x) => x.id === n.from) ?? c;
      const parts = src.nodes.filter((x) => x.kind !== 'mix');
      n.from = src.id;
      n.principles = [...new Set(parts.flatMap((x) => x.principles))];
      n.repKind = parts.length && parts.every((x) => x.kind === 'pass') ? 'pass' : 'spot';
    }
  }
  const unlockAfter = str(r.matchday?.unlockAfter);
  return { version: 1, groups, defaultRoles, matchday: { unlockAfter: seen.has(unlockAfter) ? unlockAfter : null }, chapters };
}

/** Every node, in road order. */
export const roadNodes = (road) => (road?.chapters ?? []).flatMap((c) => c?.nodes ?? []);
/** A node by id (null when unknown). */
export const nodeById = (road, id) => roadNodes(road).find((n) => n.id === id) ?? null;
/** The chapter a node is in (null when unknown). */
export const chapterOf = (road, id) => (road?.chapters ?? []).find((c) => (c?.nodes ?? []).some((n) => n.id === id)) ?? null;

const asNode = (road, node) => (typeof node === 'string' ? nodeById(road, node) : node) ?? null;

/** The kind of rep a node plays: 'pass' for pass nodes (and a mix of pass nodes), else 'spot'. */
export function repKind(road, node) {
  const n = asNode(road, node);
  if (!n) return 'spot';
  if (n.repKind === 'spot' || n.repKind === 'pass') return n.repKind;
  if (n.kind === 'pass' || n.kind === 'spot') return n.kind;
  const src = (road?.chapters ?? []).find((c) => c.id === (n.from ?? n.chapter)) ?? chapterOf(road, n.id);
  const parts = (src?.nodes ?? []).filter((x) => x.kind !== 'mix');
  return parts.length && parts.every((x) => x.kind === 'pass') ? 'pass' : 'spot';
}

/** Where a node is played: '#/play/<id>' or '#/pass/<id>'. */
export function nodeHref(road, node) {
  const n = asNode(road, node);
  if (!n) return '#/play';
  return `#/${repKind(road, n) === 'pass' ? 'pass' : 'play'}/${encodeURIComponent(n.id)}`;
}

/** The group a role belongs to ('LB' → 'DEF'), or null. */
export function groupOfRole(role, groups = GROUP_FAMILIES) {
  const fam = familyOf(role);
  return GROUPS.find((g) => (groups?.[g] ?? []).includes(fam)) ?? null;
}

// ---------------------------------------------------------------- the profile

export function createProfile() {
  return { version: 1, group: null, role: null, onboarded: false, road: {} };
}

/** A stored profile, sanitised (anything unreadable reads as a fresh start). */
export function normalizeProfile(raw) {
  const p = createProfile();
  if (!isObj(raw)) return p;
  p.group = GROUPS.includes(raw.group) ? raw.group : null;
  const fams = p.group ? GROUP_FAMILIES[p.group] : null;
  p.role = LEARNABLE_ROLES.includes(raw.role) && (!fams || fams.includes(familyOf(raw.role))) ? raw.role : p.group ? DEFAULT_ROLE[p.group] : null;
  p.onboarded = raw.onboarded === true && p.group !== null;
  if (isObj(raw.road)) {
    for (const [id, v] of Object.entries(raw.road)) {
      if (!ID_RE.test(id) || id === FIRST_SET || !isObj(v)) continue;
      const stars = int(v.stars, 0, ROAD_DEFAULTS.maxStars), plays = int(v.plays, 0, 1e6);
      if (stars || plays) p.road[id] = { stars, plays };
    }
  }
  return p;
}

/** The profile after picking a position on the kick-off screen: the group, its starting role, onboarded. */
export function pickGroup(profile, group, road = null) {
  const p = normalizeProfile(profile);
  if (!GROUPS.includes(group)) return p;
  const role = p.group === group && p.role ? p.role : road?.defaultRoles?.[group] ?? DEFAULT_ROLE[group];
  return { ...p, group, role, onboarded: true };
}

/** The stored profile (a fresh one when there is none, or the store fails). */
export function loadProfile(app) {
  try { return normalizeProfile(app?.store?.get?.(PROFILE_KEY, null)); } catch { return createProfile(); }
}

/** Store the profile and tell listeners. @returns {boolean} false if it could not be persisted */
export function saveProfile(app, profile) {
  const p = normalizeProfile(profile);
  const ok = !!app?.store?.set?.(PROFILE_KEY, p);
  try { globalThis.dispatchEvent?.(new CustomEvent(PROFILE_EVENT, { detail: { profile: p } })); } catch { /* no DOM */ }
  return ok;
}

/** Subscribe to profile saves. @returns {() => void} unsubscribe */
export function onProfile(fn) {
  const handler = (e) => { try { fn(e.detail?.profile); } catch (err) { console.error(err); } };
  globalThis.addEventListener?.(PROFILE_EVENT, handler);
  return () => globalThis.removeEventListener?.(PROFILE_EVENT, handler);
}

// ---------------------------------------------------------------- stars, unlocks, next up (pure)

export const nodeStars = (profile, id) => int(profile?.road?.[id]?.stars, 0, ROAD_DEFAULTS.maxStars);
export const nodePlays = (profile, id) => int(profile?.road?.[id]?.plays, 0, 1e6);

/**
 * A node is open when it is the first on the Road, when the node before it has a star, when you have played it, or,
 * for the first node of a chapter with `opensAfter`, when that node has a star ("Pass it right" opens after chapter 1's
 * first node).
 */
export function isUnlocked(road, profile, nodeId, P = ROAD_DEFAULTS) {
  const nodes = roadNodes(road);
  const i = nodes.findIndex((n) => n.id === nodeId);
  if (i < 0) return false;
  if (i === 0 || nodeStars(profile, nodeId) > 0 || nodePlays(profile, nodeId) > 0) return true;
  if (nodeStars(profile, nodes[i - 1].id) >= P.unlockStars) return true;
  const ch = chapterOf(road, nodeId);
  return !!(ch?.opensAfter && ch.nodes[0]?.id === nodeId && nodeStars(profile, ch.opensAfter) >= P.unlockStars);
}

/** Next up (§3): the first open node with fewer than 3 stars, in road order; with every open node at 3 stars, the last open one. */
export function nextNode(road, profile) {
  const nodes = roadNodes(road);
  const open = nodes.filter((n) => isUnlocked(road, profile, n.id));
  return open.find((n) => nodeStars(profile, n.id) < ROAD_DEFAULTS.maxStars) ?? open.at(-1) ?? nodes[0] ?? null;
}

/** Match day opens when the road's `matchday.unlockAfter` node (chapter 1's Big Match) has a star. */
export function isMatchdayUnlocked(road, profile) {
  const id = road?.matchday?.unlockAfter;
  return !!id && nodeStars(profile, id) >= ROAD_DEFAULTS.unlockStars;
}

/**
 * The Road as the home screen and the card draw it (pure).
 * @returns {{ id, title, skill, icon, unlocked, current, stars, maxStars, nodes: { id, title, icon, kind, repKind, principles,
 *   stars, unlocked, current, href }[] }[]}   current: the chapter (and node) that is next up
 */
export function roadModel(road, profile) {
  const next = nextNode(road, profile);
  return (road?.chapters ?? []).map((c) => {
    const nodes = c.nodes.map((n) => ({
      id: n.id, title: n.title, icon: n.icon, kind: n.kind, repKind: repKind(road, n), principles: n.principles,
      stars: nodeStars(profile, n.id), unlocked: isUnlocked(road, profile, n.id), current: next?.id === n.id, href: nodeHref(road, n),
    }));
    return {
      id: c.id, title: c.title, skill: c.skill, icon: c.icon ?? 'ball', unlocked: nodes.some((n) => n.unlocked), current: nodes.some((n) => n.current),
      stars: nodes.reduce((a, n) => a + n.stars, 0), maxStars: nodes.length * ROAD_DEFAULTS.maxStars, nodes,
    };
  });
}

/** Node stars for a set (§3): the average rep stars → 3 at 2.5 or more, 2 at 1.8, 1 at 1, else 0. */
export function setStarsFor(repStars, P = ROAD_DEFAULTS) {
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN); // null = a rep not played
  const xs = (Array.isArray(repStars) ? repStars : []).map(num).filter(Number.isFinite).map((s) => Math.min(P.maxStars, Math.max(0, s)));
  if (!xs.length) return 0;
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return P.starBands.find(([min]) => avg >= min - 1e-9)?.[1] ?? 0;
}

/**
 * Record a finished set on the Road: node stars = max(before, setStarsFor(repStars)), plays + 1. The onboarding set
 * ('first') and ids the loaded road does not know are not recorded.
 * @returns {{ before: number, after: number, setStars: number, plays: number, unlocked: string[], matchday: boolean }}
 *   unlocked: nodes this set opened; matchday: Match day opened with it
 */
export function recordSet(app, nodeId, repStars = []) {
  const id = String(nodeId ?? '');
  const setStars = setStarsFor(repStars);
  const profile = loadProfile(app);
  const before = nodeStars(profile, id);
  const loaded = app?.data?.road ?? bound.app?.data?.road ?? null;
  const road = loaded?.chapters?.length ? loaded : null; // a road that failed to load checks nothing
  if (!ID_RE.test(id) || id === FIRST_SET || (road && !nodeById(road, id))) {
    return { before, after: before, setStars, plays: nodePlays(profile, id), unlocked: [], matchday: false };
  }
  const after = Math.max(before, setStars);
  const plays = nodePlays(profile, id) + 1;
  const next = { ...profile, road: { ...profile.road, [id]: { stars: after, plays } } };
  const openBefore = new Set(road ? roadNodes(road).filter((n) => isUnlocked(road, profile, n.id)).map((n) => n.id) : []);
  const matchBefore = road ? isMatchdayUnlocked(road, profile) : false;
  saveProfile(app, next);
  const unlocked = road ? roadNodes(road).filter((n) => !openBefore.has(n.id) && isUnlocked(road, next, n.id)).map((n) => n.id) : [];
  return { before, after, setStars, plays, unlocked, matchday: road ? !matchBefore && isMatchdayUnlocked(road, next) : false };
}

// ---------------------------------------------------------------- loading the road

const bound = { app: null };

/** Give buildSet and recordSet the app's defaults (its scenario store, formations and road). main.js calls it at boot. */
export function bindRoad(app) { bound.app = app ?? null; }

let roadPromise = null;

/** data/road.json, normalised (app.data.road when the app has it). Never rejects: a road that fails to load is empty. */
export async function loadRoad(app = bound.app, { fetchImpl = globalThis.fetch } = {}) {
  if (app?.data?.road?.chapters?.length) return app.data.road;
  roadPromise ??= fetchRoad(fetchImpl);
  const road = await roadPromise;
  if (!road.chapters.length) roadPromise = null; // try again next time
  else if (app?.data && !app.data.road?.chapters?.length) {
    try { app.data.road = road; } catch { /* the app's data is frozen until it loads (main.js sets it then) */ }
  }
  return road;
}

async function fetchRoad(fetchImpl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(new URL('../../../data/road.json', import.meta.url).href);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return normalizeRoad(await res.json());
    } catch (err) {
      if (attempt) console.info(`[fotbol] data/road.json not loaded (${err?.message ?? err}).`);
      else await new Promise((r) => setTimeout(r, 300)); // a dropped connection: one more try
    }
  }
  return normalizeRoad(null);
}

// ---------------------------------------------------------------- building a set

const generators = {}; // kind → Promise<fn|null>: the lazily imported generators
const GENERATOR = Object.freeze({ spot: ['../../engine/spotdrill.js', 'generateSpotDrill'], pass: ['../../engine/passdrill.js', 'generatePassDrill'] });

async function generatorFor(ctx, kind) {
  if (ctx.generators !== undefined) {
    const f = ctx.generators?.[kind];
    return typeof f === 'function' ? f : null;
  }
  if (!generators[kind]) {
    const [url, name] = GENERATOR[kind];
    const p = import(url).then((m) => (typeof m?.[name] === 'function' ? m[name] : null), () => null);
    generators[kind] = p;
    p.then((f) => { if (!f && generators[kind] === p) delete generators[kind]; }); // not there (yet): look again next time
  }
  return generators[kind];
}

const isScenario = (s) => isObj(s) && isObj(s.timeline) && isObj(s.learner);

/** A same-origin loader for scenario files (when neither the caller nor the bound app gives one). */
function fetchScenarios(index) {
  return async (id) => {
    const file = index.find((e) => e?.id === id)?.file ?? `${id}.json`;
    const res = await fetch(new URL(`../../../data/scenarios/${file}`, import.meta.url).href);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
}

function setContext(opts, road) {
  const app = opts.app ?? bound.app;
  const store = app?.data?.scenarios;
  const profile = normalizeProfile(opts.profile ?? (app ? loadProfile(app) : null));
  const group = profile.group ?? groupOfRole(profile.role) ?? 'MID';
  const role = profile.role ?? road?.defaultRoles?.[group] ?? DEFAULT_ROLE[group];
  const index = Array.isArray(opts.index) ? opts.index : Array.isArray(opts.index?.index) ? opts.index.index : Array.isArray(store?.index) ? store.index : [];
  const load = typeof opts.load === 'function' ? opts.load
    : typeof opts.index?.load === 'function' ? (id) => opts.index.load(id)
      : typeof store?.load === 'function' ? (id) => store.load(id) : fetchScenarios(index);
  return {
    road, profile: { ...profile, group, role }, group, role,
    families: road?.groups?.[group] ?? GROUP_FAMILIES[group],
    index, load,
    rewards: isObj(opts.rewards) ? opts.rewards : null,
    seed: opts.seed ?? 0,
    formations: opts.formations ?? app?.data?.formations ?? null,
    generators: opts.generators,
    reps: Math.max(1, int(opts.count ?? ROAD_DEFAULTS.reps, 1, 50)),
  };
}

const seedFor = (ctx, ...parts) => hash32([ctx.seed, ...parts].join('|'));
const sidesDiffer = (a, b) => { const x = sideOf(a), y = sideOf(b); return !!x && !!y && x !== 'C' && y !== 'C' && x !== y; };

/**
 * Authored scenarios on these principles, best first: played in your role (after mirroring) before other roles, the
 * principle as the scenario's main one before a side one, fresh or low-star ones before ones you aced, then seeded.
 * @returns {{ id: string, mirror: boolean, role: string, inGroup: boolean, difficulty: number }[]}
 */
function authoredRefs(index, principles, ctx, salt) {
  const want = new Set(principles ?? []);
  const rng = seededRandom(`${ctx.seed}|${salt}`);
  const out = [];
  for (const e of Array.isArray(index) ? index : []) {
    if (!isObj(e) || typeof e.id !== 'string' || e.kind === 'pass') continue;
    const ps = Array.isArray(e.principles) ? e.principles : [];
    if (!ps.some((p) => want.has(p))) continue;
    const authored = e.role ?? e.learner?.role;
    if (!LEARNABLE_ROLES.includes(authored)) continue;
    const mirror = sidesDiffer(authored, ctx.role);
    const role = mirror ? mirrorRole(authored) : authored;
    const stars = ctx.rewards?.best?.[e.id]?.stars;
    const rank = [role === ctx.role ? 0 : 1, want.has(ps[0]) ? 0 : 1, Number.isFinite(stars) ? 1 + stars : 0, rng()];
    out.push({ id: e.id, mirror, role, inGroup: ctx.families.includes(familyOf(authored)), rank });
  }
  return out.sort((a, b) => cmp(a.rank, b.rank));
}

async function loadRef(ref, ctx) {
  try {
    const s = await ctx.load(ref.id);
    if (!isScenario(s)) return null;
    return { kind: 'spot', scenario: ref.mirror ? mirrorScenario(s) : s, mirrored: ref.mirror };
  } catch (err) {
    console.warn(`[fotbol] road: scenario ${ref.id} did not load (${err?.message ?? err})`);
    return null;
  }
}

/**
 * The spot reps one node can give, in order: authored in your group, generated for your position, authored in other
 * positions. `used` (shared by a set) keeps a scenario to one rep.
 */
function spotQueue(node, ctx, used, salt) {
  const refs = authoredRefs(ctx.index, node.principles, ctx, `${salt}|${node.id}`);
  const tiers = [refs.filter((r) => r.inGroup), null, refs.filter((r) => !r.inGroup)];
  let tries = 0;
  const maxTries = ctx.reps * ROAD_DEFAULTS.generatorTries;
  const fromRefs = async (list) => {
    for (const ref of list) {
      if (used.has(ref.id)) continue;
      used.add(ref.id);
      const rep = await loadRef(ref, ctx);
      if (rep) return { ...rep, nodeId: node.id };
    }
    return null;
  };
  const generated = async () => {
    const gen = await generatorFor(ctx, 'spot');
    while (gen && tries < maxTries) {
      const seed = seedFor(ctx, node.id, salt, 'gen', tries++);
      let s = null;
      try { s = await gen({ seed, role: ctx.role, principles: [...node.principles], formations: ctx.formations }); } catch (err) {
        console.warn('[fotbol] road: spot drill generation failed', err?.message ?? err);
      }
      const id = isScenario(s) ? String(s.id ?? `gen-${seed}`) : null;
      if (id && !used.has(id)) {
        used.add(id);
        return { kind: 'spot', scenario: s, mirrored: false, generated: true, nodeId: node.id };
      }
    }
    return null;
  };
  return {
    async next() {
      return (await fromRefs(tiers[0])) ?? (await generated()) ?? (await fromRefs(tiers[2]));
    },
  };
}

/** Short of reps: the mirrored twins of the set's authored reps (the same idea on the other side), then repeats. */
function fillUp(out, n) {
  const base = out.slice();
  for (const r of base) {
    if (out.length >= n) break;
    if (r.kind !== 'spot' || r.generated || r.recall) continue;
    const { recall, repeat, ...rest } = r;
    out.push({ ...rest, scenario: mirrorScenario(r.scenario), mirrored: !r.mirrored, twin: true });
  }
  for (let i = 0; out.length < n && base.length; i++) {
    const { recall, ...rest } = base[i % base.length];
    out.push({ ...rest, repeat: true });
  }
  return out;
}

/** The chapter nodes a mix node draws from (of one rep kind). */
function mixParts(road, node, kind) {
  const src = (road?.chapters ?? []).find((c) => c.id === node.from) ?? chapterOf(road, node.id);
  const parts = (src?.nodes ?? []).filter((x) => x.kind !== 'mix' && repKind(road, x) === kind && x.principles?.length);
  return parts.length ? parts : [node];
}

/** Nodes before `node` on the Road that you have played (for the recall rep). */
function earlierPlayed(road, profile, node) {
  const nodes = roadNodes(road);
  const i = nodes.findIndex((n) => n.id === node.id);
  return nodes.slice(0, Math.max(0, i)).filter((n) => nodePlays(profile, n.id) > 0 || nodeStars(profile, n.id) > 0);
}

async function spotSet(node, ctx) {
  const n = ctx.reps;
  const rng = seededRandom(`${ctx.seed}|${node.id}|order`);
  const used = new Set();
  const out = [];
  if (node.kind !== 'mix' && ROAD_DEFAULTS.recall > 0 && n > 1) {
    const earlier = earlierPlayed(ctx.road, ctx.profile, node).filter((x) => x.kind === 'spot');
    if (earlier.length) {
      const from = earlier[Math.floor(rng() * earlier.length)];
      const rep = await spotQueue(from, ctx, used, 'recall').next();
      if (rep) out.push({ ...rep, recall: true });
    }
  }
  const targets = node.kind === 'mix' ? mixParts(ctx.road, node, 'spot') : [node];
  const queues = targets.map((t) => spotQueue(t, ctx, used, 'set'));
  const start = Math.floor(rng() * queues.length);
  for (let turn = 0; out.length < n; turn++) {
    let rep = null;
    for (let j = 0; j < queues.length && !rep; j++) rep = await queues[(start + turn + j) % queues.length].next();
    if (!rep) break;
    out.push(rep);
  }
  return fillUp(out, n);
}

async function passSet(node, ctx) {
  const n = ctx.reps;
  const out = [];
  const used = new Set();
  const targets = node.kind === 'mix' ? mixParts(ctx.road, node, 'pass') : [node];
  const want = new Set(node.principles);
  const rng = seededRandom(`${ctx.seed}|${node.id}|pass`);
  const authored = ctx.index
    .filter((e) => isObj(e) && e.kind === 'pass' && typeof e.id === 'string' && (e.principles ?? []).some((p) => want.has(p)))
    .map((e) => ({ e, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.e);
  for (const e of authored) {
    if (out.length >= n) break;
    try {
      const drill = await ctx.load(e.id);
      if (isObj(drill)) { used.add(e.id); out.push({ kind: 'pass', drill, nodeId: node.id }); }
    } catch (err) { console.warn(`[fotbol] road: pass drill ${e.id} did not load (${err?.message ?? err})`); }
  }
  const gen = await generatorFor(ctx, 'pass');
  const start = Math.floor(rng() * targets.length);
  for (let tries = 0, turn = 0; gen && out.length < n && tries < n * ROAD_DEFAULTS.generatorTries; tries++) {
    const t = targets[(start + turn) % targets.length];
    const seed = seedFor(ctx, node.id, 'pass', tries);
    let drill = null;
    try { drill = await gen({ seed, role: ctx.role, principles: [...t.principles], formations: ctx.formations }); } catch (err) {
      console.warn('[fotbol] road: pass drill generation failed', err?.message ?? err);
    }
    const id = isObj(drill) ? String(drill.id ?? `pass-${seed}`) : null;
    if (id && !used.has(id)) { used.add(id); out.push({ kind: 'pass', drill, nodeId: t.id }); turn++; }
  }
  return out;
}

/**
 * The reps of a node's set (§3, §8.1). Deterministic for a seed.
 * @param {object|string} node  a road node (or its id, with `road`)
 * @param {{ road?, profile?, index?, load?, rewards?, skills?, seed?, formations?, generators?, count?, app? }} [opts]
 *   index: the scenario index (app.data.scenarios.index) or the scenario store itself; load: id → Promise<scenario>
 *   (default: the bound app's store, else a fetch); generators: { spot, pass } functions, or null for none (default:
 *   the engine's, imported when first needed); count: reps (default 5)
 * @returns {Promise<object[]>} reps; a pass set can be empty when neither a generator nor authored pass drills exist
 */
export async function buildSet(node, opts = {}) {
  const road = opts.road ?? bound.app?.data?.road ?? null;
  const n = asNode(road, node);
  if (!n?.id) return [];
  const ctx = setContext(opts, road);
  return repKind(road, n) === 'pass' ? passSet(n, ctx) : spotSet(n, ctx);
}

/**
 * The onboarding set (§4.1, '#/play/first'): 3 easy reps for your position group, the easiest authored first (in your
 * role, then chapter 1's ideas first), then generated ones on chapter 1's ideas, then easy ones in other positions.
 * @param {{ road?, profile?, index?, load?, seed?, formations?, generators?, count?, app? }} [opts]
 */
export async function buildFirstSet(opts = {}) {
  const road = opts.road ?? bound.app?.data?.road ?? null;
  const ctx = setContext({ ...opts, count: opts.count ?? ROAD_DEFAULTS.firstReps }, road);
  const firstChapter = road?.chapters?.[0];
  const early = firstChapter ? [...new Set(firstChapter.nodes.filter((x) => x.kind === 'spot').flatMap((x) => x.principles))] : [];
  // Every authored spot scenario, easiest first; then in your role, then on chapter 1's ideas, then seeded.
  const rng = seededRandom(`${ctx.seed}|first`);
  const refs = [];
  for (const e of ctx.index) {
    if (!isObj(e) || typeof e.id !== 'string' || e.kind === 'pass') continue;
    const authored = e.role ?? e.learner?.role;
    if (!LEARNABLE_ROLES.includes(authored)) continue;
    const mirror = sidesDiffer(authored, ctx.role);
    const role = mirror ? mirrorRole(authored) : authored;
    const ps = Array.isArray(e.principles) ? e.principles : [];
    refs.push({
      id: e.id, mirror, role, inGroup: ctx.families.includes(familyOf(authored)),
      rank: [Number.isFinite(e.difficulty) ? e.difficulty : 0, role === ctx.role ? 0 : 1, ps.some((p) => early.includes(p)) ? 0 : 1, rng()],
    });
  }
  refs.sort((a, b) => cmp(a.rank, b.rank));
  const out = [];
  const used = new Set();
  const take = async (list) => {
    for (const ref of list) {
      if (out.length >= ctx.reps) return;
      if (used.has(ref.id)) continue;
      used.add(ref.id);
      const rep = await loadRef(ref, ctx);
      if (rep) out.push({ ...rep, nodeId: FIRST_SET });
    }
  };
  await take(refs.filter((r) => r.inGroup));
  if (out.length < ctx.reps && early.length) {
    const q = spotQueue({ id: FIRST_SET, principles: early }, { ...ctx, index: [] }, used, 'first');
    while (out.length < ctx.reps) {
      const rep = await q.next();
      if (!rep) break;
      out.push(rep);
    }
  }
  await take(refs.filter((r) => !r.inGroup));
  return fillUp(out, ctx.reps);
}
