// F4 Offside (IFAB Law 11). In possession, a spot in the opponent half that is nearer
// their goal line than both the ball and the second-last opponent is an offside
// position. Level counts as onside. Critical only at a pass moment (the frame's event, or
// a teammate's pass within passAhead seconds: timeline.js tags.nextEvent, so a drill frozen
// just before the cross judges you as it is struck); otherwise the rule's score drops to 0
// within a metre or two past the line. Its ok() text is ''
// far behind the line: "you stayed onside" is only worth saying near it.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §5.5, §8.1 (F4).

import { band } from '../geometry.js';
import { HALF_X } from '../pitch.js';
import { perContext, paramsFor, notApplicable } from './_util.js';

export const OFFSIDE_DEFAULTS = Object.freeze({
  margin: 0.3, // [D] metres past the line that still read as "level" (level is onside)
  soft: 1.5, // [D] s falls from 1 to 0 over this many metres past the line
  passEvents: Object.freeze(['pass', 'cross', 'free-kick', 'clearance']), // [D] a teammate plays the ball: offside is judged now
  exemptEvents: Object.freeze(['goal-kick', 'throw-in', 'corner']), // [S] IFAB Law 11: no offence directly from these restarts
  weightByFamily: Object.freeze({ ST: 3, W: 3, CM: 2, DM: 1, FB: 1, CB: 0.5 }), // [D] small for defenders who rarely get there
  praiseWithin: 5, // [D] only praise staying onside within this many metres of the line
  passAhead: 1.0, // [D] s: a teammate's pass this soon (frame.tags.nextEvent / nextEventIn) is judged as played now
});

/**
 * The x a teammate must not pass: the ball, the second-last opponent, or halfway,
 * whichever is furthest forward (you cannot be offside in your own half).
 * @param {object} ctx  context from buildContext()
 * @returns {number}
 */
export function offsideLineX(ctx) {
  return Math.max(ctx.ball.x, ctx.lines.oppSecondLastX, HALF_X);
}

const prep = perContext((ctx) => {
  if (ctx.moment !== 'in_possession' || ctx.duty === 'first-attacker') return null;
  const D = paramsFor(ctx, 'offside', OFFSIDE_DEFAULTS);
  const event = ctx.frame?.tags?.event;
  if (D.exemptEvents.includes(event)) return null;
  const w = D.weightByFamily[ctx.learner.family] ?? 0;
  if (!(w > 0)) return null;
  const line = offsideLineX(ctx);
  const by = line === ctx.lines.oppSecondLastX ? 'defender' : line === ctx.ball.x ? 'ball' : 'halfway';
  const tags = ctx.frame?.tags ?? {};
  const soon = D.passEvents.includes(tags.nextEvent) && tags.nextEventIn <= D.passAhead;
  return { D, w, line, by, pass: D.passEvents.includes(event) || soon };
});

const m = (v) => Math.max(1, Math.round(v));
const REF = { defender: 'their last defender', ball: 'the ball', halfway: 'the halfway line' };

export default {
  id: 'offside',
  principles: ['F4'],
  critical: true,
  weight: (ctx) => prep(ctx)?.w ?? 0,

  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const beyond = spot.x - p.line;
    const off = beyond > p.D.margin;
    return {
      s: band(beyond, -Infinity, p.D.margin, p.D.soft),
      critical: p.pass && off,
      target: off ? { x: p.line, y: spot.y } : undefined,
      vars: { line: p.line, beyond, pass: p.pass, by: p.by, nearLine: beyond >= -p.D.praiseWithin },
    };
  },

  text: {
    standard: {
      name: 'Stay onside',
      ok: (v) => (v.nearLine ? 'You stay onside, no further forward than the ball or their last defender.' : ''),
      fail: (v) => (v.pass
        ? `You are ${m(v.beyond)} m past ${REF[v.by]} as the pass is played, which is offside, so hold your run until the ball is kicked.`
        : `You are ${m(v.beyond)} m past ${REF[v.by]} and would be offside if the pass came now, so step back level.`),
      cue: () => 'Where is their last defender, and are you ahead of them?',
    },
    kid: {
      name: 'Stay onside',
      ok: (v) => (v.nearLine ? 'Good timing, you stayed onside.' : ''),
      fail: (v) => `Step back so you are level with ${REF[v.by]}.`,
      cue: () => 'Where is their last defender?',
    },
  },

  cue(ctx) {
    return { type: 'line-x', x: offsideLineX(ctx) };
  },
};
