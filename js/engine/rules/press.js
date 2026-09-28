// Press (D1, D2): the first defender closes the carrier down from the goal side,
// on the ball-to-goal line when play is central, on its inside when the ball is in
// a wing lane (so the carrier is shown down the touchline).

import { band } from '../geometry.js';
import { OWN_GOAL, MID_Y } from '../pitch.js';
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
  const aim = ((wing ? D.wingAim : 0) * insideSign * Math.PI) / 180;
  const dx = ux * Math.cos(aim) - uy * Math.sin(aim), dy = ux * Math.sin(aim) + uy * Math.cos(aim);
  const dPref = (D.distMin + D.distMax) / 2;
  return {
    D, w: D.weight, px: ref.x, py: ref.y, ux, uy, wing, insideSign,
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
    const sa0 = p.wing ? band(ang, D.wingAngleMin, D.wingAngleMax, D.angleSoft) : band(ang, -D.centralAngle, D.centralAngle, D.angleSoft);
    // The angle means little on top of the carrier: fade it in over distMin so there is no cliff there.
    const sa = 1 - (1 - sa0) * Math.min(d / D.distMin, 1);
    const s = sd * sa;
    let issue = 'ok';
    if (s < 0.999) {
      if (Math.abs(ang) > 90 && d > 0.5) issue = 'wrong-side';
      else if (sd <= sa) issue = d > D.distMax ? 'far' : 'close';
      else if (!p.wing) issue = 'line';
      else issue = ang < D.wingAngleMin ? 'show-inside' : 'too-round';
    }
    return { s, target: { x: p.tx, y: p.ty }, vars: { who: p.who, whoKid: p.whoKid, dist: whole(d), issue } };
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
        'too-round': `Don't swing so far inside ${v.who} that the outside route to our goal opens up.`,
      })[v.issue] ?? `Close ${v.who} down from the goal side.`,
      cue: (v) => `Who should close ${v.who} down, and from which side?`,
    },
    kid: {
      name: 'Close down the ball',
      ok: () => 'Great pressure, you are close and blocking the way to goal.',
      fail: (v) => ({
        far: `Get closer to ${v.whoKid}, about two steps away.`,
        close: "Stop about two steps away so they can't dribble past you.",
        'wrong-side': `Get between ${v.whoKid} and our goal first.`,
        line: `Stand between ${v.whoKid} and the middle of our goal.`,
        'show-inside': 'Stand on the inside so they have to go down the sideline.',
        'too-round': 'Not so far inside, stay between them and our goal.',
      })[v.issue] ?? `Get close to ${v.whoKid} and block the way to goal.`,
      cue: () => 'Who has the ball, and who should close them down?',
    },
  },
  cue(ctx) {
    return ctx.carrier ? { type: 'player', id: ctx.carrier.id } : { type: 'point', x: ctx.ball.x, y: ctx.ball.y };
  },
};
