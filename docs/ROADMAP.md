# Roadmap, status and known issues

What is done, what is next, and what is known to be wrong. Contracts are in [ARCHITECTURE.md](ARCHITECTURE.md); the plan and its reasoning are in [RESEARCH.md](RESEARCH.md) §9.

## Status (v1 milestones, RESEARCH 9.8)

| Milestone | State |
|---|---|
| M1 pitch, formation engine, Explore | Engine done (formation, scene, context, 17 rules, score, ghost, explain, `analyse.js`). Explore mode not written; the dev playground (`#/dev`) runs the full loop on real scenes. |
| M2 rule library, scoring, reveal, explanations | Engine done. The two-beat reveal panel (`js/ui/reveal.js`) is not written. |
| M3 timeline, Drill mode, first 12 scenarios | Timeline, scenario validation, `npm run check` done. Drill mode and the scenarios are not (only `data/scenarios/_example.json`; `data/scenarios/index.json` does not exist, so every app load logs one 404). |
| M4 remaining scenarios, progress and Elo, Live | Elo done; the rest not started. |
| M5 authoring, accessibility pass, credits, deploy | App shell, board, store and home done; `#/credits` and the other modes show "coming soon". |

Tests: `npm test` (Node) and `tests.html` (browser) run the same files; `tests/integration.test.js` holds the whole engine to RESEARCH 9.5 on six canonical situations x ten roles (`tests/situations.js`). `node scripts/sanity.mjs > docs/sanity-output.txt` prints the engine's answers for coach review.

## Next

1. **Coach review of `docs/sanity-output.txt`** (every situation, every role: base, ghost, duty, reasons). This is the key-the-answers step of RESEARCH 9.5 for the engine itself.
2. Explore mode (`js/ui/modes/explore.js`): the dev playground's loop (`analyseScene` on ball/possession change, `judgeSpot` on drag) with the learner-facing UI and the reveal panel.
3. Drill mode on `frameAt` + `learnerBaseAt` + the reveal panel; author the first 12 scenarios; `data/scenarios/index.json`; scenario IDs into `data/curriculum.json`.
4. Authored in-possession and out-of-possession formation tables (RESEARCH 5.2), replacing `phaseShape()` in `js/engine/formation.js`.

## Known issues

### Engine: formation (layer A)

- **One-phase data.** HELIOS has a single phase, so near our goal its shape is box defence even when we have the ball, and near their goal it is an attacking shape even when we press. `phaseShape()` (formation.js, `SHAPE_DEFAULTS`, mostly [D]) levels and compacts the back line out of possession (U1 per player, the line capped at x 52, U6), brings a bypassed #9 back to the ball in a mid or low block (T3), brings the wingers in off the touchline, tucks the far side in, and in possession holds the width, spreads the back four and staggers the lines in build-up (B10). scene.js then settles #8s and wingers goal-side of the opponents near them (D5, R4). It is a stand-in for authored tables and needs coach review.
- **Build-up depth is a floor, not a shape.** In build-up the full-backs, #6, #8s and #9 are held at least `buildUpDepth` up (x 18 / 21 / 28 / 48). Both #8s then stand level at x 28 (the `our-build-up` #8 ghosts step 2-5 m off that line for B5), and a #9 at x 48 suits their high press (their line is capped near halfway) but not a low block (their line at x 75-80 is out of the ghost's reach). Needs the authored in-possession table.
- **High press.** With our line capped at x 52 (U6 [S]) and U1's 15 m gaps, the #8s hold at about x 67 and do not mark their #8s 8+ m in front of them (`CONTEXT_DEFAULTS.midReach`); the wingers hold within 15 m of the midfield, which makes a winger the #9's cover when their keeper or a centre-back has the ball on their byline (a 70 ghost at ball (95, 24)). Pressing triggers and cover shadows (D8, D9) are v2.
- **#6 depth in attack.** With the ball in the final third our #6 is 20-24 m ahead of our back line (team length 43-46 m). Rest defence (P13) is v2, so no rule flags it yet.
- **Their build-up shape.** Their shape in their own third is HELIOS's low block plus the phase shape (centre-backs split, full-backs wide), not a real build-up (full-backs higher). It affects the opponents only.
- **Full-back engagement (R2, U5).** With the ball wide in our half the ball-side full-back ranks 10 m nearer the ball (context.js `engageBias`, shared with the press), so he engages and a centre-back covers him. The #8 HELIOS put near the ball stays at his table spot: when the learner is that full-back (so nobody presses automatically) the #8 stands on the press spot, and the ghost scores about 70 at ball (35, 14).
- **GK** is fixed at (2.5, 34) by HELIOS (separate goalie model); the GK role is v1.1.
- **Continuity:** a 0.5 m ball move moves a target at most 1.6 m (thin triangles along the touchlines); the timeline's shape averaging hides most of it. Adding samples along the touchlines would smooth it. Some HELIOS targets move about 1.6 m per metre of ball, so a passed ball (12-14 m/s) moves them 18-20 m/s in playback (the `_example` scenario on the HELIOS table).
- Linear fallback: refitted i_y values differ slightly from RESEARCH (CB 5.9 vs 5.6, FB 16.4 vs 15.8, CM 9.8 vs 10, W 20.3 vs 21.2); the documented [M] values are kept.

