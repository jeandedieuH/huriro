/**
 * Structured database service (M10, §4.1, ADR-0026). Structured values are
 * relational rows — never CRDT blobs — while row bodies remain ordinary docs.
 */
import type {
	CreateDocDatabaseBody,
	CreateDocDatabasePropertyBody,
	CreateDocDatabaseRowBody,
	CreateDocDatabaseViewBody,
	DocDatabaseDetailDto,
	DocDatabaseDto,
	DocDatabasePropertyDto,
	DocDatabaseRowDto,
	DocDatabaseRowsPageDto,
	DocDatabaseViewDto,
	ImportDocDatabaseRowsBody,
	ImportDocDatabaseRowsResultDto,
	QueryDocDatabaseRowsBody,
	UpdateDocDatabaseBody,
	UpdateDocDatabasePropertyBody,
	UpdateDocDatabaseRowBody,
	UpdateDocDatabaseViewBody
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import {
	type AclLevel,
	type Action,
	type ActorContext,
	aclSatisfies,
	databaseRowsFromCsv,
	databaseRowsFromJson,
	databaseRowsToCsv,
	databaseRowsToJson,
	detectFormulaDependencyCycle,
	evaluateFormula,
	type FormulaValue,
	generateKeyBetween,
	validateFormulaSource
} from '@huriro/domain'
import { appendChange, appendChanges } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { createDocPage, requireDocPageAccess } from '../docs'
import { resolveResourceAcl } from '../tenancy'
import { buildDatabaseRowQuerySql } from './database-filter-sql'

function stale(): never {
	throw new HttpError(409, 'stale_version', 'Resource was modified concurrently; refresh and retry')
}

function asObject(value: unknown): Record<string, unknown> {
	return (value ?? {}) as Record<string, unknown>
}

async function emitEvent(
	tx: Queryable,
	workspaceId: string,
	aggregateId: string,
	eventType: string,
	payload: Record<string, unknown>
) {
	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (${workspaceId}, 'doc_database', ${aggregateId}, ${eventType}, ${tx.json(payload as never)})
	`
}

async function audit(
	tx: Queryable,
	actor: ActorContext,
	action: string,
	targetId: string,
	metadata: Record<string, unknown> = {}
) {
	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (${actor.workspaceId}, ${actor.kind === 'agent' ? 'agent' : 'user'}, ${actor.principalId}, ${action}, 'doc_database', ${targetId}, ${tx.json(metadata as never)})
	`
}

function isoTimestamp(value: unknown): string {
	if (value instanceof Date) return value.toISOString()
	const text = String(value)
	const ms = Date.parse(text)
	return Number.isFinite(ms) ? new Date(ms).toISOString() : text
}

function nullableIsoTimestamp(value: unknown): string | null {
	return value == null ? null : isoTimestamp(value)
}

function mapDatabase(r: Record<string, unknown>): DocDatabaseDto {
	return {
		id: String(r['id']),
		workspaceId: String(r['workspace_id']),
		teamspaceId: r['teamspace_id'] ? String(r['teamspace_id']) : null,
		parentPageId: r['parent_page_id'] ? String(r['parent_page_id']) : null,
		title: String(r['title']),
		icon: r['icon'] ? String(r['icon']) : null,
		isInline: Boolean(r['is_inline']),
		createdBy: String(r['created_by']),
		createdAt: isoTimestamp(r['created_at']),
		updatedAt: isoTimestamp(r['updated_at']),
		version: Number(r['version'])
	}
}

function mapProperty(r: Record<string, unknown>): DocDatabasePropertyDto {
	return {
		id: String(r['id']),
		workspaceId: String(r['workspace_id']),
		databaseId: String(r['database_id']),
		name: String(r['name']),
		propType: String(r['prop_type']) as DocDatabasePropertyDto['propType'],
		config: asObject(r['config']),
		position: String(r['position']),
		createdAt: isoTimestamp(r['created_at']),
		updatedAt: isoTimestamp(r['updated_at']),
		version: Number(r['version'])
	}
}

function mapView(r: Record<string, unknown>): DocDatabaseViewDto {
	return {
		id: String(r['id']),
		workspaceId: String(r['workspace_id']),
		databaseId: String(r['database_id']),
		name: String(r['name']),
		viewType: String(r['view_type']) as DocDatabaseViewDto['viewType'],
		config: asObject(r['config']),
		position: String(r['position']),
		createdAt: isoTimestamp(r['created_at']),
		updatedAt: isoTimestamp(r['updated_at']),
		version: Number(r['version'])
	}
}

function mapRow(r: Record<string, unknown>, cells: DocDatabaseRowDto['cells'] = {}): DocDatabaseRowDto {
	return {
		id: String(r['id']),
		workspaceId: String(r['workspace_id']),
		databaseId: String(r['database_id']),
		pageId: r['page_id'] ? String(r['page_id']) : null,
		title: String(r['title']),
		position: String(r['position']),
		createdBy: String(r['created_by']),
		updatedBy: r['updated_by'] ? String(r['updated_by']) : null,
		archivedAt: nullableIsoTimestamp(r['archived_at']),
		createdAt: isoTimestamp(r['created_at']),
		updatedAt: isoTimestamp(r['updated_at']),
		version: Number(r['version']),
		cells
	}
}

async function teamspaceAccess(
	tx: Queryable,
	actor: ActorContext,
	teamspaceId: string | null
): Promise<AclLevel | null> {
	if (!teamspaceId) return null
	const [ts] = await tx<{ id: string; visibility: 'open' | 'closed' | 'private' }[]>`
		SELECT id, visibility FROM teamspaces WHERE workspace_id=${actor.workspaceId} AND id=${teamspaceId} AND archived_at IS NULL LIMIT 1
	`
	if (!ts) throw new HttpError(422, 'validation_failed', 'Database teamspace does not exist')
	const [member] = await tx<{ role: 'owner' | 'member' | 'viewer' }[]>`
		SELECT role FROM teamspace_members WHERE workspace_id=${actor.workspaceId} AND teamspace_id=${teamspaceId} AND user_id=${actor.userId} LIMIT 1
	`
	const memberAcl: AclLevel | null =
		member?.role === 'owner'
			? 'manage'
			: member?.role === 'member'
				? 'write'
				: member?.role === 'viewer'
					? 'read'
					: null
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'teamspace',
		resourceId: teamspaceId,
		userId: actor.userId
	})
	const best = acl && memberAcl ? (aclSatisfies(acl, memberAcl) ? acl : memberAcl) : (acl ?? memberAcl)
	if ((ts.visibility === 'closed' || ts.visibility === 'private') && !best && actor.roleRank < 80) {
		throw new HttpError(403, 'resource_private', 'Private teamspace access denied')
	}
	return best ?? (ts.visibility === 'open' ? 'read' : null)
}

