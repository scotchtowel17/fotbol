// The pitch board: SVG pitch, player tokens, drag (pointer, two-tap, keyboard), overlays.
// Contract: docs/ARCHITECTURE.md §5.8.
//
// Two coordinate spaces, both in metres:
//   - WORLD: the canonical engine frame (x = 0 our goal line, attacking +x; y = 0 our left).
//     Grass, lines, heatmap, zone, ghost and marker shapes live in <g.board-world>, whose
//     transform rotates the pitch for the vertical layout.
//   - VIEW: the SVG viewBox. Tokens, the ball and text live in <g.board-view> at project(p),
//     so labels stay upright whatever the orientation.
// Pointer input converts back with getScreenCTM().inverse() on the world group, so any
// rotation or scaling just works.
//
// Pure helpers (pickOrientation, project, keyDelta, pitchMarkings, describeSpot...) are
// exported for tests; nothing here touches the DOM at import time.

import {
  LENGTH, WIDTH, HALF_X, MID_Y, GOAL_DEPTH, PENALTY_AREA, GOAL_AREA, PENALTY_SPOT_DIST,
  CIRCLE_RADIUS, CORNER_RADIUS, POSTS, LANE_EDGES, LANE_NAMES, THIRD_EDGES, THIRD_NAMES, ZONE_14,
  laneOf, thirdOf, clampToPitch,
} from '../engine/pitch.js';
import { ROLE_INFO, parsePlayerId } from '../engine/roles.js';
import { fieldImage } from './heatmap.js';

export const BOARD_DEFAULTS = Object.freeze({
  margin: 3, // [S] ARCHITECTURE §5.8: viewBox margin around the pitch, metres
  portraitMaxWidth: 600, // [S] ARCHITECTURE §5.8: 'auto' goes vertical in a portrait container narrower than this (CSS px)
  tokenRadius: 1.8, // [D] metres (about 17 px across on a 375 px phone)
  ballRadius: 0.8, // [D] metres (drawn larger than life so it can be seen and grabbed)
  grabRadius: 4, // [D] metres: pressing this close to a draggable token picks it up (forgiving on touch)
  dragSlopPx: 6, // [D] CSS px of movement before a press becomes a drag; less is a tap
  touchOffsetPx: 44, // [D] CSS px the token floats above a finger while dragging, so it stays visible
  nudge: 0.5, // [S] ARCHITECTURE §5.8: arrow-key step, metres
  nudgeBig: 2, // [S] ARCHITECTURE §5.8: Shift + arrow step, metres
  liveMs: 90, // [D] renders closer together than this are "live": skip easing so tokens don't trail
  stripes: 14, // [D] mowing stripes along the pitch (7.5 m each)
  spotRadius: 0.3, // [D] metres, centre and penalty spots
});

/** Pseudo player id used for the ball in drag ids, highlight lists and callbacks. */
export const BALL_ID = 'ball';

const SVGNS = 'http://www.w3.org/2000/svg';
const f3 = (n) => +n.toFixed(3);

/**
 * Resolve the layout. 'auto' is vertical when the container is portrait and narrower than portraitMaxWidth.
 * @param {'auto'|'horizontal'|'vertical'} requested
 * @returns {'horizontal'|'vertical'}
 */
export function pickOrientation(requested, width, height, P = BOARD_DEFAULTS) {
  if (requested === 'horizontal' || requested === 'vertical') return requested;
  return width > 0 && width < P.portraitMaxWidth && height > width ? 'vertical' : 'horizontal';
}

/** ViewBox rectangle (metres) for an orientation. */
export function viewBoxFor(orientation, margin = BOARD_DEFAULTS.margin) {
  const [w, h] = orientation === 'vertical' ? [WIDTH, LENGTH] : [LENGTH, WIDTH];
  return { x: -margin, y: -margin, width: w + 2 * margin, height: h + 2 * margin };
}

/**
 * World → view. Horizontal: attacking right, our left at the top.
 * Vertical: our goal at the bottom, attacking up, our left on the left.
 */
export const project = (p, orientation) =>
  orientation === 'vertical' ? { x: p.y, y: LENGTH - p.x } : { x: p.x, y: p.y };

/** View → world (inverse of project). */
export const unproject = (v, orientation) =>
  orientation === 'vertical' ? { x: LENGTH - v.y, y: v.x } : { x: v.x, y: v.y };

/** SVG transform for the world group (the same mapping as project). */
export const worldTransform = (orientation) => (orientation === 'vertical' ? `matrix(0 -1 1 0 0 ${LENGTH})` : '');

const SCREEN_DIR = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/**
 * World displacement for an arrow key. Arrows follow the SCREEN, whatever the orientation.
 * @returns {{x:number, y:number}|null} null for non-arrow keys
 */
