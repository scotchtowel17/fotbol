# fotbol architecture and module contracts

This is the **source of truth for module boundaries**. If you change a signature or data shape listed here, update this file in the same change. The rationale behind every number and rule is in [RESEARCH.md](RESEARCH.md) (sections 5, 8 and 9).

## 1. Principles

- **Zero build.** Plain HTML, CSS and ES modules; open via any static server (`npm run serve` → `python3 -m http.server 8080`). No framework, no bundler, no runtime network calls except same-origin files.
- **Pure engine.** Everything under `js/engine/` is pure JavaScript with **no DOM access and no `fetch`**. Data is passed in as arguments. This lets the same code run in the browser and under `node --test`.
- **One coordinate frame** (see `js/engine/pitch.js`): metres, 105 x 68; x = 0 is **our** goal line and "us" (the learner's team) always attacks +x; y = 0 is the top touchline = **our left**. Goal-side = smaller x. Inside = closer to y = 34. Rendering may rotate the pitch; the engine never does.
- **Explainable scoring.** Every point the learner gains or loses traces back to a zone distance or a named rule, and every rule maps to a principle ID in `data/principles.json` (IDs such as `D3`, `U4`, `B1` from RESEARCH.md section 8).
- **Tunable defaults are labelled.** Any number that is an engineering guess lives in a `PARAMS`/`DEFAULTS` object with a comment `// [D]` (default), `[S]` (sourced) or `[M]` (measured), never inline magic numbers.

## 2. File layout

```
index.html                 app shell (single page, hash router)
tests.html                 runs tests/*.test.js in the browser
css/app.css                design tokens (light/dark), layout, components
js/main.js                 boot: load data, route #/home | #/explore | #/drill | #/live | #/progress | #/author | #/learn
js/data.js                 browser-side loaders (fetch JSON) → plain objects passed to the engine
js/store.js                localStorage wrapper (try/catch), progress export/import
js/engine/                 PURE (no DOM, no fetch)
  geometry.js              vectors, projection, barycentric, band()
  pitch.js                 IFAB constants, lanes, thirds, zone 14, frame transforms
  roles.js                 role IDs, families, labels, mirroring L<->R
  formation.js             formation table → Delaunay interpolation → team targets
  scene.js                 autoFrame(): place all 22 players for a ball position/possession
  timeline.js              frameAt(scenario, t): ball-scripted scenario playback
  scenario.js              validate / mirror (left↔right) / normalise scenarios
  context.js               buildContext(frame, learner): duties, lines, pressure, block height
  rules/<id>.js            one principle rule per file; rules/index.js exports RULES
  score.js                 zone score, rule aggregation, criticals, grades
  ghost.js                 grid search for the ideal spot + heatmap field
  explain.js               feedback sentences (standard/kid), fix-vector phrasing
  elo.js                   per-principle / per-role Elo with partial credit
js/ui/
  board.js                 SVG pitch, player tokens, drag (pointer + keyboard), overlays
  heatmap.js               field → image for the board
  reveal.js                two-beat feedback panel
  components.js            small DOM helpers (el(), buttons, toasts)
  modes/home.js explore.js drill.js live.js progress.js author.js learn.js
data/formations/helios-433.json   ball→11 positions table (converted from HELIOS, MIT)
data/principles.json              principle catalogue (IDs, names, text, links)
data/curriculum.json              modules → principles → scenario IDs
data/scenarios/index.json         list of scenario files
data/scenarios/*.json             hand-authored, ball-scripted scenarios
vendor/delaunator/                ISC, ESM source + LICENSE (plus robust-predicates, Unlicense)
scripts/convert-helios.mjs        one-off data conversion (Node)
scripts/check-scenarios.mjs       validates every scenario and prints engine answers (Node)
tests/harness.js                  test() / assert that work in Node and the browser
tests/*.test.js                   unit tests
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
export function mirrorRole(role) // 'LCB'<->'RCB', 'LB'<->'RB', 'LCM'<->'RCM', 'LW'<->'RW'; others unchanged
export const BACK_LINE = ['LB','LCB','RCB','RB'];
export const playerId = (team, role) => `${team}-${role}`;   // 'us-LCB', 'them-ST'
export function parsePlayerId(id) // → { team, role }
```

Learnable roles in v1: every outfield role (families CB, FB, DM, CM, W, ST). The GK role is v1.1.

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
 *     pressureOnBall?: boolean,        // override; otherwise derived (opponent within 3 m of carrier)
 *     event?: 'pass'|'carry'|'cross'|'shot'|'clearance'|'throw-in'|'goal-kick'|'corner'|'free-kick',
 *     ballMovingBack?: boolean,        // ball just moved toward the carrier's own goal
 *     phase?: string                   // e.g. 'build-up', 'mid-block', 'final-third', 'counter'
 *   }
 * }} Frame */
