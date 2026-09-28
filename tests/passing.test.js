// js/engine/passing.js: rating every pass option, grading the learner's choice and saying why (docs/research/passing.md §4).
import { test, assert, approx, loadJSON, timed, isNode, PERF_SLACK } from './harness.js';
import {
  PASS_DEFAULTS, STAR_BANDS, starsForScore, value, lossCost, execProb, laneRisk, pressureAt, roomAt, raceAt, markedBy, oppLines, swapTeams,
  kidName, rateOptions, gradePass, explainPass, optionOf, allPassTexts, PASS_TAGS, PASS_HEADLINES,
} from '../js/engine/passing.js';
import { createFormation } from '../js/engine/formation.js';
import { autoFrame } from '../js/engine/scene.js';
import { buildContext } from '../js/engine/context.js';
import { offsideLineX } from '../js/engine/rules/offside.js';
import { mirrorPlayerId, parsePlayerId } from '../js/engine/roles.js';
import { makeFrame } from './fixtures.js';

const F = createFormation(await loadJSON('data/formations/helios-433.json'));
const formations = { us: F, them: F };
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const CODE = /\b[A-Z]{1,2}\d{1,2}\b|#\d/; // principle codes, role numbers
const SIDE = /\b(left|right)\b/i;

/** A frame from explicit spots: us and them as { role: [x, y] }; every other player parked out of play (ours by our
 *  goal line, theirs along the far touchline in our half, so they never set their offside line). */
function frameOf({ ball, carrierId, us, them }) {
  const roles = ['GK', 'LCB', 'RCB', 'LB', 'RB', 'DM', 'LCM', 'RCM', 'LW', 'RW', 'ST'];
  const park = { us: (i) => ({ x: 2, y: 3 + i * 6 }), them: (i) => ({ x: 8 + i * 3, y: 67 }) };
  const players = [];
  for (const team of ['us', 'them']) {
    roles.forEach((role, i) => {
      const at = (team === 'us' ? us : them)[role];
      const p = at ? { x: at[0], y: at[1] } : park[team](i);
      players.push({ id: `${team}-${role}`, team, role, ...p });
    });
  }
  return { t: 0, ball, possession: 'us', carrierId, players, tags: {} };
}

/** Left/right mirror of a frame: y → 68 - y, roles and ids L↔R. */
function mirrorFrame(f) {
  return {
    ...f, ball: { x: f.ball.x, y: 68 - f.ball.y }, carrierId: mirrorPlayerId(f.carrierId),
    players: f.players.map((p) => { const id = mirrorPlayerId(p.id); return { ...p, id, role: parsePlayerId(id).role, y: 68 - p.y }; }),
  };
}
const mirrorOptionId = (id) => id.replace(/^[^@]+/, (p) => mirrorPlayerId(p));

/**
 * Milliseconds of CPU per call: in Node this process's CPU time (process.cpuUsage), which other test files running side
 * by side (npm test) do not inflate as they do the wall clock; in the browser the wall clock (harness.js timed). The
 * median of `runs` runs after a warm-up, so a speed test catches an order-of-magnitude slowdown and does not flake.
 */
function cpuTimed(fn, { warmup = 2, runs = 7, reps = 1 } = {}) {
  if (!isNode || typeof process.cpuUsage !== 'function') return timed(fn, { warmup, runs, reps });
  for (let i = 0; i < warmup; i++) fn();
  const ts = [];
  for (let r = 0; r < runs; r++) {
    const c0 = process.cpuUsage();
    for (let i = 0; i < reps; i++) fn();
    const c = process.cpuUsage(c0);
    ts.push((c.user + c.system) / 1000 / reps);
  }
  return { median: [...ts].sort((a, b) => a - b)[Math.floor(ts.length / 2)], runs: ts };
}

