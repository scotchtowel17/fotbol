// JSDoc type definitions shared across the engine. No runtime code.
// See docs/ARCHITECTURE.md for the full contracts.

/** @typedef {{x:number, y:number}} Vec */
/** @typedef {'us'|'them'} Team */
/** @typedef {{ id:string, team:Team, role:string, x:number, y:number }} Player */

/**
 * @typedef {Object} FrameTags
 * @property {'forward'|'backward'|'sideways'} [carrierFacing]
 * @property {boolean} [pressureOnBall]
 * @property {'pass'|'carry'|'cross'|'shot'|'clearance'|'throw-in'|'goal-kick'|'corner'|'free-kick'} [event]
 * @property {boolean} [ballMovingBack]
 * @property {string} [phase]
 */

/**
 * @typedef {Object} Frame
 * @property {number} t
 * @property {Vec} ball
 * @property {'us'|'them'|'none'} possession
 * @property {string|null} carrierId
 * @property {Player[]} players
 * @property {FrameTags} tags
 */

/**
 * @typedef {Object} RuleResult
 * @property {string} id
 * @property {string[]} principles
 * @property {number} weight
 * @property {number} s          0..1
 * @property {boolean} critical  true when a critical constraint is broken
 * @property {Vec} [target]
 * @property {Object} vars
 */

/**
 * @typedef {Object} EvalResult
 * @property {number} score      0..100 integer
 * @property {'S'|'A'|'B'|'C'|'D'|'F'} grade
 * @property {number} sZone
 * @property {number} sRules
 * @property {boolean} critical
 * @property {RuleResult[]} rules
 * @property {number} distance
 * @property {Vec} center
 * @property {{tx:number, ty:number}} tol
 */

export {};
