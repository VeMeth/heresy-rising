// Minimal stand-in LLM used before the real ChatMiniMax is wired in (Phase 4)
// and as a default when no LLM is configured. Every `generate` returns
// `{kind:'pass'}` so the session can boot, connect, and observe the game
// without consuming tokens or emitting actions.
export class PassThroughLLM {
  constructor() { this.label = 'passthrough'; }
  async generate(/* { session, prompt } */) { return { kind: 'pass' }; }
}