# @huriro/server

One image, three roles: `api` | `worker` | `realtime` (+`all` for self-host) —
ADR-0018, §19.1. Also the operator CLI (`huriro`).

## Shape (§7.2)

- `src/index.ts` — CLI dispatch only; `serve` keeps `.listen()` here.
- `src/env.ts` — env schema, `_FILE` indirection, fail-fast boot (§7.5).
  `.env.example` is generated (`genenv`), never hand-edited.
- `src/api/` — Elysia app: observability hooks, problem+json mapper, routes.
- `src/modules/<name>/` — index (routes) + schema + service + repo + policy +
  events per module. Only index.ts may be imported cross-module.
- `src/worker/` — pg-boss (admin URL for queue DDL) + outbox drain; job
  handlers do tenant work through the app pool inside `withWorkspace`.
- `src/realtime/` — M0 stub until the sync milestone.

## Hard rules

- Every response shape that can fail returns problem+json via `HttpError` —
  never ad-hoc `{error}` objects (§16.2).
- No request path may query without `withWorkspace`/`withSystem` (§12.4).
- No secrets in logs — pino redact list is the allowlist (§4.2).
- New module ⇒ module dir + deny-path test + AGENTS boundary entry.
