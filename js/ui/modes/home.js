// Home: what fotbol is, your player card (kit, level, stars: js/ui/celebrate.js), "pick your position",
// your path through the modules, and the ways in (Learn, Explore, Drill, Live). The chosen role is saved in
// settings (app.settings.role) for every other mode to use. In Coach mode (the full app, for coaches and parents)
// a short note on top says what Coach mode is and that playing here never changes the player's card: rewards are
// earned in Player mode only (js/ui/rewards-store.js award).
//
// Module cards (M0-M3, data/curriculum.json) read progress only: the tutorial from the store key
// 'tutorial' (learn.js) and mastery stars from 'skills' (elo.mastery). A module is finished when the
// tutorial is complete (M0) or every one of its principles has at least moduleUnlockStars stars; a
// module whose `unlock` module is not finished shows as locked but still opens, with a gentle
// "we recommend finishing X first".

import { el, svg, icon, linkButton } from '../components.js';
import { drawPitch, project } from '../board.js';
import { ROLES, ROLE_INFO, LEARNABLE_ROLES, FAMILY_LABEL } from '../../engine/roles.js';
import { LENGTH, WIDTH, MID_Y, clampToPitch } from '../../engine/pitch.js';
import { teamTargets, linearTarget } from '../../engine/formation.js';
import { MODE_INFO } from '../../main.js';
import { mastery } from '../../engine/elo.js';
import { normalizeTutorialProgress, TUTORIAL_KEY } from './learn.js';
import { playerCard } from '../celebrate.js';
import { loadRewards, onRewards } from '../rewards-store.js';

export const HOME_DEFAULTS = Object.freeze({
  pictureBall: { x: 52.5, y: MID_Y }, // [D] ball at kick-off for the formation picture
  pictureDepth: 74, // [D] metres of pitch shown from our goal line up
  pictureMargin: 2, // [D] metres around the picture
});

const FAMILY_ORDER = ['CB', 'FB', 'DM', 'CM', 'W', 'ST'];

// One line per family on what the job is (our own wording).
const FAMILY_JOB = {
  standard: {
    CB: 'Protect the middle, hold the line with your partner and cover when they step out.',
    FB: 'Guard your flank, tuck in when the ball is far away, give width when we have it.',
    DM: 'Screen the back four, stay between the ball and our goal, be the safe pass.',
    CM: 'Link defence and attack: support the ball, then press and cover in midfield.',
    W: 'Stretch the pitch, pin their full-back and lead the press on their back line.',
    ST: 'Lead the line: pin their centre-backs, stay onside and start the press.',
  },
  kid: {
    CB: 'Stay in the middle in front of our goal and help your partner.',
    FB: 'Guard your side. Come in closer when the ball is far away.',
    DM: 'Stand in front of our defenders and always be open for a pass.',
    CM: 'Help in the middle: get open for passes, then chase and cover.',
    W: 'Stay wide near the sideline and run at their defenders.',
    ST: 'Be our furthest player forward, level with their last defender.',
  },
};