const SCENES = [
  ['fixture build-up', makeFrame('ipBuildUp')],
  ['keeper build-up', autoFrame({ formations, ball: { x: 6, y: 30 }, possession: 'us', carrierId: 'us-GK' })],
  ['pressed full-back', autoFrame({ formations, ball: { x: 30, y: 8 }, possession: 'us', carrierId: 'us-LB' })],
  ['#6 in midfield', autoFrame({ formations, ball: { x: 45, y: 34 }, possession: 'us', carrierId: 'us-DM' })],
  ['#8 in the half-space', autoFrame({ formations, ball: { x: 58, y: 22 }, possession: 'us', carrierId: 'us-LCM' })],
  ['winger in the final third', autoFrame({ formations, ball: { x: 82, y: 56 }, possession: 'us', carrierId: 'us-RW' })],
  ['winger near the end line', autoFrame({ formations, ball: { x: 97, y: 8 }, possession: 'us', carrierId: 'us-LW' })],
];

test('building blocks: execution by length, our value surface, the cost of losing it', () => {
  approx(execProb(0), 1, 1e-12);
  approx(execProb(PASS_DEFAULTS.execHalf), 0.5 / (1 / (1 + Math.exp(-PASS_DEFAULTS.execHalf / PASS_DEFAULTS.execWidth))), 1e-9);
  approx(execProb(25), 0.96, 0.01);
  approx(execProb(40), 0.78, 0.01);
  // research/passing.md §4.2 item 6: V at our box, halfway, zone 14 and the penalty spot.
  approx(value({ x: 10, y: 34 }), 0.004, 0.001);
  approx(value({ x: 52.5, y: 34 }), 0.016, 0.001);
  approx(value({ x: 82, y: 34 }), 0.085, 0.001);
  approx(value({ x: 94, y: 34 }), 0.254, 0.001);
  for (let x = 10; x < 100; x += 10) assert.ok(value({ x: x + 5, y: 34 }) > value({ x, y: 34 }), `V rises toward goal at x ${x}`);
  approx(value({ x: 80, y: 10 }), value({ x: 80, y: 58 }), 1e-12);
  assert.ok(lossCost({ x: 10, y: 34 }) > 10 * lossCost({ x: 94, y: 34 }), 'losing it in front of our goal costs far more');
  assert.ok(lossCost({ x: 100, y: 34 }) >= PASS_DEFAULTS.possessionCost);
});

test('building blocks: a defender on the line blocks the pass; one the receiver beats to the ball does not', () => {
  const ball = { x: 30, y: 30 }, target = { x: 50, y: 30 };
  const onLine = laneRisk(ball, target, [{ id: 'them-DM', role: 'DM', x: 40, y: 30.3 }], PASS_DEFAULTS, target);
  assert.ok(onLine.pLane < 0.15, `pLane ${onLine.pLane.toFixed(2)} with a defender on the line`);
  assert.equal(onLine.top.id, 'them-DM');
  assert.ok(onLine.top.pBlock >= onLine.top.pRun, 'it is a body block');
  const clear = laneRisk(ball, target, [{ id: 'them-DM', role: 'DM', x: 40, y: 45 }], PASS_DEFAULTS, target);
  assert.ok(clear.pLane > 0.95, `pLane ${clear.pLane.toFixed(2)} with the defender 15 m off the line`);
  // The receiver steps to meet the ball: a defender 7 m beyond the receiver loses that race (research §4.2 item 1).
  const long = { x: 61, y: 30 };
  const behind = laneRisk(ball, long, [{ id: 'them-LW', role: 'LW', x: 68, y: 30 }], PASS_DEFAULTS, long);
  assert.ok(behind.pLane > 0.9, `pLane ${behind.pLane.toFixed(2)}: the receiver meets the ball first`);
  // Their keeper only counts in his box.
  const keeper = laneRisk(ball, target, [{ id: 'them-GK', role: 'GK', x: 40, y: 30 }], PASS_DEFAULTS, target);
  approx(keeper.pLane, 1, 1e-12);
});

