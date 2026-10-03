// Role IDs and metadata for an 11-a-side 4-3-3. Pure data + helpers.

export const ROLES = Object.freeze(['GK', 'LCB', 'RCB', 'LB', 'RB', 'DM', 'LCM', 'RCM', 'LW', 'RW', 'ST']);

export const ROLE_INFO = Object.freeze({
  GK: { family: 'GK', side: 'C', label: 'Goalkeeper', short: 'GK', num: 1 },
  LCB: { family: 'CB', side: 'L', label: 'Left centre-back', short: 'LCB', num: 4 },
  RCB: { family: 'CB', side: 'R', label: 'Right centre-back', short: 'RCB', num: 5 },
  LB: { family: 'FB', side: 'L', label: 'Left back', short: 'LB', num: 3 },
  RB: { family: 'FB', side: 'R', label: 'Right back', short: 'RB', num: 2 },
  DM: { family: 'DM', side: 'C', label: 'Holding midfielder (#6)', short: '6', num: 6 },
  LCM: { family: 'CM', side: 'L', label: 'Left central midfielder (#8)', short: '8', num: 8 },
  RCM: { family: 'CM', side: 'R', label: 'Right central midfielder (#8)', short: '8', num: 10 },
  LW: { family: 'W', side: 'L', label: 'Left winger', short: 'LW', num: 11 },
  RW: { family: 'W', side: 'R', label: 'Right winger', short: 'RW', num: 7 },
  ST: { family: 'ST', side: 'C', label: 'Striker (#9)', short: '9', num: 9 },
});

export const FAMILIES = Object.freeze(['GK', 'CB', 'FB', 'DM', 'CM', 'W', 'ST']);
export const FAMILY_LABEL = Object.freeze({
  GK: 'Goalkeeper', CB: 'Centre-back', FB: 'Full-back', DM: 'Holding midfielder (#6)',
  CM: 'Central midfielder (#8)', W: 'Winger', ST: 'Striker (#9)',
});

/** Roles a learner can pick in v1 (outfield only; GK arrives in v1.1). */
export const LEARNABLE_ROLES = Object.freeze(ROLES.filter((r) => r !== 'GK'));
/** Roles Coach mode's Explore and the dev playground offer: every learnable role, and the keeper (G1, gk-angle-depth). */
export const EXPLORE_ROLES = Object.freeze([...LEARNABLE_ROLES, 'GK']);

export const BACK_LINE = Object.freeze(['LB', 'LCB', 'RCB', 'RB']);
export const MIDFIELD = Object.freeze(['DM', 'LCM', 'RCM']);
export const FORWARDS = Object.freeze(['LW', 'ST', 'RW']);

const MIRROR = { LCB: 'RCB', RCB: 'LCB', LB: 'RB', RB: 'LB', LCM: 'RCM', RCM: 'LCM', LW: 'RW', RW: 'LW' };

/** Left/right counterpart of a role ('LCB' → 'RCB'); central roles map to themselves. */
export const mirrorRole = (role) => MIRROR[role] ?? role;

export const familyOf = (role) => ROLE_INFO[role]?.family;
export const sideOf = (role) => ROLE_INFO[role]?.side;

/** 'us-LCB' */
export const playerId = (team, role) => `${team}-${role}`;

/** 'us-LCB' → { team: 'us', role: 'LCB' } */
export function parsePlayerId(id) {
  const i = id.indexOf('-');
  return { team: id.slice(0, i), role: id.slice(i + 1) };
}

/** Mirror a player id left↔right, keeping the team: 'them-LW' → 'them-RW'. */
export function mirrorPlayerId(id) {
  const { team, role } = parsePlayerId(id);
  return playerId(team, mirrorRole(role));
}

/** HELIOS base formation role number → our role ID. */
export const HELIOS_ROLE = Object.freeze({
  1: 'GK', 2: 'LCB', 3: 'RCB', 4: 'LB', 5: 'RB', 6: 'DM', 7: 'LCM', 8: 'RCM', 9: 'LW', 10: 'RW', 11: 'ST',
});
