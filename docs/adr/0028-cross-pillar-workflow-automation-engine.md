# ADR-0028: Cross-Pillar Workflow Automation Engine & Loop/Privilege Guards

- **Status:** Accepted
- **Date:** 2026-11-25
- **Plan refs:** §7.2, §10.1 (ADR-0028), §10.2 (R23)

## Context

Every V1 mutation already flows through the transactional `outbox`, which makes outbox domain events (`issue.created`, `issue.status_changed`, `doc.verification_expiring`, `chat.message.created`, `mail.inbound.received`, `vcs.pr.merged`, …) a natural trigger source for no-code automations — no polling and no separate webhook glue. §7.2 specifies an `automations` server module with `automation_rules`, `automation_runs`, and `automation_run_steps` tables, but leaves four questions open:

1. **Which identity executes a rule?** Automations mutate data across all four pillars on behalf of users who may not be online — running them as a superuser would bypass RLS and `can()` entirely, and running them as the triggering actor would silently break rules when that actor loses access.
2. **What stops automation-triggered automations from looping?** A rule whose action emits a new domain event can retrigger itself or feed a cycle of rules (R23 — likelihood and impact both High).
3. **How are conditions and actions expressed?** The plan requires declarative conditions and a closed cross-pillar action catalog — never arbitrary code.
4. **How do teams author and port rules?** §7.2 asks for a visual builder *and* version-controllable definitions.

## Decision

1. **Outbox-driven execution.** The `automations` module (`apps/server/src/modules/automations/`) consumes domain events off the outbox plus cron schedules (pg-boss) — there is no separate event bus. Each firing writes an `automation_runs` row (`rule_id`, `trigger_event_id`, `status`, `depth`, `duration_ms`, `error_detail`) with per-action detail in `automation_run_steps`.
2. **Every rule runs as an explicit least-privilege principal.** A rule is bound to an `agent_principals(kind='automation')` principal owned by an admin. All reads and writes go through `can()` and the normal `withWorkspace` RLS transaction — the engine never bypasses either. If the principal lacks a permission the run records the denial and stops; automations can never exceed what their owning admin could do interactively.
3. **Loop guard via propagated depth.** Outbox event payload metadata carries `x_automation_depth`, incremented whenever an automation-caused write emits a further event. A rule triggered at `depth >= 5` aborts cleanly and the run records `loop_guard_tripped` — cycles terminate deterministically with an auditable trail instead of silently stacking latency. This is layered on a **per-workspace per-minute run quota** (act when > 1k runs/min per R23) and an `enabled = false` **kill switch** per rule/workspace.
4. **Conditions reuse the domain `FilterExpr` AST** (`packages/domain/src/filter-ast.ts`): rules store a validated `condition_ast` evaluated by the same pure module that powers saved-view filters — one validation and evaluation implementation for both. Untrusted text checks are limited to regex/keyword predicates inside that AST. **No arbitrary JS eval anywhere in the pipeline.**
5. **Actions are a closed cross-pillar catalog** — create/update issue, transition status, add/remove label or tag, create database row, post chat message/thread reply, assign mail conversation (including round-robin), add mail internal note, send outbound webhook, assign & wake an AI agent principal — each executed by calling the owning module's service under the rule principal, so policy, outbox, and audit invariants are inherited rather than reimplemented.
6. **Dry-run simulator.** Any rule can be tested against a historical event or entity ID: conditions are evaluated and the predicted mutations returned without committing anything, so admins can inspect behavior before enabling.
7. **Visual builder + bidirectional YAML export/import.** The UI builder (lazy `automation-builder-chunk`) and the YAML form are two serializations of the same rule schema, so workflows can be versioned and reviewed in Git.

## Consequences

- Automation power is strictly bounded by an ordinary principal's permissions — privilege escalation across pillars is structurally impossible, not merely audited.
- `x_automation_depth` makes loop termination a property of the outbox metadata, independent of how many rules are involved; the quota and kill switch bound blast radius for non-cyclic runaway rules.
- Reusing `FilterExpr` means automation conditions gain every filter-field improvement for free, and `validateFilter`'s structural caps (depth, node count, list size) double as the condition-safety sandbox.
- The closed action catalog means new action kinds require a server release — deliberate, since each one must wire policy + outbox + audit correctly.
- Runs are fully auditable (`automation_runs`/`automation_run_steps`) including aborts, denials, and loop-guard trips; dry-run gives operators a safe pre-enable check.
