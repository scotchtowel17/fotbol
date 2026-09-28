// '#/': the Player home (docs/KID_REDESIGN.md §4.2). 25 words or fewer, one big job: Play.
//
//   the hero      a big Play button: "Next: <node> · 5 plays" → '#/play/<id>' or '#/pass/<id>' (road.js nextNode)
//   two tiles     "Who's open?" → '#/pass'; "Match day" → '#/matchday', locked until the Road says: a lock and "Finish"
//                 with the Big Match's trophy; a tap scrolls the Road to that node and makes it pulse (its title shows
//                 under it, so the words on the tile point at something you can see)
//   this week     the days played this week as dots that only fill (js/rewards.js weekDaysPlayed; R35)
//   the Road      a vertical path of node circles: an icon, 0-3 stars; the current node pulses; locked nodes are grey;
//                 the chapter you are in shows its title, the others an icon (a lock while closed) with the title for
//                 screen readers and as a tooltip, which keeps the home within 25 words however far you get
// The top bar (token, level ring, card, settings) is the shell's (js/ui/player/shell.js). Nothing else: no tabs.
//
// homeModel() and weekCount() are pure and tested (tests/player-shell.test.js). Nothing touches the DOM at import.

import { el, announce } from '../components.js';
import * as Rewards from '../../rewards.js';
import { loadRewards, onRewards, todayLocal } from '../rewards-store.js';
import { loadProfile, onProfile, loadRoad, roadModel, nextNode, nodeHref, matchdayGate, isMatchdayUnlocked, ROAD_DEFAULTS } from './road.js';
import { playerIcon } from './shell.js';
import { reducedMotion } from '../celebrate.js';

export const HOME_DEFAULTS = Object.freeze({
  weekDays: 7, // [S] §3: the days of a Monday-to-Sunday week
  zigzag: Object.freeze([0, 1, 0, -1]), // [D] the Road's sideways sway, in node steps, repeating
  pulseMs: 2400, // [D] how long the Match day gate pulses after a tap on the locked tile (3 beats)
});

export const STRINGS = Object.freeze({
  title: 'fotbol',
  play: 'Play',
  next: (title, reps) => `Next: ${title} · ${reps} plays`,
  nextSr: (title, reps) => `Play. Next: ${title}. ${reps} plays.`,
  whosOpen: "Who's open?",
  matchday: 'Match day',
  finish: (title) => `Finish ${title}`,
  finishShort: 'Finish',
  lockedTileSr: (name, hint) => `${name}. Locked. ${hint}.`,
  week: 'This week',
  weekSr: (n, max) => `Days played this week: ${n} of ${max}.`,
  road: 'Your road',
  nodeSr: (title, stars) => `${title}. ${stars} of 3 stars.`,
  nodeNextSr: (title, stars) => `${title}. Up next. ${stars} of 3 stars.`,
  lockedSr: (title) => `${title}. Locked.`,
  gateSr: (title) => `${title}. Finish it to open Match day.`,
  noRoad: 'Your road did not load.',
  tryAgain: 'Try again',
});

// ---------------------------------------------------------------- pure

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Days played this week, 0-7: js/rewards.js weekDaysPlayed when it is there, else the same count from state.days. */
export function weekCount(rewardsState, today) {
  const max = HOME_DEFAULTS.weekDays;
  try {
    if (typeof Rewards.weekDaysPlayed === 'function') {
      const v = Rewards.weekDaysPlayed(rewardsState, today);
      const n = typeof v === 'number' ? v : Array.isArray(v) ? v.filter(Boolean).length : Number(v?.count);
      if (Number.isFinite(n)) return Math.max(0, Math.min(max, Math.round(n)));
    }
  } catch { /* fall back */ }
  if (!DAY.test(String(today ?? ''))) return 0;
  const monday = (d) => {
    const [y, m, dd] = d.split('-').map(Number);
    const t = Date.UTC(y, m - 1, dd);
    return t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000;
  };
  const week = monday(today);
  const days = Object.keys(rewardsState?.days ?? {}).filter((d) => DAY.test(d) && monday(d) === week);
  return Math.min(max, days.length);
}

/**
 * What the home screen shows (pure). Only the chapter you are in shows its title (`showTitle`); the others show an icon
 * (a lock while closed) with the title for screen readers and as a tooltip, so the home stays within 25 words. The
 * node that opens Match day (the Big Match, a trophy like the other chapter matches) shows its title under it
 * (`label`), and the locked tile points at it: "Finish" and its icon (`hint` is the full "Finish Big Match" for screen
 * readers; `gate` is the node to scroll to).
 * @returns {{ next: { id, title, href, reps }|null, chapters: object[] (road.js roadModel, plus showTitle and each
 *   node's label), tiles: { pass: { href }, matchday: { href, unlocked, hint, short, gate: { id, title, icon }|null } },
 *   week: { count, max } }}
 */