### Engine: scene, context, rules, score

- **The learner as the natural carrier (Explore).** The learner never carries; when the ball is dragged onto the learner's own spot a teammate takes it and the learner's base becomes that teammate's vacated spot (P6 rotation, `learnerBase`). The learner is still judged by their own role's rules there (an #8 in the #6's spot is still asked to be between the lines), so those ghosts can score 85-89. Drill authors choose the carriers.
- **Outside the canonical situations** (a sweep of 70 ball positions x 3 possessions x 10 roles): 95.4% of ghosts score S. The lowest are 66-70: a loose ball where two of our players are nearly as near the ball as each other (the learner's base is only partly moved to the press spot, `pressHandover`, while the duty says first defender), the full-back case above, a winger covering the #9 at their byline (high press, above), and extreme balls (inside our box, on their goal line).
- **"20 m from the ghost scores ≤ 40" (RESEARCH 9.5)** holds for every spot that is also outside the ghost's search disc around the base (> 15 m from the base). A ghost can sit up to 15 m from the base, and a spot 20 m from it on the base's side scores up to 50 in the canonical set (the #9 and #8s, whose zone tolerance is 5-6 m). Tightening this needs a harsher zone term or rules gate (`RULES_GATE`, [D]).
- **Borderline S:** final-third RCM 90 (the ball-side #8 is judged as the short option, B4, not as a box-filler: only the far #8 fills the box, P10). Rule tuning can drop it below 90 and fail the integration test (which is the point: re-check the sanity report).
- **Filling the box (P10, `box-fill`)** checks one runner at a time: it does not stop two teammates choosing the same zone (spacing keeps them 6 m apart). The ball-side #8 is left to support-distance.
- compact is the learner-level check only; team length and width (U1) are not judged.
- Separation is continuous (each pair's direction is fixed from the positions before separation, so a 1 cm ball move never swaps two players), at a price: two players crossing (biased offset under `separationSoft`) are only partly separated and overlap for a moment, and a player squeezed between two others or against the onside line can end a few centimetres short of `minSeparation`. In fuzzed playbacks the fastest player peaks at about 25 m/s (median), against 17 m/s with no separation at all.
- Presses are re-decided only at timeline key times: put a ball key every 1-3 s in long carries.
- `mirrorScenario` does not rewrite text: briefs and misconception texts must not name a side.
- The rule speed tests use the wall clock and could flake on a very slow machine.

### Content and UI

- No module teaches F8, B12, R4 or R5; RESEARCH 7.3's role paths and Module 4 (Transitions) are not modelled.
- G1 has no rule (`gk-angle-depth` is v1.1): add it to G1's `ruleIds` and to `RULE_REFS` in `tests/content.test.js` when written.
- Kid headlines and every rule text are our own paraphrases and need a content review.
- The tutorial UI (M0) must pass `setup.overrides`, `carrierId` and `learnerStart` into autoFrame, re-run it when the ball is dragged, and compute the offside line for `overlays.offsideLine`.
- S6's learnMore uses the IFAB Law 11 URL with a label pointing to Law 14; swap in a verified Law 14 URL.
- Free/paid flags of some resources are assumptions (Soccer Coach Weekly, The Outfield, U.S. Soccer grassroots).
- Live-mode fps is unmeasured on a real phone (the dev playground's Play readout shows it). In a desktop browser a scene analysis takes about 1 ms and a heatmap image about 1 ms.
