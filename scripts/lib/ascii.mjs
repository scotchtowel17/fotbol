// ASCII pitch for terminals: check/sanity scripts and debugging.
// Pure string building (no Node APIs), canonical frame: x = 0 is our goal on the LEFT,
// "us" attack to the right, y = 0 (our left touchline) is the TOP row.
//
//   import { renderAscii, formatTable } from './lib/ascii.mjs';
//   console.log(renderAscii(frame, { marks: [{ x: 30, y: 28, ch: '*' }] }));
//
// Our players are drawn as their short code in UPPERCASE (LB, LCB, 6, 8, 9, LW...), theirs in
// lowercase; digit-only codes get a trailing prime for them (6', 8', 9'). 'o' is the ball.
// Labels that would overlap are nudged to the nearest free cells; the legend has exact values.

import { LENGTH, WIDTH, HALF_X, MID_Y, PENALTY_AREA, GOAL_AREA, GOAL_WIDTH, CIRCLE_RADIUS } from '../../js/engine/pitch.js';
import { ROLES, ROLE_INFO } from '../../js/engine/roles.js';

export const ASCII_DEFAULTS = Object.freeze({
  cols: 71, // [D] cells along x: 105 m / 70 steps = 1.5 m per column (odd, so halfway is a column)
  rows: 23, // [D] cells along y: 68 m / 22 steps = 3.09 m per row (odd, so y = 34 is a row)
  maxNudge: 4, // [D] how far (cells) a label may move sideways to avoid another label
});

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const fmt = (p) => (p ? `(${f2(p.x).padStart(6)}, ${f2(p.y).padStart(5)})` : '');

/** Grid label for a player: 'LCB' / 'lcb', '6' / "6'". */
export function labelOf(p) {
  const short = ROLE_INFO[p.role]?.short ?? p.role ?? p.id ?? '?';
  if (p.team !== 'them') return short.toUpperCase();
  return /[a-z]/i.test(short) ? short.toLowerCase() : `${short}'`;
}

/**
 * Exact positions as a fixed-width table: one row per role with both teams side by side,
 * then any players whose role is not a standard one.
 * @param {import('../../js/engine/types.js').Frame} frame
 * @returns {string}
 */
export function formatTable(frame) {
  const players = frame.players ?? [];
  const lines = [];
  const head = [`ball ${fmt(frame.ball)}`];
  if (frame.possession) head.push(`possession: ${frame.possession}`);
  if (frame.carrierId !== undefined) head.push(`carrier: ${frame.carrierId ?? '-'}`);
  lines.push(head.join('   '));
  lines.push(`${'role'.padEnd(5)}${'label'.padEnd(9)}${'us'.padEnd(18)}them`);
  const byKey = new Map(players.map((p) => [`${p.team}:${p.role}`, p]));
  const standard = ROLES.filter((r) => byKey.has(`us:${r}`) || byKey.has(`them:${r}`));
  for (const r of standard) {
    const us = byKey.get(`us:${r}`), them = byKey.get(`them:${r}`);
    const label = `${us ? labelOf(us) : ''}${us && them ? '/' : ''}${them ? labelOf(them) : ''}`;
    lines.push(`${r.padEnd(5)}${label.padEnd(9)}${fmt(us).padEnd(18)}${fmt(them)}`.trimEnd());
  }
  for (const p of players.filter((q) => !ROLES.includes(q.role))) lines.push(`${String(p.id).padEnd(14)}${fmt(p)}`);
  return lines.join('\n');
}

/**
 * Render a frame as an ASCII pitch (about 1.5 m per column, 3 m per row).
 * @param {import('../../js/engine/types.js').Frame} frame  any subset of players is fine
 * @param {{ marks?: {x:number, y:number, ch?:string, label?:string}[], legend?: boolean }} [opts]
 *   marks: extra single-character markers, e.g. { x, y, ch: '*' } for a ghost; `label` goes in the legend
 * @returns {string}
 */
