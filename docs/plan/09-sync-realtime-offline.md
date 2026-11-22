# 9. Sync, Real-Time & Offline

This is the section that most determines whether Huriro feels like Linear or like a CRUD admin panel. It is also where the original sketch had a correctness bug. We fix the bug and keep the ambition.

## 9.1 Design goals

| Goal                               | Mechanism                                                                              |
| :--------------------------------- | :------------------------------------------------------------------------------------- |
| Instant local reads/writes         | Client-local replica + optimistic mutations                                            |
| Correct catch-up after any gap     | Monotonic **per-workspace** change cursor with commit-safe allocation                  |
| Zero unauthorized data on the wire | Socket carries **cursors only**; data is always fetched through an authorization check |
| Bounded server memory              | No per-client payload queues; coalesced signals                                        |
| Bounded client work                | Delta pull with pagination + snapshot fallback                                         |
| Multi-device support               | Per-device cursor, conflict detection by `version`, replayable mutation queue          |

## 9.2 The correctness problem in the original design (and its fix)

**Original:** `workspace_events.seq BIGSERIAL`; broadcast the high-water `seq`; clients ask for `since=<seq>`.

**Why it breaks:** sequences are allocated _before_ commit and are not commit-ordered. T1 takes `seq=5` and stalls; T2 takes `seq=6` and commits first; the broadcaster announces 6; a client pulls `since=4`, receives row 6, stores cursor 6 — and **row 5 is lost forever**. A gap-skipping client is not a theoretical risk; it happens whenever write concurrency > 1, which on a shared workspace is most of the time.

**Fix — per-workspace monotonic counter, allocated by `UPDATE … RETURNING`:**

```sql
-- Domain writes happen FIRST (keep this transaction short)…

-- …then allocate the cursor. The row lock on workspace_seq serializes writers,
-- and because the lock is held until COMMIT, cursor order == commit order.
UPDATE workspace_seq
   SET last_cursor = last_cursor + 1
 WHERE workspace_id = $workspace_id
 RETURNING last_cursor;          -- this is the cursor for this change

INSERT INTO change_log (workspace_id, cursor, entity_type, entity_id, action, scope, payload, actor_id)
VALUES (...);
```

Properties:

- **Monotonic, gap-free, commit-ordered _for that workspace_.** A cursor is only visible once its transaction commits, and no later cursor can be allocated until the earlier transaction ends. If a client sees cursor _N_, every cursor < *N* for that workspace is either visible or never existed (rolled back).
- **No advisory lock needed.** The single-row `UPDATE` _is_ the serialization point — simpler than a separate lock, and it leaves exactly one mechanism to reason about.
- **Parallelism across workspaces is untouched.** A busy tenant never blocks another tenant.
- **Writes within one workspace are serialized, by design.** Human-generated collaboration traffic is low-rate; a single workspace's writes are tens to low thousands per minute. Keep the transaction short (the counter update is the _last_ statement), set `lock_timeout = 2s` and a `transaction_timeout`, and **do not route chat through this counter** (chat uses its own per-channel counter, §15.1) or bulk imports through it (use a separate "bulk" path that emits one coarse change event).
- **Gap-free cursors make retention pruning safe** — the floor is a plain `MIN(cursor)` over active clients.

> **Rejected alternative: `xid8` + snapshot watermark.** Stamping rows with `pg_current_xact_id()` and filtering by `pg_snapshot_xmin(pg_current_snapshot())` is correct, but any long-running transaction anywhere on the server pins the ceiling and stalls delivery for every tenant. That is a worse failure mode than short per-tenant serialization.

> **When this stops working.** If a tenant's sustained write concurrency approaches a few hundred per second, serialization becomes a queue. The documented migration path is **logical replication (CDC)** with a commit-ordered watermark, or sharding that tenant. Both are additive: the client contract (`since` / `nextCursor`) does not change. Recorded as **ADR-0004**.

