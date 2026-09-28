// In-possession principle rules (F4, F8, B1-B5, P2): a good spot, a bad spot and
// not-applicable for each, plus smoothness and feedback-text checks.
import { test, assert, approx } from './harness.js';
import { makeFrame, posOf, SCENES } from './fixtures.js';
import { buildContext } from '../js/engine/context.js';
import { ROLES } from '../js/engine/roles.js';
import { HALF_X as HALF } from '../js/engine/pitch.js';
import offside, { offsideLineX } from '../js/engine/rules/offside.js';
import width from '../js/engine/rules/width.js';
import pin from '../js/engine/rules/pin.js';
import laneOpen from '../js/engine/rules/lane-open.js';
import supportDistance from '../js/engine/rules/support-distance.js';
import occupancy from '../js/engine/rules/occupancy.js';
import betweenLines from '../js/engine/rules/between-lines.js';
import spacing from '../js/engine/rules/spacing.js';
import boxFill, { crossing, boxRunner, BOX_FILL_DEFAULTS } from '../js/engine/rules/box-fill.js';
import { widthDuty } from '../js/engine/formation.js';

const ATTACKING = [offside, width, pin, laneOpen, supportDistance, occupancy, betweenLines, spacing, boxFill];

/** Context for a learner; base defaults to the learner's fixture position. */
function ctxFor(scene, id, changes = {}, base) {
  return buildContext(makeFrame(scene, changes), { learnerId: id, base: base ?? changes.move?.[id] ?? posOf(scene, id) });
}
const at = (x, y) => ({ x, y });

// ipBuildUp: their second-last player is at x = 73 (full-backs; the keeper is last).
const LINE = 73;
// The same scene with the ball progressed into midfield (our #6 carries it at x = 45).
const PROGRESSION = { ball: at(45, 30), carrierId: 'us-DM', move: { 'us-DM': at(45, 30) } };
// Our right winger near their byline (a crossing position); their back line at x 97-98, their midfield in the box.
const CROSS = {
  ball: at(96, 60), carrierId: 'us-RW',
  move: {
    'us-RW': at(96, 60), 'us-ST': at(92, 44), 'us-LW': at(88, 10), 'us-LCM': at(84, 30), 'us-RCM': at(86, 54), 'us-DM': at(76, 40),
    'them-LB': at(97, 52), 'them-LCB': at(98, 40), 'them-RCB': at(98, 30), 'them-RB': at(97, 16), 'them-DM': at(92, 38), 'them-LCM': at(92, 52), 'them-RCM': at(90, 26),
  },
};

// ---------------------------------------------------------------- offside (F4)

test('offside: level with their second-last player is onside, past it is not', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LW');
  assert.equal(offsideLineX(ctx), LINE);
  assert.equal(offside.evaluate(ctx, at(72, 4)).s, 1);
  const level = offside.evaluate(ctx, at(LINE, 4));
  assert.equal(level.s, 1, 'level is onside');
  assert.equal(level.critical, false);
  assert.equal(offside.evaluate(ctx, at(LINE + 0.25, 4)).s, 1, 'within the "level" margin');
  const past = offside.evaluate(ctx, at(LINE + 1, 4));
  assert.ok(past.s > 0 && past.s < 1, 'smooth just past the line');
  const far = offside.evaluate(ctx, at(LINE + 3, 4));
  assert.equal(far.s, 0);
  assert.equal(far.critical, false, 'no pass being played: penalised, not critical');
  assert.deepEqual(far.target, at(LINE, 4));
});

test('offside: critical only at a pass moment', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LW', { tags: { event: 'pass' } });
  const off = offside.evaluate(ctx, at(LINE + 3, 4));
  assert.equal(off.critical, true);
  assert.equal(off.vars.pass, true);
  assert.equal(offside.evaluate(ctx, at(LINE, 4)).critical, false, 'level is onside even at the pass');
  assert.equal(offside.evaluate(ctx, at(LINE + 0.2, 4)).critical, false);
  assert.equal(offside.evaluate(ctx, at(LINE + 1, 4)).critical, true);
});

test('offside: never offside in your own half, even behind a high line', () => {
  // Push every outfield opponent up to x <= 45 (their line is now in our half).
  const move = {};
  for (const r of ROLES) if (r !== 'GK') move[`them-${r}`] = at(Math.min(SCENES.ipBuildUp.them[r].x, 45), SCENES.ipBuildUp.them[r].y);
  const ctx = ctxFor('ipBuildUp', 'us-LW', { move, tags: { event: 'pass' } });
  assert.equal(ctx.lines.oppSecondLastX, 45);
  assert.equal(offsideLineX(ctx), 52.5);
  assert.equal(offside.evaluate(ctx, at(52, 4)).s, 1);
  const r = offside.evaluate(ctx, at(55, 4));
  assert.equal(r.s, 0);
  assert.equal(r.critical, true);
  assert.equal(r.vars.by, 'halfway');
});

