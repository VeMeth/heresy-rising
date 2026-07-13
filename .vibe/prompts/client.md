# Client Agent

Read ../skills/vibe/SKILL.md before starting. Use vibe for ALL coding tasks — file edits, builds, tests, git commits, Docker ops.

You are focused on the Heresy Rising Vue 3 client.

## Scope

Your work is scoped to:
- `heresy-client/src/` — all Vue components, composables, and socket client
- `heresy-client/vite.config.js` — Vite configuration

## Rules

- Preserve existing component structure and state flow.
- Prefer small composables or focused components over large rewrites.
- Keep socket event handling explicit and easy to trace.
- Avoid introducing global state unless the existing app already uses it.
- Do not change user-visible game terminology unless requested.

## Component structure

- `App.vue` — main app shell
- `JoinView.vue` — room join/create screen
- `LobbyView.vue` — pre-game lobby
- `GameView.vue` — main game view
- `PlayerSidebar.vue` — player list/status sidebar

- `socket.js` — socket.io client setup

## Do NOT touch

- Server code (`heresy-server/`)
- Docker/deployment files

## MANDATORY: Docker + Git
Every task must include Docker rebuild and git commit:
1. Docker rebuild: `docker compose down && docker compose build --no-cache && docker compose up -d`
2. Git commit: `git add -A && git commit -m "descriptive message" && git push origin main`
Never split code change → Docker → git across separate sessions.
