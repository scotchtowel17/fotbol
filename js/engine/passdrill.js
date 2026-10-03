// Pass drills ("Who's open?"): the learner receives the ball in a short ball-scripted build-up and, at the
// freeze, picks who to pass to. Generated from scenes (varied so a different teammate is open: one marked, one left
// free; and two hand-shaped templates), checked by the drill gates, rated by passing.js; sets keep their bests varied.
// canGeneratePass says up front which ideas a position never gets. Contract: docs/ARCHITECTURE.md §5.14. Rationale:
// docs/research/passing.md §4.5 (the drill and its gates), §4.6 (generating drills); docs/KID_REDESIGN.md §4.4, §6.1.
//
// A pass drill is an ordinary ball-scripted scenario (ARCHITECTURE §5.3) with kind 'pass', answer.mode
// 'pass', and the LEARNER AS THE CARRIER at the freeze, so it is played and judged with nobody held back:
// passDrillFrame(drill, t) = frameAt(drill, t, { formations, learnerId: null }). validateScenario() rejects a
// learner carrier, so validatePassDrill() checks it instead. PURE and deterministic: a seeded PRNG
// (sequence.js createRng), no Math.random, no clock.

import { clamp, dist, norm } from './geometry.js';
import { LENGTH, WIDTH, MID_Y, clampToPitch } from './pitch.js';
import { LEARNABLE_ROLES, ROLE_INFO, playerId, parsePlayerId, mirrorPlayerId } from './roles.js';
import { teamTargets } from './formation.js';
import { autoFrame } from './scene.js';
import { frameAt, timing, carrierAt, possessionAt } from './timeline.js';
import { validateScenario, mirrorScenario, learnerId as learnerIdOf } from './scenario.js';
import { createRng, createPlayback, hashSeed } from './sequence.js';
import { rateOptions, PASS_DEFAULTS } from './passing.js';

export const PASSDRILL_DEFAULTS = Object.freeze({
  maxAttempts: 40, // [D] candidate scenes per drill before generatePassDrill gives up (null)
  fastFail: true, // an idea this position never gets a drill on (canGeneratePass, PASS_YIELD) gives null at once (false: try anyway)
  margin: 8, // [D] research §4.5: the best leads every other (non-accepted) option by at least this many points
  minChoices: 3, // [D] ...at least this many options are not cut out...
  forwardSlots: 3, // [D] ...and of every forwardCycle consecutive integer seeds, this many want a forward best
  forwardCycle: 5, // [D]    (the "always pass back" trap, research §6.4)
  passLength: Object.freeze([8, 24]), // [D] m: the pass that brings the ball to the learner
  passSpeed: Object.freeze([12, 18]), // [D] m/s, longer passes struck harder (sequence.js plays 12-20)
  holdTime: Object.freeze([0.6, 1.0]), // [D] s the passer has the ball before the pass
  carryChance: 0.5, // [D] ...running with it
  carrySpeed: Object.freeze([3, 5]), // [D] m/s
  freezeAfter: Object.freeze([0.45, 0.6]), // [D] s after the learner receives (research §4.6: about 0.5 s)
  noPressChance: 0.25, // [D] share of scenes where nobody presses the learner (scenario params autoPress: false)
  jitter: 1.5, // [D] m of randomness on the passer's spot
  edge: 3, // [D] m: the ball stays this far inside the lines
  templateChance: 0.6, // [D] with a template principle asked for (PA6 switch, PA10 own goal), the share of tries that use it
  switchFrom: Object.freeze([6, 24]), // [D] m off the middle: where the switch template's learner gets the ball...
  crowdShift: 15, // [D] ...while their block stands where their shape puts it for a ball this much nearer that touchline,
  pressGap: 2.5, // [D] ...their nearest player presses this far goal-side of the ball,
  crowd: 3, // [D] ...the next nearest mark our ball-side options (this many, nearest the ball)...
  crowdGap: 1.5, // [D] ...this many metres goal-side of them,
  screenBand: 14, // [D] ...and our central options (this close to the middle) nearest the ball, inside or behind it,
  screenAt: 0.5, // [D] ...are screened by their #9 or whoever is nearest, standing this far along the pass to them
  // Who's open, varied (varyScene): the HELIOS shape puts a position's teammates and markers in much the same places every
  // time (a full-back's winger free down the line in 9 of 10 scenes), so a natural scene's picture is varied:
  markChance: 0.4, // [D] share of natural scenes where the plain best's receiver gets a marker tight on him...
  freeChance: 0.3, // [D] ...and where a teammate ahead of the ball is left free (their players near him step away)
  markGap: 1.6, // [D] m: the marker stands this far from him, goal-side and a little ball-side...
  markFrom: 12, // [D] m: ...coming from at most this far away
  freeRadius: 5, // [D] m: their players this close to the teammate left free step away...
  freeGap: 7, // [D] m: ...to this far from him (the nearest such spot to where they started, out of the pass to him)...
  freeLane: 3, // [D] m: ...at least this far from the line of that pass
  freeReach: 32, // [D] m: the teammate left free is at most this far from the ball
  maxMoveSpeed: 7, // [D] m/s: nobody walks to a new spot faster than this during the lead-in
  shortFamilies: Object.freeze(['W', 'ST']), // [D] positions that sometimes come short to get the ball...
  shortChance: 0.35, // [D] ...this share of their natural scenes...
  shortDist: Object.freeze([6, 12]), // [D] ...this many metres from their spot, toward the passer and our goal
  // Sets (generatePassSet) and similarPassDrills
  maxSameBest: 2, // [D] at most this many drills of a set star a pass to the same position
  nearBall: 3, // [D] m: two drills with the ball this close at the freeze look the same...
  nearSameBest: 15, // [D] m: ...and so do two with the same best receiver and the ball this close (two pull-backs from a corner)
  setTries: 3, // [D] seeds tried per slot of a set
  maxPassSpeed: 20, // [D] realism gate: no pass faster than this (m/s)...
  maxCarrySpeed: 7, // [D] ...and no carry faster than this
  tRound: 1e3, // times rounded to 1 ms...
  pRound: 1e2, // ...and positions to 1 cm, so drills are compact and exactly reproducible
});

/**
 * The principles a pass drill can teach, and how a rating teaches each (research §4.6): a reason the best pass
 * has, or a trap (a decoy that carries the lesson: PA2, PA4, PA10, PA12). explainPass(..., { focus }) then leads
 * the best's line with the drill's principle.
 */
