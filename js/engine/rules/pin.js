// B2 Depth: the #9 pins their back line by standing on the last defender's shoulder,
// 0-2 m goal-side of their second-last player. Falling off the line is punished gently
// (checking short is sometimes right), and so is standing beyond it while still onside
// (in our own half, or behind the ball): that is legal, but it no longer pins anyone.
// Only past the offside line (IFAB Law 11: the ball, their second-last player or halfway,
// whichever is furthest forward) is the ramp steep and the wording "offside". Once the
// ball itself is beyond their second-last player the #9 fills the box instead (P10), so
// the rule fades out.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §5.5, §8.2 (B2), §8.7 (R5).

import { perContext, paramsFor, notApplicable, clamp01 } from './_util.js';
import { offsideLineX } from './offside.js';

export const PIN_DEFAULTS = Object.freeze({
  weight: 3, // [D] RESEARCH 5.6
  depth: 2, // [D] B2: within 0-2 m goal-side of their second-last player
  softBelow: 6, // [D] ramp when dropping too deep
  softBeyond: 6, // [D] ramp past their second-last player while still onside (own half, or behind the ball)
  softAbove: 1.5, // [D] ramp past the offside line (the offside rule also applies)
  ballPastFade: 2, // [D] m: the rule fades out as the ball goes this far beyond their second-last player (P10 takes over)
});

const prep = perContext((ctx) => {
  if (ctx.moment !== 'in_possession' || ctx.learner.family !== 'ST' || ctx.duty === 'first-attacker') return null;
  const line = ctx.lines.oppSecondLastX;
  if (!Number.isFinite(line)) return null;
  const D = paramsFor(ctx, 'pin', PIN_DEFAULTS);
  const w = D.weight * clamp01(1 - (ctx.ball.x - line) / D.ballPastFade);
  if (!(w > 0)) return null;
  return { D, w, line, lo: line - D.depth, off: offsideLineX(ctx) };
});

const m = (v) => Math.max(1, Math.round(v));

export default {
  id: 'pin',
  principles: ['B2'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,

  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const { D, line, lo, off } = p;
    const x = spot.x;
    let s = 1, issue = 'ok';
    if (x < lo) { s = Math.max(0, 1 - (lo - x) / D.softBelow); issue = 'deep'; }
    else if (x > line) {
      // Beyond their second-last player: gently while onside, then steeply past the offside line
      // (the product is continuous at x = off).
      s = Math.max(0, 1 - (x - line) / D.softBeyond);
      if (x > off) s *= Math.max(0, 1 - (x - off) / D.softAbove);
      issue = x > off ? 'offside' : 'beyond';
    }
    const target = issue === 'deep' ? { x: lo, y: spot.y } : issue === 'ok' ? undefined : { x: line, y: spot.y };
    return { s, target, vars: { line, off, dx: x - line, depth: D.depth, issue } };
  },

  text: {
    standard: {
      name: 'Pin their back line',
      ok: () => "You are on their last defender's shoulder, pinning their back line.",
      fail: (v) => ({
        deep: `Push up ${m(-v.dx - v.depth)} m onto their last defender's shoulder to pin their back line.`,
        beyond: `Come back ${m(v.dx)} m level with their last defender, where you pin their back line instead of standing behind it.`,
        offside: `Drop ${m(v.dx)} m to get level with their last defender instead of standing offside.`,
      })[v.issue] ?? "Stay on their last defender's shoulder.",
      cue: () => 'Where is their last defender, and how close are you to them?',
    },
    kid: {
      name: 'Stay high',
      ok: () => 'Great, you stayed high next to their last defender!',
      fail: (v) => (v.issue === 'deep'
        ? `Move ${m(-v.dx - v.depth)} m forward, next to their last defender.`
        : `Step back ${m(v.dx)} m, level with their last defender.`),
      cue: () => 'Where is their last defender?',
    },
  },

  cue(ctx) {
    return { type: 'line-x', x: ctx.lines.oppSecondLastX };
  },
};
