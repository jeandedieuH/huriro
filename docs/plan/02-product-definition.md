# 2. Product Definition & Scope

## 2.1 Personas

| Persona                  | Primary job                            | What must feel great                                                    |
| :----------------------- | :------------------------------------- | :---------------------------------------------------------------------- |
| **Engineer** (core ICP)  | Track work, read specs, discuss, ship  | Keyboard velocity, fast board/list, deep links from Git, instant search |
| **Product manager**      | Plan, write specs, triage              | Docs editor, timeline/roadmap, inbox→issue conversion                   |
| **Designer**             | Review, comment, attach artifacts      | Rich comments/annotations, image/video previews, notification control   |
| **Support/success**      | Answer customers, file bugs            | Shared inbox, assignment, collision detection, one-click → task         |
| **Ops/admin**            | Control access, audit, comply          | Role management, audit log, SCIM, data export/deletion                  |
| **AI agent (non-human)** | Retrieve context, draft, create/update | Scoped tokens, clear tool contracts, human approval for writes          |

## 2.2 In scope for v1

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

## 2.3 Explicitly out of scope for v1 (named so nobody silently scopes them in)

- Real-time **audio/video** calls, screen sharing.
- **Calendar** and scheduling (JMAP Calendars is deferred; the data model leaves room).
- **CRM/pipeline** objects beyond projects.
- **Automation builder** UI (the events/outbox foundation exists; the visual builder waits).
- **Public status pages**, forms/surveys, portals.
- **Fine-grained "Zanzibar"** relationship authorization at scale (design leaves a seam, see §12.5).
- **Native Rust GPU UI** (rejected; see Appendix A.9).
- **End-to-end encryption** of workspace content (design note in §22.6 on why and when).

## 2.4 Product principles (behavioral contracts)

1. **Never make the user wait on the network for their own action.** Writes apply locally in ≤ 1 frame and reconcile.
2. **Every object is addressable.** Issue `ENG-142`, doc slug, message permalink, mail conversation ID all have stable URLs and deep links.
3. **One search box.** One shortcut (`Mod+K`) finds tasks, docs, people, channels, and emails.
4. **Nothing happens invisibly.** Every write is attributable, auditable, and reversible where feasible.
5. **Agents are teammates with badges.** Same permissions model, visible attribution, human approval for external side effects.
6. **Density over decoration.** Information-dense views by default; whitespace earned per surface.
7. **Respect the operator.** Self-host is a first-class citizen: documented, backup-able, upgrade-able, no phone-home.
8. **API parity.** If a human can do it in the UI, a scoped token can do it through the API, the CLI, and MCP — through the same policy checks. No UI-only features.

## 2.5 Distribution, licensing, and editions

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
