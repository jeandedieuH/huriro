# ADR-0027: In-House MIT Suggestion Mode over Yjs

- **Status:** Accepted
- **Date:** 2026-11-25
- **Plan refs:** §4.3, §7.3, §10.1 (ADR-0027), §10.2 (R26)

## Context

Version 2 requires Notion/Google-Docs-grade Suggestion Mode (Track Changes) so commenters (`doc.comment`), editors reviewing locked/verified wikis, and AI `/ai` rewrites can propose non-destructive prose changes rather than overwriting human text silently.

Two architectural constraints shape the design:

1. **Zero paywalled editor dependencies (`ADR-0006`, §2.5):** TipTap's official Comments and Track Changes extensions are proprietary paid packages. All V2 capabilities must ship cleanly under AGPL-3.0 / MIT without commercial add-ons.
2. **Concurrent CRDT convergence (`R26`):** Tracked edits must synchronize across concurrent Yjs peers inside `doc_state` without mark splitting, orphan drift, or schema divergence between live browser editors and server-side Hocuspocus `openDirectConnection()` transformations.

## Decision

1. **In-house MIT ProseMirror marks in `@huriro/editor`:** Implement `SuggestionInsertMark` (`suggestionInsert`) and `SuggestionDeleteMark` (`suggestionDelete`) with immutable mark attributes `{ suggestionId, groupId, authorType, authorId, createdAt }`, paired with `SuggestionModeExtension` to intercept insertions, deletions, and replacements when Suggesting mode is active (wrap inserted text with `suggestionInsert`; retain deleted spans with `suggestionDelete` instead of removing nodes).
2. **Postgres review index (`doc_suggestions`):** Reconcile active suggestion groups from the live `Y.Doc` during `persistCollabDocumentState` into the tenant-scoped `doc_suggestions` table so notifications (`docs.suggestion.created.v1`), Inbox/review badges, and audit history query cleanly in SQL without loading every Yjs binary blob.
3. **Atomic resolution via `openDirectConnection()`:** Accepting or rejecting a suggestion group (individually or via Accept All / Reject All) runs an atomic Yjs transform through `CollabDirectBridge.applyYDocTransform` (using Hocuspocus `openDirectConnection()` when the room is live, or fenced/transactional DB update when idle), keeping all connected peers converged.
4. **Commenter & AI proposal path on locked/read-only docs:** Users holding `doc.comment` (and bounded agents) can propose suggestions via `POST /api/v1/docs/:id/suggestions` even when a page is `is_locked = true` or the caller lacks `doc.write`. The server validates the payload and writes only suggestion-marked changes through the direct bridge.
5. **Orphan recovery & fuzz verification:** Expose `flattenOrphanedSuggestions(ydoc)` in `@huriro/editor` as an explicit recovery primitive for malformed/empty marks (`R26`), and verify convergence with a 10-editor randomized concurrent Yjs fuzz test plus integration coverage against real PostgreSQL 18 + Hocuspocus.

## Consequences

- Zero proprietary TipTap dependencies; full source ownership under MIT/AGPL-3.0.
- Suggestion marks ride natively in Yjs updates, so offline edits and multi-cursor sessions merge deterministically.
- Locking a doc enforces `readOnly = true` on Hocuspocus connections while preserving structured collaboration through `doc.comment` suggestion proposals and review cards.
- Every AI rewrite targets `SuggestionInsertMark`/`SuggestionDeleteMark` rather than destructive text replacement.
