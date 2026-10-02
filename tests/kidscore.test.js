// js/engine/kidscore.js: Player mode judges the right AREA round the best spot, not one exact point (the owner's
// play-test, 2026-09-29: "way too strict"). Coach mode keeps score.js evaluate() unchanged. Contract: ARCHITECTURE §5.18.
// The owner's targets, checked on every authored drill and its mirror and on a seeded sample of generated spot drills
// (seed 1, every position and idea the generator can make), each at every stage it plays (the staged area on the reduced
// frame), in 16 directions round the best spot:
//   - within 3 m: 3 stars in 85 %+ of directions; within 5 m: 2+ in 85 %+; within 7 m: 1+ in 70 %+ (on spots that break
//     no key constraint: every other miss is a key or the start cap, never the distance, and the raw shares are held too);
//   - the learner's start: 0 stars in every rep, and the green never reaches past capFrac of the way to it;
//   - a key constraint (offside at a pass, keeping an attacker onside, not goal-side of your mark in our box, the wrong
//     side of your man or of the ball you press, the lesson clearly failed) is 1 star at most, however near;
//   - the green (3 stars) never straddles a hard line (the offside line, the goal-side line, the keeps-onside line).
import { test, assert, approx, loadJSON, timed, PERF_SLACK } from './harness.js';
import {
  KID_DEFAULTS, KID_LEVELS, KID_WORDS, kidArea, kidStars, kidOutline, kidNearest, kidLive, kidRunStars, bandOf, relationship,
} from '../js/engine/kidscore.js';
import { STAGES, CAST_DEFAULTS, stagesOf, stageSpotDrill, lessonOf } from '../js/engine/cast.js';
import { SPOT_DEFAULTS, SPOT_PRINCIPLES, generateSpotDrill, canGenerateSpot, checkSpotDrill } from '../js/engine/spotdrill.js';
import { checkScenario } from '../scripts/check-scenarios.mjs';
import { createFormation } from '../js/engine/formation.js';
import { mirrorScenario, normalizeScenario } from '../js/engine/scenario.js';
import { buildContext } from '../js/engine/context.js';
import { computeGhost } from '../js/engine/ghost.js';
import { evaluate, toleranceFor } from '../js/engine/score.js';
import { RULES_BY_ID } from '../js/engine/rules/index.js';
import { goalSideRef } from '../js/engine/rules/goal-side.js';
import { OFFSIDE_DEFAULTS } from '../js/engine/rules/offside.js';
import { PRESS_DEFAULTS } from '../js/engine/rules/press.js';
import { LEARNABLE_ROLES } from '../js/engine/roles.js';
import { OWN_GOAL, WIDTH, onPitch } from '../js/engine/pitch.js';
import { dist } from '../js/engine/geometry.js';
import { REWARDS_DEFAULTS, STAR_WORDS } from '../js/rewards.js';
import { makeFrame, posOf } from './fixtures.js';

const K = KID_DEFAULTS;
const F = createFormation(await loadJSON('data/formations/helios-433.json'));
const formations = { us: F, them: F };
const catalogue = await loadJSON('data/principles.json');
const index = (await loadJSON('data/scenarios/index.json')).scenarios;
const authored = await Promise.all(index.map((e) => loadJSON(`data/scenarios/${e.file}`)));

// The corpus: every authored drill and its mirror, and generated spot drills (seed 1, every learnable position x every
// idea canGenerateSpot allows it), staged at every stage that passes the gate.
const GEN_SEED = 1;
const drills = [];
for (const raw of authored) {
  drills.push({ group: 'authored', label: raw.id, s: raw, of: raw.id, mirror: false });
  drills.push({ group: 'authored', label: `${raw.id} (mirrored)`, s: mirrorScenario(normalizeScenario(raw)), of: raw.id, mirror: true });
}
for (const role of LEARNABLE_ROLES) for (const p of Object.keys(SPOT_PRINCIPLES)) {
  if (!canGenerateSpot(role, [p])) continue;
  const s = generateSpotDrill({ seed: GEN_SEED, role, principles: [p], formations, catalogue });
  if (s) drills.push({ group: 'generated', label: `${s.id} (${role} ${p})`, s });
}
for (const d of drills) d.st = stagesOf(d.s, { formations, principles: catalogue });
const reps = drills.flatMap((d) => STAGES.filter((k) => d.st[k]).map((stage) => ({ ...d, stage, r: d.st[stage] })));

