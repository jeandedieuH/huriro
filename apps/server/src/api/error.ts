/**
 * problem+json mapper (§16.2): never leak internals — no stack traces, SQL, or
 * provider messages in responses; they're logged with request_id instead.
 */
import { type ErrorCode, type ProblemDetails, problem } from '@huriro/contracts'
import { NotFound, ParseError, ValidationError } from 'elysia'
import { SsrfBlockedError } from './egress'
import type { log as logger } from './observability'

type Log = typeof logger

export class HttpError extends Error {
	readonly status: number
	readonly code: ErrorCode
	readonly detail?: string | undefined
	readonly ext?: Record<string, unknown> | undefined
	/** Extra response headers (e.g. RFC 6750 `WWW-Authenticate` challenges). */
	readonly headers?: Record<string, string> | undefined

	constructor(
		status: number,
		code: ErrorCode,
		message: string,
		detail?: string,
		ext?: Record<string, unknown>,
		headers?: Record<string, string>
	) {
		super(message)
		this.name = 'HttpError'
		this.status = status
		this.code = code
		this.detail = detail
		this.ext = ext
		this.headers = headers
	}
}

export function toProblem(
	err: unknown,
	requestId: string,
	path: string,
	log: Log
): { status: number; body: ProblemDetails } {
	if (err instanceof SsrfBlockedError) {
		return {
			status: 422,
			body: problem({
				status: 422,
				code: 'ssrf_blocked',
				title: err.message,
				instance: path,
				requestId
			})
		}
	}
	if (err instanceof HttpError) {
		return {
			status: err.status,
			body: problem(
				{
					status: err.status,
					code: err.code,
					title: err.message,
					...(err.detail ? { detail: err.detail } : {}),
					instance: path,
					requestId
				},
				err.ext
			)
		}
	}
	// Elysia v2 error classes → stable contract codes, internals never leak.
	if (err instanceof ValidationError) {
		return {
			status: 422,
			body: problem({
				status: 422,
				code: 'validation_failed',
				title: 'Request failed validation',
				instance: path,
				requestId
			})
		}
	}
	if (err instanceof ParseError) {
		return {
			status: 400,
			body: problem({
				status: 400,
				code: 'validation_failed',
				title: 'Malformed request body',
				instance: path,
				requestId
			})
		}
	}
	if (err instanceof NotFound) {
		return {
			status: 404,
			body: problem({ status: 404, code: 'not_found', title: 'Not found', instance: path, requestId })
		}
	}
	log.error({ err, request_id: requestId, path }, 'unhandled error')
	return {
		status: 500,
		body: problem({
			status: 500,
			code: 'internal',
			title: 'Something went wrong',
			detail: `Reference ${requestId}`,
			instance: path,
			requestId
		})
	}
}
