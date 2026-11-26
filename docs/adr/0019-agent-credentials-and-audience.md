# ADR-0019: Agent credentials — dual-audience OAuth, CIMD, no DCR

- **Status:** Accepted (M3, stage 1)
- **Date:** 2026-11-23
- **Plan refs:** §13.1, §13.3, §13.6; extends ADR-0003

## Context

M3 makes agents first-class principals. They authenticate with OAuth access
tokens (never user sessions) on two separate surfaces: the MCP endpoint and a
REST agent surface for CLI/API callers. The design requires:

- Tokens bound to **distinct RFC 8707 resource audiences** so a credential
  minted for one surface is rejected by the other — no token passthrough.
- Client registration that MCP clients can use **without** open dynamic
  client registration (which is a phishing/ abuse surface).
- A first-party public client for the `huriro` CLI using the device grant.
- Sender-constraint-ready verification (DPoP) with replay protection.

## Decision

**One authorization server, two protected resources** on the Better Auth
OAuth provider (`mcp()` plugin — which _is_ the oauth provider configured for
MCP; a second `oauthProvider()` cannot coexist):

| Audience                     | Surface                | Minted for                          |
| ---------------------------- | ---------------------- | ----------------------------------- |
| `${HURIRO_URL}/mcp`          | `/mcp` (stage 3)       | MCP clients (CIMD-registered)       |
| `${HURIRO_URL}/api/v1/agent` | `/api/v1/agent/*` (s2) | `huriro` CLI + admin-linked clients |

- `mcp({ resource, resources: [{identifier: agent-rest}] , scopes, refreshTokenReuseInterval: 0, allowDynamicClientRegistration: false, enforcePerClientResources: true })`.
  `enforcePerClientResources` makes `oauth_client_resource` rows authoritative —
  a client can only mint for resources it is explicitly linked to.
  `clientRegistrationDefaultResources: [mcp]` links CIMD clients to `/mcp` only.
- **CIMD, not DCR.** Third-party MCP clients register via Client ID Metadata
  Documents (`cimd()`, `metadataProfile: 'mcp-2026-07-28'`). Dynamic client
  registration stays off. The metadata fetch goes through our SSRF egress
  (`api/egress.ts` → `modules/identity/cimd-transport.ts`): DNS resolved once,
  private/RFC 6890 ranges rejected, address pinned, **redirects refused**, body
  capped at 64 KiB.
- **`huriro-cli`** is a pre-registered public client
  (`tokenEndpointAuthMethod: 'none'`, device grant + refresh only, `skipConsent:
  false`, linked only to the REST audience) seeded idempotently at boot by
  `ensureAgentOAuthSeed`. No consent is skipped beyond what the resource allows.
- **Refresh-token replay:** `refreshTokenReuseInterval: 0` — strict rotation;
  a reused refresh token revokes the family (the MCP preset's 30 s overlap
  default is explicitly disabled).
- **DPoP replay store:** `verifyAgentBearer` runs `requireMcpAuth`'s verifier
  with `resource` swapped per audience; its DPoP proof `jti` replay store is
  backed by the auth DB adapter — correct for the single-node self-host default
  and shared across processes if multi-node lands later.
- **Verification:** `verifyAgentBearer(auth, request, {audience})` →
  `{userId, clientId, scopes, tokenId, audience}`; issuer/audience/expiry/`azp`
  checked, signature against the in-process JWKS. Wrong audience, expired,
  wrong-issuer, and opaque tokens → 401 problem+json + RFC 6750/9728
  `WWW-Authenticate` challenge (carried on `HttpError.headers`).
- `jwt({ disableSettingJwtHeader: true })` + `disabledPaths: ['/token']`:
  session JWT minting stays off — sessions remain cookie-only credentials and
  `/api/v1/*` session routes keep rejecting bearer agent tokens (and vice
  versa; both-present requests still 400 `credential_type_mismatch`).
- New auth-schema tables (`auth.oauth_*`, `auth.jwks`, `auth.device_code`,
  migration 0012) follow the 0005 pattern: `huriro_auth`-only grants, outside
  the tenant-RLS perimeter — OAuth clients predate workspace context.

## Consequences

- `agent_scope` enforcement composes: token scopes (`scope` claim) ∩
  `agent_principals.scope_ceiling` ∩ owner role — `actionsForScopes` +
  `can()`/ `agentScopeCeiling` (packages/domain `agent-scopes.ts`).
- Consent screen UI (`/oauth/consent`), the `/mcp` endpoint, and per-tool
  scope enforcement land in stages 3/6 — this ADR records the credential
  plumbing only.
- Token TTLs use provider defaults (access 3600 s, refresh 30 d, device code
  15 min) — revisit under §13.6 load testing in stage 6.
