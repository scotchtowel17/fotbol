// Cover (D3): the second defender sits goal-side of the presser on a diagonal,
// never level with them and never straight behind. Closer when play is central
// and near our goal, further when it is wide and far. A back-liner who covers never
// covers from ahead of his own line (U4, R1): when his partner steps out further than
// the D3 depth, he covers from the line, and how far above it he stands is the level-line
// rule's to judge ("drop and get level with your back line"). This rule then only judges
// the angle and that he is not too deep, so it never tells him to hang 10 m off a partner
// "so one dribble can't beat you both" when the real reason is the line.

import { lerp } from '../geometry.js';
import { MID_Y } from '../pitch.js';
import { perContext, paramsFor, notApplicable, defending, isLearner, isBackLiner, backLineRef, nameOf, kidNameOf, band2, clamp01, whole } from './_util.js';

export const COVER_DEFAULTS = Object.freeze({
  weights: { CB: 3, FB: 3, DM: 2, CM: 2, W: 2, ST: 2 }, // [S] RESEARCH 5.6 (back line 3, #6 2); CM/W/ST [D]
  depthNear: [3, 5], // [D] D3: metres behind the presser, play central and near our goal
  depthFar: [6, 10], // [D] D3: ... play wide and far from our goal
  depthSoftLo: 2, // [D] level with the presser (< 1.5 m behind) scores ≤ 0.25
  depthSoftHi: 4, // [D]
  inside: [2, 4], // [D] D3: metres inside the presser
  insideWide: 7, // [D] upper inside bound with the ball on the touchline ("sit a little further inside")
  insideSoft: 2, // [D] straight behind (< 1 m inside) scores ≤ 0.5
  wideFrom: 10, // [D] ball distance from y = 34 where "wide" starts...
  wideTo: 27, // [D] ...and is complete
  farFrom: 30, // [D] ball x where "far from our goal" starts...
  farTo: 65, // [D] ...and is complete
  centralBand: 2, // [D] presser within this of y = 34 is central: either side counts as inside
  levelDepth: 1.5, // [D] RESEARCH 5.5: less than this behind = "level"
});

const prep = perContext((ctx) => {
  const F = ctx.firstDefender;
  if (!defending(ctx) || ctx.duty !== 'second-defender' || !F || isLearner(ctx, F)) return null;
  const D = paramsFor(ctx, 'cover', COVER_DEFAULTS);
  const w = D.weights[ctx.learner.family] ?? 0;
  if (!w) return null;
  const b = ctx.ball;
  const wide = clamp01((Math.abs(b.y - MID_Y) - D.wideFrom) / (D.wideTo - D.wideFrom));
  const far = clamp01((b.x - D.farFrom) / (D.farTo - D.farFrom));
  const f = (wide + far) / 2;
  let dLo = lerp(D.depthNear[0], D.depthFar[0], f), dHi = lerp(D.depthNear[1], D.depthFar[1], f);
  // A covering back-liner stays at or behind his line (U4): past the D3 depth the line sets his depth, and
  // standing above it is level-line's (U4) to put into words, so this rule stops judging "too tight" there.
  const line = isBackLiner(ctx) ? backLineRef(ctx)?.x : undefined;
  let softLo = D.depthSoftLo;
  if (Number.isFinite(line) && F.x - line > dLo) { dHi += F.x - line - dLo; dLo = F.x - line; softLo = Infinity; }
  const iLo = D.inside[0], iHi = lerp(D.inside[1], D.insideWide, wide);
  // +1: inside means larger y; -1: smaller y; 0: presser is central, either side will do.
  const side = F.y > MID_Y + D.centralBand ? -1 : F.y < MID_Y - D.centralBand ? 1 : 0;
  const tSide = side || Math.sign(ctx.learner.base.y - F.y) || 1;
  return {
    D, w, fx: F.x, fy: F.y, side, dLo, dHi, iLo, iHi, softLo,
    tx: F.x - (dLo + dHi) / 2, ty: F.y + tSide * (iLo + iHi) / 2,
    mate: nameOf(F, ctx), mateKid: kidNameOf(F, ctx), want: whole((dLo + dHi) / 2),
  };
});

export default {
  id: 'cover',
  principles: ['D3'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const D = p.D;
    const depth = p.fx - spot.x;
    const dy = spot.y - p.fy;
    const inside = p.side ? dy * p.side : Math.abs(dy);
    const sd = band2(depth, p.dLo, p.dHi, p.softLo, D.depthSoftHi);
    const si = band2(inside, p.iLo, p.iHi, D.insideSoft, D.insideSoft);
    const s = sd * si;
    let issue = 'ok';
    if (s < 0.999) {
      if (sd <= si) issue = depth < D.levelDepth ? 'level' : depth < p.dLo ? 'tight' : 'deep';
      else issue = inside < p.iLo ? (inside <= -1 ? 'outside' : 'behind') : 'wide';
    }
    return {
      s,
      target: { x: p.tx, y: p.ty },
      // depthRaw, insideRaw: the unrounded depth and inside (kidscore.js: covering level with, or outside, the presser)
      vars: { mate: p.mate, mateKid: p.mateKid, depth: whole(depth), inside: whole(inside), want: p.want, issue, depthRaw: depth, insideRaw: inside },
    };
  },
  text: {
    standard: {
      name: 'Cover at an angle',
      ok: (v) => `You cover ${v.mate} from behind and inside, ready to step in if they are beaten.`,
      fail: (v) => ({
        level: `Drop in behind ${v.mate}, because level with them one pass takes you both out.`,
        tight: `Give ${v.mate} more room and cover from about ${v.want} m behind, so one dribble can't beat you both.`,
        deep: `Close up to about ${v.want} m behind ${v.mate}, because from ${v.depth} m you can't get across in time.`,
        behind: `Step onto a diagonal a few metres inside ${v.mate} instead of straight behind them.`,
        outside: `Cover from the inside of ${v.mate}, between them and the middle of our goal.`,
        wide: `Close the gap across to ${v.mate} so you can still reach the ball if they are beaten.`,
      })[v.issue] ?? `Cover ${v.mate} from behind and inside.`,
      cue: (v) => `If ${v.mate} gets beaten, who is there to stop the carrier?`,
    },
    kid: {
      name: 'Back up your teammate',
      ok: () => 'Good, you are backing up your teammate at an angle.',
      fail: (v) => ({
        level: 'Move a few steps behind your teammate who went to the ball.',
        tight: 'Stay a few more steps behind your teammate.',
        deep: 'Move closer behind your teammate so you can help fast.',
        behind: 'Stand at an angle behind your teammate, not straight behind.',
        outside: 'Stand on the inside of your teammate, nearer the middle.',
        wide: 'Move a little closer to your teammate.',
      })[v.issue] ?? 'Stand behind your teammate at an angle.',
      cue: () => 'If your teammate gets beaten, who stops the attacker?',
    },
  },
  cue(ctx) {
    return ctx.firstDefender ? { type: 'player', id: ctx.firstDefender.id } : null;
  },
};
