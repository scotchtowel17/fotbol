// '#/progress': your level, module and principle stars, per-role ability, recent reps, a learning
// curve, streaks, live bests, the way into the trophy room (#/trophies), and export / import / reset of
// progress (RESEARCH 7.4-7.6, 9.2 item 10). An import or a reset covers the rewards too (refreshRewards).
// Everything is read from this browser's storage (js/store.js via js/ui/session.js); nothing leaves it.

import { el, svg, button, icon, linkButton, openModal, toast, announce, uid, toggleSwitch } from '../components.js';
import { gradeColor, starRating, principleLabel } from '../reveal.js';
import { ROLE_INFO } from '../../engine/roles.js';
import { gradeOf } from '../../engine/score.js';
import * as S from '../session.js';
import { flameIcon } from './drill.js';
import { levelModel, rewardCopy } from '../celebrate.js';
import { loadRewards, refreshRewards } from '../rewards-store.js';

export const PROGRESS_DEFAULTS = Object.freeze({
  recent: 20, // [D] history rows shown
  curve: Object.freeze({ w: 100, h: 100 }), // sparkline viewBox (stretched to its box: CSS sets the size)
});

const COPY = {
  standard: {
    title: 'Your progress',
    privacy: 'Your progress stays on this device only: no account, and nothing is sent anywhere.',
    dataLead: 'Export saves everything to a file you can keep or load into another browser. Import replaces what is here.',
    youPlay: 'You play',
    change: 'Change position',
    empty: 'No reps yet. Play a drill and your stars, level and history will show up here.',
    firstDrill: 'Play your first drill',
    level: 'Skill level',
    levelOf: (n, max) => `Level ${n} of ${max}`,
    levelNext: 'Keep scoring well to reach the next level.',
    trophies: 'Trophies',
    trophyRoom: 'Trophy room',
    notStarted: 'Not started',
    reps: 'Drill reps',
    streak: 'Days this week',
    bestStreak: (n) => `Best week: ${n}`,
    liveBest: 'Live best',
    liveNone: 'Not played yet',
    playLive: 'Play Live',
    curve: 'Your last drills',
    curveLegendRep: 'Each rep',
    curveLegendAvg: 'Average of the last 5',
    curveEmpty: 'Your scores will draw a line here after a few drills.',
    curveDesc: (n, first, last) => `Scores of your last ${n} drills: the average went from ${first} to ${last}.`,
    modules: 'Modules and principles',
    modulesLead: 'Stars come from how well you do on a principle across your drills (at least 3 tries for the first star).',
    finished: 'Finished', inProgress: 'In progress',
    starsOf: (n, max) => `${n} of ${max} stars`,
    practise: 'Practise',
    learn: 'Learn',
    drill: 'Drill',
    noDrills: 'No drills yet',
    tries: (n) => `${n} ${n === 1 ? 'try' : 'tries'}`,
    roles: 'By position',
    rolesEmpty: 'Play drills to see how you do in each position.',
    roleLine: (pct, n) => `${pct}% expected on an average drill · ${n} ${n === 1 ? 'rep' : 'reps'}`,
    history: 'Recent reps',
    historyEmpty: 'Nothing here yet.',
    live: 'Live', drillMode: 'Drill', passMode: 'Passing', assisted: 'assisted',
    today: 'Today', yesterday: 'Yesterday',
    data: 'Your data',
    exportBtn: 'Export progress',
    importBtn: 'Import progress',
    resetBtn: 'Reset progress',
    exported: 'Progress exported.',
    importTitle: 'Import this progress?',
    importText: (reps, n) => `This file has ${reps} ${reps === 1 ? 'rep' : 'reps'} of history and practice on ${n} ${n === 1 ? 'principle' : 'principles'}. It replaces your stars, level, history, days played, live bests, trophies, tutorial, Explore progress and Player mode road in this browser.`,
    importKeeps: 'Your settings and any scenario you are writing in Author stay as they are.',
    importSettings: 'Also use the settings in this file',
    importSettingsHint: 'Theme, wording and your position.',
    importConfirm: 'Import',
    imported: 'Progress imported.',
    importPartial: 'Imported, but this browser could not save it, so it lasts until you close the page.',
    resetTitle: 'Reset all progress?',
    resetText: 'This deletes your stars, level, trophies, history, days played, tutorial progress and Player mode road (and position) in this browser. Your settings stay. It cannot be undone, so export first if you want a copy.',
    resetConfirm: 'Reset',
    resetDone: 'Progress reset.',
    cancel: 'Cancel',
    notSaved: 'This browser cannot save progress (private mode or blocked storage), so what you see lasts until you close the page.',
  },
  kid: {
    title: 'My progress',
    privacy: 'Your progress stays on this device. Nothing is sent anywhere.',
    dataLead: 'Save your progress to a file, or load it on another computer.',
    youPlay: 'You are',
    change: 'Change position',
    empty: 'Nothing yet! Play a drill to start collecting stars.',
    firstDrill: 'Play a drill',
    level: 'Skill level',
    levelOf: (n, max) => `Level ${n} of ${max}`,
    levelNext: 'Keep going to reach the next level!',
    trophies: 'Trophies',
    trophyRoom: 'Trophy room',
    notStarted: 'Not started',
    reps: 'Drills played',
    streak: 'Days this week',
    bestStreak: (n) => `Best week: ${n}`,
    liveBest: 'Live best',
    liveNone: 'Not played yet',
    playLive: 'Play Live',
    curve: 'Your last drills',
    curveLegendRep: 'Each go',
    curveLegendAvg: 'Average',
    curveEmpty: 'Play a few drills to see your line.',
    curveDesc: (n, first, last) => `Your last ${n} drills: your average went from ${first} to ${last}.`,
    modules: 'Ideas and stars',
    modulesLead: 'Get stars by doing well on an idea. You need 3 tries for the first star.',
    finished: 'Done!', inProgress: 'Going',
    starsOf: (n, max) => `${n} of ${max} stars`,
    practise: 'Practise',
    learn: 'Learn',
    drill: 'Drill',
    noDrills: 'No drills yet',
    tries: (n) => `${n} ${n === 1 ? 'try' : 'tries'}`,
    roles: 'By position',
    rolesEmpty: 'Play drills to see how you do in each position.',
    roleLine: (pct, n) => `${pct}% · ${n} ${n === 1 ? 'go' : 'goes'}`,
    history: 'Last goes',
    historyEmpty: 'Nothing here yet.',
    live: 'Live', drillMode: 'Drill', passMode: 'Passing', assisted: 'helper on',
    today: 'Today', yesterday: 'Yesterday',
    data: 'Save or move your progress',
    exportBtn: 'Save to a file',
    importBtn: 'Load from a file',
    resetBtn: 'Start again',
    exported: 'Saved.',
    importTitle: 'Load this progress?',
    importText: (reps, n) => `This file has ${reps} ${reps === 1 ? 'go' : 'goes'} and practice on ${n} ${n === 1 ? 'idea' : 'ideas'}. It replaces your stars, scores and trophies in this browser.`,
    importKeeps: 'Your settings stay the same.',
    importSettings: 'Also use the settings from the file',
    importSettingsHint: 'Colours, words and your position.',
    importConfirm: 'Load it',
    imported: 'Loaded!',
    importPartial: 'Loaded, but this browser cannot keep it after you close the page.',
    resetTitle: 'Start again?',
    resetText: 'This wipes your stars, level, trophies, history, tutorial and road in this browser. You cannot undo it.',
    resetConfirm: 'Start again',
    resetDone: 'All clear.',
    cancel: 'Cancel',
    notSaved: 'This browser cannot save your progress.',
  },
};

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app) {
  const store = app.store;
  const wording = () => (app.settings.wording === 'kid' ? 'kid' : 'standard');
  const C = () => COPY[wording()];
  const principles = app.data.principles?.byId ?? {};
  const index = app.data.scenarios?.index ?? [];
  // Standard wording names a principle in full; Kid wording uses its short kid name (reveal.js principleLabel).
  const pName = (id) => (wording() === 'kid' ? principleLabel(principles[id], 'kid') : principles[id]?.name ?? principles[id]?.short) || id;

  function render() {
    const c = C();
    const skills = S.loadSkills(store);
    const history = S.loadHistory(store);
    const streak = S.loadStreak(store);
    const live = S.loadLive(store);
    const role = app.settings.role;
    const today = S.dayKey(new Date());
    const level = S.levelFor(skills, wording());
    const drills = history.filter((h) => h.mode === 'drill');
    const mods = S.moduleProgress({ curriculum: app.data.curriculum, index, skills, role });
    const days = S.weekDays(streak, today); // days played this week (R35: it only fills up, and a new week starts at 0)
    const liveBest = live.best[role];
    const empty = !history.length && !skills.counts.global;
    const maxLevel = S.LEVELS.standard.length;

    const statTile = (label, value, extra, cls) => el('div', { class: ['pg-tile', cls] }, [el('p', { class: 'pg-tile-label', text: label }), el('p', { class: 'pg-tile-value' }, value), extra ? el('p', { class: 'pg-tile-extra' }, extra) : null]);

    const levelFrac = level.level ? Math.max(0.04, level.next) : 0;
    const tiles = el('div', { class: 'pg-tiles' }, [
      el('div', { class: 'pg-tile pg-tile--level' }, [
        el('p', { class: 'pg-tile-label', text: c.level }),
        el('p', { class: 'pg-tile-value' }, level.level ? [el('span', { class: 'pg-level-n', text: String(level.level) }), el('span', { class: 'pg-level-name', text: level.name })] : [el('span', { class: 'pg-level-name', text: c.notStarted })]),
        level.level ? el('div', { class: 'pg-meter', role: 'img', 'aria-label': c.levelOf(level.level, maxLevel) }, [el('span', { style: { width: `${Math.round(levelFrac * 100)}%` } })]) : null,
        level.level && level.level < maxLevel ? el('p', { class: 'pg-tile-extra', text: c.levelNext }) : null,
      ]),
      statTile(c.reps, [String(drills.length)]),
      statTile(c.streak, [flameIcon(22), String(days)], [c.bestStreak(streak.day.best)], 'pg-tile--streak'),
      statTile(c.liveBest, liveBest ? [el('span', { class: 'pg-badge', style: { '--grade': gradeColor(liveBest.grade) }, 'aria-hidden': 'true', text: liveBest.grade }), String(liveBest.score)] : [el('span', { class: 'pg-muted', text: c.liveNone })],
        [el('a', { href: liveBest?.seed ? S.liveHash(liveBest.seed, liveBest.length) : '#/live', text: c.playLive })]),
      trophiesTile(),
    ]);

    root.replaceChildren(el('div', { class: 'page pg' }, [
      el('header', { class: 'pg-head' }, [
        el('h1', { text: c.title }),
        el('p', { class: 'pg-role' }, [
          el('span', { class: 'pg-role-chip' }, [el('b', { text: ROLE_INFO[role]?.short ?? role }), `${c.youPlay}: ${ROLE_INFO[role]?.label ?? role}`]),
          el('a', { href: '#/home', text: c.change }),
        ]),
        el('p', { class: 'pg-privacy' }, [icon('check', { size: 16 }), c.privacy]),
        store.isPersistent?.() === false ? el('p', { class: 'pg-warn', text: c.notSaved }) : null,
      ]),
      empty ? el('div', { class: 'pg-empty card' }, [el('p', { text: c.empty }), linkButton(c.firstDrill, '#/drill', { variant: 'primary', icon: 'drill' })]) : null,
      tiles,
      section(c.curve, curve(history)),
      section(c.modules, [el('p', { class: 'pg-lead', text: c.modulesLead }), ...mods.map(moduleCard)]),
      section(c.roles, roles(skills)),
      section(c.history, historyList(history, today)),
      section(c.data, dataControls()),
    ]));
  }

  /** The way into the trophy room (ARCHITECTURE §5.13): your rewards level and its rank icon. */
  function trophiesTile() {
    const c = C();
    const m = levelModel(loadRewards(app));
    return el('a', { class: 'pg-tile pg-tile--trophies', href: '#/trophies' }, [
      el('p', { class: 'pg-tile-label', text: c.trophies }),
      el('p', { class: 'pg-tile-value' }, [el('span', { 'aria-hidden': 'true', text: m.icon }), rewardCopy(wording()).lv(m.level)]),
      el('p', { class: 'pg-tile-extra' }, [icon('trophy', { size: 16 }), ` ${c.trophyRoom}`]),
    ]);
  }

  function section(title, body) {
    const id = uid('pg-s');
    return el('section', { class: 'pg-section', 'aria-labelledby': id }, [el('h2', { id, text: title }), el('div', { class: 'pg-section-body' }, body)]);
  }

  // ---- learning curve: each rep as a dot, the rolling average as the line. The SVG stretches to the
  // box (preserveAspectRatio none) with non-scaling strokes; dots are zero-length round-capped strokes,
  // so they stay round; the axis labels are HTML, so they keep their size on any screen.
  function curve(history) {
    const c = C();
    const { scores, rolling } = S.learningCurve(history);
    if (scores.length < 2) return [el('p', { class: 'pg-muted', text: c.curveEmpty })];
    const { w, h } = PROGRESS_DEFAULTS.curve;
    const X = (i) => (w * i) / Math.max(1, scores.length - 1);
    const Y = (v) => (h * (100 - v)) / 100;
    const last = Math.round(rolling[rolling.length - 1]);
    const titleId = uid('pg-curve');
    const node = svg('svg', { class: 'pg-curve', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', role: 'img', 'aria-labelledby': titleId }, [
      svg('title', { id: titleId, text: c.curveDesc(scores.length, Math.round(rolling[0]), last) }),
      ...[50, 70, 90].map((v) => svg('line', { class: 'pg-grid', x1: 0, x2: w, y1: Y(v), y2: Y(v) })),
      svg('line', { class: 'pg-base', x1: 0, x2: w, y1: h, y2: h }),
      ...scores.map((v, i) => svg('path', { class: 'pg-dot', d: `M${X(i).toFixed(2)} ${Y(v).toFixed(2)}h0` })),
      svg('path', { class: 'pg-line', d: rolling.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(2)} ${Y(v).toFixed(2)}`).join('') }),
      svg('path', { class: 'pg-end', d: `M${X(rolling.length - 1).toFixed(2)} ${Y(last).toFixed(2)}h0` }),
    ]);
    const tick = (v) => el('span', { class: 'pg-tick', style: { top: `${100 - v}%` }, text: String(v) });
    return [
      el('div', { class: 'pg-curve-wrap' }, [
        el('div', { class: 'pg-ticks', 'aria-hidden': 'true' }, [tick(90), tick(70), tick(50), tick(0)]),
        el('div', { class: 'pg-curve-box' }, [node, el('span', { class: 'pg-curve-end', 'aria-hidden': 'true', style: { top: `${100 - last}%` }, text: String(last) })]),
      ]),
      el('p', { class: 'pg-legend' }, [
        el('span', { class: 'pg-key pg-key--dot', 'aria-hidden': 'true' }), c.curveLegendRep,
        el('span', { class: 'pg-key pg-key--line', 'aria-hidden': 'true' }), c.curveLegendAvg,
      ]),
    ];
  }

  // ---- modules and principles
  function moduleCard(m) {
    const c = C();
    const status = m.finished ? c.finished : m.started ? c.inProgress : c.notStarted;
    return el('article', { class: ['pg-module', m.finished && 'is-finished'] }, [
      el('header', { class: 'pg-module-head' }, [
        el('div', {}, [
          el('h3', {}, [el('b', { text: m.id }), ` ${m.title}`]),
          m.subtitle ? el('p', { class: 'pg-muted', text: m.subtitle }) : null,
        ]),
        el('span', { class: ['pg-status', m.finished && 'is-finished'], text: status }),
      ]),
      el('div', { class: 'pg-module-bar', role: 'img', 'aria-label': c.starsOf(m.stars, m.maxStars) }, [el('span', { style: { width: `${m.maxStars ? Math.round((100 * m.stars) / m.maxStars) : 0}%` } })]),
      el('ul', { class: 'pg-principles' }, m.principles.map((p) => el('li', {}, [
        el('span', { class: 'pg-p-name' }, [el('b', { text: p.id }), ` ${pName(p.id)}`]),
        el('span', { class: 'pg-p-meta' }, [
          starRating(p.stars, { label: c.starsOf(p.stars, 3) }),
          p.attempts ? el('span', { class: 'pg-muted', text: c.tries(p.attempts) }) : null,
        ]),
        el('span', { class: 'pg-p-links' }, [
          el('a', { href: `#/learn/p/${encodeURIComponent(p.id)}`, 'aria-label': `${c.learn}: ${pName(p.id)}`, text: c.learn }),
          p.hasDrills ? el('a', { href: `#/drill/p/${encodeURIComponent(p.id)}`, 'aria-label': `${c.drill}: ${pName(p.id)}`, text: c.drill }) : el('span', { class: 'pg-muted', text: c.noDrills }),
        ]),
      ]))),
      m.playable || m.principles.some((p) => p.hasDrills) ? el('div', { class: 'pg-module-cta' }, [linkButton(`${c.practise} ${m.id}`, `#/drill/${m.id}`, { icon: 'drill' })]) : null,
    ]);
  }

  function roles(skills) {
    const c = C();
    const list = S.roleAbilities(skills);
    if (!list.length) return [el('p', { class: 'pg-muted', text: c.rolesEmpty })];
    return [el('ul', { class: 'pg-roles' }, list.map((r) => {
      const pct = Math.round(r.p * 100);
      return el('li', {}, [
        el('span', { class: 'pg-role-name' }, [el('b', { text: ROLE_INFO[r.role]?.short ?? r.role }), ROLE_INFO[r.role]?.label ?? r.role]),
        el('span', { class: 'pg-role-bar', 'aria-hidden': 'true' }, [el('span', { style: { width: `${pct}%` } })]),
        el('span', { class: 'pg-muted pg-role-line', text: c.roleLine(pct, r.attempts) }),
      ]);
    }))];
  }

  function when(t, today) {
    const c = C();
    const d = new Date(t);
    if (!Number.isFinite(d.getTime())) return '';
    const key = S.dayKey(d);
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const gap = S.dayDiff(key, today);
    if (gap === 0) return `${c.today} ${time}`;
    if (gap === 1) return `${c.yesterday} ${time}`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function historyList(history, today) {
    const c = C();
    const rows = history.slice(-PROGRESS_DEFAULTS.recent).reverse();
    if (!rows.length) return [el('p', { class: 'pg-muted', text: c.historyEmpty })];
    return [el('ol', { class: 'pg-history' }, rows.map((h) => {
      const grade = h.grade ?? gradeOf(h.score);
      const kind = h.mode === 'live' ? c.live : h.mode === 'pass' ? c.passMode : c.drillMode; // Player mode's "Who's open?" reps are passing
      const title = h.mode === 'live' ? `${c.live}${h.assisted ? ` (${c.assisted})` : ''}` : h.title ?? h.id ?? kind;
      // A generated drill (Player mode: baseId 'gen-...', every pass rep) has no page to go back to.
      const authored = h.mode === 'drill' && h.baseId && !/^gen-/.test(h.baseId);
      const href = h.mode === 'live' && h.seed ? S.liveHash(h.seed, h.length) : authored ? `#/drill/s/${encodeURIComponent(h.baseId)}` : null;
      return el('li', {}, [
        el('span', { class: 'pg-badge', style: { '--grade': gradeColor(grade) }, 'aria-hidden': 'true', text: grade }),
        el('span', { class: 'pg-h-main' }, [
          href ? el('a', { href, text: title }) : el('span', { text: title }),
          el('span', { class: 'pg-muted pg-h-meta', text: [kind, ROLE_INFO[h.role]?.label, when(h.t, today)].filter(Boolean).join(' · ') }),
        ]),
        el('span', { class: 'pg-h-score' }, [el('span', { class: 'visually-hidden', text: `Grade ${grade}, ` }), String(h.score)]),
      ]);
    }))];
  }

  // ---- export / import / reset
  function dataControls() {
    const c = C();
    const fileId = uid('pg-file');
    const input = el('input', { id: fileId, type: 'file', accept: 'application/json,.json', class: 'visually-hidden', tabindex: '-1', onchange: (e) => onFile(e.target) });
    return [
      el('p', { class: 'pg-muted', text: c.dataLead }),
      el('div', { class: 'pg-data' }, [
        button(c.exportBtn, { icon: 'arrow', onClick: exportProgress }),
        button(c.importBtn, { onClick: () => input.click() }),
        input,
        button(c.resetBtn, { variant: 'ghost', className: 'pg-reset', onClick: confirmReset }),
      ]),
    ];
  }

  function exportProgress() {
    const c = C();
    const day = S.dayKey(new Date());
    const payload = { app: 'fotbol', version: 1, exported: new Date().toISOString(), data: store.exportAll() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: S.exportFileName(day), hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(c.exported, { tone: 'good' });
  }

  async function onFile(input) {
    const c = C();
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let text = '';
    try { text = await file.text(); } catch { text = ''; }
    const parsed = S.parseProgressFile(text);
    if (!parsed.ok) { toast(parsed.error, { tone: 'bad', timeout: 6000 }); return; }
    if (!alive) return;
    // Only the progress keys are imported (session.js IMPORT_KEYS); the file's settings only if you opt in.
    let useSettings = false;
    showModal({
      title: c.importTitle,
      content: [
        el('p', { text: c.importText(parsed.summary.reps, parsed.summary.principles) }),
        el('p', { class: 'pg-muted', text: c.importKeeps }),
        parsed.settings ? toggleSwitch({ label: c.importSettings, hint: c.importSettingsHint, checked: false, onChange: (on) => { useSettings = on; } }) : null,
      ],
      actions: (close) => [
        button(c.cancel, { variant: 'ghost', onClick: () => close('cancel') }),
        button(c.importConfirm, { variant: 'primary', onClick: () => {
          close('ok');
          if (!alive) return;
          for (const k of S.IMPORT_KEYS) store.remove(k);
          const r = store.importAll(parsed.data);
          refreshRewards(app); // the imported kit and level show at once (the header pill, the boards)
          if (useSettings && parsed.settings) app.setSettings(parsed.settings);
          toast(r.persisted ? c.imported : c.importPartial, { tone: r.persisted ? 'good' : 'info', timeout: 5000 });
          render();
          announce(c.imported);
        } }),
      ],
    });
  }

  // The confirm dialogs belong to this page: leaving it (Back, a link) closes them, so a Reset or an Import can
  // never be confirmed over another page (components.js openModal also closes on any route change).
  let modal = null;
  function showModal(opts) {
    modal?.close('replaced');
    modal = openModal({ ...opts, onClose: (v) => { modal = null; opts.onClose?.(v); } });
    return modal;
  }

  function confirmReset() {
    const c = C();
    showModal({
      title: c.resetTitle,
      content: el('p', { text: c.resetText }),
      actions: (close) => [
        button(c.cancel, { variant: 'ghost', onClick: () => close('cancel') }),
        button(c.resetConfirm, { variant: 'primary', className: 'pg-reset-confirm', onClick: () => {
          close('ok');
          if (!alive) return;
          for (const k of S.RESET_KEYS) store.remove(k);
          refreshRewards(app); // back to the classic kit and level 1
          toast(c.resetDone, { tone: 'info' });
          render();
          announce(c.resetDone);
        } }),
      ],
    });
  }

  let alive = true;
  render();
  const off = app.onSettings?.((_s, patch) => { if ('wording' in (patch ?? {}) || 'role' in (patch ?? {})) render(); });
  return () => {
    alive = false;
    off?.();
    modal?.close('route');
  };
}
