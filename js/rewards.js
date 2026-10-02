// Rewards: stars, points (XP), levels, badges, sticker cards, kit unlocks and the week's training days.
// Pure: no DOM, no storage, no clock. The UI passes events in, stores the state under the
// store key 'rewards', and shows what was gained (js/ui/celebrate.js). Contract: docs/ARCHITECTURE.md §5.13;
// policy: docs/KID_REDESIGN.md §6.3 (evidence: docs/research/kid-learning.md R18, R19, R21, R27-R29, R35, R36).
//
// Policy: a rep earns 0-3 stars for how good the position was (starsForScore), and XP comes from stars and
// improvement only: nothing for taking part, finishing a session or the tutorial, time spent or opening the app
// (R28). Badges and sticker cards say what earned them, and every badge is for a skill: the five badges are all earned
// by stars, never by showing up, finishing, or accumulating other rewards (the 2026-10-01 audit cut the eleven that
// were); a sticker card means mastery: it is given only when the idea's recent plays average 2 stars or more
// (stickerReady; js/ui/rewards-store.js award() checks it against the history). Nothing is left to chance (R36);
// nothing compares you with anyone (R21); and no count can break: training days only add up, and "days played this
// week" only fills up within a week (R35).
//
// Pace [D] (tests/rewards.test.js plays these sessions through): five 1-star plays reach level 2; a strong first
// session (the 3-play kick-off set and two 5-play sets, mostly 3 stars) ends at level 3, never 4; the top levels take
// many weeks. XP: 10/20/30 per 1/2/3-star play, +10 for a drill's first 3 stars, +10 for beating your best on it by
// 10, +10 per sticker card or upgrade, and each badge's own bonus (BADGES).

import { familyOf } from './engine/roles.js';

export const REWARDS_DEFAULTS = Object.freeze({
  starAt: Object.freeze([55, 75, 90]), // [D] KID_REDESIGN §6.3: the score for 1, 2 and 3 stars
  starXp: Object.freeze([0, 10, 20, 30]), // [D] XP for a rep with 0, 1, 2 or 3 stars (R28: nothing for just taking part)
  improveMin: 10, // [D] points above your previous best on a drill that count as improving
  improveXp: 10, // [D]
  firstThreeStarXp: 10, // [D] the first 3 stars on a drill (was 20: with generated drills it came with most 3-star plays)
  goodStars: 1, // [D] a rep with at least this many stars counts toward a perfect set (and an all-rounder's family)
  perfectSessionMinReps: 3, // [D]
  liveStarXp: Object.freeze([0, 20, 40, 60]), // [D] a Live run (Match day) by its stars; it lasts about as long as 2-3 reps
  exploreXp: 10, // [D] per S spot found in Explore (a best spot: a good position)...
  exploreXpPerDay: 5, // [D] ...for at most this many finds a day (no grinding)
  cardXp: 10, // [D] per new sticker card or card upgrade (was 30): the sticker is the reward, the XP only marks it
  stickerWindow: 5, // [D] a sticker card looks at the idea's last this-many counting plays (stickerReps)...
  stickerMinReps: 3, // [D] ...needs at least this many of them (= elo.js masteryMinAttempts [D])...
  stickerStars: 2, // [D] ...averaging at least this many stars: a card means mastery, not practice (10 plays at 0.9
  //                    stars once earned one, from the Elo's partial credit alone)
  nicknameMax: 10,
});

/** The one word shown with 0, 1, 2 or 3 stars (KID_REDESIGN §0 rule 6): never a letter grade or a number. */
export const STAR_WORDS = Object.freeze(['Not yet', 'Close', 'Great', 'Spot on']);

/**
 * Total XP needed to reach level i + 1 (index 0 = level 1). Level 2 comes within the first set (about 5 reps even at
 * one star each); each later level costs more (the pace in the file comment; a strong set earns about 200 XP). Past
 * the table, each level costs LEVEL_XP_STEP more.
 */
export const LEVEL_XP = Object.freeze([0, 50, 250, 700, 1600, 2550, 3550, 4600, 5700, 6850, 8050, 9300, 10600, 11950, 13350, 14800]); // [D]
const LEVEL_XP_STEP = 1500; // [D]

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

/**
 * Suggested nicknames (KID_REDESIGN §6.3): football nicknames, plain and cool. One tap each; since 2026-10-01 (the
 * owner's call) a kid may also type their own, cleaned by cleanNickname (letters, digits, spaces, hyphens and
 * apostrophes, at most nicknameMax characters, since the nickname is the tag over YOU on the board). R27's privacy
 * note still applies as guidance: everything stays on this device, but a typed real name will show on screen.
 */
