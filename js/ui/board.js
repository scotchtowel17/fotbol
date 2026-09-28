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
// Small screens: tokens are drawn at least BOARD_DEFAULTS.minTokenPx across (tokenScale; labels likewise,
// labelScale), and a mode may name the pitch length it needs (setFocus) so that a phone held upright crops
// the empty length of the pitch rather than shrink everything (focusViewBox). Drags are relative (the token
// keeps its offset from the pointer); on touch the token eases up above the finger only on a long drag.
//
// Pure helpers (pickOrientation, project, keyDelta, pitchMarkings, describeSpot...) are
// exported for tests; nothing here touches the DOM at import time.
//
// Player mode (docs/KID_REDESIGN.md §8.1) opts into a few extras; Coach mode never calls them, so it looks
// and behaves as before:
//   createBoard(el, { labels: 'number', youNumber })
//                                           unique shirt numbers on the tokens (ROLE_INFO num; YOUR kit number on YOU and,
//                                           in exchange, YOUR position's number on the teammate who had it: shirtNumberOf),
//                                           plain names for screen readers; pitch labels at least playerLabelPx (16 px)
//                                           tall and YOUR name tag's text at least playerTagPx (14 px)
//   board.setSpotlight(ids | null)          everything but YOU, the ball and these tokens dimmed to 40 %
//   board.enableTargets({ ids, onTap, onPreview }) / disableTargets()
//                                           big (≥ 44 px) tap targets on tokens: first tap previews, a second tap confirms
//   board.showHintHand({ from, to })        the worked-example hand drags YOU, then YOU snaps back (a Promise; instant
//                                           under reduced motion)
//   board.setAid({ kind: 'glow', target } | { kind: 'heat', level } | null)
//                                           a warm/cold ring on YOU (glow: brighter and warmer as YOU nears `target`)
//   enableDrag({ ..., tapToMove: id, onArm })  a tap on the pitch moves that token there (tap-YOU-then-a-spot still works:
//                                           only a tap on the drawn token picks it up, tapAction); markers: a line's label
//                                           can sit at `labelAt`
// Every draggable token is at least minHitPx (44 CSS px) wide to hit (a press there picks it up to drag), however
// small it is drawn (R10).

import {
  LENGTH, WIDTH, HALF_X, MID_Y, GOAL_DEPTH, PENALTY_AREA, GOAL_AREA, PENALTY_SPOT_DIST,
  CIRCLE_RADIUS, CORNER_RADIUS, POSTS, LANE_EDGES, LANE_NAMES, THIRD_EDGES, THIRD_NAMES, ZONE_14,
  laneOf, thirdOf, clampToPitch,
} from '../engine/pitch.js';
import { ROLE_INFO, parsePlayerId } from '../engine/roles.js';
import { fieldImage } from './heatmap.js';

