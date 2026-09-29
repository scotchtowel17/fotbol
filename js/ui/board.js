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
//
// Figures, the ball and the camera (docs/PROGRESSIVE_FIELD.md §4):
//   createBoard(el, { figures: true })     Player mode: every player is a tabletop figure (js/ui/figures.js: a base disc
//                                           in the team's kit, a disc's size but never wider than about the figure's
//                                           shoulders (baseScale), with an upright, faceless footballer on it that alone
//                                           grows so the number on the shirt reads) that stays upright in both layouts,
//                                           faces the ball as drawn, and runs (a two-pose cycle, css/figures.css) while it
//                                           moves between renders; YOU have a gold base and glow, and YOUR tag over the
//                                           head. Figures are re-stacked so the one lower on the screen stands in front, and
//                                           figures so close that one hides another's head or number are drawn a little
//                                           apart (declutter: display only, at most 1 m, never YOU). A carried ball sits at
//                                           the carrier's feet on the side that covers nobody's head or number (carrySpot),
//                                           sliding there and away (never jumping). Coach mode keeps its discs.
//   The ball (every board, Coach mode's discs too) is drawn over everything (a layer of its own), at least ballMinPx
//   across (bigger when zoomed), white with dark patches and a thick outline, a pulsing halo (still under reduced
//   motion) and a ground shadow, with a fading trail while it flies; on discs a carried ball sits just in front of its
//   carrier's disc, toward the goal it plays to, so the disc's code still says who has it (discBallAt). With figures
//   the best-spot ring (setGhost) is drawn over the figures and under the ball, and the ball's halo shrinks to a thin ring
//   round the ball while the full one would reach the ring (ghostFit). YOUR tag goes, every render, where it covers least
//   (other heads and numbers, the ball, labels, the ring), near YOU, shrinking to a compact "YOU" chevron only in a crowd
//   (tagPlacement); on Coach mode's discs it stays over the token as before, slid clear only of the ball (discTagPlacement).
//   board.setCamera({ x0, x1, y0, y1 } | null)
//                                           fit that world rect on both axes (cameraViewBox), easing there (the viewBox and
//                                           the tokens each frame; markers and overlays are redrawn once, when it lands;
//                                           the grass covers all the board shows meanwhile); null: back to setFocus's
//                                           length crop (or the whole pitch)

import {
  LENGTH, WIDTH, HALF_X, MID_Y, GOAL_DEPTH, PENALTY_AREA, GOAL_AREA, PENALTY_SPOT_DIST,
  CIRCLE_RADIUS, CORNER_RADIUS, POSTS, LANE_EDGES, LANE_NAMES, THIRD_EDGES, THIRD_NAMES, ZONE_14,
  laneOf, thirdOf, clampToPitch,
} from '../engine/pitch.js';
import { ROLE_INFO, parsePlayerId } from '../engine/roles.js';
import { fieldImage } from './heatmap.js';
import { drawFigure, figureLook, runDelay, isKeeperId, numberFontSize, FIGURE, FIGURE_BOXES, FIGURE_DEFAULTS } from './figures.js';

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
  ballRadius: 0.8, // [D] metres (drawn larger than life so it can be seen and grabbed; ballScale sizes it on every board)
  ballMinPx: 20, // [D] the ball at least this many CSS px across at any zoom, Coach mode's discs included (the [S] floor is 18,
  //               PROGRESSIVE_FIELD §4; 20 leaves a little room)...
  ballMaxPx: 30, // [D] ...bigger when zoomed in, up to this many CSS px across
  ballHalo: 1.55, // [D] the ball's halo ring, in ball radii (css/figures.css pulses it, still under reduced motion)
  carryNear: 1.2, // [D] metres: figures: a carrier this close to the ball has it at their feet, drawn beside the boots on the side they face
  //                  (the scene puts a carrier 0.8 m behind the ball)...
  carryDist: 2.5, // [D] ...fading to where the ball really is by this far (carryWeight)
  carryEaseMs: 180, // [D] ...and the drawn ball slides there: at most one full carry offset in this long (taking the ball, letting it go
  //                  or the carrier turning never makes it jump; turning takes twice this)...
  carrySnapMs: 500, // [D] ...except after a gap between renders longer than this (a new scene), when it is drawn in place at once
  discCodeHalf: 0.6, // [D] Coach mode's discs: a carried ball's halo keeps out of the middle this much of the disc's radius, where its code is (discBallAt)
  carrierFacingSlope: 1, // [D] a carrier turns to face the goal it plays toward only when the goal is at least 45° (tan = 1) off straight up
  //                        or down the screen: on a phone held upright the goals are up and down it, and a carrier keeps the way it faced
  figureNumberPx: 11, // [S] PROGRESSIVE_FIELD §6: figures grow so a two-digit shirt number is at least this many CSS px...
  figureMaxScale: 2.4, // [D] ...up to this many times life size (bigger figures would hide the team's shape: a phone held sideways,
  //                      about 3.2 px/m, keeps shirt numbers about 10 px)...
  figureMaxPx: 96, // [D] ...and a figure is never drawn taller than this many CSS px (a zoomed-in camera)
  figureBase: Object.freeze({ min: 1, max: 1.2 }), // [D] owner's preview: a figure's base disc is this many times its shoulder width across
  //                (FIGURE.shoulders) at every scale (baseScale), so a zoomed-in figure never stands on a plate; hit areas stay minHitPx
  // YOUR tag (tagPlacement): every render it takes, of its places round YOUR head (above, slid left or right, lifted,
  // beside the head, under the feet) and its three forms (the nickname pill, a compact "YOU" chevron, a chevron alone),
  // the one that covers least of what matters, each weighed as below plus what the place and the form cost:
  tagClearPx: 4, // [D] CSS px: the ball (its halo at the top of its pulse) counts this much bigger...
  tagBackPx: 10, // [D] ...and, for any place but the one the tag is in, this much more (no flicker as the ball goes by)
  tagMaxSlide: 1.25, // [D] a place is never more than this many (full) tag widths from above the head (further, it names somebody else)
  tagHeadZone: 0.6, // [D] other players' heads and numbers reach this many tag heights higher too (a tag just over a head reads as theirs)
  tagIdWeight: 4, // [D] covering another player's head and number (and that zone over it): per whole head and number covered...
  tagBallWeight: 3, // [D] ...the ball over the tag (drawn over it): per whole tag...
  tagLabelWeight: 2, // [D] ...a marker label over it ("Best spot", the pass labels)...
  tagRingWeight: 1, // [D] ...the best-spot ring over it...
  tagBodyWeight: 0.3, // [D] ...the rest of another figure under it...
  tagOutWeight: 3, // [D] ...and the share of it outside the view
  tagPlaceCost: Object.freeze({ above: 0, left: 0.04, right: 0.04, lift: 0.06, 'beside-left': 0.08, 'beside-right': 0.08, below: 0.12 }), // [D] a place further from above the head costs a little
  tagFormCost: Object.freeze({ full: 0, compact: 0.35, mark: 0.7 }), // [D] so does a smaller form: only a crowd shrinks the tag
  tagKeep: 0.08, // [D] the tag moves only to a place better by this (or as clear and nearer above the head)...
  tagDwellMs: 400, // [D] ...and within this long of its last move only for something much better (tagKeepHeld): no flicker while playing
  tagKeepHeld: 0.5, // [D]
  tagCompactPx: 13, // [D] CSS px: the compact form's "YOU" is at least this tall (never smaller than the pill's own text)
  tagSlideMs: 180, // [D] = css/figures.css .token-you-shift's transition: a moving ball is cleared where it will be when the slide lands...
  tagVelMs: 120, // [D] ...its speed taken over this long
  // Coach mode's discs keep their tag as it was (discTagPlacement: over the token, moved only while the ball would cover it)...
  tagDiscZone: 1.2, // [D] ...off the other discs and this many tag heights over them (a tag there reads as theirs)...
  tagOthersMax: 0.15, // [D] ...a spot clear of the ball with more of the tag than this over them is not taken (above, under the ball, is better)
  // Figures in close quarters (display only: nothing here changes a position the engine, the scoring or a drag sees).
  carryIdWeight: 4, // [D] a carried ball goes to the side of the feet (carrySpot: ahead, at the toes, behind) that covers least of other
  //                   players' heads and numbers (per whole one covered)...
  carryBodyWeight: 0.5, // [D] ...and of the rest of their figures (per whole ball)...
  carryKeep: 0.05, // [D] ...moving to another side only when that is better by this (no flicker)...
  carryClear: 0.03, // [D] ...and a side over no more than this share of anyone's head or number counts as clear of them: a side clear
  //                   of them always wins over one that is not
  declutterMax: 1, // [D] metres: figures drawn so close that one hides another's head or number are drawn up to this far apart (declutter)...
  declutterAim: 0.2, // [D] ...until at most this share of any head and number is hidden (0.25 measured), where that can be done...
  declutterIters: 6, // [D] ...in this many passes over the pairs...
  declutterEaseMs: 250, // [D] ...sliding there (a full declutterMax in this long): never a jump
  ballByGhostHalo: 1.2, // [D] ball radii: by the best-spot ring the halo shrinks to a thin ring this size round the ball (never hidden)
  labelOthersWeight: 0.5, // [D] a label written with clear: 'you' keeps off YOU and YOUR tag first, then (this much less) the other players and the ball
  ghostGapPx: 3, // [D] CSS px: figures: a ball inside the best-spot ring grows the ring to keep this clear of the ball's body (ghostFit)...
  ghostInside: 0.8, // [D] ...when the ball's centre is within this share of the ring's radius (a ball on the rim: the ring stays as it
  //                   is, the ball drawn over it)...
  ghostMaxGrow: 2, // [D] ...and up to this many times its own size
  facingDeadZone: 0.6, // [D] metres across the screen: a figure level with the ball keeps the way it faced (no flicker)
  runMinSpeed: 1.5, // [D] m/s between two renders: faster than this, a figure runs (the two-pose cycle)...
  runMinStep: 0.02, // [D] metres: ...a smaller move is standing still...
  runMaxJump: 15, // [D] metres: ...and a bigger one a new scene, not a run
  runMaxGapMs: 400, // [D] ms: a move after a longer gap than this runs anyway (for the ease that draws it)
  runHoldMs: 240, // [D] ms: a figure keeps running this long after its last move, so the cycle never flickers
  trailMinSpeed: 9, // [D] m/s: the ball leaves a trail only this fast (a pass or a shot, not a dribble)...
  trailMs: 240, // [D] ...reaching this far back along its path...
  trailMaxGapMs: 200, // [D] ...from renders at most this far apart (farther apart, its path is unknown)
  cameraMin: Object.freeze({ length: 24, width: 16 }), // [D] PROGRESSIVE_FIELD §4 CAMERA_MIN: setCamera never shows less than this (metres along × across the pitch)
  cameraPad: 3, // [D] metres of pitch the camera keeps round its rect...
  cameraHeadroom: 5, // [D] ...plus this at the top of the screen (figures stand up the screen; YOUR tag is over the head), or more: a
  //                     figure and YOUR tag's height (standHeight), which the window may take past the pitch's margin
  cameraAir: 0.5, // [D] metres kept over the top of YOUR tag
  cameraMaxPxPerM: 24, // [D] the camera never zooms in closer than this many CSS px per metre (a desktop board would blow everything up)
  cameraMs: 450, // [D] the camera eases to a new window over this long (at once under reduced motion)
  cameraSurround: 1, // [D] with a camera on, the grass reaches this many of the view's longer sides past all the board shows (the stage
  //                    clips it): a board resized before it has fitted its window again (a panel under the pitch going or coming, a
  //                    phone turned; up to 3 times the aspect) still shows grass all round, every frame
  maxTokenPx: 56, // [D] with figures or a camera: discs never drawn wider than this many CSS px...
  maxLabelPx: 24, // [D] ...pitch and marker labels never taller...
  maxTagPx: 20, // [D] ...and YOUR tag's text never taller
  depthSlop: 1, // [D] metres up the screen: figures are re-stacked (lower on the screen in front) only when two are out of order by more
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

// ---------------------------------------------------------------- figures, the ball and the camera (pure)

/** The camera's smallest window, metres along × across the pitch (PROGRESSIVE_FIELD §4 CAMERA_MIN). */
export const CAMERA_MIN = BOARD_DEFAULTS.cameraMin;

const up2 = (k) => Math.ceil(k * 100 - 1e-9) / 100; // round a minimum scale up, so the size it guarantees holds

/**
 * How much bigger than life figures are drawn at `pxPerM`: enough for a two-digit shirt number figureNumberPx tall,
 * never less than life size nor more than figureMaxScale, and never so big that the figure is taller than figureMaxPx
 * (a zoomed-in camera: then a little under life size). Rounded to 0.01.
 */
export function figureScale(pxPerM, P = BOARD_DEFAULTS) {
  if (!(pxPerM > 0)) return 1;
  const lo = P.figureNumberPx / (numberFontSize('10') * P.tokenRadius * pxPerM);
  const k = Math.min(P.figureMaxScale, Math.max(1, up2(lo)));
  return Math.min(k, Math.floor((P.figureMaxPx / (FIGURE.height * P.tokenRadius * pxPerM)) * 100) / 100);
}

/** The ball's own scale at `pxPerM`: its body at least ballMinPx across, bigger when zoomed, at most ballMaxPx. */
export function ballScale(pxPerM, P = BOARD_DEFAULTS) {
  if (!(pxPerM > 0)) return 1;
  const life = 2 * P.ballRadius * pxPerM; // CSS px across at life size
  return up2(Math.min(P.ballMaxPx / life, Math.max(P.ballMinPx / life, 1)));
}

/** CSS px across the ball's body at `pxPerM` (0 unmeasured). */
export const ballPx = (pxPerM, P = BOARD_DEFAULTS) => (pxPerM > 0 ? 2 * P.ballRadius * ballScale(pxPerM, P) * pxPerM : 0);

/**
 * A figure's base disc (pure): the disc's scale `k` kept between figureBase.min and figureBase.max times the figure's
 * shoulder width across (FIGURE.shoulders base radii, drawn at the figure's scale `kf`), so the base stays in proportion
 * at every scale: on a phone showing the whole match it is today's disc, zoomed in on a small game (where the figure is
 * big and the disc would be a plate under it) it shrinks with the figure. Rounded to 0.01 inside the band. The hit
 * areas (hitRadius), targets and the grab area do not shrink with it: they stay minHitPx across however small it is.
 */
export function baseScale(k, kf, P = BOARD_DEFAULTS) {
  if (!(kf > 0) || !(k > 0)) return k;
  const across = (m) => (m * FIGURE.shoulders * kf) / 2; // a disc m shoulder widths across, as a scale of the life-size token
  const lo = Math.ceil(across(P.figureBase.min) * 100 - 1e-9) / 100, hi = Math.floor(across(P.figureBase.max) * 100 + 1e-9) / 100;
  return Math.min(hi, Math.max(lo, k));
}

/**
 * Every drawn size on a board at `pxPerM` (pure): { k: the players' discs (a figure's base disc: the token, its rings,
 * hit area and targets), kf: the figures standing on them, kl: pitch and marker labels, kt: YOUR tag (on top of k),
 * kb: the ball }. Discs without a camera (Coach mode) keep their sizes (tokenScale, labelScale, tagScale). With figures
 * the base disc keeps a disc's size (tokenScale: today's readability from above, without piling the board up) but in
 * proportion to the figure (baseScale: about its shoulder width across), and the figure alone grows to figureScale (a
 * readable shirt number). The ball is its own size on every board (ballScale: at least ballMinPx across, Coach mode's
 * discs included: the owner's "impossible to see" was about every pitch). With figures or a camera, discs, labels and
 * YOUR tag are also capped in CSS px (maxTokenPx, maxLabelPx, maxTagPx), since a zoomed-in window would blow them up.
 */
export function boardScales(pxPerM, { figures = false, player = false, camera = false } = {}, P = BOARD_DEFAULTS) {
  const capped = (figures || camera) && pxPerM > 0;
  const cap = (k, px, lifeM) => (capped ? Math.min(k, Math.floor((px / (lifeM * pxPerM)) * 100) / 100) : k);
  const kf = figures ? figureScale(pxPerM, P) : null;
  const disc = cap(tokenScale(pxPerM, P), P.maxTokenPx, 2 * P.tokenRadius);
  const k = figures ? baseScale(disc, kf, P) : disc;
  const kl = cap(labelScale(pxPerM, player ? playerLabelParams(P) : P), P.maxLabelPx, 1.5);
  const kt = cap(tagScale(pxPerM, k, { player }, P), P.maxTagPx, 1.15 * k);
  return { k, kf: figures ? kf : k, kl, kt, kb: ballScale(pxPerM, P) };
}

