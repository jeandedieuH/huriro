import type { SearchEntityType, SearchHitDto } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import type { ParsedSearchQuery } from '@huriro/domain'

export async function claimSearchOutboxEvent(
	tx: Queryable,
	consumer: string,
	eventId: string
): Promise<boolean> {
	const rows = await tx<{ eventId: string }[]>`
		INSERT INTO processed_events (consumer, event_id)
		VALUES (${consumer}, ${eventId})
		ON CONFLICT (consumer, event_id) DO NOTHING
		RETURNING event_id AS "eventId"
	`
	return rows.length > 0
}

export async function upsertSearchDocument(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly entityType: SearchEntityType
		readonly entityId: string
		readonly projectId: string | null
		readonly containerId: string | null
		readonly identifier: string | null
		readonly title: string
		readonly body: string
		readonly metadata?: Record<string, unknown> | undefined
	}
): Promise<void> {
	await tx`
		INSERT INTO search_documents (
			workspace_id, entity_type, entity_id, project_id, container_id, identifier, title, body, metadata
		)
		VALUES (
			${args.workspaceId},
			${args.entityType},
			${args.entityId},
			${args.projectId},
			${args.containerId},
			${args.identifier},
			${args.title},
			${args.body},
			${tx.json((args.metadata ?? {}) as never)}
		)
		ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE
		SET project_id = EXCLUDED.project_id,
			container_id = EXCLUDED.container_id,
			identifier = EXCLUDED.identifier,
			title = EXCLUDED.title,
			body = EXCLUDED.body,
			metadata = EXCLUDED.metadata,
			updated_at = now()
	`
}

export async function deleteSearchDocument(
	tx: Queryable,
	workspaceId: string,
	entityType: SearchEntityType,
	entityId: string
): Promise<void> {
	await tx`
		DELETE FROM search_documents
		WHERE workspace_id = ${workspaceId}
			AND entity_type = ${entityType}
			AND entity_id = ${entityId}
	`
}

function findMatchedBlockId(metadata: Record<string, unknown> | undefined, queryText: string): string | null {
	if (!metadata || !queryText) return null
	const tokens = queryText
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length >= 2)
	if (tokens.length === 0) return null

	const blocks = Array.isArray(metadata['blocks']) ? metadata['blocks'] : []
	for (const b of blocks) {
		if (!b || typeof b !== 'object') continue
		const rec = b as Record<string, unknown>
		const blockId = typeof rec['blockId'] === 'string' ? rec['blockId'] : null
		const text = typeof rec['text'] === 'string' ? rec['text'].toLowerCase() : ''
		if (blockId && tokens.some((tok) => text.includes(tok))) {
			return blockId
		}
	}

	const headings = Array.isArray(metadata['headings']) ? metadata['headings'] : []
	for (const h of headings) {
		if (!h || typeof h !== 'object') continue
		const rec = h as Record<string, unknown>
		const blockId = typeof rec['blockId'] === 'string' ? rec['blockId'] : null
		const text = typeof rec['text'] === 'string' ? rec['text'].toLowerCase() : ''
		if (blockId && tokens.some((tok) => text.includes(tok))) {
			return blockId
		}
	}
	return null
}

