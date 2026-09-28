// Rewards: points (XP), levels and ranks, stars per drill, badges, sticker cards and kit unlocks.
// Pure: no DOM, no storage, no clock. The UI passes events in, stores the state under the
// store key 'rewards', and shows what was gained (js/ui/celebrate.js). Contract: docs/ARCHITECTURE.md §5.13.
//
// Design (RESEARCH §7): rewards follow effort, improvement and mastery, not raw scores alone.
// Every attempt earns something; improving on a drill earns extra. No leaderboards, no random
// prizes, and no streak that punishes a missed day (training days only ever add up).

import { familyOf } from './engine/roles.js';

export const REWARDS_DEFAULTS = Object.freeze({
  xpByGrade: Object.freeze({ S: 100, A: 70, B: 50, C: 30, D: 20, F: 10 }), // [D] every attempt earns something
  improveMin: 10, // [D] points above your previous best on a drill that count as improving
  improveXp: 25, // [D]
  firstThreeStarXp: 50, // [D] first S on a drill
  sessionXp: 50, // [D] finishing a drill session
  perfectSessionXp: 100, // [D] every rep of a session at B or better
  perfectSessionMinReps: 3, // [D]
  liveXpMax: 150, // [D] a Live run earns liveXpMax × average / 100
  exploreXp: 10, // [D] per S spot found in Explore...
  exploreXpPerDay: 5, // [D] ...for at most this many finds a day (no grinding)
  tutorialXp: 150, // [D]
  cardXp: 30, // [D] per new sticker card or card upgrade
  goodGrades: Object.freeze(['S', 'A', 'B']),
  comebackFrom: Object.freeze(['D', 'F']),
  comebackTo: Object.freeze(['S', 'A']),
  nicknameMax: 10,
});

/** Total XP needed to reach level i + 1 (index 0 = level 1). Past the table, each level costs levelXpStep more. */
export const LEVEL_XP = Object.freeze([0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000, 5000, 6200, 7600, 9200, 11000]); // [D]
const LEVEL_XP_STEP = 2000; // [D]

export const RANKS = Object.freeze([
  Object.freeze({ from: 1, id: 'rookie', name: 'Rookie' }),
  Object.freeze({ from: 3, id: 'academy', name: 'Academy' }),
  Object.freeze({ from: 5, id: 'first-team', name: 'First Team' }),
  Object.freeze({ from: 8, id: 'captain', name: 'Captain' }),
  Object.freeze({ from: 11, id: 'legend', name: 'Legend' }),
]);

/**
 * Kit colours for our team's shirts. Every shirt is light so it stays easy to tell from the
 * opponents' dark kit (css --kit-them) by lightness alone, which keeps the board colour-blind safe;
 * ink is the shirt-number colour. tests/rewards.test.js checks both contrasts.
 */
export const KIT_PALETTES = Object.freeze([
  { id: 'classic', name: 'Classic cream', shirt: '#fff3c9', edge: '#6b5600', ink: '#2a2200', level: 1 },
  { id: 'sky', name: 'Sky blue', shirt: '#cfe8ff', edge: '#1d4f91', ink: '#0b2545', level: 2 },
  { id: 'lime', name: 'Lime', shirt: '#dcf5a8', edge: '#3f6212', ink: '#1a2e05', level: 3 },
  { id: 'sunset', name: 'Sunset orange', shirt: '#ffd9b3', edge: '#9a3412', ink: '#431407', level: 4 },
  { id: 'bubblegum', name: 'Bubblegum', shirt: '#ffd1ea', edge: '#9d174d', ink: '#4a0424', level: 5 },
  { id: 'mint', name: 'Mint', shirt: '#c8f5dc', edge: '#166534', ink: '#052e16', level: 6 },
  { id: 'lemon', name: 'Lemon', shirt: '#fff59e', edge: '#854d0e', ink: '#3b2503', level: 7 },
  { id: 'lilac', name: 'Lilac', shirt: '#e6dcff', edge: '#5b21b6', ink: '#2e1065', level: 8 },
  { id: 'silver', name: 'Silver', shirt: '#eef1f5', edge: '#475569', ink: '#0f172a', level: 9 },
  { id: 'gold', name: 'Gold', shirt: '#ffe38a', edge: '#8a5a00', ink: '#3d2600', level: 10 },
  { id: 'legend', name: 'Legend white', shirt: '#ffffff', edge: '#111827', ink: '#111827', level: 11 },
].map(Object.freeze));

