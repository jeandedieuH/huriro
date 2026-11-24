# M3 threat-model review (§23.3, §13.6)

Scope: M3 stage 1 surfaces — OAuth authorization server (better-auth `mcp()` +
`jwt` + device grant), CIMD client-metadata fetching, dual-audience agent
bearer verification (`verifyAgentBearer`), domain scope/risk model, and the
`auth.*` OAuth tables (migration 0012). Later stages add the `/mcp` endpoint,
REST agent surface, tool registry, consent UI, CLI, and AI gateway — their
rows are marked **pending stage N**.

## Boundaries & assets

| Boundary                                            | Crosses                                                  | Assets                                                          |
| --------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Agent client → `/oauth2/*` (AS)                     | Authorization code / device grant + PKCE, consent        | Auth codes, refresh tokens, consent grants, JWKS private keys   |
| Agent client → `/mcp`, `/api/v1/agent/*`            | Bearer or DPoP-bound access token (audience-bound)       | Workspace data within token scope ∩ ceiling ∩ owner role        |
| AS → external `client_id` URL (CIMD)                | Egress-pinned HTTPS GET, no redirects                    | Client metadata integrity; server must not reach internal net   |
| `huriro` CLI → device flow                          | `verification_uri` + user code on a real browser         | Device codes, CLI credentials on operator machines              |
| `huriro_auth` role → `auth.*` tables                | Dedicated pool, zero tenant grants (structural)          | Token/consent/client rows, DPoP/assertion replay guards         |
| Model context ← tool results (pending stage 2–3)    | Untrusted user-authored content                          | Prompt-injection payload, cross-tenant exfil via tool args      |

## STRIDE findings & mitigations

| Threat                                                           | Surface                                   | Mitigation in place / status                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing — session token reused as agent bearer                  | `verifyAgentBearer`                       | Only `Authorization` is parsed; session tokens are opaque → 401. Session routes symmetrically ignore bearer (no bearer plugin mounted) |
| Spoofing — OAuth AS endpoint abuse                               | `/oauth2/*`                               | JWT session `/token` endpoint disabled (`disabledPaths`); DCR off; device grant restricted to registered clients with `grantTypes`    |
| Tampering — CIMD fetch SSRF / DNS rebinding                      | `cimd-transport`                          | `safeEgressFetch`: one DNS resolution, private/RFC 6890 + metadata ranges blocked, address pinned, **redirects refused**, 64 KiB cap   |
| Tampering — token audience confusion (REST token on /mcp & vice) | Both resource surfaces                    | Distinct RFC 8707 `aud` (`/mcp` vs `/api/v1/agent`); audience checked against the expected resource per surface → 401 + challenge       |
| Info disclosure — consent phishing (malicious client_id)         | CIMD + consent flow                       | No DCR; CIMD doc fetched server-side and shown on a Huriro-rendered consent screen (UI pending stage 6); no skip-consent beyond reads   |
| Info disclosure — confused deputy (over-broad token)             | `agent_principals` + scopes               | Effective permission = token scopes ∩ principal ceiling ∩ owner role, re-resolved per call (`actionsForScopes`, `agentScopeCeiling`)    |
| Info disclosure — prompt injection via tool results              | Registry tool handlers                    | `trust:"untrusted"` on user-authored fields; Markdown renderers delimit untrusted text ("UNTRUSTED CONTENT"), strip links→text, HTML/images, bidi/zero-width chars; 256 KB cap + truncation markers |
| DoS — DPoP/assertion replay                                      | DPoP proofs, `private_key_jwt`            | DB-backed `jti` replay store (single-node default); `oauth_client_assertion` single-use PK rows; `refreshTokenReuseInterval: 0`         |
| DoS — device-flow polling/brute user codes                       | `/device/code`, verification page         | Short `expiresIn` (15 min), polling `interval`, user code entropy via plugin; rate limiting on verification page **pending stage 6**    |
| Elevation — scope escalation past principal ceiling              | `actionsForScopes` + `can()`              | Ceiling checked before role; matrix rows cover read-only-can't-write, suspended owner, ceiling<role, role<ceiling                        |
| Elevation — R3 tools exposed to agents                           | Tool registry                             | `isAgentExecutable('R3') === false`; registry test asserts no R3 spec is registered; dispatcher refuses R3 before execution                 |
| Tampering — approval args tampered/replayed after parking        | `agent_approvals` + dispatcher             | Args validated + canonical-JSON SHA-256 hashed at park time; execute path re-verifies hash (tamper → refuse); pending→executing compare-and-set makes double-approve a no-op |
| Elevation — privilege persists after revocation                  | `resolveAgentActor`                       | Principal status, owner membership status, owner role, and token scopes are re-resolved on EVERY tool call and on approval execution — no cached authority |
| Info disclosure — rate/volume exfil via read tools               | `AgentRateLimiter` + read-volume cap      | Per-principal token bucket (60/min) + 4 concurrent + per-credential 5 MB/hr read cap → 429 `tool_rate_limited` + `Retry-After`             |
| Repudiation — agent write without audit trail                    | dispatcher + `agent_tool_calls`           | Every outcome (ok/denied/error/needs_confirmation/approval_required/rate_limited) writes a tool-call row; append-only (no UPDATE/DELETE grant); domain write + outbox + audit in one tx |
| DoS — idempotent replay creating duplicate writes                | REST `Idempotency-Key` + dispatcher       | Shared `idempotency_keys` table; same key+body replays the stored response, key+body mismatch → 422 `idempotency_conflict`               |

