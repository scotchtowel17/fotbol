# fotbol through an 11-year-old's eyes: UX audit

**Audited:** the published site, https://scotchtowel17.github.io/fotbol/ (branch `main`, commit `bbf9aa4`), on 2026-09-27.
**How:** played as a first-time user who loves football but hates reading. Mostly on a phone (375×812, touch emulation, empty storage), then briefly on a 1280×800 laptop. Route: home, tutorial, one drill session, Explore, Live, Progress. Every number below was measured in the browser or computed from the `main` source (see "Method" at the end).
**Verdict:** the game itself works for kids: drag yourself, watch the team move, see the arrow to the best spot. Around it sits a coach's manual. The default wording is written for adults, and a kid wording mode already exists but is switched off and hidden.

## 1. Scorecard

| Area | Score /5 | Evidence |
|---|---|---|
| Core idea and pitch visuals | **4** | Dragging yourself, the whole team sliding when you move the ball, and the arrow to the best-spot ring all make sense without any words. |
| Time to first fun | **2** | Main button: 4 taps and about 280 words before the first drag. The secondary "Explore the pitch" button gets there in 1 tap. |
| Reading load | **1** | 10,300 words of learner text at 16 words per sentence, with 319 sentences over 15 words (the longest is 52). One missed drill rep shows 203 words. |
| Jargon | **1** | The home page uses 47 distinct jargon terms. Role codes (LCB, #6, #8, #9) and idea codes (D5, U4) appear on every play screen. |
| Choices per screen | **2** | Home 31, tutorial steps 17 to 19, Explore 24, Progress 78. |
| Fit on a phone | **2** | The goal-side target is a 12 px circle. In tutorial step 4 the right answer is hidden under two other tokens. Keyboard instructions show on every play screen. |
| Motivation and tone | **2** | First drill result: red "F", "2/100", "Out of position." A full 6-rep session earned 0 stars. |
| Rewards and progress | **2** | Level, streak and the S confetti work. The rest of Progress is a spreadsheet 6.7 screens long. |
| Kid mode | **3 (hidden)** | "Wording: Kid" halves the reading (grade 5.6 to 2.6, 16 to 8.6 words per sentence). It is off by default behind an unlabelled icon, and all 36 kid drill titles (`titleKid`) are written but never shown. |
| **Overall** | **2 / 5** | Keep the game. Fix the default copy, the grading, the home page and the reveal first. |

**Quick wins (hours, not weeks):**
1. Default to Kid wording: `SETTINGS_DEFAULTS.wording` in `js/main.js`.
2. Show `titleKid` in `showBrief`, `showWatch` and `showPlace` in `js/ui/modes/drill.js`.
3. Replace letter grades and /100 with stars or words.
4. Cut the drill reveal to one line plus the pitch arrow, with a "Why?" button for the rest.

## 2. The first ten minutes

| Path from first open | Taps before the first drag | Words on screen before it |
|---|---|---|
| Main button "Start the tutorial" | 4: Start, then Start again, Got it, Next | about 280 (2 minutes if read, 15 to 20 seconds if skipped) |
| Secondary button "Explore the pitch" | 1 | about 125 |
| Top nav "Drill" | 2 (Drill, Watch), then 2.4 to 5.3 s of play | about 215 |
| First scored result in a drill | 4 taps and 1 drag (Drill, Watch, drag, Lock in, Show me) | about 275 |

(Words count everything on screen up to and including the screen where the drag or result happens.)

- **Tutorial:** 7 steps, at least 16 actions (10 taps plus 6 drags or taps on the pitch). About 640 words of lesson text in standard wording, 250 in kid wording. Each miss adds a 20 to 30 word message and hint.
- **One drill rep:** 4 taps and 1 drag. About 400 words on screen: brief 92, placing 90, cue 65, reveal 140 to 203. About 40 of those are the nav and keyboard hint repeating.
- **One 6-rep session:** about 36 actions and 2,400 words. My realistic kid run (chase the ball once, then mostly leave the token where it started) ended on a red "F 24/100" with 0 new stars.
- **Session roles:** the session also switched the kid from left centre-back to #6, #8 and striker without a clear signal.

## 3. Screen by screen (phone, default "Standard" wording)

**How to read the columns:**
- **Words:** visible on the first view / whole screen including scrolling. Pitch labels are not counted; they add 11 to 31 per screen.
- **Choices:** tappable things in view / in total.
- **Grade:** Flesch-Kincaid grade of the main text, Standard to Kid wording. FK rates short text full of jargon as easy: "Their #9 is yours" scores grade 0, but a kid still has to know that "#9" means their striker. Read the grade together with the jargon column.

| Screen | Words | Choices | Jargon a kid meets | Grade | Main problem | Fix |
|---|---|---|---|---|---|---|
| Home | 61 / 579 | 9 / 31 | 4-3-3, principle, flank, width, pin, screen, back four, press, half-spaces, modules, carrier, compact block (47 terms) | 4.1 → 2.1 | 5.8 screens long, with five navigation blocks: top nav, hero buttons, "Your path", "Ways to play", "Learn more". The default position is a defender (LCB). | One screen: Play button, tap-a-player pitch, one "Continue" card |
| Settings menu | 18 | 7 | Wording: Standard / Kid | – | Kid wording exists but is off, behind an unlabelled icon | Kid wording by default; a "Coach mode" switch for adults |
| Tutorial intro | 44 / 50 | 9 / 12 | module | 4.2 | Asks "Start the tutorial" a second time; the button sits on the bottom edge | Remove this screen |
| T1 Which way? | 78 / 84 | 17 / 20 | push up, drop | 5.0 → 1.1 | The task says "Find both goalkeepers" but tapping them does nothing. You just press "Got it". | Make it a real task: "Tap THEIR keeper" |
| T2 Thirds | 101 / 110 | 19 / 22 | final third, build-up | 3.0 | The ball sits half under their "9" token (8 px apart) | Draw the ball on top; name the thirds "our end / middle / their end" |
| T3 Lanes | 110 / – | 19 | half-space ×4, lanes, Zone 14, touchline | 3.3 → 0.6 | The hardest idea in the app comes in step 3. The target circle is about 30 px across, and the lane labels hide under tokens. | Move half-spaces and Zone 14 out of the tutorial |
| T4 The ball decides your job | 98 / 116 | 10 / 21 | press, first/second/third defender, carrier, width and depth, compact | 6.4 → 0.2 | The right token (our RB) sits 10 px from their winger's centre and 15 px from another token's, and tokens are 36 px wide, so it is hidden | Dim players who can't be the answer; offer "Pick from a list" by default on phones |
| T5 Goal-side | ~100 (est.) | ~19 | goal-side, marking | ~5 | The target is a 12 px circle (2 m on a board drawn at 3 px per metre). I needed two exact drags. | Zoom the board and snap to any drop within 44 px |
| T6 Offside | 98 / 140 | 19 | second-last player, centre-backs, onside | 7.9 → 2.4 | A 50-word legal definition of offside | Let the live "Onside/Offside" tag do the teaching; keep one line |
| T7 Team shift | 82 / 131 | 19 | back four, tuck in | ~4 | Good step; the success line runs to 29 words | Keep the step; shorten the line |
| Tutorial end | 43 / 108 | 17 / 26 | codes F1 D5 F4 F2 F3; press, cover, balance | 3.7 → 0.5 | No celebration, just a tick; a list of idea codes | Badge and confetti: "You unlocked: Defend together" |
| Drill brief | 72 / 92 | 10 / 14 | rep, #8, #9, LCB, "D5 Goal-side and ball-side" | 0.8* | "#8" and "#9" in the text, while the pitch has two "9" tokens and four "8" tokens | Say "their striker" and ring that player on the pitch |
| Drill placing | 81 | 13 | Lock in, Sure / Not sure | 0.8* | An extra "How sure are you?" decision on every rep | Hide it; rename the button "Done!" |
| Drill cue (step 1 of the reveal) | 61 | 9 (1 real) | back line, "height" | 1.6* | "Who is setting the height of your back line right now?" is an extra tap, often about a different idea from the drill's | Cut it, or make it a 2-choice guess |
| Drill reveal | 74 / 203 | 10 / 14 | F, /100, U4 and D5 chips, centre-back, goal-side, metres, "zone" | 3.3 → 1.6 | The kid sees a red F first. 8 blocks of text sit in a 244 px window (899 px of content, 27% visible). Opening the sheet covers the pitch. | Stars, one line, and the pitch arrow; everything else behind "Why?" |
| Session summary | 68 / 128 | 7 / 12 | reps, session, 10 idea codes | – | Ends on a red F with no stars earned | Stars earned, best moment, "Play again" |
| Explore | 63 / 208 | 16 / 24 | ideal spot, ghost, zone, Balance, 3rd defender, "Loose", U4/D5/U2/F8 | 2.8 → 0 | The goal (find the S spot) is explained below the fold. Opens on "29 F Cold" before you have done anything. | One goal on screen, "Find the golden spot!"; put the other controls in a Tools drawer |
| Live intro | 80 / 108 | 16 / 18 | sequence (with the code "papy7g"), open play, turnover, training wheels, assisted | 4.1 → 1.8 | Five settings before Start | One big Start button with sensible defaults |
| Live, playing | 59 | 11 | back line, centre-back | – | An average, a current score, a letter, a heat word and a 15 to 25 word sentence, all changing ten times a second | Show the ring colour and one heat word |
| Live results | 77 / 126 | 12 / 16 | time-averaged score, "12% of the time at A or better" | 1.5 | An analytics page: line chart, percentages, a data table | Stars, plus "Replay your hardest moment" |
| Progress | 59 / 556 | 9 / 78 | idea codes and textbook names, "34% expected on an average drill", export/import | 5.5 → 2.5 | A spreadsheet 6.7 screens long | A trophy cabinet; data controls behind "For grown-ups" |
| Idea library (linked from chips) | 98 / 2,964 | 86 | all of the above | 5.4 | 21 screens long; coach PDFs; "(default)" and "within 20 degrees" leak from the engine | Coach mode only |

\*The low grade reflects short sentences, not easy words (see the note above the table).

**Attention and the one action**

| Screen | Eye goes first | The ONE action | Hidden | Where a kid stalls |
|---|---|---|---|---|
| Home | Headline, then the green button | Clear at the top; 31 options once you scroll | Kid wording (gear icon); roles also pickable by tapping the pitch | Ten position descriptions full of jargon |
| Tutorial step | The bold task box, and a pitch with 22 labelled dots | Mostly clear, but Hint, Skip, Back and 7 step dots compete | Tap-a-token-then-tap-a-spot is mentioned only inside the keyboard hint; the sheet handle | T1 (keeper tap does nothing), T3 (half-space), T4 (hidden token), T5 (tiny target) |
| Drill brief | The pulsing orange YOU ring | Watch: clear | The module switcher sits below the fold | Finding "their #9" |
| Drill placing | The big question | Drag YOU, then Lock in: clear | Enter locks in (keyboard only) | The "Sure / Not sure" decision |
| Drill reveal | A red "F" and "2/100" | Next rep | 73% of the feedback needs scrolling; the "Show more" handle has no visible label | Reads nothing, sees F, taps Next |
| Explore | "29 F" | Unclear: move the ball, move yourself, or flip one of the toggles? | The S-spot rule; peeking at the answer cancels the credit | "What am I meant to do?" |
| Live | The two numbers | Keep dragging: clear | Space pauses (keyboard only); the moment replays are below the fold | Trying to read while things move |
| Progress | The Level tile | None | Export and reset at the bottom | Nothing to do here |

**Desktop (1280×800):** the home page drops to 2.7 screens (158 words above the fold, 16 choices). The drill fits on one screen, but the Watch button is stranded at the bottom right, far from the text. The same copy problems apply.

## 4. Top 20 problems, ranked by impact

1. **The payoff of every rep is a wall of text.** A missed rep shows up to 203 words in 8 blocks: grade, score, headline, 2 reasons with codes, a fix in metres, praise, takeaway, "Watch out", and a legend. They sit in a 244 px scrolling window.
   **Fix:**
   - Show it on the pitch instead: animate YOU along the arrow to a ring labelled "Best spot", then show one kid line ("Get between your striker and our goal").
   - Move the reasons, takeaway and "Watch out" behind a **Why?** button.
   - Cut the legend; label the ring on the pitch instead.
   - Replace metres ("Drop 10 m deeper and come 15 m inside") with "Follow the arrow".
2. **School grades punish the first try.** The first drill after the tutorial showed a red **F**, **2/100** and "Out of position." Leaving the token where it starts scored F every time I tried it (4 of 4), and 5 of my 6 reps were F.
   **Fix:**
   - Replace S to F and /100 with 0 to 3 stars or "Try again / Close / Great / Perfect!".
   - Never show F or a number out of 100 to kids; move them to Coach mode.
   - Keep the S confetti for "Perfect!".
3. **Kid wording is hidden and switched off, and it is incomplete.** It lives behind an unlabelled gear icon. Turning it on cuts home-page words from 576 to 416 and jargon terms from 47 to 21. But several things never change:
   - drill titles (`titleKid` is written and never read), module titles and subtitles, idea names, position labels;
   - the Explore line "Hold the shape shape keeper" (a doubled word).

   **Fix:**
   - Make Kid the default and rename Standard to **Coach mode**.
   - Wire `titleKid`, and add kid names for modules and ideas.
4. **The home page is too long and repeats itself.** It is 5.8 phone screens, 579 words and 31 choices. The same modes are offered in the nav, the hero buttons and "Ways to play", and the modules a fourth time in "Your path".
   **Fix:**
   - Keep one screen: a big **Play** button, the pitch picture where you tap your player, and a "Continue: level 1" card.
   - Cut "Ways to play" (the nav already has them) and "Learn more".
   - Move "Your path" to its own "My journey" screen.
5. **Codes instead of names.** Tokens and chips say LCB, RCB, LW; standard text uses #6, #8 and #9 about 76 times; four tokens read "8" and two read "9". The kid also starts as a left centre-back without choosing.
   **Fix:**
   - Tokens show unique shirt numbers (4, 5, 2, 3, 6, 8, 10, 7, 11, 9) plus YOU.
   - Text says "their striker" or "your midfielder".
   - The first screen asks "What do you play?" with 4 big picture buttons: Defender, Midfielder, Winger, Striker.
6. **Idea codes and textbook names.** Chips read "U4 Hold a level line" and "D5 Goal-side and ball-side". One session lists 10 codes. Progress shows lines like "P2 Receive between the lines, outside cover shadows".
   **Fix:**
   - Hide all IDs outside Coach mode.
   - Give each drill one kid-named idea ("Stay in line").
   - Show that one idea per drill, never a list.
7. **Slow start to the fun.** From the main button it takes 4 taps before the first drag: the tutorial intro repeats "Start", step 1 is not interactive, and every step needs a "Next".
   **Fix:**
   - Drop the intro screen.
   - Make step 1 "Tap THEIR keeper".
   - Move on automatically after each success, with a 1-second cheer.
   - Result: the first drag comes on tap 2.
8. **Tutorial steps are paragraphs.** Each step shows 80 to 140 words. Step explanations average 19 words per sentence (up to 37), and offside gets a 50-word legal definition.
   **Fix:**
   - One kid sentence per step; put the rest behind "Why?".
   - Teach through the pitch: flash the thirds and strips, and let the live Onside/Offside tag explain offside.
   - Cut half-spaces and Zone 14 from the tutorial.
9. **Targets smaller than a fingertip, and tokens stacked on each other.** The tutorial board draws 3.0 px per metre:
   - the goal-side target is 12 px across;
   - in step 4 the right answer is hidden under two tokens;
   - even in drills (4.8 px per metre) the "your zone" oval is 39 × 24 px, next to a 22 px token.

   **Fix:**
   - Crop and zoom the tutorial board, as drills already do.
   - Make every target at least 44 px, and snap a drop within one token of the target onto it.
   - Dim or shrink players who don't matter; draw the ball and YOU on top.
10. **No reward for effort.** The first star needs 3 tries on an idea, and a 6-rep session touches up to 10 ideas, so my session earned 0 stars. The tutorial ends with a tick and no celebration.
    **Fix:**
    - Give a star for every rep scored A or better, and a medal for the session.
    - Always end on a gain ("+2 stars, 3 in a row!").
    - Give the tutorial a badge and confetti.
11. **The cue step (step 1 of the reveal) costs a tap and asks an adult question.** Examples: "Who is setting the height of your back line right now?" and, after a perfect spot, "Happy with that spot? Let's see how it scores."
    **Fix:**
    - Cut it for kids, or turn it into a 2-button guess ("Close or far?").
    - Skip it whenever the spot is good.
    - Make the cue match the drill's own idea.
12. **Roles change in the middle of a session.** A kid who picked left centre-back played as #6, #8 and striker in the same session, flagged only by a small note.
    **Fix:**
    - Build sessions only from drills for the chosen position (mirror or author more).
    - If a switch is unavoidable, show a full card: "Now you're the STRIKER!", with that token glowing.
13. **Explore has no visible goal and 24 controls.** Role select, Us/Them/Loose, show ideal, move ball, 3 guide toggles, and a why-list with codes. The S-spot rule is below the fold, peeking at the answer cancels the credit, and the screen opens on "F".
    **Fix:**
    - Show one goal on screen: "Find the golden spot!", with a counter.
    - Put possession, guides and the ideal-spot toggle in a Tools drawer.
    - Rename "Loose" to "Nobody".
    - Show heat colours, not letters.
14. **Live asks you to read while playing.** Two scores, a letter, a heat word and a sentence all change ten times a second. The results are adult analytics: a chart, percentages, "time-averaged score" and a seed code.
    **Fix:**
    - During play, show only the ring colour and a big "Hot!/Cold!".
    - Results: stars, your best streak, and "Replay your hardest moment".
    - Chart, table and seed go to Coach mode.
15. **Progress is a spreadsheet.** 556 words, 78 choices, idea codes, "34% expected on an average drill", Export/Import.
    **Fix:**
    - Make it a trophy cabinet: level, streak, stars per position, and badges earned.
    - Put per-idea lists, history and data controls behind "For grown-ups".
16. **Keyboard instructions on a phone.** Every drag step of the tutorial and every drill phase shows "Keyboard: press Tab… hold Shift…". The useful touch shortcut (tap YOU, then tap a spot) is buried in the same sentence.
    **Fix:**
    - Show keyboard hints only after a key is pressed.
    - On touch, show a one-time animated hand saying "Drag YOU".
17. **Direction words are inconsistent.** The same two directions are called push up / step up / up the pitch / forward and drop / deeper / back / drop off; fixes are given in metres.
    **Fix:**
    - Use two words everywhere: **forward** and **back** (plus "toward the middle" and "toward the sideline").
    - Let the arrow carry the distance.
18. **"How sure are you?" appears on every rep, with an extra note when you are wrong.**
    **Fix:** Hide it in Coach mode, or turn it into an optional "Double or nothing" button.
19. **Course-style structure words.** "Module 0 to 3", "Pitch literacy", "Defending as a unit of three", "0 of 24 stars", and lock icons on modules that still open.
    **Fix:**
    - Call them Level 1 to 4 with short kid titles.
    - Show 3 stars per level.
    - Either lock for real or drop the lock and just show "Next up".
20. **The bottom sheet fights the pitch.** It has two scrolling areas, and opening it covers the pitch, so the text and the answer can never be seen together. Its handle is an unlabelled grey bar.
    **Fix:** With the reveal cut to one line (item 1), keep the sheet collapsed. Give it a visible "Why?" chip instead of relying on the handle.

## 5. Jargon: every term, with a kid replacement or "hide"

| Term(s) as shown (uses in standard text → kid text) | Kid replacement |
|---|---|
| LCB, RCB, LB, RB, LW, RW, DM, LCM, RCM, ST, GK (tokens, chips) | Hide the codes; unique shirt numbers on tokens; words in chips |
| #6 (27→1), #8 (24→0), #9 (25→2) | "your/their midfielder", "their striker" |
| Holding midfielder (#6) | "Defensive midfielder" (or "Midfielder who stays back") |
| Left/Right central midfielder (#8) | "Left/Right midfielder" |
| Centre-back (49→1), full-back (39→3) | Keep in the position picker; in feedback say "your defender partner", "left back" |
| 4-3-3, "role" | Hide (the picture shows it) |
| Touchline (23→1), byline, flank, channel | sideline, end line, side, gap |
| Thirds; defensive / middle / final third; build-up | our end / the middle / their end; hide "build-up" |
| Half-space(s) (9→1), lanes, Zone 14 | Hide (Coach mode); "strips" if needed |
| Back line (32→1), back four, the line, level line, hold the line | "your defenders' line", "stay in line with your defenders" |
| Step up, push up, up the pitch / drop, deeper, drop off | forward / back |
| Tuck in (17→2), narrow, squeeze, concentration | "move toward the middle" |
| Compact, compactness, unit, organised, shape | "stay close together", "your spot in the team" |
| Block (15→9), high / mid / low block | Hide, or "defend high / in the middle / near our goal" |
| Screen, screens the back four | "guard the space in front of our defenders" |
| Width, depth, make the field big, pin their back line | "stay wide", "stay level with their last defender" |
| Between the lines, cover shadow, pocket | "the gap behind their midfielders"; hide "cover shadow" |
| Press (40→11), presser, pressure, close down | "go to the ball" / "chase" |
| First / second / third defender, cover, balance | chaser / helper / shape-keeper; "back up"; "hold your spot" |
| Goal-side (17→2), ball-side, marking, pick up | "between them and our goal", "nearer the ball", "your player" |
| Carrier (12→0), support, passing option, support distance | "the player with the ball", "get open for a pass" |
| Engage, show them outside, dictate direction | "go to them", "send them to the sideline" |
| Overlap, switch (of play), counter, delay, recovery run | "run past on the outside", "long pass to the other side", "fast break", "slow them down", "sprint back" |
| Transition, turnover, open play, cut-back | "when the ball changes team"; hide the others |
| Offside line, second-last player | Keep "offside" and the drawn line; hide "second-last player" |
| Crossover, crescent, L-shape | Hide |
| Principle(s) and IDs (D1, U4, F2, P10…) | "idea" or "skill"; hide IDs |
| Module 0 to 3, "Pitch literacy", module subtitles | "Level 1 to 4" with kid titles; hide subtitles |
| Rep (21→5), session (13→0) | "go", "round" |
| Sequence + seed code "papy7g" | "game"; hide the code |
| Lock in / Sure / Not sure | "Done!"; hide the confidence buttons |
| Grades S, A to F, "/100", "Out of position." | stars or "Perfect / Great / Close / Try again" |
| Ideal spot, ghost ring, zone, shaded oval, glow, heatmap | "best spot" (the ring); hide the zone and heatmap |
| Time-averaged score, "% of the time at A or better", "% expected on an average drill" | Hide (Coach mode) |
| Training wheels, assisted | "Helper on" (kid text already says this) |
| Export / Import / Reset progress | "Save / Load / Start again", in a grown-ups area |
| Metres in fixes ("15 m inside") | "follow the arrow", "a few steps" |
| Tolerance, Elo, mastery | Not shown in the learner UI; keep it that way |
| Hot / Warm / Cold / On fire, streak, Level names (Rookie → Legend) | **Keep**: kids understand them instantly |

## 6. What already works: keep it

- **The core mechanic:** drag yourself on a real pitch, and the whole team slides when you move the ball (tutorial step 2 and Explore). Make that the very first thing a kid does.
- **The drill loop:** watch, freeze, place, answer on the pitch. The arrow from YOU to the ring, and "Replay / Watch what happens next", teach without words.
- **The hot/cold game in Explore and Live:** ring colour plus "On fire" is instantly readable. It is the best "try again" loop in the app.
- **Tutorial support after a miss:** a hint after a miss, the target ring after two misses, and "Pick from a list instead" on the tap task. The dashed goal line in the goal-side step and the live Onside/Offside tag are excellent visual teaching.
- **Celebration and progress:** the S confetti, the streak flame, the count-up score, level names ("Rookie" to "Legend") and "New star!". Just award them more often.
- **Kid copy already written:** Kid wording (grade 2.6, 8.6 words per sentence), all 36 `titleKid` drill titles, and kid idea summaries. This is most of the rewrite, done.
- **Phone layout:** the primary button always stays in reach in the bottom sheet, and drills crop the pitch to the action (4.8 vs 3.0 px per metre).
- **Small touches:** the 3-2-1 "Go!" countdown in Live, and the "your toughest moments" replay idea (reframe it as "Try it again").
- **No accounts and no tracking.** Parents will like this; keep saying it, but in the grown-ups area.

## Method and caveats

- **Word counts:** a DOM walk of visible text nodes, skipping hidden, visually-hidden and scroll-clipped text. "View" means inside the 375×812 viewport; "page" means reachable by scrolling. Pitch (SVG) labels are counted separately.
- **Choices:** visible buttons, links, form controls (wrapping labels counted for visually-hidden inputs) and draggable tokens.
- **Reading grade:** Flesch-Kincaid with a heuristic syllable count. The per-screen figures use the exact strings shown; the overall figures cover all learner text on `main` (tutorial, 36 drills, rule feedback, idea summaries, UI copy). FK underrates jargon, so it is paired with the jargon counts. Scripts are in the session scratchpad: `audit.js`, `grade.mjs`, `jargon.mjs`, `screens.mjs`.
- **Kid wording:** compared by switching it in memory only (`?debug`), so the saved settings were never changed.
- **Shared progress:** the Browser pane's other tab was also on the published site during this audit. They share this browser's saved progress (localStorage): one extra drill rep in the history came from that tab, and my run left saved progress for this site in that browser (tutorial done, 8 drill reps, 1 Live run).