test('offside: the ball sets the line when it is ahead of their defenders', () => {
  const ctx = ctxFor('ipBuildUp', 'us-RW', { ball: at(80, 10), carrierId: 'us-LW', move: { 'us-LW': at(80, 10) } });
  assert.equal(offsideLineX(ctx), 80);
  assert.equal(offside.evaluate(ctx, at(79, 64)).s, 1);
  const r = offside.evaluate(ctx, at(83, 64));
  assert.equal(r.s, 0);
  assert.equal(r.vars.by, 'ball');
});

test('offside: not applicable out of possession, at throw-ins or for the carrier; light for centre-backs', () => {
  assert.equal(offside.weight(ctxFor('oopMidBlock', 'us-LW')), 0);
  assert.equal(offside.weight(ctxFor('ipBuildUp', 'us-LW', { tags: { event: 'throw-in' } })), 0);
  assert.equal(offside.weight(ctxFor('ipBuildUp', 'us-LCB')), 0, 'LCB carries the ball');
  const cb = offside.weight(ctxFor('ipBuildUp', 'us-RCB'));
  const st = offside.weight(ctxFor('ipBuildUp', 'us-ST'));
  assert.ok(cb > 0 && cb < st, `CB weight ${cb} should be positive and below the #9's ${st}`);
});

// ---------------------------------------------------------------- width (B1)

test('width: the winger holds the touchline; drifting inside fails smoothly', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LW');
  assert.equal(width.weight(ctx), 3);
  assert.equal(width.evaluate(ctx, at(62, 4)).s, 1);
  approx(width.evaluate(ctx, at(62, 8)).s, 0.5, 1e-9);
  const bad = width.evaluate(ctx, at(62, 15));
  assert.equal(bad.s, 0);
  assert.equal(bad.target.y, 5);
  // Right side: judged from the other touchline.
  const rw = ctxFor('ipBuildUp', 'us-RW');
  assert.equal(width.evaluate(rw, at(62, 64)).s, 1);
  const r = width.evaluate(rw, at(62, 55));
  assert.equal(r.s, 0);
  assert.equal(r.target.y, 63);
});

test('width: the far-side winger is judged more strictly', () => {
  const ballRight = { ball: at(40, 60), carrierId: 'us-RB', move: { 'us-RB': at(40, 60) } };
  const far = ctxFor('ipBuildUp', 'us-LW', ballRight);
  const near = ctxFor('ipBuildUp', 'us-LW');
  const f = width.evaluate(far, at(62, 8)), n = width.evaluate(near, at(62, 8));
  assert.equal(f.vars.far, true);
  assert.equal(n.vars.far, false);
  assert.ok(f.s < n.s, `far ${f.s} should be below near ${n.s}`);
});

test('width: near their byline with the ball on the other wing, the far winger attacks the box instead (P10)', () => {
  const cross = (x) => ({ ball: at(x, 62), carrierId: 'us-RW', move: { 'us-RW': at(x, 62) } });
  assert.equal(width.weight(ctxFor('ipBuildUp', 'us-LW', cross(70))), 3, 'far from the byline: the switch option stays wide');
  assert.equal(width.weight(ctxFor('ipBuildUp', 'us-LW', cross(95))), 0, 'in the crossing zone: free to attack the far post');
  const mid = width.weight(ctxFor('ipBuildUp', 'us-LW', cross(84)));
  assert.ok(mid > 0 && mid < 3, `fading in between (${mid})`);
  assert.equal(width.weight(ctxFor('ipBuildUp', 'us-RB', { ...cross(95), tags: { widthHolders: ['RB'] }, carrierId: 'us-RW' })), 3, 'the near side keeps its width-holder');
});

test('width: only for the width-holder in possession', () => {
  assert.equal(width.weight(ctxFor('ipBuildUp', 'us-DM')), 0);
  assert.equal(width.weight(ctxFor('oopMidBlock', 'us-LW')), 0);
  const tagged = { tags: { widthHolders: ['LB'] } };
  assert.equal(width.weight(ctxFor('ipBuildUp', 'us-LW', tagged)), 0, 'an inverted winger does not hold the width');
  assert.equal(width.weight(ctxFor('ipBuildUp', 'us-LB', tagged)), 3);
});

// ---------------------------------------------------------------- pin (B2)

test('pin: the #9 stands 0-2 m goal-side of their last defender', () => {
  const ctx = ctxFor('ipBuildUp', 'us-ST');
  assert.equal(pin.weight(ctx), 3);
  for (const x of [71, 72, LINE]) assert.equal(pin.evaluate(ctx, at(x, 34)).s, 1, `x = ${x}`);
  approx(pin.evaluate(ctx, at(68, 34)).s, 0.5, 1e-9); // 3 m too deep, 6 m ramp
  assert.equal(pin.evaluate(ctx, at(60, 34)).s, 0);
  assert.deepEqual(pin.evaluate(ctx, at(68, 34)).target, at(71, 34));
  const beyond = pin.evaluate(ctx, at(LINE + 1, 34));
  assert.ok(beyond.s < 0.5, 'past the line (their half, ahead of the ball) falls off steeply');
  assert.ok(beyond.vars.dx > 0);
  assert.equal(beyond.vars.issue, 'offside');
  assert.match(pin.text.standard.fail(beyond.vars), /offside/);
});

