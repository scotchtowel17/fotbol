// explain.js: headline, ranked reasons, praise, fix phrasing and the beat-1 cue.
import { test, assert } from './harness.js';
import { makeFrame, posOf } from './fixtures.js';
import { buildContext } from '../js/engine/context.js';
import { evaluate } from '../js/engine/score.js';
import { computeGhost } from '../js/engine/ghost.js';
import { explain, phraseMove, HEADLINES, EXPLAIN_DEFAULTS, ZONE_REASON } from '../js/engine/explain.js';

const at = (x, y) => ({ x, y });
const ctxFor = (scene, id, changes = {}) => buildContext(makeFrame(scene, changes), { learnerId: id, base: posOf(scene, id) });
const SENTENCE = /^[A-Z].*[.!?…]$/;

test('explain: a poor spot gives a headline, reasons, a fix and a cue in both wordings', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LW');
  const spot = at(66, 16); // drifted inside and away from everyone
  const ev = evaluate(ctx, spot);
  const ghost = computeGhost(ctx).spot;
  for (const wording of ['standard', 'kid']) {
    const e = explain(ev, ctx, spot, { wording, ghost });
    assert.equal(e.grade, ev.grade);
    assert.equal(e.score, ev.score);
    assert.equal(e.headline, HEADLINES[wording][ev.grade]);
    assert.ok(e.reasons.length >= 1 && e.reasons.length <= (wording === 'kid' ? 1 : 2), `${wording}: ${e.reasons.length} reasons`);
    for (const r of e.reasons) {
      assert.match(r.text, SENTENCE, `${wording} reason: "${r.text}"`);
      assert.ok(r.severity > 0 && r.severity <= 1);
      assert.ok(r.principleId);
    }
    assert.equal(e.reasons[0].ruleId, 'width');
    assert.ok(e.fix, 'has a fix');
    assert.match(e.fix.text, SENTENCE);
    assert.equal(e.fix.dx, ghost.x - spot.x);
    assert.equal(e.fix.dy, ghost.y - spot.y);
    assert.ok(e.cue && e.cue.text.endsWith('?'), `${wording} cue: ${e.cue?.text}`);
    assert.equal(e.cue.ruleId, 'width');
    assert.equal(e.cue.highlight.type, 'segment');
  }
});

test('explain: a critical failure always comes first', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LW', { tags: { event: 'pass' } });
  const spot = at(75, 16); // offside at the pass, and also narrow
  const ev = evaluate(ctx, spot);
  assert.equal(ev.critical, true);
  const width = ev.rules.find((r) => r.id === 'width'), off = ev.rules.find((r) => r.id === 'offside');
  assert.ok(width.weight * (1 - width.s) >= off.weight * (1 - off.s), 'width alone would rank at least as high');
  for (const wording of ['standard', 'kid']) {
    const e = explain(ev, ctx, spot, { wording });
    assert.equal(e.reasons[0].ruleId, 'offside');
    assert.equal(e.reasons[0].critical, true);
    assert.equal(e.reasons[0].severity, 1);
    assert.equal(e.cue.ruleId, 'offside');
    assert.deepEqual(e.cue.highlight, { type: 'line-x', x: 73 });
  }
});

test('explain: failing rules are ranked by weight x (1 - s)', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  const ev = {
    score: 70, grade: 'B', center: at(32, 32), critical: false,
    rules: [
      { id: 'spacing', principles: ['F8'], weight: 1, s: 0, critical: false, vars: { d: 2, min: 6, max: 18, mate: 'left centre-back' } },
      { id: 'occupancy', principles: ['B5'], weight: 2, s: 0.6, critical: false, vars: { part: 'lane', lane: 'centre', inLane: 3, onLine: 1 } },
      { id: 'lane-open', principles: ['B3'], weight: 3, s: 0.5, critical: false, vars: { gap: 0.8, blocker: 'striker' } },
      { id: 'support-distance', principles: ['B4', 'B3'], weight: 2, s: 0.95, critical: false, vars: {} },
    ],
  };
  const e = explain(ev, ctx, at(32, 32), { max: 5 });
  assert.deepEqual(e.reasons.map((r) => r.ruleId), ['lane-open', 'spacing', 'occupancy']); // 1.5, 1.0, 0.8; 0.95 passes
  assert.deepEqual(e.praise, ['You support from a good distance without crowding the carrier.'], 'only s >= 0.9 is praised');
});

