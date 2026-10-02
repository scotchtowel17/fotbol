// The shared feedback panel: a live hot/cold readout while you drag, then the two-beat reveal
// (RESEARCH 7.1 rows 5-6, 7.2 step 8, 9.2 item 5): beat 1 asks a cue question, beat 2 shows the
// score, the grade, the principle behind it and the fix. Used by Explore, Drill and Live.
//
//   const panel = createFeedbackPanel(container, { app });
//   panel.showLive(judgement);                              // every drag move (cheap: updates text only)
//   panel.showCue(judgement, { onReveal });                 // beat 1: the cue question + "Show me"
//   panel.showFull(judgement, { onNext, onReplay, takeaway, misconception, principleLinks = true });   // beat 2
//   panel.clear(); panel.destroy();
//
// `judgement` is what judgeSpot() returns ({ result, feedback }, js/engine/analyse.js). The engine
// has already phrased the feedback in the caller's wording; this panel only adds its own labels in
// app.settings.wording. The board side of the reveal (the cue highlight, the ghost and the zone) is
// the caller's job: feedback.cue.highlight is a board marker, ghost/zone come from the scene.
//
// Extras beyond the contract (all optional): showCue/showFull take `focus` (default true: focus the
// main button), showFull takes `nextLabel`/`replayLabel`, `animate` (default true; false re-shows a
// reveal without the count-up or the S celebration) and `reward` (a node shown under the grade: the
// rep's stars and XP, js/ui/celebrate.js); the module exports the pure helpers hotCold, gradeColor,
// revealModel, topLine, pickText, principleLabel, createLiveAnnouncer and the starRating() DOM helper.

import { el, button, icon } from './components.js';

export const REVEAL_DEFAULTS = Object.freeze({
  countUpMs: 750, // [D] score count-up in beat 2
  liveAnnounceMs: 900, // [D] a live grade change is read out once it has held this long (no chatter while dragging)
  flourishBits: 14, // [D] confetti pieces around an S badge
  maxPraise: Object.freeze({ standard: 2, kid: 1 }), // [D]
});

/** Hot/cold bands, highest first: [word, min score]. They follow the grade bands (score.js): S / A-B / C-D / F. [D] */
export const HOT_COLD_BANDS = Object.freeze([['on fire', 90], ['hot', 70], ['warm', 50]]);

/**
 * The hot/cold word for a live score: 'on fire' (S), 'hot' (A or B), 'warm' (C or D), 'cold' (F).
 * Non-numbers read as 'cold'.
 * @param {number} score 0..100
 * @returns {'on fire'|'hot'|'warm'|'cold'}
 */
export function hotCold(score) {
  if (!Number.isFinite(score)) return 'cold';
  for (const [word, min] of HOT_COLD_BANDS) if (score >= min) return /** @type {any} */ (word);
  return 'cold';
}

/**
 * Badge colours per grade. Mid-light hues that read on both themes with dark ink (GRADE_INK), and
 * that step down in lightness as well as hue from S to F, so the order survives colour blindness.
 */
export const GRADE_COLORS = Object.freeze({
  S: '#2fd07f', A: '#69c94a', B: '#b5cf3c', C: '#f1c232', D: '#f59a3c', F: '#ef6a5e',
});
export const GRADE_INK = '#10170f';
const GRADE_FALLBACK = '#9aa8a0';

/** Badge colour for a grade ('S'..'F'); a neutral grey for anything else. */
export function gradeColor(grade) {
  return GRADE_COLORS[String(grade ?? '').toUpperCase()] ?? GRADE_FALLBACK;
}

/** A string, or a { standard, kid } pair picked by wording (falls back to standard). '' for nothing. */
export function pickText(v, wording = 'standard') {
  if (v === null || v === undefined || v === false) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return String(v[wording === 'kid' ? 'kid' : 'standard'] ?? v.standard ?? v.kid ?? '');
  return String(v);
}

/**
 * The one line the live readout shows: the top reason, else the first praise, else the headline.
 * On an S grade praise comes first (a small leftover reason would read oddly next to "on fire").
 */
export function topLine(feedback) {
  if (!feedback) return '';
  const reason = feedback.reasons?.[0]?.text, praise = feedback.praise?.[0];
  return (feedback.grade === 'S' ? praise || reason : reason || praise) || feedback.headline || '';
}

