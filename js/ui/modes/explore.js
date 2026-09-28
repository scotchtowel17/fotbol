// '#/explore' and '#/explore/<ROLE>': the sandbox, and the purest "the right spot moves with the
// ball" lesson (RESEARCH 9.2 item 6, 3.7). Drag the ball anywhere and all 22 players re-position
// (analyseScene, throttled to animation frames); drag yourself and the score, the hot/cold ring
// and the live "why" tags follow you (judgeSpot). The ideal spot (ghost, zone, heatmap) is hidden
// until you ask for it, so you try first. A light challenge: hold a spot scoring 90+ for half a
// second to find the S spot, then move the ball and find it again.
//
// The scene is kept for the session (module state), so a trip to a principle page and back finds
// the ball where you left it. S-spot counts are saved under the store key 'explore'.

import { el, button, icon, segmented, toggleSwitch, stageLayout, announce, toast, uid } from '../components.js';
import { BALL_ID } from '../board.js';
import { createFeedbackPanel, hotCold, principleChip } from '../reveal.js';
import { analyseScene, judgeSpot } from '../../engine/analyse.js';
import { createFormation, teamTargets } from '../../engine/formation.js';
import { nameOf, kidNameOf } from '../../engine/rules/_util.js';
import { RULES_BY_ID } from '../../engine/rules/index.js';
import { offsideLineX } from '../../engine/rules/offside.js';
import { LEARNABLE_ROLES, ROLE_INFO, playerId } from '../../engine/roles.js';
import { HALF_X, MID_Y, clampToPitch } from '../../engine/pitch.js';
import { dist } from '../../engine/geometry.js';
import { orientationFor } from '../session.js';

export const EXPLORE_DEFAULTS = Object.freeze({
  startBall: Object.freeze({ x: 64, y: 18 }), // [D] ball wide in midfield: every role has a clear job
  startPossession: 'them', // [D]
  kickoffBall: Object.freeze({ x: HALF_X, y: MID_Y }), // [D] you start on your kick-off spot, so there is a spot to find
  sScore: 90, // [S] grade S (score.js GRADE_BANDS)
  holdMs: 500, // [D] hold an S spot this long to count it
  newBallDist: 8, // [D] metres the ball must move after a find before the next find counts
  newBallMin: 18, // [D] "Move the ball for me" moves it at least this far
  newBallArea: Object.freeze({ x0: 12, x1: 93, y0: 5, y1: 63 }), // [D] where "Move the ball for me" puts it
  changeMs: 6000, // [D] how long a "what changed" line stays up
  whyMax: 5, // [D] live "why" tags shown
  passAt: 0.9, // [D] a rule at or above this is a tick (EXPLAIN_DEFAULTS.praiseAt)
  missBelow: 0.6, // [D] below this it is a miss; in between, "nearly"
  ringR: 3.6, // [D] metres: hot/cold ring round your token
  ringFireR: 4.2, // [D] metres: the ring when you are on fire
});

const POSSESSION = ['us', 'them', 'none'];

// ------------------------------------------------------------------ copy

const DUTY = {
  standard: {
    'first-defender': { job: 'Press', who: '1st defender', change: 'You’re now the nearest defender: press the ball!' },
    'second-defender': { job: 'Cover', who: '2nd defender', change: 'You’re now the covering defender: get behind the presser, at an angle.' },
    'third-defender': { job: 'Balance', who: '3rd defender', change: 'You’re now a balancing defender: hold the shape and squeeze toward the ball.' },
    'first-attacker': { job: 'On the ball', who: '1st attacker', change: 'You’re on the ball.' },
    'second-attacker': { job: 'Support', who: '2nd attacker', change: 'You’re now close to the ball: give the player on it a passing option.' },
    'third-attacker': { job: 'Width and depth', who: '3rd attacker', change: 'You’re now away from the ball: stretch them with width and depth.' },
  },
  kid: {
    'first-defender': { job: 'Go to the ball', who: 'closest defender', change: 'You’re the closest now: go to the ball!' },
    'second-defender': { job: 'Back up', who: 'helper', change: 'Now back up the teammate who goes to the ball.' },
    'third-defender': { job: 'Hold the shape', who: 'shape keeper', change: 'Now hold your spot in the team shape.' },
    'first-attacker': { job: 'On the ball', who: 'on the ball', change: 'You’ve got the ball.' },
    'second-attacker': { job: 'Get open', who: 'helper', change: 'You’re close to the ball now: get open for a pass.' },
    'third-attacker': { job: 'Stretch them', who: 'far from the ball', change: 'You’re far from the ball now: stay wide or high.' },
  },
};