export const NICKNAMES = Object.freeze([
  'Ace', 'Anchor', 'Arrow', 'Blaze', 'Cheetah', 'Comet', 'Dynamo', 'Eagle', 'Falcon', 'Flash',
  'Hawk', 'Hurricane', 'Jet', 'Lightning', 'Lion', 'Maestro', 'Magic', 'Panther', 'Radar', 'Rocket',
  'Spark', 'Storm', 'The Cat', 'The Wall', 'Thunder', 'Tiger', 'Titan', 'Turbo', 'Wizard', 'Wolf',
]);

const txt = (standard, kid = standard) => Object.freeze({ standard, kid });

/**
 * Badges. `goal`/`counter` give progress for the trophy room; `xp` is the bonus on earning it [D]. Five badges, every
 * one earned by stars: never for taking part, finishing, showing up on days, or accumulating XP or other rewards
 * (R28; the 2026-10-01 audit cut the eleven that were). A stored state's unknown badge ids are dropped by
 * normalizeRewards. Conditions live in applyEvent(). The kid wording is Player mode's (stars, never grades) and
 * passes tests/copy.test.js.
 */
export const BADGES = Object.freeze([
  { id: 'first-s', icon: '⭐', xp: 20, name: txt('Spot on'), description: txt('Get 3 stars on a drill for the first time.', 'Get 3 stars for the first time.') },
  { id: 'hat-trick', icon: '🎩', xp: 40, name: txt('Hat-trick'), description: txt('Get 3 stars on three drills in a row.', 'Get 3 stars three times in a row.'), goal: 3, counter: 'bestSRun' },
  { id: 'perfect-session', icon: '💯', xp: 30, name: txt('Perfect session', 'Perfect set'), description: txt('Earn a star or more on every drill of a session.', 'Earn a star on every play of a set.') },
  { id: 'all-rounder', icon: '🧩', xp: 40, name: txt('All-rounder'), description: txt('Earn a star in every kind of outfield position.', 'Earn a star in every position.'), goal: 6, counter: 'families' },
  { id: 'collector', icon: '🗂️', xp: 40, name: txt('Collector'), description: txt('Collect 10 sticker cards.'), goal: 10, counter: 'cards' },
].map(Object.freeze));

export const BADGES_BY_ID = Object.freeze(Object.fromEntries(BADGES.map((b) => [b.id, b])));

/** Sticker card tiers by mastery stars (js/engine/elo.js mastery(): 1..3). */
export const CARD_TIERS = Object.freeze({ 1: 'bronze', 2: 'silver', 3: 'gold' });

const OUTFIELD_FAMILIES = Object.freeze(['CB', 'FB', 'DM', 'CM', 'W', 'ST']);

/** Coach mode's stars by grade (3 for S, 2 for A, 1 for B, none below): for events that carry a grade and no score. */
export const starsFor = (grade) => ({ S: 3, A: 2, B: 1 })[grade] ?? 0;

/**
 * Stars for a position's score out of 100 (KID_REDESIGN §6.3): 3 at 90 or more, 2 at 75, 1 at 55, else 0.
 * Player mode shows only these (and wordForStars), never the score or a grade.
 */
export function starsForScore(score, P = REWARDS_DEFAULTS) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 0;
  return P.starAt.filter((at) => s >= at).length;
}

/** The one word for a star count: 'Spot on' | 'Great' | 'Close' | 'Not yet'. */
export function wordForStars(stars) {
  const n = Math.round(Number(stars));
  return STAR_WORDS[Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 0];
}

/** Mirrored drills ('<id>-m') share one record with their original. */
export const baseScenarioId = (id) => String(id).replace(/-m$/, '');

/** Total XP at which `level` starts. */
export function levelStartXp(level) {
  if (level <= LEVEL_XP.length) return LEVEL_XP[Math.max(1, level) - 1];
  return LEVEL_XP.at(-1) + (level - LEVEL_XP.length) * LEVEL_XP_STEP;
}

/** @returns {{ level:number, xp:number, levelXp:number, nextXp:number, progress:number }} */
export function levelFor(xp) {
  const x = Math.max(0, Number(xp) || 0);
  let level = 1;
  while (x >= levelStartXp(level + 1)) level++;
  const levelXp = levelStartXp(level), nextXp = levelStartXp(level + 1);
  return { level, xp: x, levelXp, nextXp, progress: (x - levelXp) / (nextXp - levelXp) };
}

