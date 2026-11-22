# ADR-0008: Collaborative docs — Yjs + Hocuspocus embedded in `realtime` with PG leases

- **Status:** Accepted
- **Date:** 2026-11-22
- **Plan refs:** §10 (Collaborative Documents), §23 (M2 Gate G2)

## Context

Huriro needs real-time collaborative rich-text editing with offline browser persistence (`IndexedDB`), zero-divergence multi-client CRDT merging, crash-safe persistence (`kill -9` of the realtime server retains edits still held by connected clients), non-destructive version history/restore, and anchored inline comments that survive concurrent edits.

## Decision

1. **CRDT & Editor Stack**: Use **TipTap v3** (`ProseMirror`) bound to **Yjs** (`y-prosemirror` `default` `XmlFragment` field) and **Hocuspocus v4.8** (`@hocuspocus/server` + `@hocuspocus/provider`).
2. **One Image, Embedded in `realtime` (ADR-0018)**: Run Hocuspocus inside `apps/server`'s `realtime` runtime mounted on `/collab` alongside the `/ws` signal plane in `Bun.serve` (Caddy proxies `/ws*` and `/collab*`). `HocuspocusProvider` authenticates exclusively via `MessageType.Auth` using single-use, 60-second HKDF-signed `collab_tickets` (never URL query strings).
3. **Single-Homed Room Leases with Epoch Fencing**: Each open room (`<workspaceId>:<pageId>`) acquires a lease in `doc_room_leases` with a monotonically bumped `epoch`. Every `doc_state` persistence query (`saveFencedDocState`) fences on `lease_epoch = ${epoch}` so a partitioned or slow node can never overwrite a newer node's state.
4. **PostgreSQL Storage, Retention Thinning, and Forward CRDT Restore**:
   - Store canonical Yjs snapshots + state vectors + extracted plain text/headings (`doc_state`).
   - Record debounced `auto` versions (at most 1 every 10 minutes per edited room) plus explicit `named` and `pre_restore` checkpoints in `doc_versions`. Hourly `doc-versions-thin` worker jobs retain all `auto` checkpoints <7 days, 1/hour for 7–30 days, and 1/day >30 days (`named` and `pre_restore` never thinned).
   - Restore replaces active room content via `openDirectConnection` forward Yjs transactions (when live) so connected clients converge cleanly without losing CRDT continuity.
5. **Shared Schema & In-House Relative Anchors (`packages/editor`)**: Both `apps/web` and `apps/server` import the identical ProseMirror schema, Markdown/Y.Doc converters, URL/HTML sanitizer, and `Y.RelativePosition` comment anchor codec from `packages/editor`.

## Alternatives considered

- **Separate Hocuspocus microservice container**: Adds another deployment unit, secret distribution, and healthcheck to self-hosting, violating ADR-0018 (one image, three roles). Rejected.
- **Commercial / hosted collab SaaS (TipTap Cloud / Liveblocks)**: Breaks self-hostability and workspace data residency. Rejected.
- **Last-write-wins JSON documents without CRDT**: Cannot survive offline edits or guarantee zero divergence across 10 concurrent editors. Rejected.

## Consequences / graduation trigger

- Re-evaluate sharding or sticky consistent-hash WebSocket routing across multiple `realtime` replicas if a single `realtime` instance approaches connection/CPU bounds on Huriro Cloud (multi-node horizontal scale).
- Revisit external archival object storage (S3/R2) for cold `doc_versions` snapshots if PostgreSQL storage growth for active versioned workspaces warrants offloading (>100 GB `doc_versions`).
