// Player mode: the reveal after a rep (docs/KID_REDESIGN.md §4.3 steps 6-7, §8.1). Shared by "Find your spot"
// (play.js) and "Who's open?" (pass.js). The pitch shows the answer (the caller draws the ring and the arrow);
// this panel says it in as few words as possible, in this order (R17):
//
//   ★★☆  Great                         the stars pop one after another, a tick each, all done in under 0.6 s (R29)
//   Get between your striker and our goal.     one line, 14 words or fewer, 18 px or more
//   [Why?] [Try again] [See what happens]      Try again / See what happens only when the caller offers them
//   [            Next            ]
//
// "Why?" opens a small sheet: the idea's name and one-sentence summary, up to 2 more reasons and what you did right,
// 60 words at most (whyModel). Everything is tap-paced, never on a timer (R16). Stars, never grades (R18).
// Confetti and a cheer only when the caller says the rep may celebrate (`celebrate: true`: a first try that counts,
// never a practice retry or the worked example), for the set's first such 3-star rep, and only while the set's
// big-celebration budget lasts (js/ui/celebrate.js createBurstBudget; one reveal per set, so pass reveal.budget on to
// Full time). A rep that may not celebrate never uses the set's one burst up (burstFor).
//
//   const reveal = createPlayerReveal(container, { app });
//   reveal.show({ stars, word, line, why: { title, summary, reasons, praise }, onNext, onRetry?, onReplay?, replayLabel?,
//                 celebrate? /* default false */ });
//   reveal.clear(); reveal.destroy();
//
// Extras beyond the contract (all optional): show() also takes `note` (a second short line, e.g. the once-a-set
// "Hard one. Pros miss it too.") and `nextLabel`; the instance has setBusy(bool) (buttons off while a replay runs;
// the button that had focus gets it back after) and `budget` (the set's big-celebration allowance).
//
// Nothing touches the DOM at import time (tests/copy.test.js imports STRINGS in Node).

import { el, button, svg } from '../components.js';
import { createBurstBudget, confettiBurst, playerMilestone, playerStarPlan, reducedMotion } from '../celebrate.js';
import { STRINGS as SHARED, starWord } from './strings.js';

export const REVEAL_DEFAULTS = Object.freeze({
  lineMaxWords: 14, // [S] KID_REDESIGN §0 rule 3 / R2: the reveal line
  beforeWhyMaxWords: 30, // [S] R2: everything before "Why?"
  whyMaxWords: 90, // [S] §4.3 step 7, widened 2026-10-01 (the owner: "a little more explanation"): the principle's own why line joined the sheet
  whyReasons: 2, // [S] §4.3 step 7: up to 2 more reasons
  whyPraise: 1, // [D] one thing you did right keeps the sheet short
  cheerAtMs: 120, // [D] the cheer of a first 3-star starts just after the stars begin
});

export const STRINGS = Object.freeze({
  next: SHARED.next,
  why: SHARED.why,
  tryAgain: SHARED.tryAgain,
  seeWhat: SHARED.seeWhat,
  gotIt: SHARED.gotIt,
  starWords: SHARED.starWords,
  stars: SHARED.stars,
  whyTitle: 'Why?',
  didRight: 'You got this right',
  tryThis: 'Try this',
});

