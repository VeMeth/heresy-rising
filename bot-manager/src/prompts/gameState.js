// State digest — re-injected every call so the bot's prompt reflects the
// current round/phase/roster. Trimmed to a ~150 tok budget: chat history and
// announcements live in their own dedicated prompt sections (assemble.js /
// RollingSummary) so they are never duplicated here.

function formatPlayers(codes, names) {
  if (!Array.isArray(codes) || codes.length === 0) return 'none';
  return codes.map((c) => {
    const n = names && names[c];
    return n ? `${c} (${n})` : c;
  }).join(', ');
}

export function gameStateBlock(session) {
  if (!session) return '## GAME STATE\n(no session attached)';
  const names = session.playerNames || {};
  const aliveList = formatPlayers(session.alivePlayers, names);
  const deadList = Array.isArray(session.deadPlayers) && session.deadPlayers.length ? formatPlayers(session.deadPlayers, names) : 'none';
  const votingEnabled = session.phase === 'day' ? session.round !== 1 : false;

  // Q-BOT-9 (locked spec): bots must be indistinguishable from humans in
  // chat, so which other seats are bots is deliberately withheld from the
  // prompt — a model can't leak (via prompt injection or otherwise) what it
  // was never told. The anti-flood/echo guard this used to justify lives in
  // director.js off session.botIds/isBot as a plain JS field, never routed
  // through the prompt, so removing this line doesn't weaken it.
  const lines = [
    '## GAME STATE',
    `Round ${session.round ?? '?'} · Phase ${session.phase ?? '?'} · Voting ${votingEnabled ? 'enabled' : 'disabled'}`,
    `Alive: ${aliveList}`,
    `Dead: ${deadList}`,
    `Your drift hint: ${session.lastOwnZone || 'unknown'}`
  ];
  if (session.phase === 'day' && session.round > 1) {
    const targets = Array.isArray(session.alivePlayers)
      ? formatPlayers(session.alivePlayers.filter((p) => p !== session.playerCode), names)
      : 'none';
    lines.push(`Vote targets: ${targets} (or "skip")`);
  }
  const nightT = nightTargets(session);
  if (session.phase === 'night' && nightT) lines.push(`Night targets: ${nightT}`);
  return lines.join('\n');
}

function nightTargets(session) {
  const alive = Array.isArray(session.alivePlayers) ? session.alivePlayers : [];
  if (alive.length === 0) return null;
  const self = session.playerCode;
  const role = session.role;

  const noSelf = new Set(['interrogator', 'novice-psychic', 'arbitrator', 'priest', 'heretic-priest', 'sanctioned-psyker', 'murderer', 'saboteur', 'recruiter']);
  const allowSelf = new Set(['chirurgeon']);

  if (role === 'imperial-citizen' || role === 'conspirator') return null;
  if (allowSelf.has(role)) return alive.join(', ');
  if (noSelf.has(role)) return alive.filter((p) => p !== self).join(', ') || 'none';
  return alive.join(', ');
}

export function factionChatBlock(session) {
  if (!session || session.faction !== 'heretic') return '';
  return `## FACTION CHAT (Heretic — private to Heretics)

You are a Heretic. You share a private faction chat with the other Heretics in this game.
Anything said there is invisible to Loyalists. Use it to coordinate kills, sermons, traps, and conversions.
Do NOT reveal Heretic plans in public chat.`;
}

export function personaBlock(session) {
  const p = session?.personaOverrides;
  const lines = [];
  if (typeof p === 'string' && p) lines.push(p);
  else if (Array.isArray(p) && p.length) lines.push(...p.map((x) => `- ${x}`));
  else if (p && typeof p === 'object') {
    for (const [k, v] of Object.entries(p)) {
      if (k === 'talkativeness') continue; // rendered as the speaking-style line below, not raw
      lines.push(`- ${k}: ${v}`);
    }
  }
  const talk = session?.talkativeness;
  if (typeof talk === 'number') {
    const label = talk >= 0.75
      ? 'chatty — you speak up often when you have something to add'
      : talk >= 0.55
        ? 'moderately talkative — you speak when it matters'
        : 'reserved — you speak rarely, only when you truly have something to add';
    lines.push(`- Speaking style: ${label}.`);
  }
  if (!lines.length) return '';
  return `## PERSONA OVERRIDES\n${lines.join('\n')}`;
}
