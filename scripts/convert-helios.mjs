#!/usr/bin/env node
// Convert HELIOS Base's normal-play formation into data/formations/helios-433.json,
// audit it for tactically implausible shapes, and apply the minimal documented edits.
//
//   node scripts/convert-helios.mjs                      # fetch the file from GitHub
//   node scripts/convert-helios.mjs path/to/normal-formation.conf
//
// Deterministic: the same input always gives a byte-identical output file.
//
// Conversion (docs/ARCHITECTURE.md §3, RESEARCH.md §5.2): x = x_h + 52.5, y = y_h + 34,
// rounded to 0.01 m. NO y flip: HELIOS "L" roles sit at negative y, i.e. small y after the
// shift, which is our left (checked on samples 0, 13 and 33: with the ball on the negative-y
// wing the L winger and L #8 are the players nearest it). The script asserts this on every
// sample. Only the data file is used; HELIOS's C++ sources (GPL/LGPL headers) are not.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HELIOS_ROLE, ROLES, ROLE_INFO, mirrorRole } from '../js/engine/roles.js';
import { HALF_X, MID_Y, onPitch } from '../js/engine/pitch.js';

export const SOURCE = Object.freeze({
  name: 'HELIOS Base',
  repo: 'https://github.com/helios-base/helios-base',
  file: 'src/formations-dt/normal-formation.conf',
  url: 'https://raw.githubusercontent.com/helios-base/helios-base/master/src/formations-dt/normal-formation.conf',
  // Last commit that changed the file (GitHub API, checked 2026-09-27; unchanged at master 66fd63d6, 2025-10-05).
  commit: '538d9a72ec8c2709059f6c728293955723730141',
  blob: 'ac1e9d99ce185c64e5368f48dd4da0e15a303a33', // git blob SHA-1 of that file; `commit` is written only if the input matches
  license: 'MIT',
  copyright: 'Copyright (c) 2021 HELIOS Base: A base team for the RoboCup Soccer Simulation',
});

const MIT_PERMISSION = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
];

export const AUDIT_DEFAULTS = Object.freeze({
  maxFarFullBackLead: 4, // [D] m the far-side FB may stand ahead of the near-side FB (edit above this)
  sideMargin: 2, // [D] m: with the ball within this of y = 34 neither side is "near", so no FB edit
  fullBackBehindCBs: 8, // [D] m: flag (not edit) a FB this far behind both CBs
  flagWingerInsideCM: true, // info only: a winger narrower than the #8 on its side (legitimate when the far winger attacks the box)
});

const round2 = (v) => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0
const pt = (p) => ({ x: p.x, y: p.y });

/**
 * Convert the HELIOS JSON text to a formation table (canonical frame, no edits yet).
 * @param {string} text  contents of normal-formation.conf
 * @returns {{ table: object, blob: string }}
 */
export function convert(text) {
  const src = JSON.parse(text);
  if (src.method !== 'DelaunayTriangulation') throw new Error(`unexpected method ${src.method}`);
  const blob = createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
  const samples = src.data.map((d, i) => {
    if (d.index !== i) throw new Error(`sample ${i} has index ${d.index}; expected samples in index order`);
    const pos = {};
    for (const role of ROLES) pos[role] = null;
    for (const [num, role] of Object.entries(HELIOS_ROLE)) {
      const p = d[num];
      if (!p) throw new Error(`sample ${i} lacks role ${num}`);
      pos[role] = { x: round2(p.x + HALF_X), y: round2(p.y + MID_Y) };
    }
    return { ball: { x: round2(d.ball.x + HALF_X), y: round2(d.ball.y + MID_Y) }, pos };
  });
  // Orientation guard: every L role must be at smaller y than its R partner on average.
  for (const [i, s] of samples.entries()) {
    const ys = (side) => ROLES.filter((r) => ROLE_INFO[r].side === side).reduce((a, r) => a + s.pos[r].y, 0);
    if (!(ys('L') < ys('R'))) throw new Error(`sample ${i}: L roles are not on the small-y side; check the y convention`);
  }
  const known = blob === SOURCE.blob;
  const source = {
    name: SOURCE.name,
    repo: SOURCE.repo,
    file: SOURCE.file,
    url: SOURCE.url,
    commit: known ? SOURCE.commit : null,
    blob,
    license: SOURCE.license,
    copyright: SOURCE.copyright,
    licenseText: [SOURCE.copyright, ...MIT_PERMISSION].join('\n\n'),
    attribution: 'Formation samples derived from HELIOS Base (https://github.com/helios-base/helios-base), MIT License, Copyright (c) 2021 HELIOS Base. Converted to app coordinates and edited.',
    note: 'Only this data file is used. The HELIOS C++ sources carry GPL/LGPL headers and no code from them is used; the interpolation in js/engine/formation.js is written from scratch after Akiyama and Noda (2008).',
    conversion: 'x = x_h + 52.5, y = y_h + 34 (no y flip: HELIOS L roles are at negative y = our left); roles via HELIOS_ROLE in js/engine/roles.js; rounded to 0.01 m; samples[i] is HELIOS sample index i. Ball points outside the pitch are kept: they make the triangulation cover the whole pitch.',
    generatedBy: 'scripts/convert-helios.mjs',
  };
  const table = {
    id: 'helios-433',
    name: 'HELIOS Base 4-3-3 (normal play)',
    shape: '4-3-3',
    frame: 'canonical',
    source,
    roles: [...ROLES],
    edits: [],
    samples,
  };
  return { table, blob };
}