**Rejected alternatives (recorded so we don't relitigate):**

| Alternative                          | Why not now                                                                                                                                                                                                                                                  |
| :----------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw `BIGSERIAL` cursor               | Silently lossy (above).                                                                                                                                                                                                                                      |
| `xid8` / snapshot watermark          | Correct, but long transactions stall global delivery; harder to prune.                                                                                                                                                                                       |
| Logical replication CDC from day one | Best long-term, but `wal_level=logical`, replication-slot WAL retention (`max_slot_wal_keep_size`), and publication ops are real burdens on a single-VPS self-host target. **Enable `wal_level=logical` and monitor slot lag anyway** so the future is open. |
| Client polling only (no socket)      | Simpler, but 10 s worst-case latency fails the "< 1 s" product promise. Kept as the degradation path.                                                                                                                                                        |

## 9.3 The delta endpoint

```http
GET /api/v1/sync/changes?since=1842&limit=500
```

```json
{
	"changes": [
		{
			"cursor": 1843,
			"entity": "issue",
			"id": "019a…",
			"action": "upsert",
			"scope": ["project:019b…"],
			"data": { "id": "019a…", "title": "…", "version": 7, "…": "…" }
		},
		{ "cursor": 1844, "entity": "doc_page", "id": "019c…", "action": "delete", "data": null }
	],
	"nextCursor": 1844,
	"hasMore": false,
	"serverTime": "2026-11-11T10:12:03.412Z"
}
```

Rules:

- **Permission-filtered server-side on every request** — by workspace role, resource ACL, and (for chat/mail) membership. `scope` is an index hint, not a security boundary.
- **Pagination** with `hasMore`; clients loop until drained, then persist `nextCursor`.
- **Cursor too old** → `410 Gone` with `{ "resync": "/v1/sync/snapshot?resource=…" }`. Clients silently perform a snapshot resync and show a subtle "syncing" affordance only if it takes > 1 s.
- **Cheap no-op responses** when `since` equals the current head: `{ changes: [], nextCursor: 1844, hasMore: false }` — safe to poll every 10 s in degraded mode.
- **Tombstones are mandatory.** Deletes appear as `action: "delete"` rows so clients remove local copies; never rely on absence.
- **Revocation is an event.** When a member loses workspace access, is removed from a private channel, or an ACL is revoked, the server writes `action: "revoke"` entries **and** closes that user's sockets. Clients then purge the affected scope. Without this, a delta-based client can keep showing content it can no longer read.
- **Grants are events too (added in v1.1).** The change log only contains _changes_, so a user who is newly added to a private project or channel would never receive the entities that already existed there. A grant writes `action: "grant"` with the scope; on receiving it the client fetches `GET /api/v1/sync/snapshot?scope=project:<id>` for that scope, then continues from its cursor. The same applies when a user's role is raised.
- **Scope moves are a revoke + grant.** When an entity changes scope (an issue moves from a public project to a private one, a doc page is made private), the server writes a `delete` for audiences that lost access and an `upsert` for those who gained it. The filter evaluates the **current** permission of the requester against the entity's **current** scope, never the scope stored at write time.
- **Collapse per entity.** A page of changes returns only the latest row per `(entity, id)` within the page, so a field edited 200 times syncs once. `payload` stores the minimal synced representation (no rich-text bodies, no comments — those hydrate lazily, §9.5).

## 9.4 Signal plane (WebSocket)

```text
wss://<app-origin>/ws?v=1
→ client sends: { "t": "hello", "workspaceId": "…", "cursors": { "workspace": 1842 }, "ticket": "<short-lived>" }
← server:      { "t": "ready", "serverCursor": 1844, "heartbeatMs": 20000 }
← server:      { "t": "cursor", "cursor": 1890 }                  (coalesced)
← server:      { "t": "presence", "channel": "…", "users": [...] }
← server:      { "t": "typing", "channel": "…", "userId": "…", "until": 169… }
← server:      { "t": "ping" } / client { "t": "pong" }
```

**Authentication of the socket:**

| Client         | Mechanism                                                                                                                                                                          |
| :------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web            | First-party session cookie on the same origin **plus** an `Origin` allowlist check on the handshake. Never put a token in the URL.                                                 |
| Mobile/desktop | Short-lived **single-use ticket** (30–60 s) obtained via `POST /api/v1/realtime/ticket`, bound to `sub`, `workspace_id`, and `device_id` — no cookies, no tokens in query strings. |

The socket stays unauthenticated-and-idle until the handshake validates. On logout, session expiry, membership removal, or ACL change, the server **closes** the affected sockets rather than trusting the client to stop listening. Authorization is re-evaluated per subscription and periodically (every 5 minutes) for long-lived connections.

**Coalescing:** the realtime layer batches notifications per workspace: flush at most every **250 ms**, and force a flush at least every **1 s**. A burst of 500 writes produces one cursor broadcast.

**Fan-out:** each node holds `Map<workspaceId, Set<socket>>`. Cross-node delivery uses Redis/Valkey pub/sub on `ws:<workspaceId>`. No shared state, no sticky sessions for ordinary sync (only for Yjs document rooms, §10.5).

## 9.5 Client replication model

```text
┌──────────────────────────── Client ─────────────────────────────┐
│  UI (React) ──useLiveQuery──▶ TanStack DB collections            │
│      │                         (issues, projects, statuses, …)   │
│      │                              ▲            │               │
│      └─ optimistic transaction ─────┘            │ persisted to  │
│               │                                  ▼               │
│               ▼                        SQLite (OPFS | expo-sqlite)│
│      offline-transactions outbox  ──▶ POST /api/v1/mutations         │
│      (durable, leader-elected)        (Idempotency-Key)          │
│                                                                  │
│  huriro sync adapter (packages/sync-client) ◀── delta pull (HTTP)│
│      writes server rows into collections   ◀── cursor signal (WS)│
└──────────────────────────────────────────────────────────────────┘
```

**Division of labour.** TanStack DB provides the reactive store, live/joined queries, optimistic transactions with rollback, SQLite persistence, the durable outbox, and leader election across tabs. **We own** the sync adapter (cursor bookkeeping, `grant`/`revoke` handling, snapshot resync), the server protocol, and conflict UX. If TanStack DB ever had to be replaced, only `packages/sync-client` changes — UI code depends on collection queries, not on the library's internals.

**What is replicated (partial replication — a 5,000-seat tenant cannot live on a phone):**

| Data                                                                                | Replicated locally                                                               | Otherwise                                   |
| :---------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------ |
| Workspace skeleton: members, roles, projects, statuses, labels, channels, page tree | Always                                                                           | —                                           |
| Issues                                                                              | Open issues in projects the user belongs to + anything touched/viewed in 30 days | Fetched on demand, cached with LRU eviction |
| Issue descriptions, comments, history                                               | On first open, then kept fresh                                                   | Lazy                                        |
| Doc content (Yjs state)                                                             | Pinned/recent pages (web) · pinned pages (mobile)                                | Opened online                               |
| Chat messages                                                                       | Last 200 per recently viewed channel                                             | Paginated backwards on scroll               |
| Mail bodies and attachments                                                         | Only previously opened conversations                                             | Lazy, never prefetched in bulk              |

The scope set is part of the cursor state: changing it (joining a project) triggers a scoped snapshot, exactly like a `grant`.

**Bootstrap order (this ordering is the "no spinners" trick):**

1. Render from local store immediately (even before session validation completes).
2. In parallel: validate session; if invalid → redirect to login and clear store.
3. Open socket, receive `serverCursor`, pull deltas from the local cursor.
4. Hydrate heavier collections lazily (comments, history, mail bodies) on first view, with skeleton placeholders that reserve layout space.

**Mutation envelope:**

```json
{
	"mutationId": "019a…-uuidv7",
	"workspaceId": "…",
	"entity": "issue",
	"entityId": "019a…",
	"op": "update",
	"patch": { "statusId": "…", "position": "a0V" },
	"baseVersion": 6
}
```

**Conflict handling is explicit, not magic:**

| Server outcome          | Client behavior                                                                                                                                  |
| :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `200` applied           | Confirm mutation, merge authoritative row, drop queue entry                                                                                      |
| `409 stale_version`     | Rebase where the field sets are disjoint (auto-merge), else surface an inline "this changed while you were away" resolver that shows both values |
| `403`                   | Roll back the optimistic row, toast with the reason, offer "request access"                                                                      |
| `422` validation        | Roll back, focus the offending field, keep user input                                                                                            |
| network error / timeout | Keep queued, retry with exponential backoff + jitter, show a discreet "pending sync" indicator                                                   |

**Idempotency:** every mutation carries `Idempotency-Key: <mutationId>`, so retries after a timeout cannot double-create.

**Multi-tab:** one tab is elected leader (Web Locks API, via TanStack DB's offline executor) and owns the socket, the delta pull, and the outbox; other tabs read the same OPFS database and receive change notifications over `BroadcastChannel`. Losing leadership mid-write rolls the optimistic change back rather than risking a double send.

## 9.6 Offline behavior (product contract)

| Scenario                      | Behavior                                                                  |
| :---------------------------- | :------------------------------------------------------------------------ |
| Offline read                  | Full workspace browsing from cache; mail bodies only if previously opened |
| Offline write                 | Queued with visible "pending" affordance; timestamped                     |
| Offline conflicting edit      | Auto-merge when disjoint; resolver dialog when overlapping                |
| Long offline (> retention)    | On reconnect, snapshot resync; queued mutations replay first, then deltas |
| Account revoked while offline | Queued mutations rejected; local store wiped on next auth check           |
| Shared device sign-out        | Local store and keys destroyed (see §22.4)                                |

The offline queue is capped (default 5,000 mutations / 25 MB) with a clear user-facing explanation when the cap is hit, rather than silent data loss.

## 9.7 Why not adopt a third-party sync engine at v1?

We evaluated the local-first ecosystem (see Appendix B for sources). Summary of the decision:

| Option                                    | Status at time of writing                                                                                                                                                                                                                                                                     | Verdict for v1                                                                                                                                                                                                                                                                            |
| :---------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ElectricSQL**                           | 1.x GA, Apache-2.0. **Read-path only**; single-table shapes; needs logical replication + a direct (non-pooled) DB connection; ~5k changes/s with optimized shapes. Announced a move to Neon/Databricks in Aug 2026 with Electric Cloud winding down; public repo activity has been low since. | Not now — strategic risk and single-table constraints. **Phase-3 spike candidate** if delta reads bottleneck.                                                                                                                                                                             |
| **PowerSync**                             | Service 1.28.x, **Apache-2.0 since v1.28.0 (Nov 2026)**, RN SDK GA, `op-sqlite` adapter **Beta**, TanStack DB integration **Alpha**; self-host needs bucket storage (Mongo or Postgres), no dashboard                                                                                         | **Designated fallback for offline-first mobile** if our replica layer underperforms. The same Elysia endpoints can back its `uploadData()` path.                                                                                                                                          |
| **Rocicorp Zero**                         | GA, Apache-2.0; `zero-cache` holds a SQLite replica; target < 100 GB; **no offline writes**                                                                                                                                                                                                   | Not now — the product promises offline writes on mobile.                                                                                                                                                                                                                                  |
| **TanStack DB**                           | **1.0 RC1 (2026-10-29)**; SQLite persistence (browser OPFS, React Native) + `@tanstack/offline-transactions` outbox; server-agnostic                                                                                                                                                          | **Adopted (v1.1) as the client layer** on top of our own feed: it is not a sync engine, so it doesn't constrain our server or authorization. Built against from M1; GA expected before Huriro's alpha. Fallback if it stalls: keep the adapter interface and swap in a thin custom store. |
| **LiveStore / Jazz / Triplit / Convex**   | Beta/alpha, non-Postgres, or AGPL/stale                                                                                                                                                                                                                                                       | Not now.                                                                                                                                                                                                                                                                                  |
| **Build our own server feed (this plan)** | Cursor + delta + version + grant/revoke, consumed by TanStack DB                                                                                                                                                                                                                              | **Chosen.** No extra server runtime to self-host, full control of per-row authorization, identical on web/mobile. We build only the server half; the client half is the library above.                                                                                                    |

The contract (`since` / `cursor` / `version`) deliberately mirrors the market-standard shape, so swapping the transport or storage underneath later is a contained change rather than a rewrite. The mobile fallback is named explicitly so the option is not lost to drift.
