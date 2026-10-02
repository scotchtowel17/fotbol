import { test as harnessTest, assert, approx, isNode, loadJSON } from './harness.js';
import {
  createBoard, BOARD_DEFAULTS, BALL_ID, pickOrientation, viewBoxFor, project, unproject, worldTransform,
  keyDelta, describeSpot, tokenName, pitchMarkings, tokenScale, labelScale, pxPerMetre, focusViewBox, youTag,
  SHIRT_NUMBERS, tokenLabel, simpleTokenName, describeSpotSimple, hitRadius, aidLevel, aidStrength, hintPose, hintTotalMs,
  shirtNumberOf, tapAction, tagScale, playerLabelParams,
  CAMERA_MIN, cameraViewBox, figureScale, ballScale, ballPx, boardScales, facingToward, carrierTarget, carriedBallAt,
  carryReach, carryWeight, stepToward, isRunning, motionPlan, ballTrail, contrastRatio, relLuminance, baseScale, tagPlacement,
  ghostFit, discBallAt, discCarry, discCarryDir, standHeight, figureParts, figureOcclusion, pairCover, declutter, carrySpot,
  shownBox, TAG_FORMS, discTagPlacement, glowAt, zonePoints, AID_LEVELS,
} from '../js/ui/board.js';
import { KID_LEVELS } from '../js/engine/kidscore.js';
import { FIGURE, FIGURE_BOXES, FIGURE_DEFAULTS, numberFontSize } from '../js/ui/figures.js';
import { frameAt } from '../js/engine/timeline.js';
import { createFormation } from '../js/engine/formation.js';
import { LENGTH, WIDTH, MID_Y, PENALTY_AREA, PENALTY_SPOT_DIST, CIRCLE_RADIUS, POSTS, GOAL_DEPTH } from '../js/engine/pitch.js';
import { makeFrame } from './fixtures.js';

// In the browser (tests.html) every test in a file starts as the file is imported, and the runner goes on to the next
// file once no result has come for a moment (SETTLE_MS). Some browser tests here wait for animation frames and timers
// far longer than that (the hint hand plays for 2.5 s): run on, they overlapped the next files, whose work held up
// their frames (and their results were credited to those files). So this file's import holds until every test in it
// is done (the await at its end). Node runs the tests as always.
const running = [];
const test = (name, fn) => {
  const done = harnessTest(name, fn);
  if (!isNode) running.push(done);
  return done;
};

const ORIENTS = ['horizontal', 'vertical'];

/** Apply an SVG 'matrix(a b c d e f)' string (or '' = identity) to a point. */
function applyMatrix(str, p) {
  if (!str) return { ...p };
  const [a, b, c, d, e, f] = str.match(/-?[\d.]+/g).map(Number);
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

test('board: auto orientation is vertical only for a portrait container narrower than 600 px', () => {
  assert.equal(pickOrientation('auto', 375, 700), 'vertical');
  assert.equal(pickOrientation('auto', 599, 900), 'vertical');
  assert.equal(pickOrientation('auto', BOARD_DEFAULTS.portraitMaxWidth, 1200), 'horizontal', '600 px is not narrower than 600');
  assert.equal(pickOrientation('auto', 375, 300), 'horizontal', 'narrow but landscape');
  assert.equal(pickOrientation('auto', 1200, 800), 'horizontal');
  assert.equal(pickOrientation('auto', 0, 0), 'horizontal', 'unmeasured container');
  assert.equal(pickOrientation('vertical', 1400, 600), 'vertical', 'explicit wins');
  assert.equal(pickOrientation('horizontal', 375, 700), 'horizontal');
});

test('board: viewBox is the pitch plus a 3 m margin, rotated for vertical', () => {
  const m = BOARD_DEFAULTS.margin;
  assert.equal(m, 3);
  assert.deepEqual(viewBoxFor('horizontal'), { x: -3, y: -3, width: LENGTH + 6, height: WIDTH + 6 });
  assert.deepEqual(viewBoxFor('vertical'), { x: -3, y: -3, width: WIDTH + 6, height: LENGTH + 6 });
});

test('board: horizontal attacks right with our left at the top', () => {
  assert.deepEqual(project({ x: 0, y: MID_Y }, 'horizontal'), { x: 0, y: MID_Y });
  assert.ok(project({ x: 105, y: 34 }, 'horizontal').x > project({ x: 0, y: 34 }, 'horizontal').x);
  assert.ok(project({ x: 50, y: 0 }, 'horizontal').y < project({ x: 50, y: 68 }, 'horizontal').y);
});

test('board: vertical has our goal at the bottom, attacking up, our left on the left', () => {
  const ownGoal = project({ x: 0, y: MID_Y }, 'vertical');
  const oppGoal = project({ x: LENGTH, y: MID_Y }, 'vertical');
  assert.deepEqual(ownGoal, { x: MID_Y, y: LENGTH });
  assert.deepEqual(oppGoal, { x: MID_Y, y: 0 });
  assert.ok(project({ x: 50, y: 0 }, 'vertical').x < project({ x: 50, y: 68 }, 'vertical').x, 'our left touchline is on the left');
  const vb = viewBoxFor('vertical');
  for (const p of [{ x: 0, y: 0 }, { x: LENGTH, y: WIDTH }, { x: LENGTH, y: 0 }]) {
    const v = project(p, 'vertical');
    assert.ok(v.x >= vb.x && v.x <= vb.x + vb.width && v.y >= vb.y && v.y <= vb.y + vb.height, 'corners inside the viewBox');
  }
});

test('board: unproject inverts project, and the world-group transform matches project', () => {
  const pts = [{ x: 0, y: 0 }, { x: 12.3, y: 45.6 }, { x: 105, y: 68 }, { x: 52.5, y: 34 }, { x: 88, y: 3 }];
  for (const o of ORIENTS) {
    for (const p of pts) {
      const v = project(p, o);
      const back = unproject(v, o);
      approx(back.x, p.x); approx(back.y, p.y);
      const m = applyMatrix(worldTransform(o), p);
      approx(m.x, v.x); approx(m.y, v.y);
    }
  }
});

test('board: arrow keys move the token in the pressed SCREEN direction in both layouts', () => {
  const screen = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const p = { x: 40, y: 30 };
  for (const o of ORIENTS) {
    for (const [key, [sx, sy]] of Object.entries(screen)) {
      for (const [big, step] of [[false, 0.5], [true, 2]]) {
        const d = keyDelta(key, o, big);
        approx(Math.hypot(d.x, d.y), step, 1e-9, `${o} ${key} step`);
        const a = project(p, o), b = project({ x: p.x + d.x, y: p.y + d.y }, o);
        approx(b.x - a.x, sx * step, 1e-9, `${o} ${key} screen dx`);
        approx(b.y - a.y, sy * step, 1e-9, `${o} ${key} screen dy`);
      }
    }
  }
  assert.deepEqual(keyDelta('ArrowUp', 'vertical'), { x: 0.5, y: 0 }, 'up = toward their goal on a vertical pitch');
  assert.equal(keyDelta('Enter', 'horizontal'), null);
});

test('board: positions are described in plain football words', () => {
  assert.equal(describeSpot({ x: 28.4, y: 20 }), '28 metres from our goal line, left half-space, defensive third');
  assert.equal(describeSpot({ x: 80, y: 60 }), '80 metres from our goal line, right wing, final third');
  assert.equal(tokenName('us-LCB', 'us-LCB'), 'You (Left centre-back)');
  assert.equal(tokenName('them-ST', 'us-LCB'), 'Opponent: Striker (#9)');
  assert.equal(tokenName('us-DM', 'us-LCB'), 'Teammate: Holding midfielder (#6)');
  assert.equal(tokenName(BALL_ID, 'us-LCB'), 'Ball');
});

test('board: IFAB markings (penalty arcs, goals, corners) are geometrically right', () => {
  const marks = pitchMarkings();
  const arcs = marks.filter((m) => m.tag === 'path' && /A9\.15 9\.15/.test(m.attrs.d));
  assert.equal(arcs.length, 2, 'two penalty arcs');
  for (const arc of arcs) {
    const [x1, y1, , , , , , x2, y2] = arc.attrs.d.match(/-?[\d.]+/g).map(Number);
    const own = x1 < LENGTH / 2;
    const edge = own ? PENALTY_AREA.depth : LENGTH - PENALTY_AREA.depth;
    const spotX = own ? PENALTY_SPOT_DIST : LENGTH - PENALTY_SPOT_DIST;
    approx(x1, edge, 1e-3); approx(x2, edge, 1e-3);
    approx(Math.hypot(x1 - spotX, y1 - MID_Y), CIRCLE_RADIUS, 1e-2, 'arc starts on the 9.15 m circle');
    approx(Math.hypot(x2 - spotX, y2 - MID_Y), CIRCLE_RADIUS, 1e-2, 'arc ends on the 9.15 m circle');
    approx(y1 + y2, 2 * MID_Y, 1e-3, 'symmetric about the centre line');
    // Sweep flag: from the top endpoint, clockwise (1) bulges toward +x (own end), anticlockwise (0) toward -x.
    const sweep = Number(arc.attrs.d.match(/A[\d.]+ [\d.]+ 0 0 ([01])/)[1]);
    assert.equal(sweep, own ? 1 : 0, 'arc bulges out of the penalty area');
  }
  const goals = marks.filter((m) => m.cls === 'pitch-goal');
  assert.equal(goals.length, 2);
  for (const g of goals) {
    const nums = g.attrs.d.match(/-?[\d.]+/g).map(Number);
    assert.ok(nums.includes(+POSTS.top.toFixed(3)) && nums.includes(+POSTS.bottom.toFixed(3)), 'posts at 30.34 / 37.66');
    assert.ok(nums.includes(-GOAL_DEPTH) || nums.includes(LENGTH + GOAL_DEPTH), 'net behind the goal line');
  }
  const corners = marks.filter((m) => m.tag === 'path' && /A1 1 /.test(m.attrs.d));
  assert.equal(corners.length, 4);
  // Everything fits inside the 3 m margin.
  for (const m of marks) {
    const nums = (m.attrs.d ? m.attrs.d.match(/-?[\d.]+/g) : Object.values(m.attrs)).map(Number);
    for (const n of nums) assert.ok(n >= -BOARD_DEFAULTS.margin && n <= LENGTH + BOARD_DEFAULTS.margin, `${m.tag} value ${n} outside the viewBox`);
  }
});

// ---------------------------------------------------------------- live board (browser only: needs a DOM with layout)

/** A board in a sized, off-screen container; `run(board, container)` then clean up. */
async function withBoard(run) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:0;top:0;width:630px;height:444px;opacity:0;pointer-events:none';
  document.body.appendChild(container);
  const board = createBoard(container, { orientation: 'horizontal' });
  try { await run(board, container); } finally { board.destroy(); container.remove(); }
}

const frameWith = (spot) => ({
  t: 0, ball: { x: 50, y: 40 }, possession: 'them', carrierId: null, tags: {},
  players: [{ id: 'us-LCB', team: 'us', role: 'LCB', ...spot }, { id: 'them-ST', team: 'them', role: 'ST', x: 45, y: 38 }],
});

test('board (browser): render wins over the pointer during a drag, so a mode can correct the dragged spot live', async () => {
  if (isNode) return;
  await withBoard(async (board) => {
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB' });
    const moves = [];
    board.enableDrag({ ids: ['us-LCB'], onMove: (id, p) => moves.push(p) });
    const g = board.el.querySelector('.token[data-id="us-LCB"]');
    const svg = board.el.querySelector('svg');
    const m = board.el.querySelector('.board-world').getScreenCTM();
    const toScreen = (p) => ({ clientX: m.a * p.x + m.c * p.y + m.e, clientY: m.b * p.x + m.d * p.y + m.f });
    const ev = (type, p) => new PointerEvent(type, { pointerId: 7, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true, ...toScreen(p) });
    g.dispatchEvent(ev('pointerdown', { x: 30, y: 30 }));
    svg.dispatchEvent(ev('pointermove', { x: 40, y: 30 }));
    assert.ok(moves.length > 0 && Math.abs(moves.at(-1).x - 40) < 0.5, 'onMove reports the pointer spot');
    // The mode clamps the spot (e.g. keeps the learner onside) and renders it: the board shows the clamp.
    board.render(frameWith({ x: 32, y: 30 }), { learnerId: 'us-LCB' });
    const [x, y] = g.style.transform.match(/-?[\d.]+/g).map(Number);
    assert.deepEqual([x, y], [32, 30], `token at ${g.style.transform}`);
    svg.dispatchEvent(ev('pointerup', { x: 40, y: 30 }));
  });
});

test('board: the tag over the learner says YOU, or the nickname in capitals in a pill that fits it', () => {
  assert.deepEqual(youTag(), { text: 'YOU', width: 4.6 });
  assert.deepEqual(youTag('  '), { text: 'YOU', width: 4.6 });
  assert.equal(youTag('Leo').text, 'LEO');
  assert.equal(youTag('Leo').width, 4.6, 'a short name keeps the YOU pill');
  const long = youTag('Alexandrina');
  assert.equal(long.text, 'ALEXANDRINA');
  assert.ok(long.width > 4.6 && long.width < 12, `${long.width} m`);
  assert.equal(youTag('abcdefghijklmnop').text.length, 12, 'capped');
});

test('board (browser): a nickname replaces YOU over the learner, and render() can change it', async () => {
  if (isNode) return;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:0;top:0;width:630px;height:444px;opacity:0;pointer-events:none';
  document.body.appendChild(container);
  const board = createBoard(container, { orientation: 'horizontal', youLabel: 'Mia' });
  try {
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB' });
    const tag = () => board.el.querySelector('.token[data-id="us-LCB"] .token-you text').textContent;
    assert.equal(tag(), 'MIA');
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB', youLabel: 'Alexandrina' });
    assert.equal(tag(), 'ALEXANDRINA');
    const rect = board.el.querySelector('.token[data-id="us-LCB"] .token-you rect');
    assert.ok(Number(rect.getAttribute('width')) > 4.6, 'the pill grows with the name');
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB', youLabel: '' });
    assert.equal(tag(), 'YOU');
  } finally { board.destroy(); container.remove(); }
});

test('board (browser): setHeatmap with the same field object does not re-encode the image', async () => {
  if (isNode) return;
  await withBoard(async (board) => {
    const field = { x0: 20, y0: 20, step: 1, cols: 3, rows: 2, values: Float32Array.from([10, 20, 30, 40, 50, 60]) };
    board.setHeatmap(field);
    const img = board.el.querySelector('.board-heatmap');
    assert.ok(img, 'heatmap image drawn');
    const obs = new MutationObserver(() => {});
    obs.observe(board.el, { attributes: true, subtree: true });
    for (let i = 0; i < 5; i++) board.setHeatmap(field);
    assert.equal(obs.takeRecords().length, 0, 'no attribute writes for an unchanged field');
    board.setHeatmap({ ...field, values: Float32Array.from([60, 50, 40, 30, 20, 10]) });
    assert.ok(obs.takeRecords().some((r) => r.target === img && r.attributeName === 'href'), 'a new field redraws');
    obs.disconnect();
    board.setHeatmap(null);
    assert.equal(board.el.querySelector('.board-heatmap'), null);
  });
});

test('board: on a small board tokens and labels grow to a readable size (capped); a big board draws them life size', () => {
  const P = BOARD_DEFAULTS;
  assert.equal(tokenScale(10), 1, 'desktop: life size');
  assert.equal(tokenScale(0), 1, 'unmeasured');
  // A phone with a drill's focus window (about 4.85 px per metre): tokens reach minTokenPx across.
  approx(2 * P.tokenRadius * tokenScale(4.85) * 4.85, P.minTokenPx, 0.3);
  // The whole pitch on a phone (about 3.2 px per metre): as big as the cap allows, and at least 18 px across.
  const k = tokenScale(3.2);
  assert.equal(k, P.maxTokenScale);
  assert.ok(2 * P.tokenRadius * k * 3.2 >= 18, `${(2 * P.tokenRadius * k * 3.2).toFixed(1)} px`);
  assert.ok(P.grabRadius >= P.tokenRadius, 'grab at least the token');
  assert.equal(labelScale(20), 1);
  assert.ok(labelScale(3.2) > 1 && labelScale(3.2) <= P.maxLabelScale);
  approx(pxPerMetre({ width: 359, height: 380 }, viewBoxFor('vertical')), Math.min(359 / 74, 380 / 111));
  assert.equal(pxPerMetre({ width: 0, height: 0 }, viewBoxFor('vertical')), 0);
});

test('board: a phone held upright crops the pitch length to the focus; a big board always shows the whole pitch', () => {
  const pad = BOARD_DEFAULTS.focusPad;
  const phone = { width: 359, height: 380 };
  const full = viewBoxFor('vertical');
  const worldRange = (v) => [LENGTH - (v.y + v.height), LENGTH - v.y]; // vertical: view y = LENGTH - world x
  assert.deepEqual(focusViewBox('vertical', phone, null), full, 'no focus: the whole pitch');
  const own = focusViewBox('vertical', phone, { x0: 5, x1: 54 });
  assert.equal(own.width, full.width, 'the whole width stays in view');
  assert.ok(own.height < full.height, 'the length is cropped');
  approx(own.height / own.width, phone.height / phone.width, 0.01, 'the window fills the box (no letterbox)');
  let [a, b] = worldRange(own);
  assert.ok(a <= 0 && b >= 54 + pad, `play in our half keeps our goal line in view (${a}..${b})`);
  [a, b] = worldRange(focusViewBox('vertical', phone, { x0: 51, x1: 99 }));
  assert.ok(a <= 51 - pad && b >= LENGTH, `play near their goal keeps their goal line in view (${a}..${b})`);
  [a, b] = worldRange(focusViewBox('vertical', phone, { x0: 30, x1: 70 }));
  assert.ok(a <= 30 - pad && b >= 70 + pad, 'midfield play: centred on it');
  assert.deepEqual(focusViewBox('vertical', phone, { x0: 0, x1: 105 }), full, 'longer than the box allows: zooms out to the whole pitch');
  const tallPlay = focusViewBox('vertical', phone, { x0: 10, x1: 90 });
  [a, b] = worldRange(tallPlay);
  assert.ok(a <= 10 - pad && b >= 90 + pad, 'a long focus is never cut');
  assert.deepEqual(focusViewBox('horizontal', { width: 900, height: 600 }, { x0: 5, x1: 54 }), viewBoxFor('horizontal'), 'desktop');
  assert.deepEqual(focusViewBox('vertical', { width: 552, height: 740 }, { x0: 5, x1: 54 }), full, 'a narrow desktop window');
});

test('board: a forced focus crops even a board wide enough to draw the whole pitch (the pass reveal\'s zoom)', () => {
  // A phone's pass reveal widens the board 1.7×: the whole pitch would draw at ≥ focusMinPxPerM and sit centred with
  // empty space either side. setFocus(…, { force: true }) passes focusMinPxPerM: Infinity, so the length is cropped.
  const zoomed = { width: 727, height: 627 };
  const full = viewBoxFor('vertical');
  assert.ok(pxPerMetre(zoomed, full) >= BOARD_DEFAULTS.focusMinPxPerM, 'this box would normally show the whole pitch');
  assert.deepEqual(focusViewBox('vertical', zoomed, { x0: 30, x1: 60 }), full, 'unforced: whole pitch');
  const forced = focusViewBox('vertical', zoomed, { x0: 30, x1: 60 }, { ...BOARD_DEFAULTS, focusMinPxPerM: Infinity });
  assert.equal(forced.width, full.width, 'the whole width stays in view');
  approx(forced.height / forced.width, zoomed.height / zoomed.width, 0.01, 'the pitch fills the widened board (no side gaps)');
  const top = LENGTH - forced.y, bottom = LENGTH - (forced.y + forced.height);
  assert.ok(bottom <= 30 && top >= 60, `the play stays in view (${bottom}..${top})`);
});

