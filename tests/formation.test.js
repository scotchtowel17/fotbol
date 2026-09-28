import { test, assert, approx, loadJSON, isNode } from './harness.js';
import { createFormation, teamTargets, linearTarget, phaseShape, widthDuty, POSSESSION_OFFSET, FORMATION_DEFAULTS, SHAPE_DEFAULTS } from '../js/engine/formation.js';
import { TUCK_DEFAULTS } from '../js/engine/rules/tuck.js';
import { ROLES, ROLE_INFO, BACK_LINE, MIDFIELD, mirrorRole } from '../js/engine/roles.js';
import { LENGTH, WIDTH, MID_Y, mirrorPoint, flipY, onPitch } from '../js/engine/pitch.js';
import { median, clamp } from '../js/engine/geometry.js';
import { CONTEXT_DEFAULTS } from '../js/engine/context.js';

const table = await loadJSON('data/formations/helios-433.json');
const f = createFormation(table);

const onPitchBall = (b) => b.x >= 0 && b.x <= LENGTH && b.y >= 0 && b.y <= WIDTH;
const range = (lo, hi, step) => { const out = []; for (let v = lo; v < hi - 1e-9; v += step) out.push(v); out.push(hi); return out; };
const GRID_X = range(0, LENGTH, 3), GRID_Y = range(0, WIDTH, 3);
const grid = GRID_X.flatMap((x) => GRID_Y.map((y) => ({ x, y })));
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------- the data file

test('helios-433 table: shape, roles, attribution', () => {
  assert.equal(table.id, 'helios-433');
  assert.equal(table.frame, 'canonical');
  assert.deepEqual(table.roles, [...ROLES]);
  assert.equal(table.samples.length, 115);
  for (const s of table.samples) for (const r of ROLES) assert.ok(Number.isFinite(s.pos[r].x) && Number.isFinite(s.pos[r].y));
  assert.equal(table.source.license, 'MIT');
  assert.match(table.source.commit, /^[0-9a-f]{40}$/);
  assert.match(table.source.licenseText, /Copyright \(c\) 2021 HELIOS Base/);
  assert.match(table.source.attribution, /helios-base/);
});

test('every recorded edit is what the table holds', () => {
  assert.ok(table.edits.length > 0);
  for (const e of table.edits) {
    const p = table.samples[e.sample].pos[e.role];
    assert.deepEqual({ x: p.x, y: p.y }, e.after, `edit #${e.sample} ${e.role}`);
    assert.ok(e.before.x !== e.after.x || e.before.y !== e.after.y, 'an edit changes something');
    assert.ok(['far-full-back-lead', 'centre-symmetry'].includes(e.rule), e.rule);
    assert.ok(e.reason.length > 20);
  }
});

test('HELIOS L roles are on our left (no y flip): LB/LW/LCM at small y when the ball is on the left wing', () => {
  // HELIOS sample 0: ball in the (-y) attacking corner -> our frame (107, -2).
  const s = table.samples[0];
  assert.deepEqual(s.ball, { x: 107, y: -2 });
  for (const r of ['LB', 'LCM', 'LW']) assert.ok(s.pos[r].y < 10, `${r}.y ${s.pos[r].y}`);
  for (const r of ['RB', 'RCM', 'RW']) assert.ok(s.pos[r].y > 30, `${r}.y ${s.pos[r].y}`);
});

test('the known odd sample is fixed: near-side RB no longer far behind the far-side LB', () => {
  // RESEARCH 5.2: HELIOS ball (44.53, 22.41) -> our (97.03, 56.41).
  const i = table.samples.findIndex((s) => s.ball.x === 97.03 && s.ball.y === 56.41);
  assert.ok(i >= 0);
  const p = table.samples[i].pos;
  assert.ok(p.LB.x - p.RB.x <= 4 + 1e-9, `LB ${p.LB.x} vs RB ${p.RB.x}`);
  assert.ok(table.edits.some((e) => e.sample === i && e.role === 'LB'));
});

test('audit rule holds at every sample: far-side FB at most 4 m ahead of the near-side FB', () => {
  for (const s of table.samples) {
    if (Math.abs(s.ball.y - MID_Y) < 2) continue;
    const [near, far] = s.ball.y < MID_Y ? ['LB', 'RB'] : ['RB', 'LB'];
    assert.ok(s.pos[far].x - s.pos[near].x <= 4 + 1e-9, `ball (${s.ball.x}, ${s.ball.y})`);
  }
});