async function authorizeDatabase(
	tx: Queryable,
	actor: ActorContext,
	db: { id: string; teamspaceId: string | null },
	action: Action
) {
	if (actor.membership !== 'active')
		throw new HttpError(403, 'forbidden', 'Workspace membership is not active')
	if (!actor.permissions.has(action))
		throw new HttpError(403, 'insufficient_role', `Missing permission for ${action}`)
	const required: AclLevel =
		action === 'database.read' ? 'read' : action === 'database.write' ? 'write' : 'manage'
	const teamAcl = await teamspaceAccess(tx, actor, db.teamspaceId)
	const dbAcl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'doc_database',
		resourceId: db['id'],
		userId: actor.userId
	})
	const effective = dbAcl && teamAcl ? (aclSatisfies(dbAcl, teamAcl) ? dbAcl : teamAcl) : (dbAcl ?? teamAcl)
	// Workspace-root databases have no narrower visibility object: once the
	// workspace role permission above has passed, they behave like other
	// workspace-visible resources. Teamspace-scoped databases still inherit the
	// teamspace ACL/default read level.
	if (!effective && !db.teamspaceId) return
	const admin = actor.roleRank >= 80 || actor.permissions.has('database.manage')
	if ((!effective || !aclSatisfies(effective, required)) && !admin) {
		throw new HttpError(403, 'resource_private', 'Database access denied')
	}
}

async function loadAccessibleDatabase(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	action: Action
) {
	const [row] =
		(await tx`SELECT * FROM doc_databases WHERE workspace_id=${actor.workspaceId} AND id=${databaseId} LIMIT 1`) as Record<
			string,
			unknown
		>[]
	if (!row) throw new HttpError(404, 'not_found', 'Database not found')
	await authorizeDatabase(
		tx,
		actor,
		{ id: databaseId, teamspaceId: row['teamspace_id'] ? String(row['teamspace_id']) : null },
		action
	)
	return row
}

export async function createDocDatabase(
	tx: Queryable,
	actor: ActorContext,
	input: CreateDocDatabaseBody
): Promise<{ data: DocDatabaseDetailDto; cursor: number }> {
	if (!actor.permissions.has('database.write'))
		throw new HttpError(403, 'insufficient_role', 'Missing permission for database.write')
	if (input.parentPageId) await requireDocPageAccess(tx, actor, input.parentPageId, 'doc.write')
	if (input.teamspaceId) await teamspaceAccess(tx, actor, input.teamspaceId)
	const inserted = input.id
		? ((await tx`INSERT INTO doc_databases (id, workspace_id, teamspace_id, parent_page_id, title, icon, is_inline, created_by)
			VALUES (${input.id}, ${actor.workspaceId}, ${input.teamspaceId ?? null}, ${input.parentPageId ?? null}, ${input.title}, ${input.icon ?? null}, ${input.isInline ?? false}, ${actor.userId}) RETURNING *`) as Record<
				string,
				unknown
			>[])
		: ((await tx`INSERT INTO doc_databases (workspace_id, teamspace_id, parent_page_id, title, icon, is_inline, created_by)
			VALUES (${actor.workspaceId}, ${input.teamspaceId ?? null}, ${input.parentPageId ?? null}, ${input.title}, ${input.icon ?? null}, ${input.isInline ?? false}, ${actor.userId}) RETURNING *`) as Record<
				string,
				unknown
			>[])
	const db = inserted[0]
	if (!db) throw new Error('failed to create database')
	const pos = generateKeyBetween(null, null)
	const titleRows = input.titlePropertyId
		? ((await tx`
			INSERT INTO doc_database_properties (id,workspace_id,database_id,name,prop_type,config,position)
			VALUES (${input.titlePropertyId},${actor.workspaceId},${String(db['id'])},'Name','title','{}'::jsonb,${pos}) RETURNING *
		`) as Record<string, unknown>[])
		: ((await tx`
			INSERT INTO doc_database_properties (workspace_id,database_id,name,prop_type,config,position)
			VALUES (${actor.workspaceId},${String(db['id'])},'Name','title','{}'::jsonb,${pos}) RETURNING *
		`) as Record<string, unknown>[])
	const viewRows = input.tableViewId
		? ((await tx`
			INSERT INTO doc_database_views (id,workspace_id,database_id,name,view_type,config,position)
			VALUES (${input.tableViewId},${actor.workspaceId},${String(db['id'])},'Table','table','{}'::jsonb,${pos}) RETURNING *
		`) as Record<string, unknown>[])
		: ((await tx`
			INSERT INTO doc_database_views (workspace_id,database_id,name,view_type,config,position)
			VALUES (${actor.workspaceId},${String(db['id'])},'Table','table','{}'::jsonb,${pos}) RETURNING *
		`) as Record<string, unknown>[])
	const titleProp = titleRows[0]
	const tableView = viewRows[0]
	if (!titleProp || !tableView) throw new Error('failed to initialize database')
	await emitEvent(tx, actor.workspaceId, String(db['id']), 'docs.database.created.v1', {
		databaseId: db['id'],
		actorId: actor.principalId
	})
	await audit(tx, actor, 'database.created', String(db['id']), { title: input.title })
	const cursor = await appendChanges(tx, actor.workspaceId, [
		{
			entityType: 'doc_database',
			entityId: String(db['id']),
			action: 'upsert',
			scope: [`db:${db['id']}`],
			payload: mapDatabase(db) as unknown as Record<string, unknown>,
			actorId: actor.principalId
		},
		{
			entityType: 'doc_database_property',
			entityId: String(titleProp['id']),
			action: 'upsert',
			scope: [`db:${db['id']}`],
			payload: mapProperty(titleProp) as unknown as Record<string, unknown>,
			actorId: actor.principalId
		},
		{
			entityType: 'doc_database_view',
			entityId: String(tableView['id']),
			action: 'upsert',
			scope: [`db:${db['id']}`],
			payload: mapView(tableView) as unknown as Record<string, unknown>,
			actorId: actor.principalId
		}
	])
	return {
		data: { database: mapDatabase(db), properties: [mapProperty(titleProp)], views: [mapView(tableView)] },
		cursor
	}
}

