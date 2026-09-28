# Progressive field, player figures and a ball you can see (spec and build contract)

**Owner feedback, 2026-09-28:**
1. The field is too clogged. Kids don't need every player in every exercise: start simple and build up to the full field.
2. Circles as players are boring: use a simple character.
3. The ball is impossible to see: it doesn't need to be life size; make it easy to spot.

Binding for the build that follows, like [KID_REDESIGN.md](KID_REDESIGN.md) (whose rules still apply: word budgets, reading age, stars not grades, colour + shape, reduced motion, 44 px targets, Coach mode unchanged).

## 1. Stages: small game → bigger game → full match

| Stage | Players shown | Who | Camera |
|---|---|---|---|
| `small` | 3–6 in total (2 v 1, 2 v 2, 3 v 2 …) | the learner, the ball carrier(s) and the players the lesson is about | fits the cast (both axes), so figures are big |
| `medium` | 6–12 (5 v 4, 6 v 6 …) | the learner's unit plus the attack or defence around the ball | fits the cast |
| `full` | all 22 | today's scene | as today (length crop on phones, spotlight on key players) |

- **Hidden players are not drawn and not scored.** A staged rep is played and judged on a **reduced frame** that holds only the cast. Every star, ring and sentence depends only on players the kid can see.
- **Same lesson at every size (the gate).** A stage is used for a rep only if, on its reduced frame at the freeze:
  - **spot reps:** the ghost scores ≥ 90; the rep's primary principle's rule is weighted ≥ 2 with s ≥ 0.9 at the ghost; the ghost is within `sameAnswer` (4 m [D]) of the full-game ghost; standing still at the start scores < 70 (unless the drill is an authored "hold" drill).
  - **pass reps:** the best receiver is the same as in the full game; at least one other shown option is labelled risky or cut-out, or the best is clearly ahead (a real choice); the shown options are 3–5 teammates.
  - If a stage fails, the cast grows (next most relevant players) up to that stage's cap; still failing, the rep falls back to the next bigger stage. `full` always passes.
- **Stage label:** count ours v theirs in the cast ("3 v 2"); `full` = "11 v 11". Goalkeepers count only when in the cast.
- **Offside:** when the lesson involves the offside line (an attacker ahead of the ball, principles F4/B2/P5 or the `offside`/`pin` rules weighted ≥ 2), the defenders who set the line are in the cast.
- **Clip:** every player who has the ball during the clip (timeline carriers, override players who receive) is in the cast.

## 2. Stage plan: how a set builds up

Per Road set of 5 reps, from the node's stars **before** the set:

| Node stars | Reps 1–5 |
|---|---|
| 0 | small, small, small, medium, medium |
| 1 | small, small, medium, medium, full |
| 2 | small, medium, medium, full, full |
| 3 | medium, full, full, full, full |

- `#/play/first` (onboarding): small, small, small.
- Quick "Who's open?" (`#/pass`): the 1-star plan.
- "Try again" keeps the first try's stage. Recall reps use the plan's stage for their slot.
- Match day: full (with figures and the new ball). Coach mode: unchanged (full field, discs).
- The role card names the stage in a few words ("Small game: 3 v 2", "Bigger game: 6 v 5", "Full match"), and the first rep of a bigger stage in a set says "Now 6 v 5!" once.

## 3. Engine: `js/engine/cast.js` (pure)

```js
export const STAGES = Object.freeze(['small', 'medium', 'full']);
export const CAST_DEFAULTS = { small: { min: 3, max: 6 }, medium: { min: 6, max: 12 }, sameAnswer: 4, stillMax: 70, ... };  // [D]

/** The players to show and score for a stage, most relevant first. */
castFor(frame, { learnerId, base, ghost, principles, stage, clipIds = [], params }) → { ids: string[], label: string, ours: number, theirs: number }
//   relevance: the learner; the ball carrier and clipIds; the context's firstDefender, secondDefender, markTarget and
//   dangerousAttacker; players cued by the rules weighted ≥ 2 at the ghost (rule.cue(ctx)); the offside-line setters when
//   the lesson involves them; then the nearest players to the ghost, the ball and the learner's start, keeping both teams
//   represented; capped by the stage.

reduceFrame(frame, ids) → Frame   // only those players; ball, possession, tags kept; carrierId kept only when in ids

stageSpotDrill(scenario, stage, { formations, principles, params }) → { stage, cast, ghost, base, tol, gates } | null
stagePassDrill(drill, stage, { formations, params }) → { stage, cast, rating, answer: { best, accept } } | null
//   null: this stage can't teach this drill (the gate failed even after growing the cast)
bestStage(item, wanted, opts) → the staged result at `wanted`, or the next bigger stage that passes (never null: full passes)
```

`scripts/check-scenarios.mjs` reports, for every authored drill, which stages pass (small / medium / full) and fails CI only on a drill with no small **or** medium stage and no documented reason (`"stages": { "note": "…" }` in the scenario).

