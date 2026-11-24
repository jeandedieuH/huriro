# @huriro/agent-tools

The single tool registry (§13.1a). One spec per capability generates the MCP
tool list, `huriro` CLI commands, OpenAPI `agent` operations, and in-app
assistant tools.

## Owns

- `src/registry.ts` — every `ToolSpec`: name, model-facing description,
  TypeBox input/output schema (from `@huriro/contracts`), required
  `AgentScope`, base `RiskTier`, read/write kind, `untrustedFields`,
  `idempotent`, `undoable`.
- `src/index.ts` — `TOOLS`, `getTool`, `toolManifest()`.

## Never do

- **No handlers.** This package stores specs only. Server handlers live in
  `apps/server/src/modules/agents/tool-handlers.ts`, bound by tool name.
- No imports from `@huriro/db` or `apps/*` — this package must stay loadable
  by the CLI, web assistant, and MCP adapter. Dependencies are limited to
  `@huriro/contracts`, `@huriro/domain`, and `typebox`.
- Never register an R3 tool (§13.5) — the invariant test refuses it.
- `write` tools must be `idempotent: true`; document the replay semantics in
  the tool's description.

## Rules

- Input schemas MUST set `additionalProperties: false` — unknown args are
  rejected at the dispatcher.
- Descriptions are written for models: what the tool does, what it returns,
  and any trust/undo notes. Non-empty.
- Adding a tool = add the spec here + a handler in
  `modules/agents/tool-handlers.ts`. Boot asserts a 1:1 match.

## Test

`bun test` in this package — registry invariants are CI-gated.