export async function getDocDatabaseDetail(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string
): Promise<DocDatabaseDetailDto> {
	const db = await loadAccessibleDatabase(tx, actor, databaseId, 'database.read')
	const [props, views] = await Promise.all([
		tx<
			Record<string, unknown>[]
		>`SELECT * FROM doc_database_properties WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} ORDER BY position COLLATE "C", id`,
		tx<
			Record<string, unknown>[]
		>`SELECT * FROM doc_database_views WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} ORDER BY position COLLATE "C", id`
	])
	return { database: mapDatabase(db), properties: props.map(mapProperty), views: views.map(mapView) }
}

export async function listDocDatabases(tx: Queryable, actor: ActorContext): Promise<DocDatabaseDto[]> {
	if (!actor.permissions.has('database.read'))
		throw new HttpError(403, 'insufficient_role', 'Missing permission for database.read')
	const rows = (await tx`
		SELECT d.* FROM doc_databases d
		LEFT JOIN teamspaces ts ON ts.workspace_id=d.workspace_id AND ts.id=d.teamspace_id
		LEFT JOIN teamspace_members tm ON tm.workspace_id=d.workspace_id AND tm.teamspace_id=d.teamspace_id AND tm.user_id=${actor.userId}
		WHERE d.workspace_id=${actor.workspaceId}
			AND (d.teamspace_id IS NULL OR ts.visibility='open' OR tm.user_id IS NOT NULL OR can_read(d.workspace_id,'teamspace',d.teamspace_id,${actor.userId},'read') OR can_read(d.workspace_id,'doc_database',d.id,${actor.userId},'read') OR ${actor.roleRank >= 80})
		ORDER BY d.title, d.id
	`) as Record<string, unknown>[]
	return rows.map(mapDatabase)
}

export async function updateDocDatabase(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	input: UpdateDocDatabaseBody
) {
	const existing = await loadAccessibleDatabase(tx, actor, databaseId, 'database.write')
	if (Number(existing['version']) !== input.version) stale()
	if (input.teamspaceId) await teamspaceAccess(tx, actor, input.teamspaceId)
	const [row] = (await tx`
		UPDATE doc_databases SET title=COALESCE(${input.title ?? null},title), icon=${input.icon === undefined ? (existing['icon'] === null ? null : String(existing['icon'])) : input.icon},
			teamspace_id=${input.teamspaceId === undefined ? (existing['teamspace_id'] === null ? null : String(existing['teamspace_id'])) : input.teamspaceId}, version=version+1
		WHERE workspace_id=${actor.workspaceId} AND id=${databaseId} RETURNING *
	`) as Record<string, unknown>[]
	if (!row) throw new HttpError(404, 'not_found', 'Database not found')
	await audit(tx, actor, 'database.updated', databaseId)
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_database',
		entityId: databaseId,
		action: 'upsert',
		scope: [`db:${databaseId}`],
		payload: mapDatabase(row) as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: mapDatabase(row), cursor }
}

function validatePropertyConfig(
	propType: string,
	config: Record<string, unknown>,
	existing: readonly { name: string; formulaSource?: string | undefined }[]
) {
	if (propType === 'formula') {
		const source =
			typeof config['formulaSource'] === 'string'
				? config['formulaSource']
				: typeof config['formula'] === 'string'
					? config['formula']
					: ''
		const valid = validateFormulaSource(source)
		if (!valid.ok) throw new HttpError(422, 'validation_failed', valid.error?.message ?? 'Invalid formula')
		const cycle = detectFormulaDependencyCycle([...existing, { name: '__new__', formulaSource: source }])
		if (cycle)
			throw new HttpError(422, 'validation_failed', `Formula dependency cycle: ${cycle.join(' -> ')}`)
	}
	if (
		propType === 'rollup' &&
		(typeof config['relationPropertyId'] !== 'string' || typeof config['aggregation'] !== 'string')
	) {
		throw new HttpError(422, 'validation_failed', 'Rollup requires relationPropertyId and aggregation')
	}
}

async function listPropertyRows(tx: Queryable, workspaceId: string, databaseId: string) {
	return tx<
		Record<string, unknown>[]
	>`SELECT * FROM doc_database_properties WHERE workspace_id=${workspaceId} AND database_id=${databaseId} ORDER BY position COLLATE "C", id`
}

