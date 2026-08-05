// Action-block parser — extracts a bot action from an LLM response. Small
// local models under json_schema mode typically return bare JSON with no
// fence at all; the legacy ```action fenced block (with an optional
// in-character preamble before it) is still accepted as a fallback so the
// STATIC_RULES instruction and any model that prefers fencing still work.
//
// Order: (1) strip <think>...</think> (including an unclosed tag, and an
// orphan closing tag with no opener — see stripThink below); (2) try the
// whole remaining text as bare JSON with a "kind" field; (3) fall back to
// the last ```action fenced block; (4) a conservative last-resort scan for
// the last balanced {...} object containing a "kind" key, for the case
// where reasoning leaves trailing prose around an otherwise-valid action.
// On failure return null — ActionLLM wraps this with a one-shot "fix your
// action" nudge retry.

const FENCE_PATTERN = /```[ \t]*action[ \t]*\r?\n([\s\S]*?)```/gi;

// Removes <think>...</think> reasoning blocks. MiniMax M2.x/M3 (in
// inline-thinking mode, i.e. reasoning_split not honoured/active) produce
// three distinct shapes here, plus the original Qwen3 /no_think case:
//
//   1. Closed <think>...</think> — stripped entirely by the regex below.
//   2. Unclosed <think> (generation truncated mid-thought, e.g. hit
//      maxTokens before the block closed) — everything from the opening
//      tag onward is dropped. This is deliberate: there is no reliable
//      content after a thinking block that never closed, and it is exactly
//      the failure mode from plan §1.1 (maxTokens=350 cutting a MiniMax
//      response off mid-<think>, producing an empty string here and a
//      silent pass two calls later). The fix for that failure is a bigger
//      maxTokens on MiniMax profiles + reasoning_split, not a parser
//      change — this behaviour must NOT change.
//   3. Orphan </think> with no opener — MiniMax's chat template commonly
//      pre-fills the opening <think> tag server-side, so what we actually
//      receive over the wire starts mid-reasoning and only the closing tag
//      survives. Because case 1's regex already removed every properly
//      paired block, any </think> still present at this point is by
//      definition unpaired — drop everything up to and including the LAST
//      such tag (defensive against more than one stray closer).
export function stripThink(text) {
  if (!text) return '';
  let out = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '');
  const openIdx = out.search(/<think>/i);
  if (openIdx !== -1) { out = out.slice(0, openIdx); return out.trim(); }
  const closeIdx = out.toLowerCase().lastIndexOf('</think>');
  if (closeIdx !== -1) out = out.slice(closeIdx + '</think>'.length);
  return out.trim();
}

// Brace-aware scan for top-level (depth-0) {...} objects in a string, used
// only by the parseActionBlock last-resort path below. Tracks JSON string
// state (double-quote delimited, backslash-escaped) so braces inside a
// string — including a nested object like a "notes" field — never throw
// off the depth count, and so stray apostrophes in surrounding prose ("I
// don't think...") are never mistaken for string delimiters (JSON strings
// only ever use double quotes, so only those toggle string state here).
function extractBalancedJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          objects.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return objects;
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
  if (matches.length) {
    const raw = matches[matches.length - 1][1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') return parsed;
    } catch { /* fall through to the last-resort scan below */ }
  }

  // 3) Conservative last resort: scan for the last balanced {...} block
  // that contains a "kind" key. Reasoning models (MiniMax especially) leave
  // trailing prose around an otherwise-fine action object ("...so I'll
  // vote for P-04. {\"kind\":\"vote\",...} That's my final answer."), which
  // breaks path (1)'s whole-string-must-be-JSON requirement and has no
  // fence for path (2) to find. This only fires once both paths above have
  // failed, requires an actual "kind" key AND a successful JSON.parse — so
  // prose that merely contains brace characters (dates, asides, code-ish
  // text) is never mistaken for an action; see extractBalancedJsonObjects
  // for the brace/string tracking that keeps nested objects (e.g. a
  // "notes" object) from confusing the boundary scan.
  const candidates = extractBalancedJsonObjects(trimmed);
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (!/"kind"\s*:/.test(candidates[i])) continue;
    try {
      const parsed = JSON.parse(candidates[i]);
      if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') return parsed;
    } catch { /* not valid JSON after all — keep scanning earlier candidates */ }
  }
  return null;
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
      enum: ['interrogate', 'kill', 'protect', 'bodyguard', 'scan_drift', 'read_warp', 'sermon', 'trap', 'recruit', 'forge', 'possess', 'infect', 'blood_ritual', 'sleep', null]
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
