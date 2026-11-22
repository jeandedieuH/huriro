# @huriro/env

Environment validation for every app (§7.5): zod schemas parsed through
`@t3-oss/env-core`'s `createEnv`. One module per app — `server/`, `web/`,
`mobile/` — imported via the matching subpath (`@huriro/env/server`).

## Owns

- `server/index.ts` — `serverSchemas` + `createServerEnv()`. The single source
  of truth for the server's env contract; `apps/server/src/env.ts` adds
  `_FILE` secret indirection and cross-field rules on top.
- `web/index.ts` — `webSchemas` + `createWebEnv()` (`VITE_` prefix). The app
  passes `import.meta.env` as `runtimeEnv`.
- `mobile/index.ts` — `mobileSchemas` + `createMobileEnv()` (`EXPO_PUBLIC_`
  prefix), for the future Expo app.
- `index.ts` — `describeEnvSchemas()` + `renderEnvExample()`: schema
  introspection used by the `genenv` CLIs to generate `.env.example` files.

## Rules

- Every schema carries `.describe()` **last** — the doc walker reads the
  description metadata to write `.env.example` comments.
- `emptyStringAsUndefined: true` everywhere: `.env` files ship `KEY=` blanks.
- Never read `import.meta.env` or `process.env` at module level here — factories
  take `runtimeEnv` so tests and different runtimes stay deterministic.
- New var ⇒ schema + `.describe()` here first, then `bun run gen` in the owning
  app; never hand-edit a `.env.example`.
