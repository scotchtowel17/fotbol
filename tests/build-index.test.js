// scripts/build-index.mjs: the scenario index (data/scenarios/index.json) the app loads.
import { test, assert, loadJSON, isNode } from './harness.js';
import {
  INDEX_VERSION, INDEX_GENERATED, naturalCompare, scenarioFiles, indexEntry, sortEntries,
  buildIndex, serializeIndex, diffIndex,
} from '../scripts/build-index.mjs';

const example = await loadJSON('data/scenarios/_example.json');
const passDrill = await loadJSON('data/scenarios/pa8-lb-01.json');
const principles = await loadJSON('data/principles.json');
const clone = (v) => JSON.parse(JSON.stringify(v));

/** A valid scenario like the example, with its own id and module. */
function scenario(id, module = 'M1', patch = {}) {
  return { ...clone(example), id, module, ...patch };
}
const item = (s, file = `${s.id}.json`) => ({ file, scenario: s });

test('build-index: natural order puts M2 before M10 and a-2 before a-10', () => {
  const sorted = ['M10', 'M2', 'M1', 'b', 'a-10', 'a-2'].sort(naturalCompare);
  assert.deepEqual(sorted, ['M1', 'M2', 'M10', 'a-2', 'a-10', 'b']);
  assert.equal(naturalCompare('x', 'x'), 0);
});

test('build-index: only scenario files are indexed (no index.json, no _templates, no other files)', () => {
  const names = ['index.json', '_example.json', 'b-2.json', 'a.json', 'notes.md', 'b-10.json', '.DS_Store'];
  assert.deepEqual(scenarioFiles(names), ['a.json', 'b-2.json', 'b-10.json']);
});

test('build-index: an entry keeps what menus need, from the example scenario', () => {
  const e = indexEntry(example, 'x.json');
  assert.deepEqual(e, {
    id: 'example-d3-cover-lcb', file: 'x.json', title: 'Cover your centre-back partner', module: 'M1',
    moment: 'out_of_possession', phase: 'mid_block', principles: ['D3', 'R1'], role: 'LCB', difficulty: 0,
  });
  const bare = indexEntry({ id: 'bare', title: 'Bare', moment: 'in_possession', principles: ['B1'], learner: { role: 'LW' } }, 'bare.json');
  assert.deepEqual([bare.module, bare.phase, bare.difficulty], [null, null, 0], 'missing optional fields are null, difficulty defaults to 0');
});

test('build-index: rows sort by module (natural order, none last), then file name', () => {
  const rows = [
    { module: 'M10', file: 'a.json' }, { module: null, file: 'a.json' }, { module: 'M2', file: 'b.json' },
    { module: 'M2', file: 'a-10.json' }, { module: 'M2', file: 'a-2.json' }, { module: 'M1', file: 'z.json' },
  ];
  assert.deepEqual(sortEntries(rows).map((r) => `${r.module}/${r.file}`), ['M1/z.json', 'M2/a-2.json', 'M2/a-10.json', 'M2/b.json', 'M10/a.json', 'null/a.json']);
});

test('build-index: valid scenarios make a sorted index; version and generated note are set', () => {
  const { index, errors, warnings } = buildIndex([item(scenario('m2-b', 'M2')), item(scenario('m1-b')), item(scenario('m1-a'))], { principles });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(index.version, INDEX_VERSION);
  assert.equal(index.generated, INDEX_GENERATED);
  assert.deepEqual(index.scenarios.map((r) => r.id), ['m1-a', 'm1-b', 'm2-b']);
});

test('build-index: an invalid scenario is an error naming the file, and is left out of the index', () => {
  const bad = scenario('bad-one');
  bad.timeline.freezeAt = 99;
  const { index, errors } = buildIndex([item(scenario('good-one')), item(bad), { file: 'broken.json', error: 'not valid JSON (Unexpected token)' }], { principles });
  assert.ok(errors.some((e) => e.startsWith('bad-one.json: timeline.freezeAt')), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('broken.json: not valid JSON')));
  assert.deepEqual(index.scenarios.map((r) => r.id), ['good-one']);
});

