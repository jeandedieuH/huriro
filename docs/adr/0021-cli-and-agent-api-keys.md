# ADR-0021: The `huriro` client CLI and workspace API keys

- **Status:** Accepted (M3, stage 4)
- **Date:** 2026-11-23
- **Plan refs:** §13.1a, §13.3, §13.6; extends ADR-0019/0020

## Context

Coding agents need a scriptable client (`huriro queue`, `huriro issue status
…`) and non-interactive credentials for CI. The OAuth device grant covers
interactive login; CI needs something that does not depend on a browser or a
refresh-token chain.

## Decision

**`@huriro/cli`** (MIT) is a pure HTTP client:

- The command surface is **generated** from the `@huriro/agent-tools`
  registry (`bun run gen` → `src/generated/commands.ts`; `gen:check` diffs).
  No hand-maintained SDK (plan §7 forbids them).
- Hand-written alias map (`aliases.ts`) provides the ergonomic core loop
  (`queue`, `issue view|create|comment|status`, `doc *`, `search`,
  `approvals status|wait`) on top of the generic `tool <name>` command.
- Stable exit codes are a contract: 0 ok, 2 usage, 3 auth, 4
  approval_required, 5 rate-limited, 6 not-found. `--json`/`--md` pick the
  wire shape; logs go to stderr only.
- Credentials live per-server in `~/.config/huriro/credentials.json` (0600,
  atomic write); refresh-token rotation persists the NEW refresh token
  before the new access token is used.
- The server image keeps its own operator CLI inside `apps/server` — same
  binary name `huriro`, different package/entrypoint; they never ship in the
  same artifact.

**Workspace API keys (`hrk_…`)** are Huriro-owned, not the better-auth
api-key plugin, because they must be workspace-bound and audience-limited:

- Format `hrk_<8-char prefix>_<43-char base64url secret>`; only the SHA-256
  hash of the full key is stored; the raw key is returned once at creation.
- Keys are scoped to `AGENT_SCOPES` and bound to an `automation`
  `agent_principals` row (ceiling = key scopes) — revocation, suspension and
  owner-role downgrades take effect on the next call exactly like OAuth.
- **REST audience only**: `hrk_` bearers are verified inside the tenant
  transaction selected by `X-Workspace-Id` and are rejected on `/mcp` and on
  every session route. Audit rows carry the key id as `tokenId`.
- Management routes (`/api/v1/agents/api-keys*`) are session-only +
  `agent.manage`; agents can never mint keys (R3 — not exposed as a tool).
- `hrk_` values are scrubbed from logs (pino formatter allowlist) and
  repeated verification failures are throttled in-process per IP+prefix.

## Consequences

- A leaked key is workspace-scoped, revocable, and useless on `/mcp`;
  blast radius is the principal's ceiling.
- The CLI is fully testable in-process via the `Io` seam (fs/fetch/stdio
  injected), keeping it out of the server image's dependency tree.
