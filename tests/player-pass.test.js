// "Who's open?" (js/ui/player/pass.js): the pure helpers. Labels and outcomes, option order, the reveal's markers,
// the pass's flight, the words, and the set built with stubbed dependencies (the engine and road.js are other areas').
import { test, assert, approx, loadJSON } from './harness.js';
import { makeFrame } from './fixtures.js';
import { timing } from '../js/engine/timeline.js';
import {
  PASS_DEFAULTS, STRINGS, LABELS, labelStyle, outcomeKey, passOutcome, starsOf, wordFor, receiverOf, optionsByReceiver,
  orderTargets, rankOptions, shirtOf, carrierOf, roleOfDrill, aimOf, revealMarkers, previewMarkers, flashMarkers, passFlight,
  flightFrame, repFocus, BOARD_TONES, pickLine, whyFor, repTitle, questionOf, briefOf, historyEntry, passRecordId, hashString, nodeSeed, roleFor,
  generateReps, assembleSet, genuinelyOn, passTargets, revealPicks, labelSide, revealFocus, betterLine, revealZoom,
} from '../js/ui/player/pass.js';

// ---- a small frame and rating in the engine's shapes (research/passing.md §4.1)
const P = (id, x, y) => {
  const [team, role] = id.split('-');
  return { id, team, role, x, y };
};
const frame = {
  t: 3, ball: { x: 22, y: 26 }, possession: 'us', carrierId: 'us-LCB', tags: {},
  players: [
    P('us-GK', 5, 34), P('us-LCB', 22, 26), P('us-RCB', 22, 42), P('us-LB', 30, 8), P('us-RB', 32, 60), P('us-DM', 35, 34),
    P('us-LCM', 42, 24), P('us-RCM', 44, 44), P('us-LW', 62, 10), P('us-ST', 60, 34), P('us-RW', 62, 58),
    P('them-ST', 30, 30), P('them-DM', 50, 32), P('them-LCB', 70, 28), P('them-RCB', 70, 40),
  ],
};
const opt = (id, label, score, extra = {}) => ({ id, targetId: id.split('@')[0], kind: id.includes('@') ? 'space' : 'feet', label, score, pSafe: 0.9, blocker: null, lineBroken: null, tags: [], ...extra });
const best = opt('us-LCM', 'best', 100, { point: { x: 42, y: 24 }, lineBroken: 'front' });
const rating = {
  carrierId: 'us-LCB', ball: { x: 22, y: 26 }, lines: { front: 30, mid: 50, back: 70, secondLast: 70 }, best,
  options: [
    best,
    opt('us-RCM', 'good', 89, { point: { x: 44, y: 44 } }),
    opt('us-LB@space', 'good', 88, { point: { x: 42, y: 8 } }),
    opt('us-LB', 'good', 86, { point: { x: 30, y: 8 } }),
    opt('us-RCB', 'good', 79, { point: { x: 22, y: 42 } }),
    opt('us-GK', 'good', 79, { point: { x: 5, y: 34 } }),
    opt('us-DM', 'risky', 75, { point: { x: 35, y: 34 }, pSafe: 0.66, blocker: { id: 'them-ST', pInt: 0.3, at: { x: 29, y: 31 }, via: 'run' } }),
    opt('us-RB', 'good', 83, { point: { x: 32, y: 60 } }),
    opt('us-ST', 'cut-out', 42, { point: { x: 60, y: 34 }, pSafe: 0.3, blocker: { id: 'them-DM', pInt: 0.7, at: { x: 49, y: 32 }, via: 'block' } }),
    opt('us-LW', 'offside', 20, { point: { x: 62, y: 10 } }),
    opt('us-RW', 'cut-out', 34, { point: { x: 62, y: 58 }, pSafe: 0.4, blocker: { id: 'them-RCB', pInt: 0.55, at: { x: 58, y: 52 }, via: 'run' } }),
    opt('them-DM', 'cut-out', 0), // never a target: not our player
    opt('us-LCB', 'good', 50), // never a target: the carrier
  ],
};
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

// ---- labels and outcomes

test('pass: every engine label shows a shape AND a word, with a tone and a lane style', () => {
  const want = { best: '★ Best', good: '✓ Good', risky: '! Risky', 'cut-out': '✗ Cut out', offside: '✗ Offside', danger: '✗ Danger' };
  for (const [label, text] of Object.entries(want)) {
    const L = labelStyle(label);
    assert.equal(L.text, text, label);
    assert.equal(L.key, label);
    assert.ok(['good', 'warn', 'bad'].includes(L.tone), `${label} tone`);
    assert.ok(['solid', 'dashed', 'dotted'].includes(L.line), `${label} line`);
  }
  assert.equal(labelStyle('best').tone, labelStyle('good').tone, 'best and good share a colour; the shape tells them apart');
  assert.notEqual(labelStyle('best').shape, labelStyle('good').shape);
  // Colour is never the only difference: every tone pairs with its own shape and lane pattern.
  assert.equal(labelStyle('risky').line, 'dashed');
  assert.equal(labelStyle('cut-out').line, 'dotted');
  assert.equal(labelStyle('good').line, 'solid');
  for (const k of ['cut-out', 'offside', 'danger']) assert.equal(labelStyle(k).shape, '✗', `${k} is a cross`);
  assert.equal(labelStyle('nonsense').key, 'risky', 'an unknown label reads as risky (never as good)');
  assert.deepEqual(Object.keys(LABELS).sort(), Object.keys(STRINGS.labels).sort(), 'a word for every label');
  assert.equal(STRINGS.outcomes.danger, 'Danger!', 'the banner and the label agree');
  const ranks = rankOptions(Object.keys(LABELS).map((l, i) => ({ id: `x${i}`, label: l, score: 50 }))).map((o) => o.label);
  assert.deepEqual(ranks, ['best', 'good', 'risky', 'cut-out', 'offside', 'danger']);
});

