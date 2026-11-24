/**
 * `/mcp` — MCP 2026-07-28 Streamable HTTP endpoint (§13.1b, ADR-0019/0020).
 *
 * Stateless per-request serving via `createMcpHandler(..., {legacy:'reject'})`
 * wrapped in better-auth's `requireMcpAuth` so unauthenticated and
 * wrong-audience traffic get the spec JSON-RPC 401 + RFC 9728
 * `WWW-Authenticate: Bearer resource_metadata=…`. Cookies are never a
 * credential here: a Cookie header alongside a valid bearer is a 400.
 *
 * Every `tools/call` goes through `invokeTool({transport:'mcp'})` — the same
 * tx + idempotency + audit boundary as REST. R1 writes surface as MRTR
 * `input_required` results carrying an HMAC-signed requestState; clients
 * without elicitation support get the R2 approval path instead.
 */
import { requireMcpAuth } from '@better-auth/mcp'
import { getTool, TOOLS, type ToolSpec } from '@huriro/agent-tools'
import type { Sql } from '@huriro/db'
import { withWorkspace } from '@huriro/db'
import {
	type CallToolResult,
	createMcpHandler,
	inputRequired,
	inputResponse,
	McpServer,
	ResourceTemplate,
	type ServerContext,
	type StandardSchemaWithJSON,
	type ToolAnnotations
} from '@modelcontextprotocol/server'
import { Elysia } from 'elysia'
import type { TSchema } from 'typebox'
import { Value } from 'typebox/value'
import { HttpError } from '../../api/error'
import type { Auth } from '../identity'
import { agentAudienceUris, HURIRO_CLI_CLIENT_ID, type VerifiedAgentCredential } from '../identity'
import { argsHashOf, type InvokeResult, invokeTool } from './dispatch'
import { getPrincipalByClient, insertToolCall } from './repo'
import { type ConfirmationState, mintRequestState, verifyRequestState } from './request-state'
import type { ToolDeps } from './tool-handlers'

export interface McpDeps {
	readonly baseUrl: string
	readonly requestStateSecret: string
	readonly hasCollabBridge: boolean
}

/** TypeBox 1.4 → the SDK's Standard-Schema + JSON-Schema converter shape. */
function std(t: TSchema): StandardSchemaWithJSON {
	return {
		'~standard': {
			version: 1,
			vendor: 'typebox',
			validate: (v: unknown) =>
				Value.Check(t, v)
					? { value: Value.Decode(t, Value.Clone(v)) }
					: {
							issues: [...Value.Errors(t, v)]
								.slice(0, 8)
								.map((e) => ({ message: `${e.instancePath || '/'}: ${e.message}` }))
						},
			jsonSchema: {
				input: () => t as unknown as Record<string, unknown>,
				output: () => t as unknown as Record<string, unknown>
			}
		}
	} as StandardSchemaWithJSON
}

interface McpPrincipal {
	readonly workspaceId: string
	readonly principalId: string | null
}

/**
 * MCP tokens are user-level: find the workspace this credential acts on.
 * Exactly one active principal → it; `X-Huriro-Workspace` disambiguates
 * several; none → caller returns 403 agent_not_connected (§13.1b).
 */
async function resolveMcpWorkspace(
	sql: Sql,
	credential: VerifiedAgentCredential,
	hint: string | null
): Promise<McpPrincipal | null> {
	// The memberships policy deliberately admits `user_id = app.user_id` so a
	// user can list their workspaces before a tenant context exists (same
	// pattern as tenancy's /workspaces/current). agent_principals stays
	// tenant-isolated, so principals are then probed per workspace.
	const workspaceIds = await sql.begin(async (tx) => {
		await tx`SELECT set_config('app.user_id', ${credential.userId}, true)`
		const rows = await tx<{ workspaceId: string }[]>`
			SELECT workspace_id AS "workspaceId" FROM memberships
			WHERE user_id = ${credential.userId} AND status = 'active'
			ORDER BY joined_at DESC
		`
		return rows.map((r) => r.workspaceId)
	})
	if (workspaceIds.length === 0) return null
	if (hint && !workspaceIds.includes(hint)) return null
	const ordered = hint ? [hint, ...workspaceIds.filter((w) => w !== hint)] : workspaceIds

	for (const workspaceId of ordered) {
		const found = await withWorkspace(sql, { workspaceId, userId: credential.userId }, async (tx) => {
			const principal = await getPrincipalByClient(tx, workspaceId, credential.userId, credential.clientId)
			if (principal && principal.status !== 'revoked') {
				return { workspaceId, principalId: principal.id }
			}
			// huriro-cli auto-connects inside resolveAgentActor — the first
			// workspace where none exists yet is still a valid binding.
			if (credential.clientId === HURIRO_CLI_CLIENT_ID) {
				return { workspaceId, principalId: null }
			}
			return null
		})
		if (found) return found
	}
	return null
}

