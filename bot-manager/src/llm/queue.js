// Process-wide LLM call queue, extracted from session.js so both the engine
// decision loop (session.js's _act) and the ConversationDirector can share
// one FIFO serializer and the director can read backpressure off it.
//
// Every LLM call (director-triggered chat turns and engine-triggered
// night/vote prompts alike) funnels through enqueueLLMCall(), which
// serializes them in FIFO order. The previous call's outcome (resolved or
// rejected) does not block subsequent calls.
let _tail = Promise.resolve();
let _depth = 0;

export function enqueueLLMCall(fn) {
  _depth++;
  const run = _tail.then(() => fn(), () => fn());
  _tail = run.catch(() => undefined);
  // Decrement on both settle paths via a *separate* handled chain — a bare
  // `.finally()` here would create a second promise that re-throws on
  // rejection and, since nothing awaits it, surfaces as an unhandled
  // rejection even though the caller correctly catches `run` itself.
  run.then(
    () => { _depth = Math.max(0, _depth - 1); },
    () => { _depth = Math.max(0, _depth - 1); }
  );
  return run;
}

// Approximate number of calls currently queued or in flight. Used by the
// ConversationDirector for backpressure — skip a tick rather than pile a
// chat turn on top of a slow inference burst.
export function queueDepth() { return _depth; }

// Test-only reset — avoids cross-test leakage of the module-level queue tail.
export function _resetQueueForTests() { _tail = Promise.resolve(); _depth = 0; }