test('pass: outcomes: cut out groans (with the blocker), a broken line lifts, a safe pass is quiet, all with words', () => {
  const cut = passOutcome(rating.options.find((o) => o.id === 'us-ST'), { outcome: 'cut-out', score: 42 });
  assert.equal(cut.kind, 'cut-out');
  assert.equal(cut.text, 'Cut out!');
  assert.equal(cut.sound, 'groan');
  assert.equal(cut.shape, '✗');
  assert.ok(cut.intercepted);
  assert.equal(cut.blockerId, 'them-DM');

  const broke = passOutcome(best, { outcome: 'completed', score: 100 });
  assert.equal(broke.kind, 'line-broken');
  assert.equal(broke.text, 'Line broken!');
  assert.equal(broke.sound, 'lift');
  assert.ok(!broke.intercepted);

  const safe = passOutcome(rating.options.find((o) => o.id === 'us-RCB'), { outcome: 'completed', score: 79 });
  assert.equal(safe.kind, 'safe');
  assert.equal(safe.text, 'Safe');
  assert.equal(safe.sound, null, 'safe is quiet');

  const risky = passOutcome(rating.options.find((o) => o.id === 'us-DM'), { outcome: 'risky', score: 75 });
  assert.equal(risky.text, 'Risky!');
  assert.equal(risky.shape, '!');
  assert.ok(!risky.intercepted, 'an amber pass arrives: we show the likely outcome, not a dice roll');

  const off = passOutcome(rating.options.find((o) => o.id === 'us-LW'), { outcome: 'offside', score: 20 });
  assert.equal(off.text, 'Offside!');
  assert.equal(off.tone, 'bad');

  const dangerSafe = passOutcome({ id: 'us-RCB', label: 'danger', pSafe: 0.7, blocker: { id: 'them-ST', at: { x: 10, y: 30 } } }, { outcome: 'danger' });
  assert.equal(dangerSafe.text, 'Danger!');
  assert.ok(!dangerSafe.intercepted);
  const dangerCut = passOutcome({ id: 'us-RCB', label: 'danger', pSafe: 0.4, blocker: { id: 'them-ST', at: { x: 10, y: 30 } } }, { outcome: 'danger' });
  assert.equal(dangerCut.text, 'Cut out!', 'a pass across our goal that is likely cut out is shown cut out');
  assert.equal(dangerCut.blockerId, 'them-ST');

  // Without gradePass's outcome, the option's label decides.
  assert.equal(outcomeKey({ label: 'cut-out' }, {}), 'cut-out');
  assert.equal(outcomeKey({ label: 'good' }, null), 'completed');
  assert.equal(outcomeKey({ label: 'good' }, { outcome: 'weird' }), 'completed');
  assert.equal(passOutcome({ label: 'cut-out' }, null).text, 'Cut out!', 'cut out even when the engine named no blocker');
  // Every outcome has a word: sound never carries the meaning alone.
  for (const o of [cut, broke, safe, risky, off, dangerSafe]) assert.ok(o.text && o.shape, o.kind);
});

test('pass: stars and the word: gradePass stars first, then starsForScore, then the §6.3 bands', () => {
  assert.equal(starsOf({ stars: 2, score: 10 }), 2);
  assert.equal(starsOf({ score: 95 }, {}), 3);
  assert.equal(starsOf({ score: 80 }, {}), 2);
  assert.equal(starsOf({ score: 60 }, {}), 1);
  assert.equal(starsOf({ score: 54 }, {}), 0);
  assert.equal(starsOf({ score: 60 }, { starsForScore: () => 3 }), 3, 'rewards.js starsForScore wins over the local bands');
  assert.equal(starsOf(null), 0);
  assert.deepEqual([0, 1, 2, 3].map((n) => wordFor(n, {})), ['Not yet', 'Close', 'Great', 'Spot on'], 'the shared star words');
  assert.equal(wordFor(2, { wordForStars: () => 'Lovely' }), 'Lovely');
  assert.equal(wordFor(9, {}), 'Spot on', 'clamped');
});

// ---- options

test('pass: a tap on a teammate plays their better option (feet or space); never the carrier or an opponent', () => {
  assert.equal(receiverOf({ id: 'us-LW@space' }), 'us-LW');
  assert.equal(receiverOf({ id: 'us-LW', targetId: 'us-LW' }), 'us-LW');
  assert.equal(receiverOf({ id: 'x', targetId: 'us-ST' }), 'us-ST');
  assert.equal(receiverOf(null), null);
  const map = optionsByReceiver(rating.options, 'us-LCB');
  assert.equal(map.size, 10, 'ten teammates');
  assert.ok(!map.has('us-LCB') && !map.has('them-DM'));
  assert.equal(map.get('us-LB').id, 'us-LB@space', 'the better of the two passes to the left back');
  assert.equal(map.get('us-LCM').id, 'us-LCM');
  // A tie goes to feet.
  const tie = optionsByReceiver([{ id: 'us-ST@space', kind: 'space', score: 80 }, { id: 'us-ST', kind: 'feet', score: 80 }]);
  assert.equal(tie.get('us-ST').id, 'us-ST');
});

test('pass: targets go from our goal forward, then across; the reveal list goes best first', () => {
  const ids = [...optionsByReceiver(rating.options, 'us-LCB').keys()];
  const order = orderTargets(ids, frame);
  assert.equal(order[0], 'us-GK');
  const xs = order.map((id) => frame.players.find((p) => p.id === id).x);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1], 'back to front');
  assert.deepEqual(orderTargets(['us-ST', 'us-zz', 'us-GK'], frame), ['us-GK', 'us-ST', 'us-zz'], 'unknown ids last');
  const ranked = rankOptions([...optionsByReceiver(rating.options, 'us-LCB').values()]);
  assert.equal(ranked[0].id, 'us-LCM');
  assert.equal(ranked[1].label, 'good');
  assert.ok(ranked.findIndex((o) => o.label === 'cut-out') > ranked.findIndex((o) => o.label === 'risky'));
  assert.equal(ranked.at(-1).label, 'offside');
});

test('pass: shirt numbers follow §5; the carrier and its role come from the drill', () => {
  const want = { GK: 1, RB: 2, LB: 3, LCB: 4, RCB: 5, DM: 6, RW: 7, LCM: 8, ST: 9, RCM: 10, LW: 11 };
  for (const [role, n] of Object.entries(want)) assert.equal(shirtOf(`us-${role}`), n, role);
  assert.equal(shirtOf('nobody'), null);
  assert.equal(carrierOf({ carrierId: 'us-DM' }), 'us-DM');
  assert.equal(carrierOf({ carrier: 'us-LB' }), 'us-LB');
  assert.equal(carrierOf({ carrier: { id: 'us-ST' } }), 'us-ST');
  assert.equal(carrierOf({ learner: { role: 'RCM' } }), 'us-RCM');
  assert.equal(carrierOf({}, { carrierId: 'us-GK' }), 'us-GK');
  assert.equal(roleOfDrill({ learner: { role: 'LB' } }), 'LB');
  assert.equal(roleOfDrill({ carrierId: 'us-RW' }), 'RW');
});

// ---- the pitch

