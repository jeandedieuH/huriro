# Appendix C — Revision log (v1.0 → v1.1)

v1.1 is a full architecture-and-plan revision of the original v1.0 master plan, made _before any code was written_. It converts the plan from a 5-person, 24-week team plan into a ~48-week solo-plus-agent plan, and fixes a set of correctness, licensing, and operability defects found during review. The most consequential changes:

**Team, scope & roadmap**

- Roadmap re-planned for **one developer + AI agents**: six milestone-gated phases (~48 weeks of planned work, plus ~30% unplanned-work buffer), with a documented cut order (§23, §24 R8) instead of a fixed date. Team-based staffing and ownership language removed throughout.
- Product declared **fully open source**; self-host and cloud deployment are equal first-class targets (§1, §19, ADR-0015 license, ADR-0018 packaging).
- v1 scope cut: desktop is PWA-only (native Tauri shell deferred to ADR-0009), mobile is read/compose-light until M6, GitHub two-way sync and public webhooks moved to the cut list.

**Architecture & stack**

- Server consolidated to **`apps/server`: one image, three roles** (`api` / `realtime` / `worker`) — same process topology, ~60% less scaffolding for a solo developer (§5.1, §7).
- Dependency policy made explicit: adopt-GA lines where a rewrite is imminent (**Elysia 2 RC + Eden 2**, exact-pinned, with an M1 exit gate — ADR-0005), stable lines where they exist (**Drizzle 0.45.x** while 1.0 is RC, Hocuspocus 4 instead of a Rust/Yrs service, TipTap 3, Expo SDK 58 / RN 0.88, PostgreSQL 18.x, Bun 1.4.x).
- MinIO removed (community edition archived upstream); storage is an adapter with filesystem default for self-host and Garage/S3-compatible for full/cloud (§19.2).
- Stalwart demoted from canonical mail system to an optional embedded module; Huriro owns conversation/message storage behind provider adapters (§14, ADR-0006).

**Data & sync correctness**

- `workspace_events` replaced by transactionally-allocated per-workspace `change_log` cursors; socket carries signals only, deltas re-check authorization; grants/revokes emit events (§9).
- Chat moved onto its own per-channel revision counter + `chat_messages`/`chat_conversations`/`chat_channels`/`chat_read_state` schema, decoupled from the workspace cursor (§15.1).
- Mail schema rebuilt: `mail_conversations`, `mail_messages`, `mail_inboxes`, `mail_drafts`, `mail_thread_links` as real link tables with non-nullable keys; provider IDs never primary keys (§14.3).
- Doc persistence normalized to `doc_state` + snapshots on debounce/cap/empty-room/SIGTERM; Hocuspocus auth via short-lived single-use tickets (§10).
- Client sync layer specified on **TanStack DB** (collections + offline-transactions outbox on web and `expo-sqlite` on mobile) over the unchanged server contract; Zero rejected (no offline writes), PowerSync 1.28.x named the designated fallback (§9.5–9.7, ADR-0002).
- Embeddings decoupled from schema: `embedding_models` table + dimension-less `halfvec` column with per-model partial HNSW index (§11.1).

**Security, agents & operations**

- RLS hardened: transaction-local `set_config`, `FORCE ROW LEVEL SECURITY`, non-owning API role, composite-FK tenant integrity, and mandatory two-tenant isolation tests (§8, §12, §21).
- MCP target updated to the `2026-07-28` stateless revision with CIMD; Better Auth MCP plugin path documented; agent writes gated behind human-confirmation previews with audience-bound scoped tokens (§13).
- Untrusted-content handling unified for mail/docs/chat: sanitization, sandboxed HTML-mail iframe on a separate origin where configured, attachment quarantine with safe degraded behavior when ClamAV is off (§12.6, §14).
- Self-hosting made a product: Compose profiles (minimal/full/external) on one image, digest-pinned, secrets via `_FILE`, no public Postgres/Valkey/panels, pgBackRest + monthly restore drills, and a supported non-Dokploy path (§19, §20).
- UX contract fixed at five primary destinations with `Mod+K`/`Mod+J`, DTCG tokens → web + native, WCAG 2.2 AA, pseudo-locale CI, and onboarding/importers planned (§17–18).
- License allowlist gate added to CI now that distribution is confirmed open source (§21.2, §22).

_End of plan. This document is the single source of truth for v1 scope, architecture, and delivery. Changes require a PR with an ADR reference; version pins and the risk register are re-validated at the start of every phase._
