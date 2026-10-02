// The Road (docs/KID_REDESIGN.md §3 and §8.1): Player mode's path of chapters and nodes (data/road.json), the player
// profile (store key 'player'), and the set builder that turns a node into its 5 reps.
//
//   loadRoad(app?) → Promise<road>          normalizeRoad(raw) → road      (main.js loads it once into app.data.road)
//   loadProfile(app) → profile              saveProfile(app, profile)      normalizeProfile(raw), pickGroup(profile, group)
//   roadNodes(road), nodeById(road, id), chapterOf(road, id), nodeStars(profile, id), roadModel(road, profile)
//   isUnlocked(road, profile, id), nextNode(road, profile), isMatchdayUnlocked(road, profile), matchdayGate(road)
//   chapterOrder(road, group) → chapters, your group's lead chapter first (road.json `lead`)
//   repKind(road, node) → 'spot' | 'pass'   nodeHref(road, node) → '#/play/<id>' | '#/pass/<id>'
//   buildSet(node, { road, profile, index, load, rewards, skills, seed, formations, catalogue, generators, app }) → Promise<rep[]>
//     rep = { kind: 'spot', scenario, mirrored, nodeId, recall?, generated?, borrowed?, spare?, extra?, twin?, repeat? }
//         | { kind: 'pass', drill, nodeId, borrowed?, spare?, extra? }
//     borrowed: played in another position; spare: past maxBorrowed, as nothing else in yours was left
//     given the `app`, the set counts as started: startSet(app, nodeId, reps)
//   startSet(app, nodeId, reps) → attempt     nodeAttempt(profile, id)   (the node's start counter; the last set's reps)
//   buildFirstSet({ profile, index, load, seed, formations, catalogue, generators, app }) → Promise<rep[]>   the onboarding set
//     (§4.1); given the `app`, its reps become the profile's last set (startSet(app, FIRST_SET, reps): nothing counted)
//   buildQuickPassSet({ road, profile, seed, formations, catalogue, generators }) → Promise<rep[]>   '#/pass': the free
//     player mixed with playing forward (road.json `quickPass`)
//   setStarsFor(repStars) → 0..3            recordSet(app, nodeId, repStars) → { before, after, setStars, plays, unlocked, matchday }
//   forwardPlan(ok[], count) → Set<slot>    repPicture(rep), nearDuplicate(a, b), ballAtFreeze(scenario)   (pure, tested)
//
// Profile: { version, group: 'DEF'|'MID'|'WING'|'STRIKER'|null, role, onboarded,
//            road: { [nodeId]: { stars: 0..3, plays, starts } }, last: { nodeId, ids: string[] } | null }.
// `onboarded` turns true when the player picks a position on the kick-off screen: from then on '#/' is the Player home.
// `plays` counts finished sets (recordSet); `starts` counts sets begun (startSet), and a set's seed takes it in, so
// leaving or reloading in the middle of a set never deals the same reps again (no replaying known answers for XP);
// `last` is the last set's reps (the onboarding set's too, nodeId 'first'): the next set deals them only when nothing
// else is left, and its recall rep never repeats one.
//
// Next up (nextNode): your group's lead chapter first (data/road.json `lead`: "Help the ball" for everyone but
// defenders, so attackers get attacking plays early), then the Road's order; the first open node under 2 stars, so a
// fresh (0-star) or weak node comes before replaying a 2-star one; then the first under 3; else the last open one.
//
// Sets (§3): a spot node gives 5 reps: first 1 recall rep from another node you have played (R23: never the node you
// are on, never on its ideas, never a rep of your last set, and from another node than the last set's when it can), then authored
// scenarios whose principles meet the node's, in your position group first (mirrored when the side differs, so a left
// back plays a right-back drill as a left back), then generated drills for your position (js/engine/spotdrill.js), then
// authored ones for other positions; still short (ideas with few drills that the generator cannot make for your
// position, e.g. crosses for a defender), the chapter's other ideas the same way (`extra`); only then the mirrored twins
// of the set's authored reps, and repeats (never needed on the Road: tests/road-sets-*.test.js sweeps every node and group).
// A pass node gives authored pass drills (index entries with kind 'pass'), then generated ones (js/engine/passdrill.js)
// from consecutive integer seeds, 3 of 5 wanting a forward best where the ideas allow one (the "always pass back" trap);
// a rep your position rarely gets is played by a teammate in your group (`borrowed`: a full-back's "free side" is the
// centre-back's switch), then any pass on the idea, then another passing idea of the chapter (`extra`). A mix node
// takes its chapter's nodes in turn. Generated reps carry the catalogue's titles and takeaways (data/principles.json),
// and a set never holds two that look the same (nearDuplicate), two generated reps from one engine template, or two
// generated spot reps with the same player on the ball at the freeze ("Their winger has the ball" twice). A spot
// generator call is told the questions the set asks already (spotdrill.js avoidTemplates: the same drill, other words),
// so a drill is turned away for its question only when no other question fits it. At most
// maxBorrowed reps of a set are lent to another position (your group first). A generator is not asked for what the
// engine says it cannot make (its canGenerate* helpers, when it has them), and one that comes back empty twice for a
// position and its ideas is not asked again in that set. Deterministic for a seed (with the same index, profile and
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
  generatorNulls: 2, // [D] a generator that comes back empty this often for one position and set of ideas is not asked
  //                     again in that set (each call already tries 30-40 scenes: that position rarely gets those ideas)
  forwardPasses: 3, // [S] research/passing.md §6.4 (passdrill.js forwardSlots): 3 of a set's 5 passes want a forward best
  maxSameBest: 2, // [D] at most this many reps of a set star a pass to the same position (passdrill.js maxSameBest); a
  //                  winger's only forward receiver is usually the #9, so a winger's set then holds 2 forward bests, not 3
  nearSpot: 5, // [D] m: two reps for the same position with the ball this close at the freeze, and you starting as close
  //              (a pass rep: the same best pass), look like the same rep; a set keeps only the first
  nextStars: 2, // [S] play-test: Next up offers an open node under this many stars before replaying one at it (2 stars
  //               is good enough to move on; 0 or 1 is new or still weak)
  maxBorrowed: 2, // [S] play-test: at most this many reps of a set played in another position ("Now you're ..."),
  //                  unless nothing else in yours is left (the rep is then `spare`)
  lastIds: 10, // [D] the last set's rep ids kept in the profile (a set is 5; room for a longer one)
  stageLook: 2, // [D] a set still short of reps that can be played small (or in the bigger game) looks at up to this many
  //               more drills for a rep before it takes one that cannot (docs/PROGRESSIVE_FIELD.md §2: small slots are
  //               not all quietly played bigger)...
  stageBudget: 6, // [D] ...and makes at most this many extra generator calls a set for it (each one costs 5-150 ms)
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

// ---------------------------------------------------------------- stages: a small game → a bigger game → the full match (pure)

/** The stages, smallest first (= js/engine/cast.js STAGES, tested; a copy, so the engine loads only when a set is built). */
export const STAGES = Object.freeze(['small', 'medium', 'full']);

/** docs/PROGRESSIVE_FIELD.md §2: the stage of each of a Road set's 5 reps, by the node's stars before the set (row = stars). */
export const STAGE_PLANS = Object.freeze([
  Object.freeze(['small', 'small', 'small', 'medium', 'medium']),
  Object.freeze(['small', 'small', 'medium', 'medium', 'full']),
  Object.freeze(['small', 'medium', 'medium', 'full', 'full']),
  Object.freeze(['medium', 'full', 'full', 'full', 'full']),
]);

/**
 * The stage each rep of a set wants (docs/PROGRESSIVE_FIELD.md §2), from the node's stars before the set: 0 stars small,
 * small, small, medium, medium; 1 star small, small, medium, medium, full; 2 stars small, medium, medium, full, full;
 * 3 stars medium, then full. The onboarding set (`first`) is all small; the quick "Who's open?" set takes the 1-star plan.
 * A set of another length takes the plan's steps in proportion (rep i of n: the plan's floor(i × 5 / n)), so it still
 * builds up.
 * @param {number} nodeStars  0-3 (clamped; not a number: 0)
 * @param {{ first?: boolean, count?: number }} [opts]
 * @returns {('small'|'medium'|'full')[]}
 */
