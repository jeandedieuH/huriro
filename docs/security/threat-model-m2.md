# M2 threat-model review (§23.3, §12.1)

Scope: M2 surfaces — Collaborative rich-text Docs (`doc_pages`, `doc_state`, `doc_versions`, `doc_comments`, `doc_favorites`, `doc_room_leases`, `collab_tickets`), TipTap v3 + Yjs + Hocuspocus `/collab` runtime, anchored comments & mentions, Notion/Markdown importers, search indexing with `#block-<id>` deep links, and offline `y-indexeddb` + TanStack DB persistence.

## Boundaries & assets

| Boundary                                                              | Crosses                                                   | Assets                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Browser / client → `/api/v1/docs*`                                    | Cookie + `Origin` + `X-Huriro-Client` or Bearer           | Doc tree, page visibility, comments, version snapshots, HKDF collab tickets        |
| Client → `/collab` (WS)                                               | Hocuspocus `MessageType.Auth` ticket + `Origin` allowlist | Live Y.Doc CRDT updates (`default` field), presence/awareness                      |
| `realtime` → Postgres                                                 | `huriro_app` inside `withWorkspace()` (`FORCE RLS`)       | `doc_state` binary blobs, fenced `doc_room_leases`, `doc_versions`, `doc_comments` |
| `worker` (`doc-versions-thin`) → Postgres                             | `huriro_app` via `withWorkspace` per maintenance tx       | `doc_versions` retention thinning (`auto` checkpoints only)                        |
| Browser → IndexedDB (`y-indexeddb` + OPFS)                            | Same-origin browser storage                               | Offline document CRDT updates and metadata replica                                 |
| User upload / payload → `/api/v1/imports/*` & `/docs/import/markdown` | Schema validation + DOMPurify/schema whitelist            | Notion Markdown/zip exports and nested Markdown trees                              |

## STRIDE findings & mitigations

| Threat                                                            | Surface                                           | Mitigation in place                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing — WS ticket leak in logs/referrers                       | `/collab` upgrade & `onAuthenticate`              | Query-string `?ticket=` and `?token=` are explicitly rejected (`400` on upgrade and error in `onAuthenticate`); tickets arrive solely inside Hocuspocus `MessageType.Auth` frames                                 |
| Spoofing — ticket replay or tampering                             | `POST /docs/:id/collab-ticket` & `collab_tickets` | 60 s expiry, HKDF-SHA256 derived HMAC signature over `{ jti, ws, page, uid, perm, exp }`, single-use `UPDATE ... SET used_at = now() WHERE used_at IS NULL AND expires_at > now()`, SHA-256 hashed at rest        |
| Tampering — split-brain overwriting newer state                   | `doc_room_leases` & `saveFencedDocState`          | Single-homed room leases with DB-monotonic `epoch`; every persistence write checks `lease_epoch = ${epoch}` on `doc_room_leases` and closes fenced sockets                                                        |
| Tampering — XSS via pasted HTML, Markdown, or links               | `@huriro/editor` & `apps/web`                     | Shared ProseMirror schema (`createHeadlessProseMirrorSchema`), `sanitizeHtml` / `isSafeUrl` rejecting `javascript:`/`data:` URLs on links and embeds, CSP/security headers maintained                             |
| Tampering — cross-tenant FK / data                                | All 7 M2 tables                                   | Composite `(workspace_id, id)` FKs, `ENABLE + FORCE RLS`, `can_read(..., 'doc_page', ...)` SQL helper, RLS matrix + deny-path tests as `huriro_app`                                                               |
| Info disclosure — stale session after ACL revoke / private toggle | `/collab` live connections                        | Server-derived `connectionConfig.readOnly = authRes.readOnly`, `pubsub` `'revoke'` closes Unauthorized sockets (`4003`) immediately and downgrades write→read-only, plus 5-minute periodic re-authorization check |
| Info disclosure — private docs in search / sync                   | `GET /api/v1/search`, `GET /api/v1/sync/*`        | `/search` filters every hit via `can_read('doc_page', ...)` in SQL; `/sync/changes` filters private doc deltas against current ACLs and emits `delete`/`revoke` tombstones when access is removed                 |
| Info disclosure — shared device logout                            | Browser `y-indexeddb` & OPFS replica              | Logout clears local sync cursor/OPFS replica (`HuriroSyncEngine.signOutAndWipe()`)                                                                                                                                |
| DoS — memory / DB bloat from oversized docs                       | `beforeSync`, `onStoreDocument`, API import       | `DOCUMENT_SIZE_WARN_BYTES` (2 MB banner) and `DOCUMENT_SIZE_MAX_BYTES` (10 MB hard rejection before merging oversized payloads into room memory or persisting to Postgres)                                        |
| Elevation — read-only client mutating document                    | Hocuspocus `onAuthenticate`                       | `data.connectionConfig.readOnly` enforced inside Hocuspocus sync receiver from DB-checked permission (`doc.write` + ACL `'write'                                                                                  | 'manage'`), never client claims |

## Open risks accepted for M2

1. **Multi-node direct WS routing sticky-session requirement** — single-homed `doc_room_leases` prevents concurrent dual-writers across nodes cleanly at the DB layer; multi-replica WebSocket edge routing relies on consistent room affinity or lease handoff (to be exercised in cloud chaos drills in M6).
2. **Client-side zip bomb mitigation during Notion folder upload** — browser unzip (`fflate`) runs client-side with user-selected files and feeds bounded API payloads; server-side attachment quarantine lands in M4.
3. **In-memory rate limiting for Better Auth** — carried from M0/M1 until Valkey store before multi-node cloud deployment.

## Review outcome

All M2 collaborative document surfaces enforce HKDF single-use ticket authentication (no query tokens), epoch-fenced single-homed room leases, `FORCE RLS` + composite FKs, live `4003` revocation, 10 MB document bounds, shared server/client schema validation, and forward CRDT version restore without history truncation. M2 security gate: **pass**.