test('table is exactly left/right symmetric (every sample has a mirror sample)', () => {
  const key = (b) => `${b.x},${b.y}`;
  const byBall = new Map(table.samples.map((s) => [key(s.ball), s]));
  for (const s of table.samples) {
    const m = byBall.get(key({ x: s.ball.x, y: Math.round((WIDTH - s.ball.y) * 100) / 100 }));
    assert.ok(m, `mirror of (${s.ball.x}, ${s.ball.y})`);
    for (const r of ROLES) {
      approx(m.pos[mirrorRole(r)].x, s.pos[r].x, 1e-9);
      approx(m.pos[mirrorRole(r)].y, WIDTH - s.pos[r].y, 1e-9);
    }
  }
});

// ---------------------------------------------------------------- interpolation

test('triangulation covers the pitch with the HELIOS samples', () => {
  assert.ok(f.triangles instanceof Uint32Array);
  assert.equal(f.triangles.length % 3, 0);
  assert.ok(f.triangles.length / 3 >= 200, `${f.triangles.length / 3} triangles`);
  for (const c of [{ x: 0, y: 0 }, { x: 105, y: 0 }, { x: 0, y: 68 }, { x: 105, y: 68 }]) assert.ok(f.locate(c).inside, JSON.stringify(c));
});

test('positions() reproduces every on-pitch sample exactly at its ball point', () => {
  let n = 0;
  for (const s of table.samples) {
    if (!onPitchBall(s.ball)) continue;
    n++;
    const p = f.positions(s.ball);
    for (const r of ROLES) { approx(p[r].x, s.pos[r].x, 1e-9); approx(p[r].y, s.pos[r].y, 1e-9); }
  }
  assert.ok(n >= 100, `${n} on-pitch samples`);
});

test('off-pitch samples (corners, touchlines) stay close after the ball is clamped', () => {
  for (const s of table.samples.filter((q) => !onPitchBall(q.ball))) {
    const p = f.positions(s.ball);
    for (const r of ROLES) assert.ok(d(p[r], s.pos[r]) < 2, `ball (${s.ball.x}, ${s.ball.y}) ${r}`);
  }
});

test('ball is clamped to the pitch', () => {
  assert.deepEqual(f.positions({ x: -30, y: 90 }), f.positions({ x: 0, y: 68 }));
  assert.deepEqual(f.locate({ x: 200, y: 34 }).ball, { x: 105, y: 34 });
  assert.throws(() => f.positions({ x: NaN, y: 3 }));
});

test('continuity: a 0.5 m ball move never moves a player more than 1.6 m, and >= 99.5% of moves <= 1 m', () => {
  // The few > 1 m moves sit in thin triangles along the touchlines: the far #8 surging forward
  // as the ball crosses halfway on the wing, and the CBs shifting as it runs along our own
  // touchline. Both are legitimate HELIOS behaviours that are steep because samples are sparse there.
  let max = 0, over = 0, total = 0;
  const dirs = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => ({ x: 0.5 * Math.cos((a * Math.PI) / 180), y: 0.5 * Math.sin((a * Math.PI) / 180) }));
  for (let x = 0; x <= LENGTH; x += 1) {
    for (let y = 0; y <= WIDTH; y += 1) {
      const a = f.positions({ x, y });
      for (const v of dirs) {
        const b2 = { x: x + v.x, y: y + v.y };
        if (!onPitchBall(b2)) continue;
        const b = f.positions(b2);
        for (const r of ROLES) {
          const m = d(a[r], b[r]);
          total++;
          if (m > 1) over++;
          if (m > max) max = m;
        }
      }
    }
  }
  assert.ok(max <= 1.6, `max move ${max.toFixed(2)} m`);
  assert.ok(over / total <= 0.005, `${over} of ${total} role-moves over 1 m`);
});

