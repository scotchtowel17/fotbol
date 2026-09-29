// Tabletop player figures (docs/PROGRESSIVE_FIELD.md §4): a team-coloured base disc with an upright, faceless
// footballer standing on it (head and hair, a shirt with the number in the kit's ink, shorts, socks, boots, arms).
// Cool and sporty for 10-14-year-olds, never babyish (KID_REDESIGN rule 7): no eyes or smile, only a slightly big head.
//
// Units: `size` is the base disc's radius. The figure stands FIGURE.height (2.4) sizes tall with its feet at (0, 0),
// up the screen (-y), facing +x (facing 1) or -x (facing -1: the body is mirrored, the number never is).
// Colours: the kit comes from CSS custom properties on the figure (--fig-shirt, --fig-edge, --fig-ink, --fig-shorts,
// --fig-socks; css/figures.css maps them to the board's --kit-us* / --kit-them* per team, so the kid's kit palette
// applies live), or from explicit colours a caller passes (the card, the kit locker). Skin and hair are the player's
// own (figureLook): deterministic per player id, 5 skin tones x 5 hair colours x 4 hair styles.
//
// Pure DOM helper: no engine imports, and nothing touches document or window at import time (Node imports it).
// figureSpec() is the pure part (a tree of plain shape specs, tested under node --test); drawFigure() builds it.

/** Figure geometry, in base radii (size = 1). */
export const FIGURE = Object.freeze({
  height: 2.4, // [S] PROGRESSIVE_FIELD §4: about 2.4 token radii tall (top of the hair; curly hair a touch more)
  halfWidth: 0.82, // [D] the widest pose (arms out), either side of the feet: the box a tap on the figure counts in
  numberY: -1.36, // [D] the shirt number's centre: the middle of the shirt (it runs from -1.84 to -0.9), where it is widest
  head: Object.freeze({ x: 0.03, y: -2.08, r: 0.31 }), // [D] slightly big, not cartoon big (about a quarter of the height)
});

/** Skin tones, light to deep (an inclusive range; the order is only for tests). */
export const SKIN_TONES = Object.freeze(['#f5d6bf', '#e2b48a', '#c38a5c', '#8e5a3a', '#5b3824']);
/** Hair colours: black, dark brown, brown, auburn, blond. */
export const HAIR_COLOURS = Object.freeze(['#18130f', '#3a2517', '#6b4428', '#9a4a1f', '#d6ad58']);
/** Hair styles. */
export const HAIR_STYLES = Object.freeze(['short', 'curly', 'ponytail', 'spiky']);

export const FIGURE_DEFAULTS = Object.freeze({
  salt: 15, // [M] hash salt: with it the 22 standard player ids get 22 different looks, each team all 5 skin tones and all 4 styles, and the two teams all 5 hair colours (tests/figures.test.js)
  runMs: 340, // [D] one run cycle (two poses), ms (the board sets it as --fig-run-ms for css/figures.css); each player starts at their own point in it (runDelay)
});

// Deeper skin tones take the darker hair colours (black, dark brown, brown), so every combination looks natural.
const DEEP_HAIR = [0, 1, 0, 1, 2];

/** FNV-1a, 32 bit. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * A player's look (deterministic per id): { skin, hair, hairStyle }.
 * @param {string} playerId  'us-LCB'
 * @param {'us'|'them'} [team]  only used when the id carries no team
 */
export function figureLook(playerId, team = '') {
  const id = String(playerId ?? '');
  const h = hash(`${FIGURE_DEFAULTS.salt}:${id.includes('-') ? id : `${team}-${id}`}`);
  const skin = h % 5;
  const h2 = Math.floor(h / 5) % 5;
  const hair = skin >= 3 ? DEEP_HAIR[h2] : h2;
  return { skin: SKIN_TONES[skin], hair: HAIR_COLOURS[hair], hairStyle: HAIR_STYLES[Math.floor(h / 25) % 4] };
}

/** Where in the run cycle a player starts (ms, negative: an animation-delay), so the team never runs in step. */
export const runDelay = (playerId, P = FIGURE_DEFAULTS) => -(hash(`run:${playerId}`) % P.runMs);

/** Is this a goalkeeper's id ('us-GK')? */
export const isKeeperId = (id) => typeof id === 'string' && /-GK$/.test(id);

/**
 * The shirt text's font size (base radii): one or two digits as big as the shirt takes (two heavy digits, about 1.32 em
 * wide, fill it edge to edge less a margin: tests/figures.test.js), so the figure need not grow as much for a readable
 * number (board.js figureScale); a three-letter role code smaller.
 */
