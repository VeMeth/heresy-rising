// Test double for the plain OpenAI-compatible `{content, usage}` contract
// (OpenAIChat's `.chat(messages) -> {content, usage}`). Pass an array of
// pre-baked response strings (or {content, usage} objects); each `.chat()`
// call pops one in order.
export class MockChatLLM {
  constructor(scripts = []) {
    this.scripts = scripts;
    this.calls = 0;
    this._label = 'mock';
    this.received = [];
  }
  async chat(messages) {
    this.received.push(messages);
    const next = this.scripts[this.calls++] ?? '';
    if (typeof next === 'string') return { content: next, usage: {} };
    return { content: next.content ?? '', usage: next.usage || {} };
  }
}
