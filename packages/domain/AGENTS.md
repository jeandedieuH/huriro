# @huriro/domain

Pure domain logic — **no I/O, no clock, no randomness, no imports** (§7.2).
Everything here is injected, which is what makes the permission and ordering
logic trivially testable.

## Owns

- `permissions.ts` — the closed `Action` catalog and system-role seed data
  (`SYSTEM_ROLES`). The DB `role_permissions` CHECK constraint and workspace
  seeding are generated from this list — change it here, never in SQL.
- `policy.ts` — `can(actor, action, resource) -> Decision` (§12.3), the single
  place role math + ACL evaluation lives. Callers resolve membership/perms/ACL
  first; the function stays pure.
- `policy.test.ts` — the roles × resources × actions matrix. **Add a row for
  every rule change.**

## Never do

- No `fs`/`fetch`/DB/Date/random — injected instead (enforced by dependency-cruiser).
- No imports from other workspace packages.
- Policy decisions stay deny-by-default: a new action with no rule must deny,
  not fail open.

## Test

`bun test` in this package. Coverage gate: ≥ 80% of changed lines (§21.4).
