// Player mode: "Find your spot" (docs/KID_REDESIGN.md §4.1 step 3, §4.3, §4.5).
//
//   #/play            the next node on the Road (road.js nextNode)
//   #/play/<nodeId>   that node (a locked or unknown node plays the next one instead: never a dead end)
//   #/play/first      the first set: 3 easy reps for your position. Rep 1 is a worked example (a hand drags YOU to
//                     the best spot, YOU snaps back, "Your turn"), rep 2 has the glow aid, rep 3 none. Then Full time,
//                     then #/kickoff/kit.
//
// A set is 5 reps from road.js buildSet (a 'pass' node goes to #/pass). One rep, about 20 s:
//   set     the role card over the pitch ("You're the left back"; "Now you're the striker" when the position is not
//           your own) while YOU pulses
//   watch   play runs to the freeze; YOU stand where you started (caught watching); only YOU, the ball and up to 4
//           key players are lit, the rest at 40 % (board.setSpotlight); the brief is the one line
//   freeze  the whistle; the question (12 words or fewer)
//   move    drag YOU, tap YOU then a spot, or just tap a spot; "Watch again"; the glow aid on early reps
//   lock    "Lock it" (or Enter); no confidence step
//   reveal  the best-spot ring and an arrow from your spot on the pitch; stars, one word and one line
//           (js/ui/player/reveal.js); Next · Why? · Try again (0-1 stars: the mirrored twin) · See what happens
// After a miss, once a set: "Hard one. Pros miss it too." (R20). Stars come from the score (rewards.js starsForScore);
// letters, "/100", codes and metres never show.
//
// Each counted rep updates Elo, the history and the streaks exactly as a Coach-mode drill does (js/ui/modes/drill.js),
// and awards the rep and any sticker its mastery earned (celebrate: false: Full time shows them). The set ends with
// road.recordSet and showFullTime. Worked-example and glow-aided reps teach; they skip Elo (and, in the first set,
// which is the tutorial, the XP too: R28).
//
// Pure helpers (exported for tests/player-play.test.js) come first; nothing touches the DOM at import time.

import { el, button, icon, notice, linkButton, announce } from '../components.js';
import { BALL_ID } from '../board.js';
import { frameAt, learnerBaseAt, timing } from '../../engine/timeline.js';
import { normalizeScenario, mirrorScenario, validateScenario, learnerId as learnerIdOf } from '../../engine/scenario.js';
import { buildContext } from '../../engine/context.js';
import { computeGhost } from '../../engine/ghost.js';
import { toleranceFor } from '../../engine/score.js';
import { judgeSpot } from '../../engine/analyse.js';
import { explain } from '../../engine/explain.js';
import { update as eloUpdate, mastery } from '../../engine/elo.js';
import { ROLE_INFO, familyOf } from '../../engine/roles.js';
import { dist } from '../../engine/geometry.js';
import * as Rewards from '../../rewards.js';
import { award, loadRewards, mergeGains, emptyGains } from '../rewards-store.js';
import { reducedMotion } from '../celebrate.js';
import * as S from '../session.js';
import { createPlayerReveal } from './reveal.js';
import { showFullTime } from './fulltime.js';
import { STRINGS as SHARED, roleCard, starWord } from './strings.js';

export const PLAY_DEFAULTS = Object.freeze({
  setReps: 5, // [S] §3: a set is 5 reps
  firstReps: 3, // [S] §4.1: the first set is 3 easy reps
  roleCardMs: 1300, // [S] §4.3 step 1: the role card shows for about 1 s...
  roleChangedMs: 2300, // [D] ...longer when the position changed ("Now you're the striker")
  exampleDelayMs: 700, // [D] the worked example's hand starts this long after the freeze
  glowReps: 2, // [D] the first time through a node, its first reps have the glow aid (faded after: R15)
  keyPlayers: 4, // [S] §4.3 step 2: up to 4 key players lit
  maxFrameDt: 1, // [D] s of play per animation frame at most: slow or throttled frames keep real time (a tab coming back
  //               from hidden restarts the clock instead, so it never jumps to the freeze)
  minContinuation: 0.5, // [D] s: a shorter continuation replays the lead-up instead
  replayLead: 3, // [D] s of lead-up replayed then
  replayHoldMs: 700, // [D] the last replay frame holds this long before the answer comes back
  focusStep: 0.5, // [D] s between the frames sampled for the pitch length a rep keeps in view on a phone
  labelClear: 3.5, // [D] metres (times the board's token scale): nearer than this to the ring, "Best spot" is not written over YOU
  questionMaxWords: 12, // [S] R2
  briefMaxWords: 12, // [S] R2
  lineMaxWords: 14, // [S] R2
  maxRepMs: 3 * 60 * 1000, // [D] one rep counts at most this much play time (a tab left open is not play)
  starsAt: Object.freeze([55, 75, 90]), // [S] §6.3 starsForScore: 1, 2 and 3 stars (used if rewards.js lacks it)
});