export const BOARD_DEFAULTS = Object.freeze({
  minHitPx: 44, // [S] WCAG 2.2 2.5.5 (R10): a token you can drag or tap is at least this wide to hit, however small it is drawn
  aidFar: 15, // [D] metres: the glow aid is at its faintest this far from its target (and brightens as YOU gets closer)...
  aidBands: Object.freeze({ hot: 2.5, warm: 6, cool: 11 }), // [D] ...and warms through these bands (metres from the target)
  hint: Object.freeze({ inMs: 350, dragMs: 1100, holdMs: 500, backMs: 260, outMs: 260 }), // [D] the worked-example hand's beats
  handSize: 4.2, // [D] metres the hand is drawn tall at life size (it grows with the tokens on a small board)...
  handMinPx: 56, // [D] ...and never less than this many CSS px tall (a big board draws the pitch small per metre)
  margin: 3, // [S] ARCHITECTURE §5.8: viewBox margin around the pitch, metres
  portraitMaxWidth: 600, // [S] ARCHITECTURE §5.8: 'auto' goes vertical in a portrait container narrower than this (CSS px)
  tokenRadius: 1.8, // [D] metres at life size; a small board draws tokens bigger (minTokenPx)
  minTokenPx: 22, // [D] CSS px: a player token is drawn at least this wide, so its shirt label stays readable on a phone...
  maxTokenScale: 1.8, // [D] ...but never more than this many times life size (bigger tokens would hide the team's shape)
  minLabelPx: 11, // [D] CSS px: pitch and marker labels (1.5 m text at life size) grow to stay this tall...
  maxLabelScale: 2, // [D] ...up to this many times life size
  playerLabelPx: 16, // [S] R6 (body text 16 px or more): Player mode (labels: 'number') keeps pitch labels this tall...
  playerMaxLabelScale: 3.6, // [D] ...up to this many times life size (a phone showing the whole pitch: about 3 px per metre)
  playerTagPx: 14, // [D] Player mode: the text of YOUR name tag at least this tall (the tag grows round it)...
  maxTagScale: 3, // [D] ...up to this many times the size the token alone would draw it
  ballRadius: 0.8, // [D] metres (drawn larger than life so it can be seen and grabbed; grows with the tokens)
  grabRadius: 4, // [D] metres: pressing this close to a draggable token picks it up (forgiving on touch; never less than the drawn token)
  dragSlopPx: 6, // [D] CSS px of movement before a press becomes a drag; less is a tap
  touchOffsetPx: 44, // [D] CSS px the token floats above a finger during a long touch drag, so it stays visible...
  touchLiftMaxM: 4, // [D] ...but never more than this many metres (on a phone 44 px is 10-14 m of pitch)
  touchLiftAfterPx: 24, // [D] CSS px of finger travel before the lift starts: a small corrective drag moves the token by exactly the finger's move
  touchLiftMs: 150, // [D] the lift eases in over this long, so the token never jumps
  focusMinPxPerM: 5.5, // [D] setFocus crops the pitch length only when the whole pitch would draw at fewer px per metre (portrait phones)
  focusPad: 6, // [D] metres of pitch kept beyond each end of the focus
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

/** CSS px per metre when viewBox `vb` is drawn into a `box` of CSS px (preserveAspectRatio meet); 0 unmeasured. */
export function pxPerMetre(box, vb) {
  return box?.width > 0 && box?.height > 0 && vb?.width > 0 && vb?.height > 0 ? Math.min(box.width / vb.width, box.height / vb.height) : 0;
}

/**
 * How much bigger than life to draw the tokens at `pxPerM`, so a player token is at least minTokenPx across
 * (1 on a big board; capped at maxTokenScale). Rounded to 0.01 so a 1 px resize does not redraw every token.
 */
export function tokenScale(pxPerM, P = BOARD_DEFAULTS) {
  if (!(pxPerM > 0)) return 1;
  const k = Math.min(P.maxTokenScale, Math.max(1, P.minTokenPx / (2 * P.tokenRadius * pxPerM)));
  return Math.round(k * 100) / 100;
}

/** The same for pitch and marker labels (1.5 m text at life size, at least minLabelPx tall, capped at maxLabelScale). */
export function labelScale(pxPerM, P = BOARD_DEFAULTS) {
  if (!(pxPerM > 0)) return 1;
  const k = Math.min(P.maxLabelScale, Math.max(1, P.minLabelPx / (1.5 * pxPerM)));
  return Math.round(k * 100) / 100;
}

/** Player mode's label sizes (pitch and marker labels at least playerLabelPx tall): BOARD_DEFAULTS with those minimums. */
export const playerLabelParams = (P = BOARD_DEFAULTS) => ({ ...P, minLabelPx: P.playerLabelPx, maxLabelScale: P.playerMaxLabelScale });

/**
 * How much bigger YOUR name tag is drawn than the token alone would draw it (its text is 1.15 m tall at life size, on
 * a token drawn `tokenK` times life size): 1 in Coach mode; in Player mode enough for playerTagPx, capped at maxTagScale.
 * Rounded to 0.01.
 */
export function tagScale(pxPerM, tokenK = 1, { player = false } = {}, P = BOARD_DEFAULTS) {
  if (!player || !(pxPerM > 0)) return 1;
  const k = Math.min(P.maxTagScale, Math.max(1, P.playerTagPx / (1.15 * (tokenK || 1) * pxPerM)));
  return Math.round(k * 100) / 100;
}

/**
 * The viewBox for a board of `box` CSS px that should show the pitch length from focus.x0 to focus.x1 (world
 * metres). A board that draws the whole pitch at focusMinPxPerM or more, or no focus, shows the whole pitch.
 * Otherwise (a phone held upright) the full width stays in view and the LENGTH is cropped to what fills the
 * box at that scale, so everything draws bigger: the window keeps focusPad metres beyond the focus, reaches
 * back to our goal line when that still fits (the reference for "goal-side"), else centres on the focus (so
 * play near their goal shows their goal line), and grows (zooming out, up to the whole pitch) when the focus
 * is longer than the box allows.
 * @param {'horizontal'|'vertical'} orientation
 * @param {{width:number, height:number}} box
 * @param {{x0:number, x1:number}|null} focus
 * @returns {{x:number, y:number, width:number, height:number}}
 */
export function focusViewBox(orientation, box, focus, P = BOARD_DEFAULTS) {
  const full = viewBoxFor(orientation, P.margin);
  if (!focus || !Number.isFinite(focus.x0) || !Number.isFinite(focus.x1) || !(box?.width > 0 && box?.height > 0)) return full;
  if (pxPerMetre(box, full) >= P.focusMinPxPerM) return full;
  const vertical = orientation === 'vertical';
  const across = vertical ? full.width : full.height; // the pitch width (plus margins) always stays in view
  const along = vertical ? full.height : full.width;
  const scale = (vertical ? box.width : box.height) / across;
  const fits = (vertical ? box.height : box.width) / scale; // metres of length that fill the box at that scale
  if (fits >= along) return full;
  const f0 = Math.min(focus.x0, focus.x1) - P.focusPad, f1 = Math.max(focus.x0, focus.x1) + P.focusPad;
  const L = Math.min(along, Math.max(fits, f1 - f0));
  const lo = -P.margin, hi = LENGTH + P.margin;
  // Our goal line when it fits in with the play; otherwise centred on the play (clamped to the pitch).
  const w0 = lo + L >= f1 ? lo : Math.max(lo, Math.min(hi - L, (f0 + f1) / 2 - L / 2));
  const r = (n) => Math.round(n * 100) / 100;
  // World x runs up the screen in the vertical layout (view y = LENGTH - x) and across it otherwise.
  return vertical
    ? { x: full.x, y: r(LENGTH - (w0 + L)), width: full.width, height: r(L) }
    : { x: r(w0), y: full.y, width: r(L), height: full.height };
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

/** The tag drawn over the learner's token: `label` in capitals (a nickname, at most 12 characters), else 'YOU';
 *  `width` (metres) grows with the text so a longer name still fits its pill. */
export function youTag(label) {
  const text = String(label ?? '').trim().toLocaleUpperCase().slice(0, 12) || 'YOU';
  return { text, width: Math.max(4.6, Math.round((0.84 * [...text].length + 1.5) * 100) / 100) };
}

/** Accessible name for a token. */
export function tokenName(id, learnerId) {
  if (id === BALL_ID) return 'Ball';
  const { team, role } = parsePlayerId(id);
  const label = ROLE_INFO[role]?.label ?? role;
  if (id === learnerId) return `You (${label})`;
  return `${team === 'us' ? 'Teammate' : 'Opponent'}: ${label}`;
}

/** Player mode's shirt numbers (docs/KID_REDESIGN.md §5): one per position, the same for both teams. */
export const SHIRT_NUMBERS = Object.freeze(Object.fromEntries(Object.entries(ROLE_INFO).map(([role, info]) => [role, info.num])));

/**
 * A player's shirt number in Player mode (pure): the position's number (§5), except that YOU wear your own kit number
 * (`youNumber`, chosen in "Make it yours") and the teammate whose position has that number wears yours in exchange,
 * so no two players on a team ever share a number (pick 7 as a left back: YOU are 7, our right winger 3). Their team
 * keeps its numbers. The ball has none (null).
 * @param {string} id  a player id ('us-RW')
 * @param {{ learnerId?: string|null, youNumber?: number|null }} [opts]
 * @returns {number|null}
 */
export function shirtNumberOf(id, { learnerId = null, youNumber = null } = {}) {
  if (id === BALL_ID || typeof id !== 'string' || !id.includes('-')) return null;
  const { team, role } = parsePlayerId(id);
  const own = SHIRT_NUMBERS[role] ?? null;
  if (!Number.isInteger(youNumber) || typeof learnerId !== 'string' || !learnerId.includes('-')) return own;
  if (id === learnerId) return youNumber;
  const me = parsePlayerId(learnerId);
  return team === me.team && own === youNumber ? SHIRT_NUMBERS[me.role] ?? null : own;
}

/**
 * The text on a token: its role code ('role', Coach mode: LCB, 6, 9...) or its shirt number ('number', Player mode:
 * GK 1, RB 2, LB 3, LCB 4, RCB 5, DM 6, RW 7, LCM 8, ST 9, RCM 10, LW 11; with YOUR kit number swapped in, see
 * shirtNumberOf). The ball has none.
 * @param {{ learnerId?: string|null, youNumber?: number|null }} [you]  number mode: whose kit number to swap in
 */
export function tokenLabel(id, mode = 'role', you = {}) {
  if (id === BALL_ID || typeof id !== 'string') return '';
  const { role } = parsePlayerId(id);
  if (mode === 'number') { const n = shirtNumberOf(id, you ?? {}); return n === null ? '' : String(n); }
  return ROLE_INFO[role]?.short ?? role;
}

/** Player mode's accessible name for a token: no role codes, just "You", "Teammate, number 4", "Opponent, number 9"
 *  (the number on the shirt: shirtNumberOf, with YOUR kit number swapped in when `youNumber` is given). */
export function simpleTokenName(id, learnerId, youNumber = null) {
  if (id === BALL_ID) return 'Ball';
  if (id === learnerId) return 'You';
  const { team } = parsePlayerId(id);
  const n = shirtNumberOf(id, { learnerId, youNumber });
  return `${team === 'us' ? 'Teammate' : 'Opponent'}${n === null ? '' : `, number ${n}`}`;
}

/**
 * What a tap (a press and release without a drag) does on a board with draggable tokens (pure).
 *   Nothing armed: a tap that picked up a token (`pressed`, within the forgiving grab area) arms it for tap-then-tap.
 *     With tap-to-move on (Player mode), only a tap on the drawn token itself arms it; a tap anywhere else, its name
 *     tag and the grab area around it included, moves the token there (a tap just above YOU is a step forward,
 *     never a pick-up that Lock it would then lock at the start).
 *   A token armed: a tap on it disarms it, a tap on another draggable token arms that one, a tap anywhere else (however
 *     close) moves the armed token there.
 * @param {{ armed?: string|null, pressed?: string|null, tapToMove?: string|null, onBody?: (id: string) => boolean }} m
 *   onBody(id): is the tap on that token's drawn body?
 * @returns {{ kind: 'arm'|'disarm'|'move'|'none', id?: string }}
 */
export function tapAction({ armed = null, pressed = null, tapToMove = null, onBody = () => false } = {}) {
  if (!armed) {
    if (pressed && (!tapToMove || onBody(pressed))) return { kind: 'arm', id: pressed };
    return tapToMove ? { kind: 'move', id: tapToMove } : { kind: 'none' };
  }
  if (onBody(armed)) return { kind: 'disarm', id: armed };
  if (pressed && pressed !== armed && onBody(pressed)) return { kind: 'arm', id: pressed };
  return { kind: 'move', id: armed };
}

/** Player mode's plain-words position (no metres, no lanes): "in our half, on the left", "near their goal, in the middle". */
export function describeSpotSimple(p) {
  if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return '';
  const end = p.x <= PENALTY_AREA.depth ? 'near our goal' : p.x >= LENGTH - PENALTY_AREA.depth ? 'near their goal' : p.x < HALF_X ? 'in our half' : 'in their half';
  const side = p.y < WIDTH / 3 ? 'on the left' : p.y > (2 * WIDTH) / 3 ? 'on the right' : 'in the middle';
  return `${end}, ${side}`;
}

/** Radius (metres) a token can be hit within: at least its drawn radius, and at least minHitPx / 2 CSS px across on a small board. */
export function hitRadius(pxPerM, drawnM, P = BOARD_DEFAULTS) {
  const min = pxPerM > 0 ? P.minHitPx / 2 / pxPerM : 0;
  return Math.max(drawnM > 0 ? drawnM : 0, min);
}

/** The glow aid's band for a distance (metres) from its target: 'hot' | 'warm' | 'cool' | 'cold'. */
export function aidLevel(d, P = BOARD_DEFAULTS) {
  if (!Number.isFinite(d)) return 'cold';
  const B = P.aidBands;
  return d <= B.hot ? 'hot' : d <= B.warm ? 'warm' : d <= B.cool ? 'cool' : 'cold';
}

/** How bright the glow aid is (0 far away .. 1 on the target), linear over aidFar metres; rounded to 0.05 (fewer redraws). */
export function aidStrength(d, P = BOARD_DEFAULTS) {
  if (!Number.isFinite(d)) return 0;
  const k = Math.max(0, Math.min(1, 1 - d / P.aidFar));
  return Math.round(k * 20) / 20;
}

const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const lerpV = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });

/** Total length (ms) of the worked-example hand. */
export const hintTotalMs = (H = BOARD_DEFAULTS.hint) => H.inMs + H.dragMs + H.holdMs + H.backMs + H.outMs;

/**
 * The worked-example hand at `ms` (pure): where the hand and YOU are drawn, how visible the hand is and whether it
 * presses. Beats: the hand appears on YOU and presses (in), drags YOU to `to` (drag), holds there (hold), YOU snaps
 * back to `from` while the hand lifts (back), and the hand fades (out).
 * @returns {{ hand: {x:number,y:number}, token: {x:number,y:number}, opacity: number, pressed: boolean, done: boolean }}
 */
export function hintPose(ms, from, to, H = BOARD_DEFAULTS.hint) {
  const t = Math.max(0, Number(ms) || 0);
  const a = H.inMs, b = a + H.dragMs, c = b + H.holdMs, d = c + H.backMs, e = d + H.outMs;
  if (t < a) return { hand: { ...from }, token: { ...from }, opacity: Math.min(1, t / Math.max(1, a * 0.6)), pressed: t > a * 0.6, done: false };
  if (t < b) { const p = lerpV(from, to, easeInOut((t - a) / H.dragMs)); return { hand: p, token: { ...p }, opacity: 1, pressed: true, done: false }; }
  if (t < c) return { hand: { ...to }, token: { ...to }, opacity: 1, pressed: true, done: false };
  if (t < d) return { hand: { ...to }, token: lerpV(to, from, easeInOut((t - c) / H.backMs)), opacity: 1 - 0.4 * ((t - c) / H.backMs), pressed: false, done: false };
  if (t < e) return { hand: { ...to }, token: { ...from }, opacity: 0.6 * (1 - (t - d) / H.outMs), pressed: false, done: false };
  return { hand: { ...to }, token: { ...from }, opacity: 0, pressed: false, done: true };
}

/** True when the device or the page (settings: data-reduced-motion) asks for reduced motion. */
function prefersReducedMotion(win) {
  try {
    if (win?.document?.documentElement?.dataset?.reducedMotion === 'true') return true;
    return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const isVec = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);

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
 * @param {{ orientation?: 'auto'|'horizontal'|'vertical', params?: object, youLabel?: string, labels?: 'role'|'number',
 *   youNumber?: number|null }} [opts]
 *   youLabel: the tag over the learner (default 'YOU'; the app passes the learner's nickname); render() can change it
 *   labels: what the tokens show by default: role codes (Coach mode) or unique shirt numbers (Player mode, §5)
 *   youNumber: in number mode, the number on YOUR token (a chosen kit number; default: the position's number)
 */
export function createBoard(container, { orientation = 'auto', params, youLabel = 'YOU', labels = 'role', youNumber = null } = {}) {
  const P = { ...BOARD_DEFAULTS, ...params };
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const uid = `board${Math.random().toString(36).slice(2, 8)}`;
  const defaultLabels = labels === 'number' ? 'number' : 'role';

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

  // The aid ring on YOU (setAid) sits under the markers; it is its own group, so setMarkers never clears it.
  const aidLayer = svgEl(doc, 'g', { class: 'board-aid-layer' }, world);
  world.insertBefore(aidLayer, markersW);
  const aidEl = svgEl(doc, 'circle', { class: 'board-aid', display: 'none' }, aidLayer);

  const view = svgEl(doc, 'g', { class: 'board-view' }, svg);
  const overlayLabels = svgEl(doc, 'g', { class: 'board-overlay-labels' }, view);
  const tokenLayer = svgEl(doc, 'g', { class: 'board-tokens' }, view);
  const targetLayer = svgEl(doc, 'g', { class: 'board-targets' }, view);
  const markerLabels = svgEl(doc, 'g', { class: 'board-marker-labels' }, view);
  const handLayer = svgEl(doc, 'g', { class: 'board-hand-layer', 'aria-hidden': 'true' }, view);

  container.appendChild(root);

  // ---- state
  let requested = orientation;
  let orient = 'horizontal';
  let focus = null; // { x0, x1 } pitch length a mode wants in view (setFocus), or null
  let focusForced = false; // setFocus(…, { force: true }): crop even a board big enough to show the whole pitch
  let vb = null; // current viewBox { x, y, width, height }
  let pxm = 0; // CSS px per metre as drawn
  let scale = 1; // tokens (and the ghost, and rings bound to tokens) are drawn this much bigger than life
  let lscale = 1; // pitch and marker labels likewise (CSS --board-label-k)
  let tagK = 1; // YOUR name tag, this much bigger again than the token draws it (Player mode: tagScale)
  const player = defaultLabels === 'number'; // Player mode's sizes: labels and YOUR tag big enough to read on a phone
  const LP = player ? playerLabelParams(P) : P;
  let ghostAt = null;
  let you = youTag(youLabel); // { text, width } of the learner's tag
  let opts = { learnerId: null, highlight: [], labels: defaultLabels, dimOthers: false };
  let labelMode = defaultLabels; // 'role' | 'number': what the token text says ('none' hides it with a class)
  let youNum = Number.isInteger(youNumber) ? youNumber : null; // number mode: YOUR shirt number, else the position's
  let lastRenderAt = -Infinity;
  const tokens = new Map(); // id → token record (players and the ball)
  let overlays = { thirds: false, lanes: false, zone14: false, offsideLine: null, backLine: null };
  let markers = [];
  let boundRings = []; // { el, id } rings that follow a token
  const drag = { enabled: false, ids: new Set(), onMove: null, onEnd: null, tapToMove: null, onArm: null };
  let active = null; // current pointer gesture
  let armed = null; // id selected by a tap (two-tap move)
  let spotlight = null; // Set of ids drawn at full strength (setSpotlight), or null: everyone
  const targets = { enabled: false, ids: [], onTap: null, onPreview: null, labelFor: null, previewed: null, els: new Map() };
  let aid = null; // { kind: 'glow', target } | { kind: 'heat', level } (setAid)
  let aidKey = '';
  let handRun = null; // the running worked-example hand: { finish() }

  /** Accessible name and plain position of a token, in the board's wording (number mode: no codes, no metres). */
  const nameOf = (id) => (labelMode === 'number' ? simpleTokenName(id, opts.learnerId, youNum) : tokenName(id, opts.learnerId));
  const spotText = (p) => (labelMode === 'number' ? describeSpotSimple(p) : describeSpot(p));
  // Number mode: YOUR kit number on YOU, and the teammate who had it wears YOUR position's number (shirtNumberOf).
  const labelOf = (id) => tokenLabel(id, labelMode, { learnerId: opts.learnerId, youNumber: youNum });
  const codeClass = (s) => (s.length > 2 ? 'token-code token-code--long' : s.length < 2 ? 'token-code token-code--one' : 'token-code');

  // ---- tokens
  /** Write the current learner tag (text and pill width) into a token's tag group. */
  function drawYouTag(tag) {
    const rect = tag.querySelector('rect'), text = tag.querySelector('text');
    rect.setAttribute('x', f3(-you.width / 2));
    rect.setAttribute('width', f3(you.width));
    text.textContent = you.text;
  }

  /** Where the tag sits (in the token's units): above the token, drawn tagK times its life size (Player mode). */
  const tagCentre = () => -(P.tokenRadius + 1.15 + 1.05 * tagK);
  const tagTransform = () => `translate(0 ${f3(tagCentre())})${tagK === 1 ? '' : ` scale(${tagK})`}`;
  function placeYouTag(tag) {
    const tx = tagTransform();
    if (tag.getAttribute('transform') !== tx) tag.setAttribute('transform', tx);
  }

  function setYouLabel(label) {
    const next = youTag(label);
    if (next.text === you.text) return;
    you = next;
    for (const t of tokens.values()) {
      const tag = t.g.querySelector('.token-you');
      if (tag) drawYouTag(tag);
    }
  }

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
      const R = P.tokenRadius;
      // Invisible: how far a press still counts as on this token (sized in syncHit), so the token's box is the size of
      // what you can hit (at least minHitPx across).
      t.hit = svgEl(doc, 'circle', { class: 'token-hit', r: R, fill: 'none', stroke: 'none' }, g);
      svgEl(doc, 'circle', { class: 'token-glow', r: R + 1.5 }, g);
      svgEl(doc, 'circle', { class: 'token-ring', r: R + 0.75 }, g);
      svgEl(doc, 'circle', { class: 'token-carrier', r: R + 0.45 }, g);
      svgEl(doc, 'circle', { class: 'token-body', r: R }, g);
      const text = labelOf(id);
      t.code = svgEl(doc, 'text', { class: codeClass(text), 'text-anchor': 'middle', dy: '0.36em' }, g);
      t.code.textContent = text;
      t.label = text;
      const tag = svgEl(doc, 'g', { class: 'token-you', transform: tagTransform() }, g);
      svgEl(doc, 'rect', { y: -1.05, height: 2.1, rx: 1.05 }, tag);
      svgEl(doc, 'text', { 'text-anchor': 'middle', dy: '0.36em' }, tag);
      drawYouTag(tag);
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
    const tx = transformAt(p);
    if (tx !== t.tx) { t.g.style.transform = tx; t.tx = tx; }
    if (drag.ids.has(t.id)) {
      const aria = `${nameOf(t.id)}, ${spotText(p)}`;
      if (aria !== t.aria) { t.g.setAttribute('aria-label', aria); t.aria = aria; }
    }
  }

  /** The CSS transform that draws a token (or anything token-sized) at world point p. */
  function transformAt(p) {
    const v = project(p, orient);
    return `translate(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px)${scale === 1 ? '' : ` scale(${scale})`}`;
  }

  /** Keep a token's text in step with the label mode (role codes or shirt numbers). Cached: cheap per render. */
  function syncLabel(t) {
    if (!t.code) return;
    const text = labelOf(t.id);
    if (text === t.label) return;
    t.label = text;
    t.code.textContent = text;
    t.code.setAttribute('class', codeClass(text));
  }

  /** Spotlight: tokens outside it are drawn at 40 % (the learner and the ball are always lit). */
  function syncSpot(t) {
    const off = !!spotlight && t.id !== BALL_ID && t.id !== opts.learnerId && !spotlight.has(t.id);
    if (off === !!t.unlit) return;
    t.unlit = off;
    t.g.classList.toggle('is-unlit', off);
  }

  function setFlags(t, flags) {
    const key = flags.join(' ');
    if (key === t.flags) return;
    for (const c of t.flags.split(' ')) if (c && !flags.includes(c)) t.g.classList.remove(c);
    for (const c of flags) t.g.classList.add(c);
    t.flags = key;
  }

  /** A draggable token's hit circle covers minHitPx on a small board (in the token's own, scaled units). */
  function syncHit(t) {
    if (!t.hit) return;
    const on = drag.enabled && drag.ids.has(t.id);
    const r = on ? f3(hitRadius(pxm, (P.tokenRadius + 0.5) * scale, P) / (scale || 1)) : P.tokenRadius;
    if (t.hit.getAttribute('r') !== String(r)) t.hit.setAttribute('r', r);
  }

  function syncDraggable(t) {
    syncHit(t);
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
    opts = { learnerId: null, highlight: [], labels: defaultLabels, dimOthers: false, ...nextOpts };
    if (nextOpts.youLabel !== undefined) setYouLabel(nextOpts.youLabel);
    if (nextOpts.youNumber !== undefined) youNum = Number.isInteger(nextOpts.youNumber) ? nextOpts.youNumber : null;
    if (opts.labels === 'role' || opts.labels === 'number') labelMode = opts.labels; // 'none' keeps the text, hidden
    const now = win?.performance?.now?.() ?? Date.now();
    root.classList.toggle('is-live', now - lastRenderAt < P.liveMs);
    lastRenderAt = now;
    root.classList.toggle('no-labels', opts.labels === 'none');
    root.classList.toggle('is-numbered', labelMode === 'number');
    if (!frame) {
      for (const t of tokens.values()) t.g.setAttribute('display', 'none');
      placeTargets();
      updateAid();
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
      syncLabel(t);
      syncSpot(t);
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
    placeTargets();
  }

  // ---- spotlight (Player mode: YOU, the ball and a few key players lit; the rest at 40 %)
  /** @param {string[]|Set<string>|null} ids  tokens to keep at full strength (YOU and the ball always are); null = all */
  function setSpotlight(ids = null) {
    spotlight = ids && typeof ids[Symbol.iterator] === 'function' && typeof ids !== 'string' ? new Set(ids) : null;
    root.classList.toggle('has-spotlight', !!spotlight);
    for (const t of tokens.values()) syncSpot(t);
  }

  // ---- ghost, zone, heatmap
  function setGhost(p) {
    ghostAt = p ? { x: p.x, y: p.y } : null;
    if (!p) { ghostEl.setAttribute('display', 'none'); return; }
    const wasHidden = ghostEl.hasAttribute('display');
    ghostEl.removeAttribute('display');
    // The ring matches the drawn token size (scale), so "stand here" reads at a glance on a phone too.
    const transform = `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px)${scale === 1 ? '' : ` scale(${scale})`}`;
    if (wasHidden) {
      // Appear in place: without this the transition runs from the pitch corner (transform: none).
      ghostEl.style.transition = 'none';
      ghostEl.style.transform = transform;
      ghostEl.getBoundingClientRect?.(); // commit the jump before the transition comes back
      ghostEl.style.transition = '';
    } else ghostEl.style.transform = transform;
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
        // Vertical: the lanes run up the screen and the names across it, so the half-spaces get a row of their
        // own (a name wider than its lane, as on a phone, then never runs into the next one).
        if (orient === 'vertical') text({ x: HALF_X + 2 + (i % 2 ? 2.2 * lscale + 1 : 0), y: ym }, names[i], 'ov-label--lanes');
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
    // Extra (optional): m.cls adds classes of the caller's own (Player mode styles its rings and labels with them).
    const extra = typeof m.cls === 'string' && /^[\w\s-]+$/.test(m.cls) ? ` ${m.cls.trim()}` : '';
    const cls = (base) => `mk ${base} tone-${tone}${extra}`;
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
        if (m.label) {
          const a = project(from, orient), b = project(to, orient);
          if (Math.abs(b.y - a.y) > Math.abs(b.x - a.x)) drawTailLabel(a, b, m.label, tone);
          else drawLabel({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, m.label, tone);
        }
        return;
      }
      case 'segment':
      case 'line-x': {
        const a = m.type === 'line-x' ? { x: m.x, y: 0 } : m.a;
        const b = m.type === 'line-x' ? { x: m.x, y: WIDTH } : m.b;
        if (!a || !b) return;
        svgEl(doc, 'line', { class: cls(m.dashed === false ? 'mk-segment' : 'mk-segment mk-dashed'), x1: f3(a.x), y1: f3(a.y), x2: f3(b.x), y2: f3(b.y) }, markersW);
        // Extra (optional): labelAt puts the label there (a world point) instead of the middle of the line.
        if (m.label) drawLabel(isVec(m.labelAt) ? m.labelAt : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, m.label, tone, 0, extra, { clear: m.clear === 'you' });
        return;
      }
      case 'ring':
      case 'player':
      case 'point': {
        const at = m.at ?? (Number.isFinite(m.x) ? { x: m.x, y: m.y } : null);
        const r = m.r ?? (m.id === BALL_ID ? P.ballRadius + 1.4 : P.tokenRadius + 1.3);
        const el = svgEl(doc, 'circle', { class: cls(m.pulse === false ? 'mk-ring' : 'mk-ring mk-pulse'), r: f3(r) }, markersW);
        // A ring round a token grows with the drawn token (scale); a ring at a point marks an area in metres.
        if (m.id) boundRings.push({ el, id: m.id, r });
        else if (at) { el.setAttribute('cx', f3(at.x)); el.setAttribute('cy', f3(at.y)); }
        else el.remove();
        if (m.label && at) drawLabel({ x: at.x, y: at.y }, m.label, tone, r, extra);
        return;
      }
      case 'label':
        // Extra (optional): lift raises the text by that many metres, or by a drawn token ('token': clears a
        // token or the best-spot ring at that point, whatever the board's token scale); below: true writes it under
        // the point instead; clear: 'you' (Player mode) moves it off YOU and YOUR name tag: the side asked for, else
        // the other side, else right or left of the point, whichever covers neither (and stays in view).
        if (m.at && m.text) {
          const lift = m.lift === 'token' ? (P.tokenRadius + 0.6) * scale : Number.isFinite(m.lift) ? m.lift : 0;
          drawLabel(m.at, m.text, tone, lift, extra, { below: m.below === true, clear: m.clear === 'you' });
        }
        return;
      default:
    }
  }

  function drawLabel(at, text, tone, lift = 0, extra = '', { below = false, clear = false } = {}) {
    const v = project(at, orient);
    const t = svgEl(doc, 'text', { class: `mk-label tone-${tone}${extra}`, 'text-anchor': 'middle' }, markerLabels);
    t.textContent = String(text);
    // Where the text goes around the point: its baseline above it, under it by the lift and the text's cap height
    // (1.5 m tall text), or level with it (the middle of the text) to its right or left. Above or below, it is centred
    // on the point, or ('away') starts at the point and runs away from YOU.
    const youV = clear ? youView() : null;
    const away = youV && youV.x > v.x ? 'end' : 'start'; // YOU to the right: the text ends at the point, running left
    const place = (where) => {
      const [spot, shift] = where.split('-');
      const side = spot === 'right' || spot === 'left';
      const x = spot === 'right' ? v.x + lift + 0.6 : spot === 'left' ? v.x - lift - 0.6 : shift ? v.x + (away === 'end' ? 1 : -1) * 0.6 * lift : v.x;
      const y = spot === 'below' ? v.y + lift + 0.5 + 1.1 * lscale : side ? v.y + 0.55 * lscale : v.y - lift - 0.8;
      t.setAttribute('x', f3(x));
      t.setAttribute('y', f3(y));
      t.setAttribute('text-anchor', spot === 'right' ? 'start' : spot === 'left' ? 'end' : shift ? away : 'middle');
      if (!side && !shift) keepInView(t, x);
    };
    const order = below ? ['below', 'below-away', 'above', 'above-away', 'right', 'left'] : ['above', 'above-away', 'below', 'below-away', 'right', 'left'];
    const avoid = clear ? youBoxes() : [];
    if (!avoid.length) { place(order[0]); return; }
    let best = order[0], cost = Infinity;
    for (const where of order) {
      place(where);
      const c = coverCost(boxOf(t), avoid);
      if (c === null) { best = order[0]; break; } // not rendered (a hidden board): the side asked for
      if (c < cost) { cost = c; best = where; }
      if (c === 0) break;
    }
    place(best);
  }

  /** Where YOU are drawn, in view units (null: no learner on the board). */
  function youView() {
    const t = opts.learnerId ? tokens.get(opts.learnerId) : null;
    return t?.pos && t.g.getAttribute('display') !== 'none' ? project(t.pos, orient) : null;
  }

  /** YOUR token and name tag as boxes in view units (what a label written with clear: 'you' must not cover). */
  function youBoxes() {
    const v = youView();
    if (!v) return [];
    const r = (P.tokenRadius + 0.75) * scale;
    const cy = v.y + tagCentre() * scale, hw = (you.width / 2) * tagK * scale, hh = 1.05 * tagK * scale;
    return [{ x0: v.x - r, x1: v.x + r, y0: v.y - r, y1: v.y + r }, { x0: v.x - hw, x1: v.x + hw, y0: cy - hh, y1: cy + hh }];
  }

  /** A drawn text's box in view units, or null when it is not rendered. */
  function boxOf(node) {
    let b = null;
    try { b = node.getBBox?.() ?? null; } catch { b = null; }
    return b && b.width > 0 ? { x0: b.x, x1: b.x + b.width, y0: b.y, y1: b.y + b.height } : null;
  }

  /** How much a label box covers the boxes to avoid, plus how much of it falls outside the view (area, view units²). */
  function coverCost(box, avoid) {
    if (!box) return null;
    const over = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    const outside = vb ? area - over(box, { x0: vb.x, x1: vb.x + vb.width, y0: vb.y, y1: vb.y + vb.height }) : 0;
    return avoid.reduce((a, b) => a + over(box, b), 0) + outside;
  }

  /** The label of an arrow that runs up or down the screen: just past its tail, lined up with the arrow and
   *  running away from the nearer touchline, so the text never lies across the arrow or the players beside it. */
  function drawTailLabel(tail, head, text, tone) {
    const cx = vb ? vb.x + vb.width / 2 : tail.x;
    const left = tail.x <= cx;
    const down = head.y < tail.y ? 1 : -1; // the arrow points up: the label goes below its tail
    const t = svgEl(doc, 'text', {
      class: `mk-label tone-${tone}`, x: f3(tail.x + (left ? -0.6 : 0.6)), y: f3(tail.y + down * 1.2), 'text-anchor': left ? 'start' : 'end',
      'dominant-baseline': down > 0 ? 'hanging' : 'auto',
    }, markerLabels);
    t.textContent = String(text);
  }

  /** Slide a centred label sideways so it stays inside the view (labels grow on small boards). */
  function keepInView(node, x) {
    if (!vb) return;
    let w = 0;
    try { w = node.getComputedTextLength?.() ?? 0; } catch { w = 0; }
    if (!(w > 0)) return; // not rendered (hidden board, tests): leave it centred
    const lo = vb.x + w / 2 + 0.4, hi = vb.x + vb.width - w / 2 - 0.4;
    const nx = lo > hi ? vb.x + vb.width / 2 : Math.min(hi, Math.max(lo, x));
    if (Math.abs(nx - x) > 0.01) node.setAttribute('x', f3(nx));
  }

  function updateBoundRings() {
    for (const { el, id, r } of boundRings) {
      const t = tokens.get(id);
      const visible = t?.pos && t.g.getAttribute('display') !== 'none';
      if (!visible) { el.setAttribute('display', 'none'); continue; }
      el.removeAttribute('display');
      el.setAttribute('cx', f3(t.pos.x));
      el.setAttribute('cy', f3(t.pos.y));
      const rr = f3(r * scale);
      if (el.getAttribute('r') !== String(rr)) el.setAttribute('r', rr);
    }
    updateAid();
  }

  // ---- the aid ring on YOU (Player mode): 'glow' warms and brightens as YOU nears its target; 'heat' shows a given level
  /** @param {{ kind: 'glow', target: {x:number,y:number} } | { kind: 'heat', level: 'hot'|'warm'|'cool'|'cold' } | null} next */
  function setAid(next = null) {
    if (next?.kind === 'glow' && isVec(next.target)) aid = { kind: 'glow', target: { x: next.target.x, y: next.target.y } };
    else if (next?.kind === 'heat' && ['hot', 'warm', 'cool', 'cold'].includes(next.level)) aid = { kind: 'heat', level: next.level };
    else aid = null;
    updateAid();
  }

  function updateAid() {
    const t = aid && opts.learnerId ? tokens.get(opts.learnerId) : null;
    if (!t?.pos || t.g.getAttribute('display') === 'none') {
      if (aidKey !== 'off') { aidEl.setAttribute('display', 'none'); aidKey = 'off'; }
      return;
    }
    const d = aid.kind === 'glow' ? Math.hypot(t.pos.x - aid.target.x, t.pos.y - aid.target.y) : NaN;
    const level = aid.kind === 'glow' ? aidLevel(d, P) : aid.level;
    const k = aid.kind === 'glow' ? aidStrength(d, P) : 1;
    const r = f3((P.tokenRadius + 1.3) * scale);
    const key = `${f3(t.pos.x)},${f3(t.pos.y)},${r},${level},${k},${aid.kind}`;
    if (key === aidKey) return;
    aidKey = key;
    aidEl.removeAttribute('display');
    aidEl.setAttribute('cx', f3(t.pos.x));
    aidEl.setAttribute('cy', f3(t.pos.y));
    aidEl.setAttribute('r', r);
    aidEl.setAttribute('class', `board-aid aid-${aid.kind} aid-${level}`);
    aidEl.style.setProperty('--aid-k', String(k));
  }

  // ---- targets (Player mode "Who's open?"): big tap targets on tokens; the first tap previews, a second tap confirms
  /** Radius (metres) of a target: at least minHitPx across, and a little more than the drawn token. */
  const targetRadius = () => hitRadius(pxm, (P.tokenRadius + 0.9) * scale, P);

  function drawTargets() {
    targetLayer.replaceChildren();
    targets.els.clear();
    if (!targets.enabled) return;
    for (const id of targets.ids) {
      const label = targets.labelFor?.(id) || nameOf(id);
      const g = svgEl(doc, 'g', { class: 'board-target', 'data-id': id, role: 'button', tabindex: '0', 'aria-label': label, 'aria-pressed': 'false' }, targetLayer);
      svgEl(doc, 'circle', { class: 'target-hit' }, g);
      svgEl(doc, 'circle', { class: 'target-ring' }, g);
      targets.els.set(id, g);
    }
    placeTargets();
    previewTarget(targets.previewed, false);
  }

  /** Targets follow their tokens (render) and the board's scale (relayout). */
  function placeTargets() {
    if (!targets.enabled) return;
    const r = f3(targetRadius() / (scale || 1)); // in the token's own (scaled) units, so the transform's scale applies
    for (const [id, g] of targets.els) {
      const t = tokens.get(id);
      const visible = t?.pos && t.g.getAttribute('display') !== 'none';
      if (!visible) { g.setAttribute('display', 'none'); continue; }
      g.removeAttribute('display');
      const tx = transformAt(t.pos);
      if (g.style.transform !== tx) g.style.transform = tx;
      for (const c of g.children) if (c.getAttribute('r') !== String(r)) c.setAttribute('r', r);
    }
  }

  /** The target nearest `w` within its radius (by distance: a touch browser may retarget a tap). */
  function targetAt(w) {
    if (!targets.enabled || !isVec(w)) return null;
    let best = null, bd = targetRadius();
    for (const id of targets.ids) {
      const t = tokens.get(id);
      if (!t?.pos || t.g.getAttribute('display') === 'none') continue;
      const d = Math.hypot(t.pos.x - w.x, t.pos.y - w.y);
      if (d <= bd) { bd = d; best = id; }
    }
    return best;
  }

  function previewTarget(id, notify = true) {
    const next = id && targets.ids.includes(id) ? id : null;
    const changed = next !== targets.previewed;
    targets.previewed = next;
    for (const [tid, g] of targets.els) {
      const on = tid === next;
      g.classList.toggle('is-previewed', on);
      g.setAttribute('aria-pressed', String(on));
    }
    root.classList.toggle('has-preview', !!next);
    if (notify && changed) targets.onPreview?.(next);
  }

  /** A tap (or Enter / Space) on a target: preview it, or confirm it when it is already previewed. */
  function tapTarget(id) {
    if (!targets.enabled || !targets.ids.includes(id)) return;
    if (targets.previewed === id) { targets.onTap?.(id); return; }
    previewTarget(id, true);
  }

  /**
   * @param {{ ids: string[], onTap?: (id: string) => void, onPreview?: (id: string|null) => void, labelFor?: (id: string) => string }} opts
   *   labelFor (optional): the accessible name of each target (default: "Teammate, number 8" in number mode)
   */
  function enableTargets({ ids = [], onTap = null, onPreview = null, labelFor = null } = {}) {
    targets.enabled = true;
    targets.ids = [...new Set(ids)].filter((id) => typeof id === 'string' && id !== BALL_ID);
    targets.onTap = onTap;
    targets.onPreview = onPreview;
    targets.labelFor = labelFor;
    if (!targets.ids.includes(targets.previewed)) targets.previewed = null;
    root.classList.add('has-targets');
    drawTargets();
  }

  function disableTargets() {
    targets.enabled = false;
    targets.ids = [];
    targets.onTap = targets.onPreview = targets.labelFor = null;
    targets.previewed = null;
    if (active?.kind === 'target') active = null;
    root.classList.remove('has-targets', 'has-preview');
    drawTargets();
  }

  // ---- the worked-example hand (Player mode, first rep): it drags YOU to `to`, then YOU snaps back to `from`
  function drawHand() {
    // A pointing hand, fingertip at (0, 0), about 4.2 units tall; white with a dark edge so it reads on the grass.
    const g = svgEl(doc, 'g', { class: 'board-hand' }, handLayer);
    const tall = Math.max(P.handSize * scale, pxm > 0 ? P.handMinPx / pxm : 0) / (scale || 1); // in token units
    const s = tall / 24;
    const inner = svgEl(doc, 'g', { class: 'board-hand-in', transform: `scale(${f3(s)}) translate(-9 -1)` }, g);
    svgEl(doc, 'circle', { class: 'board-hand-press', cx: 9, cy: 1.5, r: 3.2 }, inner);
    svgEl(doc, 'path', {
      class: 'board-hand-shape',
      d: 'M7.4 2.6a1.6 1.6 0 0 1 3.2 0v7.1l.3-.1a1.5 1.5 0 0 1 2.9.6l.2-.1a1.5 1.5 0 0 1 2.8.8l.2-.1a1.4 1.4 0 0 1 2.6.8v4.9'
        + 'c0 3.6-2.5 6.2-6 6.2h-1.4c-2 0-3.5-.9-4.6-2.4L3.2 15a1.6 1.6 0 0 1 2.4-2.1l1.8 1.8z',
    }, inner);
    return g;
  }

  /**
   * The worked example: a hand presses YOU, drags YOU from `from` to `to`, holds, and YOU snaps back to `from`.
   * The board is controlled, so YOUR spot never changes (only how it is drawn for a moment); input is ignored meanwhile.
   * Under reduced motion (device or settings) it draws nothing and resolves at once: the caller shows the answer still.
   * @param {{ from: {x:number,y:number}, to: {x:number,y:number} }} opts
   * @returns {Promise<void>} resolves when the hand is gone (also if the page is hidden, or the board is destroyed)
   */
  function showHintHand({ from, to } = {}) {
    handRun?.finish();
    if (!isVec(from) || !isVec(to) || prefersReducedMotion(win) || !win?.requestAnimationFrame) return Promise.resolve();
    return new Promise((resolve) => {
      const H = P.hint;
      const t = opts.learnerId ? tokens.get(opts.learnerId) : null;
      const g = drawHand();
      root.classList.add('is-hinting');
      setArmed(null);
      const clock = () => win.performance?.now?.() ?? Date.now();
      const start = clock();
      let raf = 0, timer = 0, over = false;
      const finish = () => {
        if (over) return;
        over = true;
        win.cancelAnimationFrame?.(raf);
        clearTimeout(timer);
        g.remove();
        if (t) {
          t.g.style.transition = '';
          t.tx = '';
          if (t.pos) placeToken(t, t.pos); // back on the real spot
        }
        root.classList.remove('is-hinting');
        handRun = null;
        resolve();
      };
      const step = () => {
        if (over) return;
        const pose = hintPose(clock() - start, from, to, H);
        g.style.transform = transformAt(pose.hand);
        g.style.opacity = String(Math.round(pose.opacity * 100) / 100);
        g.classList.toggle('is-pressed', pose.pressed);
        if (t?.pos) {
          t.g.style.transition = 'none';
          t.g.style.transform = transformAt(pose.token);
        }
        if (pose.done) { finish(); return; }
        raf = win.requestAnimationFrame(step);
      };
      step();
      // Animation frames stall in a hidden tab: never keep the caller waiting.
      timer = setTimeout(finish, hintTotalMs(H) + 1500);
      handRun = { finish };
    });
  }

  // ---- layout: orientation, the viewBox (whole pitch, or a focus window on a small board) and the token scale
  function measure() {
    // Measure the container without our own content, so the SVG's aspect ratio can't feed back into the choice.
    root.classList.add('is-measuring');
    const w = container.clientWidth, h = container.clientHeight;
    root.classList.remove('is-measuring');
    const vw = win?.innerWidth ?? w, vh = win?.innerHeight ?? h;
    // The SVG fills the container's content box.
    let px = 0, py = 0;
    try {
      const cs = win?.getComputedStyle?.(container);
      px = (parseFloat(cs?.paddingLeft) || 0) + (parseFloat(cs?.paddingRight) || 0);
      py = (parseFloat(cs?.paddingTop) || 0) + (parseFloat(cs?.paddingBottom) || 0);
    } catch { /* no styles: no padding */ }
    return { width: w || vw, height: h > 1 ? h : vh, box: { width: Math.max(0, (w || vw) - px), height: Math.max(0, (h > 1 ? h : vh) - py) } };
  }

  function relayout(force = false) {
    const { width, height, box } = measure();
    const next = pickOrientation(requested, width, height, P);
    const turned = next !== orient;
    const nextVb = focusViewBox(next, box, focus, focusForced ? { ...P, focusMinPxPerM: Infinity } : P);
    const px = pxPerMetre(box, nextVb);
    const k = tokenScale(px, P);
    const kl = labelScale(px, LP);
    const kt = tagScale(px, k, { player }, P);
    const vbChanged = !vb || ['x', 'y', 'width', 'height'].some((key) => vb[key] !== nextVb[key]);
    pxm = px;
    if (!force && !turned && !vbChanged && k === scale && kl === lscale && kt === tagK) return;
    orient = next;
    vb = nextVb;
    scale = k;
    lscale = kl;
    tagK = kt;
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    const wt = worldTransform(orient);
    if (wt) world.setAttribute('transform', wt); else world.removeAttribute('transform');
    root.dataset.orientation = orient;
    root.style.setProperty('--board-label-k', String(kl));
    // Re-project (and re-scale) without animating tokens across the pitch.
    root.classList.add('no-anim');
    for (const t of tokens.values()) {
      syncHit(t);
      const tag = t.g.querySelector('.token-you');
      if (tag) placeYouTag(tag);
      if (t.pos) { t.tx = ''; placeToken(t, t.pos); }
    }
    placeTargets();
    if (ghostAt) {
      ghostEl.style.transition = 'none';
      setGhost(ghostAt);
      ghostEl.getBoundingClientRect?.();
      ghostEl.style.transition = '';
    }
    applyOverlays(true);
    setMarkers(markers);
    win?.requestAnimationFrame?.(() => win.requestAnimationFrame(() => root.classList.remove('no-anim')));
  }

  function setOrientation(o = 'auto') {
    requested = o;
    relayout();
  }

  /** Extra (not in §5.8): the pitch length a mode wants in view ({ x0, x1 } world metres, or a list of points),
   *  or null for the whole pitch. Only a small board (a phone held upright) crops to it: see focusViewBox.
   *  `force`: crop whatever the board's size (a zoomed reveal widens the board past focusMinPxPerM, and the whole
   *  pitch would then sit in the middle with empty space either side); any later call without it clears it. */
  function setFocus(next = null, { force = false } = {}) {
    let f = null;
    if (Array.isArray(next)) {
      const xs = next.map((p) => p?.x).filter(Number.isFinite);
      if (xs.length) f = { x0: Math.min(...xs), x1: Math.max(...xs) };
    } else if (next && Number.isFinite(next.x0) && Number.isFinite(next.x1)) f = { x0: Math.min(next.x0, next.x1), x1: Math.max(next.x0, next.x1) };
    focus = f;
    focusForced = !!(force && f);
    relayout();
  }

  // ---- pointer + keyboard input
  function toWorld(clientX, clientY) {
    const m = world.getScreenCTM?.();
    if (!m) return { x: NaN, y: NaN };
    const inv = m.inverse();
    return { x: inv.a * clientX + inv.c * clientY + inv.e, y: inv.b * clientX + inv.d * clientY + inv.f };
  }

  /** The draggable token nearest `w` within the grab radius (never less than the drawn token and its glow, nor
   *  minHitPx across on a small board). Decided by distance, not by the event target: a touch browser may retarget
   *  a tap near a focusable token to it. */
  function draggableAt(w) {
    if (!Number.isFinite(w?.x)) return null;
    let best = null, bd = Math.max(P.grabRadius, hitRadius(pxm, (P.tokenRadius + 1.5) * scale, P));
    for (const id of drag.ids) {
      const t = tokens.get(id);
      if (!t?.pos || t.g.getAttribute('display') === 'none') continue;
      const d = Math.hypot(t.pos.x - w.x, t.pos.y - w.y);
      if (d <= bd) { bd = d; best = id; }
    }
    if (!best && drag.tapToMove) {
      // Player mode: a DRAG from the learner's YOU tag drags YOU (the tag moves with the token); a TAP on it is a
      // destination like any other spot (tapAction).
      const t = opts.learnerId && drag.ids.has(opts.learnerId) ? tokens.get(opts.learnerId) : null;
      if (t && t.g.getAttribute('display') !== 'none' && onYouTag(t, w)) best = t.id;
    }
    return best;
  }

  /** Is `w` on the drawn token `id` (not just near it)? A tap there toggles it; a tap beyond it is a destination. */
  function onToken(id, w) {
    const t = tokens.get(id);
    if (!t?.pos || !Number.isFinite(w?.x)) return false;
    const r = (id === BALL_ID ? P.ballRadius + 0.7 : P.tokenRadius + 0.5) * scale;
    return Math.hypot(t.pos.x - w.x, t.pos.y - w.y) <= r;
  }

  /** Is `w` on the learner's YOU tag (the pill over the token, drawn tagK times its size)? */
  function onYouTag(t, w) {
    if (!t?.pos || t.id !== opts.learnerId || !Number.isFinite(w?.x)) return false;
    const v = project(t.pos, orient), q = project(w, orient);
    const cy = v.y + tagCentre() * scale; // the tag's centre, straight up the screen from the token
    return Math.abs(q.x - v.x) <= (you.width / 2 + 0.4) * tagK * scale && Math.abs(q.y - cy) <= (1.05 + 0.55) * tagK * scale;
  }

  function moveTo(id, p, final) {
    const t = tokens.get(id);
    if (t) placeToken(t, p);
    updateBoundRings();
    drag.onMove?.(id, { ...p });
    if (final) drag.onEnd?.(id, { ...p });
  }

  function setArmed(id) {
    const was = armed;
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
    if (was !== armed) drag.onArm?.(armed);
  }

  function onPointerDown(e) {
    if (active || handRun || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!drag.enabled && !targets.enabled) return;
    const w = toWorld(e.clientX, e.clientY);
    // Targets first (Player mode "Who's open?"); a press elsewhere with no drag on is a tap that clears the preview.
    const tid = targets.enabled ? targetAt(w) : null;
    if (tid || !drag.enabled) {
      active = { kind: 'target', id: tid, pointerId: e.pointerId, pointerType: e.pointerType, x0: e.clientX, y0: e.clientY };
      try { svg.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      if (tid) e.preventDefault();
      return;
    }
    const id = draggableAt(w);
    const t = id ? tokens.get(id) : null;
    active = {
      kind: 'drag', id, pointerId: e.pointerId, pointerType: e.pointerType, x0: e.clientX, y0: e.clientY, dragging: false, last: null,
      // Every drag is relative: the token keeps its offset from where it was picked up, so it never jumps.
      grab: t?.pos ? { x: t.pos.x - w.x, y: t.pos.y - w.y } : { x: 0, y: 0 },
      liftFrom: null, // time the touch lift started (after touchLiftAfterPx of travel)
    };
    try { svg.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    if (id) {
      e.preventDefault();
      t.g.focus?.({ preventScroll: true });
    }
  }

  /** CSS px a finger-dragged token floats above the finger at most: touchOffsetPx, capped at touchLiftMaxM. */
  const maxLiftPx = () => Math.min(P.touchOffsetPx, P.touchLiftMaxM * (pxm || 0));

  function dragPoint(e) {
    let lift = 0;
    if (active.pointerType !== 'mouse') {
      // Touch and pen: once the finger has travelled a little, the token eases up above it so it stays in
      // sight. A short corrective drag never lifts, so it moves the token exactly as far as the finger.
      const travel = Math.hypot(e.clientX - active.x0, e.clientY - active.y0);
      const now = Number.isFinite(e.timeStamp) && e.timeStamp > 0 ? e.timeStamp : (win?.performance?.now?.() ?? Date.now());
      if (active.liftFrom === null && travel >= P.touchLiftAfterPx) active.liftFrom = now;
      if (active.liftFrom !== null) {
        const u = P.touchLiftMs > 0 ? Math.min(1, Math.max(0, (now - active.liftFrom) / P.touchLiftMs)) : 1;
        lift = maxLiftPx() * (1 - (1 - u) ** 2);
      }
    }
    const w = toWorld(e.clientX, e.clientY - lift);
    return clampToPitch({ x: w.x + active.grab.x, y: w.y + active.grab.y });
  }

  function onPointerMove(e) {
    if (!active || e.pointerId !== active.pointerId || !active.id || active.kind === 'target') return;
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
    if (a.kind === 'target') {
      if (e.type === 'pointercancel' || Math.hypot(e.clientX - a.x0, e.clientY - a.y0) >= P.dragSlopPx) return;
      if (a.id) tapTarget(a.id); else previewTarget(null, true);
      return;
    }
    if (a.dragging) {
      const t = tokens.get(a.id);
      t?.g.classList.remove('is-dragging');
      if (t) t.flags = t.flags.split(' ').filter((c) => c !== 'is-dragging').join(' ');
      root.classList.remove('is-dragging');
      if (a.last) drag.onEnd?.(a.id, { ...a.last });
      return;
    }
    if (e.type === 'pointercancel' || Math.hypot(e.clientX - a.x0, e.clientY - a.y0) >= P.dragSlopPx) return;
    // A tap (tapAction): with nothing armed, a tap that picked up a token arms it (with tap-to-move, only a tap on the
    // drawn token; anywhere else moves it there). With a token armed, a tap on it disarms it, a tap on another draggable
    // token arms that one, and a tap anywhere else (however close) moves the armed token there. Decided by distance,
    // so a short move works on touch screens too.
    const w = toWorld(e.clientX, e.clientY);
    const act = tapAction({
      armed, pressed: a.id, tapToMove: drag.tapToMove && drag.ids.has(drag.tapToMove) ? drag.tapToMove : null,
      onBody: (id) => onToken(id, w),
    });
    if (act.kind === 'arm') { setArmed(act.id); return; }
    if (act.kind === 'disarm') { setArmed(null); return; }
    if (act.kind !== 'move') return;
    const p = clampToPitch(w);
    if (armed) setArmed(null);
    if (Number.isFinite(p.x)) moveTo(act.id, p, true);
  }

  function onKeyDown(e) {
    const tg = e.target?.closest?.('.board-target');
    if (tg && targets.enabled) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tapTarget(tg.dataset.id); }
      else if (e.key === 'Escape') previewTarget(null, true);
      return;
    }
    const g = e.target?.closest?.('.token');
    const id = g?.dataset.id;
    if (!id || handRun || !drag.enabled || !drag.ids.has(id)) return;
    if (e.key === 'Escape') { setArmed(null); return; }
    const d = keyDelta(e.key, orient, e.shiftKey, P);
    if (!d) return;
    e.preventDefault();
    const from = tokens.get(id)?.pos;
    if (!from) return;
    moveTo(id, clampToPitch({ x: from.x + d.x, y: from.y + d.y }), true);
  }

  /**
   * @param {{ ids: string[], onMove?: Function, onEnd?: Function, tapToMove?: string|null, onArm?: (id: string|null) => void }} opts
   *   tapToMove (extra, Player mode): with nothing armed, a tap on the pitch away from that token moves it there
   *   (a tap on it still arms it for tap-then-tap); onArm (extra): told when a token is armed or disarmed by a tap
   */
  function enableDrag({ ids = [], onMove = null, onEnd = null, tapToMove = null, onArm = null } = {}) {
    drag.enabled = true;
    drag.ids = new Set(ids);
    drag.onMove = onMove;
    drag.onEnd = onEnd;
    drag.tapToMove = typeof tapToMove === 'string' ? tapToMove : null;
    drag.onArm = onArm;
    root.classList.add('is-drag-enabled');
    root.classList.toggle('is-tap-to-move', !!drag.tapToMove);
    if (armed && !drag.ids.has(armed)) setArmed(null);
    for (const t of tokens.values()) syncDraggable(t);
  }

  function disableDrag() {
    drag.enabled = false;
    drag.ids = new Set();
    drag.onMove = drag.onEnd = null;
    drag.tapToMove = null;
    if (active?.kind !== 'target') active = null;
    setArmed(null);
    drag.onArm = null;
    root.classList.remove('is-drag-enabled', 'is-dragging', 'is-tap-to-move');
    for (const t of tokens.values()) syncDraggable(t);
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('keydown', onKeyDown);

  const onResize = () => relayout();
  const ro = win?.ResizeObserver ? new win.ResizeObserver(onResize) : null;
  ro?.observe(container);
  win?.addEventListener('resize', onResize);

  relayout(true);

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
    /** Extra: the pitch length to keep in view on a small board (see setFocus above). */
    setFocus,
    /** Extra: the resolved layout, 'horizontal' | 'vertical'. */
    get orientation() { return orient; },
    /** Extra: how much bigger than life tokens are drawn (1 on a big board). */
    get tokenScale() { return scale; },
    /** Extra: CSS px per metre as drawn (0 before the board is measured). */
    get pxPerMetre() { return pxm; },
    // Player mode (docs/KID_REDESIGN.md §8.1): see the file header.
    setSpotlight,
    enableTargets,
    disableTargets,
    /** Extra: preview a target from outside (a "Pass" button confirms it; null clears), without calling onPreview. */
    previewTarget: (id) => previewTarget(id, false),
    /** Extra: the target previewed now, or null. */
    get previewed() { return targets.previewed; },
    showHintHand,
    setAid,
    destroy() {
      handRun?.finish();
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
