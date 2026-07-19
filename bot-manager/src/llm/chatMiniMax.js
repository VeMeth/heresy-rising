// ChatMiniMax — a minimal LangChain ChatModel subclass that calls MiniMax's
// chat-completion HTTP API directly. The spec locks the LLM stack on
// LangChain.js + MiniMax-M3; since `@langchain/MiniMax` doesn't ship as a
// first-party adapter, we honour the lock by subclassing `BaseChatModel`
// ourselves. This gives us LangChain's prompt/memory/integration primitives
// without depending on a non-existent package.

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';

const ROLE_MAP = {
  system: 'system', human: 'user', user: 'user', ai: 'assistant', assistant: 'assistant', function: 'assistant', tool: 'assistant'
};

function messageToRole(m) {
  const t = typeof m._getType === 'function' ? m._getType() : (m.role || 'user');
  return ROLE_MAP[t] || 'user';
}

export class ChatMiniMax extends BaseChatModel {
  constructor({ apiKey, model = 'MiniMax-M3', baseUrl = 'https://api.minimax.io', temperature = 0.7, maxTokens = 512, topP = 0.9, timeoutMs = 30000, maxRetries = 2 } = {}) {
    super({});
    if (!apiKey) throw new Error('ChatMiniMax requires apiKey');
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.topP = topP;
    this.timeoutMs = timeoutMs;
    this.maxRetries = Math.max(0, Number(maxRetries) | 0);
    this._label = 'minimax';
  }

  _llmType() { return 'minimax'; }

  /**
   * @param {import('@langchain/core/messages').BaseMessage[]} messages
   * @returns {Promise<{generations:Array, llmOutput?:Record<string,unknown>}>}
   */
  async _generate(messages, _options) {
    const payload = {
      model: this.model,
      messages: (messages || []).map((m) => ({ role: messageToRole(m), content: m.content || '' })),
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      top_p: this.topP
    };

    let lastErr = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        const text = await res.text();
        let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        if (!res.ok) {
          lastErr = new Error(`MiniMax ${res.status}: ${(data?.error?.message || text || '').slice(0, 200)}`);
          // Don't retry on auth/forbidden — those won't be fixed by reissuing.
          if (res.status === 401 || res.status === 403) throw lastErr;
          continue;
        }
        const content = data?.choices?.[0]?.message?.content ?? '';
        const totalTokens = data?.usage?.total_tokens ?? Math.ceil((content || '').length / 4);
        return {
          generations: [{ text: content, message: new AIMessage(content), generationInfo: { totalTokens } }],
          llmOutput: { totalTokens }
        };
      } catch (e) {
        lastErr = e;
        if (e.name === 'AbortError') continue;
        // Re-throw auth straight away; retry other transport errors.
        if (/MiniMax (401|403)/.test(e.message || '')) throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || new Error('MiniMax call failed');
  }
}