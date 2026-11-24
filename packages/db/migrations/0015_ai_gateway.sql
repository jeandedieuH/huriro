-- 0015_ai_gateway.sql — M3: AI gateway + semantic search v1 (§11.1–§11.4).
--
-- ai_providers holds per-workspace provider config (BYO key or local Ollama —
-- the API key is envelope-encrypted by the app, never plaintext). ai_runs is
-- the append-only metering/audit ledger for every gateway call. ai_cache is
-- the exact-response cache keyed by (workspace, model, params, prompt hash) —
-- never shared across workspaces. chunk_embeddings powers semantic search v1;
-- the column is `halfvec` (dimension-less) with ONE partial HNSW index per
-- model so swapping models is a re-index, not a migration (§11.1).
--
-- Rollback note: drop the four tenant tables + embedding_models; revoke
-- grants; remove the ai.* role_permissions rows.

-- ---------- instance-level model registry (no tenant scope by design) ----------
CREATE TABLE embedding_models (
	id           text PRIMARY KEY,        -- e.g. 'nomic-embed-text'
	provider     text NOT NULL,           -- 'ollama' | 'openai_compatible' | ...
	dimensions   int  NOT NULL,
	is_active    boolean NOT NULL DEFAULT false,
	created_at   timestamptz NOT NULL DEFAULT now()
);

-- Default local model for self-host (must run locally — §24 decision 0010).
INSERT INTO embedding_models (id, provider, dimensions, is_active)
VALUES ('nomic-embed-text', 'ollama', 768, true);

-- ---------- tenant tables ----------
CREATE TABLE ai_providers (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	id           uuid NOT NULL DEFAULT uuidv7(),
	kind         text NOT NULL CHECK (kind IN ('openai_compatible', 'ollama')),
	name         text NOT NULL,
	base_url     text NOT NULL,
	-- Envelope-encrypted API key ('v1:iv:tag:ct'); NULL for keyless local providers.
	api_key_enc  text,
	chat_model        text,
	embedding_model   text REFERENCES embedding_models(id),
	is_default   boolean NOT NULL DEFAULT true,
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, id),
	UNIQUE (workspace_id, name)
);

CREATE TABLE ai_runs (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	id           uuid NOT NULL DEFAULT uuidv7(),
	run_type     text NOT NULL CHECK (run_type IN ('chat', 'embedding', 'summary')),
	provider_id  uuid,
	model        text,
	user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
	tokens_in    int,
	tokens_out   int,
	latency_ms   int,
	outcome      text NOT NULL CHECK (outcome IN ('ok', 'error', 'cached')),
	cache_key    text,
	prompt_hash  text,
	-- Opt-in prompt/response trace (settings->>'ai_trace_prompts'); hashes only otherwise.
	prompt_trace jsonb,
	error_code   text,
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, id)
);
CREATE INDEX idx_ai_runs_ws_created ON ai_runs (workspace_id, created_at DESC);
CREATE INDEX idx_ai_runs_cache ON ai_runs (workspace_id, cache_key);

CREATE TABLE ai_cache (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	cache_key    text NOT NULL,
	model        text NOT NULL,
	response     jsonb NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	expires_at   timestamptz NOT NULL,
	PRIMARY KEY (workspace_id, cache_key)
);

CREATE TABLE chunk_embeddings (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	id           uuid NOT NULL DEFAULT uuidv7(),
	entity_type  text NOT NULL,           -- issue | doc_page | message | mail_message | comment
	entity_id    uuid NOT NULL,
	chunk_ix     int  NOT NULL,
	content_hash text NOT NULL,           -- skip re-embedding unchanged chunks
	model_id     text NOT NULL REFERENCES embedding_models(id),
	embedding    halfvec NOT NULL,        -- dimension-less; per-model typed index
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, id),
	UNIQUE (workspace_id, entity_type, entity_id, chunk_ix, model_id)
);
CREATE INDEX idx_chunk_ws ON chunk_embeddings (workspace_id, model_id);

-- One partial expression index per model (created by the "activate model" job;
-- v1 ships the seeded default). Queries must repeat the same cast+predicate.
CREATE INDEX idx_chunk_vec_nomic ON chunk_embeddings
	USING hnsw ((embedding::halfvec(768)) halfvec_cosine_ops)
	WITH (m = 16, ef_construction = 64)
	WHERE model_id = 'nomic-embed-text';

-- ---------- RLS ----------
ALTER TABLE ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_providers FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_providers_tenant_isolation ON ai_providers
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_runs_tenant_isolation ON ai_runs
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE ai_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_cache_tenant_isolation ON ai_cache
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chunk_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunk_embeddings FORCE ROW LEVEL SECURITY;
CREATE POLICY chunk_embeddings_tenant_isolation ON chunk_embeddings
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_providers TO huriro_app;
GRANT SELECT, INSERT ON ai_runs TO huriro_app;              -- append-only ledger
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_cache TO huriro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON chunk_embeddings TO huriro_app;
GRANT SELECT, INSERT, UPDATE ON embedding_models TO huriro_app;

-- ---------- permission backfill for existing workspaces ----------
-- New workspaces seed from packages/domain SYSTEM_ROLES; existing rows get the
-- new actions here (roles are data — keyed by system role key).
INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, 'ai.use'
FROM roles r
WHERE r.key IN ('owner', 'admin', 'member')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, 'ai.manage'
FROM roles r
WHERE r.key IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
