/**
 * AI service — settings, provider config, summarize, semantic search v1
 * (§11.2–§11.4). Network work happens OUTSIDE tenant transactions; each
 * phase opens its own short `withWorkspace` tx.
 */
import type { AiProviderDto, AiSemanticHitDto, AiSettingsResponse, AiSummaryDto } from '@huriro/contracts'
import type { Sql } from '@huriro/db'
import { withWorkspace } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { encryptSecret } from '../../api/crypto'
import { HttpError } from '../../api/error'
import { exportDocPageMarkdown, getDocPageDetail } from '../docs'
import { assertCanSearch } from '../search'
import { getIssueDetail } from '../tasks'
import { chat, embed, type GatewayDeps } from './gateway'
import { AiDisabledError, requirePerm } from './policy'
import { summarizeDocPrompt, summarizeIssuePrompt } from './prompts'
import {
	type AiProviderRow,
	deleteProvider,
	getAiFlags,
	getDefaultProvider,
	getEmbeddingModel,
	listProviders,
	setAiFlags,
	upsertProvider,
	vectorSearch
} from './repo'

function providerDto(p: AiProviderRow): AiProviderDto {
	return {
		id: p.id,
		kind: p.kind,
		name: p.name,
		baseUrl: p.baseUrl,
		hasApiKey: p.apiKeyEnc !== null,
		chatModel: p.chatModel,
		embeddingModel: p.embeddingModel,
		isDefault: p.isDefault,
		createdAt: p.createdAt
	}
}

// ---------- settings ----------

export async function getAiSettings(sql: Sql, actor: ActorContext): Promise<AiSettingsResponse> {
	requirePerm(actor, 'ai.manage')
	return withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, async (tx) => {
		const flags = await getAiFlags(tx, actor.workspaceId)
		const providers = await listProviders(tx, actor.workspaceId)
		return {
			aiEnabled: flags.aiEnabled,
			aiTracePrompts: flags.aiTracePrompts,
			providers: providers.map(providerDto)
		}
	})
}

export async function patchAiSettings(
	sql: Sql,
	actor: ActorContext,
	patch: { aiEnabled?: boolean; aiTracePrompts?: boolean }
): Promise<{ aiEnabled: boolean; aiTracePrompts: boolean }> {
	requirePerm(actor, 'ai.manage')
	return withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
		setAiFlags(tx, actor.workspaceId, patch)
	)
}

export async function upsertAiProvider(
	sql: Sql,
	actor: ActorContext,
	rootSecret: string,
	body: {
		kind: 'openai_compatible' | 'ollama'
		name: string
		baseUrl: string
		apiKey?: string | null
		chatModel?: string
		embeddingModel?: string
	}
): Promise<AiProviderDto> {
	requirePerm(actor, 'ai.manage')
	return withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, async (tx) => {
		// A configured embedding model must exist in the registry — its
		// dimensions drive the halfvec cast at query time.
		if (body.embeddingModel) {
			const m = await getEmbeddingModel(tx, body.embeddingModel)
			if (!m) {
				throw new HttpError(422, 'ai_provider_unconfigured', `Unknown embedding model ${body.embeddingModel}`)
			}
		}
		// Envelope AAD is the provider name — the natural unique key per
		// workspace, stable across upserts (gateway decrypts with the same AAD).
		const apiKeyEnc =
			body.apiKey === undefined
				? undefined
				: body.apiKey === null
					? null
					: encryptSecret(rootSecret, `ai-provider:${body.name}`, body.apiKey)
		const row = await upsertProvider(tx, actor.workspaceId, {
			kind: body.kind,
			name: body.name,
			baseUrl: body.baseUrl,
			apiKeyEnc,
			chatModel: body.chatModel,
			embeddingModel: body.embeddingModel
		})
		return providerDto(row)
	})
}

export async function deleteAiProvider(sql: Sql, actor: ActorContext, id: string): Promise<void> {
	requirePerm(actor, 'ai.manage')
	const ok = await withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
		deleteProvider(tx, actor.workspaceId, id)
	)
	if (!ok) throw new HttpError(404, 'not_found', 'AI provider not found')
}

// ---------- enabled gate ----------

