// The rewards UI's pure parts: js/ui/rewards-store.js (awarding, gains, the kit), js/ui/celebrate.js (what a
// celebration shows and plays), js/ui/sound.js (never throws) and the trophy room's album (js/ui/modes/trophies.js).
// No DOM: everything here runs under node --test and in tests.html.

import { test, assert, loadJSON, isNode } from './harness.js';
import {
  todayLocal, loadRewards, saveRewards, award, emptyGains, cleanGains, mergeGains, kitVars, paletteVars, KIT_VARS,
  youLabel, shirtNumber, totalStars, REWARDS_KEY,
} from '../js/ui/rewards-store.js';
import {
  celebrationModel, rewardChips, soundPlan, levelUpModel, levelModel, pillModel, starSlots, confettiPieces,
  rewardCopy, rankIcon, RANK_ICONS, CELEBRATE_DEFAULTS, TIER_ICONS,
} from '../js/ui/celebrate.js';
import { createSound, SOUND_NAMES } from '../js/ui/sound.js';
import { albumModel, shortDay } from '../js/ui/modes/trophies.js';
import { createRewards, applyEvent, BADGES, KIT_PALETTES, LEVEL_XP, RANKS } from '../js/rewards.js';
import { createStore } from '../js/store.js';

const [principleData, curriculum] = await Promise.all([loadJSON('data/principles.json'), loadJSON('data/curriculum.json')]);
const byId = Object.fromEntries(principleData.principles.map((p) => [p.id, p]));
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

function memStore() {
  const m = new Map();
  return createStore(() => ({
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  }));
}
/** A minimal app: a store, settings and a celebrate spy. */
function fakeApp(wording = 'standard') {
  const shown = [];
  return { store: memStore(), settings: { wording }, celebrate: { show: (g, o) => shown.push({ g, o }) }, shown };
}

async function loadText(path) {
  if (isNode) {
    const { readFile } = await import('node:fs/promises');
    return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  }
  return (await fetch(new URL(`../${path}`, import.meta.url))).text();
}

// ---------------------------------------------------------------- rewards-store.js

