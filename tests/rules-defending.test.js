// Out-of-possession rules (layer B): press, cover, level-line, keeps-onside, goal-side,
// tuck, compact, screen. Each rule: a clearly good spot scores >= 0.8, a clearly bad
// spot <= 0.3, weight 0 where it does not apply, plus criticals, text and speed.

import { test, assert, approx, timed, PERF_SLACK } from './harness.js';
import { buildContext } from '../js/engine/context.js';
import { makeFrame, posOf } from './fixtures.js';
import press, { PRESS_DEFAULTS } from '../js/engine/rules/press.js';
import { SCENE_DEFAULTS } from '../js/engine/scene.js';
import cover from '../js/engine/rules/cover.js';
import levelLine from '../js/engine/rules/level-line.js';
import keepsOnside from '../js/engine/rules/keeps-onside.js';
import goalSide from '../js/engine/rules/goal-side.js';
import tuck from '../js/engine/rules/tuck.js';
import compact from '../js/engine/rules/compact.js';
import screen from '../js/engine/rules/screen.js';
import { band2, perContext, paramsFor, nameOf, kidNameOf, segDist, whole } from '../js/engine/rules/_util.js';

const RULES = [press, cover, levelLine, keepsOnside, goalSide, tuck, compact, screen];

// ---------------------------------------------------------------------------
// Extra hand-placed scenes (canonical frame; see tests/fixtures.js)

/** Ball on our right wing: their left winger carries, our RB presses, our RCB covers. */
const WIDE_RIGHT = {
  ball: { x: 36, y: 62 },
  possession: 'them',
  carrierId: 'them-LW',
  tags: { carrierFacing: 'forward' },
  us: {
    GK: { x: 5, y: 36 }, LB: { x: 30, y: 26 }, LCB: { x: 29, y: 36 }, RCB: { x: 30, y: 47 }, RB: { x: 34, y: 60 },
    DM: { x: 40, y: 44 }, LCM: { x: 46, y: 36 }, RCM: { x: 46, y: 54 },
    LW: { x: 52, y: 24 }, ST: { x: 58, y: 40 }, RW: { x: 50, y: 62 },
  },
  them: {
    GK: { x: 99, y: 34 }, LB: { x: 58, y: 64 }, LCB: { x: 76, y: 44 }, RCB: { x: 76, y: 26 }, RB: { x: 66, y: 10 },
    DM: { x: 62, y: 36 }, LCM: { x: 50, y: 48 }, RCM: { x: 54, y: 28 },
    LW: { x: 36.5, y: 62.5 }, ST: { x: 34, y: 42 }, RW: { x: 40, y: 20 },
  },
};

/** Ball wide near our box; their #9 is inside our box, marked by our RCB. Our RB presses. */
const BOX = {
  ball: { x: 22, y: 58 },
  possession: 'them',
  carrierId: 'them-LW',
  tags: {},
  us: {
    GK: { x: 3, y: 35 }, LB: { x: 12, y: 24 }, LCB: { x: 9, y: 31 }, RCB: { x: 9, y: 38 }, RB: { x: 18, y: 52 },
    DM: { x: 20, y: 40 }, LCM: { x: 28, y: 30 }, RCM: { x: 26, y: 50 },
    LW: { x: 36, y: 22 }, ST: { x: 45, y: 36 }, RW: { x: 32, y: 58 },
  },
  them: {
    GK: { x: 100, y: 34 }, LB: { x: 40, y: 64 }, LCB: { x: 70, y: 44 }, RCB: { x: 70, y: 24 }, RB: { x: 50, y: 8 },
    DM: { x: 40, y: 36 }, LCM: { x: 30, y: 44 }, RCM: { x: 32, y: 26 },
    LW: { x: 22.5, y: 58.5 }, ST: { x: 11, y: 36 }, RW: { x: 14, y: 22 },
  },
};

const ctxOf = (scene, id, changes = {}, base) =>
  buildContext(makeFrame(scene, changes), { learnerId: id, base: base ?? posOf(scene, id) });
const ev = (rule, ctx, x, y) => rule.evaluate(ctx, { x, y });

const SCREEN_DIRECTIONS = /\b(on|of|up|down) the screen\b|\b(left|right|up|down)wards?\b|\bscreen (left|right|top|bottom)\b/i;

