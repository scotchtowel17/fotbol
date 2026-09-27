// Tiny test harness that runs the same test files under Node (`node --test`)
// and in the browser (tests.html). In Node it delegates to node:test and
// node:assert/strict. In the browser it runs tests and reports to the page.
//
// Usage in a test file:
//   import { test, assert, approx } from './harness.js';
//   test('name', () => { assert.equal(1, 1); approx(0.1 + 0.2, 0.3); });

const isNode = typeof process !== 'undefined' && !!process.versions?.node;

let test, assert;

if (isNode) {
  const nt = await import('node:test');
  const na = await import('node:assert/strict');
  test = nt.test;
  assert = na.default;
} else {
  const results = (globalThis.__fotbolTestResults ??= []);
  const fail = (msg) => { throw new Error(msg); };
  const show = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
  const deepEq = (a, b) => show(a) === show(b);
  assert = {
    ok: (v, m) => { if (!v) fail(m || `expected truthy, got ${show(v)}`); },
    equal: (a, b, m) => { if (!Object.is(a, b)) fail(m || `expected ${show(b)}, got ${show(a)}`); },
    notEqual: (a, b, m) => { if (Object.is(a, b)) fail(m || `expected value other than ${show(b)}`); },
    deepEqual: (a, b, m) => { if (!deepEq(a, b)) fail(m || `expected ${show(b)}, got ${show(a)}`); },
    throws: (fn, _e, m) => { try { fn(); } catch { return; } fail(m || 'expected function to throw'); },
    match: (s, re, m) => { if (!re.test(s)) fail(m || `expected ${show(s)} to match ${re}`); },
  };
  test = async (name, fn) => {
    const started = performance.now();
    try {
      await fn({ skip: () => {} });
      results.push({ name, ok: true, ms: performance.now() - started });
    } catch (e) {
      results.push({ name, ok: false, error: e?.message || String(e), ms: performance.now() - started });
    }
    globalThis.dispatchEvent?.(new CustomEvent('fotbol-test', { detail: results.at(-1) }));
  };
}

/** Assert |a - b| <= eps. */
function approx(a, b, eps = 1e-6, msg) {
  if (!(Math.abs(a - b) <= eps)) throw new Error(msg || `expected ${b} ± ${eps}, got ${a}`);
}

/** Load a JSON file relative to the repo root in either environment. */
async function loadJSON(repoPath) {
  if (isNode) {
    const { readFile } = await import('node:fs/promises');
    const url = new URL(`../${repoPath}`, import.meta.url);
    return JSON.parse(await readFile(url, 'utf8'));
  }
  const res = await fetch(new URL(`../${repoPath}`, import.meta.url));
  if (!res.ok) throw new Error(`fetch ${repoPath}: ${res.status}`);
  return res.json();
}

export { test, assert, approx, loadJSON, isNode };
