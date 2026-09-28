import { test, assert, approx, isNode } from './harness.js';
import {
  createBoard, BOARD_DEFAULTS, BALL_ID, pickOrientation, viewBoxFor, project, unproject, worldTransform,
  keyDelta, describeSpot, tokenName, pitchMarkings,
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
