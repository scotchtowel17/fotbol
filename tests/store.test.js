import { test, assert } from './harness.js';
import { createStore, PREFIX } from '../js/store.js';

/** In-memory Storage look-alike. */
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

const throwing = () => { throw new DOMException('blocked', 'SecurityError'); };

test('store: set/get round-trips JSON under the fotbol: prefix', () => {
  const ls = fakeStorage();
  const s = createStore(() => ls);
  assert.equal(s.set('settings', { theme: 'dark', n: 3 }), true);
  assert.deepEqual(s.get('settings'), { theme: 'dark', n: 3 });
  assert.equal(ls.getItem(`${PREFIX}settings`), '{"theme":"dark","n":3}');
  assert.equal(ls.getItem('settings'), null, 'never writes unprefixed keys');
});

test('store: missing or corrupt values return the fallback', () => {
  const ls = fakeStorage({ 'fotbol:bad': '{not json' });
  const s = createStore(() => ls);
  assert.equal(s.get('nope', 42), 42);
  assert.deepEqual(s.get('bad', { ok: true }), { ok: true });
  assert.equal(s.get('nope'), null, 'default fallback is null');
});

test('store: a storage that throws on access never throws, and keeps values for the session', () => {
  const s = createStore(throwing);
  assert.equal(s.get('settings', 'fb'), 'fb');
  assert.equal(s.set('settings', { theme: 'light' }), false, 'set reports it could not persist');
  assert.deepEqual(s.get('settings'), { theme: 'light' }, 'value is still readable this session');
  assert.deepEqual(s.keys(), ['settings']);
  assert.equal(s.isPersistent(), false);
  assert.equal(s.remove('settings'), false);
  assert.equal(s.get('settings', 'gone'), 'gone');
});

test('store: after a failed write the new value is read back, not the older stored copy', () => {
  // Quota full: reads still work, so the backend keeps answering with the value saved before.
  const ls = fakeStorage();
  const s = createStore(() => ls);
  assert.equal(s.set('skills', { v: 1 }), true);
  const setItem = ls.setItem;
  ls.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  assert.equal(s.set('skills', { v: 2 }), false);
  assert.deepEqual(s.get('skills'), { v: 2 }, 'memory mirror wins for a key whose write failed');
  assert.deepEqual(s.exportAll(), { 'fotbol:skills': { v: 2 } });
  // Once a write succeeds again the backend is the source of truth.
  ls.setItem = setItem;
  assert.equal(s.set('skills', { v: 3 }), true);
  ls.setItem('fotbol:skills', '{"v":4}'); // e.g. another tab
  assert.deepEqual(s.get('skills'), { v: 4 });
});

test('store: quota errors on write return false', () => {
  const ls = fakeStorage();
  ls.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  const s = createStore(() => ls);
  assert.equal(s.set('big', [1, 2, 3]), false);
  assert.equal(s.isPersistent(), false);
});

test('store: unserialisable values are refused, not thrown', () => {
  const s = createStore(() => fakeStorage());
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(s.set('x', cyclic), false);
  assert.equal(s.set('y', undefined), false);
  assert.equal(s.get('x', 'none'), 'none');
});

test('store: exportAll returns only fotbol: keys, parsed', () => {
  const ls = fakeStorage({ 'fotbol:a': '1', 'fotbol:b': '{"k":[1,2]}', other: '"x"', 'fotbol:raw': 'not-json' });
  const out = createStore(() => ls).exportAll();
  assert.deepEqual(out, { 'fotbol:a': 1, 'fotbol:b': { k: [1, 2] }, 'fotbol:raw': 'not-json' });
});

test('store: importAll validates the prefix, writes, and round-trips with exportAll', () => {
  const src = createStore(() => fakeStorage());
  src.set('settings', { wording: 'kid' });
  src.set('skills', { theta: { global: 0.4 } });
  const dst = fakeStorage({ 'fotbol:old': '"keep"' });
  const s = createStore(() => dst);
  const res = s.importAll({ ...src.exportAll(), evil: 1, 'fotbol:': 2 });
  assert.equal(res.written, 2);
  assert.deepEqual(res.skipped.sort(), ['evil', 'fotbol:'].sort());
  assert.equal(res.persisted, true);
  assert.deepEqual(s.get('settings'), { wording: 'kid' });
  assert.deepEqual(s.get('skills'), { theta: { global: 0.4 } });
  assert.equal(s.get('old'), 'keep', 'import merges; it does not wipe other keys');
  assert.equal(dst.getItem('evil'), null);
  assert.throws(() => s.importAll(null));
  assert.throws(() => s.importAll([1, 2]));
});

test('store: a backend that starts failing mid-session falls back to memory', () => {
  const ls = fakeStorage();
  let broken = false;
  const s = createStore(() => (broken ? throwing() : ls));
  assert.equal(s.set('a', 1), true);
  broken = true;
  assert.equal(s.get('a'), 1, 'memory mirror answers when storage disappears');
  assert.equal(s.set('b', 2), false);
  assert.equal(s.get('b'), 2);
});
