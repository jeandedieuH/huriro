# Runbook: PostgreSQL 18 Backup & Restore

## Preconditions

- Access to `DATABASE_ADMIN_URL` (migration owner credentials) and `pg_dump` / `pg_restore` / `psql` binaries (PostgreSQL 18).
- For production restores, enable read-only mode (`HURIRO_READ_ONLY=true`) before cutting over traffic.

## 1. Automated Verification Drill

Run the automated rehearsal script to confirm migration sequence, RLS policies (`workspaces`, `issues`, `billing_subscriptions`, `workspace_exports`), and RTO (< 15 minutes):

```bash
bun run dr:drill -- --live
```

## 2. Verified Backup (`pg_dump`)

```bash
bun apps/server/src/index.ts backup --out ./backups --verify
```
Or directly inside Compose:

```bash
docker compose -f infra/compose/compose.yml exec -T postgres \
  pg_dump -U huriro -Fc huriro > "backup-$(date +%F).dump"
```

## 3. Rehearse Restore Into Throwaway Database (Never Live First)

```bash
createdb huriro_restore_test
pg_restore --no-owner --role=huriro -d huriro_restore_test backup-YYYY-MM-DD.dump
psql -d huriro_restore_test -c "
  SELECT 'workspaces', count(*) FROM workspaces
  UNION ALL SELECT 'users', count(*) FROM users
  UNION ALL SELECT 'issues', count(*) FROM issues
  UNION ALL SELECT 'billing_subscriptions', count(*) FROM billing_subscriptions;
"
dropdb huriro_restore_test
```

## 4. Production Restore

1. Enable `HURIRO_READ_ONLY=true` or scale API/worker replicas to `0`.
2. Restore into target DB:

   ```bash
   bun apps/server/src/index.ts restore ./backups/backup-YYYY-MM-DD.dump --yes
   ```
3. Ensure schema is current (`bun run migrate`) and verify `/readyz` returns `200` before clearing `HURIRO_READ_ONLY`.
