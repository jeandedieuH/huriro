// Agent principals — owned by the `agents` module (§5.4, §8.3, §13.1a).
// Agents are revocable principals with an accountable human owner and a scope
// ceiling — not users with a flag.
import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity'
import { workspaces } from './tenancy'

export const agentPrincipals = pgTable(
	'agent_principals',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['external_mcp', 'builtin_assistant', 'automation'] }).notNull(),
		name: text('name').notNull(),
		ownerUserId: uuid('owner_user_id')
			.notNull()
			.references(() => users.id),
		oauthClientId: text('oauth_client_id'),
		scopeCeiling: text('scope_ceiling').array().notNull().default([]),
		status: text('status', { enum: ['active', 'suspended', 'revoked'] })
			.notNull()
			.default('active'),
		lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('uq_agent_principals_ws_id').on(t.workspaceId, t.id)]
)