test('build-index: principle IDs are checked against the catalogue when given', () => {
  const s = scenario('unknown-principle', 'M1', { principles: ['D3', 'Z9'] });
  assert.ok(buildIndex([item(s)], { principles }).errors.some((e) => e.includes('Z9')));
  assert.deepEqual(buildIndex([item(s)]).errors, [], 'without a catalogue only the shape is checked');
});

test('build-index: two files with the same id is an error naming both files', () => {
  const { errors, index } = buildIndex([item(scenario('twin'), 'twin.json'), item(scenario('twin'), 'twin-copy.json')], { principles });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /twin-copy\.json: id "twin" is already used by twin\.json/);
  assert.equal(index.scenarios.length, 1);
});

test('build-index: warnings (file name vs id, curriculum listing) do not fail the build', () => {
  const curriculum = { modules: [{ id: 'M1', scenarios: ['listed', 'ghost-id'] }, { id: 'M2', scenarios: [] }] };
  const { errors, warnings } = buildIndex([
    item(scenario('listed'), 'listed.json'),
    item(scenario('renamed'), 'other-name.json'),
    item(scenario('in-m2', 'M2')),
    item(scenario('no-such-module', 'M9')),
  ], { principles, curriculum });
  assert.deepEqual(errors, []);
  const has = (re) => warnings.some((w) => re.test(w));
  assert.ok(has(/other-name\.json: the file name does not match its id "renamed"/), warnings.join('\n'));
  assert.ok(has(/other-name\.json: M1 does not list "renamed"/));
  assert.ok(has(/in-m2\.json: M2 does not list "in-m2"/));
  assert.ok(has(/no-such-module\.json: module "M9" is not in data\/curriculum\.json/));
  assert.ok(has(/M1 lists "ghost-id", but no valid scenario has that id/));
  assert.ok(!has(/listed\.json:/), 'a listed scenario whose file matches its id has no warning');
});

test('build-index: authored pass drills are validated as pass drills and listed apart, under passes', () => {
  const p = { ...clone(passDrill), id: 'pa-x' };
  const { errors, warnings, index } = buildIndex([item(scenario('m1-a')), item(p)], { principles, curriculum: { modules: [{ id: 'M1', scenarios: ['m1-a'] }] } });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [], 'a pass drill is in no curriculum module, and that is no warning');
  assert.deepEqual(index.scenarios.map((r) => r.id), ['m1-a'], 'the spot list never holds a pass drill');
  assert.deepEqual(index.passes, [{ id: 'pa-x', file: 'pa-x.json', title: p.title, principles: ['PA8', 'PA4'], role: 'LB', difficulty: 0 }]);
  const text = serializeIndex(index);
  assert.deepEqual(JSON.parse(text), index);
  assert.deepEqual(diffIndex(JSON.parse(text), index), []);
  assert.ok(diffIndex({ ...JSON.parse(text), passes: [] }, index).some((d) => /passes/.test(d)), 'a missing pass row is stale');
  assert.equal('passes' in buildIndex([item(scenario('m1-a'))], { principles }).index, false, 'no passes list without a pass drill');
  // A pass drill is checked with the pass drill rules: the learner must be on the ball at the freeze.
  const bad = clone(p);
  bad.timeline.carrier = bad.timeline.carrier.slice(0, 2);
  assert.ok(buildIndex([item(bad)], { principles }).errors.some((e) => /must have the ball at the freeze/.test(e)));
});

test('build-index: the file text is JSON, one scenario per line, with a trailing newline', () => {
  const { index } = buildIndex([item(scenario('m1-a')), item(scenario('m2-a', 'M2'))], { principles });
  const text = serializeIndex(index);
  assert.deepEqual(JSON.parse(text), index);
  assert.ok(text.endsWith('}\n'));
  const lines = text.split('\n').filter((l) => l.includes('"id"'));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^ {4}\{ "id": "m1-a", "file": "m1-a\.json", .*"principles": \["D3", "R1"\], "role": "LCB", "difficulty": 0 \},$/);
  assert.deepEqual(JSON.parse(serializeIndex({ version: 1, generated: INDEX_GENERATED, scenarios: [] })).scenarios, []);
});

