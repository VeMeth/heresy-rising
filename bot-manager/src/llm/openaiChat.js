// OpenAIChat — plain-fetch client for any OpenAI-compatible chat-completions
// endpoint (LM Studio, vLLM, llama.cpp server, OpenAI itself). Replaces
// ChatMiniMax's LangChain BaseChatModel subclass; this project no longer
// depends on LangChain at all. Structured output is requested via
// `response_format: json_schema` when enabled; on a 400 that mentions
// response_format we flag it unsupported for the rest of this client's
// lifetime and fall back to bare/fenced-JSON parsing (see parseAction.js).
import { ACTION_SCHEMA } from './parseAction.js';

export class OpenAIChat {
  /**
   * @param {object} params
   * @param {string} params.baseUrl
   * @param {string} [params.apiKey]
   * @param {string} [params.model]
   * @param {number} [params.temperature]
   * @param {number} [params.maxTokens]
   * @param {number} [params.topP]
   * @param {number} [params.timeoutMs]
   * @param {number} [params.maxRetries]
   * @param {boolean} [params.structuredOutput]
   */
  constructor(params) {
    const {
      baseUrl,
      apiKey = '',
      model = 'qwen/qwen3-14b',
      temperature = 0.7,
      maxTokens = 350,
      topP = 0.9,
      timeoutMs = 120000,
      maxRetries = 2,
      structuredOutput = true
    } = params;
    if (!baseUrl) throw new Error('OpenAIChat requires baseUrl');
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    // Bare host:port (no path) is a common .env mistake for OpenAI-compatible
    // servers whose API lives under /v1 (LM Studio, vLLM, llama.cpp server).
    try {
      if (new URL(this.baseUrl).pathname === '/') {
        this.baseUrl += '/v1';
        console.warn(`[bot-manager] OPENAI_BASE_URL has no path — assuming ${this.baseUrl}`);
      }
    } catch { /* leave malformed URLs to fail loudly at fetch time */ }
    this.apiKey = apiKey || '';
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.topP = topP;
    this.timeoutMs = timeoutMs;
    this.maxRetries = Math.max(0, Number(maxRetries) | 0);
    this._structuredOutputSupported = !!structuredOutput;
    this._label = 'openai';
  }

  get structuredOutputSupported() { return this._structuredOutputSupported; }

  /**
   * @param {{role:string, content:string}[]} messages
   * @returns {Promise<{content:string, usage:{prompt_tokens?:number, completion_tokens?:number, total_tokens?:number}}>}
   */
  async chat(messages) {
    const payload = {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      top_p: this.topP
    };
    if (this._structuredOutputSupported) {
      payload.response_format = { type: 'json_schema', json_schema: { name: 'bot_action', strict: true, schema: ACTION_SCHEMA } };
    }

    let lastErr = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        const text = await res.text();
        let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        if (!res.ok) {
          const msg = (data?.error?.message || text || '').slice(0, 300);
          // LM Studio / other servers that don't understand response_format
          // reject it with a 400. Disable structured output permanently and
          // retry this same attempt once without it (doesn't burn a retry).
          if (this._structuredOutputSupported && res.status === 400 && /response_format|json_schema/i.test(msg)) {
            this._structuredOutputSupported = false;
            delete payload.response_format;
            attempt--;
            continue;
          }
          lastErr = new Error(`OpenAI-compatible endpoint ${res.status}: ${msg}`);
          if (res.status === 401 || res.status === 403) throw lastErr;
          continue;
        }
        const content = data?.choices?.[0]?.message?.content ?? '';
        const usage = data?.usage || {};
        return { content, usage };
      } catch (e) {
        lastErr = e;
        if (e.name === 'AbortError') { lastErr = new Error(`LLM call timed out after ${this.timeoutMs}ms`); continue; }
        if (/endpoint (401|403)/.test(e.message || '')) throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || new Error('OpenAI-compatible chat call failed');
  }
}
