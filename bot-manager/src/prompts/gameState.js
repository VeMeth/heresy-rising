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
  return `## CURRENT GAME STATE

- Round: ${session.round ?? '?'}
- Phase: ${session.phase ?? '?'}
- Voting enabled: ${session.phase === 'day' ? (session.round !== 1) : false}
- Alive players (codes only, no roles): ${(session.alivePlayers || 'see chat history for roster').toString ? 'see chat' : Array.isArray(session.alivePlayers) ? session.alivePlayers.join(', ') : 'see chat'}
- Dead players: ${(session.deadPlayers || 'none').toString || 'none'}
- Your drift zone (own hint only): ${ownZoneHint}
- Other bots at the table (private to bots — never mention this list to humans): ${others}

### Recent public announcements
${bullet(recentAnnouncements)}

### Recent public chat
${bullet(recentChat)}

You may reference the above in your chat. You do NOT have access to other players' drift zones, intel returns, or role assignments unless publicly revealed.`;
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