// Player mode: Match day, a simplified Live (docs/KID_REDESIGN.md §4.6).
//
// 45 s of open play (js/engine/sequence.js generateSequence, a fresh seed each time) while you keep moving yourself.
// It is scored exactly as Coach mode's Live (js/ui/modes/live.js): 10 samples a second off the render path, the frame
// with you where you are (the others react to you), your base from the free playback, then context, ghost and
// judgeSpot; samples in the moment after a pass or a turnover are not scored. What you see is simpler: no numbers,
// just the ring around YOU in its heat colour and style and one big word with a shape: Hot (a flame), Warm (a sun),
// Cold (a snowflake). Colour never works alone (R39).
//
// The result is Full time (js/ui/player/fulltime.js) with the run's stars (rewards.js starsForScore on the average),
// its word, your best hot streak in seconds and "Replay your hardest moment" (frozen where you were, the best-spot
// ring and an arrow, one line; "Watch it" plays the lead-up). The chart, the table and the seed stay in Coach mode's
// Live. A run played to the end earns rewards (award { type: 'live', average }); the history and your Live best are
// kept as Live keeps them.
//
// Match day opens when the Road's `matchday.unlockAfter` node (chapter 1's Big Match) has a star (road.js
// isMatchdayUnlocked; '?dev' in the address skips the lock).
//
// Pure helpers (heatFor, bestHotStreak, hardestMoment) are exported for tests; nothing touches the DOM at import time.

import { el, button, icon, svg, linkButton, announce } from '../components.js';
import { generateSequence, createPlayback, graceEvents } from '../../engine/sequence.js';
import { learnerBaseAt, inGrace, TIMELINE_DEFAULTS } from '../../engine/timeline.js';
import { learnerId as learnerIdOf } from '../../engine/scenario.js';
import { buildContext } from '../../engine/context.js';
import { computeGhost } from '../../engine/ghost.js';
import { toleranceFor } from '../../engine/score.js';
import { judgeSpot } from '../../engine/analyse.js';
import { dist } from '../../engine/geometry.js';
import { createLiveAnnouncer } from '../reveal.js';
import { award, loadRewards, emptyGains } from '../rewards-store.js';
import { createBurstBudget } from '../celebrate.js';
import * as S from '../session.js';
import { showFullTime } from './fulltime.js';
import { starsForScore, wordForStars, pickLine, cueMarker, praiseOf, bestSpotMarker, PLAY_DEFAULTS } from './play.js';
import { STRINGS as SHARED, roleCard } from './strings.js';

export const MATCHDAY_DEFAULTS = Object.freeze({
  duration: 45, // [S] §4.6: 45 s of play
  countdown: 3, // [D] "3, 2, 1" before play
  countMs: 800, // [D] each count
  sampleHz: TIMELINE_DEFAULTS.sampleHz, // [S] 10 Hz, as Live (RESEARCH 5.7)
  grace: TIMELINE_DEFAULTS.eventGrace, // [S] 0.7 s to react after each pass or turnover (not scored)
  maxFrameDt: 1, // [D] s of play per animation frame at most: slow or throttled frames keep real time (a hidden tab
  //               pauses the run, and play restarts the clock)
  hotAt: 70, // [D] a sample at or above this is Hot (reveal.js HOT_COLD_BANDS: hot starts at 70)...
  warmAt: 50, // [D] ...at or above this Warm, else Cold
  minScoredS: 5, // [D] a run needs this many seconds of scored play to count
  leadUp: 3, // [D] s of play shown before the hardest moment
  announceMs: 900, // [D] a screen reader hears a new heat once it has held this long
  roleCardMs: 1300, // [D] the role card before the Start button
});

export const STRINGS = Object.freeze({
  title: 'Match day',
  lead: 'Keep moving to the best spot.',
  ringTip: 'Your ring says Hot, Warm or Cold.',
  start: 'Start',
  go: 'Go',
  pause: 'Pause',
  resume: 'Play on',
  paused: 'Paused. You can still move.',
  stop: SHARED.stop,
  hot: SHARED.hot,
  warm: SHARED.warm,
  cold: SHARED.cold,
  streak: (s) => `Best hot streak: ${s} ${s === 1 ? 'second' : 'seconds'}`,
  noStreak: 'Get hot for longer next time.',
  hardest: 'See your hardest moment',
  watchIt: 'Watch it',
  back: 'Back',
  bestSpot: SHARED.bestSpot,
  lockedTitle: 'Match day is locked',
  lockedText: 'Win a star in Big Match to open it.',
  playBig: 'Play Big Match',
  play: 'Play',
  home: SHARED.home,
  tooShort: 'That was too short to count.',
  timeLeft: 'Time left',
});

