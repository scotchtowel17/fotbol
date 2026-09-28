// Generated "Find your spot" drills: a short ball-scripted event (a pass or a carry) that changes where the
// learner should be, frozen just after the ball arrives, in the authored scenario format (source.kind
// 'generated', answer mode 'engine'), kept only when it passes the drill-quality gates. They top up the
// Player-mode sets where authored drills run out (KID_REDESIGN §3, §6.2).
// Contract: docs/ARCHITECTURE.md §5.15. The gates are npm run check's (scripts/check-scenarios.mjs, §5.3), plus a
// rule of a principle asked for weighted at least minRuleWeight and met at the answer.
// PURE and deterministic: a seeded PRNG (sequence.js createRng), no Math.random, no clock.

import { clamp, dist } from './geometry.js';
import { LENGTH, clampToPitch } from './pitch.js';
import { LEARNABLE_ROLES, ROLE_INFO, playerId, parsePlayerId } from './roles.js';
import { teamTargets } from './formation.js';
import { autoFrame } from './scene.js';
import { frameAt, learnerBaseAt } from './timeline.js';
import { validateScenario, normalizeScenario, learnerId as learnerIdOf } from './scenario.js';
import { buildContext } from './context.js';
import { computeGhost } from './ghost.js';
import { evaluate, toleranceFor } from './score.js';
import { RULES } from './rules/index.js';
import { createRng } from './sequence.js';

export const SPOT_DEFAULTS = Object.freeze({
  maxAttempts: 30, // [D] seeds tried (the seed asked for, then the next ones) before generateSpotDrill gives up (null)
  minGhostScore: 90, // [S] = CHECK_DEFAULTS.minGhostScore (RESEARCH 9.5: the best spot scores S; tested equal)
  minMove: 5, // [D] = CHECK_DEFAULTS.minMove: the answer at least this far from the start spot
  maxStartScore: 70, // [D] = CHECK_DEFAULTS.maxStartScore: standing still scores below this
  minRuleWeight: 2, // [D] KID_REDESIGN §6.2: a rule of a principle asked for weighs at least this...
  minRuleScore: 0.9, // [D] ...and scores at least this at the answer (tests/scenarios-content.test.js RULE_OK)
  freezeAfter: Object.freeze([0.4, 1.0]), // [D] s after the ball arrives (§6.2)
  holdTime: Object.freeze([1.0, 1.5]), // [D] s the carrier has the ball before the event (the learner sees the set-up; the watch lasts about 3 s)
  passLength: Object.freeze([10, 35]), // [D] m
  passSpeed: Object.freeze([12, 20]), // [D] m/s = SEQUENCE_DEFAULTS.passSpeed (realistic; longer passes struck harder)
  carryChance: 0.3, // [D] share of events that are a carry rather than a pass
  carrySpeed: Object.freeze([4, 7]), // [D] m/s = SEQUENCE_DEFAULTS.carrySpeed
  carryTime: Object.freeze([1.2, 2.4]), // [D] s
  afterDelay: 0.4, // [D] s after the freeze before play goes on (more than timeline adjustWindow / 2 + adjustStep = 0.35 s,
  //                  so what comes after never changes the frozen picture)
  afterTime: 1.5, // [D] s of play after that ("See what happens"): the player on the ball runs on with it
  afterSpeed: Object.freeze([3, 5]), // [D] m/s
  lead: 4, // [D] m: a pass is aimed at most this far from the event's end spot (where the receiver will be)
  stillRadius: 2, // [D] m: the "stood still" misconception around the start spot
  edge: 3, // [D] m: the ball stays this far inside the lines
  tRound: 1e3, // times rounded to 1 ms...
  pRound: 1e2, // ...and positions to 1 cm, so drills are compact and exactly reproducible
});

