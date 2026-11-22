# M0 threat-model review (§13 exit gate)

Scope: the M0 spine — Better Auth identity, tenancy/RLS, invitations, audit/
outbox/idempotency, self-host compose stack, secrets handling. Reviewed against
STRIDE per trust boundary. Findings at the end.

## Boundaries & assets

| Boundary                    | Crosses                                             | Assets                                |
| --------------------------- | --------------------------------------------------- | ------------------------------------- |
| Internet → Caddy → app      | TLS termination, HTTP                               | sessions, credentials, workspace data |
| app → postgres (`data` net) | `huriro_app` / `huriro_auth` / `huriro_maint` roles | all tables, RLS context               |
| app → secrets               | `/run/secrets/*`                                    | DB passwords, secret key, setup token |
| user → invitation token     | email + link                                        | membership grants                     |

## STRIDE findings & mitigations

| Threat                             | Surface                          | Mitigation in place                                                                                             |
| ---------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Spoofing — session                 | cookie theft                     | httpOnly+Secure+SameSite=Lax session cookies (Better Auth), 7-day expiry w/ daily rotation                      |
| Spoofing — credentials             | password/passkey/TOTP            | passkeys (phishing-resistant), argon2 password hashing (Better Auth), TOTP plugin                               |
| Spoofing — RLS context             | attacker sets `app.workspace_id` | GUCs set only inside `withWorkspace` tx by app code; `huriro_app` has no `SET` path via SQL from client         |
| Tampering — cross-tenant reads     | direct SQL via app bug           | ENABLE+FORCE RLS on every tenant table; composite tenant FKs; real pg18 tests prove isolation incl. fail-closed |
| Tampering — auth data via app role | `huriro_app` reading `auth.*`    | no grants on `auth` schema to `huriro_app`; `huriro_auth` has no grants on tenant tables (structural isolation) |
| Tampering — outbox/audit           | event forgery                    | written only inside service txs; `huriro_app` INSERT-only, no UPDATE/DELETE on audit                            |
| Repudiation                        | "who did this"                   | `audit` rows on every mutation path (setup, invite, membership), actor + IP                                     |
| Info disclosure — errors           | stack/SQL leaks                  | problem+json mapper strips internals; no error bodies from auth to Huriro routes                                |
| Info disclosure — secrets          | env dumps, logs, images          | `*_FILE` pattern only; `no-secrets` review rule; `.env` gitignored; image `read_only`                           |
| Info disclosure — enum via timing  | invitation accept                | uniform problem+json; token compare via hash equality over SHA-256 digests                                      |
| DoS — auth endpoints               | brute force                      | Better Auth rate-limit (memory store M0 — single-replica only; shared store before horizontal scale, ADR-0003)  |
| DoS — large payloads               | body size                        | Elysia body limit; reverse-proxy limits in Caddyfile                                                            |
| Elevation — setup token            | first-admin bootstrap            | token stored as hash, one-time use, setup route locks after first workspace                                     |
| Elevation — invitation             | privilege escalation             | invite is role-scoped at creation (owner/admin only can create); accept binds email to authenticated account    |
| Elevation — membership forgery     | direct insert                    | composite PK + RLS; inserts flow through service inside tenant tx                                               |

## Open risks accepted for M0

1. **Memory rate-limit store** — resets on restart, per-replica only. Mitigate
   before cloud scale: shared store (Valkey) or Better Auth DB store + table.
2. **pgBackRest not yet configured** — WAL archiving waits on object storage
   (M3). Interim: nightly `pg_dump` per runbook; RPO 24h.
3. **Invitation token in URL** — single-use + 7-day TTL + hash storage bounds
   exposure; email-verification requirement on accept is enforced by invite
   binding to `app.user_email`.
4. **No CSP/security headers yet** — lands with the first real web surface (M1);
   Caddyfile is the place, tracked in docs/plan §19.

## Review outcome

Spine holds: two-tenant isolation proven on real pg18, auth schema sealed,
secrets file-mounted, problem+json everywhere. The four open risks are
documented with owners + milestones. M0 security exit gate: **pass**.
