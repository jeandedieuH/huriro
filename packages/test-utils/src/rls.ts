/**
 * Table classification for the RLS coverage test (§4.2: "no new tenant-scoped
 * table without … an RLS policy, and an entry in the RLS coverage test").
 *
 * Every table in `public` must appear in exactly one list below. Adding a table
 * without classifying it fails CI — that is the entry requirement.
 */

/** Tenant tables: workspace_id column, ENABLE+FORCE RLS, tenant_isolation policy. */
export const TENANT_TABLES = [
	'roles',
	'role_permissions',
	'memberships',
	'invitations',
	'acl_entries',
	'agent_principals',
	'workspace_seq',
	'change_log',
	'sync_cursors',
	'idempotency_keys',
	'files',
	'realtime_tickets',
	'projects',
	'project_statuses',
	'labels',
	'cycles',
	'issue_counters',
	'issues',
	'issue_labels',
	'issue_relations',
	'issue_comments',
	'saved_views',
	'search_documents',
	'notifications',
	'import_jobs',
	'import_mappings',
	'doc_pages',
	'doc_state',
	'doc_versions',
	'doc_room_leases',
	'collab_tickets',
	'doc_comments',
	'doc_favorites',
	'chat_channels',
	'chat_channel_members',
	'chat_messages',
	'chat_message_reactions',
	'chat_read_state',
	'chat_thread_read_state',
	'chat_message_attachments',
	'chat_link_previews',
	'chat_message_link_previews',
	'notification_preferences',
	'notification_delivery_log',
	'web_push_subscriptions',
	'webhook_endpoints',
	'webhook_deliveries',
	'github_installations',
	'issue_github_links'
] as const

/**
 * Instance-level tables that still carry RLS (scoped visibility, not tenant
 * isolation): users (self + co-members), workspaces (member-visible),
 * audit_log (tenant rows scoped; NULL-workspace rows are maint-only).
 */
export const INSTANCE_RLS_TABLES = ['users', 'workspaces', 'audit_log'] as const

/**
 * System tables: no tenant RLS by design — internal plumbing never exposed over
 * the API (outbox, processed_events) or instance config (flags, settings,
 * migration bookkeeping). Workers read them cross-tenant BEFORE a workspace
 * context exists; huriro_maint owns their lifecycle.
 */
export const SYSTEM_TABLES = [
	'outbox',
	'processed_events',
	'feature_flags',
	'feature_flag_overrides',
	'instance_settings',
	'huriro_bootstrap',
	'schema_migrations',
	'github_webhook_events'
] as const

export type TableClass = 'tenant' | 'instance_rls' | 'system'

export function classifyTable(name: string): TableClass | null {
	if ((TENANT_TABLES as readonly string[]).includes(name)) return 'tenant'
	if ((INSTANCE_RLS_TABLES as readonly string[]).includes(name)) return 'instance_rls'
	if ((SYSTEM_TABLES as readonly string[]).includes(name)) return 'system'
	return null
}
