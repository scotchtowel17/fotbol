// Player-mode copy (docs/KID_REDESIGN.md §0 rules 3, 4 and 6-9, §7; evidence: docs/research/kid-learning.md R1-R5,
// R17-R21, R30, R35, R37 and docs/research/kid-audit.md §5). Every string a player reads in Player mode is collected:
//   - the rules' simple wording (text.kid), rendered with real vars from the engine on the canonical situations plus
//     every branch of each template, and the zone reason (js/engine/explain.js ZONE_REASON);
//   - the drills' kid fields (data/scenarios: titleKid, briefKid, questionKid, takeaway.kid, misconceptions' textKid);
//   - the principles' kidName and summary.kid (every category, the passing ones included), and the tutorial's kid text;
//   - the Road's titles (data/road.json), the rewards' words (stars, badges, kits, nicknames), the passing
//     texts (js/engine/passing.js allPassTexts) and the STRINGS export of every js/ui/player/*.js module.
// Optional sources (the Road, the passing engine, generated drills, the Player modules) are skipped until they exist.
// Each string must:
//   - fit its word budget (R2): a brief or question 12 words, a reveal line or one-liner 14, a principle's summary 15,
//     a principle's or rule's name 2-4 words, a drill title 8, a label (Road, badge, kit, nickname) 5;
//   - read at age 9 (R1): Flesch-Kincaid grade 4 or lower over each source's sentences (and no single sentence of 6+
//     words above grade 8), with a small allow-list of football words every player knows;
//   - avoid what Player mode never says: "kid", "!!!", principle and role codes, grades and "/100", metres, pressure
//     and streak-loss copy, praise of the person, and the coaching jargon kid-audit.md §5 hides or replaces.
// Failures name the source of the string, e.g. `rule cover kid.fail(issue=level)` or `scenario m1-02-d3-rcb questionKid`.
import { test, assert, loadJSON, isNode } from './harness.js';
import { RULES } from '../js/engine/rules/index.js';
import { ZONE_REASON } from '../js/engine/explain.js';
import { createFormation } from '../js/engine/formation.js';
import { analyseScene } from '../js/engine/analyse.js';
import { evaluate } from '../js/engine/score.js';
import { LEARNABLE_ROLES, playerId } from '../js/engine/roles.js';
import { onPitch } from '../js/engine/pitch.js';
import { SITUATIONS, sceneOptions } from './situations.js';
import { BADGES, KIT_PALETTES, NICKNAMES, STAR_WORDS } from '../js/rewards.js';

// ---------------------------------------------------------------- the checks

/** Word budgets per kind of string (R2, KID_REDESIGN §0 rule 3). `fk`: the kind is prose, graded for reading age. */
const BUDGETS = Object.freeze({
  brief: { max: 12, fk: true }, // the brief before a rep
  question: { max: 12, fk: true }, // the question at the freeze, a rule's cue
  line: { max: 14, fk: true }, // the reveal line, a praise line, a takeaway, a misconception, a tutorial line, a badge
  summary: { max: 15, fk: true }, // a principle's kid summary (the Why? sheet)
  because: { max: 30, fk: true }, // a principle's why line, on the Why? sheet since 2026-10-01 ("a little more explanation": longer than a summary, still plain)
  ui: { max: 14, fk: true }, // any other Player-mode string (a key naming a question or brief: 12)
  name: { min: 2, max: 4, fk: false }, // R3: an idea's name in 2-4 plain football words
  title: { max: 8, fk: false }, // a drill's title
  label: { max: 5, fk: false }, // Road titles, badge names, kits, nicknames, star words
});
const MAX_GROUP_GRADE = 4; // R1: reading age 9
const MAX_SENTENCE_GRADE = 8; // no single hard sentence (of SENTENCE_MIN_WORDS or more) hides in an easy group
const SENTENCE_MIN_WORDS = 6; // Flesch-Kincaid means little for a sentence shorter than this

/** Football words everyone who plays knows: counted as one syllable (R1 allows a small allow-list). */
const FOOTBALL_WORDS = new Set([
  'goalkeeper', 'keeper', 'defender', 'defending', 'midfielder', 'midfield', 'attacker', 'attacking', 'teammate', 'sideline',
  'offside', 'onside', 'striker', 'winger', 'penalty', 'halfway', 'opponent', 'football', 'forward', 'corner',
]);
/** Common words the vowel-group heuristic gets wrong. */
const SYLLABLE_FIXES = Object.freeze({ stayed: 1, played: 1, passes: 2, area: 3, idea: 3, ideas: 3, being: 2, create: 2, every: 2, everyone: 3, anyone: 3, someone: 2 });

