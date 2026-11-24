/**
 * AiGateway (§11.3): provider-agnostic client — OpenAI-compatible and Ollama
 * adapters — with redaction before egress, metering to ai_runs, and an
 * exact-response cache keyed by (model, params, prompt hash). Every outbound
 * call goes through the SSRF-safe egress client; provider keys are decrypted
 * at call time from the envelope and never logged.
 */
import { createHash } from 'node:crypto'
import type { Queryable, Sql } from '@huriro/db'
import { withWorkspace } from '@huriro/db'
import { decryptSecret } from '../../api/crypto'
import { type DnsResolver, SsrfBlockedError, safeEgressFetch } from '../../api/egress'
import { HttpError } from '../../api/error'
import { redactSecrets } from './redact'
import { type AiProviderRow, getCached, insertAiRun, setCached } from './repo'

export interface GatewayDeps {
	readonly sql: Sql
	readonly rootSecret: string
	readonly fetcher?: typeof fetch | undefined
	readonly resolver?: DnsResolver | undefined
}

export interface ChatResult {
	readonly text: string
	readonly model: string
	readonly tokensIn: number
	readonly tokensOut: number
	readonly cached: boolean
}

const CACHE_TTL_SEC = 24 * 3600
const MAX_PROMPT_CHARS = 24_000

function sha256(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex')
}

function providerApiKey(provider: AiProviderRow, rootSecret: string): string | null {
	if (!provider.apiKeyEnc) return null
	try {
		return decryptSecret(rootSecret, `ai-provider:${provider.name}`, provider.apiKeyEnc)
	} catch {
		throw new HttpError(500, 'internal', 'AI provider key could not be decrypted')
	}
}

function authHeaders(apiKey: string | null): Record<string, string> {
	return apiKey ? { authorization: `Bearer ${apiKey}` } : {}
}

/** Local-model providers may legitimately live on private/loopback IPs. */
function egressOpts(
	provider: AiProviderRow,
	deps: GatewayDeps
): { fetcher?: typeof fetch | undefined; resolver?: DnsResolver | undefined; allowPrivate: boolean } {
	return {
		fetcher: deps.fetcher,
		resolver: deps.resolver,
		allowPrivate: provider.kind === 'ollama'
	}
}

/** Per-call metering row — fire-and-forget inside a fresh tenant tx. */
async function meter(
	deps: GatewayDeps,
	workspaceId: string,
	run: Parameters<typeof insertAiRun>[2]
): Promise<void> {
	try {
		await withWorkspace(deps.sql, { workspaceId }, (tx) => insertAiRun(tx, workspaceId, run))
	} catch {
		// Metering must never break the request path — a failed ledger row must
		// not fail user traffic (§11.3).
	}
}

export async function chat(
	tx: Queryable,
	deps: GatewayDeps,
	workspaceId: string,
	userId: string,
	provider: AiProviderRow,
	runType: 'chat' | 'summary',
	args: { system: string; user: string; tracePrompts: boolean }
): Promise<ChatResult> {
	const model = provider.chatModel ?? defaultChatModel(provider)
	const system = redactSecrets(args.system)
	const user = redactSecrets(args.user).slice(0, MAX_PROMPT_CHARS)
	const cacheKey = sha256(`chat:${model}:${system}:${user}`)
	const promptHash = sha256(`${system}:${user}`)

	const hit = await getCached(tx, workspaceId, cacheKey)
	if (hit && typeof hit['text'] === 'string') {
		await meter(deps, workspaceId, {
			runType,
			providerId: provider.id,
			model,
			userId,
			outcome: 'cached',
			cacheKey,
			promptHash
		})
		return { text: String(hit['text']), model, tokensIn: 0, tokensOut: 0, cached: true }
	}

	const apiKey = providerApiKey(provider, deps.rootSecret)
	const started = Date.now()
	let text: string
	let tokensIn = 0
	let tokensOut = 0
	try {
		const res = await callChat(provider, model, system, user, apiKey, deps)
		text = res.text
		tokensIn = res.tokensIn
		tokensOut = res.tokensOut
	} catch (e) {
		await meter(deps, workspaceId, {
			runType,
			providerId: provider.id,
			model,
			userId,
			outcome: 'error',
			cacheKey,
			promptHash,
			latencyMs: Date.now() - started,
			errorCode: e instanceof SsrfBlockedError ? 'ssrf_blocked' : 'ai_provider_error'
		})
		throw new HttpError(502, 'ai_provider_error', 'AI provider request failed')
	}

	await setCached(tx, workspaceId, cacheKey, model, { text }, CACHE_TTL_SEC)
	await meter(deps, workspaceId, {
		runType,
		providerId: provider.id,
		model,
		userId,
		tokensIn,
		tokensOut,
		latencyMs: Date.now() - started,
		outcome: 'ok',
		cacheKey,
		promptHash,
		promptTrace: args.tracePrompts ? { system, user, response: text } : null
	})
	return { text, model, tokensIn, tokensOut, cached: false }
}

