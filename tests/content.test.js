// Learning-content checks: data/principles.json, curriculum.json, tutorial.json, resources.json.
// Beyond shape, these pin the content to docs/RESEARCH.md: section 8 rows (names, levels,
// releases, sources), the section 5.5 rule map, the 9.2 module lists and the verified links
// in section 10. The passing principles (PA1-PA15) are pinned to docs/research/passing.md
// section 2 (releases, sources) and its section 7 links instead. Tutorial steps are also
// checked for tactical sense in the canonical frame.

import { test, assert, loadJSON, isNode } from './harness.js';
import { FAMILIES, LEARNABLE_ROLES, ROLE_INFO, ROLES, BACK_LINE, parsePlayerId } from '../js/engine/roles.js';
import { onPitch, laneOf, THIRD_EDGES, HALF_X, LENGTH, WIDTH, OWN_GOAL } from '../js/engine/pitch.js';
import { dist } from '../js/engine/geometry.js';

async function loadText(repoPath) {
  const url = new URL(`../${repoPath}`, import.meta.url);
  if (isNode) return (await import('node:fs/promises')).readFile(url, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${repoPath}: ${res.status}`);
  return res.text();
}

const [principleData, curriculum, tutorial, resources, research, passingResearch] = await Promise.all([
  loadJSON('data/principles.json'),
  loadJSON('data/curriculum.json'),
  loadJSON('data/tutorial.json'),
  loadJSON('data/resources.json'),
  loadText('docs/RESEARCH.md'),
  loadText('docs/research/passing.md'),
]);
const principles = principleData.principles;
const byId = Object.fromEntries(principles.map((p) => [p.id, p]));

/** The 17 v1 engine rules and the principles each checks (RESEARCH 5.5, "Section 8 ref" column). */
const RULE_REFS = {
  offside: ['F4'], 'keeps-onside': ['U4'], 'level-line': ['U4'], 'goal-side': ['D5'], press: ['D1', 'D2', 'T2'],
  cover: ['D3'], tuck: ['D4', 'U5'], compact: ['U1', 'U2'], screen: ['R3'], width: ['B1'], pin: ['B2'],
  'lane-open': ['B3'], 'support-distance': ['B3', 'B4'], occupancy: ['B5'], 'between-lines': ['P2'], spacing: ['F8'],
  'box-fill': ['P10'], recovery: ['T3', 'R4'], 'half-space': ['P1'], 'flank-share': ['B6'],
  'cross-defence': ['U8'], 'drop-narrow': ['T2'], 'line-height': ['U3'], concentration: ['U7'], unity: ['B12'],
};
const ENGINE_RULE_IDS = Object.keys(RULE_REFS);

/** ID prefix → row count, category and RESEARCH subsection. */
const PREFIX = {
  F: [8, 'foundations', '8.1'], B: [12, 'in_possession', '8.2'], P: [13, 'in_possession', '8.3'],
  T: [4, 'transition', '8.4'], D: [9, 'out_of_possession', '8.5'], U: [8, 'team_shape', '8.6'],
  R: [5, 'role', '8.7'], G: [4, 'goalkeeper', '8.8'], S: [7, 'set_piece', '8.9'],
  PA: [15, 'passing', 'research/passing.md §2'],
};
const prefixOf = (id) => id.replace(/\d+$/, '');
const TOTAL = Object.values(PREFIX).reduce((n, [count]) => n + count, 0);
const RELEASES = ['v1', 'v1.1', 'v2', 'v3'];

/** Never linked from the app: marked confidential (U17 plan), or carries betting content (RESEARCH 2.4, 2.7). */
const DO_NOT_LINK = [
  'https://www.alsoccer.org/wp-content/uploads/sites/282/2024/10/US-Soccer-Player-Development-Framework-U17-Learning-Plan.pdf',
  'https://totalfootballanalysis.com/',
];

const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => (s.match(/[.!?](?=\s|$)/g) ?? []).length;
const isText = (s) => typeof s === 'string' && s.trim().length > 0;
const isWording = (t) => t && isText(t.standard) && isText(t.kid);
const sameSet = (a, b) => assert.deepEqual([...a].sort(), [...b].sort());

/** Section 8 table rows → { id: { name, level, release, sources, section } }. */
function researchRows(md) {
  const rows = {};
  let section = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^###? (\d+(?:\.\d+)?)/);
    if (h) section = h[1].startsWith('8.') ? h[1] : null;
    const m = section && line.match(/^\| ([FBPTDURGS]\d+) \|/);
    if (!m) continue;
    const [id, name, , , lvl, rel, src] = line.split('|').slice(1, -1).map((c) => c.trim());
    const sources = src.replace(/`[^`]*`/g, '').replace(/\([^)]*\)/g, '').split(';')
      .map((s) => s.trim()).filter((s) => s && s !== 'approximation');
    rows[id] = { name, level: Number(lvl), release: rel.split(/\s/)[0], sources, section };
  }
  return rows;
}

