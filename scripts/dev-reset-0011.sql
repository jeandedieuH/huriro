-- Dev-only reset of migration 0011 so the edited file can be re-applied.
-- Drops exactly the objects 0011 creates + its ALTERs, then removes the
-- schema_migrations row. Run: docker exec -i huriro-dev-pg psql -U huriro -d huriro < this
BEGIN;

-- Tables (17). CASCADE covers FK order.
DROP TABLE IF EXISTS
	chat_message_link_previews,
	chat_message_attachments,
	chat_thread_read_state,
	chat_read_state,
	chat_message_reactions,
	chat_link_previews,
	chat_messages,
	chat_channel_members,
	chat_channels,
	notification_preferences,
	notification_delivery_log,
	web_push_subscriptions,
	webhook_deliveries,
	webhook_endpoints,
	issue_github_links,
	github_webhook_events,
	github_installations
CASCADE;

-- SECURITY DEFINER / trigger helpers (drop any signature variant from earlier drafts)
DROP FUNCTION IF EXISTS update_chat_thread_stats() CASCADE;
DROP FUNCTION IF EXISTS resolve_github_installation_route(text, bigint) CASCADE;
DROP FUNCTION IF EXISTS resolve_github_installation_route(text) CASCADE;
DROP FUNCTION IF EXISTS list_active_workspaces_for_worker() CASCADE;
DROP FUNCTION IF EXISTS list_email_digest_candidates_for_workspace(uuid) CASCADE;
DROP FUNCTION IF EXISTS list_email_digest_candidates_for_workspace() CASCADE;

-- files quarantine columns (re-added by ADD COLUMN IF NOT EXISTS on re-run)
ALTER TABLE files
	DROP COLUMN IF EXISTS quarantine_key,
	DROP COLUMN IF EXISTS declared_content_type,
	DROP COLUMN IF EXISTS scan_detail,
	DROP COLUMN IF EXISTS scanned_at,
	DROP COLUMN IF EXISTS promoted_at,
	DROP COLUMN IF EXISTS reencoded;

-- CHECK constraints: drop M4 versions. The DO-blocks in 0011 already drop
-- anything matching %kind%/%source%/%remote_type% before re-adding, so a
-- bare drop is sufficient — no need to restore the 0007 forms.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ck_notifications_kind;
ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS ck_import_jobs_source;
ALTER TABLE import_mappings DROP CONSTRAINT IF EXISTS ck_import_mappings_source;
ALTER TABLE import_mappings DROP CONSTRAINT IF EXISTS ck_import_mappings_remote_type;

DELETE FROM schema_migrations WHERE version = 11;

COMMIT;
