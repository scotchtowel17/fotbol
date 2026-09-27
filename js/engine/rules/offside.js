// STUB: replaced by the rule implementation. Contract: docs/ARCHITECTURE.md §5.5.
export default {
  id: 'offside',
  principles: ['F4'],
  critical: true,
  weight: () => 0,
  evaluate: () => ({ s: 1, vars: {} }),
  text: {
    standard: { name: 'Stay onside', ok: () => '', fail: () => '', cue: () => '' },
    kid: { name: 'Stay onside', ok: () => '', fail: () => '', cue: () => '' },
  },
};
