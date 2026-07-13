# Deployment

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVER_PORT` / `PORT` | `4100` | HTTP and Socket.IO port |
| `SERVER_HOST_BIND` | `127.0.0.1` | Host interface for the server port in Compose |
| `CLIENT_PORT` | `8281` | Published client port in Compose |
| `GAME_DB_PATH` | `data/heresy-rising.db` | SQLite database location |
| `ALLOWED_ORIGINS` | local client origins | Comma-separated CORS allowlist |
| `TRUST_PROXY` | `false` | Enable only behind a trusted proxy |
| `ADMIN_PASSWORD` | development placeholder | Admin API secret; replace in production |
| `RATE_LIMIT_MAX` | `120` | API requests per rate-limit window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in milliseconds |

Keep production values in an untracked `.env`. Generate a long random admin password if admin routes are enabled. Never publish the SQLite database or mount it into the web client.

The admin UI is served from `/admin` on the client origin. It uses the `ADMIN_PASSWORD` value through the `X-Admin-Password` API header; keep that password out of Git and rotate it if it is exposed. The admin view shows live Heresy Rising cells, hidden roles/factions/drift, submitted actions, votes, messages, events, and game logs.

For internet play, expose the client/reverse proxy, not the Node server directly. The Compose files bind the server port to `127.0.0.1` by default; keep that unless a trusted proxy on another host must reach it.

## Compose variants

- `docker-compose.yml`: build locally with release image tags.
- `docker-compose.manual.yml`: build and tag local images.
- `docker-compose.auto.yml`: pull published images.

```bash
docker compose config
docker compose up --build -d
curl --fail http://localhost:4100/api/health
docker compose logs -f heresy-server
```

The `./data` bind mount contains durable game state. Back it up before image or schema upgrades. Use TLS at the reverse proxy, forward WebSocket upgrades, set `ALLOWED_ORIGINS` to exact HTTPS origins, and then set `TRUST_PROXY=true`.

Minimum public deployment checklist:

1. Point your HTTPS reverse proxy at the client container (`CLIENT_PORT`, default `8281`).
2. Keep the server bound to localhost: `SERVER_HOST_BIND=127.0.0.1`.
3. Set `ALLOWED_ORIGINS=https://your-domain.example` with no wildcard.
4. Set `TRUST_PROXY=true` only when the proxy is under your control.
5. Do not share `./data`, logs, player recovery codes, or browser local storage.

## Release checks

Run the client production build, server tests, Playwright suite, `docker compose config`, and a health check. Verify reconnect behavior and overdue-phase recovery against a copy of production data before deploying a schema migration.