const COPY = {
  standard: {
    heat: { 'on fire': 'On fire', hot: 'Hot', warm: 'Warm', cold: 'Cold' },
    noCue: 'Happy with that spot? Let’s see how it scores.',
    cueKicker: 'Before you see the answer',
    showMe: 'Show me',
    why: 'Why',
    polish: 'To make it perfect',
    fix: 'The fix',
    praise: 'What you got right',
    takeaway: 'Takeaway',
    misconception: 'Watch out',
    next: 'Next',
    replay: 'Replay',
    mustFix: 'Must fix',
    outOf: 'out of 100',
    sr: (score, grade) => `You scored ${score} out of 100, grade ${grade}.`,
    srLive: (score, grade, heat) => `${score}, grade ${grade}, ${heat}.`,
    principleLink: (id, name) => `Principle ${id}: ${name}. Opens the principle library.`,
  },
  kid: {
    heat: { 'on fire': 'On fire', hot: 'Hot', warm: 'Warm', cold: 'Cold' },
    noCue: 'Happy with your spot? Let’s see how you did.',
    cueKicker: 'Think first',
    showMe: 'Show me',
    why: 'Why',
    polish: 'Even better',
    fix: 'Try this',
    praise: 'You did well',
    takeaway: 'Remember',
    misconception: 'Watch out',
    next: 'Next',
    replay: 'Watch again',
    mustFix: 'Important',
    outOf: 'out of 100',
    sr: (score, grade) => `You scored ${score} out of 100. Grade ${grade}.`,
    srLive: (score, grade, heat) => `${score}, grade ${grade}, ${heat}.`,
    principleLink: (id, name) => `Idea ${id}: ${name}. Opens the idea page.`,
  },
};

/**
 * A principle's short label in a wording: its kidName in Kid wording (when the data has one), else its short name.
 * @param {{ short?: string, kidName?: string, name?: string, id?: string }|null|undefined} p
 */
export function principleLabel(p, wording = 'standard') {
  if (!p) return '';
  return (wording === 'kid' && p.kidName) || p.short || p.name || p.id || '';
}

/**
 * Everything beat 2 shows, as plain data (pure; the DOM is built from it).
 * @param {{ result: object, feedback: object }} judgement  from judgeSpot()
 * @param {{ wording?: 'standard'|'kid', principles?: object, principleLinks?: boolean }} [opts]
 *   principles: a byId map (or { byId }) from data/principles.json, for the chip labels
 * @returns {{ score:number, grade:string, color:string, heat:string, headline:string,
 *   reasons: { text:string, critical:boolean, principle: { id:string, label:string, name:string, href:string|null }|null }[],
 *   fix: string, praise: string[] }}
 */
export function revealModel(judgement, { wording = 'standard', principles, principleLinks = true } = {}) {
  const w = wording === 'kid' ? 'kid' : 'standard';
  const fb = judgement?.feedback ?? {};
  const res = judgement?.result ?? {};
  const score = Math.round(Number.isFinite(fb.score) ? fb.score : Number.isFinite(res.score) ? res.score : 0);
  const grade = fb.grade ?? res.grade ?? '?';
  const byId = principles?.byId ?? principles ?? {};
  const maxReasons = w === 'kid' ? 1 : 2;
  const reasons = (fb.reasons ?? []).slice(0, maxReasons).map((r) => {
    const p = r.principleId ? byId[r.principleId] : null;
    const name = p?.name ?? r.name ?? r.principleId ?? '';
    const principle = r.principleId ? {
      id: r.principleId,
      name,
      label: principleLabel(p, w) || r.name || r.principleId,
      href: principleLinks ? `#/learn/p/${encodeURIComponent(r.principleId)}` : null,
    } : null;
    return { text: r.text ?? '', critical: !!r.critical, principle };
  });
  return {
    score,
    grade,
    color: gradeColor(grade),
    heat: hotCold(score),
    headline: fb.headline ?? '',
    reasons,
    fix: fb.fix?.text ?? '',
    praise: (fb.praise ?? []).slice(0, REVEAL_DEFAULTS.maxPraise[w]),
  };
}

