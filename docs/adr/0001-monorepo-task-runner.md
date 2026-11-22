# ADR-0001: Monorepo task runner — Turborepo

- **Status:** Accepted (M0)
- **Date:** 2026-11-22
- **Plan refs:** §6.4, §7

## Context

The monorepo holds `apps/` (server, web, mobile later) and `packages/` (~15 packages).
We need a task graph (`build`, `typecheck`, `test`, `lint`, `gen`) with caching so
`bun run verify` stays fast as the repo grows, and so CI can reuse the same graph.

## Decision

Use **Turborepo** (`turbo.json` at repo root) on top of Bun workspaces.

- Tasks are declared per-package in `package.json` scripts; turbo orchestrates by dependency graph.
- Remote cache is **not** configured at v1 (optional later; self-host CI must not depend on a hosted cache).
- `bun run verify` at root runs the full local gate through turbo (`lint`, `typecheck`, `test`, `gen:check`, `build`).

## Alternatives considered

- **Nx** — more features than needed; heavier config and plugin surface for a solo maintainer.
- **Moon** — strong model, but a second toolchain to learn and explain.
- **Plain `bun --filter` scripts** — no caching or graph awareness; every verify would be a full sweep.

## Consequences

- All orchestration config lives in `turbo.json`; packages stay self-describing.
- If turbo becomes a bottleneck it is replaceable without touching package boundaries.
