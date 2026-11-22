# Huriro

A secure, scalable, modular workspace platform — self-host first, cloud-ready.
Server + apps: **AGPL-3.0** · SDKs, CLI, MCP schemas: **MIT** (ADR-0015).

## Status

Milestone **M0 — Spine** (foundation, identity, self-host, design system v0).
See `docs/plan/` for the full plan and `docs/adr/` for decisions.

## Quickstart (self-host)

```sh
bun install
bun apps/server/src/index.ts init --domain localhost   # writes secrets/, .env, Caddyfile
docker compose -f infra/compose/compose.yml up -d --build
# → http://localhost:3000/setup with the printed one-time setup token
bun run doctor                                          # preflight checks
```

## Develop

```sh
bun run verify          # lint + typecheck + test + boundaries + licenses
bun run test            # unit tests (no DB needed)
DATABASE_URL=postgres://… bun test packages/test-utils   # RLS/integration suite
```

`AGENTS.md` maps the architecture and rules for contributors and agents.
