# Soccer Positioning Trainer: Research Report and Build Recommendation

Prepared 2026-09-27. Working project name: **fotbol**.

> **Status note (added after the research):** two facts in this report were overtaken the same day. Node.js v24 is now installed on the development machine; the app is still zero-build, but tests run with `node --test`. The repository now exists at <https://github.com/scotchtowel17/fotbol>. Where the report says "no Node" or "repo not created", read it as history. Current build status is in [ROADMAP.md](ROADMAP.md).

**Who this is for**
- **You, the learner.** You follow soccer and want to understand *where a player should stand, and why*. Start with section 1, then section 2 (what to read and watch) and section 8 (the principles themselves). Appendix B is a plain-language glossary.
- **Future coding agents.** Sections 4, 5, 6, 8 and 9 are the build spec. Section 8 is the content backbone: every row has an ID the engine and scenarios refer to.

**How claims are marked**
- `[verified]` means a research agent opened the page, file or repository on 2026-09-26/27. `[unverified]` means it was seen only in search results, a secondary summary, or a page that would not load.
- **Where numbers come from:**
  - `[S]` is a sourced number, from a named coaching or research source.
  - `[M]` is a number our research agents measured themselves, for example by regressing HELIOS formation data or comparing pitch-control implementations. These are not published results.
  - `[D]` is a tunable default. It is an engineering guess to be calibrated with coaches. It is not a fact about soccer.
- Where the research sweeps disagreed with the later repo-verification pass, this report follows the verification pass. Appendix A lists every correction.

**Canonical pitch frame (used everywhere in this report and in the app)**
- The pitch is measured in metres, **105 x 68** (IFAB standard).
- **x** runs from 0 at the learner's own goal line to 105 at the opponent's goal line. The learner's team always attacks toward +x, drawn left to right.
- **y** runs from 0 at the top touchline to 68 at the bottom. The top is the attacking team's **left** side, so a left back lives at small y.
- "Goal-side" means a smaller x. "Inside" means closer to y = 34.

| Landmark | Coordinates (m) |
|---|---|
| Own goal centre / posts | (0, 34); posts at y = 30.34 and 37.66 |
| Own penalty area / six-yard box | x 0-16.5, y 13.84-54.16 / x 0-5.5, y 24.84-43.16 |
| Own penalty spot; arc radius | (11, 34); 9.15 |
| Halfway line; centre circle radius | x = 52.5; 9.15 |
| Opponent penalty area / spot | x 88.5-105 / (94, 34) |
| Thirds | defensive x < 35; middle 35-70; final x > 70 |
| Five vertical lanes (box and six-yard-box edges) | left wing 0-13.84; left half-space 13.84-24.84; centre 24.84-43.16; right half-space 43.16-54.16; right wing 54.16-68 |
| Zone 14 (opponent half) | about x 75-88, y 24.84-43.16 |

---

## 1. Executive summary

Nobody has built this app yet in a form we can reuse. Here is what does exist:

- **Drag-yourself positioning trainers.** There are two. One is a closed Android app with about ten downloads. The other is an unlicensed hobby web app with no opponents and a ball the user moves by hand.
- **Validated tactical tests that are multiple-choice only.** TacticUP is the main one.
- **A wave of 2026 "soccer IQ" phone apps that are all tap-to-choose.** SmartPitch, FootBrain and VisionPlay.
- **Dozens of coach tactics boards.** They draw formations beautifully but have no idea of a correct answer.

Nothing combines all of these in one product:
- a browser app;
- one assigned role;
- a ball and 21 other players that keep moving;
- a free drag-to-place answer;
- a visible ideal zone;
- a one-sentence, principle-based "why";
- a progression that builds real understanding.

That combination is our app. For this project, "don't reinvent the wheel" means reusing proven *ideas*, *data* and *small libraries*, not forking a codebase. No existing repository is close enough, permissively licensed, and runnable on this machine (which has no Node.js) to be worth forking.

- **What exists.**
  - "Soccer Positioning" by Peter Blumen is closed: Android, $12.99, 10+ downloads, live 0-100 score, fixed 4-4-2.
  - ErrantActions/Soccer-Position-visualizer has the best design ideas but **no license**, no opponents, and some tactical logic errors.
  - TacticUP is a validated video test built on core tactical principles. It is assessment-only and multiple-choice, and needs a screen of at least 10 inches.
  - SportsLab360 and SmartPitch Soccer both use a choose-from-options format.
- **The gap we fill.** Free placement in a *dynamic* scene, graded against a *visible* tolerance zone, explained by *named principles*, with per-principle progress. It should run on a phone browser.
- **Build-off decision: no fork; borrow parts.**
  - (1) HELIOS Base `formations-dt` data (MIT at the repo root, with attribution) seeds the "where should each of 11 roles be for this ball position" layer.
  - (2) `delaunator` (ISC) triangulates that data.
  - (3) The IFAB pitch constants, the pitch drawer and the formation-notation helper are hand-ported from `pitchboard` (MIT).
  - Later we add these, all MIT: the EPV grid and time-to-intercept constants from LaurieOnTracking; pressure and pitch-control formulas from databallpy, with its bugs fixed; open tracking data from SkillCorner for real-match scenes; and ts-fsrs for spaced review.
  - Everything else is a design reference only. Details are in section 4.
- **Stack.** A static web app in plain HTML, CSS and JavaScript ES modules, with no framework and no build step. The pitch and players are drawn in SVG, over a canvas heatmap. Libraries are vendored or loaded from jsDelivr. Develop locally with `python3 -m http.server` and host on GitHub Pages. Save progress in `localStorage`: no accounts, no analytics, no ads.
- **Engine.** Three layers.
  - (A) **Base position.** A ball-driven target for every role, interpolated from a formation table using Delaunay triangulation and barycentric weights.
  - (B) **Principle rules.** Geometric checks such as goal-side, cover angle, level line, weak-side tuck, width, depth, open passing lane and lane occupancy. Each check returns a 0-1 score, a fix vector and a sentence.
  - (C) **Ghost.** The best spot on a local grid, drawn as the "ideal". The other 21 players move automatically to their layer-A targets as the ball follows an authored path, so the scene is dynamic without a physics engine.
- **Scoring.** `score = 100 x (0.55 x S_zone + 0.45 x S_rules)`.
  - Critical rule failures cap the score at 59: being offside, or keeping an attacker onside by standing deeper than your line.
  - Grades run S, A, B, C, D, F.
  - Feedback always shows the ideal zone, the distance and direction to move, and the single most important reason.
- **Content.**
  - v1 ships about 36 hand-authored "ball-scripted" scenarios for six outfield roles in a 4-3-3: CB, FB, #6, #8, winger and #9.
  - They are organised by the four moments of the game (attacking, defending, and the two transitions between them) and by core tactical principles.
  - Section 8 has about 70 principles, each with a geometric rule of thumb and sources.
- **Learning design.**
  - Each rep runs: watch, freeze, place, reveal, explain, replay the consequence.
  - Hints lead with guided discovery (point at the cue) before stating the rule.
  - Difficulty adapts per principle with an Elo rating, targeting about 75% success.
  - Similar-looking situations are mixed together once the basics are in place.
  - Mastered scenarios come back as spaced reviews. There are no global leaderboards.
- **Biggest risks.**
  - Tactics are partly style-dependent, and almost every metre value is an uncalibrated default. The fix is tolerance bands, labelled assumptions and a keying panel of at least 3 coaches.
  - The HELIOS data was tuned for RoboCup robots, not humans, and has one open-play phase only.
  - Child-privacy law applies if the audience is under 13.
  - The "soccer IQ" app market is crowded, so free placement plus explanations must be the headline.

---

## 2. Best resources to learn soccer theory and positioning

All items below were verified unless marked. Copyrighted material should be **linked and paraphrased in the app, never copied**.

### 2.1 If you read only three things
1. **US Youth Soccer ODP Player Manual** (free PDF, about 14 pages). It is written *for players*: ten principles of possession on the 4-3-3 numbering system. <https://www.usyouthsoccer.org/wp-content/uploads/sites/160/2023/09/Player-Manual-US-Youth-Soccer-ODP.pdf>
2. **U.S. Soccer Curriculum (2011)** (free PDF, about 123 pages). It has clean, diagrammed definitions of support, width, depth, pressure, cover, balance and compactness. <https://cdn2.sportngin.com/attachments/document/0073/5091/Full_U.S._Soccer_Coaching_Curriculumnew.pdf>
3. **Coaches' Voice "Football tactics explained"** (web). Diagrammed explainers on rest defence, blocks, half-spaces, third-man runs and pressing. Some content is behind a membership. <https://learning.coachesvoice.com/cv/glossary-football-tactics-coaching/>

### 2.2 Beginner (player-facing, plain language)
| Resource | Type | Why it is worth your time |
|---|---|---|
| US Youth Soccer ODP Player Manual | Curriculum (free PDF) | Player-voice rules such as "make the field big", peel off, runs trigger runs, and switch after a back pass. It maps directly onto app scenarios. |
| U.S. Soccer Curriculum 2011 | Curriculum (free PDF) | The canonical glossary for the app's "why" text. It also shows which age learns which topic. |
| The Football Analyst, "Football Tactics Explained" series | Website | Very simple language. It includes a list of seven pressing triggers. <https://the-footballanalyst.com/pressing-triggers-football-tactics-explained/> |
| *Soccer iQ*, Vol. 1 and 2 (Dan Blank) | Book | Short, rule-like chapters for players, e.g. force the weaker foot and cut off the return pass. Its length and voice are a good model for our explanations. <https://www.goodreads.com/book/show/21451166-soccer-iq> |
| England Football Learning free courses | Course | Free introductory courses from the FA. They suit adults and parents but are light on positioning rules. <https://learn.englandfootball.com/courses/free-courses> |
| U.S. Soccer Grassroots pathway (4v4 to 11v11 courses) | Course | Free introduction plus short format-specific courses that use the same four-moments framework the app adopts. <https://www.ussoccer.com/stories/2018/08/7v7-9v9-and-11v11-online-courses-complete-new-us-soccer-grassroots-coaching-pathway> |

### 2.3 Intermediate (coach-level principles)
| Resource | Type | Why |
|---|---|---|
| *Football's Principles of Play* (Peter Prickett, 2021) | Book | The best single book on the principles layer, with 90+ diagrams. Use it to check our definitions. <https://hawksmoorpublishing.com/book/footballs-principles-of-play-soccer-tactics> |
| FIFA Training Centre | Website (free) | Credible practices and tournament analysis, e.g. 6v6 high-block pressing, corners at World Cup 2022, and goalkeeper positioning. <https://www.fifatrainingcentre.com/en/> |
| The FA England DNA, "How We Play" | Curriculum | A clean top-level taxonomy: in possession, out of possession, transitions. It frames defending as delay, deny, dictate. <https://www.thefa.com/bootroom/resources/england-dna/how-we-play/out-of-possession> |
| Coachbetter, "Behavior of the back four" | Website | Back-line rules for when to step, drop and shift. Covers crescent and L shapes, and gives 40-50 ft line spacing. <https://www.coachbetter.com/blog/soccer-knowledge-how-to-defend-in-football-behavior-of-the-back-four> |
| Soccer Coach Weekly, "What is covering?" | Website | The second defender's angle and distance, explained well. <https://www.soccercoachweekly.net/coaching-advice/what-is-covering> |
| Minnesota Youth Soccer, defending coaching points | 1-page PDF | Compact first- and second-defender rules. <https://cdn1.sportngin.com/attachments/document/0112/0410/cp_defending.pdf> |
| Keeperstop (Christian Benjamin; George Kostelis) | Website | Among the few sources that give goalkeeper *numbers*: depth off the line by ball distance, and starting positions for crosses. |
| DFB fussball.de, "Die Viererkette systematisch schulen" | Curriculum (German) | German federation guidance on shifting a back four with equal gaps. <https://training-service.fussball.de/trainer/artikel/die-viererkette-systematisch-schulen-2590/> |

### 2.4 Advanced (positional play and modern pressing)
| Resource | Type | Why |
|---|---|---|
| Spielverlagerung.com | Website | Juego de posicion (lanes and lines), half-spaces, counter-pressing timing, and a glossary covering cover shadow and zone 14. Active in 2026. <https://spielverlagerung.com/> |
| Touchline Theory, positional-play guide and cover-shadow essay | Website | A readable account of the five lanes, "2 per lane, 3 per line", the free man and pinning. <https://touchlinetheory.com/the-practical-guide-to-actually-understanding-positional-play/> |
| Motzenbecker, "The Five Superiorities" | Website | Vocabulary for numerical, positional, qualitative, dynamic and cooperative superiority. <https://motz.football/thoughts/2020/07/20/the-five-superiorities/> |
| John Muller, "Let's Talk About the Salida Lavolpiana" | Newsletter | A precise, conditional build-up rule: the #6 drops between the CBs, but only against a front two. <https://www.theoutfield.nyc/p/lets-talk-about-the-salida-lavolpiana> |
| U.S. Soccer U17+ Learning Plan (2023) | Curriculum PDF | The richest source of codeable rules, covering all four moments. **Every page is marked "CONFIDENTIAL - Not to be shared without U.S. Soccer approval"**, even though state associations host it. Paraphrase and cite; never reproduce. <https://www.alsoccer.org/wp-content/uploads/sites/282/2024/10/US-Soccer-Player-Development-Framework-U17-Learning-Plan.pdf> |
| Fussball-Training Trainerblog, "Viererkette: Abstaende & Verschieben" | Website (German) | Explains why fixed spacing in metres is misleading, and names back-line shapes. <https://trainerblog.fussball-training.org/fussball-taktik/defensive/viererkette-lernen-trainieren-abstaende-verschieben-3737.html> |
| Between the Posts | Website | High-volume tactical match reports. Useful for real examples. <https://betweentheposts.net/> |
| *Inverting the Pyramid* (Jonathan Wilson, revised 2024); *Zonal Marking* and *The Mixer* (Michael Cox) | Books | History and context: why back fours, zonal marking and pressing emerged. They are good for "story" cards. |

### 2.5 Research the app is built on (for designers)
| Resource | Why |
|---|---|
| FUT-SAT (Teoldo da Costa et al., 2011, open access) | Operational definitions of 10 core tactical principles. It also gives geometry primitives: the ball line, the "game centre" circle, and a grid of corridors and sectors. <https://revistas.rcaap.pt/motricidade/article/view/121> |
| Costa, Garganta, Greco and Mesquita (2009), in Portuguese | Context rules per principle, e.g. the cover defender moves closer when play is central and near goal. <https://www.periodicos.rc.biblioteca.unesp.br/index.php/motriz/article/download/2488/2534/13273> |
| TacticUP Video Test (Machado and Teoldo, 2020, CC BY) | A validated freeze-then-decide test, keyed by an expert panel with a per-principle report. <https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.01690/full> |

### 2.6 Video
- **The Coaches' Voice, James Lawrence Allcott, Tactics HUB, RDF Tactics.** These come from a curated July 2025 list: <https://breakingthelines.com/@btl/some-tactics-obsessed-football-youtubers-to-watch>
- **Tifo Football (The Athletic)** `[unverified]`. The channel exists, but its page would not render. <https://www.youtube.com/channel/UCGYYNGmyhZ_kwBF_lqqXdAQ>

### 2.7 Not recommended, or unverified
- **Total Football Analysis.** It carries betting and odds content, so don't link it from a youth-facing app.
- **Coerver Coaching** `[unverified]`. It is technical, focused on ball mastery and 1v1 play, with little positioning content.
- **KNVB "Dutch vision" PDF** `[unverified]`. Only a third-party copy was found. The KNVB is the origin of the "four moments" and of 4v4 as the basic learning game.
- ***The F.A. Guide to Training and Coaching*** (Allen Wade, 1967) `[unverified]`, out of print. It is the historical origin of the principles of play.
- ***Coaching the Tiki Taka Style of Play*** (Jed Davies) `[unverified]`.

---

## 3. Existing apps and tools that teach positioning

### 3.1 Closest to our idea
| Product | What it does well | Gap versus our app | Status |
|---|---|---|---|
| **Soccer Positioning** (Peter Blumen, Android, $12.99) <https://play.google.com/store/apps/details?id=com.soccertrainer.positioning> | You drag yourself around a live 4-4-2 with AI teammates. It shows a real-time 0-100 score, uses rising audio pitch as a hot/cold cue, grades S to F, keeps session stats, and has a "turnover training" hold limit. | Closed source, Android only. Fixed 4-4-2. The scoring is opaque and there is no teaching by principle. The store listing says "Contains ads" while the description says "no ads". | Updated Mar 2026; 10+ downloads |
| **ErrantActions/Soccer-Position-visualizer** (web) <https://github.com/ErrantActions/Soccer-Position-visualizer> | You drag the ball and see the recommended spot and a heatmap for your role. Challenge mode covers all 11 roles of a 4-4-1-1 in 4 states. Scoring is a weighted blend: goal-side 35%, shape 25%, support 20%, danger 20%. Each result has a "why" tag with a child-friendly wording. | **No license.** No opponents at all. The ball is static and moved by the user. Pressure/cover/balance ignores who has the ball. Challenge scoring ignores the tactical state: a striker in an attacking scenario is told to "stay goal side". | 0 stars; last commit 2026-09-19 |
| **TacticUP** <https://tacticup.com.br/> | A validated, expert-keyed video test. It reports per principle and per phase, and is used by clubs. | It assesses rather than trains, answers are multiple choice, and there are no explanations. It needs a computer or a tablet of at least 10 inches. The live site now lists **12** principles, up from the paper's 10. | Active 2026 |
| **SmartPitch Soccer** (iOS) <https://apps.apple.com/us/app/smartpitch-soccer/id6782971217> | Aimed at ages 8-14, in 7v7, 9v9 and 11v11. You read the play, then tap the best decision against a clock. Grading has five levels, a "what would have happened" animation follows, and there are packs for off-ball movement, scanning and pressing. | Tap-to-choose, not free placement. iOS only. | Released 2026-06-25; 0 ratings |
| **SportsLab360** <https://sportslab360.com/> | A loop of game film, a 3D animated decision and a quiz, distributed through state associations. About $4.99 a month. | You pick from options in pre-rendered scenes, with light gamification. | Live |

