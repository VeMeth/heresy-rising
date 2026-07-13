# Heresy Rising Architecture

## System model

Heresy Rising is server-authoritative. The Vue client renders a player-specific view and submits commands through acknowledged Socket.IO events. The server authenticates the socket with a player code, validates every command, commits state to SQLite, and then broadcasts sanitized updates.

```text
Vue/Vite client ── HTTP + Socket.IO ── Express game server ── SQLite
       │                                      │
       └── player-specific state              ├── phase engine
                                              ├── chat/votes/actions
                                              └── authorization/serialization
```

The application is split into the `heresy-client/` frontend and `heresy-server/` authoritative backend.

## Persistent domain

The durable model covers games, players in games, ordered chat messages, votes, night actions, phase history, and append-only game events. Player profiles and recovery codes survive individual games. Phase resolution is transactional: resolved actions, deaths, public results, audit events, and the next phase must either all commit or all roll back.

Active deadlines are stored as absolute timestamps. On startup the server loads active games, resolves overdue phases idempotently, and schedules future deadlines. In-memory timers are an optimization, never the source of truth.

## Authorization boundaries

- Public state contains only information every participant may know.
- A player receives their own role and action result, never another player's private state.
- Werewolf faction chat and membership are sent only to authenticated faction members.
- Dead chat is sent only to eliminated players.
- Submitted night actions and unrevealed votes are private.
- Socket identity is derived from the validated player code, not a payload `playerId`.

All command acknowledgements use `{ ok: true, data }` or `{ ok: false, error }`. Expected command families are `game:*`, `chat:*`, `vote:*`, and `action:*`; state changes arrive through `game:state`, `chat:message`, `vote:state`, `phase:updated`, and `game:ended`.

## Phase lifecycle

`lobby → role-reveal → night → day → night … → ended`

The host configures and starts a lobby. Deadlines or a valid host early-close request advance active phases. The engine validates eligibility at submission and again during resolution. A stable phase identifier prevents duplicate submissions and makes deadline processing idempotent.

## Security and operations

Express applies Helmet, explicit CORS, body limits, and API rate limits. Socket commands have event-specific limits. Chat is length-limited and rendered as text. Admin routes require a deployment secret and must return `Cache-Control: no-store`. Logs must not contain player codes or hidden game state.
