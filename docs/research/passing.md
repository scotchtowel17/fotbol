# Where to pass: coaching principles, pass-rating models and an engine design

**Date:** 2026-09-27. **Status:** research and design proposal. No app code changed. A prototype of the rating ran against the real engine from a scratch folder outside the repo (§5).
**Purpose:** let fotbol also teach the on-ball decision. The learner has the ball at a freeze, taps the teammate (or the space) to pass to, and sees every option rated, the best one starred, and why.
**Related:** RESEARCH §5.8 (time-to-intercept, soft pitch control, value grids), §8.2 B3/B8 and §8.3 P7/P9; the "Who's open?" loop in [kid-apps-teardown.md](kid-apps-teardown.md) §5.4, whose labels (★ Best, ✓ Good, ! Risky, ✗ Cut out) this engine produces.
**Tags:** `[S]` sourced, `[D]` default guess, `[M]` measured by the prototype. Coaching text is paraphrased (AGENTS.md copyright rule).

> **Update after play-testing (2026-09-28).** The research below stands as written. The build (`js/engine/passing.js`, `passdrill.js`; contract and measures in ARCHITECTURE §5.14) changed the design after the team's own play-test of "Who's open?" (no child has played it yet):
> - **Ranked by worth, not U.** A pass that is not safe pays a teaching risk premium (`worth = U - riskWorth × 0.001 × r`, riskWorth 20 points, r from 1 to 2 as an amber pass gets less safe, 2 for red), so a risky pass is starred only when it is worth clearly more than the best safe one. The green floor is 75 (§4.2 said 60: a safe pass earns 2 stars unless it is too safe); a risky pass that is not the best is capped at 74 (1 star, new); too-safe is exactly 74 (was capped at 79), and only when it is more than 15 points below the best and the forward pass on goes to an unmarked receiver.
> - **Lane and race.** To feet, the body block now covers the lane up to the receiver himself, so a defender in his run to the ball cuts it out, while one level with or behind him counts 3 times further off (§4.2 item 1 stopped both at the meeting point). Into space, a marker tracking the runner (within 3 m, fading over 2 m more, level or goal-side of him) reacts with him in 0.3 s, not 0.7 s.
> - **Drills.** Scenes are varied so the obvious receiver is not always the answer (him marked in 40 % of scenes, a teammate ahead left free in 30 %; a winger or #9 comes short in 35 %); `generatePassSet` stars no receiver more than twice; a measured yield table (`PASS_YIELD`) skips what a position never gets. The Player screen asks "Pick the best pass.", offers far teammates (over 45 m) and the keeper only when that pass is really on, and labels the best, your pick and up to two others.
> - **Effect** (12 seeds × 7 positions): the best is a safe pass in 76 of 84 drills (was 45 of 82); no best is a ball into space behind a tracked runner (was 13); a winger's best goes to the #9 in 5 of 24 (was 13); a safe pass to a free teammate earns 2 stars or more in 105 of 163 (was 77 of 169).

## 1. Summary

- **Principles.** 15 kid-sized passing principles, PA1-PA15 (§2), each with a checkable rule of thumb. Eleven are checked by the engine in v1 and PA1 by the drill flow. PA7 safe side, PA14 third man and PA15 draw-then-pass come later.
- **Model.** Every option gets a safety, a reward and a set of reasons. Everything is closed-form and static-frame: no velocities, no body shape, no dependencies.
  - **Safety:** `pSafe = pExec x pLane x pWin` (§4.2).
    - `pLane`: can a defender cut the pass out before the receiver meets it? Spearman time-to-intercept, plus a body block for a defender within reach of the line (the B3 geometry).
    - `pExec`: can an 11-year-old play it that far accurately?
    - `pWin`: for a pass into space, does our runner get there first?
  - **Reward:** our own licence-free value surface `V(x, y)`, raised by the receiver's free run and by the opponents bypassed (Impect's definition). It is lowered by receiver pressure (the Andrienko/Herold oval).
  - **Combined** as expected utility, the pass value of Spearman et al. 2017 (Eq. 11) and the risk-reward idea of Power et al. 2017, with a cost for losing the ball that is highest in front of our own goal.
- **Score and labels.** `score = 100 - (U_best - U) / 0.001`, capped and floored by category. Label: ★ best, green = Good, amber = Risky, red = Cut out.
- **Prototype.**
  - Speed: 0.3-0.4 ms per frame for 13 options (10 teammates and 3 "into space" targets).
  - The best pass looked coach-plausible on all 7 test frames.
  - Generation: 41 % of 299 automatic scenes and 24 % of 213 pass moments in Live sequences pass the drill-quality gates, so drills can be generated.
  - Left/right mirroring is exact. The best pass is stable under ±30 % parameter changes (93-100 % unchanged).
- **Licences.** Reimplement the published formulas (ideas, not code). Ship no third-party grid or data: Karun Singh's xT grid has no licence, and StatsBomb data may not be redistributed. `V` is our own formula.
- **Side finding.** Live's sequence generator plays about 1 in 9 of our passes within 1 m of a standing defender (§5.4).

## 2. Kid passing principles

Kid wording is at most 12 words. The rule of thumb is what the engine (or the drill flow) checks. **Rel** = the release that checks it automatically. Source keys are in §7.

