// Process-wide LLM call queue, extracted from session.js so both the engine
// decision loop (session.js's _act) and the ConversationDirector can share
// one FIFO serializer and the director can read backpressure off it.
//
// Every LLM call (director-triggered chat turns and engine-triggered
// night/vote prompts alike) funnels through enqueueLLMCall(), which
// serializes calls **within a lane** in FIFO order. The previous call's
// outcome (resolved or rejected) does not block subsequent calls.
//
// Lanes exist because a mixed game (local GPU bot + MiniMax cloud bots) is
// not one queue's worth of work: a single process-wide FIFO chain protects
// the one local GPU correctly, but a 30-40s cloud call sitting at the head
// of that chain would stall every local bot queued behind it, and a slow
// local bot would just as wrongly throttle cloud calls that could easily run
// in parallel. So each call declares a `lane`, and each lane gets its own
// concurrency-limited queue:
//   - 'local' (the default, and the only lane that existed before lanes)
//     keeps concurrency 1 — there is exactly one local GPU behind it.
//   - 'cloud' allows `config.botCloudConcurrency` calls in flight at once
//     (default 3), comfortably under MiniMax's 200-500 RPM.
//   - any other lane name is created on demand at concurrency 1 — a safe
//     default for a lane nobody has tuned yet.
import { config } from '../config.js';

function laneConcurrency(name) {
  if (name === 'cloud') return Math.max(1, Number(config.botCloudConcurrency) || 3);
  return 1; // 'local' and any unknown lane: one at a time, the safe default
}

function createLane(name) {
  return {
    maxConcurrent: laneConcurrency(name),
    active: 0,   // calls whose fn() is currently running
    depth: 0,    // calls queued or in flight — what queueDepth() reports
    queue: []    // pending start()-thunks, FIFO
  };
}

const _lanes = new Map();

function getOrCreateLane(name) {
  let lane = _lanes.get(name);
  if (!lane) {
    lane = createLane(name);
    _lanes.set(name, lane);
  }
  return lane;
}

// Start as many queued calls as the lane's concurrency budget allows, in the
// order they were enqueued. For a concurrency-1 lane (local, and every
// unknown lane) this is exactly a strict FIFO chain: at most one call is
// ever active, and the next one starts the instant the current one settles
// — resolved or rejected, it does not matter, a rejected call must never
// block the calls behind it in the lane.
function pump(lane) {
  while (lane.active < lane.maxConcurrent && lane.queue.length) {
    const start = lane.queue.shift();
    start();
  }
}

export function enqueueLLMCall(fn, { lane: laneName = 'local' } = {}) {
  const lane = getOrCreateLane(laneName);
  lane.depth++;

  const run = new Promise((resolveRun, rejectRun) => {
    lane.queue.push(() => {
      lane.active++;
      // Defer fn() to a microtask via Promise.resolve().then(...) rather than
      // calling it synchronously — mirrors the original tail-chain, which
      // always invoked fn() from inside a .then() callback. Callers that rely
      // on "enqueue now, run later" (e.g. staleness re-checks between
      // enqueue and dequeue) keep working the same way.
      Promise.resolve().then(fn).then(
        (v) => { lane.active--; pump(lane); resolveRun(v); },
        (e) => { lane.active--; pump(lane); rejectRun(e); }
      );
    });
  });
  pump(lane);

  // Decrement depth on a *separate* handled chain — a bare `.finally()` here
  // would create a second promise that re-throws on rejection and, since
  // nothing awaits it, surfaces as an unhandled rejection even though the
  // caller correctly catches `run` itself.
  run.then(
    () => { lane.depth = Math.max(0, lane.depth - 1); },
    () => { lane.depth = Math.max(0, lane.depth - 1); }
  );

  return run;
}

// Approximate number of calls currently queued or in flight, used by the
// ConversationDirector for backpressure — skip a tick rather than pile a
// chat turn on top of a slow inference burst. Per-lane by default so a
// director decision about a `local` bot isn't skewed by cloud traffic and
// vice versa; call with no argument for the pre-lanes total-across-lanes
// behaviour (back-compat for any caller that doesn't care which lane).
export function queueDepth(laneName) {
  if (laneName === undefined) {
    let total = 0;
    for (const lane of _lanes.values()) total += lane.depth;
    return total;
  }
  const lane = _lanes.get(laneName);
  return lane ? lane.depth : 0;
}

// Test-only reset — avoids cross-test leakage of the module-level lane
// state. Lanes are re-created lazily (with a fresh concurrency read from
// `config`) the next time enqueueLLMCall() touches them.
export function _resetQueueForTests() { _lanes.clear(); }
