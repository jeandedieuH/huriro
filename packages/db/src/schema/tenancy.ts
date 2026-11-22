// Tenancy tables — owned by the `tenancy` module (§5.4, §8.3).
// Every tenant table: workspace_id + UNIQUE(workspace_id, id) on FK targets +
// composite tenant FKs. RLS policies live in migrations/0004_security.sql.
import { sql } from 'drizzle-orm'
import {
	boolean,
	check,
	foreignKey,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core'
import { users } from './identity'

export const workspaces = pgTable('workspaces', {
	id: uuid('id').primaryKey().default(sql`uuidv7()`),
	slug: text('slug').notNull(), // citext in SQL
	name: text('name').notNull(),
	plan: text('plan').notNull().default('free'),
	settings: jsonb('settings').notNull().default({}),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	deletedAt: timestamp('deleted_at', { withTimezone: true })
})

export const roles = pgTable(
	'roles',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		name: text('name').notNull(),
		isSystem: boolean('is_system').notNull().default(false),
		rank: integer('rank').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_roles_ws_key').on(t.workspaceId, t.key),
		unique('uq_roles_ws_id').on(t.workspaceId, t.id)
	]
)

export const rolePermissions = pgTable(
	'role_permissions',
	{
		workspaceId: uuid('workspace_id').notNull(),
		roleId: uuid('role_id').notNull(),
		permission: text('permission').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.roleId, t.permission] }),
		foreignKey({
			columns: [t.workspaceId, t.roleId],
			foreignColumns: [roles.workspaceId, roles.id],
			name: 'fk_role_permissions_role'
		}).onDelete('cascade')
	]
)

export const memberships = pgTable(
	'memberships',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		roleId: uuid('role_id').notNull(),
		status: text('status', { enum: ['active', 'suspended'] })
			.notNull()
			.default('active'),
		joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.userId] }),
		foreignKey({
			columns: [t.workspaceId, t.roleId],
			foreignColumns: [roles.workspaceId, roles.id],
			name: 'fk_memberships_role'
		})
	]
)

export const invitations = pgTable(
	'invitations',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		roleId: uuid('role_id').notNull(),
		tokenHash: text('token_hash').notNull(),
		invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
		status: text('status', { enum: ['pending', 'accepted', 'expired', 'revoked'] })
			.notNull()
			.default('pending'),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		acceptedAt: timestamp('accepted_at', { withTimezone: true })
	},
	(t) => [
		unique('uq_invitations_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.roleId],
			foreignColumns: [roles.workspaceId, roles.id],
			name: 'fk_invitations_role'
		})
	]
)

export const aclEntries = pgTable(
	'acl_entries',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		resourceType: text('resource_type', {
			enum: ['project', 'doc_page', 'channel', 'mail_account']
		}).notNull(),
		resourceId: uuid('resource_id').notNull(),
		principalType: text('principal_type', { enum: ['user', 'role', 'workspace'] }).notNull(),
		principalId: uuid('principal_id'),
		permission: text('permission', { enum: ['read', 'comment', 'write', 'manage'] }).notNull(),
		grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	() => [
		check('ck_acl_workspace_principal', sql`principal_type <> 'workspace' OR principal_id IS NULL`),
		check('ck_acl_named_principal', sql`principal_type = 'workspace' OR principal_id IS NOT NULL`)
	]
)
