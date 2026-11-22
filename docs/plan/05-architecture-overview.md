# 5. Architecture Overview

## 5.1 The two planes

Huriro splits traffic into a **control plane** (stateless, HTTP) and a **signal plane** (stateful, WebSocket). Data always travels over HTTP; the socket only says "something changed, here is the cursor."

```text
                              ┌──────────────────────────────────────┐
   Web (TanStack Start) ─────▶│           Traefik / TLS              │
   PWA / Desktop shell        │  ACME · HSTS · rate limits · CSP     │
   Mobile (Expo)        ─────▶│                                      │
                              │  app.<domain>      → web            │
                              │    /api/*          → api            │
                              │    /ws             → realtime       │
                              │    /mcp            → api (agents)   │
                              │    /collab         → realtime (Yjs) │
                              │  <usercontent-domain> → files (opt.)│
                              └───────┬──────────────┬───────────────┘
                                      │              │
                         HTTPS        │              │  WSS  (signals only)
                                      ▼              ▼
                        ┌──────────────────┐   ┌─────────────────────────┐
                        │  apps/server     │   │  apps/server            │
                        │  (role=api)      │   │  (role=realtime)        │
                        │  Bun + Elysia    │   │  Bun + Hocuspocus 4     │
                        │                  │   │  (docs) + uWS fan-out    │
                        │  • Auth/Session  │   │                         │
                        │  • Domain logic  │   │  • WS fan-out by ws-id  │
                        │  • Outbox writer │   │  • Presence / typing    │
                        │  • Search/AI     │   │  • Yjs rooms (doc-      │
                        │  • MCP endpoint  │   │    sticky routing)      │
                        │  • Mail bridge   │   │  • Cursor broadcasts    │
                        └────┬──────┬──────┘   └───────────┬─────────────┘
                             │      │                      │
                        SQL  │      │  pub/sub             │  Yjs snapshot writes
                             ▼      ▼                      ▼
                    ┌────────────────────────────────────────────┐
                    │              PostgreSQL                    │
                    │  tenants · domain tables · change_log      │
                    │  outbox · jobs · search (FTS+pgvector)     │
                    │  RLS policies · audit_log                  │
                    └───────────────┬────────────────────────────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
              ▼                     ▼                      ▼
      ┌──────────────┐      ┌──────────────┐       ┌─────────────────┐
      │  Object      │      │  Worker      │       │  Mail bridge    │
      │  storage S3  │      │  (jobs)      │       │  inbound-parse  │
      │  (presigned) │      │  outbox →    │       │  Gmail · Graph  │
      └──────────────┘      │  search/AI/  │       │  IMAP · JMAP    │
                            │  mail/notify │       └─────────────────┘
                            └──────────────┘
```

**One image, three roles.** `api`, `worker`, and `realtime` are entrypoints of `apps/server`, shipped as **one container image** (`huriro serve --role=api|worker|realtime|all`). At scale they run as separate processes: the API is horizontally scalable and restartable at will, while realtime connections are long-lived, memory-resident, and need document-sticky routing — separating them lets us scale, deploy, and crash them independently. For small self-hosts, `--role=all` runs all three in one container (separate Bun workers, one supervisor) so the minimal stack is **Huriro + Postgres** (§19.2). The web client is a static build served by the same image (or a CDN) — there is no separate web server process.

**Everything on one origin.** `/api`, `/ws`, `/collab`, and `/mcp` share the app origin, so a self-hoster needs **one DNS name and one certificate**, cookies stay first-party, and CORS disappears. The only optional second name is a **separate registrable domain for user content** (§12.6); without it, files are served from the app origin with `Content-Disposition: attachment` + `CSP: sandbox`, and mail HTML renders in an opaque-origin sandboxed iframe, which is safe but disables inline previews of risky types.

**Why not a separate Rust service for CRDTs at v1?** The Yjs server role is well served by an existing MIT-licensed Yjs server (Hocuspocus 4) with mature auth hooks, awareness, and persistence hooks. Rust (e.g. `yrs`) earns its place only if profiling shows the Yjs server is the bottleneck — a Phase-3+ decision, not a v1 bet. Note that the leading Rust option (`y-sweet`) is at maintenance risk after its maintainer joined another company, which is another reason not to bet v1 on it.

## 5.2 Request lifecycle (read)

1. Client needs data → checks **local replica** (SQLite/IndexedDB) first.
2. On a miss or a stale entry, calls `GET /api/v1/...` with `Authorization` (cookie or bearer) and `X-Workspace-Id`.
3. API resolves session → workspace membership → **authorization policy** → opens a transaction and sets `app.workspace_id` / `app.user_id` with `set_config(name, value, true)` (transaction-local).
4. Query executes under the **RLS-enforced app role**.
5. Response is cached per ETag where safe; client writes to replica and updates the local cursor.

## 5.3 Request lifecycle (write)