export async function createDocDatabaseProperty(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	input: CreateDocDatabasePropertyBody
) {
	await loadAccessibleDatabase(tx, actor, databaseId, 'database.write')
	const props = await listPropertyRows(tx, actor.workspaceId, databaseId)
	validatePropertyConfig(
		input.propType,
		input.config ?? {},
		props.map((p) => {
			const cfg = asObject(p['config'])
			return {
				name: String(p['name']),
				formulaSource: typeof cfg['formulaSource'] === 'string' ? cfg['formulaSource'] : undefined
			}
		})
	)
	const pos =
		input.position ??
		generateKeyBetween(props.length ? String(props[props.length - 1]!['position']) : null, null)
	const inserted = input.id
		? ((await tx`INSERT INTO doc_database_properties (id,workspace_id,database_id,name,prop_type,config,position)
			VALUES (${input.id},${actor.workspaceId},${databaseId},${input.name},${input.propType},${tx.json((input.config ?? {}) as never)},${pos}) RETURNING *`) as Record<
				string,
				unknown
			>[])
		: ((await tx`INSERT INTO doc_database_properties (workspace_id,database_id,name,prop_type,config,position)
			VALUES (${actor.workspaceId},${databaseId},${input.name},${input.propType},${tx.json((input.config ?? {}) as never)},${pos}) RETURNING *`) as Record<
				string,
				unknown
			>[])
	const row = inserted[0]
	if (!row) throw new Error('failed to create property')
	await audit(tx, actor, 'database.property.created', databaseId, {
		propertyId: row['id'],
		propType: input.propType
	})
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_database_property',
		entityId: String(row['id']),
		action: 'upsert',
		scope: [`db:${databaseId}`],
		payload: mapProperty(row) as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: mapProperty(row), cursor }
}

export async function updateDocDatabaseProperty(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	propertyId: string,
	input: UpdateDocDatabasePropertyBody
) {
	await loadAccessibleDatabase(tx, actor, databaseId, 'database.write')
	const [existing] =
		(await tx`SELECT * FROM doc_database_properties WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} AND id=${propertyId} LIMIT 1`) as Record<
			string,
			unknown
		>[]
	if (!existing) throw new HttpError(404, 'not_found', 'Property not found')
	if (Number(existing['version']) !== input.version) stale()
	const nextConfig = input.config ?? asObject(existing['config'])
	validatePropertyConfig(String(existing['prop_type']), nextConfig, [])
	const [row] = (await tx`
		UPDATE doc_database_properties SET name=COALESCE(${input.name ?? null},name), config=${tx.json(nextConfig as never)}, position=COALESCE(${input.position ?? null},position), version=version+1
		WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} AND id=${propertyId} RETURNING *
	`) as Record<string, unknown>[]
	if (!row) throw new HttpError(404, 'not_found', 'Property not found')
	await audit(tx, actor, 'database.property.updated', databaseId, { propertyId })
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_database_property',
		entityId: propertyId,
		action: 'upsert',
		scope: [`db:${databaseId}`],
		payload: mapProperty(row) as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: mapProperty(row), cursor }
}

export async function createDocDatabaseView(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	input: CreateDocDatabaseViewBody
) {
	await loadAccessibleDatabase(tx, actor, databaseId, 'database.write')
	const rows =
		(await tx`SELECT position FROM doc_database_views WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} ORDER BY position COLLATE "C" DESC LIMIT 1`) as Record<
			string,
			unknown
		>[]
	const pos = input.position ?? generateKeyBetween(rows[0] ? String(rows[0]['position']) : null, null)
	const inserted = input.id
		? ((await tx`INSERT INTO doc_database_views (id,workspace_id,database_id,name,view_type,config,position)
			VALUES (${input.id},${actor.workspaceId},${databaseId},${input.name},${input.viewType},${tx.json((input.config ?? {}) as never)},${pos}) RETURNING *`) as Record<
				string,
				unknown
			>[])
		: ((await tx`INSERT INTO doc_database_views (workspace_id,database_id,name,view_type,config,position)
			VALUES (${actor.workspaceId},${databaseId},${input.name},${input.viewType},${tx.json((input.config ?? {}) as never)},${pos}) RETURNING *`) as Record<
				string,
				unknown
			>[])
	const row = inserted[0]
	if (!row) throw new Error('failed to create view')
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_database_view',
		entityId: String(row['id']),
		action: 'upsert',
		scope: [`db:${databaseId}`],
		payload: mapView(row) as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: mapView(row), cursor }
}

export async function updateDocDatabaseView(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	viewId: string,
	input: UpdateDocDatabaseViewBody
) {
	await loadAccessibleDatabase(tx, actor, databaseId, 'database.write')
	const [existing] =
		(await tx`SELECT * FROM doc_database_views WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} AND id=${viewId} LIMIT 1`) as Record<
			string,
			unknown
		>[]
	if (!existing) throw new HttpError(404, 'not_found', 'View not found')
	if (Number(existing['version']) !== input.version) stale()
	const [row] = (await tx`
		UPDATE doc_database_views SET name=COALESCE(${input.name ?? null},name), config=${tx.json((input.config ?? asObject(existing['config'])) as never)}, position=COALESCE(${input.position ?? null},position), version=version+1
		WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} AND id=${viewId} RETURNING *
	`) as Record<string, unknown>[]
	if (!row) throw new HttpError(404, 'not_found', 'View not found')
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_database_view',
		entityId: viewId,
		action: 'upsert',
		scope: [`db:${databaseId}`],
		payload: mapView(row) as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: mapView(row), cursor }
}

function emptyCell() {
	return { text: null, number: null, boolean: null, dateStart: null, dateEnd: null, json: null }
}
function normalizeCell(input: DocDatabaseRowDto['cells'][string] | undefined) {
	return { ...emptyCell(), ...(input ?? {}) }
}

async function upsertCell(
	tx: Queryable,
	workspaceId: string,
	databaseId: string,
	rowId: string,
	propertyId: string,
	value: ReturnType<typeof normalizeCell>
) {
	await tx`
		INSERT INTO doc_database_cell_values (workspace_id,database_id,row_id,property_id,val_text,val_number,val_bool,val_date_start,val_date_end,val_json)
		VALUES (${workspaceId},${databaseId},${rowId},${propertyId},${value.text},${value.number},${value.boolean},${value.dateStart},${value.dateEnd},${value.json === null || value.json === undefined ? null : tx.json(value.json as never)})
		ON CONFLICT (workspace_id,row_id,property_id) DO UPDATE SET val_text=EXCLUDED.val_text,val_number=EXCLUDED.val_number,val_bool=EXCLUDED.val_bool,val_date_start=EXCLUDED.val_date_start,val_date_end=EXCLUDED.val_date_end,val_json=EXCLUDED.val_json
	`
}