test('building blocks: pressure is an oval toward goal, room is the free run, the race into space', () => {
  const p = { x: 60, y: 34 };
  const inFront = pressureAt(p, [{ id: 'them-LCB', role: 'LCB', x: 62, y: 34 }]).pressure;
  const behind = pressureAt(p, [{ id: 'them-LCB', role: 'LCB', x: 58, y: 34 }]).pressure;
  assert.ok(inFront > behind && behind > 0, `in front ${inFront.toFixed(2)}, behind ${behind.toFixed(2)}`);
  assert.equal(pressureAt(p, [{ id: 'them-LCB', role: 'LCB', x: 70, y: 34 }]).pressure, 0, '10 m away is no pressure');
  assert.equal(pressureAt(p, [{ id: 'them-GK', role: 'GK', x: 61, y: 34 }]).pressure, 0, 'the keeper does not press');
  assert.equal(roomAt(p, []).room, PASS_DEFAULTS.roomCap);
  approx(roomAt(p, [{ id: 'them-LCB', role: 'LCB', x: 66, y: 34 }]).room, 6 - PASS_DEFAULTS.roomMargin, 1e-9);
  const runner = { x: 60, y: 10 }, space = { x: 70, y: 10 };
  assert.ok(raceAt(space, runner, [{ id: 'them-RB', role: 'RB', x: 90, y: 10 }], 1).pWin > 0.8, 'our runner is much nearer');
  assert.ok(raceAt(space, runner, [{ id: 'them-RB', role: 'RB', x: 71, y: 10 }], 1).pWin < 0.3, 'their defender is standing there');
});

test('race into space: a marker level with the runner or goal-side of him, within about 3 m, contests the ball; one he is past, or far off, does not', () => {
  const runner = { x: 80, y: 20 }, space = { x: 92, y: 20 }, tBall = 18 / PASS_DEFAULTS.ballSpeed;
  const race = (x, y) => raceAt(space, runner, [{ id: 'them-RCB', role: 'RCB', x, y }], tBall).pWin;
  const level = race(80, 22), goalSide = race(81, 21), past = race(77, 21), far = race(80, 26);
  // Before: a centre-back level with the runner and 2 m from him reacted 0.4 s later than the runner and lost the race 7 in 10.
  assert.ok(level > 0.4 && level < PASS_DEFAULTS.beatenBelow, `level, 2 m away: pWin ${level.toFixed(2)} (contested)`);
  assert.ok(goalSide < 0.45, `goal-side: pWin ${goalSide.toFixed(2)} (he gets there first)`);
  assert.ok(past > 0.9 && far > 0.85, `the runner is past him: ${past.toFixed(2)}; 6 m away: ${far.toFixed(2)}`);
  // markedBy: full within markReach, fading over markFade; level or goal-side, fading as the runner gets past him.
  approx(markedBy({ x: 80, y: 22 }, runner, space), 1, 1e-12);
  approx(markedBy({ x: 80, y: 24 }, runner, space), 0.5, 1e-9);
  assert.equal(markedBy({ x: 80, y: 25.1 }, runner, space), 0);
  approx(markedBy({ x: 78, y: 20 }, runner, space), 0.5, 1e-9);
  approx(markedBy({ x: 77, y: 20 }, runner, space), 0, 1e-9);
  // Left/right symmetric.
  approx(raceAt({ x: 92, y: 48 }, { x: 80, y: 48 }, [{ id: 'them-LCB', role: 'LCB', x: 80, y: 46 }], tBall).pWin, level, 1e-12);
});