1. Client applies the change to its **local replica** + observable store, renders immediately (≤ 1 frame).
2. Enqueues a mutation with a client-generated `mutation_id` and `Idempotency-Key` into a durable local queue.
3. API validates input schema → authorizes → opens a transaction:
   - writes the domain row(s),
   - appends `outbox` event(s),
   - appends `audit_log` (if security-relevant),
   - **allocates the cursor last** (`UPDATE workspace_seq … RETURNING`) and appends the `change_log` row(s).
4. On commit, the API notifies the realtime service (pub/sub) with `{workspace_id, cursor}`.
5. Realtime coalesces (default 250 ms window, capped at 1 s) and broadcasts cursors to subscribed sockets.
6. Clients pull `GET /api/v1/sync/changes?since=<cursor>`; the server filters by permission and returns only authorized changes.
7. Client applies changes in a single local transaction, resolves any pending local mutations by `mutation_id`, and clears the queue entry.

## 5.4 Bounded contexts (module map)

| Module          | Owns tables                                                   | Publishes events                       | Consumes                              |
| :-------------- | :------------------------------------------------------------ | :------------------------------------- | :------------------------------------ |
| `identity`      | users, sessions, oauth_accounts, api_keys                     | `user.created`, `session.revoked`      | —                                     |
| `tenancy`       | workspaces, memberships, invitations, roles                   | `member.joined`, `member.role_changed` | identity                              |
| `projects`      | projects, statuses, labels, cycles, milestones                | `project.*`                            | tenancy                               |
| `tasks`         | issues, relations, comments, attachments                      | `issue.*`                              | projects, tenancy                     |
| `docs`          | pages, doc_state, doc_versions, doc_comments                  | `doc.*`                                | tenancy                               |
| `chat`          | channels, messages, reactions, read_state                     | `message.*`                            | tenancy                               |
| `notifications` | notifications, delivery_log, preferences                      | `notification.*`                       | all                                   |
| `search`        | search_documents (materialized)                               | —                                      | all (via outbox)                      |
| `ai`            | embedding_index, ai_runs                                      | `ai.run.*`                             | docs, tasks, mail                     |
| `agents`        | agent_principals, tool registry (code), tool_calls, approvals | `agent.*`, `approval.*`                | all (through service interfaces only) |
| `imports`       | import_jobs, import_mappings (remote id → local id)           | `import.*`                             | projects, tasks, docs, chat           |
| `mail`          | mail_accounts, conversations, messages, drafts, links         | `mail.*`                               | tenancy                               |
| `files`         | files, file_versions                                          | `file.*`                               | tenancy                               |
| `audit`         | audit_log                                                     | —                                      | all security events                   |
| `sync`          | change_log, cursor registry                                   | —                                      | all                                   |

**Boundary rule:** a module may call another module's _service functions_ and _read its public DTOs_. It may not import another module's Drizzle table definitions. A CI lint ("module boundary check") fails the build on violations.

## 5.5 Eventing topology

```text
write txn ──▶ outbox (same txn, at-least-once)
                 │
                 ▼  (worker polls with SKIP LOCKED + LISTEN/NOTIFY nudge)
        ┌──────────────────────────────────────────────────┐
        │  fan-out consumers (idempotent by event_id)      │
        ├──────────────────────────────────────────────────┤
        │ search indexer     │ notification dispatcher     │
        │ embeddings         │ webhooks (GitHub, etc.)     │
        │ link previews      │ mail sync scheduler         │
        │ usage metering     │ audit enrichment            │
        └──────────────────────────────────────────────────┘
```

- **At-least-once by design**, exactly-once by idempotency keys (consumer table `processed_events(event_id)`), not by broker magic.
- **Ordering** is guaranteed _per aggregate_ by `(aggregate_type, aggregate_id, version)` and enforced with an optimistic `version` column on aggregate roots.
- **Dead letters** are visible in an admin view with payload + error + replay button. No silent drops.

## 5.6 Failure modes and intended behavior

| Failure                   | User-visible behavior                                                                                                                 | Internal behavior                                                                                                    |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------- |
| Realtime service down     | Everything keeps working; cross-user updates lag                                                                                      | Client falls back to 10 s polling of the change cursor; alert fires                                                  |
| Valkey absent or down     | Single-node: nothing visible (Valkey is optional there). Multi-node: presence/typing degrade, cross-node signals fall back to polling | Single-node uses an in-process bus behind the same `PubSub` interface; multi-node announces degraded mode and alerts |
| Search/AI down            | Command palette still searches via Postgres FTS                                                                                       | Semantic re-ranking skipped; queue drains later                                                                      |
| Mail provider down        | Inbox shows last sync + banner                                                                                                        | Exponential backoff with jitter; alert after N failures                                                              |
| Postgres primary failover | Brief 5xx with retry-after                                                                                                            | Client retries queued mutations idempotently                                                                         |
| Worker backlog            | UI unaffected                                                                                                                         | Queue lag metric → alert at 60 s                                                                                     |
