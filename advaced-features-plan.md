# Huriro — Version 2 Advanced Features Plan

**Expanding Huriro v1 into a category-leading modern team platform: Linear-grade Tasks, Notion-grade Docs, Slack-grade Chat, Front/Superhuman-grade Mail, and unified agentic workflows.**

|                    |                                                                                                                               |
| :----------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| **Status**         | Draft v2.0 — implementation-ready blueprint (builds on Huriro v1.0 GA)                                                        |
| **Builds On**      | `master-development-plan.md` (v1.1, Milestones M0–M6 completed)                                                               |
| **Date**           | 25 November 2026                                                                                                              |
| **Owner**          | Solo founder-engineer working with AI coding agents (scales cleanly to a small team; see §9)                                  |
| **License**        | AGPL-3.0 (server + apps) · MIT (client SDKs, CLI, MCP tool schemas, design tokens)                                            |
| **Review cadence** | Re-validate version pins, bundle budgets, and risk register at the start of every milestone (M7–M12)                          |
| **Scope**          | V1→V2 parity gap analysis → 4 core pillar expansions → cross-pillar platform → sync/data/perf architecture → roadmap & ADRs   |

> **How to read this document.** Section 1–2 establish the Version 2 thesis, benchmark gaps against category leaders (Linear, Notion, Slack, Front/Missive/Superhuman), and strict architectural guardrails. Sections 3–6 detail the advanced feature specs, UX contracts, keyboard maps, and data schemas for **Tasks**, **Docs**, **Chat**, and **Mail**. Section 7 specifies the **cross-pillar platform superpowers** that separate tools cannot replicate. Section 8 covers **Sync Engine v2**, **RLS/permissions**, **bundle budgets**, **Tauri 2 desktop**, **mobile parity**, and **enterprise SSO/SCIM**. Sections 9–10 provide the **M7–M12 milestone roadmap (Gates G7–G12)**, **ADRs (0026–0033)**, and **Risk Register (R22–R31)**.

---

## Table of Contents

