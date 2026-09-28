import { test, assert, approx } from './harness.js';
import { buildContext, CONTEXT_DEFAULTS } from '../js/engine/context.js';
import { SCENE_DEFAULTS } from '../js/engine/scene.js';
import { makeFrame, posOf } from './fixtures.js';

const ctxFor = (scene, id, changes = {}, opts = {}) =>
  buildContext(makeFrame(scene, changes), { learnerId: id, base: opts.base ?? posOf(scene, id), params: opts.params });

test('context: oopMidBlock basics (moment, carrier, ball zone, block height)', () => {
  const ctx = ctxFor('oopMidBlock', 'us-LCB');
  assert.equal(ctx.moment, 'out_of_possession');
  assert.equal(ctx.carrier.id, 'them-LCM');
  assert.equal(ctx.carrierFacing, 'forward');
  assert.equal(ctx.pressureOnBall, false, 'nobody of ours is within 3 m of their #8');
  assert.deepEqual(ctx.ballZone, { third: 1, lane: 3, wing: false });
  assert.equal(ctx.ballSide, 'R');
  approx(ctx.lines.ourBackLineX, 28.5);
  assert.equal(ctx.blockHeight, 'mid');
  assert.equal(ctx.learner.family, 'CB');
  assert.equal(ctx.learner.side, 'L');
  assert.equal(ctx.teammates.length, 10);
  assert.ok(!ctx.teammates.some((p) => p.id === 'us-LCB'), 'teammates exclude the learner');
  assert.equal(ctx.opponents.length, 11);
});

test('context: opponent lines (second-last defender counts the GK)', () => {
  const { lines } = ctxFor('oopMidBlock', 'us-LCB');
  assert.equal(lines.oppSecondLastX, 74); // GK 98, then the centre-backs at 74
  assert.equal(lines.oppLastX, 98);
  assert.equal(lines.oppBackLineX, 69); // median of 64, 74, 74, 64
  assert.equal(lines.oppMidLineX, 58.5); // median of 66, 58.5, 54
});

test('context: duties in oopMidBlock - RCM presses, DM covers behind the presser', () => {
  const rcm = ctxFor('oopMidBlock', 'us-RCM');
  assert.equal(rcm.duty, 'first-defender');
  assert.equal(rcm.firstDefender.id, 'us-RCM');
  assert.equal(rcm.markTarget.id, 'them-LCM', 'the first defender owns the carrier');

  const dm = ctxFor('oopMidBlock', 'us-DM');
  assert.equal(dm.duty, 'second-defender');
  assert.equal(dm.firstDefender.id, 'us-RCM');
  assert.equal(dm.secondDefender.id, 'us-DM');
  assert.ok(dm.secondDefender.x < dm.firstDefender.x - 1, 'the cover player is goal-side of the presser');

  for (const id of ['us-LCB', 'us-RCB', 'us-LB', 'us-RB', 'us-LCM', 'us-ST', 'us-LW', 'us-RW']) {
    assert.equal(ctxFor('oopMidBlock', id).duty, 'third-defender', id);
  }
});

test('context: duties use the learner at base, not the dragged spot', () => {
  // Drag the #6 onto the ball: judged spot changes, duty must not.
  const ctx = ctxFor('oopMidBlock', 'us-DM', { move: { 'us-DM': { x: 57, y: 44 } } }, { base: { x: 36, y: 38 } });
  assert.equal(ctx.duty, 'second-defender');
  assert.equal(ctx.firstDefender.id, 'us-RCM');
  assert.deepEqual(ctx.learner.base, { x: 36, y: 38 });
  // Base defaults to the frame position when not given.
  const c2 = buildContext(makeFrame('oopMidBlock'), { learnerId: 'us-DM' });
  assert.deepEqual(c2.learner.base, { x: 36, y: 38 });
});

test('context: the second defender is the nearest teammate goal-side of whoever presses', () => {
  // Our #9 drops in nearest the ball: he presses, and the #8 he dropped past becomes the cover.
  const ctx = ctxFor('oopMidBlock', 'us-DM', { move: { 'us-ST': { x: 52, y: 42 } } });
  assert.equal(ctx.firstDefender.id, 'us-ST');
  assert.equal(ctx.secondDefender.id, 'us-RCM');
  assert.equal(ctx.duty, 'third-defender');
  // A teammate level with the presser is never the cover, however close.
  const level = ctxFor('oopMidBlock', 'us-DM', { move: { 'us-RW': { x: 48, y: 47 } } });
  assert.equal(level.firstDefender.id, 'us-RCM');
  assert.equal(level.secondDefender.id, 'us-DM');
});