/** Kit palettes with an `unlocked` flag for this state. */
export function kitOptions(state) {
  const { level } = levelFor(state?.xp);
  return KIT_PALETTES.map((p) => ({ ...p, unlocked: level >= p.level }));
}

export const paletteById = (id) => KIT_PALETTES.find((p) => p.id === id) ?? KIT_PALETTES[0];

export function createRewards() {
  return {
    version: 2,
    xp: 0,
    best: {}, // baseScenarioId → { score, stars, low, grade? } (best score, most stars, lowest score; Coach mode's grade)
    badges: {}, // badgeId → { day }
    cards: {}, // principleId → { tier: 1|2|3 }
    counters: { reps: 0, sessions: 0, liveRuns: 0, sRun: 0, bestSRun: 0 },
    families: {}, // role family → true (a rep with a star or more in it)
    days: {}, // 'YYYY-MM-DD' → true (training days; missing one never costs anything)
    explore: { day: null, rewarded: 0 },
    kit: { palette: 'classic', number: null, nickname: '' },
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo = 0, hi = Infinity) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : lo);
const GRADES = ['S', 'A', 'B', 'C', 'D', 'F'];
/**
 * The lowest score of each grade (js/engine/score.js GRADE_BANDS, held equal by tests/rewards.test.js), for Coach mode
 * events without a score and records stored before the lowest score was kept.
 */
export const GRADE_FLOOR = Object.freeze({ S: 90, A: 80, B: 70, C: 60, D: 50, F: 0 });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const starInt = (v) => (Number.isInteger(v) && v >= 0 && v <= 3 ? v : null);
/** A number, or a numeric string (a stored or imported value); never null, '', a boolean or an object. */
const isNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));

