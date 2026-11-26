# ADR-0026: Relational Doc Databases & Sandboxed Formula Engine

## Status

Accepted — M10 implementation started.

## Context

§4.1 requires Notion-style structured databases without storing thousands of rows inside collaborative Yjs documents. CRDT blobs would prevent SQL indexing, row-level ACLs, bounded document size, relational filtering, and cheap lazy hydration. Formulas additionally need identical client/server behavior without JavaScript `eval` or ambient side effects.

## Decision

1. **Relational canonical storage.** Database metadata, properties, rows, sparse typed cell values, and views live in `doc_databases`, `doc_database_properties`, `doc_database_rows`, `doc_database_cell_values`, and `doc_database_views`. Every table is tenant-scoped, composite-keyed, and RLS-protected.
2. **Row pages are lazy.** A row optionally references `doc_pages.page_id`; `doc_pages.is_database_row` marks such pages. Structured values remain relational while row bodies remain ordinary collaborative docs.
3. **`phone` is a first-class property type.** The plan prose includes phone even though its SQL sketch omitted it; the CHECK includes it deliberately.
4. **Scoped sync envelope.** `db:<databaseId>` hydration first returns database/property/view metadata, then pages rows with embedded cells. Although ADR-0031's sketch only named properties/rows/cells, metadata and views are included because they are small and required to render without an extra eager collection. Row bodies are not included.
5. **ACL inheritance.** Database access combines workspace role permissions, teamspace membership/ACL inheritance, and explicit `doc_database` ACL entries. Private or closed teamspaces deny non-members before database ACL evaluation. Admin/database-manage bypass remains audited by policy paths.
6. **Pure formula engine.** `packages/domain/src/formula` implements a recursive-descent lexer, typed AST parser, static dependency extraction/cycle detection, and bounded evaluator. Caps are `maxAstNodes=256`, `maxEvalSteps=2000`, `maxStringLen=16_384`; no `eval`, `new Function`, I/O, randomness, or ambient clock. `now`/`today` consume injected time.
7. **Materialized computed values.** Formula outputs are cached in typed sparse cell columns/`val_json` when rows change so SQL filtering and sorting can use indexed scalar values. Errors materialize as null rather than executing untrusted input. Rollup dependency invalidation is part of the remaining M10 implementation and must preserve the same deterministic semantics.
8. **Forward-compatible relation targets.** The wire/config model permits relations to databases, issues, projects, mail conversations, and contact organizations. Targets whose tables do not exist yet (notably contact organizations) are validated as configuration shape but remain unresolved until their owning milestone.
9. **Editor embedding.** `linkedViewBlock` is an atom TipTap node carrying `sourceType`, `sourceId`, `viewId`, and independent local view config. The editor package stays framework-free; apps supply React/native NodeViews through `nodeViewOverrides` and lazy-load the database grid implementation.

## Consequences

- SQL indexing and keyset pagination can scale independently of document CRDT size.
- The same formula evaluator can run in the API/worker and client with deterministic output.
- Formula caching introduces an invalidation burden; cross-row/cross-database rollup invalidation must be completed before declaring G10.
- Database rows are not standalone ACL resources in v1.5; access is inherited through their parent database. This matches the plan's workspace/teamspace ACL gate while keeping row permission checks SQL-efficient.
- The remaining M10 slices are the six rich virtualized views, generalized filter/sort compiler, import/export UI, offline mutation envelopes, and full rollup propagation/fuzzer/performance gates.
