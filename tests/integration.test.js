// End to end with the real HELIOS table and the real rule registry: for each canonical situation
// (tests/situations.js) and every learnable role, autoFrame → learnerBase → buildContext →
// computeGhost → evaluate / explain (js/engine/analyse.js). Holds the engine to the acceptance
// criteria of RESEARCH 9.5: the ghost scores S, far spots fail, criticals cap, every failing rule
// can be put into words in both wordings, mirrored scenes give mirrored answers, and it is fast.
import { test, assert, loadJSON } from './harness.js';
import { SITUATIONS, sceneOptions, mirrorSituation } from './situations.js';
import { createFormation } from '../js/engine/formation.js';
import { analyseScene, judgeSpot } from '../js/engine/analyse.js';
import { autoFrame } from '../js/engine/scene.js';
import { computeGhost, GHOST_DEFAULTS } from '../js/engine/ghost.js';
import { evaluate, CRITICAL_CAP } from '../js/engine/score.js';
import { EXPLAIN_DEFAULTS } from '../js/engine/explain.js';
import { RULES_BY_ID } from '../js/engine/rules/index.js';
import { LEARNABLE_ROLES, ROLE_INFO, playerId, mirrorPlayerId } from '../js/engine/roles.js';
import { WIDTH, LANE_EDGES, onPitch } from '../js/engine/pitch.js';
import { dist } from '../js/engine/geometry.js';

const F = createFormation(await loadJSON('data/formations/helios-433.json'));
const formations = { us: F, them: F };
const principles = (await loadJSON('data/principles.json')).principles;
const byId = Object.fromEntries(principles.map((p) => [p.id, p]));

const SENTENCE = /^[A-Z].*[.!?]$/;
const ring = (c, r, n = 16) => Array.from({ length: n }, (_, k) => ({ x: c.x + r * Math.cos((2 * Math.PI * k) / n), y: c.y + r * Math.sin((2 * Math.PI * k) / n) }))
  .filter((p) => onPitch(p));

// Every situation × learnable role, analysed once (the tests below share these).
const CASES = [];
for (const situation of SITUATIONS) {
  for (const role of LEARNABLE_ROLES) {
    const id = playerId('us', role);
    const scene = analyseScene(sceneOptions(situation, id, formations));
    CASES.push({ situation, role, id, scene, label: `${situation.id} / ${role}` });
  }
}

/** The worst on-pitch spot `r` metres from the ghost (the deliberately bad spot of the sanity report). */
function worstAt(scene, r) {
  let worst = null;
  for (const p of ring(scene.ghost.spot, r)) {
    const e = evaluate(scene.ctx, p);
    if (!worst || e.raw < worst.result.raw) worst = { spot: p, result: e };
  }
  return worst;
}

test('integration: every situation places 22 players on the pitch and gives a base on the pitch', () => {
  assert.equal(CASES.length, SITUATIONS.length * LEARNABLE_ROLES.length);
  assert.equal(LEARNABLE_ROLES.length, 10);
  for (const { scene, label } of CASES) {
    assert.equal(scene.frame.players.length, 22, label);
    for (const p of scene.frame.players) assert.ok(onPitch(p), `${label}: ${p.id} off the pitch`);
    assert.ok(onPitch(scene.base), `${label}: base`);
    assert.ok(scene.frame.carrierId !== scene.ctx.learner.id, `${label}: the learner never carries`);
  }
});

test('integration: the ghost scores S (>= 90) for every situation and role, and is not a critical fail', () => {
  const low = [];
  for (const { scene, label } of CASES) {
    const { ghost, ctx } = scene;
    if (ghost.score < 90) low.push(`${label} ${ghost.score} at (${ghost.spot.x}, ${ghost.spot.y})`);
    assert.equal(ghost.result.critical, false, `${label}: ghost is a critical fail`);
    assert.equal(ghost.score, evaluate(ctx, ghost.spot).score, `${label}: ghost score is evaluate() at the ghost`);
    assert.ok(dist(ghost.spot, scene.base) <= GHOST_DEFAULTS.radius + 1e-9, label);
  }
  assert.deepEqual(low, [], `ghosts below 90:\n${low.join('\n')}`);
});