## 4. Board: figures, the ball and the camera (`js/ui/board.js`, `js/ui/figures.js`)

```js
createBoard(container, { orientation, labels, figures /* true in Player mode, false (discs) in Coach mode */ })
board.render(frame, opts)          // unchanged; a reduced frame simply draws only its cast (absent players are hidden)
board.setCamera(rect | null)       // rect { x0, x1, y0, y1 } world metres: fit that area on both axes (keep the box's aspect,
                                   // clamp to the pitch + margin, never smaller than CAMERA_MIN 24 × 16 m [D]); eases unless
                                   // reduced motion; null = today's behaviour (setFocus length crop)
// js/ui/figures.js (DOM helper, no engine imports)
drawFigure(parent, { shirt, edge, ink, shorts, socks, number, skin, hair, hairStyle, gk, facing: 1 | -1, size }) → SVGGElement
figureLook(playerId, team) → { skin, hair, hairStyle }   // deterministic variety per player
```

**Figures** ("tabletop figure"):
- the team-coloured **base disc** under the feet (keeps today's readability from above and the ≥ 44 px hit area) and an **upright figure** on it: head with a hair shape, shirt with the number in the kit's ink colour, shorts, socks, simple arms and legs; about 2.4 token radii tall; faceless (sporty, not babyish, KID_REDESIGN rule 7);
- upright on screen in both orientations; flips left/right to face the ball;
- a two-pose run cycle while moving, still when standing; no animation under reduced motion;
- variety per player id: 5 skin tones, 5 hair colours, 4 hair styles; goalkeepers in a distinct kit with gloves;
- our team in the kid's kit palette (`--kit-us*`), theirs in the dark kit (`--kit-them*`): the lightness contrast is kept (colour-blind safe);
- YOU: a gold glow on the base and the YOU/nickname tag above the head; the carrier has the ball at their feet on the side they face;
- Coach mode keeps the discs (`figures: false`).

**Ball:**
- drawn above every figure, never hidden under one;
- at least 18 CSS px across on a 375 px phone at every stage (bigger when zoomed), classic white with dark patches and a thick dark outline;
- a bright halo ring (e.g. #FFD400) that pulses gently, plus a ground shadow; the halo stays (static) under reduced motion;
- a short fading trail while in flight; when carried it sits at the carrier's feet on the side they face;
- contrast ≥ 3:1 against the pitch in both themes.

## 5. Player integration

- `js/ui/player/road.js`: `stagePlan(nodeStars, { first, count })` (pure, §2); `buildSet` tags each rep with its wanted `stage`.
- `play.js` / `pass.js`: at rep start, stage the rep with `bestStage` (engine), then play the clip, freeze, judge and reveal on reduced frames; `board.setCamera` fits the cast plus the ball, YOU's start and the best spot for small/medium; spotlight only at full; the role card shows the stage words; figures on.
- `matchday.js`: figures on, full field.
- `card.js`, the kit locker, `kickoff.js` and the home top bar show the kid's own figure in their kit (`drawFigure`).
- All new words go in the modules' `STRINGS` (the copy test checks them).

## 6. Acceptance

- Small reps show 3–6 players, medium 6–12, full 22; every Road node can build its set for every position group with the planned stages (falling back only where the gate says so; the sweep reports how often).
- Every staged rep passes its gate (same move as the full game within 4 m, S-grade ghost, principle rule active; pass: same best receiver, a real choice).
- On a 375 px phone: the ball is ≥ 18 px with its halo and on top at every stage; shirt numbers readable (≥ 11 px) at full stage; 22 figures render and animate without jank (render < 8 ms per frame measured in the browser).
- Zero console errors; light and dark; reduced motion; Coach mode unchanged; `npm test` and `npm run check` green.

## 7. Build ownership

| Wave | Area | Files |
|---|---|---|
| 1 | **engine-cast** | `js/engine/cast.js` (new), `js/engine/spotdrill.js`, `js/engine/passdrill.js` (only if stage helpers need hooks there), `scripts/check-scenarios.mjs`, `tests/cast.test.js`, `docs/ARCHITECTURE.md` §5.17 |
| 1 | **board-visual** | `js/ui/board.js`, `js/ui/figures.js` (new), `css/figures.css` (new; linked in `index.html`), `tests/board.test.js`, `tests/figures.test.js`, `docs/ARCHITECTURE.md` §5.8 |
| 2 | **play** | `js/ui/player/play.js`, `matchday.js`, `fulltime.js`, `strings.js`, `css/play.css`, `tests/player-play.test.js` |
| 2 | **pass-road-shell** | `js/ui/player/pass.js`, `road.js`, `card.js`, `kickoff.js`, `home.js`, `shell.js`, `data/road.json`, `css/pass.css`, `css/player.css`, road/pass/shell tests |