async function agentsEnabled(tx: Parameters<Parameters<typeof withWorkspace>[2]>[0], workspaceId: string) {
	const rows = await tx<{ enabled: boolean }[]>`
		SELECT COALESCE((settings->>'mcp_enabled')::boolean, true) AS enabled
		FROM workspaces WHERE id = ${workspaceId}`
	return rows[0]?.enabled !== false
}

function mcpError(code: string, message: string): CallToolResult {
	return {
		isError: true,
		content: [{ type: 'text', text: `${code}: ${message}` }],
		_meta: { 'dev.huriro/code': code }
	}
}

function okResult(result: Extract<InvokeResult, { status: 'ok' }>): CallToolResult {
	const structured =
		result.data !== null && typeof result.data === 'object' && !Array.isArray(result.data)
			? (result.data as Record<string, unknown>)
			: { result: result.data ?? null }
	return {
		content: [{ type: 'text', text: result.markdown }],
		structuredContent: { ...structured, trust: result.trust },
		_meta: { 'dev.huriro/trust': result.trust }
	}
}

function approvalResult(result: Extract<InvokeResult, { status: 'approval_required' }>): CallToolResult {
	return {
		content: [
			{
				type: 'text',
				text:
					`This action requires human approval before it runs.\n\n` +
					`Approve at: ${result.approveUrl}\n` +
					`Then poll the \`approvals.status\` tool with approvalId ${result.approvalId}.`
			}
		],
		structuredContent: {
			status: 'approval_required',
			approvalId: result.approvalId,
			approveUrl: result.approveUrl,
			expiresAt: result.expiresAt
		}
	}
}

function supportsElicitation(ctx: ServerContext): boolean {
	// The client's capabilities arrive in initialize _meta; the SDK lifts the
	// reserved envelope keys into ctx.mcpReq.envelope/_meta. No capability →
	// treat the R1 write as requiring Huriro approval (never execute silently).
	const meta = (ctx.mcpReq._meta ?? {}) as Record<string, unknown>
	const caps = (meta['io.modelcontextprotocol/clientCapabilities'] ??
		(ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[
			'io.modelcontextprotocol/clientCapabilities'
		]) as { elicitation?: unknown } | undefined
	return Boolean(caps?.elicitation)
}

function toolAnnotations(tool: ToolSpec): ToolAnnotations {
	return {
		title: tool.title,
		readOnlyHint: tool.kind === 'read',
		destructiveHint: false,
		idempotentHint: tool.idempotent,
		openWorldHint: false
	}
}

interface BoundAgent {
	readonly credential: VerifiedAgentCredential
	readonly workspaceId: string
	readonly principalId: string | null
}

function buildServer(sql: Sql, bound: BoundAgent, deps: McpDeps): McpServer {
	const server = new McpServer({ name: 'huriro', version: '0.1.0' })

	// tools/list only exposes what THIS credential could call: scope ∩ ceiling
	// is computed by registering only tools the token scopes carry — the
	// per-call gate in invokeTool is the enforcement, this is honest listing.
	const callable = [...TOOLS.values()].filter(
		(t) => t.scope === 'any' || bound.credential.scopes.includes(t.scope)
	)
	for (const tool of callable) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: std(tool.input),
				// No outputSchema: the SDK validates structuredContent against
				// it, and non-ok results (approval_required, isError) are
				// legitimately different shapes (§13.5 result union).
				annotations: toolAnnotations(tool)
			},
			async (args, ctx) => runTool(sql, bound, deps, tool, args, ctx)
		)
	}
	registerResources(server, sql, bound)
	return server
}