test('board (browser): a touch drag moves the token by the finger\'s move (never the other way), with a lift capped in metres on a long drag', async () => {
  if (isNode) return;
  await withBoard(async (board) => {
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB' });
    const ends = [], moves = [];
    board.enableDrag({ ids: ['us-LCB'], onMove: (id, p) => moves.push(p), onEnd: (id, p) => ends.push(p) });
    const svg = board.el.querySelector('svg');
    const m = board.el.querySelector('.board-world').getScreenCTM();
    const pxPerM = Math.hypot(m.a, m.b);
    const at = { x: m.a * 30 + m.c * 30 + m.e, y: m.b * 30 + m.d * 30 + m.f };
    const ev = (type, dx, dy) => new PointerEvent(type, { pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: at.x + dx, clientY: at.y + dy });
    // A small corrective drag, 8 px down the screen (horizontal board: toward our right touchline, +y).
    svg.dispatchEvent(ev('pointerdown', 0, 0));
    for (let i = 1; i <= 8; i++) svg.dispatchEvent(ev('pointermove', 0, i));
    svg.dispatchEvent(ev('pointerup', 0, 8));
    const p = ends.at(-1);
    approx(p.x, 30, 0.05, 'no sideways jump');
    approx(p.y - 30, 8 / pxPerM, 0.05, `moved ${(p.y - 30).toFixed(2)} m for 8 px (${(8 / pxPerM).toFixed(2)} m)`);
    // A long drag: the token eases up above the finger, never more than touchLiftMaxM.
    const start = { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
    const ev2 = (type, dx, dy) => new PointerEvent(type, { pointerId: 10, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: start.x + dx, clientY: start.y + dy });
    svg.dispatchEvent(ev2('pointerdown', 0, 0));
    for (let i = 1; i <= 12; i++) svg.dispatchEvent(ev2('pointermove', i * 5, 0));
    await new Promise((r) => setTimeout(r, BOARD_DEFAULTS.touchLiftMs + 60));
    svg.dispatchEvent(ev2('pointermove', 61, 0));
    svg.dispatchEvent(ev2('pointerup', 61, 0));
    const q = ends.at(-1);
    approx(q.x - p.x, 61 / pxPerM, 0.05, 'follows the finger along the drag');
    const lift = p.y - q.y; // screen up is world -y on this board
    const want = Math.min(BOARD_DEFAULTS.touchOffsetPx, BOARD_DEFAULTS.touchLiftMaxM * pxPerM) / pxPerM;
    approx(lift, want, 0.05, `lifted ${lift.toFixed(2)} m above the finger (cap ${BOARD_DEFAULTS.touchLiftMaxM} m)`);
  });
});

test('board (browser): with a token armed, a tap just beside it moves it there; a tap on it disarms it', async () => {
  if (isNode) return;
  await withBoard(async (board) => {
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB' });
    const ends = [];
    board.enableDrag({ ids: ['us-LCB'], onEnd: (id, p) => ends.push(p) });
    const svg = board.el.querySelector('svg');
    const m = board.el.querySelector('.board-world').getScreenCTM();
    const toScreen = (p) => ({ clientX: m.a * p.x + m.c * p.y + m.e, clientY: m.b * p.x + m.d * p.y + m.f });
    let id = 20;
    const tap = (p, target = svg) => {
      const o = { pointerId: ++id, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, ...toScreen(p) };
      target.dispatchEvent(new PointerEvent('pointerdown', o));
      target.dispatchEvent(new PointerEvent('pointerup', o));
    };
    const token = board.el.querySelector('.token[data-id="us-LCB"]');
    tap({ x: 30, y: 30 }, token);
    assert.ok(board.el.classList.contains('is-armed'), 'a tap on the token arms it');
    // 3 m away: inside the forgiving grab radius, outside the drawn token. A touch browser may even report the
    // token as the target (touch adjustment): the distance decides.
    tap({ x: 33, y: 30 }, token);
    assert.ok(!board.el.classList.contains('is-armed'));
    assert.equal(ends.length, 1, 'moved');
    approx(ends[0].x, 33, 0.05);
    tap({ x: 33, y: 30 });
    assert.ok(board.el.classList.contains('is-armed'));
    tap({ x: 33.3, y: 30.2 });
    assert.ok(!board.el.classList.contains('is-armed'), 'a tap on the armed token disarms it');
    assert.equal(ends.length, 1, 'without moving it');
  });
});

// ---------------------------------------------------------------- Player mode extras (docs/KID_REDESIGN.md §5, §8.1)

test('board: Player mode shows unique shirt numbers (GK 1, RB 2, LB 3, LCB 4, RCB 5, DM 6, RW 7, LCM 8, ST 9, RCM 10, LW 11)', () => {
  assert.deepEqual({ ...SHIRT_NUMBERS }, { GK: 1, LCB: 4, RCB: 5, LB: 3, RB: 2, DM: 6, LCM: 8, RCM: 10, LW: 11, RW: 7, ST: 9 });
  const nums = Object.keys(SHIRT_NUMBERS).map((r) => tokenLabel(`us-${r}`, 'number'));
  assert.equal(new Set(nums).size, 11, 'one number per position');
  assert.equal(tokenLabel('them-ST', 'number'), '9', 'theirs the same numbers in their kit');
  assert.equal(tokenLabel('us-LCB', 'role'), 'LCB', 'Coach mode keeps the role codes');
  assert.equal(tokenLabel('us-DM'), '6');
  assert.equal(tokenLabel(BALL_ID, 'number'), '');
});

test('board: Player mode names tokens and spots without codes or metres', () => {
  assert.equal(simpleTokenName('us-LB', 'us-LB'), 'You');
  assert.equal(simpleTokenName('us-LCB', 'us-LB'), 'Teammate, number 4');
  assert.equal(simpleTokenName('them-ST', 'us-LB'), 'Opponent, number 9');
  assert.equal(simpleTokenName(BALL_ID, 'us-LB'), 'Ball');
  assert.equal(describeSpotSimple({ x: 30, y: 10 }), 'in our half, on the left');
  assert.equal(describeSpotSimple({ x: 95, y: 34 }), 'near their goal, in the middle');
  assert.equal(describeSpotSimple({ x: 8, y: 60 }), 'near our goal, on the right');
  assert.equal(describeSpotSimple({ x: 60, y: 50 }), 'in their half, on the right');
  assert.equal(describeSpotSimple(null), '');
  for (const p of [{ x: 12, y: 3 }, { x: 70, y: 40 }]) assert.doesNotMatch(describeSpotSimple(p), /\d|metre|half-space|third/);
});

test('board: every token you can drag or tap is at least 44 CSS px across to hit, however small it is drawn', () => {
  assert.equal(BOARD_DEFAULTS.minHitPx, 44);
  for (const pxm of [2.5, 3.2, 4.85, 6, 12]) {
    const r = hitRadius(pxm, (BOARD_DEFAULTS.tokenRadius + 0.5) * tokenScale(pxm));
    assert.ok(2 * r * pxm >= 44 - 1e-9, `${pxm} px/m: ${(2 * r * pxm).toFixed(1)} px`);
  }
  assert.equal(hitRadius(0, 2.3), 2.3, 'unmeasured: the drawn token');
  assert.equal(hitRadius(20, 2.3), 2.3, 'a big board: the drawn token is bigger already');
});

test('board: the glow aid warms and brightens as YOU nears its target', () => {
  assert.deepEqual([0, 2, 4, 8, 20].map((d) => aidLevel(d)), ['hot', 'hot', 'warm', 'cool', 'cold']);
  assert.equal(aidLevel(NaN), 'cold');
  const ks = [0, 3, 6, 9, 12, 15, 30].map((d) => aidStrength(d));
  assert.equal(ks[0], 1);
  assert.equal(ks.at(-1), 0);
  assert.ok(ks.every((k, i) => i === 0 || k <= ks[i - 1]), 'never brighter further away');
});

test('board: a glow told its level by the screen (Player mode\'s right area) shows that level; without one, the distance', () => {
  assert.deepEqual([...AID_LEVELS], [...KID_LEVELS], 'the levels for 0-3 stars are the engine\'s');
  const target = { x: 50, y: 30 };
  // No levelAt: metres to the target, as before.
  for (const d of [0, 2, 4, 8, 20]) assert.deepEqual(glowAt({ x: 50 + d, y: 30 }, { target }), { level: aidLevel(d), k: aidStrength(d) });
  // levelAt: its level at YOUR spot, at that level's brightness, whatever the distance (hot anywhere in the green).
  const inGreen = (p) => (Math.abs(p.x - 50) <= 4 ? 'hot' : Math.abs(p.x - 50) <= 6 ? 'warm' : 'cold');
  assert.deepEqual(glowAt({ x: 54, y: 30 }, { target, levelAt: inGreen }), { level: 'hot', k: BOARD_DEFAULTS.aidLevelK.hot });
  assert.deepEqual(glowAt({ x: 55.5, y: 30 }, { target, levelAt: inGreen }), { level: 'warm', k: BOARD_DEFAULTS.aidLevelK.warm });
  assert.deepEqual(glowAt({ x: 50, y: 30 }, { target, levelAt: () => 'cold' }), { level: 'cold', k: BOARD_DEFAULTS.aidLevelK.cold }, 'the start: cold on the ring too');
  const ks = AID_LEVELS.map((l) => BOARD_DEFAULTS.aidLevelK[l]);
  assert.ok(ks.every((k, i) => i === 0 || k > ks[i - 1]), 'hotter is brighter');
  // A levelAt that throws or says something else: the distance.
  assert.deepEqual(glowAt({ x: 52, y: 30 }, { target, levelAt: () => { throw new Error('x'); } }), { level: aidLevel(2), k: aidStrength(2) });
  assert.deepEqual(glowAt({ x: 52, y: 30 }, { target, levelAt: () => 'lava' }), { level: aidLevel(2), k: aidStrength(2) });
});

test('board: a zone marker (Player mode\'s right area) is a polygon on the grass, under the aid ring, the markers and the figures', () => {
  assert.equal(zonePoints([{ x: 1, y: 2 }, { x: 3.12345, y: 4 }, { x: 5, y: 6 }]), '1,2 3.123,4 5,6');
  assert.equal(zonePoints([{ x: 1, y: 2 }, { x: NaN, y: 4 }, { x: 5, y: 6 }]), '', 'fewer than 3 real points: nothing');
  assert.equal(zonePoints(null), '');
  const { container } = fakeDom();
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    board.render(scene(), { learnerId: LEARNER });
    const zone = [{ x: 20, y: 60 }, { x: 26, y: 60 }, { x: 26, y: 66 }, { x: 20, y: 66 }];
    board.setMarkers([{ type: 'zone', points: zone, tone: 'good' }, { type: 'arrow', from: { x: 10, y: 50 }, to: { x: 21, y: 61 }, tone: 'fix' }]);
    const world = board.el.querySelector('g.board-world');
    const layer = board.el.querySelector('g.board-zones');
    const poly = layer.querySelectorAll('polygon');
    assert.equal(poly.length, 1, 'one green');
    assert.ok(poly[0].classList.contains('mk-zone') && poly[0].classList.contains('tone-good'));
    assert.equal(poly[0].getAttribute('points'), '20,60 26,60 26,66 20,66');
    const at = (sel) => world.children.indexOf(board.el.querySelector(sel));
    assert.ok(at('g.board-zones') >= 0 && at('g.board-zones') < at('g.board-aid-layer') && at('g.board-aid-layer') < at('g.board-markers'), 'the green under the aid ring and every other marker');
    assert.equal(board.el.querySelector('g.board-markers').querySelectorAll('polygon.mk-zone').length, 0, 'not among the other markers');
    assert.ok(!world.children.includes(board.el.querySelector('g.board-tokens')), 'the figures are drawn over the world');
    board.setMarkers([]);
    assert.equal(layer.querySelectorAll('polygon').length, 0, 'setMarkers clears the green with the rest');
    board.setMarkers([{ type: 'zone', points: zone.slice(0, 2) }]);
    assert.equal(layer.querySelectorAll('polygon').length, 0, 'no area: nothing drawn');
    // The glow ring on YOU follows the screen's level (levelAt), re-asked at every render.
    let level = 'cold';
    board.setAid({ kind: 'glow', target: { x: 23, y: 63 }, levelAt: () => level });
    const ring = board.el.querySelector('circle.board-aid');
    assert.ok(ring.classList.contains('aid-cold'));
    level = 'hot';
    board.render(moved(0.5), { learnerId: LEARNER });
    assert.ok(ring.classList.contains('aid-hot'), 'hot where the screen says');
    board.setAid(null);
    assert.equal(ring.getAttribute('display'), 'none');
  } finally { board.destroy(); }
});

test('board: the worked-example hand drags YOU to the best spot, holds, and YOU snaps back', () => {
  const from = { x: 20, y: 30 }, to = { x: 26, y: 38 };
  const H = BOARD_DEFAULTS.hint;
  const at = (ms) => hintPose(ms, from, to, H);
  assert.deepEqual(at(0).token, from);
  assert.ok(at(H.inMs * 0.9).pressed, 'it presses before the drag');
  const mid = at(H.inMs + H.dragMs / 2);
  assert.ok(mid.token.x > from.x && mid.token.x < to.x, 'dragging');
  assert.deepEqual(mid.hand, mid.token, 'the hand carries YOU');
  const hold = at(H.inMs + H.dragMs + H.holdMs / 2);
  assert.deepEqual(hold.token, to);
  const end = at(hintTotalMs(H));
  assert.deepEqual(end.token, from, 'YOU snaps back');
  assert.equal(end.done, true);
  assert.equal(end.opacity, 0);
  assert.equal(at(hintTotalMs(H) - 1).done, false);
});

test('board (browser): Player-mode labels, the spotlight and the aid ring', async () => {
  if (isNode) return;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:0;top:0;width:630px;height:444px;opacity:0;pointer-events:none';
  document.body.appendChild(container);
  const board = createBoard(container, { orientation: 'horizontal', labels: 'number' });
  try {
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB' });
    const text = (id) => board.el.querySelector(`.token[data-id="${id}"] .token-code`).textContent;
    assert.equal(text('us-LCB'), '4');
    assert.equal(text('them-ST'), '9');
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB', youNumber: 10 });
    assert.equal(text('us-LCB'), '10', 'your own kit number');
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB', labels: 'role' });
    assert.equal(text('them-ST'), '9', 'role codes on request (the #9 reads 9 either way)');
    assert.equal(text('us-LCB'), 'LCB');
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB', labels: 'number' });
    board.setSpotlight(['them-ST']);
    const unlit = (id) => board.el.querySelector(`.token[data-id="${id}"]`).classList.contains('is-unlit');
    assert.equal(unlit('them-ST'), false);
    assert.equal(unlit('us-LCB'), false, 'YOU are always lit');
    assert.equal(unlit(BALL_ID), false, 'the ball too');
    board.setSpotlight([]);
    assert.equal(unlit('them-ST'), true);
    board.setSpotlight(null);
    assert.equal(unlit('them-ST'), false, 'null: everyone lit');
    board.setAid({ kind: 'glow', target: { x: 50, y: 30 } });
    const ring = board.el.querySelector('.board-aid');
    assert.ok(ring.classList.contains('aid-cold'), '20 m away: cold');
    board.render(frameWith({ x: 49, y: 30 }), { learnerId: 'us-LCB' });
    assert.ok(ring.classList.contains('aid-hot'), '1 m away: hot');
    board.setAid({ kind: 'heat', level: 'warm' });
    assert.ok(ring.classList.contains('aid-warm'));
    board.setAid(null);
    assert.equal(ring.getAttribute('display'), 'none');
  } finally { board.destroy(); container.remove(); }
});