test('invariants on a 3 m ball grid: back-line order, full-backs on their side, #8s and wingers ordered, on the pitch', () => {
  for (const b of grid) {
    const p = f.positions(b);
    const at = `ball (${b.x}, ${b.y})`;
    assert.ok(p.LB.y < MID_Y && MID_Y < p.RB.y, `LB/RB sides at ${at}`);
    assert.ok(p.LB.y < p.LCB.y && p.LCB.y < p.RCB.y && p.RCB.y < p.RB.y, `back line order at ${at}`);
    assert.ok(p.LCM.y < p.RCM.y, `#8 order at ${at}`);
    assert.ok(p.LW.y < p.RW.y, `winger order at ${at}`);
    for (const r of ROLES) assert.ok(onPitch(p[r]), `${r} on pitch at ${at}`);
  }
});

test('#9 x never decreases as the ball moves forward (y = 10, 34, 58)', () => {
  for (const y of [10, 34, 58]) {
    let prev = -Infinity;
    for (let x = 0; x <= LENGTH; x += 0.5) {
      const st = f.positions({ x, y }).ST.x;
      assert.ok(st >= prev - 0.05, `ST.x ${st} < ${prev} at (${x}, ${y})`);
      prev = st;
    }
  }
});

test('interpolation is left/right symmetric', () => {
  for (const b of grid) {
    const p = f.positions(b), q = f.positions({ x: b.x, y: WIDTH - b.y });
    for (const r of ROLES) {
      approx(q[mirrorRole(r)].x, p[r].x, 1e-6);
      approx(q[mirrorRole(r)].y, WIDTH - p[r].y, 1e-6);
    }
  }
});

test('the cached triangle never changes the answer', () => {
  const balls = [{ x: 3, y: 3 }, { x: 100, y: 60 }, { x: 52.5, y: 34 }, { x: 97.03, y: 56.41 }, { x: 10, y: 65 }, { x: 104, y: 1 }];
  const fresh = (b) => createFormation(table).positions(b);
  for (let k = 0; k < 3; k++) {
    for (const b of balls) {
      const p = f.positions(b), q = fresh(b);
      for (const r of ROLES) { approx(p[r].x, q[r].x, 1e-9); approx(p[r].y, q[r].y, 1e-9); }
    }
  }
});

test('performance: positions() averages under 20 microseconds', () => {
  const balls = Array.from({ length: 10000 }, (_, i) => ({ x: (i * 7.31) % LENGTH, y: (i * 3.77) % WIDTH }));
  for (let i = 0; i < 2000; i++) f.positions(balls[i]); // warm up the JIT
  const t0 = performance.now();
  for (const b of balls) f.positions(b);
  const us = ((performance.now() - t0) * 1000) / balls.length;
  assert.ok(us < 20, `${us.toFixed(2)} us per call`);
});

// ---------------------------------------------------------------- teamTargets

test("teamTargets('them') mirrors the table through the centre spot", () => {
  for (const b of grid) {
    for (const inPossession of [true, false]) {
      const them = teamTargets(f, 'them', b, { inPossession });
      const us = teamTargets(f, 'us', mirrorPoint(b), { inPossession });
      for (const r of ROLES) {
        const m = mirrorPoint(us[r]);
        approx(them[r].x, m.x, 1e-9);
        approx(them[r].y, m.y, 1e-9);
      }
    }
  }
  const them = teamTargets(f, 'them', { x: 52.5, y: 34 });
  assert.ok(them.LB.y > MID_Y && them.RB.y < MID_Y, 'their left back is at large y (their left)');
  assert.ok(them.GK.x > 100);
});

test("teamTargets('us') equals positions() without the offset", () => {
  const b = { x: 61, y: 22 };
  assert.deepEqual(teamTargets(f, 'us', b, { offset: false }), f.positions(b));
});

test('possession offset moves outfield roles along the attacking direction, never the GK', () => {
  const b = { x: 52.5, y: 34 }; // every outfield target is well inside the pitch here
  for (const [team, sign] of [['us', 1], ['them', -1]]) {
    const base = teamTargets(f, team, b, { offset: false });
    const withBall = teamTargets(f, team, b, { inPossession: true, shape: false });
    const without = teamTargets(f, team, b, { inPossession: false, shape: false });
    for (const r of ROLES) {
      const k = r === 'GK' ? 0 : 1;
      approx(withBall[r].x - base[r].x, sign * k * POSSESSION_OFFSET.with, 1e-9, `${team} ${r} with`);
      approx(without[r].x - base[r].x, sign * k * POSSESSION_OFFSET.without, 1e-9, `${team} ${r} without`);
      approx(withBall[r].y, base[r].y, 1e-9);
    }
  }
});