test('integration: a spot 20 m from the ghost (and outside the ghost search around the base) scores <= 40', () => {
  // The ghost can sit up to the search radius (15 m) from the base, so a spot 20 m from the ghost
  // can be as close as 5 m to the base, a spot the engine itself would have considered. Those are
  // left out; every spot outside the search disc must fail.
  const high = [];
  for (const { scene, label } of CASES) {
    const spots = ring(scene.ghost.spot, 20, 32).filter((p) => dist(p, scene.base) > GHOST_DEFAULTS.radius);
    assert.ok(spots.length >= 6, `${label}: only ${spots.length} far spots`);
    for (const p of spots) {
      const s = evaluate(scene.ctx, p).score;
      if (s > 40) high.push(`${label} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) scored ${s}`);
    }
  }
  assert.deepEqual(high, [], `far spots above 40:\n${high.join('\n')}`);
});

test('integration: the 8 m-off spot scores well below the ghost, with reasons, a fix toward the ghost and a cue', () => {
  for (const { scene, label } of CASES) {
    const bad = worstAt(scene, 8);
    assert.ok(bad, label);
    assert.ok(bad.result.score <= scene.ghost.score - 15, `${label}: 8 m off scored ${bad.result.score} vs ghost ${scene.ghost.score}`);
    for (const wording of ['standard', 'kid']) {
      const { feedback } = judgeSpot(scene, bad.spot, { wording, principles: byId });
      assert.ok(feedback.reasons.length >= 1, `${label} ${wording}: no reasons for a spot scoring ${bad.result.score}`);
      for (const r of feedback.reasons) {
        assert.match(r.text, SENTENCE, `${label} ${wording}: "${r.text}"`);
        assert.ok(!r.text.includes('not quite there yet'), `${label} ${wording}: fallback sentence for ${r.ruleId}`);
        assert.ok(byId[r.principleId], `${label}: ${r.ruleId} maps to principle ${r.principleId}`);
      }
      assert.ok(feedback.fix, `${label} ${wording}: no fix`);
      assert.match(feedback.fix.text, SENTENCE);
      // The fix points from the spot to the ghost.
      assert.ok(Math.abs(bad.spot.x + feedback.fix.dx - scene.ghost.spot.x) < 1e-9 && Math.abs(bad.spot.y + feedback.fix.dy - scene.ghost.spot.y) < 1e-9, label);
      assert.ok(feedback.cue && feedback.cue.text.endsWith('?'), `${label} ${wording}: cue ${feedback.cue?.text}`);
    }
  }
});