const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The Why? sheet's content, cut to fit (pure): the title, the summary and the principle's own because line ("a
 * little more explanation", the owner, 2026-10-01: why the idea works, data/principles.json `why`), then up to
 * `whyReasons` reasons and `whyPraise` praise lines while the whole sheet stays within whyMaxWords (praise goes
 * first, then the last reasons; the because line is protected like the summary). Empty or repeated lines are dropped.
 * @param {{ title?: string, summary?: string, because?: string, reasons?: string[], praise?: string[] }} why
 * @returns {{ title: string, summary: string, because: string, reasons: string[], praise: string[], words: number }}
 */
export function whyModel(why = {}, P = REVEAL_DEFAULTS) {
  const title = text(why?.title);
  const summary = text(why?.summary);
  const because = text(why?.because);
  const seen = new Set([title.toLowerCase(), summary.toLowerCase(), because.toLowerCase()]);
  const pick = (list, max) => {
    const out = [];
    for (const s of Array.isArray(list) ? list : []) {
      const t = text(s);
      if (!t || seen.has(t.toLowerCase()) || out.length >= max) continue;
      seen.add(t.toLowerCase());
      out.push(t);
    }
    return out;
  };
  const reasons = pick(why?.reasons, P.whyReasons);
  const praise = pick(why?.praise, P.whyPraise);
  const count = () => words(title) + words(summary) + words(because) + reasons.reduce((a, s) => a + words(s), 0) + praise.reduce((a, s) => a + words(s), 0);
  while (count() > P.whyMaxWords && praise.length) praise.pop();
  while (count() > P.whyMaxWords && reasons.length) reasons.pop();
  return { title, summary, because, reasons, praise, words: count() };
}

/** Words a reveal shows before "Why?" is tapped (the word, the line, the note and the button labels). */
export function revealWordCount({ word, line, note, retry = false, replay = false, replayLabel } = {}) {
  const labels = [STRINGS.next, STRINGS.why, retry ? STRINGS.tryAgain : '', replay ? replayLabel ?? STRINGS.seeWhat : ''];
  return [word, line, note, ...labels].reduce((a, s) => a + words(s), 0);
}

/**
 * Does this reveal get the set's big celebration, confetti and a cheer (pure)? Only when the caller says the rep may
 * celebrate (`celebrate === true`: a counted first try, never practice or the worked example), with 3 stars, and only
 * the first time in the set (`celebrated`: an earlier rep had it). The set's budget (createBurstBudget) has the last say.
 */
export function burstFor({ stars = 0, celebrate = false, celebrated = false } = {}) {
  return celebrate === true && playerMilestone({ stars: Number(stars) || 0, firstThreeOfSet: !celebrated }) === 'three-stars';
}

const STAR_PATH = 'M12 2.8l2.75 5.9 6.45.7-4.8 4.4 1.33 6.35L12 16.9l-5.73 3.25L7.6 13.8 2.8 9.4l6.45-.7z';

/** The star row: three stars, `n` lit, each lit one popping at its moment (playerStarPlan). */
function starRow(n, animate) {
  const plan = playerStarPlan(n);
  return el('span', { class: ['pr-stars', animate && 'is-animated'], role: 'img', 'aria-label': STRINGS.stars(plan.length) },
    [0, 1, 2].map((i) => el('span', { class: ['pr-star', i < plan.length && 'is-on'], style: i < plan.length ? { '--d': `${plan[i].at}ms` } : null }, [
      svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, [svg('path', { d: STAR_PATH })]),
    ])));
}

/**
 * @param {HTMLElement} container
 * @param {{ app: object, budget?: { take(): boolean } }} opts  budget: the set's big-celebration allowance (default: one of its own)
 */