const has = (o, tag) => o.tags.some((t) => t.tag === tag);
const looksFree = (o, P) => o.kind === 'feet' && o.receiverPressure < P.pressureFree;
export const PASS_LESSONS = Object.freeze({
  PA1: () => true, // look before you receive: every drill's watch phase
  PA2: (r) => r.best.direction === 'forward' && r.best.colour === 'green' && r.options.some((o) => has(o, 'too-safe')),
  PA3: (r, P) => has(r.best, 'free') || (looksFree(r.best, P) && r.options.some((o) => has(o, 'under-pressure'))),
  PA4: (r, P) => r.options.some((o) => o.colour === 'red' && looksFree(o, P) && (has(o, 'blocked') || has(o, 'reachable'))),
  PA5: (r) => r.best.lineBroken !== null,
  PA6: (r) => has(r.best, 'switch'),
  PA8: (r) => r.best.kind === 'space',
  PA9: (r) => has(r.best, 'can-turn'),
  PA10: (r) => r.options.some((o) => has(o, 'across-own-goal')),
  PA11: (r) => has(r.best, 'zone-14') || has(r.best, 'cut-back'),
  PA12: (r) => !has(r.best, 'too-long') && r.options.some((o) => o.colour !== 'green' && has(o, 'too-long')),
  PA13: (r) => has(r.best, 'keep-it'),
});
/** Principles whose lesson is never a forward pass (no forward slot). PA7, PA14 and PA15 are v2: never generated. */
const NOT_FORWARD = new Set(['PA13']);

/** Fallback wording when no principle catalogue is passed (data/principles.json as written; the catalogue passed in wins). */
const LESSON_TEXT = Object.freeze({
  PA1: ['Scan before you receive', 'Look Around First', 'Check over your shoulders before the ball reaches you, so you already know your next pass when it arrives.', 'Look around before the ball gets to you.'],
  PA2: ['Play forward when it is on', 'Play It Forward', 'Pick the forward pass when it is safe. If it is not on, go around by switching the play, or back.', 'If a forward pass is safe, play it.'],
  PA3: ['Find the free player', 'Find the Free Player', 'Pass to the teammate with time and space, not to one squeezed between opponents.', 'Pass to a teammate with no one near.'],
  PA4: ['Pass through a clear lane', 'Pick a Clear Path', 'A pass needs a clear lane: no defender within reach of the line, and none who can get across before the ball arrives.', 'If a defender is in the way, don\'t pass there.'],
  PA5: ['Break lines with your pass', 'Pass Past Them', 'Move the ball between and beyond their players, and count the opponents your pass takes out of the game.', 'Pass past their players, not in front of them.'],
  PA6: ['Switch play to the free side', 'Find the Free Side', 'When the ball side is crowded, move the ball across to the far side, where a teammate holds the width.', 'Crowded here? Send it to the free side.'],
  PA8: ['Pass into space ahead of a runner', 'Lead the Runner', 'Play into space when your runner will get there first; play to feet when the receiver is marked or coming short.', 'Runner in space? Pass in front of them.'],
  PA9: ['Pick a receiver who can turn', 'Pick Who Can Turn', 'Prefer a teammate who can turn and face goal. A player with their back to goal and a marker tight behind will have to play it back.', 'Pick a teammate who can turn and face goal.'],
  PA10: ['Never pass across your own goal', 'Never Across Your Goal', 'In your own third, never play a sideways pass across the front of your goal unless it is completely safe.', 'Never pass across the front of your own goal.'],
  PA11: ['Find the golden zone', 'Pull It Back', 'In the final third, look for the space in front of their box, and from near the end line pull the ball back low toward the penalty spot.', 'At the end line, pull it back to the penalty spot.'],
  PA12: ['Long passes need a clear lane', 'Long Passes Are Hard', 'The risk of a pass grows with its length and flight time, so play a long pass only when its lane is wide open.', 'Long passes are hard. Play them only when wide open.'],
  PA13: ['Keep the ball when nothing is on', 'Keep It, Look Again', 'When no forward pass is on, keep possession with a safe pass sideways or back, then look to switch or go forward again.', 'Nothing forward? Keep the ball and look again.'],
});

const PASS_WORDS = Object.freeze({
  brief: 'The ball is coming to you. Check your options before it arrives.',
  briefKid: 'The ball is coming to you. Look around.',
  question: 'Who do you pass to?',
  questionKid: "Who's open?",
});

/**
 * Scene params every pass drill plays with. runSpeed 0: the lead-in lands on the very scene that was rated (the ball
 * reaches the learner at the freeze, so players running to their spots would still be on the way: timeline.js
 * runTargets). halfSpace and salida false: the learner is on the ball at the freeze and the options are the table
 * shape's (scene.js moves the ball-side #8 into the half-space, and the full-backs up when the #6 drops between the
 * centre-backs, for "Find your spot" lessons; here they would change which receivers the generated sets and small
 * games are measured on).
 */
const SCENE_PARAMS = Object.freeze({ runSpeed: 0, halfSpace: false, salida: false });

// ---------------------------------------------------------------- playing and checking a drill

/** The frame of a pass drill at t, as it is played and judged: nobody held back, the learner on the ball at the freeze. */
export function passDrillFrame(drill, t, { formations, params } = {}) {
  return frameAt(drill, t, { formations, learnerId: null, params });
}

/** An incremental playback of a pass drill (sequence.js createPlayback, nobody held back): frameAt(t) at about one autoFrame a call. */
export function passDrillPlayback(drill, { formations, params } = {}) {
  return createPlayback(drill, { formations, learnerId: null, params });
}

/** The rating at the freeze (passing.js rateOptions on passDrillFrame at freezeAt). */
export function passDrillRating(drill, { formations, params } = {}) {
  const frame = passDrillFrame(drill, timing(drill).freezeAt, { formations });
  return rateOptions(frame, learnerIdOf(drill), params ?? drill.params?.pass);
}

const OPTION_RE = /^us-[A-Z]+(@space)?$/;

/**
 * Check a pass drill's format: the scenario format (validateScenario, which would refuse a learner on the
 * ball, is run on a copy that names another role as the learner), plus kind 'pass', answer.mode 'pass',
 * moment in_possession, the learner on the ball at the freeze, and keyed answers that are option ids.
 * @returns {string[]} errors; empty = valid
 */
export function validatePassDrill(drill, { principles } = {}) {
  if (!drill || typeof drill !== 'object' || Array.isArray(drill)) return ['pass drill must be a JSON object'];
  const errs = [];
  const role = drill.learner?.role;
  if (!LEARNABLE_ROLES.includes(role)) return [`learner.role ${JSON.stringify(role)} must be one of ${LEARNABLE_ROLES.join(', ')}`];
  const me = playerId('us', role);
  const carriers = new Set((drill.timeline?.carrier ?? []).map((k) => k?.id));
  const stand = LEARNABLE_ROLES.find((r) => !carriers.has(playerId('us', r)) && r !== role);
  const { answer: _a, rating: _r, ...rest } = drill;
  errs.push(...validateScenario({ ...rest, learner: { ...drill.learner, role: stand } }, { principles }).map((e) => e.replaceAll(playerId('us', stand), me)));
  if (drill.kind !== 'pass') errs.push("kind must be 'pass'");
  if (drill.moment !== 'in_possession') errs.push("moment must be 'in_possession' (the learner has the ball)");
  if (drill.answer?.mode !== 'pass') errs.push("answer.mode must be 'pass'");
  const keyed = [['best', drill.answer?.best], ...(Array.isArray(drill.answer?.accept) ? drill.answer.accept.map((v, i) => [`accept[${i}]`, v]) : [])];
  for (const [k, v] of keyed) {
    if (v !== undefined && !(typeof v === 'string' && OPTION_RE.test(v))) errs.push(`answer.${k} ${JSON.stringify(v)} must be an option id like 'us-LCM' or 'us-LW@space'`);
  }
  if (!errs.length) {
    const t = timing(drill).freezeAt;
    if (carrierAt(drill, t) !== me) errs.push(`the learner (${me}) must have the ball at the freeze (t=${t}), not ${carrierAt(drill, t) ?? 'nobody'}`);
    if (possessionAt(drill, t) !== 'us') errs.push('we must have the ball at the freeze');
  }
  return errs;
}