test('teamTargets keeps every target on the pitch for both teams and phases', () => {
  for (const b of grid) {
    for (const team of ['us', 'them']) {
      for (const inPossession of [true, false]) {
        const t = teamTargets(f, team, b, { inPossession });
        for (const r of ROLES) assert.ok(onPitch(t[r]), `${team} ${r} at (${b.x}, ${b.y})`);
      }
    }
  }
});

test('the offset fades near the goal lines and never reorders players in depth', () => {
  const taper = FORMATION_DEFAULTS.offsetTaper;
  assert.ok(taper > Math.max(POSSESSION_OFFSET.with, -POSSESSION_OFFSET.without));
  // Ball at our byline, them in possession: our back line is not pushed onto the goal line.
  const deep = { x: 3, y: 30 };
  const raw = f.positions(deep), t = teamTargets(f, 'us', deep, { inPossession: false, shape: false });
  for (const r of ['LB', 'LCB', 'RCB', 'RB']) {
    approx(t[r].x, raw[r].x * (1 + POSSESSION_OFFSET.without / taper), 1e-9, r);
    assert.ok(t[r].x > 2, `${r} at ${t[r].x.toFixed(2)} m`);
  }
  // Attacking end: HELIOS sample 13 has the LW at x ~100; +6 would put it on the goal line.
  const high = teamTargets(f, 'us', { x: 105, y: 16.9 }, { inPossession: true, shape: false });
  assert.ok(high.LW.x < LENGTH - 2, `LW at ${high.LW.x.toFixed(2)}`);
  // Order in depth is preserved for every pair of outfield players, both phases.
  for (const b of grid) {
    for (const inPossession of [true, false]) {
      const base = f.positions(b), q = teamTargets(f, 'us', b, { inPossession, shape: false });
      const out = ROLES.filter((r) => r !== 'GK');
      for (const a of out) for (const c of out) if (base[a].x < base[c].x - 1e-9) assert.ok(q[a].x <= q[c].x + 1e-9, `${a}/${c} at (${b.x}, ${b.y})`);
    }
  }
});

// ---------------------------------------------------------------- phase shape

const spread = (t, roles) => Math.max(...roles.map((r) => t[r].x)) - Math.min(...roles.map((r) => t[r].x));
const lineGap = (t) => median(MIDFIELD.map((r) => t[r].x)) - median(BACK_LINE.map((r) => t[r].x));

test('phase shape is on by default whenever there is a possession offset, and off with shape: false', () => {
  const b = { x: 70, y: 20 };
  for (const inPossession of [true, false]) {
    const raw = teamTargets(f, 'us', b, { inPossession, shape: false });
    const shaped = teamTargets(f, 'us', b, { inPossession });
    const expected = phaseShape(structuredClone(raw), b, { inPossession });
    for (const r of ROLES) {
      approx(shaped[r].x, expected[r].x, 1e-9, `${r} x`);
      approx(shaped[r].y, expected[r].y, 1e-9, `${r} y`);
    }
  }
  assert.deepEqual(teamTargets(f, 'us', b, { offset: false }), f.positions(b), 'no offset: no shape (previews)');
  const loose = teamTargets(f, 'us', b, { offset: false, shape: true });
  assert.ok(spread(loose, BACK_LINE) < spread(f.positions(b), BACK_LINE), 'a loose ball can ask for the defending shape');
});