const COPY = {
  standard: {
    kicker: 'Soccer positioning trainer',
    title: 'Learn where to stand.',
    lead: 'Pick a position, watch the play unfold, then drag yourself to where you should be. fotbol scores your spot and tells you the principle behind it.',
    pick: 'Pick your position',
    pickSub: 'You play one role in a 4-3-3. You can change it any time.',
    chosen: (label) => `You are the ${label}.`,
    jump: 'Jump into a drill',
    ways: 'Ways to play',
    newHere: 'Start here if you are new',
    playingAs: (role) => `Playing as ${role}`,
    blurbs: {},
    foot: 'No accounts and no tracking: your progress stays in this browser. ',
    credits: 'Credits and sources',
    coachNote: 'Coach mode is for coaches and parents: every drill, with scores and the full reasons.',
    coachNote2: 'Nothing played here changes the player\'s card: stars, stickers and levels are earned in Player mode.',
  },
  kid: {
    kicker: 'Learn to play football',
    title: 'Find your best spot.',
    lead: 'Pick a position, watch the game, then drag yourself to the best spot. You will see how you did and why.',
    pick: 'Pick your position',
    pickSub: 'You play one position in the team. You can change it any time.',
    chosen: (label) => `You are the ${label}.`,
    jump: 'Play a drill',
    ways: 'Ways to play',
    newHere: 'New? Start here',
    playingAs: (role) => `You are the ${role}`,
    blurbs: {
      learn: 'A quick tour of the pitch and the big ideas.',
      explore: 'Move the ball and see where you should stand.',
      drill: 'Watch, the game stops, you find your spot.',
      live: 'The game keeps going. Keep finding your spot!',
    },
    foot: 'No accounts. Your progress stays on this device. ',
    credits: 'Who made this',
    coachNote: 'This is Coach mode, for coaches and parents.',
    coachNote2: 'Playing here does not change the player card. Stars and stickers come from Player mode.',
  },
};

const PATH_COPY = {
  standard: {
    title: 'Your path',
    sub: 'Four modules, from reading the pitch to moving as one team. Each one builds on the last.',
    module: (id) => `Module ${String(id).replace(/^M/, '')}`,
    done: 'Done', next: 'Up next', open: 'In progress', ready: 'Ready',
    locked: (title) => `We recommend finishing “${title}” first.`,
    steps: (d, n) => `${d} of ${n} steps`,
    principles: (n) => `${n} principles`,
    stars: (s, max) => `${s} of ${max} stars`,
    start: 'Start the tutorial',
    resumeTutorial: (n) => `Continue the tutorial (step ${n})`,
    cont: (m) => `Continue: ${m.title}`,
    allDone: 'Keep practising',
    explore: 'Explore the pitch',
    learnTitle: 'Learn more',
    library: 'Principle library',
    libraryText: 'Every idea fotbol teaches, with the why, a rule of thumb and the common mistake.',
    reading: 'Reading list',
    readingText: 'Hand-picked books, sites and videos, from beginner to advanced.',
  },
  kid: {
    title: 'Your path',
    sub: 'Four steps, from knowing the pitch to moving as a team.',
    module: (id) => `Module ${String(id).replace(/^M/, '')}`,
    done: 'Done', next: 'Up next', open: 'Started', ready: 'Ready',
    locked: (title) => `Try “${title}” first.`,
    steps: (d, n) => `${d} of ${n} steps`,
    principles: (n) => `${n} ideas`,
    stars: (s, max) => `${s} of ${max} stars`,
    start: 'Start the tutorial',
    resumeTutorial: (n) => `Keep going (step ${n})`,
    cont: (m) => `Keep going: ${m.title}`,
    allDone: 'Keep playing',
    explore: 'Explore the pitch',
    learnTitle: 'Learn more',
    library: 'Ideas library',
    libraryText: 'All the ideas in fotbol, explained.',
    reading: 'Reading list',
    readingText: 'Books, websites and videos to learn more.',
  },
};

/** Where a module card leads: the tutorial for M0, else its drills. */
export const moduleHref = (m) => (m?.kind === 'tutorial' ? '#/learn' : `#/drill/${m?.id ?? ''}`);

/**
 * Progress for every module (pure).
 * @param {object} curriculum  data/curriculum.json
 * @param {{ skills?: object|null, tutorial?: object|null, tutorialSteps?: number, index?: object[]|null }} progress
 *   skills: the store's 'skills' (createSkills() shape); tutorial: normalizeTutorialProgress() output;
 *   index: the scenario index, when given a principle no drill of the module teaches does not hold the
 *   module back (the same rule as session.js moduleProgress)
 * @returns {{ id, kind, title, subtitle, description, principles: string[], stars: number, maxStars: number,
 *   stepsDone: number, steps: number, started: boolean, finished: boolean, unlocked: boolean, recommend: object|null }[]}
 *   recommend: the module to finish first (when locked)
 */