// ---------------------------------------------------------------- pure helpers

/** The heat word for a score: 'hot' (70 or more), 'warm' (50 or more) or 'cold'; not a number reads as cold. */
export function heatFor(score, P = MATCHDAY_DEFAULTS) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'cold';
  return s >= P.hotAt ? 'hot' : s >= P.warmAt ? 'warm' : 'cold';
}

/**
 * The longest time you stayed Hot, in whole seconds: a run of Hot samples, broken by any scored sample below Hot
 * (a sample in the reaction moment after a pass neither breaks nor starts one). One sample counts as 1/hz s.
 * @param {{ t: number, score: number|null, grace?: boolean }[]} samples
 */
export function bestHotStreak(samples = [], P = MATCHDAY_DEFAULTS) {
  const step = 1 / P.sampleHz;
  let best = 0, from = null, last = null;
  for (const s of [...samples].filter((x) => Number.isFinite(x?.t)).sort((a, b) => a.t - b.t)) {
    if (s.grace || !Number.isFinite(s.score)) continue;
    if (s.score >= P.hotAt) {
      if (from === null) from = s.t;
      last = s.t;
      best = Math.max(best, last - from + step);
    } else from = last = null;
  }
  return Math.round(best);
}

/** The hardest moment to replay: the lowest-scoring of the run's worst moments (session.js summarizeLive), or null. */
export function hardestMoment(result) {
  const worst = Array.isArray(result?.worst) ? result.worst : [];
  return worst.reduce((a, w) => (!a || w.score < a.score ? w : a), null);
}

// ---------------------------------------------------------------- the app (browser only below)

const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

/** The heat shapes (never colour alone): a flame, a sun, a snowflake. */
function heatShape(level) {
  const paths = {
    hot: 'M12.6 2.5c.4 3-1.4 4.6-2.9 6.2C8 10.4 6.5 12.1 6.5 14.8a5.5 5.5 0 0 0 11 0c0-2.6-1.3-4.3-2.3-5.5-.2 1.4-.9 2.4-1.9 2.9.5-3.4-.2-7-2.7-9.7z',
    warm: 'M12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3M4.8 4.8l2.1 2.1M17.1 17.1l2.1 2.1M4.8 19.2l2.1-2.1M17.1 6.9l2.1-2.1',
    cold: 'M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M12 2l-2.5 2.5M12 2l2.5 2.5M12 22l-2.5-2.5M12 22l2.5-2.5',
  };
  return svg('svg', { class: `md-shape md-shape--${level}`, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, [svg('path', { d: paths[level] ?? paths.cold })]);
}

/** A fresh seed (UI only: the engine stays deterministic from it). */
function freshSeed() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(6);
  try { crypto.getRandomValues(bytes); } catch { for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256); }
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

const tryImport = async (url) => {
  try { return await import(url); } catch (err) { console.warn(`[fotbol] matchday: ${url} is not available`, err); return null; }
};

