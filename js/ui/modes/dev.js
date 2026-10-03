// '#/dev': developer playground for the whole engine loop on a real scene.
//
// Pick a canonical situation (tests/situations.js) and a role. autoFrame() places all 22 players
// from the HELIOS table; the engine's ghost, zone and heatmap are drawn for your role. Drag
// yourself (the YOU token): the score, grade and reasons update live (judgeSpot). Drag the ball, or
// change who has it: everyone re-positions and the ghost is searched again (analyseScene).
// Play laps the ball round the pitch through the same loop, as a render and engine stress test.

import { el, button, segmented, toggleSwitch, selectField, stageLayout } from '../components.js';
import { BALL_ID, describeSpot } from '../board.js';
import { SITUATIONS, sceneOptions } from '../../../tests/situations.js';
import { analyseScene, judgeSpot } from '../../engine/analyse.js';
import { createFormation } from '../../engine/formation.js';
import { phraseMove } from '../../engine/explain.js';
import { nameOf } from '../../engine/rules/_util.js';
import { EXPLORE_ROLES, ROLE_INFO, playerId } from '../../engine/roles.js';
import { MID_Y, HALF_X, clampToPitch } from '../../engine/pitch.js';

export const DEV_DEFAULTS = Object.freeze({
  playRadius: Object.freeze({ x: 30, y: 20 }), // [D] metres: ellipse the ball laps in play mode
  playPeriod: 12, // [D] seconds per lap
  playGhostEvery: 100, // [D] ms between ghost and heatmap searches while playing (placement runs every frame)
});

const POSSESSION_OPTIONS = [
  { value: 'them', label: 'Them' },
  { value: 'none', label: 'Loose' },
  { value: 'us', label: 'Us' },
];

