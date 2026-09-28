// Canonical match situations, shared by the end-to-end tests (tests/integration.test.js), the
// coach-facing sanity report (scripts/sanity.mjs) and the dev playground (#/dev).
// Canonical frame (docs/ARCHITECTURE.md §1): we attack +x, y = 0 is our left touchline, and
// "their right" is our left (small y). Each situation is autoFrame() input without the formations
// and the learner. `carriers` lists who is on the ball, in order of preference: the first one that
// is not the learner carries (the learner never does); without it the carrier is automatic.

import { mirrorPlayerId } from '../js/engine/roles.js';
import { WIDTH } from '../js/engine/pitch.js';

export const SITUATIONS = Object.freeze([
  Object.freeze({
    id: 'their-build-up',
    title: 'Their build-up against our high press',
    note: 'Their right centre-back has the ball deep in their half; we press high.',
    ball: Object.freeze({ x: 86, y: 18 }),
    possession: 'them',
  }),
  Object.freeze({
    id: 'mid-block-half-space',
    title: 'Mid-block, ball in their right half-space',
    note: 'They have the ball just inside their own half, in the channel on our left (their right half-space); we sit in a mid-block.',
    ball: Object.freeze({ x: 60, y: 20 }),
    possession: 'them',
  }),
  Object.freeze({
    id: 'defending-left-wing',
    title: 'Ball on our left wing in our defensive third',
    note: 'Their right winger has the ball near our left touchline, level with the edge of our box.',
    ball: Object.freeze({ x: 22, y: 6 }),
    possession: 'them',
    carriers: Object.freeze(['them-RW']),
  }),
  Object.freeze({
    id: 'our-build-up',
    title: 'Our build-up from the goalkeeper',
    note: 'Our keeper has the ball in the box; they press high.',
    ball: Object.freeze({ x: 6, y: 30 }),
    possession: 'us',
    carriers: Object.freeze(['us-GK']),
  }),
  Object.freeze({
    id: 'final-third-right',
    title: 'Our attack in the final third on the right',
    note: 'Our right winger (or, if you are the right winger, the right-back) has the ball wide on the right, 23 m from their goal.',
    ball: Object.freeze({ x: 82, y: 56 }),
    possession: 'us',
    carriers: Object.freeze(['us-RW', 'us-RB']),
  }),
  Object.freeze({
    id: 'loose-ball',
    title: 'Turnover: a loose ball in midfield',
    note: 'Nobody has the ball just inside our half; both teams are out of possession until someone wins it.',
    ball: Object.freeze({ x: 50, y: 40 }),
    possession: 'none',
  }),
]);

/**
 * autoFrame() / analyseScene() options for a situation and a learner.
 * @param {object} situation  one of SITUATIONS (or a mirrored one)
 * @param {string} learnerId  e.g. 'us-LCB'
 * @param {{us: object, them?: object}} formations
 * @returns {object}
 */
export function sceneOptions(situation, learnerId, formations) {
  const carrierId = situation.carriers?.find((id) => id !== learnerId);
  return {
    formations,
    ball: { ...situation.ball },
    possession: situation.possession,
    learnerId,
    ...(carrierId ? { carrierId } : {}),
    ...(situation.tags ? { tags: { ...situation.tags } } : {}),
    ...(situation.overrides ? { overrides: { ...situation.overrides } } : {}),
  };
}

/** Left/right mirror of a situation: y → 68 - y, carrier ids swap sides, id gets '-m'. */
export function mirrorSituation(s) {
  return {
    ...s,
    id: `${s.id}-m`,
    ball: { x: s.ball.x, y: WIDTH - s.ball.y },
    ...(s.carriers ? { carriers: s.carriers.map(mirrorPlayerId) } : {}),
  };
}