test('out of possession: a level back four within 15 m of the midfield (or at the height cap, with the midfield dropping to it)', () => {
  const P = SHAPE_DEFAULTS;
  for (const b of grid) {
    const raw = teamTargets(f, 'us', b, { inPossession: false, shape: false });
    const t = teamTargets(f, 'us', b, { inPossession: false });
    const at = `ball (${b.x}, ${b.y})`;
    approx(spread(t, BACK_LINE), (1 - P.levelBackLine) * spread(raw, BACK_LINE), 1e-6, `stagger at ${at}`);
    assert.ok(lineGap(t) <= P.maxLineGap + 1e-6, `gap ${lineGap(t).toFixed(1)} at ${at}`);
    const lineX = median(BACK_LINE.map((r) => t[r].x));
    assert.ok(lineX >= Math.min(median(BACK_LINE.map((r) => raw[r].x)), P.maxLineHeight) - 1e-6, `the line only steps up (or down to the cap) at ${at}`);
    assert.ok(lineX <= P.maxLineHeight + 1e-6, `height cap at ${at}`);
    for (const r of ['LW', 'RW']) assert.ok(t[r].y >= P.wingerInset - 1e-9 && t[r].y <= WIDTH - P.wingerInset + 1e-9, `${r} off the touchline at ${at}`);
    for (const r of ['LW', 'RW', 'LCM', 'RCM']) {
      const reach = P.tuckSideways[r.endsWith('W') ? 'W' : 'CM'];
      assert.ok(Math.abs(t[r].y - b.y) <= reach + 1e-9, `${r} tucked toward the ball at ${at}`);
    }
    assert.deepEqual(t.GK, raw.GK, `GK untouched at ${at}`);
    approx(t.ST.y, raw.ST.y, 1e-9, `the #9 only moves in depth at ${at}`);
    assert.ok(t.ST.x <= raw.ST.x + 1e-9, `the #9 only ever comes back at ${at}`);
    approx(t.DM.y, raw.DM.y, 1e-9, `the #6 only moves with the midfield line at ${at}`);
  }
  // Their build-up: our back line steps up to the midfield, and deep in their third it stops at the
  // cap, near halfway (U6: centre-backs at x 45-52 in a high block), with the midfield coming back to it.
  assert.ok(P.maxLineHeight >= 45 && P.maxLineHeight <= 52.5, 'U6 [S]: a high line holds near halfway');
  const press = teamTargets(f, 'us', { x: 86, y: 18 }, { inPossession: false });
  assert.ok(lineGap(press) <= P.maxLineGap + 1e-9 && median(BACK_LINE.map((r) => press[r].x)) >= 45, 'a high line');
  const deep = teamTargets(f, 'us', { x: 100, y: 34 }, { inPossession: false });
  approx(median(BACK_LINE.map((r) => deep[r].x)), P.maxLineHeight, 1e-6, 'capped');
  approx(lineGap(deep), P.maxLineGap, 1e-6, 'the midfield came back to the capped line');
});

test('out of possession: in a mid or low block a #9 the ball has gone past comes back to its height (T3)', () => {
  const P = SHAPE_DEFAULTS;
  assert.equal(P.stBlockHigh, CONTEXT_DEFAULTS.blockHigh, 'the same high-block threshold as the context');
  // Mid block, ball with their centre-back in their right half-space (the canonical mid-block situation).
  const ball = { x: 60, y: 20 };
  const raw = teamTargets(f, 'us', ball, { inPossession: false, shape: { stBeyondBall: Infinity } });
  const t = teamTargets(f, 'us', ball, { inPossession: false });
  assert.ok(raw.ST.x > ball.x + P.stBeyondBall + 1, `fixture: the table leaves the #9 ${(raw.ST.x - ball.x).toFixed(1)} m past the ball`);
  const mid = median(MIDFIELD.map((r) => t[r].x));
  approx(t.ST.x, Math.max(ball.x, mid) + P.stBeyondBall, 1e-9, 'level with the ball (plus the margin)');
  // Deep in our half he stops just in front of our midfield (he stays the outlet, T4), and a loose ball
  // leaves him where he is.
  const low = teamTargets(f, 'us', { x: 10, y: 34 }, { inPossession: false });
  assert.ok(low.ST.x >= median(MIDFIELD.map((r) => low[r].x)) + P.stBeyondBall - 1e-9, 'never back into our box');
  const loose = teamTargets(f, 'us', ball, { offset: false, shape: true });
  assert.deepEqual(loose.ST, teamTargets(f, 'us', ball, { offset: false, shape: { stBeyondBall: Infinity } }).ST);
  // In a high block (their build-up) he presses from where he is.
  const high = { x: 86, y: 18 };
  assert.deepEqual(teamTargets(f, 'us', high, { inPossession: false }).ST, teamTargets(f, 'us', high, { inPossession: false, shape: { stBeyondBall: Infinity } }).ST);
});

