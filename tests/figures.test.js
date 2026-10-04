import { test, assert, isNode } from './harness.js';
import {
  drawFigure, figureSpec, figureLook, runDelay, isKeeperId, numberFontSize, limbPath, setFacing,
  FIGURE, FIGURE_BOXES, FIGURE_DEFAULTS, SKIN_TONES, HAIR_COLOURS, HAIR_STYLES,
} from '../js/ui/figures.js';

// The 22 player ids the board draws (js/engine/roles.js ROLES, both teams).
const ROLES = ['GK', 'LCB', 'RCB', 'LB', 'RB', 'DM', 'LCM', 'RCM', 'LW', 'RW', 'ST'];
const IDS = ['us', 'them'].flatMap((team) => ROLES.map((r) => `${team}-${r}`));

/** Every node of a figureSpec tree, depth first. */
function nodes(spec, out = []) {
  if (!spec) return out;
  out.push(spec);
  for (const c of spec.children ?? []) nodes(c, out);
  return out;
}
const classesOf = (spec) => nodes(spec).flatMap((n) => String(n.attrs?.class ?? '').split(/\s+/).filter(Boolean));
const byClass = (spec, cls) => nodes(spec).filter((n) => String(n.attrs?.class ?? '').split(/\s+/).includes(cls));

test('figures: import-safe under Node (no document or window touched at import time)', () => {
  if (isNode) {
    assert.equal(typeof globalThis.document, 'undefined', 'this test runs without a DOM');
    assert.equal(typeof globalThis.window, 'undefined');
  }
  assert.equal(typeof drawFigure, 'function');
  assert.equal(FIGURE.height, 2.4, 'about 2.4 token radii tall (PROGRESSIVE_FIELD §4)');
});

test('figures: a player\'s look is deterministic, and differs between players', () => {
  for (const id of IDS) assert.deepEqual(figureLook(id), figureLook(id), id);
  assert.deepEqual(figureLook('LB', 'us'), figureLook('us-LB'), 'a bare role takes the team given');
  const keys = new Set(IDS.map((id) => JSON.stringify(figureLook(id))));
  assert.equal(keys.size, IDS.length, 'the 22 players all look different');
  for (const id of IDS) {
    const l = figureLook(id);
    assert.ok(SKIN_TONES.includes(l.skin) && HAIR_COLOURS.includes(l.hair) && HAIR_STYLES.includes(l.hairStyle), `${id}: ${JSON.stringify(l)}`);
  }
});

test('figures: the variety covers every skin tone, hair colour and hair style (each team: every tone and style)', () => {
  assert.equal(SKIN_TONES.length, 5);
  assert.equal(HAIR_COLOURS.length, 5);
  assert.deepEqual([...HAIR_STYLES], ['short', 'curly', 'fringe', 'spiky'], 'boys\' cuts only: every player is a boy');
  for (const team of ['us', 'them']) {
    const looks = ROLES.map((r) => figureLook(`${team}-${r}`));
    assert.equal(new Set(looks.map((l) => l.skin)).size, 5, `${team}: all 5 skin tones`);
    assert.equal(new Set(looks.map((l) => l.hairStyle)).size, 4, `${team}: all 4 hair styles`);
  }
  assert.equal(new Set(IDS.map((id) => figureLook(id).hair)).size, 5, 'all 5 hair colours on the pitch');
  // Natural combinations: the two deepest skin tones take black, dark brown or brown hair.
  for (const id of IDS) {
    const l = figureLook(id);
    if (SKIN_TONES.indexOf(l.skin) >= 3) assert.ok(HAIR_COLOURS.indexOf(l.hair) <= 2, `${id}: ${l.hair}`);
  }
  assert.equal(new Set(HAIR_STYLES.map((s) => byClass(figureSpec({ hairStyle: s }), 'fig-hair')[0].attrs.d)).size, 4, 'four different hair shapes');
});

