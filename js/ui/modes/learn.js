// '#/learn': the Learn section.
//   '#/learn'              Module 0, the guided tour of the pitch (data/tutorial.json): observe, drag the
//                          ball, place yourself, tap a player. Progress is saved under the store key 'tutorial'.
//   '#/learn/principles'   the principle library (data/principles.json): search and filter, v1 first
//   '#/learn/p/<ID>'       one principle: summary, why, rule of thumb, common mistake, links, which rules
//                          check it, your mastery stars (store key 'skills', elo.mastery) and "Practise this"
//   '#/learn/resources'    the reading list (data/resources.json): "start here" first, then by level
//
// Tutorial setups feed autoFrame() exactly as ARCHITECTURE §4.1 says: setup.ball, possession, carrierId
// and overrides, with the learner held at learnerStart; the frame is re-placed when the ball is dragged,
// and overlays.offsideLine is computed from the frame (their second-last player).

import { el, button, linkButton, icon, stageLayout, announce, notice, uid } from '../components.js';
import { BALL_ID } from '../board.js';
import { starRating, pickText } from '../reveal.js';
import { autoFrame } from '../../engine/scene.js';
import { createFormation } from '../../engine/formation.js';
import { mastery } from '../../engine/elo.js';
import { RULES_BY_ID } from '../../engine/rules/index.js';
import { ROLE_INFO, FAMILY_LABEL, FAMILIES, playerId, parsePlayerId } from '../../engine/roles.js';
import { MID_Y, clampToPitch } from '../../engine/pitch.js';
import { dist } from '../../engine/geometry.js';
import { orientationFor } from '../session.js';
import { award, earnsRewards } from '../rewards-store.js';

export const LEARN_DEFAULTS = Object.freeze({
  tapRadius: 4, // [D] metres: a tap this close to a player picks them (forgiving on touch)
  attemptMs: 900, // [D] a drag counts as a try once it has rested this long outside the target (keyboard nudges come in bursts)
  carrierKeep: 3, // [D] metres: the authored carrier keeps the ball while it is this close to the start; beyond, the nearest player takes it
  listPlayers: 5, // [D] players offered in the tap-player list (nearest the ball)
});

export const TUTORIAL_KEY = 'tutorial';

// ------------------------------------------------------------------ labels

