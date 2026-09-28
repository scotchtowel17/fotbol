# Player mode: the kid-first redesign (spec and build contract)

**Audience:** players about 10–14 (designed for 11). **Status:** spec for the build that follows; binding for file ownership and contracts. The evidence is in [research/kid-learning.md](research/kid-learning.md) (rules R1–R42), [research/kid-apps-teardown.md](research/kid-apps-teardown.md) (patterns and proposed structure), [research/kid-audit.md](research/kid-audit.md) (what was wrong, measured) and [research/passing.md](research/passing.md) (the passing engine).

## 0. The rules every Player-mode screen follows

1. **One screen, one job.** During Watch and Decide only the pitch, YOU and at most one line of text are visible (R7).
2. **Play first, words later.** First drag within 15 s of first open, no tour, no sign-up (R13).
3. **Word budgets:** brief ≤ 12 words, question ≤ 12, reveal line ≤ 14, everything before "Why?" ≤ 30 (R2). Home ≤ 25 words (teardown 5.2).
4. **Reading age 9:** Flesch-Kincaid grade ≤ 4 for Player-mode copy, checked in CI (R1).
5. **The pitch is the explanation:** ring on the best spot, arrow from you, ≤ 2 highlighted cues, labels on the pitch (R8).
6. **Stars, never grades:** 0–3 stars plus one word (Spot on / Great / Close / Not yet). No letters, no "/100", never "F" (R18). Praise the move, not the player (R19).
7. **Football, not nursery:** broadcast-style, bold numerals, no cartoon mascot, no "kid", no "!!!" (R5, R30).
8. **Plain football words:** forward / back / toward the middle / toward the sideline; no metres in Player mode (the arrow carries distance); no principle codes; no role codes on screen (use names and shirt numbers) (audit §5).
9. **Honest, safe rewards:** stars and XP come from good positions and improvement, never from time spent or finishing; no streak that can break (days played this week only goes up); no chance rewards; no comparison with others; big celebrations only for real milestones (R21, R28, R29, R35, R36).
10. **Touch-first:** 44 px targets, tap-YOU-then-tap-a-spot as a full alternative to dragging, keyboard help only after a key press (R10, R11).
11. **Nothing leaves the device** (R38). One sentence says so on the card screen.

## 1. Two modes

- `settings.mode`: `'player'` (default for everyone) or `'coach'`.
- **Player mode** is the new experience below (routes in §2, code in `js/ui/player/`). Player mode always uses simple wording.
- **Coach mode** is today's full app, unchanged in substance: detailed wording, scores out of 100, S–F grades, principle codes, Explore, Learn library, Progress, Author, Live analytics, export/import. Its home moves to `#/coach`; all its existing routes keep working.
- The word "Kid" disappears from the UI. The wording setting becomes **"More detail"** (Coach mode only; off = simple wording).
- Switching: Player mode's settings sheet has "Coach or parent? Open Coach mode"; Coach mode's header has "Back to Player mode".

## 2. Player-mode routes

| Route | Screen | Owner |
|---|---|---|
| `#/` | Home (first open without a profile → `#/kickoff`) | shell |
| `#/kickoff` | Kick-off screen, then "What do you play?" | shell |
| `#/kickoff/kit` | "Make it yours" (after the first set; skippable) | shell |
| `#/play` · `#/play/<nodeId>` · `#/play/first` | "Find your spot" set (next node; a given node; the onboarding set) | play |
| `#/pass` · `#/pass/<nodeId>` | "Who's open?" passing set | pass |
| `#/matchday` | Match day (simplified Live) | play |
| `#/card` | Your card: player card, sticker album, badges, kit locker | shell |

Coach mode keeps `#/coach` (old home), `#/drill`, `#/explore`, `#/learn`, `#/live`, `#/progress`, `#/author`, `#/trophies`, `#/credits`, `#/dev`.

## 3. The Road (`data/road.json`, helpers in `js/ui/player/road.js`)

Chapters of nodes; each node is a **set** of 5 reps about one to three related principles (thin content per principle means nodes group ideas).

