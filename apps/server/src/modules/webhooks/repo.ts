import type { WebhookDeliveryDto, WebhookDeliveryStatus, WebhookEndpointDto } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export async function listWebhookEndpointRows(
	tx: Queryable,
	workspaceId: string
): Promise<WebhookEndpointDto[]> {
	return tx<WebhookEndpointDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			name,
			url,
			secret_prefix AS "secretPrefix",
			events,
			enabled,
			created_by AS "createdBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
		FROM webhook_endpoints
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at DESC
	`
}

export async function getWebhookEndpointWithSecret(
	tx: Queryable,
	workspaceId: string,
	endpointId: string
): Promise<{ readonly endpoint: WebhookEndpointDto; readonly secretEncrypted: string } | null> {
	const [row] = await tx<(WebhookEndpointDto & { readonly secretEncrypted: string })[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			name,
			url,
			secret_prefix AS "secretPrefix",
			secret_encrypted AS "secretEncrypted",
			events,
			enabled,
			created_by AS "createdBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
		FROM webhook_endpoints
		WHERE workspace_id = ${workspaceId} AND id = ${endpointId}
	`
	if (!row) return null
	const { secretEncrypted, ...endpoint } = row
	return { endpoint, secretEncrypted }
}

export async function insertWebhookEndpointRow(
	tx: Queryable,
	args: {
		readonly id: string
		readonly workspaceId: string
		readonly name: string
		readonly url: string
		readonly secretEncrypted: string
		readonly secretPrefix: string
		readonly events: readonly string[]
		readonly enabled: boolean
		readonly createdBy: string
	}
): Promise<WebhookEndpointDto> {
	const [row] = await tx<WebhookEndpointDto[]>`
		INSERT INTO webhook_endpoints (
			id, workspace_id, name, url, secret_encrypted, secret_prefix, events, enabled, created_by
		)
		VALUES (
			${args.id}, ${args.workspaceId}, ${args.name}, ${args.url},
			${args.secretEncrypted}, ${args.secretPrefix}, ${[...args.events]}::text[],
			${args.enabled}, ${args.createdBy}
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			name,
			url,
			secret_prefix AS "secretPrefix",
			events,
			enabled,
			created_by AS "createdBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) throw new Error('Failed to create webhook endpoint')
	return row
}

export async function updateWebhookEndpointRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly endpointId: string
		readonly expectedVersion: number
		readonly name: string
		readonly url: string
		readonly events: readonly string[]
		readonly enabled: boolean
		readonly secretEncrypted: string
		readonly secretPrefix: string
	}
): Promise<WebhookEndpointDto | null> {
	const [row] = await tx<WebhookEndpointDto[]>`
		UPDATE webhook_endpoints
		SET
			name = ${args.name},
			url = ${args.url},
			events = ${[...args.events]}::text[],
			enabled = ${args.enabled},
			secret_encrypted = ${args.secretEncrypted},
			secret_prefix = ${args.secretPrefix},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.endpointId}
			AND version = ${args.expectedVersion}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			name,
			url,
			secret_prefix AS "secretPrefix",
			events,
			enabled,
			created_by AS "createdBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	return row ?? null
}

export async function deleteWebhookEndpointRow(
	tx: Queryable,
	workspaceId: string,
	endpointId: string
): Promise<boolean> {
	const deleted = await tx<{ id: string }[]>`
		DELETE FROM webhook_endpoints
		WHERE workspace_id = ${workspaceId} AND id = ${endpointId}
		RETURNING id
	`
	return deleted.length > 0
}

function eventMatchesFilter(subscribed: readonly string[], eventType: string): boolean {
	for (const pattern of subscribed) {
		if (pattern === '*' || pattern === eventType) return true
		if (pattern.endsWith('.*')) {
			const prefix = pattern.slice(0, -1)
			if (eventType.startsWith(prefix)) return true
		}
	}
	return false
}

export async function listMatchingEnabledEndpointIds(
	tx: Queryable,
	workspaceId: string,
	eventType: string
): Promise<{ readonly id: string }[]> {
	const rows = await tx<{ id: string; events: string[] }[]>`
		SELECT id, events
		FROM webhook_endpoints
		WHERE workspace_id = ${workspaceId} AND enabled = true
	`
	return rows.filter((r) => eventMatchesFilter(r.events, eventType)).map((r) => ({ id: r.id }))
}

export async function insertWebhookDeliveryRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly endpointId: string
		readonly eventId: string | null
		readonly eventType: string
		readonly payload: Record<string, unknown>
	}
): Promise<WebhookDeliveryDto> {
	const [row] = await tx<WebhookDeliveryDto[]>`
		INSERT INTO webhook_deliveries (workspace_id, endpoint_id, event_id, event_type, payload)
		VALUES (${args.workspaceId}, ${args.endpointId}, ${args.eventId}, ${args.eventType}, ${tx.json(args.payload as never)})
		RETURNING
			id,
			workspace_id AS "workspaceId",
			endpoint_id AS "endpointId",
			event_id AS "eventId",
			event_type AS "eventType",
			payload,
			status,
			attempts,
			max_attempts AS "maxAttempts",
			next_attempt_at::text AS "nextAttemptAt",
			last_status_code AS "lastStatusCode",
			last_response_body AS "lastResponseBody",
			last_error AS "lastError",
			delivered_at::text AS "deliveredAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
	`
	if (!row) throw new Error('Failed to insert webhook delivery')
	return row
}

