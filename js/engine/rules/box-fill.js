// P10 Fill the box on crosses: with the ball wide near their byline, the #9, the far winger
// and the far #8 attack the scoring zones instead of holding their build-up jobs: the #9 the
// near post or the penalty spot (R5), the far winger the back post or the spot, the far #8 the
// edge of the box for a cut-back or the spot (P4: he arrives late). Every zone is held onside
// (no deeper into the box than the offside line). The rule fades in with the ball's crossing
// position, the same fade layer A uses to free the far winger from the touchline (widthDuty),
// so width (B1) hands the far winger over to this rule smoothly.
// Also exports boxRunner(): the share by which the #9 and the far winger stop coming short
// (support-distance, lane-open) once the ball is wide in the final third (R5).
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §8.3 (P4, P10), §8.7 (R5).

import { MID_Y, LANE_EDGES } from '../pitch.js';
import { widthDuty } from '../formation.js';
import { perContext, paramsFor, notApplicable, onFarSide, clamp01 } from './_util.js';
import { offsideLineX } from './offside.js';

export const BOX_FILL_DEFAULTS = Object.freeze({
  weight: 3, // [D] like width and pin (RESEARCH 5.6 in-possession weights)
  // Zone centres [D] from P10: x toward their goal, y measured from the centre line toward the ball side.
  zones: Object.freeze({
    nearPost: Object.freeze({ x: 100, y: 6.4 }), // near half of the six-yard box (between the post and its corner)
    backPost: Object.freeze({ x: 100, y: -6.4 }), // far half of the six-yard box
    spot: Object.freeze({ x: 94, y: 0 }), // penalty spot
    edge: Object.freeze({ x: 87.5, y: 3 }), // edge of the box, cut-back zone (x 86-89)
  }),
  roles: Object.freeze({ ST: Object.freeze(['nearPost', 'spot']), W: Object.freeze(['backPost', 'spot']), CM: Object.freeze(['edge', 'spot']) }), // [D] R5, P10, P4
  radius: 3, // [D] P10: runners within about 3 m share a zone
  soft: 5, // [D] credit fades to 0 this far outside a zone
  onsideMargin: 0.5, // [D] zones are held this far onside of the offside line
  runnerFrom: 70, // [D] boxRunner(): the #9 and far winger stop coming short once the ball is wide beyond this x (the final third)...
  runnerTo: 78, // [D] ...fully by this x
});

const NAMES = { nearPost: 'near post', backPost: 'back post', spot: 'penalty spot', edge: 'edge of the box for a cut-back' };
const KID_NAMES = { nearPost: 'near post', backPost: 'far post', spot: 'penalty spot', edge: 'edge of the box' };

/**
 * How much the ball is in a crossing position (P10): 0..1, 1 with the ball in a wing lane at or
 * beyond SHAPE_DEFAULTS.crossX. Exactly 1 - widthDuty() of the far side, so layer A and the rules agree.
 * @param {{x:number,y:number}} ball
 * @returns {number}
 */
export const crossing = (ball) => 1 - Math.min(widthDuty(ball, 'L'), widthDuty(ball, 'R'));

/** How far the ball is across the half-space into a wing lane (0 in the centre lane, 1 in a wing lane). */
const wideness = (ball) => clamp01((Math.abs(ball.y - MID_Y) - (LANE_EDGES[3] - MID_Y)) / (LANE_EDGES[4] - LANE_EDGES[3]));

/**
 * The share (0..1) by which the learner is a box runner rather than a short option: the #9 and the
 * far winger, with the ball wide in the final third (R5: check short only to open space for a
 * runner). support-distance and lane-open scale their weight by 1 - boxRunner(ctx).
 * @param {object} ctx
 * @returns {number}
 */
export function boxRunner(ctx) {
  if (ctx.moment !== 'in_possession') return 0;
  const { family } = ctx.learner;
  if (!(family === 'ST' || (family === 'W' && onFarSide(ctx)))) return 0;
  const D = paramsFor(ctx, 'box-fill', BOX_FILL_DEFAULTS);
  return clamp01((ctx.ball.x - D.runnerFrom) / (D.runnerTo - D.runnerFrom)) * wideness(ctx.ball);
}

const prep = perContext((ctx) => {
  if (ctx.moment !== 'in_possession' || ctx.duty === 'first-attacker') return null;
  const { family } = ctx.learner;
  // The #9 always; the winger and the #8 only on the far side (the ball-side ones cross or support).
  if (!(family === 'ST' || ((family === 'W' || family === 'CM') && onFarSide(ctx)))) return null;
  const D = paramsFor(ctx, 'box-fill', BOX_FILL_DEFAULTS);
  const w = D.weight * crossing(ctx.ball);
  if (!(w > 0)) return null;
  const side = ctx.ball.y > MID_Y ? 1 : -1; // toward the ball
  const maxX = offsideLineX(ctx) - D.onsideMargin;
  const zones = (D.roles[family] ?? []).map((id) => ({ id, x: Math.min(D.zones[id].x, maxX), y: MID_Y + side * D.zones[id].y }));
  return zones.length ? { D, w, zones } : null;
});

const m = (v) => Math.max(1, Math.round(v));

export default {
  id: 'box-fill',
  principles: ['P10', 'R5'], // R5: the #9 attacks the near post or the spot
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,

  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const { D } = p;
    let best = null, bd = Infinity;
    for (const z of p.zones) {
      const d = Math.hypot(spot.x - z.x, spot.y - z.y);
      if (d < bd) { bd = d; best = z; }
    }
    const s = bd <= D.radius ? 1 : Math.max(0, 1 - (bd - D.radius) / D.soft);
    return {
      s,
      target: s < 1 ? { x: best.x, y: best.y } : undefined,
      vars: { zone: NAMES[best.id], kidZone: KID_NAMES[best.id], zoneId: best.id, d: bd - D.radius },
    };
  },

  text: {
    standard: {
      name: 'Fill the box',
      ok: (v) => `You attack the ${v.zone}, one of the spaces a cross is aimed at.`,
      fail: (v) => `Get ${m(v.d)} m closer to the ${v.zone}, so the crosser has a target in a scoring zone.`,
      cue: () => 'Where can a cross go, and which space in the box is still empty?',
    },
    kid: {
      name: 'Fill the box',
      ok: () => 'Good run, you are in a scoring spot for the cross.',
      fail: (v) => `Run to the ${v.kidZone} for the cross.`,
      cue: () => 'Where can the cross find you?',
    },
  },

  /** Beat-1 highlight: the zone nearest the judged spot (or your base). */
  cue(ctx, spot) {
    const p = prep(ctx);
    if (!p) return null;
    const at = spot ?? ctx.learner.base;
    let best = p.zones[0];
    for (const z of p.zones) if (Math.hypot(at.x - z.x, at.y - z.y) < Math.hypot(at.x - best.x, at.y - best.y)) best = z;
    return { type: 'point', x: best.x, y: best.y };
  },
};