// 16 directions round a spot, on the pitch.
const DIRS = 16;
const ring = (c, d) => Array.from({ length: DIRS }, (_, i) => {
  const a = (i / DIRS) * 2 * Math.PI;
  return { x: c.x + d * Math.cos(a), y: c.y + d * Math.sin(a) };
}).filter((p) => onPitch(p));
const RADII = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8];
// Every rep judged once on its rings (kidStars is pure: the tests below share the judgements).
const judged = reps.map((q) => ({ q, spots: RADII.flatMap((d) => ring(q.r.ghost.spot, d).map((p) => ({ d, p, k: kidStars(q.r.ctx, p, q.r.area) }))) }));

/** The start cap holds band b out at p (the area never reaches toward the start past capFrac[b] of the way). */
const capped = (area, p, b) => !!area.cap && (p.x - area.center.x) * area.cap.u.x + (p.y - area.center.y) * area.cap.u.y > area.cap.max[b] + 1e-9;
const share = (xs, ok) => (xs.length ? xs.filter(ok).length / xs.length : NaN);
const pct = (x) => `${(100 * x).toFixed(1)} %`;
const inRegion = (r, p) => {
  if (r?.type === 'circle') return Math.hypot(p.x - r.x, p.y - r.y) <= r.r;
  if (r?.type === 'rect') return p.x >= Math.min(r.x0, r.x1) && p.x <= Math.max(r.x0, r.x1) && p.y >= Math.min(r.y0, r.y1) && p.y <= Math.max(r.y0, r.y1);
  let inside = false;
  const q = r?.points ?? [];
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) if ((q[i].y > p.y) !== (q[j].y > p.y) && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
  return inside;
};
const offsideLesson = (lesson) => !!lesson && (K.offsidePrinciples.includes(lesson.principle) || lesson.rules.some((id) => K.offsideRules.includes(id)));

test('kidscore: the corpus covers every stage of authored and generated drills', () => {
  for (const g of ['authored', 'generated']) for (const k of STAGES) {
    assert.ok(reps.filter((q) => q.group === g && q.stage === k).length >= 20, `${g} ${k}: ${reps.filter((q) => q.group === g && q.stage === k).length} reps`);
  }
  assert.ok(drills.filter((d) => d.group === 'generated').length >= 60, 'the generated sample');
});

test('kidscore: the defaults, and the numbers other modules must agree with', async () => {
  assert.ok(Object.isFrozen(K));
  assert.equal(K.stillRadius, SPOT_DEFAULTS.stillRadius);
  assert.deepEqual([...K.starAt], [...REWARDS_DEFAULTS.starAt]);
  assert.deepEqual([...KID_WORDS], [...STAR_WORDS]);
  assert.deepEqual([...KID_LEVELS], ['cold', 'cool', 'warm', 'hot']);
  assert.deepEqual([...K.offsidePrinciples], [...CAST_DEFAULTS.offsidePrinciples]);
  assert.ok(K.offsideRules.every((id) => CAST_DEFAULTS.offsideRules.includes(id)));
  assert.equal(K.offsideMargin, OFFSIDE_DEFAULTS.margin);
  assert.equal(K.pressRef, (PRESS_DEFAULTS.distMin + PRESS_DEFAULTS.distMax) / 2);
  const { MATCHDAY_DEFAULTS } = await import('../js/ui/player/matchday.js');
  assert.equal(K.liveCoachFloor.hot, MATCHDAY_DEFAULTS.hotAt);
  assert.equal(K.liveCoachFloor.warm, MATCHDAY_DEFAULTS.warmAt);
  // Distance alone never costs a star inside the targets: the smallest green (the floor at the smallest stage scale)
  // holds every 3 m spot, and the bands every 5 m and 7 m one...
  const least = K.floor * K.mult * Math.min(...Object.values(K.stageScale));
  assert.ok(least > 3, `the smallest green ${least} m`);
  assert.ok(least + K.grow2 >= 5 && least + K.grow1 >= 7, 'the 2- and 1-star bands');
  // ...and toward the start the area stops short of it (the green at 45 % of the way at most).
  assert.ok(K.capFrac[3] <= 0.45 && K.capFrac[3] <= K.capFrac[2] && K.capFrac[2] <= K.capFrac[1] && K.capFrac[1] < 1);
  assert.ok(K.keyCap <= 1 && K.lessonCap <= 1 && K.softCap <= 2 && K.coachLiftTo <= 2, 'keys and Coach mode never give 3 stars outside the green');
});

