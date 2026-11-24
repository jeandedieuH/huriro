-- 0012_agent_oauth_m3.sql — Better Auth OAuth provider / JWKS / device grant
-- tables for M3 agent credentials (§13.1, ADR-0019).
--
-- Same identity boundary as 0005: these are GLOBAL auth tables in schema
-- `auth`, reachable only by the `huriro_auth` role — they hold OAuth clients,
-- resources, tokens, consent grants, DPoP/assertion replay guards, and device
-- codes. Not tenant tables: an OAuth client predates any workspace context.
--
-- Names/columns follow the better-auth plugin schema (oauth-provider, jwt,
-- device-authorization @ 1.7.25) translated to our snake_case convention; the
-- drizzle bundle in schema/auth.ts maps them back.
--
-- Rollback note (contract phase, not yet): DROP the nine tables below, then
-- revoke their grants from huriro_auth.

-- JWKS signing keys for OAuth access-token JWTs (better-auth jwt plugin).
CREATE TABLE auth.jwks (
	id          text PRIMARY KEY,
	public_key  text NOT NULL,
	private_key text NOT NULL,
	created_at  timestamptz NOT NULL,
	expires_at  timestamptz,
	alg         text,
	crv         text
);

-- Registered OAuth clients: pre-registered first-party (huriro-cli) plus
-- CIMD documents (client_discovery_id set) and admin-registered third-party.
CREATE TABLE auth.oauth_client (
	id                                   text PRIMARY KEY,
	client_id                            text NOT NULL UNIQUE,
	client_secret                        text,
	client_discovery_id                  text,
	disabled                             boolean,
	skip_consent                         boolean,
	enable_end_session                   boolean,
	subject_type                         text,
	scopes                               jsonb,
	client_credentials_scopes            jsonb,
	user_id                              uuid REFERENCES users(id) ON DELETE CASCADE,
	created_at                           timestamptz,
	updated_at                           timestamptz,
	name                                 text,
	uri                                  text,
	icon                                 text,
	contacts                             jsonb,
	tos                                  text,
	policy                               text,
	software_id                          text,
	software_version                     text,
	software_statement                   text,
	redirect_uris                        jsonb NOT NULL,
	post_logout_redirect_uris            jsonb,
	backchannel_logout_uri               text,
	backchannel_logout_session_required  boolean,
	token_endpoint_auth_method           text,
	application_type                     text,
	jwks                                 text,
	jwks_uri                             text,
	grant_types                          jsonb,
	response_types                       jsonb,
	require_pkce                         boolean,
	dpop_bound_access_tokens             boolean,
	reference_id                         text,
	metadata                             jsonb
);
CREATE INDEX idx_oauth_client_user ON auth.oauth_client (user_id);

-- RFC 8707 protected resources the AS may mint audience-bound tokens for
-- (${HURIRO_URL}/mcp and ${HURIRO_URL}/api/v1/agent).
CREATE TABLE auth.oauth_resource (
	id                               text PRIMARY KEY,
	identifier                       text NOT NULL UNIQUE,
	name                             text NOT NULL,
	access_token_ttl                 integer,
	refresh_token_ttl                integer,
	signing_algorithm                text,
	signing_key_id                   text,
	allowed_scopes                   jsonb,
	custom_claims                    jsonb,
	dpop_bound_access_tokens_required boolean,
	disabled                         boolean,
	created_at                       timestamptz,
	updated_at                       timestamptz,
	policy_version                   integer,
	metadata                         jsonb
);

-- Which clients may request which resources (enforced when
-- enforcePerClientResources is on; the composite unique is load-bearing).
CREATE TABLE auth.oauth_client_resource (
	id          text PRIMARY KEY,
	client_id   text NOT NULL REFERENCES auth.oauth_client (client_id) ON DELETE CASCADE,
	resource_id text NOT NULL REFERENCES auth.oauth_resource (identifier) ON DELETE CASCADE,
	metadata    jsonb,
	created_at  timestamptz,
	UNIQUE (client_id, resource_id)
);
CREATE INDEX idx_oauth_client_resource_client ON auth.oauth_client_resource (client_id);
CREATE INDEX idx_oauth_client_resource_resource ON auth.oauth_client_resource (resource_id);