test('pass: the reveal labels every teammate option, draws your lane and the best one, and rings the blocker', () => {
  const m = revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-ST' });
  const labels = m.filter((x) => x.type === 'label' && x.receiverId);
  assert.equal(labels.length, 10, 'one label per teammate');
  const byRec = Object.fromEntries(labels.map((l) => [l.receiverId, l]));
  assert.equal(byRec['us-LCM'].text, '★ Best');
  assert.equal(byRec['us-ST'].text, '✗ Cut out');
  assert.equal(byRec['us-LW'].text, '✗ Offside');
  assert.equal(byRec['us-DM'].text, '! Risky');
  assert.equal(byRec['us-RCB'].text, '✓ Good');
  for (const l of labels) {
    const p = frame.players.find((q) => q.id === l.receiverId);
    assert.deepEqual(l.at, { x: p.x, y: p.y }, 'on the teammate...');
    assert.equal(l.lift, 'token', '...lifted clear of the token (board.js), in either layout');
    assert.match(l.cls, /\bps-mk\b/);
  }
  assert.match(byRec['us-DM'].cls, /ps-mk--warn/, 'risky is styled amber (css/pass.css)');
  assert.equal(byRec['us-DM'].tone, BOARD_TONES.warn);
  assert.match(byRec['us-ST'].cls, /\bis-yours\b/, 'your pick is marked for the stylesheet');
  assert.ok(!/is-yours/.test(byRec['us-LCM'].cls));
  const lanes = m.filter((x) => x.lane);
  assert.deepEqual(lanes.map((l) => l.optionId).sort(), ['us-LCM', 'us-ST'], 'your lane and the best lane only (≤ 2 cues)');
  const mine = lanes.find((l) => l.optionId === 'us-ST');
  assert.equal(mine.style, 'dotted');
  assert.match(mine.cls, /ps-line--dotted/, 'the pattern, not just the colour');
  assert.equal(mine.tone, 'bad');
  assert.deepEqual(mine.a, frame.ball);
  const bestLane = lanes.find((l) => l.optionId === 'us-LCM');
  assert.equal(bestLane.style, 'solid');
  assert.equal(bestLane.dashed, false);
  const rings = m.filter((x) => x.type === 'ring');
  assert.deepEqual(rings.map((r) => r.id), ['them-DM'], 'the defender in the way is ringed');
  const cross = m.find((x) => x.intercept);
  assert.deepEqual(cross.at, { x: 49, y: 32 });
  assert.equal(cross.text, '✗');
  // Lanes come before the labels, so the labels draw on top.
  assert.ok(m.findIndex((x) => x.lane) < m.findIndex((x) => x.type === 'label' && x.receiverId));
});

test('pass: the reveal shows the offside line after an offside pass, the broken line after a line-breaking one', () => {
  const off = revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-LW' });
  const line = off.find((x) => x.type === 'line-x');
  assert.equal(line.x, 70, 'their second-last player');
  assert.equal(line.line, 'offside');
  const offX = revealMarkers({ rating: { ...rating, offsideX: 72.5 }, frame, carrierId: 'us-LCB', choiceId: 'us-LW' });
  assert.equal(offX.find((x) => x.type === 'line-x').x, 72.5, "the engine's offside line when it gives one");
  const broke = revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-LCM' });
  const bl = broke.find((x) => x.type === 'line-x');
  assert.equal(bl.x, 30, 'their front line');
  assert.equal(bl.tone, 'good');
  assert.equal(broke.filter((x) => x.lane).length, 1, 'the best pass picked: one lane');
  const space = revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-LB@space' });
  const run = space.find((x) => x.run);
  assert.deepEqual(run.from, { x: 30, y: 8 });
  assert.deepEqual(run.to, { x: 42, y: 8 });
  assert.match(run.cls, /ps-run/);
  assert.deepEqual(flashMarkers('them-DM'), [{ type: 'ring', id: 'them-DM', tone: 'bad', pulse: true, cls: 'ps-mk ps-mk--bad ps-flash' }]);
  assert.deepEqual(flashMarkers(null), []);
});

test('pass: the preview line points at the teammate, never at the engine\'s space target', () => {
  const [line] = previewMarkers({ frame, carrierId: 'us-LCB', receiverId: 'us-LB' });
  assert.equal(line.type, 'segment');
  assert.ok(line.dashed);
  assert.deepEqual(line.a, frame.ball);
  assert.deepEqual(line.b, { x: 30, y: 8 });
  assert.deepEqual(previewMarkers({ frame, carrierId: 'us-LCB', receiverId: 'us-nobody' }), []);
  assert.deepEqual(aimOf(rating.options.find((o) => o.id === 'us-LB@space'), frame), { x: 42, y: 8 });
  assert.deepEqual(aimOf({ id: 'us-ST' }, frame), { x: 60, y: 34 });
});

test('pass: the flight: to the aim, or to the defender who cuts it out; the ball has no carrier until it lands', () => {
  const cutOpt = rating.options.find((o) => o.id === 'us-ST');
  const cut = passFlight(frame, cutOpt, passOutcome(cutOpt, { outcome: 'cut-out' }));
  assert.deepEqual(cut.to, { x: 49, y: 32 });
  assert.equal(cut.blockerId, 'them-DM');
  assert.deepEqual(cut.movers.map((m) => m.id), ['them-DM'], 'the defender steps to the ball');
  const mid = flightFrame(frame, cut, 0.5);
  assert.equal(mid.carrierId, null, 'in the air');
  approx(mid.ball.x, (22 + 49) / 2);
  const end = flightFrame(frame, cut, 1);
  assert.equal(end.carrierId, 'them-DM', 'they have it');
  assert.deepEqual(end.players.find((p) => p.id === 'them-DM'), { ...frame.players.find((p) => p.id === 'them-DM'), x: 49, y: 32 });
  assert.equal(frame.players.find((p) => p.id === 'them-DM').x, 50, 'the frame itself is untouched');

  const spaceOpt = rating.options.find((o) => o.id === 'us-LB@space');
  const sp = passFlight(frame, spaceOpt, passOutcome(spaceOpt, { outcome: 'completed' }));
  assert.deepEqual(sp.to, { x: 42, y: 8 });
  assert.deepEqual(sp.movers, [{ id: 'us-LB', from: { x: 30, y: 8 }, to: { x: 42, y: 8 } }], 'the runner meets it');
  assert.equal(flightFrame(frame, sp, 1).carrierId, 'us-LB');

  const short = passFlight(frame, { id: 'us-RCB', point: { x: 22, y: 27 } }, { intercepted: false });
  assert.equal(short.duration, PASS_DEFAULTS.flightMin, 'a short pass still takes long enough to follow');
  const long = passFlight(frame, { id: 'us-RW', point: { x: 100, y: 60 } }, { intercepted: false });
  assert.equal(long.duration, PASS_DEFAULTS.flightMax);
  approx(passFlight(frame, rating.options.find((o) => o.id === 'us-DM'), {}).duration, Math.hypot(13, 8) / PASS_DEFAULTS.ballSpeed, 1e-9, 'match speed in between');
});

test('pass: the focus keeps the play, YOU and every target in view (the keeper too)', () => {
  const f = repFocus([frame], rating);
  assert.equal(f.x0, 5 - PASS_DEFAULTS.focusPad, 'the keeper is a target');
  assert.equal(f.x1, 62 + PASS_DEFAULTS.focusPad);
  const noKeeper = repFocus([frame], { options: rating.options.filter((o) => o.id !== 'us-GK') });
  assert.equal(noKeeper.x0, 22 - PASS_DEFAULTS.focusPad, 'the ball and YOU');
  assert.equal(repFocus([], null), null);
});

// ---- words

