# Self-Hosting Huriro Guide

Deploy and operate a single-node or multi-replica Huriro workspace instance under your own domain.

## 1. Quick Start (Docker Compose)

1. Provision TLS/domain configuration and `*_FILE` secret files:
   ```bash
   bun apps/server/src/index.ts init --domain workspace.example.com
   ```
   This generates distinct least-privilege PostgreSQL roles (`huriro_app` with `NOBYPASSRLS`, `huriro_auth`, and migration owner), random signing keys, `.env`, `Caddyfile`, and a one-time bootstrap setup token.
2. Start the hardened Compose stack:
   ```bash
   docker compose -f infra/compose/compose.yml up -d --build
   ```
3. Verify container topology & health:
   ```bash
   bun run doctor
   curl -fsS https://workspace.example.com/healthz
   curl -fsS https://workspace.example.com/readyz
   ```

## 2. Environment & Secret Management

- Never store secrets directly in git or container `environment:` maps. Huriro resolves secrets from `*_FILE` paths (e.g., `DATABASE_URL_FILE`, `BETTER_AUTH_SECRET_FILE`, `ENVELOPE_ROOT_KEY_FILE`, `POLAR_ACCESS_TOKEN_FILE`, `IREMBOPAY_SECRET_KEY_FILE`).
- Run `bun run genenv` after schema changes to refresh `.env.example`.

## 3. Process Roles (`serve --role`)

One server image ships all runtime roles (ADR-0018):
- `--role=all`: Combined API, background worker, and WebSocket/Hocuspocus realtime server (recommended for single-node Docker Compose).
- `--role=api`: HTTP REST/Sync/MCP API nodes behind reverse proxy.
- `--role=worker`: Outbox relay, email digest, push notification fan-out, and scheduled jobs.
- `--role=realtime`: WebSocket signal gateway + collaborative Yjs Hocuspocus server; configure `VALKEY_URL` for multi-replica signal fan-out.

## 4. Upgrades & Migrations

```bash
git pull
docker compose -f infra/compose/compose.yml build
docker compose -f infra/compose/compose.yml exec huriro bun src/index.ts migrate
docker compose -f infra/compose/compose.yml up -d
```

Migrations follow expand→migrate→contract and run under a PostgreSQL advisory lock (`pg_advisory_lock`) with immutable SHA-256 checksums.
