/**
 * Instance bootstrap (§12.2): a one-time setup token provisions the first
 * user + workspace + owner membership, then burns itself.
 *
 * Bootstrap ordering subtlety: `app.workspace_id` is set BEFORE the workspace
 * row is inserted (insertWorkspace pre-generates the uuidv7) — Postgres checks
 * SELECT policies on `INSERT ... RETURNING` rows, and the member-visibility
 * policy only admits `id = app.workspace_id`. The tenant context then carries
 * every subsequent tenant-scoped write in the same transaction (FORCE RLS).
 */
import { createHash } from 'node:crypto'
import { type Sql, withSystem } from '@huriro/db'
import type { Auth } from '../identity'
import { TENANCY_EVENTS } from './events'
import {
	audit,
	emitEvent,
	findUserByEmail,
	getSetting,
	insertUser,
	insertWorkspace,
	putSetting
} from './repo'
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
	readonly code: 'already_configured' | 'invalid_token' | 'slug_taken' | 'auth_failed'

	constructor(code: 'already_configured' | 'invalid_token' | 'slug_taken' | 'auth_failed', message: string) {
		super(message)
		this.name = 'SetupError'
		this.code = code
	}
}

/**
 * The first admin must be able to log in — when auth is configured and a
 * password is supplied, the credential account goes through better-auth's
 * signUpEmail (atomic user+account rows on the auth pool, which commits
 * independently of the setup tx). If the setup tx then fails, the user row
 * persists and a retry can still proceed (findUserByEmail reuses it).
 */
async function provisionFirstUser(
	tx: Parameters<typeof insertUser>[0],
	auth: Auth | null,
	args: { email: string; displayName: string; password: string | undefined }
): Promise<string> {
	const email = args.email.toLowerCase()
	const existing = await findUserByEmail(tx, email)
	if (existing) return existing.id
	if (auth && args.password) {
		try {
			const res = await auth.api.signUpEmail({
				body: { email, password: args.password, name: args.displayName }
			})
			return res.user.id
		} catch (err) {
			// Idempotent retry: a crashed setup leaves the credential behind on
			// the auth pool (it commits independently of this tx), and RLS hides
			// that user row from findUserByEmail — signUpEmail then reports the
			// email taken. When the presented password verifies, reusing the same
			// user is the intent; a wrong password still fails here.
			try {
				const res = await auth.api.signInEmail({ body: { email, password: args.password } })
				return res.user.id
			} catch {
				throw new SetupError(
					'auth_failed',
					`Could not create the admin credential: ${err instanceof Error ? err.message : 'unknown error'}`
				)
			}
		}
	}
	return insertUser(tx, { email, displayName: args.displayName })
}

export async function completeSetup(
	sql: Sql,
	auth: Auth | null,
	args: {
		token: string
		workspaceName: string
		slug: string
		email: string
		displayName: string
		password?: string
	}
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

		// Reuse the user row if the email exists (idempotent retries), else create
		// — through better-auth when a password is supplied so login works.
		const userId = await provisionFirstUser(tx, auth, {
			email: args.email,
			displayName: args.displayName,
			password: args.password
		})

		let ws: Awaited<ReturnType<typeof seedWorkspace>>
		try {
			// insertWorkspace establishes the tenant context itself (pre-generated
			// id + set_config before the row exists — required for RLS).
			const w = await insertWorkspace(tx, { slug: args.slug, name: args.workspaceName })
			ws = await seedWorkspace(tx, { id: w.id, slug: w.slug }, userId)
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
