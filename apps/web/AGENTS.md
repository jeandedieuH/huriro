# @huriro/web

React 19 + Vite + Tailwind v4 web app (§17). shadcn-contract components live in
`src/components/ui` — owned code, not a ui-kit dependency.

## Rules

- Styling is semantic tokens only (`bg-primary`, `text-muted-foreground`,
  `border-border`) — never raw palette utilities (`bg-blue-500`) or hex values.
  The token layer is generated in `@huriro/design-tokens`; do not hand-edit its dist.
- Dark mode is the `.dark` class — never `data-theme`.
- Component props are semantic: `tone="danger"`, `size="sm"` — never `color="red"`.
- Every user-facing string goes through `t(id)` from `@huriro/i18n` — no inline
  literals. Add ids to `packages/i18n/locales/en.ts` and run `bun run gen` there.
- Interactive components get: a story (default + variant states), a play-function
  interaction test, and a vitest + `expectNoViolations` axe check (`src/lib/test-setup`).
- `@/` aliases `src/`. Tests run under vitest+jsdom (`bun run test`), not `bun test`.
- Biome can't parse Tailwind at-rules — `src/styles/` is excluded from lint; keep
  hand-written CSS minimal there.

## Commands

| `bun run dev` | vite dev server |
| `bun run test` | vitest + axe component tests |
| `bun run storybook` | Storybook on :6006 |
| `bun run build` | production build |
