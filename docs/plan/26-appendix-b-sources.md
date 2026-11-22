# Appendix B — Sources

Primary sources consulted while preparing this plan (verified 2026-11-11; re-verify version numbers before scaffolding).

**Platform & data**

- PostgreSQL release/support policy and 18/19 timing — postgresql.org/support/versioning, postgresql.org/about/news (PG 18 release; PG 19 RC)
- Row security policies and bypass semantics — postgresql.org/docs/current/ddl-rowsecurity.html
- `set_config`, advisory locks, `pg_advisory_xact_lock` — postgresql.org/docs/current/functions-admin.html
- pgvector releases, HNSW/halfvec/iterative scans — github.com/pgvector/pgvector/CHANGELOG.md
- pgBouncer feature matrix (transaction mode limits) — pgbouncer.org/features.html
- Logical replication / `wal_level` — postgresql.org/docs/current/logical-replication.html
- ParadeDB `pg_search` (BM25 extension) and managed-host availability caveats — paradedb.com/docs

**Auth, security, MCP**

- MCP specification versions and changelog (`2026-07-28` stateless revision; CIMD over DCR) — modelcontextprotocol.io/specification/versioning, /specification/latest/changelog
- MCP authorization (RFC 9728, RFC 8707, no token passthrough) — modelcontextprotocol.io/specification/latest/basic/authorization
- MCP security best practices (confused deputy, SSRF, state handles) — modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- OWASP ASVS 5.0.0 (V8 authorization, V10 OAuth/OIDC, V7 sessions) — owasp.org/www-project-application-security-verification-standard
- OWASP API Security Top 10 (2023) — owasp.org/API-Security
- OWASP MCP Security Cheat Sheet — cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html
- OWASP LLM Top 10 (2025) and Agentic Applications Top 10 (2026) — genai.owasp.org
- OWASP Multi-Tenant Security Cheat Sheet — cheatsheetseries.owasp.org
- OWASP CSRF and WebSocket Security Cheat Sheets — cheatsheetseries.owasp.org
- "The lethal trifecta" (private data + untrusted content + external communication) — simonwillison.net/2025/Jun/16/the-lethal-trifecta
- Better Auth releases, organization/OAuth-provider/MCP plugins, rate limiting and cookie behavior, security advisories — better-auth.com/docs, github.com/better-auth/better-auth
- `Idempotency-Key` header (IETF httpapi draft, RFC 9457 problem details) — ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07
- Cookie prefix/exposure behavior in Better Auth — github.com/better-auth/better-auth (cookies source)

**Sync, clients, frontend**

- TanStack Start 1.0 announcement and Bun deployment guide — tanstack.com/blog/tanstack-start-1-0, bun.com/docs/guides/ecosystem/tanstack-start
- Elysia 2.0 RC status (not GA) and Eden versioning — next.elysiajs.com/blog/elysia-20-rc
- Drizzle ORM releases (0.45.x stable; 1.0 RC) and RLS support — github.com/drizzle-team/drizzle-orm/releases, orm.drizzle.team/docs/rls
- shadcn/ui Base UI default (July 2026) — ui.shadcn.com/docs/changelog/2026-07-base-ui-default
- Base UI stable releases — @base-ui/react on npm
- React 19.3 (View Transitions), React Compiler 1.0 — react.dev/blog
- Tailwind v4 theme variables / OKLCH — tailwindcss.com/docs/theme
- Design Tokens Format Module 2025.10 (stable) — designtokens.org/TR/2025.10
- TipTap pricing/licensing (MIT core vs paid comments/AI) and Hocuspocus — tiptap.dev/pricing
- Yjs 13.x — github.com/yjs/yjs
- Expo SDK 58 changelog, background task limits, rich-text guidance, DOM components — docs.expo.dev, expo.dev/changelog/sdk-58
- Tauri 2.x / Tauri 3 alpha / Electron release schedule — v2.tauri.app, releases.electronjs.org/schedule
- `anomalyco/rune` repository, README, PLAN.md, WEB.md; rune-rs docs — github.com/anomalyco/rune, rune-rs.github.io
- Linear engineering write-ups (local-first sync, delta read path, UI redesign) — linear.app/now, linear.app/blog
- Ink & Switch, "Local-first software: you own your data, in spite of the cloud" — inkandswitch.com/local-first
- NN/g response-time limits (0.1 s / 1 s / 10 s) — nngroup.com/articles/response-times-3-important-limits
- web.dev Core Web Vitals thresholds (LCP 2.5 s, INP 200 ms, CLS 0.1) — web.dev/articles/vitals, /articles/inp
- WCAG 2.2 Recommendation (Dec 2024) incl. 2.4.11, 2.5.7, 2.5.8, 3.3.8 — w3.org/TR/WCAG22
- WAI-ARIA Authoring Practices (combobox, listbox, grid, dialog patterns) — w3.org/WAI/ARIA/apg/patterns

