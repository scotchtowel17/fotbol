// Player mode: the shared UI strings (docs/KID_REDESIGN.md §0, §5, §7). Words more than one Player screen uses live
// here (the star words, the role card, the buttons), so tests/copy.test.js can check them: reading age 9 (grade 4 or
// lower), the word budgets (a question 12 words or fewer, a reveal line 14 or fewer), no codes, grades, "/100",
// metres or jargon. Plain football words: forward / back / toward the middle / toward the sideline.
//
// Pure data and tiny templates. Nothing here touches the DOM (Node imports it).

/** 0-3 stars → one word (Stars, never grades: R18). Index = stars. */
export const STAR_WORDS = Object.freeze(['Not yet', 'Close', 'Great', 'Spot on']);

/**
 * Plain names of the positions (no codes: audit §5). Used on the role card ("You're the left back") and wherever a
 * position is named. The holding midfielder is "the midfielder who stays back": the #6's job in words.
 */
export const ROLE_NAMES = Object.freeze({
  GK: 'keeper',
  LCB: 'left centre-back',
  RCB: 'right centre-back',
  LB: 'left back',
  RB: 'right back',
  DM: 'midfielder who stays back',
  LCM: 'left midfielder',
  RCM: 'right midfielder',
  LW: 'left winger',
  RW: 'right winger',
  ST: 'striker',
});

/** A position's plain name ('left back'); unknown roles read as 'player'. */
export const roleName = (role) => ROLE_NAMES[role] ?? 'player';

/** The word for 0-3 stars (anything else is clamped). */
export function starWord(stars) {
  const n = Math.max(0, Math.min(3, Math.round(Number(stars)) || 0));
  return STAR_WORDS[n];
}

/**
 * The role card (§4.3 step 1): "You're the left back", or "Now you're the striker" when the rep's position is not
 * the one on your profile (a mirrored twin, a set that borrows another position's drill).
 * @param {string} role  the rep's position
 * @param {string|null} profileRole  the player's own position (profile.role)
 * @returns {{ text: string, changed: boolean }}
 */
export function roleCard(role, profileRole) {
  const changed = !!profileRole && role !== profileRole;
  return { text: changed ? STRINGS.nowYou(roleName(role)) : STRINGS.youAre(roleName(role)), changed };
}

/** The stages, smallest first (= js/engine/cast.js STAGES, tested; a copy, so the words load without the engine). */
const STAGE_ORDER = Object.freeze(['small', 'medium', 'full']);

/** How many of ours and theirs a staged cast shows (cast.js castLabel's ours and theirs; the full match 11 v 11). */
function sidesOf(stage, cast) {
  const n = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);
  return stage === 'full' ? { ours: n(cast?.ours, 11), theirs: n(cast?.theirs, 11) } : { ours: n(cast?.ours, 0), theirs: n(cast?.theirs, 0) };
}

/**
 * The words for a rep's stage on the role card (docs/PROGRESSIVE_FIELD.md §2): "Small game: 3 v 2", "Bigger game: 6 v 5"
 * or "Full match"; '' for no stage (or a cast with nobody counted).
 * @param {'small'|'medium'|'full'} stage
 * @param {{ ours: number, theirs: number }} [cast]  the staged cast (cast.js castLabel)
 */
export function stageWords(stage, cast) {
  if (stage === 'full') return STRINGS.fullMatch;
  const { ours, theirs } = sidesOf(stage, cast);
  if (!(ours > 0 && theirs > 0)) return '';
  return stage === 'small' ? STRINGS.smallGame(ours, theirs) : stage === 'medium' ? STRINGS.biggerGame(ours, theirs) : '';
}

/**
 * The role card's stage line for a rep of a set (pure), and what the set has shown so far (§2): the first rep of a
 * stage bigger than any before it in the set says "Now 6 v 5!" (once: a later rep at that stage, or a smaller one,
 * names its stage as usual); the set's first rep names its stage. `top`: the biggest stage the set has shown so far
 * (its index in small, medium, full; -1 before the first rep). A rep played again (Try again) passes `again`: its
 * stage's words, and the set's `top` is left as it was.
 * @returns {{ text: string, now: boolean, top: number }}
 */
export function stageLine(top, stage, cast, { again = false } = {}) {
  const k = STAGE_ORDER.indexOf(stage);
  const was = Number.isInteger(top) ? top : -1;
  if (k < 0) return { text: '', now: false, top: was };
  const now = !again && was >= 0 && k > was;
  const { ours, theirs } = sidesOf(stage, cast);
  const text = now && ours > 0 && theirs > 0 ? STRINGS.nowGame(ours, theirs) : stageWords(stage, cast);
  return { text, now: now && !!text, top: again ? was : Math.max(was, k) };
}

export const STRINGS = Object.freeze({
  starWords: STAR_WORDS,
  roleNames: ROLE_NAMES,
  youAre: (name) => `You're the ${name}`,
  nowYou: (name) => `Now you're the ${name}`,
  // the stage of a rep (docs/PROGRESSIVE_FIELD.md §2): a small game, a bigger game, the full match
  smallGame: (ours, theirs) => `Small game: ${ours} v ${theirs}`,
  biggerGame: (ours, theirs) => `Bigger game: ${ours} v ${theirs}`,
  fullMatch: 'Full match',
  nowGame: (ours, theirs) => `Now ${ours} v ${theirs}!`,
  // the rep
  question: 'Where do you go now?',
  lockIt: 'Lock it',
  watchAgain: 'Watch again',
  next: 'Next',
  why: 'Why?',
  tryAgain: 'Try again',
  seeWhat: 'See what happens',
  missNote: 'Hard one. Pros miss it too.',
  bestSpot: 'Best spot',
  stars: (n) => `${n} of 3 stars`,
  // leaving and ending
  stop: 'Stop and go home',
  home: 'Home',
  playAgain: 'Play again',
  fullTime: 'Full time',
  gotIt: 'Got it',
  loading: 'Getting the pitch ready',
  // heat (Match day and the glow aid): kids read these at once (audit §5 keeps them)
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
});