| ID | Kid wording | Grown-up wording | Rule of thumb (checkable) | Rel | Sources |
|---|---|---|---|---|---|
| PA1 | Look around before the ball reaches you. | Scan (check your shoulders) before you receive, so your next pass is already chosen. | Pros average 0.44 scans/s, about 3 looks in the last 10 s, and scan most before long forward passes `[S]`. In the app: a short "look" before the freeze and a decision clock at level 3. The engine does not rate it. | v1 (flow) | J20, J13, FA-P, ODP P4 |
| PA2 | If a forward pass is safe, play it. | Penetrate first: pick the forward option when it is on. If not, go around (switch) or back. | If a green forward option scores within 10 points of the best, a safe square or back pass is `too-safe`: at most B. | v1 | GR, DNA, ODP P6, BC |
| PA3 | Pass to the teammate with nobody close. | Find the free player: a receiver with time and space, not one squeezed by two opponents. | Receiver pressure below 0.15 = free; 0.6 or more = under pressure (oval 9 m in front, 3 m behind `[S]`). | v1 | USC, FFA-CP, LP12\* |
| PA4 | If a defender is in the way, don't pass there. | A pass needs a clear lane: no defender within reach of the line, and none who can get across before the ball. | `pLane` ≥ 0.8 green, < 0.5 red; the blocker is named and ringed. | v1 | USC (triangles), RESEARCH B3, SPEAR17 |
| PA5 | Pass past their players, not in front of them. | Break lines: move the ball between and beyond opponents; count the players you take out. | Opponents bypassed: outfield players nearer their goal than the ball before the pass and not after it (Impect's test). Tags for beating their front, midfield or back line. | v1 | DNA, FF, IMP, REIN |
| PA6 | Crowded here? Send it to the free side. | Switch the point of attack when the ball side is crowded and the far side holds width. | At least 25 m across into the far half, and green. | v1 (authored) | ODP P6, P7, P9; FS |
| PA7 | Pass to the foot away from the defender. | Play to the far foot when the receiver can turn, to the near foot when pressed; lead a runner. | The engine aims 0.5-1 m away from the nearest marker. Shown in the reveal, not graded in v1. | v2 | SCW-B, ODP P5, LP12\* |
| PA8 | Runner in space? Pass in front of them. | Into space when the runner gets there first and is onside; to feet when the receiver is marked or coming short. | A space target with `pWin` ≥ 0.6, and the runner onside at the pass (F4). | v1 | EFL-2, ODP P3 |
| PA9 | Pick a teammate who can turn and face goal. | Prefer receivers who can turn. A player with their back to goal and a marker tight behind will have to set it back. | `room` ≥ 6 m and pressure < 0.3 = can turn; pressure ≥ 0.6 = under pressure. | v1 | ODP P2, P5; FA-R; SCW-F |
| PA10 | Never pass across the front of your own goal. | In your defensive third, no sideways ball across the face of your goal unless it is completely safe. | Both ends at x < 35, mostly sideways (\|dy\| ≥ 15 and > 1.5 \|dx\|), crossing x < 30, y 18-50, with `pLane` < 0.9: critical. | v1 | CAS, MM, BC |
| PA11 | At the end line, pull it back to the penalty spot. | In the final third, look for zone 14 and the "golden zone"; from the byline, cut the ball back low. | The value surface `V`; tags `zone-14` and `cut-back`. The golden zone yields about 50 % of shots and 82 % of goals `[S]`. | v1 | AFC, CV |
| PA12 | Long passes are hard; play them only when wide open. | Risk grows with length and flight time, so a long pass needs a very clear lane. | `pExec` = 0.96 at 25 m, 0.78 at 40 m, 0.5 at 50 m `[D]`. `too-long` below 0.85 (about 34 m). | v1 | USC, COI, HIC |
| PA13 | Nothing forward? Keep the ball and look again. | Keep possession when no forward pass is on: go sideways or back, then switch. | The best is a green square or back pass and no green forward pass is within 10 points: `keep-it`, which grades S. | v1 | ODP P6, P7; DNA |
| PA14 | Blocked? Pass to a friend who can set it up. | Third-man combination: A plays to B, B lays it off first time to C, who arrives on the defender's blind side. | Two-step rating (§4.8). | v2 | F3, USC; RESEARCH P7 |
| PA15 | Two of you, one of them? Draw them, then pass. | In a 2v1, carry at the defender until they commit, then release. | Needs a carry option and timing. | v2 | EFL-2, BC |

\* The U.S. Soccer U11-U14 learning plans (LP12/LP13) carry a "confidential" notice, although clubs post them publicly. Use them only as corroboration and never link them from the app.

**Links to the existing catalogue.** PA1 = F6. PA4 is B3 seen from the passer. PA6 ≈ B8. PA9 ≈ B7. PA11 ≈ P9/P10. PA14 = P7.
Proposal: add PA1-PA15 to `data/principles.json` as category `passing` (module "Pass it right"), each with a `related` field pointing to the B/P rows, so Elo tracks on-ball and off-ball skills separately.

## 3. Models and code (survey)

"In a browser" means rating about 13 options for 22 players well inside 10 ms. Only closed-form models qualify; the learned ones need proprietary training data, so fotbol takes their ideas and features, not their weights.

| Model (source key, §7) | What it rates | Needs | In a browser? | What fotbol takes |
|---|---|---|---|---|
| Spearman et al. 2017 (SPEAR17) | Who controls a pass first. Arrival time with a logistic spread (sigma 0.45 s), then control at rate 4.3/s. Right about the receiving team 80.5 % of the time and the exact receiver 67.9 %; it predicts 67.9 % completion against 78.9 % actual, so it is biased low. | Tracking with velocities | Yes: about 0.02 ms for 10 targets | The arrival-time form and sigma, and Eq. 11's pass value `P x S(kept) - (1 - P) x S(lost)`, which is our utility |
| LaurieOnTracking pitch control (MIT) | Spearman-style control surface. Code defaults: reaction 0.7 s, max speed 5 m/s, ball 15 m/s, keeper control x3 | Tracking | Yes | The constants `[S]`, reimplemented; no code copied |
| Power et al. 2017, KDD (POWER) | Risk = the chance a pass is completed; reward = the chance it creates a shot | Tracking and learned models | No | The risk-reward split (only the abstract was verified) |
| Anzer and Bauer 2022, expected passes (XPASS; CC BY) | XGBoost on 25 features; AUC 0.934 (events only: 0.881). The top features are a ball-speed window, then the receiver's distance to the nearest opponent | Proprietary tracking; no public model | No | Feature evidence for our receiver pressure and lane terms |
| Impect bypassed opponents (IMP); Rein et al. 2017 (REIN) | Opponents nearer their goal than the ball before the pass and not after it. Rein adds the gain in Voronoi space in front of goal (103 Bundesliga games) | Positions at release and reception | Trivial | The bypass count, in our own code and words ("Packing" is a trademark) |
| SkillCorner line breaks and passing options (SKC; open data, MIT) | A line is 2+ players of a fitted defensive template, broken "through" or "around". `passing_option` events carry `xpass_completion` (a graph network), `xthreat` (a goal within 10 s if completed) and `n_opponents_bypassed` | Their tracking | Not applicable | The definitions, and an offline calibration set (§6) |
| EPV, Fernández et al. 2021 (EPV) | Possession value split into pass, carry and shot; learned CNN surfaces | Tracking with velocities | No | The idea of a location value |
| xT, Singh 2019 (XT) | Value of a zone from events: `xT = s x g + m x Σ T x xT` | Events | A lookup | The idea only: the grid has no licence |
| VAEP, Decroos et al. 2019 (VAEP; socceraction, MIT) | Change in the chance of scoring minus conceding over the next 10 actions; CatBoost | Events | No | Count what losing the ball gives them: our `C(p)` |
| Goes et al. 2019 (GOES) | How much a pass disrupts the defence | Tracking at reception | After the fact | An idea for a v2 switch reward (only the abstract was verified) |
| Link et al. 2016, dangerousity (LINK; CC BY) | Zone x (control, pressure, density). The zone values come from principles; no table is published | Tracking | Yes | A structure check for our `V` |
| Bischofberger and Baca 2026, dangerous accessible space (DAS; code MIT) | Simulated passes over many angles and speeds, with logistic interception. Fitted on 3 Metrica games (Brier 0.076). Includes a 3-number expected-goals model | Tracking | About 4 ms for a full run; far less for 10 targets | A validation idea. Its MIT expected-goals model could replace our `V` near goal, with attribution, once its units are checked |
| Andrienko et al. 2017 and Herold et al. 2022 pressure (via databallpy, MIT) | A pressure oval: 9 m toward the goal, 3 m behind | Positions | Trivial | The oval `[S]`, reimplemented |

**Value grids and data: what we may ship.**
- **Never ship Karun Singh's xT grid** (12 x 8, values 0.0064-0.257). It has no licence, so treat it as all rights reserved.
- **The only permissive grids we found both carry provenance caveats:**
  - LaurieOnTracking's `EPV_grid.csv` (32 x 50, MIT): origin not documented, and it assumes a 106 x 68 pitch.
  - databallpy's `open_play_xT.npy` (264 x 196, MIT): trained on a private dataset.
  So v1 uses our own `V`.
- **Never redistribute** Impect's open data (its terms forbid it), StatsBomb's (its user agreement forbids it) or Metrica's sample data (no licence file).
- **SkillCorner open data** (MIT © 2020 SkillCorner; credit requested) is fine offline for calibration. Ask SkillCorner before shipping anything derived from it (MIT is written for software). Never fetch it at runtime, because fotbol makes no third-party requests.

## 4. Engine design

### 4.1 API

```js
// js/engine/passing.js: PURE (no DOM, no clock, no randomness), canonical frame (we attack +x)
export const PASS_DEFAULTS = { ... }                 // §4.3, every number tagged
export function rateOptions(frame, carrierId = frame.carrierId, params) → PassRating
// PassRating = { carrierId, ball, lines: { front, mid, back, secondLast }, options: PassOption[] /* score desc */,
//                best: PassOption, fwdOn: boolean /* a green forward option exists */ }
// PassOption = {
//   id,                         // 'us-LCM' (to feet) or 'us-LW@space' (into space)
//   targetId, kind: 'feet'|'space', point: Vec, aim: Vec /* PA7 far-foot point */, len,
//   pSafe, pLane, pExec, pWin,
//   blocker: { id, pInt, at: Vec, via: 'block'|'run' } | null,   // the defender most likely to cut it out, and where
//   receiverPressure: 0..1, presserId, room /* m of free run toward goal */,
//   bypassed /* opponents taken out (Impect's test) */, lineBroken: 'front'|'mid'|'back'|null,
//   value /* V_rec */, valueGain /* V_rec - V(ball) */, U, score: 0..100,
//   label: 'best'|'good'|'risky'|'cut-out'|'offside'|'danger', critical: boolean,
//   tags: [{ tag, principle, who?, n? }]  // §4.4
// }
export function gradePass(rating, choiceId, { accept = [] } = {}) → { score, grade, stars, outcome, isBest, option }
//   outcome: 'completed' | 'risky' | 'cut-out' | 'offside' | 'danger' (deterministic: we grade the decision, not the dice)
export function explainPass(rating, choiceId, { wording }) → { headline, yours: {text, principleId}, best: {text, principleId}|null, cue }
export const PASS_TAGS   // tag → { principles, severity, text: { standard, kid } }
export function value(p, P), valueOpp(p, P), laneRisk(ball, target, opponents, P, receiver?), pressureAt(p, opponents, P),
                roomAt(p, opponents, P), execProb(len, P)     // exported for tests, Explore overlays and the B3 rule
// js/engine/passdrill.js: PURE
export function checkPassDrill(scenario, { formations }) → { errors, frame, rating, best, margin, problems }
export function generatePassDrill({ seed, formations, role?, principle?, params }) → Scenario | null
export function passMoments(sequence, { formations }) → [{ t, carrierId, rating }]
```

### 4.2 Formulas (one pass option; ball B, target T, receiver R)

1. **Lane (interception).** Sample points `s` every 1 m, from 1 m past the ball up to the point where the receiver meets the ball (a space pass: up to 1 m short of the target).
   - Ball time: `t_b(s) = |s - B| / v_b`.
   - Defender time (Spearman): `tau_j(s) = t_r + |s - p_j| / v_max`, margin `m_j = max_s (t_b - tau_j)`.
   - `pRun_j = 1 / (1 + exp(-(pi/sqrt 3) m_j / sigma))`.
   - `pBlock_j = b_max * clamp(1 - (d_j - r) / w, 0, 1)`, where `d_j` is the defender's closest distance to the line.
   - `pInt_j = 1 - (1 - pBlock_j)(1 - pRun_j)` and `pLane = Π_j (1 - pInt_j)`. The keeper counts only inside his box + 2 m.
   - **Why a body block:** with static frames the reaction time never lets a defender who stands *in* the lane stop the ball (he gets about 47 % at 10 m), so blocking is geometric, as in rule `lane-open`.
   - **Meeting point:** the receiver steps toward the ball, so defenders beyond `a* = (t_rR + L/v_max) v_max v_b / (v_max + v_b)` metres don't count (to feet only). Without this, a defender 7 m from the receiver, who would lose that race easily, "intercepted" 43 % of a 31 m pass (fixture frame, their LW against our RCM).
2. **Execution (youth):** `pExec(L) = σ((L50 - L)/w) / σ(L50/w)`, with `L50 = 50 m`, `w = 8 m` `[D]`.
3. **Race into space:** `pWin = w_R / (w_R + Σ_j w_j)`, `w_i = k_i exp(-max(t_b, tau_i)/0.33)`. This is RESEARCH 5.8's soft pitch control, with keeper weight x3 in his box. The runner reacts in 0.3 s, defenders in 0.7 s. A feet pass has `pWin = 1`.
4. **Pressure on the receiver** (Andrienko et al. 2017, Herold et al. 2022; the direction was checked in databallpy's code):
   - `phi` = the angle between receiver→goal and receiver→opponent; `z = (1 + cos phi)/2`.
   - `L = d_back + (d_front - d_back)(z^3 + 0.3 z)/1.3`.
   - `p_j = (1 - d/L)^1.75` for `d < L`; `pressure = min(1, Σ p_j)`.
   - The zone is longest (9 m) toward the goal the receiver attacks.
5. **Room:** the distance to the first opponent in a ±45° cone toward goal, minus 3 m, capped at 8 m.
6. **Value (ours):** `V(p) = min(0.5, 3 (θ/π)^1.8 + 0.17 e^(-d/15))`.
   - `θ` = the angle the goal mouth subtends at p; `d` = the distance to the goal centre.
   - Values: own box 0.004, halfway 0.016, halfway on the wing 0.010, zone 14 0.085, edge of the box 0.143, penalty spot 0.254, byline on the wing 0.030.
   - Shaped like published xT/EPV surfaces (low and flat to halfway, steep and central near goal). It is not fitted to any data.
   - `V_rec = max(V(T), V(T + room x unit vector to goal)) + 0.003 x bypassed`.
7. **Loss cost:** `C(p) = 0.02 + 1.5 V_opp(p)`, with `V_opp(p) = V(105 - x, 68 - y)`. Losing the ball always costs something, and a turnover leads to a counter.
8. **Utility** (in goals; Spearman 2017 Eq. 11 with more outcomes; `q = 1 - 0.3 x pressure` is the chance to keep it after receiving):
   `U = pExec pLane pWin [q V_rec - (1-q) C(T)] - (1 - pLane) C(interception point) - pLane (1 - pExec) ½ C(T) - pExec pLane (1 - pWin) C(T)`
9. **Score:** `100 - (U_best - U) / 0.001` (1 point = 0.1 % of a goal), clipped to 0-100. Then:
   - green is floored at 60 (you kept the ball);
   - red is capped at 45;
   - critical is capped at 30 (a receiver offside now, F4, or PA10).
10. **Label:**
    - ★ `best`: the top option;
    - `cut-out`: `pSafe` < 0.5;
    - `good`: `pSafe` ≥ 0.8 and pressure < 0.6;
    - `risky`: everything else;
    - `offside` / `danger` for the critical cases.
    The board draws good as a solid green line, risky as dashed amber and cut-out as dotted red: colour-blind safe, because the pattern carries the meaning too.

**Options considered.** Every teammate is a "feet" option, including the keeper. Up to 3 "space" targets: for each onside runner (not a CB or GK) ahead of the ball, the best of {6, 12} m straight ahead or toward goal. A receiver offside now is critical; a runner must be onside, but the space target may be beyond the line. Only ground passes: chips, crosses and aerial switches are v2 (§6).

### 4.3 Parameters (`PASS_DEFAULTS`)

| Group | Values |
|---|---|
| Physics (`sigma` from Spearman 2017 §4; the rest LaurieOnTracking defaults) | `ballSpeed 15` m/s `[S]`, `reactionTime 0.7` s `[S]`, `maxSpeed 5` m/s `[S]`, `sigma 0.45` s `[S]`, `softTau 0.33` `[M]` (RESEARCH 5.8), `keeperWeight 3` `[S]`, `receiverReaction 0.3` s `[D]` |
| Block | `blockReach 1.0` m `[D]`, `blockSoft 1.5` m `[D]`, `blockMax 0.9` `[D]`, `skip 1` m `[D]`, `shield 1` m `[D]`, `step 1` m `[D]`, `keeperMargin 2` m `[D]` |
| Youth | `execHalf 50` m, `execWidth 8` m `[D]`. Optional youth physics profile: `ballSpeed 11`, `maxSpeed 3.7` `[D]`, scaled from U12 pass speed 8.8 m/s for a 5 m pass (HIC) and U13 peak speed 6.5 m/s (AH). The ratio stays about 3, so the answers barely change (§5.2). |
| Pressure (Andrienko/Herold) | `dFront 9` `[S]` (constant, as in Andrienko; databallpy, after Herold 2022, shrinks it nearer goal: 9 - 0.05 x (105 - distance to goal)), `dBack 3` `[S]`, `pressureExp 1.75` `[S]`, `loseAtFullPressure 0.3` `[D]`, `roomCap 8`, `roomCone 45`, `roomMargin 3` `[D]` |
| Value and cost | `vA 3, vK 1.8, vB 0.17, vL 15, vMax 0.5`, `bypassBonus 0.003`, `possessionCost 0.02`, `transitionFactor 1.5` `[D]` |
| Scoring and labels | `pointValue 0.001`, `green 0.8`, `red 0.5`, `pressureHigh 0.6`, `redCap 45`, `criticalCap 30`, `safeFloor 60`, `tooSafeCap 79`, `bestMargin 5`, `switchLateral 25`, `squareBand 3`, `ownGoalZone {x1 30, y0 18, y1 50}`, `ownGoalLateral 15`, `leads [6, 12]`, `maxSpaceTargets 3` `[D]` |

Numbers two modules must share get a test that holds them equal, as today (ARCHITECTURE §1). Examples: `lane-open` and `laneRisk`, which should become one function (§4.7), and `offsideLineX`.

### 4.4 Tags, principles and kid sentences

For a non-best option, explain the most severe problem. For the best, say why it is best, plus a caveat when it is amber. For a green non-best option, name its strength unless there is a real problem.

| Tag | When | Principle | Kid (≤ 12 words) | Standard (one sentence) |
|---|---|---|---|---|
| `blocked` | the top blocker's `pBlock` ≥ `pRun`, `pInt` ≥ 0.3 | PA4 | Their midfielder is in the way. | Their #6 is standing in the passing lane and would cut it out. |
| `reachable` | the top blocker gets there by running | PA4, PA12 | Their defender can get to the ball first. | Their left-back can get across before the ball arrives. |
| `beaten-to-it` | space pass, `pWin` < 0.6 | PA8 | Their defender gets to that space first. | Their centre-back reaches that space before your runner. |
| `too-long` | `pExec` < 0.85 | PA12 | That pass is long, so it is hard to get right. | A pass that long is hard to play accurately, so it needs a wide-open lane. |
| `under-pressure` | pressure ≥ 0.6 | PA3, PA9 | Your teammate has a defender right on them. | Your #8 has their #8 tight behind and can't turn. |
| `free` / `can-turn` | pressure < 0.15 / room ≥ 6 m | PA3 / PA9 | Your teammate is free, with nobody close. / They can turn and run at goal. | Your left-back has time and space. / Your #8 can turn and run at their back line. |
| `breaks-first-line` / `-midfield-line` / `in-behind` | line crossed (§4.2) | PA5 | It gets past their front players. / It goes past their midfielders. / It gets in behind their defenders! | This pass takes 3 opponents out of the game. |
| `switch` | ≥ 25 m across into the far half | PA6 | Switch it to the free side. | Switching play moves the ball away from the crowd to the free side. |
| `into-space` | space target, onside runner | PA8 | Pass into space so they run onto it. | A pass into space lets your winger run onto it. |
| `zone-14` / `cut-back` | target in zone 14 / byline cut-back | PA11 | It reaches the space right in front of their box. / Pull it back to a teammate in front of goal. | It finds a teammate in the most dangerous area in front of their box. |
| `too-safe` | safe square or back pass while a green forward pass within 10 points of the best was on | PA2 | Safe, but a forward pass was on. | It keeps the ball, but a safe forward pass was on. |
| `keep-it` | best is safe sideways or back, nothing forward is on | PA13 | Nothing forward? Keep the ball and look again. | With nothing forward on, keeping the ball is right. |
| `across-own-goal` | PA10 geometry, `pLane` < 0.9 | PA10 | Never pass across the front of your own goal. | A pass across your own goal gives them a chance if it is cut out. |
| `offside` | receiver beyond the line now | F4 | Your teammate is offside there. | Your winger is offside, so the pass would be given against you. |

Names come from `rules/_util.js` `nameOf` / `kidNameOf`. Text is second person, never names a side of the screen and uses "they" (ARCHITECTURE §5.3); kid strings are at most 12 words (a test counts them). Explanations also draw the reason on the pitch: the blocker gets a ring and a cross at the interception point, a broken line gets a `line-x` overlay, and a space pass gets the runner's arrow.

### 4.5 The pass drill

**Scenario format.** A normal ball-scripted scenario (ARCHITECTURE §5.3) with the following changes:
- `answer: { mode: 'pass', best?: 'us-LCM', accept?: ['us-RCM'], space?: false }`.
- `question` defaults to "Who do you pass to?" (kid: "Who's open?").
- `moment: 'in_possession'`, and `learner.role` is the carrier's role.
- `misconceptions` may key a choice (`{ choice: 'us-DM', text, textKid }`) instead of a region.
- It is judged on `frameAt(s, freezeAt, { formations, learnerId: null })`. Nobody is held back, and the timeline's carrier key puts the learner on the ball. `validateScenario` must check that the carrier at `freezeAt` is `learnerId(s)`.

**Flow.** This follows the sister doc's §5.4, with engine hooks added.
1. **Watch** 2-3 s: the ball arrives at YOU.
2. **Freeze.** Teammates become big tap targets. At level 2 the space targets appear as faint arrows ahead of runners; at level 3 they are hidden, and a tap on grass snaps to a space target within 5 m. Holding previews the line and releasing plays it. A 3-4 s clock at level 3.
3. **Consequence** (animated): completed, "Cut out!" (the ball goes to `blocker.at` and possession flips), "Risky!", or "Offside!".
4. **Reveal.** Every option drawn with its label and line style, ★ on the best, one kid line for yours and one for the best (§4.4), with principle chips.
5. **Next · Why? · Try again.** Why? opens the standard panel: `pSafe`, pressure, players bypassed and the value gain. Never call the count "Packing" (an Impect trademark).

**Grading** (`gradePass`):
- **S:** the best, or a green option within `bestMargin` (5) points of it. Coach-keyed `accept` ids also count as best.
- **Otherwise:** the option's score, capped at 89.
- **Safe but slow** (`too-safe`): a green option is never below 60 and never above 79, so B or C.
- **Cut out:** always F (≤ 45).
- **Critical:** ≤ 30.
- **Stars:** S 3, A 2, B 1 (`rewards.starsFor`).
- **Elo:** updated with `score/100` on the scenario's PA principles. The history entry adds `{ mode: 'pass', choice, outcome }`.

**Quality gates** (`checkPassDrill`, run by `npm run check`):
- the carrier at the freeze is the learner;
- the engine's best leads the best non-accepted option by at least 8 points;
- the best is not red;
- at least 3 options are not red;
- at least one decoy: a red option to a receiver who *looks* free (pressure < 0.15), or a `too-safe` option;
- a keyed `answer.best` is the engine's best or within `bestMargin` of it (the "key disagreement" check, like `ideal`);
- the mirror passes the same gates.

### 4.6 Generating pass drills

1. **From scenes** (`generatePassDrill`):
   - A seeded RNG (`sequence.js createRng`) picks a ball spot near the learner role's formation spot.
   - `autoFrame({ possession: 'us', carrierId: learner })` places the players, with optional press variants (`presserId`, or an extra presser).
   - It writes a 2 s lead-in: a pass from the nearest teammate, a carrier key for the learner, and `freezeAt` about 0.5 s after the reception.
   - It rates `frameAt(freezeAt)`, not the sample, because blends move the players.
   - It keeps the drill if the §4.5 gates pass and, when asked, if the best's top tag teaches `principle` (for trap principles PA4, PA10 and PA12, if a decoy carries that tag).
   - The id is `pass-<role>-<seed>`, and the drill replays exactly from the seed, like Live.
2. **From Live sequences** (`passMoments`): every reception by us in `generateSequence`, rated about 0.4 s after the touch. These power a "Pass Live" mode: the sequence pauses at our receptions, the kid taps, and play continues. A later version branches the sequence on the kid's pass.
3. **Templates for lessons plain scenes rarely produce:**
   - **Switch:** 2 of 299 scenes had a switch as the best pass. The template packs the ball side with 3 opponents via `overrides` and puts our far full-back and winger wide and free.
   - **Across our own goal:** a centre-back on the ball at the corner of the box with their #9 lurking.
   - **Third man:** A to C blocked; B free and facing.
   - **Safe side:** a tight marker on one side of the receiver.
   The gates apply the same way.
4. **Authored drills** (`#/author`, a pass-answer mode) stay the backbone of each module's first reps, keyed by coaches through `answer.best`/`accept`. Generated drills fill practice volume and spaced review.

### 4.7 Fitting it into the codebase

- `passing.js` imports only `geometry.js`, `pitch.js`, `roles.js` and `rules/_util.js` (`nameOf`), and computes its own opponent lines. It must not depend on the positioning context.
- **One lane model.** Make B3's `lane-open` rule call `laneRisk(ball, spot, opponents)` so that "open" means the same off and on the ball. RESEARCH 5.5 already plans this ("v2 replaces this with P_lane"). Re-run `tests/integration.test.js`, `npm run check` and the sanity report afterwards.
- **`scenario.js`:** `ANSWER_MODES` gets `'pass'`.
- **`timeline`:** unchanged.
- **`scripts/check-scenarios.mjs`:** calls `checkPassDrill` for pass scenarios.
- **`board.js`:** a `warn` tone (amber dashed), a dotted `bad` line style, a `★` label, and `enablePick({ ids, onPick, onPreview })` for tap-to-pass.
- **`reveal.js`:** a pass variant of `showFull`.
- **New mode** `js/ui/modes/pass.js`, or a `kind` switch in `drill.js`.
- **Explore:** a "pass map" toggle when we have the ball, drawing `rateOptions` live while you drag the ball.
- **Content:** `data/principles.json` (PA1-PA15), `data/curriculum.json` (module "Pass it right"), `tests/content.test.js` (`RULE_REFS` → pass tags), `tests/manifest.js` (new test files), and ARCHITECTURE §5 and ROADMAP in the same change.

### 4.8 Later (v2)

- **Third man (PA14):** for a high-value target C that is red, find B with A→B green. Rate B→C from B's spot with defenders' reaction reduced by the first pass's flight time. Tag B `third-man → C` and score it `γ = 0.9` x the two-pass utility.
- **Draw then pass (PA15)** needs a "carry" option.
- **Chipped and aerial passes:** no body block, lower `pExec`, a longer flight.
- **Velocities** from real tracking (RESEARCH 6.4) turn the static `tau` into Spearman's full form.

## 5. Prototype results

The prototype mirrors §4.2 exactly. It is a scratch ES module importing the repo's engine read-only, run with Node 24.

### 5.1 Seven test frames

One fixture and six `autoFrame` scenes, with our player named as the carrier.

| Frame (carrier) | ★ Best (score, safety) | Why (kid line, principle) | Runner-up and typical wrong picks |
|---|---|---|---|
| Fixture `ipBuildUp` (LCB at 22,26, unpressed) | #8 (LCM), 24 m, pSafe 0.92, 3 bypassed: 100 | It gets past their front players. (PA5) | RCM 90, LB into space 88, LB 88; RCB square 86 and GK back pass 79, both graded B (`too-safe`); #9 and wingers cut out |
| Our GK build-up (6,30) | RB into space (30,55), pSafe 0.86: 100 | It gets past their front players. (PA5) | The back four score 93-95: no clear best, so not a drill; #6 with their #9 on his back 60; RCM and #9 cut out |
| LB pressed on the touchline (30,8) | LW down the line, 25 m, pSafe 0.67 (risky), 6 bypassed: 100 | It goes past their midfielders. (PA5) | LCB 3 m square 86 (risky); 38 m back pass to the GK 60 (a misplaced ball in front of our goal); every inside pass cut out by the presser |
| #6 in the centre circle (45,34) | Back to a CB: 100 | Nothing forward? Keep the ball and look again. (PA13) | Full-backs 90; #8s risky 78 (a marker tight behind, pressure 0.64); wingers and #9 cut out |
| LCM in the left half-space (58,22) | RCM beyond their midfield line, 20 m, pSafe 0.91: 100 | It goes past their midfielders. (PA5) | #9 risky 78 (their #6 half in the lane); CBs 72-73 (`too-safe`); through balls beaten by their CBs |
| RW in the final third (82,56) | #6 recycle: 100 | Nothing forward? Keep the ball and look again. (PA13) | RCM 83; every ball into their packed box cut out |
| LW near the byline (97,8) | #6 at the edge of the box, cut-back, pSafe 0.85: 100 | Pull it back to a teammate in front of goal. (PA11) | LCM 80; the cut-back to the spot is blocked by their #6 |

**Grading the fixture frame (`gradePass` on every option):** S: LCM 100. A: RCM 89, LB into space 88, LB 88, RB 83. B: RCB 79 and GK 79 ("Safe, but a forward pass was on."), #6 75, RB into space 74 (risky). F: RW into space 45, #9 42, LW 38, RW 34 ("Their winger can get to the ball first.").

### 5.2 Scale, generation and robustness `[M]`

- **Speed:** 0.30 ms per frame (13 options), 0.42 ms mean over 299 scenes (Node 24, dev laptop): far inside Live's 10 Hz budget.
- **Mirror:** swapping left and right (y → 68 - y, roles L↔R) gives identical scores.
- **Label mix** over the 3,887 options in the grid: 26 % good, 16 % risky, 58 % cut out (about 3.4 good options per scene).
- **Grid generation:** 299 scenes (ball at x 8-96 step 4, y 4-64 step 5; our nearest outfielder on it). 123 (41 %) pass the §4.5 gates; the failures are mostly "no clear best" (164). The best pass teaches PA5 in 50 (46 of them beat the midfield line), PA13 in 38, PA11 in 25 (zone 14 19, cut-back 6), PA2 in 6 and PA3 in 4. Only 2 of 299 bests are a switch, hence the templates in §4.6.
- **Live moments:** 30 seeds x 45 s gave 213 passes by us; 52 (24 %) pass the gates.
- **Sensitivity** (best pass unchanged, or within 5 points of the variant's best): reaction 0.5 s 93 %, 0.9 s 97 %; sigma 0.3 99 %; blockMax 0.7 99 %; youth speeds (ball 11 m/s, run 3.7 m/s) 99 %; possessionCost 0.01 or 0.03 100 %; transitionFactor 1 or 2 100 %; bypassBonus 0 99 %; no execution penalty 97 %; receiver reaction = defenders' 95 %.
- **Best pass by third** (forward / square / back): defensive 61 / 29 / 1, middle 80 / 8 / 29, final 22 / 25 / 44. Its label (good / risky / cut out): 79 / 10 / 2, 90 / 27 / 0, 68 / 23 / 0.

### 5.3 What the prototype changed in the design

- **v1 put scores in a narrow band**, 88-100 for every safe pass, when they were normalised by the cost of losing the ball here. Near our goal that cost is huge. The fixed point value (1 point = 0.1 % of a goal) spreads them, and the category caps give the partial credit the owner asked for.
- **Without the receiver stepping to the ball**, a defender 7 m from the receiver "intercepted" 43 % of a 31 m pass the receiver would easily have met first.
- **Without the execution curve**, 45-55 m ground passes from the keeper rated safe.
- **Without a possession cost**, a 48 % pass into the #9 beat a safe pass in midfield.
  - With the cost, a red pass is recommended only when every option is red: 2 of 299 scenes, a full-back trapped at our corner flag and its mirror.
  - Those scenes need a "clear it" (or "keep it and shield") option that v1 does not have.

### 5.4 Side finding: Live plays passes through defenders

`gradePass` on the passes `generateSequence` actually plays (213 by us) gives S 54, A 41, B 46, C 14, D 3 and F 55.
- 47 of the 55 F grades are body blocks: a defender 0.2-2 m from the line in the playback frame, 24 of them within 1 m.
- The generator checks lanes on its key-time `autoFrame`, but the frame the viewer sees is blended, settled and separated.
- A weight of 0.03 still gets picked among about 10 options.

**Fix:** pick the pass with `rateOptions` on the rendered frame (a softmax over `U`). This also makes Live look smarter. It changes every seeded sequence, so the tests that pin seeds need new values.

## 6. Risks and open questions

1. **Static frames.** No velocities, body shape or first touch, so "can turn" and "safe side" are proxies and interception ignores momentum.
   - Keep the labels conservative, and teach body-shape lessons (PA7, PA9) with authored drills.
   - Add velocities from tracking data later (RESEARCH 6.4).
2. **Pro physics in a youth app.** The Spearman constants are fitted to professionals.
   - A youth profile barely changes the answers (99 %), because the ball-to-runner speed ratio stays about 3.
   - The real youth knob is the execution curve (`execHalf` 50 m), which is a guess. Get a coach to check it and offer an easier setting at level 1.
3. **Our value surface and costs are `[D]`, not fitted.**
   - Rankings are robust to them (§5.2), but the scores are not calibrated.
   - Calibrate offline on SkillCorner's open data (SKC: MIT, 20 A-League games). Its `passing_option` events carry `xpass_completion` and `xthreat`, so we can compare our `pSafe` (a reliability curve) and our `V`.
   - Expect `pSafe` to be pessimistic. Spearman's own model under-predicts completion (67.9 % against 78.9 %), and ours labels 58 % of all options as cut out.
   - Never ship the raw data (RESEARCH 6.3).
4. **A bias toward recycling.** In the final third the best is a back pass in 44 of 91 scenes. The causes: the HELIOS box is packed, there are no runs, and there are only 3 space targets.
   - Kids could learn "always go back".
   - Add space targets at the P10 box zones, author final-third drills, and let coaches key `accept`.
   - Keep `too-safe` only when a *green* forward pass exists.
5. **Layer-A artefacts carry over into drills.** Example: our LCB standing 3 m from the pressed LB. Generated drills need the gates, a look in the author tool before they are promoted, and coach keying (ROADMAP Next 1).
6. **We grade the decision, not a dice roll.**
   - The consequence animation shows the most likely outcome: cut out when `pSafe` < 0.5, "Risky!" for amber.
   - It never shows a random success or failure, so two kids with the same choice get the same result.
7. **Thresholds for young players.** Green ≥ 0.8 and red < 0.5 are `[D]`. The sister doc suggests easing the cut-offs at low levels, as Chess.com does, so make them level parameters.
8. **Risk in the final third.** Coaches accept more risk there (BC), and the model allows risky bests there (23 of 91). The copy should say "Risky, but worth it" rather than praise safety alone.
9. **The keeper on the ball.** `LEARNABLE_ROLES` excludes the GK (v1.1). Keeper-distribution drills need the GK role, or a learner who is "the team".
10. **Offside detail.** Level is onside, and a space runner must be onside at the pass. There is no offside from a throw-in, goal kick or corner (IFAB Law 11; S5), so set-piece pass drills must switch the check off.
11. **Licences and copyright.** No third-party code or grids (§3). Coaching sources are paraphrased. Don't link LP12/LP13 from the app.

## 7. Sources

All pages were opened on 2026-09-27. Items marked (v) had their key claim re-checked at the source by the lead researcher; the others were checked by a research sub-pass that opened each page.

**Coaching and youth research**
- **J20** (v): Jordet et al. 2020, *Frontiers in Psychology* 11:553813. <https://pmc.ncbi.nlm.nih.gov/articles/PMC7573254/>
- **J13:** Jordet, Bloomfield and Heijmerikx 2013, MIT SSAC. <https://www.sloansportsconference.com/research-papers/the-hidden-foundation-of-field-vision-in-english-premier-league-epl-soccer-players>
- **ODP** (v): US Youth Soccer ODP Player Manual (2017), principles 2-7 and 9. <https://www.usyouthsoccer.org/wp-content/uploads/sites/160/2023/09/Player-Manual-US-Youth-Soccer-ODP.pdf>
- **USC:** U.S. Soccer Curriculum (2011; a copy hosted by a club). <https://cdn1.sportngin.com/attachments/document/0020/5055/Full_U.S._Soccer_Coaching_Curriculum.pdf>
- **GR:** U.S. Soccer Grassroots 11v11 Player Development Framework. <https://static.ussdcc.com/users/227808/458431/us-soccer-grassroots-11v11-player-development-framework.pdf>
- **LP12/LP13:** U.S. Soccer U11-U12 and U13-U14 learning plans. They carry a confidentiality notice; use for corroboration only.
- **DNA** (v): The FA, England DNA "In possession". <https://www.thefa.com/bootroom/resources/england-dna/how-we-play/in-possession>
- **The FA and England Football:**
  - **FA-R:** "Developing receiving skills". <https://www.thefa.com/bootroom/resources/coaching/in-possession-developing-receiving-skills>
  - **FA-P:** "Take a picture". <https://www.thefa.com/bootroom/resources/coaching/take-a-picture>
  - **EFL-2:** "Two-player core football moves". <https://learn.englandfootball.com/articles-and-resources/coaching/resources/2023/Two-player-core-football-moves>
- **FIFA Training Centre:**
  - **F3:** third-player combinations. <https://www.fifatrainingcentre.com/en/game/game-analysis/in-possession/third-player-combinations.php>
  - **FS** (v): switch of play. <https://www.fifatrainingcentre.com/en/game/game-analysis/in-possession/switch-of-play.php>
  - **FF:** playing forward centrally. <https://www.fifatrainingcentre.com/en/practice/elite-sessions/in-possession/improving-the-ability-to-play-forward-centrally.php>
- **FFA-CP:** Football Australia, *The Football Coaching Process*. <https://footballaustralia.com.au/sites/ffa/files/2017-09/The%20Football%20Coaching%20Process_sojtrxt7i5ka18k1ws5awk14f.pdf>
- **BC:** BC Soccer (Canada), B Licence pre-course manual. <https://www.coachcentre.ca/Downloads/1071/B%20PRETEST%20pre-course%20material.pdf>
- **CV:** Coaches' Voice, attacking in the final third. <https://learning.coachesvoice.com/cv/in-focus-attacking-in-the-final-third-crossing-and-finishing/>
- **Soccer Coach Weekly:**
  - **SCW-B:** back-foot and front-foot passing. <https://www.soccercoachweekly.net/drills-and-games/drills/back-foot--front-foot-tactic>
  - **SCW-F:** the way players are facing. <https://www.soccercoachweekly.net/drills-and-games/drills/soccer-attack-drill-for-the-way-players-are-facing>
- **AFC** (v): Hobbs 2021, cut-backs and the golden zone. <https://analyticsfc.co.uk/blog/2021/04/28/developing-new-metrics-cutbacks/>
- **CAS** (v): Harves, never play it across your own goal (youth goal kicks). <https://coachingamericansoccer.com/tactics-and-teamwork/defending-soccer-goal-kicks/>
- **MM:** The Mastermind Site 2020, playing out from the back. <https://themastermindsite.com/2020/08/29/playing-out-from-the-back-the-basics/>
- **Youth physical numbers:**
  - **HIC** (v): Hicheur et al. 2017, *PLoS ONE* 12(9):e0185460: U12 pass speed 31.7 km/h, 1.10 s from cue to kick. <https://pmc.ncbi.nlm.nih.gov/articles/PMC5617197/>
  - **AH:** Al Haddad et al. 2015, *IJSPP*: U13 peak match speed 6.5 m/s. <https://martin-buchheit.net/2015/02/08/peak-match-speed-and-maximal-sprinting-speed-in-young-soccer-players-effect-of-age-and-playing-position/>
  - **COI:** Coito et al. 2023, *Children*: youth pass lengths. <https://pmc.ncbi.nlm.nih.gov/articles/PMC9856864/>

**Models**
- **SPEAR17:** Spearman, Basye, Dick, Hotovy and Pop 2017, MIT SSAC. <https://static.hudl.com/craft/downloads/SSAC17-Physics-Based-Modeling-of-Pass-Probabilities-in-Soccer.pdf>
- **POWER:** Power, Ruiz, Wei and Lucey 2017, KDD (abstract only). <https://doi.org/10.1145/3097983.3098051>
- **XPASS:** Anzer and Bauer 2022, *Data Mining and Knowledge Discovery* 36:295-317. <https://doi.org/10.1007/s10618-021-00810-3>
- **IMP:** Impect open-data documentation and KPI definitions. <https://github.com/ImpectAPI/open-data>
- **REIN:** Rein, Raabe and Memmert 2017, *Human Movement Science* 55:172-181 (abstract only). <https://doi.org/10.1016/j.humov.2017.07.010>
- **SKC:** SkillCorner open data and its Dynamic Events specification. <https://github.com/SkillCorner/opendata>, <https://26560301.fs1.hubspotusercontent-eu1.net/hubfs/26560301/Guides/Dynamic%20Events/20250216%20-%20Dynamic%20Events%20CSV%20Specifications.pdf>
- **EPV:** Fernández, Bornn and Cervone 2021, *Machine Learning* 110:1389-1427. <https://doi.org/10.1007/s10994-021-05989-6>
- **XT** (v): Singh, "Introducing Expected Threat". <https://karun.in/blog/expected-threat.html>
- **VAEP:** Decroos et al. 2019, KDD. <https://arxiv.org/abs/1802.07127>
- **GOES:** Goes et al. 2019, *Big Data* 7(1):57-70 (abstract only). <https://doi.org/10.1089/big.2018.0067>
- **LINK:** Link, Lang and Seidenschwarz 2016, *PLoS ONE* 11(12):e0168768. <https://doi.org/10.1371/journal.pone.0168768>
- **DAS:** Bischofberger and Baca 2026, *Journal of Big Data* 13:76. <https://doi.org/10.1186/s40537-026-01387-8>; code at <https://github.com/jonas-bischofberger/accessible-space>
- **ANDR** (v): Andrienko et al. 2017 and Herold et al. 2022, as implemented in databallpy `features/pressure.py`, which confirms the direction and `max_d_front` of 9 m. <https://github.com/Alek050/databallpy/blob/main/databallpy/features/pressure.py>

**Code and data licences** (each LICENSE file read through the GitHub API):
- LaurieOnTracking: MIT, © 2021 Friends-of-Tracking-Data-FoTD.
- socceraction: MIT, © 2019 KU Leuven Machine Learning Research Group. It ships no xT grid.
- un-xPass: Apache-2.0, © DTAI KU Leuven. Code only.
- databallpy: MIT, © 2023 Oonk and Grob.
- kloppy: BSD-3-Clause, © 2020 PySport.
- SkillCorner/opendata: MIT, © 2020 SkillCorner.
- accessible-space: MIT, © 2024 Jonas Bischofberger.
- Karun Singh's xT page (v): no licence or reuse terms.