test('context: marks are shared out within each unit (no two centre-backs on one striker)', () => {
  assert.equal(ctxFor('oopMidBlock', 'us-RCB').markTarget.id, 'them-ST');
  assert.equal(ctxFor('oopMidBlock', 'us-LCB').markTarget, null, 'the far centre-back is the spare man');
  assert.equal(ctxFor('oopMidBlock', 'us-RB').markTarget.id, 'them-LW');
  assert.equal(ctxFor('oopMidBlock', 'us-LB').markTarget.id, 'them-RW');
  // Their right #8 is 10 m ahead of our midfield line (x 44): a compact block does not chase him (U1, D7)...
  assert.equal(ctxFor('oopMidBlock', 'us-LCM').markTarget, null);
  // ...but within midReach of it he is our left #8's.
  assert.equal(ctxFor('oopMidBlock', 'us-LCM', { move: { 'them-RCM': { x: 50, y: 26 } } }).markTarget.id, 'them-RCM');
  // Wingers track the full-back on their flank (R4), even with a #8 nearer.
  assert.equal(ctxFor('oopMidBlock', 'us-LW').markTarget.id, 'them-RB');
  assert.equal(ctxFor('oopMidBlock', 'us-RW').markTarget.id, 'them-LB');
  assert.equal(ctxFor('oopMidBlock', 'us-DM').markTarget, null, 'the second defender covers and marks nobody');
  // Nobody marks their keeper, the carrier belongs only to the first defender, and nobody is marked twice.
  const seen = new Set();
  for (const id of ['us-LB', 'us-LCB', 'us-RCB', 'us-RB', 'us-LCM', 'us-LW', 'us-ST', 'us-RW']) {
    const m = ctxFor('oopMidBlock', id).markTarget;
    assert.ok(!m || (m.role !== 'GK' && m.id !== 'them-LCM'), id);
    if (m) { assert.ok(!seen.has(m.id), `${m.id} marked twice`); seen.add(m.id); }
  }
});

test('context: an attacker standing offside behind our line is nobody\'s mark (U4: the line holds and leaves him there)', () => {
  // Their #9 onside and near our centre-backs: marked.
  assert.equal(ctxFor('oopMidBlock', 'us-RCB').markTarget.id, 'them-ST');
  const line = ctxFor('oopMidBlock', 'us-RCB').usAtBase.map((p) => p.x).sort((a, b) => a - b)[1];
  // Level with our second-last player (within the margin): still marked.
  assert.equal(ctxFor('oopMidBlock', 'us-RCB', { move: { 'them-ST': { x: line - 0.5, y: 38 } } }).markTarget?.id, 'them-ST');
  // Well behind it (offside): left alone, so goal-side never asks a defender to drop and play him onside.
  const off = ctxFor('oopMidBlock', 'us-RCB', { move: { 'them-ST': { x: line - CONTEXT_DEFAULTS.offsideMarkMargin - 2, y: 38 } } });
  assert.notEqual(off.markTarget?.id, 'them-ST');
});

test('context: midfielders hand an opponent at our back line\'s height over to the back line (D7)', () => {
  // The LCM covers, so the #6 is a third defender; their #9 sits on our RCB; a short markRadius
  // keeps the back line from claiming the runner, so only the hand-over rule decides.
  const move = (x) => ({ move: { 'us-LCM': { x: 46, y: 41 }, 'them-ST': { x: 29, y: 42 }, 'them-RCB': { x, y: 34 } } });
  const between = ctxFor('oopMidBlock', 'us-DM', move(40), { params: { markRadius: 6 } });
  assert.equal(between.duty, 'third-defender');
  assert.equal(between.markTarget?.id, 'them-RCB', 'a runner between the lines is the #6\'s');
  const deep = ctxFor('oopMidBlock', 'us-DM', move(33), { params: { markRadius: 6 } });
  assert.equal(deep.markTarget, null, 'at the back line\'s height (28.5 + 5) he is handed over');
  assert.equal(ctxFor('oopMidBlock', 'us-DM', move(33), { params: { markRadius: 6, handoverDepth: 4 } }).markTarget?.id, 'them-RCB');
});

