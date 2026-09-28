// The whole engine loop for one static scene, in two calls. Explore mode, the dev playground,
// the end-to-end tests and scripts/sanity.mjs all use it, so they judge a spot the same way.
// Contract: docs/ARCHITECTURE.md §5.10.
//
//   analyseScene(opts)       once per scene (ball, possession, learner):
//                            autoFrame → learnerBase → buildContext → computeGhost
//   judgeSpot(scene, spot)   per candidate spot (a drag, a drop): evaluate → explain
//
// The learner's own token in `frame` never matters: the context reads teammates and opponents,
// and the learner is judged wherever `spot` is.

import { autoFrame, learnerBase } from './scene.js';
import { buildContext } from './context.js';
import { computeGhost } from './ghost.js';
import { evaluate } from './score.js';
import { explain } from './explain.js';

/**
 * Place a scene and find the learner's ideal spot.
 * @param {Object} opts  autoFrame() options (formations, ball, possession, carrierId, learnerId, overrides,
 *   params, ...) plus:
 * @param {object} [opts.tags]     frame tags (event, carrierFacing, pressureOnBall, widthHolders, ...)
 * @param {object} [opts.context]  buildContext params (CONTEXT_DEFAULTS overrides; `rules` for rule defaults)
 * @param {object} [opts.ghost]    computeGhost options (radius, step, tol, rules)
 * @returns {{ frame: import('./types.js').Frame, base: {x:number,y:number}, ctx: object,
 *             ghost: ReturnType<typeof computeGhost> }}
 */
export function analyseScene({ tags, context, ghost: ghostOpts, ...sceneOpts }) {
  if (!sceneOpts.learnerId) throw new TypeError('analyseScene: opts.learnerId is required');
  const frame = autoFrame(sceneOpts);
  if (tags) frame.tags = { ...tags };
  const base = learnerBase(sceneOpts);
  const ctx = buildContext(frame, { learnerId: sceneOpts.learnerId, base, params: context });
  const ghost = computeGhost(ctx, ghostOpts);
  return { frame, base, ctx, ghost };
}

/**
 * Score a spot for the scene's learner and phrase the feedback (fix = toward the ghost). The zone is the
 * ghost search's: its centre and tolerance, so a spot on the ghost scores exactly the ghost's score.
 * @param {{ ctx: object, ghost: { spot: {x:number,y:number}, result: object } }} scene  from analyseScene()
 * @param {{x:number, y:number}} spot
 * @param {{ wording?: 'standard'|'kid', principles?: object, rules?: object[] }} [opts]
 *   rules: pass the same rule set the ghost was searched with, if not the registry
 * @returns {{ result: ReturnType<typeof evaluate>, feedback: ReturnType<typeof explain> }}
 */
export function judgeSpot({ ctx, ghost }, spot, { wording, principles, rules } = {}) {
  // Same zone as the ghost search: its centre (the base, or an authored ideal passed as ghost.base) and tolerance.
  const result = evaluate(ctx, spot, { rules, center: ghost.result.center, tol: ghost.result.tol });
  const feedback = explain(result, ctx, spot, { wording, principles, rules, ghost: ghost.spot });
  return { result, feedback };
}