```

## 5. Engine API

### 5.1 formation.js

```js
/** Formation table JSON (data/formations/*.json):
 * { id, name, shape: '4-3-3', source: {...attribution}, frame: 'canonical',
 *   roles: ['GK',...],                       // our role IDs
 *   samples: [ { ball:{x,y}, pos: { GK:{x,y}, LCB:{x,y}, ... } }, ... ] }   // canonical frame, team attacks +x
 */
export function createFormation(table) → Formation
// Formation = {
//   id, name, roles,
//   samples,                                  // as in the table
//   triangles: Uint32Array,                   // Delaunay triangles over sample ball points (via vendor/delaunator)
//   positions(ball) → { [role]: Vec },        // own frame (attacks +x), barycentric interpolation; ball clamped to pitch
// }
export const POSSESSION_OFFSET = { with: 6, without: -4 };   // [D] metres along the team's attacking direction, outfield only
export function teamTargets(formation, team, ball, { inPossession = false, offset = true } = {}) → { [role]: Vec }
//   team 'us':   positions(ball)
//   team 'them': mirror through the centre spot: b' = (105-bx, 68-by); p = positions(b'); p → (105-px, 68-py)
//   then add the possession offset along the team's attacking direction (us: +x, them: -x) to outfield roles; clamp to pitch.
export function linearTarget(role, ball) → Vec   // regression fallback from RESEARCH 5.2 (tests + sanity)
```

### 5.2 scene.js

```js
export const SCENE_DEFAULTS = { carrierOffset: 0.8, pressDistance: 2.5, pressRadius: 14, onsideMargin: 0.5, ... } // [D]
/** Place all 22 players for a ball position.
 * opts: { formations: { us: Formation, them: Formation },
 *         ball: Vec, possession: 'us'|'them'|'none', carrierId?: string|null,
 *         learnerId?: string,                 // this player is NEVER auto-moved by press/carrier logic (but gets a formation position if not overridden)
 *         overrides?: { [playerId]: Vec },    // fixed positions win over everything
 *         autoCarrier?: boolean = true,       // if possession team has no carrierId, nearest non-learner player of that team snaps to the ball
 *         autoPress?: boolean = true,         // nearest non-learner defender presses: stands pressDistance from ball on the ball→own-goal line,
 *                                             //   but ONLY if that defender is within pressRadius and the learner (at its formation spot) is NOT the defender nearest the ball
 *         onsideClamp?: boolean = true }      // attackers of the team in possession are pulled back onside (x ≤ max(ball.x, second-last defender x) - onsideMargin; mirrored for 'them')
 * @returns {Frame}  (t = 0, tags = {})
 */
