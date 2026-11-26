# Runbook: Secret & Key Rotation

Every credential in Huriro is injected via `*_FILE` paths (`secrets/` in Docker Compose) rather than literal env vars or code.

## 1. Encryption Root Envelope Key (`ENVELOPE_ROOT_KEY_FILE`)

1. Generate a new 32-byte base64 or hex key (`openssl rand -hex 32`).
2. Re-encrypt stored provider credentials (AI BYOK keys, webhook signing secrets, mail OAuth tokens) under the new key inside a maintenance window (`HURIRO_READ_ONLY=true`).
3. Atomically replace `secrets/envelope_root_key` and restart server replicas cleanly (`docker compose up -d`).

## 2. Database Role Passwords (`huriro_app`, `huriro_auth`)

1. Rotate the PostgreSQL password inside Postgres first (`ALTER ROLE huriro_app WITH PASSWORD '...'`), or use dual-credential windowing.
2. Update `secrets/app_db_password` and `secrets/database_url` (or trigger `huriro init` secret update).
3. Perform a rolling restart of `api`, `worker`, and `realtime` services and confirm `/readyz` returns `200`.

## 3. Auth, Collab, & Billing Provider Secrets

- **`BETTER_AUTH_SECRET_FILE`**: Generate 32+ random bytes. Note rotating invalidates existing browser session cookies cleanly.
- **`COLLAB_TICKET_SECRET_FILE`**: Short-lived Hocuspocus join tickets (< 5 min TTL); rolling restarts invalidate in-flight tickets cleanly and clients auto-refresh on reconnect.
- **Polar / IremboPay Webhook Secrets** (`POLAR_WEBHOOK_SECRET_FILE`, `IREMBOPAY_WEBHOOK_SECRET_FILE`): Create replacement secret in Polar/IremboPay dashboard, update the mounted secret file, reload server processes, and confirm `200 OK` on webhook test deliveries.
- **Agent API Keys (`hrk_...`)**: Revoke individual keys in **Settings → Agents & API keys** without restarting servers.