/** URLs listed in section 10 without an unverified / not-opened marker (line-level or list-level). */
function verifiedSourceUrls(md) {
  const body = md.slice(md.indexOf('\n## 10. Sources'), md.indexOf('\n## Appendix A'));
  const ok = new Set(), bad = new Set();
  let inFlaggedList = false;
  for (const line of body.split('\n')) {
    if (/^- `\[(unverified|not)[^`]*\]`:\s*$/.test(line)) { inFlaggedList = true; continue; }
    if (!/^\s/.test(line)) inFlaggedList = false;
    const flagged = inFlaggedList || /unverified|not readable|not opened|abstract only/i.test(line);
    for (const [url] of line.matchAll(/https?:\/\/[^\s<>]+/g)) (flagged ? bad : ok).add(url);
  }
  for (const u of bad) ok.delete(u);
  return ok;
}

const ROWS = researchRows(research);
const VERIFIED = verifiedSourceUrls(research);

/** docs/research/passing.md section 2 rows → { id: { release, sources: source keys } }. */
function passingRows(md) {
  const rows = {};
  const body = md.slice(md.indexOf('\n## 2.'), md.indexOf('\n## 3.'));
  for (const line of body.split('\n')) {
    if (!/^\| PA\d+ \|/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim()); // '\|' inside a cell is a literal bar
    const keys = cells[5].split(/[,;]/).map((c) => c.replace(/\([^)]*\)/g, '').replace(/\\?\*/g, '').trim().split(/\s+/)[0])
      .filter((k) => k && !/^P\d+$/.test(k)); // "ODP P6, P7": the ODP manual's principle numbers
    rows[cells[0]] = { release: cells[4].split(/\s/)[0], sources: [...new Set(keys)] };
  }
  return rows;
}
/** URLs in passing.md section 7 (every page there was opened), without the abstract-only ones. */
function passingUrls(md) {
  const body = md.slice(md.indexOf('\n## 7. Sources'));
  const ok = new Set();
  for (const line of body.split('\n')) {
    if (/abstract only|confidential/i.test(line)) continue;
    for (const [url] of line.matchAll(/https?:\/\/[^\s<>]+/g)) ok.add(url);
  }
  return ok;
}
const PASSING_ROWS = passingRows(passingResearch);
const PASSING_VERIFIED = passingUrls(passingResearch);
const LEARNABLE_FAMILIES = new Set(LEARNABLE_ROLES.map((r) => ROLE_INFO[r].family));

function checkLink(url, where) {
  assert.match(url, /^https:\/\//, `${where}: ${url} is not https`);
  assert.ok(!DO_NOT_LINK.includes(url), `${where}: ${url} must not be linked`);
  if (/^PA\d+$/.test(where)) assert.ok(PASSING_VERIFIED.has(url), `${where}: ${url} is not a source in research/passing.md section 7`);
  else assert.ok(VERIFIED.has(url), `${where}: ${url} is not a verified source in RESEARCH section 10`);
}

// ---------- principles ----------

test('principles: 85 rows (70 from RESEARCH section 8, PA1-PA15 passing) with unique, contiguous IDs and the right category', () => {
  assert.equal(principleData.version, 1);
  assert.equal(principles.length, TOTAL);
  assert.equal(new Set(principles.map((p) => p.id)).size, TOTAL, 'duplicate principle id');
  for (const [prefix, [count, category, section]] of Object.entries(PREFIX)) {
    const ids = principles.filter((p) => prefixOf(p.id) === prefix).map((p) => p.id);
    assert.deepEqual(ids, Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`), `${prefix} ids`);
    for (const id of ids) {
      assert.equal(byId[id].category, category, `${id} category`);
      assert.equal(byId[id].section, section, `${id} section`);
    }
  }
  for (const p of principles) assert.match(p.id, /^(?:[FBPTDURGS]|PA)[1-9]\d?$/);
});

