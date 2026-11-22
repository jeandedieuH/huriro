# ADR-0007: Authorization — relational ACL, not a relationship graph (v1)

- **Status:** Accepted for v1; revisit after GA
- **Date:** 2026-11-22
- **Plan refs:** §8.3 (`roles`, `role_permissions`, `acl_entries`), §12.3–12.5

## Context

Authorization needs three layers: workspace-wide role permissions, object-level ACLs
(private channels/docs/projects, guest scoping, per-user sharing), and RLS as the
data-layer backstop.

## Decision

**Roles are data** (`roles` + `role_permissions`, versioned, per-workspace customizable —
bitmasks are explicitly rejected). Object-level access uses a **relational ACL table**
(`acl_entries`) evaluated:

- in the pure policy function `can(actor, action, resource) -> Decision` in
  `packages/domain` (deny by default; admins bypass ACLs through an explicit audited path), and
- in SQL for list endpoints via a `SECURITY DEFINER` helper `can_read(resource_type,
  resource_id, user_id)` mirrored into RLS policies.

## Alternatives considered

- **OpenFGA / SpiceDB (Zanzibar-style graph)** — the right answer when rules become
  compositional (nested doc/channel inheritance, folder-level sharing, cross-workspace
  guests). Wrong answer for v1: another stateful service every self-hoster must run,
  sync lag to reason about, and migration work we don't need yet.
- **Bitmask `role_mask`** — unreadable, unqueryable, can't express resource ACLs.
  Rejected (Appendix A.2).

## Consequences / graduation trigger

The policy interface is the seam — call sites must not change when the implementation
swaps. Graduate to a relationship graph when authorization rules become compositional.
Track in risk register; revisit post-GA.
