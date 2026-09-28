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
index.html                 app shell (single page, hash router)
tests.html                 runs tests/*.test.js in the browser (list: tests/manifest.js)
css/app.css                design tokens (light/dark), layout, components
assets/                    favicon
js/main.js                 boot: load data, route #/home | #/explore | #/drill | #/live | #/progress | #/author | #/learn | #/dev
js/data.js                 browser-side loaders (fetch JSON) → plain objects passed to the engine
js/store.js                localStorage wrapper (try/catch), progress export/import
js/engine/                 PURE (no DOM, no fetch)
  geometry.js              vectors, projection, barycentric, band()
  pitch.js                 IFAB constants, lanes, thirds, zone 14, frame transforms
  roles.js                 role IDs, families, labels, mirroring L<->R
  formation.js             formation table → Delaunay interpolation → team targets (+ phase shape)
  scene.js                 autoFrame(): place all 22 players for a ball position/possession; learnerBase()
  timeline.js              frameAt(scenario, t): ball-scripted scenario playback; learnerBaseAt()
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
  reveal.js                two-beat feedback panel (not written yet)
  components.js            small DOM helpers (el(), buttons, toasts, stageLayout)
  modes/home.js dev.js     (explore.js drill.js live.js progress.js author.js learn.js credits.js: not written yet)
data/formations/helios-433.json   ball→11 positions table (converted from HELIOS, MIT; 48 documented edits)
data/principles.json              principle catalogue (IDs, names, text, links)
data/curriculum.json              modules → principles → scenario IDs
data/tutorial.json                M0 guided tour
data/resources.json               reading list
data/scenarios/index.json         list of scenario files (not written yet: the app tolerates its absence)
data/scenarios/*.json             hand-authored, ball-scripted scenarios (_example.json is the template)
vendor/delaunator/                ISC, ESM source + LICENSE (plus robust-predicates, Unlicense)
scripts/convert-helios.mjs        one-off data conversion (Node)
scripts/check-scenarios.mjs       npm run check: validates every scenario and prints the engine's answer (checkScenario() is exported for tests)
scripts/sanity.mjs                coach-facing report on the canonical situations → docs/sanity-output.txt
scripts/shape.mjs                 print both teams' layer-A targets for a ball position
scripts/lib/ascii.mjs             ASCII pitch for terminals
tests/harness.js                  test() / assert that work in Node and the browser
tests/fixtures.js                 hand-placed 22-player frames for unit tests
tests/situations.js               canonical match situations (integration test, sanity report, dev playground)
tests/manifest.js                 test files tests.html runs (tests/manifest.test.js keeps it complete)
tests/*.test.js                   unit tests; integration.test.js is end to end on real data
docs/sanity-output.txt            the last sanity report (regenerate after engine changes)
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
 *     phase?: string,                  // e.g. 'build-up', 'mid-block', 'final-third', 'counter'
 *     widthHolders?: string[]          // roles holding the width in possession (default: the wingers), e.g. ['LB'] for an inverted winger
 *   }
 * }} Frame */