export async function embed(
	_tx: Queryable,
	deps: GatewayDeps,
	workspaceId: string,
	userId: string | null,
	provider: AiProviderRow,
	texts: readonly string[],
	modelId: string
): Promise<readonly (readonly number[])[]> {
	const apiKey = providerApiKey(provider, deps.rootSecret)
	const inputs = texts.map((t) => redactSecrets(t).slice(0, MAX_PROMPT_CHARS))
	const started = Date.now()
	try {
		const vectors = await callEmbed(provider, modelId, inputs, apiKey, deps)
		await meter(deps, workspaceId, {
			runType: 'embedding',
			providerId: provider.id,
			model: modelId,
			userId,
			latencyMs: Date.now() - started,
			outcome: 'ok',
			promptHash: sha256(inputs.join(''))
		})
		return vectors
	} catch (e) {
		await meter(deps, workspaceId, {
			runType: 'embedding',
			providerId: provider.id,
			model: modelId,
			userId,
			latencyMs: Date.now() - started,
			outcome: 'error',
			errorCode: e instanceof SsrfBlockedError ? 'ssrf_blocked' : 'ai_provider_error'
		})
		throw new HttpError(502, 'ai_provider_error', 'AI embedding request failed')
	}
}

function defaultChatModel(provider: AiProviderRow): string {
	return provider.kind === 'ollama' ? 'qwen2.5:3b' : 'gpt-4o-mini'
}

// ---------- provider adapters (OpenAI-compatible + Ollama) ----------

async function callChat(
	provider: AiProviderRow,
	model: string,
	system: string,
	user: string,
	apiKey: string | null,
	deps: GatewayDeps
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
	const base = provider.baseUrl.replace(/\/+$/, '')
	if (provider.kind === 'ollama') {
		const res = await safeEgressFetch(`${base}/api/chat`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				model,
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: user }
				],
				stream: false
			}),
			...egressOpts(provider, deps)
		})
		const body = JSON.parse(new TextDecoder().decode(res.bodyBytes)) as {
			message?: { content?: string }
			prompt_eval_count?: number
			eval_count?: number
		}
		if (res.status !== 200) throw new Error(`ollama chat ${res.status}`)
		return {
			text: body.message?.content ?? '',
			tokensIn: body.prompt_eval_count ?? 0,
			tokensOut: body.eval_count ?? 0
		}
	}
	// openai_compatible
	const res = await safeEgressFetch(`${base}/v1/chat/completions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...authHeaders(apiKey) },
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user }
			]
		}),
		...egressOpts(provider, deps)
	})
	const body = JSON.parse(new TextDecoder().decode(res.bodyBytes)) as {
		choices?: { message?: { content?: string } }[]
		usage?: { prompt_tokens?: number; completion_tokens?: number }
	}
	if (res.status !== 200) throw new Error(`openai chat ${res.status}`)
	return {
		text: body.choices?.[0]?.message?.content ?? '',
		tokensIn: body.usage?.prompt_tokens ?? 0,
		tokensOut: body.usage?.completion_tokens ?? 0
	}
}

async function callEmbed(
	provider: AiProviderRow,
	model: string,
	inputs: readonly string[],
	apiKey: string | null,
	deps: GatewayDeps
): Promise<readonly (readonly number[])[]> {
	const base = provider.baseUrl.replace(/\/+$/, '')
	if (provider.kind === 'ollama') {
		const res = await safeEgressFetch(`${base}/api/embed`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model, input: inputs }),
			...egressOpts(provider, deps)
		})
		const body = JSON.parse(new TextDecoder().decode(res.bodyBytes)) as {
			embeddings?: number[][]
		}
		if (res.status !== 200) throw new Error(`ollama embed ${res.status}`)
		return body.embeddings ?? []
	}
	const res = await safeEgressFetch(`${base}/v1/embeddings`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...authHeaders(apiKey) },
		body: JSON.stringify({ model, input: inputs }),
		...egressOpts(provider, deps)
	})
	const body = JSON.parse(new TextDecoder().decode(res.bodyBytes)) as {
		data?: { embedding?: number[] }[]
	}
	if (res.status !== 200) throw new Error(`openai embed ${res.status}`)
	return (body.data ?? []).map((d) => d.embedding ?? [])
}