test('explain: praise for rules passed well (at most 2), no fix at the ghost', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LCM');
  const g = computeGhost(ctx);
  const ev = evaluate(ctx, g.spot);
  for (const wording of ['standard', 'kid']) {
    const e = explain(ev, ctx, g.spot, { wording, ghost: g });
    assert.equal(e.grade, 'S');
    assert.equal(e.headline, HEADLINES[wording].S);
    assert.deepEqual(e.reasons, []);
    assert.equal(e.cue, null);
    assert.equal(e.fix, null);
    assert.ok(e.praise.length >= 1 && e.praise.length <= 2);
    for (const p of e.praise) assert.match(p, SENTENCE);
  }
});

test('explain: principle names come from the catalogue when one is passed', () => {
  const ctx = ctxFor('ipBuildUp', 'us-LW');
  const spot = at(62, 15);
  const ev = evaluate(ctx, spot);
  const principles = { byId: { B1: { id: 'B1', name: 'Width: make the field big' } } };
  const e = explain(ev, ctx, spot, { principles });
  const r = e.reasons.find((x) => x.ruleId === 'width');
  assert.equal(r.principleId, 'B1');
  assert.equal(r.name, 'Width: make the field big');
  // Without a catalogue the rule's own display name is used.
  assert.equal(explain(ev, ctx, spot).reasons.find((x) => x.ruleId === 'width').name, 'Give width');
  assert.equal(explain(ev, ctx, spot, { wording: 'kid' }).reasons[0].name, 'Stay wide');
});

test('explain: rules with blank templates still produce a sentence', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  const blank = {
    id: 'blank', principles: ['X1'], critical: false, weight: () => 1,
    evaluate: () => ({ s: 0, vars: {} }),
    text: { standard: { name: 'Blank rule', ok: () => '', fail: () => '', cue: () => '' }, kid: { name: 'Blank', ok: () => '', fail: () => { throw new Error('bug'); }, cue: () => '' } },
  };
  const ev = evaluate(ctx, at(32, 32), { rules: [blank] });
  for (const wording of ['standard', 'kid']) {
    const e = explain(ev, ctx, at(32, 32), { wording, rules: [blank] });
    assert.equal(e.reasons.length, 1);
    assert.match(e.reasons[0].text, SENTENCE);
    assert.equal(e.cue, null, 'no text and no highlight means no cue');
  }
});