export function stagePlan(nodeStars, { first = false, count = ROAD_DEFAULTS.reps } = {}) {
  const n = Number.isFinite(Number(count)) ? Math.max(0, Math.round(Number(count))) : ROAD_DEFAULTS.reps;
  if (first) return Array.from({ length: n }, () => 'small');
  const row = STAGE_PLANS[int(nodeStars, 0, ROAD_DEFAULTS.maxStars)];
  return Array.from({ length: n }, (_, i) => row[Math.min(row.length - 1, Math.floor((i * row.length) / n))]);
}

/**
 * The stage a rep is played at when it wants `wanted` (as cast.js bestStage picks it): `wanted`, else the next bigger
 * stage it can be played at. `caps` says which it can: { small, medium } false for a stage whose gate fails, true (or
 * unknown: null, or no caps at all) for one that passes; the full match always does.
 * @returns {'small'|'medium'|'full'}
 */
export function stageFor(caps, wanted) {
  let k = STAGES.indexOf(wanted);
  if (k < 0) return 'full';
  while (k < STAGES.length - 1 && caps?.[STAGES[k]] === false) k++;
  return STAGES[k];
}

/** How many stages bigger than `wanted` a rep with these caps is played at (stageFor). An unknown `wanted`: 0. */
export function stagePromotion(caps, wanted) {
  const k = STAGES.indexOf(wanted);
  return k < 0 ? 0 : STAGES.indexOf(stageFor(caps, wanted)) - k;
}

/**
 * Which rep plays which slot of a set (pure): the order that plays the reps at their slots' planned stages with the
 * fewest steps up (stagePromotion); among those, the one whose stages as played only grow (a small game, then a bigger
 * one: a rep that can only be played bigger goes later in the set, never first); then the one that moves the reps least
 * from the order the set was built in (so the recall rep stays first, and the builder's order is kept whenever nothing
 * is gained). Up to 7 reps every order is weighed; a longer set takes, slot by slot, the first rep left that needs the
 * fewest steps up.
 * @param {({ small?: boolean|null, medium?: boolean|null }|null)[]} caps  per rep, in the built order (null: unknown)
 * @param {string[]} plan  per slot (stagePlan); as long as caps
 * @returns {number[]} for each slot, the index (in the built order) of the rep that plays it
 */
export function assignStages(caps, plan) {
  const n = Math.min(caps?.length ?? 0, plan?.length ?? 0);
  const cost = (i, j) => stagePromotion(caps[i], plan[j]);
  const played = (i, j) => STAGES.indexOf(stageFor(caps[i], plan[j]));
  if (n > 7) {
    const left = Array.from({ length: n }, (_, i) => i);
    return Array.from({ length: n }, (_, j) => {
      let pick = 0;
      for (let k = 1; k < left.length; k++) if (cost(left[k], j) < cost(left[pick], j)) pick = k;
      return left.splice(pick, 1)[0];
    });
  }
  const worse = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; // > 0: a is worse than b
  let best = null, bestCost = [Infinity, Infinity, Infinity];
  const order = [], used = new Array(n).fill(false);
  const walk = (j, c, prev) => {
    if (worse(c, bestCost) >= 0) return; // every term only grows: no better order down here (the first found wins a tie)
    if (j === n) { best = [...order]; bestCost = c; return; }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const k = played(i, j);
      used[i] = true; order.push(i);
      walk(j + 1, [c[0] + cost(i, j), c[1] + (k < prev ? 1 : 0), c[2] + Math.abs(i - j)], k);
      used[i] = false; order.pop();
    }
  };
  walk(0, [0, 0, 0], 0);
  return best ?? [];
}

/**
 * Tally a set's stages (the sweep's report, pure): for each planned stage, how many slots wanted it and how many are
 * played at it. @param {{ stage: string, played?: string }[]} reps  played: the stage it plays at (stageFor)
 * @returns {{ small: { wanted, played }, medium: { wanted, played }, full: { wanted, played } }}
 */
export function stageTally(reps = []) {
  const out = Object.fromEntries(STAGES.map((s) => [s, { wanted: 0, played: 0 }]));
  for (const r of reps) {
    if (!out[r?.stage]) continue;
    out[r.stage].wanted++;
    if ((r.played ?? r.stage) === r.stage) out[r.stage].played++;
  }
  return out;
}

// ---------------------------------------------------------------- the road (pure)

/**
 * data/road.json → the road the helpers use: bad chapters and nodes dropped, ids unique, every node tagged with its
 * `chapter`, every mix node given its source chapter's principles and the kind of rep it plays (`repKind`), and each
 * group's lead chapter (`lead`: a chapter id, or null for the Road's own order).
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
  const lead = {};
  for (const g of GROUPS) {
    const id = str(r.lead?.[g]);
    lead[g] = chapters.some((c) => c.id === id) ? id : null;
  }
  // The quick "Who's open?" set's lessons: pass nodes, in turn (the first gets the odd rep).
  const passIds = new Set(chapters.flatMap((c) => c.nodes).filter((n) => n.kind === 'pass').map((n) => n.id));
  const quickPass = strings(r.quickPass).filter((id) => passIds.has(id));
  return { version: 1, groups, defaultRoles, lead, quickPass, matchday: { unlockAfter: seen.has(unlockAfter) ? unlockAfter : null }, chapters };
}

/** The chapters in the order Next up takes them for a position group: the group's lead chapter first, then the Road's. */
export function chapterOrder(road, group) {
  const chapters = road?.chapters ?? [];
  const lead = road?.lead?.[group];
  const first = lead ? chapters.filter((c) => c.id === lead) : [];
  return [...first, ...chapters.filter((c) => !first.includes(c))];
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
  return { version: 1, group: null, role: null, onboarded: false, road: {}, last: null };
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
      const stars = int(v.stars, 0, ROAD_DEFAULTS.maxStars), plays = int(v.plays, 0, 1e6), starts = int(v.starts, 0, 1e6);
      if (stars || plays || starts) p.road[id] = { stars, plays, ...(starts ? { starts } : {}) };
    }
  }
  if (isObj(raw.last) && ID_RE.test(str(raw.last.nodeId))) {
    p.last = { nodeId: str(raw.last.nodeId), ids: strings(raw.last.ids).slice(0, ROAD_DEFAULTS.lastIds) };
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
/** How many sets of a node have begun (startSet); older profiles only counted finished ones (plays). */
export const nodeAttempt = (profile, id) => Math.max(int(profile?.road?.[id]?.starts, 0, 1e6), nodePlays(profile, id));

/**
 * A node is open when it is the first on the Road, when the node before it has a star OR a finished set (any result:
 * finishing moves you on, stars stay the quality signal), when you have played it, or, for the first node of a chapter
 * with `opensAfter`, when that node has a star or a finished set ("Pass it right" opens after chapter 1's first node).
 */
export function isUnlocked(road, profile, nodeId, P = ROAD_DEFAULTS) {
  const nodes = roadNodes(road);
  const i = nodes.findIndex((n) => n.id === nodeId);
  if (i < 0) return false;
  if (i === 0 || nodeStars(profile, nodeId) > 0 || nodePlays(profile, nodeId) > 0) return true;
  const opens = (id) => nodeStars(profile, id) >= P.unlockStars || nodePlays(profile, id) > 0;
  if (opens(nodes[i - 1].id)) return true;
  const ch = chapterOf(road, nodeId);
  return !!(ch?.opensAfter && ch.nodes[0]?.id === nodeId && opens(ch.opensAfter));
}

/**
 * Next up (§3, as play-tested): in your group's chapter order (chapterOrder: the lead chapter first), the first open
 * node you have never played, so finishing a set always moves Play forward (replaying an old node is a Road tap, and
 * each set's recall rep keeps old ideas warm); then the first under nextStars (2) stars; then the first under 3;
 * with every open node at 3 stars, the last open one in the Road's order.
 */
export function nextNode(road, profile, P = ROAD_DEFAULTS) {
  const nodes = roadNodes(road);
  const open = new Set(nodes.filter((n) => isUnlocked(road, profile, n.id, P)));
  const group = GROUPS.includes(profile?.group) ? profile.group : groupOfRole(profile?.role, road?.groups);
  const order = chapterOrder(road, group).flatMap((c) => c.nodes ?? []).filter((n) => open.has(n));
  return order.find((n) => nodeStars(profile, n.id) === 0 && nodePlays(profile, n.id) === 0)
    ?? order.find((n) => nodeStars(profile, n.id) < P.nextStars)
    ?? order.find((n) => nodeStars(profile, n.id) < P.maxStars)
    ?? [...open].at(-1) ?? nodes[0] ?? null;
}

/** The node whose star opens Match day (road.json `matchday.unlockAfter`: chapter 1's Big Match), or null. */
export const matchdayGate = (road) => (road?.matchday?.unlockAfter ? nodeById(road, road.matchday.unlockAfter) : null);

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
  const next = { ...profile, road: { ...profile.road, [id]: { ...profile.road[id], stars: after, plays } } };
  const openBefore = new Set(road ? roadNodes(road).filter((n) => isUnlocked(road, profile, n.id)).map((n) => n.id) : []);
  const matchBefore = road ? isMatchdayUnlocked(road, profile) : false;
  saveProfile(app, next);
  const unlocked = road ? roadNodes(road).filter((n) => !openBefore.has(n.id) && isUnlocked(road, next, n.id)).map((n) => n.id) : [];
  return { before, after, setStars, plays, unlocked, matchday: road ? !matchBefore && isMatchdayUnlocked(road, next) : false };
}