export function autoFrame(opts) → Frame
```

### 5.3 timeline.js and scenario format

Scenario JSON (see RESEARCH.md 9.4; this is the binding version):

```jsonc
{
  "id": "d3-cover-lcb-001",              // unique, kebab-case
  "title": "Cover your centre-back partner",
  "brief": "Their striker is running at your partner. Where do you go?",   // shown before playback (1 sentence)
  "module": "M1",                        // curriculum module ID
  "moment": "out_of_possession",         // in_possession | out_of_possession | attacking_transition | defensive_transition
  "phase": "mid_block",
  "principles": ["D3", "U4"],            // principle IDs this scenario teaches (first = primary)
  "learner": { "role": "LCB", "start": { "x": 30, "y": 28 } },   // start optional: default = auto position at t=0
  "timeline": {
    "duration": 6.0,                     // seconds of playback
    "freezeAt": 4.2,                     // drill freezes here (≤ duration)
    "ball": [ { "t": 0, "x": 60, "y": 40 }, { "t": 2.0, "x": 48, "y": 44, "event": "pass" } ],   // linear interpolation between keys
    "possession": [ { "t": 0, "team": "them" } ],        // step function
    "carrier": [ { "t": 0, "id": "them-RCM" }, { "t": 2.0, "id": "them-ST" } ],   // step function; null = ball in flight
    "players": {
      "auto": true,                      // everyone without an override follows autoFrame()
      "overrides": [ { "id": "them-ST", "keys": [ { "t": 0, "x": 45, "y": 36 }, { "t": 4.2, "x": 39, "y": 40 } ] } ]
    },
    "tags": [ { "t": 0, "carrierFacing": "forward" }, { "t": 2.0, "event": "pass" } ]   // step function, merged into frame.tags
  },
  "answer": {                            // what the drill is graded against
    "mode": "engine",                    // engine = ghost at freeze; authored = use "ideal" as zone centre
    "ideal": { "x": 33, "y": 35 },       // optional for engine mode (used only to flag disagreement)
    "tol": { "tx": 2.5, "ty": 3 }        // optional per-scenario tolerance override
  },
  "misconceptions": [ { "id": "ball-watching", "region": { "type": "circle", "x": 38, "y": 40, "r": 3 }, "text": "You were drawn to the ball..." } ],
  "difficulty": 0,                       // Elo prior (logit scale, 0 = average)
  "source": { "kind": "handmade", "license": "MIT", "author": "fotbol", "keyedBy": [] }
}
```

```js
export const TIMELINE_DEFAULTS = { reactionLag: 0.3, possessionBlend: 1.0 };   // [D] seconds
/** Frame of a scenario at time t. Auto players use autoFrame() with the ball position at (t - reactionLag),
 *  and the possession offset blends linearly over possessionBlend seconds after a turnover (no teleporting).
 *  opts: { formations, learnerId?, learnerSpot?: Vec }  — learnerSpot, if given, fixes the learner's position. */