/**
 * The drill-quality gates on a rating (research §4.5): a clear best (it leads the best other option by
 * `margin` points, accepted alternatives aside; a too-safe option counts at its graded cap), the best not cut out, at least minChoices real choices, and
 * a decoy (a cut-out pass to a teammate who looks free, or a safe-but-slow one). keyed: a coach's answer.best,
 * which must be the engine's best or within bestMargin of it.
 * @returns {{ problems: string[], margin:number, choices:number, decoys:number }}
 */
export function passDrillGates(rating, { accept = [], keyed, params } = {}) {
  const D = { ...PASSDRILL_DEFAULTS, ...params };
  const P = rating.params ?? PASS_DEFAULTS;
  const best = rating.best;
  // A safe-but-slow option (too-safe) is graded at most tooSafeCap, so that is what it competes with (PA2).
  const effective = (o) => (has(o, 'too-safe') ? Math.min(o.score, P.tooSafeCap) : o.score);
  const others = rating.options.filter((o) => o.id !== best.id && !accept.includes(o.id)).sort((a, b) => effective(b) - effective(a));
  const margin = best.score - (others[0] ? effective(others[0]) : 0);
  const choices = rating.options.filter((o) => o.colour !== 'red').length;
  const decoys = rating.options.filter((o) => (o.colour === 'red' && looksFree(o, P)) || has(o, 'too-safe')).length;
  const problems = [];
  if (margin < D.margin) problems.push(`no clear best: ${best.id} leads ${others[0]?.id} by only ${margin} points (< ${D.margin})`);
  if (best.colour === 'red') problems.push(`the best pass (${best.id}) would probably be cut out`);
  if (choices < D.minChoices) problems.push(`only ${choices} passes are not cut out (< ${D.minChoices})`);
  if (!decoys) problems.push('no decoy: no teammate who looks free but cannot be reached, and no safe-but-slow pass');
  if (keyed) {
    const k = rating.options.find((o) => o.id === keyed);
    if (!k) problems.push(`answer.best ${keyed} is not an option`);
    else if (k.id !== best.id && best.score - k.score > P.bestMargin) problems.push(`key disagreement: the engine's best is ${best.id}, ${best.score - k.score} points above the keyed ${keyed}`);
  }
  return { problems, margin, choices, decoys };
}

/** Which of `principles` a rating teaches (PASS_LESSONS), in the order asked. */
export function passLessons(rating, principles = Object.keys(PASS_LESSONS)) {
  const P = rating.params ?? PASS_DEFAULTS;
  return principles.filter((p) => PASS_LESSONS[p]?.(rating, P));
}

/** Left/right mirror of a pass drill: mirrorScenario, the carrier and keyed answers mirrored, the rating recomputed (formations given) or dropped. */
export function mirrorPassDrill(drill, { formations, params } = {}) {
  const m = mirrorScenario(drill);
  const flip = (id) => (typeof id === 'string' ? id.replace(/^[^@]+/, (p) => mirrorPlayerId(p)) : id);
  if (m.carrierId) m.carrierId = flip(m.carrierId);
  if (m.carrier) m.carrier = flip(m.carrier);
  if (m.answer) {
    if (m.answer.best) m.answer.best = flip(m.answer.best);
    if (Array.isArray(m.answer.accept)) m.answer.accept = m.answer.accept.map(flip);
  }
  if (formations) m.rating = passDrillRating(m, { formations, params });
  else delete m.rating;
  return m;
}

/**
 * Validate a pass drill and run the gates on its freeze frame, and on its mirror (unless mirror: false).
 * @param {object} drill
 * @param {{ formations: {us:object, them?:object}, principles?: object, params?: object, mirror?: boolean }} opts
 *   params: PASSDRILL_DEFAULTS overrides (params.pass: PASS_DEFAULTS overrides)
 * @returns {{ errors: string[] } | { errors: [], frame, rating, best, margin, choices, decoys, forward: boolean,
 *   lessons: string[], problems: string[] }}  problems empty = a good drill
 */
export function checkPassDrill(drill, { formations, principles, params, mirror = true } = {}) {
  const errors = validatePassDrill(drill, { principles });
  if (errors.length) return { errors };
  const D = { ...PASSDRILL_DEFAULTS, ...params };
  const t = timing(drill).freezeAt;
  const frame = passDrillFrame(drill, t, { formations });
  const me = learnerIdOf(drill);
  const problems = [];
  if (frame.carrierId !== me) problems.push(`the learner is not on the ball at the freeze (${frame.carrierId})`);
  const rating = rateOptions(frame, me, params?.pass ?? drill.params?.pass);
  const g = passDrillGates(rating, { accept: drill.answer?.accept ?? [], keyed: drill.answer?.best, params });
  problems.push(...g.problems);
  problems.push(...speedProblems(drill, D));
  if (drill.rating?.best && drill.rating.best.id !== rating.best.id) problems.push(`the stored rating is stale: it stars ${drill.rating.best.id}, the engine ${rating.best.id}`);
  if (mirror) {
    const m = checkPassDrill(mirrorPassDrill(drill), { formations, principles, params, mirror: false });
    for (const p of m.errors?.length ? m.errors : m.problems) problems.push(`mirror: ${p}`);
  }
  return {
    errors: [], frame, rating, best: rating.best, margin: g.margin, choices: g.choices, decoys: g.decoys,
    forward: isForward(rating.best), lessons: passLessons(rating), problems,
  };
}

/** Realistic speeds: every pass (a 'pass' key to the next key) and carry within the limits. */
function speedProblems(drill, D) {
  const b = drill.timeline.ball ?? [];
  const out = [];
  for (let i = 0; i < b.length - 1; i++) {
    const v = dist(b[i], b[i + 1]) / Math.max(1e-9, b[i + 1].t - b[i].t);
    const limit = b[i].event === 'pass' ? D.maxPassSpeed : D.maxCarrySpeed;
    if (v > limit + 1e-6) out.push(`the ball moves at ${v.toFixed(1)} m/s from t=${b[i].t} (limit ${limit})`);
  }
  return out;
}

const isForward = (o) => o.direction === 'forward' || has(o, 'switch');

// ---------------------------------------------------------------- generating drills

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'seed';

/** True when this seed's drill should have a forward best: forwardSlots of every forwardCycle consecutive integer seeds. */
export function forwardSlot(seed, D = PASSDRILL_DEFAULTS) {
  const n = typeof seed === 'number' && Number.isFinite(seed) ? Math.floor(seed) : hashSeed(seed);
  const k = ((n % D.forwardCycle) + D.forwardCycle) % D.forwardCycle;
  // Spread the slots through the cycle (1, 3 and 4 of 0-4), so any forwardCycle consecutive seeds hold exactly forwardSlots.
  return Math.floor(((k + 1) * D.forwardSlots) / D.forwardCycle) > Math.floor((k * D.forwardSlots) / D.forwardCycle);
}