/** Clean a nickname: letters, digits, spaces, hyphens and apostrophes; trimmed; at most nicknameMax characters. */
export function cleanNickname(raw, P = REWARDS_DEFAULTS) {
  const edge = /^[\s'-]+|[\s'-]+$/gu; // no leading or trailing spaces, hyphens or apostrophes
  return String(raw ?? '').replace(/[^\p{L}\p{N} '-]/gu, '').replace(/\s+/g, ' ').replace(edge, '').slice(0, P.nicknameMax).replace(edge, '');
}

/** A usable nickname from `raw`: the NICKNAMES entry it names (any case, so "the wall" saves as "The Wall"), else
 *  the cleaned typed text itself (owner's call, 2026-10-01: typing your own is allowed; cleanNickname strips
 *  anything but letters, digits, spaces, hyphens and apostrophes and caps the length). '' when nothing usable. */
export function pickNickname(raw) {
  const clean = cleanNickname(raw);
  const key = clean.toLowerCase();
  return (key && NICKNAMES.find((n) => n.toLowerCase() === key)) || clean;
}

/** Sanitise stored or imported rewards (anything malformed falls back to defaults). */
export function normalizeRewards(raw) {
  const s = createRewards();
  if (!isObj(raw)) return s;
  s.xp = Math.round(num(raw.xp, 0, 1e9));
  if (isObj(raw.best)) {
    for (const [id, b] of Object.entries(raw.best)) {
      if (!isObj(b)) continue;
      const grade = GRADES.includes(b.grade) ? b.grade : null;
      if (!grade && !isNum(b.score)) continue;
      const score = isNum(b.score) ? num(b.score, 0, 100) : GRADE_FLOOR[grade];
      const worst = GRADES.includes(b.worst) ? b.worst : grade;
      const low = isNum(b.low) ? num(b.low, 0, score) : worst ? Math.min(score, GRADE_FLOOR[worst]) : score;
      const stars = starInt(b.stars) ?? (grade ? starsFor(grade) : starsForScore(score));
      s.best[id] = { score, stars, low, ...(grade ? { grade } : {}) };
    }
  }
  if (isObj(raw.badges)) {
    for (const id of Object.keys(raw.badges)) {
      if (BADGES_BY_ID[id]) s.badges[id] = { day: typeof raw.badges[id]?.day === 'string' ? raw.badges[id].day : null };
    }
  }
  if (isObj(raw.cards)) {
    for (const [id, c] of Object.entries(raw.cards)) {
      const tier = Math.round(num(c?.tier, 0, 3));
      if (tier >= 1) s.cards[id] = { tier };
    }
  }
  if (isObj(raw.counters)) for (const k of Object.keys(s.counters)) s.counters[k] = Math.round(num(raw.counters[k], 0, 1e7));
  if (isObj(raw.families)) for (const f of OUTFIELD_FAMILIES) if (raw.families[f]) s.families[f] = true;
  if (isObj(raw.days)) for (const d of Object.keys(raw.days)) if (DAY.test(d) && raw.days[d]) s.days[d] = true;
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
    nickname: pickNickname(kit.nickname),
  };
}

/** Change the kit. Locked palettes, bad numbers and nicknames that are not on the NICKNAMES list are ignored. Immutable. */
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
 * The stars of an idea's last counting plays (at most stickerWindow, oldest first): Player-mode plays that list the
 * idea (a "Find your spot" rep, via 'play', or a "Who's open?" first try, mode 'pass') with no help (no worked example
 * or glow aid). Coach-mode drills do not count: Coach mode shares the store but never earns (rewards-store.js award).
 * A play's stars are the ones it showed (`stars`), else its score's.
 * @param {object[]} history  the rep history, oldest first (js/ui/session.js loadHistory)
 * @returns {number[]}
 */
export function stickerReps(history, principleId, P = REWARDS_DEFAULTS) {
  const id = String(principleId ?? '');
  const out = [];
  if (!id || !Array.isArray(history)) return out;
  for (let i = history.length - 1; i >= 0 && out.length < P.stickerWindow; i--) {
    const h = history[i];
    if (!isObj(h) || h.aid || !(h.mode === 'pass' || (h.mode === 'drill' && h.via === 'play'))) continue;
    if (!Array.isArray(h.principles) || !h.principles.includes(id)) continue;
    const stars = starInt(h.stars) ?? (isNum(h.score) ? starsForScore(h.score, P) : null);
    if (stars !== null) out.push(stars);
  }
  return out.reverse();
}

/**
 * Whether an idea's sticker card may be given or upgraded (R25: mastery, not practice; R28): at least stickerMinReps
 * recent counting plays (stickerReps) averaging stickerStars or more.
 */
export function stickerReady(history, principleId, P = REWARDS_DEFAULTS) {
  const reps = stickerReps(history, principleId, P);
  return reps.length >= P.stickerMinReps && reps.reduce((a, b) => a + b, 0) / reps.length >= P.stickerStars - 1e-9;
}

// ---------------------------------------------------------------- days played this week (R35)

const MS_DAY = 86400000;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

/** The Monday that starts the week of `day` ('YYYY-MM-DD'), as 'YYYY-MM-DD'; null for anything that is not a real day. */
export function weekStart(day) {
  const m = DAY.test(String(day ?? '')) ? String(day).split('-').map(Number) : null;
  if (!m) return null;
  const t = Date.UTC(m[0], m[1] - 1, m[2]);
  if (isoDay(t) !== day) return null; // 2026-02-31 and the like
  return isoDay(t - ((new Date(t).getUTCDay() + 6) % 7) * MS_DAY);
}

/**
 * Days played this week (R35): the distinct training days of the Monday-to-Sunday week that `today` ('YYYY-MM-DD',
 * the player's local day) falls in, 0-7. It only ever counts up within a week and starts again on Monday: there is
 * no streak to break and a missed day costs nothing. Every event that counts as training marks its day.
 */
export function weekDaysPlayed(state, today) {
  const week = weekStart(today);
  const days = isObj(state?.days) ? state.days : null;
  if (!week || !days) return 0;
  return Object.keys(days).filter((d) => days[d] && weekStart(d) === week).length;
}

// ---------------------------------------------------------------- events

/**
 * The stars a rep earned: the caller's own `stars` (0-3) when it shows them, else from its score (starsForScore),
 * else from its grade (a Coach mode event without a score).
 */
export function repStars(event, P = REWARDS_DEFAULTS) {
  const own = starInt(event?.stars);
  if (own !== null) return own;
  if (isNum(event?.score)) return starsForScore(event.score, P);
  return starsFor(event?.grade);
}

/** Stars per rep of a session event: its `stars`, else its `scores`, else its `grades`. */
function sessionStars(event, P) {
  if (Array.isArray(event?.stars)) return event.stars.map((n) => starInt(n) ?? 0);
  if (Array.isArray(event?.scores)) return event.scores.map((n) => starsForScore(n, P));
  if (Array.isArray(event?.grades)) return event.grades.map(starsFor);
  return [];
}

/**
 * Apply one event and report what it earned. Immutable: returns a new state.
 * @param {object} state  rewards state (normalised on the way in)
 * @param {{ type: 'rep', scenarioId: string, role: string, score?: number, grade?: string, stars?: number }
 *   | { type: 'session', stars?: number[], scores?: number[], grades?: string[] }
 *   | { type: 'live', average: number }
 *   | { type: 'explore-s' }
 *   | { type: 'tutorial-complete' }
 *   | { type: 'mastery', principleId: string, stars: number }} event
 *   A rep's stars come from its score (repStars); Player mode sends the score (and may send the stars it showed),
 *   Coach mode also sends its grade. XP: starXp by stars, +improveXp for beating your best on that drill by
 *   improveMin points, +firstThreeStarXp for its first 3 stars; a Live run: liveStarXp by its average's stars; a
 *   sticker card: cardXp; a badge: its xp. A session, the tutorial and taking part earn none (R28).
 * @param {{ day?: string, params?: object }} [ctx]  day = the learner's local date 'YYYY-MM-DD' (the UI owns the clock)
 * @returns {{ state: object, gained: { xp: number, stars: number|null, newBest: boolean, improved: boolean,
 *   badges: string[], cards: { id: string, tier: number, upgrade: boolean }[],
 *   levelUp: null | { from: number, to: number, unlocks: string[] } } }}
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
  const trainedToday = () => { if (day && DAY.test(day)) s.days[day] = true; };

  switch (event?.type) {
    case 'rep': {
      const grade = GRADES.includes(event.grade) ? event.grade : null;
      const score = isNum(event.score) ? num(event.score, 0, 100) : grade ? GRADE_FLOOR[grade] : 0;
      const stars = repStars(event, P);
      const id = baseScenarioId(event.scenarioId);
      const prev = s.best[id];
      gained.stars = stars;
      gained.xp += P.starXp[stars] ?? 0;
      if (prev && score - prev.score >= P.improveMin) { gained.improved = true; gained.xp += P.improveXp; }
      if (stars === 3 && (!prev || prev.stars < 3)) gained.xp += P.firstThreeStarXp;
      const better = !prev || score > prev.score;
      if (better) gained.newBest = true;
      const bestGrade = better ? grade : prev.grade; // Coach mode's grade of the best attempt, when it had one
      s.best[id] = {
        score: prev ? Math.max(prev.score, score) : score,
        stars: prev ? Math.max(prev.stars, stars) : stars,
        low: prev ? Math.min(prev.low, score) : score,
        ...(bestGrade ? { grade: bestGrade } : {}),
      };
      c.reps++;
      c.sRun = stars === 3 ? c.sRun + 1 : 0;
      c.bestSRun = Math.max(c.bestSRun, c.sRun);
      const fam = familyOf(event.role);
      if (OUTFIELD_FAMILIES.includes(fam) && stars >= P.goodStars) s.families[fam] = true;
      trainedToday();
      if (stars === 3) earn('first-s');
      if (c.sRun >= 3) earn('hat-trick');
      if (Object.keys(s.families).length >= OUTFIELD_FAMILIES.length) earn('all-rounder');
      break;
    }
    case 'session': {
      const stars = sessionStars(event, P);
      if (!stars.length) break;
      c.sessions++;
      if (stars.length >= P.perfectSessionMinReps && stars.every((n) => n >= P.goodStars)) earn('perfect-session');
      trainedToday();
      break;
    }
    case 'live': {
      const stars = starsForScore(num(event.average, 0, 100), P);
      c.liveRuns++;
      gained.xp += P.liveStarXp[stars] ?? 0;
      trainedToday();
      break;
    }
    case 'explore-s': {
      if (s.explore.day !== (day ?? null)) s.explore = { day: day ?? null, rewarded: 0 };
      if (s.explore.rewarded < P.exploreXpPerDay) { s.explore.rewarded++; gained.xp += P.exploreXp; }
      trainedToday();
      break;
    }
    case 'tutorial-complete': {
      trainedToday();
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
      }
      break;
    }
    default:
      return { state: s, gained };
  }

  s.xp += gained.xp;
  const after = levelFor(s.xp);
  if (after.level > before.level) {
    gained.levelUp = {
      from: before.level,
      to: after.level,
      unlocks: KIT_PALETTES.filter((p) => p.level > before.level && p.level <= after.level).map((p) => p.id),
    };
  }
  return { state: s, gained };
}
