// '#/live' and '#/live/<seed>[/<seconds>]': continuous play (RESEARCH 5.7, 7.3 capstone, 9.2 item 8).
//
// A 45-60 s sequence (js/engine/sequence.js generateSequence; a fresh seed, or the one in the link)
// plays while you keep dragging yourself; nobody places you. Your spot is scored at 10 Hz: at each
// sample the frame is built with you where you are, your base comes from the same playback with
// everybody auto-placed (the free cursor: your role's blended auto spot, so the zone never jumps
// mid-play; a drill's learnerBaseAt is unblended), then context + ghost + judgeSpot, as a drill freeze.
// Samples within the reaction grace after a pass or a turnover (graceEvents, eventGrace 0.7 s) are
// not scored. The judging runs off the render path (a task queued from the animation frame), and the
// playback cursor (createPlayback) keeps each frame at about one autoFrame() call, so play stays at 60 fps.
//
// End screen: the time-averaged score and grade, a score-over-time line, the 3 worst moments (each
// can be replayed frozen with the best spot, the fix and the reasons), Play again and New sequence.
// "Show the best spot" (training wheels) marks the run as assisted: it is kept, but never a best.
// A run played to the end, unassisted, earns rewards (XP and the Live badges: rewardRun, ARCHITECTURE §5.13) in
// Player mode; Coach mode earns none, so nothing here then shows or mentions them (rewards-store.js earnsRewards).

import { el, button, icon, linkButton, segmented, toggleSwitch, stageLayout, announce, uid } from '../components.js';
import { BALL_ID } from '../board.js';
import { createFeedbackPanel, gradeColor } from '../reveal.js';
import { generateSequence, createPlayback, graceEvents } from '../../engine/sequence.js';
import { learnerBaseAt, inGrace, TIMELINE_DEFAULTS } from '../../engine/timeline.js';
import { learnerId as learnerIdOf } from '../../engine/scenario.js';
import { buildContext } from '../../engine/context.js';
import { computeGhost } from '../../engine/ghost.js';
import { toleranceFor, gradeOf } from '../../engine/score.js';
import { judgeSpot } from '../../engine/analyse.js';
import { createFormation } from '../../engine/formation.js';
import { ROLE_INFO } from '../../engine/roles.js';
import { dist, lerp } from '../../engine/geometry.js';
import { award, earnsRewards } from '../rewards-store.js';
import * as S from '../session.js';

export const LIVE_DEFAULTS = Object.freeze({
  durations: Object.freeze([45, 60]), // [S] RESEARCH 9.2 item 8: 30-60 s
  speeds: Object.freeze([0.75, 1, 1.25]), // [S] RESEARCH 7.3: Live at 0.75x, 1x and 1.25-1.5x
  sampleHz: TIMELINE_DEFAULTS.sampleHz, // [S] 10 Hz (RESEARCH 5.7)
  grace: TIMELINE_DEFAULTS.eventGrace, // [S] 0.7 s reaction grace after each ball event
  countdown: 3, // [D] seconds of "3, 2, 1" before play
  maxFrameDt: 0.1, // [D] s of play per animation frame at most (a hidden tab must not skip the run)
  leadUp: 3, // [D] s of play shown before a replayed moment
  ringAt: Object.freeze({ fire: 90, hot: 70, warm: 50 }), // [D] hot/cold ring bands (reveal.js HOT_COLD_BANDS)
  chart: Object.freeze({ w: 320, minW: 220, maxW: 640, h: 130, padL: 26, padR: 10, padT: 10, padB: 20 }), // [D] score chart, CSS px
});

let preferred = { speed: 1, duration: 45, ghost: false };