test('integration: every failing rule yields one sentence in both wordings, with no gaps in the template', () => {
  const failBelow = EXPLAIN_DEFAULTS.failBelow;
  const seen = new Set();
  for (const { scene, label } of CASES) {
    const spots = [scene.ghost.spot, ...ring(scene.ghost.spot, 4, 8), ...ring(scene.ghost.spot, 8, 8), ...ring(scene.ghost.spot, 14, 8)];
    for (const p of spots) {
      for (const r of evaluate(scene.ctx, p).rules) {
        if (!(r.critical || r.s < failBelow)) continue;
        const rule = RULES_BY_ID[r.id];
        for (const wording of ['standard', 'kid']) {
          const text = rule.text[wording].fail(r.vars);
          const where = `${label} ${r.id} (${wording}) at (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
          assert.equal(typeof text, 'string', where);
          assert.match(text, SENTENCE, `${where}: "${text}"`);
          assert.ok(!/undefined|NaN|\[object|null/.test(text), `${where}: "${text}"`);
          assert.ok((text.match(/[.!?](\s|$)/g) ?? []).length === 1, `${where}: one sentence: "${text}"`);
          if (wording === 'kid') assert.ok(text.split(/\s+/).length <= 15, `${where}: kid text over 15 words: "${text}"`);
          const cue = rule.text[wording].cue(r.vars);
          assert.ok(typeof cue === 'string' && cue.endsWith('?'), `${where}: cue "${cue}"`);
        }
        seen.add(r.id);
      }
    }
  }
  // The situations exercise most of the registry's failure texts.
  assert.ok(seen.size >= 12, `failing rules seen: ${[...seen].join(', ')}`);
});

test('integration: a broken critical rule caps the score at 59, and the situations do break them', () => {
  // Pass moments make offside critical; with their #9 left waiting in an offside position, a back-liner
  // who drops deep keeps him onside (and nobody marks him there: U4, context offsideMarkMargin); and with
  // their #9 onside in our box, the defender marking him breaks goal-side on the wrong side of him.
  const backXOf = (s) => CASES.find((c) => c.situation === s).scene.ctx.lines.ourBackLineX;
  const runner = (s) => ({ ...s, id: `${s.id}+offside-runner`, overrides: { 'them-ST': { x: backXOf(s) - 3, y: 30 } } });
  const boxRunner = (s) => ({ ...s, id: `${s.id}+box-runner`, overrides: { 'them-ST': { x: backXOf(s) + 0.5, y: 30 } } });
  const variants = [
    ...SITUATIONS,
    ...SITUATIONS.filter((s) => s.possession === 'us').map((s) => ({ ...s, id: `${s.id}+pass`, tags: { event: 'pass' } })),
    ...SITUATIONS.filter((s) => s.possession === 'them' && s.ball.x < 70).map(runner),
    ...SITUATIONS.filter((s) => s.possession === 'them' && backXOf(s) + 0.5 < 16.5).map(boxRunner),
  ];
  const broken = new Map();
  for (const situation of variants) {
    for (const role of LEARNABLE_ROLES) {
      const id = playerId('us', role);
      const scene = analyseScene(sceneOptions(situation, id, formations));
      const { x0, y0, step, cols, rows } = scene.ghost.field;
      for (let r = 0; r < rows; r += 2) {
        for (let c = 0; c < cols; c += 2) {
          const e = evaluate(scene.ctx, { x: x0 + c * step, y: y0 + r * step });
          if (!e.critical) continue;
          assert.ok(e.score <= CRITICAL_CAP, `${situation.id} / ${role}: critical spot scored ${e.score}`);
          for (const rr of e.rules) if (rr.critical) broken.set(rr.id, (broken.get(rr.id) ?? 0) + 1);
        }
      }
    }
  }
  for (const id of ['offside', 'keeps-onside', 'goal-side']) assert.ok(broken.get(id) > 0, `no critical ${id} found (${JSON.stringify([...broken])})`);
});

test('integration: mirror symmetry - a left/right mirrored situation gives the mirrored ghost for the mirrored role', () => {
  for (const { situation, id, scene, label } of CASES) {
    const m = mirrorSituation(situation);
    const mid = mirrorPlayerId(id);
    const ms = analyseScene(sceneOptions(m, mid, formations));
    const d = Math.hypot(ms.ghost.spot.x - scene.ghost.spot.x, ms.ghost.spot.y - (WIDTH - scene.ghost.spot.y));
    assert.ok(d <= 0.5, `${label}: ghost (${scene.ghost.spot.x}, ${scene.ghost.spot.y}) vs mirrored (${ms.ghost.spot.x}, ${ms.ghost.spot.y})`);
    assert.equal(ms.ghost.score, scene.ghost.score, label);
    assert.ok(Math.abs(ms.base.x - scene.base.x) < 1e-6 && Math.abs(ms.base.y - (WIDTH - scene.base.y)) < 1e-6, `${label}: base`);
    assert.equal(ms.ctx.duty, scene.ctx.duty, `${label}: duty`);
  }
});

test('integration: the situations read like football (block heights, build-up shape, who presses and covers)', () => {
  const block = { 'their-build-up': 'high', 'mid-block-half-space': 'mid', 'defending-left-wing': 'low' };
  for (const { situation, role, scene, label } of CASES) {
    const { ctx, ghost, frame } = scene;
    if (block[situation.id]) assert.equal(ctx.blockHeight, block[situation.id], `${label}: block height`);
    if (ctx.duty === 'first-defender') {
      const d = dist(ghost.spot, ctx.carrier ?? ctx.ball);
      assert.ok(d >= 1 && d <= 3.5, `${label}: the first defender's ghost is ${d.toFixed(1)} m from the ball`);
      assert.ok(ghost.spot.x < (ctx.carrier ?? ctx.ball).x, `${label}: presses from the goal side`);
    }
    if (ctx.duty === 'second-defender') {
      assert.ok(ghost.spot.x < ctx.firstDefender.x - 1, `${label}: the cover sits behind the presser`);
    }
    if (situation.id === 'our-build-up') {
      // The centre-backs split into the half-spaces and the full-backs go to the wing lanes (R1, B10).
      const at = (r) => (r === role ? scene.base : frame.players.find((p) => p.id === `us-${r}`));
      assert.ok(at('RCB').y - at('LCB').y >= 24, `${label}: centre-backs split (${at('LCB').y.toFixed(1)}, ${at('RCB').y.toFixed(1)})`);
      assert.ok(at('LB').y <= LANE_EDGES[1] && at('RB').y >= LANE_EDGES[4], `${label}: full-backs wide (${at('LB').y.toFixed(1)}, ${at('RB').y.toFixed(1)})`);
    }
    if (ROLE_INFO[role].family === 'W' && situation.id === 'our-build-up') {
      assert.ok(Math.min(ghost.spot.y, WIDTH - ghost.spot.y) <= 5, `${label}: the winger holds the width`);
    }
  }
});

test('integration: out of possession the auto-placed #8s and wingers stand goal-side of the opponent assigned to them (D5, R4)', () => {
  for (const { situation, role, scene, label } of CASES) {
    if (situation.possession === 'us' || !['CM', 'W'].includes(ROLE_INFO[role].family)) continue;
    const m = scene.ctx.markTarget;
    if (scene.ctx.duty !== 'third-defender' || !m) continue;
    assert.ok(scene.base.x <= m.x, `${label}: base x ${scene.base.x.toFixed(1)} vs ${m.id} at ${m.x.toFixed(1)}`);
  }
});

test('integration: judgeSpot judges against the ghost search zone, so a spot on the ghost scores the ghost score', () => {
  // An authored-answer drill passes its ideal as the zone centre (ghost.base); judging must use the same centre.
  for (const { situation, id, scene, label } of CASES.filter((c) => c.role === 'LCB' || c.role === 'ST')) {
    const ideal = { x: scene.base.x - 4, y: scene.base.y + 3 };
    const authored = analyseScene({ ...sceneOptions(situation, id, formations), ghost: { base: ideal } });
    for (const sc of [scene, authored]) {
      const { result, feedback } = judgeSpot(sc, sc.ghost.spot);
      assert.equal(result.score, sc.ghost.score, `${label}: judged ${result.score}, ghost ${sc.ghost.score}`);
      assert.deepEqual(result.center, sc.ghost.result.center, label);
      // Nothing to fix on the best spot: what it gives up is a trade-off, never a reason or a cue.
      assert.deepEqual(feedback.reasons.map((r) => r.text), [], `${label}: reasons on the ghost`);
      assert.equal(feedback.cue, null, `${label}: cue on the ghost`);
      assert.equal(feedback.fix, null, `${label}: fix on the ghost`);
    }
    assert.deepEqual(authored.ghost.result.center, ideal, `${label}: the authored centre`);
  }
});

test('integration: HELIOS placement is continuous along the centre line (no player flips for a 2 cm ball move)', () => {
  // The reviewed failure: separation turned near-coincident pairs into 2-4 m flips for a 1 cm ball move
  // (players crossing exactly on y = 34). A continuous placement moves nobody far for a tiny ball move.
  const step = 0.02;
  const worst = { d: 0 };
  for (const possession of ['us', 'them', 'none']) {
    let prev = null;
    for (let i = 0, x = 1; x <= 104; x = 1 + ++i * step) {
      const f = autoFrame({ formations, ball: { x, y: 34 }, possession });
      if (prev?.carrierId === f.carrierId) {
        f.players.forEach((p, k) => {
          const d = dist(p, prev.players[k]);
          if (d > worst.d) Object.assign(worst, { d, id: p.id, x, possession });
        });
      }
      prev = f;
    }
  }
  assert.ok(worst.d < 0.5, `${worst.id} moved ${worst.d.toFixed(2)} m for a ${step} m ball move at x = ${worst.x?.toFixed(2)} (${worst.possession})`);
});

test('integration: ghost search averages under 30 ms (RESEARCH 9.5 heatmap budget)', () => {
  const ctxs = CASES.map((c) => c.scene.ctx);
  for (const ctx of ctxs.slice(0, 5)) computeGhost(ctx); // warm up
  const t0 = performance.now();
  for (const ctx of ctxs) computeGhost(ctx);
  const perGhost = (performance.now() - t0) / ctxs.length;
  assert.ok(perGhost < 30, `computeGhost averages ${perGhost.toFixed(2)} ms`);
  // The whole loop (placement, base, context, ghost) stays inside the same budget.
  const t1 = performance.now();
  for (const { situation, id } of CASES) analyseScene(sceneOptions(situation, id, formations));
  const perScene = (performance.now() - t1) / CASES.length;
  assert.ok(perScene < 30, `analyseScene averages ${perScene.toFixed(2)} ms`);
});
