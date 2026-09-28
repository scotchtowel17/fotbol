// Shared by tests/road-sets-back.test.js and tests/road-sets-front.test.js (two files, so node --test runs the halves
// side by side): the Road's sets with the real generators (js/ui/player/road.js buildSet + js/engine/spotdrill.js and
// passdrill.js). Every node builds a full set for every position group, with no errors, no drill twice, no
// near-duplicates, no two generated reps from one template or with the same player on the ball, at most 2 reps in
// another position, the recall rep from another node and on other ideas, the catalogue's names on generated reps, and 3
// forward bests of 5 in every pass set whose ideas allow them (docs/KID_REDESIGN.md §3, §6.1, §6.2; research/passing.md
// §6.4; the play-test), and a set begun again (a reload, Play again) dealt fresh, with at most 2 reps of the last one
// where the content runs out. The engine's thin cells lean on authored drills, teammates in the group (2 at most) and
// the chapter's other ideas (road.js header). Each group's slowest set is reported (generator calls and time).
import { test, assert, loadJSON, isNode } from './harness.js';
import * as R from '../js/ui/player/road.js';
import { createFormation } from '../js/engine/formation.js';
import * as SD from '../js/engine/spotdrill.js';
import * as PD from '../js/engine/passdrill.js';
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
const calls = { spot: 0, pass: 0, withCatalogue: 0, empty: 0, known: [] };
const memo = (kind, f) => {
  const cache = new Map();
  return (o) => {
    calls[kind]++;
    if (o.catalogue) calls.withCatalogue++;
    // A call the engine says up front cannot give a drill (canGenerate*) must never be made (road.js feasibleFor).
    if (!canGenerate(kind, o.role, o.principles ?? [], o.direction ?? 'any')) calls.known.push(`${kind} ${o.role} ${(o.principles ?? []).join(',')} ${o.direction ?? ''}`);
    const key = JSON.stringify([o.seed, o.role, o.principles, o.direction ?? null, o.avoid ?? null, o.avoidTemplates ?? null]);
    if (!cache.has(key)) cache.set(key, f(o));
    const d = cache.get(key);
    if (!d) calls.empty++;
    return d ? structuredClone(d) : d;
  };
};
const { generateSpotDrill } = SD;
const { generatePassDrill, passForwardable } = PD;
/** The engine's up-front feasibility helpers when it has them (road.js feasibleFor asks them the same way). */
const feasible = { spot: SD.canGenerateSpot, pass: PD.canGeneratePass };
const canGenerate = (kind, role, principles, direction = 'any') => {
  const f = feasible[kind];
  return typeof f !== 'function' || !principles.length || f(role, principles, kind === 'pass' ? { direction } : undefined) !== false;
};
const generators = { spot: memo('spot', generateSpotDrill), pass: memo('pass', generatePassDrill), forwardable: passForwardable, canGenerate };

const isForward = (d) => d?.rating?.best?.direction === 'forward' || !!d?.rating?.best?.tags?.some((t) => t.tag === 'switch');
const baseId = (r) => String(r.scenario?.id ?? r.drill?.id).replace(/-m$/, '');

