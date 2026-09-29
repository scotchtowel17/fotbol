// '#/author' and '#/author/<scenarioId>': the scenario authoring tool (RESEARCH 9.2 item 11, 9.4;
// ARCHITECTURE §5.3 and §6).
//
// Coaches (and agents) build ball-scripted scenarios on a live board instead of hand-editing JSON:
//   - a timeline under the pitch (scrubber, play/pause, the freeze marker and the keys);
//   - drag the ball to key it at the current time; select any player and "Override" them to key
//     their path (everyone else follows the engine); drag yourself before the freeze to set
//     learner.start, and from the freeze on to try an answer;
//   - at the freeze the engine's answer is drawn (ghost, heatmap, zone) with the same calls
//     `npm run check` makes (scripts/check-scenarios.mjs checkScenario: frameAt → learnerBaseAt →
//     buildContext → computeGhost), plus warnings: validateScenario errors, a trivial drill (the
//     answer within 5 m of where the learner starts), a key disagreement (the engine's ghost more
//     than 5 m from the coach's spot), and the primary principle's rule not applying at the freeze;
//   - "Play as learner" runs the drill as a learner sees it (brief, playback, freeze, place, the
//     two-beat reveal from js/ui/reveal.js, then the play carries on);
//   - export (download, copy), import (file, paste), a local draft (store key 'author:draft'),
//     mirror, and "New from this moment".
//
// The pure helpers (key editing, the draft analysis, JSON formatting, import parsing) are exported
// for tests and tools; nothing touches the DOM at import time.

import { el, button, icon, segmented, toggleSwitch, stageLayout, toast, announce, openModal, uid } from '../components.js';
import { BALL_ID } from '../board.js';
import { validateScenario, mirrorScenario, normalizeScenario, learnerId as learnerIdOf, MOMENTS, EVENTS, PHASES } from '../../engine/scenario.js';
import { frameAt, learnerBaseAt, ballAt, possessionAt, carrierAt, interpKeys, timing } from '../../engine/timeline.js';
import { buildContext } from '../../engine/context.js';
import { computeGhost } from '../../engine/ghost.js';
import { evaluate, toleranceFor, TOLERANCE } from '../../engine/score.js';
import { judgeSpot } from '../../engine/analyse.js';
import { dist } from '../../engine/geometry.js';
import { RULES, RULES_BY_ID } from '../../engine/rules/index.js';
import { ROLES, ROLE_INFO, LEARNABLE_ROLES, parsePlayerId, playerId, familyOf, mirrorPlayerId } from '../../engine/roles.js';
import { WIDTH, clampToPitch, onPitch } from '../../engine/pitch.js';
import { SCENE_DEFAULTS } from '../../engine/scene.js';
import { createFormation } from '../../engine/formation.js';
import { orientationFor } from '../session.js';

export const AUTHOR_DEFAULTS = Object.freeze({
  timeStep: 0.1, // [D] s: scrubber and key-time resolution
  keyMatch: 0.05, // [D] s: a key this close to the current time is "the key at this time"
  coordStep: 0.1, // [D] m: dragged coordinates are rounded to this
  trivialDistance: 5, // [D] m: the answer this close to where the learner starts makes the drill trivial
  disagreeDistance: 5, // [S] RESEARCH 5.7, = CHECK_DEFAULTS.disagreeDistance in scripts/check-scenarios.mjs
  ruleOk: 0.9, // [D] = EXPLAIN_DEFAULTS.failBelow: a rule scoring below this at the ghost is "not satisfied"
  ghostOk: 90, // [D] the ghost should score S (RESEARCH 9.5)
  misconceptionRadius: 3, // [D] m: a new misconception circle
  analyseDelay: 150, // [D] ms after an edit before the freeze frame is re-analysed
  saveDelay: 400, // [D] ms after an edit before the draft is saved
  historyMax: 100, // [D] undo steps kept
  minDuration: 0.5, // [D] s
});

/** store key of the local draft ({ version, scenario, savedAt, origin }). */
export const DRAFT_KEY = 'author:draft';

/** Phase names used so far (free text in the format; offered as suggestions). */
export { PHASES }; // js/engine/scenario.js (validated there)

const EXPORT_ORDER = ['id', 'title', 'brief', 'briefKid', 'question', 'questionKid', 'takeaway', 'module', 'moment', 'phase', 'principles', 'learner', 'timeline', 'answer', 'misconceptions', 'stages', 'difficulty', 'params', 'source', 'notes', 'mirrorOf'];
const TIMELINE_ORDER = ['duration', 'freezeAt', 'ball', 'possession', 'carrier', 'players', 'tags'];
const ALL_PLAYERS = Object.freeze(['us', 'them'].flatMap((team) => ROLES.map((r) => playerId(team, r))));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ------------------------------------------------------------------ pure helpers

/** Round to 0.1 (seconds or metres: AUTHOR_DEFAULTS.timeStep and coordStep). */
export const roundM = (v) => Math.round(v * 10) / 10;
export const roundPt = (p) => ({ x: roundM(p.x), y: roundM(p.y) });

/** Object.groupBy (not in every browser yet). */
function groupBy(list, key) {
  const out = {};
  for (const x of list) (out[key(x)] ??= []).push(x);
  return out;
}

/** Index of the key at time t (within keyMatch), or -1. */
export function keyIndexAt(keys, t, eps = AUTHOR_DEFAULTS.keyMatch) {
  return (keys ?? []).findIndex((k) => Math.abs(k.t - t) <= eps);
}

/** A copy of `keys` with the key at t merged with `patch` (or a new key inserted), sorted by t. */
export function upsertKey(keys, t, patch) {
  const out = (keys ?? []).map((k) => ({ ...k }));
  const i = keyIndexAt(out, t);
  if (i >= 0) Object.assign(out[i], patch);
  else out.push({ t, ...patch });
  return out.sort((a, b) => a.t - b.t);
}

/** A copy of `keys` without the key at t. */
export function removeKeyAt(keys, t) {
  const i = keyIndexAt(keys, t);
  return i < 0 ? [...(keys ?? [])] : (keys ?? []).filter((_, j) => j !== i);
}

/** The tag values in force at t (cumulative), and the key time each came from. */
export function tagsAt(tags, t, eps = AUTHOR_DEFAULTS.keyMatch) {
  const values = {}, from = {};
  const list = Array.isArray(tags) ? tags : isObj(tags) ? [{ t: 0, ...tags }] : [];
  for (const k of list) {
    if (!(k.t <= t + eps)) continue;
    for (const [f, v] of Object.entries(k)) if (f !== 't') { values[f] = v; from[f] = k.t; }
  }
  return { values, from };
}