test('pin: beyond their line but onside (own half, or behind the ball) is a gentle miss, never "offside"', () => {
  // IFAB Law 11: the offside line is the ball, their second-last player or halfway, whichever is furthest forward.
  // 1) Their whole team pushed up into our half: their second-last player is at x = 45.
  const move = {};
  for (const r of ROLES) if (r !== 'GK') move[`them-${r}`] = at(Math.min(SCENES.ipBuildUp.them[r].x, 45), SCENES.ipBuildUp.them[r].y);
  const high = ctxFor('ipBuildUp', 'us-ST', { move }, at(40, 34));
  assert.equal(high.lines.oppSecondLastX, 45);
  const own = pin.evaluate(high, at(50, 34)); // 5 m beyond their line, still in our half
  assert.equal(own.vars.issue, 'beyond');
  approx(own.s, 1 - 5 / 6, 1e-9, 'gentle 6 m ramp, not the steep offside one');
  assert.doesNotMatch(pin.text.standard.fail(own.vars), /offside/);
  assert.equal(offside.evaluate(high, at(50, 34)).s, 1, 'the offside rule agrees: onside in our own half');
  assert.equal(pin.evaluate(high, at(44, 34)).s, 1, 'on their shoulder');
  const past = pin.evaluate(high, at(HALF + 2, 34));
  assert.equal(past.vars.issue, 'offside', 'past halfway it is offside again');
  assert.ok(past.s < own.s);
  // 2) Behind the ball: our winger is on the byline, their line holds at x = 92, the #9 is 2 m behind the ball.
  const byline = { ball: at(99, 60), carrierId: 'us-RW', move: { 'us-RW': at(99, 60), 'them-LB': at(92, 52), 'them-LCB': at(92.5, 40), 'them-RCB': at(92.5, 30), 'them-RB': at(92, 16) } };
  const c = ctxFor('ipBuildUp', 'us-ST', byline, at(92, 40));
  assert.ok(pin.weight(c) === 0, 'the ball is beyond their second-last player: filling the box (P10) takes over');
  const nearBall = ctxFor('ipBuildUp', 'us-ST', { ...byline, ball: at(93.5, 60), move: { ...byline.move, 'us-RW': at(93.5, 60) } }, at(92, 40));
  assert.ok(pin.weight(nearBall) > 0 && pin.weight(nearBall) < 3, 'fades out as the ball passes their line');
});

test('pin: only the #9, only in possession', () => {
  assert.equal(pin.weight(ctxFor('ipBuildUp', 'us-LCM')), 0);
  assert.equal(pin.weight(ctxFor('oopMidBlock', 'us-ST')), 0);
});

// ---------------------------------------------------------------- lane-open (B3)

test('lane-open: clear lane passes; standing behind their striker fails', () => {
  const ctx = ctxFor('ipBuildUp', 'us-RCM');
  assert.equal(laneOpen.weight(ctx), 3);
  assert.equal(laneOpen.evaluate(ctx, at(47, 44)).s, 1);
  // Ball (22,26), their #9 at (34,30): (46,34) is on the far side of them, same line.
  const blocked = laneOpen.evaluate(ctx, at(46, 34));
  approx(blocked.s, 0, 1e-9);
  assert.equal(blocked.vars.blockerId, 'them-ST');
  // Moving out of the shadow helps, monotonically.
  const s35 = laneOpen.evaluate(ctx, at(46, 35)).s, s37 = laneOpen.evaluate(ctx, at(46, 37)).s;
  assert.ok(s35 < s37 && s37 < 1, `expected ${s35} < ${s37} < 1`);
  // The suggested slide opens the lane.
  assert.ok(laneOpen.evaluate(ctx, blocked.target).s > 0.9);
});

test('lane-open: not for far-away players, the carrier, or out of possession', () => {
  assert.equal(laneOpen.weight(ctxFor('ipBuildUp', 'us-ST')), 0, '#9 is 47 m from the ball');
  assert.equal(laneOpen.weight(ctxFor('ipBuildUp', 'us-LCB')), 0);
  assert.equal(laneOpen.weight(ctxFor('oopMidBlock', 'us-LCM')), 0);
});

// ---------------------------------------------------------------- support-distance (B3, B4)

test('support-distance: carrier free, so support from 12-25 m', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  assert.equal(ctx.pressureOnBall, false);
  assert.equal(supportDistance.weight(ctx), 2);
  assert.equal(supportDistance.evaluate(ctx, at(35, 34)).s, 1);
  const close = supportDistance.evaluate(ctx, at(25, 28));
  assert.ok(close.s <= 0.35 + 1e-9, `crowding the carrier scored ${close.s}`);
  assert.equal(close.vars.part, 'distance');
  assert.ok(close.vars.d < close.vars.lo);
});