test('pass: the reveal line is at most 14 words and never the consequence word; Why? names the idea and the best pass', () => {
  // The shape of engine explainPass in simple wording (js/engine/passing.js).
  const missOption = { id: 'us-ST', label: 'cut-out', tags: [{ tag: 'blocked', kind: 'problem' }, { tag: 'too-long', kind: 'problem' }, { tag: 'forward', kind: 'strength' }] };
  const miss = {
    headline: 'Cut out!', line: 'Their midfielder is in the way.',
    yours: { text: 'Their midfielder is in the way.', principleId: 'PA4', tag: 'blocked' },
    best: { text: 'It gets past their front players.', principleId: 'PA5', tag: 'breaks-first-line', id: 'us-LCM' },
    more: [{ text: 'That pass is long, so it is hard to get right.', principleId: 'PA12', tag: 'too-long' }, { text: 'It moves the ball forward.', principleId: 'PA2', tag: 'forward' }],
  };
  assert.equal(pickLine(miss), 'Their midfielder is in the way.');
  assert.equal(pickLine({ headline: 'Cut out!' }), STRINGS.lineBad, 'the headline is the consequence, not the line');
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
  assert.equal(pickLine({ line: long, yours: { text: long }, best: { text: 'Short one.' } }), 'Short one.');
  assert.equal(pickLine(null, { good: true }), STRINGS.lineGood);
  assert.equal(pickLine({}, { good: false }), STRINGS.lineBad);
  const principles = {
    PA4: { kidName: 'Clear Path Only', summary: { kid: "If a defender is in the way, don't pass there." } },
    PA5: { kidName: 'Pass Past Them', summary: { kid: 'Pass past their players, not in front of them.' } },
  };
  const line = pickLine(miss);
  const w = whyFor({ explain: miss, principles, isBest: false, option: missOption, line });
  assert.equal(w.title, 'Pass Past Them', "a miss: the best pass's idea");
  assert.equal(w.summary, 'Pass past their players, not in front of them.');
  assert.deepEqual(w.reasons, ['It gets past their front players.', 'That pass is long, so it is hard to get right.'], "the best pass's reason, then more about yours");
  assert.deepEqual(w.praise, [], 'a cut-out pass gets no praise');

  const hitOption = { id: 'us-LCM', label: 'best', tags: [{ tag: 'breaks-first-line', kind: 'strength' }, { tag: 'free', kind: 'strength' }] };
  const hit = {
    headline: 'Line broken!', line: 'It gets past their front players.', best: null,
    yours: { text: 'It gets past their front players.', principleId: 'PA5', tag: 'breaks-first-line' },
    more: [{ text: 'Your midfielder is free, with nobody close.', principleId: 'PA3', tag: 'free' }],
  };
  const h = whyFor({ explain: hit, principles, isBest: true, option: hitOption, line: pickLine(hit) });
  assert.equal(h.title, 'Pass Past Them', 'the best: your idea');
  assert.deepEqual(h.reasons, []);
  assert.deepEqual(h.praise, ['Your midfielder is free, with nobody close.'], 'what else you got right');
  const dup = whyFor({ explain: { ...hit, more: [{ text: 'It gets past their front players.', tag: 'breaks-first-line' }] }, principles, isBest: true, option: hitOption, line: 'It gets past their front players.' });
  assert.deepEqual(dup.praise, [], 'never the line twice');

  const bare = whyFor({ explain: null, principles: {}, drill: { principles: ['PA3'] } });
  assert.equal(bare.title, STRINGS.whyTitle);
  assert.equal(bare.summary, STRINGS.whySummary);
  const own = whyFor({ explain: miss, principles: {}, drill: { principles: ['PA5'], titleKid: 'Pass Past Them', takeaway: { kid: 'Pass past their players.' } }, option: missOption, line });
  assert.deepEqual([own.title, own.summary], ['Pass Past Them', 'Pass past their players.'], "not in the catalogue yet: the drill's own lesson");
  assert.equal(whyFor({ explain: miss, principles: { byId: principles }, option: missOption, line }).title, 'Pass Past Them', 'the app form { byId } works too');
  // The rep's lesson wins when the explanation is about it (a Find the Free Player rep missed through a blocked lane).
  const lesson = whyFor({ explain: miss, principles, drill: { principles: ['PA4', 'PA3'] }, isBest: false, option: missOption, line });
  assert.deepEqual([lesson.title, lesson.summary], ['Clear Path Only', "If a defender is in the way, don't pass there."]);
  assert.equal(whyFor({ explain: miss, principles, drill: { principles: ['PA9'] }, isBest: false, option: missOption, line }).title, 'Pass Past Them', 'a lesson the explanation is not about: the best pass\'s idea');
  const all = [w.title, w.summary, ...w.reasons, ...w.praise].join(' ');
  assert.ok(words(all) <= 60, 'the Why sheet stays under 60 words');
  assert.equal(repTitle({ titleKid: 'Find the free player' }), 'Find the free player');
  assert.equal(repTitle({ principles: ['PA5'] }, principles), 'Pass Past Them');
  assert.equal(repTitle({}), STRINGS.title);
  assert.equal(questionOf({ questionKid: 'Who has nobody close?' }), 'Who has nobody close?', "an authored drill's own question");
  assert.equal(questionOf({ questionKid: "Who's open?", source: { kind: 'generated' } }), STRINGS.question, 'generated: the screen says how to answer');
  assert.equal(questionOf({ questionKid: 'one two three four five six seven eight nine ten eleven twelve thirteen' }), STRINGS.question);
  assert.equal(questionOf(null), STRINGS.question);
  assert.equal(briefOf({ briefKid: 'The ball is coming to you. Look around.' }), 'The ball is coming to you. Look around.');
  assert.equal(briefOf({ briefKid: 'one two three four five six seven eight nine ten eleven twelve thirteen' }), '', 'too long: no line');
  assert.equal(briefOf({}), '');
});