async function loadCells(tx: Queryable, workspaceId: string, rowIds: readonly string[]) {
	if (rowIds.length === 0) return new Map<string, DocDatabaseRowDto['cells']>()
	const rows =
		(await tx`SELECT * FROM doc_database_cell_values WHERE workspace_id=${workspaceId} AND row_id = ANY(${[...rowIds]}::uuid[])`) as Record<
			string,
			unknown
		>[]
	const out = new Map<string, DocDatabaseRowDto['cells']>()
	for (const r of rows) {
		const rowId = String(r['row_id'])
		const cells = out.get(rowId) ?? {}
		cells[String(r['property_id'])] = {
			text: r['val_text'] == null ? null : String(r['val_text']),
			number: r['val_number'] == null ? null : Number(r['val_number']),
			boolean: r['val_bool'] == null ? null : Boolean(r['val_bool']),
			dateStart: nullableIsoTimestamp(r['val_date_start']),
			dateEnd: nullableIsoTimestamp(r['val_date_end']),
			json: r['val_json'] ?? null
		}
		out.set(rowId, cells)
	}
	return out
}

function formulaToCell(value: FormulaValue) {
	if (value === null) return emptyCell()
	if (typeof value === 'string') return { ...emptyCell(), text: value }
	if (typeof value === 'number') return { ...emptyCell(), number: value }
	if (typeof value === 'boolean') return { ...emptyCell(), boolean: value }
	if (typeof value === 'object' && !Array.isArray(value) && 'kind' in value && value.kind === 'date')
		return { ...emptyCell(), dateStart: value.iso }
	return { ...emptyCell(), json: value }
}

function relationIds(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => {
			if (typeof item === 'string') return item
			if (typeof item === 'object' && item !== null) {
				const record = item as Record<string, unknown>
				return typeof record['id'] === 'string'
					? record['id']
					: typeof record['targetId'] === 'string'
						? record['targetId']
						: null
			}
			return null
		})
		.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