test('figures: faceless (no eyes, mouth or smile): the head is a plain circle with hair', () => {
  for (const hairStyle of HAIR_STYLES) {
    const spec = figureSpec({ hairStyle, number: 7, run: true, gk: true });
    const cls = classesOf(spec);
    for (const c of cls) assert.doesNotMatch(c, /eye|mouth|smile|nose|brow|face|cheek|pupil/, `${hairStyle}: ${c}`);
    const head = byClass(spec, 'fig-head');
    assert.equal(head.length, 1);
    assert.equal(head[0].tag, 'circle');
    assert.ok(!head[0].children?.length, 'nothing drawn on the head');
    // Only the head, the hair and the neck are drawn in the head's area (no features over it).
    const upper = nodes(spec).filter((n) => n.tag === 'path' && n.attrs?.d && Math.min(...(n.attrs.d.match(/-?\d*\.?\d+/g) ?? []).map(Number)) < -1.95);
    for (const n of upper) assert.match(n.attrs.class, /fig-hair|fig-neck/, `${hairStyle}: ${n.attrs.class} reaches the head`);
  }
  // Not babyish: a slightly big head (about a quarter of the height), not a cartoon one.
  const headShare = (2 * FIGURE.head.r) / FIGURE.height;
  assert.ok(headShare > 0.2 && headShare < 0.3, `head ${(headShare * 100).toFixed(0)} % of the height`);
});

test('figures: the shirt number, in the ink colour, never mirrored; the body faces the ball', () => {
  const right = figureSpec({ number: 10, facing: 1 });
  const left = figureSpec({ number: 10, facing: -1 });
  const num = byClass(right, 'fig-num');
  assert.equal(num.length, 1);
  assert.equal(num[0].tag, 'text');
  assert.equal(num[0].text, '10');
  assert.equal(num[0].attrs['font-size'], numberFontSize('10'));
  assert.ok(right.children.includes(num[0]), 'the number is outside the mirrored body');
  assert.equal(byClass(right, 'fig-body')[0].attrs.transform, null, 'facing right: as drawn');
  assert.equal(byClass(left, 'fig-body')[0].attrs.transform, 'scale(-1 1)', 'facing left: the body mirrored');
  assert.equal(byClass(left, 'fig-num')[0].attrs.transform, undefined);
  assert.match(left.attrs.class, /is-facing-left/);
  assert.equal(byClass(figureSpec({}), 'fig-num')[0].text, '', 'no number: an empty shirt');
  assert.ok(numberFontSize('7') >= numberFontSize('10') && numberFontSize('10') > numberFontSize('LCB'), 'one digit biggest, a role code smallest');
  // The number fits the shirt (it runs from y -1.84 to -0.9): its glyphs (about 0.72 of the font size) inside it.
  const half = (0.72 * numberFontSize('10')) / 2;
  assert.ok(FIGURE.numberY - half > -1.84 && FIGURE.numberY + half < -0.9);
});

/** The shirt's width at height y (its outline as a polygon: the path's points, scanned across). */
function shirtWidthAt(at) {
  const y = at + 1e-6; // never exactly on a corner
  const d = byClass(figureSpec({}), 'fig-shirt')[0].attrs.d;
  const n = d.match(/-?\d*\.?\d+/g).map(Number);
  const pts = [];
  for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]);
  const xs = [];
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    if ((a[1] - y) * (b[1] - y) < 0) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
  }
  return xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : 0;
}

test('figures: the shirt number is as big as the shirt takes (so the figure need not grow as much to read it), and inside it', () => {
  // Heavy digits in the app's font (system-ui, weight 900) are at most about 0.66 em wide and 0.72 em tall (measured).
  const EM_W = 0.66, CAP = 0.72;
  for (const text of ['7', '10', '88']) {
    const fs = numberFontSize(text);
    const w = [...text].length * EM_W * fs, top = FIGURE.numberY - (CAP * fs) / 2, bottom = FIGURE.numberY + (CAP * fs) / 2;
    assert.ok(top > -1.84 && bottom < -0.9, `${text}: inside the shirt from top to bottom (${top.toFixed(2)} to ${bottom.toFixed(2)})`);
    for (const y of [top, FIGURE.numberY, bottom]) {
      assert.ok(w <= shirtWidthAt(y) - 0.04, `${text}: ${w.toFixed(2)} wide within the shirt (${shirtWidthAt(y).toFixed(2)}) at y ${y.toFixed(2)}`);
    }
    if (text.length === 2) assert.ok(w >= 0.8 * shirtWidthAt(bottom), `${text}: fills the shirt (${w.toFixed(2)} of ${shirtWidthAt(bottom).toFixed(2)})`);
  }
});

test('figures: goalkeepers wear a kit of their own, with gloves and long sleeves', () => {
  const gk = figureSpec({ gk: true, run: true });
  const out = figureSpec({ gk: false, run: true });
  assert.match(gk.attrs.class, /\bis-gk\b/);
  assert.doesNotMatch(out.attrs.class, /is-gk/);
  assert.equal(byClass(gk, 'fig-gloves').length, 3, 'gloves in every pose');
  assert.equal(byClass(out, 'fig-gloves').length, 0);
  assert.equal(byClass(gk, 'fig-arms--long').length, 3, 'long sleeves (the arms in the shirt colour)');
  assert.ok(byClass(out, 'fig-arms').every((n) => n.attrs.fill), 'outfield arms are bare (skin)');
  assert.ok(isKeeperId('us-GK') && isKeeperId('them-GK'));
  assert.ok(!isKeeperId('us-LB') && !isKeeperId('ball') && !isKeeperId(null));
});

