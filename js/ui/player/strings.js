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

export const STRINGS = Object.freeze({
  starWords: STAR_WORDS,
  roleNames: ROLE_NAMES,
  youAre: (name) => `You're the ${name}`,
  nowYou: (name) => `Now you're the ${name}`,
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