export function renderAscii(frame, { marks = [], legend = true } = {}) {
  const { cols: C, rows: R, maxNudge } = ASCII_DEFAULTS;
  const col = (x) => Math.round((Math.min(Math.max(x, 0), LENGTH) / LENGTH) * (C - 1));
  const row = (y) => Math.round((Math.min(Math.max(y, 0), WIDTH) / WIDTH) * (R - 1));
  const grid = Array.from({ length: R }, () => Array(C).fill(' '));
  const taken = Array.from({ length: R }, () => Array(C).fill(false));
  const put = (r, c, ch) => { if (r >= 0 && r < R && c >= 0 && c < C) grid[r][c] = ch; };

  // Pitch markings (may be overwritten by players).
  const hc = col(HALF_X);
  for (let r = 0; r < R; r++) put(r, hc, ':');
  for (let a = 0; a < 360; a += 4) {
    const r = row(MID_Y + CIRCLE_RADIUS * Math.sin((a * Math.PI) / 180)), c = col(HALF_X + CIRCLE_RADIUS * Math.cos((a * Math.PI) / 180));
    if (grid[r][c] === ' ') put(r, c, '.');
  }
  const box = (depth, width) => {
    const r0 = row(MID_Y - width / 2), r1 = row(MID_Y + width / 2);
    for (const [cEdge, cGoal] of [[col(depth), 0], [col(LENGTH - depth), C - 1]]) {
      const [lo, hi] = cEdge < cGoal ? [cEdge, cGoal] : [cGoal, cEdge];
      for (let c = lo; c <= hi; c++) { put(r0, c, '-'); put(r1, c, '-'); }
      for (let r = r0; r <= r1; r++) put(r, cEdge, '|');
      put(r0, cEdge, '+'); put(r1, cEdge, '+');
    }
  };
  box(PENALTY_AREA.depth, PENALTY_AREA.width);
  box(GOAL_AREA.depth, GOAL_AREA.width);

  // Place a label centred on (x, y), nudging sideways (then one row up/down) around taken cells.
  const place = (x, y, text) => {
    const r0 = row(y), c0 = col(x) - Math.floor((text.length - 1) / 2);
    const shifts = [0];
    for (let k = 1; k <= maxNudge; k++) shifts.push(k, -k);
    for (const dr of [0, -1, 1]) {
      for (const dc of shifts) {
        const r = r0 + dr, c = Math.min(Math.max(c0 + dc, 0), C - text.length);
        if (r < 0 || r >= R) continue;
        let free = true; // keep one blank cell either side so neighbouring labels stay readable
        for (let i = -1; i <= text.length; i++) if (taken[r][c + i]) { free = false; break; }
        if (!free) continue;
        for (let i = 0; i < text.length; i++) { grid[r][c + i] = text[i]; taken[r][c + i] = true; }
        return;
      }
    }
    const c = Math.min(Math.max(c0, 0), C - text.length); // no room: overwrite
    for (let i = 0; i < text.length; i++) grid[r0][c + i] = text[i];
  };

  if (frame.ball) place(frame.ball.x, frame.ball.y, 'o');
  for (const m of marks) place(m.x, m.y, (m.ch ?? '*').slice(0, 1));
  const players = frame.players ?? [];
  for (const team of ['us', 'them']) for (const p of players.filter((q) => (q.team === 'them') === (team === 'them'))) place(p.x, p.y, labelOf(p));

  // Frame: x ticks, touchlines, goal lines, goals, y gutter.
  const gutter = 4;
  const goalRows = new Set();
  for (let r = row(MID_Y - GOAL_WIDTH / 2); r <= row(MID_Y + GOAL_WIDTH / 2); r++) goalRows.add(r);
  const ticks = Array(C + 4).fill(' ');
  for (let x = 0; x <= LENGTH; x += 15) {
    const s = String(x), c = Math.min(col(x) + 2 - Math.floor((s.length - 1) / 2), ticks.length - s.length);
    for (let i = 0; i < s.length; i++) ticks[c + i] = s[i];
  }
  const out = [];
  out.push(`${' '.repeat(gutter)}${ticks.join('').trimEnd()}`);
  out.push(`${' '.repeat(gutter)} +${'-'.repeat(C)}+`);
  for (let r = 0; r < R; r++) {
    const y = String(Math.round((r / (R - 1)) * WIDTH)).padStart(gutter - 1);
    const g = goalRows.has(r) ? '#' : ' ';
    out.push(`${y} ${g}|${grid[r].join('')}|${g}`.trimEnd());
  }
  out.push(`${' '.repeat(gutter)} +${'-'.repeat(C)}+`);
  if (legend) {
    out.push(`UPPER = us (attack ->), lower/primed = them, o = ball; x across (m), y down (m, 0 = our left)`);
    out.push(formatTable(frame));
    for (const m of marks) out.push(`mark ${(m.ch ?? '*').slice(0, 1)} ${fmt(m)}${m.label ? `  ${m.label}` : ''}`);
  }
  return out.join('\n');
}
