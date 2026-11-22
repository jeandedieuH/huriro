# 21. Testing Strategy & Quality Gates

## 21.1 The pyramid, adapted to this product

| Layer                       | Tooling                            | What it must cover                                                                                          |
| :-------------------------- | :--------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| **Unit (fast, many)**       | `bun test` / Vitest                | Pure domain logic: policy decisions, fractional indexing, threading, cursor math, sanitizers, token parsing |
| **Integration (real deps)** | Testcontainers Postgres            | Every repository query, every RLS policy, every migration, transaction boundaries, outbox emission          |
| **Contract**                | Generated OpenAPI snapshot         | Request/response shapes, error codes, MCP tool schemas                                                      |
| **E2E (few, critical)**     | Playwright (web), Maestro (mobile) | Auth, create/edit issue, board drag via keyboard, doc co-editing, chat send, inbox reply, palette search    |
| **Non-functional**          | k6, axe, Playwright screenshots    | Load, a11y, visual regression                                                                               |

## 21.2 The tests that must exist before a feature ships

1. **Authorization matrix** — for each new action: allowed for each role, denied for each role that shouldn't have it, denied for a user in another workspace (BOLA).
2. **RLS isolation** — two-tenant fixture: tenant A cannot read/write tenant B's rows, run as the **non-owner** app role.
3. **Idempotency** — the same `Idempotency-Key` twice produces one row.
4. **Optimistic concurrency** — stale `version` returns `409` and does not write.
5. **Sync correctness** — a scripted concurrent-write scenario asserts gap-free cursor delivery (the regression test for §9.2).
6. **A11y** — axe zero violations on new components; keyboard path for any drag/gesture interaction.
7. **Sanitization** — XSS payload corpus for docs, chat, and mail bodies.
8. **Sync grants/revokes** — a user added to a private project receives its existing entities; a user removed (or an entity moved to a private scope) stops receiving them and gets a purge.
9. **Agent safety** — for each new tool: scope denial, agent scope-ceiling denial, correct risk tier (R2 cannot complete without an out-of-band approval), attribution in activity, and a prompt-injection fixture that tries to make it act.
10. **i18n** — no hardcoded strings; the pseudo-locale renders without truncation in the new UI.

## 21.3 Test data and environments

- **Factories** in `packages/test-utils` (typed builders: `aWorkspace()`, `anIssue()`, `aMailConversation()`), seeded with deterministic randomness (seed in output on failure).
- Each integration test runs in a transaction that is rolled back, or against a **per-worker schema** — never shared global state.
- E2E runs against a disposable stack with a seeded demo workspace and a fixed clock where time matters.
- **Flake policy:** a test that fails intermittently is quarantined within 24 h, fixed or deleted within a week; no "retry until green" in CI.

## 21.4 Coverage and mutation testing

- Coverage **gates on changed lines**, not global percentage (meaningless global numbers invite gaming): ≥ 80% on `packages/domain/**` and `apps/server/src/modules/**/service.ts`.
- Mutation testing on `packages/domain` (Stryker) quarterly — it is the only way to know policy tests actually assert.
- Load tests (k6) with committed scenarios: 200 concurrent users doing mixed reads/writes, a 500-message burst in one channel, and a 50-user co-editing session. SLO thresholds in the script.

## 21.5 Security testing

- Auth E2E suite (see §12.2 library risk): login, 2FA, passkey, OAuth PKCE exchange, refresh rotation, revocation, session fixation attempts.
- Negative tests for every endpoint: unauthorized principal type, expired token, wrong workspace, missing CSRF header.
- External penetration test before GA (G6 gate); annual afterward for the cloud offering. Internal security review (§21.1, §22) at every milestone gate.
- Dependency and container scanning in CI; a documented triage SLA (critical ≤ 72 h).

## 21.6 CI gate summary (merge is blocked unless green)

```text
typecheck · lint · unit · integration · contract · migration-lint
· gitleaks · SCA · SAST · image CVE scan · axe · visual regression
· bundle-size budget · license allowlist · module-boundary lint · generated-code drift · i18n extraction
· self-host smoke (fresh `compose up` + upgrade from every supported release + footprint < 1 GB idle)
```

**Bundle budgets:** initial JS ≤ 200 KB gzip for the shell; editor chunk lazy-loaded; a route exceeding budget fails CI with the diff.
