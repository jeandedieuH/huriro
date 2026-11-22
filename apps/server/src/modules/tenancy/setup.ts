/**
 * Instance bootstrap (§12.2): a one-time setup token provisions the first
 * user + workspace + owner membership, then burns itself.
 *
 * Bootstrap ordering subtlety: the workspace row is inserted BEFORE
 * `app.workspace_id` is set (workspaces is an instance table with a
 * member-visibility SELECT policy and no INSERT check); the tenant context is
 * then established inside the same transaction so subsequent tenant-scoped
 * writes satisfy FORCE RLS WITH CHECK.
 */
import { createHash } from 'node:crypto'
import { type Sql, withSystem } from '@huriro/db'
import { TENANCY_EVENTS } from './events'
import { audit, emitEvent, findUserByEmail, getSetting, insertUser, putSetting } from './repo'
import { seedWorkspace } from './service'

const TOKEN_KEY = 'setup_token_hash'
const DONE_KEY = 'setup_completed'

export function hashSetupToken(token: string): string {
	return createHash('sha256').update(token).digest('hex')
}

export async function setupStatus(sql: Sql): Promise<{ configured: boolean }> {
	const configured = await withSystem(sql, (tx) => getSetting(tx, DONE_KEY))
	return { configured: configured === true }
}

export interface SetupResult {
	workspaceId: string
	userId: string
	slug: string
}

export class SetupError extends Error {
	readonly code: 'already_configured' | 'invalid_token' | 'slug_taken'

	constructor(code: 'already_configured' | 'invalid_token' | 'slug_taken', message: string) {
		super(message)
		this.name = 'SetupError'
		this.code = code
	}
}

export async function completeSetup(
	sql: Sql,
	args: { token: string; workspaceName: string; slug: string; email: string; displayName: string }
): Promise<SetupResult> {
	return withSystem(sql, async (tx) => {
		const configured = (await getSetting(tx, DONE_KEY)) === true
		if (configured) throw new SetupError('already_configured', 'This instance is already configured')

		// The hash is provisioned into huriro_bootstrap (docker initdb or
		// `huriro init` — see infra/postgres/10-huriro-provision.sh).
		const [b] = await tx<{ value: unknown }[]>`SELECT value FROM huriro_bootstrap WHERE key = ${TOKEN_KEY}`
		const storedHash = b?.value
		const presented = hashSetupToken(args.token)
		if (typeof storedHash !== 'string' || storedHash !== presented) {
			throw new SetupError('invalid_token', 'Setup token is invalid')
		}

		// Reuse the user row if the email exists (idempotent retries), else create.
		const existing = await findUserByEmail(tx, args.email.toLowerCase())
		const userId =
			existing?.id ??
			(await insertUser(tx, { email: args.email.toLowerCase(), displayName: args.displayName }))

		let ws: Awaited<ReturnType<typeof seedWorkspace>>
		try {
			// Establish the tenant context in-transaction before tenant writes (see header).
			const [w] = await tx<{ id: string; slug: string }[]>`
				INSERT INTO workspaces (slug, name) VALUES (${args.slug}, ${args.workspaceName})
				RETURNING id, slug
			`
			await tx`SELECT set_config('app.workspace_id', ${w!.id}, true)`
			ws = await seedWorkspace(tx, { id: w!.id, slug: w!.slug }, userId)
		} catch (err) {
			if (err instanceof Error && err.message.includes('workspaces_slug_key')) {
				throw new SetupError('slug_taken', 'That workspace slug is already in use')
			}
			throw err
		}

		await putSetting(tx, DONE_KEY, true)
		// Burn the token — single-use (§12.2). huriro_bootstrap grants are
		// SELECT/UPDATE only, so overwrite with a sentinel; any presented token
		// now fails the hash compare.
		await tx`UPDATE huriro_bootstrap SET value = '"consumed"'::jsonb WHERE key = ${TOKEN_KEY}`
		await putSetting(tx, 'instance_admin_user_id', userId)

		await emitEvent(tx, {
			aggregate: 'workspace',
			aggregateId: ws.id,
			eventType: TENANCY_EVENTS.SetupCompleted,
			workspaceId: ws.id,
			payload: { workspaceId: ws.id, userId }
		})
		await audit(tx, {
			workspaceId: ws.id,
			actorType: 'user',
			actorId: userId,
			action: 'instance.setup_completed',
			targetType: 'workspace',
			targetId: ws.id
		})

		return { workspaceId: ws.id, userId, slug: ws.slug }
	})
}