/** Mode contract (ARCHITECTURE §5.9). @returns {Promise<() => void>} unmount */
export async function mount(root, app) {
  const P = MATCHDAY_DEFAULTS;
  const formations = app.data?.formations;
  const principles = app.data?.principles?.byId ?? {};
  const store = app.store;
  let alive = true;
  root.classList.add('md-view');
  root.replaceChildren(el('div', { class: 'pl-loading', role: 'status' }, [el('p', { text: SHARED.loading })]));

  const roadMod = await tryImport('./road.js');
  let roadData = app.data?.road ?? null;
  if (!roadData && typeof roadMod?.loadRoad === 'function') { try { roadData = await roadMod.loadRoad(app); } catch { roadData = null; } }
  if (!root.isConnected) return () => { alive = false; };
  let profile = null;
  try { profile = roadMod?.loadProfile?.(app) ?? null; } catch { profile = null; }
  const role = profile?.role ?? app.settings?.role ?? 'LB';

  // ---- the lock (never a dead end: the way to open it, and home)
  let open = true;
  try { if (roadData && typeof roadMod?.isMatchdayUnlocked === 'function') open = roadMod.isMatchdayUnlocked(roadData, profile); } catch { open = true; }
  let dev = false;
  try { dev = /[?&](dev|debug)\b/.test(location.search); } catch { dev = false; }
  if (!open && !dev) {
    // "Play Big Match" when it is open; else the next play on the Road (its way there).
    const bigId = roadData?.matchday?.unlockAfter;
    let bigOpen = false;
    try { bigOpen = !!bigId && typeof roadMod?.isUnlocked === 'function' && roadMod.isUnlocked(roadData, profile, bigId); } catch { bigOpen = false; }
    let href = bigOpen ? `#/play/${encodeURIComponent(bigId)}` : '#/play';
    try { if (bigOpen && typeof roadMod?.nodeHref === 'function') href = roadMod.nodeHref(roadData, bigId); } catch { /* keep */ }
    root.replaceChildren(el('div', { class: 'md-locked' }, [
      el('span', { class: 'md-lock-icon', 'aria-hidden': 'true' }, [icon('lock', { size: 40 })]),
      el('h1', { text: STRINGS.lockedTitle }),
      el('p', { text: STRINGS.lockedText }),
      el('div', { class: 'md-actions' }, [linkButton(bigOpen ? STRINGS.playBig : STRINGS.play, href, { variant: 'primary', icon: 'arrow' }), linkButton(STRINGS.home, '#/')]),
    ]));
    return () => { alive = false; };
  }

  // ---- the stage and the results
  const els = {};
  els.quit = el('a', { class: 'btn btn--ghost btn--icon pl-quit', href: '#/', 'aria-label': STRINGS.stop, title: STRINGS.stop }, [icon('close')]);
  els.time = el('div', { class: 'md-time', role: 'img', 'aria-label': STRINGS.timeLeft }, [el('span', { class: 'md-time-fill' })]);
  els.board = el('div', { class: 'pl-board' });
  els.card = el('div', { class: 'pl-card', hidden: true }, [el('p', { class: 'pl-card-text' })]);
  els.count = el('div', { class: 'md-count', hidden: true, 'aria-hidden': 'true' });
  els.title = el('h1', { class: 'md-title', text: STRINGS.title });
  els.line = el('p', { class: 'pl-line' });
  els.tip = el('p', { class: 'pl-tip', hidden: true });
  els.heat = el('div', { class: 'md-heat', hidden: true, 'aria-hidden': 'true' });
  els.actions = el('div', { class: 'pl-actions' });
  els.sr = el('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  els.stage = el('div', { class: 'pl md-stage', dataset: { phase: 'intro' } }, [
    el('div', { class: 'pl-top' }, [els.quit, els.time]),
    el('div', { class: 'pl-stage' }, [els.board, els.card, els.count]),
    el('div', { class: 'pl-dock' }, [els.title, els.line, els.tip, els.heat, els.actions, els.sr]),
  ]);
  els.results = el('div', { class: 'md-results', hidden: true });
  root.replaceChildren(els.stage, els.results);
  const kitNumber = loadRewards(app)?.kit?.number ?? null;
  const board = app.createBoard(els.board, { orientation: 'auto', labels: 'number', youNumber: Number.isInteger(kitNumber) ? kitNumber : null });
  board.setOverlays({ thirds: false, lanes: false, zone14: false, offsideLine: null, backLine: null });
  const budget = createBurstBudget();

  let run = null;
  let phase = 'intro';
  let raf = 0, sampleTimer = 0;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms); timers.add(t); return t; };
  const stopLoops = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (sampleTimer) { clearTimeout(sampleTimer); sampleTimer = 0; }
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
  let ftCleanup = null;
  const heatAnnouncer = createLiveAnnouncer({ delay: P.announceMs, say: (text) => { els.sr.textContent = text; } });
  const setPhase = (p) => { phase = p; els.stage.dataset.phase = p; };
  const setTip = (text) => { els.tip.textContent = text ?? ''; els.tip.hidden = !text; };

  function newRun() {
    const seed = freshSeed();
    const scenario = generateSequence({ seed, duration: P.duration, role, formations });
    const learnerId = learnerIdOf(scenario);
    const free = createPlayback(scenario, { formations, learnerId: null });
    const held = createPlayback(scenario, { formations });
    const r = { seed, scenario, learnerId, free, held, events: graceEvents(scenario), tol: toleranceFor(role), duration: scenario.timeline.duration };
    r.start = baseAt(r, 0);
    Object.assign(r, { t: 0, spot: { ...r.start }, samples: [], nextSample: 0, pending: [], paused: false, heat: '', last: null, startedAt: 0 });
    return r;
  }

  /** Your base at t: your role's spot with everybody auto-placed (live.js baseAt). */
  function baseAt(r, t) {
    const f = r.free.frameAt(t);
    if (f.carrierId === r.learnerId) return learnerBaseAt(r.scenario, t, { formations });
    const me = f.players.find((p) => p.id === r.learnerId);
    return { x: me.x, y: me.y };
  }

  const draw = (t, spot) => board.render(run.held.frameAt(t, spot), { learnerId: run.learnerId, labels: 'number' });

  function analyseAt(t, spot) {
    const frame = run.held.frameAt(t, spot);
    const base = baseAt(run, t);
    const ctx = buildContext(frame, { learnerId: run.learnerId, base });
    const ghost = computeGhost(ctx, { base, tol: run.tol });
    return { frame, ctx, ghost, judgement: judgeSpot({ ctx, ghost }, spot, { wording: 'kid', principles }) };
  }

  // ---- intro: the role card, then Start
  function showIntro() {
    setPhase('intro');
    stopLoops();
    run = newRun();
    board.setGhost(null);
    board.setMarkers([{ type: 'ring', id: run.learnerId, tone: 'info', pulse: true }]);
    board.setAid(null);
    draw(0, run.spot);
    els.results.hidden = true;
    els.stage.hidden = false;
    els.heat.hidden = true;
    els.title.hidden = false;
    els.line.textContent = STRINGS.lead;
    setTip(STRINGS.ringTip);
    els.time.firstChild.style.width = '0%';
    const card = roleCard(role, role);
    els.card.querySelector('.pl-card-text').textContent = card.text;
    els.card.hidden = false;
    later(() => { els.card.hidden = true; }, P.roleCardMs);
    els.card.onclick = () => { els.card.hidden = true; };
    const start = button(STRINGS.start, { variant: 'primary', icon: 'play', className: 'pl-main', onClick: startCountdown });
    put(els.actions, start);
    board.enableDrag({ ids: [run.learnerId], tapToMove: run.learnerId, onMove: onDrag, onEnd: onDrag });
    start.focus({ preventScroll: true });
    announce(`${STRINGS.title}. ${card.text}. ${STRINGS.lead}`);
  }

  function onDrag(_id, p) {
    if (!run) return;
    run.spot = { x: p.x, y: p.y };
    if (phase !== 'playing') draw(run.t, run.spot); // playing: the next animation frame draws it
  }

  function startCountdown() {
    setPhase('countdown');
    els.card.hidden = true;
    els.title.hidden = true;
    setTip('');
    put(els.line);
    board.setMarkers([]);
    put(els.actions);
    let n = P.countdown;
    const tick = () => {
      if (phase !== 'countdown') return;
      if (n <= 0) { els.count.hidden = true; startPlay(); return; }
      els.count.hidden = false;
      els.count.replaceChildren(el('span', { class: 'md-count-n', text: String(n) }));
      announce(String(n));
      n--;
      later(tick, P.countMs);
    };
    tick();
  }

  function playingActions() {
    const pause = button(run.paused ? STRINGS.resume : STRINGS.pause, { icon: run.paused ? 'play' : 'pause', className: 'md-pause', 'aria-pressed': String(run.paused), onClick: togglePause });
    const hadFocus = els.actions.contains(document.activeElement);
    put(els.actions, pause);
    if (hadFocus) pause.focus({ preventScroll: true });
  }

  function startPlay() {
    setPhase('playing');
    announce(STRINGS.go);
    run.last = null;
    run.startedAt = performance.now();
    els.heat.hidden = false;
    setHeat('warm', true);
    playingActions();
    const token = board.el.querySelector(`.token[data-id="${run.learnerId}"]`);
    if (lastKey && token) token.focus({ preventScroll: true });
    const step = (now) => {
      if (!alive || phase !== 'playing') return;
      if (run.last !== null && !run.paused) run.t = Math.min(run.duration, run.t + Math.min(P.maxFrameDt, (now - run.last) / 1000));
      run.last = now;
      draw(run.t, run.spot);
      if (!run.paused) queueSamples(run.t);
      els.time.firstChild.style.width = `${(100 * run.t) / run.duration}%`;
      if (run.t >= run.duration - 1e-9) { finish(false); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function setHeat(level, force = false) {
    if (!force && level === run.heat) return;
    run.heat = level;
    board.setAid({ kind: 'heat', level });
    els.heat.dataset.heat = level;
    els.heat.replaceChildren(heatShape(level), el('b', { text: STRINGS[level] }));
    heatAnnouncer.update(level, STRINGS[level]);
  }

  function queueSamples(t) {
    const step = 1 / P.sampleHz;
    while (run.nextSample <= t + 1e-9 && run.nextSample <= run.duration + 1e-9) {
      run.pending.push({ t: Math.round(run.nextSample * 1000) / 1000, spot: { ...run.spot } });
      run.nextSample += step;
    }
    if (run.pending.length && !sampleTimer) sampleTimer = setTimeout(processSamples, 0);
  }

  function processSamples() {
    sampleTimer = 0;
    if (!alive || !run) return;
    let latest = null;
    for (const s of run.pending.splice(0)) {
      const a = analyseAt(s.t, s.spot);
      const grace = inGrace(run.events, s.t, P.grace);
      const r = a.judgement.result;
      run.samples.push({ t: s.t, spot: s.spot, score: r.score, grade: r.grade, grace });
      latest = r.score;
    }
    if (latest !== null && phase === 'playing') setHeat(heatFor(latest));
  }

  function togglePause() {
    if (phase !== 'playing') return;
    run.paused = !run.paused;
    run.last = null;
    playingActions();
    setTip(run.paused ? STRINGS.paused : '');
  }

  // ---- the end
  function finish(early) {
    stopLoops();
    if (run.pending.length) processSamples();
    setPhase('done');
    board.disableDrag();
    board.setAid(null);
    const res = S.summarizeLive(run.samples, run.events);
    const counted = res.scored >= P.sampleHz * P.minScoredS;
    const xpBefore = loadRewards(app).xp ?? 0;
    let gained = emptyGains();
    if (counted) {
      try {
        const day = S.dayKey(new Date());
        if (typeof S.updateStreak === 'function') S.saveStreak?.(store, S.updateStreak(S.loadStreak(store), { day, rep: false }));
        const rec = S.recordLiveBest(S.loadLive(store), { role, score: res.average, grade: res.grade, seed: run.seed, at: Date.now(), assisted: false, length: run.duration });
        if (!early) S.saveLive(store, rec.live);
        S.appendHistory(store, {
          t: Date.now(), mode: 'live', via: 'matchday', id: run.scenario.id, seed: run.seed, length: run.duration, title: STRINGS.title, role,
          score: res.average, grade: res.grade, assisted: false, duration: Math.round(run.t * 10) / 10, speed: 1, recovery: res.recovery,
          onSpot: Math.round(res.onSpot * 100), early,
        });
      } catch (err) { console.warn('[fotbol] matchday: could not save the run', err); }
      if (!early) gained = award(app, { type: 'live', average: res.average }, { celebrate: false });
    }
    run.result = res;
    run.counted = counted;
    showResults({ res, gained, xpBefore });
  }

  /** Full time for the run (a run stopped early or too short shows its result, with no rewards). */
  function showResults({ res, gained, xpBefore }) {
    const stars = run.counted ? starsForScore(res.average) : 0;
    const streakS = bestHotStreak(run.samples);
    const worst = run.counted ? hardestMoment(res) : null;
    const extra = el('section', { class: 'md-summary' }, [
      el('p', { class: 'md-word', text: run.counted ? wordForStars(stars) : STRINGS.tooShort }),
      run.counted ? el('p', { class: 'md-streak' }, [heatShape('hot'), el('span', { text: streakS > 0 ? STRINGS.streak(streakS) : STRINGS.noStreak })]) : null,
      worst ? button(STRINGS.hardest, { icon: 'play', className: 'md-hardest', onClick: () => showMoment(worst) }) : null,
    ]);
    els.stage.hidden = true;
    els.results.hidden = false;
    ftCleanup?.();
    ftCleanup = showFullTime(els.results, app, {
      node: null, reps: [{ stars, title: '' }], xpBefore, xpAfter: loadRewards(app).xp ?? xpBefore, gained, nodeStars: null, extra, budget,
      playedMs: Math.min(run.t * 1000 + 5000, (P.duration + 30) * 1000),
      onHome: () => app.navigate('#/'),
      onAgain: () => { ftCleanup?.(); ftCleanup = null; showIntro(); },
    });
  }

  // ---- the hardest moment, frozen
  function showMoment(w) {
    setPhase('moment');
    stopLoops();
    const sample = run.samples.find((s) => s.t === w.t) ?? run.samples.reduce((a, s) => (Math.abs(s.t - w.t) < Math.abs(a.t - w.t) ? s : a));
    const a = analyseAt(sample.t, sample.spot);
    els.results.hidden = true;
    els.stage.hidden = false;
    els.heat.hidden = true;
    els.title.hidden = true;
    setTip('');
    drawMoment(sample, a);
    els.line.textContent = pickLine({ feedback: a.judgement.feedback, praise: praiseOf(a.judgement.result), stars: starsForScore(a.judgement.result.score) });
    const back = button(STRINGS.back, { variant: 'primary', icon: 'arrow', className: 'pl-main', onClick: () => { stopLoops(); els.stage.hidden = true; els.results.hidden = false; setPhase('done'); els.results.querySelector('.ft-title')?.focus({ preventScroll: true }); } });
    put(els.actions, button(STRINGS.watchIt, { icon: 'play', className: 'pl-again', onClick: () => playLeadUp(sample, a) }), back);
    back.focus({ preventScroll: true });
    announce(els.line.textContent);
  }

  function drawMoment(sample, a) {
    draw(sample.t, sample.spot);
    board.setGhost(a.ghost.spot);
    const marks = [];
    const off = dist(sample.spot, a.ghost.spot);
    if (off >= 1) marks.push({ type: 'arrow', from: sample.spot, to: a.ghost.spot, tone: 'fix' });
    if (off >= PLAY_DEFAULTS.labelClear * board.tokenScale) marks.push(bestSpotMarker(sample.spot, a.ghost.spot, board));
    // One cue, as a "Find your spot" reveal draws it: a line only with its name on it (play.js cueMarker).
    const cue = cueMarker(a.judgement.feedback.cue, { rules: a.judgement.result.rules, ball: a.frame.ball });
    if (cue) marks.push(cue);
    board.setMarkers(marks);
  }

  /** Where you were at time t (between the 10 Hz samples). */
  function spotAt(t) {
    const s = run.samples;
    if (!s.length) return run.spot;
    const i = s.findIndex((q) => q.t >= t);
    if (i <= 0) return i === 0 ? s[0].spot : s[s.length - 1].spot;
    const p = s[i - 1], q = s[i], u = (t - p.t) / (q.t - p.t || 1);
    return { x: p.spot.x + (q.spot.x - p.spot.x) * u, y: p.spot.y + (q.spot.y - p.spot.y) * u };
  }

  function playLeadUp(sample, a) {
    stopLoops();
    board.setMarkers([]);
    board.setGhost(null);
    let t = Math.max(0, sample.t - P.leadUp), last = null;
    const step = (now) => {
      if (!alive || phase !== 'moment') return;
      if (last !== null) t = Math.min(sample.t, t + Math.min(P.maxFrameDt, (now - last) / 1000));
      last = now;
      draw(t, spotAt(t));
      if (t >= sample.t - 1e-9) { raf = 0; drawMoment(sample, a); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // ---- keys (Space pauses) and a hidden tab (pause)
  let lastKey = false;
  const onKey = (e) => {
    lastKey = true;
    if (e.key !== ' ' || phase !== 'playing') return;
    if (e.target?.closest?.('button, a, input, select, textarea, summary')) return;
    e.preventDefault();
    togglePause();
  };
  const onPointer = () => { lastKey = false; };
  const onVisibility = () => { if (document.hidden && phase === 'playing' && !run.paused) togglePause(); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('visibilitychange', onVisibility);

  showIntro();

  return () => {
    alive = false;
    stopLoops();
    heatAnnouncer.reset();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('visibilitychange', onVisibility);
    try { ftCleanup?.(); } catch { /* gone */ }
    board.destroy();
  };
}