```jsonc
{
  "version": 1,
  "groups": { "DEF": ["CB","FB"], "MID": ["DM","CM"], "WING": ["W"], "STRIKER": ["ST"] },
  "chapters": [
    { "id": "defend", "title": "Defend together", "nodes": [
      { "id": "close-down", "kind": "spot", "title": "Close Them Down", "icon": "press", "principles": ["D1", "D2"] },
      { "id": "back-up", "kind": "spot", "title": "Back Up Your Buddy", "icon": "cover", "principles": ["D3", "D4"] },
      { "id": "goal-side", "kind": "spot", "title": "Between Them and Goal", "icon": "shield", "principles": ["D5", "T3", "U8"] },
      { "id": "defend-match", "kind": "mix", "title": "Big Match", "icon": "trophy", "from": "defend" } ] },
    { "id": "help", "title": "Help the ball", "nodes": [ /* get-open B3 B4 · stay-wide B1 B6 B2 · between-lines P2 P1 B5 · crosses P10 · help-match mix */ ] },
    { "id": "passing", "title": "Pass it right", "nodes": [ /* kind "pass": free-player PA3 PA4 · play-forward PA2 PA5 · free-side PA6 PA8 · safe-back PA10 PA13 · pass-match mix */ ] },
    { "id": "shape", "title": "Move as one", "nodes": [ /* hold-line U4 U3 R1 · slide U2 U5 R2 · guard-middle R3 U7 T2 · high-mid-deep U6 U1 · shape-match mix */ ] }
  ]
}
```

- **Set building (`buildSet(node, { index, profile, rewards, skills, seed })`):** 5 reps. For `spot` nodes: authored scenarios whose principles intersect the node's, preferring the player's position group, mirrored when the side differs; top up with **generated** spot drills (§6.2) for the player's position; include 1 recall rep from an earlier node when one exists (R23). For `pass` nodes: generated pass drills (§6.1) focused on the node's principles plus authored pass drills if any. `mix` nodes draw from the whole chapter. Deterministic for a given seed.
- **Node stars:** after a set, `setStars = average rep stars` → node stars = max(previous, 3 if ≥ 2.5, 2 if ≥ 1.8, 1 if ≥ 1, else 0).
- **Unlocks:** a node opens when the previous node has ≥ 1 star; chapter "Pass it right" also opens after chapter 1's first node (kids love passing). Match day unlocks when chapter 1's Big Match has ≥ 1 star.
- **Next up:** the first unlocked node with < 3 stars, in order.
- Player profile (store key `'player'`): `{ group: 'DEF'|'MID'|'WING'|'STRIKER', role (default per group: DEF→LB, MID→LCM, WING→LW, STRIKER→ST), onboarded: bool, road: { [nodeId]: { stars, plays } } }`.
- "Days played this week" is derived from the rewards state's training days: `weekDaysPlayed(rewardsState, today)` in `js/rewards.js` (Monday-start week, counts only up within the week). No separate storage.

## 4. Screens

### 4.1 Kick-off (first open) — owner: shell (+ play for the reps)
1. **Kick-off:** full-bleed pitch with a real drill replaying behind the wordmark (dimmed, no sound), one big **Play** button, a small "Coach or parent?" link. ≤ 6 words.
2. **"What do you play?"** four big shirt buttons: Defender · Midfielder · Winger · Striker. Choice → profile → `#/play/first`.
3. **`#/play/first`** (owner: play): 3 easy reps from the player's group. Rep 1 is a **worked example**: after the freeze a ghost hand drags YOU to the best spot, YOU snaps back, then "Your turn". Rep 2: glow aid (the ring glows warmer as you get close). Rep 3: no aid. Then Full time (§4.5), then `#/kickoff/kit`.
4. **Make it yours** (skippable): kit colour (unlocked swatches), shirt number (big number grid), nickname from a pick-list. → Home.

### 4.2 Home (≤ 25 words) — owner: shell
- **Top bar:** your token (kit colours, shirt number) and nickname, a level ring with the rank word, card icon (→ `#/card`), settings cog.
- **Hero:** big **Play** button with "Next: Back Up Your Buddy · 5 plays".
- **The Road:** vertical path of node circles with icon and 0–3 stars; current node pulses; locked nodes grey; chapter titles as section labels.
- **Two tiles:** **Who's open?** (quick passing set) and **Match day** (locked until unlocked, showing a lock and "Finish Big Match").
- "Days played this week: ●●○○○○○" small, only ever fills.
- Nothing else. No tabs.