const txt = (standard, kid = standard) => Object.freeze({ standard, kid });

/**
 * Badges. `goal`/`counter` give progress for the trophy room; `xp` is the bonus on earning it.
 * Conditions live in applyEvent().
 */
export const BADGES = Object.freeze([
  { id: 'first-steps', icon: '🎓', xp: 0, name: txt('Graduate'), description: txt('Finish the pitch tutorial.', 'Finish the tutorial.') },
  { id: 'first-rep', icon: '👟', xp: 20, name: txt('Boots on'), description: txt('Finish your first drill.') },
  { id: 'first-s', icon: '⭐', xp: 40, name: txt('Spot on'), description: txt('Get your first S grade.', 'Get your first S.') },
  { id: 'hat-trick', icon: '🎩', xp: 80, name: txt('Hat-trick'), description: txt('Get three S grades in a row.', 'Three S grades in a row.'), goal: 3, counter: 'bestSRun' },
  { id: 'on-a-roll', icon: '🔥', xp: 60, name: txt('On a roll'), description: txt('Five drills in a row at B or better.'), goal: 5, counter: 'bestGoodRun' },
  { id: 'perfect-session', icon: '💯', xp: 60, name: txt('Perfect session'), description: txt('Finish a whole session at B or better.', 'A whole session at B or better.') },
  { id: 'comeback', icon: '💪', xp: 60, name: txt('Comeback'), description: txt('Turn a D or F into an A or S on the same drill.', 'Fix a drill you got wrong: D or F to A or S.') },
  { id: 'all-rounder', icon: '🧩', xp: 80, name: txt('All-rounder'), description: txt('Play every kind of outfield position.', 'Play every kind of position.'), goal: 6, counter: 'families' },
  { id: 'live-finisher', icon: '⏱️', xp: 30, name: txt('Went the distance'), description: txt('Finish a Live run.') },
  { id: 'live-star', icon: '🌟', xp: 80, name: txt('Live wire'), description: txt('Average 80 or more in a Live run.', 'Score 80+ in Live.') },
  { id: 'explorer', icon: '🧭', xp: 40, name: txt('Explorer'), description: txt('Find 5 S spots in Explore.'), goal: 5, counter: 'exploreS' },
  { id: 'collector', icon: '🗂️', xp: 80, name: txt('Collector'), description: txt('Collect 10 sticker cards.'), goal: 10, counter: 'cards' },
  { id: 'gold-card', icon: '🥇', xp: 60, name: txt('Gold standard'), description: txt('Turn a sticker card gold.', 'Get a gold sticker.') },
  { id: 'regular', icon: '📅', xp: 60, name: txt('Regular'), description: txt('Train on 5 different days.'), goal: 5, counter: 'days' },
  { id: 'captain', icon: '🧢', xp: 0, name: txt('Captain'), description: txt('Reach the Captain rank.', 'Become Captain.') },
  { id: 'legend', icon: '🏆', xp: 0, name: txt('Legend'), description: txt('Reach the Legend rank.', 'Become a Legend.') },
].map(Object.freeze));

export const BADGES_BY_ID = Object.freeze(Object.fromEntries(BADGES.map((b) => [b.id, b])));

/** Sticker card tiers by mastery stars (js/engine/elo.js mastery(): 1..3). */
export const CARD_TIERS = Object.freeze({ 1: 'bronze', 2: 'silver', 3: 'gold' });

const OUTFIELD_FAMILIES = Object.freeze(['CB', 'FB', 'DM', 'CM', 'W', 'ST']);

