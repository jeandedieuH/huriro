# 12. Security & Multi-Tenancy

## 12.1 Threat model summary (STRIDE, per surface)

| Surface       | Primary threats                                                         | Controls                                                                                                              |
| :------------ | :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| Web app       | XSS (docs/mail/chat content), CSRF, clickjacking, session theft         | Strict CSP + Trusted Types, sanitized rendering, SameSite cookies, frame-ancestors, short session TTL + rotation      |
| API           | IDOR, broken object-level auth, mass assignment, replay                 | Policy layer + RLS, explicit DTOs (no raw body → DB), Idempotency-Key, schema validation                              |
| WebSocket     | Cross-site hijacking, unauthorized subscriptions                        | Cookie + Origin allowlist (web) or single-use ticket (native), per-subscription authz, forced close on revocation     |
| Collab server | Unauthorized doc access, memory exhaustion                              | DB-checked tickets, size limits, rate limits, room leases                                                             |
| Files         | Malware, stored XSS via SVG/HTML, SSRF via fetch                        | Quarantine + AV, separate origin, `Content-Disposition`, content sniffing, no server-side URL fetch without allowlist |
| Mail          | XSS in HTML mail, phishing links, prompt injection, spoofing            | Sandboxed rendering, link proxying, SPF/DKIM/DMARC display, untrusted-content envelope for AI                         |
| MCP/agents    | Confused deputy, token passthrough, over-broad scopes, prompt injection | Audience-bound tokens, per-tool scopes, confirmation for writes, audit                                                |
| Infra         | Panel compromise, Docker socket escape, secret leakage                  | Panel not publicly exposed, hardened containers, secret store, least-privilege                                        |
| Supply chain  | Malicious dependency, compromised CI action                             | Pinned digests/SHAs, cooldown, SBOM, signing, provenance                                                              |

## 12.2 Authentication

