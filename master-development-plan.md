# Huriro — Master Development Plan

**A secure, scalable, modular workspace platform with best-in-class craft across web, mobile, and desktop.**

|                    |                                                                                                            |
| :----------------- | :--------------------------------------------------------------------------------------------------------- |
| **Status**         | Draft v1.1 — implementation-ready blueprint (revised after architecture review; see Appendix C)            |
| **Supersedes**     | `unified_workspace_platform_development_plan.md` (treated as an early sketch; retained for reference only) |
| **Date**           | 11 November 2026 (v1.0) · 22 November 2026 (v1.1)                                                          |
| **Owner**          | Solo founder-engineer working with AI coding agents (team may grow; the plan scales up, see §23)           |
| **License**        | AGPL-3.0 (server + apps) · MIT (client SDKs, CLI, MCP tool schemas) — see §2.5                             |
| **Review cadence** | Re-validate version pins and risk register at the start of every phase                                     |
| **Scope**          | Product definition → architecture → design system → security → ops → delivery roadmap → acceptance gates   |

> **How to read this document.** Sections 1–4 are the _why_. Sections 5–16 are the _how_ (architecture and contracts). Section 17 is the **UI/UX system** that makes the product feel excellent rather than merely functional. Sections 18–24 cover clients, operations, quality, roadmap, and risk. If you only read three things, read §4 (principles), §17 (experience), and §23 (roadmap + gates). Appendix C lists what changed in v1.1 and why.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Definition & Scope](#2-product-definition--scope)
3. [What We Keep, Change, and Reject From the Original Sketch](#3-what-we-keep-change-and-reject-from-the-original-sketch)
4. [Engineering Principles & Non-Negotiables](#4-engineering-principles--non-negotiables)
5. [Architecture Overview](#5-architecture-overview)
6. [Technology Stack & Version Policy](#6-technology-stack--version-policy)
7. [Monorepo & Code Organization](#7-monorepo--code-organization)
8. [Data Architecture](#8-data-architecture)
9. [Sync, Real-Time & Offline](#9-sync-real-time--offline)
10. [Collaborative Documents](#10-collaborative-documents)
11. [Search, Retrieval & AI](#11-search-retrieval--ai)
12. [Security & Multi-Tenancy](#12-security--multi-tenancy)
13. [AI Agents & MCP](#13-ai-agents--mcp)
14. [Mail (Shared Inbox)](#14-mail-shared-inbox)
15. [Chat, Notifications & Presence](#15-chat-notifications--presence)
16. [API Design & Contracts](#16-api-design--contracts)
17. [UI/UX System](#17-uiux-system)
18. [Client Platform Strategy](#18-client-platform-strategy)
19. [Infrastructure, Environments & Delivery](#19-infrastructure-environments--delivery)
20. [Observability & Reliability](#20-observability--reliability)
21. [Testing Strategy & Quality Gates](#21-testing-strategy--quality-gates)
22. [Privacy, Compliance & Data Governance](#22-privacy-compliance--data-governance)
23. [Roadmap, Milestones & Exit Criteria](#23-roadmap-milestones--exit-criteria)
24. [Risk Register & Open Decisions](#24-risk-register--open-decisions)
25. [Appendix A — Defects in the Original Sketch](#appendix-a--defects-in-the-original-sketch)
26. [Appendix B — Sources](#appendix-b--sources)
27. [Appendix C — Revision log (v1.0 → v1.1)](#appendix-c--revision-log-v10--v11)

---

## 1. Executive Summary

### 1.1 What we are building

**Huriro** is a self-hostable, cloud-ready workspace that consolidates the four tools most teams pay for separately — **issues/projects**, **documents/wiki**, **chat**, and a **shared team inbox** — plus a **first-class AI/MCP surface** so agents can operate inside the same workspace with the same permissions as people.

The market gap is not "another Notion clone". It is the combination of:

1. **One permission model** spanning tasks, docs, chat, mail, and agents.
2. **Local-first speed** — the app responds in single-digit milliseconds for reads and writes because the client owns a replica.
3. **A real inbox** — customer email attached to the same work items software teams already use (the Front/Missive insight applied to engineering tooling).
4. **Agent-native** — a scoped, auditable, human-in-the-loop MCP server rather than a bolt-on chatbot.
5. **Deploy-anywhere** — a single-node self-host path that a two-person company can run, and a horizontal cloud path that a 5,000-seat tenant can trust.

### 1.2 Strategic decisions (the short version)

| Decision           | Choice                                                                                                                                                                                                 | Why                                                                                                                                                                                          |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery shape     | **Modular monolith shipped as one image with three roles** (`api`, `worker`, `realtime`), runnable as separate processes _or_ as one `all-in-one` process for small self-hosts                         | A microservice mesh at v1 would cost months and buy nothing at <10k tenants. Module boundaries + an outbox give us the future split lines for free; one image keeps self-host and CI simple. |
| Source of truth    | **PostgreSQL**, single logical database, tenant-scoped + RLS                                                                                                                                           | One engine covers relational, `ltree`, JSONB, full-text, vectors, queues, and pub/sub. Fewer moving parts = fewer failure modes on a 4-vCPU box.                                             |
| Client data model  | **Local replica first**: our server change feed (§9) feeding **TanStack DB** collections persisted to SQLite (OPFS on web, native SQLite on mobile) with its durable offline outbox                    | This is what makes Linear feel instant. We own the server protocol and authorization; we do _not_ hand-roll the client reactive store, persistence, or offline queue.                        |
| Realtime transport | **WebSocket for signals only**; HTTP for data                                                                                                                                                          | Broadcasts carry an opaque change cursor, never payloads. Permission filtering happens on read, every time.                                                                                  |
| Sync correctness   | **Monotonic change log with commit-safe ordering** (not raw `BIGSERIAL` cursors)                                                                                                                       | Raw sequence cursors silently drop rows under concurrent commits. See §9.2.                                                                                                                  |
| Collaborative docs | **Yjs CRDT** (via a proven Yjs server, not a hand-rolled Rust gateway at v1) with snapshot compaction                                                                                                  | CRDT correctness is a solved problem — do not re-solve it in v1.                                                                                                                             |
| Mail               | **Connected inbox first** (IMAP/Graph/Gmail + inbound routing), **embedded Stalwart as an optional self-host module**                                                                                  | Outbound deliverability is the hardest part of email and is not a product differentiator.                                                                                                    |
| Desktop            | **PWA first → Tauri 2.x thin shell** reusing the web client                                                                                                                                            | See §18. A bespoke GPU-rendered UI was in the original sketch and is not justified (Appendix A.9).                                                                                           |
| Auth               | **Better Auth for identity only** (users, sessions, passkeys, 2FA, OAuth/MCP provider, API keys). **Huriro owns tenancy** (workspaces, memberships, roles, ACLs) — the organization plugin is not used | Battle-tested session plumbing, while the tables RLS, the change feed, and custom roles depend on stay in our schema with one source of truth.                                               |
| Authorization      | **RBAC roles + relational resource ACLs** (private channels, docs, projects) behind a single policy layer, enforced by **RLS as defense-in-depth**                                                     | Zanzibar-scale graph authorization is the right _later_ answer; relational ACLs are the right _v1_ answer.                                                                                   |
| AI                 | Provider-agnostic gateway, **retrieval scoped per workspace and per user**, **read/write tool scopes**, **writes require confirmation**                                                                | Email and docs are attacker-controlled text. Treat retrieved content as untrusted input forever.                                                                                             |
| UI system          | **shadcn/ui (Base UI) on the shadcn token contract**, extended with OKLCH semantic tokens; keyboard-first, optimistic, WCAG 2.2 AA, INP ≤ 200 ms budget                                                | Craft is a feature. The design system is versioned code, not a Figma artifact; staying on the shadcn contract keeps registry components drop-in.                                             |
| Agents             | **One tool registry** powers the MCP server, the in-app assistant, the CLI, and the public API; agents are first-class _principals_ (assignable, attributable, revocable)                              | "Works well with agents" is an architecture property, not an endpoint. Anything a human can do in the UI is reachable by a scoped agent through the same policy layer.                       |
| Distribution       | **Fully open source (AGPL-3.0)**, one feature set for self-host and cloud; no license-key gating                                                                                                       | Self-host is a first-class citizen; the cloud sells operations, not features.                                                                                                                |

### 1.3 What "done" looks like at v1

- A team can sign up, create a workspace, invite members with roles, and use **Tasks + Docs + Chat + Inbox** end-to-end.
- Two people can co-edit a document with live cursors; a container restart loses zero keystrokes.
- A task moved in one browser appears in another profile in **< 1 s**, without raw payloads crossing the socket.
- The mobile app opens **offline** and shows the last-known workspace instantly, then reconciles.
- Claude Desktop or Cursor can authenticate via OAuth 2.1 and **read** linked customer email + tasks, and **propose** a task creation that a human approves.
- A single VPS deployment survives a restore drill from S3 backups with a documented RTO.
- Every write path is idempotent, auditable, and permission-checked at the data layer, not just the controller.
- A self-hoster goes from a fresh 2 vCPU / 4 GB VPS to a working workspace in **≤ 10 minutes** with `curl` of one compose file + `docker compose up`, a first-run setup wizard, and no manual migration step; upgrading is `docker compose pull && docker compose up -d`.
- An agent can be **assigned an issue**, work on it through MCP or the CLI, and every action it takes is attributed to it in the activity timeline.

### 1.4 Timeline at a glance

The build is sequenced for **one engineer working with AI coding agents**: six milestones over roughly **48 working weeks**, each ending in a **shippable, self-hostable release** (alpha → beta → GA) rather than a big-bang launch. Tasks, Docs and the agent surface come first (they are the core loop and let Huriro be dogfooded to build itself); Chat, the Inbox and mobile follow. A hard **security-spine gate** closes the first milestone. See §23. The original 16-week plan was optimistic even for a team because it treated auth, authorization, sync correctness, testing, and design as free.

---

## 2. Product Definition & Scope

### 2.1 Personas

| Persona                  | Primary job                            | What must feel great                                                    |
| :----------------------- | :------------------------------------- | :---------------------------------------------------------------------- |
| **Engineer** (core ICP)  | Track work, read specs, discuss, ship  | Keyboard velocity, fast board/list, deep links from Git, instant search |
| **Product manager**      | Plan, write specs, triage              | Docs editor, timeline/roadmap, inbox→issue conversion                   |
| **Designer**             | Review, comment, attach artifacts      | Rich comments/annotations, image/video previews, notification control   |
| **Support/success**      | Answer customers, file bugs            | Shared inbox, assignment, collision detection, one-click → task         |
| **Ops/admin**            | Control access, audit, comply          | Role management, audit log, SCIM, data export/deletion                  |
| **AI agent (non-human)** | Retrieve context, draft, create/update | Scoped tokens, clear tool contracts, human approval for writes          |

### 2.2 In scope for v1

- Workspaces, members, roles, invitations, API keys, sessions, SSO-ready identity model.
- Projects, issues (sub-issues, relations, labels, cycles/milestones), custom statuses, Board (fractional index), List, Timeline.
- Docs: hierarchical pages, collaborative editing, comments, mentions, versions, permissions.
- Chat: channels (public/private), DMs, threads, attachments, link previews, reactions, unread state.
- Inbox: connected mailboxes (IMAP/Graph/Gmail), conversation threading, assignment, internal notes, task/doc linking, drafts.
- Search: unified command palette + full-text + semantic.
- Notifications: in-app, email digests, web push, mobile push.
- MCP server with read scopes; write scopes behind confirmation. Agents as assignable principals; `huriro` CLI generated from the OpenAPI spec.
- Importers for the tools teams leave: **Linear, GitHub Issues, Jira (CSV/API), Notion/Markdown, Slack export** — adoption is blocked by migration cost, not by features.
- Web app (PWA), mobile app (Expo), self-host compose path, cloud-ready deployment.
- Internationalization infrastructure from day one (English first; French and Kinyarwanda as the first translations), including RTL-safe layout.

> **Release tiers for a solo build.** "v1" is delivered in tiers so value ships early: **Alpha** = Tasks + Docs + MCP/CLI (self-host); **Beta** = + Chat + importers; **GA** = + Inbox + mobile + hardening. Anything not reached by GA moves to v1.x rather than delaying the release (cut order in §24, R8).

### 2.3 Explicitly out of scope for v1 (named so nobody silently scopes them in)

- Real-time **audio/video** calls, screen sharing.
- **Calendar** and scheduling (JMAP Calendars is deferred; the data model leaves room).
- **CRM/pipeline** objects beyond projects.
- **Automation builder** UI (the events/outbox foundation exists; the visual builder waits).
- **Public status pages**, forms/surveys, portals.
- **Fine-grained "Zanzibar"** relationship authorization at scale (design leaves a seam, see §12.5).
- **Native Rust GPU UI** (rejected; see Appendix A.9).
- **End-to-end encryption** of workspace content (design note in §22.6 on why and when).

### 2.4 Product principles (behavioral contracts)

1. **Never make the user wait on the network for their own action.** Writes apply locally in ≤ 1 frame and reconcile.
2. **Every object is addressable.** Issue `ENG-142`, doc slug, message permalink, mail conversation ID all have stable URLs and deep links.
3. **One search box.** One shortcut (`Mod+K`) finds tasks, docs, people, channels, and emails.
4. **Nothing happens invisibly.** Every write is attributable, auditable, and reversible where feasible.
5. **Agents are teammates with badges.** Same permissions model, visible attribution, human approval for external side effects.
6. **Density over decoration.** Information-dense views by default; whitespace earned per surface.
7. **Respect the operator.** Self-host is a first-class citizen: documented, backup-able, upgrade-able, no phone-home.
8. **API parity.** If a human can do it in the UI, a scoped token can do it through the API, the CLI, and MCP — through the same policy checks. No UI-only features.

### 2.5 Distribution, licensing, and editions

| Topic                                             | Decision                                                                                                                                                                                                                                                                                              |
| :------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server + web + mobile apps                        | **AGPL-3.0-only**. Anyone can self-host and modify; anyone who offers a modified Huriro as a network service must publish their changes.                                                                                                                                                              |
| Client SDKs, CLI, MCP tool schemas, design tokens | **MIT**, so integrators and agent builders can embed them without copyleft concerns.                                                                                                                                                                                                                  |
| Contributions                                     | **DCO** sign-off (no CLA) — consistent with "fully open source"; nobody can relicense contributors' work.                                                                                                                                                                                             |
| Editions                                          | **One edition.** SSO/SCIM, audit export, and AI features are _not_ paywalled; the hosted cloud charges for operations, support, and capacity. Code paths that only make sense in the cloud (billing, abuse controls, fleet telemetry) are behind a `HURIRO_MODE=cloud` flag, not a separate codebase. |
| Telemetry                                         | Off by default on self-host; an opt-in, documented, anonymous "instance ping" (version + counts) only. Never content.                                                                                                                                                                                 |
| Trademark                                         | The _Huriro_ name/logo is protected by a trademark policy (permits unmodified redistribution, forbids implying endorsement) — the standard way OSS projects prevent confusing forks without restricting the code.                                                                                     |
| Dependency gate                                   | AGPL lets us consume MIT/Apache/BSD/MPL-2.0/LGPL libraries and AGPL network services; GPL-incompatible licenses (SSPL, BSL, Commons Clause) are banned. Enforced by the license allowlist in CI (§21.6).                                                                                              |

> The license is recorded as **ADR-0015**. Apache-2.0 remains the alternative if enterprise contributor adoption later matters more than protection against closed hosted forks; switching from AGPL to Apache is possible only with DCO-era contributors' consent, so decide before accepting outside contributions.

---

## 3. What We Keep, Change, and Reject From the Original Sketch

The original document (`unified_workspace_platform_development_plan.md`) was a good first pass at module decomposition. This plan keeps its best instincts and replaces its riskiest assumptions.

| #   | Original position                                                                                              | Decision                                                                                                                              | Rationale                                                                                                                                                                         |
| :-- | :------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Five modules (Tasks, Docs, Chat, Mail, AI/MCP)                                                                 | **Keep**                                                                                                                              | Correct product decomposition.                                                                                                                                                    |
| 2   | Bun + Elysia + Drizzle + PostgreSQL 17                                                                         | **Keep, upgrade to current PostgreSQL**, add RLS + migrations discipline                                                              | Sound stack; PG17 → current major for `uuidv7()` and I/O improvements.                                                                                                            |
| 3   | Tower of Tech: Bun/Elysia **and** Rust sync engine **and** Rust desktop UI **and** Rune scripting **and** gRPC | **Reduce**: TS monolith + optional Rust realtime service later                                                                        | Five languages in v1 multiplies hiring, CI, and debugging cost for zero user-visible benefit.                                                                                     |
| 4   | `workspace_events` with `BIGSERIAL` cursor + "high-water sequence" broadcast                                   | **Redesign**                                                                                                                          | Sequence values are not commit-ordered; cursors can skip rows. Also `BIGSERIAL` is slow and merge-hostile → `BIGINT` identity/uuidv7.                                             |
| 5   | `role_mask BIGINT` bitmask RBAC, no users table, no sessions                                                   | **Replace**                                                                                                                           | Bitmasks are unreadable, unqueryable, and can't express resource ACLs. Roles become named, versioned, and assignable.                                                             |
| 6   | `mail_thread_links` PK containing nullable columns                                                             | **Replace**                                                                                                                           | Invalid in PostgreSQL (PK columns are implicitly `NOT NULL`). Replaced with proper `mail_conversations` + polymorphic link table.                                                 |
| 7   | Rust `yrs` sync server with 5s debounced flushes                                                               | **Change**: managed Yjs server (Hocuspocus-class) first, evaluate Rust later                                                          | Correctness, auth hooks, and scaling (Redis) are already solved; we should not hand-roll CRDT rooms.                                                                              |
| 8   | Desktop app in **Rune GPU UI** (`anomalyco/rune`)                                                              | **Reject for v1**                                                                                                                     | Unverifiable framework maturity; accessibility/IME/rich-text risk is enormous for a docs product. See Appendix A.9.                                                               |
| 9   | `VECTOR(1536)` hard-coded embeddings                                                                           | **Change**: dimension chosen by model config, stored per workspace index version                                                      | Model choice must be swappable without a migration.                                                                                                                               |
| 10  | Docker Compose with `latest` tags, mail ports exposed directly, secrets in env                                 | **Harden**                                                                                                                            | Pinned digests, secrets management, non-root/distroless, explicit exposure policy.                                                                                                |
| 11  | No RLS, no audit log, no idempotency, no outbox, no rate limits                                                | **Add**                                                                                                                               | These are table stakes for multi-tenant SaaS.                                                                                                                                     |
| 12  | 16-week roadmap with 6 phases                                                                                  | **Re-plan as ~48 weeks of solo + agent work in 6 shippable milestones** with explicit gates                                           | Scope realism for the actual team; includes design system, tests, security review, DR drills.                                                                                     |
| 13  | Mobile offline via `op-sqlite`                                                                                 | **Keep the instinct, change the mechanism**: TanStack DB collections persisted to `expo-sqlite`, with its offline-transactions outbox | Right instinct; local-first is the differentiator — but the client store/queue is a solved, maintained library now.                                                               |
| 14  | Eden Treaty typed client                                                                                       | **Keep**, plus generated OpenAPI for external/agent clients                                                                           | Eden only covers TS clients; agents and self-hosters need a spec.                                                                                                                 |
| 15  | TanStack Start SSR/SPA web client                                                                              | **Keep TanStack Start, default routes to client-only (`ssr: false`)**; SSR only for public/share pages                                | The app renders from the local replica before auth resolves (§9.5); server rendering an authenticated, local-first workspace adds a server hop and hydration cost for no benefit. |
| 16  | MCP as a bolt-on module                                                                                        | **Promote to an architectural layer** (shared tool registry, agent principals, CLI) and move it _earlier_ in the roadmap              | Agent-native is a launch differentiator and lets the founder dogfood agents on Huriro itself.                                                                                     |

---

## 4. Engineering Principles & Non-Negotiables

### 4.1 Architecture principles

1. **Modular monolith with enforced boundaries.** Each domain module owns its tables and exposes a service interface; cross-module access goes through that interface, never through another module's tables. Lint rules enforce this.
2. **One source of truth per fact.** Derived data (search vectors, embeddings, unread counts, link previews) is rebuilt from events, never hand-updated in two places.
3. **Every mutation is an event.** All writes emit a domain event in the same transaction (transactional outbox). Notifications, search indexing, webhooks, AI indexing, and audit all consume events.
4. **Tenant isolation is structural.** Every tenant-scoped table carries `workspace_id`; every query runs under a workspace-scoped database role with RLS enabled. A missing `WHERE` clause must be _impossible_, not merely unlikely.
5. **Idempotency by default.** Every non-idempotent endpoint accepts `Idempotency-Key`; every event consumer is idempotent by `event_id`.
6. **Optimistic UI, authoritative server.** The client may guess; the server decides. Rejections roll back visibly and explain themselves.
7. **Degrade, don't fail.** Realtime down → polling. Search down → Postgres FTS. AI down → the product still works. Mail provider down → reconciled later.
8. **Observable by construction.** Every request, job, and websocket session emits structured logs + traces with `workspace_id`, `user_id` (hashed), `request_id`.
9. **Reversible change.** Migrations are expand/contract; feature flags gate rollout; backups are tested, not assumed.
10. **Boring where it counts.** Innovation budget goes to UX and sync. Databases, queues, auth, and mail transport use proven defaults.
11. **Legible to agents (and new humans).** The codebase is built to be changed safely by AI coding agents: deep modules with small, documented interfaces; one obvious place for each kind of code; contracts generated and diff-checked rather than hand-synced; every rule that matters encoded as a lint, a type, or a test instead of tribal knowledge; one command (`bun run verify`) that tells an agent whether its change is acceptable.
12. **Buy the commodity, build the differentiator.** We build: the authorization model, the change feed, the UX, the agent surface. We adopt maintained libraries for: sessions, the client reactive store/offline queue, CRDT rooms, the editor core, queues, and mail parsing.

### 4.2 Non-negotiables (these are review blockers)

- ❌ No raw SQL string interpolation; parameterized queries or the ORM only.
- ❌ No `SELECT *` on tenant tables in request paths.
- ❌ No secret in a client bundle, log line, or error message (including LLM prompts).
- ❌ No new tenant-scoped table without `workspace_id`, a composite `(workspace_id, id)` key for FK targets, `created_at`, an RLS policy, and an entry in the RLS coverage test. `updated_at` + `version` are required on mutable aggregate roots; pure join/append-only tables (e.g. `issue_labels`, `audit_log`) are exempt and say so in a schema comment. Instance-level tables (auth, `embedding_models`, `processed_events`) live outside the tenant schema.
- ❌ No endpoint without an explicit authorization check _and_ a test for the deny path.
- ❌ No UI state change without a visible, accessible busy/error/empty state design.
- ❌ No feature merged without: type check, lint, unit test for the new logic, and an a11y check on new interactive UI.
- ❌ No dependency added without license, maintenance, and vulnerability review (see §21.6).

### 4.3 Performance budgets (enforced in CI and RUM)

| Surface                                             | Budget                     | Measurement               |
| :-------------------------------------------------- | :------------------------- | :------------------------ |
| Local interaction feedback (optimistic)             | ≤ **16 ms** to first paint | In-app instrumentation    |
| Server read p95 (single object)                     | ≤ **120 ms**               | OpenTelemetry spans       |
| Server read p95 (list page 50 rows)                 | ≤ **250 ms**               | OpenTelemetry spans       |
| Write API p95                                       | ≤ **300 ms**               | OpenTelemetry spans       |
| Sync propagation (peer-to-peer UI)                  | ≤ **1 s** p95              | Synthetic two-client test |
| Web INP (75th pct, field)                           | ≤ **200 ms**               | RUM web-vitals            |
| Web LCP (75th pct, field)                           | ≤ **2.5 s**                | RUM web-vitals            |
| Web CLS (75th pct, field)                           | ≤ **0.1**                  | RUM web-vitals            |
| Mobile cold start to interactive (cached workspace) | ≤ **1.5 s**                | Startup trace             |
| Search latency p95 (unified palette)                | ≤ **150 ms**               | Server span               |
| Background job lag p95                              | ≤ **30 s**                 | Queue metrics             |

---

## 5. Architecture Overview

### 5.1 The two planes

Huriro splits traffic into a **control plane** (stateless, HTTP) and a **signal plane** (stateful, WebSocket). Data always travels over HTTP; the socket only says "something changed, here is the cursor."

```text
                              ┌──────────────────────────────────────┐
   Web (TanStack Start) ─────▶│           Traefik / TLS              │
   PWA / Desktop shell        │  ACME · HSTS · rate limits · CSP     │
   Mobile (Expo)        ─────▶│                                      │
                              │  app.<domain>      → web            │
                              │    /api/*          → api            │
                              │    /ws             → realtime       │
                              │    /mcp            → api (agents)   │
                              │    /collab         → realtime (Yjs) │
                              │  <usercontent-domain> → files (opt.)│
                              └───────┬──────────────┬───────────────┘
                                      │              │
                         HTTPS        │              │  WSS  (signals only)
                                      ▼              ▼
                        ┌──────────────────┐   ┌─────────────────────────┐
                        │  apps/server     │   │  apps/server            │
                        │  (role=api)      │   │  (role=realtime)        │
                        │  Bun + Elysia    │   │  Bun + Hocuspocus 4     │
                        │                  │   │  (docs) + uWS fan-out    │
                        │  • Auth/Session  │   │                         │
                        │  • Domain logic  │   │  • WS fan-out by ws-id  │
                        │  • Outbox writer │   │  • Presence / typing    │
                        │  • Search/AI     │   │  • Yjs rooms (doc-      │
                        │  • MCP endpoint  │   │    sticky routing)      │
                        │  • Mail bridge   │   │  • Cursor broadcasts    │
                        └────┬──────┬──────┘   └───────────┬─────────────┘
                             │      │                      │
                        SQL  │      │  pub/sub             │  Yjs snapshot writes
                             ▼      ▼                      ▼
                    ┌────────────────────────────────────────────┐
                    │              PostgreSQL                    │
                    │  tenants · domain tables · change_log      │
                    │  outbox · jobs · search (FTS+pgvector)     │
                    │  RLS policies · audit_log                  │
                    └───────────────┬────────────────────────────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
              ▼                     ▼                      ▼
      ┌──────────────┐      ┌──────────────┐       ┌─────────────────┐
      │  Object      │      │  Worker      │       │  Mail bridge    │
      │  storage S3  │      │  (jobs)      │       │  inbound-parse  │
      │  (presigned) │      │  outbox →    │       │  Gmail · Graph  │
      └──────────────┘      │  search/AI/  │       │  IMAP · JMAP    │
                            │  mail/notify │       └─────────────────┘
                            └──────────────┘
```

**One image, three roles.** `api`, `worker`, and `realtime` are entrypoints of `apps/server`, shipped as **one container image** (`huriro serve --role=api|worker|realtime|all`). At scale they run as separate processes: the API is horizontally scalable and restartable at will, while realtime connections are long-lived, memory-resident, and need document-sticky routing — separating them lets us scale, deploy, and crash them independently. For small self-hosts, `--role=all` runs all three in one container (separate Bun workers, one supervisor) so the minimal stack is **Huriro + Postgres** (§19.2). The web client is a static build served by the same image (or a CDN) — there is no separate web server process.

**Everything on one origin.** `/api`, `/ws`, `/collab`, and `/mcp` share the app origin, so a self-hoster needs **one DNS name and one certificate**, cookies stay first-party, and CORS disappears. The only optional second name is a **separate registrable domain for user content** (§12.6); without it, files are served from the app origin with `Content-Disposition: attachment` + `CSP: sandbox`, and mail HTML renders in an opaque-origin sandboxed iframe, which is safe but disables inline previews of risky types.

**Why not a separate Rust service for CRDTs at v1?** The Yjs server role is well served by an existing MIT-licensed Yjs server (Hocuspocus 4) with mature auth hooks, awareness, and persistence hooks. Rust (e.g. `yrs`) earns its place only if profiling shows the Yjs server is the bottleneck — a Phase-3+ decision, not a v1 bet. Note that the leading Rust option (`y-sweet`) is at maintenance risk after its maintainer joined another company, which is another reason not to bet v1 on it.

### 5.2 Request lifecycle (read)

1. Client needs data → checks **local replica** (SQLite/IndexedDB) first.
2. On a miss or a stale entry, calls `GET /api/v1/...` with `Authorization` (cookie or bearer) and `X-Workspace-Id`.
3. API resolves session → workspace membership → **authorization policy** → opens a transaction and sets `app.workspace_id` / `app.user_id` with `set_config(name, value, true)` (transaction-local).
4. Query executes under the **RLS-enforced app role**.
5. Response is cached per ETag where safe; client writes to replica and updates the local cursor.

### 5.3 Request lifecycle (write)

1. Client applies the change to its **local replica** + observable store, renders immediately (≤ 1 frame).
2. Enqueues a mutation with a client-generated `mutation_id` and `Idempotency-Key` into a durable local queue.
3. API validates input schema → authorizes → opens a transaction:
   - writes the domain row(s),
   - appends `outbox` event(s),
   - appends `audit_log` (if security-relevant),
   - **allocates the cursor last** (`UPDATE workspace_seq … RETURNING`) and appends the `change_log` row(s).
4. On commit, the API notifies the realtime service (pub/sub) with `{workspace_id, cursor}`.
5. Realtime coalesces (default 250 ms window, capped at 1 s) and broadcasts cursors to subscribed sockets.
6. Clients pull `GET /api/v1/sync/changes?since=<cursor>`; the server filters by permission and returns only authorized changes.
7. Client applies changes in a single local transaction, resolves any pending local mutations by `mutation_id`, and clears the queue entry.

### 5.4 Bounded contexts (module map)

| Module          | Owns tables                                                   | Publishes events                       | Consumes                              |
| :-------------- | :------------------------------------------------------------ | :------------------------------------- | :------------------------------------ |
| `identity`      | users, sessions, oauth_accounts, api_keys                     | `user.created`, `session.revoked`      | —                                     |
| `tenancy`       | workspaces, memberships, invitations, roles                   | `member.joined`, `member.role_changed` | identity                              |
| `projects`      | projects, statuses, labels, cycles, milestones                | `project.*`                            | tenancy                               |
| `tasks`         | issues, relations, comments, attachments                      | `issue.*`                              | projects, tenancy                     |
| `docs`          | pages, doc_state, doc_versions, doc_comments                  | `doc.*`                                | tenancy                               |
| `chat`          | channels, messages, reactions, read_state                     | `message.*`                            | tenancy                               |
| `notifications` | notifications, delivery_log, preferences                      | `notification.*`                       | all                                   |
| `search`        | search_documents (materialized)                               | —                                      | all (via outbox)                      |
| `ai`            | embedding_index, ai_runs                                      | `ai.run.*`                             | docs, tasks, mail                     |
| `agents`        | agent_principals, tool registry (code), tool_calls, approvals | `agent.*`, `approval.*`                | all (through service interfaces only) |
| `imports`       | import_jobs, import_mappings (remote id → local id)           | `import.*`                             | projects, tasks, docs, chat           |
| `mail`          | mail_accounts, conversations, messages, drafts, links         | `mail.*`                               | tenancy                               |
| `files`         | files, file_versions                                          | `file.*`                               | tenancy                               |
| `audit`         | audit_log                                                     | —                                      | all security events                   |
| `sync`          | change_log, cursor registry                                   | —                                      | all                                   |

**Boundary rule:** a module may call another module's _service functions_ and _read its public DTOs_. It may not import another module's Drizzle table definitions. A CI lint ("module boundary check") fails the build on violations.

### 5.5 Eventing topology

```text
write txn ──▶ outbox (same txn, at-least-once)
                 │
                 ▼  (worker polls with SKIP LOCKED + LISTEN/NOTIFY nudge)
        ┌──────────────────────────────────────────────────┐
        │  fan-out consumers (idempotent by event_id)      │
        ├──────────────────────────────────────────────────┤
        │ search indexer     │ notification dispatcher     │
        │ embeddings         │ webhooks (GitHub, etc.)     │
        │ link previews      │ mail sync scheduler         │
        │ usage metering     │ audit enrichment            │
        └──────────────────────────────────────────────────┘
```

- **At-least-once by design**, exactly-once by idempotency keys (consumer table `processed_events(event_id)`), not by broker magic.
- **Ordering** is guaranteed _per aggregate_ by `(aggregate_type, aggregate_id, version)` and enforced with an optimistic `version` column on aggregate roots.
- **Dead letters** are visible in an admin view with payload + error + replay button. No silent drops.

### 5.6 Failure modes and intended behavior

| Failure                   | User-visible behavior                                                                                                                 | Internal behavior                                                                                                    |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------- |
| Realtime service down     | Everything keeps working; cross-user updates lag                                                                                      | Client falls back to 10 s polling of the change cursor; alert fires                                                  |
| Valkey absent or down     | Single-node: nothing visible (Valkey is optional there). Multi-node: presence/typing degrade, cross-node signals fall back to polling | Single-node uses an in-process bus behind the same `PubSub` interface; multi-node announces degraded mode and alerts |
| Search/AI down            | Command palette still searches via Postgres FTS                                                                                       | Semantic re-ranking skipped; queue drains later                                                                      |
| Mail provider down        | Inbox shows last sync + banner                                                                                                        | Exponential backoff with jitter; alert after N failures                                                              |
| Postgres primary failover | Brief 5xx with retry-after                                                                                                            | Client retries queued mutations idempotently                                                                         |
| Worker backlog            | UI unaffected                                                                                                                         | Queue lag metric → alert at 60 s                                                                                     |

---

## 6. Technology Stack & Version Policy

> **Version policy.** Pin exact versions in lockfiles; pin container images by **digest**. Upgrade on a 2-week cadence via Renovate, with majors reviewed as ADRs. No `latest` tags in production. The table below records the _intended_ baseline; verify against the primary source before scaffolding (see Appendix B).

### 6.1 Runtime & language

| Layer      | Choice                                                                                                                                                    | Notes                                                                                                                                                                        |
| :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JS runtime | **Bun 1.4.x** (pin exact)                                                                                                                                 | Fast startup, built-in test runner/bundler/SQL. No runtime permission model — rely on container isolation. Soak-test for long-running processes (memory-leak reports exist). |
| Language   | **TypeScript** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`                                                                         | Single language for API, web, mobile, workers, tests.                                                                                                                        |
| Rust       | Deferred                                                                                                                                                  | Only if a measured bottleneck demands it (realtime hot path, image pipeline).                                                                                                |
| SQL        | PostgreSQL **18.x**, minimum **18.7** (2026-11-12: 52 CVE fixes plus GIN-corruption fixes — `REINDEX` affected indexes); 19 is at RC 2 — adopt after 19.2 | `uuidv7()`, `ltree`, `pgvector`, `pg_trgm`, RLS, logical replication.                                                                                                        |

### 6.2 Backend

| Concern        | Choice                                                                                                                                                                                                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP framework | **Elysia 2** (pin the exact RC, currently `2.0.0-rc.x`; move to GA the week it ships) with TypeBox 1.x schemas                                                                                                                        | **Changed in v1.1.** 1.4.x has been **security-fixes-only since Aug 2026**, and v2 is a ground-up rewrite (new `@elysia/*` plugin namespace, TypeBox 1.x, new lifecycle). Starting greenfield on 1.4 would schedule a full API migration mid-build; Huriro GA is ~a year away, so RC risk is smaller than migration cost. Exit gate: if v2 is not GA by the end of M1, re-evaluate (ADR-0005). Eden must resolve the _same_ `elysia` version on client and server. |
| Typed client   | **Eden 2** (`@elysia/eden`) for first-party TS clients + generated OpenAPI 3.1 (`@elysia/openapi`) for the CLI, external SDKs, and agents                                                                                             | One server boundary: Elysia for all clients; TanStack Start server functions are not used for app data.                                                                                                                                                                                                                                                                                                                                                            |
| ORM / query    | **Drizzle ORM 0.45.x** (stable) + `drizzle-kit`, **core query builder only**                                                                                                                                                          | 1.0 is still RC and still shipping breaking changes (rc.6, 2026-11-20). Avoid Relational Queries v1 (removed in 1.0) so the upgrade is mechanical. **Write RLS policies, triggers, and counters as raw SQL migrations** so ORM gaps can't block isolation. Re-evaluate 1.0 at the M1 gate.                                                                                                                                                                         |
| Validation     | TypeBox on the server; Standard-Schema-compatible parsers at other boundaries                                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Auth           | **Better Auth** (pin exact) with passkey, 2FA, API key, JWT, **`@better-auth/mcp` + `@better-auth/cimd`** (MCP `2026-07-28` profile), and device authorization for the CLI. **Not** the organization plugin — tenancy is ours (§12.3) | Upgrade the whole `@better-auth/*` family together. On Bun, inject the SSRF-safe fetch transport that CIMD requires (§13.2). See §12.2 risk note.                                                                                                                                                                                                                                                                                                                  |
| Jobs           | **pg-boss** (Postgres queue) behind a `jobs` interface                                                                                                                                                                                | Enqueue in the writing transaction; raise batch size (defaults are slow); handlers idempotent.                                                                                                                                                                                                                                                                                                                                                                     |
| Realtime       | Bun WebSocket server (`uWS`-backed) behind a `PubSub` interface: in-process on one node, **Valkey** pub/sub when multi-node                                                                                                           | Valkey is optional for self-host.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CRDT           | **Yjs 13** + **Hocuspocus 4** (MIT; stable since May 2026; runs on Bun via `crossws` + `handleConnection()`) with Postgres persistence                                                                                                | Hocuspocus handles rooms, auth hooks, and awareness; do not hand-roll CRDT rooms.                                                                                                                                                                                                                                                                                                                                                                                  |
| Object storage | `BlobStore` interface: **local filesystem driver** (single-node self-host default, on a backed-up volume) or any S3-compatible API (S3/R2/Garage/SeaweedFS; **not MinIO** — community edition archived)                               | Presigned (or signed-URL) uploads, quarantine prefix, lifecycle rules.                                                                                                                                                                                                                                                                                                                                                                                             |
| Search         | Postgres FTS + `pg_trgm` + `pgvector` 0.8.7+ (HNSW, `halfvec`, iterative scans)                                                                                                                                                       | Optional BM25 extension later; never a hard dependency.                                                                                                                                                                                                                                                                                                                                                                                                            |
| AI             | Provider-agnostic gateway on the **Vercel AI SDK** (OpenAI-compatible, Anthropic, Ollama/vLLM adapters), pinned exact                                                                                                                 | Patches change experimental APIs; everything sits behind `AiGateway`.                                                                                                                                                                                                                                                                                                                                                                                              |
| MCP            | Official **MCP TypeScript SDK v2** (stateless `2026-07-28` transport) configured with `legacy: "reject"`                                                                                                                              | Better Auth owns OAuth; the SDK owns protocol and transport.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Mail           | `MailProvider` interface over **inbound-parse, Gmail API, Microsoft Graph, IMAP (`imapflow`), JMAP**                                                                                                                                  | MIME parsing in a CPU/memory-limited worker (`mailparser`); DKIM/SPF/DMARC verification with `mailauth`.                                                                                                                                                                                                                                                                                                                                                           |

### 6.3 Frontend

| Concern                | Choice                                                                                                                                                       | Notes                                                                                                                                                                                                                                                                             |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web framework          | **TanStack Start 1.x** (stable since 2026-10-13; `@tanstack/react-start` ≥ 1.169) + Router/Table/Virtual/Form                                                | **Authenticated app routes are `ssr: false`** (client-only, rendered from the local replica); SSR/prerender only for public share pages, sign-in, and marketing/docs. Build needs Vite 8+ and Node ≥ 22.12. Pin the lockfile — the ecosystem had a supply-chain incident in 2026. |
| UI primitives          | **Base UI** (`@base-ui/react` 1.9+) via the shadcn/ui registry; Radix remains supported                                                                      | New projects default to Base UI since July 2026.                                                                                                                                                                                                                                  |
| Styling                | **Tailwind CSS 4.3.x** with `@theme` + OKLCH tokens                                                                                                          |                                                                                                                                                                                                                                                                                   |
| Editor                 | **TipTap 3.x (MIT) + Hocuspocus 4 + Yjs 13**                                                                                                                 | Collaboration core is MIT; **Comment threads, track-changes, and AI toolkits are paid** — we build comments ourselves (§10.1).                                                                                                                                                    |
| Client data layer      | **TanStack DB 1.0** (RC1 2026-10-29; adopt GA) — collections fed by our change feed through a **custom sync adapter**, live queries, optimistic transactions | Replaces a hand-rolled observable store. The custom adapter (our protocol) is the part we own.                                                                                                                                                                                    |
| Local replica (web)    | TanStack DB **SQLite persistence on OPFS** (wa-sqlite) + **`@tanstack/offline-transactions`** durable outbox (with built-in leader election)                 | Needs a secure context + OPFS; fallback = in-memory replica + online-only writes, with a visible banner.                                                                                                                                                                          |
| Local replica (mobile) | TanStack DB SQLite persistence on **`expo-sqlite`** + the same offline-transactions outbox                                                                   | `op-sqlite` only with a measured need.                                                                                                                                                                                                                                            |
| Client UI state        | **Zustand** for ephemeral cross-component UI state (panels, selection, palette, density); TanStack Router search params for anything shareable               | Rule: replicated server data lives **only** in TanStack DB, never copied into Zustand.                                                                                                                                                                                            |
| Forms                  | TanStack Form validated with the **same contract schemas** (Standard Schema adapter)                                                                         | No second schema language for forms.                                                                                                                                                                                                                                              |
| i18n                   | **Lingui** (ICU MessageFormat, extraction + compile step, works on web and React Native)                                                                     | ADR-0016; English source, French + Kinyarwanda first.                                                                                                                                                                                                                             |
| Charts                 | Recharts or visx, token-driven, accessible                                                                                                                   |                                                                                                                                                                                                                                                                                   |
| Mobile                 | **Expo SDK 58 / React Native 0.88** (New Architecture mandatory), Expo Router, Reanimated 4, expo-notifications                                              | Collaborative docs run the **same TipTap build inside an Expo DOM component**; chat composer stays native.                                                                                                                                                                        |
| Mobile styling         | **Uniwind (Tailwind v4) + HeroUI Native**, plus **`@expo/ui`** for platform-native controls (sheets, pickers, menus, switches)                               | Shares the compiled token theme with web; native controls wherever the platform has them.                                                                                                                                                                                         |
| Desktop                | **PWA → Tauri 2.x** thin shell                                                                                                                               | Tauri 3 (bundled CEF) only once stable. Electron if identical Chromium behavior on Linux is required.                                                                                                                                                                             |
| Motion                 | CSS + Motion (React) with `prefers-reduced-motion` honored                                                                                                   |                                                                                                                                                                                                                                                                                   |

### 6.4 Quality & delivery

| Concern            | Choice                                                                                                                                                                                                                                                            |
| :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo orchestration | Bun workspaces + **Turborepo** (decided — ADR-0001 closed: least config for a solo maintainer; remote cache optional)                                                                                                                                             |
| Lint/format        | **Biome** (format + lint + a11y rules) + **dependency-cruiser** for module/package boundaries; ESLint only if a needed rule has no equivalent                                                                                                                     |
| Type check         | `tsc --noEmit` per package, in CI                                                                                                                                                                                                                                 |
| Unit/integration   | `bun test` (backend), **Vitest 5** (frontend), Testcontainers Postgres                                                                                                                                                                                            |
| E2E                | **Playwright 1.65** (web), **Maestro** (mobile)                                                                                                                                                                                                                   |
| Load               | k6 scenarios against staging                                                                                                                                                                                                                                      |
| CI                 | GitHub Actions with OIDC, **workflow dependency lockfiles / full-SHA pins**, reusable workflows                                                                                                                                                                   |
| Supply chain       | `bun audit`, OSV-Scanner, Trivy, gitleaks, SBOM (CycloneDX), cosign signing, `bunfig.toml` + Renovate minimum release age                                                                                                                                         |
| Observability      | Default: structured logs to stdout + Prometheus `/metrics`. **Optional**: OpenTelemetry export (manual spans on Bun) to any OTLP backend (Grafana LGTM / SigNoz / OpenObserve) and a GlitchTip/Sentry DSN. Self-host must never _require_ an observability stack. |
| Analytics          | Cloud only: PostHog with strict PII scrubbing. **Never enabled on self-host** (§2.5 telemetry rule).                                                                                                                                                              |

### 6.5 Dependency adoption gate

A dependency is accepted only if all are true:

1. **Maintained** — commit within 6 months, responsive issue triage, ≥2 maintainers or a company steward.
2. **Licensed** — compatible with AGPL-3.0 distribution (§2.5): MIT/Apache-2.0/ISC/BSD preferred; MPL-2.0/LGPL acceptable; AGPL acceptable for network services we talk to. SSPL/BSL/Commons-Clause/proprietary are banned. Anything bundled into the **MIT** SDK/CLI must itself be permissive.
3. **Small blast radius** — replacement cost < 2 days, or vendored/forkable.
4. **No install scripts** without review (`ignore-scripts` by default, allowlist on demand).
5. **Typed and documented** — first-class TS types, no `any` in public API.
6. **No known critical CVEs** and a path to patch.

---

## 7. Monorepo & Code Organization

### 7.1 Layout

```text
huriro/
├── apps/
│   ├── server/                 # ONE image, entrypoints per role: `huriro serve --role=api|worker|realtime|all`
│   │   ├── src/api/            # Elysia app: REST, MCP endpoint, webhooks, static web assets
│   │   ├── src/modules/<domain>/{index,schema,service,repo,policy,events}.ts
│   │   ├── src/realtime/       # Signal-plane WebSocket + Hocuspocus rooms + presence
│   │   ├── src/worker/         # Outbox consumers, schedulers, mail sync, embeddings, imports
│   │   └── src/cli/            # Operator commands: migrate, doctor, backup, restore, create-admin
│   ├── web/                    # TanStack Start; app routes client-only (ssr:false), PWA
│   │   └── src/features/<area>/{components,hooks,routes}/   # feature folders, small files
│   ├── mobile/                 # Expo Router app
│   └── desktop/                # Thin native shell (Tauri-class) — post-GA
├── packages/
│   ├── db/                     # Drizzle schema + raw-SQL migrations (RLS, triggers, counters) + seeds
│   ├── contracts/              # TypeBox schemas, DTOs, error codes, event payloads, tool schemas
│   ├── domain/                 # Pure domain logic (permissions, ordering, threading) — no I/O
│   ├── agent-tools/            # The tool registry: one definition per tool → REST, MCP, CLI, in-app AI
│   ├── api-client/             # Eden typed client + generated OpenAPI SDK (MIT)
│   ├── cli/                    # `huriro` CLI for users and agents, generated from OpenAPI (MIT)
│   ├── sync-client/            # TanStack DB sync adapter + collection definitions + offline executor
│   ├── design-tokens/          # DTCG JSON → shadcn CSS vars + Tailwind @theme + Uniwind/RN theme
│   ├── ui/                     # Web components (shadcn/Base UI, owned code) in src/components/<group>/
│   ├── ui-native/              # Shared RN primitives (HeroUI Native + @expo/ui wrappers)
│   ├── editor/                 # TipTap extensions, schema, Yjs binding, markdown I/O
│   ├── i18n/                   # Lingui catalogs, locale loaders, formatting helpers
│   ├── auth-client/            # Session hooks, guards, workspace context
│   ├── config/                 # tsconfig, biome, dependency-cruiser, tailwind presets
│   └── test-utils/             # Factories, Testcontainers harness, MSW handlers, fake clock
├── infra/
│   ├── compose/                # compose.yml (minimal) + profiles: s3, valkey, clamav, otel, mail
│   ├── dokploy/                # Dokploy template and docs
│   ├── helm/                   # Kubernetes chart (post-GA, cloud path)
│   └── grafana/                # Dashboards as code
├── docs/
│   ├── plan/                   # This plan split into one file per section, linked from an index
│   ├── adr/                    # Architecture Decision Records (numbered)
│   ├── runbooks/               # Restore, rotate secrets, incident playbooks
│   ├── threats/                # STRIDE model per module
│   └── api/                    # Generated OpenAPI + guides + llms.txt
├── AGENTS.md                   # Root agent guide; each app/package has its own short AGENTS.md
├── .github/workflows/          # CI/CD
├── package.json                # Bun workspaces; `bun run verify` = the full local gate
└── turbo.json                  # Task graph + cache
```

> **Why one `apps/server` instead of three apps:** the three roles share every module, config schema, and migration; separate apps would triplicate wiring and Docker builds. Roles stay isolated at runtime (separate processes, health checks, and resource limits) while the code has one composition root.

### 7.2 Package rules

- **No app imports another app.** Shared code lives in `packages/*`.
- **`packages/domain` is pure.** No `fs`, no `fetch`, no DB, no clock, no randomness — injected instead. This makes the permission and ordering logic trivially testable.
- **`packages/db` owns all schema.** Apps never define tables.
- **`packages/contracts` is the wire format.** HTTP bodies, event payloads, MCP tool schemas. Both server and client import from here; no duplicated shapes.
- **`packages/ui` is vendored code, not a dependency.** We own and can edit every component (shadcn model). Updates are deliberate diffs.
- **No barrel files** in `modules/*` (they defeat tree-shaking and create cycles); explicit exports only.
- **Small files, feature folders.** UI lives in `components/<group>/` (packages) or `features/<area>/components/` (apps); a component file over ~250 lines or with more than one exported component is split. Named exports only.
- **Every package has an `AGENTS.md`** (≤ 60 lines): what it owns, its public interface, commands to test it, and "never do" rules. The root `AGENTS.md` maps the architecture and links to the ADRs. These files are reviewed like code; a recurring agent mistake becomes a lint rule or test, then a line here.
- **Generated code is committed and checked.** OpenAPI spec, CLI, tool manifests, token outputs, and i18n catalogs are generated by `bun run gen`; CI fails if regenerating produces a diff.

### 7.3 API module shape

```text
apps/server/src/modules/tasks/
├── index.ts          # Elysia plugin: routes + guards, exported as a plugin
├── schema.ts         # TypeBox request/response + OpenAPI metadata
├── service.ts        # Authorized business operations (takes ctx, returns DTO)
├── repo.ts           # SQL/Drizzle access; always workspace-scoped
├── policy.ts         # Task-specific authorization rules
├── events.ts         # Event names + payload builders
└── tasks.test.ts     # Unit + integration (real DB)
```

Rules:

- **Routes do not contain business logic.** They parse → authorize → call service → map result.
- **Services do not know about HTTP.** They accept a typed `ActorContext` (`userId`, `workspaceId`, `roles`, `scopes`, `requestId`).
- **Repos always require a workspace scope** as a type-level argument, so it cannot be forgotten.
- **Policies are pure functions** `(actor, action, resource) => Decision` returning `allow | deny(reason)`. They are the single place role math lives, and every one has table-driven tests.

### 7.4 Shared types across web/mobile

- `packages/contracts` holds **runtime schemas** (TypeBox/Standard Schema) and **derived types**. Mobile and web consume the same types.
- API client: Eden for web (zero codegen); generated OpenAPI client for agents, self-hosters, and non-TS uses. Both are checked in CI against the running server's spec (contract test).
- Never import server-only code into a client bundle: Biome rule + `server-only`-style poison-pill exports.

### 7.5 Configuration & environment

- One `env.ts` per app using a schema validator; the process **refuses to boot** with a missing/invalid variable and prints exactly which and why.
- `.env.example` is generated from the schema (never hand-maintained).
- Secrets come from the platform secret store (Docker secrets / vault / cloud secret manager); env vars may reference files (`DATABASE_URL_FILE`).
- Feature flags are server-evaluated and typed; client sees only boolean payloads, never rules.

---

## 8. Data Architecture

### 8.1 Conventions (applied to every table)

| Rule                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                        |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primary keys           | `uuid` generated by **`uuidv7()`** (time-ordered, index-friendly, no sequence contention, safe to generate client-side for offline creates). Client-supplied ids are validated: version 7, timestamp within ±24 h of server time (or of the mutation's queued-at for offline replays), and rejected if already used by another entity                                                                         |
| Tenant key             | Every tenant table has `workspace_id uuid NOT NULL` with FK to `workspaces` and `ON DELETE CASCADE`. Every FK-target table also declares `UNIQUE (workspace_id, id)`, and **every tenant FK is composite** `(workspace_id, x_id) REFERENCES x (workspace_id, id)` — the single-column FKs in the examples below are shorthand and are written composite in the real migrations                                |
| Timestamps             | `created_at`, `updated_at` as `timestamptz` defaulting to `now()`; `updated_at` maintained by trigger, not by app code                                                                                                                                                                                                                                                                                        |
| Soft delete            | `deleted_at timestamptz NULL` only where "undo" is a product requirement; hard deletes elsewhere with cascade                                                                                                                                                                                                                                                                                                 |
| Optimistic concurrency | Aggregate roots carry `version integer NOT NULL DEFAULT 1`; update requires `WHERE version = $expected` and increments                                                                                                                                                                                                                                                                                        |
| Ordering               | User-ordered collections use **fractional indexing** with base-62 string keys (`position text COLLATE "C" NOT NULL`) — O(1) single-row moves. `COLLATE "C"` is mandatory: keys compare bytewise, and a locale collation (`en_US.UTF-8`) sorts them differently from the client. Never `double precision` (precision runs out after ~50 bisections). The server rebalances a column when keys exceed 64 chars. |
| Enums                  | Postgres enums only for truly closed sets; otherwise `text` + `CHECK` (migrations are cheaper)                                                                                                                                                                                                                                                                                                                |
| JSONB                  | Allowed for _extension_ payloads (custom fields, provider metadata) — never for fields you filter or join on                                                                                                                                                                                                                                                                                                  |
| Naming                 | `snake_case`, plural tables, `fk_`/`idx_`/`uq_`/`ck_` prefixes, no abbreviations that need a glossary                                                                                                                                                                                                                                                                                                         |
| Ownership              | Each table is declared in exactly one module schema file under `packages/db/schema/<module>.ts`                                                                                                                                                                                                                                                                                                               |
| RLS                    | Every tenant table has `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`; app role is not table owner                                                                                                                                                                                                                                                                                            |

### 8.2 Entity map

```text
users ─┬─ sessions
       ├─ oauth_accounts
       └─ api_keys
workspaces ─┬─ memberships ── roles (workspace-defined, versioned)
            ├─ invitations
            ├─ projects ─┬─ project_statuses (ordered)
            │            ├─ cycles / milestones
            │            └─ issues ─┬─ issue_relations (blocks/relates/duplicates)
            │                       ├─ issue_comments ── comment_reactions
            │                       └─ issue_attachments ──▶ files
            ├─ doc_pages (self-referencing tree) ─┬─ doc_state (live yjs state, 1 row) 
            │                                     ├─ doc_versions (named/historic)
            │                                     └─ doc_comments
            ├─ chat_channels ─┬─ chat_channel_members
            │                 └─ chat_messages (thread_parent_id self-FK)
            ├─ mail_accounts ─┬─ mail_labels
            │                 └─ mail_conversations ─┬─ mail_messages (threaded)
            │                                        ├─ mail_conversation_events (assign · status · merge)
            │                                        └─ mail_conversation_comments (internal notes)
            ├─ entity_links (conversation ↔ issue/doc, issue ↔ doc, message ↔ issue …)
            ├─ roles ── role_permissions
            └─ change_log / outbox / audit_log / jobs / search_documents
```

### 8.3 Core schema (representative, not exhaustive)

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
-- Optional, if available on the host: CREATE EXTENSION IF NOT EXISTS ltree;

-- ---------- Identity ----------
-- Better Auth owns the identity tables in schema `auth` (user, session, account, passkey, two_factor,
-- apikey, jwks, oauth_*), configured to generate uuidv7 ids. `users` below is that same table viewed
-- through Better Auth `additionalFields`; it is NOT a second copy. Huriro code reads it through the
-- identity module only, and the API role gets SELECT on a narrow column set.
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    email         citext UNIQUE NOT NULL,
    display_name  text NOT NULL,
    avatar_url    text,
    locale        text NOT NULL DEFAULT 'en',
    timezone      text NOT NULL DEFAULT 'UTC',
    mfa_enabled   boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);

-- ---------- Tenancy & RBAC ----------
CREATE TABLE workspaces (
    id         uuid PRIMARY KEY DEFAULT uuidv7(),
    slug       citext UNIQUE NOT NULL,
    name       text NOT NULL,
    plan       text NOT NULL DEFAULT 'free',
    settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

-- Roles are DATA, not bitmasks: readable, versionable, per-workspace customizable.
CREATE TABLE roles (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key          text NOT NULL,             -- 'owner' | 'admin' | 'member' | 'guest' | custom
    name         text NOT NULL,
    is_system    boolean NOT NULL DEFAULT false,
    rank         int NOT NULL,              -- for ">= admin" style checks
    UNIQUE (workspace_id, key)
);

CREATE TABLE role_permissions (
    role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission  text NOT NULL,              -- 'issue.write', 'doc.share', 'mail.assign', 'member.invite'
    PRIMARY KEY (role_id, permission)
);

CREATE TABLE memberships (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id      uuid NOT NULL REFERENCES roles(id),
    status       text NOT NULL DEFAULT 'active',   -- active | suspended
    joined_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

-- Resource-level ACLs (private channels/docs/projects, per-user sharing, guest scoping)
CREATE TABLE acl_entries (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    resource_type text NOT NULL,            -- 'channel' | 'doc_page' | 'project' | 'mail_account'
    resource_id  uuid NOT NULL,
    principal_type text NOT NULL,           -- 'user' | 'role' | 'workspace'
    principal_id uuid,                      -- null when principal_type = 'workspace'
    permission   text NOT NULL,             -- 'read' | 'comment' | 'write' | 'manage'
    granted_by   uuid REFERENCES users(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, resource_type, resource_id, principal_type, principal_id, permission)
);
CREATE INDEX idx_acl_lookup ON acl_entries (workspace_id, resource_type, resource_id);

-- ---------- Work items ----------
CREATE TABLE projects (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key          text NOT NULL,             -- 'ENG'
    name         text NOT NULL,
    visibility   text NOT NULL DEFAULT 'workspace',   -- workspace | private
    position     text NOT NULL,             -- fractional index
    archived_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    version      int NOT NULL DEFAULT 1,
    UNIQUE (workspace_id, key)
);

CREATE TABLE project_statuses (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name         text NOT NULL,                    -- 'Backlog' | 'Todo' | 'In Progress' | 'Done' | custom
    category     text NOT NULL,                    -- backlog | unstarted | started | completed | cancelled
    position     text NOT NULL,                    -- fractional index
    is_default   boolean NOT NULL DEFAULT false,
    UNIQUE (project_id, name)
);

CREATE TABLE labels (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         text NOT NULL,
    color        text NOT NULL,                    -- token reference, not raw hex in UI
    UNIQUE (workspace_id, name)
);

CREATE TABLE issues (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number        int NOT NULL,                         -- per-project; identifier = key || '-' || number
    parent_id     uuid REFERENCES issues(id) ON DELETE SET NULL,
    title         text NOT NULL,
    description   jsonb,                                -- rich text doc (ProseMirror JSON)
    status_id     uuid NOT NULL REFERENCES project_statuses(id),
    priority      smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
    assignee_id   uuid REFERENCES users(id) ON DELETE SET NULL,
    creator_id    uuid NOT NULL REFERENCES users(id),
    position      text NOT NULL,                        -- fractional index within column
    start_date    date,
    due_date      date,
    estimate      numeric(6,2),
    closed_at     timestamptz,
    search_tsv    tsvector GENERATED ALWAYS AS (
                      to_tsvector('simple', coalesce(title,''))
                  ) STORED,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz,
    version       int NOT NULL DEFAULT 1,
    UNIQUE (project_id, number)
);
CREATE INDEX idx_issues_board   ON issues (workspace_id, project_id, status_id, position)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_issues_search  ON issues USING gin (search_tsv);
CREATE INDEX idx_issues_title_trgm ON issues USING gin (title gin_trgm_ops);

CREATE TABLE issue_labels (
    workspace_id uuid NOT NULL,
    issue_id     uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    label_id     uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (issue_id, label_id)
);
CREATE INDEX idx_issue_labels_label ON issue_labels (label_id);

-- Per-project counter, incremented inside the same txn as the insert (tenant-scoped + RLS like every table)
CREATE TABLE issue_counters (
    workspace_id uuid NOT NULL,
    project_id   uuid PRIMARY KEY,
    next_number  int NOT NULL DEFAULT 1,
    FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);

-- Agents are principals, not users with a flag: they have an owner, a scope ceiling, and are revocable.
CREATE TABLE agent_principals (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind          text NOT NULL,          -- 'external_mcp' | 'builtin_assistant' | 'automation'
    name          text NOT NULL,          -- shown with an "agent" badge everywhere it acts
    owner_user_id uuid NOT NULL REFERENCES users(id),   -- the human accountable for it
    oauth_client_id text,                 -- set for MCP clients (CIMD client_id URL)
    scope_ceiling text[] NOT NULL,        -- max scopes it may ever receive
    status        text NOT NULL DEFAULT 'active',      -- active | suspended | revoked
    last_active_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id)
);
-- issues.assignee may reference a user OR an agent principal: modeled as
-- assignee_type text CHECK (assignee_type IN ('user','agent')) + assignee_id uuid, validated by trigger.
```

> **Note on `number`:** the counter row is locked with `UPDATE ... RETURNING next_number` inside the insert transaction. Lock contention is per-project and lasts microseconds. Do not use `MAX(number)+1` — it races and gaps, which is fine, but it also scans.

### 8.4 Documents (tree + CRDT state)

```sql
CREATE TABLE doc_pages (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id     uuid REFERENCES doc_pages(id) ON DELETE CASCADE,
    -- Materialized path of uuid segments: fast subtree reads, cheap moves, no extension dependency.
    -- If ltree is available on the target host, mirror it as a generated column for GIST-accelerated queries.
    path          text NOT NULL,              -- e.g. '019a.../019b.../019c...'  (root → self)
    depth         int  NOT NULL,
    slug          text NOT NULL,
    title         text NOT NULL,
    icon          text,
    visibility    text NOT NULL DEFAULT 'workspace',   -- workspace | private
    position      text NOT NULL,
    created_by    uuid NOT NULL REFERENCES users(id),
    archived_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    version       int NOT NULL DEFAULT 1,
    UNIQUE (workspace_id, slug)
);
CREATE INDEX idx_doc_pages_path ON doc_pages (workspace_id, path text_pattern_ops);

-- The live CRDT state: ONE row per page, overwritten by the single room owner (§10.5).
-- Kept off doc_pages so tree/metadata updates never rewrite a multi-MB bytea.
CREATE TABLE doc_state (
    workspace_id uuid NOT NULL,
    page_id      uuid PRIMARY KEY,
    state        bytea NOT NULL,             -- Y.encodeStateAsUpdate(doc), compacted
    state_vector bytea NOT NULL,             -- for cheap diff sync with offline clients
    byte_size    int NOT NULL,
    lease_epoch  bigint NOT NULL,            -- fencing token: writes with a lower epoch are rejected
    plain_text   text NOT NULL DEFAULT '',   -- extracted on save for search/AI
    updated_at   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, page_id) REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);

-- History: immutable checkpoints, not a row per save.
CREATE TABLE doc_versions (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL,
    page_id      uuid NOT NULL,
    kind         text NOT NULL,              -- 'auto' (activity checkpoint) | 'named' | 'pre_restore'
    label        text,
    state        bytea NOT NULL,             -- full state at that point (cheap to restore, no replay)
    byte_size    int NOT NULL,
    authors      uuid[] NOT NULL DEFAULT '{}',   -- who edited since the previous checkpoint
    created_by   uuid REFERENCES users(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, page_id) REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_versions_page ON doc_versions (workspace_id, page_id, created_at DESC);
```

**Why one live row + checkpoints (changed in v1.1):** v1.0 appended a full snapshot on every 2–10 s debounce, which for a 1 MB document is ~360 MB per editing hour — unbounded storage and WAL. Because each document has exactly one authoritative room (§10.5), there is exactly one writer, so overwriting `doc_state` has no contention; the `lease_epoch` fencing token stops a stale owner from overwriting a newer one after a failover. History comes from **auto checkpoints** (at most one per 10 minutes of activity, plus one when the last editor leaves) and **named versions**, thinned by a retention job (all checkpoints for 7 days → hourly for 30 days → daily thereafter; named versions kept forever).

### 8.5 Change log, outbox, and audit

```sql
-- The sync log. Monotonic per workspace. Written in the SAME transaction as the domain change.
CREATE TABLE change_log (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    cursor       bigint NOT NULL,          -- from workspace_seq (UPDATE … RETURNING), allocated last in the txn
    entity_type  text NOT NULL,            -- 'issue' | 'doc_page' | 'message' | 'permission' | ...
    entity_id    uuid NOT NULL,
    action       text NOT NULL,            -- 'upsert' | 'delete' | 'reorder' | 'revoke'
    scope        text[] NOT NULL DEFAULT '{}',  -- e.g. {project:<id>} or {channel:<id>} for read filtering
    payload      jsonb NOT NULL,           -- the authorized-to-serve representation (null for deletes/revokes)
    actor_id     uuid,
    changed_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, cursor)
);
CREATE INDEX idx_change_log_entity ON change_log (workspace_id, entity_type, entity_id);

-- One row per workspace: the serialization point for cursor allocation.
CREATE TABLE workspace_seq (
    workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    last_cursor  bigint NOT NULL DEFAULT 0
);

CREATE TABLE outbox (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid,
    aggregate    text NOT NULL,
    aggregate_id uuid,
    event_type   text NOT NULL,
    payload      jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,              -- null = pending
    attempts     int NOT NULL DEFAULT 0,
    last_error   text
);
CREATE INDEX idx_outbox_pending ON outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE processed_events (            -- consumer idempotency
    consumer   text NOT NULL,
    event_id   uuid NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, event_id)
);

CREATE TABLE audit_log (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid,
    actor_type   text NOT NULL,            -- 'user' | 'api_key' | 'agent' | 'system'
    actor_id     uuid,
    action       text NOT NULL,            -- 'auth.login.failed', 'member.role_changed', 'mail.exported'
    target_type  text,
    target_id    uuid,
    ip_hash      text,
    user_agent   text,
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_ws_time ON audit_log (workspace_id, created_at DESC);
```

**Retention:** `change_log` is pruned by a nightly job based on the **minimum cursor of active clients** per workspace (tracked in `sync_cursors`), with a floor of 30 days. Clients whose cursor predates the floor receive `410 Gone` and perform a full resync against a snapshot endpoint.

### 8.6 Idempotency

```sql
CREATE TABLE idempotency_keys (
    workspace_id  uuid NOT NULL,
    key           text NOT NULL,
    endpoint      text NOT NULL,
    request_hash  text NOT NULL,
    response_code int,
    response_body jsonb,
    status        text NOT NULL DEFAULT 'in_flight',   -- in_flight | completed | failed
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, key)
);
```

Behavior: same key + same body → replay the stored response (`200`/original code). Same key + different body → `422` with `problem+json`. In-flight duplicate → `409` with `Retry-After`.

### 8.7 Files

```sql
CREATE TABLE files (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    uploaded_by   uuid REFERENCES users(id),
    storage_key   text NOT NULL,          -- object key; never the raw user filename
    filename      text NOT NULL,          -- original, sanitized for display only
    content_type  text NOT NULL,          -- sniffed, not trusted from client
    byte_size     bigint NOT NULL,
    checksum      text NOT NULL,          -- sha256
    scan_status   text NOT NULL DEFAULT 'pending',  -- pending | clean | infected | failed
    is_public     boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
);
```

Uploads are **two-phase**: client requests a presigned PUT with declared size/type limits → object lands in a `quarantine/` prefix → worker scans + sniffs → object is promoted to `files/` and the row becomes `clean`. Downloads are served from a **separate registrable domain** when configured (`usercontent` origin / CDN) with `Content-Disposition: attachment` and a restrictive CSP; on a single-name self-host install they are served from the app origin with `CSP: sandbox` (§5.1, §12.6).

### 8.8 Migration discipline

- **Expand → migrate → contract**, three deploys, never one.
- Migration linter in CI (lock-time hazards, `NOT NULL` without default on large tables, index built without `CONCURRENTLY` outside a transaction, enum removal).
- Every migration has a **rollback note** and a `-- no-transaction` marker only when justified (e.g. `CREATE INDEX CONCURRENTLY`).
- Migrations run as a **separate job** before the new app version starts, with a distributed lock.
- Seed data is idempotent and environment-aware (never seeds production users).
- Schema changes that affect the wire contract ship with a version bump and a deprecation window (§16.7).

---

## 9. Sync, Real-Time & Offline

This is the section that most determines whether Huriro feels like Linear or like a CRUD admin panel. It is also where the original sketch had a correctness bug. We fix the bug and keep the ambition.

### 9.1 Design goals

| Goal                               | Mechanism                                                                              |
| :--------------------------------- | :------------------------------------------------------------------------------------- |
| Instant local reads/writes         | Client-local replica + optimistic mutations                                            |
| Correct catch-up after any gap     | Monotonic **per-workspace** change cursor with commit-safe allocation                  |
| Zero unauthorized data on the wire | Socket carries **cursors only**; data is always fetched through an authorization check |
| Bounded server memory              | No per-client payload queues; coalesced signals                                        |
| Bounded client work                | Delta pull with pagination + snapshot fallback                                         |
| Multi-device support               | Per-device cursor, conflict detection by `version`, replayable mutation queue          |

### 9.2 The correctness problem in the original design (and its fix)

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

### 9.3 The delta endpoint

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

### 9.4 Signal plane (WebSocket)

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

### 9.5 Client replication model

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

### 9.6 Offline behavior (product contract)

| Scenario                      | Behavior                                                                  |
| :---------------------------- | :------------------------------------------------------------------------ |
| Offline read                  | Full workspace browsing from cache; mail bodies only if previously opened |
| Offline write                 | Queued with visible "pending" affordance; timestamped                     |
| Offline conflicting edit      | Auto-merge when disjoint; resolver dialog when overlapping                |
| Long offline (> retention)    | On reconnect, snapshot resync; queued mutations replay first, then deltas |
| Account revoked while offline | Queued mutations rejected; local store wiped on next auth check           |
| Shared device sign-out        | Local store and keys destroyed (see §22.4)                                |

The offline queue is capped (default 5,000 mutations / 25 MB) with a clear user-facing explanation when the cap is hit, rather than silent data loss.

### 9.7 Why not adopt a third-party sync engine at v1?

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

---

## 10. Collaborative Documents

### 10.1 Editor stack

- **TipTap v3** (ProseMirror) as the editing surface, with a schema we own in `packages/editor`.
- **Yjs** for CRDT state, `y-prosemirror` binding for conflict-free merging, awareness protocol for cursors/presence.
- Extensions we build in-house: task/issue mention (atomic node with entity id), person mention, code block with syntect-class highlighting, callout, toggle, table, embed (file, image, video, Figma/Loom unfurl), inline comment anchor, and **reference blocks** that render live entity state.
- Markdown import/export with round-trip tests (paste, GitHub README import, export for portability).
- Slash menu (`/`), drag handle, floating toolbar, and a full keyboard map (see §17.6).

**Licensing gate (ADR-0007):** the editing core must remain OSS-usable. Paid collaboration/history add-ons are acceptable only as _optional_ hosted features; the self-hosted product must not depend on them. If the chosen editor's license cannot satisfy that, we fall back to a raw ProseMirror/Yjs integration (higher effort, fully OSS).

### 10.2 Authority and persistence model

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

### 10.3 Authentication and per-document authorization

```text
Client → POST /api/v1/docs/:pageId/collab-ticket
       ← { ticket: "<signed, 60s, aud=collab, single-use>", documentName }
Client → wss://<app-origin>/collab   (no credentials in the URL)
Client → Hocuspocus auth message carrying the ticket (provider `token` option)
Server → verify signature + exp + aud + jti unused; re-check page read/write permission from DB (never from claims alone)
       → on write permission revoked mid-session: close room for that user + notify
```

The ticket encodes `sub` (user or agent principal), `ws`, `doc`, `perm` (`read` | `write`), and a `jti` that is burned on first use. It travels in the protocol's auth message, never the query string (URLs end up in proxy logs). Web clients may instead rely on the same-origin session cookie plus the `Origin` allowlist. The room validates against the DB on connect and then on a 5-minute interval — a removed collaborator can't keep typing indefinitely on a cached ticket. Read-only connections are enforced server-side (`connection.readOnly = true`), not by the editor UI.

### 10.4 Comments, mentions, and history

- **Anchored comments** use relative positions (Yjs `RelativePosition`) so they survive concurrent edits; orphaned anchors are surfaced, not silently dropped.
- **Mentions** are first-class entities (`person:<uuid>`, `issue:<uuid>`, `doc:<uuid>`) that render live and generate notifications through the outbox.
- **History** is a list of compacted snapshots with author attribution, diff preview, and restore-as-new-version (never destructive).
- **Offline doc editing**: web and mobile support it via the same local Yjs doc persisted in the local store; merges on reconnect are automatic.

### 10.5 Running the collab server in more than one instance

| Concern                | Approach                                                                                                                                                                                                                                                                                                                              |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Same doc on two nodes  | **Document-level affinity**: consistent hashing on `page_id` at the edge (or a `room→node` lease table in Postgres). Never allow two authoritative rooms for one document — two owners each persisting snapshots risks lost or duplicated writes.                                                                                     |
| Awareness across nodes | Redis/Valkey pub/sub per document — **ephemeral, never persisted** (awareness has a built-in ~30 s offline timeout)                                                                                                                                                                                                                   |
| Updates across nodes   | Not needed when documents are single-homed (recommended). The Redis extension broadcasts updates to _every_ instance, so it reduces routing complexity but **does not reduce CPU** — treat it as a fallback, not a scaling strategy.                                                                                                  |
| Scaling approach       | Per the project's own guidance: **independent instances partitioned by document id**, not one cluster sharing all documents                                                                                                                                                                                                           |
| Scaling limit          | Load-test it (Phase 3 gate: 50 concurrent editors on one document, 10 documents). Treat any per-node number as a hypothesis until measured.                                                                                                                                                                                           |
| Failure                | Room lease (`doc_room_leases(page_id, node_id, epoch, expires_at)`) expires after 15 s; the next owner takes it with `epoch + 1`, loads `doc_state`, and its writes fence out the old owner. Clients reconnect and re-send any updates the server lacks (Yjs state-vector diff), so in-flight edits are not lost even across failover |

### 10.6 Document search integration

On each snapshot: strip markup to plain text (with block offsets preserved), write `search_documents` (title, body, headings), enqueue embeddings for chunks. Searching returns a snippet with an anchor that deep-links to the block and, when opened, scrolls the editor to it.

---

## 11. Search, Retrieval & AI

### 11.1 Search architecture

One unified index table, populated by outbox consumers, queried by one endpoint.

```sql
CREATE TABLE search_documents (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entity_type  text NOT NULL,          -- issue | doc_page | message | mail_message | comment
    entity_id    uuid NOT NULL,
    project_id   uuid,
    container_id uuid,                   -- channel / page / conversation, for scoping
    title        text NOT NULL DEFAULT '',
    body         text NOT NULL DEFAULT '',
    lang         text NOT NULL DEFAULT 'simple',
    tsv          tsvector GENERATED ALWAYS AS (
                     setweight(to_tsvector(lang, coalesce(title,'')), 'A') ||
                     setweight(to_tsvector(lang, coalesce(body,'')),  'B')
                 ) STORED,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, entity_type, entity_id)
);
CREATE INDEX idx_sd_tsv ON search_documents USING gin (tsv);
CREATE INDEX idx_sd_trgm ON search_documents USING gin (title gin_trgm_ops);

CREATE TABLE embedding_models (
    id         text PRIMARY KEY,         -- e.g. 'qwen3-embedding-0.6b'
    provider   text NOT NULL,
    dimensions int  NOT NULL,
    is_active  boolean NOT NULL DEFAULT false
);

CREATE TABLE chunk_embeddings (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entity_type  text NOT NULL,
    entity_id    uuid NOT NULL,
    chunk_ix     int NOT NULL,
    content_hash text NOT NULL,          -- skip re-embedding unchanged chunks
    model_id     text NOT NULL REFERENCES embedding_models(id),
    embedding    halfvec NOT NULL,       -- dimension-less column; each model gets its own typed index
    UNIQUE (workspace_id, entity_type, entity_id, chunk_ix, model_id)
);
-- One partial expression index PER MODEL (created by the "activate model" migration job).
-- HNSW needs a fixed dimension, so the cast lives in the index, not in the column:
CREATE INDEX idx_chunk_vec_qwen3_06b ON chunk_embeddings
    USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)
    WHERE model_id = 'qwen3-embedding-0.6b';
-- Queries must repeat the same cast and predicate to use it:
--   ORDER BY embedding::halfvec(1024) <=> $q  ...  WHERE model_id = 'qwen3-embedding-0.6b'
CREATE INDEX idx_chunk_ws ON chunk_embeddings (workspace_id, model_id);
```

**Why `halfvec` + a model table:** halving vector storage costs, and decoupling model choice from the schema means switching embedding providers is a background re-index, not a migration. Never hardcode dimensions in a column definition.

**Query path:**

1. Parse the query: detect entity prefixes (`ENG-142`, `#channel`, `@person`, `in:project`, `is:open`), extract filters.
2. Run Postgres FTS (`websearch_to_tsquery`, per-language `regconfig`) and `pg_trgm` fuzzy match in parallel.
3. If AI is enabled and the query is natural-language, run a vector search with `hnsw.iterative_scan = relaxed_order` so filters don't collapse recall.
4. Fuse with **Reciprocal Rank Fusion** in SQL; permission-filter the result set (always, as a SQL predicate, not a post-filter).
5. Return typed results grouped by kind with highlighted snippets and deep links.

**Multilingual:** store a `lang` per document (detected, overridable). Use `simple` + `unaccent` as a safe default; CJK needs a dedicated tokenizer path (parked as a Phase-4 enhancement).

**Scaling path:** if a tenant's index outgrows a single table, partition `search_documents` by `workspace_id` hash and consider a BM25 extension (e.g. ParadeDB `pg_search`) as an _optional_ add-on — but never as a hard dependency, because managed Postgres providers do not uniformly offer it.

### 11.2 AI capability map (what the product actually does)

| Capability                                        | Where it appears                  | Guardrails                                            |
| :------------------------------------------------ | :-------------------------------- | :---------------------------------------------------- |
| **Semantic search / ask**                         | Command palette, doc sidebar      | Read-only, workspace-scoped, cites sources with links |
| **Summarize thread/conversation**                 | Issue, channel, mail conversation | Read-only; shows "summarized from N messages"         |
| **Draft reply** (chat, mail, comment)             | Compose boxes                     | Suggestion only; never auto-sends                     |
| **Triage suggestion** (labels, project, assignee) | Inbox/issue creation              | Suggestion chips, human applies                       |
| **Agent tools (MCP)**                             | External agents                   | Scoped tokens, explicit confirmation for writes       |
| **Doc Q&A**                                       | Doc page "Ask" panel              | Answers only from documents the _viewer_ can read     |

**Explicit non-goals:** autonomous background agents that modify data without a human in the loop; training on customer data; sending workspace content to a provider that retains it (see §22).

### 11.3 AI gateway design

```text
API/Worker → AiGateway
  ├─ provider adapter (OpenAI-compatible, Anthropic, local vLLM/Ollama)
  ├─ model registry (id → provider, context window, cost, capability flags)
  ├─ policy: per-workspace enable/disable, allowed models, token budget
  ├─ redaction: strip secrets/PII per policy before egress
  ├─ metering: tokens in/out per workspace/user/run (billing + quotas)
  ├─ caching: exact-response cache keyed by (model, params, prompt hash)
  └─ tracing: prompt/response stored only if the workspace opts in; otherwise hashes only
```

- Prompts are **versioned code**, not strings scattered through the app: `packages/ai/prompts/<name>@<version>.ts` with a test that snapshots the rendered prompt.
- Every AI call is an `ai_runs` row (model, tokens, latency, cost, outcome) — auditable and billable.
- **Provider-agnostic by construction** so self-hosters can point at a local model, and so a provider outage degrades to "AI unavailable" rather than a broken product.

### 11.4 Retrieval isolation (the part that must not be wrong)

- Retrieval queries **always** include `workspace_id = $current` and the _requesting user's_ permission scope — enforced in SQL, not in app filtering.
- Agents get the **intersection** of (token scopes) ∩ (user permissions) ∩ (workspace policy). There is no "service account sees everything" path.
- Retrieved content is wrapped in a clearly delimited, untrusted-data envelope in the prompt, with instructions to never follow directives found inside it (§13.6).
- No cross-workspace cache keys. The semantic cache key includes `workspace_id`.

---

## 12. Security & Multi-Tenancy

### 12.1 Threat model summary (STRIDE, per surface)

| Surface       | Primary threats                                                         | Controls                                                                                                              |
| :------------ | :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| Web app       | XSS (docs/mail/chat content), CSRF, clickjacking, session theft         | Strict CSP + Trusted Types, sanitized rendering, SameSite cookies, frame-ancestors, short session TTL + rotation      |
| API           | IDOR, broken object-level auth, mass assignment, replay                 | Policy layer + RLS, explicit DTOs (no raw body → DB), Idempotency-Key, schema validation                              |
| WebSocket     | Cross-site hijacking, unauthorized subscriptions                        | Cookie + Origin allowlist (web) or single-use ticket (native), per-subscription authz, forced close on revocation     |
| Collab server | Unauthorized doc access, memory exhaustion                              | DB-checked tickets, size limits, rate limits, room leases                                                             |
| Files         | Malware, stored XSS via SVG/HTML, SSRF via fetch                        | Quarantine + AV, separate origin, `Content-Disposition`, content sniffing, no server-side URL fetch without allowlist |
| Mail          | XSS in HTML mail, phishing links, prompt injection, spoofing            | Sandboxed rendering, link proxying, SPF/DKIM/DMARC display, untrusted-content envelope for AI                         |
| MCP/agents    | Confused deputy, token passthrough, over-broad scopes, prompt injection | Audience-bound tokens, per-tool scopes, confirmation for writes, audit                                                |
| Infra         | Panel compromise, Docker socket escape, secret leakage                  | Panel not publicly exposed, hardened containers, secret store, least-privilege                                        |
| Supply chain  | Malicious dependency, compromised CI action                             | Pinned digests/SHAs, cooldown, SBOM, signing, provenance                                                              |

### 12.2 Authentication

| Client                                  | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| :-------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web                                     | Better Auth session cookie (`__Secure-` prefixed, since a true `__Host-` name is not achievable with the library's cookie builder): `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`. Idle/absolute expiry configured explicitly; **cookie caching disabled for sensitive operations** so revocation is immediate. CSRF defended by `Origin`/`Fetch-Metadata` validation **plus** a required custom header on every state-changing request. |
| Native (mobile/desktop)                 | OAuth 2.1 + PKCE via the system browser (`expo-web-browser`/AuthSession on mobile; deep-link callback in the desktop shell), then **short-lived access token (15 min) in memory** + **rotating refresh token in secure storage** (`expo-secure-store` / OS keychain), bound to a device id. Never `localStorage`.                                                                                                                         |
| CLI                                     | **OAuth device authorization** (RFC 8628) through the same authorization server — `huriro login` shows a code, the user approves in the browser, the CLI stores a refresh token in the OS keychain. No copy-pasted long-lived keys needed for interactive use.                                                                                                                                                                            |
| API keys (CI, scripts, headless agents) | Scoped keys (`hur_…` prefix, ≥ 256 bits of randomness), stored as **SHA-256** (keyed with a server pepper) — keys are high-entropy, so a slow password hash only adds latency to every request. Shown once, optional expiry, last-used metadata, instant revoke, bound to a user _or_ an agent principal.                                                                                                                                 |
| Agents                                  | OAuth 2.1 authorization server (§13.2) with audience-bound tokens, issued to a dedicated MCP resource and mapped to an `agent_principals` row.                                                                                                                                                                                                                                                                                            |
| Self-host SSO                           | OIDC/SAML per workspace via the auth provider's SSO plugin; SCIM for provisioning. **Not paywalled** (§2.5).                                                                                                                                                                                                                                                                                                                              |
| Instance bootstrap                      | First-run setup wizard creates the instance owner; it is reachable only until an owner exists **and** only with the one-time setup token printed in the server log, so a freshly exposed instance can't be claimed by a stranger.                                                                                                                                                                                                         |

**One session model, several transports.** Every route declares which principal types it accepts (`cookie`, `bearer`, `api_key`, `agent_token`). A request that presents **more than one** credential type is rejected with `400`, and cookie-authenticated requests never reach routes that act on bearer semantics — mixing them widens both CSRF and confused-deputy surfaces.

> **Auth library risk (ADR-0003).** The chosen library has shipped frequent security advisories (several critical, including OAuth state and desktop sign-in issues). Mitigations are mandatory: pin exact versions, upgrade the whole `@better-auth/*` family together, subscribe to its advisories, run **auth end-to-end tests in CI** (login, 2FA, passkey, OAuth code exchange, token refresh, revocation), and keep an exit plan because it is in-process and schema-coupled. Never enable the OAuth provider and a browser-session JWT signer on the same signing key.

**Always:** passkeys (WebAuthn) as the preferred factor; TOTP fallback; recovery codes generated once; step-up authentication for sensitive actions (delete workspace, rotate keys, export data, change email). Login rate limiting uses the **database** store (the library's in-memory default is unacceptable in multi-node deployments) and is configured with explicit trusted proxies so `X-Forwarded-For` cannot be spoofed.

**Anti-enumeration:** login and password-reset respond identically for unknown and known emails; rate limits per IP _and_ per account.

### 12.3 Authorization model

Three layers that must agree, in this order:

```text
1. Role permissions (workspace-wide)      roles → permissions (data, not code)
2. Resource ACLs (object-level)           private channel/doc/project, guest scoping, per-user share
3. Row-Level Security (data layer)        final backstop; every tenant query is scoped by the DB
```

**Policy interface** (`packages/domain/policy.ts`):

```ts
type Action =
	| 'issue.read'
	| 'issue.write'
	| 'issue.delete'
	| 'doc.read'
	| 'doc.write'
	| 'doc.share'
	| 'channel.read'
	| 'channel.post'
	| 'channel.manage'
	| 'mail.read'
	| 'mail.assign'
	| 'mail.send'
	| 'member.invite'
	| 'member.manage'
	| 'workspace.billing'

type Decision =
	| { effect: 'allow'; via: 'role' | 'acl' | 'owner' }
	| { effect: 'deny'; reason: 'not_member' | 'insufficient_role' | 'no_acl' | 'suspended' }

declare function can(actor: ActorContext, action: Action, resource: ResourceRef): Decision
```

- **Deny by default.** No implicit grants.
- **Guest role** can see only explicitly shared resources (enforced in the same policy function).
- **Admins bypass ACLs but are still audited.** The bypass is an explicit code path with a logged reason, not an accident of role ranking.
- The policy is **pure and table-tested**: a matrix test of ~40 roles × resources × actions runs on every PR.

### 12.4 Row-Level Security implementation

```sql
-- Role separation (this is the part people get wrong):
--   huriro_owner   owns the schema; used ONLY by migrations.
--   huriro_app     NOBYPASSRLS, not an owner; used by the API. Never grant it ownership.
--   huriro_app is ALSO used by workers: every tenant job runs inside withWorkspace(job.workspace_id),
--                  so a buggy consumer is as isolated as a buggy route.
--   huriro_maint   BYPASSRLS, used only by a short list of audited maintenance jobs (retention,
--                  change_log pruning, cross-tenant metrics) in their own process with no ingress.
CREATE ROLE huriro_app NOINHERIT NOBYPASSRLS LOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO huriro_app;

ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues FORCE ROW LEVEL SECURITY;   -- without FORCE, the owner bypasses RLS silently

CREATE POLICY issues_tenant_isolation ON issues
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
```

**Per transaction — use `set_config(..., true)`, not `SET LOCAL`:**

```sql
BEGIN;
SELECT set_config('app.workspace_id', $1, true),   -- `true` = transaction-local, parameterizable
       set_config('app.user_id',      $2, true);
-- ... queries ...
COMMIT;
```

Rules and gotchas:

- **Transaction-local only.** `SET LOCAL` cannot take bind parameters; `set_config(name, value, true)` can. Session-scoped settings (`SET`, or `set_config(..., false)`) **leak across tenants** when a pooled connection is reused — this is the single most dangerous mistake possible in this design.
- **`FORCE ROW LEVEL SECURITY` is mandatory.** A table owner silently bypasses RLS, so the API must never run as the role that owns the tables. Superusers and `BYPASSRLS` roles bypass RLS unconditionally.
- The `app.*` settings are set by a **single wrapper** (`withWorkspace(tx, ctx, fn)`); there is no way to obtain a tenant transaction without them. Lint the codebase for raw `db.` usage outside the wrapper.
- `current_setting(..., true)` returns `NULL` when unset → the comparison yields `NULL` → **no rows**. Fails closed. A table with no policy is also default-deny — good, but it means a forgotten policy breaks a feature loudly, which is the failure mode we want.
- **Composite foreign keys** `(workspace_id, id)` across related tables make cross-tenant references impossible at the database level, not just unlikely:

  ```sql
  ALTER TABLE issues ADD CONSTRAINT fk_issues_project
    FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id);
  ```
- **Auth tables live in their own schema** with a narrow role: the auth library must query memberships _before_ a tenant context exists. Keep that surface small and separate from domain tables.
- **Pooling:** PgBouncer transaction mode is compatible with transaction-local settings because the server connection is pinned for the whole transaction. `LISTEN/NOTIFY` and session-level advisory locks are **not** supported in that mode — they use a dedicated direct/session connection.
- **Residual risks to test for:** FK and unique-constraint checks bypass RLS (a covert channel for existence probing — avoid exposing unique-violation details across tenants); policy sub-selects can race under `READ COMMITTED`; and `SECURITY DEFINER` helpers must pin `search_path`.
- A CI test asserts, for **every** tenant table, that a query with no workspace context returns zero rows and that a two-tenant fixture cannot see across the boundary (run as `huriro_app`, never as the owner).

### 12.5 Resource ACL evaluation at scale

For v1, ACL checks are SQL lookups against `acl_entries` (indexed by resource), resolved inside the policy function and mirrored into RLS for list endpoints via a `SECURITY DEFINER` helper (`can_read(resource_type, resource_id, user_id)`).

**When to graduate to a relationship graph (OpenFGA/SpiceDB):** when authorization rules become compositional (inheritance across nested docs/channels, sharing at folder level, cross-workspace guests). The policy interface above is deliberately the seam: swapping the implementation must not change call sites.

### 12.6 Application security controls

**Transport & headers**

- HSTS (2 years, preload), TLS 1.2+ only, OCSP stapling at the edge.
- CSP: nonce-based `script-src`, `strict-dynamic`, no `unsafe-inline`; `object-src 'none'`; `frame-ancestors 'none'` (except the collab/embed surfaces); `base-uri 'none'`; `form-action 'self'`.
- Trusted Types on the web app; any `innerHTML` is banned by lint.
- `Permissions-Policy` denies camera/mic/geolocation unless a feature needs them.
- Cross-origin isolation only where needed (not globally — it breaks third-party embeds).

**CSRF & origins**

- **Route the API on the same registrable domain as the web app** (`https://app.<domain>/api/*`, `/ws`, `/mcp` proxied at the edge) rather than a cross-site subdomain. This avoids third-party-cookie blocking (Safari ITP and friends), keeps cookies first-party, and simplifies CSP and CORS.
- Cookie auth is `SameSite=Lax` **plus** an `Origin`/`Fetch-Metadata` check **plus** a required custom header (`X-Huriro-Client`) on every state-changing request. SameSite is defense in depth, never the only control.
- If a separate API origin is ever required (e.g. for a partner integration), CORS uses an exact origin allowlist with credentials, never `*`.
- **Never host user-uploaded content on a sibling subdomain of the app** — a compromised file origin would share the registrable domain. User content lives on a dedicated cookieless origin with its own CSP.

**SSRF**

- Link unfurling and webhook delivery go through an egress proxy that: resolves DNS once, blocks private/link-local/loopback/metadata ranges (including IPv6 equivalents), rejects non-http(s), follows at most 3 redirects with the same validation, caps response size and time, and strips credentials.
- Provider webhooks (GitHub, mail) are verified by signature, not by source IP.

**Uploads**

- Size/type limits per purpose; MIME determined by content sniffing (magic bytes), not the client header.
- Images re-encoded server-side (strips EXIF, kills polyglot payloads); SVG sanitized or rendered to raster; HTML never served inline.
- ClamAV scan in quarantine when the `clamav` profile is enabled; `scan_status` gates download. Without it, files are marked `unscanned`, are always served as attachments (never previewed inline except re-encoded images), and the admin health page recommends enabling scanning.
- Object keys are opaque (`ws/<id>/<uuid>`), never user-supplied paths.
- Separate origin/CDN with `Content-Security-Policy: sandbox` and `Content-Disposition: attachment` for all user content.

**Injection**

- Parameterized SQL only; the ORM's template tag is the single allowed path.
- HTML sanitization allowlist for all rendered user content (docs, comments, mail bodies) with a maintained library and a fuzz corpus.
- Markdown rendered through a hardened pipeline (no raw HTML by default; opt-in per workspace).
- No `eval`, no `new Function`, no dynamic `require` from user input.

### 12.7 Secrets and cryptography

| Secret                                | Storage                                | Notes                                                                                                         |
| :------------------------------------ | :------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| DB/Redis/S3 credentials               | Platform secret store / Docker secrets | Rotated quarterly; file-based injection preferred                                                             |
| Session signing keys                  | Env/KMS                                | Rotation with overlap (old key verifies, new key signs)                                                       |
| OAuth client secrets (mail providers) | Env                                    | Never in DB                                                                                                   |
| Third-party user tokens (Gmail/Graph) | **Encrypted at rest** in DB            | Envelope encryption: per-workspace DEK wrapped by a KMS KEK; AES-256-GCM with AAD = `workspace_id:account_id` |
| API keys                              | Argon2id hash + prefix lookup          | Never recoverable                                                                                             |
| Backups                               | Encrypted (pgBackRest/AES-256)         | Keys held separately from the backup bucket                                                                   |
| AI provider keys                      | Env/secret store                       | Per-workspace BYO-key option, encrypted like mail tokens                                                      |

**Crypto rules:** never invent primitives; use libsodium/WebCrypto/Node `crypto` with AES-GCM or XChaCha20-Poly1305; random IVs; authenticated associated data tying ciphertext to its tenant and purpose; key rotation is a documented runbook with a re-encrypt job.

### 12.8 Audit logging

Emitted for: authentication events, membership/role changes, permission grants/revocations, API key lifecycle, data export/deletion, mail account connect/disconnect, MCP token issuance/use of write tools, admin impersonation (if ever added), and all bulk/batch operations. Each entry includes actor (human/agent/key), target, IP hash, user agent, and a correlation id — immutable (append-only table, no UPDATE grant for the app role beyond nothing).

### 12.9 Rate limiting and abuse

| Scope                                      | Default                                       | Mechanism                      |
| :----------------------------------------- | :-------------------------------------------- | :----------------------------- |
| Anonymous endpoints (login, signup, reset) | 10/min per IP + per account                   | Token bucket in Postgres/Redis |
| Authenticated API                          | 600 req/min per user, 3,000/min per workspace | Sliding window                 |
| Expensive endpoints (search, export, AI)   | Per-workspace quota + concurrency cap         | Semaphore + quota              |
| WebSocket messages                         | 60/min per socket                             | Token bucket, close on abuse   |
| Mail send                                  | Provider limits + per-workspace cap           | Queue with backpressure        |
| MCP tool calls                             | Per-token, per-tool quotas                    | Gateway-enforced               |

Limits return `429` with `Retry-After` and `RateLimit-*` headers. Every limiter has a bypass for signed internal calls and a kill switch.

### 12.10 Container and host hardening

- Non-root UID, read-only root filesystem, `no-new-privileges`, dropped capabilities, tmpfs for `/tmp`.
- Distroless or minimal runtime images, pinned **by digest**.
- No Docker socket mount in application containers.
- Separate networks: `edge` (Traefik), `app` (API/worker/realtime), `data` (Postgres/Redis), `mail`.
- Postgres is **not** reachable from `edge`.
- Mail ports (25/465/587/993) are published only if the embedded mail module is enabled, and only on the mail host with explicit egress/ingress rules.

---

## 13. AI Agents & MCP

### 13.1 Position

The MCP server is a **first-class product surface**: it must be secure enough to let a customer point Cursor at their workspace without fear, and limited enough that a prompt-injected email cannot exfiltrate the company's specs.

### 13.1a Agent-native architecture (added in v1.1)

MCP is one _transport_ for agents, not the whole story. Five properties make Huriro genuinely good to work with for agents — external ones (Claude, Cursor, Devin, Codex) and the built-in assistant alike:

| Property                  | Design                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One tool registry**     | Each capability is defined once in `packages/agent-tools`: name, description written for models, TypeBox input/output schema, required scope, risk tier (§13.5), and a handler that calls a module _service_ with an `ActorContext`. The registry generates the MCP tool list, the CLI subcommands, the OpenAPI operations for "agent" endpoints, and the in-app assistant's tools. No tool can bypass the policy layer because tools never touch repos. |
| **Agents are principals** | `agent_principals` (§8.3) — named, badged, owned by an accountable human, with a scope ceiling. An agent can be **assigned an issue**, @mentioned in a comment or thread, and subscribed to a project; it shows up in activity feeds as itself ("Claude · on behalf of Ana"), never impersonating a person.                                                                                                                                              |
| **Work hand-off**         | Assigning an issue to an agent creates an `agent.task.assigned` event. Agents pick work up by polling `tasks.my_queue`, by MCP `subscriptions/listen` (resource change notifications), or by a signed webhook. Progress is posted as structured activity (`agent.status`: working / needs input / done / failed) with links to PRs or docs, so humans see agent work in the same timeline as human work.                                                 |
| **Model-legible content** | Every entity has a canonical **Markdown representation** (`GET /api/v1/issues/ENG-142.md`, `…/docs/<slug>.md`) with front-matter for metadata, exposed as MCP resources under `huriro://` URIs. Stable short identifiers (`ENG-142`) are accepted everywhere a UUID is. Public docs ship `llms.txt`. Errors are RFC 9457 with machine-readable `code`s and a hint on how to recover.                                                                     |
| **CLI for coding agents** | `huriro` (MIT, generated from OpenAPI): `huriro issue view ENG-142 --md`, `huriro issue comment`, `huriro doc get`, `--json` on every command, device-flow login, non-interactive mode for CI. Coding agents in a terminal are more reliable with a CLI than with a remote MCP server, so we support both.                                                                                                                                               |

### 13.2 Protocol baseline

- **Transport:** MCP **Streamable HTTP** (POST-only) served on the **same origin under `/mcp`** (with a dedicated `mcp.<domain>` alias available for clients that require a distinct resource). All requests are stateless — no session id, no GET stream.
- **Spec version:** target **MCP `2026-07-28`**. Key properties of that revision: the protocol is **stateless**, server-initiated requests (elicitation/sampling) are replaced by **multi round-trip requests** (`InputRequiredResult`), **Dynamic Client Registration is deprecated in favour of Client ID Metadata Documents**, and servers **MUST** implement **RFC 9728** protected-resource metadata with strict token-audience validation. Support the previous revision (`2025-11-25`) only if a real client requires it; otherwise reject with a clear version error. Pin the revision in code and re-verify at build time.
- **Discovery:** publish `/.well-known/oauth-protected-resource` so clients can locate the authorization server.
- **Authorization:** act as an **OAuth 2.1 authorization server** with **PKCE (S256)**, exact redirect-URI matching, **RFC 8707 resource indicators** (token audience-bound to the MCP resource), **RFC 9207 `iss`** for mix-up defense, and rotating refresh tokens. Prefer **CIMD** for client registration; keep DCR off unless a client cannot do otherwise.
- **No token passthrough, ever.** A presented token is validated for _our_ audience; we never forward a client token upstream. Tokens never appear in query strings.
- **Confused deputy defense:** every tool call resolves permissions from the **consenting user**, not "the client", and re-checks membership at call time because claims go stale. Per-client consent is recorded and revocable.
- **SSRF hygiene for discovery:** CIMD/metadata fetches go through the egress proxy with private-range blocking and redirect re-validation.

### 13.3 Token model

| Concept     | Value                                                                                                                                                                                                                                              |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token types | Short-lived access token (15 min) + rotating refresh token                                                                                                                                                                                         |
| Binding     | `sub` = consenting user, `act` = agent principal id (RFC 8693-style actor claim), `wid` = workspace, `scopes` = explicit tool scopes, `aud` = MCP resource. Effective permission = token scopes ∩ agent scope ceiling ∩ user's current permissions |
| Scopes      | `tasks.read`, `tasks.write`, `docs.read`, `docs.write`, `chat.read`, `mail.read`, `mail.draft`, `search.read`, `members.read`                                                                                                                      |
| Defaults    | Read scopes only. Write scopes require explicit opt-in in the consent screen.                                                                                                                                                                      |
| Lifetime    | User-revocable at any time from _Settings → Connected apps_, with a visible last-used timestamp                                                                                                                                                    |
| Audit       | Every tool call logged with token id, user, tool, arguments hash, and result status                                                                                                                                                                |

### 13.4 Tool surface (v1)

| Tool                                    | Scope         | Side effect                            | Risk tier (§13.5)                                     |
| :-------------------------------------- | :------------ | :------------------------------------- | :---------------------------------------------------- |
| `workspace.describe`                    | any           | none                                   | R0                                                    |
| `tasks.search` / `tasks.get`            | `tasks.read`  | none                                   | R0                                                    |
| `tasks.my_queue`                        | `tasks.read`  | none — issues assigned to _this agent_ | R0                                                    |
| `tasks.create` / `tasks.update`         | `tasks.write` | creates / modifies                     | R1 (elicitation)                                      |
| `tasks.comment` / `tasks.report_status` | `tasks.write` | creates activity                       | R1                                                    |
| `tasks.bulk_update`                     | `tasks.write` | modifies > 20                          | R2 (Huriro approval)                                  |
| `docs.search` / `docs.get`              | `docs.read`   | none                                   | R0                                                    |
| `docs.append` / `docs.create`           | `docs.write`  | modifies via the collab room (§10.2)   | R1                                                    |
| `chat.read_thread`                      | `chat.read`   | none                                   | R0                                                    |
| `search.unified`                        | `search.read` | none                                   | R0                                                    |
| `mail.search` / `mail.get_thread`       | `mail.read`   | none                                   | R0                                                    |
| `mail.draft_reply`                      | `mail.draft`  | creates **draft only**                 | R1 — sending is always a human action (R2 at minimum) |
| `approvals.status`                      | any           | none — polls an approval handle        | R0                                                    |

All tool _results_ are paginated, size-capped, returned as Markdown + structured content, and tagged `trust: "untrusted"` where they contain user/customer-authored text (§13.6).

**Hard rule: no tool sends email, posts chat publicly, deletes, or grants permissions without a human action in the Huriro UI.** The MCP server can prepare; people commit.

### 13.5 Confirmation and elicitation

For write tools, the flow uses the protocol's **multi round-trip request** pattern (no server-initiated session state):

```text
Agent → tools/call tasks.create
Server → no write yet (returns InputRequiredResult):
   • validates args against the tool schema
   • renders a preview ("Create ENG-231 'Rate limit retries' in Project X, assigned to A. Doe?")
   • asks for approval (elicitation)
Human → approves in the client
Server → executes the write with an idempotency key, returns the entity + deep link
```

Preview rendering happens **server-side** so the human sees what the server will actually do, not the model's description of it. Tool annotations (`readOnlyHint`, `destructiveHint`) are set honestly but are **hints only** — authorization never depends on them.

**An in-client confirmation is not proof that a human approved (changed in v1.1).** Elicitation is answered _by the MCP client_; a buggy, compromised, or "auto-approve" client can answer on its own, and the server cannot tell. Approval strength therefore scales with risk:

| Risk tier                                 | Examples                                                                                         | Approval                                                                                                                                                                                                                                                                  |
| :---------------------------------------- | :----------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R0 read**                               | search, get, list                                                                                | None (scope check only)                                                                                                                                                                                                                                                   |
| **R1 reversible, internal**               | create/update issue, comment, append to doc, draft a reply                                       | In-client elicitation is sufficient; every write is undoable from the activity feed for 7 days and attributed to the agent                                                                                                                                                |
| **R2 externally visible or hard to undo** | send email, post in a channel with guests, bulk edits (> 20 entities), close/merge conversations | **Out-of-band approval in Huriro** — the tool returns `approval_required` with a handle and a deep link (and uses URL-mode elicitation where the client supports it); a human approves in the Huriro _Approvals_ view (web or push on mobile); the agent polls the handle |
| **R3 privileged**                         | delete, permissions/ACL changes, member management, API key or webhook creation                  | **Not exposed to agents in v1**                                                                                                                                                                                                                                           |

Workspace admins can raise (never lower) the tier of any tool, and can require R2 approval for all writes by a given agent.

### 13.6 Prompt injection: the core threat

Workspace content — especially **email** and pasted documents — is attacker-controlled. The defensive posture:

1. **Data/policy separation.** Retrieved content is inserted in a delimited block; the system prompt states plainly that instructions inside content are data, never commands.
2. **Least privilege by tool.** Read-only tokens by default; a summarizer agent that only needs `mail.read` never gets `mail.draft`.
3. **No exfiltration channels.** The MCP server cannot fetch model-generated URLs; images in tool results are proxied; markdown links are rendered as text with a destination warning. Combined with (2), this neutralizes the "lethal trifecta" of private data + untrusted content + outbound channel.
4. **Human-in-the-loop for outbound actions** (§13.5) — the single most effective control.
5. **Content provenance.** Tool results carry `trust: "untrusted"` metadata; the gateway quotes such content and strips instruction-like formatting where it can (defense in depth, not a silver bullet).
6. **Rate/volume limits** on tool calls and on the total content a single session may read, so exfiltration is slow and detectable.
7. **Anomaly alerts:** a workspace admin can see tool-call volume by client and revoke.

### 13.7 MCP operational requirements

- Tool schemas are versioned with the API; breaking a tool schema is a versioned change with deprecation notices.
- Structured output + a documented error contract (`isError`, machine-readable codes).
- Tool call timeouts (default 30 s), max result sizes (default 256 KB, paginated beyond), and cancellation support.
- Per-token concurrency caps to prevent a runaway agent from exhausting the API.
- The MCP endpoint is rate-limited independently of the REST API and can be disabled per workspace by policy.

---

## 14. Mail (Shared Inbox)

### 14.1 The decision that shapes everything

The original sketch made **Stalwart the system of record**. Two facts make that untenable as the default:

1. **Stalwart 1.0 is two weeks old** (1.0.0 released 2026-10-26, 1.1.0 on 2026-11-09) and, critically, **multi-tenancy is an Enterprise-license feature**. Running one shared mail server for all workspaces would mean either paying an enterprise license on every self-hosted install or weakening tenant isolation to application code.
2. **Deliverability is the hardest part of email**, and it is not our differentiator: cold IPs, port 25 blocks at most providers, DMARC alignment, complaint-rate thresholds, and Google's bulk-sender rules.

**Therefore: Huriro owns the canonical message store; mail providers are adapters.**

```text
                  ┌──────────────── MailProvider interface ────────────────┐
                  │ inbound-route · gmail · graph · imap · jmap (Stalwart) │
                  └───────────────▲───────────────────────┬────────────────┘
    webhook / poll / Pub/Sub      │                       │ send (or hand to provider)
                                  │                       ▼
  ┌──────────────┐   raw MIME  ┌──┴───────────────┐  ┌──────────────────┐
  │ S3: raw/     │◀────────────│  mail sync       │─▶│ outbound queue   │
  │ (immutable)  │             │  worker          │  │ (DKIM, retries)  │
  └──────────────┘             └──┬───────────────┘  └──────────────────┘
                                  │ parse (sandboxed, limits)
                                  ▼
                       Postgres: conversations · messages · drafts
                                  │
                                  ▼
                         search index + embeddings
```

### 14.2 Phased provider strategy (ADR-0011)

| Phase                               | What ships                                                                                                                                           | Why                                                                                                  |
| :---------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| **1**                               | **Forwarding address + inbound-parse webhook**; outbound via managed relay (SES/Postmark/Resend) with a per-customer domain verification + DKIM flow | Fastest time-to-value, no IP reputation work, no port 25 dependency                                  |
| **2**                               | **Connected mailboxes**: Gmail API (Pub/Sub push), Microsoft Graph (change notifications + lifecycle), generic IMAP (`imapflow` + IDLE/poll)         | Replies go out through the customer's own provider → best deliverability, no sending reputation risk |
| **3** (optional, self-host profile) | **Stalwart adapter** over JMAP, pinned to a supported minor version, enterprise-only features avoided                                                | Self-hosters who want a fully contained mailbox; never the default, never the system of record       |

Notable constraints to plan around: Gmail restricted scopes require OAuth verification and (for stored data) a security assessment; Graph subscriptions must be renewed and need lifecycle notifications to recover from missed events; Exchange Online is OAuth-only. Each is a checklist item in §23's mail phase, not a surprise.

**Self-host note:** on self-host, "managed relay" means whatever SMTP the operator configures (SES, Postmark, their own server) — phase 1 needs no vendor approval at all. Generic IMAP also ships in phase 2 regardless of Google/Microsoft verification status, so self-hosted instances get connected mailboxes even while cloud OAuth verification is pending.

### 14.3 Schema (replacing the invalid original)

```sql
CREATE TABLE mail_accounts (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider      text NOT NULL,             -- inbound_parse | gmail | graph | imap | jmap
    address       citext NOT NULL,
    display_name  text,
    secret_ref    text,                      -- pointer to encrypted credential row
    config        jsonb NOT NULL DEFAULT '{}'::jsonb,
    sync_state    jsonb NOT NULL DEFAULT '{}'::jsonb,
    status        text NOT NULL DEFAULT 'active',   -- active | error | disconnected
    last_synced_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, address)
);

CREATE TABLE mail_inboxes (                        -- shared inbox grouping (e.g. "Support", "Sales")
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          text NOT NULL,
    position      text NOT NULL,
    settings      jsonb NOT NULL DEFAULT '{}'::jsonb   -- routing, SLA, default assignee
);

CREATE TABLE mail_conversations (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    inbox_id       uuid NOT NULL REFERENCES mail_inboxes(id) ON DELETE CASCADE,
    subject        text NOT NULL,
    status         text NOT NULL DEFAULT 'open',   -- open | pending | snoozed | closed | spam
    assignee_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    snoozed_until  timestamptz,
    merged_into_id uuid REFERENCES mail_conversations(id) ON DELETE SET NULL,
    last_message_at timestamptz NOT NULL,
    first_reply_at timestamptz,                    -- for response-time metrics
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    version        int NOT NULL DEFAULT 1
);
CREATE INDEX idx_conv_inbox ON mail_conversations (workspace_id, inbox_id, status, last_message_at DESC);

CREATE TABLE mail_messages (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    account_id     uuid NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    direction      text NOT NULL,                  -- inbound | outbound
    rfc_message_id text,                           -- from the MIME headers
    in_reply_to    text,
    references_ids text[] NOT NULL DEFAULT '{}',   -- RFC 5322 References header ("references" is a reserved word in SQL)
    from_addr      jsonb NOT NULL,                 -- {name,email}
    to_addrs       jsonb NOT NULL DEFAULT '[]'::jsonb,
    cc_addrs       jsonb NOT NULL DEFAULT '[]'::jsonb,
    subject        text,
    sent_at        timestamptz,
    received_at    timestamptz NOT NULL DEFAULT now(),
    raw_blob_key   text NOT NULL,                  -- S3 key of immutable raw MIME
    body_html      text,                           -- sanitized for display
    body_text      text,
    auth_results   jsonb,                          -- SPF/DKIM/DMARC verdicts
    provider_ref   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- cache only; never a key
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_msg_dedupe
    ON mail_messages (workspace_id, account_id, rfc_message_id)
    WHERE rfc_message_id IS NOT NULL;

CREATE TABLE mail_conversation_events (              -- the timeline: assignment, status, merges, links
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    kind            text NOT NULL,               -- assigned | status_changed | merged | linked | snoozed
    actor_id        uuid REFERENCES users(id),
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mail_conversation_comments (             -- internal notes (never sent)
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    author_id       uuid NOT NULL REFERENCES users(id),
    body            jsonb NOT NULL,              -- rich text
    mentions        uuid[] NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mail_drafts (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_id   uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    identity_id       uuid NOT NULL,             -- from-address + signature
    created_by        uuid NOT NULL REFERENCES users(id),
    last_edited_by    uuid REFERENCES users(id),
    body              jsonb NOT NULL,            -- collaborative body (Yjs state ref)
    recipients        jsonb NOT NULL,
    in_reply_to_id    uuid REFERENCES mail_messages(id),
    scheduled_send_at timestamptz,
    status            text NOT NULL DEFAULT 'draft', -- draft | sending | sent | discarded
    sent_message_id   uuid REFERENCES mail_messages(id),
    locked_by         uuid REFERENCES users(id), -- soft lock for "X is editing"
    locked_until      timestamptz,
    version           int NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Links are real relations, not nullable columns in a primary key.
CREATE TABLE mail_conversation_tasks (
    workspace_id    uuid NOT NULL,
    conversation_id uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    task_id         uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, task_id)
);

CREATE TABLE mail_conversation_docs (
    workspace_id    uuid NOT NULL,
    conversation_id uuid NOT NULL REFERENCES mail_conversations(id) ON DELETE CASCADE,
    page_id         uuid NOT NULL REFERENCES doc_pages(id) ON DELETE CASCADE,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, page_id)
);
```

**Why `provider_ref` is only a cache:** JMAP `threadId`s are immutable but _mergeable only by re-inserting messages with new ids_; Gmail and Graph ids differ per mailbox. Provider identifiers must never be primary keys.

### 14.4 Threading

Threading follows the RFC 8621 §3 heuristic: messages join a conversation when they share a `Message-Id` link across `In-Reply-To`/`References` **and** have an equivalent normalized subject. New messages that match nothing start a conversation. Ambiguity resolves to "new conversation" rather than "attach to the wrong customer".

### 14.5 The conversation timeline (UX contract)

A conversation shows, in one interleaved, reverse-chronological-or-threaded stream:

1. **Customer messages** (sent + received) with sanitized bodies and attachment chips.
2. **Replies** from teammates, with the sending identity and status (queued → sent → delivered/bounced).
3. **Internal notes** (visually distinct, marked "not sent").
4. **Activity events** (assigned to X, status → pending, linked to ENG-142, merged).
5. **Snooze/undo affordances** (undo-send window: default 10 s, configurable).

Collaboration affordances that matter and are cheap once sync exists: **who else is viewing** (presence), **who is typing a reply** (ephemeral), **draft lock** ("Sam is editing a reply"), and **assignee handoff notes**.

### 14.6 Rendering untrusted HTML safely

1. Parse MIME in a **worker with CPU/memory/time limits** (untrusted input).
2. Sanitize server-side with an allowlist; strip `<form>`, `<base>`, `<meta http-equiv>`, `@import`, `javascript:` and `data:` (except safe image types).
3. Render in a **sandboxed iframe with no `allow-scripts`**, on a **separate origin**, with a strict CSP.
4. **Block remote images by default**; when the user opts in, proxy them through a signed image proxy that strips tracking pixels.
5. **Rewrite links** through an interstitial that shows the real destination and flags punycode/IDN lookalikes.
6. Surface **authentication results**: SPF, DKIM, DMARC verdicts ("this sender failed DMARC") in the message header.
7. Attachments: quarantine → ClamAV → promote; `Content-Disposition: attachment`; separate origin.

### 14.7 Compliance and retention

Mail is the highest-risk data class in the product. Requirements: configurable retention per workspace, legal hold (Phase 5), export (EML + JSON), deletion propagation across raw blobs, derived rows, search index, and AI caches, and a documented backup-retention window (deleted data may persist in backups for N days — stated in the DPA).

---

## 15. Chat, Notifications & Presence

### 15.1 Chat model

| Concept       | Design                                                                                                                                                                                                                                                                                                                                                                                                                         |
| :------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channels      | Public (workspace-visible) and private (ACL-gated). Membership is a table, not a policy string.                                                                                                                                                                                                                                                                                                                                |
| DMs           | Modeled as a 2–8 member channel with `kind = 'dm'` — one code path for ordering, pagination, and read state                                                                                                                                                                                                                                                                                                                    |
| Threads       | `thread_parent_id` (self-FK) with denormalized `reply_count`/`last_reply_at` maintained by trigger                                                                                                                                                                                                                                                                                                                             |
| Messages      | Markdown subset rendered through the same sanitizer as docs. Chat is **not** in the workspace `change_log` (its write rate would serialize the whole workspace, §9.2); it has its own **per-channel feed** instead (below)                                                                                                                                                                                                     |
| Ordering      | Two per-channel counters on the channel row, both allocated with the `UPDATE … RETURNING` trick: **`last_msg_seq`** gives every _top-level_ message an immutable `channel_seq` (display order, pagination, unread math); **`last_rev`** is bumped by _every_ change in the channel (new message, thread reply, edit, delete, reaction) and stamped on the row as `rev`. Thread replies get a `thread_seq` within their parent. |
| Channel feed  | `GET /api/v1/chat/channels/:id/changes?since=<rev>` returns rows with `rev > since` (index on `(channel_id, rev)`), tombstones included. The socket signal is `{ t: "chat", channelId, rev }`, sent only to members' sockets. Clients keep one `rev` cursor per _open or recently viewed_ channel and a cheap per-channel `last_msg_seq` summary for the sidebar.                                                              |
| Attachments   | `files` rows linked via `message_attachments`, uploaded through the quarantine flow                                                                                                                                                                                                                                                                                                                                            |
| Link previews | Async unfurl via the SSRF-safe egress proxy; cached with TTL; never blocks send                                                                                                                                                                                                                                                                                                                                                |
| Rich links    | Typed inline nodes for `issue:`, `doc:`, `conversation:` mentions rendered live (title/status/assignee) so pasted links stay useful                                                                                                                                                                                                                                                                                            |
| Reactions     | Separate small table, aggregate counts materialized per message                                                                                                                                                                                                                                                                                                                                                                |

```sql
CREATE TABLE chat_channels (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind         text NOT NULL DEFAULT 'public',   -- public | private | dm
    name         text,                             -- null for DMs
    topic        text,
    last_msg_seq bigint NOT NULL DEFAULT 0,        -- top-level message order counter
    last_rev     bigint NOT NULL DEFAULT 0,        -- channel change-feed counter (every change)
    created_by   uuid NOT NULL REFERENCES users(id),
    archived_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name),
    UNIQUE (workspace_id, id)
);
-- Sidebar order is per user (chat_channel_members.position), not a property of the channel.

CREATE TABLE chat_channel_members (
    workspace_id uuid NOT NULL,
    channel_id   uuid NOT NULL,
    principal_type text NOT NULL DEFAULT 'user',   -- 'user' | 'agent'
    principal_id uuid NOT NULL,
    role         text NOT NULL DEFAULT 'member',   -- member | admin
    position     text COLLATE "C",                 -- personal sidebar order (fractional index)
    joined_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, principal_type, principal_id),
    FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE chat_messages (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id   uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    channel_seq  bigint,                            -- set for top-level messages only
    thread_seq   bigint,                            -- set for thread replies only (order within parent)
    rev          bigint NOT NULL,                   -- channel last_rev at last change (feed cursor)
    CHECK ((thread_parent_id IS NULL) = (channel_seq IS NOT NULL)),
    author_id    uuid NOT NULL REFERENCES users(id),
    thread_parent_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
    client_id    text,                              -- client-generated dedupe id
    body         jsonb NOT NULL,                    -- rich text
    body_text    text NOT NULL,                     -- extracted, for search + notifications
    edited_at    timestamptz,
    deleted_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    version      int NOT NULL DEFAULT 1,
    UNIQUE (channel_id, channel_seq),
    UNIQUE (thread_parent_id, thread_seq)
);
CREATE INDEX idx_messages_chan_seq ON chat_messages (workspace_id, channel_id, channel_seq DESC)
    WHERE deleted_at IS NULL AND thread_parent_id IS NULL;
CREATE INDEX idx_messages_chan_rev ON chat_messages (channel_id, rev);   -- channel change feed
CREATE UNIQUE INDEX uq_messages_client ON chat_messages (workspace_id, channel_id, author_id, client_id)
    WHERE client_id IS NOT NULL;

CREATE TABLE chat_read_state (
    workspace_id uuid NOT NULL,
    channel_id   uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_seq bigint NOT NULL DEFAULT 0,
    mention_count int NOT NULL DEFAULT 0,
    muted        boolean NOT NULL DEFAULT false,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, user_id)
);
```

**Send path:** client generates a `client_id` (uuidv7), appends optimistically, sends. The unique index on `client_id` makes retries safe; the response is matched back to the optimistic row. Messages are **immutable in order** (`channel_seq` from the server) — the client re-sorts after confirmation, which is why the optimistic row fades rather than jumps.

**Unread state, without per-message rows:** "has unread" is the O(1) comparison `channel.last_msg_seq > read.last_read_seq` (muted channels excluded). Posting advances the author's own `last_read_seq`, so your own messages never count. The badge _number_ is an indexed count of non-deleted top-level messages with `channel_seq > last_read_seq`, capped at 100 ("99+") — exact, and cheap because it walks at most 100 index entries. `mention_count` is maintained atomically by the notification consumer. Thread replies are tracked per followed thread (`chat_thread_read_state`), not in the channel badge.

**Pagination:** cursor-based on `channel_seq` descending. No offset pagination anywhere in the product.

### 15.2 Presence, typing, read state

| Signal                                 | Storage                                                                              | Lifetime                   |
| :------------------------------------- | :----------------------------------------------------------------------------------- | :------------------------- |
| Online/away                            | Realtime in-memory + Redis with TTL                                                  | Ephemeral (30 s heartbeat) |
| Typing                                 | Realtime only, never persisted                                                       | 5 s                        |
| Viewing (mail/doc collision detection) | Realtime only                                                                        | 30 s                       |
| Read cursor per channel                | Postgres `chat_read_state(channel_id, user_id, last_read_seq, mention_count, muted)` | Durable                    |
| Unread counts                          | Derived, never stored per message (§15.1)                                            | Durable                    |

**Rule: presence is never a database row.** Storing it creates write amplification and stale state. Unread state is derived from sequence numbers, so it cannot drift.

**Notification wake-ups use `LISTEN/NOTIFY` only as a signal, never as transport.** Notify payloads are capped (~8 KB) and a full queue can fail the _committing_ transaction, so the payload is a tiny id and the consumer reads the real data. For multi-instance fan-out use Valkey pub/sub. Notify also historically serialized commits under many writers, so never put it on a hot write path without load-testing the actual version in use.

**Notification fan-out** (on `message.created`):

1. Resolve recipients: channel members minus author, minus muted, minus blocked.
2. Apply rules: direct mention always notifies; thread replies notify thread participants; channel messages notify per user preference (all / mentions / none).
3. Write `notifications` rows + increment unread counters.
4. Dispatch by channel: in-app (socket), email digest (batched, with quiet hours), push (respecting OS-level and per-workspace settings).
5. Collapse duplicates within a window ("3 new messages in #api-design").

---

## 16. API Design & Contracts

### 16.1 Conventions

| Concern            | Decision                                                                                          |
| :----------------- | :------------------------------------------------------------------------------------------------ |
| Base path          | `/api/v1` (proxied on the app origin)                                                             |
| Style              | REST for resources; **batch endpoints** for multi-entity reads; no GraphQL in v1                  |
| IDs                | uuidv7 strings in URLs; never expose sequential integers                                          |
| Auth headers       | Cookie (web) or `Authorization: Bearer` (native/keys); `X-Workspace-Id` for multi-workspace users |
| Content type       | `application/json`; `application/problem+json` for errors                                         |
| Versioning         | URL major version (`/v1`), additive-only changes within it, deprecation headers (§16.7)           |
| Idempotency        | `Idempotency-Key` on all non-idempotent writes (draft-ietf-httpapi standard semantics)            |
| Concurrency        | `If-Match`/`ETag` on mutable resources; `409` on version mismatch                                 |
| Pagination         | Cursor-based: `?limit=&cursor=`, response `{ data, nextCursor, hasMore }`                         |
| Filtering          | Explicit, typed query params; no arbitrary query language on public endpoints                     |
| Sorting            | Allowlisted fields only, always with a deterministic tiebreaker (`id`)                            |
| Partial responses  | `?fields=` allowlist on heavy list endpoints (never `SELECT *` semantics)                         |
| Rate limit headers | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`                                       |

### 16.2 Error contract

```json
{
	"type": "https://docs.huriro.app/errors/stale-version",
	"title": "The resource changed since you loaded it",
	"status": 409,
	"code": "stale_version",
	"detail": "Issue ENG-142 was updated by another user.",
	"instance": "/api/v1/issues/019a…",
	"requestId": "req_01J…",
	"currentVersion": 8,
	"yourVersion": 7
}
```

- RFC 9457 Problem Details shape, extended with a stable machine-readable `code` and `requestId`.
- **Never leak internals:** no stack traces, SQL, or provider messages in production responses (logged with `requestId` instead).
- Every error code is enumerated in `packages/contracts/errors.ts` with a doc URL, so clients can localize.

### 16.3 Batch and sync endpoints

| Endpoint                               | Purpose                                                                          |
| :------------------------------------- | :------------------------------------------------------------------------------- |
| `GET /api/v1/sync/changes?since=`      | Incremental changes (§9.3)                                                       |
| `GET /api/v1/sync/snapshot?resources=` | Full resync after `410 Gone`                                                     |
| `POST /api/v1/batch`                   | Up to 20 reads in one round trip (fixed cost; used on cold start)                |
| `POST /api/v1/mutations`               | Optionally batch several mutations atomically across entities the user can write |

### 16.4 Typed clients

- **Eden Treaty** for first-party TypeScript clients (web, mobile) — zero codegen, compile-time safety.
- **Generated OpenAPI 3.1** from the same TypeBox schemas, used for: external SDKs, MCP tool schemas, and a **contract test** that diffs the generated spec against a snapshot (breaking change = CI failure unless explicitly approved).
- Hand-written SDKs are forbidden.

### 16.5 Webhooks (outbound, for integrators)

- Subscribed per workspace, signed with HMAC-SHA256 (`X-Huriro-Signature` + timestamp to prevent replay), retried with exponential backoff for 24 h, with a delivery log and manual replay.
- Payloads are the same event DTOs used internally, versioned.

### 16.6 GitHub integration

- GitHub App (not OAuth app) with least-privilege permissions: `issues:write`, `pull_requests:read`, `contents:read` (for link previews only).
- Webhook receiver verifies `X-Hub-Signature-256`, stores raw payload, enqueues, returns `202` immediately.
- Two-way sync uses a **link table** (`issue_github_links`) with remote ids and a `last_synced_at`/`source_of_truth` field to prevent echo loops.
- Outbound updates to GitHub are queued and rate-limit aware; a failed push surfaces as an inline warning on the issue, never silently dropped.

### 16.7 Versioning and deprecation

1. Additive changes (new fields, new endpoints) ship freely.
2. Breaking changes require a **new URL version** or an explicit opt-in header, a 90-day overlap, `Sunset`/`Deprecation` headers, and telemetry showing remaining usage.
3. Removed endpoints return `410` with a link to the migration guide for 30 days beyond sunset.

---

## 17. UI/UX System

> The product's differentiator is not the feature list — competitors have the same features. It is **speed of thought**: the app must feel like a native instrument. Every decision below serves that.

### 17.1 Experience principles

1. **Latency is a design material.** Local writes render in ≤ 1 frame; nothing waits on the network that the user already knows the answer to. (NN/g's 0.1 s "instantaneous", 1 s "flow", 10 s "attention" limits are the budget, see Appendix B.)
2. **Density with air.** Show more per screen, but with a strict rhythm: one dominant column, one subordinate panel, generous line height in prose, tight rows in tables.
3. **Keyboard is the primary input; pointer is the discovery mechanism.** Every action reachable by keyboard, every shortcut discoverable in the UI (not buried in docs).
4. **One canonical place per concept.** Inbox is _your_ triage, Issues is issues, Docs is docs, Chat is chat. Cross-linking is a feature; duplication of surfaces is not.
5. **Optimistic, reversible, explained.** Every mutation is instant, undoable where feasible (`Mod+Z` toast with 5 s window), and failures are specific.
6. **No dead ends.** Every empty state teaches; every error offers a next step; every permission denial explains who can grant it.
7. **Respect the user's context.** Restore scroll, filters, and open panels on back navigation; never reset the nav stack.
8. **Accessible by construction, not audit.** WCAG 2.2 AA is the floor, built into components, not patched later.

### 17.2 Information architecture

```text
Workspace
├── Inbox        (two sidebar groups:
│                  For me  — notifications · mentions · assigned to me · agent approvals
│                  Shared  — one entry per shared mail inbox (Support, Sales…), only for its members)
├── Issues       (projects → views: Board · List · Timeline · Backlog · My work)
├── Docs         (page tree; pinned/favorites; templates)
├── Chat         (channels; DMs; threads)
└── Settings     (workspace: members/roles, integrations, mail accounts,
                  AI & agents, billing · personal: profile, notifications,
                  shortcuts, appearance, connected apps)
```

Navigation laws:

- **Five primary destinations**, no more: Inbox · Issues · Docs · Chat · Settings. "My work" is a **default saved view** inside Issues (also one palette action away), not a sixth destination.
- **Personal triage and customer mail are separate groups inside Inbox** (changed in v1.1). v1.0 merged them into one list, which would bury an engineer's mentions under support traffic and show mail UI to people with no mail access. A conversation _assigned to you_ appears in both places; everything else stays in its shared inbox.
- **Agents are visible, not hidden.** Agent activity uses the same timeline components as people, with an agent badge and "on behalf of" attribution; _Inbox → For me → Approvals_ holds R2 requests (§13.5).
- **Contextual sidebar** per destination (projects list under Issues; page tree under Docs; channels under Chat) — consistent position across destinations.
- **Right panel** is reserved for _detail of the selected thing_ (issue properties, doc comments, mail metadata) and is toggleable with `Mod+J`, remembered per destination.
- **Breadcrumbs** appear once nesting exceeds two levels (Docs, settings pages).
- **Deep links everywhere:** every issue, doc, message, and conversation has a stable URL that restores the exact view.

### 17.3 App shell and layout

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ ① top bar: workspace switcher · global search (Mod+K) · create · account  │ 48px
├──────────┬───────────────────────────────────────────┬────────────────────┤
│ ② nav    │ ③ view header: title · view tabs · filters │ ④ detail panel     │
│ 220px    │───────────────────────────────────────────│ 320–420px (opt)    │
│          │ ⑤ content (virtualized lists / editor)     │                    │
│          │                                            │                    │
└──────────┴───────────────────────────────────────────┴────────────────────┘
```

- **Grid:** 4 px base unit; spacing scale 4/8/12/16/24/32/48/64. Sidebar 220–280 px (resizable, persisted), detail panel 320–420 px, content max-width 72 ch for prose, full-bleed for boards.
- **Row heights (density setting):** comfortable 36 px, compact 32 px, dense 28 px. Default compact for power users, comfortable for new users.
- **Fixed chrome, scrolling content:** sidebar and headers stay; only the content column scrolls. The tab bar is sticky and shows unsaved/pending indicators.
- **Split view:** issues can open beside the list (peek panel) on ≥ 1280 px; full-page on smaller screens. Never a modal for primary navigation.
- **Multi-tab (desktop/PWA):** tabs are a first-class concept (`Mod+T`), restoring with history and scroll position.

### 17.4 Design tokens

Single source of truth: **DTCG-format JSON** (2025.10 stable spec) in `packages/design-tokens/tokens/*.json`, compiled by Style Dictionary to:

1. `css/*.css` (CSS custom properties),
2. `tailwind/theme.css` (`@theme` block for Tailwind v4 utilities),
3. `rn/theme.ts` (React Native theme object),
4. `docs/tokens.html` (a living reference page).

**Color model:** OKLCH for perceptual uniformity — lightness steps look even across hues, and a dark theme is a lightness remap rather than an inversion. Semantic layers, never raw palette values in components:

```css
@import "tailwindcss";

/* Layer 1 — primitives (raw ramp, generated in OKLCH) */
@theme {
  --color-brand-50:  oklch(0.97 0.02 265);
  --color-brand-500: oklch(0.62 0.19 265);
  --color-brand-600: oklch(0.55 0.20 265);
  --color-neutral-0: oklch(1.00 0 0);
  --color-neutral-50: oklch(0.98 0.002 265);
  /* … */
}

/* Layer 2 — semantic roles (what components use) */
@theme inline {
  --color-surface-0: var(--color-neutral-0);
  --color-surface-1: var(--color-neutral-50);
  --color-surface-2: var(--color-neutral-50);
  --color-ink-primary: oklch(0.24 0.01 265);
  --color-ink-secondary: oklch(0.45 0.01 265);
  --color-ink-tertiary: oklch(0.58 0.01 265);
  --color-border-subtle: oklch(0.92 0.005 265);
  --color-border-strong: oklch(0.84 0.006 265);
  --color-accent: var(--color-brand-600);
  --color-accent-ink: oklch(0.99 0 0);
  --color-danger: oklch(0.58 0.20 27);
  --color-success: oklch(0.60 0.15 150);
  --color-warning: oklch(0.75 0.15 80);
}

/* Layer 3 — themes are just overrides of layer 2 */
[data-theme="dark"] {
  --color-surface-0: oklch(0.19 0.006 265);
  --color-surface-1: oklch(0.22 0.007 265);
  --color-surface-2: oklch(0.26 0.008 265);
  --color-ink-primary: oklch(0.96 0.003 265);
  --color-ink-secondary: oklch(0.82 0.004 265);
  --color-border-subtle: oklch(0.30 0.008 265);
  --color-accent: oklch(0.72 0.16 265);   /* lighter for dark surfaces */
}
```

**Emit the shadcn contract, then extend it (added in v1.1).** The example above shows the _design_ layers; the build emits them under the variable names shadcn/ui components already consume — `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--chart-1…5`, `--sidebar-*` (each with its `-foreground` pair) — plus Huriro extensions (`--surface-2`, `--ink-tertiary`, `--success`, `--warning`, `--info`, density and motion tokens). Two naming traps: shadcn's `--accent` is the _hover/selected surface_, so the brand color is `--primary`, never `--accent`; and dark mode uses shadcn's `.dark` class (Tailwind v4 `@custom-variant dark`), not a `data-theme` attribute. Staying on the contract means `npx shadcn add` and registry blocks work unmodified, and the same tokens compile to the Uniwind theme for HeroUI Native.

**Contrast control:** expose a three-step _contrast_ preference (standard / high / maximum), implemented as an additional token layer (mirroring the technique of generating themes from `base`, `accent`, and `contrast` inputs). High-contrast themes are a product feature, not a niche setting — they are also the answer to 1.4.6 AAA ambitions.

**Non-color tokens:** type scale (12/13/14/16/20/24/32 with 1.25 ratio for UI, 1.5 line height for prose), radii (4/6/8/12/full), elevation (0/1/2/3 as layered shadows, not blur-only), motion (durations 120/180/240 ms; easings `standard`, `enter`, `exit`), focus ring (2 px outline, 2 px offset, 3:1 against both adjacent colors), and z-index scale (0/10/20/40/100/1000).

**Typography:** a variable UI sans (Inter-family or similar) with `font-feature-settings: "cv05","ss01","tnum"` where appropriate; **tabular figures for all IDs, counts, timestamps, and table numerics**; monospace for code and identifiers; prose measure capped at 72 ch; UI text never below 12 px with 4.5:1 contrast, body 14–16 px.

### 17.5 Component inventory (owned code, not a black-box dependency)

| Group       | Components                                                                                                                                                                                                   |
| :---------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives  | Button, IconButton, Input, Textarea, Select, Combobox, Checkbox, Radio, Switch, Slider, Tooltip, Popover, Dialog, Drawer/Sheet, Menu, ContextMenu, Tabs, Toast, Badge, Avatar, Separator, Progress, Skeleton |
| Data        | DataTable (sortable, virtualized, column resize/reorder, `aria-sort`), VirtualList, EmptyState, ErrorState, Pagination (cursor), FilterBar, FacetedFilter, Kbd                                               |
| Work        | IssueRow, IssueCard (board), Board (drag + keyboard move), Timeline (zoomable lanes), StatusPicker, AssigneePicker, LabelPicker, PriorityIcon, MentionPicker, ReactionBar                                    |
| Docs        | EditorShell, SlashMenu, FloatingToolbar, CommentThread, PresenceCursors, VersionTimeline, TocRail                                                                                                            |
| Chat        | ChannelList, MessageList (virtualized, grouped by author/time), Composer (with mentions, attachments, drafts), ThreadPanel, TypingIndicator                                                                  |
| Mail        | ConversationList, ConversationTimeline, MessageCard (sandboxed body), ReplyComposer, AssigneeControl, SnoozeMenu, CollisionAvatars                                                                           |
| Search      | CommandPalette, SearchResults (grouped, keyboard-navigable), HighlightedSnippet                                                                                                                              |
| Agents & AI | AgentBadge, AgentActivityItem, ApprovalCard (diff-style preview of what will change), AssistantPanel (built on shadcn **AI Elements**: streamed message, tool-call trace, citations), ConnectedAppsList      |
| Onboarding  | SetupWizard (instance), WorkspaceWizard, ImportFlow (source → mapping → dry-run preview → import → report), ChecklistCard                                                                                    |
| Settings    | SettingsNav, RoleMatrix, MemberTable, InviteDialog, ApiKeyList, ConnectedAppsList                                                                                                                            |

**Component contract rules:**

- Props are semantic (`tone="danger"`), never visual (`color="red"`).
- Every component documents its states: default, hover, focus-visible, active, disabled, read-only, loading, error, empty.
- Every interactive component ships with a Storybook story **and** an interaction test (Testing Library) **and** an axe assertion.
- Focus management is part of the component API (`initialFocus`, `returnFocus`), not the caller's afterthought.

### 17.6 Keyboard model

| Scope  | Shortcut                                  | Action                                                  |
| :----- | :---------------------------------------- | :------------------------------------------------------ |
| Global | `Mod+K`                                   | Command palette (search + actions)                      |
| Global | `?`                                       | Shortcut reference sheet (contextual)                   |
| Global | `Mod+J`                                   | Toggle detail panel                                     |
| Global | `C`                                       | Create in current context (issue/doc/message)           |
| Global | `G` then `I/T/D/C/S`                      | Go to Inbox / Issues / Docs / Chat / Settings           |
| Global | `Mod+Enter`                               | Submit the active form/composer                         |
| Global | `Esc`                                     | Dismiss popover/dialog/panel (in that order)            |
| Lists  | `J` / `K`                                 | Move selection down/up                                  |
| Lists  | `Enter`                                   | Open selection (peek if split view available)           |
| Lists  | `Space`                                   | Toggle select (multi-select)                            |
| Lists  | `Mod+A`                                   | Select all in view                                      |
| Board  | `H` / `L`                                 | Move card between columns (keyboard equivalent of drag) |
| Board  | `Mod+↑` / `Mod+↓`                         | Reorder within column                                   |
| Editor | `Mod+B/I/U`, `Mod+Shift+8`, `Mod+Alt+1…3` | Standard formatting                                     |
| Editor | `Mod+Shift+M`                             | Toggle comment mode                                     |

**Rules:** every shortcut is remappable and disableable (WCAG 2.1.4), single-character shortcuts never fire while typing in an input, and the palette always shows the shortcut next to the action it invokes — **discoverability is built into the UI**, not documented separately.

### 17.7 Command palette (the spine of the product)

- Opens in < 100 ms from a warm cache, first keystroke never dropped.
- Three sections in fixed order: **Actions** (create issue, assign to me, change status…), **Navigation** (jump to project/channel/page), **Content** (issues, docs, messages, people, emails).
- Typed operators: `> ` actions only, `#` channels, `@` people, `in:` project, `is:` state, `from:` sender.
- Recent items first on empty query; each row shows type icon, title, and a contextual secondary line (project key, channel, sender, timestamp).
- Fully keyboard-driven with the ARIA combobox/listbox pattern; screen-reader announcement of result count; `Esc` returns focus to the previously focused element.
- **Same component everywhere**: global palette, assignee picker, label picker, emoji picker, and mail "move to inbox" all reuse the palette/keyboard contract.

### 17.8 States: loading, empty, error, offline, permission

| State                       | Pattern                                                                                                                     |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| Cached data available       | Render immediately; no indicator at all                                                                                     |
| First-ever load             | **Skeleton mirroring the final layout** (same row heights, same column widths) — never a centered spinner over a blank page |
| Slow network (> 1 s)        | Skeleton persists; a subtle top progress hairline appears after 1 s                                                         |
| Empty (never had data)      | Illustration-free, text-first: what this is, why it matters, one primary action, one secondary link to docs                 |
| Empty (filtered to nothing) | "No results for these filters" + one-click **Clear filters**                                                                |
| Error (recoverable)         | Inline card in place of the content: what failed, **Retry**, and (dev/staff only) the `requestId`                           |
| Error (mutation)            | Roll back the optimistic row, inline message at the field/row, toast with Retry; `aria-live="assertive"` for failures       |
| Offline                     | Persistent thin banner with "N changes pending"; queued items show a pending badge; nothing is blocked                      |
| Permission denied           | Explain the rule in human terms ("Private channel — ask @sam to add you"), with a Request access action where possible      |
| Rate limited                | Toast with countdown, auto-retry where safe, never a raw 429                                                                |
| AI unavailable              | Feature shows a disabled state with an explanation; the rest of the product is untouched                                    |

**Toast rules:** bottom-right on desktop, top on mobile, max 3 visible, auto-dismiss 4–6 s (paused on hover/focus), destructive actions get **Undo** instead of auto-dismiss, and `aria-live="polite"` — toasts never steal focus.

### 17.9 Motion

- **Purposeful only:** motion communicates origin, state change, or relationship. No decorative loops.
- **Durations:** 120 ms micro (hover/press), 180 ms standard (popover, tab), 240 ms large (panel, dialog, drawer). Exit ≈ 65% of enter duration.
- **Easings:** enter `cubic-bezier(0.16, 1, 0.3, 1)` (fast out), exit `cubic-bezier(0.4, 0, 1, 1)`, move `cubic-bezier(0.2, 0, 0, 1)`. Springs for drag/sheet gestures.
- **Animate only `transform` and `opacity`.** Never width/height/top/left. Layout changes use FLIP when cross-fading between list and board layouts.
- **Interruptible:** a second input cancels the running animation immediately; never block input during animation.
- **Shared elements:** opening an issue from a board morphs the card into the peek panel (spatial continuity), rather than sliding a generic panel.
- **Respect `prefers-reduced-motion`:** replace movement with 100 ms opacity fades; disable morphs and parallax entirely.
- **Optimistic feedback beats animation:** the best "animation" is a state that was already correct.

### 17.10 Accessibility (WCAG 2.2 AA, with the new criteria called out)

| Criterion                             | How we satisfy it                                                                                                                 |
| :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------- |
| 1.4.3 / 1.4.11 Contrast               | 4.5:1 text, 3:1 UI and graphical objects — verified in tokens, both themes, and in CI                                             |
| 2.1.1 Keyboard                        | Every action has a keyboard path, including drag-and-drop                                                                         |
| **2.5.7 Dragging Movements**          | Board cards and list rows expose a **"Move to…"** menu and keyboard reordering; drag is never the only way                        |
| **2.5.8 Target Size (Minimum)**       | ≥ 24×24 CSS px in dense UI, ≥ 44×44 for mobile touch (with `hitSlop` expansion for icon buttons)                                  |
| 2.4.7 / **2.4.11 Focus Not Obscured** | Visible focus ring everywhere; sticky headers and the detail panel never cover the focused element (scroll-into-view with offset) |
| 2.4.3 Focus Order                     | Logical DOM order; dialogs trap focus and return it; route changes move focus to the main heading                                 |
| 2.4.2 Page Titled                     | Per-route document titles incl. workspace and entity                                                                              |
| 1.3.1 / 4.1.2                         | Semantic landmarks, real headings, correct roles for trees/grids/lists, `aria-sort` on sortable columns                           |
| 4.1.3 Status Messages                 | Toasts, save confirmations, and sync state announced via live regions                                                             |
| **3.3.8 Accessible Authentication**   | Passkeys supported; no cognitive-test CAPTCHA as the only path; paste into password fields allowed                                |
| **3.3.7 Redundant Entry**             | Multi-step flows carry data forward (invite flow, mail setup)                                                                     |
| 1.4.12 Text Spacing / 1.4.4 Resize    | Layouts survive 200% zoom and user text-spacing overrides (no fixed heights on text containers)                                   |
| 1.4.10 Reflow                         | Functional at 320 CSS px width; no two-dimensional scrolling except boards/data tables (allowed for essential 2D layout)          |
| 2.2.2 Pause/Stop/Hide                 | No auto-playing media; animations pausable; typing indicators respect reduced motion                                              |
| 3.2.1/3.2.2 On Focus/Input            | No surprise navigation on focus or field change                                                                                   |

**Editor-specific accessibility:** the rich-text editor exposes a toolbar that is keyboard reachable, announces formatting state, supports a "plain text mode" escape hatch, and documents its keyboard map in-app. Mention autocomplete follows the combobox pattern with `aria-activedescendant`. Collaborative cursors are decorative to screen readers (attribution comes through comments and activity).

**Testing:** axe-core in unit tests (violations fail CI), Playwright + axe on top routes, keyboard-only smoke scripts per feature, and a quarterly manual screen-reader pass (NVDA on Windows, VoiceOver on macOS/iOS).

### 17.11 Perceived performance techniques

| Technique                                                                                  | Where                        |
| :----------------------------------------------------------------------------------------- | :--------------------------- |
| Render from cache before auth completes                                                    | App boot                     |
| Route-level code splitting + prefetch on hover/focus/`requestIdleCallback`                 | All navigation               |
| Prefetch the likely next entity (board → top card, list → selected row)                    | Lists and boards             |
| Virtualized lists with overscan; windowed boards                                           | Chat, inbox, issue lists     |
| Optimistic mutations with pending badges                                                   | Everywhere                   |
| Skeleton → content cross-fade at 120 ms (no flash)                                         | First load only              |
| Images/video poster placeholders with reserved aspect ratio                                | Attachments, previews        |
| Debounced search (120 ms) with request cancellation and stale-response guarding            | Palette                      |
| Service worker precache of the shell + stale-while-revalidate for static assets            | PWA                          |
| Input latency budget: no synchronous work > 16 ms in event handlers; heavy work in workers | Editor, search, mail parsing |

### 17.12 Mobile UX (platform-native, not a shrunk web app)

- **Navigation:** bottom tab bar with ≤ 5 destinations (Inbox, Issues, Docs, Chat, More), native stack pushes, system back/gesture honored, deep links + universal links for every entity.
- **Density:** single-column, 44 pt minimum touch targets, sheets instead of modals, pull-to-refresh, infinite scroll with a loading row (not a spinner overlay).
- **Composition:** message/reply composer is a bottom sheet that survives the keyboard; draft autosave every 2 s locally; mentions via a native-styled picker.
- **Offline is a first-class state:** a persistent "offline" pill, pending badges on queued items, and a manual "Sync now" affordance.
- **Adaptive:** tablet/iPad split view with the same sidebar+content model as desktop where space allows.
- **Haptics:** light impact on send/reaction, notification-style success on submit; never on scroll.
- **Dynamic Type:** all text scales; layouts reflow instead of truncating; no fixed-height text containers.
- **Push:** deep-links into the exact thread/issue; per-workspace mute; quiet hours respected.

### 17.13 Microcopy rules

- **Sentence case everywhere.** No Title Case Buttons.
- **Verbs that describe the outcome**: "Create issue", "Send reply", "Assign to me" — not "Submit", "OK", "Confirm".
- **Errors state cause + fix**, and never blame the user: "This link expired. Request a new one?" not "Invalid token."
- **Destructive confirmations name the object**: "Delete _ENG-142: Rate limit retries_?" with the count when bulk.
- **Empty states are invitations**: "No issues yet — create the first one, or press ⌘K to search."
- **Time:** relative for recent ("2 m ago"), absolute on hover/expand, localized; always show timezone for scheduled sends.
- **Numbers:** locale-formatted, tabular figures, units in labels not values ("3 days", not "3d").

### 17.13a Internationalization and localization (added in v1.1)

- **Every user-facing string goes through Lingui** (`t`/`<Trans>`), extracted to ICU catalogs in `packages/i18n`; a CI check fails on new hardcoded strings in `apps/*`. Server-generated text (emails, notifications, errors) uses the same catalogs, keyed by the recipient's locale.
- **ICU plurals and gender**, never string concatenation ("1 issue" / "3 issues" / languages with more plural forms).
- **Locale-aware formatting** via `Intl` (dates, relative time, numbers, lists); user timezone from the profile, never the server's.
- **RTL-safe by construction:** Tailwind logical utilities only (`ms-*`, `me-*`, `ps-*`, `start-*`), `dir` set from the locale, directional icons mirrored. A pseudo-locale (accented + 30% longer + RTL) runs in visual regression to catch truncation and mirroring bugs before real translations exist.
- **Content is not UI:** documents, messages, and mail are stored as written; search uses per-document language detection (§11.1).
- **Launch locales:** English (source), then French and Kinyarwanda; community translations through a self-hostable workflow (Weblate) once strings stabilize.

### 17.13b First-run experience and migration (added in v1.1)

The first ten minutes decide adoption, for operators and for teams.

- **Operator:** the setup wizard (§12.2) checks DNS/TLS, mail sending, storage, and backup configuration, shows a green/red health list (`huriro doctor` in the UI), and creates the first workspace.
- **Workspace:** a three-step wizard (name → invite → choose a starter: _engineering team_, _product team_, _support team_) seeds statuses, labels, a sample project, a doc template set, and `#general`. Sample data is clearly marked and removable in one click.
- **Import before invite:** importers (Linear, GitHub Issues, Jira CSV/API, Notion/Markdown zip, Slack export) run as resumable jobs with a **dry-run preview** (counts, user mapping, unmapped fields) and an import report; imported entities keep a link to their source and redirects from old identifiers (`LIN-123 → ENG-123`).
- **Activation checklist:** create an issue with the keyboard, open the palette, write a doc, connect an agent (MCP or CLI), invite a teammate — each item deep-links to the action and disappears when done.

### 17.14 Design operations

| Practice             | Implementation                                                                                                                                                     |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token pipeline       | DTCG JSON → Style Dictionary → CSS/Tailwind/RN; PR proposed by automation; semver on token package                                                                 |
| Component workshop   | Storybook with states matrix + interaction tests + axe                                                                                                             |
| Visual regression    | Playwright screenshots per component state and per key route, both themes, on PR                                                                                   |
| Design review gate   | Any new surface must match the shell (header, empty/loading/error, keyboard, focus) — enforced by a checklist in the PR template                                   |
| UX metrics           | INP/LCP/CLS via RUM; task completion + time-to-first-action for key flows; support-ticket tagging by surface                                                       |
| Research cadence     | Usability sessions on the top 3 flows before each milestone gate (M3, M4, M6); session replay (consented) for drop-off analysis once the cloud offering has volume |
| Accessibility budget | Zero axe violations on new code; quarterly manual audit report                                                                                                     |

### 17.15 Antipatterns explicitly banned

❌ Spinner-over-blank-page ❌ Modal for primary navigation ❌ Icon-only buttons without labels/tooltips ❌ Placeholder-as-label ❌ Disabled buttons with no explanation ❌ Invisible shortcuts ❌ Color-only status (always icon + text) ❌ Auto-focus stealing during streaming updates ❌ Nested scroll containers in the main content column ❌ Layout shift when async content arrives ❌ Toast for errors that need action ❌ Drag-only interactions ❌ Emoji as structural icons.

---

## 18. Client Platform Strategy

### 18.1 Surface matrix

| Surface                        | v1                                                                                  | Later                                                 | Rationale                                                                         |
| :----------------------------- | :---------------------------------------------------------------------------------- | :---------------------------------------------------- | :-------------------------------------------------------------------------------- |
| **Web** (desktop browsers)     | Full product                                                                        | —                                                     | Primary surface; also the PWA (installable, offline shell)                        |
| **Mobile** (iOS/Android, Expo) | Inbox, Issues, Chat, Docs reader + light editing                                    | Full doc editing, offline mail compose                | Where triage and quick replies happen                                             |
| **Desktop**                    | **PWA install**                                                                     | Thin native shell (Tauri-class) reusing the web build | Chromium-class rendering with native affordances, without maintaining a second UI |
| **CLI** (`huriro`, MIT)        | Issues, docs, comments, search, agent queue; device-flow login; `--json` everywhere | Admin and import commands                             | Coding agents and power users live in terminals (§13.1a)                          |
| **Browser extension**          | —                                                                                   | Deferred                                              | Link capture could be a later win                                                 |

**Rejected for v1: a bespoke GPU-rendered Rust UI.** Verified findings: the framework in the original sketch (`anomalyco/rune`) is real but **three weeks old at the time of writing**, pre-release ("pin a rev of `dev`"), not accepting pull requests, bus factor ~1, ships **no rich-text editor**, and its own plan names IME and accessibility as top risks; accesskit support is desktop-only and behind a feature flag. Separately, `rune-rs` is an embedded **scripting language**, not a GUI toolkit — the original plan conflated the two. No Rust-native GUI framework (GPUI, Slint, egui, Iced, Dioxus, Makepad) ships a ProseMirror/Yjs-class editor, which for a docs product is a multi-year build. See Appendix A.9.

**Desktop choice, if/when native is needed:** Tauri 2.x (stable; system webview) for Windows/macOS. If identical Chromium text/IME behavior on Linux matters — and WebKitGTK is the weakest `contenteditable` engine — use Electron instead (heavier, but predictable). Revisit Tauri 3's bundled-CEF runtime when it is stable. Known Tauri caveats: WKWebView is tied to the OS version, WebKitGTK varies by distribution, and the auto-updater is desktop-only (no mobile).

### 18.2 Desktop shell requirements (post-GA)

If and when we ship a native shell, it must provide:

- **Shared web bundle** (no forked UI), loaded in the system webview (WebView2 / WKWebView / WebKitGTK).
- **Native integration:** global quick-capture (`Cmd/Ctrl+Shift+Space`), menu bar / tray, notifications, protocol handler (`huriro://`), auto-launch, offline cache reuse.
- **Deep links:** `huriro://issue/ENG-142`, `huriro://doc/…`.
- **Hardening:** context isolation, no `nodeIntegration`, strict CSP, allowlisted IPC surface, signed auto-updates with rollback.
- **Acceptance:** cold start to interactive ≤ 1.5 s on a 3-year-old laptop; idle RAM within 1.4× the browser tab; identical feature parity verified by the same E2E suite.

### 18.3 Mobile engineering constraints (design them in, not around)

| Constraint                                  | Consequence                                                                          |
| :------------------------------------------ | :----------------------------------------------------------------------------------- |
| iOS background execution is limited         | Sync on foreground + push-triggered refreshes; never promise real-time in background |
| No reliable long-lived socket in background | Push notification carries a _hint_; data is pulled on open                           |
| Secure storage is per-app                   | Refresh tokens in SecureStore/Keychain, biometrics optional per workspace            |
| Memory limits on low-end Android            | Virtualized lists, image downscaling, no full-workspace in RAM                       |
| Store review lead time                      | Feature flags + OTA-updatable JS for non-native changes; native changes batched      |
| Offline-first expectations are higher       | Local DB is the source of truth on device; conflicts resolved as in §9.5             |

### 18.4 Shared code boundaries

| Shared                                                                                                          | Not shared                              |
| :-------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| Contracts, validation schemas, domain logic                                                                     | Layout and navigation shells            |
| API client, sync cursor logic, mutation queue                                                                   | Platform-specific gestures and controls |
| Design tokens (compiled per platform)                                                                           | Chat/mail composers (native on mobile)  |
| The TipTap editor build (`packages/editor`), run natively on web and inside an **Expo DOM component** on mobile | —                                       |
| Auth session hooks                                                                                              | Storage backends (IndexedDB vs SQLite)  |

Target: **≥ 60% of non-UI application code shared** between web and mobile, measured in CI so the monorepo actually delivers on its promise.

---

## 19. Infrastructure, Environments & Delivery

### 19.1 Environments

| Environment          | Purpose                                                                                                                    | Data                          | Access             |
| :------------------- | :------------------------------------------------------------------------------------------------------------------------- | :---------------------------- | :----------------- |
| **Local**            | `bun dev` + `docker compose --profile dev up` (Postgres, Mailpit, Garage, optional Valkey) — the same images as production | Seeded fixtures               | Developer + agents |
| **Preview (per PR)** | Ephemeral stack, migrated, seeded with a demo workspace                                                                    | Ephemeral, destroyed on merge | Team + reviewers   |
| **Staging**          | Prod-shaped, synthetic tenants, load tests                                                                                 | Synthetic only                | Team               |
| **Production**       | Customer data                                                                                                              | Real                          | Least privilege    |

### 19.2 Self-host reference stacks

Self-hosting is a product, not a deployment detail. Three supported shapes, **same images, same compose file** (profiles switch between them):

| Shape                 | Who                          | Containers                                                                                              | Minimum host              |
| :-------------------- | :--------------------------- | :------------------------------------------------------------------------------------------------------ | :------------------------ |
| **Minimal** (default) | 2–50 users, one VPS          | `caddy` · `huriro` (`--role=all`, also serves the web build) · `postgres`                               | 2 vCPU / 4 GB / 40 GB SSD |
| **Standard**          | 50–500 users, one bigger VPS | Minimal + profiles `valkey`, `clamav`, `s3` (Garage), roles split into `api` ×2 · `worker` · `realtime` | 4 vCPU / 8 GB             |
| **Scaled / cloud**    | Beyond one host              | Same images on Kubernetes (Helm, post-GA) or a PaaS, managed Postgres + S3                              | —                         |

```yaml
# infra/compose/compose.yml (abridged) — `docker compose up -d` is the whole install
services:
  caddy: # automatic HTTPS for ONE hostname; skipped when Dokploy/Traefik fronts the stack
    image: caddy:2@sha256:...
    ports: ["80:80", "443:443"]
    volumes: [./Caddyfile:/etc/caddy/Caddyfile:ro, caddy_data:/data]
    networks: [edge]

  huriro: # one image: api + worker + realtime + static web build
    image: ghcr.io/huriro/huriro:1.0.0@sha256:...
    command: ["serve", "--role=all"]
    environment:
      HURIRO_URL: https://${HURIRO_DOMAIN}
      DATABASE_URL_FILE: /run/secrets/database_url
      HURIRO_SECRET_KEY_FILE: /run/secrets/secret_key # root key; per-purpose keys derived via HKDF
      BLOB_STORE: fs # or s3 (profile `s3`)
    secrets: [database_url, secret_key]
    volumes: [huriro_files:/var/lib/huriro/files]
    read_only: true
    tmpfs: [/tmp]
    user: "10001:10001"
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    healthcheck: { test: ["CMD", "/huriro", "health"], interval: 10s }
    depends_on: { postgres: { condition: service_healthy } }
    networks: [edge, data]

  postgres: # our published image = postgres:18.7 + pgvector + pgBackRest (the official image has no pgvector)
    image: ghcr.io/huriro/postgres:18.7-pgvector0.8-pgbackrest2@sha256:...
    environment: { POSTGRES_PASSWORD_FILE: /run/secrets/pg_password }
    secrets: [pg_password]
    command: >
      postgres -c wal_level=logical -c archive_mode=on -c archive_timeout=60
               -c archive_command='pgbackrest --stanza=huriro archive-push %p'
               -c shared_buffers=512MB -c max_connections=60
    volumes: [pg_data:/var/lib/postgresql/data, pg_backups:/var/lib/pgbackrest]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U huriro"], interval: 5s }
    networks: [data] # NEVER on the edge network

  # --- optional profiles -------------------------------------------------------
  valkey: { profiles: ["valkey"], image: "valkey/valkey:9@sha256:...", networks: [data] }
  clamav: { profiles: ["clamav"], image: "clamav/clamav:1@sha256:...", networks: [data] } # ~1.5 GB RAM
  garage: { profiles: ["s3"], image: "dxflrs/garage:v2@sha256:...", networks: [data] }
  otel: { profiles: ["otel"], image: "otel/opentelemetry-collector-contrib@sha256:...", networks: [data] }
  stalwart:
    {
      profiles: ["embedded-mail"],
      image: "stalwartlabs/stalwart:v1.1@sha256:...",
      ports: ["25:25", "465:465", "993:993"],
      networks: [edge, mail],
    }

secrets: # generated by `huriro init` (or the install script) into ./secrets with 0600 permissions
  database_url: { file: ./secrets/database_url }
  secret_key: { file: ./secrets/secret_key }
  pg_password: { file: ./secrets/pg_password }
```

**Operator experience requirements (these are acceptance criteria, not nice-to-haves):**

| Concern       | Requirement                                                                                                                                                                                                                                                                                                          |
| :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install       | `curl -fsSL https://get.huriro.app/compose.yml -o compose.yml && docker compose run --rm huriro init && docker compose up -d` — `init` asks for the domain, generates secrets, writes the Caddyfile and `.env`, and prints the one-time setup URL. A Dokploy template ships the same stack behind Dokploy's Traefik. |
| Migrations    | Applied automatically on start under a Postgres advisory lock, **expand-phase only**; contract migrations run one release later. The server refuses to start against a schema _newer_ than itself (no silent downgrades).                                                                                            |
| Upgrades      | `docker compose pull && docker compose up -d`. Any release from the previous 12 months upgrades directly (chained migrations tested in CI from every supported version). An automatic **pre-upgrade backup** runs before migrations. Release notes flag any manual step, and there should almost never be one.       |
| Backups       | `huriro backup` / `huriro restore` wrap pgBackRest + the file store into one consistent, encrypted bundle, to a local volume by default and to any S3 target when configured. Scheduled daily by the worker; the admin UI shows last backup time, size, and the last verified restore.                               |
| Diagnostics   | `huriro doctor` (CLI and admin UI) checks DNS/TLS, clock skew, DB version/extensions, disk space, mail sending, blob store, backup freshness, and pending migrations, each with a fix hint.                                                                                                                          |
| Configuration | Everything set at runtime by env/secrets or the admin UI; no rebuild, ever. `.env.example` is generated from the config schema.                                                                                                                                                                                      |
| Footprint     | Minimal shape idles under **1 GB RAM** total; measured in CI on every release.                                                                                                                                                                                                                                       |
| Air-gapped    | Images and a static docs bundle can be mirrored; AI features work against a local Ollama/vLLM endpoint; no runtime call to huriro.app.                                                                                                                                                                               |

Rules:

- **Never** expose Postgres, Valkey, or the admin panel to the internet.
- **Object storage:** local filesystem driver by default (on a backed-up volume), Garage (bundled profile) or any external S3-compatible service; **MinIO is not an option** (its community edition is archived).
- Every image is pinned by **digest**; Renovate proposes updates with a cooldown. We publish multi-arch (amd64/arm64), signed images with SBOMs.
- Secrets via Docker secrets / platform secret store, never baked into images or committed `.env` files; `_FILE` env indirection so secrets never appear in `docker inspect`.

### 19.3 Dokploy / panel hardening (if using a control panel)

A panel that mounts the Docker socket is a **host-root–equivalent** component and has a real advisory history (multiple critical issues in 2026, including a member-to-root escalation). Non-negotiables:

1. **Never expose the panel port publicly.** Reach it over Tailscale/Cloudflare Tunnel/VPN only.
2. Keep it patched; enforce 2FA on panel accounts; limit members.
3. Isolated Docker networks per stack; `no-new-privileges` on every service; no TCP Docker socket exposure.
4. **Do not use panel-level volume backups for the Postgres data directory** — they are not crash-consistent. Use WAL archiving + `pgBackRest` (§19.5).
5. Host firewall with a Docker-aware ruleset (published ports bypass plain `ufw`).
6. Treat the panel as privileged infrastructure in the threat model and in access reviews.

If those constraints are unacceptable for a given deployment, ship a plain `docker compose` + systemd path documented as the supported alternative.

### 19.4 Data services

| Service        | Choice                                                                                                                                                                                                                         | Notes                                                                        |
| :------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| Postgres       | 18.x, `wal_level=logical` from day one                                                                                                                                                                                         | Enables CDC, search replicas, and zero-downtime major upgrades later         |
| Pooling        | In-process pools on the minimal shape; **PgBouncer** (transaction mode, `max_prepared_statements` set so driver-prepared statements work) once API replicas > 2; direct session connection for LISTEN/NOTIFY and the job queue | `set_config(…, true)` is pooler-safe; session `SET`/`LISTEN` is not          |
| Cache/pub-sub  | **Valkey** (BSD) — **optional** on a single node (in-process bus), required for multi-node realtime                                                                                                                            | Not Redis (license churn); NATS JetStream only if durable streams are needed |
| Jobs           | **Postgres-backed queue** (pg-boss) with an inbound-webhook staging table                                                                                                                                                      | Enqueue in the same transaction as the write; raise batch size from defaults |
| Object storage | `BlobStore`: local filesystem (minimal) · Garage (bundled profile) · any S3-compatible API                                                                                                                                     | Presigned/signed uploads, quarantine prefix, lifecycle rules                 |
| Search         | Postgres FTS + `pg_trgm` + `pgvector` (HNSW)                                                                                                                                                                                   | Optional BM25 extension later; never a hard dependency                       |
| Vectors        | `halfvec` with `hnsw.iterative_scan = relaxed_order`                                                                                                                                                                           | Filters are applied post-scan; iterative scan prevents recall collapse       |

### 19.5 Backup, restore, and disaster recovery

| Item               | Target                                                                                                                                                                                                                                                                                  |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPO                | ≤ 5 minutes (WAL archiving with ~60 s `archive_timeout`)                                                                                                                                                                                                                                |
| RTO                | ≤ 1 hour for a full restore                                                                                                                                                                                                                                                             |
| Full backup        | Nightly `pgBackRest` full; differential every 6 h; WAL continuous                                                                                                                                                                                                                       |
| Retention          | 7 d full, 30 d differential/WAL, monthly full for 12 months                                                                                                                                                                                                                             |
| Encryption         | Backup repo encrypted; keys **not** stored with the backups                                                                                                                                                                                                                             |
| Verification       | **Automated monthly restore drill** into an isolated environment + row-count/checksum assertions. Self-host: `huriro backup verify` (scheduled weekly) restores the latest backup into a scratch database inside the Postgres container and reports the result on the admin health page |
| Self-host defaults | Local backup repo on a separate volume **plus** a prominent setup step for an off-site S3 target; the admin UI warns while no off-site target is configured                                                                                                                             |
| Key escrow         | Backups are useless without `HURIRO_SECRET_KEY` (it unwraps mail/OAuth tokens). Setup forces the operator to download or acknowledge an escrow copy; `huriro restore` checks the key before starting                                                                                    |
| Object storage     | Versioning + lifecycle on the bucket; separate credentials; restore documented                                                                                                                                                                                                          |
| Config             | Compose files, panel config, and secrets inventory in a private repo (secrets in the secret store)                                                                                                                                                                                      |
| Runbook            | `docs/runbooks/restore-postgres.md` with exact commands, tested quarterly                                                                                                                                                                                                               |

**A backup that has never been restored is a hypothesis.** The drill is a scheduled task with an owner, not an aspiration.

### 19.6 CI/CD pipeline

```text
PR opened
 ├─ lint + format check (Biome)
 ├─ typecheck (all packages)
 ├─ unit tests (parallel per package)
 ├─ integration tests (Testcontainers Postgres, RLS matrix)
 ├─ contract test (OpenAPI snapshot vs generated)
 ├─ migration lint (Squawk) + down-migration sanity
 ├─ security: gitleaks, dependency audit (OSV/bun audit), Semgrep/CodeQL, Trivy image scan
 ├─ a11y (axe on stories + key routes) and visual regression (Playwright)
 ├─ build all images (multi-arch) + SBOM + cosign sign
 └─ deploy preview environment for UI-heavy PRs only (migrate, seed, smoke test) — optional for a solo pipeline

Merge to main
 ├─ build & push images tagged with commit SHA
 └─ deploy staging → run E2E suite against staging → promote to production (manual gate)

Production deploy (rolling)
 ├─ migrations job (expand phase) with lock_timeout + retries
 ├─ rolling restart, health-gated (readiness = DB + migrations applied + cache reachable)
 ├─ smoke tests (login, delta pull, create issue, socket connect)
 └─ auto-rollback if smoke fails or error rate spikes in the first 10 minutes
```

**Supply-chain rules:** commit `bun.lock` and install `--frozen-lockfile`; pin GitHub Actions by **full SHA** (GitHub now supports workflow dependency lockfiles — use them); configure a **3–7 day minimum release age** in `bunfig.toml` and Renovate (`minimumReleaseAge`) so a compromised fresh release doesn't reach us first; sign images and publish attestations; never `curl | bash` in CI.

### 19.7 Scaling path

| Stage | Trigger                      | Change                                                                                                          |
| :---- | :--------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| **0** | < 200 workspaces             | Single VPS, everything in one compose stack                                                                     |
| **1** | API CPU saturated            | Add API replicas behind the edge; move Valkey to its own instance; PgBouncer                                    |
| **2** | Postgres write/read pressure | Read replica for heavy reads (search, analytics); partition `change_log`/`chat_messages` by month; `pg_partman` |
| **3** | Realtime fan-out             | Dedicated realtime nodes with document leases; Redis cluster                                                    |
| **4** | Single-DB limits             | Logical sharding by `workspace_id` (the schema is already tenant-keyed, and every query is scoped)              |
| **5** | Enterprise needs             | Multi-region read replicas, per-tenant isolation options, K8s/managed services                                  |

**Design invariants that make this path possible:** `workspace_id` on every row; cursors and jobs scoped per workspace; no cross-tenant joins; no reliance on a single connection for correctness; stateless API.

### 19.8 Cost envelope (self-host, single VPS)

| Item                      | Minimal shape (monthly)       | Standard shape (monthly)                                   |
| :------------------------ | :---------------------------- | :--------------------------------------------------------- |
| VPS                       | 2 vCPU / 4 GB: $6–20          | 4 vCPU / 8 GB: $25–45                                      |
| Files                     | On the VPS disk ($0)          | Object storage 100 GB + egress: $5–15                      |
| Off-site backup bucket    | $1–5                          | $2–5                                                       |
| Transactional email relay | usage-based (often free tier) | usage-based                                                |
| Observability             | $0 (logs + `/metrics`)        | $0–20                                                      |
| **Total**                 | **~$10–30**                   | **~$35–90** — the self-host promise must actually be cheap |

---

## 20. Observability & Reliability

### 20.1 Signals

| Signal      | Implementation                                                                                                                                                                                                                                                                            |
| :---------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Logs**    | Structured JSON (`pino`), one line per request/job, with `requestId`, `workspaceId`, `actorId` (hashed where sensitive), `route`, `status`, `durationMs`, `errorCode`. Log level per environment; sampling for high-volume paths.                                                         |
| **Traces**  | OpenTelemetry SDK → Collector → backend. Manual span instrumentation is mandatory on Bun (auto-instrumentation does not cover `Bun.serve`/`fetch` reliably). Span attributes: `workspace.id`, `db.statement.name`, `cache.hit`, `queue.name`, `job.attempt`.                              |
| **Metrics** | RED for HTTP (rate/errors/duration), USE for resources, plus domain metrics: `sync.cursor_lag_seconds`, `sync.delta_rows_returned`, `jobs.lag_seconds`, `jobs.dead_letter_count`, `mail.sync_failures`, `ai.tokens_used`, `ws.connections`, `doc.rooms_active`, `change_log.pruned_upto`. |
| **Errors**  | Sentry-compatible backend (GlitchTip self-hosted) with release + commit tagging; PII scrubbing; source maps uploaded at build.                                                                                                                                                            |
| **RUM**     | Web Vitals (INP/LCP/CLS), route timings, long tasks, and client-side error rates per release.                                                                                                                                                                                             |
| **Uptime**  | External heartbeat checks from a **different provider** than the host, so a full outage is still visible.                                                                                                                                                                                 |

### 20.2 SLOs and alerting

| SLI                        | SLO                        | Alert                                                        |
| :------------------------- | :------------------------- | :----------------------------------------------------------- |
| API availability (non-5xx) | 99.9% monthly              | Burn-rate alert (fast: 2% in 1 h; slow: 5% in 6 h)           |
| API read latency p95       | ≤ 250 ms                   | Page if > 500 ms for 10 min                                  |
| Write latency p95          | ≤ 300 ms                   | Page if > 750 ms for 10 min                                  |
| Sync propagation p95       | ≤ 1 s                      | Page if > 5 s for 5 min                                      |
| Job lag p95                | ≤ 30 s                     | Warn at 2 min, page at 10 min                                |
| Mail sync success          | ≥ 99% of accounts per hour | Warn; page if a single account fails 10 consecutive attempts |
| Websocket connect success  | ≥ 99.5%                    | Warn                                                         |
| Error budget               | 0.1% monthly               | Feature freeze on exhaustion until burn rate recovers        |

**Alert rules:** every alert must be **actionable**, link to a runbook, and name an owner. No alert without a runbook; no runbook without a tested command. Dashboards: _Overview_, _Sync_, _Jobs_, _Mail_, _AI_, _Database_, _Edge_.

### 20.3 Operability requirements

- **Health endpoints:** `/healthz` (liveness, no dependencies), `/readyz` (DB + migrations + required cache reachable), `/metrics`.
- **Graceful shutdown:** drain HTTP, flush Yjs rooms, finish in-flight jobs (with a deadline), close sockets with a close frame.
- **Feature flags** for every risky surface, evaluated server-side, with a kill switch per integration (mail, AI, GitHub, MCP).
- **Read-only mode:** a global flag that keeps reads serving while writes return `503` with a clear message, used during risky migrations.
- **Admin console (internal):** workspace lookup, queue inspection/replay, dead-letter browser, feature-flag overrides, impersonation **with explicit consent + audit** (or not at all).

### 20.4 Incident process

1. **Detect** (alert or report) → 2. **Acknowledge + declare severity** (SEV1–3) → 3. **Mitigate** (rollback/flag/scale) → 4. **Communicate** (status page + customer email for SEV1/2 within 30 min) → 5. **Resolve** → 6. **Blameless postmortem within 5 business days** with action items and owners.

Severity ladder: SEV1 = data loss/security or full outage; SEV2 = major feature unavailable or severe latency; SEV3 = degraded, workaround exists.

---

## 21. Testing Strategy & Quality Gates

### 21.1 The pyramid, adapted to this product

| Layer                       | Tooling                            | What it must cover                                                                                          |
| :-------------------------- | :--------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| **Unit (fast, many)**       | `bun test` / Vitest                | Pure domain logic: policy decisions, fractional indexing, threading, cursor math, sanitizers, token parsing |
| **Integration (real deps)** | Testcontainers Postgres            | Every repository query, every RLS policy, every migration, transaction boundaries, outbox emission          |
| **Contract**                | Generated OpenAPI snapshot         | Request/response shapes, error codes, MCP tool schemas                                                      |
| **E2E (few, critical)**     | Playwright (web), Maestro (mobile) | Auth, create/edit issue, board drag via keyboard, doc co-editing, chat send, inbox reply, palette search    |
| **Non-functional**          | k6, axe, Playwright screenshots    | Load, a11y, visual regression                                                                               |

### 21.2 The tests that must exist before a feature ships

1. **Authorization matrix** — for each new action: allowed for each role, denied for each role that shouldn't have it, denied for a user in another workspace (BOLA).
2. **RLS isolation** — two-tenant fixture: tenant A cannot read/write tenant B's rows, run as the **non-owner** app role.
3. **Idempotency** — the same `Idempotency-Key` twice produces one row.
4. **Optimistic concurrency** — stale `version` returns `409` and does not write.
5. **Sync correctness** — a scripted concurrent-write scenario asserts gap-free cursor delivery (the regression test for §9.2).
6. **A11y** — axe zero violations on new components; keyboard path for any drag/gesture interaction.
7. **Sanitization** — XSS payload corpus for docs, chat, and mail bodies.
8. **Sync grants/revokes** — a user added to a private project receives its existing entities; a user removed (or an entity moved to a private scope) stops receiving them and gets a purge.
9. **Agent safety** — for each new tool: scope denial, agent scope-ceiling denial, correct risk tier (R2 cannot complete without an out-of-band approval), attribution in activity, and a prompt-injection fixture that tries to make it act.
10. **i18n** — no hardcoded strings; the pseudo-locale renders without truncation in the new UI.

### 21.3 Test data and environments

- **Factories** in `packages/test-utils` (typed builders: `aWorkspace()`, `anIssue()`, `aMailConversation()`), seeded with deterministic randomness (seed in output on failure).
- Each integration test runs in a transaction that is rolled back, or against a **per-worker schema** — never shared global state.
- E2E runs against a disposable stack with a seeded demo workspace and a fixed clock where time matters.
- **Flake policy:** a test that fails intermittently is quarantined within 24 h, fixed or deleted within a week; no "retry until green" in CI.

### 21.4 Coverage and mutation testing

- Coverage **gates on changed lines**, not global percentage (meaningless global numbers invite gaming): ≥ 80% on `packages/domain/**` and `apps/server/src/modules/**/service.ts`.
- Mutation testing on `packages/domain` (Stryker) quarterly — it is the only way to know policy tests actually assert.
- Load tests (k6) with committed scenarios: 200 concurrent users doing mixed reads/writes, a 500-message burst in one channel, and a 50-user co-editing session. SLO thresholds in the script.

### 21.5 Security testing

- Auth E2E suite (see §12.2 library risk): login, 2FA, passkey, OAuth PKCE exchange, refresh rotation, revocation, session fixation attempts.
- Negative tests for every endpoint: unauthorized principal type, expired token, wrong workspace, missing CSRF header.
- External penetration test before GA (G6 gate); annual afterward for the cloud offering. Internal security review (§21.1, §22) at every milestone gate.
- Dependency and container scanning in CI; a documented triage SLA (critical ≤ 72 h).

### 21.6 CI gate summary (merge is blocked unless green)

```text
typecheck · lint · unit · integration · contract · migration-lint
· gitleaks · SCA · SAST · image CVE scan · axe · visual regression
· bundle-size budget · license allowlist · module-boundary lint · generated-code drift · i18n extraction
· self-host smoke (fresh `compose up` + upgrade from every supported release + footprint < 1 GB idle)
```

**Bundle budgets:** initial JS ≤ 200 KB gzip for the shell; editor chunk lazy-loaded; a route exceeding budget fails CI with the diff.

---

## 22. Privacy, Compliance & Data Governance

### 22.1 Data classification

| Class            | Examples                                                      | Handling                                                                                                                 |
| :--------------- | :------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------- |
| **Restricted**   | Mail bodies/attachments, OAuth tokens, API keys, auth secrets | Encrypted at rest (tokens via envelope encryption), never logged, never sent to AI without policy consent, access-logged |
| **Confidential** | Docs, issues, chat, file contents                             | Tenant-isolated (RLS), encrypted at rest, egress-controlled                                                              |
| **Internal**     | Workspace metadata, usage metrics                             | Aggregated/anonymized where possible                                                                                     |
| **Public**       | Marketing site, docs site                                     | No tenant linkage                                                                                                        |

### 22.2 GDPR / privacy-by-design commitments

- **Lawful basis & DPA:** we act as **processor** for workspace content and **controller** for account/billing data. A DPA with subprocessor list is published and versioned.
- **Data subject rights:**
  - **Export (Art. 20):** workspace owner export → JSON + original files + EML; asynchronous job with signed download; email verification for the requester.
  - **Erasure (Art. 17):** user deletion removes PII, anonymizes authorship ("Deleted user"), cascades sessions/tokens, purges derived indexes and AI caches; backups expire per the documented window.
  - **Rectification/access:** profile self-service + support path with identity verification.
- **Retention:** configurable per workspace (default: mail 24 months, chat 36 months, audit 24 months, backups 30 days). Retention jobs are idempotent and report counts.
- **Data minimization:** no analytics PII; IP addresses hashed with a rotating salt; session replay disabled by default and never on mail/doc content.
- **International transfers:** documented regions; self-hosters choose their own.
- **Sub-processors:** AI providers, email relay, object storage, observability — each listed with purpose and region.

### 22.3 AI-specific privacy rules

1. **No training on customer content** by us, contractually and technically (no fine-tuning pipelines on tenant data).
2. **Provider terms:** zero-retention/enterprise endpoints only; the gateway records the provider and retention mode per run.
3. **Workspace controls:** AI on/off per workspace, model allowlist, BYO key, prompt/response retention toggle (default: **do not store** content, only hashes + metadata).
4. **Erasure propagation:** deleting a doc removes its chunks and embeddings; the semantic cache key includes a content hash so stale entries can't resurface deleted text.
5. **Right to explanation for agents:** every agent action links to the run record (who, what tool, what arguments) in the audit log.

### 22.4 Security & compliance controls checklist (Huriro Cloud; SOC 2 readiness — self-hosters inherit the product controls, the operational ones are theirs)

| Control area        | Implementation                                                                                             |
| :------------------ | :--------------------------------------------------------------------------------------------------------- |
| Access control      | SSO for staff, least privilege, quarterly access reviews, no shared accounts, break-glass with audit       |
| Change management   | PR review required, CI gates, production deploy approvals, migration review, audit trail                   |
| Encryption          | TLS 1.2+ in transit, AES-256 at rest, envelope encryption for third-party tokens, managed KMS              |
| Monitoring          | Centralized logs (append-only), alerting, intrusion detection at the edge, anomaly alerts on admin actions |
| Backups             | Encrypted, tested restores, documented RPO/RTO, off-site copies                                            |
| Vendor management   | Subprocessor inventory, annual review, DPAs, security questionnaires                                       |
| Incident response   | Documented plan, severity ladder, 72-hour breach notification path, postmortems                            |
| Business continuity | Runbooks for DB loss, provider outage, key compromise, region failure                                      |
| Device & endpoint   | Disk encryption, MDM where feasible, no production data on laptops                                         |
| Data deletion       | Documented erasure pipeline incl. backups, verified by a recurring test                                    |

### 22.5 Logging and data-subject safety

- **Never log:** passwords, tokens, mail bodies, doc content, attachment contents, full prompts.
- **Log with care:** user ids (ok), emails (hash or redact), IP (hash), search queries (opt-in, per workspace, for improving search only).
- **Log retention:** 30 days hot, 12 months cold (audit log separate, 24 months).

### 22.6 Why not end-to-end encryption (yet)

E2EE is incompatible with server-side full-text search, collaborative editing (server needs the CRDT state to be authoritative on reconnects for offline peers), semantic search, and reliable mobile sync without a device always online. The design keeps a **seam**: `doc_state.state` is already opaque bytes, and attachments are stored as opaque objects, so a future "confidential docs" tier (per-document keys, server-blind) can be added for a subset of content. Recorded as an explicit non-goal with a dated revisit trigger (first enterprise request or a regulated vertical).

---

## 23. Roadmap, Milestones & Exit Criteria

### 23.1 Assumptions

- **Team:** one full-time founder-engineer working with AI coding agents. Contracted help is budgeted at three points only: a design review at G0 and G4, and an external security review at G3 and before GA. If a second engineer joins, M4 (Chat) and M5 (Inbox) run in parallel and mobile starts at M4; the calendar compresses by ~30%. **Never compress the gates.**
- **What agents change, and what they don't:** agents multiply throughput on well-specified, test-covered work (CRUD modules, UI from the component inventory, importers, tests, docs) — plan ~1.5–2× there. They do not speed up novel design (sync protocol, authorization, collab failover, the agent-safety model) — plan 1× and write a design note first (§23.5). The founder reviews every diff; security- and data-path changes get a second, slower review pass the next day.
- **Cadence:** 2-week cycles; trunk-based; continuous deploy to the founder's own instance. **Huriro is built in Huriro from M1** (issues, then docs, then agents working on assigned issues), which is the cheapest QA a solo project can get.
- **Release model:** every milestone ends in a tagged, self-hostable release with upgrade-path tests from the previous one. Public alpha after M3, beta after M4, GA after M6.
- **Definition of Done (every item):** code + tests (authz + RLS where applicable) + observability (logs/metrics) + a11y check + i18n strings + docs update + feature flag for risky surfaces.

### 23.2 Milestone map (~48 weeks)

```text
W01 ──── W06 ─────────── W14 ───────── W20 ───── W24 ─────────── W30 ─────────── W38 ──────────── W48
│ M0       │ M1            │ M2           │ M3       │ M4            │ M5             │ M6
│ Spine    │ Tasks + sync  │ Docs         │ Agents,  │ Chat +        │ Shared inbox   │ Mobile +
│          │               │              │ MCP, CLI │ importers     │                │ GA hardening
└─ G0 ─────┴─ G1 ──────────┴─ G2 ─────────┴─ G3 ─────┴─ G4 ──────────┴─ G5 ───────────┴─ G6
  security   dogfooding                     ALPHA       BETA                              GA
```

Lead-time items that start early, whatever milestone is active: **Gmail restricted-scope verification and Microsoft publisher verification are submitted during M3** (they take weeks); Apple/Google developer accounts and app-store listings during M5.

### M0 — Spine: foundation, identity, self-host, design system v0 (Weeks 1–6)

| Deliverable                                                                                                                                      | Notes                                                                                                                                                                                                  |
| :----------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo, `bun run verify`, CI gates from §21.6, root + package `AGENTS.md`                                                                      | The agent workflow is part of the foundation, not an afterthought                                                                                                                                      |
| One server image with roles; minimal compose; `huriro init`, setup wizard, `huriro doctor`                                                       | Self-host path exists from week 1 and is exercised by CI                                                                                                                                               |
| Auth: email + passkeys, TOTP, sessions, invitations; auth E2E suite                                                                              | Better Auth for identity only                                                                                                                                                                          |
| Tenancy + roles + ACL schema, policy function, permission matrix tests                                                                           | Roles as data                                                                                                                                                                                          |
| **RLS everywhere** + `withWorkspace` + composite FKs + RLS coverage test                                                                         | Workers use the same role                                                                                                                                                                              |
| Audit log, idempotency, outbox + pg-boss skeleton                                                                                                |                                                                                                                                                                                                        |
| Design system v0: tokens → shadcn contract + Uniwind theme, app shell, ~12 core components, Storybook, visual regression, Lingui + pseudo-locale |                                                                                                                                                                                                        |
| Observability baseline: structured logs, `/metrics`, optional error DSN, external heartbeat                                                      |                                                                                                                                                                                                        |
| `huriro backup` / `restore` / `backup verify` + runbook                                                                                          |                                                                                                                                                                                                        |
| **Gate G0 — Security spine**                                                                                                                     | Two-tenant fixtures can't cross (as `huriro_app`); auth E2E green; restore drill passes on a fresh VPS; a fresh install takes ≤ 10 min following only the README; no endpoint without a deny-path test |

### M1 — Tasks and the sync engine (Weeks 7–14)

| Deliverable                                                                                                                     | Notes                                                                                                                                                                                             |
| :------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Projects, statuses, labels, cycles, issues, sub-issues, relations, comments                                                     |                                                                                                                                                                                                   |
| List, Board (fractional index), filters, saved views, "My work"                                                                 | Keyboard equivalents for every drag                                                                                                                                                               |
| **Sync server**: `change_log`, per-workspace cursor, delta + snapshot endpoints, grant/revoke/scope-move handling, signal plane | Gap-free and grant/revoke regression tests in CI                                                                                                                                                  |
| **Sync client**: TanStack DB adapter, OPFS persistence, offline-transactions outbox, conflict resolver UI                       |                                                                                                                                                                                                   |
| Command palette + FTS/trigram search                                                                                            |                                                                                                                                                                                                   |
| In-app notifications                                                                                                            | Email digests come in M4                                                                                                                                                                          |
| Linear + GitHub Issues importers                                                                                                | Used to migrate the founder's own backlog                                                                                                                                                         |
| **Gate G1 — Latency, correctness, dogfooding**                                                                                  | Two-browser propagation p95 < 1 s; offline edits survive closing the tab and replay exactly once; 200-user k6 run within SLO on the standard shape; Huriro's own development is tracked in Huriro |

### M2 — Collaborative docs (Weeks 15–20)

| Deliverable                                                                | Notes                                                                                                                                                                                                    |
| :------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TipTap + Yjs + Hocuspocus rooms, collab tickets, leases with fencing       | Single-homed rooms                                                                                                                                                                                       |
| `doc_state` + auto checkpoints + named versions + restore                  | Retention thinning job                                                                                                                                                                                   |
| Anchored comments, mentions, notifications                                 | Built in-house                                                                                                                                                                                           |
| Page tree with keyboard reordering, favorites, templates                   |                                                                                                                                                                                                          |
| Docs in search, deep-link anchors, Markdown import/export, Notion importer |                                                                                                                                                                                                          |
| Offline doc editing on web                                                 |                                                                                                                                                                                                          |
| **Gate G2 — Collaboration**                                                | 10 concurrent editors for 30 min with zero divergence; `kill -9` of the realtime process loses no edit still held by a connected client; version restore works; comment anchors survive concurrent edits |

### M3 — Agents, MCP, CLI (Weeks 21–24) → public alpha

| Deliverable                                                                                             | Notes                                                                                                                                                                                                                                                                                                                                       |
| :------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tool registry (`packages/agent-tools`) generating MCP tools, CLI commands, and OpenAPI agent operations | §13.1a                                                                                                                                                                                                                                                                                                                                      |
| MCP server on `2026-07-28` (Better Auth `mcp` + `cimd`, consent screen, connected-apps settings)        | Read tools first, then R1 writes                                                                                                                                                                                                                                                                                                            |
| Agent principals, assign-to-agent, agent activity, _Approvals_ view for R2                              | §13.5                                                                                                                                                                                                                                                                                                                                       |
| `huriro` CLI with device-flow login; API keys                                                           | MIT                                                                                                                                                                                                                                                                                                                                         |
| Markdown representations, `huriro://` resources, `llms.txt`, generated API reference                    |                                                                                                                                                                                                                                                                                                                                             |
| AI gateway (BYO key or Ollama), semantic search v1, thread/doc summaries                                | Off by default per workspace                                                                                                                                                                                                                                                                                                                |
| **Gate G3 — Agent safety + ALPHA**                                                                      | Claude/Cursor complete OAuth and a read task; a coding agent picks up an assigned issue via the CLI, comments, and reports status; an R2 action cannot complete without approval in Huriro; prompt-injection corpus cannot cause an outbound action; token audience rejection verified; external review of auth + MCP. **Tag `v0.1` alpha** |

### M4 — Chat, integrations, importers (Weeks 25–30) → beta

| Deliverable                                                                          | Notes                                                                                                                                                          |
| :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channels, DMs, threads, reactions, attachments (quarantine), SSRF-safe link previews | Per-channel feed (§15.1)                                                                                                                                       |
| Presence, typing, read state, notification fan-out, email digests, web push          |                                                                                                                                                                |
| Slack and Jira importers                                                             |                                                                                                                                                                |
| GitHub App two-way sync; outbound webhooks                                           |                                                                                                                                                                |
| **Gate G4 — BETA**                                                                   | 500-message burst in one channel within SLO; unread counts exact under concurrency; design review passed; **tag `v0.5` beta**; Huriro Cloud private beta opens |

### M5 — Shared inbox (Weeks 31–38)

| Deliverable                                                                          | Notes                                                                                                                                                                                        |
| :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mail phase 1: inbound-parse addresses + outbound relay with DKIM domain verification |                                                                                                                                                                                              |
| Mail phase 2: Gmail API, Microsoft Graph, generic IMAP                               | Verification submitted in M3                                                                                                                                                                 |
| Conversation timeline, assignment, internal notes, drafts with lock, undo-send       |                                                                                                                                                                                              |
| Mail ↔ issue/doc linking, convert to issue, sandboxed rendering, retention + export  |                                                                                                                                                                                              |
| **Gate G5 — Inbox**                                                                  | A real customer email arrives, is assigned, answered from a teammate identity, and converted to an issue end to end; sanitizer fuzz corpus passes; a 10k-message mailbox syncs within 30 min |

### M6 — Mobile, hardening, GA (Weeks 39–48)

| Deliverable                                                                            | Notes                                                                                                                                                                                                                                                                       |
| :------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expo app: auth, Inbox, Issues, Chat, Docs reader + light editing (DOM component), push | Offline replica + outbox                                                                                                                                                                                                                                                    |
| EAS build/submit pipeline, TestFlight + Play internal track                            |                                                                                                                                                                                                                                                                             |
| Performance pass against budgets; bundle budgets enforced                              |                                                                                                                                                                                                                                                                             |
| **External penetration test** + fixes                                                  | Blocking for GA                                                                                                                                                                                                                                                             |
| Second full DR drill; chaos smoke (kill worker/realtime/Valkey)                        |                                                                                                                                                                                                                                                                             |
| Docs: self-host guide, admin guide, API/CLI/MCP reference, security whitepaper         |                                                                                                                                                                                                                                                                             |
| Cloud billing                                                                          | Cloud mode only                                                                                                                                                                                                                                                             |
| **Gate G6 — GA**                                                                       | SLOs met for 14 consecutive days on the dogfood instance and the cloud beta; zero critical/high pentest findings open; a11y audit clean on the top 20 flows; mobile apps approved or in review; upgrade from every beta release tested; restore drill < RTO. **Tag `v1.0`** |

### 23.3 Continuous workstreams

A solo build has no "parallel team", so these are budgeted as **~20% of every cycle** rather than as separate tracks:

| Stream        | Rule                                                                                                      |
| :------------ | :-------------------------------------------------------------------------------------------------------- |
| Design system | New UI uses existing components; a new component is a deliberate addition with stories, states, and tests |
| Accessibility | Per-feature gate (axe + keyboard path); manual screen-reader pass before each gate                        |
| Security      | Threat model updated per milestone; dependency triage weekly                                              |
| Performance   | Budgets in CI from M1; RUM on the dogfood instance                                                        |
| Documentation | ADRs, runbooks, and user docs land in the same PR as the change                                           |

### 23.4 What we deliberately do not build in v1

Restating §2.3 because scope creep is the single largest schedule risk — and the solo-build risk is worse than the team one: no calls, no calendar, no CRM, no automation builder, no public portals, no Zanzibar-grade authorization, no native Rust UI, no native desktop shell (PWA only), no E2EE, no self-hosted mail as the default.

### 23.5 Ways of working

| Practice                       | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Branching**                  | Trunk-based. Short-lived branches (< 2 days), squash merges, no long-running release branches. Ship behind flags.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Commits**                    | Conventional Commits (`feat(issues): …`) so changelogs and release notes are generated, not remembered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Spec before code**           | Any change touching auth, authorization, sync, migrations, or money gets a 1-page design note (or ADR) **before** implementation. Everything else gets a PR description with a screenshot/GIF.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **PR reviews**                 | Solo: every agent-authored PR is reviewed by the founder against the PR checklist (authz path, failure modes, a11y, i18n); security/data-path PRs also get an independent AI review pass and a next-day re-read before merge. When the team grows: 1 human reviewer for UI/copy, 2 for security/data paths. CI gates are the reviewer that never gets tired.                                                                                                                                                                                                                                                        |
| **Definition of Done**         | §23.1 — code + tests + observability + a11y check + docs + flag. "Works on my machine" is not a state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Flags & rollout**            | New surfaces ship dark → internal → 5% → 25% → 100%, with a kill switch and a documented rollback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Releases**                   | Semver. Pre-GA: a release per milestone plus patch releases; post-GA: a minor release every ~4 weeks, security patches any time, and an LTS-style promise that the last two minors get security fixes. Release notes generated from commits + curated, with an explicit "operator actions" section (usually empty).                                                                                                                                                                                                                                                                                                 |
| **Incidents**                  | §20.4. Blameless postmortem within 5 days, actions tracked as issues with owners.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Docs as code**               | ADRs, runbooks, and the API reference live in the repo, reviewed like code, with link checks in CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Agent-assisted development** | The repo ships a root `AGENTS.md` (build/test commands, architecture map, module boundaries, forbidden patterns, "read this before touching X") plus a short `AGENTS.md` per package (§7.2) and reusable task skills (e.g. "add a module", "add a tool", "add a migration") that encode the house patterns. Work is handed to agents as **issues in Huriro** with acceptance criteria and the exact verification command. Agents are treated like new contributors: same gates, same review, no direct pushes to `main`, no access to production secrets. Generated code is reviewed by a human who can explain it. |
| **Plan hygiene**               | This document is split into `docs/plan/<section>.md` at the start of M0 (one file per section, an index, and stable anchors) so humans and agents load only the part they need; ADRs reference sections by file.                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Knowledge durability**       | Every recurring question becomes a doc, a lint rule, or a test — in that order of preference.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Capacity math**              | Plan ~70% of sprints for planned work and 30% for bugs, incidents, reviews, and unplanned security work. A plan that assumes 100% utilization is a plan that slips.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## 24. Risk Register & Open Decisions

### 24.1 Risk register

| #   | Risk                                                                                                              |  L  |  I  | Mitigation                                                                                                                                                                                                                                                                                                    | Trigger to act                                                           |
| :-- | :---------------------------------------------------------------------------------------------------------------- | :-: | :-: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------- |
| R1  | Auth library ships a security flaw (it has, repeatedly)                                                           |  H  |  H  | Pin exact versions, upgrade the family together, auth E2E suite, advisory subscription, in-process exit plan                                                                                                                                                                                                  | Any critical advisory: patch within 24 h or disable the affected plugin  |
| R2  | Pre-GA dependencies churn: Elysia 2 (RC, adopted), TanStack DB 1.0 (RC, adopted), Drizzle 1.0 (RC, _not_ adopted) |  M  |  M  | Exact pins; adopt GA within a cycle of release; keep each behind its seam (`apps/server` composition root, `packages/sync-client`, repos); full regression at every upgrade                                                                                                                                   | An RC still not GA at the M1 gate → ADR re-evaluation                    |
| R3  | Sync serialization becomes a bottleneck for a large tenant                                                        |  L  |  H  | Per-workspace lock is scoped and short; ADR-0004 defines the CDC migration path; instrument `change_log` write latency                                                                                                                                                                                        | p95 lock wait > 50 ms sustained for a workspace                          |
| R4  | Collab server memory/size blowups                                                                                 |  M  |  M  | Document size limits, room leases, snapshot compaction, `SIGTERM` flush, load test with 50 editors                                                                                                                                                                                                            | Any OOM or room > 10 MB                                                  |
| R5  | Mail deliverability / provider verification delays                                                                |  H  |  M  | Start with managed relay + inbound parse; submit Gmail/Graph verification during M3; document lead times                                                                                                                                                                                                      | Verification rejected or delayed > 4 weeks                               |
| R6  | MCP spec churn breaks clients                                                                                     |  H  |  M  | Pin revision, version tool schemas, support two revisions during transitions, contract tests                                                                                                                                                                                                                  | New spec revision published                                              |
| R7  | Scope creep — v1 tries to ship five products                                                                      |  H  |  H  | Gates, explicit non-goals, phase exit criteria, "not in v1" list reviewed at every planning                                                                                                                                                                                                                   | Any phase slip > 1 week                                                  |
| R8  | Solo throughput lower than planned                                                                                |  H  |  H  | Ship tiers (alpha/beta/GA) so slippage moves features to v1.x instead of delaying everything. **Cut order:** mobile doc editing → Jira/Slack importers → GitHub two-way sync → outbound webhooks → Graph/IMAP (keep Gmail + inbound) → Timeline view. Never cut tests, RLS, backups, or the agent-safety gate | A milestone slips > 2 weeks                                              |
| R19 | Bus factor of one (illness, burnout, context loss)                                                                |  H  |  H  | Everything written down (ADRs, runbooks, `AGENTS.md`); reproducible environments; sustainable pace (the 20% continuous budget is not optional); credentials in a shared vault with a recovery contact; releases signed by a key with an escrowed backup                                                       | Two consecutive cycles over plan, or any week without a working `verify` |
| R20 | Agent-generated code erodes quality or security                                                                   |  M  |  H  | Agents work only through issues with acceptance criteria; same CI gates; founder review of every diff; second pass on security/data paths; lint rules for recurring mistakes; no agent access to production or secrets                                                                                        | A security finding traced to unreviewed generated code                   |
| R21 | Self-host support load swamps a solo maintainer                                                                   |  M  |  M  | `huriro doctor`, opinionated single supported topology, community forum, issue templates that require `doctor` output, docs-first answers; paid support only via the cloud offering                                                                                                                           | Support time > 20% of a cycle                                            |
| R9  | Supply-chain compromise (npm, CI actions, images)                                                                 |  M  |  H  | Lockfile, 7-day release cooldown, full-SHA workflow pins, digests, SBOM, signing, no install scripts                                                                                                                                                                                                          | Any advisory in a direct dependency                                      |
| R10 | Control-panel / host compromise (root-equivalent)                                                                 |  M  |  H  | Panel not publicly exposed, patched, 2FA, isolated networks, no Docker socket in app containers, host firewall                                                                                                                                                                                                | New critical advisory                                                    |
| R11 | Tenant data leak via a missing `WHERE`/policy                                                                     |  M  |  H  | RLS + FORCE, non-owner role, `withWorkspace` wrapper, two-tenant tests per table, BOLA tests                                                                                                                                                                                                                  | Any cross-tenant test failure                                            |
| R12 | Prompt-injection-driven exfiltration                                                                              |  H  |  H  | Read-by-default scopes, human approval for writes, no URL-fetch tools, egress control, untrusted-content envelopes, injection corpus in CI                                                                                                                                                                    | Any anomaly in agent tool-call volume                                    |
| R13 | Backups exist but don't restore                                                                                   |  M  |  H  | Monthly automated restore drill with assertions; RTO measured, not assumed                                                                                                                                                                                                                                    | Any failed drill = sev-2                                                 |
| R14 | Browser storage eviction loses offline data                                                                       |  M  |  L  | Request persistent storage; treat local store as cache + queue; full resync path                                                                                                                                                                                                                              | Eviction events in RUM                                                   |
| R15 | Search relevance disappoints                                                                                      |  M  |  M  | RRF fusion, iterative vector scans, per-language configs, relevance eval set + offline ranking tests                                                                                                                                                                                                          | "No results found" rate > 15%                                            |
| R16 | Licensing landmines (AGPL mail server, paid editor features, MPL)                                                 |  M  |  M  | License allowlist in CI, ADR per exception, keep paid features optional                                                                                                                                                                                                                                       | Any new copyleft dependency                                              |
| R17 | Migration hazard on large tables                                                                                  |  M  |  M  | Squawk lint, expand/contract, `lock_timeout`, online index builds, dry runs on staging-sized data                                                                                                                                                                                                             | Any migration > 1 s lock on a hot table                                  |
| R18 | Cost surprise on AI/egress                                                                                        |  M  |  L  | Per-workspace budgets, metering, caching, self-host fallback to local models                                                                                                                                                                                                                                  | Any workspace > 80% of budget                                            |

### 24.2 Decision log (an ADR is written for each before the owning milestone starts)

All owners are the founder until the team grows. "Decided" rows still get an ADR so the reasoning survives.

| ADR  | Decision                                                | Status                                                                                                     | Needed by        |
| :--- | :------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------- | :--------------- |
| 0001 | Monorepo task runner                                    | **Decided:** Turborepo                                                                                     | M0               |
| 0002 | Web local store                                         | **Decided (v1.1):** TanStack DB + SQLite on OPFS; benchmark kept as the G1 check                           | M1               |
| 0003 | Auth library + exit criteria                            | **Decided:** Better Auth for identity only; exit plan documented                                           | M0               |
| 0004 | Sync ordering: counter-row cursor vs CDC watermark      | **Decided:** counter row; CDC is the documented scale path                                                 | M1               |
| 0005 | Elysia version                                          | **Decided (v1.1):** start on Elysia 2 RC, pinned; re-evaluate at G1 if not GA                              | M0               |
| 0006 | Editor: TipTap MIT core vs BlockNote vs raw ProseMirror | **Decided:** TipTap MIT core; comments built in-house                                                      | M2               |
| 0007 | Authorization: relational ACL vs OpenFGA/SpiceDB        | **Decided for v1:** relational ACL; revisit after GA                                                       | M0               |
| 0008 | Mail provider phasing and Gmail/Graph compliance path   | Open                                                                                                       | M3 (submissions) |
| 0009 | Desktop shell: Tauri 2 vs Electron vs PWA only          | **Decided for v1:** PWA only                                                                               | post-GA          |
| 0010 | AI providers + default embedding model                  | Open (default must run locally for self-host)                                                              | M3               |
| 0011 | Mobile doc editing: DOM component vs read-only native   | Leaning DOM component (shared editor)                                                                      | M6               |
| 0012 | Cloud billing provider                                  | Open                                                                                                       | M5               |
| 0013 | Feature flags                                           | **Decided:** in-house, server-evaluated, typed (no third-party service — self-host must not depend on one) | M0               |
| 0014 | Observability default for self-host                     | **Decided (v1.1):** logs + `/metrics`; OTLP optional                                                       | M0               |
| 0015 | Project license                                         | **Decided (v1.1):** AGPL-3.0 server/apps, MIT SDK/CLI/schemas, DCO                                         | M0               |
| 0016 | i18n library                                            | **Decided (v1.1):** Lingui                                                                                 | M0               |
| 0017 | Tool registry + agent principals model                  | **Decided (v1.1):** §13.1a; risk tiers §13.5                                                               | M3               |
| 0018 | Packaging: one image with roles + minimal compose       | **Decided (v1.1):** §5.1, §19.2                                                                            | M0               |

---

## Appendix A — Defects in the Original Sketch

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

---

## Appendix B — Sources

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

---

## Appendix C — Revision log (v1.0 → v1.1)

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
