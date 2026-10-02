// '#/kickoff': the first open (docs/KID_REDESIGN.md §4.1 steps 1, 2 and 4). No tour, no sign-up: play within seconds.
//
//   #/kickoff        step 1: a full-bleed pitch with a real authored drill replaying behind the wordmark (dimmed, silent;
//                    a still frame under reduced motion): tabletop figures, as a small game when the drill can be one
//                    (js/engine/cast.js bestStage: only the players the drill is about, the camera on them, so the
//                    figures are big) and one big Play button. 6 words or fewer.
//   #/kickoff/pick   step 2: "What do you play?" with four big players: Defender · Midfielder · Winger · Striker, each
//                    a figure (js/ui/figures.js) in your kit with its position's number and look (shell.js kidFigure). A tap
//                    saves the profile (group, its starting role, onboarded; road.js pickGroup) and opens '#/play/first'
//                    (the onboarding set, owned by js/ui/player/play.js). Play on step 1 opens this step in place and
//                    pushes its address, so Back returns to step 1.
//   #/kickoff/kit    step 4: "Make it yours" (skippable): kit colour (locked ones show their level, as in the kit
//                    locker, so the choice reads as a collection to earn, never a broken one-swatch section),
//                    pick-list (card.js kitEditor, saved through js/rewards.js setKit) → '#/'.
//
// Nothing touches the DOM at import time; STRINGS holds every visible word (tests/copy.test.js).

import { el } from '../components.js';
import { frameAt, timing } from '../../engine/timeline.js';
import { ROLE_INFO } from '../../engine/roles.js';
import { loadProfile, saveProfile, pickGroup, loadRoad, GROUPS, DEFAULT_ROLE, STRINGS as ROAD_STRINGS } from './road.js';
import { playerIcon, kidFigure } from './shell.js';
import { kitEditor } from './card.js';

export const KICKOFF_DEFAULTS = Object.freeze({
  drills: Object.freeze(['m3-01-u2-lcm', 'm1-06-t3-rw', 'm2-08-b6-rw']), // [D] the replay behind the wordmark: the whole team sliding with a switch of play
  holdSec: 1.2, // [D] the replay rests this long on its last frame before it starts again
  maxStepSec: 0.05, // [D] a slow frame never jumps the replay more than this
  stage: 'small', // [D] the replay is the drill's smallest game that teaches it (cast.js bestStage): few players, big figures
  cameraStep: 0.25, // [D] s: the replay's camera fits the cast at these steps through the clip
});

export const STRINGS = Object.freeze({
  wordmark: 'fotbol',
  play: 'Play',
  pickTitle: 'What do you play?',
  groups: ROAD_STRINGS.groups,
  kitTitle: 'Make it yours',
  skip: 'Skip',
  done: 'Done',
});

const reducedMotion = (app) => {
  // main.js resolves the query into the attribute (audit 2026-10-01): read it, with the setting for DOM-less tests.
  return app?.settings?.reducedMotion === true || globalThis.document?.documentElement?.dataset?.reducedMotion === 'true';
};

/** The replay behind the wordmark: the first of KICKOFF_DEFAULTS.drills that loads. */
async function replayScenario(app) {
  const load = app.data?.scenarios?.load;
  if (typeof load !== 'function') return null;
  const ids = [...KICKOFF_DEFAULTS.drills, app.data.scenarios.index?.[0]?.id].filter(Boolean);
  for (const id of ids) {
    try { return await load(id); } catch { /* try the next */ }
  }
  return null;
}

/** Upright screens get the vertical pitch whatever the backdrop's box (it is wider than the screen). */
const uprightOrientation = () => 'vertical'; // Player mode's pitch is always upright (the owner, 2026-10-02)