/**
 * Generate a pass drill for a learner role, deterministic for (seed, role, principles, direction, avoid, unlike).
 * Tries up to maxAttempts scenes from the seeded stream; keeps the first whose freeze passes the gates,
 * teaches one of `principles` (any pass principle when none is asked), has the wanted direction, stars none of the
 * receivers to `avoid`, looks like none of the drills in `unlike`, and whose mirror passes the gates too. A natural
 * scene's picture is varied (varyScene) so the open teammate, and so the best pass, is not always the same one.
 * @param {{ seed?: number|string, role: string, principles?: string[], formations: {us:object, them?:object},
 *           catalogue?: object, direction?: 'forward'|'any'|'auto', avoid?: string[], unlike?: object[], params?: object }} opts
 *   catalogue: data/principles.json (any form: {principles}, {list}, {byId}, array) for the titles and takeaway;
 *   direction 'auto' (default): 'forward' on forwardSlot(seed) seeds when a forward best can teach a principle asked
 *   (not PA13; PA10 only for a centre-back), else 'any'; avoid: receivers the best pass must not go to, as roles or
 *   player ids ('ST', 'us-LW'): a set builder's way to vary its bests (the generator marks them out of the picture;
 *   the id then ends '-x-<roles>'); unlike: drills already in the set, which the new one must not look like
 *   (similarPassDrills; a skipped scene is only skipped, so the drill is the one this seed gives at that attempt, and
 *   its id ends '-a<attempt>' from the second attempt on); params: PASSDRILL_DEFAULTS overrides, params.pass:
 *   PASS_DEFAULTS overrides; trace: an array that collects { attempt, template, reason } for every rejected scene
 * @returns {object|null} the drill (docs/ARCHITECTURE.md §5.14), or null when no scene passed
 */
export function generatePassDrill({ seed = 1, role, principles = [], formations, catalogue, direction = 'auto', avoid = [], unlike = [], params, trace } = {}) {
  if (!formations?.us) throw new TypeError('generatePassDrill: formations.us is required');
  if (!LEARNABLE_ROLES.includes(role)) throw new TypeError(`generatePassDrill: role ${role} is not a learnable role`);
  const D = { ...PASSDRILL_DEFAULTS, ...params };
  const asked = principles.filter((p) => PASS_LESSONS[p]);
  if (principles.length && !asked.length) return null; // only v2 principles asked (PA7, PA14, PA15): nothing to generate
  const want = direction === 'auto' ? (forwardable(asked, role) && forwardSlot(seed, D) ? 'forward' : 'any') : direction;
  if (D.fastFail && asked.length && !canGeneratePass(role, asked, { direction: want })) return null; // measured: never (fast)
  const shun = new Set((avoid ?? []).map(receiverRole).filter(Boolean));
  const pictures = (unlike ?? []).map(passDrillPicture).filter(Boolean);
  const me = playerId('us', role);
  const rng = createRng(`pass|${role}|${seed}`);
  const reject = (attempt, template, reason) => { trace?.push({ attempt, template, reason }); };
  // What must hold of a candidate's rating before the (costlier) drill checks: a string says what does not.
  const why = (rating) => {
    const gates = passDrillGates(rating, { params: D }).problems;
    if (gates.length) return gates[0].replace(/:.*$/, '');
    if (want === 'forward' && !isForward(rating.best)) return 'not forward';
    if (shun.has(receiverRole(rating.best.targetId))) return 'a receiver to avoid';
    if (pictures.length && pictures.some((q) => samePicture(q, { role, ball: rating.ball, best: receiverRole(rating.best.targetId) }, D))) return 'looks like a drill in the set';
    const taught = passLessons(rating, asked.length ? asked : Object.keys(PASS_LESSONS).filter((p) => p !== 'PA1'));
    if (!pickPrimary(rating, asked, taught) || (asked.length && !taught.length)) return 'not the lesson asked';
    return null;
  };
  for (let attempt = 0; attempt < D.maxAttempts; attempt++) {
    const template = pickTemplate(rng, role, asked, D);
    const plain = template === 'switch' ? switchScene(rng, role, formations, D)
      : template === 'own-goal' ? ownGoalScene(rng, role, formations, D) : naturalScene(rng, role, formations, D);
    if (typeof plain === 'string') { reject(attempt, template, plain); continue; }
    const plainRating = rateOptions(plain.frame, me, D.pass);
    // The candidates, in order. A template scene as it is. A natural one varied first (varyScene: who is open), the
    // plain one after: when the caller avoids the plain best's receiver, mark him, else leave another teammate free (and
    // never the plain scene); when a forward best is wanted and the plain one is not, leave a teammate ahead free.
    let tries = [null];
    if (!template) {
      const u = rng.next();
      if (shun.has(receiverRole(plainRating.best.targetId))) tries = ['marked', 'free'];
      else if (want === 'forward' && !isForward(plainRating.best)) tries = ['free'];
      else tries = [u < D.markChance ? 'marked' : u < D.markChance + D.freeChance ? 'free' : null, null].filter((v, i, a) => a.indexOf(v) === i);
    }
    let pick = null;
    for (const variant of tries) {
      let built = plain, rating = plainRating;
      if (variant) {
        const varied = varyScene(rng, role, formations, D, plain, plainRating, variant, want === 'forward', shun);
        if (typeof varied === 'string') { reject(attempt, variant, varied); continue; }
        built = varied;
        rating = rateOptions(built.frame, me, D.pass);
      }
      const kind = template ?? variant;
      const bad = why(rating);
      if (bad) { reject(attempt, kind, bad); continue; }
      pick = { built, rating, kind };
      break;
    }
    if (!pick) continue;
    const { built, rating, kind } = pick;
    const taught = passLessons(rating, asked.length ? asked : Object.keys(PASS_LESSONS).filter((p) => p !== 'PA1'));
    const primary = pickPrimary(rating, asked, taught);
    const drill = writeDrill({ seed, role, rating, built, primary, taught, asked, want, direction, attempt, template: kind, avoid: [...shun].sort(), catalogue, D });
    const own = checkPassDrill(drill, { formations, params: D, mirror: false });
    if (own.errors?.length || own.problems.length) { reject(attempt, kind, `check: ${(own.errors ?? own.problems)[0]}`); continue; }
    const mirrored = checkPassDrill(mirrorPassDrill(drill), { formations, params: D, mirror: false });
    if (mirrored.errors?.length || mirrored.problems.length) { reject(attempt, kind, `mirror: ${(mirrored.errors ?? mirrored.problems)[0]}`); continue; }
    return drill;
  }
  return null;
}

/** The role of a pass option's receiver: 'us-LW@space', 'us-LW' or 'LW' → 'LW' (null when it is none). */
function receiverRole(id) {
  if (typeof id !== 'string' || !id) return null;
  const bare = id.replace(/@.*$/, '');
  const role = bare.includes('-') ? parsePlayerId(bare).role : bare;
  return ROLE_INFO[role] ? role : null;
}