test('pass: STRINGS keep the Player-mode copy rules (budgets, no codes, no grades, no "kid")', () => {
  const texts = [];
  const walk = (v) => {
    if (typeof v === 'string') texts.push(v);
    else if (typeof v === 'function') texts.push(String(v()), String(v(3, 5)));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(STRINGS);
  assert.ok(texts.length > 30);
  for (const s of texts) {
    assert.ok(words(s) <= 12, `≤ 12 words: ${s}`);
    assert.doesNotMatch(s, /\b[A-Z]{1,2}\d{1,2}\b/, `no principle codes: ${s}`);
    assert.doesNotMatch(s, /\bkids?\b/i, `no "kid": ${s}`);
    assert.doesNotMatch(s, /\/100|!!!|\bundefined\b|\bNaN\b/, s);
    assert.doesNotMatch(s, /\b(grade|[SABCDF])\b/, `no letter grades: ${s}`);
    assert.doesNotMatch(s, /\d\s*m\b|metre/, `no metres: ${s}`);
  }
  assert.ok(words(STRINGS.question) <= 12);
  for (const [k, v] of Object.entries(STRINGS.outcomes)) assert.ok(words(v) <= 2, k);
});

test('pass: the history entry records the choice and the outcome (mode pass)', () => {
  const h = historyEntry({
    t: 5, drill: { id: 'pass-LCB-7', title: 'Pass', principles: ['PA5'] }, role: 'LCB', option: rating.options.find((o) => o.id === 'us-ST'),
    graded: { score: 42, grade: 'F', outcome: 'cut-out' }, bestId: 'us-LCM', ms: 1200, nodeId: 'free-player',
  });
  assert.deepEqual(h, {
    t: 5, mode: 'pass', id: 'pass-LCB-7', title: 'Pass', principles: ['PA5'], role: 'LCB', score: 42, grade: 'F',
    choice: 'us-ST', outcome: 'cut-out', best: 'us-LCM', ms: 1200, nodeId: 'free-player',
  });
  assert.ok(!('baseId' in h), 'no baseId: Coach mode must not link a pass rep to #/drill');
});

test('pass: generated drills keep one record per lesson and position family (the rewards and Elo never grow per drill)', () => {
  const gen = { id: 'pass-lb-1722392227-any', principles: ['PA5', 'PA2'], learner: { role: 'LB' }, source: { kind: 'generated' } };
  assert.equal(passRecordId(gen), 'gen-PA5-FB');
  assert.equal(passRecordId({ ...gen, id: 'pass-rb-9-any', learner: { role: 'RB' } }), 'gen-PA5-FB', 'both full-backs, the same lesson');
  assert.equal(passRecordId({ id: 'pa-authored-01', kind: 'pass', principles: ['PA3'], learner: { role: 'LCM' }, source: { kind: 'authored' } }), 'pa-authored-01');
});

// ---- the set

test('pass: seeds and roles', () => {
  assert.equal(hashString('free-player'), hashString('free-player'));
  assert.notEqual(hashString('free-player'), hashString('play-forward'));
  assert.equal(nodeSeed('free-player', 2), nodeSeed('free-player', 2), 'the same play, the same set');
  assert.notEqual(nodeSeed('free-player', 0), nodeSeed('free-player', 1), 'the next play, a new set');
  assert.equal(roleFor({ role: 'LB', group: 'DEF' }), 'LB');
  assert.equal(roleFor({ role: null, group: 'WING' }), 'LW', "the group's first role, as the Road picks it");
  assert.equal(roleFor({ role: 'GK', group: 'STRIKER' }), 'ST', 'never the keeper');
  assert.equal(roleFor(null), 'LCM');
});

/** A stand-in for engine passdrill.generatePassDrill: every third seed fails its gates; seed 10 repeats an id. */
function fakeGenerator(calls) {
  return ({ seed, role, principles, catalogue }) => {
    calls.push({ seed, role, principles, catalogue });
    if (seed % 3 === 0) return null;
    return { id: seed === 10 ? 'pass-dup' : `pass-${role}-${seed}`, kind: 'pass', learner: { role }, principles: principles ?? ['PA3'], timeline: {} };
  };
}

test('pass: a quick set is 5 distinct generated drills for your position, deterministic for a seed', async () => {
  const calls = [];
  const a = await generateReps({ generate: fakeGenerator(calls), seed: 1, role: 'LB', pause: null });
  assert.equal(a.length, PASS_DEFAULTS.reps);
  assert.ok(a.every((r) => r.kind === 'pass' && r.drill.learner.role === 'LB'));
  assert.equal(new Set(a.map((r) => r.drill.id)).size, a.length, 'distinct');
  assert.ok(calls.every((c) => Array.isArray(c.principles) && c.principles.length === 0), 'mixed: no principle filter');
  const b = await generateReps({ generate: fakeGenerator([]), seed: 1, role: 'LB', pause: null });
  assert.deepEqual(a.map((r) => r.drill.id), b.map((r) => r.drill.id), 'deterministic');
  const c = await generateReps({ generate: fakeGenerator([]), seed: 2, role: 'LB', pause: null });
  assert.notDeepEqual(a.map((r) => r.drill.id), c.map((r) => r.drill.id), 'another seed, another set');
  const dup = await generateReps({ generate: ({ seed }) => (seed < 50 ? { id: 'same' } : { id: `d${seed}` }), seed: 1, count: 2, tries: 3, pause: null });
  assert.equal(dup.length, 1, 'a rep that finds nothing new within its tries is dropped');
  const skipped = await generateReps({ generate: ({ seed }) => ({ id: `d${seed}` }), seed: 1, count: 1, skip: ['d1'], pause: null });
  assert.deepEqual(skipped.map((r) => r.drill.id), ['d2'], 'never a drill the set already has');
  assert.deepEqual(await generateReps({ generate: null }), []);
  const logged = [];
  const throwing = await generateReps({ generate: () => { throw new Error('boom'); }, count: 1, tries: 2, pause: null, warn: (...a) => logged.push(a) });
  assert.deepEqual(throwing, [], 'a failing generator never breaks the set');
  assert.equal(logged.length, 2, '...and says so');
});

test('pass: a Road node set uses road.buildSet (pass reps), tops up from the generator, and sends spot nodes to #/play', async () => {
  const node = { id: 'free-player', kind: 'pass', title: 'Find the Free Player', principles: ['PA3', 'PA4'] };
  let seen = null;
  const buildSet = async (n, ctx) => {
    seen = { n, ctx };
    return [
      { kind: 'pass', drill: { id: 'pass-a', principles: ['PA3'] } },
      { kind: 'spot', scenario: { id: 'm1-01' }, mirrored: false },
      { kind: 'pass', drill: { id: 'pass-b', principles: ['PA4'] } },
    ];
  };
  const calls = [];
  const catalogue = { byId: { PA3: { id: 'PA3', kidName: 'Find the Free Player' } } };
  const ctx = { node, road: { chapters: [] }, profile: { role: 'LB' }, role: 'LB', seed: 42, formations: { us: 1 }, index: [], rewards: { xp: 0 }, skills: { theta: {} }, catalogue };
  const { reps, redirect } = await assembleSet(ctx, { buildSet, generatePassDrill: fakeGenerator(calls) });
  assert.equal(redirect, undefined);
  assert.equal(seen.n, node);
  assert.deepEqual(Object.keys(seen.ctx).sort(), ['catalogue', 'formations', 'index', 'profile', 'rewards', 'road', 'seed', 'skills']);
  assert.equal(seen.ctx.seed, 42);
  assert.equal(seen.ctx.catalogue, catalogue, 'the generated drills are named from data/principles.json');
  assert.equal(reps.length, 5);
  assert.deepEqual(reps.slice(0, 2).map((r) => r.drill.id), ['pass-a', 'pass-b'], "the node's own drills first");
  assert.ok(reps.every((r) => r.kind === 'pass'));
  assert.ok(calls.length && calls.every((c) => c.principles.join() === 'PA3,PA4' && c.role === 'LB'), "topped up on the node's principles");

  const full = await assembleSet(ctx, { buildSet: async () => Array.from({ length: 6 }, (_, i) => ({ kind: 'pass', drill: { id: `p${i}` } })), generatePassDrill: () => { throw new Error('not needed'); } });
  assert.deepEqual(full.reps.map((r) => r.drill.id), ['p0', 'p1', 'p2', 'p3', 'p4'], 'five, never more');

  const spot = await assembleSet(ctx, { buildSet: async () => [{ kind: 'spot', scenario: {} }], generatePassDrill: fakeGenerator([]) });
  assert.equal(spot.redirect, '#/play/free-player');
  assert.deepEqual(spot.reps, []);

  const broken = await assembleSet(ctx, { buildSet: async () => { throw new Error('no road'); }, generatePassDrill: fakeGenerator([]), warn: () => {} });
  assert.equal(broken.reps.length, 5, 'a failing buildSet falls back to generated drills');

  const quick = await assembleSet({ role: 'ST', seed: 7 }, { generatePassDrill: fakeGenerator([]) });
  assert.equal(quick.reps.length, 5);
  assert.ok(quick.reps.every((r) => r.drill.learner.role === 'ST'));
});

test("pass: the quick set is the engine's balanced set (generatePassSet), topped up when it comes back short", async () => {
  let asked = null;
  const generatePassSet = (opts) => { asked = opts; return [{ id: 'set-1' }, { id: 'set-2' }, { id: 'set-3' }, { id: 'set-4' }]; };
  const calls = [];
  const catalogue = { byId: {} };
  const { reps } = await assembleSet({ role: 'LW', seed: 11, formations: { us: 1 }, catalogue }, { generatePassSet, generatePassDrill: fakeGenerator(calls), warn: () => {} });
  assert.deepEqual({ seed: asked.seed, count: asked.count, role: asked.role }, { seed: 11, count: 5, role: 'LW' });
  assert.equal(asked.catalogue, catalogue, 'the drills are named from the principles');
  assert.deepEqual(reps.map((r) => r.drill.id).slice(0, 4), ['set-1', 'set-2', 'set-3', 'set-4']);
  assert.equal(reps.length, 5, 'one more from generatePassDrill');
  assert.ok(calls.length >= 1 && calls[0].catalogue === catalogue);
  const failing = await assembleSet({ role: 'LW', seed: 11 }, { generatePassSet: () => { throw new Error('boom'); }, generatePassDrill: fakeGenerator([]), warn: () => {} });
  assert.equal(failing.reps.length, 5, 'a failing set generator falls back to single drills');
  const node = { id: 'free-player', kind: 'pass', principles: ['PA3'] };
  let usedSet = false;
  await assembleSet({ node, role: 'LW', seed: 1 }, { buildSet: async () => [{ kind: 'pass', drill: { id: 'n1' } }], generatePassSet: () => { usedSet = true; return []; }, generatePassDrill: fakeGenerator([]) });
  assert.ok(!usedSet, 'a Road node takes its drills from road.buildSet');
});

test('pass: the quick set comes from road.buildQuickPassSet when the Road has it (no look-alike reps)', async () => {
  let asked = null, usedSet = false;
  const catalogue = { byId: {} };
  const buildQuickPassSet = async (opts) => { asked = opts; return [1, 2, 3, 4, 5].map((i) => ({ kind: 'pass', drill: { id: `q-${i}` }, nodeId: 'quick' })); };
  const { reps } = await assembleSet({ role: 'LW', profile: { role: 'LW' }, seed: 12, formations: { us: 1 }, catalogue }, { buildQuickPassSet, generatePassSet: () => { usedSet = true; return []; }, generatePassDrill: fakeGenerator([]) });
  assert.deepEqual(reps.map((r) => r.drill.id), ['q-1', 'q-2', 'q-3', 'q-4', 'q-5']);
  assert.ok(!usedSet);
  assert.deepEqual({ seed: asked.seed, count: asked.count, role: asked.profile.role, catalogue: asked.catalogue }, { seed: 12, count: 5, role: 'LW', catalogue });
  // With the real Road and engine: five drills for a full-back, none two that look the same, 3 of 5 with a forward best.
  const road = await import('../js/ui/player/road.js');
  const { createFormation } = await import('../js/engine/formation.js');
  const F = createFormation(await loadJSON('data/formations/helios-433.json'));
  const principles = await loadJSON('data/principles.json');
  const quick = await road.buildQuickPassSet({ profile: road.pickGroup(null, 'DEF'), seed: 1722392227, formations: { us: F, them: F }, catalogue: principles });
  assert.equal(quick.length, 5);
  const pics = quick.map(road.repPicture);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) assert.ok(!road.nearDuplicate(pics[i], pics[j]), `reps ${i} and ${j} look the same`);
  const forward = quick.filter((r) => r.drill.rating.best.direction === 'forward' || r.drill.rating.best.tags.some((t) => t.tag === 'switch')).length;
  assert.ok(forward >= 3, `${forward} forward bests`);
});