test('principles: PA1-PA15 releases and source keys match research/passing.md section 2', () => {
  assert.equal(Object.keys(PASSING_ROWS).length, 15, 'passing.md section 2 should have 15 rows');
  assert.ok(PASSING_VERIFIED.size > 20, 'parsed the passing.md section 7 source list');
  for (const [id, row] of Object.entries(PASSING_ROWS)) {
    const p = byId[id];
    assert.ok(p, `${id} missing from principles.json`);
    assert.equal(p.release, row.release, `${id} release`);
    assert.deepEqual(p.sources, row.sources, `${id} sources`);
    assert.ok([1, 2, 3].includes(p.level), `${id} level ${p.level}`);
    assert.ok(Array.isArray(p.related) && p.related.every((r) => byId[r]), `${id} related`);
  }
});

test('principles: names, levels, releases and sources match RESEARCH section 8', () => {
  assert.equal(Object.keys(ROWS).length, 70, 'RESEARCH section 8 should have 70 rows');
  for (const [id, row] of Object.entries(ROWS)) {
    const p = byId[id];
    assert.ok(p, `${id} missing from principles.json`);
    assert.equal(p.name, row.name, `${id} name`);
    assert.equal(p.level, row.level, `${id} level`);
    assert.equal(p.release, row.release, `${id} release`);
    assert.deepEqual(p.sources, row.sources, `${id} sources`);
    assert.ok(RELEASES.includes(p.release), `${id} release ${p.release}`);
    assert.ok([1, 2, 3].includes(p.level), `${id} level ${p.level}`);
  }
});

test('principles: learner text is present and within length limits', () => {
  for (const p of principles) {
    for (const k of ['name', 'short', 'who', 'ruleOfThumb', 'commonMistake']) assert.ok(isText(p[k]), `${p.id}.${k}`);
    assert.ok(isWording(p.summary), `${p.id}.summary`);
    assert.ok(isWording(p.why), `${p.id}.why (both wordings: the kid one joined the Why? sheet, 2026-10-01)`);
    assert.ok(words(p.why.kid) <= 30, `${p.id} kid why is ${words(p.why.kid)} words`);
    assert.ok(words(p.short) <= 4, `${p.id} short "${p.short}" > 4 words`);
    assert.ok(words(p.summary.kid) <= 15, `${p.id} kid summary is ${words(p.summary.kid)} words`);
    assert.ok(!/\(default\)|\[[DSM]\]|\bx\s*[<>=]/.test(p.summary.kid), `${p.id} kid summary has engine jargon`);
    const n = sentences(p.summary.standard);
    assert.ok(n >= 1 && n <= 2, `${p.id} standard summary has ${n} sentences`);
    assert.ok(sentences(p.why.standard) >= 1 && sentences(p.why.standard) <= 2, `${p.id} why (standard)`);
    assert.ok(sentences(p.why.kid) >= 1 && sentences(p.why.kid) <= 4, `${p.id} why (kid: short sentences, so up to 4)`);
    assert.equal(sentences(p.commonMistake), 1, `${p.id} commonMistake should be one sentence`);
  }
});