// ------------------------------------------------------------------ DOM helpers (also used by other views)

const SVGNS = 'http://www.w3.org/2000/svg';
const STAR_PATH = 'M12 2.8l2.75 5.9 6.45.7-4.8 4.4 1.33 6.35L12 16.9l-5.73 3.25L7.6 13.8 2.8 9.4l6.45-.7z';

/**
 * Star rating (decorative stars plus a text label for screen readers).
 * @param {number} n  stars earned
 * @param {{ max?: number, label?: string, size?: number }} [opts]
 */
export function starRating(n, { max = 3, label, size = 16 } = {}) {
  const k = Math.max(0, Math.min(max, Math.round(n) || 0));
  const wrap = el('span', { class: 'rv-stars', role: 'img', 'aria-label': label ?? `${k} of ${max} stars` });
  for (let i = 0; i < max; i++) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.setAttribute('class', i < k ? 'rv-star is-on' : 'rv-star');
    s.innerHTML = `<path d="${STAR_PATH}"/>`;
    wrap.append(s);
  }
  return wrap;
}

/** A principle chip: a link to its page (or a plain tag when links are off). */
export function principleChip(principle, { wording = 'standard', className } = {}) {
  if (!principle) return null;
  const C = COPY[wording === 'kid' ? 'kid' : 'standard'];
  const body = [el('b', { text: principle.id }), el('span', { text: principle.label })];
  if (!principle.href) return el('span', { class: ['rv-chip', className] }, body);
  return el('a', { class: ['rv-chip', className], href: principle.href, 'aria-label': C.principleLink(principle.id, principle.name || principle.label) }, body);
}

/**
 * The screen-reader side of the live readout. A grade is read out once it has held for `delay` ms, with the
 * newest score and line at that moment; coming back to the grade last read out cancels a pending read-out
 * (so A → B → A within the delay says nothing, rather than "B" while the screen shows A). Timers are
 * injected, so this runs under node --test.
 * @param {{ delay?: number, say: (text: string) => void, setTimer?: Function, clearTimer?: Function }} opts
 * @returns {{ update(grade: string, text: string): void, reset(): void, readonly announced: string|null }}
 */
