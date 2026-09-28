# Kid-first teardown: apps that hook 10-14-year-olds and teach a skill

**Date:** 2026-09-27. **Purpose:** concrete patterns for the kid-first redesign of fotbol (positioning now, "who do you pass to?" next).

**Method:** six research passes, then spot checks of the load-bearing claims at their source: PEGI 16, Duolingo's streak and Energy numbers, Chess.com's hints and move labels, Duolingo Chess, the EA Trainer and the Clash Royale teardown. Claims link the page they came from, and table rows link the store page. Anything weaker is labelled below.

**Labels:** **[unverified]** = search snippet or memory only. **[third-party]** = an unsourced guide. **[inference]** = our reading.

The earlier market survey is `docs/RESEARCH.md` §3.

## 0. Where fotbol starts (measured on the live site, phone 375×812)

- **Home:**
  - 592 words over about 5.8 phone screens: 5 tabs plus settings, 11 positions each with a job sentence, and 4 module cards with 30-50-word blurbs.
  - The main button, "Start the tutorial", opens a *second* intro screen with another "Start the tutorial" button.
- **Drill:**
  1. **Brief:** about 20 words, with a principle-code chip ("D3"). Keyboard help is always on screen.
  2. **Play:** about 6 s of action.
  3. **Freeze:** the question, an instruction, "How sure are you?", "Watch again" and "Lock in".
  4. **An extra tap:** a "Before you see the answer" question.
  5. **Reveal:** about 150 words. A letter grade, a score out of 100, two reasons with codes (U4, D3), a fix in metres, what you got right, a takeaway and a legend.
- **Not moving at all** gets a red **F**, "3/100" and "Out of position."
- **Rewards already modelled:** `js/rewards.js` has XP, ranks (Rookie → Legend), badges, bronze/silver/gold sticker cards and kit colours. There is no streak that punishes a missed day.
- **Verdict:** the engine and the feedback content are strong. They are packaged for an adult.

## 1. What the kid-UX evidence says (applies to every section)