test('context: zonal hand-over the other way - the back line leaves opponents far ahead of it to the midfield', () => {
  // Their #8 drops into the space between the lines, 9 m ahead of our back line (28.5 + 8 = 36.5):
  // our centre-back does not follow him up the pitch; the #6 picks him up.
  const move = { move: { 'them-RCM': { x: 37.5, y: 29 } } };
  assert.notEqual(ctxFor('oopMidBlock', 'us-LCB', move).markTarget?.id, 'them-RCM');
  const near = ctxFor('oopMidBlock', 'us-LCB', { move: { 'them-RCM': { x: 34, y: 29 } } });
  assert.equal(near.markTarget?.id, 'them-RCM', 'within backReach he is the centre-back\'s');
  // The #6 only takes opponents between our back line and our midfield line (he screens, R3).
  const high = ctxFor('oopMidBlock', 'us-DM', { move: { 'us-LCM': { x: 46, y: 41 }, 'them-RCM': { x: 52, y: 36 } } }, { params: { markRadius: 30 } });
  assert.equal(high.duty, 'third-defender');
  assert.ok(high.lines.ourMidLineX < 52, 'fixture: their #8 is beyond our midfield line');
  assert.notEqual(high.markTarget?.id, 'them-RCM');
});

test('context: flank duels come first - full-back on their winger, winger on their full-back, and never a centre-back for a winger', () => {
  assert.equal(ctxFor('oopMidBlock', 'us-LB').markTarget.id, 'them-RW');
  assert.equal(ctxFor('oopMidBlock', 'us-RB').markTarget.id, 'them-LW');
  // Their right-back has the ball and our left #8 presses him: our left winger is left with nobody,
  // rather than being handed their centre-back (R4 is about the full-back).
  const lw = ctxFor('oopMidBlock', 'us-LW', { ball: { x: 64, y: 8 }, carrierId: 'them-RB', move: { 'us-LCM': { x: 62, y: 10 } } }, { base: { x: 68, y: 6 } });
  assert.equal(lw.firstDefender.id, 'us-LCM');
  assert.equal(lw.duty, 'third-defender');
  assert.equal(lw.markTarget, null);
});

test('context: the first defender is the nearest player the ball has not gone past (F1, T3)', () => {
  // The ball at (50, 44); our right #8 is 3 m goal-side of it, our #9 beyond it.
  const ctx = ctxFor('oopMidBlock', 'us-DM', { ball: { x: 50, y: 44 }, move: { 'us-ST': { x: 54, y: 44 }, 'us-RCM': { x: 47, y: 44 } } });
  assert.equal(ctx.firstDefender.id, 'us-RCM', 'goal-side (3 m) beats past-the-ball (4 m, counted as 12)');
  const past = ctxFor('oopMidBlock', 'us-DM', { ball: { x: 50, y: 44 }, move: { 'us-ST': { x: 52, y: 44 }, 'us-RCM': { x: 47, y: 44 } } });
  assert.equal(past.firstDefender.id, 'us-RCM', '2 m past the ball counts as 6 m: the #8 3 m goal-side presses');
  const noWeight = ctxFor('oopMidBlock', 'us-DM', { ball: { x: 50, y: 44 }, move: { 'us-ST': { x: 52, y: 44 }, 'us-RCM': { x: 47, y: 44 } } }, { params: { pastWeight: 0 } });
  assert.equal(noWeight.firstDefender.id, 'us-ST', 'by plain distance the beaten #9 would press');
  assert.equal(CONTEXT_DEFAULTS.pastWeight, SCENE_DEFAULTS.pressPastWeight, 'the same rule autoFrame uses to pick its presser');
});

test('context: with the ball wide in our half the full-back engages the winger and a centre-back covers him (R2, U5)', () => {
  // Their right winger on the ball on our left touchline; our left #8 is nearer the ball than our left-back.
  const wide = { ball: { x: 30, y: 5 }, carrierId: 'them-RW', move: {
    'them-RW': { x: 30.8, y: 5 }, 'us-LCM': { x: 28, y: 10 }, 'us-LB': { x: 22, y: 9 }, 'us-LCB': { x: 18, y: 16 }, 'us-DM': { x: 19, y: 14 },
  } };
  const lb = ctxFor('oopMidBlock', 'us-LB', wide, { base: wide.move['us-LB'] });
  assert.equal(lb.duty, 'first-defender', 'the full-back engages, not the nearer #8');
  assert.equal(lb.markTarget.id, 'them-RW');
  const lcb = ctxFor('oopMidBlock', 'us-LCB', wide, { base: wide.move['us-LCB'] });
  assert.equal(lcb.secondDefender.id, 'us-LCB', 'the near centre-back covers, although the #6 is nearer the full-back');
  assert.equal(lcb.duty, 'second-defender');
  // Without the full-back preference the #8 would press (plain distance).
  assert.equal(ctxFor('oopMidBlock', 'us-LB', wide, { base: wide.move['us-LB'], params: { fbEngage: 0 } }).firstDefender.id, 'us-LCM');
  // In their half (x beyond fbEngageTo) the #8 or winger presses as before.
  const high = { ...wide, ball: { x: 60, y: 5 }, move: { ...wide.move, 'them-RW': { x: 60.8, y: 5 }, 'us-LCM': { x: 58, y: 10 }, 'us-LB': { x: 52, y: 9 } } };
  assert.equal(ctxFor('oopMidBlock', 'us-LB', high, { base: high.move['us-LB'] }).firstDefender.id, 'us-LCM');
  // Scene and context rank the same way.
  assert.equal(CONTEXT_DEFAULTS.fbEngage, SCENE_DEFAULTS.pressFbEngage);
  assert.equal(CONTEXT_DEFAULTS.fbEngageFrom, SCENE_DEFAULTS.pressFbEngageFrom);
  assert.equal(CONTEXT_DEFAULTS.fbEngageTo, SCENE_DEFAULTS.pressFbEngageTo);
});