test('lane: a defender in the receiver\'s run to the ball blocks it (a 19 m pass, one 1 m in front of the receiver); one beside or behind him does not', () => {
  const ball = { x: 40, y: 34 }, target = { x: 59, y: 34 };
  const lane = (x, y) => laneRisk(ball, target, [{ id: 'them-DM', role: 'DM', x, y }], PASS_DEFAULTS, target);
  const front = lane(58, 34.3);
  assert.ok(front.meet < 17, `the receiver would meet it ${front.meet.toFixed(1)} m along, short of the defender`);
  assert.ok(front.pLane < 0.15 && front.top.pBlock >= front.top.pRun, `pLane ${front.pLane.toFixed(2)}: a block`);
  approx(front.top.at.x, 58, 1e-9); // cut out where he stands
  for (const [x, y, what] of [[60, 34, 'behind'], [59, 35.5, 'beside']]) {
    assert.ok(lane(x, y).pLane > 0.8, `${what}: pLane ${lane(x, y).pLane.toFixed(2)}`);
  }
  // In a rated frame: the #6's pass to the #8 is cut out, no star (the Player-mode review: it was risky, scored 97, 2 stars).
  const f = frameOf({
    ball: { x: 40, y: 34 }, carrierId: 'us-DM',
    us: { DM: [39.2, 34], LCM: [59, 34], LCB: [30, 26], RCB: [30, 42] }, them: { GK: [100, 34], DM: [58, 34.3], LCB: [70, 28], RCB: [70, 40] },
  });
  const r = rateOptions(f), o = optionOf(r, 'us-LCM');
  assert.equal(o.label, 'cut-out');
  assert.deepEqual([o.blocker.id, o.blocker.via], ['them-DM', 'block']);
  assert.ok(o.tags.some((t) => t.tag === 'blocked' && t.whoId === 'them-DM'));
  assert.equal(gradePass(r, 'us-LCM').stars, 0);
});

test('who\'s open: a ball into space behind a tightly marked #9 is not the best, and a safe pass to a free teammate earns two stars', () => {
  // The Player-mode review's picture: our winger on the ball near their end, their centre-back level with our #9 and 2 m from
  // him, our #6 and #8 free with clear lanes. Before, the ball into space behind the #9 was starred and the #6 got one star.
  const tight = {
    ball: { x: 80, y: 4 }, carrierId: 'us-LW',
    us: { LW: [79.2, 4], ST: [88, 20], DM: [72, 22], LCM: [76, 11] }, them: { GK: [103, 34], RCB: [88.5, 22], LCB: [92, 32], RB: [83, 2] },
  };
  const r = rateOptions(frameOf(tight));
  const behind = optionOf(r, 'us-ST@space');
  assert.ok(behind.pWin < PASS_DEFAULTS.beatenBelow, `pWin ${behind.pWin.toFixed(2)}: their centre-back contests it`);
  assert.ok(['cut-out', 'risky'].includes(behind.label) && behind.tags.some((t) => t.tag === 'beaten-to-it'), behind.label);
  assert.notEqual(r.best.targetId, 'us-ST', `best ${r.best.id}`);
  assert.equal(r.best.colour, 'green');
  for (const id of ['us-DM', 'us-LCM']) {
    const o = optionOf(r, id);
    assert.ok(o.receiverPressure < PASS_DEFAULTS.pressureFree && o.colour === 'green', id);
    assert.ok(gradePass(r, id).stars >= 2, `${id}: a safe pass to a free teammate, ${gradePass(r, id).stars} stars`);
  }
  // Their centre-back 9 m away: the #9 is free, and the ball into space ahead of him is on.
  const r2 = rateOptions(frameOf({ ...tight, them: { ...tight.them, RCB: [86, 29] } }));
  assert.ok(optionOf(r2, 'us-ST@space').pWin > 0.8);
  assert.equal(r2.best.id, 'us-ST@space');
});