const COPY = {
  standard: {
    title: 'Live',
    heading: 'Hold your position',
    lead: (secs, role) => `${secs} seconds of open play as the ${role}. Keep dragging yourself to where you should be. You are scored ten times a second, with a moment to react after each pass or turnover.`,
    best: (score, grade) => `Your best in this position: ${score} (${grade}).`,
    noBest: 'No best in this position yet.',
    seed: (seed) => `Sequence ${seed}`,
    seedHint: 'Keep this link to play the same sequence again.',
    duration: 'Length', speed: 'Speed',
    wheels: 'Show the best spot', wheelsHint: 'Training wheels: the run counts as assisted and cannot set a best.',
    start: 'Start', newSeq: 'New sequence', again: 'Play again',
    get: (n) => `Get ready… ${n}`,
    go: 'Go!',
    pause: 'Pause', resume: 'Resume', end: 'End run',
    paused: 'Paused. Drag yourself if you like, then resume.',
    running: 'Your average so far',
    left: (s) => `${s} s left`,
    grace: 'Reacting…',
    assisted: 'Assisted',
    resultTitle: 'Run complete',
    average: 'Time-averaged score',
    verdict: { S: 'Superb: you were with the play all the way.', A: 'Great tracking.', B: 'Good: mostly in the right place.', C: 'Getting there: some moments got away from you.', D: 'Tough run: watch the ball and your partners.', F: 'Tough run: follow the ball and slide with your team.' },
    personalBest: 'New personal best!',
    firstBest: 'Your first live score in this position: now try to beat it.',
    assistedNote: 'Assisted run: the best spot was on show, so it does not count as a best or earn XP.',
    assistedNoteNoXp: 'Assisted run: the best spot was on show, so it does not count as a best.', // Coach mode earns no XP
    onSpot: (pct) => `${pct}% of the time at A or better`,
    recovery: (s) => `${s} s to get back after a pass`,
    noRecovery: 'Never pulled out of position by a pass',
    chartTitle: 'Your score over the run',
    chartDesc: (avg, min, max) => `Line chart of your score over time: average ${avg}, lowest ${min}, highest ${max}.`,
    chartTable: 'Show as a table',
    tableWhen: 'Seconds', tableScore: 'Average score',
    worst: (n) => (n === 1 ? 'Your toughest moment' : `Your ${['', '', 'two', 'three'][n] ?? n} toughest moments`),
    worstItem: (time, score, grade) => `${time} · ${score} (${grade})`,
    replayMoment: 'Replay moment',
    backToResults: 'Back to results',
    leadUp: 'Watch the lead-up',
    momentTitle: (time) => `The moment at ${time}`,
    momentNote: 'Frozen where you were. The blue ring is the best spot; the arrow is your fix.',
    tooShort: 'That run was too short to score. Try a full one!',
    progress: 'Your progress',
    notSaved: 'This browser cannot save progress, so this run is not kept.',
    keys: 'Keyboard: Tab to YOU and use the arrow keys (Shift for bigger steps). Space pauses.',
    sec: (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`,
  },
  kid: {
    title: 'Live',
    heading: 'Keep your spot',
    lead: (secs, role) => `${secs} seconds of play. You are the ${role}. Keep dragging yourself to the best spot while the ball moves. Right after a pass you get a moment to react.`,
    best: (score, grade) => `Your best here: ${score} (${grade}).`,
    noBest: 'No best score here yet.',
    seed: (seed) => `Game ${seed}`,
    seedHint: 'Keep this link to play the same game again.',
    duration: 'How long', speed: 'Speed',
    wheels: 'Show the best spot', wheelsHint: 'Helper mode: this game will not count as your best.',
    start: 'Start', newSeq: 'New game', again: 'Play again',
    get: (n) => `Get ready… ${n}`,
    go: 'Go!',
    pause: 'Pause', resume: 'Go on', end: 'Stop',
    paused: 'Paused. You can still move yourself.',
    running: 'Your score so far',
    left: (s) => `${s} s left`,
    grace: 'Moving…',
    assisted: 'Helper on',
    resultTitle: 'Finished!',
    average: 'Your score',
    verdict: { S: 'Amazing! You were always in the right place.', A: 'Great job!', B: 'Good job!', C: 'Nearly! Some moments got away.', D: 'Keep watching the ball!', F: 'Keep practising: move with your team.' },
    personalBest: 'New best score!',
    firstBest: 'Your first score here. Can you beat it?',
    assistedNote: 'Helper mode was on, so this is not your best and earns no XP.',
    assistedNoteNoXp: 'Helper mode was on, so this is not your best.',
    onSpot: (pct) => `${pct}% of the time in a great spot`,
    recovery: (s) => `${s} s to get back after a pass`,
    noRecovery: 'Passes never caught you out',
    chartTitle: 'Your score during the game',
    chartDesc: (avg, min, max) => `Your score over time: average ${avg}, lowest ${min}, highest ${max}.`,
    chartTable: 'Show as a table',
    tableWhen: 'Seconds', tableScore: 'Score',
    worst: (n) => (n === 1 ? 'Your hardest moment' : `Your ${['', '', 'two', 'three'][n] ?? n} hardest moments`),
    worstItem: (time, score, grade) => `${time} · ${score} (${grade})`,
    replayMoment: 'See it',
    backToResults: 'Back',
    leadUp: 'Watch what led to it',
    momentTitle: (time) => `At ${time}`,
    momentNote: 'This is where you were. The blue ring is the best spot.',
    tooShort: 'That was too short to score. Try a whole game!',
    progress: 'My progress',
    notSaved: 'This browser cannot save your progress.',
    keys: 'Keyboard: press Tab to pick YOU, then use the arrow keys. Space pauses.',
    sec: (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`,
  },
};

const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, kids = []) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  for (const c of kids) if (c) n.append(c);
  return n;
};