/** Render a rule's standard and kid text for these vars and check the ARCHITECTURE §5.5 text rules. */
function checkText(rule, v) {
  for (const wording of ['standard', 'kid']) {
    const T = rule.text[wording];
    const lines = { cue: T.cue(v), [v.issue === 'ok' ? 'ok' : 'fail']: v.issue === 'ok' ? T.ok(v) : T.fail(v) };
    for (const [kind, s] of Object.entries(lines)) {
      const where = `${rule.id}/${wording}/${kind}/${v.issue}: "${s}"`;
      assert.equal(typeof s, 'string', where);
      assert.ok(s.length > 10, where);
      assert.ok(!/undefined|NaN|null|\[object/.test(s), where);
      assert.match(s, kind === 'cue' ? /\?$/ : /[.!]$/, where);
      assert.ok(!/[.!?]\s+[A-Z]/.test(s), `one sentence: ${where}`);
      assert.match(s[0], /[A-Z]/, where);
      assert.ok(!SCREEN_DIRECTIONS.test(s), `no screen directions: ${where}`);
      if (wording === 'kid') assert.ok(s.split(/\s+/).length <= 15, `kid <= 15 words: ${where}`);
    }
  }
}

// Frequently used contexts.
const mid = (id, changes) => ctxOf('oopMidBlock', id, changes);
const wide = (id, changes) => ctxOf(WIDE_RIGHT, id, changes);
/** oopMidBlock with their right winger lurking behind our line (offside unless someone plays him on). */
const RUNNER = { move: { 'them-RW': { x: 26, y: 12 } } };
/** oopMidBlock with our LCM tucked in behind the presser, so he covers and the #6 is free to screen. */
const LCM_COVERS = { move: { 'us-LCM': { x: 46, y: 41 } } };
/** WIDE_RIGHT with the ball nearer our goal and our RCB pressing it himself. */
const RCB_PRESSES = {
  ball: { x: 26, y: 58 },
  move: { 'them-LW': { x: 26.5, y: 58.5 }, 'us-RCB': { x: 24, y: 56 } },
};

// ---------------------------------------------------------------------------
// press (D1, D2)

/** oopMidBlock with the ball carried in our half: our #6 is the first defender, pressing a central carrier (D1). */
const OUR_HALF = { ball: { x: 38, y: 44 }, move: { 'them-LCM': { x: 38.5, y: 44.5 } } };
/** A spot `d` m from `c`, `deg` degrees off the line from c to the middle of our goal (positive: toward the middle of the pitch). */
function offLine(c, d, deg) {
  const ux = -c.x, uy = 34 - c.y, l = Math.hypot(ux, uy);
  const r = (deg * (c.y >= 34 ? 1 : -1) * Math.PI) / 180;
  return [c.x + (d * (ux * Math.cos(r) - uy * Math.sin(r))) / l, c.y + (d * (ux * Math.sin(r) + uy * Math.cos(r))) / l];
}

test('press: in our half the first defender closes a central carrier down on the ball-to-goal line (D1)', () => {
  const ctx = mid('us-DM', OUR_HALF);
  assert.equal(ctx.duty, 'first-defender');
  assert.equal(press.weight(ctx), 3);
  const c = { x: 38.5, y: 44.5 };
  const good = ev(press, ctx, ...offLine(c, 2.2, 0));
  assert.ok(good.s >= 0.99, `good ${good.s}`);
  assert.equal(good.vars.who, 'their #8');
  const far = ev(press, ctx, ...offLine(c, 10, 0));
  assert.ok(far.s <= 0.3, `far ${far.s}`);
  assert.equal(far.vars.issue, 'far');
  assert.equal(far.vars.dist, 10);
  const wrong = ev(press, ctx, 41, 45); // behind the carrier
  assert.ok(wrong.s <= 0.3);
  assert.equal(wrong.vars.issue, 'wrong-side');
  // 2.2 m away but 50° off the line to goal, on either side: the direct route is open.
  for (const deg of [50, -50]) {
    const off = ev(press, ctx, ...offLine(c, 2.2, deg));
    assert.ok(off.s <= 0.3, `off-line ${deg}: ${off.s}`);
    assert.equal(off.vars.issue, 'line');
    assert.equal(off.vars.principle, 'D1');
  }
  const t = good.target;
  assert.ok(ev(press, ctx, t.x, t.y).s >= 0.99, 'the target satisfies the rule');
});

test("press: in their half the press curves onto the carrier's inside, shutting the pass inside and showing them wide (D2, R5)", () => {
  const ctx = mid('us-RCM'); // their #8 carries at (58.5, 44.5): their half, off the middle of the pitch
  assert.equal(ctx.duty, 'first-defender');
  const c = { x: 58.5, y: 44.5 };
  // The line itself still passes, and so does the curved run up to centralInside.
  for (const deg of [0, PRESS_DEFAULTS.centralAim, 40]) assert.ok(ev(press, ctx, ...offLine(c, 2.2, deg)).s >= 0.99, `${deg}° inside`);
  const outside = ev(press, ctx, ...offLine(c, 2.2, -25)); // on the outside: the pass inside is open
  assert.ok(outside.s <= 0.6, `outside ${outside.s}`);
  assert.equal(outside.vars.issue, 'inside');
  assert.equal(outside.vars.principle, 'D2');
  const round = ev(press, ctx, ...offLine(c, 2.2, 65)); // swung round past the carrier's inside shoulder
  assert.ok(round.s <= 0.6, `too round ${round.s}`);
  assert.equal(round.vars.issue, 'too-round');
  // The target is the curved run: centralAim inside the line, at the middle of the distance band.
  const [tx, ty] = offLine(c, (PRESS_DEFAULTS.distMin + PRESS_DEFAULTS.distMax) / 2, PRESS_DEFAULTS.centralAim);
  approx(outside.target.x, tx, 1e-9);
  approx(outside.target.y, ty, 1e-9);
  // The lean fades in between leanFrom and leanTo: near halfway 20° outside costs a little, in their half a lot.
  const HALFWAY = { ball: { x: 49.5, y: 44 }, move: { 'them-LCM': { x: 50, y: 44.5 }, 'us-RCM': { x: 45, y: 44 } } };
  const half = ctxOf('oopMidBlock', 'us-RCM', HALFWAY, { x: 45, y: 44 });
  assert.equal(half.duty, 'first-defender');
  const s20 = ev(press, half, ...offLine({ x: 50, y: 44.5 }, 2.2, -20)).s;
  assert.ok(s20 > ev(press, ctx, ...offLine(c, 2.2, -20)).s && s20 < 1, `halfway ${s20}`);
  // scene.js places the automatic presser with the same lean (context.js pressLean).
  assert.equal(SCENE_DEFAULTS.pressAim, PRESS_DEFAULTS.centralAim);
  assert.equal(SCENE_DEFAULTS.pressLeanCentre, PRESS_DEFAULTS.leanCentre);
  assert.equal(SCENE_DEFAULTS.pressLeanFrom, PRESS_DEFAULTS.leanFrom);
  assert.equal(SCENE_DEFAULTS.pressLeanTo, PRESS_DEFAULTS.leanTo);
  // No inside in the middle of the pitch: the band is symmetric there (continuous in the carrier's y).
  const MIDDLE = { ball: { x: 58, y: 34 }, move: { 'them-LCM': { x: 58.5, y: 34.5 } } };
  const middle = mid('us-ST', MIDDLE); // our #9 is nearest
  assert.equal(middle.duty, 'first-defender');
  approx(ev(press, middle, ...offLine({ x: 58.5, y: 34.5 }, 2.2, 15)).s, ev(press, middle, ...offLine({ x: 58.5, y: 34.5 }, 2.2, -15)).s, 0.05);
});

test('press: in a wing lane, pressing from the inside beats the line, which beats the outside (D2)', () => {
  const ctx = wide('us-RB');
  assert.equal(ctx.duty, 'first-defender');
  assert.equal(press.weight(ctx), 3);
  const c = { x: 36.5, y: 62.5 };
  const u = { x: -c.x, y: 34 - c.y };
  const l = Math.hypot(u.x, u.y);
  const at = (deg) => { // 2.2 m from the carrier, rotated `deg` toward the middle of the pitch
    const r = (deg * Math.PI) / 180; // ball on our right: inside = positive rotation
    return ev(press, ctx, c.x + (2.2 * (u.x * Math.cos(r) - u.y * Math.sin(r))) / l, c.y + (2.2 * (u.x * Math.sin(r) + u.y * Math.cos(r))) / l);
  };
  const inside = at(20), line = at(0), outside = at(-30);
  assert.ok(inside.s >= 0.8, `inside ${inside.s}`);
  assert.ok(outside.s <= 0.3, `outside ${outside.s}`);
  assert.equal(outside.vars.issue, 'show-inside');
  assert.equal(outside.vars.principle, 'D2', 'the angle is D2 (dictate direction), not D1');
  assert.equal(ev(press, ctx, c.x - 9, c.y - 2).vars.principle, 'D1', 'too far off is D1 (pressure)');
  assert.ok(inside.s > line.s && line.s > outside.s);
  const t = inside.target;
  assert.ok(ev(press, ctx, t.x, t.y).s >= 0.99);
});

test('press: not applicable unless the learner is the first defender out of possession', () => {
  assert.equal(press.weight(mid('us-LCB')), 0);
  assert.equal(press.weight(mid('us-DM')), 0);
  assert.equal(press.weight(ctxOf('ipBuildUp', 'us-LCB')), 0);
  assert.equal(ev(press, mid('us-LCB'), 10, 10).s, 1, 'evaluate is harmless where it does not apply');
  // A loose ball is pressed where it lies.
  const loose = mid('us-RCM', { possession: 'none', carrierId: null });
  assert.equal(press.weight(loose), 3);
  assert.equal(ev(press, loose, 56, 43.7).vars.who, 'the ball');
});

// ---------------------------------------------------------------------------
// cover (D3)

test('cover: second defender sits behind and inside the presser, never level or straight behind', () => {
  const ctx = mid('us-DM');
  assert.equal(cover.weight(ctx), 2);
  const good = ev(cover, ctx, 42.4, 41); // 5.6 m behind and 3 m inside our #8
  assert.ok(good.s >= 0.8, `good ${good.s}`);
  assert.equal(good.vars.mate, 'your #8');
  const cases = { level: [48, 41], behind: [43, 44], outside: [43, 47], deep: [36, 38] };
  for (const [issue, [x, y]] of Object.entries(cases)) {
    const r = ev(cover, ctx, x, y);
    assert.ok(r.s <= 0.3, `${issue} ${r.s}`);
    assert.equal(r.vars.issue, issue);
  }
});

test('cover: wider and further from goal means deeper cover and more room inside (D3)', () => {
  const central = mid('us-DM'); // ball x 58, 10 m off centre
  const wideCtx = wide('us-RCB'); // ball on the touchline
  assert.equal(wideCtx.duty, 'second-defender');
  assert.equal(cover.weight(wideCtx), 3);
  const tc = ev(cover, central, 40, 40).target, tw = ev(cover, wideCtx, 28, 55).target;
  const depthC = 48 - tc.x, depthW = 34 - tw.x;
  assert.ok(depthW > depthC, `wide ${depthW} > central ${depthC}`);
  assert.ok(60 - tw.y > 44 - tc.y, 'further inside near the touchline');
  assert.ok(ev(cover, wideCtx, 28, 55).s >= 0.8);
  assert.ok(ev(cover, wideCtx, 34, 55).s <= 0.3, 'level with the presser');
});

/** oopMidBlock with the ball central-left: our LCB steps out 9.5 m ahead of the line to press, our LB covers him. */
const LCB_STEPS_OUT = {
  ball: { x: 40, y: 30 }, carrierId: 'them-RCM',
  move: { 'them-RCM': { x: 40.8, y: 30 }, 'us-LCB': { x: 37.5, y: 30 }, 'us-LB': { x: 30, y: 20 } },
};

test('cover: a covering back-liner covers from his line, never from ahead of it (U4, D3)', () => {
  const ctx = ctxOf('oopMidBlock', 'us-LB', LCB_STEPS_OUT, LCB_STEPS_OUT.move['us-LB']);
  assert.equal(ctx.firstDefender.id, 'us-LCB');
  assert.equal(ctx.duty, 'second-defender');
  const line = 28; // set by our RCB, the centre-back nearest the ball who is not pressing
  const t = ev(cover, ctx, 30, 25).target;
  assert.ok(t.x <= line + 1e-9, `cover target x ${t.x.toFixed(1)} is behind the line`);
  // 4.5 m behind the presser (ideal for a midfield cover) would be 5 m ahead of the line: not for a back-liner.
  // That is the line's business (U4): the level-line rule marks it down and says so ("get level with your back
  // line"), and the cover rule does not add a wrong reason ("cover from 10 m behind so one dribble can't beat you both").
  const ahead = ev(cover, ctx, 33, 33), onLine = ev(cover, ctx, 27.5, 33); // 3 m inside him
  assert.ok(onLine.s >= 0.8, `on the line ${onLine.s.toFixed(2)}`);
  assert.notEqual(ahead.vars.issue, 'tight');
  const level = ev(levelLine, ctx, 33, 33);
  assert.ok(level.s <= 0.3, `level-line ${level.s.toFixed(2)}`);
  assert.equal(level.vars.issue, 'high');
  // Too deep behind the line is still the cover rule's: too far to get across in time.
  const deep = ev(cover, ctx, 16, 31);
  assert.ok(deep.s < 0.5, `deep ${deep.s.toFixed(2)}`);
  assert.equal(deep.vars.issue, 'deep');
  // A midfielder covering the same presser is not held to the line.
  const dm = ctxOf('oopMidBlock', 'us-DM', { ...LCB_STEPS_OUT, move: { ...LCB_STEPS_OUT.move, 'us-LB': { x: 29, y: 12 }, 'us-DM': { x: 33, y: 32 } } }, { x: 33, y: 32 });
  assert.equal(dm.secondDefender?.id, 'us-DM');
  assert.ok(ev(cover, dm, 33, 34).target.x > line, 'the #6 may cover from in front of the line');
});

test('goal-side: a covering full-back is judged only on staying goal-side of the winger on his flank (R2)', () => {
  const ctx = ctxOf('oopMidBlock', 'us-LB', LCB_STEPS_OUT, LCB_STEPS_OUT.move['us-LB']);
  assert.equal(ctx.markTarget, null, 'the second defender marks nobody');
  assert.equal(goalSide.weight(ctx), 1.5);
  const safe = ev(goalSide, ctx, 30, 20); // their right winger is at (40, 12)
  assert.equal(safe.s, 1, 'far from him but goal-side: only the side counts');
  assert.equal(safe.vars.who, 'their right winger');
  const beaten = ev(goalSide, ctx, 43, 14);
  assert.ok(beaten.s <= 0.1);
  assert.equal(beaten.vars.issue, 'wrong-side');
  assert.deepEqual(goalSide.cue(ctx), { type: 'player', id: 'them-RW' });
  // Not for a covering centre-back or midfielder.
  assert.equal(goalSide.weight(mid('us-DM')), 0);
});

test('cover: not applicable for first or third defenders, or in possession', () => {
  assert.equal(cover.weight(mid('us-RCM')), 0);
  assert.equal(cover.weight(mid('us-LCB')), 0);
  assert.equal(cover.weight(ctxOf('ipBuildUp', 'us-DM')), 0);
});

// ---------------------------------------------------------------------------
// level-line (U4)

test('level-line: the CB nearest the ball sets the line; others hold it within 2 m', () => {
  const ctx = mid('us-LCB');
  assert.equal(levelLine.weight(ctx), 3);
  const good = ev(levelLine, ctx, 28.5, 29);
  assert.equal(good.s, 1);
  assert.equal(good.vars.ref, 'your centre-back partner');
  const deep = ev(levelLine, ctx, 22, 29);
  assert.ok(deep.s <= 0.3);
  assert.equal(deep.vars.issue, 'deep');
  assert.equal(deep.vars.off, 6);
  assert.deepEqual(deep.target, { x: 28, y: 29 });
  const high = ev(levelLine, ctx, 34, 29);
  assert.ok(high.s <= 0.3);
  assert.equal(high.vars.issue, 'high');
  // A full-back reads the same setter.
  assert.equal(ev(levelLine, mid('us-LB'), 28, 17).vars.ref, 'your right centre-back');
  // The setter aligns to the rest of the line (median of LB 29, LCB 28, RB 30).
  const setter = ev(levelLine, mid('us-RCB'), 20, 40);
  assert.equal(setter.target.x, 29);
  assert.equal(setter.vars.ref, 'the rest of your back line');
});

test('level-line: a covering second defender may drop; a third defender may not', () => {
  const rcb = wide('us-RCB'); // covering the pressing RB
  assert.equal(rcb.duty, 'second-defender');
  assert.equal(ev(levelLine, rcb, 25.5, 52).s, 1, '4.5 m covering drop is fine');
  assert.ok(ev(levelLine, rcb, 18, 52).s <= 0.3, 'but not 11.5 m');
  const lcb = wide('us-LCB'); // line set by the covering RCB at x 30
  assert.ok(ev(levelLine, lcb, 25.5, 36).s <= 0.3, 'the same 4.5 m drop breaks the line for a third defender');
});

test('level-line: not applicable for the presser, midfielders, or in possession', () => {
  assert.equal(levelLine.weight(wide('us-RB')), 0);
  assert.equal(levelLine.weight(mid('us-DM')), 0);
  assert.equal(levelLine.weight(ctxOf('ipBuildUp', 'us-RCB')), 0);
});

test('level-line: a reduced frame with nobody else in the back line has no line to hold (cast.js small games)', () => {
  // WIDE_RIGHT as a small game: our RCB covering the pressing RB, their winger on the ball and their striker. The line
  // used to fall back to the RCB's own base, so "in line with your other defenders" named players nobody could see.
  const full = makeFrame(WIDE_RIGHT);
  const keep = (ids) => ({ ...full, players: full.players.filter((p) => ids.includes(p.id)) });
  const base = posOf(WIDE_RIGHT, 'us-RCB');
  const small = buildContext(keep(['us-RCB', 'us-RB', 'them-LW', 'them-ST']), { learnerId: 'us-RCB', base });
  assert.equal(small.duty, 'second-defender');
  assert.equal(levelLine.weight(small), 0, 'nobody to be level with');
  assert.equal(levelLine.cue(small), null, 'no "Your defenders" line where no defender stands');
  assert.ok(cover.weight(small) > 0, 'the lesson (cover) still applies');
  // One more of the back line in the cast: the line is theirs again.
  const bigger = buildContext(keep(['us-RCB', 'us-RB', 'us-LCB', 'them-LW', 'them-ST']), { learnerId: 'us-RCB', base });
  assert.equal(levelLine.weight(bigger), 3);
  assert.equal(levelLine.cue(bigger).x, posOf(WIDE_RIGHT, 'us-LCB').x);
  // The full game is unchanged.
  assert.equal(levelLine.weight(wide('us-RCB')), 3);
});

// ---------------------------------------------------------------------------
// keeps-onside (U4, critical)

test('keeps-onside: dropping below the line with a runner behind it is a critical fail', () => {
  const ctx = mid('us-LB', RUNNER);
  assert.equal(keepsOnside.weight(ctx), 3);
  const good = ev(keepsOnside, ctx, 29, 17);
  assert.equal(good.s, 1);
  assert.ok(!good.critical);
  const bad = ev(keepsOnside, ctx, 24, 17);
  assert.ok(bad.s <= 0.3);
  assert.equal(bad.critical, true);
  assert.equal(bad.vars.who, 'their right winger');
  assert.equal(bad.vars.deep, 4);
  assert.deepEqual(bad.target, { x: 28, y: 17 });
  // Within the 1 m margin, or still in front of the runner: no fail.
  assert.equal(ev(keepsOnside, ctx, 27.5, 17).s, 1);
  assert.equal(ev(keepsOnside, ctx, 26.5, 12).s, 1, 'the runner at x 26 is still behind you');
  // Deeper is worse, and never above the cap while critical.
  const a = ev(keepsOnside, ctx, 25.5, 17), b = ev(keepsOnside, ctx, 24.5, 17);
  assert.ok(a.critical && b.critical);
  assert.ok(a.s <= 0.5 && b.s < a.s);
});

test('keeps-onside: not applicable with nobody in an offside position, for the presser, or for midfielders', () => {
  assert.equal(keepsOnside.weight(mid('us-LB')), 0);
  assert.equal(keepsOnside.weight(mid('us-DM', RUNNER)), 0);
  assert.equal(keepsOnside.weight(ctxOf('ipBuildUp', 'us-LB', RUNNER)), 0);
  assert.equal(keepsOnside.weight(wide('us-RB')), 0);
});

// ---------------------------------------------------------------------------
// goal-side (D5, critical in our box)

test('goal-side: between your man and the middle of our goal', () => {
  const ctx = mid('us-RCB');
  assert.equal(ctx.markTarget.id, 'them-ST');
  assert.equal(goalSide.weight(ctx), 3);
  const good = ev(goalSide, ctx, 28, 40); // 8 m goal-side, ball 23 m from him
  assert.ok(good.s >= 0.8, `good ${good.s}`);
  assert.equal(good.vars.who, 'their #9');
  const beyond = ev(goalSide, ctx, 40, 38);
  assert.ok(beyond.s <= 0.3);
  assert.equal(beyond.vars.issue, 'wrong-side');
  assert.ok(!beyond.critical, 'not critical outside our box');
  const onTop = ev(goalSide, ctx, 36 - 0.7, 38 - 0.08); // 0.7 m goal-side, on the line
  assert.equal(onTop.vars.issue, 'tight');
  assert.ok(onTop.s < 1);
  checkText(goalSide, onTop.vars);
});

test('goal-side: in our box the wrong side is critical, and marking is tight', () => {
  const ctx = ctxOf(BOX, 'us-RCB');
  assert.equal(ctx.markTarget.id, 'them-ST');
  const t = ev(goalSide, ctx, 9, 38).target;
  const good = ev(goalSide, ctx, t.x, t.y);
  assert.ok(good.s >= 0.9, `target ${good.s}`);
  assert.ok(!good.critical);
  assert.ok(Math.hypot(t.x - 11, t.y - 36) <= 2.5, 'tight to him near goal');
  const bad = ev(goalSide, ctx, 14, 38);
  assert.ok(bad.s <= 0.3);
  assert.equal(bad.critical, true);
  assert.equal(bad.vars.inBox, true);
  // The same 6 m cushion on the goal line is fine far from the ball and goal, but loose near goal.
  const far = ev(goalSide, mid('us-RCB'), 36 - 6 * 0.9938, 38 - 6 * 0.1104);
  const near = ev(goalSide, ctx, 11 - 6 * 0.9839, 36 - 6 * 0.1789);
  assert.ok(far.s >= 0.8, `far ${far.s}`);
  assert.ok(near.s <= 0.3, `near ${near.s}`);
  assert.equal(near.vars.issue, 'loose');
});

test('goal-side: weights by duty and role; not applicable without a man or in possession', () => {
  assert.equal(goalSide.weight(mid('us-LCB')), 0, 'spare centre-back has no man');
  assert.equal(goalSide.weight(mid('us-ST')), 0, 'the #9 does not track back');
  assert.equal(goalSide.weight(ctxOf('ipBuildUp', 'us-RCB')), 0);
  assert.equal(goalSide.weight(mid('us-DM')), 0, 'the covering #6 marks nobody');
  assert.equal(goalSide.weight(mid('us-DM', LCM_COVERS)), 0, 'their #9 is the RCB\'s, so the #6 screens instead');
  assert.equal(goalSide.weight(mid('us-RCM')), 0, 'first defender outside our box: the press rule judges him');
  assert.equal(goalSide.weight(mid('us-LW')), 1.5);
});

test('goal-side: the first defender is judged only with the carrier in our box, and only on the side (so the in-box critical stays)', () => {
  // Their left winger carries into our box; our right-back presses.
  const IN_BOX = { ball: { x: 14, y: 45 }, move: { 'them-LW': { x: 14.5, y: 45.5 }, 'us-RB': { x: 12, y: 45 } } };
  const fd = ctxOf(BOX, 'us-RB', IN_BOX, { x: 12, y: 45 });
  assert.equal(fd.duty, 'first-defender');
  assert.equal(goalSide.weight(fd), 1);
  const c = { x: 14.5, y: 45.5 };
  // The angle is the press rule's: the curved run onto the carrier's inside is not marked down here.
  for (const deg of [0, 40, 60]) assert.equal(ev(goalSide, fd, ...offLine(c, 2.2, deg)).s, 1, `${deg}° inside, goal-side of them`);
  const behind = ev(goalSide, fd, 17, 46); // the wrong side of them in our box
  assert.equal(behind.critical, true);
  assert.equal(behind.vars.issue, 'wrong-side');
  // Outside our box the press rule says it (once): "get goal-side before you press".
  assert.equal(goalSide.weight(mid('us-RCM')), 0);
  assert.equal(ev(press, mid('us-RCM'), 61, 45).vars.issue, 'wrong-side');
});

// ---------------------------------------------------------------------------
// tuck (D4, U5)

test('tuck: far full-back and far centre-back narrow toward the ball', () => {
  const lb = wide('us-LB');
  assert.equal(tuck.weight(lb), 2);
  assert.equal(ev(tuck, lb, 30, 26).s, 1); // 10 m outside his centre-back
  const lbWide = ev(tuck, lb, 30, 8);
  assert.ok(lbWide.s <= 0.3);
  assert.equal(lbWide.vars.issue, 'wide');
  assert.equal(lbWide.vars.ref, 'your left centre-back');
  const lbNarrow = ev(tuck, lb, 30, 32);
  assert.ok(lbNarrow.s <= 0.3);
  assert.equal(lbNarrow.vars.issue, 'narrow');
  const lcb = wide('us-LCB');
  assert.equal(ev(tuck, lcb, 29, 36).s, 1); // 11 m from the near centre-back
  assert.ok(ev(tuck, lcb, 29, 24).s <= 0.3);
  const t = ev(tuck, lcb, 29, 24).target;
  assert.equal(ev(tuck, lcb, t.x, t.y).s, 1);
});

test('tuck: far #8 and far winger come inside; far CB holds the centre when the near CB presses', () => {
  const lcm = wide('us-LCM');
  assert.equal(tuck.weight(lcm), 1.5);
  assert.ok(ev(tuck, lcm, 46, 40).s >= 0.8);
  assert.ok(ev(tuck, lcm, 46, 22).s <= 0.3);
  const lw = wide('us-LW');
  assert.ok(ev(tuck, lw, 52, 32).s >= 0.8);
  assert.ok(ev(tuck, lw, 52, 14).s <= 0.3);
  const lcb = wide('us-LCB', RCB_PRESSES);
  assert.equal(lcb.firstDefender.id, 'us-RCB');
  assert.equal(ev(tuck, lcb, 29, 36).s, 1);
  const r = ev(tuck, lcb, 29, 24);
  assert.ok(r.s <= 0.3);
  assert.equal(r.vars.mode, 'centre');
  assert.ok(ev(tuck, lcb, 29, 45).s <= 0.3, 'but not over to the ball either');
});

test('tuck: not applicable on the ball side, centrally, or with the ball in the middle', () => {
  assert.equal(tuck.weight(wide('us-RCB')), 0);
  assert.equal(tuck.weight(wide('us-RCM')), 0);
  assert.equal(tuck.weight(wide('us-DM')), 0);
  assert.equal(tuck.weight(mid('us-LB')), 0, 'ball in the right half-space, not a wing lane');
  assert.equal(tuck.weight(ctxOf('ipBuildUp', 'us-RB', { ball: { x: 30, y: 5 } })), 0);
});

// ---------------------------------------------------------------------------
// compact (U1, U2)

test('compact: back-liner keeps the line gap under 15 m and sensible gaps to line-mates', () => {
  const ctx = mid('us-LCB');
  assert.equal(compact.weight(ctx), 2);
  assert.equal(ev(compact, ctx, 28, 29).s, 1);
  const cases = { 'far-line': [18, 29], gap: [28, 22] };
  for (const [issue, [x, y]] of Object.entries(cases)) {
    const r = ev(compact, ctx, x, y);
    assert.ok(r.s <= 0.3, `${issue} ${r.s}`);
    assert.equal(r.vars.issue, issue);
  }
  const crowd = ev(compact, mid('us-LB'), 29, 27); // 2 m outside the LCB
  assert.ok(crowd.s <= 0.3);
  assert.equal(crowd.vars.issue, 'crowd');
  assert.equal(ev(compact, ctx, 18, 29).vars.gap, 22);
  assert.equal(ev(compact, ctx, 28, 22).vars.ref, 'your centre-back partner');
  const crossed = ev(compact, ctx, 28, 44);
  assert.ok(crossed.s <= 0.3, 'crossing over your partner');
  assert.equal(crossed.vars.issue, 'crossed');
  assert.ok(crossed.vars.gap > 0, 'the gap it names is never negative');
  assert.equal(crossed.vars.principle, 'U2');
  assert.equal(ev(compact, ctx, 18, 29).vars.principle, 'U1');
  checkText(compact, crossed.vars);
  const t = ev(compact, ctx, 18, 22).target;
  assert.equal(ev(compact, ctx, t.x, t.y).s, 1, 'the target fixes both gaps');
});

test('compact: midfielders and forwards measure the gap back to the next line', () => {
  assert.equal(compact.weight(mid('us-DM')), 0, 'second defender: the cover rule sets his spot');
  const dm = mid('us-DM', LCM_COVERS);
  assert.equal(dm.duty, 'third-defender');
  assert.equal(compact.weight(dm), 2);
  assert.equal(ev(compact, dm, 36, 30).s, 1); // 11 m inside the covering #8 (at y 41)
  const high = ev(compact, dm, 50, 30);
  assert.ok(high.s <= 0.3);
  assert.equal(high.vars.issue, 'far-line');
  assert.equal(high.vars.ref, 'your back line');
  const st = mid('us-ST');
  assert.equal(ev(compact, st, 52, 33).s, 1);
  assert.ok(ev(compact, st, 62, 33).s <= 0.3);
});

test('compact: a line-mate who has gone to press still closes his channel', () => {
  // Our right #8 presses their #8; the left #8's right-hand neighbour is then the presser, not the #6.
  const lcm = mid('us-LCM');
  assert.equal(lcm.firstDefender.id, 'us-RCM');
  const r = ev(compact, lcm, 44, 34); // 10 m inside the presser (y 44), 4 m from our #6 (y 38)
  assert.ok(r.vars.issue !== 'gap', 'no hole reported between the #8s while one of them presses');
});

test('compact: not applicable for the presser or in possession', () => {
  assert.equal(compact.weight(mid('us-RCM')), 0);
  assert.equal(compact.weight(ctxOf('ipBuildUp', 'us-LCB')), 0);
  assert.equal(compact.weight(mid('us-DM')), 0, 'a covering midfielder is judged by the cover rule only');
});

test('compact: a covering back-liner keeps the gaps to his line-mates, but may stand close to the presser he covers (U2, D3)', () => {
  const ctx = ctxOf('oopMidBlock', 'us-LB', LCB_STEPS_OUT, LCB_STEPS_OUT.move['us-LB']);
  assert.equal(ctx.duty, 'second-defender');
  assert.equal(compact.weight(ctx), 2);
  const close = ev(compact, ctx, 27, 27); // 3 m outside the pressing centre-back: covering, not crowding
  assert.equal(close.s, 1);
  const open = ev(compact, ctx, 27, 8); // 22 m from him: a hole in the line
  assert.ok(open.s <= 0.3);
  assert.equal(open.vars.issue, 'gap');
  assert.equal(ev(compact, ctx, 15, 27).s, 1, 'his depth is the cover rule\'s: no line-gap check');
});

// ---------------------------------------------------------------------------
// screen (R3)

test('screen: the #6 sits 5-10 m ahead of the back line, central, in the passing line to their #9', () => {
  const ctx = mid('us-DM', LCM_COVERS);
  assert.equal(ctx.duty, 'third-defender');
  assert.equal(screen.weight(ctx), 3);
  const good = ev(screen, ctx, 36, 38.5);
  assert.ok(good.s >= 0.8, `good ${good.s}`);
  assert.equal(good.vars.who, 'their #9');
  const cases = { deep: [30, 38], high: [46, 40], wide: [36, 60], lane: [36, 30] };
  for (const [issue, [x, y]] of Object.entries(cases)) {
    const r = ev(screen, ctx, x, y);
    assert.ok(r.s <= 0.3, `${issue} ${r.s}`);
    assert.equal(r.vars.issue, issue);
  }
  const t = good.target;
  assert.ok(ev(screen, ctx, t.x, t.y).s >= 0.99);
  assert.ok(segDist(t.x, t.y, 58, 44, 36, 38) < 0.5, 'target is on the ball-to-#9 line');
  // "In the passing line" means close enough to block the pass (RESEARCH 5.8: 1.5 m), not 2.7 m off it.
  const onLine = (off) => { // a spot at the screening depth, `off` metres off the ball-to-#9 line toward the middle
    const [bx, by, ax, ay] = [58, 44, 36, 38], l = Math.hypot(ax - bx, ay - by), u = (bx - 37) / (bx - ax);
    return ev(screen, ctx, bx + (ax - bx) * u + (off * (ay - by)) / l, by + (ay - by) * u - (off * (ax - bx)) / l);
  };
  assert.ok(onLine(1).s >= 0.99, `1 m off ${onLine(1).s}`);
  const off = onLine(2.7);
  assert.ok(off.s < 0.6, `2.7 m off still scores ${off.s}`);
  assert.equal(off.vars.issue, 'lane');
});

test('screen: when the block has slid toward the ball, the screening lane slides with the centre-backs (at most a half-space)', () => {
  // Shift our whole back line 10 m toward our right touchline: the #6 in front of the centre-backs,
  // in the right half-space, is now "central" for them.
  // The lane-to-their-#9 part is switched off here (shadowDist huge) to look at the lane band alone.
  const noShadow = { params: { rules: { screen: { shadowDist: 1e6 } } } };
  const shifted = (dy) => Object.fromEntries(['LB', 'LCB', 'RCB', 'RB'].map((r) => [`us-${r}`, (({ x, y }) => ({ x, y: Math.min(y + dy, 68) }))(posOf('oopMidBlock', `us-${r}`))]));
  const ctxAt = (dy) => buildContext(makeFrame('oopMidBlock', { move: { ...shifted(dy), 'us-LCM': { x: 46, y: 41 } } }), { learnerId: 'us-DM', base: posOf('oopMidBlock', 'us-DM'), ...noShadow });
  const still = ctxAt(0), slid = ctxAt(10); // centre-backs from y 29/40 to 39/50
  approx(ev(screen, still, 36, 30).s, 1, 1e-9, 'centre lane, line not slid');
  assert.ok(ev(screen, still, 36, 48).s < 0.7, 'the right half-space is wide for an unslid line');
  approx(ev(screen, slid, 36, 48).s, 1, 1e-9, 'in front of the slid centre-backs');
  assert.ok(ev(screen, slid, 36, 30).s < 0.7 && ev(screen, slid, 36, 30).vars.issue === 'wide', 'the old centre is now wide');
  // However far the line slides, the lane moves at most SCREEN_DEFAULTS.laneShiftMax (the half-space).
  const far = ctxAt(30);
  assert.ok(ev(screen, far, 36, 62).s < 0.5 && ev(screen, far, 36, 62).vars.issue === 'wide', 'never out on the wing');
});

test('screen: reduced for a covering #6, off for other roles and in possession', () => {
  assert.equal(screen.weight(mid('us-DM')), 1);
  assert.equal(screen.weight(mid('us-LCB')), 0);
  assert.equal(screen.weight(mid('us-LCM')), 0);
  assert.equal(screen.weight(ctxOf('ipBuildUp', 'us-DM')), 0);
  // A covering #6 may be pulled into the half-space with less penalty (passing-line check switched off here).
  const noShadow = { rules: { screen: { shadowDist: 100 } } };
  const at = (changes) => ev(screen, buildContext(makeFrame('oopMidBlock', changes), { learnerId: 'us-DM', base: { x: 36, y: 38 }, params: noShadow }), 36, 48).s;
  assert.ok(at({}) > at(LCM_COVERS) + 0.1);
});

// ---------------------------------------------------------------------------
// Properties shared by all eight rules

/** Every (rule, context) pair where the rule applies, used by the property tests below. */
function applicablePairs() {
  const ctxs = [
    mid('us-RCM'), mid('us-DM'), mid('us-LCB'), mid('us-RCB'), mid('us-LB', RUNNER), mid('us-DM', LCM_COVERS),
    mid('us-LCM'), mid('us-LW'), mid('us-ST'), wide('us-RB'), wide('us-RCB'), wide('us-LB'), wide('us-LCB'),
    wide('us-LCM'), wide('us-LW'), wide('us-LCB', RCB_PRESSES), ctxOf(BOX, 'us-RCB'), ctxOf(BOX, 'us-LB'), mid('us-DM', OUR_HALF),
  ];
  const pairs = [];
  for (const ctx of ctxs) for (const rule of RULES) if (rule.weight(ctx) > 0) pairs.push({ rule, ctx });
  return pairs;
}

function* grid(ctx, radius = 13, step = 1) {
  const b = ctx.learner.base;
  for (let dx = -radius; dx <= radius; dx += step) {
    for (let dy = -radius; dy <= radius; dy += step) {
      const x = b.x + dx, y = b.y + dy;
      if (x >= 0 && x <= 105 && y >= 0 && y <= 68) yield { x, y };
    }
  }
}

test('all rules: contract shape, and every rule is exercised by the property contexts', () => {
  const pairs = applicablePairs();
  for (const rule of RULES) {
    assert.match(rule.id, /^[a-z-]+$/);
    assert.ok(rule.principles.length && rule.principles.every((p) => /^[A-Z]\d+$/.test(p)), rule.id);
    assert.equal(typeof rule.critical, 'boolean');
    for (const w of ['standard', 'kid']) {
      assert.ok(rule.text[w].name, `${rule.id} ${w} name`);
      for (const f of ['ok', 'fail', 'cue']) assert.equal(typeof rule.text[w][f], 'function');
    }
    assert.ok(pairs.some((p) => p.rule === rule), `${rule.id} has an applicable context`);
  }
});

test('all rules: scores in [0, 1]; only keeps-onside and goal-side ever flag critical', () => {
  for (const { rule, ctx } of applicablePairs()) {
    for (const spot of grid(ctx)) {
      const r = rule.evaluate(ctx, spot);
      assert.ok(r.s >= 0 && r.s <= 1 && Number.isFinite(r.s), `${rule.id} s=${r.s}`);
      if (r.critical) {
        assert.ok(rule.critical, `${rule.id} flagged critical`);
        assert.ok(r.s <= 0.5, `${rule.id} critical but s=${r.s}`);
      }
      assert.ok(r.target && Number.isFinite(r.target.x) && Number.isFinite(r.target.y), `${rule.id} target`);
      assert.equal(typeof r.vars.issue, 'string');
    }
  }
});

test('all rules: the target a rule returns satisfies that rule (so the fix really fixes)', () => {
  for (const { rule, ctx } of applicablePairs()) {
    // Skip contexts where nothing nearby can satisfy the rule (e.g. a line-mate pressing leaves a gap nobody can close).
    let best = 0;
    for (const spot of grid(ctx, 15, 1)) best = Math.max(best, rule.evaluate(ctx, spot).s);
    if (best < 0.9) continue;
    for (const spot of grid(ctx, 12, 4)) {
      const { target } = rule.evaluate(ctx, spot);
      const s = rule.evaluate(ctx, target).s;
      assert.ok(s >= 0.9, `${rule.id} (${ctx.learner.role}) target from ${spot.x},${spot.y} scores ${s.toFixed(2)}`);
    }
  }
});

test('all rules: continuous - no cliffs anywhere except where a critical constraint breaks', () => {
  // Walk lines through each base at 0.25 m; any step that moves more than 0.1 is re-walked at 1 cm,
  // where a continuous score can only move a little. A real cliff shows up at any resolution.
  for (const { rule, ctx } of applicablePairs()) {
    const b = ctx.learner.base;
    const at = (x, y) => rule.evaluate(ctx, { x, y });
    for (const [ux, uy] of [[1, 0], [0, 1], [0.7071, 0.7071], [0.7071, -0.7071]]) {
      for (let off = -12; off <= 12; off += 3) {
        for (let t = -14; t < 14; t += 0.25) {
          const x0 = b.x + ux * t - uy * off, y0 = b.y + uy * t + ux * off;
          const x1 = x0 + ux * 0.25, y1 = y0 + uy * 0.25;
          if (Math.min(x0, x1) < 0 || Math.max(x0, x1) > 105 || Math.min(y0, y1) < 0 || Math.max(y0, y1) > 68) continue;
          const r0 = at(x0, y0), r1 = at(x1, y1);
          if (r0.critical || r1.critical || Math.abs(r1.s - r0.s) <= 0.1) continue;
          let prev = r0;
          for (let k = 1; k <= 25; k++) {
            const r = at(x0 + ux * 0.01 * k, y0 + uy * 0.01 * k);
            if (!r.critical && !prev.critical) {
              assert.ok(Math.abs(r.s - prev.s) <= 0.03, `${rule.id} (${ctx.learner.role}) cliff ${prev.s.toFixed(3)} -> ${r.s.toFixed(3)} near ${x0.toFixed(2)},${y0.toFixed(2)}`);
            }
            prev = r;
          }
        }
      }
    }
  }
});

test('all rules: feedback text is one sentence, second person, football language; kid wording <= 15 words', () => {
  const seen = new Set();
  for (const { rule, ctx } of applicablePairs()) {
    const byIssue = new Map();
    for (const spot of grid(ctx, 25, 1)) {
      const r = rule.evaluate(ctx, spot);
      const key = `${r.vars.issue}|${r.vars.mode ?? ''}|${r.vars.covering ?? ''}|${r.vars.inBox ?? ''}|${r.vars.unit ?? ''}`;
      if (!byIssue.has(key)) byIssue.set(key, r.vars);
    }
    for (const v of byIssue.values()) {
      seen.add(`${rule.id}:${v.issue}`);
      checkText(rule, v);
    }
  }
  // Every failure branch of every rule is reached by some spot (goal-side 'tight' is checked in its own test).
  for (const need of ['press:far', 'press:close', 'press:wrong-side', 'press:line', 'press:show-inside', 'press:inside', 'press:too-round',
    'cover:level', 'cover:tight', 'cover:deep', 'cover:behind', 'cover:outside', 'cover:wide',
    'level-line:deep', 'level-line:high', 'keeps-onside:kept', 'goal-side:wrong-side', 'goal-side:angle', 'goal-side:loose',
    'tuck:wide', 'tuck:narrow', 'compact:far-line', 'compact:close-line', 'compact:gap', 'compact:crowd',
    'screen:deep', 'screen:high', 'screen:wide', 'screen:lane']) {
    assert.ok(seen.has(need), `text branch ${need} exercised`);
  }
});

test('all rules: 8 rules x 700 spots evaluate in under 15 ms', () => {
  const build = () => [
    [press, mid('us-RCM')], [cover, mid('us-DM')], [levelLine, mid('us-LCB')], [keepsOnside, mid('us-LB', RUNNER)],
    [goalSide, mid('us-RCB')], [tuck, wide('us-LB')], [compact, mid('us-LCB')], [screen, mid('us-DM', LCM_COVERS)],
  ];
  const spots = [];
  for (let dx = -13; dx <= 13; dx++) for (let dy = -13; dy <= 13; dy++) if (spots.length < 700) spots.push({ dx, dy });
  const run = (pairs) => {
    let acc = 0;
    const t0 = performance.now();
    for (const [rule, ctx] of pairs) {
      assert.ok(rule.weight(ctx) > 0, rule.id);
      const b = ctx.learner.base;
      for (const { dx, dy } of spots) acc += rule.evaluate(ctx, { x: b.x + dx, y: b.y + dy }).s;
    }
    return { ms: performance.now() - t0, acc };
  };
  // Fresh contexts each run (so per-context prep counts): the median of 7 runs after a warm-up (harness.js timed).
  const ms = timed(() => run(build()), { warmup: 2, runs: 7 }).median;
  assert.ok(ms < 15 * PERF_SLACK, `took ${ms.toFixed(2)} ms`);
});

// ---------------------------------------------------------------------------
// _util.js helpers

test('_util: band2, segDist, whole', () => {
  assert.equal(band2(5, 3, 6, 2, 4), 1);
  approx(band2(2, 3, 6, 2, 4), 0.5);
  approx(band2(8, 3, 6, 2, 4), 0.5);
  assert.equal(band2(0, 3, 6, 2, 4), 0);
  assert.equal(band2(-100, -Infinity, 3, 0, 4), 1);
  approx(segDist(5, 3, 0, 0, 10, 0), 3);
  approx(segDist(13, 4, 0, 0, 10, 0), 5);
  assert.equal(whole(-0.3), 0);
  assert.ok(Object.is(whole(-0.3), 0));
  assert.equal(whole(2.6), 3);
});

test('_util: perContext memoises once per context (null included); paramsFor merges overrides', () => {
  let calls = 0;
  const get = perContext(() => { calls++; return calls > 5 ? {} : null; });
  const a = {}, b = {};
  assert.equal(get(a), null);
  assert.equal(get(a), null);
  assert.equal(calls, 1);
  get(b);
  assert.equal(calls, 2);
  const D = Object.freeze({ tol: 2, soft: 3 });
  assert.equal(paramsFor({ params: {} }, 'level-line', D), D);
  assert.deepEqual(paramsFor({ params: { rules: { 'level-line': { tol: 1 } } } }, 'level-line', D), { tol: 1, soft: 3 });
  // Overrides flow through buildContext params into the rule.
  const strict = buildContext(makeFrame('oopMidBlock'), { learnerId: 'us-LCB', base: { x: 28, y: 29 }, params: { rules: { 'level-line': { tol: 0.5, soft: 1 } } } });
  assert.equal(ev(levelLine, mid('us-LCB'), 29.5, 29).s, 1);
  assert.equal(ev(levelLine, strict, 29.5, 29).s, 0);
});

test('_util: player names from the learner\'s point of view', () => {
  const ctx = mid('us-LCB');
  const P = (id) => makeFrame('oopMidBlock').players.find((p) => p.id === id);
  assert.equal(nameOf(P('them-ST'), ctx), 'their #9');
  assert.equal(nameOf(P('them-LW'), ctx), 'their left winger');
  assert.equal(nameOf(P('them-RB'), ctx), 'their right-back');
  assert.equal(nameOf(P('them-GK'), ctx), 'their keeper');
  assert.equal(nameOf(P('us-RCB'), ctx), 'your centre-back partner');
  assert.equal(nameOf(P('us-RCB'), mid('us-LB')), 'your right centre-back');
  assert.equal(nameOf(P('us-DM'), ctx), 'your #6');
  assert.equal(nameOf(ctx.usAtBase.find((p) => p.id === 'us-LCB'), ctx), 'you');
  assert.equal(nameOf(null, ctx), 'the ball');
  assert.equal(kidNameOf(P('them-ST'), ctx), 'their striker');
  assert.equal(kidNameOf(P('us-DM'), ctx), 'your teammate');
});