/** 3 stars for S, 2 for A, 1 for B, none below. */
export const starsFor = (grade) => ({ S: 3, A: 2, B: 1 })[grade] ?? 0;

/** Mirrored drills ('<id>-m') share one record with their original. */
export const baseScenarioId = (id) => String(id).replace(/-m$/, '');

/** Total XP at which `level` starts. */
export function levelStartXp(level) {
  if (level <= LEVEL_XP.length) return LEVEL_XP[Math.max(1, level) - 1];
  return LEVEL_XP.at(-1) + (level - LEVEL_XP.length) * LEVEL_XP_STEP;
}

export const rankFor = (level) => [...RANKS].reverse().find((r) => level >= r.from) ?? RANKS[0];

/** @returns {{ level:number, rank:object, xp:number, levelXp:number, nextXp:number, progress:number }} */
export function levelFor(xp) {
  const x = Math.max(0, Number(xp) || 0);
  let level = 1;
  while (x >= levelStartXp(level + 1)) level++;
  const levelXp = levelStartXp(level), nextXp = levelStartXp(level + 1);
  return { level, rank: rankFor(level), xp: x, levelXp, nextXp, progress: (x - levelXp) / (nextXp - levelXp) };
}

/** Kit palettes with an `unlocked` flag for this state. */
export function kitOptions(state) {
  const { level } = levelFor(state?.xp);
  return KIT_PALETTES.map((p) => ({ ...p, unlocked: level >= p.level }));
}

export const paletteById = (id) => KIT_PALETTES.find((p) => p.id === id) ?? KIT_PALETTES[0];

export function createRewards() {
  return {
    version: 1,
    xp: 0,
    best: {}, // baseScenarioId → { score, grade, stars, worst }
    badges: {}, // badgeId → { day }
    cards: {}, // principleId → { tier: 1|2|3 }
    counters: { reps: 0, sessions: 0, liveRuns: 0, exploreS: 0, sRun: 0, bestSRun: 0, goodRun: 0, bestGoodRun: 0 },
    families: {}, // role family → true
    days: {}, // 'YYYY-MM-DD' → true (training days; missing one never costs anything)
    explore: { day: null, rewarded: 0 },
    kit: { palette: 'classic', number: null, nickname: '' },
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo = 0, hi = Infinity) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : lo);
const GRADES = ['S', 'A', 'B', 'C', 'D', 'F'];