test('in possession: wingers hold the width (not the far one near the byline) and the back four spread in build-up', () => {
  const P = SHAPE_DEFAULTS;
  for (const b of grid) {
    const raw = teamTargets(f, 'us', b, { inPossession: true, shape: false });
    const t = teamTargets(f, 'us', b, { inPossession: true });
    const at = `ball (${b.x}, ${b.y})`;
    const build = clamp((P.buildUpTo - b.x) / (P.buildUpTo - P.buildUpFrom), 0, 1);
    for (const r of ROLES) {
      // Depth changes only in build-up, and only up to the staggered minimum (B10, B2).
      const min = P.buildUpDepth[ROLE_INFO[r].family];
      const want = min != null && raw[r].x < min ? raw[r].x + build * (min - raw[r].x) : raw[r].x;
      approx(t[r].x, want, 1e-9, `${r} x at ${at}`);
      const side = ROLE_INFO[r].side;
      if (side === 'L') assert.ok(t[r].y <= raw[r].y + 1e-9, `${r} only moves toward our left at ${at}`);
      else if (side === 'R') assert.ok(t[r].y >= raw[r].y - 1e-9, `${r} only moves toward our right at ${at}`);
      else approx(t[r].y, raw[r].y, 1e-9, `${r} untouched at ${at}`);
    }
    if (widthDuty(b, 'L') === 1) assert.ok(t.LW.y <= P.wingerWidth + 1e-9, `LW wide at ${at}`);
    if (widthDuty(b, 'R') === 1) assert.ok(t.RW.y >= WIDTH - P.wingerWidth - 1e-9, `RW wide at ${at}`);
    if (b.x <= P.buildUpFrom) {
      const c = (raw.LCB.y + raw.RCB.y) / 2;
      assert.ok(t.RCB.y - t.LCB.y >= 2 * P.cbSplit - 1e-9, `centre-backs split at ${at}`);
      assert.ok(t.LB.y <= Math.max(c - P.fbWide, 0) + 1e-9 && t.RB.y >= Math.min(c + P.fbWide, WIDTH) - 1e-9, `full-backs wide at ${at}`);
    }
    if (b.x >= P.buildUpTo) for (const r of BACK_LINE) approx(t[r].y, raw[r].y, 1e-9, `${r}: no build-up spread at ${at}`);
    if (b.x <= P.buildUpFrom) {
      // The lines stagger: full-backs level with or ahead of the centre-backs, the #6 ahead of them, the #8s ahead of him.
      assert.ok(Math.min(t.LB.x, t.RB.x) >= P.buildUpDepth.FB - 1e-9 && t.DM.x >= P.buildUpDepth.DM - 1e-9, `full-backs and #6 up at ${at}`);
      assert.ok(Math.min(t.LCM.x, t.RCM.x) >= P.buildUpDepth.CM - 1e-9 && t.ST.x >= P.buildUpDepth.ST - 1e-9, `#8s and #9 up at ${at}`);
    }
  }
  // Our goal kick (B10): full-backs wide at x 15-35, #6 ahead of the centre-backs, not a flat back four at the box.
  const gk = teamTargets(f, 'us', { x: 6, y: 30 }, { inPossession: true });
  for (const r of ['LB', 'RB']) assert.ok(gk[r].x >= 15 && gk[r].x <= 35, `${r} at x ${gk[r].x.toFixed(1)}`);
  assert.ok(gk.DM.x > Math.max(gk.LCB.x, gk.RCB.x) + 5, 'the #6 is a line ahead of the centre-backs');
  // P10: with the ball in the right wing lane near their byline, the left winger may come in.
  assert.equal(widthDuty({ x: 95, y: 60 }, 'L'), 0);
  assert.equal(widthDuty({ x: 95, y: 60 }, 'R'), 1, 'the near winger keeps the duty');
  assert.equal(widthDuty({ x: 60, y: 60 }, 'L'), 1, 'far from the byline the far winger stays wide');
  approx(widthDuty({ x: SHAPE_DEFAULTS.crossX - SHAPE_DEFAULTS.crossFade / 2, y: 64 }, 'L'), 0.5, 1e-9);
});

test('phase shape is left/right symmetric and continuous in the ball', () => {
  for (const inPossession of [true, false]) {
    for (const b of grid) {
      const t = teamTargets(f, 'us', b, { inPossession }), m = teamTargets(f, 'us', flipY(b), { inPossession });
      for (const r of ROLES) {
        approx(m[mirrorRole(r)].x, t[r].x, 1e-9, `${r} x at (${b.x}, ${b.y})`);
        approx(m[mirrorRole(r)].y, WIDTH - t[r].y, 1e-9, `${r} y at (${b.x}, ${b.y})`);
      }
    }
    let max = 0;
    for (const y of [4, 20, 34, 50]) {
      let prev = null;
      for (let x = 0; x <= LENGTH; x += 0.25) {
        const t = teamTargets(f, 'us', { x, y }, { inPossession });
        if (prev) for (const r of ROLES) max = Math.max(max, d(t[r], prev[r]));
        prev = t;
      }
    }
    assert.ok(max < 1.2, `${inPossession ? 'with' : 'without'} the ball: a 0.25 m ball step moved a target ${max.toFixed(2)} m`);
  }
});