test('rateOptions: every teammate to feet plus up to 3 spaces, sorted, with the documented fields, under 2 ms a frame', () => {
  for (const [name, frame] of SCENES) {
    const r = rateOptions(frame);
    const feet = r.options.filter((o) => o.kind === 'feet');
    assert.equal(feet.length, 10, `${name}: every teammate`);
    assert.ok(r.options.length - feet.length <= PASS_DEFAULTS.maxSpaceTargets, `${name}: space targets`);
    assert.equal(new Set(r.options.map((o) => o.id)).size, r.options.length, `${name}: ids unique`);
    assert.equal(r.best.id, r.options[0].id);
    assert.equal(r.best.label, 'best');
    assert.equal(r.options.filter((o) => o.label === 'best').length, 1, `${name}: one star`);
    for (let i = 1; i < r.options.length; i++) assert.ok(r.options[i - 1].score >= r.options[i].score, `${name}: sorted`);
    for (const o of r.options) {
      for (const k of ['id', 'targetId', 'kind', 'point', 'aim', 'receiverAt', 'len', 'direction', 'pSafe', 'pLane', 'pExec', 'pWin', 'receiverPressure', 'room', 'bypassed', 'value', 'valueGain', 'U', 'worth', 'score', 'colour', 'label', 'critical', 'tags']) {
        assert.ok(o[k] !== undefined, `${name} ${o.id}: ${k}`);
      }
      assert.ok(['best', 'good', 'risky', 'cut-out', 'offside', 'danger'].includes(o.label), `${name} ${o.id}: label ${o.label}`);
      assert.ok(o.score >= 0 && o.score <= 100 && Number.isInteger(o.score));
      approx(o.pSafe, o.pExec * o.pLane * o.pWin, 1e-12);
      if (o.label === 'cut-out') assert.ok(o.pSafe < PASS_DEFAULTS.red && o.score <= PASS_DEFAULTS.redCap);
      if (o.label === 'good') assert.ok(o.pSafe >= PASS_DEFAULTS.green && o.score >= PASS_DEFAULTS.safeFloor);
      if (o.critical) assert.ok(o.score <= PASS_DEFAULTS.criticalCap);
      // worth: U less the risk premium (none for a safe pass, riskWorth to twice that for a risky one, twice for a cut-out).
      const prem = (o.U - o.worth) / (PASS_DEFAULTS.riskWorth * PASS_DEFAULTS.pointValue);
      if (o.colour === 'green') approx(prem, 0, 1e-9);
      else if (o.colour === 'amber') assert.ok(prem >= 1 - 1e-9 && prem <= 2 + 1e-9, `${name} ${o.id}: premium x${prem}`);
      else approx(prem, 2, 1e-9);
      if (o.blocker) assert.ok(o.blocker.id.startsWith('them-') && ['block', 'run'].includes(o.blocker.via));
      for (const t of o.tags) assert.ok(PASS_TAGS[t.tag] && PASS_TAGS[t.tag].principles.includes(t.principle), `${name} ${o.id}: tag ${t.tag}`);
    }
  }
  const frames = SCENES.map(([, f]) => f);
  // CPU time, the median of 9 runs of every scene after a warm-up (cpuTimed: steady while other test files run).
  const per = cpuTimed(() => { for (const f of frames) rateOptions(f); }, { warmup: 3, runs: 9, reps: 3 }).median / frames.length;
  assert.ok(per < 2 * PERF_SLACK, `${per.toFixed(3)} ms of CPU per frame`);
});

test('rateOptions: the fixture build-up stars the pass through their front line (the research frame)', () => {
  const r = rateOptions(makeFrame('ipBuildUp'));
  assert.equal(r.best.id, 'us-LCM');
  assert.equal(r.best.lineBroken, 'front');
  assert.ok(r.fwdOn, 'a good forward pass is on');
  for (const id of ['us-ST', 'us-LW', 'us-RW']) assert.equal(optionOf(r, id).label, 'cut-out', id);
  // The keeper back pass is too safe (the pass through their front line is clearly better: 21 points); the square pass
  // to the free centre-back, 14 points below it, is a good pass: two stars (tooSafeGap 15).
  assert.ok(optionOf(r, 'us-GK').tags.some((t) => t.tag === 'too-safe'), 'the keeper back pass is too safe');
  assert.equal(gradePass(r, 'us-GK').stars, 1);
  assert.ok(!optionOf(r, 'us-RCB').tags.some((t) => t.tag === 'too-safe'), 'a free centre-back 14 points below is not too safe');
  assert.equal(gradePass(r, 'us-RCB').stars, 2);
});

