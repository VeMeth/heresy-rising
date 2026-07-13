# Persistence and Recovery

## Backup

SQLite may use write-ahead logging, so copying only the main file while the server is running can produce an inconsistent backup. Prefer the SQLite online backup command, or stop the server before copying the entire data directory.

```bash
docker compose stop heresy-server
cp -a data "backups/heresy-rising-$(date +%Y%m%d-%H%M%S)"
docker compose start heresy-server
```

Store backups encrypted and outside the repository. They contain bearer player codes, private chat, roles, and actions. Define and test a retention policy appropriate to the deployment.

## Restore

1. Stop the server and save the current data directory separately.
2. Restore a complete, matching backup into `./data`.
3. Check ownership and permissions for the container user.
4. Start only the server and inspect migration/startup logs.
5. Call `/api/health`, then verify one active game and player reconnection before starting the client.

## Restart behavior

On a normal restart, the server reloads active games and persisted deadlines. It resolves each overdue phase once and schedules future deadlines. Clients authenticate with their player code, request current sanitized state, and fetch messages after their last received sequence. Duplicate socket connections must not duplicate votes, actions, or phase resolution.

If startup repeatedly fails, preserve the database and WAL files before troubleshooting. Do not delete or manually edit production rows. Restore the last verified backup if a migration cannot complete safely.
