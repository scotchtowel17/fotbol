// Registry of the principle rules. Contract: docs/ARCHITECTURE.md §5.5.
import offside from './offside.js';
import keepsOnside from './keeps-onside.js';
import levelLine from './level-line.js';
import goalSide from './goal-side.js';
import press from './press.js';
import cover from './cover.js';
import tuck from './tuck.js';
import compact from './compact.js';
import screen from './screen.js';
import width from './width.js';
import pin from './pin.js';
import laneOpen from './lane-open.js';
import supportDistance from './support-distance.js';
import occupancy from './occupancy.js';
import betweenLines from './between-lines.js';
import spacing from './spacing.js';
import boxFill from './box-fill.js';
import recovery from './recovery.js';
import halfSpace from './half-space.js';
import flankShare from './flank-share.js';

export const RULES = Object.freeze([
  offside, keepsOnside, levelLine, goalSide, press, cover, tuck, compact, screen,
  width, pin, laneOpen, supportDistance, occupancy, betweenLines, spacing, boxFill, recovery,
  halfSpace, flankShare,
]);

export const RULES_BY_ID = Object.freeze(Object.fromEntries(RULES.map((r) => [r.id, r])));
