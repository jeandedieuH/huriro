/**
 * Mail v2 services (M11 §6.2–§6.4): contacts/organizations, tags,
 * templates/snippets, macros, proactive compose, forward/split, bulk triage,
 * split-inbox settings, routing configuration and SLA policy administration.
 * Functions run inside the caller's tenant transaction; multi-row mutations
 * write conversation events/audit rows in that same transaction.
 */
import type {
	ContactBody,
	ContactOrganizationBody,
	CreateOutboundConversationBody,
	ForwardConversationBody,
	MailBulkTriageBody,
	MailMacroBody,
	MailRoutingConfigBody,
	MailSlaPolicyBody,
	MailTagBody,
	MailTemplateBody,
	SplitConversationBody
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import { type ActorContext, isPlausibleEmail, normalizeEmail, normalizeMailSubject } from '@huriro/domain'
import { insertEntityLink } from '../../api/entity-links'
import { HttpError } from '../../api/error'
import type { PresenceRegistry } from '../../realtime/presence-registry'
import { getUsersAvailabilityMap } from '../availability'
import {
	accessibleInboxIds,
	authorizeMailAccountAction,
	authorizeMailInboxAction,
	authorizeMailWorkspaceAction
} from './policy'
import * as repo from './repo'
import { upsertDraft } from './service'

type Row = Record<string, unknown>

function accountVisibility(account: repo.MailAccountRow): 'workspace' | 'private' {
	return account.config['visibility'] === 'private' ? 'private' : 'workspace'
}

async function requireConversation(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	action: 'mail.read' | 'mail.assign' | 'mail.send'
): Promise<{ conversation: repo.MailConversationRow; account: repo.MailAccountRow }> {
	const conversation = await repo.getMailConversation(tx, actor.workspaceId, conversationId)
	if (!conversation) throw new HttpError(404, 'not_found', 'Conversation not found')
	const account = await repo.getMailAccount(tx, actor.workspaceId, conversation.accountId)
	if (!account) throw new HttpError(404, 'not_found', 'Mail account not found')
	await authorizeMailAccountAction(tx, actor, action, {
		id: account.id,
		visibility: accountVisibility(account)
	})
	const inbox = await repo.getMailInbox(tx, actor.workspaceId, conversation.inboxId)
	if (!inbox) throw new HttpError(404, 'not_found', 'Mail inbox not found')
	await authorizeMailInboxAction(tx, actor, action, inbox)
	return { conversation, account }
}

async function insertAudit(
	tx: Queryable,
	actor: ActorContext,
	action: string,
	targetType: string,
	targetId: string,
	metadata: Record<string, unknown> = {}
): Promise<void> {
	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (${actor.workspaceId}, ${actor.kind}, ${actor.principalId}, ${action}, ${targetType}, ${targetId}, ${tx.json(metadata as never)})
	`
}

async function insertEvent(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	kind: string,
	payload: Record<string, unknown> = {}
): Promise<void> {
	await repo.insertConversationEvent(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		kind,
		actorId: actor.principalId,
		payload
	})
}

// ---------- Contacts & organizations (§6.2) ----------
export async function listContacts(tx: Queryable, actor: ActorContext, query?: string): Promise<Row[]> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	const q = query?.trim()
	if (q) {
		const pattern = `%${q}%`
		return tx<Row[]>`
			SELECT c.id, c.email, c.display_name AS "displayName", c.title, c.phone, c.vip_tier AS "vipTier",
				c.notes, c.metadata, c.organization_id AS "organizationId", o.name AS "organizationName",
				c.version, c.created_at::text AS "createdAt", c.updated_at::text AS "updatedAt"
			FROM contacts c
			LEFT JOIN contact_organizations o ON o.workspace_id = c.workspace_id AND o.id = c.organization_id
			WHERE c.workspace_id = ${actor.workspaceId}
				AND (c.email ILIKE ${pattern} OR c.display_name ILIKE ${pattern} OR o.name ILIKE ${pattern})
			ORDER BY c.updated_at DESC LIMIT 100
		`
	}
	return tx<Row[]>`
		SELECT c.id, c.email, c.display_name AS "displayName", c.title, c.phone, c.vip_tier AS "vipTier",
			c.notes, c.metadata, c.organization_id AS "organizationId", o.name AS "organizationName",
			c.version, c.created_at::text AS "createdAt", c.updated_at::text AS "updatedAt"
		FROM contacts c
		LEFT JOIN contact_organizations o ON o.workspace_id = c.workspace_id AND o.id = c.organization_id
		WHERE c.workspace_id = ${actor.workspaceId}
		ORDER BY c.updated_at DESC LIMIT 100
	`
}

export async function upsertContact(
	tx: Queryable,
	actor: ActorContext,
	input: ContactBody,
	contactId?: string
): Promise<Row> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	const email = normalizeEmail(input.email)
	if (!isPlausibleEmail(email)) throw new HttpError(422, 'validation_failed', 'Invalid contact email')
	const domain = email.split('@')[1] ?? null
	let organizationId = input.organizationId ?? null
	if (!organizationId && domain) {
		const [org] = await tx<{ id: string }[]>`
			SELECT id FROM contact_organizations
			WHERE workspace_id = ${actor.workspaceId} AND domain = ${domain}
		`
		organizationId = org?.id ?? null
	}
	const values = {
		email,
		displayName: input.displayName ?? null,
		title: input.title ?? null,
		phone: input.phone ?? null,
		vipTier: input.vipTier ?? 'standard',
		notes: input.notes ?? '',
		metadata: input.metadata ?? {}
	}
	const [row] = contactId
		? await tx<Row[]>`
			UPDATE contacts
			SET organization_id = ${organizationId}, email = ${email}, display_name = ${values.displayName},
				title = ${values.title}, phone = ${values.phone}, vip_tier = ${values.vipTier},
				notes = ${values.notes}, metadata = ${tx.json(values.metadata as never)}, version = version + 1
			WHERE workspace_id = ${actor.workspaceId} AND id = ${contactId}
			RETURNING id, organization_id AS "organizationId", email, display_name AS "displayName", title, phone,
				vip_tier AS "vipTier", notes, metadata, version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		`
		: await tx<Row[]>`
			INSERT INTO contacts (workspace_id, organization_id, email, display_name, title, phone, vip_tier, notes, metadata)
			VALUES (${actor.workspaceId}, ${organizationId}, ${email}, ${values.displayName}, ${values.title},
				${values.phone}, ${values.vipTier}, ${values.notes}, ${tx.json(values.metadata as never)})
			ON CONFLICT (workspace_id, email) DO UPDATE SET
				display_name = COALESCE(EXCLUDED.display_name, contacts.display_name),
				organization_id = COALESCE(EXCLUDED.organization_id, contacts.organization_id),
				vip_tier = EXCLUDED.vip_tier,
				notes = EXCLUDED.notes,
				metadata = EXCLUDED.metadata,
				version = contacts.version + 1
			RETURNING id, organization_id AS "organizationId", email, display_name AS "displayName", title, phone,
				vip_tier AS "vipTier", notes, metadata, version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		`
	if (!row) throw new HttpError(404, 'not_found', 'Contact not found')
	await insertAudit(
		tx,
		actor,
		contactId ? 'mail.contact.update' : 'mail.contact.upsert',
		'contact',
		String(row['id']),
		{ email }
	)
	return row
}

export async function listContactOrganizations(tx: Queryable, actor: ActorContext): Promise<Row[]> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	return tx<Row[]>`
		SELECT o.id, o.name, o.domain, o.tier, o.notes, o.metadata, o.version,
			o.created_at::text AS "createdAt", o.updated_at::text AS "updatedAt",
			(SELECT count(*)::int FROM contacts c WHERE c.workspace_id = o.workspace_id AND c.organization_id = o.id) AS "contactCount"
		FROM contact_organizations o
		WHERE o.workspace_id = ${actor.workspaceId}
		ORDER BY o.name
	`
}

export async function upsertContactOrganization(
	tx: Queryable,
	actor: ActorContext,
	input: ContactOrganizationBody,
	organizationId?: string
): Promise<Row> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	const domain = input.domain?.trim().toLowerCase() || null
	if (
		domain &&
		['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me'].includes(domain)
	) {
		throw new HttpError(422, 'validation_failed', 'Free webmail domains cannot identify an organization')
	}
	const [row] = organizationId
		? await tx<Row[]>`
			UPDATE contact_organizations
			SET name = ${input.name}, domain = ${domain}, tier = ${input.tier ?? 'standard'}, notes = ${input.notes ?? ''},
				metadata = ${tx.json((input.metadata ?? {}) as never)}, version = version + 1
			WHERE workspace_id = ${actor.workspaceId} AND id = ${organizationId}
			RETURNING id, name, domain, tier, notes, metadata, version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		`
		: await tx<Row[]>`
			INSERT INTO contact_organizations (workspace_id, name, domain, tier, notes, metadata)
			VALUES (${actor.workspaceId}, ${input.name}, ${domain}, ${input.tier ?? 'standard'}, ${input.notes ?? ''},
				${tx.json((input.metadata ?? {}) as never)})
			RETURNING id, name, domain, tier, notes, metadata, version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		`
	if (!row)
		throw new HttpError(409, 'conflict', 'Organization domain already exists or organization is missing')
	await insertAudit(
		tx,
		actor,
		organizationId ? 'mail.organization.update' : 'mail.organization.create',
		'contact_organization',
		String(row['id'])
	)
	return row
}

// ---------- Tags (§6.3) ----------
export async function listMailTags(tx: Queryable, actor: ActorContext, inboxId?: string): Promise<Row[]> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	if (inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.read', inboxId)
		return tx<Row[]>`
			SELECT id, inbox_id AS "inboxId", name, color, version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
			FROM mail_tags
			WHERE workspace_id = ${actor.workspaceId} AND (inbox_id = ${inboxId} OR inbox_id IS NULL)
			ORDER BY name
		`
	}
	const inboxIds = await accessibleInboxIds(tx, actor)
	return tx<Row[]>`
		SELECT id, inbox_id AS "inboxId", name, color, version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		FROM mail_tags
		WHERE workspace_id = ${actor.workspaceId}
			${inboxIds !== null ? tx`AND (inbox_id IS NULL OR inbox_id = ANY(${inboxIds}::uuid[]))` : tx``}
		ORDER BY name
	`
}

export async function createMailTag(tx: Queryable, actor: ActorContext, input: MailTagBody): Promise<Row> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	if (input.inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.assign', input.inboxId)
	}
	const [row] = await tx<Row[]>`
		INSERT INTO mail_tags (workspace_id, inbox_id, name, color, created_by)
		VALUES (${actor.workspaceId}, ${input.inboxId ?? null}, ${input.name.trim()}, ${input.color ?? 'neutral'}, ${actor.userId})
		RETURNING id, inbox_id AS "inboxId", name, color, version, created_at::text AS "createdAt"
	`
	if (!row) throw new HttpError(409, 'conflict', 'Tag already exists')
	await insertAudit(tx, actor, 'mail.tag.create', 'mail_tag', String(row['id']), { name: input.name })
	return row
}

export async function setConversationTags(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	tagIds: readonly string[]
): Promise<{ tagIds: readonly string[] }> {
	await requireConversation(tx, actor, conversationId, 'mail.assign')
	await tx`DELETE FROM mail_conversation_tags WHERE workspace_id = ${actor.workspaceId} AND conversation_id = ${conversationId}`
	for (const tagId of new Set(tagIds)) {
		const [tag] = await tx<{ id: string; name: string }[]>`
			SELECT id, name FROM mail_tags WHERE workspace_id = ${actor.workspaceId} AND id = ${tagId}
		`
		if (!tag) throw new HttpError(404, 'not_found', 'Mail tag not found')
		await tx`
			INSERT INTO mail_conversation_tags (workspace_id, conversation_id, tag_id, created_by)
			VALUES (${actor.workspaceId}, ${conversationId}, ${tagId}, ${actor.userId})
		`
		await insertEvent(tx, actor, conversationId, 'tag_added', { tagId, name: tag.name })
	}
	return { tagIds }
}

export async function listConversationTags(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string
): Promise<Row[]> {
	await requireConversation(tx, actor, conversationId, 'mail.read')
	return tx<Row[]>`
		SELECT t.id, t.name, t.color, t.inbox_id AS "inboxId"
		FROM mail_conversation_tags ct
		JOIN mail_tags t ON t.workspace_id = ct.workspace_id AND t.id = ct.tag_id
		WHERE ct.workspace_id = ${actor.workspaceId} AND ct.conversation_id = ${conversationId}
		ORDER BY t.name
	`
}

// ---------- Templates/snippets (§6.2) ----------
export async function listMailTemplates(
	tx: Queryable,
	actor: ActorContext,
	input: { readonly inboxId?: string | undefined; readonly personal?: boolean | undefined }
): Promise<Row[]> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	if (input.inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.read', input.inboxId)
	}
	const inboxIds = input.inboxId ? null : await accessibleInboxIds(tx, actor)
	return tx<Row[]>`
		SELECT id, inbox_id AS "inboxId", owner_user_id AS "ownerUserId", name, shortcut, body_text AS "bodyText",
			body, body_html AS "bodyHtml", attachment_file_ids AS "attachmentFileIds", merge_variables AS "mergeVariables",
			version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		FROM mail_templates
		WHERE workspace_id = ${actor.workspaceId}
			AND (owner_user_id IS NULL OR owner_user_id = ${actor.userId})
			${input.inboxId ? tx`AND (inbox_id = ${input.inboxId} OR inbox_id IS NULL)` : tx``}
			${inboxIds !== null ? tx`AND (inbox_id IS NULL OR inbox_id = ANY(${inboxIds}::uuid[]))` : tx``}
		ORDER BY shortcut
	`
}

export async function upsertMailTemplate(
	tx: Queryable,
	actor: ActorContext,
	input: MailTemplateBody,
	templateId?: string
): Promise<Row> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	if (input.inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.assign', input.inboxId)
	}
	const ownerUserId = input.ownerUserId === null ? null : (input.ownerUserId ?? null)
	if (ownerUserId && ownerUserId !== actor.userId) {
		throw new HttpError(422, 'validation_failed', 'Personal templates must belong to the current user')
	}
	const inboxId = input.inboxId ?? null
	const attachmentFileIds = input.attachmentFileIds ?? []
	const mergeVariables = tx.json((input.mergeVariables ?? []) as never)
	const bodyJson = tx.json((input.body ?? {}) as never)
	const [row] = templateId
		? await tx<Row[]>`
			UPDATE mail_templates
			SET inbox_id = ${inboxId}::uuid, owner_user_id = ${ownerUserId}::uuid, name = ${input.name}, shortcut = ${input.shortcut},
				body_text = ${input.bodyText}, body = ${bodyJson}, body_html = ${input.bodyHtml ?? null}::text,
				attachment_file_ids = ${attachmentFileIds}::uuid[], merge_variables = ${mergeVariables}, version = version + 1
			WHERE workspace_id = ${actor.workspaceId} AND id = ${templateId}
			RETURNING id, inbox_id AS "inboxId", owner_user_id AS "ownerUserId", name, shortcut, body_text AS "bodyText",
				body, body_html AS "bodyHtml", attachment_file_ids AS "attachmentFileIds", merge_variables AS "mergeVariables",
				version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		`
		: await tx<Row[]>`
			INSERT INTO mail_templates (workspace_id, inbox_id, owner_user_id, name, shortcut, body_text, body, body_html,
				attachment_file_ids, merge_variables, created_by)
			VALUES (${actor.workspaceId}, ${inboxId}::uuid, ${ownerUserId}::uuid, ${input.name}, ${input.shortcut}, ${input.bodyText},
				${bodyJson}, ${input.bodyHtml ?? null}::text, ${attachmentFileIds}::uuid[], ${mergeVariables}, ${actor.userId})
			RETURNING id, inbox_id AS "inboxId", owner_user_id AS "ownerUserId", name, shortcut, body_text AS "bodyText",
				body, body_html AS "bodyHtml", attachment_file_ids AS "attachmentFileIds", merge_variables AS "mergeVariables",
				version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		`
	if (!row) throw new HttpError(409, 'conflict', 'Template shortcut already exists or template is missing')
	await insertAudit(
		tx,
		actor,
		templateId ? 'mail.template.update' : 'mail.template.create',
		'mail_template',
		String(row['id'])
	)
	return row
}

/** Server-side merge expansion keeps snippet semantics identical across web/mobile. */
export async function renderMailTemplate(
	tx: Queryable,
	actor: ActorContext,
	templateId: string,
	variables: Record<string, string>
): Promise<{ bodyText: string; shortcut: string }> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	const [row] = await tx<
		{ bodyText: string; shortcut: string; ownerUserId: string | null; inboxId: string | null }[]
	>`
		SELECT body_text AS "bodyText", shortcut, owner_user_id AS "ownerUserId", inbox_id AS "inboxId"
		FROM mail_templates WHERE workspace_id = ${actor.workspaceId} AND id = ${templateId}
	`
	if (!row || (row.ownerUserId && row.ownerUserId !== actor.userId)) {
		throw new HttpError(404, 'not_found', 'Template not found')
	}
	if (row.inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.read', row.inboxId)
	}
	let bodyText = row.bodyText
	for (const [key, value] of Object.entries(variables)) {
		bodyText = bodyText.replaceAll(`{{${key}}}`, value)
	}
	return { bodyText, shortcut: row.shortcut }
}

// ---------- Macros (§6.2) ----------
export async function listMailMacros(tx: Queryable, actor: ActorContext, inboxId?: string): Promise<Row[]> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	if (inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.read', inboxId)
	}
	const inboxIds = inboxId ? null : await accessibleInboxIds(tx, actor)
	return tx<Row[]>`
		SELECT id, inbox_id AS "inboxId", name, shortcut, steps, version,
			created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		FROM mail_macros
		WHERE workspace_id = ${actor.workspaceId}
			${inboxId ? tx`AND (inbox_id = ${inboxId} OR inbox_id IS NULL)` : tx``}
			${inboxIds !== null ? tx`AND (inbox_id IS NULL OR inbox_id = ANY(${inboxIds}::uuid[]))` : tx``}
		ORDER BY name
	`
}

export async function upsertMailMacro(
	tx: Queryable,
	actor: ActorContext,
	input: MailMacroBody,
	macroId?: string
): Promise<Row> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	if (input.inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.assign', input.inboxId)
	}
	const stepsJson = tx.json(input.steps as never)
	const [row] = macroId
		? await tx<Row[]>`
			UPDATE mail_macros
			SET inbox_id = ${input.inboxId ?? null}, name = ${input.name}, shortcut = ${input.shortcut ?? null},
				steps = ${stepsJson}, version = version + 1
			WHERE workspace_id = ${actor.workspaceId} AND id = ${macroId}
			RETURNING id, inbox_id AS "inboxId", name, shortcut, steps, version,
				created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		`
		: await tx<Row[]>`
			INSERT INTO mail_macros (workspace_id, inbox_id, name, shortcut, steps, created_by)
			VALUES (${actor.workspaceId}, ${input.inboxId ?? null}, ${input.name}, ${input.shortcut ?? null}, ${stepsJson}, ${actor.userId})
			RETURNING id, inbox_id AS "inboxId", name, shortcut, steps, version,
				created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		`
	if (!row) throw new HttpError(409, 'conflict', 'Macro shortcut already exists or macro is missing')
	await insertAudit(
		tx,
		actor,
		macroId ? 'mail.macro.update' : 'mail.macro.create',
		'mail_macro',
		String(row['id'])
	)
	return row
}

export async function applyMailMacro(
	tx: Queryable,
	actor: ActorContext,
	macroId: string,
	conversationIds: readonly string[]
): Promise<{ appliedCount: number }> {
	const [macro] = await tx<{ steps: { action: string; value?: string; minutes?: number }[] }[]>`
		SELECT steps FROM mail_macros WHERE workspace_id = ${actor.workspaceId} AND id = ${macroId}
	`
	if (!macro) throw new HttpError(404, 'not_found', 'Macro not found')
	let appliedCount = 0
	for (const conversationId of conversationIds) {
		await requireConversation(tx, actor, conversationId, 'mail.assign')
		for (const step of macro.steps) {
			if (step.action === 'set_status' && step.value) {
				await tx`UPDATE mail_conversations SET status = ${step.value}, version = version + 1 WHERE workspace_id = ${actor.workspaceId} AND id = ${conversationId}`
				await insertEvent(tx, actor, conversationId, 'macro_status', { macroId, status: step.value })
			} else if (step.action === 'assign') {
				await tx`UPDATE mail_conversations SET assignee_id = ${step.value ?? null}::uuid, version = version + 1 WHERE workspace_id = ${actor.workspaceId} AND id = ${conversationId}`
				await insertEvent(tx, actor, conversationId, step.value ? 'assigned' : 'unassigned', {
					macroId,
					assigneeId: step.value ?? null
				})
			} else if (step.action === 'add_tag' && step.value) {
				await tx`INSERT INTO mail_conversation_tags (workspace_id, conversation_id, tag_id, created_by) VALUES (${actor.workspaceId}, ${conversationId}, ${step.value}, ${actor.userId}) ON CONFLICT DO NOTHING`
				await insertEvent(tx, actor, conversationId, 'tag_added', { macroId, tagId: step.value })
			} else if (step.action === 'remove_tag' && step.value) {
				await tx`DELETE FROM mail_conversation_tags WHERE workspace_id = ${actor.workspaceId} AND conversation_id = ${conversationId} AND tag_id = ${step.value}`
				await insertEvent(tx, actor, conversationId, 'tag_removed', { macroId, tagId: step.value })
			} else if (step.action === 'set_follow_up' && step.minutes) {
				await tx`
						UPDATE mail_conversations
						SET follow_up_at = now() + (${step.minutes}::text || ' minutes')::interval,
							follow_up_condition = COALESCE(follow_up_condition, 'if_no_reply'),
							follow_up_completed_at = NULL,
							version = version + 1
						WHERE workspace_id = ${actor.workspaceId} AND id = ${conversationId}
					`
				await insertEvent(tx, actor, conversationId, 'follow_up_set', { macroId, minutes: step.minutes })
			} else if (step.action === 'insert_template' && step.value) {
				const rendered = await renderMailTemplate(tx, actor, step.value, {})
				const { conversation } = await requireConversation(tx, actor, conversationId, 'mail.send')
				const [identity] = await tx<{ id: string }[]>`
						SELECT id FROM mail_identities
						WHERE workspace_id = ${actor.workspaceId} AND account_id = ${conversation.accountId}
						ORDER BY is_default DESC, created_at ASC LIMIT 1
					`
				if (identity && conversation.customerEmail) {
					await upsertDraft(tx, actor, conversationId, {
						identityId: identity.id,
						recipients: { to: [{ email: conversation.customerEmail }] },
						bodyText: rendered.bodyText
					})
				}
			}
		}
		appliedCount++
	}
	await insertAudit(tx, actor, 'mail.macro.apply', 'mail_macro', macroId, { conversationIds, appliedCount })
	return { appliedCount }
}

// ---------- Proactive compose, forwarding, split (§6.2) ----------
async function createConversationShell(
	tx: Queryable,
	actor: ActorContext,
	input: {
		readonly inboxId: string
		readonly subject: string
		readonly customerEmail: string
		readonly assigneeId?: string | undefined
		readonly identityId?: string | undefined
		readonly accountId?: string | undefined
	}
): Promise<repo.MailConversationRow> {
	const inbox = await repo.getMailInbox(tx, actor.workspaceId, input.inboxId)
	if (!inbox) throw new HttpError(404, 'not_found', 'Mail inbox not found')
	await authorizeMailInboxAction(tx, actor, 'mail.send', inbox)
	const account = input.identityId
		? await repo.getMailIdentity(tx, actor.workspaceId, input.identityId).then(async (identity) => {
				if (!identity) return null
				return repo.getMailAccount(tx, actor.workspaceId, identity.accountId)
			})
		: input.accountId
			? await repo.getMailAccount(tx, actor.workspaceId, input.accountId)
			: null
	if (!account) throw new HttpError(404, 'not_found', 'Mail account not found')
	await authorizeMailAccountAction(tx, actor, 'mail.send', {
		id: account.id,
		visibility: accountVisibility(account)
	})
	const normalized = normalizeMailSubject(input.subject)
	const [row] = await tx<repo.MailConversationRow[]>`
		INSERT INTO mail_conversations (
			workspace_id, inbox_id, account_id, subject, normalized_subject, status, priority,
			assignee_id, customer_email, last_message_at
		) VALUES (
			${actor.workspaceId}, ${input.inboxId}, ${account.id}, ${input.subject}, ${normalized}, 'open', 'normal',
			${input.assigneeId ?? actor.userId}, ${normalizeEmail(input.customerEmail)}, now()
		)
		RETURNING id, workspace_id AS "workspaceId", inbox_id AS "inboxId", account_id AS "accountId",
			subject, normalized_subject AS "normalizedSubject", status, assignee_id AS "assigneeId",
			snoozed_until AS "snoozedUntil", merged_into_id AS "mergedIntoId",
			last_message_at AS "lastMessageAt", first_reply_at AS "firstReplyAt",
			customer_email AS "customerEmail", contact_id AS "contactId",
			follow_up_at AS "followUpAt", follow_up_condition AS "followUpCondition",
			sla_next_due_at AS "slaNextDueAt", sla_breached_at AS "slaBreachedAt", priority,
			created_at AS "createdAt", updated_at AS "updatedAt", version
	`
	if (!row) throw new HttpError(500, 'internal', 'Conversation creation failed')
	return row
}

export async function createOutboundConversation(
	tx: Queryable,
	actor: ActorContext,
	input: CreateOutboundConversationBody
): Promise<{ conversationId: string; draft: unknown }> {
	const primary = input.recipients.to[0]?.email
	if (!primary || !isPlausibleEmail(primary))
		throw new HttpError(422, 'validation_failed', 'A valid recipient is required')
	const conversation = await createConversationShell(tx, actor, {
		inboxId: input.inboxId,
		subject: input.subject,
		customerEmail: primary,
		assigneeId: input.assigneeId ?? undefined,
		identityId: input.identityId
	})
	const draft = await upsertDraft(tx, actor, conversation.id, {
		identityId: input.identityId,
		recipients: input.recipients,
		bodyText: input.bodyText,
		...(input.body !== undefined ? { body: input.body } : {}),
		...(input.collabEnabled !== undefined ? { collabEnabled: input.collabEnabled } : {}),
		...(input.scheduledSendAt !== undefined ? { scheduledSendAt: input.scheduledSendAt } : {}),
		...(input.attachmentFileIds !== undefined ? { attachmentFileIds: input.attachmentFileIds } : {})
	})
	if (input.followUpAt || input.scheduledSendAt) {
		await tx`
			UPDATE mail_conversations
			SET follow_up_at = ${input.followUpAt ?? null}::timestamptz,
				follow_up_condition = ${input.followUpCondition ?? null},
				version = version + 1
			WHERE workspace_id = ${actor.workspaceId} AND id = ${conversation.id}
		`
	}
	await insertEvent(tx, actor, conversation.id, 'outbound_started', {})
	await insertAudit(tx, actor, 'mail.outbound.create', 'mail_conversation', conversation.id, {
		subject: input.subject
	})
	return { conversationId: conversation.id, draft }
}

export async function forwardConversation(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	input: ForwardConversationBody
): Promise<{ conversationId: string; draft: unknown }> {
	const { conversation } = await requireConversation(tx, actor, conversationId, 'mail.read')
	const primary = input.recipients.to[0]?.email
	if (!primary) throw new HttpError(422, 'validation_failed', 'A valid recipient is required')
	const shell = await createConversationShell(tx, actor, {
		inboxId: conversation.inboxId,
		subject: `Fwd: ${conversation.subject}`,
		customerEmail: primary,
		identityId: input.identityId
	})
	let bodyText = input.bodyText
	if (input.includeHistory !== false) {
		const messages = await repo.listConversationMessages(tx, actor.workspaceId, conversationId)
		const history = messages
			.map(
				(m) =>
					`\n--- ${m.direction} ${m.sentAt ?? m.receivedAt} ${m.fromAddr.email} ---\n${m.bodyText ?? m.snippet}`
			)
			.join('\n')
		bodyText = `${input.bodyText}\n\n${history}`
	}
	const draft = await upsertDraft(tx, actor, shell.id, {
		identityId: input.identityId,
		recipients: input.recipients,
		bodyText,
		...(input.scheduledSendAt !== undefined ? { scheduledSendAt: input.scheduledSendAt } : {}),
		...(input.attachmentFileIds !== undefined ? { attachmentFileIds: input.attachmentFileIds } : {})
	})
	if (input.followUpAt) {
		await tx`
			UPDATE mail_conversations
			SET follow_up_at = ${input.followUpAt}::timestamptz,
				follow_up_condition = ${input.followUpCondition ?? 'if_no_reply'},
				version = version + 1
			WHERE workspace_id = ${actor.workspaceId} AND id = ${shell.id}
		`
	}
	await insertEntityLink(tx, {
		workspaceId: actor.workspaceId,
		sourceType: 'mail_conversation',
		sourceId: shell.id,
		targetType: 'mail_conversation',
		targetId: conversationId,
		relationKind: 'references',
		createdBy: actor.principalId
	})
	await insertEvent(tx, actor, shell.id, 'forwarded_from', { sourceConversationId: conversationId })
	return { conversationId: shell.id, draft }
}

export async function splitConversation(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	input: SplitConversationBody
): Promise<{ conversationId: string }> {
	const { conversation } = await requireConversation(tx, actor, conversationId, 'mail.assign')
	const [message] = await tx<
		{ id: string; receivedAt: string; fromAddr: string | null; sentAt: string | null }[]
	>`
		SELECT id, received_at::text AS "receivedAt", from_addr AS "fromAddr", sent_at::text AS "sentAt"
		FROM mail_messages
		WHERE workspace_id = ${actor.workspaceId} AND conversation_id = ${conversationId} AND id = ${input.messageId}
	`
	if (!message) throw new HttpError(404, 'not_found', 'Split message not found')
	const shell = await createConversationShell(tx, actor, {
		inboxId: conversation.inboxId,
		subject: input.subject ?? conversation.subject,
		customerEmail: conversation.customerEmail ?? message.fromAddr ?? 'unknown@example.invalid',
		assigneeId: conversation.assigneeId ?? undefined,
		accountId: conversation.accountId
	})
	// Move the selected message and every later message so threading remains contiguous.
	const moved = await tx<{ id: string }[]>`
		UPDATE mail_messages
		SET conversation_id = ${shell.id}
		WHERE workspace_id = ${actor.workspaceId}
			AND conversation_id = ${conversationId}
			AND received_at >= ${message.receivedAt}::timestamptz
		RETURNING id
	`
	if (!moved.length) throw new HttpError(409, 'conflict', 'No messages available to split')
	await insertEvent(tx, actor, conversationId, 'split_out', {
		newConversationId: shell.id,
		messageCount: moved.length
	})
	await insertEvent(tx, actor, shell.id, 'split_from', {
		sourceConversationId: conversationId,
		messageCount: moved.length
	})
	await insertAudit(tx, actor, 'mail.conversation.split', 'mail_conversation', conversationId, {
		newConversationId: shell.id,
		messageCount: moved.length
	})
	return { conversationId: shell.id }
}

// ---------- Bulk triage and split-inbox settings (§6.3) ----------
export async function bulkTriageConversations(
	tx: Queryable,
	actor: ActorContext,
	input: MailBulkTriageBody
): Promise<{ updatedCount: number }> {
	let updatedCount = 0
	for (const conversationId of input.conversationIds) {
		await requireConversation(tx, actor, conversationId, 'mail.assign')
		const changed: string[] = []
		if (input.status) {
			await tx`UPDATE mail_conversations SET status = ${input.status}, version = version + 1 WHERE workspace_id = ${actor.workspaceId} AND id = ${conversationId}`
			changed.push('status')
		}
		if (input.assigneeId !== undefined) {
			await tx`UPDATE mail_conversations SET assignee_id = ${input.assigneeId}::uuid, version = version + 1 WHERE workspace_id = ${actor.workspaceId} AND id = ${conversationId}`
			changed.push('assignee')
		}
		for (const tagId of input.addTagIds ?? []) {
			await tx`INSERT INTO mail_conversation_tags (workspace_id, conversation_id, tag_id, created_by) VALUES (${actor.workspaceId}, ${conversationId}, ${tagId}, ${actor.userId}) ON CONFLICT DO NOTHING`
			changed.push('tag_added')
		}
		for (const tagId of input.removeTagIds ?? []) {
			await tx`DELETE FROM mail_conversation_tags WHERE workspace_id = ${actor.workspaceId} AND conversation_id = ${conversationId} AND tag_id = ${tagId}`
			changed.push('tag_removed')
		}
		if (changed.length) {
			await insertEvent(tx, actor, conversationId, 'bulk_triaged', { changes: changed })
			updatedCount++
		}
	}
	await insertAudit(
		tx,
		actor,
		'mail.conversation.bulk_triage',
		'mail_conversation',
		input.conversationIds[0] ?? '',
		{
			conversationIds: input.conversationIds,
			updatedCount
		}
	)
	return { updatedCount }
}

export async function updateInboxSettings(
	tx: Queryable,
	actor: ActorContext,
	inboxId: string,
	input: { readonly settings: Record<string, unknown>; readonly expectedVersion: number }
): Promise<Row> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	await authorizeMailInboxAction(tx, actor, 'mail.assign', inboxId)
	const [row] = await tx<Row[]>`
		UPDATE mail_inboxes
		SET settings = ${tx.json(input.settings as never)}, version = version + 1
		WHERE workspace_id = ${actor.workspaceId} AND id = ${inboxId} AND version = ${input.expectedVersion}
		RETURNING id, name, position, settings, visibility, owner_user_id AS "ownerUserId",
			version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
	`
	if (!row) throw new HttpError(409, 'conflict', 'Inbox was modified — reload and retry')
	await insertAudit(tx, actor, 'mail.inbox.settings_update', 'mail_inbox', inboxId)
	return row
}

// ---------- Routing configuration (§6.4) ----------
export async function getMailRoutingConfig(
	tx: Queryable,
	actor: ActorContext,
	inboxId: string
): Promise<Record<string, unknown>> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	await authorizeMailInboxAction(tx, actor, 'mail.read', inboxId)
	const [row] = await tx<
		{
			enabled: boolean
			maxOpenCap: number
			requireOnline: boolean
			respectDnd: boolean
			respectWorkingHours: boolean
			respectOoo: boolean
			useOooDelegate: boolean
		}[]
	>`
		SELECT enabled, max_open_cap AS "maxOpenCap", require_online AS "requireOnline",
			respect_dnd AS "respectDnd", respect_working_hours AS "respectWorkingHours",
			respect_ooo AS "respectOoo", use_ooo_delegate AS "useOooDelegate"
		FROM mail_inbox_routing_state WHERE workspace_id = ${actor.workspaceId} AND inbox_id = ${inboxId}
	`
	return (
		row ?? {
			enabled: false,
			maxOpenCap: 10,
			requireOnline: true,
			respectDnd: true,
			respectWorkingHours: false,
			respectOoo: true,
			useOooDelegate: true
		}
	)
}

export async function upsertMailRoutingConfig(
	tx: Queryable,
	actor: ActorContext,
	inboxId: string,
	input: MailRoutingConfigBody
): Promise<Record<string, unknown>> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	const inbox = await repo.getMailInbox(tx, actor.workspaceId, inboxId)
	if (!inbox) throw new HttpError(404, 'not_found', 'Mail inbox not found')
	await authorizeMailInboxAction(tx, actor, 'mail.assign', inbox)
	const config = {
		enabled: input.enabled,
		maxOpenCap: input.maxOpenCap ?? 10,
		requireOnline: input.requireOnline ?? true,
		respectDnd: input.respectDnd ?? true,
		respectWorkingHours: input.respectWorkingHours ?? false,
		respectOoo: input.respectOoo ?? true,
		useOooDelegate: input.useOooDelegate ?? true
	}
	await tx`
		INSERT INTO mail_inbox_routing_state (
			workspace_id, inbox_id, enabled, max_open_cap, require_online, respect_dnd,
			respect_working_hours, respect_ooo, use_ooo_delegate
		)
		VALUES (
			${actor.workspaceId}, ${inboxId}, ${config.enabled}, ${config.maxOpenCap}, ${config.requireOnline},
			${config.respectDnd}, ${config.respectWorkingHours}, ${config.respectOoo}, ${config.useOooDelegate}
		)
		ON CONFLICT (workspace_id, inbox_id) DO UPDATE SET
			enabled = EXCLUDED.enabled,
			max_open_cap = EXCLUDED.max_open_cap,
			require_online = EXCLUDED.require_online,
			respect_dnd = EXCLUDED.respect_dnd,
			respect_working_hours = EXCLUDED.respect_working_hours,
			respect_ooo = EXCLUDED.respect_ooo,
			use_ooo_delegate = EXCLUDED.use_ooo_delegate
	`
	await insertAudit(tx, actor, 'mail.routing.configure', 'mail_inbox', inboxId, config)
	return config
}

/**
 * Deterministic round-robin assignment used by automation/ingest paths. WIP
 * capacity is the assignee's open conversation count for the same inbox;
 * DND/online preferences live in user_workspace_profiles (M11 chat status).
 */
export async function routeConversationRoundRobin(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	presence?: PresenceRegistry
): Promise<{ assignedUserId: string | null }> {
	const { conversation } = await requireConversation(tx, actor, conversationId, 'mail.assign')
	const [state] = await tx<
		{
			enabled: boolean
			maxOpenCap: number
			requireOnline: boolean
			respectDnd: boolean
			respectWorkingHours: boolean
			respectOoo: boolean
			useOooDelegate: boolean
			cursor: string | null
		}[]
	>`
		SELECT enabled, max_open_cap AS "maxOpenCap", require_online AS "requireOnline",
			respect_dnd AS "respectDnd", respect_working_hours AS "respectWorkingHours",
			respect_ooo AS "respectOoo", use_ooo_delegate AS "useOooDelegate",
			last_assigned_user_id AS "cursor"
		FROM mail_inbox_routing_state
		WHERE workspace_id = ${actor.workspaceId} AND inbox_id = ${conversation.inboxId}
	`
	if (!state?.enabled) return { assignedUserId: null }
	const maxOpenCap = state.maxOpenCap
	const members = await tx<{ userId: string; openCount: number }[]>`
		SELECT m.user_id AS "userId",
			(SELECT count(*)::int FROM mail_conversations c
				WHERE c.workspace_id = m.workspace_id AND c.inbox_id = ${conversation.inboxId}
					AND c.assignee_id = m.user_id AND c.status IN ('open','pending')
					AND c.id <> ${conversationId}) AS "openCount"
		FROM memberships m
		JOIN roles r ON r.workspace_id = m.workspace_id AND r.id = m.role_id
		WHERE m.workspace_id = ${actor.workspaceId} AND m.status = 'active'
			AND r.key <> 'guest'
			AND EXISTS (
				SELECT 1 FROM role_permissions rp
				WHERE rp.workspace_id = m.workspace_id AND rp.role_id = m.role_id AND rp.permission = 'mail.assign'
			)
		ORDER BY m.user_id
	`
	const availability = await getUsersAvailabilityMap(
		tx,
		actor.workspaceId,
		members.map((member) => member.userId),
		presence
	)
	const memberIds = new Set(members.map((member) => member.userId))
	// When no realtime node has reported presence (e.g. a worker-only process),
	// requireOnline must not starve routing — fall back to durable availability.
	const presenceKnown = presence
		? members.some((member) => presence.getStatus(actor.workspaceId, member.userId) !== 'offline')
		: false

	type Candidate = { readonly userId: string; readonly openCount: number; readonly delegatedFrom?: string }
	const byId = new Map<string, Candidate>()
	for (const member of members) {
		if (member.openCount >= maxOpenCap) continue
		const resolved = availability.get(member.userId)
		if (resolved) {
			if (state.respectDnd && resolved.state === 'dnd') continue
			if (state.respectWorkingHours && !resolved.withinWorkingHours) continue
			if (state.requireOnline && presenceKnown && !presence?.isOnline(actor.workspaceId, member.userId)) {
				continue
			}
			if (state.respectOoo && resolved.state === 'ooo') {
				if (state.useOooDelegate && resolved.delegateUserId && memberIds.has(resolved.delegateUserId)) {
					const delegate = members.find((candidate) => candidate.userId === resolved.delegateUserId)
					if (delegate && delegate.openCount < maxOpenCap) {
						byId.set(delegate.userId, {
							userId: delegate.userId,
							openCount: delegate.openCount,
							delegatedFrom: member.userId
						})
					}
				}
				continue
			}
		}
		byId.set(member.userId, { userId: member.userId, openCount: member.openCount })
	}
	const eligible = [...byId.values()].sort((a, b) => a.userId.localeCompare(b.userId))
	if (!eligible.length) return { assignedUserId: null }
	const cursor = state.cursor ?? ''
	const start = eligible.findIndex((m) => m.userId > cursor)
	const selected = eligible[Math.max(start, 0)] ?? eligible[0]
	if (!selected) return { assignedUserId: null }
	await tx`UPDATE mail_conversations SET assignee_id = ${selected.userId}, version = version + 1 WHERE workspace_id = ${actor.workspaceId} AND id = ${conversationId}`
	await tx`UPDATE mail_inbox_routing_state SET last_assigned_user_id = ${selected.userId} WHERE workspace_id = ${actor.workspaceId} AND inbox_id = ${conversation.inboxId}`
	await insertEvent(tx, actor, conversationId, 'assigned', {
		assigneeId: selected.userId,
		routing: 'round_robin',
		...(selected.delegatedFrom ? { delegatedFrom: selected.delegatedFrom } : {})
	})
	return { assignedUserId: selected.userId }
}

/** Route the oldest unassigned open conversation in an inbox (automation action). */
export async function routeNextConversationInInbox(
	tx: Queryable,
	actor: ActorContext,
	inboxId: string,
	presence?: PresenceRegistry
): Promise<{ conversationId: string | null; assignedUserId: string | null }> {
	const [row] = await tx<{ id: string }[]>`
		SELECT id
		FROM mail_conversations
		WHERE workspace_id = ${actor.workspaceId}
			AND inbox_id = ${inboxId}
			AND assignee_id IS NULL
			AND status IN ('open', 'pending')
		ORDER BY created_at ASC
		LIMIT 1
	`
	if (!row) return { conversationId: null, assignedUserId: null }
	const routed = await routeConversationRoundRobin(tx, actor, row.id, presence)
	return { conversationId: row.id, assignedUserId: routed.assignedUserId }
}

// ---------- SLA policies and analytics (§6.4) ----------
export async function listMailSlaPolicies(
	tx: Queryable,
	actor: ActorContext,
	inboxId?: string
): Promise<Row[]> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	if (inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.read', inboxId)
	}
	const inboxIds = inboxId ? null : await accessibleInboxIds(tx, actor)
	return tx<Row[]>`
		SELECT id, inbox_id AS "inboxId", tag_id AS "tagId", name, first_reply_minutes AS "firstReplyMinutes",
			next_reply_minutes AS "nextReplyMinutes", resolution_minutes AS "resolutionMinutes",
			business_hours AS "businessHours", active, version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		FROM mail_sla_policies
		WHERE workspace_id = ${actor.workspaceId}
			${inboxId ? tx`AND (inbox_id = ${inboxId} OR inbox_id IS NULL)` : tx``}
			${inboxIds !== null ? tx`AND (inbox_id IS NULL OR inbox_id = ANY(${inboxIds}::uuid[]))` : tx``}
		ORDER BY name
	`
}

export async function upsertMailSlaPolicy(
	tx: Queryable,
	actor: ActorContext,
	input: MailSlaPolicyBody,
	policyId?: string
): Promise<Row> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	if (input.inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.assign', input.inboxId)
	}
	const businessHours = tx.json((input.businessHours ?? {}) as never)
	const active = input.active ?? true
	const [row] = policyId
		? await tx<Row[]>`
			UPDATE mail_sla_policies
			SET inbox_id = ${input.inboxId ?? null}, tag_id = ${input.tagId ?? null}, name = ${input.name},
				first_reply_minutes = ${input.firstReplyMinutes ?? null}, next_reply_minutes = ${input.nextReplyMinutes ?? null},
				resolution_minutes = ${input.resolutionMinutes ?? null}, business_hours = ${businessHours}, active = ${active}, version = version + 1
			WHERE workspace_id = ${actor.workspaceId} AND id = ${policyId}
			RETURNING id, inbox_id AS "inboxId", tag_id AS "tagId", name, first_reply_minutes AS "firstReplyMinutes",
				next_reply_minutes AS "nextReplyMinutes", resolution_minutes AS "resolutionMinutes",
				business_hours AS "businessHours", active, version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		`
		: await tx<Row[]>`
			INSERT INTO mail_sla_policies (workspace_id, inbox_id, tag_id, name, first_reply_minutes, next_reply_minutes,
				resolution_minutes, business_hours, active, created_by)
			VALUES (${actor.workspaceId}, ${input.inboxId ?? null}, ${input.tagId ?? null}, ${input.name},
				${input.firstReplyMinutes ?? null}, ${input.nextReplyMinutes ?? null}, ${input.resolutionMinutes ?? null},
				${businessHours}, ${active}, ${actor.userId})
			RETURNING id, inbox_id AS "inboxId", tag_id AS "tagId", name, first_reply_minutes AS "firstReplyMinutes",
				next_reply_minutes AS "nextReplyMinutes", resolution_minutes AS "resolutionMinutes",
				business_hours AS "businessHours", active, version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		`
	if (!row) throw new HttpError(404, 'not_found', 'SLA policy not found')
	await insertAudit(
		tx,
		actor,
		policyId ? 'mail.sla_policy.update' : 'mail.sla_policy.create',
		'mail_sla_policy',
		String(row['id'])
	)
	return row
}

/** SLA analytics use elapsed wall-clock minutes; business-hour compression is a later refinement. */
export async function mailSlaAnalytics(tx: Queryable, actor: ActorContext, inboxId?: string): Promise<Row> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	if (inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.read', inboxId)
	}
	const inboxIds = inboxId ? null : await accessibleInboxIds(tx, actor)
	const [row] = await tx<Row[]>`
		SELECT
			count(*)::int AS "conversationCount",
			count(*) FILTER (WHERE first_reply_at IS NOT NULL)::int AS "repliedCount",
			round(avg(EXTRACT(EPOCH FROM (first_reply_at - created_at)) / 60) FILTER (WHERE first_reply_at IS NOT NULL))::float AS "avgFirstReplyMinutes",
			round(avg(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60) FILTER (WHERE status = 'closed'))::float AS "avgResolutionMinutes",
			count(*) FILTER (WHERE sla_breached_at IS NOT NULL)::int AS "breachedCount"
		FROM mail_conversations
		WHERE workspace_id = ${actor.workspaceId}
			${inboxId ? tx`AND inbox_id = ${inboxId}` : tx``}
			${inboxIds !== null ? tx`AND inbox_id = ANY(${inboxIds}::uuid[])` : tx``}
	`
	return row ?? {}
}

// ---------- Delete helpers (M11 settings CRUD) ----------

export async function deleteMailTag(tx: Queryable, actor: ActorContext, tagId: string): Promise<void> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	const [existing] = await tx<{ id: string; inboxId: string | null }[]>`
		SELECT id, inbox_id AS "inboxId" FROM mail_tags
		WHERE workspace_id = ${actor.workspaceId} AND id = ${tagId}
	`
	if (!existing) throw new HttpError(404, 'not_found', 'Mail tag not found')
	if (existing.inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.assign', existing.inboxId)
	}
	await tx`DELETE FROM mail_tags WHERE workspace_id = ${actor.workspaceId} AND id = ${tagId}`
	await insertAudit(tx, actor, 'mail.tag.delete', 'mail_tag', tagId)
}

export async function deleteMailTemplate(
	tx: Queryable,
	actor: ActorContext,
	templateId: string
): Promise<void> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	const [existing] = await tx<{ id: string; inboxId: string | null; ownerUserId: string | null }[]>`
		SELECT id, inbox_id AS "inboxId", owner_user_id AS "ownerUserId" FROM mail_templates
		WHERE workspace_id = ${actor.workspaceId} AND id = ${templateId}
	`
	if (!existing) throw new HttpError(404, 'not_found', 'Template not found')
	if (existing.ownerUserId && existing.ownerUserId !== actor.userId) {
		throw new HttpError(403, 'insufficient_role', 'Cannot delete another user personal template')
	}
	if (existing.inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.assign', existing.inboxId)
	}
	await tx`DELETE FROM mail_templates WHERE workspace_id = ${actor.workspaceId} AND id = ${templateId}`
	await insertAudit(tx, actor, 'mail.template.delete', 'mail_template', templateId)
}

export async function deleteMailMacro(tx: Queryable, actor: ActorContext, macroId: string): Promise<void> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	const [existing] = await tx<{ id: string; inboxId: string | null }[]>`
		SELECT id, inbox_id AS "inboxId" FROM mail_macros
		WHERE workspace_id = ${actor.workspaceId} AND id = ${macroId}
	`
	if (!existing) throw new HttpError(404, 'not_found', 'Macro not found')
	if (existing.inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.assign', existing.inboxId)
	}
	await tx`DELETE FROM mail_macros WHERE workspace_id = ${actor.workspaceId} AND id = ${macroId}`
	await insertAudit(tx, actor, 'mail.macro.delete', 'mail_macro', macroId)
}

export async function deleteMailSlaPolicy(
	tx: Queryable,
	actor: ActorContext,
	policyId: string
): Promise<void> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	const [existing] = await tx<{ id: string; inboxId: string | null }[]>`
		SELECT id, inbox_id AS "inboxId" FROM mail_sla_policies
		WHERE workspace_id = ${actor.workspaceId} AND id = ${policyId}
	`
	if (!existing) throw new HttpError(404, 'not_found', 'SLA policy not found')
	if (existing.inboxId) {
		await authorizeMailInboxAction(tx, actor, 'mail.assign', existing.inboxId)
	}
	await tx`DELETE FROM mail_sla_policies WHERE workspace_id = ${actor.workspaceId} AND id = ${policyId}`
	await insertAudit(tx, actor, 'mail.sla_policy.delete', 'mail_sla_policy', policyId)
}
