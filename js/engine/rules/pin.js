// STUB: replaced by the rule implementation. Contract: docs/ARCHITECTURE.md §5.5.
export default {
  id: 'pin',
  principles: ['B2'],
  critical: false,
  weight: () => 0,
  evaluate: () => ({ s: 1, vars: {} }),
  text: {
    standard: { name: 'Pin their back line', ok: () => '', fail: () => '', cue: () => '' },
    kid: { name: 'Pin their back line', ok: () => '', fail: () => '', cue: () => '' },
  },
};
