// huriro — user/agent client CLI (ADR-0021). Dispatch only; transport lives in
// http.ts, auth in device.ts, storage in store.ts.
import { ALIASES } from './aliases'
import { flagsToInput, isArgsError, parseArgs } from './args'
import { CLI_CLIENT_ID, pollDeviceTokens, refreshTokens, revokeToken, startDeviceFlow } from './device'
import { GENERATED_TOOLS } from './generated/commands'
import { callTool, EXIT, getJson, type ToolResult } from './http'
import type { Io } from './io'
import {
	deleteCredential,
	getCredential,
	normalizeServer,
	redactSecret,
	type StoredCredential,
	setCredential
} from './store'

export { EXIT }

const READ_SCOPES = 'tasks.read docs.read chat.read search.read'
const WRITE_SCOPES = 'tasks.write docs.write'

interface Session {
	readonly server: string
	readonly token: string
	readonly workspaceId: string
	readonly cred?: StoredCredential
}

function usage(io: Io): number {
	io.stderr(`huriro — workspace agent CLI
  huriro login --url <server> [--write] [--scope a,b]
  huriro logout | whoami
  huriro workspace list|use <id|slug>|describe
  huriro queue [--md|--json]
  huriro issue view|list|search|create|update|comment|status …
  huriro doc get|search|create|append …
  huriro search <query>
  huriro approvals status|wait <id> [--timeout s]
  huriro tool <name> [--input JSON|--input-file f|flags…] [--md|--json]
Global: --url --workspace --profile --no-input --json --md
Env: HURIRO_URL HURIRO_WORKSPACE HURIRO_TOKEN HURIRO_API_KEY`)
	return EXIT.usage
}

async function resolveSession(
	io: Io,
	flags: Record<string, string | boolean>
): Promise<Session | { code: number }> {
	const server = normalizeServer(String(flags['url'] ?? io.env['HURIRO_URL'] ?? ''))
	if (!server) {
		io.stderr('no server — pass --url or set HURIRO_URL')
		return { code: EXIT.usage }
	}
	const token = io.env['HURIRO_TOKEN'] ?? io.env['HURIRO_API_KEY']
	const workspace = String(flags['workspace'] ?? io.env['HURIRO_WORKSPACE'] ?? '')
	if (token) {
		if (!workspace) {
			io.stderr('HURIRO_TOKEN/API_KEY auth requires --workspace or HURIRO_WORKSPACE')
			return { code: EXIT.usage }
		}
		return { server, token, workspaceId: workspace }
	}
	const cred = getCredential(io, server)
	if (!cred) {
		io.stderr(`not logged in to ${server} — run \`huriro login --url ${server}\``)
		return { code: EXIT.auth }
	}
	// Refresh when expired (rotating refresh: persist new token BEFORE use).
	if (cred.kind === 'oauth' && cred.expiresAt && cred.expiresAt <= io.now()) {
		if (!cred.refreshToken) return { code: EXIT.auth }
		const fresh = await refreshTokens(io, server, cred.refreshToken)
		if (!fresh) {
			io.stderr('session expired — run `huriro login` again')
			return { code: EXIT.auth }
		}
		const next: StoredCredential = {
			...cred,
			accessToken: fresh.accessToken,
			refreshToken: fresh.refreshToken ?? cred.refreshToken,
			expiresAt: fresh.expiresIn ? io.now() + fresh.expiresIn * 1000 : cred.expiresAt
		}
		setCredential(io, server, next)
		return { server, token: next.accessToken, workspaceId: workspace || (next.workspaceId ?? ''), cred: next }
	}
	return { server, token: cred.accessToken, workspaceId: workspace || cred.workspaceId || '', cred }
}

function emitResult(io: Io, r: ToolResult, flags: Record<string, string | boolean>): number {
	if (flags['json']) {
		io.stdout(
			JSON.stringify({ data: r.data, markdown: r.markdown, trust: r.trust, nextCursor: r.nextCursor })
		)
	} else if (r.markdown) {
		io.stdout(r.markdown)
	} else {
		io.stdout(JSON.stringify(r.data ?? r))
	}
	return EXIT.ok
}

function approvalResult(io: Io, r: ToolResult, flags: Record<string, string | boolean>): number {
	if (flags['json']) {
		io.stdout(
			JSON.stringify({
				status: 'approval_required',
				approvalId: r.approvalId,
				approveUrl: r.approveUrl,
				expiresAt: r.expiresAt
			})
		)
	} else {
		io.stderr(`approval required — ${r.approvalId}${r.approveUrl ? `\napprove: ${r.approveUrl}` : ''}`)
	}
	return EXIT.approval
}

