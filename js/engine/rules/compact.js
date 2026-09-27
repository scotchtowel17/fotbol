// STUB: replaced by the rule implementation. Contract: docs/ARCHITECTURE.md §5.5.
export default {
  id: 'compact',
  principles: ['U1', 'U2'],
  critical: false,
  weight: () => 0,
  evaluate: () => ({ s: 1, vars: {} }),
  text: {
    standard: { name: 'Stay compact', ok: () => '', fail: () => '', cue: () => '' },
    kid: { name: 'Stay compact', ok: () => '', fail: () => '', cue: () => '' },
  },
};