/** A fresh, short, readable seed (UI only: the engine stays deterministic from it). */
function freshSeed() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(6);
  try { crypto.getRandomValues(bytes); } catch { for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256); }
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app, params = []) {
  const P = LIVE_DEFAULTS;
  const formations = app.data.formations ?? (() => { const f = createFormation(); return { us: f, them: f }; })();
  const principles = app.data.principles?.byId ?? {};
  const store = app.store;
  const wording = () => (app.settings.wording === 'kid' ? 'kid' : 'standard');
  const C = () => COPY[wording()];
  const role = app.settings.role;
  const roleLabel = () => (ROLE_INFO[role]?.label ?? role).toLowerCase();

  const seed = (params[0] && /^[a-z0-9-]{1,40}$/i.test(params[0]) ? params[0] : freshSeed()).toLowerCase();
  const askedDuration = Number(params[1]);
  const opts = {
    speed: preferred.speed,
    duration: P.durations.includes(askedDuration) ? askedDuration : preferred.duration,
    ghost: preferred.ghost,
  };
  // Keep the seed AND the length in the address: the sequence depends on both (its turnovers are timed from
  // the length), so a refresh or a shared link replays exactly the same play.
  const syncHash = () => {
    const want = S.liveHash(seed, opts.duration);
    if (location.hash !== want) {
      try { history.replaceState(null, '', want); } catch { /* sandboxed */ }
    }
  };
  syncHash();

  let alive = true;
  root.classList.add('lv');
  const layout = stageLayout(root, { label: `${C().title}: controls and results` });
  const board = app.createBoard(layout.board, { orientation: S.orientationFor(window.innerWidth, window.innerHeight) });
  board.setOverlays({ thirds: false, lanes: false, zone14: false, offsideLine: null, backLine: null });
  const els = {
    top: el('div', { class: 'lv-top' }),
    main: el('div', { class: 'lv-main' }),
    reveal: el('div', { class: 'lv-reveal' }),
    after: el('div', { class: 'lv-after' }),
    body: el('div', { class: 'lv-body' }),
    countdown: el('div', { class: 'lv-countdown', 'aria-hidden': 'true', hidden: true }),
  };
  layout.panel.head.append(els.top, els.main, els.reveal, els.after);
  layout.panel.body.append(els.body);
  layout.board.append(els.countdown);
  const panel = createFeedbackPanel(els.reveal, { app });

  // ---- the run
  let run = null; // { scenario, learnerId, held, free, events, tol, t, spot, samples, pending, ... }
  let raf = 0, cdTimer = 0, sampleTimer = 0;
  let phase = 'intro';
  let lastInputWasKeyboard = false;

  function newRun() {
    const scenario = generateSequence({ seed, duration: opts.duration, role, formations });
    const learnerId = learnerIdOf(scenario);
    const free = createPlayback(scenario, { formations, learnerId: null });
    const held = createPlayback(scenario, { formations });
    const start = baseAt({ scenario, learnerId, free }, 0);
    run = {
      scenario, learnerId, free, held, start,
      events: graceEvents(scenario),
      tol: toleranceFor(role),
      duration: scenario.timeline.duration,
      t: 0, spot: { ...start }, samples: [], nextSample: 0, pending: [],
      assisted: opts.ghost, paused: false, ringKey: '', last: null,
    };
  }

  /** The learner's base at t: its spot with everybody auto-placed (learnerBaseAt); a carrier falls back to the engine. */
  function baseAt(r, t) {
    const f = r.free.frameAt(t);
    const me = f.players.find((p) => p.id === r.learnerId);
    if (f.carrierId === r.learnerId) return learnerBaseAt(r.scenario, t, { formations });
    return { x: me.x, y: me.y };
  }

  function draw(t, spot) {
    board.render(run.held.frameAt(t, spot), { learnerId: run.learnerId, highlight: [BALL_ID] });
  }

  // ---- scoring (off the render path)
  function analyseAt(t, spot) {
    const frame = run.held.frameAt(t, spot);
    const base = baseAt(run, t);
    const ctx = buildContext(frame, { learnerId: run.learnerId, base });
    const ghost = computeGhost(ctx, { base, tol: run.tol });
    const judgement = judgeSpot({ ctx, ghost }, spot, { wording: wording(), principles });
    return { frame, base, ctx, ghost, judgement };
  }

  function processSamples() {
    sampleTimer = 0;
    if (!alive || !run) return;
    let latest = null;
    for (const s of run.pending.splice(0)) {
      const a = analyseAt(s.t, s.spot);
      const grace = inGrace(run.events, s.t, P.grace);
      const r = a.judgement.result;
      run.samples.push({ t: s.t, spot: s.spot, score: r.score, grade: r.grade, grace, ghost: a.ghost.spot });
      latest = { a, grace };
    }
    if (!latest || phase !== 'playing') return;
    panel.showLive(latest.a.judgement);
    const sc = latest.a.judgement.result.score;
    const R = P.ringAt;
    const ring = latest.grace ? { tone: 'info', pulse: false } : sc >= R.fire ? { tone: 'good', pulse: true } : sc >= R.hot ? { tone: 'good', pulse: false } : sc >= R.warm ? { tone: 'cue', pulse: false } : { tone: 'bad', pulse: true };
    const key = `${ring.tone}|${ring.pulse}`;
    if (key !== run.ringKey) {
      run.ringKey = key;
      board.setMarkers([{ type: 'ring', id: run.learnerId, ...ring }]);
    }
    if (run.assisted) board.setGhost(latest.a.ghost.spot);
    updateMeter(latest.grace);
  }

  function queueSamples(t) {
    const step = 1 / P.sampleHz;
    while (run.nextSample <= t + 1e-9 && run.nextSample <= run.duration + 1e-9) {
      run.pending.push({ t: Math.round(run.nextSample * 1000) / 1000, spot: { ...run.spot } });
      run.nextSample += step;
    }
    if (run.pending.length && !sampleTimer) sampleTimer = setTimeout(processSamples, 0);
  }

  // ---- intro
  // { refocus: false } re-phrases the intro for a settings change: focus, the sheet and the spot you dragged
  // yourself to all stay as they are.
  function showIntro({ refocus = true } = {}) {
    const again = phase === 'intro' && run && !refocus;
    phase = 'intro';
    if (refocus) layout.panel.head.scrollTop = 0;
    stopLoops();
    const c = C();
    if (!again) newRun();
    panel.clear();
    board.setGhost(null); board.setZone(null); board.setHeatmap(null);
    drawIntro();
    const best = S.loadLive(store).best[role];
    const setOpt = (k, v) => { opts[k] = v; preferred = { ...preferred, [k]: v }; };
    const lead = el('p', { class: 'lv-lead', text: c.lead(opts.duration, roleLabel()) });
    put(els.top, el('p', { class: 'lv-kicker', text: c.seed(seed) }), el('h1', { class: 'lv-title', text: c.heading }));
    put(els.main,
      lead,
      el('p', { class: 'lv-best' }, [icon('progress', { size: 16 }), best ? c.best(best.score, best.grade) : c.noBest]),
      el('div', { class: 'lv-opts' }, [
        // A new length is a new sequence: rebuild the run and the address in place, so focus stays on the radios.
        segmented({ legend: c.duration, value: String(opts.duration), options: P.durations.map((d) => ({ value: String(d), label: `${d} s` })), onChange: (v) => {
          setOpt('duration', Number(v));
          syncHash();
          newRun();
          drawIntro();
          lead.textContent = C().lead(opts.duration, roleLabel());
        } }),
        segmented({ legend: c.speed, value: String(opts.speed), options: P.speeds.map((s) => ({ value: String(s), label: `${s}×` })), onChange: (v) => setOpt('speed', Number(v)) }),
      ]),
      toggleSwitch({ label: c.wheels, hint: c.wheelsHint, checked: opts.ghost, onChange: (on) => setOpt('ghost', on) }),
    );
    put(els.after);
    const start = button(c.start, { variant: 'primary', icon: 'play', className: 'lv-main-btn', onClick: startCountdown });
    layout.panel.actions.replaceChildren(start, button(c.newSeq, { variant: 'ghost', onClick: () => app.navigate('#/live') }));
    put(els.body, el('p', { class: 'lv-keys', text: c.keys }), el('p', { class: 'lv-keys', text: c.seedHint }));
    board.enableDrag({ ids: [run.learnerId], onMove: onDrag, onEnd: onDrag });
    if (!refocus) return;
    layout.collapse();
    start.focus({ preventScroll: true });
  }

  function drawIntro() {
    board.setMarkers([{ type: 'ring', id: run.learnerId, tone: 'info', pulse: true }]);
    draw(0, run.spot);
  }

  function onDrag(_id, p) {
    if (!run) return;
    run.spot = { x: p.x, y: p.y };
    if (phase !== 'playing') draw(run.t, run.spot); // playing: the next animation frame draws it
  }

  // ---- countdown and play
  function startCountdown() {
    const c = C();
    phase = 'countdown';
    run.assisted = opts.ghost;
    board.setMarkers([{ type: 'ring', id: run.learnerId, tone: 'info', pulse: false }]);
    let n = P.countdown;
    const tick = () => {
      if (!alive || phase !== 'countdown') return;
      if (n <= 0) {
        els.countdown.hidden = true;
        startPlay();
        return;
      }
      els.countdown.hidden = false;
      els.countdown.replaceChildren(el('span', { class: 'lv-count', text: String(n) }));
      announce(c.get(n));
      n--;
      cdTimer = setTimeout(tick, 800);
    };
    const hadFocus = layout.panel.actions.contains(document.activeElement) || document.activeElement === document.body;
    const end = button(c.end, { variant: 'ghost', className: 'lv-end', onClick: () => showIntro() });
    layout.panel.actions.replaceChildren(end);
    put(els.main, el('p', { class: 'lv-lead', text: c.get(P.countdown) }));
    // Start went with the old action bar. A keyboard player lands on their own token, so the arrow keys move
    // them the moment play starts; anyone else keeps focus in the bar (on End run) rather than losing it.
    const token = board.el.querySelector(`.token[data-id="${run.learnerId}"]`);
    if (lastInputWasKeyboard && token) token.focus({ preventScroll: true });
    else if (hadFocus) end.focus({ preventScroll: true });
    tick();
  }

  /** The Pause / End run bar. Rebuilding it keeps focus on the same button if one of them had it; focus coming
   *  from the countdown's bar goes to Pause (Space on a focused button presses it: it must pause, not end, the run). */
  function playingActions({ fromCountdown = false } = {}) {
    const c = C();
    const bar = layout.panel.actions;
    const inBar = bar.contains(document.activeElement);
    const was = !inBar ? null : fromCountdown || document.activeElement.classList.contains('lv-pause') ? 'pause' : 'end';
    const pauseBtn = button(run.paused ? c.resume : c.pause, { icon: run.paused ? 'play' : 'pause', className: 'lv-pause', 'aria-pressed': String(run.paused), onClick: togglePause });
    const endBtn = button(c.end, { variant: 'ghost', className: 'lv-end', onClick: () => finish(true) });
    bar.replaceChildren(pauseBtn, endBtn);
    if (was === 'pause') pauseBtn.focus({ preventScroll: true });
    else if (was === 'end') endBtn.focus({ preventScroll: true });
  }

  function startPlay() {
    const c = C();
    phase = 'playing';
    announce(c.go);
    playingActions({ fromCountdown: true });
    els.meter = {
      avg: el('span', { class: 'lv-avg-num', text: '–' }),
      left: el('span', { class: 'lv-left' }),
      fill: el('span', { class: 'lv-time-fill' }),
      state: el('span', { class: 'lv-state' }),
    };
    put(els.top, el('div', { class: 'lv-hud' }, [
      el('span', { class: 'lv-avg' }, [el('span', { class: 'lv-avg-label', text: c.running }), els.meter.avg]),
      els.meter.state,
      run.assisted ? el('span', { class: 'lv-tag', text: c.assisted }) : null,
      els.meter.left,
    ]), el('div', { class: 'lv-time', 'aria-hidden': 'true' }, [els.meter.fill]));
    put(els.main);
    put(els.after);
    run.last = null;
    board.setMarkers([{ type: 'ring', id: run.learnerId, tone: 'info', pulse: false }]);
    const step = (now) => {
      if (!alive || phase !== 'playing') return;
      if (run.last !== null && !run.paused) run.t = Math.min(run.duration, run.t + Math.min(P.maxFrameDt, (now - run.last) / 1000) * opts.speed);
      run.last = now;
      draw(run.t, run.spot);
      if (!run.paused) queueSamples(run.t);
      updateClock();
      if (run.t >= run.duration - 1e-9) { finish(false); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function updateClock() {
    const m = els.meter;
    if (!m) return;
    const left = Math.max(0, Math.ceil(run.duration - run.t));
    const txt = C().left(left);
    if (m.left.textContent !== txt) m.left.textContent = txt;
    m.fill.style.width = `${(100 * run.t) / run.duration}%`;
  }

  function updateMeter(grace) {
    const m = els.meter;
    if (!m) return;
    const scored = run.samples.filter((s) => !s.grace);
    const avg = scored.length ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length) : null;
    m.avg.textContent = avg === null ? '–' : String(avg);
    m.avg.style.setProperty('--grade', avg === null ? 'transparent' : gradeColor(gradeOf(avg)));
    m.state.textContent = grace ? C().grace : '';
  }

  function togglePause() {
    if (phase !== 'playing') return;
    run.paused = !run.paused;
    run.last = null;
    // Space pauses from anywhere (e.g. while focus is on your token): focus stays where it is then.
    playingActions();
    put(els.after, run.paused ? el('p', { class: 'lv-note', text: C().paused }) : null);
  }

  // ---- end of the run
  function finish(early) {
    stopLoops();
    if (run.pending.length) processSamples();
    phase = 'done';
    board.disableDrag();
    const res = S.summarizeLive(run.samples, run.events);
    run.result = res;
    run.early = early;
    if (res.scored >= P.sampleHz * 5) {
      const day = S.dayKey(new Date());
      S.saveStreak(store, S.updateStreak(S.loadStreak(store), { day, rep: false }));
      const liveNow = S.loadLive(store);
      const rec = S.recordLiveBest(liveNow, { role, score: res.average, grade: res.grade, seed, at: Date.now(), assisted: run.assisted, length: run.duration });
      if (!early) S.saveLive(store, rec.live);
      run.isBest = rec.isBest && !early;
      run.firstBest = run.isBest && !liveNow.best[role];
      // duration: the seconds played; length: the sequence's length (with the seed, it replays the run).
      S.appendHistory(store, {
        t: Date.now(), mode: 'live', id: run.scenario.id, seed, length: run.duration, title: 'Live', role, score: res.average, grade: res.grade,
        assisted: run.assisted, duration: Math.round(run.t * 10) / 10, speed: opts.speed, recovery: res.recovery, onSpot: Math.round(res.onSpot * 100), early,
      });
      rewardRun(res, early);
    } else run.tooShort = true;
    showResults();
  }

  /** Rewards (ARCHITECTURE §5.13) for a run played to the end without the best spot on show. */
  function rewardRun(res, early) {
    if (early || run.assisted || !earnsRewards(app)) return;
    award(app, { type: 'live', average: res.average }, { grade: res.grade });
  }

  function showResults({ refocus = true } = {}) {
    const c = C();
    phase = 'done';
    run.moment = null;
    if (refocus) layout.panel.head.scrollTop = 0;
    panel.clear();
    const res = run.result;
    board.setGhost(null); board.setZone(null); board.setHeatmap(null); board.setMarkers([]);
    draw(run.t, run.spot);
    put(els.top, el('p', { class: 'lv-kicker', text: c.seed(seed) }), el('h1', { class: 'lv-title', text: c.resultTitle }));
    if (run.tooShort) {
      put(els.main, el('p', { class: 'lv-lead', text: c.tooShort }));
    } else {
      put(els.main,
        el('div', { class: 'lv-result' }, [
          el('span', { class: 'lv-badge', style: { '--grade': gradeColor(res.grade) }, 'aria-hidden': 'true', text: res.grade }),
          el('div', {}, [
            el('p', { class: 'lv-result-label', text: c.average }),
            el('p', { class: 'lv-result-num' }, [el('span', { text: String(res.average) }), el('span', { class: 'lv-outof', text: '/100' })]),
            el('p', { class: 'visually-hidden', text: `${c.average}: ${res.average}, grade ${res.grade}.` }),
          ]),
        ]),
        el('p', { class: 'lv-verdict', text: c.verdict[res.grade] ?? '' }),
        run.isBest && !run.firstBest ? el('p', { class: 'lv-pb' }, [icon('check', { size: 18 }), c.personalBest]) : null,
        run.firstBest ? el('p', { class: 'lv-note', text: c.firstBest }) : null,
        run.assisted ? el('p', { class: 'lv-note', text: earnsRewards(app) ? c.assistedNote : c.assistedNoteNoXp }) : null,
        el('ul', { class: 'lv-stats' }, [
          el('li', { text: c.onSpot(Math.round(res.onSpot * 100)) }),
          el('li', { text: res.recovery === null ? c.noRecovery : c.recovery(res.recovery) }),
        ]),
        chart(res),
        res.worst.length ? el('section', { class: 'lv-worst', 'aria-labelledby': 'lv-worst-h' }, [
          el('h2', { id: 'lv-worst-h', class: 'lv-h', text: c.worst(res.worst.length) }),
          el('ol', {}, res.worst.map((w, i) => el('li', {}, [
            el('span', { class: 'lv-worst-n', 'aria-hidden': 'true', text: String(i + 1) }),
            el('span', { class: 'lv-worst-text' }, [c.worstItem(c.sec(w.t), w.score, gradeOf(w.score))]),
            button(c.replayMoment, { icon: 'play', className: 'lv-worst-btn', onClick: () => showMoment(w) }),
          ]))),
        ]) : null,
        store.isPersistent?.() === false ? el('p', { class: 'lv-note', text: c.notSaved }) : null,
      );
    }
    put(els.after);
    const again = button(c.again, { variant: 'primary', icon: 'play', className: 'lv-main-btn', onClick: () => showIntro() });
    layout.panel.actions.replaceChildren(again, button(c.newSeq, { onClick: () => app.navigate('#/live') }), linkButton(c.progress, '#/progress', { variant: 'ghost' }));
    put(els.body, el('p', { class: 'lv-keys', text: c.seedHint }));
    if (!refocus) return;
    if (window.matchMedia?.('(max-width: 899.98px)').matches) layout.expand();
    again.focus({ preventScroll: true });
    if (!run.tooShort) announce(`${c.resultTitle} ${c.average}: ${res.average}, grade ${res.grade}.`);
  }

  // ---- score chart: one line (score over time), grade bands as recessive gridlines, the worst moments marked
  function chart(res) {
    const c = C();
    // Drawn at the width it is shown at, so the axis text stays at its real size.
    const { h, padL, padR, padT, padB } = P.chart;
    const w = Math.round(Math.max(P.chart.minW, Math.min(P.chart.maxW, els.top.clientWidth || P.chart.w)));
    const pts = run.samples.filter((s) => Number.isFinite(s.score));
    const span = run.early ? Math.max(5, Math.ceil(run.t / 5) * 5) : run.duration; // an ended-early run fills the chart
    const X = (t) => padL + ((w - padL - padR) * t) / span;
    const Y = (v) => padT + ((h - padT - padB) * (100 - v)) / 100;
    const scored = pts.filter((s) => !s.grace).map((s) => s.score);
    const titleId = uid('lv-chart-t'), descId = uid('lv-chart-d');
    const svg = svgEl('svg', { class: 'lv-chart-svg', viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-labelledby': `${titleId} ${descId}` });
    svg.append(svgEl('title', { id: titleId }, [document.createTextNode(c.chartTitle)]));
    svg.append(svgEl('desc', { id: descId }, [document.createTextNode(c.chartDesc(res.average, Math.min(...scored), Math.max(...scored)))]));
    for (const v of [50, 70, 90]) {
      svg.append(svgEl('line', { class: 'lv-grid', x1: padL, x2: w - padR, y1: Y(v), y2: Y(v) }));
      svg.append(svgEl('text', { class: 'lv-tick', x: padL - 4, y: Y(v), 'text-anchor': 'end', dy: '0.35em' }, [document.createTextNode(String(v))]));
    }
    svg.append(svgEl('line', { class: 'lv-axis', x1: padL, x2: w - padR, y1: Y(0), y2: Y(0) }));
    const every = span > 30 ? 15 : 5;
    for (let s = 0; s <= span + 1e-9; s += every) {
      svg.append(svgEl('text', { class: 'lv-tick', x: X(s), y: h - 4, 'text-anchor': s === 0 ? 'start' : 'middle' }, [document.createTextNode(`${s}s`)]));
    }
    // Reaction windows (not scored), as faint bands.
    for (const e of run.events) {
      if (e.t > run.t) break;
      svg.append(svgEl('rect', { class: 'lv-grace', x: X(e.t), y: padT, width: Math.max(0.5, X(Math.min(run.t, e.t + P.grace)) - X(e.t)), height: h - padT - padB }));
    }
    const d = pts.map((s, i) => `${i ? 'L' : 'M'}${X(s.t).toFixed(1)} ${Y(s.score).toFixed(1)}`).join('');
    svg.append(svgEl('path', { class: 'lv-line', d }));
    res.worst.forEach((wm, i) => {
      const cx = X(wm.t), cy = Y(wm.score);
      svg.append(svgEl('circle', { class: 'lv-mark', cx, cy, r: 5 }));
      svg.append(svgEl('text', { class: 'lv-mark-n', x: cx, y: cy, 'text-anchor': 'middle', dy: '0.35em' }, [document.createTextNode(String(i + 1))]));
    });
    // Hover: a crosshair and a readout snapped to the nearest sample.
    const cross = svgEl('line', { class: 'lv-cross', x1: 0, x2: 0, y1: padT, y2: h - padB, visibility: 'hidden' });
    const dot = svgEl('circle', { class: 'lv-cross-dot', r: 3.5, visibility: 'hidden' });
    svg.append(cross, dot);
    const tip = el('div', { class: 'lv-tip', hidden: true });
    const wrap = el('figure', { class: 'lv-chart' }, [el('figcaption', { class: 'lv-h', text: c.chartTitle }), el('div', { class: 'lv-chart-box' }, [svg, tip])]);
    const onMove = (e) => {
      const r = svg.getBoundingClientRect();
      const t = ((e.clientX - r.left) / r.width * w - padL) / (w - padL - padR) * span;
      let best = null;
      for (const s of pts) if (!best || Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
      if (!best) return;
      const x = X(best.t), y = Y(best.score);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.textContent = `${c.sec(best.t)} · ${best.score}${best.grace ? ` · ${c.grace}` : ''}`;
      tip.style.left = `${(100 * x) / w}%`;
    };
    const onLeave = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerleave', onLeave);
    // The same data as a table (5 s buckets).
    const rows = [];
    for (let s = 0; s < run.duration; s += 5) {
      const b = pts.filter((p) => !p.grace && p.t >= s && p.t < s + 5);
      if (b.length) rows.push([`${s}-${s + 5}`, Math.round(b.reduce((a, p) => a + p.score, 0) / b.length)]);
    }
    wrap.append(el('details', { class: 'lv-table' }, [
      el('summary', { text: c.chartTable }),
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: c.tableWhen }), el('th', { scope: 'col', text: c.tableScore })])]),
        el('tbody', {}, rows.map(([a, b]) => el('tr', {}, [el('td', { text: a }), el('td', { text: String(b) })]))),
      ]),
    ]));
    return wrap;
  }

  // ---- a worst moment, frozen
  function showMoment(w, { refocus = true } = {}) {
    const c = C();
    phase = 'moment';
    run.moment = w;
    if (refocus) layout.panel.head.scrollTop = 0;
    stopLoops();
    const sample = run.samples.find((s) => s.t === w.t) ?? run.samples.reduce((a, s) => (Math.abs(s.t - w.t) < Math.abs(a.t - w.t) ? s : a));
    const a = analyseAt(sample.t, sample.spot);
    drawMoment(sample, a);
    put(els.top, el('p', { class: 'lv-kicker', text: c.seed(seed) }), el('h1', { class: 'lv-title', text: c.momentTitle(c.sec(sample.t)) }));
    put(els.main);
    panel.showFull(a.judgement, { focus: false, principleLinks: false, animate: refocus }); // a link would leave the results
    put(els.after, el('p', { class: 'lv-legend' }, [el('span', { class: 'lv-legend-ring', 'aria-hidden': 'true' }), c.momentNote]));
    const back = button(c.backToResults, { variant: 'primary', icon: 'arrow', className: 'lv-main-btn', onClick: () => showResults() });
    layout.panel.actions.replaceChildren(button(c.leadUp, { icon: 'play', onClick: () => playLeadUp(sample, a) }), back);
    if (!refocus) return;
    layout.collapse();
    back.focus({ preventScroll: true });
  }

  function drawMoment(sample, a) {
    draw(sample.t, sample.spot);
    board.setGhost(a.ghost.spot);
    board.setZone({ center: a.ghost.result.center, tol: a.ghost.result.tol });
    board.setHeatmap(a.ghost.field);
    const markers = [];
    if (dist(sample.spot, a.ghost.spot) >= 1) markers.push({ type: 'arrow', from: sample.spot, to: a.ghost.spot, tone: 'fix' });
    const hl = a.judgement.feedback.cue?.highlight;
    if (hl) markers.push({ ...hl, tone: 'cue', pulse: false });
    board.setMarkers(markers);
  }

  /** Where you were at time t (linear between the 10 Hz samples). */
  function spotAt(t) {
    const s = run.samples;
    if (!s.length) return run.spot;
    let i = s.findIndex((q) => q.t >= t);
    if (i <= 0) return i === 0 ? s[0].spot : s[s.length - 1].spot;
    const p = s[i - 1], q = s[i], u = (t - p.t) / (q.t - p.t || 1);
    return { x: lerp(p.spot.x, q.spot.x, u), y: lerp(p.spot.y, q.spot.y, u) };
  }

  function playLeadUp(sample, a) {
    stopLoops();
    layout.collapse();
    board.setHeatmap(null); board.setZone(null); board.setMarkers([]);
    board.setGhost(null);
    let t = Math.max(0, sample.t - P.leadUp), last = null;
    const step = (now) => {
      if (!alive || phase !== 'moment') return;
      if (last !== null) t = Math.min(sample.t, t + Math.min(P.maxFrameDt, (now - last) / 1000) * opts.speed);
      last = now;
      draw(t, spotAt(t));
      if (t >= sample.t - 1e-9) { raf = 0; drawMoment(sample, a); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function stopLoops() {
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(cdTimer);
    cdTimer = 0;
    if (sampleTimer) { clearTimeout(sampleTimer); sampleTimer = 0; }
    els.countdown.hidden = true;
  }

  // ---- keyboard (Space pauses) and a hidden tab (pause)
  const onKey = (e) => {
    lastInputWasKeyboard = true;
    if (e.key !== ' ' || phase !== 'playing') return;
    if (e.target?.closest?.('button, a, input, select, textarea, summary')) return;
    e.preventDefault();
    togglePause();
  };
  const onPointer = () => { lastInputWasKeyboard = false; };
  const onVisibility = () => { if (document.hidden && phase === 'playing' && !run.paused) togglePause(); };
  const onResize = () => board.setOrientation(S.orientationFor(window.innerWidth, window.innerHeight));
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);

  // Wording changes re-phrase the screen in place: focus stays where it is (e.g. in the open settings menu).
  const offSettings = app.onSettings?.((_s, patch) => {
    if (!alive || !('wording' in (patch ?? {}))) return;
    if (phase === 'intro') showIntro({ refocus: false });
    else if (phase === 'done') showResults({ refocus: false });
    else if (phase === 'moment' && run?.moment) showMoment(run.moment, { refocus: false });
  });

  showIntro();

  return () => {
    alive = false;
    stopLoops();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', onResize);
    offSettings?.();
    panel.destroy();
    board.destroy();
    layout.destroy();
  };
}