test('support-distance: carrier pressed (or facing back), so come short to 5-10 m', () => {
  const pressed = ctxFor('ipBuildUp', 'us-DM', { move: { 'them-ST': at(23.5, 27.5) } });
  assert.equal(pressed.pressureOnBall, true);
  assert.equal(supportDistance.evaluate(pressed, at(29, 30)).s, 1);
  const far = supportDistance.evaluate(pressed, at(35, 34));
  assert.ok(far.s <= 0.35 + 1e-9);
  assert.equal(far.vars.pressured, true);
  const backward = ctxFor('ipBuildUp', 'us-DM', { tags: { carrierFacing: 'backward' } });
  assert.equal(supportDistance.evaluate(backward, at(29, 30)).vars.pressured, true);
});

test('support-distance: do not stand on the same line from the ball as another supporter', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  // Our left #8 is at (46,22): from the ball (22,26) the spot (34,24) is on the same line.
  const r = supportDistance.evaluate(ctx, at(34, 24));
  assert.equal(r.vars.part, 'angle');
  assert.equal(r.vars.mateId, 'us-LCM');
  assert.ok(r.vars.angle < 5);
  assert.ok(r.s < 0.7);
  assert.ok(supportDistance.evaluate(ctx, r.target).vars.angle >= 30 - 1e-6, 'the target restores the angle');
});

test('support-distance: not for far-away players or out of possession', () => {
  assert.equal(supportDistance.weight(ctxFor('ipBuildUp', 'us-ST')), 0);
  assert.equal(supportDistance.weight(ctxFor('oopMidBlock', 'us-DM')), 0);
});

test('support-distance: when the carrier is pressed only the players near the ball come short; the rest hold', () => {
  // Our left #8's base is 16.5 m from the ball: judged (12-25 m) when the carrier is free...
  const free = ctxFor('ipBuildUp', 'us-LCM', {}, at(36, 20));
  assert.equal(supportDistance.weight(free), 2);
  // ...but not asked to come within 10 m of a pressed carrier from there.
  const pressed = ctxFor('ipBuildUp', 'us-LCM', { move: { 'them-ST': at(23.5, 27.5) } }, at(36, 20));
  assert.equal(pressed.pressureOnBall, true);
  assert.equal(supportDistance.weight(pressed), 0);
  assert.equal(supportDistance.weight(ctxFor('ipBuildUp', 'us-DM', { move: { 'them-ST': at(23.5, 27.5) } })), 2, 'the #6, 12 m away, comes short');
});

// ---------------------------------------------------------------- occupancy (B5)

test('occupancy: your own lane and line pass', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LCM');
  assert.equal(occupancy.weight(ctx), 2);
  assert.equal(occupancy.evaluate(ctx, at(46, 22)).s, 1);
});

test('occupancy: a third player in the lane fails', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LCM');
  // Centre lane near x = 26 already holds our LCB (22,26) and #6 (32,32).
  const r = occupancy.evaluate(ctx, at(26, 30));
  approx(r.s, 0.5, 1e-9);
  assert.equal(r.vars.part, 'lane');
  assert.equal(r.vars.inLane, 3);
  assert.equal(r.vars.lane, 'centre');
});

test('occupancy: a fourth player on a horizontal line fails', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LCM', { move: { 'us-RCM': at(62, 44) } });
  // Both wingers and the right #8 stand at x = 62.
  const r = occupancy.evaluate(ctx, at(62, 20));
  approx(r.s, 0.5, 1e-9);
  assert.equal(r.vars.part, 'line');
  assert.equal(r.vars.onLine, 4);
});

test('occupancy: lane edges blend (no jump when stepping across)', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LCM');
  const a = occupancy.evaluate(ctx, at(26, 24.8)).s, b = occupancy.evaluate(ctx, at(26, 24.9)).s;
  assert.ok(Math.abs(a - b) < 0.05, `jump ${a} -> ${b}`);
});

test('occupancy: not out of possession or for the carrier', () => {
  assert.equal(occupancy.weight(ctxFor('oopMidBlock', 'us-LCM')), 0);
  assert.equal(occupancy.weight(ctxFor('ipBuildUp', 'us-LCB')), 0);
});

// ---------------------------------------------------------------- box-fill (P10)