const CONFIRM_KEY = 'confirm'

/** Accept/decline elicitation form — the SDK's supported-subset JSON Schema. */
const CONFIRM_SCHEMA: StandardSchemaWithJSON = {
	'~standard': {
		version: 1,
		vendor: 'huriro',
		validate: (v: unknown) =>
			typeof v === 'object' && v !== null && typeof (v as { confirm?: unknown }).confirm === 'boolean'
				? { value: v }
				: { issues: [{ message: 'confirm must be a boolean' }] },
		jsonSchema: {
			input: () => ({
				type: 'object',
				properties: { confirm: { type: 'boolean', title: 'Confirm', description: 'Run this action' } },
				required: ['confirm']
			}),
			output: () => ({ type: 'object' })
		}
	}
} as StandardSchemaWithJSON

async function runTool(
	sql: Sql,
	bound: BoundAgent,
	deps: McpDeps,
	tool: ToolSpec,
	args: unknown,
	ctx: ServerContext
): Promise<CallToolResult | ReturnType<typeof inputRequired>> {
	const started = Date.now()

	// ---- MRTR retry path: signed state + elicitation answer must agree ----
	const rawState =
		typeof ctx.mcpReq.requestState === 'function'
			? (ctx.mcpReq.requestState() as unknown)
			: (ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.['requestState']
	if (typeof rawState === 'string' && rawState.length > 0) {
		const state = verifyRequestState(deps.requestStateSecret, rawState)
		const view = inputResponse(ctx.mcpReq.inputResponses, CONFIRM_KEY)
		const argHash = argsHashOf(args)
		if (
			!state ||
			state.tool !== tool.name ||
			state.argsHash !== argHash ||
			// principalId is '' when the state was minted before the CLI
			// auto-connected — binding is enforced when both sides carry one.
			(state.principalId !== '' && bound.principalId !== null && state.principalId !== bound.principalId)
		) {
			await audit(sql, bound, tool, 'denied', 'confirmation_invalid', started)
			return mcpError(
				'confirmation_invalid',
				'Confirmation state is invalid, expired, or does not match these arguments'
			)
		}
		if (view.kind !== 'elicit') {
			await audit(sql, bound, tool, 'denied', 'confirmation_invalid', started)
			return mcpError('confirmation_invalid', 'Retry carried signed state but no elicitation answer')
		}
		if (view.action !== 'accept') {
			await audit(sql, bound, tool, 'denied', 'confirmation_declined', started)
			return mcpError('confirmation_declined', 'The write was declined — nothing was executed')
		}
		const result = await invoke(sql, bound, deps, tool, args, 'elicited')
		return shapeInvoke(result)
	}

	try {
		const result = await invoke(sql, bound, deps, tool, args, undefined, supportsElicitation(ctx))
		if (result.status === 'needs_confirmation') {
			if (!supportsElicitation(ctx)) {
				// Defensive: dispatcher already routes no-elicitation clients to
				// the approval path — an unreachable needs_confirmation becomes an
				// error rather than a silent write.
				return mcpError('confirmation_unsupported', 'Client does not support elicitation')
			}
			const state: Omit<ConfirmationState, 'issuedAt'> = {
				principalId: bound.principalId ?? '',
				tool: tool.name,
				argsHash: argsHashOf(args)
			}
			return inputRequired({
				inputRequests: {
					[CONFIRM_KEY]: inputRequired.elicit({
						message: result.previewMd,
						// Elicitation schemas only allow a small JSON-Schema subset
						// (no additionalProperties) — hand-written, not TypeBox.
						requestedSchema: CONFIRM_SCHEMA
					})
				},
				requestState: mintRequestState(deps.requestStateSecret, state)
			})
		}
		return shapeInvoke(result)
	} catch (e) {
		if (e instanceof HttpError) return mcpError(e.code, e.message)
		return mcpError('internal', 'Tool call failed')
	}
}

async function invoke(
	sql: Sql,
	bound: BoundAgent,
	deps: McpDeps,
	tool: ToolSpec,
	args: unknown,
	confirmation: 'elicited' | undefined,
	elicitCapable?: boolean
): Promise<InvokeResult> {
	const timeout = AbortSignal.timeout(30_000)
	return invokeTool({
		sql,
		credential: bound.credential,
		workspaceId: bound.workspaceId,
		toolName: tool.name,
		rawInput: args,
		transport: 'mcp',
		...(confirmation ? { confirmation } : {}),
		...(elicitCapable === false ? { mcpElicitation: false } : {}),
		deps: toolDepsOf(deps),
		baseUrl: deps.baseUrl,
		signal: timeout
	})
}

function toolDepsOf(deps: McpDeps): ToolDeps {
	return { hasCollabBridge: deps.hasCollabBridge }
}

function shapeInvoke(result: InvokeResult): CallToolResult {
	switch (result.status) {
		case 'ok':
			return okResult(result)
		case 'approval_required':
			return approvalResult(result)
		default:
			return mcpError('confirmation_unsupported', 'Unexpected confirmation state')
	}
}

/** Audit for outcomes that never reach the dispatcher (declined/invalid MRTR). */
async function audit(
	sql: Sql,
	bound: BoundAgent,
	tool: ToolSpec,
	status: string,
	errorCode: string,
	started: number
): Promise<void> {
	try {
		await withWorkspace(
			sql,
			{ workspaceId: bound.workspaceId, userId: bound.credential.userId },
			async (tx) => {
				const principal = bound.principalId
					? { id: bound.principalId, ownerUserId: bound.credential.userId, scopeCeiling: [] as string[] }
					: await getPrincipalByClient(
							tx,
							bound.workspaceId,
							bound.credential.userId,
							bound.credential.clientId
						)
				if (!principal) return
				await insertToolCall(tx, {
					workspaceId: bound.workspaceId,
					agentId: principal.id,
					ownerUserId: principal.ownerUserId,
					oauthClientId: bound.credential.clientId,
					tokenId: bound.credential.tokenId ?? null,
					tool: tool.name,
					argsHash: argsHashOf({ declined: true }),
					requestedScopes: bound.credential.scopes,
					effectiveScopes: bound.credential.scopes,
					requestedTier: tool.tier,
					effectiveTier: tool.tier,
					status,
					errorCode,
					durationMs: Date.now() - started,
					requestId: null
				})
			}
		)
	} catch {
		/* best-effort */
	}
}

// ---------- resources (§13.1b): huriro:// read-only representations ----------

function registerResources(server: McpServer, sql: Sql, bound: BoundAgent): void {
	const read = async (
		tool: string,
		args: unknown
	): Promise<{ contents: { uri: string; mimeType: string; text: string }[] }> => {
		const spec = getTool(tool)
		if (!spec) throw new Error(`resource backing tool ${tool} missing`)
		const result = await invokeTool({
			sql,
			credential: bound.credential,
			workspaceId: bound.workspaceId,
			toolName: tool,
			rawInput: args,
			transport: 'mcp',
			deps: { hasCollabBridge: false },
			baseUrl: ''
		})
		if (result.status !== 'ok') throw new Error(result.status)
		return { contents: [{ uri: '', mimeType: 'text/markdown', text: result.markdown }] }
	}

	server.registerResource(
		'workspace',
		'huriro://workspace',
		{ description: 'The bound workspace' },
		async (uri) => {
			const r = await read('workspace.describe', {})
			r.contents[0]!.uri = uri.href
			return r
		}
	)
	server.registerResource(
		'issue',
		new ResourceTemplate('huriro://issues/{identifier}', { list: undefined }),
		{ description: 'An issue by identifier (ENG-142) or id' },
		async (uri, vars) => {
			const r = await read('tasks.get', { issue: String(vars['identifier']) })
			r.contents[0]!.uri = uri.href
			return r
		}
	)
	server.registerResource(
		'doc',
		new ResourceTemplate('huriro://docs/{idOrSlug}', { list: undefined }),
		{ description: 'A doc page by id or slug' },
		async (uri, vars) => {
			const r = await read('docs.get', { page: String(vars['idOrSlug']) })
			r.contents[0]!.uri = uri.href
			return r
		}
	)
	server.registerResource(
		'project',
		new ResourceTemplate('huriro://projects/{key}', { list: undefined }),
		{ description: 'A project by key' },
		async (uri, vars) => {
			const r = await read('tasks.search', { query: String(vars['key']), limit: 50 })
			r.contents[0]!.uri = uri.href
			return r
		}
	)
}

// ---------- endpoint ----------

export function mcpEndpoint(sql: Sql, auth: Auth, deps: McpDeps) {
	const resource = agentAudienceUris(deps.baseUrl).mcp
	const handler = createMcpHandler(
		(mctx) => {
			const bound = mctx.authInfo?.extra?.['bound'] as BoundAgent | undefined
			if (!bound) throw new Error('missing bound agent context')
			return buildServer(sql, bound, deps)
		},
		{ legacy: 'reject' }
	)

	const gated = requireMcpAuth(
		auth as never,
		async (request, claims) => {
			// Cookie + valid bearer in one request ⇒ credential_type_mismatch,
			// mirroring the session surface's 400 (never a silent pick-one).
			if (request.headers.get('cookie')) {
				return new Response(JSON.stringify({ error: 'credential_type_mismatch' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				})
			}
			const scopeClaim = claims['scope']
			const credential: VerifiedAgentCredential = {
				userId: String(claims['sub'] ?? ''),
				clientId: String(claims['azp'] ?? claims['client_id'] ?? ''),
				scopes: typeof scopeClaim === 'string' ? scopeClaim.split(' ').filter(Boolean) : [],
				tokenId: claims['jti'] as string | undefined,
				audience: 'mcp'
			}
			const bound0 = await resolveMcpWorkspace(sql, credential, request.headers.get('x-huriro-workspace'))
			if (!bound0 || !credential.userId || !credential.clientId) {
				return new Response(
					JSON.stringify({
						error: 'agent_not_connected',
						message: 'No active agent principal for this token'
					}),
					{ status: 403, headers: { 'content-type': 'application/json' } }
				)
			}
			const enabled = await withWorkspace(
				sql,
				{ workspaceId: bound0.workspaceId, userId: credential.userId },
				(tx) => agentsEnabled(tx, bound0.workspaceId)
			)
			if (!enabled) {
				return new Response(
					JSON.stringify({ error: 'agents_disabled', message: 'Agents are disabled for this workspace' }),
					{ status: 403, headers: { 'content-type': 'application/json' } }
				)
			}
			const bound: BoundAgent = { ...bound0, credential }
			return handler.fetch(request, {
				authInfo: {
					token: '',
					clientId: credential.clientId,
					scopes: [...credential.scopes],
					extra: { bound }
				}
			})
		},
		{ resource }
	)

	const methodNotAllowed = () =>
		new Response(JSON.stringify({ error: 'method_not_allowed' }), {
			status: 405,
			headers: { 'content-type': 'application/json', allow: 'POST' }
		})

	// RFC 8414/9728 discovery: the oauth-provider plugin serves
	// /.well-known/oauth-protected-resource at the root itself, but the
	// authorization-server metadata lives under the auth basePath — mirror it
	// at the spec's root location so MCP clients can discover both (§13.1b).
	const asMetadata = () =>
		auth.handler(
			new Request(`${resource.replace(/\/mcp$/, '')}/api/auth/.well-known/oauth-authorization-server`, {
				method: 'GET'
			})
		)

	return new Elysia({ name: 'huriro.mcp' })
		.post('/mcp', ({ request }) => {
			// Workspace API keys (hrk_) are REST-audience credentials only —
			// they can never mint or pose as an MCP token (ADR-0021).
			const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
			if (bearer.startsWith('hrk_')) {
				return new Response(
					JSON.stringify({ error: 'unauthorized', message: 'Workspace API keys are not accepted on /mcp' }),
					{ status: 401, headers: { 'content-type': 'application/json' } }
				)
			}
			return gated(request)
		})
		.get('/mcp', methodNotAllowed)
		.delete('/mcp', methodNotAllowed)
		.get('/.well-known/oauth-authorization-server', asMetadata)
}
