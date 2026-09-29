import { test, assert, approx, isNode, loadJSON } from './harness.js';
import {
  createBoard, BOARD_DEFAULTS, BALL_ID, pickOrientation, viewBoxFor, project, unproject, worldTransform,
  keyDelta, describeSpot, tokenName, pitchMarkings, tokenScale, labelScale, pxPerMetre, focusViewBox, youTag,
  SHIRT_NUMBERS, tokenLabel, simpleTokenName, describeSpotSimple, hitRadius, aidLevel, aidStrength, hintPose, hintTotalMs,
  shirtNumberOf, tapAction, tagScale, playerLabelParams,
  CAMERA_MIN, cameraViewBox, figureScale, ballScale, ballPx, boardScales, facingToward, carrierTarget, carriedBallAt,
  carryReach, carryWeight, stepToward, isRunning, motionPlan, ballTrail, contrastRatio, relLuminance,
} from '../js/ui/board.js';
import { FIGURE, FIGURE_DEFAULTS, numberFontSize } from '../js/ui/figures.js';
import { frameAt } from '../js/engine/timeline.js';
import { createFormation } from '../js/engine/formation.js';
import { LENGTH, WIDTH, MID_Y, PENALTY_AREA, PENALTY_SPOT_DIST, CIRCLE_RADIUS, POSTS, GOAL_DEPTH } from '../js/engine/pitch.js';
import { makeFrame } from './fixtures.js';

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
    assert.equal(s.kb, s.k, `${pxm}: the ball grows with the discs, as before (Coach mode is unchanged)`);
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
    assert.equal(fig.k, cam.k, 'its base: a disc (capped like a disc under the camera)');
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
      // On the pitch plus its margin.
      assert.ok(vb.x >= full.x - 1e-6 && vb.y >= full.y - 1e-6 && vb.x + vb.width <= full.x + full.width + 0.02 && vb.y + vb.height <= full.y + full.height + 0.02, `${tag}: on the pitch`);
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
  // A corner of the pitch: slid inside (their goal is at the top of a phone held upright).
  const corner = cameraViewBox('vertical', { width: 375, height: 600 }, { x0: 100, x1: 104, y0: 1, y1: 3 });
  assert.equal(corner.x, -P.margin);
  assert.equal(corner.y, -P.margin);
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
    assert.equal(layer.querySelectorAll('g.token').length, 23, 'and the ball');
    assert.equal(layer.lastChild.dataset.id, BALL_ID, 'the ball is drawn last: over every figure');
    assert.equal(layer.lastChild.previousSibling.dataset.id, LEARNER, 'YOU just under it');
    assert.equal(layer.querySelectorAll('circle.ball-body').length, 1);
    const num = (id) => layer.querySelectorAll('g.token').find((g) => g.dataset.id === id).querySelector('.fig-num').textContent;
    assert.equal(num('us-RB'), '2');
    assert.equal(num('them-ST'), '9');
    assert.ok(layer.querySelectorAll('g.token').find((g) => g.dataset.id === 'us-GK').querySelector('g.fig').classList.contains('is-gk'), 'the keeper in a kit of their own');
    // Painter's order: a figure lower on the screen (smaller x on a phone held upright) stands in front.
    const order = layer.children.slice(0, -2).map((g) => project(scene().players.find((p) => p.id === g.dataset.id), 'vertical').y);
    for (let i = 1; i < order.length; i++) assert.ok(order[i] >= order[i - 1] - BOARD_DEFAULTS.depthSlop, `stacked back to front (${order[i - 1]} then ${order[i]})`);
    // A re-render with everyone moved: the same nodes, none made again.
    const before = board.el.querySelectorAll('g.token');
    const count = board.el.querySelectorAll('path').length;
    board.render(moved(3), { learnerId: LEARNER });
    const after = board.el.querySelectorAll('g.token');
    assert.equal(after.length, before.length);
    assert.ok(before.every((g) => after.includes(g)), 'every token node reused');
    assert.equal(board.el.querySelectorAll('path').length, count, 'no shapes added');
    assert.equal(layer.lastChild.dataset.id, BALL_ID, 'still on top');
    // A reduced frame (a small-sided game) draws only its cast: the others are hidden, not removed.
    const cast = ['us-RB', 'us-RCB', 'them-LCM', 'them-LW'];
    const small = { ...scene(), players: scene().players.filter((p) => cast.includes(p.id)) };
    board.render(small, { learnerId: LEARNER });
    const shown = layer.children.filter((g) => g.getAttribute('display') !== 'none').map((g) => g.dataset.id);
    assert.deepEqual(shown.sort(), [...cast, BALL_ID].sort());
  } finally { board.destroy(); }
  // Coach mode keeps its discs.
  const coach = createBoard(fakeDom().container, { orientation: 'vertical' });
  coach.render(scene(), { learnerId: LEARNER });
  assert.equal(coach.el.querySelectorAll('g.fig').length, 0, 'no figures in Coach mode');
  assert.equal(coach.el.querySelectorAll('text.token-code').length, 22, 'its discs and codes');
  assert.equal(coach.el.querySelector('g.board-tokens').lastChild.dataset.id, BALL_ID, 'the new ball on top there too');
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

