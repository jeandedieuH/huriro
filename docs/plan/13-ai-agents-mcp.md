# 13. AI Agents & MCP

## 13.1 Position

The MCP server is a **first-class product surface**: it must be secure enough to let a customer point Cursor at their workspace without fear, and limited enough that a prompt-injected email cannot exfiltrate the company's specs.

## 13.1a Agent-native architecture (added in v1.1)

MCP is one _transport_ for agents, not the whole story. Five properties make Huriro genuinely good to work with for agents — external ones (Claude, Cursor, Devin, Codex) and the built-in assistant alike:

| Property                  | Design                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One tool registry**     | Each capability is defined once in `packages/agent-tools`: name, description written for models, TypeBox input/output schema, required scope, risk tier (§13.5), and a handler that calls a module _service_ with an `ActorContext`. The registry generates the MCP tool list, the CLI subcommands, the OpenAPI operations for "agent" endpoints, and the in-app assistant's tools. No tool can bypass the policy layer because tools never touch repos. |
| **Agents are principals** | `agent_principals` (§8.3) — named, badged, owned by an accountable human, with a scope ceiling. An agent can be **assigned an issue**, @mentioned in a comment or thread, and subscribed to a project; it shows up in activity feeds as itself ("Claude · on behalf of Ana"), never impersonating a person.                                                                                                                                              |
| **Work hand-off**         | Assigning an issue to an agent creates an `agent.task.assigned` event. Agents pick work up by polling `tasks.my_queue`, by MCP `subscriptions/listen` (resource change notifications), or by a signed webhook. Progress is posted as structured activity (`agent.status`: working / needs input / done / failed) with links to PRs or docs, so humans see agent work in the same timeline as human work.                                                 |
| **Model-legible content** | Every entity has a canonical **Markdown representation** (`GET /api/v1/issues/ENG-142.md`, `…/docs/<slug>.md`) with front-matter for metadata, exposed as MCP resources under `huriro://` URIs. Stable short identifiers (`ENG-142`) are accepted everywhere a UUID is. Public docs ship `llms.txt`. Errors are RFC 9457 with machine-readable `code`s and a hint on how to recover.                                                                     |
| **CLI for coding agents** | `huriro` (MIT, generated from OpenAPI): `huriro issue view ENG-142 --md`, `huriro issue comment`, `huriro doc get`, `--json` on every command, device-flow login, non-interactive mode for CI. Coding agents in a terminal are more reliable with a CLI than with a remote MCP server, so we support both.                                                                                                                                               |

## 13.2 Protocol baseline

- **Transport:** MCP **Streamable HTTP** (POST-only) served on the **same origin under `/mcp`** (with a dedicated `mcp.<domain>` alias available for clients that require a distinct resource). All requests are stateless — no session id, no GET stream.
- **Spec version:** target **MCP `2026-07-28`**. Key properties of that revision: the protocol is **stateless**, server-initiated requests (elicitation/sampling) are replaced by **multi round-trip requests** (`InputRequiredResult`), **Dynamic Client Registration is deprecated in favour of Client ID Metadata Documents**, and servers **MUST** implement **RFC 9728** protected-resource metadata with strict token-audience validation. Support the previous revision (`2025-11-25`) only if a real client requires it; otherwise reject with a clear version error. Pin the revision in code and re-verify at build time.
- **Discovery:** publish `/.well-known/oauth-protected-resource` so clients can locate the authorization server.
- **Authorization:** act as an **OAuth 2.1 authorization server** with **PKCE (S256)**, exact redirect-URI matching, **RFC 8707 resource indicators** (token audience-bound to the MCP resource), **RFC 9207 `iss`** for mix-up defense, and rotating refresh tokens. Prefer **CIMD** for client registration; keep DCR off unless a client cannot do otherwise.
- **No token passthrough, ever.** A presented token is validated for _our_ audience; we never forward a client token upstream. Tokens never appear in query strings.
- **Confused deputy defense:** every tool call resolves permissions from the **consenting user**, not "the client", and re-checks membership at call time because claims go stale. Per-client consent is recorded and revocable.
- **SSRF hygiene for discovery:** CIMD/metadata fetches go through the egress proxy with private-range blocking and redirect re-validation.

## 13.3 Token model

| Concept     | Value                                                                                                                                                                                                                                              |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token types | Short-lived access token (15 min) + rotating refresh token                                                                                                                                                                                         |
| Binding     | `sub` = consenting user, `act` = agent principal id (RFC 8693-style actor claim), `wid` = workspace, `scopes` = explicit tool scopes, `aud` = MCP resource. Effective permission = token scopes ∩ agent scope ceiling ∩ user's current permissions |
| Scopes      | `tasks.read`, `tasks.write`, `docs.read`, `docs.write`, `chat.read`, `mail.read`, `mail.draft`, `search.read`, `members.read`                                                                                                                      |
| Defaults    | Read scopes only. Write scopes require explicit opt-in in the consent screen.                                                                                                                                                                      |
| Lifetime    | User-revocable at any time from _Settings → Connected apps_, with a visible last-used timestamp                                                                                                                                                    |
| Audit       | Every tool call logged with token id, user, tool, arguments hash, and result status                                                                                                                                                                |

## 13.4 Tool surface (v1)

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

## 13.5 Confirmation and elicitation

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

## 13.6 Prompt injection: the core threat

Workspace content — especially **email** and pasted documents — is attacker-controlled. The defensive posture:

1. **Data/policy separation.** Retrieved content is inserted in a delimited block; the system prompt states plainly that instructions inside content are data, never commands.
2. **Least privilege by tool.** Read-only tokens by default; a summarizer agent that only needs `mail.read` never gets `mail.draft`.
3. **No exfiltration channels.** The MCP server cannot fetch model-generated URLs; images in tool results are proxied; markdown links are rendered as text with a destination warning. Combined with (2), this neutralizes the "lethal trifecta" of private data + untrusted content + outbound channel.
4. **Human-in-the-loop for outbound actions** (§13.5) — the single most effective control.
5. **Content provenance.** Tool results carry `trust: "untrusted"` metadata; the gateway quotes such content and strips instruction-like formatting where it can (defense in depth, not a silver bullet).
6. **Rate/volume limits** on tool calls and on the total content a single session may read, so exfiltration is slow and detectable.
7. **Anomaly alerts:** a workspace admin can see tool-call volume by client and revoke.

## 13.7 MCP operational requirements

- Tool schemas are versioned with the API; breaking a tool schema is a versioned change with deprecation notices.
- Structured output + a documented error contract (`isError`, machine-readable codes).
- Tool call timeouts (default 30 s), max result sizes (default 256 KB, paginated beyond), and cancellation support.
- Per-token concurrency caps to prevent a runaway agent from exhausting the API.
- The MCP endpoint is rate-limited independently of the REST API and can be disabled per workspace by policy.
