# @huriro/contracts

The wire format (§7.2): TypeBox schemas, DTOs, error codes, event payloads.
Both server and clients import from here — **no duplicated shapes anywhere**.

## Owns

- `errors.ts` — every API error `code` + the problem+json schema (§16.2). New error
  codes are added here first, with a doc URL.
- `pagination.ts` — cursor pagination contract (`{data, nextCursor, hasMore}`).
- (later) event payloads for the outbox, MCP tool schemas, shared request/response DTOs.

## Never do

- No imports from `apps/*`, `packages/db`, `packages/domain`, or any server-only code —
  this package must stay importable by web, mobile, CLI, and external SDKs.
- No hand-duplicated wire shapes elsewhere in the repo; if a shape is on the wire or
  in an event payload, it belongs here.
- No `any` in public types (§6.5).

## Test

`bun test` in this package; schemas are exercised via server contract tests.
