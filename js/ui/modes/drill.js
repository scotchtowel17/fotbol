// '#/drill': freeze-frame drills (RESEARCH 7.1 rows 1-5, 7.2, 9.2 item 7).
//
//   #/drill               the first unfinished module for your role
//   #/drill/M2            one module
//   #/drill/p/D3          one principle
//   #/drill/s/<id>        one scenario first, then its module
//
// A session is SESSION_DEFAULTS.reps reps, then a summary. One rep:
//   brief  → the t = 0 picture, the brief, your role and the principle; "Watch"
//   watch  → playback to the freeze (you are fixed at your start spot: caught watching), 0.5x / 1x, restart
//   place  → the question; drag YOU (untimed), optional Sure / Not sure, "Lock in" (or Enter)
//   cue    → beat 1: the cue question and its highlight on the pitch; "Show me"
//   full   → beat 2: ghost, zone, heatmap and the fix arrow; score, reasons, takeaway, misconception
//   replay → the continuation with you where you stood and the ghost, so you see what happens
// Each rep updates Elo (score / 100 as partial credit), the history and the streaks (js/ui/session.js), and
// earns rewards (XP, stars, badges, sticker cards: js/ui/rewards-store.js), shown with beat 2 and summed up
// on the summary (the reward functions below lockIn; the visuals are js/ui/celebrate.js).
// Scenarios are played in your role: a scenario authored on the other side is mirrored left↔right.
// Leave mid-session and come back (same practice, same role, same tab): "Carry on (rep N of 6)" picks the
// session up again. On a phone held upright the pitch is cropped to the length the rep's play needs.

import { el, button, icon, linkButton, notice, stageLayout, segmented, announce } from '../components.js';
import { BALL_ID } from '../board.js';
import { createFeedbackPanel, gradeColor, starRating, principleChip, principleLabel } from '../reveal.js';
import { frameAt, learnerBaseAt, timing } from '../../engine/timeline.js';
import { normalizeScenario, mirrorScenario, validateScenario, learnerId as learnerIdOf } from '../../engine/scenario.js';
import { buildContext } from '../../engine/context.js';
import { computeGhost } from '../../engine/ghost.js';
import { toleranceFor } from '../../engine/score.js';
import { judgeSpot } from '../../engine/analyse.js';
import { update as eloUpdate, mastery } from '../../engine/elo.js';
import { createFormation } from '../../engine/formation.js';
import { ROLE_INFO, mirrorRole } from '../../engine/roles.js';
import { dist } from '../../engine/geometry.js';
import { cardTier, starsForScore } from '../../rewards.js';
import { award, loadRewards, refreshRewards, mergeGains, cleanGains, emptyGains } from '../rewards-store.js';
import { sessionCard } from '../celebrate.js';
import * as S from '../session.js';

export const DRILL_DEFAULTS = Object.freeze({
  speeds: Object.freeze([0.5, 1]), // [S] task spec: playback at 0.5x or 1x
  maxFrameDt: 0.1, // [D] s of play per animation frame at most (a hidden tab must not jump to the freeze)
  replayLead: 3, // [D] s of lead-up replayed when a scenario has no continuation after the freeze
  replayHold: 900, // [D] ms the last replay frame holds before the freeze picture comes back
  minContinuation: 0.5, // [D] s: shorter continuations replay the lead-up instead
  loadAttempts: 4, // [D] scenarios tried before a rep gives up (a missing or invalid file is skipped)
  focusStep: 0.5, // [D] s between the frames sampled for the pitch length a rep keeps in view on a phone (board.setFocus)
});

// Playback speed survives route changes for this page session.
let preferredSpeed = 1;