/**
 * The viewBox that fits world rect `rect` ({ x0, x1, y0, y1 }, metres) on a board of `box` CSS px (setCamera): the
 * rect plus cameraPad all round and cameraHeadroom at the top of the screen (figures stand up it), grown to at least
 * cameraMin (along × across the pitch) and to no closer than cameraMaxPxPerM, then to the box's aspect (so it fills
 * the board on both axes, never cutting the rect), no bigger than the pitch plus its margin (the board letterboxes
 * the rest, as for the whole pitch) and slid inside it. No rect, or an unmeasured box: the whole pitch.
 * @param {'horizontal'|'vertical'} orientation
 * @returns {{x:number, y:number, width:number, height:number}}
 */
export function cameraViewBox(orientation, box, rect, P = BOARD_DEFAULTS) {
  const full = viewBoxFor(orientation, P.margin);
  if (!rect || ![rect.x0, rect.x1, rect.y0, rect.y1].every(Number.isFinite) || !(box?.width > 0 && box?.height > 0)) return full;
  const vertical = orientation === 'vertical';
  const a = project({ x: Math.min(rect.x0, rect.x1), y: Math.min(rect.y0, rect.y1) }, orientation);
  const b = project({ x: Math.max(rect.x0, rect.x1), y: Math.max(rect.y0, rect.y1) }, orientation);
  const x0 = Math.min(a.x, b.x) - P.cameraPad, x1 = Math.max(a.x, b.x) + P.cameraPad;
  const y0 = Math.min(a.y, b.y) - P.cameraPad - P.cameraHeadroom, y1 = Math.max(a.y, b.y) + P.cameraPad;
  // The pitch length runs across the screen (horizontal) or up it (vertical).
  let w = Math.max(x1 - x0, vertical ? P.cameraMin.width : P.cameraMin.length, box.width / P.cameraMaxPxPerM);
  let h = Math.max(y1 - y0, vertical ? P.cameraMin.length : P.cameraMin.width, box.height / P.cameraMaxPxPerM);
  const aspect = box.width / box.height;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  w = Math.min(w, full.width);
  h = Math.min(h, full.height);
  const slide = (centre, len, lo, span) => Math.max(lo, Math.min(lo + span - len, centre - len / 2));
  const r = (n) => Math.round(n * 100) / 100;
  // Up the screen the window may reach past the pitch's margin by the headroom (figures stand up it: at their goal
  // line on a phone held upright, or our left touchline sideways, a figure's head and YOUR tag stay in view), but
  // never so far that the bottom of the rect leaves it (a window as tall as the pitch stays on it).
  const top = Math.max(full.y - Math.max(0, P.cameraHeadroom), Math.min(full.y, y1 - h));
  return { x: r(slide((x0 + x1) / 2, w, full.x, full.width)), y: r(slide((y0 + y1) / 2, h, top, full.y + full.height - top)), width: r(w), height: r(h) };
}

/**
 * What a board of `box` CSS px shows, in view units (pure): the viewBox `vb` and, when their aspects differ, the strips
 * either side that preserveAspectRatio "meet" leaves, where the SVG draws past its viewBox (overflow: visible). A box not
 * measured: the viewBox alone.
 * @returns {{ x0: number, x1: number, y0: number, y1: number } | null}
 */
export function shownBox(vb, box) {
  if (!vb || !(vb.width > 0 && vb.height > 0)) return null;
  if (!(box?.width > 0 && box?.height > 0)) return { x0: vb.x, x1: vb.x + vb.width, y0: vb.y, y1: vb.y + vb.height };
  const k = Math.min(box.width / vb.width, box.height / vb.height);
  const sx = (box.width / k - vb.width) / 2, sy = (box.height / k - vb.height) / 2;
  return { x0: vb.x - sx, x1: vb.x + vb.width + sx, y0: vb.y - sy, y1: vb.y + vb.height + sy };
}

/**
 * How far up the screen from a player's feet the camera keeps in view (metres, pure): the tallest thing drawn there, a
 * figure (or a disc) with YOUR name tag over it, at the board's sizes `s` (boardScales), plus a little air. setCamera
 * keeps this much over the top of its rect (never less than cameraPad + cameraHeadroom): zoomed in, a figure and its
 * tag are taller than the headroom alone (YOU walked to the top of a small game's view lost your head and your tag).
 */
export function standHeight({ k = 1, kf = k, kt = 1 } = {}, { figures = false } = {}, P = BOARD_DEFAULTS) {
  const body = figures ? FIGURE.height * P.tokenRadius * kf + 0.45 * k : (P.tokenRadius + 1.15) * k;
  return body + 2.1 * kt * k + P.cameraAir;
}

/**
 * Which way a figure faces on the screen (1 right, -1 left): toward `target` (the ball as drawn, or the goal a carrier
 * plays toward), keeping `prev` when the target is within facingDeadZone of straight up or down the screen from it, or
 * (`slope` > 0) within that steep an angle of it: |across| <= slope x |up or down| (a carrier: carrierFacingSlope, so
 * on a phone held upright, where the goals are up and down the screen, a carrier crossing the middle never flips).
 */
export function facingToward(from, target, orientation, prev = 1, P = BOARD_DEFAULTS, slope = 0) {
  const keep = prev < 0 ? -1 : 1;
  if (!isVec(from) || !isVec(target)) return keep;
  const a = project(from, orientation), b = project(target, orientation);
  const dx = b.x - a.x;
  return Math.abs(dx) <= Math.max(P.facingDeadZone, (slope > 0 ? slope : 0) * Math.abs(b.y - a.y)) ? keep : dx > 0 ? 1 : -1;
}

/** Where a carrier looks: the middle of the goal their team attacks (us +x, them -x), or their own when
 *  frame.tags.carrierFacing is 'backward'. */
export function carrierTarget(team, carrierFacing = null) {
  const attack = team === 'them' ? 0 : LENGTH;
  return { x: carrierFacing === 'backward' ? LENGTH - attack : attack, y: MID_Y };
}

/**
 * Where a figure's ball is drawn when it has it at its feet (world): beside its boots on the side it faces on the
 * screen, a little down the screen (name tags sit above players), so nobody hides it (`k` the figure's scale, kf; `kb`
 * the ball's). Coach mode's discs draw the ball where it is.
 */
export function carriedBallAt(feet, facing, orientation, { k = 1, kb = 1 } = {}, P = BOARD_DEFAULTS) {
  const v = project(feet, orientation);
  const side = facing < 0 ? -1 : 1;
  return unproject({ x: v.x + side * (0.55 * P.tokenRadius * k + 0.75 * P.ballRadius * kb), y: v.y + 0.28 * P.tokenRadius * k }, orientation);
}

/**
 * Where Coach mode's discs draw a ball at a carrier's feet (world, pure): just outside the disc, the way `dir` points
 * (a unit vector in world metres, or +1 / -1: up or down the pitch; discCarryDir picks it), far enough that the ball
 * and its halo (at rest) leave the code in the middle of the disc readable (the new ball, 20 px or more across, drawn
 * where it is hid the carrier's whole disc and code: who had the ball could not be seen). `k` the discs' scale, `kb`
 * the ball's.
 */
export function discBallAt(feet, dir, { k = 1, kb = 1 } = {}, P = BOARD_DEFAULTS) {
  const u = dir && typeof dir === 'object' ? dir : { x: dir < 0 ? -1 : 1, y: 0 };
  const d = discCarry({ k, kb }, P);
  return { x: feet.x + u.x * d, y: feet.y + u.y * d };
}

/**
 * Which way a carried ball sits off its disc (pure, world unit vector): toward the goal the carrier plays to (`goal`:
 * +1 up the pitch, -1 down it), else across the pitch either way, else back, the first that keeps the ball's body off
 * every other disc's code (`others`: their centres); the way it went before (`prev`) while that still does, so it
 * never flickers; toward the goal when none does.
 */
export function discCarryDir(feet, goal, others = [], { k = 1, kb = 1, prev = null } = {}, P = BOARD_DEFAULTS) {
  const g = goal < 0 ? -1 : 1;
  const ways = [{ x: g, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: -g, y: 0 }];
  const d = discCarry({ k, kb }, P), clear = P.ballRadius * kb + P.discCodeHalf * P.tokenRadius * k;
  const ok = (u) => others.every((q) => Math.hypot(feet.x + u.x * d - q.x, feet.y + u.y * d - q.y) >= clear);
  const was = prev ? ways.find((u) => u.x === prev.x && u.y === prev.y) : null;
  if (was && ok(was)) return was;
  return ways.find(ok) ?? ways[0];
}

/** Metres from a disc's centre to its carried ball (discBallAt): the code's half-width in from the disc's edge, plus
 *  the ball's halo at rest and its rim. */
export const discCarry = ({ k = 1, kb = 1 } = {}, P = BOARD_DEFAULTS) => P.discCodeHalf * P.tokenRadius * k + (P.ballHalo * P.ballRadius + 0.25) * kb;

/**
 * The best-spot ring next to the ball (pure; figures, view units): `d` from the ring's centre to the ball as drawn,
 * `ring` the ring's own radius, `body` the ball's radius, `reach` its halo at the top of its pulse, `gap` the space
 * kept round the body. byBall: the halo would reach the ring (the board hides the halo). r: the ring as drawn: with
 * the ball inside it (its centre within ghostInside of the radius), grown just clear of the ball's body (up to
 * ghostMaxGrow times); a ball on the rim leaves it as it is and is drawn over it.
 * @returns {{ r: number, byBall: boolean }}
 */
export function ghostFit({ d, ring, body = 0, reach = 0, gap = 0 }, P = BOARD_DEFAULTS) {
  if (!(d >= 0) || !(ring > 0)) return { r: ring, byBall: false };
  const byBall = d < ring + reach;
  const need = d + body + gap;
  const r = d < P.ghostInside * ring && need > ring && need <= P.ghostMaxGrow * ring ? need : ring;
  return { r, byBall };
}

// ---------------------------------------------------------------- close quarters (pure): YOUR tag, the carried ball, declutter

/** Box sums (view units): the overlap of two boxes (an area), a box's area, a box moved, a box of base radii `b`
 *  drawn at feet (x, y) with `s` view units to a base radius, and where two boxes meet (null: they do not). */
const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const boxArea = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const shiftBox = (b, dx, dy) => ({ x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy });
const partAt = (b, x, y, s) => ({ x0: x + b.x0 * s, x1: x + b.x1 * s, y0: y + b.y0 * s, y1: y + b.y1 * s });
function meetBox(a, b) {
  const m = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) };
  return m.x1 > m.x0 && m.y1 > m.y0 ? m : null;
}

/**
 * A figure's parts drawn with its feet at `v` (view units), `s` view units to a base radius (FIGURE_BOXES, pure):
 * { head, number, torso, legs, all } (all: the whole figure).
 */
export function figureParts(v, s) {
  const B = FIGURE_BOXES;
  const [head, number, torso, legs] = [B.head, B.number, B.torso, B.legs].map((b) => partAt(b, v.x, v.y, s));
  return { head, number, torso, legs, all: { x0: Math.min(head.x0, torso.x0, legs.x0), x1: Math.max(head.x1, torso.x1, legs.x1), y0: head.y0, y1: legs.y1 } };
}

/**
 * How much of a figure's head or shirt number another figure standing in front of it hides (pure, 0..1: the more hidden
 * of the two, each as a share of itself): `back` and `front` their feet (view units), `s` view units to a base radius.
 * The front figure hides with its head, torso and legs (FIGURE_BOXES: the area they cover together, never counted twice).
 */
export function figureOcclusion(back, front, s) {
  if (!(s > 0) || !isVec(back) || !isVec(front)) return 0;
  const B = FIGURE_BOXES;
  const over = [B.head, B.torso, B.legs].map((b) => partAt(b, front.x, front.y, s));
  let most = 0;
  for (const part of [B.head, B.number]) {
    const p = partAt(part, back.x, back.y, s);
    const ins = over.map((o) => meetBox(p, o)).filter(Boolean);
    let hid = 0;
    for (let i = 0; i < ins.length; i++) {
      hid += boxArea(ins[i]);
      for (let j = i + 1; j < ins.length; j++) { const m = meetBox(ins[i], ins[j]); if (m) hid -= boxArea(m); } // (the three never meet at once)
    }
    most = Math.max(most, hid / (boxArea(p) || 1));
  }
  return Math.min(1, Math.max(0, most));
}

/** How much of either figure's head and number the other hides as the board stacks them (pure): the one lower on the
 *  screen stands in front, `top` (YOU) in front of all; within `slop` of level either may (the board re-stacks only
 *  past depthSlop), so the worse of the two counts. */
export function pairCover(a, b, s, slop = BOARD_DEFAULTS.depthSlop) {
  if (!!a.top !== !!b.top) return a.top ? figureOcclusion(b, a, s) : figureOcclusion(a, b, s);
  if (Math.abs(a.y - b.y) <= slop) return Math.max(figureOcclusion(a, b, s), figureOcclusion(b, a, s));
  return a.y > b.y ? figureOcclusion(b, a, s) : figureOcclusion(a, b, s);
}

/**
 * The declutter (pure; display only: the board draws a figure at its spot plus this offset, and nothing else sees it).
 * Figures standing so close that one hides another's head or number (pairCover over `aim`) are drawn pushed apart,
 * across or up and down the screen, whichever needs the smaller push, the push shared between the two (all of it by
 * the other one when one is `fixed`: YOU, drawn over everyone and never moved), pair by pair in id order for `iters`
 * passes, and no figure more than `max` from its spot: in a pile that cannot be untangled within `max` the pairs get as
 * far apart as that allows. The same feet always give the same offsets.
 * @param {{ id: string, x: number, y: number, fixed?: boolean }[]} figs  feet in view units
 * @param {{ s: number, max?: number, aim?: number, iters?: number, slop?: number }} o  s: view units to a base radius
 * @returns {Map<string, {x: number, y: number}>} each figure's offset (view units, rounded to 0.01)
 */