- **9-12-year-olds** scan and skip long instructions and like animation and sound. They react badly to design pitched a grade above or below their own ([NN/g 2019](https://www.nngroup.com/articles/childrens-websites-usability-issues/)).
- **For kids:** state the goal of a game and how to reach it. Make feedback exaggerated and explicit, and remember kids take instructions literally ([NN/g](https://www.nngroup.com/articles/kids-cognition/)).
- **Teens:** "the word 'kid' is a teen repellent". Keep text in small chunks at a 6th-grade reading level, with no heavy animation or garish colours. Drag-and-drop is hard on touch screens ([NN/g 2019](https://www.nngroup.com/articles/usability-of-websites-for-teenagers/)). fotbol's settings toggle is literally labelled "Kid".
- **Tutorials:** in a 70-user study, card tutorials did not raise success (91% vs 94%) and made tasks feel *harder* ([NN/g 2020](https://www.nngroup.com/articles/mobile-tutorials/)).
- **Praise:** fifth graders praised for intelligence persisted less and enjoyed tasks less after failure than those praised for effort ([Mueller and Dweck 1998](https://www.columbia.edu/cu/psychology/courses/3615/Readings/Mueller_Dweck.pdf)).
- **UK Children's Code:**
  - Give no in-game advantages for extended play, and present choices "without suggesting that children will lose out" ([ICO std 5](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/5-detrimental-use-of-data/)).
  - Let children pause without losing progress, and nudge them towards breaks ([ICO std 13](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/13-nudge-techniques/)).
- **Misuse:** a study of Duolingo learners found them fixating on points, streaks and leagues instead of learning ([L@S 2022](https://arxiv.org/abs/2203.16175)).
- **"Juice":** small visual and audio responses to every input make simple play feel alive ([GDC Europe 2012](https://www.gdcvault.com/play/1016487/juice-it-or-lose)).

## 2. App teardowns (short)

### 2.1 Duolingo
- **First 60 s:**
  - Duo greets you, then 3-4 setup taps (goal, reason, level, optional placement), then a real exercise. Sign-up is suggested only *after* the first lesson ([Appcues](https://goodux.appcues.com/blog/duolingo-user-onboarding)).
  - New users get an easy "happy path" first lesson ([growth.design](https://growth.design/case-studies/duolingo-user-retention)).
- **Loop:**
  - Node → about 15 short items [third-party] → Check → instant banner → Continue → celebration → streak. A lesson lasts a few minutes [unverified].
  - The 2022 path replaced the skill tree because learners weren't sure how to use the app; review is mixed in ([blog](https://blog.duolingo.com/new-duolingo-home-screen-design)).
- **Text per screen:** one command line plus tiles. The Math and Music courses teach by dragging blocks, fraction pies and notes rather than with text ([Math](https://blog.duolingo.com/developing-math), [Music](https://blog.duolingo.com/music-course/)).
- **Feedback:**
  - A green or red slide-up banner with one big button [third-party].
  - The characters have idle, correct and incorrect states ([Rive](https://blog.duolingo.com/world-character-visemes)).
  - Milestone animations raised new learners' day-7 retention by 1.7% ([2022 post](https://blog.duolingo.com/how-duolingo-streak-builds-habit)).
- **Progress:**
  - One path, a lesson bar and a streak flame.
  - A 7-day streak meant learners were 3.6× likelier to finish a course. Allowing two freezes added 0.38% to daily learners (same post).
  - The weekend amulet brought 4% more learners back ([2017 post](https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/)).
- **Hearts became Energy (2025):**
  - Every exercise costs energy, right or wrong, and runs of correct answers earn it back: "a carrot, not a stick". It raised daily users, learning time and subscriptions ([SEC Q2 2025](https://www.sec.gov/Archives/edgar/data/1562088/000156208825000165/q2fy25duolingo6-30x25share.htm)).
  - Free users report running dry after 2-3 lessons ([DuoPlanet](https://duoplanet.com/duolingo-energy-system/)).
- **Tone:** cheeky and character-led; "delight" is a stated principle ([method](https://blog.duolingo.com/duolingo-teaching-method)).
- **Avoid:**
  - pacing that limits free practice;
  - guilt pushes (broken streaks make people quit, via [Decision Lab](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification));
  - XP leagues;
  - ads and data sharing: Common Sense Privacy rates Duolingo "Warning" ([CS Privacy](https://privacy.commonsense.org/evaluation/duolingo)).

### 2.2 Chess puzzles: the closest analogue to "find the right spot"
- **Chess.com Puzzles:**
  - Guests can play, but free play is capped at 3 puzzles a day ([help](https://support.chess.com/en/articles/8652730-why-am-i-limited-to-only-three-puzzles-per-day)).
  - Rush lasts 3 or 5 min and ends after 3 misses; Survival has no clock ([help](https://support.chess.com/en/articles/8608686-how-do-puzzles-work-on-chess-com)).
  - The rating moves by puzzle difficulty, and a hint counts as a fail ([help](https://support.chess.com/en/articles/8602396-how-do-puzzle-ratings-work)).
- **Chess.com Daily Puzzle** ([help](https://support.chess.com/en/articles/8708990-how-does-the-daily-puzzle-work)):
  - 5 hearts. A miss or a hint costs one heart and brings a coach tip.
  - Hint 1 highlights the piece; hint 2 shows the move.
  - At zero hearts, "Keep Going" lets you finish. Streaks allow 48 h of grace.
- **Chess.com Game Review:**
  - Labels each move Brilliant, Great, Best … Mistake or Blunder by expected points lost (Best 0, Good ≤0.05, Mistake ≤0.20, Blunder >0.20). It is more generous for new players ([help](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc)).
  - The Coach gives a one-line summary it can read aloud, and offers "Retry" ([help](https://support.chess.com/en/articles/8584089-how-does-game-review-work)).
- **Lichess:**
  - The prompt is two lines: "Your turn" / "Find the best move for white."
  - A wrong move gets ✗ "That's not the move!", is taken back, and you try again; a right one gets ✓ "Best move!" ([lila strings](https://raw.githubusercontent.com/lichess-org/lila/master/translation/source/puzzle.xml)).
  - "Every puzzle attempt is a game", rated with Glicko-2 ([blog](https://lichess.org/@/lichess/blog/new-puzzles-are-here/X-S6gRUA)).
  - Themes come with 1-2-sentence definitions ([themes](https://lichess.org/training/themes)). Storm is 3 min, with a combo bar that adds time ([storm](https://lichess.org/page/storm)).
  - Free, with no ads. Kid Mode locks chat ([kid mode](https://lichess.org/page/kid-mode)).
- **ChessKid:**
  - "Made for Ages 9-11", ad-free, chat with parents only ([App Store](https://apps.apple.com/us/app/chess-for-kids-learn-to-play/id629375826)).
  - Video lessons, 2-min Puzzle Duels, and avatars with costumes bought with coins ([guide](https://www.chesskid.com/learn/articles/complete-guide-to-chesskid)).
  - Free accounts get 3 puzzles a day ([help](https://support.chesskid.com/en/articles/8858285-what-s-the-difference-between-a-free-account-a-gold-membership)). A review calls the cartoon interface dated ([Screenwise](https://screenwiseapp.com/media/chesskid-game)).
- **Duolingo Chess** (free since 10 Jun 2025): 75% puzzles. Prompts fade from "move your bishop here" to "find checkmate in two", with spaced review. The coach, Oscar, both tutors you and plays you ([blog](https://blog.duolingo.com/chess-course)).
- **Tone:** clean boards with tiny text. ChessKid's cartoons risk looking babyish past about 11 [inference].
- **Avoid:** daily practice caps, rating losses shown as losses, open chat.

### 2.3 Prodigy Math (grades 1-8)
- **First 60 s and loop:**
  - You build a wizard [unverified]. A placement test disguised as battles starts on its own, and kids aren't told it's a test. Placement runs as 3-4 sessions of 15 minutes ([help](https://prodigygame.zendesk.com/hc/en-us/articles/207074953-The-Placement-Test)).
  - Answer a maths question to cast a spell. The question sits on a textbook-style panel over the game, so the maths is a gate between the fun ([Fairplay complaint](https://fairplayforkids.org/wp-content/uploads/2021/02/Prodigy_Complaint_Feb21.pdf), p. 4).
- **Avoid:**
  - Members level up faster. Non-members' avatars walk in dirt while members ride clouds (p. 13).
  - In 19 minutes of play, observers counted 16 membership ads and 4 maths problems (p. 18).
  - Common Sense (2025) still flags that paying players level more easily ([CSM](https://www.commonsensemedia.org/app-reviews/prodigy-kids-math-game)).

### 2.4 Brilliant
- **Principle:** "understanding clicks through doing, not reading", modelled on Super Mario. Every one of the 1,000+ problems in a course is checked by a person, because one wrong problem can shake confidence ([blog, Jan 2025](https://blog.brilliant.org/hand-crafted-machine-made/)).
- **Loop:** drag a tangent line and watch the slope change. The AI tutor answers a wrong guess with marks drawn on the problem ([blog, May 2026](https://blog.brilliant.org/a-world-class-tutor-in-every-home/)).
- **Feedback:**
  - "Celebrate success, encourage during struggle" ([ustwo](https://ustwo.com/work/brilliant/)).
  - A path of animated nodes and a streak ([Rive](https://rive.app/blog/how-brilliant-org-motivates-learners-with-rive-animations)). Leagues, XP, and subscriptions from $19.99 to $191.99 ([App Store](https://apps.apple.com/us/app/brilliant-learn-by-doing/id913335252)).
- **Tone:** whimsical but restrained, built for adults. This is the "not babyish" register to aim for.

### 2.5 Khan Academy (and Khan Academy Kids)
- **Mastery:**
  - Attempted is under 70%, Familiar 70-99%, Proficient 100%. Mastered means Proficient and then right again on a mixed test.
  - Levels can drop ([help](https://support.khanacademy.org/hc/en-us/articles/5548760867853), [help](https://support.khanacademy.org/hc/en-us/articles/115002552631)).
- **Effort vs mastery:** energy points measure effort, not mastery ([help](https://support.khanacademy.org/hc/en-us/articles/202487710)).
- **Khan Kids (ages 2-8):** five animal guides whose feedback names the exact action ([help](https://khankids.zendesk.com/hc/en-us/articles/360049358751)). Too young in tone for an 11-year-old.

### 2.6 Kahoot! (and Blooket)
- **First 60 s:** a PIN and a nickname, with no account. The player's device shows only four shapes ([help](https://support.kahoot.com/hc/en-us/articles/360039422694)).
- **Scoring** ([help, 23 Sep 2026](https://support.kahoot.com/hc/en-us/articles/115002303908)):
  - Points slide from 1,000 to 500 as the clock runs, and answering in under 0.5 s scores the full 1,000.
  - Answer streaks earn nothing extra.
  - "Accuracy" mode and a timer-off option exist, but the ranking can't be hidden.
- **Why shapes:** each colour is paired with a triangle, diamond, circle or square, so colour-blind players can answer ([help](https://support.kahoot.com/hc/en-us/articles/115004537447)).
- **Evidence:** a review of 93 studies found mostly positive effects, and 10 of 14 found less anxiety. But the clock stressed some players and pushed guessing, and anonymity lowered stress ([Wang and Tahir 2020](https://research.gold.ac.uk/id/eprint/39435/)).
- **Blooket:** tokens buy random packs of collectible "Blooks", and rarer ones get longer reveals ([help](https://help.blooket.com/hc/en-us/articles/16310759040151)). That is loot-box design without the money.

### 2.7 EA SPORTS FC: the visual language kids already know
- **Card:**
  - One big overall number plus PAC, SHO, PAS, DRI, DEF and PHY ([ratings](https://www.ea.com/games/ea-sports-fc/ratings)). Gold starts at 75 ([pack odds](https://www.ea.com/games/ea-sports-fc/news/fc-pack-probabilities)).
  - PlayStyle badges carry one-sentence effects ([PlayStyles](https://www.ea.com/games/ea-sports-fc/fc-27/news/what-are-playstyles)). Chemistry is shown as 0-3 pips [unverified].
- **Teaching:**
  - The **Trainer** is on by default. It shows button prompts and a **Pass Receiver Indicator**, and each part can be turned off ([Operation Sports](https://www.operationsports.com/ea-fc-26-how-to-turn-off-trainer-explained/)).
  - Skill Games: pass to a highlighted teammate or thread gaps, for bronze, silver or gold ([FIFPlay, fan site](https://www.fifplay.com/fc-26-skill-games/)).
  - FC Futures drills are meant to be repeated on a real pitch ([EA](https://www.ea.com/games/ea-sports-fc/fc-futures/practices)).
- **Tone:** dark premium menus, metallic frames, broadcast polish [inference].
- **Avoid: packs bought with FC Points.**
  - Belgium stopped them in 2019 ([VGC](https://www.videogameschronicle.com/news/ea-stops-selling-fifa-loot-boxes-in-belgium-jan-29-2019/)). EA told UK MPs they are "surprise mechanics" ([Engadget](https://www.engadget.com/2019-06-20-ea-uk-parliament-loot-boxes-surprise-mechanics.html)).
  - From June 2026, paid random items mean PEGI 16 or higher ([Reed Smith](https://www.reedsmith.com/articles/pegi-launches-interactive-risk-categories-overhauls-age-ratings-for-loot-boxes-in-game-spending-and-communication-features/)). FC 27 is rated 16 ([PSX Extreme](https://psxextreme.com/news/ea-fc-27-gets-pegi-16-rating-due-to-new-loot-box-rules/)).
  - Brazil bans them in games minors are likely to use ([Operation Sports](https://www.operationsports.com/brazil-bans-loot-boxes-what-it-means-for-ea-fc-and-ultimate-team/)).
  - **Borrow the look, not the economy.**

### 2.8 Football Manager 26 (the contrast)
- **What it shows:** separate in- and out-of-possession shapes, 4 views, a 3×3 grid of ball zones and star ratings for roles ([FM26](https://www.footballmanager.com/fm26/features/possession-out-possession-fm26s-new-tactical-evolution)). Six top-level menus, each with submenus ([UI guide](https://www.footballmanager.com/the-dugout/mastering-fm26-ui)). Sessions run for hours.
- **Lesson:** this is fotbol's density problem, only bigger. Keep one idea (where you stand depends on the ball) and show it one zone at a time.

### 2.9 Score! Hero (First Touch Games)
- **Loop:** draw a line to pass or shoot in hundreds of hand-built moments, with up to 3 stars a level. Rated 4.7 from 368K ratings ([App Store](https://apps.apple.com/us/app/score-hero/id847492141)); 90M downloads by 2017 ([PocketGamer.biz](https://www.pocketgamer.biz/interview/65769/first-touch-games-on-the-evolution-of-score-hero/)). One gesture plus designed situations needs almost no text.
- **Avoid:**
  - Score! Hero is rated 13+, shows ads, and sells energy and "unlimited kicks".
  - Score! Match sells upgradeable players, and reviews call it pay-to-win ([App Store](https://apps.apple.com/us/app/score-match-pvp-soccer/id1145420529)).

### 2.10 Youth soccer training and IQ apps (store pages opened 2026-09-27)
| App | What the kid does | First minute / session | Feedback and progress | Watch-outs |
|---|---|---|---|---|
| [SmartPitch Soccer](https://apps.apple.com/us/app/smartpitch-soccer/id6782971217) (free, 4+) | Taps a decision in 7v7, 9v9 or 11v11, against a clock | Themed packs | 5 tiers (best → turnover) and a "what happens next" animation. Stars unlock harder sets | Ad data collected in a 4+ app. 0 ratings |
| [FootBrain](https://playfootbrain.com/) (web/iOS, 13+) | 3-4 chained text-button choices ("Play the 8") | One Start button, music, a stopwatch. A daily puzzle of under a minute | One result line, your time, a leaderboard, a share link | Jargon. Name and email needed for a streak |
| [Tactician Football](https://apps.apple.com/us/app/tactician-football-soccer/id1659427194) (4.7) | 2-minute matches pause at key moments, and you tap the pass | Daily leagues | Celebratory feedback (RESEARCH §3.3) | Small in-app purchases |
| [TacticUP](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.01690/full) (web) | 45 clips cut before the action; pick 1 of 4 | 3 practice scenes, a 3 s countdown and a marker on the player | Report per principle. 94% of 11-17-year-olds enjoyed it | Needs a tablet of at least 10" |
| [Techne Futbol](https://apps.apple.com/us/app/techne-futbol-soccer-training/id1298569303) (4.7, 17K) | Technical drills and skill tests | Subscription after a trial | Leaderboards, a coach view | $279.99 a year. Tracking identifiers |
| [DribbleUp](https://apps.apple.com/us/app/dribbleup-sports-fitness/id1451878715) (4.7, 41K) | Smart-ball drill classes | A $59.99 ball plus about $20 a month | Challenges, streaks, a parent view | Reviews say it misses fast touches |
| [VisionPlay](https://apps.apple.com/us/app/visionplay-soccer-iq/id6761316273) / [IntelliGym](https://soccer.intelligym.com/) | VisionPlay: react to cues. IntelliGym: abstract brain training | VisionPlay: 3-minute sessions. IntelliGym: 30 minutes, 2-3 times a week | Rep counts / XP rankings | VisionPlay links name and email to the user. IntelliGym costs $190.99 a year and has 2.4 stars |

**The gap:** no one lets a kid act *on the pitch*; the rest use 1-of-4 or text buttons. The established apps are paywalled, need accounts or track users. Only SmartPitch shows what happens after the choice.

### 2.11 Clash Royale (and Brawl Stars)
- **First 60 s:**
  - A battle starts "a handful of seconds" after opening, and battles last 3 minutes ([Deconstructor of Fun](https://www.deconstructoroffun.com/blog//2016/02/clash-royale-next-billion-dollar-game.html)).
  - Only two coaching moments are forced (placing a unit, building the deck).
  - Seven training matches add one idea each: first no enemy troops, then elixir, pairing troops, and lanes. Menus stay limited until level 2-3 ([Matt Le teardown](https://www.linkedin.com/pulse/clash-royale-creating-sticky-first-time-user-experience-matthew-le)).
  - Whether a ghost hand demonstrates the first drag is [unverified].
- **Avoid:**
  - Timed chests and paid skips at launch. The April 2025 update removed them, but random Lucky Drops remain ([Supercell](https://supercell.com/en/games/clashroyale/blog/release-notes/april-update/)).
  - Brawl Stars swapped its loot boxes for a fixed reward track in 2022 ([Game Developer](https://www.gamedeveloper.com/business/supercell-pulls-loot-boxes-from-brawl-stars-in-favor-of-deterministic-rewards-)).

### 2.12 Roblox (creator guidance) and Fortnite
- **Roblox docs** ([onboarding](https://create.roblox.com/docs/production/game-design/onboarding), [techniques](https://github.com/Roblox/creator-docs/blob/main/content/en-us/production/game-design/onboarding-techniques.md)):
  - "Get to the fun quickly", because players decide within minutes. Keep early levels quick to reach, and add "moments of joy" at milestones.
  - Use spotlights and arrows over text. Explain features just in time, and time hints so only stuck players see them.
- **Fortnite:**
  - Since 2019, bots stop new players being knocked out straight away, and they fade as skill rises ([Engadget](https://www.engadget.com/2019-09-23-fortnite-epic-games-adding-bots.html)).
  - **Avoid:** Epic paid $520M to settle FTC charges over chat that was on by default for kids and purchases made with one press ([FTC](https://www.ftc.gov/news-events/news/press-releases/2022/12/fortnite-video-game-maker-epic-games-pay-more-half-billion-dollars-over-ftc-allegations)).

### 2.13 Super Mario Bros. World 1-1 (teaching with no words)
- **Safe start:** an empty opening where players "gradually and naturally understand" what to do ([Game Developer](https://www.gamedeveloper.com/design/how-miyamoto-built-i-super-mario-bros-i-legendary-world-1-1)).
- **Boxed-in mushroom:** you can't avoid learning that it helps ([SoraNews24](https://soranews24.com/2015/09/09/super-mario-bros-creator-explains-how-and-why-he-designed-world-1-1-of-the-8-bit-classic-%E3%80%90video%E3%80%91/)).
- **Level structure:** introduce, develop, twist, test ([Game Developer](https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design)).

## 3. Pattern catalog (28 patterns)

Each row gives what the pattern is, where it's seen, why it works, and what fotbol should do. Evidence links are in §1-2.

**Getting started**

| # | Pattern | What it is | Seen in | Why it works | What fotbol should do |
|---|---|---|---|---|---|
| 1 | **Play in ten seconds** | The core action comes first: no reading, no setup, no account | Clash Royale, Kahoot's PIN, Duolingo, Roblox docs | Kids decide within minutes and skip instructions. Tutorials don't raise success | Open onto a clip that freezes for the first move. Position, nickname and kit come after the first win |
| 2 | **Show the gesture once** | A ghost hand or glow performs the action one time | Clash Royale placement coaching, Roblox spotlights | Visuals are hard to miss and need no language | On rep 1, a ghost hand drags YOU to the glow once. Replay it after 5 s idle |
| 3 | **Rig the first win** | The first encounters are tuned so newcomers succeed | Fortnite bots, Clash Royale (first match has no enemy troops), Mario's empty start | An early win buys patience for harder reps | Reps 1-2 get wide zones and the glow. Elo starts counting after them |
| 4 | **Spotlight what matters** | Dim everything the decision doesn't need | Roblox spotlights, Mario's boxed mushroom, EA Trainer markers. Football Manager shows the cost of skipping this | Kids have smaller working memory. 22 labelled discs are noise | Light the ball, YOU and the 3-5 players in the principle. Fade the rest to about 30% and drop opponents' labels |

**Structure**

| # | Pattern | What it is | Seen in | Why it works | What fotbol should do |
|---|---|---|---|---|---|
| 5 | **One idea per level** | Introduce, develop, twist, test | Mario, Clash Royale training matches, Duolingo path | Each step adds one variable | Each node on the Road is one principle, played shown → guided → alone → mixed |
| 6 | **The Road** | One linear path with review mixed in | Duolingo (its path replaced a tree that confused people), Brilliant nodes, Clash Royale arenas | No choices to make, and progress is visible | One Road replaces the module cards and the five tabs |
| 7 | **Unlock the menus** | Features appear when they become useful | Clash Royale (menus at level 2-3), Roblox just-in-time help | Fewer choices on day one | Passing, Match day and the card album unlock visibly on the Road |

**Answer and feedback**

| # | Pattern | What it is | Seen in | Why it works | What fotbol should do |
|---|---|---|---|---|---|
| 8 | **Answer by doing** | Act on the scene instead of picking text | Brilliant, chess puzzles, Score! Hero, Duolingo Math | Movement-like answers transfer better (RESEARCH §7.1 rule 1) | Keep place-to-answer. For passes, tap the teammate. FootBrain's "Play the 8" buttons show what not to do |
| 9 | **One-second verdict** | Colour, icon and sound together | Duolingo banner, Lichess ✓/✗, Kahoot | Kids need explicit, exaggerated feedback | Stars and a chime within 0.5 s of locking in. A miss gets a soft sound and an arrow |
| 10 | **Draw the why on the pitch** | Marks on the scene, not a paragraph | Brilliant tutor marks, EA Pass Receiver Indicator, chess arrows | The eyes are already on the pitch | Ring, arrow and shaded zone. In passing, lanes and defender shadows |
| 11 | **"Why?" on demand** | One line by default. The full reason is one tap away, with read-aloud | Chess.com Coach, Roblox just-in-time help | Kids skip long text. The curious can dig | Today's reveal panel moves behind **Why?**, with a speaker icon |
| 12 | **Show what happens next** | Replay the consequence of the choice | SmartPitch, Score! Hero (the drawn pass plays out), Lichess plays the solution | Explaining beats correcting (RESEARCH §7.1 rule 5) | Play 2-3 s on from YOUR spot automatically. The best spot's version is one tap away |
| 13 | **Take it back and retry** | A miss snaps back, or a twin scene is served | Lichess, Chess.com Retry | The fix lands while the scene is fresh | After 0-1 stars, **Try again** serves the mirrored or nudged twin |
| 14 | **Hints only when stuck** | A two-step ladder after a miss or when idle | Chess.com (the piece, then the move), Roblox timed hints | Helps stuck players without spoiling it for others | Hint 1 lights the key player and asks today's cue question in one line. Hint 2 makes the zone glow |
| 15 | **Fade the scaffolds** | Early prompts point, later ones only ask | Duolingo Chess, EA Trainer (switched off one part at a time) | Help for novices hinders experts (RESEARCH §7.1 rule 7) | Per principle: glow → hot/cold → nothing → clock |
| 16 | **Stars, not grades** | 0-3 stars, never a failing letter | Score! Hero, SmartPitch tiers, Duolingo's bar that moves even on a miss [third-party] | Labels about ability cut persistence after failure (Mueller and Dweck) | S, A and B become 3, 2 and 1 stars (`starsFor` exists). C-F become "Try again". Numbers go to Coach mode |
| 17 | **Quality labels with icons** | Every option gets a label for how good it is | Chess.com Game Review (cut-offs by value lost, eased for new players) | The kid sees the whole landscape, not just their own pick | Passing marks each teammate ★ Best, ✓ Good, ! Risky or ✗ Cut out, with cut-offs eased at low levels |
| 18 | **Shapes and numbers, not colour alone** | Every colour is paired with a shape or number | Kahoot | Colour-blind kids can still play | Teammates keep their shirt numbers. Every label pairs an icon with a colour |

**Sessions and rewards**

| # | Pattern | What it is | Seen in | Why it works | What fotbol should do |
|---|---|---|---|---|---|
| 19 | **Short sets with a finish line** | A small fixed unit ending in a celebration and a clear stop | Duolingo lesson, Clash Royale battle, Puzzle Rush, VisionPlay | Fits attention spans, and the ICO asks for breaks | 5 reps (about 3 min), then "Full time" |
| 20 | **Moments of joy at milestones** | Big celebrations at thresholds, small ones per rep | Duolingo milestone animations (+1.7% day-7 retention), Roblox docs | They mark progress | Level-ups, card upgrades and chapter ends get the big show |
| 21 | **An earned player card** | FC-style card: a big number, six short stats, a metal tier | EA FC (avoid its packs), PlayStyle badges | It's the visual language 10-14s already brag in | "Your fotbol card": an overall number plus six skill stats (e.g. PRS COV BAL SUP WID SHP). Principle cards go bronze → silver → gold. Always earned, never random, never bought |
| 22 | **Mastery that must be re-proved** | Named tiers. The top one comes only from mixed review | Khan Academy | Separates practice success from learning (RESEARCH §7.5) | Gold needs mixed-review wins on 2 separate days. A skill due for review gets a "rusty" tag instead of losing points |
| 23 | **Invisible adaptive rating** | A hidden rating picks the next item near your level | Lichess Glicko-2, Prodigy's silent placement | Success stays near the target without a visible test | Keep the Elo. Kids see stars and card numbers, never the raw rating |
| 24 | **Forgiving streaks** | Count good days, with rest built in | Duolingo amulet and freezes (Duolingo cites research that "slack" motivates), Chess.com 48 h grace | Some slack motivates more than rigid rules | "Training days this week". A missed day shows nothing and sends no reminder |
| 25 | **A coach voice in one line** | Brief, specific words about the move | Duolingo characters, Chess.com Coach, Duolingo Chess's Oscar, Khan Kids | It carries the tone, so the text can shrink | A coach voice, not a cartoon mascot. Lines of 10 words or fewer that praise the move ("You covered the gap early"), never the kid |
| 26 | **Juice** | Every input gets a sound and a small motion | "Juice it or lose it", Duolingo sounds, FC crowd | 9-12s like it. Teens dislike garish excess | Whistle at the freeze, thock on lock-in, a chime per star, a crowd lift at 3 stars. Respects mute and reduced motion |
| 27 | **Rush modes later, against yourself** | Timed challenges once the basics hold | Puzzle Rush and Storm, FC Skill Games, Kahoot Accuracy mode | An early clock stresses kids and pushes guessing | Each chapter unlocks a Rush after gold. Scored only against your own best |
| 28 | **A grown-up door** | Parents and coaches get the detail in a separate view | Khan and Prodigy dashboards, Kahoot host, ChessKid parents, Lichess Kid Mode | The kid's screen stays clean without losing depth | Coach mode (§5.7) |

## 4. What to avoid (ethics)

- **Random or paid rewards:** packs, boxes and spins, even ones bought with earned tokens (Blooket). PEGI rates them 16+ from June 2026, and Brazil bans them for minors. The FTC fined HoYoverse $20M and banned loot-box sales to under-16s without parental consent ([FTC, Jan 2025](https://www.ftc.gov/news-events/news/press-releases/2025/01/genshin-impact-game-developer-will-be-banned-selling-lootboxes-teens-under-16-without-parental)).
- **Paying to progress, or caps on practice:** Prodigy's membership, Score! Hero's energy, 3-puzzles-a-day limits.
- **Loss-framed streaks, guilt nudges and autoplay into the next set:** see ICO standard 5.
- **Public comparison:** global leaderboards, rankings that can't be hidden (Kahoot), and leaderboards that need a name and email (FootBrain).
- **Speed scoring by default** (Kahoot), and time-limited offers (these trigger PEGI 12).
- **Unsafe defaults:** chat on by default (Epic, $520M), and ad data or tracking in kids' apps (SmartPitch, Techne, IntelliGym).
- **Gamification as the goal:** XP for volume, badges for grinding (L@S 2022).

## 5. Proposed kid-first fotbol

**Rules for every kid screen:**
- one screen, one job;
- play first, words later;
- 12 words or fewer on the play path;
- the pitch *is* the explanation;
- stars, never an F;
- every "why" is one tap away.

**Tone:** broadcast graphics. Bold condensed numerals, dark pitch green with one hot accent, metallic card tiers, commentary lines ("Line broken!"). No cartoon mascot and no word "kid".

### 5.1 First open, screen by screen (first action in about 5 s, with 6 words or fewer read)
1. **Kick-off.**
   - A full-bleed pitch with a real drill looping behind the wordmark.
   - One big **Play** button, and a small "Coach or parent?" link that opens Coach mode.
   - No tabs, no position picker, no module list.
2. **Rep 1, built to be won.**
   - You're the #8, lit up with the ball and the 3-5 players who matter.
   - 3 s of play, then a whistle and a freeze.
   - A ghost hand drags YOU once, and a glow warms as you near the zone. Lift your finger to lock in.
3. **Reveal.**
   - A ring on the best spot, and stars pop with a sound.
   - Play runs on from your spot ("Pass blocked!").
   - One line: "Between the ball and our goal." Then **Next**.
4. **Rep 2** is the mirrored twin, with no ghost hand and the glow still on. **Rep 3** has no glow; a Hint button appears after a miss.
5. **Full time.** The stars tally, the XP bar fills, and your first card flips ("Goal-side · Bronze").
6. **Make it yours (skippable).** A kit colour, a nickname of up to 10 characters (no real names suggested), and tap your shirt on a mini-pitch (it defaults to the #8).
7. **Home.** Returning players always land here.

### 5.2 Home (25 words or fewer)
- **Top bar:** kit badge and nickname, a level ring ("Academy · 4"), the card album and a settings cog.
- **Hero button:** a big **Play** showing "Next: Cover · 5 plays · 3 min". The engine picks the mix: about 60% current skill, 25% look-alikes and 15% due reviews (RESEARCH §7.3).
- **The Road:** chapters "Defend as three", "Help the ball", "Move as one", and later "Pass it right". Each node shows an icon and 0-3 stars; the current node pulses; locked nodes are grey silhouettes.
- **Two tiles:** **Who's open?** (passing) and **Match day** (Live, which unlocks after chapter 1).
- **Nothing else.** Explore, the library, the reading list and every number move to Coach mode.

### 5.3 Core loop: "Find your spot" (about 20 s a rep)
1. **Set (1 s).** The camera eases to the action, and YOU pulses with a 3-word role tag ("You: left back").
2. **Watch (3-5 s).** The ball leaves a trail over light crowd noise.
3. **Freeze.** A whistle, and the colours dip. The key players stay lit.
4. **Move.**
   - Tap a spot (the main way) or drag.
   - Aids change by level: glow → hot/cold → none → a 5 s clock at mastery.
5. **Lock.** Two buttons, **✓ Lock it** and **? Not sure**. Both lock in, so confidence (RESEARCH §7.1 rule 12) costs no extra step.
6. **Reveal (under 2 s to take in).**
   - A ring on the best spot, and an arrow from yours.
   - 0-3 stars with a sound.
   - One line of 12 words or fewer, led by the skill icon.
   - The replay starts automatically.
7. **Next · Why? · Try again.**
   - **Why?** opens today's full panel.
   - **Try again** appears after 0-1 stars.

### 5.4 Core loop: "Who's open?" (tap-a-teammate passing, about 15 s a rep)
1. **Watch.** YOU is on the ball. Teammates move for 2-3 s, then play freezes.
2. **Choose.**
   - Tap a teammate: they are big, numbered targets.
   - Holding your finger down previews a dotted pass line. Lifting it plays the pass.
3. **Consequence.**
   - The ball travels.
   - "Cut out!": a red flash and a groan.
   - "Safe": quiet.
   - "Line broken!": a crowd lift.
4. **Reveal.**
   - Every option gets ★ Best, ✓ Good, ! Risky or ✗ Cut out.
   - Defender shadows and passing lanes are drawn.
   - Optional 0-3 "open" pips borrow FC's chemistry language [inference].
   - Then stars, one line, and Next / Why? / Try again.
5. **Later levels.** A 3-4 s clock, and "scan first" reps where some teammates appear only after a shoulder-check tap (RESEARCH §7.1 rule 14).

### 5.5 Session length
- **The unit:** a set of 5 reps, about 3 minutes, ending in **Full time**. It has a natural stop and a "Try it at training" card, like FC Futures.
- **A day's training:** 2-4 sets, about 10 minutes. This fits RESEARCH §7.1 rule 17 (10-25 minutes, 2-4 times a week).
- **Never:** autoplay into the next set, or "you'll lose your streak".
- **Calibration:** reps 4-8 of the first visit quietly calibrate the Elo with a larger K. It works like Prodigy's placement, but is never called a test.

### 5.6 Rewards, presented visually (built on what `js/rewards.js` already models)
- **Every rep:** 0-3 stars and a chime; a short confetti burst at 3 stars. A miss gets a soft "ooh" and an arrow, never a red letter.
- **Full time:**
  - The stars tally and the XP bar sweeps.
  - One card upgrades on screen (bronze → silver → gold).
  - "Your fotbol card" ticks up where it changed, with the reason shown.
- **Ranks and weeks:**
  - Ranks run Rookie → Academy → First Team → Captain → Legend, and unlock kit colours.
  - "Training days this week: ●●○". The count only ever goes up.
- **Praise and sharing:** praise names the move, never the kid. No leaderboards. A result image to share comes later, via Coach mode.

### 5.7 What moves behind Coach mode / More
- **Numbers:** scores out of 100, S-F grades, principle codes (U2, D4), the Elo, position ratings, recent reps and learning curves.
- **Text:**
  - metre-precise fixes ("Come 7 m inside"; kids get the arrow);
  - multi-reason explanations, takeaways and the legend;
  - the principle library, the reading list and the module descriptions.
- **Modes and tools:** Explore (a sandbox for coaches and curious kids), the author tool and the dev links.
- **Settings:**
  - the wording (make the simple wording the default, and call the detailed version "Coach wording");
  - theme, sound, timer and assist levels;
  - the formation name, export/import and credits;
  - later, a 9v9 option (SmartPitch shows 11-year-olds play smaller formats).
- **Keyboard help:** shown only after a key is pressed.
- **The cue question:** it becomes Hint 1, instead of a forced step after lock-in.
