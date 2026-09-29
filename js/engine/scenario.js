// Scenario utilities: validate, mirror (left ↔ right), normalise.
// Contract: docs/ARCHITECTURE.md §5.3 (the scenario format). Rationale: docs/RESEARCH.md §9.4, §7.2 step 9.
//
// Validation returns human-readable strings (empty array = valid) so `npm run check` and the
// authoring tool can print them as they are. It accepts the raw authored JSON: anything
// normalizeScenario() would fill in (brief, carrier, tags, answer, ...) may be missing.

import { dist } from './geometry.js';
import { WIDTH, onPitch } from './pitch.js';
import { ROLES, LEARNABLE_ROLES, mirrorRole, mirrorPlayerId, parsePlayerId, playerId } from './roles.js';
import { interpKeys, ballAt, possessionAt, carrierAt, timing } from './timeline.js';

export const SCENARIO_DEFAULTS = Object.freeze({
  coordSlack: 2, // [D] m: coordinates may sit this far off the pitch (throw-ins, run-offs)
  carrierSlack: 3, // [D] m: an overridden carrier may be at most this far from the ball while it has it
  carrierCheckStep: 0.1, // [D] s: sampling step for that check
});

export const MOMENTS = Object.freeze(['in_possession', 'out_of_possession', 'attacking_transition', 'defensive_transition']);
export const EVENTS = Object.freeze(['pass', 'carry', 'cross', 'shot', 'clearance', 'throw-in', 'goal-kick', 'corner', 'free-kick']);
export const ANSWER_MODES = Object.freeze(['engine', 'authored']);
export const REGION_TYPES = Object.freeze(['circle', 'rect', 'polygon']);
/** Phase labels (scenario.phase and frame.tags.phase), snake_case. Descriptive only: no rule reads them. */
export const PHASES = Object.freeze(['build_up', 'progression', 'final_third', 'high_press', 'mid_block', 'low_block', 'counter_attack', 'counter_press', 'recovery', 'set_piece', 'open_play']);
const TEAMS = ['us', 'them', 'none'];
const FACINGS = ['forward', 'backward', 'sideways'];
const MOMENT_POSSESSION = { in_possession: 'us', out_of_possession: 'them' };
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 'us-<role>' for the scenario's learner. */
export const learnerId = (s) => playerId('us', s.learner.role);

const isNum = Number.isFinite;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : JSON.stringify(v));
const isPlayerId = (id) => {
  if (typeof id !== 'string' || !id.includes('-')) return false;
  const { team, role } = parsePlayerId(id);
  return (team === 'us' || team === 'them') && ROLES.includes(role);
};

/**
 * Check a scenario against the format in ARCHITECTURE §5.3.
 * @param {object} s
 * @param {{ principles?: object|Map|Set|Array, params?: object }} [opts]  principles: any of a
 *   {id: Principle} map, {byId}, {list}, a Map/Set, or an array of ids or {id} objects. When given,
 *   every principle ID must exist in it.
 * @returns {string[]} errors; empty = valid
 */