export async function executeSearchQuery(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly userId: string
		readonly isGuest: boolean
		readonly bypassAcl: boolean
		readonly parsed: ParsedSearchQuery
		readonly limit: number
	}
): Promise<SearchHitDto[]> {
	const p = args.parsed
	const exactIdentifier = p.issueIdentifier
		? `${p.issueIdentifier.projectKey}-${p.issueIdentifier.number}`
		: null
	const textQuery = p.freeText.trim()

	if (!textQuery && !exactIdentifier && !p.projectKey && !p.state && p.priority === null && !p.entityType) {
		return []
	}

	const rows = await tx<
		{
			entityType: SearchEntityType
			entityId: string
			projectId: string | null
			identifier: string | null
			title: string
			snippet: string
			metadata: Record<string, unknown>
			score: number
			updatedAt: string
		}[]
	>`
		WITH filtered AS (
			SELECT
				sd.entity_type,
				sd.entity_id,
				sd.project_id,
				sd.container_id,
				sd.identifier,
				sd.title,
				sd.body,
				sd.metadata,
				sd.tsv,
				sd.updated_at,
				CASE
					WHEN ${textQuery} <> '' THEN ts_rank_cd(sd.tsv, websearch_to_tsquery('simple', ${textQuery}))
					ELSE 0
				END AS fts_rank,
				CASE
					WHEN ${textQuery} <> '' THEN similarity(sd.title, ${textQuery})
					ELSE 0
				END AS trgm_sim,
				CASE
					WHEN ${exactIdentifier}::text IS NOT NULL AND upper(sd.identifier) = upper(${exactIdentifier})
					THEN 1.0
					ELSE 0.0
				END AS exact_boost
			FROM search_documents sd
			LEFT JOIN projects proj
				ON proj.workspace_id = sd.workspace_id AND proj.id = sd.project_id
			LEFT JOIN doc_pages dp
				ON sd.entity_type = 'doc_page' AND dp.workspace_id = sd.workspace_id AND dp.id = sd.entity_id AND dp.archived_at IS NULL
			LEFT JOIN issues iss
				ON sd.entity_type = 'issue' AND iss.workspace_id = sd.workspace_id AND iss.id = sd.entity_id
			LEFT JOIN project_statuses ps
				ON ps.workspace_id = iss.workspace_id AND ps.id = iss.status_id
			LEFT JOIN users assignee_u
				ON iss.assignee_type = 'user' AND assignee_u.id = iss.assignee_id
			WHERE sd.workspace_id = ${args.workspaceId}
				AND (sd.entity_type <> 'doc_page' OR dp.id IS NOT NULL)
				AND (
					${args.bypassAcl}
					OR (
						sd.entity_type = 'doc_page'
						AND dp.id IS NOT NULL
						AND (
							(${args.isGuest} = false AND dp.visibility = 'workspace')
							OR can_read(sd.workspace_id, 'doc_page', dp.id, ${args.userId}, 'read')
						)
					)
					OR (
						sd.entity_type <> 'doc_page'
						AND (
							(
								${args.isGuest} = false
								AND (proj.id IS NULL OR proj.visibility = 'workspace' OR can_read(sd.workspace_id, 'project', proj.id, ${args.userId}, 'read'))
							)
							OR (
								${args.isGuest} = true
								AND proj.id IS NOT NULL
								AND can_read(sd.workspace_id, 'project', proj.id, ${args.userId}, 'read')
							)
						)
					)
				)
				${p.projectKey ? tx`AND upper(proj.key) = upper(${p.projectKey})` : tx``}
				${p.entityType ? tx`AND sd.entity_type = ${p.entityType}` : tx``}
				${
					p.state === 'open'
						? tx`AND sd.entity_type = 'issue' AND ps.category NOT IN ('completed', 'cancelled')`
						: p.state === 'closed'
							? tx`AND sd.entity_type = 'issue' AND ps.category IN ('completed', 'cancelled')`
							: tx``
				}
				${p.priority !== null ? tx`AND sd.entity_type = 'issue' AND iss.priority = ${p.priority}` : tx``}
				${
					p.assigneeHandle
						? tx`AND (assignee_u.email::text ILIKE ${`${p.assigneeHandle}%`} OR assignee_u.display_name ILIKE ${`%${p.assigneeHandle}%`})`
						: tx``
				}
				AND (
					${textQuery} = ''
					OR (${exactIdentifier}::text IS NOT NULL AND upper(sd.identifier) = upper(${exactIdentifier}))
					OR sd.tsv @@ websearch_to_tsquery('simple', ${textQuery})
					OR similarity(sd.title, ${textQuery}) >= 0.15
					OR sd.title ILIKE ${`%${textQuery}%`}
					OR sd.body ILIKE ${`%${textQuery}%`}
					OR sd.identifier ILIKE ${`%${textQuery}%`}
				)
		),
		ranked AS (
			SELECT
				entity_type,
				entity_id,
				project_id,
				container_id,
				identifier,
				title,
				body,
				metadata,
				updated_at,
				exact_boost,
				ROW_NUMBER() OVER (ORDER BY fts_rank DESC, updated_at DESC) AS r_fts,
				ROW_NUMBER() OVER (ORDER BY trgm_sim DESC, updated_at DESC) AS r_trgm
			FROM filtered
		)
		SELECT
			entity_type AS "entityType",
			entity_id AS "entityId",
			project_id AS "projectId",
			identifier,
			title,
			metadata,
			CASE
				WHEN ${textQuery} <> '' THEN ts_headline(
					'simple',
					coalesce(nullif(body, ''), title),
					websearch_to_tsquery('simple', ${textQuery}),
					'MaxFragments=1,MaxWords=18,MinWords=6'
				)
				ELSE left(coalesce(nullif(body, ''), title), 140)
			END AS snippet,
			(exact_boost + (1.0 / (60.0 + r_fts)) + (1.0 / (60.0 + r_trgm)))::float8 AS score,
			updated_at::text AS "updatedAt"
		FROM ranked
		ORDER BY score DESC, updated_at DESC
		LIMIT ${args.limit}
	`

	return rows.map((r) => {
		let deepLink: string
		if (r.entityType === 'project') {
			deepLink = `/tasks/projects/${r.entityId}`
		} else if (r.entityType === 'issue') {
			deepLink = `/tasks/issues/${r.identifier ?? r.entityId}`
		} else if (r.entityType === 'doc_page') {
			const slug =
				typeof r.metadata?.['slug'] === 'string' ? r.metadata['slug'] : (r.identifier ?? r.entityId)
			const blockId = findMatchedBlockId(r.metadata, textQuery)
			deepLink = `/docs/${slug}${blockId ? `#block-${blockId}` : ''}`
		} else {
			deepLink = `/tasks/issues/${r.entityId}`
		}

		return {
			entityType: r.entityType,
			entityId: r.entityId,
			projectId: r.projectId,
			identifier: r.identifier,
			title: r.title,
			snippet: r.snippet,
			score: r.score,
			deepLink,
			updatedAt: r.updatedAt
		}
	})
}