export function frameAt(scenario, t, opts) → Frame
export function ballEvents(scenario) → [{ t, event }]     // for live-mode reaction grace
```

`scenario.js`:
```js
export function validateScenario(s) → string[]            // empty = valid; checks IDs, roles, times, coordinates on pitch, principles exist (if a principle map is passed)
export function mirrorScenario(s) → Scenario              // left↔right: every y → 68 - y, roles/ids L↔R, id gets suffix '-m'
export function learnerId(s) → 'us-<role>'
```

### 5.4 context.js

```js
export const CONTEXT_DEFAULTS = { pressureRadius: 3, secondDefenderRadius: 15, centreOfPlayRadius: 12, ... }  // [D]
/** @returns {Ctx} */
export function buildContext(frame, { learnerId, base, params })
// base: the learner's layer-A formation target (Vec). DUTIES ARE COMPUTED WITH THE LEARNER AT `base`, not at the dragged spot.
// Ctx = {
//   frame, params,
//   learner: { id, team: 'us', role, family, side, base },
//   moment: 'in_possession' | 'out_of_possession' | 'loose',
//   ball, carrier: Player|null, carrierFacing, pressureOnBall: boolean,
//   ballZone: { third: 0|1|2, lane: 0..4, wing: boolean },
//   ballSide: 'L'|'R'|'C',                         // which side of OUR team the ball is on (lane 0-1 = L, 3-4 = R)
//   teammates: Player[],                           // 'us' players excluding the learner
//   opponents: Player[],
//   lines: {
//     ourBackLine: Player[],                       // our back-four players (by role), learner at base if in it
//     ourBackLineX: number,                        // median x of our back four (learner at base)
//     oppSecondLastX: number,                      // x of the opponents' second-last player (offside line; GK counts) — the largest-but-one x among 'them'
//     oppBackLineX: number,                        // median x of their back four
//     oppMidLineX: number,                         // median x of their DM/CM players
//   },
//   blockHeight: 'high'|'mid'|'low',              // of the team OUT of possession: back-line x (in its own frame) ≥ 45 high, 25–45 mid, < 25 low
//   duty: 'first-defender'|'second-defender'|'third-defender'|'first-attacker'|'second-attacker'|'third-attacker',
//   firstDefender: Player|null,                    // our player pressing the ball (may be the learner-at-base)
//   markTarget: Player|null,                       // opponent the learner is responsible for (nearest dangerous opponent to base in the learner's zone), or null
//   dangerousAttacker: Player|null,                // opponent most threatening to our goal (for the #6 screen / cover shadow)
//   widthHolder: boolean,                          // learner is the designated width-holder on its side in possession
// }
```

### 5.5 Rules (`js/engine/rules/*.js`)

One rule per file, default export:

```js
export default {
  id: 'cover',                        // matches the file name
  principles: ['D3'],                 // principle IDs this rule checks
  critical: false,                    // true if failing it can cap the score
  /** 0 = not applicable. Otherwise the rule's weight for this learner/moment (RESEARCH 5.6). */
  weight(ctx) { ... },
  /** Score a candidate spot. MUST be fast (called ~700x per ghost search) and pure.
   *  @returns {{ s: number /*0..1*/, critical?: boolean /* true only when a critical constraint is broken */,
   *              target?: Vec /* the spot this rule alone would want, for fix phrasing */, vars: object }} */
  evaluate(ctx, spot) { ... },
  text: {
    standard: { name: 'Cover at an angle', ok: (v) => '...', fail: (v) => '...', cue: (v) => '...?' },
    kid:      { name: 'Back up your teammate', ok: (v) => '...', fail: (v) => '...', cue: (v) => '...?' },
  },
  /** optional: what to highlight on the pitch for the beat-1 cue */
  cue(ctx) { return { type: 'player', id: ctx.firstDefender?.id } },   // or { type: 'point', x, y } | { type: 'segment', a, b } | { type: 'line-x', x }
};
```

v1 rules (RESEARCH 5.5): `offside`, `keeps-onside`, `level-line`, `goal-side`, `press`, `cover`, `tuck`, `compact`, `screen`, `width`, `pin`, `lane-open`, `support-distance`, `occupancy`, `between-lines`, `spacing`. (`gk-angle-depth` is v1.1.) `rules/index.js` exports `RULES` (array) and `RULES_BY_ID`.

Text rules: second person, present tense, one sentence, football language ("drop", "push up", "tuck in", "come inside", "get goal-side"), never screen directions ("left/up on the screen"). Kid wording: ≤ 15 words, no jargon beyond the glossary.

### 5.6 score.js, ghost.js, explain.js

```js
// score.js
export const TOLERANCE = { CB:{tx:2.5,ty:4}, FB:{tx:2.5,ty:4}, DM:{tx:4,ty:4}, CM:{tx:5,ty:6}, W:{tx:6,ty:4}, ST:{tx:6,ty:6}, GK:{tx:1.5,ty:1.5} };  // [D]
export const SCORE_WEIGHTS = { zone: 0.55, rules: 0.45 };   // [D]
export const CRITICAL_CAP = 59;
export function zoneScore(spot, center, tol) → number        // anisotropic ellipse: 1 inside, exp(-0.5 (d_n-1)^2) outside; tx along x, ty along y
export function evaluateRules(ctx, spot, rules = RULES) → { sRules, results: RuleResult[] }
//   RuleResult = { id, principles, weight, s, critical: boolean, target?: Vec, vars }
//   rules with weight 0 are omitted; if none apply, sRules = 1
export function evaluate(ctx, spot, { center, tol }) → EvalResult
//   EvalResult = { score /*0..100 int*/, grade, sZone, sRules, critical: boolean, rules: RuleResult[], distance /*m to center*/, center, tol }
export function gradeOf(score) → 'S'|'A'|'B'|'C'|'D'|'F'   // S ≥ 90, A ≥ 80, B ≥ 70, C ≥ 60, D ≥ 50, F < 50
export function toleranceFor(role, override) → {tx, ty}

