# ADR-0025: Outbox Dead-Letter Policy & Operator Replay Surface

- **Status:** Accepted
- **Date:** 2026-11-24
- **Plan refs:** §5.5 (dead letters, no silent drops), §20.1 (`jobs.dead_letter_count`), §20.3 (admin console), §8 (outbox schema)

## Context

§5.5 specifies that dead letters are visible in an admin view with payload + error + replay, but does not specify when an event becomes a dead letter or where the operator surface lives. The gap became concrete in production: integration-test fixtures had written `files.uploaded.v1` rows into a shared development database whose blob bytes never existed, and the drain retried them on every tick, indefinitely (500+ attempts per row), because the outbox had no terminal state at all. A file-specific missing-blob terminal path fixed one consumer; every other permanently-failing event type (e.g. an undeliverable webhook payload) still retried forever, and retryable failures were re-attempted every 5 seconds regardless of cost.

Two open design points needed a decision:

1. **When does a failing event become a dead letter?** Error-type classification alone cannot cover every consumer (most throw generic transient-looking errors), and a permanent failure is often indistinguishable from a long transient one.
2. **Where do operators inspect and replay dead letters?** The §20.3 internal admin console is a future milestone; no instance-admin web surface exists today.

## Decision

1. **Capped exponential backoff + fixed attempt budget, then dead-letter.** Every consumer failure — regardless of type — increments `attempts`, records `last_error`/`last_attempt_at`, and schedules `next_attempt_at` with backoff `min(10s × 2^(n-1), 1h)` ±20% jitter. At 25 attempts (≈17 hours of tolerance) the row is dead-lettered: `dead_lettered_at` set, out of the drain's pending scan (enforced in SQL and in the recreated `idx_outbox_pending` partial index), but never deleted — payload + error stay in `outbox` for inspection. Transient outages (deploys, ClamAV restarts, webhook endpoint flaps) recover inside the budget; genuinely poisoned events stop consuming worker time. Consumer-specific terminal shortcuts (e.g. the file pipeline's missing-quarantine-object path) remain valid optimizations — they publish successfully instead of burning the budget — but no consumer is *required* to classify its errors.
2. **The `huriro` CLI is the operator surface** — `huriro dead-letters` (list), `huriro dead-letters show <id>` (full payload + error), `huriro dead-letters replay <id> | --all` (re-arm). This matches how self-host operators already interact with the instance (`migrate`, `backup`, `restore`, `create-admin`). The future §20.3 web admin console can build on the same row state; nothing in this decision blocks it.
3. **Replay semantics: fresh budget, no side effects.** Replay clears `dead_lettered_at`/`last_error`/`next_attempt_at` and resets `attempts` to 0, making the row due immediately. It never touches `published_at` or `processed_events` — failed events never committed either, so idempotency is preserved by construction. Replaying a healthy or unknown row is a no-op.
4. **Metrics split:** dead letters are excluded from `huriro_outbox_pending` (they are terminal, not lag — otherwise the lag alert pins forever) and exposed as `huriro_outbox_dead_letters` (gauge) plus `huriro_outbox_dead_letters_total` (counter, labelled by event type).

## Consequences

- No event retries forever; no event is silently dropped. Both properties are enforced in one place — the drain's catch path — so consumers cannot opt out by accident.
- Dead-letter bookkeeping (`attempts`, `dead_lettered_at`, …) is written in autocommit *after* the consumer transaction has rolled back, so the terminal state itself can never be rolled back by the failure that caused it.
- Rows written before migration 0019 have `next_attempt_at NULL` — they are due immediately and simply resume their existing attempt budget.
- Operator runbook for a dead-letter spike: `huriro dead-letters` → `show` the payload/error → fix the root cause → `replay`. The attempt budget means a premature replay costs nothing — the row just dead-letters again if the cause persists.
