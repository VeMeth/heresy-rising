// Minimal stand-in LLM used when no OPENAI_BASE_URL is configured (PASSIVE
// mode). Every `generate` returns
// `{kind:'pass'}` so the session can boot, connect, and observe the game
// without consuming tokens or emitting actions.
//
// `consolidate` is also a no-op: the local profile opts out of phase-end
// consolidation (no point paying a round-trip on an 8k context), so this
// path is reached only via a defensive call. Returning an empty summary
// is the correct contract — the session sees nothing to append and moves on.
export class PassThroughLLM {
  constructor() { this.label = 'passthrough'; }
  async generate(/* { session, prompt } */) { return { kind: 'pass' }; }
  async consolidate(/* { session, phase, round, events } */) { return { summary: '' }; }
}