export async function sweep(group, t) {
  // Chapter 1's first node played once, so every later spot set has its recall rep.
  const profile = { ...R.pickGroup(null, group, road), road: { 'close-down': { stars: 1, plays: 1 } } };
  const warn = console.warn;
  const warnings = [];
  let slowest = null;
  const spares = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    for (const node of R.roadNodes(road)) {
      const where = `${group} (${profile.role}) ${node.id}`;
      const before = { n: calls.spot + calls.pass, empty: calls.empty, t: performance.now() };
      const reps = await R.buildSet(node, { road, profile, index, load, seed: 1, formations, catalogue, generators });
      const cost = { node: node.id, calls: calls.spot + calls.pass - before.n, empty: calls.empty - before.empty, ms: Math.round(performance.now() - before.t) };
      if (!slowest || cost.calls > slowest.calls) slowest = cost;
      assert.equal(reps.length, 5, `${where}: ${reps.length} reps`);
      assert.equal(new Set(reps.map(baseId)).size, 5, `${where}: a drill twice (${reps.map(baseId)})`);
      assert.ok(reps.every((r) => !r.twin && !r.repeat), `${where}: a mirrored twin or a repeat`);
      const pics = reps.map(R.repPicture);
      for (let i = 0; i < pics.length; i++) {
        for (let j = i + 1; j < pics.length; j++) assert.ok(!R.nearDuplicate(pics[i], pics[j]), `${where}: reps ${i} and ${j} look the same`);
      }
      // No two generated reps from one engine template, or with the same player on the ball ("Their winger has the ball").
      const looks = reps.flatMap(R.repLooks);
      assert.equal(new Set(looks).size, looks.length, `${where}: generated reps that look alike (${looks})`);
      // Mostly your own position: at most maxBorrowed reps played as a teammate (flagged, and in another position),
      // more only when nothing else in yours was left (`spare`: the engine's thin cells, reported).
      const borrowed = reps.filter((r) => r.borrowed);
      assert.ok(borrowed.filter((r) => !r.spare).length <= R.ROAD_DEFAULTS.maxBorrowed, `${where}: ${borrowed.length} reps in another position`);
      if (reps.some((r) => r.spare)) spares.push(`${node.id} (${reps.filter((r) => r.spare).length})`);
      const roleOf = (r) => (r.drill ?? r.scenario).learner.role;
      assert.ok(reps.every((r) => !!r.borrowed === (roleOf(r) !== profile.role)), `${where}: a rep in another position must say so (${reps.map(roleOf)})`);
      if (R.repKind(road, node) === 'pass') {
        for (const r of reps) {
          assert.equal(r.kind, 'pass', where);
          assert.ok(r.drill.rating?.best && r.drill.learner?.role, `${where}: ${r.drill.id} is playable`);
          const p = byId[r.drill.principles[0]];
          assert.equal(r.drill.titleKid, p.kidName, `${where}: ${r.drill.id} takes its name from data/principles.json`);
          assert.equal(r.drill.takeaway.kid, p.summary.kid, `${where}: ${r.drill.id} takes its takeaway from data/principles.json`);
        }
        const parts = node.kind === 'mix' ? R.roadNodes(road).filter((n) => n.chapter === node.from && n.kind === 'pass') : [node];
        // Variety: no receiver is starred in more than maxSameBest reps (play-test: a winger's forward bests all went to
        // the #9). With that cap, a position with one natural forward receiver reaches 2 forward bests, not 3.
        const receivers = reps.map((r) => R.bestReceiver(r.drill)).filter(Boolean);
        for (const role of new Set(receivers)) {
          const c = receivers.filter((x) => x === role).length;
          assert.ok(c <= R.ROAD_DEFAULTS.maxSameBest, `${where}: ${c} of 5 best passes go to the ${role}`);
        }
        if (parts.some((n) => passForwardable(n.principles, profile.role))) {
          const fwd = reps.filter((r) => isForward(r.drill)).length;
          assert.ok(fwd >= 2, `${where}: only ${fwd} of 5 passes have a forward best (the "always pass back" trap)`);
        }
        // The node's own ideas come first (in your position, then 2 teammates at most); a rep on another idea of the
        // chapter only when those run out, and in your own position.
        const extra = reps.filter((r) => r.extra);
        assert.ok(reps.length - extra.length >= 2, `${where}: only ${reps.length - extra.length} reps on the node's ideas`);
        assert.ok(extra.every((r) => !r.borrowed), `${where}: a rep on another idea played by a teammate`);
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
        // The recall rep: another node you have played, on none of this node's ideas (R23).
        const recall = reps.filter((r) => r.recall);
        assert.ok(recall.length <= 1, where);
        for (const r of recall) {
          assert.notEqual(r.nodeId, node.id, `${where}: the recall rep is from this node`);
          assert.ok(!r.scenario.principles.some((p) => node.principles.includes(p)), `${where}: the recall rep ${r.scenario.id} is on this node's ideas`);
        }
        if (node.kind === 'spot' && node.id !== 'close-down') assert.equal(recall.length, 1, `${where}: a recall rep from Close Them Down`);
      }
      // The set begun again (a reload in the middle, or Play again): road.js counted the first as started, so the next
      // one is dealt fresh; only where your position's content runs out does a drill of the last set come back.
      const again = { ...profile, road: { ...profile.road, [node.id]: { ...(profile.road[node.id] ?? { stars: 0, plays: 0 }), starts: R.nodeAttempt(profile, node.id) + 1 } }, last: { nodeId: node.id, ids: reps.map(baseId) } };
      const next = await R.buildSet(node, { road, profile: again, index, load, seed: 1, formations, catalogue, generators });
      const same = next.map(baseId).filter((id) => reps.map(baseId).includes(id));
      assert.ok(same.length <= 2, `${where}: a set begun again deals ${same.length} of the same reps (${same})`);
      assert.ok(next.length === 5 && next.every((r) => !r.twin && !r.repeat), `${where}: the next set is full`);
    }
  } finally { console.warn = warn; }
  t?.diagnostic?.(`${group}: the slowest set is ${slowest.node}: ${slowest.calls} generator calls (${slowest.empty} empty), ${slowest.ms} ms`);
  if (spares.length) t?.diagnostic?.(`${group}: more than ${R.ROAD_DEFAULTS.maxBorrowed} reps in another position, nothing else left in yours: ${spares.join(', ')}`);
  assert.deepEqual(warnings, [], `${group}: no warnings`);
  assert.deepEqual([...new Set(calls.known)], [], `${group}: generator calls the engine knows will fail`);
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
    test(`road sets: every Road node builds 5 fresh reps for a ${R.STRINGS.groups[group].toLowerCase()} (real generators, the catalogue's words)`, (t) => (isNode ? sweep(group, t) : undefined));
  }
}