function numericRollup(values: unknown[], aggregation: string): number | null {
	const nums = values
		.map((v) =>
			typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
		)
		.filter(Number.isFinite)
	if (nums.length === 0) return aggregation === 'count' ? 0 : null
	if (aggregation === 'sum') return nums.reduce((a, b) => a + b, 0)
	if (aggregation === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length
	if (aggregation === 'min') return Math.min(...nums)
	if (aggregation === 'max') return Math.max(...nums)
	return null
}

function rollupToCell(value: unknown) {
	if (value === null || value === undefined) return emptyCell()
	if (typeof value === 'number') return { ...emptyCell(), number: value }
	if (typeof value === 'boolean') return { ...emptyCell(), boolean: value }
	if (typeof value === 'string') return { ...emptyCell(), text: value }
	return { ...emptyCell(), json: value }
}

/** Compute one rollup. Count/unique work for native relation targets; numeric aggregations require a database target. */
async function computeRollup(
	tx: Queryable,
	actor: ActorContext,
	rollup: DocDatabasePropertyDto,
	properties: readonly DocDatabasePropertyDto[],
	cells: DocDatabaseRowDto['cells']
): Promise<unknown> {
	const config = asObject(rollup.config)
	const relationPropertyId =
		typeof config['relationPropertyId'] === 'string' ? config['relationPropertyId'] : null
	const aggregation = typeof config['aggregation'] === 'string' ? config['aggregation'] : 'count'
	if (!relationPropertyId) return null
	const relationProp = properties.find((p) => p.id === relationPropertyId)
	if (!relationProp || relationProp.propType !== 'relation') return null
	const ids = relationIds(cells[relationPropertyId]?.json)
	if (aggregation === 'count') return ids.length
	if (aggregation === 'unique_values') return new Set(ids).size
	if (ids.length === 0) return aggregation === 'percent_checked' ? 0 : null
	const relationConfig = asObject(relationProp.config)
	if (relationConfig['targetType'] !== 'database' || typeof relationConfig['targetDatabaseId'] !== 'string')
		return null
	const targetDatabaseId = String(relationConfig['targetDatabaseId'])
	// ACL is intentional: a user cannot aggregate rows they cannot read.
	await loadAccessibleDatabase(tx, actor, targetDatabaseId, 'database.read')
	const targetPropertyId = typeof config['targetPropertyId'] === 'string' ? config['targetPropertyId'] : null
	const targetProps = (await listPropertyRows(tx, actor.workspaceId, targetDatabaseId)).map(mapProperty)
	const targetProp = targetProps.find((p) => p.id === targetPropertyId || p.name === targetPropertyId)
	if (!targetProp) return null
	const targetCells = await loadCells(tx, actor.workspaceId, ids)
	const targetRows =
		ids.length === 0
			? []
			: ((await tx`SELECT id,title,created_by,updated_by,created_at,updated_at FROM doc_database_rows WHERE workspace_id=${actor.workspaceId} AND database_id=${targetDatabaseId} AND id = ANY(${ids}::uuid[])`) as Record<
					string,
					unknown
				>[])
	const values = targetRows
		.map((row) => {
			if (targetProp.propType === 'title') return String(row['title'])
			if (targetProp.propType === 'created_time') return String(row['created_at'])
			if (targetProp.propType === 'updated_time') return String(row['updated_at'])
			if (targetProp.propType === 'created_by') return String(row['created_by'])
			if (targetProp.propType === 'updated_by') return row['updated_by'] ? String(row['updated_by']) : null
			const cell = targetCells.get(String(row['id']))?.[targetProp.id]
			if (!cell) return null
			return cell.text ?? cell.number ?? cell.boolean ?? cell.dateStart ?? cell.json ?? null
		})
		.filter((v) => v !== null && v !== undefined)
	if (aggregation === 'percent_checked') {
		const total = targetRows.length
		return total === 0 ? 0 : values.filter((v) => v === true).length / total
	}
	if (aggregation === 'min' || aggregation === 'max') {
		const dates = values
			.map((v) => (typeof v === 'string' ? Date.parse(v) : Number.NaN))
			.filter(Number.isFinite)
		if (dates.length > 0)
			return new Date(aggregation === 'min' ? Math.min(...dates) : Math.max(...dates)).toISOString()
	}
	return numericRollup(values, aggregation)
}

async function materializeRollups(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	rowId: string,
	cells: DocDatabaseRowDto['cells']
) {
	const props = (await listPropertyRows(tx, actor.workspaceId, databaseId)).map(mapProperty)
	for (const prop of props.filter((p) => p.propType === 'rollup')) {
		try {
			const value = await computeRollup(tx, actor, prop, props, cells)
			const cell = rollupToCell(value)
			cells[prop.id] = cell
			await upsertCell(tx, actor.workspaceId, databaseId, rowId, prop.id, cell)
		} catch {
			cells[prop.id] = emptyCell()
			await upsertCell(tx, actor.workspaceId, databaseId, rowId, prop.id, emptyCell())
		}
	}
}

/** Reverse-invalidate source rollups when a target database row changes. */
async function refreshRollupsForTargetRow(
	tx: Queryable,
	actor: ActorContext,
	targetDatabaseId: string,
	targetRowId: string
) {
	const rollupRows = (await tx`
		SELECT id,database_id,config FROM doc_database_properties
		WHERE workspace_id=${actor.workspaceId} AND prop_type='rollup'
		LIMIT 1000
	`) as Record<string, unknown>[]
	for (const rr of rollupRows) {
		const config = asObject(rr['config'])
		const relationPropertyId =
			typeof config['relationPropertyId'] === 'string' ? config['relationPropertyId'] : null
		const sourceDatabaseId = String(rr['database_id'])
		if (!relationPropertyId) continue
		const [relationRow] =
			(await tx`SELECT config FROM doc_database_properties WHERE workspace_id=${actor.workspaceId} AND database_id=${sourceDatabaseId} AND id=${relationPropertyId}::uuid LIMIT 1`) as Record<
				string,
				unknown
			>[]
		const relationConfig = asObject(relationRow?.['config'])
		if (
			relationConfig['targetType'] !== 'database' ||
			relationConfig['targetDatabaseId'] !== targetDatabaseId
		)
			continue
		const rows = (await tx`
			SELECT DISTINCT cv.row_id FROM doc_database_cell_values cv
			WHERE cv.workspace_id=${actor.workspaceId} AND cv.database_id=${sourceDatabaseId} AND cv.property_id=${relationPropertyId}::uuid
				AND EXISTS (
					SELECT 1 FROM jsonb_array_elements(cv.val_json) elem
					WHERE COALESCE(elem->>'id', elem->>'targetId', elem #>> '{}') = ${targetRowId}
				)
			LIMIT 500
		`) as Record<string, unknown>[]
		for (const source of rows) {
			const rowId = String(source['row_id'])
			const cells = (await loadCells(tx, actor.workspaceId, [rowId])).get(rowId) ?? {}
			await materializeRollups(tx, actor, sourceDatabaseId, rowId, cells)
		}
	}
}

async function materializeFormulas(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	rowId: string,
	title: string,
	cells: DocDatabaseRowDto['cells']
) {
	const props = (await listPropertyRows(tx, actor.workspaceId, databaseId)).map(mapProperty)
	const values = new Map<string, FormulaValue>()
	for (const p of props) {
		const c = cells[p['id']]
		if (p.propType === 'title') values.set(p['name'], title)
		else if (c?.text != null) values.set(p['name'], c.text)
		else if (c?.number != null) values.set(p['name'], c.number)
		else if (c?.boolean != null) values.set(p['name'], c.boolean)
		else if (c?.dateStart) values.set(p['name'], { kind: 'date', iso: c.dateStart })
		else if (c?.json != null) values.set(p['name'], c.json as FormulaValue)
		else values.set(p['name'], null)
	}
	for (const p of props.filter((p) => p.propType === 'formula')) {
		const source = typeof p.config['formulaSource'] === 'string' ? String(p.config['formulaSource']) : ''
		if (!source) continue
		try {
			const value = evaluateFormula(source, { now: new Date(), prop: (name) => values.get(name) })
			values.set(p['name'], value)
			cells[p['id']] = formulaToCell(value)
			await upsertCell(tx, actor.workspaceId, databaseId, rowId, p['id'], formulaToCell(value))
		} catch {
			cells[p['id']] = emptyCell()
			await upsertCell(tx, actor.workspaceId, databaseId, rowId, p['id'], emptyCell())
		}
	}
}

export async function createDocDatabaseRow(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	input: CreateDocDatabaseRowBody
) {
	await loadAccessibleDatabase(tx, actor, databaseId, 'database.write')
	const [last] = await tx<
		{ position: string }[]
	>`SELECT position FROM doc_database_rows WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} ORDER BY position COLLATE "C" DESC LIMIT 1`
	const pos = input.position ?? generateKeyBetween(last?.['position'] ?? null, null)
	const inserted = input.id
		? ((await tx`INSERT INTO doc_database_rows (id,workspace_id,database_id,title,position,created_by,updated_by)
			VALUES (${input.id},${actor.workspaceId},${databaseId},${input.title ?? ''},${pos},${actor.userId},${actor.userId}) RETURNING *`) as Record<
				string,
				unknown
			>[])
		: ((await tx`INSERT INTO doc_database_rows (workspace_id,database_id,title,position,created_by,updated_by)
			VALUES (${actor.workspaceId},${databaseId},${input.title ?? ''},${pos},${actor.userId},${actor.userId}) RETURNING *`) as Record<
				string,
				unknown
			>[])
	const r = inserted[0]
	if (!r) throw new Error('failed to create row')
	for (const [propertyId, value] of Object.entries(input.cells ?? {}))
		await upsertCell(tx, actor.workspaceId, databaseId, String(r['id']), propertyId, normalizeCell(value))
	const cells = (await loadCells(tx, actor.workspaceId, [String(r['id'])])).get(String(r['id'])) ?? {}
	await materializeRollups(tx, actor, databaseId, String(r['id']), cells)
	await materializeFormulas(tx, actor, databaseId, String(r['id']), String(r['title']), cells)
	await refreshRollupsForTargetRow(tx, actor, databaseId, String(r['id']))
	await audit(tx, actor, 'database.row.created', databaseId, { rowId: r['id'] })
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_database_row',
		entityId: String(r['id']),
		action: 'upsert',
		scope: [`db:${databaseId}`],
		payload: mapRow(r, cells) as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: mapRow(r, cells), cursor }
}

