# @huriro/design-tokens

Single source of truth for design tokens (§17.4): DTCG-format JSON in `tokens/`,
compiled by `src/compile.ts` to:

- `dist/css/tokens.css` — shadcn contract vars on `:root` + `.dark` (never `data-theme`)
- `dist/tailwind/theme.css` — Tailwind v4 `@theme` + `@custom-variant dark`
- `dist/rn/theme.ts` — Uniwind/React Native theme object
- `dist/docs/tokens.html` — token reference page

## Rules

- Edit `tokens/*.json`, never `dist/` — `bun run gen` rebuilds, `gen:check` gates drift.
- Semantic names only (`--primary`, `--border`), never raw ramp values in consumers.
- Brand color is `--primary`. shadcn's `--accent` is the hover/selected surface.
- New semantic colors need BOTH `light` and `dark` entries in `semantic.json`.