const COPY = {
  standard: {
    title: 'Explore',
    lead: 'Drag the ball anywhere, then drag yourself to your best spot.',
    you: 'You play',
    job: 'Your job',
    possession: 'Who has the ball',
    us: 'Us', them: 'Them', none: 'Loose',
    ideal: 'Show the ideal spot',
    idealHint: 'Finds while it’s on don’t count.',
    newBall: 'Move the ball for me',
    overlays: 'Pitch guides',
    thirds: 'Thirds', lanes: 'Lanes', offside: 'Offside line',
    why: 'Why, right now',
    whyEmpty: 'No principle applies here: find your place in the team’s shape.',
    status: { ok: 'Doing it', near: 'Nearly', miss: 'Not yet' },
    streak: 'S spots',
    streakAria: (n, best) => `S spots found this visit: ${n}. Your best: ${best}.`,
    howTitle: 'How it works',
    how: [
      'Drag the ball anywhere. All 22 players move to where a well-organised team would stand.',
      'Drag yourself (the YOU token) to where you think you belong. The ring and the score tell you if you’re getting hot or cold.',
      'Find the S spot: hold a spot that scores 90 or more for half a second. Then move the ball and find it again.',
    ],
    stuck: 'Stuck? Turn on “Show the ideal spot”: the ghost ring is the best spot, the dashed oval is your zone, and the glow shows every good spot.',
    keys: 'Keyboard: Tab to the ball or to yourself, then use the arrow keys (hold Shift for bigger steps). Touch: tap a token, then tap where it should go.',
    found: 'S spot found! Now move the ball somewhere new.',
    foundPeeked: 'That’s the S spot. Hide the ideal spot to count your next one.',
    takeaway: 'The right spot moves with the ball. Move it somewhere new and find yours again.',
    markChange: (who) => `Now you pick up ${who}.`,
    moveMe: 'Move the ball',
    roleLabel: 'Your position',
  },
  kid: {
    title: 'Explore',
    lead: 'Move the ball. Then move yourself to the best spot.',
    you: 'You play',
    job: 'Your job',
    possession: 'Who has the ball',
    us: 'Us', them: 'Them', none: 'Nobody',
    ideal: 'Show the best spot',
    idealHint: 'Finds with it on don’t count.',
    newBall: 'New ball spot',
    overlays: 'Pitch lines',
    thirds: 'Thirds', lanes: 'Strips', offside: 'Offside line',
    why: 'Why',
    whyEmpty: 'Find your spot in the team shape.',
    status: { ok: 'Yes', near: 'Nearly', miss: 'Not yet' },
    streak: 'S spots',
    streakAria: (n, best) => `S spots found: ${n}. Best: ${best}.`,
    howTitle: 'How to play',
    how: [
      'Drag the ball. Everyone moves with it.',
      'Drag yourself (YOU) to the best spot. Watch the score get hotter.',
      'Stay on a 90+ spot to get an S. Then move the ball and go again!',
    ],
    stuck: 'Stuck? Turn on “Show the best spot”. The ring shows the best spot.',
    keys: 'Keyboard: press Tab to pick the ball or yourself, then use the arrow keys.',
    found: 'You found the S spot! Move the ball and go again.',
    foundPeeked: 'That’s it! Turn off the best spot to count the next one.',
    takeaway: 'Your spot moves when the ball moves. Try a new ball spot!',
    markChange: (who) => `Now watch ${who}.`,
    moveMe: 'Move the ball',
    roleLabel: 'Your position',
  },
};

// ------------------------------------------------------------------ pure helpers (tested)

