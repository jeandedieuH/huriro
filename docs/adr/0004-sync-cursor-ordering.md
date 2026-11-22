# ADR-0004: Sync cursor ordering — commit-ordered per-workspace counter

- **Status:** Accepted (v1)
- **Date:** 2026-11-22
- **Plan refs:** §8.5, §9.2

## Context

Huriro's local-first clients catch up via `GET /api/v1/sync/changes?since=<cursor>`.
An early sketch used a `BIGSERIAL` sequence on `workspace_events` and broadcast the
high-water sequence over WebSockets. Under concurrent writes, PostgreSQL sequences are
not commit-ordered: transaction T1 can allocate `seq = 5` and stall, while T2 allocates
`seq = 6` and commits first. A client pulling `since = 4` receives row 6, advances its
stored cursor to `6`, and permanently misses row 5 when T1 later commits.

## Decision

Allocate every workspace sync cursor **last** inside the writing transaction using a
single-row lock on `workspace_seq`:

```sql
SET LOCAL lock_timeout = '2s';
UPDATE workspace_seq
   SET last_cursor = last_cursor + <n>
 WHERE workspace_id = $workspace_id
 RETURNING last_cursor;
```

Because the row lock is held until `COMMIT`, cursor allocation order equals commit order,
giving a strictly monotonic, gap-free cursor stream per workspace while leaving
parallelism across workspaces untouched.

Hot paths that should not serialize the entire workspace (chat messages, bulk imports)
stay off this counter: chat uses a per-channel counter (§15.1), and bulk imports emit a
single coarse `grant` event so clients pull a scoped snapshot.

## Alternatives considered

- **`BIGSERIAL` sequence:** silently drops rows under concurrent writers. Rejected.
- **`xid8` + `pg_snapshot_xmin` watermark:** correct, but any long-running transaction
  anywhere on the database pins the global watermark and stalls delivery for every
  tenant. Rejected for v1.
- **Logical replication CDC from day one:** adds replication-slot WAL retention and
  publication ops burden for single-VPS self-hosters. Remains the additive migration path
  if a single tenant's write rate approaches hundreds of writes/sec; the client protocol
  (`since` / `nextCursor`) stays identical.

## Consequences

- Implemented in `apps/server/src/api/changelog.ts` (`appendChanges`).
- Verified in `packages/test-utils/src/sync.test.ts` under concurrent write storms.
- Monitored via `huriro_change_log_write_ms` histogram on `/metrics`.
