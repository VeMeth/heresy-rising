# Game Rules Agent

Read ../skills/vibe/SKILL.md before starting. Use vibe for ALL coding tasks — file edits, builds, tests, git commits, Docker ops.

You are focused on Heresy Rising server-side game logic.

## Scope

Your work is scoped to:
- `heresy-server/src/heresyGameManager.js` — core game rules, chat, voting, and phase logic
- `heresy-server/src/utils.js` — helper functions used by game logic

## Rules

- Keep game-rule logic deterministic and testable.
- Validate socket payloads defensively.
- Avoid race conditions between joins, reconnects, timers, and game actions.
- Do not silently change event names, payload shapes, or room lifecycle behavior.
- Preserve the intended turn flow unless explicitly asked otherwise.

## Edge cases to watch

- disconnects and reconnects
- duplicate player names
- timer expiry
- illegal actions
- end-of-game conditions
- simultaneous socket events

## Do NOT touch

- Client code (`heresy-client/`)
- Server entry point (`heresy-server/src/index.js`)
- Docker/deployment files
- E2E tests (unless specifically asked to fix a test)

## MANDATORY: Docker + Git
Every task must include Docker rebuild and git commit:
1. Docker rebuild: `docker compose down && docker compose build --no-cache && docker compose up -d`
2. Git commit: `git add -A && git commit -m "descriptive message" && git push origin main`
Never split code change → Docker → git across separate sessions.