### 4.3 "Find your spot" rep (about 20 s) — owner: play
1. **Set (1 s):** role card "You're the left back" over the pitch; YOU pulses. If the position differs from the profile: "Now you're the striker" card with the token glowing.
2. **Watch (3–6 s):** play runs; only YOU, the ball and ≤ 4 key players at full strength, others dimmed 40 % (spotlight).
3. **Freeze:** whistle sound; the question (≤ 12 words, e.g. "Their winger has the ball. Where do you go?").
4. **Move:** tap YOU then tap a spot, or drag. Aids by level: glow → none. "Watch again" small button.
5. **Lock:** big **Lock it** button (Enter also locks). No confidence step in Player mode.
6. **Reveal (tap-paced, never timed):** best-spot ring + arrow from your spot; stars pop (0.6 s chime; confetti only for the first 3-star of the set); one word (Spot on / Great / Close / Not yet) and one line ≤ 14 words from the top reason in simple wording (e.g. "Get between your striker and our goal."). Buttons: **Next** (primary), **Why?**, **Try again** (only after 0–1 stars: replays the mirrored twin), **See what happens** (continuation replay from your spot).
7. **Why?** opens a sheet: the principle's kid name and one-sentence summary, up to 2 more reasons, and what you did right. Still ≤ 60 words.
8. After a miss, once per set: "Hard one. Pros miss it too." (R20).

### 4.4 "Who's open?" rep (about 15 s) — owner: pass
1. **Set:** "You've got the ball" card; YOU is the carrier.
2. **Watch (2–3 s):** teammates move; freeze with the whistle.
3. **Choose:** teammates become big numbered targets (≥ 44 px); tap one to select (a dotted pass line previews it), tap again or press **Pass** to play it.
4. **Consequence:** the ball travels; "Cut out!" (defender flashes, groan), "Safe" (quiet), "Line broken!" (crowd lift). Sounds never carry meaning alone.
5. **Reveal:** every option labelled with a shape AND colour: ★ Best, ✓ Good, ! Risky, ✗ Cut out; passing lanes drawn, blocking defenders ringed; stars + one word + one line ≤ 14 words (from `explainPass`). Next / Why? / Try again.

### 4.5 Full time (end of a set) — owner: play (shared by pass)
Stars tally (5 small star rows), the XP bar sweeping, node stars updated on a mini Road node, any card or badge earned (one at a time, big), one line "Best move: Back up your buddy". Buttons: **Home** (primary) and **Play again** (neutral, never automatic). After about 15 minutes of play in a day: "Good session. Take a break?" (R22).

### 4.6 Match day (simplified Live) — owner: play
45 s of play; you keep moving; the ring around YOU shows hot/cold colour + a big word (Hot / Warm / Cold) with a shape; no numbers during play. Result: stars, your best hot streak in seconds, "Replay your hardest moment". The chart, table and seed stay in Coach mode Live.

### 4.7 Your card — owner: shell
Tabs: **Card** (FC-style card: nickname, number, kit, rank, level ring, 4 skill ratings 0–99 = Defend / Help / Pass / Shape derived from road stars and Elo, stars total, days this week), **Stickers** (album by chapter, bronze/silver/gold, mystery silhouettes link to the node), **Badges** (icon grid, short names, progress bars), **Kit** (swatches with lock level, number grid, nickname pick-list). Privacy line: "Your stats stay on this device."

## 5. Visual and copy system
- **Tokens:** Player mode shows unique shirt numbers (ours: GK 1, RB 2, LB 3, LCB 4, RCB 5, DM 6, RW 7, LCM 8, ST 9, RCM 10, LW 11; theirs the same numbers in their kit). YOU keeps its tag (nickname if set).
- **Type:** body ≥ 16 px, the reveal line ≥ 18 px, line height 1.5, no letter-spaced all-caps labels, bold for emphasis.
- **Colour:** results and options always pair colour with a shape/label; avoid red/green pairs as the only difference.
- **Sound:** short event sounds only (whistle at freeze, chime per star, cheer at 3 stars, groan at "Cut out!"); none during Watch/Decide; one persistent mute toggle.
- **Kid copy source of truth:** rules' `text.kid` (renamed "simple" in UI terms, key unchanged), scenario `titleKid/briefKid/questionKid/takeaway.kid`, principles `kidName` + `summary.kid`, road titles, pass principle texts. All pass the CI copy test (§7).

