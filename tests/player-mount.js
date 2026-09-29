// A Player screen's mount on a fake page under Node (not a test file: the mount tests of tests/player-play.test.js and
// tests/player-pass.test.js import it). Only in Node: the browser runner (tests.html) has a real page, and those tests
// return early there. Nothing here runs at import time.

/**
 * Just enough of a page for a Player screen's mount (play.js, pass.js, and reveal.js, fulltime.js, components.js):
 * elements with attributes, classes, data, styles, children, text, listeners, click() and simple selectors; the
 * document, history, and the animation frames, timers and performance.now() on a virtual clock the test drives (step,
 * until), yielding to real promises between. No layout: every box is empty. Installs globals; restore() puts them back.
 * @returns {{ doc, clock: { now: number, step(dt?): Promise, until(pred, { maxMs?, dt? }?): Promise<boolean> }, restore(), FEl }}
 */
export function fakePage() {
  const saved = {};
  const setGlobal = (k, v) => { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); };
  class FNode {}
  class FText extends FNode { constructor(t) { super(); this.textContent = String(t); this.parentNode = null; } }
  const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  const matchOne = (n, sel) => {
    const m = /^([a-z0-9]*)((?:[.#][\w-]+|\[[^\]]+\])*)$/i.exec(sel.trim());
    if (!m || !(n instanceof FEl)) return false;
    if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
    for (const part of m[2].match(/[.#][\w-]+|\[[^\]]+\]/g) ?? []) {
      if (part[0] === '.') { if (!n.classList.contains(part.slice(1))) return false; } else if (part[0] === '#') { if (n.getAttribute('id') !== part.slice(1)) return false; } else {
        const [, k, v] = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(part) ?? [];
        if (!k || !n.hasAttribute(k) || (v !== undefined && n.getAttribute(k) !== v)) return false;
      }
    }
    return true;
  };
  const matches = (n, sel) => sel.split(',').some((alt) => {
    const chain = alt.trim().split(/\s+/);
    if (!matchOne(n, chain.at(-1))) return false;
    let a = n.parentNode;
    for (let i = chain.length - 2; i >= 0; i--) { while (a && !matchOne(a, chain[i])) a = a.parentNode; if (!a) return false; a = a.parentNode; }
    return true;
  });
  class FEl extends FNode {
    constructor(tag) {
      super();
      this.tagName = String(tag).toUpperCase();
      this.ownerDocument = doc;
      this.attrs = new Map();
      this.childNodes = [];
      this.parentNode = null;
      this.dataset = {};
      this.listeners = {};
      const cls = new Set();
      this.classList = {
        add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c),
        toggle: (c, on = !cls.has(c)) => { if (on) cls.add(c); else cls.delete(c); return on; }, set: (v) => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); },
        toString: () => [...cls].join(' '),
      };
      const props = new Map();
      this.style = { setProperty: (k, v) => props.set(k, String(v)), removeProperty: (k) => props.delete(k), getPropertyValue: (k) => props.get(k) ?? '' };
    }
    get children() { return this.childNodes.filter((c) => c instanceof FEl); }
    get firstChild() { return this.childNodes[0] ?? null; }
    get lastChild() { return this.childNodes.at(-1) ?? null; }
    get className() { return this.classList.toString(); }
    set className(v) { this.classList.set(v); }
    get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { this.replaceChildren(); if (v !== '' && v !== null && v !== undefined) this.append(String(v)); }
    set innerHTML(v) { this.replaceChildren(); }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
    get offsetWidth() { return 0; }
    get offsetHeight() { return 0; }
    setAttribute(k, v) { if (k === 'class') { this.classList.set(v); return; } this.attrs.set(k, String(v)); if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v); }
    getAttribute(k) { return k === 'class' ? this.classList.toString() : this.attrs.has(k) ? this.attrs.get(k) : null; }
    hasAttribute(k) { return k === 'class' ? !!this.className : this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    append(...cs) { for (const c of cs) this.appendChild(c instanceof FNode ? c : new FText(c)); }
    prepend(...cs) { for (const c of cs.reverse()) this.insertBefore(c instanceof FNode ? c : new FText(c), this.firstChild); }
    appendChild(c) { return this.insertBefore(c, null); }
    insertBefore(c, ref) {
      if (c.parentNode) c.parentNode.childNodes.splice(c.parentNode.childNodes.indexOf(c), 1);
      c.parentNode = this;
      const i = ref ? this.childNodes.indexOf(ref) : -1;
      if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
      return c;
    }
    replaceChildren(...cs) { for (const c of [...this.childNodes]) { c.parentNode = null; } this.childNodes = []; this.append(...cs); }
    remove() { if (this.parentNode) { this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; } }
    contains(n) { for (let a = n; a; a = a.parentNode) if (a === this) return true; return false; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
    dispatchEvent(e) { for (const fn of [...(this.listeners[e.type] ?? [])]) fn(e); if (e.type === 'click') this.onclick?.(e); return true; }
    click() { if (!this.hasAttribute('disabled')) this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} }); }
    focus() { doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
    matches(sel) { return matches(this, sel); }
    closest(sel) { for (let a = this; a instanceof FEl; a = a.parentNode) if (matches(a, sel)) return a; return null; }
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } }; walk(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
    animate() { return { finished: Promise.resolve(), cancel() {}, onfinish: null }; }
  }
  const docListeners = {};
  const doc = {
    createElement: (t) => new FEl(t), createElementNS: (_ns, t) => new FEl(t), createTextNode: (t) => new FText(t),
    addEventListener: (type, fn) => { (docListeners[type] ??= []).push(fn); }, removeEventListener: (type, fn) => { docListeners[type] = (docListeners[type] ?? []).filter((f) => f !== fn); },
    getElementById: (id) => doc.documentElement.querySelector(`#${id}`), querySelector: (s) => doc.documentElement.querySelector(s), hidden: false,
  };
  doc.documentElement = new FEl('html');
  doc.body = new FEl('body');
  doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  // The virtual clock: timers and animation frames run when the test says, between real turns for promises; an
  // animation frame gets the clock's time, as performance.now() tells it (a browser's frames and clock agree).
  const realImmediate = globalThis.setImmediate;
  let now = 0, seq = 0;
  const timers = new Map(), frames = new Map();
  const settle = () => new Promise((r) => realImmediate(r));
  const clock = {
    get now() { return now; },
    async step(dt = 16) {
      now += dt;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (!due.length) break;
        for (const [id, t] of due) { if (!timers.has(id)) continue; timers.delete(id); t.fn(...t.args); }
        await settle();
      }
      const fs = [...frames.values()];
      frames.clear();
      for (const fn of fs) fn(now);
      await settle();
    },
    async until(pred, { maxMs = 120000, dt = 16 } = {}) {
      const end = now + maxMs;
      while (!pred()) { if (now > end) return false; await clock.step(dt); }
      return true;
    },
  };
  setGlobal('document', doc);
  setGlobal('Node', FNode);
  setGlobal('history', { state: null, replaceState() {}, pushState() {} });
  setGlobal('location', { hash: '', search: '' });
  setGlobal('setTimeout', (fn, ms = 0, ...args) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args }); return id; });
  setGlobal('clearTimeout', (id) => { timers.delete(id); });
  setGlobal('requestAnimationFrame', (fn) => { const id = ++seq; frames.set(id, fn); return id; });
  setGlobal('cancelAnimationFrame', (id) => { frames.delete(id); });
  setGlobal('performance', { now: () => now, timeOrigin: 0, mark() {}, measure() {} });
  setGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const restore = () => { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } };
  return { doc, clock, restore, FEl };
}

