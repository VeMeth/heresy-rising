// Action-block parser — extracts the last ```action fenced block from an LLM
// response and parses it as JSON. Per spec, the action shape is a fenced JSON
// block shared by chat/vote/night_action/pass. We take the LAST such block so
// the bot can include a short in-character preamble before emitting the
// action.
//
// On parse failure we return null. Phase 4 wraps this with a one-shot "fix
// your action block" retry-nudge; if it still fails, the manager passes the
// turn (no action, no chat).

const FENCE_PATTERN = /```[ \t]*action[ \t]*\r?\n([\s\S]*?)```/gi;

export function parseActionBlock(text) {
  if (!text || typeof text !== 'string') return null;
  const matches = [...text.matchAll(FENCE_PATTERN)];
  if (!matches.length) return null;
  const raw = matches[matches.length - 1][1].trim();
  try { return JSON.parse(raw); } catch { return null; }
}

// Shape validator — catches obvious LLM mistakes (wrong field names, wrong
// types) before the action is dispatched to the engine. Returns the cleaned
// action object on success, null on rejection. Permissive on extras.
export function normalizeAction(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const kind = String(parsed.kind || '').toLowerCase();
  if (!['chat', 'vote', 'night_action', 'pass'].includes(kind)) return null;
  const out = { kind };
  if (typeof parsed.text === 'string') out.text = parsed.text;
  if (parsed.target !== undefined) out.target = typeof parsed.target === 'string' ? parsed.target : null;
  if (parsed.verb !== undefined) out.verb = typeof parsed.verb === 'string' ? parsed.verb : null;
  if (parsed.tier !== undefined && parsed.tier !== null) {
    const t = Number(parsed.tier); if (Number.isFinite(t)) out.tier = t;
  }
  if (parsed.sermonTier !== undefined && parsed.sermonTier !== null) {
    out.sermonTier = String(parsed.sermonTier);
  }
  if (parsed.notes && typeof parsed.notes === 'object' && !Array.isArray(parsed.notes)) {
    out.notes = {};
    for (const [k, v] of Object.entries(parsed.notes)) {
      if (typeof v === 'string') out.notes[String(k).slice(0, 64)] = v.slice(0, 500);
    }
  }
  if (parsed.justification !== undefined) out.justification = String(parsed.justification || '');
  if (parsed.asPlayerCode !== undefined) out.asPlayerCode = String(parsed.asPlayerCode || '');
  return out;
}