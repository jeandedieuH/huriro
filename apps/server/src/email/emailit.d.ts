declare module '@emailit/node' {
	export interface EmailitClientConfig {
		readonly apiKey: string
		readonly apiBase?: string | undefined
		readonly timeout?: number | undefined
		readonly fetch?: typeof fetch | undefined
	}

	export interface EmailSendParams {
		readonly from: string
		readonly to: string | readonly string[]
		readonly subject?: string | undefined
		readonly html?: string | undefined
		readonly text?: string | undefined
		readonly reply_to?: string | readonly string[] | undefined
		readonly cc?: string | readonly string[] | undefined
		readonly bcc?: string | readonly string[] | undefined
		readonly headers?: Record<string, string> | undefined
		readonly tags?: readonly string[] | undefined
		readonly template?: string | undefined
		readonly variables?: Record<string, unknown> | undefined
		readonly scheduled_at?: string | undefined
		readonly attachments?:
			| readonly {
					readonly filename: string
					readonly content: string | Buffer
					readonly content_type?: string | undefined
			  }[]
			| undefined
	}

	export interface EmailitEmailResponse {
		readonly id?: string | undefined
		readonly status?: string | undefined
		readonly from?: string | undefined
		readonly to?: readonly string[] | undefined
		readonly subject?: string | undefined
		toArray(): Record<string, unknown>
		toJSON(): Record<string, unknown>
	}

	export class ApiErrorException extends Error {
		readonly httpStatus: number
		readonly httpBody: string
		readonly jsonBody: unknown
		readonly httpHeaders: Record<string, string>
		constructor(
			message: string,
			httpStatus?: number,
			httpBody?: string,
			jsonBody?: unknown,
			httpHeaders?: Record<string, string>
		)
	}

	export class ApiConnectionException extends ApiErrorException {}
	export class AuthenticationException extends ApiErrorException {}
	export class InvalidRequestException extends ApiErrorException {}
	export class RateLimitException extends ApiErrorException {}
	export class UnprocessableEntityException extends ApiErrorException {}

	export class EmailService {
		send(params: EmailSendParams): Promise<EmailitEmailResponse>
		get(id: string): Promise<EmailitEmailResponse>
		cancel(id: string): Promise<EmailitEmailResponse>
		retry(id: string): Promise<EmailitEmailResponse>
	}

	export class EmailitClient {
		readonly emails: EmailService
		constructor(config: string | EmailitClientConfig)
	}

	export class Emailit extends EmailitClient {}
}