export function createPlayerReveal(container, { app, budget } = {}) {
  const P = REVEAL_DEFAULTS;
  const allowance = budget ?? createBurstBudget();
  const live = el('p', { class: 'visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const body = el('div', { class: 'pr-body' });
  const root = el('div', { class: 'pr', dataset: { state: 'empty' } }, [body, live]);
  container.append(root);

  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const stopTimers = () => { for (const t of timers) clearTimeout(t); timers.clear(); };
  let threeShown = false; // a rep that may celebrate has had its first 3 stars already (burst or no budget left)
  let buttons = [];
  let whyBtn = null;
  let current = null;
  let busyFocus = null; // the button that had focus when setBusy(true) turned the buttons off

  function say(msg) {
    live.textContent = '';
    later(() => { live.textContent = msg; }, 40);
  }

  function show({ stars = 0, word, line = '', why = null, onNext, onRetry = null, onReplay = null, replayLabel, note = '', nextLabel, celebrate = false } = {}) {
    stopTimers();
    busyFocus = null;
    root.classList.remove('is-busy');
    const n = Math.max(0, Math.min(3, Math.round(Number(stars)) || 0));
    const w = text(word) || starWord(n);
    const animate = !reducedMotion(app);
    const stars$ = starRow(n, animate);
    const next = button(nextLabel ?? STRINGS.next, { variant: 'primary', icon: 'arrow', className: 'pr-next', onClick: () => current?.onNext?.() });
    whyBtn = why ? button(STRINGS.why, { className: 'pr-why-btn', 'aria-expanded': 'false', onClick: () => openWhy() }) : null;
    const retry = onRetry ? button(STRINGS.tryAgain, { className: 'pr-retry', onClick: () => current?.onRetry?.() }) : null;
    const replay = onReplay ? button(replayLabel ?? STRINGS.seeWhat, { icon: 'play', className: 'pr-replay', onClick: () => current?.onReplay?.() }) : null;
    buttons = [whyBtn, retry, replay, next].filter(Boolean);
    current = { onNext, onRetry, onReplay, why: why ? whyModel(why, P) : null };
    body.replaceChildren(el('div', { class: 'pr-card', dataset: { stars: String(n) } }, [
      el('div', { class: 'pr-top' }, [stars$, el('p', { class: 'pr-word', text: w })]),
      line ? el('p', { class: 'pr-line', text: line }) : null,
      note ? el('p', { class: 'pr-note', text: note }) : null,
      el('div', { class: 'pr-actions' }, [
        whyBtn || retry || replay ? el('div', { class: 'pr-more' }, [whyBtn, retry, replay]) : null,
        next,
      ]),
    ]));
    root.dataset.state = 'card';
    // One tick per star as it pops (the sound follows the mute setting; the stars say the same thing on screen).
    for (const s of playerStarPlan(n)) later(() => app?.sound?.play?.('star', { index: s.index }), s.at);
    // The set's first 3 stars on a rep that may celebrate: a burst and a cheer, if the set still has its one big
    // celebration. Practice and the worked example never use it up.
    if (burstFor({ stars: n, celebrate, celebrated: threeShown })) {
      threeShown = true;
      if (allowance.take()) {
        later(() => app?.sound?.play?.('cheer'), P.cheerAtMs);
        later(() => confettiBurst(app, { anchor: stars$ }), 60);
      }
    }
    say([STRINGS.stars(n), w, line, note].filter(Boolean).join('. ').replace(/\.\./g, '.'));
    next.focus({ preventScroll: true });
  }

  function openWhy() {
    const m = current?.why;
    if (!m) return;
    const titleId = `pr-why-${Math.random().toString(36).slice(2, 7)}`;
    const close = button(STRINGS.gotIt, { variant: 'primary', className: 'pr-why-close', onClick: () => closeWhy() });
    const sheet = el('div', { class: 'pr-why', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeWhy(); } } }, [
      el('h2', { class: 'pr-why-title', id: titleId, tabindex: '-1', text: m.title || STRINGS.whyTitle }),
      m.summary ? el('p', { class: 'pr-why-summary', text: m.summary }) : null,
      m.because ? el('p', { class: 'pr-why-because', text: m.because }) : null,
      m.reasons.length ? el('ul', { class: 'pr-why-list pr-why-reasons', 'aria-label': STRINGS.tryThis }, m.reasons.map((r) => el('li', { text: r }))) : null,
      m.praise.length ? el('div', { class: 'pr-why-good' }, [
        el('p', { class: 'pr-why-kicker', text: STRINGS.didRight }),
        el('ul', { class: 'pr-why-list pr-why-praise' }, m.praise.map((r) => el('li', { text: r }))),
      ]) : null,
      el('div', { class: 'pr-why-actions' }, [close]),
    ]);
    body.querySelector('.pr-card')?.setAttribute('hidden', '');
    body.append(sheet);
    whyBtn?.setAttribute('aria-expanded', 'true');
    root.dataset.state = 'why';
    sheet.querySelector('.pr-why-title')?.focus({ preventScroll: true });
  }

  function closeWhy() {
    body.querySelector('.pr-why')?.remove();
    body.querySelector('.pr-card')?.removeAttribute('hidden');
    whyBtn?.setAttribute('aria-expanded', 'false');
    root.dataset.state = 'card';
    whyBtn?.focus({ preventScroll: true });
  }

  /**
   * Buttons off (e.g. while "See what happens" plays), then back on. A button loses keyboard focus when it is turned
   * off, so the one that had it (the one just pressed) gets it back when they come on again, unless focus has moved
   * on to something else meanwhile.
   */
  function setBusy(on) {
    const doc = root.ownerDocument;
    if (on) {
      const active = doc?.activeElement;
      busyFocus = active && buttons.includes(active) ? active : busyFocus;
    }
    for (const b of buttons) {
      if (on) b.setAttribute('disabled', ''); else b.removeAttribute('disabled');
    }
    root.classList.toggle('is-busy', !!on);
    if (on) return;
    const back = busyFocus;
    busyFocus = null;
    const active = doc?.activeElement;
    const lost = !active || active === doc.body || active === doc.documentElement || root.contains(active);
    if (back?.isConnected && lost && active !== back) back.focus({ preventScroll: true });
  }

  function clear() {
    stopTimers();
    body.replaceChildren();
    live.textContent = '';
    buttons = [];
    whyBtn = null;
    current = null;
    busyFocus = null;
    root.classList.remove('is-busy');
    root.dataset.state = 'empty';
  }

  return {
    el: root,
    show,
    clear,
    setBusy,
    get budget() { return allowance; },
    destroy() {
      clear();
      root.remove();
    },
  };
}
