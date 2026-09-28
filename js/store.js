// localStorage wrapper. Contract: docs/ARCHITECTURE.md §5.9.
//
// Every key is stored under the 'fotbol:' prefix as JSON. Every storage access is
// wrapped in try/catch: private windows, blocked site data and quota errors must
// never break the app. When the backend throws, values written this session are
// kept in memory so the app still behaves, but set() reports false (not persisted).
// A value whose write failed is read back from memory even if the backend still
// holds an older copy (e.g. a quota error on a key that was saved earlier).

export const PREFIX = 'fotbol:';

/** Default backend: window.localStorage, resolved lazily because even reading the property can throw. */
const defaultBackend = () => globalThis.localStorage;

/**
 * Build a store over any Storage-like backend (getItem/setItem/removeItem/key/length).
 * @param {() => Storage} [getBackend] called on every access (so a later-blocked storage is handled)
 */
export function createStore(getBackend = defaultBackend) {
  const memory = new Map(); // full key → JSON string
  // Keys whose last write did not reach the backend (quota full, storage blocked): the backend may
  // still answer reads with an OLDER value, so the memory mirror wins for them until a write succeeds.
  const dirty = new Set();

  const backend = () => {
    const b = getBackend();
    if (!b) throw new Error('no storage');
    return b;
  };

  /** Full ('fotbol:'-prefixed) keys currently stored, backend first, memory as fallback. */
  function fullKeys() {
    const out = new Set();
    try {
      const b = backend();
      for (let i = 0; i < b.length; i++) {
        const k = b.key(i);
        if (k && k.startsWith(PREFIX)) out.add(k);
      }
    } catch { /* fall through to memory */ }
    for (const k of memory.keys()) out.add(k);
    return [...out];
  }

  function readRaw(fullKey) {
    if (dirty.has(fullKey)) return memory.get(fullKey);
    try {
      const v = backend().getItem(fullKey);
      if (v !== null) return v;
    } catch { /* use memory */ }
    return memory.has(fullKey) ? memory.get(fullKey) : null;
  }

  function writeRaw(fullKey, json) {
    memory.set(fullKey, json);
    try {
      backend().setItem(fullKey, json);
      dirty.delete(fullKey);
      return true;
    } catch {
      dirty.add(fullKey);
      return false;
    }
  }

  return {
    /** Parsed JSON for `key`, or `fallback` when missing, unreadable or corrupt. */
    get(key, fallback = null) {
      const raw = readRaw(PREFIX + key);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },

    /** Store `value` as JSON. @returns {boolean} false if it could not be persisted. */
    set(key, value) {
      let json;
      try {
        json = JSON.stringify(value);
      } catch {
        return false;
      }
      if (json === undefined) return false;
      return writeRaw(PREFIX + key, json);
    },

    /** Remove `key`. @returns {boolean} false if the backend refused. */
    remove(key) {
      memory.delete(PREFIX + key);
      dirty.delete(PREFIX + key);
      try {
        backend().removeItem(PREFIX + key);
        return true;
      } catch {
        return false;
      }
    },

    /** Unprefixed keys currently stored. */
    keys() {
      return fullKeys().map((k) => k.slice(PREFIX.length));
    },

    /** Every stored value, keyed by its full 'fotbol:' key (unparseable values are kept as strings). */
    exportAll() {
      const out = {};
      for (const k of fullKeys().sort()) {
        const raw = readRaw(k);
        if (raw === null) continue;
        try {
          out[k] = JSON.parse(raw);
        } catch {
          out[k] = raw;
        }
      }
      return out;
    },

    /**
     * Write an exportAll() object back. Keys without the 'fotbol:' prefix are rejected.
     * @returns {{ written: number, skipped: string[], persisted: boolean }}
     */
    importAll(obj) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new TypeError('importAll expects an object of fotbol: keys');
      const skipped = [];
      let written = 0, persisted = true;
      for (const [k, v] of Object.entries(obj)) {
        if (!k.startsWith(PREFIX) || k.length === PREFIX.length) { skipped.push(k); continue; }
        let json;
        try { json = JSON.stringify(v); } catch { skipped.push(k); continue; }
        if (json === undefined) { skipped.push(k); continue; }
        if (!writeRaw(k, json)) persisted = false;
        written++;
      }
      return { written, skipped, persisted };
    },

    /** True when the backend accepts a write/remove round trip right now. */
    isPersistent() {
      try {
        const b = backend();
        const probe = PREFIX + '__probe__';
        b.setItem(probe, '1');
        b.removeItem(probe);
        return true;
      } catch {
        return false;
      }
    },
  };
}

const store = createStore();

export const get = store.get;
export const set = store.set;
export const remove = store.remove;
export const keys = store.keys;
export const exportAll = store.exportAll;
export const importAll = store.importAll;
export const isPersistent = store.isPersistent;