/** Is p inside a misconception region (circle | rect | polygon)? Same test as scripts/check-scenarios.mjs. */
export function inRegion(p, r) {
  if (!r) return false;
  if (r.type === 'circle') return dist(p, r) <= r.r;
  if (r.type === 'rect') return p.x >= Math.min(r.x0, r.x1) && p.x <= Math.max(r.x0, r.x1) && p.y >= Math.min(r.y0, r.y1) && p.y <= Math.max(r.y0, r.y1);
  if (r.type === 'polygon') {
    let inside = false;
    const pts = r.points ?? [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  return false;
}

/** The starter's principle per role family: one the engine tests for that role in the starter scene. */
const BLANK_PRINCIPLE = Object.freeze({ CB: 'U4', FB: 'U4', DM: 'D3', CM: 'D5', W: 'D5', ST: 'D1' });

/** A starter scenario: their carry and pass in midfield, frozen after the pass. */
export function blankScenario({ role = 'LCB' } = {}) {
  if (!LEARNABLE_ROLES.includes(role)) role = 'LCB';
  return {
    id: 'new-scenario',
    title: 'New scenario',
    brief: '',
    module: 'M1',
    moment: 'out_of_possession',
    phase: 'mid_block',
    principles: [BLANK_PRINCIPLE[familyOf(role)] ?? 'U1'],
    learner: { role },
    timeline: {
      duration: 6,
      freezeAt: 4,
      ball: [{ t: 0, x: 62, y: 44, event: 'carry' }, { t: 1.5, x: 58, y: 42, event: 'pass' }, { t: 2.5, x: 46, y: 36, event: 'carry' }, { t: 4, x: 41, y: 35 }, { t: 6, x: 35, y: 34 }],
      possession: [{ t: 0, team: 'them' }],
      carrier: [],
      players: { auto: true, overrides: [] },
      tags: [],
    },
    answer: { mode: 'engine' },
    misconceptions: [],
    difficulty: 0,
    source: { kind: 'handmade', license: 'MIT', author: 'fotbol', keyedBy: [] },
  };
}

/** Editing-friendly copy: the RESEARCH 9.4 forms converted, every track an array (normalizeScenario()). */
export function editable(raw) {
  const n = normalizeScenario(raw);
  if (n.params && !Object.keys(n.params).length) delete n.params;
  return n;
}

/** Where the learner stands during playback: learner.start, else their automatic spot at t = 0. */
export function learnerStartOf(s, { formations }) {
  if (isObj(s.learner?.start) && Number.isFinite(s.learner.start.x)) return { x: s.learner.start.x, y: s.learner.start.y };
  const id = s.learner?.role ? learnerIdOf(s) : null;
  try {
    const me = id && frameAt(s, 0, { formations }).players.find((p) => p.id === id);
    if (me) return { x: me.x, y: me.y };
  } catch { /* fall through */ }
  return { x: 30, y: WIDTH / 2 };
}

/** Rule ids that check principle `pid`: its ruleIds in data/principles.json plus any rule that lists it. */
export function rulesForPrinciple(pid, principlesById = {}) {
  const ids = new Set(principlesById[pid]?.ruleIds ?? []);
  for (const r of RULES) if (r.principles?.includes(pid)) ids.add(r.id);
  return [...ids];
}

const ruleName = (id) => RULES_BY_ID[id]?.text?.standard?.name ?? id;
const pt = (p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;

/**
 * Validate a draft and compute the engine's answer at its freeze frame: exactly checkScenario() in
 * scripts/check-scenarios.mjs (which cannot be imported in the browser), plus the authoring warnings.
 * @param {object} raw  the scenario as authored
 * @param {{ principles?: {list, byId}, formations: {us, them?} }} opts
 * @returns {{ errors: string[], warnings: {code:string, level:'warn'|'info', text:string}[] } & (object)}
 *   when valid also: scenario (normalised), t, frame, base, ctx, tol, centre, authored, ghost (the graded
 *   answer), engineGhost (searched round the base: the engine's own answer), start, ideal, rules (top 4 at the ghost)
 */
export function analyseDraft(raw, { principles, formations }) {
  const P = AUTHOR_DEFAULTS;
  const byId = principles?.byId ?? {};
  const catalogue = Object.keys(byId).length ? byId : undefined;
  const errors = validateScenario(raw, { principles: catalogue });
  if (errors.length) return { errors, warnings: [] };

  const s = normalizeScenario(raw);
  const t = s.timeline.freezeAt;
  const learnerId = learnerIdOf(s);
  const frame = frameAt(s, t, { formations });
  const base = learnerBaseAt(s, t, { formations });
  const ctx = buildContext(frame, { learnerId, base });
  const tol = toleranceFor(s.learner.role, s.answer.tol);
  const authored = s.answer.mode === 'authored';
  const centre = authored ? s.answer.ideal : base;
  const ghost = computeGhost(ctx, { base: centre, tol });
  const engineGhost = authored ? computeGhost(ctx, { base, tol }) : ghost;
  const start = learnerStartOf(s, { formations });
  const role = ROLE_INFO[s.learner.role]?.label.toLowerCase() ?? s.learner.role;
  const warnings = [];
  const warn = (code, text, level = 'warn') => warnings.push({ code, level, text });

  const dStart = dist(ghost.spot, start);
  if (dStart < P.trivialDistance) {
    warn('trivial', `Trivial: the answer is only ${dStart.toFixed(1)} m from where the ${role} starts, so standing still passes. Start them further away (drag yourself before the freeze) or freeze later.`);
  }

  let ideal = null;
  if (s.answer.ideal) {
    const distance = dist(engineGhost.spot, s.answer.ideal);
    ideal = { spot: s.answer.ideal, score: evaluate(ctx, s.answer.ideal, { center: centre, tol }).score, distance, disagree: distance > P.disagreeDistance };
    if (ideal.disagree) {
      warn('disagree', `Key disagreement: the engine's best spot ${pt(engineGhost.spot)} is ${distance.toFixed(1)} m from the coach's spot ${pt(s.answer.ideal)}. Check the scene, or ask a coach to review it.`);
    }
  }

  const primary = s.principles[0];
  const ruleIds = rulesForPrinciple(primary, byId);
  const applied = ghost.result.rules.filter((r) => ruleIds.includes(r.id));
  if (primary === 'F2') {
    warn('zone-principle', 'F2 (shift with the ball) is judged by the zone: the distance to the role\'s place in the shape.', 'info');
  } else if (!ruleIds.length) {
    warn('no-rule', `No rule checks ${primary} yet, so the score comes from the zone and the other rules only.`, 'info');
  } else if (!applied.length) {
    warn('rule-not-applied', `${primary} is not tested: its rule (${ruleIds.map(ruleName).join(', ')}) does not apply to the ${role} at the freeze. The engine sees the ${role} as the ${ctx.duty.replace('-', ' ')}; check who is on the ball and where the ${role} is.`);
  } else {
    const weak = applied.filter((r) => r.s < P.ruleOk);
    if (weak.length) warn('rule-weak', `At the engine's best spot, ${weak.map((r) => `${ruleName(r.id)} scores ${Math.round(r.s * 100)}%`).join(' and ')}: ${primary} is only partly met there.`);
  }
  const fam = familyOf(s.learner.role);
  const fams = byId[primary]?.families;
  if (Array.isArray(fams) && fam && !fams.includes(fam)) warn('family', `${primary} is not usually the ${role}'s job (${byId[primary]?.who ?? fams.join(', ')}).`, 'info');

  if (ghost.score < P.ghostOk) warn('low-ghost', `The best spot only scores ${ghost.score}: the rules pull in different directions here, so even a perfect answer will not get an S.`);
  for (const m of s.misconceptions) {
    if (inRegion(ghost.spot, m.region)) warn('misconception-ghost', `The answer is inside the misconception "${m.id}": move or shrink it.`);
  }
  const rules = [...ghost.result.rules].sort((a, b) => b.weight - a.weight).slice(0, 4);
  return { errors: [], warnings, scenario: s, t, frame, base, ctx, tol, centre, authored, ghost, engineGhost, start, ideal, rules };
}

/**
 * A new scenario that starts at time t of `raw`: the state at t (ball, possession, carrier, tags,
 * overridden players) becomes the t = 0 key, the later keys move up by t, and the rest is kept.
 */
export function scenarioFromMoment(raw, t) {
  const s = normalizeScenario(raw);
  const tl = s.timeline;
  const shift = (keys, first) => {
    const later = keys.filter((k) => k.t > t + AUTHOR_DEFAULTS.keyMatch).map((k) => ({ ...k, t: roundM(k.t - t) }));
    return [{ t: 0, ...first }, ...later];
  };
  const ball = roundPt(ballAt(s, t));
  const atT = tl.ball[keyIndexAt(tl.ball, t)];
  const carrier = carrierAt(s, t);
  const { values: tags } = tagsAt(tl.tags, t);
  const duration = Math.max(AUTHOR_DEFAULTS.minDuration, roundM(tl.duration - t));
  const keepsFreeze = tl.freezeAt > t + AUTHOR_DEFAULTS.keyMatch;
  const tenths = Math.round(t * 10);
  const out = {
    ...s,
    id: `${s.id}-t${tenths}`.replace(/-t\d+-t(\d+)$/, '-t$1'),
    title: `${s.title} (from ${t.toFixed(1)} s)`,
    timeline: {
      ...tl,
      duration,
      freezeAt: keepsFreeze ? roundM(tl.freezeAt - t) : duration,
      ball: shift(tl.ball, { ...ball, ...(atT?.event ? { event: atT.event } : {}) }),
      possession: shift(tl.possession, { team: possessionAt(s, t) }),
      carrier: carrier === undefined ? tl.carrier.filter((k) => k.t > t).map((k) => ({ ...k, t: roundM(k.t - t) })) : shift(tl.carrier, { id: carrier }),
      players: { ...tl.players, overrides: tl.players.overrides.map((o) => ({ ...o, keys: shift(o.keys, roundPt(interpKeys(o.keys, t))) })) },
      tags: Object.keys(tags).length ? shift(tl.tags, tags) : tl.tags.filter((k) => k.t > t).map((k) => ({ ...k, t: roundM(k.t - t) })),
    },
  };
  if (!keepsFreeze) { out.misconceptions = []; out.answer = { mode: 'engine' }; }
  delete out.mirrorOf;
  if (out.params && !Object.keys(out.params).length) delete out.params;
  return out;
}

/**
 * Drop empty optional fields (question/takeaway without text, empty params, blank kid texts) and write
 * the text fields in the ARCHITECTURE §5.3 form: brief/question strings with briefKid/questionKid
 * siblings, takeaway as { standard, kid } (a legacy question { standard, kid } is converted).
 */
export function cleanScenario(raw) {
  const s = clone(raw);
  const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
  if (isObj(s.question)) {
    const { standard, kid } = s.question;
    s.question = standard;
    if (!blank(kid) && blank(s.questionKid)) s.questionKid = kid;
  }
  for (const k of ['brief', 'question', 'briefKid', 'questionKid', 'notes']) if (k in s && blank(s[k])) delete s[k];
  if (!s.brief) delete s.briefKid;
  if (!s.question) delete s.questionKid;
  if (isObj(s.takeaway)) {
    if (blank(s.takeaway.standard) && blank(s.takeaway.kid)) delete s.takeaway;
    else if (blank(s.takeaway.kid)) s.takeaway = { standard: s.takeaway.standard };
  } else if (blank(s.takeaway)) delete s.takeaway;
  if (isObj(s.params) && !Object.keys(s.params).length) delete s.params;
  if (s.learner && !s.learner.start) delete s.learner.start;
  if (isObj(s.answer)) for (const k of ['ideal', 'tol']) if (!s.answer[k]) delete s.answer[k];
  for (const m of s.misconceptions ?? []) {
    if (blank(m.textKid)) delete m.textKid;
    if (blank(m.text)) delete m.text;
  }
  return s;
}

/** Keys in the order of ARCHITECTURE §5.3 (unknown keys kept, at the end). */
export function orderScenario(raw) {
  const pick = (obj, order) => {
    const out = {};
    for (const k of order) if (obj[k] !== undefined) out[k] = obj[k];
    for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
    return out;
  };
  const s = pick(raw, EXPORT_ORDER);
  if (isObj(s.timeline)) s.timeline = pick(s.timeline, TIMELINE_ORDER);
  return s;
}

function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (isObj(v)) {
    const parts = Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
  }
  return JSON.stringify(v) ?? 'null';
}
const flat = (v) => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object'));
const isLeaf = (v) => (Array.isArray(v) ? v.every((x) => x === null || typeof x !== 'object') : Object.values(v).every(flat));

/** Scenario JSON as a file: pretty, with small leaf objects and arrays on one line (like _example.json). */
export function formatScenario(raw, { width = 110 } = {}) {
  const fmt = (v, ind) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
    const one = inline(v);
    if (isLeaf(v) && ind.length + one.length <= width) return one;
    const next = `${ind}  `;
    if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => next + fmt(x, next)).join(',\n')}\n${ind}]` : '[]';
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return entries.length ? `{\n${entries.map(([k, x]) => `${next}${JSON.stringify(k)}: ${fmt(x, next)}`).join(',\n')}\n${ind}}` : '{}';
  };
  return `${fmt(orderScenario(cleanScenario(raw)), '')}\n`;
}

/**
 * Parse pasted or loaded text as a scenario.
 * @returns {{ scenario: object } | { error: string }}
 */
export function parseImport(text) {
  let v;
  try {
    v = JSON.parse(String(text ?? '').trim());
  } catch (err) {
    return { error: `That is not valid JSON (${err.message}).` };
  }
  if (isObj(v) && isObj(v.scenario) && v.version) v = v.scenario; // a saved draft
  if (!isObj(v) || !isObj(v.timeline)) return { error: 'That JSON is not a scenario: it needs at least a "timeline".' };
  return { scenario: v };
}

// ------------------------------------------------------------------ small UI helpers

const TAB_IDS = ['moment', 'keys', 'answer', 'details', 'file'];
const TAB_LABEL = { moment: 'Moment', keys: 'Keys', answer: 'Answer', details: 'Details', file: 'File' };
const TEAM_OPTIONS = [{ value: 'them', label: 'Them' }, { value: 'none', label: 'Loose' }, { value: 'us', label: 'Us' }];
const EVENT_LABEL = { pass: 'Pass', carry: 'Carry', cross: 'Cross', shot: 'Shot', clearance: 'Clearance', 'throw-in': 'Throw-in', 'goal-kick': 'Goal kick', corner: 'Corner', 'free-kick': 'Free kick' };
const MOMENT_LABEL = { in_possession: 'In possession', out_of_possession: 'Out of possession', attacking_transition: 'Attacking transition (just won it)', defensive_transition: 'Defensive transition (just lost it)' };
const CATEGORY_LABEL = { foundations: 'Foundations', in_possession: 'In possession', transition: 'Transitions', out_of_possession: 'Out of possession', team_shape: 'Team shape', role: 'Role duties' };
const TAG_FIELDS = [
  { key: 'carrierFacing', label: 'On the ball, facing', options: [['forward', 'Forward'], ['sideways', 'Sideways'], ['backward', 'Backward']], none: 'Not set (forward)' },
  { key: 'pressureOnBall', label: 'Pressure on the ball', options: [['true', 'Yes'], ['false', 'No']], none: 'Automatic', bool: true },
  { key: 'ballMovingBack', label: 'Ball just went back', options: [['true', 'Yes'], ['false', 'No']], none: 'Automatic', bool: true },
  { key: 'event', label: 'Event tag', options: EVENTS.map((e) => [e, EVENT_LABEL[e] ?? e]), none: 'None' },
];

/** "Their striker (#9)", "Our left back", "You (left centre-back)", "Ball". */
function playerLabel(id, learnerId) {
  if (id === BALL_ID) return 'Ball';
  const { team, role } = parsePlayerId(id);
  const label = (ROLE_INFO[role]?.label ?? role).replace(/^\w/, (c) => c.toLowerCase());
  if (id === learnerId) return `You (${label})`;
  return `${team === 'us' ? 'Our' : 'Their'} ${label}`;
}
const secs = (t) => `${(Math.round(t * 10) / 10).toFixed(1)} s`;

/** Labelled control; `control` gets the data-fk used to keep focus across re-renders. */
function field(label, control, { hint, className } = {}) {
  return el('label', { class: ['au-field', className] }, [el('span', { class: 'au-label', text: label }), control, hint && el('span', { class: 'au-hint', text: hint })]);
}

function numberInput({ fk, value, step = 0.1, min, max, placeholder, label, onCommit, className }) {
  return withV0(el('input', {
    type: 'number', inputmode: 'decimal', step, min, max, placeholder, class: ['au-input au-input--num', className],
    value: Number.isFinite(value) ? String(value) : '', 'data-fk': fk, 'aria-label': label,
    onchange: (e) => {
      e.target._v0 = e.target.value; // committed: no longer "typing"
      const raw = e.target.value.trim();
      if (raw === '') return onCommit(null);
      const v = Number(raw);
      if (Number.isFinite(v)) onCommit(v);
    },
  }));
}

/** Remember the rendered value, so a re-render can tell typed-but-uncommitted text apart. */
function withV0(node) {
  node._v0 = node.value;
  return node;
}

function textInput({ fk, value, placeholder, multiline = false, rows = 2, label, onCommit, pattern, spellcheck = true }) {
  const attrs = { class: 'au-input', 'data-fk': fk, placeholder, 'aria-label': label, spellcheck: spellcheck ? 'true' : 'false', pattern, onchange: (e) => { e.target._v0 = e.target.value; onCommit(e.target.value); } };
  if (multiline) return withV0(el('textarea', { ...attrs, rows, value: value ?? '' }));
  return withV0(el('input', { ...attrs, type: 'text', value: value ?? '' }));
}

function selectInput({ fk, value, options, label, onCommit }) {
  return el('select', { class: 'au-input au-select', 'data-fk': fk, 'aria-label': label, onchange: (e) => onCommit(e.target.value) },
    options.map(([v, text]) => el('option', { value: v, selected: v === value, text })));
}

/** segmented() / toggleSwitch() with focus keys on their inputs (so a re-render keeps keyboard focus). */
function seg(fk, opts) {
  const node = segmented(opts);
  for (const i of node.querySelectorAll('input')) i.dataset.fk = `${fk}-${i.value}`;
  return node;
}
function sw(fk, opts) {
  const node = toggleSwitch(opts);
  const i = node.querySelector('input');
  if (i) i.dataset.fk = fk;
  return node;
}

/** A <details> whose open state survives re-renders (kept in `openSet` under `key`). */
function details(openSet, key, summary, children, { defaultOpen = false, className = 'au-more' } = {}) {
  const isOpen = openSet.has(key) ? openSet.get(key) : defaultOpen;
  const node = el('details', { class: className, open: isOpen }, [typeof summary === 'string' ? el('summary', { text: summary }) : summary, ...children]);
  node.addEventListener('toggle', () => openSet.set(key, node.open));
  return node;
}

const smallBtn = (label, onClick, { fk, variant = 'ghost', title, disabled, iconName, className } = {}) =>
  button(label, { variant, onClick, className: ['au-btn', className].filter(Boolean).join(' '), 'data-fk': fk, title, disabled, icon: iconName });

// Undo/redo/skip glyphs (components.js has no such icons).
function glyph(name) {
  const paths = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    start: '<path d="M6 5v14M18 6l-9 6 9 6z"/>',
    freeze: '<path d="M12 3v18M5 7l14 10M19 7 5 17"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    target: '<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  };
  const n = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  n.setAttribute('viewBox', '0 0 24 24');
  n.setAttribute('width', '18');
  n.setAttribute('height', '18');
  n.setAttribute('aria-hidden', 'true');
  n.setAttribute('focusable', 'false');
  n.setAttribute('class', 'icon');
  n.innerHTML = paths[name] ?? '';
  return n;
}
const iconBtn = (name, label, onClick, { fk, disabled, className } = {}) =>
  el('button', { type: 'button', class: ['btn btn--ghost btn--icon au-icon-btn', className], 'aria-label': label, title: label, 'data-fk': fk, disabled, onclick: onClick }, [glyph(name)]);

/** Rebuild `container` with `build()` and keep the focused control (and any text typed into it). */
function rebuildKeepingFocus(container, build) {
  const a = document.activeElement;
  const inside = a && container.contains(a) ? a : null;
  const fk = inside?.dataset?.fk;
  const texty = inside && (inside.tagName === 'TEXTAREA' || (inside.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(inside.type)));
  const typed = texty ? { value: inside.value, start: inside.selectionStart, end: inside.selectionEnd } : null;
  const scroll = container.closest('.panel-scroll')?.scrollTop;
  container.replaceChildren(...[build()].flat().filter(Boolean));
  if (fk) {
    const next = container.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (next) {
      if (typed && 'value' in next && next.value !== typed.value) next.value = typed.value;
      next.focus({ preventScroll: true });
      if (typed && typeof next.setSelectionRange === 'function' && typed.start !== null) {
        try { next.setSelectionRange(typed.start, typed.end); } catch { /* number inputs */ }
      }
    }
  }
  const sc = container.closest('.panel-scroll');
  if (sc && Number.isFinite(scroll)) sc.scrollTop = scroll;
}

// ------------------------------------------------------------------ the mode

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app, params = []) {
  const P = AUTHOR_DEFAULTS;
  const formation = app.data.formations?.us ?? createFormation();
  const formations = { us: formation, them: app.data.formations?.them ?? formation };
  const principles = app.data.principles ?? { list: [], byId: {} };
  const byId = principles.byId ?? {};
  const store = app.store;
  const wording = () => (app.settings.wording === 'kid' ? 'kid' : 'standard');

  // ---- initial draft: #/author/<id> loads that scenario (keeping a saved draft of the same id)
  const saved = (() => { const v = store?.get(DRAFT_KEY, null); return isObj(v?.scenario) ? v : null; })();
  const history = { past: [], future: [] };
  let draft = null, origin = saved?.origin ?? null;
  const paramId = params[0];
  let notice = null;
  if (paramId) {
    if (saved?.scenario?.id === paramId || saved?.origin?.id === paramId) {
      draft = saved.scenario;
      notice = { text: `Showing your draft of ${paramId}. File, then "Reload from file", discards your changes.`, tone: 'info' };
    } else {
      try {
        draft = clone(await app.data.scenarios.load(paramId));
        origin = { id: paramId };
        if (saved) history.past.push(JSON.stringify(saved.scenario));
        notice = { text: saved ? `Opened ${paramId}. Undo brings back the draft you had before.` : `Opened ${paramId}.`, tone: 'good' };
      } catch (err) {
        notice = { text: `Couldn't open "${paramId}" (${err.message}). Showing your draft instead.`, tone: 'bad' };
      }
    }
  }
  if (!draft) draft = saved?.scenario ?? blankScenario({ role: app.settings.role });
  try { draft = editable(draft); } catch { draft = blankScenario({ role: app.settings.role }); }

  const state = {
    draft,
    rev: 0,
    t: 0,
    playing: false,
    selected: null,
    tab: 'moment',
    tool: null, // { kind: 'misconception' | 'ideal' | 'move-misconception', index? }
    trial: null, // a spot tried at the freeze
    analysis: null,
    analysedRev: -1,
    layers: { heatmap: true, lines: false },
    preview: null,
    savedAt: saved?.savedAt ?? null,
    saveOk: true,
    lastFrame: null,
  };
  const openDetails = new Map(); // <details> open state across re-renders
  let cache = { rev: -1 };
  const cached = (key, make) => {
    if (cache.rev !== state.rev) cache = { rev: state.rev };
    if (!(key in cache)) cache[key] = make();
    return cache[key];
  };
  const playable = () => cached('playable', () => { try { return normalizeScenario(state.draft); } catch { return normalizeScenario(blankScenario()); } });
  const times = () => cached('timing', () => timing(playable()));
  const learnerId = () => (LEARNABLE_ROLES.includes(state.draft.learner?.role) ? learnerIdOf(state.draft) : null);
  const startSpot = () => cached('start', () => learnerStartOf(playable(), { formations }));
  const overrides = () => state.draft.timeline.players?.overrides ?? [];
  const overrideOf = (id) => overrides().find((o) => o.id === id) ?? null;
  const tNow = () => roundM(state.t);
  const atFreeze = () => Math.abs(state.t - times().freezeAt) <= P.keyMatch + 1e-9;
  const pastFreeze = () => state.t >= times().freezeAt - P.keyMatch;

  // ---- layout: board + timeline in the stage, panel beside or below
  const layout = stageLayout(root, { label: 'Scenario editor' });
  const boardHost = el('div', { class: 'au-board' });
  const hintLine = el('p', { class: 'au-hint-line' });
  const playBtn = el('button', { type: 'button', class: 'btn btn--primary btn--icon au-play', 'aria-label': 'Play', title: 'Play (Space)', onclick: () => togglePlay() }, [icon('play')]);
  const range = el('input', { type: 'range', class: 'au-range', min: 0, step: P.timeStep, value: 0, 'aria-label': 'Time', oninput: (e) => { setPlaying(false); setTime(Number(e.target.value)); } });
  const strip = el('div', { class: 'au-strip', 'aria-hidden': 'true' });
  const timeOut = el('output', { class: 'au-time' });
  const toStartBtn = iconBtn('start', 'Back to the start', () => { setPlaying(false); setTime(0); });
  const toFreezeBtn = iconBtn('freeze', 'Go to the freeze', () => { setPlaying(false); setTime(times().freezeAt); });
  const timeline = el('div', { class: 'au-timeline' }, [
    el('div', { class: 'au-timeline-row' }, [playBtn, el('div', { class: 'au-scrub' }, [range, strip]), timeOut, toStartBtn, toFreezeBtn]),
    hintLine,
  ]);
  layout.board.append(el('div', { class: 'au-stage' }, [boardHost, timeline]));
  // Pinned from the window (like Drill and Live), so the pitch never flips when the selection bar opens.
  const board = app.createBoard(boardHost, { orientation: orientationFor(window.innerWidth, window.innerHeight) });

  const headEl = el('div', { class: 'au-head' });
  const tabsEl = el('div', { class: 'au-tabs', role: 'tablist', 'aria-label': 'Editor sections' });
  const tabButtons = {};
  const tabPanel = el('div', { class: 'au-tabpanel', role: 'tabpanel', tabindex: '-1' });
  for (const id of TAB_IDS) {
    tabButtons[id] = el('button', {
      type: 'button', role: 'tab', class: 'au-tab', id: uid(`au-tab-${id}`), text: TAB_LABEL[id],
      onclick: () => setTab(id),
      onkeydown: (e) => {
        const i = TAB_IDS.indexOf(id);
        const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TAB_IDS.length - 1 : null;
        if (j === null) return;
        e.preventDefault();
        const next = TAB_IDS[(j + TAB_IDS.length) % TAB_IDS.length];
        setTab(next);
        tabButtons[next].focus();
      },
    });
    tabsEl.append(tabButtons[id]);
  }
  const selectionEl = el('div', { class: 'au-selection' });
  layout.panel.head.append(headEl, selectionEl, tabsEl);
  layout.panel.body.append(tabPanel);
  const undoBtn = el('button', { type: 'button', class: 'btn btn--secondary btn--icon au-undo', onclick: () => undo(), title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo' }, [glyph('undo')]);
  const redoBtn = el('button', { type: 'button', class: 'btn btn--secondary btn--icon au-redo', onclick: () => redo(), title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo' }, [glyph('redo')]);
  const previewBtn = button('Play as learner', { variant: 'primary', icon: 'play', onClick: () => startPreview() });
  const editActions = [previewBtn, undoBtn, redoBtn];
  layout.panel.actions.append(...editActions);
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', onchange: (e) => importFile(e.target.files?.[0]) });
  root.append(fileInput);

  // ---- rendering (coalesced per animation frame)
  const dirty = new Set();
  let raf = 0;
  function invalidate(...parts) {
    for (const p of parts.length ? parts : ['board', 'panel', 'timeline']) dirty.add(p);
    if (!raf) raf = requestAnimationFrame(flush);
  }
  let panelPending = false;
  function flush() {
    raf = 0;
    const d = new Set(dirty);
    dirty.clear();
    if (d.has('board')) renderBoard();
    if (d.has('timeline')) renderTimeline();
    if (d.has('panel')) {
      // Not while dragging (it rebuilds on release), nor over a field that holds typing not yet committed.
      if (gesture || typingInPanel()) panelPending = true;
      else { panelPending = false; renderPanel(); }
    }
  }
  function typingInPanel() {
    const a = document.activeElement;
    if (!a || !layout.panel.root.contains(a) || !('_v0' in a)) return false;
    return a.value !== a._v0;
  }
  layout.panel.root.addEventListener('focusout', () => { if (panelPending) requestAnimationFrame(() => invalidate('panel')); });

  // ---- the draft: edits, history, analysis, autosave
  function setDraft(next, { keepTrial = false } = {}) {
    state.draft = next;
    state.rev++;
    if (!keepTrial) state.trial = null;
    const d = times().duration;
    if (state.t > d) state.t = d;
    scheduleSave();
    scheduleAnalysis();
    invalidate();
  }
  function pushHistory() {
    history.past.push(JSON.stringify(state.draft));
    if (history.past.length > P.historyMax) history.past.shift();
    history.future = [];
  }
  /** Apply `fn` to a copy of the draft. */
  function commit(fn, { record = true, keepTrial = false } = {}) {
    if (record) pushHistory();
    const next = clone(state.draft);
    fn(next);
    setDraft(next, { keepTrial });
  }
  function undo() {
    if (!history.past.length) return;
    history.future.push(JSON.stringify(state.draft));
    setDraft(JSON.parse(history.past.pop()));
    announce('Undone.');
  }
  function redo() {
    if (!history.future.length) return;
    history.past.push(JSON.stringify(state.draft));
    setDraft(JSON.parse(history.future.pop()));
    announce('Redone.');
  }
  function replaceDraft(next, message) {
    pushHistory();
    state.selected = null;
    setDraft(editable(next));
    state.t = times().freezeAt;
    if (message) toast(message, { tone: 'good' });
  }

  let analyseTimer = 0;
  function scheduleAnalysis(delay = P.analyseDelay) {
    clearTimeout(analyseTimer);
    analyseTimer = setTimeout(runAnalysis, delay);
  }
  function runAnalysis() {
    clearTimeout(analyseTimer);
    const rev = state.rev;
    try {
      state.analysis = analyseDraft(state.draft, { principles, formations });
    } catch (err) {
      console.error('[fotbol] author: analysis failed', err);
      state.analysis = { errors: [`The engine could not analyse this scenario (${err.message}).`], warnings: [] };
    }
    state.analysedRev = rev;
    invalidate('board', 'panel');
  }
  const analysis = () => state.analysis; // the latest (at most analyseDelay behind the draft)
  const valid = () => !!analysis() && !analysis().errors.length && !!analysis().ghost;

  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, P.saveDelay);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!store) return;
    const savedAt = new Date().toISOString();
    state.saveOk = store.set(DRAFT_KEY, { version: 1, scenario: state.draft, savedAt, origin });
    state.savedAt = savedAt;
    if (state.tab === 'file') invalidate('panel');
  }

  // ---- time and playback
  function setTime(t, { snap = true } = {}) {
    const { duration, freezeAt } = times();
    let v = Math.min(Math.max(0, Number.isFinite(t) ? t : 0), duration);
    if (snap) {
      v = roundM(v);
      if (Math.abs(v - freezeAt) <= P.keyMatch + 1e-9) v = freezeAt;
    }
    state.t = v;
    invalidate('board', 'timeline');
    if (!state.playing) invalidate('panel');
  }
  let playRaf = 0, playLast = 0, playEnd = null, playDone = null;
  function setPlaying(on, { to = null, done = null } = {}) {
    if (on === state.playing && !to) return;
    state.playing = on;
    cancelAnimationFrame(playRaf);
    playBtn.replaceChildren(icon(on ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    playBtn.title = on ? 'Pause (Space)' : 'Play (Space)';
    if (on) {
      playEnd = to ?? times().duration;
      playDone = done;
      if (state.t >= playEnd - 1e-6 && to === null) state.t = 0;
      playLast = 0;
      playRaf = requestAnimationFrame(step);
    } else {
      playEnd = null;
      playDone = null;
      invalidate();
    }
  }
  function step(now) {
    if (!state.playing) return;
    const dt = playLast ? Math.min(0.1, (now - playLast) / 1000) : 0;
    playLast = now;
    const end = playEnd ?? times().duration;
    state.t = Math.min(end, state.t + dt);
    renderBoard();
    renderTimeline();
    if (state.t >= end - 1e-9) {
      const done = playDone;
      state.t = end;
      setPlaying(false);
      done?.();
      return;
    }
    playRaf = requestAnimationFrame(step);
  }
  function togglePlay() {
    if (state.preview) return;
    cancelTool();
    setPlaying(!state.playing);
  }

  // ---- board
  function learnerShown() {
    if (state.preview) return state.preview.spot ?? startSpot();
    return pastFreeze() && state.trial ? state.trial : startSpot();
  }
  function frameNow() {
    try {
      const f = frameAt(playable(), state.t, { formations, learnerSpot: learnerId() ? learnerShown() : undefined });
      state.lastFrame = f;
      return f;
    } catch (err) {
      console.warn('[fotbol] author: frame failed', err);
      return state.lastFrame;
    }
  }

  function regionMarkers(m, tone, label) {
    const r = m.region;
    if (!r) return [];
    if (r.type === 'circle') return [{ type: 'ring', at: { x: r.x, y: r.y }, r: r.r, tone, pulse: false, label }];
    const pts = r.type === 'rect' ? [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }] : r.points ?? [];
    const out = pts.map((a, i) => ({ type: 'segment', a, b: pts[(i + 1) % pts.length], tone, dashed: false }));
    if (pts.length && label) out.push({ type: 'label', at: { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }, text: label, tone });
    return out;
  }

  function renderBoard() {
    const frame = frameNow();
    if (!frame) return;
    const lid = learnerId();
    const markers = [];
    const pv = state.preview;
    const a = valid() ? analysis() : null;
    let showAnswer = false;

    if (pv) {
      showAnswer = pv.phase === 'full' || pv.phase === 'continue';
      if (pv.phase === 'cue' && pv.judgement?.feedback?.cue?.highlight) markers.push({ ...pv.judgement.feedback.cue.highlight, tone: 'cue' });
      if (showAnswer && a && pv.spot && dist(pv.spot, a.ghost.spot) >= 1) markers.push({ type: 'arrow', from: pv.spot, to: a.ghost.spot, tone: 'fix' });
      board.setGhost(showAnswer && a ? a.ghost.spot : null);
      board.setZone(showAnswer && a ? { center: a.centre, tol: a.tol } : null);
      board.setHeatmap(null);
      board.setOverlays({ offsideLine: null, backLine: null });
    } else {
      // The ball's path and keys, and the selected player's keyed path.
      const tl = state.draft.timeline;
      const ballKeys = tl.ball ?? [];
      for (let i = 1; i < ballKeys.length; i++) markers.push({ type: 'segment', a: ballKeys[i - 1], b: ballKeys[i], tone: 'info', dashed: true });
      for (const k of ballKeys) markers.push({ type: 'ring', at: k, r: 0.55, tone: Math.abs(k.t - state.t) <= P.keyMatch ? 'cue' : 'info', pulse: false });
      for (const o of overrides()) {
        markers.push({ type: 'ring', id: o.id, r: 2.75, tone: o.id === state.selected ? 'cue' : 'info', pulse: false });
        if (o.id !== state.selected) continue;
        for (let i = 1; i < o.keys.length; i++) markers.push({ type: 'segment', a: o.keys[i - 1], b: o.keys[i], tone: 'cue', dashed: true });
        for (const k of o.keys) markers.push({ type: 'ring', at: k, r: 0.5, tone: 'cue', pulse: false });
      }
      showAnswer = atFreeze() && !!a;
      if (atFreeze()) {
        (state.draft.misconceptions ?? []).forEach((m) => markers.push(...regionMarkers(m, 'bad', m.id)));
        const ideal = state.draft.answer?.ideal;
        if (ideal && Number.isFinite(ideal.x)) markers.push({ type: 'ring', at: ideal, r: 1.2, tone: 'good', pulse: false, label: 'Coach' });
        if (a?.authored && dist(a.engineGhost.spot, a.ghost.spot) >= 1) markers.push({ type: 'ring', at: a.engineGhost.spot, r: 1, tone: 'info', pulse: false, label: 'Engine' });
        if (a && state.trial && dist(state.trial, a.ghost.spot) >= 1) markers.push({ type: 'arrow', from: state.trial, to: a.ghost.spot, tone: 'fix' });
      }
      board.setGhost(showAnswer ? a.ghost.spot : null);
      board.setZone(showAnswer ? { center: a.centre, tol: a.tol } : null);
      board.setHeatmap(showAnswer && state.layers.heatmap ? a.ghost.field : null);
      const lines = showAnswer && state.layers.lines;
      board.setOverlays({ offsideLine: lines ? a.ctx.lines.oppSecondLastX : null, backLine: lines ? a.ctx.lines.ourBackLineX : null });
    }
    board.setMarkers(markers);
    const highlight = pv ? [lid, BALL_ID].filter(Boolean) : state.selected ? [state.selected] : [];
    board.render(frame, { learnerId: lid, highlight, labels: 'role', dimOthers: false });
  }

  function enableEditingDrag() {
    if (state.preview || state.tool) return;
    board.enableDrag({ ids: [...ALL_PLAYERS, BALL_ID], onMove: (id, p) => onDrag(id, p, false), onEnd: (id, p) => onDrag(id, p, true) });
  }

  // One drag gesture = one undo step.
  let gesture = null;
  function onDrag(id, p, end) {
    const spot = roundPt(clampToPitch(p));
    const t = tNow();
    const lid = learnerId();
    const first = !gesture || gesture.id !== id;
    if (first) gesture = { id, recorded: false };
    const record = !gesture.recorded;
    const mark = () => { gesture.recorded = true; };

    if (id === BALL_ID) {
      commit((d) => {
        d.timeline.ball = upsertKey(d.timeline.ball, t, spot);
        // An overridden carrier moves with the ball (validateScenario: it must be keyed with the ball).
        const c = carrierAt(normalizeScenario(d), t);
        const o = c && d.timeline.players.overrides.find((q) => q.id === c);
        if (o) o.keys = upsertKey(o.keys, t, carrierSpot(spot, parsePlayerId(c).team));
      }, { record, keepTrial: true });
      mark();
      if (state.selected !== BALL_ID) state.selected = BALL_ID;
    } else if (id === lid) {
      if (pastFreeze()) {
        state.trial = spot;
        invalidate('board', 'panel');
      } else {
        commit((d) => { d.learner.start = spot; }, { record });
        mark();
      }
      if (state.selected !== id) state.selected = id;
    } else if (overrideOf(id)) {
      commit((d) => {
        const o = d.timeline.players.overrides.find((q) => q.id === id);
        o.keys = upsertKey(o.keys, t, spot);
      }, { record, keepTrial: true });
      mark();
      state.selected = id;
    } else {
      // An automatic player: the board snaps them back; offer the override.
      if (state.selected !== id) { state.selected = id; invalidate('panel'); }
      invalidate('board');
      if (end && !gesture.hinted) {
        gesture.hinted = true;
        toast(`${playerLabel(id, lid)} follows the engine. Choose "Override this player" to set their path yourself.`, { timeout: 4200 });
      }
    }
    if (end) {
      gesture = null;
      scheduleAnalysis(40);
      invalidate('panel');
    }
  }
  const carrierSpot = (ball, team) => roundPt({ x: ball.x + (team === 'us' ? -1 : 1) * SCENE_DEFAULTS.carrierOffset, y: ball.y });

  // Selecting: focusing a token (a press, a tap or Tab) selects it.
  board.el.addEventListener('focusin', (e) => {
    const g = e.target.closest?.('.token');
    const id = g?.dataset?.id;
    if (!id || state.preview || id === state.selected) return;
    state.selected = id;
    invalidate('board', 'panel');
  });
  // Click-to-place tools.
  board.el.addEventListener('click', (e) => {
    if (!state.tool) return;
    const w = board.toWorld(e.clientX, e.clientY);
    if (!Number.isFinite(w.x) || !onPitch(w, 1)) return;
    applyTool(roundPt(clampToPitch(w)));
  });

  // ---- tools
  function startTool(tool) {
    setPlaying(false);
    state.tool = tool;
    if (!atFreeze()) setTime(times().freezeAt);
    board.disableDrag();
    layout.root.classList.add('au-placing');
    invalidate();
    announce(tool.kind === 'ideal' ? "Tap the pitch where the coach's spot is. Escape cancels." : 'Tap the pitch where the mistake would be. Escape cancels.');
  }
  function cancelTool() {
    if (!state.tool) return;
    state.tool = null;
    layout.root.classList.remove('au-placing');
    enableEditingDrag();
    invalidate();
  }
  function applyTool(p) {
    const tool = state.tool;
    cancelTool();
    if (tool.kind === 'ideal') {
      commit((d) => { d.answer = { ...d.answer, ideal: p }; }, { keepTrial: true });
      toast("Coach's spot placed.", { tone: 'good' });
    } else if (tool.kind === 'move-misconception') {
      commit((d) => { Object.assign(d.misconceptions[tool.index].region, p); }, { keepTrial: true });
    } else {
      const n = (state.draft.misconceptions ?? []).length;
      const ids = new Set((state.draft.misconceptions ?? []).map((m) => m.id));
      let k = n + 1;
      while (ids.has(`mistake-${k}`)) k++;
      commit((d) => {
        d.misconceptions = [...(d.misconceptions ?? []), { id: `mistake-${k}`, region: { type: 'circle', x: p.x, y: p.y, r: P.misconceptionRadius }, text: '' }];
      }, { keepTrial: true });
      setTab('answer');
      requestAnimationFrame(() => requestAnimationFrame(() => tabPanel.querySelector(`[data-fk="mc-text-${n}"]`)?.focus()));
      toast('Misconception added: say what the learner got wrong.', { tone: 'good' });
    }
  }

  // ---- timeline bar
  function renderTimeline() {
    const { duration, freezeAt } = times();
    range.max = String(duration);
    range.value = String(state.t);
    range.setAttribute('aria-valuetext', `${secs(state.t)} of ${secs(duration)}; the freeze is at ${secs(freezeAt)}`);
    timeOut.textContent = `${secs(state.t)} / ${secs(duration)}`;
    const pct = (t) => `${duration > 0 ? (100 * t) / duration : 0}%`;
    const stripKey = `${state.rev}|${state.selected}|${!!state.preview}`;
    if (strip._key === stripKey && strip._now) {
      strip._now.style.left = pct(state.t);
      hintLine.textContent = hintText();
      return;
    }
    strip._key = stripKey;
    const tl = state.draft.timeline;
    const marks = [el('span', { class: 'au-strip-after', style: { left: pct(freezeAt) } }), el('span', { class: 'au-strip-freeze', style: { left: pct(freezeAt) } })];
    for (const k of tl.ball ?? []) marks.push(el('span', { class: ['au-strip-key', k.event && 'has-event'], style: { left: pct(k.t) } }));
    const other = new Set([...(tl.possession ?? []), ...(tl.carrier ?? []), ...(tl.tags ?? [])].map((k) => roundM(k.t)));
    for (const t of other) marks.push(el('span', { class: 'au-strip-minor', style: { left: pct(t) } }));
    const sel = state.selected && overrideOf(state.selected);
    if (sel) for (const k of sel.keys) marks.push(el('span', { class: 'au-strip-sel', style: { left: pct(k.t) } }));
    strip._now = el('span', { class: 'au-strip-now', style: { left: pct(state.t) } });
    marks.push(strip._now);
    strip.replaceChildren(...marks);
    const busy = !!state.preview;
    for (const n of [range, playBtn, toStartBtn, toFreezeBtn]) n.disabled = busy;
    hintLine.textContent = hintText();
  }

  function hintText() {
    const pv = state.preview;
    if (pv) return { brief: 'Preview: read the brief, then watch.', watch: 'Watch the play…', decide: 'Frozen. Drag yourself to where you should be, then lock it in.', cue: 'Think about the question, then reveal the answer.', full: 'The ghost shows the best spot; the ring is the zone that scores well.', continue: 'The play carries on…' }[pv.phase] ?? '';
    if (state.tool) return state.tool.kind === 'ideal' ? "Tap the pitch where the coach's spot is. Esc cancels." : 'Tap the pitch to place the circle. Esc cancels.';
    if (state.playing) return 'Playing. Space pauses.';
    if (atFreeze()) return state.trial ? 'The freeze: the ghost is the engine\'s answer. Drag yourself to try other spots.' : 'The freeze: the ghost is the engine\'s answer. Drag yourself to try a spot.';
    if (pastFreeze()) return 'After the freeze: the play the learner sees after answering.';
    return `Drag the ball to key it at ${secs(state.t)}. Drag yourself to set where you start.`;
  }

  // ---- panel: head, selection, tabs
  function setTab(id) {
    if (!TAB_IDS.includes(id)) return;
    state.tab = id;
    invalidate('panel');
  }

  function statusChip() {
    const a = analysis();
    if (!a) return el('span', { class: 'au-status', text: 'Checking…' });
    const nErr = a.errors.length, nWarn = a.warnings.filter((w) => w.level === 'warn').length;
    const tone = nErr ? 'bad' : nWarn ? 'warn' : 'good';
    const text = nErr ? `${nErr} problem${nErr > 1 ? 's' : ''}` : nWarn ? `${nWarn} warning${nWarn > 1 ? 's' : ''}` : 'Ready';
    return el('button', { type: 'button', class: ['au-status', `au-status--${tone}`], 'data-fk': 'status', onclick: () => setTab('answer'), title: 'Show the checks' }, [
      nErr || nWarn ? null : icon('check', { size: 16 }), el('span', { text }),
    ]);
  }

  function renderHead() {
    const title = state.draft.title?.trim() || 'Untitled scenario';
    rebuildKeepingFocus(headEl, () => [
      el('p', { class: 'au-kicker', text: state.preview ? 'Playing as the learner' : 'Scenario editor' }),
      el('div', { class: 'au-title-row' }, [el('h1', { class: 'au-title', text: title }), state.preview ? null : statusChip()]),
    ]);
  }

  function renderSelection() {
    const id = state.selected;
    const lid = learnerId();
    if (!id || state.preview) { selectionEl.replaceChildren(); selectionEl.hidden = true; return; }
    selectionEl.hidden = false;
    const t = tNow();
    const close = el('button', { type: 'button', class: 'btn btn--ghost btn--icon au-icon-btn', 'aria-label': 'Clear the selection', title: 'Clear the selection', 'data-fk': 'sel-close', onclick: () => { state.selected = null; invalidate('board', 'panel', 'timeline'); } }, [icon('close', { size: 18 })]);
    let status, actions = [];
    if (id === BALL_ID) {
      const i = keyIndexAt(state.draft.timeline.ball, t);
      status = i >= 0 ? `Key at ${secs(state.draft.timeline.ball[i].t)}${state.draft.timeline.ball[i].event ? ` (${EVENT_LABEL[state.draft.timeline.ball[i].event]?.toLowerCase()})` : ''}` : `No key at ${secs(t)}: drag it to add one`;
      if (i >= 0 && state.draft.timeline.ball.length > 1) actions.push(smallBtn('Delete key', () => commit((d) => { d.timeline.ball = removeKeyAt(d.timeline.ball, t); }), { fk: 'sel-del' }));
    } else if (id === lid) {
      status = pastFreeze() ? (state.trial ? 'Trying a spot: see Answer' : 'From the freeze on, drag to try a spot') : state.draft.learner.start ? 'Starts where you put them' : 'Starts at their automatic spot';
      if (!pastFreeze() && state.draft.learner.start) actions.push(smallBtn('Automatic start', () => commit((d) => { delete d.learner.start; }), { fk: 'sel-auto' }));
      if (pastFreeze() && state.trial) actions.push(smallBtn('Clear try', () => { state.trial = null; invalidate('board', 'panel'); }, { fk: 'sel-clear' }));
    } else {
      const o = overrideOf(id);
      if (o) {
        const i = keyIndexAt(o.keys, t);
        status = `You move them: ${o.keys.length} key${o.keys.length > 1 ? 's' : ''}${i >= 0 ? `, one at ${secs(t)}` : ''}`;
        if (i >= 0 && o.keys.length > 1) actions.push(smallBtn('Delete key', () => commit((d) => { const q = d.timeline.players.overrides.find((x) => x.id === id); q.keys = removeKeyAt(q.keys, t); }), { fk: 'sel-del' }));
        actions.push(smallBtn('Back to automatic', () => commit((d) => { d.timeline.players.overrides = d.timeline.players.overrides.filter((x) => x.id !== id); }), { fk: 'sel-auto' }));
      } else {
        status = 'Follows the engine';
        actions.push(smallBtn('Override this player', () => overridePlayer(id), { fk: 'sel-override', variant: 'secondary' }));
      }
      if (carrierAt(playable(), t) !== id) actions.push(smallBtn('Give them the ball', () => giveBall(id), { fk: 'sel-ball' }));
    }
    const dot = el('span', { class: ['au-dot', id === BALL_ID ? 'is-ball' : id === lid ? 'is-learner' : `is-${parsePlayerId(id).team}`], 'aria-hidden': 'true' });
    rebuildKeepingFocus(selectionEl, () => [
      el('div', { class: 'au-selection-main' }, [dot, el('div', {}, [el('strong', { text: playerLabel(id, lid) }), el('span', { class: 'au-selection-status', text: status })]), close]),
      actions.length ? el('div', { class: 'au-selection-actions' }, actions) : null,
    ]);
  }

  function overridePlayer(id) {
    // Seed the override with the path they follow now, so nothing jumps; then drag to change it.
    const s = playable();
    const { duration, freezeAt } = times();
    const ts = [...new Set([0, tNow(), freezeAt, duration, ...s.timeline.ball.map((k) => k.t)].map(roundM))].sort((a, b) => a - b);
    const keys = [];
    for (const t of ts) {
      try {
        const me = frameAt(s, t, { formations, learnerSpot: learnerId() ? startSpot() : undefined }).players.find((p) => p.id === id);
        if (me) keys.push({ t, ...roundPt(me) });
      } catch { /* skip */ }
    }
    commit((d) => { d.timeline.players.overrides = [...d.timeline.players.overrides, { id, keys }]; }, { keepTrial: true });
    toast('Overridden: they keep their path as keys. Drag them to change it at any time.', { tone: 'good' });
  }

  function giveBall(id) {
    const t = tNow();
    const team = parsePlayerId(id).team;
    commit((d) => {
      const s = normalizeScenario(d);
      if (possessionAt(s, t) !== team) d.timeline.possession = upsertKey(d.timeline.possession, t, { team });
      d.timeline.carrier = upsertKey(d.timeline.carrier, t, { id });
      const o = d.timeline.players.overrides.find((q) => q.id === id);
      if (o) o.keys = upsertKey(o.keys, t, carrierSpot(ballAt(s, t), team));
    }, { keepTrial: true });
  }

  function renderPanel() {
    if (state.preview) { renderPreviewPanel(); return; }
    renderHead();
    renderSelection();
    tabsEl.hidden = false;
    for (const id of TAB_IDS) {
      const b = tabButtons[id];
      const on = id === state.tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      b.setAttribute('aria-controls', tabPanel.id || (tabPanel.id = uid('au-panel')));
    }
    tabPanel.setAttribute('aria-labelledby', tabButtons[state.tab].id);
    const build = { moment: momentTab, keys: keysTab, answer: answerTab, details: detailsTab, file: fileTab }[state.tab];
    rebuildKeepingFocus(tabPanel, build);
    if (layout.panel.actions.firstChild !== previewBtn) layout.panel.actions.replaceChildren(...editActions);
    headEl.querySelector('.au-pv')?.remove();
    undoBtn.disabled = !history.past.length;
    redoBtn.disabled = !history.future.length;
    previewBtn.disabled = !valid();
    previewBtn.title = valid() ? 'Play the drill as a learner would' : 'Fix the problems listed under Answer first';
    layout.panel.feedback.replaceChildren();
  }

  const section = (title, children, { className, hint } = {}) => el('section', { class: ['au-section', className] }, [
    title && el('h2', { class: 'au-section-title', text: title }),
    hint && el('p', { class: 'au-note', text: hint }),
    ...children,
  ]);

  // ---- tab: Moment (what happens at the current time)
  function momentTab() {
    const t = tNow();
    const s = playable();
    const tl = state.draft.timeline;
    const { duration, freezeAt } = times();
    const lid = learnerId();

    const timingRow = el('div', { class: 'au-row' }, [
      field('Length (s)', numberInput({ fk: 'duration', value: tl.duration, min: P.minDuration, step: P.timeStep, label: 'Length in seconds', onCommit: (v) => v > 0 && commit((d) => { d.timeline.duration = roundM(Math.max(P.minDuration, v)); if (d.timeline.freezeAt > d.timeline.duration) d.timeline.freezeAt = d.timeline.duration; }) })),
      field('Freezes at (s)', numberInput({ fk: 'freezeAt', value: tl.freezeAt, min: 0, max: duration, step: P.timeStep, label: 'Freeze time in seconds', onCommit: (v) => v !== null && commit((d) => { d.timeline.freezeAt = roundM(Math.min(Math.max(0, v), d.timeline.duration)); }) })),
      el('div', { class: 'au-field au-field--button' }, [smallBtn(`Freeze at ${secs(t)}`, () => commit((d) => { d.timeline.freezeAt = t; }), { fk: 'freeze-here', variant: 'secondary', disabled: Math.abs(t - freezeAt) < 1e-6 })]),
    ]);

    const ballKeyI = keyIndexAt(tl.ball, t);
    const ballKey = tl.ball[ballKeyI];
    const b = ballAt(s, t);
    const ballBlock = section(`Ball at ${secs(t)}`, [
      el('p', { class: 'au-readout' }, [`At ${secs(t)} the ball is at ${pt(b)} `, el('span', { class: 'au-muted', text: ballKey ? '(a key)' : '(between keys)' })]),
      el('div', { class: 'au-row' }, [
        ballKey
          ? field('Event at this key', selectInput({ fk: 'ball-event', value: ballKey.event ?? '', label: 'Ball event', options: [['', 'None'], ...EVENTS.map((e) => [e, EVENT_LABEL[e]])], onCommit: (v) => commit((d) => { const k = d.timeline.ball[keyIndexAt(d.timeline.ball, t)]; if (v) k.event = v; else delete k.event; }) }))
          : el('div', { class: 'au-field au-field--button' }, [smallBtn(`Add a key at ${secs(t)}`, () => commit((d) => { d.timeline.ball = upsertKey(d.timeline.ball, t, roundPt(b)); }), { fk: 'ball-add', variant: 'secondary' })]),
        ballKey && tl.ball.length > 1 ? el('div', { class: 'au-field au-field--button' }, [smallBtn('Delete this key', () => commit((d) => { d.timeline.ball = removeKeyAt(d.timeline.ball, t); }), { fk: 'ball-del' })]) : null,
      ]),
    ], { hint: 'Drag the ball on the pitch to move it at this time.' });

    const team = possessionAt(s, t);
    const carrier = carrierAt(s, t);
    const earlierCarrier = (tl.carrier ?? []).some((k) => k.t < t - P.keyMatch);
    const carrierOptions = [
      ...(earlierCarrier ? [] : [['auto', 'Automatic (nearest player)']]),
      ['null', 'Nobody: the ball is in flight'],
      ...(team === 'none' ? [] : ROLES.map((r) => playerId(team, r)).filter((id) => id !== lid).map((id) => [id, playerLabel(id, lid)])),
    ];
    const carrierValue = carrier === undefined ? 'auto' : carrier === null ? 'null' : carrier;
    if (!carrierOptions.some(([v]) => v === carrierValue)) carrierOptions.push([carrierValue, carrierValue]);
    const possKey = keyIndexAt(tl.possession, t) >= 0;
    const carKey = keyIndexAt(tl.carrier, t) >= 0;
    const ballOwner = section(`Who has it at ${secs(t)}`, [
      seg('poss', { legend: `Possession${possKey ? ' (a key)' : ''}`, value: team, options: TEAM_OPTIONS, onChange: (v) => setPossession(t, v) }),
      field(`On the ball${carKey ? ' (a key)' : ''}`, selectInput({ fk: 'carrier', value: carrierValue, options: carrierOptions, label: 'Player on the ball', onCommit: (v) => setCarrier(t, v) })),
      momentNote(team),
    ]);

    const { values, from } = tagsAt(tl.tags, t);
    const keyTags = tl.tags[keyIndexAt(tl.tags, t)] ?? {};
    const tagControls = TAG_FIELDS.map((f) => {
      const local = keyTags[f.key];
      const value = local === undefined ? '' : String(local);
      const shown = (v) => (f.bool ? (v ? 'yes' : 'no') : (f.options.find(([k]) => k === v)?.[1] ?? String(v)).toLowerCase());
      const inherited = local === undefined && values[f.key] !== undefined ? `Now ${shown(values[f.key])}, tagged at ${secs(from[f.key])}` : null;
      return field(f.label, selectInput({ fk: `tag-${f.key}`, value, label: f.label, options: [['', f.none], ...f.options], onCommit: (v) => setTag(t, f.key, v === '' ? undefined : f.bool ? v === 'true' : v) }), { hint: inherited });
    });
    const width = keyTags.widthHolders ?? values.widthHolders;
    const widthBox = details(openDetails, 'width', 'Who holds the width (in possession)', [
      el('p', { class: 'au-note', text: 'By default our wingers hold the width. Tick others (an overlapping full-back) to change it from this time on.' }),
      el('div', { class: 'au-checks' }, LEARNABLE_ROLES.map((r) => el('label', { class: 'au-check' }, [
        el('input', { type: 'checkbox', 'data-fk': `width-${r}`, checked: Array.isArray(width) ? width.includes(r) : ROLE_INFO[r].family === 'W', onchange: (e) => {
          const cur = new Set(Array.isArray(width) ? width : LEARNABLE_ROLES.filter((q) => ROLE_INFO[q].family === 'W'));
          if (e.target.checked) cur.add(r); else cur.delete(r);
          setTag(t, 'widthHolders', [...cur]);
        } }),
        el('span', { text: ROLE_INFO[r].short }),
      ]))),
    ]);
    const tagsBlock = section(`Tags at ${secs(t)}`, [el('div', { class: 'au-grid2' }, tagControls), widthBox], { hint: 'Tags describe the moment for the rules; they hold until you change them.' });

    const auto = tl.players?.auto !== false;
    const players = section('Everyone else', [
      sw('auto', { label: 'Players move with the ball', checked: auto, hint: auto ? 'The engine places everyone you have not overridden.' : 'Frozen: everyone stays where they are at the start.', onChange: (on) => commit((d) => { d.timeline.players.auto = on; }) }),
      el('p', { class: 'au-note' }, [`${overrides().length} player${overrides().length === 1 ? '' : 's'} overridden. Select a player on the pitch, then choose "Override this player" to key their path.`]),
    ]);

    return [section('Timing', [timingRow], { className: 'au-section--first' }), ballBlock, ballOwner, tagsBlock, players];
  }

  function momentNote(team) {
    const m = state.draft.moment;
    const want = { in_possession: 'us', out_of_possession: 'them' }[m];
    if (!want || team === want || !pastFreeze()) return null;
    return el('p', { class: 'au-note au-note--warn', text: `This scenario is ${MOMENT_LABEL[m].toLowerCase()}, but ${team === 'none' ? 'nobody' : team === 'us' ? 'we' : 'they'} ${team === 'none' ? 'has' : 'have'} the ball here.` });
  }

  function setPossession(t, team) {
    commit((d) => {
      const s = normalizeScenario(d);
      d.timeline.possession = upsertKey(d.timeline.possession, t, { team });
      const c = carrierAt(s, t);
      if (c && parsePlayerId(c).team !== team) {
        // Keep the carrier with the team in possession: the nearest of theirs, or nobody for a loose ball.
        let id = null;
        if (team !== 'none') {
          const b = ballAt(s, t);
          const f = frameNow();
          const cands = f?.players.filter((p) => p.team === team && p.role !== 'GK' && p.id !== learnerId()) ?? [];
          cands.sort((a, q) => dist(a, b) - dist(q, b));
          id = cands[0]?.id ?? null;
        }
        d.timeline.carrier = upsertKey(d.timeline.carrier, t, { id });
        toast(id ? `${playerLabel(id, learnerId())} takes the ball at ${secs(t)}.` : `Nobody is on the ball at ${secs(t)}.`);
      }
    }, { keepTrial: true });
  }

  function setCarrier(t, v) {
    commit((d) => {
      if (v === 'auto') { d.timeline.carrier = removeKeyAt(d.timeline.carrier, t); return; }
      const id = v === 'null' ? null : v;
      d.timeline.carrier = upsertKey(d.timeline.carrier, t, { id });
      const o = id && d.timeline.players.overrides.find((q) => q.id === id);
      if (o) o.keys = upsertKey(o.keys, t, carrierSpot(ballAt(normalizeScenario(d), t), parsePlayerId(id).team));
    }, { keepTrial: true });
  }

  function setTag(t, key, value) {
    commit((d) => {
      const tags = d.timeline.tags ?? [];
      const i = keyIndexAt(tags, t);
      if (value === undefined) {
        if (i < 0) return;
        delete tags[i][key];
        if (Object.keys(tags[i]).length === 1) tags.splice(i, 1);
        d.timeline.tags = tags;
      } else d.timeline.tags = upsertKey(tags, t, { [key]: value });
    }, { keepTrial: true });
  }

  // ---- tab: Keys (every key, editable)
  function keysTab() {
    const tl = state.draft.timeline;
    const lid = learnerId();
    const go = (t) => iconBtn('target', `Go to ${secs(t)}`, () => { setPlaying(false); setTime(t); }, { fk: null });
    const tInput = (fk, k, apply) => numberInput({ fk, value: k.t, min: 0, max: times().duration, step: P.timeStep, label: 'Time in seconds', className: 'au-input--t', onCommit: (v) => {
      if (v === null) return;
      const nt = roundM(Math.min(Math.max(0, v), times().duration));
      commit((d) => apply(d, nt));
    } });
    const retime = (list, i, nt) => {
      if (list.some((k, j) => j !== i && Math.abs(k.t - nt) <= P.keyMatch)) { toast(`There is already a key at ${secs(nt)}.`, { tone: 'bad' }); return list; }
      list[i].t = nt;
      return list.sort((a, b) => a.t - b.t);
    };
    const del = (fk, label, onClick, disabled) => iconBtn('trash', label, onClick, { fk, disabled });
    const colHead = (...cols) => el('li', { class: 'au-key-head', 'aria-hidden': 'true' }, cols.map((c) => el('span', { text: c })));
    const table = (title, rows, addLabel, onAdd, hint, head) => details(openDetails, `keys-${title}`, el('summary', {}, [el('span', { text: title }), el('span', { class: 'au-count', text: String(rows.length) })]), [
      hint && el('p', { class: 'au-note', text: hint }),
      rows.length ? el('ul', { class: 'au-key-list' }, [head, ...rows]) : el('p', { class: 'au-note', text: 'None yet.' }),
      onAdd && smallBtn(addLabel, onAdd, { fk: `add-${title}`, variant: 'secondary', className: 'au-add' }),
    ], { defaultOpen: true, className: 'au-keys' });
    const row = (children, current) => el('li', { class: ['au-key', current && 'is-current'] }, children);
    const now = (k) => Math.abs(k.t - state.t) <= P.keyMatch;

    const ballRows = (tl.ball ?? []).map((k, i) => row([
      tInput(`b-t-${i}`, k, (d, nt) => { d.timeline.ball = retime(d.timeline.ball, i, nt); }),
      numberInput({ fk: `b-x-${i}`, value: k.x, step: P.coordStep, label: 'x (metres from our goal line)', onCommit: (v) => v !== null && commit((d) => { d.timeline.ball[i].x = roundM(v); }) }),
      numberInput({ fk: `b-y-${i}`, value: k.y, step: P.coordStep, label: 'y (metres from our left touchline)', onCommit: (v) => v !== null && commit((d) => { d.timeline.ball[i].y = roundM(v); }) }),
      selectInput({ fk: `b-e-${i}`, value: k.event ?? '', label: 'Event', options: [['', '—'], ...EVENTS.map((e) => [e, EVENT_LABEL[e]])], onCommit: (v) => commit((d) => { if (v) d.timeline.ball[i].event = v; else delete d.timeline.ball[i].event; }) }),
      go(k.t),
      del(`b-d-${i}`, `Delete the ball key at ${secs(k.t)}`, () => commit((d) => { d.timeline.ball.splice(i, 1); }), tl.ball.length <= 1),
    ], now(k)));

    const possRows = (tl.possession ?? []).map((k, i) => row([
      tInput(`p-t-${i}`, k, (d, nt) => { d.timeline.possession = retime(d.timeline.possession, i, nt); }),
      selectInput({ fk: `p-v-${i}`, value: k.team, label: 'Team in possession', options: TEAM_OPTIONS.map((o) => [o.value, o.label]), onCommit: (v) => commit((d) => { d.timeline.possession[i].team = v; }) }),
      go(k.t),
      del(`p-d-${i}`, `Delete the possession key at ${secs(k.t)}`, () => commit((d) => { d.timeline.possession.splice(i, 1); }), tl.possession.length <= 1),
    ], now(k)));

    const carrierRows = (tl.carrier ?? []).map((k, i) => row([
      tInput(`c-t-${i}`, k, (d, nt) => { d.timeline.carrier = retime(d.timeline.carrier, i, nt); }),
      selectInput({ fk: `c-v-${i}`, value: k.id === null ? 'null' : k.id, label: 'Player on the ball', options: [['null', 'In flight'], ...ALL_PLAYERS.filter((id) => id !== lid).map((id) => [id, playerLabel(id, lid)])], onCommit: (v) => commit((d) => { d.timeline.carrier[i].id = v === 'null' ? null : v; }) }),
      go(k.t),
      del(`c-d-${i}`, `Delete the carrier key at ${secs(k.t)}`, () => commit((d) => { d.timeline.carrier.splice(i, 1); })),
    ], now(k)));

    const tagRows = (tl.tags ?? []).map((k, i) => {
      const { t: _t, ...rest } = k;
      const summary = Object.entries(rest).map(([f, v]) => `${f} ${Array.isArray(v) ? v.join('+') : v}`).join(', ') || '(empty)';
      return row([
        tInput(`g-t-${i}`, k, (d, nt) => { d.timeline.tags = retime(d.timeline.tags, i, nt); }),
        el('span', { class: 'au-key-text', text: summary }),
        go(k.t),
        del(`g-d-${i}`, `Delete the tags at ${secs(k.t)}`, () => commit((d) => { d.timeline.tags.splice(i, 1); })),
      ], now(k));
    });

    const overrideBlocks = overrides().map((o, oi) => el('li', { class: ['au-override', o.id === state.selected && 'is-selected'] }, [
      el('div', { class: 'au-override-head' }, [
        el('button', { type: 'button', class: 'au-link', 'data-fk': `o-sel-${oi}`, text: playerLabel(o.id, lid), onclick: () => { state.selected = o.id; invalidate('board', 'panel', 'timeline'); } }),
        el('span', { class: 'au-count', text: `${o.keys.length} key${o.keys.length > 1 ? 's' : ''}` }),
        smallBtn('Back to automatic', () => commit((d) => { d.timeline.players.overrides.splice(oi, 1); }), { fk: `o-del-${oi}` }),
      ]),
      o.id === state.selected ? el('ul', { class: 'au-key-list' }, [colHead('s', 'x', 'y'), ...o.keys.map((k, i) => row([
        tInput(`o-${oi}-t-${i}`, k, (d, nt) => { const q = d.timeline.players.overrides[oi]; q.keys = retime(q.keys, i, nt); }),
        numberInput({ fk: `o-${oi}-x-${i}`, value: k.x, step: P.coordStep, label: 'x', onCommit: (v) => v !== null && commit((d) => { d.timeline.players.overrides[oi].keys[i].x = roundM(v); }) }),
        numberInput({ fk: `o-${oi}-y-${i}`, value: k.y, step: P.coordStep, label: 'y', onCommit: (v) => v !== null && commit((d) => { d.timeline.players.overrides[oi].keys[i].y = roundM(v); }) }),
        go(k.t),
        del(`o-${oi}-d-${i}`, `Delete this key at ${secs(k.t)}`, () => commit((d) => { d.timeline.players.overrides[oi].keys.splice(i, 1); }), o.keys.length <= 1),
      ], now(k)))]) : null,
    ]));

    const t = tNow();
    return [
      el('p', { class: 'au-note au-note--first', text: 'x is metres from our goal line (we attack towards 105), y is metres from our left touchline (0 to 68). Keys are linear in between; possession, carrier and tags hold until the next key.' }),
      table('Ball', ballRows, `Add a ball key at ${secs(t)}`, () => commit((d) => { d.timeline.ball = upsertKey(d.timeline.ball, t, roundPt(ballAt(playable(), t))); }), null, colHead('s', 'x', 'y', 'event')),
      table('Possession', possRows, `Add a key at ${secs(t)}`, () => commit((d) => { d.timeline.possession = upsertKey(d.timeline.possession, t, { team: possessionAt(playable(), t) }); })),
      table('On the ball', carrierRows, null, null, 'Before the first key the nearest player carries the ball. Set carriers in the Moment tab.'),
      table('Tags', tagRows, null, null),
      details(openDetails, 'keys-overrides', el('summary', {}, [el('span', { text: 'Players you move' }), el('span', { class: 'au-count', text: String(overrides().length) })]), [
        overrideBlocks.length ? el('ul', { class: 'au-override-list' }, overrideBlocks) : el('p', { class: 'au-note', text: 'None: everyone follows the engine. Select a player on the pitch and choose "Override this player".' }),
      ], { defaultOpen: true, className: 'au-keys' }),
    ];
  }

  // ---- tab: Answer (the engine's answer at the freeze, checks, coach's spot, misconceptions)
  function answerTab() {
    const a = analysis();
    const d = state.draft;
    const lid = learnerId();
    const out = [];
    if (!a) return [el('p', { class: 'au-note', text: 'Checking the scenario…' })];

    const checks = [];
    for (const e of a.errors) checks.push(el('li', { class: 'au-check-item is-error' }, [el('span', { class: 'au-check-icon', 'aria-hidden': 'true', text: '✕' }), el('span', { text: e })]));
    for (const w of a.warnings) checks.push(el('li', { class: ['au-check-item', w.level === 'info' ? 'is-info' : 'is-warn'] }, [el('span', { class: 'au-check-icon', 'aria-hidden': 'true', text: w.level === 'info' ? 'i' : '!' }), el('span', { text: w.text })]));
    if (!checks.length) checks.push(el('li', { class: 'au-check-item is-ok' }, [el('span', { class: 'au-check-icon', 'aria-hidden': 'true', text: '✓' }), el('span', { text: 'Valid, and the engine agrees with the setup.' })]));
    out.push(section(a.errors.length ? 'Problems to fix' : 'Checks', [el('ul', { class: 'au-checklist' }, checks)], { className: 'au-section--first' }));
    if (a.errors.length) return out;

    const g = a.ghost;
    const facts = [
      ['Freeze', secs(a.t)],
      ['Duty', a.ctx.duty.replace('-', ' ')],
      ['Block', `${a.ctx.blockHeight} block`],
      [a.authored ? "Coach's spot" : 'Base (zone centre)', pt(a.centre)],
      ['Best spot', `${pt(g.spot)} scores ${g.score} (${g.result.grade})`],
      ['Starts at', `${pt(a.start)}, ${dist(a.start, g.spot).toFixed(1)} m away`],
    ];
    if (a.authored) facts.push(["Engine's own", `${pt(a.engineGhost.spot)} scores ${a.engineGhost.score}`]);
    const ruleRows = a.rules.map((r) => el('li', {}, [
      el('span', { class: 'au-rule-name', text: ruleName(r.id) }),
      el('span', { class: 'au-rule-p', text: r.principles?.[0] ?? '' }),
      el('span', { class: ['au-rule-s', r.s < P.ruleOk && 'is-low'], text: `${Math.round(r.s * 100)}%` }),
      el('span', { class: 'au-rule-w', text: `×${r.weight}` }),
    ]));
    out.push(section(`The engine's answer`, [
      el('dl', { class: 'au-facts' }, facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
      el('p', { class: 'au-sub', text: 'Rules at the best spot' }),
      ruleRows.length ? el('ul', { class: 'au-rules' }, ruleRows) : el('p', { class: 'au-note', text: 'No rule applies: only the zone counts.' }),
      el('div', { class: 'au-row au-row--switches' }, [
        sw('layer-heat', { label: 'Heatmap', checked: state.layers.heatmap, onChange: (on) => { state.layers.heatmap = on; invalidate('board'); } }),
        sw('layer-lines', { label: 'Offside and back line', checked: state.layers.lines, onChange: (on) => { state.layers.lines = on; invalidate('board'); } }),
      ]),
      atFreeze() ? null : smallBtn('Show it on the pitch (go to the freeze)', () => { setPlaying(false); setTime(a.t); }, { fk: 'go-freeze', variant: 'secondary' }),
    ]));

    // A spot tried at the freeze.
    const trial = state.trial;
    let trialBody;
    if (trial) {
      const j = judgeSpot({ ctx: a.ctx, ghost: g }, trial, { wording: wording(), principles: byId });
      const fb = j.feedback;
      const hit = (d.misconceptions ?? []).find((m) => inRegion(trial, m.region));
      trialBody = [
        el('p', { class: 'au-trial-score' }, [el('span', { class: 'au-trial-num', text: String(j.result.score) }), el('span', { class: `au-grade au-grade--${j.result.grade}`, text: j.result.grade }), el('span', { text: fb.headline })]),
        fb.reasons.length ? el('ul', { class: 'au-bullets' }, fb.reasons.map((r) => el('li', {}, [el('strong', { text: `${r.principleId ?? ''} ${r.name}: ` }), r.text]))) : null,
        fb.fix ? el('p', { class: 'au-note' }, [el('strong', { text: 'Fix: ' }), fb.fix.text]) : null,
        hit ? el('p', { class: 'au-note au-note--warn' }, [el('strong', { text: `Misconception "${hit.id}": ` }), (wording() === 'kid' && hit.textKid) || hit.text || '(no text yet)']) : null,
        smallBtn('Clear', () => { state.trial = null; invalidate('board', 'panel'); }, { fk: 'trial-clear' }),
      ];
    } else trialBody = [el('p', { class: 'au-note', text: 'At the freeze, drag yourself (YOU) to see how a spot scores and which feedback a learner would get.' })];
    out.push(section('Try a spot', trialBody));

    // What the drill is graded against.
    const ans = d.answer ?? { mode: 'engine' };
    const ideal = ans.ideal;
    const roleTol = toleranceFor(d.learner.role);
    const setAnswer = (fn) => commit((q) => { q.answer = { mode: 'engine', ...q.answer }; fn(q.answer); }, { keepTrial: true });
    out.push(section('Graded against', [
      seg('ans-mode', { legend: 'Answer', value: ans.mode ?? 'engine', options: [{ value: 'engine', label: "Engine's best spot" }, { value: 'authored', label: "Coach's spot" }], onChange: (v) => {
        if (v === 'authored' && !ideal) setAnswer((x) => { x.mode = 'authored'; x.ideal = roundPt(g.spot); });
        else setAnswer((x) => { x.mode = v; });
      } }),
      el('p', { class: 'au-note', text: ans.mode === 'authored' ? "The zone is centred on the coach's spot; the rules still score the spot." : "The coach's spot is optional here: it only flags a key disagreement when the engine is more than 5 m away." }),
      el('div', { class: 'au-row' }, [
        field("Coach's x", numberInput({ fk: 'ideal-x', value: ideal?.x, step: P.coordStep, label: "Coach's spot x", onCommit: (v) => setAnswer((x) => { if (v === null) { delete x.ideal; if (x.mode === 'authored') x.mode = 'engine'; } else x.ideal = { x: roundM(v), y: x.ideal?.y ?? roundM(g.spot.y) }; }) })),
        field("Coach's y", numberInput({ fk: 'ideal-y', value: ideal?.y, step: P.coordStep, label: "Coach's spot y", onCommit: (v) => setAnswer((x) => { if (v === null) { delete x.ideal; if (x.mode === 'authored') x.mode = 'engine'; } else x.ideal = { x: x.ideal?.x ?? roundM(g.spot.x), y: roundM(v) }; }) })),
      ]),
      el('div', { class: 'au-row au-row--buttons' }, [
        smallBtn('Place on the pitch', () => startTool({ kind: 'ideal' }), { fk: 'ideal-place', variant: 'secondary' }),
        smallBtn('Use the best spot', () => setAnswer((x) => { x.ideal = roundPt(g.spot); }), { fk: 'ideal-ghost' }),
        ideal ? smallBtn('Remove', () => setAnswer((x) => { delete x.ideal; x.mode = 'engine'; }), { fk: 'ideal-del' }) : null,
      ]),
      el('div', { class: 'au-row' }, [
        field('Zone depth ±m', numberInput({ fk: 'tol-x', value: ans.tol?.tx, placeholder: String(roleTol.tx), step: 0.5, min: 0.5, label: 'Tolerance along the pitch (metres)', onCommit: (v) => setAnswer((x) => { if (v === null) delete x.tol; else x.tol = { tx: v, ty: x.tol?.ty ?? roleTol.ty }; }) })),
        field('Zone width ±m', numberInput({ fk: 'tol-y', value: ans.tol?.ty, placeholder: String(roleTol.ty), step: 0.5, min: 0.5, label: 'Tolerance across the pitch (metres)', onCommit: (v) => setAnswer((x) => { if (v === null) delete x.tol; else x.tol = { tx: x.tol?.tx ?? roleTol.tx, ty: v }; }) })),
      ]),
      el('p', { class: 'au-note', text: `Leave the zone empty for the ${ROLE_INFO[d.learner.role]?.label.toLowerCase() ?? 'role'} default (±${roleTol.tx} m deep, ±${roleTol.ty} m wide; every role: ${Object.entries(TOLERANCE).filter(([f]) => f !== 'GK').map(([f, v]) => `${f} ${v.tx}/${v.ty}`).join(', ')}).` }),
    ]));

    // Misconceptions.
    const mcs = d.misconceptions ?? [];
    const mcItems = mcs.map((m, i) => {
      const r = m.region ?? {};
      const circle = r.type === 'circle';
      const setMc = (fn) => commit((q) => fn(q.misconceptions[i]), { keepTrial: true });
      return el('li', { class: 'au-mc' }, [
        el('div', { class: 'au-row' }, [
          field('Id', textInput({ fk: `mc-id-${i}`, value: m.id, label: 'Misconception id (kebab-case)', spellcheck: false, onCommit: (v) => setMc((x) => { x.id = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }) })),
          circle ? field('Radius m', numberInput({ fk: `mc-r-${i}`, value: r.r, min: 0.5, step: 0.5, label: 'Radius in metres', onCommit: (v) => v > 0 && setMc((x) => { x.region.r = v; }) }), { className: 'au-field--narrow' }) : el('span', { class: 'au-note', text: `A ${r.type} region` }),
        ]),
        circle ? el('div', { class: 'au-row' }, [
          field('x', numberInput({ fk: `mc-x-${i}`, value: r.x, step: P.coordStep, label: 'Centre x', onCommit: (v) => v !== null && setMc((x) => { x.region.x = roundM(v); }) }), { className: 'au-field--narrow' }),
          field('y', numberInput({ fk: `mc-y-${i}`, value: r.y, step: P.coordStep, label: 'Centre y', onCommit: (v) => v !== null && setMc((x) => { x.region.y = roundM(v); }) }), { className: 'au-field--narrow' }),
          el('div', { class: 'au-field au-field--button' }, [smallBtn('Place', () => startTool({ kind: 'move-misconception', index: i }), { fk: `mc-place-${i}`, variant: 'secondary' })]),
        ]) : null,
        field('What they got wrong', textInput({ fk: `mc-text-${i}`, value: m.text, multiline: true, label: 'Misconception text, standard wording', placeholder: 'You went to the ball as well, but your partner already has it; drop in behind them instead.', onCommit: (v) => setMc((x) => { x.text = v; }) })),
        field('Kid wording', textInput({ fk: `mc-kid-${i}`, value: m.textKid, multiline: true, label: 'Misconception text, kid wording', placeholder: 'Your teammate is already on the ball. Stay behind them to help.', onCommit: (v) => setMc((x) => { x.textKid = v; }) })),
        el('div', { class: 'au-row au-row--end' }, [smallBtn('Delete', () => commit((q) => { q.misconceptions.splice(i, 1); }, { keepTrial: true }), { fk: `mc-del-${i}`, iconName: null })]),
      ]);
    });
    out.push(section('Misconceptions', [
      el('p', { class: 'au-note', text: 'Circles where a learner with a typical wrong idea would stand. Landing in one shows its text. Second person, one sentence, football words; never "left" or "right on the screen".' }),
      mcItems.length ? el('ol', { class: 'au-mc-list' }, mcItems) : null,
      smallBtn('Add a misconception', () => startTool({ kind: 'misconception' }), { fk: 'mc-add', variant: 'secondary', className: 'au-add' }),
    ]));
    return out;
  }

  // ---- tab: Details (metadata)
  function detailsTab() {
    const d = state.draft;
    const set = (fn, opts) => commit(fn, { keepTrial: true, ...opts });
    const modules = (app.data.curriculum?.modules ?? []).filter((m) => m.kind !== 'tutorial');
    const moduleOptions = [['', 'None'], ...modules.map((m) => [m.id, `${m.id}: ${m.title}`])];
    if (d.module && !moduleOptions.some(([v]) => v === d.module)) moduleOptions.push([d.module, d.module]);
    const pairText = (v) => (isObj(v) ? v : { standard: typeof v === 'string' ? v : '', kid: '' });
    // brief and question are strings with a <field>Kid sibling; the takeaway is a { standard, kid } pair (§5.3).
    const q = isObj(d.question) ? pairText(d.question) : { standard: d.question ?? '', kid: d.questionKid ?? '' };
    const tk = pairText(d.takeaway);
    const setPair = (key, part, v) => set((x) => {
      const cur = pairText(x[key]);
      cur[part] = v;
      x[key] = cur;
    });
    const setKid = (key, v) => set((x) => {
      if (isObj(x[key])) { x[`${key}Kid`] = x[key].kid; x[key] = x[key].standard; }
      if (v && v.trim()) x[`${key}Kid`] = v; else delete x[`${key}Kid`];
    });
    const setStandard = (key, v) => set((x) => {
      if (isObj(x[key])) { if (x[key].kid) x[`${key}Kid`] = x[key].kid; }
      x[key] = v;
    });
    const lid = learnerId();
    const start = d.learner?.start;
    const auto = !start;

    // Principles: the chosen ones in order (first = primary), then a picker grouped by category.
    const chosen = d.principles ?? [];
    const pName = (id) => byId[id]?.short ?? byId[id]?.name ?? id;
    const chips = chosen.map((id, i) => el('li', { class: ['au-chip', i === 0 && 'is-primary'] }, [
      el('b', { text: id }), el('span', { text: pName(id) }), i === 0 ? el('em', { text: 'primary' }) : smallBtn('Make primary', () => set((x) => { x.principles = [id, ...x.principles.filter((p) => p !== id)]; }), { fk: `pr-up-${id}` }),
      iconBtn('trash', `Remove ${id}`, () => set((x) => { x.principles = x.principles.filter((p) => p !== id); }), { fk: `pr-rm-${id}` }),
    ]));
    const moduleP = new Set(modules.find((m) => m.id === d.module)?.principles ?? []);
    const v1 = (principles.list ?? []).filter((p) => p.release === 'v1');
    const groups = Object.entries(groupBy(v1, (p) => p.category)).map(([cat, list]) => el('fieldset', { class: 'au-pgroup' }, [
      el('legend', { text: CATEGORY_LABEL[cat] ?? cat }),
      el('div', { class: 'au-checks' }, list.map((p) => el('label', { class: ['au-check au-check--p', moduleP.has(p.id) && 'in-module'], title: p.name }, [
        el('input', { type: 'checkbox', 'data-fk': `pr-${p.id}`, checked: chosen.includes(p.id), onchange: (e) => set((x) => {
          const cur = x.principles ?? [];
          x.principles = e.target.checked ? [...cur.filter((id) => id !== p.id), p.id] : cur.filter((id) => id !== p.id);
        }) }),
        el('span', {}, [el('b', { text: p.id }), ` ${p.short}`]),
      ]))),
    ]));

    return [
      section('About', [
        field('Id (the file name)', textInput({ fk: 'id', value: d.id, spellcheck: false, label: 'Scenario id', placeholder: 'm1-05-d3-lcb', onCommit: (v) => set((x) => { x.id = v.trim(); }) }), { hint: 'Lower case with dashes, e.g. m1-05-d3-lcb. Save the file as <id>.json.' }),
        field('Title', textInput({ fk: 'title', value: d.title, label: 'Title', placeholder: 'Cover your centre-back partner', onCommit: (v) => set((x) => { x.title = v; }) })),
        field('Brief (before the play)', textInput({ fk: 'brief', value: d.brief, multiline: true, label: 'Brief', placeholder: 'Their #9 drops in to get the ball. Watch your partner, then find your spot.', onCommit: (v) => set((x) => { x.brief = v; }) }), { hint: 'One sentence. Never name a side: the scenario can be mirrored.' }),
        field('Brief, kid wording', textInput({ fk: 'brief-kid', value: d.briefKid ?? '', multiline: true, label: 'Brief, kid wording', placeholder: 'Their striker wants the ball. Watch your friend, then find your spot.', onCommit: (v) => setKid('brief', v) })),
        field('Question at the freeze', textInput({ fk: 'question', value: q.standard, multiline: true, label: 'Question, standard wording', placeholder: 'Your partner goes to the striker. Where do you go?', onCommit: (v) => setStandard('question', v) })),
        field('Question, kid wording', textInput({ fk: 'question-kid', value: q.kid, multiline: true, label: 'Question, kid wording', placeholder: 'Your friend goes to the ball. Where do you go?', onCommit: (v) => setKid('question', v) })),
        field('Takeaway (after the reveal)', textInput({ fk: 'takeaway', value: tk.standard, multiline: true, label: 'Takeaway, standard wording', placeholder: 'When your partner steps out, drop behind them at an angle so one pass cannot beat you both.', onCommit: (v) => setPair('takeaway', 'standard', v) })),
        field('Takeaway, kid wording', textInput({ fk: 'takeaway-kid', value: tk.kid, multiline: true, label: 'Takeaway, kid wording', placeholder: 'Your friend goes to the ball? Stand behind them to help.', onCommit: (v) => setPair('takeaway', 'kid', v) }), { hint: 'Kid wording: 15 words or fewer, no jargon.' }),
      ], { className: 'au-section--first' }),
      section('Where it fits', [
        el('div', { class: 'au-grid2' }, [
          field('Module', selectInput({ fk: 'module', value: d.module ?? '', options: moduleOptions, label: 'Module', onCommit: (v) => set((x) => { if (v) x.module = v; else delete x.module; }) })),
          field('Moment', selectInput({ fk: 'moment', value: d.moment ?? '', options: [...(MOMENTS.includes(d.moment) ? [] : [['', 'Choose…']]), ...MOMENTS.map((m) => [m, MOMENT_LABEL[m]])], label: 'Moment', onCommit: (v) => set((x) => { x.moment = v; }) })),
          field('Phase', el('input', { type: 'text', class: 'au-input', 'data-fk': 'phase', list: 'au-phases', value: d.phase ?? '', spellcheck: 'false', 'aria-label': 'Phase', onchange: (e) => set((x) => { const v = e.target.value.trim(); if (v) x.phase = v; else delete x.phase; }) })),
          field('Difficulty', numberInput({ fk: 'difficulty', value: d.difficulty ?? 0, step: 0.1, min: -3, max: 3, label: 'Difficulty', onCommit: (v) => set((x) => { x.difficulty = v ?? 0; }) }), { hint: 'Elo prior: 0 average, +1 harder, -1 easier.' }),
        ]),
        el('datalist', { id: 'au-phases' }, PHASES.map((p) => el('option', { value: p }))),
      ]),
      section('Principles it teaches', [
        chips.length ? el('ol', { class: 'au-chips' }, chips) : el('p', { class: 'au-note au-note--warn', text: 'Pick at least one principle. The first is the one the drill is about.' }),
        details(openDetails, 'principles', 'Choose principles', [moduleP.size ? el('p', { class: 'au-note', text: `Highlighted: the principles module ${d.module} teaches.` }) : null, ...groups], { defaultOpen: !chips.length }),
      ]),
      section('The learner', [
        el('div', { class: 'au-grid2' }, [
          field('Plays as', selectInput({ fk: 'role', value: d.learner?.role ?? '', options: LEARNABLE_ROLES.map((r) => [r, ROLE_INFO[r].label]), label: 'Learner role', onCommit: (v) => set((x) => { x.learner = { ...x.learner, role: v }; }) })),
        ]),
        el('div', { class: 'au-row' }, [
          field('Start x', numberInput({ fk: 'start-x', value: start?.x, placeholder: auto ? startSpot().x.toFixed(1) : '', step: P.coordStep, label: 'Start x', onCommit: (v) => set((x) => { if (v === null) delete x.learner.start; else x.learner.start = { x: roundM(v), y: x.learner.start?.y ?? roundM(startSpot().y) }; }) }), { className: 'au-field--narrow' }),
          field('Start y', numberInput({ fk: 'start-y', value: start?.y, placeholder: auto ? startSpot().y.toFixed(1) : '', step: P.coordStep, label: 'Start y', onCommit: (v) => set((x) => { if (v === null) delete x.learner.start; else x.learner.start = { x: x.learner.start?.x ?? roundM(startSpot().x), y: roundM(v) }; }) }), { className: 'au-field--narrow' }),
          auto ? null : el('div', { class: 'au-field au-field--button' }, [smallBtn('Automatic', () => set((x) => { delete x.learner.start; }), { fk: 'start-auto' })]),
        ]),
        el('p', { class: 'au-note', text: auto ? `No start set: ${lid ? 'they start at their automatic spot at 0 s' : 'choose a role'}. Drag yourself before the freeze to set one.` : 'They stand here while the play runs, then move at the freeze.' }),
      ]),
      section('Source', [
        el('div', { class: 'au-grid2' }, [
          field('Author', textInput({ fk: 'src-author', value: d.source?.author, label: 'Author', onCommit: (v) => set((x) => { x.source = { kind: 'handmade', ...x.source, author: v.trim() }; }) })),
          field('Licence', selectInput({ fk: 'src-license', value: d.source?.license ?? 'MIT', options: [['MIT', 'MIT'], ['CC0-1.0', 'CC0 1.0']], label: 'Licence', onCommit: (v) => set((x) => { x.source = { kind: 'handmade', ...x.source, license: v }; }) })),
        ]),
        field('Keyed by (coaches who agree with the answer)', textInput({ fk: 'src-keyed', value: (d.source?.keyedBy ?? []).join(', '), label: 'Keyed by', placeholder: 'Coach A, Coach B', onCommit: (v) => set((x) => { x.source = { kind: 'handmade', ...x.source, keyedBy: v.split(',').map((s) => s.trim()).filter(Boolean) }; }) })),
        details(openDetails, 'params', 'Engine parameters (advanced)', [
          el('p', { class: 'au-note', text: 'Overrides of SCENE_DEFAULTS and TIMELINE_DEFAULTS as JSON, e.g. {"autoPress": false}. Leave empty for none.' }),
          textInput({ fk: 'params', value: d.params && Object.keys(d.params).length ? JSON.stringify(d.params) : '', multiline: true, spellcheck: false, label: 'Engine parameters JSON', onCommit: (v) => {
            if (!v.trim()) { set((x) => { delete x.params; }); return; }
            try {
              const p = JSON.parse(v);
              if (!isObj(p)) throw new Error('not an object');
              set((x) => { x.params = p; });
            } catch (err) { toast(`Parameters not saved: ${err.message}.`, { tone: 'bad' }); }
          } }),
        ]),
      ]),
    ];
  }

  // ---- tab: File (export, import, draft, help)
  function fileTab() {
    const d = state.draft;
    const id = d.id || 'scenario';
    const savedTime = state.savedAt ? new Date(state.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    const idx = app.data.scenarios?.index ?? [];
    const openInput = el('input', { type: 'text', class: 'au-input', list: 'au-scenario-ids', 'data-fk': 'open-id', placeholder: idx[0]?.id ?? 'm1-01-d1-lcm', spellcheck: 'false', 'aria-label': 'Scenario id to open' });
    const open = () => {
      const v = openInput.value.trim();
      if (!v) { openInput.focus(); return; }
      saveNow();
      app.navigate(`author/${v}`);
    };
    openInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
    const cmd = (text) => el('code', { class: 'au-code', text });
    return [
      section('Your draft', [
        el('p', { class: ['au-note', !state.saveOk && 'au-note--warn'], text: !state.saveOk ? 'This browser cannot save (private window or blocked storage): download your work before you close it.' : savedTime ? `Saved in this browser at ${savedTime}. It stays here until you start another one.` : 'Saved in this browser as you work.' }),
        el('div', { class: 'au-row au-row--buttons' }, [
          button(`Download ${id}.json`, { variant: 'primary', onClick: download, 'data-fk': 'download' }),
          button('Copy JSON', { onClick: copyJSON, 'data-fk': 'copy' }),
        ]),
        el('div', { class: 'au-row au-row--buttons' }, [
          button('Import a file', { onClick: () => fileInput.click(), 'data-fk': 'import-file' }),
          button('Paste JSON', { onClick: pasteDialog, 'data-fk': 'paste' }),
        ]),
      ], { className: 'au-section--first' }),
      section('Make another', [
        el('div', { class: 'au-row au-row--buttons' }, [
          button('Mirror', { onClick: mirror, 'data-fk': 'mirror', title: 'Swap left and right' }),
          button(`New from ${secs(tNow())}`, { onClick: fromMoment, 'data-fk': 'from-moment', title: 'A new scenario that starts at this moment' }),
          button('New blank', { onClick: () => replaceDraft(blankScenario({ role: d.learner?.role ?? app.settings.role }), 'Started a new scenario. Undo brings the old one back.'), 'data-fk': 'new' }),
        ]),
        el('p', { class: 'au-note', text: 'Mirror swaps left and right (the id gets -m); words are not changed, so briefs must not name a side. "New from" starts a scenario at the current moment and keeps the play after it.' }),
      ]),
      section('Open a scenario', [
        el('div', { class: 'au-row au-row--open' }, [openInput, button('Open', { onClick: open, 'data-fk': 'open' })]),
        el('datalist', { id: 'au-scenario-ids' }, [...idx.map((m) => el('option', { value: m.id, text: m.title ?? m.id })), el('option', { value: '_example', text: 'The template (_example.json)' })]),
        origin?.id ? smallBtn(`Reload ${origin.id} from file`, () => reloadOrigin(), { fk: 'reload', variant: 'secondary' }) : null,
      ]),
      section('Add it to fotbol', [
        el('ol', { class: 'au-steps' }, [
          el('li', {}, ['Download the JSON and save it as ', cmd(`data/scenarios/${id}.json`), ' (the file name is the id).']),
          el('li', {}, ['Add ', cmd(`"${id}"`), ` to the scenarios of ${d.module ?? 'its module'} in `, cmd('data/curriculum.json'), '.']),
          el('li', {}, ['Rebuild the scenario list: ', cmd('node scripts/build-index.mjs')]),
          el('li', {}, ['Check it: ', cmd('npm run check'), ' prints the engine\'s answer and flags disagreements; then ', cmd('npm test'), '.']),
          el('li', {}, ['Ask a coach to key it (RESEARCH 9.5): add their name under Source, "Keyed by".']),
        ]),
      ]),
      details(openDetails, 'json', 'Show the JSON', [el('pre', { class: 'au-pre', text: formatScenario(d) })], { className: 'au-more au-json' }),
    ];
  }

  // ---- file actions
  function download() {
    const text = formatScenario(state.draft);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = el('a', { href: url, download: `${state.draft.id || 'scenario'}.json`, class: 'visually-hidden' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    if (analysis()?.errors.length) toast('Downloaded, but it has problems: npm run check will reject it until they are fixed.', { tone: 'bad', timeout: 5000 });
    else toast(`Downloaded ${state.draft.id}.json.`, { tone: 'good' });
  }
  async function copyJSON() {
    const text = formatScenario(state.draft);
    try {
      await navigator.clipboard.writeText(text);
      toast('JSON copied.', { tone: 'good' });
    } catch {
      openModal({ title: 'Copy the JSON', content: [el('p', { text: 'Your browser blocked the clipboard. Select the text and copy it.' }), el('textarea', { class: 'au-input au-paste', rows: 12, readonly: true, value: text, onfocus: (e) => e.target.select() })], actions: (close) => [button('Done', { variant: 'primary', onClick: () => close() })] });
    }
  }
  function loadText(text, source) {
    const r = parseImport(text);
    if (r.error) { toast(r.error, { tone: 'bad', timeout: 5000 }); return false; }
    origin = null;
    replaceDraft(r.scenario, `Imported ${source}. Undo brings back what you had.`);
    return true;
  }
  async function importFile(file) {
    fileInput.value = '';
    if (!file) return;
    try { loadText(await file.text(), file.name); } catch (err) { toast(`Couldn't read ${file.name} (${err.message}).`, { tone: 'bad' }); }
  }
  function pasteDialog() {
    const area = el('textarea', { class: 'au-input au-paste', rows: 12, spellcheck: 'false', placeholder: '{ "id": "…", "timeline": { … } }', 'aria-label': 'Scenario JSON' });
    const m = openModal({
      title: 'Paste scenario JSON',
      content: [el('p', { class: 'au-note', text: 'This replaces the scenario you are editing (Undo brings it back).' }), area],
      actions: (close) => [button('Cancel', { onClick: () => close() }), button('Load it', { variant: 'primary', onClick: () => { if (loadText(area.value, 'the pasted JSON')) close(); } })],
    });
    requestAnimationFrame(() => area.focus());
    return m;
  }
  function mirror() {
    const m = mirrorScenario(state.draft);
    if (state.trial) state.trial = { x: state.trial.x, y: WIDTH - state.trial.y };
    const sel = state.selected && state.selected !== BALL_ID ? mirrorPlayerId(state.selected) : state.selected;
    const trial = state.trial;
    pushHistory();
    setDraft(editable(m), { keepTrial: true });
    state.trial = trial;
    state.selected = sel;
    toast(`Mirrored: left and right swapped. The id is now ${m.id}.`, { tone: 'good' });
  }
  function fromMoment() {
    const t = tNow();
    if (t <= 0) { toast('Move the time on first: "New from" starts the new scenario at the current moment.'); return; }
    replaceDraft(scenarioFromMoment(state.draft, t), `New scenario from ${secs(t)}. Undo brings the old one back.`);
  }
  async function reloadOrigin() {
    try {
      const s = clone(await app.data.scenarios.load(origin.id));
      replaceDraft(s, `Reloaded ${origin.id} from file.`);
    } catch (err) { toast(`Couldn't reload ${origin.id} (${err.message}).`, { tone: 'bad' }); }
  }

  // ---- Play as learner (a drill run inside the editor, unsaved scenarios included)
  let reveal = null, revealMod;
  async function loadReveal() {
    if (revealMod !== undefined) return revealMod;
    try { revealMod = await import('../reveal.js'); } catch (err) { console.warn('[fotbol] author: reveal panel unavailable', err); revealMod = null; }
    return revealMod;
  }
  async function startPreview() {
    runAnalysis();
    if (!valid()) { setTab('answer'); toast('Fix the problems first.', { tone: 'bad' }); return; }
    setPlaying(false);
    cancelTool();
    await loadReveal();
    state.preview = { phase: 'brief', spot: null, judgement: null };
    state.t = 0;
    board.disableDrag();
    invalidate();
  }
  function exitPreview() {
    setPlaying(false);
    reveal?.destroy();
    reveal = null;
    state.preview = null;
    setTime(times().freezeAt);
    enableEditingDrag();
    layout.collapse?.();
    invalidate();
    requestAnimationFrame(() => requestAnimationFrame(() => previewBtn.focus({ preventScroll: true })));
  }
  function previewWatch() {
    const pv = state.preview;
    pv.phase = 'watch';
    pv.spot = null;
    pv.judgement = null;
    pv.shown = null;
    state.t = 0;
    board.disableDrag();
    layout.collapse?.();
    invalidate();
    setPlaying(true, { to: times().freezeAt, done: previewDecide });
  }
  function previewDecide() {
    const pv = state.preview;
    if (!pv) return;
    pv.phase = 'decide';
    pv.spot = startSpot();
    const lid = learnerId();
    board.enableDrag({ ids: [lid], onMove: (_id, p) => { pv.spot = roundPt(clampToPitch(p)); renderBoard(); }, onEnd: (_id, p) => { pv.spot = roundPt(clampToPitch(p)); renderBoard(); } });
    invalidate();
    announce('Frozen. Drag yourself to where you should be, then lock it in.');
  }
  function previewLock() {
    const pv = state.preview;
    const a = analysis();
    board.disableDrag();
    pv.judgement = judgeSpot({ ctx: a.ctx, ghost: a.ghost }, pv.spot, { wording: wording(), principles: byId });
    pv.phase = 'cue';
    layout.expand?.();
    invalidate();
  }
  function previewFull() {
    state.preview.phase = 'full';
    invalidate();
  }
  function previewContinue() {
    const pv = state.preview;
    pv.phase = 'continue';
    state.t = times().freezeAt;
    invalidate();
    setPlaying(true, { to: times().duration, done: () => { if (state.preview) { state.preview.phase = 'full'; invalidate(); } } });
  }

  function renderPreviewPanel() {
    const pv = state.preview;
    const d = state.draft;
    const w = wording();
    renderHead();
    selectionEl.hidden = true;
    tabsEl.hidden = true;
    const role = ROLE_INFO[d.learner.role]?.label.toLowerCase();
    const pick = (v, kidAlt) => (w === 'kid' && typeof kidAlt === 'string' && kidAlt.trim() ? kidAlt : isObj(v) ? (v[w] || v.standard || '') : typeof v === 'string' ? v : '');
    const question = pick(d.question, d.questionKid) || (w === 'kid' ? 'Where is the best spot for you?' : 'Where should you be?');
    const brief = pick(d.brief, d.briefKid);
    const back = button('Back to editing', { onClick: exitPreview });
    let body = [];
    const actions = [];
    if (pv.phase === 'brief') {
      body = [el('p', { class: 'au-pv-role', text: w === 'kid' ? `You are the ${role}.` : `You are the ${role} in a 4-3-3.` }), brief ? el('p', { class: 'au-pv-brief', text: brief }) : null];
      actions.push(button(w === 'kid' ? 'Watch' : 'Watch the play', { variant: 'primary', icon: 'play', onClick: previewWatch }), back);
    } else if (pv.phase === 'watch') {
      body = [el('p', { class: 'au-pv-brief', text: brief || (w === 'kid' ? 'Watch the ball.' : 'Watch how the play unfolds.') })];
      actions.push(button('Skip to the freeze', { onClick: () => { setPlaying(false); state.t = times().freezeAt; previewDecide(); } }), back);
    } else if (pv.phase === 'decide') {
      body = [el('p', { class: 'au-pv-question', text: question }), el('p', { class: 'au-note', text: w === 'kid' ? 'Drag YOU to your spot. Then press Lock it in.' : 'Drag yourself (YOU) to your spot, or tap YOU and then tap the spot. Then lock it in.' })];
      actions.push(button('Lock it in', { variant: 'primary', icon: 'check', onClick: previewLock }), back);
    } else {
      actions.push(back);
    }
    headEl.append(el('div', { class: 'au-pv' }, body));
    // Keep keyboard focus on the flow: the new primary action (or the YOU token when it is time to move).
    const a = document.activeElement;
    const lost = !a || a === document.body || layout.panel.actions.contains(a) || layout.panel.feedback.contains(a);
    layout.panel.actions.replaceChildren(...actions);
    if (lost && pv.focused !== pv.phase) {
      pv.focused = pv.phase;
      if (pv.phase === 'decide') board.el.querySelector('.token.is-learner')?.focus({ preventScroll: true });
      else if (!['cue', 'full', 'continue'].includes(pv.phase)) actions[0]?.focus({ preventScroll: true });
    }
    tabPanel.replaceChildren();

    const fbHost = layout.panel.feedback;
    if (pv.phase === 'cue' || pv.phase === 'full' || pv.phase === 'continue') {
      const mc = (d.misconceptions ?? []).find((m) => inRegion(pv.spot, m.region));
      const misconception = mc ? { standard: mc.text, kid: mc.textKid || mc.text } : null;
      if (revealMod?.createFeedbackPanel) {
        if (!reveal) { fbHost.replaceChildren(); reveal = revealMod.createFeedbackPanel(fbHost, { app }); }
        if (pv.phase === 'cue' && pv.shown !== 'cue') { reveal.showCue(pv.judgement, { onReveal: previewFull }); pv.shown = 'cue'; }
        if (pv.phase === 'full' && pv.shown !== 'full') {
          reveal.showFull(pv.judgement, { takeaway: d.takeaway, misconception, principleLinks: false, onReplay: previewContinue, replayLabel: 'Play on', onNext: previewWatch, nextLabel: 'Try again' });
          pv.shown = 'full';
        }
      } else {
        // Fallback when js/ui/reveal.js is unavailable: the essentials as text.
        const fb = pv.judgement.feedback;
        fbHost.replaceChildren(el('div', { class: 'au-pv-fallback' }, [
          el('p', { class: 'au-trial-score' }, [el('span', { class: 'au-trial-num', text: String(fb.score) }), el('span', { class: `au-grade au-grade--${fb.grade}`, text: fb.grade }), el('span', { text: fb.headline })]),
          pv.phase === 'cue' && fb.cue ? el('p', { text: fb.cue.text }) : null,
          pv.phase === 'cue' ? button('Show me', { variant: 'primary', onClick: previewFull }) : null,
          pv.phase !== 'cue' ? el('ul', { class: 'au-bullets' }, fb.reasons.map((r) => el('li', { text: r.text }))) : null,
          pv.phase !== 'cue' && fb.fix ? el('p', {}, [el('strong', { text: 'Fix: ' }), fb.fix.text]) : null,
          pv.phase !== 'cue' ? el('div', { class: 'au-row au-row--buttons' }, [button('Play on', { onClick: previewContinue }), button('Try again', { variant: 'primary', onClick: previewWatch })]) : null,
        ]));
      }
    } else {
      reveal?.destroy();
      reveal = null;
      fbHost.replaceChildren();
    }
  }

  // ---- keyboard: Space plays, Ctrl/Cmd+Z undoes, Escape cancels a tool or the preview
  function onKeyDown(e) {
    const tgt = e.target;
    const typing = tgt instanceof HTMLElement && (tgt.isContentEditable || ['TEXTAREA', 'SELECT'].includes(tgt.tagName) || (tgt.tagName === 'INPUT' && tgt.type !== 'range' && tgt.type !== 'checkbox' && tgt.type !== 'radio'));
    if (e.key === 'Escape') {
      if (state.tool) { e.preventDefault(); cancelTool(); return; }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      if (typing || state.preview || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) redo(); else undo();
      return;
    }
    if (e.key === ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const interactive = typing || tgt.closest?.('button, a, [role="button"], [role="tab"], summary, label');
      if (interactive || state.preview) return;
      e.preventDefault();
      togglePlay();
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // Wording changes re-phrase the trial feedback and the preview.
  const offSettings = app.onSettings?.(() => invalidate('panel'));
  const onHide = () => saveNow();
  window.addEventListener('pagehide', onHide);
  const onResize = () => board.setOrientation(orientationFor(window.innerWidth, window.innerHeight));
  window.addEventListener('resize', onResize);

  // ---- go
  runAnalysis();
  setTime(valid() ? analysis().t : 0);
  enableEditingDrag();
  invalidate();
  if (notice) toast(notice.text, { tone: notice.tone, timeout: 5000 });
  if (!saved || paramId) saveNow();

  return () => {
    saveNow();
    clearTimeout(analyseTimer);
    cancelAnimationFrame(raf);
    cancelAnimationFrame(playRaf);
    state.playing = false;
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('resize', onResize);
    offSettings?.();
    reveal?.destroy();
    fileInput.remove();
    board.destroy();
    layout.destroy();
  };
}
