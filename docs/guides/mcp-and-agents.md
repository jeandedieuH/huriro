# MCP, Agents, & CLI Guide

## 1. Agent Principals & Scoped Credentials

Huriro models automated collaborators as explicit agent principals (`agent_principals`) rather than shared human accounts:
- **Scoped API Keys (`hrk_...`)**: Created by workspace owners/admins (`Settings -> Agents & API keys`) with explicit scopes (`tasks.read`, `tasks.write`, `docs.read`, `chat.write`, etc.) and configurable expiration. Keys are SHA-256 hashed at rest; the raw token is displayed once at creation.
- **OAuth 2.1 / MCP Bearer Tokens**: Audience-separated tokens validated against the instance `/mcp` resource server URI (`token_audience_mismatch` on mismatched audiences).

## 2. Tool Risk Tiers & Human Approvals

Every MCP tool call is authorized against both the agent principal's scopes and workspace RBAC:
- **R0 / R1 Tools**: Read queries and bounded non-destructive updates execute immediately with full audit logging (`actor_type = 'agent'`).
- **R2 Sensitive Actions**: High-impact mutations enter an approval queue (`agent_approvals`). Workspace approvers (`approval.decide`) review the sanitized argument preview in **Settings → Approvals** before execution proceeds.
- **Per-Agent Rate Limits**: Excess tool bursts trigger `429 tool_rate_limited`.

## 3. MCP Endpoint (`POST /api/v1/mcp` / `/mcp`)

Connect any MCP-compatible client over Streamable HTTP with `Authorization: Bearer hrk_...` and `X-Workspace-Id: <uuid>`:
```bash
curl -fsS -X POST https://workspace.example.com/api/v1/mcp \
  -H "Authorization: Bearer $HURIRO_API_KEY" \
  -H "X-Workspace-Id: $HURIRO_WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 4. Workspace CLI Operations

Operator maintenance commands execute directly from the `huriro` entrypoint (`apps/server/src/index.ts`):
- `bun run doctor`: Pre-flight checks (Postgres connectivity, migrations, Valkey, TLS/origin config, secret strength).
- `bun run migrate`: Apply pending SQL migrations safely.
- `bun apps/server/src/index.ts backup --verify`: Create custom-format PostgreSQL dump + verify restore into a temporary database.
- `bun apps/server/src/index.ts restore <file> --yes`: Restore a verified dump over `DATABASE_ADMIN_URL`.