/**
 * [M] Measured yield of generatePassDrill: the share of calls that give a drill on one principle, per role family, as
 * [direction 'any', direction 'forward'] (8 seeds each, both sides; fastFail off). The zeros held on 24 more seeds each:
 * no full-back switch or pass into space, no free-side switch for #8s and wingers, across-our-goal traps only for the back
 * four (and the #6 now and then), no pull-back from the back four, and keeping the ball is never a forward pass.
 * Re-measure after changing the generator or passing.js: tests/passdrill.test.js spot-checks the zeros.
 */
export const PASS_YIELD = Object.freeze({
  PA2: Object.freeze({ CB: [1, 1], FB: [1, 1], DM: [0.75, 1], CM: [1, 1], W: [0.75, 1], ST: [0.88, 0.75] }),
  PA3: Object.freeze({ CB: [1, 1], FB: [1, 1], DM: [1, 0.88], CM: [1, 1], W: [1, 0.75], ST: [1, 0.63] }),
  PA4: Object.freeze({ CB: [1, 1], FB: [1, 1], DM: [1, 1], CM: [1, 1], W: [1, 1], ST: [1, 0.88] }),
  PA5: Object.freeze({ CB: [1, 1], FB: [1, 1], DM: [0.88, 1], CM: [1, 1], W: [0.63, 1], ST: [0.88, 0.63] }),
  PA6: Object.freeze({ CB: [0.63, 0.63], FB: [0, 0], DM: [0.13, 0.25], CM: [0, 0], W: [0, 0], ST: [0.13, 0] }),
  PA8: Object.freeze({ CB: [0.13, 0.25], FB: [0, 0], DM: [0.75, 0.75], CM: [0.63, 0.63], W: [0.5, 1], ST: [0.75, 0.63] }),
  PA9: Object.freeze({ CB: [1, 1], FB: [1, 1], DM: [0.88, 1], CM: [1, 1], W: [0.5, 1], ST: [1, 0.88] }),
  PA10: Object.freeze({ CB: [1, 1], FB: [1, 1], DM: [0.13, 0.25], CM: [0, 0], W: [0, 0], ST: [0, 0] }),
  PA11: Object.freeze({ CB: [0, 0], FB: [0, 0], DM: [1, 0.5], CM: [1, 0.63], W: [0.63, 0], ST: [1, 0.25] }),
  PA12: Object.freeze({ CB: [1, 1], FB: [1, 1], DM: [1, 1], CM: [1, 1], W: [1, 1], ST: [1, 0.88] }),
  PA13: Object.freeze({ CB: [0.63, 0], FB: [0.88, 0], DM: [1, 0.38], CM: [1, 0], W: [1, 0], ST: [1, 0] }),
});

/**
 * Whether generatePassDrill can make a drill for this position on any of `principles` (a role such as 'LB', or a family
 * such as 'FB'): true with none asked (any lesson), false with only v2 principles asked (PA7, PA14, PA15), else when
 * PASS_YIELD measured at least `min` of calls giving one in that direction ('auto' counts as 'any'). A cheap check for a
 * set builder: a call it says no to comes back null at once (fastFail), and one it says yes to may still fail for a seed.
 * @param {string} roleOrFamily
 * @param {string|string[]} principles
 * @param {{ direction?: 'any'|'forward'|'auto', min?: number }} [opts]
 */
export function canGeneratePass(roleOrFamily, principles = [], { direction = 'any', min = 0.01 } = {}) {
  const fam = ROLE_INFO[roleOrFamily]?.family ?? roleOrFamily;
  const all = typeof principles === 'string' ? [principles] : principles ?? [];
  const list = all.filter((p) => PASS_LESSONS[p]);
  if (!all.length) return true;
  const col = direction === 'forward' ? 1 : 0;
  return list.some((p) => (PASS_YIELD[p]?.[fam]?.[col] ?? 1) >= min);
}

/** Whether a forward best can teach any of the principles asked, for this role (none asked: yes). */
function forwardable(asked, role) {
  if (!asked.length) return true;
  return asked.some((p) => !NOT_FORWARD.has(p) && (p !== 'PA10' || ROLE_INFO[role]?.family === 'CB'));
}

/**
 * Whether a set of pass drills on these principles for this role should hold forward bests (3 of every 5): false only
 * when no principle asked can be taught by a forward pass for the role (PA13; PA10 except for a centre-back), as
 * generatePassSet decides. Only the principles a drill can teach count (PASS_LESSONS); none of them asked: true.
 */
export function passForwardable(principles = [], role) {
  return forwardable((principles ?? []).filter((p) => PASS_LESSONS[p]), role);
}

/**
 * A set of `count` pass drills in which forwardSlots of every forwardCycle (3 of 5) have a forward best, unless no
 * principle asked can be taught by a forward pass for this role (see generatePassDrill); no more than maxSameBest (2)
 * star a pass to the same position, and no two look alike (similarPassDrills: two pull-backs from the same corner, say).
 * Deterministic for the inputs.
 * @returns {object[]} up to `count` drills (fewer only if generation fails for some slots)
 */
export function generatePassSet({ seed = 1, count = 5, ...opts } = {}) {
  const D = { ...PASSDRILL_DEFAULTS, ...opts.params };
  const base = typeof seed === 'number' && Number.isFinite(seed) ? Math.floor(seed) : hashSeed(seed);
  const asked = (opts.principles ?? []).filter((p) => PASS_LESSONS[p]);
  const forward = forwardable(asked, opts.role);
  const out = [];
  const dry = new Set();
  for (let i = 0; i < count; i++) {
    const direction = forward && forwardSlot(i, D) ? 'forward' : 'any';
    // Receivers already starred maxSameBest times are avoided (the generator marks them out of the picture).
    const n = new Map();
    for (const x of out) { const r = receiverRole(x.rating?.best?.targetId); if (r) n.set(r, (n.get(r) ?? 0) + 1); }
    const avoid = [...n].filter(([, c]) => c >= D.maxSameBest).map(([r]) => r).sort();
    // A slot that fails (or looks like a drill already in the set) tries a later seed (a stride no other slot uses);
    // a forward slot that cannot vary its receiver takes any direction (a winger's forward pass is nearly always to the #9).
    const plan = direction === 'forward' ? ['forward', 'any'] : ['any'];
    let got = null;
    for (const dir of plan) {
      const key = `${dir}|${avoid.join(',')}`;
      if (dry.has(key)) continue; // came back empty for a whole slot, with fewer drills to be unlike: skip (fast)
      // A forward best to someone new is often not there at all (a winger's forward pass is to the #9): one seed, then any.
      const tries = dir === 'forward' && avoid.length ? 1 : D.setTries;
      for (let k = 0; k < tries && !got; k++) {
        const d = generatePassDrill({ ...opts, seed: base + i + k * 1009 * count, direction: dir, avoid, unlike: out });
        if (d && !out.some((x) => x.id === d.id)) got = d;
      }
      if (got) break;
      dry.add(key);
    }
    if (got) out.push(got);
  }
  return out;
}

/**
 * What a pass drill looks like to a player, for keeping a set varied: the position played, the ball at the freeze, the
 * best pass's receiver (a role) and its kind ('feet' | 'space'), and the drill's variant or template.
 * @returns {{ role: string, ball: {x:number,y:number}, best: string|null, kind: string|null, template: string|null } | null}
 */
