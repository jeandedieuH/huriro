# 20. Observability & Reliability

## 20.1 Signals

| Signal      | Implementation                                                                                                                                                                                                                                                                            |
| :---------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Logs**    | Structured JSON (`pino`), one line per request/job, with `requestId`, `workspaceId`, `actorId` (hashed where sensitive), `route`, `status`, `durationMs`, `errorCode`. Log level per environment; sampling for high-volume paths.                                                         |
| **Traces**  | OpenTelemetry SDK → Collector → backend. Manual span instrumentation is mandatory on Bun (auto-instrumentation does not cover `Bun.serve`/`fetch` reliably). Span attributes: `workspace.id`, `db.statement.name`, `cache.hit`, `queue.name`, `job.attempt`.                              |
| **Metrics** | RED for HTTP (rate/errors/duration), USE for resources, plus domain metrics: `sync.cursor_lag_seconds`, `sync.delta_rows_returned`, `jobs.lag_seconds`, `jobs.dead_letter_count`, `mail.sync_failures`, `ai.tokens_used`, `ws.connections`, `doc.rooms_active`, `change_log.pruned_upto`. |
| **Errors**  | Sentry-compatible backend (GlitchTip self-hosted) with release + commit tagging; PII scrubbing; source maps uploaded at build.                                                                                                                                                            |
| **RUM**     | Web Vitals (INP/LCP/CLS), route timings, long tasks, and client-side error rates per release.                                                                                                                                                                                             |
| **Uptime**  | External heartbeat checks from a **different provider** than the host, so a full outage is still visible.                                                                                                                                                                                 |

## 20.2 SLOs and alerting

| SLI                        | SLO                        | Alert                                                        |
| :------------------------- | :------------------------- | :----------------------------------------------------------- |
| API availability (non-5xx) | 99.9% monthly              | Burn-rate alert (fast: 2% in 1 h; slow: 5% in 6 h)           |
| API read latency p95       | ≤ 250 ms                   | Page if > 500 ms for 10 min                                  |
| Write latency p95          | ≤ 300 ms                   | Page if > 750 ms for 10 min                                  |
| Sync propagation p95       | ≤ 1 s                      | Page if > 5 s for 5 min                                      |
| Job lag p95                | ≤ 30 s                     | Warn at 2 min, page at 10 min                                |
| Mail sync success          | ≥ 99% of accounts per hour | Warn; page if a single account fails 10 consecutive attempts |
| Websocket connect success  | ≥ 99.5%                    | Warn                                                         |
| Error budget               | 0.1% monthly               | Feature freeze on exhaustion until burn rate recovers        |

**Alert rules:** every alert must be **actionable**, link to a runbook, and name an owner. No alert without a runbook; no runbook without a tested command. Dashboards: _Overview_, _Sync_, _Jobs_, _Mail_, _AI_, _Database_, _Edge_.

## 20.3 Operability requirements

- **Health endpoints:** `/healthz` (liveness, no dependencies), `/readyz` (DB + migrations + required cache reachable), `/metrics`.
- **Graceful shutdown:** drain HTTP, flush Yjs rooms, finish in-flight jobs (with a deadline), close sockets with a close frame.
- **Feature flags** for every risky surface, evaluated server-side, with a kill switch per integration (mail, AI, GitHub, MCP).
- **Read-only mode:** a global flag that keeps reads serving while writes return `503` with a clear message, used during risky migrations.
- **Admin console (internal):** workspace lookup, queue inspection/replay, dead-letter browser, feature-flag overrides, impersonation **with explicit consent + audit** (or not at all).

## 20.4 Incident process

1. **Detect** (alert or report) → 2. **Acknowledge + declare severity** (SEV1–3) → 3. **Mitigate** (rollback/flag/scale) → 4. **Communicate** (status page + customer email for SEV1/2 within 30 min) → 5. **Resolve** → 6. **Blameless postmortem within 5 business days** with action items and owners.

Severity ladder: SEV1 = data loss/security or full outage; SEV2 = major feature unavailable or severe latency; SEV3 = degraded, workaround exists.
