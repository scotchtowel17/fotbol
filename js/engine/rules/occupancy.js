// STUB: replaced by the rule implementation. Contract: docs/ARCHITECTURE.md §5.5.
export default {
  id: 'occupancy',
  principles: ['B5'],
  critical: false,
  weight: () => 0,
  evaluate: () => ({ s: 1, vars: {} }),
  text: {
    standard: { name: 'Lanes and lines', ok: () => '', fail: () => '', cue: () => '' },
    kid: { name: 'Lanes and lines', ok: () => '', fail: () => '', cue: () => '' },
  },
};