test('principles: kidName is a unique 2-4 word Title Case name of at most 24 characters', () => {
  // Shown on sticker cards and chips for ~11-year-olds: plain words, no gendered pronouns, no left/right, no jargon.
  const minor = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to']);
  const seen = new Map();
  for (const p of principles) {
    const k = p.kidName;
    assert.ok(isText(k), `${p.id} kidName`);
    assert.equal(k, k.trim().replace(/\s+/g, ' '), `${p.id} kidName "${k}" has stray spaces`);
    assert.ok(words(k) >= 2 && words(k) <= 4, `${p.id} kidName "${k}" is ${words(k)} words`);
    assert.ok(k.length <= 24, `${p.id} kidName "${k}" is ${k.length} characters`);
    k.split(/[\s-]+/).forEach((w, i) => {
      if (i === 0 || !minor.has(w.toLowerCase())) assert.match(w, /^[^a-z]/, `${p.id} kidName "${k}" is not Title Case`);
    });
    assert.doesNotMatch(k, /\b(he|she|him|her|his|hers|left|right)\b/i, `${p.id} kidName "${k}" has a gendered or side word`);
    assert.doesNotMatch(k, /half-?space|transition|compact/i, `${p.id} kidName "${k}" has jargon`);
    const key = k.toLowerCase();
    assert.ok(!seen.has(key), `${p.id} kidName "${k}" repeats ${seen.get(key)}`);
    seen.set(key, p.id);
  }
});

test('principles: families are valid, and every v1 principle suits a learnable role', () => {
  for (const p of principles) {
    assert.ok(Array.isArray(p.families) && p.families.length > 0, `${p.id} families`);
    assert.equal(new Set(p.families).size, p.families.length, `${p.id} duplicate family`);
    for (const f of p.families) assert.ok(FAMILIES.includes(f), `${p.id} family ${f}`);
    if (p.release === 'v1') assert.ok(p.families.some((f) => LEARNABLE_FAMILIES.has(f)), `${p.id} is v1 but only for non-learnable roles`);
  }
  assert.deepEqual(byId.G1.families, ['GK']);
  assert.notEqual(byId.G1.release, 'v1', 'the GK role is v1.1');
});

test('principles: ruleIds are engine rule IDs that follow the RESEARCH 5.5 map', () => {
  for (const p of principles) {
    for (const r of p.ruleIds) assert.ok(ENGINE_RULE_IDS.includes(r), `${p.id} unknown rule ${r}`);
    const expected = ENGINE_RULE_IDS.filter((r) => RULE_REFS[r].includes(p.id));
    sameSet(p.ruleIds, expected);
    if (p.ruleIds.length) assert.equal(p.release, 'v1', `${p.id} is checked by a v1 rule, so it ships in v1`);
  }
  for (const [rule, refs] of Object.entries(RULE_REFS)) {
    for (const id of refs) assert.ok(byId[id]?.ruleIds.includes(rule), `${rule} → ${id}`);
  }
});

test('principles: agree both ways with the rule registry', async () => {
  const { RULES, RULES_BY_ID } = await import('../js/engine/rules/index.js');
  for (const rule of RULES) {
    for (const pid of rule.principles) {
      assert.ok(byId[pid], `rule ${rule.id} cites unknown principle ${pid}`);
      assert.ok(byId[pid].ruleIds.includes(rule.id), `${pid}.ruleIds should list ${rule.id}`);
    }
  }
  for (const p of principles) {
    for (const r of p.ruleIds) {
      assert.ok(RULES_BY_ID[r], `${p.id} lists ${r}, which is not registered`);
      assert.ok(RULES_BY_ID[r].principles.includes(p.id), `rule ${r} should cite ${p.id}`);
    }
  }
});

test('principles: learnMore has 1-2 verified links from RESEARCH section 10', () => {
  assert.ok(VERIFIED.size > 50, 'parsed the section 10 source list');
  for (const p of principles) {
    assert.ok(Array.isArray(p.learnMore) && p.learnMore.length >= 1 && p.learnMore.length <= 2, `${p.id} learnMore count`);
    assert.equal(new Set(p.learnMore.map((l) => l.url)).size, p.learnMore.length, `${p.id} duplicate link`);
    for (const l of p.learnMore) {
      assert.ok(isText(l.label), `${p.id} link label`);
      checkLink(l.url, p.id);
    }
  }
});

// ---------- curriculum ----------