test('context: a midfield first defender well ahead of the back line is covered from midfield, not by a centre-back', () => {
  // Loose ball in midfield: our #6 goes to it 8 m ahead of the back line; an #8 and a centre-back are both goal-side.
  const loose = { possession: 'none', carrierId: null, ball: { x: 50, y: 40 }, move: {
    'us-DM': { x: 47.5, y: 39.7 }, 'us-RCB': { x: 40, y: 43 }, 'us-LCB': { x: 40, y: 33 }, 'us-LB': { x: 40, y: 20 }, 'us-RB': { x: 40, y: 53 },
    'us-RCM': { x: 45, y: 49 },
  } };
  const ctx = ctxFor('oopMidBlock', 'us-RCB', loose, { base: loose.move['us-RCB'] });
  assert.equal(ctx.firstDefender.id, 'us-DM');
  assert.equal(ctx.secondDefender.id, 'us-RCM', 'the #8 (9.7 m) covers rather than the centre-back (7.9 m), who holds the line');
  assert.equal(ctx.duty, 'third-defender');
  // A #6 dropping in front of the line (within coverMidAhead) may still be covered by a centre-back.
  const deep = { ...loose, move: { ...loose.move, 'us-DM': { x: 44, y: 39.7 } }, ball: { x: 46.5, y: 40 } };
  assert.equal(ctxFor('oopMidBlock', 'us-RCB', deep, { base: deep.move['us-RCB'] }).secondDefender.id, 'us-RCB');
});

test('context: in a mid block, midfielders mark the opponents between our lines, not their centre-backs behind the ball (U6)', () => {
  // Their right centre-back on the ball at (60, 20); their left centre-back 3.5 m behind the ball and their
  // left #8 between our midfield and back line. Our right #8 is nearer their centre-back.
  const mid = { ball: { x: 60, y: 20 }, carrierId: 'them-RCB', move: {
    'them-RCB': { x: 60.8, y: 20 }, 'them-LCB': { x: 63.5, y: 36 }, 'them-LCM': { x: 53, y: 40.5 }, 'them-DM': { x: 58, y: 24 },
    'us-RCM': { x: 59, y: 39 }, 'us-LCM': { x: 57.5, y: 20.5 }, 'us-DM': { x: 47, y: 27 },
    'us-LB': { x: 40, y: 12 }, 'us-LCB': { x: 39, y: 22 }, 'us-RCB': { x: 39, y: 34 }, 'us-RB': { x: 40, y: 47 },
  } };
  const rcm = ctxFor('oopMidBlock', 'us-RCM', mid, { base: mid.move['us-RCM'] });
  assert.equal(rcm.blockHeight, 'mid');
  assert.equal(rcm.duty, 'third-defender');
  assert.equal(rcm.markTarget.id, 'them-LCM', 'their #8 between the lines, not their centre-back behind the ball');
  // In a high block the press marks behind the ball: the same picture 10 m further up the pitch.
  const up = (p) => ({ x: p.x + 20, y: p.y });
  const high = { ...mid, ball: up(mid.ball), move: Object.fromEntries(Object.entries(mid.move).map(([id, p]) => [id, up(p)])) };
  const pressing = ctxFor('oopMidBlock', 'us-RCM', high, { base: high.move['us-RCM'] });
  assert.equal(pressing.blockHeight, 'high');
  assert.equal(pressing.markTarget.id, 'them-LCB', 'a high press may mark behind the ball');
});

