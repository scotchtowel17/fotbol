// Shared by tests/road-sets-back.test.js and tests/road-sets-front.test.js (two files, so node --test runs the halves
// side by side): the Road's sets with the real generators (js/ui/player/road.js buildSet + js/engine/spotdrill.js and
// passdrill.js). Every node builds a full set for every position group, with no errors, no drill twice, no
// near-duplicates, no two generated reps from one template or with the same player on the ball, at most 2 reps in
// another position, the recall rep from another node and on other ideas, the catalogue's names on generated reps, and 3
// forward bests of 5 in every pass set whose ideas allow them (docs/KID_REDESIGN.md §3, §6.1, §6.2; research/passing.md
// §6.4; the play-test), and a set begun again (a reload, Play again) dealt fresh, with at most 2 reps of the last one
// where the content runs out; and the first Road set after the onboarding set deals none of its drills (road.js
// startSet remembers the onboarding set as the last set). The engine's thin cells lean on authored drills, teammates in the group (2 at most) and
// the chapter's other ideas (road.js header). Each group's slowest set is reported (generator calls and time).
// Stages (docs/PROGRESSIVE_FIELD.md §2): every rep carries its slot's planned stage (road.js stagePlan: the 0-star plan
// for a node's first set, the 3-star plan for the set begun again here), every node builds at least one rep that plays
// as a small or a bigger game for every group, and how often each planned stage is played as planned is reported per
// group (the rest play bigger: cast.js bestStage's fallback when a stage cannot teach the rep).
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
// The spot drills and the authored pass drills (the index's passes, as js/data.js hands them to the Road).
const indexFile = await loadJSON('data/scenarios/index.json');
const index = [...indexFile.scenarios, ...(indexFile.passes ?? []).map((e) => ({ ...e, kind: 'pass' }))];
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
/** An app with an in-memory store and the road (the profile a set builder given the app reads and saves). */
const memoryApp = (initial = {}) => {
  const mem = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return { data: { road }, store: { get: (k, f) => (mem.has(k) ? JSON.parse(mem.get(k)) : f), set: (k, v) => { mem.set(k, JSON.stringify(v)); return true; } } };
};