/** RESEARCH 9.2 item 9: the principles each drill module teaches. */
const MODULE_PRINCIPLES = {
  M1: ['D1', 'D2', 'D3', 'D4', 'D5', 'T2', 'T3', 'U8'],
  M2: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'P1', 'P2', 'P10'],
  M3: ['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'R1', 'R2', 'R3'],
};
const modules = curriculum.modules;
const moduleIndex = Object.fromEntries(modules.map((m, i) => [m.id, i]));

test('curriculum: modules M0-M3 unlock in order', () => {
  assert.equal(curriculum.version, 1);
  assert.deepEqual(modules.map((m) => m.id), ['M0', 'M1', 'M2', 'M3']);
  modules.forEach((m, i) => {
    assert.equal(m.unlock, i === 0 ? null : modules[i - 1].id, `${m.id} unlock`);
    assert.equal(m.kind, i === 0 ? 'tutorial' : 'drills', `${m.id} kind`);
    assert.ok(Array.isArray(m.scenarios) && m.scenarios.every(isText), `${m.id} scenarios`);
    assert.equal(new Set(m.scenarios).size, m.scenarios.length, `${m.id} duplicate scenario`);
  });
  assert.equal(modules[0].tutorial, 'data/tutorial.json');
});

test('curriculum: drill modules teach the RESEARCH 9.2 principles, once each, all v1', () => {
  const seen = new Set();
  for (const m of modules) {
    assert.equal(new Set(m.principles).size, m.principles.length, `${m.id} lists a principle twice`);
    for (const id of m.principles) assert.ok(byId[id], `${m.id} unknown principle ${id}`);
    if (m.kind !== 'drills') continue;
    sameSet(m.principles, MODULE_PRINCIPLES[m.id]);
    for (const id of m.principles) {
      assert.equal(byId[id].release, 'v1', `${m.id} teaches ${id}, which is not v1`);
      assert.ok(!seen.has(id), `${id} is taught in two drill modules`);
      seen.add(id);
    }
  }
});

test('curriculum: roles, levels, interleaved pairs and learner text', () => {
  const levelNums = curriculum.levels.map((l) => l.level);
  assert.deepEqual(levelNums, [1, 2, 3]);
  let prevStars = -1;
  for (const l of curriculum.levels) {
    assert.ok(['blocked', 'interleaved', 'live'].includes(l.mix), `level ${l.level} mix`);
    assert.ok(isText(l.name) && isText(l.kidName) && isWording(l.description), `level ${l.level} text`);
    assert.ok(l.unlockStars >= prevStars && l.unlockStars <= 3, `level ${l.level} unlockStars`);
    prevStars = l.unlockStars;
  }
  const { mix } = curriculum.session;
  assert.ok(Math.abs(mix.current + mix.interleaved + mix.review - 1) < 1e-9, 'session mix sums to 1');

  for (const m of modules) {
    assert.ok(isText(m.title) && isText(m.subtitle), `${m.id} title`);
    assert.ok(isWording(m.description) && isWording(m.pitchChallenge), `${m.id} text`);
    const n = sentences(m.description.standard);
    assert.ok(n >= 1 && n <= 2, `${m.id} description has ${n} sentences`);
    assert.ok(words(m.description.kid) <= 15, `${m.id} kid description`);
    assert.ok(m.roles.length > 0 && m.roles.every((f) => LEARNABLE_FAMILIES.has(f)), `${m.id} roles`);
    if (m.kind === 'drills') {
      assert.deepEqual(m.levels.map((l) => l.level), levelNums, `${m.id} levels`);
      for (const l of m.levels) assert.ok(isWording(l.focus) && words(l.focus.kid) <= 15, `${m.id} level ${l.level} focus`);
    }
    for (const { pair, label } of m.interleave) {
      assert.equal(pair.length, 2);
      assert.notEqual(pair[0], pair[1]);
      assert.ok(isWording(label), `${m.id} interleave label`);
      // Look-alikes are mixed only once both have been introduced: here or in an earlier module.
      const home = pair.map((id) => modules.findIndex((mm) => mm.principles.includes(id)));
      assert.ok(home.every((i) => i >= 0 && i <= moduleIndex[m.id]), `${m.id} pair ${pair} not yet taught`);
      assert.ok(home.includes(moduleIndex[m.id]), `${m.id} pair ${pair} has nothing from this module`);
    }
  }
});