| Client                                  | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| :-------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web                                     | Better Auth session cookie (`__Secure-` prefixed, since a true `__Host-` name is not achievable with the library's cookie builder): `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`. Idle/absolute expiry configured explicitly; **cookie caching disabled for sensitive operations** so revocation is immediate. CSRF defended by `Origin`/`Fetch-Metadata` validation **plus** a required custom header on every state-changing request. |
| Native (mobile/desktop)                 | OAuth 2.1 + PKCE via the system browser (`expo-web-browser`/AuthSession on mobile; deep-link callback in the desktop shell), then **short-lived access token (15 min) in memory** + **rotating refresh token in secure storage** (`expo-secure-store` / OS keychain), bound to a device id. Never `localStorage`.                                                                                                                         |
| CLI                                     | **OAuth device authorization** (RFC 8628) through the same authorization server — `huriro login` shows a code, the user approves in the browser, the CLI stores a refresh token in the OS keychain. No copy-pasted long-lived keys needed for interactive use.                                                                                                                                                                            |
| API keys (CI, scripts, headless agents) | Scoped keys (`hur_…` prefix, ≥ 256 bits of randomness), stored as **SHA-256** (keyed with a server pepper) — keys are high-entropy, so a slow password hash only adds latency to every request. Shown once, optional expiry, last-used metadata, instant revoke, bound to a user _or_ an agent principal.                                                                                                                                 |
| Agents                                  | OAuth 2.1 authorization server (§13.2) with audience-bound tokens, issued to a dedicated MCP resource and mapped to an `agent_principals` row.                                                                                                                                                                                                                                                                                            |
| Self-host SSO                           | OIDC/SAML per workspace via the auth provider's SSO plugin; SCIM for provisioning. **Not paywalled** (§2.5).                                                                                                                                                                                                                                                                                                                              |
| Instance bootstrap                      | First-run setup wizard creates the instance owner; it is reachable only until an owner exists **and** only with the one-time setup token printed in the server log, so a freshly exposed instance can't be claimed by a stranger.                                                                                                                                                                                                         |

**One session model, several transports.** Every route declares which principal types it accepts (`cookie`, `bearer`, `api_key`, `agent_token`). A request that presents **more than one** credential type is rejected with `400`, and cookie-authenticated requests never reach routes that act on bearer semantics — mixing them widens both CSRF and confused-deputy surfaces.

> **Auth library risk (ADR-0003).** The chosen library has shipped frequent security advisories (several critical, including OAuth state and desktop sign-in issues). Mitigations are mandatory: pin exact versions, upgrade the whole `@better-auth/*` family together, subscribe to its advisories, run **auth end-to-end tests in CI** (login, 2FA, passkey, OAuth code exchange, token refresh, revocation), and keep an exit plan because it is in-process and schema-coupled. Never enable the OAuth provider and a browser-session JWT signer on the same signing key.

**Always:** passkeys (WebAuthn) as the preferred factor; TOTP fallback; recovery codes generated once; step-up authentication for sensitive actions (delete workspace, rotate keys, export data, change email). Login rate limiting uses the **database** store (the library's in-memory default is unacceptable in multi-node deployments) and is configured with explicit trusted proxies so `X-Forwarded-For` cannot be spoofed.

**Anti-enumeration:** login and password-reset respond identically for unknown and known emails; rate limits per IP _and_ per account.

## 12.3 Authorization model

Three layers that must agree, in this order:

```text
1. Role permissions (workspace-wide)      roles → permissions (data, not code)
2. Resource ACLs (object-level)           private channel/doc/project, guest scoping, per-user share
3. Row-Level Security (data layer)        final backstop; every tenant query is scoped by the DB
```

**Policy interface** (`packages/domain/policy.ts`):

```ts
type Action =
	| 'issue.read'
	| 'issue.write'
	| 'issue.delete'
	| 'doc.read'
	| 'doc.write'
	| 'doc.share'
	| 'channel.read'
	| 'channel.post'
	| 'channel.manage'
	| 'mail.read'
	| 'mail.assign'
	| 'mail.send'
	| 'member.invite'
	| 'member.manage'
	| 'workspace.billing'

type Decision =
	| { effect: 'allow'; via: 'role' | 'acl' | 'owner' }
	| { effect: 'deny'; reason: 'not_member' | 'insufficient_role' | 'no_acl' | 'suspended' }

declare function can(actor: ActorContext, action: Action, resource: ResourceRef): Decision
```

- **Deny by default.** No implicit grants.
- **Guest role** can see only explicitly shared resources (enforced in the same policy function).
- **Admins bypass ACLs but are still audited.** The bypass is an explicit code path with a logged reason, not an accident of role ranking.
- The policy is **pure and table-tested**: a matrix test of ~40 roles × resources × actions runs on every PR.

## 12.4 Row-Level Security implementation

```sql
-- Role separation (this is the part people get wrong):
--   huriro_owner   owns the schema; used ONLY by migrations.
--   huriro_app     NOBYPASSRLS, not an owner; used by the API. Never grant it ownership.
--   huriro_app is ALSO used by workers: every tenant job runs inside withWorkspace(job.workspace_id),
--                  so a buggy consumer is as isolated as a buggy route.
--   huriro_maint   BYPASSRLS, used only by a short list of audited maintenance jobs (retention,
--                  change_log pruning, cross-tenant metrics) in their own process with no ingress.
CREATE ROLE huriro_app NOINHERIT NOBYPASSRLS LOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO huriro_app;

ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues FORCE ROW LEVEL SECURITY;   -- without FORCE, the owner bypasses RLS silently

CREATE POLICY issues_tenant_isolation ON issues
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
```

**Per transaction — use `set_config(..., true)`, not `SET LOCAL`:**

```sql
BEGIN;
SELECT set_config('app.workspace_id', $1, true),   -- `true` = transaction-local, parameterizable
       set_config('app.user_id',      $2, true);
-- ... queries ...
COMMIT;
```

Rules and gotchas:

- **Transaction-local only.** `SET LOCAL` cannot take bind parameters; `set_config(name, value, true)` can. Session-scoped settings (`SET`, or `set_config(..., false)`) **leak across tenants** when a pooled connection is reused — this is the single most dangerous mistake possible in this design.
- **`FORCE ROW LEVEL SECURITY` is mandatory.** A table owner silently bypasses RLS, so the API must never run as the role that owns the tables. Superusers and `BYPASSRLS` roles bypass RLS unconditionally.
- The `app.*` settings are set by a **single wrapper** (`withWorkspace(tx, ctx, fn)`); there is no way to obtain a tenant transaction without them. Lint the codebase for raw `db.` usage outside the wrapper.
- `current_setting(..., true)` returns `NULL` when unset → the comparison yields `NULL` → **no rows**. Fails closed. A table with no policy is also default-deny — good, but it means a forgotten policy breaks a feature loudly, which is the failure mode we want.
- **Composite foreign keys** `(workspace_id, id)` across related tables make cross-tenant references impossible at the database level, not just unlikely:

  ```sql
  ALTER TABLE issues ADD CONSTRAINT fk_issues_project
    FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id);
  ```
- **Auth tables live in their own schema** with a narrow role: the auth library must query memberships _before_ a tenant context exists. Keep that surface small and separate from domain tables.
- **Pooling:** PgBouncer transaction mode is compatible with transaction-local settings because the server connection is pinned for the whole transaction. `LISTEN/NOTIFY` and session-level advisory locks are **not** supported in that mode — they use a dedicated direct/session connection.
- **Residual risks to test for:** FK and unique-constraint checks bypass RLS (a covert channel for existence probing — avoid exposing unique-violation details across tenants); policy sub-selects can race under `READ COMMITTED`; and `SECURITY DEFINER` helpers must pin `search_path`.
- A CI test asserts, for **every** tenant table, that a query with no workspace context returns zero rows and that a two-tenant fixture cannot see across the boundary (run as `huriro_app`, never as the owner).

## 12.5 Resource ACL evaluation at scale

For v1, ACL checks are SQL lookups against `acl_entries` (indexed by resource), resolved inside the policy function and mirrored into RLS for list endpoints via a `SECURITY DEFINER` helper (`can_read(resource_type, resource_id, user_id)`).

**When to graduate to a relationship graph (OpenFGA/SpiceDB):** when authorization rules become compositional (inheritance across nested docs/channels, sharing at folder level, cross-workspace guests). The policy interface above is deliberately the seam: swapping the implementation must not change call sites.

## 12.6 Application security controls

**Transport & headers**

- HSTS (2 years, preload), TLS 1.2+ only, OCSP stapling at the edge.
- CSP: nonce-based `script-src`, `strict-dynamic`, no `unsafe-inline`; `object-src 'none'`; `frame-ancestors 'none'` (except the collab/embed surfaces); `base-uri 'none'`; `form-action 'self'`.
- Trusted Types on the web app; any `innerHTML` is banned by lint.
- `Permissions-Policy` denies camera/mic/geolocation unless a feature needs them.
- Cross-origin isolation only where needed (not globally — it breaks third-party embeds).

**CSRF & origins**

- **Route the API on the same registrable domain as the web app** (`https://app.<domain>/api/*`, `/ws`, `/mcp` proxied at the edge) rather than a cross-site subdomain. This avoids third-party-cookie blocking (Safari ITP and friends), keeps cookies first-party, and simplifies CSP and CORS.
- Cookie auth is `SameSite=Lax` **plus** an `Origin`/`Fetch-Metadata` check **plus** a required custom header (`X-Huriro-Client`) on every state-changing request. SameSite is defense in depth, never the only control.
- If a separate API origin is ever required (e.g. for a partner integration), CORS uses an exact origin allowlist with credentials, never `*`.
- **Never host user-uploaded content on a sibling subdomain of the app** — a compromised file origin would share the registrable domain. User content lives on a dedicated cookieless origin with its own CSP.

**SSRF**

- Link unfurling and webhook delivery go through an egress proxy that: resolves DNS once, blocks private/link-local/loopback/metadata ranges (including IPv6 equivalents), rejects non-http(s), follows at most 3 redirects with the same validation, caps response size and time, and strips credentials.
- Provider webhooks (GitHub, mail) are verified by signature, not by source IP.

**Uploads**

- Size/type limits per purpose; MIME determined by content sniffing (magic bytes), not the client header.
- Images re-encoded server-side (strips EXIF, kills polyglot payloads); SVG sanitized or rendered to raster; HTML never served inline.
- ClamAV scan in quarantine when the `clamav` profile is enabled; `scan_status` gates download. Without it, files are marked `unscanned`, are always served as attachments (never previewed inline except re-encoded images), and the admin health page recommends enabling scanning.
- Object keys are opaque (`ws/<id>/<uuid>`), never user-supplied paths.
- Separate origin/CDN with `Content-Security-Policy: sandbox` and `Content-Disposition: attachment` for all user content.

**Injection**

- Parameterized SQL only; the ORM's template tag is the single allowed path.
- HTML sanitization allowlist for all rendered user content (docs, comments, mail bodies) with a maintained library and a fuzz corpus.
- Markdown rendered through a hardened pipeline (no raw HTML by default; opt-in per workspace).
- No `eval`, no `new Function`, no dynamic `require` from user input.

## 12.7 Secrets and cryptography

| Secret                                | Storage                                | Notes                                                                                                         |
| :------------------------------------ | :------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| DB/Redis/S3 credentials               | Platform secret store / Docker secrets | Rotated quarterly; file-based injection preferred                                                             |
| Session signing keys                  | Env/KMS                                | Rotation with overlap (old key verifies, new key signs)                                                       |
| OAuth client secrets (mail providers) | Env                                    | Never in DB                                                                                                   |
| Third-party user tokens (Gmail/Graph) | **Encrypted at rest** in DB            | Envelope encryption: per-workspace DEK wrapped by a KMS KEK; AES-256-GCM with AAD = `workspace_id:account_id` |
| API keys                              | Argon2id hash + prefix lookup          | Never recoverable                                                                                             |
| Backups                               | Encrypted (pgBackRest/AES-256)         | Keys held separately from the backup bucket                                                                   |
| AI provider keys                      | Env/secret store                       | Per-workspace BYO-key option, encrypted like mail tokens                                                      |

**Crypto rules:** never invent primitives; use libsodium/WebCrypto/Node `crypto` with AES-GCM or XChaCha20-Poly1305; random IVs; authenticated associated data tying ciphertext to its tenant and purpose; key rotation is a documented runbook with a re-encrypt job.

## 12.8 Audit logging

Emitted for: authentication events, membership/role changes, permission grants/revocations, API key lifecycle, data export/deletion, mail account connect/disconnect, MCP token issuance/use of write tools, admin impersonation (if ever added), and all bulk/batch operations. Each entry includes actor (human/agent/key), target, IP hash, user agent, and a correlation id — immutable (append-only table, no UPDATE grant for the app role beyond nothing).

## 12.9 Rate limiting and abuse

| Scope                                      | Default                                       | Mechanism                      |
| :----------------------------------------- | :-------------------------------------------- | :----------------------------- |
| Anonymous endpoints (login, signup, reset) | 10/min per IP + per account                   | Token bucket in Postgres/Redis |
| Authenticated API                          | 600 req/min per user, 3,000/min per workspace | Sliding window                 |
| Expensive endpoints (search, export, AI)   | Per-workspace quota + concurrency cap         | Semaphore + quota              |
| WebSocket messages                         | 60/min per socket                             | Token bucket, close on abuse   |
| Mail send                                  | Provider limits + per-workspace cap           | Queue with backpressure        |
| MCP tool calls                             | Per-token, per-tool quotas                    | Gateway-enforced               |

Limits return `429` with `Retry-After` and `RateLimit-*` headers. Every limiter has a bypass for signed internal calls and a kill switch.

## 12.10 Container and host hardening

- Non-root UID, read-only root filesystem, `no-new-privileges`, dropped capabilities, tmpfs for `/tmp`.
- Distroless or minimal runtime images, pinned **by digest**.
- No Docker socket mount in application containers.
- Separate networks: `edge` (Traefik), `app` (API/worker/realtime), `data` (Postgres/Redis), `mail`.
- Postgres is **not** reachable from `edge`.
- Mail ports (25/465/587/993) are published only if the embedded mail module is enabled, and only on the mail host with explicit egress/ingress rules.
