# M1 threat-model review (§23.3, §12.1)

Scope: M1 surfaces — Tasks/Issues CRUD & comments, private projects & ACLs,
sync change feed & snapshots, WebSocket signal plane & tickets, FTS/trigram
search, in-app notifications, Linear/GitHub importers, and local-first OPFS/IDB
client persistence.

## Boundaries & assets

| Boundary                       | Crosses                                                      | Assets                                               |
| ------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| Browser / client → `/api/v1/*` | Cookie + `Origin` + `X-Huriro-Client` or Bearer              | Issues, projects, comments, notifications, ACLs      |
| Client → `/ws?v=1`             | Cookie + `Origin` allowlist or single-use `realtime_tickets` | Workspace cursor signals (`{ t: "cursor", cursor }`) |
| `api` / `worker` → Postgres    | `huriro_app` inside `withWorkspace()` (FORCE RLS)            | All 15 new M1 tenant tables                          |
| Client → OPFS / IndexedDB      | Same-origin browser storage                                  | Local replica + pending offline outbox mutations     |
| `imports` → external APIs      | Transient `apiToken` (never persisted)                       | Imported issues, comments, identifier redirects      |

## STRIDE findings & mitigations

| Threat                                 | Surface                           | Mitigation in place                                                                                                                                                                                       |
| -------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing — WS hijack                   | `/ws` upgrade                     | `Origin` allowlist checked on upgrade; cookie auth or single-use SHA-256-hashed 60 s `realtime_tickets` bound to `workspace_id` + `user_id`                                                               |
| Spoofing — CSRF                        | Mutating `/api/v1/*` cookie calls | Same-origin `Origin` + `Sec-Fetch-Site` validation + mandatory `X-Huriro-Client` header                                                                                                                   |
| Tampering — cross-tenant FK / data     | All 15 M1 tables                  | Composite `(workspace_id, id)` FKs, `ENABLE+FORCE RLS`, `validate_issue_assignee()` trigger (`SECURITY DEFINER`, pinned `search_path`), RLS integration tests as `huriro_app`                             |
| Tampering — double-replay / race       | Offline mutations & API creates   | `Idempotency-Key` SHA-256 request-hash binding (`422` on mismatch, `409` in-flight); `version` optimistic locking (`409 stale_version`)                                                                   |
| Tampering — missing updates            | Concurrent sync writers           | Commit-ordered `workspace_seq` cursor allocation last in tx (`ADR-0004`)                                                                                                                                  |
| Info disclosure — private project leak | Sync feed & Search                | Socket carries cursor only; `/sync/changes` filters against CURRENT project visibility & ACLs and emits `delete`/`revoke` tombstones on scope moves; `/search` applies `can_read()` in SQL before ranking |
| Info disclosure — import tokens        | `import_jobs`                     | `apiToken` used transiently in memory during fetch and stripped before persisting `import_jobs.config`                                                                                                    |
| Info disclosure — shared device logout | Local OPFS/IDB replica            | `HuriroSyncEngine.signOutAndWipe()` clears local replica, cursor, and offline mutation outbox                                                                                                             |
| DoS — WebSocket / queue flood          | `/ws`, offline outbox             | 60 msgs/min per-socket token bucket; 250 ms/1 s cursor coalescing; 5,000 mutations / 25 MB client outbox cap                                                                                              |
| Elevation — guest / private ACLs       | Projects, Issues, Imports         | Pure `@huriro/domain.can()` enforced on every service operation; guests get zero workspace perms; admin ACL bypasses write `audit_log`; `import.run` gated to owner/admin                                 |

## Open risks accepted for M1

1. **Direct remote API SSRF surface in importers** — `imports` calls fixed vendor hosts (`api.linear.app` and `api.github.com`) rather than arbitrary URLs; general URL fetch / link unfurling (M4) will route through the SSRF-hardened egress proxy.
2. **Inline HTML / rich-text editor sanitization** — M1 stores plain text + structured JSON metadata; TipTap rich-text HTML sanitization corpus lands with collaborative docs in M2.
3. **In-memory rate limiting for Better Auth** — carried from M0 until Valkey/DB store before multi-node cloud deployment.

## Review outcome

All M1 surfaces enforce structural tenant isolation (FORCE RLS + composite FKs),
zero-payload signal broadcasts, SQL-level search permission filtering, and
idempotent/versioned writes. M1 security gate: **pass**.
