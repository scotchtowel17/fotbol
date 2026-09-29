// "Who's open?" (js/ui/player/pass.js): the pure helpers. Labels and outcomes, option order, the reveal's markers,
// the pass's flight, the words, and the set built with stubbed dependencies (the engine and road.js are other areas').
import { test, assert, approx, loadJSON, isNode } from './harness.js';
import { makeFrame } from './fixtures.js';
import { timing } from '../js/engine/timeline.js';
import {
  PASS_DEFAULTS, STRINGS, LABELS, labelStyle, outcomeKey, passOutcome, starsOf, wordFor, receiverOf, optionsByReceiver,
  orderTargets, rankOptions, shirtOf, carrierOf, roleOfDrill, aimOf, revealMarkers, previewMarkers, flashMarkers, passFlight,
  flightFrame, repFocus, BOARD_TONES, pickLine, whyFor, repTitle, questionOf, briefOf, historyEntry, passRecordId, hashString, nodeSeed, roleFor,
  generateReps, assembleSet, genuinelyOn, passTargets, revealPicks, labelSide, labelSpot, betterLine, revealCamera, repCamera, passScene, TOKEN_RADIUS,
  chooseCamera, flightCamera, cardSpot, mount, passSpeaker, nameExplain, refsOf, revealWords, drawnFrame,
} from '../js/ui/player/pass.js';
import { fakePage, recordingBoard } from './player-mount.js';

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

// ---- whom the words mean: a group the picture shows more than once named by shirt number, as "Find your spot" does

test('pass: the reveal names a player by shirt number where the picture shows more of the group; one shown, the singular', async () => {
  const { STRINGS: PLAY_WORDS } = await import('../js/ui/player/play.js');
  // YOU (#4) on the ball; two of your midfielders, one striker; two of their midfielders and a centre-back.
  const pic = { carrierId: 'us-LCB', players: [P('us-LCB', 22, 26), P('us-LCM', 42, 24), P('us-RCM', 44, 44), P('us-ST', 60, 34), P('them-DM', 50, 32), P('them-LCM', 48, 20), P('them-RCB', 70, 40)] };
  const say = passSpeaker({ frame: pic });
  // Two of the group drawn: the one the line is about, by the number on his shirt (the review: "Your midfielder was
  // free" with two of your midfielders on show).
  assert.equal(say('Your midfielder was free, with nobody close.', ['us-RCM']), 'Your number 10 was free, with nobody close.');
  assert.equal(say('Their midfielder is very close to your midfielder.', ['them-LCM', 'us-LCM']), 'Their number 8 is very close to your number 8.');
  assert.equal(say("Safe. Your midfielder's run was on.", ['us-LCM']), "Safe. Your number 8's run was on.");
  assert.ok(PLAY_WORDS.yourNumber(8) === 'your number 8' && PLAY_WORDS.theirNumber(6) === 'their number 6', 'the words play.js says it with');
  // One drawn: the words as they are.
  assert.equal(say('Your striker can run onto it.', ['us-ST']), 'Your striker can run onto it.');
  assert.equal(say('Their defender is in the way.', ['them-RCB']), 'Their defender is in the way.');
  // A plural group: two or more drawn, as it is; one, the singular (the review: "It goes past their midfielders." with
  // one); nobody of it drawn, nothing to say.
  assert.equal(say('It goes past their midfielders.'), 'It goes past their midfielders.');
  assert.equal(say('It gets in behind their defenders.'), 'It gets in behind their defender.');
  assert.equal(say('Their players will probably cut it out.'), 'Their players will probably cut it out.');
  assert.equal(passSpeaker({ frame: { players: [P('us-LCB', 22, 26), P('us-ST', 60, 34), P('them-DM', 50, 32)] }, carrierId: 'us-LCB' })('Their players will probably cut it out.'), 'Their player will probably cut it out.');
  assert.equal(say('It gets past their front players.'), null, 'none of their front players drawn');
  assert.equal(say('Their winger is in the way.', ['them-LW']), null, 'a group nobody drawn is in');
  assert.equal(say('Your midfielder was free, with nobody close.', []), null, 'two drawn and nobody to say which: not shown');
  // YOUR kit number on YOUR shirt, and the teammate whose number it is wears yours (board.js shirtNumberOf).
  assert.equal(passSpeaker({ frame: pic, youNumber: 10 })('Your midfielder was free, with nobody close.', ['us-RCM']), 'Your number 4 was free, with nobody close.');
  // Whom a line is about: the player its reason names (the defender in the way), then the receiver.
  const cut = { id: 'us-ST', targetId: 'us-ST', kind: 'feet', label: 'cut-out', tags: [{ tag: 'blocked', kind: 'problem', whoId: 'them-DM', kidWho: 'their midfielder', kidTo: 'your striker' }] };
  assert.deepEqual(refsOf(cut, 'blocked'), ['them-DM', 'us-ST']);
  assert.deepEqual(refsOf(cut), ['us-ST']);
  assert.deepEqual(refsOf({ id: 'us-LW@space', targetId: 'us-LW', kind: 'space', tags: [] }, 'into-space'), ['us-LW']);
  assert.equal(say('Their midfielder is in the way.', refsOf(cut, 'blocked')), 'Their number 6 is in the way.');
});

test('pass: the reveal line and the Why? sheet say whom they mean (revealWords: the better pass, your pass, the best one)', () => {
  const pic = { carrierId: 'us-LCB', players: [P('us-LCB', 22, 26), P('us-LCM', 42, 24), P('us-RCM', 44, 44), P('us-ST', 60, 34), P('them-DM', 50, 32), P('them-LCM', 48, 20)] };
  const runBest = { id: 'us-RCM@space', targetId: 'us-RCM', kind: 'space', label: 'best', tags: [{ tag: 'into-space', kind: 'strength', kidTo: 'your midfielder' }] };
  const safe = { id: 'us-LCM', targetId: 'us-LCM', kind: 'feet', label: 'good', tags: [{ tag: 'free', kind: 'strength', kidTo: 'your midfielder' }] };
  const cut = { id: 'us-ST', targetId: 'us-ST', kind: 'feet', label: 'cut-out', tags: [{ tag: 'blocked', kind: 'problem', whoId: 'them-LCM', kidWho: 'their midfielder', kidTo: 'your striker' }] };
  const r = { options: [runBest, safe, cut], best: runBest };
  const explainSafe = { line: 'Your midfielder is free, with nobody close.', yours: { text: 'Your midfielder is free, with nobody close.', tag: 'free' }, best: { text: 'Your midfielder can run onto it.', tag: 'into-space', id: runBest.id }, more: [] };
  // A safe pass that was not the best: the better one, named (the best's receiver, not yours).
  const w = revealWords({ explain: explainSafe, rating: r, option: safe, graded: { isBest: false }, frame: pic });
  assert.equal(w.line, "Safe. Your number 10's run was on.");
  assert.deepEqual(w.why.reasons, ['Your number 10 can run onto it.'], 'the Why? sheet: the best pass\'s reason, named');
  // Your line and the more reasons are about your pass; the best's about the best.
  const explainCut = { line: 'Their midfielder is in the way.', yours: { text: 'Their midfielder is in the way.', tag: 'blocked' }, best: { text: 'Your midfielder can run onto it.', tag: 'into-space', id: runBest.id }, more: [{ text: 'Their midfielder is very close to your striker.', tag: 'blocked' }] };
  const named = nameExplain(explainCut, { rating: r, option: cut, say: passSpeaker({ frame: pic }) });
  assert.equal(named.line, 'Their number 8 is in the way.');
  assert.equal(named.yours.text, named.line);
  assert.equal(named.best.text, 'Your number 10 can run onto it.');
  assert.equal(named.more[0].text, 'Their number 8 is very close to your striker.');
  const c = revealWords({ explain: explainCut, rating: r, option: cut, graded: { isBest: false }, frame: pic });
  assert.equal(c.line, 'Their number 8 is in the way.');
  assert.ok(c.why.reasons.includes('Your number 10 can run onto it.'), c.why.reasons.join(' / '));
  // One of the group drawn: the words as the engine says them.
  const one = { ...pic, players: pic.players.filter((p) => p.id !== 'us-LCM' && p.id !== 'them-DM') };
  assert.equal(revealWords({ explain: explainCut, rating: r, option: cut, graded: { isBest: false }, frame: one }).line, 'Their midfielder is in the way.');
  // A line that cannot say whom it means is passed over for the next one (here the best's), never shown unnamed.
  const unsure = { ...explainCut, line: 'Your midfielder is free.', yours: { text: 'Your midfielder is free.', tag: 'nobody-knows' } };
  const u = revealWords({ explain: unsure, rating: r, option: { ...cut, targetId: 'us-GK', id: 'us-GK' }, graded: { isBest: false }, frame: pic });
  assert.equal(u.line, 'Your number 10 can run onto it.');
  // The fallback line after a good pass names the teammate it got to.
  assert.equal(pickLine({}, { good: true, say: (t) => passSpeaker({ frame: pic })(t, ['us-ST']) }), 'Good pass. It got to your number 9.');
  assert.equal(pickLine({}, { good: true }), STRINGS.lineGood);
});