/**
 * A board that draws nothing and records what a screen asks of it, with the screen's phase (phaseOf()) and its card's
 * words (cardOf()) then: `log.renders` (the players drawn, as ids and places, the ball and the learner), `markers` (the
 * players each set of markers names: `ids` the rings' ids, `named` every id or receiverId, `list` the markers),
 * `spot` (the spotlight), `camera` (setCamera's rects), `focus`, `drag` and `targets` (enableTargets: the ids); each
 * entry has its `seq`, its place in the order of all the calls; `camera` and `markers` entries also their time `t`
 * (performance.now(): the fake page's clock), so a test can tell what came after a camera had landed.
 * `board.targets` is the enableTargets call in force (its ids, onTap and onPreview: a test "taps" through them), or null.
 * clientBox and drawnBox know nothing of the screen (null), so a card over the pitch keeps its default place. drawnAt
 * (where a player or the ball is drawn) is null, or, given `drawnOffset(id)` → { x, y } (a stand-in for board.js's
 * declutter), where the last render put it moved by that much. `renders` entries have their time `t` too.
 */
export function recordingBoard(page, phaseOf, cardOf = () => '', { drawnOffset = null } = {}) {
  const log = { renders: [], markers: [], spot: [], camera: [], focus: [], drag: [], targets: [] };
  let seq = 0; // every entry's place in the order of calls (a test sorts the other logs into the renders' reps with it)
  const vb = { x: -3, y: -3, width: 74, height: 111 };
  const el = page.doc.createElement('div');
  el.setAttribute('data-orientation', 'vertical');
  const board = {
    el, log, orientation: 'vertical', tokenScale: 1, figureScale: 1, ballScale: 1, pxPerMetre: 5, camera: null, figures: true,
    viewBox: vb, targetViewBox: vb, targets: null,
    render(frame, o = {}) {
      log.renders.push({
        seq: ++seq, ph: phaseOf(), t: globalThis.performance?.now?.() ?? 0, ids: frame.players.map((p) => p.id).sort(), learner: o.learnerId, card: cardOf(),
        at: Object.fromEntries(frame.players.map((p) => [p.id, { x: p.x, y: p.y }])), ball: frame.ball ? { x: frame.ball.x, y: frame.ball.y } : null,
      });
    },
    setMarkers(ms) {
      const list = (ms ?? []).filter(Boolean);
      const str = (v) => typeof v === 'string';
      log.markers.push({ seq: ++seq, ph: phaseOf(), t: globalThis.performance?.now?.() ?? 0, ids: list.map((m) => m.id).filter(str), named: [...new Set(list.flatMap((m) => [m.id, m.receiverId]).filter(str))], list });
    },
    setSpotlight(ids) { log.spot.push({ seq: ++seq, ph: phaseOf(), ids: ids ? [...ids] : null }); },
    setCamera(r) { log.camera.push({ seq: ++seq, ph: phaseOf(), t: globalThis.performance?.now?.() ?? 0, r: r ? { ...r } : null }); board.camera = r ? { ...r } : null; },
    setFocus(f) { log.focus.push({ seq: ++seq, ph: phaseOf(), f: f ?? null }); },
    enableDrag(o) { log.drag.push({ seq: ++seq, ph: phaseOf(), ids: [...(o?.ids ?? [])] }); },
    enableTargets(o) { board.targets = o; log.targets.push({ seq: ++seq, ph: phaseOf(), ids: [...(o?.ids ?? [])] }); },
    disableTargets() { board.targets = null; },
    previewTarget() {},
    disableDrag() {}, setGhost() {}, setZone() {}, setHeatmap() {}, setOverlays() {}, setAid() {}, destroy() {},
    showHintHand: () => Promise.resolve(), drawnBox: () => null, clientBox: () => null,
    drawnAt(id) {
      const r = typeof drawnOffset === 'function' ? log.renders.at(-1) : null;
      const p = r ? (id === 'ball' ? r.ball : r.at[id]) : null;
      if (!p) return null;
      const d = drawnOffset(id) ?? { x: 0, y: 0 };
      return { x: p.x + d.x, y: p.y + d.y };
    },
  };
  return board;
}