## 6. Engine additions

### 6.1 Passing (`js/engine/passing.js`, `js/engine/passdrill.js`) — owner: engine
Implements [research/passing.md](research/passing.md) §4 (prototype: its `passing.mjs`):
```js
rateOptions(frame, carrierId = frame.carrierId, params) → { lines, best, fwdOn, options: [{ id, kind: 'feet'|'space', point, aim,
  pSafe, pLane, pExec, pWin, blocker, receiverPressure, room, bypassed, lineBroken, value, valueGain, U, score, label: 'best'|'good'|'risky'|'cut-out'|'offside'|'danger', critical, tags }] }
gradePass(rating, choiceId, { accept }) → { score, grade, stars, outcome: 'completed'|'cut-out'|..., isBest }
explainPass(rating, choiceId, { wording }) → { headline, yours, best, cue }     // simple wording ≤ 14 words per line
generatePassDrill({ seed, role, principles, formations }) → scenario-like pass drill { id, kind: 'pass', timeline, learner: { role }, carrier, principles, ... }
checkPassDrill(drill) → gates (as in the research)
```
Pass principles PA1–PA15 are added to `data/principles.json` (category `passing`, with `kidName`, `summary.kid`).

### 6.2 Generated spot drills (`js/engine/spotdrill.js`) — owner: engine
`generateSpotDrill({ seed, role, principles, formations }) → scenario` in the authored scenario format with `source.kind: 'generated'`: a short ball-scripted sequence (a pass or carry that changes the right spot), freeze 0.4–1.0 s after the ball arrives, `learner.start` = the learner's auto spot before the event. **Quality gates** (reject and retry with the next seed): ghost score ≥ 90; ghost ≥ 5 m from start; standing still scores ≤ 70; one of the requested principles' rules is weighted ≥ 2 with s ≥ 0.9 at the ghost; realistic speeds. Simple-wording `briefKid`/`questionKid` from templates ("Their winger gets the ball. Where do you go?"). Deterministic per seed; yield measured in tests.

### 6.3 Stars and rewards policy (`js/rewards.js`) — owner: copy+rewards
- `starsForScore(score)`: 3 if ≥ 90, 2 if ≥ 75, 1 if ≥ 55, else 0 [D]; `wordForStars` → Spot on / Great / Close / Not yet.
- XP from stars and improvement only: 0/10/20/30 XP per 0/1/2/3 stars, improvement bonus, card upgrades, badges. No XP for attempts, finishing a set or the tutorial (R28). Level thresholds re-tuned so level 2 comes in the first session.
- Nickname: pick-list only (`NICKNAMES`, ~30 football nicknames: "Rocket", "The Wall", "Maestro", …); `setKit` accepts only list values.
- Days played this week (`weekDays`) replaces the resetting day streak in `js/ui/session.js` (Coach mode shows the same).

## 7. Checks (CI and browser)
- `tests/copy.test.js`: every Player-mode string (rules' kid texts, scenario kid fields, principles' kidName/summary.kid, road titles, pass texts, player UI string tables) meets word budgets, FK grade ≤ 4 (with a small football-word allow-list), and contains none of: "kid", principle codes (`/\b[A-Z]{1,2}\d{1,2}\b/`), letter grades, "/100", jargon from research/kid-audit.md §5, "!!!".
- Browser acceptance (phone 375×812 and desktop, light/dark, reduced motion): first drag ≤ 2 taps from first open; Player screens never show "/100", " F ", role codes or principle codes (DOM scan); all targets ≥ 44 px; zero console errors; Coach mode still fully works.

## 8. Build ownership (parallel agents; disjoint files)