test('a clearly-best forward pass wins; a pass through a defender is cut out', () => {
  // The #6 on the ball: a free #8 ahead beyond their midfield, a centre-back behind, and a #9 with their #6 on the line.
  const f = frameOf({
    ball: { x: 40, y: 34 }, carrierId: 'us-DM',
    us: { DM: [39.2, 34], LCB: [30, 26], RCB: [30, 42], LCM: [58, 26], ST: [62, 38] },
    them: { GK: [100, 34], LCB: [75, 40], RCB: [75, 28], LB: [72, 56], RB: [72, 12], DM: [51, 36.2], LCM: [50, 20], RCM: [50, 48], ST: [45, 44] },
  });
  const r = rateOptions(f);
  assert.equal(r.best.targetId, 'us-LCM', `best ${r.best.id}`); // to feet or into the space ahead of them
  assert.equal(r.best.direction, 'forward');
  assert.equal(r.best.colour, 'green');
  assert.ok(r.best.lineBroken, 'it gets past their midfield');
  const st = optionOf(r, 'us-ST');
  assert.equal(st.label, 'cut-out');
  assert.equal(st.blocker.id, 'them-DM');
  assert.equal(st.blocker.via, 'block');
  assert.ok(st.tags.some((t) => t.tag === 'blocked' && t.whoId === 'them-DM'));
  const g = gradePass(r, 'us-ST');
  assert.equal(g.outcome, 'cut-out');
  assert.equal(g.grade, 'F');
  assert.equal(g.stars, 0);
  const e = explainPass(r, 'us-ST', { wording: 'kid' });
  assert.equal(e.headline, PASS_HEADLINES.kid['cut-out']);
  assert.equal(e.yours.text, 'Their midfielder is in the way.');
  assert.equal(e.yours.principleId, 'PA4');
  assert.deepEqual(e.cue.highlight, { type: 'player', id: 'them-DM' });
  assert.equal(e.best.id, r.best.id);
  const b = explainPass(r, r.best.id);
  assert.equal(b.best, null, 'the best has no "best" line');
  assert.equal(b.grade.stars, 3);
});

test('offside and danger: a receiver past their line now, and a square pass across the front of our goal', () => {
  // Our #9 past their second-last player in their half: offside (F4), critical.
  const off = frameOf({
    ball: { x: 60, y: 34 }, carrierId: 'us-LCM',
    us: { LCM: [59.2, 34], ST: [85, 34], RCM: [65, 50] },
    them: { GK: [100, 34], LCB: [80, 30], RCB: [80, 40], DM: [70, 20] },
  });
  const r = rateOptions(off);
  const st = optionOf(r, 'us-ST');
  assert.equal(st.label, 'offside');
  assert.ok(st.critical && st.score <= PASS_DEFAULTS.criticalCap);
  assert.equal(gradePass(r, 'us-ST').outcome, 'offside');
  assert.match(explainPass(r, 'us-ST').yours.text, /^Your striker is offside there\.$/);
  // The offside line is the rule's (rules/offside.js offsideLineX): one number in both modules.
  const ctx = buildContext(off, { learnerId: 'us-RCM' });
  assert.equal(r.offsideX, offsideLineX(ctx));
  assert.ok(!optionOf(rateOptions(off, 'us-LCM', { offside: false }), 'us-ST').offside, 'no offside from a restart (params.offside false)');

  // Our left centre-back at the corner of the box, their #9 lurking in front of goal: the pass to the other centre-back is a danger (PA10).
  const own = frameOf({
    ball: { x: 16, y: 16 }, carrierId: 'us-LCB',
    us: { GK: [5, 34], LCB: [15.2, 16], RCB: [16, 52], LB: [30, 5], DM: [30, 30] },
    them: { ST: [20, 33] },
  });
  const r2 = rateOptions(own);
  const across = optionOf(r2, 'us-RCB');
  assert.equal(across.label, 'danger');
  assert.ok(across.acrossOwnGoal && across.critical);
  assert.equal(gradePass(r2, 'us-RCB').outcome, 'danger');
  const e = explainPass(r2, 'us-RCB');
  assert.equal(e.yours.principleId, 'PA10');
  assert.equal(e.headline, PASS_HEADLINES.kid.danger);
});