// ---- the contract with the engine (js/engine/passing.js), on a real frame

test('pass: every option the engine rates gets a target, a label, an outcome, a short line and a Why? sheet', async () => {
  const engine = await import('../js/engine/passing.js');
  const frame = makeFrame('ipBuildUp');
  const r = engine.rateOptions(frame, 'us-LCB');
  const byReceiver = optionsByReceiver(r.options, 'us-LCB');
  assert.equal(byReceiver.size, 10, 'a target for every teammate');
  for (const o of r.options) assert.ok(Object.hasOwn(LABELS, o.label), `a known label: ${o.label}`);
  const principles = { PA3: { kidName: 'Find the Free Player', summary: { kid: 'Pass to the teammate with nobody close.' } } };
  let sawBest = false;
  for (const o of byReceiver.values()) {
    const g = engine.gradePass(r, o.id);
    assert.ok(g && Number.isInteger(starsOf(g)) && starsOf(g) >= 0 && starsOf(g) <= 3, o.id);
    const out = passOutcome(o, g);
    assert.ok(out.text && out.shape, `${o.id}: an outcome word`);
    if (out.intercepted) assert.deepEqual(passFlight(frame, o, out).to, o.blocker.at, `${o.id}: cut out where the engine says`);
    const ex = engine.explainPass(r, o.id, { wording: 'kid' });
    const line = pickLine(ex, { good: g.isBest || o.label === 'good' });
    assert.ok(words(line) <= 14, `${o.id}: ${line}`);
    assert.notEqual(line, ex.headline, `${o.id}: the line is not the consequence word`);
    const w = whyFor({ explain: ex, principles, drill: { principles: ['PA3'] }, isBest: g.isBest, option: o, line });
    assert.ok(words([w.title, w.summary, ...w.reasons, ...w.praise].join(' ')) <= 60, `${o.id}: Why? fits`);
    if (!g.isBest) assert.ok(w.reasons.length >= 1, `${o.id}: a miss hears the best pass's reason`);
    if (o.id === r.best.id) { sawBest = true; assert.equal(starsOf(g), 3, 'the best is 3 stars'); }
  }
  assert.ok(sawBest, 'the best option is one of the targets');
  const m = revealMarkers({ rating: r, frame, carrierId: 'us-LCB', choiceId: r.options.at(-1).id });
  assert.equal(m.filter((x) => x.receiverId).length, 10);
  assert.ok(m.some((x) => x.lane && x.optionId === r.best.id), 'the best lane');
});