/** Syllables in a word: vowel groups, less a silent final e (the usual heuristic), with the allow-list and fixes. */
function syllables(word) {
  let w = String(word).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]/g, '');
  if (!w) return 0;
  if (/^\d+$/.test(w)) return 1;
  if (FOOTBALL_WORDS.has(w) || (w.endsWith('s') && FOOTBALL_WORDS.has(w.slice(0, -1)))) return 1;
  if (SYLLABLE_FIXES[w]) return SYLLABLE_FIXES[w];
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, (w.match(/[aeiouy]{1,2}/g) ?? []).length);
}
/** Words: whitespace-separated tokens with a letter or digit ("·", "—" and "★" are not words). */
const wordsOf = (s) => String(s).split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
/** Sentences: text ending in . ! ? or …; a string without one is one sentence (a label, a button). */
const sentencesOf = (s) => String(s).split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter((x) => wordsOf(x).length);
/** Flesch-Kincaid grade of some strings taken together: 0.39 words/sentence + 11.8 syllables/word - 15.59. */
function fkGrade(texts) {
  let W = 0, S = 0, Y = 0;
  for (const t of texts) {
    const ws = wordsOf(t);
    if (!ws.length) continue;
    W += ws.length;
    S += sentencesOf(t).length;
    for (const w of ws) Y += w.split('-').reduce((a, p) => a + syllables(p), 0);
  }
  return W ? 0.39 * (W / S) + 11.8 * (Y / W) - 15.59 : 0;
}

