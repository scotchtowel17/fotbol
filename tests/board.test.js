import { test, assert, approx, isNode } from './harness.js';
import {
  createBoard, BOARD_DEFAULTS, BALL_ID, pickOrientation, viewBoxFor, project, unproject, worldTransform,
  keyDelta, describeSpot, tokenName, pitchMarkings, tokenScale, labelScale, pxPerMetre, focusViewBox,
} from '../js/ui/board.js';
import { LENGTH, WIDTH, MID_Y, PENALTY_AREA, PENALTY_SPOT_DIST, CIRCLE_RADIUS, POSTS, GOAL_DEPTH } from '../js/engine/pitch.js';

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
