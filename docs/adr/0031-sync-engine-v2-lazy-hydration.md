# ADR-0031: Sync Engine v2 — Selective & Lazy Collection Hydration

- **Status:** Accepted
- **Date:** 2026-11-25
- **Plan refs:** §8.1, §10.1 (ADR-0031); extends ADR-0004; risk R24

## Context

V1 `HuriroSyncCollections` (`packages/sync-client`) eagerly hydrates every workspace collection — projects, statuses, labels, cycles, issues, saved views, notifications, doc page summaries — into `PersistedReplicaState` at boot. At V2 scale (≈50k issues, 100k database cells, 500k activity rows per §8.1) that eagerness breaks the `<= 1.5 s` cold-start budget and exhausts browser/mobile memory, and it gets worse with every V2 table added (structured doc databases, chat history, per-entity link graphs).

ADR-0004 fixed cursor correctness: a single commit-ordered `workspace_seq` counter gives a strictly monotonic, gap-free cursor per workspace, and hot paths (chat) stay off it via per-channel counters. That ordering guarantee must be preserved while hydration becomes selective. The open questions:

1. Which collections are boot-critical vs loadable on demand?
2. How do scoped collections get snapshots and deltas without forking the cursor model?
3. How is on-device memory bounded, and how do permission changes purge local data?
4. When does `change_log` + `workspace_seq` stop scaling — what triggers the documented CDC migration path?

## Decision

1. **Two tiers.** Tier 1 is an eager core replica synced at boot: projects, statuses, labels, active cycles, milestones, initiatives, saved views, doc page tree metadata, teamspaces, mail tags/templates, active/recent issues (non-archived and not closed > 30d), notifications, chat sidebar sections, workspace profiles, user groups. Tier 2 is scoped lazy collections hydrated on demand:
   - `db:<databaseId>` → `doc_database_properties` + `doc_database_rows` + `cell_values`
   - `issue_hist:<projectId>` → closed/archived issues older than 30d
   - `links:<type>:<id>` → `entity_links` + `issue_activity` for the open entity
   - `channel:<channelId>` → per-channel chat feed (rev cursor, V1 §15.1)
2. **One protocol, one cursor.** `GET /api/v1/sync/snapshot?scopes=core,db:<id>` returns scope-filtered snapshots; `GET /api/v1/sync/changes?since=<cursor>&scopes=...` returns core deltas plus deltas for the client's subscribed lazy scopes. All scoped traffic rides the **single monotonic workspace cursor** from ADR-0004 — there is no second ordering scheme, and the client `since`/`nextCursor` protocol is unchanged.
3. **Bounded local storage.** Tier-2 scopes live in an LRU cache — OPFS on web, SQLite on mobile — with default quotas of **50 MB web / 30 MB mobile**; least-recently-used scopes evict transparently and re-hydrate on next access.
4. **Grant/revoke purge.** Permission-grant events pull the affected scope; revocations purge the scope's local rows so data a user lost access to does not linger on-device.
5. **CDC migration stays a measured trigger, not a rewrite.** Keep `workspace_seq` + `change_log` while `change_log` write-lock wait stays `< 50 ms` p95 (the existing `huriro_change_log_write_ms` histogram). If high-frequency Database bulk imports push lock contention above that threshold, promote the logical-replication CDC watermark worker ADR-0004 already names as the additive path — the wire protocol stays identical, so clients don't change.

## Consequences

- Cold start is bounded by the core set, not workspace size — the `<= 1.5 s` budget and R24's 150 MB client-memory guardrail both hold at 50k-issue scale.
- Lazy scopes are exactly the collections whose size is unbounded (database cells, issue history, link graph, chat feed), so memory stays flat as workspaces grow.
- A single cursor keeps the ADR-0004 correctness proof valid; scopes change _which_ rows ship, never _how_ they're ordered.
- Revocation purge preserves the security invariant that losing access removes local copies — important now that far more data can be cached.
- The CDC trigger turns "migrate to logical replication" into an observable threshold decision with a pre-decided path, instead of an emergency rewrite under load.