test('gradePass: S for the best or a good pass within bestMargin or a keyed one; a good pass 2 stars, too-safe or risky at most 1, cut out 0', () => {
  const r = rateOptions(makeFrame('ipBuildUp'));
  const best = gradePass(r, r.best.id);
  assert.deepEqual([best.score, best.grade, best.stars, best.isBest, best.outcome], [100, 'S', 3, true, 'completed']);
  const P = PASS_DEFAULTS;
  for (const [, frame] of SCENES) {
    const q = rateOptions(frame);
    for (const o of q.options) {
      const g = gradePass(q, o.id);
      assert.equal(g.stars, starsForScore(g.score));
      if (o.id === q.best.id) { assert.equal(g.stars, 3); continue; }
      const near = o.colour === 'green' && q.best.score - o.score <= P.bestMargin;
      assert.equal(g.isBest, near, o.id);
      if (!near) assert.ok(g.score <= P.notBestCap, `${o.id} ${g.score}`);
      const tooSafe = o.tags.some((t) => t.tag === 'too-safe');
      // Stars say what the label says: Good 2 (a safe-but-slow one 1: "Safe, but a forward pass was on."), Risky at most 1.
      if (tooSafe) assert.equal(g.score, P.tooSafeCap, `${o.id} too safe ${g.score}`);
      else if (o.colour === 'green' && !near) assert.equal(g.stars, 2, `${o.id}: a good pass earns two stars (${g.score})`);
      if (o.colour === 'amber') assert.ok(g.stars <= 1, `${o.id}: a risky pass that is not the best earns one star at most`);
      if (o.colour === 'red') assert.equal(g.stars, 0, `${o.id}: a cut-out pass earns no star`);
    }
  }
  const keyed = gradePass(r, 'us-RCM', { accept: ['us-RCM'] });
  assert.ok(keyed.isBest && keyed.grade === 'S', 'a coach-keyed alternative counts as best');
  assert.equal(gradePass(r, 'us-nobody'), null);
});

test('starsForScore: 3 from 90, 2 from 75, 1 from 55 (KID_REDESIGN §6.3), and the same as js/rewards.js once it has one', async () => {
  assert.deepEqual([100, 90, 89, 75, 74, 55, 54, 0].map(starsForScore), [3, 3, 2, 2, 1, 1, 0, 0]);
  assert.deepEqual(STAR_BANDS.map(([s]) => s), [3, 2, 1]);
  const rewards = await import('../js/rewards.js');
  if (typeof rewards.starsForScore === 'function') {
    for (let s = 0; s <= 100; s++) assert.equal(starsForScore(s), rewards.starsForScore(s), `score ${s}`);
  }
});

