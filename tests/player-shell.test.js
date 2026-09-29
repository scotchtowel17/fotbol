// Player mode's shell, home, kick-off and card (js/ui/player/shell.js, home.js, kickoff.js, card.js): the pure parts.
// docs/KID_REDESIGN.md §1, §2, §4.1, §4.2, §4.7.
import { test, assert, loadJSON } from './harness.js';
import * as R from '../js/ui/player/road.js';
import * as Shell from '../js/ui/player/shell.js';
import * as Home from '../js/ui/player/home.js';
import * as Kickoff from '../js/ui/player/kickoff.js';
import * as Card from '../js/ui/player/card.js';
import { resolveRoute, parseHash } from '../js/main.js';
import { createRewards, RANKS, NICKNAMES } from '../js/rewards.js';

const road = R.normalizeRoad(await loadJSON('data/road.json'));
const principlesFile = await loadJSON('data/principles.json');
const principles = Object.fromEntries((principlesFile.principles ?? principlesFile).map((p) => [p.id, p]));
const profileWith = (group, stars = {}) => ({ ...R.pickGroup(null, group, road), road: Object.fromEntries(Object.entries(stars).map(([id, s]) => [id, { stars: s, plays: 1 }])) });
const words = (s) => String(s ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const route = (hash, ctx = { appMode: 'player', onboarded: true }) => resolveRoute(parseHash(hash), ctx);

// ---------------------------------------------------------------- the shell

test('shell: each route shows its header: Coach routes the Coach header, home and card the top bar, the rest none', () => {
  for (const h of ['#/coach', '#/drill', '#/explore/LB', '#/learn', '#/live', '#/progress', '#/author', '#/trophies', '#/credits', '#/dev', '#/nope']) {
    assert.equal(Shell.chromeFor(route(h)), 'coach', h);
  }
  assert.equal(Shell.chromeFor(route('#/')), 'player');
  assert.equal(Shell.chromeFor(route('#/card/kit')), 'player');
  for (const h of ['#/kickoff', '#/kickoff/kit', '#/play/first', '#/pass', '#/matchday']) assert.equal(Shell.chromeFor(route(h)), 'none', h);
  assert.equal(Shell.chromeFor(route('#/', { appMode: 'player', onboarded: false })), 'none', 'a first open goes to the kick-off, full screen');
  assert.equal(Shell.chromeFor(route('#/', { appMode: 'coach', onboarded: true })), 'coach');
  assert.equal(Shell.playerTitle('home'), 'fotbol');
  assert.equal(Shell.playerTitle('card'), 'Your card · fotbol');
});

test('shell: the top bar shows your shirt number (kit, else position), nickname, level and rank word', () => {
  const fresh = Shell.topBarModel({ rewards: createRewards(), profile: R.pickGroup(null, 'MID'), settings: { role: 'LCB' } });
  assert.deepEqual([fresh.number, fresh.nickname, fresh.level, fresh.rank], [8, '', 1, RANKS[0].name], 'a midfielder starts as the #8');
  const kitted = Shell.topBarModel({ rewards: { ...createRewards(), xp: 100000, kit: { palette: 'classic', number: 23, nickname: NICKNAMES[0] } }, profile: R.pickGroup(null, 'DEF') });
  assert.equal(kitted.number, 23);
  assert.equal(kitted.nickname, NICKNAMES[0]);
  assert.equal(kitted.rank, RANKS.at(-1).name);
  assert.ok(kitted.progress >= 0 && kitted.progress <= 1);
  assert.equal(Shell.topBarModel({ rewards: null, profile: null, settings: { role: 'ST' } }).number, 9, 'no profile: Coach mode\'s position');
});

test('shell: the top bar and the card show your own figure: the look YOU have on the pitch, your number, your kit', async () => {
  const { figureLook, figureSpec, FIGURE } = await import('../js/ui/figures.js');
  const m = Shell.topBarModel({ rewards: { ...createRewards(), kit: { palette: 'classic', number: 23, nickname: '' } }, profile: R.pickGroup(null, 'DEF') });
  assert.equal(m.role, 'LB');
  assert.deepEqual(m.look, figureLook('us-LB', 'us'), 'the board draws YOU (us-LB) with this look');
  assert.deepEqual(Shell.kidLook('ST'), figureLook('us-ST'));
  assert.deepEqual(Shell.kidLook(null), figureLook('us-LCM'), 'no position yet: a midfielder\'s look');
  assert.deepEqual(Shell.kidLook('GK'), figureLook('us-LCM'), 'never a keeper');
  assert.equal(Shell.topBarModel({ rewards: null, profile: null, settings: { role: 'nope' } }).role, null);
  // Each group's position has its own look, so the four players on the kick-off screen differ.
  const looks = R.GROUPS.map((g) => JSON.stringify(Shell.kidLook(R.DEFAULT_ROLE[g])));
  assert.equal(new Set(looks).size, 4, looks.join(' '));
  // The crops: the whole figure on its base (2.4 base radii tall), or head and shoulders with the shirt number.
  const { full, bust } = Shell.KID_FIGURE_CROPS;
  assert.ok(full.y <= -FIGURE.height - 0.2 && full.y + full.height >= Shell.KID_BASE_R && full.x <= -FIGURE.halfWidth && full.x + full.width >= FIGURE.halfWidth, 'the base, the arms and the hair fit');
  // The base is about the shoulders wide, as the board draws a figure's base (board.js figureBase x FIGURE.shoulders): never a plate.
  const { BOARD_DEFAULTS } = await import('../js/ui/board.js');
  const across = 2 * Shell.KID_BASE_R / FIGURE.shoulders;
  assert.ok(across >= BOARD_DEFAULTS.figureBase.min && across <= BOARD_DEFAULTS.figureBase.max, `${across} shoulder widths across`);
  // The kit you wear: explicit colours from the palette (the top bar, the card), the classic kit when none is set.
  assert.deepEqual(m.palette, { shirt: '#fff3c9', edge: '#6b5600', ink: '#2a2200' });
  assert.deepEqual(Shell.kitPalette({ ...createRewards(), xp: 100000, kit: { palette: 'sky', number: null, nickname: '' } }), { shirt: '#cfe8ff', edge: '#1d4f91', ink: '#0b2545' });
  assert.ok(bust.y <= FIGURE.head.y - FIGURE.head.r - 0.15, 'the hair fits the bust');
  assert.ok(bust.y + bust.height >= FIGURE.numberY + 0.35, 'the shirt number shows in the bust');
  assert.ok(bust.y + bust.height < -0.72, 'no legs in the bust');
  // The kit locker tries a kit on: explicit colours on the figure (a CSS colour each); else the live kit (--kit-us*).
  const spec = figureSpec({ ...Shell.kidLook('LB'), shirt: '#cfe8ff', edge: '#1d4f91', ink: '#0b2545', shorts: '#1d4f91', number: 23 });
  assert.match(spec.attrs.style, /--fig-shirt:#cfe8ff/);
  assert.equal(figureSpec({ number: 3 }).attrs.style, null, 'no palette: the figure takes the kit the app wears');
});

test('kickoff: the replay\'s camera fits the small game\'s players through the whole clip', () => {
  const frameOf = (t) => ({ ball: { x: 50 + t, y: 30 }, players: [{ id: 'us-LCM', x: 40 + 2 * t, y: 30 }, { id: 'them-RCM', x: 60, y: 20 - t }] });
  assert.deepEqual(Kickoff.replayCamera(frameOf, 2), { x0: 40, x1: 60, y0: 18, y1: 30 });
  assert.equal(Kickoff.replayCamera(() => ({ players: [] }), 1), null);
  assert.equal(Kickoff.KICKOFF_DEFAULTS.stage, 'small');
});

test('shell: icons and cards exist for every Road icon', () => {
  for (const n of R.roadNodes(road)) assert.ok(Shell.PLAYER_ICONS[n.icon], `icon "${n.icon}" (${n.id})`);
  for (const c of road.chapters) assert.ok(Shell.PLAYER_ICONS[c.icon], `chapter icon "${c.icon}"`);
  for (const name of ['play', 'lock', 'card', 'cog', 'close', 'home', 'star', 'pass', 'whistle', 'shirt', 'check']) assert.ok(Shell.PLAYER_ICONS[name], name);
});

// ---------------------------------------------------------------- home

test('home: the model has the next node and where it plays, the two tiles, the week and the Road', () => {
  const m = Home.homeModel({ road, profile: profileWith('DEF'), rewards: createRewards(), today: '2026-09-27' });
  assert.deepEqual(m.next, { id: 'close-down', title: 'Close Them Down', href: '#/play/close-down', reps: 5 });
  assert.equal(Home.STRINGS.next(m.next.title, m.next.reps), 'Next: Close Them Down · 5 plays');
  assert.deepEqual(m.tiles.pass, { href: '#/pass' });
  assert.deepEqual(m.tiles.matchday, { href: '#/matchday', unlocked: false, hint: 'Finish Big Match', short: 'Finish', gate: { id: 'defend-match', title: 'Big Match', icon: 'trophy' } });
  assert.equal(words(m.tiles.matchday.hint), 3, 'screen readers hear "Finish Big Match"');
  // The Big Match (a trophy like every chapter match) shows its title, so "Finish" and its trophy on the tile point at it.
  const labels = m.chapters.flatMap((c) => c.nodes).filter((n) => n.label);
  assert.deepEqual(labels.map((n) => [n.id, n.label]), [['defend-match', 'Big Match']]);
  assert.deepEqual(m.week, { count: 0, max: 7 });
  assert.deepEqual(m.chapters.map((c) => [c.id, c.unlocked, c.showTitle]), [['defend', true, true], ['help', false, false], ['passing', false, false], ['shape', false, false]]);
  const later = Home.homeModel({ road, profile: profileWith('DEF', { 'close-down': 3, 'back-up': 3, 'goal-side': 3, 'defend-match': 1 }), rewards: createRewards(), today: '2026-09-27' });
  assert.equal(later.next.id, 'defend-match', 'Big Match has 1 star: still next up');
  const wing = Home.homeModel({ road, profile: profileWith('WING', { 'close-down': 1 }), rewards: createRewards(), today: '2026-09-27' });
  assert.deepEqual([wing.next.id, wing.chapters.find((c) => c.showTitle).id], ['get-open', 'help'], 'a winger\'s Play goes to Help the ball next');
  assert.equal(later.tiles.matchday.unlocked, true);
  const passNext = Home.homeModel({ road, profile: profileWith('MID', Object.fromEntries(['close-down', 'back-up', 'goal-side', 'defend-match', 'get-open', 'stay-wide', 'between-lines', 'crosses', 'help-match'].map((id) => [id, 3]))) });
  assert.equal(passNext.next.href, '#/pass/free-player', 'a pass node plays at #/pass');
});

test('home: the screen stays within 25 words wherever you are on the Road (R2, teardown 5.2)', () => {
  // Every visible string of the home (top bar included, with the longest rank and nickname), over many Road states.
  const longRank = RANKS.reduce((a, r) => (words(r.name) > words(a) ? r.name : a), '');
  const longNick = NICKNAMES.reduce((a, n) => (words(n) > words(a) ? n : a), '');
  const ids = R.roadNodes(road).map((n) => n.id);
  let worst = 0;
  for (let k = 0; k <= ids.length; k++) {
    for (const s of [1, 3]) {
      const stars = Object.fromEntries(ids.slice(0, k).map((id) => [id, s]));
      for (const group of ['DEF', 'WING']) {
        const m = Home.homeModel({ road, profile: profileWith(group, stars), rewards: createRewards(), today: '2026-09-27' });
        const visible = [
          longNick, '10', '99', longRank, // the top bar: nickname, shirt number, level, rank
          ...Home.homeWords(m), // Play, Next..., the tiles (the locked one says "Finish" with the trophy), This week, the chapter, the Big Match's label
        ];
        assert.ok(visible.includes(Home.STRINGS.play) && visible.includes('Big Match'));
        const n = words(visible.join(' '));
        worst = Math.max(worst, n);
        assert.ok(n <= 25, `${n} words with ${k} nodes at ${s} stars (${group}): ${visible.join(' | ')}`);
        assert.equal(m.chapters.filter((c) => c.showTitle).length, 1, 'one chapter title on show');
      }
    }
  }
  assert.ok(worst >= 18, `the check saw real screens (${worst} words at most)`);
});

test('home: days played this week count the Monday-to-Sunday week of today, and only go up', () => {
  const state = { ...createRewards(), days: { '2026-09-21': true, '2026-09-23': true, '2026-09-27': true, '2026-09-20': true, '2026-09-28': true, junk: true } };
  assert.equal(Home.weekCount(state, '2026-09-27'), 3, 'Mon 21, Wed 23 and Sun 27; Sun 20 is last week, Mon 28 next week');
  assert.equal(Home.weekCount(state, '2026-09-28'), 1);
  assert.equal(Home.weekCount(createRewards(), '2026-09-27'), 0);
  assert.equal(Home.weekCount(null, 'not a day'), 0);
  const full = { days: Object.fromEntries(['21', '22', '23', '24', '25', '26', '27'].map((d) => [`2026-09-${d}`, true])) };
  assert.equal(Home.weekCount(full, '2026-09-24'), 7);
});

// ---------------------------------------------------------------- kick-off

test('kickoff: the first screen reads 6 words or fewer, and the four shirts are the position groups', () => {
  const S = Kickoff.STRINGS;
  assert.ok(words([S.wordmark, S.play, S.coachAsk].join(' ')) <= 6);
  assert.equal(words(S.pickTitle), 4);
  assert.deepEqual(Object.values(S.groups), ['Defender', 'Midfielder', 'Winger', 'Striker']);
  assert.ok(Kickoff.KICKOFF_DEFAULTS.drills.length >= 1);
});

// ---------------------------------------------------------------- your card

test('card: skill ratings run 45 (not played) to 99 (every node of the chapter at 3 stars)', () => {
  const fresh = Card.skillRatings({ road, profile: profileWith('DEF'), skills: null });
  assert.deepEqual(fresh.map((s) => [s.label, s.rating]), [['Defend', 45], ['Help', 45], ['Pass', 45], ['Shape', 45]]);
  const full = Card.skillRatings({ road, profile: profileWith('DEF', { 'close-down': 3, 'back-up': 3, 'goal-side': 3, 'defend-match': 3 }) });
  assert.equal(full[0].rating, 99);
  assert.equal(full[1].rating, 45);
  const half = Card.skillRatings({ road, profile: profileWith('DEF', { 'close-down': 3, 'back-up': 3 }) }); // 6 of 12 stars
  assert.equal(half[0].rating, 72, '45 + 54 × 0.5');
  for (const s of [...fresh, ...full, ...half]) assert.ok(Number.isInteger(s.rating) && s.rating >= 0 && s.rating <= 99);
});

test('card: the Elo can lift a rating but never pull it below your Road stars', () => {
  const profile = profileWith('DEF', { 'close-down': 2 }); // road share 2/12
  const base = Card.skillRatings({ road, profile, skills: null })[0];
  const skills = (theta) => ({ theta: { global: 0, byPrinciple: { D1: theta, D2: theta } }, counts: { global: 4, byPrinciple: { D1: 2, D2: 2 } } });
  const strong = Card.skillRatings({ road, profile, skills: skills(3) })[0];
  const weak = Card.skillRatings({ road, profile, skills: skills(-3) })[0];
  assert.ok(strong.rating > base.rating, `${strong.rating} > ${base.rating}`);
  assert.equal(weak.rating, base.rating);
  assert.ok(strong.elo > 0.9 && weak.elo === 0);
  const untouched = Card.skillRatings({ road, profile, skills: { theta: { byPrinciple: { D1: 3 } }, counts: { byPrinciple: {} } } })[0];
  assert.equal(untouched.elo, null, 'a principle never practised has no Elo part');
});

test('card: the card\'s metal follows the rank', () => {
  assert.deepEqual(RANKS.map((r) => Card.cardMetal(r.id)), ['bronze', 'silver', 'gold', 'gold', 'legend']);
  assert.equal(Card.cardMetal('nope'), 'bronze');
});

test('card: the sticker album has one sticker per Road principle, tiered by its sticker card (mastery), never by node stars alone', () => {
  const rewards = { ...createRewards(), cards: { D3: { tier: 2 }, D5: { tier: 1 }, U8: { tier: 3 } } };
  const album = Card.stickerAlbum({ road, profile: profileWith('DEF', { 'close-down': 1, 'goal-side': 3 }), rewards, principles: { byId: principles } });
  const nodes = R.roadNodes(road).filter((n) => n.kind !== 'mix');
  assert.equal(album.total, new Set(nodes.flatMap((n) => n.principles)).size);
  assert.deepEqual(album.chapters.map((c) => c.title), road.chapters.map((c) => c.title));
  const by = Object.fromEntries(album.chapters.flatMap((c) => c.stickers).map((s) => [s.id, s]));
  assert.equal(by.D1.tier, 0, 'a 1-star node is not mastery: no sticker');
  assert.equal(by.T3.tier, 0, 'nor is a 3-star node without the card (rewards.js stickerReady gives cards)');
  assert.equal(by.D5.tier, 1, 'bronze from the sticker card');
  assert.equal(by.D3.tier, 2, 'silver');
  assert.equal(by.U8.tier, 3, 'gold');
  assert.equal(by.B3.tier, 0);
  assert.equal(by.B3.unlocked, true, 'Get Open opens after Close Them Down');
  assert.equal(by.U4.unlocked, false, 'Move as one is still closed');
  assert.equal(by.D4.href, '#/play/back-up', 'a mystery sticker links to its node');
  assert.equal(by.D1.name, principles.D1.kidName, 'kid names, never codes');
  assert.deepEqual(album.tiers, { 1: 1, 2: 1, 3: 1 });
  assert.equal(album.collected, 3);
  for (const s of Object.values(by)) assert.doesNotMatch(s.name, /\b[A-Z]{1,2}\d{1,2}\b/, s.name);
});

test('card: badges carry an icon, a short name and progress; nicknames come from the pick-list', () => {
  const list = Card.badgeList(createRewards());
  assert.ok(list.length > 0);
  // Coach mode's tutorial and Explore give "Kick-off" and "Explorer": Player mode cannot earn them, so they hide.
  assert.ok(!list.some((b) => b.id === 'first-steps' || b.id === 'explorer'), 'no badge Player mode cannot earn');
  assert.ok(Card.badgeList({ ...createRewards(), badges: { 'first-steps': { day: '2026-09-20' } } }).some((b) => b.id === 'first-steps' && b.earned), 'unless already earned');
  assert.equal(Card.badgeList(createRewards(), { all: true }).length, list.length + 2);
  assert.ok(!list.some((b) => /boots on|went the distance/i.test(b.name)), 'no badge for taking part');
  for (const b of list) {
    assert.ok(b.icon && b.name, b.id);
    assert.ok(b.progress >= 0 && b.progress <= 1);
    assert.equal(b.earned, false);
  }
  assert.deepEqual(Card.nicknameList(), [...NICKNAMES]);
  for (const n of Card.nicknameList()) assert.ok(n.length <= 10, n);
  assert.deepEqual(Card.CARD_TABS, ['card', 'stickers', 'badges', 'kit']);
});

// ---------------------------------------------------------------- copy hygiene (tests/copy.test.js has the full check)

function texts(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'function') {
    try { out.push(String(v('Close Them Down', 3))); } catch { /* a template with other arguments */ }
  } else if (v && typeof v === 'object') for (const x of Object.values(v)) texts(x, out);
  return out;
}

test('player modules: every visible word is in STRINGS, and none says "kid", a code, a grade or "/100"', () => {
  for (const [name, mod] of Object.entries({ road: R, shell: Shell, home: Home, kickoff: Kickoff, card: Card })) {
    assert.ok(mod.STRINGS && typeof mod.STRINGS === 'object', `${name} exports STRINGS`);
    for (const t of texts(mod.STRINGS)) {
      assert.doesNotMatch(t, /\bkids?\b/i, `${name}: "${t}"`);
      assert.doesNotMatch(t, /\b[A-Z]{1,2}\d{1,2}\b/, `${name}: "${t}"`);
      assert.doesNotMatch(t, /\/100|!!!/, `${name}: "${t}"`);
      assert.doesNotMatch(t, /\b(LB|RB|LCB|RCB|DM|LCM|RCM|LW|RW|ST|GK)\b/, `${name}: role code in "${t}"`);
    }
  }
  assert.equal(Card.STRINGS.privacy, 'Your stats stay on this device.');
});
