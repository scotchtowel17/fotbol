// '#/kickoff': the first open (docs/KID_REDESIGN.md §4.1 steps 1, 2 and 4). No tour, no sign-up: play within seconds.
//
//   #/kickoff        step 1: a full-bleed pitch with a real authored drill replaying behind the wordmark (dimmed, silent;
//                    a still frame under reduced motion), one big Play button and a small "Coach or parent?" link.
//                    6 words or fewer.
//   #/kickoff/pick   step 2: "What do you play?" with four big shirts: Defender · Midfielder · Winger · Striker. A tap
//                    saves the profile (group, its starting role, onboarded; road.js pickGroup) and opens '#/play/first'
//                    (the onboarding set, owned by js/ui/player/play.js). Play on step 1 opens this step in place and
//                    pushes its address, so Back returns to step 1.
//   #/kickoff/kit    step 4: "Make it yours" (skippable): kit colour (unlocked only), shirt number, nickname from the
//                    pick-list (card.js kitEditor, saved through js/rewards.js setKit) → '#/'.
//
// Nothing touches the DOM at import time; STRINGS holds every visible word (tests/copy.test.js).

import { el } from '../components.js';
import { BALL_ID } from '../board.js';
import { frameAt, timing } from '../../engine/timeline.js';
import { ROLE_INFO } from '../../engine/roles.js';
import { loadProfile, saveProfile, pickGroup, loadRoad, GROUPS, DEFAULT_ROLE, STRINGS as ROAD_STRINGS } from './road.js';
import { playerIcon } from './shell.js';
import { kitEditor } from './card.js';

export const KICKOFF_DEFAULTS = Object.freeze({
  drills: Object.freeze(['m3-01-u2-lcm', 'm1-06-t3-rw', 'm2-08-b6-rw']), // [D] the replay behind the wordmark: the whole team sliding with a switch of play
  holdSec: 1.2, // [D] the replay rests this long on its last frame before it starts again
  maxStepSec: 0.05, // [D] a slow frame never jumps the replay more than this
});

export const STRINGS = Object.freeze({
  wordmark: 'fotbol',
  play: 'Play',
  coachAsk: 'Coach or parent?',
  pickTitle: 'What do you play?',
  groups: ROAD_STRINGS.groups,
  kitTitle: 'Make it yours',
  skip: 'Skip',
  done: 'Done',
});

const reducedMotion = (app) => {
  if (app?.settings?.reducedMotion) return true;
  if (globalThis.document?.documentElement?.dataset?.reducedMotion === 'true') return true;
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
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
const uprightOrientation = () => ((globalThis.innerHeight ?? 0) > (globalThis.innerWidth ?? 1) ? 'vertical' : 'horizontal');

/** Start the dimmed, silent replay in `host`. @returns {() => void} stop */
function startReplay(app, host) {
  let alive = true, raf = 0, board = null;
  const onResize = () => board?.setOrientation?.(uprightOrientation());
  globalThis.addEventListener?.('resize', onResize);
  (async () => {
    const scenario = await replayScenario(app);
    if (!alive || !scenario || !app.data?.formations) return;
    try {
      board = app.createBoard(host, { orientation: uprightOrientation(), labels: 'number' });
    } catch (err) {
      console.warn('[fotbol] kickoff: no board', err);
      return;
    }
    const formations = app.data.formations;
    const { duration, freezeAt } = timing(scenario);
    const draw = (t) => board.render(frameAt(scenario, t, { formations, learnerId: null }), { learnerId: null, highlight: [BALL_ID], labels: 'number' });
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

function toCoach(app) {
  app.setSettings({ mode: 'coach' });
  app.navigate('#/coach');
}

function shirt(group) {
  const num = ROLE_INFO[DEFAULT_ROLE[group]]?.num ?? '';
  return el('span', { class: 'pm-shirt-art', 'aria-hidden': 'true' }, [
    playerIcon('shirt', { size: 72, className: 'pm-shirt-icon' }),
    el('b', { class: 'pm-shirt-num', text: String(num) }),
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
      kitEditor(app, { showLocked: false, saveLabel: STRINGS.done, onSaved: done }),
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
    front.replaceChildren(
      el('h1', { class: 'pm-wordmark', text: STRINGS.wordmark }),
      play,
      el('a', { class: 'pm-kick-coach', href: '#/coach', onclick: (e) => { e.preventDefault(); toCoach(app); } }, [STRINGS.coachAsk]),
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
