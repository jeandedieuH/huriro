# ADR-0020: Agent tool registry, dispatcher, and approval execution

- **Status:** Accepted (M3, stage 2)
- **Date:** 2026-11-25
- **Plan refs:** §13.1a, §13.3, §13.5, §13.6; builds on ADR-0019

## Context

Agent credentials (ADR-0019) now reach two surfaces — REST `/api/v1/agent/*`
and, in stage 3, `/mcp`. Both must expose the *same* capability set with the
*same* authorization and audit behavior. Risk tiers (R0–R3) require two
different escalation paths: cheap in-client confirmation for reversible
writes, and out-of-band human approval for high-impact writes. Undo must
exist for the reversible ones. We needed one choke point where all of this
applies regardless of transport.

## Decision

### One registry, specs only

`packages/agent-tools` holds a single `TOOLS` registry of tool *specs* —
name, model-facing description, TypeBox input/output schemas, required
`AgentScope`, base `RiskTier`, read/write kind, `untrustedFields`,
`idempotent`/`undoable` flags, optional `tierForInput` (input-dependent
raise, e.g. bulk size). It has **no handlers and no imports from db/server**
— it only feeds manifest generation (MCP tools list, CLI commands, OpenAPI
`agent` tag). The server binds exactly one handler per spec in
`modules/agents/tool-handlers.ts`; `assertRegistryCoverage()` fails boot on
any mismatch in either direction. Schemas use `additionalProperties:false`
— unknown props are rejected before any business logic runs. No R3 tool can
be registered.

### One dispatcher for every surface

`invokeTool()` in `modules/agents/dispatch.ts` is the ONLY path that can
execute a tool, in a fixed order: validate input → resolve the agent
principal + owner state **live** (re-resolved every call) → scope check →
effective tier (base + `tierForInput` + principal `tier_overrides` +
`require_approval_all_writes`, raise-only) → refuse R3 → per-principal
token bucket + per-credential read-volume cap → tier gate → execute the
handler inside one `withWorkspace` tenant tx → write `agent_tool_calls`
(success, denial, and error outcomes are all audited; denials record in a
separate short tx so they survive handler rollback). Handler calls module
`index.ts` seams only — never repos.

### Why the server executes stored approval args, as the agent

For R2 the dispatcher validates and *hashes* the input (canonical JSON
SHA-256) and stores it in `agent_approvals` — no domain row is written at
request time. On human approval, the server executes the **stored** args
through the same dispatcher, with the credential re-derived from the
**agent** principal — not the approver:

- **No confused deputy**: the approver never re-submits args (a client-side
  "approve with edits" would let an approver smuggle a different operation
  the agent never proposed). The hash check at execution makes tampering
  with the stored row a refusal, not a silent change.
- **Re-resolved authorization**: at execution time the principal may have
  been suspended/revoked, or the owner demoted — `resolveAgentActor` runs
  again inside the approval execute path and fails the approval (`failed`
  status, no write) rather than executing under stale privilege.
- **Correct attribution**: audit/outbox/tool-call rows carry
  `actor_type='agent'` + the principal id — the approving human appears
  only in `decided_by`.

### Why REST R1 is "pre-approved" while MCP R1 elicits

REST agent calls are made by a human running the `huriro` CLI or a script
they deliberately wrote — the act of invoking the command *is* the
confirmation, and pausing for a second confirmation provides no security
value while breaking non-interactive use. MCP calls are proposed by a
model on the user's behalf, so the client must round-trip a confirmation
(`needs_confirmation` → MRTR elicitation) before the write executes. The
dispatcher encodes this as `transport:'mcp'` ⇒ R1 writes need
`confirmation:'elicited'`; `transport:'rest'` treats R1 as confirmed.

### Undo semantics

R1 writes on `undoable` tools record an `agent_undo_log` row in the same tx
as the write (before-image or a pre-write doc version checkpoint). Undo is:

- **one-shot** — `undone_at` set on use, second undo 409s;
- **expiring** — 7-day window;
- **still-checked** — the principal must remain active and the write is
  executed under the original agent's authorization, not the user's;
- **conservative** — issue deletes and comment deletes are hard-delete; an
  update only restores prior field values while the row version is
  unchanged; a doc append/create restores the named checkpoint version.
- A tool that cannot satisfy "no later edits" semantics is marked
  `undoable:false` rather than lying.

### Consequences

- Adding a tool = one spec + one handler; every surface, audit path,
  preview renderer, and permission gate inherits it.
- The dispatcher is a natural single point for the stage-3 MCP adapter.
- Approval `executing` is a compare-and-set, so concurrent decisions
  collapse to one execution.
- Rate limits are in-process (single-node default — same caveat as
  ADR-0019's replay store).

## Stage-3 addendum (MCP transport)

- **MRTR confirmation:** R1 writes on `/mcp` return `input_required` with an elicitation form whose message is the server-rendered preview and an HMAC-SHA256 `requestState` binding {principalId, tool, argsHash, 10-min expiry}. Every retry re-verifies signature, expiry, principal, tool, and re-hashes the re-supplied args; any mismatch refuses with `confirmation_invalid` — the client never self-attests.
- **No-elicitation fallback:** a client whose capabilities lack elicitation support is NEVER silently executed; an R1 write is treated as R2 and parks a Huriro approval (`approval_required` + approveUrl), polled via `approvals.status`.
- **Subscriptions deferred:** `resources/subscribe`/`listen` is not implemented in alpha; `tasks.my_queue` polling is the supported pickup path.
- **Workspace binding:** user-level tokens resolve to a principal via active memberships (single → bind; several → `X-Huriro-Workspace` or most-recent; none → `agent_not_connected`); everything then runs under `withWorkspace` with the OWNER user id.
- **Denial persistence:** denial/error `agent_tool_calls` rows are written in a second short `withWorkspace` tx after the work tx rolls back; pre-principal failures write `audit_log` with `actor_type='agent'`, null actor id, and {clientId, userId, tool, code} metadata.
- **Markdown representations:** `GET …/issues/:id.md`, `…/docs/:idOrSlug.md` (session + agent-bearer twins) reuse the api/markdown renderers — untrusted blocks, link neutralization, caps.