test('board (browser): targets: the first tap previews, a second tap on the same one confirms', async () => {
  if (isNode) return;
  await withBoard(async (board) => {
    const frame = { ...frameWith({ x: 30, y: 30 }), players: [...frameWith({ x: 30, y: 30 }).players, { id: 'us-DM', team: 'us', role: 'DM', x: 45, y: 20 }] };
    board.render(frame, { learnerId: 'us-LCB' });
    const previews = [], taps = [];
    board.enableTargets({ ids: ['us-DM'], onPreview: (id) => previews.push(id), onTap: (id) => taps.push(id) });
    const svg = board.el.querySelector('svg');
    const m = board.el.querySelector('.board-world').getScreenCTM();
    const toScreen = (p) => ({ clientX: m.a * p.x + m.c * p.y + m.e, clientY: m.b * p.x + m.d * p.y + m.f });
    let id = 40;
    const tap = (p) => {
      const o = { pointerId: ++id, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, ...toScreen(p) };
      svg.dispatchEvent(new PointerEvent('pointerdown', o));
      svg.dispatchEvent(new PointerEvent('pointerup', o));
    };
    const target = board.el.querySelector('.board-target[data-id="us-DM"]');
    assert.ok(target, 'a target on the teammate');
    const r = Number(target.querySelector('.target-hit').getAttribute('r')) * board.tokenScale * board.pxPerMetre;
    assert.ok(2 * r >= 44 - 0.5, `${(2 * r).toFixed(1)} px across`);
    tap({ x: 46, y: 20.5 });
    assert.deepEqual(previews, ['us-DM'], 'first tap: preview');
    assert.equal(target.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(taps, []);
    tap({ x: 45, y: 20 });
    assert.deepEqual(taps, ['us-DM'], 'second tap: confirm');
    tap({ x: 80, y: 60 });
    assert.deepEqual(previews, ['us-DM', null], 'a tap elsewhere clears the preview');
    board.disableTargets();
    assert.equal(board.el.querySelector('.board-target'), null);
  });
});

test('board (browser): tap-to-move: a tap on the pitch moves YOU there; a tap on YOU still arms it', async () => {
  if (isNode) return;
  await withBoard(async (board) => {
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB' });
    const ends = [], arms = [];
    board.enableDrag({ ids: ['us-LCB'], tapToMove: 'us-LCB', onEnd: (id, p) => ends.push(p), onArm: (id) => arms.push(id) });
    const svg = board.el.querySelector('svg');
    const m = board.el.querySelector('.board-world').getScreenCTM();
    const toScreen = (p) => ({ clientX: m.a * p.x + m.c * p.y + m.e, clientY: m.b * p.x + m.d * p.y + m.f });
    let id = 60;
    const tap = (p) => {
      const o = { pointerId: ++id, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, ...toScreen(p) };
      svg.dispatchEvent(new PointerEvent('pointerdown', o));
      svg.dispatchEvent(new PointerEvent('pointerup', o));
    };
    tap({ x: 50, y: 40 });
    assert.equal(ends.length, 1, 'moved straight there');
    approx(ends[0].x, 50, 0.05);
    board.render(frameWith(ends[0]), { learnerId: 'us-LCB' }); // the mode writes the spot back (the board is controlled)
    tap({ x: 30, y: 30 });
    assert.equal(ends.length, 2, 'the old spot is just a spot now: YOU goes back there');
    approx(ends[1].y, 30, 0.05);
    board.render(frameWith(ends[1]), { learnerId: 'us-LCB' });
    tap(ends[1]);
    assert.equal(ends.length, 2, 'a tap on YOU does not move it...');
    assert.ok(board.el.classList.contains('is-armed'), '...it arms it');
    assert.deepEqual(arms.at(-1), 'us-LCB');
    tap({ x: 20, y: 20 });
    assert.equal(ends.length, 3, 'then a tap on a spot moves it there');
    approx(ends[2].y, 20, 0.05);
    assert.equal(arms.at(-1), null, 'and disarms it');
    board.render(frameWith(ends[2]), { learnerId: 'us-LCB' });
    // Horizontal board: straight up the screen is toward our left touchline (world -y).
    const tagAt = { x: ends[2].x, y: ends[2].y - (BOARD_DEFAULTS.tokenRadius + 2.2) * board.tokenScale };
    tap(tagAt);
    assert.equal(ends.length, 4, 'a tap on the YOU tag is a step that way: YOU moves there...');
    approx(ends[3].y, tagAt.y, 0.05);
    assert.ok(!board.el.classList.contains('is-armed'), '...it never picks YOU up');
    board.render(frameWith(ends[3]), { learnerId: 'us-LCB' });
    // Just off the drawn token (inside the 44 px grab area, which still starts a drag): a tap moves YOU there too.
    const off = (BOARD_DEFAULTS.tokenRadius + 0.5) * board.tokenScale + 0.4;
    tap({ x: ends[3].x + off, y: ends[3].y });
    assert.equal(ends.length, 5, 'a tap beside YOU moves YOU');
    assert.ok(!board.el.classList.contains('is-armed'));
  });
});

test('board: a tap picks YOU up only on the token itself when tap-to-move is on; anywhere else it moves YOU there', () => {
  const on = (ids) => (id) => ids.includes(id);
  // Player mode (tap-to-move): the tag or the grab area round YOU pressed, but not the token: a move, not a pick-up.
  assert.deepEqual(tapAction({ pressed: 'us-LB', tapToMove: 'us-LB', onBody: on([]) }), { kind: 'move', id: 'us-LB' });
  assert.deepEqual(tapAction({ pressed: 'us-LB', tapToMove: 'us-LB', onBody: on(['us-LB']) }), { kind: 'arm', id: 'us-LB' });
  assert.deepEqual(tapAction({ pressed: null, tapToMove: 'us-LB' }), { kind: 'move', id: 'us-LB' }, 'a tap on the pitch');
  // Armed: a tap on YOU puts it down, anywhere else (the tag too) moves it there.
  assert.deepEqual(tapAction({ armed: 'us-LB', pressed: 'us-LB', tapToMove: 'us-LB', onBody: on(['us-LB']) }), { kind: 'disarm', id: 'us-LB' });
  assert.deepEqual(tapAction({ armed: 'us-LB', pressed: 'us-LB', tapToMove: 'us-LB', onBody: on([]) }), { kind: 'move', id: 'us-LB' });
  // Coach mode (no tap-to-move): a tap near a token arms it, as before; another token's body arms that one.
  assert.deepEqual(tapAction({ pressed: 'us-LB', onBody: on([]) }), { kind: 'arm', id: 'us-LB' });
  assert.deepEqual(tapAction({ pressed: null }), { kind: 'none' });
  assert.deepEqual(tapAction({ armed: 'us-LB', pressed: BALL_ID, onBody: on([BALL_ID]) }), { kind: 'arm', id: BALL_ID });
  assert.deepEqual(tapAction({ armed: 'us-LB', pressed: null, onBody: on([]) }), { kind: 'move', id: 'us-LB' });
});

test('board: YOUR kit number is swapped with the teammate who wore it, so no two players share a number', () => {
  // A left back who picks 7: YOU are 7, and our right winger (7) wears 3.
  const you = { learnerId: 'us-LB', youNumber: 7 };
  assert.equal(shirtNumberOf('us-LB', you), 7);
  assert.equal(shirtNumberOf('us-RW', you), 3);
  assert.equal(shirtNumberOf('them-RW', you), 7, 'their team keeps its numbers');
  assert.equal(shirtNumberOf('us-ST', you), 9);
  const ours = ['GK', 'LB', 'LCB', 'RCB', 'RB', 'DM', 'LCM', 'RCM', 'LW', 'RW', 'ST'].map((r) => tokenLabel(`us-${r}`, 'number', you));
  assert.equal(new Set(ours).size, 11, `unique: ${ours.join(' ')}`);
  assert.equal(simpleTokenName('us-RW', 'us-LB', 7), 'Teammate, number 3', 'a screen reader hears the number on the shirt');
  // Your own number, a number nobody wears, or none: nothing to swap.
  assert.equal(shirtNumberOf('us-RW', { learnerId: 'us-LB', youNumber: 3 }), 7);
  assert.equal(shirtNumberOf('us-RW', { learnerId: 'us-LB', youNumber: 23 }), 7);
  assert.equal(shirtNumberOf('us-RW', { learnerId: 'us-LB' }), 7);
  assert.equal(shirtNumberOf(BALL_ID, you), null);
  assert.equal(tokenLabel('us-RW', 'number'), '7');
});

test('board: in Player mode pitch labels are 16 px and YOUR tag 14 px or more on a phone; Coach mode keeps its sizes', () => {
  const P = BOARD_DEFAULTS;
  const LP = playerLabelParams();
  // A 390 px phone held upright: the pitch's width (plus margins) across about 374 px, and the whole pitch (Match day).
  const phone = pxPerMetre({ width: 374, height: 600 }, focusViewBox('vertical', { width: 374, height: 600 }, { x0: 10, x1: 60 }));
  const whole = pxPerMetre({ width: 374, height: 420 }, viewBoxFor('vertical'));
  for (const pxm of [phone, whole, 3.2]) {
    const label = 1.5 * labelScale(pxm, LP) * pxm;
    assert.ok(label >= P.playerLabelPx - 0.2, `${pxm.toFixed(2)} px/m: a label ${label.toFixed(1)} px tall`);
    const k = tokenScale(pxm);
    const tag = 1.15 * tagScale(pxm, k, { player: true }) * k * pxm;
    assert.ok(tag >= P.playerTagPx - 0.2, `${pxm.toFixed(2)} px/m: the tag ${tag.toFixed(1)} px tall`);
  }
  assert.ok(P.playerLabelPx >= 16 && P.playerTagPx >= 14);
  assert.equal(tagScale(phone, tokenScale(phone)), 1, 'Coach mode: the tag as drawn before');
  assert.equal(labelScale(phone), labelScale(phone, P), 'Coach mode: the labels as before');
  assert.equal(tagScale(40, 1, { player: true }), 1, 'a big board needs no help');
});

test('board (browser): the hint hand resolves (at once under reduced motion) and leaves YOU where you are', async () => {
  if (isNode) return;
  await withBoard(async (board) => {
    board.render(frameWith({ x: 30, y: 30 }), { learnerId: 'us-LCB' });
    const token = board.el.querySelector('.token[data-id="us-LCB"]');
    const before = token.style.transform;
    const t0 = performance.now();
    await Promise.race([board.showHintHand({ from: { x: 30, y: 30 }, to: { x: 40, y: 34 } }), new Promise((r) => setTimeout(r, hintTotalMs() + 2500))]);
    assert.ok(performance.now() - t0 < hintTotalMs() + 2000, 'resolved');
    assert.equal(board.el.querySelector('.board-hand'), null, 'the hand is gone');
    assert.equal(token.style.transform, before, 'YOU back on the real spot');
    await board.showHintHand({ from: null, to: { x: 1, y: 1 } }); // bad input: resolves at once
  });
});

test('board (browser): a label written with clear: "you" never covers YOU or YOUR name tag', async () => {
  if (isNode) return;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:0;top:0;width:360px;height:560px;opacity:0;pointer-events:none';
  document.body.appendChild(container);
  const board = createBoard(container, { orientation: 'vertical', labels: 'number' });
  try {
    const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const ring = { x: 40, y: 20 };
    // YOU a little behind the ring and to one side (on screen: below it, to the right), where the words above the
    // ring used to sit on YOUR name tag; then level with it, then in front of it.
    for (const spot of [{ x: 36.5, y: 27 }, { x: 40, y: 28 }, { x: 45, y: 22 }, { x: 33, y: 17 }]) {
      board.render(frameWith(spot), { learnerId: 'us-LCB' });
      board.setMarkers([{ type: 'label', at: ring, text: 'Best spot', tone: 'good', lift: 'token', clear: 'you' }]);
      const label = board.el.querySelector('.mk-label').getBoundingClientRect();
      const body = board.el.querySelector('.token.is-learner .token-body').getBoundingClientRect();
      const tagBox = board.el.querySelector('.token.is-learner .token-you rect').getBoundingClientRect();
      assert.ok(label.width > 0, 'drawn');
      assert.ok(!hit(label, body), `YOU at (${spot.x}, ${spot.y}): the label is off YOU`);
      assert.ok(!hit(label, tagBox), `YOU at (${spot.x}, ${spot.y}): the label is off YOUR tag`);
    }
  } finally { board.destroy(); container.remove(); }
});

// ---------------------------------------------------------------- figures, the ball and the camera (PROGRESSIVE_FIELD §4)

/** The CSS px a 375 px phone's board can draw at: the whole pitch or the Player screens' length crop (full stage), for
 *  boards 420 to 700 px tall (the board fills the width, less nothing). */
const PHONE_BOXES = [420, 520, 600, 700].map((h) => ({ width: 375, height: h }));
const fullStagePxm = (box) => pxPerMetre(box, focusViewBox('vertical', box, { x0: 20, x1: 70 }));

test('board: figures are big enough to read a two-digit shirt number at full stage on a phone, and capped when zoomed', () => {
  const P = BOARD_DEFAULTS;
  for (const box of PHONE_BOXES) {
    const pxm = fullStagePxm(box);
    const k = figureScale(pxm);
    const numberPx = numberFontSize('10') * P.tokenRadius * k * pxm;
    assert.ok(numberPx >= P.figureNumberPx - 1e-9, `${box.height} px tall board (${pxm.toFixed(2)} px/m): the number ${numberPx.toFixed(1)} px`);
    assert.ok(P.figureNumberPx >= 11, 'readable: 11 px or more (PROGRESSIVE_FIELD §6)');
  }
  let prev = 0;
  for (const pxm of [3.2, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 45]) {
    const k = figureScale(pxm);
    const tall = FIGURE.height * P.tokenRadius * k * pxm;
    assert.ok(k <= P.figureMaxScale, `${pxm}: at most ${P.figureMaxScale}x`);
    assert.ok(tall <= P.figureMaxPx + 0.5, `${pxm} px/m: ${tall.toFixed(0)} px tall, never blown up`);
    assert.ok(tall >= prev - 1, `${pxm} px/m: zooming in never shrinks a figure (${tall.toFixed(0)} px)`);
    prev = tall;
  }
  assert.equal(figureScale(0), 1, 'unmeasured');
  assert.ok(FIGURE.height * P.tokenRadius * figureScale(15) * 15 > 60, 'a small-sided game zoomed in: big figures');
});

test('board: the ball is at least 18 px across on a 375 px phone at every stage, and bigger when zoomed in', () => {
  const P = BOARD_DEFAULTS;
  assert.ok(P.ballMinPx >= 18, 'PROGRESSIVE_FIELD §4: at least 18 CSS px');
  for (const box of PHONE_BOXES) {
    const full = fullStagePxm(box);
    const whole = pxPerMetre(box, viewBoxFor('vertical'));
    // Small and medium stages: the camera on a cast (a tight 3 v 2, a 6 v 5 over half the width, most of the pitch).
    const casts = [{ x0: 40, x1: 44, y0: 30, y1: 33 }, { x0: 30, x1: 52, y0: 20, y1: 45 }, { x0: 20, x1: 70, y0: 8, y1: 60 }];
    const zoomed = casts.map((r) => pxPerMetre(box, cameraViewBox('vertical', box, r)));
    for (const pxm of [whole, full, ...zoomed]) {
      assert.ok(ballPx(pxm) >= 18, `${box.height} px board at ${pxm.toFixed(2)} px/m: the ball ${ballPx(pxm).toFixed(1)} px`);
      assert.ok(ballPx(pxm) <= P.ballMaxPx + 0.5);
    }
    assert.ok(ballPx(zoomed[0]) > ballPx(full), `zoomed in the ball grows (${ballPx(full).toFixed(1)} → ${ballPx(zoomed[0]).toFixed(1)} px)`);
  }
  assert.equal(ballScale(0), 1);
  assert.equal(ballPx(0), 0);
});

test('board: Coach mode (discs, no camera) keeps its sizes; figures or a camera cap discs, labels and YOUR tag in px', () => {
  for (const pxm of [2.5, 3.2, 4.85, 8, 10.8, 20, 40]) {
    const s = boardScales(pxm);
    assert.equal(s.k, tokenScale(pxm), `${pxm}: discs as before`);
    assert.equal(s.kl, labelScale(pxm), `${pxm}: labels as before`);
    assert.equal(s.kt, 1, `${pxm}: the tag as before`);
    assert.equal(s.kb, ballScale(pxm), `${pxm}: the ball is the easy-to-see ball on every board (at least ${BOARD_DEFAULTS.ballMinPx} px), Coach mode's discs too`);
    assert.ok(ballPx(pxm) >= 18, `${pxm}: the Coach-mode ball ${ballPx(pxm).toFixed(1)} px across`);
    assert.equal(s.kf, s.k);
    const pl = boardScales(pxm, { player: true });
    assert.equal(pl.kl, labelScale(pxm, playerLabelParams()), 'Player-mode discs keep their label sizes');
    assert.equal(pl.kt, tagScale(pxm, tokenScale(pxm), { player: true }));
  }
  const P = BOARD_DEFAULTS;
  for (const pxm of [20, 24, 40]) {
    const cam = boardScales(pxm, { camera: true, player: true });
    assert.ok(2 * P.tokenRadius * cam.k * pxm <= P.maxTokenPx + 0.5, `${pxm}: a disc under the camera at most ${P.maxTokenPx} px`);
    assert.ok(1.5 * cam.kl * pxm <= P.maxLabelPx + 0.5, `${pxm}: labels at most ${P.maxLabelPx} px`);
    const fig = boardScales(pxm, { figures: true, player: true });
    assert.equal(fig.kf, figureScale(pxm), 'the figure');
    assert.equal(fig.k, baseScale(cam.k, fig.kf), 'its base: a disc (capped like a disc under the camera), in proportion to the figure');
    assert.ok(fig.k <= cam.k, 'never bigger than the disc it replaces there');
    assert.equal(fig.kb, ballScale(pxm), 'the ball: its own size');
    assert.ok(1.15 * fig.k * fig.kt * pxm <= P.maxTagPx + 0.5, `${pxm}: YOUR tag at most ${P.maxTagPx} px`);
  }
  // Player-mode figures on a phone keep the minimums: labels 16 px, YOUR tag 14 px.
  const pxm = fullStagePxm({ width: 375, height: 600 });
  const s = boardScales(pxm, { figures: true, player: true });
  assert.ok(1.5 * s.kl * pxm >= P.playerLabelPx - 0.2 && 1.15 * s.k * s.kt * pxm >= P.playerTagPx - 0.2);
});

test('board: the camera fits the rect on both axes, keeps the board\'s aspect, stays on the pitch and never shows less than CAMERA_MIN', () => {
  const P = BOARD_DEFAULTS;
  assert.deepEqual({ ...CAMERA_MIN }, { length: 24, width: 16 });
  const inside = (vb, v) => v.x >= vb.x - 1e-6 && v.x <= vb.x + vb.width + 1e-6 && v.y >= vb.y - 1e-6 && v.y <= vb.y + vb.height + 1e-6;
  const cases = [
    ['vertical', { width: 375, height: 600 }], ['vertical', { width: 359, height: 420 }],
    ['horizontal', { width: 900, height: 560 }], ['horizontal', { width: 1280, height: 700 }],
  ];
  const rects = [{ x0: 40, x1: 58, y0: 30, y1: 45 }, { x0: 10, x1: 30, y0: 2, y1: 20 }, { x0: 88, x1: 104, y0: 50, y1: 66 }, { x0: 30, x1: 75, y0: 5, y1: 63 }];
  for (const [o, box] of cases) {
    const full = viewBoxFor(o);
    for (const rect of rects) {
      const vb = cameraViewBox(o, box, rect);
      const tag = `${o} ${box.width}x${box.height} ${JSON.stringify(rect)}`;
      // The rect (and its padding across the screen) is in view: nobody in the cast is cut.
      for (const c of [{ x: rect.x0, y: rect.y0 }, { x: rect.x1, y: rect.y1 }, { x: rect.x0, y: rect.y1 }, { x: rect.x1, y: rect.y0 }]) {
        assert.ok(inside(vb, project(c, o)), `${tag}: corner ${c.x},${c.y} in view`);
      }
      // On the pitch plus its margin (up the screen, where figures stand, up to the headroom past it).
      assert.ok(vb.x >= full.x - 1e-6 && vb.y >= full.y - P.cameraHeadroom - 1e-6 && vb.x + vb.width <= full.x + full.width + 0.02 && vb.y + vb.height <= full.y + full.height + 0.02, `${tag}: on the pitch`);
      // The board's aspect (fills it on both axes), unless the pitch itself is the limit.
      if (vb.width < full.width - 0.02 && vb.height < full.height - 0.02) approx(vb.width / vb.height, box.width / box.height, 0.01, `${tag}: aspect`);
      // Never closer than cameraMaxPxPerM.
      assert.ok(pxPerMetre(box, vb) <= P.cameraMaxPxPerM + 0.05, `${tag}: ${pxPerMetre(box, vb).toFixed(1)} px/m`);
    }
    // A tiny rect: at least CAMERA_MIN, along the pitch and across it.
    const tiny = cameraViewBox(o, box, { x0: 50, x1: 51, y0: 30, y1: 31 });
    const [along, across] = o === 'vertical' ? [tiny.height, tiny.width] : [tiny.width, tiny.height];
    assert.ok(along >= CAMERA_MIN.length - 0.01 && across >= CAMERA_MIN.width - 0.01, `${o}: ${along} x ${across} m`);
    // The whole pitch, or no rect: the whole pitch.
    assert.deepEqual(cameraViewBox(o, box, null), full);
    const all = cameraViewBox(o, box, { x0: 0, x1: LENGTH, y0: 0, y1: WIDTH });
    assert.ok(all.width >= full.width - 0.02 || all.height >= full.height - 0.02, `${o}: the whole pitch fills one axis`);
  }
  // A corner of the pitch: slid inside across the screen; up it (their goal is at the top of a phone held upright) the
  // window reaches past the margin by the headroom, so a figure at the goal line keeps its head and YOUR tag in view.
  const corner = cameraViewBox('vertical', { width: 375, height: 600 }, { x0: 100, x1: 104, y0: 1, y1: 3 });
  assert.equal(corner.x, -P.margin);
  assert.equal(corner.y, -P.margin - P.cameraHeadroom);
  assert.ok(project({ x: 104, y: 2 }, 'vertical').y - corner.y >= P.cameraPad + P.cameraHeadroom - 1e-6, 'the headroom over the goal line');
  const side = cameraViewBox('horizontal', { width: 900, height: 560 }, { x0: 40, x1: 60, y0: 0.5, y1: 10 });
  assert.ok(0.5 - side.y >= P.cameraPad + P.cameraHeadroom - 1e-6, `sideways, our left touchline at the top: the headroom (${side.y})`);
  // The top of the screen keeps room for the figures standing up it (and YOUR tag).
  const vb = cameraViewBox('vertical', { width: 375, height: 600 }, { x0: 40, x1: 60, y0: 20, y1: 40 });
  assert.ok(project({ x: 60, y: 30 }, 'vertical').y - vb.y >= P.cameraHeadroom, 'headroom over the furthest player');
  assert.deepEqual(cameraViewBox('vertical', { width: 0, height: 0 }, { x0: 1, x1: 2, y0: 1, y1: 2 }), viewBoxFor('vertical'), 'unmeasured');
});

test('board: figures face the ball (a dead zone keeps them steady); a carrier faces the goal it plays toward', () => {
  const me = { x: 50, y: 30 };
  assert.equal(facingToward(me, { x: 60, y: 30 }, 'horizontal'), 1, 'ball to the right');
  assert.equal(facingToward(me, { x: 40, y: 30 }, 'horizontal'), -1);
  assert.equal(facingToward(me, { x: 50.3, y: 40 }, 'horizontal', -1), -1, 'straight below on the screen: keeps its way');
  // Vertical: the screen's x is the world's y (our left on the left).
  assert.equal(facingToward(me, { x: 50, y: 40 }, 'vertical'), 1, 'toward our right touchline: right on a phone');
  assert.equal(facingToward(me, { x: 90, y: 30.2 }, 'vertical', -1), -1, 'straight up the screen: keeps its way');
  assert.equal(facingToward(me, null, 'vertical', -1), -1);
  // A carrier (slope): on a phone held upright its goal is up or down the screen, so crossing the middle never turns it;
  // only a goal well off to the side (more than 45° from straight up or down) does.
  const slope = BOARD_DEFAULTS.carrierFacingSlope;
  assert.equal(slope, 1);
  const goal = carrierTarget('us');
  for (const y of [26, 33.5, 34.5, 42]) {
    for (const prev of [1, -1]) assert.equal(facingToward({ x: 50, y }, goal, 'vertical', prev, BOARD_DEFAULTS, slope), prev, `y ${y}: keeps ${prev}`);
  }
  assert.equal(facingToward({ x: 95, y: 2 }, goal, 'vertical', -1, BOARD_DEFAULTS, slope), 1, 'wide near their goal: turns in toward it');
  assert.equal(facingToward({ x: 50, y: 30 }, goal, 'horizontal', -1, BOARD_DEFAULTS, slope), 1, 'across a wide board the goal is to the side: faces it');
  assert.equal(facingToward({ x: 50, y: 33 }, goal, 'vertical', -1), 1, 'without the slope (a new scene): the goal\'s side');
  assert.deepEqual(carrierTarget('us'), { x: LENGTH, y: MID_Y });
  assert.deepEqual(carrierTarget('them'), { x: 0, y: MID_Y });
  assert.deepEqual(carrierTarget('us', 'backward'), { x: 0, y: MID_Y }, 'facing back: its own goal');
});

test('board: a carried ball sits beside the carrier\'s boots on the side it faces, and fades to where it is as it leaves', () => {
  const P = BOARD_DEFAULTS;
  const feet = { x: 50, y: 30 };
  for (const o of ORIENTS) {
    const v = project(feet, o);
    for (const facing of [1, -1]) {
      const k = 2, kb = 2.5;
      const b = project(carriedBallAt(feet, facing, o, { k, kb }), o);
      assert.ok((b.x - v.x) * facing > 0, `${o} facing ${facing}: on that side`);
      assert.ok(Math.abs(b.x - v.x) >= FIGURE.halfWidth * 0.5 * P.tokenRadius * k, 'beside the boots, not on them');
      assert.ok(b.y >= v.y, 'at the feet (never up on the figure)');
      approx(Math.hypot(b.x - v.x, b.y - v.y), carryReach({ k, kb }), 1e-9, 'carryReach: a full carry offset');
    }
  }
  // At the feet (the scene puts a carrier 0.8 m behind the ball): all of it; fading out by carryDist; continuous.
  assert.equal(carryWeight(0), 1);
  assert.equal(carryWeight(0.8), 1);
  assert.equal(carryWeight(P.carryNear), 1);
  assert.equal(carryWeight(P.carryDist), 0);
  assert.equal(carryWeight(30), 0);
  assert.equal(carryWeight(NaN), 0);
  approx(carryWeight((P.carryNear + P.carryDist) / 2), 0.5, 1e-9);
  for (let d = 0; d < 4; d += 0.01) assert.ok(Math.abs(carryWeight(d + 0.01) - carryWeight(d)) <= 0.01 / (P.carryDist - P.carryNear) + 1e-9, `continuous at ${d.toFixed(2)} m`);
  // The drawn offset slides: at most `max` a step, and lands exactly.
  const half = stepToward({ x: 0, y: 0 }, { x: 3, y: 4 }, 1);
  approx(half.x, 0.6, 1e-9);
  approx(half.y, 0.8, 1e-9);
  assert.deepEqual(stepToward({ x: 0, y: 0 }, { x: 3, y: 4 }, 5), { x: 3, y: 4 });
  assert.deepEqual(stepToward({ x: 1, y: 1 }, { x: 3, y: 4 }, 0), { x: 1, y: 1 });
});

test('board: a figure runs only while it moves between renders; reduced motion keeps everyone still', () => {
  assert.equal(isRunning(0, 16), false, 'standing');
  assert.equal(isRunning(0.01, 16), false, 'render noise');
  assert.equal(isRunning(0.1, 16), true, '6 m/s');
  assert.equal(isRunning(0.015 * 16 / 16, 100), false, 'a slow shuffle');
  assert.equal(isRunning(3, 1000), true, 'a move after a long gap runs for the ease that draws it');
  assert.equal(isRunning(40, 16), false, 'a jump to a new scene is not a run');
  assert.deepEqual({ ...motionPlan(false) }, { runCycle: true, haloPulse: true, cameraEase: true, trail: true });
  assert.deepEqual({ ...motionPlan(true) }, { runCycle: false, haloPulse: false, cameraEase: false, trail: true }, 'reduced: no run cycle, a still halo, no camera easing');
});

test('board: the ball leaves a short fading trail only while it flies fast', () => {
  const P = BOARD_DEFAULTS;
  const flight = (speed, gap = 16, n = 20) => Array.from({ length: n }, (_, i) => ({ x: 10 + (speed * i * gap) / 1000, y: 30, t: 1000 + i * gap }));
  const fast = ballTrail(flight(20));
  assert.ok(fast, 'a 20 m/s pass');
  approx(fast.speed, 20, 0.01);
  approx(fast.head.x - fast.tail.x, (20 * P.trailMs) / 1000, 0.01, 'the trail reaches trailMs back');
  assert.equal(ballTrail(flight(4)), null, 'a dribble: none');
  assert.equal(ballTrail(flight(20, P.trailMaxGapMs + 50, 4)), null, 'renders too far apart: none');
  assert.equal(ballTrail(flight(20).slice(0, 1)), null);
  const short = ballTrail(flight(20, 16, 4)); // only 48 ms of path so far
  assert.ok(short && short.tail.x === 10, 'a pass just started: the trail reaches back to where it began');
});

/** A colour custom property's value in a CSS text: the first (light) or the dark theme's (`dark`). */
function cssVar(css, name, dark = false) {
  const block = dark ? css.slice(css.indexOf(':root[data-theme="dark"]')) : css;
  return new RegExp(`${name}:\\s*(#[0-9a-f]{3,6})\\b`, 'i').exec(block)?.[1];
}
async function loadText(path) {
  if (isNode) {
    const { readFile } = await import('node:fs/promises');
    return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  }
  return (await fetch(new URL(`../${path}`, import.meta.url))).text();
}

test('board: the ball and its halo stand out from the grass (3:1 or more) in light and dark', async () => {
  const app = await loadText('css/app.css');
  const figs = await loadText('css/figures.css');
  const ball = cssVar(app, '--ball'), edge = cssVar(app, '--ball-edge'), halo = cssVar(figs, '--ball-halo');
  assert.ok(ball && edge && halo, `${ball} ${edge} ${halo}`);
  for (const dark of [false, true]) {
    for (const g of ['--grass-a', '--grass-b', '--grass-surround']) {
      const grass = cssVar(app, g, dark);
      assert.ok(grass, `${g} (${dark ? 'dark' : 'light'})`);
      assert.ok(contrastRatio(ball, grass) >= 3, `the ball on ${g} ${dark ? 'dark' : 'light'}: ${contrastRatio(ball, grass).toFixed(2)}`);
      assert.ok(contrastRatio(halo, grass) >= 3, `the halo on ${g} ${dark ? 'dark' : 'light'}: ${contrastRatio(halo, grass).toFixed(2)}`);
    }
  }
  assert.ok(contrastRatio(ball, edge) >= 7, 'a thick dark outline on the white ball');
  approx(contrastRatio('#000', '#fff'), 21, 1e-9);
  assert.ok(Number.isNaN(relLuminance('var(--x)')));
});

// ---- figures mode on a fake DOM (Node): enough of the DOM for createBoard, with a clock the test drives

/** A fake window and document: elements with attributes, classes, styles, children and simple selectors (tag,
 *  .class, tag.class); matchMedia answers `reduced`; performance.now() is `clock.now`. No layout: the container
 *  reports a size. `raf`: animation frames too, run by clock.frame(ms) (the clock moves on, then the queued frames run). */
function fakeDom({ width = 375, height = 600, reduced = false, raf = false } = {}) {
  const clock = { now: 1000 };
  const win = {
    innerWidth: width, innerHeight: height, performance: { now: () => clock.now },
    matchMedia: () => ({ matches: reduced }), addEventListener() {}, removeEventListener() {},
  };
  const queue = [];
  if (raf) {
    let n = 0;
    win.requestAnimationFrame = (cb) => { queue.push({ id: ++n, cb }); return n; };
    win.cancelAnimationFrame = (id) => { const i = queue.findIndex((q) => q.id === id); if (i >= 0) queue.splice(i, 1); };
  }
  clock.frame = (ms = 1000 / 60) => { clock.now += ms; for (const q of queue.splice(0)) q.cb(clock.now); };
  const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  class El {
    constructor(tag) {
      Object.assign(this, { tagName: tag, attrs: new Map(), kids: [], parentNode: null, dataset: {}, textContent: '', ownerDocument: doc });
      const cls = new Set();
      this.classList = {
        add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c),
        toggle: (c, on = !cls.has(c)) => { if (on) cls.add(c); else cls.delete(c); return on; },
        set: (v) => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); }, toString: () => [...cls].join(' '),
      };
      const props = new Map();
      this.style = { setProperty: (k, v) => props.set(k, String(v)), removeProperty: (k) => props.delete(k), getPropertyValue: (k) => props.get(k) ?? '' };
    }
    get children() { return this.kids; }
    get firstChild() { return this.kids[0] ?? null; }
    get lastChild() { return this.kids.at(-1) ?? null; }
    get nextSibling() { const s = this.parentNode?.kids ?? []; return s[s.indexOf(this) + 1] ?? null; }
    get previousSibling() { const s = this.parentNode?.kids ?? []; const i = s.indexOf(this); return i > 0 ? s[i - 1] : null; }
    get className() { return this.classList.toString(); }
    set className(v) { this.classList.set(v); }
    setAttribute(k, v) { if (k === 'class') { this.classList.set(v); return; } this.attrs.set(k, String(v)); if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v); }
    getAttribute(k) { return k === 'class' ? this.classList.toString() : this.attrs.has(k) ? this.attrs.get(k) : null; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    appendChild(c) { return this.insertBefore(c, null); }
    insertBefore(c, ref) {
      if (c.parentNode) c.parentNode.kids.splice(c.parentNode.kids.indexOf(c), 1);
      c.parentNode = this;
      const i = ref ? this.kids.indexOf(ref) : -1;
      if (i < 0) this.kids.push(c); else this.kids.splice(i, 0, c);
      return c;
    }
    remove() { if (this.parentNode) { this.parentNode.kids.splice(this.parentNode.kids.indexOf(this), 1); this.parentNode = null; } }
    replaceChildren(...cs) { for (const c of [...this.kids]) c.remove(); for (const c of cs) this.appendChild(c); }
    addEventListener() {}
    removeEventListener() {}
    matches(sel) { const [tag, ...cls] = sel.split('.'); return (!tag || this.tagName === tag) && cls.every((c) => this.classList.contains(c)); }
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.kids) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  }
  const doc = { createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), defaultView: win };
  doc.documentElement = new El('html');
  const container = new El('div');
  Object.assign(container, { clientWidth: width, clientHeight: height });
  return { win, doc, container, clock };
}