export function passDrillPicture(drill) {
  const r = drill?.rating;
  if (!r?.ball || !drill?.learner?.role) return null;
  return { role: drill.learner.role, ball: { x: r.ball.x, y: r.ball.y }, best: receiverRole(r.best?.targetId), kind: r.best?.kind ?? null, template: drill.source?.template ?? null };
}

/**
 * Two pass drills a player would take for the same one (PASSDRILL_DEFAULTS): the same position with the ball within
 * nearBall at the freeze, or the same position and the same best receiver with the ball within nearSameBest (two
 * pull-backs to the #6 from the same corner).
 */
export function similarPassDrills(a, b, P = PASSDRILL_DEFAULTS) {
  const x = passDrillPicture(a), y = passDrillPicture(b);
  return !!x && !!y && samePicture(x, y, { ...PASSDRILL_DEFAULTS, ...P });
}

function samePicture(x, y, P) {
  if (x.role !== y.role) return false;
  const d = dist(x.ball, y.ball);
  return d <= P.nearBall || (!!x.best && x.best === y.best && d <= P.nearSameBest);
}

function pickTemplate(rng, role, asked, D) {
  const fam = ROLE_INFO[role].family;
  const opts = [];
  if (asked.includes('PA6') && ['CB', 'DM', 'CM'].includes(fam)) opts.push('switch');
  if (asked.includes('PA10') && fam === 'CB') opts.push('own-goal');
  if (!opts.length || !rng.chance(D.templateChance)) return null;
  return opts[rng.int(0, opts.length - 1)];
}

/**
 * The drill's primary principle: the first taught one among the best's reasons (strongest first), else the first
 * taught trap (a decoy that carries the lesson), else, with nothing asked, the principle of the best's main reason.
 */
function pickPrimary(rating, asked, taught) {
  const byReason = rating.best.tags.filter((t) => t.kind === 'strength').sort((a, b) => b.weight - a.weight).map((t) => t.principle);
  const pool = asked.length ? taught : [...new Set([...byReason.filter((p) => taught.includes(p)), ...taught])];
  return byReason.find((p) => pool.includes(p)) ?? pool[0] ?? byReason[0] ?? null;
}

// ---- scenes: where the learner receives, who passes, and the timeline that plays it

/**
 * A random scene: the learner receives in their own zone from a nearby teammate. A winger or #9 sometimes comes short
 * to get it (shortChance): the shape keeps them high and wide, so without this they only ever had the ball in their
 * end, with the #9 as their one forward pass.
 */
function naturalScene(rng, role, formations, D) {
  const me = playerId('us', role);
  const S = { x: rng.range(10, 95), y: rng.range(6, 62) };
  const B0 = clampIn(teamTargets(formations.us, 'us', S, { inPossession: true })[role], D.edge);
  const short = D.shortFamilies.includes(ROLE_INFO[role].family) && rng.chance(D.shortChance) ? rng.range(D.shortDist[0], D.shortDist[1]) : 0;
  return leadIn(rng, role, formations, D, { receive: B0, passerFrom: autoFrame({ formations, ball: B0, possession: 'us', carrierId: me, params: SCENE_PARAMS }), short });
}

/**
 * Switch of play (PA6), hand-shaped as the research suggests (plain scenes rarely star a switch): a centre-back,
 * #6 or #8 gets the ball off-centre, their whole block has slid over as if the ball were `crowdShift` m nearer that
 * touchline (their formation there), one of them presses from the goal side, others mark our ball-side options and
 * screen the safe passes inside or back, and the far side stays free.
 */
function switchScene(rng, role, formations, D) {
  if (!['CB', 'DM', 'CM'].includes(ROLE_INFO[role].family)) return 'no switch for this role';
  const side = ROLE_INFO[role].side === 'C' ? (rng.chance(0.5) ? 'L' : 'R') : ROLE_INFO[role].side;
  const S = { x: rng.range(15, 62), y: side === 'L' ? rng.range(4, 22) : rng.range(46, 64) };
  const B0 = clampIn(teamTargets(formations.us, 'us', S, { inPossession: true })[role], D.edge);
  const me = playerId('us', role);
  const scene = leadIn(rng, role, formations, D, { receive: B0, passerFrom: autoFrame({ formations, ball: B0, possession: 'us', carrierId: me, params: SCENE_PARAMS }) });
  if (typeof scene === 'string') return scene;
  const B = scene.receive;
  const off = B.y - MID_Y;
  if (Math.abs(off) < D.switchFrom[0] || Math.abs(off) > D.switchFrom[1]) return 'too central or too wide to switch';
  const dir = Math.sign(off);
  const crowded = { x: B.x, y: clamp(B.y + dir * D.crowdShift, 1, 67) };
  const want = teamTargets(formations.them ?? formations.us, 'them', crowded, { inPossession: false });
  const them = scene.frame.players.filter((p) => p.team === 'them' && p.role !== 'GK');
  const spots = Object.fromEntries(them.map((p) => [p.id, want[p.role]]));
  const used = new Set();
  const take = (id, spot) => { used.add(id); spots[id] = spot; };
  const nearest = (pt, first) => (first && !used.has(first) ? first : them.filter((p) => !used.has(p.id)).sort((a, b) => dist(spots[a.id], pt) - dist(spots[b.id], pt))[0]?.id);
  // One presses from the goal side; the nearest others mark our ball-side options; their #9 (then whoever is
  // nearest) screens the safe passes inside or back. The far side is left free.
  take(nearest(B), { x: B.x + D.pressGap, y: B.y });
  const ours = scene.frame.players.filter((p) => p.team === 'us' && p.id !== me && p.role !== 'GK');
  const ballSide = ours.filter((p) => (p.y - MID_Y) * dir > 4).sort((a, b) => dist(a, B) - dist(b, B)).slice(0, D.crowd);
  for (const mate of ballSide) {
    const id = nearest(mate);
    if (id) take(id, { x: mate.x + D.crowdGap, y: mate.y - dir * 0.5 });
  }
  const inside = ours.filter((p) => !ballSide.includes(p) && Math.abs(p.y - MID_Y) < D.screenBand && p.x < B.x + 5 && dist(p, B) < 25)
    .sort((a, b) => dist(a, B) - dist(b, B)).slice(0, 2);
  for (const mate of inside) {
    const lane = { x: B.x + (mate.x - B.x) * D.screenAt, y: B.y + (mate.y - B.y) * D.screenAt };
    const id = nearest(lane, 'them-ST');
    if (id) take(id, lane);
  }
  const overrides = them.map((p) => {
    const start = scene.start.find((q) => q.id === p.id);
    return { id: p.id, keys: [{ t: 0, ...round(start, D) }, { t: scene.tArrive, ...round(clampToPitch(spots[p.id]), D) }] };
  });
  return rebuild(scene, overrides, formations);
}

/**
 * Across our own goal (PA10): a centre-back on the ball near the corner of our box, their #9 lurking in front of
 * goal, so the square pass to the other centre-back is the trap.
 */