test('kidscore: the best spot earns 3 stars and standing still 0 in every staged rep (and the stage gates say so)', () => {
  let holds = 0;
  for (const { q } of judged) {
    const { r } = q;
    const at = `${q.label} ${q.stage}`;
    assert.equal(kidStars(r.ctx, r.ghost.spot, r.area).stars, 3, `${at}: the best spot`);
    assert.equal(r.gates.kidBest, 3, `${at}: gates.kidBest`);
    if (r.hold) { holds++; assert.equal(r.area.cap, null, `${at}: a hold drill has no start cap`); continue; }
    const k = kidStars(r.ctx, r.start, r.area);
    assert.equal(k.stars, 0, `${at}: standing still earns ${k.stars}`);
    assert.deepEqual(k.keys, ['stood-still']);
    assert.equal(r.gates.kidStart, 0, `${at}: gates.kidStart`);
    assert.equal(bandOf(r.area, r.start), 0, `${at}: the area itself never reaches the start`);
    assert.ok(r.area.cap, `${at}: the start cap`);
    approx(r.area.cap.D, dist(r.start, r.ghost.spot), 1e-9);
  }
  assert.ok(holds < reps.length / 4, `${holds} hold reps`);
});

test('kidscore: TARGETS on spots that break no key: 3 m → 3 stars 85 %+, 5 m → 2+ 85 %+, 7 m → 1+ 70 %+ (each group and stage)', () => {
  const out = [];
  for (const g of ['authored', 'generated']) for (const stage of STAGES) {
    const at = (d) => judged.filter(({ q }) => q.group === g && q.stage === stage).flatMap(({ spots }) => spots.filter((x) => x.d === d && !x.k.keys.length));
    const [t3, t5, t7] = [share(at(3), (x) => x.k.stars >= 3), share(at(5), (x) => x.k.stars >= 2), share(at(7), (x) => x.k.stars >= 1)];
    out.push(`${g} ${stage}: ${pct(t3)} / ${pct(t5)} / ${pct(t7)} (${at(3).length} spots at 3 m)`);
    assert.ok(at(3).length >= 100, `${g} ${stage}: too few spots`);
    assert.ok(t3 >= 0.85, `3 m: ${out.at(-1)}`);
    assert.ok(t5 >= 0.85, `5 m: ${out.at(-1)}`);
    assert.ok(t7 >= 0.7, `7 m: ${out.at(-1)}`);
  }
});

test('kidscore: distance alone never costs a star within the targets, and the raw shares stay at the ceiling the keys leave', () => {
  // Every spot 3 m or nearer is in the green, 5 m in the 2-star band, 7 m in the 1-star band, unless the start cap holds
  // it out: so a miss there is always a key (a relationship) or the start cap, never the distance.
  const want = (d) => (d <= 3 ? 3 : d <= 5 ? 2 : d <= 7 ? 1 : 0);
  for (const { q, spots } of judged) {
    for (const x of spots) {
      const b = want(x.d);
      if (!b || x.k.stars >= b) continue;
      assert.ok(x.k.keys.length || capped(q.r.area, x.p, b), `${q.label} ${q.stage} at ${x.d} m (${x.p.x.toFixed(1)}, ${x.p.y.toFixed(1)}): ${x.k.stars} stars, no key and not the start cap`);
    }
  }
  // Raw (every spot). 7 m meets the target outright; at 3 and 5 m the keys and the start cap (the targets' own
  // exceptions: offside, the wrong side of your man or the ball, the lesson clearly failed, standing still) cover
  // 15-30 % of the ring round a press, a mark or a line, so these floors guard the ceiling measured in §5.18.
  for (const g of ['authored', 'generated']) {
    const at = (d) => judged.filter(({ q }) => q.group === g).flatMap(({ spots }) => spots.filter((x) => x.d === d));
    const [r1, r3, r5, r7] = [share(at(1), (x) => x.k.stars >= 3), share(at(3), (x) => x.k.stars >= 3), share(at(5), (x) => x.k.stars >= 2), share(at(7), (x) => x.k.stars >= 1)];
    const say = `${g}: 1 m ${pct(r1)}, 3 m ${pct(r3)}, 5 m ${pct(r5)}, 7 m ${pct(r7)}`;
    assert.ok(r1 >= 0.95, say);
    assert.ok(r3 >= 0.78, say);
    assert.ok(r5 >= 0.66, say);
    assert.ok(r7 >= 0.7, say);
  }
});

