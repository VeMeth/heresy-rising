# Heresy Rising

Heresy Rising is a persistent, chat-based social deduction game for 5–12 players. A hidden cult hunts during the night while loyal citizens investigate, protect one another, debate, and vote during the day. The server is authoritative and stores games, messages, votes, actions, and player profiles in SQLite.

> **Fan project:** Heresy Rising is an unofficial, non-commercial Warhammer 40,000 fan project. It is not affiliated with, endorsed by, or sponsored by Games Workshop. Warhammer 40,000 and related marks belong to their respective owners.

## Technology

- Vue 3 and Vite client in `heresy-client/`
- Node.js, Express, and Socket.IO server in `heresy-server/`
- SQLite persistence in the server data directory
- Playwright integration tests in `tests/e2e/`
- Docker Compose deployment with a persistent data volume

The imported directory names are retained to keep the conversion reviewable; product names and runtime identifiers use Heresy Rising.

## Local development

Requires Node.js 20+ and npm.

```bash
npm install
npm --prefix heresy-server install
npm --prefix heresy-client install
npm run dev
```

The client normally runs at `http://localhost:5173`, proxies API and Socket.IO requests to `http://localhost:4100`, and the health check is `GET /api/health`.

Useful commands:

```bash
npm run client:dev
npm run server:dev
npm run server:start
npm run test:e2e
npm run docker
```

## Docker

```bash
ADMIN_PASSWORD='replace-with-a-long-random-secret' docker compose up --build -d
docker compose ps
docker compose down
```

The client is exposed on port `8281` by default. The server is published only on `127.0.0.1:4100` by default so nginx/reverse proxies can reach it without exposing the API directly to the internet. SQLite data is mounted at `./data`; do not commit it. Set `ALLOWED_ORIGINS` to the deployed client origins and `TRUST_PROXY=true` only behind a trusted reverse proxy.

## Documentation

- [Architecture and protocol](docs/architecture.md)
- [Game rules](docs/rules.md)
- [Deployment](docs/deployment.md)
- [Persistence and recovery](docs/recovery.md)

Never expose player codes, role assignments, faction chat, night actions, or the database file. Player codes are bearer credentials.
