-- 0005_auth.sql — Better Auth schema (§8.3, ADR-0003).
--
-- Identity boundary:
--   * public.users stays THE user table (tenancy joins on it); better-auth maps
--     onto it via field mapping (name→display_name, image→avatar_url,
--     emailVerified→email_verified, twoFactorEnabled→mfa_enabled).
--   * everything auth-owned (sessions, credential accounts, verifications,
--     passkeys, TOTP secrets) lives in schema `auth`.
--   * a dedicated role `huriro_auth` serves the adapter: session/user lookups
--     run before any tenant context exists, so it needs context-free reads on
--     users — granted via the users_auth_access policy — while holding ZERO
--     grants on tenant tables (isolation is structural, not conventional).
--   * NOT BYPASSRLS: the role only sees what its grants+policies allow.
--
-- Rollback note: DROP SCHEMA auth CASCADE; ALTER users DROP COLUMN
-- email_verified; DROP POLICY users_auth_access ON users; DROP ROLE
-- huriro_auth after revoking grants.

DO $$
BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'huriro_auth') THEN
		CREATE ROLE huriro_auth NOINHERIT NOBYPASSRLS LOGIN;
	END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;

-- ---------- better-auth core tables ----------
CREATE TABLE auth.session (
	id          text PRIMARY KEY,
	user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token       text NOT NULL UNIQUE,
	expires_at  timestamptz NOT NULL,
	ip_address  text,
	user_agent  text,
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_session_user ON auth.session (user_id);
CREATE INDEX idx_session_expires ON auth.session (expires_at);

CREATE TABLE auth.account (
	id                        text PRIMARY KEY,
	user_id                   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	account_id                text NOT NULL,
	provider_id               text NOT NULL,
	access_token              text,
	refresh_token             text,
	id_token                  text,
	access_token_expires_at   timestamptz,
	refresh_token_expires_at  timestamptz,
	scope                     text,
	password                  text, -- hash for provider_id='credential'
	created_at                timestamptz NOT NULL DEFAULT now(),
	updated_at                timestamptz NOT NULL DEFAULT now(),
	UNIQUE (provider_id, account_id)
);
CREATE INDEX idx_account_user ON auth.account (user_id);

CREATE TABLE auth.verification (
	id          text PRIMARY KEY,
	identifier  text NOT NULL,
	value       text NOT NULL,
	expires_at  timestamptz NOT NULL,
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_verification_identifier ON auth.verification (identifier);

-- ---------- plugin tables ----------
CREATE TABLE auth.passkey (
	id            text PRIMARY KEY,
	user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name          text,
	public_key    text NOT NULL,
	credential_id text NOT NULL,
	counter       integer NOT NULL DEFAULT 0,
	device_type   text NOT NULL,
	backed_up     boolean NOT NULL DEFAULT false,
	transports    text,
	aaguid        text,
	created_at    timestamptz NOT NULL DEFAULT now(),
	UNIQUE (credential_id)
);
CREATE INDEX idx_passkey_user ON auth.passkey (user_id);

CREATE TABLE auth.two_factor (
	id           text PRIMARY KEY,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	secret       text NOT NULL,
	backup_codes text NOT NULL
);
CREATE UNIQUE INDEX uq_two_factor_user ON auth.two_factor (user_id);

-- ---------- users gains the better-auth verified flag ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;

-- ---------- huriro_auth: grants + the one RLS exception ----------
-- Context-free user reads (session validation precedes tenant context) —
-- soft-deleted users stay invisible even to auth.
CREATE POLICY users_auth_access ON users TO huriro_auth
	USING (deleted_at IS NULL)
	WITH CHECK (true);

GRANT USAGE ON SCHEMA auth TO huriro_auth;
GRANT USAGE ON SCHEMA public TO huriro_auth;
GRANT SELECT, INSERT, UPDATE ON users TO huriro_auth; -- no DELETE: soft-delete only
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO huriro_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO huriro_auth;