// ghost.js
export const GHOST_DEFAULTS = { radius: 15, step: 1 };      // [D]
/** Search a grid around `base` for the best spot: objective = evaluate(ctx, p, { center: base, tol }).score.
 *  Ties broken toward base. Candidates are clamped to the pitch.
 *  @returns { spot: Vec, score: number, field: { x0, y0, step, cols, rows, values: Float32Array /*0..100, row-major, row = y*/ } } */
export function computeGhost(ctx, { base, tol, radius, step })

// explain.js
/** Turn an evaluation into feedback.
 *  opts: { wording: 'standard'|'kid', max: 2, principles?: {[id]: Principle} }
 *  @returns { grade, score, headline, reasons: [{ ruleId, principleId, text, severity /*0..1*/ }], praise: string[],
 *             fix: { text, dx, dy } | null, cue: { text, ruleId, highlight } | null } */
export function explain(evalResult, ctx, spot, opts)
/** "drop 4 m deeper and come 3 m inside" — football terms relative to our goal and the centre line; '' if < 1 m. */
export function phraseMove(from, to)
```

Headline wording by grade (standard): S "Spot on.", A "Great position.", B "Good — small adjustment.", C "Close, but…", D "Not quite.", F "Out of position."

### 5.7 elo.js

```js
export const ELO_DEFAULTS = { targetP: 0.75 };
export function createSkills() → Skills               // { theta: {global, byPrinciple:{}, byRole:{}}, counts:{...}, items:{ [scenarioId]: { d, n } } }
export function predict(theta, d) → number            // 1 / (1 + e^-(theta - d))
export function update(skills, { itemId, principles, role, score01, prior = 0 }) → Skills   // immutable; K = 1/(1 + 0.05 n)
export function mastery(skills, principleId) → 0..3  // stars: 1 = P ≥ 0.6, 2 = P ≥ 0.7, 3 = P ≥ 0.8 on a d=0 item, with ≥ 3 attempts
export function pickNext(skills, candidates) → Scenario   // weakest principle first; prefer items with predicted P closest to targetP; avoid the last 3 seen
```

### 5.8 UI contracts

```js
// js/ui/board.js
export function createBoard(container, { orientation = 'auto' } = {}) → Board
// Board = {
//   el,                                              // root element
//   render(frame, { learnerId, highlight: string[], labels: 'role'|'none', dimOthers: boolean }),
//   setGhost(Vec|null), setZone({ center, tol }|null), setHeatmap(field|null),
//   setOverlays({ thirds, lanes, zone14, offsideLine: number|null, backLine: number|null }),
//   setMarkers([{ type: 'arrow'|'segment'|'ring'|'label', ... }]),   // cues and fix arrows
//   enableDrag({ ids: string[], onMove(id, Vec), onEnd(id, Vec) }), disableDrag(),
//   toWorld(clientX, clientY) → Vec, destroy()
// }
```

Board rules: SVG `viewBox` in metres (with a 3 m margin), a vertical layout when the container is portrait and narrower than 600 px (`orientation: 'auto'`), pointer events for mouse and touch (with `touch-action: none` on the pitch only), keyboard nudging (arrows 0.5 m, Shift 2 m) on the focused draggable token, finger-offset while dragging on touch so the finger doesn't hide the token, a colour-blind-safe palette (our team and theirs must differ in lightness as well as hue), and `prefers-reduced-motion` respected.

## 6. Adding things

- **A new rule:** add `js/engine/rules/<id>.js` with the contract above, register it in `rules/index.js`, reference its principle IDs, and add tests in `tests/rules.test.js` (a passing spot, a failing spot, and not-applicable).
- **A new scenario:** author it in `#/author` (or by hand), save to `data/scenarios/<id>.json`, add it to `data/scenarios/index.json` and `data/curriculum.json`, then run `npm run check` (prints the engine's answer and flags disagreements).
- **A new formation:** add a table under `data/formations/`, same shape as `helios-433.json`.
