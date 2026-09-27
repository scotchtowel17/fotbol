// STUB: replaced by the rule implementation. Contract: docs/ARCHITECTURE.md §5.5.
export default {
  id: 'press',
  principles: ['D1', 'D2'],
  critical: false,
  weight: () => 0,
  evaluate: () => ({ s: 1, vars: {} }),
  text: {
    standard: { name: 'Press the ball', ok: () => '', fail: () => '', cue: () => '' },
    kid: { name: 'Press the ball', ok: () => '', fail: () => '', cue: () => '' },
  },
};