test('board: Coach mode is unchanged: its ball is drawn where it is, at the discs\' size, with its old ring (no halo, no offset)', () => {
  for (const labels of ['role', 'number']) {
    const { container } = fakeDom({ width: 375, height: 600 });
    const board = createBoard(container, { orientation: 'vertical', labels });
    try {
      const f = scene(); // their #8 on the ball
      board.render(f, { learnerId: LEARNER });
      board.setFocus({ x0: 20, x1: 70 });
      const ball = drawnAt(board, BALL_ID);
      const v = project(f.ball, 'vertical');
      assert.deepEqual([ball.x, ball.y], [+v.x.toFixed(2), +v.y.toFixed(2)], `${labels}: where it is`);
      assert.equal(ball.k, board.tokenScale, 'as big as the discs make it, as before');
      assert.equal(board.ballScale, board.tokenScale);
      assert.deepEqual(ball.g.children.map((c) => c.getAttribute('class')), ['token-ring', 'ball-body', 'ball-patch', 'token-focus'], 'its old parts');
      assert.equal(ball.g.children[0].getAttribute('r'), String(BOARD_DEFAULTS.ballRadius + 0.7));
      // Draggable (#/dev): still where it is, before and after the next render.
      board.enableDrag({ ids: [LEARNER, BALL_ID] });
      assert.deepEqual([drawnAt(board, BALL_ID).x, drawnAt(board, BALL_ID).y], [ball.x, ball.y]);
      board.render(f, { learnerId: LEARNER });
      assert.deepEqual([drawnAt(board, BALL_ID).x, drawnAt(board, BALL_ID).y], [ball.x, ball.y]);
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

test('board: on a phone held upright a carrier crossing the middle keeps the way it faces (its ball never flips sides)', () => {
  const { container, clock } = fakeDom({ width: 375, height: 600 });
  const board = createBoard(container, { orientation: 'vertical', labels: 'number', figures: true });
  try {
    board.setFocus({ x0: 20, x1: 70 });
    const faced = new Set(), sides = new Set();
    for (let i = 0; i <= 200; i++) { // their #8 dribbles across the pitch at 6 m/s, from our right to our left
      const c = { x: 58.5, y: 44.5 - 0.1 * i };
      if (i) clock.now += 1000 / 60;
      board.render(scene({ move: { 'them-LCM': c }, ball: { x: c.x - 0.8, y: c.y } }), { learnerId: LEARNER });
      faced.add(facingOf(board, 'them-LCM'));
      sides.add(Math.sign(drawnAt(board, BALL_ID).x - drawnAt(board, 'them-LCM').x));
    }
    assert.equal(faced.size, 1, 'never turned');
    assert.equal(sides.size, 1, 'the ball stayed on one side of the carrier');
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
    assert.ok(Math.abs(project(f.ball, 'vertical').x - drawnAt(board, 'us-RCM').x) <= BOARD_DEFAULTS.facingDeadZone && facingOf(board, 'us-RCM') === -1, 'our #10, level with where the ball really is, turns to the ball drawn at the carrier\'s feet');
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

test('board: the halo keeps its strength through its pulse (only its size pulses), with a dark rim; Coach mode\'s ball rules untouched; the run cycle is single-sourced', async () => {
  const css = await loadText('css/figures.css');
  const pulse = /@keyframes\s+ball-halo\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1];
  assert.ok(pulse, 'the halo pulses');
  assert.doesNotMatch(pulse, /opacity/, 'never fading: at 60 % the ring was only about 2:1 against light grass');
  assert.match(pulse, /scale\(/);
  const rim = /--ball-halo-rim:\s*rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)/.exec(css);
  assert.ok(rim && Math.max(+rim[1], +rim[2], +rim[3]) <= 40 && +rim[4] >= 0.4, 'a dark rim either side of the ring');
  assert.match(css, /\.ball-halo-rim\s*\{[^}]*stroke:\s*var\(--ball-halo-rim\)/);
  const outline = /\.board\.has-figures \.token-ball \.ball-body\s*\{[^}]*stroke-width:\s*([\d.]+)/.exec(css);
  assert.ok(outline && +outline[1] >= 0.2, 'a thick dark outline on the ball');
  // Coach mode's ball is unchanged: every ball rule here is for figures boards (or the figures ball's own parts).
  for (const m of css.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
    const sel = m[2].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (/\.token-ball|\.ball-body|\.ball-patch/.test(sel)) assert.match(sel, /\.has-figures/, `${sel}: figures boards only`);
  }
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
