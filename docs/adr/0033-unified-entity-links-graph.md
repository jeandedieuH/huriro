# ADR-0033: Unified Cross-Entity Graph (`entity_links`)

- **Status:** Accepted
- **Date:** 2026-11-25
- **Plan refs:** §7.1, §10.1 (ADR-0033)

## Context

V1 scatters cross-pillar relationships across bespoke link tables: `mail_conversation_tasks`, `mail_conversation_docs`, `issue_relations`, plus `EntityMentionExtension` links embedded in doc/chat content. Every new relationship kind needs a new table, every cross-pillar query needs bespoke joins, and features that are inherently graph-shaped — "what issues does this mail thread touch", "what references this doc page", universal hover peek cards — have no single place to ask.

§7.1 specifies one typed bidirectional graph: `entity_links(source_type, source_id, target_type, target_id, relation_kind)` over entity types `issue | doc_page | doc_database_row | chat_message | mail_conversation | contact_org | vcs_pr` and kinds `references | blocks | duplicates | originated_from | tracked_by | requested_by`, with `UNIQUE (workspace_id, source_type, source_id, target_type, target_id, relation_kind)` for idempotent linking and `(workspace_id, source_*)` / `(workspace_id, target_*)` indexes for traversal in both directions. The open questions:

1. How do we migrate off the V1 tables without an outage or lost links?
2. A polymorphic `target_id` can't carry a real foreign key — where does referential integrity live?
3. Does link visibility follow each endpoint's permission rules?
4. What happens to V1 API contracts that read the old tables?

## Decision

1. **One `entity_links` table replaces the cross-pillar link tables** (`mail_conversation_tasks`, `mail_conversation_docs`, entity mentions). `issue_relations` stays authoritative for intra-issue relations in M7 (the sync replica and Tasks UI depend on it); only cross-pillar edges involving an issue live in `entity_links`. New entity types or kinds are a `CHECK`-list update plus service mapping — not a new table.
2. **Expand → dual-write → backfill → contract**, per the migration invariant. Expand: create `entity_links` and start writing new links to both it and the legacy tables. Backfill: migrate `mail_conversation_tasks`, `mail_conversation_docs`, and doc/chat `EntityMention` links into `entity_links`. Contract: drop the legacy tables only after the compat window closes.
3. **No foreign keys on `source_id`/`target_id`.** Because endpoints are polymorphic, existence is checked in the service layer at write time, and cleanup is transactional: deleting an entity deletes its links **in the same transaction** as the domain row + outbox + audit write, so orphans can't outlive the entity that caused them. A periodic consistency sweep reconciles anything missed.
4. **V1 contract compatibility is preserved during transition** — the V1 response shapes (`mail_conversation_tasks`-style views and endpoints) keep working, served from `entity_links` via compatibility views/handlers until the contract phase removes them.
5. **Traversal is always visibility-filtered.** Graph queries apply each endpoint's own access rules — project read permission, doc/teamspace ACL, mail inbox membership — so a link never leaks the existence of an entity the actor can't see. "You have 3 links, none of them visible" is a correct answer, not a join leak.
6. **Universal hover peek cards are the first consumer**: any entity badge (`ENG-142`, doc link, mail thread, chat permalink) resolves live metadata through the graph for an interactive popover (`Mod+Shift+Space`).

## Consequences

- One RLS-covered tenant table (`workspace_id`, composite `(workspace_id, id)`, ENABLE+FORCE per §4.2) replaces N link tables — the RLS coverage test and deny-path tests apply once, uniformly.
- Cross-pillar queries become symmetrical index lookups instead of per-pillar bespoke SQL, which is what makes hover peek cards and automation `links:<type>:<id>` sync scopes (ADR-0031) cheap.
- Referential integrity moves from the database to the service layer — accepted because all writes already funnel through module services in single transactions; the consistency sweep bounds the residual risk.
- The dual-write + backfill window means V1 clients and V2 graph consumers see the same links throughout migration; nothing depends on a flag-day cutover.