/**
 * A set of a node begins: its start counter goes up (the next set's seed takes it in, so a reload or a quit in the
 * middle deals fresh reps rather than the ones you have seen) and its reps become the profile's last set (the next
 * set deals them only when nothing else is left, and its recall rep never repeats one). buildSet calls it when it is
 * given the app. The onboarding set ('first'; buildFirstSet calls it) is not a Road node: nothing is counted, but its
 * reps become the last set too, so the first node's set, a minute after the tutorial, does not deal the tutorial's
 * drills again (the worked example's answer was just shown; play-test: 2 of the 3 came straight back for a defender
 * and a striker). Ids the loaded road does not know are not counted.
 * @returns {number} the attempt this set was (0 for a node's first), or -1 when nothing was counted
 */
export function startSet(app, nodeId, reps = []) {
  const id = String(nodeId ?? '');
  const loaded = app?.data?.road ?? bound.app?.data?.road ?? null;
  const road = loaded?.chapters?.length ? loaded : null;
  const ids = [...new Set((Array.isArray(reps) ? reps : []).map(repId).filter(Boolean))].slice(0, ROAD_DEFAULTS.lastIds);
  if (id === FIRST_SET) {
    if (ids.length) saveProfile(app, { ...loadProfile(app), last: { nodeId: FIRST_SET, ids } });
    return -1;
  }
  if (!ID_RE.test(id) || (road && !nodeById(road, id))) return -1;
  const profile = loadProfile(app);
  const attempt = nodeAttempt(profile, id);
  const rec = { stars: nodeStars(profile, id), plays: nodePlays(profile, id), starts: attempt + 1 };
  // The onboarding set's reps stay in the last set through the first Road set too: the set after it (the next node's,
  // or this one begun again) does not bring the tutorial back either (its recall rep was the worked example).
  const carry = profile.last?.nodeId === FIRST_SET ? profile.last.ids : [];
  const kept = [...new Set([...ids, ...carry])].slice(0, ROAD_DEFAULTS.lastIds);
  saveProfile(app, { ...profile, road: { ...profile.road, [id]: rec }, last: { nodeId: id, ids: kept } });
  return attempt;
}