test("phase shape and the rules agree on their shared numbers", () => {
  assert.deepEqual({ ...SHAPE_DEFAULTS.tuckSideways }, { ...TUCK_DEFAULTS.maxSideways }, 'D4 reach: layer A = tuck rule');
  assert.ok(SHAPE_DEFAULTS.wingerWidth <= 5, 'B1: inside the width rule\'s 5 m');
  assert.ok(SHAPE_DEFAULTS.levelBackLine > 0 && SHAPE_DEFAULTS.levelBackLine <= 1);
});

// ---------------------------------------------------------------- fallbacks and small tables

// Every role at an affine function of the ball: barycentric interpolation must reproduce it exactly.
const affine = (b, k) => ({ x: 0.5 * b.x + k, y: 0.3 * b.y + 2 * k });
const affineTable = (balls) => ({
  id: 'affine', name: 'affine', roles: ROLES,
  samples: balls.map((b) => ({ ball: b, pos: Object.fromEntries(ROLES.map((r, k) => [r, affine(b, k)])) })),
});

test('inside the hull, interpolation reproduces an affine table exactly', () => {
  const g = createFormation(affineTable([{ x: 40, y: 24 }, { x: 60, y: 24 }, { x: 60, y: 44 }, { x: 40, y: 44 }, { x: 50, y: 30 }]));
  for (const b of [{ x: 41, y: 25 }, { x: 55, y: 40 }, { x: 50, y: 30 }, { x: 59.9, y: 43.9 }]) {
    const p = g.positions(b);
    assert.ok(g.locate(b).inside);
    ROLES.forEach((r, k) => { const e = affine(b, k); approx(p[r].x, e.x, 1e-9); approx(p[r].y, e.y, 1e-9); });
  }
});

test('outside the hull, the ball is projected to the nearest hull point', () => {
  const g = createFormation(affineTable([{ x: 40, y: 24 }, { x: 60, y: 24 }, { x: 60, y: 44 }, { x: 40, y: 44 }]));
  const cases = [[{ x: 10, y: 34 }, { x: 40, y: 34 }], [{ x: 100, y: 0 }, { x: 60, y: 24 }], [{ x: 50, y: 60 }, { x: 50, y: 44 }]];
  for (const [ball, hullPoint] of cases) {
    const loc = g.locate(ball);
    assert.equal(loc.inside, false);
    approx(loc.ball.x, hullPoint.x, 1e-9); approx(loc.ball.y, hullPoint.y, 1e-9);
    const p = g.positions(ball);
    ROLES.forEach((r, k) => { const e = affine(hullPoint, k); approx(p[r].x, e.x, 1e-9); approx(p[r].y, e.y, 1e-9); });
  }
});

test('degenerate tables: one sample is constant, two samples interpolate along their segment', () => {
  const one = createFormation(affineTable([{ x: 50, y: 30 }]));
  assert.deepEqual(one.positions({ x: 5, y: 60 }), one.samples[0].pos);
  const two = createFormation(affineTable([{ x: 40, y: 34 }, { x: 60, y: 34 }]));
  const p = two.positions({ x: 45, y: 10 });
  ROLES.forEach((r, k) => { const e = affine({ x: 45, y: 34 }, k); approx(p[r].x, e.x, 1e-9); approx(p[r].y, e.y, 1e-9); });
});

test('a table with a missing role is rejected', () => {
  const t = affineTable([{ x: 40, y: 24 }, { x: 60, y: 24 }, { x: 50, y: 44 }]);
  delete t.samples[1].pos.ST;
  assert.throws(() => createFormation(t));
});

test('createFormation() without a table is the linear fallback', () => {
  const g = createFormation();
  assert.equal(g.triangles.length, 0);
  const b = { x: 70, y: 20 };
  const p = g.positions(b);
  for (const r of ROLES) assert.deepEqual(p[r], linearTarget(r, b));
});