/** Rules that judge a defending (out of possession) or an attacking learner; spacing (F8) does both but weighs 1. */
const DEFENDING_RULES = new Set(['press', 'cover', 'tuck', 'compact', 'screen', 'goal-side', 'level-line', 'keeps-onside']);
const ATTACKING_RULES = new Set(['width', 'pin', 'lane-open', 'support-distance', 'occupancy', 'between-lines', 'box-fill', 'offside']);

/**
 * Where the event should leave the ball, relative to the learner's zone, for each principle's rule to apply: near
 * the learner (press), near a teammate beside them (cover), in the far wing lane (tuck), close enough to support,
 * wide in the final third (crosses), or anywhere.
 */
const FOCUS = Object.freeze({ D1: 'near', D2: 'near', D3: 'cover', D4: 'far', U5: 'far', B3: 'support', B4: 'support', P10: 'cross' });

/** Principles that have a rule (from the rule registry), and the moments that rule judges. */
export function spotPrinciples() {
  const out = {};
  for (const r of RULES) {
    for (const p of r.principles) {
      const e = (out[p] ??= { rules: [], moments: new Set() });
      e.rules.push(r.id);
      if (!ATTACKING_RULES.has(r.id)) e.moments.add('them'); // a rule in neither list (spacing) judges both moments
      if (!DEFENDING_RULES.has(r.id)) e.moments.add('us');
    }
  }
  return Object.fromEntries(Object.entries(out).map(([p, e]) => [p, { rules: e.rules, moments: [...e.moments] }]));
}
const SPOT = spotPrinciples();

// ---------------------------------------------------------------- names and words (never a side: drills are mirrored)

const KID_POSITION = Object.freeze({ GK: 'keeper', CB: 'defender', FB: 'defender', DM: 'midfielder', CM: 'midfielder', W: 'winger', ST: 'striker' });
const STD_POSITION = Object.freeze({ GK: 'keeper', CB: 'centre-back', FB: 'full-back', DM: '#6', CM: '#8', W: 'winger', ST: '#9' });
const nameIn = (table, id) => {
  const { team, role } = parsePlayerId(id);
  return `${team === 'us' ? 'your' : 'their'} ${table[ROLE_INFO[role]?.family] ?? 'player'}`;
};
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** The learner-facing words of a generated drill, by who has the ball and what happened. */
export const SPOT_WORDS = Object.freeze({
  brief: Object.freeze({
    'them-pass': 'They pass the ball. Watch how your job changes.',
    'them-carry': 'They run with the ball. Watch how your job changes.',
    'us-pass': 'We pass the ball. Watch how your job changes.',
    'us-carry': 'Your teammate runs with the ball. Watch how your job changes.',
  }),
  briefKid: Object.freeze({
    'them-pass': 'They pass the ball. Watch where it goes.',
    'them-carry': 'They run with the ball. Watch closely.',
    'us-pass': 'We pass the ball. Watch where it goes.',
    'us-carry': 'Your teammate runs with the ball. Watch closely.',
  }),
  question: (holder) => `${cap(nameIn(STD_POSITION, holder))} has the ball. Where should you be now?`,
  questionKid: (holder) => `${cap(nameIn(KID_POSITION, holder))} has the ball. Where do you go?`,
  stillText: 'You stayed where you started, but the ball moved, so your spot moved too.',
  stillTextKid: 'The ball moved, so you need to move too.',
});

// ---------------------------------------------------------------- checking

/**
 * Judge a spot drill as npm run check does (ARCHITECTURE §5.3 "Judging a drill"): the free frame at the freeze,
 * the learner's base, the ghost round it, and standing still at the start; plus the rules of the principles asked
 * for (or the scenario's) at the answer.
 * @param {object} scenario
 * @param {{ formations, principles?: object, want?: string[], params?: object }} opts
 *   principles: the catalogue for validation; want: principle ids whose rules count (default: scenario.principles)
 * @returns {{ errors: string[] } | { errors: [], t, frame, base, ctx, ghost, start, moved, startScore, taught: {principle, rule, weight, s, sStart}[], problems: string[] }}
 *   taught: the rules of `want` weighted at least minRuleWeight and met (s >= minRuleScore) at the answer, most improved first
 */
