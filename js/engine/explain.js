// Feedback: turn an evaluation into a headline, ranked reasons, praise, a fix phrased
// in football terms, and a beat-1 cue.
// Contract: docs/ARCHITECTURE.md §5.6. Rationale: docs/RESEARCH.md §5.6.
//
// Directions are always relative to our goal and the middle of the pitch, never the
// screen: "deeper" = toward our goal (smaller x), "inside" = toward y = 34.

import { dist } from './geometry.js';
import { MID_Y } from './pitch.js';
import { ROLE_INFO } from './roles.js';
import { SCORE_WEIGHTS } from './score.js';
import { RULES_BY_ID } from './rules/index.js';

export const EXPLAIN_DEFAULTS = Object.freeze({
  failBelow: 0.9, // [D] a rule scoring below this is a reason to move
  praiseAt: 0.9, // [D] a rule scoring at least this can be praised
  maxPraise: 2, // [D]
  maxReasons: Object.freeze({ standard: 2, kid: 1 }), // [D] RESEARCH 5.6
  minMove: 1, // [D] metres; smaller moves are not worth phrasing
  centreBand: 1, // [D] within this of y = 34 you are "central", so sideways moves name a touchline
  zoneFailBelow: 0.6, // [D] a zone score below this (about 2x the tolerance from the base) is itself a reason to move
  tradeoffMargin: 0.1, // [D] a rule the best spot also fails is a trade-off, not a reason, unless you score this much lower on it
  bestEps: 0.5, // [D] points: a spot scoring within this of the best spot (or more) gets no reasons (nothing left to fix)
  zoneGap: 5, // [D] points: with no other reason left, a zone costing at least this much is the reason (F2)
});

/**
 * The zone term as a reason (F2: shift with the ball as a unit). A spot can break no rule and still
 * be far from where the role belongs; the feedback must then say so rather than stay silent.
 * ruleId 'zone' is not in the rule registry.
 */
export const ZONE_REASON = Object.freeze({
  id: 'zone',
  principles: Object.freeze(['F2']),
  text: Object.freeze({
    standard: Object.freeze({
      name: 'Keep your place in the shape',
      fail: (v) => `You are about ${v.dist} m from where ${v.role} stands with the ball here, so slide back into the team's shape.`,
      cue: () => 'Where does your position usually stand when the ball is here?',
    }),
    kid: Object.freeze({
      name: 'Find your spot',
      fail: () => "Slide back into your spot in the team's shape.",
      cue: () => 'Where is your spot when the ball is here?',
    }),
  }),
});

/** Headline per grade and wording (standard strings are from docs/ARCHITECTURE.md §5.6). */
export const HEADLINES = Object.freeze({
  standard: Object.freeze({ S: 'Spot on.', A: 'Great position.', B: 'Good — small adjustment.', C: 'Close, but…', D: 'Not quite.', F: 'Out of position.' }),
  kid: Object.freeze({ S: 'Perfect spot!', A: 'Great spot!', B: 'Good, just a small move.', C: 'Close! Nearly there.', D: 'Not quite yet.', F: "Let's find a better spot." }),
});

const sentence = (s) => (s ? s[0].toUpperCase() + s.slice(1) + (/[.!?…]$/.test(s) ? '' : '.') : '');

/** Call a rule text function; a missing or broken template must not break feedback. */
function say(rule, wording, key, vars) {
  const t = rule?.text?.[wording] ?? rule?.text?.standard;
  try {
    const out = t?.[key]?.(vars ?? {});
    return typeof out === 'string' ? out : '';
  } catch {
    return '';
  }
}

function principleOf(rule, result, principles, wording) {
  // A rule that checks several principles may say which one this result is about (vars.principle).
  const own = result.principles ?? rule?.principles ?? [];
  const id = (own.includes(result.vars?.principle) ? result.vars.principle : own[0]) ?? null;
  const p = id && principles ? principles[id] : null;
  const name = p?.name ?? p?.title ?? rule?.text?.[wording]?.name ?? rule?.text?.standard?.name ?? result.id;
  return { id, name };
}