export async function sweep(group, t) {
  // Chapter 1's first node played once, so every later spot set has its recall rep.
  const profile = { ...R.pickGroup(null, group, road), road: { 'close-down': { stars: 1, plays: 1 } } };
  const warn = console.warn;
  const warnings = [];
  let slowest = null;
  const spares = [];
  const tallies = { first: R.stageTally([]), again: R.stageTally([]) };
  const fellBack = [];
  const addTally = (into, reps, where) => {
    const played = reps.map((r) => R.stagedRep(r, r.stage, { formations })?.stage);
    assert.ok(played.every((st) => R.STAGES.includes(st)), `${where}: every rep was staged by the set builder (${played})`);
    const t = R.stageTally(reps.map((r, i) => ({ stage: r.stage, played: played[i] })));
    for (const st of R.STAGES) { into[st].wanted += t[st].wanted; into[st].played += t[st].played; }
    const missed = reps.map((r, i) => (played[i] !== r.stage ? `${r.stage[0]}→${played[i][0]}` : null)).filter(Boolean);
    if (missed.length) fellBack.push(`${node0(where)} ${missed.join(' ')}`);
    return played;
  };
  const node0 = (where) => where.split(' ').at(-1);
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    for (const node of R.roadNodes(road)) {
      const where = `${group} (${profile.role}) ${node.id}`;
      const before = { n: calls.spot + calls.pass, empty: calls.empty, t: performance.now() };
      const reps = await R.buildSet(node, { road, profile, index, load, seed: 1, formations, catalogue, generators });
      const cost = { node: node.id, calls: calls.spot + calls.pass - before.n, empty: calls.empty - before.empty, ms: Math.round(performance.now() - before.t) };
      if (!slowest || cost.calls > slowest.calls) slowest = cost;
      assert.equal(reps.length, 5, `${where}: ${reps.length} reps`);
      // Stages: the slot's planned stage on every rep; a small or bigger game for every node and group.
      assert.deepEqual(reps.map((r) => r.stage), R.stagePlan(R.nodeStars(profile, node.id)), `${where}: the stage plan`);
      const played = addTally(tallies.first, reps, where);
      assert.ok(played.some((st) => st === 'small' || st === 'medium'), `${where}: no rep plays as a small or bigger game (${played})`);
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
          if (r.drill.source?.kind !== 'generated') continue; // an authored drill has its own words
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
      // (Played to 3 stars since: the 3-star plan, a bigger game and then the full match.)
      const again = { ...profile, road: { ...profile.road, [node.id]: { ...(profile.road[node.id] ?? { stars: 0, plays: 0 }), stars: 3, starts: R.nodeAttempt(profile, node.id) + 1 } }, last: { nodeId: node.id, ids: reps.map(baseId) } };
      const next = await R.buildSet(node, { road, profile: again, index, load, seed: 1, formations, catalogue, generators });
      assert.deepEqual(next.map((r) => r.stage), R.stagePlan(3), `${where}: the 3-star plan`);
      addTally(tallies.again, next, `${where} (3 stars)`);
      const same = next.map(baseId).filter((id) => reps.map(baseId).includes(id));
      assert.ok(same.length <= 2, `${where}: a set begun again deals ${same.length} of the same reps (${same})`);
      assert.ok(next.length === 5 && next.every((r) => !r.twin && !r.repeat), `${where}: the next set is full`);
    }
    // The onboarding set (all small) and the quick "Who's open?" set (the 1-star plan) are staged the same way.
    const app = memoryApp({ [R.PROFILE_KEY]: R.pickGroup(null, group, road) });
    const first = await R.buildFirstSet({ road, profile: R.loadProfile(app), index, load, seed: 1, formations, catalogue, generators, app });
    assert.deepEqual(first.map((r) => r.stage), ['small', 'small', 'small'], `${group} first set`);
    const firstPlayed = addTally(tallies.first, first, `${group} first`);
    assert.ok(firstPlayed.filter((st) => st === 'small').length >= 2, `${group}: the first set plays ${firstPlayed}`);
    // The first Road set after it (the next node's, a minute after the tutorial) deals none of the tutorial's drills
    // (play-test: a defender's and a striker's dealt 2 of 3 again, the worked example among them); a full set still.
    const onboarded = R.loadProfile(app);
    const firstNode = R.nextNode(road, onboarded);
    const after = await R.buildSet(firstNode, { road, profile: onboarded, index, load, seed: 1, formations, catalogue, generators });
    const repeated = after.map(baseId).filter((id) => first.map(baseId).includes(id));
    assert.deepEqual(repeated, [], `${group}: ${firstNode.id}'s first set deals the tutorial's drills again`);
    assert.ok(after.length === 5 && after.every((r) => !r.twin && !r.repeat), `${group}: ${firstNode.id}'s first set is full`);
    const quick = await R.buildQuickPassSet({ road, profile, seed: 1, formations, catalogue, generators });
    assert.deepEqual(quick.map((r) => r.stage), R.stagePlan(R.QUICK_STARS), `${group} quick set`);
    const quickPlayed = addTally(tallies.again, quick, `${group} quick`);
    assert.ok(quickPlayed.some((st) => st === 'small' || st === 'medium'), `${group}: the quick set plays ${quickPlayed}`);
  } finally { console.warn = warn; }
  t?.diagnostic?.(`${group}: the slowest set is ${slowest.node}: ${slowest.calls} generator calls (${slowest.empty} empty), ${slowest.ms} ms`);
  if (spares.length) t?.diagnostic?.(`${group}: more than ${R.ROAD_DEFAULTS.maxBorrowed} reps in another position, nothing else left in yours: ${spares.join(', ')}`);
  const rate = (x) => `${x.played}/${x.wanted}`;
  const { first: f, again: a } = tallies;
  t?.diagnostic?.(`${group}: played as planned: 0-star plan and first set small ${rate(f.small)}, bigger ${rate(f.medium)}; 3-star plan and quick set small ${rate(a.small)}, bigger ${rate(a.medium)}, full ${rate(a.full)}`);
  if (fellBack.length) t?.diagnostic?.(`${group}: played bigger than planned (wanted→played): ${fellBack.join('; ')}`);
  // Most small slots are played small (the set builder prefers reps that can be: road.js stagePick), the bigger game nearly always.
  assert.ok(f.small.played >= 0.75 * f.small.wanted, `${group}: only ${rate(f.small)} small slots played small`);
  assert.ok(f.medium.played + a.medium.played >= 0.9 * (f.medium.wanted + a.medium.wanted), `${group}: bigger-game slots`);
  assert.ok(a.small.played >= 0.5 * a.small.wanted, `${group}: the quick set's small slots (${rate(a.small)})`);
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
