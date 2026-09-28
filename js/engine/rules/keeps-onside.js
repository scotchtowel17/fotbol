// Keeps onside (U4, IFAB Law 11): a back-liner who drops more than a metre below
// the line while an attacker waits between them and it plays that attacker onside.
// Critical: this is the deep far-side defender the research calls a critical fail.

import { HALF_X } from '../pitch.js';
import { perContext, paramsFor, notApplicable, defending, isBackLiner, offsideLineWithoutLearner, nameOf, kidNameOf, whole } from './_util.js';

export const KEEPS_ONSIDE_DEFAULTS = Object.freeze({
  weight: 3, // [D] weighted like the other back-line rules (RESEARCH 5.6)
  margin: 1, // [D] RESEARCH 5.5: only fails when you are more than 1 m deeper than the line
  soft: 3, // [D] metres past the margin where credit reaches 0
  failCap: 0.5, // [D] best score while an attacker is kept onside (the critical cliff)
});

const prep = perContext((ctx) => {
  if (!defending(ctx) || !isBackLiner(ctx) || ctx.duty === 'first-defender') return null;
  const D = paramsFor(ctx, 'keeps-onside', KEEPS_ONSIDE_DEFAULTS);
  const { last, second } = offsideLineWithoutLearner(ctx);
  const line = Math.min(second, ctx.ball.x);
  const limit = Math.min(line, HALF_X);
  // Attackers the rest of the team currently has offside: the only ones the learner can play on.
  const runners = ctx.opponents.filter((o) => o.role !== 'GK' && o.x < limit);
  if (!runners.length) return null;
  runners.sort((a, b) => a.x - b.x); // deepest first = most dangerous
  return { D, w: D.weight, line, last, ballX: ctx.ball.x, runners, rx: runners.map((o) => o.x) };
});

export default {
  id: 'keeps-onside',
  principles: ['U4'],
  critical: true,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const D = p.D;
    const sx = spot.x;
    const deficit = p.line - sx;
    let kept = -1;
    if (deficit > D.margin) {
      // With the learner at sx, the second-last defender moves to sx (unless sx is behind the last one).
      const lineWith = Math.min(sx <= p.last ? p.last : sx, p.ballX);
      for (let i = 0; i < p.rx.length; i++) if (p.rx[i] >= lineWith) { kept = i; break; }
    }
    const target = { x: p.line, y: spot.y };
    if (kept < 0) return { s: 1, target, vars: { issue: 'ok', deep: 0 } };
    const o = p.runners[kept];
    const s = D.failCap * Math.max(0, 1 - (deficit - D.margin) / D.soft);
    return {
      s,
      critical: true,
      target,
      vars: { who: nameOf(o, ctx), whoKid: kidNameOf(o, ctx), deep: whole(deficit), issue: 'kept' },
    };
  },
  text: {
    standard: {
      name: "Don't play them onside",
      ok: () => 'You stay on your line, so anyone waiting behind it is offside.',
      fail: (v) => `Step up ${v.deep} m to your line, because standing deeper keeps ${v.who} onside.`,
      cue: () => 'If the ball is played in behind right now, who would be offside without you?',
    },
    kid: {
      name: "Don't play them onside",
      ok: () => 'Good, you are in line with your defenders, so their runner is offside.',
      fail: (v) => `Move forward into line with your defenders, so ${v.whoKid} is offside.`,
      cue: () => 'Is anyone standing behind your line of defenders?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    return p ? { type: 'line-x', x: p.line } : null;
  },
};