1. [Executive Summary & Version 2 Thesis](#1-executive-summary--version-2-thesis)
2. [Category-Leader Benchmark Matrix, Guardrails & Explicit Non-Goals](#2-category-leader-benchmark-matrix-guardrails--explicit-non-goals)
3. [Pillar 1 — Tasks v2 (Linear-Class Issue Tracking & Product Planning)](#3-pillar-1--tasks-v2-linear-class-issue-tracking--product-planning)
4. [Pillar 2 — Docs v2 (Notion-Class Block Authoring, Structured Databases & Knowledge Graph)](#4-pillar-2--docs-v2-notion-class-block-authoring-structured-databases--knowledge-graph)
5. [Pillar 3 — Chat v2 (Slack-Class Real-Time Messaging & Async/Sync Collaboration)](#5-pillar-3--chat-v2-slack-class-real-time-messaging--asyncsync-collaboration)
6. [Pillar 4 — Mail v2 (Front / Missive / Superhuman-Class Shared & Personal Inbox)](#6-pillar-4--mail-v2-front--missive--superhuman-class-shared--personal-inbox)
7. [Cross-Pillar Platform Superpowers (The Huriro Advantage)](#7-cross-pillar-platform-superpowers-the-huriro-advantage)
8. [Architecture, Sync Engine v2, Security, Client Platforms & Performance](#8-architecture-sync-engine-v2-security-client-platforms--performance)
9. [V2 Roadmap, Milestones (M7–M12) & Exit Criteria (G7–G12)](#9-v2-roadmap-milestones-m7m12--exit-criteria-g7g12)
10. [V2 Architecture Decision Records (ADR-0026 → ADR-0033) & Risk Register](#10-v2-architecture-decision-records-adr-0026--adr-0033--risk-register)

---

## 1. Executive Summary & Version 2 Thesis

### 1.1 Where Version 1 Landed (Ground-Truth Baseline)

Huriro v1 (`M0–M6`) delivered the complete architectural spine and core workflows across a single modular monolith (`apps/server` with `api`, `worker`, `realtime`, `all` roles), local-first clients (`apps/web` via TanStack Start + TanStack DB on OPFS; `apps/mobile` via Expo SDK 58 + Uniwind + `expo-sqlite`), and PostgreSQL 18.7+ with structural multi-tenancy:

| Pillar / Layer        | Implemented v1 Baseline (Verified in Repository)                                                                                                                                                              |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Spine & Security**  | Better Auth identity (email, passkeys, TOTP, OAuth 2.1 + MCP/CIMD), relational RBAC + `acl_entries`, `withWorkspace` / `huriro_app` + `ENABLE/FORCE RLS` across 73 tenant tables (`packages/test-utils/src/rls.ts`), outbox + pg-boss, `change_log` + `workspace_seq`, idempotency keys, audit log, `huriro` CLI, Lingui (EN/FR/RW), DTCG OKLCH tokens (`packages/design-tokens`). |
| **Tasks (`tasks`)**   | `projects`, `project_statuses`, `labels`, `cycles`, `issues` (with `parent_id`, `start_date`, `due_date`, `estimate`, fractional `position`), `issue_relations` (`blocks`, `relates_to`, `duplicates`), `issue_comments`, `saved_views` (`list` & `board`), `My work` view, GitHub App two-way issue sync (`integrations`), Linear/GitHub/Jira importers. |
| **Docs (`docs`)**     | Hierarchical `doc_pages` (materialized path + fractional `position`, favorites, templates), `doc_state` (Yjs 13 + Hocuspocus 4 rooms with `doc_room_leases` epoch fencing), `doc_versions` (auto checkpoints + named + diff + restore), `doc_comments` (Yjs `RelativePosition` anchors), TipTap v3 MIT extensions (`BlockIdExtension`, `CalloutExtension`, `ToggleExtension`, `EntityMentionExtension`, `EmbedExtension`, `ReferenceBlockExtension`, `CommentAnchorMark`), Markdown import/export, Notion importer. |
| **Chat (`chat`)**     | `chat_channels` (`public`, `private`, `dm`), `chat_channel_members`, `chat_messages` (per-channel `last_msg_seq` & `last_rev` + `thread_seq`, `client_id` dedupe), `chat_message_reactions`, `chat_read_state`, `chat_thread_read_state`, `chat_message_attachments` (`files` quarantine), `chat_link_previews` (SSRF-safe unfurl), typing/presence signals, Slack importer. |
| **Mail (`mail`)**     | `mail_inboxes`, `mail_accounts` (`inbound_parse`, `gmail`, `graph`, `imap`, `jmap` enum), `mail_identities`, `mail_conversations`, `mail_messages` (MIME parsing + sandboxed iframe HTML + SPF/DKIM/DMARC verdicts), `mail_conversation_events`, `mail_conversation_comments` (internal notes), `mail_drafts` (soft-lock + scheduled/undo send), `mail_conversation_tasks`, `mail_conversation_docs`, merge + convert-to-issue. |
| **AI, Search & MCP**  | Hybrid FTS + `pgvector` `halfvec` (`chunk_embeddings`), `ai_providers` (OpenAI-compatible + Ollama BYOK) + `ai_runs` / `ai_cache`, `agent_principals`, `agent_approvals` (R0–R3 risk tiers), `agent_tool_calls`, `agent_undo_log`, `agent_status_reports`, `agent_api_keys`, `packages/agent-tools` unified registry, `Mod+K` command palette (`packages/domain/src/search-query.ts`). |

### 1.2 The Version 2 Thesis

Version 1 proved that **one local-first, permission-unified workspace** can replace four disconnected tools at the foundational level. However, teams migrating daily work from **Linear**, **Notion**, **Slack**, and **Front / Missive / Superhuman** judge a workspace by day-to-day ergonomic craft and workflow depth:

- Engineers expect **Linear's** triage inbox, multi-select bulk bar, grouped board swimlanes, cycle burnup charts, zoomable project roadmaps, initiatives, magic git branches, and auto-status PR transitions.
- PMs and writers expect **Notion's** multi-column layouts, drag-handle block menus, synced blocks, Mermaid/LaTeX, suggestion mode, wiki verification, teamspaces, and **structured relational databases with formulas, rollups, and multi-view embeds**.
- Collaborators expect **Slack's** rich composer, slash commands, custom emoji, broadcast thread replies, synced drafts, scheduled send, "Later" reminders, custom sidebar sections, channel canvases, user groups, interactive polls, voice clips, and quick audio/screen huddles.
- Support and customer-facing teams expect **Front / Missive / Superhuman's** real-time co-edited drafts with approval review, `;snippet` macros, proactive outbound compose, follow-up reminders ("if no reply"), tags, round-robin routing, SLA timers, customer organization sidebars, and private-until-shared inboxes.

**The V2 thesis:** Close the craft and workflow gap with all four category leaders while preserving every V1 invariant — **one relational source of truth**, **one policy/RLS boundary**, **local-first sub-frame mutations**, **zero paywalled features (AGPL-3.0)**, and a **deploy-anywhere footprint**. Crucially, V2 unlocks capabilities four separate SaaS vendors can never offer natively: a **Unified Cross-Entity Graph (`entity_links`)**, a **Cross-Pillar Workflow Automation Engine**, **Grounded AI Teammates** operating across all four surfaces with human-in-the-loop safety, and a **Single Local-First Desktop & Mobile Workspace**.

### 1.3 Strategic V2 Decisions

| Decision                        | V2 Choice                                                                                                                                                                             | Rationale                                                                                                                                                                                 |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Structured Docs Databases**   | **Relational Postgres tables** (`doc_databases`, `doc_database_properties`, `doc_database_rows`, `doc_database_cell_values`, `doc_database_views`) synced via lazy TanStack DB collections + pure-TS AST formula engine in `packages/domain`. | Embedding 10,000-row databases inside a Yjs `doc_state` binary blob blows past the 10 MB CRDT guard (§10.2) and breaks SQL filtering/RLS. Relational rows keep CRDT state small while optional `row.page_id` gives every row a collaborative page. |
| **Suggestion Mode (Docs)**      | **In-house MIT ProseMirror marks** (`SuggestionInsertMark`, `SuggestionDeleteMark`) inside `packages/editor` synced via Yjs + `doc_suggestions` index table.                         | TipTap's Track Changes / Comments add-ons are proprietary paid packages (`ADR-0006` / §2.5 forbid paywalling self-host features). Marks inside Yjs merge cleanly across concurrent editors. |
| **Collaborative Mail Drafts**   | Reuse **Hocuspocus 4 + Yjs** rooms (`mail_draft:<ws>:<id>`) with `draft_state` persistence, keeping V1 soft-locks as offline/single-user fallback.                                    | Eliminates lock contention when two teammates co-write a sensitive customer reply, using infrastructure already running in `apps/server` (`role=realtime`).                                 |
| **Workflow Automations**        | New **`automations` server module** consuming transactional `outbox` events + cron triggers, executing under scoped `automation` principals with `x_automation_depth <= 5` recursion caps. | Reuses V1's transactional outbox (`§8.5`) and `FilterExpr` AST without introducing a separate workflow cluster or unsafe arbitrary JS evaluation.                                          |
| **Live Audio/Screen Huddles**   | **Async voice/screen clips** built natively on `files` + optional **LiveKit OSS (Apache-2.0)** sidecar enabled via `HURIRO_HUDDLES_ENABLED=1` and Compose `--profile huddles`.        | Minimal self-host installs (`Huriro + Postgres`) remain lightweight and unchanged; teams wanting Slack-style live audio/screen huddles enable one Apache-2.0 container.                    |
| **Desktop Application**         | **`apps/desktop` thin Tauri 2.x shell** wrapping the `apps/web` static build (superseding `ADR-0009` PWA-only v1 scope).                                                              | Delivers global quick-capture (`Alt+Space`), native tray/dock badges, OS notifications with quick-reply, `huriro://` deep links, and multi-window workflows without a second UI codebase. |
| **Sync Engine at V2 Scale**     | **Two-tier sync in `packages/sync-client`**: eager core workspace collections at boot + **scoped/lazy hydration** for DB rows, archived issues, and full activity histories, backed by OPFS/SQLite LRU eviction. | Prevents large V2 workspaces (50k issues, 25k DB rows) from exhausting browser RAM or exceeding the 1.5 s cold-start budget.                                                               |

### 1.4 What "Done" Looks Like at v2.0

1. **Triage-to-Ship Loop:** An intake form submission or customer email enters a project's **Triage Queue**; keyboard triage accepts it, links the customer org, starts a branch (`Mod+Shift+.`), tracks CI checks on the PR/MR, auto-transitions status on merge, and alerts the linked customer conversation with an AI-drafted reply ready for 1-click human approval.
2. **Product Planning:** Leadership tracks company **Initiatives** across multi-project **Timelines/Roadmaps**, **Milestones**, weekly status updates, **Cycle Burnup/Scope-Creep** charts, **SLAs**, and **Insights** analytics.
3. **Notion-Class Docs & Databases:** Writers compose multi-column pages with drag-handle reordering, **Synced Blocks**, **Mermaid** diagrams, **KaTeX** math, **Suggestion Mode** diffs, **Wiki Verification** expiry badges, and embed **Live Linked Views** of 10,000-row **Relational Databases** with deterministic formulas and rollups — while `apps/web` initial shell stays `<= 200 KB` gzip.
4. **Slack-Class Chat:** Teams organize channels into **Custom Sidebar Sections**, pin a **Channel Canvas** backed by Yjs docs, schedule messages, triage **Saved for Later** reminders, react with custom workspace emoji, vote in native polls, send **broadcast thread replies**, drop async transcribed voice/screen clips, and optionally hop into a **LiveKit Huddle**.
5. **Front/Superhuman-Class Mail:** Support teams co-edit replies live in **Yjs-backed drafts**, request **draft approval** before sending, trigger `;snippets` and multi-step **Macros**, rely on **Round-Robin Routing** respecting DND/WIP limits and **SLAs**, inspect **Contacts & Organizations** alongside linked Issues, and isolate personal mailboxes until shared.
6. **Unified Cross-Pillar Platform:** Any entity links to any other via `entity_links` with **Hover Peek Cards**; **Workflow Automations** connect Mail ↔ Chat ↔ Tasks ↔ Docs visually and via YAML; the **Workspace Assistant** (`Mod+Shift+A`) streams grounded answers and R1/R2 tool actions across every pillar.
7. **Desktop & Mobile Craft:** **Tauri 2.x** desktop ships with global quick-capture and split-pane multitasking; **Expo Mobile v2** ships swipe triage, offline database views, native voice notes, and actionable push notifications while keeping `>= 60%` shared TypeScript client code in `packages/*`.

---

## 2. Category-Leader Benchmark Matrix, Guardrails & Explicit Non-Goals

### 2.1 Benchmark Matrix (V1 Baseline vs. V2 Target)

| Pillar | Reference | Shipped in V1 (`M0–M6`) | Added in V2 (`M7–M12`) | Huriro Cross-Pillar Differentiator |
| :--- | :--- | :--- | :--- | :--- |
| **Tasks** | **Linear** | Projects, custom statuses, labels, basic cycles, issues/sub-issues, relations, comments, List + Board (`position`), My Work, GitHub issue two-way sync | **Triage Queue**, **Intake Forms**, **Customer Requests**, **Initiatives & Project Updates**, **Milestones**, **Timeline/Roadmap & Calendar** views, **Cycle Burnup & Auto-Rollover**, **Multi-select Bulk Bar**, **Grouping/Swimlanes & Inline Sub-issue Trees**, **Compound Filter AST**, **Issue Templates & Recurring Issues**, **Typed Custom Fields**, **GitHub PR/CI + GitLab Adapter + Auto-Status**, **Watchers, Diff Activity, SLAs, Insights** | Customer requests unify directly with Mail `contacts`; Issues embed live inside Docs Linked Views and Chat/Mail cards; AI Agents are first-class assignable principals. |
| **Docs** | **Notion** | Hierarchical `doc_pages`, Yjs + Hocuspocus live collab, `doc_versions`, anchored `doc_comments`, toggles/callouts/tables/code/embeds/mentions/reference blocks, templates, favorites, MD import/export | **Structured Relational Databases** (16+ property types, sandboxed **Formulas**, **Relations & Rollups**, 6 views: Table/Board/Gallery/Calendar/Timeline/List, **Synced Linked Views**), **Multi-Column Blocks**, **Drag Handle & Block Action Menu**, **Synced Blocks**, **Resizable Tables**, **Mermaid & KaTeX**, **Toggle Headings, Covers, Page Styles & Locks**, **In-House Suggestion Mode**, **Wiki Verification & Freshness**, **Backlinks & Knowledge Graph**, **Teamspaces**, **Publish to Web & PDF/ZIP Export** | Databases natively relate to live Huriro **Issues** and **Mail Conversations**; Suggestion Mode is the exact diff vehicle used by the Docs AI writer; Channel Canvases are Yjs `doc_pages`. |
| **Chat** | **Slack** | Public/private channels, 2–8 member DMs, threads (`thread_seq`), reactions, quarantined attachments, SSRF-safe link previews, rich links (`issue:`/`doc:`/`conversation:`), unread/mention state, presence/typing | **Rich Composer & Formatting**, **Slash Commands**, **Custom Workspace Emoji**, **Broadcast Thread Replies**, **Quoted Replies & Forwarding**, **Synced Drafts**, **Scheduled Messages**, **Saved for Later / Reminders**, **Custom Sidebar Sections**, **Channel Bookmarks & Pins**, **Channel Canvas**, **Custom User Statuses, DND & User Groups**, **Keyword Alerts & Per-Channel Notify Levels**, **Native Polls & Approval Cards**, **Async Voice/Screen Clips + Transcription**, **Optional LiveKit Audio/Screen Huddles** | One-click message → **Triage/Issue** with bi-directional status updates; **Interactive Agent Approval Cards** inside DMs/channels; Channel Canvas automatically inherits channel membership ACLs. |
| **Mail** | **Front / Missive / Superhuman** | Shared inboxes, IMAP/Graph/Gmail/Inbound-parse, identities, threaded conversations, assignment, internal notes, soft-locked drafts, undo-send, convert-to-issue, merge, sandboxed HTML + SPF/DKIM/DMARC | **Yjs Collaborative Drafts**, **Draft Review/Approval Gate**, **Canned `;Snippets` & Merge Variables**, **Multi-Step Macros**, **Proactive Outbound Compose, Forward & Thread Split**, **Send Later & "If No Reply" Follow-Up Reminders**, **Bulk Triage & Split-Inbox Tabs**, **Tags, Round-Robin Routing & Mail SLAs**, **Inbox Analytics**, **Contacts & Organizations Context Sidebar**, **Bidirectional Issue ↔ Mail Resolution Loop**, **Guarded Mail AI Copilot**, **Private Connected Inboxes**, **Stalwart JMAP Profile** | Customer context sidebar pulls live Huriro Issues & Docs without a separate CRM; closing a linked engineering Issue automatically notifies the Support thread and prepares a grounded customer draft. |
| **Platform** | **Unified Workspace** | `Mod+K` palette, FTS + `pgvector` semantic search, In-app/email/push notifications, MCP `2026-07-28`, CLI, BYOK AI gateway, Web PWA + Expo Mobile | **Unified `entity_links` Graph + Hover Peeks**, **Visual + YAML Cross-Pillar Automation Engine**, **AI Assistant Panel (`Mod+Shift+A`) + Expanded V2 Agent Tools + Live Run Inspector**, **Inbox v2 Triage + My Day Agenda + iCal Feeds**, **Search DSL v2 + Attachment Text Extraction**, **Sync Engine v2 Lazy Hydration**, **Tauri 2.x Desktop App + Split-Pane Web**, **SAML/OIDC SSO + SCIM 2.0** | One permission model (`can()` + RLS), one local replica (`TanStack DB`), and one transactional outbox power all four pillars and every AI/automation principal. |

### 2.2 V2 Architectural Guardrails (Preserving V1 Invariants)

1. **Five Primary Destinations Law (`§17.2`):** Navigation remains anchored strictly on **`Inbox` · `Issues` · `Docs` · `Chat` · `Settings`**. Every V2 capability slots cleanly inside those destinations (e.g., *Triage* and *Initiatives/Roadmaps* under `Issues`; *Databases* and *Teamspaces* inside `Docs`; *Later*, *Drafts*, and *Canvas* inside `Chat`; *Contacts* and *Analytics* inside `Inbox → Shared` / `Mail`; *Automations*, *Custom Fields*, and *SSO/SCIM* inside `Settings` or contextual headers). *My Day* lives in `Home` / `Issues → My Work`, not as a sixth top-level tab.
2. **Initial Web Shell `<= 200 KB` Gzip (`check:bundles`):** Heavy V2 dependencies (Timeline/Gantt grid, Recharts/visx analytics, Database table/gallery virtualizers, Formula editor autocomplete, Mermaid, KaTeX, Knowledge Graph canvas, LiveKit WebRTC SDK, Visual Automation builder) **must** reside behind dynamic `import()` route/component boundaries (see §8.3).
3. **`>= 60%` Shared TypeScript Client Code (`check:shared-code`):** Pure logic — Compound Filter AST compilation/evaluation, Formula lexer/parser/evaluator, RRULE recurrence generation, Business-hours SLA calculator, Search Query DSL, Sync Engine v2 lazy hydration, and TypeBox contracts — lives in `packages/domain`, `packages/contracts`, `packages/editor`, `packages/sync-client`, and `packages/agent-tools`, never duplicated inside `apps/web`, `apps/desktop`, or `apps/mobile`.
4. **Structural Tenant Isolation & Transactional Consistency (`§4.2`):** Every new tenant table declares `workspace_id`, `UNIQUE (workspace_id, id)`, composite tenant FKs `(workspace_id, x_id)`, `ENABLE + FORCE ROW LEVEL SECURITY`, a `packages/test-utils/src/rls.ts` entry, and two-tenant deny-path tests. Every mutation writes domain rows + `outbox` + `audit_log` (if security-relevant) + `change_log` (cursor allocated last) in one transaction under `withWorkspace`.
5. **Zero Paywalled Features & Zero Proprietary Editor Lock-In (`§2.5`, `ADR-0006`):** All V2 capabilities ship in the single AGPL-3.0 server/app codebase (MIT for client SDKs, CLI, MCP schemas, tokens). No paid TipTap Pro extensions or enterprise-only mail/workflow servers are required.
6. **API / CLI / MCP Parity & Accessibility:** Every V2 read/write operation goes through module service interfaces (`ActorContext`), exposes OpenAPI 3.1 endpoints with `Idempotency-Key` support and RFC 9457 `problem+json` errors, generates `huriro` CLI commands, registers scoped `packages/agent-tools` definitions (R0–R3), uses Lingui `t()` catalogs + RTL logical CSS (`ms-*`/`me-*`), and enforces WCAG 2.2 AA (keyboard equivalents for every drag, swipe, resize, and block reorder).

### 2.3 Explicitly Out of Scope for V2

To keep the V2 scope crisp and prevent multi-year sprawl:

- Full **CRM sales pipeline** (deal stages, revenue forecasting, billing invoices, call dialers) beyond lightweight `contacts` & `contact_organizations` for Mail and Customer Requests.
- **Spreadsheet / Excel calculation engine** (multi-sheet cell ranges `A1:Z99`, pivot tables, macros) — Docs Databases are structured record collections like Notion, not arbitrary cell-grid spreadsheets.
- **Scheduled multi-host video conferencing** (waiting rooms, webinar breakout rooms, cloud recording transcode farms) — Chat Huddles are lightweight audio/screen rooms via optional LiveKit.
- **Full CalDAV server / Google Calendar replacement** — V2 ships Calendar *views* over Issues/Databases and signed read-only **iCal/WebCal** feeds, not two-way external calendar sync or room booking.
- **Zero-knowledge client-side E2EE** of workspace content (incompatible with server-side FTS/semantic search, automations, and permission-filtered delta sync; deferred per V1 `§22.6`).
- **Active-active multi-region writes** or **arbitrary user-authored server-side JS plugins** (all extensibility runs through declarative Automations, Webhooks, and OAuth/MCP Agents).

---

## 3. Pillar 1 — Tasks v2 (Linear-Class Issue Tracking & Product Planning)

### 3.1 Triage Queue & Customer Intake

V1 treats every newly created issue identically. Linear's core operational advantage is a dedicated **Triage Queue** separating unvetted incoming requests (support emails, intake forms, Slack messages, GitHub issues, agent proposals) from committed engineering backlogs.

- **Triage Lifecycle:** Add `triage_status` (`none | pending | accepted | snoozed | declined | merged`), `triage_snoozed_until`, `triage_declined_reason`, and `source_kind` (`manual | mail | chat | form | github | gitlab | api | agent`) to `issues` (expanded cleanly via expand→migrate→contract).
- **Split-Screen Triage Inbox (`Issues → <Project> → Triage`):** Keyboard-driven queue showing source context (linked email snippet, Slack permalink, or intake form payload) alongside instant **AI Triage Suggestions** (non-destructive chips suggesting likely duplicates via `pgvector` similarity, priority, labels, and owner).
- **Single-Key Triage Actions:** `A` Accept into backlog/todo (clears `triage_status = 'accepted'`), `H` Snooze until date/time (pg-boss wakes back to `pending`), `M` Merge into duplicate (`issue_relations(kind='duplicates')`, copies watchers/customer links/comments, closes source), `D` Decline with canned reason (notifies external requester if linked to intake/mail), `I` Assign, `P` Priority, `L` Label.
- **Intake Forms (`intake_forms`):** Project-scoped form definitions mapping custom form fields (`title`, `description`, `custom_fields`, `attachments`) into Triage. Forms support **workspace-authenticated** submission or **signed unauthenticated intake links** (HMAC token, strict IP/workspace rate limit, attachment quarantine, no CAPTCHA bypassing — respects workspace abuse settings).
- **Customer Requests (`customer_requests`):** Links any `contact_organization` (shared with Mail v2 §6.4) to an `issue` with `importance` (`low | medium | high | urgent`) and an optional note/quote, surfacing `"Requested by 6 customers · $48k ARR"` (optional metadata) directly on issue rows and priority sorts.

### 3.2 Initiatives, Project Milestones & Zoomable Timeline / Roadmap + Calendar Views

- **Initiatives (`initiatives`, `initiative_projects`):** Cross-project strategic containers (e.g., *"Q1 Reliability"*, *"Enterprise Readiness"*) with owner, target quarter/date, health rollup (`on_track | at_risk | off_track`), rich description, and many-to-many ordering across `projects`.
- **Project Status Updates (`project_updates`):** Structured weekly pulse updates (`health`, ProseMirror body, automatic snapshot of completed/total issues & scope change) with reminder cadence and Slack/Inbox digests.
- **Project Milestones (`project_milestones`):** Ordered checkpoints inside a project (`name`, `description`, `target_date`, `status: 'planned' | 'completed' | 'missed'`, `position`); `issues.milestone_id` links deliverables to milestones with percentage completion bars.
- **Saved Views Upgrade (`saved_views.layout`):** Expand `'list' | 'board'` to `'list' | 'board' | 'timeline' | 'calendar' | 'table'`.
- **Timeline / Roadmap View (Lazy Chunk `timeline-chunk`):**
  - Zoom scales: **Week · Month · Quarter · Year**, with "Today" vertical hairline and collapsible Initiative → Project → Milestone → Issue hierarchy.
  - Visualizes `start_date`..`due_date` bars, milestone diamond markers, and SVG dependency arrows for `issue_relations(kind='blocks')` (highlighting critical-path conflicts in `--warning` / `--destructive`).
  - Direct pointer drag on bar edges resizes dates optimistically; **WCAG 2.2 AA keyboard parity**: `[` / `]` shifts selected bar by 1 day (`Shift+[` / `]` by 1 week), `Enter` opens inline date-range editor.
- **Calendar View:** Month and Week grid plotting issues by `due_date` (or `start_date..due_date` span) with overdue badges and drag/keyboard date moves.

### 3.3 Full Cycles Engine (Sprints, Velocity, Scope Creep & Auto-Rollover)

V1 created the `cycles` table and issue FK; V2 turns it into an automated planning engine:

- **Project Cycle Policy:** Columns on `projects` (`cycle_enabled`, `cycle_duration_days`, `cycle_cooldown_days`, `cycle_auto_rollover_mode: 'next_cycle' | 'backlog' | 'none'`, `cycle_start_weekday`). A nightly pg-boss worker auto-activates planned cycles, pre-creates the next N cycles, and rolls over incomplete non-cancelled issues when a cycle closes (emitting `cycle.rolled_over` outbox events + `issue_activity` entries).
- **Daily Snapshots (`cycle_daily_snapshots`):** Nightly worker snapshots per active cycle: `{ total_issues, completed_issues, started_issues, total_estimate, completed_estimate, scope_added_count, scope_removed_count }`.
- **Burnup & Scope-Creep Charts (`charts-chunk`):** Interactive Recharts/visx graph on every Cycle header showing ideal burn line, completed scope, and total scope line (revealing mid-sprint scope creep immediately), plus a 6-cycle **Velocity Bar Chart** (issues & points completed per cycle) and **1-Click AI Cycle Summary** (auto-drafting a doc or chat update from completed issues & linked PRs).

### 3.4 Linear-Grade Speed: Multi-Select, Grouping/Swimlanes, Inline Sub-Issue Trees & Compound Filter AST

- **Multi-Select + Floating Bulk Action Bar:** Selecting issues with `Space`, `Shift+Click`, `Shift+J/K`, or `Mod+A` reveals a bottom floating action bar (Status, Priority, Assignee, Cycle, Milestone, Labels, Move Project, Delete) executing an atomic **`POST /api/v1/issues/bulk`** call (capped at 200 issues, writing a single `change_log` batch and 10-second `Mod+Z` Undo toast).
- **Rich View Display Options (`saved_views.display_options` JSONB):**
  - `groupBy`: `status | assignee | priority | label | cycle | milestone | project | none`
  - `subGroupBy`: `assignee | priority | label | none` (true **2D Board Swimlanes**, e.g., columns = Status, rows = Assignee or Priority!)
  - `sortBy` + `sortDirection`: `manual` (fractional `position`), `priority`, `due_date`, `updated_at`, `created_at`, `estimate`
  - `visibleProperties`: toggle badges (`id`, `priority`, `status`, `assignee`, `labels`, `cycle`, `milestone`, `due_date`, `estimate`, `pr_status`, `sla`, `customer_count`)
  - `showSubIssues`: `'nested'` (expandable tree rows directly inside List view with keyboard `→`/`←` expand/collapse) | `'flat'` | `'hidden'`
- **Compound Filter AST (`packages/domain/src/filter-ast.ts`):** Replace V1's flat `SavedViewFilters` object with a recursive boolean AST (`AND` / `OR` / `NOT` over typed predicates: status category, priority, assignee, labels, cycle, milestone, custom fields, relative dates `due < +7d` / `updated > -48h`, `has:pr`, `has:customer`, `triage_status`). One pure TypeScript module compiles `FilterExpr` to parameterized Drizzle SQL on the server AND evaluates `FilterExpr` locally against TanStack DB collections in `< 5 ms`.

### 3.5 Issue Templates, Recurring Issues & Typed Custom Fields

- **Issue Templates (`issue_templates`):** Project- or workspace-scoped presets (`name`, `description`, `default_title_prefix`, `default_body` ProseMirror JSON, `default_priority`, `default_status_id`, `default_assignee_id`, `default_label_ids`, `default_sub_issues` JSONB blueprint). Invocable from `CreateIssueDialog` (`C` → template picker) or Intake Forms.
- **Recurring Issues (`recurring_issues`):** RRULE + timezone + `next_run_at` + `template_id` (or inline payload). A pg-boss worker evaluates due occurrences and inserts issues idempotently using `(recurring_issue_id, occurrence_date)` unique key — safe across worker restarts.
- **Typed Custom Fields (`custom_field_definitions`, `issue_custom_field_values`):**
  - Definitions scoped to `workspace` or `project`: `key`, `name`, `field_type` (`text | number | select | multi_select | date | checkbox | url | user`), `options` JSONB, `is_required`, `position`.
  - Values stored in **typed sparse columns** (`val_text`, `val_number`, `val_bool`, `val_date`, `val_json` for `multi_select` option IDs) with partial B-tree / GIN indexes — honoring §8.1 ("JSONB never for fields you filter or join on").

### 3.6 Deep Git & CI/CD Lifecycle (GitHub v2 + GitLab Adapter)

V1 implemented `github_installations` and `issue_github_links` for issue syncing (`packages/db/src/schema/integrations.ts`). V2 expands `integrations` to full PR/MR & CI workflow automation:

- **Magic Branch Name Generator (`Mod+Shift+.`):** Copies `git checkout -b <handle>/<proj>-<num>-<slug>` (configurable per workspace template) to clipboard and marks branch hint on the issue.
- **Unified VCS Links (`issue_vcs_links`):** Links issues to GitHub Pull Requests & Branches AND **GitLab Merge Requests & Branches** (`provider: 'github' | 'gitlab'`), storing `external_id`, `repo_full_name`, `pr_number`, `branch_name`, `pr_state` (`draft | open | merged | closed`), `review_state` (`pending | changes_requested | approved`), `ci_status` (`pending | passing | failing`), `preview_url`, and diff stats (`additions`, `deletions`).
- **Auto-Status Workflow Rules:** Per-project mapping (`on_branch_linked`, `on_pr_opened`, `on_pr_ready_for_review`, `on_pr_approved`, `on_pr_merged`, `on_pr_closed` → target `project_status_id`). When webhook delivery arrives (`github_webhook_events` / new `gitlab_webhook_events`), the worker transitions the linked issue inside `withWorkspace`, records `issue_activity`, and posts an optional backlink comment.

### 3.7 Issue SLAs, Subscriptions/Watchers, Unified Activity Diff Timeline & Insights

- **Watchers (`issue_watchers`):** Explicit subscribe/unsubscribe (`W` shortcut); auto-adds creator, assignee, and `@mentioned` teammates; drives targeted notifications without spamming an entire project.
- **Structured Activity Diff Ledger (`issue_activity`) & Comment Reactions (`issue_comment_reactions`):** Every mutation appends immutable structured diffs (`field`, `old_value`, `new_value`, `actor_type`, `actor_id`) rendered chronologically interleaved with comments and `agent_status_reports`.
- **Issue SLAs (`issue_sla_policies`):** Match issues via `FilterExpr` AST (e.g., `priority = urgent AND label = customer-bug`), compute `sla_response_due_at` and `sla_resolution_due_at` using the pure-TS **Business Hours Calendar** in `packages/domain`, stamp `issues.sla_status` (`on_track | at_risk | breached | met`), and emit warning outbox events at 75% elapsed time.
- **Insights Analytics (`Issues → Insights`, `charts-chunk`):** Interactive, filterable charts for **Cycle Time**, **Lead Time**, **Throughput** (completed issues/points by week), **Backlog Growth**, and **Workload Distribution** (humans vs. agent principals), with CSV export.

### 3.8 Tasks v2 Schema Snippets & Keyboard Map

```sql
-- Expand issues table (expand → migrate → contract)
ALTER TABLE issues
  ADD COLUMN milestone_id uuid,
  ADD COLUMN triage_status text NOT NULL DEFAULT 'none'
    CHECK (triage_status IN ('none','pending','accepted','snoozed','declined','merged')),
  ADD COLUMN triage_snoozed_until timestamptz,
  ADD COLUMN source_kind text NOT NULL DEFAULT 'manual',
  ADD COLUMN sla_policy_id uuid,
  ADD COLUMN sla_due_at timestamptz,
  ADD COLUMN sla_status text CHECK (sla_status IN ('on_track','at_risk','breached','met'));

-- Initiatives & milestones
CREATE TABLE initiatives (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description jsonb,
  health text NOT NULL DEFAULT 'on_track' CHECK (health IN ('on_track','at_risk','off_track','completed')),
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_date date,
  position text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id)
);

CREATE TABLE project_milestones (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  target_date date,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','completed','missed')),
  position text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);

-- Daily burnup snapshots for Cycles
CREATE TABLE cycle_daily_snapshots (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cycle_id uuid NOT NULL,
  snapshot_date date NOT NULL,
  total_issues int NOT NULL,
  completed_issues int NOT NULL,
  started_issues int NOT NULL,
  total_estimate numeric(10,2) NOT NULL DEFAULT 0,
  completed_estimate numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, cycle_id, snapshot_date),
  FOREIGN KEY (workspace_id, cycle_id) REFERENCES cycles (workspace_id, id) ON DELETE CASCADE
);

-- Typed sparse custom fields (filterable + indexable without JSONB scans)
CREATE TABLE custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid,
  key text NOT NULL,
  name text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text','number','select','multi_select','date','checkbox','url','user')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_required boolean NOT NULL DEFAULT false,
  position text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, key),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE issue_custom_field_values (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL,
  field_id uuid NOT NULL,
  val_text text,
  val_number numeric(18,4),
  val_bool boolean,
  val_date timestamptz,
  val_json jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, issue_id, field_id),
  FOREIGN KEY (workspace_id, issue_id) REFERENCES issues (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, field_id) REFERENCES custom_field_definitions (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_icfv_text ON issue_custom_field_values (workspace_id, field_id, val_text) WHERE val_text IS NOT NULL;
CREATE INDEX idx_icfv_num  ON issue_custom_field_values (workspace_id, field_id, val_number) WHERE val_number IS NOT NULL;

-- Structured activity diff ledger (exempt from version; append-only)
CREATE TABLE issue_activity (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user','agent','automation','system')),
  actor_id uuid,
  action text NOT NULL,
  field text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, issue_id) REFERENCES issues (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_issue_activity_issue ON issue_activity (workspace_id, issue_id, created_at DESC);
```

Additional Tasks v2 tenant tables (same composite-FK + RLS pattern): `initiative_projects`, `project_updates`, `issue_templates`, `recurring_issues`, `issue_vcs_links`, `issue_watchers`, `issue_comment_reactions`, `issue_sla_policies`, `intake_forms`, `customer_requests` (linking `contact_organizations` from §6.4).

| Scope          | Shortcut        | Action                                       |
| :------------- | :-------------- | :------------------------------------------- |
| Triage         | `A` / `D` / `M` | Accept / Decline / Mark duplicate & merge    |
| Triage         | `H`             | Snooze triage item until date                |
| Quick Assign   | `I` / `P` / `L` | Assign / Set priority / Toggle labels        |
| Quick Plan     | `Shift+P` / `Shift+C` | Set project / Add to cycle             |
| Git Flow       | `Mod+Shift+.`   | Copy magic Git branch name                   |
| Watch          | `W`             | Subscribe / unsubscribe to issue             |
| Timeline       | `[` / `]`       | Shift start/due dates by 1 day (`Shift` = 1w)|
| Selection      | `Shift+J` / `K` | Range-select issues for bulk action bar      |

---

## 4. Pillar 2 — Docs v2 (Notion-Class Block Authoring, Structured Databases & Knowledge Graph)

### 4.1 Inline & Full-Page Structured Databases (Relational, Not CRDT Blobs)

Notion's signature capability is turning pages into **structured databases** with multiple live views, relations, rollups, and formulas.

- **Why Relational Tables + Lazy Sync (`ADR-0026`):** Storing thousands of structured rows inside a Yjs `Y.Map` on `doc_state` causes unbounded binary growth (hitting the 10 MB cap from `§10.2`), prevents SQL indexing, and makes row-level permissions impossible. Instead:
  - Database schemas, views, and rows live in Postgres (`doc_databases`, `doc_database_properties`, `doc_database_rows`, `doc_database_cell_values`, `doc_database_views`).
  - Each `doc_database_rows` entry optionally references a `page_id` in `doc_pages` (`is_database_row = true`), lazily allocating `doc_state` only when the user opens the row's side-peek or full-page body!
  - Clients subscribe to a database via Sync Engine v2 **scoped hydration** (§8.1), keeping the initial workspace replica lightweight while delivering instant client-side sorting, grouping, and inline editing.
- **16+ Property Types:**
  - Core primitives: `title`, `text`, `number` (number, currency, percent, progress bar, ring), `checkbox`, `url`, `email`, `phone`, `date` (date/time + optional end date + reminder).
  - Option collections: `select`, `multi_select`, `status` (grouped into `to_do`, `in_progress`, `complete` buckets).
  - Workspace relations: `person` (user OR `agent_principal`), `file` (quarantined `files` links), `relation` (**to another `doc_database` OR natively to Huriro `issues`, `projects`, `mail_conversations`, or `contact_organizations`!**).
  - Computed properties: `rollup` (`count`, `sum`, `avg`, `min`, `max`, `percent_checked`, `unique_values` over any `relation`), `formula`, `created_time`, `created_by`, `updated_time`, `updated_by`.
- **Sandboxed Deterministic Formula Engine (`packages/domain/src/formula/`):**
  - Pure TypeScript recursive-descent lexer → typed AST parser → static cycle detector → bounded evaluator (`maxAstNodes = 256`, `maxEvalSteps = 2000`, `maxStringLen = 16_384`). **Zero `eval()`, zero `new Function()`, zero ambient side effects.**
  - Functions: arithmetic/math (`round`, `ceil`, `floor`, `abs`, `min`, `max`), string (`concat`, `contains`, `replace`, `slice`, `split`, `length`, `lower`, `upper`), date (`dateAdd`, `dateBetween`, `formatDate`, `now`, `today`), logic (`if`, `ifs`, `and`, `or`, `not`, `empty`), list (`map`, `filter`, `sum`, `len`, `join`), and `prop("Field")` typed accessors.
  - Formulas evaluate both in Postgres/Worker (for sorting/filtering large datasets and rollups) and deterministically in `packages/domain` on the client for instant optimistic preview while typing formulas!
- **6 Synchronized Views (`doc_database_views`):**
  1. **Table:** Virtualized TanStack Table grid, resizable/reorderable columns, frozen Title column, wrap-text toggle, inline cell editors, column footer aggregations (`Sum`, `Avg`, `Count`, `Percent Empty`).
  2. **Board:** Kanban grouped by `select`, `status`, or `person` with optional swimlane sub-grouping and card property toggles.
  3. **Gallery:** Responsive card grid displaying page cover images (`cover_file_id`) or first image block.
  4. **Calendar:** Month/Week calendar plotted on any `date` property.
  5. **Timeline (Gantt):** Horizontal timeline plotted on `start_date`..`end_date` with zoom & dependency lines.
  6. **List:** Minimal compact rows for quick wikis and reading lists.
- **Synced Linked Views (`linkedViewBlock` TipTap Node):** Embed any Database (with independent local filter/sort/view layout) OR any **Huriro Issues Saved View** directly inside any doc page! Edits flow directly into the canonical database or `issues` collection.

### 4.2 Modern Block Authoring Craft (`packages/editor` v2)

Building on `packages/editor/src/schema.ts` (`TipTap v3 MIT`, `BlockIdExtension`, `CalloutExtension`, `ToggleExtension`, `EntityMentionExtension`, `EmbedExtension`, `ReferenceBlockExtension`, `CommentAnchorMark`):

- **Multi-Column Layout (`ColumnsExtension` + `ColumnExtension`):** Responsive 2–4 column containers with draggable column width divider ratios (`widths: number[]`). Users type `/2col`, `/3col`, `/4col` OR drag a block's gutter handle to the left/right drop rail of an existing block. Keyboard action `Mod+Alt+←/→` moves focus/blocks between columns.
- **Block Drag Handle (`⋮⋮`) & Block Action Menu:** Hovering or focusing any top-level block reveals the gutter `+` (insert below) and `⋮⋮` (drag + click menu). Keyboard-accessible via `Mod+/` (Block Menu) supporting:
  - `Mod+Shift+↑` / `Mod+Shift+↓` move block up/down
  - **Turn Into** (Paragraph, H1–H3, Toggle, Toggle Heading, Callout, Bullet/Numbered/Task List, Quote, Code)
  - **Semantic Color & Highlight** (mapped strictly to OKLCH semantic tokens, never raw hex!)
  - **Copy Block Link** (`#block-<id>` deep-link with auto-scroll & brief focus ring highlight)
  - **Duplicate**, **Move to Page…**, **Comment**, **Ask AI**, **Delete**
- **Synced Blocks (`SyncedBlockExtension` + `doc_synced_blocks`):** Reusable content blocks backed by their own Hocuspocus Yjs room (`synced_block:<ws>:<id>`), allowing shared disclaimers, runbook headers, or team OKRs to stay live-synced across N pages. Includes an explicit **"Unsync to local copy"** action.
- **Rich Block Upgrades:**
  - **Resizable Tables:** Upgrade `Table.configure({ resizable: true })`, add row/column `⋮⋮` drag handles, header row/column toggles, cell background token tints, and per-column client sort.
  - **Mermaid Diagram Block (`mermaidBlock`):** Lazy-loaded `mermaid` (MIT) with tabbed *Split / Code / Diagram* view, theme-reactive dark/light rendering, SVG export, and required `alt` caption for accessibility.
  - **Math / LaTeX (`mathInline` & `mathBlock`):** Lazy-loaded `katex` (MIT), triggered by `$...$` inline, `$$` block, or `/math`.
  - **Toggle Headings** (collapsible `H1`/`H2`/`H3`), **Inline Table of Contents Block** (auto-tracks page `headings`), **Rich Bookmark Cards** (SSRF-safe metadata unfurl reusing `chat_link_previews` architecture), **Button Blocks** (append template blocks below or invoke a permitted Workflow Automation), and inline **PDF / Video / Audio** attachment players.
- **Page Appearance, Covers & Locks:** Add `cover_file_id`, `cover_gradient`, `cover_position_y`, `font_style` (`'sans' | 'serif' | 'mono'`), `full_width`, `small_text`, `is_locked`, `locked_by`, `locked_at` to `doc_pages`. Locked pages disallow accidental edits in the UI (enforced server-side by Hocuspocus `readOnly = true` unless unlocked by a `doc.write` editor).

### 4.3 In-House Suggestion Mode (Track Changes), Wiki Verification & Freshness

- **Suggestion Mode over Yjs (`ADR-0027`):**
  - Instead of paid TipTap Pro Track Changes, `packages/editor` adds two MIT ProseMirror marks: `SuggestionInsertMark` and `SuggestionDeleteMark`, carrying `{ suggestionId, groupId, authorType, authorId, createdAt }`.
  - Toggle **Suggesting** mode (or require suggesting on locked/verified docs for commenters via `doc.comment` permission!). Edits wrap inserted text in `SuggestionInsertMark` and mark deleted ranges with `SuggestionDeleteMark` instead of removing nodes, syncing natively across Yjs peers!
  - `doc_suggestions` Postgres index table caches open suggestions per page for notifications, right-panel review cards, and **Accept / Reject / Accept All / Reject All** actions (atomic Yjs transform through Hocuspocus `openDirectConnection()`).
  - **AI Inline Diff Safety:** Every AI rewrite/edit (`/ai`) writes into **Suggestion Mode** rather than overwriting human prose silently.
- **Wiki Verification & Freshness (`doc_verifications`):**
  - Mark canonical docs (runbooks, onboarding, RFCs) as **Verified** by an owner (`verified_by`, `verified_at`, `expires_at` = 30/90/180/365 days or indefinite).
  - Renders a crisp semantic badge (`Verified · expires in 14d` / `Stale · review due`) in the page header and Docs sidebar; a pg-boss job notifies owners 7 days before expiry.

### 4.4 Backlinks, Knowledge Graph & Teamspaces

- **Backlinks Panel:** Every `doc_state` compaction extracts `EntityMentionExtension` and internal URL references into `entity_links` (§7.1). Opening any doc displays a collapsible **"Referenced by (N)"** header linking back to referencing Docs, Issues, Chat threads, and Mail conversations.
- **Knowledge Graph View (Lazy Chunk `graph-chunk`):** Interactive node-edge map across Teamspaces, Docs, Databases, and linked Issues, filterable by tag, teamspace, or verification status, with keyboard arrow-navigation fallback (`aria-label` list sidecar for screen readers).
- **Teamspaces (`teamspaces`, `teamspace_members`):** Structural containers in the Docs & Projects sidebar (e.g., *General*, *Engineering*, *Product*, *HR Private*) with `visibility: 'open' | 'closed' | 'private'`. Each teamspace owns a root folder/page tree and optional default ACL template inherited by newly created pages unless overridden.

### 4.5 Publish to Web & Rich Exports

- **Publish to Web (`doc_public_shares`):** Publish a single `doc_page` or subtree (`include_children = true`) at `/p/<workspaceSlug>/<publicSlug>` (or optional verified custom docs domain).
  - Rendered via **TanStack Start SSR** public route (`§3 #15`), sanitized identically to internal docs, with configurable `allow_search_indexing` (`robots: noindex` toggle), optional `password_hash`, `expires_at`, and automatic clean `.md` + `llms.txt` endpoints for public documentation sites!
- **Rich Exports:** Export any page or subtree to **Print-Styled PDF** (worker Chromium/Typst-free clean HTML→PDF pipeline or browser print sheet), **Standalone HTML**, **Markdown + Media Assets ZIP**, and Databases to **CSV / JSON**.

### 4.6 Docs v2 Schema Snippets & Editor Extensions

```sql
-- Teamspaces & public doc sharing
CREATE TABLE teamspaces (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  icon text,
  visibility text NOT NULL DEFAULT 'open' CHECK (visibility IN ('open','closed','private')),
  position text COLLATE "C" NOT NULL,
  archived_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, slug)
);

-- Relational Structured Databases (§4.1, ADR-0026)
CREATE TABLE doc_databases (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  teamspace_id uuid,
  parent_page_id uuid,
  title text NOT NULL,
  icon text,
  is_inline boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, teamspace_id) REFERENCES teamspaces (workspace_id, id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id, parent_page_id) REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE doc_database_properties (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  database_id uuid NOT NULL,
  name text NOT NULL,
  prop_type text NOT NULL CHECK (prop_type IN (
    'title','text','number','select','multi_select','status','date','person',
    'checkbox','url','email','file','relation','rollup','formula',
    'created_time','created_by','updated_time','updated_by'
  )),
  config jsonb NOT NULL DEFAULT '{}'::jsonb, -- options, format, relationTarget, rollupSpec, formulaSource
  position text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, database_id) REFERENCES doc_databases (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE doc_database_rows (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  database_id uuid NOT NULL,
  page_id uuid, -- optional lazy doc_page for rich body content
  title text NOT NULL DEFAULT '',
  position text COLLATE "C" NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, database_id) REFERENCES doc_databases (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, page_id) REFERENCES doc_pages (workspace_id, id) ON DELETE SET NULL
);
CREATE INDEX idx_db_rows_pos ON doc_database_rows (workspace_id, database_id, position) WHERE archived_at IS NULL;

CREATE TABLE doc_database_cell_values (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  database_id uuid NOT NULL,
  row_id uuid NOT NULL,
  property_id uuid NOT NULL,
  val_text text,
  val_number numeric(18,6),
  val_bool boolean,
  val_date_start timestamptz,
  val_date_end timestamptz,
  val_json jsonb, -- option IDs, person IDs, relation IDs, cached formula output
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, row_id, property_id),
  FOREIGN KEY (workspace_id, database_id) REFERENCES doc_databases (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, row_id) REFERENCES doc_database_rows (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, property_id) REFERENCES doc_database_properties (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_db_cells_prop_text ON doc_database_cell_values (workspace_id, property_id, val_text) WHERE val_text IS NOT NULL;
CREATE INDEX idx_db_cells_prop_num  ON doc_database_cell_values (workspace_id, property_id, val_number) WHERE val_number IS NOT NULL;
CREATE INDEX idx_db_cells_prop_date ON doc_database_cell_values (workspace_id, property_id, val_date_start) WHERE val_date_start IS NOT NULL;
```

Additional Docs v2 tenant tables: `teamspace_members`, `doc_database_views`, `doc_synced_blocks`, `doc_suggestions`, `doc_verifications`, `doc_public_shares` (and `doc_pages` expand columns: `teamspace_id`, `cover_file_id`, `cover_gradient`, `cover_position_y`, `font_style`, `full_width`, `small_text`, `is_locked`, `locked_by`, `locked_at`, `is_database_row`).

---

## 5. Pillar 3 — Chat v2 (Slack-Class Real-Time Messaging & Async/Sync Collaboration)

### 5.1 Rich Composer, Formatting & Power Messaging

V1 implemented clean plain/markdown messaging with attachments and link previews. V2 elevates `MessageComposer` and `MessageList` to Slack-class richness without abandoning our single per-channel feed (`last_msg_seq` + `last_rev`):

- **Rich TipTap-Lite Composer:** Bold, italic, strikethrough, inline code, fenced code blocks with syntax highlighting & language selector, blockquotes, bullet/ordered lists, paste-URL-onto-selected-text, clipboard image paste, drag-and-drop multi-file uploads with inline thumbnail grids and keyboard-navigable lightbox.
- **Smart Autocomplete Popovers:**
  - `@` People, Agent Principals, **User Groups (`@backend`)**, `@channel`, `@here`
  - `#` Public & private channels the user can access
  - `:` Standard Unicode emoji + **Custom Workspace Emoji (`workspace_emojis`)** uploaded through `files` quarantine (`name`, `file_id`, `created_by`, normalized `:shortcode:`)
  - **`/` Slash Command Registry:** Built-in extensible palette (`/issue <title>`, `/doc <title>`, `/remind <when> <text>`, `/poll "<q>" "a" "b"`, `/status <emoji> <text>`, `/topic <text>`, `/invite @user`, `/mute`, `/huddle`, `/agent @name <prompt>`).
- **Broadcast Thread Replies:** Adding `broadcast_to_channel boolean NOT NULL DEFAULT false` to `chat_messages`. When true, the server transaction allocates **both** `thread_seq` (inside the thread) **and** `channel_seq` (in the main channel feed), removing V1's strict XOR check in favor of `CHECK ((thread_parent_id IS NULL) OR (thread_seq IS NOT NULL))` so broadcast replies render inline in the channel with a subtle `"replied to a thread:"` header!
- **Quoted Replies & Secure Forwarding:** `reply_to_message_id` for inline quoting; **Forward Message** to another channel/DM, Issue comment, or Mail note. *Security invariant:* forwarding from a private channel checks target membership and inserts an attributed copy snapshot rather than a live reference that could bypass channel ACLs.

### 5.2 Synced Drafts, Scheduled Messages & Saved for Later ("Later" Queue)

- **Synced Drafts (`chat_drafts`):** Keyed by `(workspace_id, user_id, channel_id, thread_parent_id)` (using sentinel UUID or partial unique indexes for root vs. thread). Typing debounces locally in TanStack DB / storage and syncs across web, Tauri desktop, and mobile; channels with unsent drafts show a subtle pencil badge and appear in **Chat → Drafts & Sent**.
- **Scheduled Messages (`chat_scheduled_messages`):** Compose now, pick a date/time in user timezone (`scheduled_for`), store uploaded `attachment_file_ids`, and let pg-boss dispatch via `sendMessage` at the scheduled instant. Users can edit, reschedule, send immediately, or cancel before execution.
- **Saved for Later & Reminders (`chat_saved_items`):** Mark any message (or create a custom reminder via `/remind`) as `saved` with optional `remind_at` and personal `note`, triaged in **Chat → Later** (`In Progress`, `Archived`, `Completed`). Due reminders fire in-app, web push, and mobile push notifications.

### 5.3 Custom Sidebar Sections, Bookmarks Bar, Pinned Messages & Channel Canvas

- **Custom Sidebar Sections (`chat_sidebar_sections`, `chat_sidebar_section_items`):** Personal collapsible sections (e.g., *Starred*, *Squad Alpha*, *Incidents*, *DMs*) ordered with fractional indexing (`COLLATE "C"`), supporting per-section "Show unread only" toggles and keyboard reordering.
- **Channel Bookmarks (`chat_channel_bookmarks`):** Pinned header bar inside each channel linking directly to Huriro Issues, Saved Views, Docs, Mail Inboxes, or external URLs (with icon + folder grouping).
- **Pinned Messages (`chat_pinned_messages`):** Channel-wide pinned decisions/announcements accessible from a header pin badge drawer.
- **Channel Canvas (`chat_channels.canvas_page_id`):** Every public/private channel and DM gets a dedicated **Canvas** tab backed by a real collaborative `doc_pages` record! Canvas access dynamically delegates to channel membership (via `chat` + `docs` policy checks), eliminating ACL drift while giving teams live Yjs runbooks, standup notes, and pinned specs right next to the chat stream.

### 5.4 Custom User Statuses, DND, User Groups & Notification Precision

- **Workspace User Profiles (`user_workspace_profiles`):** `status_emoji`, `status_text`, `status_expires_at`, `dnd_until`, `working_hours` JSONB (`{ tz, start, end, days }`). Surfaces next to avatars across Chat, Issues, Docs, and Mail; auto-suppresses push/sound while DND is active unless bypassed by critical `@here`/urgent overrides (configurable).
- **User Groups (`user_groups`, `user_group_members`):** Workspace-managed handles (`@oncall`, `@design`, `@support-leads`) with optional auto-join default channels. Mentioning `@oncall` fans out notifications and records mentions cleanly across Chat, Docs, Issue comments, and Mail internal notes.
- **Granular Notification Rules:** Extend `chat_read_state` with `notify_level` (`'default' | 'all' | 'mentions' | 'none'`) and `muted_until` (timed mutes: 1h, 8h, tomorrow, forever), plus workspace-wide **Keyword Alerts** (`notification_preferences.alert_keywords text[]`) matched deterministically on `message.created`.

### 5.5 One-Click Cross-Pillar Actions & Interactive Cards (Polls + Approvals)

- **Hover / Context Action Bar on Every Message:**
  - **Create Issue from Message (`T`):** Opens `CreateIssueDialog` pre-populated with quoted message + permalink, creates `entity_links` edge, and posts a compact live Issue Card back in the message's thread.
  - **Append / Save to Doc:** Sends message excerpt + attachments to any writable `doc_page` via Hocuspocus `openDirectConnection()`.
  - **Mark Unread from Here (`Alt+Click` or menu):** Resets `chat_read_state.last_read_seq = message.channel_seq - 1`.
  - **Remind Me / Save (`S`)**, **Pin to Channel**, **Forward**, **Copy Permalink**.
- **Native Interactive Polls (`chat_polls`, `chat_poll_votes`):** Created via `/poll` or composer modal; supports single-choice, multi-choice, anonymous voting, and auto-close timestamp; tallies update live via channel `rev` bump.
- **Interactive R2 Agent Approval Cards:** Agents requesting R2 confirmation (§13.5) can optionally post an approval summary into a designated owner DM or ops channel; clicking **Approve / Deny** executes a real authenticated `POST /api/v1/approvals/:id/decide` request from the human's session (preserving out-of-band human proof).

### 5.6 Async Voice/Screen Clips & Optional Live Huddles

- **Async Voice & Screen Clips (Built-In Core):** Web (`MediaRecorder` Opus/WebM) and Mobile (`expo-audio` / native recorder) record up to 10-minute voice memos or screen clips directly inside `MessageComposer` → two-phase `files` quarantine upload → inline waveform player with `1x/1.5x/2x` playback speed + optional AI transcription stored in `file_transcripts` and indexed in `search_documents`.
- **Optional Live Audio/Screen Huddles (`ADR-0029`):**
  - Enabled only when `HURIRO_HUDDLES_ENABLED=1` (paired with `docker compose --profile huddles` running **LiveKit OSS**, Apache-2.0). Minimal 2-container self-host deployments remain completely untouched.
  - Clicking **Start Huddle** in a channel or DM issues a short-lived room token from `apps/server` (verified against live channel membership), spins up an **ephemeral huddle thread** (`chat_messages` with `kind = 'huddle_session'`) for sharing links/notes during the call, supports audio, screen sharing, and floating emoji reactions, and optionally posts an AI transcript/summary directly into the **Channel Canvas**.

### 5.7 Chat v2 Schema Snippets & Keyboard Map

```sql
-- Expand chat_messages for broadcast thread replies, quotes, polls, huddles
ALTER TABLE chat_messages
  ADD COLUMN broadcast_to_channel boolean NOT NULL DEFAULT false,
  ADD COLUMN reply_to_message_id uuid,
  ADD COLUMN message_kind text NOT NULL DEFAULT 'text'
    CHECK (message_kind IN ('text','poll','huddle_session','approval_card','system'));

-- Custom workspace emoji (served via quarantined files)
CREATE TABLE workspace_emojis (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  shortcode text NOT NULL,
  file_id uuid NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, shortcode),
  FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE
);

-- Synced drafts & scheduled messages
CREATE TABLE chat_drafts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL,
  thread_parent_id uuid,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  body_text text NOT NULL DEFAULT '',
  attachment_file_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_chat_drafts_target
  ON chat_drafts (workspace_id, user_id, channel_id, COALESCE(thread_parent_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE chat_scheduled_messages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL,
  thread_parent_id uuid,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  body_text text NOT NULL,
  attachment_file_ids uuid[] NOT NULL DEFAULT '{}',
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','cancelled','failed')),
  sent_message_id uuid,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE
);

-- User Groups & Channel Bookmarks
CREATE TABLE user_groups (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  handle text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, handle)
);
```

Additional Chat v2 tenant tables: `chat_saved_items`, `chat_sidebar_sections`, `chat_sidebar_section_items`, `chat_channel_bookmarks`, `chat_pinned_messages`, `user_workspace_profiles`, `user_group_members`, `chat_polls`, `chat_poll_votes`, `file_transcripts`, plus `chat_channels.canvas_page_id` and `chat_read_state.notify_level` / `muted_until`.

| Scope   | Shortcut          | Action                                     |
| :------ | :---------------- | :----------------------------------------- |
| Jump    | `Mod+Shift+K`     | Quick channel / DM / user-group switcher   |
| Travel  | `Alt+↑` / `Alt+↓` | Previous / next channel in sidebar         |
| Unreads | `Alt+Shift+↑/↓`   | Jump to previous / next unread channel     |
| Read    | `Esc` / `Shift+Esc` | Mark active channel read / mark all read |
| Message | `R` / `S` / `T`   | Reply in thread / Save for later / Create issue |
| Edit    | `↑` (empty input) | Edit your last message in channel/thread   |
| Huddle  | `Mod+Shift+H`     | Start / join / leave channel huddle (if enabled) |

---

## 6. Pillar 4 — Mail v2 (Front / Missive / Superhuman-Class Shared & Personal Inbox)

### 6.1 Collaborative Real-Time Drafts & Review-Before-Send

V1 `mail_drafts` relied on an exclusive `locked_by` / `locked_until` soft lock. Front and Missive shine because teammates collaborate directly inside a reply draft before hitting send:

- **Yjs Collaborative Draft Rooms (`ADR-0032`):** Expand `mail_drafts` with `collab_enabled boolean`, `draft_state bytea`, `draft_state_vector bytea`. When teammates open the reply composer on the same draft, the web/desktop client requests a single-use collab ticket (`scope = mail_draft`) and joins Hocuspocus room `mail_draft:<ws>:<draftId>` with live presence cursors and inline teammate attribution. Offline/single-editor clients fall back seamlessly to optimistic REST `UpsertMailDraftBody`.
- **Review-Before-Send Approval Gate:** Add `review_status` (`'none' | 'requested' | 'approved' | 'changes_requested'`), `reviewer_id`, `reviewed_at`, `review_note` on `mail_drafts`. A support agent can tag a senior teammate (`Request review`); the **Send** button requires reviewer approval before queuing outbound delivery, recording the approval event in `mail_conversation_events`.

### 6.2 Canned Responses / Snippets, One-Click Macros & Superhuman Composer Craft

- **Canned Responses / Snippets (`mail_templates`):** Shared (workspace/inbox) or personal reusable replies with shortcut triggers (`;refund`, `;bug-triage`), rich TipTap HTML/text bodies, default attachments, and **typed merge variables** (`{{customer.first_name}}`, `{{customer.email}}`, `{{customer.org}}`, `{{assignee.name}}`, `{{issue.identifier}}`, `{{issue.status}}`).
- **One-Click Macros (`mail_macros`):** Named sequences of atomic conversation actions (insert snippet, set status → `pending`/`closed`, apply tags, assign/unassign, snooze, link project/issue) invocable from `Mod+K` or a single key shortcut, executed transactionally in one request.
- **Proactive New Outbound Compose, Forward & Thread Split:**
  - **Compose New Email (`C` in Mail):** Start an outbound conversation from any verified `mail_identity` without needing an incoming email first (supporting `To`, `Cc`, `Bcc`, and recipient autocomplete from `contacts`).
  - **Forward & Thread Split:** Forward a single message or entire conversation externally; **Split** an off-topic message into a fresh `mail_conversation` (preserving RFC `References` and emitting a `split` timeline event).
- **Send Later & Follow-Up Reminders ("Remind me if no reply"):**
  - Schedule `mail_drafts.scheduled_send_at` with timezone display (`§17.13`).
  - Attach `follow_up_at` and `follow_up_condition` (`'if_no_reply' | 'always'`) on the conversation: if the customer does not reply before `follow_up_at`, pg-boss automatically reopens the conversation (`status = 'open'`) and notifies the assignee.
- **Bulk Conversation Triage & Superhuman Split-Inbox Tabs:**
  - Multi-select conversations in `ConversationList` for bulk Assign, Tag, Status, Snooze, or Mark Spam.
  - Configurable **Split-Inbox Tabs** (`mail_inboxes.settings.split_tabs`) powered by `FilterExpr` (e.g., *Important / VIP*, *Billing*, *Bug Reports*, *Unassigned*).

### 6.3 Conversation Tags, Auto-Routing, Round-Robin Assignment & SLA Analytics

- **Conversation Tags (`mail_tags`, `mail_conversation_tags`):** Color-tokenized labels scoped to workspace or inbox (`VIP`, `Refund`, `Enterprise`, `Security`), filterable in `ListConversationsQuery` and Search DSL (`tag:vip`).
- **Automated Routing & Load-Balanced Round-Robin:**
  - Built on the V2 Automation Engine (§7.2) + `mail_inbox_routing_state` (`last_assigned_user_id`, `max_open_cap`, `require_online`, `respect_dnd`).
  - Incoming messages matching a rule automatically tag, prioritize, and assign the next available teammate who is **not on DND**, **below their open-conversation WIP cap**, and optionally **currently online** in realtime presence.
- **Mail SLA Policies (`mail_sla_policies`) & Analytics:**
  - Define first-reply SLA, next-reply SLA, and resolution SLA per inbox/tag with business-hours calendars (`sla_next_due_at`, `sla_breach_count` on `mail_conversations`).
  - **Inbox Analytics View (`charts-chunk`):** Median/p95 first response time, handle/resolution time, reopened conversation rate, SLA compliance %, tag volume breakdown, and per-teammate throughput.

### 6.4 Contacts & Organizations Directory (Lightweight Customer Context Sidebar)

- **Contacts & Organizations (`contacts`, `contact_organizations`):**
  - Automatically upserted from verified inbound/outbound email addresses and domain matching (excluding free webmail domains like `gmail.com`/`outlook.com` from auto-org grouping!), enriched manually with `display_name`, `title`, `phone`, `vip_tier` (`standard | vip | strategic`), `notes`, and `metadata`.
  - **Right-Hand Customer Context Sidebar (`ConversationView`):** Replaces a bare metadata drawer with a live customer dossier: contact details, organization profile, VIP badge, previous mail threads from the same person/org, **all linked Huriro Issues with live status**, and linked Docs — zero switching to an external CRM.

### 6.5 Bidirectional Issue ↔ Mail Sync, Guarded Mail AI, Private Inboxes & Stalwart JMAP

- **Bidirectional Issue ↔ Mail Loop:** When any Huriro `issue` linked via `entity_links` (`mail_conversation_tasks` migrated) transitions to a `completed` status, a transactional automation/subscriber posts an internal note on every linked conversation (`"ENG-142 was marked Done by @maya"`), wakes snoozed conversations waiting on engineering, and optionally generates a **pending AI update draft** for the support owner to review and send.
- **Guarded Mail AI Copilot (`§13.6` compliant):**
  - Grounded reply suggestions retrieved strictly from docs & issues the **acting human user** can read, with clickable source citations.
  - One-click **Thread Summary** (for assignee handoffs) and **Intent / Tag Suggestion**.
  - **Hard Safety Invariant:** AI output is strictly untrusted against prompt injection from customer emails and **never** sends outbound email without a human clicking Send.
- **Personal Connected Inboxes (`mail_inboxes.visibility`: `'shared' | 'private'`):** Missive-style private email connections where conversations stay strictly private to the owner (`acl_entries` + RLS check) until the owner explicitly `@mentions` a teammate in an internal note or moves/shares the thread into a team inbox.
- **Stalwart JMAP Adapter (Phase 3 Completion from `§14.2`):** Deliver the optional self-host Compose profile (`--profile stalwart`) over RFC 8620/8621 JMAP (`packages/db` + `apps/server/src/modules/mail/providers.ts` `jmap` adapter), avoiding Stalwart's enterprise-only multi-tenancy features while keeping Huriro Postgres as the canonical store.

### 6.6 Mail v2 Schema Snippets & Keyboard Map

```sql
-- Contacts & Organizations (shared between Mail v2 and Tasks Customer Requests)
CREATE TABLE contact_organizations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  domain citext,
  tier text NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard','vip','strategic')),
  notes text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, domain)
);

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  organization_id uuid,
  email citext NOT NULL,
  display_name text,
  title text,
  phone text,
  notes text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, email),
  FOREIGN KEY (workspace_id, organization_id) REFERENCES contact_organizations (workspace_id, id) ON DELETE SET NULL
);

-- Mail tags, templates, macros & SLA state
CREATE TABLE mail_tags (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  inbox_id uuid,
  name text NOT NULL,
  color text NOT NULL DEFAULT 'neutral',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, inbox_id, name),
  FOREIGN KEY (workspace_id, inbox_id) REFERENCES mail_inboxes (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE mail_conversation_tags (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, conversation_id, tag_id),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES mail_conversations (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, tag_id) REFERENCES mail_tags (workspace_id, id) ON DELETE CASCADE
);

-- Expand mail_drafts for Yjs collaborative editing & review gate
ALTER TABLE mail_drafts
  ADD COLUMN collab_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN draft_state bytea,
  ADD COLUMN draft_state_vector bytea,
  ADD COLUMN review_status text NOT NULL DEFAULT 'none'
    CHECK (review_status IN ('none','requested','approved','changes_requested')),
  ADD COLUMN reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz;
```

Additional Mail v2 tenant tables: `mail_templates`, `mail_macros`, `mail_sla_policies`, `mail_inbox_routing_state`, plus `mail_inboxes.visibility` (`'shared' | 'private'`), `mail_conversations.follow_up_at` / `follow_up_condition` / `sla_next_due_at` / `sla_breached_at` / `contact_id`.

| Scope     | Shortcut        | Action                                     |
| :-------- | :-------------- | :----------------------------------------- |
| Triage    | `E` / `H`       | Close (archive) / Snooze conversation      |
| Compose   | `C` / `R` / `A` / `F` | New email / Reply / Reply all / Forward |
| Internal  | `N`             | Focus internal team note composer          |
| Productivity | `;` / `Mod+M` | Insert canned snippet / Run macro         |
| Metadata  | `G` / `L`       | Assign teammate / Toggle conversation tags |
| Cross-App | `Shift+I`       | Convert or link to Huriro Issue            |

---

## 7. Cross-Pillar Platform Superpowers (The Huriro Advantage)

### 7.1 Unified Cross-Entity Graph (`entity_links`)

V1 used separate link tables (`mail_conversation_tasks`, `mail_conversation_docs`, `issue_relations`). V2 unifies cross-pillar linking behind one typed, bidirectional relationship graph (`ADR-0033`):

```sql
CREATE TABLE entity_links (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN (
    'issue','doc_page','doc_database_row','chat_message','mail_conversation','contact_org','vcs_pr'
  )),
  source_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN (
    'issue','doc_page','doc_database_row','chat_message','mail_conversation','contact_org','vcs_pr'
  )),
  target_id uuid NOT NULL,
  relation_kind text NOT NULL DEFAULT 'references'
    CHECK (relation_kind IN ('references','blocks','duplicates','originated_from','tracked_by','requested_by')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, source_type, source_id, target_type, target_id, relation_kind)
);
CREATE INDEX idx_entity_links_src ON entity_links (workspace_id, source_type, source_id);
CREATE INDEX idx_entity_links_tgt ON entity_links (workspace_id, target_type, target_id);
```

- **Migration Safety:** Follow expand→migrate→contract — backfill `mail_conversation_tasks`, `mail_conversation_docs`, and doc/chat `EntityMentionExtension` links into `entity_links`, dual-write during transition, and preserve compatibility views for V1 contracts.
- **Universal Hover Peek Cards:** Hovering or focusing (`Mod+Shift+Space`) any entity badge (`ENG-142`, doc link, mail thread, chat permalink) across **any** pillar fetches/reads cached metadata and displays a live interactive popover (change issue status/assignee, inspect doc verification, view mail thread status) without leaving your current context.

### 7.2 Unified Workflow Automation Engine (`apps/server/src/modules/automations/`)

Because V1 writes every mutation through the transactional `outbox`, V2 unlocks no-code & code-defined **Cross-Pillar Automations** without polling or separate webhook glue:

- **Tables:** `automation_rules` (`name`, `description`, `enabled`, `principal_id`, `trigger_kind`, `trigger_config`, `condition_ast`, `actions` JSONB, `version`), `automation_runs` (`rule_id`, `trigger_event_id`, `status`, `depth`, `duration_ms`, `error_detail`), `automation_run_steps`.
- **Triggers:** Any outbox domain event (`issue.created`, `issue.status_changed`, `issue.sla_at_risk`, `doc.verification_expiring`, `doc.database_row.updated`, `chat.message.created`, `mail.inbound.received`, `mail.conversation.snoozed_woke`, `vcs.pr.merged`), plus **Cron Schedules** (e.g., Monday 09:00 weekly summary).
- **Conditions:** Reuses `packages/domain` `FilterExpr` AST (plus regex/keyword checks on untrusted text).
- **Actions (Cross-Pillar):** Create/update Issue, transition status, add/remove label/tag, create Database row, post Chat message/thread reply, assign Mail conversation (including round-robin), add Mail internal note, send outbound Webhook, or **assign & wake an AI Agent Principal**.
- **Visual Builder + YAML Portability:** Drag/keyboard linear trigger→condition→action builder (`automation-builder-chunk`) AND bidirectional **YAML Export/Import** so engineering teams can version-control workspace workflows in Git.
- **Security & Loop Guards (`ADR-0028`):**
  1. **Least-Privilege Principal:** Every `automation_rule` executes under an explicit `agent_principals(kind='automation')` owned by an admin — **never** bypassing RLS or permissions!
  2. **Recursion Depth Cap:** Outbox event metadata carries `x_automation_depth`; any rule triggered at `depth >= 5` aborts cleanly and logs `loop_guard_tripped` in `automation_runs`.
  3. **Dry-Run & Replay Simulator:** Test any rule against a historical event/entity ID showing predicted mutations before enabling it.

### 7.3 AI & Agents v2 (From Single Tool Calls to Grounded Teammates)

V1 established `agent_principals`, MCP `2026-07-28`, OAuth 2.1 + CIMD, `agent_approvals` (R0–R3), and `packages/agent-tools`. V2 turns agents into ubiquitous workspace collaborators:

- **Built-In Workspace Assistant Panel (`Mod+Shift+A`):** Lazy-loaded (`ai-assistant-chunk`) slide-over built on shadcn **AI Elements** — streaming responses, collapsible tool-call execution trace, clickable citations (`ENG-142`, `#eng-ops`, doc anchors), inline **Undo** on R1 writes, and inline **Approve / Deny** cards on R2 actions. Retrieval queries are strictly filtered by the active user's live permissions (`§11.2`).
- **Contextual AI Actions Across All Four Pillars:**
  - *Tasks:* Auto-triage suggestions, break large spec doc into structured sub-issues, natural-language query → `FilterExpr` bar.
  - *Docs:* `/ai` inline writer emitting **Suggestion Mode** diffs (never silent overwrites!), catch-up summary on unread doc edits, auto-populate Database columns from page prose.
  - *Chat:* Thread & channel **"Catch me up"** digest, extract action items to Issues/Later.
  - *Mail:* Grounded customer reply draft citing internal Docs + linked Issues, assignee handoff summary.
- **Expanded V2 Agent Tool Registry (`packages/agent-tools/src/registry.ts`):**

| Tool Name                   | Scope               | Risk Tier | Side Effect & Guardrails                                                    |
| :-------------------------- | :------------------ | :-------: | :-------------------------------------------------------------------------- |
| `tasks.triage`              | `tasks.write`       |    R1     | Accept/snooze/decline/merge triage item (undoable 7d)                       |
| `tasks.list_cycles`         | `tasks.read`        |    R0     | Read cycles + daily burnup snapshots                                        |
| `tasks.manage_milestones`   | `tasks.write`       |    R1     | Create/update project milestone                                             |
| `docs.query_database`       | `docs.read`         |    R0     | Filter/sort relational database rows (`untrustedFields` tagged)             |
| `docs.create_db_row` / `update_db_row` | `docs.write` |   R1     | Mutate database row cells via policy + outbox (undoable 7d)                 |
| `docs.propose_suggestion`   | `docs.comment`      |    R1     | Insert `SuggestionInsertMark` / `SuggestionDeleteMark` via Hocuspocus room |
| `chat.list_channels` / `chat.search` | `chat.read` |    R0     | Read channels/messages user & agent can access (`untrustedFields`)          |
| `chat.post_message`         | `chat.write` (new)  | **R1 / R2** | R1 in private agent/owner channels; **R2 (Huriro approval)** if channel includes guests or >10 members |
| `mail.search` / `mail.get_thread` | `mail.read`   |    R0     | Register in `SPECS` (`§13.4`); strictly `trust: "untrusted"` MIME text      |
| `mail.draft_reply` / `mail.add_note` | `mail.draft` |   R1     | Creates collaborative draft or internal note only — **never sends email**   |
| `mail.tag`                  | `mail.draft`        |    R1     | Apply/remove conversation tags                                              |
| `automations.list` / `simulate` | `automations.read` | R0     | Inspect rules and run non-mutating dry-run simulations                      |
| `graph.get_links`           | `search.read`       |    R0     | Traverse `entity_links` filtered by caller visibility                       |

- **Live Agent Run Inspector:** Dedicated view inside `Settings → Agents` and linked Issue detail panels showing active agent runs, live tool-call stream, token/cost telemetry (`ai_runs`), and a **1-click Pause / Revoke** circuit breaker.

### 7.4 Unified Inbox v2 ("For Me") & "My Day" Agenda + Read-Only iCal Feeds

- **Inbox v2 Triage (`Inbox → For Me`):**
  - Add `snoozed_until timestamptz` and `group_key text` to `notifications`.
  - Keyboard triage (`J`/`K` select, `E` archive, `H` snooze until tomorrow/next week, `U` mark unread, `Enter` peek linked Issue/Doc/Chat/Mail inline).
  - Filter pills: `All | Mentions | Assigned | Approvals | Triage | Snoozed`.
- **My Day Agenda (Inside `Home` / `Issues → My Work`):** Morning focus view pulling due/overdue Issues, active Cycle assignments, waking snoozed Mail conversations, due Chat `Later` reminders, and Docs Database rows with today's date assigned to you.
- **Signed Read-Only iCal / WebCal Feed (`GET /api/v1/calendar/feed/:token.ics`):** Revocable per-user calendar token (`ical_tokens` table) exporting assigned issue deadlines, milestones, and subscribed Database date views for Apple/Google/Fastmail calendars.

### 7.5 Search v2 (Unified Query DSL & Attachment Text Extraction)

- **Expanded Query DSL (`packages/domain/src/search-query.ts`):** Extend V1's parser (`in:`, `is:open|closed`, `label:`, `priority:`, `type:`, `@`, `#`) with `from:`, `assignee:`, `status:`, `tag:`, `has:file|pr|link|reaction|transcript`, `is:unread|saved|verified|stale|triage`, `before:YYYY-MM-DD`, `after:YYYY-MM-DD`, `teamspace:`.
- **Sandboxed Attachment Text Extraction:** Worker job extracts plain text from clean `files` (PDF, DOCX, TXT, CSV, Markdown) and `file_transcripts` (voice/screen clips) with strict CPU/RAM/page limits, storing extracted chunks in `search_documents` + `chunk_embeddings` (`pgvector`) while inheriting container ACLs on retrieval!
- **Instant Local + Hybrid Server Merge:** `Mod+K` searches the local TanStack DB replica in `< 15 ms` and progressively streams/merges server FTS + `pgvector` RRF hits within the `<= 150 ms` p95 budget.

---

## 8. Architecture, Sync Engine v2, Security, Client Platforms & Performance

### 8.1 Sync Engine v2 (`packages/sync-client` Selective & Lazy Hydration)

V1 `HuriroSyncCollections` (`packages/sync-client/src/collections.ts`) eagerly loads all projects, statuses, labels, cycles, issues, saved views, notifications, and doc page summaries into `PersistedReplicaState`. At V2 scale (e.g., 50,000 issues, 100k database cells, 500k activity rows), eager hydration would break the `<= 1.5 s` cold-start budget and exhaust browser/mobile memory.

**Two-Tier V2 Sync Architecture (`ADR-0031`):**

```text
Tier 1: Eager Core Replica (Boot-Synced, Workspace-Scoped)
  ├── projects, project_statuses, labels, active cycles, project_milestones, initiatives
  ├── saved_views, doc_pages (tree metadata), teamspaces, mail_tags, mail_templates
  ├── active/recent issues (non-archived, non-closed > 30d), notifications
  └── chat_sidebar_sections, user_workspace_profiles, user_groups

Tier 2: Scoped / Lazy Collections (On-Demand + OPFS/SQLite LRU Cache)
  ├── scope = "db:<databaseId>"       → doc_database_properties + doc_database_rows + cell_values
  ├── scope = "issue_hist:<projId>"   → closed/archived issues older than 30d
  ├── scope = "links:<type>:<id>"     → entity_links + issue_activity for open entity
  └── scope = "channel:<channelId>"   → per-channel chat feed (rev cursor, V1 §15.1)
```

- **Protocol Extension:** `GET /api/v1/sync/snapshot?scopes=core,db:<id>` and `GET /api/v1/sync/changes?since=<cursor>&scopes=...` maintain a single monotonic workspace cursor for core entities plus explicit scope-filtered deltas for subscribed lazy scopes, with LRU cache eviction (default 50 MB web OPFS / 30 MB mobile SQLite quota) and full grant/revoke purge support.
- **CDC Migration Trigger (`ADR-0004`):** Retain `workspace_seq` + `change_log` while `change_log` write lock wait stays `< 50 ms` p95; promote logical replication CDC watermark worker if high-frequency Database bulk imports push lock contention above threshold.

### 8.2 Data Model, RLS Classification & Permission Catalog Additions

Every new V2 table adheres strictly to `§4.2` and `§8.1`. Before any migration merges, CI validates entries in `packages/test-utils/src/rls.ts`:

- **New `TENANT_TABLES` (all carry `workspace_id`, `UNIQUE (workspace_id, id)`, composite FKs, `ENABLE + FORCE RLS`):**
  - *Tasks v2:* `initiatives`, `initiative_projects`, `project_updates`, `project_milestones`, `cycle_daily_snapshots`, `custom_field_definitions`, `issue_custom_field_values`, `issue_templates`, `recurring_issues`, `issue_vcs_links`, `issue_watchers`, `issue_comment_reactions`, `issue_activity`, `issue_sla_policies`, `intake_forms`, `customer_requests`.
  - *Docs v2:* `teamspaces`, `teamspace_members`, `doc_databases`, `doc_database_properties`, `doc_database_rows`, `doc_database_cell_values`, `doc_database_views`, `doc_synced_blocks`, `doc_suggestions`, `doc_verifications`, `doc_public_shares`.
  - *Chat v2:* `workspace_emojis`, `chat_drafts`, `chat_scheduled_messages`, `chat_saved_items`, `chat_sidebar_sections`, `chat_sidebar_section_items`, `chat_channel_bookmarks`, `chat_pinned_messages`, `user_workspace_profiles`, `user_groups`, `user_group_members`, `chat_polls`, `chat_poll_votes`, `file_transcripts`.
  - *Mail v2:* `contact_organizations`, `contacts`, `mail_tags`, `mail_conversation_tags`, `mail_templates`, `mail_macros`, `mail_sla_policies`, `mail_inbox_routing_state`.
  - *Cross-Pillar / Platform:* `entity_links`, `automation_rules`, `automation_runs`, `automation_run_steps`, `ical_tokens`, `scim_tokens`.
- **New `SYSTEM_TABLES` (webhook ingress before workspace lookup):** `gitlab_webhook_events`.
- **Extend `acl_entries.resource_type`:** Add `'teamspace'`, `'doc_database'`, and `'mail_inbox'` (enabling private teamspaces, database-level ACLs, and private-until-shared mail inboxes).
- **New Actions in `packages/domain/src/permissions.ts` (`ACTIONS`) & Matrix Tests:**
  - Tasks: `initiative.manage`, `custom_field.manage`, `intake_form.manage`, `sla.manage`
  - Docs: `database.read`, `database.write`, `database.manage`, `doc.verify`, `doc.publish`, `teamspace.manage`
  - Chat: `emoji.manage`, `user_group.manage`, `huddle.join`
  - Mail: `mail.manage`, `mail.template.manage`, `contact.read`, `contact.write`
  - Platform: `automation.read`, `automation.manage`
- **New Agent Scopes in `packages/domain/src/agent-scopes.ts`:** Add `chat.write` (gated by R1/R2 tier policy in §7.3) and `automations.read` / `automations.write` (R2 approval required to enable/modify rules).

### 8.3 Bundle Budget & Lazy-Loading Architecture

To enforce **`check:bundles` (`<= 200 KB` gzip initial web shell)** and **`check:shared-code` (`>= 60%` in `packages/*`)**:

| Web Lazy Chunk Name         | Modules Isolated Inside Chunk                                            | Loaded Only When                                     |
| :-------------------------- | :----------------------------------------------------------------------- | :--------------------------------------------------- |
| `editor-core-chunk`         | TipTap v3 + Yjs + Hocuspocus + Columns + Synced Blocks + Suggestion Marks | User opens Docs or Mail Yjs Draft                    |
| `mermaid-chunk`             | `mermaid` diagram parser & SVG renderer                                  | A page/message contains a `mermaidBlock`             |
| `katex-chunk`               | `katex` CSS + math renderer                                              | A page contains `$...$` or `mathBlock`               |
| `database-grid-chunk`       | Database Table/Board/Gallery/Timeline/Calendar views + Formula Editor UI | User opens a Database or page with `linkedViewBlock` |
| `timeline-charts-chunk`     | Recharts/visx + Tasks Timeline/Roadmap + Cycle Burnup + Insights/Analytics | User selects Timeline, Cycle Charts, or Insights     |
| `graph-chunk`               | Force-directed Knowledge Graph canvas renderer                           | User opens Docs Knowledge Graph tab                  |
| `automation-builder-chunk`  | Visual rule builder + YAML Monaco/CodeMirror editor                      | User opens Settings → Automations                    |
| `huddle-livekit-chunk`      | `livekit-client` WebRTC SDK + screen-share UI                            | User joins a Huddle (`HURIRO_HUDDLES_ENABLED=1`)     |
| `ai-assistant-chunk`        | Assistant drawer + shadcn AI Elements + tool trace renderer              | User opens `Mod+Shift+A` Assistant panel             |

Shared business logic placed in `packages/*`: `packages/domain/src/filter-ast.ts`, `packages/domain/src/formula/*`, `packages/domain/src/sla.ts`, `packages/domain/src/recurrence.ts`, `packages/domain/src/search-query.ts`, `packages/sync-client/src/scoped-sync.ts`, `packages/editor/src/extensions/*`.

### 8.4 Client Platforms v2: Tauri 2 Desktop, Split-Pane Web & Mobile Parity

- **Tauri 2.x Desktop App (`apps/desktop`, `ADR-0030`):**
  - Thin Rust shell bundling the exact `apps/web` Vite production build (no duplicated frontend codebase!).
  - Features: Global system-wide Quick Capture shortcut (`Alt+Space` → create issue/note/draft from anywhere on macOS/Windows/Linux), multi-window + native tab management (`Mod+T`), system tray / dock unread badge synced to Inbox + Chat unreads, native OS notifications with inline quick-reply (Chat) and Approve/Deny (R2 Agent Approvals), `huriro://` deep-link handler, and signed auto-updater.
- **Split-Pane Multitasking (Web & Desktop):** Press `Mod+\` (or Shift-Click any sidebar/link item) to pin two workspace destinations side-by-side (e.g., Docs Spec + Issues Board, Customer Mail + Linked Issue, Chat + Channel Canvas) with persisted split ratio and `F6` pane focus switching.
- **Mobile v2 (`apps/mobile`, Expo SDK 58 + Uniwind + `heroui-native`):**
  - **Triage Swipe Deck:** Tinder-style right/left/down swipe gestures for Accept / Snooze / Decline with explicit accessible button bar (`§17.10` 2.5.7 compliance).
  - **Offline Database Views:** Native List, Board, and Card Detail property editors backed by `expo-sqlite` scoped hydration.
  - **Native Voice Memos:** Press-and-hold mic button in `native-chat-composer.tsx` with waveform preview & background quarantine upload.
  - **Interactive Push Actions:** Approve/Deny R2 agent requests, reply to Chat DM/mention, or Snooze Mail directly from iOS/Android notification actions.
  - **Tablet Split-View:** Master-detail adaptive layout matching desktop density on iPadOS & Android tablets.

### 8.5 Enterprise Identity & Governance Polish (Always Open Source — AGPL-3.0)

Consistent with `§2.5` (*One edition — zero paywalled features*):

- **SAML 2.0 & OIDC Enterprise SSO:** Workspace-configurable IdP metadata (Okta, Entra ID, Google Workspace, Keycloak) via Better Auth SSO plugin / `identity` module with verified domain auto-join and enforced SSO policy.
- **SCIM 2.0 Provisioning (`apps/server/src/modules/identity/scim.ts`):** Token-authenticated `/scim/v2/Users` & `/scim/v2/Groups` endpoints automatically provisioning/suspending `memberships` and syncing IdP teams directly into Huriro `user_groups` (`@oncall`, `@engineering`).
- **Scoped Audit Exports & Retention Holds:** Teamspace/Inbox compliance export (JSON/CSV/EML) and legal-hold flags preventing retention pruning on held Mail/Chat/Docs records.

---

## 9. V2 Roadmap, Milestones (M7–M12) & Exit Criteria (G7–G12)

### 9.1 Assumptions & Sequencing

- **Team & Velocity:** Sequenced for **one full-time founder-engineer working with AI coding agents** (~40 working weeks across 6 milestones; compresses to ~25 weeks with a second full-stack engineer running Docs Databases and Chat/Mail in parallel). **Never compress acceptance gates.**
- **Continuous Workstream (~20% per cycle):** Design system tokens & Storybook states, WCAG 2.2 AA & axe checks, security/RLS/deny-path tests, `<= 200 KB` bundle checks, `>= 60%` shared-code checks, Lingui strings + pseudo-locale, and ADRs/runbooks land in the same PR.
- **Release & Upgrade Discipline:** Every milestone ships as a tagged, self-hostable release (`v1.2` → `v2.0`) with tested expand→migrate→contract upgrades directly from `v1.0`.

```text
W01 ────── W06 ────────── W12 ────────── W18 ────────── W24 ──────────── W32 ──────────── W40
│ M7         │ M8           │ M9           │ M10          │ M11            │ M12
│ Spine v2 + │ Tasks Linear │ Docs Author  │ Docs         │ Chat Slack +   │ AI v2, Tauri 2,
│ Tasks Core │ Completion   │ & Wiki       │ Databases    │ Mail Front/SH  │ Mobile v2, GA
└─ G7 ───────┴─ G8 ─────────┴─ G9 ─────────┴─ G10 ────────┴─ G11 ──────────┴─ G12
  v1.2         v1.3           v1.4           v1.5           v1.8             v2.0 GA
```

### M7 — Platform Spine v2 & Tasks Linear Core (Weeks 1–6 → `v1.2`)

| Deliverable | Notes |
| :--- | :--- |
| Unified `entity_links` graph + backfill from V1 link tables + universal Hover Peek Cards | §7.1, ADR-0033 |
| Sync Engine v2 (`packages/sync-client`): two-tier selective + lazy scoped hydration + LRU OPFS/SQLite cache | §8.1, ADR-0031 |
| Workflow Automation Engine core (`automations` module): outbox + cron triggers, `FilterExpr` conditions, YAML export/import, `x_automation_depth <= 5` loop guard, dry-run simulator | §7.2, ADR-0028 |
| Tasks Triage Queue (`A/H/M/D` keyboard triage, AI duplicate/field hints) | §3.1 |
| Multi-select + floating Bulk Action Bar (`POST /api/v1/issues/bulk` atomic + 5s Undo) | §3.4 |
| Compound Filter AST (`packages/domain/src/filter-ast.ts`), Grouping & 2D Board Swimlanes, Inline Nested Sub-Issues | §3.4 |
| Cycles automation (`cycle_daily_snapshots`, auto-rollover, Burnup & Scope-Creep charts) | §3.3 |
| **Gate G7 — Sync Scale & Tasks Core** | 50k-row seeded workspace boots `< 1.5 s` via lazy scopes; bulk update of 200 issues executes in `< 300 ms` p95 with single outbox batch; automation loop depth test kills cyclic rules at depth 5; two-tenant RLS tests pass for all new tables; `bun run verify` green. **Tag `v1.2`** |

### M8 — Tasks Linear Completion (Weeks 7–12 → `v1.3`)

| Deliverable | Notes |
| :--- | :--- |
| Initiatives, `initiative_projects`, Project Status Updates, and Project Milestones | §3.2 |
| Zoomable Timeline / Roadmap view (dependency connectors + `[`/`]` keyboard resize) + Calendar view | §3.2 |
| Typed Custom Fields (`custom_field_definitions` + sparse indexed `issue_custom_field_values`) | §3.5 |
| Issue Templates + Recurring Issues (RRULE + idempotent worker spawning) | §3.5 |
| GitHub PR/CI v2 + GitLab Webhook/OAuth Adapter + Magic Branch (`Mod+Shift+.`) + Auto-Status Transitions | §3.6 |
| Issue Watchers, Structured `issue_activity` Diff Timeline, Comment Reactions, SLAs (`issue_sla_policies`), Insights Analytics | §3.7 |
| Intake Forms (internal & signed public links) + Customer Requests linking | §3.1 |
| **Gate G8 — Linear Parity** | End-to-end flow passes: public intake form → Triage → magic branch → PR merged auto-closes issue → SLA met; Timeline/Insights stay isolated in `timeline-charts-chunk` (`web shell <= 200 KB` gzip); keyboard-only & axe checks pass across Timeline, Calendar, and Bulk Bar. **Tag `v1.3`** |

### M9 — Docs Notion Authoring & Wiki (Weeks 13–18 → `v1.4`)

| Deliverable | Notes |
| :--- | :--- |
| Multi-column layouts (`ColumnsExtension`), Block Drag Handle (`⋮⋮`) + keyboard `Mod+Shift+↑/↓` & Turn Into menu | §4.2 |
| Synced Blocks (`doc_synced_blocks` over dedicated Yjs rooms) | §4.2 |
| Resizable Tables + cell tints/sort, lazy Mermaid diagrams (`mermaid-chunk`), lazy KaTeX math (`katex-chunk`), Toggle Headings, Inline ToC, Bookmark Cards, Button Blocks | §4.2 |
| Page Covers, Typography (`sans/serif/mono`), Full-width, Small-text & Page Locking | §4.2 |
| **In-house MIT Suggestion Mode** (`SuggestionInsertMark` / `SuggestionDeleteMark` + `doc_suggestions` review/accept/reject) | §4.3, ADR-0027 |
| Wiki Verification & Freshness expiry alerts (`doc_verifications`), Backlinks (`entity_links`), Knowledge Graph (`graph-chunk`), Teamspaces (`teamspaces`), Publish to Web + PDF/HTML/ZIP export | §4.3–4.5 |
| **Gate G9 — Authoring & Wiki** | 10 concurrent editors merge columns, synced blocks, and Suggestion Mode edits with zero Yjs divergence; published public doc passes HTML/XSS fuzz corpus; `mermaid`/`katex`/`graph` chunks never load on initial app boot. **Tag `v1.4`** |

### M10 — Docs Structured Databases & Linked Views (Weeks 19–24 → `v1.5`)

| Deliverable | Notes |
| :--- | :--- |
| Relational Database schema (`doc_databases`, `doc_database_properties`, `doc_database_rows`, `doc_database_cell_values`, `doc_database_views`) + lazy scope sync (`db:<id>`) | §4.1, ADR-0026 |
| All 16+ property types including **Relations to other Databases AND live Huriro Issues / Mail Conversations** + Rollups | §4.1 |
| **Sandboxed Pure-TS Formula Engine** (`packages/domain/src/formula/*`) + Formula Editor UI (`database-grid-chunk`) | §4.1 |
| 6 Synchronized Views (Table, Board, Gallery, Calendar, Timeline, List) + inline `linkedViewBlock` embeds (for Databases & Issue Saved Views) + CSV/JSON import/export | §4.1 |
| **Gate G10 — Databases** | 10,000-row database renders virtualized Table/Board views at 60 fps scrolling and filters/sorts in `< 120 ms` server / `< 16 ms` local replica; formula fuzzer confirms depth/step caps prevent ReDoS/DoS/XSS; DB row permissions respect workspace/teamspace ACLs. **Tag `v1.5`** |

### M11 — Chat Slack-Parity & Mail Front/Superhuman-Parity (Weeks 25–32 → `v1.8`)

| Deliverable | Notes |
| :--- | :--- |
| **Chat v2:** Rich composer, custom workspace emoji, `/` slash commands, broadcast thread replies, quoted replies & ACL-safe forwarding, synced drafts, scheduled messages, Saved/Later reminders | §5.1–5.2 |
| **Chat v2:** Custom sidebar sections, channel bookmarks, pinned messages, **Channel Canvas** (linked Yjs `doc_page`), user statuses/DND, User Groups (`@handle`), keyword alerts, interactive Polls & R2 Approval cards | §5.3–5.5 |
| **Chat v2:** Async voice/screen clips with AI transcription + optional **LiveKit Huddles** profile (`HURIRO_HUDDLES_ENABLED=1`) | §5.6, ADR-0029 |
| **Mail v2:** Yjs real-time collaborative drafts (`mail_draft:<ws>:<id>`) + Draft Approval review gate | §6.1, ADR-0032 |
| **Mail v2:** Canned `;snippets` with merge vars, multi-step Macros, proactive compose/forward/split, Send Later + "if no reply" follow-up reminders, bulk triage & Split-Inbox tabs | §6.2 |
| **Mail v2:** Conversation tags, automated round-robin routing (respecting DND & WIP caps), Mail SLAs + Inbox Analytics, Contacts & Organizations sidebar, Bidirectional Issue ↔ Mail resolution loop, Guarded Mail AI, Private connected inboxes, Stalwart JMAP Compose profile | §6.3–6.5 |
| **Gate G11 — Comms Parity** | Real customer thread co-edited by 2 agents in Yjs draft → reviewed → sent → follow-up wakes on silence → linked Issue completed reopens thread with AI draft; 500-msg chat burst + broadcast thread replies exact under concurrency; LiveKit token check rejects non-members; Huddles off leaves default Compose footprint unchanged. **Tag `v1.8`** |

### M12 — AI Assistant v2, Tauri 2 Desktop, Mobile v2, Enterprise SSO/SCIM & v2.0 GA Hardening (Weeks 33–40 → `v2.0`)

| Deliverable | Notes |
| :--- | :--- |
| Built-in AI Assistant Panel (`Mod+Shift+A`, shadcn AI Elements) + contextual AI actions + expanded V2 `packages/agent-tools` registry + Live Agent Run Inspector | §7.3 |
| Unified Inbox v2 (snooze + keyboard triage), My Day Agenda, signed read-only iCal/WebCal feeds | §7.4 |
| Search v2 Query DSL + sandboxed PDF/DOCX/voice transcript extraction | §7.5 |
| **Tauri 2.x Desktop App (`apps/desktop`)**: global quick-capture (`Alt+Space`), tray badge, native notifications, multi-window/tabs, `huriro://` deep links, signed updater + **Web Split-Pane (`Mod+\`)** | §8.4, ADR-0030 |
| **Mobile v2 (`apps/mobile`)**: Triage swipe deck, offline Database views, native voice-note recorder, interactive push actions, tablet split view | §8.4 |
| SAML 2.0 / OIDC Enterprise SSO + SCIM 2.0 user/group provisioning + Teamspace compliance exports | §8.5 |
| **V2 Security Audit / External Pentest + Scale & Upgrade Drills** | Focused on new attack surfaces: Formula parser, Automation engine, Public Docs, Public Intake Forms, LiveKit tokens, Yjs Mail Drafts; upgrade test `v1.0 → v2.0`; 14-day dogfood SLO soak. |
| **Gate G12 — v2.0 GA** | Zero critical/high pentest findings; `bun run verify` (incl. `check:bundles <= 200 KB`, `check:shared-code >= 60%`, 100% RLS coverage across all V2 tables) green; Tauri desktop & Expo mobile signed builds pass; zero-downtime migration verified from `v1.0` backup. **Tag `v2.0`** |

---

## 10. V2 Architecture Decision Records (ADR-0026 → ADR-0033) & Risk Register

### 10.1 V2 Decision Queue (Written Before Each Owning Milestone Starts)

| ADR        | Decision                                                                                     | Position                                                                                                                  | Needed By |
| :--------- | :------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ | :-------- |
| **0026**   | Relational Doc Databases & Sandboxed Formula Engine                                          | Store DB rows/cells in Postgres (`doc_database_*`), not Yjs blobs; parse & bound formulas in pure TS (`packages/domain`). | M10       |
| **0027**   | In-House MIT Suggestion Mode over Yjs                                                        | Implement `SuggestionInsertMark` / `SuggestionDeleteMark` in `packages/editor`; avoid paid TipTap Pro add-ons.            | M9        |
| **0028**   | Cross-Pillar Workflow Automation Engine & Loop/Privilege Guards                              | Outbox-driven `automations` module; scoped `automation` principal; `x_automation_depth <= 5`; dry-run simulator.          | M7        |
| **0029**   | Optional Audio/Screen Huddles via LiveKit OSS Sidecar                                        | Native async clips on `files`; live huddles via optional Apache-2.0 LiveKit Compose profile (`HURIRO_HUDDLES_ENABLED=1`).   | M11       |
| **0030**   | Desktop Application via Tauri 2.x Thin Shell (superseding ADR-0009)                          | Package `apps/web` inside `apps/desktop` (Tauri 2.x) for quick-capture, multi-window, tray, and `huriro://` links.       | M12       |
| **0031**   | Sync Engine v2 Selective & Lazy Collection Hydration (extending ADR-0004)                    | Two-tier sync (eager core + scoped lazy DB/archive/history collections); trigger CDC migration if `change_log` p95 > 50 ms.| M7        |
| **0032**   | Real-Time Collaborative Mail Drafts via Hocuspocus Rooms                                     | Share Hocuspocus Yjs rooms (`mail_draft:<ws>:<id>`) for concurrent co-editing; soft-lock fallback offline.               | M11       |
| **0033**   | Unified Cross-Entity Graph (`entity_links`)                                                  | Single typed bidirectional link graph with expand→dual-write→backfill from V1 `mail_conversation_*` tables.             | M7        |

### 10.2 V2 Risk Register (`R22–R31`)

| #       | Risk                                                                           |  L  |  I  | Mitigation                                                                                                                                                                             | Trigger to Act                                              |
| :------ | :----------------------------------------------------------------------------- | :-: | :-: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------- |
| **R22** | Formula engine DoS (deeply nested rollups/expressions) or XSS in formula output|  M  |  H  | Strict AST depth/node (`<= 256`) & eval step (`<= 2000`) caps, cycle detection at property-save time, zero `eval`/`Function`, render output strictly as escaped text/number tokens.     | Any formula eval > 15 ms or fuzz crash                      |
| **R23** | Automation infinite loops or privilege escalation across pillars               |  H  |  H  | Propagate `x_automation_depth` in outbox metadata and halt at `>= 5`; enforce scoped `automation` principal + `can()` at execution; workspace per-minute run quota + kill switch.       | Rule depth hits 5 or workspace triggers > 1k runs/min       |
| **R24** | Large Doc Databases (10k–100k rows) degrade browser RAM or sync latency        |  H  |  M  | Tier-2 lazy scoped hydration (`db:<id>`), server-side filtered windowing above 5k rows, OPFS/SQLite LRU eviction, sparse indexed columns (`val_text`, `val_number`, `val_date_start`). | Client replica memory > 150 MB or DB open > 300 ms p95      |
| **R25** | Web initial bundle exceeds `200 KB` gzip due to Mermaid/KaTeX/Charts/Databases |  H  |  M  | Hard `check:bundles` CI gate from M7; explicit dynamic `import()` boundaries (§8.3); bundle-analyzer diff reported on every PR.                                                        | Any PR increases initial shell > 185 KB gzip                |
| **R26** | Suggestion Mode marks split or corrupt under concurrent Yjs edits              |  M  |  M  | Store suggestion metadata in immutable ProseMirror mark attributes, run 10-editor randomized fuzz tests in CI, provide "Reject/Flatten orphaned suggestion" recovery command.           | Any Yjs round-trip mismatch or orphan mark bug              |
| **R27** | Public Docs / Public Intake Forms open XSS, SSRF, or spam abuse vectors        |  H  |  H  | Reuse V1 strict HTML sanitizer + CSP on `/p/*`; block private IP ranges on embeds; sign intake tokens; per-IP/workspace rate limits + attachment quarantine; no CAPTCHA bypass paths.    | Any sanitizer test regression or public spam spike          |
| **R28** | LiveKit Huddles sidecar complicates self-hosted VPS setups                     |  M  |  L  | Keep LiveKit strictly opt-in behind `--profile huddles` and `HURIRO_HUDDLES_ENABLED=1`; core Compose stack remains Postgres + Huriro only; `huriro doctor` validates TURN/UDP ports.   | Self-host Huddle setup issues > 10% of support threads      |
| **R29** | Tauri 2 WebView parity quirks (Linux WebKitGTK OPFS / IME vs WebView2/WKWebView)| M  |  M  | Test TipTap + OPFS SQLite matrix across macOS/Windows/Linux in CI; automatically fall back to Tauri native SQLite plugin bridge if WebView OPFS is restricted on Linux.               | OPFS init failure on any desktop OS target                  |
| **R30** | Collaborative Mail Drafts expose unsent edits or race during Send              |  M  |  H  | Draft room ACLs require `mail.send`/`mail.read` on that inbox; clicking Send atomically locks draft (`status = 'sending'`), flushes Hocuspocus room snapshot, and enforces `review_status`. | Any stale-body send or concurrent send race                 |
| **R31** | Scope creep across 4 expanded pillars stalls solo/small-team shipping          |  H  |  H  | Strict tagged milestone releases (`v1.2`→`v2.0`) deliver value incrementally. **V2 Cut Order:** LiveKit Huddles → Knowledge Graph visual canvas → Linux Flatpak Tauri → Insights custom chart builder → Stalwart JMAP → Nested formula rollups. **Never cut:** RLS coverage, automation depth/principal guards, formula sandbox limits, bundle/shared-code gates, a11y, or upgrade drills. | Any milestone slips > 2 weeks                               |
