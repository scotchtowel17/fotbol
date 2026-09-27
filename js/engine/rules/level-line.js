// STUB: replaced by the rule implementation. Contract: docs/ARCHITECTURE.md §5.5.
export default {
  id: 'level-line',
  principles: ['U4'],
  critical: false,
  weight: () => 0,
  evaluate: () => ({ s: 1, vars: {} }),
  text: {
    standard: { name: 'Hold the line', ok: () => '', fail: () => '', cue: () => '' },
    kid: { name: 'Hold the line', ok: () => '', fail: () => '', cue: () => '' },
  },
};
