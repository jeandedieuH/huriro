# Huriro

A secure, self-hostable, modular workspace platform. Monorepo: Bun workspaces

- Turborepo. This file is the map; package-level `AGENTS.md` files carry
  per-package rules. `docs/plan/` is the source of truth (§ = section there);
  `docs/adr/` records decisions.

## Commands

| Command                        | Purpose                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install`                  | install all workspaces                                                                                                                  |
| `bun run verify`               | the gate: lint + typecheck + test + build + gen:check + boundaries + licenses                                                           |
| `bun run dev`                  | dev (turbo)                                                                                                                             |
| `bun run migrate`              | apply DB migrations                                                                                                                     |
| `bun run doctor`               | instance preflight checks                                                                                                               |
| `bun test packages/test-utils` | RLS/integration suite (needs `DATABASE_URL` or `HURIRO_TESTCONTAINERS=1`; if ryuk can't pull, also `TESTCONTAINERS_RYUK_DISABLED=true`) |

## Layout

- `apps/server` — one image, three roles (api/worker/realtime) + `huriro` CLI.
- `packages/config` — shared tsconfig/biome/boundary rules.
- `packages/contracts` — wire schemas (TypeBox): problem+json, pagination.
- `packages/domain` — PURE core: permission catalog, roles, `can()` policy.
- `packages/db` — Drizzle schema + raw SQL migrations + `withWorkspace` + runner.
- `packages/test-utils` — factories, DB harness, the RLS coverage test.
- `infra/` — compose stack, postgres image (18 + pgvector + pgBackRest).
- `docs/plan`, `docs/adr`, `scripts/` — plan sections, ADRs, repo tooling.

## Hard boundaries (enforced by dependency-cruiser)

- Apps never import other apps. Packages never import apps.
- `domain` is pure: no fs, fetch, db, clock, or randomness.
- `db` owns all schema/SQL. `contracts` owns wire types.
- Only a module's `index.ts` may be imported cross-module.

## Non-negotiables (CI gates + review)

1. Every tenant table: `workspace_id`, composite `(workspace_id, id)` target,
   ENABLE+FORCE RLS, an entry in `test-utils/src/rls.ts`, deny-path tests.
2. All app traffic runs as `huriro_app` inside `withWorkspace`/`withSystem`.
3. Writes: domain rows + outbox + audit in ONE tx; cursor allocated last.
4. Errors are problem+json (§16.2); no stack traces/SQL/secrets in responses.
5. No secrets in code, env dumps, logs, or client bundles — `*_FILE` only.
6. Migrations are expand→migrate→contract, each with a rollback note.
7. New table ⇒ RLS classification entry; new permission ⇒ matrix test row.
8. `bun run verify` green before merge; ADRs for cross-cutting decisions.