function ownGoalScene(rng, role, formations, D) {
  const side = ROLE_INFO[role].side;
  const B0 = { x: rng.range(11, 19), y: side === 'L' ? rng.range(11, 19) : rng.range(49, 57) };
  const me = playerId('us', role);
  const scene = leadIn(rng, role, formations, D, { receive: B0, passerFrom: autoFrame({ formations, ball: B0, possession: 'us', carrierId: me, params: SCENE_PARAMS }) });
  if (typeof scene === 'string') return scene;
  const B = scene.receive;
  if (B.x > 24 || Math.abs(B.y - MID_Y) < 10) return 'not at the corner of our box';
  const st = scene.start.find((p) => p.id === 'them-ST');
  const lurk = { x: B.x + rng.range(3, 8), y: MID_Y + rng.range(-5, 5) };
  return rebuild(scene, [{ id: 'them-ST', keys: [{ t: 0, ...round(st, D) }, { t: scene.tArrive, ...round(lurk, D) }] }], formations);
}

/**
 * Who's open, varied (natural scenes only), so the best pass is not always the same teammate for a position:
 * 'marked': the opponent nearest the plain scene's best receiver (within markFrom; never their keeper or the player on
 *   our ball) comes to stand markGap from him, goal-side and a little ball-side, so that pass is no longer on;
 * 'free': a teammate ahead of the ball (or level with it, unless `forward`), within freeReach and not in `shun` (roles
 *   the caller avoids as the best's receiver), is left free: their players within freeRadius of him step away to
 *   freeGap (the nearest such spot to where each started).
 * The movers walk there during the lead-in (override keys at 0 and at the reception), as the switch template's block
 * does, at most maxMoveSpeed. Returns the rebuilt scene, or a string saying why there is none.
 */
function varyScene(rng, role, formations, D, scene, rating, kind, forward = false, shun = new Set()) {
  const me = playerId('us', role);
  const f = scene.frame, ball = f.ball;
  const them = f.players.filter((p) => p.team === 'them' && p.role !== 'GK');
  const onBall = them.reduce((a, p) => (!a || dist(p, ball) < dist(a, ball) ? p : a), null);
  const movable = them.filter((p) => p !== onBall);
  const moves = [];
  let target = null;
  if (kind === 'marked') {
    const R = f.players.find((p) => p.id === rating.best.targetId);
    if (!R || R.role === 'GK') return 'nobody to mark';
    const m = movable.filter((p) => dist(p, R) <= D.markFrom).sort((a, b) => dist(a, R) - dist(b, R) || (a.id < b.id ? -1 : 1))[0];
    if (!m) return 'nobody near enough to mark';
    const g = norm({ x: LENGTH - R.x, y: MID_Y - R.y }), b = norm({ x: ball.x - R.x, y: ball.y - R.y });
    const u = norm({ x: g.x + 0.5 * b.x, y: g.y + 0.5 * b.y });
    moves.push([m.id, { x: R.x + u.x * D.markGap, y: R.y + u.y * D.markGap }]);
    target = R.id;
  } else {
    // A teammate ahead of the ball (level with it too, unless a forward pass is wanted).
    const front = forward ? PASS_DEFAULTS.squareBand : -PASS_DEFAULTS.squareBand;
    const ahead = f.players.filter((p) => p.team === 'us' && p.id !== me && p.role !== 'GK' && !shun.has(p.role) && p.x > ball.x + front && dist(p, ball) <= D.freeReach);
    if (!ahead.length) return 'nobody ahead to leave free';
    const F = ahead[rng.int(0, ahead.length - 1)];
    target = F.id;
    const near = movable.filter((p) => dist(p, F) < D.freeRadius);
    if (!near.length) return 'already free';
    // Each steps to the spot freeGap from him nearest where he started (the shortest walk): every 45 degrees round him,
    // on the pitch, out of the pass to him, and apart from the others who step away.
    const taken = [];
    for (const o of near) {
      const start = scene.start.find((q) => q.id === o.id);
      let best = null;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const spot = { x: F.x + Math.cos(a) * D.freeGap, y: F.y + Math.sin(a) * D.freeGap };
        if (spot.x < 1 || spot.x > LENGTH - 1 || spot.y < 1 || spot.y > WIDTH - 1) continue;
        if (segmentDistance(spot, ball, F) < D.freeLane || taken.some((q) => dist(q, spot) < D.freeGap / 2)) continue;
        if (!best || dist(spot, start) < dist(best, start)) best = spot;
      }
      if (!best) return 'nowhere to step away to';
      taken.push(best);
      moves.push([o.id, best]);
    }
  }
  const overrides = [];
  for (const [id, to] of moves) {
    const start = scene.start.find((q) => q.id === id);
    const spot = clampToPitch(to, 1);
    if (dist(start, spot) / Math.max(scene.tArrive, 1e-9) > D.maxMoveSpeed) return 'too far to walk';
    overrides.push({ id, keys: [{ t: 0, ...round(start, D) }, { t: scene.tArrive, ...round(spot, D) }] });
  }
  return { ...rebuild(scene, overrides, formations), variantOf: target };
}

/** Distance from p to the segment a-b. */
function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const u = l2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
}

const clampIn = (p, edge) => clampToPitch(p, edge);
const round = (p, D) => ({ x: Math.round(p.x * D.pRound) / D.pRound, y: Math.round(p.y * D.pRound) / D.pRound });
const rt = (t, D) => Math.round(t * D.tRound) / D.tRound;

/**
 * The lead-in: a teammate near `receive` has the ball (maybe running with it), passes, and the learner receives
 * where they stand when it arrives (their in-flight spot, refined twice as sequence.js does); the freeze follows.
 * @returns {{ timeline, params, frame, start, passerId, tArrive, receive, draft }|string}  a string says why there is no scene
 */