```

### 4.1 Content data

- `data/principles.json` = `{ version, $comment, principles: [...] }`. Each principle: `id, name, short, category, section` (RESEARCH subsection), `who, families, level, release, ruleIds, summary{standard,kid}, ruleOfThumb, why, commonMistake, learnMore[{label,url}], sources`. `name`, `level`, `release` and `sources` follow the RESEARCH §8 table (tested). `ruleIds` follow the RESEARCH 5.5 map and agree both ways with the rule registry (tested).
- `data/curriculum.json` = `{ version, $comment, moduleUnlockStars, levels: [{level, name, kidName, mix, scaffold, timer, unlockStars, description{standard,kid}}], session{...}, modules: [{ id, kind: 'tutorial'|'drills', title, subtitle, description{standard,kid}, principles, roles, unlock, tutorial?, scenarios: [], levels: [{level, focus{standard,kid}}], interleave: [{pair, label{standard,kid}}], pitchChallenge{standard,kid} }] }`.
- `data/tutorial.json` = `{ version, $comment, module: 'M0', title, intro{standard,kid}, outro{standard,kid}, steps: [{ id, topic, title, text{standard,kid}, principles, setup{ ball, possession, carrierId?, learnerRole, learnerStart?, overlays{thirds,lanes,zone14,offsideLine: boolean}, highlight, overrides? }, task{ type, to|target|answer, prompt{standard,kid}, success{standard,kid}, hint? } }] }`. `setup` means the same as the autoFrame options; `overlays.offsideLine` is a boolean, so the UI computes the line (their second-last player) before calling `board.setOverlays`.
- `data/resources.json` is an array of `{ title, url, kind, group: 'start-here'|'beginner'|'intermediate'|'advanced'|'video', free, note? }` in display order.

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
                                pressFbEngage: 10, pressFbEngageFrom: 45, pressFbEngageTo: 55,   // = CONTEXT_DEFAULTS.fbEngage* (tested)
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
 *         autoPress?: boolean = true,         // the defending outfielder nearest the ball presses pressDistance from it on the ball→own-goal line;
 *                                             //   a defender the ball has gone past counts pressPastWeight x metres extra, and with the ball wide
 *                                             //   in the defending team's half its ball-side full-back pressFbEngage metres less (R2, U5:
 *                                             //   context.js engageBias(), the same ranking as the first defender); nobody presses if the
 *                                             //   top-ranked defender is the learner or an override. Static scenes ramp the press in over
 *                                             //   pressHandover and fade it over pressFade (no jumps while dragging the ball).
 *         presserId?: string|null,            // undefined = automatic; an id = that defender presses fully; null = nobody presses
 *         inFlight?: boolean,                 // ball in flight: no auto carrier and no press (the timeline sets it)
 *         shapeBall?: Vec,                    // ball the shape and the press decision react to (default: ball)
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
  "module": "M1",                        // curriculum module ID
  "moment": "out_of_possession",         // in_possession | out_of_possession | attacking_transition | defensive_transition
  "phase": "mid_block",
  "principles": ["D3", "U4"],            // principle IDs this scenario teaches (first = primary)
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
    "tol": { "tx": 2.5, "ty": 3 }        // optional per-scenario tolerance override
  },
  "misconceptions": [ { "id": "ball-watching", "region": { "type": "circle", "x": 38, "y": 40, "r": 3 }, "text": "You were drawn to the ball..." } ],   // circle | rect {x0,y0,x1,y1} | polygon {points}
  "difficulty": 0,                       // Elo prior (logit scale, 0 = average)
  "params": {},                          // optional SCENE/TIMELINE_DEFAULTS overrides (also autoPress, autoCarrier, onsideClamp)
  "source": { "kind": "handmade", "license": "MIT", "author": "fotbol", "keyedBy": [] }
}
```

```js
export const TIMELINE_DEFAULTS = { reactionLag: 0.3, shapeWindow: 1.0, possessionBlend: 1.0, carrierBlend: 0.5, pressCommit: 0.5,
                                   recoverSpeed: 6, maxBlend: 4, eventGrace: 0.7, sampleHz: 10, ballBackWindow: 1.0, ballBackDist: 3 };
/** Frame of a scenario at time t (a pure function of t).
 *  - Auto players use autoFrame(); the shape reacts to the MEAN ball over [t - reactionLag - shapeWindow, t - reactionLag]
 *    (shapeWindow 0 = the ball at t - reactionLag); the carrier, press spot and onside line use the ball at t.
 *  - Automatic carriers and pressers are decided at t = 0 and at every ball, possession and carrier key, and held until the next.
 *  - Every state change (possession, carrier, in-flight, presser) closes each player's gap linearly over
 *    clamp(|gap| / recoverSpeed, possessionBlend or carrierBlend, maxBlend): nobody teleports.
 *  - frame.tags: the tag keys so far; `phase` defaults to scenario.phase; `ballMovingBack` is derived unless tagged.
 *  opts: { formations, learnerId?: string|null /* default: the scenario's; null = nobody held back */, learnerSpot?: Vec, params? } */
export function frameAt(scenario, t, opts) → Frame
export function learnerBaseAt(scenario, t, opts) → Vec   // the learner's base at t (the playback twin of learnerBase())
export function ballEvents(scenario) → [{ t, event }]     // for live-mode reaction grace
// also: interpKeys, stepKey, ballAt, meanBallAt, possessionAt, carrierAt, timing, inGrace, sampleTimes
```

