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
    notDeepEqual: (a, b, m) => { if (deepEq(a, b)) fail(m || `expected something other than ${show(b)}`); },
    throws: (fn, _e, m) => { try { fn(); } catch { return; } fail(m || 'expected function to throw'); },
    doesNotThrow: (fn, m) => { try { fn(); } catch (e) { fail(m || `expected no throw, got ${e?.message ?? e}`); } },
    rejects: async (p, _e, m) => { try { await (typeof p === 'function' ? p() : p); } catch { return; } fail(m || 'expected a rejection'); },
    match: (s, re, m) => { if (!re.test(s)) fail(m || `expected ${show(s)} to match ${re}`); },
    doesNotMatch: (s, re, m) => { if (re.test(s)) fail(m || `expected ${show(s)} not to match ${re}`); },
  };
  // node:assert/strict names for the same checks.
  assert.strictEqual = assert.equal;
  assert.notStrictEqual = assert.notEqual;
  assert.deepStrictEqual = assert.deepEqual;
  assert.notDeepStrictEqual = assert.notDeepEqual;
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

/**
 * Wall-clock timing that holds up on a busy machine (`npm test` runs the test files side by side, and a laptop may be
 * doing other work): `warmup` untimed calls (the JIT), then `runs` timed runs of `reps` calls each. A busy machine only
 * ever adds time, so the median of the runs is a fair reading and the fastest run the best one. The speed tests use
 * the median with a generous bound: they catch an order-of-magnitude slowdown, not a few per cent.
 * `FOTBOL_PERF_SLACK` (Node, a number, default 1) scales every bound for a very slow machine or CI runner.
 * @returns {{ median: number, min: number, runs: number[] }}  milliseconds per call
 */
function timed(fn, { warmup = 2, runs = 7, reps = 1 } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  const ts = [];
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    for (let i = 0; i < reps; i++) fn();
    ts.push((performance.now() - t0) / reps);
  }
  const sorted = [...ts].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], runs: ts };
}

/** The factor every speed bound is multiplied by (see timed). */
const PERF_SLACK = (() => {
  const v = isNode ? Number(process.env.FOTBOL_PERF_SLACK) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 1;
})();

export { test, assert, approx, loadJSON, isNode, timed, PERF_SLACK };