export function moduleStatuses(curriculum, { skills = null, tutorial = null, tutorialSteps = 0, index = null } = {}) {
  const modules = curriculum?.modules ?? [];
  const need = Number.isFinite(curriculum?.moduleUnlockStars) ? curriculum.moduleUnlockStars : 1;
  const starsOf = (id) => {
    if (!skills) return 0;
    try { return mastery(skills, id); } catch { return 0; }
  };
  const base = modules.map((m) => {
    const principles = m.principles ?? [];
    const each = principles.map(starsOf);
    const stars = each.reduce((a, b) => a + b, 0);
    const tut = m.kind === 'tutorial';
    const stepsDone = tut ? tutorial?.done?.length ?? 0 : 0;
    const taught = Array.isArray(index) ? principles.map((id) => index.some((e) => e?.module === m.id && e.principles?.includes(id))) : principles.map(() => true);
    const finished = tut ? !!tutorial?.completed : taught.some(Boolean) && each.every((n, i) => !taught[i] || n >= need);
    return {
      id: m.id, kind: m.kind, title: m.title, subtitle: m.subtitle, description: m.description, principles,
      stars, maxStars: principles.length * 3, stepsDone, steps: tut ? tutorialSteps : 0,
      started: tut ? stepsDone > 0 : stars > 0, finished, unlock: m.unlock ?? null,
    };
  });
  const byId = new Map(base.map((m) => [m.id, m]));
  return base.map(({ unlock, ...m }) => {
    const pre = unlock ? byId.get(unlock) : null;
    const unlocked = !pre || pre.finished;
    return { ...m, unlocked, recommend: unlocked ? null : { id: pre.id, title: pre.title } };
  });
}

/** The module to continue with: the first one not finished (null when all are). */
export const continueModule = (statuses) => (statuses ?? []).find((m) => !m.finished) ?? null;

const LOCK_SVG = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
function lockIcon() {
  const s = svg('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false', class: 'icon' });
  s.innerHTML = LOCK_SVG;
  return s;
}
function starIcon() {
  const s = svg('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false', class: 'hm-star' });
  s.innerHTML = '<path d="M12 2.8l2.75 5.9 6.45.7-4.8 4.4 1.33 6.35L12 16.9l-5.73 3.25L7.6 13.8 2.8 9.4l6.45-.7z"/>';
  return s;
}

function readProgress(app) {
  const steps = app.data.tutorial?.steps ?? [];
  const tutorial = normalizeTutorialProgress(app.store.get(TUTORIAL_KEY), steps);
  const statuses = moduleStatuses(app.data.curriculum, { skills: app.store.get('skills', null), tutorial, tutorialSteps: steps.length, index: app.data.scenarios?.index ?? null });
  return { tutorial, statuses };
}

/** The hero's main button: start or continue the tutorial, else the next unfinished module. */
function continueCta(app, { tutorial, statuses }) {
  const C = PATH_COPY[app.settings.wording === 'kid' ? 'kid' : 'standard'];
  const next = continueModule(statuses);
  if (!statuses.length || next?.kind === 'tutorial') {
    const started = tutorial.done.length > 0;
    return linkButton(started ? C.resumeTutorial(tutorial.step + 1) : C.start, '#/learn', { variant: 'primary', icon: 'learn' });
  }
  if (!next) return linkButton(C.allDone, '#/drill', { variant: 'primary', icon: 'drill' });
  return linkButton(C.cont(next), moduleHref(next), { variant: 'primary', icon: 'arrow' });
}

