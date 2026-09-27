// Context builder: derives everything the principle rules need from a frame.
// Contract: docs/ARCHITECTURE.md §5.4. Rationale: docs/RESEARCH.md §5.4.
//
// Duties ("who should be doing what") are computed with the learner standing at
// their layer-A BASE position, not at the spot being judged. The learner's spot is
// then scored against that duty, which avoids circular scoring.

import { dist, median } from './geometry.js';
import { laneOf, thirdOf, isWingLane, OWN_GOAL, LENGTH } from './pitch.js';
import { ROLE_INFO, BACK_LINE, MIDFIELD, parsePlayerId } from './roles.js';

export const CONTEXT_DEFAULTS = Object.freeze({
  pressureRadius: 3, // [D] an opponent this close to the carrier = pressure on the ball
  secondDefenderRadius: 15, // [D] max distance from the first defender to count as the covering 2nd defender
  centreOfPlayRadius: 12, // [D] 2nd attackers are within this of the ball (published 9.15 m is from 3v3 play)
  markRadius: 18, // [D] an opponent further than this from your base is not "yours" to mark
  blockHigh: 45, // [D] back-line x (in the defending team's own frame) at or above this = high block
  blockLow: 25, // [D] below this = low block
});

const OPP_BACK = BACK_LINE;
const OPP_MID = MIDFIELD;

/**
 * @param {import('./types.js').Frame} frame
 * @param {{ learnerId: string, base?: {x:number,y:number}, params?: object }} opts
 */
export function buildContext(frame, { learnerId, base, params = {} }) {
  const P = { ...CONTEXT_DEFAULTS, ...params };
  const { role } = parsePlayerId(learnerId);
  const info = ROLE_INFO[role] ?? { family: 'CM', side: 'C' };
  const learnerPlayer = frame.players.find((p) => p.id === learnerId);
  const baseSpot = base ?? (learnerPlayer ? { x: learnerPlayer.x, y: learnerPlayer.y } : { x: 30, y: 34 });
  const learnerAtBase = { id: learnerId, team: 'us', role, x: baseSpot.x, y: baseSpot.y };

  const teammates = frame.players.filter((p) => p.team === 'us' && p.id !== learnerId);
  const opponents = frame.players.filter((p) => p.team === 'them');
  const usAtBase = [...teammates, learnerAtBase];
  const ball = frame.ball;
  const carrier = frame.carrierId ? frame.players.find((p) => p.id === frame.carrierId) ?? null : null;
  const moment = frame.possession === 'us' ? 'in_possession' : frame.possession === 'them' ? 'out_of_possession' : 'loose';

  // Pressure on the ball: explicit tag wins; otherwise any opponent of the carrier within pressureRadius.
  let pressureOnBall = frame.tags?.pressureOnBall;
  if (pressureOnBall === undefined) {
    if (carrier) {
      const pressers = carrier.team === 'us' ? opponents : usAtBase;
      pressureOnBall = pressers.some((p) => p.role !== 'GK' && dist(p, carrier) <= P.pressureRadius);
    } else pressureOnBall = false;
  }

  // Lines.
  const ourBackLine = usAtBase.filter((p) => BACK_LINE.includes(p.role));
  const ourBackLineX = median(ourBackLine.map((p) => p.x));
  const oppXsDesc = opponents.map((p) => p.x).sort((a, b) => b - a);
  const oppSecondLastX = oppXsDesc.length > 1 ? oppXsDesc[1] : LENGTH;
  const oppLastX = oppXsDesc[0] ?? LENGTH;
  const oppBackLineX = median(opponents.filter((p) => OPP_BACK.includes(p.role)).map((p) => p.x));
  const oppMidLineX = median(opponents.filter((p) => OPP_MID.includes(p.role)).map((p) => p.x));
  const ourMidLineX = median(usAtBase.filter((p) => MIDFIELD.includes(p.role)).map((p) => p.x));

  // Block height of the team out of possession, measured in its own frame.
  const defendingUs = moment !== 'in_possession';
  const backX = defendingUs ? ourBackLineX : LENGTH - oppBackLineX;
  const blockHeight = backX >= P.blockHigh ? 'high' : backX < P.blockLow ? 'low' : 'mid';

  // Duties.
  const outfieldUs = usAtBase.filter((p) => p.role !== 'GK');
  let duty, firstDefender = null, secondDefender = null;
  if (defendingUs) {
    const byBall = [...outfieldUs].sort((a, b) => dist(a, ball) - dist(b, ball));
    firstDefender = byBall[0] ?? null;
    // The cover player sits behind the presser (goal-side of them, not merely of the ball).
    const coverCandidates = outfieldUs
      .filter((p) => p !== firstDefender && p.x < Math.min(ball.x, firstDefender.x) - 1 && dist(p, firstDefender) <= P.secondDefenderRadius)
      .sort((a, b) => dist(a, firstDefender) - dist(b, firstDefender));
    secondDefender = coverCandidates[0] ?? null;
    duty = firstDefender === learnerAtBase ? 'first-defender'
      : secondDefender === learnerAtBase ? 'second-defender' : 'third-defender';
  } else {
    duty = carrier?.id === learnerId ? 'first-attacker'
      : dist(learnerAtBase, ball) <= P.centreOfPlayRadius ? 'second-attacker' : 'third-attacker';
  }

  // Who is "yours": the first defender owns the carrier; everyone else the nearest opponent to their base.
  let markTarget = null;
  if (defendingUs) {
    if (duty === 'first-defender') markTarget = carrier;
    else {
      let best = Infinity;
      for (const o of opponents) {
        if (o.role === 'GK' || o === carrier) continue;
        const d = dist(o, learnerAtBase);
        if (d < best && d <= P.markRadius) { best = d; markTarget = o; }
      }
    }
  }

  // The opponent most threatening to our goal (excluding the carrier and their keeper).
  let dangerousAttacker = null;
  {
    let best = Infinity;
    for (const o of opponents) {
      if (o.role === 'GK' || o === carrier) continue;
      const d = dist(o, OWN_GOAL);
      if (d < best) { best = d; dangerousAttacker = o; }
    }
  }

  const lane = laneOf(ball.y);
  const widthHolders = frame.tags?.widthHolders;
  const widthHolder = moment === 'in_possession' && (Array.isArray(widthHolders) ? widthHolders.includes(role) : info.family === 'W');

  return {
    frame,
    params: P,
    learner: { id: learnerId, team: 'us', role, family: info.family, side: info.side, base: baseSpot },
    moment,
    ball,
    carrier,
    carrierFacing: frame.tags?.carrierFacing ?? 'forward',
    pressureOnBall: !!pressureOnBall,
    ballZone: { third: thirdOf(ball.x), lane, wing: isWingLane(ball.y) },
    ballSide: lane <= 1 ? 'L' : lane >= 3 ? 'R' : 'C',
    teammates,
    usAtBase,
    opponents,
    lines: { ourBackLine, ourBackLineX, ourMidLineX, oppSecondLastX, oppLastX, oppBackLineX, oppMidLineX },
    blockHeight,
    duty,
    firstDefender,
    secondDefender,
    markTarget,
    dangerousAttacker,
    widthHolder,
  };
}
