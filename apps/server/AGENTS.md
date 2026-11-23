# @huriro/server

One image, three roles: `api` | `worker` | `realtime` (+`all` for self-host) —
ADR-0018, §19.1. Also the operator CLI (`huriro`).

## Shape (§7.2)

- `src/index.ts` — CLI dispatch only; `serve` keeps `.listen()` here.
- `src/env.ts` — `_FILE` indirection + cross-field rules over @huriro/env's
  zod/t3-env schema, fail-fast boot (§7.5). `.env.example` is generated
  (`genenv`), never hand-edited.
- `src/api/` — Elysia app: observability hooks, problem+json mapper, SSRF egress proxy (`egress.ts`), envelope AES-256-GCM crypto (`crypto.ts`), routes.
- `src/modules/<name>/` — index (routes) + schema + service + repo + policy +
  events per module (`tenancy`, `tasks`, `docs`, `chat`, `files`, `notifications`, `search`, `imports`, `webhooks`, `integrations`, `ai`). Only index.ts may be imported cross-module.
- Chat partitioned sync (§15.1–§15.2): `chat` allocates per-channel monotonic `channel_seq` and `rev` under `chat_channels` lock order, exposes `/api/v1/chat/channels/:id/changes?since=`, and never writes chat rows to workspace `change_log`.
- Egress & secrets: every outbound URL fetch (OpenGraph unfurling, outbound webhooks) goes through `api/egress.ts`; webhook/GitHub secrets use `api/crypto.ts` and are never logged or returned after creation/rotation.
- Module `index.ts` IS the controller: a factory returning a named `Elysia`
  instance (Elysia best practice — never `(app: unknown)` group casts, never
  hand-typed `Context` params). Schemas in `schema.ts` give each route its
  handler types.
- Workspace-scoped routes chain `.derive(workspaceDerive(sql, auth))`
  (from `tenancy`) before the routes that need it; handlers then get
  `inWorkspace(fn)` + `workspaceCtx` — the only door to tenant queries.
  Session-only routes in the same controller must be registered BEFORE the
  derive.
- `src/worker/` — pg-boss (admin URL for queue DDL) + outbox drain; job
  handlers do tenant work through the app pool inside `withWorkspace`.
- `src/realtime/` — `/ws` signal fan-out (cursor + revoke) + `/collab` Hocuspocus
  runtime (`collab.ts`): single-use tickets, room leases with epoch fencing,
  live readOnly enforcement, fenced Yjs persistence.
- `scripts/collab-soak.ts` — Gate G2 multi-editor soak; `bun run soak:collab`.

## Hard rules

- Every response shape that can fail returns problem+json via `HttpError` —
  never ad-hoc `{error}` objects (§16.2).
- No request path may query without `withWorkspace`/`withSystem` (§12.4).
- No secrets in logs — pino redact list is the allowlist (§4.2).
- New module ⇒ module dir + deny-path test + AGENTS boundary entry.