## Open risks accepted for M3 stage 1

1. **Consent page (`/oauth/consent`) is a stub redirect** until stage 6 builds the UI — the backend flow is live but the page is not; acceptable because no external clients are registered yet beyond seeded `huriro-cli`.
2. **Rate limiting for OAuth endpoints** uses the in-memory store (carried from M0/M1) until Valkey lands before multi-node.
3. **`enforcePerClientResources` blocks legacy clients** — intentional: all clients are seed- or CIMD-created in M3, so nothing pre-dates the flag.
4. **DPoP enforcement is opt-in per client** (`dpopBoundAccessTokens`); CLI device flow mints bearer tokens — acceptable for stage 1; revisit mandating DPoP for the REST surface in stage 4.

## Review outcome (stage 1)

Audience separation, CIMD SSRF boundary, credential exclusivity, and the
scope/ceiling/risk domain model are in place with integration + matrix tests.
Stage-owned mitigations for tool-surface rows are explicitly deferred.
Gate G3 assessment happens at stage 6.

## Stage-3 rows (MCP transport, `.md` reps, discovery)

| Threat | Surface | Mitigation in place / status |
| ------ | ------- | ---------------------------- |
| Consent phishing / scope escalation | consent decision route | Granted scopes enforced ⊆ requested; write scopes only behind explicit `allowWriteScopes`; client name always read from the registered/CIMD record, never client-supplied |
| `requestState` tampering / replay | MRTR retry | HMAC-SHA256 signed state binding {principalId, tool, argsHash, 10-min expiry}; signature+expiry+binding re-verified on every retry; re-supplied args re-hashed against the stored argsHash — mismatch refuses `confirmation_invalid` |
| Workspace confusion (user-level token, multi-workspace) | `/mcp` binding | Principal resolved via active memberships only; `X-Huriro-Workspace` must match an ACTIVE principal in that workspace; all work runs `withWorkspace` as owner; workspace `mcp_enabled:false` ⇒ 403 `agents_disabled` |
| Well-known mount confusion | `/.well-known/*` | Root `oauth-protected-resource` served by the provider; root `oauth-authorization-server` proxied to the auth base path so both RFC locations resolve; no `registration_endpoint` (DCR off); S256 only |
| Silently-executed write without elicitation | MCP `tools/call` | No-elicitation clients never execute R1 silently — promoted to the R2 approval path |

## Stage-4 rows (CLI credentials + workspace API keys)

| Threat | Surface | Mitigation in place / status |
| ------ | ------- | ---------------------------- |
| CLI token theft / at-rest exposure | `credentials.json` | Per-server store, POSIX 0600 + atomic tmp+rename writes; tokens never logged (`redactSecret`); refresh rotation persists the new refresh token before use |
| API-key brute force / prefix enumeration | `hrk_` bearer verify | SHA-256 hash compare is constant-time; keys verified only inside the `X-Workspace-Id` tenant tx so a key can never resolve cross-tenant; repeated failures throttled in-process per IP+prefix |
| Key leakage in logs/CI | logging | `hrk_<8>_<43>` pattern scrubbed by the pino formatter allowlist + dedicated unit test; management routes only ever return the prefix |
| Device-flow phishing | RFC 8628 flow | Device codes expire (15m) and poll honors `slow_down`/`expired_token`/`access_denied`; user_code confirmation UX is stage-6 owned |
| Bearer credential minting keys (R3) | `/api/v1/agents/api-keys*` | Session-only behind `workspaceDerive` + `agent.manage`; not a registry tool — an agent can never mint its own keys |
