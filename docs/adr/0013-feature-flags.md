# ADR-0013: Feature flags — in-house, server-evaluated, typed

- **Status:** Accepted (M0)
- **Date:** 2026-11-22
- **Plan refs:** §7.5, §23.5 (flags & rollout)

## Context

New surfaces ship dark → internal → percentage → 100%, with kill switches. Self-host
installs must not depend on a third-party flag service.

## Decision

Build a small in-house flag system:

- Flags are rows in Postgres (`feature_flags` table), evaluated **server-side** per
  request context (workspace + user), cached briefly in-process.
- Flags are **typed**: each flag is declared in `packages/contracts` with its key,
  default, and rollout shape; unknown keys fail typecheck.
- Clients receive only evaluated booleans in a `/api/v1/flags` payload — never rules.
- Overrides: per-workspace and per-user allowlists in the same table; an env-level
  kill switch can force any flag off instance-wide.

## Alternatives considered

- **GrowthBook/Flagsmith/Unleash** — capable, but adds a required third-party service
  (or self-hosted component) for every install; overkill for the v1 flag count.
- **Env-var flags only** — no runtime rollout, no per-workspace targeting.

## Consequences

- The flag surface stays deliberately small: boolean + percentage + allowlist only.
  If targeting rules grow complex, re-evaluate a dedicated service behind the same
  server-evaluated interface.
