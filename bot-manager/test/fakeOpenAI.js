// test/fakeOpenAI.js — a minimal HTTP server standing in for LM Studio's /
// MiniMax's OpenAI-compatible /v1/chat/completions endpoint. Drives
// OpenAIChat through a full mocked sim without a live LLM.
//
// Two independent "does this server support X" flags, each mirroring how a
// real endpoint rejects a parameter it doesn't recognise:
//   - supportsJsonSchema=true (default): accepts response_format silently.
//     false: rejects any request carrying response_format with a 400
//     mentioning "response_format", forcing OpenAIChat's permanent fallback
//     to bare/fenced-JSON parsing.
//   - supportsReasoningSplit=true (default): accepts reasoning_split
//     silently. false: rejects any request carrying reasoning_split with a
//     400 mentioning "reasoning_split", forcing OpenAIChat's permanent
//     fallback to inline <think> reasoning.
// Both checks are independent and can both fire across a single call's
// retries (see openaiChat.js's sequential-fallback comment) — a rejected
// call does not consume a scripts[] slot, only a successful 200 does.
//
// `scripts[]` entries drive the scripted response content and, since
// MiniMax's thinking behaviour needs more than just text, may be either:
//   - a plain string — used as `message.content`, everything else default
//     (finish_reason: 'stop', no reasoning_content). This is the original
//     shape and every existing call site keeps working unchanged.
//   - an object `{ content, finishReason, reasoningContent }` — lets a test
//     script a truncated <think> block alongside `finishReason: 'length'`,
//     or a `reasoning_content` field for reasoning-split scripting.
import http from 'node:http';

export function startFakeOpenAI({ scripts = [], supportsJsonSchema = true, supportsReasoningSplit = true } = {}) {
  let calls = 0;
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload; try { payload = JSON.parse(body || '{}'); } catch { payload = {}; }
      received.push(payload);
      if (!supportsJsonSchema && payload.response_format) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Unknown parameter: response_format' } }));
        return;
      }
      if (!supportsReasoningSplit && payload.reasoning_split) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Unknown parameter: reasoning_split' } }));
        return;
      }
      const raw = scripts[calls++] ?? '{"kind":"pass"}';
      const script = typeof raw === 'string' ? { content: raw } : raw;
      const { content = '', finishReason = 'stop', reasoningContent } = script;
      const message = { role: 'assistant', content };
      if (reasoningContent !== undefined) message.reasoning_content = reasoningContent;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message, finish_reason: finishReason }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        received,
        calls: () => calls,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}