/** Which side the ball is on (for near/far roles), or null when it is central. */
function ballSide(s, P) {
  const off = s.ball.y - MID_Y;
  return Math.abs(off) < P.sideMargin ? null : off < 0 ? 'L' : 'R';
}

const LATERAL_ORDERS = [
  ['back line LB < LCB < RCB < RB', ['LB', 'LCB', 'RCB', 'RB']],
  ['#8s LCM < RCM', ['LCM', 'RCM']],
  ['wingers LW < RW', ['LW', 'RW']],
];

/**
 * Audit a table for tactically implausible shapes. Pure: returns findings, edits nothing.
 * @returns {Object<string, string[]>} check name → one line per offending sample
 */
export function audit(table, params = {}) {
  const P = { ...AUDIT_DEFAULTS, ...params };
  const out = {};
  const flag = (name, i, s, msg) => (out[name] ??= []).push(`#${i} ball (${s.ball.x}, ${s.ball.y}): ${msg}`);
  for (const name of [...LATERAL_ORDERS.map((o) => o[0]), 'player off the pitch', `FB > ${P.fullBackBehindCBs} m behind both CBs`,
    `far FB > ${P.maxFarFullBackLead} m ahead of near FB`, 'centre-line sample not symmetric', 'no mirror sample', 'mirror sample not symmetric',
    'info: winger inside the #8 on its side']) out[name] = [];
  const key = (b) => `${b.x},${b.y}`;
  const byBall = new Map(table.samples.map((s, i) => [key(s.ball), i]));

  table.samples.forEach((s, i) => {
    const p = s.pos;
    for (const [name, order] of LATERAL_ORDERS) {
      for (let k = 1; k < order.length; k++) {
        if (!(p[order[k - 1]].y < p[order[k]].y)) flag(name, i, s, `${order[k - 1]}.y ${p[order[k - 1]].y} >= ${order[k]}.y ${p[order[k]].y}`);
      }
    }
    for (const r of table.roles) if (!onPitch(p[r])) flag('player off the pitch', i, s, `${r} (${p[r].x}, ${p[r].y})`);
    const cbMin = Math.min(p.LCB.x, p.RCB.x);
    for (const fb of ['LB', 'RB']) {
      if (p[fb].x < cbMin - P.fullBackBehindCBs) flag(`FB > ${P.fullBackBehindCBs} m behind both CBs`, i, s, `${fb}.x ${p[fb].x}, CBs ${p.LCB.x}/${p.RCB.x}`);
    }
    const side = ballSide(s, P);
    if (side) {
      const near = side === 'L' ? 'LB' : 'RB', far = mirrorRole(near);
      const lead = round2(p[far].x - p[near].x);
      if (lead > P.maxFarFullBackLead) flag(`far FB > ${P.maxFarFullBackLead} m ahead of near FB`, i, s, `${far} ${lead} m ahead of ${near}`);
    }
    if (P.flagWingerInsideCM) {
      if (p.LW.y > p.LCM.y) flag('info: winger inside the #8 on its side', i, s, `LW.y ${p.LW.y} > LCM.y ${p.LCM.y}`);
      if (p.RW.y < p.RCM.y) flag('info: winger inside the #8 on its side', i, s, `RW.y ${p.RW.y} < RCM.y ${p.RCM.y}`);
    }
    // Left-right symmetry: the table should equal its own mirror image (y -> 68 - y, L <-> R).
    const m = byBall.get(key({ x: s.ball.x, y: round2(2 * MID_Y - s.ball.y) }));
    if (m === undefined) { flag('no mirror sample', i, s, 'no sample at the mirrored ball point'); return; }
    const q = table.samples[m].pos;
    const asym = table.roles.filter((r) => q[mirrorRole(r)].x !== p[r].x || round2(2 * MID_Y - q[mirrorRole(r)].y) !== p[r].y);
    if (asym.length) flag(m === i ? 'centre-line sample not symmetric' : 'mirror sample not symmetric', i, s, `${asym.join(', ')} (mirror #${m})`);
  });
  return out;
}