export function checkSpotDrill(scenario, { formations, principles, want, params } = {}) {
  const S = { ...SPOT_DEFAULTS, ...params };
  const errors = validateScenario(scenario, { principles });
  if (errors.length) return { errors };
  const s = normalizeScenario(scenario);
  const t = s.timeline.freezeAt;
  const me = learnerIdOf(s);
  const frame = frameAt(s, t, { formations });
  const base = learnerBaseAt(s, t, { formations });
  const ctx = buildContext(frame, { learnerId: me, base });
  const tol = toleranceFor(s.learner.role, s.answer.tol);
  const ghost = computeGhost(ctx, { base, tol });
  const start = s.learner.start ?? (() => { const p = frameAt(s, 0, { formations }).players.find((q) => q.id === me); return { x: p.x, y: p.y }; })();
  const atStart = evaluate(ctx, start, { center: base, tol });
  const moved = dist(ghost.spot, start);
  const wanted = new Set(want ?? s.principles);
  const taught = [];
  for (const r of ghost.result.rules) {
    const hit = r.principles.filter((p) => wanted.has(p));
    if (!hit.length || r.weight < S.minRuleWeight || r.s < S.minRuleScore) continue;
    const sStart = atStart.rules.find((q) => q.id === r.id)?.s ?? 1;
    for (const p of hit) taught.push({ principle: p, rule: r.id, weight: r.weight, s: r.s, sStart });
  }
  taught.sort((a, b) => b.weight * (b.s - b.sStart) - a.weight * (a.s - a.sStart));
  const problems = [];
  if (ghost.score < S.minGhostScore) problems.push(`the best spot only scores ${ghost.score} (< ${S.minGhostScore})`);
  if (moved < S.minMove) problems.push(`the answer is only ${moved.toFixed(1)} m from the start (< ${S.minMove} m)`);
  if (atStart.score >= S.maxStartScore) problems.push(`standing still scores ${atStart.score} (>= ${S.maxStartScore})`);
  for (const m of s.misconceptions) if (inRegion(ghost.spot, m.region)) problems.push(`the answer is inside misconception "${m.id}"`);
  if (!taught.length) problems.push(`no rule of ${[...wanted].join(', ')} weighs ${S.minRuleWeight}+ and is met at the answer`);
  const moment = frame.possession === 'us' ? 'in_possession' : 'out_of_possession';
  if (moment !== s.moment) problems.push(`the moment is ${s.moment} but ${frame.possession} has the ball at the freeze`);
  if (ctx.duty === 'first-attacker') problems.push('the learner is on the ball');
  problems.push(...speedProblems(s, S));
  return { errors: [], t, frame, base, ctx, ghost, start, moved, startScore: atStart.score, taught, problems };
}