test('build-index: diffIndex reports missing, stale and extra rows, and nothing when up to date', () => {
  const { index } = buildIndex([item(scenario('a')), item(scenario('b'))], { principles });
  assert.deepEqual(diffIndex(JSON.parse(serializeIndex(index)), index), []);
  assert.equal(diffIndex(null, index).length, 1);
  const stale = clone(index);
  stale.scenarios[0].title = 'Old title';
  stale.scenarios.pop();
  stale.scenarios.push({ id: 'gone', file: 'gone.json' });
  const diff = diffIndex(stale, index);
  assert.ok(diff.includes('out of date: a'), diff.join('\n'));
  assert.ok(diff.includes('missing: b (b.json)'));
  assert.ok(diff.includes('no longer a valid scenario file: gone'));
  const reordered = clone(index);
  reordered.scenarios.reverse();
  assert.deepEqual(diffIndex(reordered, index), ['the order differs (module, then file name)']);
});

test('build-index: the command writes, checks, and refuses invalid folders (temporary folder)', async () => {
  if (!isNode) return; // file system
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { run } = await import('../scripts/build-index.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'fotbol-index-'));
  const url = pathToFileURL(`${dir}/`);
  const out = [];
  const opts = { dir: url, principles, curriculum: null, log: (s) => out.push(s), warn: (s) => out.push(s) };
  try {
    await writeFile(join(dir, 'm2-a.json'), JSON.stringify(scenario('m2-a', 'M2')));
    await writeFile(join(dir, 'm1-a.json'), JSON.stringify(scenario('m1-a')));
    await writeFile(join(dir, '_template.json'), '{ not json');
    assert.equal(await run({ ...opts, check: true }), 1, 'check fails while index.json is missing');
    assert.equal(await run(opts), 0);
    const written = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
    assert.deepEqual(written.scenarios.map((r) => r.file), ['m1-a.json', 'm2-a.json'], '_template.json skipped');
    assert.equal(await run({ ...opts, check: true }), 0, 'up to date after writing');

    await writeFile(join(dir, 'm1-b.json'), JSON.stringify(scenario('m1-b')));
    assert.equal(await run({ ...opts, check: true }), 1, 'a new scenario makes the index stale');
    const bad = scenario('m1-c');
    bad.learner.role = 'GK';
    await writeFile(join(dir, 'm1-c.json'), JSON.stringify(bad));
    assert.equal(await run(opts), 1, 'an invalid scenario fails the build');
    const after = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
    assert.equal(after.scenarios.length, 2, 'and nothing is written');
    assert.ok(out.some((s) => s.includes('m1-c.json: learner.role')), out.join('\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('build-index: data/scenarios/index.json matches the scenario files (run node scripts/build-index.mjs)', async () => {
  if (!isNode) return; // file system
  const { readdir, readFile } = await import('node:fs/promises');
  const folder = new URL('../data/scenarios/', import.meta.url);
  const files = scenarioFiles(await readdir(folder));
  const items = await Promise.all(files.map(async (file) => ({ file, scenario: JSON.parse(await readFile(new URL(file, folder), 'utf8')) })));
  const { index, errors } = buildIndex(items, { principles });
  assert.deepEqual(errors, [], 'every scenario file is valid');
  let current = null;
  try { current = JSON.parse(await readFile(new URL('index.json', folder), 'utf8')); } catch { /* missing */ }
  if (!files.length && !current) return; // nothing authored yet: the app tolerates a missing index
  assert.deepEqual(diffIndex(current, index), [], 'data/scenarios/index.json is stale: run node scripts/build-index.mjs');
});
