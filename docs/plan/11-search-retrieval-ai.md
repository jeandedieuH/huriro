# 11. Search, Retrieval & AI

## 11.1 Search architecture

One unified index table, populated by outbox consumers, queried by one endpoint.

```sql
CREATE TABLE search_documents (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entity_type  text NOT NULL,          -- issue | doc_page | message | mail_message | comment
    entity_id    uuid NOT NULL,
    project_id   uuid,
    container_id uuid,                   -- channel / page / conversation, for scoping
    title        text NOT NULL DEFAULT '',
    body         text NOT NULL DEFAULT '',
    lang         text NOT NULL DEFAULT 'simple',
    tsv          tsvector GENERATED ALWAYS AS (
                     setweight(to_tsvector(lang, coalesce(title,'')), 'A') ||
                     setweight(to_tsvector(lang, coalesce(body,'')),  'B')
                 ) STORED,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, entity_type, entity_id)
);
CREATE INDEX idx_sd_tsv ON search_documents USING gin (tsv);
CREATE INDEX idx_sd_trgm ON search_documents USING gin (title gin_trgm_ops);

CREATE TABLE embedding_models (
    id         text PRIMARY KEY,         -- e.g. 'qwen3-embedding-0.6b'
    provider   text NOT NULL,
    dimensions int  NOT NULL,
    is_active  boolean NOT NULL DEFAULT false
);

CREATE TABLE chunk_embeddings (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entity_type  text NOT NULL,
    entity_id    uuid NOT NULL,
    chunk_ix     int NOT NULL,
    content_hash text NOT NULL,          -- skip re-embedding unchanged chunks
    model_id     text NOT NULL REFERENCES embedding_models(id),
    embedding    halfvec NOT NULL,       -- dimension-less column; each model gets its own typed index
    UNIQUE (workspace_id, entity_type, entity_id, chunk_ix, model_id)
);
-- One partial expression index PER MODEL (created by the "activate model" migration job).
-- HNSW needs a fixed dimension, so the cast lives in the index, not in the column:
CREATE INDEX idx_chunk_vec_qwen3_06b ON chunk_embeddings
    USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)
    WHERE model_id = 'qwen3-embedding-0.6b';
-- Queries must repeat the same cast and predicate to use it:
--   ORDER BY embedding::halfvec(1024) <=> $q  ...  WHERE model_id = 'qwen3-embedding-0.6b'
CREATE INDEX idx_chunk_ws ON chunk_embeddings (workspace_id, model_id);
```

**Why `halfvec` + a model table:** halving vector storage costs, and decoupling model choice from the schema means switching embedding providers is a background re-index, not a migration. Never hardcode dimensions in a column definition.

**Query path:**

1. Parse the query: detect entity prefixes (`ENG-142`, `#channel`, `@person`, `in:project`, `is:open`), extract filters.
2. Run Postgres FTS (`websearch_to_tsquery`, per-language `regconfig`) and `pg_trgm` fuzzy match in parallel.
3. If AI is enabled and the query is natural-language, run a vector search with `hnsw.iterative_scan = relaxed_order` so filters don't collapse recall.
4. Fuse with **Reciprocal Rank Fusion** in SQL; permission-filter the result set (always, as a SQL predicate, not a post-filter).
5. Return typed results grouped by kind with highlighted snippets and deep links.

**Multilingual:** store a `lang` per document (detected, overridable). Use `simple` + `unaccent` as a safe default; CJK needs a dedicated tokenizer path (parked as a Phase-4 enhancement).

**Scaling path:** if a tenant's index outgrows a single table, partition `search_documents` by `workspace_id` hash and consider a BM25 extension (e.g. ParadeDB `pg_search`) as an _optional_ add-on — but never as a hard dependency, because managed Postgres providers do not uniformly offer it.

## 11.2 AI capability map (what the product actually does)

| Capability                                        | Where it appears                  | Guardrails                                            |
| :------------------------------------------------ | :-------------------------------- | :---------------------------------------------------- |
| **Semantic search / ask**                         | Command palette, doc sidebar      | Read-only, workspace-scoped, cites sources with links |
| **Summarize thread/conversation**                 | Issue, channel, mail conversation | Read-only; shows "summarized from N messages"         |
| **Draft reply** (chat, mail, comment)             | Compose boxes                     | Suggestion only; never auto-sends                     |
| **Triage suggestion** (labels, project, assignee) | Inbox/issue creation              | Suggestion chips, human applies                       |
| **Agent tools (MCP)**                             | External agents                   | Scoped tokens, explicit confirmation for writes       |
| **Doc Q&A**                                       | Doc page "Ask" panel              | Answers only from documents the _viewer_ can read     |

**Explicit non-goals:** autonomous background agents that modify data without a human in the loop; training on customer data; sending workspace content to a provider that retains it (see §22).

## 11.3 AI gateway design

```text
API/Worker → AiGateway
  ├─ provider adapter (OpenAI-compatible, Anthropic, local vLLM/Ollama)
  ├─ model registry (id → provider, context window, cost, capability flags)
  ├─ policy: per-workspace enable/disable, allowed models, token budget
  ├─ redaction: strip secrets/PII per policy before egress
  ├─ metering: tokens in/out per workspace/user/run (billing + quotas)
  ├─ caching: exact-response cache keyed by (model, params, prompt hash)
  └─ tracing: prompt/response stored only if the workspace opts in; otherwise hashes only
```

- Prompts are **versioned code**, not strings scattered through the app: `packages/ai/prompts/<name>@<version>.ts` with a test that snapshots the rendered prompt.
- Every AI call is an `ai_runs` row (model, tokens, latency, cost, outcome) — auditable and billable.
- **Provider-agnostic by construction** so self-hosters can point at a local model, and so a provider outage degrades to "AI unavailable" rather than a broken product.

## 11.4 Retrieval isolation (the part that must not be wrong)

- Retrieval queries **always** include `workspace_id = $current` and the _requesting user's_ permission scope — enforced in SQL, not in app filtering.
- Agents get the **intersection** of (token scopes) ∩ (user permissions) ∩ (workspace policy). There is no "service account sees everything" path.
- Retrieved content is wrapped in a clearly delimited, untrusted-data envelope in the prompt, with instructions to never follow directives found inside it (§13.6).
- No cross-workspace cache keys. The semantic cache key includes `workspace_id`.