function moduleCards(app, { statuses }) {
  const w = app.settings.wording === 'kid' ? 'kid' : 'standard';
  const C = PATH_COPY[w];
  const next = continueModule(statuses);
  return el('ol', { class: 'hm-modules' }, statuses.map((m) => {
    const isNext = m === next && m.unlocked;
    const state = m.finished ? 'done' : !m.unlocked ? 'locked' : isNext ? 'next' : m.started ? 'open' : 'ready';
    const label = { done: C.done, next: C.next, open: C.open, ready: C.ready, locked: null }[state];
    const tut = m.kind === 'tutorial';
    const frac = tut ? (m.steps ? m.stepsDone / m.steps : 0) : (m.maxStars ? m.stars / m.maxStars : 0);
    return el('li', {}, [el('a', { class: ['hm-card', `is-${state}`], href: moduleHref(m) }, [
      el('span', { class: 'hm-card-top' }, [
        el('span', { class: 'hm-num', text: C.module(m.id) }),
        state === 'locked'
          ? el('span', { class: 'hm-status hm-status--locked' }, [lockIcon()])
          : el('span', { class: `hm-status hm-status--${state}` }, [state === 'done' ? icon('check', { size: 14 }) : null, label]),
      ]),
      el('span', { class: 'hm-title', text: m.title }),
      el('span', { class: 'hm-sub', text: m.subtitle }),
      el('span', { class: 'hm-desc', text: m.description?.[w] ?? m.description?.standard ?? '' }),
      el('span', { class: 'hm-foot' }, [
        el('span', { class: 'hm-meta' }, tut
          ? [el('span', { text: C.steps(m.stepsDone, m.steps) })]
          : [el('span', { text: C.principles(m.principles.length) }), el('span', { class: 'hm-stars' }, [starIcon(), C.stars(m.stars, m.maxStars)])]),
        el('span', { class: 'hm-bar', 'aria-hidden': 'true' }, [el('span', { style: { width: `${Math.round(Math.min(1, frac) * 100)}%` } })]),
      ]),
      state === 'locked' ? el('span', { class: 'hm-lock' }, [C.locked(m.recommend.title)]) : null,
    ])]);
  }));
}

function learnLinks(app) {
  const C = PATH_COPY[app.settings.wording === 'kid' ? 'kid' : 'standard'];
  const item = (href, title, text, iconName) => el('li', {}, [el('a', { class: 'hm-link', href }, [
    icon(iconName, { size: 22 }), el('span', {}, [el('strong', { text: title }), el('span', { text })]), icon('arrow', { size: 18, className: 'hm-link-arrow' }),
  ])]);
  return el('ul', { class: 'hm-links' }, [
    item('#/learn/principles', C.library, C.libraryText, 'learn'),
    item('#/learn/resources', C.reading, C.readingText, 'progress'),
  ]);
}

/** Our 11 at a kick-off-like ball position (formation engine if loaded, else the linear fallback). */
export function picturePositions(formations, ball = HOME_DEFAULTS.pictureBall) {
  try {
    if (formations?.us) return teamTargets(formations.us, 'us', ball, { offset: false });
  } catch (err) {
    console.warn('[fotbol] formation picture fell back to linear targets', err);
  }
  return Object.fromEntries(ROLES.map((r) => [r, clampToPitch(linearTarget(r, ball))]));
}

