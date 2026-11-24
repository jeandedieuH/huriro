# Huriro Security Architecture Whitepaper

Huriro is designed for multi-tenant isolation, least-privilege execution, and auditable AI and human collaboration across self-hosted and cloud deployments.

## 1. Tenant Isolation & Database Security

- **PostgreSQL 18 `FORCE ROW LEVEL SECURITY`**: Every tenant-scoped table carries `workspace_id`, composite foreign keys targeting `(workspace_id, id)`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, and strict policies scoped to `current_setting('app.workspace_id', true)::uuid`.
- **Privilege Separation**: Application traffic executes under `huriro_app` (`NOBYPASSRLS`) exclusively inside `withWorkspace()` or explicitly scoped `withSystem()` blocks. DDL migrations and operator tools run separately under the schema owner role.
- **Automated RLS Verification**: `packages/test-utils/src/rls.ts` classifies every database table and verifies two-tenant isolation and deny paths on every CI run.

## 2. Authentication, Sessions, & CSRF

- **Auth Substrate**: Better Auth manages email/password, OAuth providers, WebAuthn/Passkeys, TOTP/MFA, and OAuth 2.1 consent flows in the isolated `auth` PostgreSQL schema.
- **CSRF Protection**: State-changing browser requests carrying session cookies require matching `Origin` (`HURIRO_URL`), clean `Sec-Fetch-Site` headers, and a custom `X-Huriro-Client` header (`api/context.ts`).
- **Rate Limiting & Maintenance Safety**: Per-caller token/bucket limiting returns RFC 9457 `problem+json` `429` responses with `Retry-After`. Emergency `HURIRO_READ_ONLY=true` pauses mutations globally with `503 read_only_mode`.

## 3. Cryptography & Secrets Management

- **No Secrets in Code or Bundles**: Server configuration rejects plaintext secrets in version control and resolves credentials via `*_FILE` paths (`secrets/` in Compose).
- **Envelope Encryption**: Sensitive workspace credentials (AI provider keys, webhook signing secrets, OAuth mail tokens) are encrypted with AES-256-GCM under the instance envelope root key (`api/crypto.ts`).
- **Pino Secret Scrubbing**: Structured JSON logs strip authorization headers, cookies, password/secret keys, and `hrk_...` credential patterns before writing to stdout.

## 4. Network Egress, Attachments, & AI Agents

- **SSRF Defense (`api/egress.ts`)**: Outbound URLs (webhooks, link previews, push endpoints, FX/payment gateways) resolve DNS first, block loopback/private/link-local/CGNAT/ULA ranges, disable implicit redirects, and enforce byte and timeout caps.
- **Attachment Quarantine**: Uploads land in quarantine, pass magic-byte + SVG script sanitization + optional ClamAV `INSTREAM` scanning and EXIF stripping, and download with `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`.
- **Agent & MCP Least Privilege**: Agents authenticate via scoped `hrk_...` keys or audience-bound OAuth 2.1 tokens; R2 mutations pause in an explicit human approval queue before execution.
