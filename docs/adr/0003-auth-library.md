# ADR-0003: Auth library — Better Auth for identity only

- **Status:** Accepted (M0), with a documented risk posture and exit plan
- **Date:** 2026-11-22
- **Plan refs:** §1.2, §8.3, §12.2; risk R1

## Context

Huriro needs sessions, passkeys, TOTP, OAuth 2.1 (for MCP + native clients), device
authorization (CLI), API keys, and SSO-ready identity. Hand-rolling all of that is
months of security-critical work.

## Decision

Adopt **Better Auth** (exact pins, whole `@better-auth/*` family upgraded together) for
**identity only**: users, sessions, passkeys, 2FA, OAuth provider, API keys, device flow.

- Better Auth owns sessions, credential accounts, verifications, passkeys, and TOTP
  secrets in a dedicated `auth` PG schema (0005_auth.sql). `public.users` remains the
  ONE user table — better-auth maps onto it via field mapping
  (name→display_name, image→avatar_url, emailVerified→email_verified,
  twoFactorEnabled→mfa_enabled), so tenancy joins never touch a shadow table.
- Auth queries run on a dedicated `huriro_auth` DB role (`DATABASE_AUTH_URL`,
  falling back to `DATABASE_URL` in dev): session lookups precede any tenant
  context, so it alone gets context-free `users` reads via a `huriro_auth`-scoped
  policy — and holds ZERO grants on tenant tables in return.
- **The organization plugin is not used.** Tenancy (workspaces, memberships, roles,
  ACLs) is Huriro's own schema — RLS, the change feed, and custom roles depend on it
  staying under our control. Invitations are Huriro-owned rows (sha256 token hash,
  7-day TTL) accepted through an RLS email-escape policy.
- Login rate limiting uses the **memory** store for M0 (single-node self-host is
  the shipping target; the database store needs a table we deferred — multi-replica
  cloud switches before horizontal scale ships).
- A short (5 min) JWS cookie cache fronts session lookup; the DB remains the source
  of truth so revocation propagates within the cache window.
- Never enable the OAuth provider and a browser-session JWT signer on the same key.

## Risk posture (mandatory mitigations, from §12.2/R1)

Better Auth has shipped repeated security advisories. Therefore:

1. Exact version pins; the family upgrades as a unit on the 2-week cadence.
2. Advisory subscription; **critical advisory → patch within 24 h or disable the plugin**.
3. Auth E2E suite in CI: login, 2FA, passkey, OAuth PKCE exchange, refresh rotation,
   revocation, session-fixation attempts.
4. SSRF-safe fetch transport injected for CIMD client metadata fetches (§13.2).

## Exit plan

Better Auth is in-process and schema-coupled. Exit path if it becomes untenable:
all identity access goes through `apps/server/src/modules/identity` service functions —
no route touches auth tables directly — so a replacement (Lucia-style hand-rolled
sessions, or a different library) swaps in behind that seam. Auth E2E suite is the
contract the replacement must satisfy.

## Alternatives considered

- **Hand-rolled sessions** — rejected: passkeys/TOTP/OAuth-provider correctness is a
  security minefield and not a differentiator (§4.1 #12).
- **External IdP (Keycloak/Logto)** — rejected for v1: extra infra every self-hoster
  must run; revisit if enterprise SSO demand dominates.
