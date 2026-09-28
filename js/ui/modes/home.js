// Home: what fotbol is, "pick your position", and the ways in (Learn, Explore, Drill, Live).
// The chosen role is saved in settings (app.settings.role) for every other mode to use.

import { el, svg, icon, linkButton } from '../components.js';
import { drawPitch, project } from '../board.js';
import { ROLES, ROLE_INFO, LEARNABLE_ROLES, FAMILY_LABEL } from '../../engine/roles.js';
import { LENGTH, WIDTH, MID_Y, clampToPitch } from '../../engine/pitch.js';
import { teamTargets, linearTarget } from '../../engine/formation.js';
import { MODE_INFO } from '../../main.js';

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
    lead: 'Pick a position, watch the play unfold, then drag yourself to where you should be. fotbol scores your spot and tells you the principle behind it.',
    pick: 'Pick your position',
    pickSub: 'You play one role in a 4-3-3. You can change it any time.',
  },
  kid: {
    lead: 'Pick a position, watch the game, then drag yourself to the best spot. You will see how you did and why.',
    pick: 'Pick your position',
    pickSub: 'You play one position in the team. You can change it any time.',
  },
};

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
  const items = [
    { mode: 'learn', primary: true, extra: 'Start here if you are new' },
    { mode: 'explore', extra: `Playing as ${role}` },
    { mode: 'drill', extra: `Playing as ${role}` },
    { mode: 'live', extra: `Playing as ${role}` },
  ];
  return el('ul', { class: 'modes' }, items.map(({ mode, primary, extra }) => {
    const info = MODE_INFO[mode];
    return el('li', {}, [
      el('a', { class: ['mode-card', primary && 'mode-card--primary'], href: `#/${mode}` }, [
        icon(info.icon, { size: 28 }),
        el('h3', {}, [info.title, icon('arrow', { size: 18 })]),
        el('p', { text: info.blurb }),
        el('span', { class: 'mode-extra', text: extra }),
      ]),
    ]);
  }));
}

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app) {
  const positions = picturePositions(app.data.formations);
  let pitch = null;

  function render() {
    const w = app.settings.wording;
    const copy = COPY[w];
    const chosen = el('p', { class: 'picker-chosen', 'aria-live': 'polite' });
    const setChosen = () => { chosen.textContent = `You are the ${ROLE_INFO[app.settings.role].label.toLowerCase()}.`; };
    const cardsSlot = el('div');
    const pick = (role) => {
      if (role === app.settings.role) return;
      app.setSettings({ role });
      pitch.select(role);
      const radio = root.querySelector(`input[name="home-role"][value="${role}"]`);
      if (radio && !radio.checked) radio.checked = true;
      setChosen();
      cardsSlot.replaceChildren(modeCards(app));
    };
    pitch = miniPitch(positions, app.settings.role, pick);
    setChosen();
    cardsSlot.replaceChildren(modeCards(app));

    root.replaceChildren(el('div', { class: 'home' }, [
      el('section', { class: 'hero', 'aria-labelledby': 'home-title' }, [
        el('p', { class: 'hero-kicker', text: 'Soccer positioning trainer' }),
        el('h1', { id: 'home-title', text: 'Learn where to stand.' }),
        el('p', { class: 'hero-lead', text: copy.lead }),
        el('div', { class: 'hero-cta' }, [
          linkButton('Start the tutorial', '#/learn', { variant: 'primary', icon: 'learn' }),
          linkButton('Jump into a drill', '#/drill', { icon: 'drill' }),
        ]),
      ]),
      el('section', { class: 'picker', 'aria-labelledby': 'pick-title' }, [
        el('div', { class: 'picker-head' }, [
          el('h2', { id: 'pick-title', text: copy.pick }),
          el('p', { text: copy.pickSub }),
        ]),
        el('div', { class: 'picker-pitch' }, [pitch.el]),
        el('div', { class: 'picker-groups', role: 'radiogroup', 'aria-labelledby': 'pick-title' }, rolePicker(app, pick)),
        chosen,
      ]),
      el('section', { 'aria-labelledby': 'modes-title' }, [
        el('h2', { id: 'modes-title', class: 'modes-title', text: 'Ways to play' }),
        cardsSlot,
      ]),
      el('p', { class: 'home-foot' }, [
        'No accounts and no tracking: your progress stays in this browser. ',
        el('a', { href: '#/credits', text: 'Credits and sources' }),
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
  return () => off?.();
}

