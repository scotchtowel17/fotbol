// Press (D1, D2): the first defender closes the carrier down from the goal side,
// on the ball-to-goal line when play is central in our half, on its inside when the ball is in
// a wing lane (so the carrier is shown down the touchline), and, in the opponents' half, on the
// inside of a carrier off the middle (a curved run that shuts the pass inside and shows them
// wide: D2, R5, the D9 idea). That lean is context.js pressLean(), which scene.js also uses to
// place the automatic presser, so the learner's base and the ghost stand where the rule wants.

import { band, lerp } from '../geometry.js';
import { OWN_GOAL, MID_Y } from '../pitch.js';
import { pressLean } from '../context.js';
import { perContext, paramsFor, notApplicable, defending, nameOf, kidNameOf, signedAngle, whole } from './_util.js';

export const PRESS_DEFAULTS = Object.freeze({
  weight: 3, // [S] RESEARCH 5.6: press 3 when it is the learner's duty
  distMin: 1.5, // [D] D1: stop 1.5-3 m from the carrier
  distMax: 3, // [D]
  distSoft: 3, // [D] metres outside the band where credit reaches 0
  centralAngle: 20, // [D] D1: within 20° of the ball-to-goal line when play is central
  wingAngleMin: 5, // [D] D2: in a wing lane, stand inside the ball-to-goal line...
  wingAngleMax: 40, // [D] ...but not so far round that the outside route to goal opens
  wingAim: 20, // [D] target angle inside the line in a wing lane
  centralAim: 25, // [D] D2/R5: in the opponents' half, the target angle inside the line for a carrier off the middle (SCENE_DEFAULTS.pressAim)
  centralInside: 45, // [D] ...full credit up to this far inside (the curved run)...
  centralOutside: 10, // [D] ...and only this far outside (the pass inside stays shut)
  leanCentre: 2, // [D] no inside within this of y = 34; the lean is full from the half-space (SCENE_DEFAULTS.pressLeanCentre)
  leanFrom: 45, // [D] the lean fades in with the carrier's x from here... (SCENE_DEFAULTS.pressLeanFrom)
  leanTo: 55, // [D] ...to here: in our own half the press stays on the line to goal (D1) (SCENE_DEFAULTS.pressLeanTo)
  leanWording: 0.5, // [D] from this much lean on, a miss on the angle is worded as the curved run (D2), not the line (D1)
  angleSoft: 30, // [D] degrees outside the band where credit reaches 0
});

const prep = perContext((ctx) => {
  if (!defending(ctx) || ctx.duty !== 'first-defender') return null;
  const D = paramsFor(ctx, 'press', PRESS_DEFAULTS);
  const ref = ctx.carrier ?? ctx.ball; // a loose ball is pressed where it lies
  const gx = OWN_GOAL.x - ref.x, gy = OWN_GOAL.y - ref.y;
  const gl = Math.hypot(gx, gy) || 1;
  const ux = gx / gl, uy = gy / gl;
  const wing = ctx.ballZone.wing;
  // Positive signed angles point from the ball-to-goal line toward the middle of the pitch.
  const insideSign = ref.y >= MID_Y ? 1 : -1;
  // The angle band, in degrees inside the line: the wing band, or the central band leaning inside in their half.
  const lean = wing ? 0 : pressLean('us', ref, D);
  const lo = wing ? D.wingAngleMin : lerp(-D.centralAngle, -D.centralOutside, lean);
  const hi = wing ? D.wingAngleMax : lerp(D.centralAngle, D.centralInside, lean);
  const aimDeg = wing ? D.wingAim : lean * D.centralAim;
  const aim = (aimDeg * insideSign * Math.PI) / 180;
  const dx = ux * Math.cos(aim) - uy * Math.sin(aim), dy = ux * Math.sin(aim) + uy * Math.cos(aim);
  const dPref = (D.distMin + D.distMax) / 2;
  return {
    D, w: D.weight, px: ref.x, py: ref.y, ux, uy, wing, insideSign, lo, hi, curved: wing || lean >= D.leanWording,
    tx: ref.x + dx * dPref, ty: ref.y + dy * dPref,
    who: nameOf(ctx.carrier, ctx), whoKid: kidNameOf(ctx.carrier, ctx),
  };
});