test('context: pressure on the ball counts an opponent near the ball as well as near the carrier', () => {
  // autoFrame puts the carrier 0.8 m behind the ball and the presser 2.5 m in front of it: 3.3 m apart.
  const ctx = ctxFor('ipBuildUp', 'us-DM', { move: { 'them-ST': { x: 22 + 2.4, y: 26 + 0.4 }, 'us-LCB': { x: 21.2, y: 26 } } });
  assert.ok(Math.hypot(ctx.carrier.x - 24.4, ctx.carrier.y - 26.4) > CONTEXT_DEFAULTS.pressureRadius, 'fixture: over 3 m from the carrier');
  assert.equal(ctx.pressureOnBall, true);
});

test('context: markRadius limits marks', () => {
  const ctx = ctxFor('oopMidBlock', 'us-RCB', {}, { params: { markRadius: 5 } });
  assert.equal(ctx.markTarget, null, 'their #9 is 8.2 m away');
  assert.equal(ctx.params.markRadius, 5);
  assert.equal(ctx.params.pressureRadius, CONTEXT_DEFAULTS.pressureRadius, 'other defaults kept');
});

test('context: dangerous attacker is the opponent nearest our goal (not the carrier or keeper)', () => {
  assert.equal(ctxFor('oopMidBlock', 'us-DM').dangerousAttacker.id, 'them-ST');
});

test('context: block height thresholds', () => {
  const moveLine = (x) => Object.fromEntries(['LB', 'LCB', 'RCB', 'RB'].map((r, i) => [`us-${r}`, { x, y: 15 + i * 12 }]));
  assert.equal(ctxFor('oopMidBlock', 'us-DM', { move: moveLine(46) }).blockHeight, 'high');
  assert.equal(ctxFor('oopMidBlock', 'us-DM', { move: moveLine(45) }).blockHeight, 'high');
  assert.equal(ctxFor('oopMidBlock', 'us-DM', { move: moveLine(30) }).blockHeight, 'mid');
  assert.equal(ctxFor('oopMidBlock', 'us-DM', { move: moveLine(20) }).blockHeight, 'low');
  // Learner in the back line counts at base.
  assert.equal(ctxFor('oopMidBlock', 'us-LCB', { move: moveLine(20) }, { base: { x: 20, y: 27 } }).blockHeight, 'low');
});

test('context: pressure on the ball is derived, and the tag overrides it', () => {
  const pressed = ctxFor('oopMidBlock', 'us-LCB', { move: { 'us-RCM': { x: 56.5, y: 44 } } });
  assert.equal(pressed.pressureOnBall, true);
  const tagged = ctxFor('oopMidBlock', 'us-LCB', { tags: { pressureOnBall: true } });
  assert.equal(tagged.pressureOnBall, true);
  const tagOff = ctxFor('oopMidBlock', 'us-LCB', { move: { 'us-RCM': { x: 56.5, y: 44 } }, tags: { pressureOnBall: false } });
  assert.equal(tagOff.pressureOnBall, false);
});

test('context: in possession (ipBuildUp) attacker duties, no defender duties, their block', () => {
  const lcb = ctxFor('ipBuildUp', 'us-LCB');
  assert.equal(lcb.moment, 'in_possession');
  assert.equal(lcb.duty, 'first-attacker');
  assert.equal(lcb.firstDefender, null);
  assert.equal(lcb.markTarget, null);
  assert.equal(lcb.pressureOnBall, false, 'their #9 is 12.6 m from the carrier');
  assert.equal(lcb.blockHeight, 'mid', 'their back line at x 72.5 is 32.5 m from their goal');
  assert.equal(ctxFor('ipBuildUp', 'us-DM').duty, 'second-attacker');
  assert.equal(ctxFor('ipBuildUp', 'us-ST').duty, 'third-attacker');
  assert.equal(ctxFor('ipBuildUp', 'us-LW').widthHolder, true);
  assert.equal(ctxFor('ipBuildUp', 'us-LB').widthHolder, false);
  assert.equal(ctxFor('ipBuildUp', 'us-LB', { tags: { widthHolders: ['LB'] } }).widthHolder, true);
  assert.equal(ctxFor('ipBuildUp', 'us-LW', { tags: { widthHolders: ['LB'] } }).widthHolder, false);
});

test('context: a loose ball is defended (duties) with no carrier', () => {
  const ctx = ctxFor('oopMidBlock', 'us-RCM', { possession: 'none', carrierId: null });
  assert.equal(ctx.moment, 'loose');
  assert.equal(ctx.carrier, null);
  assert.equal(ctx.duty, 'first-defender');
  assert.equal(ctx.markTarget, null);
  assert.equal(ctx.pressureOnBall, false);
});