test('explain: far from the role\'s place with no rule broken, the zone itself is the reason (F2)', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  const spot = at(32, 50); // 18 m across from the base, with no rules in play
  const ev = evaluate(ctx, spot, { rules: [] });
  assert.ok(ev.sZone < EXPLAIN_DEFAULTS.zoneFailBelow);
  for (const wording of ['standard', 'kid']) {
    const e = explain(ev, ctx, spot, { wording, rules: [], principles: { F2: { id: 'F2', name: 'Shift with the ball as a unit' } } });
    assert.equal(e.reasons.length, 1, wording);
    const r = e.reasons[0];
    assert.equal(r.ruleId, ZONE_REASON.id);
    assert.equal(r.principleId, 'F2');
    assert.equal(r.name, 'Shift with the ball as a unit');
    assert.match(r.text, SENTENCE);
    if (wording === 'standard') assert.match(r.text, /about 18 m from where a holding midfielder \(#6\) stands/);
    else assert.ok(r.text.split(/\s+/).length <= 15);
    assert.ok(e.cue.text.endsWith('?'));
    assert.deepEqual(e.cue.highlight, { type: 'point', x: ctx.ball.x, y: ctx.ball.y }, 'look at the ball');
  }
  // Near the base there is no zone reason, and failing rules always come before it.
  assert.deepEqual(explain(evaluate(ctx, at(32, 33), { rules: [] }), ctx, at(32, 33), { rules: [] }).reasons, []);
  const both = explain(evaluate(ctx, at(20, 50)), ctx, at(20, 50), { max: 5 });
  assert.equal(both.reasons.at(-1).ruleId, 'zone');
  assert.ok(both.reasons.length > 1 && both.reasons.slice(0, -1).every((r) => r.ruleId !== 'zone'));
});

test('explain: every headline grade has both wordings', () => {
  const ctx = ctxFor('ipBuildUp', 'us-DM');
  const expected = { S: 'Spot on.', A: 'Great position.', B: 'Good — small adjustment.', C: 'Close, but…', D: 'Not quite.', F: 'Out of position.' };
  for (const [grade, text] of Object.entries(expected)) {
    const ev = { score: 0, grade, center: at(32, 32), rules: [] };
    assert.equal(explain(ev, ctx, at(32, 32)).headline, text);
    assert.ok(explain(ev, ctx, at(32, 32), { wording: 'kid' }).headline.length > 0);
  }
});

// ---------------------------------------------------------------- phraseMove

test('phraseMove: deeper is toward our goal and inside is toward the middle, on both sides', () => {
  // Left side (y < 34) and right side (y > 34) read the same.
  assert.equal(phraseMove(at(30, 20), at(26, 23)), 'drop 4 m deeper and come 3 m inside');
  assert.equal(phraseMove(at(30, 48), at(26, 45)), 'drop 4 m deeper and come 3 m inside');
  assert.equal(phraseMove(at(60, 20), at(63, 15)), 'push up 3 m and move 5 m wider');
  assert.equal(phraseMove(at(60, 48), at(63, 53)), 'push up 3 m and move 5 m wider');
});

test('phraseMove: the same words in both halves of the pitch', () => {
  assert.equal(phraseMove(at(20, 10), at(16, 10)), 'drop 4 m deeper'); // our half
  assert.equal(phraseMove(at(80, 10), at(76, 10)), 'drop 4 m deeper'); // their half
  assert.equal(phraseMove(at(20, 60), at(25, 60)), 'push up 5 m');
  assert.equal(phraseMove(at(90, 60), at(95, 60)), 'push up 5 m');
});

test('phraseMove: sideways only, rounding, and small moves', () => {
  assert.equal(phraseMove(at(40, 10), at(40, 14.4)), 'come 4 m inside');
  assert.equal(phraseMove(at(40, 58), at(40, 62.6)), 'move 5 m wider');
  assert.equal(phraseMove(at(40, 30), at(40.4, 30.5)), '', 'under a metre');
  assert.equal(phraseMove(at(40, 30), at(40, 30)), '');
  assert.equal(phraseMove(at(40, 30), at(41.2, 30.3)), 'push up 1 m');
});

test('phraseMove: ending in the middle is "inside"; crossing it names the touchline', () => {
  assert.equal(phraseMove(at(60, 30), at(71, 34)), 'push up 11 m and come 4 m inside');
  assert.equal(phraseMove(at(40, 30), at(40, 38)), 'shift 8 m across toward the right touchline');
  assert.equal(phraseMove(at(40, 40), at(37, 28)), 'drop 3 m deeper and shift 12 m across toward the left touchline');
  assert.equal(phraseMove(at(40, 34), at(40, 30)), 'shift 4 m across toward the left touchline', 'from the middle');
});

test('phraseMove: kid wording', () => {
  assert.equal(phraseMove(at(30, 20), at(26, 23), { wording: 'kid' }), 'move 4 m back toward your goal and 3 m toward the middle');
  assert.equal(phraseMove(at(60, 48), at(63, 53), { wording: 'kid' }), 'move 3 m forward and 5 m toward the sideline');
  assert.equal(phraseMove(at(40, 30), at(40, 38), { wording: 'kid' }), 'move 8 m across toward the right sideline');
  assert.equal(phraseMove(at(40, 30), at(40.2, 30), { wording: 'kid' }), '');
});

test('phraseMove never uses screen directions', () => {
  const bad = /\b(up|down)\b(?! \d)|\bscreen\b|\bto the (left|right)\b/;
  for (let fx = 10; fx <= 90; fx += 40) {
    for (let fy = 5; fy <= 65; fy += 30) {
      for (const [dx, dy] of [[5, 0], [-5, 0], [0, 6], [0, -6], [4, 4], [-4, -4]]) {
        for (const wording of ['standard', 'kid']) {
          const s = phraseMove(at(fx, fy), at(fx + dx, fy + dy), { wording });
          assert.ok(s.length > 0);
          assert.ok(!bad.test(s.replace(/push up/g, '')), `"${s}"`);
        }
      }
    }
  }
});