/** { job, who } for a duty in a wording; null for an unknown duty. */
export function dutyInfo(duty, wording = 'standard') {
  return DUTY[wording === 'kid' ? 'kid' : 'standard'][duty] ?? null;
}

/**
 * The "what changed" line after the ball moves: a new duty wins; else a new player to pick up.
 * @param {{duty?:string, markId?:string|null}|null} prev  before the move (null: first scene, no line)
 * @param {{duty?:string, markId?:string|null, markName?:string}} next
 * @returns {string} '' when nothing worth saying changed
 */
export function changeText(prev, next, wording = 'standard') {
  if (!prev || !next) return '';
  const w = wording === 'kid' ? 'kid' : 'standard';
  if (next.duty && next.duty !== prev.duty) return DUTY[w][next.duty]?.change ?? '';
  if (next.markId && next.markId !== prev.markId && next.markName) return COPY[w].markChange(next.markName);
  return '';
}

/**
 * The live "why" tags: every rule that applies at the spot, heaviest first.
 * @param {object[]} rules  evaluate().rules ({ id, principles, weight, s })
 * @returns {{ id:string, principleId:string|null, name:string, status:'ok'|'near'|'miss', weight:number }[]}
 */
export function whyTags(rules, { wording = 'standard', max = EXPLORE_DEFAULTS.whyMax, passAt = EXPLORE_DEFAULTS.passAt, missBelow = EXPLORE_DEFAULTS.missBelow } = {}) {
  const w = wording === 'kid' ? 'kid' : 'standard';
  return [...(rules ?? [])]
    .filter((r) => r && r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.s - b.s)
    .slice(0, max)
    .map((r) => {
      const rule = RULES_BY_ID[r.id];
      const own = r.principles ?? rule?.principles ?? [];
      return {
        id: r.id,
        // A rule with several principles names the one this result is about (vars.principle, as explain.js).
        principleId: (own.includes(r.vars?.principle) ? r.vars.principle : own[0]) ?? null,
        name: rule?.text?.[w]?.name ?? rule?.text?.standard?.name ?? r.id,
        status: r.critical || r.s < missBelow ? 'miss' : r.s >= passAt ? 'ok' : 'near',
        weight: r.weight,
      };
    });
}

/**
 * A new ball spot at least `min` metres from `from`, inside `area` (rng: () => [0, 1)).
 * Falls back to the farthest of the tries if none is far enough.
 */
export function randomBall(from, rng = Math.random, { min = EXPLORE_DEFAULTS.newBallMin, area = EXPLORE_DEFAULTS.newBallArea } = {}) {
  let best = null, bd = -1;
  for (let i = 0; i < 24; i++) {
    const p = { x: area.x0 + rng() * (area.x1 - area.x0), y: area.y0 + rng() * (area.y1 - area.y0) };
    const d = from ? dist(p, from) : Infinity;
    if (d >= min) return { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 };
    if (d > bd) { bd = d; best = p; }
  }
  return { x: Math.round(best.x * 2) / 2, y: Math.round(best.y * 2) / 2 };
}

/** The role in '#/explore/<ROLE>' (case-insensitive), or null. */
export function roleFromParams(params) {
  const r = String(params?.[0] ?? '').toUpperCase();
  return LEARNABLE_ROLES.includes(r) ? r : null;
}

// ------------------------------------------------------------------ mode

