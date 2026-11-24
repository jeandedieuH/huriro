-- 0017_m6_mobile_billing_hardening.sql — M6 Mobile push tokens, Cloud Billing,
-- GDPR workspace exports & self-service account erasure (§18, §20.3, §22.2, §23 M6).
--
-- Expand-phase only. Every new tenant table has:
--   * workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
--   * UNIQUE (workspace_id, id)
--   * ENABLE + FORCE ROW LEVEL SECURITY + *_tenant_isolation policy
--
-- Rollback note: drop function erase_user_identity(uuid), drop tables in reverse
-- dependency order (workspace_exports → billing_webhook_events →
-- billing_usage_snapshots → billing_subscriptions → mobile_push_tokens),
-- drop notification_preferences.mobile_push_enabled, and restore the
-- pre-existing CHECK constraint on notification_delivery_log.channel.

-- ---------- 1. Mobile push tokens & notification channel/preference expansion (§18.3) ----------
CREATE TABLE mobile_push_tokens (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token        text NOT NULL,
	platform     text NOT NULL CHECK (platform IN ('ios', 'android', 'expo')),
	device_id    text NOT NULL,
	device_name  text NOT NULL DEFAULT '',
	last_used_at timestamptz,
	revoked_at   timestamptz,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, user_id, token)
);
CREATE INDEX idx_mobile_push_tokens_active
	ON mobile_push_tokens (workspace_id, user_id)
	WHERE revoked_at IS NULL;
CREATE TRIGGER trg_mobile_push_tokens_updated_at
	BEFORE UPDATE ON mobile_push_tokens
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE notification_preferences
	ADD COLUMN IF NOT EXISTS mobile_push_enabled boolean NOT NULL DEFAULT true;

DO $$
DECLARE
	c_name text;
BEGIN
	FOR c_name IN
		SELECT con.conname
		FROM pg_constraint con
		JOIN pg_class rel ON rel.oid = con.conrelid
		JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
		WHERE nsp.nspname = 'public'
			AND rel.relname = 'notification_delivery_log'
			AND con.contype = 'c'
			AND pg_get_constraintdef(con.oid) LIKE '%channel%'
	LOOP
		EXECUTE format('ALTER TABLE public.notification_delivery_log DROP CONSTRAINT %I', c_name);
	END LOOP;
END
$$;

ALTER TABLE notification_delivery_log
	ADD CONSTRAINT ck_notification_delivery_log_channel
	CHECK (channel IN ('in_app', 'email_digest', 'web_push', 'mobile_push'));

-- ---------- 2. Cloud Billing & usage metering (HURIRO_MODE=cloud, §2.5, §23 M6) ----------
-- Web-only checkout: Polar (international USD $10/workspace) + IremboPay (Rwanda RWF + Mobile Money).
CREATE TABLE billing_subscriptions (
	id                       uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	plan                     text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
	status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
	provider                 text NOT NULL DEFAULT 'polar' CHECK (provider IN ('polar', 'irembopay', 'manual')),
	provider_customer_id     text,
	provider_subscription_id text,
	billing_email            text,
	billing_phone            text,
	currency                 text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'RWF')),
	amount_charged           integer NOT NULL DEFAULT 0,
	payment_method           text CHECK (payment_method IS NULL OR payment_method IN ('card', 'mtn_momo', 'airtel_money', 'irembopay_hosted')),
	seat_limit               integer NOT NULL DEFAULT 5,
	storage_limit_bytes      bigint NOT NULL DEFAULT 1073741824,
	current_period_start     timestamptz,
	current_period_end       timestamptz,
	cancel_at_period_end     boolean NOT NULL DEFAULT false,
	metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at               timestamptz NOT NULL DEFAULT now(),
	updated_at               timestamptz NOT NULL DEFAULT now(),
	version                  int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id)
);
CREATE INDEX idx_billing_subscriptions_customer
	ON billing_subscriptions (provider_customer_id)
	WHERE provider_customer_id IS NOT NULL;
CREATE INDEX idx_billing_subscriptions_subscription
	ON billing_subscriptions (provider_subscription_id)
	WHERE provider_subscription_id IS NOT NULL;
CREATE TRIGGER trg_billing_subscriptions_updated_at
	BEFORE UPDATE ON billing_subscriptions
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only/daily-snapshot metering table per workspace + UTC date.
CREATE TABLE billing_usage_snapshots (
	id             uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	period_date    date NOT NULL,
	active_seats   integer NOT NULL DEFAULT 0,
	storage_bytes  bigint NOT NULL DEFAULT 0,
	ai_tokens_used bigint NOT NULL DEFAULT 0,
	created_at     timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, period_date)
);