test('box-fill: in a crossing position the #9, far winger and far #8 attack their scoring zones, held onside', () => {
  assert.equal(crossing(at(96, 60)), 1);
  const st = ctxFor('ipBuildUp', 'us-ST', CROSS);
  assert.equal(boxFill.weight(st), BOX_FILL_DEFAULTS.weight);
  // Offside line = their second-last player at x 98: the near-post zone is held at 97.5 (R5: near post or spot).
  const near = boxFill.evaluate(st, at(97.5, 40.4));
  assert.equal(near.s, 1);
  assert.equal(near.vars.zone, 'near post');
  assert.equal(boxFill.evaluate(st, at(94, 34)).vars.zone, 'penalty spot');
  const farPost = boxFill.evaluate(st, at(97.5, 27.6)); // the far winger's zone, not the #9's
  assert.ok(farPost.s < 0.5, `back post for the #9: ${farPost.s}`);
  assert.deepEqual(boxFill.evaluate(st, at(84, 50)).target, at(97.5, 40.4), 'the fix points at the nearest zone');
  assert.deepEqual(boxFill.evaluate(st, at(84, 34)).target, at(94, 34));
  const lw = ctxFor('ipBuildUp', 'us-LW', CROSS);
  assert.equal(boxFill.evaluate(lw, at(97.5, 27.6)).s, 1, 'far winger: back post');
  assert.equal(boxFill.evaluate(lw, at(88, 4)).s, 0, 'far winger still on his touchline');
  const lcm = ctxFor('ipBuildUp', 'us-LCM', CROSS);
  assert.equal(boxFill.evaluate(lcm, at(87.5, 37)).vars.zone, 'edge of the box for a cut-back');
  assert.equal(boxFill.evaluate(lcm, at(87.5, 37)).s, 1);
  // A zone past the offside line is pulled back to it: their line at 92, the near post is attacked from 91.5.
  const deepLine = { ...CROSS, move: { ...CROSS.move, 'them-LCB': at(92, 40), 'them-RCB': at(92, 30), 'them-LB': at(92, 52), 'them-RB': at(92, 16) }, ball: at(90, 62) };
  const st2 = ctxFor('ipBuildUp', 'us-ST', { ...deepLine, move: { ...deepLine.move, 'us-RW': at(90, 62) } });
  approx(boxFill.evaluate(st2, at(80, 40)).target.x, 91.5, 1e-9);
});

test('box-fill: not for the carrier, the ball-side #8, out of possession, or without a crossing position', () => {
  assert.equal(boxFill.weight(ctxFor('ipBuildUp', 'us-RCM', CROSS)), 0, 'the ball-side #8 supports the winger');
  assert.equal(boxFill.weight(ctxFor('ipBuildUp', 'us-RW', CROSS)), 0, 'the carrier crosses');
  assert.equal(boxFill.weight(ctxFor('ipBuildUp', 'us-LB', CROSS)), 0);
  assert.equal(boxFill.weight(ctxFor('ipBuildUp', 'us-ST', { ...CROSS, ball: at(96, 34), move: { ...CROSS.move, 'us-RW': at(96, 34) } })), 0, 'central ball');
  assert.equal(boxFill.weight(ctxFor('ipBuildUp', 'us-ST', { ...CROSS, ball: at(70, 60), move: { ...CROSS.move, 'us-RW': at(70, 60) } })), 0, 'too far from their byline');
  assert.equal(boxFill.weight(ctxFor('oopMidBlock', 'us-ST')), 0);
});

test('box-fill takes the far winger over from width smoothly (P10 vs B1: the weights always sum to 3)', () => {
  for (const x of [78, 82, 84, 86, 90, 96]) {
    const ctx = ctxFor('ipBuildUp', 'us-LW', { ...CROSS, ball: at(x, 60), move: { ...CROSS.move, 'us-RW': at(x, 60) } });
    approx(width.weight(ctx) + boxFill.weight(ctx), 3, 1e-9, `ball x ${x}`);
    approx(boxFill.weight(ctx), 3 * (1 - widthDuty(at(x, 60), 'L')), 1e-9);
  }
});

test('box runners: with the ball wide in the final third the #9 and far winger stop coming short (R5)', () => {
  // Ball with our right winger at (82, 56), pressed; our #9 in the box 11 m from the ball.
  const wide = { ball: at(82, 56), carrierId: 'us-RW', move: { 'us-RW': at(82, 56), 'us-ST': at(91, 48), 'them-LCM': at(83.8, 54.3) } };
  const st = ctxFor('ipBuildUp', 'us-ST', wide);
  assert.equal(st.pressureOnBall, true);
  assert.equal(boxRunner(st), 1);
  assert.equal(supportDistance.weight(st), 0, 'not asked to come short to the touchline');
  assert.equal(laneOpen.weight(st), 0, 'a centre-back beside him in the box is normal');
  // The ball-side #8 still comes short.
  const rcm = ctxFor('ipBuildUp', 'us-RCM', { ...wide, move: { ...wide.move, 'us-RCM': at(78, 50) } });
  assert.equal(boxRunner(rcm), 0);
  assert.ok(supportDistance.weight(rcm) > 0);
  // In midfield the #9 is an ordinary supporter.
  const mid = ctxFor('ipBuildUp', 'us-ST', { ball: at(55, 56), carrierId: 'us-RW', move: { 'us-RW': at(55, 56), 'us-ST': at(62, 48) } });
  assert.equal(boxRunner(mid), 0);
  assert.ok(laneOpen.weight(mid) > 0);
});