export const CATEGORY_ORDER = Object.freeze(['foundations', 'out_of_possession', 'in_possession', 'passing', 'transition', 'team_shape', 'role', 'goalkeeper', 'set_piece']);
const CATEGORY_LABEL = {
  standard: {
    foundations: 'Foundations', in_possession: 'In possession', passing: 'Passing', transition: 'Transitions', out_of_possession: 'Out of possession',
    team_shape: 'Team shape', role: 'Role cards', goalkeeper: 'Goalkeeper', set_piece: 'Set pieces',
  },
  kid: {
    foundations: 'The basics', in_possession: 'When we have the ball', passing: 'Where to pass', transition: 'When the ball changes team', out_of_possession: 'When they have the ball',
    team_shape: 'Team shape', role: 'Your position', goalkeeper: 'Goalkeeper', set_piece: 'Free kicks and corners',
  },
};
const LEVEL_LABEL = { standard: { 1: 'Level 1 · Basics', 2: 'Level 2 · Building', 3: 'Level 3 · Advanced' }, kid: { 1: 'Starter', 2: 'Next step', 3: 'Expert' } };
const RESOURCE_GROUPS = Object.freeze(['start-here', 'beginner', 'intermediate', 'advanced', 'video']);
const GROUP_LABEL = {
  standard: { 'start-here': 'Start here', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', video: 'Video' },
  kid: { 'start-here': 'Start here', beginner: 'Easy', intermediate: 'Harder', advanced: 'For experts', video: 'Videos' },
};
const KIND_LABEL = { book: 'Book', website: 'Website', video: 'Video', course: 'Course', curriculum: 'Coaching guide', app: 'App' };
const AUDIENCE_LABEL = { player: 'For players', coach: 'For coaches', both: 'Players and coaches' };

const COPY = {
  standard: {
    tabs: { tutorial: 'Tutorial', principles: 'Principles', resources: 'Reading list' },
    tabsLabel: 'Learn',
    // tutorial
    kicker: 'Module 0 · Tutorial',
    stepsCount: (n) => `${n} short steps, about five minutes.`,
    start: 'Start the tutorial', resume: (n) => `Carry on from step ${n}`, restart: 'Start from the beginning',
    doneBefore: 'You’ve finished this tutorial. Replay any step, or move on to the drills.',
    replay: 'Replay the tutorial',
    stepOf: (i, n) => `Step ${i} of ${n}`,
    back: 'Back', next: 'Next', finish: 'Finish', skip: 'Skip', hint: 'Hint', gotIt: 'Got it',
    task: 'Your task',
    notQuite: 'Not quite yet.',
    showTarget: 'The ring shows where it goes.',
    wrongTeam: 'That’s one of their players. Tap one of ours.',
    wrongPlayer: (name) => `That’s your ${name}.`,
    list: 'Pick from a list instead',
    principles: 'Principles in this step',
    principlesAll: 'Principles you met',
    more: 'More to learn',
    completeKicker: 'Module 0 complete',
    completeTitle: 'You can read the pitch',
    almostKicker: 'Module 0',
    almostTitle: 'Almost there',
    skipped: (n) => `You skipped ${n === 1 ? 'one step' : `${n} steps`}. Finish ${n === 1 ? 'it' : 'them'} to complete the module.`,
    learned: 'What you learned',
    toM1: 'Start Module 1 drills', explore: 'Try Explore',
    onside: 'Onside', offside: 'Offside',
    keys: 'Keyboard: press Tab to reach the ball or your player, then use the arrow keys (hold Shift for bigger steps). Touch: tap a token, then tap where it should go.',
    attack: 'We attack this way', ourGoal: 'Our goal', theirGoal: 'Their goal',
    dot: (i, title, done) => `Step ${i}: ${title}${done ? ', done' : ''}`,
    progress: 'Tutorial steps',
    unavailable: 'The tutorial couldn’t load',
    unavailableText: 'Its data file is missing. You can still browse the principle library.',
    // library
    libTitle: 'Principle library',
    libLead: 'The ideas behind every position. The ones marked “In fotbol now” are the ones fotbol checks when it scores your spot.',
    search: 'Search principles',
    searchPlaceholder: 'Search: cover, offside, width…',
    category: 'Category', level: 'Level', release: 'Availability', all: 'All',
    now: 'In fotbol now', later: 'Coming later',
    mine: (role) => `Only for my position (${role})`,
    count: (n) => `${n} principle${n === 1 ? '' : 's'}`,
    none: 'No principles match those filters.',
    clear: 'Clear filters',
    laterNote: 'fotbol doesn’t check these yet. They’re here so you can read ahead.',
    comingIn: (r) => `Coming in ${r}`,
    // detail
    allPrinciples: 'All principles',
    notFound: (id) => `There’s no principle called “${id}”.`,
    stars: (n, count) => (count ? `${n} of 3 stars · practised ${count} time${count === 1 ? '' : 's'}` : 'Not practised yet'),
    why: 'Why it matters', rule: 'Rule of thumb', mistake: 'Common mistake', who: 'Who does it',
    checks: 'How fotbol checks it',
    checksNone: 'No automatic check yet: fotbol teaches this one through the tutorial and the scenarios.',
    checksLater: 'fotbol will check this in a later version.',
    where: 'Where you practise it',
    moduleLink: (m) => `Module ${m.id.slice(1)}: ${m.title}`,
    learnMore: 'Learn more',
    newTab: '(opens in a new tab)',
    practise: 'Practise this', tryExplore: 'Try it in Explore',
    practiseLater: 'Drills for this principle come in a later version.',
    practiseNoDrills: 'No drill is built around this one yet: you meet it in Explore, the tutorial and every drill\'s feedback.',
    // passing principles (PA): practised in Player mode's passing game, not in Explore
    playPass: 'Play it in Who\'s open?',
    passNote: 'Who\'s open? is the passing game in Player mode: you have the ball, and you pick the pass.',
    checksPass: 'The passing game rates every pass you could play, and this idea is one of the reasons it gives.',
    passWhere: (title) => `Player mode: ${title}`,
    passGame: 'Player mode: Who\'s open?',
    prev: 'Previous', nextP: 'Next',
    // resources
    resTitle: 'Reading list',
    resLead: 'Hand-picked places to learn more, from quick reads for players to deep dives for coaches. If you only read three things, read the first three.',
    resNote: 'Links open other sites in a new tab. fotbol has no ties to any of them, and nothing is tracked.',
    free: 'Free', paid: 'Paid',
  },
  kid: {
    tabs: { tutorial: 'Tutorial', principles: 'Ideas', resources: 'Reading list' },
    tabsLabel: 'Learn',
    kicker: 'Module 0 · Tutorial',
    stepsCount: (n) => `${n} quick steps.`,
    start: 'Start', resume: (n) => `Carry on from step ${n}`, restart: 'Start again',
    doneBefore: 'You finished this! Play it again, or try the drills.',
    replay: 'Play it again',
    stepOf: (i, n) => `Step ${i} of ${n}`,
    back: 'Back', next: 'Next', finish: 'Finish', skip: 'Skip', hint: 'Help', gotIt: 'Got it',
    task: 'Your job',
    notQuite: 'Not yet!',
    showTarget: 'The ring shows where.',
    wrongTeam: 'That’s one of theirs. Tap one of ours.',
    wrongPlayer: (name) => `That’s your ${name}.`,
    list: 'Pick from a list',
    principles: 'Ideas in this step',
    principlesAll: 'Ideas you met',
    more: 'More to learn',
    completeKicker: 'Module 0 done',
    completeTitle: 'You know the pitch!',
    almostKicker: 'Module 0',
    almostTitle: 'Nearly done!',
    skipped: (n) => `You skipped ${n === 1 ? 'one step' : `${n} steps`}. Go back and try ${n === 1 ? 'it' : 'them'}!`,
    learned: 'What you learned',
    toM1: 'Start Module 1', explore: 'Try Explore',
    onside: 'Onside', offside: 'Offside',
    keys: 'Keyboard: press Tab to pick the ball or yourself, then use the arrow keys.',
    attack: 'We go this way', ourGoal: 'Our goal', theirGoal: 'Their goal',
    dot: (i, title, done) => `Step ${i}: ${title}${done ? ', done' : ''}`,
    progress: 'Tutorial steps',
    unavailable: 'The tutorial couldn’t load',
    unavailableText: 'Something is missing. You can still read about the ideas.',
    libTitle: 'Ideas library',
    libLead: 'The ideas behind every position. “In fotbol now” means fotbol checks it when you play.',
    search: 'Search ideas',
    searchPlaceholder: 'Search: cover, offside, wide…',
    category: 'Type', level: 'Level', release: 'When', all: 'All',
    now: 'In fotbol now', later: 'Coming later',
    mine: (role) => `Only for my position (${role})`,
    count: (n) => `${n} idea${n === 1 ? '' : 's'}`,
    none: 'Nothing matches.',
    clear: 'Show all',
    laterNote: 'These are coming later. You can read them now.',
    comingIn: (r) => `Coming in ${r}`,
    allPrinciples: 'All ideas',
    notFound: (id) => `We can’t find “${id}”.`,
    stars: (n, count) => (count ? `${n} of 3 stars · played ${count} time${count === 1 ? '' : 's'}` : 'Not played yet'),
    why: 'Why it matters', rule: 'For coaches: the rule of thumb', mistake: 'Watch out for', who: 'Who does it',
    checks: 'How fotbol checks it',
    checksNone: 'fotbol teaches this in the tutorial and the drills.',
    checksLater: 'fotbol will check this later.',
    where: 'Where you practise it',
    moduleLink: (m) => `Module ${m.id.slice(1)}: ${m.title}`,
    learnMore: 'Learn more (with a grown-up)',
    newTab: '(opens in a new tab)',
    practise: 'Practise this', tryExplore: 'Try it in Explore',
    practiseLater: 'Drills for this come later.',
    practiseNoDrills: 'No drill for this one yet. Try it in Explore.',
    playPass: 'Play Who\'s open?',
    passNote: 'Who\'s open? is the passing game: you have the ball, you pick the pass.',
    checksPass: 'Who\'s open? checks it on every pass.',
    passWhere: (title) => `Player mode: ${title}`,
    passGame: 'Player mode: Who\'s open?',
    prev: 'Previous', nextP: 'Next',
    resTitle: 'Reading list',
    resLead: 'Books, videos and websites to learn more. Start with the first three.',
    resNote: 'Links open other websites in a new tab. Ask a grown-up first.',
    free: 'Free', paid: 'Costs money',
  },
};
const W = (app) => (app.settings.wording === 'kid' ? 'kid' : 'standard');

/** node.replaceChildren() without the nulls (the DOM would print them as the text "null"). */
const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

// ------------------------------------------------------------------ pure helpers (tested)

/**
 * Stored tutorial progress, cleaned against the current steps.
 * @returns {{ completed: boolean, completedAt: string|null, done: string[], step: number }}
 */
export function normalizeTutorialProgress(raw, steps = []) {
  const ids = new Set(steps.map((s) => s.id));
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const done = Array.isArray(r.done) ? [...new Set(r.done.filter((id) => ids.has(id)))] : [];
  const step = Number.isInteger(r.step) && r.step >= 0 && r.step < steps.length ? r.step : 0;
  const completed = r.completed === true;
  return { completed, completedAt: completed && typeof r.completedAt === 'string' ? r.completedAt : null, done, step };
}

/** True when the tutorial counts as finished (every step solved, or marked complete). */
export const tutorialDone = (progress) => !!progress?.completed;

/** The offside line for our attackers: the x of their second-last player (keeper included). */
export function offsideLineOf(frame, team = 'them') {
  const xs = (frame?.players ?? []).filter((p) => p.team === team).map((p) => p.x).sort((a, b) => b - a);
  return xs.length >= 2 ? xs[1] : null;
}

/** Is `p` inside the circle { x, y, r }? */
export const inTarget = (p, c) => !!p && !!c && dist(p, c) <= c.r;

/**
 * Has the task been done? state: { ball, spot, tapped, acknowledged }.
 * observe: acknowledged; drag-ball: the ball in task.to; place: the learner in task.target; tap-player: tapped = answer.
 */
export function taskSolved(task, { ball, spot, tapped, acknowledged } = {}) {
  switch (task?.type) {
    case 'observe': return !!acknowledged;
    case 'drag-ball': return inTarget(ball, task.to);
    case 'place': return inTarget(spot, task.target);
    case 'tap-player': return !!tapped && tapped === task.answer;
    default: return false;
  }
}

/** The player nearest `w` within `radius` metres, or null. */
export function playerAt(frame, w, radius = LEARN_DEFAULTS.tapRadius) {
  let best = null, bd = radius;
  for (const p of frame?.players ?? []) {
    const d = dist(p, w);
    if (d <= bd) { bd = d; best = p; }
  }
  return best;
}

const RELEASE_RANK = { v1: 0, 'v1.1': 1, v2: 2, v3: 3 };
export const releaseRank = (r) => RELEASE_RANK[r] ?? 9;
export const isAvailable = (p) => p?.release === 'v1';

/** v1 first, then by category (CATEGORY_ORDER), then catalogue order. Stable, does not mutate. */
export function sortPrinciples(list) {
  const idx = new Map((list ?? []).map((p, i) => [p, i]));
  const cat = (p) => { const i = CATEGORY_ORDER.indexOf(p.category); return i < 0 ? 99 : i; };
  return [...(list ?? [])].sort((a, b) => (isAvailable(b) - isAvailable(a)) || cat(a) - cat(b) || idx.get(a) - idx.get(b));
}

/**
 * Filter the catalogue. query matches id, name, short, summaries, who and the rule of thumb (case- and accent-insensitive,
 * every word must match). category/level/release: 'all' or a value (release: 'now' | 'later'); family: a role family or null.
 */
export function filterPrinciples(list, { query = '', category = 'all', level = 'all', release = 'all', family = null } = {}) {
  const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  // With a query, principles whose id or name match come before those that only mention it.
  const title = (p) => fold([p.id, p.name, p.short].join(' '));
  const rank = (p) => (words.every((w) => title(p).includes(w)) ? 0 : 1);
  const sorted = sortPrinciples((list ?? []).filter((p) => {
    if (category !== 'all' && p.category !== category) return false;
    if (level !== 'all' && String(p.level) !== String(level)) return false;
    if (release === 'now' && !isAvailable(p)) return false;
    if (release === 'later' && isAvailable(p)) return false;
    if (family && !(p.families ?? []).includes(family)) return false;
    if (!words.length) return true;
    const hay = fold([p.id, p.name, p.short, p.summary?.standard, p.summary?.kid, p.who, p.ruleOfThumb, CATEGORY_LABEL.standard[p.category]].join(' '));
    return words.every((w) => hay.includes(w));
  }));
  if (!words.length) return sorted;
  const pos = new Map(sorted.map((p, k) => [p, k]));
  return sorted.sort((a, b) => (isAvailable(b) - isAvailable(a)) || rank(a) - rank(b) || pos.get(a) - pos.get(b));
}

/** Resources in display groups: [{ group, items }] in RESOURCE_GROUPS order (file order within a group); empty groups dropped. */
export function groupResources(resources) {
  const list = Array.isArray(resources) ? resources : [];
  const known = new Set(RESOURCE_GROUPS);
  const groups = RESOURCE_GROUPS.map((g) => ({ group: g, items: list.filter((r) => r.group === g) }));
  const other = list.filter((r) => !known.has(r.group));
  if (other.length) groups.push({ group: 'other', items: other });
  return groups.filter((g) => g.items.length);
}

/** Mastery stars (0-3) and attempts for a principle from stored skills; never throws. */
export function principleProgress(skills, id) {
  if (!skills) return { stars: 0, count: 0 };
  try {
    const count = Number(skills.counts?.byPrinciple?.[id]) || 0;
    return { stars: mastery(skills, id), count };
  } catch {
    return { stars: 0, count: 0 };
  }
}

// ------------------------------------------------------------------ shared bits

function learnTabs(app, current) {
  const C = COPY[W(app)];
  const items = [['tutorial', '#/learn'], ['principles', '#/learn/principles'], ['resources', '#/learn/resources']];
  return el('nav', { class: 'ln-tabs', 'aria-label': C.tabsLabel }, [
    el('ul', {}, items.map(([key, href]) => el('li', {}, [
      el('a', { href, 'aria-current': key === current ? 'page' : null, text: C.tabs[key] }),
    ]))),
  ]);
}

const externalLink = (app, href, text, attrs = {}) => el('a', {
  href, target: '_blank', rel: 'noopener noreferrer', ...attrs,
}, [text, el('span', { class: 'visually-hidden', text: ` ${COPY[W(app)].newTab}` }), icon('arrow', { size: 14, className: 'ln-ext' })]);

function setTitle(text) {
  if (typeof document !== 'undefined') document.title = `${text} · fotbol`;
}

/** Re-render a page view whenever the wording changes. @returns unsubscribe */
function onWording(app, render) {
  let last = W(app);
  return app.onSettings?.(() => {
    if (W(app) !== last) { last = W(app); render(); }
  });
}

// ------------------------------------------------------------------ router

/** Mode contract (ARCHITECTURE §5.9). */
export async function mount(root, app, params = []) {
  const [sub, arg] = params.map((p) => String(p));
  const s = (sub ?? '').toLowerCase();
  if (!s || s === 'tutorial') return mountTutorial(root, app);
  if (s === 'principles' || (s === 'p' && !arg)) return mountLibrary(root, app);
  if (s === 'p') return mountPrinciple(root, app, arg);
  if (s === 'resources' || s === 'reading') return mountResources(root, app);
  const page = el('div', { class: 'page ln-page' }, [
    learnTabs(app, null),
    notice({ title: 'Page not found', text: `There’s no Learn page called “${sub}”.`, actions: [linkButton('Back to Learn', '#/learn', { variant: 'primary' })] }),
  ]);
  fill(root, page);
  return undefined;
}

// ------------------------------------------------------------------ tutorial

function mountTutorial(root, app) {
  const T = app.data.tutorial;
  const steps = T?.steps ?? [];
  if (!steps.length) {
    const C = COPY[W(app)];
    fill(root, el('div', { class: 'page ln-page' }, [
      learnTabs(app, 'tutorial'),
      notice({ title: C.unavailable, text: C.unavailableText, actions: [linkButton(C.tabs.principles, '#/learn/principles', { variant: 'primary' })] }),
    ]));
    return undefined;
  }
  setTitle('Tutorial');
  const P = LEARN_DEFAULTS;
  const formation = app.data.formations?.us ?? createFormation();
  const formations = { us: formation, them: app.data.formations?.them ?? formation };
  const principles = app.data.principles?.byId ?? {};
  const layout = stageLayout(root, { label: 'Tutorial' });
  // Pinned from the window, not the board's box: a phone held upright keeps one (vertical) pitch from the intro
  // to the end, whatever the sheet's height does to the box (step 1 teaches the direction of play from it).
  const board = app.createBoard(layout.board, { orientation: orientationFor(window.innerWidth, window.innerHeight) });
  root.classList.add('ln-tut');

  let progress = normalizeTutorialProgress(app.store.get(TUTORIAL_KEY), steps);
  const save = () => app.store.set(TUTORIAL_KEY, progress);

  // index: -1 = intro, 0..n-1 = a step, n = the end screen
  const state = {
    index: -1, ball: null, spot: null, frame: null,
    solved: false, acknowledged: false, tapped: null, wrong: null,
    attempts: 0, hint: false, target: false, message: '', lastTry: null, listOpen: false,
  };
  const n = steps.length;
  const step = () => steps[Math.max(0, Math.min(n - 1, state.index))];
  const learnerIdOf = (s) => playerId('us', s.setup.learnerRole);
  const C = () => COPY[W(app)];
  const w = () => W(app);

  // ---- board
  function placeFrame(s) {
    const setup = s.setup;
    const learnerId = learnerIdOf(s);
    const overrides = { ...(setup.overrides ?? {}) };
    if (state.spot) overrides[learnerId] = state.spot;
    const keep = setup.carrierId && dist(state.ball, setup.ball) < P.carrierKeep;
    state.frame = autoFrame({
      formations, ball: state.ball, possession: setup.possession,
      carrierId: keep ? setup.carrierId : null, learnerId, overrides,
    });
  }

  function drawnFrame(s) {
    if (!state.spot) return state.frame;
    const id = learnerIdOf(s), p = state.spot;
    return { ...state.frame, players: state.frame.players.map((q) => (q.id === id ? { ...q, x: p.x, y: p.y } : q)) };
  }

  function markersFor(s) {
    const { task, topic } = s;
    const out = [];
    const L = C();
    if (topic === 'orientation') {
      // Along our left wing, in the gap between our winger and full-back in this step's shape.
      out.push({ type: 'arrow', from: { x: 18, y: 6.8 }, to: { x: 50, y: 6.8 }, tone: 'info', label: L.attack });
      out.push({ type: 'label', at: { x: 9, y: MID_Y - 7 }, text: L.ourGoal, tone: 'info' });
      out.push({ type: 'label', at: { x: 96, y: MID_Y - 7 }, text: L.theirGoal, tone: 'info' });
    }
    if (state.hint && topic === 'goal-side') {
      const markId = s.setup.highlight.find((id) => id.startsWith('them-'));
      const mark = state.frame.players.find((p) => p.id === markId);
      if (mark) out.push({ type: 'segment', a: mark, b: { x: 0, y: MID_Y }, tone: 'cue', dashed: true });
    }
    if (state.hint && topic === 'duties') out.push({ type: 'ring', id: BALL_ID, tone: 'cue', r: 2.6 });
    if (topic === 'offside' && state.spot && !state.solved) {
      const line = offsideLineOf(state.frame);
      const off = line !== null && state.spot.x > line + 0.3;
      out.push({ type: 'label', at: { x: state.spot.x, y: state.spot.y + 4.8 }, text: off ? L.offside : L.onside, tone: off ? 'bad' : 'good' });
    }
    const circle = task.type === 'drag-ball' ? task.to : task.type === 'place' ? task.target : null;
    if (circle && state.target && !state.solved) out.push({ type: 'ring', at: { x: circle.x, y: circle.y }, r: circle.r, tone: 'good', pulse: true });
    if (state.solved && task.type === 'drag-ball') out.push({ type: 'ring', id: BALL_ID, tone: 'good', pulse: false, r: 2.4 });
    if (state.solved && task.type === 'place') out.push({ type: 'ring', id: learnerIdOf(s), tone: 'good', pulse: false, r: 3.4 });
    if (task.type === 'tap-player') {
      if (state.solved) out.push({ type: 'ring', id: task.answer, tone: 'good', pulse: false });
      else if (state.wrong) out.push({ type: 'ring', id: state.wrong, tone: 'bad', pulse: false });
      if (!state.solved && state.target) out.push({ type: 'ring', id: task.answer, tone: 'good', pulse: true });
    }
    return out;
  }

  function drawBoard() {
    const s = step();
    const o = s.setup.overlays ?? {};
    board.setOverlays({ thirds: !!o.thirds, lanes: !!o.lanes, zone14: !!o.zone14, offsideLine: o.offsideLine ? offsideLineOf(state.frame) : null, backLine: null });
    board.setMarkers(markersFor(s));
    const hl = [...(s.setup.highlight ?? [])];
    if (s.task.type === 'drag-ball' && state.index >= 0 && state.index < n) hl.push(BALL_ID);
    board.render(drawnFrame(s), { learnerId: learnerIdOf(s), highlight: hl, labels: 'role' });
  }

  function enableInput() {
    const s = step();
    const live = state.index >= 0 && state.index < n;
    if (live && s.task.type === 'drag-ball') board.enableDrag({ ids: [BALL_ID], onMove, onEnd });
    else if (live && s.task.type === 'place') board.enableDrag({ ids: [learnerIdOf(s)], onMove, onEnd });
    else board.disableDrag();
  }

  // ---- input
  let raf = 0, tryTimer = 0;
  const pending = { ball: null, spot: null };
  function flush() {
    cancelAnimationFrame(raf);
    raf = 0;
    const s = step();
    if (pending.ball) { state.ball = pending.ball; pending.ball = null; placeFrame(s); }
    if (pending.spot) { state.spot = pending.spot; pending.spot = null; }
    drawBoard();
  }
  function onMove(id, p) {
    if (id === BALL_ID) pending.ball = clampToPitch(p); else pending.spot = clampToPitch(p);
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function onEnd(id, p) {
    onMove(id, p);
    flush();
    check();
  }

  function check() {
    const s = step();
    if (state.solved) return;
    if (taskSolved(s.task, state)) { solve(); return; }
    // A try counts once the token has rested outside the target for a moment (so keyboard nudges aren't each a miss).
    clearTimeout(tryTimer);
    tryTimer = setTimeout(() => {
      if (state.solved || step() !== s) return;
      const at = s.task.type === 'drag-ball' ? state.ball : state.spot;
      if (state.lastTry && at && dist(state.lastTry, at) < 1) return;
      state.lastTry = at ? { ...at } : null;
      miss();
    }, P.attemptMs);
  }

  function miss(extra = '', { focus = null } = {}) {
    const L = C();
    state.attempts += 1;
    state.hint = true;
    if (state.attempts >= 2) state.target = true;
    state.message = [extra, L.notQuite, state.target ? L.showTarget : ''].filter(Boolean).join(' ');
    renderPanel({ focus });
    showTask(); // the "Not quite yet" and the hint are written inside the task box: make sure it is on screen
    drawBoard();
    announce(`${state.message} ${pickText(step().task.hint, w())}`);
  }

  function solve({ focusNext = false } = {}) {
    const s = step();
    state.solved = true;
    state.message = '';
    clearTimeout(tryTimer);
    if (!progress.done.includes(s.id)) progress.done.push(s.id);
    progress.step = Math.min(state.index + 1, n - 1);
    save();
    renderPanel({ focus: focusNext ? 'next' : null });
    drawBoard();
    announce(pickText(s.task.success, w()));
  }

  function onBoardClick(e) {
    const s = step();
    if (state.index < 0 || state.index >= n || s.task.type !== 'tap-player' || state.solved) return;
    const wpt = board.toWorld(e.clientX, e.clientY);
    if (!Number.isFinite(wpt.x)) return;
    pick(playerAt(state.frame, wpt, P.tapRadius));
  }

  function pick(p, { fromList = false } = {}) {
    if (!p) return;
    const s = step();
    const L = C();
    if (p.id === s.task.answer) {
      state.tapped = p.id;
      state.wrong = null;
      solve({ focusNext: fromList });
      return;
    }
    state.wrong = p.id;
    const { team, role } = parsePlayerId(p.id);
    const who = team === 'us' ? L.wrongPlayer((ROLE_INFO[role]?.label ?? role).toLowerCase()) : L.wrongTeam;
    miss(who, { focus: fromList ? `pick:${p.id}` : null });
  }

  board.el.addEventListener('click', onBoardClick);

  // ---- navigation
  function go(index, { focus = true } = {}) {
    clearTimeout(tryTimer);
    cancelAnimationFrame(raf);
    raf = 0;
    state.index = Math.max(-1, Math.min(n, index));
    const s = step();
    Object.assign(state, {
      ball: { ...s.setup.ball }, spot: s.setup.learnerStart ? { ...s.setup.learnerStart } : null,
      solved: false, acknowledged: false, tapped: null, wrong: null, attempts: 0, hint: false, target: false, message: '', lastTry: null, listOpen: false,
    });
    state.lastTry = s.task.type === 'drag-ball' ? { ...state.ball } : state.spot ? { ...state.spot } : null;
    if (state.index >= 0 && state.index < n) { progress.step = state.index; save(); }
    if (state.index === n) finish();
    placeFrame(s);
    enableInput();
    drawBoard();
    layout.panel.head.scrollTop = 0;
    renderPanel({ focus: focus ? 'title' : null });
    layout.collapse();
  }

  function finish() {
    const all = steps.every((s) => progress.done.includes(s.id));
    if (all && !progress.completed) {
      progress.completed = true;
      progress.completedAt = new Date().toISOString();
      rewardCompletion();
    }
    const firstOpen = steps.findIndex((s) => !progress.done.includes(s.id));
    progress.step = Math.max(0, firstOpen);
    save();
  }

  /** Rewards (ARCHITECTURE §5.13): once per completion (the Graduate badge, and its XP only the first time ever); in
   *  Player mode only (Coach mode earns nothing, so no celebration shows). */
  function rewardCompletion() {
    if (!earnsRewards(app)) return;
    award(app, { type: 'tutorial-complete' });
  }

  // ---- panel
  function dots() {
    const L = C();
    return el('ol', { class: 'ln-dots', 'aria-label': L.progress }, steps.map((s, i) => {
      const done = progress.done.includes(s.id);
      return el('li', {}, [el('button', {
        type: 'button',
        class: ['ln-dot', done && 'is-done', i === state.index && 'is-current'],
        'aria-label': L.dot(i + 1, s.title, done),
        'aria-current': i === state.index ? 'step' : null,
        onclick: () => go(i),
      })]);
    }));
  }

  function renderPanel({ focus = null } = {}) {
    const L = C();
    const { head, actions, feedback, body } = layout.panel;
    fill(feedback);
    let title;
    if (state.index < 0) {
      // intro
      const resumeAt = progress.step;
      const started = progress.done.length > 0 && !progress.completed;
      title = el('h1', { class: 'ln-title', tabindex: '-1', text: T.title });
      fill(head, 
        el('p', { class: 'ln-kicker', text: L.kicker }),
        title,
        el('p', { class: 'ln-text', text: pickText(T.intro, w()) }),
        el('p', { class: 'ln-meta', text: progress.completed ? L.doneBefore : L.stepsCount(n) }),
        progress.done.length ? dots() : null,
      );
      const primary = progress.completed
        ? linkButton(L.toM1, '#/drill/M1', { variant: 'primary', icon: 'arrow' })
        : started
          ? button(L.resume(resumeAt + 1), { variant: 'primary', icon: 'arrow', onClick: () => go(resumeAt) })
          : button(L.start, { variant: 'primary', icon: 'arrow', onClick: () => go(0) });
      fill(actions,
        started ? button(L.restart, { onClick: () => go(0) }) : null,
        progress.completed ? button(L.replay, { icon: 'learn', onClick: () => go(0) }) : null,
        primary,
      );
      fill(body, moreLinks());
    } else if (state.index >= n) {
      // the end
      const skipped = steps.filter((s) => !progress.done.includes(s.id));
      const done = !skipped.length;
      title = el('h1', { class: 'ln-title', tabindex: '-1', text: done ? L.completeTitle : L.almostTitle });
      fill(head, 
        el('div', { class: ['ln-finish', done && 'is-done'] }, [
          el('span', { class: 'ln-finish-mark', 'aria-hidden': 'true' }, [icon(done ? 'check' : 'learn', { size: 28 })]),
          el('div', {}, [el('p', { class: 'ln-kicker', text: done ? L.completeKicker : L.almostKicker }), title]),
        ]),
        el('p', { class: 'ln-text', text: done ? pickText(T.outro, w()) : L.skipped(skipped.length) }),
        dots(),
      );
      fill(actions, 
        linkButton(L.explore, '#/explore', { icon: 'explore' }),
        done ? linkButton(L.toM1, '#/drill/M1', { variant: 'primary', icon: 'arrow' })
          : button(L.resume(steps.indexOf(skipped[0]) + 1), { variant: 'primary', icon: 'arrow', onClick: () => go(steps.indexOf(skipped[0])) }),
      );
      fill(body, 
        el('section', { class: 'ln-learned' }, [
          el('h2', { class: 'ln-h2', text: L.learned }),
          el('ul', {}, steps.map((s) => el('li', { class: progress.done.includes(s.id) ? 'is-done' : null }, [
            icon(progress.done.includes(s.id) ? 'check' : 'close', { size: 16 }), el('span', { text: s.title }),
          ]))),
        ]),
        principleLinks(T.steps.flatMap((s) => s.principles), L.principlesAll),
        el('p', {}, [button(L.replay, { icon: 'learn', onClick: () => go(0) })]),
        moreLinks(),
      );
    } else {
      const s = step();
      const t = s.task;
      const wasDone = progress.done.includes(s.id);
      title = el('h1', { class: 'ln-title', tabindex: '-1', text: s.title });
      // On a phone the task comes first, straight under the title (CSS order on .ln-explain): the collapsed sheet
      // has room for what to do, and the explanation follows (scroll the head, or open the sheet, to read it all).
      const status = state.solved ? 'done' : state.message ? 'miss' : 'todo';
      const taskBox = el('div', { class: 'ln-task', tabindex: '-1', dataset: { state: status } }, [
        el('span', { class: 'ln-task-mark', 'aria-hidden': 'true' }, [icon(state.solved ? 'check' : 'drill', { size: 18 })]),
        el('div', { class: 'ln-task-body' }, [
          state.solved ? null : el('p', { class: 'ln-task-label', text: L.task }),
          el('p', { class: 'ln-task-text', text: state.solved ? pickText(t.success, w()) : pickText(t.prompt, w()) }),
          !state.solved && state.message ? el('p', { class: 'ln-task-msg', text: state.message }) : null,
          !state.solved && state.hint && t.hint ? el('p', { class: 'ln-task-hint' }, [el('strong', { text: `${L.hint}: ` }), pickText(t.hint, w())]) : null,
        ]),
      ]);
      fill(head,
        el('div', { class: 'ln-steprow' }, [el('p', { class: 'ln-kicker', text: L.stepOf(state.index + 1, n) }), dots()]),
        title,
        el('p', { class: 'ln-text ln-explain', text: pickText(s.text, w()) }),
        taskBox,
        t.type === 'tap-player' && !state.solved ? tapList(s) : null,
      );
      const last = state.index === n - 1;
      const nextLabel = last ? L.finish : L.next;
      const nextBtn = state.solved || wasDone
        ? button(nextLabel, { variant: state.solved ? 'primary' : 'secondary', icon: 'arrow', className: 'ln-next', onClick: () => go(state.index + 1) })
        : t.type === 'observe'
          ? button(L.gotIt, { variant: 'primary', icon: 'check', className: 'ln-next', onClick: () => { state.acknowledged = true; solve({ focusNext: true }); } })
          : button(L.skip, { variant: 'ghost', className: 'ln-skip', onClick: () => go(state.index + 1) });
      fill(actions, 
        button(L.back, { variant: 'secondary', icon: 'arrow', iconOnly: true, className: 'ln-backbtn', onClick: () => go(state.index - 1) }),
        !state.solved && !wasDone && t.hint && !state.hint ? button(L.hint, { icon: 'learn', onClick: () => { state.hint = true; renderPanel({ focus: 'task' }); showTask(); drawBoard(); announce(pickText(t.hint, w())); } }) : null,
        nextBtn,
      );
      fill(body, 
        s.principles.length ? principleLinks(s.principles) : null,
        t.type === 'drag-ball' || t.type === 'place' ? el('p', { class: 'ln-keys', text: L.keys }) : null,
        moreLinks(),
      );
    }
    fitSheet();
    if (focus === 'title') title?.focus({ preventScroll: true });
    else if (focus === 'next') actions.querySelector('.ln-next')?.focus({ preventScroll: true });
    else if (focus === 'task') head.querySelector('.ln-task')?.focus({ preventScroll: true });
    else if (focus?.startsWith('pick:')) head.querySelector(`.ln-tapopt[data-id="${focus.slice(5)}"]`)?.focus({ preventScroll: true });
  }

  // On a phone the collapsed sheet shows the handle, the head and the actions within 45% of the screen
  // (components.js stageLayout): cap the head by the real height of the action row, so the buttons
  // never fall below the fold when they wrap onto two rows. The head scrolls instead.
  function fitSheet() {
    layout.root.style.setProperty('--ln-actions-h', `${layout.panel.actions.offsetHeight || 68}px`);
  }
  /** Scroll the (capped, scrolling) head so the task box, with its miss message and hint, is in view. */
  function showTask() {
    const head = layout.panel.head;
    const box = head.querySelector('.ln-task');
    if (!box) return;
    const h = head.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (!(h.height > 0)) return;
    const pad = 8;
    if (b.top < h.top + pad) head.scrollTop -= h.top + pad - b.top;
    else if (b.bottom > h.bottom - pad) head.scrollTop += Math.min(b.bottom - (h.bottom - pad), b.top - (h.top + pad));
  }
  const onResize = () => {
    board.setOrientation(orientationFor(window.innerWidth, window.innerHeight));
    fitSheet();
  };
  addEventListener('resize', onResize);

  function tapList(s) {
    const L = C();
    const ball = state.frame.ball;
    const ours = state.frame.players
      .filter((p) => p.team === 'us' && p.role !== 'GK' && p.id !== learnerIdOf(s))
      .sort((a, b) => dist(a, ball) - dist(b, ball))
      .slice(0, P.listPlayers);
    return el('details', { class: 'ln-taplist', open: state.listOpen, ontoggle: (e) => { state.listOpen = e.target.open; } }, [
      el('summary', { text: L.list }),
      el('div', { class: 'ln-taplist-options' }, ours.map((p) => button(ROLE_INFO[p.role]?.label ?? p.role, {
        className: ['ln-tapopt', state.wrong === p.id && 'is-wrong'],
        dataset: { id: p.id },
        onClick: () => pick(p, { fromList: true }),
      }))),
    ]);
  }

  function principleLinks(ids, heading) {
    const L = C();
    const uniq = [...new Set(ids)].filter((id) => principles[id]);
    if (!uniq.length) return null;
    return el('section', { class: 'ln-plinks' }, [
      el('h2', { class: 'ln-h2', text: heading ?? L.principles }),
      el('ul', {}, uniq.map((id) => el('li', {}, [el('a', { class: 'rv-chip', href: `#/learn/p/${id}` }, [el('b', { text: id }), el('span', { text: principles[id].short ?? principles[id].name })])]))),
    ]);
  }

  function moreLinks() {
    const L = C();
    return el('nav', { class: 'ln-more', 'aria-label': L.more }, [
      el('h2', { class: 'ln-h2', text: L.more }),
      el('ul', {}, [
        el('li', {}, [el('a', { href: '#/learn/principles', text: L.tabs.principles })]),
        el('li', {}, [el('a', { href: '#/learn/resources', text: L.tabs.resources })]),
      ]),
    ]);
  }

  const offSettings = onWording(app, () => { renderPanel(); drawBoard(); });

  // Open where the learner left off: the intro (which offers "carry on") unless they are mid-way.
  go(-1, { focus: false });

  return () => {
    clearTimeout(tryTimer);
    cancelAnimationFrame(raf);
    offSettings?.();
    removeEventListener('resize', onResize);
    board.el.removeEventListener('click', onBoardClick);
    board.destroy();
    layout.destroy();
  };
}

// ------------------------------------------------------------------ principle library

/** Filter state kept for the session, so coming back from a principle page keeps your search. */
const libState = { query: '', category: 'all', level: 'all', release: 'all', mine: false };

function mountLibrary(root, app) {
  setTitle('Principles');
  const all = app.data.principles?.list ?? [];
  const skills = app.store.get('skills', null);
  let resultsEl, countEl;

  function principleCard(p) {
    const wd = W(app), L = COPY[wd];
    const prog = principleProgress(skills, p.id);
    return el('li', {}, [el('a', { class: ['ln-pcard', !isAvailable(p) && 'is-later'], href: `#/learn/p/${encodeURIComponent(p.id)}` }, [
      el('span', { class: 'ln-pcard-top' }, [
        el('span', { class: 'ln-pid', text: p.id }),
        el('span', { class: 'ln-pcat', text: CATEGORY_LABEL[wd][p.category] ?? p.category }),
        prog.count ? starRating(prog.stars, { size: 14 }) : null,
      ]),
      el('span', { class: 'ln-pname', text: p.name }),
      el('span', { class: 'ln-psum', text: pickText(p.summary, wd) }),
      el('span', { class: 'ln-pmeta' }, [
        el('span', { class: 'ln-badge', text: LEVEL_LABEL[wd][p.level] ?? `Level ${p.level}` }),
        isAvailable(p) ? el('span', { class: 'ln-badge ln-badge--now', text: L.now }) : el('span', { class: 'ln-badge ln-badge--later', text: L.comingIn(p.release) }),
      ]),
    ])]);
  }

  function renderResults() {
    const wd = W(app), L = COPY[wd];
    const family = libState.mine ? ROLE_INFO[app.settings.role]?.family ?? null : null;
    const list = filterPrinciples(all, { ...libState, family });
    countEl.textContent = L.count(list.length);
    if (!list.length) {
      fill(resultsEl, el('div', { class: 'ln-empty' }, [
        el('p', { text: L.none }),
        button(L.clear, { onClick: () => { Object.assign(libState, { query: '', category: 'all', level: 'all', release: 'all', mine: false }); render(); } }),
      ]));
      return;
    }
    const now = list.filter(isAvailable), later = list.filter((p) => !isAvailable(p));
    const section = (title, items, note) => el('section', { class: 'ln-psection', 'aria-label': title }, [
      el('h2', { class: 'ln-h2', text: `${title} (${items.length})` }),
      note ? el('p', { class: 'ln-psection-note', text: note }) : null,
      el('ul', { class: 'ln-pgrid' }, items.map(principleCard)),
    ]);
    fill(resultsEl, 
      now.length ? section(L.now, now) : null,
      later.length ? section(L.later, later, L.laterNote) : null,
    );
  }

  function render() {
    const wd = W(app), L = COPY[wd];
    const role = ROLE_INFO[app.settings.role]?.label.toLowerCase() ?? '';
    const sel = (label, key, options) => {
      const id = uid('ln-f');
      return el('div', { class: 'field ln-field' }, [
        el('label', { class: 'field-label', for: id, text: label }),
        el('select', { id, class: 'field-select', onchange: (e) => { libState[key] = e.target.value; renderResults(); } },
          options.map(([value, text]) => el('option', { value, text, selected: String(libState[key]) === String(value) }))),
      ]);
    };
    const searchId = uid('ln-q');
    const search = el('input', {
      id: searchId, type: 'search', class: 'ln-search', placeholder: L.searchPlaceholder, value: libState.query, autocomplete: 'off',
      oninput: (e) => { libState.query = e.target.value; renderResults(); },
    });
    countEl = el('p', { class: 'ln-count', 'aria-live': 'polite' });
    resultsEl = el('div', { class: 'ln-results' });
    const cats = CATEGORY_ORDER.filter((c) => all.some((p) => p.category === c));
    fill(root, el('div', { class: 'page ln-page' }, [
      learnTabs(app, 'principles'),
      el('header', { class: 'ln-header' }, [el('h1', { text: L.libTitle }), el('p', { class: 'ln-lead', text: L.libLead })]),
      el('div', { class: 'ln-filters', role: 'search' }, [
        el('div', { class: 'ln-searchbox' }, [
          el('label', { class: 'visually-hidden', for: searchId, text: L.search }),
          icon('explore', { size: 18, className: 'ln-search-icon' }),
          search,
        ]),
        sel(L.category, 'category', [['all', L.all], ...cats.map((c) => [c, CATEGORY_LABEL[wd][c]])]),
        sel(L.level, 'level', [['all', L.all], ['1', LEVEL_LABEL[wd][1]], ['2', LEVEL_LABEL[wd][2]], ['3', LEVEL_LABEL[wd][3]]]),
        sel(L.release, 'release', [['all', L.all], ['now', L.now], ['later', L.later]]),
        el('label', { class: 'ln-mine' }, [
          el('input', { type: 'checkbox', checked: libState.mine, onchange: (e) => { libState.mine = e.target.checked; renderResults(); } }),
          el('span', { text: L.mine(role) }),
        ]),
      ]),
      countEl,
      resultsEl,
    ]));
    renderResults();
  }

  render();
  return onWording(app, render);
}

// ------------------------------------------------------------------ principle detail

function mountPrinciple(root, app, rawId) {
  const list = sortPrinciples(app.data.principles?.list ?? []);
  const id = String(rawId ?? '').toUpperCase();
  const skills = app.store.get('skills', null);

  function render() {
    const wd = W(app), L = COPY[wd];
    const p = app.data.principles?.byId?.[id];
    if (!p) {
      setTitle('Principles');
      fill(root, el('div', { class: 'page ln-page' }, [
        learnTabs(app, 'principles'),
        notice({ title: L.notFound(rawId), text: L.libLead, actions: [linkButton(L.allPrinciples, '#/learn/principles', { variant: 'primary' })] }),
      ]));
      return;
    }
    setTitle(`${p.id} ${p.short ?? p.name}`);
    const prog = principleProgress(skills, p.id);
    const modules = (app.data.curriculum?.modules ?? []).filter((m) => (m.principles ?? []).includes(p.id));
    const rules = (p.ruleIds ?? []).map((rid) => RULES_BY_ID[rid]).filter(Boolean);
    // "Practise this" only when a drill actually teaches it (a v1 principle without one would dead-end).
    const hasDrills = (app.data.scenarios?.index ?? []).some((e) => (e.principles ?? []).includes(p.id));
    // Passing principles (PA) are practised in Player mode's "Who's open?" (Explore has no passing view): the Road's
    // pass node on this idea, else the quick passing set.
    const passing = p.category === 'passing';
    const passNode = passing ? (app.data.road?.chapters ?? []).flatMap((c) => c.nodes ?? []).find((n) => n.kind === 'pass' && (n.principles ?? []).includes(p.id)) ?? null : null;
    const passHref = passNode ? `#/pass/${encodeURIComponent(passNode.id)}` : '#/pass';
    const i = list.indexOf(p);
    const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    const block = (title, content, cls) => (content ? el('section', { class: ['ln-block', cls] }, [el('h2', { class: 'ln-h2', text: title }), typeof content === 'string' ? el('p', { text: content }) : content]) : null);
    const families = (p.families ?? []).filter((f) => FAMILIES.includes(f));

    const checks = isAvailable(p)
      ? rules.length
        ? el('ul', { class: 'ln-rules' }, rules.map((r) => el('li', {}, [icon('check', { size: 16 }), el('span', { text: r.text?.[wd]?.name ?? r.text?.standard?.name ?? r.id })])))
        : el('p', { text: passing ? L.checksPass : L.checksNone })
      : el('p', { text: L.checksLater });

    const ruleOfThumb = p.ruleOfThumb
      ? wd === 'kid'
        ? el('details', { class: 'ln-block ln-details' }, [el('summary', { text: L.rule }), el('p', { text: p.ruleOfThumb })])
        : block(L.rule, p.ruleOfThumb, 'ln-block--rule')
      : null;

    fill(root, el('div', { class: 'page ln-page ln-detail' }, [
      learnTabs(app, 'principles'),
      el('a', { class: 'ln-back', href: '#/learn/principles' }, [icon('arrow', { size: 16, className: 'ln-back-icon' }), L.allPrinciples]),
      el('header', { class: 'ln-dhead' }, [
        el('div', { class: 'ln-dtags' }, [
          el('span', { class: 'ln-pid ln-pid--lg', text: p.id }),
          el('span', { class: 'ln-badge', text: CATEGORY_LABEL[wd][p.category] ?? p.category }),
          el('span', { class: 'ln-badge', text: LEVEL_LABEL[wd][p.level] ?? `Level ${p.level}` }),
          isAvailable(p) ? el('span', { class: 'ln-badge ln-badge--now', text: L.now }) : el('span', { class: 'ln-badge ln-badge--later', text: L.comingIn(p.release) }),
        ]),
        el('h1', { class: 'ln-dtitle', text: p.name }),
        el('p', { class: 'ln-dstars' }, [starRating(prog.stars, { label: L.stars(prog.stars, prog.count) }), el('span', { 'aria-hidden': 'true', text: L.stars(prog.stars, prog.count) })]),
        el('p', { class: 'ln-dsummary', text: pickText(p.summary, wd) }),
        el('div', { class: 'ln-dactions' }, passing
          ? [isAvailable(p) ? linkButton(L.playPass, passHref, { variant: 'primary', icon: 'play' }) : null]
          : [
            isAvailable(p) && hasDrills ? linkButton(L.practise, `#/drill/p/${encodeURIComponent(p.id)}`, { variant: 'primary', icon: 'drill' }) : null,
            linkButton(L.tryExplore, '#/explore', { icon: 'explore' }),
          ]),
        isAvailable(p)
          ? (passing ? el('p', { class: 'ln-psection-note', text: L.passNote }) : hasDrills ? null : el('p', { class: 'ln-psection-note', text: L.practiseNoDrills }))
          : el('p', { class: 'ln-psection-note', text: L.practiseLater }),
      ]),
      el('div', { class: 'ln-dgrid' }, [
        el('div', { class: 'ln-dmain' }, [
          block(L.why, p.why),
          block(L.mistake, p.commonMistake, 'ln-block--mistake'),
          ruleOfThumb,
        ]),
        el('aside', { class: 'ln-dside' }, [
          block(L.who, el('div', {}, [
            el('p', { text: p.who }),
            families.length ? el('ul', { class: 'ln-families' }, families.map((f) => el('li', { text: FAMILY_LABEL[f] }))) : null,
          ])),
          block(L.checks, checks),
          modules.length ? block(L.where, el('ul', { class: 'ln-modlinks' }, modules.map((m) => el('li', {}, [
            el('a', { href: m.kind === 'tutorial' ? '#/learn' : `#/drill/${m.id}`, text: L.moduleLink(m) }),
          ])))) : passing && isAvailable(p) ? block(L.where, el('ul', { class: 'ln-modlinks' }, [el('li', {}, [
            el('a', { href: passHref, text: passNode ? L.passWhere(passNode.title) : L.passGame }),
          ])])) : null,
          p.learnMore?.length ? block(L.learnMore, el('ul', { class: 'ln-extlinks' }, p.learnMore.map((l) => el('li', {}, [externalLink(app, l.url, l.label)])))) : null,
        ]),
      ]),
      el('nav', { class: 'ln-pager', 'aria-label': 'More principles' }, [
        prev ? el('a', { class: 'ln-pager-prev', href: `#/learn/p/${prev.id}` }, [el('small', { text: L.prev }), `${prev.id} · ${prev.short ?? prev.name}`]) : el('span'),
        next ? el('a', { class: 'ln-pager-next', href: `#/learn/p/${next.id}` }, [el('small', { text: L.nextP }), `${next.id} · ${next.short ?? next.name}`]) : el('span'),
      ]),
    ]));
  }

  render();
  return onWording(app, render);
}

// ------------------------------------------------------------------ resources

function mountResources(root, app) {
  setTitle('Reading list');
  function render() {
    const wd = W(app), L = COPY[wd];
    const groups = groupResources(app.data.resources);
    const card = (r) => el('li', { class: ['ln-rcard', r.group === 'start-here' && 'is-start'] }, [
      el('h3', { class: 'ln-rtitle' }, [externalLink(app, r.url, r.title)]),
      el('p', { class: 'ln-rbadges' }, [
        el('span', { class: 'ln-badge', text: KIND_LABEL[r.kind] ?? r.kind }),
        r.free === true ? el('span', { class: 'ln-badge ln-badge--free', text: L.free }) : r.free === false ? el('span', { class: 'ln-badge ln-badge--paid', text: L.paid }) : null,
        r.audience ? el('span', { class: 'ln-badge ln-badge--plain', text: AUDIENCE_LABEL[r.audience] ?? r.audience }) : null,
      ]),
      r.why ? el('p', { class: 'ln-rwhy', text: r.why }) : null,
      r.note ? el('p', { class: 'ln-rnote', text: r.note }) : null,
    ]);
    fill(root, el('div', { class: 'page ln-page' }, [
      learnTabs(app, 'resources'),
      el('header', { class: 'ln-header' }, [el('h1', { text: L.resTitle }), el('p', { class: 'ln-lead', text: L.resLead }), el('p', { class: 'ln-psection-note', text: L.resNote })]),
      groups.length ? null : el('p', { text: 'The reading list couldn’t load.' }),
      ...groups.map((g) => el('section', { class: ['ln-rsection', `ln-rsection--${g.group}`], 'aria-label': GROUP_LABEL[wd][g.group] ?? g.group }, [
        el('h2', { class: 'ln-h2', text: GROUP_LABEL[wd][g.group] ?? g.group }),
        el('ul', { class: 'ln-rgrid' }, g.items.map(card)),
      ])),
    ]));
  }
  render();
  return onWording(app, render);
}
