# ADR-0005: Elysia version — start on Elysia 2 RC

- **Status:** Accepted (v1.1); **re-evaluate at the M1 gate (G1)** if v2 is not GA
- **Date:** 2026-11-22
- **Plan refs:** §6.2; risk R2

## Context

Elysia 1.4.x entered security-fixes-only maintenance in Aug 2026. Elysia 2 is a
ground-up rewrite: new `@elysia/*` plugin namespace, TypeBox 1.x, new lifecycle.

## Decision

Start the greenfield build on **Elysia `2.0.0-rc.3`, pinned exactly**, with
TypeBox 1.x (`typebox` package). Companion plugins use the matching RC line
(`@elysia/eden@rc`, `@elysia/openapi@rc`).

- Eden must resolve the **same** `elysia` version on client and server — enforced by
  a single workspace dependency graph and a CI dedupe check.
- If v2 is not GA by the end of M1, write a follow-up ADR: stay on RC, pin to the GA
  candidate, or evaluate the migration cost of staying vs. falling back.

## Alternatives considered

- **Elysia 1.4.x** — schedules a full API migration mid-build; Huriro GA is ~a year out,
  so RC risk is smaller than guaranteed migration cost.
- **Hono/Fastify** — loses TypeBox-native validation and Eden end-to-end typing, which
  are load-bearing for the typed-client strategy (§16.4).

## Consequences

- All Elysia usage is centralized behind `apps/server` composition root; module plugins
  depend on a narrow route/service interface, so a framework bump touches wiring, not domains.
- Version pins live in `bun.lock`; upgrades are deliberate PRs with full regression.
