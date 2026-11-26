/**
 * API error contract — RFC 9457 Problem Details + stable machine-readable `code`
 * (§16.2). Every code is enumerated here with a doc URL so clients can localize
 * and MCP/CLI tooling can branch on `code`, never on `title`.
 */
import { type Static, Type } from 'typebox'

export const ERROR_CODES = [
	// generic
	'validation_failed',
	'unauthorized',
	'forbidden',
	'not_found',
	'conflict',
	'rate_limited',
	'internal',
	'not_implemented',
	// sync & concurrency
	'stale_version',
	'sync_cursor_expired',
	'idempotency_conflict',
	'idempotency_in_flight',
	'bulk_restore_conflict',
	// tenancy & authz
	'workspace_required',
	'not_workspace_member',
	'insufficient_role',
	'resource_private',
	// auth & sessions
	'session_expired',
	'credential_type_mismatch',
	'mfa_required',
	'setup_required',
	'setup_completed',
	// workflow automation (ADR-0028)
	'automation_invalid_cron',
	'automation_invalid_yaml',
	// agents & MCP
	'agent_scope_exceeded',
	'agent_not_connected',
	'agent_suspended',
	'insufficient_scope',
	'tool_rate_limited',
	'approval_expired',
	'tool_unknown',
	'agent_revoked',
	'agents_disabled',
	'token_audience_mismatch',
	// collaborative docs
	'doc_too_large',
	'doc_locked',
	'invalid_public_doc_password',
	'collab_lease_conflict',
	'collab_ticket_invalid',
	// M4 files, chat, SSRF, webhooks
	'file_infected',
	'file_pending_scan',
	'file_too_large',
	'ssrf_blocked',
	'egress_failed',
	'webhook_signature_invalid',
	'channel_archived',
	// AI gateway (§11.3)
	'ai_disabled',
	'ai_provider_unconfigured',
	'ai_provider_error',
	// M5 shared inbox (§14)
	'mail_domain_unverified',
	'mail_draft_locked',
	'mail_provider_unconfigured',
	'mail_send_window_expired',
	'mail_review_required',
	'mail_message_too_large',
	// email notification pipeline
	'email_not_configured',
	'email_delivery_failed',
	// M6 mobile, billing, governance, hardening (§19–§22)
	'read_only_mode',
	'billing_disabled',
	'web_only_billing',
	'export_failed'
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** Public base URL for error documentation (see docs/api). */
export const ERROR_DOC_BASE = 'https://docs.huriro.app/errors/'

export const ProblemDetails = Type.Object(
	{
		type: Type.String({ format: 'uri', description: 'Doc URL for this error code' }),
		title: Type.String({ description: 'Human-readable summary (not localized)' }),
		status: Type.Integer({ minimum: 400, maximum: 599 }),
		code: Type.String({ description: 'Stable machine code — branch on this' }),
		detail: Type.Optional(Type.String()),
		instance: Type.Optional(Type.String()),
		requestId: Type.String({ description: 'Correlation id for support/log lookup' })
	},
	{
		$id: 'ProblemDetails',
		description: 'RFC 9457 problem+json extended with `code` and `requestId` (§16.2)',
		additionalProperties: true // extensions like currentVersion/yourVersion are allowed
	}
)

export type ProblemDetails = Static<typeof ProblemDetails>

/** Build a problem+json body. Extra machine fields (versions, retry hints) go in `ext`. */
export function problem(
	init: {
		status: number
		code: ErrorCode
		title: string
		detail?: string
		instance?: string
		requestId: string
	},
	ext?: Record<string, unknown>
): ProblemDetails {
	return {
		type: `${ERROR_DOC_BASE}${init.code}`,
		title: init.title,
		status: init.status,
		code: init.code,
		...(init.detail !== undefined ? { detail: init.detail } : {}),
		...(init.instance !== undefined ? { instance: init.instance } : {}),
		requestId: init.requestId,
		...ext
	}
}