// ---------------------------------------------------------------- between-lines (P2)

test('between-lines: free between their midfield (x 54) and back line (x 72.5)', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LCM', PROGRESSION, posOf('ipBuildUp', 'us-LCM'));
  assert.equal(betweenLines.weight(ctx), 2);
  assert.equal(betweenLines.evaluate(ctx, at(60, 22)).s, 1);
  const deep = betweenLines.evaluate(ctx, at(48, 22));
  assert.equal(deep.s, 0);
  assert.equal(deep.vars.where, 'deep');
  assert.deepEqual(deep.target, at(55, 22));
  approx(betweenLines.evaluate(ctx, at(53, 22)).s, 0.5, 1e-9);
  assert.equal(betweenLines.evaluate(ctx, at(74, 22)).vars.where, 'high');
});

test('between-lines: in the gap but tight to an opponent fails', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LCM', PROGRESSION, posOf('ipBuildUp', 'us-LCM'));
  const r = betweenLines.evaluate(ctx, at(55.5, 26.5)); // 1.6 m from their right #8 at (54,26)
  assert.ok(r.s < 0.4, `marked spot scored ${r.s}`);
  assert.equal(r.vars.part, 'free');
  assert.equal(r.vars.oppId, 'them-RCM');
});

test('between-lines: off once the ball reaches their midfield line, and in the crossing zone (P10 takes over)', () => {
  // ipBuildUp: their midfield line is at x 54.
  const withBall = (x, y = 30) => ctxFor('ipBuildUp', 'us-LCM', { ball: at(x, y), carrierId: 'us-DM', move: { 'us-DM': at(x, y) } }, posOf('ipBuildUp', 'us-LCM'));
  assert.equal(betweenLines.weight(withBall(45)), 2);
  approx(betweenLines.weight(withBall(52.5)), 1, 1e-9, 'fading in the last metres before their line');
  assert.equal(betweenLines.weight(withBall(54)), 0);
  assert.equal(betweenLines.weight(withBall(60)), 0, 'the ball is past their midfield: no "between" left to receive in');
  assert.equal(betweenLines.weight(ctxFor('ipBuildUp', 'us-LCM', CROSS)), 0, 'crossing position: the #8 fills the box instead');
});

test('between-lines: #8s and inverted wingers, only once the ball is progressing', () => {
  assert.equal(betweenLines.weight(ctxFor('ipBuildUp', 'us-LCM')), 0, 'ball still in our third');
  const prog = (id, tags) => ctxFor('ipBuildUp', id, { ...PROGRESSION, tags }, posOf('ipBuildUp', id));
  assert.equal(betweenLines.weight(prog('us-DM')), 0, 'the #6 carries it');
  assert.equal(betweenLines.weight(prog('us-RB')), 0);
  assert.equal(betweenLines.weight(prog('us-LW')), 0, 'a width-holding winger stays wide');
  assert.equal(betweenLines.weight(prog('us-LW', { widthHolders: ['LB', 'RW'] })), 2, 'inverted winger');
  assert.equal(betweenLines.weight(ctxFor('oopMidBlock', 'us-LCM')), 0);
});

// ---------------------------------------------------------------- spacing (F8)

test('spacing: nearest teammate 6-18 m', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  assert.equal(spacing.weight(ctx), 1);
  assert.equal(spacing.evaluate(ctx, at(32, 32)).s, 1);
  const close = spacing.evaluate(ctxFor('ipBuildUp', 'us-LCM'), at(33, 31)); // 1.4 m from our #6
  assert.equal(close.s, 0);
  assert.equal(close.vars.mateId, 'us-DM');
  approx(Math.hypot(close.target.x - 32, close.target.y - 32), 6, 1e-9);
  const lb = spacing.evaluate(ctxFor('ipBuildUp', 'us-LB'), at(32, 9)); // 19.1 m from our left #8
  assert.ok(lb.s > 0 && lb.s < 1);
});

test('spacing: in possession the width-holders and the #9 are only held to the minimum (they stretch the team)', () => {
  const lw = ctxFor('ipBuildUp', 'us-LW'); // nearest teammate (our left #8) is 24 m away
  assert.equal(lw.widthHolder, true);
  assert.equal(spacing.evaluate(lw, at(62, 4)).s, 1);
  assert.equal(spacing.evaluate(ctxFor('ipBuildUp', 'us-ST'), at(70, 34)).s, 1);
  assert.ok(spacing.evaluate(lw, at(47, 21)).s < 0.1, 'still not on top of a teammate (our left #8)');
  const lb = spacing.evaluate(ctxFor('ipBuildUp', 'us-LB'), at(32, 3)); // not a width-holder: 19+ m is too far
  assert.ok(lb.s < 1);
  assert.ok(spacing.evaluate(ctxFor('oopMidBlock', 'us-LW'), at(52, 0)).s < 1, 'out of possession the maximum applies');
});

