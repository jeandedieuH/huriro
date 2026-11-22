# ADR-0018: Packaging — one image with roles + minimal compose

- **Status:** Accepted (v1.1, M0)
- **Date:** 2026-11-22
- **Plan refs:** §5.1, §19.2

## Context

Three runtime roles (`api`, `worker`, `realtime`) share every module, config schema,
and migration. Self-host needs a 10-minute install on a 2-vCPU box; the cloud needs
the same artifacts scaled horizontally.

## Decision

**One container image** (`ghcr.io/huriro/huriro:<semver>`) whose entrypoint is
`huriro serve --role=api|worker|realtime|all`.

- `all` runs the three roles as separate Bun workers under one supervisor — the
  minimal self-host stack is **caddy + huriro + postgres** (the image also serves the
  static web build; no separate web server).
- At scale, the same image runs as separate deployments per role with independent
  scaling, restarts, and resource limits.
- One compose file (`infra/compose/compose.yml`) serves all three self-host shapes;
  profiles (`valkey`, `clamav`, `s3`, `otel`, `embedded-mail`) switch the extras.
- Migrations apply automatically on start under a Postgres advisory lock —
  expand-phase only; the server refuses to boot against a newer schema.
- Images are pinned by digest, multi-arch (amd64/arm64), signed (cosign), with SBOMs.

## Alternatives considered

- **Three images/apps** — triplicates wiring and Docker builds for zero benefit;
  roles are isolated at runtime, not by artifact (§7.1 note).
- **Microservices** — rejected for v1 (§1.2): module boundaries + the outbox are the
  future split lines.

## Consequences

- `Dockerfile` produces the single image; `apps/server/src/cli/` owns all operator
  commands so `huriro` inside the image _is_ the operator surface
  (`init`, `doctor`, `backup`, `restore`, `migrate`, `create-admin`, `health`).
