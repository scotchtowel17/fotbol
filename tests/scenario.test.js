import { test, assert, approx, loadJSON, isNode } from './harness.js';
import { validateScenario, mirrorScenario, normalizeScenario, learnerId } from '../js/engine/scenario.js';
import { frameAt, timing } from '../js/engine/timeline.js';
import { createFormation } from '../js/engine/formation.js';
import { mirrorPlayerId } from '../js/engine/roles.js';

const example = await loadJSON('data/scenarios/_example.json');
const clone = (o) => JSON.parse(JSON.stringify(o));
const PRINCIPLES = { D3: { id: 'D3' }, R1: { id: 'R1' }, U4: { id: 'U4' } };

/** Apply `edit` to a copy of the example and return the validation errors. */
function errorsAfter(edit, opts) {
  const s = clone(example);
  edit(s);
  return validateScenario(s, opts);
}
const hasError = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected an error matching ${re}, got ${JSON.stringify(errs)}`);

test('the example scenario is valid (with and without a principle catalogue)', () => {
  assert.deepEqual(validateScenario(example), []);
  assert.deepEqual(validateScenario(example, { principles: PRINCIPLES }), []);
  assert.deepEqual(validateScenario(example, { principles: { list: Object.values(PRINCIPLES) } }), []);
  assert.deepEqual(validateScenario(example, { principles: ['D3', 'R1'] }), []);
  assert.equal(learnerId(example), 'us-LCB');
});

test('validation catches identity, role and principle problems', () => {
  hasError(errorsAfter((s) => { s.id = 'Bad Id'; }), /kebab-case/);
  hasError(errorsAfter((s) => { s.learner.role = 'GK'; }), /learner\.role/);
  hasError(errorsAfter((s) => { s.learner.role = 'CAM'; }), /learner\.role/);
  hasError(errorsAfter((s) => { s.moment = 'defending'; }), /moment/);
  hasError(errorsAfter((s) => { s.principles = []; }), /principles/);
  hasError(errorsAfter(() => {}, { principles: { D3: {} } }), /"R1" is not in the principle catalogue/);
  assert.deepEqual(validateScenario(null), ['scenario must be a JSON object']);
});

test('validation catches timing problems', () => {
  hasError(errorsAfter((s) => { s.timeline.freezeAt = 7; }), /freezeAt \(7\) is after duration/);
  hasError(errorsAfter((s) => { s.timeline.ball[2].t = 0.5; }), /timeline\.ball\[2\]\.t \(0\.5\) must be after the previous key/);
  hasError(errorsAfter((s) => { s.timeline.ball.at(-1).t = 6.5; }), /after duration/);
  hasError(errorsAfter((s) => { s.timeline.carrier[1].t = -1; }), /negative/);
  hasError(errorsAfter((s) => { s.timeline.possession = []; }), /possession must have at least one key/);
  hasError(errorsAfter((s) => { s.timeline.duration = 0; }), /duration must be a positive number/);
});

test('validation catches off-pitch coordinates and bad ids', () => {
  hasError(errorsAfter((s) => { s.timeline.ball[0].x = 120; }), /timeline\.ball\[0\] \(120, 46\.5\) is off the pitch/);
  assert.deepEqual(errorsAfter((s) => { s.timeline.ball[0].y = 69.5; }), [], 'small slack for throw-ins');
  hasError(errorsAfter((s) => { s.answer.ideal = { x: 30, y: -5 }; }), /answer\.ideal/);
  hasError(errorsAfter((s) => { s.timeline.players.overrides[0].id = 'them-9'; }), /not a player id/);
  hasError(errorsAfter((s) => { s.timeline.carrier[2].id = 'them-10'; }), /not a player id/);
  hasError(errorsAfter((s) => { s.timeline.possession[0].team = 'home'; }), /'us', 'them' or 'none'/);
  hasError(errorsAfter((s) => { s.timeline.players.overrides.push(clone(s.timeline.players.overrides[1])); }), /overridden twice/);
  hasError(errorsAfter((s) => { s.misconceptions[0].region = { type: 'circle', x: 30, y: 30, r: 0 }; }), /positive radius/);
  hasError(errorsAfter((s) => { s.misconceptions[1].region.x1 = 20; }), /x0 < x1/);
});

test('validation catches inconsistent tracks', () => {
  hasError(errorsAfter((s) => { s.timeline.players.overrides.push({ id: 'us-LCB', keys: [{ t: 0, x: 30, y: 30 }] }); }), /learner \(us-LCB\) must not have an override/);
  hasError(errorsAfter((s) => { s.timeline.carrier[0].id = 'us-LCB'; }), /learner \(us-LCB\) cannot be the carrier/);
  hasError(errorsAfter((s) => { s.timeline.carrier[2].id = 'us-DM'; }), /us-DM has the ball but possession is 'them'/);
  hasError(errorsAfter((s) => { s.timeline.possession = [{ t: 0, team: 'none' }]; }), /possession is 'none'/);
  // Overrides win over carrier placement, so an overridden carrier must actually be at the ball.
  hasError(errorsAfter((s) => { s.timeline.players.overrides[0].keys[4].x = 40; }), /them-ST has the ball from t=2 but its override is .* m from the ball/);
  hasError(errorsAfter((s) => { s.timeline.possession = [{ t: 0, team: 'them' }, { t: 3, team: 'us' }]; s.timeline.carrier.push({ t: 3, id: 'us-RCB' }); }), /moment is out_of_possession but possession at freezeAt/);
  hasError(errorsAfter((s) => { s.answer = { mode: 'authored' }; }), /needs answer\.ideal/);
  hasError(errorsAfter((s) => { s.timeline.tags[0].carrierFacing = 'up'; }), /carrierFacing/);
  hasError(errorsAfter((s) => { s.timeline.ball[1].event = 'dribble'; }), /event "dribble"/);
});

test('mirroring swaps sides and ids, and mirroring twice gives back the original exactly', () => {
  const m = mirrorScenario(example);
  assert.equal(m.id, `${example.id}-m`);
  assert.equal(m.mirrorOf, example.id);
  assert.equal(m.learner.role, 'RCB');
  assert.equal(learnerId(m), 'us-RCB');
  assert.equal(m.timeline.carrier[0].id, 'them-RCM');
  assert.deepEqual(m.timeline.players.overrides.map((o) => o.id), ['them-ST', 'us-LCB', 'us-DM']);
  m.timeline.ball.forEach((k, i) => { approx(k.x, example.timeline.ball[i].x); approx(k.y, 68 - example.timeline.ball[i].y); assert.equal(k.event, example.timeline.ball[i].event); });
  approx(m.answer.ideal.y, 68 - example.answer.ideal.y);
  approx(m.misconceptions[0].region.y, 68 - example.misconceptions[0].region.y);
  const r = example.misconceptions[1].region, mr = m.misconceptions[1].region;
  assert.deepEqual([mr.y0, mr.y1], [68 - r.y1, 68 - r.y0], 'rect stays y0 < y1');
  assert.deepEqual(validateScenario(m, { principles: PRINCIPLES }), []);
  assert.deepEqual(mirrorScenario(m), example);
  assert.deepEqual(example, clone(example), 'input untouched');

  const shapes = clone(example);
  shapes.misconceptions.push({ id: 'poly', region: { type: 'polygon', points: [{ x: 20, y: 10.3 }, { x: 25, y: 12.7 }, { x: 22, y: 17.1 }] } });
  shapes.learner.start = { x: 24.4, y: 29.9 };
  shapes.timeline.tags.push({ t: 5, widthHolders: ['LB', 'RW'] });
  const back = mirrorScenario(mirrorScenario(shapes));
  assert.deepEqual(back, shapes);
  assert.deepEqual(mirrorScenario(shapes).timeline.tags.at(-1).widthHolders, ['RB', 'LW']);
});

test('a mirrored scenario plays back as the mirror image (linear formation is left/right symmetric)', () => {
  const F = createFormation();
  const formations = { us: F, them: F };
  const m = mirrorScenario(example);
  for (const t of [0, 1.5, timing(example).freezeAt]) {
    const a = frameAt(example, t, { formations }), b = frameAt(m, t, { formations });
    assert.equal(b.carrierId, a.carrierId && mirrorPlayerId(a.carrierId));
    const byId = Object.fromEntries(b.players.map((p) => [p.id, p]));
    for (const p of a.players) {
      const q = byId[mirrorPlayerId(p.id)];
      assert.ok(Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - (68 - p.y)) < 0.5, `${p.id} mirrors at t = ${t}`);
    }
  }
});

test('normalizeScenario fills defaults, converts legacy forms, and the result validates', () => {
  const minimal = {
    id: 'minimal-scenario', title: 'Minimal', moment: 'out_of_possession', principles: ['D3'], learner: { role: 'RB' },
    timeline: { ball: [{ t: 2, x: 40, y: 50 }, { t: 0, x: 50, y: 50 }], tags: { carrierFacing: 'forward' } },
    answer: { override: { x: 30, y: 55, tx: 2, ty: 3 } },
  };
  const n = normalizeScenario(minimal);
  assert.equal(n.brief, '');
  assert.deepEqual(n.timeline.ball.map((k) => k.t), [0, 2], 'keys sorted');
  assert.deepEqual(n.timeline.possession, [{ t: 0, team: 'them' }], 'possession from the moment');
  assert.deepEqual(n.timeline.carrier, []);
  assert.deepEqual(n.timeline.players, { auto: true, overrides: [] });
  assert.deepEqual(n.timeline.tags, [{ t: 0, carrierFacing: 'forward' }]);
  assert.equal(n.timeline.duration, 2);
  assert.equal(n.timeline.freezeAt, 2);
  assert.deepEqual(n.answer, { mode: 'engine', ideal: { x: 30, y: 55 }, tol: { tx: 2, ty: 3 } });
  assert.deepEqual([n.misconceptions, n.difficulty, n.params], [[], 0, {}]);
  assert.deepEqual(validateScenario(n), []);
  assert.equal(minimal.timeline.ball[0].t, 2, 'input untouched');
  // The example is already complete: normalising it changes nothing but adds empty params.
  assert.deepEqual(normalizeScenario(example), { ...example, params: {} });
});

test('npm run check judges a scenario without freezeAt at its duration (the freeze frame), like one that sets it', async () => {
  if (!isNode) return; // scripts/ is Node tooling
  const { checkScenario } = await import('../scripts/check-scenarios.mjs');
  const F = createFormation(await loadJSON('data/formations/helios-433.json'));
  const formations = { us: F, them: F };
  const at = (s, t) => s.filter((k) => k.t <= t);
  const trimmed = clone(example);
  const tl = trimmed.timeline;
  tl.duration = 4.2;
  tl.ball = at(tl.ball, 4.2);
  for (const o of tl.players.overrides) o.keys = at(o.keys, 4.2);
  const withFreeze = { ...clone(trimmed), id: 'with-freeze' };
  withFreeze.timeline.freezeAt = 4.2;
  const noFreeze = { ...clone(trimmed), id: 'no-freeze' };
  delete noFreeze.timeline.freezeAt;
  const a = checkScenario(withFreeze, { principles: PRINCIPLES, formations });
  const b = checkScenario(noFreeze, { principles: PRINCIPLES, formations });
  assert.deepEqual([a.errors, b.errors], [[], []]);
  assert.equal(b.t, 4.2, 'freezeAt defaults to the duration, not undefined (t = 0)');
  assert.equal(b.ctx.duty, a.ctx.duty);
  assert.deepEqual(b.ghost.spot, a.ghost.spot);
  assert.equal(b.ideal.disagree, false, 'no false key-disagreement warning');
  assert.deepEqual(checkScenario({ ...clone(example), id: 'Bad Id' }, { principles: PRINCIPLES, formations }).errors.length > 0, true);
});