function miniPitch(positions, selected, onPick) {
  const H = HOME_DEFAULTS;
  const m = H.pictureMargin;
  // Vertical view (our goal at the bottom) cropped to the part of the pitch we occupy.
  const top = LENGTH - H.pictureDepth;
  const root = svg('svg', { viewBox: `${-m} ${top - m} ${WIDTH + 2 * m} ${H.pictureDepth + 2 * m}`, 'aria-hidden': 'true', focusable: 'false' });
  const world = svg('g', { transform: `matrix(0 -1 1 0 0 ${LENGTH})` });
  root.append(world);
  drawPitch(world, { margin: 8, stripes: 14 });
  const tokens = svg('g', { class: 'board-tokens' });
  root.append(tokens);

  const byRole = new Map();
  for (const role of ROLES) {
    const p = positions[role];
    if (!p) continue;
    const v = project(p, 'vertical');
    const info = ROLE_INFO[role];
    const learnable = LEARNABLE_ROLES.includes(role);
    const g = svg('g', {
      class: ['token', 'team-us', !learnable && 'is-disabled'],
      style: `transform: translate(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px)`,
      onclick: learnable ? () => onPick(role) : null,
    }, [
      svg('circle', { class: 'token-glow', r: 4.3 }),
      svg('circle', { class: 'token-ring', r: 3.6 }),
      svg('circle', { class: 'token-body', r: 2.8 }),
      svg('text', { class: 'token-code', 'text-anchor': 'middle', dy: '0.36em', style: `font-size:${info.short.length > 2 ? 1.6 : 2}px` }, [info.short]),
      svg('g', { class: 'token-you', transform: 'translate(0 -5.2)' }, [
        svg('rect', { x: -3, y: -1.4, width: 6, height: 2.8, rx: 1.4 }),
        svg('text', { 'text-anchor': 'middle', dy: '0.36em', style: 'font-size:1.6px' }, ['YOU']),
      ]),
    ]);
    if (!learnable) g.append(svg('title', {}, [`${info.label} (coming later)`]));
    tokens.append(g);
    byRole.set(role, g);
  }
  const select = (role) => {
    for (const [r, g] of byRole) g.classList.toggle('is-learner', r === role);
    const g = byRole.get(role);
    if (g) tokens.append(g); // selected token on top
  };
  select(selected);
  return { el: root, select };
}

function rolePicker(app, onChange) {
  const wording = app.settings.wording;
  const groups = FAMILY_ORDER.map((fam) => {
    const roles = LEARNABLE_ROLES.filter((r) => ROLE_INFO[r].family === fam)
      .sort((a, b) => (ROLE_INFO[a].side === 'L' ? -1 : 1) - (ROLE_INFO[b].side === 'L' ? -1 : 1));
    const headId = `fam-${fam}`;
    return el('div', { class: 'picker-family', role: 'group', 'aria-labelledby': headId }, [
      el('h3', { id: headId, text: FAMILY_LABEL[fam] }),
      el('p', { class: 'picker-family-desc', text: FAMILY_JOB[wording][fam] }),
      el('div', { class: 'role-options' }, roles.map((r) =>
        el('label', { class: 'role-option' }, [
          el('input', { type: 'radio', name: 'home-role', value: r, checked: r === app.settings.role, onchange: (e) => e.target.checked && onChange(r) }),
          el('span', {}, [el('b', { 'aria-hidden': 'true', text: ROLE_INFO[r].short }), ROLE_INFO[r].label]),
        ]))),
    ]);
  });
  return groups;
}

function modeCards(app) {
  const role = (ROLE_INFO[app.settings.role]?.label ?? '').toLowerCase();
  const copy = COPY[app.settings.wording === 'kid' ? 'kid' : 'standard'];
  const items = [
    { mode: 'learn', primary: true, extra: copy.newHere },
    { mode: 'explore', extra: copy.playingAs(role) },
    { mode: 'drill', extra: copy.playingAs(role) },
    { mode: 'live', extra: copy.playingAs(role) },
  ];
  return el('ul', { class: 'modes' }, items.map(({ mode, primary, extra }) => {
    const info = MODE_INFO[mode];
    return el('li', {}, [
      el('a', { class: ['mode-card', primary && 'mode-card--primary'], href: `#/${mode}` }, [
        icon(info.icon, { size: 28 }),
        el('h3', {}, [info.title, icon('arrow', { size: 18 })]),
        el('p', { text: copy.blurbs[mode] ?? info.blurb }),
        el('span', { class: 'mode-extra', text: extra }),
      ]),
    ]);
  }));
}