/** The 22-player fixture (them on the ball in midfield) as the board draws it, YOU the right back. */
const LEARNER = 'us-RB';
const scene = (changes) => makeFrame('oopMidBlock', changes);
const moved = (dx) => scene({ move: Object.fromEntries(scene().players.filter((p) => p.role !== 'GK').map((p) => [p.id, { x: p.x + dx, y: p.y }])) });

test('board: figures mode draws 22 figures and the ball, the ball on top and YOU under it; a re-render reuses every node', () => {
  const { container } = fakeDom();
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    assert.equal(board.figures, true);
    board.render(scene(), { learnerId: LEARNER });
    const layer = board.el.querySelector('g.board-tokens');
    assert.equal(layer.querySelectorAll('g.fig').length, 22, '22 figures');
    assert.equal(layer.querySelectorAll('g.token').length, 22, 'the players');
    assert.equal(layer.lastChild.dataset.id, LEARNER, 'YOU over the other figures');
    // The ball in a layer of its own over every figure, and over the best-spot ring (drawn over the figures).
    const view = board.el.querySelector('g.board-view');
    const ballLayer = board.el.querySelector('g.board-ball');
    assert.deepEqual(ballLayer.children.map((g) => g.dataset.id), [BALL_ID], 'the ball has a layer of its own');
    assert.equal(ballLayer.querySelectorAll('circle.ball-body').length, 1);
    const at = (sel) => view.children.indexOf(board.el.querySelector(sel));
    assert.ok(at('g.board-targets') < at('g.board-tokens'), 'tap targets are rings on the ground, under the figures (and their shirt numbers)');
    assert.ok(at('g.board-tokens') < at('g.board-ghost') && at('g.board-ghost') < at('g.board-ball'), 'figures, then the best-spot ring, then the ball');
    const num = (id) => layer.querySelectorAll('g.token').find((g) => g.dataset.id === id).querySelector('.fig-num').textContent;
    assert.equal(num('us-RB'), '2');
    assert.equal(num('them-ST'), '9');
    assert.ok(layer.querySelectorAll('g.token').find((g) => g.dataset.id === 'us-GK').querySelector('g.fig').classList.contains('is-gk'), 'the keeper in a kit of their own');
    // Painter's order: a figure lower on the screen (smaller x on a phone held upright) stands in front.
    const order = layer.children.slice(0, -1).map((g) => project(scene().players.find((p) => p.id === g.dataset.id), 'vertical').y);
    for (let i = 1; i < order.length; i++) assert.ok(order[i] >= order[i - 1] - BOARD_DEFAULTS.depthSlop, `stacked back to front (${order[i - 1]} then ${order[i]})`);
    // A re-render with everyone moved: the same nodes, none made again.
    const before = board.el.querySelectorAll('g.token');
    const count = board.el.querySelectorAll('path').length;
    board.render(moved(3), { learnerId: LEARNER });
    const after = board.el.querySelectorAll('g.token');
    assert.equal(after.length, before.length);
    assert.ok(before.every((g) => after.includes(g)), 'every token node reused');
    assert.equal(board.el.querySelectorAll('path').length, count, 'no shapes added');
    assert.equal(layer.lastChild.dataset.id, LEARNER, 'YOU still on top of the figures');
    assert.equal(ballLayer.lastChild.dataset.id, BALL_ID, 'and the ball over them');
    // A reduced frame (a small-sided game) draws only its cast: the others are hidden, not removed.
    const cast = ['us-RB', 'us-RCB', 'them-LCM', 'them-LW'];
    const small = { ...scene(), players: scene().players.filter((p) => cast.includes(p.id)) };
    board.render(small, { learnerId: LEARNER });
    const shown = layer.children.filter((g) => g.getAttribute('display') !== 'none').map((g) => g.dataset.id);
    assert.deepEqual(shown.sort(), [...cast].sort());
    // The next rep's cast without last rep's learner (Try again's mirrored twin): the hidden token keeps no state, so
    // a query for YOU finds only the one drawn.
    const twin = { ...scene(), players: scene().players.filter((p) => ['us-LB', 'us-LCB', 'them-RCM', 'them-RW'].includes(p.id)) };
    board.render(twin, { learnerId: 'us-LB' });
    const learners = layer.children.filter((g) => g.classList.contains('is-learner')).map((g) => g.dataset.id);
    assert.deepEqual(learners, ['us-LB']);
  } finally { board.destroy(); }
  // Coach mode keeps its discs.
  const coach = createBoard(fakeDom().container, { orientation: 'vertical' });
  coach.render(scene(), { learnerId: LEARNER });
  assert.equal(coach.el.querySelectorAll('g.fig').length, 0, 'no figures in Coach mode');
  assert.equal(coach.el.querySelectorAll('text.token-code').length, 22, 'its discs and codes');
  const cview = coach.el.querySelector('g.board-view').children;
  assert.ok(cview.indexOf(coach.el.querySelector('g.board-ball')) > cview.indexOf(coach.el.querySelector('g.board-tokens')), 'the new ball over the discs there too');
  assert.ok(coach.el.querySelector('g.board-world').children.includes(coach.el.querySelector('g.board-ghost')), 'Coach mode\'s best-spot ring stays on the grass, under the discs');
  coach.destroy();
});

test('board: figures run (a two-pose cycle) while they move between renders and stand still otherwise; never under reduced motion', () => {
  for (const reduced of [false, true, 'attr']) {
    const { container, clock, doc } = fakeDom({ reduced: reduced === true });
    if (reduced === 'attr') doc.documentElement.dataset.reducedMotion = 'true';
    const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
    const running = () => board.el.querySelectorAll('g.token').filter((g) => g.classList.contains('is-running')).map((g) => g.dataset.id);
    try {
      board.render(scene(), { learnerId: LEARNER });
      assert.deepEqual(running(), [], 'a first render stands still');
      clock.now += 16;
      board.render(moved(0.1), { learnerId: LEARNER }); // 6 m/s
      const on = running();
      if (reduced) { assert.deepEqual(on, [], `reduced motion (${reduced}): nobody runs`); continue; }
      assert.equal(on.length, 20, 'the 20 outfield players run');
      assert.ok(!on.includes('us-GK') && !on.includes('them-GK'), 'the keepers did not move');
      clock.now += 16;
      board.render(moved(0.1), { learnerId: LEARNER });
      assert.equal(running().length, 20, 'held for a moment (no flicker)');
      clock.now += BOARD_DEFAULTS.runHoldMs + 10;
      board.render(moved(0.1), { learnerId: LEARNER });
      assert.deepEqual(running(), [], 'still again');
    } finally { board.destroy(); }
  }
});

test('board: figures face the ball and turn when it passes them; the carried ball sits on the side the carrier faces', () => {
  const { container } = fakeDom({ width: 900, height: 560 });
  const board = createBoard(container, { orientation: 'horizontal', labels: 'number', figures: true });
  const body = (id) => board.el.querySelectorAll('g.token').find((g) => g.dataset.id === id).querySelector('g.fig-body');
  const at = (id) => board.el.querySelectorAll('g.token').find((g) => g.dataset.id === id).style.transform.match(/-?[\d.]+/g).map(Number);
  try {
    board.render(scene({ ball: { x: 80, y: 30 }, carrierId: null, possession: 'none' }), { learnerId: LEARNER });
    assert.equal(body('us-RB').getAttribute('transform'), null, 'the ball to the right: facing right');
    board.render(scene({ ball: { x: 10, y: 30 }, carrierId: null, possession: 'none' }), { learnerId: LEARNER });
    assert.equal(body('us-RB').getAttribute('transform'), 'scale(-1 1)', 'the ball to the left: turned');
    // Their #8 on the ball faces the goal they attack (x = 0: left on this board); the ball is drawn at his feet there.
    board.render(scene(), { learnerId: LEARNER });
    assert.equal(body('them-LCM').getAttribute('transform'), 'scale(-1 1)');
    const [bx] = at(BALL_ID), [cx] = at('them-LCM');
    assert.ok(bx < cx, `the ball left of the carrier (${bx} < ${cx})`);
  } finally { board.destroy(); }
});

test('board: setCamera fits the rect on both axes (at once without animation frames); null goes back to the focus crop', () => {
  const { container } = fakeDom({ width: 375, height: 600 });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  const vbOf = () => board.el.querySelector('svg').getAttribute('viewBox').split(' ').map(Number);
  try {
    board.render(scene(), { learnerId: LEARNER });
    board.setFocus({ x0: 20, x1: 70 });
    const cropped = vbOf();
    const rect = { x0: 40, x1: 58, y0: 38, y1: 50 };
    board.setCamera({ x0: rect.x1, x1: rect.x0, y0: rect.y1, y1: rect.y0 }); // either way round
    assert.deepEqual(board.camera, rect);
    const want = cameraViewBox('vertical', { width: 375, height: 600 }, rect);
    assert.deepEqual(vbOf(), [want.x, want.y, want.width, want.height]);
    assert.deepEqual(board.viewBox, want);
    assert.ok(board.pxPerMetre > 10, `zoomed in: ${board.pxPerMetre.toFixed(1)} px/m`);
    assert.ok(board.tokenScale <= figureScale(board.pxPerMetre) + 1e-9);
    board.setCamera(null);
    assert.equal(board.camera, null);
    assert.deepEqual(vbOf(), cropped, 'back to the focus crop');
    board.setCamera({ x0: NaN, x1: 1, y0: 1, y1: 2 });
    assert.equal(board.camera, null, 'a bad rect is no camera');
  } finally { board.destroy(); }
});

/** Where a token is drawn: its translate (view units: metres across and down the screen) and scale, and its node. */
function drawnAt(board, id) {
  const g = board.el.querySelectorAll('g.token').find((n) => n.dataset.id === id);
  const [x, y, k = 1] = g.style.transform.match(/-?[\d.]+/g).map(Number);
  return { x, y, k, g };
}
/** Which way a drawn figure faces (1 right, -1 left). */
const facingOf = (board, id) => (drawnAt(board, id).g.querySelector('g.fig-body').getAttribute('transform') === 'scale(-1 1)' ? -1 : 1);

test('board: with figures the base disc keeps a disc\'s size and only the figure grows, so the board does not pile up', () => {
  const P = BOARD_DEFAULTS;
  for (const box of PHONE_BOXES) {
    const pxm = fullStagePxm(box);
    const s = boardScales(pxm, { figures: true, player: true });
    const disc = 2 * P.tokenRadius * s.k * pxm;
    assert.ok(disc >= P.minTokenPx - 0.5 && disc <= P.minTokenPx + 1, `${box.height} px board: the base disc ${disc.toFixed(1)} px (today's disc: ${P.minTokenPx} px)`);
    assert.ok(numberFontSize('10') * P.tokenRadius * s.kf * pxm >= P.figureNumberPx - 1e-9, 'the shirt number still reads (11 px)');
    const tall = FIGURE.height * P.tokenRadius * s.kf * pxm;
    assert.ok(tall <= 40, `${box.height} px board: the figure ${tall.toFixed(1)} px tall (was 43-48 px with the base grown with it)`);
    assert.ok(s.kf > s.k, 'the figure is bigger than its base would make it');
  }
  // On the board: the base disc (the token) is drawn at the disc's scale, the figure on it at its own.
  const { container } = fakeDom({ width: 375, height: 600 });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    board.render(scene(), { learnerId: LEARNER });
    board.setFocus({ x0: 20, x1: 70 });
    const s = boardScales(board.pxPerMetre, { figures: true, player: true });
    assert.equal(board.tokenScale, s.k);
    assert.equal(board.figureScale, s.kf);
    const t = drawnAt(board, 'us-LCB');
    assert.equal(t.k, s.k, 'the token (its base disc, rings and hit area) at the disc\'s scale');
    assert.equal(t.g.querySelector('circle.token-body').getAttribute('r'), String(P.tokenRadius));
    assert.equal(t.g.querySelector('g.fig').getAttribute('transform'), `scale(${+(P.tokenRadius * s.kf / s.k).toFixed(3)})`, 'the figure at figureScale');
  } finally { board.destroy(); }
});