### 3.2 Cognitive and perceptual trainers (these train scanning and reaction, not placement)
| Product | Note |
|---|---|
| Soccer IntelliGym <https://soccer.intelligym.com/> | Abstract "brain training". Its "2 x 30 min a week" dosing and parent marketing are templates worth noting. There is no pitch and no tactical "why". |
| Rezzil (VR) <https://rezzil.com/> | A benchmark "Index" score and scanning drills. Needs a headset, and trackers for the pro version. |
| Be Your Best (VR) <https://www.beyourbest.com/en-us/scenarios> | Replays real match scenarios with memory questions and multi-angle replay. $19-29 a month; needs a headset. |
| TSG Hoffenheim "Helix" <https://www.bundesliga-group.com/innovation/the-helix-training-tsg-style/> | A club-only projection dome. Its "remember the runs" multiple-object-tracking task could become a cheap 2D mini-game. |
| PlayScan <https://getplayscan.com/football-scanning-training> | Structure worth copying: a free baseline test, a four-week plan, then a retest. |
| VisionPlay: Soccer IQ (iOS, 2026) <https://apps.apple.com/us/app/visionplay-soccer-iq/id6761316273> | 3-minute reaction-and-choice sessions. |

### 3.3 Games and puzzles (you act as the whole team, not one role)
| Product | Worth borrowing |
|---|---|
| Tactician Football (iOS, 4.7 stars) <https://apps.apple.com/us/app/tactician-football-soccer/id1659427194> | Freezes at key moments, 2-minute matches, daily leagues, and celebratory feedback. |
| Football Manager 26 Tactics Visualiser <https://www.footballmanager.com/fm26/features/possession-out-possession-fm26s-new-tactical-evolution> | Stores each player's target position by ball zone on a 3 x 3 grid, separately in and out of possession. This is the mental model behind our layer A. |
| Football, Tactics & Glory (Steam) <https://store.steampowered.com/app/375530/Football_Tactics__Glory/>; HexaFootball <https://store.steampowered.com/app/4347390/HexaFootball/> | Proof that turn-based "freeze and think" football is fun. HexaFootball's roguelite run structure could shape a campaign. |
| FootBrain (2026, iOS and web) <https://playfootbrain.com/>; TikiTaka daily puzzle <https://matchiq.online/tikitaka>; Allstars IQ <https://play.google.com/store/apps/details?id=com.allstarsiq.app> | Daily puzzles, streaks and share cards. The niche is crowded, so a daily hook alone won't set us apart. |
| Pitch Tactics (Android) <https://play.google.com/store/apps/details?id=co.gamegarden.pitch_tactics>; Match Strategy Board <https://play.google.com/store/apps/details?id=com.tacticszone.footballstrategyhub> | Offers drag-or-two-tap input, an accessibility pattern worth copying. Also has an engine that scores whole-team placement, a manager's view with no real uptake. |

### 3.4 Quizzes and lessons
- **Taptics** <https://apps.apple.com/ch/app/taptics/id6738706939>: coaches assign playbook homework. Onboarding is closed, via email.
- **Football Tactical IQ Test** <https://calculatorscore.com/football-iq-test/>: a shareable identity result ("72% Zidane"). Not validated.
- **FootballGPT daily quiz** <https://footballgpt.co/guides/football-tactical-iq-test-your-knowledge-now>: a sudden-death streak.
- **OFN Soccer Training Academy** <https://apps.apple.com/us/app/ofn-soccer-training-academy/id1571100807>: passive video lessons by position, with a heavy paywall.

### 3.5 Coach tactics boards (no correct answer, no learner loop)
- TacticalPad <https://www.tacticalpad.com/>
- Coach Paint <https://www.coachpaint.com/> (its overlay visuals are a good model for our reveal screen)
- Tactics Manager <https://www.soccertutor.com/pages/tactics-manager>
- The Coaching Manual <https://www.thecoachingmanual.com/>
- Sportplan <https://www.sportplan.net/>
- Coach Tactic Board <https://apps.apple.com/us/app/coach-tactic-board-soccer/id834813357>
- Tactico <https://tactico.pro/soccer-tactics> (web and WhatsApp sharing, the right pattern for our future coach share links)

### 3.6 Design references outside soccer
- **GeoGuessr scoring** <https://latb.io/geoguessr/articles/the-maths>. Each guess scores `5000 x exp(-10 d / D)`, where d is the distance from the answer and D is the map diagonal. This smooth "how far off were you" decay is intuitive and forgiving.
- **Lichess puzzle themes** <https://lichess.org/training/themes>. Puzzles are tagged by theme and come in Storm (timed), Streak and Racer modes. It is the template for "positioning puzzles by principle".
- **EA SPORTS FC player ratings** (cautionary) `[unverified; search snippets only]`. Forum threads complain that an unexplained positioning rating feels random. So we always reveal the target and the reason.

### 3.7 The gap, and what to copy
The market splits into four camps that don't overlap: coach boards, cognitive trainers, pick-an-option quizzes, and games where you manage the whole team. No product occupies the overlap our app targets:
- a single assigned role;
- a dynamic scene;
- free placement;
- a visible ideal zone with a principle-level reason;
- structured progression;
- a free browser app.

Mechanics to copy:
- a live hot/cold meter, optionally with audio pitch;
- S-F grades and session stats;
- a consequence replay;
- short sessions;
- per-theme puzzle packs;
- a baseline test, a four-week plan and a retest;
- drag-or-two-tap input;
- coach share links later.

Mechanics to avoid:
- opaque scores;
- global leaderboards;
- loot and card systems;
- aggressive paywalls.

---

## 4. Open-source code landscape and the build-off decision

The research agents found about 45 repositories. Sixteen were cloned and checked in a dedicated verification pass. In that pass each repo's LICENSE file, last commit, size and code were read on 2026-09-27. Table 4.1 lists those repos, and the verdict column is authoritative. Table 4.2 lists repos reported only by the discovery sweeps; their licences are as reported and should be re-checked before any use.

