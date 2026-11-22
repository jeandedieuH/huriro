# 4. Engineering Principles & Non-Negotiables

## 4.1 Architecture principles

1. **Modular monolith with enforced boundaries.** Each domain module owns its tables and exposes a service interface; cross-module access goes through that interface, never through another module's tables. Lint rules enforce this.
2. **One source of truth per fact.** Derived data (search vectors, embeddings, unread counts, link previews) is rebuilt from events, never hand-updated in two places.
3. **Every mutation is an event.** All writes emit a domain event in the same transaction (transactional outbox). Notifications, search indexing, webhooks, AI indexing, and audit all consume events.
4. **Tenant isolation is structural.** Every tenant-scoped table carries `workspace_id`; every query runs under a workspace-scoped database role with RLS enabled. A missing `WHERE` clause must be _impossible_, not merely unlikely.
5. **Idempotency by default.** Every non-idempotent endpoint accepts `Idempotency-Key`; every event consumer is idempotent by `event_id`.
6. **Optimistic UI, authoritative server.** The client may guess; the server decides. Rejections roll back visibly and explain themselves.
7. **Degrade, don't fail.** Realtime down → polling. Search down → Postgres FTS. AI down → the product still works. Mail provider down → reconciled later.
8. **Observable by construction.** Every request, job, and websocket session emits structured logs + traces with `workspace_id`, `user_id` (hashed), `request_id`.
9. **Reversible change.** Migrations are expand/contract; feature flags gate rollout; backups are tested, not assumed.
10. **Boring where it counts.** Innovation budget goes to UX and sync. Databases, queues, auth, and mail transport use proven defaults.
11. **Legible to agents (and new humans).** The codebase is built to be changed safely by AI coding agents: deep modules with small, documented interfaces; one obvious place for each kind of code; contracts generated and diff-checked rather than hand-synced; every rule that matters encoded as a lint, a type, or a test instead of tribal knowledge; one command (`bun run verify`) that tells an agent whether its change is acceptable.
12. **Buy the commodity, build the differentiator.** We build: the authorization model, the change feed, the UX, the agent surface. We adopt maintained libraries for: sessions, the client reactive store/offline queue, CRDT rooms, the editor core, queues, and mail parsing.

## 4.2 Non-negotiables (these are review blockers)

- ❌ No raw SQL string interpolation; parameterized queries or the ORM only.
- ❌ No `SELECT *` on tenant tables in request paths.
- ❌ No secret in a client bundle, log line, or error message (including LLM prompts).
- ❌ No new tenant-scoped table without `workspace_id`, a composite `(workspace_id, id)` key for FK targets, `created_at`, an RLS policy, and an entry in the RLS coverage test. `updated_at` + `version` are required on mutable aggregate roots; pure join/append-only tables (e.g. `issue_labels`, `audit_log`) are exempt and say so in a schema comment. Instance-level tables (auth, `embedding_models`, `processed_events`) live outside the tenant schema.
- ❌ No endpoint without an explicit authorization check _and_ a test for the deny path.
- ❌ No UI state change without a visible, accessible busy/error/empty state design.
- ❌ No feature merged without: type check, lint, unit test for the new logic, and an a11y check on new interactive UI.
- ❌ No dependency added without license, maintenance, and vulnerability review (see §21.6).

## 4.3 Performance budgets (enforced in CI and RUM)

| Surface                                             | Budget                     | Measurement               |
| :-------------------------------------------------- | :------------------------- | :------------------------ |
| Local interaction feedback (optimistic)             | ≤ **16 ms** to first paint | In-app instrumentation    |
| Server read p95 (single object)                     | ≤ **120 ms**               | OpenTelemetry spans       |
| Server read p95 (list page 50 rows)                 | ≤ **250 ms**               | OpenTelemetry spans       |
| Write API p95                                       | ≤ **300 ms**               | OpenTelemetry spans       |
| Sync propagation (peer-to-peer UI)                  | ≤ **1 s** p95              | Synthetic two-client test |
| Web INP (75th pct, field)                           | ≤ **200 ms**               | RUM web-vitals            |
| Web LCP (75th pct, field)                           | ≤ **2.5 s**                | RUM web-vitals            |
| Web CLS (75th pct, field)                           | ≤ **0.1**                  | RUM web-vitals            |
| Mobile cold start to interactive (cached workspace) | ≤ **1.5 s**                | Startup trace             |
| Search latency p95 (unified palette)                | ≤ **150 ms**               | Server span               |
| Background job lag p95                              | ≤ **30 s**                 | Queue metrics             |