/** A rep's drill id as a set remembers it (an authored drill and its mirror are one). */
function repId(rep) {
  const id = rep?.kind === 'pass' ? rep?.drill?.id : rep?.scenario?.id;
  return typeof id === 'string' && id ? baseId(id) : null;
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

const engines = {}; // kind → Promise<module|null>: the lazily imported generator modules (and the stager, cast.js)
const ENGINE = Object.freeze({ spot: '../../engine/spotdrill.js', pass: '../../engine/passdrill.js', cast: '../../engine/cast.js' });
const GENERATOR = Object.freeze({ spot: 'generateSpotDrill', pass: 'generatePassDrill' });

function engineModule(kind) {
  if (!engines[kind]) {
    const p = import(ENGINE[kind]).catch(() => null);
    engines[kind] = p;
    p.then((m) => { if (!m && engines[kind] === p) delete engines[kind]; }); // not there (yet): look again next time
  }
  return engines[kind];
}

/** The generator of a kind: the caller's (opts.generators: { spot, pass }; null = none), else the engine's. */
async function generatorFor(ctx, kind) {
  if (ctx.generators !== undefined) {
    const f = ctx.generators?.[kind];
    return typeof f === 'function' ? f : null;
  }
  const f = (await engineModule(kind))?.[GENERATOR[kind]];
  return typeof f === 'function' ? f : null;
}

/**
 * Whether pass drills on these ideas should hold forward bests for this position (passdrill.js passForwardable: not
 * for PA13 alone, nor PA10 unless a centre-back). Injected generators may bring their own `forwardable`; else yes.
 */
async function forwardableFor(ctx) {
  const f = ctx.generators !== undefined ? ctx.generators?.forwardable : (await engineModule('pass'))?.passForwardable;
  return (principles, role) => {
    if (typeof f !== 'function') return true;
    try { return !!f(principles, role); } catch { return false; }
  };
}

/** The engine's up-front feasibility helper of a kind (spotdrill.js canGenerateSpot, passdrill.js canGeneratePass). */
const FEASIBLE = Object.freeze({ spot: 'canGenerateSpot', pass: 'canGeneratePass' });

/**
 * Whether the generator can make a drill of a kind for a position on some of these ideas (in that direction, for a
 * pass), as the engine measured up front (spotdrill.js canGenerateSpot(role, principles), passdrill.js
 * canGeneratePass(role, principles, { direction })), so a set never waits on calls known to fail: a left back on "Find
 * the Free Side" once took 1-2 s of empty calls. Injected generators may bring `canGenerate(kind, role, principles,
 * direction)`. No helper: yes (the generator is asked, and an ask that comes back empty twice is dropped).
 * @returns {Promise<(kind: 'spot'|'pass', role: string, principles: string[], direction?: string) => boolean>}
 */
async function feasibleFor(ctx) {
  if (ctx.generators !== undefined) {
    const f = ctx.generators?.canGenerate;
    return (kind, role, principles, direction = 'any') => {
      if (typeof f !== 'function') return true;
      try { return f(kind, role, [...principles], direction) !== false; } catch { return true; }
    };
  }
  const [spot, pass] = await Promise.all([engineModule('spot'), engineModule('pass')]);
  const helpers = { spot: spot?.[FEASIBLE.spot], pass: pass?.[FEASIBLE.pass] };
  return (kind, role, principles, direction = 'any') => {
    const f = helpers[kind];
    if (typeof f !== 'function' || !principles?.length) return true;
    try { return f(role, [...principles], kind === 'pass' ? { direction } : undefined) !== false; } catch { return true; }
  };
}

// ---------------------------------------------------------------- what a rep can be played at (js/engine/cast.js)

/** Every stage of a drill (cast.js stagesOf: { small, medium, full }), per drill object and the formations it was staged with. */
const STAGED = new WeakMap();

const stageItem = (rep) => (rep?.kind === 'pass' ? rep.drill : rep?.scenario) ?? null;

function stagesFor(rep, cast, { formations, catalogue }) {
  const item = stageItem(rep);
  if (!isObj(item)) return null;
  const had = STAGED.get(item);
  if (had && had.formations === formations && had.catalogue === catalogue) return had.all;
  let all = null;
  try { all = cast.stagesOf(item, { formations, ...(catalogue ? { principles: catalogue } : {}) }); } catch { all = null; }
  STAGED.set(item, { formations, catalogue, all });
  return all;
}

/**
 * The set's stager: rep → { small, medium } (can it be played in a small game, in the bigger game?), or null when that
 * is unknown. The caller's (opts.stager, the same shape; null: none), else js/engine/cast.js stagesOf with the set's
 * formations and catalogue (imported when first needed; no formations: unknown), cached per drill.
 * @returns {Promise<(rep) => ({ small: boolean, medium: boolean } | null)>}
 */
async function stagerFor(opts, ctx) {
  if (opts.stager !== undefined) {
    const f = opts.stager;
    return (rep) => {
      if (typeof f !== 'function') return null;
      try { return f(rep) ?? null; } catch { return null; }
    };
  }
  if (!ctx.formations?.us) return () => null;
  const cast = await engineModule('cast');
  if (typeof cast?.stagesOf !== 'function') return () => null;
  return (rep) => {
    const all = stagesFor(rep, cast, ctx);
    return all ? { small: !!all.small, medium: !!all.medium } : null;
  };
}

/**
 * A rep staged at `wanted` as js/engine/cast.js bestStage stages it (`wanted`, else the next bigger stage that passes,
 * with `wanted` on the result), from the stages its set's builder worked out already; null when the builder staged it
 * with other formations or not at all (stage it with bestStage then). Saves the screens staging a rep twice.
 * @param {object} rep  a rep of buildSet, buildQuickPassSet or buildFirstSet
 * @param {'small'|'medium'|'full'} wanted
 * @param {{ formations?: object }} [opts]
 */
export function stagedRep(rep, wanted, { formations } = {}) {
  const item = stageItem(rep);
  const had = isObj(item) ? STAGED.get(item) : null;
  if (!had?.all || (formations && had.formations !== formations)) return null;
  const from = STAGES.includes(wanted) ? STAGES.indexOf(wanted) : STAGES.length - 1;
  for (const s of STAGES.slice(from)) if (had.all[s]) return { ...had.all[s], wanted: STAGES[from] };
  return null;
}

/**
 * A built set at its planned stages (PROGRESSIVE_FIELD §2): the order that plays the most reps at their slot's stage
 * (assignStages on what each rep can be played at), each rep tagged with its slot's `stage` (the stage it wants; the
 * screens stage it with cast.js bestStage, which plays it bigger only when that stage cannot teach it).
 */
function planSet(reps, plan, stager) {
  const caps = reps.map((r) => stager(r));
  return assignStages(caps, plan).map((i, j) => ({ ...reps[i], stage: plan[j] }));
}

/**
 * What a set still needs to play its plan (PROGRESSIVE_FIELD §2: small slots are not all quietly played bigger): how
 * many reps that can be played small it lacks, and how many that can be played small or in the bigger game. A
 * candidate `helps` when it can be played at a stage still short. Unknown caps (no stager) never ask for more.
 */
function stageNeeds(plan, stager) {
  const need = { small: plan.filter((s) => s === 'small').length, medium: plan.filter((s) => s !== 'full').length };
  const have = { small: 0, medium: 0 };
  return {
    /** Can this rep be played at the smallest stage the set is still short of (small first, then small or the bigger
     *  game)? true when that is unknown, or when nothing is short. */
    helps(rep) {
      if (!this.short()) return true;
      const c = stager(rep);
      if (!c) return true;
      if (have.small < need.small) return c.small !== false;
      return c.small !== false || c.medium !== false;
    },
    short() { return have.small < need.small || have.medium < need.medium; },
    take(rep) {
      const c = stager(rep);
      if (!c || c.small !== false) have.small++;
      if (!c || c.small !== false || c.medium !== false) have.medium++;
    },
  };
}

/** The set's stager, what its plan still needs, and the extra generator calls it may make for that (ctx.stager, ctx.needs). */
async function withStages(ctx, opts, plan) {
  ctx.stager = await stagerFor(opts, ctx);
  ctx.needs = stageNeeds(plan, ctx.stager);
  ctx.stageBudget = ROAD_DEFAULTS.stageBudget;
  return ctx;
}

/** A breath for the page between generator calls (each takes 5-200 ms), so the loading screen stays alive. */
const breathe = () => new Promise((r) => setTimeout(r, 0));

const isScenario = (s) => isObj(s) && isObj(s.timeline) && isObj(s.learner);
/** An authored scenario's id without the mirror suffix: a drill and its mirror are one drill in a set. */
const baseId = (id) => String(id ?? '').replace(/-m$/, '');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isPt = (p) => isObj(p) && Number.isFinite(p.x) && Number.isFinite(p.y);

/** Where the ball is at a scenario's freeze (its ball keys, linear between them). */
export function ballAtFreeze(s) {
  const keys = (s?.timeline?.ball ?? []).filter((k) => isPt(k) && Number.isFinite(k.t));
  if (!keys.length) return null;
  const last = keys.at(-1).t;
  const t = Number.isFinite(s.timeline.freezeAt) ? s.timeline.freezeAt : Number.isFinite(s.timeline.duration) ? s.timeline.duration : last;
  let a = keys[0];
  for (const b of keys) {
    if (b.t >= t) {
      const u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
    a = b;
  }
  return { x: a.x, y: a.y };
}

/**
 * A rep's picture, for telling near-duplicates apart: the position played, the ball at the freeze, and for a spot rep
 * where you start, for a pass rep the best pass's receiver. null when it cannot be read.
 */
export function repPicture(rep) {
  if (rep?.kind === 'pass') {
    const d = rep.drill;
    const ball = isPt(d?.rating?.ball) ? d.rating.ball : ballAtFreeze(d);
    return ball ? { kind: 'pass', role: d?.learner?.role ?? null, ball, best: d?.rating?.best?.targetId ?? d?.answer?.best ?? null } : null;
  }
  const s = rep?.scenario;
  const ball = ballAtFreeze(s);
  return ball ? { kind: 'spot', role: s?.learner?.role ?? null, ball, start: isPt(s?.learner?.start) ? s.learner.start : null } : null;
}

/**
 * Two reps that would look the same to a player (ROAD_DEFAULTS.nearSpot): the same position and the ball within a few
 * metres at the freeze, and you starting in the same place (spot) or the same best pass (pass). A pass received in
 * almost the same place (within 40 % of that) is the same rep whatever the best pass.
 */
export function nearDuplicate(a, b, P = ROAD_DEFAULTS) {
  if (!a || !b || a.kind !== b.kind || a.role !== b.role) return false;
  const d = dist(a.ball, b.ball);
  if (d > P.nearSpot) return false;
  if (a.kind === 'pass') return d <= 0.4 * P.nearSpot || (!!a.best && a.best === b.best);
  return !a.start || !b.start || dist(a.start, b.start) <= P.nearSpot;
}

/** Template ids that name no template (a plain scene): any number of them may share a set. */
const PLAIN_TEMPLATES = new Set(['natural', 'scene', 'none', 'plain']);
/** The hand-shaped scenes of passdrill.js (source.template), which look alike from drill to drill; its other
 *  source.template values ('marked', 'free') vary a random scene, so they do not. */
const HAND_SHAPED = new Set(['switch', 'own-goal']);

/**
 * What makes two generated reps look alike though their pictures differ (repPicture): the engine template they came
 * from (drill.template, the engine's own id for it; else a hand-shaped source.template such as the switch of play) and,
 * for a spot rep, the player on the ball at the freeze (the question names them: "Their winger has the ball. Where do
 * you go?"). A set holds one generated rep per key. Authored reps have none.
 * @returns {string[]}
 */
export function repLooks(rep) {
  const d = rep?.kind === 'pass' ? rep.drill : rep?.scenario;
  if (!isObj(d) || d.source?.kind !== 'generated') return [];
  const keys = [];
  const own = typeof d.template === 'string' && d.template ? d.template : null;
  const t = own ?? (HAND_SHAPED.has(d.source?.template) ? d.source.template : null);
  if (t && !PLAIN_TEMPLATES.has(t)) keys.push(`${rep.kind}|template|${t}`);
  if (rep.kind === 'spot') {
    const holder = carrierAtFreeze(d);
    if (holder) keys.push(`spot|carrier|${holder}`);
  }
  return keys;
}

/** Who has the ball at a scenario's freeze (its carrier keys), or null. */
export function carrierAtFreeze(s) {
  const tl = s?.timeline;
  const t = Number.isFinite(tl?.freezeAt) ? tl.freezeAt : Number.isFinite(tl?.duration) ? tl.duration : Infinity;
  let id = null;
  for (const k of Array.isArray(tl?.carrier) ? tl.carrier : []) {
    if (isObj(k) && Number.isFinite(k.t) && k.t <= t + 1e-9) id = typeof k.id === 'string' && k.id ? k.id : null;
  }
  return id;
}

/**
 * What a set has taken so far: the drills used (an authored drill and its mirror count once), the pictures of its
 * reps (no near-duplicates), the looks of its generated reps (repLooks: one each), how many reps it lent to another
 * position (at most maxBorrowed), and how often each generator ask came back empty or gave a drill: an ask that came
 * back empty generatorNulls times more often than it gave one is not asked again (each call already tries 30-40
 * scenes, so that position rarely gets those ideas).
 */
function setState(needs = null) {
  const nulls = new Map(), hits = new Map();
  const add = (m, key) => m.set(key, (m.get(key) ?? 0) + 1);
  return {
    used: new Set(),
    pictures: [],
    looks: new Set(),
    borrowed: 0,
    lifted: false,
    dry: (key) => (nulls.get(key) ?? 0) - (hits.get(key) ?? 0) >= ROAD_DEFAULTS.generatorNulls,
    empty: (key) => add(nulls, key),
    hit: (key) => add(hits, key),
    /** Room for one more rep played in another position (always, once the set has run out of anything else). */
    canBorrow() { return this.lifted || this.borrowed < ROAD_DEFAULTS.maxBorrowed; },
    /** How a rep in another position is flagged: `borrowed`, and `spare` past maxBorrowed (nothing else was left). */
    lend() { return this.borrowed >= ROAD_DEFAULTS.maxBorrowed ? { borrowed: true, spare: true } : { borrowed: true }; },
    /** Out of reps in your position: a set short of reps may lend more than maxBorrowed rather than repeat one. */
    lift() { this.lifted = true; },
    fresh(rep) {
      const pic = repPicture(rep);
      if (pic && this.pictures.some((p) => nearDuplicate(p, pic))) return false;
      return repLooks(rep).every((k) => !this.looks.has(k));
    },
    /** The templates the set's generated reps of a kind came from (for a spot rep: the question it asks). */
    templates(kind) {
      const pre = `${kind}|template|`;
      return [...this.looks].filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length));
    },
    take(id, rep) {
      this.used.add(id);
      needs?.take(rep);
      const pic = repPicture(rep);
      if (pic) this.pictures.push(pic);
      for (const k of repLooks(rep)) this.looks.add(k);
      if (rep?.borrowed) this.borrowed++;
    },
  };
}