-- System table: Polar / IremboPay webhook events arrive pre-tenant before routing (§19.6, §22).
CREATE TABLE billing_webhook_events (
	provider_event_id text PRIMARY KEY,
	provider          text NOT NULL DEFAULT 'polar' CHECK (provider IN ('polar', 'irembopay')),
	event_type        text NOT NULL,
	workspace_id      uuid REFERENCES workspaces(id) ON DELETE SET NULL,
	payload           jsonb NOT NULL,
	received_at       timestamptz NOT NULL DEFAULT now(),
	processed_at      timestamptz,
	last_error        text
);

CREATE OR REPLACE FUNCTION resolve_billing_workspace(
	p_customer_id text,
	p_subscription_id text
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT bs.workspace_id
	FROM public.billing_subscriptions bs
	WHERE (p_subscription_id IS NOT NULL AND bs.provider_subscription_id = p_subscription_id)
		OR (p_customer_id IS NOT NULL AND bs.provider_customer_id = p_customer_id)
	LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_billing_workspace(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_billing_workspace(text, text) TO huriro_app;

-- ---------- 3. GDPR workspace exports & Art. 17 self-erasure (§22.2) ----------
CREATE TABLE workspace_exports (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
	status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
	storage_key  text,
	byte_size    bigint NOT NULL DEFAULT 0,
	manifest     jsonb NOT NULL DEFAULT '{}'::jsonb,
	expires_at   timestamptz,
	error_detail text,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id)
);
CREATE INDEX idx_workspace_exports_ws ON workspace_exports (workspace_id, created_at DESC);
CREATE TRIGGER trg_workspace_exports_updated_at
	BEFORE UPDATE ON workspace_exports
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Self-service GDPR Art. 17 erasure: verifies app.user_id = p_user_id,
-- suspends workspace memberships, revokes push/auth credentials, and
-- anonymizes the user row while preserving tenant audit referential integrity.
CREATE OR REPLACE FUNCTION erase_user_identity(p_user_id uuid)
RETURNS TABLE (workspace_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
	v_ws_ids uuid[];
	v_ws uuid;
BEGIN
	IF p_user_id IS NULL
		OR NULLIF(current_setting('app.user_id', true), '')::uuid IS DISTINCT FROM p_user_id THEN
		RAISE EXCEPTION 'erase_user_identity requires matching app.user_id context';
	END IF;

	SELECT COALESCE(array_agg(m.workspace_id), '{}'::uuid[])
	INTO v_ws_ids
	FROM public.memberships m
	WHERE m.user_id = p_user_id AND m.status = 'active';

	UPDATE public.memberships
	SET status = 'suspended'
	WHERE user_id = p_user_id;

	DELETE FROM public.web_push_subscriptions WHERE user_id = p_user_id;
	DELETE FROM public.mobile_push_tokens WHERE user_id = p_user_id;

	DELETE FROM auth.oauth_access_token WHERE user_id = p_user_id;
	DELETE FROM auth.oauth_refresh_token WHERE user_id = p_user_id;
	DELETE FROM auth.oauth_consent WHERE user_id = p_user_id;
	DELETE FROM auth.passkey WHERE user_id = p_user_id;
	DELETE FROM auth.two_factor WHERE user_id = p_user_id;
	DELETE FROM auth.device_code WHERE user_id = p_user_id::text;
	DELETE FROM auth.session WHERE user_id = p_user_id;
	DELETE FROM auth.account WHERE user_id = p_user_id;

	UPDATE public.users
	SET
		email = ('deleted-' || p_user_id::text || '@erased.invalid')::citext,
		display_name = 'Deleted user',
		avatar_url = NULL,
		mfa_enabled = false,
		deleted_at = now()
	WHERE id = p_user_id;

	FOREACH v_ws IN ARRAY v_ws_ids LOOP
		workspace_id := v_ws;
		RETURN NEXT;
	END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION erase_user_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_user_identity(uuid) TO huriro_app;

-- ---------- 4. ENABLE + FORCE RLS & tenant_isolation policies ----------
ALTER TABLE mobile_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_push_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY mobile_push_tokens_tenant_isolation ON mobile_push_tokens
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_subscriptions_tenant_isolation ON billing_subscriptions
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE billing_usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_usage_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_usage_snapshots_tenant_isolation ON billing_usage_snapshots
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE workspace_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_exports_tenant_isolation ON workspace_exports
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- 5. Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON
	mobile_push_tokens,
	billing_subscriptions,
	billing_usage_snapshots,
	workspace_exports
TO huriro_app;

GRANT SELECT, INSERT, UPDATE ON billing_webhook_events TO huriro_app;

GRANT SELECT ON
	mobile_push_tokens,
	billing_subscriptions,
	billing_usage_snapshots,
	billing_webhook_events,
	workspace_exports
TO huriro_maint;

GRANT DELETE ON billing_webhook_events TO huriro_maint;