/** The note on top of the Coach home (Coach mode only): what it is, and that the player's card is not changed here. */
function coachNote(copy) {
  return el('p', { class: 'coach-note', role: 'note' }, [el('strong', { text: copy.coachNote }), ' ', copy.coachNote2]);
}

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app) {
  const positions = picturePositions(app.data.formations);
  let pitch = null;
  // The player card (ARCHITECTURE §5.13): your kit, level and stars, and the way into the trophy room.
  const cardSlot = el('div', { class: 'hm-player' });
  const drawCard = () => cardSlot.replaceChildren(playerCard(app, loadRewards(app)));

  function render() {
    const w = app.settings.wording;
    const copy = COPY[w];
    const chosen = el('p', { class: 'picker-chosen', 'aria-live': 'polite' });
    const setChosen = () => { chosen.textContent = copy.chosen(ROLE_INFO[app.settings.role].label.toLowerCase()); };
    const cardsSlot = el('div');
    const pick = (role) => {
      if (role === app.settings.role) return;
      app.setSettings({ role });
      pitch.select(role);
      const radio = root.querySelector(`input[name="home-role"][value="${role}"]`);
      if (radio && !radio.checked) radio.checked = true;
      setChosen();
      cardsSlot.replaceChildren(modeCards(app));
      drawCard(); // the shirt number follows the position (unless the kit sets one)
    };
    pitch = miniPitch(positions, app.settings.role, pick);
    setChosen();
    cardsSlot.replaceChildren(modeCards(app));
    drawCard();
    const progress = readProgress(app);
    const P = PATH_COPY[w === 'kid' ? 'kid' : 'standard'];

    root.replaceChildren(el('div', { class: 'home' }, [
      app.settings.mode === 'coach' ? coachNote(copy) : null,
      el('section', { class: 'hero', 'aria-labelledby': 'home-title' }, [
        el('p', { class: 'hero-kicker', text: copy.kicker }),
        el('h1', { id: 'home-title', text: copy.title }),
        el('p', { class: 'hero-lead', text: copy.lead }),
        el('div', { class: 'hero-cta' }, [
          continueCta(app, progress),
          progress.tutorial.completed
            ? linkButton(copy.jump, '#/drill', { icon: 'drill' })
            : linkButton(P.explore, '#/explore', { icon: 'explore' }),
        ]),
      ]),
      cardSlot,
      el('section', { class: 'picker', 'aria-labelledby': 'pick-title' }, [
        el('div', { class: 'picker-head' }, [
          el('h2', { id: 'pick-title', text: copy.pick }),
          el('p', { text: copy.pickSub }),
        ]),
        el('div', { class: 'picker-pitch' }, [pitch.el]),
        el('div', { class: 'picker-groups', role: 'radiogroup', 'aria-labelledby': 'pick-title' }, rolePicker(app, pick)),
        chosen,
      ]),
      progress.statuses.length ? el('section', { class: 'hm-path', 'aria-labelledby': 'path-title' }, [
        el('div', { class: 'hm-path-head' }, [
          el('h2', { id: 'path-title', class: 'modes-title', text: P.title }),
          el('p', { text: P.sub }),
        ]),
        moduleCards(app, progress),
      ]) : null,
      el('section', { 'aria-labelledby': 'modes-title' }, [
        el('h2', { id: 'modes-title', class: 'modes-title', text: copy.ways }),
        cardsSlot,
      ]),
      el('section', { class: 'hm-learn', 'aria-labelledby': 'learn-more-title' }, [
        el('h2', { id: 'learn-more-title', class: 'modes-title', text: P.learnTitle }),
        learnLinks(app),
      ]),
      el('p', { class: 'home-foot' }, [
        copy.foot,
        el('a', { href: '#/credits', text: copy.credits }),
        '.',
      ]),
    ]));
  }

  render();
  // Wording changes the copy; re-render in place (settings changes from this page skip it).
  let lastWording = app.settings.wording;
  const off = app.onSettings?.((s) => {
    if (s.wording !== lastWording) { lastWording = s.wording; render(); }
  });
  const offRewards = onRewards(drawCard);
  return () => { off?.(); offRewards(); };
}