export default {
  id: 'press',
  principles: ['D1', 'D2'],
  critical: false,
  weight: (ctx) => prep(ctx)?.w ?? 0,
  evaluate(ctx, spot) {
    const p = prep(ctx);
    if (!p) return notApplicable();
    const D = p.D;
    const vx = spot.x - p.px, vy = spot.y - p.py;
    const d = Math.hypot(vx, vy);
    const sd = band(d, D.distMin, D.distMax, D.distSoft);
    const ang = d < 1e-6 ? 0 : signedAngle(p.ux, p.uy, vx, vy) * p.insideSign; // + = inside the line
    const sa0 = band(ang, p.lo, p.hi, D.angleSoft);
    // The angle means little on top of the carrier: fade it in over distMin so there is no cliff there.
    const sa = 1 - (1 - sa0) * Math.min(d / D.distMin, 1);
    const s = sd * sa;
    let issue = 'ok';
    if (s < 0.999) {
      if (Math.abs(ang) > 90 && d > 0.5) issue = 'wrong-side';
      else if (sd <= sa) issue = d > D.distMax ? 'far' : 'close';
      else if (!p.curved) issue = 'line';
      else if (ang > p.hi) issue = 'too-round';
      else issue = p.wing ? 'show-inside' : 'inside';
    }
    // D1 is the pressure itself (distance, goal side); D2 the angle that shows the carrier away from goal.
    const principle = issue === 'show-inside' || issue === 'inside' || issue === 'too-round' ? 'D2' : 'D1';
    // along (unrounded): m from the ball toward our goal (< 0: past the ball, the wrong side); kidscore.js reads it
    const along = vx * p.ux + vy * p.uy;
    return { s, target: { x: p.tx, y: p.ty }, vars: { who: p.who, whoKid: p.whoKid, dist: whole(d), issue, principle, along } };
  },
  text: {
    standard: {
      name: 'Press the ball',
      ok: (v) => `You close ${v.who} down from the goal side, so they have to slow down.`,
      fail: (v) => ({
        far: `Close ${v.who} down to about 2 m, because from ${v.dist} m away they have time to pick a pass.`,
        close: `Stop about 2 m off ${v.who} so one touch can't take them past you.`,
        'wrong-side': `Get goal-side of ${v.who} before you press, so they can't run straight at our goal.`,
        line: `Press from between ${v.who} and the middle of our goal to shut the direct route.`,
        'show-inside': `Press from the inside of ${v.who} so you show them down the touchline, away from the middle.`,
        inside: `Curve your run and press from the inside of ${v.who}, so the pass inside is shut and they have to go wide.`,
        'too-round': `Don't swing so far inside ${v.who} that the outside route to our goal opens up.`,
      })[v.issue] ?? `Close ${v.who} down from the goal side.`,
      cue: (v) => `Who should close ${v.who} down, and from which side?`,
    },
    kid: {
      name: 'Go to the ball',
      ok: () => 'Good, you are close and blocking the way to our goal.',
      fail: (v) => ({
        far: `Get closer to ${v.whoKid}, about two steps away.`,
        close: "Stop about two steps away so they can't dribble past you.",
        'wrong-side': `Get between ${v.whoKid} and our goal first.`,
        line: `Stand between ${v.whoKid} and the middle of our goal.`,
        'show-inside': 'Stand on the inside so they have to go toward the sideline.',
        inside: `Come from the middle side of ${v.whoKid}, so they have to go wide.`,
        'too-round': 'Not so far inside, stay between them and our goal.',
      })[v.issue] ?? `Get close to ${v.whoKid} and block the way to goal.`,
      cue: () => 'Who has the ball, and who should go to them?',
    },
  },
  cue(ctx) {
    return ctx.carrier ? { type: 'player', id: ctx.carrier.id } : { type: 'point', x: ctx.ball.x, y: ctx.ball.y };
  },
};