test('board: Coach mode keeps its discs and gets the easy-to-see ball; a carried ball sits in front of the disc, so its code still says who has it', () => {
  const P = BOARD_DEFAULTS;
  // Pure: toward the goal, else across the pitch, else back: the first way that keeps the ball off the other discs'
  // codes; the same way while it still does (no flicker).
  const feet = { x: 50, y: 30 }, sz = { k: 1.2, kb: 2.5 };
  const d = discCarry(sz);
  assert.deepEqual(discCarryDir(feet, -1, [], sz), { x: -1, y: 0 }, 'toward the goal they attack');
  assert.deepEqual(discCarryDir(feet, 1, [{ x: 50 + d, y: 30 }], sz), { x: 0, y: 1 }, 'someone there: across the pitch');
  assert.deepEqual(discCarryDir(feet, 1, [{ x: 50 + d, y: 30 }, { x: 50, y: 30 + d }], sz), { x: 0, y: -1 });
  assert.deepEqual(discCarryDir(feet, 1, [{ x: 50 + d, y: 30 }, { x: 50, y: 30 + d }, { x: 50, y: 30 - d }], sz), { x: -1, y: 0 }, 'else back');
  assert.deepEqual(discCarryDir(feet, 1, [{ x: 50 + d, y: 30 }, { x: 50, y: 30 + d }, { x: 50, y: 30 - d }, { x: 50 - d, y: 30 }], sz), { x: 1, y: 0 }, 'boxed in: toward the goal');
  assert.deepEqual(discCarryDir(feet, 1, [], { ...sz, prev: { x: 0, y: -1 } }), { x: 0, y: -1 }, 'keeps its way while it is clear');
  const at = discBallAt(feet, { x: 0, y: 1 }, sz);
  assert.deepEqual(at, { x: 50, y: 30 + d });
  for (const labels of ['role', 'number']) {
    const { container } = fakeDom({ width: 375, height: 600 });
    const board = createBoard(container, { orientation: 'vertical', labels });
    try {
      const f = scene(); // their #8 on the ball, 0.8 m in front of him
      board.render(f, { learnerId: LEARNER });
      board.setFocus({ x0: 20, x1: 70 });
      assert.equal(board.el.querySelectorAll('g.fig').length, 0, `${labels}: discs, no figures`);
      const ball = drawnAt(board, BALL_ID);
      assert.equal(ball.k, ballScale(board.pxPerMetre), 'its own size (ballScale), not the discs\'');
      assert.equal(board.ballScale, ballScale(board.pxPerMetre));
      assert.ok(2 * P.ballRadius * ball.k * board.pxPerMetre >= 18, 'at least 18 px across on a phone');
      assert.deepEqual(ball.g.children.map((c) => c.getAttribute('class')),
        ['ball-trail', 'ball-shadow', 'ball-halo', 'token-ring', 'ball-body', 'ball-patch', 'token-focus'], 'the new ball\'s parts: trail, shadow, halo, the ball');
      assert.equal(ball.g.querySelectorAll('circle.ball-halo-ring').length, 1, 'the halo');
      const view = board.el.querySelector('g.board-view').children;
      assert.ok(view.indexOf(board.el.querySelector('g.board-ball')) > view.indexOf(board.el.querySelector('g.board-tokens')), 'drawn over every disc');
      // Carried (the new ball drawn where it is hid the carrier's whole disc and code): just in front of the disc,
      // toward the goal they attack (ours, at the bottom of a phone held upright), clear of the code in its middle.
      const carrier = f.players.find((p) => p.id === f.carrierId);
      const want = project(discBallAt(carrier, -1, { k: board.tokenScale, kb: board.ballScale }), 'vertical');
      assert.deepEqual([ball.x, ball.y], [+want.x.toFixed(2), +want.y.toFixed(2)], `${labels}: in front of the carrier's disc`);
      const c = project(carrier, 'vertical');
      assert.ok(ball.y > c.y, 'toward the goal their carrier attacks (down the screen)');
      const clear = Math.hypot(ball.x - c.x, ball.y - c.y) - (P.ballHalo * P.ballRadius + 0.25) * board.ballScale;
      assert.ok(clear >= P.discCodeHalf * P.tokenRadius * board.tokenScale - 1e-6, `the halo keeps off the code in the middle of the disc (${clear.toFixed(2)} m)`);
      approx(discCarry({ k: board.tokenScale, kb: board.ballScale }), Math.hypot(ball.x - c.x, ball.y - c.y), 0.02);
      // Draggable (#/dev): it stays where it is drawn, before and after the next render.
      board.enableDrag({ ids: [LEARNER, BALL_ID] });
      assert.deepEqual([drawnAt(board, BALL_ID).x, drawnAt(board, BALL_ID).y], [ball.x, ball.y]);
      board.render(f, { learnerId: LEARNER });
      assert.deepEqual([drawnAt(board, BALL_ID).x, drawnAt(board, BALL_ID).y], [ball.x, ball.y]);
      // Our carrier plays up the screen; a loose ball is drawn where it is.
      const ours = scene({ carrierId: 'us-RCB', possession: 'us', ball: (() => { const p = f.players.find((q) => q.id === 'us-RCB'); return { x: p.x + 0.8, y: p.y }; })() });
      board.render(ours, { learnerId: LEARNER });
      const rcb = project(ours.players.find((p) => p.id === 'us-RCB'), 'vertical');
      assert.ok(drawnAt(board, BALL_ID).y < rcb.y - 1, 'our carrier: the ball up the screen, in front of the disc');
      const loose = scene({ ball: { x: 50, y: 20 }, carrierId: null, possession: 'none' });
      board.render(loose, { learnerId: LEARNER });
      const v = project(loose.ball, 'vertical');
      assert.deepEqual([drawnAt(board, BALL_ID).x, drawnAt(board, BALL_ID).y], [+v.x.toFixed(2), +v.y.toFixed(2)], 'a loose ball where it is');
    } finally { board.destroy(); }
  }
});

const F433 = createFormation(await loadJSON('data/formations/helios-433.json'));
const FORMATIONS = { us: F433, them: F433 };
// Authored clips where the old board drew the ball jumping 4-7 m in one frame (a carrier turning as it crossed the
// middle of a phone held upright, a pass leaving the feet, a ball arriving).
const JUMPY_CLIPS = ['m3-11-r1-rcb', 'm2-10-b5-lb', 'm2-05-b1-rb', 'm1-06-t3-rw'];

test('board: the carried ball never jumps: taking it, letting it go or a carrier turning (authored clips, 60 Hz, a phone)', async () => {
  const P = BOARD_DEFAULTS;
  for (const name of JUMPY_CLIPS) {
    const s = await loadJSON(`data/scenarios/${name}.json`);
    const { container, clock } = fakeDom({ width: 375, height: 600 });
    const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
    try {
      board.setFocus({ x0: 20, x1: 70 });
      const learnerId = `us-${s.learner.role}`;
      const dt = 1000 / 60;
      let prev = null, atFeet = 0;
      for (let i = 0; i / 60 <= s.timeline.duration + 1e-9; i++) {
        const f = frameAt(s, i / 60, { formations: FORMATIONS });
        if (i) clock.now += dt;
        board.render(f, { learnerId });
        const d = drawnAt(board, BALL_ID), v = project(f.ball, 'vertical');
        if (prev) {
          // Per frame the drawn ball moves no more than the ball does (half as much again) plus one frame's slide.
          const step = Math.hypot(d.x - prev.d.x, d.y - prev.d.y), moved = Math.hypot(v.x - prev.v.x, v.y - prev.v.y);
          const slide = (carryReach({ k: board.figureScale, kb: board.ballScale }) * dt) / P.carryEaseMs;
          assert.ok(step <= 1.5 * moved + slide + 0.02, `${name} t = ${(i / 60).toFixed(3)} s: drawn ${step.toFixed(2)} m on, the ball moved ${moved.toFixed(2)} m`);
        }
        if (Math.hypot(d.x - v.x, d.y - v.y) > 1) atFeet++;
        prev = { d, v };
      }
      assert.ok(atFeet > 20, `${name}: the ball is drawn at a carrier's feet for part of the clip (${atFeet} frames)`);
    } finally { board.destroy(); }
  }
});

test('board: a pass leaves the feet and arrives without a jump; its trail starts with the flight (no streak from the feet)', () => {
  const P = BOARD_DEFAULTS;
  const { container, clock } = fakeDom({ width: 375, height: 600 });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  const base = makeFrame('ipBuildUp'); // our #4 on the ball; the pass goes to our #3 on the touchline
  const lcb = base.players.find((p) => p.id === 'us-LCB'), lb = base.players.find((p) => p.id === 'us-LB');
  const from = { x: lcb.x + 0.8, y: lcb.y }, to = { x: lb.x + 0.8, y: lb.y };
  const T = (Math.hypot(to.x - from.x, to.y - from.y) / 15) * 1000; // a 15 m/s pass
  const trailOn = () => drawnAt(board, BALL_ID).g.querySelector('polygon.ball-trail').getAttribute('display') !== 'none';
  try {
    board.setFocus({ x0: 10, x1: 60 });
    const dt = 1000 / 60;
    let prev = null, trailSeen = false, d = null;
    for (let ms = 0; ms <= T + 800; ms += dt) {
      const u = Math.min(1, Math.max(0, (ms - 300) / T));
      const phase = u <= 0 ? 'held' : u >= 1 ? 'received' : 'flight';
      const f = { ...base, ball: { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u }, carrierId: { held: 'us-LCB', received: 'us-LB', flight: null }[phase] };
      if (ms) clock.now += dt;
      board.render(f, { learnerId: 'us-LB' });
      d = drawnAt(board, BALL_ID);
      const v = project(f.ball, 'vertical');
      if (prev) {
        const step = Math.hypot(d.x - prev.d.x, d.y - prev.d.y), moved = Math.hypot(v.x - prev.v.x, v.y - prev.v.y);
        const slide = (carryReach({ k: board.figureScale, kb: board.ballScale }) * dt) / P.carryEaseMs;
        assert.ok(step <= 1.5 * moved + slide + 0.02, `${phase} at ${ms.toFixed(0)} ms: drawn ${step.toFixed(2)} m on, the ball moved ${moved.toFixed(2)} m`);
        if (prev.phase === 'held' && phase === 'flight') assert.ok(!trailOn(), 'the first frame of the flight: no trail back to the feet');
      }
      if (phase === 'flight' && trailOn()) trailSeen = true;
      prev = { d, v, phase };
    }
    assert.ok(trailSeen, 'a 15 m/s pass leaves a trail');
    // Received and settled: beside the receiver's boots, on the side it faces.
    const want = project(carriedBallAt(lb, facingOf(board, 'us-LB'), 'vertical', { k: board.figureScale, kb: board.ballScale }), 'vertical');
    approx(d.x, want.x, 0.02, 'at the receiver\'s feet');
    approx(d.y, want.y, 0.02);
  } finally { board.destroy(); }
});

test('board: on a phone held upright a carrier crossing the middle keeps the way it faces (its ball never flickers from side to side)', () => {
  const { container, clock } = fakeDom({ width: 375, height: 600 });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    board.setFocus({ x0: 20, x1: 70 });
    const faced = new Set(), sides = [];
    for (let i = 0; i <= 200; i++) { // their #8 dribbles across the pitch at 6 m/s, from our right to our left, through our midfield
      const c = { x: 58.5, y: 44.5 - 0.1 * i };
      if (i) clock.now += 1000 / 60;
      board.render(scene({ move: { 'them-LCM': c }, ball: { x: c.x - 0.8, y: c.y } }), { learnerId: LEARNER });
      faced.add(facingOf(board, 'them-LCM'));
      const side = Math.sign(drawnAt(board, BALL_ID).x - drawnAt(board, 'them-LCM').x);
      if (side && side !== sides.at(-1)) sides.push(side);
    }
    assert.equal(faced.size, 1, 'never turned');
    // The ball goes to whichever side of the feet covers nobody (carrySpot), and stays there while that side is no worse:
    // crossing the pitch through a crowd it changes sides only as the crowd changes, never back and forth.
    assert.ok(sides.length <= 3, `the ball changed sides ${sides.length - 1} times (${sides.join(' ')})`);
  } finally { board.destroy(); }
  // A board wide enough to lay the pitch across: the carrier faces the goal it attacks, as before.
  const wide = createBoard(fakeDom({ width: 900, height: 560 }).container, { orientation: 'horizontal', labels: 'number', figures: true });
  wide.render(scene(), { learnerId: LEARNER });
  assert.equal(facingOf(wide, 'them-LCM'), -1);
  wide.destroy();
});

test('board: figures face the ball where it is drawn (beside the carrier\'s boots), not where the engine has it', () => {
  const { container } = fakeDom({ width: 375, height: 600 });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    board.setFocus({ x0: 20, x1: 70 });
    const f = scene(); // their #8 on the ball, level across the pitch with our #10
    board.render(f, { learnerId: LEARNER });
    const ball = drawnAt(board, BALL_ID);
    let checked = 0;
    for (const p of f.players) {
      if (p.id === f.carrierId) continue;
      const dx = ball.x - drawnAt(board, p.id).x;
      if (Math.abs(dx) <= BOARD_DEFAULTS.facingDeadZone) continue;
      assert.equal(facingOf(board, p.id), Math.sign(dx), `${p.id} faces the ball as drawn`);
      checked++;
    }
    assert.ok(checked >= 18, `${checked} figures checked`);
    // Our #10 stands level with where the ball really is: they face the ball drawn at the carrier's feet.
    const d = ball.x - drawnAt(board, 'us-RCM').x;
    assert.ok(Math.abs(project(f.ball, 'vertical').x - drawnAt(board, 'us-RCM').x) <= BOARD_DEFAULTS.facingDeadZone && Math.abs(d) > BOARD_DEFAULTS.facingDeadZone);
    assert.equal(facingOf(board, 'us-RCM'), Math.sign(d), 'our #10, level with where the ball really is, turns to the ball drawn at the carrier\'s feet');
  } finally { board.destroy(); }
});

test('board: a carried ball made draggable stays where it is drawn (a press there picks it up without a jump)', () => {
  const { container } = fakeDom({ width: 375, height: 600 });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    board.render(scene(), { learnerId: LEARNER });
    const before = drawnAt(board, BALL_ID);
    const v = project(scene().ball, 'vertical');
    assert.ok(Math.hypot(before.x - v.x, before.y - v.y) > 1, 'drawn at the carrier\'s feet, off where the engine has it');
    board.enableDrag({ ids: [LEARNER, BALL_ID] });
    const after = drawnAt(board, BALL_ID);
    assert.deepEqual([after.x, after.y], [before.x, before.y], 'not put back on its engine spot');
  } finally { board.destroy(); }
});

test('board: while the camera eases only the view and the tokens change; markers and overlays are redrawn once, when it lands', () => {
  const { container, clock } = fakeDom({ width: 375, height: 600, raf: true });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    board.render(scene(), { learnerId: LEARNER });
    board.setOverlays({ lanes: true });
    board.setMarkers([
      { type: 'arrow', from: { x: 30, y: 52 }, to: { x: 36, y: 48 } }, { type: 'ring', id: 'them-LCM' },
      { type: 'label', at: { x: 40, y: 40 }, text: 'Best spot' }, { type: 'line-x', x: 40, label: 'Line' },
    ]);
    clock.frame();
    const q = (sel) => board.el.querySelector(sel);
    const decor = () => [...q('g.board-markers').children, ...q('g.board-marker-labels').children, ...q('g.ov-static-labels').children];
    const before = decor();
    assert.ok(before.length >= 6);
    const ring = () => q('g.board-markers').querySelector('circle.mk-ring');
    const r0 = ring().getAttribute('r');
    const rect = { x0: 40, x1: 60, y0: 36, y1: 52 };
    const want = cameraViewBox('vertical', { width: 375, height: 600 }, rect);
    const labelK = board.el.style.getPropertyValue('--board-label-k');
    board.setCamera(rect);
    // Measuring the board forces a layout of the whole page: the ease's frames reuse the last measurement.
    let reads = 0;
    Object.defineProperty(container, 'clientWidth', { get() { reads++; return 375; }, configurable: true });
    const seen = new Set();
    let frames = 0, ringFollowed = false;
    while (JSON.stringify(board.viewBox) !== JSON.stringify(want) && frames < 60) {
      clock.frame();
      frames++;
      seen.add(JSON.stringify(board.viewBox));
      if (JSON.stringify(board.viewBox) === JSON.stringify(want)) break;
      const now = decor();
      assert.ok(now.length === before.length && now.every((n, i) => n === before[i]), `frame ${frames}: markers and overlay labels untouched while easing`);
      assert.equal(board.el.style.getPropertyValue('--board-label-k'), labelK, `frame ${frames}: the label size (a restyle of the whole board) waits for the landing`);
      if (ring().getAttribute('r') !== r0) ringFollowed = true;
    }
    assert.equal(reads, 0, 'no measuring while easing');
    assert.ok(frames >= 10 && frames < 60 && seen.size >= 10, `eased over ${frames} frames`);
    assert.ok(ringFollowed, 'a ring round a token follows it as it grows or shrinks');
    const after = decor();
    assert.ok(after.length === before.length && after.every((n) => !before.includes(n)), 'redrawn once the camera landed');
    assert.equal(ring().getAttribute('r'), String(+((BOARD_DEFAULTS.tokenRadius + 1.3) * board.tokenScale).toFixed(3)));
    assert.notEqual(board.el.style.getPropertyValue('--board-label-k'), labelK, 'labels sized for the new window once it landed');
    clock.frame();
    assert.ok(decor().every((n, i) => n === after[i]), 'and left alone after that');
  } finally { board.destroy(); }
});

test('board: the halo keeps its strength through its pulse (only its size pulses), with a dark rim; the ball rules hold on every board; the run cycle is single-sourced', async () => {
  const css = await loadText('css/figures.css');
  const pulse = /@keyframes\s+ball-halo\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1];
  assert.ok(pulse, 'the halo pulses');
  assert.doesNotMatch(pulse, /opacity/, 'never fading: at 60 % the ring was only about 2:1 against light grass');
  assert.match(pulse, /scale\(/);
  const rim = /--ball-halo-rim:\s*rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)/.exec(css);
  assert.ok(rim && Math.max(+rim[1], +rim[2], +rim[3]) <= 40 && +rim[4] >= 0.4, 'a dark rim either side of the ring');
  assert.match(css, /\.ball-halo-rim\s*\{[^}]*stroke:\s*var\(--ball-halo-rim\)/);
  const outline = /\.board \.token-ball \.ball-body\s*\{[^}]*stroke-width:\s*([\d.]+)/.exec(css);
  assert.ok(outline && +outline[1] >= 0.2, 'a thick dark outline on the ball');
  // The easy-to-see ball is on every board (Coach mode's discs too): no ball rule is for figures boards only.
  for (const m of css.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
    const sel = m[2].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (/\.token-ball|\.ball-body|\.ball-patch|\.ball-halo/.test(sel)) assert.doesNotMatch(sel, /\.has-figures/, `${sel}: every board`);
  }
  // By the best-spot ring the halo is a thin, still ring round the ball, never hidden ("haloed, never hidden"): the
  // share of the full halo is the board's (ballByGhostHalo / ballHalo), single-sourced.
  const byRing = /\.token-ball\.is-by-ghost \.ball-halo\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(byRing, 'a rule for the halo by the ring');
  assert.doesNotMatch(byRing, /visibility:\s*hidden|display:\s*none|opacity:\s*0(?![.\d])/, 'never hidden');
  assert.match(byRing, /transform:\s*scale\(var\(--ball-halo-tight/);
  assert.match(byRing, /animation:\s*none/, 'still');
  const tightBoard = createBoard(fakeDom().container, { labels: 'number', figures: true });
  assert.equal(+tightBoard.el.style.getPropertyValue('--ball-halo-tight'), +(BOARD_DEFAULTS.ballByGhostHalo / BOARD_DEFAULTS.ballHalo).toFixed(3));
  assert.ok(BOARD_DEFAULTS.ballByGhostHalo > 1.1 && BOARD_DEFAULTS.ballByGhostHalo < BOARD_DEFAULTS.ballHalo, 'round the ball, smaller than the full halo');
  tightBoard.destroy();
  // YOUR tag's smaller forms: shown one at a time, in the pill's colours.
  assert.match(css, /\.token-you \.you-compact, \.token-you \.you-mark\s*\{\s*display:\s*none/);
  assert.match(css, /\.token-you-shift\.is-compact > \.you-compact, \.token-you-shift\.is-mark > \.you-mark\s*\{\s*display:\s*inline/);
  assert.match(css, /\.token-you \.you-chevron\s*\{[^}]*fill:\s*var\(--learner\)/);
  // YOUR tag slides where it goes, at once under reduced motion.
  assert.match(css, /\.token-you-shift\s*\{[^}]*transition:\s*transform/);
  assert.match(css, /data-reduced-motion="true"[\s\S]*\.token-you-shift\s*\{\s*transition:\s*none/); // the attribute selector alone (audit 2026-10-01: main.js resolves the OS query into it)
  assert.match(css, /data-reduced-motion="true"\] \.token-you-shift\s*\{\s*transition:\s*none/);
  // The run cycle's length comes from FIGURE_DEFAULTS.runMs, set on the board.
  assert.doesNotMatch(css, /\d\s*ms\s+steps\(/, 'no run-cycle length written into the CSS');
  assert.match(css, /animation:\s*var\(--fig-run-ms\)\s+steps\(/);
  const board = createBoard(fakeDom().container, { labels: 'number', figures: true });
  assert.equal(board.el.style.getPropertyValue('--fig-run-ms'), `${FIGURE_DEFAULTS.runMs}ms`);
  board.destroy();
});

// ---- figures in a real browser (layout, pointer events)

test('board (browser): with figures, a tap on the upright figure previews a target, and the ball is 18 px or more across', async () => {
  if (isNode) return;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:600px;opacity:0;pointer-events:none';
  document.body.appendChild(container);
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    board.render(scene(), { learnerId: LEARNER });
    board.setFocus({ x0: 20, x1: 70 });
    board.render(scene(), { learnerId: LEARNER });
    const ball = board.el.querySelector('.token-ball .ball-body').getBoundingClientRect();
    assert.ok(ball.width >= 18 - 0.5, `the ball ${ball.width.toFixed(1)} px across`);
    const previews = [];
    board.enableTargets({ ids: ['us-RCB'], onPreview: (id) => previews.push(id), onTap() {} });
    // Under reduced motion css/app.css gives everything a 0.01 ms transition, the pitch's rotation included: let it land.
    await new Promise((r) => setTimeout(r, 60));
    const p = scene().players.find((q) => q.id === 'us-RCB');
    const m = board.el.querySelector('.board-world').getScreenCTM();
    const s = { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
    const head = s.y - FIGURE.height * BOARD_DEFAULTS.tokenRadius * board.tokenScale * board.pxPerMetre * 0.85; // up the screen: the head
    const svg = board.el.querySelector('svg');
    const o = { pointerId: 81, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: s.x, clientY: head };
    svg.dispatchEvent(new PointerEvent('pointerdown', o));
    svg.dispatchEvent(new PointerEvent('pointerup', o));
    assert.deepEqual(previews, ['us-RCB'], 'a tap on the figure\'s head picks it');
  } finally { board.destroy(); container.remove(); }
});

test('board (browser): a carried ball is picked up where it is drawn and moves with the pointer, never jumping', async () => {
  if (isNode) return;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:600px;opacity:0;pointer-events:none';
  document.body.appendChild(container);
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    board.render(scene(), { learnerId: LEARNER }); // their #8 has it: drawn beside his boots
    board.setFocus({ x0: 20, x1: 70 });
    board.render(scene(), { learnerId: LEARNER });
    board.enableDrag({ ids: [BALL_ID] });
    await new Promise((r) => setTimeout(r, 60));
    const centre = () => { const r = board.el.querySelector('.token-ball .ball-body').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const a = centre();
    const svg = board.el.querySelector('svg');
    const o = { pointerId: 82, pointerType: 'mouse', button: 0, isPrimary: true, bubbles: true, cancelable: true };
    svg.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: a.x, clientY: a.y }));
    svg.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: a.x + 20, clientY: a.y }));
    const b = centre();
    svg.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: a.x + 20, clientY: a.y }));
    approx(b.x - a.x, 20, 1.5, `the ball moved ${(b.x - a.x).toFixed(1)} px across with a 20 px drag`);
    approx(b.y - a.y, 0, 1.5, `and ${(b.y - a.y).toFixed(1)} px up or down`);
  } finally { board.destroy(); container.remove(); }
});