/** Start the dimmed, silent replay in `host`. @returns {() => void} stop */
function startReplay(app, host) {
  let alive = true, raf = 0, board = null;
  const onResize = () => board?.setOrientation?.(uprightOrientation());
  globalThis.addEventListener?.('resize', onResize);
  (async () => {
    const scenario = await replayScenario(app);
    if (!alive || !scenario || !app.data?.formations) return;
    try {
      board = app.createBoard(host, { orientation: uprightOrientation(), labels: 'number', figures: true });
    } catch (err) {
      console.warn('[fotbol] kickoff: no board', err);
      return;
    }
    const formations = app.data.formations;
    const { duration, freezeAt } = timing(scenario);
    // A small game when the drill can be one (a few ms, once): only its cast, the camera on them.
    const small = await replayCast(app, scenario);
    if (!alive) return;
    const frame = (t) => {
      const f = frameAt(scenario, t, { formations, learnerId: null });
      return small ? small.reduce(f) : f;
    };
    if (small) {
      try { board.setCamera?.(replayCamera(frame, duration)); } catch { /* the whole pitch */ }
    }
    const draw = (t) => board.render(frame(t), { learnerId: null, labels: 'number' }); // (the ball has its own halo now)
    if (reducedMotion(app)) { draw(freezeAt); return; }
    let t = 0, last = null;
    const step = (now) => {
      if (!alive) return;
      if (last !== null) t += Math.min(KICKOFF_DEFAULTS.maxStepSec, (now - last) / 1000);
      last = now;
      if (t > duration + KICKOFF_DEFAULTS.holdSec) t = 0;
      draw(Math.min(t, duration));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  })().catch((err) => console.warn('[fotbol] kickoff: replay stopped', err));
  return () => {
    alive = false;
    globalThis.removeEventListener?.('resize', onResize);
    cancelAnimationFrame(raf);
    try { board?.destroy(); } catch { /* gone */ }
  };
}

/**
 * The replay's small game (js/engine/cast.js bestStage, loaded when the kick-off opens): its players and a frame
 * reducer; null for the whole team (the engine not there, or the drill has no smaller game).
 * @returns {Promise<{ ids: string[], reduce: (frame) => object } | null>}
 */
async function replayCast(app, scenario) {
  try {
    const cast = await import('../../engine/cast.js');
    const st = cast.bestStage(scenario, KICKOFF_DEFAULTS.stage, { formations: app.data.formations, principles: app.data.principles });
    if (st && st.stage !== 'full') return { ids: st.cast.ids, reduce: (f) => cast.reduceFrame(f, st.cast.ids) };
  } catch (err) { console.warn('[fotbol] kickoff: no small game', err); }
  return null;
}

/** The world rect the replay's cast covers through the clip (the camera fits it). */
export function replayCamera(frameOf, duration, step = KICKOFF_DEFAULTS.cameraStep) {
  let r = null;
  for (let t = 0; t <= duration + 1e-9; t += step) {
    const f = frameOf(Math.min(t, duration));
    for (const p of [...(f?.players ?? []), ...(f?.ball ? [f.ball] : [])]) {
      if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
      r = r ? { x0: Math.min(r.x0, p.x), x1: Math.max(r.x1, p.x), y0: Math.min(r.y0, p.y), y1: Math.max(r.y1, p.y) } : { x0: p.x, x1: p.x, y0: p.y, y1: p.y };
    }
  }
  return r;
}

/** A position's player on its button: a figure in your kit with the position's number and look (as YOU will be there). */
function shirt(group) {
  const role = DEFAULT_ROLE[group];
  return el('span', { class: 'pm-shirt-art', 'aria-hidden': 'true' }, [
    kidFigure({ role, number: ROLE_INFO[role]?.num ?? null, height: 96, className: 'pm-shirt-fig' }),
  ]);
}

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app, params = []) {
  const step = String(params[0] ?? '').toLowerCase();

  // ---- step 4: Make it yours
  if (step === 'kit') {
    const done = () => {
      const p = loadProfile(app);
      if (!p.onboarded && p.group) saveProfile(app, { ...p, onboarded: true });
      app.navigate('#/');
    };
    root.replaceChildren(el('div', { class: 'pm-page pm-makeit' }, [
      el('div', { class: 'pm-makeit-head' }, [
        el('h1', { class: 'pm-h1', text: STRINGS.kitTitle }),
        el('a', { class: 'pm-btn pm-btn--quiet', href: '#/', onclick: (e) => { e.preventDefault(); done(); } }, [el('span', { text: STRINGS.skip })]),
      ]),
      kitEditor(app, { showLocked: true, saveLabel: STRINGS.done, onSaved: done }),
    ]));
    return () => {};
  }

  // ---- steps 1 and 2: the pitch behind, the front changes
  const pitch = el('div', { class: 'pm-kick-pitch', 'aria-hidden': 'true' });
  const front = el('div', { class: 'pm-kick-front' });
  root.replaceChildren(el('div', { class: 'pm-kick' }, [pitch, el('div', { class: 'pm-kick-shade', 'aria-hidden': 'true' }), front]));
  const stop = startReplay(app, pitch);
  let road = null;
  loadRoad(app).then((r) => { road = r; }, () => {});

  function showKickoff() {
    front.classList.remove('is-pick');
    const play = el('button', {
      type: 'button', class: 'pm-btn pm-btn--hot pm-kick-play',
      onclick: () => {
        try { history.pushState(history.state, '', '#/kickoff/pick'); } catch { /* the address stays */ }
        showPick();
      },
    }, [playerIcon('play', { size: 30 }), el('span', { text: STRINGS.play })]);
    // One tappable thing: Play. The "Coach or parent?" door left this screen with the 2026-10-01 audit (it lives in
    // the settings sheet, behind a grown-up check); a parent can still type #/coach.
    front.replaceChildren(
      el('h1', { class: 'pm-wordmark', text: STRINGS.wordmark }),
      play,
    );
  }

  function showPick() {
    front.classList.add('is-pick');
    const titleId = 'pm-pick-title';
    front.replaceChildren(
      el('h1', { class: 'pm-pick-title', id: titleId, text: STRINGS.pickTitle }),
      el('div', { class: 'pm-shirts', role: 'group', 'aria-labelledby': titleId }, GROUPS.map((g) => el('button', {
        type: 'button', class: 'pm-shirt', dataset: { group: g },
        onclick: () => {
          const next = pickGroup(loadProfile(app), g, road);
          saveProfile(app, next);
          if (next.role && next.role !== app.settings.role) app.setSettings({ role: next.role }); // Coach mode starts there too
          app.navigate('#/play/first');
        },
      }, [shirt(g), el('span', { class: 'pm-shirt-name', text: STRINGS.groups[g] })]))),
    );
    front.querySelector('.pm-shirt')?.focus({ preventScroll: true });
  }

  if (step === 'pick') showPick();
  else showKickoff();
  return () => stop();
}