// ---------- tutorial ----------

const REQUIRED_TOPICS = ['thirds', 'lanes', 'duties', 'goal-side', 'offside', 'shift'];
const TASK_TYPES = ['observe', 'drag-ball', 'place', 'tap-player'];
const isPlayerId = (id) => {
  if (typeof id !== 'string' || !id.includes('-')) return false;
  const { team, role } = parsePlayerId(id);
  return (team === 'us' || team === 'them') && ROLES.includes(role);
};
const circleOnPitch = (c) => c.r > 0 && c.x - c.r >= 0 && c.x + c.r <= LENGTH && c.y - c.r >= 0 && c.y + c.r <= WIDTH;
const inCircle = (p, c) => dist(p, c) <= c.r;
const steps = tutorial.steps;
const stepByTopic = Object.fromEntries(steps.map((s) => [s.topic, s]));

test('tutorial: 5-7 steps that cover every pitch-literacy topic and match M0', () => {
  assert.equal(tutorial.module, 'M0');
  assert.ok(steps.length >= 5 && steps.length <= 7, `${steps.length} steps`);
  assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, 'duplicate step id');
  for (const t of REQUIRED_TOPICS) assert.ok(stepByTopic[t], `no step teaches ${t}`);
  const taught = [...new Set(steps.flatMap((s) => s.principles))];
  for (const id of taught) assert.ok(byId[id], `unknown principle ${id}`);
  assert.deepEqual(modules[0].principles, taught, 'M0 principles = tutorial principles in step order');
});

test('tutorial: setups use valid roles, player IDs and on-pitch coordinates', () => {
  for (const s of steps) {
    const { setup, task } = s;
    const at = `step ${s.id}`;
    assert.ok(isText(s.title) && isWording(s.text), `${at} text`);
    assert.ok(LEARNABLE_ROLES.includes(setup.learnerRole), `${at} learnerRole ${setup.learnerRole}`);
    assert.ok(['us', 'them', 'none'].includes(setup.possession), `${at} possession`);
    assert.ok(onPitch(setup.ball), `${at} ball off the pitch`);
    if (setup.carrierId != null) {
      assert.ok(isPlayerId(setup.carrierId), `${at} carrierId`);
      assert.equal(parsePlayerId(setup.carrierId).team, setup.possession, `${at} carrier is on the wrong team`);
    }
    for (const k of ['thirds', 'lanes', 'zone14', 'offsideLine']) assert.equal(typeof setup.overlays[k], 'boolean', `${at} overlays.${k}`);
    for (const id of setup.highlight) assert.ok(isPlayerId(id), `${at} highlight ${id}`);
    const learnerId = `us-${setup.learnerRole}`;
    for (const [id, p] of Object.entries(setup.overrides ?? {})) {
      assert.ok(isPlayerId(id), `${at} override ${id}`);
      assert.notEqual(id, learnerId, `${at}: position the learner with learnerStart`);
      assert.ok(onPitch(p), `${at} override ${id} off the pitch`);
    }
    if (setup.learnerStart) assert.ok(onPitch(setup.learnerStart), `${at} learnerStart`);

    assert.ok(TASK_TYPES.includes(task.type), `${at} task type ${task.type}`);
    assert.ok(isWording(task.prompt) && isWording(task.success), `${at} prompt/success`);
    assert.ok(words(task.prompt.kid) <= 15, `${at} kid prompt too long`);
    if (task.type !== 'observe') assert.ok(isWording(task.hint), `${at} hint`);
    if (task.type === 'drag-ball') {
      assert.ok(circleOnPitch(task.to), `${at} target circle`);
      assert.ok(!inCircle(setup.ball, task.to), `${at}: the ball already starts in the target`);
    }
    if (task.type === 'place') {
      assert.ok(circleOnPitch(task.target), `${at} target circle`);
      assert.ok(setup.learnerStart, `${at}: a place task needs learnerStart`);
      assert.ok(!inCircle(setup.learnerStart, task.target), `${at}: the learner already starts in the target`);
    }
    if (task.type === 'tap-player') {
      assert.ok(isPlayerId(task.answer), `${at} answer`);
      assert.ok(!setup.highlight.includes(task.answer), `${at}: the highlight gives the answer away`);
    }
  }
});

