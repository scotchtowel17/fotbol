// STUB: replaced by the rule implementation. Contract: docs/ARCHITECTURE.md §5.5.
export default {
  id: 'goal-side',
  principles: ['D5'],
  critical: true,
  weight: () => 0,
  evaluate: () => ({ s: 1, vars: {} }),
  text: {
    standard: { name: 'Goal-side of your opponent', ok: () => '', fail: () => '', cue: () => '' },
    kid: { name: 'Goal-side of your opponent', ok: () => '', fail: () => '', cue: () => '' },
  },
};
