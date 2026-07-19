import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

// Test double for any ChatModel that returns AIMessage objects. It satisfies
// the `await llm.invoke(messages) -> AIMessage` contract used by `ActionLLM`
// without touching MiniMax's HTTP API. Pass an array of pre-baked response
// strings (or AIMessage objects); each invoke pops one in order.
export class MockChatLLM {
  constructor(scripts = []) {
    this.scripts = scripts;
    this.calls = 0;
    this._label = 'mock';
    this.received = [];
  }
  async invoke(messages, _options) {
    this.received.push(messages);
    const next = this.scripts[this.calls++] ?? '';
    if (typeof next === 'string') return new AIMessage(next);
    return next;
  }
  async _generate(messages, _options) {
    this.received.push(messages);
    const next = this.scripts[this.calls++] ?? '';
    const content = typeof next === 'string' ? next : (next?.content || '');
    return { generations: [{ text: content, message: new AIMessage(content), generationInfo: {} }] };
  }
}

// Convenience: `human`/`system` constructors for tests that want to inspect
// what messages the action generator emits.
export const msg = { human: (t) => new HumanMessage(t), system: (t) => new SystemMessage(t) };