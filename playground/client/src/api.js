// Thin fetch wrapper over the playground server's REST API.
//
// Every exported function returns parsed JSON on success. On a non-2xx
// response it throws an Error whose `.message` is the server's own
// `{ error: "..." }` text (falling back to the HTTP status line if the
// body isn't JSON or carries no `error` field). Callers — App.vue — are
// expected to catch this and surface `.message` verbatim in the error
// banner. Nothing here swallows errors or retries; the server serializes
// operations behind a mutex, so callers should gate on a single `busy`
// flag rather than racing requests.

// Every call below is written as a bare `/roles`, `/session/...`, etc. path
// — deliberately WITHOUT the server's own `/api` (standalone) or
// `/api/playground` (embedded) mount prefix, since that prefix is the one
// thing that differs between the two contexts. `apiBase` supplies it:
//   - Standalone (vite dev server on 4201, proxying /api -> the playground
//     server on 4200; or that server's own createApp(), which mounts
//     createPlaygroundRouter() at /api) — apiBase defaults to '/api', so
//     `/roles` resolves to `/api/roles`, matching today's behaviour exactly.
//   - Embedded at /playground on the real site, heresy-server mounts the
//     SAME router at /api/playground behind requireAdmin — heresy-client's
//     PlaygroundView.vue calls setApiBase('/api/playground') before this
//     module makes its first request, so `/roles` resolves to
//     `/api/playground/roles` instead, without any component in
//     ./components knowing the difference.
let apiBase = '/api';
export function setApiBase(base) {
  apiBase = base || '/api';
}

// Extra headers merged into every request. heresy-client uses this to
// attach X-Admin-Password once (see PlaygroundView.vue) rather than every
// caller threading it through — standalone mode leaves this empty since the
// playground server has no auth at all (it only ever binds 127.0.0.1).
let authHeaders = {};
export function setAuthHeaders(headers) {
  authHeaders = headers || {};
}

async function request(path, options = {}) {
  const res = await fetch(apiBase + path, {
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    ...options,
  });

  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON body (e.g. an HTML error page from a proxy). Leave body
      // null; the status-line fallback below handles the message.
    }
  }

  if (!res.ok) {
    const message = (body && typeof body.error === 'string' && body.error) ||
      `${res.status} ${res.statusText}`;
    throw new Error(message);
  }

  return body;
}

function get(path) {
  return request(path, { method: 'GET' });
}

function post(path, payload) {
  return request(path, { method: 'POST', body: JSON.stringify(payload ?? {}) });
}

function patch(path, payload) {
  return request(path, { method: 'PATCH', body: JSON.stringify(payload ?? {}) });
}

// --- Roles & scenarios -----------------------------------------------

export function getRoles() {
  return get('/roles');
}

export function getScenarios() {
  return get('/scenarios');
}

export function saveScenario({ name, sessionId }) {
  return post('/scenarios', { name, sessionId });
}

// --- Session lifecycle --------------------------------------------------

export function createSession({ players, roster, seed, options }) {
  return post('/session', { players, roster, seed, options });
}

export function getSession(sessionId) {
  return get(`/session/${sessionId}`);
}

export function updatePlayer(sessionId, playerCode, updates) {
  return patch(`/session/${sessionId}/player/${playerCode}`, { updates });
}

export function updateGame(sessionId, updates) {
  return patch(`/session/${sessionId}/game`, { updates });
}

// --- Actions & votes ------------------------------------------------------

export function submitAction(sessionId, { actorCode, targetCode, variant, data, faction }) {
  return post(`/session/${sessionId}/action`, {
    actorCode,
    targetCode,
    variant,
    data,
    faction,
    retract: false,
  });
}

export function retractAction(sessionId, actorCode) {
  return post(`/session/${sessionId}/action`, { actorCode, retract: true });
}

export function submitVote(sessionId, { voterCode, choice, justification }) {
  return post(`/session/${sessionId}/vote`, {
    voterCode,
    choice,
    justification,
    retract: false,
  });
}

export function retractVote(sessionId, voterCode) {
  return post(`/session/${sessionId}/vote`, { voterCode, retract: true });
}

// --- Resolution & fog -------------------------------------------------

export function resolve(sessionId) {
  return post(`/session/${sessionId}/resolve`);
}

export function getView(sessionId, playerCode) {
  return get(`/session/${sessionId}/view/${playerCode}`);
}

// --- Snapshots, history, scenario save/load, export -------------------

export function snapshot(sessionId, label) {
  return post(`/session/${sessionId}/snapshot`, { label });
}

export function rewind(sessionId) {
  return post(`/session/${sessionId}/rewind`);
}

export function getHistory(sessionId) {
  return get(`/session/${sessionId}/history`);
}

export function loadScenario(sessionId, name) {
  return post(`/session/${sessionId}/load`, { name });
}

// Opens a saved scenario in a brand-new sandbox — what the Setup column's
// Load button calls. Returns the same shape createSession() does.
export function createSessionFromScenario(name) {
  return post('/session/from-scenario', { name });
}

export function exportTest(sessionId, name) {
  return post(`/session/${sessionId}/export-test`, { name });
}