export function validateScenario(s, { principles, params } = {}) {
  const P = { ...SCENARIO_DEFAULTS, ...params };
  const errs = [];
  const err = (m) => errs.push(m);
  if (!isObj(s)) return ['scenario must be a JSON object'];

  const point = (p, path) => {
    if (!isObj(p) || !isNum(p.x) || !isNum(p.y)) return err(`${path} must be a point {x, y} with numbers`), false;
    if (!onPitch(p, P.coordSlack)) return err(`${path} (${fmt(p.x)}, ${fmt(p.y)}) is off the pitch`), false;
    return true;
  };

  // Identity and metadata.
  if (typeof s.id !== 'string' || !ID_RE.test(s.id)) err(`id ${fmt(s.id)} must be kebab-case (a-z, 0-9, single dashes)`);
  if (typeof s.title !== 'string' || !s.title.trim()) err('title is missing');
  if (s.brief !== undefined && typeof s.brief !== 'string') err('brief must be a string');
  // Optional learner text (§5.3): <field>Kid siblings hold the kid wording; the takeaway is a pair.
  for (const k of ['briefKid', 'question', 'questionKid', 'notes']) if (s[k] !== undefined && typeof s[k] !== 'string') err(`${k} must be a string`);
  if (s.takeaway !== undefined && !(typeof s.takeaway === 'string' || (isObj(s.takeaway) && typeof s.takeaway.standard === 'string' && (s.takeaway.kid === undefined || typeof s.takeaway.kid === 'string')))) err('takeaway must be { standard, kid } (strings; kid optional)');
  if (!MOMENTS.includes(s.moment)) err(`moment ${fmt(s.moment)} must be one of ${MOMENTS.join(', ')}`);
  if (s.phase !== undefined && !PHASES.includes(s.phase)) err(`phase ${fmt(s.phase)} must be one of ${PHASES.join(', ')}`);
  if (s.difficulty !== undefined && !isNum(s.difficulty)) err('difficulty must be a number (logit scale, 0 = average)');
  if (s.params !== undefined && !isObj(s.params)) err('params must be an object');

  if (!Array.isArray(s.principles) || !s.principles.length) err('principles must be a non-empty array of principle IDs');
  else {
    const known = principleIdSet(principles);
    s.principles.forEach((id, i) => {
      if (typeof id !== 'string' || !id) err(`principles[${i}] must be a principle ID string`);
      else if (known && !known.has(id)) err(`principles[${i}] ${fmt(id)} is not in the principle catalogue`);
    });
    if (new Set(s.principles).size !== s.principles.length) err('principles has duplicates');
  }

  // Learner.
  let learner = null;
  if (!isObj(s.learner)) err('learner is missing');
  else {
    if (!LEARNABLE_ROLES.includes(s.learner.role)) err(`learner.role ${fmt(s.learner.role)} must be one of ${LEARNABLE_ROLES.join(', ')}`);
    else learner = learnerId(s);
    if (s.learner.start !== undefined) point(s.learner.start, 'learner.start');
  }

  // Timeline.
  const tl = s.timeline;
  if (!isObj(tl)) return err('timeline is missing'), errs;
  const errsBeforeTimeline = errs.length;
  if (!isNum(tl.duration) || tl.duration <= 0) err('timeline.duration must be a positive number of seconds');
  const duration = isNum(tl.duration) ? tl.duration : Infinity;
  if (tl.freezeAt !== undefined) {
    if (!isNum(tl.freezeAt) || tl.freezeAt < 0) err('timeline.freezeAt must be a number ≥ 0');
    else if (tl.freezeAt > duration) err(`timeline.freezeAt (${fmt(tl.freezeAt)}) is after duration (${fmt(duration)})`);
  }

  /** Checks t on every key: a number, within [0, duration], strictly ascending. */
  const times = (keys, path) => {
    let prev = -Infinity;
    keys.forEach((k, i) => {
      if (!isObj(k) || !isNum(k.t)) return err(`${path}[${i}].t must be a number`);
      if (k.t < 0) err(`${path}[${i}].t (${fmt(k.t)}) is negative`);
      if (k.t > duration) err(`${path}[${i}].t (${fmt(k.t)}) is after duration (${fmt(duration)})`);
      if (k.t <= prev) err(`${path}[${i}].t (${fmt(k.t)}) must be after the previous key (${fmt(prev)})`);
      prev = k.t;
    });
  };

  if (!Array.isArray(tl.ball) || !tl.ball.length) err('timeline.ball must have at least one key');
  else {
    times(tl.ball, 'timeline.ball');
    tl.ball.forEach((k, i) => {
      if (!isObj(k)) return;
      point(k, `timeline.ball[${i}]`);
      if (k.event !== undefined && !EVENTS.includes(k.event)) err(`timeline.ball[${i}].event ${fmt(k.event)} must be one of ${EVENTS.join(', ')}`);
    });
  }

  if (!Array.isArray(tl.possession) || !tl.possession.length) err('timeline.possession must have at least one key');
  else {
    times(tl.possession, 'timeline.possession');
    tl.possession.forEach((k, i) => {
      if (isObj(k) && !TEAMS.includes(k.team)) err(`timeline.possession[${i}].team ${fmt(k.team)} must be 'us', 'them' or 'none'`);
    });
  }

  if (tl.carrier !== undefined) {
    if (!Array.isArray(tl.carrier)) err('timeline.carrier must be an array');
    else {
      times(tl.carrier, 'timeline.carrier');
      tl.carrier.forEach((k, i) => {
        if (!isObj(k)) return;
        if (k.id !== null && !isPlayerId(k.id)) err(`timeline.carrier[${i}].id ${fmt(k.id)} is not a player id like 'them-ST' (or null for a ball in flight)`);
        else if (k.id !== null && k.id === learner) err(`timeline.carrier[${i}]: the learner (${learner}) cannot be the carrier`);
      });
    }
  }

  const overrideIds = new Map();
  if (tl.players !== undefined) {
    if (!isObj(tl.players)) err('timeline.players must be an object');
    else {
      if (tl.players.auto !== undefined && typeof tl.players.auto !== 'boolean') err('timeline.players.auto must be true or false');
      const ov = tl.players.overrides ?? [];
      if (!Array.isArray(ov)) err('timeline.players.overrides must be an array');
      else ov.forEach((o, i) => {
        const path = `timeline.players.overrides[${i}]`;
        if (!isObj(o)) return err(`${path} must be an object`);
        if (!isPlayerId(o.id)) err(`${path}.id ${fmt(o.id)} is not a player id like 'them-ST'`);
        else if (o.id === learner) err(`${path}: the learner (${learner}) must not have an override; the learner places themselves`);
        else if (overrideIds.has(o.id)) err(`${path}.id ${o.id} is overridden twice`);
        if (!Array.isArray(o.keys) || !o.keys.length) return err(`${path}.keys must have at least one key`);
        times(o.keys, `${path}.keys`);
        o.keys.forEach((k, j) => isObj(k) && point(k, `${path}.keys[${j}]`));
        if (isPlayerId(o.id)) overrideIds.set(o.id, o.keys);
      });
    }
  }

  if (tl.tags !== undefined) {
    let entries = [];
    if (Array.isArray(tl.tags)) {
      times(tl.tags, 'timeline.tags');
      entries = tl.tags.map((k, i) => [k, `timeline.tags[${i}]`]);
    } else if (isObj(tl.tags)) entries = [[tl.tags, 'timeline.tags']]; // constant tags (RESEARCH 9.4 form)
    else err('timeline.tags must be an array of keys (or one object)');
    for (const [k, path] of entries) {
      if (!isObj(k)) continue;
      if (k.carrierFacing !== undefined && !FACINGS.includes(k.carrierFacing)) err(`${path}.carrierFacing ${fmt(k.carrierFacing)} must be one of ${FACINGS.join(', ')}`);
      if (k.event !== undefined && !EVENTS.includes(k.event)) err(`${path}.event ${fmt(k.event)} must be one of ${EVENTS.join(', ')}`);
      for (const b of ['pressureOnBall', 'ballMovingBack']) if (k[b] !== undefined && typeof k[b] !== 'boolean') err(`${path}.${b} must be true or false`);
      if (k.widthHolders !== undefined && !(Array.isArray(k.widthHolders) && k.widthHolders.every((r) => ROLES.includes(r)))) err(`${path}.widthHolders must be an array of role IDs`);
    }
  }

  // Cross-track consistency (only when the tracks themselves are sound).
  if (errs.length === errsBeforeTimeline) {
    // The carrier belongs to the team in possession at every change of either.
    const changes = [...new Set([0, ...tl.possession.map((k) => k.t), ...(tl.carrier ?? []).map((k) => k.t)])].sort((a, b) => a - b);
    for (const t of changes) {
      const c = carrierAt(s, t), team = possessionAt(s, t);
      if (!c) continue;
      if (team === 'none') err(`at t=${fmt(t)} ${c} has the ball but possession is 'none'`);
      else if (parsePlayerId(c).team !== team) err(`at t=${fmt(t)} ${c} has the ball but possession is '${team}'`);
    }
    // An overridden carrier must actually be with the ball (overrides win over carrier placement).
    const carriers = tl.carrier ?? [];
    carriers.forEach((k, i) => {
      const keys = k.id && overrideIds.get(k.id);
      if (!keys) return;
      const end = i + 1 < carriers.length ? carriers[i + 1].t : duration;
      let worst = { d: 0, t: k.t };
      for (let t = k.t; t < end + 1e-9; t += P.carrierCheckStep) {
        const tt = Math.min(t, end);
        const d = dist(interpKeys(keys, tt), ballAt(s, tt));
        if (d > worst.d) worst = { d, t: tt };
      }
      if (worst.d > P.carrierSlack) err(`${k.id} has the ball from t=${fmt(k.t)} but its override is ${fmt(worst.d)} m from the ball at t=${fmt(worst.t)}`);
    });
    // The moment must agree with who has the ball at the freeze.
    const want = MOMENT_POSSESSION[s.moment];
    const freezeAt = timing(s).freezeAt;
    if (want && possessionAt(s, freezeAt) !== want) err(`moment is ${s.moment} but possession at freezeAt (t=${fmt(freezeAt)}) is '${possessionAt(s, freezeAt)}'`);
  }

  // Answer and misconceptions.
  if (s.answer !== undefined) {
    const a = s.answer;
    if (!isObj(a)) err('answer must be an object');
    else {
      if (a.mode !== undefined && !ANSWER_MODES.includes(a.mode)) err(`answer.mode ${fmt(a.mode)} must be 'engine' or 'authored'`);
      if (a.mode === 'authored' && a.ideal === undefined) err("answer.mode 'authored' needs answer.ideal");
      if (a.ideal !== undefined) point(a.ideal, 'answer.ideal');
      if (a.tol !== undefined && !(isObj(a.tol) && a.tol.tx > 0 && a.tol.ty > 0)) err('answer.tol must be {tx, ty} with positive numbers');
      if (a.hold !== undefined && typeof a.hold !== 'boolean') err('answer.hold must be true or false');
    }
  }
  if (s.misconceptions !== undefined) {
    if (!Array.isArray(s.misconceptions)) err('misconceptions must be an array');
    else s.misconceptions.forEach((m, i) => {
      const path = `misconceptions[${i}]`;
      if (!isObj(m)) return err(`${path} must be an object`);
      if (typeof m.id !== 'string' || !ID_RE.test(m.id)) err(`${path}.id ${fmt(m.id)} must be kebab-case`);
      if (m.text !== undefined && typeof m.text !== 'string') err(`${path}.text must be a string`);
      if (m.textKid !== undefined && typeof m.textKid !== 'string') err(`${path}.textKid must be a string`);
      regionErrors(m.region, `${path}.region`, point).forEach(err);
    });
  }
  // The progressive field's optional block (docs/PROGRESSIVE_FIELD.md §3): npm run check and #/author catch it alike.
  stagesErrors(s.stages).forEach(err);
  return errs;
}

