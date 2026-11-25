# @huriro/server

One image, three roles: `api` | `worker` | `realtime` (+`all` for self-host) —
ADR-0018, §19.1. Also the operator CLI (`huriro`).

## Shape (§7.2)

- `src/index.ts` — CLI dispatch only; `serve` keeps `.listen()` here.
- `src/env.ts` — `_FILE` indirection + cross-field rules over @huriro/env's
  zod/t3-env schema, fail-fast boot (§7.5). `.env.example` is generated
  (`genenv`), never hand-edited.
- `src/api/` — Elysia app: observability hooks, problem+json mapper, SSRF egress proxy (`egress.ts`), envelope AES-256-GCM crypto (`crypto.ts`), routes.
- `src/email/` — React Email composition (`components/`, 14 templates in `templates/`), HTML + plain-text renderer (`render.ts`), multi-provider transport pipeline (`transports.ts`: Emailit for `cloud`, Resend or SMTP/nodemailer for `selfhost`, safe noop fallback), and typed `EmailPipeline` service (`service.ts`).
- `src/modules/<name>/` — index (routes) + schema + service + repo + policy +
  events per module (`tenancy`, `tasks`, `docs`, `chat`, `files`, `notifications`, `search`, `imports`, `webhooks`, `integrations`, `ai`, `agents`, `mail`, `graph`, `automations`). Only index.ts may be imported cross-module.
- `mail` module (§14, ADR-0023): canonical store is `mail_*` tables — raw MIME
  is quarantined blob storage (`mail-raw/...`), parsed/sanitized projections
  only in tables. `/mail/inbound/:token` + `/mail/webhook/:token` are
  pre-tenant token routes (SECURITY DEFINER `resolve_mail_inbound_route`,
  CSRF-exempt like the GitHub webhook); everything else is workspace-scoped
  `mail.read`/`mail.assign`/`mail.send` (+ optional `visibility:'private'`
  account ACL). Drafts double as the outbound queue — `mail-outbound-due`
  sweeps `scheduled_send_at` (undo-send), never an eager outbox event.
  `MailWorkerDeps.transportOverride` is the test/self-host seam for fake
  transports.
- `agents` module: `dispatch.ts` is the ONLY tool-execution path (§13.3);
  `principal.ts` re-resolves owner/principal state per call; bearer-only
  `/api/v1/agent/*` routes vs session `/agents` + `/approvals` routes;
  `markdown.ts` sanitizes all user-authored tool output (§13.6).
  Stage 3: `mcp.ts` mounts root `/mcp` (stateless Streamable HTTP, POST only,
  `legacy:'reject'`, fresh McpServer per request, `mcp_enabled` workspace kill
  switch ⇒ 403 `agents_disabled`); R1 writes confirm via signed MRTR
  `request-state.ts`; no-elicitation clients fall back to R2 approvals.
  Markdown renderers live in `api/markdown.ts` (shared — `no-circular` forbids
  tasks/docs importing the agents module); `.md` reps ride inside
  `/issues/by-key/`, `/docs/by-slug/` params plus `/agent/**.md` twins.
- Entity-link writes live in `api/entity-links.ts` for the same no-circular
  reason (ADR-0033): tasks/docs/mail dual-write through that helper, while the
  `graph` module reads endpoint visibility/peek metadata back through each
  owning module's exported `index.ts` seam. Modules must never import
  `modules/graph` internally.
- `automations` module (§7.2, ADR-0028): the outbox matcher only inserts
  `automation_runs` inside the drain transaction; action execution is always
  post-commit (plus the 30s `automation-runs` spillover queue) under the rule's
  active `kind='automation'` principal, never as a bypass actor. M7 conditions
  are issue-shaped `FilterExpr`s. The loop guard is deliberately invisible to
  producer modules: the executor sets transaction-local `app.automation_depth`
  to run depth + 1 via `setAutomationDepth`, and migration 0024's BEFORE INSERT
  trigger on `outbox` merges that value into `payload.x_automation_depth`
  (largest explicit value wins). Depth >= 5 writes `loop_guard_tripped` and no
  action runs. Cron rules ride the every-minute `automation-cron` queue and are
  claimed by optimistically advancing `next_run_at` before inserting the run.