test('kidscore: a key constraint near the best spot is 1 star at most (offside at a pass, the wrong side of your man or the ball, the lesson failed)', () => {
  const n = { offsidePass: 0, offsideLesson: 0, offsideSoft: 0, wrongSide: 0, inBox: 0, pastBall: 0, keptOnside: 0, misconception: 0 };
  for (const { q, spots } of judged) {
    const { ctx, area } = q.r;
    const lesson = q.r.lesson;
    const offW = RULES_BY_ID.offside.weight(ctx) > 0, gsW = RULES_BY_ID['goal-side'].weight(ctx) > 0, prW = RULES_BY_ID.press.weight(ctx) > 0;
    const g = goalSideRef(ctx);
    const ref = ctx.carrier ?? ctx.ball;
    const gl = dist(ref, OWN_GOAL), u = { x: (OWN_GOAL.x - ref.x) / gl, y: (OWN_GOAL.y - ref.y) / gl };
    for (const { d, p, k } of spots) {
      if (d > 5) continue;
      const at = `${q.label} ${q.stage} (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
      if (offW) {
        const o = RULES_BY_ID.offside.evaluate(ctx, p);
        if (o.critical) { n.offsidePass++; assert.ok(k.stars <= 1, `${at}: offside at a pass, ${k.stars} stars`); }
        else if (o.vars.beyond > K.offsideMargin && offsideLesson(lesson)) { n.offsideLesson++; assert.ok(k.stars <= 1, `${at}: offside in a lesson about the line, ${k.stars} stars`); }
        else if (o.vars.beyond > K.offsideMargin) { n.offsideSoft++; assert.ok(k.stars <= 2, `${at}: offside, ${k.stars} stars`); }
      }
      if (gsW && g) {
        // Nearer our goal than them (|them - goal| - |you - goal|): below 0 is the wrong side of your man.
        const margin = dist(g, OWN_GOAL) - dist(p, OWN_GOAL);
        if (margin < 0) { n.wrongSide++; assert.ok(k.stars <= 1, `${at}: the wrong side of your man, ${k.stars} stars`); }
        if (RULES_BY_ID['goal-side'].evaluate(ctx, p).critical) { n.inBox++; assert.ok(k.stars <= 1, `${at}: not goal-side in our box, ${k.stars} stars`); }
      }
      if (prW && (p.x - ref.x) * u.x + (p.y - ref.y) * u.y < -K.pressPast) { n.pastBall++; assert.ok(k.stars <= 1, `${at}: pressing from past the ball, ${k.stars} stars`); }
      if (RULES_BY_ID['keeps-onside'].weight(ctx) > 0 && RULES_BY_ID['keeps-onside'].evaluate(ctx, p).critical) { n.keptOnside++; assert.ok(k.stars <= 1, `${at}: keeps an attacker onside`); }
      if ((area.misconceptions ?? []).some((m) => inRegion(m.region, p))) { n.misconception++; assert.ok(k.stars <= 1, `${at}: in a misconception, ${k.stars} stars`); }
    }
  }
  // The corpus has each of these (keeping an attacker onside has its own fixture below; our box is rare).
  for (const key of ['offsideLesson', 'offsideSoft', 'wrongSide', 'pastBall', 'misconception']) assert.ok(n[key] > 20, `${key}: ${JSON.stringify(n)}`);
});

test('kidscore: keeping an attacker onside, and the wrong side of your mark in our box, are 1 star however near (fixtures)', () => {
  // Their right winger waits behind our line (tests/rules-defending.test.js RUNNER): drop deeper than the line and
  // you play him on.
  const RUNNER = { move: { 'them-RW': { x: 26, y: 12 } } };
  for (const id of ['us-LB', 'us-LCB']) {
    const base = posOf('oopMidBlock', id);
    const ctx = buildContext(makeFrame('oopMidBlock', RUNNER), { learnerId: id, base });
    const tol = toleranceFor(ctx.learner.role);
    const ghost = computeGhost(ctx, { base, tol });
    const area = kidArea(ctx, { best: ghost.spot, centre: base, tol, start: { x: base.x + 12, y: base.y }, stage: 'full' });
    assert.equal(kidStars(ctx, ghost.spot, area).stars, 3, id);
    assert.equal(kidStars(ctx, { x: ghost.spot.x - 1, y: ghost.spot.y }, area).stars, 3, `${id}: a metre deeper is still the line`);
    let kept = 0;
    for (let dx = 0.25; dx <= 5; dx += 0.25) {
      const p = { x: ghost.spot.x - dx, y: ghost.spot.y };
      if (!RULES_BY_ID['keeps-onside'].evaluate(ctx, p).critical) continue;
      kept++;
      const k = kidStars(ctx, p, area);
      assert.ok(k.stars <= 1 && k.keys.includes('kept-onside'), `${id} ${dx} m deeper: ${k.stars} ${k.keys}`);
    }
    assert.ok(kept >= 8, `${id}: ${kept}`);
    for (const v of kidOutline(ctx, area)) assert.ok(!RULES_BY_ID['keeps-onside'].evaluate(ctx, v).critical, `${id}: the green crosses the keeps-onside line at (${v.x}, ${v.y})`);
  }
  // Their #9 in our box, marked by our RCB: behind him (nearer their goal) is the critical.
  const BOX = {
    ball: { x: 22, y: 58 }, possession: 'them', carrierId: 'them-LW', tags: {},
    us: { GK: { x: 3, y: 35 }, LB: { x: 12, y: 24 }, LCB: { x: 9, y: 31 }, RCB: { x: 9, y: 38 }, RB: { x: 18, y: 52 }, DM: { x: 20, y: 40 }, LCM: { x: 28, y: 30 }, RCM: { x: 26, y: 50 }, LW: { x: 36, y: 22 }, ST: { x: 45, y: 36 }, RW: { x: 32, y: 58 } },
    them: { GK: { x: 100, y: 34 }, LB: { x: 40, y: 64 }, LCB: { x: 70, y: 44 }, RCB: { x: 70, y: 24 }, RB: { x: 50, y: 8 }, DM: { x: 40, y: 36 }, LCM: { x: 30, y: 44 }, RCM: { x: 32, y: 26 }, LW: { x: 22.5, y: 58.5 }, ST: { x: 11, y: 36 }, RW: { x: 14, y: 22 } },
  };
  const base = { ...BOX.us.RCB };
  const ctx = buildContext(makeFrame(BOX), { learnerId: 'us-RCB', base });
  const tol = toleranceFor(ctx.learner.role);
  const ghost = computeGhost(ctx, { base, tol });
  const area = kidArea(ctx, { best: ghost.spot, centre: base, tol, stage: 'small' });
  assert.equal(kidStars(ctx, ghost.spot, area).stars, 3);
  let crit = 0;
  for (const d of [1, 1.5, 2, 2.5, 3, 4]) for (const p of ring(ghost.spot, d)) {
    if (!RULES_BY_ID['goal-side'].evaluate(ctx, p).critical) continue;
    crit++;
    const k = kidStars(ctx, p, area);
    assert.ok(k.stars <= 1 && k.keys.includes('wrong-side'), `(${p.x}, ${p.y}): ${k.stars} ${k.keys}`);
  }
  assert.ok(crit >= 10, `${crit}`);
});

test('kidscore: the green never straddles a hard line or reaches toward the start, and every point drawn earns 3 stars', () => {
  for (const { q, spots } of judged) {
    const { ctx, area, ghost } = q.r;
    const at = `${q.label} ${q.stage}`;
    const offW = RULES_BY_ID.offside.weight(ctx) > 0, gsW = RULES_BY_ID['goal-side'].weight(ctx) > 0, koW = RULES_BY_ID['keeps-onside'].weight(ctx) > 0;
    const prW = RULES_BY_ID.press.weight(ctx) > 0;
    const g = goalSideRef(ctx);
    // The first defender's goal-side line: level with the ball (the press rule's own 'wrong-side' is behind it).
    const ref = ctx.carrier ?? ctx.ball;
    const gl = dist(ref, OWN_GOAL), u = { x: (OWN_GOAL.x - ref.x) / gl, y: (OWN_GOAL.y - ref.y) / gl };
    const pts = kidOutline(ctx, area);
    assert.equal(pts.length, K.outline.rays, at);
    // The green is an area, not a point: a quarter of its rays or more reach 2 m (a best spot on the touchline or the
    // offside line leaves about half).
    assert.ok(pts.filter((v) => v.r >= 2).length >= K.outline.rays / 4, `${at}: the green ${pts.map((v) => v.r.toFixed(1)).join(' ')}`);
    // The 3-star set (every drawn vertex, and every spot of the rings with 3 stars) keeps to one side of each line.
    const green = [...pts, ...spots.filter((x) => x.k.stars === 3).map((x) => x.p)];
    for (const v of green) {
      const w = `${at} (${v.x.toFixed(2)}, ${v.y.toFixed(2)})`;
      if (pts.includes(v)) assert.equal(kidStars(ctx, v, area).stars, 3, `${w}: drawn green but not 3 stars`);
      if (offW) assert.ok(RULES_BY_ID.offside.evaluate(ctx, v).vars.beyond <= K.offsideMargin, `${w}: the green crosses the offside line`);
      if (gsW && g) assert.ok(dist(g, OWN_GOAL) - dist(v, OWN_GOAL) >= -K.goalSideMargin, `${w}: the green crosses the goal-side line`);
      if (koW) assert.ok(!RULES_BY_ID['keeps-onside'].evaluate(ctx, v).critical, `${w}: the green keeps an attacker onside`);
      if (prW) assert.ok((v.x - ref.x) * u.x + (v.y - ref.y) * u.y >= 0, `${w}: the green reaches round the ball you press (behind it)`);
      if (area.cap) {
        const proj = (v.x - ghost.spot.x) * area.cap.u.x + (v.y - ghost.spot.y) * area.cap.u.y;
        assert.ok(proj <= K.capFrac[3] * area.cap.D + 1e-6, `${w}: the green reaches ${(proj / area.cap.D).toFixed(2)} of the way to the start`);
      }
    }
  }
});

test('kidscore: a mirrored drill earns the same stars at the mirrored spots', () => {
  let n = 0;
  for (const d of drills.filter((x) => x.group === 'authored' && !x.mirror)) {
    const m = drills.find((x) => x.mirror && x.of === d.of);
    for (const stage of STAGES) {
      const a = d.st[stage], b = m.st[stage];
      assert.equal(!!a, !!b, `${d.label} ${stage}: staged once only`);
      if (!a) continue;
      for (const r of [1, 2, 3, 4, 5, 6, 7]) for (const p of ring(a.ghost.spot, r)) {
        const pm = { x: p.x, y: WIDTH - p.y };
        const ka = kidStars(a.ctx, p, a.area), kb = kidStars(b.ctx, pm, b.area);
        n++;
        assert.equal(ka.stars, kb.stars, `${d.label} ${stage} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}): ${ka.stars} ${ka.keys} vs ${kb.stars} ${kb.keys}`);
      }
    }
  }
  assert.ok(n > 5000, `${n}`);
});

test('kidscore: Coach mode is untouched: kidStars carries evaluate() as it is, and Coach mode lifts a spot outside the green up to Great', () => {
  let lifted = 0;
  for (const { q, spots } of judged.filter((_, i) => i % 3 === 0)) {
    const { ctx, area } = q.r;
    assert.deepEqual(area.zone.center, { x: q.r.centre.x, y: q.r.centre.y });
    assert.deepEqual(area.zone.tol, { tx: q.r.tol.tx, ty: q.r.tol.ty });
    for (const { p, k } of spots.filter((_, i) => i % 4 === 0)) {
      assert.deepEqual(k.coach, evaluate(ctx, p, { center: q.r.centre, tol: q.r.tol }), `${q.label} ${q.stage}`);
      // Only the green gives 3 stars; outside it, with no key broken, never fewer than Coach mode's stars (up to Great).
      if (k.stars === 3) assert.equal(k.band, 3);
      const coach = K.starAt.filter((s) => k.coach.score >= s).length;
      if (!k.keys.length && k.band < 3) {
        assert.ok(k.stars >= Math.min(coach, K.coachLiftTo), `${q.label} ${q.stage}: ${k.stars} < Coach ${coach}`);
        if (k.stars > k.band) { lifted++; assert.equal(k.reason, 'coach'); }
      }
      assert.equal(k.inArea, k.stars === 3);
      assert.equal(k.word, KID_WORDS[k.stars]);
    }
  }
  assert.ok(lifted > 0);
});

test('kidscore: kidArea sizes the green from the position, the stage and the start', () => {
  const at = (id) => {
    const base = posOf('oopMidBlock', id);
    return { base, ctx: buildContext(makeFrame('oopMidBlock'), { learnerId: id, base }) };
  };
  const near = (a, x, y) => Math.abs(a.rx - x) < 1e-9 && Math.abs(a.ry - y) < 1e-9;
  const bands = (ctx, best, stage, extra = {}) => kidArea(ctx, { best, stage, ...extra }).bands;
  const { base: lb, ctx: cb } = at('us-LB'); // CB and FB: tolerance 2.5 x 4
  assert.ok(near(bands(cb, lb, 'small')[3], 3.5, 4), 'the floor lifts 2.5 to 3.5 m');
  assert.ok(near(bands(cb, lb, 'medium')[3], 3.85, 4.4));
  assert.ok(near(bands(cb, lb, 'full')[3], 4.2, 4.8));
  assert.ok(near(bands(cb, lb, 'full')[2], 6.2, 6.8) && near(bands(cb, lb, 'full')[1], 8.2, 8.8), 'grow2 and grow1');
  const { base: cm, ctx: cc } = at('us-LCM'); // CM: 5 x 6, the ceiling holds it to 5
  assert.ok(near(bands(cc, cm, 'small')[3], 5, 5) && near(bands(cc, cm, 'full')[3], 6, 6));
  assert.ok(near(bands(cc, cm, 'small', { tol: { tx: 1, ty: 2 } })[3], 3.5, 3.5), 'an authored tolerance, floored');
  assert.ok(near(kidArea(cc, { best: cm, stage: 'small', params: { floor: 3, ceil: 3 } }).bands[3], 3, 3), 'params override the defaults');
  // The start cap (a CM at the full match: a 6 m green, the start 10 m away): toward the start each band stops at
  // capFrac of the way (4.5, 5 and 5.5 m); away from it the ellipses are whole.
  const area = kidArea(cc, { best: cm, start: { x: cm.x + 10, y: cm.y }, stage: 'full' });
  approx(area.cap.D, 10);
  const band = (dx) => bandOf(area, { x: cm.x + dx, y: cm.y });
  assert.deepEqual([4.4, 4.6, 5.2, 5.6].map(band), [3, 2, 1, 0]);
  assert.deepEqual([-6, -6.1, -8.1, -10.1].map(band), [3, 2, 1, 0]);
  assert.equal(kidArea(cc, { best: cm, start: { x: cm.x + 10, y: cm.y }, hold: true }).cap, null, 'a hold drill has no start cap');
  assert.equal(kidArea(cc, { best: cm, start: cm }).cap, null, 'a start on the best spot has no direction');
  assert.deepEqual(kidArea(cb, { best: lb }).zone, { center: { x: lb.x, y: lb.y }, tol: { ...toleranceFor('LB') } }, 'the zone defaults to the base and the position');
  assert.throws(() => kidArea(cb, {}), TypeError);
});

test('kidscore: relationship names the key a rule result breaks, and its level', () => {
  const base = posOf('oopMidBlock', 'us-RCM');
  const ctx = buildContext(makeFrame('oopMidBlock'), { learnerId: 'us-RCM', base }); // our #8 presses their #8 on the ball
  assert.ok(RULES_BY_ID.press.weight(ctx) > 0);
  const area = kidArea(ctx, { best: base, lesson: { principle: 'D2', rules: ['press'] } });
  const carrier = ctx.carrier;
  const behind = { x: carrier.x + 3, y: carrier.y }; // past the ball, away from our goal
  const r = RULES_BY_ID.press.evaluate(ctx, behind);
  assert.deepEqual(relationship(ctx, behind, { id: 'press', weight: 3, ...r }, area, true), { key: 'wrong-side', level: 'hard' });
  const k = kidStars(ctx, behind, area);
  assert.ok(k.stars <= K.keyCap && k.broken.includes('press') && k.keys.includes('wrong-side'), JSON.stringify(k.keys));
  // Where the press rule wants you (goal-side, the angle that shows him away): no key.
  const ok = RULES_BY_ID.press.evaluate(ctx, base).target;
  assert.equal(relationship(ctx, ok, { id: 'press', weight: 3, ...RULES_BY_ID.press.evaluate(ctx, ok) }, area, true), null);
  // A rule with no key (distance is never a key): support-distance, spacing.
  assert.equal(relationship(ctx, behind, { id: 'spacing', weight: 1, s: 0, vars: {} }, area, false), null);
  // Offside: at a pass hard; past the line in an offside lesson 'lesson'; otherwise soft.
  const off = { id: 'offside', weight: 3, s: 0.2, vars: { beyond: 2 } };
  assert.deepEqual(relationship(ctx, behind, { ...off, critical: true }, area, false), { key: 'offside', level: 'hard' });
  assert.deepEqual(relationship(ctx, behind, off, { ...area, lesson: { principle: 'F4', rules: ['offside'] } }, false), { key: 'offside', level: 'lesson' });
  assert.deepEqual(relationship(ctx, behind, off, area, false), { key: 'offside', level: 'soft' });
  assert.equal(relationship(ctx, behind, { ...off, vars: { beyond: K.offsideMargin } }, area, false), null, 'level is onside');
  // Cover level with the presser: the lesson's key in a D3 lesson, a soft one otherwise.
  const cov = { id: 'cover', weight: 3, s: 0.3, vars: { depthRaw: 0.2, insideRaw: 1 } };
  assert.deepEqual(relationship(ctx, behind, cov, area, true), { key: 'level', level: 'lesson' });
  assert.deepEqual(relationship(ctx, behind, cov, area, false), { key: 'level', level: 'soft' });
});

test('kidscore: kidNearest ends the reveal arrow on the green', () => {
  let n = 0;
  for (const { q, spots } of judged.filter((_, i) => i % 5 === 0)) {
    const { ctx, area } = q.r;
    const pts = kidOutline(ctx, area);
    for (const { p, k } of spots.filter((x) => x.d >= 5 && x.d <= 8)) {
      const e = kidNearest(ctx, area, p, { outline: pts });
      if (k.stars === 3) { assert.deepEqual(e, { x: p.x, y: p.y }); continue; }
      n++;
      const dv = Math.min(...pts.map((v) => dist(p, v)));
      assert.ok(dist(p, e) <= dv + 1e-9, `${q.label}: the arrow ends ${dist(p, e)} m away, a vertex is ${dv}`);
      assert.ok(dist(e, area.center) <= Math.max(...pts.map((v) => v.r)) + 1e-9);
    }
  }
  assert.ok(n > 100);
  const { q } = judged[0];
  assert.deepEqual(kidNearest(q.r.ctx, q.r.area, q.r.start), kidNearest(q.r.ctx, q.r.area, q.r.start, { outline: kidOutline(q.r.ctx, q.r.area) }));
});

test('kidscore: kidLive (Match day): the last second of best spots count, never colder than Coach mode, capped by a key now', () => {
  const q = reps.find((x) => x.group === 'authored' && x.stage === 'full' && RULES_BY_ID.press.weight(x.r.ctx) > 0);
  assert.ok(q, 'a pressing drill');
  const { ctx, centre, tol, ghost } = q.r;
  const g = ghost.spot, old = { x: g.x - 1, y: g.y + 0.5 }, jumped = { x: g.x + 1, y: g.y + 12 };
  // The ghost jumped 12 m: a spot in the green of the ghost of a moment ago is still hot.
  const live = kidLive(ctx, old, { recent: [g, jumped], centre, tol, coachScore: 0 }); // oldest first
  assert.equal(live.stars, 3);
  assert.equal(live.heat, 'hot');
  assert.deepEqual(live.best, g, 'the best spot whose area gave the stars (the hardest moment draws its green)');
  const newest = kidLive(ctx, g, { recent: [jumped], centre, tol, coachScore: 0 });
  assert.ok(newest.stars < 3, 'without the memory it is not');
  // Never colder than Coach mode's heat (hot at 70, warm at 50).
  assert.equal(kidLive(ctx, g, { recent: [jumped], centre, tol, coachScore: 70 }).heat, 'hot');
  assert.equal(kidLive(ctx, g, { recent: [jumped], centre, tol, coachScore: 50 }).heat, 'warm');
  // A key now caps it, whatever Coach mode's score.
  const carrier = ctx.carrier ?? ctx.ball;
  const behind = { x: carrier.x + 3, y: carrier.y };
  const k = kidLive(ctx, behind, { recent: [behind], centre, tol, coachScore: 100 });
  assert.ok(k.stars <= 1 && k.heat === 'cold' && k.keys.includes('wrong-side'), JSON.stringify({ stars: k.stars, keys: k.keys }));
  // A run's stars from the share of its time Hot.
  assert.deepEqual([1, 0.75, 0.74, 0.5, 0.49, 0.3, 0.29, 0, NaN].map((s) => kidRunStars(s)), [3, 3, 2, 2, 1, 1, 0, 0, 0]);
  assert.equal(kidRunStars(0.6, { liveRunStars: { 3: 0.6, 2: 0.4, 1: 0.2 } }), 3);
});

test('kidscore: the gates report Player mode stars (stageSpotDrill, checkSpotDrill, npm run check), and a drill whose best spot is where YOU start fails', () => {
  const raw = authored[0];
  const st = stageSpotDrill(raw, 'full', { formations, principles: catalogue });
  assert.equal(st.gates.kidBest, 3);
  assert.equal(st.gates.kidStart, 0);
  assert.equal(st.area.stage, 'full');
  assert.deepEqual(st.area.lesson?.rules ?? null, st.lesson?.rules ?? null);
  assert.equal(st.area.misconceptions.length, (raw.misconceptions ?? []).length);
  const c = checkScenario(raw, { principles: catalogue, formations });
  assert.deepEqual([c.kid.start, c.kid.best], [0, 3]);
  const gen = drills.find((d) => d.group === 'generated').s;
  const chk = checkSpotDrill(gen, { formations, principles: catalogue });
  assert.deepEqual([chk.kidStart, chk.kidBest], [0, 3]);
  assert.deepEqual(chk.problems, []);
  // lessonOf is exported for play.js's repScene: the staged rep's lesson is the full game's.
  const full = stagesOf(gen, { formations, principles: catalogue }).full;
  assert.deepEqual(lessonOf(gen.principles, full.ghost.result, catalogue), full.lesson);
  // YOU start on the best spot: standing still there is right, so the best spot earns no stars (the gate fails).
  const moved = { ...gen, learner: { ...gen.learner, start: { x: chk.ghost.spot.x + 0.5, y: chk.ghost.spot.y } } };
  const bad = checkSpotDrill(moved, { formations, principles: catalogue });
  assert.ok(bad.problems.some((p) => /the best spot earns 0 stars in Player mode/.test(p)), bad.problems.join('; '));
});

test('kidscore: speed (kidStars per spot, kidOutline per rep)', () => {
  const { ctx, area, ghost } = reps[0].r;
  const g = ghost.spot;
  const one = timed(() => { for (let i = 0; i < 200; i++) kidStars(ctx, { x: g.x + (i % 13) - 6, y: g.y + (i % 7) - 3 }, area); }, { runs: 5 });
  assert.ok(one.median / 200 < 0.05 * PERF_SLACK, `kidStars ${(one.median * 5).toFixed(1)} µs a spot`);
  const out = timed(() => kidOutline(ctx, area), { runs: 5 });
  assert.ok(out.median < 20 * PERF_SLACK, `kidOutline ${out.median.toFixed(2)} ms`);
});
