// test/fakeOpenAI.js — a minimal HTTP server standing in for LM Studio's
// OpenAI-compatible /v1/chat/completions endpoint. Drives OpenAIChat through
// a full mocked sim without a live LLM. Two modes:
//   - supportsJsonSchema=true (default): accepts response_format silently,
//     echoes back the next scripted content.
//   - supportsJsonSchema=false: rejects any request carrying
//     response_format with a 400 mentioning "response_format", forcing
//     OpenAIChat's permanent fallback to bare/fenced-JSON parsing.
import http from 'node:http';

export function startFakeOpenAI({ scripts = [], supportsJsonSchema = true } = {}) {
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
      const content = scripts[calls++] ?? '{"kind":"pass"}';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }],
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