export function declutter(figs, { s, max = BOARD_DEFAULTS.declutterMax, aim = BOARD_DEFAULTS.declutterAim, iters = BOARD_DEFAULTS.declutterIters, slop = BOARD_DEFAULTS.depthSlop } = {}) {
  const list = (Array.isArray(figs) ? figs : []).filter((f) => typeof f?.id === 'string' && isVec(f)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const off = list.map(() => ({ x: 0, y: 0 }));
  const clampLen = (v) => { const d = Math.hypot(v.x, v.y); return d > max ? { x: (v.x * max) / d, y: (v.y * max) / d } : v; };
  if (s > 0 && max > 0 && list.length > 1) {
    const B = FIGURE_BOXES;
    const wide = (Math.max(B.torso.x1, B.legs.x1, B.head.x1) - Math.min(B.torso.x0, B.legs.x0, B.head.x0)) * s, tall = (B.legs.y1 - B.head.y0) * s;
    for (let it = 0; it < iters; it++) {
      let moved = 0; // (how far everyone moved this pass: a pass that moves nobody, all pushes spent, is the last)
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const A = list[i], C = list[j];
          const ma = A.fixed ? 0 : 1, mc = C.fixed ? 0 : 1;
          if (!ma && !mc) continue;
          const pa = { x: A.x + off[i].x, y: A.y + off[i].y, top: !!A.fixed }, pc = { x: C.x + off[j].x, y: C.y + off[j].y, top: !!C.fixed };
          if (Math.abs(pc.x - pa.x) >= wide || Math.abs(pc.y - pa.y) >= tall || pairCover(pa, pc, s, slop) <= aim) continue;
          // How far apart they must go along (ux, uy): the least that brings them to `aim` (else as far as they may);
          // of the two ways, the one that leaves the least hidden round them (a push must not drive one into a third).
          const room = (ma && mc ? 2 : 1) * max;
          const cover = (ux, uy, t) => pairCover(pa, { ...pc, x: pc.x + ux * t, y: pc.y + uy * t }, s, slop);
          const wa = ma / (ma + mc), wc = mc / (ma + mc);
          let best = null;
          for (const [ux, uy] of [[Math.sign(pc.x - pa.x) || 1, 0], [0, Math.sign(pc.y - pa.y) || 1]]) {
            let t = room;
            if (cover(ux, uy, room) <= aim) {
              let lo = 0;
              for (let k = 0; k < 10; k++) { const m = (lo + t) / 2; if (cover(ux, uy, m) <= aim) t = m; else lo = m; }
            }
            const oi = clampLen({ x: off[i].x - ux * t * wa, y: off[i].y - uy * t * wa }), oj = clampLen({ x: off[j].x + ux * t * wc, y: off[j].y + uy * t * wc });
            const qa = { x: A.x + oi.x, y: A.y + oi.y, top: !!A.fixed }, qc = { x: C.x + oj.x, y: C.y + oj.y, top: !!C.fixed };
            let c = pairCover(qa, qc, s, slop);
            for (let k = 0; k < list.length; k++) {
              if (k === i || k === j) continue;
              const q = { x: list[k].x + off[k].x, y: list[k].y + off[k].y, top: !!list[k].fixed };
              if (Math.abs(q.x - qa.x) < wide && Math.abs(q.y - qa.y) < tall) c = Math.max(c, pairCover(qa, q, s, slop));
              if (Math.abs(q.x - qc.x) < wide && Math.abs(q.y - qc.y) < tall) c = Math.max(c, pairCover(qc, q, s, slop));
            }
            const ok = c <= aim + 1e-9;
            if (!best || (ok && (!best.ok || t < best.t - 1e-9)) || (!ok && !best.ok && c < best.c - 1e-9)) best = { oi, oj, t, c, ok };
          }
          moved += Math.hypot(best.oi.x - off[i].x, best.oi.y - off[i].y) + Math.hypot(best.oj.x - off[j].x, best.oj.y - off[j].y);
          off[i] = best.oi;
          off[j] = best.oj;
        }
      }
      if (!(moved > 1e-3)) break;
    }
  }
  const r = (n) => Math.trunc(n * 100) / 100 || 0; // (toward nothing: never past `max`)
  return new Map(list.map((f, i) => [f.id, { x: r(off[i].x), y: r(off[i].y) }]));
}

/**
 * Where a figure's ball at its feet is drawn (pure; view units round the carrier's feet as drawn): beside the boots on
 * the side it faces ('ahead': carriedBallAt), just in front of its toes, down the screen ('toes'), or beside the boots
 * on the other side ('behind'), whichever covers least of the other players: their heads and numbers first (`ids`,
 * carryIdWeight per whole one), then the rest of their figures (`bodies`, carryBodyWeight per whole ball) and the view's
 * edge (`view`); on a tie in that order; a side clear of every head and number (carryClear) always before one that is not.
 * It stays on the side it was (`prev`) unless another is better by carryKeep (or it is on someone's head and another side
 * is clear), so it never flickers (and never jumps: the board slides the drawn ball there, carryBall). `facing` the carrier's (1 right,
 * -1 left on the screen), `k` its figure's scale (figK), `kb` the ball's.
 * @returns {{ side: 'ahead'|'toes'|'behind', x: number, y: number, cost: number }}
 */
export function carrySpot({ facing = 1, k = 1, kb = 1, ids = [], bodies = [], view = null, prev = null } = {}, P = BOARD_DEFAULTS) {
  const f = facing < 0 ? -1 : 1, R = P.tokenRadius, B = P.ballRadius;
  const across = 0.55 * R * k + 0.75 * B * kb, down = 0.28 * R * k;
  const spots = [
    { side: 'ahead', x: f * across, y: down, pref: 0 },
    { side: 'toes', x: f * 0.15 * R * k, y: 0.1 * R * k + 1.05 * B * kb, pref: 0.02 },
    { side: 'behind', x: -f * across, y: down, pref: 0.04 },
  ];
  const h = 0.9 * P.ballHalo * B * kb; // the ball and its halo at rest, as a box of about the same area
  for (const sp of spots) {
    const b = { x0: sp.x - h, x1: sp.x + h, y0: sp.y - h, y1: sp.y + h }, a = boxArea(b) || 1;
    let idc = 0, c = sp.pref;
    for (const q of ids ?? []) idc += overlapArea(b, q) / (boxArea(q) || 1);
    c += P.carryIdWeight * idc;
    for (const q of bodies ?? []) c += (P.carryBodyWeight * overlapArea(b, q)) / a;
    if (view) c += P.tagOutWeight * (1 - overlapArea(b, view) / a);
    Object.assign(sp, { idc, cost: c, clear: idc <= P.carryClear });
  }
  // A side clear of every head and number (all but a sliver: carryClear) comes first; then the cheapest.
  const clear = spots.some((sp) => sp.clear);
  let best = null;
  for (const sp of spots) if ((sp.clear || !clear) && (!best || sp.cost < best.cost - 1e-9)) best = sp;
  const was = spots.find((sp) => sp.side === prev);
  const pick = was && was !== best && (was.clear || !clear) && was.cost <= best.cost + P.carryKeep ? was : best;
  return { side: pick.side, x: pick.x, y: pick.y, cost: pick.cost };
}

/** YOUR tag's forms, largest first: the pill with YOUR nickname, a compact "YOU" chevron, a chevron alone. */
export const TAG_FORMS = Object.freeze(['full', 'compact', 'mark']);
const TAG_PLACES = Object.freeze(['above', 'left', 'right', 'lift', 'beside-left', 'beside-right', 'below']);
/** The compact forms in the tag's own units (the pill is 2.1 tall), round the pill's bottom edge: half their width and how
 *  far up (y0) and down (y1) they reach (the compact form: a "YOU" pill with a chevron under it pointing at the head; the
 *  mark: a chevron 1.8 wide and 1.2 tall, turned to point at YOU beside the head or under the feet: its box holds any turn). */
const TAG_SHAPES = Object.freeze({ compact: Object.freeze({ hw: 1.95, y0: -2.6, y1: 0 }), mark: Object.freeze({ hw: 0.9, y0: -1.5, y1: 0.3 }) });
/** Which way the chevron alone turns to point at YOU (degrees; it points down, at the head, over it). */
const MARK_TURN = Object.freeze({ above: 0, edge: 0, 'beside-left': -90, 'beside-right': 90, below: 180 });

/**
 * Where YOUR name tag goes, and in which form (pure; view units round YOUR feet). Every place round YOUR head is weighed
 * every time: above it as always ('above'), slid left or right ('left' | 'right': half a tag, or just clear of the ball
 * on that side while the ball is at the tag), lifted ('lift': over the ball while it is at the tag), level with YOUR head
 * beside it ('beside-left' | 'beside-right', given `head`: { y, half }) and under YOUR feet ('below', given `base`: how
 * far YOUR base and its glow reach below them), in the tag's three forms: the pill with YOUR nickname ('full', `tag`: its
 * box above the head), a compact "YOU" chevron ('compact'; beside YOUR head or under YOUR feet its pill alone) and a
 * chevron alone ('mark': over the head, beside it or under the feet, turned to point at YOU; never slid off to one side)
 * (`forms`: their boxes above the head). A place costs what it covers, each by its weight (BOARD_DEFAULTS tag*Weight): other players' heads and
 * numbers with the zone just over them (`ids`: boxes, per whole one; the tag is drawn over them), the ball with its halo
 * (`ball`, `r` its drawn radius, `clear` the room kept round it, and where it will be when the slide lands, `lead`),
 * marker labels (`labels`), the best-spot ring (`ring`: { x, y, r }), the rest of other figures (`bodies`) and the
 * view's edge (`view`: every place is first slid in across the screen by what would stick out); plus a little for a
 * place further from above the head (tagPlaceCost, and by how far it moves) and for a smaller form (tagFormCost), so
 * only a crowd shrinks it. No slide or lift is more than `maxSlide` from above the head. The cheapest wins, but the tag
 * keeps the place it is in (`prev`: { place, form }, or a place) unless another is better by tagKeep (while `hold`: by
 * tagKeepHeld), or, not held, as clear and nearer above the head; the ball counts `back` bigger at every place but that
 * one, so it never flickers as a pass goes by.
 * @returns {{ place: string, form: 'full'|'compact'|'mark', dx: number, dy: number, cost: number, held?: true }}  place
 *   'edge': above the head, slid in from the view's edge; dx, dy: the move from above the head (the forms share one
 *   group); held: it stays only because of `hold` (the board looks again once the hold is over)
 */
export function tagPlacement({
  tag, forms = null, head = null, ball = null, r = 0, lead = null, clear = 0, back = 0, ring = null, labels = [], ids = [],
  bodies = [], view = null, base = 0, maxSlide = Infinity, prev = null, hold = false,
} = {}, P = BOARD_DEFAULTS) {
  const none = { place: 'above', form: 'full', dx: 0, dy: 0, cost: 0 };
  if (!tag) return none;
  const was = typeof prev === 'string' ? { place: prev, form: 'full' } : prev && typeof prev === 'object' ? { place: prev.place, form: prev.form ?? 'full' } : null;
  const list = (v) => (typeof v === 'function' ? v() : v) ?? [];
  const idBoxes = list(ids), bodyBoxes = list(bodies), labelBoxes = list(labels);
  // The ball now and (moving) where it will be when the slide lands: the tag keeps clear of the path between.
  const hasBall = isVec(ball);
  const to = hasBall && isVec(lead) ? lead : ball;
  const path = hasBall ? [0, 0.25, 0.5, 0.75, 1].map((u) => ({ x: ball.x + (to.x - ball.x) * u, y: ball.y + (to.y - ball.y) * u })) : [];
  const round = (g) => path.map((b) => ({ x0: b.x - g, x1: b.x + g, y0: b.y - g, y1: b.y + g }));
  const near = round(r + clear), wide = round(r + clear + back);
  const lo = hasBall ? { x: Math.min(ball.x, to.x), y: Math.min(ball.y, to.y) } : null, hiX = hasBall ? Math.max(ball.x, to.x) : 0;
  const ringBox = ring && isVec(ring) && ring.r > 0 ? { x0: ring.x - ring.r, x1: ring.x + ring.r, y0: ring.y - ring.r, y1: ring.y + ring.r } : null;
  const full = tag.x1 - tag.x0;
  const reach = Math.min(maxSlide, P.tagMaxSlide * full);
  const inView = (b, dx) => { // slid in across the screen by what sticks out of the view (a view narrower than it: as it is)
    if (!view || !(view.x1 - view.x0 >= b.x1 - b.x0)) return dx;
    const x0 = b.x0 + dx, x1 = b.x1 + dx;
    return x0 < view.x0 ? dx + view.x0 - x0 : x1 > view.x1 ? dx + view.x1 - x1 : dx;
  };
  const cands = [];
  for (const form of TAG_FORMS) {
    const b = form === 'full' ? tag : forms?.[form];
    if (!b) continue;
    const w = b.x1 - b.x0, h = b.y1 - b.y0, g = r + clear + back;
    const atBall = wide.some((q) => overlapArea(q, b) > 0); // the ball at this form's spot above the head
    // (While the ball is at it: clear of the ball on that side by the room kept round it and `back`, always the right way,
    // so as the ball goes the tag eases back over the head with it; else half the tag's width, or most of its height.)
    const moves = {
      above: { dx: 0, dy: 0 },
      left: { dx: atBall ? Math.min(0, lo.x - g - b.x1) : -0.5 * w, dy: 0, far: true },
      right: { dx: atBall ? Math.max(0, hiX + g - b.x0) : 0.5 * w, dy: 0, far: true },
      lift: { dx: 0, dy: atBall ? Math.min(0, lo.y - g - b.y1) : -0.9 * h, far: true },
    };
    if (head && Number.isFinite(head.y) && head.half >= 0) {
      const beside = w / 2 + head.half + 0.2 * h, dy = head.y - (b.y0 + b.y1) / 2;
      moves['beside-left'] = { dx: -beside - (b.x0 + b.x1) / 2, dy };
      moves['beside-right'] = { dx: beside - (b.x0 + b.x1) / 2, dy };
    }
    if (base > 0) moves.below = { dx: 0, dy: base + clear - b.y0 };
    for (const place of TAG_PLACES) {
      const m = moves[place];
      if (!m || (m.far && (Math.abs(m.dx) > reach + 1e-9 || Math.abs(m.dy) > reach + 1e-9))) continue;
      // (The chevron alone points at YOUR head: over it, beside it or under YOUR feet (turned: MARK_TURN), never off to one
      // side. Beside YOUR head or under YOUR feet the compact form is its pill without the chevron, next to YOU like the pill.)
      if (form === 'mark' && !Object.hasOwn(MARK_TURN, place)) continue;
      const dx = inView(b, m.dx), dy = m.dy;
      const bx = shiftBox(b, dx, dy), a = boxArea(bx) || 1;
      const isPrev = !!was && (was.place === place || (was.place === 'edge' && place === 'above')) && was.form === form;
      let cover = 0;
      for (const q of idBoxes) cover += (P.tagIdWeight * overlapArea(bx, q)) / (q.a > 0 ? q.a : boxArea(q) || 1);
      const balls = isPrev ? near : wide;
      if (balls.length) cover += (P.tagBallWeight * Math.max(...balls.map((q) => overlapArea(bx, q)))) / a;
      for (const q of labelBoxes) cover += (P.tagLabelWeight * overlapArea(bx, q)) / a;
      if (ringBox) cover += (P.tagRingWeight * overlapArea(bx, ringBox)) / a;
      for (const q of bodyBoxes) cover += (P.tagBodyWeight * overlapArea(bx, q)) / a;
      if (view) cover += P.tagOutWeight * (1 - overlapArea(bx, view) / a);
      const rank = (P.tagPlaceCost[place] ?? 0) + (P.tagFormCost[form] ?? 0), pref = rank + (0.01 * (Math.abs(dx) + Math.abs(dy))) / (full || 1);
      cands.push({ place: place === 'above' && dx ? 'edge' : place, form, dx, dy, cover, rank, cost: cover + pref, isPrev });
    }
  }
  if (!cands.length) return none;
  let best = cands[0];
  for (const c of cands) if (c.cost < best.cost - 1e-9) best = c;
  const stay = cands.find((c) => c.isPrev);
  let pick = best, held = false;
  if (stay && stay !== best) {
    // (nearer: a place or form it would rather be in, as clear: over the head again once the ball has gone)
    const moves = (keep, near) => best.cost < stay.cost - keep || (near && best.cover <= 1e-6 && best.rank < stay.rank - 1e-9);
    if (!moves(hold ? P.tagKeepHeld : P.tagKeep, !hold)) { pick = stay; held = hold && moves(P.tagKeep, true); }
  }
  // (A move back to nothing is above the head, whatever it was called.)
  const place = Math.abs(pick.dx) < 1e-9 && Math.abs(pick.dy) < 1e-9 ? 'above' : pick.place;
  const out = { place, form: pick.form, dx: place === 'above' ? 0 : pick.dx, dy: place === 'above' ? 0 : pick.dy, cost: Math.round(pick.cost * 1000) / 1000 };
  if (held) out.held = true; // (held where it is only by `hold`: once that is over it moves)
  return out;
}

/**
 * Where YOUR tag goes on Coach mode's discs (pure; view units round YOUR feet): as it did before the figures' tag
 * (tagPlacement) weighed everything every render, so Coach mode keeps its look. Only the ball (drawn over everything,
 * halo and all) moves it: above the token as always ('above'), else slid sideways just clear of the ball, on the side
 * away from it ('left' | 'right'), else lifted over it ('lift'), else slid the other way, whichever stays in view,
 * stays near YOU (at most `maxSlide` from above the token) and covers the fewest other discs (at most `othersMax` of
 * it; `others`: their boxes with the space just over them, where a tag reads as that player's). Nothing above fits:
 * just under the token ('below', given `base`), else a smaller slide that fits, else above as always. It keeps its side
 * while the ball is near, follows the ball's edge back as the ball goes and is above again once the ball is clear of
 * that spot by `back` more, at once (no hold, no smaller form). A moving ball is cleared where it will be when the
 * slide lands (`lead`). Wherever it goes it is slid inside the view across the screen ('edge' when that moves it from
 * above the token).
 * @param {{ ball: {x:number,y:number}|null, r?: number, tag: {x0:number,x1:number,y0:number,y1:number}, view?: object|null,
 *   prev?: string|null, clear?: number, back?: number, others?: object[] | (() => object[]), maxSlide?: number,
 *   lead?: {x:number,y:number}|null, othersMax?: number, base?: number }} m  (a function for `others` is only called
 *   when the ball is at the tag)
 * @returns {{ place: 'above'|'left'|'right'|'lift'|'below'|'edge', dx: number, dy: number }}
 */