test('pass: a generated drill plays as the screen expects: YOU on the ball at the freeze, every teammate a target', async () => {
  const [pd, { buildFormations }] = await Promise.all([import('../js/engine/passdrill.js'), import('../js/data.js')]);
  const formations = buildFormations(await loadJSON('data/formations/helios-433.json'));
  const drill = pd.generatePassDrill({ seed: 3, role: 'LCM', formations });
  assert.ok(drill, 'a drill for seed 3');
  const { freezeAt } = timing(drill);
  const freeze = pd.passDrillFrame(drill, freezeAt, { formations });
  assert.equal(carrierOf(drill), 'us-LCM');
  assert.equal(freeze.carrierId, carrierOf(drill), 'YOU have the ball at the freeze');
  const r = pd.passDrillRating(drill, { formations });
  assert.equal(optionsByReceiver(r.options, carrierOf(drill)).size, 10, 'ten numbered targets');
  assert.equal(questionOf(drill), STRINGS.question);
  assert.ok(repTitle(drill) && words(repTitle(drill)) <= 5, `a short title: ${repTitle(drill)}`);
  const f = repFocus([pd.passDrillFrame(drill, Math.max(0, freezeAt - PASS_DEFAULTS.watch), { formations }), freeze], r);
  for (const o of r.options) {
    const p = freeze.players.find((q) => q.id === receiverOf(o));
    assert.ok(p.x >= f.x0 && p.x <= f.x1, `${o.id} stays in view on a phone`);
  }
});

// ---- the play-test fixes: the question, fewer targets and labels on a phone, the better pass named, redirects

test('pass: the question is the task: "Pick the best pass." (12 words or fewer)', () => {
  assert.equal(STRINGS.question, 'Pick the best pass.');
  assert.ok(words(STRINGS.question) <= 12);
  assert.equal(questionOf({ questionKid: "Who's open?", source: { kind: 'generated' } }), 'Pick the best pass.');
});

test('pass: no target far from the ball, nor the keeper, unless that pass is really on', () => {
  const byReceiver = optionsByReceiver(rating.options, 'us-LCB');
  assert.equal(genuinelyOn(opt('us-GK', 'good', 79)), true, 'a safe pass is on');
  assert.equal(genuinelyOn(opt('us-GK', 'good', 60, { tags: [{ tag: 'too-safe', kind: 'problem' }] })), false, 'the too-safe one is not');
  assert.equal(genuinelyOn(best), true);
  assert.equal(genuinelyOn(opt('us-ST', 'risky', 70)), false);
  const far = { ...frame, players: frame.players.map((p) => (p.id === 'us-RW' ? { ...p, x: 70, y: 64 } : p)) }; // 60 m from the ball
  const t = passTargets(byReceiver, far, 'us-LCB');
  assert.ok(!t.has('us-RW'), 'the right winger, 60 m away and cut out: no target');
  assert.ok(t.has('us-GK'), 'the keeper, safe here: a target');
  const noKeeper = passTargets(new Map([...byReceiver, ['us-GK', opt('us-GK', 'risky', 60)]]), frame, 'us-LCB');
  assert.ok(!noKeeper.has('us-GK'), 'the keeper when that pass is not on: no target');
  const longBest = new Map([['us-RW', { ...opt('us-RW', 'best', 100), point: { x: 70, y: 64 } }]]);
  assert.ok(passTargets(longBest, far, 'us-LCB').has('us-RW'), 'a long pass that is the best stays');
  assert.equal(PASS_DEFAULTS.farPass, 45);
});

test('pass: the reveal labels the best, your pick and two others (a good one beside a trap), each where it covers nobody', () => {
  const byReceiver = optionsByReceiver(rating.options, 'us-LCB');
  const picks = revealPicks(byReceiver, { frame, carrierId: 'us-LCB', choiceId: 'us-ST', bestId: 'us-LCM' });
  assert.equal(picks.size, 4, [...picks].join());
  assert.ok(picks.has('us-LCM') && picks.has('us-ST'), 'the best and yours');
  const others = [...picks].filter((id) => id !== 'us-LCM' && id !== 'us-ST');
  assert.ok(others.some((id) => byReceiver.get(id).label === 'risky' || byReceiver.get(id).label === 'offside'), 'one of another colour: the risky pass nearest the ball');
  assert.equal(revealPicks(byReceiver, { frame, carrierId: 'us-LCB', choiceId: 'us-LCM', bestId: 'us-LCM' }).size, 3, 'the best picked: it and two others');
  const m = revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-ST', labels: picks });
  assert.deepEqual(m.filter((x) => x.receiverId).map((x) => x.receiverId).sort(), [...picks].sort(), 'only those are labelled');
  // A label goes to the side of its player where nobody stands: here, a teammate just above (as the screen shows it).
  const crowd = { players: [P('us-LCM', 42, 24), P('them-DM', 42, 20.5)] };
  assert.equal(labelSide({ at: { x: 42, y: 24 }, text: '★ Best', frame: crowd, orientation: 'horizontal', k: 1, skip: ['us-LCM'] }), 'below');
  assert.equal(labelSide({ at: { x: 42, y: 24 }, text: '★ Best', frame: { players: [P('them-DM', 42, 27.5)] }, orientation: 'horizontal', k: 1 }), 'above', 'the same, the other way');
  assert.equal(labelSide({ at: { x: 42, y: 24 }, text: '★ Best', frame: { players: [P('them-DM', 45, 24)] }, orientation: 'vertical', k: 1 }), 'below', 'a phone: up the screen is forward');
  assert.equal(labelSide({ at: { x: 42, y: 24 }, text: '★ Best', frame: { players: [] } }), 'above', 'nobody near: above');
  const taken = [];
  labelSide({ at: { x: 42, y: 24 }, text: '★ Best', frame: { players: [] }, taken });
  assert.equal(labelSide({ at: { x: 43, y: 24 }, text: '✓ Good', frame: { players: [] }, taken }), 'below', 'never over an earlier label');
  // The crop: the ball and the labelled players, not the whole team.
  const f = revealFocus({ rating, frame, carrierId: 'us-LCB', labels: new Set(['us-LCM', 'us-DM']), choiceId: 'us-DM' });
  assert.deepEqual(f, { x0: 22 - PASS_DEFAULTS.focusPad, x1: 42 + PASS_DEFAULTS.focusPad });
  assert.equal(PASS_DEFAULTS.revealOthers, 2);
});