test('explainPass: simple lines of 14 words or fewer, positions not codes, focus leads with the drill\'s principle', () => {
  for (const [name, frame] of SCENES) {
    const r = rateOptions(frame);
    for (const o of r.options) {
      const e = explainPass(r, o.id, { wording: 'kid' });
      for (const s of [e.headline, e.line, e.yours.text, e.best?.text, e.cue.text, ...e.more.map((m) => m.text)].filter(Boolean)) {
        assert.ok(words(s) <= 14, `${name} ${o.id}: "${s}" is ${words(s)} words`);
        assert.doesNotMatch(s, CODE, `${name} ${o.id}: "${s}" has a code`);
        assert.doesNotMatch(s, SIDE, `${name} ${o.id}: "${s}" names a side`);
      }
      assert.equal(e.line, e.yours.text);
      assert.ok(e.yours.principleId, `${name} ${o.id}: principle`);
      assert.ok(['player', 'segment', 'line-x', 'point'].includes(e.cue.highlight.type));
      const std = explainPass(r, o.id, { wording: 'standard' });
      assert.ok(std.line.length > 0 && /[.!?]$/.test(std.line), `${name} ${o.id}: standard "${std.line}"`);
    }
  }
  // A best pass that gets past their front players and is free: focus picks which reason leads.
  const r = rateOptions(makeFrame('ipBuildUp'));
  assert.equal(explainPass(r, 'us-LCM').yours.principleId, 'PA5');
  assert.equal(explainPass(r, 'us-LCM', { focus: ['PA3'] }).yours.principleId, 'PA3');
  // A good pass with the same reason as the best says what made the best one better.
  const rcm = explainPass(r, 'us-RCM');
  assert.notEqual(rcm.yours.text, rcm.best.text);
});

test('allPassTexts: every simple sentence the pass reveal can show is short and code-free', () => {
  const all = allPassTexts('kid');
  assert.ok(all.length > 50);
  for (const { key, text } of all) {
    assert.ok(words(text) <= 14, `${key}: "${text}"`);
    assert.doesNotMatch(text, CODE, `${key}: "${text}"`);
    assert.doesNotMatch(text, SIDE, `${key}: "${text}"`);
    assert.doesNotMatch(text, /\b(he|she|him|her|his)\b/i, `${key}: "${text}"`);
  }
  for (const tag of Object.values(PASS_TAGS)) assert.ok(words(tag.text.kid({})) <= 12, tag.text.kid({}));
  assert.ok(allPassTexts('standard').length > 50);
  assert.equal(kidName({ team: 'them', role: 'DM' }), 'their midfielder');
  assert.equal(kidName({ team: 'us', role: 'RW' }), 'your winger');
});

test('mirror symmetry: the left/right mirror of a frame rates every option the same', () => {
  const tight = frameOf({
    ball: { x: 80, y: 4 }, carrierId: 'us-LW',
    us: { LW: [79.2, 4], ST: [88, 20], DM: [72, 22], LCM: [76, 11] }, them: { GK: [103, 34], RCB: [88.5, 22], LCB: [92, 32], RB: [83, 2] },
  });
  for (const [name, frame] of [...SCENES, ['tightly marked #9', tight]]) {
    const r = rateOptions(frame);
    const m = rateOptions(mirrorFrame(frame));
    for (const o of r.options) {
      const q = optionOf(m, mirrorOptionId(o.id));
      assert.ok(q, `${name}: ${o.id} has a mirror`);
      assert.equal(q.score, o.score, `${name} ${o.id}`);
      assert.equal(q.label === 'best' ? o.label : q.label, o.label === 'best' ? q.label : o.label, `${name} ${o.id} label`);
      approx(q.U, o.U, 1e-9);
    }
  }
});

test('swapTeams: their passes are rated on the frame seen from their side; swapping twice gives the frame back', () => {
  const f = autoFrame({ formations, ball: { x: 60, y: 40 }, possession: 'them' });
  const s = swapTeams(f);
  assert.equal(s.possession, 'us');
  swapTeams(s).players.forEach((p, i) => { assert.equal(p.id, f.players[i].id); assert.equal(p.team, f.players[i].team); approx(p.x, f.players[i].x, 1e-9); approx(p.y, f.players[i].y, 1e-9); });
  const r = rateOptions(s, f.carrierId);
  assert.ok(r.best.targetId.startsWith('them-'), 'their options are their players');
  assert.throws(() => rateOptions(f, f.carrierId), /one of us/);
  assert.throws(() => rateOptions(f, 'us-nobody'), /no carrier/);
  const lines = oppLines(makeFrame('ipBuildUp'));
  assert.ok(lines.front < lines.mid && lines.mid < lines.back && lines.back <= lines.secondLast);
});