export function createLiveAnnouncer({ delay = REVEAL_DEFAULTS.liveAnnounceMs, say, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let announced = null; // the grade last read out
  let pending = null; // { grade, timer }: a grade waiting to be read out
  let latest = null; // the newest { grade, text }
  const cancel = () => {
    if (pending) clearTimer(pending.timer);
    pending = null;
  };
  return {
    update(grade, text) {
      latest = { grade, text };
      if (grade === announced) { cancel(); return; }
      if (pending?.grade === grade) return; // still waiting on this grade: its hold time runs from when it first showed
      cancel();
      pending = {
        grade,
        timer: setTimer(() => {
          pending = null;
          announced = latest.grade;
          say?.(latest.text);
        }, delay),
      };
    },
    reset() {
      cancel();
      announced = null;
      latest = null;
    },
    get announced() { return announced; },
  };
}

const prefersReducedMotion = (app) => {
  // main.js resolves the query into the attribute (audit 2026-10-01): read it, with the setting for DOM-less tests.
  return app?.settings?.reducedMotion === true || globalThis.document?.documentElement?.dataset?.reducedMotion === 'true';
};

/**
 * Create the feedback panel inside `container`.
 * @param {HTMLElement} container
 * @param {{ app: object }} opts  the app object (settings.wording, settings.reducedMotion, data.principles)
 */
export function createFeedbackPanel(container, { app } = {}) {
  const P = REVEAL_DEFAULTS;
  const wording = () => (app?.settings?.wording === 'kid' ? 'kid' : 'standard');
  const copy = () => COPY[wording()];
  const principles = () => app?.data?.principles?.byId ?? {};

  // The live readout changes on every drag move: it must not be read out each time. A nested
  // aria-live="off" wins over a live container; grade changes are announced from srLive instead.
  const liveBox = el('div', { class: 'rv-live', 'aria-live': 'off', hidden: true });
  const beat = el('div', { class: 'rv-beat', 'aria-live': 'polite' });
  const srLive = el('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const root = el('div', { class: 'rv', dataset: { state: 'empty' } }, [liveBox, beat, srLive]);
  container.append(root);

  let raf = 0;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const stopAnimations = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const setState = (s) => { root.dataset.state = s; };

  // ---- live readout (built once, then only text and styles change)
  const live = {
    num: el('span', { class: 'rv-live-num', 'aria-hidden': 'true' }),
    grade: el('span', { class: 'rv-grade rv-grade--sm', 'aria-hidden': 'true' }),
    heat: el('span', { class: 'rv-heat' }),
    fill: el('span', { class: 'rv-meter-fill' }),
    line: el('p', { class: 'rv-live-line' }),
    key: '',
  };
  liveBox.append(
    el('div', { class: 'rv-live-score' }, [live.num, live.grade]),
    el('div', { class: 'rv-live-main' }, [
      el('div', { class: 'rv-live-top' }, [live.heat, el('span', { class: 'rv-meter', 'aria-hidden': 'true' }, [live.fill])]),
      live.line,
    ]),
  );
  const announcer = createLiveAnnouncer({
    delay: P.liveAnnounceMs,
    say: (text) => { srLive.textContent = text; },
    setTimer: later,
    clearTimer: (t) => { clearTimeout(t); timers.delete(t); },
  });

  function showLive(judgement) {
    if (!judgement) { clear(); return; }
    if (root.dataset.state !== 'live') {
      stopAnimations();
      beat.replaceChildren();
      liveBox.hidden = false;
      setState('live');
    }
    const m = revealModel(judgement, { wording: wording(), principles: principles(), principleLinks: false });
    const line = topLine(judgement.feedback);
    const key = `${m.score}|${m.grade}|${m.heat}|${line}|${wording()}`;
    if (key === live.key) return;
    live.key = key;
    live.num.textContent = String(m.score);
    live.grade.textContent = m.grade;
    live.grade.style.setProperty('--grade', m.color);
    live.heat.textContent = copy().heat[m.heat];
    live.heat.dataset.heat = m.heat.replace(' ', '-');
    live.fill.style.width = `${Math.max(2, Math.min(100, m.score))}%`;
    live.fill.style.setProperty('--grade', m.color);
    live.line.textContent = line;
    liveBox.dataset.heat = m.heat.replace(' ', '-');
    // Read a grade out once it has held for a moment (never a stale one: createLiveAnnouncer).
    announcer.update(m.grade, `${copy().srLive(m.score, m.grade, copy().heat[m.heat])} ${line}`);
  }

  function enterBeat(state) {
    stopAnimations();
    announcer.reset();
    liveBox.hidden = true;
    live.key = '';
    setState(state);
  }

  // ---- beat 1: the cue question
  function showCue(judgement, { onReveal, focus = true } = {}) {
    if (!judgement) { clear(); return; }
    enterBeat('cue');
    const C = copy();
    const fb = judgement.feedback ?? {};
    const question = fb.cue?.text || C.noCue;
    const btn = button(C.showMe, { variant: 'primary', icon: 'arrow', className: 'rv-show', onClick: () => onReveal?.() });
    beat.replaceChildren(el('div', { class: 'rv-cue' }, [
      // The kicker never gives the grade away: beat 1 is for thinking before the answer (RESEARCH 7.1).
      el('p', { class: 'rv-kicker', text: C.cueKicker }),
      el('p', { class: 'rv-question', text: question }),
      el('div', { class: 'rv-actions' }, [btn]),
    ]));
    if (focus) btn.focus({ preventScroll: true });
  }

  // ---- beat 2: the full reveal
  function countUp(node, to, reduced) {
    if (reduced || to <= 0) { node.textContent = String(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / P.countUpMs);
      const eased = 1 - (1 - k) ** 3;
      node.textContent = String(Math.round(to * eased));
      raf = k < 1 ? requestAnimationFrame(step) : 0;
    };
    node.textContent = '0';
    raf = requestAnimationFrame(step);
  }

  function flourish(host) {
    const bits = el('span', { class: 'rv-flourish', 'aria-hidden': 'true' });
    for (let i = 0; i < P.flourishBits; i++) {
      const a = (i / P.flourishBits) * 360 + (i % 2 ? 9 : -9);
      const d = 34 + (i % 3) * 10;
      bits.append(el('i', { style: { '--a': `${a}deg`, '--d': `${d}px`, '--i': String(i % 4) } }));
    }
    host.append(bits);
    later(() => bits.remove(), 1600);
  }

  function showFull(judgement, { onNext, onReplay, takeaway, misconception, principleLinks = true, nextLabel, replayLabel, focus = true, animate = true, reward = null } = {}) {
    if (!judgement) { clear(); return; }
    enterBeat('full');
    const w = wording();
    const C = copy();
    const m = revealModel(judgement, { wording: w, principles: principles(), principleLinks });
    // animate: false re-shows a reveal (e.g. in new wording) without counting the score up or celebrating again.
    const reduced = prefersReducedMotion(app) || !animate;

    const num = el('span', { class: 'rv-num', 'aria-hidden': 'true', text: reduced ? String(m.score) : '0' });
    const badge = el('span', { class: 'rv-badge', 'aria-hidden': 'true', style: { '--grade': m.color }, text: m.grade });
    const badgeWrap = el('span', { class: 'rv-badge-wrap' }, [badge]);
    const reasons = m.reasons.length ? el('div', { class: 'rv-section' }, [
      el('p', { class: 'rv-label', text: m.grade === 'S' ? C.polish : C.why }),
      el('ul', { class: 'rv-reasons' }, m.reasons.map((r) => el('li', { class: r.critical ? 'is-critical' : null }, [
        el('p', {}, [r.critical ? el('span', { class: 'rv-flag', text: C.mustFix }) : null, r.text]),
        principleChip(r.principle, { wording: w }),
      ]))),
    ]) : null;
    const fix = m.fix && m.grade !== 'S' ? el('div', { class: 'rv-fix' }, [
      icon('arrow', { size: 18 }),
      el('p', {}, [el('strong', { text: `${C.fix}: ` }), m.fix]),
    ]) : null;
    const praise = m.praise.length ? el('div', { class: 'rv-section' }, [
      el('p', { class: 'rv-label', text: C.praise }),
      el('ul', { class: 'rv-praise' }, m.praise.map((t) => el('li', {}, [icon('check', { size: 16 }), el('span', { text: t })]))),
    ]) : null;
    const note = (kind, v) => {
      const text = pickText(v, w);
      return text ? el('div', { class: `rv-note rv-note--${kind}` }, [el('strong', { text: C[kind] }), el('p', { text })]) : null;
    };
    const nextBtn = onNext ? button(nextLabel ?? C.next, { variant: 'primary', icon: 'arrow', className: 'rv-next', onClick: () => onNext() }) : null;
    const replayBtn = onReplay ? button(replayLabel ?? C.replay, { icon: 'play', className: 'rv-replay', onClick: () => onReplay() }) : null;

    const full = el('div', { class: 'rv-full', dataset: { grade: m.grade } }, [
      el('div', { class: 'rv-result' }, [
        badgeWrap,
        el('div', { class: 'rv-result-text' }, [
          el('p', { class: 'rv-score' }, [num, el('span', { class: 'rv-outof', 'aria-hidden': 'true', text: '/100' })]),
          el('h2', { class: 'rv-headline', text: m.headline }),
        ]),
      ]),
      el('p', { class: 'visually-hidden', text: C.sr(m.score, m.grade) }),
      reward ? el('div', { class: 'rv-reward' }, [reward]) : null,
      reasons,
      fix,
      praise,
      note('takeaway', takeaway),
      note('misconception', misconception),
      nextBtn || replayBtn ? el('div', { class: 'rv-actions' }, [replayBtn, nextBtn]) : null,
    ]);
    beat.replaceChildren(full);
    countUp(num, m.score, reduced);
    if (m.grade === 'S' && !reduced) {
      full.classList.add('is-celebrating');
      flourish(badgeWrap);
    }
    if (focus) (nextBtn ?? replayBtn)?.focus({ preventScroll: true });
  }

  function clear() {
    enterBeat('empty');
    beat.replaceChildren();
    srLive.textContent = '';
  }

  function destroy() {
    stopAnimations();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    root.remove();
  }

  return { el: root, showLive, showCue, showFull, clear, destroy };
}
