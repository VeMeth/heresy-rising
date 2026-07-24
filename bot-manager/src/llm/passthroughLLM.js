// Minimal stand-in LLM used when no OPENAI_BASE_URL is configured (PASSIVE
// mode). Every `generate` returns
// `{kind:'pass'}` so the session can boot, connect, and observe the game
// without consuming tokens or emitting actions.
export class PassThroughLLM {
  constructor() { this.label = 'passthrough'; }
  async generate(/* { session, prompt } */) { return { kind: 'pass' }; }
}