// An unfinished session survives leaving the drill (a look at Progress, a principle page) and a reload, for this
// browser tab: sessionStorage, with this module's memory as the fallback when storage is blocked. One session
// is kept; session.js resumableSession decides whether it can be carried on (same practice, same role, recent).
const RESUME_STORAGE_KEY = 'fotbol:drill-session';
let resumeMemory = null;
function readSavedSession() {
  try {
    const raw = globalThis.sessionStorage?.getItem(RESUME_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* blocked or corrupt: fall back to memory */ }
  return resumeMemory;
}
function writeSavedSession(value) {
  resumeMemory = value;
  try {
    if (value) globalThis.sessionStorage?.setItem(RESUME_STORAGE_KEY, JSON.stringify(value));
    else globalThis.sessionStorage?.removeItem(RESUME_STORAGE_KEY);
  } catch { /* memory only */ }
}

const COPY = {
  standard: {
    label: 'Drill',
    rep: (i, n) => `Rep ${i} of ${n}`,
    you: 'You play',
    focus: 'Focus',
    watch: 'Watch',
    watchLead: 'Watch how the play develops. It freezes at the moment that matters.',
    watching: 'Watch the play…',
    pause: 'Pause', resume: 'Play', restart: 'From the start', speed: 'Speed', skip: 'Skip this one',
    question: 'Where should you be now?',
    placeHint: 'Drag YOU to where you should be, then lock in.',
    keysHint: 'Keyboard: Tab to YOU, arrow keys to move (hold Shift for bigger steps), Enter to lock in. Touch: tap YOU, then tap a spot.',
    confidence: 'How sure are you?', sure: 'Sure', unsure: 'Not sure',
    lockIn: 'Lock in', watchAgain: 'Watch again',
    replay: 'Replay', replaying: 'Replaying from the freeze: you stay where you stood, the blue ring is the best spot.',
    next: 'Next rep', finish: 'See your session',
    legend: 'Blue ring: the best spot. Shaded oval: your zone. Arrow: the move that fixes it.',
    confidentMiss: 'You were sure about this one, so it is worth a second look.',
    frozen: (q) => `Play frozen. ${q}`,
    mirrored: 'Played on your side of the pitch.',
    otherRole: (role) => `No drills for your position here yet, so you play the ${role} in this one.`,
    extraRole: (role) => `A change of view: no more drills for your position here this session, so this time you play as the ${role}.`,
    loading: 'Setting up the drill…',
    loadFailed: 'This drill could not be loaded, so here is another one.',
    emptyTitle: 'Drills are on their way',
    emptyText: 'There are no drills to play here yet. Explore mode lets you practise any situation in the meantime.',
    explore: 'Go to Explore', home: 'Back to home',
    missingTitle: 'That drill could not be found',
    missingText: 'The link may be old, or the drill was renamed. Every drill is still there in the modules.',
    allDrills: 'Play the drills',
    moduleLabel: (m) => m,
    principleLabel: (name) => `Principle: ${name}`,
    practising: 'Practising',
    change: 'Change what you practise',
    mixed: 'Mixed',
    // summary
    doneTitle: 'Session complete',
    average: 'Session score',
    yourReps: 'Your reps',
    principles: 'Principles you worked on',
    newStar: 'New star!',
    streakReps: (n) => `${n} good ${n === 1 ? 'rep' : 'reps'} in a row`,
    streakDays: (n) => `${n} ${n === 1 ? 'day' : 'days'} played this week`,
    bestRun: (n) => `Best run this session: ${n}`,
    keepGoing: 'Keep going',
    practise: (name) => `Practise ${name}`,
    readUp: (name) => `Read about ${name}`,
    progress: 'Your progress',
    notSaved: 'This browser cannot save progress (private mode or blocked storage), so this session is not kept.',
    verdict: { S: 'Outstanding session.', A: 'Great session.', B: 'Good session.', C: 'Getting there.', D: 'A tough one: keep at it.', F: 'A tough one: every rep teaches something.' },
    repScore: (title, score, grade) => `${title}: ${score}, grade ${grade}`,
    repSr: (score, grade) => `${score} points, grade ${grade}. `,
    // carrying on a session you left
    resumeTitle: 'Carry on where you left off?',
    resumeLead: (n, total) => `You played ${n} of ${total} reps in this session before you left. Carry on to finish it and see your summary, or start a new session.`,
    resumeGo: 'Carry on', // the kicker above says which rep is next
    resumeNew: 'Start a new session',
  },
  kid: {
    label: 'Drill',
    rep: (i, n) => `Go ${i} of ${n}`,
    you: 'You are',
    focus: 'Idea',
    watch: 'Watch',
    watchLead: 'Watch the play. It stops at the important moment.',
    watching: 'Watch…',
    pause: 'Pause', resume: 'Play', restart: 'Start again', speed: 'Speed', skip: 'Skip',
    question: 'Where should you be now?',
    placeHint: 'Drag YOU to the best spot. Then press Lock in.',
    keysHint: 'Keyboard: press Tab to pick YOU, arrow keys to move, Enter to lock in. Touch: tap YOU, then tap a spot.',
    confidence: 'Are you sure?', sure: 'Sure', unsure: 'Not sure',
    lockIn: 'Lock in', watchAgain: 'Watch again',
    replay: 'Watch what happens', replaying: 'Watch what happens next. The blue ring is the best spot.',
    next: 'Next', finish: 'See how you did',
    legend: 'Blue ring: best spot. Oval: your area. Arrow: where to move.',
    confidentMiss: 'You were sure about this one. Remember this idea!',
    frozen: (q) => `The play stopped. ${q}`,
    mirrored: 'Played on your side.',
    otherRole: (role) => `No drills for your position here yet, so you are the ${role} this time.`,
    extraRole: (role) => `Try another position: this time you are the ${role}.`,
    loading: 'Getting ready…',
    loadFailed: 'That one did not load, so here is another.',
    emptyTitle: 'Drills are coming soon',
    emptyText: 'There are no drills here yet. Try Explore: move the ball and find your spot.',
    explore: 'Go to Explore', home: 'Back to home',
    missingTitle: 'We could not find that drill',
    missingText: 'Try the other drills instead.',
    allDrills: 'Play drills',
    moduleLabel: (m) => m,
    principleLabel: (name) => `Idea: ${name}`,
    practising: 'Practising',
    change: 'Pick something else',
    mixed: 'Mixed',
    doneTitle: 'All done!',
    average: 'Your score',
    yourReps: 'How each one went',
    principles: 'Ideas you practised',
    newStar: 'New star!',
    streakReps: (n) => `${n} good ${n === 1 ? 'one' : 'ones'} in a row`,
    streakDays: (n) => `${n} ${n === 1 ? 'day' : 'days'} this week`,
    bestRun: (n) => `Best run: ${n}`,
    keepGoing: 'Play more',
    practise: (name) => `Practise ${name}`,
    readUp: (name) => `Learn about ${name}`,
    progress: 'My progress',
    notSaved: 'This browser cannot save your progress, so this time is not kept.',
    verdict: { S: 'Amazing!', A: 'Great job!', B: 'Good job!', C: 'Nearly there!', D: 'Keep practising!', F: 'Keep going, you are learning!' },
    repScore: (title, score, grade) => `${title}: ${score}, grade ${grade}`,
    repSr: (score, grade) => `${score} points, grade ${grade}. `,
    resumeTitle: 'Keep going?',
    resumeLead: (n, total) => `You did ${n} of ${total} goes before you left. Finish them, or start again.`,
    resumeGo: 'Keep going',
    resumeNew: 'Start again',
  },
};

/** A small flame (streaks). Decorative. */
export function flameIcon(size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.setAttribute('class', 'dr-flame');
  s.innerHTML = '<path d="M12.6 2.5c.4 3-1.4 4.6-2.9 6.2C8 10.4 6.5 12.1 6.5 14.8a5.5 5.5 0 0 0 11 0c0-2.6-1.3-4.3-2.3-5.5-.2 1.4-.9 2.4-1.9 2.9.5-3.4-.2-7-2.7-9.7z"/><path class="dr-flame-core" d="M12 21a3 3 0 0 1-3-3c0-1.7 1.3-2.6 2.2-3.8.4 1 .9 1.5 1.6 1.8.2-.7.2-1.4 0-2.2 1.2 1 2.2 2.2 2.2 4.2a3 3 0 0 1-3 3z"/>';
  return s;
}

/** replaceChildren() that skips null / false (native replaceChildren would print "null"). */
const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app, params = []) {
  const P = DRILL_DEFAULTS;
  const formations = app.data.formations ?? (() => { const f = createFormation(); return { us: f, them: f }; })();
  const principles = app.data.principles?.byId ?? {};
  const index = app.data.scenarios?.index ?? [];
  const wording = () => (app.settings.wording === 'kid' ? 'kid' : 'standard');
  const C = () => COPY[wording()];
  const store = app.store;
  const role = app.settings.role;
  const route = S.parseDrillRoute(params);

  let alive = true;
  const cleanups = [];
  root.classList.add('dr');

  // ---- what this session practises
  const plan = resolvePlan();
  function resolvePlan() {
    const skills = S.loadSkills(store);
    const mods = S.drillModules(app.data.curriculum);
    const modTitle = (id) => mods.find((m) => m.id === id)?.title ?? id;
    if (route.kind === 'principle') {
      let c = S.candidatesFor({ index, role, principle: route.id });
      const anyRole = !c.length;
      if (anyRole) c = S.candidatesFor({ index, role, principle: route.id, anyRole: true });
      const name = principleName(route.id);
      const extra = anyRole ? [] : S.extraCandidates(c, S.candidatesFor({ index, role, principle: route.id, anyRole: true }));
      return { kind: 'principle', principle: route.id, module: null, candidates: c, extra, anyRole, label: C().principleLabel(name) };
    }
    if (route.kind === 'scenario') {
      const meta = app.data.scenarios?.meta?.(route.id.replace(/-m$/, '')) ?? null;
      const module = meta?.module ?? null;
      let c = module ? S.candidatesFor({ index, role, module }) : [];
      const anyRole = !c.length && !!module;
      if (anyRole) c = S.candidatesFor({ index, role, module, anyRole: true });
      const extra = anyRole || !module ? [] : S.extraCandidates(c, S.candidatesFor({ index, role, module, anyRole: true }));
      return { kind: 'scenario', first: route.id, module, candidates: c, extra, anyRole, label: module ? modTitle(module) : '' };
    }
    let module = route.kind === 'module' ? route.id : null;
    let anyRole = false;
    if (!module || !mods.some((m) => m.id === module)) ({ id: module, anyRole } = S.autoModule({ curriculum: app.data.curriculum, index, skills, role }));
    let c = module ? S.candidatesFor({ index, role, module }) : [];
    if (!c.length && module) { c = S.candidatesFor({ index, role, module, anyRole: true }); anyRole = c.length > 0; }
    const extra = anyRole || !module ? [] : S.extraCandidates(c, S.candidatesFor({ index, role, module, anyRole: true }));
    return { kind: 'module', module, candidates: c, extra, anyRole, label: module ? `${module} · ${modTitle(module)}` : '' };
  }

  /** A principle's short name (its kidName in Kid wording). */
  function principleName(id) {
    return principleLabel(principles[id], wording()) || id;
  }
  /** A scenario's (or a played rep's) title in the current wording. */
  const titleOf = (s) => S.wordingOf(s?.title, wording(), s?.titleKid) || s?.title || '';

  // ---- stage state (declared before anything can tear the stage down)
  let layout = null, board = null, panel = null;
  const els = {};
  const session = { reps: [], played: [], before: S.loadSkills(store), skills: S.loadSkills(store), streak: S.loadStreak(store), repsTotal: S.SESSION_DEFAULTS.reps, gained: emptyGains() };
  let rep = null; // the current rep
  let raf = 0, holdTimer = 0;
  let lastInputWasKeyboard = false;
  const play = { paused: false, speed: preferredSpeed };
  // A session of this same practice left unfinished (in this tab): offered back before the first rep.
  const sessionKey = S.drillSessionKey(plan, role);
  const savedSession = readSavedSession();
  let resumeOffer = S.resumableSession(savedSession, { key: sessionKey, now: Date.now() });
  if (resumeOffer) resumeOffer.gained = cleanGains(savedSession?.gained); // what the reps so far earned (the summary adds it up)

  /** Keep the session so far (after each rep), or forget it once it is complete. */
  function saveSession() {
    if (session.reps.length >= session.repsTotal) { writeSavedSession(null); return; }
    writeSavedSession({ key: sessionKey, reps: session.reps, played: session.played, before: session.before, repsTotal: session.repsTotal, gained: session.gained, at: Date.now() });
  }

  if (!plan.candidates.length && plan.kind !== 'scenario') {
    renderEmpty();
    return () => { alive = false; };
  }

  function buildStage() {
    root.replaceChildren();
    layout = stageLayout(root, { label: `${C().label}: instructions and feedback` });
    board = app.createBoard(layout.board, { orientation: S.orientationFor(window.innerWidth, window.innerHeight) });
    board.setOverlays({ thirds: false, lanes: false, zone14: false, offsideLine: null, backLine: null });
    els.kicker = el('div', { class: 'dr-kicker' });
    els.title = el('h1', { class: 'dr-title' });
    els.lead = el('div', { class: 'dr-lead' });
    els.reveal = el('div', { class: 'dr-reveal' });
    els.after = el('div', { class: 'dr-after' });
    layout.panel.head.append(els.kicker, els.title, els.lead, els.reveal, els.after);
    panel = createFeedbackPanel(els.reveal, { app });
    els.body = el('div', { class: 'dr-body' });
    layout.panel.body.append(els.body);
  }

  // ---- header pieces
  function renderKicker() {
    const c = C();
    // After lock-in the rep just played is still the current one; its grade shows once beat 2 reveals it.
    const judged = !!rep?.judged && session.reps.length > 0;
    const current = judged ? session.reps.length - 1 : session.reps.length;
    const revealed = rep?.phase === 'full' || rep?.phase === 'replay';
    const dots = el('ol', { class: 'dr-dots', 'aria-hidden': 'true' }, Array.from({ length: session.repsTotal }, (_, i) => {
      const done = session.reps[i] && (i < current || revealed) ? session.reps[i] : null;
      return el('li', {
        class: ['dr-dot', done && 'is-done', i === current && !done && 'is-current'],
        style: done ? { '--grade': gradeColor(done.grade) } : null,
        title: done ? c.repScore(titleOf(done), done.score, done.grade) : null,
      }, [done ? el('span', { text: done.grade }) : null]);
    }));
    const streak = session.streak.reps.current;
    put(els.kicker,
      el('span', { class: 'dr-where', text: [plan.label, c.rep(Math.min(current + 1, session.repsTotal), session.repsTotal)].filter(Boolean).join(' · ') }),
      dots,
      streak >= 2 && (revealed || !judged) ? el('span', { class: 'dr-streak', title: c.streakReps(streak) }, [flameIcon(16), el('span', { 'aria-hidden': 'true', text: String(streak) }), el('span', { class: 'visually-hidden', text: c.streakReps(streak) })]) : null,
    );
  }

  function setActions(nodes) {
    layout.panel.actions.replaceChildren(...nodes.filter(Boolean));
  }

  function renderBody() {
    const c = C();
    const mods = S.drillModules(app.data.curriculum);
    const links = mods.map((m) => el('a', { class: ['dr-switch', plan.module === m.id && plan.kind === 'module' && 'is-current'], href: `#/drill/${m.id}` }, [el('b', { text: m.id }), el('span', { text: m.title })]));
    put(els.body, 
      el('p', { class: 'dr-keys', text: c.keysHint }),
      mods.length ? el('nav', { class: 'dr-switches', 'aria-label': c.change }, [el('p', { class: 'dr-h', text: c.change }), el('div', { class: 'dr-switch-list' }, links)]) : null,
    );
  }

  // ---- board helpers
  function drawFrame(frame, extra = {}) {
    board.render(frame, { learnerId: rep.learnerId, highlight: [BALL_ID], ...extra });
  }
  function clearOverlays() {
    board.setGhost(null);
    board.setZone(null);
    board.setHeatmap(null);
    board.setMarkers([]);
  }
  const frameWithSpot = (frame, spot) => ({ ...frame, players: frame.players.map((p) => (p.id === rep.learnerId ? { ...p, x: spot.x, y: spot.y } : p)) });

  function stopPlayback() {
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(holdTimer);
    holdTimer = 0;
  }

  /**
   * The picture at time t with the learner's token at `spot`. Everybody else comes from the free
   * playback (the learner held back at their automatic spot), exactly the frame `npm run check`, the
   * author tool and judge() use, so where you stand never changes what the others do (or your score).
   */
  const pictureAt = (t, spot) => frameWithSpot(frameAt(rep.scenario, t, { formations }), spot);

  /** Play [from, to] with the learner shown at `spot`; onTick(t) each frame, onEnd at `to`. */
  function playRange({ from, to, spot, onTick, onEnd }) {
    stopPlayback();
    play.paused = false;
    let t = from, last = null;
    const step = (now) => {
      if (!alive || !rep) return;
      if (last !== null && !play.paused) t = Math.min(to, t + Math.min(P.maxFrameDt, (now - last) / 1000) * play.speed);
      last = now;
      drawFrame(pictureAt(t, spot));
      onTick?.(t);
      if (t >= to - 1e-9) { raf = 0; onEnd?.(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // ---- loading a rep
  async function nextRep() {
    stopPlayback();
    rep = null;
    board.disableDrag();
    clearOverlays();
    panel.clear();
    put(els.after);
    renderKicker();
    els.title.textContent = C().loading;
    put(els.lead);
    setActions([]);

    let ref = null, scenario = null;
    const tried = new Set();
    // '#/drill/s/<id>' opens with that scenario; every other rep is picked by Elo (session.js pickScenario).
    if (session.reps.length === 0 && plan.first) {
      ref = await refForScenario(plan.first);
      if (!alive) return;
      if (ref) { tried.add(ref.baseId); scenario = await loadScenario(ref); }
      if (!alive) return;
      if (scenario) plan.firstRef = ref;
    }
    // Your role's scenarios first, then (rather than an instant repeat) the module's others in their
    // own roles; a scenario opened by link that no module lists (a template, a draft) simply repeats.
    const own = plan.candidates.length ? plan.candidates : plan.firstRef ? [plan.firstRef] : [];
    for (let attempt = 0; attempt < P.loadAttempts && !scenario; attempt++) {
      const pool = S.repPool(own, plan.extra ?? [], session.played);
      ref = S.pickScenario(session.skills, pool.filter((c) => !tried.has(c.baseId)), { exclude: session.played });
      if (!ref) break;
      tried.add(ref.baseId);
      scenario = await loadScenario(ref);
      if (!alive) return;
      if (!scenario) announce(C().loadFailed);
    }
    if (!scenario) {
      // Nothing more could be loaded: finish with what was played rather than strand the learner.
      if (session.reps.length) { session.repsTotal = session.reps.length; showSummary(); } else renderEmpty();
      return;
    }
    startRep(ref, scenario);
  }

  /** A ref for '#/drill/s/<id>': from the index when listed, else from the file itself. */
  async function refForScenario(id) {
    const baseId = id.replace(/-m$/, '');
    const listed = S.candidatesFor({ index, role, scenarioId: baseId })[0] ?? S.candidatesFor({ index, role, scenarioId: baseId, anyRole: true })[0];
    if (listed) return listed;
    try {
      const raw = await app.data.scenarios.load(baseId);
      const r = S.authoredRole(raw);
      const how = S.playAs(r, role) ?? (/-m$/.test(id) ? { mirror: true, role: mirrorRole(r) } : { mirror: false, role: r });
      return {
        id: how.mirror ? `${raw.id}-m` : raw.id, baseId: raw.id, file: baseId, mirror: how.mirror, role: how.role, authoredRole: r,
        principles: raw.principles ?? [], module: raw.module ?? null, difficulty: Number.isFinite(raw.difficulty) ? raw.difficulty : 0, title: raw.title ?? raw.id,
      };
    } catch (err) {
      console.warn('[fotbol] drill: scenario not found', id, err);
      return null;
    }
  }

  async function loadScenario(ref) {
    try {
      const raw = await app.data.scenarios.load(ref.file ?? ref.baseId);
      const errors = validateScenario(raw, { principles });
      if (errors.length) { console.warn(`[fotbol] drill: ${ref.baseId} is not valid`, errors); return null; }
      const n = normalizeScenario(raw);
      return ref.mirror ? mirrorScenario(n) : n;
    } catch (err) {
      console.warn('[fotbol] drill: could not load', ref.baseId, err);
      return null;
    }
  }

  function startRep(ref, scenario) {
    const { duration, freezeAt } = timing(scenario);
    const learnerId = learnerIdOf(scenario);
    const probe = frameAt(scenario, 0, { formations });
    const auto = probe.players.find((p) => p.id === learnerId);
    const start = scenario.learner.start ? { ...scenario.learner.start } : { x: auto.x, y: auto.y };
    rep = { ref, scenario, learnerId, duration, freezeAt, start, spot: { ...start }, confidence: null, phase: 'brief', judged: null, decisionStart: 0 };
    rep.focus = repFocus(rep);
    board.setFocus(rep.focus);
    session.played.push(ref.baseId);
    showBrief();
  }

  /**
   * The pitch length this rep needs in view: the ball and every outfield player over the whole playback, your
   * start spot and your base at the freeze (the answer is searched round it). A phone held upright crops the
   * rest of the length, so the play draws bigger (board.js setFocus); a bigger board shows the whole pitch.
   */
  function repFocus(r) {
    const xs = [r.start.x, learnerBaseAt(r.scenario, r.freezeAt, { formations }).x];
    if (r.scenario.answer?.ideal) xs.push(r.scenario.answer.ideal.x);
    for (let t = 0; t < r.duration + P.focusStep; t += P.focusStep) {
      const f = frameAt(r.scenario, Math.min(t, r.duration), { formations });
      xs.push(f.ball.x);
      for (const p of f.players) if (p.role !== 'GK') xs.push(p.x);
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs) };
  }

  /** Keep these spots in view too (a keyboard nudge or a drag can take you past the edge; the answer may lie beyond). */
  function keepInView(...spots) {
    if (!rep?.focus) return;
    const xs = spots.filter((p) => Number.isFinite(p?.x)).map((p) => p.x);
    board.setFocus({ x0: Math.min(rep.focus.x0, ...xs), x1: Math.max(rep.focus.x1, ...xs) });
  }

  // ---- phases
  // Each renderer takes { refocus }: false when it only re-phrases the screen for a settings change, so focus
  // stays where the learner is (e.g. in the open settings menu) and nothing replays.
  function showBrief({ refocus = true } = {}) {
    const c = C();
    rep.phase = 'brief';
    if (refocus) layout.panel.head.scrollTop = 0;
    stopPlayback();
    board.disableDrag();
    clearOverlays();
    panel.clear();
    renderKicker();
    const s = rep.scenario;
    els.title.textContent = titleOf(s);
    const primary = s.principles?.[0];
    const p = primary ? principles[primary] : null;
    const roleLabel = ROLE_INFO[s.learner.role]?.label ?? s.learner.role;
    put(els.lead,
      el('p', { class: 'dr-brief', text: S.wordingOf(s.brief, wording(), s.briefKid) || c.watchLead }),
      el('div', { class: 'dr-chips' }, [
        el('span', { class: 'dr-role' }, [el('b', { text: ROLE_INFO[s.learner.role]?.short ?? '' }), el('span', {}, [el('span', { class: 'visually-hidden', text: `${c.you}: ` }), roleLabel])]),
        primary ? principleChip({ id: primary, label: principleName(primary), name: p?.name ?? primary, href: null }, { wording: wording(), className: 'dr-focus' }) : null,
      ]),
      rep.ref.extra ? el('p', { class: 'dr-note', text: c.extraRole(roleLabel.toLowerCase()) })
        : rep.ref.role !== role && !rep.ref.mirror ? el('p', { class: 'dr-note', text: c.otherRole(roleLabel.toLowerCase()) }) : null,
    );
    put(els.after);
    drawFrame(pictureAt(0, rep.start));
    board.setMarkers([{ type: 'ring', id: rep.learnerId, tone: 'info', pulse: true }]);
    const watch = button(c.watch, { variant: 'primary', icon: 'play', className: 'dr-main', onClick: () => showWatch() });
    setActions([watch, button(c.skip, { variant: 'ghost', className: 'dr-skip', onClick: skip })]);
    renderBody();
    if (refocus) watch.focus({ preventScroll: true });
  }

  function speedControl() {
    const c = C();
    return el('div', { class: 'dr-speed' }, [segmented({
      legend: c.speed, hideLegend: true, value: String(play.speed),
      options: P.speeds.map((v) => ({ value: String(v), label: `${v}×` })),
      onChange: (v) => { play.speed = Number(v); preferredSpeed = play.speed; },
    })]);
  }

  function showWatch({ keepSpot = false } = {}) {
    const c = C();
    rep.phase = 'watch';
    board.disableDrag();
    clearOverlays();
    panel.clear();
    els.title.textContent = titleOf(rep.scenario);
    const bar = el('span', { class: 'dr-progress-fill' });
    put(els.lead, 
      el('p', { class: 'dr-brief', text: c.watching }),
      el('div', { class: 'dr-progress', role: 'progressbar', 'aria-label': c.watching, 'aria-valuemin': '0', 'aria-valuemax': '100' }, [bar]),
    );
    const pauseBtn = button(c.pause, { icon: 'pause', 'aria-pressed': 'false', className: 'dr-pause', onClick: () => {
      play.paused = !play.paused;
      pauseBtn.setAttribute('aria-pressed', String(play.paused));
      pauseBtn.replaceChildren(icon(play.paused ? 'play' : 'pause'), el('span', { text: play.paused ? c.resume : c.pause }));
    } });
    // The button that started the playback (Watch, Watch again, From the start) goes with the old action bar:
    // keep focus in the bar, on Pause, so a keyboard user can pause or restart without hunting for it.
    const hadFocus = layout.panel.actions.contains(document.activeElement);
    setActions([pauseBtn, button(c.restart, { variant: 'ghost', onClick: () => showWatch({ keepSpot }) }), speedControl()]);
    if (hadFocus || !document.activeElement || document.activeElement === document.body) pauseBtn.focus({ preventScroll: true });
    const saved = keepSpot ? { ...rep.spot } : null;
    let lastPct = -1;
    playRange({
      from: 0, to: rep.freezeAt, spot: rep.start,
      onTick: (t) => {
        const pct = Math.round((100 * t) / Math.max(rep.freezeAt, 1e-6));
        if (pct !== lastPct) { lastPct = pct; bar.style.width = `${pct}%`; bar.parentElement.setAttribute('aria-valuenow', String(pct)); }
      },
      onEnd: () => {
        app.sound?.play('whistle'); // the referee's whistle: play freezes here
        showPlace(saved);
      },
    });
  }

  function showPlace(savedSpot = null, { refocus = true } = {}) {
    const c = C();
    const fresh = rep.phase !== 'place'; // a re-render (wording change) keeps the decision timer and says nothing new
    rep.phase = 'place';
    if (refocus) layout.panel.head.scrollTop = 0;
    stopPlayback();
    clearOverlays();
    panel.clear();
    const s = rep.scenario;
    rep.freezeFrame = pictureAt(rep.freezeAt, rep.start);
    if (savedSpot) rep.spot = savedSpot; else rep.spot = { ...rep.start };
    if (fresh) rep.decisionStart = performance.now();
    const question = S.wordingOf(s.question, wording(), s.questionKid) || c.question;
    els.title.textContent = titleOf(s);
    const conf = (value, label) => el('button', {
      type: 'button', class: ['dr-conf-btn', rep.confidence === value && 'is-on'], 'aria-pressed': String(rep.confidence === value),
      onclick: (e) => {
        rep.confidence = rep.confidence === value ? null : value;
        for (const b of e.currentTarget.parentElement.querySelectorAll('button')) {
          const on = b.dataset.value === rep.confidence;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        }
      },
      dataset: { value },
    }, [label]);
    const confId = `dr-conf-${Math.random().toString(36).slice(2, 7)}`;
    put(els.lead,
      el('p', { class: 'dr-question', text: question }),
      el('p', { class: 'dr-hint', text: c.placeHint }),
      el('div', { class: 'dr-conf-row' }, [
        el('span', { id: confId, class: 'dr-conf-label', text: c.confidence }),
        el('div', { class: 'dr-conf', role: 'group', 'aria-labelledby': confId }, [conf('sure', c.sure), conf('unsure', c.unsure)]),
      ]),
    );
    const lock = button(c.lockIn, { variant: 'primary', icon: 'check', className: 'dr-main', onClick: lockIn });
    setActions([
      button(c.watchAgain, { icon: 'play', onClick: () => showWatch({ keepSpot: true }) }),
      lock,
    ]);
    drawPlace();
    board.enableDrag({ ids: [rep.learnerId], onMove: onDrag, onEnd: onDrop });
    if (!refocus) return;
    if (fresh) announce(c.frozen(question));
    // Keyboard users land on their own token, ready to nudge it; everyone else sees the Lock in button.
    const token = board.el.querySelector(`.token[data-id="${rep.learnerId}"]`);
    if (lastInputWasKeyboard && token) token.focus({ preventScroll: true });
    else lock.focus({ preventScroll: true });
  }

  function onDrag(_id, p) {
    if (rep?.phase !== 'place') return;
    rep.spot = { x: p.x, y: p.y };
    drawPlace();
  }
  /** A drop or a keyboard nudge: the spot is final for now, so a phone keeps it in view (never mid-drag). */
  function onDrop(id, p) {
    onDrag(id, p);
    if (rep?.phase === 'place') keepInView(rep.spot);
  }
  function drawPlace() {
    drawFrame(frameWithSpot(rep.freezeFrame, rep.spot));
  }

  function lockIn() {
    if (rep?.phase !== 'place') return;
    const s = rep.scenario;
    rep.decisionMs = Math.round(performance.now() - rep.decisionStart);
    board.disableDrag();
    rep.judged = judge(rep.spot);
    const { result } = rep.judged.judgement;
    // Elo, history, streaks.
    const before = session.skills;
    session.skills = eloUpdate(before, { itemId: rep.ref.baseId, principles: s.principles, role: s.learner.role, score01: result.score / 100, prior: Number.isFinite(s.difficulty) ? s.difficulty : 0 });
    S.saveSkills(store, session.skills);
    session.streak = S.updateStreak(session.streak, { day: S.dayKey(new Date()), score: result.score });
    S.saveStreak(store, session.streak);
    S.appendHistory(store, {
      t: Date.now(), mode: 'drill', id: s.id, baseId: rep.ref.baseId, title: s.title, module: s.module ?? null,
      principles: s.principles, role: s.learner.role, score: result.score, grade: result.grade,
      dist: Math.round(dist(rep.spot, rep.judged.ghost.spot) * 10) / 10, ms: rep.decisionMs, confidence: rep.confidence,
      misconception: rep.judged.misconception?.id ?? null, mirrored: !!rep.ref.mirror,
      reasons: rep.judged.judgement.feedback.reasons.map((r) => r.ruleId),
    });
    rep.gained = rewardRep(s, result);
    session.reps.push({ id: s.id, baseId: rep.ref.baseId, title: s.title, ...(s.titleKid ? { titleKid: s.titleKid } : {}), score: result.score, grade: result.grade, principles: s.principles });
    saveSession();
    showCue();
  }

  // ---- rewards (ARCHITECTURE §5.13): awarded when a rep is judged, shown with beat 2 (beat 1 never gives the grade away)
  /** The rep's XP and stars, then a sticker card for each of its principles whose mastery (updated Elo) went up. */
  function rewardRep(s, result) {
    let gained = award(app, { type: 'rep', scenarioId: s.id, role: s.learner.role, grade: result.grade, score: result.score }, { celebrate: false });
    for (const id of s.principles ?? []) {
      const stars = mastery(session.skills, id);
      if (stars > cardTier(loadRewards(app), id)) gained = mergeGains(gained, award(app, { type: 'mastery', principleId: id, stars }, { celebrate: false }));
    }
    session.gained = mergeGains(session.gained, gained);
    return gained;
  }

  /** Beat 2's reward row (stars, XP, badges, stickers) under the grade: celebrated once, redrawn quietly after.
   *  The header's level pill catches up now too (the award at lock-in held it back). */
  function rewardSlot(fresh) {
    if (!rep?.gained) return null;
    const slot = el('div', { class: 'dr-reward' });
    queueMicrotask(() => {
      app.celebrate?.show(rep.gained, { grade: rep.judged?.judgement.result.grade ?? null, host: slot, quiet: !fresh });
      if (fresh) refreshRewards(app);
    });
    return slot;
  }

  /** The session bonus: its sounds, burst and level-up now (the summary card shows the XP). */
  function rewardSession(grade) {
    // The session's stars come from the scores (rewards.js starsForScore), like each rep's.
    const gained = award(app, { type: 'session', scores: session.reps.map((r) => r.score), grades: session.reps.map((r) => r.grade) }, { grade, card: false });
    session.gained = mergeGains(session.gained, gained);
  }

  /** The summary's rewards card: XP this session, the stars won, the level bar, the badges and stickers. */
  function sessionRewards() {
    const stars = session.reps.reduce((a, r) => a + starsForScore(r.score), 0); // as each rep's award counted them
    return sessionCard({ gained: session.gained, stars, maxStars: session.reps.length * 3, state: loadRewards(app) }, { wording: wording(), principles });
  }

  /**
   * Score the spot at the freeze (ARCHITECTURE §5.3: frameAt + learnerBaseAt + buildContext; §5.10
   * judgeSpot). The frame is the free playback's (the learner held back), with the learner's token
   * moved to the spot: the same context and ghost as scripts/check-scenarios.mjs checkScenario(), so
   * standing on the ghost always scores the ghost's score, wherever you started or dragged.
   */
  function judge(spot) {
    const s = rep.scenario;
    const frame = frameWithSpot(frameAt(s, rep.freezeAt, { formations }), spot);
    const base = learnerBaseAt(s, rep.freezeAt, { formations });
    const ctx = buildContext(frame, { learnerId: rep.learnerId, base });
    const authored = s.answer?.mode === 'authored' && s.answer.ideal;
    const tol = toleranceFor(s.learner.role, s.answer?.tol);
    const ghost = computeGhost(ctx, { base: authored ? s.answer.ideal : base, tol });
    const judgement = judgeSpot({ ctx, ghost }, spot, { wording: wording(), principles });
    return { frame, base, ctx, ghost, judgement, misconception: S.misconceptionAt(s, spot) };
  }

  function showCue({ refocus = true } = {}) {
    rep.phase = 'cue';
    if (refocus) layout.panel.head.scrollTop = 0;
    renderKicker();
    els.title.textContent = titleOf(rep.scenario); // (a wording change re-phrases it)
    const { frame, judgement } = rep.judged;
    drawFrame(frameWithSpot(frame, rep.spot));
    const hl = judgement.feedback.cue?.highlight;
    board.setMarkers(hl ? [{ ...hl, tone: 'cue' }] : []);
    put(els.lead);
    put(els.after);
    setActions([]);
    if (refocus) layout.collapse();
    panel.showCue(judgement, { onReveal: () => showFull(), focus: refocus });
  }

  function showFull({ refocus = true } = {}) {
    const c = C();
    const fresh = rep.phase !== 'full'; // the score counts up and an S celebrates once, not on a re-render
    rep.phase = 'full';
    if (refocus) layout.panel.head.scrollTop = 0;
    stopPlayback();
    renderKicker();
    const { frame, judgement, misconception } = rep.judged;
    const s = rep.scenario;
    els.title.textContent = titleOf(s);
    drawFrame(frameWithSpot(frame, rep.spot));
    keepInView(rep.spot, rep.judged.ghost.spot);
    drawAnswer();
    const primary = s.principles?.[0];
    const takeaway = S.wordingOf(s.takeaway, wording()) || S.wordingOf(principles[primary]?.summary, wording()) || undefined;
    const miscText = misconception ? S.wordingOf(misconception.text, wording(), misconception.textKid) || undefined : undefined;
    put(els.lead);
    // Principle chips stay plain tags mid-session (a link would leave the drill); the summary links out.
    panel.showFull(judgement, { takeaway, misconception: miscText, focus: false, principleLinks: false, animate: fresh, reward: rewardSlot(fresh) });
    const confidentMiss = rep.confidence === 'sure' && judgement.result.score < 60;
    put(els.after, 
      confidentMiss ? el('p', { class: 'dr-note dr-note--sure', text: c.confidentMiss }) : null,
      el('p', { class: 'dr-legend' }, [el('span', { class: 'dr-legend-ring', 'aria-hidden': 'true' }), c.legend]),
    );
    const last = session.reps.length >= session.repsTotal;
    const next = button(last ? c.finish : c.next, { variant: 'primary', icon: 'arrow', className: 'dr-main', onClick: last ? () => showSummary() : () => nextRep() });
    els.replayBtn = button(c.replay, { icon: 'play', className: 'dr-replay', onClick: replay });
    setActions([els.replayBtn, next]);
    if (!refocus) return;
    // Phones: the sheet stays down so the pitch shows the answer; the head scrolls, Next stays in reach.
    layout.collapse();
    next.focus({ preventScroll: true });
  }

  function drawAnswer() {
    const { ghost, judgement } = rep.judged;
    board.setGhost(ghost.spot);
    board.setZone({ center: ghost.result.center, tol: ghost.result.tol });
    board.setHeatmap(ghost.field);
    const markers = [];
    if (dist(rep.spot, ghost.spot) >= 1) markers.push({ type: 'arrow', from: rep.spot, to: ghost.spot, tone: 'fix' });
    const hl = judgement.feedback.cue?.highlight;
    if (hl) markers.push({ ...hl, tone: 'cue', pulse: false });
    board.setMarkers(markers);
  }

  function replay() {
    const c = C();
    if (!rep?.judged) return;
    rep.phase = 'replay';
    layout.collapse();
    els.replayBtn?.setAttribute('disabled', '');
    board.setHeatmap(null);
    board.setZone(null);
    board.setMarkers([]);
    board.setGhost(rep.judged.ghost.spot);
    const hasMore = rep.duration - rep.freezeAt >= P.minContinuation;
    const from = hasMore ? rep.freezeAt : Math.max(0, rep.freezeAt - P.replayLead);
    const to = hasMore ? rep.duration : rep.freezeAt;
    put(els.after, el('p', { class: 'dr-note', text: c.replaying }));
    const done = () => {
      holdTimer = setTimeout(() => {
        if (!alive || rep?.phase !== 'replay') return;
        showFullAgain();
      }, P.replayHold);
    };
    playRange({ from, to, spot: rep.spot, onEnd: done });
  }

  /** Back to beat 2 after a replay (no score count-up again). */
  function showFullAgain() {
    rep.phase = 'full';
    els.replayBtn?.removeAttribute('disabled');
    const { frame } = rep.judged;
    drawFrame(frameWithSpot(frame, rep.spot));
    drawAnswer();
    const c = C();
    put(els.after, el('p', { class: 'dr-legend' }, [el('span', { class: 'dr-legend-ring', 'aria-hidden': 'true' }), c.legend]));
  }

  function skip() {
    if (!rep || rep.phase !== 'brief') return;
    nextRep();
  }

  // ---- carrying on a session left unfinished
  function showResume(saved, { refocus = true } = {}) {
    const c = C();
    rep = null;
    stopPlayback();
    // The session so far fills the rep dots; "Start a new session" puts a fresh one back.
    Object.assign(session, { reps: saved.reps.map((r) => ({ ...r })), played: [...saved.played], before: saved.before, repsTotal: saved.repsTotal, gained: cleanGains(saved.gained) });
    board.disableDrag();
    clearOverlays();
    board.setFocus(null);
    board.render(null);
    panel.clear();
    renderKicker();
    els.title.textContent = c.resumeTitle;
    put(els.lead, el('p', { class: 'dr-brief', text: c.resumeLead(saved.reps.length, saved.repsTotal) }));
    put(els.after);
    const go = button(c.resumeGo, { variant: 'primary', icon: 'arrow', className: 'dr-main', onClick: () => {
      resumeOffer = null;
      nextRep();
    } });
    const fresh = button(c.resumeNew, { variant: 'ghost', onClick: () => {
      resumeOffer = null;
      writeSavedSession(null);
      Object.assign(session, { reps: [], played: [], before: S.loadSkills(store), repsTotal: S.SESSION_DEFAULTS.reps, gained: emptyGains() });
      nextRep();
    } });
    setActions([go, fresh]);
    renderBody();
    if (refocus) go.focus({ preventScroll: true });
  }

  // ---- summary
  function showSummary() {
    stopPlayback();
    writeSavedSession(null);
    const c = C();
    const sum = S.summarizeSession({ reps: session.reps, before: session.before, after: session.skills });
    const today = S.dayKey(new Date());
    const days = S.weekDays(session.streak, today); // days played this week (R35: it only fills up)
    const weakest = sum.weakest;
    const weakName = weakest ? principleName(weakest) : null;
    rewardSession(sum.grade);
    teardownStage();
    const again = plan.kind === 'principle' ? `#/drill/p/${encodeURIComponent(plan.principle)}`
      : plan.module ? `#/drill/${plan.module}` : route.kind === 'scenario' ? `#/drill/s/${encodeURIComponent(plan.first)}` : '#/drill';
    const badge = (grade, cls) => el('span', { class: ['dr-badge', cls], style: { '--grade': gradeColor(grade) }, 'aria-hidden': 'true', text: grade });
    const principleRows = sum.principles.map((p, i) => {
      const up = p.stars[1] > p.stars[0];
      return el('li', { class: ['dr-sum-p', up && 'is-up'], style: { '--i': String(i) } }, [
        el('span', { class: 'dr-sum-p-name' }, [el('b', { text: p.id }), ` ${principleName(p.id)}`]),
        el('span', { class: 'dr-sum-p-stars' }, [
          starRating(p.stars[0], { label: `${p.stars[0]} of 3 stars before` }),
          el('span', { class: 'dr-arrow', 'aria-hidden': 'true', text: '→' }),
          starRating(p.stars[1], { label: `${p.stars[1]} of 3 stars now` }),
          up ? el('span', { class: 'dr-newstar', text: c.newStar }) : null,
        ]),
      ]);
    });
    const view = el('div', { class: 'page dr-summary' }, [
      el('header', { class: 'dr-sum-head' }, [
        el('p', { class: 'dr-sum-kicker', text: plan.label || c.label }),
        el('h1', { text: c.doneTitle }),
      ]),
      el('section', { class: 'dr-sum-score card', 'aria-labelledby': 'dr-sum-score-h' }, [
        badge(sum.grade, 'dr-badge--big'),
        el('div', {}, [
          el('h2', { id: 'dr-sum-score-h', class: 'dr-sum-label', text: c.average }),
          el('p', { class: 'dr-sum-num' }, [el('span', { text: String(sum.average) }), el('span', { class: 'dr-sum-outof', text: '/100' })]),
          el('p', { class: 'dr-sum-verdict', text: c.verdict[sum.grade] ?? '' }),
        ]),
        el('div', { class: 'dr-sum-streaks' }, [
          session.streak.reps.current >= 1 ? el('p', { class: 'dr-sum-streak' }, [flameIcon(20), c.streakReps(session.streak.reps.current)]) : null,
          days >= 1 ? el('p', { class: 'dr-sum-streak dr-sum-streak--days' }, [icon('check', { size: 18 }), c.streakDays(days)]) : null,
          sum.run >= 2 ? el('p', { class: 'dr-sum-run', text: c.bestRun(sum.run) }) : null,
        ]),
      ]),
      sessionRewards(),
      el('section', { class: 'dr-sum-section', 'aria-labelledby': 'dr-sum-reps-h' }, [
        el('h2', { id: 'dr-sum-reps-h', text: c.yourReps }),
        el('ol', { class: 'dr-sum-reps' }, sum.reps.map((r, i) => el('li', { style: { '--i': String(i) } }, [
          badge(r.grade),
          el('span', { class: 'dr-sum-rep-title', text: titleOf(r) }),
          el('span', { class: 'dr-sum-rep-score' }, [el('span', { class: 'visually-hidden', text: c.repSr(r.score, r.grade) }), el('span', { 'aria-hidden': 'true', text: String(r.score) })]),
        ]))),
      ]),
      sum.principles.length ? el('section', { class: 'dr-sum-section', 'aria-labelledby': 'dr-sum-p-h' }, [
        el('h2', { id: 'dr-sum-p-h', text: c.principles }),
        el('ul', { class: 'dr-sum-ps' }, principleRows),
      ]) : null,
      store.isPersistent?.() === false ? el('p', { class: 'dr-note', text: c.notSaved }) : null,
      el('div', { class: 'dr-sum-cta' }, [
        button(c.keepGoing, { variant: 'primary', icon: 'arrow', onClick: () => app.navigate(again) }),
        weakest ? linkButton(c.practise(weakName), `#/drill/p/${encodeURIComponent(weakest)}`, { icon: 'drill' }) : null,
        weakest ? linkButton(c.readUp(weakName), `#/learn/p/${encodeURIComponent(weakest)}`, { variant: 'ghost', icon: 'learn' }) : null,
        linkButton(c.progress, '#/progress', { variant: 'ghost', icon: 'progress' }),
      ]),
    ]);
    root.replaceChildren(view);
    view.querySelector('.dr-sum-cta .btn')?.focus({ preventScroll: true });
    announce(`${c.doneTitle} ${c.average}: ${sum.average}, grade ${sum.grade}.`);
  }

  function renderEmpty() {
    const c = C();
    teardownStage();
    // Never a dead end: a missing scenario offers the drills, a principle with no drill its page.
    const missing = plan.kind === 'scenario';
    const pid = plan.kind === 'principle' ? plan.principle : null;
    root.replaceChildren(notice({
      title: missing ? c.missingTitle : c.emptyTitle,
      text: missing ? c.missingText : c.emptyText,
      actions: [
        missing ? linkButton(c.allDrills, '#/drill', { variant: 'primary', icon: 'drill' }) : linkButton(c.explore, '#/explore', { variant: 'primary', icon: 'explore' }),
        pid && principles[pid] ? linkButton(c.readUp(principleName(pid)), `#/learn/p/${encodeURIComponent(pid)}`, { icon: 'learn' }) : null,
        linkButton(c.home, '#/home'),
      ].filter(Boolean),
    }));
  }

  function teardownStage() {
    stopPlayback();
    panel?.destroy();
    board?.destroy();
    layout?.destroy();
    panel = board = layout = null;
  }

  // ---- keyboard: Enter locks in (unless a control has focus and handles it itself)
  const onKey = (e) => {
    lastInputWasKeyboard = true;
    if (e.key !== 'Enter' || rep?.phase !== 'place' || e.defaultPrevented) return;
    if (e.target?.closest?.('button, a, input, select, textarea, summary, [contenteditable]')) return;
    e.preventDefault();
    lockIn();
  };
  const onPointer = () => { lastInputWasKeyboard = false; };
  const onResize = () => board?.setOrientation(S.orientationFor(window.innerWidth, window.innerHeight));
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('resize', onResize);
  cleanups.push(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer, true); window.removeEventListener('resize', onResize); });

  // ---- wording changes: re-phrase what is on screen, leaving focus (the open settings menu) and the sheet alone
  const offSettings = app.onSettings?.((_s, patch) => {
    if (!alive || !('wording' in (patch ?? {})) || !board) return;
    if (!rep) { if (resumeOffer) showResume(resumeOffer, { refocus: false }); return; }
    if (rep.judged) rep.judged.judgement = judgeSpot({ ctx: rep.judged.ctx, ghost: rep.judged.ghost }, rep.spot, { wording: wording(), principles });
    if (rep.phase === 'brief') showBrief({ refocus: false });
    else if (rep.phase === 'place') showPlace(rep.spot, { refocus: false });
    else if (rep.phase === 'cue') showCue({ refocus: false });
    else if (rep.phase === 'full') showFull({ refocus: false });
    renderBody();
  });
  if (offSettings) cleanups.push(offSettings);

  buildStage();
  renderKicker();
  renderBody();
  if (resumeOffer) showResume(resumeOffer);
  else await nextRep();

  return () => {
    alive = false;
    stopPlayback();
    for (const fn of cleanups) { try { fn(); } catch { /* already gone */ } }
    teardownStage();
  };
}