### 4.1 Repos checked in the verification pass
| Repo | License (from LICENSE file) | Stack | Last commit / stars | Verdict | What we take |
|---|---|---|---|---|---|
| [ErrantActions/Soccer-Position-visualizer](https://github.com/ErrantActions/Soccer-Position-visualizer) (also resolves as Girthquake/...) | **None**, so all rights reserved | React 19, TS, Vite, Tailwind (needs Node) | 2026-09-19 / 0 | **Reference only** | Ideas only (see below). Ask the author for an MIT licence. |
| [helios-base/helios-base](https://github.com/helios-base/helios-base) | Root LICENSE is MIT (2021). About 133 C++ files carry GPL-3 headers and about 119 carry LGPL-3 headers. The `.conf` data files have no header. | C++ plus JSON formation data | 2025-10-05 / 48 | **Borrow component (data)** | `src/formations-dt/normal-formation.conf`: 115 samples, each mapping a ball position to 11 role positions. Also the set-play variants. Never the C++. |
| [mapbox/delaunator](https://github.com/mapbox/delaunator) | ISC | JS (UMD on jsDelivr, verified 200) | 2026-06-18 / ~2.6k | **Borrow** | Triangulates the formation samples. We write point location and barycentric interpolation ourselves (about 40 lines). |
| [migueljfsc/pitchboard](https://github.com/migueljfsc/pitchboard) | MIT (package.json is `private`) | React 19, TS 6, Vite 8, Cloudflare Worker; about 39k LOC | 2026-09-27 / 1 | **Borrow component** | Hand-port `src/board/pitch.ts` (IFAB `PITCH` constants plus `drawPitch`, including a correct penalty arc) and `src/formations/index.ts` (`fromNotation("4-3-3")` gives lines and shirt numbers) to plain JS, keeping the MIT notice. |
| [konvajs/konva](https://github.com/konvajs/konva) | MIT | TS canvas scene graph; the UMD from jsDelivr was tested working with no build | 2026-09-23 / 14.8k | **Borrow (fallback only)** | Use only if SVG dragging performs poorly on low-end phones. |
| [d3/d3-delaunay](https://github.com/d3/d3-delaunay) | ISC | JS (UMD tested) | 2025-11-10 / 655 | **Borrow (v2)** | Voronoi "space you own" overlay. It is a crude proxy for control because it ignores speed. |
| [probberechts/d3-soccer](https://github.com/probberechts/d3-soccer) | LICENSE is BSD-3-Clause; package.json and npm say MIT | D3 v7 SVG | 2024-12-07 / 77 | **Reference (dimensions)** | The horizontal pitch renders fine. `rotate()` is broken (the vertical pitch gets clipped), and the 0.3.0 CSS file is missing. |
| [iamsorenl/arcade-soccer](https://github.com/iamsorenl/arcade-soccer) | MIT | Vanilla JS, Canvas, no build | 2026-09-20 / 0 | **Reference only** | 4v4 is hard-coded throughout and the markings don't follow IFAB (the goal is 18 m wide). Worth copying: its structural patterns, the `mulberry32` seeded RNG and a fixed-step loop. |
| [Mugen87/kickoff](https://github.com/Mugen87/kickoff) | MIT | JS, Yuka, three.js (bundler needed) | 2021-01-19 / 33 | **Reference only** | The support-spot idea only. Its grid is 5 x 5, not 12 x 5, and its distance term is wrong. Use Buckland's original, which peaks at the optimal pass distance. There is also a case-sensitive import bug. |
| [Friends-of-Tracking-Data-FoTD/LaurieOnTracking](https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking) | MIT (added 2021 by the org, not the author) | Python | 2021-06-15 / 360 | **Borrow component (v2)** | `EPV_grid.csv` (32 x 50, attack left to right; **it assumes a 106 x 68 pitch**; its provenance is undocumented). Also the Spearman time-to-intercept constants. |
| [keisuke198619/C-OBSO](https://github.com/keisuke198619/C-OBSO) | MIT, but it redistributes Laurie's files without the FoTD notice | Python 3.6 (pinned, won't run on modern pandas) | 2024-12-16 / 7 | **Reference only** | The OBSO formula idea: control x Gaussian transition (sigma about 14 m) x EPV. The claimed "shot-blocking Gaussian" was not found in the code. |
| [Alek050/databallpy](https://github.com/Alek050/databallpy) | MIT | Python 3.10+ | 2026-09-23 / ~103 | **Borrow formulas (v2)** | Fernandez-Bornn pitch control and Andrienko/Herold pressure. Three bugs to fix while porting: the scaling matrix is missing a `/2`, a docstring swaps home and away, and influence is normalised by the max instead of the sum. |
| [PySport/kloppy](https://github.com/PySport/kloppy) | BSD-3 | Python | 2026-08-06 / ~558 | **Reference / offline tool** | Its table of provider coordinate systems. It is only useful for offline data extraction. |
| [SkillCorner/opendata](https://github.com/SkillCorner/opendata) | MIT (applied to data; credit requested) | Data plus a zero-build HTML viewer | 2026-09-14 / ~425 | **Borrow (v2 data)** | 20 A-League 2024/25 matches: tracking, roles, phases and off-ball-run labels. The viewer has an MIT half-plane Voronoi of about 50 lines. |
| [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | MIT | TS; UMD build (72 KB, verified 200) | 2026-09-02 / ~799 | **Borrow (v2)** | Spaced-review scheduler. For the MVP a Leitner box or "weakest principle first" is enough. |

### 4.2 Repos reported by the discovery sweeps (not re-verified; check the licence before use)
| Repo | Reported licence | Note |
|---|---|---|
| [tbleckert/football-simulator](https://github.com/tbleckert/football-simulator) | MIT (LICENSE added 2026-09-18; the npm 2.0.0 package lacks a license field) | A TypeScript 11v11 simulator with 0.25 s snapshots. Candidate engine for a v3 "real match" mode; needs a build. |
| [TacticsJournal/board](https://github.com/TacticsJournal/board) | MIT, but its trademarks and artwork are excluded | Reference for touch-friendly Konva pitch editing. |
| [meser1905/TacticBasicsFootball](https://github.com/meser1905/TacticBasicsFootball) | MIT | 23 formation files with normalised role slots plus strengths and weaknesses text. Useful as v2 anchors for other systems. |
| [google-research/football](https://github.com/google-research/football) | Apache-2.0; **archived** | Reference for `AI_GetAdaptedFormationPosition` and its academy scenario setups. |
| [andrewRowlinson/mplsoccer](https://github.com/andrewRowlinson/mplsoccer/blob/main/mplsoccer/soccer/formations.py) | MIT | 68 formation templates, including small-sided ones. Anchors for v3 youth formats. |
| [floodlight-sports/floodlight](https://github.com/floodlight-sports/floodlight) | MIT | Definitions of stretch index and nearest-mate distance, plus a Voronoi with motion models. |
| [ML-KULeuven/socceraction](https://github.com/ML-KULeuven/socceraction) | MIT | Refit an xT grid offline on data we are licensed to use. |
| [UnravelSports/unravelsports](https://github.com/UnravelSports/unravelsports) | MPL-2.0 | Labels formation roles on tracking frames (offline). Also a pressing-intensity formula. |
| [Mugen87/yuka](https://github.com/Mugen87/yuka) | MIT | Optional steering (arrive/interpose). A lerp is probably enough. |
| [GallagherAiden/footballSimulationEngine](https://github.com/GallagherAiden/footballSimulationEngine) | MIT (LICENSE) / ISC (pkg) | Basic off-ball logic; not recommended. |
| [jonas-bischofberger/accessible-space](https://github.com/jonas-bischofberger/accessible-space) | MIT | "Dangerous accessible space". Too heavy for v1. |
| [helios-base/librcsc](https://github.com/helios-base/librcsc) | LGPL-3 | Reference for the Delaunay interpolation algorithm. **Do not copy.** |
| [helios-base/soccerwindow2](https://github.com/helios-base/soccerwindow2), [fedit2](https://github.com/helios-base/fedit2) | GPL-3 | UX reference for a formation editor (place ball, drag players, record sample). |
| [wangchen/Programming-Game-AI-by-Example-src](https://github.com/wangchen/Programming-Game-AI-by-Example-src) | None | Buckland's original SimpleSoccer (SupportSpotCalculator). Read for intent. |
| [sebsowter/phaser-simple-soccer](https://github.com/sebsowter/phaser-simple-soccer), [eric-therond/simplesoccer](https://github.com/eric-therond/simplesoccer) | package.json says MIT; no LICENSE file | Other SimpleSoccer ports. Reference only. |
| [hyunsungkim-ds/soccercpd](https://github.com/hyunsungkim-ds/soccercpd) | No LICENSE file | Idea: "formation fingerprint" as Delaunay role adjacency. |
| [anenglishgoat/InteractivePitchControl](https://github.com/anenglishgoat/InteractivePitchControl) | AGPL-3 | Idea only. Its Fernandez-Bornn scaling includes the `/2`. |
| [gitlab.com/robocup-sim/JaSMIn](https://gitlab.com/robocup-sim/JaSMIn), [ProtoxiDe22/DevSoccer](https://github.com/ProtoxiDe22/DevSoccer), [luiskarlos/soccer](https://github.com/luiskarlos/soccer) | AGPL / GPL | Not reusable. |
| No licence (reference only): [gljubojevic/tactics-board](https://github.com/gljubojevic/tactics-board), [AdzMarr/HTCG15_TacticsBoard](https://github.com/AdzMarr/HTCG15_TacticsBoard), [pitchsidecontent1-cell/tactics-canvas](https://github.com/pitchsidecontent1-cell/tactics-canvas), [BlueSky8bya/soccer-tactics](https://github.com/BlueSky8bya/soccer-tactics), [modelence/open-soccer](https://github.com/modelence/open-soccer), [johnd-commits/football](https://github.com/johnd-commits/football), [LilBlud05/Football-Tactical-Board](https://github.com/LilBlud05/Football-Tactical-Board), [AgastyaGuha/Kinematic-pitch-control](https://github.com/AgastyaGuha/Kinematic-pitch-control) | None | Useful ideas: tactics-canvas names the missing condition when a move is wrong. HTCG15 shows that pointer dragging works in a single file with no build. johnd-commits is an American-football "drag yourself and get graded" loop. Kinematic-pitch-control checks pass lanes with time-to-intercept. |
| Permissive but small or stale: [tacticalboard/tacticalboard](https://github.com/tacticalboard/tacticalboard) (MIT, 2022), [zenggo/soccer-tactical](https://github.com/zenggo/soccer-tactical) (Apache-2.0, 2020), [giustini/react-soccer-lineup](https://github.com/giustini/react-soccer-lineup) (package says MIT, no LICENSE file), [ivo-/open-haxball](https://github.com/ivo-/open-haxball) (MIT, off-target) | as noted | Not needed. |

**Licensing traps found.**
- Several repos declare MIT in package.json but have no LICENSE file (sebsowter, eric-therond, react-soccer-lineup, tactics-canvas).
- In others the LICENSE file and package.json disagree (d3-soccer, footballSimulationEngine, zenggo).
- helios-base has an MIT repo licence but GPL/LGPL file headers.
- Several are copyleft (JaSMIn, InteractivePitchControl, soccerwindow2/fedit2, librcsc, DevSoccer, luiskarlos).

GitHub's search API rate-limited the agents, so some small new repos may have been missed.

### 4.3 Build-off decision
**Decision: build our own small app, and borrow data and components rather than fork.**

Why not fork anything?
1. **The closest match cannot legally be reused.** Soccer-Position-visualizer has no licence. It also has no opponents and a static ball. Its challenge scoring is not state-aware, so it would need rewriting anyway. We treat it as an idea bank and email the author to ask for an MIT licence. The ask is cheap and there is no downside.
2. **The permissive "bases" are the wrong product.**
   - pitchboard is a scene-authoring and video-export tool with accounts, a Cloudflare backend and six sports, at about 39k lines.
   - arcade-soccer is hard-wired to 4v4 with non-IFAB markings.
   - kickoff is a 5-a-side 3D demo built on three.js.
   - Stripping any of them down would cost more than writing the roughly 2-3k lines we actually need.
3. **This machine has no Node, npm, deno or bun.** Every React, TS or Vite codebase needs a build toolchain. A zero-build ES-module app runs with the Python 3.9 already installed and deploys to GitHub Pages as-is.
4. **The valuable parts are small and separable.**
   - The formation "answer key" is a JSON file.
   - Triangulation is one ISC library.
   - The pitch drawing is about 100 lines.
   - The analytics formulas (time-to-intercept, pressure, pitch control) are 50-150 lines each.

**Exactly what we borrow, and our obligations.**

| Component | From | Licence | Obligation | Release |
|---|---|---|---|---|
| Ball-to-11-positions formation samples | helios-base `formations-dt/normal-formation.conf` (plus set-play files later) | MIT (root) | Keep the copyright notice in `THIRD_PARTY.md`, note our edits and the coordinate conversion, and ask the maintainers to confirm that MIT covers the data. A coach should review before we teach from it. | v1 |
| Delaunay triangulation | delaunator@5 | ISC | Vendor it with its licence (it bundles robust-predicates, which is Unlicense) | v1 |
| IFAB pitch constants and drawer; formation-notation helper | pitchboard `src/board/pitch.ts`, `src/formations/index.ts` | MIT | Keep the notice in the ported file header | v1 |
| Half-plane Voronoi | SkillCorner `viz_tools` viewer | MIT | Keep the notice | v2 |
| EPV value surface; time-to-intercept constants | LaurieOnTracking | MIT | Credit FoTD, Laurie Shaw and Spearman. Remember the grid assumes a 106 x 68 pitch. | v2 |
| Pressure and pitch-control formulas | databallpy (ported, with bug fixes) or directly from the papers | MIT | Credit the repo and the papers | v2 |
| Real-match scenes | SkillCorner Open Data; DFL/IDSSE | MIT; CC BY 4.0 | Credit lines (section 6) | v2 |
| Spaced review | ts-fsrs UMD | MIT | Vendor with LICENSE | v2 |

**Ideas we reimplement ourselves (no code copied):**
- the visualizer's "influence blend with reason tags", with standard and child wording;
- Buckland's support-spot scoring, with the correct distance term;
- arcade-soccer's `coverLanePoint` (stand 45% of the way from the ball to the most advanced receiver);
- the fedit-style authoring loop: place the ball, drag the players, record a sample.

---

## 5. Positioning models for automatic scoring

### 5.1 Overview: what each model answers, and when we use it
| Model | Question it answers | Browser cost | Release | Why / why not in v1 |
|---|---|---|---|---|
| **Delaunay formation interpolation** (Akiyama and Noda 2008; HELIOS data) | "Where does my role normally stand for this ball position?" | Trivial (lookup over about 220 triangles) | **v1 (layer A)** | This is the "right spot moves with the ball" core. A coach can author and understand it. |
| Linear anchor + slope | Same question, as a straight-line fit | Trivial | v1 fallback / tests | Reproduces HELIOS well: R^2 is 0.87-0.99 for x and 0.64-0.95 for y `[M]`. |
| **Geometric principle rules** (FUT-SAT and coaching sources) | "Does my spot satisfy goal-side, cover, level line, width...?" | Trivial | **v1 (layer B)** | Each rule maps to exactly one explanation sentence, and the rules share the vocabulary of the validated TacticUP/FUT-SAT taxonomy. |
| **IFAB validity** (offside, restart distances) | "Is this spot legal?" | Trivial | **v1** | Hard constraints, used for critical fails. |
| **Ghost-lite argmax** | "What is the best spot near my base position?" | About 700 evaluations per query, well under 5 ms | **v1 (layer C)** | Produces the ideal marker and the heatmap from the same scoring function. |
| Voronoi (d3-delaunay or SkillCorner viewer code) | "Who is nearest to each point?" | Trivial | v2 visual | Easy to grasp, but it ignores speed and direction. |
| Time-to-intercept and pass-lane probability (Spearman 2017) | "Can the ball reach me before a defender does?" | Cheap | v2 | Needs velocities for full value. v1 uses a geometric lane check instead. |
| Soft pitch control (closed-form approximation of Spearman) | "Which team controls this point?" | About 3.5 ms per full grid in numpy `[M]`; similar in JS | v2 | Adds the value term. |
| Fernandez-Bornn parametric control | Same, as a Gaussian influence model | Cheap | v3 option | databallpy's port has bugs, so implement it from the paper. |
| xT / EPV value grids | "How dangerous is the ball at this point?" | Lookup | v2 | Licensing: Karun's grid has no licence; Laurie's EPV grid sits in an MIT repo but its provenance is undocumented. |
| OBSO-lite (Spearman 2018; C-OBSO) | "How valuable is an attacker's off-ball spot?" | Three grid products | v2/v3 | The in-possession value term. |
| Andrienko/Herold pressure | "How much pressure am I putting on the ball?" | Trivial | v2 | Gives "press" a number. |
| Counterfactual threat denied (Cascioli and Wang 2025 concept) | "How much danger does my spot remove?" | About 1 ms | v3 | The defender value term. The paper's parameters were not verified. |
| Deep ghosting (Le et al. 2017; GVRNN; TacticAI) | "Where would a league-average player be?" | Not viable | Never | Needs proprietary tracking data and heavy models. |

### 5.2 Layer A: base position from a ball-indexed formation table
**Data.** `helios-base/src/formations-dt/normal-formation.conf` is JSON with `method: "DelaunayTriangulation"`, 11 roles and **115 samples**. Each sample is `{ball:{x,y}, "1":{x,y}, ..., "11":{x,y}}`. Coordinates are centre-origin on a 105 x 68 pitch, with the team attacking toward +x and the goalkeeper at x = -50. Samples reach the corners (±54.5, ±36), so the triangulation hull covers the whole pitch. In the research sweep the 115 samples triangulated to 220 triangles. The shape is a 4-1-2-3 (4-3-3):

| HELIOS role (number) | App role |
|---|---|
| Goalie (1) | GK |
| CenterBack L/R (2/3) | LCB / RCB |
| SideBack L/R (4/5) | LB / RB |
| DefensiveHalf (6) | #6 |
| OffensiveHalf L/R (7/8) | L8 / R8 |
| SideForward L/R (9/10) | LW / RW |
| CenterForward (11) | #9 |

**Conversion to the app frame:** `x_app = x_h + 52.5`, `y_app = y_h + 34`. HELIOS "L" roles have negative y; this was re-checked in sample 0, where the ball is at the top-right corner and the L players sit at y = -27 to -31. They therefore map to small y, which is our top/left side, so no flip is needed. Unit tests must assert two things: LB always has y < 34, and #9's x increases monotonically with ball x.

**Interpolation (write ourselves; do not port the LGPL librcsc code):**
```
setup:  pts = samples.map(s => [s.ball.x, s.ball.y]);  T = Delaunator.from(pts).triangles
query(b):
  b = clamp(b, pitch)
  for each triangle (i, j, k) in T (start from the cached last hit):
     (w1, w2, w3) = barycentric(b; pts[i], pts[j], pts[k])
     if min(w1, w2, w3) >= -1e-9:
        return { role: w1*P[i][role] + w2*P[j][role] + w3*P[k][role] }
  return P[nearestSample(b)]          // fallback, should not happen inside the hull
```

**Opponents.** Mirror the table through the centre spot. Transform the ball into the opponents' frame with `b' = (105 - b.x, 68 - b.y)`, interpolate, then map every role back with `p -> (105 - p.x, 68 - p.y)`. Their left back then correctly appears at large y, which is their left as they attack toward x = 0. v2 adds a second opponent table, for example a 4-4-2 built in the authoring tool.

**Possession offset `[D]`.** HELIOS has only one phase. The normal, offense and defense files are byte-identical. Add Δx = +6 m to every outfield target when your team has the ball and -4 m when it doesn't (adapted from tbleckert's simulator). Replace this with authored in-possession and out-of-possession tables; 20-40 samples each is enough.

**Known data quality issue.** The tables were tuned for RoboCup agents, not taught by coaches. In one sample, the ball is at (44.5, 22.4) in HELIOS coordinates, and the near-side right back stands behind the far-side left back. Before release, a coach reviews each role in the authoring tool, and the edited table ships as our own data file with attribution.

**Linear fallback (regression on HELIOS; centre-origin intercepts; `[M]`).** Use `target_x = 52.5 + i_x + k_x (ball_x - 52.5)` and `target_y = 34 + i_y + k_y (ball_y - 34)`. For i_y, use the negative value for left-side roles.

| Role | k_x | k_y | i_x (m) | i_y (m) | Example: ball on the centre spot |
|---|---|---|---|---|---|
| CB | 0.48 | 0.32 | -18.4 | ±5.6 | LCB at (34.1, 28.4) |
| FB | 0.56 | 0.31 | -15.4 | ±15.8 | LB at (37.1, 18.2) |
| #6 | 0.70 | 0.47 | -7.6 | 0 | (44.9, 34) |
| #8 | 0.80 | 0.40 | -1.0 | ±10 | L8 at (51.5, 24) |
| Winger | 0.72 | 0.25 | 10.7 | ±21.2 | LW at (63.2, 12.8) |
| #9 | 0.71 | 0.43 | 10.5 | 0 | (63.0, 34) |

Shape measurements from the HELIOS samples `[M]`:
- outfield team length: median 31 m (range 17-47);
- outfield team width: median 46 m (range 36-54);
- nearest-teammate distance: median 11.4 m (p10 6.2, p90 16.8);
- #6 sits a median 7.3 m ahead of the back line.

### 5.3 Zone score (distance to the base or authored ideal)
We use an anisotropic tolerance ellipse. dx is measured along the pitch length and dy across it:
```
d_n    = sqrt( (dx / t_x)^2 + (dy / t_y)^2 )
S_zone = 1                          if d_n <= 1      (full marks inside the ellipse)
       = exp( -0.5 * (d_n - 1)^2 )  otherwise        (half credit at about 2.2x tolerance)
```
| Role | t_x along the pitch (m) | t_y across (m) | Rationale |
|---|---|---|---|
| CB, FB (back line) | 2.5 | 4 | Line height matters most |
| #6 | 4 | 4 | |
| #8 | 5 | 6 | More freedom |
| Winger | 6 | 4 | Width matters |
| #9 | 6 | 6 | |

All tolerances are `[D]`, taken from the positioning-models sweep. They are then **re-keyed per scenario** by the coach panel (section 7). Where coaches legitimately disagree, widen the ellipse. The GeoGuessr-style full-marks core plus exponential decay makes the score forgiving and intuitive.

### 5.4 Context builder (runs once per frame)
From the frame (ball, possession, carrier, 22 positions) and optional scenario tags, derive:
- **Pressure on ball:** an opponent within 3 m `[D]` of the carrier.
- **Carrier facing:** forward, backward or sideways. This is a scenario tag in v1, since we have no body orientation.
- **Ball moved backward:** derived from the last ball movement, or a tag.
- **Ball zone:** third (x) × lane (y).
- **Block height** of the defending team, from its back-line median x: high ≥ 45, mid 25-45, low < 25 `[D]`, matching the block heights in section 8, row U6.
- **Opponent defensive line x:** the second-last defender. **Opponent midfield line x:** the median x of their midfield unit. **Our back line x:** the median x of our back four.
- **Duties** (FUT-SAT's first, second and third defender or attacker):
  - First defender: our player nearest the ball, when defending.
  - Second defender: the nearest teammate to the first defender who is goal-side of the ball and within 15 m `[D]`.
  - Third defenders: everyone else.
  - The centre-of-play radius is configurable, default 12 m `[D]` (see Appendix A: the published 9.15 m came from a 3v3 game).
  - **Important:** compute duties with the learner's token at its *layer-A base position*, not where the learner dropped it. Duties describe "who should be doing what". The learner's placement is then judged against that duty, which avoids circular scoring.

### 5.5 Layer B: v1 rule library (geometric, cheap, explainable)
Each rule has four parts:
- `applies(ctx, role) -> bool`
- `eval(ctx, spot) -> { s: 0..1, critical: bool, fix: {dx, dy}, tag, vars }`
- a Standard template;
- a Kid template.

Band checks use `band(v, lo, hi, soft) = 1` inside [lo, hi], falling linearly to 0 at `soft` metres outside. The default is soft = 3 m `[D]`.

| Rule ID | Applies to | Check (canonical frame; own goal centre G = (0, 34)) | Critical? | Section 8 ref |
|---|---|---|---|---|
| `offside` | Attackers, in possession, at a pass moment | The learner's x > 52.5, and x > max(ball x, second-last defender x) + 0.3 m `[D margin]`. Level counts as onside. | Yes | F4 |
| `keeps-onside` | Back-liners, out of possession | You are deeper than your line (x < line - 1 m), and an opponent has an x between yours and the line. | Yes | U4 |
| `level-line` | Back-liners | \|x - median x of other back-liners\| ≤ 2 m `[D]`. Exception: the covering drop set by `cover`. | No | U4 |
| `goal-side` | Markers and defenders with an assigned attacker A | dist(you, G) < dist(A, G); angle between (G - A) and (you - A) ≤ 35° `[D]`; distance 1-3 m `[D]`, tighter in your own box. | Yes if broken inside own box | D5 |
| `press` | First defender | Distance to carrier 1.5-3 m `[D]`. Centrally: angle between (you - ball) and (G - ball) ≤ 20° `[D]`. Ball in a wing lane: be on the inside of the ball-to-G line, so the carrier is shown toward the touchline. | No | D1, D2 |
| `cover` | Second defender | Relative to presser P: behind by 3-6 m (3-5 m central and near goal; 6-10 m wide and far) and 2-4 m inside. Fails if level (\|Δx\| < 1.5 m) or directly behind (\|Δy\| < 1 m). All values `[D]`. | No | D3 |
| `tuck` | Far-side defenders when the ball is in a wing lane | Far FB within 10-15 m of far CB; far CB within about 12 m of near CB; team average y shifted toward the ball. All values `[D]`. | No | D4, U5 |
| `compact` | All, out of possession | Horizontal gaps to line-mates 8-12 m near the ball, ≤ 15 m on the far side `[D]`. Vertical gap to the next line ≤ 15 m `[S]`. Team length ≤ 35 m `[S/M]`, width ≤ 50 m `[M]` (team-level feedback). | No | U1, U2 |
| `screen` | #6, out of possession | 5-10 m ahead of the back-line mean x `[M]`. In the centre lane unless covering. Within 3 m `[D]` of the line from the ball to the most dangerous central attacker. | No | R3 |
| `width` | Designated width-holder, in possession: the winger by default, or the FB if the scenario says the winger has inverted | Within 5 m of your touchline `[D]`. The far-side winger stays in the wing lane. | No | B1 |
| `pin` | #9, in possession | x within [second-last defender x - 2, second-last defender x] `[D]` | via `offside` | B2 |
| `lane-open` | Supporting players, in possession | No opponent within 1.5 m `[D]` of the ball-to-you segment. v2 replaces this with time-to-intercept P_lane. | No | B3 |
| `support-distance` | Players within about 25 m of the ball, in possession | Carrier pressured: 5-10 m from the ball. Otherwise: 12-25 m. Not on the same line as another supporter (angle between support vectors ≥ 30°). All `[D]`. | No | B3, B4 |
| `occupancy` | In possession | At most 2 teammates in your vertical lane `[S]`; at most 3 in your horizontal band of ±2.5 m (source number, band width `[D]`). | No | B5 |
| `between-lines` | #8, #10, inverted winger, in progression | Your x lies between the opponent midfield line x and the opponent defensive line x; at least 3 m from the nearest opponent `[D]`. | No | P2 |
| `spacing` | All | Nearest teammate 6-18 m `[M]` | No | F8 |
| `box-fill` (added in integration) | #9, far winger, far #8, in possession, ball wide near their byline | Within about 3 m `[D]` of one of your P10 zones, held onside: #9 near post or penalty spot, far winger back post or spot, far #8 edge of the box or spot. The #9 and far winger stop coming short once the ball is wide in the final third (R5). | No | P10 |
| `gk-angle-depth` (v1.1) | GK | On the bisector of the post-ball-post angle within 1 m; depth interpolated by ball distance | No | G1 |

### 5.6 Combining, grading, explaining
```
S_rules = Σ w_r * s_r / Σ w_r                (applicable rules only)
score   = round(100 * (0.55 * S_zone + 0.45 * S_rules))
if any critical rule fails: score = min(score, 59)
grade:  S >= 90 | A 80-89 | B 70-79 | C 60-69 | D 50-59 | F < 50
```
- **Rule weights, v1 defaults `[D]`:**
  - Back line out of possession: `level-line` 3, `goal-side` 3, `cover` 3, `press` 3 (when it is their duty), `tuck` 2, `compact` 2.
  - #6 out of possession: `screen` 3, `cover` 2, `compact` 2, `goal-side` 2.
  - Attackers out of possession: `compact` 2, `press` 3 (when it is their duty).
  - In possession: `width` 3 (for the width-holder), `pin` 3 (#9), `lane-open` 3, `support-distance` 2, `occupancy` 2, `between-lines` 2, `spacing` 1.
- **Explanation ranking.** Sort failing rules by `w_r x (1 - s_r)`. A critical failure always comes first. Kid mode shows 1 reason; Standard mode shows 2.
- **Fix vector.** Use `ghost - you`, phrased in football terms ("drop 4 m deeper and come 3 m inside"), never in screen directions.
- **Two-beat reveal (guided discovery).**
  - Beat 1 highlights the cue on the pitch (the presser you should cover, the open lane, the runner) and asks a question.
  - Beat 2 shows the ghost, the ellipse, the principle name and the sentence, plus a "learn more" link.

### 5.7 Layer C: ghost and heatmap
- Evaluate the full score on a 1 m candidate grid within 15 m of the layer-A target, about 700 points. The argmax is the displayed ideal.
- The same evaluations fill a canvas heatmap. Use a sequential single-hue ramp that is colour-blind safe.
- If a scenario has an authored ideal, it becomes the zone centre. If the engine's ghost is more than 5 m from the authored ideal, the authoring tool flags a "key disagreement" for coach review.
- **Live mode** samples the learner's score at 10 Hz. It ignores 0.7 s after each ball event, to allow for reaction time. It reports the time-averaged score and the "recovery time" after each pass.

### 5.8 Formulas for the v2+ value layer (reference constants)
- **Time to intercept** (Spearman 2017; LaurieOnTracking defaults `[S]`). `tau_i(p) = 0.7 + |p - (x_i + 0.7 v_i)| / 5`, with reaction time 0.7 s and top speed 5 m/s. Ball travel time is `t_b(p) = |p - ball| / 15` (15 m/s). Interception probability is `P_int = 1 / (1 + exp(-(pi/sqrt(3)) / 0.45 * (t_b - tau)))` with sigma = 0.45 s. The control rate is lambda = 4.3 s^-1. The code uses kappa_def = 1 (the paper uses 1.72), lambda_gk = 3 x lambda_def, and an integration step of 0.04 s. The Spearman paper reports predicting the receiving team in 81% of held-out passes and the specific receiver in 68%.
- **Pass lane.** `P_lane = Π_j (1 - max_s P_int_j(s))` over 8-30 sample points s along the lane. The lane counts as open if P_lane > 0.6 `[D]`.
- **Soft pitch control (closed form).** `w_i = exp(-max(t_b, tau_i) / 0.33)`. Then `PC_att(p) = Σ_att w_i / Σ_all w_i`, optionally with the GK weight x3. Against Laurie Shaw's integrated implementation, over 2,400 targets in 40 random 11v11 frames, the error was RMSE 0.048 `[M]`. For comparison, a plain logistic of arrival-time difference gave 0.157, and with ball time added, 0.090. Per-player shares `w_i / Σ w` feed explanations such as "their #6 gets there 0.6 s before you".
- **Fernandez and Bornn (2018).**
  - Each player's influence is a bivariate Gaussian with its mean shifted along velocity.
  - Its covariance is stretched by speed (speed / 13 m/s) and has radius `R = min(4 + d_ball^3 / 972, 10)` m. That radius was reverse-engineered by databallpy from the paper's figure.
  - Team control = sigmoid(Σ home - Σ away).
  - When porting, include the `/2` in the scaling matrix, which databallpy omits.
- **Value grids.**
  - Karun Singh's public xT (<https://karun.in/blog/data/open_xt_12x8_v1.json>) is 12 x 8, values 0.0064-0.257, and has **no licence**.
  - Laurie's `EPV_grid.csv` is 32 x 50, values 0.004-0.571, sits in an MIT repo, has undocumented provenance, and assumes a 106 x 68 pitch.
  - databallpy's xT grids are 264 x 196, MIT, and trained on private data.
  - Preferred: use Laurie's grid with attribution, or refit xT with socceraction on SkillCorner or DFL data.
- **OBSO-lite for attackers** (Spearman 2018; C-OBSO). `V(p) = Gauss(|p - ball|; sigma about 14 m) x PC_att(p) x EPV(p)`. The attacker's score is the percentile of V(you) among the cells reachable in about 2 s, a radius of about 6.5 m.
- **Defender value (counterfactual).** Threat denied = Σ over grid of G x PC_att x EPV *without you*, minus the same sum *with you*. The concept is from Cascioli and Wang (2025); their parameters were not verified.
- **Pressure** (Andrienko 2016 / Herold 2022, as implemented in databallpy).
  - φ is the angle between the direction from the pressed player to the goal they attack and the direction to the presser.
  - `z = (1 + cos φ) / 2` and `L = d_back + (d_front - d_back)(z^3 + 0.3 z) / 1.3`.
  - `pressure = (1 - d/L)^1.75` for d < L.
  - d_back = 3 m and d_front ≤ 9 m `[S]`.
  - Check the direction of the variable d_front against Herold 2022 before porting.
- **Cover shadow (v2 rule).** B is the ball carrier and R the most dangerous receiver, the one with the highest xT at R. The learner shadows the pass if two conditions hold. First, `t = ((you - B)·(R - B)) / |R - B|^2` is in (0.15, 0.9). Second, the perpendicular distance is ≤ 1.5 m `[D]`, or, in the time-to-intercept version, some point P on the segment satisfies `0.7 + |P - you|/5 <= |P - B|/15 + 0.2` `[D; proposed by the research agent]`.
- **Shape check (v3).** Your Delaunay neighbours among teammates should match the template's role adjacency (the SoccerCPD / Narizuka and Yamazaki idea). Example message: "the #6 has lost the link between the CBs and the 8s".

### 5.9 Why v1 uses formation + rules, not pitch control
1. Authored freeze frames have no velocities. With zero velocity, pitch control collapses to a distance-weighted Voronoi and adds little.
2. Rules map one-to-one to sentences, which beginners need. A control heatmap is hard to put into words.
3. The validated assessment tradition (FUT-SAT, TacticUP) is principle-based, so our tags line up with the research.
4. Rules are deterministic, cheap and unit-testable in a zero-build app.
5. Pitch control and value grids arrive in v2 as a third term, `0.20 x S_value`, with the weights rebalanced to 0.45 / 0.35 / 0.20 as the positioning sweep proposed, once scenarios carry velocities (live mode, real tracking data).

---

## 6. Datasets and licensing

### 6.1 What exists
| Dataset | Contents | Licence | Redistribute derived snapshots? | Use in the app |
|---|---|---|---|---|
| **SkillCorner Open Data** <https://github.com/SkillCorner/opendata> | 20 A-League 2024/25 matches (the README still says 10). 10 fps broadcast tracking of all 22 players; `is_detected=false` marks extrapolated off-camera positions. Role acronyms (GK, LB, LCB, RCB, RB, LDM, RDM, AM, LW, RW, CF). `phases_of_play` (build_up/create/finish/..., high/medium/low block). `dynamic_events` (off-ball runs such as overlap, underlap, pulling_wide, dropping_off; pressing, counter_press; passing options). Tracking files are 86-102 MB per match, via Git LFS. | MIT ("Copyright (c) 2020 SkillCorner"; credit requested) | **Yes**, with the notice and credit | **v2 primary** real-match context and "what the pro did" overlay |
| **DFL / IDSSE Bundesliga** <https://doi.org/10.6084/m9.figshare.28196177> (paper: <https://www.nature.com/articles/s41597-025-04505-y>; loaders: <https://github.com/spoho-datascience/idsse-data>) | 7 matches from 2022/23, 25 Hz TRACAB optical tracking, positions and formations (e.g. "4-2-3-1"), 105 x 68. XML, 350-420 MB per match. | CC BY 4.0 | **Yes**, with attribution, a licence link and a change notice. No DFL or club logos. | **v2 secondary** |
| StatsBomb (Hudl) Open Data incl. 360 <https://github.com/hudl/open-data> | 426 matches with 360 freeze frames, showing visible players only (median 17 in the sample checked), anonymous except the actor and keepers | StatsBomb User Agreement: clause 1.2.1 forbids distribution, 1.2.2 forbids commercial use, 1.4 requires the logo | **No** | Private, offline calibration only; never in the repo or app |
| Metrica sample data <https://github.com/metrica-sports/sample-data> | 3 matches at 25 fps; roles only in game 3 | No LICENSE file (README: "be responsible", credit the source) | Informal only | Offline experiments only |
| PFF FC / Gradient Sports World Cup 2022 <https://www.gradientsports.com/blog/pff-fc-release-2022-world-cup-data> | 64 matches, all players tracked, roles labelled | **Terms not read** (behind a request form) | Unknown | Not until the terms are reviewed |
| Last Row (FoTD) <https://github.com/Friends-of-Tracking-Data-FoTD/Last-Row> | 19 Liverpool goals, hand-tracked; far-side players missing | Informal ("please credit") | Informal | Low value |
| Wyscout / Pappalardo events <https://figshare.com/collections/Soccer_match_event_dataset/4415000> | Events only; no other-player positions | CC BY 4.0 | Yes | Priors only; cannot seed freeze frames |
| SoccerTrack v2 <https://huggingface.co/datasets/atomscott/soccertrack-v2> | 10 amateur matches, full pitch | CC BY 4.0 | Yes | Low: amateur level, no tactical roles |
| SoccerNet SN-GSR <https://huggingface.co/datasets/SoccerNet/SN-GSR-2025> | Broadcast clips, partial | GPL-3 tag | Copyleft | No |
| Alfheim <https://datasets.simula.no/alfheim/> `[partly unverified]` | Home team only | No licence found | No | No |
| **HELIOS formation data** | 115 ball-to-11-role samples (RoboCup) | MIT at repo root (ambiguous; see 4.1) | Yes, with notice | **v1 seed for layer A** |
| Value grids (Karun xT, Laurie EPV, databallpy xT) | Ball-location value surfaces | none / MIT repo / MIT | Karun: ask first. Others: yes, with notice. | v2 value term |

Index of further datasets: <https://github.com/withqwerty/open-football>. Loader library: kloppy <https://github.com/PySport/kloppy> (BSD-3).

### 6.2 Key facts
- **No dataset contains an answer key.** Tracking shows where pros *were*, and pros are sometimes out of position. Real frames supply realistic surroundings and a "what the pro did" overlay. The score always comes from principle rules and coach-keyed zones.
- **Only SkillCorner and DFL have all three things a public scenario library needs:** all 22 positions, role labels, and a licence that clearly permits redistribution.
- **Privacy.** Player names and IDs in match files are personal data, and CC BY does not license publicity or trademark rights. Keep only role, team side and coordinates. Use neutral team colours and no club or league logos.

### 6.3 v1 decision
Ship **hand-authored scenarios only**, owned by us and released as CC0 or MIT in the repo. Base positions are seeded from the HELIOS table and edited by a coach. This avoids every data-licence risk, lets each scenario isolate one principle, and makes the answer explicit. Target: about 36 scenarios in v1, growing to 15-25 per principle over time, which is enough for Elo difficulty calibration (section 7).

### 6.4 v2 real-data pipeline (offline, Python stdlib or kloppy; never shipped raw)
1. **SkillCorner.** Join the tracking `player_id` to `player_role.acronym` from match.json, then drop names and IDs. Stream `tracking_extrapolated.jsonl` and keep frames that have a ball and a possession group. Join `phases_of_play` by frame range.
2. Pick moments at the `frame_start` of `player_possession`, `off_ball_run` and `on_ball_engagement` rows. Require the focal player to be detected and at least 16 players visible.
3. Re-orient using `home_team_side` so the focal team attacks +x.
4. Emit a snapshot plus an optional 3-5 s trajectory at 5 Hz, rounded to 0.1 m. That is about 1.8 KB per snapshot and about 45 KB per 5 s clip.
5. **DFL.** Map `PersonId` to `PlayingPosition`: TW=GK, IVL/IVR=CBs, LV/RV=FBs, DML/DMR=#6s, ZO=#10, LA/RA=wingers, STZ=#9. Keep frames with BallStatus = 1 and read possession from `BallPossession`. Sample at pass and shot times.
6. **Coordinate conversion into the app frame**, after orienting so the focal team attacks +x:
   - SkillCorner, DFL tracking and PFF use centre-origin metres with y up: `x = x_c + L/2`, `y = W/2 - y_c`, then rescale to 105 x 68.
   - StatsBomb is 120 x 80, top-left origin, y down: `x = x * 105/120`, `y = y * 68/80`.
   - Metrica is 0-1, top-left origin: `x = 105 x`, `y = 68 y`.
   - HELIOS: `x + 52.5`, `y + 34`.
7. **Repo hygiene.** Put raw data in a git-ignored `data_raw/`. Keep extraction scripts in `tools/`. Put derived JSON in `data/scenarios/{handmade,skillcorner,dfl}/`, each folder with its own `ATTRIBUTION.md`.

### 6.5 Attribution text to ship
- **HELIOS:** "Formation samples derived from HELIOS Base (https://github.com/helios-base/helios-base), MIT License, Copyright (c) 2021 HELIOS Base. Converted to app coordinates and edited."
- **delaunator:** the ISC notice, "Copyright (c) 2026, Mapbox".
- **pitchboard:** the MIT notice, "Copyright (c) 2026 Miguel Cardoso", in the ported file header.
- **SkillCorner:** the MIT notice, "Copyright (c) 2020 SkillCorner", plus "Tracking data courtesy of SkillCorner (https://skillcorner.com)".
- **DFL:** "Contains data from Deutsche Fußball Liga (DFL), licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); Bassek et al. (2025), Scientific Data, doi:10.1038/s41597-025-04505-y; subsampled, anonymized and re-oriented."
- **LaurieOnTracking:** the MIT notice (Friends-of-Tracking-Data-FoTD) plus "EPV grid and pitch-control method after Laurie Shaw and William Spearman (2018)".

---

## 7. Learning design principles (pedagogy)

### 7.1 Design rules and the evidence behind them
| # | Design rule | Evidence | How it shows up in the app |
|---|---|---|---|
| 1 | **Place, don't pick.** The core response is spatial. | Zhu et al. 2024 meta-analysis: transfer was larger with sport-like movement responses than with verbal or keyboard ones (g 0.87 vs 0.41). Hadlow 2018 framework: response correspondence matters. Travassos 2013 `[abstract only]`. | Drag your token to a spot. Multiple choice is used only as a beginner scaffold and in "why?" follow-ups. |
| 2 | **Freeze just before the decisive moment, then replay.** | Müller 2024 meta-analysis of temporal-occlusion training: d = 1.21, with field transfer d = 0.85. | Watch 3-6 s, freeze, place, then replay 2-3 s from your spot versus the ideal. |
| 3 | **Keep a fixed trial rhythm and record decision time.** | In the UCL / Premier League academy test (2 s orient, 5 s clip, 4 s decide), response time separated U16/U18/U23 groups, and accuracy correlated with coach ratings. TacticUP uses a countdown, marker, frame and occlusion. | Orient 2 s, watch 3-6 s, freeze, decide. No timer in Learn, 5 s in Test, 3-4 s in Mastery. Always log decision time. |
| 4 | **Grade against expert-keyed zones.** | TacticUP kept only items with ≥ 70% agreement among 9 experts (kappa 0.62-1.0). UCL kept clips where ≥ 2 of 3 UEFA-licensed coaches agreed. | Tolerance ellipses per scenario. Widen them where coaches disagree. The scenario metadata records who keyed it. |
| 5 | **Explain why, and show the consequence.** | Moreno 2004: explanatory feedback beat corrective feedback for transfer. Wisniewski, Zierer and Hattie 2020 (435 studies): high-information feedback d = 0.99, corrective 0.46, reinforcement only 0.24. | Show the ghost, the ellipse, the principle name, a 1-2 sentence reason from the failed rule, and a consequence replay. |
| 6 | **Guided discovery first, then the rule.** | Smeeton et al. 2005: guided discovery learned as fast as explicit instruction and held up under anxiety, where explicit instruction broke down. Silva et al. 2021 (youth): video plus questioning had the biggest effect on decision-making (tactical behaviour ES = 1.12 overall). | Beat 1 highlights the cue and asks a question. Beat 2 states the principle. |
| 7 | **Worked example, then faded steps, then solo, then pressure.** | Atkinson, Renkl and Merrill 2003 (backward fading plus self-explanation) `[not opened]`. The expertise-reversal effect: guidance that helps novices hinders experts. | Each principle runs: watch a narrated example, complete a pre-placed scene, place freely, then place against a timer. |
| 8 | **Teach a principle in a short block, then interleave look-alikes.** | Brunmair and Richter 2019 meta-analysis: interleaving g = 0.42, larger for visual material and for similar categories. Bjork: difficulty helps only once the basic concept exists. | Introduce with 8-12 blocked items, then mix commonly confused pairs: cover vs balance, press vs drop, tuck vs hold width, step up vs hold the line, show for the ball vs run in behind. |
| 9 | **Adapt difficulty with Elo, aiming for about 70-80% success.** | Pelánek 2016 (Elo in adaptive learning). Papoušek et al. 2016 (37k learners): at a 5% error rate, learning and long-term return were worst. Harder targets (20-50% error) did better. Math Garden used 0.75. | One skill rating per principle, per role, and overall. Each scenario has a difficulty d. Start near P = 0.85 to hook the learner, then settle at 0.70-0.75. |
| 10 | **Add time pressure later.** | Klinkenberg et al. 2011 via Pelánek, "high speed, high stakes" scoring. Lorains 2013: training at 1.5x playback gave faster, longer-lasting decision gains. | Countdown only after untimed accuracy reaches about 0.80. Mastery mode plays the lead-up at 1.25-1.5x speed. |
| 11 | **Spaced retrieval, not rewatching.** | Cepeda et al. 2008: the best gap between sessions is about 20% of the retention interval for weeks-long horizons, and about 5% for a year. Adesope et al. 2017: practice tests beat restudy (g about 0.5) `[abstract only]`. | Mastered scenarios come back at roughly 1 day, 3-4 days, 1-2 weeks, then monthly. v2 uses ts-fsrs. |
| 12 | **Ask how sure they are, and use confident errors.** | Butterfield and Metcalfe 2001: high-confidence errors are the most likely to be corrected (hypercorrection). Metcalfe and Finn 2012 found the same in grade 3-6 children. | An optional one-tap "sure / not sure". A confident error gets the fullest explanation, a misconception tag and a near-term re-test. |
| 13 | **Use "why?" items to diagnose misconceptions.** | Treagust 1988 two-tier diagnostic items `[not opened]`. Roca et al. 2011: novices monitor what is happening; experts predict, evaluate and plan. | Every 3rd-5th item, add a reason question whose wrong options are named misconceptions: ball-watching, marking the man and ignoring space, collapsing toward the ball, holding the line regardless of pressure, standing behind a defender. |
| 14 | **Train looking and predicting, not only the answer.** | Jordet et al. 2020 (9,574 Premier League possessions): mean 0.44 scans/s; more scanning went with better pass completion; central midfielders scanned most. Ward and Williams 2003: anticipation separated elite youth best `[abstract only]`. | v3: a fog-of-war mode where a shoulder-check reveals behind you, and "predict the next pass" items before placement. |
| 15 | **Stay soccer-specific and be honest about transfer.** | Kalén et al. 2021: sport-specific decision tests showed the largest expertise effect (g = 0.77); general cognitive tests are not supported for this use. Zhu 2024: lab gains are about twice field gains. van Maarseveen 2018: video test scores did not predict small-sided-game performance. | No generic brain games. Include a "take it to the pitch" challenge per module. Claim that the app trains *recognising situations and choosing positions*, nothing more. |
| 16 | **Gamify for mastery, not points.** | Sailer and Homner 2020: gamification g = 0.49 on learning outcomes; story and team elements help behaviour. Almeida et al. 2023: badges, leaderboards and points are the most-reported sources of harm. Hanus and Fox 2015: badges plus a leaderboard lowered motivation and exam scores `[abstract only]`. | Per-principle meters, a career-mode story, role unlocks, and weekly goals with streak freezes. No global leaderboards, no volume badges, no XP for taps. |
| 17 | **Dose.** | Zhu 2024: longer than 4 weeks beat 4 weeks or less (1.25 vs 0.38). Sessions under 20 minutes were less effective, and 10-25 minute sessions 2-4 times a week are recommended. | Suggest 10-15 minute sessions, 2-4 per week, for 4-6+ weeks. |

### 7.2 One rep, 20-30 seconds
1. **Brief card.** "You are the LEFT BACK (4-3-3). We just lost the ball on the right."
2. **Orient (2 s).** Ball, you and the phase are highlighted.
3. **Watch (3-6 s).** Play is animated from scenario keyframes.
4. **Freeze.**
5. **Decide.** Drag your token (the timer rules are in 7.1, row 3).
6. **Confidence.** An optional tap.
7. **"Why?" question.** About 1 item in 4.
8. **Feedback.** Grade; a cue question; then the ghost, ellipse and principle; then a consequence replay.
9. **"Try a similar one"** after an error. This is an isomorphic variant: the same scene mirrored, or opponents nudged 1-3 m.

### 7.3 Session and progression
- **Session mix (10-15 minutes, 25-35 items).**
  - About 60% current principle, aiming for P about 0.75.
  - About 25% interleaved look-alikes.
  - About 15% spaced reviews that are due.
  - Every 10th item is a non-adaptive **reference probe**: no scaffold, no timer, brief feedback. Probes measure learning (the Papoušek 2016 method).
- **Module order.**
  - Module 0: pitch literacy (thirds, lanes, goal-side, ball line, offside line).
  - Module 1: defending as a unit of three (press, cover, balance).
  - Module 2: supporting the ball (support, width and length, depth).
  - Module 3: team shape (concentration, compactness, line movement, offensive unity).
  - Module 4: transitions.
  - Then role paths (CB, FB, #6, #8/#10, winger, #9) re-run the same principles from each role's typical positions.
  - Capstone: **Live mode**, a 30-90 s continuous sequence at 0.75x, 1.0x and 1.25-1.5x speed.
- **Mastery gate for a principle.** All three must hold:
  - (a) the Elo-predicted success on a median-difficulty item is ≥ 0.80;
  - (b) the learner has at least 2 unscaffolded correct answers on different days, at least 24 h apart;
  - (c) no open high-confidence misconception tag remains.

### 7.4 Adaptive engine: Elo with partial credit (Pelánek 2016)
```
P      = 1 / (1 + exp(-(theta - d)))       // k-option MC: P = 1/k + (1 - 1/k) / (1 + exp(-(theta - d)))
s      = score / 100                       // partial credit
theta += K * (s - P);   d -= K * (s - P);   K = a / (1 + b * n), a = 1, b = 0.05
item choice: the eligible item whose predicted P is closest to the target (0.85 at first, then 0.70-0.75)
timed items (once the deadline is visible): S = (2*correct - 1) * (a*t_limit - a*t)
```
New scenarios start at d = 0 and calibrate themselves from learner data.

### 7.5 Measuring learning inside the app
- **Per-item log.** Placement error in metres, grade, rule pass/fail, decision time, confidence, misconception tag.
- **Learning curve.** Error on reference probes fitted to `error = a * x^-k`. The rate k per principle is the main outcome.
- **Retention.** Accuracy at the first spaced review compared with first-try accuracy.
- **Near transfer.** Mirrored or other-role variants the learner has never seen.
- **Calibration.** Brier score of confidence against correctness.
- **Hypercorrection rate.** The share of confident errors fixed at re-test.
- **Baseline and retest.** A 20-30 item TacticUP-style battery with no feedback and no adaptivity, at onboarding and every 4 weeks.
- Keep **practice accuracy** (scaffolded) separate from **learning** (unscaffolded, delayed).
- Never optimise short-term engagement on its own, because easy items maximise it while hurting learning.

### 7.6 Youth and privacy guardrails
- Short sessions, non-punitive wording, and no public comparisons.
- **COPPA.** The amended FTC COPPA Rule has been enforceable since **2026-04-22**. It adds separate consent for disclosures to third parties, a written security programme, and a data-retention policy (source: <https://www.davispolk.com/insights/client-update/ftc-prioritizes-coppa-enforcement-new-compliance-obligations-take-effect>). v1 therefore has no accounts, no third-party analytics, no ads, and keeps progress only in the browser.
- Coach share links and team boards wait for a legal review. GDPR-K and the UK Age Appropriate Design Code were not analysed.

---

## 8. Principles catalogue (the content backbone)

This catalogue merges and de-duplicates every principle supplied by the six research sweeps and the critic pass. It has 70 rows.

**How to read a row**
- **ID** is the stable identifier. Scenarios, rules and explanations refer to it.
- **Lvl** is the curriculum level: 1 is beginner (ODP / U.S. Soccer basics), 2 is intermediate, and 3 is advanced (positional play).
- **Rel** is the release in which the engine checks it automatically. Rows marked "v2" or "v3" can still appear in v1 as authored scenarios with a hand-keyed zone.
- Coordinates use the canonical frame: own goal line x = 0, opponent goal line x = 105, y = 0 at the attacking team's left touchline.
- Number tags: `[S]` = sourced, `[M]` = measured by our agents, `[D]` = tunable default.

**Source keys** (full URLs are in section 10)
- **Coaching curricula and manuals:** ODP = US Youth Soccer ODP Player Manual (P1-P10 = its principles). USC11 = U.S. Soccer Curriculum 2011. U17 = U.S. Soccer U17+ Learning Plan (paraphrase only). USS17 = U.S. Soccer small-sided standards and build-out line. EPYSA = EPYSA formations page. FA = England DNA.
- **Tactics writing:** SV-JdP / SV-HS / SV-GP / SV-GL = Spielverlagerung articles on juego de posicion, half-spaces and gegenpressing, and its glossary. CV = Coaches' Voice explainers. TT = Touchline Theory. MOTZ = Motzenbecker. OUT = Muller, The Outfield. TFA = The Football Analyst. SIQ = *Soccer iQ*.
- **Defending and goalkeeping how-to:** CBW = Coachbetter back four. TB = Trainerblog Viererkette. DFB = fussball.de. SCW = Soccer Coach Weekly. MYS = Minnesota Youth Soccer. KS-D / KS-X = Keeperstop on goalkeeper depth / crosses. CAS = Coaching American Soccer on walls. TCM = The Coaching Manual on corners.
- **FIFA Training Centre:** FIFA-HB = 6v6 high block. FIFA-GK = Dittmer on goalkeeping. FIFA-CZ = zonal vs man corners. FIFA-TB = train and blocker. FIFA-OUT = corner outlets.
- **Research papers:** FUTSAT = Teoldo da Costa et al. 2011. COSTA09 = Costa et al. 2009. DT23 = Dambroz and Teoldo 2023. AN08 = Akiyama and Noda. SPEAR = Spearman 2017/2018 and LaurieOnTracking. ANDR = Andrienko/Herold pressure. DASH25 = Dash et al. 2025. CW25 = Cascioli and Wang 2025. JORDET20 / WW03 / ROCA11 = Jordet 2020 / Ward and Williams 2003 / Roca 2011.
- **Rules:** IFAB = Laws of the Game 2026/27.
- **Code and data (heuristics and measurements):** HELIOS = helios-base data and our measurements of it. TBL / ARC = heuristics in tbleckert's simulator / arcade-soccer. FM26 = Football Manager Tactics Visualiser.

### 8.1 Foundations (all moments)
| ID | Principle | Who | Rule of thumb | Lvl | Rel | Sources |
|---|---|---|---|---|---|---|
| F1 | The ball decides your job (centre of play) | All | Rank players by distance or time to the ball. **Out of possession:** the nearest is the 1st defender (delay/press); the next goal-side teammate within about 15 m `[D]` is the 2nd (cover); the rest are 3rd defenders (balance, concentration, compactness). **In possession:** the carrier is the 1st attacker (penetration); teammates inside the centre-of-play radius are 2nd attackers (support); the rest are 3rd attackers (width, depth, unity). The radius is tunable, default 12 m `[D]`: the published 9.15 m and 5 m values come from 3v3 studies. | 1 | v1 | FUTSAT; DT23; COSTA09 |
| F2 | Shift with the ball as a unit | All outfield | Target = the role's base position interpolated from the ball position (Delaunay table), or the linear fit target = anchor + k(ball - centre). HELIOS slopes (k_x/k_y): back line about 0.5/0.3; #6 0.70/0.47; #8 0.80/0.40; wingers 0.72/0.25; #9 0.71/0.43 `[M]`. | 1 | v1 | AN08; HELIOS; FM26 |
| F3 | The team pushes up with the ball and drops without it | Whole team | The whole block shifts toward the opponent goal in possession and back out of it: start at Δx +6 m / -4 m `[D]`. | 1 | v1 | TBL; ARC |
| F4 | Offside (hard rule) | Attackers; back line | A player is in an offside position if in the opponent half (x > 52.5) and nearer the goal line than both the ball and the second-last opponent. Head, body and feet count; hands and arms don't. Level is onside. There is no offence directly from a goal kick, throw-in or corner. A runner offside at the moment of the pass is a critical fail. | 1 | v1 | IFAB Law 11 |
| F5 | A space is yours if you get there first | All | Arrival time tau = 0.7 s + distance / (5 m/s), after projecting current velocity forward 0.7 s. The ball travels at 15 m/s. Control shares are proportional to exp(-max(t_ball, tau) / 0.33). | 3 | v2 | SPEAR `[S]`; approximation `[M]` |
| F6 | Scan before you move | All, especially #6/#8 | At least 3 scans in the roughly 10 s before receiving or repositioning. Midfielders aim for at least 0.4 scans/s. Scan earlier when pressured, because scanning drops under close pressure. | 2 | v3 | JORDET20 |
| F7 | Predict the likely next pass | All | Identify the carrier's likeliest next action (open lanes, body shape, pressure) before choosing a spot. Position for the likeliest threat while covering the most dangerous one. | 2 | v3 | WW03; ROCA11 |
| F8 | Keep sensible spacing | All outfield | Nearest teammate 6-18 m away (HELIOS median 11.4 m, p10 6.2 m, p90 16.8 m) `[M]`. Never stand where one opponent can mark two of you. | 1 | v1 | HELIOS; USC11 |

### 8.2 In possession: build-up
| ID | Principle | Who | Rule of thumb | Lvl | Rel | Sources |
|---|---|---|---|---|---|---|
| B1 | Width: make the field big | Wingers, FBs | The widest player on each side is within 0-5 m of the touchline (y < 5 or y > 63) `[D]`. When the ball is on the other wing, the far winger stays wide rather than drifting into the half-space. | 1 | v1 | ODP P1; USC11 |
| B2 | Depth: pin their back line | #9 (and far winger) | The #9's x is within 0-2 m of the second-last defender and never beyond it `[D]`. This stretches the space between the opponent's lines. | 1 | v1 | ODP P1; U17 |
| B3 | Support: always 2+ passing options | Outfielders near the ball | The carrier has at least 2 teammates with a clear lane: no opponent within 1.5-2 m of the pass line `[D]`. Options sit at different heights and widths, at least 30 degrees apart `[D]`. Never stand directly behind a defender on the ball-to-you line. From v2, a lane counts as open if P_lane > 0.6. | 1 | v1 | USC11 (triangle principle); SV-JdP; U17; SPEAR |
| B4 | Support distance depends on pressure | All outfield | Carrier unpressured and facing forward: stay away (12-25 m), holding width or height or running in behind. Carrier pressed (opponent within about 3 m, or facing their own goal): players ahead come short to 5-10 m. `[D]` | 2 | v1 | U17 |
| B5 | Lanes and lines | All outfield | Lane edges at y = 0 / 13.84 / 24.84 / 43.16 / 54.16 / 68. At most 2 teammates per vertical lane and at most 3 on one horizontal line `[S]`, taking a band of ±2.5 m `[D]` as "the same line". If your lane or line is full, move to the next one. | 3 | v1 | SV-JdP; TT |
| B6 | Fullback and winger share the flank | FB, winger | Never both in the wing lane within about 10 m of each other `[D]`. If the winger hugs the touchline, the FB goes inside (half-space, or beside the #6). If the FB overlaps, the winger moves into the half-space. | 2 | v1 | SV-JdP; SV-GL (inverted full-back) |
| B7 | Peel off and open your body | Players ahead of the ball | Move away from your marker so they are not between you and the ball. Keep your body at least 45 degrees open toward the opponent goal `[D]`. Avoid receiving with your back to goal when a marker is within 2 m `[D]`. | 2 | v3 (needs body orientation) | ODP P2 |
| B8 | Circulate and switch | CBs, #6, FBs, far-side players | After 2-3 short passes in one zone, the next pass should leave it. A back pass is usually followed by a switch, so far-side players are already wide and open. Prefer a diagonal pass to a vertical pass into a tightly marked player. | 2 | v2 | ODP P5-P7; U17 |
| B9 | Salida lavolpiana against a front two | #6, CBs, FBs | If the opponent presses with 2 forwards, the #6 drops between the CBs, the CBs split to about y 14 and 54, and the FBs push high and wide. Against 1 forward, the #6 stays in front of the CBs. | 3 | v2 | OUT |
| B10 | Goal-kick shape | GK, CBs, #6, FBs | The ball is in play once kicked and moving, and teammates may receive inside the box. CBs at the box corners (x ≈ 5-16, y ≈ 14 and 54); #6 central at x ≈ 18-25; FBs wide (y < 5 or y > 63) at x ≈ 15-35 `[D]`. Opponents must stay outside the box until the kick. | 2 | v2 | IFAB Law 16; ODP P8 |
| B11 | The keeper supports the build-up | GK, CBs | If the ball-side CB is within about 10 m of the GK, the GK moves to the far half of the box to create passing distance. If the CB is far away, the GK comes toward the ball side. The CB-to-GK pass line stays at least 1.5 m from the presser `[D]`. | 2 | v2 | FIFA-GK |
| B12 | Offensive unity: the back line follows the attack | CBs, FBs, #6 | As the ball advances, the last line advances too, so its distance to the ball shouldn't grow. Keep the back line 35-45 m from the front line in possession `[D]`. | 2 | v1 | FUTSAT |

### 8.3 In possession: progression and final third
| ID | Principle | Who | Rule of thumb | Lvl | Rel | Sources |
|---|---|---|---|---|---|---|
| P1 | Occupy the half-space | #8, #10, inverted winger or FB | With the ball in the middle or final third, one teammate stands in the ball-side half-space (y 13.84-24.84 or 43.16-54.16), level with or between the opponent's midfield and defensive lines. That puts their CB/FB in a "step out or stay" dilemma. | 3 | v1 | SV-HS; CV |
| P2 | Receive between the lines, outside cover shadows | #8, #10, #9 dropping, inverted wingers | x between the opponent midfield line and defensive line. At least 3 m from the nearest opponent `[D]`, with no opponent within 1.5 m `[D]` of the ball-to-you line. If you are in a presser's shadow, shuffle 2-4 m sideways out of it. | 2 | v1 | U17; MOTZ; SV-GL |
| P3 | The #10 lives in zone 14 or a half-space | #10 | Behind the opponent midfield line and ahead of their back line, either in zone 14 (x ≈ 75-88, centre lane) or a half-space. Receive half-turned. If the #9 checks short, run beyond. | 2 | v2 | SV-GL; CV; ODP P4 |
| P4 | The #8 arrives late | #8 | In possession, occupy the ball-side half-space between the lines. When the ball goes wide in the final third, run from deep into the box or into the cut-back zone at the edge of the box, arriving after the #9. | 2 | v2 | CV; SV-GL; U17 |
| P5 | Runs in behind: when and how | #9, wingers, #8s | Run only when the carrier faces forward and is unpressured, or is pressed but can still play forward. Stay onside at the pass (F4). Wide runs bend outward; central runs start flat along the line, then bend in behind. | 2 | v2 | U17; ODP P3 |
| P6 | Runs trigger runs | #9 and #10; winger and FB | When a teammate checks toward the ball out of a zone, the nearest teammate fills the space they left within 1-2 s. No two runners should target spots within 5 m of each other `[D]`. | 2 | v2 | ODP P4; USC11 |
| P7 | Third-man combination | #8, #10, #9, wingers | If the pass from A to C is blocked, B offers to receive from A and lay it off to C. C starts on the blind side of the defender watching B (behind them, more than 3 m away `[D]`) and times the run for B's first touch. | 3 | v3 | CV; U17 |
| P8 | Create a local superiority | All | Inside the centre of play: at least one more attacker than defenders (numerical); at least one receiver facing forward between the lines (positional); your best dribbler isolated 1v1 (qualitative); arriving in space before the defender (dynamic). | 3 | v2 | MOTZ; USC11 |
| P9 | Zone 14 is prime real estate | #10, #8, #9 dropping | Reward getting a player into x ≈ 75-88, y 24.84-43.16, and moving the ball from there into the box quickly (under about 8 s). | 2 | v2 | SV-GL |
| P10 | Fill the box on crosses | #9, far winger, #8/#10 | With the ball in a wing lane at x > 88, attackers fill at least 3 of 4 zones: near post (near side of the six-yard box), back post (far side of the six-yard box), penalty spot (x ≈ 94, y ≈ 34), and edge of the box (x ≈ 86-89) for cut-backs. No two runners in the same zone, i.e. within about 3 m `[D]`. | 1 | v1 | U17 |
| P11 | Occupy valuable space, not just free space | Wingers, #9, #10, #8 | Value(p) = Gauss(distance to ball, sigma ≈ 14 m) x attacking control(p) x EPV(p). Choose the spot with the highest value that you can reach in about 2 s, roughly 6.5 m. | 3 | v2 | SPEAR (OBSO); C-OBSO; Fernandez and Bornn 2018 |
| P12 | Commit numbers forward | All outfield | In settled possession in the attacking half, at least 5 outfield players are ahead of the ball. Fewer than 4 ahead is flagged as a sterile attack. | 2 | v2 | U17 (attacking game idea; checked in the PDF text) |
| P13 | Rest defence: stay balanced while attacking | CBs, #6, FBs or inverted FB | About 5 players at or behind the ball, in a 3+2 or 2+3. Rest defenders ≥ the opponent's forwards + 1. The upper pair blocks central lanes near the ball; the lower line handles long balls. | 2 | v2 | CV (rest defence, 2024); U17 (lock down the outlets) |

### 8.4 Transitions
| ID | Principle | Who | Rule of thumb | Lvl | Rel | Sources |
|---|---|---|---|---|---|---|
| T1 | Counter-press after losing the ball | The 2-4 players nearest the ball | The nearest player, within about 10 m `[D]`, presses immediately. The next nearest block the short passes and mark the outlets. This works best in the first 2-3 s; stop at about 5 s. If the press is bypassed or the ball isn't won back, retreat into a compact block. | 2 | v2 (Live) | SV-GP (5 s); CV high press (2-3 s); U17 |
| T2 | Delay the counter: drop and narrow | CBs, #6, FBs | If you can't pressure the ball, or you're outnumbered, retreat toward goal and narrow toward the centre lane. Keep more defenders than attackers between the ball and goal. The defender facing the carrier backs off, keeping 3-5 m `[D]`, to slow them and show them wide. | 2 | v1 | U17; FA |
| T3 | Recovery run: get goal-side | Anyone caught ahead of the ball | Sprint on a line toward your own near post or goal centre, not toward the ball, until you are goal-side of both the ball and your opponent. Then rejoin the line or press the carrier from behind. | 1 | v1 | U17; USC11 |
| T4 | Prepare the counter before you win the ball | #8, #10, wingers, #9 | When a teammate is about to win the ball, players not involved stop defending. They take diagonal positions between the opponent's lines or start runs in behind. The first pass after the regain goes forward if a runner is free. | 2 | v2 | U17; USC11 |

### 8.5 Out of possession: pressure, cover, balance
| ID | Principle | Who | Rule of thumb | Lvl | Rel | Sources |
|---|---|---|---|---|---|---|
| D1 | First defender: pressure the ball | Player nearest the ball | Close down fast, then slow with short steps. Stop 1.5-3 m away `[D]`, goal-side, on or near the line from the ball to the centre of your goal (within 20 degrees when central `[D]`). Stand side-on. | 1 | v1 | MYS; USC11; COSTA09 |
| D2 | Dictate direction: show them outside | First defender, the whole press | Curve your approach so the central lane is shut and the open side faces the nearest touchline (or the carrier's weaker foot). When the ball is in a wing lane, stand on the inside of the ball-to-goal line. The touchline works as an extra defender. | 1 | v1 | SIQ; CV high press; U17; COSTA09 |
| D3 | Second defender: cover at an angle | Teammate nearest the presser | Goal-side of the presser on a diagonal, 3-6 m behind and 2-4 m inside `[D]`. Closer (3-5 m) when play is central and near goal; further (6-10 m) when it is wide and far `[D]`. Never level with the presser and never directly behind. Sit a little further inside when the ball is near the touchline. On a square pass, the two defenders swap roles. | 1 | v1 | SCW; MYS; USC11; COSTA09 |
| D4 | Balance: the weak side tucks in | Far-side FB, CB, #8, winger | Players more than about 25 m sideways from the ball `[D]` move toward the centre, and the team's average y shifts toward the ball. In the centre of play, defenders goal-side of the ball at least match the attackers. A far-side attacker can be left free while the carrier is under pressure. | 1 | v1 | USC11; U17; COSTA09 |
| D5 | Goal-side and ball-side marking | Markers, defenders | Stand on the line from your opponent to the centre of your goal, 1-3 m from them (tighter nearer goal) and shifted 1-2 m toward the ball `[D]`. Your x must be smaller than your opponent's. Keep your body open so you can see both the ball and your opponent. | 1 | v1 | U17; USC11; ANDR |
| D6 | Cut off the return pass | Any defender just bypassed by a pass | First recover into the lane between the passer and the receiver's return option; then chase the ball. | 2 | v2 | SIQ (via a summary) |
| D7 | Zonal defending: hand over, take over | All | Reference order: ball, then space, then teammates, then opponent. When an attacker leaves your zone, pass them on to the teammate whose zone they enter rather than following. Man-mark only the most dangerous runner near your box, or when a zone-mate has been beaten. | 2 | v2 | SV-GL; U17 |
| D8 | Pressing triggers | The whole unit | Jump to press on a trigger: a back pass, a heavy touch, a receiver facing their own goal, a pass to a FB near the touchline, the GK on the ball, a slow or looped pass, or a square pass across the back line. On the jump, the nearest player engages, the next blocks the nearest option, and the rest squeeze up. Without a trigger, hold your shape. Only jump if someone can cover behind you. | 2 | v2 | TFA; CV mid block and high press; U17 |
| D9 | Cover shadow and curved pressing runs | #9, #10, wingers, pressing #8s | While pressing, stay within 1.5 m `[D]` of the line from the carrier to the most dangerous receiver behind you, somewhere between 15% and 90% of the way along it. Curve your run so your shadow cuts the inside pass. Example: the #9 presses a CB from the inside to cut the pass to the other CB or the #6. | 3 | v2 | SV-GL; TT; CV high press; CW25 |

### 8.6 Out of possession: unit and team shape
| ID | Principle | Who | Rule of thumb | Lvl | Rel | Sources |
|---|---|---|---|---|---|---|
| U1 | Compactness: stay short and narrow | Whole team | Outfield length (deepest to highest) ≤ 35 m, about 25 m in a pressing block. The 25 m is Sacchi's figure, seen only in a search snippet; the HELIOS median is 31 m `[M]`. Gap between the defence and midfield lines about 12-15 m (40-50 ft) `[S]`. Block width ≤ about 50 m `[M]`. Don't open a gap of more than 15 m to your own line. | 1 | v1 | CBW; CV Sacchi `[unverified page]`; HELIOS; DASH25; FUTSAT (defensive unity) |
| U2 | Shift and slide, no crossover | Back line, midfield line | Adjacent teammates keep roughly equal gaps: about 8-12 m near the ball and wider on the far side. Treat this as a tolerance band, not a target `[D]`. When shifting, never cross your nearest teammate; hand the runner over instead. No gap should be wide enough for a through ball. | 2 | v1 | U17; TB; DFB |
| U3 | Line height: step, hold or drop | Back line, GK | Step up about 5 m `[D]` when the ball goes backward, or when the carrier is pressed and facing away. Hold when the ball is under pressure. Drop 5-10 m `[D]` when the carrier is unpressured and facing forward. | 2 | v1 | U17; CBW |
| U4 | A level line, set by the CB nearest the ball | CBs, FBs | The other defenders stay within ±1-2 m of that CB's x `[D]`, except for a deliberate covering drop. A deep far-side defender who keeps an attacker onside is a critical fail. | 1 | v1 | U17; DASH25 |
| U5 | Back-four shape with the ball wide | FBs, CBs | The near FB engages the winger. The near CB covers diagonally. The far CB narrows toward the near CB. The far FB tucks in to within 10-15 m of the far CB `[D]`. Either a crescent (far FB deepest) or an L (far CB deepest) is acceptable. No gap of more than 12 m between adjacent defenders near the ball `[D]`. | 2 | v1 | CBW; TB |
| U6 | Block height: high, mid, low | Whole team, GK | **High:** CBs near halfway (x ≈ 45-52) `[S FIFA-HB]`, strikers on the opponent's CBs and GK. **Mid:** first line near halfway, back line at x ≈ 25-35; block central passes and let them play wide. **Low:** back line near the edge of the box (x ≈ 16-22), two narrow, compact banks. All values `[D]` except the high-block figure. | 2 | v1 | FIFA-HB; CV mid and low block; SV-GL |
| U7 | Concentration: protect the scoring area | CBs, FBs, #6, weak-side winger | When the ball is in your defensive third, off-ball defenders shift toward the centre, between the ball and goal. The weak-side FB tucks in to about the width of the box, at or inside the far-post line. Never leave the lane from the ball to the penalty spot open while guarding empty space out wide. | 1 | v1 | FUTSAT; COSTA09 |
| U8 | Defend crosses | CBs, far FB, #6/#8, GK | Someone pressures the crosser. The CBs stay central, between the posts (y 30.34-37.66) and inside the box. The weak-side FB joins the line near the far post, goal-side of the runner. A midfielder covers the penalty spot or edge of the box for cut-backs. Protect the width of the goal first. | 1 | v1 | U17 |

### 8.7 Role cards (role-specific rules not covered above)
| ID | Principle | Who | Rule of thumb | Lvl | Rel | Sources |
|---|---|---|---|---|---|---|
| R1 | The centre-back pair | CBs | **In possession:** split to about the width of the box when the #6 drops or at goal kicks, and carry the ball into space when not pressed. **Out of possession:** the CB nearest the ball sets the line (U4); the partner covers 3-6 m behind and inside `[D]`; stay within about 12 m of each other `[D]`; stay central on crosses. | 1 | v1 | U17; OUT; ODP P8 |
| R2 | The fullback out of possession | FBs | **Ball on your side:** engage the winger goal-side and force them outside, with the CB covering. **Ball on the far side:** tuck in to within 10-15 m of your CB `[D]` and stay level with the line. Recovery runs go toward the near post first. | 1 | v1 | CBW; U17 |
| R3 | The #6 screens the centre-backs | #6 | Out of possession, stay in the centre lane, 5-10 m ahead of the CBs (HELIOS median 7.3 m `[M]`; another source allows up to 15 m `[D]`). Sit on or near the line from the ball to the most dangerous central attacker. Don't get pulled wider than the half-space unless you are covering. | 1 | v1 | U17 (fronting); SV-GL; HELIOS |
| R4 | Winger duties | Wingers | **In possession:** high and wide, within about 5 m of the touchline `[D]`, especially the far-side winger. Only move inside if the FB holds the width (B6). **Out of possession:** get goal-side of the opposing FB quickly. In a high press, curve inside-out to shadow the CB-to-FB pass. | 1 | v1 | ODP P1/P3; SV-GL; SIQ (via a summary) |
| R5 | Striker duties | #9 | **In possession:** on the last defender's shoulder, onside (B2). Check short only to open space for a runner. **Pressing:** the first line of pressure; curve so your shadow cuts the CB-to-CB or CB-to-#6 pass (D9). **On crosses:** attack the near post or the penalty-spot zone (P10). | 1 | v1 | ODP P1; U17; CV high press; FIFA-HB |

### 8.8 Goalkeeper
| ID | Principle | Who | Rule of thumb | Lvl | Rel | Sources |
|---|---|---|---|---|---|---|
| G1 | Angle and depth | GK | Stand on the line that bisects the angle between the ball and the two posts. Depth off the line, interpolated by ball distance: ball 27-32 m from goal gives 3-5 m; ball at halfway (about 52 m) gives about 11 m; ball in the opponent's box puts you at or beyond the top of your own box (about 16.5 m). More than 1 m off the bisector when a shot is possible is a fail `[D]`. | 1 | v1.1 | KS-D (depths `[S]`); bisector convention (secondary source) |
| G2 | The 3-metre rule | GK | **Carrier within 3 m:** go low, wide and square to block or smother, showing them away from goal. **Beyond 3 m:** stay tall and set, narrow the angle along the bisector, and don't charge. Moving more than 2 m `[D]` toward a carrier who is more than 3 m away and in control counts as rushing. | 2 | v2 | FIFA-GK |
| G3 | Starting position for crosses | GK | With the ball in a wing lane in your third, your sideways position runs from one step in front of the near post (ball near the byline beside the box) to the middle or back third of the goal (ball 30 m or more from the goal line). Depth: 0.5-1.5 m off the line for close or in-swinging deliveries; 2-5 m for deep or out-swinging deliveries, or when the crosser is on the end line `[D]`. | 2 | v2 | KS-X |
| G4 | Sweeper-keeper: stay connected to the line | GK | With a high line, keep 15-25 m `[D]` behind the last defender and move up and back with the line. This conflicts with G1's depth figure when the block is high, so choose the rule by block height (Appendix A). | 2 | v2 | U17; SV-GL |

### 8.9 Set pieces and restarts
| ID | Principle | Who | Rule of thumb | Lvl | Rel | Sources |
|---|---|---|---|---|---|---|
| S1 | Defending free kicks: the wall | Wall players, GK | **Wall size:** 5 when central within about 7 yd of the edge of the box; 4 at 20-25 yd, just off centre; 3 at 25-30 yd, wider; 2 when wide. **Anchor:** on the line from the ball to the near post, 9.15 m from the ball, with the wall extending toward the goal centre. **GK:** covers the far half, starting between the goal centre and the far post, about 1 m off the line `[D]`. Attackers must stay at least 1 m from a wall of 3 or more. | 2 | v2 | CAS; IFAB Law 13 |
| S2 | Defending corners: zonal | All 10 outfielders, GK | Own goal at x = 0, corner taken from the y = 0 side. The GK commands the six-yard box, and one player stands about 1 m inside the near post. Zones: front-post space (x ≈ 3-5, y ≈ 27-31); three six-yard-line zones (x ≈ 5.5, y ≈ 30 / 34 / 38); back-post space (x ≈ 3-5, y ≈ 40-42); a zone on the line from the near post to the penalty spot; the penalty spot itself (x ≈ 11, y ≈ 34); and the edge of the box (x ≈ 16.5-18) for second balls. An outlet is optional. All coordinates `[D]`. | 2 | v2 | TCM; FIFA-CZ |
| S3 | Defending corners: man-to-man and mixed | Markers, zonal players | A marker stands goal-side, on the attacker's line to the goal centre, within about 1 m, with an open body. **Mixed system:** 3-4 zonal players on the six-yard line; the best headers mark the 3-4 most dangerous attackers; one player protects the keeper; 1-2 hold the edge of the box. No system proved statistically better at World Cup 2022, so score against the system the scenario declares. | 3 | v2 | TCM; FIFA-CZ |
| S4 | Attacking corners: fill the zones, keep rest defence | CBs, #9, #8s, wingers, FBs | At least 3 attackers arrive in distinct zones: near post, central six-yard box, back post, penalty spot, and the edge of the box for cut-backs. No two within about 3 m of each other `[D]`. A "train" of 4-6 players around the spot with one blocker is an option. Offer a short option to the taker. Keep rest defenders ≥ the opponent's outlets + 1; outlets usually wait on the edge of the box or near post. | 2 | v2 | FIFA-TB; FIFA-OUT; U17 |
| S5 | Throw-ins | FB/winger on the throw side, #8, #9 | **In possession:** at least 3 options: short to feet 5-10 m away, out of the nearest marker's reach; down the line; and back or inside to a player facing forward who can switch play. There is no offside from a throw-in, so runners may start beyond the last defender. **Out of possession:** stay at least 2 m from the thrower; stand goal-side of the nearest receivers; one player blocks the line; track runners, because the offside trap doesn't apply. | 1 | v2 | IFAB Law 15; ODP |
| S6 | Penalty rebounds | All outfielders | Everyone except the kicker and GK stays on the field, outside the box, behind the penalty spot and at least 9.15 m from it (outside the arc). Target spots are on the box line either side of the arc (x ≈ 16.5, y ≈ 26-29 and 39-42 `[D]`). Defenders take the inside positions, goal-side of the attackers. | 1 | v2 | IFAB Law 14 |
| S7 | Youth 7v7 build-out line | All players (U9-U10, 7v7) | When the opposing GK holds the ball, or at their goal kick, retreat behind the build-out line until the ball is in play. The GK may not punt. Offside applies only between the build-out line and the goal line. Formations: 1-2-3-1 or 1-3-2-1 for 7v7; 1-3-2-3 or 1-3-3-2 for 9v9. Sources place the line differently, so make it configurable. | 1 | v3 | USS17; EPYSA |

---

## 9. Recommended MVP spec and roadmap

### 9.1 Product in one sentence
A free, installable-later web app. You are assigned a role in an 11-a-side team, you watch play unfold, and when it freezes you drag yourself to where you should be. The app shows the ideal zone, grades you, tells you the one principle you missed, and lets you practise that principle until it sticks. You can also play "live", adjusting continuously as the ball moves.

**v1 assumptions** (see the open questions in 9.7):
- The learner is a teenager or adult. Wording is Kid or Standard, switchable.
- 11v11, with our team in a 4-3-3 (HELIOS shape) and opponents mirrored from the same table.
- Zonal back four, mid block, labelled on every scenario.
- Six outfield roles: CB, FB, #6, #8, winger, #9. Left and right versions come from mirroring. The GK arrives in v1.1.

### 9.2 v1 (MVP) feature list
1. **Zero-build app shell.**
   - `index.html` plus ES modules and CSS tokens, with light and dark themes.
   - Runs locally via `python3 -m http.server`; deploys to GitHub Pages.
   - No network calls except same-origin assets.
2. **IFAB pitch renderer.**
   - SVG with a 105 x 68 m viewBox; horizontal, switching to vertical on narrow portrait screens.
   - Optional overlays for thirds, lanes and zone 14.
   - Pitch constants hand-ported from pitchboard (MIT).
3. **Formation engine.**
   - Load HELIOS `normal-formation.conf`, converted to the app frame and coach-edited.
   - Triangulate with delaunator (ISC), then interpolate barycentrically.
   - Mirror it for the opponents and apply the possession offset. A linear-slope fallback is included.
4. **Context builder, v1 rule library and scoring.**
   - The 17 rules in section 5.5.
   - Zone score plus rules score, capped on critical fails, graded S-F.
   - A ghost (ideal spot) and a canvas heatmap.
5. **Explanation engine.**
   - Standard and Kid templates for every rule and failure mode.
   - The fix vector in football language.
   - A two-beat reveal: first a cue and a question, then the principle, ghost and ellipse.
   - A "learn more" link per principle ID to a free source.
6. **Explore mode (sandbox).**
   - Pick a role, drag the ball and toggle possession; all 22 players move.
   - Your role's ideal spot, heatmap and live "why" tags update continuously.
   - Drag yourself to see a live score and a hot/cold ring.
   - This is the purest "the right spot changes as the ball moves" lesson.
7. **Drill mode (freeze-frame).**
   - Orient for 2 s, then 3-6 s of animated play, then freeze.
   - Drag, with an optional confidence tap, then the reveal.
   - The authored continuation plays with both your token and the ghost visible.
   - Offers "try a similar one", a mirrored or nudged variant.
8. **Live mode (basic).**
   - A 30-60 s ball-scripted sequence plays continuously while you keep adjusting.
   - The score is time-averaged at 10 Hz, with a 0.7 s reaction grace after each ball event.
   - The end screen shows the grade, a score-over-time line, and your 3 worst moments to replay.
9. **Content.** About 36 hand-authored, ball-scripted scenarios:
   - Module 0: a 5-step interactive tutorial on thirds, lanes, goal-side and the offside line.
   - Module 1: pressure, cover and balance (D1-D5, T2-T3, U8), 12 scenarios.
   - Module 2: support, width and depth (B1-B6, P1-P2, P10), 12 scenarios.
   - Module 3: team shape (U1-U7, R1-R3), 12 scenarios.
10. **Progress.**
    - Elo skill (theta) per principle and per role, and an Elo difficulty per scenario.
    - Mastery stars and a session history.
    - Stored in `localStorage` wrapped in try/catch, plus export and import of progress as a JSON file.
    - No accounts.
11. **Authoring mode** (hidden route `#author`).
    - Drag the ball and players, set the learner's role and the tags, and record keyframes and the ball path.
    - The engine auto-computes the answer, which the author can override.
    - IFAB validity checks run, and a "key disagreement" is flagged when the ghost and the authored ideal are more than 5 m apart.
    - Exports scenario JSON.
    - Includes a formation-sample editor for fixing HELIOS samples with a coach.
12. **Accessibility.**
    - Large tokens, with a finger-offset drag handle so your finger doesn't hide the token.
    - Keyboard nudging: arrows move 0.5 m, Shift+arrows move 2 m.
    - Drag-or-two-tap input.
    - A colour-blind-safe heatmap, reduced-motion support, and Kid/Standard wording.
13. **Credits page** (mirrors `THIRD_PARTY.md`) with every notice from section 6.5.
14. **In-browser test page** (`tests.html`) covering the engine modules. The engine is pure functions with no DOM access, so it can later run under Node/Vitest.

### 9.3 Architecture and file layout
```
fotbol/
  index.html                 app shell; tests.html runs engine unit tests in the browser
  css/app.css                design tokens (light/dark), layout
  js/main.js                 hash router: #explore | #drill | #live | #progress | #author
  js/engine/                 PURE (no DOM)
    geometry.js              vectors, point-segment distance, barycentric, band()
    pitch.js                 IFAB constants, lanes, zones, frame transforms (MIT header from pitchboard)
    formation.js             HELIOS load/convert, Delaunator triangulation, interpolate, mirror, possession offset
    context.js               possession, pressure, carrier facing, lines, duties, block height
    rules/<rule-id>.js       one module per rule in 5.5 (applies, eval, templates)
    score.js                 zone score, combine, critical caps, grade
    ghost.js                 1 m candidate grid, argmax, heatmap field
    explain.js               Standard/Kid templates, fix-vector phrasing, ranking
    timeline.js              keyframe interpolation, ball path, auto-positioned players, overrides
    elo.js                   Pelanek Elo with partial credit
  js/ui/                     board.js (SVG + pointer/keyboard drag), heatmap.js (canvas),
                             reveal.js, modes/{explore,drill,live,author}.js
  js/store.js                localStorage wrapper (try/catch), export/import
  data/formations/helios-433.json    converted + coach-edited, with attribution header
  data/scenarios/handmade/*.json     CC0 or MIT
  data/principles.json       section-8 rows: id, name, level, rule ids, templates, learn-more URL
  vendor/delaunator.min.js   ISC (plus LICENSE)
  THIRD_PARTY.md  LICENSE  README.md
```

### 9.4 Scenario format ("ball-scripted": author the ball, the engine positions everyone else)
```json
{
  "id": "d3-cover-lcb-001",
  "title": "Cover your centre-back partner",
  "format": "11v11",
  "system": { "us": "4-3-3", "them": "4-3-3 (mirrored)", "assumption": "zonal back four, mid block" },
  "moment": "out_of_possession",
  "phase": "mid_block",
  "principles": ["D3", "U4"],
  "learner": { "role": "LCB" },
  "timeline": {
    "duration": 6.0,
    "freezeAt": 4.2,
    "ball": [ { "t": 0, "x": 60, "y": 40 }, { "t": 2.0, "x": 48, "y": 44, "event": "pass" },
              { "t": 4.2, "x": 38, "y": 40, "event": "carry" } ],
    "possession": [ { "t": 0, "team": "them" } ],
    "carrier": [ { "t": 2.0, "id": "them-9" } ],
    "players": { "auto": true,
                 "overrides": [ { "id": "them-9", "keys": [ { "t": 0, "x": 45, "y": 36 }, { "t": 4.2, "x": 39, "y": 40 } ] } ] },
    "tags": { "carrierFacing": "forward", "pressureOnBall": true }
  },
  "answer": { "mode": "engine", "override": { "x": 33, "y": 35, "tx": 2.5, "ty": 3 } },
  "misconceptions": [ { "id": "ball-watching", "region": { "type": "circle", "x": 38, "y": 40, "r": 3 } } ],
  "difficulty": 0,
  "source": { "kind": "handmade", "license": "CC0-1.0", "keyedBy": [], "agreement": null }
}
```
- Coordinates are in the canonical frame. With `players.auto`, every player without an override moves to their layer-A target as the ball moves.
- `answer.mode` is either `"engine"` (ghost), optionally with an authored override, or `"authored"` (ideal point plus tolerance ellipse or polygon).
- **Engine API:**
  - `targets(team, ball, possession) -> {role: {x, y}}`
  - `context(frame, learnerRole) -> ctx`
  - `evaluate(ctx, spot) -> {score, grade, sZone, rules[], critical, fix, reasons[]}`
  - `ghost(ctx) -> {spot, field}`

### 9.5 v1 acceptance criteria
- **Formation invariants:** the LB target has y < 34 for every ball position; the #9's x rises monotonically with ball x.
- **Mirror symmetry:** a mirrored scenario produces a ghost mirrored to within 0.5 m.
- **Scoring:**
  - The ghost scores ≥ 90.
  - A spot 20 m from the ghost scores ≤ 40.
  - Any critical fail scores ≤ 59.
  - Every failing rule yields a sentence in both wordings.
- **Performance:** 23 animated tokens run at 60 fps on a mid-range phone; a heatmap recompute takes under 30 ms.
- **Layout and input:** usable at 375 px wide with no horizontal scroll; dragging works by touch, mouse and keyboard.
- **Privacy:** zero third-party requests.
- **Content keying:**
  - Every v1 scenario is keyed by at least 1 coach.
  - A scenario is labelled "certified" only when at least 2 of 3 coaches agree (the TacticUP/UCL method).
  - Scenarios whose engine ghost disagrees with the coaches are fixed or flagged.

### 9.6 Roadmap
**v2 (depth, realism, retention)**
- **Value layer (section 5.8):**
  - time-to-intercept lane checks (P_lane);
  - soft pitch control;
  - an EPV value surface (Laurie's grid, attributed);
  - OBSO-lite for attackers;
  - Andrienko pressure;
  - the cover-shadow rule (D9).
  - Rebalance the score to 0.45 zone / 0.35 rules / 0.20 value.
- **Authored in-possession and out-of-possession formation tables,** plus an opponent 4-4-2 table.
- **Goalkeeper role and set pieces:** G1-G4, B10-B11, S1-S6.
- **Transition scenarios with a timer:** T1, T4.
- **Adaptivity and retention:**
  - interleaving scheduler;
  - spaced review with ts-fsrs;
  - "why?" two-tier items with misconception tags;
  - hypercorrection handling;
  - reference probes and a learning-curve dashboard;
  - baseline and retest battery.
- **Real-match scenes:** SkillCorner (MIT) via the offline pipeline in 6.4, with a "what the pro did" overlay (never used as the answer).
- **Branching consequence replay:** simulate the next 2 s from *your* spot versus the ghost.
- **App packaging:** installable PWA with offline support; Spanish localisation.

**v3 (breadth and social)**
- **Youth formats:** 7v7 and 9v9 pitches, formation tables and the build-out line (S7). Needs small-sided anchor data, e.g. mplsoccer templates plus coach authoring.
- **Scanning and prediction:** a fog-of-war scanning mode (F6) and "predict the next pass" items (F7).
- **Body orientation input** (B7).
- **Coach mode:**
  - author and share a scenario by link;
  - a private squad board.
  - This needs a backend and a COPPA / GDPR-K legal review first.
- **DFL CC BY data; more systems** (3-5-2, 4-2-3-1).
- **A generated live-match mode:** evaluate tbleckert/football-simulator (MIT) as a snapshot generator; needs a build step.
- **Friendly competition:** daily "5 positions" challenges and per-role puzzle ratings with named tiers. Private boards only.
- **Calibration study:** recruit a coach panel and fit tolerances per role and phase from IDSSE and SkillCorner distributions, then check that real pros average above 75.

### 9.7 Open questions (decide before or during v1)
1. **Primary learner.** Is it you as an adult, a youth player (which age), or a coach? This decides the format (11v11 or 7v7/9v9), the default wording, and whether COPPA applies.
2. **Which game model do we teach first?** We assume a 4-3-3 with a zonal back four in a mid block. Should the app instead let you pick your own team's formation?
3. **Who keys the answers?** Is there a coach (or three) available? Without a panel, v1 is "principle-consistent" rather than "certified".
4. **HELIOS data licence.** Ask the helios-base maintainers to confirm that the root MIT licence covers `formations-dt`. Also ask ErrantActions to add an MIT licence to Soccer-Position-visualizer.
5. **Hosting and repo.** GitHub Pages on `github.com/scotchtowel17/fotbol`? The pasted git commands (`git init`, first commit, `git remote add origin https://github.com/scotchtowel17/fotbol.git`, `git push -u origin main`) were **not run** during this research step. Creating and pushing the repo is a publishing action that needs your explicit go-ahead.
6. **Node.js.** Will it be installed? Without it, we stay zero-build with in-browser tests. With it, we could add Vitest in CI, but nothing else is needed.
7. **Phones.** Is portrait-first (vertical pitch) or landscape-first the default?
8. **Monetisation.** Is it ever planned? It affects which datasets are usable (StatsBomb forbids commercial use; Karun's xT has no licence).
9. **Body orientation.** Is it worth an input gesture in v1, or should it wait for v3?
10. **Language.** Is Spanish needed early for US youth players?

### 9.8 Immediate next steps
1. Answer open questions 1, 2 and 5.
2. Send the two licence emails (question 4).
3. **M1:** pitch, formation engine and Explore mode, with tests.
4. **M2:** rule library, scoring, reveal and explanations.
5. **M3:** timeline, Drill mode, and the first 12 scenarios with coach keying.
6. **M4:** the remaining scenarios, progress and Elo, and Live mode.
7. **M5:** authoring polish, the accessibility pass, credits, and deploy.

---

## 10. Sources

Sources are grouped by topic. `[unverified]` means the item was seen only in search results, a secondary summary, or a page that failed to load.

### 10.1 Coaching curricula, courses and books
- U.S. Soccer U17+ Learning Plan (paraphrase only): <https://www.alsoccer.org/wp-content/uploads/sites/282/2024/10/US-Soccer-Player-Development-Framework-U17-Learning-Plan.pdf>
- US Youth Soccer ODP Player Manual: <https://www.usyouthsoccer.org/wp-content/uploads/sites/160/2023/09/Player-Manual-US-Youth-Soccer-ODP.pdf>
- U.S. Soccer Curriculum (2011): <https://cdn2.sportngin.com/attachments/document/0073/5091/Full_U.S._Soccer_Coaching_Curriculumnew.pdf>
- The FA England DNA: <https://www.thefa.com/bootroom/resources/england-dna/how-we-play/out-of-possession>
- England Football Learning: <https://learn.englandfootball.com/courses/free-courses>
- U.S. Soccer grassroots pathway: <https://www.ussoccer.com/stories/2018/08/7v7-9v9-and-11v11-online-courses-complete-new-us-soccer-grassroots-coaching-pathway>
- U.S. Soccer small-sided standards: <https://www.ussoccer.com/stories/2017/08/five-things-to-know-how-smallsided-standards-will-change-youth-soccer>
- EPYSA Player Development Initiatives: <https://www.epysa.org/u-s-soccer-player-development-initiatives/>
- Build-out line clarification (copy): <https://sabrsoccer.net/wp-content/uploads/2025/10/2025-10-11-us-soccer-build-out-line-clarification-copy.pdf>
- FIFA Training Centre: <https://www.fifatrainingcentre.com/en/>
  - GK in and out of possession: <https://www.fifatrainingcentre.com/en/practice/elite-sessions/goalkeeper/in_and_out_of_possession.php>
  - Corners, zonal or man: <https://www.fifatrainingcentre.com/en/game/game-analysis/set-plays/corners/defending-corners-zonal-or-player-to-player.php>
  - Train and blocker: <https://www.fifatrainingcentre.com/en/game/game-analysis/set-plays/corners/the-train-and-blocker.php>
  - Corner outlets: <https://www.fifatrainingcentre.com/en/game/game-analysis/set-plays/set-play-routines/defensive-corners-exploiting-attacking-outlets.php>
- DFB fussball.de, Viererkette: <https://training-service.fussball.de/trainer/artikel/die-viererkette-systematisch-schulen-2590/>
- Minnesota Youth Soccer, defending: <https://cdn1.sportngin.com/attachments/document/0112/0410/cp_defending.pdf>
- The Coaching Manual, defending corners: <https://assets.ngin.com/attachments/document/0138/8839/Three_strategies_for_defending_corners__Zonal__Man_to_Man_and_Mixed_Zonal_Man_to_Man_-_The_Coaching_Manual.pdf>
- IFAB Laws of the Game (Law 11 page; Laws 13-17 in the same site): <https://www.theifab.com/laws/latest/offside/>
- *Soccer iQ*: <https://www.goodreads.com/book/show/21451166-soccer-iq>; chapter summary: <https://bookquotemonster.wordpress.com/2015/12/04/soccer-iq-by-dan-blank/>
- *Football's Principles of Play*: <https://hawksmoorpublishing.com/book/footballs-principles-of-play-soccer-tactics>
- *Inverting the Pyramid*: <https://www.hachettebookgroup.com/titles/jonathan-wilson/inverting-the-pyramid/9781645030522/?lens=bold-type-books>
- Michael Cox: <https://en.wikipedia.org/wiki/Michael_Cox_(journalist)>
- `[unverified]`:
  - Allen Wade, FA Guide: <https://books.google.com/books/about/The_F_A_Guide_to_Training_and_Coaching.html?id=vxerQwAACAAJ>
  - Tiki Taka book: <https://www.goodreads.com/book/show/18815865-coaching-the-tiki-taka-style-of-play>
  - KNVB Dutch vision: <https://theexecutionersbong.wordpress.com/wp-content/uploads/2012/06/coaching-ed-dutch-vision.pdf>
  - Coerver: <https://www.coervercoaching.com/about/>

### 10.2 Tactics websites and video
- Spielverlagerung: <https://spielverlagerung.com/>
- Coaches' Voice Learning: <https://learning.coachesvoice.com/cv/glossary-football-tactics-coaching/>
- Touchline Theory: <https://touchlinetheory.com/the-practical-guide-to-actually-understanding-positional-play/>
- Motzenbecker: <https://motz.football/thoughts/2020/07/20/the-five-superiorities/>
- The Outfield: <https://www.theoutfield.nyc/p/lets-talk-about-the-salida-lavolpiana>
- Keeperstop depth: <https://www.keeperstop.com/blogs/goalkeeper_drills-angles_positioning/goalkeeper_drills-angles_positioning-how_far_off_the_line_should_the_goalkeeper_be>
- Keeperstop crosses: <https://www.keeperstop.com/blogs/goalkeeper_drills-corner_kicks_crosses_high_balls/goalkeeper_drills-corner_kicks_crosses_high_balls-goalkeepers_tactical_considerations_when_dealing_crosses>
- Coachbetter: <https://www.coachbetter.com/blog/soccer-knowledge-how-to-defend-in-football-behavior-of-the-back-four>
- Trainerblog: <https://trainerblog.fussball-training.org/fussball-taktik/defensive/viererkette-lernen-trainieren-abstaende-verschieben-3737.html>
- Soccer Coach Weekly: <https://www.soccercoachweekly.net/coaching-advice/what-is-covering>
- The Football Analyst: <https://the-footballanalyst.com/pressing-triggers-football-tactics-explained/>
- Coaching American Soccer, walls: <https://coachingamericansoccer.com/tactics-and-teamwork/soccer-defensive-wall-building/>
- Between the Posts: <https://betweentheposts.net/>
- Total Football Analysis (not recommended for youth): <https://totalfootballanalysis.com/>
- Breaking The Lines, YouTubers list: <https://breakingthelines.com/@btl/some-tactics-obsessed-football-youtubers-to-watch>
- Tifo Football `[unverified]`: <https://www.youtube.com/channel/UCGYYNGmyhZ_kwBF_lqqXdAQ>

### 10.3 Apps, products and design references
- Soccer Positioning: <https://play.google.com/store/apps/details?id=com.soccertrainer.positioning>
- SmartPitch Soccer: <https://apps.apple.com/us/app/smartpitch-soccer/id6782971217>
- TacticUP: <https://tacticup.com.br/>
- SportsLab360: <https://sportslab360.com/>
- IntelliGym: <https://soccer.intelligym.com/>
- Rezzil: <https://rezzil.com/>
- Be Your Best: <https://www.beyourbest.com/en-us/scenarios>
- Helix: <https://www.bundesliga-group.com/innovation/the-helix-training-tsg-style/>
- PlayScan: <https://getplayscan.com/football-scanning-training>
- VisionPlay: <https://apps.apple.com/us/app/visionplay-soccer-iq/id6761316273>
- Tactician Football: <https://apps.apple.com/us/app/tactician-football-soccer/id1659427194>
- FM26 Visualiser: <https://www.footballmanager.com/fm26/features/possession-out-possession-fm26s-new-tactical-evolution>
- Football, Tactics & Glory: <https://store.steampowered.com/app/375530/Football_Tactics__Glory/>
- HexaFootball: <https://store.steampowered.com/app/4347390/HexaFootball/>
- FootBrain: <https://playfootbrain.com/> and <https://apps.apple.com/us/app/footbrain-soccer-iq/id6779812029>
- TikiTaka: <https://matchiq.online/tikitaka>
- Allstars IQ: <https://play.google.com/store/apps/details?id=com.allstarsiq.app>
- Pitch Tactics: <https://play.google.com/store/apps/details?id=co.gamegarden.pitch_tactics>
- Match Strategy Board: <https://play.google.com/store/apps/details?id=com.tacticszone.footballstrategyhub>
- Taptics: <https://apps.apple.com/ch/app/taptics/id6738706939>
- IQ test: <https://calculatorscore.com/football-iq-test/>
- FootballGPT: <https://footballgpt.co/guides/football-tactical-iq-test-your-knowledge-now>
- OFN: <https://apps.apple.com/us/app/ofn-soccer-training-academy/id1571100807>
- Joga: <https://apps.apple.com/us/app/id1219358060>
- TacticalPad: <https://www.tacticalpad.com/>
- Coach Paint: <https://www.coachpaint.com/>
- Tactics Manager: <https://www.soccertutor.com/pages/tactics-manager>
- The Coaching Manual: <https://www.thecoachingmanual.com/>
- Sportplan: <https://www.sportplan.net/>
- Coach Tactic Board: <https://apps.apple.com/us/app/coach-tactic-board-soccer/id834813357>
- Tactico: <https://tactico.pro/soccer-tactics>
- Beyond Sports (Sony): <https://siliconcanals.com/sony-acquires-beyond-sports/>
- GeoGuessr maths: <https://latb.io/geoguessr/articles/the-maths>
- Lichess themes: <https://lichess.org/training/themes>
- EA FC forum `[unverified]`: <https://forums.ea.com/idea/fc-25-bug-reports-en/player-out-of-position---career-mode/12190928>

### 10.4 Code repositories and libraries
- Positioning trainers and boards:
  - <https://github.com/ErrantActions/Soccer-Position-visualizer>
  - <https://github.com/migueljfsc/pitchboard>
  - <https://github.com/TacticsJournal/board>
  - <https://github.com/meser1905/TacticBasicsFootball>
  - <https://github.com/tacticalboard/tacticalboard>
  - <https://github.com/zenggo/soccer-tactical>
  - <https://github.com/gljubojevic/tactics-board>
  - <https://github.com/AdzMarr/HTCG15_TacticsBoard>
  - <https://github.com/pitchsidecontent1-cell/tactics-canvas>
  - <https://github.com/BlueSky8bya/soccer-tactics>
  - <https://github.com/giustini/react-soccer-lineup>
  - <https://github.com/LilBlud05/Football-Tactical-Board>
  - <https://github.com/johnd-commits/football>
- Simulation and game AI:
  - <https://github.com/iamsorenl/arcade-soccer>
  - <https://github.com/Mugen87/kickoff>
  - <https://github.com/Mugen87/yuka>
  - <https://github.com/tbleckert/football-simulator>
  - <https://github.com/GallagherAiden/footballSimulationEngine>
  - <https://github.com/google-research/football>
  - <https://github.com/sebsowter/phaser-simple-soccer>
  - <https://github.com/eric-therond/simplesoccer>
  - <https://github.com/luiskarlos/soccer>
  - <https://github.com/wangchen/Programming-Game-AI-by-Example-src>
  - <https://github.com/ProtoxiDe22/DevSoccer>
  - <https://github.com/modelence/open-soccer>
  - <https://github.com/ivo-/open-haxball>
- RoboCup:
  - <https://github.com/helios-base/helios-base> (data: <https://github.com/helios-base/helios-base/tree/master/src/formations-dt>)
  - <https://github.com/helios-base/librcsc>
  - <https://github.com/helios-base/soccerwindow2>
  - <https://github.com/helios-base/fedit2>
  - <https://gitlab.com/robocup-sim/JaSMIn>
- Geometry and rendering:
  - <https://github.com/mapbox/delaunator> (CDN: <https://cdn.jsdelivr.net/npm/delaunator@5/delaunator.min.js>)
  - <https://github.com/d3/d3-delaunay> (CDN: <https://cdn.jsdelivr.net/npm/d3-delaunay@6.0.4/dist/d3-delaunay.min.js>)
  - <https://github.com/probberechts/d3-soccer>
  - <https://github.com/konvajs/konva> (CDN: <https://cdn.jsdelivr.net/npm/konva@10.7.0/konva.min.js>)
- Analytics:
  - <https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking>
  - <https://github.com/keisuke198619/C-OBSO>
  - <https://github.com/Alek050/databallpy>
  - <https://github.com/ML-KULeuven/socceraction>
  - <https://github.com/floodlight-sports/floodlight>
  - <https://github.com/UnravelSports/unravelsports>
  - <https://github.com/andrewRowlinson/mplsoccer/blob/main/mplsoccer/soccer/formations.py>
  - <https://github.com/hyunsungkim-ds/soccercpd>
  - <https://github.com/jonas-bischofberger/accessible-space>
  - <https://github.com/anenglishgoat/InteractivePitchControl>
  - <https://github.com/AgastyaGuha/Kinematic-pitch-control>
  - <https://github.com/samshipengs/Coordinated-Multi-Agent-Imitation-Learning>
  - <https://github.com/PySport/kloppy>
- Learning:
  - <https://github.com/open-spaced-repetition/ts-fsrs> (CDN: <https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.2/dist/index.umd.js>)

### 10.5 Positioning-model research
- Spearman et al. 2017: <https://static.hudl.com/craft/downloads/SSAC17-Physics-Based-Modeling-of-Pass-Probabilities-in-Soccer.pdf?mtime=20180305082035>
- Spearman 2018, *Beyond Expected Goals* `[checked via secondary implementations]`: <https://www.researchgate.net/publication/327139841_Beyond_Expected_Goals>
- Fernandez and Bornn 2018: <https://www.lukebornn.com/papers/fernandez_ssac_2018.pdf>
- Fernandez, Bornn and Cervone 2021: <https://arxiv.org/abs/2011.09426>
- Karun Singh xT: <https://karun.in/blog/expected-threat.html> and <https://karun.in/blog/data/open_xt_12x8_v1.json>
- Akiyama and Noda 2008: <https://link.springer.com/chapter/10.1007/978-3-540-68847-1_38>
- Bialkowski et al. 2014: <https://eprints.qut.edu.au/78124/>
- Le et al. 2017 ghosting: <https://la.disneyresearch.com/publication/data-driven-ghosting/>
- Bischofberger et al. 2026: <https://arxiv.org/abs/2606.19931>
- Groom et al. 2026 (arXiv 2601.00748), Dash et al. 2025 (arXiv 2511.06191), Teranishi et al. 2022 (arXiv 2206.01899), Bekkers 2025 (arXiv 2506.23843) and 2024 (arXiv 2501.04712), Narizuka and Yamazaki (arXiv 1802.06766). Find each at https://arxiv.org/abs/ followed by the ID.
- Cascioli and Wang 2025 `[parameters unverified]`: <https://www.hudl.com/blog/hpi-25-lorenzo-cascioli-allen-wang>
- The Magnet Player: <https://sportrxiv.org/index.php/server/preprint/view/1062>
- TacticAI: <https://deepmind.google/blog/tacticai-ai-assistant-for-football-tactics/>

### 10.6 Datasets
- SkillCorner: <https://github.com/SkillCorner/opendata>
- DFL/IDSSE:
  - <https://doi.org/10.6084/m9.figshare.28196177>
  - <https://www.nature.com/articles/s41597-025-04505-y>
  - <https://github.com/spoho-datascience/idsse-data>
- StatsBomb/Hudl: <https://github.com/hudl/open-data>
- Metrica: <https://github.com/metrica-sports/sample-data>
- PFF/Gradient: <https://www.gradientsports.com/blog/pff-fc-release-2022-world-cup-data>
- Last Row: <https://github.com/Friends-of-Tracking-Data-FoTD/Last-Row>
- Wyscout/Pappalardo: <https://figshare.com/collections/Soccer_match_event_dataset/4415000> and <https://www.nature.com/articles/s41597-019-0247-7>
- SoccerTrack v2: <https://huggingface.co/datasets/atomscott/soccertrack-v2>
- SN-GSR: <https://huggingface.co/datasets/SoccerNet/SN-GSR-2025>
- open-football index: <https://github.com/withqwerty/open-football>
- Alfheim `[partly unverified]`: <https://datasets.simula.no/alfheim/>
- CC BY 4.0: <https://creativecommons.org/licenses/by/4.0/>

### 10.7 Tactical assessment and learning science
- FUT-SAT: <https://revistas.rcaap.pt/motricidade/article/view/121>
- Costa et al. 2009: <https://www.periodicos.rc.biblioteca.unesp.br/index.php/motriz/article/download/2488/2534/13273>
- Dambroz and Teoldo 2023: <https://pmc.ncbi.nlm.nih.gov/articles/PMC10130636/>
- TacticUP paper: <https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.01690/full>
- UCL / Premier League academy test: <https://discovery.ucl.ac.uk/id/eprint/10140282/1/Assessing%20decision-making%20in%20elite%20academy%20footballers%20using%20real-world%20video%20clips.pdf>
- Zhu et al. 2024: <https://pmc.ncbi.nlm.nih.gov/articles/PMC11505547/>
- Müller et al. 2024: <https://pmc.ncbi.nlm.nih.gov/articles/PMC11467115/>
- Zhao et al. 2022: <https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2022.945067/full>
- Kalén et al. 2021: <https://www.diva-portal.org/smash/get/diva2:1651727/FULLTEXT01.pdf>
- van Maarseveen et al. 2018: <https://pmc.ncbi.nlm.nih.gov/articles/PMC6159770/>
- Silva et al. 2021: <https://www.frontiersin.org/articles/10.3389/fpsyg.2021.663867/full>
- Abad Robles et al. 2020: <https://pmc.ncbi.nlm.nih.gov/articles/PMC7013807/>
- Smeeton et al. 2005: <https://doi.org/10.1037/1076-898x.11.2.98>
- Roca et al. 2011: <https://doi.org/10.1007/s10339-011-0392-1>
- Mann et al. 2007: <https://doi.org/10.1123/jsep.29.4.457>
- Hadlow et al. 2018: <https://doi.org/10.1016/j.jsams.2018.01.011>
- Jordet et al. 2020: <https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.553813/full>
- Lorains 2013: <https://vuir.vu.edu.au/22304/1/Megan%20Lorains.pdf>
- Moreno 2004: <https://eric.ed.gov/?id=EJ732333>
- Wisniewski et al. 2020: <https://www.frontiersin.org/articles/10.3389/fpsyg.2019.03087/full>
- Brunmair and Richter 2019: <https://www.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf>
- Cepeda et al. 2008: <https://files.eric.ed.gov/fulltext/ED505660.pdf>
- Metcalfe and Finn 2012: <https://www.columbia.edu/cu/psychology/metcalfe/PDFs/MetcalfeFinn2012.pdf>
- Pelánek 2016 (Elo): <http://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf>
- Papoušek et al. 2016: <http://www.fi.muni.cz/~xpelanek/publications/its-target-difficulty.pdf>
- Sailer and Homner 2020: <https://eric.ed.gov/?id=EJ1245270>
- Almeida et al. 2023: <https://arxiv.org/abs/2305.08346>
- Bjork and Bjork: <https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-introducing-desirable-difficulties-into-practice-and-instruction-bjork-and-bjork.pdf>
- `[unverified or abstract-only]`:
  - Hanus and Fox 2015: <https://doi.org/10.1016/j.compedu.2014.08.019>
  - Adesope et al. 2017: <https://journals.sagepub.com/doi/abs/10.3102/0034654316689306>
  - Travassos et al. 2013: <https://www.sciencedirect.com/science/article/abs/pii/S1469029212001306>
  - Ward and Williams 2003: <https://journals.humankinetics.com/view/journals/jsep/25/1/article-p93.xml>
  - Atkinson et al. 2003: <https://www.semanticscholar.org/paper/Transitioning-From-Studying-Examples-to-Solving-of-Atkinson-Renkl/5057f7decd1e13fc2ab90cf65ca6cc1f79026a6a>
  - Treagust-style two-tier items: <https://files.eric.ed.gov/fulltext/EJ1456849.pdf>

### 10.8 Regulation
- Amended COPPA Rule compliance summary: <https://www.davispolk.com/insights/client-update/ftc-prioritizes-coppa-enforcement-new-compliance-obligations-take-effect>
- Federal Register rule `[not readable; bot wall]`: <https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule>

---

## Appendix A. Research corrections and contradictions (what this report decided)
| Topic | Discovery sweeps said | Verification said / decision |
|---|---|---|
| Soccer-Position-visualizer scope | Defenders only, 5 challenges, scored by distance bands | The shipped Challenge mode covers all 11 roles of a 4-4-1-1 in 4 states, with weighted scoring. The distance-band code and the 5 challenges are dead code. No licence, so **reference only**. |
| Kickoff support spots | A 12 x 5 grid; "top 3 to port" | A 5 x 5 grid, a wrong distance term and an import-case bug, so **reference only**. Use Buckland's original distance term. |
| arcade-soccer as the app skeleton | "Top 2 base" | Hard-coded 4v4 and non-IFAB markings (the goal is 18 m wide), so **reference only**. |
| HELIOS phases | Separate normal, defense, offense and set-play Delaunay sets; all files GPL-3 | normal, defense and offense are **byte-identical**. Kickoff, goal-kick and catch files are static single samples. File headers are about 133 GPL-3 and about 119 LGPL-3 under an MIT root licence. |
| d3-soccer | Full or half pitch, horizontal or vertical; MIT | `rotate()` is broken, the 0.3.0 CSS is missing, and the LICENSE is BSD-3. |
| Google Research Football | "Last commit 2025, low maintenance" | **Archived.** |
| Centre-of-play radius | "9.15 m in 11v11" | 9.15 m came from a 3v3+GK game (Dambroz and Teoldo 2023). No 11v11 value has been validated, so the radius is configurable with a default of 12 m `[D]`. |
| "Minimum 5 ahead of the ball" | Treated as a rest-defence rule | It is U.S. Soccer's **attacking** idea (commit numbers forward), confirmed in the PDF text. Rest defence (about 5 at or behind the ball) is a separate, complementary rule: P12 vs P13. |
| #6 screening distance | 8-15 m (learning sweep) vs 5-10 m (models sweep; HELIOS 7.3 m) | Default 5-10 m, with a tolerance that allows up to 15 m. |
| GK depth vs sweeper-keeper | Keeperstop: about 11 m off the line with the ball at halfway. Sweeper rule: 15-25 m behind the last defender. | These conflict when the block is high. The rule is chosen per block height: sweeper rule (G4) for a high block, Keeperstop depths (G1) otherwise. |
| Back-line spacing | 8-12 m; 12-15 m between lines; HELIOS nearest-teammate median 11.4 m | Kept as tolerance bands only. The German trainer blog rejects fixed spacing. |
| C-OBSO shot-blocking model | Described in detail | Not found in the code. It may exist only in the paper. |
| databallpy pitch control | A faithful Fernandez-Bornn implementation | Missing the `/2` in scaling, home and away swapped in a docstring, and max-normalisation where the paper sums. Fix these when porting. |
| Laurie EPV grid | 105 x 68 | The code assumes **106 x 68**. |
| TacticUP principles | 10 (2020 paper) | The live site says **12**. The two new ones were not identified. |
| "The niche is unoccupied" | No competitors | Three 2026 iOS entrants: SmartPitch, FootBrain, VisionPlay. All are tap-to-choose, so free placement is still open, but the space is less empty than first reported. |
| Build-out line location | Midway between the box and halfway, or about 14 yd from goal | Unresolved, so it is **configurable**. |
| pitchboard as a base | Reuse potential "high" | Borrow `pitch.ts` and the formation helper only. It needs Node 22 and pnpm, and this machine has no Node. |

## Appendix B. Plain-language glossary
- **Four moments:** in possession; losing the ball (defensive transition); out of possession; winning the ball (attacking transition).
- **Phase / block:** where the defending team sets up. A **high** block presses near the opponent's goal, a **mid** block sets up around halfway, and a **low** block defends near its own box.
- **Goal-side:** between your opponent (or the ball) and your own goal.
- **First, second and third defender:**
  - The first defender presses the ball.
  - The second covers behind the first at an angle.
  - Third defenders give balance: they tuck in, mark space and watch runners.
- **Cover shadow:** the area behind a presser that the ball cannot pass through. By standing on a passing line, you "switch off" the receiver behind you.
- **Half-space:** the two vertical channels between the centre and the wings (y 13.84-24.84 and 43.16-54.16). Receiving there gives diagonal views of goal and causes marking dilemmas.
- **Zone 14:** the central area just outside the opponent's penalty box, where many assists start.
- **Lanes and lines:** the pitch split into 5 vertical lanes, and horizontal "lines" of players. Good attacking shape avoids putting too many players in one lane or line.
- **Between the lines:** in the gap between the opponent's midfield and defensive lines.
- **Rest defence:** the players who stay back while your team attacks, ready to stop a counter-attack.
- **Counter-press (gegenpressing):** pressing immediately after losing the ball, for a few seconds.
- **Compactness:** keeping the team short (front to back) and narrow, so gaps between players stay small.
- **Step, hold, drop:** the back line moves up, stays, or retreats depending on pressure on the ball and the ball's direction.
- **Salida lavolpiana:** the #6 drops between two split centre-backs to beat a two-striker press.
- **Third-man run:** a combination where player A passes to B, who sets the ball for a third player C running into space.
- **Pitch control:** a model of which team would reach each spot on the pitch first.
- **xT / EPV:** "expected threat" or "expected possession value". Roughly, how likely a goal becomes if the ball is at a given spot.
- **Delaunay triangulation / barycentric interpolation:** the geometric trick that blends a few stored "ball here, players there" examples into a smooth position for any ball location.
- **Elo:** a rating method, as used in chess, applied here to learner skill and scenario difficulty.
