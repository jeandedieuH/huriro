# @huriro/config

Shared toolchain presets — tsconfig strictness, Biome rules, dependency-cruiser
module boundaries, (later) Tailwind preset. No runtime code lives here.

## Owns

- `tsconfig.base.json` — the strict flags every package extends (§6.1)
- `biome.base.json` — lint/format rules, extended by the root `biome.json`
- `dependency-cruiser.cjs` — module-boundary rules (§5.4); the single place the
  "who may import what" map is encoded

## When touching this package

- Adding a server module → add it to `MODULE_SCHEMA_OWNERSHIP` in
  `dependency-cruiser.cjs` _in the same PR_.
- A recurring agent mistake belongs here as a lint/boundary rule before it becomes
  a prose rule in `AGENTS.md` (§23.5 "knowledge durability").
