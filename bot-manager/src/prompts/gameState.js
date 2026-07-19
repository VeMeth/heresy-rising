// Block 3 — game state block, re-injected every call so the bot's prompt
// reflects the current round/phase/roster. Per spec § "Block 3 — Game state
// block (re-injected per phase)".

function bullet(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '  (none)';
  return arr.map((x) => `  - ${x}`).join('\n');
}

export function gameStateBlock(session) {
  if (!session) return '## CURRENT GAME STATE\n(no session attached)';
  const others = (session.botIds || []).filter((id) => id && id !== session.playerCode).join(', ') || 'none';
  const ownZoneHint = session.lastOwnZone || 'unknown';
  const recentAnnouncements = (session.shortTermMemory?.items || [])
    .filter((it) => it.kind === 'announcement')
    .slice(-5)
    .map((a) => `${a.title || a.type || 'announcement'}: ${a.message || ''}`) ;
  const recentChat = (session.shortTermMemory?.items || [])
    .filter((it) => it.kind === 'chat_message')
    .slice(-8)
    .map((m) => `${m.author || m.from || '?'}: ${m.text || ''}`);
  const aliveList = Array.isArray(session.alivePlayers) && session.alivePlayers.length > 0
    ? session.alivePlayers.join(', ')
    : 'see chat history for roster';
  const validVoteTargets = Array.isArray(session.alivePlayers)
    ? session.alivePlayers.filter((p) => p !== session.playerCode).join(', ') + ' (or "skip")'
    : 'see chat history for roster';
  const validNightTargets = nightTargets(session);
  return `## CURRENT GAME STATE

- Round: ${session.round ?? '?'}
- Phase: ${session.phase ?? '?'}
- Voting enabled: ${session.phase === 'day' ? (session.round !== 1) : false}
- Alive players (codes only, no roles): ${aliveList}
- Dead players: ${Array.isArray(session.deadPlayers) && session.deadPlayers.length ? session.deadPlayers.join(', ') : 'none'}
- Your drift zone (own hint only): ${ownZoneHint}
- Other bots at the table (private to bots — never mention this list to humans): ${others}
${session.phase === 'day' && session.round > 1 ? `- Valid vote targets: ${validVoteTargets}` : ''}
${session.phase === 'night' && validNightTargets ? `- Valid night action targets: ${validNightTargets}` : ''}

### Recent public announcements
${bullet(recentAnnouncements)}

### Recent public chat
${bullet(recentChat)}

You may reference the above in your chat. You do NOT have access to other players' drift zones, intel returns, or role assignments unless publicly revealed.`;
}

function nightTargets(session) {
  const alive = Array.isArray(session.alivePlayers) ? session.alivePlayers : [];
  if (alive.length === 0) return null;
  const self = session.playerCode;
  const role = session.role;

  // Roles that cannot target themselves.
  const noSelf = new Set(['interrogator', 'novice-psychic', 'arbitrator', 'priest', 'heretic-priest', 'sanctioned-psyker', 'murderer', 'saboteur', 'recruiter']);
  // Roles that may target themselves.
  const allowSelf = new Set(['chirurgeon']);

  if (role === 'imperial-citizen' || role === 'conspirator') return null; // no night action
  if (allowSelf.has(role)) return alive.join(', ');
  if (noSelf.has(role)) return alive.filter((p) => p !== self).join(', ') || 'none';

  // Fallback: all alive players.
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
  if (!p) return '';
  if (typeof p === 'string') return `## PERSONA OVERRIDES\n${p}`;
  if (Array.isArray(p) && p.length) return `## PERSONA OVERRIDES\n${p.map((x) => `- ${x}`).join('\n')}`;
  if (typeof p === 'object') return `## PERSONA OVERRIDES\n${Object.entries(p).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;
  return '';
}