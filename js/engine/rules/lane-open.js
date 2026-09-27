// STUB: replaced by the rule implementation. Contract: docs/ARCHITECTURE.md §5.5.
export default {
  id: 'lane-open',
  principles: ['B3'],
  critical: false,
  weight: () => 0,
  evaluate: () => ({ s: 1, vars: {} }),
  text: {
    standard: { name: 'Open passing lane', ok: () => '', fail: () => '', cue: () => '' },
    kid: { name: 'Open passing lane', ok: () => '', fail: () => '', cue: () => '' },
  },
};