test('pass: with the engine, every reveal line and Why? sentence says whom it means (real drills, every stage)', async (t) => {
  // The review: 8 of 30 reveals named "your midfielder" with two drawn, and some "their midfielders" with one. Generated
  // drills of 6 positions x 3 seeds at every stage that can teach them, every pass a tap can pick, YOUR kit number or not.
  const [pd, cast, engine, { buildFormations, normalizePrinciples }, { shirtNumberOf }, { familyOf }] = await Promise.all([
    import('../js/engine/passdrill.js'), import('../js/engine/cast.js'), import('../js/engine/passing.js'), import('../js/data.js'), import('../js/ui/board.js'), import('../js/engine/roles.js'),
  ]);
  const formations = buildFormations(await loadJSON('data/formations/helios-433.json'));
  const catalogue = normalizePrinciples(await loadJSON('data/principles.json'));
  const FAM = { defender: ['CB', 'FB'], midfielder: ['DM', 'CM'], winger: ['W'], striker: ['ST'], keeper: ['GK'], goalkeeper: ['GK'], teammate: null, player: null, 'front player': ['W', 'ST'] };
  const GROUP = /\b(their|your)\s+(front player|defender|midfielder|winger|striker|keeper|goalkeeper|teammate|player)(s?)\b(?![-\w])/gi;
  const problems = (text, players, you, youNumber) => {
    const out = [];
    for (const m of text.matchAll(GROUP)) {
      const team = m[1].toLowerCase() === 'their' ? 'them' : 'us', word = m[2].toLowerCase(), plural = !!m[3];
      const n = players.filter((p) => p.id !== you && p.team === team && (FAM[word] === null || FAM[word].includes(familyOf(p.role)))).length;
      if (!n) out.push(`${m[0]}: nobody drawn`);
      else if (plural && n < 2) out.push(`${m[0]}: ${n} drawn`);
      else if (!plural && n > 1) out.push(`${m[0]}: ${n} drawn, which one?`);
    }
    for (const m of text.matchAll(/\b(their|your)\s+number\s+(\d+)/gi)) {
      const team = m[1].toLowerCase() === 'their' ? 'them' : 'us';
      if (!players.some((p) => p.team === team && p.id !== you && shirtNumberOf(p.id, { learnerId: you, youNumber }) === Number(m[2]))) out.push(`${m[0]}: no such shirt drawn`);
    }
    return out;
  };
  let lines = 0, named = 0, singular = 0, k = 0;
  for (const role of ['LCB', 'LB', 'DM', 'LCM', 'LW', 'ST']) {
    for (const seed of [1, 2, 4]) {
      const drill = pd.generatePassDrill({ seed, role, formations, catalogue });
      if (!drill) continue;
      const st = cast.stagesOf({ kind: 'pass', drill }, { formations, principles: catalogue });
      for (const stage of ['small', 'medium', 'full']) {
        if (!st[stage]) continue;
        const scene = passScene(drill, stage === 'full' ? null : st[stage], { formations, passdrill: pd, reduceFrame: cast.reduceFrame });
        const youNumber = [null, 8, 4][k++ % 3];
        for (const option of scene.byReceiver.values()) {
          const graded = engine.gradePass(scene.rating, option.id, { accept: scene.accept });
          const explain = engine.explainPass(scene.rating, option.id, { wording: 'kid', accept: scene.accept, focus: drill.principles });
          const { line, why } = revealWords({ explain, rating: scene.rating, option, graded, frame: scene.freeze, carrierId: scene.carrierId, youNumber, principles: catalogue.byId, drill });
          const where = `${drill.id} ${stage} ${option.id}`;
          assert.ok(line && words(line) <= 14, `${where}: "${line}"`);
          for (const s of [line, ...why.reasons, ...why.praise]) assert.deepEqual(problems(s, scene.freeze.players, scene.carrierId, youNumber), [], `${where}: "${s}"`);
          lines++;
          if (/\bnumber \d/.test(line)) named++;
          if (/\btheir (midfielder|defender|front player)\b(?!s)/.test(line) && /past|behind/.test(line)) singular++;
        }
      }
    }
  }
  t?.diagnostic?.(`${lines} reveal lines: ${named} name a player by number, ${singular} a line passed in the singular`);
  assert.ok(lines > 150 && named > 20, `${lines} lines, ${named} named`);
});

// ---- the reveal meets the figures where the board draws them (board.js drawnAt: the declutter moves a figure up to 1 m)