// ---- wave 2 polish: the base in proportion, YOUR tag clear of the ball, the easy-to-see ball everywhere

test('board: a figure\'s base disc is about its shoulders across (1 to 1.2 times) at every scale, and still 44 px to hit', () => {
  const P = BOARD_DEFAULTS;
  assert.ok(FIGURE.shoulders > 1 && FIGURE.shoulders < 2 * FIGURE.halfWidth, 'the shoulders: narrower than the arms out');
  for (const camera of [false, true]) {
    for (const pxm of [2.5, 3.2, 4, 5.07, 6, 8, 10.8, 12, 15, 18, 20, 24, 30, 40]) {
      const s = boardScales(pxm, { figures: true, player: true, camera });
      const disc = 2 * P.tokenRadius * s.k * pxm, shoulders = FIGURE.shoulders * P.tokenRadius * s.kf * pxm;
      const tag = `${camera ? 'camera' : 'no camera'} ${pxm} px/m`;
      assert.ok(disc / shoulders >= P.figureBase.min - 1e-6 && disc / shoulders <= P.figureBase.max + 1e-6, `${tag}: the base ${disc.toFixed(1)} px, ${(disc / shoulders).toFixed(2)} x the shoulders (${shoulders.toFixed(1)} px)`);
      // The hit area and a target stay at least minHitPx across, however small the base is drawn.
      assert.ok(2 * hitRadius(pxm, (P.tokenRadius + 0.5) * s.k) * pxm >= P.minHitPx - 1e-6, `${tag}: 44 px to hit`);
      assert.ok(2 * hitRadius(pxm, (P.tokenRadius + 0.9) * s.k) * pxm >= P.minHitPx - 1e-6, `${tag}: 44 px targets`);
    }
  }
  // Zoomed in on a small game on a phone: the base shrinks with the figure (a disc there would be a plate under it)...
  const box = { width: 375, height: 520 };
  const pxm = pxPerMetre(box, cameraViewBox('vertical', box, { x0: 40, x1: 64, y0: 26, y1: 42 }));
  const zoom = boardScales(pxm, { figures: true, player: true, camera: true });
  const plate = boardScales(pxm, { player: true, camera: true }).k;
  assert.ok(pxm > 12, `zoomed in: ${pxm.toFixed(1)} px/m`);
  assert.ok(zoom.k < plate - 0.1, `the base (${zoom.k}) smaller than a disc would be there (${plate})`);
  // ...and a phone showing the full match keeps today's disc (22 px).
  for (const b of PHONE_BOXES) {
    const s = boardScales(fullStagePxm(b), { figures: true, player: true });
    assert.equal(s.k, tokenScale(fullStagePxm(b)), `${b.height} px board: today's disc`);
  }
  assert.equal(baseScale(1.5, 0), 1.5, 'no figure scale: the disc as it is');
  // On the board, under the camera: the base disc (the token) is drawn at that scale; the hit circle stays 44 px.
  const { container } = fakeDom({ width: 375, height: 520 });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    board.render(scene(), { learnerId: LEARNER });
    board.setCamera({ x0: 40, x1: 64, y0: 26, y1: 42 });
    const s = boardScales(board.pxPerMetre, { figures: true, player: true, camera: true });
    assert.equal(board.tokenScale, s.k);
    assert.equal(drawnAt(board, 'us-LCB').k, s.k);
    board.enableDrag({ ids: [LEARNER] });
    const you = drawnAt(board, LEARNER);
    const hit = +you.g.querySelector('circle.token-hit').getAttribute('r') * you.k * board.pxPerMetre;
    assert.ok(2 * hit >= P.minHitPx - 0.5, `YOUR hit circle ${(2 * hit).toFixed(1)} px across`);
  } finally { board.destroy(); }
});

test('board: YOUR tag takes the place round YOUR head that covers least (the ball, other heads and numbers, labels, the ring), and keeps it (no flicker)', () => {
  // View units round YOUR feet: the pill 4 wide and 2 tall above the head; YOUR head 1.6 wide at y -3.9; the ball 1 across
  // (its halo included), 0.2 kept round it and 0.5 more at a place the tag is not in.
  const tag = { x0: -2, x1: 2, y0: -7, y1: -5 };
  const base = { tag, head: { y: -3.9, half: 0.8 }, r: 1, clear: 0.2, back: 0.5, base: 1 };
  const at = (o = {}) => tagPlacement({ ...base, ...o });
  const box = (p, b = tag) => ({ x0: b.x0 + p.dx, x1: b.x1 + p.dx, y0: b.y0 + p.dy, y1: b.y1 + p.dy });
  const over = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const gapTo = (p, ball) => { const b = box(p); return Math.hypot(Math.max(b.x0 - ball.x, 0, ball.x - b.x1), Math.max(b.y0 - ball.y, 0, ball.y - b.y1)); };
  assert.deepEqual(at(), { place: 'above', form: 'full', dx: 0, dy: 0, cost: 0 }, 'nothing about: above the head');
  assert.equal(at({ ball: { x: 0, y: 3 } }).place, 'above', 'the ball at the feet');
  assert.equal(at({ ball: { x: 8, y: -6 } }).place, 'above', 'the ball well clear');
  // The ball over it: just clear of the ball, on the side away from it, at its own height.
  for (const [ball, want] of [[{ x: 0.5, y: -6 }, 'left'], [{ x: -0.5, y: -6 }, 'right'], [{ x: 2.5, y: -4.5 }, 'left']]) {
    const p = at({ ball });
    assert.equal(p.place, want, `ball at ${ball.x}, ${ball.y}: the side away from it (${JSON.stringify(p)})`);
    assert.ok(gapTo(p, ball) >= 1.7 - 1e-9 && p.dy === 0, `clear of it, level (${JSON.stringify(p)})`);
  }
  approx(at({ ball: { x: 0.5, y: -6 } }).dx, 0.5 - 1.7 - 2, 1e-9, 'just clear: the ball\'s edge plus the gap and `back`');
  // No flicker: it keeps its side while that side is clear, follows the ball's edge back as the ball goes, and is over
  // the head again only once the ball is clear of that spot by `back` more.
  assert.equal(at({ ball: { x: 0, y: -6 }, prev: 'left' }).place, 'left', 'dead centre, already left: stays left');
  assert.equal(at({ ball: { x: 1.2, y: -6 }, prev: 'right' }).place, 'right', 'the ball moved a little right: the tag keeps its side');
  const easing = at({ ball: { x: -3, y: -6 }, prev: 'right' });
  assert.equal(easing.place, 'right');
  approx(easing.dx, 0.7, 1e-9, 'easing back as the ball goes');
  assert.deepEqual([at({ ball: { x: -3.8, y: -6 }, prev: 'right' })].map((p) => [p.place, p.dx, p.dy]), [['above', 0, 0]], 'the ball past it: over the head');
  const near = { x: -2.5, y: -3.9 }; // just clear of the tag over the head, not by `back`
  assert.equal(at({ ball: near, prev: 'above' }).place, 'above', 'from over the head, just clear is clear');
  assert.equal(at({ ball: near, prev: 'right' }).place, 'right', 'from beside it, it stays there until the ball is clear by more');
  assert.equal(at({ ball: { x: -2.5, y: -3.3 }, prev: 'right' }).place, 'above', 'clear by more: back over the head');
  // Always, not only for the ball: another player's head and number right where the tag sits (no ball about).
  const head = { x0: -0.5, x1: 1.5, y0: -7.5, y1: -5.5 };
  const off = at({ ids: [head] });
  assert.ok(off.place !== 'above' && over(box(off), head) === 0, `off their head (${JSON.stringify(off)})`);
  assert.equal(at({ ids: [{ ...head, x0: 0.9, x1: 2.9 }] }).place, 'left', 'someone at the tag\'s right end: slid the other way');
  // A label ("Best spot") or the best-spot ring there: off it too.
  const label = { x0: -3, x1: 3, y0: -7.2, y1: -5.6 };
  const offLabel = at({ labels: [label] });
  assert.ok(over(box(offLabel), label) === 0, `off the label (${JSON.stringify(offLabel)})`);
  const offRing = at({ ring: { x: 0, y: -6, r: 1.6 } });
  assert.ok(over(box(offRing), { x0: -1.6, x1: 1.6, y0: -7.6, y1: -4.4 }) <= 0.05 * 8, `off the ring (at most a corner of its box: ${JSON.stringify(offRing)})`);
  // Beside YOUR head, level with it, when over it and either side are taken; under YOUR feet when that is all that is left.
  const sides = [{ x0: -6, x1: -2.2, y0: -9, y1: -5.2 }, { x0: 2.2, x1: 6, y0: -9, y1: -5.2 }, { x0: -2.5, x1: 2.5, y0: -10, y1: -7.1 }, { x0: -1, x1: 1, y0: -7, y1: -5 }];
  const beside = at({ ids: sides });
  assert.ok(beside.place.startsWith('beside-') && beside.form === 'full', JSON.stringify(beside));
  assert.ok(sides.every((q) => over(box(beside), q) === 0), 'covering nobody');
  const pinned = [...sides, { x0: -9, x1: -2.6, y0: -5.5, y1: -2 }, { x0: 2.6, x1: 9, y0: -5.5, y1: -2 }];
  const under = at({ ids: pinned });
  assert.equal(under.place, 'below', JSON.stringify(under));
  assert.ok(box(under).y0 >= 1 + 0.2 - 1e-9, 'under YOUR base');
  // A crowd all round: the tag shrinks (a compact "YOU" chevron over the head, then a chevron alone) rather than cover anyone.
  const forms = { compact: { x0: -1, x1: 1, y0: -6.3, y1: -5 }, mark: { x0: -0.45, x1: 0.45, y0: -5.6, y1: -5 } };
  const crowd = [...pinned.slice(0, 3), ...pinned.slice(4), { x0: -3, x1: 3, y0: 1.1, y1: 6 }, { x0: -2.1, x1: -1.1, y0: -7, y1: -5 }, { x0: 1.1, x1: 2.1, y0: -7, y1: -5 }];
  const small = at({ ids: crowd, forms });
  assert.deepEqual([small.place, small.form], ['above', 'compact'], JSON.stringify(small));
  assert.ok(crowd.every((q) => over(box(small, forms.compact), q) === 0), 'the compact form covers nobody');
  const tighter = [...crowd, { x0: -1.2, x1: 1.2, y0: -7, y1: -5.7 }];
  const packed = at({ ids: tighter, forms });
  assert.notEqual(packed.form, 'full', `packed tighter still: smaller (${JSON.stringify(packed)})`);
  // Only a chevron's room over the head (players close all round, nothing beside or under YOU): the chevron alone.
  const walls = [{ x0: -2.6, x1: -0.55, y0: -7, y1: -5 }, { x0: 0.55, x1: 2.6, y0: -7, y1: -5 }, { x0: -1, x1: 1, y0: -9, y1: -5.7 }, { x0: -2.6, x1: -0.55, y0: -9, y1: -7 }, { x0: 0.55, x1: 2.6, y0: -9, y1: -7 }];
  const mark = tagPlacement({ tag, forms, r: 1, clear: 0.2, ids: walls });
  assert.deepEqual([mark.place, mark.form], ['above', 'mark'], JSON.stringify(mark));
  assert.equal(at({ forms }).form, 'full', 'with room, always the pill with YOUR name');
  // Held (just after a move): only a much better place displaces it; the ball arriving on it still does.
  const sliver = { ...head, y0: -8.5, y1: -6.9 };
  assert.equal(at({ ids: [sliver], prev: 'above', hold: true }).place, 'above', 'a sliver of someone: held');
  assert.ok(at({ ids: [sliver], prev: 'above', hold: true }).held, '(only held: the board looks again once the hold is over)');
  assert.notEqual(at({ ids: [sliver], prev: 'above' }).place, 'above', 'not held: off them');
  assert.notEqual(at({ ids: [head], prev: 'above', hold: true }).place, 'above', 'over their head: it moves anyway');
  assert.notEqual(at({ ball: { x: 0, y: -6 }, prev: 'above', hold: true }).place, 'above', 'the ball on it: it moves anyway');
  // The view: never cut by its edge (slid in: 'edge' over the head), and a place outside it is not taken.
  assert.deepEqual(at({ view: { x0: -1, x1: 20, y0: -20, y1: 5 } }), { place: 'edge', form: 'full', dx: 1, dy: 0, cost: 0.003 }, 'YOU at the left edge');
  assert.equal(at({ view: { x0: -20, x1: 0.5, y0: -20, y1: 5 } }).dx, -1.5, 'the right edge');
  assert.equal(at({ view: { x0: -1.5, x1: 1.5, y0: -20, y1: 5 } }).place, 'above', 'a view narrower than the tag: as it is');
  const low = at({ view: { x0: -20, x1: 20, y0: -6, y1: 8 } });
  assert.ok(box(low).y0 >= -6 - 1e-9, `the top of the view over the head: somewhere in it (${JSON.stringify(low)})`);
  // A slide or lift never further than maxSlide from over the head (it would name somebody else): beside YOUR head instead.
  const reach = at({ ball: { x: 0.5, y: -6 }, maxSlide: 2 });
  assert.ok(reach.place.startsWith('beside-') || (Math.abs(reach.dx) <= 2 && Math.abs(reach.dy) <= 2), `within reach (${JSON.stringify(reach)})`);
  // A moving ball: cleared where it will be when the slide lands (lead), not only where it is.
  const fast = at({ ball: { x: 4, y: -6 }, lead: { x: 1, y: -6 } });
  assert.equal(fast.place, 'left', 'the ball coming at the tag from the right: out of its way already');
  assert.ok(box(fast).x1 <= 1 - 1.2 + 1e-9, `clear of where the ball will be (${JSON.stringify(fast)})`);
  assert.equal(at({ ball: { x: 4, y: -6 } }).place, 'above', 'the same ball standing still is clear of the tag');
});

test('board: on a board YOUR tag slides clear when the ball is over it, on figures and on Coach mode\'s discs', () => {
  for (const figures of [true, false]) {
    const { container, clock } = fakeDom({ width: 375, height: 600 });
    const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures });
    const shift = () => drawnAt(board, LEARNER).g.querySelector('g.token-you-shift');
    try {
      const me = scene().players.find((p) => p.id === LEARNER);
      // Nobody else near YOU (the tag also keeps off other players: the tests below).
      const keep = new Set([LEARNER, 'us-GK', 'them-GK', 'us-LW']);
      const loose = (ball) => { const f = scene({ ball, carrierId: null, possession: 'none' }); return { ...f, players: f.players.filter((p) => keep.has(p.id)) }; };
      board.render(loose({ x: me.x - 12, y: me.y }), { learnerId: LEARNER });
      board.setFocus({ x0: 20, x1: 70 });
      board.render(loose({ x: me.x - 12, y: me.y }), { learnerId: LEARNER });
      assert.equal(board.tagPlace, 'above', `${figures ? 'figures' : 'discs'}: the ball far below: above the head`);
      assert.equal(shift().style.transform ?? '', '');
      // Up the screen (world +x on a phone held upright) to where the tag is drawn, a little to YOUR right on the screen.
      const k = board.tokenScale, R = BOARD_DEFAULTS.tokenRadius;
      const up = figures ? FIGURE.height * R * board.figureScale + 1.6 * k : (R + 2) * k;
      board.render(loose({ x: me.x + up, y: me.y + 0.4 }), { learnerId: LEARNER });
      assert.equal(board.tagPlace, 'left', `${figures ? 'figures' : 'discs'}: the ball on the tag, to the right: the tag goes left`);
      const [dx] = shift().style.transform.match(/-?[\d.]+/g).map(Number);
      assert.ok(dx < 0, `slid left (${shift().style.transform})`);
      board.render(loose({ x: me.x + up, y: me.y + 0.8 }), { learnerId: LEARNER });
      assert.equal(board.tagPlace, 'left', 'the ball moves a little: the tag stays put');
      board.render(loose({ x: me.x - 12, y: me.y }), { learnerId: LEARNER });
      if (figures) {
        assert.equal(board.tagPlace, 'left', 'figures: the ball gone at once: held a moment where it is (tagDwellMs: no flicker)');
        clock.now += BOARD_DEFAULTS.tagDwellMs;
        board.render(loose({ x: me.x - 12, y: me.y }), { learnerId: LEARNER });
      }
      assert.equal(board.tagPlace, 'above', `${figures ? 'figures: then' : 'discs: the ball gone,'} back above (discs: at once, as before)`);
      assert.equal(shift().style.transform, '');
    } finally { board.destroy(); }
  }
});

test('board: on Coach mode\'s discs YOUR tag stays above, or slides just clear of the ball (away from it) while the ball would cover it, as before', () => {
  // (The figures' tag weighs everything every render, tagPlacement; Coach mode keeps the placement it had: discTagPlacement.)
  // View units, relative to YOUR feet: the tag 4 wide and 2 tall above the token; the ball 1 across (its halo included).
  const tag = { x0: -2, x1: 2, y0: -7, y1: -5 };
  const at = (ball, prev = 'above', view = null) => discTagPlacement({ ball, r: 1, tag, prev, view, clear: 0.2, back: 0.5 });
  const clear = (p, ball) => {
    const b = { x0: tag.x0 + p.dx, x1: tag.x1 + p.dx, y0: tag.y0 + p.dy, y1: tag.y1 + p.dy };
    return Math.hypot(Math.max(b.x0 - ball.x, 0, ball.x - b.x1), Math.max(b.y0 - ball.y, 0, ball.y - b.y1)) >= 1.2 - 1e-9;
  };
  assert.deepEqual(at(null), { place: 'above', dx: 0, dy: 0 }, 'no ball');
  assert.equal(at({ x: 0, y: 3 }).place, 'above', 'the ball at the feet: the tag stays over the token');
  assert.equal(at({ x: 8, y: -6 }).place, 'above', 'the ball well clear');
  for (const [ball, want] of [[{ x: 0.5, y: -6 }, 'left'], [{ x: -0.5, y: -6 }, 'right'], [{ x: 0, y: -6 }, 'right'], [{ x: 2.5, y: -4.5 }, 'left']]) {
    const p = at(ball);
    assert.equal(p.place, want, `ball at ${ball.x}, ${ball.y}: the side away from it`);
    assert.ok(clear(p, ball), `...and clear of it (${JSON.stringify(p)})`);
    assert.equal(p.dy, 0, 'slid at its own height');
  }
  assert.deepEqual(at({ x: 0.5, y: -6 }), { place: 'left', dx: 0.5 - 1.2 - 2, dy: 0 }, 'just clear: the ball\'s edge plus the gap');
  assert.equal(at({ x: 0, y: -6 }, 'left').place, 'left', 'dead centre, already left: stays left');
  assert.equal(at({ x: 1.5, y: -6 }, 'right').place, 'right', 'the ball moved a little right: the tag keeps its side (no flicker)');
  const easing = at({ x: -3, y: -6 }, 'right');
  assert.equal(easing.place, 'right');
  approx(easing.dx, 0.2, 1e-9, 'easing back as the ball goes');
  assert.equal(at({ x: -3.3, y: -6 }, 'right').place, 'above', 'the ball clear: back above at once (no hold)');
  const near = { x: -2.5, y: -3.9 }; // just clear of the tag above the token, not by `back`
  assert.equal(at(near, 'above').place, 'above', 'from above, just clear is clear');
  assert.equal(at(near, 'right').place, 'right', 'from beside it, it stays there until the ball is clear by more');
  assert.equal(at({ x: -2.5, y: -3.3 }, 'right').place, 'above', 'clear by more: back above');
  // No room on the side away from the ball: lifted over it, else the other side, else above as always.
  const lift = at({ x: 0.5, y: -6 }, 'above', { x0: -2.5, x1: 20, y0: -20, y1: 5 });
  assert.equal(lift.place, 'lift');
  assert.ok(lift.dy < 0 && lift.dx === 0 && clear(lift, { x: 0.5, y: -6 }));
  assert.equal(at({ x: 0.5, y: -6 }, 'above', { x0: -2.5, x1: 20, y0: -7.5, y1: 5 }).place, 'right', 'no room above either: the other side');
  assert.equal(at({ x: 0.5, y: -6 }, 'above', { x0: -2.5, x1: 2.5, y0: -7.5, y1: 5 }).place, 'above', 'no room anywhere: above');
  // YOU at the edge of the view: slid in, never cut by it.
  assert.deepEqual(at(null, 'above', { x0: -1, x1: 20, y0: -20, y1: 5 }), { place: 'edge', dx: 1, dy: 0 });
  assert.deepEqual(at({ x: -8, y: -6 }, 'above', { x0: -20, x1: 0.5, y0: -20, y1: 5 }), { place: 'edge', dx: -1.5, dy: 0 });
  assert.deepEqual(at({ x: 8, y: -6 }, 'above', { x0: -1.5, x1: 1.5, y0: -20, y1: 5 }), { place: 'above', dx: 0, dy: 0 }, 'a view narrower than the tag: as it is');
  // Only the ball moves it: other discs about (a head zone under the tag's end, one right over it), and it stays put.
  let asked = 0;
  const crowd = () => { asked++; return [{ x0: 0.9, x1: 4, y0: -8, y1: -3 }, { x0: -1, x1: 1, y0: -9, y1: -5 }]; };
  assert.deepEqual(discTagPlacement({ ball: { x: 9, y: 9 }, r: 1, tag, clear: 0.2, back: 0.5, others: crowd }), { place: 'above', dx: 0, dy: 0 }, 'no ball at it: above, whoever is about');
  assert.equal(asked, 0, 'the others are not even looked at');
  // With the ball at it: off the other discs (at most tagOthersMax of the tag on them), near YOU, else under the token.
  const base = { ball: { x: 0.5, y: -6 }, r: 1, tag, clear: 0.2, back: 0.5 };
  const other = { x0: -6, x1: -4, y0: -9, y1: 0.5 };
  const box = (p) => ({ x0: tag.x0 + p.dx, x1: tag.x1 + p.dx, y0: tag.y0 + p.dy, y1: tag.y1 + p.dy });
  const over = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const lifted = discTagPlacement({ ...base, others: [other] });
  assert.equal(lifted.place, 'lift', 'someone where it would slide: lifted over the ball');
  assert.equal(over(box(lifted), other), 0);
  const low = { x0: -20, x1: 20, y0: -7.5, y1: 5 };
  assert.equal(discTagPlacement({ ...base, others: [other], view: low }).place, 'right', 'no room to lift: the other side');
  const short = discTagPlacement({ ...base, maxSlide: 2, view: low });
  assert.ok(short.place === 'left' && Math.abs(short.dx) <= 2 && short.dx < 0, `a smaller slide within reach (${JSON.stringify(short)})`);
  assert.equal(discTagPlacement({ ...base, maxSlide: 0.2, view: low }).place, 'above', 'nowhere to go: above as always');
  const boxed = { ...base, view: { x0: -20, x1: 20, y0: -7.5, y1: 8 }, others: [other, { x0: 3.4, x1: 5.4, y0: -9, y1: 0.5 }], base: 1 };
  const under = discTagPlacement(boxed);
  assert.equal(under.place, 'below', 'under the token');
  assert.ok(box(under).y0 >= 1 + 0.2 - 1e-9);
  // A moving ball: cleared where it will be when the slide lands.
  const fast = discTagPlacement({ ...base, ball: { x: 4, y: -6 }, lead: { x: 1, y: -6 } });
  assert.equal(fast.place, 'left');
  assert.ok(box(fast).x1 <= 1 - 1.2 + 1e-9);
  assert.equal(discTagPlacement({ ...base, ball: { x: 4, y: -6 } }).place, 'above', 'the same ball standing still is clear of the tag');
  assert.deepEqual([BOARD_DEFAULTS.tagOthersMax, BOARD_DEFAULTS.tagDiscZone], [0.15, 1.2], 'the numbers Coach mode had');
});