export function keyDelta(key, orientation, big = false, P = BOARD_DEFAULTS) {
  const d = SCREEN_DIR[key];
  if (!d) return null;
  const step = big ? P.nudgeBig : P.nudge;
  const [sx, sy] = d;
  return orientation === 'vertical'
    ? { x: -sy * step || 0, y: sx * step || 0 }
    : { x: sx * step || 0, y: sy * step || 0 };
}

/** Plain-words position, e.g. "28 metres from our goal line, left half-space, defensive third". */
export function describeSpot(p) {
  return `${Math.round(p.x)} metres from our goal line, ${LANE_NAMES[laneOf(p.y)]}, ${THIRD_NAMES[thirdOf(p.x)]}`;
}

/** Accessible name for a token. */
export function tokenName(id, learnerId) {
  if (id === BALL_ID) return 'Ball';
  const { team, role } = parsePlayerId(id);
  const label = ROLE_INFO[role]?.label ?? role;
  if (id === learnerId) return `You (${label})`;
  return `${team === 'us' ? 'Teammate' : 'Opponent'}: ${label}`;
}

/**
 * IFAB pitch markings in world coordinates, as plain shape specs (pure; used by drawPitch).
 * @returns {{ tag: string, cls: string, attrs: object }[]}
 */
export function pitchMarkings(P = BOARD_DEFAULTS) {
  const L = LENGTH, W = WIDTH, R = CIRCLE_RADIUS, c = CORNER_RADIUS;
  const out = [];
  const line = (tag, attrs) => out.push({ tag, cls: 'pitch-line', attrs });
  const spot = (cx) => out.push({ tag: 'circle', cls: 'pitch-spot', attrs: { cx, cy: MID_Y, r: P.spotRadius } });

  line('rect', { x: 0, y: 0, width: L, height: W });
  line('line', { x1: HALF_X, y1: 0, x2: HALF_X, y2: W });
  line('circle', { cx: HALF_X, cy: MID_Y, r: R });
  spot(HALF_X);

  for (const [x0, d] of [[0, 1], [L, -1]]) {
    const box = (depth, width) => `M${x0} ${f3(MID_Y - width / 2)}H${f3(x0 + d * depth)}V${f3(MID_Y + width / 2)}H${x0}`;
    line('path', { d: box(PENALTY_AREA.depth, PENALTY_AREA.width) });
    line('path', { d: box(GOAL_AREA.depth, GOAL_AREA.width) });
    spot(x0 + d * PENALTY_SPOT_DIST);
    // Penalty arc: the part of the 9.15 m circle round the penalty spot that lies outside the area.
    const edgeX = f3(x0 + d * PENALTY_AREA.depth);
    const h = Math.sqrt(R ** 2 - (PENALTY_AREA.depth - PENALTY_SPOT_DIST) ** 2);
    line('path', { d: `M${edgeX} ${f3(MID_Y - h)}A${R} ${R} 0 0 ${d > 0 ? 1 : 0} ${edgeX} ${f3(MID_Y + h)}` });
    out.push({ tag: 'path', cls: 'pitch-goal', attrs: { d: `M${x0} ${f3(POSTS.top)}H${x0 - d * GOAL_DEPTH}V${f3(POSTS.bottom)}H${x0}` } });
  }

  line('path', { d: `M${c} 0A${c} ${c} 0 0 1 0 ${c}` });
  line('path', { d: `M${L - c} 0A${c} ${c} 0 0 0 ${L} ${c}` });
  line('path', { d: `M0 ${W - c}A${c} ${c} 0 0 1 ${c} ${W}` });
  line('path', { d: `M${L} ${W - c}A${c} ${c} 0 0 0 ${L - c} ${W}` });
  return out;
}

/** Create an SVG element with attributes, optionally appended to `parent`. */
function svgEl(doc, tag, attrs = {}, parent = null) {
  const n = doc.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, String(v));
  if (parent) parent.appendChild(n);
  return n;
}

/**
 * Draw grass, mowing stripes and IFAB markings into an SVG group (world coordinates).
 * Exported so other views (e.g. the home-page mini pitch) share one drawing.
 */
export function drawPitch(parent, { margin = BOARD_DEFAULTS.margin, stripes = BOARD_DEFAULTS.stripes } = {}) {
  const doc = parent.ownerDocument;
  const g = svgEl(doc, 'g', { class: 'pitch' }, parent);
  svgEl(doc, 'rect', { class: 'pitch-surround', x: -margin, y: -margin, width: LENGTH + 2 * margin, height: WIDTH + 2 * margin }, g);
  const w = LENGTH / stripes;
  for (let i = 0; i < stripes; i++) {
    svgEl(doc, 'rect', { class: i % 2 ? 'pitch-stripe pitch-stripe--b' : 'pitch-stripe pitch-stripe--a', x: f3(i * w), y: 0, width: f3(w + 0.02), height: WIDTH }, g);
  }
  for (const m of pitchMarkings()) svgEl(doc, m.tag, { class: m.cls, ...m.attrs }, g);
  return g;
}