/** Clean a nickname: letters, digits, spaces, hyphens and apostrophes; trimmed; at most nicknameMax characters. */
export function cleanNickname(raw, P = REWARDS_DEFAULTS) {
  const edge = /^[\s'-]+|[\s'-]+$/gu; // no leading or trailing spaces, hyphens or apostrophes
  return String(raw ?? '').replace(/[^\p{L}\p{N} '-]/gu, '').replace(/\s+/g, ' ').replace(edge, '').slice(0, P.nicknameMax).replace(edge, '');
}

/** Sanitise stored or imported rewards (anything malformed falls back to defaults). */
export function normalizeRewards(raw) {
  const s = createRewards();
  if (!isObj(raw)) return s;
  s.xp = Math.round(num(raw.xp, 0, 1e9));
  if (isObj(raw.best)) {
    for (const [id, b] of Object.entries(raw.best)) {
      if (!isObj(b) || !GRADES.includes(b.grade)) continue;
      s.best[id] = { score: num(b.score, 0, 100), grade: b.grade, stars: starsFor(b.grade), worst: GRADES.includes(b.worst) ? b.worst : b.grade };
    }
  }
  if (isObj(raw.badges)) for (const id of Object.keys(raw.badges)) if (BADGES_BY_ID[id]) s.badges[id] = { day: typeof raw.badges[id]?.day === 'string' ? raw.badges[id].day : null };
  if (isObj(raw.cards)) {
    for (const [id, c] of Object.entries(raw.cards)) {
      const tier = Math.round(num(c?.tier, 0, 3));
      if (tier >= 1) s.cards[id] = { tier };
    }
  }
  if (isObj(raw.counters)) for (const k of Object.keys(s.counters)) s.counters[k] = Math.round(num(raw.counters[k], 0, 1e7));
  if (isObj(raw.families)) for (const f of OUTFIELD_FAMILIES) if (raw.families[f]) s.families[f] = true;
  if (isObj(raw.days)) for (const d of Object.keys(raw.days)) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) s.days[d] = true;
  if (isObj(raw.explore) && typeof raw.explore.day === 'string') s.explore = { day: raw.explore.day, rewarded: Math.round(num(raw.explore.rewarded, 0, 1000)) };
  if (isObj(raw.kit)) s.kit = sanitizeKit(s, raw.kit);
  return s;
}

function sanitizeKit(state, kit) {
  const unlocked = new Set(kitOptions(state).filter((p) => p.unlocked).map((p) => p.id));
  const n = Number(kit.number);
  return {
    palette: unlocked.has(kit.palette) ? kit.palette : 'classic',
    number: Number.isInteger(n) && n >= 1 && n <= 99 ? n : null,
    nickname: cleanNickname(kit.nickname),
  };
}

/** Change the kit. Locked palettes, bad numbers and unsafe nickname characters are ignored. Immutable. */
export function setKit(state, patch) {
  const s = normalizeRewards(state);
  s.kit = sanitizeKit(s, { ...s.kit, ...patch });
  return s;
}

/** Progress toward every badge, for the trophy room. */
export function badgeProgress(state) {
  const s = normalizeRewards(state);
  const counts = {
    ...s.counters,
    families: Object.keys(s.families).length,
    days: Object.keys(s.days).length,
    cards: Object.keys(s.cards).length,
  };
  return BADGES.map((b) => {
    const earned = !!s.badges[b.id];
    const current = b.counter ? Math.min(b.goal, counts[b.counter] ?? 0) : earned ? 1 : 0;
    const goal = b.goal ?? 1;
    return { ...b, earned, current: earned ? goal : current, goal, progress: earned ? 1 : current / goal };
  });
}

/** Sticker tier (0 = not collected) of a principle's card. */
export const cardTier = (state, principleId) => state?.cards?.[principleId]?.tier ?? 0;

/**
 * Apply one event and report what it earned. Immutable: returns a new state.
 * @param {object} state  rewards state (normalised on the way in)
 * @param {{ type: 'rep', scenarioId: string, role: string, grade: string, score: number }
 *   | { type: 'session', grades: string[] }
 *   | { type: 'live', average: number }
 *   | { type: 'explore-s' }
 *   | { type: 'tutorial-complete' }
 *   | { type: 'mastery', principleId: string, stars: number }} event
 * @param {{ day?: string, params?: object }} [ctx]  day = the learner's local date 'YYYY-MM-DD' (the UI owns the clock)
 * @returns {{ state: object, gained: { xp: number, stars: number|null, newBest: boolean, improved: boolean,
 *   badges: string[], cards: { id: string, tier: number, upgrade: boolean }[],
 *   levelUp: null | { from: number, to: number, rank: object, rankUp: boolean, unlocks: string[] } } }}
 */
export function applyEvent(state, event, { day, params } = {}) {
  const P = { ...REWARDS_DEFAULTS, ...params };
  const s = normalizeRewards(state);
  const c = s.counters;
  const before = levelFor(s.xp);
  const gained = { xp: 0, stars: null, newBest: false, improved: false, badges: [], cards: [], levelUp: null };
  const earn = (id) => {
    if (s.badges[id] || !BADGES_BY_ID[id]) return;
    s.badges[id] = { day: day ?? null };
    gained.badges.push(id);
    gained.xp += BADGES_BY_ID[id].xp;
  };
  const trainedToday = () => { if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) s.days[day] = true; };

  switch (event?.type) {
    case 'rep': {
      const grade = GRADES.includes(event.grade) ? event.grade : 'F';
      const score = num(event.score, 0, 100);
      const id = baseScenarioId(event.scenarioId);
      const prev = s.best[id];
      const stars = starsFor(grade);
      gained.stars = stars;
      gained.xp += P.xpByGrade[grade];
      if (prev && score - prev.score >= P.improveMin) { gained.improved = true; gained.xp += P.improveXp; }
      if (stars === 3 && (!prev || prev.stars < 3)) gained.xp += P.firstThreeStarXp;
      const worse = (a, b) => (GRADES.indexOf(a) >= GRADES.indexOf(b) ? a : b);
      if (!prev || score > prev.score) gained.newBest = true;
      s.best[id] = prev
        ? { score: Math.max(prev.score, score), grade: score > prev.score ? grade : prev.grade, stars: Math.max(prev.stars, stars), worst: worse(prev.worst, grade) }
        : { score, grade, stars, worst: grade };
      if (prev && P.comebackFrom.includes(prev.worst) && P.comebackTo.includes(grade)) earn('comeback');
      c.reps++;
      c.sRun = grade === 'S' ? c.sRun + 1 : 0;
      c.bestSRun = Math.max(c.bestSRun, c.sRun);
      c.goodRun = P.goodGrades.includes(grade) ? c.goodRun + 1 : 0;
      c.bestGoodRun = Math.max(c.bestGoodRun, c.goodRun);
      const fam = familyOf(event.role);
      if (OUTFIELD_FAMILIES.includes(fam)) s.families[fam] = true;
      trainedToday();
      earn('first-rep');
      if (grade === 'S') earn('first-s');
      if (c.sRun >= 3) earn('hat-trick');
      if (c.goodRun >= 5) earn('on-a-roll');
      if (Object.keys(s.families).length >= OUTFIELD_FAMILIES.length) earn('all-rounder');
      break;
    }
    case 'session': {
      const grades = Array.isArray(event.grades) ? event.grades : [];
      if (!grades.length) break;
      c.sessions++;
      gained.xp += P.sessionXp;
      if (grades.length >= P.perfectSessionMinReps && grades.every((g) => P.goodGrades.includes(g))) {
        gained.xp += P.perfectSessionXp;
        earn('perfect-session');
      }
      trainedToday();
      break;
    }
    case 'live': {
      const avg = num(event.average, 0, 100);
      c.liveRuns++;
      gained.xp += Math.round((P.liveXpMax * avg) / 100);
      trainedToday();
      earn('live-finisher');
      if (avg >= 80) earn('live-star');
      break;
    }
    case 'explore-s': {
      c.exploreS++;
      if (s.explore.day !== (day ?? null)) s.explore = { day: day ?? null, rewarded: 0 };
      if (s.explore.rewarded < P.exploreXpPerDay) { s.explore.rewarded++; gained.xp += P.exploreXp; }
      trainedToday();
      if (c.exploreS >= 5) earn('explorer');
      break;
    }
    case 'tutorial-complete': {
      if (!s.badges['first-steps']) gained.xp += P.tutorialXp;
      trainedToday();
      earn('first-steps');
      break;
    }
    case 'mastery': {
      const tier = Math.round(num(event.stars, 0, 3));
      const id = String(event.principleId ?? '');
      const had = cardTier(s, id);
      if (id && tier > had) {
        s.cards[id] = { tier };
        gained.cards.push({ id, tier, upgrade: had > 0 });
        gained.xp += P.cardXp;
        if (Object.keys(s.cards).length >= 10) earn('collector');
        if (tier === 3) earn('gold-card');
      }
      break;
    }
    default:
      return { state: s, gained };
  }

  if (Object.keys(s.days).length >= 5) earn('regular');
  s.xp += gained.xp;
  const after = levelFor(s.xp);
  if (after.level > before.level) {
    gained.levelUp = {
      from: before.level,
      to: after.level,
      rank: after.rank,
      rankUp: after.rank.id !== before.rank.id,
      unlocks: KIT_PALETTES.filter((p) => p.level > before.level && p.level <= after.level).map((p) => p.id),
    };
    if (after.level >= RANKS.find((r) => r.id === 'captain').from) earn('captain');
    if (after.level >= RANKS.find((r) => r.id === 'legend').from) earn('legend');
  }
  return { state: s, gained };
}