test('board: Coach mode is unchanged: on discs YOUR tag stays the pill over YOUR token in a crowd (it moves only for the ball); figures move theirs', () => {
  // The verifier's phone Coach drill: the always-on placement slid the tag 14 px left, into the LW disc, because a
  // teammate stood by YOUR right shoulder. Every spot on a grid round our midfield, the ball far away (our corner).
  const moves = { discs: 0, figures: 0 };
  for (const figures of [false, true]) {
    const { container } = fakeDom({ width: 375, height: 600 });
    const board = createBoard(container, figures ? { orientation: 'vertical', labels: 'number', figures } : { orientation: 'vertical' });
    try {
      const at = (x, y) => scene({ ball: { x: 2, y: 3 }, carrierId: null, possession: 'none', move: { [LEARNER]: { x, y } } });
      board.render(at(45, 40), { learnerId: LEARNER });
      board.setFocus({ x0: 20, x1: 70 });
      const g = drawnAt(board, LEARNER).g;
      const shift = g.querySelector('g.token-you-shift');
      for (let x = 30; x <= 66; x += 2) {
        for (let y = 26; y <= 60; y += 2) {
          board.render(at(x, y), { learnerId: LEARNER });
          board.render(at(x, y), { learnerId: LEARNER });
          const place = board.tagPlace;
          if (!['above', 'edge'].includes(place) || board.tagForm !== 'full') moves[figures ? 'figures' : 'discs']++;
          if (!figures) {
            assert.equal(board.tagForm, 'full', `discs, YOU at (${x}, ${y}): the pill`);
            assert.ok(!shift.classList.contains('is-compact') && !shift.classList.contains('is-mark') && !shift.classList.contains('is-beside'), 'no other form');
            if (place === 'above') assert.equal(shift.style.transform ?? '', '', `discs, YOU at (${x}, ${y}): not moved`);
          }
        }
      }
    } finally { board.destroy(); }
  }
  assert.equal(moves.discs, 0, 'discs: the tag never left its place over YOUR token (the ball far away)');
  assert.ok(moves.figures > 0, `figures: the same crowd moves the tag (${moves.figures} spots): the test sees a crowd`);
});

/** What says who each other player is, as the board draws them (view units): their head and shirt number. */
function idBoxesOf(board, except) {
  const s = BOARD_DEFAULTS.tokenRadius * board.figureScale;
  const out = [];
  for (const g of board.el.querySelector('g.board-tokens').children) {
    const id = g.dataset.id;
    if (id === except || g.getAttribute('display') === 'none') continue;
    const v = project(board.drawnAt(id), board.orientation);
    const q = figureParts(v, s);
    out.push({ id, head: q.head, number: q.number });
  }
  return out;
}
const overArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const areaOfBox = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);

test('board: YOUR tag covers no other player\'s head or number wherever YOU stand in a crowd (the full match on a phone, a small game zoomed in); a compact form reads at 13 px', () => {
  // Measured on the verifier's run before this: the nickname pill covered another player's head or number on 55 of 199
  // boards (it only moved for the ball). Every spot on a grid round our midfield and the ball, the whole match on a
  // phone held upright (5 px a metre) and a small game's camera: the tag covers at most 10 % of anyone's head or number.
  for (const [label, camera] of [['full match', null], ['small game', { x0: 40, x1: 62, y0: 30, y1: 50 }]]) {
    const { container } = fakeDom({ width: 375, height: 600 });
    const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true, youLabel: 'Hurricane' });
    try {
      board.render(scene(), { learnerId: LEARNER });
      board.setFocus({ x0: 20, x1: 70 });
      if (camera) board.setCamera(camera);
      let spots = 0, covering = 0, worst = 0, forms = new Set();
      for (let x = 30; x <= 66; x += camera ? 1.5 : 3) {
        for (let y = 28; y <= 58; y += camera ? 1.5 : 3) {
          const f = scene({ move: { [LEARNER]: { x, y } } });
          board.render(f, { learnerId: LEARNER });
          board.render(f, { learnerId: LEARNER }); // (settled: a place held just after a move lets go of it on the next look)
          const tag = board.tagBox;
          const vb = board.viewBox;
          if (tag.x1 < vb.x || tag.x0 > vb.x + vb.width || tag.y1 < vb.y || tag.y0 > vb.y + vb.height) continue; // (YOU out of the camera's view)
          spots++;
          forms.add(board.tagForm);
          let most = 0;
          for (const o of idBoxesOf(board, LEARNER)) for (const part of [o.head, o.number]) most = Math.max(most, overArea(tag, part) / areaOfBox(part));
          worst = Math.max(worst, most);
          if (most > 0.1) covering++;
        }
      }
      assert.ok(spots > 40, `${label}: ${spots} spots`);
      assert.ok(covering <= Math.floor(0.02 * spots), `${label}: the tag covered more than 10 % of a head or number at ${covering} of ${spots} spots (worst ${worst.toFixed(2)})`);
      // The compact form's "YOU" is at least tagCompactPx tall on the screen (whenever the pill's own text is).
      const g = drawnAt(board, LEARNER).g;
      const cK = +(g.querySelector('g.you-compact').getAttribute('transform').match(/scale\(([\d.]+)\)/)?.[1] ?? 1);
      const tagK = +(g.querySelector('g.token-you').getAttribute('transform').match(/scale\(([\d.]+)\)/)?.[1] ?? 1);
      const px = 1.15 * cK * tagK * board.tokenScale * board.pxPerMetre;
      assert.ok(px >= BOARD_DEFAULTS.tagCompactPx - 0.05 || cK === 1, `${label}: the compact "YOU" ${px.toFixed(1)} px`);
    } finally { board.destroy(); }
  }
});

test('board: on figures a fast ball never runs over YOUR tag (it is out of the way before the ball gets there)', () => {
  const { container, clock } = fakeDom({ width: 375, height: 600 });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    const me = scene().players.find((p) => p.id === LEARNER);
    const frame = (ball) => {
      const f = scene({ ball, carrierId: null, possession: 'none' });
      const keep = new Set([LEARNER, 'us-GK', 'them-GK']);
      return { ...f, players: f.players.filter((p) => keep.has(p.id)) };
    };
    board.render(frame({ x: me.x - 12, y: me.y }), { learnerId: LEARNER });
    board.setFocus({ x0: 20, x1: 70 });
    const R = BOARD_DEFAULTS.tokenRadius;
    const up = FIGURE.height * R * board.figureScale + 1.6 * board.tokenScale;
    clock.now += 1000;
    board.render(frame({ x: me.x - 12, y: me.y }), { learnerId: LEARNER });
    const path = [8, 5, 2].map((dy) => ({ x: me.x + up, y: me.y + dy })); // across the screen toward the tag, 3 m a frame
    let placed = null;
    for (const p of path) {
      clock.now += 16;
      board.render(frame(p), { learnerId: LEARNER });
      if (board.tagPlace !== 'above' && placed === null) placed = p.y - me.y;
    }
    assert.ok(placed !== null && placed > 2, `slid before the ball got there (at ${placed} m)`);
  } finally { board.destroy(); }
});

test('board: figureOcclusion and pairCover: what one figure hides of another\'s head or number, as the board stacks them', () => {
  const s = 1;
  assert.equal(figureOcclusion({ x: 0, y: 0 }, { x: 5, y: 0 }, s), 0, 'far apart: nothing');
  assert.equal(figureOcclusion({ x: 0, y: 0 }, { x: 0, y: 0 }, s), 1, 'on the same spot: all of it');
  // Side by side, a shoulder over the number: the number's share hidden (the head is clear).
  const side = figureOcclusion({ x: 0, y: 0 }, { x: 1, y: 0 }, s);
  const B = FIGURE_BOXES;
  approx(side, (B.number.x1 - (1 + B.torso.x0)) / (B.number.x1 - B.number.x0), 1e-9, 'the number cut by the torso\'s edge');
  // One behind the other (the d-roadpass-r3 picture: their #8's number behind our #10's head).
  const behind = figureOcclusion({ x: 0.1, y: -1.1 }, { x: 0, y: 0 }, s);
  assert.ok(behind > 0.5, `the head in front hides the number behind (${behind.toFixed(2)})`);
  // Painter's order: lower on the screen in front; YOU (top) in front of all; near level, the worse of the two ways.
  assert.equal(pairCover({ x: 0.1, y: -1.1 }, { x: 0, y: 0 }, s, 0.5), behind);
  assert.equal(pairCover({ x: 0, y: 0 }, { x: 0.1, y: -1.1 }, s, 0.5), behind, 'either order');
  assert.equal(pairCover({ x: 0, y: 0, top: true }, { x: 0.1, y: -1.1 }, s, 0.5), behind, 'YOU in front: what YOU hide of them');
  assert.equal(pairCover({ x: 0.1, y: -1.1, top: true }, { x: 0, y: 0 }, s, 0.5), figureOcclusion({ x: 0, y: 0 }, { x: 0.1, y: -1.1 }, s), 'YOU behind on the screen, still drawn over them');
});

test('board: the declutter draws figures in close quarters apart (at most declutterMax, never YOU), the same way every time', () => {
  const P = BOARD_DEFAULTS, s = 1.2;
  const len = (o) => Math.hypot(o.x, o.y);
  const cover = (figs, off) => { let worst = 0; for (let i = 0; i < figs.length; i++) for (let j = i + 1; j < figs.length; j++) { const a = figs[i], b = figs[j]; const oa = off.get(a.id), ob = off.get(b.id); worst = Math.max(worst, pairCover({ x: a.x + oa.x, y: a.y + oa.y, top: a.fixed }, { x: b.x + ob.x, y: b.y + ob.y, top: b.fixed }, s, P.depthSlop)); } return worst; };
  // Far apart: nobody moves.
  const apart = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }];
  assert.deepEqual([...declutter(apart, { s }).values()], [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
  // Two on one spot: pushed apart evenly, each by no more than declutterMax, until neither hides the other's number.
  const same = [{ id: 'them-LW', x: 20, y: 30 }, { id: 'us-RB', x: 20, y: 30 }];
  const two = declutter(same, { s });
  assert.ok(len(two.get('them-LW')) <= P.declutterMax + 1e-9 && len(two.get('us-RB')) <= P.declutterMax + 1e-9);
  approx(two.get('them-LW').x, -two.get('us-RB').x, 0.011, 'shared evenly');
  assert.ok(cover(same, two) <= 0.25, `then ${cover(same, two).toFixed(2)} hidden`);
  // YOU never move: the other one takes the whole push.
  const withYou = [{ id: 'us-RB', x: 20, y: 30, fixed: true }, { id: 'them-LW', x: 20.8, y: 30.2 }];
  const y = declutter(withYou, { s });
  assert.deepEqual(y.get('us-RB'), { x: 0, y: 0 }, 'YOU where you stand');
  assert.ok(len(y.get('them-LW')) > 0 && len(y.get('them-LW')) <= P.declutterMax + 1e-9);
  assert.ok(cover(withYou, y) <= 0.25, `their head and number clear of YOU (${cover(withYou, y).toFixed(2)})`);
  // One behind the other (a marker right behind a receiver): up and down the screen, a little.
  const stack = [{ id: 'us-RCM', x: 30, y: 50 }, { id: 'them-LCM', x: 30.2, y: 48.8 }];
  const st = declutter(stack, { s });
  assert.ok(pairCover({ x: 30, y: 50 }, { x: 30.2, y: 48.8 }, s) > 0.5, 'hidden before');
  assert.ok(cover(stack, st) <= 0.25, `then ${cover(stack, st).toFixed(2)}`);
  // The same feet always give the same offsets, whatever order they come in; a pile keeps everyone within reach.
  const pile = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, x: 40 + 0.1 * i, y: 20 }));
  const p1 = declutter(pile, { s }), p2 = declutter([...pile].reverse(), { s });
  assert.deepEqual([...p1.entries()].sort(), [...p2.entries()].sort(), 'deterministic');
  for (const o of p1.values()) assert.ok(len(o) <= P.declutterMax + 1e-9, `within reach (${JSON.stringify(o)})`);
  assert.deepEqual([...declutter([], { s }).keys()], []);
  assert.deepEqual([...declutter(same, { s: 0 }).values()], [{ x: 0, y: 0 }, { x: 0, y: 0 }], 'no size: nothing');
});

test('board: close pressing zoomed in: figures are drawn clear of each other\'s heads and numbers (display only: YOU, the frame and the ball exact), sliding there', () => {
  const P = BOARD_DEFAULTS;
  const { container, clock } = fakeDom({ width: 375, height: 600, raf: true });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    // A small game: YOU press their winger on the ball, 2 m goal-side; our centre-back 2 m off him, their striker
    // right behind him (the owner's close-quarters pictures).
    const cast = new Set([LEARNER, 'them-LW', 'us-RCB', 'them-ST', 'us-RW']);
    const c = { x: 30, y: 58 };
    const place = { [LEARNER]: { x: c.x - 2, y: c.y - 0.3 }, 'them-LW': c, 'us-RCB': { x: c.x - 0.6, y: c.y + 1.9 }, 'them-ST': { x: c.x + 1.2, y: c.y + 0.2 }, 'us-RW': { x: 50, y: 60 } };
    const frameOf = (moves = place) => { const f = scene({ move: moves, ball: { x: c.x - 0.8, y: c.y }, carrierId: 'them-LW', possession: 'them' }); return { ...f, players: f.players.filter((p) => cast.has(p.id)) }; };
    const f = frameOf();
    const copy = JSON.parse(JSON.stringify(f));
    board.render(f, { learnerId: LEARNER });
    board.setCamera({ x0: c.x - 8, x1: c.x + 8, y0: c.y - 6, y1: c.y + 6 });
    for (let i = 0; i < 40; i++) clock.frame(); // the camera lands; the figures slide apart
    board.render(f, { learnerId: LEARNER });
    for (let i = 0; i < 40; i++) clock.frame();
    assert.ok(board.pxPerMetre > 12, `zoomed in (${board.pxPerMetre.toFixed(1)} px a metre)`);
    assert.deepEqual(f, copy, 'the frame is never touched');
    const me = f.players.find((p) => p.id === LEARNER);
    assert.deepEqual(board.drawnAt(LEARNER), { x: me.x, y: me.y }, 'YOU drawn exactly where you stand');
    const s = P.tokenRadius * board.figureScale;
    const drawn = f.players.map((p) => ({ id: p.id, ...project(board.drawnAt(p.id), 'vertical'), top: p.id === LEARNER }));
    for (const p of f.players) {
      const d = Math.hypot(board.drawnAt(p.id).x - p.x, board.drawnAt(p.id).y - p.y);
      assert.ok(d <= P.declutterMax + 1e-6, `${p.id} drawn ${d.toFixed(2)} m from its spot`);
    }
    let before = 0, after = 0;
    for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
      const a = f.players[i], b = f.players[j];
      before = Math.max(before, pairCover({ ...project(a, 'vertical'), top: a.id === LEARNER }, { ...project(b, 'vertical'), top: b.id === LEARNER }, s));
      after = Math.max(after, pairCover(drawn[i], drawn[j], s));
    }
    assert.ok(before > 0.4, `hidden before (${before.toFixed(2)})`);
    assert.ok(after <= 0.25, `no head or number more than a quarter hidden as drawn (${after.toFixed(2)})`);
    // The same picture on a fresh board is drawn the same (deterministic).
    const fresh = fakeDom({ width: 375, height: 600, raf: true });
    const again = createBoard(fresh.container, { orientation: 'vertical', labels: 'number', figures: true });
    again.render(f, { learnerId: LEARNER });
    again.setCamera({ x0: c.x - 8, x1: c.x + 8, y0: c.y - 6, y1: c.y + 6 });
    for (let i = 0; i < 40; i++) fresh.clock.frame();
    for (const p of f.players) { const a = again.drawnAt(p.id), b = board.drawnAt(p.id); approx(Math.hypot(a.x - b.x, a.y - b.y), 0, 0.011, `${p.id} drawn the same`); }
    again.destroy();
    // The ball is drawn at its carrier's feet as drawn; where it is (the engine's) is the frame's.
    const ball = board.drawnAt(BALL_ID), feet = board.drawnAt('them-LW');
    assert.ok(Math.hypot(ball.x - feet.x, ball.y - feet.y) <= carryReach({ k: board.figureScale, kb: board.ballScale }) + 0.2, 'the ball with its carrier');
    // Sliding: a player stepping into the crowd moves nobody's drawn offset by more than a frame's slide (at most
    // declutterMax a declutterEaseMs, and a render after a pause at most 50 ms of it); once the renders stop they
    // settle, clear of each other again.
    const ahead = { ...place, 'us-RW': { x: c.x + 0.3, y: c.y - 1.2 } };
    const offOf = (frame) => Object.fromEntries(frame.players.map((p) => { const d = board.drawnAt(p.id); return [p.id, { x: d.x - p.x, y: d.y - p.y }]; }));
    const was = offOf(f);
    clock.now += 16;
    board.render(frameOf(ahead), { learnerId: LEARNER });
    const now = offOf(frameOf(ahead));
    for (const id of Object.keys(was)) {
      const jump = Math.hypot(now[id].x - was[id].x, now[id].y - was[id].y);
      assert.ok(jump <= (P.declutterMax * 50) / P.declutterEaseMs + 1e-6, `${id}: eased (${jump.toFixed(3)} m in one render)`);
    }
    for (let i = 0; i < 40; i++) clock.frame(); // the renders stop: they slide on to where they are drawn
    const g = frameOf(ahead);
    const moved = Object.values(offOf(g)).reduce((a, o, i) => a + Math.hypot(o.x - Object.values(now)[i].x, o.y - Object.values(now)[i].y), 0);
    assert.ok(moved > 0.05, `they slid on after the last render (${moved.toFixed(2)} m in all)`);
    let crowd = 0;
    const dv = g.players.map((p) => ({ ...project(board.drawnAt(p.id), 'vertical'), top: p.id === LEARNER }));
    for (let i = 0; i < dv.length; i++) for (let j = i + 1; j < dv.length; j++) crowd = Math.max(crowd, pairCover(dv[i], dv[j], s));
    assert.ok(crowd <= 0.3, `settled: at most ${crowd.toFixed(2)} of a head or number hidden, five players within 3 m`);
  } finally { board.destroy(); }
  // Coach mode's discs: never moved.
  const coach = createBoard(fakeDom().container, { orientation: 'vertical' });
  const f = scene();
  coach.render(f, { learnerId: LEARNER });
  for (const p of f.players) assert.deepEqual(coach.drawnAt(p.id), { x: p.x, y: p.y });
  coach.destroy();
});

