# ADR-0015: Project license — AGPL-3.0 server/apps, MIT SDK/CLI/schemas, DCO

- **Status:** Accepted (v1.1, M0)
- **Date:** 2026-11-22
- **Plan refs:** §2.5

## Context

Self-host is a first-class citizen; the cloud sells operations, not features. The
license must keep the codebase open while letting integrators embed client tooling.

## Decision

- **AGPL-3.0-only** for `apps/` (server, web, mobile) and packages that ship inside the
  server or apps (db, domain, contracts-as-used-in-server, ui, editor, sync-client).
- **MIT** for `packages/api-client`, `packages/cli`, MCP tool schemas, and
  `packages/design-tokens` — anything an integrator or agent builder embeds.
- **DCO sign-off** for contributions (`Signed-off-by` trailer), no CLA — nobody can
  relicense contributors' work.
- **One edition.** No license-key gating; cloud-only operational code paths sit behind
  `HURIRO_MODE=cloud`, not a separate codebase.
- **Trademark policy** protects the _Huriro_ name/logo (permits unmodified
  redistribution, forbids implying endorsement).
- **Dependency gate:** MIT/Apache/ISC/BSD preferred; MPL-2.0/LGPL acceptable; AGPL
  acceptable for network services we talk to; SSPL/BSL/Commons-Clause/proprietary
  banned. MIT-licensed packages may only pull permissive dependencies. Enforced by a
  license allowlist in CI.

## Alternatives considered

- **Apache-2.0** — remains the alternative if enterprise contributor adoption later
  matters more than protection against closed hosted forks. Switching needs DCO-era
  contributors' consent — decide _before_ accepting outside contributions.
- **BSL/source-available** — rejected: contradicts "fully open source" and the
  self-host promise.

## Consequences

- `LICENSE` (AGPL-3.0) at root; MIT packages carry their own `LICENSE` files and a
  `license` field in `package.json`.
- Every PR checks the dependency license allowlist (§21.6).
