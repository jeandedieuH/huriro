# ADR-0014: Observability default for self-host — logs + /metrics; OTLP optional

- **Status:** Accepted (v1.1, M0)
- **Date:** 2026-11-22
- **Plan refs:** §6.4, §20; failure-mode table §5.6

## Context

Self-host must never _require_ an observability stack, but the product must be
observable by construction (§4.1 #8) and SLOs must be measurable (§4.3).

## Decision

Baseline shipped in every install:

- **Structured JSON logs** to stdout (pino-style fields: `level`, `ts`, `request_id`,
  `workspace_id`, `user_id` hashed, `msg`). Nothing else is required to run.
- **Prometheus `/metrics`** endpoint (request rates, latency histograms per route
  family, queue lag, DB pool stats, change-log write latency) on an internal path.
- **External heartbeat** hook: the worker pings a configured URL on job health, so
  operators get dead-man's-switch monitoring for free.

Optional, off by default:

- **OpenTelemetry export** (manual spans on Bun) to any OTLP endpoint
  (Grafana LGTM / SigNoz / OpenObserve) via env config.
- **Error DSN** (GlitchTip/Sentry-compatible) via env config.

## Alternatives considered

- **OTLP required** — rejected: forces a collector on 2-vCPU self-hosts.
- **Vendor agent (Datadog etc.)** — rejected: lock-in and cost, against self-host values.

## Consequences

- Every route/job/socket emits the same trace context keys from M0; adding OTLP later
  is wiring, not instrumentation work.
- `huriro doctor` reports whether optional exporters are configured but never warns
  about their absence on minimal installs.
