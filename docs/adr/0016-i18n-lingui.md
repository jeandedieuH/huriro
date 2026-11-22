# ADR-0016: i18n library — Lingui

- **Status:** Accepted (v1.1, M0)
- **Date:** 2026-11-22
- **Plan refs:** §6.3, §17.13a

## Context

i18n infrastructure from day one: English source, French and Kinyarwanda first,
RTL-safe layout, ICU plurals/gender, server-generated text (emails, errors,
notifications) sharing the same catalogs.

## Decision

Adopt **Lingui** (`@lingui/core`, `@lingui/react`, `@lingui/cli`, Vite plugin +
`babel-plugin-lingui-macro`-equivalent for the RN build):

- ICU MessageFormat catalogs live in `packages/i18n`; extraction runs in CI and fails
  on new hardcoded strings in `apps/*` and `packages/ui`.
- Compiled catalogs are generated code — committed and drift-checked (`bun run gen`).
- Server code uses the same core catalogs keyed by recipient locale.
- Pseudo-locale (accented + ~30% longer + RTL) runs in visual regression.

## Alternatives considered

- **react-intl (FormatJS)** — viable; Lingui's extraction/compile pipeline and smaller
  runtime fit the monorepo better and it works uniformly on web + React Native.
- **i18next** — larger runtime surface and weaker ICU-first ergonomics.
- **Paraglide** — compile-time tree-shaken and nice, but younger ecosystem and weaker
  React Native story at decision time.

## Consequences

- Every user-facing string goes through `t`/`<Trans>` from M0 — retrofitting is the
  expensive path we are avoiding.
- Weblate (self-hostable) is the community-translation path once strings stabilize.