export function numberFontSize(text) {
  const n = [...String(text ?? '')].length;
  return n <= 1 ? 0.74 : n === 2 ? 0.7 : 0.44;
}

// ---------------------------------------------------------------- geometry (pure; the path strings are built once)

const r3 = (n) => Math.round(n * 1000) / 1000;
const pt = (p) => `${r3(p[0])} ${r3(p[1])}`;

/** A limb as a filled outline: the polyline `pts` ([x, y] pairs) drawn `w` wide (flat ends; joints mitred). */
export function limbPath(pts, w) {
  const h = w / 2;
  const normals = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len];
  });
  const left = pts.map((p, i) => [p[0] + normals[i][0] * h, p[1] + normals[i][1] * h]);
  const right = pts.map((p, i) => [p[0] - normals[i][0] * h, p[1] - normals[i][1] * h]).reverse();
  return `M${[...left, ...right].map(pt).join('L')}Z`;
}

const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];

/** A boot at an ankle: sole 0.12 below it, the toe pointing +x (the way the figure faces). */
const bootPath = ([x, y]) =>
  `M${pt([x - 0.1, y - 0.03])}L${pt([x + 0.09, y - 0.04])}Q${pt([x + 0.25, y - 0.02])} ${pt([x + 0.26, y + 0.07])}`
  + `L${pt([x + 0.26, y + 0.12])}L${pt([x - 0.12, y + 0.12])}Z`;

const circlePath = ([x, y], r) => `M${pt([x - r, y])}a${r3(r)} ${r3(r)} 0 1 0 ${r3(2 * r)} 0a${r3(r)} ${r3(r)} 0 1 0 ${r3(-2 * r)} 0Z`;

// Poses, facing +x: legs [hip, knee, ankle] (the one on the +x side first) and arms [shoulder, elbow, hand].
const POSES = {
  stand: {
    legs: [[[0.18, -0.72], [0.19, -0.44], [0.19, -0.12]], [[-0.18, -0.72], [-0.19, -0.44], [-0.19, -0.12]]],
    arms: [[[0.52, -1.62], [0.62, -1.32], [0.6, -1.02]], [[-0.52, -1.62], [-0.62, -1.32], [-0.6, -1.02]]],
  },
  a: { // the stride: legs apart, arms swinging wide
    legs: [[[0.12, -0.72], [0.34, -0.48], [0.5, -0.16]], [[-0.12, -0.72], [-0.28, -0.46], [-0.5, -0.3]]],
    arms: [[[0.5, -1.62], [0.66, -1.38], [0.82, -1.52]], [[-0.5, -1.62], [-0.66, -1.4], [-0.8, -1.18]]],
  },
  b: { // the recovery: a knee driving up, the other leg under the body, arms closer
    legs: [[[0.1, -0.72], [0.42, -0.6], [0.34, -0.28]], [[-0.08, -0.72], [-0.05, -0.44], [-0.06, -0.12]]],
    arms: [[[0.52, -1.62], [0.6, -1.36], [0.66, -1.12]], [[-0.52, -1.62], [-0.62, -1.38], [-0.64, -1.12]]],
  },
};

function posePaths(pose) {
  const skin = [], socks = [], boots = [], arms = [], gloves = [];
  for (const [hip, knee, ankle] of pose.legs) {
    const top = lerp(knee, ankle, 0.22); // the sock starts just under the knee
    skin.push(limbPath([hip, knee, top], 0.2));
    socks.push(limbPath([top, ankle], 0.2));
    boots.push(bootPath(ankle));
  }
  for (const arm of pose.arms) {
    arms.push(limbPath(arm, 0.15));
    gloves.push(circlePath(arm[2], 0.11));
  }
  return { legs: skin.join(''), socks: socks.join(''), boots: boots.join(''), arms: arms.join(''), gloves: gloves.join('') };
}

const POSE_PATHS = Object.freeze(Object.fromEntries(Object.entries(POSES).map(([k, v]) => [k, Object.freeze(posePaths(v))])));

const SHIRT = 'M-0.18 -1.84Q0 -1.74 0.18 -1.84L0.5 -1.76L0.7 -1.46L0.55 -1.36L0.44 -0.9Q0 -0.86 -0.44 -0.9L-0.55 -1.36L-0.7 -1.46L-0.5 -1.76Z';
const COLLAR = 'M-0.19 -1.845L0 -1.64L0.19 -1.845L0.1 -1.85L0 -1.74L-0.1 -1.85Z';
const SHORTS = 'M-0.42 -1H0.42L0.47 -0.62H0.05L0 -0.74L-0.05 -0.62H-0.47Z';
const NECK = 'M-0.09 -1.92H0.1V-1.74H-0.09Z';

