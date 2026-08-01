// Action-block parser — extracts a bot action from an LLM response. Small
// local models under json_schema mode typically return bare JSON with no
// fence at all; the legacy ```action fenced block (with an optional
// in-character preamble before it) is still accepted as a fallback so the
// STATIC_RULES instruction and any model that prefers fencing still work.
//
// Order: (1) strip <think>...</think> (including an unclosed tag — the
// Qwen3 /no_think convention still leaves stray tags on some responses);
// (2) try the whole remaining text as bare JSON with a "kind" field; (3)
// fall back to the last ```action fenced block. On failure return null —
// ActionLLM wraps this with a one-shot "fix your action" nudge retry.

const FENCE_PATTERN = /```[ \t]*action[ \t]*\r?\n([\s\S]*?)```/gi;

// Removes <think>...</think> reasoning blocks. A closed block is stripped
// entirely; an unclosed block (generation truncated mid-thought) drops
// everything from the opening tag onward, since there is no reliable
// content after a thinking block that never closed.
export function stripThink(text) {
  if (!text) return '';
  let out = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '');
  const openIdx = out.search(/<think>/i);
  if (openIdx !== -1) out = out.slice(0, openIdx);
  return out.trim();
}

export function parseActionBlock(text) {
  if (!text || typeof text !== 'string') return null;
  const stripped = stripThink(text);
  if (!stripped) return null;
  const trimmed = stripped.trim();

  // 1) Bare JSON: the entire (think-stripped) response is a JSON object
  // with a "kind" field — the shape structured-output/json_schema mode
  // returns with no fence at all.
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') return parsed;
    } catch { /* not bare JSON — fall through to fenced parsing */ }
  }

  // 2) Legacy fenced ```action block. We take the LAST such block so the
  // bot can include a short in-character preamble before emitting the
  // action.
  const matches = [...trimmed.matchAll(FENCE_PATTERN)];
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
  if (parsed.asPuppet !== undefined) out.asPuppet = parsed.asPuppet === true;
  return out;
}

// JSON Schema for structured-output mode (response_format: json_schema).
// Enums mirror normalizeAction's whitelist above — keep them in sync. Types
// are kept nullable/loose rather than maximally strict because LM Studio's
// json_schema "strict" support varies by version; openaiChat.js falls back
// to fenced/bare-JSON parsing automatically on a 400 that rejects this.
export const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['chat', 'vote', 'night_action', 'pass'] },
    text: { type: ['string', 'null'] },
    target: { type: ['string', 'null'] },
    verb: {
      type: ['string', 'null'],
      enum: ['interrogate', 'kill', 'protect', 'bodyguard', 'scan_drift', 'sermon', 'trap', 'recruit', 'forge', 'possess', 'blood_ritual', 'sleep', null]
    },
    tier: { type: ['integer', 'null'], enum: [1, 2, 3, null] },
    sermonTier: {
      type: ['string', 'null'],
      enum: ['whisper', 'hymn', 'litany', 'false_comfort', 'twisted_hymn', 'warp_litany', null]
    },
    justification: { type: ['string', 'null'] },
    asPuppet: { type: ['boolean', 'null'] },
    notes: { type: ['object', 'null'], additionalProperties: { type: 'string' } }
  },
  required: ['kind'],
  additionalProperties: false
};