test('pass: a safe pass that was not the best names the better one in simple words ("Safe. Your striker\'s run was on.")', () => {
  const runBest = { id: 'us-ST@space', targetId: 'us-ST', label: 'best', tags: [{ tag: 'into-space', kind: 'strength', kidTo: 'your striker' }] };
  const safe = { id: 'us-RCB', label: 'good', tags: [] };
  const r = { options: [runBest, safe], best: runBest };
  const explain = { line: 'A safe pass that keeps the ball.', yours: { text: 'A safe pass that keeps the ball.' }, best: { text: 'Your striker can run onto it.', tag: 'into-space', id: 'us-ST@space' } };
  assert.equal(betterLine({ explain, rating: r, option: safe }), "Safe. Your striker's run was on.");
  assert.equal(betterLine({ explain: { ...explain, best: { ...explain.best, tag: 'free' } }, rating: r, option: safe }), 'Safe. Your striker was free, with nobody close.');
  assert.equal(betterLine({ explain: { ...explain, best: { ...explain.best, tag: 'weird' } }, rating: r, option: safe }), 'Safe. Your striker was the better pass.');
  assert.equal(betterLine({ explain, rating: r, option: { ...safe, label: 'risky' } }), null, 'only after a safe pass');
  assert.equal(betterLine({ explain, rating: r, option: safe, graded: { isBest: true } }), null, 'not after one as good as the best');
  assert.equal(betterLine({ explain: { ...explain, best: null }, rating: r, option: safe }), null, 'not after the best');
  for (const [k, f] of Object.entries(STRINGS.better)) assert.ok(words(`${STRINGS.safe} ${f('your midfielder')}`) <= 14, k);
});

test('pass: with the engine, every safe pass that is not the best gets a line naming the better pass, 14 words at most', async () => {
  const engine = await import('../js/engine/passing.js');
  let seen = 0;
  for (const name of ['ipBuildUp', 'ipProgression', 'ipFinalThird']) {
    let f;
    try { f = makeFrame(name); } catch { continue; }
    if (!f?.carrierId) continue;
    const r = engine.rateOptions(f, f.carrierId);
    for (const o of r.options) {
      const g = engine.gradePass(r, o.id);
      const ex = engine.explainPass(r, o.id, { wording: 'kid' });
      const line = betterLine({ explain: ex, rating: r, option: o, graded: g });
      if (o.label === 'good' && !g.isBest) {
        assert.ok(line && /^Safe\. /.test(line), `${name} ${o.id}: ${line}`);
        assert.ok(words(line) <= 14, line);
        assert.doesNotMatch(line, /\b(?:your teammate)\b/, `${name} ${o.id}: the better pass is named (${line})`);
        seen++;
      } else assert.equal(line, null, `${name} ${o.id} (${o.label})`);
    }
  }
  assert.ok(seen > 0, 'the check saw safe passes that were not the best');
});

test('pass: a spot node goes to #/play before any set is built; the history keeps the stars shown', async () => {
  const node = { id: 'close-down', kind: 'spot', principles: ['D1'] };
  let built = false;
  const r = await assembleSet({ node, road: {}, role: 'LB', seed: 1 }, { repKind: () => 'spot', buildSet: async () => { built = true; return []; }, generatePassDrill: fakeGenerator([]) });
  assert.deepEqual(r, { reps: [], redirect: '#/play/close-down' });
  assert.equal(built, false, 'no set built for the redirect (it once built a whole spot set first)');
  let ctxSeen = null;
  await assembleSet({ node: { id: 'free-player', kind: 'pass', principles: ['PA3'] }, role: 'LB', seed: 1, app: { id: 'app' } }, {
    repKind: () => 'pass', buildSet: async (_n, ctx) => { ctxSeen = ctx; return [{ kind: 'pass', drill: { id: 'a' } }]; }, generatePassDrill: fakeGenerator([]),
  });
  assert.deepEqual(ctxSeen.app, { id: 'app' }, 'the app goes to road.js, which counts the set as begun');
  const h = historyEntry({ t: 1, drill: { id: 'x', principles: ['PA3'] }, role: 'LB', option: { id: 'us-ST', label: 'good' }, graded: { score: 80, outcome: 'completed' }, stars: 2 });
  assert.equal(h.stars, 2);
  assert.equal('stars' in historyEntry({ t: 1, drill: {}, role: 'LB', option: null, graded: null, stars: 9 }), false);
});

test('pass: the quick set is the free-player idea mixed with playing forward (the Road\'s quickPass)', async () => {
  const road = await import('../js/ui/player/road.js');
  const r = road.normalizeRoad(await loadJSON('data/road.json'));
  assert.deepEqual(r.quickPass, ['free-player', 'play-forward']);
  const calls = [];
  const gen = (o) => { calls.push(o); return { id: `pass-${o.seed}-${o.principles.join('')}`, kind: 'pass', learner: { role: o.role }, principles: [...o.principles] }; };
  const quick = await road.buildQuickPassSet({ road: r, profile: road.pickGroup(null, 'MID'), seed: 3, generators: { pass: gen, forwardable: () => true } });
  assert.equal(quick.length, 5);
  assert.deepEqual(quick.map((q) => q.lesson), ['free-player', 'play-forward', 'free-player', 'play-forward', 'free-player']);
  assert.ok(quick.every((q) => q.nodeId === road.QUICK_PASS));
  assert.deepEqual([...calls].sort((a, b) => a.seed - b.seed).map((c) => c.principles.join()), ['PA3,PA4', 'PA2,PA5', 'PA3,PA4', 'PA2,PA5', 'PA3,PA4'], 'slot by slot');
});

test('pass: a phone zooms its reveal onto the play (the board keeps the whole width, so the stage shows a slice of it)', () => {
  const phone = { width: 359, height: 470 };
  // The ball, the best and your pick on the left half: zoomed, and slid so the play is in the middle.
  const z = revealZoom({ rating, frame, carrierId: 'us-LCB', labels: new Set(['us-LCM', 'us-LB']), choiceId: 'us-LB@space', stage: phone });
  assert.ok(z && z.z >= PASS_DEFAULTS.zoomMin && z.z <= PASS_DEFAULTS.zoomMax, JSON.stringify(z));
  assert.equal(z.width, Math.round(phone.width * z.z));
  assert.ok(z.offset >= 0 && z.offset <= z.width - phone.width);
  const px = z.width / 74; // CSS px per metre across the pitch
  for (const y of [8, 24, 26]) { // the left back's run, the midfielder, the ball
    const at = (y + 3) * px - z.offset;
    assert.ok(at >= 0 && at <= phone.width, `y ${y} is on screen (${Math.round(at)} px)`);
  }
  // Play from touchline to touchline: no zoom worth having.
  assert.equal(revealZoom({ rating, frame, carrierId: 'us-LCB', labels: new Set(['us-LB', 'us-RB']), choiceId: 'us-RB', stage: phone }), null);
  // A long stretch of pitch: the length must still fit, so it zooms less or not at all.
  const tall = revealZoom({ rating, frame, carrierId: 'us-LCB', labels: new Set(['us-LCM', 'us-LW']), choiceId: 'us-LW', stage: { width: 359, height: 300 } });
  assert.ok(!tall || tall.z < z.z, JSON.stringify(tall));
  assert.equal(revealZoom({ rating, frame, carrierId: 'us-LCB', stage: { width: 0, height: 0 } }), null);
});