export const STRINGS = Object.freeze({
  question: SHARED.question,
  watch: 'Watch the play.',
  lockIt: SHARED.lockIt,
  watchAgain: SHARED.watchAgain,
  tapHint: 'Drag YOU, or tap where you want to go.',
  armedHint: 'Now tap a spot.',
  keysHint: 'Arrow keys move YOU. Enter locks it.',
  watchThis: 'Watch this.',
  yourTurnHint: 'Your turn: drag YOU, or tap a spot.',
  ringIsBest: 'The ring is the best spot. Move YOU there.',
  glowHint: 'Your ring gets hot near the best spot.',
  missNote: SHARED.missNote,
  lineBest: 'That is the best spot.',
  lineFix: 'Follow the arrow to the best spot.',
  bestSpot: SHARED.bestSpot,
  seeWhat: SHARED.seeWhat,
  stop: SHARED.stop,
  playOf: (i, n) => `Play ${i} of ${n}`,
  loading: SHARED.loading,
  emptyTitle: 'No plays here yet',
  emptyText: 'Try the next one on the Road.',
  failedTitle: 'Something went wrong',
  failedText: 'Go home and try again.',
  home: SHARED.home,
  next: SHARED.next,
});

// ---------------------------------------------------------------- pure helpers

const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
const METRES = /\d\s?m\b|\bmetres?\b|\bmeters?\b/i;
const CODES = /\b[A-Z]{1,2}\d{1,2}\b|#\d/;
const GRADE = /\b[SABCDF]\b(?!['’])|\/\s?100/;

/** Can this text be shown in Player mode as it is: a sentence of at most `max` words, with no metres, codes or grades? */
export function usableText(s, max = PLAY_DEFAULTS.lineMaxWords) {
  if (typeof s !== 'string' || !s.trim()) return false;
  return words(s) <= max && !METRES.test(s) && !CODES.test(s) && !GRADE.test(s);
}

/** Stars for a score (§6.3): rewards.js starsForScore when it exists, else 3 at 90, 2 at 75, 1 at 55. */
export function starsForScore(score) {
  if (typeof Rewards.starsForScore === 'function') {
    const n = Rewards.starsForScore(score);
    if (Number.isFinite(n)) return Math.max(0, Math.min(3, Math.round(n)));
  }
  const [one, two, three] = PLAY_DEFAULTS.starsAt;
  const s = Number(score);
  return !Number.isFinite(s) ? 0 : s >= three ? 3 : s >= two ? 2 : s >= one ? 1 : 0;
}

/** The word for 0-3 stars (§6.3): rewards.js wordForStars when it exists, else strings.js. */
export function wordForStars(stars) {
  if (typeof Rewards.wordForStars === 'function') {
    const w = Rewards.wordForStars(stars);
    if (typeof w === 'string' && w) return w;
  }
  return starWord(stars);
}

/** The question at the freeze: the scenario's simple one when it fits (≤ 12 words, no codes), else the default. */
export function questionFor(scenario) {
  const q = scenario?.questionKid;
  return usableText(q, PLAY_DEFAULTS.questionMaxWords) ? q.trim() : STRINGS.question;
}

/** The one line while the play runs: the scenario's simple brief when it fits, else "Watch the play." */
export function briefFor(scenario) {
  const b = scenario?.briefKid;
  return usableText(b, PLAY_DEFAULTS.briefMaxWords) ? b.trim() : STRINGS.watch;
}

/**
 * The reveal's one line (≤ 14 words, simple wording, no metres or codes): after a miss the drill's own note on the
 * mistake if you made it (the misconception), else the top reason; a 3-star spot gets the praise. Fallbacks:
 * "That is the best spot." / "Follow the arrow to the best spot."
 * @param {{ feedback?: object, misconception?: string|null, stars: number }} m  feedback: judgeSpot's, in kid wording
 */
export function pickLine({ feedback = null, misconception = null, stars = 0 } = {}) {
  const ok = (s) => usableText(s, PLAY_DEFAULTS.lineMaxWords);
  if (stars >= 3) return [...(feedback?.praise ?? [])].find(ok) ?? STRINGS.lineBest;
  const candidates = [stars <= 1 ? misconception : null, ...(feedback?.reasons ?? []).map((r) => r?.text)];
  return candidates.find(ok) ?? STRINGS.lineFix;
}

/**
 * The Why? sheet (§4.3 step 7): the idea's simple name and summary, up to 2 more reasons (not the line again) and
 * what you did right. reveal.js whyModel trims it to 60 words.
 * @param {{ principle?: object, reasons?: {text:string}[]|string[], praise?: string[], line?: string, takeaway?: string }} m
 */
export function whyFor({ principle = null, reasons = [], praise = [], line = '', takeaway = '' } = {}) {
  const ok = (s) => usableText(s, 20);
  const title = (typeof principle?.kidName === 'string' && principle.kidName) || principle?.short || '';
  const summary = [typeof principle?.summary === 'string' ? principle.summary : principle?.summary?.kid, takeaway].find(ok) ?? '';
  const texts = (reasons ?? []).map((r) => (typeof r === 'string' ? r : r?.text)).filter((t) => ok(t) && t !== line);
  return { title, summary, reasons: texts.slice(0, 2), praise: (praise ?? []).filter(ok).slice(0, 2) };
}

/**
 * The players lit during Watch and Decide (§4.3 step 2): the ball carrier at the freeze, the player the lesson is about
 * (the cue of your start spot), your mark, the teammate on the ball's side of the play, the scripted players; never YOU
 * (always lit), at most `max`.
 */
export function keyPlayers({ scenario = null, freezeFrame = null, ctx = null, cue = null, learnerId = null, max = PLAY_DEFAULTS.keyPlayers } = {}) {
  const ids = [];
  const add = (id) => { if (typeof id === 'string' && id && id !== learnerId && id !== BALL_ID && !ids.includes(id)) ids.push(id); };
  add(freezeFrame?.carrierId);
  if (cue?.type === 'player') add(cue.id);
  add(ctx?.markTarget?.id);
  add(ctx?.firstDefender?.id);
  for (const k of scenario?.timeline?.carrier ?? []) add(k?.id);
  for (const o of scenario?.timeline?.players?.overrides ?? []) add(o?.id);
  add(ctx?.dangerousAttacker?.id);
  return ids.slice(0, Math.max(0, max));
}

/** The first set's plan for rep i (§4.1): rep 1 a worked example (with the glow), rep 2 the glow, rep 3 on its own. */
export function firstSetStep(i) {
  return { example: i === 0, aid: i <= 1 ? 'glow' : null, counts: i >= 2 };
}

/** A normal set's plan for rep i: the glow aid on the first reps the first time through a node, else nothing. */
export function setStep(i, { nodePlays = 0, nodeStars = 0 } = {}, P = PLAY_DEFAULTS) {
  const glow = nodePlays === 0 && nodeStars === 0 && i < P.glowReps;
  return { example: false, aid: glow ? 'glow' : null, counts: true };
}

/** The set's tally (pure): each slot keeps its best stars, a retry (the mirrored twin) can only raise it. */
export const createTally = (n) => ({ slots: Array.from({ length: Math.max(0, n) }, () => null), missNoted: false });
export function tallyTry(tally, { slot, stars }) {
  const slots = [...tally.slots];
  const s = Math.max(0, Math.min(3, Math.round(Number(stars)) || 0));
  if (slot >= 0 && slot < slots.length) slots[slot] = slots[slot] === null ? s : Math.max(slots[slot], s);
  return { ...tally, slots };
}
/** The stars of each played slot, for road.recordSet (a slot never played is left out). */
export const tallyStars = (tally) => tally.slots.filter((s) => s !== null);

/** "Hard one. Pros miss it too." after a miss (0-1 stars), once a set (R20). @returns {{ note: string, tally }} */
export function missNote(tally, stars) {
  if (stars > 1 || tally.missNoted) return { note: '', tally };
  return { note: STRINGS.missNote, tally: { ...tally, missNoted: true } };
}

/** A rep's name for Full time's "Best move": its main idea's simple name, else its simple title. */
export function repTitle(scenario, principles = {}) {
  const p = principles?.[scenario?.principles?.[0]];
  return (typeof p?.kidName === 'string' && p.kidName) || scenario?.titleKid || scenario?.title || '';
}

/** A deterministic seed for a node's nth play. */
export function seedFor(key, n = 0) {
  let h = 2166136261;
  for (const c of `${key}:${n}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The scenario id Elo and the rewards keep a record under: the original of a mirror; one per idea and position family
 *  for generated drills (each generated drill is new, so a record per drill would only grow). */
export function recordIdOf(s) {
  if (s?.source?.kind === 'generated') return `gen-${s.principles?.[0] ?? 'x'}-${familyOf(s.learner?.role) ?? 'x'}`;
  return String(s?.mirrorOf ?? s?.id ?? '').replace(/-m$/, '');
}

// ---------------------------------------------------------------- the app (browser only below)

const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

const tryImport = async (url) => {
  try { return await import(url); } catch (err) { console.warn(`[fotbol] play: ${url} is not available`, err); return null; }
};

/** The Road (data/road.json): the app's copy, else road.js's loader, else the file. */
async function getRoad(app, roadMod) {
  if (app?.data?.road) return app.data.road;
  for (const fn of ['loadRoad', 'getRoad']) {
    if (typeof roadMod?.[fn] === 'function') {
      try { const r = await roadMod[fn](app); if (r) return r; } catch { /* next */ }
    }
  }
  try {
    const res = await fetch(new URL('../../../data/road.json', import.meta.url));
    if (res.ok) return await res.json();
  } catch { /* no road */ }
  return null;
}

const roadNodesOf = (road) => (road?.chapters ?? []).flatMap((c) => c.nodes ?? []);

/** Mode contract (ARCHITECTURE §5.9). @returns {Promise<() => void>} unmount */
export async function mount(root, app, params = []) {
  const P = PLAY_DEFAULTS;
  const first = String(params[0] ?? '').toLowerCase() === 'first';
  const formations = app.data?.formations;
  const principles = app.data?.principles?.byId ?? {};
  const store = app.store;
  let alive = true;
  const cleanups = [];
  root.classList.add('pl-view');
  root.replaceChildren(el('div', { class: 'pl-loading', role: 'status' }, [el('p', { text: STRINGS.loading })]));

  const roadMod = await tryImport('./road.js');
  const roadData = await getRoad(app, roadMod);
  if (!root.isConnected) return () => { alive = false; };
  let profile = null;
  try { profile = roadMod?.loadProfile?.(app) ?? null; } catch { profile = null; }
  const myRole = profile?.role ?? app.settings?.role ?? 'LB';

  // ---- what to play
  let node = null;
  const want = !first && params[0] ? String(params[0]) : null;
  if (want && roadData) {
    try { node = roadMod?.nodeById?.(roadData, want) ?? roadNodesOf(roadData).find((n) => n.id === want) ?? null; } catch { node = null; }
    let open = true;
    try { open = node && typeof roadMod?.isUnlocked === 'function' ? roadMod.isUnlocked(roadData, profile, node.id) : !!node; } catch { open = !!node; }
    if (!open) node = null;
  }
  if (!node && roadData) {
    try { node = roadMod?.nextNode?.(roadData, profile) ?? null; } catch { node = null; }
    if (!node) node = roadNodesOf(roadData)[0] ?? null;
    if (!first && want && node) { try { history.replaceState(null, '', `#/play/${encodeURIComponent(node.id)}`); } catch { /* keep */ } }
  }
  let kind = node?.kind ?? 'spot';
  try { if (node && typeof roadMod?.repKind === 'function') kind = roadMod.repKind(roadData, node); } catch { /* the node's own kind */ }
  if (!first && kind === 'pass') { app.navigate(`#/pass/${encodeURIComponent(node.id)}`); return () => { alive = false; }; }

  const nodeRec = node ? profile?.road?.[node.id] ?? {} : {};
  const nodePlays = Number(nodeRec.plays) || 0;
  const nodeStarsBefore = Number(nodeRec.stars) || 0;
  const count = first ? P.firstReps : P.setReps;

  let reps = [];
  try { reps = await buildReps(); } catch (err) { console.error('[fotbol] play: could not build the set', err); reps = []; }
  if (!alive || !root.isConnected) return () => { alive = false; };
  if (!reps.length) {
    root.replaceChildren(notice({ title: STRINGS.emptyTitle, text: STRINGS.emptyText, actions: [linkButton(STRINGS.home, '#/', { variant: 'primary', icon: 'arrow' })] }));
    return () => { alive = false; };
  }

  /** The set's reps: road.js buildSet (spot reps only here); the first set takes the easiest few. */
  async function buildReps() {
    const seed = first ? seedFor(`first-${myRole}`) : seedFor(node?.id ?? 'play', nodePlays);
    const ctx = {
      road: roadData, profile, index: app.data?.scenarios?.index ?? [], scenarios: app.data?.scenarios,
      catalogue: app.data?.principles, // data/principles.json: the generated drills' names and takeaways
      rewards: loadRewards(app), skills: S.loadSkills(store), seed, formations, app, first,
    };
    let list = [];
    try {
      if (first && typeof roadMod?.buildFirstSet === 'function') list = (await roadMod.buildFirstSet({ ...ctx, count })) ?? [];
      else if (node && typeof roadMod?.buildSet === 'function') list = (await roadMod.buildSet(node, ctx)) ?? [];
    } catch (err) { console.warn('[fotbol] play: road.js could not build the set', err); list = []; }
    let spot = list.filter((r) => r?.kind === 'spot' && r.scenario).map((r) => r.scenario);
    if (!spot.length) spot = await fallbackScenarios({ count: first ? 8 : count, principles: first ? null : node?.principles });
    const ready = spot.map(prepare).filter(Boolean);
    if (first) ready.sort((a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0));
    return ready.slice(0, count);
  }

  /** Without road.js (or with no set from it): authored drills for your position, easiest first, mirrored to your side. */
  async function fallbackScenarios({ count: n, principles: want = null }) {
    let refs = S.candidatesFor({ index: app.data?.scenarios?.index ?? [], role: myRole });
    if (!refs.length) refs = S.candidatesFor({ index: app.data?.scenarios?.index ?? [], role: myRole, anyRole: true });
    if (want?.length) {
      const hit = refs.filter((r) => (r.principles ?? []).some((p) => want.includes(p)));
      if (hit.length) refs = hit;
    }
    refs = [...refs].sort((a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0)).slice(0, n);
    const out = [];
    for (const ref of refs) {
      try {
        const raw = await app.data.scenarios.load(ref.file ?? ref.baseId);
        const s = normalizeScenario(raw);
        out.push(ref.mirror ? mirrorScenario(s) : s);
      } catch (err) { console.warn('[fotbol] play: could not load', ref.baseId, err); }
    }
    return out;
  }

  /** A scenario ready to play (normalised and valid), or null. */
  function prepare(raw) {
    try {
      const s = normalizeScenario(raw);
      const errors = validateScenario(s, { principles });
      if (errors.length) { console.warn(`[fotbol] play: ${s.id} is not valid`, errors); return null; }
      return s;
    } catch (err) {
      console.warn('[fotbol] play: bad scenario', err);
      return null;
    }
  }

  // ---- the stage
  const els = {};
  els.quit = el('a', { class: 'btn btn--ghost btn--icon pl-quit', href: '#/', 'aria-label': STRINGS.stop, title: STRINGS.stop }, [icon('close')]);
  els.dots = el('ol', { class: 'pl-dots', 'aria-hidden': 'true' }, reps.map(() => el('li')));
  els.where = el('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  els.board = el('div', { class: 'pl-board' });
  els.card = el('div', { class: 'pl-card', hidden: true }, [el('p', { class: 'pl-card-text' })]);
  els.line = el('p', { class: 'pl-line' });
  els.tip = el('p', { class: 'pl-tip', hidden: true });
  els.actions = el('div', { class: 'pl-actions' });
  els.reveal = el('div', { class: 'pl-reveal' });
  const view = el('div', { class: 'pl', dataset: { phase: 'set' } }, [
    el('div', { class: 'pl-top' }, [els.quit, els.dots, els.where]),
    el('div', { class: 'pl-stage' }, [els.board, els.card]),
    el('div', { class: 'pl-dock' }, [els.line, els.tip, els.actions, els.reveal]),
  ]);
  root.replaceChildren(view);
  const kitNumber = loadRewards(app)?.kit?.number ?? null;
  const board = app.createBoard(els.board, { orientation: 'auto', labels: 'number', youNumber: Number.isInteger(kitNumber) ? kitNumber : null });
  board.setOverlays({ thirds: false, lanes: false, zone14: false, offsideLine: null, backLine: null });
  const reveal = createPlayerReveal(els.reveal, { app });

  const set = {
    tally: createTally(reps.length), results: [], gained: emptyGains(), skills: S.loadSkills(store), streak: S.loadStreak?.(store),
    xpBefore: loadRewards(app).xp ?? 0, playedMs: 0, tapHintShown: false, glowHintShown: false,
  };
  let rep = null; // the rep on the pitch
  let raf = 0;
  const clock = { restart: null }; // playRange's clock (visibilitychange restarts it)
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms); timers.add(t); return t; };
  const stopPlayback = () => { cancelAnimationFrame(raf); raf = 0; };
  const stopAll = () => { stopPlayback(); for (const t of timers) clearTimeout(t); timers.clear(); };
  let keysShown = false;
  let ftCleanup = null;

  const setPhase = (p) => { view.dataset.phase = p; if (rep) rep.phase = p; };
  const setActions = (...nodes) => put(els.actions, ...nodes);
  const setTip = (text) => { els.tip.textContent = text ?? ''; els.tip.hidden = !text; };
  const frameWithSpot = (frame, spot) => ({ ...frame, players: frame.players.map((p) => (p.id === rep.learnerId ? { ...p, x: spot.x, y: spot.y } : p)) });
  const pictureAt = (t, spot) => frameWithSpot(frameAt(rep.s, t, { formations }), spot);
  const draw = (frame) => board.render(frame, { learnerId: rep.learnerId, labels: 'number' });

  function renderDots(i) {
    [...els.dots.children].forEach((li, k) => {
      const done = set.tally.slots[k];
      li.className = [k === i ? 'is-current' : '', done !== null && k !== i ? 'is-done' : ''].filter(Boolean).join(' ');
      li.dataset.stars = done === null ? '' : String(done);
    });
    els.where.textContent = STRINGS.playOf(i + 1, reps.length);
  }

  /** Play [from, to] with the learner shown at `spot`; onEnd at `to`. */
  function playRange({ from, to, spot, onEnd }) {
    stopPlayback();
    let t = from, last = null;
    clock.restart = () => { last = null; }; // back from a hidden tab: carry on from where the play stopped
    const step = (now) => {
      if (!alive || !rep) return;
      if (last !== null) t = Math.min(to, t + Math.min(P.maxFrameDt, (now - last) / 1000));
      last = now;
      draw(pictureAt(t, spot));
      if (t >= to - 1e-9) { raf = 0; onEnd?.(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  /** The pitch length this rep needs in view on a phone held upright (drill.js repFocus). */
  function repFocus(r) {
    const xs = [r.start.x, r.base.x, r.ghost.spot.x];
    for (let t = 0; t < r.duration + P.focusStep; t += P.focusStep) {
      const f = frameAt(r.s, Math.min(t, r.duration), { formations });
      xs.push(f.ball.x);
      for (const p of f.players) if (p.role !== 'GK') xs.push(p.x);
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs) };
  }

  /** Everything the rep needs up front: timing, your start, the judging scene at the freeze (ARCHITECTURE §5.3). */
  function makeRep(s, { slot, plan, retry }) {
    const { duration, freezeAt } = timing(s);
    const learnerId = learnerIdOf(s);
    const probe = frameAt(s, 0, { formations });
    const auto = probe.players.find((p) => p.id === learnerId);
    const start = s.learner.start ? { ...s.learner.start } : { x: auto.x, y: auto.y };
    const freezeFrame = frameAt(s, freezeAt, { formations });
    const base = learnerBaseAt(s, freezeAt, { formations });
    const ctx = buildContext(frameWithSpotOf(freezeFrame, learnerId, start), { learnerId, base });
    const authored = s.answer?.mode === 'authored' && s.answer.ideal;
    const ghost = computeGhost(ctx, { base: authored ? s.answer.ideal : base, tol: toleranceFor(s.learner.role, s.answer?.tol) });
    const r = { s, slot, plan, retry, duration, freezeAt, learnerId, start, spot: { ...start }, freezeFrame, base, ctx, ghost, phase: 'set', t0: performance.now() };
    const cue = judgeSpot({ ctx, ghost }, start, { wording: 'kid', principles }).feedback.cue?.highlight ?? null;
    r.key = keyPlayers({ scenario: s, freezeFrame, ctx, cue, learnerId });
    r.focus = repFocus(r);
    return r;
  }
  const frameWithSpotOf = (frame, id, spot) => ({ ...frame, players: frame.players.map((p) => (p.id === id ? { ...p, x: spot.x, y: spot.y } : p)) });

  // ---- one rep: resolves with 'next' or 'retry'
  function playRep(s, { slot, plan, retry = false }) {
    return new Promise((resolve) => {
      try { rep = makeRep(s, { slot, plan, retry }); } catch (err) {
        console.warn(`[fotbol] play: ${s?.id} could not be set up, skipped`, err); // a broken drill never stops the set
        resolve('skip');
        return;
      }
      rep.resolve = resolve;
      board.disableDrag();
      board.setAid(null);
      board.setGhost(null);
      board.setZone(null);
      board.setHeatmap(null);
      board.setMarkers([]);
      board.setFocus(rep.focus);
      board.setSpotlight([rep.learnerId, ...rep.key]);
      reveal.clear();
      renderDots(slot);
      showRoleCard();
    });
  }

  function showRoleCard() {
    setPhase('set');
    const card = roleCard(rep.s.learner.role, myRole);
    draw(pictureAt(0, rep.start));
    board.setMarkers([{ type: 'ring', id: rep.learnerId, tone: card.changed ? 'cue' : 'info', pulse: true }]);
    els.card.querySelector('.pl-card-text').textContent = card.text;
    els.card.hidden = false;
    els.card.classList.toggle('is-changed', card.changed);
    view.classList.toggle('is-role-change', card.changed);
    put(els.line);
    setTip('');
    setActions();
    announce(card.text);
    let gone = false;
    const go = () => { if (gone || !alive || rep?.phase !== 'set') return; gone = true; els.card.hidden = true; view.classList.remove('is-role-change'); showWatch(); };
    els.card.onclick = go;
    later(go, card.changed ? P.roleChangedMs : P.roleCardMs);
  }

  function showWatch({ keepSpot = false } = {}) {
    setPhase('watch');
    const saved = keepSpot ? { ...rep.spot } : null;
    board.disableDrag();
    board.setAid(null);
    board.setMarkers([]);
    els.line.textContent = briefFor(rep.s);
    setTip('');
    setActions();
    playRange({
      from: 0, to: rep.freezeAt, spot: rep.start,
      onEnd: () => {
        app.sound?.play('whistle'); // the referee's whistle: play freezes here
        showFreeze(saved);
      },
    });
  }

  function showFreeze(savedSpot = null) {
    setPhase('freeze');
    const q = questionFor(rep.s);
    els.line.textContent = q;
    announce(q);
    rep.spot = savedSpot ?? { ...rep.start };
    draw(frameWithSpot(rep.freezeFrame, rep.spot));
    if (rep.plan.example && !savedSpot && !rep.exampled) {
      rep.exampled = true;
      showExample();
      return;
    }
    showPlace();
  }

  /**
   * The worked example (first set, rep 1): the hand drags YOU to the best spot and YOU snaps back, then "Your turn".
   * Under reduced motion it is still: the ring, an arrow and "Best spot" show where to go while YOU can already be moved
   * (no extra tap: the first drag still comes 2 taps after the first open), and they clear at the first move.
   */
  function showExample() {
    setPhase('example');
    setTip(STRINGS.watchThis);
    setActions();
    if (reducedMotion(app)) {
      board.setGhost(rep.ghost.spot);
      board.setMarkers([
        { type: 'arrow', from: rep.start, to: rep.ghost.spot, tone: 'fix' },
        { type: 'label', at: rep.ghost.spot, text: STRINGS.bestSpot, tone: 'good', lift: 'token' },
      ]);
      showPlace({ example: true });
      return;
    }
    later(async () => {
      await board.showHintHand({ from: rep.start, to: rep.ghost.spot });
      if (!alive || rep?.phase !== 'example') return;
      showPlace({ turn: true });
    }, P.exampleDelayMs);
  }

  /** Decide: move YOU and lock it. `example`: the still worked example's ring and arrow stay until the first move. */
  function showPlace({ turn = false, example = false } = {}) {
    setPhase('place');
    if (rep.plan.aid === 'glow') board.setAid({ kind: 'glow', target: rep.ghost.spot });
    setTip(example ? STRINGS.ringIsBest : placeTip({ turn }));
    if (example) set.tapHintShown = true;
    let shown = example; // the example's ring and arrow on the pitch
    const moved = () => {
      if (!shown) return;
      shown = false;
      board.setGhost(null);
      board.setMarkers([]);
    };
    const lock = button(STRINGS.lockIt, { variant: 'primary', icon: 'check', className: 'pl-main pl-lock', onClick: lockIn });
    setActions(button(STRINGS.watchAgain, { icon: 'play', className: 'pl-again', onClick: () => { moved(); showWatch({ keepSpot: true }); } }), lock);
    board.enableDrag({
      ids: [rep.learnerId], tapToMove: rep.learnerId,
      onMove: (_id, p) => { if (rep?.phase !== 'place') return; moved(); rep.spot = { x: p.x, y: p.y }; draw(frameWithSpot(rep.freezeFrame, rep.spot)); },
      onEnd: (_id, p) => {
        if (rep?.phase !== 'place') return;
        moved();
        rep.spot = { x: p.x, y: p.y };
        draw(frameWithSpot(rep.freezeFrame, rep.spot));
        keepInView(rep.spot);
        if (els.tip.textContent === STRINGS.armedHint || els.tip.textContent === STRINGS.ringIsBest) setTip(''); // done with once you moved
      },
      onArm: (id) => {
        if (rep?.phase !== 'place') return;
        if (id) setTip(STRINGS.armedHint);
        else if (els.tip.textContent === STRINGS.armedHint) setTip('');
      },
    });
    const token = board.el.querySelector(`.token[data-id="${rep.learnerId}"]`);
    if (lastKey && token) token.focus({ preventScroll: true }); else lock.focus({ preventScroll: true });
  }

  /** One short tip at most while you decide (R7, R14): "Your turn" after the worked example, the glow the first time it
   *  is on, how to move on the set's first rep, the keys once a key was pressed. */
  function placeTip({ turn = false } = {}) {
    if (turn) { set.tapHintShown = true; return STRINGS.yourTurnHint; }
    if (rep.plan.aid === 'glow' && !set.glowHintShown) { set.glowHintShown = true; return STRINGS.glowHint; }
    if (!set.tapHintShown) { set.tapHintShown = true; return STRINGS.tapHint; }
    return keysShown ? STRINGS.keysHint : '';
  }

  function keepInView(...spots) {
    const xs = spots.filter((p) => Number.isFinite(p?.x)).map((p) => p.x);
    board.setFocus({ x0: Math.min(rep.focus.x0, ...xs), x1: Math.max(rep.focus.x1, ...xs) });
  }

  // ---- lock in, judge, record
  function lockIn() {
    if (rep?.phase !== 'place') return;
    setPhase('judged');
    board.disableDrag();
    board.setAid(null);
    const s = rep.s;
    const judgement = judgeSpot({ ctx: rep.ctx, ghost: rep.ghost }, rep.spot, { wording: 'kid', principles });
    const more = explain(judgement.result, rep.ctx, rep.spot, { wording: 'kid', max: 3, principles, ghost: { spot: rep.ghost.spot, result: rep.ghost.result } });
    const mc = S.misconceptionAt(s, rep.spot);
    const misText = mc ? S.wordingOf(mc.text, 'kid', mc.textKid) : null;
    const stars = starsForScore(judgement.result.score);
    rep.judged = { judgement, stars, misText, more };
    const counts = rep.plan.counts;
    const aided = !!rep.plan.aid || rep.plan.example;
    record({ judgement, counts, aided, misId: mc?.id ?? null });
    set.tally = tallyTry(set.tally, { slot: rep.slot, stars });
    const prev = set.results[rep.slot];
    if (!prev || stars >= prev.stars) set.results[rep.slot] = { stars, title: repTitle(s, principles) };
    showReveal();
  }

  /** Elo, streaks and history exactly as a drill rep (drill.js lockIn), then the rep's rewards (drill.js rewardRep). */
  function record({ judgement, counts, aided, misId }) {
    const s = rep.s, r = judgement.result;
    const id = recordIdOf(s);
    try {
      if (!aided) {
        set.skills = eloUpdate(set.skills, { itemId: id, principles: s.principles, role: s.learner.role, score01: r.score / 100, prior: Number.isFinite(s.difficulty) ? s.difficulty : 0 });
        S.saveSkills(store, set.skills);
      }
      if (counts && typeof S.updateStreak === 'function' && set.streak) {
        set.streak = S.updateStreak(set.streak, { day: S.dayKey(new Date()), score: r.score });
        S.saveStreak?.(store, set.streak);
      }
      if (counts || !first) {
        S.appendHistory(store, {
          t: Date.now(), mode: 'drill', via: 'play', id: s.id, baseId: id, title: s.title ?? '', module: s.module ?? null,
          principles: s.principles ?? [], role: s.learner.role, score: r.score, grade: r.grade,
          dist: Math.round(dist(rep.spot, rep.ghost.spot) * 10) / 10, ms: Math.round(performance.now() - rep.t0), confidence: null,
          misconception: misId, mirrored: !!s.mirrorOf || /-m$/.test(String(s.id)), reasons: judgement.feedback.reasons.map((x) => x.ruleId),
          nodeId: first ? 'first' : node?.id ?? null, aid: rep.plan.example ? 'example' : rep.plan.aid ?? null,
        });
      }
    } catch (err) { console.warn('[fotbol] play: could not save the rep', err); }
    if (!counts) return; // the first set's taught reps are the tutorial: no XP (R28)
    let gained = award(app, { type: 'rep', scenarioId: id, role: s.learner.role, grade: r.grade, score: r.score, stars: starsForScore(r.score) }, { celebrate: false });
    for (const pid of s.principles ?? []) {
      const m = mastery(set.skills, pid);
      const tier = typeof Rewards.cardTier === 'function' ? Rewards.cardTier(loadRewards(app), pid) : 0;
      if (m > tier) gained = mergeGains(gained, award(app, { type: 'mastery', principleId: pid, stars: m }, { celebrate: false }));
    }
    set.gained = mergeGains(set.gained, gained);
  }

  // ---- the reveal
  function drawAnswer() {
    const { judgement, stars } = rep.judged;
    draw(frameWithSpot(rep.freezeFrame, rep.spot));
    board.setGhost(rep.ghost.spot);
    const marks = [];
    const off = dist(rep.spot, rep.ghost.spot);
    if (off >= 1) marks.push({ type: 'arrow', from: rep.spot, to: rep.ghost.spot, tone: 'fix' });
    // The ring's label, unless YOU stand on the ring (YOUR tag is there, and the stars say it).
    if (off >= P.labelClear * board.tokenScale) marks.push({ type: 'label', at: rep.ghost.spot, text: STRINGS.bestSpot, tone: 'good', lift: 'token' });
    const hl = judgement.feedback.cue?.highlight;
    if (hl && stars < 3) marks.push({ ...hl, tone: 'cue', pulse: false });
    board.setMarkers(marks);
    if (hl?.type === 'player') board.setSpotlight([rep.learnerId, ...rep.key, hl.id]);
    keepInView(rep.spot, rep.ghost.spot);
  }

  function showReveal() {
    setPhase('reveal');
    const s = rep.s;
    const { judgement, stars, misText, more } = rep.judged;
    drawAnswer();
    put(els.line);
    setTip('');
    setActions();
    const line = pickLine({ feedback: judgement.feedback, misconception: misText, stars });
    const takeaway = S.wordingOf(s.takeaway, 'kid');
    // Why? explains the line: the idea behind the reason it came from, else the drill's own idea.
    const source = [...(judgement.feedback.reasons ?? []), ...(more.reasons ?? [])].find((r) => r.text === line);
    const principle = principles[source?.principleId] ?? principles[s.principles?.[0]];
    const why = whyFor({ principle, reasons: more.reasons, praise: judgement.feedback.praise, line, takeaway: principle === principles[s.principles?.[0]] ? takeaway : '' });
    const miss = missNote(set.tally, stars);
    set.tally = miss.tally;
    reveal.show({
      stars, word: wordForStars(stars), line, note: miss.note, why,
      onNext: () => done('next'),
      onRetry: stars <= 1 && !rep.retry ? () => done('retry') : null,
      onReplay: () => seeWhatHappens(),
      replayLabel: STRINGS.seeWhat,
    });
  }

  function done(action) {
    if (!rep || rep.phase !== 'reveal') return;
    set.playedMs += Math.min(P.maxRepMs, performance.now() - rep.t0);
    stopAll();
    const resolve = rep.resolve;
    rep.phase = 'done';
    resolve?.(action);
  }

  /** "See what happens": the play runs on from the freeze with you where you stood; the best-spot ring stays. */
  function seeWhatHappens() {
    if (rep?.phase !== 'reveal') return;
    setPhase('replay');
    reveal.setBusy(true);
    board.setMarkers([]);
    board.setGhost(rep.ghost.spot);
    const more = rep.duration - rep.freezeAt >= P.minContinuation;
    const from = more ? rep.freezeAt : Math.max(0, rep.freezeAt - P.replayLead);
    const to = more ? rep.duration : rep.freezeAt;
    playRange({
      from, to, spot: rep.spot,
      onEnd: () => later(() => {
        if (rep?.phase !== 'replay') return;
        setPhase('reveal');
        drawAnswer();
        reveal.setBusy(false);
      }, P.replayHoldMs),
    });
  }

  // ---- the set
  async function runSet() {
    for (let i = 0; i < reps.length && alive; i++) {
      const plan = first ? firstSetStep(i) : setStep(i, { nodePlays, nodeStars: nodeStarsBefore });
      let s = reps[i];
      let action = await playRep(s, { slot: i, plan });
      if (alive && action === 'retry') {
        s = mirrorScenario(s);
        action = await playRep(s, { slot: i, plan: { ...plan, example: false }, retry: true });
      }
    }
    if (alive) finish();
  }

  function finish() {
    stopAll();
    const repStars = tallyStars(set.tally);
    let nodeStars = null;
    if (!first && node && typeof roadMod?.recordSet === 'function') {
      try { nodeStars = roadMod.recordSet(app, node.id, repStars); } catch (err) { console.warn('[fotbol] play: could not record the set', err); }
    }
    teardownStage();
    const again = node ? `#/play/${encodeURIComponent(node.id)}` : '#/play';
    ftCleanup = showFullTime(root, app, {
      node: first ? null : node,
      reps: set.results.filter(Boolean),
      xpBefore: set.xpBefore, xpAfter: loadRewards(app).xp ?? set.xpBefore,
      gained: set.gained, nodeStars, budget: reveal.budget, playedMs: set.playedMs,
      homeLabel: first ? STRINGS.next : undefined,
      onHome: () => app.navigate(first ? '#/kickoff/kit' : '#/'),
      onAgain: first ? null : () => app.navigate(again),
    });
  }

  let stageUp = true;
  function teardownStage() {
    if (!stageUp) return;
    stageUp = false;
    stopAll();
    reveal.destroy();
    board.destroy();
  }

  // ---- keys: Enter locks in (unless a control has focus); the keyboard tip only after a key press
  let lastKey = false;
  const onKey = (e) => {
    lastKey = true;
    if (!rep || e.defaultPrevented) return;
    if (!keysShown && rep.phase === 'place' && /^Arrow|^Tab$/.test(e.key)) {
      keysShown = true;
      setTip(STRINGS.keysHint);
    }
    if (e.key !== 'Enter' || rep.phase !== 'place') return;
    if (e.target?.closest?.('button, a, input, select, textarea, summary, [contenteditable]')) return;
    e.preventDefault();
    lockIn();
  };
  const onPointer = () => { lastKey = false; };
  document.addEventListener('keydown', onKey);
  const onVisible = () => { if (!document.hidden) clock.restart?.(); };
  document.addEventListener('visibilitychange', onVisible);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisible));
  document.addEventListener('pointerdown', onPointer, true);
  cleanups.push(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer, true); });

  runSet().catch((err) => {
    console.error('[fotbol] play: the set stopped', err);
    if (!alive) return;
    teardownStage();
    root.replaceChildren(notice({ title: STRINGS.failedTitle, text: STRINGS.failedText, actions: [linkButton(STRINGS.home, '#/', { variant: 'primary', icon: 'arrow' })] }));
  });

  return () => {
    alive = false;
    stopAll();
    for (const fn of cleanups) { try { fn(); } catch { /* gone */ } }
    try { ftCleanup?.(); } catch { /* gone */ }
    teardownStage();
  };
}