function leadIn(rng, role, formations, D, { receive, passerFrom, short = 0 }) {
  const me = playerId('us', role);
  const fam = ROLE_INFO[role].family;
  const cands = passerFrom.players.filter((p) => p.team === 'us' && p.id !== me && (p.role !== 'GK' || (receive.x < 30 && (fam === 'CB' || fam === 'FB'))));
  const weights = cands.map((p) => {
    // The learner receives where their own shape puts them with the ball at the passer (a #6 drops next to a
    // centre-back on the ball, for one), so the pass is measured from there.
    const d = dist(p, teamTargets(formations.us, 'us', clampIn(p, D.edge), { inPossession: true })[role]);
    if (d < D.passLength[0] || d > D.passLength[1]) return 0;
    const behind = clamp((receive.x - p.x) / 15, -0.5, 1); // the ball usually comes forward to the learner
    return Math.exp(-(((d - 15) / 7) ** 2)) * (1 + 0.6 * behind);
  });
  const i = rng.weighted(weights);
  if (i < 0) return 'no passer in range';
  const passer = cands[i];
  const A = clampIn({ x: passer.x + rng.range(-D.jitter, D.jitter), y: passer.y + rng.range(-D.jitter, D.jitter) }, D.edge);
  const hold = rng.range(D.holdTime[0], D.holdTime[1]);
  const carry = rng.chance(D.carryChance);
  let A0 = A;
  if (carry) {
    const dir = norm({ x: 0.5 + 0.5 * norm({ x: receive.x - A.x, y: receive.y - A.y }).x, y: 0.5 * norm({ x: receive.x - A.x, y: receive.y - A.y }).y });
    const len = rng.range(D.carrySpeed[0], D.carrySpeed[1]) * hold;
    A0 = clampIn({ x: A.x - dir.x * len, y: A.y - dir.y * len }, D.edge);
  }
  const params = { ...(rng.chance(D.noPressChance) ? { autoPress: false } : {}), ...SCENE_PARAMS };
  const tPass = rt(hold, D);
  const passSpeed = (d) => D.passSpeed[0] + (D.passSpeed[1] - D.passSpeed[0]) * clamp((d - 6) / 24, 0, 1);
  const make = (B, tArrive, freezeAt, overrides = []) => ({
    kind: 'pass', moment: 'in_possession', learner: { role }, params,
    timeline: {
      duration: freezeAt ?? tArrive, freezeAt: freezeAt ?? tArrive,
      ball: [{ t: 0, ...round(A0, D), ...(carry ? { event: 'carry' } : {}) }, { t: tPass, ...round(A, D), event: 'pass' }, ...(B ? [{ t: tArrive, ...round(B, D) }] : [])],
      possession: [{ t: 0, team: 'us' }],
      carrier: [{ t: 0, id: passer.id }, { t: tPass, id: null }, ...(B ? [{ t: tArrive, id: me }] : [])],
      players: { auto: true, overrides },
      tags: [],
    },
  });
  // Where the learner is when the pass is struck, then where they are when it arrives.
  const free = (s, t) => frameAt(s, t, { formations, learnerId: null }).players.find((p) => p.id === me);
  let B = clampIn(free(make(null, tPass), tPass), D.edge);
  let tArrive = tPass;
  for (let k = 0; k < 2; k++) {
    tArrive = rt(tPass + dist(A, B) / passSpeed(dist(A, B)), D);
    B = clampIn(free(make(B, tArrive), tArrive - 1e-3), D.edge);
  }
  let overrides = [];
  if (short > 0) {
    // Coming short: `short` metres from that spot toward the passer and our goal, run to while the ball travels (the
    // learner's override ends where the pass arrives, so they are on the ball there at the freeze).
    const u = norm({ x: norm({ x: A.x - B.x, y: A.y - B.y }).x - 1, y: norm({ x: A.x - B.x, y: A.y - B.y }).y });
    B = clampIn({ x: B.x + u.x * short, y: B.y + u.y * short }, D.edge);
    tArrive = rt(tPass + dist(A, B) / passSpeed(dist(A, B)), D);
    const from = frameAt(make(null, tPass), 0, { formations, learnerId: null }).players.find((p) => p.id === me);
    if (dist(from, B) / tArrive > D.maxMoveSpeed) return 'too far to come short';
    overrides = [{ id: me, keys: [{ t: 0, ...round(from, D) }, { t: tArrive, ...round(B, D) }] }];
  }
  const d = dist(A, B);
  if (d < D.passLength[0] - 2 || d > D.passLength[1] + 4) return `pass length ${d.toFixed(0)} m`;
  tArrive = rt(tPass + d / passSpeed(d), D);
  if (overrides.length) overrides[0].keys[1].t = tArrive;
  const freezeAt = rt(tArrive + rng.range(D.freezeAfter[0], D.freezeAfter[1]), D);
  const draft = make(B, tArrive, freezeAt, overrides);
  const frame = frameAt(draft, freezeAt, { formations, learnerId: null });
  if (frame.carrierId !== me) return 'learner not on the ball';
  // Where everyone starts (t = 0): only the templates and varyScene need it, so it is worked out when first asked for.
  let start = null;
  return {
    timeline: draft.timeline, params, frame, passerId: passer.id, tArrive, receive: round(B, D), draft, short,
    get start() { return (start ??= frameAt(draft, 0, { formations, learnerId: null }).players); },
  };
}

/** The scene again with player overrides added (templates, varyScene): the freeze frame recomputed. */
function rebuild(scene, overrides, formations) {
  const timeline = { ...scene.timeline, players: { auto: true, overrides: [...(scene.timeline.players?.overrides ?? []), ...overrides] } };
  const draft = { ...scene.draft, timeline };
  const frame = frameAt(draft, timeline.freezeAt, { formations, learnerId: null });
  return { ...scene, timeline, draft, frame };
}

/** Principle texts: the catalogue's (any form validateScenario accepts), else the fallback table. */
function lessonText(id, catalogue) {
  const list = Array.isArray(catalogue) ? catalogue : catalogue?.list ?? catalogue?.principles ?? (catalogue?.byId ? Object.values(catalogue.byId) : null);
  const p = list?.find?.((q) => q?.id === id) ?? catalogue?.byId?.[id] ?? null;
  const f = LESSON_TEXT[id];
  return {
    name: p?.name ?? f?.[0] ?? id,
    kidName: p?.kidName ?? f?.[1] ?? 'Who Is Open',
    standard: p?.summary?.standard ?? f?.[2] ?? '',
    kid: p?.summary?.kid ?? f?.[3] ?? '',
  };
}

function writeDrill({ seed, role, rating, built, primary, taught, asked, want, direction, attempt, template, avoid = [], catalogue, D }) {
  const me = playerId('us', role);
  const principles = [primary, ...taught.filter((p) => p !== primary)];
  const text = lessonText(primary, catalogue);
  const b = rating.best;
  const ballX = rating.ball.x;
  const others = rating.options.filter((o) => o.id !== b.id);
  const margin = b.score - (others[0]?.score ?? 0);
  const difficulty = Math.round(100 * (clamp((20 - margin) / 20, -1, 1) * 0.5 + (b.kind === 'space' ? 0.5 : 0) + (b.colour === 'amber' ? 0.5 : 0))) / 100; // [D]
  return {
    id: `pass-${role.toLowerCase()}-${slug(seed)}${asked.length ? `-${asked.join('-').toLowerCase()}` : ''}${direction === 'auto' ? '' : `-${direction}`}${avoid.length ? `-x-${avoid.join('-').toLowerCase()}` : ''}${attempt ? `-a${attempt}` : ''}`,
    kind: 'pass',
    title: text.name,
    titleKid: text.kidName,
    brief: PASS_WORDS.brief,
    briefKid: PASS_WORDS.briefKid,
    question: PASS_WORDS.question,
    questionKid: PASS_WORDS.questionKid,
    takeaway: { standard: text.standard, kid: text.kid },
    module: 'pass',
    moment: 'in_possession',
    phase: ballX < 35 ? 'build_up' : ballX < 70 ? 'progression' : 'final_third',
    principles,
    learner: { role },
    carrierId: me,
    carrier: me,
    timeline: built.timeline,
    answer: { mode: 'pass', best: b.id, accept: [], space: b.kind === 'space' },
    rating,
    misconceptions: [],
    difficulty,
    params: built.params,
    source: {
      kind: 'generated', generator: 'fotbol passdrill v1', seed: String(seed), role, principles: [...asked], direction: want, attempt,
      template: template ?? null, ...(built.variantOf ? { variantOf: built.variantOf } : {}), ...(built.short ? { short: Math.round(built.short * 10) / 10 } : {}),
      ...(avoid.length ? { avoid: [...avoid] } : {}),
      license: 'MIT', author: 'fotbol',
    },
  };
}
