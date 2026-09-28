# fotbol

**Learn where to stand.** fotbol is a free browser game that teaches football (soccer) positioning. You take one position in a 4-3-3, watch a passage of play unfold, and when it freezes you drag yourself to where you should be. fotbol scores your spot out of 100, shows you the best spot, and tells you *why* in one plain sentence tied to a named principle, such as "cover at an angle" or "tuck in when the ball is on the far side".

**▶ Play it now: <https://scotchtowel17.github.io/fotbol/>** (works on phones, tablets and computers)

No account, no ads, no tracking. Your progress stays in your browser.

![A drill after the reveal: the left back has not tucked in far enough. The panel shows the grade (B, 76/100), the two reasons with their principles (U2 slide, don't cross; D4 weak side tucks in) and the fix, "Come 7 m inside". On the pitch, an arrow runs from the player to the best spot.](docs/screenshots/drill-reveal.png)

## How to play

Pick your position on the home page (you can change it any time), then choose a way to play:

- **Learn** is a seven-step guided tour of the pitch: thirds, lanes and half-spaces, your job around the ball, goal-side and the offside line. Start here if you are new.
- **Explore** lets you drag the ball anywhere and find your best spot. The score, the "why" and your job update as you move.
- **Drill** is the heart of fotbol. Each of the 36 authored situations follows the same six steps: watch the play, freeze, place yourself, answer a cue question, see the best spot and the reasons, then replay what happens next. A session is six reps, with a summary at the end.
- **Live** is 45 or 60 seconds of continuous play. You keep adjusting while you are scored ten times a second, then you replay your three toughest moments.
- **Progress** shows your level, stars for each principle, streaks, your position ratings and recent reps. You can export your progress to a file and import it on another device.

Drills come in three modules:

- **M1 Pressure, cover and balance** covers defending as a unit of three.
- **M2 Support, width and depth** covers helping the player on the ball.
- **M3 Team shape** covers moving as one block.

Every text has a **Kid** wording (open the settings menu), and there are light and dark themes. fotbol works with a keyboard: Tab to your player, move with the arrow keys (hold Shift for bigger steps), and press Enter to lock in. It also respects your device's reduced-motion setting and works on a phone: players are drawn big enough to read their shirts, a drill zooms in on the part of the pitch where its play happens, and on a touch screen you can drag yourself or tap yourself and then tap a spot. Leave a drill session half-way (to check your stars, say) and it offers to carry on where you left off.

## The research behind it

fotbol is built on a research report: [docs/RESEARCH.md](docs/RESEARCH.md). In short:

- **Nothing like it existed.** Existing tools are either multiple-choice "soccer IQ" quizzes or tactics boards with no right answer. None combines one assigned role, a moving scene, a free drag-to-place answer, a visible ideal zone and a principle-based "why".
- **Place, don't pick.** Training transferred better when learners answered with a movement-like response rather than by choosing an option. Freezing play just before the decisive moment and then replaying it is one of the best-supported video-training methods.
- **Explain, don't just correct.** High-information feedback that says why beats a bare right or wrong. fotbol first asks a cue question ("If your left-back gets beaten, who is there to stop the carrier?") and only then states the principle and the fix.
- **Aim for about 3 in 4.** Difficulty adapts per principle and per position with an Elo rating that targets roughly 75% success. Look-alike situations, such as cover versus balance or pressing versus dropping, are mixed together once the basics are in place.
- **Mastery, not points.** fotbol shows a star meter for each principle and asks you to rate your confidence, because a confident mistake is the one you learn most from. There are no leaderboards, no volume badges and no data collection. Almost every distance in the engine is a labelled default waiting for coach review, and the report says so.

### Best resources to learn positioning

These are the first five entries of fotbol's reading list (`data/resources.json`, also at `#/learn/resources` in the app):

1. [US Youth Soccer ODP Player Manual](https://www.usyouthsoccer.org/wp-content/uploads/sites/160/2023/09/Player-Manual-US-Youth-Soccer-ODP.pdf) (free). A short manual written for players, with ten principles of play as simple rules.
2. [U.S. Soccer Coaching Curriculum (2011)](https://cdn2.sportngin.com/attachments/document/0073/5091/Full_U.S._Soccer_Coaching_Curriculumnew.pdf) (free). Diagrammed definitions of support, width, depth, pressure, cover, balance and compactness. These are the words fotbol uses in its feedback.
3. [Coaches' Voice: football tactics explained](https://learning.coachesvoice.com/cv/glossary-football-tactics-coaching/) (free, with some members-only explainers). Covers blocks, half-spaces, rest defence and pressing.
4. [The Football Analyst: football tactics explained](https://the-footballanalyst.com/pressing-triggers-football-tactics-explained/) (free). Plain-language tactics articles.
5. [Soccer iQ, volumes 1 and 2](https://www.goodreads.com/book/show/21451166-soccer-iq) (Dan Blank, book). Short, rule-like chapters on game habits for players.

## How it works

The engine lives in `js/engine/`. It is plain JavaScript that runs the same in the browser and in Node. It judges a spot in three layers:

1. **Where your position usually stands (layer A).** A formation table gives all 11 positions for any ball position. It is converted from the open-source HELIOS robot-football team, interpolated with a Delaunay triangulation, and adjusted for in- and out-of-possession shape. This spot is the centre of your zone.
2. **What the situation asks of you (layer B).** First, fotbol works out your job from the ball: first, second or third defender, or supporting attacker. Then 17 small geometric rules check the principles that apply, for example "goal-side of your man", "cover behind and inside the presser", "level with your back line", "out of the passing shadow" or "stay onside". Each rule gives a 0-1 score and a sentence.
3. **The best spot (layer C).** A grid search around your zone finds the highest-scoring spot. That spot is the ghost ring you see after the reveal, drawn over a heatmap.

Your score is 55% "how close to your zone" and 45% "which principles you met". Breaking a hard rule, such as being offside or playing their striker onside, caps it at 59. The other 21 players move automatically as an authored ball path plays out, so each drill is a moving scene with no physics engine behind it.

## Run it locally

fotbol has no build step and no dependencies. Serve the folder with any static web server:

```bash
npm run serve          # python3 -m http.server 8080, then open http://localhost:8080
npm test               # every test with node --test (Node 22 or later); tests.html runs the same files in a browser
npm run check          # validate every scenario, print the engine's answer, and check that data/scenarios/index.json is current
npm run index          # rebuild data/scenarios/index.json after adding or changing a scenario
npm run sanity         # rewrite docs/sanity-output.txt: the engine's answers on the canonical situations, for coach review
```

`#/dev` is the engine playground. It shows the ghost, the heatmap and the live score while you drag yourself or the ball. The settings menu links to it and to `tests.html` only when the address has `?dev` (for example `http://localhost:8080/?dev#/home`), so learners never land in developer tools by accident.

## For contributors and coding agents

Start with [AGENTS.md](AGENTS.md) (commands, hard rules, where things live), then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (the binding module contracts and data shapes) and [docs/ROADMAP.md](docs/ROADMAP.md) (status, what's next, known issues).

To add a scenario:

1. Open `#/author` in the app. Script the ball, override the players who create the situation, and set when play freezes.
2. Read the engine's answer in the Answer tab. It warns you when the drill is trivial, when the principle is not actually tested, or when the best spot does not score an S.
3. Write the brief, question, takeaway and misconceptions in both Standard and Kid wording. The text must never name a side, because every scenario is also played mirrored.
4. Check it with **Play as learner**.
5. Download the JSON to `data/scenarios/<id>.json` and add the id to its module in `data/curriculum.json`.
6. Run `npm run index`, `npm run check` and `npm test`. Every scenario must give an S-grade best spot at least 5 m from where you start, and must pass the copy rules in `tests/scenarios-content.test.js`.

## Credits and licence

fotbol is MIT-licensed ([LICENSE](LICENSE)). It uses:

- formation data converted from [HELIOS Base](https://github.com/helios-base/helios-base) (MIT);
- [Delaunator](https://github.com/mapbox/delaunator) (ISC);
- [robust-predicates](https://github.com/mourner/robust-predicates) (Unlicense).

The details and attributions are in [THIRD_PARTY.md](THIRD_PARTY.md) and on the in-app `#/credits` page. The football ideas are paraphrased from the coaching literature listed in [docs/RESEARCH.md](docs/RESEARCH.md) §10. Nothing is copied, and every principle page links to its sources.