test('celebrate: todayLocal is the local calendar day as YYYY-MM-DD', () => {
  assert.equal(todayLocal(new Date(2026, 8, 27, 23, 59)), '2026-09-27', 'late evening is still today (local, not UTC)');
  assert.equal(todayLocal(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
  assert.match(todayLocal(), /^\d{4}-\d{2}-\d{2}$/);
});

test('celebrate: award saves the event with the local day and hands the gains to the celebrations', () => {
  const app = fakeApp();
  const now = new Date(2026, 8, 27, 18, 0);
  const g1 = award(app, { type: 'rep', scenarioId: 'm1-02-d3-rcb-m', role: 'LCB', grade: 'A', score: 84 }, { now });
  assert.equal(g1.stars, 2);
  assert.equal(g1.firstTry, true, 'the first attempt at this drill');
  assert.equal(app.shown.length, 1);
  assert.equal(app.shown[0].o.grade, 'A', 'a rep celebrates with its own grade');
  const saved = loadRewards(app);
  assert.ok(saved.days['2026-09-27'], 'trained today (local day)');
  assert.ok(saved.best['m1-02-d3-rcb'], 'the mirror shares its original\'s record');
  assert.ok(app.store.get(REWARDS_KEY), 'persisted under the rewards key');
  const g2 = award(app, { type: 'rep', scenarioId: 'm1-02-d3-rcb', role: 'RCB', grade: 'S', score: 96 }, { now, celebrate: false });
  assert.equal(g2.firstTry, false);
  assert.equal(g2.improved, true, '+12 counts as improving');
  assert.equal(app.shown.length, 1, 'celebrate: false shows nothing');
  const broken = { store: { get: () => { throw new Error('boom'); } } };
  const err = console.error; console.error = () => {};
  try { assert.deepEqual(award(broken, { type: 'explore-s' }), emptyGains(), 'a failure never breaks the caller'); } finally { console.error = err; }
});

test('celebrate: gains merge (a rep and its stickers; a whole session) and survive a damaged saved session', () => {
  const rep = { xp: 70, stars: 2, newBest: true, improved: false, firstTry: false, badges: ['first-rep'], cards: [], levelUp: { from: 1, to: 2, rank: RANKS[0], rankUp: false, unlocks: ['sky'] } };
  const card = { xp: 30, stars: null, newBest: false, improved: false, badges: ['first-rep', 'collector'], cards: [{ id: 'D3', tier: 1, upgrade: false }], levelUp: { from: 2, to: 3, rankUp: true, unlocks: ['lime'] } };
  const m = mergeGains(rep, card);
  assert.equal(m.xp, 100);
  assert.equal(m.stars, 2, 'the rep\'s stars');
  assert.deepEqual(m.badges, ['first-rep', 'collector'], 'a badge counts once');
  assert.deepEqual(m.levelUp.from, 1);
  assert.deepEqual(m.levelUp.to, 3);
  assert.equal(m.levelUp.rank.id, 'academy');
  assert.equal(m.levelUp.rankUp, true);
  assert.deepEqual(m.levelUp.unlocks, ['sky', 'lime']);
  const later = mergeGains(m, { xp: 30, cards: [{ id: 'D3', tier: 2, upgrade: true }] });
  assert.deepEqual(later.cards, [{ id: 'D3', tier: 2, upgrade: false }], 'one card per principle: its best tier, new this session');
  assert.deepEqual(cleanGains('junk'), emptyGains());
  const c = cleanGains({ xp: -5, stars: 9, badges: ['nope', 'first-s'], cards: [{ id: 'D1', tier: 7 }, { id: 'D2', tier: 2 }], levelUp: { from: 3, to: 2 } });
  assert.equal(c.xp, 0);
  assert.equal(c.stars, null);
  assert.deepEqual(c.badges, ['first-s']);
  assert.deepEqual(c.cards, [{ id: 'D2', tier: 2, upgrade: false }]);
  assert.equal(c.levelUp, null);
});

test('celebrate: the kit sets the board colours; classic is the stylesheet\'s default', async () => {
  const css = await loadText('css/app.css');
  const classic = KIT_PALETTES[0];
  assert.equal(classic.id, 'classic');
  for (const [key, prop] of [['shirt', KIT_VARS.shirt], ['edge', KIT_VARS.edge], ['ink', KIT_VARS.ink]]) {
    const m = new RegExp(`${prop}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
    assert.ok(m, `${prop} is defined in css/app.css`);
    assert.equal(m[1].toLowerCase(), classic[key], `${prop} default = the classic palette`);
  }
  assert.deepEqual(kitVars(createRewards()), paletteVars(classic));
  const s = { ...createRewards(), xp: LEVEL_XP[1], kit: { palette: 'sky', number: 7, nickname: 'Rocket' } };
  assert.equal(kitVars(s)['--kit-us'], KIT_PALETTES.find((p) => p.id === 'sky').shirt);
  assert.equal(youLabel(s), 'Rocket');
  assert.equal(youLabel(createRewards()), 'YOU', 'no nickname: the board says YOU');
  assert.equal(shirtNumber(s, 4), 7, 'the kit\'s number wins');
  assert.equal(shirtNumber(createRewards(), 4), 4, 'else the position\'s');
});

test('celebrate: total stars add up the best of every drill (a mirror shares its record)', () => {
  let s = createRewards();
  for (const [id, grade, score] of [['a', 'S', 95], ['a-m', 'B', 72], ['b', 'A', 85], ['c', 'D', 50]]) {
    s = applyEvent(s, { type: 'rep', scenarioId: id, role: 'LCB', grade, score }, { day: '2026-09-27' }).state;
  }
  assert.equal(totalStars(s), 3 + 2 + 0);
  assert.equal(totalStars(null), 0);
  const app = fakeApp();
  saveRewards(app, s);
  assert.equal(totalStars(loadRewards(app)), 5);
});

// ---------------------------------------------------------------- celebrate.js

test('celebrate: one celebration per rep: stars, XP, a short tag, one chip per badge or sticker', () => {
  const gained = { xp: 70, stars: 2, newBest: true, improved: false, firstTry: true, badges: [], cards: [], levelUp: null };
  const std = celebrationModel(gained, { wording: 'standard', grade: 'A' });
  assert.equal(std.xpText, '+70 XP');
  assert.equal(std.stars, 2);
  assert.equal(std.headline, null, 'standard wording: the stars say it');
  assert.equal(std.tag, null, 'no "New best!" on a first attempt');
  assert.equal(std.burst, false, 'an A has no confetti');
  const kid = celebrationModel({ ...gained, firstTry: false }, { wording: 'kid', grade: 'A' });
  assert.equal(kid.headline, 'Great job!');
  assert.equal(kid.tag, 'New best!');
  assert.equal(celebrationModel({ ...gained, stars: 3 }, { wording: 'kid' }).headline, 'Brilliant!');
  assert.equal(celebrationModel({ ...gained, stars: 0, xp: 10 }, { wording: 'kid' }).headline, 'Good try!', 'every attempt is praised');
  assert.equal(celebrationModel({ ...gained, improved: true }, { wording: 'standard' }).tag, 'You improved!');
  assert.equal(celebrationModel({ ...gained, stars: 3 }, { grade: 'S' }).burst, true, 'an S bursts');
  assert.equal(celebrationModel(emptyGains()).empty, true, 'nothing earned: nothing shown');
  assert.equal(celebrationModel({ xp: 10, stars: null }).stars, null, 'events other than a rep have no star row');
  assert.match(kid.sr, /2 of 3 stars/);
  assert.match(kid.sr, /70 XP/);
});

test('celebrate: Coach mode shows no rewards: every Coach screen that awards or draws them checks earnsRewards first', async () => {
  // Coach mode earns nothing (award() does nothing there), so a reward row, the drill summary's rewards card ("+0 XP"),
  // a floating celebration or a reward sound could only ever show zeros: the Coach screens leave them out.
  const coach = { ...fakeApp(), settings: { wording: 'standard', mode: 'coach' } };
  assert.deepEqual(award(coach, { type: 'explore-s' }, { grade: 'S' }), emptyGains());
  assert.deepEqual(coach.shown, [], 'nothing celebrated (no sounds, no burst)');
  let files = ['home', 'learn', 'explore', 'drill', 'live', 'progress', 'trophies', 'author', 'credits', 'dev'];
  if (isNode) {
    const { readdir } = await import('node:fs/promises');
    files = [...new Set([...files, ...(await readdir(new URL('../js/ui/modes/', import.meta.url))).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3))])];
  }
  const hooks = /\baward\(app\b|\bsessionCard\(|\bcelebrate\??\.show\(/;
  const showing = [];
  for (const f of files) {
    const src = await loadText(`js/ui/modes/${f}.js`);
    if (!hooks.test(src)) continue;
    showing.push(f);
    assert.match(src, /\bearnsRewards\(app\)/, `${f}.js awards or draws rewards: it must check earnsRewards(app) (none in Coach mode)`);
  }
  assert.deepEqual(showing.sort(), ['drill', 'explore', 'learn', 'live']);
});

test('celebrate: badge and sticker chips are six words at most, plus the icon, in both wordings', () => {
  for (const w of ['standard', 'kid']) {
    const all = rewardChips({ badges: BADGES.map((b) => b.id) }, { wording: w });
    assert.equal(all.length, BADGES.length);
    for (const c of all) {
      assert.ok(words(c.text) <= 6, `${w} ${c.id}: "${c.text}"`);
      assert.ok(c.icon, `${c.id} has an icon`);
    }
    const C = rewardCopy(w);
    assert.ok(words(C.newCard('X')) <= 3, 'a new sticker adds at most two words to its name');
    for (const tier of [1, 2, 3]) assert.ok(words(C.upCard(C.tiers[tier])) <= 6);
  }
  const taught = curriculum.modules.filter((m) => m.kind === 'drills').flatMap((m) => m.principles);
  for (const id of taught) {
    const [chip] = rewardChips({ cards: [{ id, tier: 1, upgrade: false }] }, { wording: 'standard', principles: byId });
    assert.ok(words(chip.text) <= 6, `${id}: "${chip.text}"`);
    assert.equal(chip.icon, TIER_ICONS[1]);
  }
  const [kidCard] = rewardChips({ cards: [{ id: 'D3', tier: 2, upgrade: false }] }, { wording: 'kid', principles: { D3: { id: 'D3', short: 'Cover at an angle', kidName: 'Back up' } } });
  assert.match(kidCard.text, /Back up/, 'Kid wording names the sticker by its kidName');
  const many = celebrationModel({ xp: 50, badges: BADGES.slice(0, 6).map((b) => b.id) });
  assert.equal(many.chips.length, CELEBRATE_DEFAULTS.maxChips, 'a few chips, then "+N more"');
  assert.equal(many.chips.at(-1).kind, 'more');
  assert.equal(many.chips.at(-1).text, `+${6 - CELEBRATE_DEFAULTS.maxChips + 1} more`);
});

test('celebrate: the star row lights 0-3 stars; the sounds follow the grade and the stars', () => {
  assert.deepEqual(starSlots(0), [false, false, false]);
  assert.deepEqual(starSlots(2), [true, true, false]);
  assert.deepEqual(starSlots(3), [true, true, true]);
  assert.deepEqual(starSlots(9), [true, true, true], 'capped');
  assert.deepEqual(starSlots('x'), [false, false, false]);
  const plan = (grade, stars) => soundPlan(celebrationModel({ xp: 50, stars }, { grade }));
  const s = plan('S', 3);
  assert.deepEqual(s.map((p) => p.name), ['good', 'cheer', 'star', 'star', 'star']);
  assert.deepEqual(s.filter((p) => p.name === 'star').map((p) => p.index), [0, 1, 2]);
  assert.ok(s.filter((p) => p.name === 'star').every((p, i, a) => i === 0 || p.at > a[i - 1].at), 'one star at a time');
  assert.deepEqual(plan('A', 2).map((p) => p.name), ['good', 'star', 'star']);
  assert.deepEqual(plan('C', 0), [], 'no ding below an A');
});

test('celebrate: levels, ranks and the level-up screen (one button: "Try it on" with a new kit)', () => {
  assert.deepEqual(Object.keys(RANK_ICONS).sort(), RANKS.map((r) => r.id).sort(), 'every rank has an icon');
  const m1 = levelModel(createRewards());
  assert.equal(m1.level, 1);
  assert.equal(m1.rank.id, 'rookie');
  assert.equal(m1.icon, rankIcon('rookie'));
  assert.ok(m1.progress >= 0 && m1.progress < 1);
  const pill = pillModel({ xp: LEVEL_XP[2] }, 'kid');
  assert.equal(pill.text, 'Lv 3');
  assert.match(pill.aria, /Level 3, Academy/);
  const up = levelUpModel({ from: 1, to: 2, rank: RANKS[0], rankUp: false, unlocks: ['sky'] }, { wording: 'standard' });
  assert.equal(up.level, 2);
  assert.equal(up.rank, 'Rookie');
  assert.equal(up.button, 'Try it on');
  assert.equal(up.action, 'kit');
  assert.equal(up.kit.id, 'sky');
  assert.equal(up.ribbon, null);
  const rankUp = levelUpModel({ from: 4, to: 5, rank: RANKS[2], rankUp: true, unlocks: [] }, { wording: 'kid' });
  assert.equal(rankUp.action, 'close');
  assert.equal(rankUp.button, 'Keep playing');
  assert.equal(rankUp.ribbon, 'New rank!');
  assert.equal(rankUp.kit, null);
  assert.ok(words(rankUp.button) <= 3 && words(up.button) <= 3, 'the one button is short');
});

test('celebrate: a confetti burst flies up and out, then falls (none under reduced motion: the view skips it)', () => {
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pieces = confettiPieces(40, rng);
  assert.equal(pieces.length, 40);
  for (const p of pieces) {
    assert.ok(p.dy < 0, 'up first');
    assert.ok(p.fall > 0, 'then down');
    assert.ok(p.size >= 6 && p.size <= 11);
    assert.ok(p.duration <= CELEBRATE_DEFAULTS.confettiMs);
    assert.match(p.color, /^#[0-9a-f]{6}$/i);
  }
  assert.deepEqual(confettiPieces(0), []);
});

// ---------------------------------------------------------------- trophies.js

test('trophies: the album has one card per principle of the drill modules, with its tier', () => {
  const taught = [...new Set(curriculum.modules.filter((m) => m.kind === 'drills').flatMap((m) => m.principles))];
  let s = createRewards();
  s = applyEvent(s, { type: 'mastery', principleId: 'D3', stars: 2 }, { day: '2026-09-27' }).state;
  s = applyEvent(s, { type: 'mastery', principleId: 'U4', stars: 3 }, { day: '2026-09-27' }).state;
  const album = albumModel(curriculum, { byId }, s, 'standard');
  assert.equal(album.total, taught.length);
  assert.equal(album.collected, 2);
  assert.deepEqual(album.tiers, { 1: 0, 2: 1, 3: 1 });
  assert.deepEqual(album.modules.map((m) => m.id), ['M1', 'M2', 'M3']);
  const d3 = album.modules[0].cards.find((c) => c.id === 'D3');
  assert.equal(d3.tier, 2);
  assert.equal(d3.label, byId.D3.short);
  const kid = albumModel(curriculum, { D3: { id: 'D3', short: 'Cover at an angle', kidName: 'Back up your friend' } }, s, 'kid');
  assert.equal(kid.modules[0].cards.find((c) => c.id === 'D3').label, 'Back up your friend');
  assert.equal(albumModel(null, {}, s).total, 0, 'no curriculum: an empty album');
});

test('trophies: a badge\'s day shows as a short date', () => {
  assert.match(shortDay('2026-09-27', 'en-GB'), /27/);
  assert.match(shortDay('2026-09-27', 'en-GB'), /Sep/);
  assert.equal(shortDay('yesterday'), '');
  assert.equal(shortDay(null), '');
});

// ---------------------------------------------------------------- sound.js

/** A stand-in for WebAudio that records what was built (every AudioParam method is a no-op). */
function fakeAudio({ failOn } = {}) {
  const made = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = (kind, extra = {}) => {
    if (kind === failOn) throw new Error(`no ${kind}`);
    const n = { kind, connect() {}, disconnect() {}, start() {}, stop() {}, ...extra };
    made.push(n);
    return n;
  };
  class Ctx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    createGain() { return node('gain', { gain: param() }); }
    createOscillator() { return node('osc', { type: 'sine', frequency: param(), detune: param() }); }
    createBiquadFilter() { return node('filter', { type: 'lowpass', frequency: param(), Q: param() }); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { return node('source', { buffer: null, loop: false }); }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  const handlers = {};
  const win = { AudioContext: Ctx, addEventListener: (t, fn) => { handlers[t] = fn; }, removeEventListener: (t) => { delete handlers[t]; } };
  return { win, made, gesture: () => handlers.pointerdown?.() };
}

test('sound: every sound plays through WebAudio after a gesture, and nothing throws without it', () => {
  const none = createSound({ win: {} });
  for (const name of SOUND_NAMES) assert.equal(none.play(name), false, `${name}: no WebAudio, no sound, no error`);
  assert.equal(createSound().play('whistle'), false, 'no gesture yet (and no WebAudio in Node)');

  const audio = fakeAudio();
  const sound = createSound({ win: audio.win });
  assert.equal(sound.play('good'), false, 'nothing before the first user gesture');
  audio.gesture();
  assert.equal(sound.ready, true, 'the context is created on the first gesture');
  for (const name of SOUND_NAMES) assert.equal(sound.play(name, { index: 2 }), true, name);
  assert.ok(audio.made.some((n) => n.kind === 'osc') && audio.made.some((n) => n.kind === 'source'), 'tones and noise');
  assert.equal(sound.play('nope'), false);
  sound.destroy();

  let on = false;
  const off = fakeAudio();
  const quiet = createSound({ enabled: () => on, win: off.win });
  off.gesture();
  assert.equal(quiet.ready, false, 'sound off: no context is made');
  assert.equal(quiet.play('whistle'), false);
  on = true;
  assert.equal(quiet.play('whistle'), true, 'switched on later: it starts');

  const broken = fakeAudio({ failOn: 'filter' });
  const b = createSound({ win: broken.win });
  broken.gesture();
  assert.equal(b.play('whistle'), false, 'a failing node is swallowed');
  assert.equal(b.play('star'), true, 'other sounds still play');
});
