// STUB: replaced by the rule implementation. Contract: docs/ARCHITECTURE.md §5.5.
export default {
  id: 'tuck',
  principles: ['D4', 'U5'],
  critical: false,
  weight: () => 0,
  evaluate: () => ({ s: 1, vars: {} }),
  text: {
    standard: { name: 'Tuck in on the far side', ok: () => '', fail: () => '', cue: () => '' },
    kid: { name: 'Tuck in on the far side', ok: () => '', fail: () => '', cue: () => '' },
  },
};
