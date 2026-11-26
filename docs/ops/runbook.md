# Huriro ops runbook (GA)

Deploy, health-check, and recover a self-hosted or cloud Huriro instance. §19–§20 are the spec; see the specialized runbooks under `docs/runbooks/` for detailed procedures:

- [PostgreSQL Backup & Restore](file:///docs/runbooks/restore-postgres.md)
- [Incident Response](file:///docs/runbooks/incident-response.md)
- [Secret & Key Rotation](file:///docs/runbooks/rotate-secrets.md)

## Deploy

```bash
bun apps/server/src/index.ts init --domain app.example.com   # secrets/ + .env + Caddyfile
docker compose -f infra/compose/compose.yml up -d --build    # first boot: postgres image builds
docker compose -f infra/compose/compose.yml ps               # all healthy
curl -fsS https://app.example.com/health                     # {"status":"ok"}
```

Then open `https://app.example.com/` and finish the setup wizard with the setup
token from `huriro init` output.

## Smoke test

```bash
bun scripts/compose-smoke.ts          # config + §19.4 invariants, no pulls — CI-safe
bun scripts/compose-smoke.ts --up     # full boot → /health → teardown (needs secrets/)
```

Run the config mode on every infra change; run `--up` before shipping a release.

## Backup & restore drill (run monthly + before upgrades)

Postgres image ships pgBackRest; WAL archiving + repo config land with M3's
storage milestone. Until then the drill uses `pg_dump`/`pg_restore` — the
procedure and RPO expectations are identical, only the transport differs.

1. **Backup** (from the `data` network — never expose postgres):

   ```bash
   docker compose -f infra/compose/compose.yml exec -T postgres \
     pg_dump -U huriro -Fc huriro > backup-$(date +%F).dump
   ```
2. **Restore rehearsal** — into a throwaway DB, never over live:

   ```bash
   docker compose -f infra/compose/compose.yml exec -T postgres \
     psql -U huriro -d postgres -c "CREATE DATABASE huriro_restore_test;"
   docker compose -f infra/compose/compose.yml exec -T postgres \
     pg_restore -U huriro -d huriro_restore_test < backup-YYYY-MM-DD.dump
   ```
3. **Verify** — row counts on sentinel tables must match source:

   ```bash
   docker compose -f infra/compose/compose.yml exec -T postgres psql -U huriro \
     -d huriro_restore_test -c "SELECT count(*) FROM users; SELECT count(*) FROM workspaces;"
   ```
4. **Cleanup**: `DROP DATABASE huriro_restore_test;`
5. Record the drill (date, duration, row counts) in the ops log.

RPO with nightly dumps is 24h; WAL archiving (pgBackRest) reduces it to ~5 min
once object storage lands in M3.

## Observability & Maintenance

- `GET /metrics` — Prometheus counters & histograms (`infra/grafana/overview.json`).
- `GET /health` & `GET /healthz` — liveness probe; compose healthchecks consume it.
- `GET /ready` & `GET /readyz` — readiness probe (PostgreSQL connectivity + zero pending migrations).
- `HURIRO_READ_ONLY=true` — pauses all API mutations with HTTP `503 read_only_mode` (`Retry-After: 60`) while keeping reads online during maintenance.
- `bun run dr:drill` (`--live` with PG18) — automated migration + RLS + restore rehearsal (< 15 min RTO).
- `bun run chaos:smoke` — RESP2 Valkey failover & rate-limiter resilience verification.
- Structured logs on stdout (`docker compose logs -f huriro`) — no PII/secrets.
- External heartbeat: point your uptime monitor at `/healthz`; if using a
  push-style heartbeat, set `HEARTBEAT_URL` and the server pings it.

## Incident basics

- **App unhealthy**: `docker compose logs --tail 200 huriro` → most common
  cause is a missing/rotated secret; re-check `secrets/` files then
  `docker compose up -d huriro`.
- **DB down**: `docker compose logs postgres`; data lives in `pgdata` volume —
  do NOT `down -v` unless you intend to wipe.
- **Rotate a secret**: write new value into `secrets/<name>`, rotate inside
  Postgres if it's a role password, `docker compose up -d` to remount.
- **Restore from scratch**: redeploy stack → restore dump into fresh postgres
  → `huriro migrate` → restart.

## Upgrade

```bash
git pull && docker compose -f infra/compose/compose.yml up -d --build
docker compose -f infra/compose/compose.yml exec huriro bun src/index.ts migrate
```
Migrations are expand→migrate→contract; the app tolerates the previous schema
one version back (§6.4).
