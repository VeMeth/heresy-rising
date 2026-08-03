// OpenAIChat — plain-fetch client for any OpenAI-compatible chat-completions
// endpoint (LM Studio, vLLM, llama.cpp server, MiniMax, OpenAI itself).
// Replaces ChatMiniMax's LangChain BaseChatModel subclass; this project no
// longer depends on LangChain at all. Structured output is requested via
// `response_format: json_schema` when enabled; on a 400 that mentions
// response_format we flag it unsupported for the rest of this client's
// lifetime and fall back to bare/fenced-JSON parsing (see parseAction.js).
//
// MiniMax handling (plan §3.9): MiniMax M2.x/M3 are thinking models that
// inline their reasoning in `content` wrapped in <think>...</think> unless
// `reasoning_split: true` is sent, in which case the server moves reasoning
// into `message.reasoning_content` (or `reasoning_details`) and leaves
// `content` holding only the final answer. We request that split for
// `provider === 'minimax'` only — LM Studio (provider 'local') has no idea
// what `reasoning_split` is and would 400 on it, wasting a call recovering
// from a parameter we chose to send. Like `response_format`, a 400 that
// mentions `reasoning_split` disables it permanently for this client's
// lifetime and retries the same attempt without burning a retry.
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
   * @param {'local'|'minimax'} [params.provider]
   * @param {boolean} [params.reasoningSplit]
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
      structuredOutput = true,
      provider = 'local',
      reasoningSplit = false
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
    // Single source of truth for "is reasoning_split ever eligible to be
    // sent on this client": provider gate lives here, not scattered across
    // chat() — a caller mistakenly passing reasoningSplit:true with
    // provider:'local' must still never see the field on the wire.
    this.provider = provider === 'minimax' ? 'minimax' : 'local';
    this._reasoningSplitSupported = this.provider === 'minimax' && !!reasoningSplit;
    this._label = 'openai';
  }

  get structuredOutputSupported() { return this._structuredOutputSupported; }
  get reasoningSplitSupported() { return this._reasoningSplitSupported; }

  /**
   * @param {{role:string, content:string}[]} messages
   * @returns {Promise<{content:string, usage:{prompt_tokens?:number, completion_tokens?:number, total_tokens?:number}, finishReason:?string, reasoningText:?string}>}
   */
  async chat(messages) {
    const payload = {
      model: this.model,
      messages,
      temperature: this.temperature,
      top_p: this.topP
    };
    // MiniMax documents max_completion_tokens as the primary output cap and
    // max_tokens as legacy; send both with the same value. `local` (LM
    // Studio et al.) only understands max_tokens.
    if (this.provider === 'minimax') {
      payload.max_completion_tokens = this.maxTokens;
      payload.max_tokens = this.maxTokens;
    } else {
      payload.max_tokens = this.maxTokens;
    }
    if (this._structuredOutputSupported) {
      payload.response_format = { type: 'json_schema', json_schema: { name: 'bot_action', strict: true, schema: ACTION_SCHEMA } };
    }
    if (this._reasoningSplitSupported) {
      payload.reasoning_split = true;
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
          // Same fallback shape for reasoning_split. Both fallbacks can fire
          // in sequence across successive round-trips of the same call (a
          // server can reject response_format on one request and, once
          // that's fixed, reject reasoning_split on the next) — each flip
          // is permanent, so at most one retry-without-burning-a-retry per
          // flag; the loop cannot spin forever.
          if (this._reasoningSplitSupported && res.status === 400 && /reasoning_split/i.test(msg)) {
            this._reasoningSplitSupported = false;
            delete payload.reasoning_split;
            attempt--;
            continue;
          }
          lastErr = new Error(`OpenAI-compatible endpoint ${res.status}: ${msg}`);
          if (res.status === 401 || res.status === 403) throw lastErr;
          continue;
        }
        const choice = data?.choices?.[0] || {};
        const message = choice.message || {};
        const content = message.content ?? '';
        const usage = data?.usage || {};
        const finishReason = choice.finish_reason ?? null;
        // Only meaningful when we actually asked for (and the server still
        // honours) the split — otherwise reasoning, if any, is inline in
        // `content` and stripThink() handles it.
        const reasoningText = this._reasoningSplitSupported
          ? (message.reasoning_content ?? message.reasoning_details ?? undefined)
          : undefined;
        return { content, usage, finishReason, reasoningText };
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