test('spacing: applies in every moment, but never to the keeper', () => {
  assert.equal(spacing.weight(ctxFor('oopMidBlock', 'us-LCB')), 1);
  assert.equal(spacing.weight(ctxFor('ipBuildUp', 'us-GK')), 0);
});

test('spacing: out of possession only the maximum applies, and never to the first defender (defenders stand close on purpose)', () => {
  // Covering at D3 distance, doubling up, a compact bank, centre-backs packed on a cross: none is "one opponent marks you both".
  const lcb = ctxFor('oopMidBlock', 'us-LCB'); // our right centre-back stands at (28, 40)
  const close = spacing.evaluate(lcb, at(28, 37)); // 3 m from him
  assert.equal(close.s, 1);
  assert.equal(close.vars.min, 0);
  assert.equal(spacing.text.standard.ok(close.vars), 'You stay close enough to your teammates to help them.');
  const cut = spacing.evaluate(lcb, at(10, 4)); // 20+ m from everyone: still too far to help
  assert.ok(cut.s < 1);
  assert.match(spacing.text.standard.fail(cut.vars), /close the gap to stay connected/);
  // A loose ball is defended the same way.
  assert.equal(spacing.evaluate(ctxFor('oopMidBlock', 'us-LCB', { possession: 'none', carrierId: null }), at(28, 37)).s, 1);
  // The first defender presses wherever the others are: the press rule sets his spot.
  const fd = ctxFor('oopMidBlock', 'us-RCM');
  assert.equal(fd.duty, 'first-defender');
  assert.equal(spacing.weight(fd), 0);
  // In possession the minimum still holds (one opponent could mark you both).
  assert.equal(spacing.evaluate(ctxFor('ipBuildUp', 'us-LCM'), at(33, 31)).s, 0);
});

// ---------------------------------------------------------------- shared properties

/** Every (rule, context) pair where the rule applies, for the sweep tests below. */
function applicablePairs() {
  const out = [];
  const setups = [
    ...['LB', 'RCB', 'RB', 'DM', 'LCM', 'RCM', 'LW', 'RW', 'ST'].map((r) => ctxFor('ipBuildUp', `us-${r}`)),
    ctxFor('ipBuildUp', 'us-ST', { tags: { event: 'pass' } }),
    ctxFor('ipBuildUp', 'us-LCM', PROGRESSION, posOf('ipBuildUp', 'us-LCM')),
    ctxFor('ipBuildUp', 'us-DM', { move: { 'them-ST': at(23.5, 27.5) } }),
    ctxFor('oopMidBlock', 'us-LCB'),
    ctxFor('ipBuildUp', 'us-ST', CROSS), ctxFor('ipBuildUp', 'us-LW', CROSS), ctxFor('ipBuildUp', 'us-LCM', CROSS),
  ];
  for (const ctx of setups) for (const rule of ATTACKING) if (rule.weight(ctx) > 0) out.push([rule, ctx]);
  return out;
}

