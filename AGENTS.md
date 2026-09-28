# Guide for coding agents

fotbol is a zero-build browser app that teaches soccer positioning. The learner takes a role, watches play unfold, drags themselves to where they should be, and is scored and told *why*.

Read these first:
1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module contracts, data shapes, the coordinate frame. **Binding.**
2. [docs/RESEARCH.md](docs/RESEARCH.md): the research the design is based on. Section 5 covers the scoring model and section 8 the principle catalogue, whose IDs are used everywhere. Section 9 has the MVP spec and roadmap.
3. [docs/ROADMAP.md](docs/ROADMAP.md): what is done, what is next, known issues.

## Commands

```bash
npm test            # node --test on tests/**/*.test.js (Node >= 22: the quoted glob needs it; CI runs 22; no dependencies)
npm run check       # validate every scenario, print the engine's answer, fail the drill-quality gates, check the index is current
npm run index       # rebuild data/scenarios/index.json (never edit it by hand)
npm run serve       # python3 -m http.server 8080  → http://localhost:8080
npm run sanity      # node scripts/sanity.mjs > docs/sanity-output.txt: the engine's answers on the canonical situations, for coach review
```

`tests.html` runs the same test files in a browser. `#/dev` is the engine playground: a real scene, the ghost and heatmap, and a live score while you drag yourself or the ball. After any change to layer A or a rule, `tests/integration.test.js` must stay green (every canonical situation and role still gets an S-grade ghost), `npm run check` must stay green (every authored drill still has an S answer where the coach keyed it), and the sanity report should be regenerated.

## Hard rules

- **No build step, no dependencies in `package.json`.** Third-party code is vendored under `vendor/<name>/`, with its LICENSE file and an entry in `THIRD_PARTY.md`. Only permissive licences are allowed (MIT, ISC, BSD, Apache-2.0, Unlicense, CC0).
- **`js/engine/` is pure.** No DOM, no `fetch`, no `localStorage`, no `Date.now()` inside scoring. The UI passes data in.
- **One coordinate frame.** Metres on a 105 x 68 pitch. x = 0 is our goal line and "us" always attacks +x. y = 0 is our left touchline. Never mix screen coordinates into the engine.
- **Every tunable number** lives in a `*_DEFAULTS` or `PARAMS` object, tagged `[D]` (default guess), `[S]` (sourced) or `[M]` (measured).
- **Every rule maps to principle IDs** from `data/principles.json`. Feedback text is second person, one sentence, in football language ("drop deeper", "tuck in", "get goal-side"), never screen directions.
- **Copyright:** never paste text from coaching books, sites or PDFs. Paraphrase, and link out in `learnMore`.
- **Privacy:** no analytics, accounts or third-party requests. Progress stays in `localStorage`.
- Keep `docs/ARCHITECTURE.md` in sync when you change a contract, and `docs/ROADMAP.md` when you finish or discover work.

## Where things live

| Want to... | Look at |
|---|---|
| Change where players stand by default | `data/formations/helios-433.json`, `js/engine/formation.js` (`phaseShape`), `js/engine/scene.js` |
| Run the whole loop for one scene | `js/engine/analyse.js` (`analyseScene`, `judgeSpot`); canonical situations in `tests/situations.js` |
| Change how a position is judged | `js/engine/rules/*.js`, `js/engine/score.js` |
| Change feedback wording | the `text` block of each rule, `js/engine/explain.js` |
| Add or fix a scenario | `#/author` in the app, then `data/scenarios/<id>.json`, its module in `data/curriculum.json`, `npm run index`, `npm run check` (ARCHITECTURE §6) |
| Change a mode (Drill, Live, Explore, Learn...) | `js/ui/modes/<mode>.js`; shared pieces in `js/ui/reveal.js` (feedback panel) and `js/ui/session.js` (selection, persistence, summaries) |
| Change the curriculum | `data/curriculum.json`, `data/principles.json` |
| Change the look | `css/app.css` (tokens at the top), `js/ui/board.js` |
