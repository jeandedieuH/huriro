# @huriro/editor

Shared collaborative document schema, Yjs headless conversions, RelativePosition
anchors, Markdown I/O, HTML sanitization, and starter templates (§10).

## Owns

- `src/schema.ts` — TipTap v3 extension bundle + headless ProseMirror schema
- `src/extensions/` — `blockId`, `callout`, `toggle`, `entityMention`, `embed`, `referenceBlock`, `commentAnchor`
- `src/yjs-utils.ts` — headless Y.Doc extraction, ProseMirror JSON ↔ Y.Doc, non-destructive replace/append
- `src/anchors.ts` — Yjs `RelativePosition` comment anchors & orphan detection
- `src/markdown.ts` — GFM round-trip import/export + LCS version diff
- `src/sanitize.ts` — strict URL & HTML allowlist sanitizer
- `src/templates.ts` — built-in document starter templates

## Never do

- Never import React, `@huriro/db`, `@huriro/test-utils`, or `apps/*`.
- Never execute DOM-only rendering inside server-callable helpers.
