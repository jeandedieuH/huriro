# Appendix A — Defects in the Original Sketch

Each item below is a concrete problem in `unified_workspace_platform_development_plan.md`, with the replacement in this plan.

**A.1 — `BIGSERIAL` sequence used as a sync cursor (correctness bug).**
The plan broadcasts a "high-water sequence" and clients fetch `since=<seq>`. Sequences are allocated before commit and are not commit-ordered, so a client can advance past a row that commits later and lose it permanently. → **Replaced** with per-workspace serialized cursor allocation inside the same transaction (§9.2), plus a regression test.

**A.2 — RBAC as `role_mask BIGINT`.**
Bitmasks are unreadable in the database, unqueryable ("who can delete?"), capped at 64 permissions, can't express resource-level access, and can't be audited or customized per workspace. → **Replaced** with `roles` + `role_permissions` tables, a pure policy function, and relational `acl_entries` (§12.3).

**A.3 — No `users`, `sessions`, or identity schema.**
`workspace_members.user_id` references nothing, and there is no session model, MFA, passkey, or token lifecycle. → **Replaced** with a complete identity model (§8.3, §12.2) and a vetted auth library with a documented risk posture.

**A.4 — Invalid `mail_thread_links` primary key.**
`PRIMARY KEY (workspace_id, jmap_thread_id, linked_task_id)` is invalid because primary-key columns are implicitly `NOT NULL`, yet `linked_task_id`/`linked_doc_id` are optional. It also conflates "a thread exists" with "a link exists", and keys on a provider-mutable id. → **Replaced** with `conversations`, `messages`, and separate `conversation_tasks` / `conversation_docs` join tables keyed on real FKs (§14.3).

**A.5 — Dangling foreign-key references.**
`tasks.project_id` and `tasks.status_id` are `UUID NOT NULL` with **no** referenced tables (`projects`, `workflow_statuses` are mentioned in the roadmap but never defined). `workspace_members.user_id` has no FK. → **Replaced** with a complete, FK-closed schema (§8.3) and composite `(workspace_id, id)` FKs that make cross-tenant references impossible.

**A.6 — The Elysia example is not valid Drizzle usage.**
`db.transaction(async (tx) => tx\`UPDATE ...\`)`treats the Drizzle transaction handle as a tagged template SQL client; Drizzle's API is`sql\`\``inside a transaction with the injected`tx`and typed queries. The`user` context also appears from nowhere (no auth plugin shown). → **Replaced** with a specified service/repo/policy split and fully typed examples (§7.3, §16).

**A.7 — No row-level security, no idempotency, no outbox, no audit, no rate limits.**
These are the minimum bar for multi-tenant SaaS and are all missing. → **Added** as first-class subsystems (§8.5, §8.6, §12.4, §12.8, §12.9) and enforced by CI gates.

**A.8 — Five languages and a hand-rolled Rust sync server in v1.**
Bun + Rust sync engine + gRPC + Rust desktop + Rune scripting multiplies hiring, CI, and debugging cost before any user-visible benefit. The gRPC contract (`NotifySequenceAdvance`, `ApplyDocOperation`) reimplements what Hocuspocus + pub/sub already provide. → **Reduced** to TypeScript + a small realtime service; Rust is a later, measured decision (§5.1, §10.5).

**A.9 — Desktop app on `anomalyco/rune`, conflated with `rune-rs`.**
Verified: the framework is real but weeks old, pre-release, not accepting contributions, bus factor ~1, no rich-text editor, desktop-only accessibility behind a feature flag, and its own plan flags IME/a11y as top risks. `rune-rs` is a **scripting language**, not a GUI framework — the two were merged in the plan. → **Rejected**; PWA then a Tauri/Electron shell (§18.1). This alone would have consumed the entire desktop phase and still shipped a worse editor.

**A.10 — `VECTOR(1536)` hard-coded.**
Locks the product to one embedding model and forces a migration to change it. → **Replaced** with `embedding_models` + one dimension-less `halfvec` column per row with a per-model partial HNSW index and background re-indexing (§11.1).

**A.11 — Stalwart as the mail system of record.**
Stalwart's **multi-tenancy is an Enterprise-license feature**, 1.0 is only weeks old, and self-hosted outbound deliverability is a hard operational problem. → **Replaced** with a provider abstraction where Huriro owns the canonical store, inbound-parse + relay first, connected mailboxes second, embedded Stalwart as an optional self-host profile (§14.1–14.2).

**A.12 — Deployment sketch hazards.**
`image: latest` tags, mail ports published directly, secrets as plain env vars, volume backups of a live Postgres data directory (not crash-consistent), and no non-root/read-only containers. → **Replaced** with digest pins, secret indirection, `pgBackRest` WAL archiving + tested restores, network segregation, and container hardening (§19.2–19.5).

**A.13 — No design system, no accessibility, no testing strategy.**
A plan for a collaboration product with no UX specification will produce a CRUD admin panel. → **Added** §17 (tokens, keyboard model, states, motion, WCAG 2.2 AA specifics) and §21 (test pyramid, gates, budgets).

**A.14 — 16 weeks was not achievable.**
The original schedule allocated ~3 weeks to "monorepo foundation + dual auth + Dokploy CI/CD + TanStack shell" and ~3 weeks to Tasks including a bespoke Rust sync engine, GitHub two-way sync, three views, and a 1-second multi-client propagation target. → **Re-planned** as ~48 weeks of solo + agent work in six shippable milestones with explicit gates (§23) and a documented cut order (§24, R8).