test('board: YOU are never moved by the declutter, not even the render after you were someone else (Try again as another player)', () => {
  const { container, clock } = fakeDom({ width: 375, height: 600 });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    const cast = new Set(['us-RB', 'us-RCB', 'them-LW']);
    const f0 = scene({ move: { 'us-RB': { x: 30, y: 58 }, 'us-RCB': { x: 30.3, y: 58.2 }, 'them-LW': { x: 40, y: 50 } } });
    const f = { ...f0, players: f0.players.filter((p) => cast.has(p.id)) };
    board.setCamera({ x0: 22, x1: 42, y0: 48, y1: 64 });
    board.render(f, { learnerId: 'us-RB' });
    const rcb = f.players.find((p) => p.id === 'us-RCB');
    assert.ok(Math.hypot(board.drawnAt('us-RCB').x - rcb.x, board.drawnAt('us-RCB').y - rcb.y) > 0.1, 'our #5, on top of YOU, drawn clear of you');
    clock.now += 16;
    board.render(f, { learnerId: 'us-RCB' }); // now YOU are our #5
    assert.deepEqual(board.drawnAt('us-RCB'), { x: rcb.x, y: rcb.y }, 'YOU exactly where you stand, at once');
    assert.deepEqual(board.drawnAt('us-RCB'), { x: rcb.x, y: rcb.y });
  } finally { board.destroy(); }
});

test('board: a carried ball goes to the side of the feet that covers nobody\'s head or number (ahead, at the toes, behind), and stays there (no flicker)', () => {
  const P = BOARD_DEFAULTS, k = 1.5, kb = 2;
  const ahead = carrySpot({ facing: 1, k, kb });
  const v = project(carriedBallAt({ x: 50, y: 30 }, 1, 'horizontal', { k, kb }), 'horizontal');
  assert.deepEqual([ahead.side, +ahead.x.toFixed(6), +ahead.y.toFixed(6)], ['ahead', +(v.x - 50).toFixed(6), +(v.y - 30).toFixed(6)], 'nobody about: beside the boots on the side it faces (carriedBallAt)');
  assert.equal(carrySpot({ facing: -1, k, kb }).x, -ahead.x, 'facing left: on the left');
  // A tight marker's head where it would go (n0r2, s1r3): the ball goes where it covers nobody.
  const h = 0.9 * P.ballHalo * P.ballRadius * kb;
  const ballBox = (sp) => ({ x0: sp.x - h, x1: sp.x + h, y0: sp.y - h, y1: sp.y + h });
  const head = { x0: ahead.x - 1, x1: ahead.x + 1, y0: ahead.y - 1.5, y1: ahead.y + 0.8 };
  const moved = carrySpot({ facing: 1, k, kb, ids: [head] });
  assert.notEqual(moved.side, 'ahead');
  assert.equal(overArea(ballBox(moved), head), 0, `off their head (${moved.side})`);
  const toes = carrySpot({ facing: 1, k, kb }).side === 'ahead' ? carrySpot({ facing: 1, k, kb, prev: 'toes' }) : null;
  assert.equal(toes.side, 'toes', 'as clear where it is (the toes): stays there');
  const both = carrySpot({ facing: 1, k, kb, ids: [head, { x0: -1, x1: 1.2, y0: 1, y1: 5 }] });
  assert.equal(both.side, 'behind', 'ahead and the toes taken: behind');
  // No flicker: it stays where it is unless another side is better by carryKeep.
  const sliver = { x0: ahead.x + h - 0.02, x1: ahead.x + h + 2, y0: ahead.y - 0.5, y1: ahead.y + 0.5 };
  assert.equal(carrySpot({ facing: 1, k, kb, ids: [sliver], prev: 'ahead' }).side, 'ahead', 'a sliver of someone: stays');
  // Never over a head or number when another side is clear: random crowds round the feet.
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let n = 0; n < 400; n++) {
    const ids = Array.from({ length: 3 }, () => { const x = (rnd() - 0.5) * 12, y = (rnd() - 0.5) * 10; return { x0: x - 0.7, x1: x + 0.7, y0: y - 1, y1: y + 1 }; });
    const facing = rnd() < 0.5 ? 1 : -1;
    const pick = carrySpot({ facing, k, kb, ids });
    const clearSide = ['ahead', 'toes', 'behind'].some((side) => { const sp = carrySpot({ facing, k, kb, ids, prev: side }); return sp.side === side && ids.every((q) => overArea(ballBox(sp), q) === 0); });
    if (clearSide) assert.ok(ids.reduce((a, q) => a + overArea(ballBox(pick), q) / areaOfBox(q), 0) <= P.carryClear + 1e-9, `crowd ${n}: a side was clear, and the ball went ${pick.side}`);
  }
});

test('board: on a board the carried ball keeps off a tight marker\'s head and number (it lands where they are clear)', () => {
  const { container, clock } = fakeDom({ width: 375, height: 600, raf: true });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    const cast = new Set([LEARNER, 'them-LCM', 'us-DM', 'us-RCM']);
    const c = { x: 58.5, y: 34 };
    const frameOf = (marker) => { const f = scene({ move: { 'them-LCM': c, 'us-DM': marker, [LEARNER]: { x: 50, y: 50 } }, ball: { x: c.x - 0.8, y: c.y } }); return { ...f, players: f.players.filter((p) => cast.has(p.id)) }; };
    board.render(frameOf({ x: 70, y: 20 }), { learnerId: LEARNER });
    board.setCamera({ x0: c.x - 10, x1: c.x + 8, y0: c.y - 8, y1: c.y + 8 });
    for (let i = 0; i < 40; i++) clock.frame();
    board.render(frameOf({ x: 70, y: 20 }), { learnerId: LEARNER });
    for (let i = 0; i < 40; i++) clock.frame();
    const s = BOARD_DEFAULTS.tokenRadius * board.figureScale;
    // Where the ball sits with nobody near: put their marker's head right there (just below the carrier on the screen).
    const spot = project(board.drawnAt(BALL_ID), 'vertical');
    const markerV = { x: spot.x, y: spot.y - FIGURE.head.y * s };
    const marker = unproject(markerV, 'vertical');
    let worst = 0;
    for (let i = 0; i < 20; i++) { // a few frames of the dribble with the marker tight on him
      clock.now += 16;
      board.render(frameOf(marker), { learnerId: LEARNER });
    }
    for (let i = 0; i < 40; i++) clock.frame();
    const b = project(board.drawnAt(BALL_ID), 'vertical'), r = BOARD_DEFAULTS.ballRadius * board.ballScale;
    const body = { x0: b.x - r, x1: b.x + r, y0: b.y - r, y1: b.y + r };
    const q = figureParts(project(board.drawnAt('us-DM'), 'vertical'), s);
    for (const part of [q.head, q.number]) worst = Math.max(worst, overArea(body, part) / areaOfBox(part));
    assert.ok(worst <= 0.1, `the ball over their marker's head or number: ${worst.toFixed(2)}`);
    const feet = project(board.drawnAt('them-LCM'), 'vertical');
    assert.ok(Math.hypot(b.x - feet.x, b.y - feet.y) <= carryReach({ k: board.figureScale, kb: board.ballScale }) + 0.3, 'still at the carrier\'s feet');
  } finally { board.destroy(); }
});

test('board: shownBox is the view and the strips a viewBox of another aspect leaves; under a camera the grass covers all of it, every frame of the ease', () => {
  assert.deepEqual(shownBox({ x: 0, y: 0, width: 100, height: 50 }, { width: 200, height: 200 }), { x0: 0, x1: 100, y0: -25, y1: 75 });
  assert.deepEqual(shownBox({ x: 10, y: 0, width: 50, height: 100 }, { width: 200, height: 200 }), { x0: -15, x1: 85, y0: 0, y1: 100 });
  assert.deepEqual(shownBox({ x: 0, y: 0, width: 10, height: 10 }, null), { x0: 0, x1: 10, y0: 0, y1: 10 });
  // A desktop board (wider than a phone, not as wide as the pitch): easing from the whole pitch in on a small game at
  // our left touchline, the view is wider than the board for a while: the SVG draws past it, above the pitch.
  for (const [w, h, orientation] of [[1331, 1150, 'horizontal'], [375, 600, 'vertical']]) {
    const box = { width: w, height: h };
    const { container, clock } = fakeDom({ ...box, raf: true });
    const board = createBoard(container, { orientation, labels: 'number', figures: true });
    try {
      board.render(scene(), { learnerId: LEARNER });
      const far = board.el.querySelector('rect.pitch-surround--far');
      assert.equal(far.parentNode.children.indexOf(far), 0, 'behind the pitch\'s own grass');
      assert.equal(far.getAttribute('display'), 'none', 'no camera: none (the whole pitch letterboxes as before)');
      board.setCamera({ x0: 40, x1: 60, y0: 1, y1: 14 });
      let frames = 0;
      do {
        const vb = board.viewBox, shown = shownBox(vb, box);
        const a = { x: +far.getAttribute('x'), y: +far.getAttribute('y') }, b = { x: a.x + +far.getAttribute('width'), y: a.y + +far.getAttribute('height') };
        const [p, q] = [project(a, orientation), project(b, orientation)];
        const cov = { x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) };
        assert.equal(far.getAttribute('display'), null, `${orientation}, frame ${frames}: drawn`);
        assert.ok(cov.x0 <= shown.x0 + 1e-6 && cov.x1 >= shown.x1 - 1e-6 && cov.y0 <= shown.y0 + 1e-6 && cov.y1 >= shown.y1 - 1e-6, `${orientation}, frame ${frames}: the grass covers all that is shown ${JSON.stringify(shown)} (${JSON.stringify(cov)})`);
        clock.frame();
      } while (++frames < 40);
      board.setCamera(null);
      assert.equal(far.getAttribute('display'), 'none', 'back to no camera: none');
    } finally { board.destroy(); }
  }
});

test('board: a camera change lands once, on the window for the size the board has once the mode has changed the page round it; the grass reaches past every edge', async () => {
  // play.js moves the camera for the next rep and then, in the same task, clears the reveal's panel: the board grows.
  // Under reduced motion the view landed on the window for the board's old size, and again on the next frame (its
  // ResizeObserver runs after the frame's animation callbacks), the grass a frame behind (the verifier: gaps at the
  // edge on a phone's close-down set).
  const rect = { x0: 40, x1: 60, y0: 20, y1: 40 };
  const small = { width: 359, height: 414 }, tall = { width: 359, height: 727 };
  const make = (box, reduced) => {
    const dom = fakeDom({ ...box, reduced, raf: true });
    const board = createBoard(dom.container, { orientation: 'vertical', labels: 'number', figures: true });
    board.render(scene(), { learnerId: LEARNER });
    return { ...dom, board };
  };
  const windowFor = (box) => { const { board } = make(box, true); try { board.setCamera(rect); return board.viewBox; } finally { board.destroy(); } };
  const want = windowFor(tall);
  assert.notDeepEqual(windowFor(small), want, '(the two sizes show different windows)');
  const coverOf = (board) => {
    const far = board.el.querySelector('rect.pitch-surround--far');
    if (far.getAttribute('display') === 'none') return null;
    const a = { x: +far.getAttribute('x'), y: +far.getAttribute('y') }, b = { x: a.x + +far.getAttribute('width'), y: a.y + +far.getAttribute('height') };
    const [p, q] = [project(a, board.orientation), project(b, board.orientation)];
    return { x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) };
  };
  for (const reduced of [true, false]) {
    const { board, container, clock } = make(small, reduced);
    const label = reduced ? 'reduced motion' : 'easing';
    try {
      board.setCamera(rect);
      if (reduced) assert.deepEqual(board.viewBox, windowFor(small), 'at once (reduced motion)');
      container.clientHeight = tall.height; // (the mode's own changes, after setCamera, same task)
      await null; // (a microtask: before any frame is drawn)
      if (reduced) {
        const vb = board.viewBox;
        assert.deepEqual(vb, want, `${label}: fitted to the board it has now, before the next frame`);
        for (let i = 1; i <= 3; i++) { clock.frame(); assert.deepEqual(board.viewBox, vb, `${label}, frame ${i}: no second step`); }
      } else {
        for (let i = 0; i < 40; i++) clock.frame();
        assert.deepEqual(board.viewBox, want, `${label}: the ease lands on the window for the board it has now`);
      }
      // The grass reaches past all a board of this size shows, and past what one of up to 3 times the aspect either
      // way would show (a board resized before it has fitted its window again: a panel going, a phone turned).
      const vb = board.viewBox, cov = coverOf(board);
      assert.ok(cov, `${label}: the grass under the view`);
      for (const box of [tall, small, { width: 2.9 * tall.width, height: tall.height }, { width: tall.width, height: 2.9 * tall.height }]) {
        const shown = shownBox(vb, box), e = 0.01; // (the attributes are rounded to the millimetre)
        assert.ok(cov.x0 <= shown.x0 + e && cov.x1 >= shown.x1 - e && cov.y0 <= shown.y0 + e && cov.y1 >= shown.y1 - e, `${label}: a ${box.width} x ${box.height} board is all grass (${JSON.stringify(shown)} in ${JSON.stringify(cov)})`);
      }
      board.setCamera(null);
      assert.equal(coverOf(board), null, `${label}: no camera, no surround (the whole pitch letterboxes as before)`);
    } finally { board.destroy(); }
  }
  // Destroyed before the refit comes: nothing happens.
  const { board } = make(small, true);
  board.setCamera(rect);
  board.destroy();
  await null;
});

test('board: with figures the best-spot ring is drawn over the figures and under the ball; by the ball the halo shrinks to a thin ring (never hidden) and the ring fits round it', () => {
  const P = BOARD_DEFAULTS;
  // Pure: a ball inside the ring grows it just clear of the ball (up to ghostMaxGrow); a ball on the rim leaves it.
  assert.deepEqual(ghostFit({ d: 30, ring: 2, body: 1, reach: 2, gap: 0.2 }), { r: 2, byBall: false }, 'far away: as it is');
  assert.deepEqual(ghostFit({ d: 3.5, ring: 2, body: 1, reach: 2, gap: 0.2 }), { r: 2, byBall: true }, 'the halo would reach the rim: hidden');
  assert.equal(ghostFit({ d: 0.5, ring: 2, body: 1, reach: 2, gap: 0.2 }).r, 2, 'a ball well inside: the ring as it is');
  approx(ghostFit({ d: 1.4, ring: 2, body: 1, reach: 2, gap: 0.2 }).r, 2.6, 1e-9, 'grown just clear of the ball');
  assert.equal(ghostFit({ d: 1.4, ring: 2, body: 3, reach: 2, gap: 0.2 }).r, 2, 'more than ghostMaxGrow: the ball is drawn over the ring instead');
  assert.equal(ghostFit({ d: 1.7, ring: 2, body: 1, reach: 2, gap: 0.2 }).r, 2, 'the ball on the rim: the ring as it is, the ball over it');
  assert.equal(ghostFit({ d: 2.5, ring: 2, body: 1, reach: 2, gap: 0.2 }).r, 2, 'the ball outside the ring');
  // On the board: their #8 has the ball; the best spot right by it (a press).
  const { container } = fakeDom({ width: 375, height: 600 });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    const f = scene();
    board.render(f, { learnerId: LEARNER });
    board.setFocus({ x0: 20, x1: 70 });
    const ball = () => board.el.querySelector('g.token-ball');
    const ring = () => board.el.querySelector('circle.ghost-ring');
    const view = board.el.querySelector('g.board-view');
    const ghost = board.el.querySelector('g.board-ghost');
    assert.equal(ghost.parentNode, view, 'in the view layer...');
    assert.ok(view.children.indexOf(ghost) > view.children.indexOf(board.el.querySelector('g.board-tokens')), '...over the figures (the carrier and YOU included)');
    assert.ok(view.children.indexOf(ghost) < view.children.indexOf(board.el.querySelector('g.board-ball')), '...and under the ball (never hidden)');
    // The ball as drawn (at the carrier's feet), and a best spot on it.
    const b = drawnAt(board, BALL_ID);
    const on = unproject({ x: b.x + 0.2, y: b.y + 0.1 }, 'vertical');
    board.setGhost(on);
    assert.ok(ball().classList.contains('is-by-ghost'), 'the halo thin by the ring (full size, it read as the ring)');
    const d = Math.hypot(0.2, 0.1), body = (P.ballByGhostHalo * P.ballRadius + 0.2) * board.ballScale; // (the thin halo and its rim)
    const drawnR = +ring().getAttribute('r') * board.tokenScale;
    assert.ok(drawnR >= d + body - 1e-6, `the ring round the ball and its thin halo (${drawnR.toFixed(2)} m, the halo's edge ${(d + body).toFixed(2)} m out)`);
    // The halo would reach the ring's rim from anywhere nearer than the ring plus the halo: hidden.
    const reach = (1.16 * P.ballHalo * P.ballRadius + 0.25) * board.ballScale;
    const own = (P.tokenRadius + 0.5) * board.tokenScale;
    board.setGhost(unproject({ x: b.x + own + reach - 0.3, y: b.y }, 'vertical'));
    assert.ok(ball().classList.contains('is-by-ghost'), 'within one halo of the rim: thin');
    approx(+ring().getAttribute('r'), P.tokenRadius + 0.5, 1e-3, 'the ball outside the ring: the ring as it is');
    board.setGhost(unproject({ x: b.x + own + reach + 1, y: b.y }, 'vertical'));
    assert.ok(!ball().classList.contains('is-by-ghost'), 'further: the halo is back');
    board.setGhost(on);
    board.setGhost(null);
    assert.ok(!ball().classList.contains('is-by-ghost'), 'no ring: the halo is back');
    // The label "Best spot" on a grown ring clears the ring as drawn.
    board.setGhost(on);
    board.setMarkers([{ type: 'label', at: on, text: 'Best spot', lift: 'token' }]);
    const label = board.el.querySelector('text.mk-label');
    const g = project(on, 'vertical');
    assert.ok(g.y - +label.getAttribute('y') >= +ring().getAttribute('r') * board.tokenScale, 'written over the ring as drawn');
  } finally { board.destroy(); }
  // Coach mode's discs: the ring stays on the grass and the halo never hides.
  const coach = createBoard(fakeDom().container, { orientation: 'vertical' });
  try {
    coach.render(scene(), { learnerId: LEARNER });
    const b = drawnAt(coach, BALL_ID);
    coach.setGhost(unproject({ x: b.x, y: b.y }, 'vertical'));
    assert.ok(!coach.el.querySelector('g.token-ball').classList.contains('is-by-ghost'));
    assert.equal(coach.el.querySelector('g.board-ghost').parentNode, coach.el.querySelector('g.board-world'));
  } finally { coach.destroy(); }
});

test('board: zoomed in, the camera keeps a figure\'s head and YOUR tag in view, at their goal line too (drawnBox, clientBox)', () => {
  const P = BOARD_DEFAULTS;
  // Pure: how far up the screen a figure and YOUR tag reach, at the board's sizes.
  const s = { k: 1.2, kf: 2, kt: 1.4 };
  approx(standHeight(s, { figures: true }), FIGURE.height * P.tokenRadius * 2 + 0.45 * 1.2 + 2.1 * 1.4 * 1.2 + P.cameraAir, 1e-9);
  assert.ok(standHeight(s, { figures: true }) > standHeight(s, { figures: false }), 'a figure stands taller than a disc');
  for (const box of [{ width: 375, height: 600 }, { width: 359, height: 470 }]) {
    const { container } = fakeDom(box);
    const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
    try {
      for (const x of [60, 96, 101, 104.5]) {
        // YOU at the top of a small game's view (up the screen = toward their goal on a phone held upright).
        const f = scene({ move: { [LEARNER]: { x, y: 60 } } });
        board.render(f, { learnerId: LEARNER });
        board.setCamera({ x0: x - 20, x1: x, y0: 44, y1: 62 });
        board.render(f, { learnerId: LEARNER });
        const vb = board.viewBox, you = board.drawnBox(LEARNER);
        const tag = `${box.width}x${box.height}, YOU at x = ${x}`;
        assert.ok(you.y0 >= vb.y - 1e-6, `${tag}: YOUR head and tag in view (${you.y0.toFixed(2)} >= ${vb.y})`);
        assert.ok(you.x0 >= vb.x - 1e-6 && you.x1 <= vb.x + vb.width + 1e-6 && you.y1 <= vb.y + vb.height + 1e-6, `${tag}: all of YOU in view`);
        // On the screen (CSS px, where the camera lands): inside the board.
        const c = board.clientBox(LEARNER);
        assert.ok(c.top >= -0.5 && c.left >= -0.5 && c.right <= box.width + 0.5 && c.bottom <= box.height + 0.5, `${tag}: on the screen ${JSON.stringify(c)}`);
        board.setCamera(null);
      }
      // Past their goal line, the grass goes on (the window's top there shows the surround, not the page).
      board.setCamera({ x0: 84, x1: 104.5, y0: 44, y1: 62 });
      const far = board.el.querySelector('rect.pitch-surround--far');
      if (board.viewBox.y < -P.margin) assert.equal(far.getAttribute('display'), null, 'the surround past the margin is drawn');
      board.setCamera(null);
      assert.equal(far.getAttribute('display'), 'none', 'no camera: none');
    } finally { board.destroy(); }
  }
});

// (The browser: the import of this file ends when its last test has; see `running` at the top.)
if (!isNode) await Promise.all(running);
