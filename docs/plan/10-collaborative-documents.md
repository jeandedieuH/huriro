# 10. Collaborative Documents

## 10.1 Editor stack

- **TipTap v3** (ProseMirror) as the editing surface, with a schema we own in `packages/editor`.
- **Yjs** for CRDT state, `y-prosemirror` binding for conflict-free merging, awareness protocol for cursors/presence.
- Extensions we build in-house: task/issue mention (atomic node with entity id), person mention, code block with syntect-class highlighting, callout, toggle, table, embed (file, image, video, Figma/Loom unfurl), inline comment anchor, and **reference blocks** that render live entity state.
- Markdown import/export with round-trip tests (paste, GitHub README import, export for portability).
- Slash menu (`/`), drag handle, floating toolbar, and a full keyboard map (see §17.6).

**Licensing gate (ADR-0007):** the editing core must remain OSS-usable. Paid collaboration/history add-ons are acceptable only as _optional_ hosted features; the self-hosted product must not depend on them. If the chosen editor's license cannot satisfy that, we fall back to a raw ProseMirror/Yjs integration (higher effort, fully OSS).

## 10.2 Authority and persistence model

```text
Editor (Yjs doc)
   │ updates (binary)
   ▼
Yjs server room (in memory, per document)
   │  • validates auth + ack
   │  • broadcasts to peers
   │  • compacts every N updates or T seconds of inactivity
   ▼
doc_state (bytea, 1 row/page)  ← overwritten by the lease holder, fenced by lease_epoch
   │  • extraction worker: Y.Doc → plain text → search_documents + embeddings
   ▼
doc_versions (auto checkpoints + named versions, user-restorable)
```

- **In-memory is authoritative while someone is connected.** Postgres stores the last compacted state, not every keystroke.
- **Server-side and agent edits go through the room**, never around it: the API and MCP tools (`docs.append`, AI "insert summary") use Hocuspocus `openDirectConnection()` on the owning node, so their changes merge as ordinary CRDT updates with live editors and carry an `origin` that attributes them (user, agent, system) in history.
- **Snapshot cadence (Hocuspocus-configurable):** debounce 2 s after the last edit, hard cap at 10 s of continuous editing, plus an immediate flush when the last client leaves the room. Compaction is O(document size) and cheap.
- **Yjs `gc` stays enabled.** It keeps document state small; the trade-off is that old deleted content isn't recoverable from the CRDT itself — that's what `doc_versions` checkpoints are for.
- **Graceful shutdown:** on `SIGTERM`, stop accepting new connections, flush **all dirty rooms**, then exit. This is a tested path (kill -15 in CI), not a hope.
- **Crash safety:** at most the last ~10 s of edits are at risk, and only if the process is `SIGKILL`ed. Acceptable and explicitly documented.
- **Size expectations:** a real-world editing trace of ~260k operations encodes to roughly 160 KB and parses in ~20 ms; a worst-case million-insert document is ~1 MB and parses in a few hundred ms. Budget for documents that are "documents", not databases.
- **Document size guard:** warn at 2 MB state, hard-refuse sync above 10 MB per document; offer "split this page" with a one-click subtree extraction.

## 10.3 Authentication and per-document authorization

```text
Client → POST /api/v1/docs/:pageId/collab-ticket
       ← { ticket: "<signed, 60s, aud=collab, single-use>", documentName }
Client → wss://<app-origin>/collab   (no credentials in the URL)
Client → Hocuspocus auth message carrying the ticket (provider `token` option)
Server → verify signature + exp + aud + jti unused; re-check page read/write permission from DB (never from claims alone)
       → on write permission revoked mid-session: close room for that user + notify
```

The ticket encodes `sub` (user or agent principal), `ws`, `doc`, `perm` (`read` | `write`), and a `jti` that is burned on first use. It travels in the protocol's auth message, never the query string (URLs end up in proxy logs). Web clients may instead rely on the same-origin session cookie plus the `Origin` allowlist. The room validates against the DB on connect and then on a 5-minute interval — a removed collaborator can't keep typing indefinitely on a cached ticket. Read-only connections are enforced server-side (`connection.readOnly = true`), not by the editor UI.

## 10.4 Comments, mentions, and history

- **Anchored comments** use relative positions (Yjs `RelativePosition`) so they survive concurrent edits; orphaned anchors are surfaced, not silently dropped.
- **Mentions** are first-class entities (`person:<uuid>`, `issue:<uuid>`, `doc:<uuid>`) that render live and generate notifications through the outbox.
- **History** is a list of compacted snapshots with author attribution, diff preview, and restore-as-new-version (never destructive).
- **Offline doc editing**: web and mobile support it via the same local Yjs doc persisted in the local store; merges on reconnect are automatic.

## 10.5 Running the collab server in more than one instance

| Concern                | Approach                                                                                                                                                                                                                                                                                                                              |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Same doc on two nodes  | **Document-level affinity**: consistent hashing on `page_id` at the edge (or a `room→node` lease table in Postgres). Never allow two authoritative rooms for one document — two owners each persisting snapshots risks lost or duplicated writes.                                                                                     |
| Awareness across nodes | Redis/Valkey pub/sub per document — **ephemeral, never persisted** (awareness has a built-in ~30 s offline timeout)                                                                                                                                                                                                                   |
| Updates across nodes   | Not needed when documents are single-homed (recommended). The Redis extension broadcasts updates to _every_ instance, so it reduces routing complexity but **does not reduce CPU** — treat it as a fallback, not a scaling strategy.                                                                                                  |
| Scaling approach       | Per the project's own guidance: **independent instances partitioned by document id**, not one cluster sharing all documents                                                                                                                                                                                                           |
| Scaling limit          | Load-test it (Phase 3 gate: 50 concurrent editors on one document, 10 documents). Treat any per-node number as a hypothesis until measured.                                                                                                                                                                                           |
| Failure                | Room lease (`doc_room_leases(page_id, node_id, epoch, expires_at)`) expires after 15 s; the next owner takes it with `epoch + 1`, loads `doc_state`, and its writes fence out the old owner. Clients reconnect and re-send any updates the server lacks (Yjs state-vector diff), so in-flight edits are not lost even across failover |

## 10.6 Document search integration

On each snapshot: strip markup to plain text (with block offsets preserved), write `search_documents` (title, body, headings), enqueue embeddings for chunks. Searching returns a snippet with an anchor that deep-links to the block and, when opened, scrolls the editor to it.