export async function updateDocDatabaseRow(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	rowId: string,
	input: UpdateDocDatabaseRowBody
) {
	await loadAccessibleDatabase(tx, actor, databaseId, 'database.write')
	const [existing] =
		(await tx`SELECT * FROM doc_database_rows WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} AND id=${rowId} LIMIT 1`) as Record<
			string,
			unknown
		>[]
	if (!existing) throw new HttpError(404, 'not_found', 'Database row not found')
	if (Number(existing['version']) !== input.version) stale()
	const archivedAt =
		input.archived === undefined
			? existing['archived_at'] === null
				? null
				: String(existing['archived_at'])
			: input.archived
				? new Date().toISOString()
				: null
	const [r] = (await tx`
		UPDATE doc_database_rows SET title=COALESCE(${input.title ?? null},title), position=COALESCE(${input.position ?? null},position), archived_at=${archivedAt}, updated_by=${actor.userId}, version=version+1
		WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} AND id=${rowId} RETURNING *
	`) as Record<string, unknown>[]
	if (!r) throw new HttpError(404, 'not_found', 'Database row not found')
	for (const [propertyId, value] of Object.entries(input.cells ?? {}))
		await upsertCell(tx, actor.workspaceId, databaseId, rowId, propertyId, normalizeCell(value))
	const cells = (await loadCells(tx, actor.workspaceId, [rowId])).get(rowId) ?? {}
	await materializeRollups(tx, actor, databaseId, rowId, cells)
	await materializeFormulas(tx, actor, databaseId, rowId, String(r['title']), cells)
	await refreshRollupsForTargetRow(tx, actor, databaseId, rowId)
	await audit(tx, actor, 'database.row.updated', databaseId, { rowId })
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_database_row',
		entityId: rowId,
		action: input.archived ? 'delete' : 'upsert',
		scope: [`db:${databaseId}`],
		payload: input.archived ? null : (mapRow(r, cells) as unknown as Record<string, unknown>),
		actorId: actor.principalId
	})
	return { data: mapRow(r, cells), cursor }
}

/** CSV/JSON import. Rows are transactional as one import; malformed columns degrade to empty cells. */
export async function importDocDatabaseRows(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	input: ImportDocDatabaseRowsBody
): Promise<ImportDocDatabaseRowsResultDto> {
	await loadAccessibleDatabase(tx, actor, databaseId, 'database.write')
	const properties = (await listPropertyRows(tx, actor.workspaceId, databaseId)).map(mapProperty)
	let parsed: ReturnType<typeof databaseRowsFromCsv>
	try {
		parsed =
			input.format === 'csv'
				? databaseRowsFromCsv(input.data, properties)
				: databaseRowsFromJson(input.data, properties)
	} catch (error) {
		throw new HttpError(
			422,
			'validation_failed',
			error instanceof Error ? error.message : 'Invalid import payload'
		)
	}
	if (parsed.length > 5000)
		throw new HttpError(422, 'validation_failed', 'Imports are limited to 5,000 rows per request')
	let created = 0
	const errors: { row: number; message: string }[] = []
	for (let i = 0; i < parsed.length; i++) {
		const row = parsed[i]
		if (!row) continue
		if (!row.title && Object.keys(row.cells).length === 0) {
			errors.push({ row: i + 1, message: 'Row has no importable values' })
			continue
		}
		await createDocDatabaseRow(tx, actor, databaseId, {
			title: row.title.slice(0, 500),
			cells: row.cells as DocDatabaseRowDto['cells']
		})
		created++
	}
	await audit(tx, actor, 'database.rows.imported', databaseId, {
		created,
		skipped: errors.length,
		format: input.format
	})
	return { created, skipped: errors.length, errors }
}

/** Export up to 10,000 rows in the selected view order/filter. */
export async function exportDocDatabaseRows(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	input: { format: 'csv' | 'json'; viewId?: string | undefined }
): Promise<{ format: 'csv' | 'json'; data: string }> {
	await loadAccessibleDatabase(tx, actor, databaseId, 'database.read')
	const properties = (await listPropertyRows(tx, actor.workspaceId, databaseId)).map(mapProperty)
	const rows: DocDatabaseRowDto[] = []
	let cursor: string | undefined
	for (let page = 0; page < 20; page++) {
		const result = await queryDocDatabaseRows(tx, actor, databaseId, {
			...(input.viewId ? { viewId: input.viewId } : {}),
			limit: 500,
			...(cursor ? { cursor } : {})
		})
		rows.push(...result.rows)
		if (!result.nextCursor) break
		cursor = result.nextCursor
	}
	return {
		format: input.format,
		data: input.format === 'csv' ? databaseRowsToCsv(rows, properties) : databaseRowsToJson(rows, properties)
	}
}