test('figures: kit colours are custom properties (the board\'s team kit, or a caller\'s); skin and hair are fills', () => {
  const plain = figureSpec({});
  assert.equal(plain.attrs.style, null, 'no kit given: css/figures.css gives the team\'s (--kit-us*, --kit-them*)');
  const kit = figureSpec({ shirt: '#cfe8ff', edge: '#1d4f91', ink: '#0b2545', shorts: 'var(--kit-us-edge)' });
  assert.equal(kit.attrs.style, '--fig-shirt:#cfe8ff;--fig-edge:#1d4f91;--fig-ink:#0b2545;--fig-shorts:var(--kit-us-edge)');
  const bad = figureSpec({ shirt: 'red;}body{display:none', edge: '#fff' });
  assert.equal(bad.attrs.style, '--fig-edge:#fff', 'anything that is not a colour is dropped');
  const look = { skin: SKIN_TONES[4], hair: HAIR_COLOURS[0], hairStyle: 'curly' };
  const spec = figureSpec(look);
  for (const n of byClass(spec, 'fig-skin')) assert.equal(n.attrs.fill, look.skin);
  assert.equal(byClass(spec, 'fig-hair')[0].attrs.fill, look.hair);
  assert.equal(byClass(spec, 'fig-hair')[0].attrs['data-style'], 'curly');
  assert.equal(byClass(figureSpec({ hairStyle: 'mohawk' }), 'fig-hair')[0].attrs['data-style'], 'short', 'an unknown style: short');
});

test('figures: sized by the base radius, 2.4 of them tall, feet at the origin; running poses on request', () => {
  const spec = figureSpec({ size: 1.8, run: true, gk: true, hairStyle: 'curly' });
  assert.equal(spec.attrs.transform, 'scale(1.8)');
  assert.equal(figureSpec({}).attrs.transform, null, 'size 1: no transform');
  // Every number in the paths within the figure's box (x within ±halfWidth and a boot, y from the top of the hair to
  // the soles; an arc's flags are 0 or 1).
  for (const n of nodes(spec)) {
    if (!n.attrs?.d) continue;
    for (const v of n.attrs.d.match(/-?\d*\.?\d+/g).map(Number)) assert.ok(v >= -2.56 && v <= 1, `${n.attrs.class}: ${v}`);
  }
  assert.deepEqual(byClass(spec, 'fig-pose').map((n) => n.attrs.class), ['fig-pose fig-pose-stand', 'fig-pose fig-pose-a', 'fig-pose fig-pose-b']);
  assert.equal(byClass(figureSpec({}), 'fig-pose').length, 1, 'standing only, unless asked');
  assert.equal(byClass(figureSpec({}), 'fig-base').length, 1, 'a base disc by default...');
  assert.equal(byClass(figureSpec({ base: false }), 'fig-base').length, 0, '...the board draws its own');
  for (const id of IDS) {
    const d = runDelay(id);
    assert.ok(d <= 0 && d > -FIGURE_DEFAULTS.runMs, `${id}: ${d}`);
  }
  assert.ok(new Set(IDS.map((id) => runDelay(id))).size > 15, 'the players never run in step');
  assert.match(limbPath([[0, 0], [0, -1]], 0.2), /^M-?0\.1 0L/);
});

/** Just enough DOM for drawFigure: createElementNS, attributes, children, text, a class selector. */
function fakeDoc() {
  const make = (tag) => {
    const n = {
      tagName: tag, attrs: {}, children: [], textContent: '', parentNode: null, ownerDocument: doc,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      querySelector(sel) {
        const cls = sel.slice(1);
        for (const c of this.children) {
          if (String(c.attrs.class ?? '').split(' ').includes(cls)) return c;
          const deep = c.querySelector(sel);
          if (deep) return deep;
        }
        return null;
      },
    };
    return n;
  };
  const doc = { createElementNS: (ns, tag) => make(tag) };
  return { doc, root: make('g') };
}

