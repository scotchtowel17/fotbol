import { test, assert, approx } from './harness.js';
import { autoFrame, autoRoles, learnerBase, SCENE_DEFAULTS } from '../js/engine/scene.js';
import { createFormation, teamTargets } from '../js/engine/formation.js';
import { dist, cross, sub, dot, norm } from '../js/engine/geometry.js';
import { engageBias } from '../js/engine/context.js';
import { OWN_GOAL, OPP_GOAL, HALF_X, flipY } from '../js/engine/pitch.js';
import { ROLES, playerId, mirrorPlayerId, parsePlayerId } from '../js/engine/roles.js';

// Linear fallback formation: tests must not depend on the HELIOS data file.
const F = createFormation();
const formations = { us: F, them: F };
const byId = (frame) => Object.fromEntries(frame.players.map((p) => [p.id, p]));

// The press tests below were set up on the linear table with every defender at his table spot: the
// #9 is not brought back to the ball (T3) and nobody settles goal-side of an opponent (D5), so
// rankedByBall() (one team's targets) predicts autoFrame's ranking exactly.
const NO_RECOVERY = Object.freeze({ shape: { stBeyondBall: Infinity }, settle: false });

/** Formation spots of one team (no press/carrier/separation), keyed by player id. */
function spots(team, ball, possession, shape = true) {
  const t = teamTargets(F, team, ball, { inPossession: possession === team, offset: possession !== 'none', shape });
  return Object.fromEntries(ROLES.map((r) => [playerId(team, r), t[r]]));
}
/**
 * Outfield ids of `team` ranked as autoFrame ranks them: the team in possession by the distance of
 * their formation spot to the ball (the carrier); the defending team as the press does it, counting
 * metres past the ball pressPastWeight times and the ball-side full-back pressFbEngage nearer with
 * the ball wide in its own half (context.js engageBias). `withReach` returns { id, d } instead.
 */
function rankedByBall(team, ball, possession, exclude = [], withReach = false, shape = true) {
  const s = spots(team, ball, possession, shape);
  const P = SCENE_DEFAULTS;
  const g = norm(sub(team === 'us' ? OWN_GOAL : OPP_GOAL, ball));
  const fb = engageBias(team, ball, { fbEngage: P.pressFbEngage, fbEngageFrom: P.pressFbEngageFrom, fbEngageTo: P.pressFbEngageTo });
  const reach = (id) => (team === possession ? dist(s[id], ball)
    : dist(s[id], ball) + P.pressPastWeight * Math.max(0, -dot(sub(s[id], ball), g)) - (parsePlayerId(id).role === fb.role ? fb.bias : 0));
  const ranked = Object.keys(s)
    .filter((id) => !id.endsWith('-GK') && !exclude.includes(id))
    .map((id) => ({ id, d: reach(id) }))
    .sort((a, b) => a.d - b.d);
  return withReach ? ranked : ranked.map((r) => r.id);
}

