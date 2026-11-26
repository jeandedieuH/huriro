# Runbook: Production Incident Response

## Severity Classification

- **SEV-1**: Total service outage (`/healthz` or `/readyz` failing), cross-tenant data exposure, or credential compromise.
- **SEV-2**: Sustained SLO breach (`p99 > 500ms` or `5xx > 0.5%`), Valkey pub/sub partition, or worker backlog > 5,000 pending outbox rows.
- **SEV-3**: Single non-critical webhook/FX upstream degradation with active fallback.

## Immediate Triage Checklist

1. **Check liveness, readiness, and metrics**:

   ```bash
   curl -i https://workspace.example.com/healthz
   curl -i https://workspace.example.com/readyz
   curl -s https://workspace.example.com/metrics | grep -E "huriro_outbox_pending|huriro_ws_active_connections"
   ```
2. **Contain blasts**:
   - If data corruption or unauthorized writes are suspected, enable `HURIRO_READ_ONLY=true` immediately (`503 read_only_mode` on all writes while keeping reads up).
   - If a specific session or token is compromised, trigger session/API-key revocation or self-erasure; publish revocation signals across realtime nodes.
3. **Inspect dependencies**:
   - **PostgreSQL 18**: Confirm connection pools (`huriro_app`, max connections) and pending migrations (`migrationsPending: 0` in `/readyz`).
   - **Valkey**: If Valkey drops, `ResilientPubSub` fails over to `PostgresNotifyPubSub` / `InProcessPubSub`. Restore Valkey service to re-enable cross-node horizontal realtime fan-out without restarting API pods.
4. **Post-Incident**:
   - Verify outbox backlog drains (`huriro_outbox_pending -> 0`).
   - Run `bun run chaos:smoke` and check Grafana dashboard SLO panels for 15 minutes before closing.