export function discTagPlacement(m = {}, P = BOARD_DEFAULTS) {
  const at = discTagSpot(m, P);
  const { tag, view } = m;
  if (!tag || !view || !(view.x1 - view.x0 >= tag.x1 - tag.x0)) return at;
  const x0 = tag.x0 + at.dx, x1 = tag.x1 + at.dx;
  const dx = x0 < view.x0 ? view.x0 - x0 : x1 > view.x1 ? view.x1 - x1 : 0;
  return dx ? { place: at.place === 'above' ? 'edge' : at.place, dx: at.dx + dx, dy: at.dy } : at;
}

function discTagSpot({ ball, r = 0, tag, view = null, prev = null, clear = 0, back = 0, others = [], maxSlide = Infinity, lead = null, othersMax, base = 0 } = {}, P = BOARD_DEFAULTS) {
  const none = { place: 'above', dx: 0, dy: 0 };
  if (!isVec(ball) || !tag) return none;
  const most = Number.isFinite(othersMax) ? othersMax : P.tagOthersMax;
  const gap = r + clear;
  // The ball now and (moving) where it will be when the slide lands: the tag keeps clear of the path between.
  const to = isVec(lead) ? lead : ball;
  const path = [0, 0.25, 0.5, 0.75, 1].map((u) => ({ x: ball.x + (to.x - ball.x) * u, y: ball.y + (to.y - ball.y) * u }));
  const away = (box) => Math.min(...path.map((b) => Math.hypot(Math.max(box.x0 - b.x, 0, b.x - box.x1), Math.max(box.y0 - b.y, 0, b.y - box.y1))));
  const lo = { x: Math.min(ball.x, to.x), y: Math.min(ball.y, to.y) }, hi = { x: Math.max(ball.x, to.x) };
  const moved = { right: { dx: hi.x + gap - tag.x0, dy: 0 }, left: { dx: lo.x - gap - tag.x1, dy: 0 }, lift: { dx: 0, dy: lo.y - gap - tag.y1 } };
  const side = Object.hasOwn(moved, prev ?? '') ? prev : null;
  const d = away(tag);
  if (!(d < gap + (side ? back : 0))) return none;
  // Only the right way: right moves right, left left, a lift up (never onto the ball from the other side).
  const sign = (p, o) => (p === 'right' ? o.dx > 0 : p === 'left' ? o.dx < 0 : o.dy < 0);
  if (side && !(d < gap)) {
    // Clear of the tag's own spot, but not by `back` yet: stay on this side, easing back as the ball goes.
    const o = moved[side];
    const e = side === 'right' ? { dx: Math.max(0, o.dx), dy: 0 } : side === 'left' ? { dx: Math.min(0, o.dx), dy: 0 } : { dx: 0, dy: Math.min(0, o.dy) };
    return e.dx || e.dy ? { place: side, ...e } : none;
  }
  const fits = ({ dx, dy }) => !view || (tag.x0 + dx >= view.x0 && tag.x1 + dx <= view.x1 && tag.y0 + dy >= view.y0 && tag.y1 + dy <= view.y1);
  const near = ({ dx, dy }) => Math.abs(dx) <= maxSlide + 1e-9 && Math.abs(dy) <= maxSlide + 1e-9;
  const boxes = typeof others === 'function' ? others() ?? [] : others ?? [];
  const area = (tag.x1 - tag.x0) * (tag.y1 - tag.y0) || 1;
  // The share of the tag over other players (their discs and the space just over them).
  const cost = ({ dx, dy }) => boxes.reduce((a, b) => a + Math.max(0, Math.min(tag.x1 + dx, b.x1) - Math.max(tag.x0 + dx, b.x0)) * Math.max(0, Math.min(tag.y1 + dy, b.y1) - Math.max(tag.y0 + dy, b.y0)), 0) / area;
  const first = ball.x > 1e-9 ? 'left' : ball.x < -1e-9 ? 'right' : side === 'left' ? 'left' : 'right';
  let best = null;
  for (const p of [side, first, 'lift', first === 'left' ? 'right' : 'left']) {
    const o = p ? moved[p] : null;
    if (!o || !sign(p, o) || !fits(o) || !near(o)) continue;
    const c = cost(o);
    if (c > most) continue; // over someone else: it would name them (above YOU, under the ball, is better)
    if (!best || c < best.c - 1e-6) best = { p, o, c };
    if (c <= 1e-6) break; // the first that covers nobody (the side it is on first: no flicker)
  }
  if (best) return { place: best.p, ...best.o };
  // No spot above fits (the ball over YOU, players either side): just under YOUR token (`base`: YOUR disc and its glow
  // below the feet), still YOURS, if the ball and the other players leave room there.
  if (base > 0) {
    const o = { dx: 0, dy: base + clear - tag.y0 };
    const b = { x0: tag.x0, x1: tag.x1, y0: tag.y0 + o.dy, y1: tag.y1 + o.dy };
    if (fits(o) && !(away(b) < gap) && cost(o) <= most) return { place: 'below', ...o };
  }
  // Else a smaller slide, off the other players, so the ball covers less of the tag.
  for (const f of [0.75, 0.5, 0.25]) {
    for (const p of [first, first === 'left' ? 'right' : 'left']) {
      const o = { dx: moved[p].dx * f, dy: 0 };
      if (sign(p, o) && fits(o) && near(o) && cost(o) <= most) return { place: p, ...o };
    }
  }
  return none;
}

/** Metres from a figure's feet to its ball at its feet (carriedBallAt): a full carry offset, at scales k and kb. */
export const carryReach = ({ k = 1, kb = 1 } = {}, P = BOARD_DEFAULTS) => Math.hypot(0.55 * P.tokenRadius * k + 0.75 * P.ballRadius * kb, 0.28 * P.tokenRadius * k);

/**
 * How much of the carry offset a ball `d` metres from its carrier is drawn with (0..1): all of it within carryNear
 * (at the feet), none from carryDist (where it really is), in between in proportion, so a ball leaving the feet or
 * arriving at them is drawn moving, never jumping.
 */
export function carryWeight(d, P = BOARD_DEFAULTS) {
  if (!(d >= 0) || d >= P.carryDist) return 0;
  if (d <= P.carryNear) return 1;
  return (P.carryDist - d) / (P.carryDist - P.carryNear);
}

/** Vector `from` moved toward `to` by at most `max` (the drawn ball's offset sliding to where it belongs). */
export function stepToward(from, to, max) {
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
  if (!(d > max)) return { x: to.x, y: to.y };
  const u = max > 0 ? max / d : 0;
  return { x: from.x + dx * u, y: from.y + dy * u };
}

/** Does a token that moved `dist` metres since a render `dtMs` ago run? At least runMinSpeed (a move after a long
 *  gap runs for the ease that draws it); render noise and a jump to a new scene do not. */
export function isRunning(dist, dtMs, P = BOARD_DEFAULTS) {
  if (!(dist > P.runMinStep) || dist > P.runMaxJump) return false;
  if (!(dtMs > 0) || dtMs > P.runMaxGapMs) return true;
  return dist / (dtMs / 1000) >= P.runMinSpeed;
}

/** What moves on a board: under reduced motion no run cycle, a still halo and no camera easing. The ball's trail
 *  stays either way (it is drawn where the ball has been, not animated). */
export const motionPlan = (reduced) => Object.freeze({ runCycle: !reduced, haloPulse: !reduced, cameraEase: !reduced, trail: true });

/**
 * The ball's trail from its recent drawn positions (view units, `{ x, y, t }` oldest first, the last one now): the
 * point trailMs back along its path, or null when it is not moving at trailMinSpeed or more, or two renders were more
 * than trailMaxGapMs apart (its path between them is unknown).
 * @returns {{ tail: {x:number,y:number}, head: {x:number,y:number}, speed: number } | null}
 */
export function ballTrail(history, P = BOARD_DEFAULTS) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const head = history[history.length - 1];
  const since = head.t - P.trailMs;
  let len = 0, tail = head, i = history.length - 1;
  for (; i > 0; i--) {
    const a = history[i - 1], b = history[i];
    if (b.t - a.t > P.trailMaxGapMs || !(b.t > a.t)) break;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (a.t <= since) { // the trail ends inside this segment
      const u = (b.t - since) / (b.t - a.t);
      tail = { x: b.x + (a.x - b.x) * u, y: b.y + (a.y - b.y) * u, t: since };
      len += seg * u;
      break;
    }
    len += seg;
    tail = a;
  }
  const span = head.t - tail.t;
  if (!(span > 0)) return null;
  const speed = len / (span / 1000);
  return speed >= P.trailMinSpeed ? { tail: { x: tail.x, y: tail.y }, head: { x: head.x, y: head.y }, speed } : null;
}