CREATE TABLE auth.oauth_refresh_token (
	id                          text PRIMARY KEY,
	token                       text NOT NULL UNIQUE,
	client_id                   text NOT NULL REFERENCES auth.oauth_client (client_id) ON DELETE CASCADE,
	session_id                  text REFERENCES auth.session (id) ON DELETE SET NULL,
	user_id                     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	reference_id                text,
	authorization_code_id       text,
	resources                   jsonb,
	requested_user_info_claims  jsonb,
	expires_at                  timestamptz NOT NULL,
	created_at                  timestamptz NOT NULL,
	revoked                     timestamptz,
	rotated_at                  timestamptz,
	rotation_replay_response    text,
	rotation_replay_expires_at  timestamptz,
	auth_time                   timestamptz,
	confirmation                jsonb,
	scopes                      jsonb NOT NULL
);
CREATE INDEX idx_oauth_refresh_token_client ON auth.oauth_refresh_token (client_id);
CREATE INDEX idx_oauth_refresh_token_session ON auth.oauth_refresh_token (session_id);
CREATE INDEX idx_oauth_refresh_token_user ON auth.oauth_refresh_token (user_id);
CREATE INDEX idx_oauth_refresh_token_code ON auth.oauth_refresh_token (authorization_code_id);

CREATE TABLE auth.oauth_access_token (
	id                          text PRIMARY KEY,
	token                       text NOT NULL UNIQUE,
	client_id                   text NOT NULL REFERENCES auth.oauth_client (client_id) ON DELETE CASCADE,
	session_id                  text REFERENCES auth.session (id) ON DELETE SET NULL,
	user_id                     uuid REFERENCES users(id) ON DELETE CASCADE,
	reference_id                text,
	authorization_code_id       text,
	resources                   jsonb,
	requested_user_info_claims  jsonb,
	refresh_id                  text REFERENCES auth.oauth_refresh_token (id) ON DELETE CASCADE,
	expires_at                  timestamptz NOT NULL,
	created_at                  timestamptz NOT NULL,
	revoked                     timestamptz,
	confirmation                jsonb,
	scopes                      jsonb NOT NULL
);
CREATE INDEX idx_oauth_access_token_client ON auth.oauth_access_token (client_id);
CREATE INDEX idx_oauth_access_token_session ON auth.oauth_access_token (session_id);
CREATE INDEX idx_oauth_access_token_user ON auth.oauth_access_token (user_id);
CREATE INDEX idx_oauth_access_token_code ON auth.oauth_access_token (authorization_code_id);
CREATE INDEX idx_oauth_access_token_refresh ON auth.oauth_access_token (refresh_id);

CREATE TABLE auth.oauth_consent (
	id                          text PRIMARY KEY,
	client_id                   text NOT NULL REFERENCES auth.oauth_client (client_id) ON DELETE CASCADE,
	user_id                     uuid REFERENCES users(id) ON DELETE CASCADE,
	reference_id                text,
	resources                   jsonb,
	requested_user_info_claims  jsonb,
	scopes                      jsonb NOT NULL,
	created_at                  timestamptz NOT NULL,
	updated_at                  timestamptz NOT NULL
);
CREATE INDEX idx_oauth_consent_client ON auth.oauth_consent (client_id);
CREATE INDEX idx_oauth_consent_user ON auth.oauth_consent (user_id);

-- Single-use replay guard for private_key_jwt client assertions: the row id
-- is a digest so a replayed assertion collides on the PK atomically.
CREATE TABLE auth.oauth_client_assertion (
	id          text PRIMARY KEY,
	expires_at  timestamptz NOT NULL
);

-- RFC 8628 device authorization (huriro CLI login).
CREATE TABLE auth.device_code (
	id               text PRIMARY KEY,
	device_code      text NOT NULL UNIQUE,
	user_code        text NOT NULL UNIQUE,
	user_id          text,
	expires_at       timestamptz NOT NULL,
	status           text NOT NULL,
	last_polled_at   timestamptz,
	polling_interval integer,
	client_id        text,
	scope            text,
	resources        jsonb,
	oauth_client_id  text
);

-- ---------- grants: identity-owned, huriro_auth only ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON
	auth.jwks,
	auth.oauth_client,
	auth.oauth_resource,
	auth.oauth_client_resource,
	auth.oauth_refresh_token,
	auth.oauth_access_token,
	auth.oauth_consent,
	auth.oauth_client_assertion,
	auth.device_code
TO huriro_auth;