test('pass: the reveal\'s labels, lanes, runs and the preview line meet the figures where the board draws them', () => {
  const lay = { orientation: 'horizontal', k: 1, pad: 1.8, body: 4.3, half: 1.5, ballK: 1 };
  const posOf = (id) => frame.players.find((p) => p.id === id);
  // Everyone (and the ball, here loose) drawn the same 0.8 m off: everything on the pitch moves with them.
  const d = { x: 0.6, y: -0.53 };
  const shift = (p) => ({ x: p.x + d.x, y: p.y + d.y });
  const all = (id) => shift(id === 'ball' ? frame.ball : posOf(id));
  const loose = { ...frame, carrierId: null };
  const plain = revealMarkers({ rating, frame: loose, carrierId: 'us-LCB', choiceId: 'us-ST', ...lay });
  const moved = revealMarkers({ rating, frame: loose, carrierId: 'us-LCB', choiceId: 'us-ST', ...lay, drawnAt: all });
  assert.equal(moved.length, plain.length);
  for (const [i, m] of moved.entries()) {
    const q = plain[i];
    assert.equal(m.type, q.type);
    if (m.type === 'label') { approx(m.at.x, q.at.x + d.x, 1e-9, `${m.text} moves with its player`); approx(m.at.y, q.at.y + d.y, 1e-9); assert.equal(m.side, q.side); }
    if (m.lane) { assert.deepEqual(m.a, shift(q.a), 'from the ball as drawn'); assert.deepEqual(m.b, shift(q.b), `${m.optionId}: to the receiver as drawn`); }
    if (m.type === 'ring') assert.equal(m.id, q.id, 'rings go by the player (the board draws them round the figure)');
  }
  // One receiver drawn off his spot: his label is placed as if he stood there, his lane ends on him, and the ✗ where it
  // is cut out stays on the lane as drawn (as far along it and to its side).
  const st = { x: 60 - 0.7, y: 34 + 0.6 };
  const one = (id) => (id === 'us-ST' ? st : null);
  const m1 = revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-ST', ...lay, drawnAt: one });
  const lane = m1.find((x) => x.lane && x.optionId === 'us-ST');
  assert.deepEqual(lane.b, st, 'the lane ends on the striker as drawn');
  assert.deepEqual(lane.a, frame.ball, 'from the ball (the board did not say where it drew it)');
  const cross = m1.find((x) => x.intercept).at, cut = rating.options.find((o) => o.id === 'us-ST').blocker.at;
  const along = (p, a, b) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  const side = (p, a, b) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
  approx(along(cross, lane.a, lane.b), along(cut, frame.ball, { x: 60, y: 34 }), 1e-9, 'as far along the lane');
  approx(side(cross, lane.a, lane.b), side(cut, frame.ball, { x: 60, y: 34 }), 1e-9, 'and as far to its side');
  const standing = { ...frame, players: frame.players.map((p) => (p.id === 'us-ST' ? { ...p, ...st } : p)) };
  const asIf = revealMarkers({ rating, frame: standing, carrierId: 'us-LCB', choiceId: 'us-LCM', ...lay });
  const drawnOne = revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-LCM', ...lay, drawnAt: one });
  const labelsOf = (ms) => ms.filter((x) => x.type === 'label' && x.receiverId).map((x) => ({ id: x.receiverId, at: x.at, side: x.side }));
  assert.deepEqual(labelsOf(drawnOne), labelsOf(asIf), 'every label placed round the striker as drawn, the others off him there');
  // A pass into space: the lane to the space, the run from the receiver as drawn.
  const lb = { x: 30.5, y: 8.8 };
  const space = revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-LB@space', ...lay, drawnAt: (id) => (id === 'us-LB' ? lb : null) });
  assert.deepEqual(space.find((x) => x.lane && x.optionId === 'us-LB@space').b, { x: 42, y: 8 }, 'the space');
  assert.deepEqual(space.find((x) => x.run).from, lb, 'the run from the left back as drawn');
  // The preview line, from the ball as drawn (at YOUR feet) to the teammate as drawn.
  const [pv] = previewMarkers({ frame, carrierId: 'us-LCB', receiverId: 'us-LB', drawnAt: (id) => (id === 'ball' ? { x: 22.8, y: 26.5 } : id === 'us-LB' ? lb : null) });
  assert.deepEqual([pv.a, pv.b], [{ x: 22.8, y: 26.5 }, lb]);
  // No drawnAt (or one that says nothing, or throws): the spots, as before.
  const before = revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-ST', ...lay });
  assert.deepEqual(revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-ST', ...lay, drawnAt: () => null }), before);
  assert.deepEqual(revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-ST', ...lay, drawnAt: () => { throw new Error('gone'); } }), before);
  assert.equal(drawnFrame(frame, null), frame);
  assert.deepEqual(drawnFrame(frame, one).players.find((p) => p.id === 'us-ST'), { ...posOf('us-ST'), ...st });
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

test('pass: the reveal\'s camera frames the play it talks about: the ball, the labelled players, the lanes and who is in their way', () => {
  const A = PASS_DEFAULTS.labelAcross;
  // The full match: the ball, the best and your pick (with room for their labels), the space aimed at, the blocker.
  const cam = revealCamera({ rating, frame, carrierId: 'us-LCB', labels: new Set(['us-LCM', 'us-LB']), choiceId: 'us-ST' });
  const inside = (p) => p.x >= cam.x0 && p.x <= cam.x1 && p.y >= cam.y0 && p.y <= cam.y1;
  for (const p of [{ x: 22, y: 26 }, { x: 42, y: 24 }, { x: 30, y: 8 }, { x: 60, y: 34 }, { x: 50, y: 32 }, { x: 49, y: 32 }]) assert.ok(inside(p), `${JSON.stringify(p)} in ${JSON.stringify(cam)}`);
  // The play runs from the ball (x 22) to the striker you picked (60 + 3 for his label), and across from the left back
  // (8 - 3, labelled) to the striker (34 + 3): 41 x 32 m, grown about its middle to the full match's least window (50 x 34).
  assert.deepEqual(PASS_DEFAULTS.revealFull, { length: 50, width: 34 });
  assert.equal(A, 3);
  assert.deepEqual(cam, { x0: 17.5, x1: 67.5, y0: 4, y1: 38 });
  assert.ok(cam.y1 < 60, 'not the right back, nor anyone else: the full match frames only the play');
  // A small or bigger game frames its whole cast (every player there is there for a reason).
  const small = { ...frame, players: frame.players.filter((p) => ['us-LCB', 'us-LCM', 'us-RB', 'them-ST', 'them-DM'].includes(p.id)) };
  const s = revealCamera({ rating, frame: small, carrierId: 'us-LCB', labels: new Set(['us-LCM']), choiceId: 'us-LCM', stage: 'small' });
  assert.ok(s.y1 >= 60 && s.x0 <= 22, `the whole cast: ${JSON.stringify(s)}`);
  assert.equal(revealCamera({ rating: { options: [] }, frame: { players: [] }, carrierId: null }), null, 'nothing to frame');
});

test('pass: a small or bigger game\'s camera fits the cast through the build-up and the spaces aimed at; the full match has none', () => {
  const a = { ball: { x: 20, y: 30 }, players: [{ id: 'us-LCB', x: 20, y: 30 }, { id: 'them-ST', x: 28, y: 28 }] };
  const b = { ball: { x: 24, y: 31 }, players: [{ id: 'us-LCB', x: 24, y: 31 }, { id: 'them-ST', x: 26, y: 29 }, { id: 'us-LCM', x: 40, y: 20 }] };
  const r = { options: [{ id: 'us-LCM@space', targetId: 'us-LCM', point: { x: 46, y: 18 } }, { id: 'us-RW@space', targetId: 'us-RW', point: { x: 90, y: 60 } }] };
  assert.deepEqual(repCamera([a, b], r, { stage: 'small', targets: new Map([['us-LCM', {}]]) }), { x0: 20, x1: 46, y0: 18, y1: 31 }, 'the space ahead of a target, not of a teammate you cannot pick');
  assert.deepEqual(repCamera([a, b], r, { stage: 'medium' }), { x0: 20, x1: 90, y0: 18, y1: 60 });
  assert.equal(repCamera([a, b], r, { stage: 'full' }), null, 'the full match: the length crop and the spotlight');
  assert.equal(repCamera([], null, { stage: 'small' }), null);
});

test('pass: at the whistle a small or bigger game eases in on the freeze: its players, the ball and the targets, at least CAMERA_MIN, on the pitch', async () => {
  const { CAMERA_MIN } = await import('../js/ui/board.js');
  assert.deepEqual(PASS_DEFAULTS.cameraMin, CAMERA_MIN, 'the board\'s least window');
  const inside = (c, p) => p.x >= c.x0 - 1e-9 && p.x <= c.x1 + 1e-9 && p.y >= c.y0 - 1e-9 && p.y <= c.y1 + 1e-9;
  // A small game at the freeze: YOU on the ball, three teammates, two of theirs.
  const freeze = { ball: { x: 40, y: 30 }, players: [{ id: 'us-LCM', x: 40, y: 30 }, { id: 'us-ST', x: 62, y: 34 }, { id: 'us-LW', x: 55, y: 12 }, { id: 'us-DM', x: 34, y: 36 }, { id: 'them-DM', x: 47, y: 30 }, { id: 'them-RCB', x: 64, y: 38 }] };
  const cam = chooseCamera(freeze, { stage: 'small', targets: new Map([['us-ST', {}], ['us-LW', {}], ['us-DM', {}]]) });
  assert.deepEqual(cam, { x0: 34, x1: 64, y0: 12, y1: 38 });
  for (const p of [freeze.ball, ...freeze.players]) assert.ok(inside(cam, p), `${p.id ?? 'the ball'} in view`);
  // Never less than the board's least window, grown about the middle; slid onto the pitch; a point off it counts at the line.
  const tight = chooseCamera({ ball: { x: 50, y: 30 }, players: [{ id: 'us-LCM', x: 50, y: 30 }, { id: 'us-ST', x: 56, y: 33 }] }, { stage: 'medium' });
  assert.deepEqual(tight, { x0: 41, x1: 65, y0: 23.5, y1: 39.5 });
  const edge = chooseCamera({ ball: { x: 104, y: -1 }, players: [{ id: 'us-RW', x: 100, y: 2 }] }, { stage: 'small' });
  assert.deepEqual(edge, { x0: 81, x1: 105, y0: 0, y1: 16 }, 'on the pitch');
  assert.equal(chooseCamera(freeze, { stage: 'full', targets: ['us-ST'] }), null, 'the full match keeps its length crop');
  assert.equal(chooseCamera({ players: [] }, { stage: 'small' }), null, 'nothing to frame');

  // Real staged reps (the engine's drills and stages): the choice's camera is a part of the build-up's (repCamera: every
  // frame of the build-up, the freeze included, and the spaces the passes aim at), so it only ever zooms in.
  const [pd, cast, { buildFormations }] = await Promise.all([import('../js/engine/passdrill.js'), import('../js/engine/cast.js'), import('../js/data.js')]);
  const formations = buildFormations(await loadJSON('data/formations/helios-433.json'));
  const area = (c) => (c.x1 - c.x0) * (c.y1 - c.y0);
  const atLeast = (c) => {
    const grow = (a, b, min) => { const m = (a + b) / 2, h = Math.max(b - a, min) / 2; return [m - h, m + h]; };
    const [x0, x1] = grow(c.x0, c.x1, CAMERA_MIN.length), [y0, y1] = grow(c.y0, c.y1, CAMERA_MIN.width);
    return { x0, x1, y0, y1 };
  };
  let n = 0, smaller = 0;
  for (const [role, seed] of [['LW', 1], ['LCM', 3], ['ST', 4], ['RW', 3], ['LB', 5], ['DM', 2]]) {
    const drill = pd.generatePassDrill({ seed, role, formations });
    if (!drill) continue;
    for (const wanted of ['small', 'medium']) {
      const scene = passScene(drill, cast.bestStage(drill, wanted, { formations }), { formations, passdrill: pd, reduceFrame: cast.reduceFrame });
      if (scene.stage === 'full') continue;
      const { freezeAt } = timing(drill);
      const sample = [];
      for (let t = Math.max(0, freezeAt - PASS_DEFAULTS.watch); t < freezeAt; t += 0.5) sample.push(scene.at(t));
      sample.push(scene.freeze);
      const rc = repCamera(sample, scene.rating, { stage: scene.stage, targets: scene.byReceiver });
      const cc = chooseCamera(scene.freeze, { stage: scene.stage, targets: scene.byReceiver });
      for (const p of [scene.freeze.ball, ...scene.freeze.players]) assert.ok(inside(cc, { x: Math.min(105, Math.max(0, p.x)), y: Math.min(68, Math.max(0, p.y)) }), `${drill.id}: ${p.id ?? 'the ball'} in the choice's view`);
      for (const id of scene.targets) assert.ok(inside(cc, scene.freeze.players.find((p) => p.id === id)), `${drill.id}: target ${id} in view`);
      assert.ok(area(cc) <= area(atLeast(rc)) + 1e-6, `${drill.id} (${scene.stage}): the choice's view ${area(cc)} m² is no bigger than the build-up's ${area(atLeast(rc))} m²`);
      n++;
      if (area(cc) < area(atLeast(rc)) - 1) smaller++;
    }
  }
  assert.ok(n >= 6 && smaller >= 1, `${n} staged reps, ${smaller} zoomed in further at the whistle`);
});

test('pass: on a phone, a small game\'s choice zooms in on a compact cast: figures bigger than the full match\'s (real drills)', async (t) => {
  // The verifier on a 375 x 812 phone: small games almost never zoomed in (figures about 43 px, as at the full match,
  // half the board empty grass), since the cast often reached both touchlines. cast.js now stages a pass rep's smaller
  // games on the most compact cast that passes the gate; the choice's camera (chooseCamera) fits just it. Here: the
  // phone's board (359 x 570 CSS px, upright), the window board.js setCamera gives the rect (cameraViewBox with room
  // over it for a figure and YOUR tag, standHeight) and the figures' height there, old order against compact.
  const [pd, cast, { buildFormations }, board, { FIGURE }] = await Promise.all([
    import('../js/engine/passdrill.js'), import('../js/engine/cast.js'), import('../js/data.js'), import('../js/ui/board.js'), import('../js/ui/figures.js'),
  ]);
  const formations = buildFormations(await loadJSON('data/formations/helios-433.json'));
  const box = { width: 359, height: 570 }, P = board.BOARD_DEFAULTS;
  const phone = (rect) => {
    let head = P.cameraHeadroom, v = board.cameraViewBox('vertical', box, rect, P);
    for (let i = 0; i < 2; i++) {
      const need = board.standHeight(board.boardScales(board.pxPerMetre(box, v), { figures: true, player: true, camera: true }, P), { figures: true }, P) - P.cameraPad;
      if (!(need > head + 0.01)) break;
      head = need;
      v = board.cameraViewBox('vertical', box, rect, { ...P, cameraHeadroom: head });
    }
    const ppm = board.pxPerMetre(box, v);
    return { ppm, fig: FIGURE.height * P.tokenRadius * board.boardScales(ppm, { figures: true, player: true, camera: true }, P).kf * ppm };
  };
  const full = phone({ x0: 0, x1: 105, y0: 0, y1: 68 });
  const rows = [];
  for (const role of ['LB', 'LCB', 'DM', 'LCM', 'RCM', 'LW', 'RW', 'ST']) {
    for (let seed = 1; seed <= 5; seed++) {
      const drill = pd.generatePassDrill({ seed, role, formations });
      if (!drill) continue;
      const got = {};
      for (const [key, params] of [['now', undefined], ['old', { passCompact: false }]]) {
        const st = cast.stagePassDrill(drill, 'small', { formations, params });
        if (!st) continue;
        const scene = passScene(drill, st, { formations, passdrill: pd, reduceFrame: cast.reduceFrame });
        const cam = chooseCamera(scene.freeze, { stage: scene.stage, targets: scene.byReceiver });
        // Just the cast, the ball and the targets (no space ahead of anyone): nothing more is reserved.
        const xs = [scene.freeze.ball.x, ...scene.freeze.players.map((q) => q.x)], ys = [scene.freeze.ball.y, ...scene.freeze.players.map((q) => q.y)];
        const snug = (a, b, lo, hi, min) => Math.max(b - a, min) >= hi - lo - 0.02 && a >= lo - 0.02 && b <= hi + 0.02;
        assert.ok(snug(Math.max(0, Math.min(...xs)), Math.min(105, Math.max(...xs)), cam.x0, cam.x1, PASS_DEFAULTS.cameraMin.length) && snug(Math.max(0, Math.min(...ys)), Math.min(68, Math.max(...ys)), cam.y0, cam.y1, PASS_DEFAULTS.cameraMin.width), `${drill.id}: the choice's camera is the cast, snug`);
        got[key] = phone(cam);
      }
      if (got.now) rows.push({ id: drill.id, ...got });
      if (got.old) assert.ok(got.now, `${drill.id}: the old order played it small, so must the compact one`);
    }
  }
  const med = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
  const both = rows.filter((r) => r.old);
  const now = med(rows.map((r) => r.now.fig)), old = med(both.map((r) => r.old.fig)), nowBoth = med(both.map((r) => r.now.fig));
  t?.diagnostic?.(`small pass games on a phone: ${rows.length} (old order ${both.length}); figures median ${now.toFixed(0)} px (the same reps: ${nowBoth.toFixed(0)} px, old order ${old.toFixed(0)} px; the full match ${full.fig.toFixed(0)} px); ${med(rows.map((r) => r.now.ppm)).toFixed(1)} px/m (old ${med(both.map((r) => r.old.ppm)).toFixed(1)}, full ${full.ppm.toFixed(1)}); at most 45 px: ${rows.filter((r) => r.now.fig <= 45).length} of ${rows.length} (old ${both.filter((r) => r.old.fig <= 45).length} of ${both.length})`);
  assert.ok(rows.length >= 12, `${rows.length} small games`);
  assert.ok(now >= full.fig * 1.2, `small games' figures ${now.toFixed(0)} px, the full match's ${full.fig.toFixed(0)} px`);
  assert.ok(nowBoth >= old + 4, `the same reps: ${nowBoth.toFixed(0)} px now, ${old.toFixed(0)} px with the old order`);
  assert.ok(rows.filter((r) => r.now.fig <= full.fig * 1.1).length <= 0.35 * rows.length, 'most small games are drawn bigger than the full match');
});

test('pass: a pass into space beyond the choice\'s view widens the camera as the ball goes; one in view keeps it', () => {
  const cam = { x0: 30, x1: 60, y0: 10, y1: 40 };
  const inView = { to: { x: 50, y: 20 }, movers: [{ id: 'us-ST', from: { x: 48, y: 22 }, to: { x: 50, y: 20 } }] };
  assert.equal(flightCamera(cam, inView), cam, 'the same rect: no camera move');
  const through = { to: { x: 72, y: 36 }, movers: [{ id: 'us-ST', from: { x: 58, y: 34 }, to: { x: 72, y: 36 } }] };
  assert.deepEqual(flightCamera(cam, through), { x0: 30, x1: 72, y0: 10, y1: 40 });
  const out = { to: { x: 110, y: -4 }, movers: [] };
  assert.deepEqual(flightCamera(cam, out), { x0: 30, x1: 105, y0: 0, y1: 40 }, 'a ball out of play is followed to the line');
  assert.equal(flightCamera(null, through), null, 'the full match has no camera');
  // With the real flight: a space pass's runner and the ball meet at the aim.
  const option = { id: 'us-LCM@space', targetId: 'us-LCM', kind: 'space', label: 'best', point: { x: 66, y: 22 } };
  const flight = passFlight(frame, option, passOutcome(option, { outcome: 'completed' }));
  const wide = flightCamera({ x0: 20, x1: 50, y0: 20, y1: 30 }, flight);
  assert.ok(wide.x1 >= 66 && wide.y0 <= 22, JSON.stringify(wide));
});

test('pass: the set card goes at the top or bottom of the pitch, off YOU, the ball and the teammates to pass to', async () => {
  const { PLAY_DEFAULTS } = await import('../js/ui/player/play.js');
  assert.equal(PASS_DEFAULTS.cardGapPx, PLAY_DEFAULTS.cardGapPx, 'as play.js\'s role card');
  assert.equal(PASS_DEFAULTS.cardClearPx, PLAY_DEFAULTS.cardClearPx);
  const stage = { top: 50, bottom: 650 }, h = 120, across = { left: 80, right: 300 };
  const box = (top, left = 150, w = 30, hh = 50) => ({ left, right: left + w, top, bottom: top + hh });
  const W = PASS_DEFAULTS.cardWeights, g = PASS_DEFAULTS.cardGapPx, c = PASS_DEFAULTS.cardClearPx;
  const at = (...a) => cardSpot(stage, h, ...a).at;
  // Nobody at the top: there (never the middle, where a camera centred on the play puts YOU), its top edge cardGapPx in.
  assert.deepEqual(cardSpot(stage, h, [{ box: box(330), weight: W.you }, { box: box(360), weight: W.ball }], across), { at: 'top', top: g, side: 'center' });
  // YOU at the top: the bottom.
  assert.deepEqual(cardSpot(stage, h, [{ box: box(80), weight: W.you }, { box: box(360), weight: W.ball }], across), { at: 'bottom', top: 600 - g - h, side: 'center' });
  // YOU at the top and the ball at the bottom: the middle, when it is clear.
  assert.equal(at([{ box: box(80), weight: W.you }, { box: box(560), weight: W.ball }], across), 'middle');
  // YOU at the top, a teammate at the bottom and the middle taken, but a band between them clear: its middle.
  const band = cardSpot(stage, h, [{ box: box(60), weight: W.you }, { box: box(560), weight: W.target }, { box: box(300, 150, 30, 30), weight: W.target }], across);
  assert.equal(band.at, 'free');
  const y = stage.top + band.top;
  assert.ok(y >= 330 + c && y + h <= 560 - c, `between the two (${y}-${y + h})`);
  approx(y, (330 + c + 560 - c - h) / 2, 4, 'in the middle of the band');
  // Something everywhere: the place whose cover costs least (one of theirs over a teammate you can pass to; never YOU).
  const busy = [{ box: box(70, 150, 30, 200), weight: W.other }, { box: box(400, 150, 30, 240), weight: W.target }, { box: box(260, 150, 30, 150), weight: W.you }];
  assert.equal(at(busy, across), 'top', 'over one of theirs rather than a teammate you can pass to or YOU');
  const swapped = [{ box: box(70, 150, 30, 200), weight: W.target }, { box: box(400, 150, 30, 240), weight: W.other }, { box: box(260, 150, 30, 150), weight: W.you }];
  assert.equal(at(swapped, across), 'bottom');
  // Clear across: a player beside the card, not under it, counts for nothing; so do boxes the board could not tell.
  assert.equal(at([{ box: box(80, 20, 30), weight: W.you }, { box: null, weight: W.ball }, null], across), 'top');
  // A bare box weighs 1; within cardClearPx of the card counts as under it.
  assert.equal(at([box(50 + g + h + c - 1)], across), 'bottom');
  assert.ok(W.you > W.target && W.ball > W.target && W.target > W.other, 'YOU and the ball first');

  // Nothing clear in the middle of the screen, but the room across it (a phone's bigger game: YOU low on the left, the
  // play spread up the middle): the card slides to the edge where a place is clear, centred first whenever one is.
  const room = { left: 0, right: 380 }, mid = { left: 82, right: 298 }; // a 216 px card, centred on a 380 px stage
  const spread = [
    { box: { left: 60, right: 125, top: 470, bottom: 600 }, weight: W.you }, { box: { left: 190, right: 225, top: 340, bottom: 380 }, weight: W.ball },
    { box: { left: 110, right: 150, top: 60, bottom: 140 }, weight: W.other }, { box: { left: 190, right: 230, top: 70, bottom: 140 }, weight: W.target },
    { box: { left: 160, right: 240, top: 180, bottom: 330 }, weight: W.target }, { box: { left: 310, right: 350, top: 230, bottom: 300 }, weight: W.other },
  ];
  const spot = cardSpot(stage, h, spread, { ...mid, room });
  assert.deepEqual(spot, { at: 'bottom', top: 600 - g - h, side: 'right' }, 'the bottom right, clear of YOU');
  const x0 = room.right - g - (mid.right - mid.left);
  for (const { box: b } of spread) assert.ok(b.right + c <= x0 || b.bottom + c <= stage.top + spot.top || b.top - c >= stage.top + spot.top + h, 'it covers nobody');
  assert.equal(cardSpot(stage, h, spread, mid).side, 'center', 'no room given: centred, as before');
  assert.notEqual(cardSpot(stage, h, spread, mid).at, 'bottom', '(where it covers the least, centred)');
  // Mirrored: the bottom left.
  const flip = (b) => ({ left: 380 - b.right, right: 380 - b.left, top: b.top, bottom: b.bottom });
  assert.equal(cardSpot(stage, h, spread.map((a) => ({ ...a, box: flip(a.box) })), { ...mid, room }).side, 'left');
  // A corner the play leaves free wins over a band in the middle of it (a centred band is clear here too).
  const corner = [
    { box: { left: 100, right: 140, top: 70, bottom: 150 }, weight: W.you }, { box: { left: 180, right: 215, top: 330, bottom: 365 }, weight: W.ball },
    { box: { left: 170, right: 210, top: 540, bottom: 600 }, weight: W.target },
  ];
  assert.equal(cardSpot(stage, h, corner, mid).at, 'free', '(centred, a band between YOU and the ball)');
  assert.deepEqual(cardSpot(stage, h, corner, { ...mid, room }), { at: 'top', top: g, side: 'right' });
  // Clear in the middle: it stays centred; a card as wide as the room never slides.
  assert.equal(cardSpot(stage, h, [{ box: box(80), weight: W.you }], { ...mid, room }).side, 'center');
  assert.equal(cardSpot(stage, h, spread, { left: g, right: 380 - g, room }).side, 'center');
});

test('pass: every rep carries the stage its slot wants (road.js stagePlan); the quick set takes the 1-star plan', async () => {
  const plan = (stars, { count = 5 } = {}) => Array.from({ length: count }, (_, i) => `${stars}:${i}`);
  const gen = fakeGenerator(Array.from({ length: 12 }, (_, i) => `d${i}`));
  const quick = await assembleSet({ role: 'LCM', seed: 1 }, { generatePassDrill: gen, stagePlan: plan });
  assert.deepEqual(quick.reps.map((r) => r.stage), plan(1));
  const node = { id: 'free-player', kind: 'pass', principles: ['PA3'] };
  const built = await assembleSet({ node, role: 'LCM', seed: 1, stars: 2 }, {
    repKind: () => 'pass', stagePlan: plan, buildSet: async () => [{ kind: 'pass', drill: { id: 'a' }, stage: 'small' }], generatePassDrill: gen,
  });
  assert.deepEqual(built.reps.map((r) => r.stage), ['small', '2:1', '2:2', '2:3', '2:4'], 'road.js\'s own stage is kept; top-ups take their slot\'s');
  const none = await assembleSet({ role: 'LCM', seed: 1 }, { generatePassDrill: gen });
  assert.ok(none.reps.every((r) => r.stage === undefined), 'no stagePlan: no stage (the rep plays the full match)');
});

test('pass: a staged rep plays only its cast and is judged on the staged rating (passScene, with the real engine)', async () => {
  const [pd, cast, passing, { buildFormations }] = await Promise.all([
    import('../js/engine/passdrill.js'), import('../js/engine/cast.js'), import('../js/engine/passing.js'), import('../js/data.js'),
  ]);
  const formations = buildFormations(await loadJSON('data/formations/helios-433.json'));
  let seen = { small: 0, medium: 0, full: 0 };
  for (const [role, seed] of [['LW', 1], ['LW', 2], ['RW', 3], ['LCM', 3], ['ST', 4], ['LB', 5]]) {
    const drill = pd.generatePassDrill({ seed, role, formations });
    if (!drill) continue;
    for (const wanted of ['small', 'medium', 'full']) {
      const staged = cast.bestStage(drill, wanted, { formations });
      const scene = passScene(drill, staged, { formations, passdrill: pd, reduceFrame: cast.reduceFrame });
      const where = `${drill.id} at ${wanted} (played ${staged.stage})`;
      seen[staged.stage]++;
      assert.equal(scene.stage, staged.stage, where);
      assert.equal(scene.carrierId, `us-${role}`, `${where}: YOU are the carrier`);
      assert.equal(scene.freeze.carrierId, scene.carrierId, `${where}: YOU have the ball at the freeze`);
      if (staged.stage === 'full') {
        assert.equal(scene.freeze.players.length, 22, where);
        assert.equal(scene.rating, drill.rating, `${where}: the drill's own rating`);
        continue;
      }
      // Only the cast, in the build-up and at the freeze; nobody hidden is rated.
      const ids = new Set(staged.cast.ids);
      assert.ok(scene.freeze.players.every((p) => ids.has(p.id)) && scene.freeze.players.length === ids.size, where);
      const mid = scene.at(Math.max(0, timing(drill).freezeAt - 1));
      assert.ok(mid.players.every((p) => ids.has(p.id)), `${where}: the build-up shows only the cast`);
      assert.ok(scene.rating.options.every((o) => ids.has(o.targetId)), `${where}: every option is to a teammate on show`);
      // The targets are exactly what the gate counted (3-5), and the staged best is worth 3 stars.
      assert.deepEqual([...scene.targets].sort(), [...staged.gates.targets].sort(), where);
      assert.ok(scene.targets.length >= 3 && scene.targets.length <= 5, `${where}: ${scene.targets.length} targets`);
      assert.equal(passing.gradePass(scene.rating, staged.answer.best, { accept: scene.accept }).stars, 3, where);
      assert.equal(staged.rating.best.targetId, drill.rating.best.targetId, `${where}: the same best receiver as the full match`);
      // The camera frames the whole cast through the build-up.
      const cam = repCamera([mid, scene.freeze], scene.rating, { stage: scene.stage, targets: scene.byReceiver });
      for (const p of scene.freeze.players) assert.ok(p.x >= cam.x0 && p.x <= cam.x1 && p.y >= cam.y0 && p.y <= cam.y1, `${where}: ${p.id} in view`);
    }
  }
  assert.ok(seen.small > 0 && seen.medium > 0 && seen.full > 0, JSON.stringify(seen));
  // No staging (the engine's cast.js missing): the full match, as before.
  const drill = pd.generatePassDrill({ seed: 3, role: 'LCM', formations });
  const plain = passScene(drill, null, { formations, passdrill: pd });
  assert.equal(plain.stage, 'full');
  assert.equal(plain.freeze.players.length, 22);
});

// The box board.js writes a label in, given the marker (drawLabel 'above', no lift: the baseline 0.8 m over `at`; the
// type size × k, labelAscent of it over the baseline and labelDescent under, labelEm of it wide per character), in view metres.
const labelBox = (m, { orientation = 'horizontal', k = 1 } = {}, size = null) => {
  const v = orientation === 'vertical' ? { x: m.at.y, y: 105 - m.at.x } : m.at;
  const fs = (size ?? (m.label === 'best' || /\bis-yours\b/.test(m.cls) ? 1.85 : 1.6)) * k, w = [...m.text].length * PASS_DEFAULTS.labelEm * fs;
  const base = v.y - (m.lift || 0) - 0.8;
  return { x0: v.x - w / 2, x1: v.x + w / 2, y0: base - PASS_DEFAULTS.labelAscent * fs, y1: base + PASS_DEFAULTS.labelDescent * fs };
};
const boxesMeet = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);

test('pass: with figures, a reveal label goes by its own player (over the head, under the base or beside), off the others', () => {
  const at = { x: 42, y: 24 };
  const o = { at, text: '★ Best', size: 1.85, orientation: 'horizontal', k: 1, body: 4.3, pad: 1.8, half: 1.5, skip: ['us-LCM'] };
  const fs = 1.85;
  // Nobody near: over the head, `gap` (0.45 m) clear of it, written where it says (the marker has no lift).
  const free = labelSpot({ ...o, frame: { players: [P('us-LCM', 42, 24)] } });
  assert.equal(free.side, 'above');
  approx(free.box.y1, 24 - 4.3 - 0.45, 1e-9, 'just over the head');
  approx(free.at.y - 0.8 - PASS_DEFAULTS.labelAscent * fs, free.box.y0, 1e-9, 'board.js writes the text in that box');
  approx((free.box.x0 + free.box.x1) / 2, 42, 1e-9, 'centred on the player');
  assert.equal(free.stray, false);
  // Review: an opponent standing just up the screen, so a label over the head sat at his feet: it goes under the base.
  const feet = labelSpot({ ...o, frame: { players: [P('us-LCM', 42, 24), P('them-RB', 42, 17)] } });
  assert.equal(feet.side, 'below', 'not at the opponent\'s feet');
  assert.ok(feet.box.y0 > 24 + 1.8, 'under the base');
  // Players over and under: beside the figure, clear of both.
  const both = [P('us-LCM', 42, 24), P('them-RB', 42, 17), P('us-DM', 42, 30.5)];
  const side = labelSpot({ ...o, frame: { players: both } });
  assert.ok(['right', 'left'].includes(side.side), side.side);
  const fig = (p) => ({ x0: p.x - 2.1, x1: p.x + 2.1, y0: p.y - 4.3, y1: p.y + 2.1 });
  assert.ok(!boxesMeet(side.box, fig(both[1])) && !boxesMeet(side.box, fig(both[2])), 'on nobody');
  // Never on an earlier label.
  const taken = [];
  const a = labelSpot({ ...o, frame: { players: [P('us-LCM', 42, 24)] }, taken });
  const b = labelSpot({ ...o, text: '✓ Good', size: 1.6, at: { x: 43, y: 24 }, frame: { players: [P('us-RCM', 43, 24)] }, skip: ['us-RCM'], taken });
  assert.ok(!boxesMeet(a.box, b.box), `${a.side} and ${b.side}`);
  assert.equal(taken.length, 2);
  // A phone (vertical): up the screen is forward, so a teammate just ahead stands over the label's place above.
  const phone = labelSpot({ ...o, orientation: 'vertical', frame: { players: [P('us-LCM', 42, 24), P('them-DM', 49, 24)] } });
  assert.equal(phone.side, 'below');
  // YOU and your tag are kept clear (the tag where the board drew it, when it says); a label with nowhere else to go
  // says so (onYou), and the reveal lets the board nudge it (clear: 'you').
  const you = labelSpot({ ...o, youId: 'us-ST', frame: { players: [P('us-LCM', 42, 24), P('us-ST', 42, 17.5)] } });
  assert.notEqual(you.side, 'above', 'not at YOUR feet');
  assert.equal(you.onYou, false);
  const tagged = labelSpot({ ...o, youId: 'us-ST', tagBox: { x0: 30, x1: 54, y0: 26, y1: 29 }, frame: { players: [P('us-LCM', 42, 24), P('us-ST', 60, 60)] } });
  assert.ok(!['below', 'below-right', 'below-left'].includes(tagged.side), `not on YOUR tag as drawn (${tagged.side})`);
  const boxed = labelSpot({ ...o, gap: 0, youId: 'us-ST', frame: { players: [P('us-LCM', 42, 24), P('us-ST', 42, 24)] } });
  assert.equal(boxed.onYou, true, 'YOU on the same spot: nowhere clear');
  // Out of the view: somewhere else.
  const edge = labelSpot({ ...o, frame: { players: [P('us-LCM', 42, 24)] }, view: { x: 30, y: 18.5, width: 30, height: 30 } });
  assert.notEqual(edge.side, 'above', 'the view ends over the head');
});

test('pass: with figures, every labelled teammate\'s base is ringed in the label\'s colour and line, and no label covers another', async () => {
  const lay = { orientation: 'horizontal', k: 1, pad: 1.8, body: 4.3, half: 1.5, ballK: 1 };
  const m = revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-ST', ...lay });
  const labels = m.filter((x) => x.type === 'label' && x.receiverId);
  const rings = m.filter((x) => x.owner);
  assert.equal(labels.length, 10);
  assert.deepEqual(rings.map((r) => r.id).sort(), labels.map((l) => l.receiverId).sort(), 'one ring per label, on its player');
  for (const l of labels) {
    const ring = rings.find((r) => r.id === l.receiverId);
    assert.equal(ring.type, 'ring');
    assert.equal(ring.tone, l.tone, `${l.receiverId}: the label's colour`);
    assert.equal(ring.pulse, false, 'steady');
    assert.match(ring.cls, new RegExp(`ps-line--${labelStyle(l.label).line}`), `${l.receiverId}: the label's line (solid, dashed, dotted)`);
    assert.equal(l.lift, 0, 'written where labelSpot put it');
    assert.ok(typeof l.side === 'string');
  }
  // Written just there: board.js's own search off YOU (clear: 'you') knows nothing of the other labels, so it is asked
  // for only by a label that could not keep off YOU.
  assert.ok(labels.every((l) => l.clear === undefined), labels.filter((l) => l.clear).map((l) => l.receiverId).join());
  const boxes = labels.map((l) => labelBox(l, lay));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!boxesMeet(boxes[i], boxes[j]), `${labels[i].receiverId} and ${labels[j].receiverId}`);
  // Discs (no figures): the labels sit on the tokens, lifted by board.js; no rings.
  const discs = revealMarkers({ rating, frame, carrierId: 'us-LCB', choiceId: 'us-ST' });
  assert.ok(discs.filter((x) => x.receiverId).every((l) => l.lift === 'token'));
  assert.equal(discs.filter((x) => x.owner).length, 0);
  // The figure's height the screen uses is the board's (FIGURE.height token radii, the board's tokenRadius).
  const { BOARD_DEFAULTS } = await import('../js/ui/board.js');
  assert.equal(TOKEN_RADIUS, BOARD_DEFAULTS.tokenRadius);
});

test('pass: with figures, the labels keep off the ✗ where a lane is cut out (drawn at css/pass.css .ps-intercept\'s size)', async () => {
  const css = isNode ? await (await import('node:fs/promises')).readFile(new URL('../css/pass.css', import.meta.url), 'utf8') : await (await fetch(new URL('../css/pass.css', import.meta.url))).text();
  assert.equal(Number(/\.mk-label\.ps-intercept\s*\{[^}]*font-size:\s*calc\(([\d.]+)px/.exec(css)?.[1]), PASS_DEFAULTS.interceptSize);
  // YOU on the ball; your striker's pass is cut out just over his head (where the ✗ is written), nobody else near him:
  // his label goes under his feet, not over his head onto the ✗ (before: over the head, the first place on a tie).
  const f = { t: 3, ball: { x: 40, y: 34 }, possession: 'us', carrierId: 'us-LCM', tags: {}, players: [P('us-LCM', 40, 34), P('us-ST', 60, 34), P('us-LW', 45, 20), P('them-RCB', 60, 55), P('them-DM', 50, 50)] };
  const cut = opt('us-ST', 'cut-out', 30, { point: { x: 60, y: 34 }, pSafe: 0.3, blocker: { id: 'them-DM', pInt: 0.7, at: { x: 60, y: 29 }, via: 'block' } });
  const r = { carrierId: 'us-LCM', ball: f.ball, lines: {}, best: opt('us-LW', 'best', 90, { point: { x: 45, y: 20 } }), options: [] };
  r.options = [r.best, cut];
  const lay = { orientation: 'horizontal', k: 1, pad: 1.8, body: 4.3, half: 1.5, ballK: 1 };
  const m = revealMarkers({ rating: r, frame: f, carrierId: 'us-LCM', choiceId: 'us-ST', ...lay });
  const mark = m.find((x) => x.intercept);
  const st = m.find((x) => x.type === 'label' && x.receiverId === 'us-ST');
  assert.ok(mark && st, 'the ✗ and the striker\'s label');
  assert.ok(!boxesMeet(labelBox(st, lay), labelBox(mark, lay, PASS_DEFAULTS.interceptSize)), `the label (${st.side}) on the ✗`);
  assert.equal(st.side, 'below');
});

test('pass: on a phone, a reveal label is nearer its own player\'s feet than anyone else\'s (real drills, every stage)', async (t) => {
  // Review: with tall figures the labels, lifted over the head (or moved a figure's height away), sat nearer another
  // player's base for a third of them, most often an opponent's. Every generated drill of 8 positions x 5 seeds, at
  // every stage, at the board's phone scales (7-22 px a metre), the reveal's labels as board.js writes them.
  const [pd, cast, { buildFormations }, board, { FIGURE }] = await Promise.all([
    import('../js/engine/passdrill.js'), import('../js/engine/cast.js'), import('../js/data.js'), import('../js/ui/board.js'), import('../js/ui/figures.js'),
  ]);
  const formations = buildFormations(await loadJSON('data/formations/helios-433.json'));
  const orientation = 'vertical';
  const toV = (p) => ({ x: p.y, y: 105 - p.x });
  let n = 0, nearer = 0, onLabel = 0, onMark = 0;
  for (const pxPerM of [7, 10.5, 15, 22]) {
    const s = board.boardScales(pxPerM, { figures: true, player: true, camera: true });
    const lay = { orientation, k: s.kl, pad: TOKEN_RADIUS * s.k, body: FIGURE.height * TOKEN_RADIUS * s.kf, half: FIGURE.halfWidth * TOKEN_RADIUS * s.kf, ballK: s.kb };
    for (const role of ['LB', 'LCB', 'DM', 'LCM', 'RCM', 'LW', 'RW', 'ST']) {
      for (let seed = 1; seed <= 5; seed++) {
        const drill = pd.generatePassDrill({ seed, role, formations });
        if (!drill) continue;
        for (const wanted of ['small', 'medium', 'full']) {
          const scene = passScene(drill, cast.bestStage(drill, wanted, { formations }), { formations, passdrill: pd, reduceFrame: cast.reduceFrame });
          const { freeze, rating: r, carrierId, byReceiver } = scene;
          const opts = [...byReceiver.values()];
          const choiceId = opts[(seed * 7) % opts.length].id;
          const picks = revealPicks(byReceiver, { frame: freeze, carrierId, choiceId, bestId: r.best?.id });
          const marks = revealMarkers({ rating: r, frame: freeze, carrierId, choiceId, targets: byReceiver, labels: picks, ...lay });
          const labels = marks.filter((x) => x.type === 'label' && x.receiverId);
          const boxes = labels.map((l) => labelBox(l, lay));
          const cuts = marks.filter((x) => x.intercept).map((x) => labelBox(x, lay, PASS_DEFAULTS.interceptSize));
          labels.forEach((l, i) => {
            const bx = boxes[i];
            const edge = (p) => { const v = toV(p); return Math.hypot(Math.max(bx.x0 - v.x, 0, v.x - bx.x1), Math.max(bx.y0 - v.y, 0, v.y - bx.y1)); };
            const own = edge(freeze.players.find((p) => p.id === l.receiverId));
            const other = Math.min(...freeze.players.filter((p) => p.id !== l.receiverId).map(edge));
            n++;
            if (other < own - 8 / pxPerM) nearer++; // the review's measure: another base more than 8 px nearer the label
            if (boxes.some((b, j) => j !== i && boxesMeet(b, bx))) onLabel++;
            if (cuts.some((b) => boxesMeet(b, bx))) onMark++;
          });
        }
      }
    }
  }
  t?.diagnostic?.(`reveal labels: another player's feet nearer ${nearer} of ${n}, on another label ${onLabel}, on a lane's ✗ ${onMark}`);
  assert.ok(n > 1500, `${n} labels`);
  assert.ok(nearer <= 0.1 * n, `another player's feet nearer the label: ${nearer} of ${n}`);
  assert.ok(onLabel <= 0.005 * n, `labels on labels: ${onLabel} of ${n}`);
  assert.ok(onMark <= 0.005 * n, `labels on the ✗ where a lane is cut out: ${onMark} of ${n}`);
});

// ---------------------------------------------------------------- mount: whole sets on a fake page (Node)

/**
 * A stand-in for board.js's declutter in the mounted sets (recordingBoard's drawnAt): every player drawn 0.4-0.9 m off
 * its spot, a steady way for each, and the ball a little off where it is (as at its carrier's feet).
 */
const drawnOffset = (id) => {
  if (id === 'ball') return { x: 0.35, y: -0.25 };
  const h = hashString(id), a = (h % 360) * (Math.PI / 180), r = 0.4 + ((h >>> 9) % 6) / 10;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
};

/**
 * Plays one "Who's open?" set through pass.js mount on a fake page (tests/player-mount.js), with the real engine,
 * road.js, reveal.js and fulltime.js; the board records what it is asked to draw. A first try passes to the teammate on
 * show with an opponent closest (the likeliest miss, so Try again comes up), Try again to the one with the most room.
 * The quick set is dealt from the clock: Date.now is held still, so it is the same set every run. `expected`: the set
 * mount deals, worked out beforehand with the same builders, and each rep's cast as cast.js bestStage stages it.
 */
async function playPassSet({ params = [], profile }) {
  const page = fakePage();
  const realNow = Date.now;
  Date.now = () => 1767225600000;
  const warn = console.warn, info = console.info;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  console.info = () => {};
  let unmount = null;
  try {
    const [{ normalizePrinciples, normalizeScenarioIndex, createScenarioStore, buildFormations }, Road] = await Promise.all([import('../js/data.js'), import('../js/ui/player/road.js')]);
    const catalogue = await loadJSON('data/principles.json');
    const index = (await loadJSON('data/scenarios/index.json')).scenarios;
    const mem = new Map();
    const store = { get: (k, f = null) => (mem.has(k) ? JSON.parse(mem.get(k)) : f), set: (k, v) => { mem.set(k, JSON.stringify(v)); return true; }, remove: (k) => mem.delete(k) };
    store.set('player', profile);
    const root = page.doc.createElement('div');
    page.doc.body.append(root);
    const phaseOf = () => root.querySelector('.ps')?.dataset.phase ?? null;
    // The card's words (the stage line, then the card's line), as last written: read as a rep's watch begins.
    const cardOf = () => `${root.querySelector('.ps-card-stage')?.textContent ?? ''}|${root.querySelector('.ps-card-text')?.textContent ?? ''}`;
    let board = null, practice = false;
    const sounds = [], navigated = [];
    const app = {
      data: {
        formations: buildFormations(await loadJSON('data/formations/helios-433.json')), principles: normalizePrinciples(catalogue),
        road: Road.normalizeRoad(await loadJSON('data/road.json')), scenarios: createScenarioStore(normalizeScenarioIndex(index), (path) => loadJSON(path)),
      },
      store, settings: { mode: 'player', sound: false }, sound: { play: (name) => sounds.push({ name, practice }) }, celebrate: { show() {} },
      navigate: (h) => navigated.push(h), createBoard: () => (board = recordingBoard(page, phaseOf, cardOf, { drawnOffset })),
    };
    const snap = () => ({ history: (store.get('history') ?? []).length, elo: store.get('skills')?.counts?.global ?? 0, reps: store.get('rewards')?.counters?.reps ?? 0 });
    // The set mount deals, worked out here first (assembleSet with what mount gives it: the same builders, profile and
    // seed, no app, so nothing is counted), each rep staged where its slot wants it (cast.js bestStage, not the set
    // builder's copy): the drill each rep plays and the players each of its pictures must draw.
    const [cast, pd, { loadRewards }, S] = await Promise.all([
      import('../js/engine/cast.js'), import('../js/engine/passdrill.js'), import('../js/ui/rewards-store.js'), import('../js/ui/session.js'),
    ]);
    const prof = Road.loadProfile(app);
    const node = params[0] ? Road.nodeById(app.data.road, params[0]) : null;
    let dealt = null;
    assembleSet(
      {
        node, road: app.data.road, profile: prof, role: roleFor(prof), formations: app.data.formations, catalogue: app.data.principles,
        seed: node ? nodeSeed(node.id, Road.nodeAttempt(prof, node.id)) : (Date.now() % 2147483647) >>> 0, // (mount's)
        index: app.data.scenarios.index ?? [], rewards: loadRewards(app), skills: S.loadSkills(store), stars: node ? Road.nodeStars(prof, node.id) : 0,
      },
      {
        buildSet: Road.buildSet, buildQuickPassSet: Road.buildQuickPassSet, repKind: Road.repKind, stagePlan: Road.stagePlan,
        generatePassSet: pd.generatePassSet, generatePassDrill: pd.generatePassDrill,
      },
    ).then((d) => { dealt = d; }, (err) => { dealt = { reps: [], err }; });
    assert.ok(await page.clock.until(() => dealt !== null), 'the set is dealt'); // (the builders breathe on the page's timers)
    assert.equal(dealt.err, undefined, `the set is dealt: ${dealt.err}`);
    const expected = dealt.reps.map((r) => {
      const st = cast.bestStage(r, r.stage ?? 'full', { formations: app.data.formations, principles: app.data.principles });
      return { id: r.drill.id, stage: st.stage, ids: st.stage === 'full' ? null : [...st.cast.ids].sort(), label: st.cast?.label ?? null };
    });
    assert.equal(snap().history + snap().elo + snap().reps, 0, 'nothing recorded before the set');
    // When the set card comes up (its `hidden` taken off), on the page's clock.
    const cardShown = [];
    const unhide = page.FEl.prototype.removeAttribute;
    page.FEl.prototype.removeAttribute = function (k) {
      if (k === 'hidden' && this.classList.contains('ps-card') && this.hasAttribute('hidden')) cardShown.push(page.clock.now);
      return unhide.call(this, k);
    };
    mount(root, app, params).then((u) => { unmount = u; });
    assert.ok(await page.clock.until(() => unmount !== null && !!board), 'the set is built and on the pitch');
    // The rep on the pitch: one per role card drawn (a Try again's choice, pass and reveal stay in its rep).
    const repNo = () => { let n = 0, prev = null; for (const r of board.log.renders) { if (r.ph === 'set' && prev !== 'set') n++; prev = r.ph; } return n; };
    const tries = new Map();
    let pending = null;
    for (let guard = 0; guard < 60; guard++) {
      const ok = await page.clock.until(() => root.querySelector('.ft') || (phaseOf() === 'choose' && board.targets) || (phaseOf() === 'reveal' && root.querySelector('.pr-next')));
      assert.ok(ok, `the set moves on (phase ${phaseOf()})`);
      if (root.querySelector('.ft')) break;
      const n = repNo();
      const t = tries.get(n) ?? { picks: [] };
      tries.set(n, t);
      if (phaseOf() === 'choose') {
        const f = board.log.renders.at(-1); // the freeze, as drawn
        const theirs = f.ids.filter((id) => id.startsWith('them-'));
        const marked = (id) => Math.min(Infinity, ...theirs.map((o) => Math.hypot(f.at[o].x - f.at[id].x, f.at[o].y - f.at[id].y)));
        const ids = [...board.targets.ids].sort((a, b) => marked(a) - marked(b) || (a < b ? -1 : 1));
        const id = t.picks.length ? ids.filter((i) => !t.picks.includes(i)).at(-1) ?? ids.at(-1) : ids[0];
        practice = t.picks.length > 0;
        pending = { practice, before: snap() };
        t.picks.push(id);
        board.targets.onPreview?.(id); // a first tap previews, a second plays it
        board.targets.onTap(id);
        await page.clock.step();
        continue;
      }
      if (pending) {
        const res = { before: pending.before, after: snap(), stars: Number(root.querySelector('.pr-card')?.dataset.stars) };
        if (pending.practice) t.retry = res; else t.first = res;
        pending = null;
      }
      if (!t.retried && root.querySelector('.pr-retry')) { t.retried = true; root.querySelector('.pr-retry').click(); await page.clock.step(); continue; }
      root.querySelector('.pr-next').click();
      await page.clock.step();
    }
    assert.ok(root.querySelector('.ft'), 'Full time');
    return { board, tries, sounds, store, warnings, navigated, profile: store.get('player'), expected, cardShown, cameraMs: (await import('../js/ui/board.js')).BOARD_DEFAULTS.cameraMs };
  } finally {
    console.warn = warn;
    console.info = info;
    try { unmount?.(); } catch { /* gone */ }
    page.restore();
    Date.now = realNow;
  }
}

const STAGE_RANK = { small: 0, medium: 1, full: 2 };

/**
 * What every mounted set must hold, rep by rep: the reps are the set dealt; every picture of a rep (the role card, the
 * build-up, the choice, the pass, the reveal, Try again's) draws exactly its staged cast (all 22 at the full match),
 * and the card names the stage it is played at; YOU are in it; the card's "N v M" is what is
 * drawn; targets, markers and the spotlight name only players drawn; a small or bigger game has a camera (in on the
 * freeze at the choice) and no spotlight, the full match the spotlight and its length crop; a first try is recorded
 * once (Elo, the history, the rewards), Try again never (nor cheered). Returns the stages played.
 */
function checkPassSet(played, { plan, where }) {
  const { board, tries, sounds, store, warnings, expected } = played;
  const log = board.log;
  const history = store.get('history') ?? [];
  assert.deepEqual(history.map((h) => h.id), expected.map((e) => e.id), `${where}: the reps are the set dealt, in its order`);
  const segs = [];
  for (const r of log.renders) {
    if (r.ph === 'set' && (!segs.length || segs.at(-1).at(-1).ph !== 'set')) segs.push([]);
    segs.at(-1)?.push(r);
  }
  assert.equal(segs.length, 5, `${where}: a role card for each of the 5 reps`);
  const inSeg = (i) => (e) => e.seq > segs[i][0].seq && (i + 1 >= segs.length || e.seq < segs[i + 1][0].seq);
  const stages = [];
  let feetLanes = 0, previews = 0; // (the lanes to feet and the preview lines checked against the figures as drawn)
  const inside = (c, p) => p.x >= c.x0 - 1e-6 && p.x <= c.x1 + 1e-6 && p.y >= c.y0 - 1e-6 && p.y <= c.y1 + 1e-6;
  const onPitch = (p) => ({ x: Math.min(105, Math.max(0, p.x)), y: Math.min(68, Math.max(0, p.y)) });
  const grownArea = (c) => Math.max(c.x1 - c.x0, PASS_DEFAULTS.cameraMin.length) * Math.max(c.y1 - c.y0, PASS_DEFAULTS.cameraMin.width);
  for (const [i, seg] of segs.entries()) {
    const ids = seg[0].ids, n = ids.length, key = ids.join(',');
    const rep = `${where} rep ${i + 1}`;
    const phases = new Set(seg.map((r) => r.ph));
    for (const want of ['set', 'watch', 'choose', 'result', 'reveal']) assert.ok(phases.has(want), `${rep}: drawn in ${want} (${[...phases].join(', ')})`);
    for (const r of seg) assert.equal(r.ids.join(','), key, `${rep}: the ${r.ph} draws only the cast (${r.ids.length} players, not ${n})`);
    // Exactly the staged cast (cast.js bestStage at the stage its slot wants): nobody hidden is drawn, nobody in it left out.
    const want = expected[i];
    if (want.ids) assert.deepEqual(ids, want.ids, `${rep}: draws the ${want.stage} game's cast (${want.label})`);
    else assert.equal(n, 22, `${rep}: the full match draws everyone`);
    const you = seg[0].learner;
    assert.ok(seg.every((r) => r.learner === you) && ids.includes(you) && you.startsWith('us-'), `${rep}: YOU (${you}) are drawn`);
    // The card, as the watch began: the game's size and "N v M" for the players drawn.
    const card = seg.find((r) => r.ph === 'watch').card;
    const ours = ids.filter((id) => id.startsWith('us-')).length, theirs = ids.filter((id) => id.startsWith('them-')).length;
    const vs = /(\d+) v (\d+)/.exec(card);
    const stage = /Full match/.test(card) ? 'full' : /Small game/.test(card) ? 'small' : /Bigger game/.test(card) ? 'medium'
      : /Now \d+ v \d+!/.test(card) && vs ? (+vs[1] + +vs[2] === 22 ? 'full' : 'medium') : null;
    assert.ok(stage, `${rep}: the card names the game ("${card}")`);
    if (vs) assert.deepEqual([+vs[1], +vs[2]], [ours, theirs], `${rep}: "${card}" is what is drawn (${ours} v ${theirs})`);
    if (stage === 'full') assert.equal(n, 22, `${rep}: the full match`);
    else assert.ok(stage === 'small' ? n >= 3 && n <= 6 : n >= 6 && n <= 12, `${rep}: ${n} players in a ${stage} game`);
    assert.ok(STAGE_RANK[stage] >= STAGE_RANK[plan[i]], `${rep}: played ${stage}, its slot wants ${plan[i]} (never smaller)`);
    stages.push(stage);
    assert.equal(stage, want.stage, `${rep}: the card names the stage it is played at`);
    // Targets: only teammates drawn (never YOU); a small or bigger game's are its gate's 3-5.
    const targets = log.targets.filter(inSeg(i));
    assert.ok(targets.length >= 1, `${rep}: targets at the choice`);
    for (const t of targets) {
      assert.equal(t.ph, 'choose', `${rep}: targets only at the choice`);
      assert.ok(t.ids.every((id) => ids.includes(id) && id.startsWith('us-') && id !== you), `${rep}: targets ${t.ids} are teammates drawn`);
      if (stage !== 'full') assert.ok(t.ids.length >= 3 && t.ids.length <= 5, `${rep}: ${t.ids.length} targets`);
    }
    for (const m of log.markers.filter(inSeg(i))) for (const id of m.named) assert.ok(ids.includes(id), `${rep}: a ${m.ph} marker on ${id}, who is not drawn`);
    const spots = log.spot.filter(inSeg(i));
    const cams = log.camera.filter(inSeg(i));
    const camAt = (ph) => [...log.camera.filter((c) => c.seq < (seg.find((r) => r.ph === ph)?.seq ?? Infinity))].at(-1)?.r ?? null;
    if (stage === 'full') {
      assert.ok(spots.some((s) => s.ids?.includes(you) && s.ids.includes('ball')), `${rep}: the full match lights YOU and the ball`);
      for (const s of spots) for (const id of s.ids ?? []) assert.ok(id === 'ball' || ids.includes(id), `${rep}: the spotlight on ${id}`);
      for (const ph of ['watch', 'choose']) assert.equal(camAt(ph), null, `${rep}: no camera at the ${ph} (the length crop)`);
    } else {
      assert.ok(spots.every((s) => s.ids === null), `${rep}: a ${stage} game has no spotlight`);
      const watchCam = camAt('watch'), chooseCam = camAt('choose');
      assert.ok(watchCam && chooseCam, `${rep}: a camera on the ${stage} game`);
      const freeze = seg.find((r) => r.ph === 'choose');
      for (const p of [freeze.ball, ...Object.values(freeze.at)]) assert.ok(inside(chooseCam, onPitch(p)), `${rep}: all the freeze in the choice's view`);
      const drawn = { ball: freeze.ball, players: Object.entries(freeze.at).map(([id, p]) => ({ id, ...p })) };
      assert.deepEqual(chooseCam, chooseCamera(drawn, { stage, targets: targets[0].ids }), `${rep}: at the whistle the camera eases in on the freeze`);
      assert.ok(grownArea(chooseCam) <= grownArea(watchCam) + 1e-6, `${rep}: the choice's view is no bigger than the build-up's`);
    }
    assert.ok(cams.some((c) => c.ph === 'reveal' && c.r), `${rep}: the reveal frames the play`);
    // The card comes up only once the camera has landed (the last move before it, cameraMs on), and nothing moves the
    // camera again while it is up: placed for where the board draws everyone at rest, never mid-ease.
    const from = seg[0].t, to = segs[i + 1]?.[0].t ?? Infinity;
    const shownAt = played.cardShown.find((t) => t >= from && t < to);
    assert.ok(Number.isFinite(shownAt), `${rep}: the card came up`);
    let prev = null, lastMove = null;
    for (const c of log.camera) {
      const moved = JSON.stringify(c.r) !== JSON.stringify(prev);
      prev = c.r;
      if (!moved) continue;
      if (c.t <= shownAt) lastMove = c;
      else assert.ok(c.t >= seg.find((r) => r.ph === 'watch').t, `${rep}: the camera moved while the card was up (${c.t} ms)`);
    }
    if (lastMove) assert.ok(shownAt >= lastMove.t + played.cameraMs, `${rep}: the card came up ${shownAt - lastMove.t} ms after the camera moved (it lands in ${played.cameraMs})`);
    // The reveal's lanes (and the preview line) run from the ball to the receiver where the board draws them (drawnAt).
    const drawn = (id, at) => { const d = drawnOffset(id); return { x: at.x + d.x, y: at.y + d.y }; };
    const near = (a, b, what) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6, `${rep}: ${what} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);
    for (const m of log.markers.filter(inSeg(i))) {
      const pic = log.renders.filter((r) => r.seq < m.seq).at(-1);
      for (const x of m.list) {
        if (!(x.lane || x.preview)) continue;
        near(x.a, drawn('ball', pic.ball), `a ${x.lane ? 'lane' : 'preview line'} starts at the ball as drawn`);
        if (x.preview) {
          assert.ok(pic.ids.some((id) => id.startsWith('us-') && Math.hypot(drawn(id, pic.at[id]).x - x.b.x, drawn(id, pic.at[id]).y - x.b.y) < 1e-6), `${rep}: the preview line ends on a teammate as drawn`);
          previews++;
        } else if (!String(x.optionId).includes('@')) {
          near(x.b, drawn(x.optionId, pic.at[x.optionId]), `the lane to ${x.optionId} ends on him as drawn`);
          feetLanes++;
        }
      }
    }
    // Records: the first try once, Try again never.
    const t = tries.get(i + 1);
    assert.ok(t?.first, `${rep}: a first try`);
    assert.deepEqual(t.first.after, { history: t.first.before.history + 1, elo: t.first.before.elo + 1, reps: t.first.before.reps + 1 }, `${rep}: the first try is recorded once`);
    if (t.retry) assert.deepEqual(t.retry.after, t.retry.before, `${rep}: Try again is practice only`);
  }
  assert.ok(feetLanes >= 3 && previews >= 5, `${where}: ${feetLanes} lanes to feet and ${previews} preview lines checked`);
  // The whole set: 5 first tries in the history (their stars), Elo and the rewards, one session; no cheer for practice.
  assert.equal(history.length, 5, `${where}: 5 history entries`);
  assert.ok(history.every((h) => h.mode === 'pass'), `${where}: pass reps`);
  assert.deepEqual(history.map((h) => h.stars), [...tries.values()].map((t) => t.first.stars), `${where}: each rep's first try's stars`);
  assert.equal(store.get('skills')?.counts?.global, 5, `${where}: Elo moved once a rep`);
  assert.equal(store.get('rewards')?.counters?.reps, 5, `${where}: 5 reps rewarded`);
  assert.equal(store.get('rewards')?.counters?.sessions, 1, `${where}: one set`);
  assert.ok(sounds.every((s) => !(s.practice && s.name === 'cheer')), `${where}: practice never cheers`);
  assert.ok(warnings.every((w) => !/could not|failed|not available/.test(w)), `${where}: no failures: ${warnings.join(' / ')}`);
  return { stages, retries: [...tries.values()].filter((t) => t.retry).length };
}

test('pass: mounted, the quick set draws only each rep\'s cast in every phase; records each first try once, Try again never', async (t) => {
  if (!isNode) return; // (the browser has a real page: this drives pass.js mount on a fake one)
  const { stagePlan } = await import('../js/ui/player/road.js');
  const played = await playPassSet({ profile: { version: 1, group: 'MID', role: 'LCM', onboarded: true, road: { 'close-down': { stars: 1, plays: 1 } } } });
  const { stages, retries } = checkPassSet(played, { plan: stagePlan(1), where: 'the quick set' });
  t?.diagnostic?.(`the quick set: ${stages.join(', ')}; ${retries} Try again`);
  assert.ok(stages.includes('small') || stages.includes('medium'), `smaller games: ${stages.join(', ')}`);
  assert.ok(retries >= 1, `${retries} Try again`);
  assert.ok((played.store.get('history') ?? []).every((h) => h.nodeId === null), 'no Road node');
  assert.deepEqual(played.profile.road, { 'close-down': { stars: 1, plays: 1 } }, 'the quick set puts nothing on the Road');
});

test('pass: mounted, a 0-star Road pass node draws only each rep\'s cast in every phase; records each first try once, Try again never', async (t) => {
  if (!isNode) return;
  const { stagePlan } = await import('../js/ui/player/road.js');
  const played = await playPassSet({ params: ['free-player'], profile: { version: 1, group: 'WING', role: 'LW', onboarded: true, road: { 'close-down': { stars: 1, plays: 1 } } } });
  assert.deepEqual(played.navigated.filter((h) => h !== '#/'), [], 'played here (a pass node)');
  const { stages, retries } = checkPassSet(played, { plan: stagePlan(0), where: 'free-player' });
  t?.diagnostic?.(`free-player at 0 stars: ${stages.join(', ')}; ${retries} Try again`);
  assert.ok(stages.includes('small'), `a small game: ${stages.join(', ')}`);
  assert.ok(retries >= 1, `${retries} Try again`);
  assert.ok((played.store.get('history') ?? []).every((h) => h.nodeId === 'free-player'), 'the node\'s reps');
  assert.equal(played.profile.road['free-player']?.plays, 1, 'the set is on the Road once');
  assert.equal(played.profile.road['free-player']?.starts, 1, 'begun once');
});
