// '#/trophies': the trophy room. Since the 2026-10-01 audit this is the SAME room as '#/card' (one implementation,
// js/ui/player/card.js): the two rooms showed the same rewards state as two 300-line layouts, so the card's won.
// Old tab addresses keep working ('#/trophies/album' is the sticker album, '#/trophies/badges' the badges,
// '#/trophies/kit' the kit locker); shortDay moved into card.js and is re-exported for old importers.

export { mount, shortDay } from '../player/card.js';