/** A point on the head's circle (degrees anticlockwise from +x, screen y down) at radius `r`. */
function onHead(deg, r) {
  const { x, y } = FIGURE.head;
  const a = (deg * Math.PI) / 180;
  return [x + r * Math.cos(a), y - r * Math.sin(a)];
}

/** Hair shapes, facing +x: the hair covers the top and the back of the head; the face side is bare (no features). */
function hairPath(style) {
  const { x, y, r } = FIGURE.head;
  const inner = (from) => `Q${pt([x - 0.05, y + 0.01])} ${pt(from)}Z`; // back from the nape to the forehead, over the ear
  const cap = (a0, a1, ro) => {
    const s = onHead(a0, ro), e = onHead(a1, ro);
    return `M${pt(s)}A${r3(ro)} ${r3(ro)} 0 1 0 ${pt(e)}${inner(s)}`;
  };
  switch (style) {
    case 'curly': { // curls: a scalloped crown, a little bigger than the head
      const ro = r + 0.09, n = 7, a0 = 20, a1 = 250;
      const pts = Array.from({ length: n + 1 }, (_, i) => onHead(a0 + ((a1 - a0) * i) / n, ro));
      let d = `M${pt(pts[0])}`;
      for (let i = 1; i < pts.length; i++) d += `A0.1 0.1 0 0 0 ${pt(pts[i])}`;
      return d + inner(pts[0]);
    }
    case 'ponytail': { // a cap, and a tail tied at the back
      const tail = `M${pt([x - 0.27, y - 0.13])}Q${pt([x - 0.66, y - 0.06])} ${pt([x - 0.5, y + 0.34])}Q${pt([x - 0.38, y + 0.12])} ${pt([x - 0.25, y + 0.03])}Z`;
      return cap(32, 232, r + 0.03) + tail;
    }
    case 'spiky': { // a short cut with a few spikes on top
      const pts = [];
      for (let i = 0, a = 28; a <= 160; i++, a += 22) pts.push(onHead(a, i % 2 ? r + 0.035 : r + 0.15));
      const e = onHead(228, r + 0.03);
      return `M${pt(onHead(24, r + 0.03))}L${pts.map(pt).join('L')}A${r3(r + 0.03)} ${r3(r + 0.03)} 0 0 0 ${pt(e)}${inner(onHead(24, r + 0.03))}`;
    }
    case 'short':
    default:
      return cap(34, 230, r + 0.035);
  }
}

const HAIR_PATHS = Object.freeze(Object.fromEntries(HAIR_STYLES.map((s) => [s, hairPath(s)])));

// ---------------------------------------------------------------- the figure as plain specs (pure)