async function runTool(
	io: Io,
	session: Session,
	tool: string,
	input: Record<string, unknown>,
	flags: Record<string, string | boolean>
): Promise<number> {
	const spec = GENERATED_TOOLS.find((t) => t.name === tool)
	const { result, failure } = await callTool(io, session.server, {
		tool,
		input,
		token: session.token,
		workspaceId: session.workspaceId,
		idempotencyKey: flags['idempotency-key'] ? String(flags['idempotency-key']) : undefined,
		isWrite: spec ? spec.kind !== 'read' : true
	})
	if (failure) {
		if (!failure.message.startsWith('auth')) io.stderr(failure.message)
		return failure.code
	}
	if (!result) return EXIT.error
	if (result.status === 'approval_required') return approvalResult(io, result, flags)
	return emitResult(io, result, flags)
}

async function cmdLogin(io: Io, flags: Record<string, string | boolean>): Promise<number> {
	const server = normalizeServer(String(flags['url'] ?? io.env['HURIRO_URL'] ?? ''))
	if (!server) {
		io.stderr('login requires --url <server>')
		return EXIT.usage
	}
	const scopes = flags['scope']
		? String(flags['scope']).replace(/,/g, ' ')
		: `${READ_SCOPES}${flags['write'] ? ` ${WRITE_SCOPES}` : ''}`
	const start = await startDeviceFlow(io, server, scopes)
	if ('error' in start) {
		io.stderr(start.error)
		return EXIT.error
	}
	io.stderr(
		`verify: ${start.verificationUriComplete ?? start.verificationUri ?? server} — code ${start.userCode}`
	)
	const tokens = await pollDeviceTokens(io, server, start.deviceCode, start)
	if ('error' in tokens) {
		io.stderr(tokens.error)
		return EXIT.auth
	}
	// Workspace selection: list memberships via the REST credential.
	const wsRes = await getJson(io, server, '/api/v1/agent/workspaces', {
		authorization: `Bearer ${tokens.accessToken}`
	})
	const memberships = (wsRes.json['data'] ?? []) as { id: string; slug: string; name: string }[]
	let workspaceId = String(flags['workspace'] ?? io.env['HURIRO_WORKSPACE'] ?? '')
	if (!workspaceId) {
		if (memberships.length === 1) workspaceId = memberships[0]?.id ?? ''
		else if (memberships.length === 0) {
			io.stderr('connected, but this account has no workspaces')
			return EXIT.error
		} else if (io.env['HURIRO_NO_INPUT'] || flags['no-input']) {
			io.stderr(`multiple workspaces — pass --workspace: ${memberships.map((m) => m.slug).join(', ')}`)
			return EXIT.usage
		} else {
			io.stderr(`workspaces: ${memberships.map((m, i) => `${i + 1}) ${m.slug}`).join('  ')}`)
			const answer = (await io.readStdin()).trim()
			const pick =
				memberships[Number(answer) - 1] ?? memberships.find((m) => m.slug === answer || m.id === answer)
			if (!pick) return EXIT.usage
			workspaceId = pick.id
		}
	}
	setCredential(io, server, {
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		expiresAt: tokens.expiresIn ? io.now() + tokens.expiresIn * 1000 : undefined,
		scopes: tokens.scope?.split(' '),
		clientId: CLI_CLIENT_ID,
		workspaceId,
		kind: 'oauth'
	})
	io.stdout(`logged in to ${server} (workspace ${workspaceId})`)
	return EXIT.ok
}