/** Circle, rect or polygon (even-odd), as scripts/check-scenarios.mjs judges misconception regions. */
function inRegion(p, r) {
  if (r.type === 'circle') return dist(p, r) <= r.r;
  if (r.type === 'rect') return p.x >= Math.min(r.x0, r.x1) && p.x <= Math.max(r.x0, r.x1) && p.y >= Math.min(r.y0, r.y1) && p.y <= Math.max(r.y0, r.y1);
  let inside = false;
  const pts = r.points ?? [];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Realistic ball speeds: a pass within passSpeed (a little slack for rounding), any other movement within carrySpeed. */
function speedProblems(s, S) {
  const b = s.timeline.ball;
  const out = [];
  for (let i = 0; i < b.length - 1; i++) {
    const d = dist(b[i], b[i + 1]);
    if (d < 1e-6) continue;
    const v = d / (b[i + 1].t - b[i].t);
    const [lo, hi] = b[i].event === 'pass' ? S.passSpeed : [0, S.carrySpeed[1]];
    if (v > hi + 0.05 || v < lo - 0.05) out.push(`the ball moves at ${v.toFixed(1)} m/s from t=${b[i].t}`);
  }
  return out;
}

// ---------------------------------------------------------------- generating

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'seed';

/**
 * Generate a "Find your spot" drill for a learner role: deterministic for (seed, role, principles). Tries the
 * seed asked for, then the next ones (numbers: seed + k; strings: '<seed>#k'), up to maxAttempts; keeps the first
 * drill that passes the gates of checkSpotDrill with one of `principles` (any principle with a rule when none is
 * asked) taught at the answer.
 * @param {{ seed?: number|string, role: string, principles?: string[], formations: {us:object, them?:object},
 *           catalogue?: object, params?: object, trace?: object[] }} opts
 *   catalogue: data/principles.json (any form validateScenario accepts) for validation, titles and the takeaway;
 *   params: SPOT_DEFAULTS overrides; trace: collects { attempt, seed, reason } for each rejected try (yield reports)
 * @returns {object|null} an authored-format scenario (ARCHITECTURE §5.15), or null
 */
export function generateSpotDrill({ seed = 1, role, principles = [], formations, catalogue, params, trace } = {}) {
  if (!formations?.us) throw new TypeError('generateSpotDrill: formations.us is required');
  if (!LEARNABLE_ROLES.includes(role)) throw new TypeError(`generateSpotDrill: role ${role} is not a learnable role`);
  const S = { ...SPOT_DEFAULTS, ...params };
  const asked = principles.length ? principles.filter((p) => SPOT[p]) : Object.keys(SPOT);
  if (!asked.length) return null; // none of the principles asked has a rule: the engine cannot key such a drill
  for (let attempt = 0; attempt < S.maxAttempts; attempt++) {
    const s = typeof seed === 'number' && Number.isFinite(seed) ? seed + attempt : attempt ? `${seed}#${attempt}` : seed;
    const rng = createRng(`spot|${role}|${s}`);
    const focus = asked[rng.int(0, asked.length - 1)];
    const draft = writeEvent(rng, role, focus, formations, S);
    if (typeof draft === 'string') { trace?.push({ attempt, seed: s, reason: draft }); continue; }
    const scenario = finish(draft, { seed, used: s, attempt, role, asked, principles, catalogue, S, formations });
    const r = checkSpotDrill(scenario, { formations, principles: catalogue, want: asked, params: S });
    if (r.errors?.length || r.problems.length) { trace?.push({ attempt, seed: s, reason: (r.errors?.length ? r.errors : r.problems)[0] }); continue; }
    return primaryFirst(scenario, r.taught, catalogue);
  }
  return null;
}

/** Principle texts from the catalogue (any form validateScenario accepts), or null. */
function principleOf(id, catalogue) {
  const list = Array.isArray(catalogue) ? catalogue : catalogue?.list ?? catalogue?.principles ?? (catalogue?.byId ? Object.values(catalogue.byId) : null);
  return list?.find?.((q) => q?.id === id) ?? catalogue?.byId?.[id] ?? null;
}

/** Put the principle the answer teaches best first, and take the title and takeaway from it. */
function primaryFirst(scenario, taught, catalogue) {
  const primary = taught[0].principle;
  const rule = RULES.find((r) => r.id === taught[0].rule);
  const p = principleOf(primary, catalogue);
  const principles = [primary, ...scenario.principles.filter((x) => x !== primary && taught.some((t) => t.principle === x))];
  return {
    ...scenario,
    title: p?.name ?? rule.text.standard.name,
    titleKid: p?.kidName ?? rule.text.kid.name,
    takeaway: { standard: p?.summary?.standard ?? `${rule.text.standard.name}.`, kid: p?.summary?.kid ?? `${rule.text.kid.name}.` },
    principles,
    difficulty: p?.level ? (p.level - 2) * 0.5 : 0, // [D] level 1 easier, level 3 harder (Elo prior, logit scale)
  };
}

/**
 * The event: who has the ball (their team out of possession, ours in possession), where it ends up (by the focus
 * principle's FOCUS), and a pass there from a teammate (to the player nearest that spot, aimed where they are when
 * it arrives) or a carry; then the freeze and a short run on with the ball.
 * @returns {{ team, kind, holder, timeline }|string}  a string says why there is no event
 */
function writeEvent(rng, role, focus, formations, S) {
  const me = playerId('us', role);
  const spot = SPOT[focus];
  const team = spot.moments[rng.int(0, spot.moments.length - 1)];
  const inPossession = team === 'us';
  // The end of the event relative to the learner's zone: where the learner's own shape puts them with the ball
  // there (three fixed-point steps from a random ball).
  const kind = FOCUS[focus] ?? 'any';
  const offset = endOffset(rng, kind, role, team);
  if (!offset) return 'no end spot for this focus';
  let B = { x: rng.range(15, 95), y: rng.range(6, 62) };
  for (let k = 0; k < 3; k++) {
    const L = teamTargets(formations.us, 'us', clampToPitch(B, S.edge), { inPossession })[role];
    B = offset.abs ? offset.at : { x: L.x + offset.dx, y: L.y + offset.dy };
  }
  B = clampToPitch(B, S.edge);
  const rt = (t) => Math.round(t * S.tRound) / S.tRound;
  const rp = (p) => ({ x: Math.round(p.x * S.pRound) / S.pRound, y: Math.round(p.y * S.pRound) / S.pRound });
  const hold = rt(rng.range(S.holdTime[0], S.holdTime[1]));
  const atB = autoFrame({ formations, ball: B, possession: team, learnerId: me });
  const eligible = (p) => p.team === team && p.role !== 'GK' && p.id !== me;
  const base = { moment: inPossession ? 'in_possession' : 'out_of_possession', learner: { role }, principles: [focus] };

  if (rng.chance(S.carryChance)) {
    const holder = atB.carrierId;
    if (!holder || holder === me) return 'the learner would carry';
    const speed = rng.range(S.carrySpeed[0], S.carrySpeed[1]);
    const dur = rng.range(S.carryTime[0], S.carryTime[1]);
    const dir = team === 'us' ? 1 : -1; // toward the goal the team attacks, turned up to 40 degrees
    const a = (rng.range(-40, 40) * Math.PI) / 180;
    const A = clampToPitch({ x: B.x - dir * Math.cos(a) * speed * dur, y: B.y - Math.sin(a) * speed * dur }, S.edge);
    const tEnd = rt(hold + dist(A, B) / speed);
    const timeline = {
      ball: [{ t: 0, ...rp(A) }, { t: hold, ...rp(A), event: 'carry' }, { t: tEnd, ...rp(B) }],
      possession: [{ t: 0, team }],
      carrier: [{ t: 0, id: holder }],
      players: { auto: true, overrides: [] },
      tags: [],
    };
    return after(rng, { ...base, team, kind: 'carry', holder, timeline }, tEnd, S, rt, rp);
  }

  // A pass: to the player nearest the end spot, from a teammate passLength away.
  const receiver = atB.players.filter(eligible).reduce((q, p) => (!q || dist(p, B) < dist(q, B) ? p : q), null);
  if (!receiver) return 'nobody to receive';
  const cands = atB.players.filter((p) => eligible(p) && p.id !== receiver.id);
  const weights = cands.map((p) => {
    const d = dist(p, B);
    return d < S.passLength[0] || d > S.passLength[1] ? 0 : Math.exp(-(((d - 20) / 9) ** 2));
  });
  const i = rng.weighted(weights);
  if (i < 0) return 'no passer in range';
  const passer = cands[i];
  const A = clampToPitch({ x: passer.x + rng.range(-1, 1), y: passer.y + rng.range(-1, 1) }, S.edge);
  const speedFor = (d) => clamp(S.passSpeed[0] + (S.passSpeed[1] - S.passSpeed[0]) * clamp((d - 8) / 27, 0, 1), S.passSpeed[0], S.passSpeed[1]);
  const draft = (target, tArr) => ({
    ...base,
    timeline: {
      duration: tArr, freezeAt: tArr,
      ball: [{ t: 0, ...rp(A) }, { t: hold, ...rp(A), event: 'pass' }, { t: tArr, ...rp(target) }],
      possession: [{ t: 0, team }],
      carrier: [{ t: 0, id: passer.id }, { t: hold, id: null }, { t: tArr, id: receiver.id }],
      players: { auto: true, overrides: [] },
      tags: [],
    },
  });
  // Aim where the receiver is when the ball arrives (two refinements, as sequence.js does), within `lead` of the end
  // spot: further away and the receiver runs onto it.
  let target = B;
  let tArr = rt(hold + dist(A, target) / speedFor(dist(A, target)));
  for (let k = 0; k < 2; k++) {
    const f = frameAt(draft(target, tArr), tArr - 1e-3, { formations });
    const q = f.players.find((p) => p.id === receiver.id);
    const g = dist(q, B), k2 = g > S.lead ? S.lead / g : 1;
    target = clampToPitch({ x: B.x + (q.x - B.x) * k2, y: B.y + (q.y - B.y) * k2 }, S.edge);
    tArr = rt(hold + dist(A, target) / speedFor(dist(A, target)));
  }
  const d = dist(A, target);
  if (d < S.passLength[0] - 2 || d > S.passLength[1] + 3) return `pass length ${d.toFixed(0)} m`;
  const { timeline } = draft(target, tArr);
  delete timeline.duration;
  delete timeline.freezeAt;
  return after(rng, { ...base, team, kind: 'pass', holder: receiver.id, timeline }, tArr, S, rt, rp);
}

/** The freeze (freezeAfter the ball arrives) and afterTime of play once afterDelay has passed: the holder runs on with it. */
function after(rng, ev, tArrive, S, rt, rp) {
  const tl = ev.timeline;
  const freezeAt = rt(tArrive + rng.range(S.freezeAfter[0], S.freezeAfter[1]));
  const B = tl.ball[tl.ball.length - 1];
  const dir = ev.team === 'us' ? 1 : -1;
  const a = (rng.range(-30, 30) * Math.PI) / 180;
  const len = rng.range(S.afterSpeed[0], S.afterSpeed[1]) * S.afterTime;
  const C = clampToPitch({ x: B.x + dir * Math.cos(a) * len, y: B.y + Math.sin(a) * len }, S.edge);
  const t1 = rt(freezeAt + S.afterDelay);
  tl.ball.push({ t: t1, x: B.x, y: B.y, event: 'carry' }, { t: rt(t1 + S.afterTime), ...rp(C) });
  tl.duration = tl.ball[tl.ball.length - 1].t;
  tl.freezeAt = freezeAt;
  return ev;
}

/**
 * Where the event leaves the ball for a focus, relative to the learner's own spot with the ball there: { dx, dy },
 * or { abs, at } for a spot fixed on the pitch; null when none fits the role. `team` attacks toward +x (us) or -x.
 */
function endOffset(rng, focus, role, team) {
  const side = ROLE_INFO[role].side;
  const fwd = team === 'us' ? 1 : -1; // the direction the team on the ball attacks
  switch (focus) {
    case 'near': // an opponent a few metres in front of the learner: the learner is the nearest to the ball
      return { dx: -fwd * rng.range(3, 8), dy: rng.range(-5, 5) };
    case 'cover': // a teammate beside the learner goes to the ball; the learner backs them up
      return { dx: -fwd * rng.range(5, 12), dy: rng.range(-15, 15) };
    case 'far': { // in the far wing lane
      if (side === 'C') return null;
      return { abs: true, at: { x: rng.range(20, 85), y: side === 'L' ? rng.range(57, 65) : rng.range(3, 11) } };
    }
    case 'support': // close to the learner, level or behind, for them to support
      return { dx: -fwd * rng.range(-3, 14), dy: rng.range(-12, 12) };
    case 'cross': { // wide in the final third, on the far side for a winger or #8
      const far = side === 'L' ? 1 : side === 'R' ? -1 : rng.chance(0.5) ? 1 : -1;
      return { abs: true, at: { x: rng.range(80, 97), y: far > 0 ? rng.range(56, 65) : rng.range(3, 12) } };
    }
    default:
      return { abs: true, at: { x: rng.range(15, 95), y: rng.range(4, 64) } };
  }
}

/** The scenario from the event: id, words, the learner's start (their automatic spot before the event), the stood-still misconception. */
function finish(ev, { seed, used, attempt, role, asked, principles, catalogue, S, formations }) {
  const key = `${ev.team}-${ev.kind}`;
  const me = playerId('us', role);
  const draft = { ...ev, id: 'draft', title: 'draft', timeline: ev.timeline };
  const p0 = frameAt(draft, 0, { formations }).players.find((p) => p.id === me);
  const start = { x: Math.round(p0.x * 10) / 10, y: Math.round(p0.y * 10) / 10 };
  const ballAtFreeze = ev.timeline.ball.findLast((k) => k.t <= ev.timeline.freezeAt) ?? ev.timeline.ball[0];
  const x = ev.team === 'us' ? ballAtFreeze.x : LENGTH - ballAtFreeze.x; // up the pitch for the team on the ball
  const phase = ev.team === 'us' ? (x < 35 ? 'build_up' : x < 70 ? 'progression' : 'final_third') : (x < 35 ? 'high_press' : x < 70 ? 'mid_block' : 'low_block');
  const wanted = principles.length ? asked : [ev.principles[0]];
  return {
    id: `spot-${role.toLowerCase()}-${slug(seed)}${principles.length ? `-${principles.map((p) => p.toLowerCase()).join('-')}` : ''}`,
    title: 'Generated drill',
    brief: SPOT_WORDS.brief[key],
    briefKid: SPOT_WORDS.briefKid[key],
    question: SPOT_WORDS.question(ev.holder),
    questionKid: SPOT_WORDS.questionKid(ev.holder),
    module: 'generated',
    moment: ev.moment,
    phase,
    principles: [...new Set([ev.principles[0], ...wanted])].filter((p) => !catalogue || principleOf(p, catalogue)),
    learner: { role, start },
    timeline: ev.timeline,
    answer: { mode: 'engine' },
    misconceptions: [{ id: 'stood-still', region: { type: 'circle', x: start.x, y: start.y, r: S.stillRadius }, text: SPOT_WORDS.stillText, textKid: SPOT_WORDS.stillTextKid }],
    difficulty: 0,
    params: {},
    source: { kind: 'generated', generator: 'fotbol spotdrill v1', seed: String(used), requestedSeed: String(seed), attempt, license: 'MIT', author: 'fotbol' },
    notes: `Generated by js/engine/spotdrill.js (${ev.kind} by ${ev.team === 'us' ? 'us' : 'them'}); kept because it passed the drill-quality gates.`,
  };
}

/** The ids of the rule-backed principles (a copy), and how each can be generated: { rules, moments: ['us'|'them'] }. */
export const SPOT_PRINCIPLES = Object.freeze(Object.fromEntries(Object.entries(SPOT).map(([p, e]) => [p, Object.freeze({ rules: Object.freeze([...e.rules]), moments: Object.freeze([...e.moments]) })])));

