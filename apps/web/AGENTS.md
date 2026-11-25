# @huriro/web

React 19 + TanStack Start 1.x on the Vite+ toolchain (rolldown-vite 8), Tailwind
v4 (§6, §17). shadcn-contract components live in `src/components/ui` — owned
code, not a ui-kit dependency.

## Layout

- `src/start.ts` — `createStart` instance: `defaultSsr: false` — every route
  renders client-only from the local replica; public share/auth pages will opt
  back into `ssr` per-route when they land.
- `src/router.tsx` + `src/routeTree.gen.ts` — router factory + GENERATED route
  tree (regenerates on `vp dev`/`vp build`; commit it — `typecheck` needs it).
- `src/routes/` — file routes: `__root` (document shell + boot gate + global
  overlays), `index → /tasks`, `tasks`, `inbox`, `settings`, `docs`, `chat`.
- `src/lib/navigation.ts` — store↔router bridge: `ui-store.destination` mirrors
  the URL; non-React callers (palette, G-chords, tests) keep `setDestination`.
- `src/lib/workspace.tsx` — `useWorkspace()` context for the booted engine/API.

## Rules

- Styling is semantic tokens only (`bg-primary`, `text-muted-foreground`,
  `border-border`) — never raw palette utilities (`bg-blue-500`) or hex values.
  The token layer is generated in `@huriro/design-tokens`; do not hand-edit its dist.
- Dark mode is the `.dark` class — never `data-theme`.
- Component props are semantic: `tone="danger"`, `size="sm"` — never `color="red"`.
- Every user-facing string goes through `t(id)` from `@huriro/i18n` — no inline
  literals. Add ids to `packages/i18n/locales/en.ts` and run `bun run gen` there.
  Interpolation is `t(id, { count })` — NEVER `.replace('{count}', …)` on the
  output: Lingui strips unknown `{placeholders}` to empty strings at render
  time, so the replace target is already gone (M7 postmortem).
- Interactive components get: a story (default + variant states), a play-function
  interaction test, and a vitest + `expectNoViolations` axe check (`src/lib/test-setup`).
- `@/` aliases `src/` (resolved via `resolve.tsconfigPaths`). Tests run under
  vitest+jsdom (`bun run test`), not `bun test`.
- Biome can't parse Tailwind at-rules — `src/styles/` is excluded from lint; keep
  hand-written CSS minimal there. `src/routeTree.gen.ts` is lint-excluded too.
- API stays on the Elysia server (§6) — no TanStack server functions for app
  data. Dev port is **3000**; proxies `/api` → `127.0.0.1:3001` (api) and
  `/ws` → `127.0.0.1:3005` (realtime).
- Storybook filters out all `tanstack*`/`nitro*` vite plugins (`viteFinal`) —
  they own the app server build and break the stories bundle.

## Commands

| `bun run dev` | `vp dev` — Vite+ dev server (Nitro dev SSR runtime) |
| `bun run test` | `vp test` — bundled vitest 5 + axe component tests |
| `bun run build` | `vp build` — client + Nitro server to `.output/` |
| `bun run test:visual` | Playwright on `.output/server/index.mjs` :4173 |
| `bun run storybook` | Storybook on :6006 |