const f1 = (v) => v.toFixed(1);

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app) {
  const P = DEV_DEFAULTS;
  const formation = app.data.formations?.us ?? createFormation(); // linear fallback if the table failed to load
  const formations = { us: formation, them: app.data.formations?.them ?? formation };
  const principles = app.data.principles?.byId ?? {};
  const layout = stageLayout(root, { label: 'Playground controls' });
  const board = app.createBoard(layout.board, { orientation: 'auto' });

  const state = {
    situation: SITUATIONS[0],
    ball: null, // the (possibly dragged) ball
    possession: null,
    role: app.settings.role,
    spot: null, // the learner's dragged spot; null = stand on the base
    scene: null, // analyseScene() result
    judged: null, // judgeSpot() result at the learner's spot
    orientation: 'auto',
    overlays: { thirds: true, lanes: false, zone14: false, offsideLine: true, backLine: true },
    layers: { heatmap: true, ghost: true, zone: true, markers: true, labels: true, dimOthers: false },
    playing: false,
    timing: { analyse: 0, judge: 0 },
    fps: 0,
  };
  const learnerId = () => playerId('us', state.role);
  const wording = () => (app.settings.wording === 'kid' ? 'kid' : 'standard');

  function sceneOpts() {
    const s = { ...state.situation, ball: state.ball, possession: state.possession };
    if (state.possession !== state.situation.possession) delete s.carriers; // a changed possession picks its own carrier
    return sceneOptions(s, learnerId(), formations);
  }

  // ---- the engine loop
  function analyse({ ghost = true } = {}) {
    const t0 = performance.now();
    const opts = sceneOpts();
    const prev = state.scene;
    state.scene = ghost || !prev ? analyseScene(opts) : { ...analyseScene({ ...opts, ghost: { radius: 0 } }), ghost: prev.ghost };
    state.timing.analyse = performance.now() - t0;
    judge();
  }

  function judge() {
    const t0 = performance.now();
    state.judged = judgeSpot(state.scene, learnerSpot(), { wording: wording(), principles });
    state.timing.judge = performance.now() - t0;
  }

  const learnerSpot = () => state.spot ?? state.scene.base;

  /** The frame to draw: the scene with the learner at their spot. */
  function drawnFrame() {
    const f = state.scene.frame, id = learnerId(), p = learnerSpot();
    return { ...f, players: f.players.map((q) => (q.id === id ? { ...q, x: p.x, y: p.y } : q)) };
  }

  // ---- drawing
  function applyLayers() {
    const L = state.layers, { ghost, base } = state.scene;
    board.setHeatmap(L.heatmap ? ghost.field : null);
    board.setGhost(L.ghost ? ghost.spot : null);
    board.setZone(L.zone ? { center: base, tol: ghost.result.tol } : null);
  }

  function draw() {
    const { ctx } = state.scene;
    const O = state.overlays;
    board.setOverlays({
      thirds: O.thirds, lanes: O.lanes, zone14: O.zone14,
      offsideLine: O.offsideLine ? ctx.lines.oppSecondLastX : null,
      backLine: O.backLine ? ctx.lines.ourBackLineX : null,
    });
    const markers = [];
    if (state.layers.markers) {
      const fb = state.judged.feedback;
      if (fb.fix && state.layers.ghost) markers.push({ type: 'arrow', from: learnerSpot(), to: state.scene.ghost.spot, tone: 'fix' });
      if (fb.cue?.highlight) markers.push({ ...fb.cue.highlight, tone: 'cue' });
      if (state.scene.frame.carrierId) markers.push({ type: 'ring', id: state.scene.frame.carrierId, tone: 'info', pulse: false });
    }
    board.setMarkers(markers);
    applyLayers();
    renderFrame();
    updatePanel();
  }

  function renderFrame() {
    board.render(drawnFrame(), {
      learnerId: learnerId(),
      highlight: [BALL_ID],
      labels: state.layers.labels ? 'role' : 'none',
      dimOthers: state.layers.dimOthers,
    });
  }

  // ---- interaction
  function onMove(id, p) {
    if (id === BALL_ID) {
      state.ball = clampToPitch(p);
      analyse();
    } else {
      state.spot = clampToPitch(p);
      judge();
    }
    draw();
  }

  function load(situation) {
    setPlaying(false);
    state.situation = situation;
    state.ball = { ...situation.ball };
    state.possession = situation.possession;
    state.spot = null;
    possessionControl.querySelectorAll('input').forEach((i) => { i.checked = i.value === state.possession; });
    analyse();
    board.enableDrag({ ids: [learnerId(), BALL_ID], onMove, onEnd: onMove });
    draw();
  }

  // ---- play mode: the ball laps an ellipse and the whole loop runs on it
  let raf = 0, t0 = 0, frames = 0, fpsT = 0, lastGhost = 0;
  function tick(now) {
    if (!state.playing) return;
    if (!t0) { t0 = now; fpsT = now; }
    const a = ((now - t0) / 1000 / P.playPeriod) * 2 * Math.PI;
    state.ball = clampToPitch({ x: HALF_X + P.playRadius.x * Math.cos(a), y: MID_Y + P.playRadius.y * Math.sin(a) });
    const ghost = now - lastGhost >= P.playGhostEvery;
    if (ghost) lastGhost = now;
    analyse({ ghost });
    frames++;
    if (now - fpsT >= 1000) { state.fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
    if (ghost) draw(); else { renderFrame(); updatePanel(); }
    raf = requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    if (on === state.playing) return;
    state.playing = on;
    playBtn.querySelector('span').textContent = on ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(on));
    if (on) { t0 = 0; frames = 0; state.fps = 0; lastGhost = 0; raf = requestAnimationFrame(tick); } else { cancelAnimationFrame(raf); if (state.scene) { analyse(); draw(); } }
  }

  // ---- panel
  const scoreEl = el('p', { class: 'dev-score' });
  const reasonsEl = el('ul', { class: 'dev-reasons' });
  const readout = el('pre', { class: 'dev-readout' });

  function updatePanel() {
    const { result, feedback } = state.judged;
    const { ctx, ghost, base, frame } = state.scene;
    scoreEl.replaceChildren(
      el('span', { class: 'dev-score-num', text: String(result.score) }),
      el('span', { class: `dev-grade dev-grade--${result.grade}`, text: result.grade }),
      el('span', { class: 'dev-headline', text: feedback.headline }),
    );
    const items = feedback.reasons.map((r) => el('li', {}, [el('strong', { text: `${r.principleId ?? ''} ${r.name}: ` }), r.text]));
    if (feedback.fix) items.push(el('li', { class: 'dev-fix' }, [el('strong', { text: 'Fix: ' }), feedback.fix.text]));
    if (feedback.cue) items.push(el('li', { class: 'dev-cue' }, [el('strong', { text: 'Cue: ' }), feedback.cue.text]));
    if (!feedback.reasons.length) for (const p of feedback.praise) items.push(el('li', { class: 'dev-praise', text: p }));
    reasonsEl.replaceChildren(...items);

    const spot = learnerSpot();
    const carrier = frame.players.find((p) => p.id === frame.carrierId);
    const lines = [
      `${ROLE_INFO[state.role].label}: ${ctx.duty}, ${ctx.blockHeight} block${ctx.markTarget ? `, marks ${nameOf(ctx.markTarget, ctx)}` : ''}`,
      `Ball x ${f1(state.ball.x)} y ${f1(state.ball.y)} · ${state.possession === 'none' ? 'loose' : `${state.possession} in possession`}${carrier ? ` · on the ball: ${carrier.id}` : ''}`,
      `You    x ${f1(spot.x)} y ${f1(spot.y)} (${describeSpot(spot)})`,
      `Base   x ${f1(base.x)} y ${f1(base.y)}`,
      `Ghost  x ${f1(ghost.spot.x)} y ${f1(ghost.spot.y)} scores ${ghost.score}${phraseMove(base, ghost.spot) ? ` (base → ghost: ${phraseMove(base, ghost.spot)})` : ''}`,
      `Rules at your spot: ${result.rules.map((r) => `${r.id} ${r.s.toFixed(2)}×${r.weight}`).join(', ') || 'none apply'}`,
      `Zone ${result.sZone.toFixed(2)} · rules ${result.sRules.toFixed(2)} · gate ${result.gate.toFixed(2)}${result.critical ? ' · CRITICAL' : ''}`,
      `Engine: scene ${state.timing.analyse.toFixed(1)} ms · judge ${state.timing.judge.toFixed(2)} ms · ${board.orientation}${state.playing ? ` · ${state.fps || '…'} fps` : ''}`,
    ];
    readout.textContent = lines.join('\n');
  }

  const playBtn = button('Play', { icon: 'play', variant: 'primary', 'aria-pressed': 'false', onClick: () => setPlaying(!state.playing) });
  const resetBtn = button('Reset', { onClick: () => load(state.situation) });
  const snapBtn = button('To the ghost', { onClick: () => { state.spot = { ...state.scene.ghost.spot }; judge(); draw(); } });

  const switches = (group, keys, onChange) => el('div', { class: 'dev-switches' }, keys.map(([key, label]) =>
    toggleSwitch({ label, checked: !!state[group][key], onChange: (on) => { state[group][key] = on; onChange(); } })));

  const possessionControl = segmented({
    legend: 'Who has the ball', value: SITUATIONS[0].possession, options: POSSESSION_OPTIONS,
    onChange: (v) => { setPlaying(false); state.possession = v; analyse(); draw(); },
  });

  // The live score sits in the head, so it stays visible in the collapsed bottom sheet on phones.
  layout.panel.head.append(el('h1', { text: 'Engine playground' }), scoreEl);
  layout.panel.actions.append(playBtn, resetBtn, snapBtn);
  layout.panel.feedback.append(reasonsEl);
  layout.panel.body.append(el('div', { class: 'dev-controls' }, [
    readout,
    selectField({ label: 'Situation', value: SITUATIONS[0].id, options: SITUATIONS.map((s) => ({ value: s.id, label: s.title })), onChange: (v) => load(SITUATIONS.find((s) => s.id === v)) }),
    selectField({ label: 'You play', value: state.role, options: EXPLORE_ROLES.map((r) => ({ value: r, label: ROLE_INFO[r].label })), onChange: (v) => { state.role = v; load(state.situation); } }),
    possessionControl,
    segmented({ legend: 'Orientation', value: state.orientation, options: [{ value: 'auto', label: 'Auto' }, { value: 'horizontal', label: 'Across' }, { value: 'vertical', label: 'Up' }], onChange: (v) => { state.orientation = v; board.setOrientation(v); updatePanel(); } }),
    segmented({ legend: 'Theme', value: app.settings.theme, options: [{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], onChange: (theme) => app.setSettings({ theme }) }),
    el('fieldset', { class: 'dev-group' }, [el('legend', { text: 'Overlays' }), switches('overlays', [['thirds', 'Thirds'], ['lanes', 'Lanes'], ['zone14', 'Zone 14'], ['offsideLine', 'Offside line'], ['backLine', 'Our back line']], draw)]),
    el('fieldset', { class: 'dev-group' }, [el('legend', { text: 'Layers' }), switches('layers', [['heatmap', 'Heatmap'], ['ghost', 'Ghost'], ['zone', 'Zone'], ['markers', 'Fix and cue'], ['labels', 'Role labels'], ['dimOthers', 'Dim others']], draw)]),
    el('p', { class: 'dev-note' }, ['Real placement, ghost and scoring: drag yourself (YOU) or the ball. The heatmap is the score of every spot within 15 m of your base; the ghost is its best spot. Keyboard: Tab to a token, then arrows move 0.5 m (Shift: 2 m). Touch: tap a token, then tap a spot.']),
  ]));

  // Wording changes re-phrase the feedback without re-placing anyone.
  const offSettings = app.onSettings?.(() => { if (state.scene) { judge(); draw(); } });

  load(SITUATIONS[0]);

  return () => {
    state.playing = false;
    cancelAnimationFrame(raf);
    offSettings?.();
    board.destroy();
    layout.destroy();
  };
}
