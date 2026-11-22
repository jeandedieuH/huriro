import type { FieldError, FieldErrors, FieldValues, Resolver } from 'react-hook-form'
import type { z } from 'zod'

type ErrorNode = Record<string, unknown>

function setNestedFieldError(target: ErrorNode, path: readonly PropertyKey[], error: FieldError): void {
	if (path.length === 0) {
		if (!('root' in target)) target['root'] = error
		return
	}
	let cursor: ErrorNode = target
	for (let i = 0; i < path.length - 1; i++) {
		const segment = String(path[i])
		const existing = cursor[segment]
		if (typeof existing === 'object' && existing !== null) {
			cursor = existing as ErrorNode
		} else {
			const next: ErrorNode = {}
			cursor[segment] = next
			cursor = next
		}
	}
	const leaf = String(path[path.length - 1])
	// Preserve the first issue per field so multiple rules do not overwrite the primary message.
	if (!(leaf in cursor)) {
		cursor[leaf] = error
	}
}

/**
 * Strictly typed Zod v4 resolver for react-hook-form (avoids unmaintained
 * third-party resolver packages while honoring field transforms and nested paths).
 */
export function zodResolver<TValues extends FieldValues>(schema: z.ZodType<TValues>): Resolver<TValues> {
	return async (values) => {
		const parsed = await schema.safeParseAsync(values)
		if (parsed.success) {
			return { values: parsed.data, errors: {} }
		}
		const errors: ErrorNode = {}
		for (const issue of parsed.error.issues) {
			setNestedFieldError(errors, issue.path, {
				type: issue.code,
				message: issue.message
			})
		}
		return {
			values: {} as Record<string, never>,
			errors: errors as FieldErrors<TValues>
		}
	}
}