async function requireAiReady(
	sql: Sql,
	actor: ActorContext
): Promise<{ provider: AiProviderRow; tracePrompts: boolean }> {
	const flags = await withWorkspace(
		sql,
		{ workspaceId: actor.workspaceId, userId: actor.userId },
		async (tx) => {
			const f = await getAiFlags(tx, actor.workspaceId)
			if (!f.aiEnabled) return { f, provider: null }
			return { f, provider: await getDefaultProvider(tx, actor.workspaceId) }
		}
	)
	if (!flags.f.aiEnabled) throw new AiDisabledError()
	if (!flags.provider) {
		throw new HttpError(503, 'ai_provider_unconfigured', 'No AI provider is configured for this workspace')
	}
	return { provider: flags.provider, tracePrompts: flags.f.aiTracePrompts }
}

// ---------- summarize ----------

export async function summarize(
	sql: Sql,
	actor: ActorContext,
	deps: GatewayDeps,
	args: { entityType: 'issue' | 'doc_page'; entityId: string }
): Promise<AiSummaryDto> {
	requirePerm(actor, 'ai.use')
	const { provider, tracePrompts } = await requireAiReady(sql, actor)

	const content = await withWorkspace(
		sql,
		{ workspaceId: actor.workspaceId, userId: actor.userId },
		async (tx) => {
			if (args.entityType === 'issue') {
				const detail = await getIssueDetail(tx, actor, args.entityId)
				return {
					sourceCount: 1 + detail.comments.length,
					prompt: summarizeIssuePrompt({
						title: detail.issue.title,
						description: detail.issue.descriptionText ?? '',
						comments: detail.comments.map((c) => c.bodyText ?? '')
					})
				}
			}
			const detail = await getDocPageDetail(tx, actor, args.entityId)
			const md = await exportDocPageMarkdown(tx, actor, detail.page.id)
			return {
				sourceCount: 1,
				prompt: summarizeDocPrompt({ title: detail.page.title, markdown: md.markdown })
			}
		}
	)

	const result = await withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
		chat(tx, deps, actor.workspaceId, actor.userId, provider, 'summary', {
			...content.prompt,
			tracePrompts
		})
	)

	return {
		entityType: args.entityType,
		entityId: args.entityId,
		summary: result.text,
		model: result.model,
		sourceCount: content.sourceCount,
		cached: result.cached
	}
}

// ---------- semantic search v1 ----------

export async function semanticSearch(
	sql: Sql,
	actor: ActorContext,
	deps: GatewayDeps,
	query: string,
	limit: number
): Promise<{ query: string; mode: 'semantic'; hits: AiSemanticHitDto[] }> {
	requirePerm(actor, 'ai.use')
	const { isGuest, bypassAcl } = assertCanSearch(actor)
	const { provider } = await requireAiReady(sql, actor)
	if (!provider.embeddingModel) {
		throw new HttpError(
			503,
			'ai_provider_unconfigured',
			'The default AI provider has no embedding model configured'
		)
	}

	const model = await withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
		getEmbeddingModel(tx, provider.embeddingModel ?? '')
	)
	if (!model) {
		throw new HttpError(503, 'ai_provider_unconfigured', 'Configured embedding model is not in the registry')
	}

	const [queryVec] = await withWorkspace(
		sql,
		{ workspaceId: actor.workspaceId, userId: actor.userId },
		(tx) => embed(tx, deps, actor.workspaceId, actor.userId, provider, [query], model.id)
	)
	if (!queryVec) throw new HttpError(502, 'ai_provider_error', 'Provider returned no embedding')

	const rows = await withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
		vectorSearch(tx, {
			workspaceId: actor.workspaceId,
			userId: actor.userId,
			isGuest,
			bypassAcl,
			modelId: model.id,
			dimensions: model.dimensions,
			queryEmbedding: queryVec,
			limit
		})
	)

	return {
		query,
		mode: 'semantic',
		hits: rows.map((r) => ({
			entityType: r.entityType,
			entityId: r.entityId,
			title: r.title,
			snippet: r.snippet,
			score: 1 - r.distance,
			deepLink: r.entityType === 'doc_page' ? `/docs/${r.entityId}` : `/tasks/issues/${r.entityId}`
		}))
	}
}