/** The fields of a scenario's optional `"stages"` block (docs/PROGRESSIVE_FIELD.md §3, js/engine/cast.js keepIdsOf). */
export const STAGES_FIELDS = Object.freeze(['note', 'keep']);

/**
 * The problems with a scenario's optional `"stages"` block (pure; empty = fine, and so is no block): an object with
 * `note`, a non-empty string (why the drill has no small or medium stage, or hides a player its words name), and
 * `keep`, an array of player ids the cast always shows (us-LB, them-ST: one of ours or theirs by role; cast.js mirrors
 * them with the drill), and no other field. validateScenario reports them, so #/author and npm run check agree
 * (scripts/check-scenarios.mjs stagesProblems is this).
 * @param {unknown} stages  the scenario's `stages` (undefined: none)
 * @returns {string[]}
 */
export function stagesErrors(stages) {
  if (stages === undefined) return [];
  if (!isObj(stages)) return ['"stages" must be an object: { "note": "...", "keep": ["us-LB", ...] }'];
  const out = [];
  for (const k of Object.keys(stages)) if (!STAGES_FIELDS.includes(k)) out.push(`"stages.${k}" is not a stages field (${STAGES_FIELDS.join(', ')})`);
  if ('note' in stages && !(typeof stages.note === 'string' && stages.note.trim())) out.push('"stages.note" must be a non-empty string');
  if ('keep' in stages) {
    if (!Array.isArray(stages.keep)) out.push('"stages.keep" must be an array of player ids');
    else for (const id of stages.keep) if (!isPlayerId(id)) out.push(`"stages.keep" has ${JSON.stringify(id)}, not a player id (us-LB, them-ST ...)`);
  }
  return out;
}