/**
 * Apply the minimal edits (mutates `table`, appends to table.edits). Two rules:
 *  1. centre-symmetry: with the ball on the centre line, central roles stand on y = 34
 *     (HELIOS has the #6 and #9 up to 4.6 m off-centre there, while every other sample
 *     comes in exact mirror pairs; the offsets are authoring noise and break left/right
 *     mirroring of scenarios).
 *  2. far-full-back-lead: with the ball on one side, the far-side FB may be at most
 *     maxFarFullBackLead ahead of the near-side FB; beyond that its x is pulled back to that
 *     limit (y kept). RESEARCH 5.2 known issue (ball at HELIOS (44.5, 22.4)); principles R2
 *     (far FB tucks in and stays level), U4 (level line) and U5 (near FB engages).
 * @returns {object[]} the edits made
 */
export function applyEdits(table, params = {}) {
  const P = { ...AUDIT_DEFAULTS, ...params };
  const edits = [];
  const edit = (i, role, after, rule, reason) => {
    const before = pt(table.samples[i].pos[role]);
    table.samples[i].pos[role] = after;
    edits.push({ sample: i, role, rule, before, after: pt(after), reason });
  };
  table.samples.forEach((s, i) => {
    if (s.ball.y === MID_Y) {
      for (const r of table.roles) {
        if (ROLE_INFO[r].side === 'C' && s.pos[r].y !== MID_Y) {
          edit(i, r, { x: s.pos[r].x, y: MID_Y }, 'centre-symmetry', `ball on the centre line: a central role stands on y = 34 (was ${round2(s.pos[r].y - MID_Y)} m off-centre); makes the table exactly left/right symmetric`);
        }
      }
    }
    const side = ballSide(s, P);
    if (!side) return;
    const near = side === 'L' ? 'LB' : 'RB', far = mirrorRole(near);
    const lead = round2(s.pos[far].x - s.pos[near].x);
    if (lead > P.maxFarFullBackLead) {
      edit(i, far, { x: round2(s.pos[near].x + P.maxFarFullBackLead), y: s.pos[far].y }, 'far-full-back-lead',
        `far-side full-back stood ${lead} m ahead of the near-side ${near}; pulled back to ${P.maxFarFullBackLead} m ahead (RESEARCH 5.2 known issue; R2, U4, U5)`);
    }
  });
  table.edits.push(...edits);
  return edits;
}

/** Stable, diff-friendly JSON: one sample / edit per line, fixed key order. */
export function serialize(table) {
  const j = (v) => JSON.stringify(v);
  const pos = (p) => `{${ROLES.filter((r) => p[r]).map((r) => `${j(r)}:${j(pt(p[r]))}`).join(',')}}`;
  const lines = ['{'];
  for (const k of ['id', 'name', 'shape', 'frame']) lines.push(`  ${j(k)}: ${j(table[k])},`);
  lines.push(`  "source": ${JSON.stringify(table.source, null, 2).replace(/\n/g, '\n  ')},`);
  lines.push(`  "roles": ${j(table.roles)},`);
  lines.push('  "edits": [');
  table.edits.forEach((e, i) => lines.push(`    ${j({ sample: e.sample, role: e.role, rule: e.rule, before: e.before, after: e.after, reason: e.reason })}${i < table.edits.length - 1 ? ',' : ''}`));
  lines.push('  ],');
  lines.push('  "samples": [');
  table.samples.forEach((s, i) => lines.push(`    {"ball":${j(pt(s.ball))},"pos":${pos(s.pos)}}${i < table.samples.length - 1 ? ',' : ''}`));
  lines.push('  ]');
  lines.push('}');
  return lines.join('\n') + '\n';
}

function report(title, findings) {
  const rows = Object.entries(findings).map(([k, v]) => `  ${String(v.length).padStart(3)}  ${k}`);
  return `${title}\n${rows.join('\n')}`;
}

async function main() {
  const arg = process.argv[2];
  let text;
  if (arg) text = await readFile(arg, 'utf8');
  else {
    const res = await fetch(SOURCE.url);
    if (!res.ok) throw new Error(`fetch ${SOURCE.url}: ${res.status}`);
    text = await res.text();
  }
  const { table, blob } = convert(text);
  if (blob !== SOURCE.blob) console.warn(`warning: input blob ${blob} differs from the audited file ${SOURCE.blob}; "commit" left null. Re-check the audit.`);
  const before = audit(table);
  const edits = applyEdits(table);
  const after = audit(table);
  const outUrl = new URL('../data/formations/helios-433.json', import.meta.url);
  await writeFile(outUrl, serialize(table));

  console.log(`${table.samples.length} samples converted from ${arg ?? SOURCE.url}`);
  console.log(report('audit before edits (samples flagged):', before));
  const byRule = edits.reduce((m, e) => ((m[e.rule] = (m[e.rule] ?? 0) + 1), m), {});
  console.log(`edits: ${edits.length} (${Object.entries(byRule).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  for (const e of edits) console.log(`  #${e.sample} ${e.role}: (${e.before.x}, ${e.before.y}) -> (${e.after.x}, ${e.after.y})  [${e.rule}]`);
  console.log(report('audit after edits:', after));
  console.log(`wrote ${fileURLToPath(outUrl)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
