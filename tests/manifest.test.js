import { test, assert, isNode } from './harness.js';
import { TEST_FILES } from './manifest.js';

test('manifest: entries are unique *.test.js file names', () => {
  assert.ok(TEST_FILES.length > 0);
  assert.equal(new Set(TEST_FILES).size, TEST_FILES.length, 'no duplicates');
  for (const f of TEST_FILES) assert.match(f, /^[a-z0-9-]+\.test\.js$/, `bad manifest entry ${f}`);
});

test('manifest: every tests/*.test.js on disk is listed (so tests.html runs it on static hosts)', async () => {
  if (!isNode) return; // needs the file system; the browser runner reports unlisted files itself
  const { readdir } = await import('node:fs/promises');
  const onDisk = (await readdir(new URL('./', import.meta.url))).filter((f) => f.endsWith('.test.js'));
  const unlisted = onDisk.filter((f) => !TEST_FILES.includes(f));
  assert.deepEqual(unlisted, [], `add these to tests/manifest.js: ${unlisted.join(', ')}`);
});

test('package.json: the Node engine is one that runs `npm test` (CI uses the same major)', async () => {
  if (!isNode) return; // reads repo files
  const { readFile } = await import('node:fs/promises');
  const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
  const pkg = JSON.parse(await read('package.json'));
  const min = Number(/>=\s*(\d+)/.exec(pkg.engines.node)?.[1]);
  // `node --test "<glob>"` needs Node 22: Node 20's runner takes only file and directory paths.
  if (/node --test\s+"[^"]*\*/.test(pkg.scripts.test)) assert.ok(min >= 22, `engines.node ${pkg.engines.node} but the test script passes a glob`);
  const ci = Number(/node-version:\s*(\d+)/.exec(await read('.github/workflows/ci.yml'))?.[1]);
  assert.equal(ci, min, 'CI tests the oldest supported Node');
});