test('linearTarget matches the RESEARCH 5.2 examples and tracks the table', () => {
  const c = { x: 52.5, y: 34 };
  approx(linearTarget('LCB', c).x, 34.1, 1e-9); approx(linearTarget('LCB', c).y, 28.4, 1e-9);
  approx(linearTarget('LB', c).y, 18.2, 1e-9);
  approx(linearTarget('LW', c).x, 63.2, 1e-9); approx(linearTarget('LW', c).y, 12.8, 1e-9);
  // The regression should stay within a few metres of the table on average (outfield).
  for (const r of ROLES.filter((q) => q !== 'GK')) {
    const mean = grid.reduce((s, b) => s + d(linearTarget(r, b), f.positions(b)[r]), 0) / grid.length;
    assert.ok(mean < 6, `${r} mean |linear - table| ${mean.toFixed(2)} m`);
  }
});

// ---------------------------------------------------------------- tooling (Node only)

test('vendored modules use only relative imports (browser-safe)', async () => {
  if (!isNode) return;
  const { readFile } = await import('node:fs/promises');
  for (const file of ['vendor/delaunator/index.js', 'vendor/robust-predicates/orient2d.js', 'vendor/robust-predicates/util.js']) {
    const src = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) assert.ok(m[1].startsWith('./') || m[1].startsWith('../'), `${file}: ${m[1]}`);
  }
});

test('renderAscii draws both teams, the ball and a legend with exact coordinates', async () => {
  if (!isNode) return; // scripts/ is Node tooling
  const { renderAscii, formatTable } = await import('../scripts/lib/ascii.mjs');
  const ball = { x: 70, y: 20 };
  const us = teamTargets(f, 'us', ball, { inPossession: true });
  const them = teamTargets(f, 'them', ball, { inPossession: false });
  const players = [
    ...ROLES.map((role) => ({ id: `us-${role}`, team: 'us', role, ...us[role] })),
    ...ROLES.map((role) => ({ id: `them-${role}`, team: 'them', role, ...them[role] })),
  ];
  const frame = { t: 0, ball, possession: 'us', carrierId: null, players, tags: {} };
  const out = renderAscii(frame, { marks: [{ x: 30, y: 30, ch: '*' }] });
  assert.match(out, /o/);
  assert.match(out, /\*/);
  assert.match(out, /LCB/);
  assert.match(out, /lcb/);
  assert.match(out, new RegExp(`${us.LCB.x.toFixed(2)}`));
  assert.ok(out.split('\n').every((l) => l.length <= 100), 'fits a terminal');
  const tbl = formatTable(frame);
  assert.match(tbl, /ball/);
  assert.ok(!renderAscii(frame, { legend: false }).includes(tbl));
});

test('THIRD_PARTY.md describes the edits to the HELIOS data as the data file records them', async () => {
  if (!isNode) return; // scripts/ is Node tooling
  const { readFile } = await import('node:fs/promises');
  const { AUDIT_DEFAULTS } = await import('../scripts/convert-helios.mjs');
  const notice = (await readFile(new URL('../THIRD_PARTY.md', import.meta.url), 'utf8')).replace(/\s+/g, ' ');
  const table = await loadJSON('data/formations/helios-433.json');
  const count = (rule) => table.edits.filter((e) => e.rule === rule).length;
  assert.equal(count('far-full-back-lead') + count('centre-symmetry'), table.edits.length, 'every edit rule is described');
  assert.ok(notice.includes(`${table.edits.length} documented edits`), 'total');
  const lead = AUDIT_DEFAULTS.maxFarFullBackLead;
  assert.ok(notice.includes(`${count('far-full-back-lead')} pull the far-side full-back back to at most ${lead} m ahead of the near-side full-back`), 'far full-back edits');
  assert.ok(notice.includes(`${count('centre-symmetry')} centre the #6 and #9`), 'centre edits');
  // ...and the data does what the notice says: each edited far full-back ends exactly `lead` m ahead of the near one.
  for (const e of table.edits.filter((q) => q.rule === 'far-full-back-lead')) {
    const near = table.samples[e.sample].pos[e.role === 'LB' ? 'RB' : 'LB'];
    approx(e.after.x - near.x, lead, 0.011, `sample ${e.sample} ${e.role}`);
  }
});