function regionErrors(r, path, point) {
  const out = [];
  if (!isObj(r) || !REGION_TYPES.includes(r.type)) return [`${path}.type must be one of ${REGION_TYPES.join(', ')}`];
  if (r.type === 'circle') {
    point(r, path);
    if (!(r.r > 0)) out.push(`${path}.r must be a positive radius in metres`);
  } else if (r.type === 'rect') {
    if (![r.x0, r.y0, r.x1, r.y1].every(isNum) || r.x0 >= r.x1 || r.y0 >= r.y1) out.push(`${path} must have numbers x0 < x1 and y0 < y1`);
    else { point({ x: r.x0, y: r.y0 }, `${path} (x0, y0)`); point({ x: r.x1, y: r.y1 }, `${path} (x1, y1)`); }
  } else if (!Array.isArray(r.points) || r.points.length < 3) out.push(`${path}.points must have at least 3 points`);
  else r.points.forEach((p, i) => point(p, `${path}.points[${i}]`));
  return out;
}

function principleIdSet(p) {
  if (!p) return null;
  if (p instanceof Set) return p;
  if (p instanceof Map) return new Set(p.keys());
  if (Array.isArray(p)) return new Set(p.map((x) => (typeof x === 'string' ? x : x?.id)));
  if (isObj(p.byId)) return new Set(Object.keys(p.byId));
  if (Array.isArray(p.list)) return principleIdSet(p.list);
  if (Array.isArray(p.principles)) return principleIdSet(p.principles);
  return new Set(Object.keys(p));
}