A drill frozen at `freezeAt` scores the learner with `frame = frameAt(s, freezeAt, { formations, learnerSpot })`, `base = learnerBaseAt(s, freezeAt, { formations })` and `buildContext(frame, { learnerId, base })`, where `freezeAt` is `timing(s).freezeAt` (the duration when not authored) (see `scripts/check-scenarios.mjs`, whose `checkScenario(raw, { principles, formations })` does exactly this on the normalised scenario).

`scenario.js`:
```js
export function validateScenario(s, { principles, params } = {}) → string[]   // empty = valid; principles: a map, {byId}, {list}, {principles:[...]}, Map/Set or array
export function mirrorScenario(s) → Scenario     // left↔right: every y → 68 - y, roles/ids L↔R, id gets suffix '-m' (text is not rewritten)
export function normalizeScenario(s) → Scenario  // fills defaults; converts the RESEARCH 9.4 forms
export function learnerId(s) → 'us-<role>'
export const SCENARIO_DEFAULTS, MOMENTS, EVENTS, ANSWER_MODES, REGION_TYPES
```

### 5.4 context.js

```js
export const CONTEXT_DEFAULTS = { pressureRadius: 3, secondDefenderRadius: 15, coverUnitPenalty: 5, coverMidAhead: 5, centreOfPlayRadius: 12,
                                  markRadius: 18, handoverDepth: 5, backReach: 8, midReach: 8, markBehindBall: 2, coverReach: 4,
                                  pastWeight: 2, fbEngage: 10, fbEngageFrom: 45, fbEngageTo: 55, blockHigh: 45, blockLow: 25 }  // [D]
export function engageBias(team, ball, P) → { role: 'LB'|'RB', bias }   // R2/U5 ranking bonus of the defending team's ball-side full-back (shared with scene.js)
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
//                                                  //   markBehindBall behind the ball (U6)
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
   *              target?: Vec /* the spot this rule alone would want */, vars: object /* defending rules: vars.issue ('ok' or a failure key) */ }} */
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

Interpretations fixed in integration (details in each file's header): `compact` does not apply to the first defender, judges a covering back-liner only on the gaps to his line-mates (U2; the cover rule sets his depth) and no other second defender, and counts a pressing line-mate as closing his channel; `cover` never puts a covering back-liner ahead of his own line (the depth band starts at the level-line reference); `goal-side` judges a covering full-back only on staying goal-side of the winger on his flank (R2, weight 1.5); `screen`'s centre lane slides with the centre-backs' mid-point (at most a half-space); `width` fades out for the far winger in the crossing zone and `box-fill` fades in by the same amount (P10, `widthDuty`); `pin` steepens and says "offside" only past the offside line (ball, second-last opponent or halfway, IFAB Law 11), is a gentle miss beyond their line while onside, and fades out once the ball is past their second-last player; `between-lines` fades out as the ball reaches their midfield line and in the crossing zone; `support-distance` asks only players within 15 m of a pressed carrier to come short, and with `lane-open` fades out for the #9 and far winger with the ball wide in the final third (`boxRunner`, R5); `spacing` holds in-possession width-holders and the #9 only to its minimum (they stretch the team).

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
export const EXPLAIN_DEFAULTS = { failBelow: 0.9, praiseAt: 0.9, maxPraise: 2, maxReasons: { standard: 2, kid: 1 }, minMove: 1, centreBand: 1, zoneFailBelow: 0.6 };
export const HEADLINES = { standard: {...}, kid: {...} };
export const ZONE_REASON;   // the zone as a reason: ruleId 'zone', principle F2
/** opts: { wording: 'standard'|'kid', max (default by wording), principles?: byId map or {byId},
 *          ghost?: Vec|{spot} (the fix target; default: the zone centre), rules? (the set used to evaluate) }
 *  reasons: failing rules (criticals first, then by weight x (1 - s)), then the zone reason if S_zone < zoneFailBelow.
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
export function createBoard(container, { orientation = 'auto', params } = {}) → Board   // params: BOARD_DEFAULTS overrides
// Board = {
//   el, orientation (getter), setOrientation('auto'|'horizontal'|'vertical'),
//   render(frame, { learnerId, highlight: string[], labels: 'role'|'none', dimOthers: boolean }),
//   setGhost(Vec|null), setZone({ center, tol }|null), setHeatmap(field|null),
//   setOverlays({ thirds, lanes, zone14, offsideLine: number|null, backLine: number|null }),   // merges partial patches
//   setMarkers([ arrow {from,to,tone?,label?} | segment {a,b,tone?,dashed?,label?} | ring {at?|id?, r?, tone?, pulse?, label?}
//                | label {at,text,tone?} | a rule cue() object ]),                               // tone: fix|cue|good|bad|info
//   enableDrag({ ids: string[], onMove(id, Vec), onEnd(id, Vec) }), disableDrag(),
//   toWorld(clientX, clientY) → Vec, destroy()
// }
// also pure helpers: pickOrientation, viewBoxFor, project/unproject, worldTransform, keyDelta, describeSpot, tokenName, pitchMarkings, drawPitch
```

