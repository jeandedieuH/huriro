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

> **Working copy.** This plan is maintained as one file per section (§23.5 "plan hygiene").
> Edit the section file, not the monolith. `master-development-plan.md` at the repo root is
> the original v1.1 document, kept for reference and superseded by these files.

## Table of Contents

1. [Executive Summary](./01-executive-summary.md)
2. [Product Definition & Scope](./02-product-definition.md)
3. [What We Keep, Change, and Reject From the Original Sketch](./03-original-sketch-review.md)
4. [Engineering Principles & Non-Negotiables](./04-engineering-principles.md)
5. [Architecture Overview](./05-architecture-overview.md)
6. [Technology Stack & Version Policy](./06-technology-stack.md)
7. [Monorepo & Code Organization](./07-monorepo-code-organization.md)
8. [Data Architecture](./08-data-architecture.md)
9. [Sync, Real-Time & Offline](./09-sync-realtime-offline.md)
10. [Collaborative Documents](./10-collaborative-documents.md)
11. [Search, Retrieval & AI](./11-search-retrieval-ai.md)
12. [Security & Multi-Tenancy](./12-security-multi-tenancy.md)
13. [AI Agents & MCP](./13-ai-agents-mcp.md)
14. [Mail (Shared Inbox)](./14-mail-shared-inbox.md)
15. [Chat, Notifications & Presence](./15-chat-notifications-presence.md)
16. [API Design & Contracts](./16-api-design-contracts.md)
17. [UI/UX System](./17-ui-ux-system.md)
18. [Client Platform Strategy](./18-client-platform-strategy.md)
19. [Infrastructure, Environments & Delivery](./19-infrastructure-delivery.md)
20. [Observability & Reliability](./20-observability-reliability.md)
21. [Testing Strategy & Quality Gates](./21-testing-quality-gates.md)
22. [Privacy, Compliance & Data Governance](./22-privacy-compliance-governance.md)
23. [Roadmap, Milestones & Exit Criteria](./23-roadmap-milestones.md)
24. [Risk Register & Open Decisions](./24-risk-register-decisions.md)
25. [Appendix A — Defects in the Original Sketch](./25-appendix-a-defects.md)
26. [Appendix B — Sources](./26-appendix-b-sources.md)
27. [Appendix C — Revision log (v1.0 → v1.1)](./27-appendix-c-revision-log.md)