/**
 * Turn an evaluation into feedback.
 * @param {object} evalResult  from evaluate()
 * @param {object} ctx         from buildContext()
 * @param {{x:number,y:number}} spot  the judged spot
 * @param {{ wording?: 'standard'|'kid', max?: number, principles?: object,
 *           ghost?: {x:number,y:number}|{spot:{x:number,y:number}, result?: object}, rules?: object[] }} [opts]
 *   principles: a byId map (or {byId}) from data/principles.json; ghost: the fix target
 *   (defaults to the zone centre), optionally with `result`, evaluate() at it in the same zone (a
 *   computeGhost() result has both); rules: the rule set used to evaluate (defaults to the registry).
 *   Failing rules come first (criticals, then by weight x (1 - s)); a zone score below zoneFailBelow
 *   then adds the zone itself as a reason (ruleId 'zone', principle F2), so a spot far from the
 *   role's place in the shape is never explained by silence.
 *   With the best spot's result, what the best spot itself gives up is a trade-off, not a mistake:
 *   a rule (or the zone) the best spot also fails is not a reason unless you fail it by more than
 *   tradeoffMargin, and a spot scoring within bestEps of the best spot (or more) gets no reasons and
 *   no cue at all (only a broken critical rule is always a reason). So following a reason never
 *   leads away from the best spot. When no reason is left and the zone still costs zoneGap points or
 *   more, the zone is the reason.
 * @returns {{ grade:string, score:number, headline:string,
 *             reasons: { ruleId:string, principleId:string|null, name:string, text:string, severity:number, critical:boolean }[],
 *             praise: string[], fix: { text:string, dx:number, dy:number }|null,
 *             cue: { text:string, ruleId:string, highlight:object|null }|null }}
 */
export function explain(evalResult, ctx, spot, opts = {}) {
  const P = EXPLAIN_DEFAULTS;
  const wording = opts.wording === 'kid' ? 'kid' : 'standard';
  const max = opts.max ?? P.maxReasons[wording];
  const principles = opts.principles?.byId ?? opts.principles ?? null;
  const byId = opts.rules ? Object.fromEntries(opts.rules.map((r) => [r.id, r])) : RULES_BY_ID;
  const results = evalResult.rules ?? [];

  // The best spot's own evaluation (the ghost's), when given: what it fails too is a trade-off.
  const best = opts.ghost?.result ?? null;
  const bestRule = new Map((best?.rules ?? []).map((r) => [r.id, r]));
  const atBest = !!best && Number.isFinite(best.raw) && Number.isFinite(evalResult.raw) && evalResult.raw >= best.raw - P.bestEps;
  const tradeoff = (r) => {
    if (r.critical || !best) return false;
    if (atBest) return true;
    const b = r.zone ? { s: best.sZone, fails: best.sZone < P.zoneFailBelow } : bestRule.get(r.id);
    const fails = r.zone ? b.fails : !!b && !b.critical && b.s < P.failBelow;
    return fails && Number.isFinite(b.s) && r.s >= b.s - P.tradeoffMargin;
  };

  // Failing rules first (criticals, then by w (1 - s): RESEARCH 5.6); the zone after them, since a
  // named principle says more than "you are out of your spot".
  const failing = results
    .filter((r) => (r.critical || r.s < P.failBelow) && !tradeoff(r))
    .sort((a, b) => (b.critical - a.critical) || (b.weight * (1 - b.s) - a.weight * (1 - a.s)));
  const sZone = evalResult.sZone;
  const role = ROLE_INFO[ctx?.learner?.role]?.label?.toLowerCase();
  const zoneReason = {
    id: ZONE_REASON.id, principles: ZONE_REASON.principles, weight: SCORE_WEIGHTS.zone, s: sZone, critical: false, zone: true,
    vars: { dist: Math.round(evalResult.distance ?? 0), role: role ? `a ${role}` : 'your position' },
  };
  if (Number.isFinite(sZone)) {
    // The zone is a reason when it is far off, or when it is all that is left to explain a score it
    // clearly costs (every rule passed, or failed only as much as the best spot does).
    const far = sZone < P.zoneFailBelow;
    const costly = !failing.length && 100 * SCORE_WEIGHTS.zone * (1 - sZone) >= P.zoneGap;
    if ((far || costly) && !tradeoff(zoneReason)) failing.push(zoneReason);
  }

  const reasons = [];
  for (const r of failing) {
    if (reasons.length >= max) break;
    const rule = r.zone ? ZONE_REASON : byId[r.id];
    const pr = principleOf(rule, r, principles, wording);
    const text = sentence(say(rule, wording, 'fail', r.vars)) || sentence(`${pr.name}: not quite there yet`);
    const severity = r.critical ? 1 : Math.round((1 - r.s) * 1000) / 1000;
    reasons.push({ ruleId: r.id, principleId: pr.id, name: pr.name, text, severity, critical: r.critical });
  }

  const praise = results
    .filter((r) => !r.critical && r.s >= P.praiseAt)
    .sort((a, b) => b.weight - a.weight || b.s - a.s)
    .map((r) => sentence(say(byId[r.id], wording, 'ok', r.vars)))
    .filter(Boolean)
    .slice(0, P.maxPraise);

  const g = opts.ghost?.spot ?? opts.ghost ?? evalResult.center;
  let fix = null;
  if (g && dist(spot, g) >= P.minMove) {
    const text = phraseMove(spot, g, { wording });
    if (text) fix = { text: sentence(text), dx: g.x - spot.x, dy: g.y - spot.y };
  }

  let cue = null;
  if (failing.length) {
    const top = failing[0];
    const rule = top.zone ? ZONE_REASON : byId[top.id];
    const text = sentence(say(rule, wording, 'cue', top.vars));
    // The zone cue points at the ball: where it is decides where your spot is (F2).
    const highlight = top.zone ? (ctx?.ball ? { type: 'point', x: ctx.ball.x, y: ctx.ball.y } : null)
      : rule?.cue ? rule.cue(ctx, spot) ?? null : null;
    if (text || highlight) cue = { text, ruleId: top.id, highlight };
  }

  return {
    grade: evalResult.grade,
    score: evalResult.score,
    headline: HEADLINES[wording][evalResult.grade] ?? '',
    reasons,
    praise,
    fix,
    cue,
  };
}