const COLOUR_RE = /^[#\w\s(),.%-]+$/; // a colour or var(--x): nothing that could break out of a style attribute
const KIT_KEYS = Object.freeze({ shirt: '--fig-shirt', edge: '--fig-edge', ink: '--fig-ink', shorts: '--fig-shorts', socks: '--fig-socks' });

/**
 * The figure as a tree of plain shape specs { tag, attrs, children?, text? } (pure: tests read it under Node;
 * drawFigure builds it). Options as drawFigure.
 */
export function figureSpec({
  shirt, edge, ink, shorts, socks, number = null, skin = SKIN_TONES[1], hair = HAIR_COLOURS[1], hairStyle = 'short',
  gk = false, facing = 1, size = 1, base = true, run = false,
} = {}) {
  const kit = Object.entries(KIT_KEYS)
    .map(([k, prop]) => [prop, { shirt, edge, ink, shorts, socks }[k]])
    .filter(([, v]) => typeof v === 'string' && v && COLOUR_RE.test(v))
    .map(([prop, v]) => `${prop}:${v.trim()}`);
  const skinC = typeof skin === 'string' && COLOUR_RE.test(skin) ? skin : SKIN_TONES[1];
  const hairC = typeof hair === 'string' && COLOUR_RE.test(hair) ? hair : HAIR_COLOURS[1];
  const style = HAIR_STYLES.includes(hairStyle) ? hairStyle : 'short';
  const k = Number.isFinite(size) && size > 0 ? size : 1;
  const text = number === null || number === undefined ? '' : String(number);

  const pose = (name) => {
    const P = POSE_PATHS[name];
    return {
      tag: 'g', attrs: { class: `fig-pose fig-pose-${name}` }, children: [
        { tag: 'path', attrs: { class: 'fig-skin fig-legs', fill: skinC, d: P.legs } },
        { tag: 'path', attrs: { class: 'fig-socks', d: P.socks } },
        { tag: 'path', attrs: { class: 'fig-boots', d: P.boots } },
        gk ? { tag: 'path', attrs: { class: 'fig-arms fig-arms--long', d: P.arms } } : { tag: 'path', attrs: { class: 'fig-skin fig-arms', fill: skinC, d: P.arms } },
        gk ? { tag: 'path', attrs: { class: 'fig-gloves', d: P.gloves } } : null,
      ].filter(Boolean),
    };
  };

  return {
    tag: 'g',
    attrs: {
      class: `fig${gk ? ' is-gk' : ''}${facing < 0 ? ' is-facing-left' : ''}`,
      transform: k === 1 ? null : `scale(${r3(k)})`,
      style: kit.length ? kit.join(';') : null,
    },
    children: [
      base ? { tag: 'circle', attrs: { class: 'fig-base', r: 1 } } : null,
      { tag: 'ellipse', attrs: { class: 'fig-foot-shadow', cx: 0.04, cy: -0.01, rx: 0.5, ry: 0.15 } },
      {
        tag: 'g', attrs: { class: 'fig-body', transform: facing < 0 ? 'scale(-1 1)' : null }, children: [
          pose('stand'),
          run ? pose('a') : null,
          run ? pose('b') : null,
          { tag: 'path', attrs: { class: 'fig-shorts', d: SHORTS } },
          { tag: 'path', attrs: { class: 'fig-skin fig-neck', fill: skinC, d: NECK } },
          { tag: 'path', attrs: { class: 'fig-shirt', d: SHIRT } },
          { tag: 'path', attrs: { class: 'fig-collar', d: COLLAR } },
          { tag: 'circle', attrs: { class: 'fig-skin fig-head', fill: skinC, cx: FIGURE.head.x, cy: FIGURE.head.y, r: FIGURE.head.r } },
          { tag: 'path', attrs: { class: 'fig-hair', fill: hairC, 'data-style': style, d: HAIR_PATHS[style] } },
        ].filter(Boolean),
      },
      // The number is outside the mirrored body, so it always reads the right way round.
      { tag: 'text', attrs: { class: 'fig-num', x: 0, y: FIGURE.numberY, dy: '0.36em', 'text-anchor': 'middle', 'font-size': numberFontSize(text) }, text },
    ].filter(Boolean),
  };
}

const SVGNS = 'http://www.w3.org/2000/svg';

function build(doc, spec, parent) {
  const n = doc.createElementNS(SVGNS, spec.tag);
  for (const [k, v] of Object.entries(spec.attrs ?? {})) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, String(v));
  if (spec.text !== undefined) n.textContent = spec.text;
  for (const c of spec.children ?? []) build(doc, c, n);
  if (parent) parent.appendChild(n);
  return n;
}

/**
 * Draw a tabletop figure into an SVG `parent` (feet at the parent's origin).
 * @param {Element} parent
 * @param {{ shirt?: string, edge?: string, ink?: string, shorts?: string, socks?: string, number?: string|number|null,
 *   skin?: string, hair?: string, hairStyle?: 'short'|'curly'|'ponytail'|'spiky', gk?: boolean, facing?: 1|-1,
 *   size?: number, base?: boolean, run?: boolean }} [opts]
 *   kit colours: CSS colours (or var(--x)); left out, the figure takes css/figures.css's (the board's team kits)
 *   size: the base disc's radius in the parent's units (the figure is 2.4 of them tall)
 *   base: draw the base disc (the board draws its own); run: also draw the two running poses (css/figures.css
 *   shows them in turn while the token has .is-running)
 * @returns {SVGGElement}
 */
export function drawFigure(parent, opts = {}) {
  const doc = parent?.ownerDocument ?? globalThis.document;
  return build(doc, figureSpec(opts), parent ?? null);
}

/** Face a drawn figure left (-1) or right (1): the body is mirrored, the number is not. */
export function setFacing(fig, facing) {
  const body = fig?.querySelector?.('.fig-body');
  if (!body) return;
  if (facing < 0) body.setAttribute('transform', 'scale(-1 1)'); else body.removeAttribute('transform');
}