export function homeModel({ road, profile, rewards, today } = {}) {
  const next = nextNode(road, profile);
  const gate = matchdayGate(road);
  return {
    next: next ? { id: next.id, title: next.title, href: nodeHref(road, next), reps: ROAD_DEFAULTS.reps } : null,
    chapters: roadModel(road, profile).map((c) => ({
      ...c, showTitle: c.current, nodes: c.nodes.map((n) => ({ ...n, label: n.id === gate?.id ? n.title : null })),
    })),
    tiles: {
      pass: { href: '#/pass' },
      matchday: {
        href: '#/matchday', unlocked: isMatchdayUnlocked(road, profile),
        hint: gate ? STRINGS.finish(gate.title) : '', short: gate ? STRINGS.finishShort : '',
        gate: gate ? { id: gate.id, title: gate.title, icon: gate.icon } : null,
      },
    },
    week: { count: weekCount(rewards, today), max: HOME_DEFAULTS.weekDays },
  };
}

/** The words the home shows (the 25-word check, tests/player-shell.test.js), the top bar aside. */
export function homeWords(m) {
  const t = m?.tiles?.matchday;
  return [
    STRINGS.play, m?.next ? STRINGS.next(m.next.title, m.next.reps) : '',
    STRINGS.whosOpen, STRINGS.matchday, t && !t.unlocked ? t.short : '',
    STRINGS.week,
    ...(m?.chapters ?? []).filter((c) => c.showTitle).map((c) => c.title),
    ...(m?.chapters ?? []).flatMap((c) => c.nodes.map((n) => n.label)),
  ].filter(Boolean);
}

// ---------------------------------------------------------------- the view (browser only)

function starsRow(n, cls = 'pm-stars') {
  return el('span', { class: cls, 'aria-hidden': 'true' }, [0, 1, 2].map((i) => playerIcon('star', { size: 14, className: i < n ? 'is-on' : 'is-off' })));
}

function hero(next) {
  if (!next) return null;
  return el('a', { class: 'pm-play', href: next.href, 'aria-label': STRINGS.nextSr(next.title, next.reps) }, [
    el('span', { class: 'pm-play-disc', 'aria-hidden': 'true' }, [playerIcon('play', { size: 34 })]),
    el('span', { class: 'pm-play-text', 'aria-hidden': 'true' }, [
      el('b', { class: 'pm-play-word', text: STRINGS.play }),
      el('span', { class: 'pm-play-next', text: STRINGS.next(next.title, next.reps) }),
    ]),
  ]);
}

function tiles(t, { onGate } = {}) {
  const m = t.matchday;
  return el('div', { class: 'pm-tiles' }, [
    el('a', { class: 'pm-tile pm-tile--pass', href: t.pass.href }, [
      el('span', { class: 'pm-tile-icon' }, [playerIcon('pass', { size: 30 })]),
      el('span', { class: 'pm-tile-name', text: STRINGS.whosOpen }),
    ]),
    m.unlocked
      ? el('a', { class: 'pm-tile pm-tile--match', href: m.href }, [
        el('span', { class: 'pm-tile-icon' }, [playerIcon('whistle', { size: 30 })]),
        el('span', { class: 'pm-tile-name', text: STRINGS.matchday }),
      ])
      // Locked: a tap shows where Match day opens (the Road scrolls to the Big Match, which pulses).
      : el('button', { type: 'button', class: 'pm-tile pm-tile--match is-locked', 'aria-label': STRINGS.lockedTileSr(STRINGS.matchday, m.hint), onclick: () => onGate?.(m.gate) }, [
        el('span', { class: 'pm-tile-icon', 'aria-hidden': 'true' }, [playerIcon('lock', { size: 26 })]),
        el('span', { class: 'pm-tile-name', 'aria-hidden': 'true', text: STRINGS.matchday }),
        m.short ? el('span', { class: 'pm-tile-hint', 'aria-hidden': 'true' }, [
          el('span', { text: m.short }), playerIcon(m.gate?.icon ?? 'trophy', { size: 22, className: 'pm-tile-gate' }),
        ]) : null,
      ]),
  ]);
}

function week(w) {
  return el('p', { class: 'pm-week' }, [
    el('span', { class: 'pm-week-label', 'aria-hidden': 'true', text: STRINGS.week }),
    el('span', { class: 'pm-dots', 'aria-hidden': 'true' }, Array.from({ length: w.max }, (_, i) => el('span', { class: ['pm-dot', i < w.count && 'is-on'] }))),
    el('span', { class: 'visually-hidden', text: STRINGS.weekSr(w.count, w.max) }),
  ]);
}