/** A same-origin loader for scenario files (when neither the caller nor the bound app gives one). */
function fetchScenarios(index) {
  return async (id) => {
    const file = index.find((e) => e?.id === id)?.file ?? `${id}.json`;
    const res = await fetch(new URL(`../../../data/scenarios/${file}`, import.meta.url).href);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
}

/** Teammates in your position group, the likeliest to suit a lesson your own position rarely gets first: another
 *  family on your side, then another family, then your own family on the other side (LB → LCB, RCB, RB). */
function groupMates(role, families) {
  const fam = familyOf(role), side = sideOf(role);
  return LEARNABLE_ROLES.filter((r) => r !== role && families.includes(familyOf(r)))
    .map((r, i) => ({ r, rank: [familyOf(r) === fam ? 1 : 0, sideOf(r) === side ? 0 : 1, i] }))
    .sort((a, b) => cmp(a.rank, b.rank)).map((x) => x.r);
}

/** The groups next to each on the pitch, nearest first: who lends a hand when your group rarely gets a pass lesson
 *  (a striker's forward pass is a winger's). */
export const NEIGHBOUR_GROUPS = Object.freeze({
  DEF: Object.freeze(['MID']), MID: Object.freeze(['DEF', 'WING']), WING: Object.freeze(['STRIKER', 'MID']), STRIKER: Object.freeze(['WING', 'MID']),
});

/** Positions in the neighbouring groups, nearest group first, your side first within a group. */
function neighbourRoles(role, group, road) {
  return (NEIGHBOUR_GROUPS[group] ?? []).flatMap((g) => groupMates(role, road?.groups?.[g] ?? GROUP_FAMILIES[g]));
}

function setContext(opts, road) {
  const app = opts.app ?? bound.app;
  const store = app?.data?.scenarios;
  const profile = normalizeProfile(opts.profile ?? (app ? loadProfile(app) : null));
  const group = profile.group ?? groupOfRole(profile.role) ?? 'MID';
  const role = profile.role ?? road?.defaultRoles?.[group] ?? DEFAULT_ROLE[group];
  const families = road?.groups?.[group] ?? GROUP_FAMILIES[group];
  const index = Array.isArray(opts.index) ? opts.index : Array.isArray(opts.index?.index) ? opts.index.index : Array.isArray(store?.index) ? store.index : [];
  const load = typeof opts.load === 'function' ? opts.load
    : typeof opts.index?.load === 'function' ? (id) => opts.index.load(id)
      : typeof store?.load === 'function' ? (id) => store.load(id) : fetchScenarios(index);
  const catalogue = [opts.catalogue, opts.principles, app?.data?.principles].find((c) => c && typeof c === 'object' && (Array.isArray(c) || Object.keys(c).length)) ?? null;
  return {
    road, profile: { ...profile, group, role }, group, role, families, mates: groupMates(role, families), neighbours: neighbourRoles(role, group, road),
    index, load, catalogue,
    rewards: isObj(opts.rewards) ? opts.rewards : null,
    seed: opts.seed ?? 0,
    formations: opts.formations ?? app?.data?.formations ?? null,
    generators: opts.generators,
    feasible: feasibleFor({ generators: opts.generators }), // Promise<(kind, role, principles, direction?) => boolean>
    reps: Math.max(1, int(opts.count ?? ROAD_DEFAULTS.reps, 1, 50)),
  };
}

const seedFor = (ctx, ...parts) => hash32([ctx.seed, ...parts].join('|'));
const sidesDiffer = (a, b) => { const x = sideOf(a), y = sideOf(b); return !!x && !!y && x !== 'C' && y !== 'C' && x !== y; };

/**
 * Authored scenarios on these principles, best first: played in your role (after mirroring) before other roles, the
 * principle as the scenario's main one before a side one, fresh or low-star ones before ones you aced, then seeded.
 * @returns {{ id: string, mirror: boolean, role: string, inGroup: boolean, principles: string[], rank: any[] }[]}
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
    out.push({ id: e.id, mirror, role, inGroup: ctx.families.includes(familyOf(authored)), principles: ps, rank });
  }
  return out.sort((a, b) => cmp(a.rank, b.rank));
}

async function loadRef(ref, ctx) {
  // One object per drill a set looks at (a rep it passes over for its stage may be taken later: staged once, cached).
  const key = `${ref.id}|${ref.mirror ? 'm' : ''}`;
  ctx.loaded ??= new Map();
  if (!ctx.loaded.has(key)) ctx.loaded.set(key, (async () => {
    try {
      const s = await ctx.load(ref.id);
      if (!isScenario(s)) return null;
      return { kind: 'spot', scenario: ref.mirror ? mirrorScenario(s) : s, mirrored: ref.mirror };
    } catch (err) {
      console.warn(`[fotbol] road: scenario ${ref.id} did not load (${err?.message ?? err})`);
      return null;
    }
  })());
  return ctx.loaded.get(key);
}

/**
 * Stage preference (PROGRESSIVE_FIELD §2): while the set is short of reps its plan can play small (or in the bigger
 * game), a candidate that cannot help is kept as the fallback and up to stageLook more are looked at; the first that
 * helps is taken, else the fallback. `extra()` says whether one more candidate may be looked at (and counts it).
 */
function stagePick(ctx, { generated = false } = {}) {
  let fallback = null, looked = 0;
  return {
    /** A fresh candidate: true when it is the one (it helps, or the set needs nothing); false to keep looking. */
    offer(id, rep) {
      if (!ctx.needs || ctx.needs.helps(rep)) return true;
      fallback ??= { id, rep };
      return false;
    },
    /** Another look allowed? Only after a candidate was passed over, up to stageLook (and, generated, the set's budget). */
    more() {
      if (!fallback) return true;
      if (looked >= ROAD_DEFAULTS.stageLook || (generated && !(ctx.stageBudget > 0))) return false;
      looked++;
      if (generated) ctx.stageBudget--;
      return true;
    },
    get fallback() { return fallback; },
  };
}

/**
 * The spot reps one list of ideas can give, in order: authored in your position (mirrored to your side), authored in
 * another position of your group, generated for your position, authored in other positions; the drills of your last
 * set come only after all of those, in the same order (a set begun again after a reload, or played again, is fresh
 * where the content allows). A rep in another position is `borrowed` and a set takes at most maxBorrowed of them.
 * `set` (shared by a set) keeps each drill to one rep and generated reps apart (no near-duplicates, one per look:
 * repLooks).
 * @param {{ id: string, principles: string[] }} target  a node, or ideas standing in for one
 * @param {{ nodeId?: string, extra?: boolean, skip?: Set<string>, avoid?: Set<string> }} [tag]  nodeId: the node the reps
 *   count for (default target.id); extra: from the chapter's other ideas; skip: drill ids never to take (the last set's,
 *   for a recall rep); avoid: ideas a rep must not be about (the node you are on, for a recall rep)
 */
function spotQueue(target, ctx, set, salt, { nodeId = target.id, extra = false, skip = null, avoid = null } = {}) {
  const refs = authoredRefs(ctx.index, target.principles, ctx, `${salt}|${target.id}`)
    .filter((r) => !skip?.has(baseId(r.id)) && !(avoid && r.principles.some((p) => avoid.has(p))));
  const last = new Set(ctx.profile?.last?.ids ?? []);
  const byTier = (list) => [list.filter((r) => r.role === ctx.role), list.filter((r) => r.role !== ctx.role && r.inGroup), list.filter((r) => r.role !== ctx.role && !r.inGroup)];
  const [own, group, others] = byTier(refs.filter((r) => !last.has(baseId(r.id))));
  const again = byTier(refs.filter((r) => last.has(baseId(r.id)))).flat();
  const key = `spot|${ctx.role}|${target.principles.join(',')}`;
  const tag = (rep) => ({ ...rep, nodeId, ...(extra ? { extra: true } : {}) });
  let tries = 0;
  const maxTries = ctx.reps * ROAD_DEFAULTS.generatorTries;
  const fromRefs = async (list) => {
    const pick = stagePick(ctx);
    let chosen = null;
    for (const ref of list) {
      const id = baseId(ref.id);
      if (set.used.has(id)) continue;
      const borrowed = ref.role !== ctx.role;
      if (borrowed && !set.canBorrow()) break;
      if (!pick.more()) break;
      const rep = await loadRef(ref, ctx);
      if (!rep) { set.used.add(id); continue; } // (it did not load: never asked again)
      const r = borrowed ? { ...rep, ...set.lend() } : rep;
      if (pick.offer(id, r)) { chosen = { id, rep: r }; break; }
    }
    chosen ??= pick.fallback;
    if (!chosen) return null;
    set.take(chosen.id, chosen.rep);
    return tag(chosen.rep);
  };
  const generated = async () => {
    const gen = await generatorFor(ctx, 'spot');
    if (!gen || !(await ctx.feasible)('spot', ctx.role, target.principles)) return null;
    const pick = stagePick(ctx, { generated: true });
    let chosen = null;
    while (tries < maxTries && !set.dry(key) && pick.more()) {
      const seed = seedFor(ctx, target.id, salt, 'gen', tries++);
      // The questions the set asks already: the engine words the drill with another question that fits it
      // (spotdrill.js avoidTemplates changes only the words), so a good drill is not dropped and regenerated for
      // its question. Only a drill no other question fits is still turned away (set.fresh).
      const avoidTemplates = set.templates('spot');
      let s = null;
      try {
        s = await gen({ seed, role: ctx.role, principles: [...target.principles], formations: ctx.formations, catalogue: ctx.catalogue, ...(avoidTemplates.length ? { avoidTemplates } : {}) });
      } catch (err) {
        console.warn('[fotbol] road: spot drill generation failed', err?.message ?? err);
      }
      await breathe();
      if (!isScenario(s)) { set.empty(key); continue; }
      set.hit(key);
      const id = String(s.id ?? `gen-${seed}`);
      const rep = { kind: 'spot', scenario: s, mirrored: false, generated: true };
      if (set.used.has(id) || skip?.has(id) || !set.fresh(rep)) continue;
      if (pick.offer(id, rep)) { chosen = { id, rep }; break; }
    }
    chosen ??= pick.fallback;
    if (!chosen) return null;
    set.take(chosen.id, chosen.rep);
    return tag(chosen.rep);
  };
  return {
    async next() {
      return (await fromRefs(own)) ?? (await fromRefs(group)) ?? (await generated()) ?? (await fromRefs(others)) ?? (ctx.holdLast ? null : await fromRefs(again));
    },
  };
}

/**
 * Still short (never on the Road: tests/road-sets-*.test.js sweeps every node and position): the mirrored twins of the set's
 * authored reps (the same idea on the other side), then repeats.
 */
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

/** The chapter nodes a mix node (or the quick set: its `parts`) draws from (of one rep kind). */
function mixParts(road, node, kind) {
  if (node.parts?.length) return node.parts;
  const src = (road?.chapters ?? []).find((c) => c.id === node.from) ?? chapterOf(road, node.id);
  const parts = (src?.nodes ?? []).filter((x) => x.kind !== 'mix' && repKind(road, x) === kind && x.principles?.length);
  return parts.length ? parts : [node];
}

/** The ideas of a node's chapter (for a mix node: its source chapter; the quick set: its parts') of one rep kind, the
 *  node's own left out. */
function chapterIdeas(road, node, kind) {
  const own = new Set(node.principles ?? []);
  const chapter = node.parts?.length ? chapterOf(road, node.parts[0].id) : null;
  const nodes = chapter ? chapter.nodes.filter((x) => x.kind !== 'mix' && repKind(road, x) === kind) : mixParts(road, node, kind);
  return [...new Set(nodes.flatMap((x) => x.principles ?? []))].filter((p) => !own.has(p));
}

/**
 * Where a set's recall rep may come from (R23): the spot nodes you have played other than this one, on none of its
 * ideas; another node than your last set's when there is one (a recall is spaced, not a replay of five minutes ago).
 */
export function recallSources(road, profile, node) {
  const own = new Set(node?.principles ?? []);
  const played = roadNodes(road).filter((n) => n.id !== node?.id && n.kind === 'spot'
    && (nodePlays(profile, n.id) > 0 || nodeStars(profile, n.id) > 0) && !n.principles.some((p) => own.has(p)));
  const fresh = played.filter((n) => n.id !== profile?.last?.nodeId);
  return fresh.length ? fresh : played;
}

async function spotSet(node, ctx) {
  const n = ctx.reps;
  const rng = seededRandom(`${ctx.seed}|${node.id}|order`);
  const set = setState(ctx.needs);
  const out = [];
  // Right after the onboarding set (your last set), its drills wait longer than a Road set's: behind the chapter's
  // other ideas and more reps in other positions too (a defender's first set once dealt the tutorial's left-back drill
  // again at rep 5, as the left back's own drills on the idea are the two the tutorial had just used).
  ctx.holdLast = ctx.profile.last?.nodeId === FIRST_SET;
  if (node.kind !== 'mix' && ROAD_DEFAULTS.recall > 0 && n > 1) {
    // One recall rep: from another node you have played (never on this node's ideas), never a rep of your last set.
    const sources = recallSources(ctx.road, ctx.profile, node);
    const skip = new Set(ctx.profile.last?.ids ?? []);
    const avoid = new Set(node.principles);
    const first = Math.floor(rng() * sources.length);
    for (let k = 0; k < sources.length; k++) {
      const rep = await spotQueue(sources[(first + k) % sources.length], ctx, set, 'recall', { skip, avoid }).next();
      if (rep) { out.push({ ...rep, recall: true }); break; }
    }
  }
  const targets = node.kind === 'mix' ? mixParts(ctx.road, node, 'spot') : [node];
  const queues = targets.map((t) => spotQueue(t, ctx, set, 'set'));
  const start = Math.floor(rng() * queues.length);
  const fill = async (qs, from = 0) => {
    for (let turn = 0; out.length < n; turn++) {
      let rep = null;
      for (let j = 0; j < qs.length && !rep; j++) rep = await qs[(from + turn + j) % qs.length].next();
      if (!rep) break;
      out.push(rep);
    }
  };
  await fill(queues, start);
  // Thin for your position (few drills on these ideas, and ones the generator cannot make for it): the chapter's
  // other ideas; then, still short, more reps in other positions than maxBorrowed; only then a drill mirrored or twice.
  const rest = out.length < n ? chapterIdeas(ctx.road, node, 'spot') : [];
  const chapter = rest.length ? [spotQueue({ id: `${node.id}+chapter`, principles: rest }, ctx, set, 'chapter', { nodeId: node.id, extra: true })] : [];
  await fill(chapter);
  if (out.length < n) {
    set.lift();
    await fill(queues, start);
    await fill(chapter);
  }
  if (out.length < n && ctx.holdLast) {
    ctx.holdLast = false;
    await fill(queues, start);
    await fill(chapter);
  }
  return fillUp(out, n);
}

/**
 * Which of `slots` want a forward best: `count` of the slots whose ideas allow one (`ok`), spread through the set
 * (research/passing.md §6.4: 3 of 5, against the "always pass back" trap; passdrill.js generatePassSet does the same).
 * @returns {Set<number>}
 */
export function forwardPlan(ok, count = ROAD_DEFAULTS.forwardPasses) {
  const idx = ok.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  if (idx.length <= count) return new Set(idx);
  return new Set(Array.from({ length: count }, (_, k) => idx[Math.floor(((k + 0.5) * idx.length) / count)]));
}

/** The best pass's receiver as a role ('us-ST@space' → 'ST'), or null. */
export const bestReceiver = (drill) => String(drill?.rating?.best?.targetId ?? '').replace(/^(us|them)-/, '').replace(/@.*$/, '') || null;

/** Receivers already starred ROAD_DEFAULTS.maxSameBest times in these pass reps (sorted, for stable generator seeds). */
export function avoidReceivers(reps, max = ROAD_DEFAULTS.maxSameBest) {
  const n = new Map();
  for (const r of reps) {
    const role = r?.kind === 'pass' ? bestReceiver(r.drill) : null;
    if (role) n.set(role, (n.get(role) ?? 0) + 1);
  }
  return [...n].filter(([, c]) => c >= max).map(([role]) => role).sort();
}

async function passSet(node, ctx) {
  const n = ctx.reps;
  const out = [];
  const set = setState(ctx.needs);
  const targets = node.kind === 'mix' || node.parts?.length ? mixParts(ctx.road, node, 'pass') : [node];
  const want = new Set(targets.flatMap((t) => t.principles));
  const rng = seededRandom(`${ctx.seed}|${node.id}|pass`);
  const authored = ctx.index
    .filter((e) => isObj(e) && e.kind === 'pass' && typeof e.id === 'string' && (e.principles ?? []).some((p) => want.has(p)))
    .map((e) => ({ e, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.e);
  for (const e of authored) {
    if (out.length >= n) break;
    try {
      const drill = await ctx.load(e.id);
      if (isObj(drill)) {
        const rep = { kind: 'pass', drill, nodeId: node.id };
        set.take(e.id, rep);
        out.push(rep);
      }
    } catch (err) { console.warn(`[fotbol] road: pass drill ${e.id} did not load (${err?.message ?? err})`); }
  }
  const gen = await generatorFor(ctx, 'pass');
  if (!gen || out.length >= n) return out;
  // The plan: the idea of each rep (a mix takes its nodes in turn) and which want a forward best (3 of 5 where the
  // ideas allow it). Seeds are consecutive integers from the set's seed, as generatePassSet uses them.
  const forwardable = await forwardableFor(ctx);
  const start = node.parts?.length ? 0 : Math.floor(rng() * targets.length); // the quick set: its first lesson leads
  const slots = Array.from({ length: n - out.length }, (_, i) => targets[(start + i) % targets.length]);
  const forward = forwardPlan(slots.map((t) => forwardable(t.principles, ctx.role)));
  const base = seedFor(ctx, node.id, 'pass');
  const others = chapterIdeas(ctx.road, node, 'pass');
  const anyone = LEARNABLE_ROLES.filter((r) => r !== ctx.role && !ctx.mates.includes(r) && !ctx.neighbours.includes(r));
  const feasible = await ctx.feasible;
  const T = ROAD_DEFAULTS.generatorTries;
  const got = new Array(slots.length).fill(null);
  const slot = async (i, t) => {
    const dir = forward.has(i) ? 'forward' : 'any';
    // Your position on the idea; then a teammate in your group (a full-back's "free side" is a centre-back's switch),
    // then one in the groups next to yours (a striker's forward pass is a winger's); a forward slot then takes any
    // pass from you or your group; then another passing idea of the chapter for you (forward first in a forward slot);
    // last, anyone on the idea. A teammate plays at most maxBorrowed reps of a set, and nobody is asked for what the
    // engine says it cannot make.
    const on = (roles, direction, principles = t.principles) => roles.map((r) => [r, principles, direction]);
    // No receiver is starred in more than maxSameBest reps of a set (a winger's forward passes would all be to the #9):
    // the generator marks those receivers out of the picture, so a winger's third forward slot falls back to 'any'.
    const avoid = avoidReceivers([...out, ...got.filter(Boolean)]);
    const asks = [
      ...on([ctx.role, ...ctx.mates, ...ctx.neighbours], dir),
      ...(dir === 'forward' ? on([ctx.role, ...ctx.mates], 'any') : []),
      ...(others.length ? [...(dir === 'forward' ? on([ctx.role], 'forward', others) : []), ...on([ctx.role], 'any', others)] : []),
      ...on(anyone, 'any'),
    ];
    let rep = null;
    for (const [role, principles, direction] of asks) {
      if (role !== ctx.role && !set.canBorrow()) continue;
      if (!feasible('pass', role, principles, direction)) continue;
      const key = `pass|${role}|${principles.join(',')}|${direction}|${avoid.join(',')}`;
      const pick = stagePick(ctx, { generated: true }); // (a drill the plan cannot use: a few more seeds, then it)
      let chosen = null;
      for (let k = 0; !chosen && !set.dry(key) && (pick.fallback ? pick.more() : k < T); k++) {
        const seed = base + i + k * 1009 * n;
        let drill = null;
        try {
          drill = await gen({ seed, role, principles: [...principles], formations: ctx.formations, catalogue: ctx.catalogue, direction, ...(avoid.length ? { avoid } : {}) });
        } catch (err) {
          console.warn('[fotbol] road: pass drill generation failed', err?.message ?? err);
        }
        await breathe();
        if (!isObj(drill)) { set.empty(key); continue; }
        set.hit(key);
        const id = String(drill.id ?? `pass-${role}-${seed}`);
        const r = { kind: 'pass', drill, nodeId: t.id, ...(role !== ctx.role ? set.lend() : {}), ...(principles !== t.principles ? { extra: true } : {}) };
        if (set.used.has(id) || !set.fresh(r)) continue;
        if (pick.offer(id, r)) chosen = { id, rep: r };
      }
      chosen ??= pick.fallback;
      if (chosen) {
        set.take(chosen.id, chosen.rep);
        rep = chosen.rep;
        break;
      }
    }
    return rep;
  };
  // The forward slots first: they are the hard ones, so a teammate lends a hand there before anywhere else (the set
  // keeps its slot order).
  const order = [...slots.keys()].sort((a, b) => Number(forward.has(b)) - Number(forward.has(a)) || a - b);
  for (const i of order) got[i] = await slot(i, slots[i]);
  // Still short: more reps in other positions than maxBorrowed, rather than a short set.
  if (got.some((r) => !r)) {
    set.lift();
    for (const i of order) if (!got[i]) got[i] = await slot(i, slots[i]);
  }
  return [...out, ...got.filter(Boolean)];
}

/** '#/pass' (the home's "Who's open?" tile): a quick set of mixed passing lessons, no Road node. */
export const QUICK_PASS = 'quick';

/** The quick set's lessons when the road names none (road.json `quickPass`): Find the Free Player, then Play It Forward. */
export const QUICK_PASS_NODES = Object.freeze(['free-player', 'play-forward']);

/** The quick set is played at the 1-star plan (docs/PROGRESSIVE_FIELD.md §2): small, small, medium, medium, full. */
export const QUICK_STARS = 1;

/**
 * The quick passing set (§4.2's "Who's open?" tile): `count` generated pass drills for your position, built as a Road
 * pass set is (3 of 5 with a forward best, no near-duplicates, one per template, a teammate in your group when your
 * position rarely gets a drill, at most maxBorrowed), on the road's `quickPass` lessons in turn: the free player
 * (the first rep, and the odd one) mixed with playing forward (play-tested: "who's open?" is the free-player idea).
 * Without the road: any lesson. Deterministic for a seed; pass a fresh seed for a fresh set.
 * @param {{ road?, profile?, seed?, formations?, catalogue?, generators?, count?, app? }} [opts]
 * @returns {Promise<{ kind: 'pass', drill, nodeId: 'quick', lesson: string|null, borrowed?, extra? }[]>}  lesson: the node it teaches
 */
export async function buildQuickPassSet(opts = {}) {
  const road = opts.road ?? bound.app?.data?.road ?? null;
  const ctx = setContext({ ...opts, index: [] }, road);
  const ids = road?.quickPass?.length ? road.quickPass : QUICK_PASS_NODES;
  const parts = ids.map((id) => nodeById(road, id)).filter((n) => n?.kind === 'pass' && n.principles?.length);
  const node = { id: QUICK_PASS, kind: 'pass', principles: [...new Set(parts.flatMap((n) => n.principles))], chapter: null, ...(parts.length ? { parts } : {}) };
  await withStages(ctx, opts, stagePlan(QUICK_STARS, { count: ctx.reps }));
  const built = await passSet(node, ctx);
  const reps = planSet(built, stagePlan(QUICK_STARS, { count: built.length }), ctx.stager);
  return reps.map((r) => ({ ...r, nodeId: QUICK_PASS, lesson: parts.length ? r.nodeId : null }));
}

/**
 * The reps of a node's set (§3, §8.1). Deterministic for a seed and the profile: the node's start counter
 * (nodeAttempt) goes into the seed, so each set of a node is new, and a set begun and left deals fresh reps next time.
 * @param {object|string} node  a road node (or its id, with `road`)
 * @param {{ road?, profile?, index?, load?, rewards?, skills?, seed?, formations?, catalogue?, generators?, count?, app? }} [opts]
 *   index: the scenario index (app.data.scenarios.index) or the scenario store itself; load: id → Promise<scenario>
 *   (default: the bound app's store, else a fetch); catalogue (or principles): data/principles.json for the generated
 *   drills' titles and takeaways (default: the bound app's); generators: { spot, pass } functions (and optionally
 *   forwardable(principles, role) and canGenerate(kind, role, principles, direction)), or null for none (default: the engine's,
 *   imported when first needed; spot calls get generateSpotDrill's options, with avoidTemplates once the set has asked a
 *   question); count: reps (default 5); app: the app playing the set: given it, the set counts as
 *   started (startSet: the node's start counter goes up and these reps become the profile's last set)
 * @returns {Promise<object[]>} reps; a pass set can be empty when neither a generator nor authored pass drills exist
 */
export async function buildSet(node, opts = {}) {
  const road = opts.road ?? bound.app?.data?.road ?? null;
  const n = asNode(road, node);
  if (!n?.id) return [];
  const ctx = setContext(opts, road);
  const attempt = nodeAttempt(ctx.profile, n.id);
  if (attempt) ctx.seed = `${ctx.seed}~${attempt}`;
  const plan = stagePlan(nodeStars(ctx.profile, n.id), { count: ctx.reps });
  await withStages(ctx, opts, plan);
  const built = await (repKind(road, n) === 'pass' ? passSet(n, ctx) : spotSet(n, ctx));
  const reps = planSet(built, stagePlan(nodeStars(ctx.profile, n.id), { count: built.length }), ctx.stager);
  if (opts.app) {
    try { startSet(opts.app, n.id, reps); } catch (err) { console.warn('[fotbol] road: could not count the set', err?.message ?? err); }
  }
  return reps;
}

/**
 * The onboarding set (§4.1, '#/play/first'): 3 easy reps for your position group, the easiest authored first (in your
 * role, then your group's first chapter's ideas first: chapterOrder, "Help the ball" for attackers), then generated
 * ones on those ideas, then easy ones in other positions.
 * @param {{ road?, profile?, index?, load?, seed?, formations?, catalogue?, generators?, count?, app? }} [opts]  app: the app
 *   playing the set: given it, the reps become the profile's last set (startSet), so the first node's set does not
 *   deal the tutorial's drills again (the worked example's answer was just shown)
 */
export async function buildFirstSet(opts = {}) {
  const road = opts.road ?? bound.app?.data?.road ?? null;
  const ctx = setContext({ ...opts, count: opts.count ?? ROAD_DEFAULTS.firstReps }, road);
  await withStages(ctx, opts, stagePlan(0, { first: true, count: ctx.reps }));
  const firstChapter = chapterOrder(road, ctx.group)[0];
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
  const set = setState(ctx.needs);
  // Easiest first, and while the set is short of reps that can be played small (all three are: PROGRESSIVE_FIELD §2),
  // one that cannot is passed over for up to stageLook more (stagePick), then taken.
  const take = async (list) => {
    while (out.length < ctx.reps) {
      const pick = stagePick(ctx);
      let chosen = null;
      for (const ref of list) {
        const id = baseId(ref.id);
        if (set.used.has(id)) continue;
        if (!pick.more()) break;
        const rep = await loadRef(ref, ctx);
        if (!rep) { set.used.add(id); continue; }
        if (pick.offer(id, rep)) { chosen = { id, rep }; break; }
      }
      chosen ??= pick.fallback;
      if (!chosen) return;
      set.take(chosen.id, chosen.rep);
      out.push({ ...chosen.rep, nodeId: FIRST_SET });
    }
  };
  // All three are small (PROGRESSIVE_FIELD §2) without costing you your position: the easy drills (difficulty 0 or
  // less) of your group that can be played small, in your position first (then easiest first), are taken before
  // anything else. A defender's easiest drills in the left back's shoes need a bigger game, and passing over them for
  // up to stageLook more (below) once gave a first set all in another position ("Now you're the left centre-back" x 3).
  const group = refs.filter((r) => r.inGroup);
  const own = (r) => (r.role === ctx.role ? 0 : 1);
  for (const ref of group.filter((r) => r.rank[0] <= 0).sort((a, b) => cmp([own(a), ...a.rank], [own(b), ...b.rank]))) {
    if (out.length >= ctx.reps) break;
    const id = baseId(ref.id);
    if (set.used.has(id)) continue;
    const rep = await loadRef(ref, ctx);
    if (!rep) { set.used.add(id); continue; }
    if (ctx.stager(rep)?.small === false) continue; // unknown (no stager): taken
    set.take(id, rep);
    out.push({ ...rep, nodeId: FIRST_SET });
  }
  await take(group);
  if (out.length < ctx.reps && early.length) {
    const q = spotQueue({ id: FIRST_SET, principles: early }, { ...ctx, index: [] }, set, 'first');
    while (out.length < ctx.reps) {
      const rep = await q.next();
      if (!rep) break;
      out.push(rep);
    }
  }
  await take(refs.filter((r) => !r.inGroup));
  const filled = fillUp(out, ctx.reps);
  const reps = planSet(filled, stagePlan(0, { first: true, count: filled.length }), ctx.stager);
  if (opts.app) {
    // Its reps become the last set (startSet), so the first node's set does not deal them again straight away.
    try { startSet(opts.app, FIRST_SET, reps); } catch (err) { console.warn('[fotbol] road: could not remember the first set', err?.message ?? err); }
  }
  return reps;
}
