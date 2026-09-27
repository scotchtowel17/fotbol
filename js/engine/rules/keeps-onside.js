// STUB: replaced by the rule implementation. Contract: docs/ARCHITECTURE.md §5.5.
export default {
  id: 'keeps-onside',
  principles: ['U4'],
  critical: true,
  weight: () => 0,
  evaluate: () => ({ s: 1, vars: {} }),
  text: {
    standard: { name: "Don't play them onside", ok: () => '', fail: () => '', cue: () => '' },
    kid: { name: "Don't play them onside", ok: () => '', fail: () => '', cue: () => '' },
  },
};