/**
 * Create a board inside `container` (which should give it a size; the SVG keeps its aspect ratio).
 * @param {HTMLElement} container
 * @param {{ orientation?: 'auto'|'horizontal'|'vertical', params?: object }} [opts]
 */
export function createBoard(container, { orientation = 'auto', params } = {}) {
  const P = { ...BOARD_DEFAULTS, ...params };
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const uid = `board${Math.random().toString(36).slice(2, 8)}`;

  const root = doc.createElement('div');
  root.className = 'board';
  const hint = doc.createElement('p');
  hint.id = `${uid}-hint`;
  hint.className = 'visually-hidden';
  hint.textContent = 'Drag to move. Or tap it, then tap a spot. With a keyboard, use the arrow keys; hold Shift for bigger steps.';
  root.appendChild(hint);

  const svg = svgEl(doc, 'svg', { class: 'board-svg', role: 'group', 'aria-label': 'Football pitch', preserveAspectRatio: 'xMidYMid meet' }, root);
  const world = svgEl(doc, 'g', { class: 'board-world' }, svg);
  drawPitch(world, { margin: P.margin, stripes: P.stripes });
  // The heatmap grid can reach past the touchlines; clip it to the pitch (in world units, so it rotates too).
  const clip = svgEl(doc, 'clipPath', { id: `${uid}-pitch` }, svgEl(doc, 'defs', {}, world));
  svgEl(doc, 'rect', { x: 0, y: 0, width: LENGTH, height: WIDTH }, clip);
  const heatLayer = svgEl(doc, 'g', { class: 'board-heat', 'clip-path': `url(#${uid}-pitch)` }, world);
  const overlayW = svgEl(doc, 'g', { class: 'board-overlays' }, world);
  const zoneEl = svgEl(doc, 'ellipse', { class: 'board-zone', display: 'none' }, world);
  const markersW = svgEl(doc, 'g', { class: 'board-markers' }, world);
  const ghostEl = svgEl(doc, 'g', { class: 'board-ghost', display: 'none' }, world);
  svgEl(doc, 'circle', { class: 'ghost-ring', r: P.tokenRadius + 0.5 }, ghostEl);
  svgEl(doc, 'circle', { class: 'ghost-dot', r: 0.35 }, ghostEl);

  const view = svgEl(doc, 'g', { class: 'board-view' }, svg);
  const overlayLabels = svgEl(doc, 'g', { class: 'board-overlay-labels' }, view);
  const tokenLayer = svgEl(doc, 'g', { class: 'board-tokens' }, view);
  const markerLabels = svgEl(doc, 'g', { class: 'board-marker-labels' }, view);

  container.appendChild(root);

  // ---- state
  let requested = orientation;
  let orient = 'horizontal';
  let opts = { learnerId: null, highlight: [], labels: 'role', dimOthers: false };
  let lastRenderAt = -Infinity;
  const tokens = new Map(); // id → token record (players and the ball)
  let overlays = { thirds: false, lanes: false, zone14: false, offsideLine: null, backLine: null };
  let markers = [];
  let boundRings = []; // { el, id } rings that follow a token
  const drag = { enabled: false, ids: new Set(), onMove: null, onEnd: null };
  let active = null; // current pointer gesture
  let armed = null; // id selected by a tap (two-tap move)

  // ---- tokens
  function makeToken(id) {
    const isBall = id === BALL_ID;
    const g = svgEl(doc, 'g', { class: isBall ? 'token token-ball' : `token team-${parsePlayerId(id).team}`, 'data-id': id, 'aria-hidden': 'true' }, tokenLayer);
    const t = { id, g, pos: null, tx: '', flags: '', aria: '' };
    if (isBall) {
      svgEl(doc, 'circle', { class: 'token-ring', r: P.ballRadius + 0.7 }, g);
      svgEl(doc, 'circle', { class: 'ball-body', r: P.ballRadius }, g);
      const k = P.ballRadius * 0.45;
      svgEl(doc, 'path', { class: 'ball-patch', d: `M0 ${f3(-k)}L${f3(k * 0.95)} ${f3(-k * 0.31)}L${f3(k * 0.59)} ${f3(k * 0.81)}L${f3(-k * 0.59)} ${f3(k * 0.81)}L${f3(-k * 0.95)} ${f3(-k * 0.31)}Z` }, g);
      svgEl(doc, 'circle', { class: 'token-focus', r: P.ballRadius + 1 }, g);
    } else {
      const { role } = parsePlayerId(id);
      const R = P.tokenRadius;
      svgEl(doc, 'circle', { class: 'token-glow', r: R + 1.5 }, g);
      svgEl(doc, 'circle', { class: 'token-ring', r: R + 0.75 }, g);
      svgEl(doc, 'circle', { class: 'token-carrier', r: R + 0.45 }, g);
      svgEl(doc, 'circle', { class: 'token-body', r: R }, g);
      const short = ROLE_INFO[role]?.short ?? role;
      svgEl(doc, 'text', { class: short.length > 2 ? 'token-code token-code--long' : 'token-code', 'text-anchor': 'middle', dy: '0.36em' }, g).textContent = short;
      const you = svgEl(doc, 'g', { class: 'token-you', transform: `translate(0 ${f3(-(R + 2.2))})` }, g);
      svgEl(doc, 'rect', { x: -2.3, y: -1.05, width: 4.6, height: 2.1, rx: 1.05 }, you);
      svgEl(doc, 'text', { 'text-anchor': 'middle', dy: '0.36em' }, you).textContent = 'YOU';
      svgEl(doc, 'circle', { class: 'token-focus', r: R + 1.1 }, g);
    }
    // First placement must not animate in from the origin.
    g.style.transition = 'none';
    win?.requestAnimationFrame?.(() => win.requestAnimationFrame(() => { g.style.transition = ''; }));
    tokens.set(id, t);
    syncDraggable(t);
    return t;
  }

  function placeToken(t, p) {
    t.pos = { x: p.x, y: p.y };
    const v = project(p, orient);
    const tx = `translate(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px)`;
    if (tx !== t.tx) { t.g.style.transform = tx; t.tx = tx; }
    if (drag.ids.has(t.id)) {
      const aria = `${tokenName(t.id, opts.learnerId)}, ${describeSpot(p)}`;
      if (aria !== t.aria) { t.g.setAttribute('aria-label', aria); t.aria = aria; }
    }
  }

  function setFlags(t, flags) {
    const key = flags.join(' ');
    if (key === t.flags) return;
    for (const c of t.flags.split(' ')) if (c && !flags.includes(c)) t.g.classList.remove(c);
    for (const c of flags) t.g.classList.add(c);
    t.flags = key;
  }

  function syncDraggable(t) {
    const on = drag.enabled && drag.ids.has(t.id);
    if (on) {
      t.g.setAttribute('tabindex', '0');
      t.g.setAttribute('role', 'button');
      t.g.setAttribute('aria-roledescription', 'draggable');
      t.g.setAttribute('aria-describedby', hint.id);
      t.g.removeAttribute('aria-hidden');
      t.g.classList.add('is-draggable');
      t.aria = '';
      if (t.pos) placeToken(t, t.pos);
    } else {
      for (const a of ['tabindex', 'role', 'aria-roledescription', 'aria-describedby', 'aria-label', 'aria-pressed']) t.g.removeAttribute(a);
      t.g.setAttribute('aria-hidden', 'true');
      t.g.classList.remove('is-draggable', 'is-armed');
      t.aria = '';
    }
  }

  /** Keep the learner, then the ball, at the top of the stack. Moves nodes only when the order is wrong
   *  (re-appending a node would drop keyboard focus and restart its transition). */
  function ensureStacking() {
    const order = [opts.learnerId, BALL_ID].filter((id) => id && tokens.has(id)).map((id) => tokens.get(id).g);
    let n = tokenLayer.lastChild;
    for (let i = order.length - 1; i >= 0; i--, n = n?.previousSibling) {
      if (n !== order[i]) { for (const g of order) tokenLayer.appendChild(g); return; }
    }
  }

  // ---- render
  function render(frame, nextOpts = {}) {
    opts = { learnerId: null, highlight: [], labels: 'role', dimOthers: false, ...nextOpts };
    const now = win?.performance?.now?.() ?? Date.now();
    root.classList.toggle('is-live', now - lastRenderAt < P.liveMs);
    lastRenderAt = now;
    root.classList.toggle('no-labels', opts.labels === 'none');
    if (!frame) {
      for (const t of tokens.values()) t.g.setAttribute('display', 'none');
      return;
    }

    const hl = new Set(opts.highlight ?? []);
    const seen = new Set();
    const focusIds = new Set([opts.learnerId, frame.carrierId, ...hl]);
    const dragging = active?.dragging ? active.id : null;

    for (const p of frame.players) {
      seen.add(p.id);
      const t = tokens.get(p.id) ?? makeToken(p.id);
      placeToken(t, p); // controlled: the frame wins, also for a token being dragged (§5.8)
      const flags = [];
      if (p.id === opts.learnerId) flags.push('is-learner');
      if (hl.has(p.id)) flags.push('is-highlight');
      if (p.id === frame.carrierId) flags.push('is-carrier');
      if (opts.dimOthers && !focusIds.has(p.id)) flags.push('is-dim');
      if (p.id === armed) flags.push('is-armed');
      if (p.id === dragging) flags.push('is-dragging');
      setFlags(t, flags);
    }
    if (frame.ball) {
      seen.add(BALL_ID);
      const t = tokens.get(BALL_ID) ?? makeToken(BALL_ID);
      placeToken(t, frame.ball);
      const flags = [];
      if (hl.has(BALL_ID)) flags.push('is-highlight');
      if (armed === BALL_ID) flags.push('is-armed');
      if (dragging === BALL_ID) flags.push('is-dragging');
      setFlags(t, flags);
    }
    for (const [id, t] of tokens) {
      const show = seen.has(id);
      if (show === (t.g.getAttribute('display') === 'none')) {
        if (show) t.g.removeAttribute('display'); else t.g.setAttribute('display', 'none');
      }
    }
    ensureStacking();
    updateBoundRings();
  }

  // ---- ghost, zone, heatmap
  function setGhost(p) {
    if (!p) { ghostEl.setAttribute('display', 'none'); return; }
    ghostEl.removeAttribute('display');
    ghostEl.style.transform = `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px)`;
  }

  function setZone(zone) {
    if (!zone) { zoneEl.setAttribute('display', 'none'); return; }
    const { center, tol } = zone;
    zoneEl.removeAttribute('display');
    zoneEl.setAttribute('cx', f3(center.x));
    zoneEl.setAttribute('cy', f3(center.y));
    zoneEl.setAttribute('rx', f3(tol.tx));
    zoneEl.setAttribute('ry', f3(tol.ty));
  }

  let heatImg = null, heatField = null;
  function setHeatmap(field) {
    if (!field) { heatImg?.remove(); heatImg = null; heatField = null; return; }
    // The field only changes with the scene (ball, possession): re-encoding the same one on every
    // drag move would cost a PNG encode and an image decode per pointermove.
    if (field === heatField && heatImg) return;
    heatField = field;
    const img = fieldImage(field, undefined, doc);
    heatImg ??= svgEl(doc, 'image', { class: 'board-heatmap', preserveAspectRatio: 'none' }, heatLayer);
    heatImg.setAttribute('href', img.href);
    heatImg.setAttribute('x', f3(img.x));
    heatImg.setAttribute('y', f3(img.y));
    heatImg.setAttribute('width', f3(img.width));
    heatImg.setAttribute('height', f3(img.height));
  }

  // ---- overlays (static groups are built once and toggled; the two lines are updated in place)
  const ovThirds = svgEl(doc, 'g', { class: 'ov ov-thirds', display: 'none' }, overlayW);
  for (const x of THIRD_EDGES.slice(1, -1)) svgEl(doc, 'line', { class: 'ov-line', x1: x, y1: 0, x2: x, y2: WIDTH }, ovThirds);
  const ovLanes = svgEl(doc, 'g', { class: 'ov ov-lanes', display: 'none' }, overlayW);
  for (const y of LANE_EDGES.slice(1, -1)) svgEl(doc, 'line', { class: 'ov-line', x1: 0, y1: y, x2: LENGTH, y2: y }, ovLanes);
  const ovZone14 = svgEl(doc, 'rect', { class: 'ov ov-zone14', display: 'none', x: ZONE_14.x0, y: ZONE_14.y0, width: f3(ZONE_14.x1 - ZONE_14.x0), height: f3(ZONE_14.y1 - ZONE_14.y0) }, overlayW);
  const ovOffside = svgEl(doc, 'line', { class: 'ov-offside', display: 'none', y1: 0, y2: WIDTH }, overlayW);
  const ovBack = svgEl(doc, 'line', { class: 'ov-backline', display: 'none', y1: 0, y2: WIDTH }, overlayW);
  const lblOffside = svgEl(doc, 'text', { class: 'ov-label ov-label--offside', display: 'none' }, overlayLabels);
  lblOffside.textContent = 'Offside line';
  const lblBack = svgEl(doc, 'text', { class: 'ov-label ov-label--backline', display: 'none' }, overlayLabels);
  lblBack.textContent = 'Our back line';
  const staticLabels = svgEl(doc, 'g', { class: 'ov-static-labels' }, overlayLabels);

  const show = (node, on) => (on ? node.removeAttribute('display') : node.setAttribute('display', 'none'));

  /** Text in the view layer beside a world line x = const, near our left ('near') or right ('far') touchline. */
  function placeEdgeLabel(node, x, side) {
    const v = project({ x, y: side === 'near' ? 1.2 : WIDTH - 1.2 }, orient);
    if (orient === 'vertical') {
      node.setAttribute('x', f3(v.x + (side === 'near' ? 0.2 : -0.2)));
      node.setAttribute('y', f3(v.y - 0.7));
      node.setAttribute('text-anchor', side === 'near' ? 'start' : 'end');
    } else {
      node.setAttribute('x', f3(v.x + 0.7));
      node.setAttribute('y', f3(v.y + (side === 'near' ? 0.9 : 0)));
      node.setAttribute('text-anchor', 'start');
    }
  }

  function drawStaticLabels() {
    staticLabels.replaceChildren();
    const text = (p, str, cls, anchor = 'middle') => {
      const v = project(p, orient);
      svgEl(doc, 'text', { class: `ov-label ${cls}`, x: f3(v.x), y: f3(v.y), 'text-anchor': anchor, dy: '0.36em' }, staticLabels).textContent = str;
    };
    if (overlays.thirds) {
      const names = ['Defensive third', 'Middle third', 'Final third'];
      for (let i = 0; i < 3; i++) {
        const xm = (THIRD_EDGES[i] + THIRD_EDGES[i + 1]) / 2;
        if (orient === 'vertical') text({ x: xm, y: WIDTH - 1.5 }, names[i], 'ov-label--thirds', 'end');
        else text({ x: xm, y: WIDTH - 1.6 }, names[i], 'ov-label--thirds');
      }
    }
    if (overlays.lanes) {
      const names = ['Wing', 'Half-space', 'Centre', 'Half-space', 'Wing'];
      for (let i = 0; i < 5; i++) {
        const ym = (LANE_EDGES[i] + LANE_EDGES[i + 1]) / 2;
        if (orient === 'vertical') text({ x: HALF_X + 2, y: ym }, names[i], 'ov-label--lanes');
        else text({ x: HALF_X + 1.2, y: ym }, names[i], 'ov-label--lanes', 'start');
      }
    }
    if (overlays.zone14) text({ x: (ZONE_14.x0 + ZONE_14.x1) / 2, y: MID_Y }, 'Zone 14', 'ov-label--zone14');
  }

  /** Merge `next` into the overlay settings (omitted keys keep their value). */
  function setOverlays(next = {}) {
    const prev = overlays;
    overlays = { ...overlays, ...next };
    applyOverlays(prev.thirds !== overlays.thirds || prev.lanes !== overlays.lanes || prev.zone14 !== overlays.zone14);
  }

  function applyOverlays(relabel) {
    show(ovThirds, !!overlays.thirds);
    show(ovLanes, !!overlays.lanes);
    show(ovZone14, !!overlays.zone14);
    for (const [line, label, x, side] of [[ovOffside, lblOffside, overlays.offsideLine, 'near'], [ovBack, lblBack, overlays.backLine, 'far']]) {
      const on = Number.isFinite(x);
      show(line, on);
      show(label, on);
      if (!on) continue;
      line.setAttribute('x1', f3(x));
      line.setAttribute('x2', f3(x));
      placeEdgeLabel(label, x, side);
    }
    if (relabel) drawStaticLabels();
  }

  // ---- markers (cues and fix arrows). Rebuilt on every call: they change rarely.
  const TONES = new Set(['fix', 'cue', 'good', 'bad', 'info']);
  function setMarkers(list = []) {
    markers = Array.isArray(list) ? list : [];
    markersW.replaceChildren();
    markerLabels.replaceChildren();
    boundRings = [];
    for (const m of markers) drawMarker(m);
    updateBoundRings();
  }

  function drawMarker(m) {
    if (!m || typeof m !== 'object') return;
    const tone = TONES.has(m.tone) ? m.tone : m.type === 'arrow' ? 'fix' : m.type === 'label' ? 'info' : 'cue';
    const cls = (base) => `mk ${base} tone-${tone}`;
    switch (m.type) {
      case 'arrow': {
        const { from, to } = m;
        if (!from || !to) return;
        const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
        if (len < 0.5) return;
        const ux = dx / len, uy = dy / len, head = Math.min(1.8, len * 0.6), half = head * 0.55;
        const bx = to.x - ux * head, by = to.y - uy * head;
        const g = svgEl(doc, 'g', { class: cls('mk-arrow') }, markersW);
        svgEl(doc, 'line', { x1: f3(from.x), y1: f3(from.y), x2: f3(bx), y2: f3(by) }, g);
        svgEl(doc, 'polygon', { points: `${f3(to.x)},${f3(to.y)} ${f3(bx - uy * half)},${f3(by + ux * half)} ${f3(bx + uy * half)},${f3(by - ux * half)}` }, g);
        if (m.label) drawLabel({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, m.label, tone);
        return;
      }
      case 'segment':
      case 'line-x': {
        const a = m.type === 'line-x' ? { x: m.x, y: 0 } : m.a;
        const b = m.type === 'line-x' ? { x: m.x, y: WIDTH } : m.b;
        if (!a || !b) return;
        svgEl(doc, 'line', { class: cls(m.dashed === false ? 'mk-segment' : 'mk-segment mk-dashed'), x1: f3(a.x), y1: f3(a.y), x2: f3(b.x), y2: f3(b.y) }, markersW);
        if (m.label) drawLabel({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, m.label, tone);
        return;
      }
      case 'ring':
      case 'player':
      case 'point': {
        const at = m.at ?? (Number.isFinite(m.x) ? { x: m.x, y: m.y } : null);
        const r = m.r ?? (m.id === BALL_ID ? P.ballRadius + 1.4 : P.tokenRadius + 1.3);
        const el = svgEl(doc, 'circle', { class: cls(m.pulse === false ? 'mk-ring' : 'mk-ring mk-pulse'), r: f3(r) }, markersW);
        if (m.id) boundRings.push({ el, id: m.id });
        else if (at) { el.setAttribute('cx', f3(at.x)); el.setAttribute('cy', f3(at.y)); }
        else el.remove();
        if (m.label && at) drawLabel({ x: at.x, y: at.y }, m.label, tone, r);
        return;
      }
      case 'label':
        if (m.at && m.text) drawLabel(m.at, m.text, tone);
        return;
      default:
    }
  }

  function drawLabel(at, text, tone, lift = 0) {
    const v = project(at, orient);
    const t = svgEl(doc, 'text', { class: `mk-label tone-${tone}`, x: f3(v.x), y: f3(v.y - lift - 0.8), 'text-anchor': 'middle' }, markerLabels);
    t.textContent = String(text);
  }

  function updateBoundRings() {
    for (const { el, id } of boundRings) {
      const t = tokens.get(id);
      const visible = t?.pos && t.g.getAttribute('display') !== 'none';
      if (!visible) { el.setAttribute('display', 'none'); continue; }
      el.removeAttribute('display');
      el.setAttribute('cx', f3(t.pos.x));
      el.setAttribute('cy', f3(t.pos.y));
    }
  }

  // ---- orientation
  function measure() {
    // Measure the container without our own content, so the SVG's aspect ratio can't feed back into the choice.
    root.classList.add('is-measuring');
    const w = container.clientWidth, h = container.clientHeight;
    root.classList.remove('is-measuring');
    const vw = win?.innerWidth ?? w, vh = win?.innerHeight ?? h;
    return { width: w || vw, height: h > 1 ? h : vh };
  }

  function applyOrientation(force = false) {
    const { width, height } = measure();
    const next = pickOrientation(requested, width, height, P);
    if (next === orient && !force) return;
    orient = next;
    const vb = viewBoxFor(orient, P.margin);
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    const wt = worldTransform(orient);
    if (wt) world.setAttribute('transform', wt); else world.removeAttribute('transform');
    root.dataset.orientation = orient;
    // Re-project without animating tokens across the pitch.
    root.classList.add('no-anim');
    for (const t of tokens.values()) if (t.pos) { t.tx = ''; placeToken(t, t.pos); }
    applyOverlays(true);
    setMarkers(markers);
    win?.requestAnimationFrame?.(() => win.requestAnimationFrame(() => root.classList.remove('no-anim')));
  }

  function setOrientation(o = 'auto') {
    requested = o;
    applyOrientation();
  }

  // ---- pointer + keyboard input
  function toWorld(clientX, clientY) {
    const m = world.getScreenCTM?.();
    if (!m) return { x: NaN, y: NaN };
    const inv = m.inverse();
    return { x: inv.a * clientX + inv.c * clientY + inv.e, y: inv.b * clientX + inv.d * clientY + inv.f };
  }

  function draggableAt(target, w) {
    const g = target?.closest?.('.token');
    if (g && drag.ids.has(g.dataset.id)) return g.dataset.id;
    let best = null, bd = P.grabRadius;
    for (const id of drag.ids) {
      const t = tokens.get(id);
      if (!t?.pos || t.g.getAttribute('display') === 'none') continue;
      const d = Math.hypot(t.pos.x - w.x, t.pos.y - w.y);
      if (d <= bd) { bd = d; best = id; }
    }
    return best;
  }

  function moveTo(id, p, final) {
    const t = tokens.get(id);
    if (t) placeToken(t, p);
    updateBoundRings();
    drag.onMove?.(id, { ...p });
    if (final) drag.onEnd?.(id, { ...p });
  }

  function setArmed(id) {
    if (armed && tokens.has(armed)) {
      const t = tokens.get(armed);
      t.g.classList.remove('is-armed');
      t.g.removeAttribute('aria-pressed');
      t.flags = t.flags.split(' ').filter((c) => c !== 'is-armed').join(' ');
    }
    armed = id;
    root.classList.toggle('is-armed', !!id);
    if (id && tokens.has(id)) {
      tokens.get(id).g.classList.add('is-armed');
      tokens.get(id).g.setAttribute('aria-pressed', 'true');
    }
  }

  function onPointerDown(e) {
    if (!drag.enabled || active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const w = toWorld(e.clientX, e.clientY);
    const id = draggableAt(e.target, w);
    const t = id ? tokens.get(id) : null;
    active = {
      id, pointerId: e.pointerId, pointerType: e.pointerType, x0: e.clientX, y0: e.clientY, dragging: false, last: null,
      grab: t?.pos ? { x: t.pos.x - w.x, y: t.pos.y - w.y } : { x: 0, y: 0 },
    };
    try { svg.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    if (id) {
      e.preventDefault();
      t.g.focus?.({ preventScroll: true });
    }
  }

  function dragPoint(e) {
    const w = active.pointerType === 'mouse'
      ? (({ x, y }) => ({ x: x + active.grab.x, y: y + active.grab.y }))(toWorld(e.clientX, e.clientY))
      : toWorld(e.clientX, e.clientY - P.touchOffsetPx);
    return clampToPitch(w);
  }

  function onPointerMove(e) {
    if (!active || e.pointerId !== active.pointerId || !active.id) return;
    if (!active.dragging) {
      if (Math.hypot(e.clientX - active.x0, e.clientY - active.y0) < P.dragSlopPx) return;
      active.dragging = true;
      setArmed(null);
      tokens.get(active.id)?.g.classList.add('is-dragging');
      root.classList.add('is-dragging');
    }
    e.preventDefault();
    const p = dragPoint(e);
    if (!Number.isFinite(p.x)) return;
    active.last = p;
    moveTo(active.id, p, false);
  }

  function onPointerUp(e) {
    if (!active || e.pointerId !== active.pointerId) return;
    const a = active;
    active = null;
    try { svg.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (a.dragging) {
      const t = tokens.get(a.id);
      t?.g.classList.remove('is-dragging');
      if (t) t.flags = t.flags.split(' ').filter((c) => c !== 'is-dragging').join(' ');
      root.classList.remove('is-dragging');
      if (a.last) drag.onEnd?.(a.id, { ...a.last });
      return;
    }
    if (e.type === 'pointercancel' || Math.hypot(e.clientX - a.x0, e.clientY - a.y0) >= P.dragSlopPx) return;
    // A tap: on a draggable token it arms (or disarms) it; elsewhere it moves the armed token there.
    if (a.id) setArmed(armed === a.id ? null : a.id);
    else if (armed) {
      const p = clampToPitch(toWorld(e.clientX, e.clientY));
      const id = armed;
      setArmed(null);
      if (Number.isFinite(p.x)) moveTo(id, p, true);
    }
  }

  function onKeyDown(e) {
    const g = e.target?.closest?.('.token');
    const id = g?.dataset.id;
    if (!id || !drag.enabled || !drag.ids.has(id)) return;
    if (e.key === 'Escape') { setArmed(null); return; }
    const d = keyDelta(e.key, orient, e.shiftKey, P);
    if (!d) return;
    e.preventDefault();
    const from = tokens.get(id)?.pos;
    if (!from) return;
    moveTo(id, clampToPitch({ x: from.x + d.x, y: from.y + d.y }), true);
  }

  function enableDrag({ ids = [], onMove = null, onEnd = null } = {}) {
    drag.enabled = true;
    drag.ids = new Set(ids);
    drag.onMove = onMove;
    drag.onEnd = onEnd;
    root.classList.add('is-drag-enabled');
    if (armed && !drag.ids.has(armed)) setArmed(null);
    for (const t of tokens.values()) syncDraggable(t);
  }

  function disableDrag() {
    drag.enabled = false;
    drag.ids = new Set();
    drag.onMove = drag.onEnd = null;
    active = null;
    setArmed(null);
    root.classList.remove('is-drag-enabled', 'is-dragging');
    for (const t of tokens.values()) syncDraggable(t);
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('keydown', onKeyDown);

  const onResize = () => applyOrientation();
  const ro = win?.ResizeObserver ? new win.ResizeObserver(onResize) : null;
  ro?.observe(container);
  win?.addEventListener('resize', onResize);

  applyOrientation(true);

  return {
    el: root,
    render,
    setGhost,
    setZone,
    setHeatmap,
    setOverlays,
    setMarkers,
    enableDrag,
    disableDrag,
    toWorld,
    /** Extra (not in §5.8): switch 'auto' | 'horizontal' | 'vertical' at runtime. */
    setOrientation,
    /** Extra: the resolved layout, 'horizontal' | 'vertical'. */
    get orientation() { return orient; },
    destroy() {
      ro?.disconnect();
      win?.removeEventListener('resize', onResize);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
      svg.removeEventListener('keydown', onKeyDown);
      tokens.clear();
      root.remove();
    },
  };
}