function roadView(chapters) {
  let k = 0; // the sway runs on across chapters, so the path never jumps
  const Z = HOME_DEFAULTS.zigzag;
  return el('section', { class: 'pm-road', 'aria-labelledby': 'pm-road-title' }, [
    el('h2', { id: 'pm-road-title', class: 'visually-hidden', text: STRINGS.road }),
    el('ol', { class: 'pm-chapters' }, chapters.map((c) => el('li', { class: ['pm-chapter', !c.unlocked && 'is-locked', c.showTitle && 'is-current'] }, [
      el('h3', { class: ['pm-chapter-title', !c.showTitle && 'visually-hidden'], text: c.title }),
      c.showTitle ? null : el('span', { class: 'pm-chapter-mark', title: c.title, 'aria-hidden': 'true' }, [playerIcon(c.unlocked ? c.icon : 'lock', { size: 20 })]),
      el('ol', { class: 'pm-nodes' }, c.nodes.map((n) => {
        const x = Z[k++ % Z.length];
        // A closed node shows a lock; the one that opens Match day keeps its trophy (the locked tile points at it).
        const disc = el('span', { class: 'pm-node-disc' }, [playerIcon(n.unlocked || n.label ? n.icon : 'lock', { size: 28 })]);
        const body = [disc, starsRow(n.stars, 'pm-stars pm-node-stars')];
        if (n.label) body.push(el('span', { class: 'pm-node-label', 'aria-hidden': 'true', text: n.label }));
        const cls = ['pm-node', `is-${n.kind}`, n.current && 'is-current', !n.unlocked && 'is-locked', n.stars === 3 && 'is-full', n.label && 'has-label'];
        return el('li', { class: 'pm-node-item', style: { '--x': String(x) }, dataset: { node: n.id } }, [n.unlocked
          ? el('a', { class: cls, href: n.href, title: n.title, 'aria-label': (n.current ? STRINGS.nodeNextSr : STRINGS.nodeSr)(n.title, n.stars), 'aria-current': n.current ? 'step' : null }, body)
          : el('span', { class: cls, title: n.title, role: 'img', 'aria-label': STRINGS.lockedSr(n.title) }, body)]);
      })),
    ]))),
  ]);
}

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app) {
  const road = await loadRoad(app);
  let alive = true;

  function draw() {
    if (!alive) return;
    const profile = loadProfile(app);
    if (!profile.onboarded) { app.navigate('#/kickoff'); return; }
    if (!road?.chapters?.length) {
      root.replaceChildren(el('div', { class: 'pm-home' }, [el('div', { class: 'pm-soon-in' }, [
        el('p', { text: STRINGS.noRoad }),
        el('button', { type: 'button', class: 'pm-btn pm-btn--hot', onclick: () => location.reload() }, [el('span', { text: STRINGS.tryAgain })]),
      ])]));
      return;
    }
    const m = homeModel({ road, profile, rewards: loadRewards(app), today: todayLocal() });
    root.replaceChildren(el('div', { class: 'pm-home' }, [
      el('h1', { class: 'visually-hidden', text: STRINGS.title }),
      el('div', { class: 'pm-home-main' }, [hero(m.next), tiles(m.tiles, { onGate: showGate }), week(m.week)]),
      roadView(m.chapters),
    ]));
  }

  /** The locked Match day tile: scroll the Road to the node that opens it and make it pulse (a steady ring under
   *  reduced motion); an open node takes keyboard focus. */
  let pulseTimer = 0;
  function showGate(gate) {
    const item = gate ? [...root.querySelectorAll('.pm-node-item')].find((li) => li.dataset.node === gate.id) : null;
    const node = item?.querySelector('.pm-node');
    if (!node) return;
    item.scrollIntoView({ behavior: reducedMotion(app) ? 'auto' : 'smooth', block: 'center' });
    for (const n of root.querySelectorAll('.pm-node.is-pulse')) n.classList.remove('is-pulse');
    void node.offsetWidth; // restart the animation on a second tap
    node.classList.add('is-pulse');
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => node.classList.remove('is-pulse'), HOME_DEFAULTS.pulseMs);
    if (node.matches('a')) node.focus({ preventScroll: true });
    announce(STRINGS.gateSr(gate.title));
  }

  draw();
  const offRewards = onRewards(draw);
  const offProfile = onProfile(draw);
  return () => { alive = false; clearTimeout(pulseTimer); offRewards(); offProfile(); };
}