- `ai` module (§11.3–§11.4, ADR-0022): workspace-off-by-default gateway —
  `policy.ts` loads flags + caps all AI routes (`ai.manage` to configure,
  `ai.use` to run, `ai_no_provider`/`ai_disabled` errors); BYO providers store
  envelope-encrypted keys (AAD `ai-provider:<name>`, never returned);
  `gateway.ts` redacts input, wraps it as untrusted, exact-caches by prompt
  hash, meters every call to `ai_runs`, traces prompts only under
  `ai_trace_prompts`; `embeddings.ts` embeds chunks from the outbox on
  content-hash change; `/ai/search` reuses search's ACL filter. Only
  `kind='ollama'` providers get `allowPrivate` egress — every other provider
  URL stays under strict SSRF rules (§20).
- `tasks` module (§3.1, §3.4): `listIssues` EXCLUDES `triage_status IN
  ('pending','snoozed')` unless `ListIssuesQuery.triageStatus` opts in — sync
  feeds include all rows (clients filter); `POST /issues/query` +
  `filter-sql.ts` interpret domain `FilterExpr` to SQL with semantics pinned by
  the `filter-sql.integration.test.ts` differential test (SQL id-set === domain
  `evaluateFilter` id-set over seeded random exprs); `POST /issues/bulk` +
  `/bulk/restore` are set-based single-tx writes (one outbox INSERT, one
  `appendChanges` change_log batch, `undoWindowMs` for restore);
  `runTriageWakeOnce` is the pg-boss `triage-snooze-wake` sweep flipping
  expired snoozes back to pending. `runCycleMaintenanceOnce` is the nightly
  `tasks-cycle-maintenance` sweep (§3.3): per cycle-enabled project in one
  tenant tx it completes expired actives and rolls unfinished issues per
  `cycle_auto_rollover_mode`, activates the due planned successor in the same
  pass, pre-creates future windows, and upserts `cycle_daily_snapshots`
  (net-total scope delta until M8 `issue_activity`) — repeat runs with the same `now` write nothing.
  Discovery rides SECURITY DEFINER `list_cycle_maintenance_projects()` (0022);
  `GET /cycles/:cycleId/snapshots` serves the ascending series (`issue.read`).
- Chat partitioned sync (§15.1–§15.2): `chat` allocates per-channel monotonic `channel_seq` and `rev` under `chat_channels` lock order, exposes `/api/v1/chat/channels/:id/changes?since=`, and never writes chat rows to workspace `change_log`.
- Egress & secrets: every outbound URL fetch (OpenGraph unfurling, outbound webhooks) goes through `api/egress.ts`; webhook/GitHub secrets use `api/crypto.ts` and are never logged or returned after creation/rotation.
- Agent credentials (M3, ADR-0019): identity also exposes
  `verifyAgentBearer(auth, request, {audience: 'mcp'|'rest'})` →
  `{userId, clientId, scopes, tokenId, audience}` — audience-bound OAuth
  verification, never interchangeable with cookie sessions. Boot seeds
  `ensureAgentOAuthSeed` (resources + `huriro-cli` public client, device
  grant, no consent skip). CIMD metadata fetches go through
  `modules/identity/cimd-transport.ts` on top of `api/egress.ts`
  (redirects refused).
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
  Outbox retries use capped exponential backoff (10s→1h) and dead-letter
  after 25 attempts (ADR-0025, §5.5): dead letters stay in `outbox` with
  payload + error, operator surface is `huriro dead-letters [show|replay]`.
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

- Agent surfaces: `/mcp` (POST-only, MCP-audience tokens) and `/api/v1/agent/*` (REST-audience tokens AND `hrk_` workspace API keys via `verifyRestAgentCredential`). API keys are REST-only — rejected on `/mcp` before `requireMcpAuth`, never reach session routes. `GET /api/v1/agent/workspaces` lists the token owner's active memberships for CLI workspace binding.
- `/api/v1/agents/api-keys*` is session-only + `agent.manage` (R3 — never a tool); keys are `hrk_<8>_<43>` SHA-256-hashed, bound to an `automation` principal, and scrubbed from logs via `api/observability.ts`.
