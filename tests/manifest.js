// Test files that tests.html runs. Static hosts (GitHub Pages) have no directory listing,
// so the browser runner needs this list; under `npm run serve` it also discovers files
// from the directory listing. tests/manifest.test.js fails when a tests/*.test.js file
// on disk is missing here, so add new test files to this list.
// Names listed but not (yet) on disk are reported as "not found" and do not fail the run.

export const TEST_FILES = Object.freeze([
  // engine
  'geometry.test.js',
  'formation.test.js',
  'scene.test.js',
  'timeline.test.js',
  'scenario.test.js',
  'context.test.js',
  'rules-attacking.test.js',
  'rules-defending.test.js',
  'score.test.js',
  'ghost.test.js',
  'explain.test.js',
  'elo.test.js',
  'sequence.test.js',
  'passing.test.js',
  'passdrill.test.js',
  'spotdrill.test.js',
  'cast.test.js',
  'kidscore.test.js',
  'integration.test.js',
  // data files
  'content.test.js',
  'scenarios-content.test.js',
  'copy.test.js',
  'build-index.test.js',
  'offline.test.js',
  // app plumbing and UI (pure parts)
  'store.test.js',
  'app.test.js',
  'board.test.js',
  'figures.test.js',
  'heatmap.test.js',
  'reveal.test.js',
  'session.test.js',
  'rewards.test.js',
  'celebrate.test.js',
  'player-play.test.js',
  'player-pass.test.js',
  'road.test.js',
  'road-sets-back.test.js',
  'road-sets-front.test.js',
  'player-shell.test.js',
  'manifest.test.js',
]);