/**
 * Phrase a move in football terms: "drop 4 m deeper and come 3 m inside",
 * "push up 3 m and move 5 m wider". Deeper = toward our goal; inside = toward the
 * middle (y = 34). A sideways move that crosses the middle names the touchline it
 * heads for. Returns '' for moves under a metre.
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {{ wording?: 'standard'|'kid' }} [opts]
 * @returns {string}
 */
export function phraseMove(from, to, { wording = 'standard' } = {}) {
  const P = EXPLAIN_DEFAULTS;
  if (dist(from, to) < P.minMove) return '';
  const kid = wording === 'kid';
  const dx = to.x - from.x, dy = to.y - from.y;
  const fx = Math.round(Math.abs(dx)), fy = Math.round(Math.abs(dy));

  let along = '';
  if (fx >= 1) along = dx > 0 ? (kid ? `${fx} m forward` : `push up ${fx} m`) : (kid ? `${fx} m back toward your goal` : `drop ${fx} m deeper`);

  let across = '';
  if (fy >= 1) {
    const a = from.y - MID_Y, b = to.y - MID_Y;
    // Inside/wider only makes sense from one side of the middle: ending up central counts as "inside".
    const oneSide = Math.abs(a) >= P.centreBand && (Math.sign(a) === Math.sign(b) || Math.abs(b) < P.centreBand);
    if (oneSide) {
      const inside = Math.abs(b) < Math.abs(a);
      across = inside ? (kid ? `${fy} m toward the middle` : `come ${fy} m inside`) : (kid ? `${fy} m toward the sideline` : `move ${fy} m wider`);
    } else {
      const side = dy > 0 ? 'right' : 'left'; // y grows toward our right touchline
      across = kid ? `${fy} m across toward the ${side} sideline` : `shift ${fy} m across toward the ${side} touchline`;
    }
  }

  if (kid) return along || across ? `move ${[along, across].filter(Boolean).join(' and ')}` : '';
  return [along, across].filter(Boolean).join(' and ');
}
