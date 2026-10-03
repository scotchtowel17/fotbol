// Defending crosses (U8): with the ball wide near our box, protect the width of the goal first. The centre-backs
// stay central, between the posts and inside the box (never dragged to the near post); the far full-back joins the
// line at the far post; the #6 covers the penalty spot and the edge of the box for the pull-back. Someone presses the
// crosser (the press rule: the first defender is not judged here), and marking a runner goal-side is the goal-side
// rule's, so this rule judges only where in front of goal you stand.
// Contract: docs/ARCHITECTURE.md §5.5. Rationale: docs/RESEARCH.md §8.6 (U8).

import { band } from '../geometry.js';
import { POSTS, PENALTY_AREA, PENALTY_SPOT_DIST, MID_Y, LANE_EDGES } from '../pitch.js';
import { perContext, paramsFor, notApplicable, defending, onFarSide, clamp01 } from './_util.js';

export const CROSS_DEFENCE_DEFAULTS = Object.freeze({
  weights: Object.freeze({ CB: 2.5, FB: 2.5, DM: 2 }), // [D] U8: the centre-backs, the far full-back, the #6
  crossFrom: 22, // [D] the ball nearer our goal line than this (x; level with the edge of the box the ball-side centre-back still covers)...
  crossFade: 6, // [D] ...fading in over this many metres (fully from x 16)...
  wideFade: 4, // [D] ...and out wide: from the edge of the half-space into the wing lane, fading in over this
  goalInset: 0.5, // [D] centre-backs: this far inside the posts for full credit
  depth: Object.freeze([3, 13]), // [D] centre-backs and the far full-back: inside the box, off the goal line (x)
  farPost: Object.freeze([-1, 6]), // [D] the far full-back: from 1 m inside the far post to 6 m outside it (y)
  cutback: Object.freeze({ x: Object.freeze([PENALTY_SPOT_DIST, PENALTY_AREA.depth + 3]), y: 8 }), // [D] the #6: penalty spot to just outside the box, within 8 m of the middle
  soft: 3, // [D]
});

const prep = perContext((ctx) => {
  if (!defending(ctx) || ctx.duty === 'first-defender') return null;
  const D = paramsFor(ctx, 'cross-defence', CROSS_DEFENCE_DEFAULTS);
  const fam = ctx.learner.family;
  let w = D.weights[fam] ?? 0;
  if (!w) return null;
  const b = ctx.ball;
  const off = Math.abs(b.y - MID_Y) - (LANE_EDGES[4] - MID_Y); // > 0: in a wing lane
  const k = clamp01((D.crossFrom - b.x) / D.crossFade) * clamp01((off + D.wideFade) / D.wideFade);
  if (!(k > 0)) return null;
  let job;
  if (fam === 'CB') job = 'posts';
  else if (fam === 'FB') { if (!onFarSide(ctx)) return null; job = 'far-post'; }
  else { if (ctx.duty === 'second-defender') return null; job = 'cut-back'; } // a covering #6 covers the presser
  w *= k;
  const farY = b.y > MID_Y ? POSTS.top : POSTS.bottom; // the far post, away from the ball
  const out = b.y > MID_Y ? -1 : 1; // y direction away from the ball
  return { D, w, job, farY, out };
});

export default {
  id: 'cross-defence',
  principles: ['U8', 'R1'], // R1: the centre-backs stay central on crosses
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const { D, job } = p;
    let sx, sy, tx, ty;
    if (job === 'posts') {
      sx = band(spot.x, D.depth[0], D.depth[1], D.soft);
      sy = band(spot.y, POSTS.top + D.goalInset, POSTS.bottom - D.goalInset, D.soft);
      tx = Math.min(Math.max(spot.x, D.depth[0]), D.depth[1]);
      ty = Math.min(Math.max(spot.y, POSTS.top + D.goalInset), POSTS.bottom - D.goalInset);
    } else if (job === 'far-post') {
      const u = (spot.y - p.farY) * p.out; // metres outside the far post (away from the ball)
      sx = band(spot.x, D.depth[0], D.depth[1], D.soft);
      sy = band(u, D.farPost[0], D.farPost[1], D.soft);
      tx = Math.min(Math.max(spot.x, D.depth[0]), D.depth[1]);
      ty = p.farY + p.out * Math.min(Math.max(u, D.farPost[0]), D.farPost[1]);
    } else {
      sx = band(spot.x, D.cutback.x[0], D.cutback.x[1], D.soft);
      sy = band(Math.abs(spot.y - MID_Y), 0, D.cutback.y, D.soft);
      tx = Math.min(Math.max(spot.x, D.cutback.x[0]), D.cutback.x[1]);
      ty = MID_Y + Math.sign(spot.y - MID_Y) * Math.min(Math.abs(spot.y - MID_Y), D.cutback.y);
    }
    const s = sx * sy;
    const issue = s >= 0.999 ? 'ok' : sx < sy ? (job === 'cut-back' ? (spot.x < D.cutback.x[0] ? 'deep' : 'high') : spot.x < D.depth[0] ? 'line' : 'high') : 'wide';
    return { s, target: s < 0.999 ? { x: tx, y: ty } : undefined, vars: { job, issue } };
  },
  text: {
    standard: {
      name: 'Defend the cross',
      ok: (v) => ({
        posts: 'You stay between the posts inside the box, protecting the middle of the goal.',
        'far-post': 'You joined the line at the far post, so a cross to the back post has someone there.',
        'cut-back': 'You cover the penalty spot for the pull-back.',
      })[v.job],
      fail: (v) => ({
        posts: v.issue === 'wide'
          ? 'Stay between the posts, because the middle of the goal is what the cross is aimed at, not the near post.'
          : v.issue === 'line' ? 'Step off the goal line, so you can attack the cross in front of the goal.' : 'Drop inside the box, between the posts, before the cross comes in.',
        'far-post': v.issue === 'wide'
          ? 'Get to the far post and join the line, so a cross to the back post has someone goal-side.'
          : v.issue === 'line' ? 'Step off the goal line at the far post.' : 'Drop into the box at the far post before the cross comes in.',
        'cut-back': v.issue === 'wide'
          ? 'Come into the middle to cover the penalty spot, where the pull-back is aimed.'
          : v.issue === 'deep' ? 'Hold at the penalty spot, not on top of your defenders, so you can block the pull-back.' : 'Drop to the edge of the box to cover the pull-back.',
      })[v.job],
      cue: () => 'Where will the cross be aimed, and who is protecting the middle of the goal?',
    },
    kid: {
      name: 'Crossing Guard',
      ok: (v) => ({ posts: 'Good, you guard the middle of the goal.', 'far-post': 'Good, you guard the far post.', 'cut-back': 'Good, you guard the penalty spot.' })[v.job],
      fail: (v) => ({
        posts: 'Stay in front of the goal, between the posts.',
        'far-post': 'Go to the far post, in the box.',
        'cut-back': 'Guard the penalty spot for the pass back.',
      })[v.job],
      cue: () => 'Where will the cross go?',
    },
  },
  cue(ctx) {
    const p = prep(ctx);
    if (!p) return null;
    return p.job === 'cut-back' ? { type: 'point', x: PENALTY_SPOT_DIST, y: MID_Y } : { type: 'segment', a: { x: 1, y: POSTS.top }, b: { x: 1, y: POSTS.bottom } };
  },
};