| Area | Files |
|---|---|
| **engine** | `js/engine/passing.js`, `js/engine/passdrill.js`, `js/engine/spotdrill.js`, `js/engine/sequence.js` (Live pass-lane fix, research/passing.md §5.4), their tests, `data/principles.json` (PA1–PA15 only), `docs/ARCHITECTURE.md` §5.14–5.15 |
| **shell** | `js/main.js`, `index.html`, `js/ui/player/shell.js`, `js/ui/player/home.js`, `js/ui/player/kickoff.js`, `js/ui/player/card.js`, `js/ui/player/road.js`, `data/road.json`, `css/player.css`, `tests/road.test.js`, `tests/player-shell.test.js` |
| **play** | `js/ui/player/play.js`, `js/ui/player/reveal.js`, `js/ui/player/fulltime.js`, `js/ui/player/matchday.js`, `js/ui/player/strings.js` (Player UI string table), `js/ui/board.js`, `js/ui/celebrate.js`, `js/ui/sound.js`, `css/play.css`, `tests/player-play.test.js` |
| **pass** | `js/ui/player/pass.js`, `css/pass.css`, `tests/player-pass.test.js` |
| **copy+rewards** | `js/rewards.js`, `js/ui/rewards-store.js`, `js/ui/session.js`, `tests/rewards.test.js`, `tests/session.test.js`, `tests/copy.test.js`, the `text.kid` blocks in `js/engine/rules/*.js`, kid fields in `data/scenarios/*.json`, `data/tutorial.json` |

Shared contracts between areas are this document; anything that must change in another area's file is reported, not edited.

### 8.1 Shared contracts between the Player-mode areas

```js
// js/ui/player/road.js (shell): pure helpers plus profile persistence (store key 'player')
loadProfile(app) → profile        saveProfile(app, profile)
roadNodes(road) → node[]          nodeById(road, id) → node        nextNode(road, profile) → node
isUnlocked(road, profile, nodeId) → boolean
buildSet(node, { road, profile, index, rewards, skills, seed, formations }) → Promise<rep[]>
//   rep = { kind: 'spot', scenario, mirrored: boolean } | { kind: 'pass', drill }   (5 reps; deterministic for a seed)
recordSet(app, nodeId, repStars /* number[] */) → { before, after }   // node stars, per §3
setStarsFor(repStars) → 0..3

// js/ui/player/reveal.js (play): the Player-mode reveal, shared by play and pass
createPlayerReveal(container, { app }) → {
  show({ stars, word, line, why: { title, summary, reasons: string[], praise: string[] },
         onNext, onRetry /* optional */, onReplay /* optional */, replayLabel /* optional */ }),
  clear(), destroy() }

// js/ui/player/fulltime.js (play): the end-of-set screen, shared by play and pass
showFullTime(root, app, { node, reps: [{ stars, title }], xpBefore, xpAfter, gained /* merged rewards gains */,
                          nodeStars: { before, after }, onHome, onAgain }) → cleanup()
```

- Every `js/ui/player/*.js` module exports a `STRINGS` object holding all of its visible text (functions allowed for templates), so `tests/copy.test.js` can check it. **Player modules must not touch `document`/`window` at import time** (only inside functions), so Node can import them.
- `data/principles.json` is edited by two areas (engine adds PA1–PA15; copy+rewards may fix `summary.kid`/`kidName` wording). Both use **targeted text edits only** (the Edit tool on specific lines), never a script that re-serialises the whole file, and re-read before each edit.

```js
// js/ui/board.js additions (play owns board.js; pass codes against these)
createBoard(container, { orientation, labels: 'role' | 'number' /* Player mode: unique shirt numbers per §5 */ })
board.setSpotlight(ids /* string[] | null */)          // everything else dimmed to 40 %; null = all normal
board.enableTargets({ ids, onTap(id), onPreview(id | null) }) / board.disableTargets()
//   big (≥ 44 px) numbered tap targets on those tokens; first tap previews (calls onPreview), second tap on the same one confirms (onTap)
board.showHintHand({ from, to }) → Promise              // the worked-example ghost hand; resolves when done; instant under reduced motion
board.setAid({ kind: 'glow', target } | null)          // warm/cold ring on YOU that brightens as YOU nears `target`
// markers already exist (arrow, segment, ring, label); pass uses them for lanes, blocker rings and ★ ✓ ! ✗ option labels
```
- Player modules award rewards through `award(app, event)` in `js/ui/rewards-store.js` and read stars with `starsForScore` (§6.3).
- `play` and `pass` both end a set by calling `recordSet`, then `showFullTime`.
