// Shared by tests/road-sets-back.test.js and tests/road-sets-front.test.js (two files, so node --test runs the halves
// side by side): the Road's sets with the real generators (js/ui/player/road.js buildSet + js/engine/spotdrill.js and
// passdrill.js). Every node builds a full set for every position group, with no errors, no drill twice, no
// near-duplicates, the catalogue's names on generated reps, and 3 forward bests of 5 in every pass set whose ideas allow
// them (docs/KID_REDESIGN.md §3, §6.1, §6.2; research/passing.md §6.4). The engine's thin cells lean on authored drills,
// teammates in the group and the chapter's other ideas (road.js header).
import { test, assert, loadJSON, isNode } from './harness.js';
import * as R from '../js/ui/player/road.js';
import { createFormation } from '../js/engine/formation.js';
import { generateSpotDrill } from '../js/engine/spotdrill.js';
import { generatePassDrill, passForwardable } from '../js/engine/passdrill.js';
import { validateScenario } from '../js/engine/scenario.js';

const road = R.normalizeRoad(await loadJSON('data/road.json'));
const catalogue = await loadJSON('data/principles.json');
const byId = Object.fromEntries(catalogue.principles.map((p) => [p.id, p]));
const F = createFormation(await loadJSON('data/formations/helios-433.json'));
const formations = { us: F, them: F };
const index = (await loadJSON('data/scenarios/index.json')).scenarios;
const fileOf = Object.fromEntries(index.map((e) => [e.id, e.file ?? `${e.id}.json`]));
const scenarioCache = new Map();
const load = (id) => {
  if (!scenarioCache.has(id)) scenarioCache.set(id, loadJSON(`data/scenarios/${fileOf[id] ?? `${id}.json`}`));
  return scenarioCache.get(id);
};

// The generators, memoised on their inputs (a mix set asks for the drills its nodes' sets asked for): the sets are the
// same, the sweep is quicker. Every call's catalogue is recorded.
const calls = { spot: 0, pass: 0, withCatalogue: 0 };
const memo = (kind, f) => {
  const cache = new Map();
  return (o) => {
    calls[kind]++;
    if (o.catalogue) calls.withCatalogue++;
    const key = JSON.stringify([o.seed, o.role, o.principles, o.direction ?? null]);
    if (!cache.has(key)) cache.set(key, f(o));
    const d = cache.get(key);
    return d ? structuredClone(d) : d;
  };
};
const generators = { spot: memo('spot', generateSpotDrill), pass: memo('pass', generatePassDrill), forwardable: passForwardable };

const isForward = (d) => d?.rating?.best?.direction === 'forward' || !!d?.rating?.best?.tags?.some((t) => t.tag === 'switch');
const baseId = (r) => String(r.scenario?.id ?? r.drill?.id).replace(/-m$/, '');

export async function sweep(group) {
  // Chapter 1's first node played once, so every later spot set has its recall rep.
  const profile = { ...R.pickGroup(null, group, road), road: { 'close-down': { stars: 1, plays: 1 } } };
  const warn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    for (const node of R.roadNodes(road)) {
      const where = `${group} (${profile.role}) ${node.id}`;
      const reps = await R.buildSet(node, { road, profile, index, load, seed: 1, formations, catalogue, generators });
      assert.equal(reps.length, 5, `${where}: ${reps.length} reps`);
      assert.equal(new Set(reps.map(baseId)).size, 5, `${where}: a drill twice (${reps.map(baseId)})`);
      assert.ok(reps.every((r) => !r.twin && !r.repeat), `${where}: a mirrored twin or a repeat`);
      const pics = reps.map(R.repPicture);
      for (let i = 0; i < pics.length; i++) {
        for (let j = i + 1; j < pics.length; j++) assert.ok(!R.nearDuplicate(pics[i], pics[j]), `${where}: reps ${i} and ${j} look the same`);
      }
      if (R.repKind(road, node) === 'pass') {
        for (const r of reps) {
          assert.equal(r.kind, 'pass', where);
          assert.ok(r.drill.rating?.best && r.drill.learner?.role, `${where}: ${r.drill.id} is playable`);
          const p = byId[r.drill.principles[0]];
          assert.equal(r.drill.titleKid, p.kidName, `${where}: ${r.drill.id} takes its name from data/principles.json`);
          assert.equal(r.drill.takeaway.kid, p.summary.kid, `${where}: ${r.drill.id} takes its takeaway from data/principles.json`);
        }
        const parts = node.kind === 'mix' ? R.roadNodes(road).filter((n) => n.chapter === node.from && n.kind === 'pass') : [node];
        if (parts.some((n) => passForwardable(n.principles, profile.role))) {
          const fwd = reps.filter((r) => isForward(r.drill)).length;
          assert.ok(fwd >= 3, `${where}: only ${fwd} of 5 passes have a forward best (the "always pass back" trap)`);
        }
        // The node's own ideas come first: extra ideas only when the node's cannot be made for anyone.
        assert.ok(reps.filter((r) => r.extra).length <= 1, `${where}: ${reps.filter((r) => r.extra).length} reps on other ideas`);
      } else {
        for (const r of reps) {
          assert.equal(r.kind, 'spot', where);
          assert.deepEqual(validateScenario(r.scenario, { principles: catalogue }), [], `${where}: ${r.scenario.id} is valid`);
          if (r.generated) {
            const p = byId[r.scenario.principles[0]];
            assert.equal(r.scenario.titleKid, p.kidName, `${where}: ${r.scenario.id} takes its name from data/principles.json`);
            assert.equal(r.scenario.takeaway.kid, p.summary.kid, `${where}: ${r.scenario.id} takes its takeaway from data/principles.json`);
          }
        }
        // Mostly the node's own ideas (and the recall rep): the chapter's other ideas only fill a thin set.
        const own = reps.filter((r) => !r.extra && !r.recall).length;
        assert.ok(own >= 1, `${where}: no rep on the node's own ideas`);
      }
    }
  } finally { console.warn = warn; }
  assert.deepEqual(warnings, [], `${group}: no warnings`);
  // The generators got the catalogue on every call, so generated reps carry data/principles.json's words.
  assert.ok(calls.spot > 0 && calls.pass > 0, 'the sweep used both generators');
  assert.equal(calls.withCatalogue, calls.spot + calls.pass, 'every generator call had the catalogue');
}

/**
 * The tests for some position groups (each file passes its half). Node only: a sweep takes seconds between results,
 * and the browser runner (tests.html) moves on to the next file after 150 ms of quiet and runs a file's tests side by
 * side, so there it would overlap other files (and their console.warn stand-ins).
 */
export function sweepTests(groups) {
  for (const group of groups) {
    test(`road sets: every Road node builds 5 fresh reps for a ${R.STRINGS.groups[group].toLowerCase()} (real generators, the catalogue's words)`, () => (isNode ? sweep(group) : undefined));
  }
}