export async function listWebhookDeliveryRows(
	tx: Queryable,
	workspaceId: string,
	endpointId: string,
	limit = 50
): Promise<WebhookDeliveryDto[]> {
	return tx<WebhookDeliveryDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			endpoint_id AS "endpointId",
			event_id AS "eventId",
			event_type AS "eventType",
			payload,
			status,
			attempts,
			max_attempts AS "maxAttempts",
			next_attempt_at::text AS "nextAttemptAt",
			last_status_code AS "lastStatusCode",
			last_response_body AS "lastResponseBody",
			last_error AS "lastError",
			delivered_at::text AS "deliveredAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
		FROM webhook_deliveries
		WHERE workspace_id = ${workspaceId} AND endpoint_id = ${endpointId}
		ORDER BY created_at DESC
		LIMIT ${limit}
	`
}

export interface ClaimedDeliveryWithEndpoint {
	readonly delivery: WebhookDeliveryDto
	readonly url: string
	readonly secretEncrypted: string
	readonly endpointEnabled: boolean
}

export async function claimDueWebhookDeliveryRows(
	tx: Queryable,
	workspaceId: string,
	limit = 50
): Promise<ClaimedDeliveryWithEndpoint[]> {
	const rows = await tx<
		(WebhookDeliveryDto & {
			readonly endpointUrl: string
			readonly secretEncrypted: string
			readonly endpointEnabled: boolean
		})[]
	>`
		WITH due AS (
			SELECT id
			FROM webhook_deliveries
			WHERE workspace_id = ${workspaceId}
				AND status IN ('pending', 'retrying')
				AND next_attempt_at <= now()
			ORDER BY next_attempt_at ASC
			LIMIT ${limit}
			FOR UPDATE SKIP LOCKED
		)
		SELECT
			d.id,
			d.workspace_id AS "workspaceId",
			d.endpoint_id AS "endpointId",
			d.event_id AS "eventId",
			d.event_type AS "eventType",
			d.payload,
			d.status,
			d.attempts,
			d.max_attempts AS "maxAttempts",
			d.next_attempt_at::text AS "nextAttemptAt",
			d.last_status_code AS "lastStatusCode",
			d.last_response_body AS "lastResponseBody",
			d.last_error AS "lastError",
			d.delivered_at::text AS "deliveredAt",
			d.created_at::text AS "createdAt",
			d.updated_at::text AS "updatedAt",
			e.url AS "endpointUrl",
			e.secret_encrypted AS "secretEncrypted",
			e.enabled AS "endpointEnabled"
		FROM webhook_deliveries d
		JOIN due ON due.id = d.id
		JOIN webhook_endpoints e ON e.workspace_id = d.workspace_id AND e.id = d.endpoint_id
	`
	return rows.map((r) => {
		const { endpointUrl, secretEncrypted, endpointEnabled, ...delivery } = r
		return {
			delivery,
			url: endpointUrl,
			secretEncrypted,
			endpointEnabled
		}
	})
}

export async function updateWebhookDeliveryOutcome(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly deliveryId: string
		readonly status: WebhookDeliveryStatus
		readonly attempts: number
		readonly nextAttemptAtIso: string
		readonly lastStatusCode: number | null
		readonly lastResponseBody: string | null
		readonly lastError: string | null
		readonly deliveredAtIso: string | null
	}
): Promise<WebhookDeliveryDto | null> {
	const [row] = await tx<WebhookDeliveryDto[]>`
		UPDATE webhook_deliveries
		SET
			status = ${args.status},
			attempts = ${args.attempts},
			next_attempt_at = ${args.nextAttemptAtIso}::timestamptz,
			last_status_code = ${args.lastStatusCode},
			last_response_body = ${args.lastResponseBody},
			last_error = ${args.lastError},
			delivered_at = ${args.deliveredAtIso}::timestamptz
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.deliveryId}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			endpoint_id AS "endpointId",
			event_id AS "eventId",
			event_type AS "eventType",
			payload,
			status,
			attempts,
			max_attempts AS "maxAttempts",
			next_attempt_at::text AS "nextAttemptAt",
			last_status_code AS "lastStatusCode",
			last_response_body AS "lastResponseBody",
			last_error AS "lastError",
			delivered_at::text AS "deliveredAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
	`
	return row ?? null
}

export async function resetWebhookDeliveryForReplayRow(
	tx: Queryable,
	workspaceId: string,
	deliveryId: string
): Promise<ClaimedDeliveryWithEndpoint | null> {
	const [row] = await tx<
		(WebhookDeliveryDto & {
			readonly endpointUrl: string
			readonly secretEncrypted: string
			readonly endpointEnabled: boolean
		})[]
	>`
		UPDATE webhook_deliveries d
		SET
			status = 'pending',
			attempts = 0,
			next_attempt_at = now(),
			last_error = NULL
		FROM webhook_endpoints e
		WHERE d.workspace_id = ${workspaceId}
			AND d.id = ${deliveryId}
			AND e.workspace_id = d.workspace_id
			AND e.id = d.endpoint_id
		RETURNING
			d.id,
			d.workspace_id AS "workspaceId",
			d.endpoint_id AS "endpointId",
			d.event_id AS "eventId",
			d.event_type AS "eventType",
			d.payload,
			d.status,
			d.attempts,
			d.max_attempts AS "maxAttempts",
			d.next_attempt_at::text AS "nextAttemptAt",
			d.last_status_code AS "lastStatusCode",
			d.last_response_body AS "lastResponseBody",
			d.last_error AS "lastError",
			d.delivered_at::text AS "deliveredAt",
			d.created_at::text AS "createdAt",
			d.updated_at::text AS "updatedAt",
			e.url AS "endpointUrl",
			e.secret_encrypted AS "secretEncrypted",
			e.enabled AS "endpointEnabled"
	`
	if (!row) return null
	const { endpointUrl, secretEncrypted, endpointEnabled, ...delivery } = row
	return { delivery, url: endpointUrl, secretEncrypted, endpointEnabled }
}
