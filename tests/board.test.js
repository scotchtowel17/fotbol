import { test, assert, approx, isNode } from './harness.js';
import {
  createBoard, BOARD_DEFAULTS, BALL_ID, pickOrientation, viewBoxFor, project, unproject, worldTransform,
  keyDelta, describeSpot, tokenName, pitchMarkings, tokenScale, labelScale, pxPerMetre, focusViewBox, youTag,
  SHIRT_NUMBERS, tokenLabel, simpleTokenName, describeSpotSimple, hitRadius, aidLevel, aidStrength, hintPose, hintTotalMs,
  shirtNumberOf, tapAction, tagScale, playerLabelParams,
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