test('figures: drawFigure builds the spec into an SVG parent; setFacing turns the body, never the number', () => {
  const { root } = fakeDoc();
  const g = drawFigure(root, { number: 9, gk: true, size: 1.8, run: true, ...figureLook('them-GK') });
  assert.equal(root.children[0], g, 'appended to the parent');
  assert.equal(g.tagName, 'g');
  assert.match(g.getAttribute('class'), /^fig is-gk/);
  assert.equal(g.querySelector('.fig-num').textContent, '9');
  assert.ok(g.querySelector('.fig-gloves'));
  setFacing(g, -1);
  assert.equal(g.querySelector('.fig-body').getAttribute('transform'), 'scale(-1 1)');
  assert.equal(g.querySelector('.fig-num').getAttribute('transform'), null);
  setFacing(g, 1);
  assert.equal(g.querySelector('.fig-body').getAttribute('transform'), null);
});

test('figures: FIGURE.shoulders is the width across the drawn shoulders (between the shoulder joints and the sleeves\' ends)', () => {
  const spec = figureSpec({ number: 4 });
  const shirt = byClass(spec, 'fig-shirt')[0].attrs.d;
  const xs = [...shirt.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => Math.abs(+m[1]));
  const sleeves = Math.max(...xs); // the shirt's widest point: the sleeves' ends
  assert.ok(sleeves > 0.6 && sleeves < FIGURE.halfWidth, `sleeves at ±${sleeves}`);
  // The standing arms start at the shoulder joints, just inside the sleeves.
  const arms = byClass(spec, 'fig-arms')[0].attrs.d;
  const armXs = [...arms.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => Math.abs(+m[1]));
  const joints = Math.min(...armXs.filter((x) => x > 0.3));
  assert.ok(FIGURE.shoulders >= 2 * joints - 0.1 && FIGURE.shoulders <= 2 * sleeves, `${FIGURE.shoulders} across: joints ±${joints}, sleeves ±${sleeves}`);
});

test('figures: FIGURE_BOXES hold the parts drawn (head and hair, the two-digit number, the torso and arms, the legs and boots), facing either way', () => {
  const B = FIGURE_BOXES;
  const within = (box, x, y, what) => assert.ok(x >= box.x0 - 1e-9 && x <= box.x1 + 1e-9 && y >= box.y0 - 1e-9 && y <= box.y1 + 1e-9, `${what}: ${x}, ${y} in ${JSON.stringify(box)}`);
  // The points a path passes through (absolute M, L, Q and A commands: an arc's radii and flags are not points).
  const pairs = (d) => {
    const out = [], tok = d.match(/[A-Za-z]|-?\d*\.?\d+/g);
    let cmd = 'M', nums = [];
    const flush = () => { const n = cmd === 'A' ? nums.slice(-2) : nums; for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]); nums = []; };
    for (const t of tok) { if (/[A-Za-z]/.test(t)) { flush(); cmd = t; } else nums.push(+t); }
    flush();
    return out;
  };
  for (const facing of [1, -1]) {
    const spec = figureSpec({ number: 88, facing });
    const stand = byClass(spec, 'fig-pose-stand')[0];
    // (the body is mirrored for facing -1: every x the other way round)
    const at = (d, box, what) => { for (const [x, y] of pairs(d)) within(box, facing * x, y, what); };
    for (const cls of ['fig-shirt', 'fig-shorts', 'fig-collar']) at(byClass(spec, cls)[0].attrs.d, B.torso, cls);
    at(byClass(stand, 'fig-arms')[0].attrs.d, B.torso, 'arms');
    for (const cls of ['fig-legs', 'fig-socks', 'fig-boots']) at(byClass(stand, cls)[0].attrs.d, B.legs, cls);
    // The head and every hair style: the head's circle grown by the hair.
    const { x, y, r } = FIGURE.head;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) within(B.head, facing * (x + dx * (r + 0.1)), y + dy * (r + (dy < 0 ? 0.16 : 0)), 'head and hair');
    for (const style of HAIR_STYLES) {
      const d = byClass(figureSpec({ hairStyle: style, facing }), 'fig-hair')[0].attrs.d;
      for (const [px, py] of pairs(d)) within(B.head, facing * px, py, `${style} hair`);
    }
  }
  // Two heavy digits (at most 0.66 em wide and 0.72 em tall each) and one: inside the number's box.
  for (const text of ['7', '88']) {
    const fs = numberFontSize(text), w = [...text].length * 0.66 * fs, h = 0.72 * fs;
    within(B.number, -w / 2, FIGURE.numberY - h / 2, text);
    within(B.number, w / 2, FIGURE.numberY + h / 2, text);
  }
  // Head and number do not overlap (the board sums them as what says who a player is).
  assert.ok(B.head.y1 <= B.number.y0, 'the head over the number');
});