// Mirroring. Values are rounded to 1e-6 m so mirroring twice gives back the exact numbers.
const my = (y) => Math.round((WIDTH - y) * 1e6) / 1e6;
const mirrorPt = (p) => (isObj(p) && isNum(p.y) ? { ...p, y: my(p.y) } : p);

/**
 * Left ↔ right mirror (the isomorphic "try a similar one" variant, RESEARCH 7.2): every y → 68 - y
 * (ball, overrides, learner.start, answer.ideal, misconception regions), roles and player ids
 * swap sides (LCB ↔ RCB, 'them-LW' ↔ 'them-RW'). The id gets the suffix '-m' and `mirrorOf`
 * records the original; mirroring a mirror returns the original exactly. Text is not changed,
 * so briefs and misconception texts should not name a side.
 * @returns {object} a new scenario
 */
export function mirrorScenario(s) {
  const m = JSON.parse(JSON.stringify(s));
  if (typeof m.mirrorOf === 'string') { m.id = m.mirrorOf; delete m.mirrorOf; }
  else { m.id = `${s.id}-m`; m.mirrorOf = s.id; }

  if (m.learner) {
    if (m.learner.role) m.learner.role = mirrorRole(m.learner.role);
    if (m.learner.start) m.learner.start = mirrorPt(m.learner.start);
  }
  const tl = m.timeline;
  if (tl) {
    if (Array.isArray(tl.ball)) tl.ball = tl.ball.map(mirrorPt);
    if (Array.isArray(tl.carrier)) for (const k of tl.carrier) if (typeof k.id === 'string') k.id = mirrorPlayerId(k.id);
    for (const o of tl.players?.overrides ?? []) {
      if (typeof o.id === 'string') o.id = mirrorPlayerId(o.id);
      if (Array.isArray(o.keys)) o.keys = o.keys.map(mirrorPt);
    }
    for (const k of Array.isArray(tl.tags) ? tl.tags : tl.tags ? [tl.tags] : []) {
      if (Array.isArray(k.widthHolders)) k.widthHolders = k.widthHolders.map(mirrorRole);
    }
  }
  if (m.answer?.ideal) m.answer.ideal = mirrorPt(m.answer.ideal);
  if (m.answer?.override) m.answer.override = mirrorPt(m.answer.override);
  for (const mc of m.misconceptions ?? []) {
    const r = mc.region;
    if (!isObj(r)) continue;
    if (r.type === 'rect' && isNum(r.y0) && isNum(r.y1)) [r.y0, r.y1] = [my(r.y1), my(r.y0)];
    else if (r.type === 'polygon' && Array.isArray(r.points)) r.points = r.points.map(mirrorPt);
    else if (isNum(r.y)) r.y = my(r.y);
  }
  return m;
}

/**
 * A copy with every optional field filled: brief '', principles [], carrier [], tags as an array
 * of keys (the one-object form becomes a t = 0 key), players { auto: true, overrides: [] },
 * possession derived from `moment` when missing, duration/freezeAt from timing(), answer
 * { mode: 'engine' } (a RESEARCH 9.4 style answer.override becomes ideal + tol), misconceptions [],
 * difficulty 0, params {}. Keys are sorted by t. Does not validate.
 * @returns {object}
 */
export function normalizeScenario(s) {
  const n = JSON.parse(JSON.stringify(s));
  const byT = (a, b) => a.t - b.t;
  n.brief ??= '';
  n.principles ??= [];
  n.learner ??= {};
  const tl = (n.timeline ??= {});
  tl.ball = [...(tl.ball ?? [])].sort(byT);
  tl.possession = tl.possession?.length ? [...tl.possession].sort(byT) : [{ t: 0, team: MOMENT_POSSESSION[n.moment] ?? 'none' }];
  tl.carrier = [...(tl.carrier ?? [])].sort(byT);
  tl.players = {
    ...tl.players,
    auto: tl.players?.auto ?? true,
    overrides: (tl.players?.overrides ?? []).map((o) => ({ ...o, keys: [...(o.keys ?? [])].sort(byT) })),
  };
  tl.tags = Array.isArray(tl.tags) ? [...tl.tags].sort(byT) : isObj(tl.tags) ? [{ t: 0, ...tl.tags }] : [];
  Object.assign(tl, timing(n));

  const a = { mode: 'engine', ...n.answer };
  if (isObj(a.override)) {
    const { x, y, tx, ty } = a.override;
    a.ideal ??= { x, y };
    if (tx > 0 && ty > 0) a.tol ??= { tx, ty };
    delete a.override;
  }
  n.answer = a;
  n.misconceptions ??= [];
  n.difficulty ??= 0;
  n.params ??= {};
  return n;
}