test('autoFrame returns a full frame: 22 players, 11 per team, t = 0, empty tags', () => {
  const f = autoFrame({ formations, ball: { x: 40, y: 30 }, possession: 'them' });
  assert.equal(f.players.length, 22);
  assert.equal(new Set(f.players.map((p) => p.id)).size, 22);
  assert.equal(f.players.filter((p) => p.team === 'us').length, 11);
  for (const p of f.players) {
    assert.equal(p.id, playerId(p.team, p.role));
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${p.id} has a position`);
  }
  assert.equal(f.t, 0);
  assert.deepEqual(f.tags, {});
  assert.deepEqual(f.ball, { x: 40, y: 30 });
  assert.equal(f.possession, 'them');
});

test('autoCarrier: the nearest outfielder of the team in possession stands just behind the ball', () => {
  const ball = { x: 62, y: 20 };
  const f = autoFrame({ formations, ball, possession: 'us' });
  assert.equal(f.carrierId, rankedByBall('us', ball, 'us')[0]);
  const c = byId(f)[f.carrierId];
  approx(c.x, ball.x - SCENE_DEFAULTS.carrierOffset); // goal-side from our point of view = smaller x
  approx(c.y, ball.y);

  const g = autoFrame({ formations, ball, possession: 'them' });
  assert.equal(g.carrierId, rankedByBall('them', ball, 'them')[0]);
  approx(byId(g)[g.carrierId].x, ball.x + SCENE_DEFAULTS.carrierOffset); // they defend x = 105
});

test('a loose ball has no carrier, even when a carrierId is passed', () => {
  const ball = { x: 50, y: 30 };
  const plain = autoFrame({ formations, ball, possession: 'none', learnerId: 'us-LCM' });
  const named = autoFrame({ formations, ball, possession: 'none', carrierId: 'them-ST', learnerId: 'us-LCM' });
  assert.equal(named.carrierId, null);
  assert.deepEqual(named.players, plain.players, 'the named player is not snapped to the ball');
  assert.equal(autoRoles({ formations, ball, possession: 'none', carrierId: 'them-ST' }).carrierId, null);
});

test('an explicit carrierId is placed at the ball; autoCarrier false leaves nobody on it', () => {
  const ball = { x: 48, y: 50 };
  const f = autoFrame({ formations, ball, possession: 'them', carrierId: 'them-ST' });
  assert.equal(f.carrierId, 'them-ST');
  approx(dist(byId(f)['them-ST'], ball), SCENE_DEFAULTS.carrierOffset);

  const g = autoFrame({ formations, ball, possession: 'them', autoCarrier: false, autoPress: false });
  assert.equal(g.carrierId, null);
  assert.ok(g.players.every((p) => dist(p, ball) > 1), 'nobody snapped to the ball');
});

test('autoPress: the nearest defender stands pressDistance from the ball on the ball → own-goal line', () => {
  const ball = { x: 40, y: 40 };
  const presser = rankedByBall('us', ball, 'them', [], false, NO_RECOVERY.shape)[0];
  // Hard switch so the exact geometry holds even if the next defender is close.
  const f = autoFrame({ formations, ball, possession: 'them', params: { ...NO_RECOVERY, pressHandover: 0 } });
  const p = byId(f)[presser];
  approx(dist(p, ball), SCENE_DEFAULTS.pressDistance, 1e-9);
  approx(cross(sub(p, ball), sub(OWN_GOAL, ball)), 0, 1e-9, 'on the ball-goal line');
  assert.ok(p.x < ball.x, 'goal-side of the ball');

  // Their presser uses their own goal (x = 105).
  const g = autoFrame({ formations, ball: { x: 70, y: 30 }, possession: 'us', params: { ...NO_RECOVERY, pressHandover: 0 } });
  const q = byId(g)[rankedByBall('them', { x: 70, y: 30 }, 'us', [], false, NO_RECOVERY.shape)[0]];
  approx(dist(q, { x: 70, y: 30 }), SCENE_DEFAULTS.pressDistance, 1e-9);
  approx(cross(sub(q, { x: 70, y: 30 }), sub(OPP_GOAL, { x: 70, y: 30 })), 0, 1e-9);
});

test("autoPress: in the attacking team's half the presser curves onto the carrier's inside (pressAim, D2/R5), continuously", () => {
  const P = SCENE_DEFAULTS;
  // Degrees the presser stands off the ball → goal line, positive toward the middle of the pitch.
  const angleOff = (p, ball, goal) => {
    const a = sub(p, ball), g = sub(goal, ball);
    const deg = (Math.atan2(cross(g, a), dot(g, a)) * 180) / Math.PI;
    return deg * (ball.y >= 34 ? 1 : -1) * (g.x <= 0 ? 1 : -1);
  };
  const press = (ball, presserId, possession) => byId(autoFrame({ formations, ball, possession, presserId, params: NO_RECOVERY }))[presserId];
  // Their centre-back on the ball deep in their half, off the middle: our #9 presses from his inside.
  const ball = { x: 85, y: 22 };
  const p = press(ball, 'us-ST', 'them');
  approx(dist(p, ball), P.pressDistance, 1e-9);
  approx(angleOff(p, ball, OWN_GOAL), P.pressAim, 1e-9);
  // Mirrored for them: their #9 presses our centre-back in our half from his inside.
  const m = { x: 105 - ball.x, y: 68 - ball.y };
  approx(angleOff(press(m, 'them-ST', 'us'), m, OPP_GOAL), P.pressAim, 1e-9);
  // In our half, and in the middle of the pitch, the press stays on the line to goal (D1).
  approx(angleOff(press({ x: 40, y: 22 }, 'us-DM', 'them'), { x: 40, y: 22 }, OWN_GOAL), 0, 1e-9);
  approx(angleOff(press({ x: 85, y: 34 }, 'us-ST', 'them'), { x: 85, y: 34 }, OWN_GOAL), 0, 1e-9);
  // The lean grows smoothly with the ball: no jump as it crosses into their half or out of the middle.
  let prev = null;
  for (let x = 40; x <= 60; x += 0.25) {
    const b = { x, y: 22 };
    const a = angleOff(press(b, 'us-RCM', 'them'), b, OWN_GOAL);
    if (prev !== null) assert.ok(a >= prev - 1e-9 && a - prev <= P.pressAim / 30, `lean jumps ${prev.toFixed(2)} -> ${a.toFixed(2)} at x ${x}`);
    prev = a;
  }
  approx(prev, P.pressAim, 1e-9);
});

test('autoRoles with rankFrom (playback): the press goes to who is placed to press, not to a formation spot the play has left behind', () => {
  const ball = { x: 60, y: 40 };
  const opts = { formations, ball, possession: 'them', params: { ...NO_RECOVERY, pressHandover: 0 } };
  const first = autoRoles(opts).presser.id; // on formation spots
  const s = spots('us', ball, 'them', NO_RECOVERY.shape);
  // Everyone where the formation puts them: the same choice.
  assert.equal(autoRoles({ ...opts, rankFrom: s }).presser.id, first);
  // The same player left 6 m past the ball (say, still up the pitch after a turnover): a better-placed teammate presses.
  const behind = autoRoles({ ...opts, rankFrom: { ...s, [first]: { x: ball.x + 6, y: s[first].y } } }).presser.id;
  assert.notEqual(behind, first);
  assert.ok(s[behind].x < ball.x + 6, `${behind} is not as far past the ball`);
  // Someone who has followed the ball far out of his own zone hands it over, even standing right by it (D7).
  const far = autoRoles({ ...opts, rankFrom: { ...s, 'us-LB': { x: ball.x - 2, y: ball.y } } }).presser.id;
  assert.notEqual(far, 'us-LB');
  // But within his zone, the player actually nearest the ball takes it.
  const second = rankedByBall('us', ball, 'them', [first], false, NO_RECOVERY.shape)[0];
  assert.equal(autoRoles({ ...opts, rankFrom: { ...s, [second]: { x: ball.x - 2, y: ball.y } } }).presser.id, second);
});

test('autoPress ramps in with the lead over the next defender and fades beyond pressRadius', () => {
  const ball = { x: 40, y: 40 };
  const [first, second] = rankedByBall('us', ball, 'them', [], true, NO_RECOVERY.shape);
  const s = spots('us', ball, 'them', NO_RECOVERY.shape);
  const lead = second.d - first.d;
  assert.ok(lead > 0 && lead < SCENE_DEFAULTS.pressHandover, `fixture: a near tie (lead ${lead.toFixed(2)} m)`);
  const d = dist(byId(autoFrame({ formations, ball, possession: 'them', params: NO_RECOVERY }))[first.id], ball);
  assert.ok(d > SCENE_DEFAULTS.pressDistance + 0.1 && d < dist(s[first.id], ball) - 0.1, `partial press (${d.toFixed(2)} m)`);

  // Nobody within pressRadius + pressFade: identical to no press at all.
  const far = autoFrame({ formations, ball, possession: 'them', params: { ...NO_RECOVERY, pressRadius: 0, pressFade: 0 } });
  assert.deepEqual(far, autoFrame({ formations, ball, possession: 'them', autoPress: false, params: NO_RECOVERY }));
});

test('a defender the ball has gone past hands the press to a goal-side teammate', () => {
  // Their #8 carries at (60, 40); our #9's spot is past the ball, our right #8 is goal-side of it.
  const ball = { x: 60, y: 40 };
  const s = spots('us', ball, 'them', NO_RECOVERY.shape);
  assert.ok(s['us-ST'].x > ball.x && dist(s['us-ST'], ball) < dist(s['us-RCM'], ball), 'fixture: #9 is nearer but beaten');
  const f = autoFrame({ formations, ball, possession: 'them', params: { ...NO_RECOVERY, pressHandover: 0 } });
  approx(dist(byId(f)['us-RCM'], ball), SCENE_DEFAULTS.pressDistance, 1e-9);
  const plain = autoFrame({ formations, ball, possession: 'them', params: { ...NO_RECOVERY, pressHandover: 0, pressPastWeight: 0 } });
  approx(dist(byId(plain)['us-ST'], ball), SCENE_DEFAULTS.pressDistance, 1e-9, 'plain nearest without the weighting');
});

test('autoRoles reports the automatic carrier and presser; presserId forces or suppresses the press', () => {
  const ball = { x: 40, y: 40 };
  const r = autoRoles({ formations, ball, possession: 'them', params: NO_RECOVERY });
  assert.equal(r.carrierId, rankedByBall('them', ball, 'them')[0]);
  assert.equal(r.presser.id, rankedByBall('us', ball, 'them', [], false, NO_RECOVERY.shape)[0]);
  assert.ok(r.presser.w > 0 && r.presser.w <= 1);
  assert.deepEqual(autoRoles({ formations, ball, possession: 'none' }), { carrierId: null, presser: null });
  assert.equal(autoRoles({ formations, ball, possession: 'them', inFlight: true }).presser, null);
  assert.equal(autoRoles({ formations, ball, possession: 'them', learnerId: r.presser.id, params: NO_RECOVERY }).presser, null, 'the learner decides');

  const forced = autoFrame({ formations, ball, possession: 'them', presserId: 'us-LCB' });
  approx(dist(byId(forced)['us-LCB'], ball), SCENE_DEFAULTS.pressDistance, 1e-9);
  assert.deepEqual(autoFrame({ formations, ball, possession: 'them', presserId: null }), autoFrame({ formations, ball, possession: 'them', autoPress: false }));
  const pinned = autoFrame({ formations, ball, possession: 'them', presserId: 'us-LCB', learnerId: 'us-LCB' });
  assert.deepEqual({ x: byId(pinned)['us-LCB'].x, y: byId(pinned)['us-LCB'].y }, (({ x, y }) => ({ x, y }))(byId(autoFrame({ formations, ball, possession: 'them', presserId: null, learnerId: 'us-LCB' }))['us-LCB']), 'the learner cannot be forced to press');
});

test('the learner is never moved by carrier or press logic', () => {
  const ball = { x: 40, y: 40 };
  const [nearest, next] = rankedByBall('us', ball, 'them', [], false, NO_RECOVERY.shape);
  const f = autoFrame({ formations, ball, possession: 'them', learnerId: nearest, params: NO_RECOVERY });
  const P = byId(f);
  assert.deepEqual({ x: P[nearest].x, y: P[nearest].y }, spots('us', ball, 'them', NO_RECOVERY.shape)[nearest], 'learner stays at its formation spot');
  // The learner is the defender nearest the ball, so nobody else presses either: the learner must decide.
  assert.ok(dist(P[next], ball) > SCENE_DEFAULTS.pressDistance + 3, 'no stand-in presser');
  assert.ok(f.players.filter((p) => p.team === 'us').every((p) => dist(p, ball) > SCENE_DEFAULTS.pressDistance + 1));

  // In possession the learner is not picked as the carrier.
  const ballUs = { x: 45, y: 30 };
  const would = rankedByBall('us', ballUs, 'us')[0];
  const g = autoFrame({ formations, ball: ballUs, possession: 'us', learnerId: would });
  assert.notEqual(g.carrierId, would);
  assert.equal(g.carrierId, rankedByBall('us', ballUs, 'us', [would])[0]);
  assert.deepEqual({ x: byId(g)[would].x, y: byId(g)[would].y }, spots('us', ballUs, 'us')[would]);
});

test('onside clamp keeps the attacking team onside; mirrored for them', () => {
  // Their back four stands at x = 70; our front three would otherwise be beyond it.
  const high = Object.fromEntries(['LB', 'LCB', 'RCB', 'RB'].map((r, i) => [`them-${r}`, { x: 70, y: 12 + 14 * i }]));
  const ball = { x: 60, y: 34 };
  const off = autoFrame({ formations, ball, possession: 'us', overrides: high, onsideClamp: false });
  assert.ok(byId(off)['us-ST'].x > 70, 'fixture: our #9 would be offside');
  const f = autoFrame({ formations, ball, possession: 'us', overrides: high });
  const limit = 70 - SCENE_DEFAULTS.onsideMargin;
  for (const p of f.players.filter((q) => q.team === 'us')) assert.ok(p.x <= limit + 1e-9, `${p.id} onside (${p.x.toFixed(2)})`);
  assert.ok(byId(f)['us-ST'].x > limit - SCENE_DEFAULTS.minSeparation, 'pulled back only as far as needed');

  // Them attacking towards x = 0 against our back four at x = 35.
  const deep = Object.fromEntries(['LB', 'LCB', 'RCB', 'RB'].map((r, i) => [`us-${r}`, { x: 35, y: 12 + 14 * i }]));
  const g = autoFrame({ formations, ball: { x: 45, y: 34 }, possession: 'them', overrides: deep });
  for (const p of g.players.filter((q) => q.team === 'them')) assert.ok(p.x >= 35.5 - 1e-9, `${p.id} onside (${p.x.toFixed(2)})`);

  // No offside in your own half: the clamp never pulls a player behind halfway.
  const low = Object.fromEntries(['LB', 'LCB', 'RCB', 'RB', 'DM', 'LCM', 'RCM'].map((r, i) => [`them-${r}`, { x: 30, y: 8 + 8 * i }]));
  const h = autoFrame({ formations, ball: { x: 20, y: 34 }, possession: 'us', overrides: low });
  for (const p of h.players.filter((q) => q.team === 'us')) assert.ok(p.x <= HALF_X + 1e-9);
  assert.ok(Math.max(...h.players.filter((q) => q.team === 'us').map((p) => p.x)) > 40, 'forwards may stand up to halfway');
});

test('a loose ball keeps both teams onside', () => {
  const ball = { x: 50, y: 34 };
  // Both back fours pinned, with each #6 in front of its line, so both offside lines are the back fours.
  const high = { ...Object.fromEntries(['LB', 'LCB', 'RCB', 'RB'].map((r, i) => [`them-${r}`, { x: 55, y: 12 + 14 * i }])), 'them-DM': { x: 52, y: 34 } };
  const deep = { ...Object.fromEntries(['LB', 'LCB', 'RCB', 'RB'].map((r, i) => [`us-${r}`, { x: 48, y: 12 + 14 * i }])), 'us-DM': { x: 51, y: 30 } };
  const off = autoFrame({ formations, ball, possession: 'none', overrides: { ...high, ...deep }, onsideClamp: false });
  assert.ok(off.players.some((p) => p.team === 'us' && p.x > 55) && off.players.some((p) => p.team === 'them' && p.x < 48), 'fixture: runners offside');
  const f = autoFrame({ formations, ball, possession: 'none', overrides: { ...high, ...deep } });
  for (const p of f.players) {
    if (p.team === 'us') assert.ok(p.x <= 55 - SCENE_DEFAULTS.onsideMargin + 1e-9, `${p.id} onside (${p.x.toFixed(2)})`);
    else assert.ok(p.x >= 48 + SCENE_DEFAULTS.onsideMargin - 1e-9, `${p.id} onside (${p.x.toFixed(2)})`);
  }
});

test('learnerBase: the formation spot, or the job the role would do (press), never the carrier', () => {
  // An ordinary learner: exactly where autoFrame puts the learner (formation spot, kept onside).
  const ball = { x: 40, y: 40 };
  const [nearest, next] = rankedByBall('us', ball, 'them', [], false, NO_RECOVERY.shape);
  const plain = autoFrame({ formations, ball, possession: 'them', learnerId: 'us-LB' });
  assert.deepEqual(learnerBase({ formations, ball, possession: 'them', learnerId: 'us-LB' }), { x: byId(plain)['us-LB'].x, y: byId(plain)['us-LB'].y });

  // The natural presser: the base is the press spot, although autoFrame leaves the learner to decide.
  const P = { ...NO_RECOVERY, pressHandover: 0 };
  const b = learnerBase({ formations, ball, possession: 'them', learnerId: nearest, params: P });
  approx(dist(b, ball), SCENE_DEFAULTS.pressDistance, 1e-9);
  approx(cross(sub(b, ball), sub(OWN_GOAL, ball)), 0, 1e-9, 'on the ball-goal line');
  // ...and so is a loose ball's nearest outfielder (the rules judge a loose ball as defended).
  const loose = rankedByBall('us', ball, 'none', [], false, NO_RECOVERY.shape)[0];
  approx(dist(learnerBase({ formations, ball, possession: 'none', learnerId: loose, params: P }), ball), SCENE_DEFAULTS.pressDistance, 1e-9);
  const other = learnerBase({ formations, ball, possession: 'them', learnerId: next, params: P });
  assert.deepEqual(other, spots('us', ball, 'them', NO_RECOVERY.shape)[next], 'not the presser: formation spot');

  // The natural carrier: the teammate who takes the ball instead leaves his spot, and the learner fills it (P6).
  const ballUs = { x: 45, y: 30 };
  const would = rankedByBall('us', ballUs, 'us')[0];
  const stand = rankedByBall('us', ballUs, 'us', [would])[0];
  // (his spot as autoFrame places everyone when nobody carries: the formation spot, eased by separation)
  const shapeOnly = byId(autoFrame({ formations, ball: ballUs, possession: 'us', learnerId: would, carrierId: null, autoCarrier: false }));
  assert.deepEqual(learnerBase({ formations, ball: ballUs, possession: 'us', learnerId: would }), { x: shapeOnly[stand].x, y: shapeOnly[stand].y });
  assert.ok(dist(shapeOnly[stand], spots('us', ballUs, 'us')[stand]) < SCENE_DEFAULTS.minSeparation);

  // The learner's own override (a dragged spot) never moves the base; an explicit learner carrier keeps its spot.
  const withDrag = learnerBase({ formations, ball, possession: 'them', learnerId: 'us-LB', overrides: { 'us-LB': { x: 5, y: 5 } } });
  assert.deepEqual(withDrag, { x: byId(plain)['us-LB'].x, y: byId(plain)['us-LB'].y });
  assert.deepEqual(learnerBase({ formations, ball: ballUs, possession: 'us', carrierId: would, learnerId: would }), spots('us', ballUs, 'us')[would]);
  assert.throws(() => learnerBase({ formations, ball }), TypeError);
});

test('overrides win: never moved, never picked as carrier or presser', () => {
  const ball = { x: 50, y: 30 };
  const nearestThem = rankedByBall('them', ball, 'them')[0];
  const spot = { x: 51, y: 30.5 };
  const f = autoFrame({ formations, ball, possession: 'them', overrides: { [nearestThem]: spot } });
  assert.deepEqual({ x: byId(f)[nearestThem].x, y: byId(f)[nearestThem].y }, spot);
  assert.notEqual(f.carrierId, nearestThem);

  // An overridden defender nearest the ball is the author's presser: no second, automatic one.
  const usSpot = { x: 48, y: 30 };
  const g = autoFrame({ formations, ball, possession: 'them', overrides: { 'us-DM': usSpot }, params: NO_RECOVERY });
  assert.deepEqual({ x: byId(g)['us-DM'].x, y: byId(g)['us-DM'].y }, usSpot);
  for (const p of g.players.filter((q) => q.team === 'us' && q.id !== 'us-DM')) assert.ok(dist(p, ball) > 4, `${p.id} did not press`);
});

test('goal-side settle: out of possession an #8 drops goal-side of an opponent near him, continuously (D5)', () => {
  const ball = { x: 60, y: 40 };
  const table = spots('us', ball, 'them')['us-LCM']; // (on the linear table their right #8 stands exactly here)
  const P = SCENE_DEFAULTS;
  // Their right #8 stands 3 m goal-side of our left #8's table spot (on our side of him), 3 m to one side.
  const at = (dx) => autoFrame({ formations, ball, possession: 'them', autoPress: false, overrides: { 'them-RCM': { x: table.x - dx, y: table.y + 3 } } });
  const lcm = byId(at(3))['us-LCM'];
  assert.ok(lcm.x <= table.x - 3 - P.settleMargin + 1e-9, `our #8 at x ${lcm.x.toFixed(1)}, goal-side of their #8 at ${(table.x - 3).toFixed(1)}`);
  assert.equal(lcm.y, table.y, 'only his depth changes');
  // An opponent already goal-side of him by more than the margin changes nothing; one far away neither.
  const far = autoFrame({ formations, ball, possession: 'them', autoPress: false, overrides: { 'them-RCM': { x: table.x - 3, y: table.y + P.settleReach + P.settleFade + 1 } } });
  approx(byId(far)['us-LCM'].x, table.x, 1e-9);
  // Continuous as the opponent comes near: no jump at the edge of the reach.
  let prev = null;
  for (let dy = P.settleReach + P.settleFade + 1; dy >= 0; dy -= 0.1) {
    const x = byId(autoFrame({ formations, ball, possession: 'them', autoPress: false, overrides: { 'them-RCM': { x: table.x - 3, y: table.y + dy } } }))['us-LCM'].x;
    if (prev !== null) assert.ok(Math.abs(x - prev) < 0.5, `jump of ${Math.abs(x - prev).toFixed(2)} m at dy ${dy.toFixed(1)}`);
    prev = x;
  }
  // In possession nobody settles.
  const inPoss = autoFrame({ formations, ball, possession: 'us', overrides: { 'them-RCM': { x: table.x - 3, y: table.y + 1 } } });
  assert.deepEqual(byId(inPoss)['us-LCM'], byId(autoFrame({ formations, ball, possession: 'us', overrides: { 'them-RCM': { x: table.x - 3, y: table.y + 1 } }, params: { settle: false } }))['us-LCM']);
});

test('flank sharing (B6): a full-back overlapping in his winger\'s wing lane brings the winger inside, continuously; in possession only', () => {
  const ball = { x: 60, y: 40 };
  const P = SCENE_DEFAULTS;
  const rw = (ov, possession = 'us') => byId(autoFrame({ formations, ball, possession, carrierId: possession === 'us' ? 'us-RCM' : null, autoPress: false, overrides: ov }))['us-RW'];
  const plain = rw({});
  assert.ok(plain.y > 54.16 + P.wingFade, `the table puts him in the wing lane (${plain.y.toFixed(1)})`);
  const over = rw({ 'us-RB': { x: plain.x + 1, y: 65 } });
  approx(over.y, 54.16 - P.halfSpaceInset, 1e-9, 'level or overlapping: he comes inside to the half-space');
  assert.equal(over.x, plain.x, 'only his channel changes');
  const without = (ov) => byId(autoFrame({ formations, ball, possession: 'us', carrierId: 'us-RCM', autoPress: false, overrides: ov, params: { flankShare: false } }))['us-RW'];
  for (const [ov, why] of [[{ 'us-RB': { x: plain.x - 20, y: 65 } }, 'a full-back 20 m behind him holds nothing for him'],
    [{ 'us-RB': { x: plain.x + 1, y: 50 } }, 'a full-back inside the wing lane leaves him wide']]) assert.deepEqual(rw(ov), without(ov), why);
  // Continuous as the full-back runs up the line past him.
  let prev = null;
  for (let dx = -20; dx <= 5; dx += 0.1) {
    const y = rw({ 'us-RB': { x: plain.x + dx, y: 65 } }).y;
    if (prev !== null) assert.ok(Math.abs(y - prev) < 0.6, `jump of ${Math.abs(y - prev).toFixed(2)} m at dx ${dx.toFixed(1)}`);
    prev = y;
  }
  // Out of possession nothing moves; params.flankShare false turns it off.
  const opp = { 'us-RB': { x: plain.x + 1, y: 65 } };
  assert.deepEqual(byId(autoFrame({ formations, ball, possession: 'them', autoPress: false, overrides: opp }))['us-RW'], byId(autoFrame({ formations, ball, possession: 'them', autoPress: false, overrides: opp, params: { flankShare: false } }))['us-RW']);
  assert.ok(without(opp).y > 54.16, 'params.flankShare false leaves him wide');
});

test('half-space (P1): our full-back on the ball out wide from the middle third sends the ball-side #8 between their lines', () => {
  const at = (ball, params) => byId(autoFrame({ formations, ball, possession: 'us', carrierId: 'us-RB', params }));
  const P = SCENE_DEFAULTS;
  const f = at({ x: 58, y: 63 });
  const rcm = f['us-RCM'];
  approx(rcm.y, 54.16 - P.halfSpaceInset, 1e-9, 'in the ball-side half-space');
  assert.ok(rcm.x >= 58 + P.halfSpaceAhead - 1e-9, `ahead of the ball (${rcm.x.toFixed(1)})`);
  const theirBack = ['LB', 'LCB', 'RCB', 'RB'].map((r) => f[`them-${r}`].x).sort((a, b) => a - b);
  assert.ok(rcm.x <= (theirBack[1] + theirBack[2]) / 2 - 2 + 1e-9, 'short of their back line');
  const off = at({ x: 58, y: 63 }, { halfSpace: false })['us-RCM'];
  assert.ok(off.y > 54.16, `the table alone leaves him wide (${off.y.toFixed(1)})`);
  // In our own third, or with the ball in the middle, the table spot stands; the far #8 never moves.
  assert.deepEqual(at({ x: 25, y: 63 })['us-RCM'], at({ x: 25, y: 63 }, { halfSpace: false })['us-RCM']);
  assert.deepEqual(f['us-LCM'], at({ x: 58, y: 63 }, { halfSpace: false })['us-LCM']);
  // Continuous as the ball moves up the line from the defensive third (the full-back keeps it).
  let prev = null;
  for (let x = 30; x <= 45; x += 0.1) {
    const p = at({ x, y: 63 })['us-RCM'];
    if (prev) assert.ok(dist(p, prev) < 1, `jump of ${dist(p, prev).toFixed(2)} m at x ${x.toFixed(1)}`);
    prev = p;
  }
});

test('build-up (B9/B5): the #6 dropped between centre-backs who have split wide sends the full-backs high, continuously', () => {
  const ball = { x: 20, y: 34 };
  const ov = (dmX, split = 26) => ({ 'us-LCB': { x: 18, y: 34 - split / 2 }, 'us-RCB': { x: 18, y: 34 + split / 2 }, 'us-DM': { x: dmX, y: 34 } });
  const at = (o, params) => byId(autoFrame({ formations, ball, possession: 'us', carrierId: 'us-DM', overrides: o, params }));
  const P = SCENE_DEFAULTS;
  const f = at(ov(19.5));
  for (const r of ['LB', 'RB']) assert.ok(f[`us-${r}`].x >= 18 + P.salidaPush - 1e-9, `${r} at x ${f[`us-${r}`].x.toFixed(1)}`);
  const off = at(ov(19.5), { salida: false });
  assert.ok(off['us-LB'].x < 18 + P.salidaPush - 2, `the table leaves the full-back flat (${off['us-LB'].x.toFixed(1)})`);
  assert.equal(f['us-LB'].y, off['us-LB'].y, 'only the height changes');
  // Centre-backs close together, or the #6 well ahead of them (a centre-back carrying out past him): no back three.
  assert.deepEqual(at(ov(19.5, 12))['us-LB'], at(ov(19.5, 12), { salida: false })['us-LB']);
  assert.deepEqual(at(ov(30))['us-LB'], at(ov(30), { salida: false })['us-LB']);
  // Continuous as the #6 drops into the line.
  let prev = null;
  for (let x = 26; x >= 18; x -= 0.1) {
    const p = at(ov(x))['us-LB'];
    if (prev) assert.ok(dist(p, prev) < 1, `jump of ${dist(p, prev).toFixed(2)} m at x ${x.toFixed(1)}`);
    prev = p;
  }
});

test("possession 'none': no carrier, no press, no possession offset (out-of-possession shape for both)", () => {
  const ball = { x: 52, y: 34 };
  const f = autoFrame({ formations, ball, possession: 'none' });
  assert.equal(f.carrierId, null);
  const expected = { ...spots('us', ball, 'none'), ...spots('them', ball, 'none') };
  for (const p of f.players) assert.ok(dist(p, expected[p.id]) < SCENE_DEFAULTS.minSeparation, `${p.id} at its neutral spot`);
});

test('separation: no two players closer than minSeparation across a sweep, except a pair crossing over', () => {
  // Continuity has a price: a pair whose biased offset is shorter than separationSoft (two players
  // crossing) is only partly separated. Such a pair must have started within separationSoft +
  // separationBias of each other; every other pair ends at least minSeparation apart.
  const { minSeparation: min, separationSoft, separationBias } = SCENE_DEFAULTS;
  let crossing = 0, frames = 0;
  for (const possession of ['us', 'them', 'none']) {
    for (let x = 10; x <= 95; x += 5) {
      for (let y = 4; y <= 64; y += 6) {
        const opts = { formations, ball: { x, y }, possession };
        const f = autoFrame(opts), f0 = autoFrame({ ...opts, params: { separationPasses: 0 } });
        frames++;
        for (let i = 0; i < 22; i++) {
          for (let j = i + 1; j < 22; j++) {
            const d = dist(f.players[i], f.players[j]);
            if (d >= min - 0.1) continue; // a player squeezed against the onside line or a third player may end a few cm short
            crossing++;
            const d0 = dist(f0.players[i], f0.players[j]);
            const where = `${f.players[i].id}/${f.players[j].id} ${d.toFixed(2)} m apart at ball (${x}, ${y}) ${possession} (${d0.toFixed(2)} m before separation)`;
            assert.ok(d0 < separationSoft + separationBias, where);
            assert.ok(d >= d0 - 0.05, `separation pushed a crossing pair closer: ${where}`);
          }
        }
      }
    }
  }
  assert.ok(crossing <= 0.06 * frames, `${crossing} crossing pairs in ${frames} frames`); // the linear table puts mirrored roles on top of each other
});

test('placement is continuous: a 5 cm ball move never moves anyone more than 1 m, on and off the centre line', () => {
  // On y = 34 the shapes are left/right symmetric, so players cross exactly there. Separation used to
  // re-read each pair's push direction after every pass, which turned a near-zero direction into a
  // flip: a 1 cm ball move could swap two players by 2-4 m. Steps where the carrier changes are skipped
  // (the new carrier snaps to the ball on purpose).
  const step = 0.05;
  for (const y of [34, 34.3, 20]) {
    for (const possession of ['us', 'them', 'none']) {
      let prev = null;
      for (let i = 0, x = 15; x <= 90; x = 15 + ++i * step) {
        const f = autoFrame({ formations, ball: { x, y }, possession });
        if (prev?.carrierId === f.carrierId) {
          f.players.forEach((p, k) => assert.ok(dist(p, prev.players[k]) < 1, `${p.id} moved ${dist(p, prev.players[k]).toFixed(2)} m at ball (${x.toFixed(2)}, ${y}) ${possession}`));
        }
        prev = f;
      }
    }
  }
});

test('placement is continuous with an explicit carrier: moving the ball 0.25 m never moves anyone more than 1.5 m', () => {
  for (const [possession, carrierId] of [['them', 'them-ST'], ['us', 'us-LCM']]) {
    let prev = null;
    for (let x = 15; x <= 90; x += 0.25) {
      const f = autoFrame({ formations, ball: { x, y: 40 }, possession, carrierId });
      if (prev) f.players.forEach((p, i) => assert.ok(dist(p, prev.players[i]) < 1.5, `${p.id} jumped at ball x = ${x} (${possession})`));
      prev = f;
    }
  }
});

test('left-right mirror symmetry of the placement', () => {
  const ball = { x: 38, y: 47 };
  const f = autoFrame({ formations, ball, possession: 'them', learnerId: 'us-LCB' });
  const mf = autoFrame({ formations, ball: flipY(ball), possession: 'them', learnerId: 'us-RCB' });
  const m = byId(mf);
  for (const p of f.players) {
    const q = m[mirrorPlayerId(p.id)];
    approx(q.x, p.x, 1e-6, `${p.id} x`);
    approx(q.y, 68 - p.y, 1e-6, `${p.id} y`);
  }
  assert.equal(mf.carrierId, mirrorPlayerId(f.carrierId));
});
