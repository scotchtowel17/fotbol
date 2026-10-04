#!/usr/bin/env node
// Build offline.json: the files the service worker (sw.js) caches when it installs, so the whole app plays offline
// after one visit, not only the screens already opened.
//
//   node scripts/build-offline.mjs            write offline.json
//   node scripts/build-offline.mjs --check    exit 1 if offline.json is missing or out of date (writes nothing)
//
// The list is every file the app can load: index.html, the manifest, and everything under js/, css/, data/, assets/
// and vendor/ (licences and readmes included: the credits page links them), sorted, as paths relative to the site
// root. Tests, scripts and docs are left out. The pure part (offlineList) runs anywhere; run() touches the file system.

export const OFFLINE_FILE = 'offline.json';
export const OFFLINE_ROOTS = Object.freeze(['js', 'css', 'data', 'assets', 'vendor']);
export const OFFLINE_FILES = Object.freeze(['index.html', 'manifest.webmanifest']);

/** The sorted list of site paths from a list of repo-relative files. */
export function offlineList(files) {
  const keep = files.filter((f) => OFFLINE_FILES.includes(f) || OFFLINE_ROOTS.some((r) => f.startsWith(`${r}/`)))
    .filter((f) => !/(^|\/)\./.test(f)); // no dotfiles
  return [...new Set(keep)].sort();
}

export function serializeOffline(list) {
  return `${JSON.stringify({ version: 1, generated: 'by scripts/build-offline.mjs', files: list }, null, 1)}\n`;
}

export async function run({ root = '.', check = false, log = console.log } = {}) {
  const { readdir, readFile, writeFile } = await import('node:fs/promises');
  const { join, relative } = await import('node:path');
  const walk = async (dir) => {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...await walk(p));
      else out.push(relative(root, p).split('\\').join('/'));
    }
    return out;
  };
  const files = [...OFFLINE_FILES];
  for (const r of OFFLINE_ROOTS) files.push(...await walk(join(root, r)));
  const text = serializeOffline(offlineList(files));
  const path = join(root, OFFLINE_FILE);
  if (check) {
    let current = '';
    try { current = await readFile(path, 'utf8'); } catch { /* missing */ }
    if (current !== text) { log(`✗ ${OFFLINE_FILE} is out of date: run npm run offline`); return 1; }
    log(`✓ ${OFFLINE_FILE} is up to date (${JSON.parse(text).files.length} files)`);
    return 0;
  }
  await writeFile(path, text);
  log(`wrote ${OFFLINE_FILE} (${JSON.parse(text).files.length} files)`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await run({ check: process.argv.includes('--check') }));
