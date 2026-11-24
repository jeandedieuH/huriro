import type { WorkspaceExportDto, WorkspaceExportStatus } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export interface WorkspaceExportRecord extends WorkspaceExportDto {
	readonly storageKey: string | null
}

export async function insertWorkspaceExportRow(
	tx: Queryable,
	args: {
		readonly id: string
		readonly workspaceId: string
		readonly requestedBy: string
		readonly status: WorkspaceExportStatus
		readonly storageKey: string
		readonly byteSize: number
		readonly manifest: Record<string, unknown>
		readonly expiresAt: string
	}
): Promise<WorkspaceExportRecord> {
	const [row] = await tx<WorkspaceExportRecord[]>`
		INSERT INTO workspace_exports (
			id, workspace_id, requested_by, status, storage_key, byte_size, manifest, expires_at
		)
		VALUES (
			${args.id},
			${args.workspaceId},
			${args.requestedBy},
			${args.status},
			${args.storageKey},
			${args.byteSize},
			${tx.json(args.manifest as never)},
			${args.expiresAt}::timestamptz
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			requested_by AS "requestedBy",
			status,
			storage_key AS "storageKey",
			byte_size::double precision AS "byteSize",
			manifest,
			expires_at::text AS "expiresAt",
			error_detail AS "errorDetail",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
	`
	if (!row) throw new Error('Failed to create workspace export row')
	return row
}

export async function listWorkspaceExportRows(
	tx: Queryable,
	workspaceId: string
): Promise<WorkspaceExportDto[]> {
	return tx<WorkspaceExportDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			requested_by AS "requestedBy",
			status,
			byte_size::double precision AS "byteSize",
			manifest,
			expires_at::text AS "expiresAt",
			error_detail AS "errorDetail",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
		FROM workspace_exports
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at DESC
		LIMIT 50
	`
}

export async function getWorkspaceExportRow(
	tx: Queryable,
	workspaceId: string,
	exportId: string
): Promise<WorkspaceExportRecord | null> {
	const [row] = await tx<WorkspaceExportRecord[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			requested_by AS "requestedBy",
			status,
			storage_key AS "storageKey",
			byte_size::double precision AS "byteSize",
			manifest,
			expires_at::text AS "expiresAt",
			error_detail AS "errorDetail",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
		FROM workspace_exports
		WHERE workspace_id = ${workspaceId} AND id = ${exportId}
	`
	return row ?? null
}

export async function collectWorkspaceExportSnapshot(tx: Queryable, workspaceId: string) {
	const [workspace] = await tx<Record<string, unknown>[]>`
		SELECT id, slug, name, plan, created_at::text AS "createdAt"
		FROM workspaces
		WHERE id = ${workspaceId}
	`
	const members = await tx<Record<string, unknown>[]>`
		SELECT
			m.user_id AS "userId",
			u.email::text AS email,
			u.display_name AS "displayName",
			r.key AS "roleKey",
			m.status,
			m.joined_at::text AS "joinedAt"
		FROM memberships m
		JOIN users u ON u.id = m.user_id
		JOIN roles r ON r.workspace_id = m.workspace_id AND r.id = m.role_id
		WHERE m.workspace_id = ${workspaceId}
		ORDER BY m.joined_at ASC
	`
	const projects = await tx<Record<string, unknown>[]>`
		SELECT id, key, name, description, visibility, archived_at::text AS "archivedAt", created_at::text AS "createdAt"
		FROM projects
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at ASC
	`
	const issues = await tx<Record<string, unknown>[]>`
		SELECT
			id, project_id AS "projectId", number, title, description_text AS "descriptionText",
			status_id AS "statusId", priority, assignee_type AS "assigneeType", assignee_id AS "assigneeId",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		FROM issues
		WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
		ORDER BY created_at ASC
	`
	const docPages = await tx<Record<string, unknown>[]>`
		SELECT
			id, parent_id AS "parentId", slug, title, visibility, is_template AS "isTemplate",
			archived_at::text AS "archivedAt", created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		FROM doc_pages
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at ASC
	`
	const chatChannels = await tx<Record<string, unknown>[]>`
		SELECT id, kind, name, topic, archived_at::text AS "archivedAt", created_at::text AS "createdAt"
		FROM chat_channels
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at ASC
	`
	const chatMessages = await tx<Record<string, unknown>[]>`
		SELECT
			id, channel_id AS "channelId", thread_parent_id AS "threadParentId",
			author_type AS "authorType", author_id AS "authorId", body_text AS "bodyText",
			created_at::text AS "createdAt"
		FROM chat_messages
		WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
		ORDER BY created_at ASC
	`
	const mailConversations = await tx<Record<string, unknown>[]>`
		SELECT
			id, inbox_id AS "inboxId", subject, status, customer_email::text AS "customerEmail",
			last_message_at::text AS "lastMessageAt", created_at::text AS "createdAt"
		FROM mail_conversations
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at ASC
	`
	const mailMessages = await tx<Record<string, unknown>[]>`
		SELECT
			id, conversation_id AS "conversationId", direction,
			from_addr AS "fromAddr", to_addrs AS "toAddrs", subject, body_text AS "bodyText",
			sent_at::text AS "sentAt", received_at::text AS "receivedAt", created_at::text AS "createdAt"
		FROM mail_messages
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at ASC
	`
	const auditSummary = await tx<Record<string, unknown>[]>`
		SELECT
			id, actor_type AS "actorType", actor_id AS "actorId", action,
			target_type AS "targetType", target_id AS "targetId", created_at::text AS "createdAt"
		FROM audit_log
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at DESC
		LIMIT 1000
	`

	return {
		workspace: workspace ?? null,
		members,
		projects,
		issues,
		docPages,
		chatChannels,
		chatMessages,
		mailConversations,
		mailMessages,
		auditSummary
	}
}

export async function runEraseUserIdentity(tx: Queryable, userId: string): Promise<string[]> {
	const rows = await tx<{ workspaceId: string }[]>`
		SELECT workspace_id AS "workspaceId" FROM erase_user_identity(${userId})
	`
	return rows.map((r) => r.workspaceId)
}

export async function insertGovernanceAudit(
	tx: Queryable,
	args: {
		readonly workspaceId?: string | null
		readonly actorId: string
		readonly action: string
		readonly targetType?: string
		readonly targetId?: string
		readonly metadata?: Record<string, unknown>
	}
): Promise<void> {
	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${args.workspaceId ?? null},
			'user',
			${args.actorId},
			${args.action},
			${args.targetType ?? null},
			${args.targetId ?? null},
			${tx.json((args.metadata ?? {}) as never)}
		)
	`
}

export async function emitGovernanceOutbox(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly aggregateId: string
		readonly eventType: string
		readonly payload: Record<string, unknown>
	}
): Promise<void> {
	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (
			${args.workspaceId},
			'governance',
			${args.aggregateId},
			${args.eventType},
			${tx.json(args.payload as never)}
		)
	`
}