test('tutorial: each topic step makes tactical sense', () => {
  // Thirds: the whole target lies in the final third.
  const thirds = stepByTopic.thirds.task.to;
  assert.ok(thirds.x - thirds.r >= THIRD_EDGES[2], 'thirds target reaches back into the middle third');

  // Lanes: the whole target lies in one half-space, in their half.
  const lanes = stepByTopic.lanes.task.to;
  const lane = laneOf(lanes.y);
  assert.ok(lane === 1 || lane === 3, 'lanes target is not a half-space');
  assert.equal(laneOf(lanes.y - lanes.r), lane);
  assert.equal(laneOf(lanes.y + lanes.r), lane);
  assert.ok(lanes.x - lanes.r > HALF_X, 'lanes target should be in their half');

  // Duties: the answer is our player nearest the ball, pressing from the goal side.
  const duty = stepByTopic.duties;
  const ov = duty.setup.overrides;
  assert.equal(duty.setup.possession, 'them');
  assert.equal(parsePlayerId(duty.task.answer).team, 'us');
  assert.ok(dist(ov[duty.setup.carrierId], duty.setup.ball) <= 1.5, 'carrier is on the ball');
  const ours = Object.entries(ov).filter(([id]) => id.startsWith('us-'));
  const nearest = ours.reduce((a, b) => (dist(b[1], duty.setup.ball) < dist(a[1], duty.setup.ball) ? b : a));
  assert.equal(nearest[0], duty.task.answer, 'answer is the nearest of our players');
  const presser = ov[duty.task.answer];
  assert.ok(presser.x < duty.setup.ball.x && dist(presser, duty.setup.ball) <= 3, 'presser is goal-side and close');

  // Goal-side: the whole target is goal-side of the marked opponent, 1-3.5 m away; the start is not.
  const gs = stepByTopic['goal-side'];
  const markId = gs.setup.highlight.find((id) => id.startsWith('them-'));
  const mark = gs.setup.overrides[markId];
  const t = gs.task.target;
  assert.ok(mark, 'the marked opponent has a fixed position');
  assert.ok(t.x + t.r < mark.x, 'target reaches level with or past the opponent');
  assert.ok(dist(t, OWN_GOAL) < dist(mark, OWN_GOAL), 'target is not nearer our goal than the opponent');
  const gap = dist(t, mark);
  assert.ok(gap >= 1 && gap <= 3.5, `target centre is ${gap.toFixed(1)} m from the opponent`);
  assert.ok(gs.setup.learnerStart.x > mark.x, 'learner should start on the wrong side');

  // Offside: their line is fixed; the whole target is onside and high, in their half; the start is offside.
  const off = stepByTopic.offside;
  assert.equal(off.setup.possession, 'us');
  assert.ok(['ST', 'W'].includes(ROLE_INFO[off.setup.learnerRole].family), 'learner is a forward');
  const lineIds = ['GK', ...BACK_LINE].map((r) => `them-${r}`);
  for (const id of lineIds) assert.ok(off.setup.overrides[id], `${id} should be fixed so the line is known`);
  const secondLast = lineIds.map((id) => off.setup.overrides[id].x).sort((a, b) => b - a)[1];
  const ot = off.task.target;
  assert.ok(ot.x + ot.r <= secondLast, 'part of the target is offside');
  assert.ok(ot.x - ot.r > HALF_X, 'target is not in their half');
  assert.ok(ot.x - ot.r >= secondLast - 6, 'target lets the striker drop too deep');
  assert.ok(off.setup.learnerStart.x > Math.max(secondLast, off.setup.ball.x), 'learner should start offside');
  assert.ok(off.setup.overlays.offsideLine, 'offside step shows the line');

  // Shift: the ball goes from one wing lane to the other.
  const sh = stepByTopic.shift;
  const from = laneOf(sh.setup.ball.y);
  const to = sh.task.to;
  assert.ok([0, 4].includes(from), 'shift starts on a wing');
  assert.equal(laneOf(to.y - to.r), 4 - from);
  assert.equal(laneOf(to.y + to.r), 4 - from);
});