/** Lazily allocate the row body page. Row pages are ordinary collab docs but hidden from page trees. */
export async function ensureDocDatabaseRowPage(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	rowId: string
) {
	const database = await loadAccessibleDatabase(tx, actor, databaseId, 'database.write')
	const [locked] = (await tx`
		SELECT id,page_id,title,version FROM doc_database_rows
		WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} AND id=${rowId}
		FOR UPDATE
	`) as Record<string, unknown>[]
	if (!locked) throw new HttpError(404, 'not_found', 'Database row not found')
	if (locked['page_id']) return { pageId: String(locked['page_id']), created: false }
	const created = await createDocPage(tx, actor, {
		title: String(locked['title'] ?? '') || 'Untitled row',
		parentId: database['parent_page_id'] ? String(database['parent_page_id']) : null,
		teamspaceId: database['teamspace_id'] ? String(database['teamspace_id']) : null
	})
	await tx`UPDATE doc_pages SET is_database_row=true WHERE workspace_id=${actor.workspaceId} AND id=${created.data.id}`
	await tx`UPDATE doc_database_rows SET page_id=${created.data.id}, version=version+1 WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} AND id=${rowId}`
	await audit(tx, actor, 'database.row.page_allocated', databaseId, { rowId, pageId: created.data.id })
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_database_row',
		entityId: rowId,
		action: 'upsert',
		scope: [`db:${databaseId}`],
		payload: { id: rowId, pageId: created.data.id },
		actorId: actor.principalId
	})
	return { pageId: created.data.id, created: true, cursor: Math.max(created.cursor, cursor) }
}

export async function queryDocDatabaseRows(
	tx: Queryable,
	actor: ActorContext,
	databaseId: string,
	input: QueryDocDatabaseRowsBody
): Promise<DocDatabaseRowsPageDto> {
	await loadAccessibleDatabase(tx, actor, databaseId, 'database.read')
	const limit = input.limit ?? 100
	const archived = input.includeArchived ? tx`` : tx`AND r.archived_at IS NULL`
	const properties = (await listPropertyRows(tx, actor.workspaceId, databaseId)).map(mapProperty)
	let filter = input.filter
	let sorts = input.sorts
	if (input.viewId) {
		const [view] =
			(await tx`SELECT config FROM doc_database_views WHERE workspace_id=${actor.workspaceId} AND database_id=${databaseId} AND id=${input.viewId} LIMIT 1`) as Record<
				string,
				unknown
			>[]
		if (!view) throw new HttpError(404, 'not_found', 'Database view not found')
		const config = asObject(view['config'])
		filter ??= config['filter']
		sorts ??= Array.isArray(config['sorts']) ? (config['sorts'] as unknown as typeof sorts) : undefined
	}
	const hasStructuredQuery = filter !== undefined || (sorts?.length ?? 0) > 0
	let rows: Record<string, unknown>[]
	if (hasStructuredQuery) {
		const compiled = buildDatabaseRowQuerySql(tx, actor.workspaceId, {
			filter,
			sorts: sorts ?? [],
			properties
		})
		const offset = input.cursor?.startsWith('offset:') ? Number.parseInt(input.cursor.slice(7), 10) : 0
		if (!Number.isSafeInteger(offset) || offset < 0)
			throw new HttpError(400, 'validation_failed', 'Invalid database rows cursor')
		if (compiled.hasCellJoins) {
			// EAV selectivity independence across sparse property_id joins causes PG
			// to under-estimate row counts and pick repeated PK nested-loop probes;
			// force_custom_plan also avoids 6th-call generic plan flips under prepare: true.
			await tx`SELECT set_config('enable_nestloop', 'off', true), set_config('plan_cache_mode', 'force_custom_plan', true)`
		}
		rows = (await tx`
			SELECT r.id,r.workspace_id,r.database_id,r.page_id,r.title,r.position,r.created_by,r.updated_by,r.archived_at,r.created_at,r.updated_at,r.version
			FROM doc_database_rows r
			${compiled.joins}
			WHERE r.workspace_id=${actor.workspaceId} AND r.database_id=${databaseId} ${archived}
				AND ${compiled.where}
			ORDER BY ${compiled.order} LIMIT ${limit + 1} OFFSET ${offset}
		`) as Record<string, unknown>[]
		if (compiled.hasCellJoins) {
			await tx`SELECT set_config('enable_nestloop', 'on', true)`
		}
	} else if (input.cursor) {
		const [pos, id] = input.cursor.split('|')
		rows = (await tx`
			SELECT * FROM doc_database_rows r WHERE r.workspace_id=${actor.workspaceId} AND r.database_id=${databaseId} ${archived}
				AND (r.position COLLATE "C", r.id) > (${pos ?? ''}, ${id ?? '00000000-0000-0000-0000-000000000000'}::uuid)
			ORDER BY r.position COLLATE "C", r.id LIMIT ${limit + 1}
		`) as Record<string, unknown>[]
	} else {
		rows = (await tx`
			SELECT * FROM doc_database_rows r WHERE r.workspace_id=${actor.workspaceId} AND r.database_id=${databaseId} ${archived}
			ORDER BY r.position COLLATE "C", r.id LIMIT ${limit + 1}
		`) as Record<string, unknown>[]
	}
	const pageRows = rows.slice(0, limit)
	const cells = await loadCells(
		tx,
		actor.workspaceId,
		pageRows.map((r) => String(r['id']))
	)
	const last = pageRows[pageRows.length - 1]
	const nextCursor =
		rows.length > limit
			? hasStructuredQuery
				? `offset:${(input.cursor?.startsWith('offset:') ? Number.parseInt(input.cursor.slice(7), 10) : 0) + limit}`
				: last
					? `${String(last['position'])}|${String(last['id'])}`
					: null
			: null
	return {
		rows: pageRows.map((r) => mapRow(r, cells.get(String(r['id'])) ?? {})),
		nextCursor,
		hasMore: rows.length > limit
	}
}