/** WCAG relative luminance of a '#rgb' / '#rrggbb' colour (NaN for anything else). */
export function relLuminance(hex) {
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return NaN;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two colours (1..21). */
export function contrastRatio(a, b) {
  const [x, y] = [relLuminance(a), relLuminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** The ball's patches (in ball radii × `B`): a pentagon in the middle and five round the rim, between its corners. */
function ballPatchPath(B) {
  const at = (deg, r) => { const a = (deg * Math.PI) / 180; return `${f3(Math.cos(a) * r * B)} ${f3(Math.sin(a) * r * B)}`; };
  let d = `M${[0, 1, 2, 3, 4].map((i) => at(-90 + 72 * i, 0.42)).join('L')}Z`;
  for (let i = 0; i < 5; i++) {
    const c = -54 + 72 * i;
    d += `M${at(c - 11, 0.72)}L${at(c - 19, 0.97)}A${f3(0.97 * B)} ${f3(0.97 * B)} 0 0 1 ${at(c + 19, 0.97)}L${at(c + 11, 0.72)}Z`;
  }
  return d;
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
 *   youNumber?: number|null, figures?: boolean }} [opts]
 *   youLabel: the tag over the learner (default 'YOU'; the app passes the learner's nickname); render() can change it
 *   labels: what the tokens show by default: role codes (Coach mode) or unique shirt numbers (Player mode, §5)
 *   youNumber: in number mode, the number on YOUR token (a chosen kit number; default: the position's number)
 *   figures: players drawn as tabletop figures (Player mode, PROGRESSIVE_FIELD §4) instead of discs (Coach mode)
 */
export function createBoard(container, { orientation = 'auto', params, youLabel = 'YOU', labels = 'role', youNumber = null, figures = false } = {}) {
  const P = { ...BOARD_DEFAULTS, ...params };
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const uid = `board${Math.random().toString(36).slice(2, 8)}`;
  const defaultLabels = labels === 'number' ? 'number' : 'role';
  const figs = figures === true;

  const root = doc.createElement('div');
  root.className = figs ? 'board has-figures' : 'board';
  // The run cycle's length, single-sourced (css/figures.css animates with it).
  if (figs) root.style.setProperty('--fig-run-ms', `${FIGURE_DEFAULTS.runMs}ms`);
  // The ball's thin halo by the best-spot ring (css/figures.css .is-by-ghost), as a share of the full one: single-sourced.
  root.style.setProperty('--ball-halo-tight', String(f3(P.ballByGhostHalo / P.ballHalo)));
  const hint = doc.createElement('p');
  hint.id = `${uid}-hint`;
  hint.className = 'visually-hidden';
  hint.textContent = 'Drag to move. Or tap it, then tap a spot. With a keyboard, use the arrow keys; hold Shift for bigger steps.';
  root.appendChild(hint);

  const svg = svgEl(doc, 'svg', { class: 'board-svg', role: 'group', 'aria-label': 'Football pitch', preserveAspectRatio: 'xMidYMid meet' }, root);
  const world = svgEl(doc, 'g', { class: 'board-world' }, svg);
  const pitchG = drawPitch(world, { margin: P.margin, stripes: P.stripes });
  // The grass under all the board shows while a camera is on (syncFarSurround): behind the pitch's own grass.
  const farSurround = svgEl(doc, 'rect', { class: 'pitch-surround pitch-surround--far', display: 'none' });
  pitchG.insertBefore(farSurround, pitchG.firstChild);
  // The heatmap grid can reach past the touchlines; clip it to the pitch (in world units, so it rotates too).
  const clip = svgEl(doc, 'clipPath', { id: `${uid}-pitch` }, svgEl(doc, 'defs', {}, world));
  svgEl(doc, 'rect', { x: 0, y: 0, width: LENGTH, height: WIDTH }, clip);
  const heatLayer = svgEl(doc, 'g', { class: 'board-heat', 'clip-path': `url(#${uid}-pitch)` }, world);
  const overlayW = svgEl(doc, 'g', { class: 'board-overlays' }, world);
  const zoneEl = svgEl(doc, 'ellipse', { class: 'board-zone', display: 'none' }, world);
  const markersW = svgEl(doc, 'g', { class: 'board-markers' }, world);
  const ghostEl = svgEl(doc, 'g', { class: 'board-ghost', display: 'none' }, world);
  const ghostRing = svgEl(doc, 'circle', { class: 'ghost-ring', r: P.tokenRadius + 0.5 }, ghostEl);
  svgEl(doc, 'circle', { class: 'ghost-dot', r: 0.35 }, ghostEl);

  // The aid ring on YOU (setAid) sits under the markers; it is its own group, so setMarkers never clears it.
  const aidLayer = svgEl(doc, 'g', { class: 'board-aid-layer' }, world);
  world.insertBefore(aidLayer, markersW);
  const aidEl = svgEl(doc, 'circle', { class: 'board-aid', display: 'none' }, aidLayer);

  const view = svgEl(doc, 'g', { class: 'board-view' }, svg);
  // The ball's trail fades from nothing at its tail to the ball (a gradient along it, set per render in the ball's units).
  const trailGrad = svgEl(doc, 'linearGradient', { id: `${uid}-trail`, gradientUnits: 'userSpaceOnUse' }, svgEl(doc, 'defs', {}, view));
  svgEl(doc, 'stop', { class: 'ball-trail-stop ball-trail-stop--tail', offset: 0 }, trailGrad);
  svgEl(doc, 'stop', { class: 'ball-trail-stop ball-trail-stop--head', offset: 1 }, trailGrad);
  const overlayLabels = svgEl(doc, 'g', { class: 'board-overlay-labels' }, view);
  // Tap targets ("Who's open?") are rings on the ground round a teammate's feet: under the figures, so a ring (the
  // focus ring too) never crosses the shirt number a screen reader just read out ('Teammate, number 5'). A tap is
  // found by distance (targetAt), so the layer order never changes what a tap hits.
  const targetLayer = svgEl(doc, 'g', { class: 'board-targets' }, view);
  const tokenLayer = svgEl(doc, 'g', { class: 'board-tokens' }, view);
  // Figures: the best-spot ring (the ghost) is the answer the kid is told to copy, so it is drawn over the figures (a
  // pressing spot lies right by the ball and the carrier: under them, and the ball's halo, it read as the halo). Only
  // the ball is drawn over it (a layer of its own, over everything: never hidden), with its halo faded while it is by
  // the ring (syncGhostBall). Coach mode's discs keep the ring on the grass, under the tokens.
  if (figs) view.insertBefore(ghostEl, null);
  const ballLayer = svgEl(doc, 'g', { class: 'board-ball' }, view);
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
  let compactK = 1; // YOUR tag's compact forms, this much smaller than the pill (their "YOU" at least tagCompactPx: compactScale)
  const player = defaultLabels === 'number'; // Player mode's sizes: labels and YOUR tag big enough to read on a phone
  let ghostAt = null;
  let ghostR = 0; // the best-spot ring's radius as drawn now (view units: ghostFit may have grown it round the ball)
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
  let figK = 1; // figures: how much bigger than life the figure on each base disc is drawn (figureScale; discs: = scale)
  let ballK = 1; // the ball's scale (ballScale on every board: at least ballMinPx across)
  let camera = null; // the world rect setCamera fits, or null (setFocus's crop, or the whole pitch)
  let camAnim = null; // the camera easing to its window: { from: viewBox, t0, raf, timer }
  let decorStale = false; // labels, markers and overlays not redrawn for the current layout yet (skipped while the camera eases)
  let measured = null; // the last measure() (a camera frame reuses it)
  let settling = null; // the carried ball or a decluttered figure still sliding after the last render: { raf, timer }
  let dead = false; // destroyed (a camera's refit queued before it does nothing)
  const ballHist = []; // the ball's recent drawn positions { x, y, t } (view units), for its trail
  let runTimer = 0; // stops the run cycles (and the trail) once renders stop
  const rmq = (() => { try { return win?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null; } catch { return null; } })();
  /** Reduced motion, from the device or the page (settings: data-reduced-motion). */
  const reduced = () => doc.documentElement?.dataset?.reducedMotion === 'true' || !!rmq?.matches;
  const clock = () => win?.performance?.now?.() ?? Date.now();

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

  /** A figure's size on its base, in the token's (base disc's) units: figK / scale. */
  const figRel = () => figK / (scale || 1);

  /** Where the tag sits (in the token's units): above the token (a figure: above its head), drawn tagK times its life
   *  size (Player mode). */
  const tagCentre = () => -((figs ? FIGURE.height * P.tokenRadius * figRel() + 0.45 : P.tokenRadius + 1.15) + 1.05 * tagK);
  const tagTransform = () => `translate(0 ${f3(tagCentre())})${tagK === 1 ? '' : ` scale(${tagK})`}`;
  /** The compact forms (a "YOU" chevron, a chevron alone) stand on the pill's bottom edge, compactK times its size. */
  const miniTransform = () => `translate(0 1.05)${compactK === 1 ? '' : ` scale(${compactK})`}`;
  function placeYouTag(t) {
    const tx = tagTransform();
    if (t.tagG.getAttribute('transform') !== tx) t.tagG.setAttribute('transform', tx);
    const mx = miniTransform();
    for (const g of t.mini) if (g.getAttribute('transform') !== mx) g.setAttribute('transform', mx);
  }

  /** How big the compact forms are drawn, in the pill's units: their "YOU" at least tagCompactPx tall, never bigger than
   *  the pill's own text (at sizes k, kt and px CSS px per metre; 1 unmeasured). */
  const compactScale = (k = scale, kt = tagK, px = pxm) => (px > 0 ? Math.min(1, up2(P.tagCompactPx / (1.15 * kt * (k || 1) * px))) : 1);

  function setYouLabel(label) {
    const next = youTag(label);
    if (next.text === you.text) return;
    you = next;
    for (const t of tokens.values()) if (t.tagG) drawYouTag(t.tagG);
    syncTag();
  }

  /**
   * YOUR tag's box above the head in one of its forms (TAG_FORMS), in view units round YOUR feet, at the sizes `L`
   * ({ k, kf, kt, cK }: the board's now unless given): the pill as it is, the compact forms on its bottom edge.
   */
  function tagFormBox(form = 'full', L = { k: scale, kf: figK, kt: tagK, cK: compactK }) {
    const u = L.kt * L.k; // view units to one of the tag's own
    const cy = -((figs ? FIGURE.height * P.tokenRadius * L.kf + 0.45 * L.k : (P.tokenRadius + 1.15) * L.k) + 1.05 * u);
    const sh = TAG_SHAPES[form];
    if (!sh) { const hw = (you.width / 2) * u, hh = 1.05 * u; return { x0: -hw, x1: hw, y0: cy - hh, y1: cy + hh }; }
    const c = L.cK ?? 1;
    return { x0: -sh.hw * c * u, x1: sh.hw * c * u, y0: cy + (1.05 + sh.y0 * c) * u, y1: cy + (1.05 + sh.y1 * c) * u };
  }
  /** YOUR tag's box above the head as a pill (view units round YOUR feet). */
  const tagBox = () => tagFormBox('full');
  let tagAt = { place: 'above', form: 'full', dx: 0, dy: 0 }; // where YOUR tag is (tagPlacement): its form, its move from above the head
  let tagOwner = null; // the token whose tag was last placed (a new learner starts above)
  let tagMovedAt = -Infinity; // when it last changed place or form (tagDwellMs)
  let tagTimer = 0; // a look again once a hold is over (syncTag)
  let labelBoxes = null; // the marker labels as drawn (view units), measured once after setMarkers: YOUR tag keeps off them

  /** The ball's drawn radius at the top of its halo's pulse (css/figures.css: 1.16), with the halo's rim; by the best-spot
   *  ring, its thin halo (ballByGhostHalo). */
  const ballReach = () => (tokens.get(BALL_ID)?.byGhost ? P.ballByGhostHalo * P.ballRadius + 0.2 : 1.16 * P.ballHalo * P.ballRadius + 0.25) * (ballK || 1);
  /** The ball's full halo at the top of its pulse, with its rim (view units). */
  const haloReach = () => (1.16 * P.ballHalo * P.ballRadius + 0.25) * (ballK || 1);

  /** Show YOUR tag in one of its forms (css/figures.css). */
  function setTagForm(t, form) {
    if ((t.tagForm ?? 'full') === form) return;
    t.shift.classList.toggle('is-compact', form === 'compact');
    t.shift.classList.toggle('is-mark', form === 'mark');
    t.tagForm = form;
  }

  /**
   * Put YOUR tag where it covers least (tagPlacement): of its places round YOUR head and its forms, the one clear of the
   * other players' heads and numbers, the ball, the best-spot ring and the labels, and in view; it keeps its place unless
   * another is clearly better (and, just after a move, much better: tagDwellMs), so it never flickers. Cheap (a few
   * hundred box sums a render); the DOM is written only when it moves, and it slides there (css/figures.css; at once
   * under reduced motion or while the layout changes). Coach mode's discs keep the tag as before: over the token, slid
   * clear of the ball only while the ball would cover it (discTagPlacement).
   */
  function syncTag() {
    const t = opts.learnerId ? tokens.get(opts.learnerId) : null;
    if (tagOwner && tagOwner !== t) {
      if (tagOwner.shiftTx) { tagOwner.shift.style.transform = ''; tagOwner.shiftTx = ''; }
      setTagForm(tagOwner, 'full');
      tagAt = { place: 'above', form: 'full', dx: 0, dy: 0 };
      tagMovedAt = -Infinity;
    }
    tagOwner = t?.shift ? t : null;
    if (!tagOwner || !t.pos) return;
    const now = clock();
    const v = project(t.pos, orient);
    const b = tokens.get(BALL_ID);
    const bv = b?.at && b.g.getAttribute('display') !== 'none' ? project(b.at, orient) : null;
    const px = pxm > 0 ? 1 / pxm : 0.2;
    const tag = tagBox();
    // A moving ball: where it will be once the tag's slide (css/figures.css) lands, so it never runs over the pill.
    const vel = bv && !reduced() ? ballVelocity() : null;
    const lead = vel ? { x: bv.x - v.x + vel.x * (P.tagSlideMs / 1000), y: bv.y - v.y + vel.y * (P.tagSlideMs / 1000) } : null;
    const view = vb ? { x0: vb.x - v.x, x1: vb.x + vb.width - v.x, y0: vb.y - v.y, y1: vb.y + vb.height - v.y } : null;
    if (!figs) {
      // Coach mode's discs keep their tag as it was (Coach mode unchanged but for the bigger ball): over the token, moved
      // only while the ball would cover it and back at once when it has gone; the pill always (discTagPlacement).
      const at = discTagPlacement({
        ball: bv ? { x: bv.x - v.x, y: bv.y - v.y } : null, r: haloReach(), tag, prev: tagAt.place, view,
        clear: P.tagClearPx * px, back: P.tagBackPx * px, lead,
        maxSlide: P.tagMaxSlide * (tag.x1 - tag.x0), others: () => othersRound(t, v, (tag.y1 - tag.y0) * P.tagDiscZone).ids,
        base: (P.tokenRadius + 1.5) * (scale || 1), // YOUR disc and its glow (.token-glow), below it
      }, P);
      tagAt = { ...at, form: 'full' };
      const u = tagK * (scale || 1);
      const tx = at.place === 'above' ? '' : `translate(${f3(at.dx / u)}px, ${f3(at.dy / u)}px)`;
      if (tx !== t.shiftTx) { t.shift.style.transform = tx; t.shiftTx = tx; }
      return;
    }
    const { ids, bodies } = othersRound(t, v, (tag.y1 - tag.y0) * P.tagHeadZone);
    const gv = figs && ghostAt && !ghostEl.hasAttribute('display') ? project(ghostAt, orient) : null; // (discs: the ring is on the grass, under the tag)
    const next = tagPlacement({
      tag, forms: { compact: tagFormBox('compact'), mark: tagFormBox('mark') },
      head: figs ? { y: FIGURE.head.y * P.tokenRadius * figK, half: FIGURE_BOXES.head.x1 * P.tokenRadius * figK } : { y: 0, half: (P.tokenRadius + 0.3) * scale },
      ball: bv ? { x: bv.x - v.x, y: bv.y - v.y } : null, r: ballReach(), lead, clear: P.tagClearPx * px, back: P.tagBackPx * px,
      ring: gv ? { x: gv.x - v.x, y: gv.y - v.y, r: ghostR } : null,
      labels: markerBoxes().map((q) => shiftBox(q, -v.x, -v.y)), ids, bodies, view,
      base: (P.tokenRadius + 1.5) * (scale || 1), // YOUR base and its glow (.token-glow), below the feet
      prev: tagAt, hold: now - tagMovedAt < P.tagDwellMs,
    }, P);
    if (next.place !== tagAt.place || next.form !== tagAt.form) tagMovedAt = now;
    tagAt = next;
    // Held just after a move: look again once the hold is over, in case the renders have stopped (a freeze).
    clearTimeout(tagTimer);
    tagTimer = next.held ? setTimeout(syncTag, Math.max(0, P.tagDwellMs - (now - tagMovedAt)) + 20) : 0;
    setTagForm(t, next.form);
    const side = next.place === 'below' || next.place.startsWith('beside');
    if (side !== !!t.tagSide) { t.shift.classList.toggle('is-beside', side); t.tagSide = side; } // (no chevron: css/figures.css)
    const turn = next.form === 'mark' ? MARK_TURN[next.place] ?? 0 : 0; // (the chevron alone turned to point at YOU)
    if (turn !== (t.markTurn ?? 0)) { if (turn) t.markPath.setAttribute('transform', `rotate(${turn} 0 -0.6)`); else t.markPath.removeAttribute('transform'); t.markTurn = turn; }
    const u = tagK * (scale || 1);
    const tx = next.dx || next.dy ? `translate(${f3(next.dx / u)}px, ${f3(next.dy / u)}px)` : '';
    if (tx !== t.shiftTx) { t.shift.style.transform = tx; t.shiftTx = tx; }
  }

  /**
   * The other players drawn, round YOUR feet `v` (view units): `ids`, what says who they are, a figure's head and shirt
   * number (a disc: the disc, its code) with `over` more above it, where a name tag reads as theirs (`a`: the head and
   * number's own area); `bodies`, the rest of each figure.
   */
  function othersRound(me, v, over) {
    const ids = [], bodies = [];
    const s = P.tokenRadius * figK, r = (P.tokenRadius + 0.3) * scale;
    for (const t of tokens.values()) {
      if (t === me || t.id === BALL_ID || !t.pos || t.g.getAttribute('display') === 'none') continue;
      const p = project(t.at ?? t.pos, orient), f = { x: p.x - v.x, y: p.y - v.y };
      if (figs) {
        const q = figureParts(f, s);
        const id = { x0: Math.min(q.head.x0, q.number.x0), x1: Math.max(q.head.x1, q.number.x1), y0: q.head.y0, y1: q.number.y1 };
        ids.push({ ...id, y0: id.y0 - over, a: boxArea(id) });
        bodies.push({ x0: q.all.x0, x1: q.all.x1, y0: id.y1, y1: q.all.y1 });
      } else {
        const d = { x0: f.x - r, x1: f.x + r, y0: f.y - r, y1: f.y + r };
        ids.push({ ...d, y0: d.y0 - over, a: boxArea(d) });
      }
    }
    return { ids, bodies };
  }

  /** The marker labels as drawn (view units; measured once after setMarkers, and again while none was measured). */
  function markerBoxes() {
    if (!labelBoxes || (!labelBoxes.length && markerLabels.children.length)) labelBoxes = [...markerLabels.children].map(boxOf).filter(Boolean);
    return labelBoxes;
  }

  /** The ball's velocity as drawn (view units per second) over its last few renders, or null when it is still. */
  function ballVelocity() {
    const n = ballHist.length;
    if (n < 2) return null;
    const head = ballHist[n - 1];
    let i = n - 2;
    while (i > 0 && head.t - ballHist[i - 1].t <= P.tagVelMs) i--;
    const a = ballHist[i], dt = (head.t - a.t) / 1000;
    if (!(dt > 0) || head.t - a.t > P.trailMaxGapMs) return null;
    const vx = (head.x - a.x) / dt, vy = (head.y - a.y) / dt;
    return Math.hypot(vx, vy) > 1 ? { x: vx, y: vy } : null;
  }

  /**
   * What is drawn for a token, as a box in view units (pure sums): a player from its base up to its head (a disc: the
   * disc) where it is drawn (a figure moved clear of another: declutter) and, for YOU, YOUR tag where it is and in the
   * form it has (above the head, or moved: tagAt); the ball with its halo. At the sizes `L` ({ k, kf, kt, kb, cK }: the
   * board's now, or once the camera lands).
   */
  function boxOfToken(t, L) {
    const v = project(t.at ?? t.pos, orient);
    if (t.id === BALL_ID) {
      const h = (1.16 * P.ballHalo * P.ballRadius + 0.25) * L.kb;
      return { x0: v.x - h, x1: v.x + h, y0: v.y - h, y1: v.y + h };
    }
    const r = (P.tokenRadius + 0.3) * L.k;
    const hw = figs ? Math.max(r, FIGURE.halfWidth * P.tokenRadius * L.kf) : r;
    const box = { x0: v.x - hw, x1: v.x + hw, y0: v.y - (figs ? Math.max(r, FIGURE.height * P.tokenRadius * L.kf) : r), y1: v.y + r };
    if (t.id !== opts.learnerId || !t.shift) return box;
    // YOUR tag (in its form, at these sizes), moved as it is drawn now.
    const m = tagOwner === t ? tagAt : { form: 'full', dx: 0, dy: 0 };
    const tb = tagFormBox(m.form, L);
    const u = L.k * L.kt / ((scale || 1) * (tagK || 1)); // the move was worked out at the sizes drawn now
    return {
      x0: Math.min(box.x0, v.x + tb.x0 + m.dx * u), x1: Math.max(box.x1, v.x + tb.x1 + m.dx * u),
      y0: Math.min(box.y0, v.y + tb.y0 + m.dy * u), y1: Math.max(box.y1, v.y + tb.y1 + m.dy * u),
    };
  }

  /** The window the board shows, or is easing to (a camera), and the sizes it will draw at there. */
  function landing() {
    const box = (measured ?? measure()).box;
    const land = camera ? cameraVb(orient, box) : vb;
    if (!land) return null;
    const px = pxPerMetre(box, land);
    const s = boardScales(px, { figures: figs, player, camera: !!camera }, P);
    return { vb: land, box, s: { ...s, cK: compactScale(s.k, s.kt, px) } };
  }

  /**
   * What is drawn for token `id`, as a box in view units ({ x0, x1, y0, y1 }), or null when it is not drawn: now, or
   * (`landed`) once the camera has landed on the window it is easing to.
   */
  function drawnBox(id, { landed = false } = {}) {
    const t = tokens.get(id);
    if (!t?.pos || t.g.getAttribute('display') === 'none') return null;
    const L = landed ? landing()?.s : null;
    return boxOfToken(t, L ?? { k: scale, kf: figK, kt: tagK, kb: ballK, cK: compactK });
  }

  /**
   * Where token `id` will be drawn on the screen once the camera has landed (CSS px, { left, top, right, bottom }; the
   * window the board is easing to, at the sizes it will have there), or null when it is not drawn. A card over the
   * pitch keeps off YOU and the ball with it (play.js).
   */
  function clientBox(id) {
    const t = tokens.get(id);
    const L = t?.pos && t.g.getAttribute('display') !== 'none' ? landing() : null;
    if (!L) return null;
    const { vb: land, box, s } = L;
    const b = boxOfToken(t, s);
    let r = null;
    try { r = svg.getBoundingClientRect?.() ?? null; } catch { r = null; }
    const W = r?.width > 0 ? r.width : box.width, H = r?.height > 0 ? r.height : box.height;
    const k = Math.min(W / land.width, H / land.height); // preserveAspectRatio: xMidYMid meet
    const ox = (r?.left ?? 0) + (W - land.width * k) / 2 - land.x * k, oy = (r?.top ?? 0) + (H - land.height * k) / 2 - land.y * k;
    return { left: ox + b.x0 * k, right: ox + b.x1 * k, top: oy + b.y0 * k, bottom: oy + b.y1 * k };
  }

  /** YOUR tag's box where it is drawn now, in the form it has (view units), or null. */
  function tagBoxNow() {
    const t = opts.learnerId ? tokens.get(opts.learnerId) : null;
    if (!t?.pos) return null;
    const m = tagOwner === t ? tagAt : { form: 'full', dx: 0, dy: 0 };
    const v = project(t.pos, orient), b = tagFormBox(m.form);
    return { x0: v.x + b.x0 + m.dx, x1: v.x + b.x1 + m.dx, y0: v.y + b.y0 + m.dy, y1: v.y + b.y1 + m.dy };
  }

  function makeToken(id) {
    const isBall = id === BALL_ID;
    const team = isBall ? null : parsePlayerId(id).team;
    const g = svgEl(doc, 'g', { class: isBall ? 'token token-ball' : `token team-${team}`, 'data-id': id, 'aria-hidden': 'true' }, isBall ? ballLayer : tokenLayer);
    const t = { id, g, pos: null, at: null, tx: '', flags: '', aria: '', facing: team === 'them' ? -1 : 1, depth: 0 };
    if (isBall) {
      // Every board (Coach mode's discs too: the owner's "impossible to see" was about every pitch), over everything
      // (ensureStacking): a fading trail while it flies, a ground shadow, a bright halo (a yellow ring with a dark rim
      // either side, so it reads on light grass, light kits and YOUR gold base), the ball with a thick dark outline.
      const B = P.ballRadius, H = P.ballHalo * B;
      t.trail = svgEl(doc, 'polygon', { class: 'ball-trail', fill: `url(#${uid}-trail)`, display: 'none' }, g);
      svgEl(doc, 'ellipse', { class: 'ball-shadow', cx: f3(0.14 * B), cy: f3(0.7 * B), rx: f3(1.05 * B), ry: f3(0.45 * B) }, g);
      const halo = svgEl(doc, 'g', { class: 'ball-halo' }, g);
      svgEl(doc, 'circle', { class: 'ball-halo-rim', r: f3(H) }, halo);
      svgEl(doc, 'circle', { class: 'ball-halo-ring', r: f3(H) }, halo);
      svgEl(doc, 'circle', { class: 'token-ring', r: f3(H + 0.3) }, g);
      svgEl(doc, 'circle', { class: 'ball-body', r: B }, g);
      svgEl(doc, 'path', { class: 'ball-patch', d: ballPatchPath(B) }, g);
      svgEl(doc, 'circle', { class: 'token-focus', r: f3(H + 0.55) }, g);
    } else {
      const R = P.tokenRadius;
      // Invisible: how far a press still counts as on this token (sized in syncHit), so the token's box is the size of
      // what you can hit (at least minHitPx across).
      t.hit = svgEl(doc, 'circle', { class: 'token-hit', r: R, fill: 'none', stroke: 'none' }, g);
      svgEl(doc, 'circle', { class: 'token-glow', r: R + 1.5 }, g);
      svgEl(doc, 'circle', { class: 'token-ring', r: R + 0.75 }, g);
      svgEl(doc, 'circle', { class: 'token-carrier', r: R + 0.45 }, g);
      svgEl(doc, 'circle', { class: 'token-body', r: R }, g); // a figure's base disc
      const text = labelOf(id);
      if (figs) {
        // The figure stands on the base: its look is the player's own, its kit the team's (css/figures.css).
        // Its base disc is the token (a disc's size, `scale`); the figure alone is drawn figK times life size (syncFigure).
        t.fig = drawFigure(g, { ...figureLook(id, team), number: text, gk: isKeeperId(id), facing: t.facing, size: R, base: false, run: true });
        t.flip = t.fig.querySelector('.fig-body');
        t.code = t.fig.querySelector('.fig-num');
        g.style.setProperty('--fig-run-delay', `${runDelay(id)}ms`);
        syncFigure(t);
      } else {
        t.code = svgEl(doc, 'text', { class: codeClass(text), 'text-anchor': 'middle', dy: '0.36em' }, g);
        t.code.textContent = text;
      }
      t.label = text;
      const tag = svgEl(doc, 'g', { class: 'token-you', transform: tagTransform() }, g);
      t.tagG = tag;
      // The tag sits in a group of its own that moves it where it covers least (syncTag); a CSS translate in the tag's
      // own units, so it slides there (css/figures.css) and zooms with the tag. Its forms: the pill with YOUR nickname,
      // and for a crowd a compact "YOU" chevron and a chevron alone (css/figures.css shows one: .is-compact, .is-mark),
      // both standing on the pill's bottom edge, compactK times its size.
      t.shift = svgEl(doc, 'g', { class: 'token-you-shift' }, tag);
      t.shiftTx = '';
      t.tagForm = 'full';
      svgEl(doc, 'rect', { y: -1.05, height: 2.1, rx: 1.05 }, t.shift);
      svgEl(doc, 'text', { 'text-anchor': 'middle', dy: '0.36em' }, t.shift);
      const C = TAG_SHAPES.compact, top = -C.y0, tip = 0.72; // the chevron under the compact pill
      const compact = svgEl(doc, 'g', { class: 'you-compact', transform: miniTransform() }, t.shift);
      svgEl(doc, 'rect', { class: 'you-compact-pill', x: -C.hw, y: -top, width: f3(2 * C.hw), height: f3(top - tip), rx: f3((top - tip) / 2) }, compact);
      svgEl(doc, 'text', { class: 'you-compact-text', 'text-anchor': 'middle', y: f3(-(top + tip) / 2), dy: '0.36em' }, compact).textContent = 'YOU';
      svgEl(doc, 'path', { class: 'you-chevron', d: `M-0.7 ${-tip - 0.02}L0 0L0.7 ${-tip - 0.02}Z` }, compact);
      const mark = svgEl(doc, 'g', { class: 'you-mark', transform: miniTransform() }, t.shift);
      t.markPath = svgEl(doc, 'path', { class: 'you-chevron', d: 'M-0.9 -1.2L0.9 -1.2L0 0Z' }, mark);
      t.mini = [compact, mark];
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

  /** Where a player is drawn (world): its spot `p`, moved by its declutter offset (figures: t.off, view units) if any. */
  function drawnSpot(t, p = t.pos) {
    if (!t.off || (!t.off.x && !t.off.y) || t.id === BALL_ID) return p;
    const v = project(p, orient);
    return unproject({ x: v.x + t.off.x, y: v.y + t.off.y }, orient);
  }

  /** Place a token at world point p (where it is), drawn at `at` (the ball at a carrier's feet; else p, or with figures
   *  p moved clear of another figure: drawnSpot). */
  function placeToken(t, p, at = null) {
    t.pos = { x: p.x, y: p.y };
    t.at = at ? { x: at.x, y: at.y } : drawnSpot(t, t.pos);
    const tx = transformAt(t.at, t.id === BALL_ID ? ballK : scale);
    if (tx !== t.tx) { t.g.style.transform = tx; t.tx = tx; }
    if (drag.ids.has(t.id)) {
      const aria = `${nameOf(t.id)}, ${spotText(p)}`;
      if (aria !== t.aria) { t.g.setAttribute('aria-label', aria); t.aria = aria; }
    }
  }

  /** A figure's size on its base disc: figK times life size, in the token's units (the token is drawn `scale` times). */
  function syncFigure(t) {
    if (!t.fig) return;
    const tx = `scale(${f3(P.tokenRadius * figRel())})`;
    if (t.figTx !== tx) { t.fig.setAttribute('transform', tx); t.figTx = tx; }
  }

  /** The CSS transform that draws a token (or anything token-sized) at world point p, `k` times life size. */
  function transformAt(p, k = scale) {
    const v = project(p, orient);
    return `translate(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px)${k === 1 ? '' : ` scale(${k})`}`;
  }

  /** Keep a token's text in step with the label mode (role codes or shirt numbers). Cached: cheap per render. */
  function syncLabel(t) {
    if (!t.code) return;
    const text = labelOf(t.id);
    if (text === t.label) return;
    t.label = text;
    t.code.textContent = text;
    if (t.fig) t.code.setAttribute('font-size', numberFontSize(text));
    else t.code.setAttribute('class', codeClass(text));
  }

  /** Face a figure left (-1) or right (1) on the screen: its body is mirrored, its number never is. */
  function setFacing(t, f) {
    if (f === t.facing) return;
    t.facing = f;
    if (!t.flip) return;
    if (f < 0) t.flip.setAttribute('transform', 'scale(-1 1)'); else t.flip.removeAttribute('transform');
  }

  /** Run cycle on or off (css/figures.css shows the two running poses in turn while .is-running). */
  function setRunning(t, on) {
    if (on === !!t.running) return;
    t.running = on;
    t.g.classList.toggle('is-running', on);
  }

  /** Stop every run cycle and the ball's trail (renders stopped: nothing is moving any more). */
  function stopMotion() {
    clearTimeout(runTimer);
    runTimer = 0;
    for (const t of tokens.values()) { t.runUntil = 0; setRunning(t, false); }
    ballHist.length = 0;
    drawTrail(null);
  }

  /**
   * Where the ball is drawn at `now` (world), advancing its carry offset (figures; Coach mode's discs: where it is). A
   * figure's ball at its feet is drawn beside its boots on the side it faces (carriedBallAt), a ball leaving or reaching
   * the feet partly so (carryWeight), and the offset slides toward that at most one full carry offset per carryEaseMs:
   * taking the ball, letting it go, the carrier turning or the camera zooming never make it jump. `snap` (a new scene
   * or layout, a hand on the ball) draws it in place at once.
   */
  function carryBall(t, now, snap = false) {
    if (!t?.pos) return t?.pos ?? null;
    let want = { x: 0, y: 0 };
    const c = t.heldBy ? tokens.get(t.heldBy) : null;
    if (c?.pos && c.g.getAttribute('display') !== 'none') {
      const w = carryWeight(Math.hypot(t.pos.x - c.pos.x, t.pos.y - c.pos.y), P);
      if (w > 0) {
        // Figures: at the carrier's feet as drawn, on the side that covers least of the others (carrySpot); discs: in
        // front of the disc, clear of its code.
        const feet = figs ? carriedSpot(t, c) : discBallAt(c.pos, t.heldDir, { k: scale, kb: ballK }, P);
        want = { x: w * (feet.x - t.pos.x), y: w * (feet.y - t.pos.y) };
      }
    }
    const reach = figs ? carryReach({ k: figK, kb: ballK }, P) : discCarry({ k: scale, kb: ballK }, P);
    const gap = now - (t.carryAt ?? -Infinity);
    t.carry = snap || !t.carry || !(gap >= 0 && gap <= P.carrySnapMs) ? want
      : stepToward(t.carry, want, (reach * gap) / P.carryEaseMs);
    t.carryAt = now;
    t.carryWant = want;
    return { x: t.pos.x + t.carry.x, y: t.pos.y + t.carry.y };
  }

  /**
   * Figures: where the ball at carrier `c`'s feet is drawn (world): round the carrier's feet as drawn, on the side that
   * covers least of the other players' heads and numbers, then their figures (carrySpot: ahead, at the toes or behind;
   * the side it was on while that is no worse, b.carrySide).
   */
  function carriedSpot(b, c) {
    const v = project(c.at ?? c.pos, orient);
    const s = P.tokenRadius * figK, far = 6 * s;
    const ids = [], bodies = [];
    for (const o of tokens.values()) {
      if (o === c || o.id === BALL_ID || !o.pos || o.g.getAttribute('display') === 'none') continue;
      const p = project(o.at ?? o.pos, orient);
      if (Math.abs(p.x - v.x) > far || Math.abs(p.y - v.y) > far) continue; // too far to be covered
      const q = figureParts({ x: p.x - v.x, y: p.y - v.y }, s);
      ids.push(q.head, q.number);
      bodies.push(q.torso, q.legs);
    }
    const view = vb ? { x0: vb.x - v.x, x1: vb.x + vb.width - v.x, y0: vb.y - v.y, y1: vb.y + vb.height - v.y } : null;
    const spot = carrySpot({ facing: c.facing, k: figK, kb: ballK, ids, bodies, view, prev: b.carrySide ?? null }, P);
    b.carrySide = spot.side;
    return unproject({ x: v.x + spot.x, y: v.y + spot.y }, orient);
  }

  /** Is the ball still sliding to where it is drawn (carryBall)? */
  const ballSliding = (t) => !!(t?.carry && t.carryWant) && Math.hypot(t.carry.x - t.carryWant.x, t.carry.y - t.carryWant.y) > 1e-3;

  /**
   * Figures in close quarters (display only): the declutter's offsets for the players drawn now. `retarget`: work out
   * where each should be drawn (declutter: from their spots, YOU fixed, at the figures' size now); then each offset slides
   * there, a full declutterMax per declutterEaseMs (from one render to the next at most 50 ms of it, so a render after a
   * pause starts the slide rather than jumping; settle carries it on), or at once (`snap`: a new scene, a new layout).
   * A player not drawn keeps none. Returns the players whose offset changed.
   */
  function syncDeclutter(now, { retarget = true, snap = false } = {}) {
    const moved = [];
    if (!figs) return moved;
    const shown = [];
    for (const t of tokens.values()) {
      if (t.id === BALL_ID) continue;
      if (t.pos && t.g.getAttribute('display') !== 'none') shown.push(t);
      else if (t.off) { t.off = null; t.offWant = null; }
    }
    if (retarget) {
      const figsNow = shown.map((t) => ({ id: t.id, ...project(t.pos, orient), fixed: t.id === opts.learnerId }));
      const want = declutter(figsNow, { s: P.tokenRadius * figK, max: P.declutterMax, aim: P.declutterAim, iters: P.declutterIters, slop: P.depthSlop });
      for (const t of shown) t.offWant = want.get(t.id) ?? { x: 0, y: 0 };
    }
    for (const t of shown) {
      if (t.id === opts.learnerId) { // YOU: always exactly where you stand (at once, even if you were someone else a moment ago)
        if (t.off && (t.off.x || t.off.y)) moved.push(t);
        t.off = { x: 0, y: 0 };
        t.offWant = t.off;
        t.offAt = now;
        continue;
      }
      const w = t.offWant ?? { x: 0, y: 0 }, was = t.off ?? { x: 0, y: 0 };
      const gap = Math.min(50, Math.max(0, now - (t.offAt ?? now)));
      const next = snap || !t.off ? { x: w.x, y: w.y } : stepToward(was, w, (P.declutterMax * gap) / P.declutterEaseMs);
      t.offAt = now;
      if (Math.abs(next.x - was.x) > 1e-4 || Math.abs(next.y - was.y) > 1e-4) moved.push(t);
      t.off = next;
    }
    return moved;
  }
  /** Is a figure still sliding to where the declutter draws it? */
  const offSliding = () => { for (const t of tokens.values()) if (t.off && t.offWant && Math.hypot(t.off.x - t.offWant.x, t.off.y - t.offWant.y) > 1e-3) return true; return false; };

  function endSettle() {
    if (!settling) return;
    win?.cancelAnimationFrame?.(settling.raf);
    clearTimeout(settling.timer);
    settling = null;
  }

  /** Once the renders stop (a freeze mid-slide), whatever is still sliding to where it is drawn carries on: the carried
   *  ball (carryBall) and the figures the declutter moves; one animation frame at a time, landing at once when animation
   *  frames stall (a hidden tab). */
  function settle() {
    endSettle();
    const b = tokens.get(BALL_ID);
    if (!ballSliding(b) && !offSliding()) return;
    const step = (land) => {
      const now = clock();
      for (const t of syncDeclutter(now, { retarget: false, snap: land })) placeToken(t, t.pos);
      if (b?.pos && b.g.getAttribute('display') !== 'none') placeToken(b, b.pos, carryBall(b, now, land));
      updateBoundRings();
      placeTargets();
      syncTag();
      syncGhostBall();
    };
    const frame = () => {
      if (!settling) return;
      step(false);
      if (ballSliding(b) || offSliding()) settling.raf = win.requestAnimationFrame(frame); else endSettle();
    };
    settling = { raf: win?.requestAnimationFrame ? win.requestAnimationFrame(frame) : 0, timer: 0 };
    settling.timer = setTimeout(() => { if (!settling) return; endSettle(); step(true); }, 2 * Math.max(P.carryEaseMs, P.declutterEaseMs) + 100);
  }

  /** The trail behind the ball (ballTrail, view units) in the ball's own units; null hides it. */
  function drawTrail(trail) {
    const t = tokens.get(BALL_ID);
    if (!t?.trail) return;
    if (!trail) {
      if (!t.trailOn) return;
      t.trailOn = false;
      t.trail.setAttribute('display', 'none');
      return;
    }
    // Local units: view metres from the ball, divided by the ball's scale.
    const k = ballK || 1, hx = trail.head.x, hy = trail.head.y;
    const tx = (trail.tail.x - hx) / k, ty = (trail.tail.y - hy) / k;
    const len = Math.hypot(tx, ty);
    if (len < P.ballRadius) { drawTrail(null); return; }
    const nx = -ty / len, ny = tx / len, w = P.ballRadius * 0.85; // half its width at the ball
    t.trail.setAttribute('points', `${f3(tx)},${f3(ty)} ${f3(nx * w)},${f3(ny * w)} ${f3(-nx * w)},${f3(-ny * w)}`);
    trailGrad.setAttribute('x1', f3(tx));
    trailGrad.setAttribute('y1', f3(ty));
    trailGrad.setAttribute('x2', 0);
    trailGrad.setAttribute('y2', 0);
    if (!t.trailOn) { t.trailOn = true; t.trail.removeAttribute('display'); }
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
      if (t.pos) placeToken(t, t.pos, t.at); // the ball stays where it is drawn (a carrier's feet)
    } else {
      for (const a of ['tabindex', 'role', 'aria-roledescription', 'aria-describedby', 'aria-label', 'aria-pressed']) t.g.removeAttribute(a);
      t.g.setAttribute('aria-hidden', 'true');
      t.g.classList.remove('is-draggable', 'is-armed');
      t.aria = '';
    }
  }

  /** Keep the learner at the top of the players' stack (the ball has a layer of its own over them all). Moves nodes
   *  only when the order is wrong (re-appending a node would drop keyboard focus and restart its transition). */
  function ensureStacking() {
    const order = [opts.learnerId].filter((id) => id && id !== BALL_ID && tokens.has(id)).map((id) => tokens.get(id).g);
    if (figs && stackFigures(order)) return;
    let n = tokenLayer.lastChild;
    for (let i = order.length - 1; i >= 0; i--, n = n?.previousSibling) {
      if (n !== order[i]) { for (const g of order) tokenLayer.appendChild(g); return; }
    }
  }

  /**
   * Figures: the painter's order, so a figure lower on the screen (nearer the viewer) stands in front of one higher up;
   * YOU on top of all (the ball has a layer of its own, over them). Re-stacks only when two visible figures are out of
   * order by more than depthSlop, and then moves only the figures out of place (moving a node restarts its run cycle
   * and would drop its focus).
   * @returns {boolean} true when it re-stacked (YOU included)
   */
  function stackFigures(top) {
    const rest = [];
    for (const g of tokenLayer.children) if (!top.includes(g)) rest.push(tokens.get(g.dataset.id));
    let bad = false, last = -Infinity;
    for (const t of rest) {
      if (!t?.pos || t.g.getAttribute('display') === 'none') continue;
      if (last > t.depth + P.depthSlop) { bad = true; break; }
      last = Math.max(last, t.depth);
    }
    if (!bad) return false;
    // Hidden figures first (in their order), then the visible ones back to front (a stable sort keeps level ones put).
    const key = (t) => (t?.pos && t.g.getAttribute('display') !== 'none' ? t.depth : -Infinity);
    const want = rest.map((t, i) => ({ t, i })).sort((a, b) => key(a.t) - key(b.t) || a.i - b.i).map((e) => e.t.g).concat(top);
    let n = tokenLayer.firstChild;
    for (const g of want) {
      if (n === g) { n = n.nextSibling; continue; }
      tokenLayer.insertBefore(g, n);
    }
    return true;
  }

  // ---- render
  function render(frame, nextOpts = {}) {
    opts = { learnerId: null, highlight: [], labels: defaultLabels, dimOthers: false, ...nextOpts };
    if (nextOpts.youLabel !== undefined) setYouLabel(nextOpts.youLabel);
    if (nextOpts.youNumber !== undefined) youNum = Number.isInteger(nextOpts.youNumber) ? nextOpts.youNumber : null;
    if (opts.labels === 'role' || opts.labels === 'number') labelMode = opts.labels; // 'none' keeps the text, hidden
    const now = clock();
    const dt = now - lastRenderAt;
    root.classList.toggle('is-live', dt < P.liveMs);
    lastRenderAt = now;
    root.classList.toggle('no-labels', opts.labels === 'none');
    root.classList.toggle('is-numbered', labelMode === 'number');
    if (!frame) {
      for (const t of tokens.values()) t.g.setAttribute('display', 'none');
      stopMotion();
      endSettle();
      const b = tokens.get(BALL_ID);
      if (b) b.carry = null;
      placeTargets();
      updateAid();
      return;
    }

    const hl = new Set(opts.highlight ?? []);
    const seen = new Set();
    const focusIds = new Set([opts.learnerId, frame.carrierId, ...hl]);
    const dragging = active?.dragging ? active.id : null;
    const motion = motionPlan(reduced());
    const ball = isVec(frame.ball) ? frame.ball : null;
    const prevBall = tokens.get(BALL_ID)?.pos;
    // A new scene (the first render, one after a long gap, or the ball somewhere else entirely): nothing eases from what
    // was drawn before.
    const moved = !ball || !prevBall || !(Math.hypot(ball.x - prevBall.x, ball.y - prevBall.y) <= P.runMaxJump);
    const fresh = moved || !(dt <= P.carrySnapMs);
    let running = false;

    for (const p of frame.players) {
      seen.add(p.id);
      const t = tokens.get(p.id) ?? makeToken(p.id);
      const was = t.pos;
      t.pos = { x: p.x, y: p.y }; // (drawn below, once the declutter knows where)
      t.depth = project(p, orient).y;
      if (figs) {
        if (motion.runCycle && was && isRunning(Math.hypot(p.x - was.x, p.y - was.y), dt, P)) t.runUntil = now + P.runHoldMs;
        const run = motion.runCycle && now < (t.runUntil ?? 0);
        setRunning(t, run);
        running ||= run;
      }
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
    for (const [id, t] of tokens) {
      const show = seen.has(id) || (id === BALL_ID && !!ball);
      if (show === (t.g.getAttribute('display') === 'none')) {
        if (show) t.g.removeAttribute('display'); else t.g.setAttribute('display', 'none');
      }
      // A player left out of this frame (a reduced frame: cast.js) keeps no state: last rep's learner is not still
      // .is-learner while hidden (a query for YOU finds the one drawn).
      if (!show && id !== BALL_ID && t.flags) setFlags(t, []);
    }
    // Figures standing so close that one hides another's head or number are drawn a little apart (declutter: display
    // only; YOU never move), sliding there; a new scene (the ball somewhere else entirely) at once.
    syncDeclutter(now, { snap: moved });
    for (const p of frame.players) placeToken(tokens.get(p.id), p); // controlled: the frame wins, also for a token being dragged (§5.8)
    // Figures: the carrier faces the goal it plays toward (its ball sits on that side), but keeps the way it faced while
    // that goal is roughly straight up or down the screen (a phone held upright), so the ball never flips sides as it
    // crosses the middle; in a new scene it simply faces the goal's side.
    // Whoever has the ball (a disc or a figure): the ball is drawn at their feet (carryBall).
    const holder = frame.carrierId && seen.has(frame.carrierId) ? tokens.get(frame.carrierId) : null;
    const carrier = figs ? holder : null;
    if (carrier) {
      const target = carrierTarget(parsePlayerId(carrier.id).team, frame.tags?.carrierFacing);
      setFacing(carrier, facingToward(carrier.pos, target, orient, carrier.facing, P, fresh ? 0 : P.carrierFacingSlope));
    }
    const b = ball ? tokens.get(BALL_ID) ?? makeToken(BALL_ID) : null;
    if (b) {
      seen.add(BALL_ID);
      // Figures: at the carrier's feet while it is on the board and close to the ball (never while a hand drags it).
      const held = holder?.pos && dragging !== BALL_ID && Math.hypot(ball.x - holder.pos.x, ball.y - holder.pos.y) < P.carryDist ? holder.id : null;
      if (held !== b.heldBy) { ballHist.length = 0; b.carrySide = null; } // taken or let go: the trail starts afresh (no streak from the feet)
      // Discs: the ball just off the carrier's disc, toward the goal it plays to (its own when tags.carrierFacing is
      // 'backward'), else a way that keeps it off the other discs' codes (discCarryDir).
      if (held && !figs) {
        const goal = carrierTarget(parsePlayerId(held).team, frame.tags?.carrierFacing).x > holder.pos.x ? 1 : -1;
        const others = [];
        for (const p of frame.players) if (p.id !== held) others.push(p);
        b.heldDir = discCarryDir(holder.pos, goal, others, { k: scale, kb: ballK, prev: b.heldBy === held ? b.heldDir : null }, P);
      }
      b.heldBy = held;
      b.pos = { x: ball.x, y: ball.y };
      placeToken(b, ball, carryBall(b, now, fresh || dragging === BALL_ID));
      trackBall(b, now, dt, motion);
      const flags = [];
      if (hl.has(BALL_ID)) flags.push('is-highlight');
      if (armed === BALL_ID) flags.push('is-armed');
      if (dragging === BALL_ID) flags.push('is-dragging');
      setFlags(b, flags);
    }
    // Figures face the ball where it is drawn (a carried ball beside the carrier's boots); the carrier faced its goal.
    if (figs) {
      const at = b?.at ?? null;
      for (const p of frame.players) if (p.id !== carrier?.id) { const t = tokens.get(p.id); setFacing(t, facingToward(t.at ?? t.pos, at, orient, t.facing, P)); }
    }
    // Renders stopped (a freeze, a pause): the run cycles and the trail stop soon after; a sliding ball lands.
    clearTimeout(runTimer);
    runTimer = running || b?.trailOn ? setTimeout(stopMotion, P.runHoldMs + 40) : 0;
    settle();
    ensureStacking();
    updateBoundRings();
    placeTargets();
    syncTag();
    syncGhostBall();
  }

  /** The ball's recent drawn positions (view units) and the trail they make while it flies fast. */
  function trackBall(t, now, dt, motion) {
    if (!motion.trail || dt > P.trailMaxGapMs) ballHist.length = 0;
    const v = project(t.at, orient);
    ballHist.push({ x: v.x, y: v.y, t: now });
    while (ballHist.length > 2 && now - ballHist[1].t > P.trailMs + P.trailMaxGapMs) ballHist.shift();
    drawTrail(motion.trail && !t.heldBy ? ballTrail(ballHist, P) : null);
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
    if (!p) { ghostEl.setAttribute('display', 'none'); syncGhostBall(); return; }
    const wasHidden = ghostEl.hasAttribute('display');
    ghostEl.removeAttribute('display');
    // The ring matches the drawn token size (scale), so "stand here" reads at a glance on a phone too. Figures: drawn in
    // the view layer, over the figures and the ball (at project(p): a ring looks the same either way up).
    const transform = figs ? transformAt(p, scale) : `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px)${scale === 1 ? '' : ` scale(${scale})`}`;
    if (wasHidden) {
      // Appear in place: without this the transition runs from the pitch corner (transform: none).
      ghostEl.style.transition = 'none';
      ghostEl.style.transform = transform;
      ghostEl.getBoundingClientRect?.(); // commit the jump before the transition comes back
      ghostEl.style.transition = '';
    } else ghostEl.style.transform = transform;
    syncGhostBall();
  }

  /**
   * Figures: the best-spot ring by the ball (a pressing spot lies right by it). The ring (over the figures) and the
   * ball (over the ring) stay apart: while the ball's halo, at the top of its pulse, would reach the ring, the halo is
   * hidden (.is-by-ghost, css/figures.css: a bright yellow ring the size of the best-spot ring read as the ring itself;
   * the ball keeps its white body and thick outline, easy to spot), and a ball inside the ring grows the ring just
   * clear of it (ghostFit), so the ring is never cut by the ball it surrounds.
   */
  function syncGhostBall() {
    const b = tokens.get(BALL_ID);
    let near = false, r = ghostRadius();
    if (figs && ghostAt && b?.at && b.g.getAttribute('display') !== 'none') {
      const g = project(ghostAt, orient), v = project(b.at, orient);
      // (The ball inside the ring keeps its thin halo clear of it: ballByGhostHalo with its rim.)
      const fit = ghostFit({ d: Math.hypot(g.x - v.x, g.y - v.y), ring: r, body: (P.ballByGhostHalo * P.ballRadius + 0.2) * ballK, reach: haloReach(), gap: pxm > 0 ? P.ghostGapPx / pxm : 0 }, P);
      near = fit.byBall;
      r = fit.r;
    }
    if (b && near !== !!b.byGhost) { b.byGhost = near; b.g.classList.toggle('is-by-ghost', near); }
    // The ring's circle is drawn in the token's units (the ghost is scaled like a token).
    const rr = String(f3(r / (scale || 1)));
    if (ghostRing.getAttribute('r') !== rr) ghostRing.setAttribute('r', rr);
    ghostR = r;
  }

  /** The best-spot ring's own radius (view units): its circle, grown with the tokens. */
  const ghostRadius = () => (P.tokenRadius + 0.5) * (scale || 1);

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
    labelBoxes = null; // (measured again when YOUR tag next looks: syncTag)
    boundRings = [];
    for (const m of markers) drawMarker(m);
    updateBoundRings();
    syncTag(); // (YOUR tag keeps off the labels just drawn)
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
          // (At the best spot: clear of the ring as drawn, which a ball inside it may have grown: ghostFit.)
          const ring = ghostAt && isVec(m.at) && Math.hypot(m.at.x - ghostAt.x, m.at.y - ghostAt.y) < 0.01 ? ghostR + 0.1 * scale : 0;
          const lift = m.lift === 'token' ? Math.max((P.tokenRadius + 0.6) * scale, ring) : Number.isFinite(m.lift) ? m.lift : 0;
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
    // The other players drawn and the ball count too, for less than YOU and YOUR tag (labelOthersWeight): zoomed in on a
    // small game, "Best spot" by a presser's ring once sat across their winger's head and the ball.
    const others = otherBoxes();
    let best = order[0], cost = Infinity;
    for (const where of order) {
      place(where);
      const box = boxOf(t);
      const c = coverCost(box, avoid);
      if (c === null) { best = order[0]; break; } // not rendered (a hidden board): the side asked for
      const all = c + P.labelOthersWeight * coverCost(box, others, { view: false });
      if (all < cost) { cost = all; best = where; }
      if (all === 0) break;
    }
    place(best);
  }

  /** The other players drawn (a figure stands up the screen from its base) and the ball with its halo, in view units:
   *  what a label written with clear: 'you' keeps off after YOU and YOUR tag (drawLabel). */
  function otherBoxes() {
    const out = [];
    const r = (P.tokenRadius + 0.3) * scale;
    for (const t of tokens.values()) {
      if (!t.pos || t.id === opts.learnerId || t.g.getAttribute('display') === 'none') continue;
      const v = project(t.at ?? t.pos, orient);
      if (t.id === BALL_ID) {
        const h = P.ballHalo * P.ballRadius * ballK;
        out.push({ x0: v.x - h, x1: v.x + h, y0: v.y - h, y1: v.y + h });
        continue;
      }
      const bw = figs ? Math.max(r, FIGURE.halfWidth * P.tokenRadius * figK) : r;
      out.push({ x0: v.x - bw, x1: v.x + bw, y0: v.y - (figs ? Math.max(r, FIGURE.height * P.tokenRadius * figK) : r), y1: v.y + r });
    }
    return out;
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
    const bw = figs ? Math.max(r, FIGURE.halfWidth * P.tokenRadius * figK) : r;
    const body = { x0: v.x - bw, x1: v.x + bw, y0: v.y - (figs ? Math.max(r, FIGURE.height * P.tokenRadius * figK) : r), y1: v.y + r }; // a figure stands up the screen
    return [body, tagBoxNow()].filter(Boolean); // the tag where it is drawn (above the head, or beside it: syncTag)
  }

  /** A drawn text's box in view units, or null when it is not rendered. */
  function boxOf(node) {
    let b = null;
    try { b = node.getBBox?.() ?? null; } catch { b = null; }
    return b && b.width > 0 ? { x0: b.x, x1: b.x + b.width, y0: b.y, y1: b.y + b.height } : null;
  }

  /** How much a label box covers the boxes to avoid, plus how much of it falls outside the view (area, view units²). */
  function coverCost(box, avoid, { view = true } = {}) {
    if (!box) return null;
    const over = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    const outside = vb && view ? area - over(box, { x0: vb.x, x1: vb.x + vb.width, y0: vb.y, y1: vb.y + vb.height }) : 0;
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
      const at = t.at ?? t.pos; // the ball: where it is drawn (a carrier's feet)
      el.setAttribute('cx', f3(at.x));
      el.setAttribute('cy', f3(at.y));
      const rr = f3(r * (id === BALL_ID ? ballK : scale));
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
      const tx = transformAt(t.at ?? t.pos); // (round the feet as drawn: a figure moved clear of another, declutter)
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
      const at = t.at ?? t.pos;
      const d = Math.hypot(at.x - w.x, at.y - w.y);
      if (d <= bd) { bd = d; best = id; }
    }
    // Figures: a tap on the upright figure picks it too (the nearest one whose figure it is on).
    return best ?? figureAt(targets.ids, w);
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

  /**
   * Lay the board out again: orientation, viewBox, sizes. `cameraFrame`: a frame of the camera's ease, which only
   * moves the view and re-sizes the tokens: it reuses the last measurement (measuring forces a layout of the whole
   * page) and leaves the label size, the overlays and the markers to the frame it lands on.
   */
  function relayout(force = false, { cameraFrame = false } = {}) {
    const { width, height, box } = cameraFrame && measured ? measured : (measured = measure());
    const next = pickOrientation(requested, width, height, P);
    const turned = next !== orient;
    // The camera's window (setCamera) wins over the focus crop (setFocus); while it eases, the window in between.
    let nextVb = camera ? cameraVb(next, box) : focusViewBox(next, box, focus, focusForced ? { ...P, focusMinPxPerM: Infinity } : P);
    const zoomed = !!camera || !!camAnim;
    if (camAnim) {
      const u = turned ? 1 : Math.min(1, Math.max(0, (clock() - camAnim.t0) / P.cameraMs));
      if (u >= 1) endCamAnim(); else nextVb = lerpBox(camAnim.from, nextVb, easeInOut(u));
    }
    const easing = !!camAnim; // a frame part way through the camera's ease (the tokens and the view only)
    const px = pxPerMetre(box, nextVb);
    const { k, kf, kl, kt, kb } = boardScales(px, { figures: figs, player, camera: zoomed }, P);
    const cK = compactScale(k, kt, px);
    const vbChanged = !vb || ['x', 'y', 'width', 'height'].some((key) => vb[key] !== nextVb[key]);
    pxm = px;
    const changed = force || turned || vbChanged || k !== scale || kf !== figK || kl !== lscale || kt !== tagK || kb !== ballK || cK !== compactK;
    if (changed) {
      orient = next;
      vb = nextVb;
      scale = k;
      figK = kf;
      lscale = kl;
      tagK = kt;
      ballK = kb;
      compactK = cK;
      svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
      syncFarSurround();
      if (turned || force) { // (the same layout keeps the same rotation: rewriting it would restyle the pitch)
        const wt = worldTransform(orient);
        if (wt) world.setAttribute('transform', wt); else world.removeAttribute('transform');
      }
      if (root.dataset.orientation !== orient) root.dataset.orientation = orient;
      // Re-project (and re-scale) without animating tokens across the pitch; the ball slides on from where it was drawn
      // (a new layout: in place).
      if (!root.classList.contains('no-anim')) root.classList.add('no-anim');
      const now = clock();
      syncDeclutter(now, { snap: turned }); // (the figures' size changed: what they hide of each other too)
      for (const t of tokens.values()) {
        syncHit(t);
        syncFigure(t);
        if (t.tagG) placeYouTag(t);
        if (t.pos && t.id !== BALL_ID) { t.tx = ''; placeToken(t, t.pos); }
      }
      const b = tokens.get(BALL_ID);
      if (b?.pos) { b.tx = ''; placeToken(b, b.pos, carryBall(b, now, turned)); } // (at its carrier's feet as drawn now)
      settle();
      placeTargets();
      syncTag();
      if (ghostAt) {
        ghostEl.style.transition = 'none';
        setGhost(ghostAt);
        if (!easing) ghostEl.getBoundingClientRect?.(); // (a forced layout: once it has landed)
        ghostEl.style.transition = '';
      }
    }
    // Labels, overlays and markers are sized, rebuilt and re-placed once the camera lands, not on every frame of its
    // ease (each would restyle or rebuild the whole board; meanwhile they zoom with the view, and rings bound to
    // tokens follow the tokens).
    if (easing) {
      if (changed) { decorStale = true; updateBoundRings(); }
      return;
    }
    if (!changed && !decorStale) return;
    decorStale = false;
    const lk = String(lscale);
    if (root.style.getPropertyValue('--board-label-k') !== lk) root.style.setProperty('--board-label-k', lk);
    applyOverlays(true);
    setMarkers(markers);
    win?.requestAnimationFrame?.(() => win.requestAnimationFrame(() => root.classList.remove('no-anim')));
  }

  /**
   * The camera's window (cameraViewBox) with room over the top of its rect for the tallest thing drawn there: a figure
   * and YOUR tag at the zoom the window gives (standHeight; its sizes depend on the zoom, so it is worked out twice).
   */
  function cameraVb(o, box) {
    let v = cameraViewBox(o, box, camera, P);
    let head = P.cameraHeadroom;
    for (let i = 0; i < 2; i++) {
      const s = boardScales(pxPerMetre(box, v), { figures: figs, player, camera: true }, P);
      const need = standHeight(s, { figures: figs }, P) - P.cameraPad;
      if (!(need > head + 0.01)) break;
      head = need;
      v = cameraViewBox(o, box, camera, { ...P, cameraHeadroom: head });
    }
    return v;
  }

  /**
   * While a camera is on (its window, and every frame of the ease there), the grass is drawn under all that the board
   * shows (shownBox): past the pitch's margin at the top of the screen, where the window may reach, and the strips a
   * window of another aspect leaves while it eases (on a desktop the view eased from the whole pitch to a small game
   * with a band of the page over the grass until it landed), and past all that by cameraSurround of the view's longer
   * side (the stage clips it): the board's size can change before the board has fitted its window again (a panel under
   * the pitch going or coming, a phone turned: its ResizeObserver runs after the frame's animation callbacks), and the
   * grass still reaches every edge. Behind the pitch's own grass; none without a camera (the whole pitch letterboxes as
   * before).
   */
  function syncFarSurround() {
    const shown = camera && vb ? shownBox(vb, (measured ?? measure()).box) : null;
    if (!shown) { if (!farSurround.hasAttribute('display')) farSurround.setAttribute('display', 'none'); return; }
    const e = Math.max(1, P.cameraSurround * Math.max(vb.width, vb.height)); // (at least a metre over: no hairline of the page at the edge)
    // World coordinates: the vertical layout runs the pitch up the screen (view y = LENGTH - x, view x = y).
    const a = orient === 'vertical'
      ? { x: LENGTH - shown.y1 - e, y: shown.x0 - e, width: shown.y1 - shown.y0 + 2 * e, height: shown.x1 - shown.x0 + 2 * e }
      : { x: shown.x0 - e, y: shown.y0 - e, width: shown.x1 - shown.x0 + 2 * e, height: shown.y1 - shown.y0 + 2 * e };
    for (const [key, val] of Object.entries(a)) farSurround.setAttribute(key, f3(val));
    farSurround.removeAttribute('display');
  }

  /** A viewBox part way (u, 0..1) from a to b, rounded to 0.01. */
  const lerpBox = (a, b, u) => Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Math.round((a[key] + (b[key] - a[key]) * u) * 100) / 100]));

  function endCamAnim() {
    if (!camAnim) return;
    win?.cancelAnimationFrame?.(camAnim.raf);
    clearTimeout(camAnim.timer);
    camAnim = null;
  }

  /**
   * Fit the world rect { x0, x1, y0, y1 } (metres) on both axes (cameraViewBox: padded, at least CAMERA_MIN, the
   * board's aspect, inside the pitch and its margin), easing there over cameraMs (at once under reduced motion);
   * null: back to setFocus's length crop, or the whole pitch. Resizes keep the window fitted.
   * @param {{x0:number, x1:number, y0:number, y1:number}|null} rect
   */
  function setCamera(rect = null) {
    const next = rect && [rect.x0, rect.x1, rect.y0, rect.y1].every(Number.isFinite)
      ? { x0: Math.min(rect.x0, rect.x1), x1: Math.max(rect.x0, rect.x1), y0: Math.min(rect.y0, rect.y1), y1: Math.max(rect.y0, rect.y1) }
      : null;
    const same = next && camera ? ['x0', 'x1', 'y0', 'y1'].every((key) => next[key] === camera[key]) : next === camera;
    if (same) return;
    const from = vb ? { ...vb } : null;
    endCamAnim();
    camera = next;
    if (from && motionPlan(reduced()).cameraEase && win?.requestAnimationFrame) {
      camAnim = { from, t0: clock(), raf: 0, timer: 0 };
      const step = () => { if (!camAnim) return; relayout(false, { cameraFrame: true }); if (camAnim) camAnim.raf = win.requestAnimationFrame(step); };
      camAnim.raf = win.requestAnimationFrame(step);
      // Animation frames stall in a hidden tab: land on the window anyway.
      camAnim.timer = setTimeout(() => { endCamAnim(); relayout(); }, P.cameraMs + 150);
    }
    relayout();
    syncFarSurround(); // (on at once: the first frame of the ease may not move the view yet)
    refitSoon();
  }

  /**
   * A mode changes the page round the board just after it moves the camera, in the same task (play.js: the dock for the
   * next rep, then the picture), so the board's size may change before the next frame. Once that code has run (a
   * microtask: still before the frame), measure again and fit the window to the size the board has then: under reduced
   * motion the view lands once, on its final window, never first on one for the size the board had a moment before and
   * again on the next frame (its ResizeObserver runs after the frame's animation callbacks); an ease heads for the right
   * window from its first frame. Nothing changes when the size has not.
   */
  let refitQueued = false;
  function refitSoon() {
    if (refitQueued) return;
    refitQueued = true;
    const later = globalThis.queueMicrotask ?? ((f) => Promise.resolve().then(f));
    later(() => { refitQueued = false; if (!dead) relayout(); });
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
      const at = t.at ?? t.pos; // the ball: where it is drawn
      const d = Math.hypot(at.x - w.x, at.y - w.y);
      if (d <= bd) { bd = d; best = id; }
    }
    best ??= figureAt(drag.ids, w); // figures: a press on the upright figure picks it up too
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
    const at = t.at ?? t.pos;
    const r = id !== BALL_ID ? (P.tokenRadius + 0.5) * scale : P.ballHalo * P.ballRadius * ballK;
    return Math.hypot(at.x - w.x, at.y - w.y) <= r || onFigure(t, w);
  }

  /** Is `w` on a player's upright figure (figures mode: the box it stands in, from its feet up to its head)? */
  function onFigure(t, w) {
    if (!figs || !t?.fig || !t.pos || !isVec(w)) return false;
    const v = project(t.at ?? t.pos, orient), q = project(w, orient), R = P.tokenRadius * figK;
    return Math.abs(q.x - v.x) <= FIGURE.halfWidth * R && q.y <= v.y && q.y >= v.y - FIGURE.height * R;
  }

  /** The token among `ids` whose figure `w` is on, the nearest (by its feet) when figures overlap; null if none. */
  function figureAt(ids, w) {
    if (!figs) return null;
    let best = null, bd = Infinity;
    for (const id of ids) {
      const t = tokens.get(id);
      if (!t?.pos || t.g.getAttribute('display') === 'none' || !onFigure(t, w)) continue;
      const at = t.at ?? t.pos;
      const d = Math.hypot(at.x - w.x, at.y - w.y);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  /** Is `w` on the learner's YOU tag (the pill over the token, or beside the head: syncTag; drawn tagK times its size)? */
  function onYouTag(t, w) {
    if (!t?.pos || t.id !== opts.learnerId || !Number.isFinite(w?.x)) return false;
    const box = tagBoxNow(), q = project(w, orient);
    if (!box) return false;
    const mx = 0.4 * tagK * scale, my = 0.55 * tagK * scale; // a little round the pill
    return q.x >= box.x0 - mx && q.x <= box.x1 + mx && q.y >= box.y0 - my && q.y <= box.y1 + my;
  }

  function moveTo(id, p, final) {
    const t = tokens.get(id);
    if (t) { t.heldBy = null; t.carry = null; } // a ball moved by hand is drawn where it is put, until the next render says otherwise
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
      // (From where it is drawn: a carried ball sits beside its carrier's boots.)
      grab: t?.pos ? { x: (t.at ?? t.pos).x - w.x, y: (t.at ?? t.pos).y - w.y } : { x: 0, y: 0 },
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
    /** Fit a world rect on both axes, easing there; null: back to setFocus (PROGRESSIVE_FIELD §4). */
    setCamera,
    /** Extra: the world rect the camera fits now, or null. */
    get camera() { return camera ? { ...camera } : null; },
    /** Extra: the viewBox drawn now ({ x, y, width, height }, view metres), or null before the first layout. */
    get viewBox() { return vb ? { ...vb } : null; },
    /** Extra: the viewBox the board shows once the camera has landed (while it eases: where it is going), or null. */
    get targetViewBox() { const L = landing(); return L ? { ...L.vb } : null; },
    /** Extra: what is drawn for a token now (a figure and, for YOU, YOUR tag; the ball and its halo), in view units. */
    drawnBox,
    /** Extra: where a token will be drawn on the screen (CSS px) once the camera has landed. */
    clientBox,
    /** Extra: how much bigger than life the ball is drawn (ballScale, on every board). */
    get ballScale() { return ballK; },
    /** Extra: how much bigger than life a figure is drawn on its base disc (figureScale; discs: tokenScale). */
    get figureScale() { return figK; },
    /** Extra: where YOUR tag is drawn: 'above' the head, or where it covers least ('left' | 'right' | 'lift' | 'beside-left' |
     *  'beside-right' | 'below' | 'edge': tagPlacement). */
    get tagPlace() { return tagAt.place; },
    /** Extra: YOUR tag's form: 'full' (the pill with YOUR nickname), 'compact' (a "YOU" chevron) or 'mark' (a chevron alone). */
    get tagForm() { return tagAt.form; },
    /** Extra: YOUR tag's box as drawn now, in its form and place (view units), or null. */
    get tagBox() { const t = opts.learnerId ? tokens.get(opts.learnerId) : null; return t?.pos && t.g.getAttribute('display') !== 'none' ? tagBoxNow() : null; },
    /** Extra: where token `id` is drawn now (world metres: a carried ball at the feet, a figure moved clear of another by the
     *  declutter), or null when it is not drawn. Its spot (what the engine has) is the frame's. */
    drawnAt(id) { const t = tokens.get(id); return t?.pos && t.g.getAttribute('display') !== 'none' ? { ...(t.at ?? t.pos) } : null; },
    /** Extra: players are drawn as figures (createBoard { figures: true }). */
    get figures() { return figs; },
    /** Extra: the resolved layout, 'horizontal' | 'vertical'. */
    get orientation() { return orient; },
    /** Extra: how much bigger than life tokens (a figure's base disc) are drawn (1 on a big board). */
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
      dead = true;
      handRun?.finish();
      endCamAnim();
      endSettle();
      clearTimeout(runTimer);
      clearTimeout(tagTimer);
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