Board rules: SVG `viewBox` in metres (with a 3 m margin), a vertical layout when the container is portrait and narrower than 600 px (`orientation: 'auto'`), pointer events for mouse and touch (with `touch-action: none` on the pitch only), keyboard nudging (arrows 0.5 m, Shift 2 m) on the focused draggable token, finger-offset while dragging on touch so the finger doesn't hide the token, a colour-blind-safe palette (our team and theirs must differ in lightness as well as hue), and `prefers-reduced-motion` respected. The board is controlled: it moves a dragged token optimistically, but the next `render(frame)` wins, also during the drag (so a mode that clamps or corrects the dragged spot shows the correction at once); a mode writes the dragged spot back into its frame. onMove fires during a drag, onEnd on release (a two-tap move and each keyboard nudge fire both). `setHeatmap(field)` re-encodes the image only for a new field object (pass a new object when the values change).

### 5.9 App shell and mode contract

`js/main.js` builds an `app` object once, then routes `#/<mode>[/<arg>...]` to `js/ui/modes/<mode>.js` via dynamic `import()`. A missing mode module shows a friendly "coming soon" card instead of crashing.

```js
// every js/ui/modes/<mode>.js
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
  settings,       // { wording: 'standard'|'kid', theme: 'auto'|'light'|'dark', reducedMotion: boolean, role: LEARNABLE_ROLES } (persisted; unknown keys kept)
  setSettings(patch), onSettings(fn) → unsubscribe,
  navigate(hash), route: { mode, params },
  createBoard,    // js/ui/board.js
}
```

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
 *  i.e. the base or an authored ideal passed as ghost.base, and its tolerance), so a spot on the ghost scores the ghost's score. */
export function judgeSpot(scene, spot, { wording, principles, rules }) → { result, feedback }
```

Explore mode and the dev playground (`#/dev`) call `analyseScene` when the ball or possession changes and `judgeSpot` on every drag; the end-to-end test and `scripts/sanity.mjs` use the same two calls.

## 6. Adding things

- **A new rule:** add `js/engine/rules/<id>.js` with the contract above, register it in `rules/index.js`, reference its principle IDs (and add the rule to those principles' `ruleIds` in `data/principles.json`, to the RESEARCH 5.5 table and to `RULE_REFS` in `tests/content.test.js`), and add tests in `tests/rules-attacking.test.js` or `tests/rules-defending.test.js` (a passing spot, a failing spot, and not-applicable). Then run `npm test`: `tests/integration.test.js` checks that every canonical situation still gives an S-grade ghost, and `node scripts/sanity.mjs > docs/sanity-output.txt` shows what changed.
- **A new scenario:** author it in `#/author` (or by hand), save to `data/scenarios/<id>.json`, add it to `data/scenarios/index.json` and `data/curriculum.json`, then run `npm run check` (validates it, prints the engine's answer and flags a ghost more than 5 m from the authored ideal).
- **A new formation:** add a table under `data/formations/`, same shape as `helios-433.json`. Phase-specific tables (in and out of possession) would replace `phaseShape()`.
- **A new test file:** add it to `tests/manifest.js` (tests/manifest.test.js fails otherwise) and use `tests/harness.js`, not `node:test` directly.
