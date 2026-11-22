# 7. Monorepo & Code Organization

## 7.1 Layout

```text
huriro/
├── apps/
│   ├── server/                 # ONE image, entrypoints per role: `huriro serve --role=api|worker|realtime|all`
│   │   ├── src/api/            # Elysia app: REST, MCP endpoint, webhooks, static web assets
│   │   ├── src/modules/<domain>/{index,schema,service,repo,policy,events}.ts
│   │   ├── src/realtime/       # Signal-plane WebSocket + Hocuspocus rooms + presence
│   │   ├── src/worker/         # Outbox consumers, schedulers, mail sync, embeddings, imports
│   │   └── src/cli/            # Operator commands: migrate, doctor, backup, restore, create-admin
│   ├── web/                    # TanStack Start; app routes client-only (ssr:false), PWA
│   │   └── src/features/<area>/{components,hooks,routes}/   # feature folders, small files
│   ├── mobile/                 # Expo Router app
│   └── desktop/                # Thin native shell (Tauri-class) — post-GA
├── packages/
│   ├── db/                     # Drizzle schema + raw-SQL migrations (RLS, triggers, counters) + seeds
│   ├── contracts/              # TypeBox schemas, DTOs, error codes, event payloads, tool schemas
│   ├── domain/                 # Pure domain logic (permissions, ordering, threading) — no I/O
│   ├── agent-tools/            # The tool registry: one definition per tool → REST, MCP, CLI, in-app AI
│   ├── api-client/             # Eden typed client + generated OpenAPI SDK (MIT)
│   ├── cli/                    # `huriro` CLI for users and agents, generated from OpenAPI (MIT)
│   ├── sync-client/            # TanStack DB sync adapter + collection definitions + offline executor
│   ├── design-tokens/          # DTCG JSON → shadcn CSS vars + Tailwind @theme + Uniwind/RN theme
│   ├── ui/                     # Web components (shadcn/Base UI, owned code) in src/components/<group>/
│   ├── ui-native/              # Shared RN primitives (HeroUI Native + @expo/ui wrappers)
│   ├── editor/                 # TipTap extensions, schema, Yjs binding, markdown I/O
│   ├── i18n/                   # Lingui catalogs, locale loaders, formatting helpers
│   ├── auth-client/            # Session hooks, guards, workspace context
│   ├── config/                 # tsconfig, biome, dependency-cruiser, tailwind presets
│   └── test-utils/             # Factories, Testcontainers harness, MSW handlers, fake clock
├── infra/
│   ├── compose/                # compose.yml (minimal) + profiles: s3, valkey, clamav, otel, mail
│   ├── dokploy/                # Dokploy template and docs
│   ├── helm/                   # Kubernetes chart (post-GA, cloud path)
│   └── grafana/                # Dashboards as code
├── docs/
│   ├── plan/                   # This plan split into one file per section, linked from an index
│   ├── adr/                    # Architecture Decision Records (numbered)
│   ├── runbooks/               # Restore, rotate secrets, incident playbooks
│   ├── threats/                # STRIDE model per module
│   └── api/                    # Generated OpenAPI + guides + llms.txt
├── AGENTS.md                   # Root agent guide; each app/package has its own short AGENTS.md
├── .github/workflows/          # CI/CD
├── package.json                # Bun workspaces; `bun run verify` = the full local gate
└── turbo.json                  # Task graph + cache
```

> **Why one `apps/server` instead of three apps:** the three roles share every module, config schema, and migration; separate apps would triplicate wiring and Docker builds. Roles stay isolated at runtime (separate processes, health checks, and resource limits) while the code has one composition root.

## 7.2 Package rules

- **No app imports another app.** Shared code lives in `packages/*`.
- **`packages/domain` is pure.** No `fs`, no `fetch`, no DB, no clock, no randomness — injected instead. This makes the permission and ordering logic trivially testable.
- **`packages/db` owns all schema.** Apps never define tables.
- **`packages/contracts` is the wire format.** HTTP bodies, event payloads, MCP tool schemas. Both server and client import from here; no duplicated shapes.
- **`packages/ui` is vendored code, not a dependency.** We own and can edit every component (shadcn model). Updates are deliberate diffs.
- **No barrel files** in `modules/*` (they defeat tree-shaking and create cycles); explicit exports only.
- **Small files, feature folders.** UI lives in `components/<group>/` (packages) or `features/<area>/components/` (apps); a component file over ~250 lines or with more than one exported component is split. Named exports only.
- **Every package has an `AGENTS.md`** (≤ 60 lines): what it owns, its public interface, commands to test it, and "never do" rules. The root `AGENTS.md` maps the architecture and links to the ADRs. These files are reviewed like code; a recurring agent mistake becomes a lint rule or test, then a line here.
- **Generated code is committed and checked.** OpenAPI spec, CLI, tool manifests, token outputs, and i18n catalogs are generated by `bun run gen`; CI fails if regenerating produces a diff.

## 7.3 API module shape

```text
apps/server/src/modules/tasks/
├── index.ts          # Elysia plugin: routes + guards, exported as a plugin
├── schema.ts         # TypeBox request/response + OpenAPI metadata
├── service.ts        # Authorized business operations (takes ctx, returns DTO)
├── repo.ts           # SQL/Drizzle access; always workspace-scoped
├── policy.ts         # Task-specific authorization rules
├── events.ts         # Event names + payload builders
└── tasks.test.ts     # Unit + integration (real DB)
```

Rules:

- **Routes do not contain business logic.** They parse → authorize → call service → map result.
- **Services do not know about HTTP.** They accept a typed `ActorContext` (`userId`, `workspaceId`, `roles`, `scopes`, `requestId`).
- **Repos always require a workspace scope** as a type-level argument, so it cannot be forgotten.
- **Policies are pure functions** `(actor, action, resource) => Decision` returning `allow | deny(reason)`. They are the single place role math lives, and every one has table-driven tests.

## 7.4 Shared types across web/mobile

- `packages/contracts` holds **runtime schemas** (TypeBox/Standard Schema) and **derived types**. Mobile and web consume the same types.
- API client: Eden for web (zero codegen); generated OpenAPI client for agents, self-hosters, and non-TS uses. Both are checked in CI against the running server's spec (contract test).
- Never import server-only code into a client bundle: Biome rule + `server-only`-style poison-pill exports.

## 7.5 Configuration & environment

- One `env.ts` per app using a schema validator; the process **refuses to boot** with a missing/invalid variable and prints exactly which and why.
- `.env.example` is generated from the schema (never hand-maintained).
- Secrets come from the platform secret store (Docker secrets / vault / cloud secret manager); env vars may reference files (`DATABASE_URL_FILE`).
- Feature flags are server-evaluated and typed; client sees only boolean payloads, never rules.