test('tutorial: the engine agrees with the duty, marking and offside answers', async () => {
  const { createFormation } = await import('../js/engine/formation.js');
  const { autoFrame } = await import('../js/engine/scene.js');
  const { buildContext } = await import('../js/engine/context.js');
  const f = createFormation(await loadJSON('data/formations/helios-433.json'));
  // Duties are judged with the learner at its formation spot, as the app does (ARCHITECTURE 5.4).
  const contextFor = (s) => {
    const learnerId = `us-${s.setup.learnerRole}`;
    const { ball, possession, carrierId, overrides } = s.setup;
    const frame = autoFrame({ formations: { us: f, them: f }, ball, possession, carrierId, learnerId, overrides });
    const base = frame.players.find((p) => p.id === learnerId);
    return { frame, ctx: buildContext(frame, { learnerId, base: { x: base.x, y: base.y } }) };
  };

  const duty = stepByTopic.duties;
  const { ctx: dc } = contextFor(duty);
  assert.equal(dc.firstDefender?.id, duty.task.answer, 'engine first defender');
  assert.equal(dc.duty, 'third-defender', 'the far-side learner is a third defender, as the step says');

  const gs = stepByTopic['goal-side'];
  const { ctx: gc } = contextFor(gs);
  assert.equal(gc.markTarget?.id, gs.setup.highlight.find((id) => id.startsWith('them-')), 'engine mark target');

  const off = stepByTopic.offside;
  const { frame: of } = contextFor(off);
  const xs = of.players.filter((p) => p.team === 'them').map((p) => p.x).sort((a, b) => b - a);
  const lineIds = ['GK', ...BACK_LINE].map((r) => `them-${r}`);
  const fixed = lineIds.map((id) => off.setup.overrides[id].x).sort((a, b) => b - a)[1];
  assert.equal(xs[1], fixed, 'no auto-placed opponent changes the offside line');
});

// ---------- resources ----------

const GROUP_ORDER = ['start-here', 'beginner', 'intermediate', 'advanced', 'video'];

test('resources: well-formed entries with verified https links', () => {
  assert.ok(Array.isArray(resources) && resources.length >= 10);
  assert.equal(new Set(resources.map((r) => r.id)).size, resources.length, 'duplicate id');
  assert.equal(new Set(resources.map((r) => r.url)).size, resources.length, 'duplicate url');
  for (const r of resources) {
    assert.match(r.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${r.id} id`);
    assert.ok(isText(r.title), `${r.id} title`);
    assert.ok(['book', 'website', 'video', 'course', 'curriculum', 'app'].includes(r.kind), `${r.id} kind`);
    assert.ok(['beginner', 'intermediate', 'advanced'].includes(r.level), `${r.id} level`);
    assert.ok(['player', 'coach', 'both'].includes(r.audience), `${r.id} audience`);
    assert.equal(typeof r.free, 'boolean', `${r.id} free`);
    assert.equal(r.verified, true, `${r.id}: only verified sources are listed`);
    assert.equal(sentences(r.why), 1, `${r.id} why should be one sentence`);
    if (r.note !== undefined) assert.ok(isText(r.note), `${r.id} note`);
    checkLink(r.url, r.id);
  }
});

test('resources: grouped with the RESEARCH 2.1 "start here" picks first', () => {
  const groups = resources.map((r) => GROUP_ORDER.indexOf(r.group));
  assert.ok(groups.every((g) => g >= 0), 'unknown group');
  assert.ok(groups.every((g, i) => i === 0 || g >= groups[i - 1]), 'groups out of order');
  assert.equal(resources[0].group, 'start-here');
  const s21 = research.slice(research.indexOf('### 2.1'), research.indexOf('### 2.2'));
  const picks = [...s21.matchAll(/https:\/\/[^\s<>]+/g)].map((m) => m[0]);
  sameSet(resources.filter((r) => r.group === 'start-here').map((r) => r.url), picks);
});
