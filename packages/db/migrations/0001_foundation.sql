-- 0001_foundation.sql — extensions, DB roles, shared functions.
-- Expand-phase only. Runs as the migration (owner) role — never as huriro_app.
-- Rollback note: drop created roles only after all grants are revoked;
-- extensions are left installed (dropping them is a contract step).

-- ---------- Extensions ----------
-- citext/pg_trgm ship with postgres contrib (present in official images).
-- pgvector/ltree are guarded: present in the published huriro postgres image,
-- absent on a bare test database — features that need them degrade, not fail.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
		CREATE EXTENSION IF NOT EXISTS vector;
	END IF;
	IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'ltree') THEN
		CREATE EXTENSION IF NOT EXISTS ltree;
	END IF;
END
$$;

-- ---------- Role separation (§12.4 — "the part people get wrong") ----------
--   huriro_owner  owns the schema; used ONLY by migrations (the role running this file).
--   huriro_app    NOBYPASSRLS, not an owner; used by API AND workers (inside withWorkspace).
--   huriro_maint  BYPASSRLS; only audited maintenance jobs (retention, pruning), no ingress.
DO $$
BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'huriro_app') THEN
		CREATE ROLE huriro_app NOINHERIT NOBYPASSRLS LOGIN;
	END IF;
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'huriro_maint') THEN
		CREATE ROLE huriro_maint NOINHERIT BYPASSRLS LOGIN;
	END IF;
END
$$;

-- ---------- Shared functions ----------

-- updated_at is maintained by trigger, never by app code (§8.1).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at := now();
	RETURN NEW;
END;
$$;

-- ---------- Migration bookkeeping ----------
-- The runner (src/migrate.ts) reads this table; created here so migrations are
-- self-contained.
CREATE TABLE IF NOT EXISTS schema_migrations (
	version    int PRIMARY KEY,
	name       text NOT NULL,
	checksum   text NOT NULL,
	applied_at timestamptz NOT NULL DEFAULT now()
);