**Mail**

- Stalwart 1.0/1.1 releases, licensing, enterprise-only multi-tenancy, JMAP capabilities, Traefik/TLS guidance, backup notes, advisories — stalw.art/docs, github.com/stalwartlabs/stalwart
- RFC 8620/8621 (JMAP core/mail), RFC 8887 (JMAP WebSocket), RFC 9404 (blobs), RFC 9661 (Sieve), RFC 9749 (VAPID)
- Gmail API scopes/verification and push — developers.google.com/workspace/gmail/api
- Microsoft Graph change notifications and lifecycle — learn.microsoft.com/graph
- Provider SMTP port blocks — Azure/Hetzner/DigitalOcean docs
- Gmail/Yahoo sender requirements — support.google.com/a/answer/81126, senders.yahooinc.com
- `imapflow`, `mailparser`, `mailauth`, `DOMPurify`/`sanitize-html` advisories — npm/GitHub advisories
- Shared-inbox product models — Front, Missive, Help Scout, Chatwoot, FreeScout, Zammad API docs

**Infrastructure & ops**

- Dokploy releases, hardening guide, volume-backup limitations, enterprise features, advisories — docs.dokploy.com, github.com/Dokploy/dokploy
- MinIO community edition archival — github.com/minio/minio/issues/21715
- SeaweedFS / Garage / RustFS status — project repos
- pg-boss, graphile-worker, BullMQ, Trigger.dev docs — pgboss.io, trigger.dev/docs
- Valkey / Redis licensing — redis.io/legal/licenses, valkey.io
- pgBackRest 2.60.x — pgbackrest.org/news.html
- Squawk safe-migration rules — squawkhq.com/docs/safe_migrations
- Trivy supply-chain advisory and GitHub workflow dependency lockfiles — github.com/aquasecurity/trivy/security/advisories, docs.github.com/actions
- OpenTelemetry instrumentation caveats under Bun; `@elysia/opentelemetry` — opentelemetry.io, elysiajs docs
- OpenFGA (CNCF Incubating) / SpiceDB for future authorization — openfga.dev, authzed.com/spicedb

**v1.1 re-verification (2026-11-22, this revision)**

- Elysia 2.0 RC vs 1.4.x security-fixes-only status; Eden version resolution — next.elysiajs.com/blog/elysia-20-rc
- Hocuspocus 4.x server/provider APIs and Bun support — ti2.dev (Hocuspocus) docs
- TanStack DB: offline-transactions outbox, `expo-sqlite`/IndexedDB persistence adapters — tanstack.com/db
- Zero (Rocicorp) sync semantics — no offline writes today; on-demand queries; license/source-available posture — zero.rocicorp.dev
- PowerSync 1.28.x Apache-2.0 relicensing, RN SDK status, TanStack DB integration maturity — powersync.com
- Expo SDK 58 / React Native 0.88 pairing — expo.dev/changelog, reactnative.dev
- shadcn/ui registry on Base UI by default — ui.shadcn.com changelog
- PostgreSQL 18.7 security release notes — postgresql.org/about/news
- Drizzle 0.45.x stable vs 1.0-RC status — github.com/drizzle-team/drizzle-orm/releases
- Better Auth `@better-auth/mcp` + `@better-auth/cimd` plugins, MCP SDK v2, JWT/JWKS requirement — better-auth.com/docs/plugins/mcp
- MCP `2026-07-28` revision: stateless sessions, CIMD over DCR, legacy-profile rejection — modelcontextprotocol.io
- TanStack Start 1.x stable line — tanstack.com/blog