test('every attacking rule is smooth: no jumps along 0.1 m sweeps through the base', () => {
  const pairs = applicablePairs();
  for (const rule of ATTACKING) assert.ok(pairs.some(([r]) => r === rule), `${rule.id} is exercised`);
  for (const [rule, ctx] of pairs) {
    const b = ctx.learner.base;
    for (const [dx, dy] of [[1, 0], [0, 1], [0.7071, 0.7071]]) {
      let prev = null;
      for (let k = -150; k <= 150; k++) {
        const p = { x: b.x + 0.1 * k * dx, y: b.y + 0.1 * k * dy };
        if (p.x < 0 || p.x > 105 || p.y < 0 || p.y > 68) { prev = null; continue; }
        const { s } = rule.evaluate(ctx, p);
        assert.ok(s >= 0 && s <= 1, `${rule.id}: s = ${s} out of range`);
        if (prev !== null) assert.ok(Math.abs(s - prev) < 0.12, `${rule.id} (${ctx.learner.role}) jumps ${prev.toFixed(3)} -> ${s.toFixed(3)} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
        prev = s;
      }
    }
  }
});

const SCREEN_WORDS = /\b(screen|upwards?|downwards?|top|bottom)\b|\b(to|on) the (left|right)\b|\bleft of|\bright of|\b(up|down) the (screen|page)\b/i;
const words = (s) => s.trim().split(/\s+/).length;

test('feedback text: one sentence, no screen directions, kid wording within 15 words', () => {
  // Collect vars from failing spots so every fail() branch is exercised.
  const failing = [];
  const probe = (rule, ctx, spot) => {
    const r = rule.evaluate(ctx, spot);
    assert.ok(r.s < 0.9, `${rule.id} at (${spot.x}, ${spot.y}) should fail, got ${r.s}`);
    failing.push([rule, r.vars]);
  };
  const lw = ctxFor('ipBuildUp', 'us-LW');
  probe(offside, lw, at(76, 4));
  probe(offside, ctxFor('ipBuildUp', 'us-LW', { tags: { event: 'pass' } }), at(76, 4));
  probe(width, lw, at(62, 15));
  probe(width, ctxFor('ipBuildUp', 'us-LW', { ball: at(40, 60), carrierId: 'us-RB', move: { 'us-RB': at(40, 60) } }), at(62, 12));
  const st = ctxFor('ipBuildUp', 'us-ST');
  probe(pin, st, at(62, 34));
  probe(pin, st, at(75, 34));
  probe(laneOpen, ctxFor('ipBuildUp', 'us-RCM'), at(46, 34));
  const dm = ctxFor('ipBuildUp', 'us-DM');
  probe(supportDistance, dm, at(25, 28));
  probe(supportDistance, dm, at(34, 24));
  probe(supportDistance, dm, at(40, 50));
  probe(supportDistance, ctxFor('ipBuildUp', 'us-DM', { move: { 'them-ST': at(23.5, 27.5) } }), at(35, 34));
  const lcm = ctxFor('ipBuildUp', 'us-LCM');
  probe(occupancy, lcm, at(26, 30));
  probe(occupancy, ctxFor('ipBuildUp', 'us-LCM', { move: { 'us-RCM': at(62, 44) } }), at(62, 20));
  const prog = ctxFor('ipBuildUp', 'us-LCM', PROGRESSION, posOf('ipBuildUp', 'us-LCM'));
  probe(betweenLines, prog, at(48, 22));
  probe(betweenLines, prog, at(76, 22));
  probe(betweenLines, prog, at(55.5, 26.5));
  probe(spacing, lcm, at(33, 31));
  probe(spacing, ctxFor('ipBuildUp', 'us-LB'), at(32, 3));
  probe(boxFill, ctxFor('ipBuildUp', 'us-ST', CROSS), at(84, 50));
  probe(boxFill, ctxFor('ipBuildUp', 'us-LCM', CROSS), at(80, 20));

  const check = (label, s, kid) => {
    assert.equal(typeof s, 'string', label);
    assert.ok(s.length > 0, `${label} is empty`);
    assert.match(s, /^[A-Z]/, `${label} starts with a capital: "${s}"`);
    assert.match(s, /[.!?]$/, `${label} ends a sentence: "${s}"`);
    assert.ok(!/[.!?]\s+\S/.test(s), `${label} is one sentence: "${s}"`);
    assert.ok(!SCREEN_WORDS.test(s), `${label} uses a screen direction: "${s}"`);
    if (kid) assert.ok(words(s) <= 15, `${label} has ${words(s)} words: "${s}"`);
  };
  for (const [rule, vars] of failing) {
    for (const w of ['standard', 'kid']) check(`${rule.id}.${w}.fail`, rule.text[w].fail(vars), w === 'kid');
  }
  const nearLine = { ...offside.evaluate(lw, at(70, 4)).vars };
  for (const rule of ATTACKING) {
    for (const w of ['standard', 'kid']) {
      const t = rule.text[w];
      assert.ok(t.name && t.name.length > 0, `${rule.id}.${w}.name`);
      const vars = rule === offside ? nearLine : failing.find(([r]) => r === rule)[1];
      check(`${rule.id}.${w}.ok`, t.ok(vars), w === 'kid');
      check(`${rule.id}.${w}.cue`, t.cue(vars), w === 'kid');
    }
  }
});

test('offside praise is silent far from the line', () => {
  const ctx = ctxFor('ipBuildUp', 'us-RCB');
  const v = offside.evaluate(ctx, at(20, 44)).vars;
  assert.equal(offside.text.standard.ok(v), '');
  assert.equal(offside.text.kid.ok(v), '');
});

test('rules expose the contract shape and a cue highlight', () => {
  for (const rule of ATTACKING) {
    assert.equal(typeof rule.id, 'string');
    assert.ok(Array.isArray(rule.principles) && rule.principles.length > 0);
    assert.equal(typeof rule.critical, 'boolean');
  }
  assert.equal(offside.critical, true);
  const lw = ctxFor('ipBuildUp', 'us-LW');
  assert.deepEqual(offside.cue(lw), { type: 'line-x', x: LINE });
  assert.equal(width.cue(lw).type, 'segment');
  assert.deepEqual(laneOpen.cue(ctxFor('ipBuildUp', 'us-RCM'), at(46, 34)), { type: 'segment', a: at(22, 26), b: at(46, 34) });
  assert.deepEqual(supportDistance.cue(ctxFor('ipBuildUp', 'us-DM')), { type: 'player', id: 'us-LCB' });
  assert.deepEqual(spacing.cue(ctxFor('ipBuildUp', 'us-LCM'), at(33, 31)), { type: 'player', id: 'us-DM' });
});