/** What Player mode never says, and what to say instead. Checked on every string. */
const BANNED = [
  // R5, R30: respect, not nursery
  [/\bkids?\b/i, 'the word "kid" (R5)'],
  [/!{2,}/, '"!!" or "!!!" (R30)'],
  // §0 rule 8: no codes on screen
  [/\b[A-Z]{1,2}\d{1,2}\b/, 'a principle code (name the idea instead)'],
  [/\b(?:GK|RB|LB|RCB|LCB|CB|FB|RWB|LWB|DM|CDM|CM|LCM|RCM|CAM|AM|LW|RW|LM|RM|ST|CF)\b/, 'a role code (say "left back", "their striker")'],
  [/#\d/, 'a number code like "#6" (say "their midfielder")'],
  [/\b\d-\d-\d(?:-\d)?\b/, 'a formation code'],
  // §0 rule 6, R18: stars and one word, never grades or scores
  [/\/\s*100\b|\bout of 100\b/i, 'a score out of 100 (stars only, R18)'],
  [/\bgrades?\b|\bgraded\b/i, 'a grade (stars only, R18)'],
  [/(?:^|[\s("'])[SBCDF](?=$|[\s.,!?:;)"'])/, 'a letter grade (stars only, R18)'],
  [/\ban A\b|\b[A-FS] or (?:better|worse|[A-FS])\b/, 'a letter grade (stars only, R18)'],
  [/\bout of position\b/i, '"Out of position" (the old F headline)'],
  [/\d\s*%|\bper ?cent\b/i, 'a percentage'],
  // §0 rule 8: the arrow carries the distance
  [/\d+(?:\.\d+)?\s*(?:m|metres?|meters?)\b|\bmetres?\b|\bmeters?\b/i, 'metres (the arrow carries the distance)'],
  // R19: praise the move, never the person
  [/\byou(?:'re| are) (?:a |an |so |such a )?(?:genius|superstar|star|natural|legend|amazing|awesome|incredible|brilliant|clever|smart|talented|the best)\b|\b(?:genius|superstar)\b/i, 'praise of the person, not the move (R19)'],
  // R21, R35, R37: no comparison, no streak to lose, no pressure
  [/\bleaderboard|\bbetter than (?:\d+|most|other)|\btop \d+ ?%/i, 'a comparison with other players (R21)'],
  [/\bdays? in a row\b|\b(?:lose|lost|break|broke|broken|save|keep) (?:your|the|a) streak\b|\bstreak (?:is |was )?(?:lost|broken|over|gone|ends?|ended)\b/i, 'a streak that can break (R35: days played this week only fill up)'],
  [/\bdon'?t go\s*(?:[!.?]|$)|\b(?:your team|we) needs? you\b|\bhurry\b|\blast chance\b|\btoo late\b|\byou'?ll (?:lose|miss)\b/i, 'pressure copy (R37)'],
];

/** Coaching jargon (kid-audit.md §5): hidden in Player mode or replaced by the plain football word. */
const JARGON = [
  [/\bhalf[- ]?spaces?\b/i, 'hide "half-space"'],
  [/\bzones?\b/i, 'hide "zone" (say "the best spot" or "the space in front of their box")'],
  [/\bcover shadows?\b|\bshadow block\b/i, 'hide "cover shadow"'],
  [/\b(?:high|mid|middle|low|medium|compact|deep|defensive|the|our|their)\s+block\b/i, '"block" for the team shape (say "defend high / in the middle / near our goal")'],
  [/\bcompact(?:ness)?\b/i, 'say "stay close together"'],
  [/\btransitions?\b/i, 'say "when the ball changes team"'],
  [/\bturnovers?\b|\bopen play\b|\bcut-?backs?\b|\bbuild-?up\b/i, 'hide it'],
  [/\btuck(?:s|ed|ing)?\b|\bsqueez(?:e|es|ed|ing)\b|\bnarrow(?:er|ing)?\b|\bconcentration\b/i, 'say "move toward the middle"'],
  [/\bpress(?:es|ed|ing|er|ers|ure)?\b/i, 'say "go to the ball" or "chase"'],
  [/\b(?:first|second|third) defender\b|\bbalance\b/i, 'say "back up" or "hold your spot"'],
  [/\bcover(?:s|ed|ing)?\b/i, 'say "back up" or "guard"'],
  [/\bgoal-?side\b|\bball-?side\b/i, 'say "between them and our goal" or "nearer the ball"'],
  [/\bmark(?:ing|ed|ers?)\b|\bman-mark|\bmark (?:your|their|the|him|her|them)\b|\bpick(?:s|ed)? up (?:your|their|a|the) (?:player|runner|man)\b/i, 'say "your player"'],
  [/\bcarriers?\b/i, 'say "the player with the ball"'],
  [/\bsupport(?:s|ed|ing)?\b|\bpassing options?\b/i, 'say "get open for a pass"'],
  [/\bengag(?:e|es|ed|ing)\b|\bdictat(?:e|es|ed|ing)\b/i, 'say "go to them" or "send them to the sideline"'],
  [/\boverlap(?:s|ped|ping)?\b/i, 'say "run past on the outside"'],
  [/\bswitch(?:es|ed|ing)?\s+(?:of\s+)?(?:play|it|the ball|the play|sides?)\b/i, 'say "a long pass to the other side"'],
  [/\bcounter(?:-?attacks?|s)?\b/i, 'say "fast break"'],
  [/\bdelay(?:s|ed|ing)?\b/i, 'say "slow them down"'],
  [/\brecovery runs?\b/i, 'say "sprint back"'],
  [/\bsecond[- ]last\b/i, 'hide "second-last player" (the offside line on the pitch shows it)'],
  [/\bcrossover\b|\bcrescent\b|\bL-shape/i, 'hide it'],
  [/\btouchlines?\b|\bbylines?\b|\bflanks?\b|\bchannels?\b|\bside lines?\b/i, 'say "sideline", "end line", "side" or "gap"'],
  [/\b(?:final|middle|defensive|attacking|their|our) third\b/i, 'say "our end", "the middle" or "their end"'],
  [/\bback (?:line|four)\b|\blevel line\b|\bhold the line\b/i, 'say "in line with your defenders"'],
  [/\b(?:step|steps|stepped|stepping|push|pushes|pushed|pushing) up\b|\bup the pitch\b|\bdown the pitch\b/i, 'say "forward" or "back"'],
  [/\bdeep(?:er)?\b|\bdrop(?:s|ped|ping)?\s+(?:back|off|deep|deeper|in|into|behind|a little|a few|down|level)\b/i, 'say "back" or "near our goal"'],
  [/\bwidth\b|\bdepth\b/i, 'say "stay wide" or "stay level with their last defender"'],
  [/\bpin(?:s|ned|ning)?\b/i, 'say "stay level with their last defender"'],
  [/\bbetween (?:the|their) lines\b|\bpockets?\b/i, 'say "the gap behind their midfielders"'],
  [/\bscreen(?:s|ed|ing)?\s+(?:the|our|their|your|a)\b|\bscreening\b/i, 'say "guard the space in front of our defenders"'],
  [/\blanes?\b/i, 'say "path" or "strip"'],
  [/\bunits?\b|\borgani[sz]ed\b/i, 'say "stay close together"'],
  [/\bprinciples?\b|\bmodules?\b|\bpitch literacy\b/i, 'say "idea" or "skill"'],
  [/\breps?\b/i, 'say "play" or "go"'],
  [/\bsequences?\b|\bseeds?\b/i, 'say "game"'],
  [/\bideal spot\b|\bghost\b|\bheat ?maps?\b|\bovals?\b/i, 'say "best spot" (the ring)'],
  [/\btime-averaged\b|\btolerance\b|\belo\b|\bmastery\b/i, 'hide it'],
  [/\btraining wheels\b|\bassisted\b/i, 'say "Helper on"'],
  [/\bexport\b|\bimport\b/i, 'say "Save" or "Load" (in the grown-ups area)'],
];

/**
 * Problems with one string (budget, banned content, a hard sentence).
 * @param {{ src: string, text: string, kind: string }} item
 */
function problemsOf(item) {
  const out = [];
  const b = BUDGETS[item.kind];
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  if (!text) return ['is empty'];
  const n = wordsOf(text).length;
  if (n > b.max) out.push(`${n} words (a ${item.kind} has at most ${b.max})`);
  if (b.min && n < b.min) out.push(`${n} words (a ${item.kind} has at least ${b.min})`);
  for (const [re, why] of [...BANNED, ...JARGON]) {
    const m = re.exec(text);
    if (m) out.push(`${why}: "${m[0].trim()}"`);
  }
  if (b.fk) {
    for (const s of sentencesOf(text)) {
      const g = fkGrade([s]);
      if (wordsOf(s).length >= SENTENCE_MIN_WORDS && g > MAX_SENTENCE_GRADE) out.push(`the sentence "${s}" reads at grade ${g.toFixed(1)} (at most ${MAX_SENTENCE_GRADE} for one sentence)`);
    }
  }
  return out;
}

/** Every problem in a list of strings: per string, then Flesch-Kincaid per sentence group (item.group). */
function problemsIn(items) {
  const out = [];
  for (const item of items) for (const p of problemsOf(item)) out.push(`${item.src}: "${item.text}" ${p}`);
  const groups = new Map();
  for (const item of items) {
    if (!BUDGETS[item.kind].fk || typeof item.text !== 'string') continue;
    const g = item.group ?? item.src;
    if (!groups.has(g)) groups.set(g, new Set());
    groups.get(g).add(item.text);
  }
  for (const [g, texts] of groups) {
    const grade = fkGrade([...texts]);
    if (grade > MAX_GROUP_GRADE) out.push(`${g}: reads at Flesch-Kincaid grade ${grade.toFixed(1)} (at most ${MAX_GROUP_GRADE}): ${[...texts].map((t) => `"${t}"`).join(' ')}`);
  }
  return out;
}

/** Assert a list of strings has no problems; `t` (node:test) also logs how many strings were checked. */
function report(items, what, t) {
  t?.diagnostic?.(`${what}: ${items.length} strings checked`);
  const problems = problemsIn(items);
  assert.ok(items.length > 0, `${what}: nothing to check`);
  assert.equal(problems.length, 0, `${what}: ${problems.length} problem(s) in ${items.length} strings (KID_REDESIGN §0, §7):\n  ${problems.join('\n  ')}`);
}

// ---------------------------------------------------------------- the sources

/** Load optional JSON (a file another area has not written yet): null when it is missing. */
async function maybeJSON(path) {
  try { return await loadJSON(path); } catch { return null; }
}

/** Import an optional module: null when it (or a module it needs) does not exist yet; any other error is thrown. */
async function maybeImport(path) {
  try { return await import(path); } catch (err) {
    const missing = err?.code === 'ERR_MODULE_NOT_FOUND' || /Failed to fetch|Cannot find module|error loading dynamically imported module|Importing a module script failed/i.test(String(err?.message ?? err));
    if (missing) return null;
    throw err;
  }
}

// The rules' kid templates, rendered with every vars set the engine produces on the canonical situations (every role,
// at the best spot, at the base and on rings around the best spot), then once per template branch.
const F = createFormation(await loadJSON('data/formations/helios-433.json'));
const formations = { us: F, them: F };

function harvestVars() {
  const byRule = new Map(RULES.map((r) => [r.id, new Map()]));
  for (const situation of SITUATIONS) {
    for (const role of LEARNABLE_ROLES) {
      const scene = analyseScene(sceneOptions(situation, playerId('us', role), formations));
      const g = scene.ghost.spot;
      const spots = [g, scene.base];
      for (const r of [4, 8, 14]) {
        for (let k = 0; k < 12; k++) {
          const p = { x: g.x + r * Math.cos((k * Math.PI) / 6), y: g.y + r * Math.sin((k * Math.PI) / 6) };
          if (onPitch(p)) spots.push(p);
        }
      }
      for (const p of spots) {
        for (const r of evaluate(scene.ctx, p).rules) {
          if (r.vars && Object.keys(r.vars).length) byRule.get(r.id)?.set(JSON.stringify(r.vars), r.vars);
        }
      }
    }
  }
  return byRule;
}

/** Names a rule's kid text can hold (rules/_util.js kidNameOf and the rules' own), for branches the situations never reach. */
const SAMPLE_VARS = Object.freeze({ whoKid: 'their striker', mateKid: 'your teammate', refKid: 'your defenders', kidZone: 'far post', by: 'defender' });
/** Every branch of each rule's kid templates, as vars on top of a real vars set. A new rule needs its branches here. */
const BRANCHES = Object.freeze({
  'between-lines': [{ part: 'free' }, { part: 'height', where: 'deep' }, { part: 'height', where: 'high' }],
  'box-fill': ['near post', 'far post', 'penalty spot', 'edge of the box'].map((kidZone) => ({ kidZone })),
  compact: ['far-line', 'close-line', 'gap', 'crowd', 'crossed', 'other'].flatMap((issue) => [{ issue, unit: 'back' }, { issue, unit: 'mid' }]),
  cover: ['level', 'tight', 'deep', 'behind', 'outside', 'wide', 'other'].map((issue) => ({ issue })),
  'goal-side': ['wrong-side', 'angle', 'loose', 'tight', 'other'].map((issue) => ({ issue })),
  'keeps-onside': [{ issue: 'kept', deep: 2 }],
  'lane-open': [{}],
  'level-line': ['deep', 'high', 'other'].map((issue) => ({ issue })),
  occupancy: [{ part: 'line' }, { part: 'lane' }],
  offside: ['defender', 'ball', 'halfway'].flatMap((by) => [{ by, beyond: 3, nearLine: true }, { by, beyond: 3, nearLine: false }]),
  pin: ['deep', 'beyond', 'offside'].map((issue) => ({ issue, dx: issue === 'deep' ? -8 : 4, depth: 2 })),
  press: ['far', 'close', 'wrong-side', 'line', 'show-inside', 'inside', 'too-round', 'other'].map((issue) => ({ issue })),
  screen: ['deep', 'high', 'wide', 'lane', 'other'].map((issue) => ({ issue })),
  spacing: [{ d: 2, min: 8, max: 20 }, { d: 30, min: 8, max: 20 }, { d: 10, min: 0, max: 20 }],
  'support-distance': [{ part: 'angle' }, { part: 'distance', d: 3, lo: 5, hi: 10, pressured: true }, { part: 'distance', d: 20, lo: 5, hi: 10, pressured: true },
    { part: 'distance', d: 20, lo: 8, hi: 16, pressured: false }, { part: 'distance', d: 12, lo: 8, hi: 16, pressured: false }],
  tuck: ['centre', 'wide'].flatMap((mode) => [{ mode, issue: 'narrow' }, { mode, issue: 'wide' }]),
  width: [{ d: 12, max: 4 }],
});
const BRANCH_KEYS = ['issue', 'part', 'where', 'mode', 'unit', 'by', 'nearLine', 'pressured', 'kidZone'];
const describeVars = (v) => BRANCH_KEYS.filter((k) => v[k] !== undefined).map((k) => `${k}=${v[k]}`).join(', ');

function ruleItems() {
  const items = [], broken = [];
  const vars = harvestVars();
  const render = (id, text, key, sets) => {
    const seen = new Set();
    for (const v of sets) {
      let t;
      try { t = text?.[key]?.({ ...SAMPLE_VARS, ...v }); } catch (err) { broken.push(`rule ${id} kid.${key}(${describeVars(v)}) throws: ${err.message}`); continue; }
      if (typeof t !== 'string' || !t || seen.has(t)) continue; // ok() may say nothing ('' away from the offside line)
      seen.add(t);
      items.push({ src: `rule ${id} kid.${key}(${describeVars(v)})`, text: t, kind: key === 'cue' ? 'question' : 'line', group: `rule ${id} (text.kid)` });
    }
  };
  for (const rule of RULES) {
    const kid = rule.text?.kid;
    if (!kid) { broken.push(`rule ${rule.id} has no text.kid`); continue; }
    if (!BRANCHES[rule.id]) broken.push(`rule ${rule.id}: list its kid template branches in BRANCHES (tests/copy.test.js)`);
    const real = [...vars.get(rule.id).values()];
    const sets = [...real, ...(BRANCHES[rule.id] ?? [{}]).map((b) => ({ ...real[0], ...b }))];
    items.push({ src: `rule ${rule.id} kid.name`, text: kid.name, kind: 'name' });
    for (const key of ['ok', 'fail', 'cue']) render(rule.id, kid, key, sets);
  }
  // The zone reason: the reveal line when being out of your spot is the top reason.
  const z = ZONE_REASON.text.kid;
  items.push({ src: 'explain.js ZONE_REASON kid.name', text: z.name, kind: 'name' });
  items.push({ src: 'explain.js ZONE_REASON kid.fail', text: z.fail({ dist: 9, role: 'a left back' }), kind: 'line', group: 'explain.js ZONE_REASON' });
  items.push({ src: 'explain.js ZONE_REASON kid.cue', text: z.cue({}), kind: 'question', group: 'explain.js ZONE_REASON' });
  return { items, broken };
}

async function scenarioItems() {
  const items = [], broken = [];
  const index = (await loadJSON('data/scenarios/index.json')).scenarios;
  for (const e of index) {
    const s = await loadJSON(`data/scenarios/${e.file}`);
    const src = `scenario ${s.id}`, group = `scenario ${s.id} (kid fields)`;
    for (const [key, kind, text] of [['titleKid', 'title', s.titleKid], ['briefKid', 'brief', s.briefKid], ['questionKid', 'question', s.questionKid], ['takeaway.kid', 'line', s.takeaway?.kid]]) {
      if (typeof text !== 'string' || !text.trim()) { broken.push(`${src} has no ${key} (Player mode shows only the kid wording)`); continue; }
      items.push({ src: `${src} ${key}`, text, kind, group });
    }
    for (const m of s.misconceptions ?? []) {
      if (typeof m.textKid === 'string') items.push({ src: `${src} misconception ${m.id} textKid`, text: m.textKid, kind: 'line', group });
    }
  }
  return { items, broken, count: index.length };
}

async function principleItems() {
  const { principles } = await loadJSON('data/principles.json');
  const items = [];
  for (const p of principles) {
    items.push({ src: `principle ${p.id} (${p.category}) kidName`, text: p.kidName, kind: 'name' });
    items.push({ src: `principle ${p.id} (${p.category}) summary.kid`, text: p.summary?.kid, kind: 'summary', group: `principle ${p.id} summary.kid` });
    const why = typeof p.why === 'string' ? p.why : p.why?.kid;
    items.push({ src: `principle ${p.id} (${p.category}) why`, text: why, kind: 'because', group: `principle ${p.id} why` });
  }
  return { items, count: principles.length, categories: [...new Set(principles.map((p) => p.category))] };
}

async function tutorialItems() {
  const t = await loadJSON('data/tutorial.json');
  const items = [{ src: 'tutorial intro.kid', text: t.intro?.kid, kind: 'line', group: 'tutorial intro and outro' }, { src: 'tutorial outro.kid', text: t.outro?.kid, kind: 'line', group: 'tutorial intro and outro' }];
  for (const s of t.steps) {
    const group = `tutorial step ${s.id}`;
    items.push({ src: `${group} text.kid`, text: s.text?.kid, kind: 'line', group });
    items.push({ src: `${group} task.prompt.kid`, text: s.task?.prompt?.kid, kind: 'brief', group });
    items.push({ src: `${group} task.success.kid`, text: s.task?.success?.kid, kind: 'line', group });
    if (s.task?.hint) items.push({ src: `${group} task.hint.kid`, text: s.task.hint.kid, kind: 'line', group });
  }
  return items;
}

function rewardItems() {
  const items = [];
  for (const b of BADGES) {
    items.push({ src: `rewards.js badge ${b.id} name.kid`, text: b.name.kid, kind: 'label' });
    items.push({ src: `rewards.js badge ${b.id} description.kid`, text: b.description.kid, kind: 'line', group: 'rewards.js badges (kid)' });
  }
  for (const p of KIT_PALETTES) items.push({ src: `rewards.js kit ${p.id}`, text: p.name, kind: 'label' });
  for (const n of NICKNAMES) items.push({ src: 'rewards.js NICKNAMES', text: n, kind: 'label' });
  STAR_WORDS.forEach((w, i) => items.push({ src: `rewards.js STAR_WORDS[${i}]`, text: w, kind: 'label' }));
  return items;
}

async function roadItems() {
  const road = await maybeJSON('data/road.json');
  if (!road) return null;
  const items = [];
  for (const c of road.chapters ?? []) {
    items.push({ src: `road.json chapter ${c.id} title`, text: c.title, kind: 'label' });
    for (const n of c.nodes ?? []) items.push({ src: `road.json node ${n.id} title`, text: n.title, kind: 'label' });
  }
  return items;
}

/** The Player-mode modules (KID_REDESIGN §8); under Node every js/ui/player/*.js file on disk is added. */
const PLAYER_MODULES = ['shell', 'home', 'kickoff', 'card', 'road', 'play', 'reveal', 'fulltime', 'matchday', 'strings', 'pass'];
/** Arguments to render STRINGS templates with (a template gets whichever fits: counts, a name, a title, an object). */
const SAMPLE_ARGS = [[], [3], [3, 5], [1, 5], [2, 'Rookie'], ['Rocket'], ['Rocket', 3], ['Back Up Your Buddy', 5], ['Great', 2],
  [{ n: 3, count: 3, stars: 2, max: 3, total: 5, name: 'Rocket', title: 'Back Up Your Buddy', word: 'Great', level: 2, role: 'left back', number: 9, days: 3, xp: 20, tier: 2 }]];
const UNRENDERED = /\bundefined\b|\bNaN\b|\[object |\bnull\b|\bfunction\b|=>/;

async function playerModuleItems() {
  let names = [...PLAYER_MODULES];
  if (isNode) {
    const { readdir } = await import('node:fs/promises');
    try {
      const onDisk = (await readdir(new URL('../js/ui/player/', import.meta.url))).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3));
      names = [...new Set([...names, ...onDisk])];
    } catch { /* no player modules yet */ }
  }
  const found = [], missing = [], noStrings = [], items = [];
  for (const name of names) {
    const mod = await maybeImport(`../js/ui/player/${name}.js`);
    if (!mod) { missing.push(name); continue; }
    if (!mod.STRINGS) { noStrings.push(name); continue; }
    found.push(name);
    const walk = (v, path) => {
      if (typeof v === 'string') { items.push({ src: `${name}.js ${path}`, text: v, kind: /question|brief/i.test(path) ? 'question' : 'ui', group: `${name}.js STRINGS` }); return; }
      if (typeof v === 'function') {
        const seen = new Set();
        for (const args of SAMPLE_ARGS) {
          let out;
          try { out = v(...args); } catch { continue; }
          if (typeof out !== 'string' || !out.trim() || UNRENDERED.test(out) || seen.has(out)) continue;
          seen.add(out);
          items.push({ src: `${name}.js ${path}(…)`, text: out, kind: /question|brief/i.test(path) ? 'question' : 'ui', group: `${name}.js STRINGS` });
        }
        return;
      }
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    };
    walk(mod.STRINGS, 'STRINGS');
  }
  return { items, found, missing, noStrings };
}

async function passItems() {
  const passing = await maybeImport('../js/engine/passing.js');
  if (!passing) return null;
  const items = [];
  if (typeof passing.allPassTexts === 'function') {
    for (const { key, text } of passing.allPassTexts('kid')) items.push({ src: `passing.js allPassTexts('kid') ${key}`, text, kind: 'line', group: 'passing.js kid texts' });
  }
  // The pass drills' own kid wording (titles, brief and question), from a few generated drills.
  const passdrill = await maybeImport('../js/engine/passdrill.js');
  if (typeof passdrill?.generatePassDrill === 'function') {
    const catalogue = await loadJSON('data/principles.json');
    for (const [role, seed] of [['LCM', 1], ['LB', 2], ['DM', 3]]) {
      let d = null;
      try { d = passdrill.generatePassDrill({ seed, role, formations, catalogue }); } catch { d = null; }
      if (d) items.push(...drillKidItems(d, `passdrill.js generatePassDrill(${role}, seed ${seed})`));
    }
  }
  return items;
}

async function spotDrillItems() {
  const spotdrill = await maybeImport('../js/engine/spotdrill.js');
  if (typeof spotdrill?.generateSpotDrill !== 'function') return null;
  const items = [];
  for (const [role, principles, seed] of [['LCB', ['D5'], 1], ['LB', ['D4'], 2], ['LCM', ['B4'], 3], ['ST', ['B2'], 4]]) {
    let d = null;
    try { d = spotdrill.generateSpotDrill({ seed, role, principles, formations }); } catch { d = null; }
    if (d) items.push(...drillKidItems(d, `spotdrill.js generateSpotDrill(${role}, ${principles}, seed ${seed})`));
  }
  return items;
}

/** A generated drill's kid wording. */
function drillKidItems(d, src) {
  const group = `${src} kid fields`;
  const out = [];
  for (const [key, kind, text] of [['titleKid', 'title', d.titleKid], ['briefKid', 'brief', d.briefKid], ['questionKid', 'question', d.questionKid], ['takeaway.kid', 'line', d.takeaway?.kid]]) {
    if (typeof text === 'string' && text.trim()) out.push({ src: `${src} ${key}`, text, kind, group });
  }
  for (const m of d.misconceptions ?? []) if (typeof m.textKid === 'string') out.push({ src: `${src} misconception ${m.id} textKid`, text: m.textKid, kind: 'line', group });
  return out;
}

// ---------------------------------------------------------------- the tests

test('copy: the checker counts words, sentences and syllables and grades reading age like Flesch-Kincaid', () => {
  assert.deepEqual(wordsOf('Next: Back Up Your Buddy · 5 plays'), ['Next', 'Back', 'Up', 'Your', 'Buddy', '5', 'plays']);
  assert.deepEqual(sentencesOf('Hard one. Pros miss it too.'), ['Hard one.', 'Pros miss it too.']);
  assert.deepEqual(sentencesOf('Lock it'), ['Lock it']);
  assert.deepEqual(['ball', 'pass', 'angle', 'middle', 'between', 'toward', 'space', 'dangerous', 'together', 'little', 'moved', 'stayed'].map(syllables), [1, 1, 2, 2, 2, 2, 1, 3, 3, 2, 1, 1]);
  assert.deepEqual(['goalkeeper', 'teammates', 'sideline', 'defenders', 'midfielder'].map(syllables), [1, 1, 1, 1, 1], 'football words everyone knows');
  // A plain kid sentence is easy; a coach's sentence is not.
  assert.ok(fkGrade(['Get between your striker and our goal.']) <= 4);
  assert.ok(fkGrade(['Anticipate the opposition\'s transition by recovering centrally behind the ball immediately.']) > 12);
  assert.ok(fkGrade(['Stay wide.', 'Get open.']) < fkGrade(['Maintain positional discipline.']));
  // The problems a string can have.
  const probs = (text, kind = 'line') => problemsOf({ src: 't', text, kind });
  assert.deepEqual(probs('Get between your striker and our goal.'), []);
  assert.ok(probs('Great job, kids!!!').length >= 2);
  assert.ok(probs('D5 says stay goal-side.').some((p) => /principle code/.test(p)));
  assert.ok(probs('The LCB covers.').some((p) => /role code/.test(p)));
  assert.ok(probs('You scored 72/100, a B.').some((p) => /100/.test(p)));
  assert.ok(probs('That is an F.').some((p) => /letter grade/.test(p)));
  assert.ok(probs('Move 5 m wider.').some((p) => /metres/.test(p)));
  assert.ok(probs('Tuck in and press the ball.').length >= 2);
  assert.ok(probs('You are a genius.').some((p) => /person/.test(p)));
  assert.ok(probs('Don\'t break your streak!').some((p) => /streak/.test(p)));
  assert.deepEqual(probs('A cross is coming.'), [], '"A" the word is not a grade');
  assert.deepEqual(probs('Block the pass to their striker.'), [], 'blocking a pass is plain football');
  assert.ok(probs('Find the gap in their low block.').some((p) => /block/.test(p)));
  assert.ok(probs('One two three four five six seven eight nine ten eleven twelve thirteen.', 'question').some((p) => /13 words/.test(p)));
  assert.ok(probs('Hi', 'name').some((p) => /at least 2/.test(p)));
});

test('copy: the rules\' simple wording (text.kid), rendered with real engine vars and every branch', (t) => {
  const { items, broken } = ruleItems();
  assert.deepEqual(broken, [], broken.join('\n'));
  assert.ok(items.filter((i) => i.src.includes('kid.fail')).length >= 60, 'every rule renders its fixes');
  report(items, 'rules text.kid', t);
});

test('copy: the drills\' kid fields (data/scenarios)', async (t) => {
  const { items, broken, count } = await scenarioItems();
  assert.ok(count >= 30, `${count} scenarios`);
  assert.deepEqual(broken, [], broken.join('\n'));
  report(items, 'scenario kid fields', t);
});

test('copy: the principles\' kidName and summary.kid (every category)', async (t) => {
  const { items, count, categories } = await principleItems();
  assert.ok(count >= 70 && categories.length >= 8, `${count} principles in ${categories.length} categories`);
  report(items, 'principles kidName and summary.kid', t);
});

test('copy: the tutorial\'s kid text', async (t) => {
  report(await tutorialItems(), 'tutorial kid text', t);
});

test('copy: the rewards\' words (star words, badges, kits, nicknames)', (t) => {
  report(rewardItems(), 'rewards', t);
});

test('copy: the Road\'s titles (data/road.json, once it exists)', async (t) => {
  const items = await roadItems();
  if (!items) return; // the shell area writes data/road.json
  report(items, 'road.json titles', t);
});

test('copy: the passing texts (js/engine/passing.js, once it exists) and generated drills\' kid fields', async (t) => {
  const pass = await passItems();
  const spot = await spotDrillItems();
  const items = [...(pass ?? []), ...(spot ?? [])];
  if (!items.length) return; // the engine area writes passing.js, passdrill.js and spotdrill.js
  report(items, 'passing texts and generated drills', t);
});

test('copy: the Player UI string tables (STRINGS of every js/ui/player/*.js module that exists)', async (t) => {
  const { items, found, noStrings } = await playerModuleItems();
  assert.deepEqual(noStrings, [], `these Player modules export no STRINGS (KID_REDESIGN §8.1): ${noStrings.join(', ')}`);
  if (!found.length) return; // no Player modules yet
  report(items, `Player STRINGS (${found.join(', ')})`, t);
});
