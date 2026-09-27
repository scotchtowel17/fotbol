// STUB: replaced by the rule implementation. Contract: docs/ARCHITECTURE.md §5.5.
export default {
  id: 'between-lines',
  principles: ['P2'],
  critical: false,
  weight: () => 0,
  evaluate: () => ({ s: 1, vars: {} }),
  text: {
    standard: { name: 'Between the lines', ok: () => '', fail: () => '', cue: () => '' },
    kid: { name: 'Between the lines', ok: () => '', fail: () => '', cue: () => '' },
  },
};
