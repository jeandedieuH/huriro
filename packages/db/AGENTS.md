# @huriro/db

All schema lives here (§7.2 — apps never define tables). Three artifacts per
table: a **migration** (raw SQL — RLS, triggers, composite FKs, counters),
a **Drizzle schema file** (`src/schema/<module>.ts` — typed queries only),
and classification in the **RLS coverage test**.

## Owns

- `migrations/` — hand-written `NNNN_name.sql`, expand-phase only, immutable
  once applied (checksum-pinned; edit → write a new migration).
- `src/schema/` — Drizzle tables, one file per module per
  `MODULE_SCHEMA_OWNERSHIP` (packages/config/dependency-cruiser.cjs).
- `src/context.ts` — `withWorkspace(tx, ctx, fn)`: the ONLY way to obtain a
  tenant transaction (`set_config(…, true)`, transaction-local). `withSystem`
  for instance-level ops.
- `src/migrate.ts` — advisory-locked runner used by `huriro migrate` and boot.
- `src/client.ts` — `huriro_app` pool (all traffic) vs owner pool (migrate/CLI only).

## Never do

- No session `SET` for `app.*` settings — transaction-local only, or tenants leak
  across pooled connections (§12.4).
- No `SELECT *` on tenant tables in request paths; no raw string interpolation.
- No tenant table without `workspace_id`, composite FK target, RLS policy in
  `migrations/`, and an entry in the coverage test (§4.2).
- `set_updated_at` trigger handles `updated_at` — never write it from app code.

## Test

`bun test` here for pure units; integration (RLS, migrations) lives in
`packages/test-utils` and runs against Testcontainers/`DATABASE_URL`.
