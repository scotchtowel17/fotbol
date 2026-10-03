// One wide, one inside (B6): a full-back and the winger on his flank never both stand in the wing lane close together,
// where one defender can mark them both. If your flank partner holds the touchline near you (a full-back overlapping
// his winger, or a winger hugging the line in front of his full-back) and you are not the one tagged to hold the
// width, come inside off the wing. scene.js brings an auto-placed winger inside when his full-back overlaps
// (shareFlanks), and buildContext stops treating him as the width-holder then, by the same test (context.js
// flankShare). Which channel inside is the half-space and between-lines rules' business.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §8.2 (B6), §8.7 (R4).

import { LANE_EDGES } from '../pitch.js';
import { flankShare, wingDepth } from '../context.js';
import { perContext, paramsFor, notApplicable, nameOf, band2 } from './_util.js';

export const FLANK_SHARE_DEFAULTS = Object.freeze({
  weight: 2.5, // [D] the B6 lesson
  inside: 1.5, // [D] metres inside the wing lane's edge for full credit (SCENE_DEFAULTS.fbShareInside)
  soft: 3, // [D] credit falls to 0 this far short of that (1.5 m out in the wing lane)
  reach: 10, // [S] B6: a full-back judged against a winger in the wing lane within about 10 m along the pitch...
  fade: 2, // [D] ...fading out over this many more (scene.js sends such a full-back inside, gone at the same 12 m)
  halfSpaceInset: 4, // [D] the spot inside: this far inside the wing lane's edge (SCENE_DEFAULTS.halfSpaceInset)
});

const prep = perContext((ctx) => {
  if (ctx.moment !== 'in_possession' || ctx.duty === 'first-attacker' || ctx.widthHolder) return null;
  const { family, side, base } = ctx.learner;
  if ((family !== 'FB' && family !== 'W') || (side !== 'L' && side !== 'R')) return null;
  const D = paramsFor(ctx, 'flank-share', FLANK_SHARE_DEFAULTS);
  const partner = ctx.teammates.find((q) => q.role === side + (family === 'W' ? 'B' : 'W'));
  if (!partner) return null;
  // A winger: his full-back holds his wing, level or overlapping (context.js flankShare). A full-back: his winger is
  // in the wing lane near him, ahead or behind.
  const k = family === 'W'
    ? flankShare('us', partner, base, side, ctx.params)
    : wingDepth(partner, side, ctx.params) * Math.min(1, Math.max(0, (D.reach + D.fade - Math.abs(partner.x - base.x)) / D.fade));
  const w = D.weight * k;
  if (!(w > 0.01)) return null;
  const edge = side === 'R' ? LANE_EDGES[4] : LANE_EDGES[1];
  return { D, w, side, edge, partner, who: nameOf(partner, ctx), hs: side === 'R' ? edge - D.halfSpaceInset : edge + D.halfSpaceInset };
});

export default {
  id: 'flank-share',
  principles: ['B6'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const inside = p.side === 'R' ? p.edge - spot.y : spot.y - p.edge; // > 0: inside the wing lane's edge
    const s = band2(inside, p.D.inside, Infinity, p.D.soft, 0);
    return {
      s,
      target: s < 1 ? { x: spot.x, y: p.hs } : undefined,
      vars: { issue: s >= 0.999 ? 'ok' : 'wide', who: p.who, partnerFb: p.partner.role.endsWith('B') },
    };
  },
  text: {
    standard: {
      name: 'One wide, one inside',
      ok: (v) => `${v.who[0].toUpperCase()}${v.who.slice(1)} holds the width and you are inside, so one defender cannot mark you both.`,
      fail: (v) => `${v.who[0].toUpperCase()}${v.who.slice(1)} holds the width on your side, so come inside off the wing, because two of you out there are marked by one defender.`,
      cue: () => 'Who is holding the width on your side?',
    },
    kid: {
      name: 'One Wide, One Inside',
      ok: () => 'Good, one of you is wide and one is inside.',
      fail: () => 'Your teammate is out wide, so move inside.',
      cue: () => 'Who is out wide on your side?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    return p ? { type: 'player', id: p.partner.id } : null;
  },
};
