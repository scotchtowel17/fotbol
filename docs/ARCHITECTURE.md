# fotbol architecture and module contracts

This is the **source of truth for module boundaries**. If you change a signature or data shape listed here, update this file in the same change. The rationale behind every number and rule is in [RESEARCH.md](RESEARCH.md) (sections 5, 8 and 9). Status and known issues are in [ROADMAP.md](ROADMAP.md).

## 1. Principles

- **Zero build.** Plain HTML, CSS and ES modules; open via any static server (`npm run serve` → `python3 -m http.server 8080`). No framework, no bundler, no runtime network calls except same-origin files.
- **Pure engine.** Everything under `js/engine/` is pure JavaScript with **no DOM access and no `fetch`**. Data is passed in as arguments. This lets the same code run in the browser and under `node --test`.
- **One coordinate frame** (see `js/engine/pitch.js`): metres, 105 x 68; x = 0 is **our** goal line and "us" (the learner's team) always attacks +x; y = 0 is the top touchline = **our left**. Goal-side = smaller x. Inside = closer to y = 34. Rendering may rotate the pitch; the engine never does.
- **Explainable scoring.** Every point the learner gains or loses traces back to a zone distance or a named rule, and every rule maps to a principle ID in `data/principles.json` (IDs such as `D3`, `U4`, `B1` from RESEARCH.md section 8). The zone itself is explained as principle F2 (shift with the ball as a unit).
- **Tunable defaults are labelled.** Any number that is an engineering guess lives in a `PARAMS`/`DEFAULTS` object with a comment `// [D]` (default), `[S]` (sourced) or `[M]` (measured), never inline magic numbers. Where two modules must agree on a number (layer A and a rule), a test holds them equal.
- **Layer A and layer B must agree.** The ghost (best spot) scores S (≥ 90) only when the role's base spot (layer A) already satisfies the principle rules (layer B) to within the zone tolerance. `tests/integration.test.js` holds the whole loop to RESEARCH 9.5 on canonical situations; `scripts/sanity.mjs` prints the engine's answers for coach review.

## 2. File layout

```
index.html                 app shell (single page, hash router): the Coach header and Player mode's top bar (#player-bar)
tests.html                 runs tests/*.test.js in the browser (list: tests/manifest.js)
css/app.css                design tokens (light/dark), layout, components
css/player.css             Player mode's frame: top bar, kick-off, home and the Road, the card (shell)
css/play.css, css/pass.css Player mode's "Find your spot" (with its reveal, Full time, Match day) and "Who's open?" screens
assets/                    favicon
js/main.js                 boot: load data and the Road, the two modes (§5.9), route #/ (Player home or #/kickoff) | #/kickoff |
                           #/play | #/pass | #/matchday | #/card (js/ui/player/) and #/coach | #/learn | #/explore | #/drill |
                           #/live | #/progress | #/trophies | #/author | #/credits | #/dev (js/ui/modes/)
js/data.js                 browser-side loaders (fetch JSON, one retry after a dropped connection) → plain objects passed to the engine
js/store.js                localStorage wrapper (try/catch), progress export/import
js/rewards.js              PURE game layer: XP, levels and ranks, stars, badges, sticker cards, kit unlocks (§5.13)
js/engine/                 PURE (no DOM, no fetch)
  geometry.js              vectors, projection, barycentric, band()
  pitch.js                 IFAB constants, lanes, thirds, zone 14, frame transforms
  roles.js                 role IDs, families, labels, mirroring L<->R
  formation.js             formation table → Delaunay interpolation → team targets (+ phase shape)
  scene.js                 autoFrame(): place all 22 players for a ball position/possession; learnerBase()
  timeline.js              frameAt(scenario, t): ball-scripted scenario playback; learnerBaseAt()
  sequence.js              Live mode: seeded 45-60 s sequences (generateSequence) and an incremental playback cursor (§5.11)
  passing.js               the on-ball decision: rate every pass (rateOptions), grade a choice, say why (§5.14)
  passdrill.js             "Who's open?" pass drills: generate, check, mirror; pass moments in Live sequences (§5.14)
  spotdrill.js             generated "Find your spot" drills in the scenario format, kept by the drill gates (§5.15)
  scenario.js              validate / mirror (left↔right) / normalise scenarios
  context.js               buildContext(frame, learner): duties, lines, pressure, block height, marks
  rules/<id>.js            one principle rule per file; rules/index.js exports RULES
  rules/_util.js           shared rule helpers (not a rule: tools that glob rules/*.js skip '_' files)
  score.js                 zone score, rule aggregation, rules gate, criticals, grades
  ghost.js                 grid search for the ideal spot + heatmap field
  explain.js               feedback sentences (standard/kid), fix-vector phrasing
  analyse.js               the whole loop for one static scene: analyseScene() + judgeSpot()
  elo.js                   per-principle / per-role Elo with partial credit
js/ui/
  board.js                 SVG pitch, player tokens, drag (pointer + keyboard), overlays
  heatmap.js               field → image for the board
  reveal.js                the shared feedback panel: live hot/cold readout, beat 1 (cue), beat 2 (full reveal) (§5.12)
  session.js               pure session helpers: persistence, drill selection, streaks, summaries (§5.12)
  components.js            small DOM helpers (el(), buttons, toasts, stageLayout)
  rewards-store.js         rewards in the app: store key 'rewards', award(), the kit on the page (§5.13)
  celebrate.js             celebrations and every reward visual: stars + XP row, level-up screen, player card, level bar (§5.13)
  sound.js                 tiny WebAudio synth: whistle, star, good, cheer, levelup, groan, lift (no audio files) (§5.13)
  modes/                   Coach mode: one file per route (§5.9): home learn explore drill live progress trophies author credits dev
  player/                  Player mode (§5.16, docs/KID_REDESIGN.md): shell (top bar, settings sheet, icons), home (the Road),
                           kickoff (first open, "What do you play?", "Make it yours"), card (card, stickers, badges, kit),
                           road (the Road, the profile, set building), play ("Find your spot" sets), pass ("Who's open?"),
                           reveal (the Player reveal), fulltime (the end of a set), matchday (simplified Live), strings (shared words)
data/formations/helios-433.json   ball→11 positions table (converted from HELIOS, MIT; 48 documented edits)
data/principles.json              principle catalogue (IDs, names, text, links; kidName and summary.kid are Player mode's words)
data/road.json                    Player mode's Road: chapters of nodes (spot, pass, mix) over the principles (§5.16)
data/curriculum.json              modules → principles → scenario IDs
data/tutorial.json                M0 guided tour
data/resources.json               reading list
data/scenarios/index.json         the scenario list the app loads; GENERATED by scripts/build-index.mjs (never edit by hand)
data/scenarios/*.json             hand-authored, ball-scripted scenarios: m<module>-<nn>-<principle>-<role>.json (_example.json is the template, not indexed)
vendor/delaunator/                ISC, ESM source + LICENSE (plus robust-predicates, Unlicense)
scripts/convert-helios.mjs        one-off data conversion (Node)
scripts/check-scenarios.mjs       npm run check: validates every scenario, prints the engine's answer and fails the drill-quality gates (checkScenario() is pure: tests and the browser import it)
scripts/build-index.mjs           npm run index: writes data/scenarios/index.json; --check (part of npm run check) fails when it is stale
scripts/sanity.mjs                coach-facing report on the canonical situations → docs/sanity-output.txt
scripts/shape.mjs                 print both teams' layer-A targets for a ball position
scripts/lib/ascii.mjs             ASCII pitch for terminals
tests/harness.js                  test() / assert that work in Node and the browser; timed() for the speed tests (median of runs after a
                                  warm-up, bounds scaled by FOTBOL_PERF_SLACK)
tests/fixtures.js                 hand-placed 22-player frames for unit tests
tests/situations.js               canonical match situations (integration test, sanity report, dev playground)
tests/road-sets.js                the Road sweep (every node x every position group, real generators), run by road-sets-*.test.js in Node
tests/manifest.js                 test files tests.html runs (tests/manifest.test.js keeps it complete)
tests/*.test.js                   unit tests; integration.test.js is end to end on real data
docs/sanity-output.txt            the last sanity report (regenerate after engine changes: npm run sanity)
docs/screenshots/                 images for the README
```

## 3. Roles

`js/engine/roles.js` owns role metadata.

```js
export const ROLES = ['GK','LCB','RCB','LB','RB','DM','LCM','RCM','LW','RW','ST'];
export const ROLE_INFO = {
  GK:  { family: 'GK', side: 'C', label: 'Goalkeeper',               short: 'GK', num: 1 },
  LCB: { family: 'CB', side: 'L', label: 'Left centre-back',         short: 'LCB', num: 4 },
  RCB: { family: 'CB', side: 'R', label: 'Right centre-back',        short: 'RCB', num: 5 },
  LB:  { family: 'FB', side: 'L', label: 'Left back',                short: 'LB', num: 3 },
  RB:  { family: 'FB', side: 'R', label: 'Right back',               short: 'RB', num: 2 },
  DM:  { family: 'DM', side: 'C', label: 'Holding midfielder (#6)',  short: '6', num: 6 },
  LCM: { family: 'CM', side: 'L', label: 'Left central midfielder (#8)',  short: '8', num: 8 },
  RCM: { family: 'CM', side: 'R', label: 'Right central midfielder (#8)', short: '8', num: 10 },
  LW:  { family: 'W',  side: 'L', label: 'Left winger',              short: 'LW', num: 11 },
  RW:  { family: 'W',  side: 'R', label: 'Right winger',             short: 'RW', num: 7 },
  ST:  { family: 'ST', side: 'C', label: 'Striker (#9)',             short: '9', num: 9 },
};
export const FAMILIES = ['GK','CB','FB','DM','CM','W','ST'];
export const LEARNABLE_ROLES   // every outfield role; the GK role is v1.1
export function mirrorRole(role) // 'LCB'<->'RCB', 'LB'<->'RB', 'LCM'<->'RCM', 'LW'<->'RW'; others unchanged
export const BACK_LINE = ['LB','LCB','RCB','RB'];  MIDFIELD = ['DM','LCM','RCM'];  FORWARDS = ['LW','ST','RW']
export const playerId = (team, role) => `${team}-${role}`;   // 'us-LCB', 'them-ST'
export function parsePlayerId(id) // → { team, role };   mirrorPlayerId('them-LW') → 'them-RW'
```

HELIOS role number → our role: 1 GK, 2 LCB, 3 RCB, 4 LB, 5 RB, 6 DM, 7 LCM, 8 RCM, 9 LW, 10 RW, 11 ST. HELIOS "L" roles are at negative y, which is the top of our frame after `y + 34`, i.e. our left. No y flip.

## 4. Core data shapes (JSDoc typedefs live in `js/engine/types.js`)

```js
/** @typedef {{x:number,y:number}} Vec */
/** @typedef {'us'|'them'} Team */
/** @typedef {{ id:string, team:Team, role:string, x:number, y:number }} Player */

/** A single moment of play. `players` always has 22 entries (11 per team). */
/** @typedef {{
 *   t: number,                         // seconds (0 for static frames)
 *   ball: Vec,
 *   possession: 'us'|'them'|'none',    // 'none' = loose ball
 *   carrierId: string|null,            // player on the ball, if any
 *   players: Player[],
 *   tags: {
 *     carrierFacing?: 'forward'|'backward'|'sideways',  // relative to the carrier's attacking direction
 *     pressureOnBall?: boolean,        // override; otherwise derived (§5.4)
 *     event?: 'pass'|'carry'|'cross'|'shot'|'clearance'|'throw-in'|'goal-kick'|'corner'|'free-kick',
 *     ballMovingBack?: boolean,        // ball just moved toward the carrier's own goal (timeline derives it)
 *     phase?: string,                  // scenario.phase: one of scenario.js PHASES (snake_case: 'build_up', 'progression', 'final_third',
 *                                      //   'high_press', 'mid_block', 'low_block', 'counter_attack', 'counter_press', 'recovery',
 *                                      //   'set_piece', 'open_play'); descriptive only, no rule reads it
 *     widthHolders?: string[]          // roles holding the width in possession (default: the wingers), e.g. ['LB'] for an inverted winger
 *   }
 * }} Frame */
```

### 4.1 Content data

- `data/principles.json` = `{ version, $comment, principles: [...] }`. Each principle: `id, name, short, kidName` (Player mode's 2-4 plain words, e.g. "Back Up Your Buddy"), `category, section` (RESEARCH subsection), `who, families, level, release, ruleIds, summary{standard,kid}, ruleOfThumb, why, commonMistake, learnMore[{label,url}], sources`. `name`, `level`, `release` and `sources` follow the RESEARCH §8 table (tested). `ruleIds` follow the RESEARCH 5.5 map and agree both ways with the rule registry (tested). The passing principles PA1-PA15 (category `passing`, section `research/passing.md §2`, `ruleIds: []`: passing.js rates them, §5.14) follow [research/passing.md](research/passing.md) §2 instead (release and source keys, tested), link only to its §7 sources, and add `related` (the F/B/P rows they mirror, e.g. PA4 → B3).
- `data/curriculum.json` = `{ version, $comment, moduleUnlockStars, levels: [{level, name, kidName, mix, scaffold, timer, unlockStars, description{standard,kid}}], session{...}, modules: [{ id, kind: 'tutorial'|'drills', title, subtitle, description{standard,kid}, principles, roles, unlock, tutorial?, scenarios: [], levels: [{level, focus{standard,kid}}], interleave: [{pair, label{standard,kid}}], pitchChallenge{standard,kid} }] }`. A drill module's `scenarios` lists exactly the indexed scenarios whose `scenario.module` is that module, in teaching order (easy to hard), and `roles` exactly the role families those scenarios play (both tested in `tests/scenarios-content.test.js`). The app selects drills from the index by `scenario.module` (session.js `candidatesFor`), so the list is the curriculum's record, not a second source of truth.
- `data/tutorial.json` = `{ version, $comment, module: 'M0', title, intro{standard,kid}, outro{standard,kid}, steps: [{ id, topic, title, text{standard,kid}, principles, setup{ ball, possession, carrierId?, learnerRole, learnerStart?, overlays{thirds,lanes,zone14,offsideLine: boolean}, highlight, overrides? }, task{ type, to|target|answer, prompt{standard,kid}, success{standard,kid}, hint? } }] }`. `setup` means the same as the autoFrame options; `overlays.offsideLine` is a boolean, so the UI computes the line (their second-last player) before calling `board.setOverlays`.
- `data/road.json` = `{ version, $comment, groups: { DEF: ['CB','FB'], MID: ['DM','CM'], WING: ['W'], STRIKER: ['ST'] }, defaultRoles: { DEF: 'LB', MID: 'LCM', WING: 'LW', STRIKER: 'ST' }, lead: { [group]: chapterId }, quickPass: nodeId[], matchday: { unlockAfter: nodeId }, chapters: [{ id, title, skill, icon, opensAfter?, nodes: [{ id, kind: 'spot'|'pass'|'mix', title, icon, principles? | from? }] }] }`: Player mode's Road (docs/KID_REDESIGN.md §3; js/ui/player/road.js normalises it, §5.16). Node titles are 4 words or fewer; the home writes only the current chapter's titles and, under its node, the title of the node that opens Match day (the Big Match); `icon` stands for the rest. A mix node draws from its chapter (`from`); `skill` names the chapter's rating on the card. **Unlocks:** the first node is open; a node opens when the one before it has a star (or once you have played it); a chapter's `opensAfter` also opens its first node when that node has a star ("Help the ball" and "Pass it right" both open after Close Them Down); Match day opens when `matchday.unlockAfter` (Big Match) has a star. `lead` names, per position group, the chapter whose open nodes Next up offers first (`{ MID: 'help', WING: 'help', STRIKER: 'help' }`: attackers get attacking plays early; defenders follow the Road's order). `quickPass` names the pass nodes the quick "Who's open?" set (`#/pass`) takes in turn (`['free-player', 'play-forward']`: the first gets the odd rep). Tested in `tests/road.test.js`.
- `data/resources.json` is an array of `{ id, title, url, kind: 'book'|'website'|'video'|'course'|'curriculum'|'app', group: 'start-here'|'beginner'|'intermediate'|'advanced'|'video', level, audience, why, free, verified, note? }` in display order.

## 5. Engine API

### 5.1 formation.js

```js
/** Formation table JSON (data/formations/*.json):
 * { id, name, shape: '4-3-3', frame: 'canonical',
 *   source: { name, repo, file, url, commit, blob, license, copyright, licenseText, attribution, note, conversion, generatedBy },
 *   roles: ['GK',...],                       // our role IDs
 *   edits: [ { sample, role, rule, before, after, reason } ],   // every change made to the source data
 *   samples: [ { ball:{x,y}, pos: { GK:{x,y}, LCB:{x,y}, ... } }, ... ] }   // canonical frame, team attacks +x; samples[i] = HELIOS sample i
 */
export function createFormation(table) → Formation     // no table (or no samples) → the linear fallback
// Formation = {
//   id, name, roles,
//   samples,                                  // as in the table (read-only)
//   triangles: Uint32Array,                   // Delaunay triangles over sample ball points (via vendor/delaunator)
//   hull: Uint32Array,                        // sample indices of the convex hull
//   positions(ball) → { [role]: Vec },        // own frame (attacks +x), barycentric interpolation; ball clamped to pitch; TypeError on a non-finite ball
//   locate(ball) → { ball, samples:[i,j,k], weights:[w1,w2,w3], inside },   // for overlays and debugging
// }
export const POSSESSION_OFFSET = { with: 6, without: -4 };   // [D] metres along the team's attacking direction, outfield only
export const FORMATION_DEFAULTS = { offsetTaper: 16.5 };     // [D] the offset fades to 0 within this of the goal line it pushes toward
export const SHAPE_DEFAULTS = { levelBackLine, maxLineGap, maxLineHeight /* 52 [S] U6 */, wingerInset, tuckSideways, stBeyondBall, stBlockHigh, stBlockFade,
                                wingerWidth, crossX, crossFade, cbSplit, fbWide, buildUpFrom, buildUpTo, buildUpDepth: { FB, DM, CM, ST } };
export function teamTargets(formation, team, ball, { inPossession = false, offset = true, taper, shape = offset } = {}) → { [role]: Vec }
//   team 'us':   positions(ball)
//   team 'them': mirror through the centre spot: b' = (105-bx, 68-by); p = positions(b'); p → (105-px, 68-py)
//   offset: the possession offset along the team's attacking direction (us: +x, them: -x), outfield only,
//     fading to 0 within offsetTaper of the goal line it pushes toward (so the order in depth is kept);
//   shape: then phaseShape() for the inPossession phase (in the team's own frame; recover = offset, so a loose ball
//     keeps the #9 where the table puts him); every target clamped to the pitch. shape may be a SHAPE_DEFAULTS override object.
export function phaseShape(targets, ball, { inPossession, params, recover = true }) → targets     // own frame; mutates and returns
//   HELIOS has one phase; these adjustments stand in for authored in/out-of-possession tables:
//   out of possession: back four level up (U4, levelBackLine), then step up to within maxLineGap of the
//     midfield line (U1) but never past maxLineHeight (a line above it drops to it; the midfield drops back to the
//     capped line instead); U1 then holds per player: no #6/#8 more than maxLineGap ahead of the back line, no forward
//     more than that ahead of the midfield line; in a mid or low block (back line below stBlockHigh, fading over
//     stBlockFade) the #9 comes back to at most stBeyondBall beyond max(ball, midfield line) (T3; recover: false skips it);
//     wingers at least wingerInset in from the touchline (R4); far #8s and wingers within tuckSideways of the ball (D4).
//   in possession: wingers within wingerWidth of their touchline (B1) unless widthDuty() frees the far one (P10);
//     in build-up (ball.x < buildUpFrom, fading out by buildUpTo) the CBs split cbSplit either side of their
//     mid-point, the FBs go fbWide from it (R1, B10), and the lines stagger: FBs, #6, #8s and #9 at least
//     buildUpDepth up (B10, B2). Continuous in the ball and left/right symmetric.
export function widthDuty(ball, side) → 0..1      // 1 = the side's winger must hold the width; 0 with the ball in the far wing lane beyond crossX (P10)
export const LINEAR_DEFAULTS                      // [M] regression coefficients of the linear fallback (GK part [D])
export function linearTarget(role, ball) → Vec   // regression fallback from RESEARCH 5.2 (tests + sanity)
```

`SHAPE_DEFAULTS.tuckSideways` equals `TUCK_DEFAULTS.maxSideways`, `SHAPE_DEFAULTS.stBlockHigh` equals `CONTEXT_DEFAULTS.blockHigh`, and the width and box-fill rules use `widthDuty()` (all tested).

### 5.2 scene.js

```js
export const SCENE_DEFAULTS = { carrierOffset: 0.8, pressDistance: 2.5, pressRadius: 14, pressFade: 6, pressHandover: 3, pressPastWeight: 2,
                                pressZoneFree: 8, pressZoneWeight: 1,                            // playback ranking (rankFrom)
                                pressFbEngage: 10, pressFbEngageFrom: 45, pressFbEngageTo: 55,   // = CONTEXT_DEFAULTS.fbEngage* (tested)
                                pressAim: 25, pressLeanCentre: 2, pressLeanFrom: 45, pressLeanTo: 55,   // = PRESS_DEFAULTS.centralAim, lean* (tested)
                                onsideMargin: 0.5, settleReach: 6, settleFade: 4, settleMargin: 1,
                                minSeparation: 2, separationPasses: 8, separationBias: 0.5, separationSoft: 0.5,
                                autoCarrier: true, autoPress: true, onsideClamp: true, settle: true } // [D]
/** Place all 22 players for a ball position.
 * opts: { formations: { us: Formation, them?: Formation },
 *         ball: Vec, possession: 'us'|'them'|'none', carrierId?: string|null,   // null = no explicit carrier (autoCarrier still applies);
 *                                             //   ignored with possession 'none' (a loose ball has no carrier)
 *         learnerId?: string,                 // NEVER made carrier or presser, never moved by separation (gets its formation spot, kept onside, unless overridden)
 *         overrides?: { [playerId]: Vec },    // fixed positions win over everything
 *         autoCarrier?: boolean = true,       // no carrierId: the possession team's nearest non-learner outfielder snaps to the ball
 *         autoPress?: boolean = true,         // the defending outfielder nearest the ball presses pressDistance from it on the ball→own-goal line,
 *                                             //   turned pressAim x pressLean() degrees toward the middle (D2/R5: in the attacking team's half a
 *                                             //   carrier off the middle is pressed from his inside; context.js pressLean(), continuous in the ball);
 *                                             //   a defender the ball has gone past counts pressPastWeight x metres extra, and with the ball wide
 *                                             //   in the defending team's half its ball-side full-back pressFbEngage metres less (R2, U5:
 *                                             //   context.js engageBias(), the same ranking as the first defender); nobody presses if the
 *                                             //   top-ranked defender is the learner or an override. Static scenes ramp the press in over
 *                                             //   pressHandover and fade it over pressFade (no jumps while dragging the ball).
 *         presserId?: string|null,            // undefined = automatic; an id = that defender presses fully; null = nobody presses
 *         inFlight?: boolean,                 // ball in flight: no auto carrier and no press (the timeline sets it)
 *         shapeBall?: Vec,                    // ball the shape and the press decision react to (default: ball)
 *         rankFrom?: { [playerId]: Vec },     // where the players actually are (the timeline passes its frame at a key time): the automatic
 *                                             //   press then ranks each defender from there on `ball`, plus pressZoneWeight per metre his
 *                                             //   formation spot ranks beyond pressZoneFree (D7: out of his zone he hands over), so a defender
 *                                             //   the play has left behind is never sent to press past a teammate who is already goal-side
 *         onsideClamp?: boolean = true,       // attackers pulled onside: x ≤ max(max(ball.x, second-last defender) - onsideMargin, halfway); mirrored for 'them'
 *         params?: object }                   // SCENE_DEFAULTS overrides; params.shape = SHAPE_DEFAULTS overrides for both teams
 * Order: formation targets → overrides → carrier → goal-side settle → press → onside clamp → separation.
 * possession 'none' (loose ball): no possession offset, no carrier, no press; both teams take their out-of-possession
 *   phase shape and both are kept onside.
 * Goal-side settle (D5, R4; params.settle): out of possession (both teams with a loose ball) every auto-placed #8 drops to
 *   settleMargin goal-side of the opponents within settleReach of him (a winger: of the full-back on his flank), fading
 *   out over settleFade; moves are computed from the pre-settle positions. Overrides and the carrier never move.
 * Separation pushes auto-placed players apart to minSeparation (opponents: each towards their own goal, so a marker ends goal-side).
 *   Each pair's direction and target gap are fixed from the positions before separation (so a 1 cm ball move never swaps
 *   two players); a pair whose biased offset is shorter than separationSoft (two players crossing) is only partly separated.
 * @returns {Frame}  (t = 0, tags = {})
 */
export function autoFrame(opts) → Frame
export function autoRoles(opts) → { carrierId, presser: { id, w } | null }   // the automatic choices, without placing anyone
/** The learner's base (zone centre, and the spot duties are computed at): where the auto-placer would put the learner's
 *  role as an ordinary player — its formation spot; its press spot when its role is the automatic presser (or, with a
 *  loose ball, our automatic first defender); in possession, if its role would carry, the formation spot of the teammate
 *  who takes the ball instead (P6). The learner's own override (a dragged spot) is ignored. */
export function learnerBase(opts) → Vec          // opts as autoFrame, learnerId required
```

### 5.3 timeline.js and scenario format

Scenario JSON (see RESEARCH.md 9.4; this is the binding version; `data/scenarios/_example.json` is a validated example):

```jsonc
{
  "id": "d3-cover-lcb-001",              // unique, kebab-case
  "title": "Cover your centre-back partner",
  "brief": "Their striker is running at your partner. Where do you go?",   // shown before playback (1 sentence, never names a side)
  "briefKid": "Their striker runs at your partner. Watch!",               // optional: kid wording of the brief (≤ 15 words)
  "question": "Your partner steps out. Where do you go?",                 // optional: asked at the freeze (default: "Where should you be now?")
  "questionKid": "Your friend goes to the ball. Where do you go?",        // optional: kid wording of the question
  "takeaway": { "standard": "When your partner steps out, drop behind them at an angle.", "kid": "Stand behind your friend to help." },
                                                                           // optional: shown in beat 2 (default: the primary principle's summary)
  "module": "M1",                        // curriculum module ID
  "moment": "out_of_possession",         // in_possession | out_of_possession | attacking_transition | defensive_transition
  "phase": "mid_block",                  // optional: one of scenario.js PHASES
  "principles": ["D3", "U4"],            // principle IDs this scenario teaches (first = primary, and v1)
  "learner": { "role": "LCB", "start": { "x": 30, "y": 28 } },   // start optional: default = auto position at t=0
  "timeline": {
    "duration": 6.0,                     // seconds of playback
    "freezeAt": 4.2,                     // drill freezes here (≤ duration)
    "ball": [ { "t": 0, "x": 60, "y": 40, "event": "carry" }, { "t": 1.0, "x": 58, "y": 42, "event": "pass" }, { "t": 2.0, "x": 45, "y": 38 } ],   // linear; a key's event marks the moment it happens
    "possession": [ { "t": 0, "team": "them" } ],        // step function
    "carrier": [ { "t": 0, "id": "them-RCM" }, { "t": 1.0, "id": null }, { "t": 2.0, "id": "them-ST" } ],   // step; before the first key: automatic; null = in flight
    "players": {
      "auto": true,                      // everyone without an override follows autoFrame(); false freezes the shape at t = 0
      "overrides": [ { "id": "them-ST", "keys": [ { "t": 0, "x": 45, "y": 36 }, { "t": 2.0, "x": 45.8, "y": 38 } ] } ]   // an overridden carrier must be keyed with the ball
    },
    "tags": [ { "t": 0, "carrierFacing": "forward" }, { "t": 1.0, "event": "pass" } ]   // step function, cumulative, merged into frame.tags
  },
  "answer": {                            // what the drill is graded against
    "mode": "engine",                    // engine = ghost at freeze; authored = use "ideal" as zone centre
    "ideal": { "x": 33, "y": 35 },       // optional for engine mode (used only to flag disagreement > 5 m)
    "tol": { "tx": 2.5, "ty": 3 },       // optional per-scenario tolerance override
    "hold": false                        // optional: true for a "hold your position" lesson (the answer may be < 5 m from the start); say why in notes
  },
  "misconceptions": [ { "id": "ball-watching", "region": { "type": "circle", "x": 38, "y": 40, "r": 3 },
                        "text": "You were drawn to the ball...", "textKid": "Don't chase the ball." } ],   // circle | rect {x0,y0,x1,y1} | polygon {points}; textKid optional
  "difficulty": 0,                       // Elo prior (logit scale, 0 = average)
  "params": {},                          // optional SCENE/TIMELINE_DEFAULTS overrides (also autoPress, autoCarrier, onsideClamp)
  "source": { "kind": "handmade", "license": "MIT", "author": "fotbol", "keyedBy": [] },
  "notes": "Authoring notes: why the answer is authored, what was re-keyed and when."   // optional; never shown to learners
}
```

Learner text: second person, plain football language, never a side or a screen direction (scenarios are mirrored left↔right), never a gendered pronoun (players are "they"), kid strings ≤ 15 words; the UI reads every text field through `session.js wordingOf(value, wording, kidSibling)`, which also accepts a `{ standard, kid }` pair. `validateScenario` type-checks these optional fields (it ignores other unknown keys) and checks `phase` against `PHASES`; `tests/scenarios-content.test.js` enforces the copy rules on every indexed scenario.

```js
export const TIMELINE_DEFAULTS = { reactionLag: 0.3, shapeWindow: 1.0, possessionBlend: 1.0, carrierBlend: 0.5, pressCommit: 0.5,
                                   recoverSpeed: 6, maxBlend: 4, eventGrace: 0.7, sampleHz: 10, ballBackWindow: 1.0, ballBackDist: 3,
                                   adjustStep: 0.1, adjustWindow: 0.5 };
/** Frame of a scenario at time t (a pure function of t).
 *  - Auto players use autoFrame(); the shape reacts to the MEAN ball over [t - reactionLag - shapeWindow, t - reactionLag]
 *    (shapeWindow 0 = the ball at t - reactionLag); the carrier, press spot and onside line use the ball at t.
 *  - Automatic carriers and pressers are decided at t = 0 and at every ball, possession and carrier key, and held until the next;
 *    at a key the press is ranked on where the players are then (autoFrame's rankFrom: the placement at the key with its blend,
 *    settle and separation left out).
 *  - Every state change (possession, carrier, in-flight, presser) closes each player's gap linearly over
 *    clamp(|gap| / recoverSpeed, possessionBlend or carrierBlend, maxBlend): nobody teleports.
 *  - The goal-side settle and the separation of autoFrame() are added last: sampled every adjustStep s (each sample holding
 *    for the adjustStep around it, in the state that holds then) and averaged over adjustWindow s centred on t (adjustCells),
 *    so they never snap (a change of d metres takes the window; states are decided up to adjustWindow / 2 + adjustStep ahead).
 *    adjustWindow 0 applies them as they come.
 *  - frame.tags: the tag keys so far; `phase` defaults to scenario.phase; `ballMovingBack` is derived unless tagged.
 *  opts: { formations, learnerId?: string|null /* default: the scenario's; null = nobody held back */, learnerSpot?: Vec, params? } */
export function frameAt(scenario, t, opts) → Frame
export function learnerBaseAt(scenario, t, opts) → Vec   // the learner's base at t (the playback twin of learnerBase()): where the CURRENT
                                                          //   state wants the role, blends off (not an auto player half-way through a recovery run);
                                                          //   the states and the averaged settle and separation are the blended playback's
export function ballEvents(scenario) → [{ t, event }]     // for live-mode reaction grace
// also: interpKeys, stepKey, ballAt, meanBallAt, possessionAt, carrierAt, timing, inGrace, sampleTimes,
//   adjustCells(t, P) → [gridIndex, weight][], applyAdjustments(frame, cells, adjustAt), adjustmentOf(full, bare) (shared with sequence.js)
```

**Judging a drill (one definition everywhere).** A drill frozen at `freezeAt` (`timing(s).freezeAt`, the duration when not authored) judges a spot on the FREE frame `frameAt(s, freezeAt, { formations })` (the learner held back at their automatic spot; nobody reacts to where the learner stands) with the learner's token moved to the spot, `base = learnerBaseAt(s, freezeAt, { formations })`, `buildContext(frame, { learnerId, base })`, and the ghost searched round `base` (or `answer.ideal` in authored mode) with `toleranceFor(role, answer.tol)`. So the frame, the duties and the ghost never depend on the start spot or the dragged spot, and standing on the ghost scores the ghost's score. `scripts/check-scenarios.mjs checkScenario(raw, { principles, formations })`, the author tool (`analyseDraft`) and drill.js all do exactly this (held equal by `tests/scenarios-content.test.js`). During playback the drill shows the same free frame with the learner's token at `learner.start` (default: their automatic spot at t = 0): caught watching. `frameAt(..., { learnerSpot })` (the learner pinned as an override, so the others react to them) is what Live mode uses.

**Drill-quality gates** (`npm run check` fails on them; `CHECK_DEFAULTS`): the scenario validates; the ghost scores S (≥ 90); the ghost is ≥ 5 m from the start spot unless `answer.hold`; standing still at the start spot scores below `maxStartScore` (70, a B) unless `answer.hold`; the ghost is outside every misconception region; in engine mode the ghost is within 5 m of `answer.ideal` when one is keyed (RESEARCH 5.7 "key disagreement": the ideal is the coach's regression guard). `checkScenario` returns `{ errors, scenario, t, frame, base, ctx, ghost, engineGhost, start, moved, startScore, ideal, misconceptions, problems }` (`startScore`: the start spot judged as the drill judges it).

**The scenario index.** `data/scenarios/index.json` = `{ version: 1, generated: 'by scripts/build-index.mjs', scenarios: [{ id, file, title, module, moment, phase, principles, role, difficulty }] }`, sorted by module (natural order) then file name, one row per line. `scripts/build-index.mjs` skips `index.json` and files starting with `_` or `.`, refuses to write on any invalid scenario or duplicate id (exit 1), and warns (without failing) when a file name differs from its id or the curriculum and the scenarios disagree. `--check` exits 1 when the index is missing or stale. Exports (pure, also run in `tests.html`): `naturalCompare, scenarioFiles, indexEntry, sortEntries, buildIndex(items, {principles, curriculum}) → {index, errors, warnings}, serializeIndex, diffIndex(current, expected), run({dir, principles, curriculum, check, log, warn}) → exit code`.

`scenario.js`:
```js
export function validateScenario(s, { principles, params } = {}) → string[]   // empty = valid; principles: a map, {byId}, {list}, {principles:[...]}, Map/Set or array
export function mirrorScenario(s) → Scenario     // left↔right: every y → 68 - y, roles/ids L↔R, id gets suffix '-m' (text is not rewritten)
export function normalizeScenario(s) → Scenario  // fills defaults; converts the RESEARCH 9.4 forms
export function learnerId(s) → 'us-<role>'
export const SCENARIO_DEFAULTS, MOMENTS, EVENTS, ANSWER_MODES, REGION_TYPES, PHASES
```

### 5.4 context.js

```js
export const CONTEXT_DEFAULTS = { pressureRadius: 3, secondDefenderRadius: 15, coverUnitPenalty: 5, coverMidAhead: 5, centreOfPlayRadius: 12,
                                  markRadius: 18, handoverDepth: 5, backReach: 8, midReach: 8, markBehindBall: 2, coverReach: 4,
                                  pastWeight: 2, fbEngage: 10, fbEngageFrom: 45, fbEngageTo: 55, blockHigh: 45, blockLow: 25, offsideMarkMargin: 1 }  // [D]
export function engageBias(team, ball, P) → { role: 'LB'|'RB', bias }   // R2/U5 ranking bonus of the defending team's ball-side full-back (shared with scene.js)
export function pressLean(team, ball, P) → 0..1   // D2/R5: how much the press leans onto the carrier's inside: full off the middle (from leanCentre m
                                                  //   off y = 34 to the half-space) in the attacking team's half (leanFrom → leanTo, the defending
                                                  //   team's own frame), 0 in its own half; shared by scene.js (press spot) and the press rule
/** @returns {Ctx} */
export function buildContext(frame, { learnerId, base, params })
// base: the learner's base (§5.2 learnerBase / §5.3 learnerBaseAt). DUTIES ARE COMPUTED WITH THE LEARNER AT `base`, not at the dragged spot.
// params: CONTEXT_DEFAULTS overrides; params.rules[ruleId] overrides that rule's *_DEFAULTS (for tuning and tests).
// Ctx = {
//   frame, params,
//   learner: { id, team: 'us', role, family, side, base },
//   moment: 'in_possession' | 'out_of_possession' | 'loose',       // a loose ball is judged as defending
//   ball, carrier: Player|null, carrierFacing, pressureOnBall: boolean,   // pressure: an outfield opponent of the carrier within
//                                                                        //   pressureRadius of the carrier or the ball (tag wins)
//   ballZone: { third: 0|1|2, lane: 0..4, wing: boolean },
//   ballSide: 'L'|'R'|'C',                         // which side of OUR team the ball is on (lane 0-1 = L, 3-4 = R)
//   teammates: Player[],                           // 'us' players excluding the learner
//   usAtBase: Player[],                            // teammates plus the learner at base
//   opponents: Player[],
//   lines: {
//     ourBackLine: Player[], ourBackLineX,         // our back four (learner at base if in it), median x
//     ourMidLineX,                                 // median x of our #6 and #8s (learner at base)
//     oppSecondLastX, oppLastX,                    // offside line (GK counts): the largest-but-one / largest x among 'them'
//     oppBackLineX, oppMidLineX,                   // median x of their back four / their #6 and #8s
//   },
//   blockHeight: 'high'|'mid'|'low',              // of the team OUT of possession: back-line x (in its own frame) ≥ 45 high, 25–45 mid, < 25 low
//   duty: 'first-defender'|'second-defender'|'third-defender'|'first-attacker'|'second-attacker'|'third-attacker',
//   firstDefender: Player|null,                    // nearest outfielder to the ball, counting pastWeight x metres past the ball extra (T3)
//                                                  //   and, with the ball wide in our half, the ball-side full-back fbEngage metres nearer (R2, U5)
//   secondDefender: Player|null,                   // nearest teammate goal-side of the first defender (x < min(ball, FD) - 1) within 15 m;
//                                                  //   a back-liner who engages is covered from the back line (others rank coverUnitPenalty
//                                                  //   further, U5/R1); a midfielder or forward coverMidAhead or more ahead of our back line
//                                                  //   is never covered by a back-liner (the line holds, U2/U4)
//   markTarget: Player|null,                       // first defender: the carrier; second defender: null (he covers; an opponent within
//                                                  //   coverReach of a covering back-liner is his, so nobody else marks him); third defenders:
//                                                  //   one-to-one, no opponent twice: flank duels first (winger ↔ their full-back only, R4;
//                                                  //   full-back ↔ their winger, R2), then the back line, #6 and #8s together, then the
//                                                  //   striker, greedily by distance within markRadius and their zone (D7): the back line up
//                                                  //   to backReach ahead of its height; midfield and striker from handoverDepth ahead of it;
//                                                  //   the #6 only up to our midfield line (and after every other pair while an opponent is
//                                                  //   within the back line's reach, R3); the #8s at most midReach ahead of our midfield line
//                                                  //   (U1); in a mid or low block, midfielders and striker never an opponent more than
//                                                  //   markBehindBall behind the ball (U6); nobody marks an opponent standing offside
//                                                  //   (in our half, more than offsideMarkMargin behind our second-last player with the
//                                                  //   learner at base and behind the ball): the line holds and leaves him there (U4)
//   dangerousAttacker: Player|null,                // opponent nearest our goal (not the carrier or keeper)
//   widthHolder: boolean,                          // in possession: in tags.widthHolders, or a winger by default
// }
```

### 5.5 Rules (`js/engine/rules/*.js`)

One rule per file, default export, plus a named `<RULE>_DEFAULTS` export (e.g. `PRESS_DEFAULTS`) with every number:

```js
export default {
  id: 'cover',                        // matches the file name
  principles: ['D3'],                 // principle IDs this rule checks (first = the one explain reports)
  critical: false,                    // true if failing it can cap the score
  /** 0 = not applicable. Otherwise the rule's weight for this learner/moment (RESEARCH 5.6). Memoised per ctx. */
  weight(ctx) { ... },
  /** Score a candidate spot. MUST be fast (called ~1000x per ghost search) and pure.
   *  Not applicable → { s: 1, vars: {} }.
   *  @returns {{ s: number /*0..1*/, critical?: boolean /* true only when a critical constraint is broken */,
   *              target?: Vec /* the spot this rule alone would want */, vars: object /* defending rules: vars.issue ('ok' or a failure key);
   *              vars.principle (optional): which of the rule's principles this result is about, e.g. press → 'D2' for the angle,
   *              compact → 'U2' for the gaps to line-mates; explain.js and Explore's tags report it (default: principles[0]) */ }} */
  evaluate(ctx, spot) { ... },
  text: {
    standard: { name: 'Cover at an angle', ok: (v) => '...', fail: (v) => '...', cue: (v) => '...?' },   // ok() may return '' (no praise)
    kid:      { name: 'Back up your teammate', ok: (v) => '...', fail: (v) => '...', cue: (v) => '...?' },
  },
  /** optional: what to highlight for the beat-1 cue; `spot` (the judged spot) is optional */
  cue(ctx, spot) { return { type: 'player', id } },   // or { type: 'point', x, y } | { type: 'segment', a, b } | { type: 'line-x', x }
};
```

v1 rules (RESEARCH 5.5): `offside`, `keeps-onside`, `level-line`, `goal-side`, `press`, `cover`, `tuck`, `compact`, `screen`, `width`, `pin`, `lane-open`, `support-distance`, `occupancy`, `between-lines`, `spacing`, `box-fill` (P10, added in integration). (`gk-angle-depth` is v1.1.) `box-fill.js` also exports `crossing(ball)` (the P10 fade, `1 - widthDuty` of the far side) and `boxRunner(ctx)`; `offside.js` exports `offsideLineX(ctx)`. `rules/index.js` exports `RULES` (array) and `RULES_BY_ID`. Per-frame work goes in a `perContext()` prep from `rules/_util.js` so `evaluate()` is plain arithmetic.

Interpretations fixed in integration (details in each file's header): `compact` does not apply to the first defender, reports a negative gap to a line-mate as `crossed` (U2: you have swapped sides with him), judges a covering back-liner only on the gaps to his line-mates (U2; the cover rule sets his depth) and no other second defender, and counts a pressing line-mate as closing his channel; `cover` never puts a covering back-liner ahead of his own line (the depth band starts at the level-line reference), and when the line sets that depth it leaves how far above the line he stands to `level-line` (U4 says why), judging only the angle and that he is not too deep; `goal-side` judges a covering full-back only on staying goal-side of the winger on his flank (R2, weight 1.5), and the first defender only with the carrier in our box and only on the side (that keeps the in-box critical; elsewhere the press rule judges his distance, angle and side, so "get goal-side" is never said twice); `press` leans onto the carrier's inside in the opponents' half (`pressLean`: band [-centralOutside, centralInside] = [-10°, 45°] at full lean, target centralAim 25°; D2, R5), keeps the ±20° band on the line to goal in our half and the wing band in a wing lane; `screen`'s centre lane slides with the centre-backs' mid-point (at most a half-space), and "in the passing line" means within shadowDist 1.5 m of it (RESEARCH 5.8 cover shadow; 5.5's 3 m let the pass by); `width` fades out for the far winger in the crossing zone and `box-fill` fades in by the same amount (P10, `widthDuty`); `pin` steepens and says "offside" only past the offside line (ball, second-last opponent or halfway, IFAB Law 11), is a gentle miss beyond their line while onside, and fades out once the ball is past their second-last player; `between-lines` fades out as the ball reaches their midfield line and in the crossing zone; `support-distance` asks only players within 15 m of a pressed carrier to come short, and with `lane-open` fades out for the #9 and far winger with the ball wide in the final third (`boxRunner`, R5); `spacing` holds in-possession width-holders and the #9 only to its minimum (they stretch the team), and out of possession (a loose ball too) applies only its maximum and not to the first defender: defenders stand close to a teammate on purpose (cover, a double-up, a compact bank, centre-backs on a cross) and `compact` keeps line-mates apart (U2).

Text rules: second person, present tense, one sentence, football language ("drop", "push up", "tuck in", "come inside", "get goal-side"), never screen directions ("left/up on the screen"). Kid wording: ≤ 15 words, no jargon beyond the glossary.

### 5.6 score.js, ghost.js, explain.js

```js
// score.js
export const TOLERANCE = { CB:{tx:2.5,ty:4}, FB:{tx:2.5,ty:4}, DM:{tx:4,ty:4}, CM:{tx:5,ty:6}, W:{tx:6,ty:4}, ST:{tx:6,ty:6}, GK:{tx:1.5,ty:1.5} };  // [D]
export const SCORE_WEIGHTS = { zone: 0.55, rules: 0.45 };   // [D]
export const RULES_GATE = { fullAt: 0.5, floor: 0.5 };      // [D]
export const CRITICAL_CAP = 59;
export const GRADE_BANDS
//   score = round(100 (0.55 S_zone + 0.45 G S_rules)), capped at 59 on a critical fail,
//   G = rulesGate(S_zone) = 1 when S_zone ≥ fullAt, else fading linearly to `floor` at S_zone = 0.
//   (Exactly RESEARCH 5.6 within about 2.2x the tolerance; far away, locally satisfied rules cannot lift a wrong spot.)
export function zoneScore(spot, center, tol) → number        // anisotropic ellipse: 1 inside, exp(-0.5 (d_n-1)^2) outside; tx along x, ty along y
export function rulesGate(sZone) → number
export function evaluateRules(ctx, spot, rules = RULES) → { sRules, results: RuleResult[] }
//   RuleResult = { id, principles, weight, s, critical: boolean, target?: Vec, vars }; weight-0 rules omitted; none apply → sRules = 1
export function evaluate(ctx, spot, { center, tol, rules } = {}) → EvalResult
//   EvalResult = { score /*0..100 int*/, grade, sZone, sRules, gate, critical, rules: RuleResult[], distance /*m to center*/,
//                  center, tol, raw /*unrounded, capped*/, spot };   center defaults to ctx.learner.base
export function createScorer(ctx, { center, tol, rules }) → (spot) => raw score   // fast path for the ghost and live mode
export function gradeOf(score) → 'S'|'A'|'B'|'C'|'D'|'F'   // S ≥ 90, A ≥ 80, B ≥ 70, C ≥ 60, D ≥ 50, F < 50
export function toleranceFor(role, override) → {tx, ty}

// ghost.js
export const GHOST_DEFAULTS = { radius: 15, step: 1, tieEps: 1e-9 };      // [D]
/** Search a grid aligned on `base` (the zone centre) and cropped to the pitch; the argmax considers the disc of `radius`,
 *  the field covers the whole square. Ranked on the unrounded score; ties → nearest the base, then more central, then deeper.
 *  @returns { spot, score, field: { x0, y0, step, cols, rows, values: Float32Array /*unrounded 0..100, row-major, row = y*/ },
 *             result /*evaluate() at the ghost*/ } */
export function computeGhost(ctx, { base, tol, radius, step, rules })

// explain.js
export const EXPLAIN_DEFAULTS = { failBelow: 0.9, praiseAt: 0.9, maxPraise: 2, maxReasons: { standard: 2, kid: 1 }, minMove: 1, centreBand: 1, zoneFailBelow: 0.6,
                                  tradeoffMargin: 0.1, bestEps: 0.5, zoneGap: 5 };
export const HEADLINES = { standard: {...}, kid: {...} };
export const ZONE_REASON;   // the zone as a reason: ruleId 'zone', principle F2
/** opts: { wording: 'standard'|'kid', max (default by wording), principles?: byId map or {byId},
 *          ghost?: Vec|{spot, result?} (the fix target; default: the zone centre; result = evaluate() at it, same zone), rules? (the set used to evaluate) }
 *  reasons: failing rules (criticals first, then by weight x (1 - s)), then the zone reason if S_zone < zoneFailBelow, or if no other
 *  reason is left and the zone costs zoneGap points or more. With ghost.result, what the best spot gives up too is a trade-off, not a
 *  reason: a rule (or the zone) the best spot also fails is dropped unless you fail it by more than tradeoffMargin, and a spot scoring
 *  within bestEps of the best spot (or more) gets no reasons and no cue; a broken critical rule is always a reason.
 *  @returns { grade, score, headline, reasons: [{ ruleId, principleId, name, text, severity /*0..1*/, critical }], praise: string[],
 *             fix: { text, dx, dy } | null, cue: { text, ruleId, highlight } | null } */
export function explain(evalResult, ctx, spot, opts)
/** "drop 4 m deeper and come 3 m inside" — football terms relative to our goal and the centre line; '' if < 1 m;
 *  a sideways move across the middle names the touchline it heads for. */
export function phraseMove(from, to, { wording } = {})
```

Headline wording by grade (standard): S "Spot on.", A "Great position.", B "Good — small adjustment.", C "Close, but…", D "Not quite.", F "Out of position."

### 5.7 elo.js

```js
export const ELO_DEFAULTS = { targetP: 0.75, warmupTargetP: 0.85, warmupAttempts: 10, a: 1, b: 0.05, kMin: 0.1, secondaryWeight: 0.5,
                              masteryP: [0.6, 0.7, 0.8], masteryMinAttempts: 3, recentAvoid: 3, recentMax: 20 };
export function createSkills() → Skills               // { theta: {global, byPrinciple:{}, byRole:{}}, counts:{...}, items:{ [scenarioId]: { d, n } }, recent: string[] }
export function predict(theta, d) → number            // 1 / (1 + e^-(theta - d))
export function ability(skills, { principles, role }) // mean(primary principle theta, role theta); unpractised reads as global
export function update(skills, { itemId, principles, role, score01, prior = 0 }, params?) → Skills   // immutable; K = max(kMin, a/(1 + b n)); secondary principles at secondaryWeight
export function mastery(skills, principleId, params?) → 0..3   // stars at masteryP on a d = 0 item, with ≥ masteryMinAttempts attempts
export function pickNext(skills, candidates, params?) → Scenario   // weakest principle first; predicted P closest to targetFor(); avoid the last recentAvoid seen
export function kFactor(n, params?), principleTheta, roleTheta, targetFor(skills, params?)
```

### 5.8 UI contracts

```js
// js/ui/board.js
export const BALL_ID = 'ball';                         // the ball's id in enableDrag ids, highlight lists and onMove/onEnd
export function createBoard(container, { orientation = 'auto', params, youLabel = 'YOU', labels = 'role', youNumber = null } = {}) → Board
//   params: BOARD_DEFAULTS overrides; youLabel: the tag over the learner (app.createBoard passes the learner's nickname, §5.13);
//   labels: 'role' (Coach mode: role codes on the tokens) | 'number' (Player mode: each team's unique shirt numbers, ROLE_INFO num:
//   GK 1, RB 2, LB 3, LCB 4, RCB 5, DM 6, RW 7, LCM 8, ST 9, RCM 10, LW 11; plain names and places for screen readers, no codes
//   or metres; and Player mode's sizes: pitch and marker labels at least playerLabelPx (16 px, R6) tall, up to
//   playerMaxLabelScale (3.6) times life size, and YOUR name tag's text at least playerTagPx (14 px), up to maxTagScale (3)
//   times what the token alone would draw);
//   youNumber: in number mode, YOUR kit number on YOUR token (default: the position's); the teammate whose position wears that
//   number wears YOUR position's number instead (shirtNumberOf), so no two players on a team share one; theirs keep theirs
// Board = {
//   el, orientation (getter), tokenScale (getter), pxPerMetre (getter), setOrientation('auto'|'horizontal'|'vertical'),
//   render(frame, { learnerId, highlight: string[], labels: 'role'|'number'|'none', dimOthers: boolean, youLabel?: string, youNumber?: number }),
//   setGhost(Vec|null), setZone({ center, tol }|null), setHeatmap(field|null),
//   setOverlays({ thirds, lanes, zone14, offsideLine: number|null, backLine: number|null }),   // merges partial patches
//   setFocus({ x0, x1 } | Vec[] | null),              // the pitch length a mode needs: a phone held upright crops the rest (focusViewBox)
//   setMarkers([ arrow {from,to,tone?,label?} | segment {a,b,tone?,dashed?,label?,labelAt?,clear?} | line-x {x,tone?,dashed?,label?,labelAt?,clear?}
//                | ring {at?|id?, r?, tone?, pulse?, label?} | label {at,text,tone?,lift?,below?,clear?} | a rule cue() object ]),   // tone: fix|cue|good|bad|info
//                // every marker may carry cls (extra class names: Player mode styles its lanes, rings and ★ ✓ ! ✗ labels with them).
//                // Label placement: a label's lift raises it by that many metres, or 'token' clears a drawn token (or the best-spot
//                // ring) at any scale; below: true writes it under the point; clear: 'you' (Player mode) keeps it off YOU and YOUR
//                // name tag: the side asked for, else the other side, else right or left of the point, whichever covers neither and
//                // stays in view. A segment's or line's label sits at labelAt (a world point) instead of its middle; an arrow that
//                // runs up or down the screen has its label just past its tail. Centred labels slide sideways to stay in view.
//   enableDrag({ ids: string[], onMove(id, Vec), onEnd(id, Vec), tapToMove?: id, onArm?(id|null) }), disableDrag(),
//                // tapToMove: a tap on the pitch moves that token there; tap-YOU-then-a-spot still works, but only a tap on the drawn
//                // token picks it up (a tap on its tag or the grab area just around it is a move there: tapAction); onArm: a tap
//                // armed or disarmed a token. A press within grabRadius (4 m; never less than the drawn token or minHitPx across)
//                // picks the token up to drag.
//   toWorld(clientX, clientY) → Vec, destroy(),
//   // Player mode extras (docs/KID_REDESIGN.md §8.1; Coach mode never calls them):
//   setSpotlight(ids: string[] | null),              // everything but YOU, the ball and these tokens dimmed to 40 %; null = all normal
//   enableTargets({ ids, onTap(id), onPreview(id|null), labelFor?(id) }), disableTargets(), previewTarget(id|null), previewed (getter)
//                // big (≥ 44 px) numbered tap targets on tokens: a first tap (or Enter/Space) previews, a second on the same one confirms
//   showHintHand({ from, to }) → Promise,            // the worked example: a hand drags YOU to `to`, YOU snaps back; resolves when done
//                // (at once under reduced motion; a timer backs up the animation frames, so a hidden tab never keeps it waiting)
//   setAid({ kind: 'glow', target } | { kind: 'heat', level: 'hot'|'warm'|'cool'|'cold' } | null),
//                // a warm/cold ring on YOU: glow brightens and warms as YOU nears target (BOARD_DEFAULTS aidFar, aidBands); heat is Match day's
// }
// also pure helpers: pickOrientation, viewBoxFor, project/unproject, worldTransform, keyDelta, describeSpot, tokenName, pitchMarkings, drawPitch,
//   pxPerMetre(box, vb), tokenScale(pxPerM), labelScale(pxPerM), focusViewBox(orientation, box, focus), hitRadius(pxPerM, drawnM)
//   playerLabelParams(P) → P with Player mode's label minimums; tagScale(pxPerM, tokenK, { player }) → YOUR tag's extra scale (1 in Coach mode)
//   youTag(label) → { text, width }   // the learner's tag: the label in capitals (≤ 12 characters) or 'YOU', and its pill width in metres
//   SHIRT_NUMBERS, shirtNumberOf(id, { learnerId, youNumber }) → number|null   // the position's number, YOUR kit number swapped in (see youNumber)
//   tokenLabel(id, mode, { learnerId, youNumber }), simpleTokenName(id, learnerId, youNumber) ("Teammate, number 4"), describeSpotSimple(p)
//   tapAction({ armed, pressed, tapToMove, onBody }) → { kind: 'arm'|'disarm'|'move'|'none', id }   // what a tap does (see enableDrag)
//   hintPose, hintTotalMs, aidLevel, aidStrength    // the worked-example hand's pose over time, its length, the glow band and strength for a distance
```

Every draggable or tappable token is at least `minHitPx` (44 CSS px) wide to hit, however small it is drawn (R10).

The shared feedback panel (`js/ui/reveal.js`) is specified in §5.12.

Board rules: SVG `viewBox` in metres (with a 3 m margin), a vertical layout when the container is portrait and narrower than 600 px (`orientation: 'auto'`), pointer events for mouse and touch (with `touch-action: none` on the pitch only), keyboard nudging (arrows 0.5 m, Shift 2 m) on the focused draggable token, finger-offset while dragging on touch so the finger doesn't hide the token, a colour-blind-safe palette (our team and theirs must differ in lightness as well as hue), and `prefers-reduced-motion` respected. The board is controlled: it moves a dragged token optimistically, but the next `render(frame)` wins, also during the drag (so a mode that clamps or corrects the dragged spot shows the correction at once); a mode writes the dragged spot back into its frame. onMove fires during a drag, onEnd on release (a two-tap move and each keyboard nudge fire both). `setHeatmap(field)` re-encodes the image only for a new field object (pass a new object when the values change).

### 5.9 App shell and mode contract

`js/main.js` builds an `app` object once, then routes `#/<mode>[/<arg>...]` via dynamic `import()` to `js/ui/player/<name>.js` (Player mode's routes) or `js/ui/modes/<mode>.js` (Coach mode's). A missing module shows a friendly "coming soon" card instead of crashing.

**Two modes** (docs/KID_REDESIGN.md §1): `settings.mode` is `'player'` (the default for everyone: the kid-first screens of §5.16, always in simple wording) or `'coach'` (the full app below, unchanged in substance: detailed wording, scores and grades, principle codes, Explore, Learn, Progress, Author, Live). Coach mode's settings menu has **More detail** (`settings.detail`: on = detailed wording, off = simple wording); the word "Kid" never shows. `settings.wording` is derived (`effectiveWording({ mode, detail })`: `'standard'` only in Coach mode with More detail on, else `'kid'`), so every module that reads it keeps working; an old `wording` patch sets `detail`. Switching: Player mode's settings sheet has "Coach or parent? Open Coach mode" (→ `#/coach`); Coach mode's header has **Back to Player mode** (→ `#/`). Pure helpers exported for tests: `parseHash`, `toHash`, `resolveRoute(parsed, { appMode, onboarded })` → `{ kind: 'player'|'coach', module, mode, params, redirect? }`, `navigateTo(target, { replace }, env)`, `normalizeSettings`, `mergeSettings`, `effectiveWording`, `MODE_INFO`, `PLAYER_ROUTES`, `settingsLinks`, `isDevMode`. Which header shows is `js/ui/player/shell.js chromeFor(route)`: the Coach header for Coach routes, Player mode's top bar for `#/` and `#/card`, none for the kick-off and the play screens (they bring their own way out).

```js
// every js/ui/modes/<mode>.js and js/ui/player/<name>.js
export async function mount(root /* a fresh <div class="view view--<mode>"> per route */, app, params /* string[] from the hash */) → (void | () => void /* unmount */)
// board modes use components.js stageLayout(root, {label}) → { board, panel: {root, head, actions, feedback (aria-live), body}, expand, collapse, toggle, destroy }

// app
{
  data: {
    principles: { list: Principle[], byId: {[id]: Principle} },   // data/principles.json
    curriculum,                                                   // data/curriculum.json
    tutorial,                                                     // data/tutorial.json
    resources,                                                    // data/resources.json
    formations: { us: Formation, them: Formation },               // both from helios-433 in v1 (the same instance)
    scenarios: { index: ScenarioMeta[], meta(id), load(id) → Promise<Scenario> },
  },
  store,          // js/store.js
  settings,       // { mode: 'player'|'coach' /* default 'player' */, detail: boolean /* Coach mode's More detail, default true */,
                  //   wording: 'standard'|'kid' /* derived: effectiveWording */, theme: 'auto'|'light'|'dark', reducedMotion: boolean,
                  //   role: LEARNABLE_ROLES /* Coach mode's position */, sound: boolean /* default true */ }   (persisted; unknown keys kept)
  setSettings(patch), onSettings(fn) → unsubscribe,   // listeners get (settings, changed); a mode or detail change reports wording too
  navigate(hash, { replace = false } = {}), route: { mode, params, kind: 'player'|'coach' },
                  // replace: true swaps the current history entry and routes at once: a screen that sends you on (a spot node
                  //   opened at '#/pass/<id>' goes to '#/play/<id>', and the other way round) leaves no address that Back would land on
  createBoard,    // js/ui/board.js, with { youLabel: the learner's nickname or 'YOU' } by default
  sound,          // extra (§5.13): js/ui/sound.js createSound({ enabled: () => settings.sound })
  celebrate,      // extra (§5.13): js/ui/celebrate.js createCelebrations(app)
  shell,          // extra: Player mode's top bar (js/ui/player/shell.js createPlayerShell): setChrome, refresh, openSettings, closeSettings
}
// app.data.road: data/road.json normalised (js/ui/player/road.js loadRoad), loaded at boot with the rest of the data (§5.16)
```

Routes (`#/<mode>[/<arg>...]`; a bad argument never dead-ends: it falls back to the mode's default view with a way on):

Player mode's routes (`js/ui/player/`, §5.16; they work in either mode):

| Route | View |
|---|---|
| `#/` | Player home (`home.js`): the big Play button, "Who's open?" and Match day, days played this week, the Road. With no position picked yet (profile `onboarded` false) the address becomes `#/kickoff`. In Coach mode `#/` is Coach home. |
| `#/kickoff`, `#/kickoff/pick`, `#/kickoff/kit` | the first open (`kickoff.js`): Play, "What do you play?", and after the first set "Make it yours" |
| `#/play`, `#/play/<nodeId>`, `#/play/first` | "Find your spot" (`play.js`): the next node, a node (locked or unknown: the next one; a pass node: `#/pass/<nodeId>`), the onboarding set |
| `#/pass`, `#/pass/<nodeId>` | "Who's open?" (`pass.js`): a quick set of mixed passing lessons, a Road pass node (a spot node: `#/play/<nodeId>`; locked or unknown: the quick set) |
| `#/matchday` | Match day (`matchday.js`), locked (with the way to open it) until chapter 1's Big Match has a star (`?dev` skips the lock) |
| `#/card`, `#/card/stickers`, `#/card/badges`, `#/card/kit` | your card (`card.js`) |

Coach mode's routes (`js/ui/modes/`):

| Route | View |
|---|---|
| `#/coach` (and `#/` `#/home` in Coach mode) | Coach home: pick your position, your path through the modules, the ways to play |
| `#/learn` (`#/learn/tutorial`) | the M0 tutorial (data/tutorial.json) |
| `#/learn/principles`, `#/learn/p/<ID>`, `#/learn/resources` | principle library, one principle (case-insensitive), reading list |
| `#/explore`, `#/explore/<ROLE>` | free play on a static scene (sets settings.role; role changes rewrite the hash with replaceState) |
| `#/drill`, `#/drill/<M1-M3>`, `#/drill/p/<ID>`, `#/drill/s/<scenarioId>` | a 6-rep drill session: first unfinished module, one module, one principle, one scenario then its module (`-m` suffix: mirrored; `_example` and other unindexed files load by id) |
| `#/live`, `#/live/<seed>[/<45\|60>]` | a live sequence; a fresh seed is written into the URL (replaceState) so a link replays it |
| `#/progress` | level, days played this week (and the best week), stars, positions, history (Player mode's passing reps say Passing), the way into the trophy room, export / import / reset |
| `#/trophies`, `#/trophies/badges`, `#/trophies/album`, `#/trophies/kit[/<paletteId>]` | the trophy room (§5.13): player card and tiles, badges, the sticker album, the kit locker (a palette id pre-selects that unlocked kit to try on) |
| `#/author`, `#/author/<scenarioId>` | the scenario editor |
| `#/credits`, `#/dev` | credits and licences; the engine playground |

A mode module that fails to load is retried once (a dropped connection), then shows a card with Try again (reload) and Back to home. (A browser remembers a module whose own import failed, so only the reload fixes a dependency the server dropped; `python3 -m http.server` drops one now and then under a cold load.)

Store keys (all under the `fotbol:` prefix): `settings` (main.js), `skills`, `history`, `streak`, `live` (session.js, §5.12), `tutorial` `{ completed, completedAt, done: stepId[], step }` (learn.js `normalizeTutorialProgress`), `explore` `{ found, best }` (explore.js), `rewards` (js/rewards.js state, ui/rewards-store.js; §5.13), `player` (Player mode's profile: `{ version, group, role, onboarded, road: { [nodeId]: { stars, plays, starts? } }, last: { nodeId, ids } | null }`, js/ui/player/road.js, §5.16: `plays` counts finished sets, `starts` sets begun, which a set's seed takes in, so a reload or a quit mid-set never deals the same reps again; `last` is the last set's drill ids, which the next recall rep never repeats), `player:today` (`{ day, ms }`: today's play time for Full time's break nudge, js/ui/player/fulltime.js), `author:draft` `{ version: 1, scenario, savedAt, origin: {id}|null }` (author.js). "Reset progress" clears `session.js RESET_KEYS` (the progress keys, `tutorial`, `explore`, `rewards` and `player`: after a reset the next open starts at the kick-off); settings, today's play time and the author draft stay. An import replaces the same keys (`IMPORT_KEYS`); `parseProgressFile` passes a file's rewards through `normalizeRewards` (a damaged entry reads as a fresh start, never a refusal). Every key degrades to its default when storage is blocked or corrupt (store.js), and the UI says when progress cannot be saved.

`js/store.js`:
```js
export function get(key, fallback)          // JSON from localStorage, try/catch, fallback on any error
export function set(key, value)             // try/catch; returns false on failure (values stay readable this session from a memory mirror,
                                            //   which wins over an older copy the backend may still hold for that key)
export function remove(key), keys(), isPersistent()
export function exportAll() → object        // everything under the 'fotbol:' prefix
export function importAll(obj) → { written, skipped, persisted }   // validates the prefix, then writes
```

### 5.10 analyse.js (the loop for one static scene)

```js
/** autoFrame → learnerBase → buildContext → computeGhost, once per scene (ball, possession, learner).
 *  opts: autoFrame options (learnerId required) plus { tags?: frame tags, context?: buildContext params, ghost?: computeGhost options } */
export function analyseScene(opts) → { frame, base, ctx, ghost }
/** evaluate → explain for one spot (a drag or a drop), with the ghost as the fix target and the ghost search's zone (its centre,
 *  i.e. the base or an authored ideal passed as ghost.base, and its tolerance), so a spot on the ghost scores the ghost's score.
 *  The ghost's own evaluation goes to explain too: on the ghost there are no reasons and no cue, and what it gives up is never one. */
export function judgeSpot(scene, spot, { wording, principles, rules }) → { result, feedback }
```

Explore mode and the dev playground (`#/dev`) call `analyseScene` when the ball or possession changes and `judgeSpot` on every drag; the end-to-end test and `scripts/sanity.mjs` use the same two calls.

### 5.11 sequence.js (Live mode)

```js
export const SEQUENCE_DEFAULTS    // every number [D] or [S]: pass speeds 12-20 m/s, carries 4-7 m/s, 2-4 turnovers, switch chance, ...
export function hashSeed(seed) → uint32;  mulberry32(a) → () => [0, 1);  createRng(seed) → a seeded random source
/** A seeded, deterministic 45-60 s sequence as an ordinary scenario (validateScenario() accepts it): id 'live-<slug(seed)>',
 *  module 'live', phase 'open_play', principles ['F2','F1','F3'], every player auto, answer.mode 'engine',
 *  source { kind: 'generated', generator: 'fotbol sequence v1', seed }. Ball keys: 'pass' when the ball is struck, 'carry' at the
 *  start of a carry; a tackle keys possession 'none' with a null carrier, then the winner. The learner never has the ball.
 *  Every pass (a turnover's aside, which is meant to be cut out) is chosen on the frame the viewer will see: the free playback of
 *  what has been written so far (states, blends and committed pressers as createPlayback; settle and separation as they are, not
 *  averaged), rated with passing.js rateOptions (their passes on swapTeams), a softmax over U at passTemperature times the length
 *  and forward preferences; a pass rated cut out is never played (with none safe the carrier runs with it; boxed in, the least
 *  bad pass). research/passing.md §5.4; tests/passdrill.test.js holds it (at most 5 % of passes would be cut out).
 *  PURE: no Math.random, no clock. */
export function generateSequence({ seed, duration = 45, role, formations, params }) → Scenario
/** ballEvents without 'carry', plus every possession change as 'turnover': Live scores a sample only when
 *  inGrace(graceEvents, t, eventGrace) is false. */
export function graceEvents(scenario) → [{ t, event }]
/** Incremental twin of timeline.frameAt: each state change (ranked on where the players are at its key) and each averaged
 *  settle-and-separation sample is computed once, when playback first needs it (a few autoFrame calls per call, so Live holds
 *  60 fps). With a fixed learnerSpot its frames equal timeline.frameAt (tests/sequence.test.js, 1e-9); with a moving learner each
 *  state change and sample uses the learner's spot when playback reached it. learnerId: null = the free frame. */
export function createPlayback(scenario, { formations, learnerId?, params? }) → { frameAt(t, learnerSpot?) → Frame }
```

Live (`js/ui/modes/live.js`) scores at `sampleHz` (10 Hz) off the render path: the frame from the held cursor with the learner where they are (`learnerSpot`: the others react to the learner, unlike a drill), the base from the free cursor (the learner role's blended auto spot, so the zone centre never jumps mid-play), then context, ghost and `judgeSpot`. Live runs never update Elo; they update the history, the day streak and the per-role best (an assisted run, with the best spot shown, or one ended early never sets a best).

### 5.12 reveal.js and session.js (shared UI)

```js
// js/ui/reveal.js: the feedback panel used by Explore, Drill, Live and the author preview.
export function createFeedbackPanel(container, { app }) → { el, showLive, showCue, showFull, clear, destroy }
//   showLive(judgement)                           every drag move: score, grade, hot/cold word and meter, the top line (text only)
//   showCue(judgement, { onReveal, focus = true }) beat 1: a cue question (feedback.cue, never the grade) and "Show me"
//   showFull(judgement, { onNext, onReplay, takeaway, misconception, principleLinks = true, nextLabel, replayLabel, focus = true, animate = true, reward })
//                                                 beat 2: count-up score, grade badge, reasons with principle chips, the fix, praise,
//                                                 takeaway and misconception notes (string or { standard, kid }); S = confetti unless
//                                                 reduced motion. Drill and Live pass principleLinks: false (a link would leave the
//                                                 session) and keep Replay / Next in the stage's action bar instead of onNext/onReplay.
//                                                 reward: a node shown under the grade (Drill and Explore pass a slot the
//                                                 celebration draws the stars and XP into, §5.13; none in Coach mode, which
//                                                 earns nothing).
//   judgement = judgeSpot() output; the board side (cue highlight, ghost, zone, heatmap) is the caller's job.
export const REVEAL_DEFAULTS, HOT_COLD_BANDS /* on fire ≥ 90, hot ≥ 70, warm ≥ 50, else cold */, GRADE_COLORS, GRADE_INK
export function hotCold(score), gradeColor(grade), pickText(v, wording), topLine(feedback), revealModel(judgement, opts) /* pure */
export function starRating(n, { max, label, size }), principleChip(principle, { wording, className })   // small DOM helpers
export function principleLabel(principle, wording) // kidName in Kid wording (when present), else short; revealModel's chips use it

// js/ui/session.js: PURE (the store, the day and the time are passed in).
export const SESSION_DEFAULTS   // reps: 6 per drill session, historyMax: 500, goodScore: 70, liveWorst: 3, liveWorstBelow: 90, ...
export const STORE_KEYS = { skills, history, streak, live }, PROGRESS_KEYS, RESET_KEYS /* + tutorial, explore, rewards, player */, IMPORT_KEYS /* = RESET_KEYS */, LEVELS
// persistence: normalizeSkills, loadSkills, saveSkills, loadHistory, appendHistory, loadStreak, saveStreak, updateStreak,
//   weekDays(streak, today) (days played this week, 0-7; currentDayStreak is its old name), dayKey, dayDiff, loadLive, recordLiveBest,
//   saveLive, exportFileName, parseProgressFile
// The streak record (store key 'streak'): { day: { current, best, last, days }, reps: { current, best } }. Days played this week
//   (R35) replace the day streak: a training day joins its Monday-to-Sunday week, a new week starts again at 1, nothing ever
//   "breaks"; loadStreak folds in the rewards' training days (so Player mode's play counts), and `best` is the most days in one
//   week. Coach mode's Drill summary says "N days played this week" and Progress "Days this week" / "Best week: N". The rep
//   streak (good reps in a row, Coach mode's Drill header) is unchanged.
// selection: parseDrillRoute(params), authoredRole, playAs(entryRole, role) → { mirror, role } | null,
//   candidatesFor({ index, role, module?, principle?, scenarioId?, anyRole? }) → refs { id ('<base>-m' when mirrored), baseId, mirror,
//   role, authoredRole, principles, module, difficulty, title }, extraCandidates(own, anyRole) (other-role refs, flagged extra),
//   repPool(own, extra, played) (your role's fresh scenarios, then other roles' fresh ones, only then repeats), pickScenario(skills,
//   candidates, { exclude }) (elo.pickNext), drillModules, moduleProgress, autoModule, weakestPrinciple, orientationFor
// scenario text and regions: wordingOf(value, wording, kidSibling), inRegion, misconceptionAt
// summaries: summarizeSession, summarizeLive (time-averaged score, the toughest moments below S, recovery time), levelFor,
//   roleAbilities, learningCurve, longestRun, targetRate
```

History entries: drill `{ t, mode: 'drill', id, baseId, title, module, principles, role, score, grade, dist, ms, confidence: 'sure'|'unsure'|null, misconception, mirrored, reasons: ruleIds }`; live `{ t, mode: 'live', id, seed, title, role, score, grade, assisted, duration, speed, recovery, onSpot, early }`. Elo keys items by `baseId` and uses the role actually played; a drill rep updates Elo with `score / 100` as partial credit and the scenario's `difficulty` as the prior. Player mode adds: its "Find your spot" reps as drill entries with `via: 'play'`, `nodeId` (a Road node or `'first'`) and `aid` (`'example'`, `'glow'` or null), with `baseId` the scenario's (a generated drill's: `gen-<principle>-<family>`, which Progress does not link); its passing reps `{ t, mode: 'pass', id, title, principles, role, score, grade, choice, outcome, best, ms, nodeId }` (Progress labels them Passing); Match day runs as live entries with `via: 'matchday'`.

### 5.13 Rewards (`js/rewards.js`, pure) and celebrations (`js/ui/celebrate.js`)

Game layer for younger learners (about age 11 and up), with the policy of docs/KID_REDESIGN.md §6.3: a rep earns 0-3 **stars** for how good the position was (`starsForScore`: 3 at 90 or more, 2 at 75, 1 at 55 [D]; Player mode shows them with one word, `wordForStars`: Spot on / Great / Close / Not yet, never a grade or a score), and **XP comes from stars and improvement only** (0/10/20/30 by stars, a bonus for beating your best on a drill, the first 3 stars on it, sticker cards and badges): nothing for taking part, finishing a set or session, the tutorial or time spent (R28). There are no leaderboards, no random prizes, and no streak that can break: training days only add up, and "days played this week" only fills up within a week (`weekDaysPlayed`, R35). The nickname is picked from a list (`NICKNAMES`; `setKit` keeps list values only, and imports drop anything else), so no real name is ever typed (R27). Store key: `'rewards'` (included in progress export/import).

- **Stars** (`REWARDS_DEFAULTS.starAt` [D]; equal to passing.js `STAR_BANDS`, tested): 1 at 55, 2 at 75, 3 at 90. A rep's stars are the ones its reveal showed, else its score's, else its grade's (`repStars`).
- **XP** (all [D]): 0/10/20/30 for a rep with 0-3 stars (`starXp`); +10 for beating your best on that drill by 10 points or more (`improveXp`, `improveMin`); +10 for a drill's first 3 stars (`firstThreeStarXp`); +10 per sticker card or upgrade (`cardXp`); a Live run or Match day 0/20/40/60 by its stars (`liveStarXp`); an Explore S find 10, at most 5 a day; each badge its own bonus (below). A set or session, the tutorial, taking part and time earn none (R28).
- **Levels** (`LEVEL_XP` [D]): level 2 at 50 XP, then 250, 700, 1600, 2550, 3550, 4600, 5700, 6850, 8050, 9300, 10600, 11950, 13350 and 14800 (level 16), and 1500 more for each level after that. Ranks (`RANKS`): Rookie from level 1, Academy 3, First Team 5, Captain 8, Legend 11. The pace (tests/rewards.test.js plays it through): five 1-star plays reach level 2; a strong first session (the 3-play first set, whose taught reps earn nothing, then two 5-play sets, mostly 3 stars) ends at level 3, never 4; six strong sets stay below First Team, which takes about eight strong sets or twice as many average ones; Captain and Legend take many weeks.
- **Badges** (`BADGES`, XP bonus in brackets; each for a skill, never for taking part or finishing): Spot on (a first 3 stars, 20), Hat-trick (3 stars three times in a row, 40), Top form (3 stars on 10 plays, 40), On a roll (a star five times in a row, 30), Perfect set (a star on every play of a set of 3 or more, 30), Comeback (2 stars on a drill you once got none on, 30), All-rounder (a star in all six outfield position families, 40), Live wire (2 stars in a Live run or Match day, 40), Red hot (3 stars there, 60), Collector (10 sticker cards, 40), Gold standard (a gold sticker, 30), Regular (5 days played, 0), Captain and Legend (the ranks, 0), and the `coachOnly` Kick-off (the tutorial, 0) and Explorer (5 S finds in Explore, 20), which Player mode's card hides until earned. Renamed badges keep their ids: Top form is `first-rep` (once "Boots on", a first play), Red hot `live-finisher` (once "Went the distance"), and `normalizeRewards` drops a version 1 record of either; Perfect set is `perfect-session` ("Perfect session" in detailed wording). Perfect set comes from the `session` event every Player-mode set sends at its end with its first tries' stars.
- **Sticker cards** (R25: mastery, not practice): after each counted rep the callers send a `mastery` event with the Elo's mastery stars for each of its ideas, and `award()` gives or upgrades the card only when `stickerReady(history, principleId)`: the idea's last `stickerWindow` (5) counting plays (Player mode's "Find your spot" and "Who's open?" first tries without an aid; `stickerReps`) number at least `stickerMinReps` (3) and average `stickerStars` (2) stars or more. A card is never taken back.
- **Coach mode earns nothing** (`earnsRewards(app)` is false when `settings.mode` is `'coach'`): it is for coaches and parents and shares the player's store, so `award()` returns `emptyGains()` there and saves nothing (the Elo, the history and the week's days still update). Its screens show no rewards UI and play no reward sounds or burst: no reward row in the Drill or Explore reveal, no rewards card on the Drill summary (never "+0 XP"), no floating celebration (Live, the tutorial), and Live's training-wheels note does not mention XP (tests/celebrate.test.js checks that every Coach screen with a reward hook asks `earnsRewards`). They still show the player's standing, read from the store: the header's level pill, Coach home's player card (with a note that playing in Coach mode never changes it), Progress's trophies tile and the trophy room. A Coach route opened in Player mode earns and shows rewards as before.

```js
// js/rewards.js: pure (no DOM, storage or clock; the UI passes the local day 'YYYY-MM-DD')
createRewards() → RewardsState    normalizeRewards(raw) → RewardsState   // sanitises imports and corrupt storage
applyEvent(state, event, { day }) → { state, gained }                    // immutable
//  event: { type: 'rep', scenarioId, role, score, grade?, stars? }   after each rep is judged (stars: the ones the reveal showed;
//                                                          else repStars from the score; Player mode passes one scenarioId per
//                                                          lesson and position family for generated drills: 'gen-D1-FB', 'gen-PA5-FB')
//       | { type: 'session', stars? | scores? | grades? }   when a set ends (Player mode: its first tries' stars) or a Drill session (its scores)
//       | { type: 'live', average }                         when a Live run ends
//       | { type: 'explore-s' }                             when Explore's "find the S spot" succeeds
//       | { type: 'tutorial-complete' }
//       | { type: 'mastery', principleId, stars }           after each rep, for each principle, with elo.mastery()
//  gained: { xp, stars (rep only), newBest, improved, badges: [id], cards: [{ id, tier, upgrade }],
//            levelUp: null | { from, to, rank, rankUp, unlocks: [paletteId] } }
levelFor(xp) → { level, rank, xp, levelXp, nextXp, progress }   LEVEL_XP (level 2 comes within the first set), RANKS
starsForScore(score) → 0..3, STAR_WORDS, wordForStars(stars), repStars(event)   starsFor(grade) → 0..3 (S 3, A 2, B 1: events with no score)
weekStart(day), weekDaysPlayed(state, today) → 0..7                    // days played this week (Monday start; only fills up)
BADGES, BADGES_BY_ID, badgeProgress(state), CARD_TIERS (1 bronze, 2 silver, 3 gold), cardTier(state, principleId)
KIT_PALETTES (light shirts only: colour-blind safe against --kit-them), kitOptions(state), paletteById(id), setKit(state, patch),
NICKNAMES (30 football nicknames), pickNickname(raw) → a NICKNAMES entry or '', cleanNickname(s)
```

Mirrored drills (`<id>-m`) share one best-score record with their original. `REWARDS_DEFAULTS`, `LEVEL_XP` and `RANKS` hold every tunable number.

```js
// js/ui/rewards-store.js: rewards in the app (the store, the clock, the page)
REWARDS_KEY = 'rewards'; REWARDS_EVENT = 'fotbol:rewards' (window event, detail { state }); KIT_VARS = { shirt: '--kit-us', edge: '--kit-us-edge', ink: '--kit-us-ink' }
todayLocal(now?) → 'YYYY-MM-DD' (local)       loadRewards(app) → normalizeRewards(store 'rewards')     daysThisWeek(app, now?) → 0..7
saveRewards(app, state, { notify = true })    // store, applyKit, then REWARDS_EVENT unless notify: false
refreshRewards(app)                           // after an import or a reset, and when a drill reveals a rep: re-apply the kit, fire the event
onRewards(fn) → unsubscribe
award(app, event, { celebrate = true, grade, host, card, now }) → gained   // applyEvent with todayLocal(), save, app.celebrate.show(gained, ...);
                                                                           //   Coach mode: nothing (emptyGains); a 'mastery' event waits for stickerReady
                                                                           //   a rep's gained also gets firstTry; never throws (logs, empty gains)
                                                                           //   celebrate: false = the caller shows it later (also holds back the event)
earnsRewards(app) → boolean                        // false in Coach mode (settings.mode 'coach'): every reward hook asks it first
emptyGains(), cleanGains(raw), mergeGains(a, b)   // one celebration for a rep and its stickers; a session's running total
kitVars(state), paletteVars(p), applyKit(state)   // classic clears the inline values (css/app.css defaults = the classic palette)
youLabel(state) → nickname | 'YOU';  shirtNumber(state, roleNum);  totalStars(state)

// js/ui/celebrate.js: every reward visual (restyle here)
createCelebrations(app) → { show(gained, { grade, host, card = true, quiet }), destroy }
//   host (an element): the row is drawn in place (the Drill and Explore reveals); quiet redraws it with no sounds or burst.
//   no host: a floating card under the header, one at a time (queued), auto-dismissed after showMs (3.5 s), paused while
//   hovered or focused, with a dismiss button (Live, the tutorial). card: false = sounds, burst and level-up only (the drill summary).
//   One celebration = the star row (the lit stars pop in one at a time, a 'star' tick each) and "+N XP", a short kid headline
//   ("Brilliant!"), "New best!" / "You improved!", and one chip per badge or sticker (≤ 6 words and an icon; "+N more" past maxChips).
//   An S grade or a level-up bursts confetti (DOM pieces, Web Animations; none under reduced motion). A level-up then opens the
//   level-up screen (openModal: focus trapped, Esc or the close button, focus returned): "Level up!", the level, big, the rank and
//   one button: "Try it on" → #/trophies/kit/<id> when a kit was unlocked, else "Keep going". Only that screen blocks play.
//   Announced once through its own polite live region (not again when the host is inside a live region, like the reveal).
celebrationModel, rewardChips, soundPlan, levelModel, pillModel, levelUpModel, starSlots, confettiPieces   // pure
starRow, rewardRow, kitToken, levelBar, playerCard, sessionCard, renderPill, starIcon                     // DOM builders
CELEBRATE_DEFAULTS, RANK_ICONS (rookie 🌱, academy ⚽, first-team 👕, captain 🧢, legend 🏆), TIER_ICONS (🥉 🥈 🥇)

// Player mode's celebrations (R29: a short acknowledgement per rep, a big celebration at most once a set):
PLAYER_CELEBRATE, playerStarPlan(stars) → [{ name: 'star', at, index }] (all done in under 0.6 s), playerAckMs(stars),
createBurstBudget(n = 1) → { take(), left }   // one per set, shared by the Player reveal (the set's first 3-star rep) and Full time
                                              //   (a level up or a gold sticker): confetti and the fanfare only while it lasts
playerMilestone({ stars, firstThreeOfSet, gained }) → 'level-up' | 'gold' | 'three-stars' | null
reducedMotion(app), confettiBurst(app, { anchor })   // no confetti under reduced motion

// js/ui/sound.js
createSound({ enabled, volume, win }) → { play(name, { index }?) → boolean, unlock(), ready, destroy() }
SOUND_NAMES = ['whistle', 'star', 'good', 'cheer', 'levelup', 'groan', 'lift']   // synthesised (oscillators, filtered noise); SOUND_DEFAULTS
//   groan: "Who's open?" when a pass is cut out; lift: when a pass breaks a line. Sounds never carry meaning alone (the pitch and
//   the words say it too), and none plays during Watch and Decide except the whistle at the freeze.
//   The AudioContext is made on the first user gesture while sound is on; no WebAudio (or any failure) → play() returns false.
```

In Player mode the rewards are awarded rep by rep with `celebrate: false` and shown by Full time (§5.16: stars, the XP bar sweeping, the node's stars, then each sticker, badge or kit colour one at a time, big: at most 3, biggest first, "More" stepping to the next and "+N more on your card" for the rest), and the top bar's level ring catches up then (`refreshRewards`); the reveal only pops the rep's stars.

Hooks (each a small named function in its mode, so the presentation can change without touching them; in Coach mode each does nothing and draws nothing, `earnsRewards`): Drill `rewardRep` (when a rep is judged: the rep with its played id, `-m` included, then a `mastery` event for each of its principles whose `elo.mastery` with the updated skills beats `cardTier`; `celebrate: false`) and `rewardSlot` (beat 2: the row under the grade, and the header pill catches up; beat 1 never gives the grade away), `rewardSession` and `sessionRewards` (the summary: the session event with the reps' scores, which earns no XP but may earn the perfect-set badge, then XP this session, the stars won (`starsForScore` of each rep's score, as the reps' awards counted them), the level bar and the badges and stickers of the session; an unfinished session keeps its gains); Live `rewardRun` (a run played to the end without the best spot on show); Explore `rewardFind` (a counted S spot, in the reveal); Learn `rewardCompletion` (once per completion). A drill freezing plays the whistle. The header's level pill (main.js) links to `#/trophies`; Home shows the player card; Progress links to the trophy room.

### 5.14 passing.js and passdrill.js (the on-ball decision: "Who's open?")

The formulas, the numbers (every one in `PASS_DEFAULTS`, tagged) and the prototype are in [research/passing.md](research/passing.md) §4. Canonical frame, us on the ball; rate their passes on `swapTeams(frame)`. Static frames: no velocities, no body shape.

```js
// js/engine/passing.js: PURE
export const PASS_DEFAULTS   // physics [S] (ballSpeed 15, reactionTime 0.7, maxSpeed 5, sigma 0.45), body block, tracking markers, youth execution, pressure oval [S], value, risk premium, labels [D]
export function rateOptions(frame, carrierId = frame.carrierId, params) → PassRating   // about 0.5 ms of CPU for 13 options (tested < 2 ms)
// PassRating = { carrierId, ball, vBall, lines: { front, mid, back, secondLast } /* their lines, median x */, offsideX /* = rules/offside.js offsideLineX (tested) */,
//                options: PassOption[] /* score, then worth, descending */, best /* = options[0] */,
//                fwdOn /* a good forward pass to a receiver who is not marked (pressure < fwdOnPressure 0.3) within forwardWindow of the best */, params }
// PassOption = { id: 'us-LCM' | 'us-LW@space', targetId, kind: 'feet'|'space', point, aim /* PA7 far-foot point */, receiverAt, len,
//   direction: 'forward'|'square'|'back', pSafe /* = pExec x pLane x pWin */, pLane, pExec, pWin, blocker: { id, pInt, at, via: 'block'|'run' } | null,
//   receiverPressure /* 0..1 */, presserId, room, bypassed, lineBroken: 'front'|'mid'|'back'|null, offside, acrossOwnGoal, value, valueGain,
//   U /* expected utility, goals: what Live (sequence.js) plays on */, worth /* U less the risk premium: what the rating ranks and scores by */,
//   score /* 0..100 int */, colour: 'green'|'amber'|'red', label: 'best'|'good'|'risky'|'cut-out'|'offside'|'danger', critical,
//   tags: [{ tag, principle, kind: 'problem'|'strength'|'direction', weight, who?, kidWho?, whoId? /* blocker, presser or rival */, to, kidTo /* receiver */, n? }] }
export function gradePass(rating, choiceId, { accept = [] } = {}) → { score, grade /* score.js gradeOf */, stars, outcome: 'completed'|'risky'|'cut-out'|'offside'|'danger', isBest, option } | null
export function explainPass(rating, choiceId, { wording = 'kid', accept = [], focus = [] } = {})
  → { headline, line, yours: { text, principleId, tag }, best: { text, principleId, tag, id } | null, more: [{ text, principleId, tag }] /* ≤ 2 */,
      cue: { text, highlight /* a rule-cue object, §5.5 */, principleId }, grade } | null
export function starsForScore(score), STAR_BANDS   // 3 ≥ 90, 2 ≥ 75, 1 ≥ 55 (KID_REDESIGN §6.3; equal to js/rewards.js starsForScore, tested once it exists)
export const PASS_TAGS /* tag → { principles, kind, weight, text: { standard, kid } } */, PASS_FALLBACK, PASS_HEADLINES, PASS_CUES
export function allPassTexts(wording) → [{ key, text }]   // every sentence the reveal can show, names filled in (tests/copy.test.js reads it)
export function value, valueOpp, lossCost, execProb, laneRisk, raceAt, markedBy, pressureAt, roomAt, goalAngle, oppLines, swapTeams, kidName, optionOf
```

- **Lane and race** (research/passing.md §4.2, with two corrections from the Player-mode review): to feet, the race to intercept is run only up to where the receiver meets the ball, but the body block covers the whole lane up to his last metre, so a defender standing in the receiver's run to the ball (in front of him, between the meeting point and him) cuts it out; one level with him or behind counts `runBehind` (3) times further off (that is pressure, not a block). Into space, a marker tracking the runner (`markedBy`: within `markReach` 3 m of him, fading over 2 m more, and level or goal-side of him on his run, fading once he is 1-3 m past) reacts with the runner (`markReaction` 0.3 s), not when the pass is played (0.7 s): a centre-back level with our #9 and 2 m from him contests the ball behind him (pWin about 0.5), one goal-side wins it (below 0.45).
- **Score:** `worth = U - riskWorth x pointValue x r`, r = 0 for a safe (green) pass, 1 to 2 for a risky (amber) one as its pSafe falls from 0.8 to 0.5, 2 for a cut-out one: a teaching prior (riskWorth 20 points; 20-40 star the same passes) so a risky pass is starred only when it is worth clearly more than the best safe one ("Risky, but worth it" in front of their goal). `score = 100 - (worth_best - worth) / pointValue` (1 point = 0.1 % of a goal), worth_best over the options that can be starred (not critical, and not cut out while any is not), so the starred pass scores 100; clipped to 0-100; a good (green) option never below 75 (`safeFloor`: two stars), a cut-out (red) one at most 45, a critical one (offside now, or a pass across the front of our own goal, PA10) at most 30.
- **Labels:** the top option `best`; critical ones `offside` / `danger`; `cut-out` when pSafe < 0.5; `good` when pSafe ≥ 0.8 and the receiver's pressure < 0.6; else `risky`. `colour` keeps green/amber/red for the best too (a risky best says "Risky, but worth it.").
- **Grading:** S for the best, a good option within `bestMargin` (5) of it, or an `accept` id; anything else at most 89; a risky one at most 74 (`riskyCap`); a safe square or back pass more than `tooSafeGap` (15) points below the best while a good forward pass to an unmarked receiver was on (`too-safe`, PA2) exactly 74 (`tooSafeCap`); stars by `starsForScore`. So the stars say what the label says: the best 3, a good pass 2 ("Great"; a safe-but-slow one 1, "Safe, but a forward pass was on."), a risky one at most 1, a cut-out one 0. The outcome is the most likely one: we grade the decision, not a dice roll.
- **Words:** simple (kid) lines are at most 14 words (tag sentences at most 12), name players by position words ("their midfielder", "your winger"), and never use codes or sides; standard lines name players with `rules/_util.js nameOf`. `headline` is the consequence (Cut out! / Risky! / Line broken! / Safe pass. / Offside! / Danger!). `yours` explains the choice (why it is best, or its main problem, or its strength); `best` the best one when the choice was not as good; a good choice with the same reason as the best says what made the best better. `focus` (a drill's `principles`) makes the best's line lead with a reason that teaches one of them. `cue.highlight`: the blocker, presser or rival as `{ type: 'player', id }`, the offside line or the line broken as `{ type: 'line-x', x }`, else the pass as a segment.

```js
// js/engine/passdrill.js: PURE, deterministic (sequence.js createRng, no Math.random)
export const PASSDRILL_DEFAULTS, PASS_LESSONS
export function generatePassDrill({ seed, role, principles = [], formations, catalogue, direction = 'auto', avoid = [], unlike = [], params, trace }) → PassDrill | null
  // avoid: receivers the best must not go to (roles or ids: 'ST', 'us-LW'); unlike: drills already in the set it must not look like
export function generatePassSet({ seed, count = 5, role, principles, formations, catalogue, params }) → PassDrill[]
  // 3 of every 5 with a forward best where the position has them; at most maxSameBest (2) to the same receiver; no two alike
export function passForwardable(principles, role) → boolean   // should a set on these principles hold forward bests for this role (generatePassSet's rule)
export function canGeneratePass(roleOrFamily, principles, { direction = 'any', min = 0.01 }) → boolean   // PASS_YIELD: cells a builder can skip
export const PASS_YIELD   // [M] { [principle]: { [family]: [any, forward] } }: the share of calls that give a drill (8 seeds; zeros on 32)
export function passDrillPicture(drill) → { role, ball, best /* receiver role */, kind, template } | null
export function similarPassDrills(a, b) → boolean   // the same position and the ball within nearBall (3 m), or the same best receiver within nearSameBest (15 m)
export function checkPassDrill(drill, { formations, principles, params, mirror = true })
  → { errors } | { errors: [], frame, rating, best, margin, choices, decoys, forward, lessons, problems }   // problems empty = a good drill
export function validatePassDrill(drill, { principles }) → string[];   passDrillGates(rating, { accept, keyed, params }) → { problems, margin, choices, decoys }
export function passDrillFrame(drill, t, { formations }) → Frame      // = frameAt(drill, t, { formations, learnerId: null })
export function passDrillPlayback(drill, { formations }) → { frameAt(t) }   // createPlayback with nobody held back
export function passDrillRating(drill, { formations }) → PassRating   // at the freeze
export function mirrorPassDrill(drill, { formations }) → PassDrill    // mirrorScenario + carrier and keyed answers mirrored + the rating recomputed
export function passLessons(rating, principles) → string[];   forwardSlot(seed) → boolean
export function passMoments(sequence, { formations, after = 0.4 }) → [{ t, carrierId, rating }]   // our receptions in a Live sequence
```

A pass drill is a ball-scripted scenario (§5.3) in which **the learner has the ball at the freeze** (so `validateScenario` alone would refuse it; `validatePassDrill` checks it):

```jsonc
{ "id": "pass-lcm-12-pa2-pa5", "kind": "pass", "title", "titleKid", "brief", "briefKid": "The ball is coming to you. Look around.",
  "question": "Who do you pass to?", "questionKid": "Who's open?", "takeaway": { "standard", "kid" },   // the primary principle's (catalogue)
  "module": "pass", "moment": "in_possession", "phase", "principles": ["PA5", "PA2"],                 // first = the lesson
  "learner": { "role": "LCM" }, "carrierId": "us-LCM", "carrier": "us-LCM",
  "timeline": { "duration", "freezeAt",   // = duration, 1.5-3 s: a teammate has it (maybe running with it), passes; the learner receives; ~0.5 s later the freeze
                "ball", "possession", "carrier": [{ "t": 0, "id": "us-DM" }, { "t": 0.65, "id": null }, { "t": 1.39, "id": "us-LCM" }],
                "players": { "auto": true, "overrides": [] /* the templates key their players */ }, "tags": [] },
  "answer": { "mode": "pass", "best": "us-ST", "accept": [], "space": false },
  "rating": PassRating,                   // at the freeze, JSON-safe: grade and explain without recomputing
  "misconceptions": [], "difficulty", "params": { "autoPress": false } /* a quarter of drills: nobody presses the learner */,
  "source": { "kind": "generated", "generator": "fotbol passdrill v1", "seed", "role", "principles", "direction", "attempt",
              "template": "switch"|"own-goal"|"marked"|"free"|null, "variantOf"? /* the teammate marked or left free */,
              "short"? /* m the learner came short */, "avoid"? } }
// id: pass-<role>-<seed>[-<principles asked>][-<direction>][-x-<roles avoided>][-a<attempt>, from the second attempt on]
```

- **Playing it (UI):** always with nobody held back: `passDrillFrame` or `passDrillPlayback` (with the default learnerId the learner is held at their spot and never reaches the ball). Grade with `gradePass(drill.rating, choiceId, { accept: drill.answer.accept })`, explain with `explainPass(drill.rating, choiceId, { wording: 'kid', accept: drill.answer.accept, focus: drill.principles })`. Mirror with `mirrorPassDrill` (`mirrorScenario` alone leaves the rating and the answer stale). Player mode (js/ui/player/pass.js) does exactly this: the watch plays on `passDrillPlayback`, the freeze is `passDrillFrame`, and the drill's stored rating is graded and explained (recomputed with `passDrillRating` only for a drill without one). Pass `catalogue: app.data.principles` so a drill's `titleKid` and `takeaway` are data/principles.json's.
- **Gates** (`checkPassDrill`; generation keeps only drills whose mirror passes too): the learner on the ball at the freeze; the best leads every other option by `margin` (8) points (accepted ids aside; a too-safe option counts at its graded cap, 74); the best not cut out; at least 3 options not cut out; a decoy (a cut-out pass to a teammate who looks free, or a too-safe one); a keyed `answer.best` within `bestMargin` of the engine's best; passes at most 20 m/s and carries at most 7 m/s; the stored rating not stale.
- **Generation:** the learner receives in their zone (their in-possession spot for a random ball) from a teammate 8-24 m away (measured with the learner where their shape puts them with the ball at the passer), aimed at their in-flight spot; the freeze frame is rated. The drill must teach a principle asked (`PASS_LESSONS`): a reason of the best pass (PA3 free, PA5 a line broken, PA6 switch, PA8 into space, PA9 can turn, PA11 zone 14 or a pull-back, PA13 keep it) or a trap among the others (PA2 too-safe, PA4 a free-looking teammate who would be cut out, PA10 across our own goal, PA12 a long pass). With none asked, any. PA1 is every drill's watch; PA7, PA14 and PA15 (v2) give null. Templates: `switch` (PA6; centre-backs, #6, #8: their block slid toward the ball side, one presses, others mark our ball-side options and screen the square pass; the far side free) and `own-goal` (PA10; a centre-back at the corner of our box, their #9 lurking in front of goal).
- **Who's open, varied:** the shape puts a position's teammates and markers in much the same places every time (a full-back's winger free down the line 3 times in 4), so a natural scene's picture is varied (`varyScene`, `source.template`): `marked` (40 %: the opponent nearest the plain best's receiver comes to stand 1.6 m from him, goal-side and a little ball-side, so that pass is no longer on) or `free` (30 %: the opponents within 5 m of a teammate ahead of the ball, or level with it, step 7 m away from him, to the spot nearest where each started, out of the pass to him); the movers walk there during the lead-in (override keys at 0 and the reception, at most 7 m/s). A winger or #9 comes short to get the ball in 35 % of natural scenes (6-12 m toward the passer and our goal; the learner's override ends where the pass arrives), so they also have it in the middle. A candidate varied scene that fails the cheap checks falls back to the plain one (never when the plain best is avoided); `avoid` forces `marked` on an avoided plain best (then `free` on someone else), and a forward slot whose plain best is not forward forces `free` on a teammate ahead. `fastFail` (default on): a call `canGeneratePass` says no to gives null at once.
- **The "always pass back" trap:** `direction: 'auto'` wants a forward best (or a switch) on 3 of every 5 consecutive integer seeds (`forwardSlot`), unless no principle asked can be taught by a forward pass for the role (PA13; PA10 except for a centre-back). Build a set from consecutive integer seeds, or with `generatePassSet`. The Road (js/ui/player/road.js, §5.16) builds its pass sets from consecutive integer seeds with an explicit `direction` per rep (3 of 5 `'forward'` where `passForwardable` allows), so it can fall back per rep: a teammate in the position group, then the neighbouring groups, then any pass, then another passing idea of the chapter.
- **Varied sets (the "pass to 9" trap):** a winger's only forward receiver is nearly always the #9, so forward slots alone would star him 3 times in 5. `generatePassSet` stars no receiver (by role) more than `maxSameBest` (2) times: a slot passes `avoid` (the roles already starred twice) and `unlike` (the drills so far) to generatePassDrill, and a forward slot that cannot find a new receiver takes any direction, so a winger's set holds 2 forward bests. A set can come back short when an idea has too few receivers (a winger's "Play It Forward": the #9 twice). A set builder calling generatePassDrill itself should do the same: `avoid` the roles already starred twice and pass the set as `unlike` (a skipped scene costs one scene, not a call), and use `passDrillPicture`/`similarPassDrills` for its own checks. The Road's pass sets (road.js) do not yet: they ask 3 forward bests of 5 and keep two reps with the same best receiver apart only when the ball is within 5 m (`nearDuplicate`), so a winger's forward bests nearly all go to the #9 and a full-back's to his winger (ROADMAP known issues).
- **Measured** (Node 24; `PASS_YIELD`: the share of calls giving a drill on one principle, 8 seeds a cell, the zeros re-checked on 24 more): PA3, PA4 and PA12 for every position on nearly every seed (with a forward best: wingers and the #9 63-100 %); PA2, PA5 and PA9 50-100 %; PA8 (into space): the #6, #8s, wingers and #9 50-100 %, centre-backs 13-25 %, full-backs 0; PA6 (switch): centre-backs 63 %, the #6 13-25 %, the #9 13 % (any), full-backs, #8s and wingers 0; PA10: the back four 100 %, the #6 13-25 %, the others 0; PA11: the #6, #8s and #9 100 % (any), wingers 63 %, the back four 0; PA13: 63-100 %, never as a forward best (the #6's switch across the back aside). A drill takes 5-70 ms of CPU, a call that fails 120-150 ms (40 scenes), one `canGeneratePass` says no to nothing. Five drills from consecutive seeds: 50-200 ms; a varied set (`generatePassSet`): 100-900 ms.
- **The review's measures** (12 seeds x LW, RW, LB, #6, LCM, #9, LCB, direction 'auto'; before → after): the best a safe (green) pass 45 of 82 → 76 of 84; the best a ball into space behind a runner whose marker is level with him or goal-side within 3 m 13 → 0; a winger's best to the #9 (direction 'any') 13 of 24 → 5 of 24; a safe pass to a free teammate 2+ stars 77 of 169 → 105 of 163 (all 105 that are not too safe); the most open teammate within 25 m 2+ stars 43 of 74 → 54 of 74. tests/passdrill.test.js holds these bounds; tests/road-sets-*.test.js sweeps every Road node for every position group with these generators.

### 5.15 spotdrill.js (generated "Find your spot" drills)

```js
// js/engine/spotdrill.js: PURE, deterministic (sequence.js createRng)
export const SPOT_DEFAULTS      // the gates = scripts/check-scenarios.mjs CHECK_DEFAULTS (tested), minRuleWeight 2, minRuleScore 0.9, the carrier
                                //   on the ball (carrierGap 1.5 m, carrierSpeed 2 m/s), timings; speeds = SEQUENCE_DEFAULTS (tested)
export const SPOT_PRINCIPLES    // { [principleId]: { rules, moments: ['us'|'them'] } }: every principle with a rule (from the registry)
export function generateSpotDrill({ seed, role, principles = [], formations, catalogue, params, trace, avoidTemplates = [] }) → Scenario | null
  // avoidTemplates: question template ids a set builder has used (the drill is the same; its question another one that fits)
export function checkSpotDrill(scenario, { formations, principles /* catalogue */, want, params, quick = false })
  → { errors } | { errors: [], t, frame, base, ctx, ghost, start, moved, startScore, taught: [{ principle, rule, weight, s, sStart }], problems }
  // quick: stop at the gates that need no ghost (a generator's failed try is cheap); then ghost, start and startScore are null
export function canGenerateSpot(roleOrFamily, principles, { min = 0.01 }) → boolean   // SPOT_YIELD: cells a set builder can skip
export const SPOT_YIELD   // [M] { [principle]: { [family]: share of calls that give a drill } } (8 seeds; zeros on 32)
export const SPOT_WORDS /* brief, briefKid, templates: { [id]: { when, kid(v), standard(v) } }, question(holder, id, x), questionKid(...) */
export function allSpotTexts(wording) → [{ key, text }]   // every question and brief, names and areas filled in (tests/spotdrill.test.js)
export function spotPrinciples()
```

- **The scenario** is the authored format (§5.3; `validateScenario` and `npm run check`'s `checkScenario` pass it): id `spot-<role>-<seed>[-<principles asked>]`, module `generated`, `answer: { mode: 'engine' }`, `learner: { role, start }` with `start` the learner's own automatic spot at t = 0 (before the event), one misconception `stood-still` (2 m round the start), `difficulty` from the principle's level, `title`/`titleKid`/`takeaway` from the catalogue (else the rule's names), `brief`/`briefKid`/`question`/`questionKid` from templates (no side, no code), `template` (the question template's id), `source: { kind: 'generated', generator: 'fotbol spotdrill v1', seed /* the seed used */, requestedSeed, attempt }`.
- **The words:** a brief by the event (they/we pass, run with the ball, or play a long pass to the other side: 25 m or more across) and a question from a template that fits it, picked on its own seeded stream: `has-ball` ("Their defender has the ball. Where do you go?"), `has-ball-area` ("... has the ball near our goal / in the middle / near their goal. ..."), `goes-to` ("The ball goes to their winger. Where do you go now?", a pass), `runs` ("Their midfielder runs with the ball. ...", a carry), `long-pass` ("A long pass finds their winger. ..."), `wide` ("... has the ball out wide. ...", within 10 m of a sideline), `close` ("... has the ball close to you. ...", within 10 m of your start). The holder is the player on the ball at the freeze. `avoidTemplates` lets a set builder keep a set from asking the same question twice (the Road passes the questions its set asks already on every call, §5.16); `allSpotTexts` lists every one (≤ 12 words, reading age 9, tested).
- **The event:** the team on the ball (theirs for a defending principle, ours for an attacking one) holds it 1-1.5 s, then a pass (12-20 m/s, to the player nearest the end spot while the ball travels, within `receiveReach` 10 m of it, aimed where they are when it arrives, so they meet it and are on the ball at the freeze) or a carry (4-7 m/s) leaves it where the focus principle's rule applies (a few metres in front of the learner for the press, beside them for cover, in the far wing lane for tuck, wide in the final third for crosses, anywhere for the rest). The freeze comes 0.4-1 s after the ball arrives; from 0.4 s after it, 1.5 s more play (the holder runs on) for "See what happens", which never changes the frozen picture.
- **Gates:** `npm run check`'s (the ghost scores S, it is at least 5 m from the start, standing still scores below 70, the answer is outside the misconception), plus a rule of a principle asked weighted at least 2 and scoring at least 0.9 at the answer (that principle becomes `principles[0]`; the rule the start fails most wins), the moment and the learner's duty match (never on the ball), realistic speeds, and **the player the question names on the ball at the freeze**: within `carrierGap` (1.5 m) of it and moving at most `carrierSpeed` (2 m/s) over the last 0.2 s (before, a pass aimed at the end spot of a receiver 10 m away left "Their defender has the ball" with the ball 3-15 m from him, still running at 6 m/s, in 10-21 of 40 drills per position and idea). The gates that need no ghost (the moment, the duty, the carrier, a rule of the ideas asked that weighs 2+ here, the speeds) run first; a generator's try stops there (`quick`). A failed try moves to the next of the seed's own stream (`'<seed>#k'`; `seed + k` made seeds 1 and 2 share drills) up to `maxAttempts` (30).
- **Yield** (`SPOT_YIELD`: the share of calls giving a drill on one principle, 8 seeds a cell, the zeros re-checked on 24 more): press D1/D2 and compact and slide U1/U2 100 % for everyone; marking D5 the back four and #8s 100 %, the #6 63 %; cover D3 the #6, #8s and #9 88-100 %, centre-backs 88 %, wingers 13 %, full-backs 0; tuck D4/U5 and the line U4 the back four; support B3/B4 63-100 %; B5 50-100 %; between the lines P2 the #8s 75 %; width B1 the wingers, pin B2 the #9, screen R3 the #6 (100 %); crosses P10 and offside F4 the #8s, wingers and #9. About 5-80 ms of CPU a drill; a call `canGenerateSpot` says no to returns at once.
- **Cannot be generated:** principles with no rule (T2, T3, U3, U6, U7, U8, R1, R2, B6, P1, every PA) give null at once, and so does a cell `SPOT_YIELD` measured at 0 (`fastFail`; `canGenerateSpot(role, principles)` says which up front): F8 (spacing weighs 1) for everyone, and a rule for a position it never judges or an event that never sets it up (width for all but wingers, pin for all but the #9, screen for all but the #6, between the lines for all but the #8s, tuck and the line for all but the back four, crosses and offside for the back four and the #6, cover for full-backs). The Road's spot nodes each hold at least one generatable principle, but not always for every position: "Pack the Middle" (R3, U7, T2) generates only for the #6, crosses (P10) not for defenders or the #6, width and pin (B1, B2) only for wingers and the #9. There the Road's sets lean on authored drills in other positions and the chapter's other ideas (§5.16), skip what `canGenerateSpot` rules out, and a generator that comes back empty twice is not asked again in that set.

### 5.16 Player mode (`js/ui/player/`)

The kid-first screens of docs/KID_REDESIGN.md (the spec: §0 rules, §2 routes, §3 the Road, §4 screens, §8.1 shared contracts). Every module exports a `STRINGS` object with all of its visible words (functions allowed for templates), which `tests/copy.test.js` holds to the Player-mode copy rules (word budgets, reading age, no codes, grades, "/100", metres or "kid"); none touches `document` or `window` at import time, so Node imports them all. Each screen module has the §5.9 `mount` contract.

```js
// road.js: the Road (data/road.json), the player profile (store key 'player'), set building. Pure except the store, the fetch and buildSet's defaults.
ROAD_DEFAULTS   // reps 5, firstReps 3, recall 1, unlockStars 1, starBands [[2.5, 3], [1.8, 2], [1, 1]], generatorTries 3, generatorNulls 2,
                //   forwardPasses 3, nearSpot 5 m, nextStars 2, maxBorrowed 2, lastIds 10
loadRoad(app?) → Promise<road>, normalizeRoad(raw) → road (bad entries dropped; nodes tagged with chapter and repKind; mix nodes get their
  chapter's principles; `lead` and `quickPass` checked against the chapters and pass nodes), bindRoad(app) (main.js at boot: buildSet's
  defaults are the app's store, formations, road and principles)
createProfile(), normalizeProfile(raw), loadProfile(app), saveProfile(app, profile) (fires PROFILE_EVENT 'fotbol:player'), onProfile(fn),
  pickGroup(profile, group, road?) (the group, its starting role: DEF LB, MID LCM, WING LW, STRIKER ST; onboarded)
roadNodes(road), nodeById, chapterOf, chapterOrder(road, group) (the group's `lead` chapter first), repKind(road, node) → 'spot'|'pass',
  nodeHref → '#/play/<id>' | '#/pass/<id>', groupOfRole(role)
nodeStars(profile, id), nodePlays, nodeAttempt (sets begun: `starts`, or `plays` for an older profile), isUnlocked(road, profile, id) (the
  first node, a node you played, the one before has a star, or its chapter's opensAfter node has one: "Help the ball" and "Pass it right" open
  after Close Them Down), nextNode (in chapterOrder, the first open node under nextStars (2) stars, then under 3, else the last open one),
  matchdayGate(road), isMatchdayUnlocked (road.matchday.unlockAfter: chapter 1's Big Match has a star), roadModel(road, profile) (what home
  and the card draw)
setStarsFor(repStars) → 0..3 (the average: 3 at 2.5, 2 at 1.8, 1 at 1), recordSet(app, nodeId, repStars) → { before, after, setStars, plays,
  unlocked: nodeId[], matchday: boolean }   // node stars = max(before, set stars); 'first' and unknown ids are not recorded
startSet(app, nodeId, reps) → attempt     // the node's `starts` + 1 and `last` = these reps' ids (buildSet calls it when given the app)
buildSet(node, { road, profile, index, load, rewards, skills, seed, formations, catalogue, generators, count, app }) → Promise<rep[]>
  // rep = { kind: 'spot', scenario, mirrored, nodeId, recall?, generated?, borrowed?, spare?, extra?, twin?, repeat? }
  //     | { kind: 'pass', drill, nodeId, borrowed?, spare?, extra? }
  // the seed takes in nodeAttempt, so every set of a node (and one begun again after a reload or a quit) is new
buildFirstSet({ ... }) → Promise<rep[]>        // '#/play/first': 3 easy reps for your group, your role first
buildQuickPassSet({ road, profile, seed, formations, catalogue, generators, count }) → Promise<rep[]>   // '#/pass': road.quickPass's
  //   lessons in turn (the free player, the odd rep, and playing forward), built as a pass node's set; each rep has `lesson` (its node id)
recallSources(road, profile, node), forwardPlan(ok: boolean[], count = 3) → Set<slot>, ballAtFreeze(scenario), repPicture(rep),
  nearDuplicate(a, b), repLooks(rep), carrierAtFreeze(scenario), hash32, seededRandom (pure); NEIGHBOUR_GROUPS, QUICK_PASS, QUICK_PASS_NODES
STRINGS.groups   // Defender, Midfielder, Winger, Striker
```

- **Spot sets** (5 reps, deterministic for a seed): 1 recall rep (not in a mix set) from an earlier spot node you played (R23: never this node or its ideas, never a rep of your last set, and from another node than your last set's when there is one), then authored scenarios on the node's ideas played in your position (mirrored to your side), then in another position of your group, then generated drills for your position (spotdrill.js, with the catalogue), then authored ones in other positions; a mix node takes its chapter's nodes in turn. Your last set's drills come only after all of those. Still short: the chapter's other ideas the same way (`extra`); only then mirrored twins and repeats (never needed on the Road). **Pass sets**: authored pass drills (index entries with `kind: 'pass'`; none yet), then generated ones (passdrill.js) from consecutive integer seeds, 3 of 5 asked for a forward best where `passForwardable` allows (§5.14; the forward slots are filled first); a rep your position rarely gets is played by a teammate in your group (`borrowed`: a full-back's "free side" is the centre-back's switch; the card says "Now you're the left centre-back"), then the neighbouring groups (`NEIGHBOUR_GROUPS`: a striker's forward pass is a winger's), then (a forward slot) any pass from you or your group, then another idea of the chapter (`extra`, in your own position), then anyone. Every set: no drill twice (a drill and its mirror count once); no two reps that look the same (`nearDuplicate`: same position, the ball within 5 m at the freeze and the same start, or the same best pass; a pass received within 2 m); no two generated reps from one engine template or with the same player on the ball at the freeze (`repLooks`: "Their winger has the ball" once); at most `maxBorrowed` (2) reps in another position, more (`spare`) only when nothing else in yours is left. Each spot generator call is told the questions the set asks already (`avoidTemplates`: the same drill, other words), so a drill is turned away for its question only when no other question fits it. Nothing is asked of a generator that its `canGenerate*` helper rules out, and one that comes back empty twice (more than it gives) for a position and its ideas is not asked again in that set. The generators are imported lazily and awaited between calls with a breath for the page. Measured (Node 24 on a laptop, the real generators, every node for every group, seed 1 and the set begun again: 152 builds): spot sets median 28 ms, 90th percentile 240 ms, slowest 0.5 s; pass sets median 160 ms, 90th percentile 670 ms, slowest 0.9 s (a defender's "Find the Free Side"). `tests/road-sets-*.test.js` sweeps every node for every group with the real generators.
- **Records** (play.js `recordPolicy`): a counted first try at a "Find your spot" rep updates Elo (not for the worked example and glow-aided reps), the history and the week's days as a drill rep does (drill.js), then awards the rep (`stars` as shown) and any sticker its mastery earned, `celebrate: false`; the first set's taught reps earn no XP (R28). Try again is practice only (in both games): nothing is recorded, it never celebrates, and the slot keeps its first try's stars, so copying the ring you were just shown is never worth more than getting it right first time. A pass rep's first try does the same with `passRecordId` (`gen-<principle>-<family>` for generated drills). A set ends with a `session` rewards event (its first tries' stars: "Perfect set"), `recordSet` (Road nodes only) and `showFullTime`. Leaving a "Find your spot" set early (the X, Back, anything) keeps what was played, with no "are you sure?" (R37): the reps locked in so far go on the Road as a shorter set, and the play time counts toward the break nudge (R22); a "Who's open?" set left early keeps each rep's records but puts nothing on the Road. Match day runs are scored as Coach mode's Live (§5.11) and awarded once played to the end.

```js
// reveal.js: the Player reveal, shared by play and pass (KID_REDESIGN §4.3 steps 6-7)
createPlayerReveal(container, { app, budget? }) → { el, show({ stars, word, line, why: { title, summary, reasons, praise }, onNext, onRetry?,
  onReplay?, replayLabel?, note?, nextLabel?, celebrate? /* default false */ }), clear(), destroy(), setBusy(on), budget (getter) }
  // stars pop in under 0.6 s (a tick each); confetti and a cheer only for a rep the caller lets celebrate (celebrate: true: a counted
  // first try, never practice or the worked example), the set's first such 3-star rep, while the budget allows (one per set; burstFor);
  // Why? opens a sheet of at most 60 words (whyModel); everything is tap-paced, never on a timer (R16)
whyModel(why), burstFor({ stars, celebrate, celebrated }) (pure), revealWordCount(...), REVEAL_DEFAULTS { lineMaxWords 14, beforeWhyMaxWords 30,
  whyMaxWords 60, whyReasons 2, whyPraise 1 }

// fulltime.js: the end of a set, shared by play, pass and Match day (KID_REDESIGN §4.5)
showFullTime(root, app, { node, reps: [{ stars, title }], xpBefore, xpAfter, gained, nodeStars: { before, after } | null, onHome, onAgain,
  title?, extra?, homeLabel?, budget?, playedMs?, now? }) → cleanup
  // the star rows and total, the XP bar sweeping (a level up fills it and starts again), the node's stars before → after, then each
  // sticker, badge and kit colour one at a time, big: at most maxItems (3), biggest first, "More" stepping to the next (never a second
  // "Next"), then "+N more on your card" (a link to #/card) for the rest (R29); "Best move: ..." (a rep with 2 stars or more); after about
  // 15 minutes of play today (store key 'player:today', addPlayTime / playMinutesToday) "Good work today. Take a break?" (R22). Home is
  // the main button; Play again is neutral (onAgain: null hides it).
fullTimeModel(...) → { rows, total, xpGain, levelUp, items, moreItems, best, nodeStars, ... }, earnedItems(gained), bestMoveName, addToday,
  minutesOn, breakDue, sentenceCase (pure), TODAY_KEY, FULLTIME_DEFAULTS (maxItems 3, bestMoveStars 2, breakAfterMin 15)

// play.js ('#/play', '#/play/<nodeId>', '#/play/first'): "Find your spot" (KID_REDESIGN §4.1 step 3, §4.3)
//   set (the role card; "Now you're the striker" when the rep's position is not yours) → watch (spotlight: YOU, the ball and up to 4 key
//   players lit) → freeze (the whistle, the question ≤ 12 words) → place (drag, tap YOU then a spot, or the keys; "Watch again"; the glow
//   aid on a node's first reps the first time through) → Lock it (or Enter; YOU picked up but not moved: the tip again, not a lock at the
//   start: lockAction) → the reveal (the ring with "Best spot" written on the side away from YOU, an arrow, at most one labelled cue,
//   stars, one word, one line ≤ 14 words; Next / Why? / Try again after 0-1 stars: the mirrored twin, "Same play, other side", practice
//   only / See what happens). The first set: rep 1 a worked example (the hand; under reduced motion the ring and an arrow while YOU can
//   already move), rep 2 the glow, rep 3 on its own, then Full time and '#/kickoff/kit'. "Hard one. Pros miss it too." once a set after a
//   miss (R20). A pass node opened here goes to '#/pass/<id>' (redirectTo: navigate with replace). Leaving keeps the set (Records above).
//   Playback advances with the clock (at most 1 s a frame) and restarts it when a hidden tab comes back.
PLAY_DEFAULTS, usableText, starsForScore, wordForStars, questionFor, briefFor, takeawayFor, ideasOf, praiseOf, pickLine, whyFor, bestMoveOf,
cueMarker, bestSpotMarker, recordPolicy({ counts, aided, example, retry, firstSet }) → { practice, elo, streak, rewards, mastery, history, tally,
celebrate }, lockAction, repCard, keyPlayers, firstSetStep, setStep, createTally, tallyTry, tallyStars, missNote, repTitle, seedFor, recordIdOf,
repScene, revealFor (pure), redirectTo(app, hash)

// pass.js ('#/pass', '#/pass/<nodeId>'): "Who's open?" (KID_REDESIGN §4.4)
//   set ("You've got the ball", or "Now you're the ..." for a borrowed rep) → watch (2.5 s on passDrillPlayback) → choose ("Pick the best
//   pass."; the teammates are big numbered targets, but not one further than farPass (45 m) from the ball nor the keeper unless that pass
//   is really on: passTargets; a first tap previews a dotted pass line, a second tap or Pass plays it; Enter/Space and Escape on a target) →
//   the ball travels ("Cut out!" + groan and the defender flashes, "Line broken!" + lift, "Safe", "Risky!", "Offside!", "Danger!") →
//   the reveal (the pitch crops to the play, and a phone held upright zooms in on it, never under reduced motion: revealFocus, revealZoom;
//   Best, your pick and up to 2 others labelled with a shape and a colour, ★ Best, ✓ Good, ! Risky, ✗ Cut out / Offside / Danger, each on
//   the side of its player where nobody stands: revealPicks, labelSide; the lanes of your pass and the best, blockers ringed; stars, a
//   word, one line from explainPass (a safe pass that was not the best names the better one: betterLine); Why? titled with the rep's
//   lesson when the explanation is about it; Try again after 0-1 stars: the same freeze, practice only). A spot node opened here goes to
//   '#/play/<id>' before any set is built (navigate with replace). Animations are backed by timers (a hidden tab never stalls a rep).
PASS_DEFAULTS, LABELS, labelStyle, outcomeKey, passOutcome, starsOf, wordFor, receiverOf, optionsByReceiver, genuinelyOn, passTargets,
revealPicks, labelSide, orderTargets, rankOptions, shirtOf, carrierOf, roleOfDrill, aimOf, revealMarkers, revealZoom, revealFocus,
previewMarkers, flashMarkers, passFlight, flightFrame, repFocus, pickLine, betterLine, whyFor, repTitle, questionOf, briefOf, historyEntry,
passRecordId, hashString, nodeSeed, roleFor, generateReps, assembleSet (pure, deps passed in)

// matchday.js ('#/matchday'): simplified Live (KID_REDESIGN §4.6): 45 s of generateSequence play scored at 10 Hz as Live; the ring on YOU and
//   one big word with a shape (Hot: a flame, Warm: a sun, Cold: a snowflake), no numbers; Pause (Space; a hidden tab pauses);
//   Full time with the run's stars, word, best hot streak and "See your hardest moment" (frozen, the ring and an arrow, "Watch it").
MATCHDAY_DEFAULTS, heatFor(score), bestHotStreak(samples), hardestMoment(result) (pure)

// shell.js: the top bar (your token and nickname, the level ring and rank, the card, the settings cog: Sound, Theme, "Coach or parent?
//   Open Coach mode"), which header a route shows, the Player "coming soon" and "couldn't start" cards, the icons
chromeFor(route) → 'coach'|'player'|'none', playerTitle(module), topBarModel({ rewards, profile, settings }), createPlayerShell(app, { bar }),
PLAYER_ICONS, playerIcon(name), levelRing(level, progress), soonCard(), failedCard()
// home.js ('#/'): the Play button ("Next: <node> · 5 plays"), the two tiles, days played this week (dots that only fill), the Road (only the
//   current chapter's title is written, and the Big Match's under its node, so the home stays within 25 words). Match day locked: the
//   tile says "Finish" with the Big Match's trophy, and a tap scrolls the Road to that node, which pulses.
//   homeModel({ road, profile, rewards, today }), homeWords(model) (the 25-word check), weekCount (pure)
// kickoff.js ('#/kickoff[/pick|/kit]'): the pitch replaying behind the wordmark, Play, "Coach or parent?"; four shirts; "Make it yours"
// card.js ('#/card[/stickers|/badges|/kit]'): the FC-style card (skill ratings 0-99 per chapter from Road stars and Elo), the sticker album
//   by chapter, badges, the kit locker (kitEditor, shared with "Make it yours"; nickname from NICKNAMES), "Your stats stay on this device."
//   skillRatings, cardMetal, stickerAlbum, badgeList, nicknameList (pure)
// strings.js: the shared words: STAR_WORDS, ROLE_NAMES (plain position names), roleName, starWord, roleCard(role, profileRole), STRINGS
```

## 6. Adding things

- **A new rule:** add `js/engine/rules/<id>.js` with the contract above, register it in `rules/index.js`, reference its principle IDs (and add the rule to those principles' `ruleIds` in `data/principles.json`, to the RESEARCH 5.5 table and to `RULE_REFS` in `tests/content.test.js`), and add tests in `tests/rules-attacking.test.js` or `tests/rules-defending.test.js` (a passing spot, a failing spot, and not-applicable). Then run `npm test`: `tests/integration.test.js` checks that every canonical situation still gives an S-grade ghost, and `node scripts/sanity.mjs > docs/sanity-output.txt` shows what changed.
- **A new scenario:** author it in `#/author` (or by hand from `_example.json`), download it and save it as `data/scenarios/<id>.json`, add the id to its module's `scenarios` in `data/curriculum.json`, run `npm run index` (never edit `index.json` by hand), then `npm run check` (validates it, prints the engine's answer and fails the drill-quality gates of §5.3) and `npm test` (`tests/scenarios-content.test.js` checks the copy rules, the mirror and the primary principle's rule).
- **A new formation:** add a table under `data/formations/`, same shape as `helios-433.json`. Phase-specific tables (in and out of possession) would replace `phaseShape()`.
- **A new Road node** (Player mode): add it to `data/road.json` with 1-3 principles and a title of 4 words or fewer. A spot node needs authored drills on its ideas (or ideas `spotdrill.js` can generate for most positions); a pass node needs ideas `passdrill.js` can teach (`PASS_LESSONS`). `tests/road.test.js` checks the file, and `tests/road-sets-*.test.js` must stay green: every node builds 5 fresh reps for every position group.
- **A new test file:** add it to `tests/manifest.js` (tests/manifest.test.js fails otherwise) and use `tests/harness.js`, not `node:test` directly. A speed test uses `timed()` (the median of several runs after a warm-up) and a generous bound times `PERF_SLACK`.
