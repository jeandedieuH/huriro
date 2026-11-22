# @huriro/test-utils

Factories, the Testcontainers/`DATABASE_URL` harness, and the RLS coverage
test (§21.3, §4.2).

## Owns

- `db.ts` — `getTestDb()`: owner pool (fixture setup, bypasses RLS) + app pool
  (`huriro_app`, the role under test). `DATABASE_URL` wins; else Testcontainers
  when `HURIRO_TESTCONTAINERS=1`; else null → callers `skip()`.
- `factories.ts` — typed builders (`aUser`, `aWorkspace` seeds system roles,
  `anAclEntry`, `seedTwoTenants`). Extend, don't hand-SQL fixtures.
- `rls.ts` + `rls.test.ts` — the table classification allowlist and the
  coverage assertions.

## The hard rule

**Every new `public` table must be classified in `rls.ts`** (tenant /
instance_rls / system) in the same PR that creates it — the coverage test fails
otherwise. That is the §4.2 "entry in the RLS coverage test" requirement.

## Never do

- Assertions never run through the owner pool (it bypasses RLS — worthless test).
- No shared global fixture state; factories use a per-process counter (§21.3).