export async function main(argv: string[], io: Io): Promise<number> {
	const parsed = parseArgs(argv)
	if (isArgsError(parsed)) {
		io.stderr(parsed.message)
		return EXIT.usage
	}
	const { positional, flags } = parsed
	const [cmd, sub] = [positional[0], positional[1]]
	try {
		if (cmd === 'login') return await cmdLogin(io, flags)
		if (!cmd || flags['help'] || cmd === 'help') return usage(io)

		if (cmd === 'logout') {
			const server = normalizeServer(String(flags['url'] ?? io.env['HURIRO_URL'] ?? ''))
			const cred = server ? getCredential(io, server) : undefined
			if (cred?.refreshToken && server) await revokeToken(io, server, cred.refreshToken)
			if (server) deleteCredential(io, server)
			io.stdout('logged out')
			return EXIT.ok
		}

		if (cmd === 'whoami') {
			const s = await resolveSession(io, flags)
			if ('code' in s) return s.code
			const me = await getJson(io, s.server, '/api/v1/agent/tools', { authorization: `Bearer ${s.token}` })
			if (!me.ok) {
				io.stderr(`whoami failed (${me.status})`)
				return EXIT.auth
			}
			io.stdout(
				JSON.stringify({
					server: s.server,
					workspace: s.workspaceId,
					client: s.cred?.clientId ?? 'api-key',
					kind: s.cred?.kind ?? 'api-key',
					scopes: s.cred?.scopes ?? []
				})
			)
			return EXIT.ok
		}

		if (cmd === 'workspace' && sub === 'list') {
			const s = await resolveSession(io, flags)
			if ('code' in s) return s.code
			const res = await getJson(io, s.server, '/api/v1/agent/workspaces', {
				authorization: `Bearer ${s.token}`
			})
			if (!res.ok) return EXIT.auth
			io.stdout(JSON.stringify(res.json['data']))
			return EXIT.ok
		}
		if (cmd === 'workspace' && sub === 'use') {
			const server = normalizeServer(String(flags['url'] ?? io.env['HURIRO_URL'] ?? ''))
			const cred = server ? getCredential(io, server) : undefined
			const target = positional[2]
			if (!cred || !target) return EXIT.usage
			setCredential(io, server, { ...cred, workspaceId: target })
			io.stdout(`workspace → ${target}`)
			return EXIT.ok
		}

		if (cmd === 'approvals' && sub === 'wait') {
			const s = await resolveSession(io, flags)
			if ('code' in s) return s.code
			const id = positional[2]
			if (!id) return EXIT.usage
			const deadline = io.now() + Number(flags['timeout'] ?? 300) * 1000
			for (;;) {
				const status = await pollStatus(io, s, id)
				if (status === 'executed') return EXIT.ok
				if (status === 'denied' || status === 'expired' || status === 'failed') {
					io.stderr(`approval ${id}: ${status}`)
					return EXIT.error
				}
				if (io.now() > deadline) {
					io.stderr(`timeout waiting for ${id}`)
					return EXIT.error
				}
				await io.sleep(2000)
			}
		}

		if (cmd === 'tool') {
			const s = await resolveSession(io, flags)
			if ('code' in s) return s.code
			const name = sub
			if (!name || !GENERATED_TOOLS.some((t) => t.name === name)) {
				io.stderr(`unknown tool "${name ?? ''}" — known: ${GENERATED_TOOLS.map((t) => t.name).join(', ')}`)
				return EXIT.usage
			}
			let input: Record<string, unknown> = {}
			if (flags['input']) input = JSON.parse(String(flags['input'])) as Record<string, unknown>
			else if (flags['input-file'])
				input = JSON.parse(io.readFile(String(flags['input-file']))) as Record<string, unknown>
			else input = flagsToInput(flags)
			return await runTool(io, s, name, input, flags)
		}

		const aliasKey = [cmd, sub].filter(Boolean).join(' ')
		const alias = ALIASES[aliasKey] ?? ALIASES[cmd ?? '']
		if (alias) {
			const s = await resolveSession(io, flags)
			if ('code' in s) return s.code
			const pos = ALIASES[aliasKey] ? positional.slice(2) : positional.slice(1)
			const input = alias.build(pos, flags)
			const missing = Object.entries(input).filter(([, v]) => v === '')
			if (missing.length > 0) {
				io.stderr(`usage: ${alias.usage}`)
				return EXIT.usage
			}
			return await runTool(io, s, alias.tool, input, flags)
		}

		io.stderr(`unknown command "${cmd}"`)
		return usage(io)
	} catch (err) {
		io.stderr(`error: ${redactSecret(err instanceof Error ? err.message : String(err))}`)
		return EXIT.error
	}
}

async function pollStatus(io: Io, s: Session, id: string): Promise<string> {
	const { result } = await callTool(io, s.server, {
		tool: 'approvals.status',
		input: { approvalId: id },
		token: s.token,
		workspaceId: s.workspaceId,
		isWrite: false
	})
	const data = result?.data as { status?: string } | undefined
	return data?.status ?? (result?.status === 'executed' ? 'executed' : 'pending')
}