/** Kept across mounts in one session: the scene you left and this visit's S-spot count. */
let saved = null;

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app, params) {
  const P = EXPLORE_DEFAULTS;
  const formation = app.data.formations?.us ?? createFormation(); // linear fallback if the table failed to load
  const formations = { us: formation, them: app.data.formations?.them ?? formation };
  const principles = app.data.principles?.byId ?? {};
  const wording = () => (app.settings.wording === 'kid' ? 'kid' : 'standard');
  const copy = () => COPY[wording()];

  const paramRole = roleFromParams(params);
  if (paramRole && paramRole !== app.settings.role) app.setSettings({ role: paramRole });
  const stored = app.store.get('explore', {}) ?? {};

  const kickoffSpot = (role) => {
    try {
      const t = teamTargets(formation, 'us', P.kickoffBall, { offset: false });
      if (t[role]) return clampToPitch(t[role]);
    } catch { /* fall through */ }
    return { x: 30, y: MID_Y };
  };

  const state = {
    role: app.settings.role,
    ball: { ...P.startBall },
    possession: P.startPossession,
    spot: null,
    scene: null,
    judged: null,
    showIdeal: false,
    overlays: { thirds: false, lanes: false, offside: false },
    dragging: null, // id being dragged (or keyboard-nudged) right now
    fullShown: false,
    change: '',
    interacted: false, // the lead line hides once you have moved something
    stats: {
      streak: 0,
      found: Number.isFinite(stored.found) ? stored.found : 0,
      best: Number.isFinite(stored.best) ? stored.best : 0,
    },
  };
  if (saved) {
    Object.assign(state, { ball: saved.ball, possession: saved.possession, showIdeal: saved.showIdeal, overlays: { ...saved.overlays } });
    state.stats.streak = saved.streak;
    state.interacted = saved.interacted;
    if (saved.role === state.role) state.spot = saved.spot;
  }
  state.spot ??= kickoffSpot(state.role);
  const learnerId = () => playerId('us', state.role);

  // A round is one ball position (a new one starts once the ball has moved newBallDist, or possession
  // changes): a find counts once per round, only after you have moved yourself, and only if the
  // ideal spot stayed hidden during the round.
  const round = { ball: { ...state.ball }, done: false, peeked: state.showIdeal, moved: false };
  const newRound = () => Object.assign(round, { ball: { ...state.ball }, done: false, peeked: state.showIdeal, moved: false });

  const layout = stageLayout(root, { label: 'Explore controls and feedback' });
  // Pinned from the window (like Drill and Live): a phone held upright keeps the vertical pitch whatever the
  // sheet's height does to the board's box.
  const board = app.createBoard(layout.board, { orientation: orientationFor(window.innerWidth, window.innerHeight) });
  const onResize = () => board.setOrientation(orientationFor(window.innerWidth, window.innerHeight));
  window.addEventListener('resize', onResize);
  root.classList.add('ex');

  // ---- engine loop
  function analyse() {
    const prev = state.scene?.ctx;
    state.scene = analyseScene({ formations, ball: state.ball, possession: state.possession, learnerId: learnerId() });
    const ctx = state.scene.ctx;
    const next = { duty: ctx.duty, markId: ctx.markTarget?.id ?? null, markName: ctx.markTarget ? (wording() === 'kid' ? kidNameOf : nameOf)(ctx.markTarget, ctx) : '' };
    if (prev) {
      const text = changeText({ duty: prev.duty, markId: prev.markTarget?.id ?? null }, next, wording());
      if (text) setChange(text);
    }
  }

  function judge() {
    state.judged = judgeSpot(state.scene, state.spot, { wording: wording(), principles });
  }

  // ---- drawing
  function drawnFrame() {
    const f = state.scene.frame, id = learnerId(), p = state.spot;
    return { ...f, players: f.players.map((q) => (q.id === id ? { ...q, x: p.x, y: p.y } : q)) };
  }

  function draw() {
    const { ctx, ghost } = state.scene;
    const { result, feedback } = state.judged;
    board.setOverlays({
      thirds: state.overlays.thirds, lanes: state.overlays.lanes, zone14: false,
      offsideLine: state.overlays.offside ? offsideLineX(ctx) : null, backLine: null,
    });
    board.setGhost(state.showIdeal ? ghost.spot : null);
    board.setZone(state.showIdeal ? { center: ghost.result.center, tol: ghost.result.tol } : null);
    board.setHeatmap(state.showIdeal ? ghost.field : null);

    const heat = hotCold(result.score);
    const markers = [];
    if (state.showIdeal && result.score < P.sScore && dist(state.spot, ghost.spot) >= 1) {
      markers.push({ type: 'arrow', from: state.spot, to: ghost.spot, tone: 'fix' });
    }
    // The rule's cue (a line, a player, a lane) as a hint once you let go: a nudge, not the answer.
    if (!state.showIdeal && !state.dragging && result.score < P.sScore && feedback.cue?.highlight) {
      markers.push({ ...feedback.cue.highlight, tone: 'cue', pulse: false });
    }
    markers.push({
      type: 'ring', id: learnerId(), pulse: heat === 'on fire',
      tone: heat === 'on fire' || heat === 'hot' ? 'good' : heat === 'warm' ? 'info' : 'bad',
      r: heat === 'on fire' ? P.ringFireR : P.ringR,
    });
    if (round.done && !state.dragging) {
      markers.push({ type: 'ring', id: BALL_ID, tone: 'cue', pulse: true, r: 2.6 });
      markers.push({ type: 'label', at: { x: state.ball.x, y: state.ball.y - 3.4 }, text: copy().moveMe, tone: 'cue' });
    }
    board.setMarkers(markers);
    board.render(drawnFrame(), { learnerId: learnerId(), highlight: [BALL_ID], labels: 'role' });

    panel.showLive(state.judged);
    if (!state.fullShown && reveal.el.dataset.state !== 'empty') reveal.clear();
    updateJob();
    updateWhy();
  }

  // ---- throttled input: at most one analyse + judge per animation frame
  let raf = 0;
  const pending = { ball: null, spot: null };
  function flush() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (pending.ball) {
      state.ball = pending.ball;
      pending.ball = null;
      if (dist(state.ball, round.ball) >= P.newBallDist) newRound();
      analyse();
    }
    if (pending.spot) { state.spot = pending.spot; pending.spot = null; }
    judge();
    draw();
    checkHold();
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(flush); };

  function onMove(id, p) {
    state.dragging = id;
    state.fullShown = false;
    if (id === BALL_ID) pending.ball = clampToPitch(p);
    else {
      pending.spot = clampToPitch(p);
      if (!round.done) round.moved = true;
    }
    schedule();
  }

  function onEnd(id, p) {
    onMove(id, p);
    state.dragging = null;
    flush();
    if (!state.interacted) { state.interacted = true; if (leadEl) leadEl.hidden = true; }
    if (id === BALL_ID && state.change) announce(state.change);
  }

  // ---- the S-spot challenge
  let holdTimer = 0;
  const holding = () => !round.done && round.moved && state.dragging !== BALL_ID && state.judged?.result.score >= P.sScore;
  function checkHold() {
    if (holding()) {
      if (!holdTimer) holdTimer = setTimeout(() => { holdTimer = 0; if (holding()) found(); }, P.holdMs);
    } else if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = 0;
    }
  }

  function found() {
    const C = copy();
    round.done = true;
    const counted = !round.peeked;
    if (counted) {
      state.stats.streak += 1;
      state.stats.found += 1;
      state.stats.best = Math.max(state.stats.best, state.stats.streak);
      app.store.set('explore', { ...app.store.get('explore', {}), found: state.stats.found, best: state.stats.best });
      updateStreak(true);
    }
    toast(counted ? C.found : C.foundPeeked, { tone: counted ? 'good' : 'info' });
    state.fullShown = true;
    reveal.showFull(state.judged, { onNext: newBall, nextLabel: C.newBall, takeaway: C.takeaway, focus: false });
    layout.panel.feedback.parentElement?.scrollTo?.({ top: 0 });
    // On a phone the reveal sits in the bottom sheet: open it for the celebration ("Move the ball for me" closes it).
    if (globalThis.matchMedia?.('(max-width: 899.98px)').matches) layout.expand();
    draw();
  }

  function newBall() {
    // The celebration's own button is about to disappear: keep keyboard focus on the pitch (your token).
    const fromReveal = reveal?.el.contains(document.activeElement);
    state.fullShown = false;
    pending.ball = randomBall(state.ball);
    flush();
    layout.collapse();
    if (fromReveal) layout.board.querySelector('.token.is-learner')?.focus({ preventScroll: true });
    announce(state.change || copy().lead);
  }

  // ---- panel: a live readout in the head (always visible, also in the collapsed sheet on phones) and the
  // full reveal for an S spot at the top of the scrolling area, above the live "why" tags.
  let panel = null, reveal = null;
  let jobEl, changeEl, streakEl, leadEl, whyList, whyKey = '', jobKey = '', changeTimer = 0;

  function setChange(text) {
    state.change = text;
    if (!changeEl) return;
    changeEl.replaceChildren(icon('arrow', { size: 16 }), el('span', { text }));
    changeEl.hidden = false;
    changeEl.classList.remove('is-fresh');
    void changeEl.offsetWidth; // restart the highlight animation
    changeEl.classList.add('is-fresh');
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { changeEl.hidden = true; state.change = ''; }, P.changeMs);
  }

  function updateJob() {
    const info = dutyInfo(state.scene.ctx.duty, wording());
    const key = `${state.scene.ctx.duty}|${wording()}`;
    if (!info || key === jobKey) return;
    jobKey = key;
    jobEl.replaceChildren(
      el('span', { class: 'ex-job-label', text: `${copy().job}:` }),
      el('strong', { text: info.job }),
      el('span', { class: 'ex-job-who', text: info.who }),
    );
  }

  function updateWhy() {
    const tags = whyTags(state.judged.result.rules, { wording: wording() });
    const key = tags.map((t) => `${t.id}:${t.status}`).join(',') + wording();
    if (key === whyKey) return;
    whyKey = key;
    const C = copy();
    if (!tags.length) { whyList.replaceChildren(el('li', { class: 'ex-why-empty', text: C.whyEmpty })); return; }
    whyList.replaceChildren(...tags.map((t) => el('li', { class: `ex-why-item is-${t.status}` }, [
      el('span', { class: 'ex-why-mark', 'aria-hidden': 'true' }, [icon(t.status === 'ok' ? 'check' : t.status === 'near' ? 'chevron' : 'close', { size: 14 })]),
      el('span', { class: 'ex-why-name' }, [el('span', { class: 'visually-hidden', text: `${C.status[t.status]}: ` }), t.name]),
      t.principleId ? principleChip({ id: t.principleId, label: principles[t.principleId]?.short ?? t.name, name: principles[t.principleId]?.name ?? t.name, href: `#/learn/p/${t.principleId}` }, { wording: wording(), className: 'ex-why-chip' }) : null,
    ])));
  }

  function updateStreak(bump = false) {
    const C = copy();
    streakEl.setAttribute('aria-label', C.streakAria(state.stats.streak, state.stats.best));
    streakEl.querySelector('.ex-streak-n').textContent = String(state.stats.streak);
    if (bump) {
      streakEl.classList.remove('is-bump');
      void streakEl.offsetWidth;
      streakEl.classList.add('is-bump');
    }
  }

  function buildPanel() {
    const C = copy();
    panel?.destroy();
    reveal?.destroy();
    jobKey = '';
    whyKey = '';
    const { head, actions, feedback, body } = layout.panel;

    streakEl = el('span', { class: 'ex-streak', role: 'img', title: C.streak }, [
      starIcon(), el('span', { class: 'ex-streak-n', 'aria-hidden': 'true' }), el('span', { class: 'ex-streak-label', 'aria-hidden': 'true', text: C.streak }),
    ]);
    const liveHost = el('div', { class: 'ex-live' });
    jobEl = el('p', { class: 'ex-job' });
    changeEl = el('p', { class: 'ex-change', hidden: true });
    leadEl = el('p', { class: 'ex-lead', text: C.lead, hidden: state.interacted });
    head.replaceChildren(
      el('div', { class: 'ex-titlebar' }, [el('h1', { class: 'ex-title', text: C.title }), streakEl]),
      leadEl,
      liveHost,
      el('div', { class: 'ex-status' }, [jobEl, changeEl]),
    );
    panel = createFeedbackPanel(liveHost, { app });

    const roleId = uid('ex-role');
    const roleSelect = el('select', { id: roleId, class: 'field-select ex-role-select', onchange: (e) => app.setSettings({ role: e.target.value }) },
      LEARNABLE_ROLES.map((r) => el('option', { value: r, selected: r === state.role, text: ROLE_INFO[r].label })));
    actions.replaceChildren(el('div', { class: 'ex-toolbar' }, [
      el('div', { class: 'ex-tool ex-tool--role' }, [el('label', { class: 'field-label', for: roleId, text: C.roleLabel }), roleSelect]),
      el('div', { class: 'ex-tool ex-tool--possession' }, [segmented({
        legend: C.possession, value: state.possession,
        options: POSSESSION.map((v) => ({ value: v, label: C[v] })),
        onChange: (v) => setPossession(v),
      })]),
      el('div', { class: 'ex-tool ex-tool--ideal' }, [toggleSwitch({ label: C.ideal, hint: C.idealHint, checked: state.showIdeal, onChange: (on) => setIdeal(on) })]),
      button(C.newBall, { icon: 'explore', className: 'ex-newball', onClick: newBall }),
    ]));

    whyList = el('ul', { class: 'ex-why' });
    const revealHost = el('div', { class: 'ex-reveal' });
    feedback.replaceChildren(revealHost, el('section', { class: 'ex-why-box', 'aria-label': C.why }, [el('h2', { class: 'ex-h2', text: C.why }), whyList]));
    reveal = createFeedbackPanel(revealHost, { app });

    const overlaySwitch = (key) => toggleSwitch({ label: C[key], checked: state.overlays[key], onChange: (on) => { state.overlays[key] = on; draw(); } });
    body.replaceChildren(
      el('fieldset', { class: 'ex-overlays' }, [el('legend', { text: C.overlays }), el('div', { class: 'ex-overlay-switches' }, ['thirds', 'lanes', 'offside'].map(overlaySwitch))]),
      el('section', { class: 'ex-how' }, [
        el('h2', { class: 'ex-h2', text: C.howTitle }),
        el('ol', {}, C.how.map((t) => el('li', { text: t }))),
        el('p', { text: C.stuck }),
        el('p', { class: 'ex-keys', text: C.keys }),
      ]),
    );
    updateStreak();
  }

  function setPossession(v) {
    if (!POSSESSION.includes(v) || v === state.possession) return;
    state.possession = v;
    state.fullShown = false;
    newRound();
    analyse();
    judge();
    draw();
    checkHold();
    if (state.change) announce(state.change);
  }

  function setIdeal(on) {
    state.showIdeal = on;
    if (on && !round.done) round.peeked = true;
    draw();
  }

  function setRole(role) {
    if (role === state.role) return;
    state.role = role;
    state.spot = kickoffSpot(role);
    state.fullShown = false;
    newRound();
    try { history.replaceState(null, '', `#/explore/${role}`); } catch { /* sandboxed frames */ }
    const sel = layout.panel.actions.querySelector('.ex-role-select');
    if (sel && sel.value !== role) sel.value = role;
    state.scene = null; // no "what changed" line for a new role
    analyse();
    judge();
    board.enableDrag({ ids: [learnerId(), BALL_ID], onMove, onEnd });
    draw();
    announce(`${ROLE_INFO[role].label}. ${copy().lead}`);
  }

  // Settings: a new role re-places you; new wording re-phrases everything without moving anyone.
  let lastWording = wording();
  const offSettings = app.onSettings?.((s) => {
    if (s.role !== state.role && LEARNABLE_ROLES.includes(s.role)) setRole(s.role);
    if (wording() !== lastWording) {
      lastWording = wording();
      buildPanel();
      judge();
      draw();
    }
  });

  buildPanel();
  analyse();
  judge();
  board.enableDrag({ ids: [learnerId(), BALL_ID], onMove, onEnd });
  draw();

  return () => {
    saved = { role: state.role, ball: state.ball, possession: state.possession, spot: state.spot, showIdeal: state.showIdeal, overlays: state.overlays, streak: state.stats.streak, interacted: state.interacted };
    cancelAnimationFrame(raf);
    clearTimeout(holdTimer);
    clearTimeout(changeTimer);
    offSettings?.();
    window.removeEventListener('resize', onResize);
    panel?.destroy();
    reveal?.destroy();
    board.destroy();
    layout.destroy();
  };
}

function starIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '18');
  s.setAttribute('height', '18');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.setAttribute('class', 'ex-streak-star');
  s.innerHTML = '<path d="M12 2.8l2.75 5.9 6.45.7-4.8 4.4 1.33 6.35L12 16.9l-5.73 3.25L7.6 13.8 2.8 9.4l6.45-.7z"/>';
  return s;
}
