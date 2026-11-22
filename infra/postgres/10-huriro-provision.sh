#!/bin/sh
# Runs once at initdb (empty PGDATA). Provisions app-role passwords + the
# setup-token hash from secret files — provision-time secrets must never live
# in migration files (§12.7).
#
# The hash lands in `huriro_bootstrap` (NOT instance_settings, which migration
# 0003 owns and creates with CREATE TABLE — creating it here would collide).
set -eu

read_secret() {
	file="$(eval "echo \${$1:-}")"
	if [ -n "$file" ] && [ -f "$file" ]; then
		tr -d '[:space:]' <"$file"
	else
		eval "echo \${$2:-}"
	fi
}

APP_PW="$(read_secret HURIRO_APP_DB_PASSWORD_FILE HURIRO_APP_DB_PASSWORD)"
MAINT_PW="$(read_secret HURIRO_MAINT_DB_PASSWORD_FILE HURIRO_MAINT_DB_PASSWORD)"
AUTH_PW="$(read_secret HURIRO_AUTH_DB_PASSWORD_FILE HURIRO_AUTH_DB_PASSWORD)"
SETUP_HASH="$(read_secret HURIRO_SETUP_TOKEN_HASH_FILE HURIRO_SETUP_TOKEN_HASH)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	-- Migration 0001 also creates these roles IF NOT EXISTS; both orders
	-- (provision-first / migrate-first) converge.
	DO \$\$
	BEGIN
		IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'huriro_app') THEN
			CREATE ROLE huriro_app NOINHERIT NOBYPASSRLS LOGIN;
		END IF;
		IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'huriro_maint') THEN
			CREATE ROLE huriro_maint NOINHERIT BYPASSRLS LOGIN;
		END IF;
		IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'huriro_auth') THEN
			CREATE ROLE huriro_auth NOINHERIT NOBYPASSRLS LOGIN;
		END IF;
	END
	\$\$;
	ALTER ROLE huriro_app PASSWORD '${APP_PW}';
	ALTER ROLE huriro_maint PASSWORD '${MAINT_PW}';
	ALTER ROLE huriro_auth PASSWORD '${AUTH_PW}';

	CREATE TABLE IF NOT EXISTS huriro_bootstrap (key text PRIMARY KEY, value jsonb NOT NULL);
	INSERT INTO huriro_bootstrap (key, value)
	VALUES ('setup_token_hash', '"${SETUP_HASH}"'::jsonb)
	ON CONFLICT (key) DO NOTHING;
SQL
